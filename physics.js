/* Plasma toroid v2.3.0 physics engine (pure functions, runs in a browser or in node).
   1. driver circuit ODE (Vdrive, L2, Q1||Q2, L100, cap bank, gate divider) with the plasma ring as a coupled secondary
   2. coaxial loop fields with complete elliptic integrals (B, A, induced E, mutual inductance)
   3. 0D xenon plasma model: Maxwellian rate integrals, particle balance for Te, power balance for ne, energy split
   Every number not printed on the schematic is an assumption and is listed in DEFAULTS with a note. */
(function (root) {
  'use strict';
  const MU0 = 4e-7 * Math.PI, EPS0 = 8.8541878e-12, QE = 1.602176634e-19, ME = 9.1093837e-31, KB = 1.380649e-23;
  const AMU = 1.66053907e-27, MXE = 131.293 * AMU, N0 = 2.6868e25;

  const DEFAULTS = {
    // from the v2.3.0 schematic
    Vdd: 20, L2: 6.8e-6, L1: 1.9e-6, Cb: 132e-12, C16: 5.6e-9, R13: 10e3, R14: 470, Vtvs: 15, Ilim: 3.2,
    // assumed (not on the schematic)
    RL2: 0.03,        // choke DCR, ohm
    Rc: 0.12,         // AC resistance of the 2 turn PCB coil at ~10 MHz incl. proximity, ohm
    Coss: 2.4e-9,     // effective large signal drain capacitance (Coss is strongly nonlinear); calibrated so that
                      // the model draws about 60 W at 20 V, as the schematic note '20 V @ 3.1 A typical' says
    Ciss: 2.4e-9,     // gate capacitance of the two FETs, F (adds to C16)
    Ron: 0.05,        // two FETs in parallel, ohm
    Vth: 3.5, Vbias: 3.6, Kp: 25,   // square law constant of the pair, A/V2 (from gfs); RV2 sets the bias a little above Vth
    // geometry, mm
    coilTurns: [[54, 0.0], [54, 1.6]],   // [radius, z] of the two turns (one per PCB layer)
    Rring: 45, aring: 8, zring: 8,       // plasma ring major radius, minor radius, height above the coil
    globeR: 65, globeZ: 35,
    // gas
    p_torr: 15,       // fill pressure from the sky-guided README (1 L globe at 15 torr)
    Tg: 450,          // gas temperature, K
    K0ion: 0.58e-4,   // reduced mobility of Xe+ in Xe, m2/(V s)
    // radiation split of the excitation power (assumptions; measure them with the photodiode and spectrometer)
    fRad: 0.7,        // share of the excitation energy that leaves as photons (rest: quenching, metastables to the wall)
    fVUV: 0.60, fNIR: 0.35, fVIS: 0.05, tGlassVis: 0.90, tGlassNIR: 0.90, Vbar: 0.12,
    // board overhead
    Pboard: 0.35, buckRdrop: 0.15,
  };

  /* ---------------- elliptic integrals and loop fields ---------------- */
  function ellipKE(m) {          // complete K(m), E(m), m = k^2, by the arithmetic geometric mean
    if (m >= 1) m = 1 - 1e-15;
    let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m), s = 0.5 * m, w = 0.5;
    for (let i = 0; i < 40 && Math.abs(c) > 1e-15; i++) {
      const an = 0.5 * (a + b), bn = Math.sqrt(a * b); c = 0.5 * (a - b); w *= 2; s += w * c * c; a = an; b = bn;
    }
    const K = Math.PI / (2 * a); return [K, K * (1 - s)];
  }
  // field of one circular loop: radius a (m) at height z0 (m), current I (A); point (r, z) in m. Returns [Br, Bz, Aphi]
  function loopField(a, z0, I, r, z) {
    const zeta = z - z0, rr = Math.max(r, 1e-9);
    const al2 = a * a + rr * rr + zeta * zeta - 2 * a * rr, be2 = a * a + rr * rr + zeta * zeta + 2 * a * rr;
    const be = Math.sqrt(be2), m = 1 - al2 / be2, [K, E] = ellipKE(m), C = MU0 * I / Math.PI;
    const al2s = Math.max(al2, 1e-14);
    const Bz = C / (2 * al2s * be) * ((a * a - rr * rr - zeta * zeta) * E + al2s * K);
    const Br = r < 1e-7 ? 0 : C * zeta / (2 * al2s * be * rr) * ((a * a + rr * rr + zeta * zeta) * E - al2s * K);
    const k = Math.sqrt(m);
    const A = k < 1e-6 ? 0 : MU0 * I / (Math.PI * k) * Math.sqrt(a / rr) * ((1 - m / 2) * K - E);
    return [Br, Bz, A];
  }
  function mutual(a1, z1, a2, z2) {        // two coaxial filaments, m
    const m = 4 * a1 * a2 / ((a1 + a2) ** 2 + (z1 - z2) ** 2), k = Math.sqrt(m), [K, E] = ellipKE(m);
    return MU0 * Math.sqrt(a1 * a2) * ((2 / k - k) * K - 2 / k * E);
  }
  function ringSelfL(R, a) { return MU0 * R * (Math.log(8 * R / a) - 1.75); }
  function coilRingM(P, Rr, zr) {          // coil (all turns) to plasma ring, H; Rr, zr in mm
    let M = 0; for (const [rc, zc] of P.coilTurns) M += mutual(rc * 1e-3, zc * 1e-3, Rr * 1e-3, zr * 1e-3); return M;
  }

  /* ---------------- xenon cross sections (approximate, see notes) ---------------- */
  // momentum transfer: shape of the Biagi/Hayashi data (Ramsauer minimum near 0.6 eV), log-log interpolation, m2
  const SM = [[0.01, 6e-19], [0.1, 1.2e-19], [0.3, 2.2e-20], [0.6, 1.5e-21], [1, 8e-21], [2, 5e-20], [4, 1.7e-19],
              [6, 2.3e-19], [10, 1.6e-19], [20, 9e-20], [50, 4e-20], [200, 1.5e-20]];
  function sigmaM(E) {
    if (E <= SM[0][0]) return SM[0][1];
    for (let i = 1; i < SM.length; i++) if (E <= SM[i][0]) {
      const [e0, s0] = SM[i - 1], [e1, s1] = SM[i], t = Math.log(E / e0) / Math.log(e1 / e0);
      return Math.exp(Math.log(s0) + t * Math.log(s1 / s0));
    }
    return SM[SM.length - 1][1];
  }
  const EIZ = 12.13, EEX = 8.32;
  function sigmaIz(E) { return E <= EIZ ? 0 : 4.5e-18 * 6 * Math.log(E / EIZ) / (E * EIZ); }   // Lotz, q = 6 (5p6), m2
  function sigmaEx(E) { return E <= EEX ? 0 : 8e-20 * Math.log(E / EEX) / (E / EEX); }          // lumped 5p5 6s,6p levels, m2
  // Maxwellian rate coefficient K(Te) = integral sigma(E) v(E) f(E) dE, Te in eV
  function rate(sigma, Te, n = 1500) {
    const Emax = Math.max(60, 30 * Te), h = Emax / n; let s = 0;
    for (let i = 1; i <= n; i++) {
      const E = i * h, f = 2 * Math.sqrt(E / Math.PI) * Math.pow(Te, -1.5) * Math.exp(-E / Te), v = Math.sqrt(2 * QE * E / ME);
      s += (i === n ? 0.5 : 1) * sigma(E) * v * f;
    }
    return s * h;
  }
  function integrand(sigma, Te, n = 240) {   // for plotting the calculus: points of sigma v f
    const Emax = Math.max(60, 30 * Te), out = [];
    for (let i = 1; i <= n; i++) {
      const E = i * Emax / n, f = 2 * Math.sqrt(E / Math.PI) * Math.pow(Te, -1.5) * Math.exp(-E / Te), v = Math.sqrt(2 * QE * E / ME);
      out.push([E, sigma(E) * v * f, f, sigma(E)]);
    }
    return out;
  }

  /* ---------------- 0D plasma model ---------------- */
  function plasmaModel(P, Pabs, omega, neFixed) {
    const ng = P.p_torr * 133.322 / (KB * P.Tg);
    const R = P.Rring * 1e-3, a = P.aring * 1e-3, V = 2 * Math.PI ** 2 * R * a * a, A = 4 * Math.PI ** 2 * R * a;
    const Lam = a / 2.405, mui = P.K0ion * N0 / ng;
    const lossFreq = (Te) => { const uB = Math.sqrt(QE * Te / MXE), Da = mui * Te; return 1 / (Lam * Lam / Da + (V / A) / uB); };
    // particle balance: ng Kiz(Te) = loss frequency
    let lo = 0.3, hi = 12;
    for (let i = 0; i < 60; i++) { const Te = 0.5 * (lo + hi); (ng * rate(sigmaIz, Te) > lossFreq(Te)) ? hi = Te : lo = Te; }
    const Te = 0.5 * (lo + hi);
    const Kiz = rate(sigmaIz, Te), Kex = rate(sigmaEx, Te), Km = rate(sigmaM, Te);
    const epsI = Te * (0.5 + Math.log(Math.sqrt(MXE / (2 * Math.PI * ME))));
    const eIz = EIZ, eEx = EEX * Kex / Kiz, eEl = 3 * ME / MXE * (Te - KB * P.Tg / QE) * Km / Kiz, eW = 2 * Te + epsI;
    const epsT = eIz + eEx + eEl + eW;
    const Rpair = Math.max(Pabs, 0) / (QE * epsT);                  // electron ion pairs per second
    const ne = neFixed ?? Rpair / (ng * Kiz * V);
    const nu = ng * Km, sig = ne * QE * QE / (ME * nu);
    const delta = omega > 0 && sig > 0 ? Math.sqrt(2 / (omega * MU0 * sig)) * Math.sqrt(1 + (omega / nu) ** 2) : Infinity;
    const Aeff = delta >= a ? Math.PI * a * a : Math.PI * a * a - Math.PI * (a - delta) ** 2;
    const Rp = sig > 0 ? 2 * Math.PI * R / (sig * Aeff) : 1e6;
    const Le = Rp / nu;                                             // electron inertia inductance
    const wpe = Math.sqrt(ne * QE * QE / (EPS0 * ME));
    const split = { iz: Rpair * QE * eIz, ex: Rpair * QE * eEx, el: Rpair * QE * eEl, wall: Rpair * QE * eW };
    return { ng, Te, Kiz, Kex, Km, ne, nu, sig, delta, Rp, Le, wpe, epsT, eps: { iz: eIz, ex: eEx, el: eEl, wall: eW, ion: epsI },
             split, V, A, lossFreq: lossFreq(Te), mui };
  }

  /* ---------------- driver circuit ---------------- */
  function sigm(x) { return 1 / (1 + Math.exp(-x)); }
  function makeCircuit(P, plasma) {
    const Cg = P.C16 + P.Ciss, M = plasma ? plasma.M : 0, Lp = plasma ? plasma.Lp : 1, Rp = plasma ? plasma.Rp : 0;
    const det = P.L1 * Lp - M * M, on = !!plasma;
    function dev(Vg, Vd) {                                            // square law channel, smooth limit by Ron, body diode
      const vov = Math.max(Vg - P.Vth, 0), Isat = P.Kp * vov * vov;
      let I = 0;
      if (Isat > 0) { const Ilin = Math.abs(Vd) / P.Ron; I = Math.sign(Vd) * Ilin * Isat / Math.sqrt(Ilin * Ilin + Isat * Isat + 1e-30); }
      if (Vd < -0.7) I += (Vd + 0.7) / 0.02;
      return I;
    }
    function tvs(Vg) { const x = Math.abs(Vg) - P.Vtvs; return x > 0 ? Math.sign(Vg) * x / P.R14 : 0; }
    // y = [I2, Vd, I1, Ip, Vcb, Vg]
    function f(y, Vdd, out) {
      const [I2, Vd, I1, Ip, Vcb, Vg] = y, Vhv = Vcb + Vg, Id = dev(Vg, Vd);
      out[0] = (Vdd - Vd - P.RL2 * I2) / P.L2;
      out[1] = (I2 - I1 - Id) / P.Coss;
      const v1 = Vd - Vhv - P.Rc * I1;
      if (on) { const v2 = -Rp * Ip; out[2] = (Lp * v1 - M * v2) / det; out[3] = (P.L1 * v2 - M * v1) / det; }
      else { out[2] = v1 / P.L1; out[3] = 0; }
      out[4] = I1 / P.Cb;
      out[5] = (I1 - (Vg - P.Vbias) / P.R13 - tvs(Vg)) / Cg;
    }
    function stored(y) {
      const [I2, Vd, I1, Ip, Vcb, Vg] = y;
      return 0.5 * P.L2 * I2 * I2 + 0.5 * P.Coss * Vd * Vd + 0.5 * P.L1 * I1 * I1 + (on ? M * I1 * Ip + 0.5 * Lp * Ip * Ip : 0)
             + 0.5 * P.Cb * Vcb * Vcb + 0.5 * Cg * Vg * Vg;
    }
    function powers(y, Vdd) {
      const [I2, Vd, I1, Ip, Vcb, Vg] = y, Id = dev(Vg, Vd), Ib = (P.Vbias - Vg) / P.R13;
      return { in: Vdd * I2, bias: P.Vbias * Ib, choke: P.RL2 * I2 * I2, fet: Id * Vd, coil: P.Rc * I1 * I1,
               plasma: on ? Rp * Ip * Ip : 0, gate: Ib * Ib * P.R13 + tvs(Vg) * Vg };
    }
    return { f, stored, powers, dev, tvs, Cg, M, Lp, Rp };
  }
  // implicit trapezoidal step with Newton iterations: the drain node is stiff (Ron Coss ~ 13 ps) so explicit RK4 would need
  // a time step 10x smaller. y_{n+1} = y_n + dt/2 (f(y_n) + f(y_{n+1})), Jacobian by finite differences.
  function trapStep(c, y, dt, Vdd, ws) {
    const n = y.length, { f0, f1, yk, J, r, tmp } = ws;
    c.f(y, Vdd, f0);
    for (let i = 0; i < n; i++) yk[i] = y[i] + dt * f0[i];            // explicit Euler predictor
    for (let it = 0; it < 6; it++) {
      c.f(yk, Vdd, f1);
      let norm = 0;
      for (let i = 0; i < n; i++) { r[i] = yk[i] - y[i] - 0.5 * dt * (f0[i] + f1[i]); norm += Math.abs(r[i]) / (1 + Math.abs(yk[i])); }
      if (norm < 1e-11) break;
      for (let j = 0; j < n; j++) {                                    // J = I - dt/2 df/dy
        const h = 1e-7 * (1 + Math.abs(yk[j])), keep = yk[j]; yk[j] = keep + h; c.f(yk, Vdd, tmp); yk[j] = keep;
        for (let i = 0; i < n; i++) J[i * n + j] = (i === j ? 1 : 0) - 0.5 * dt * (tmp[i] - f1[i]) / h;
      }
      solve(J, r, n);                                                  // r <- J^-1 r
      for (let i = 0; i < n; i++) yk[i] -= r[i];
    }
    for (let i = 0; i < n; i++) y[i] = yk[i];
  }
  function solve(A, b, n) {                                            // Gaussian elimination with partial pivoting, in place
    for (let c = 0; c < n; c++) {
      let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(A[i * n + c]) > Math.abs(A[p * n + c])) p = i;
      if (p !== c) { for (let j = 0; j < n; j++) { const t = A[c * n + j]; A[c * n + j] = A[p * n + j]; A[p * n + j] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
      for (let i = c + 1; i < n; i++) { const m = A[i * n + c] / A[c * n + c]; if (!m) continue; for (let j = c; j < n; j++) A[i * n + j] -= m * A[c * n + j]; b[i] -= m * b[c]; }
    }
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j]; b[i] = s / A[i * n + i]; }
  }
  function wsbuf(n) { const F = () => new Float64Array(n); return { f0: F(), f1: F(), yk: F(), r: F(), tmp: F(), J: new Float64Array(n * n) }; }

  // run the circuit from rest for T seconds; ledger integrates every power with the trapezoid rule
  function runCircuit(P, plasma, T = 40e-6, dt = 0.2e-9, recordFrom = null, Vdd = P.Vdd) {
    const c = makeCircuit(P, plasma), y = new Float64Array([0, 0, 0, 0, 0, P.Vbias]), ws = wsbuf(6);
    y[1] = 0.01;   // a small kick starts the oscillator
    const N = Math.round(T / dt), rec = [], W0 = c.stored(y);
    const keys = ['in', 'bias', 'choke', 'fet', 'coil', 'plasma', 'gate'];
    const E = Object.fromEntries(keys.map((x) => [x, 0])), Ew = Object.fromEntries(keys.map((x) => [x, 0]));
    const t0w = recordFrom ?? T - 5e-6; let p0 = c.powers(y, Vdd), tw = 0, acc = 0, Wst = null;
    for (let i = 1; i <= N; i++) {
      trapStep(c, y, dt, Vdd, ws);
      const p1 = c.powers(y, Vdd), t = i * dt;
      for (const x of keys) { const e = 0.5 * (p0[x] + p1[x]) * dt; E[x] += e; if (t > t0w) Ew[x] += e; }
      if (t > t0w) {
        const net = 0.5 * ((p0.in + p0.bias - p0.choke - p0.fet - p0.coil - p0.plasma - p0.gate) + (p1.in + p1.bias - p1.choke - p1.fet - p1.coil - p1.plasma - p1.gate)) * dt;
        const Wn = c.stored(y); if (Wst === null) Wst = Wn; acc += net;
        tw += dt; rec.push([t, y[0], y[1], y[2], y[3], y[4], y[5], acc, Wn - Wst]);
      }
      p0 = p1;
    }
    const W1 = c.stored(y);
    const avg = Object.fromEntries(keys.map((x) => [x, Ew[x] / tw]));
    const residual = (E.in + E.bias) - (E.choke + E.fet + E.coil + E.plasma + E.gate) - (W1 - W0);
    return { y, rec, avg, E, W0, W1, residual, circuit: c };
  }
  // frequency, amplitudes and phasors at the fundamental from a record [t, I2, Vd, I1, Ip, Vcb, Vg]
  function analyse(rec) {
    const t = rec.map((r) => r[0]), I1 = rec.map((r) => r[3]);
    const zc = []; for (let i = 1; i < I1.length; i++) if (I1[i - 1] < 0 && I1[i] >= 0) zc.push(t[i - 1] + (t[i] - t[i - 1]) * (-I1[i - 1]) / (I1[i] - I1[i - 1]));
    const f = zc.length > 2 ? (zc.length - 1) / (zc[zc.length - 1] - zc[0]) : 0, w = 2 * Math.PI * f;
    const ph = (col) => { let re = 0, im = 0; const i0 = rec.findIndex((r) => r[0] >= zc[0]), i1 = rec.findIndex((r) => r[0] >= zc[zc.length - 1]);
      for (let i = i0; i < i1; i++) { const r = rec[i], dt = rec[i + 1][0] - r[0]; re += r[col] * Math.cos(w * r[0]) * dt; im -= r[col] * Math.sin(w * r[0]) * dt; }
      const T = rec[i1][0] - rec[i0][0]; return [2 * re / T, 2 * im / T]; };
    const pk = (col) => Math.max(...rec.map((r) => Math.abs(r[col])));
    const rms = (col) => Math.sqrt(rec.reduce((s, r) => s + r[col] * r[col], 0) / rec.length);
    const mean = (col) => rec.reduce((s, r) => s + r[col], 0) / rec.length;
    const Vhv = rec.map((r) => r[5] + r[6]);
    return { f, w, I1ph: zc.length > 2 ? ph(3) : [0, 0], Ipph: zc.length > 2 ? ph(4) : [0, 0],
             pk: { Vd: pk(2), I1: pk(3), Ip: pk(4), Vg: pk(6), Vhv: Math.max(...Vhv.map(Math.abs)) },
             rms: { I1: rms(3), Ip: rms(4), I2: rms(1) }, mean: { I2: mean(1), Vg: mean(6) } };
  }

  /* ---------------- operating point: circuit <-> plasma iteration ---------------- */
  function operatingPoint(P, opts = {}) {
    const mode = opts.mode ?? 'H';          // 'off' | 'H'
    const Lgeom = ringSelfL(P.Rring * 1e-3, P.aring * 1e-3), M = coilRingM(P, P.Rring, P.zring);
    let Pabs = opts.Pguess ?? 30, pm = null, run = null, an = null, Vdd = P.Vdd, hist = [];
    const iters = mode === 'off' ? 1 : mode === 'E' ? 2 : (opts.iters ?? 8);
    for (let it = 0; it < iters; it++) {
      let plasma = null;
      if (mode !== 'off') {
        pm = plasmaModel(P, Pabs, an ? an.w : 2 * Math.PI * 12e6, mode === 'E' ? (opts.neE ?? 3e16) : undefined);
        plasma = { M, Lp: Lgeom + pm.Le, Rp: pm.Rp };
      }
      run = runCircuit(P, plasma, opts.T ?? 30e-6, opts.dt ?? 0.25e-9, null, Vdd);
      an = analyse(run.rec);
      // adjustable current limit: the buck lowers Vdrive until the average input current is at the limit
      if (run.avg.in / Vdd > P.Ilim * 1.02) Vdd = Math.max(5, Vdd * Math.sqrt(P.Ilim / (run.avg.in / Vdd)));
      const Pnew = run.avg.plasma; hist.push({ it, Pabs, Pnew, ne: pm ? pm.ne : 0, Vdd });
      if (mode === 'off') break;
      Pabs = 0.5 * Pabs + 0.5 * Pnew;
    }
    if (mode !== 'off') pm = plasmaModel(P, run.avg.plasma, an.w, mode === 'E' ? (opts.neE ?? 3e16) : undefined);
    // forces on the ring: F = 1/2 Re(Ip I1*) grad M ; hoop force from the self inductance
    let force = null;
    if (mode !== 'off') {
      const [a1r, a1i] = an.I1ph, [apr, api] = an.Ipph, re = apr * a1r + api * a1i;   // Re(Ip I1*)
      const dz = 0.05, dMdz = (coilRingM(P, P.Rring, P.zring + dz) - coilRingM(P, P.Rring, P.zring - dz)) / (2 * dz * 1e-3);
      const dMdR = (coilRingM(P, P.Rring + dz, P.zring) - coilRingM(P, P.Rring - dz, P.zring)) / (2 * dz * 1e-3);
      const Ip2 = 0.5 * (apr * apr + api * api);
      const dLdR = (ringSelfL((P.Rring + dz) * 1e-3, P.aring * 1e-3) - ringSelfL((P.Rring - dz) * 1e-3, P.aring * 1e-3)) / (2 * dz * 1e-3);
      force = { Fz: 0.5 * re * dMdz, FR: 0.5 * re * dMdR + 0.5 * Ip2 * dLdR, dMdz, dMdR, reIpI1: re };
    }
    // energy ledger from the wall plug to light
    const Pdrv = run.avg.in, Iin = Pdrv / Vdd;
    const buck = P.buckRdrop * Iin * Iin + (P.Vdd - Vdd) * Iin * 0.08;
    const Pwall = Pdrv + buck + P.Pboard + Math.max(run.avg.bias, 0);
    let light = null;
    if (pm) {
      const Pex = pm.split.ex * P.fRad, Pq = pm.split.ex * (1 - P.fRad);
      const vuv = Pex * P.fVUV, nir = Pex * P.fNIR, vis = Pex * P.fVIS;
      light = { Pex, Pq, vuv, nir, vis, visOut: vis * P.tGlassVis, nirOut: nir * P.tGlassNIR,
                lumens: vis * P.tGlassVis * 683 * P.Vbar };
    }
    return { mode, P, Vdd, run, an, pm, M, Lgeom, k: M / Math.sqrt(P.L1 * (Lgeom + (pm ? pm.Le : 0))), force, Pwall, buck, light, hist };
  }

  /* ---------------- fields on a grid (for the 3D view and the cross sections) ---------------- */
  // returns phasor fields at (r, z) in m: B = [Br, Bz] complex parts, Ephi complex, from the coil and the ring
  function fieldAt(P, op, r, z) {
    const out = { Br: [0, 0], Bz: [0, 0], A: [0, 0] };
    const add = (a, z0, Ic) => { for (const part of [0, 1]) { const [br, bz, A] = loopField(a, z0, Ic[part], r, z); out.Br[part] += br; out.Bz[part] += bz; out.A[part] += A; } };
    for (const [rc, zc] of P.coilTurns) add(rc * 1e-3, zc * 1e-3, op.an.I1ph);
    if (op.mode !== 'off') add(P.Rring * 1e-3, P.zring * 1e-3, op.an.Ipph);
    const w = op.an.w;   // E = -dA/dt -> phasor -j w A
    out.E = [w * out.A[1], -w * out.A[0]];
    return out;
  }


  /* ---------------- worker friendly result (also used on the main thread when workers are blocked, e.g. file://) ---------------- */
  function runSlim(P, mode) {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), t0 = now();
    const op = operatingPoint(P, { mode });
    const fOff = mode === 'off' ? op.an.f : operatingPoint(P, { mode: 'off', T: 20e-6 }).an.f;
    const rec = op.run.rec, keep = [], step = Math.max(1, Math.floor(rec.length / 2400));
    for (let i = 0; i < rec.length; i += step) keep.push(rec[i]);
    return { mode: op.mode, Vdd: op.Vdd, M: op.M, Lgeom: op.Lgeom, k: op.k, force: op.force, Pwall: op.Pwall, buck: op.buck, hist: op.hist,
             pm: op.pm, an: op.an, avg: op.run.avg, E: op.run.E, residual: op.run.residual, y: Array.from(op.run.y), rec: keep, ms: now() - t0, fOff };
  }


  /* ---------------- donut (torus) surface calculus ---------------- */
  // surface x(th, ph) = ((R0 + a cos th) cos ph, (R0 + a cos th) sin ph, z0 + a sin th); n = (cos th cos ph, cos th sin ph, sin th)
  // time averaged force density from the coil field on the plasma current J_phi = Ip / (pi a^2):  f = J x B  ->  f_r = Re(J Bz*)/2, f_z = -Re(J Br*)/2
  function torusSurface(P, op, n = 181) {
    const R0 = P.Rring * 1e-3, a = P.aring * 1e-3, z0 = P.zring * 1e-3, Ip = op.an.Ipph, A0 = Math.PI * a * a, J = [Ip[0] / A0, Ip[1] / A0];
    const opC = { mode: 'off', an: op.an }, rows = [];
    for (let i = 0; i < n; i++) {
      const th = 2 * Math.PI * i / (n - 1), r = R0 + a * Math.cos(th), z = z0 + a * Math.sin(th), f = fieldAt(P, opC, r, z);
      const fr = 0.5 * (J[0] * f.Bz[0] + J[1] * f.Bz[1]), fz = -0.5 * (J[0] * f.Br[0] + J[1] * f.Br[1]);
      const fn = fr * Math.cos(th) + fz * Math.sin(th), ft = -fr * Math.sin(th) + fz * Math.cos(th);
      const Bc = Math.sqrt(0.5 * (f.Br[0] ** 2 + f.Br[1] ** 2 + f.Bz[0] ** 2 + f.Bz[1] ** 2));
      rows.push({ th, r, z, fr, fz, fn, ft, Bc });
    }
    const Ipk = Math.hypot(Ip[0], Ip[1]), Bth = MU0 * Ipk / (2 * Math.PI * a);          // self poloidal field at the surface (peak)
    // checks: surface area by a double integral, net force by a volume integral over the cross section (weight 2 pi r)
    let Anum = 0; const m = 400;
    for (let i = 0; i < m; i++) { const th = 2 * Math.PI * (i + 0.5) / m; Anum += a * (R0 + a * Math.cos(th)) * (2 * Math.PI / m) * 2 * Math.PI; }
    let Fz = 0, Fr = 0; const nr = 24, nt = 48;
    for (let i = 0; i < nr; i++) for (let j = 0; j < nt; j++) {
      const rho = a * (i + 0.5) / nr, th = 2 * Math.PI * (j + 0.5) / nt, r = R0 + rho * Math.cos(th), z = z0 + rho * Math.sin(th), f = fieldAt(P, opC, r, z);
      const dV = 2 * Math.PI * r * rho * (a / nr) * (2 * Math.PI / nt);
      Fz += -0.5 * (J[0] * f.Br[0] + J[1] * f.Br[1]) * dV; Fr += 0.5 * (J[0] * f.Bz[0] + J[1] * f.Bz[1]) * dV;
    }
    return { rows, R0, a, z0, Ipk, Jpk: Ipk / A0, Bth, pB: Bth * Bth / (4 * MU0), A: 4 * Math.PI ** 2 * R0 * a, Anum, V: 2 * Math.PI ** 2 * R0 * a * a, Fz, Fr };
  }
  // irradiance on the inside of the glass sphere from the ring, which emits Prad uniformly along its length and isotropically
  // E(alpha) = integral over the ring of (Prad / 2 pi) / (4 pi d^2) * cos(incidence) dphi'; the PCB and coil are ignored (no shadow)
  function glassIrradiance(P, Prad, n = 121) {
    const R0 = P.Rring * 1e-3, z0 = P.zring * 1e-3, Rg = P.globeR * 1e-3, zc = P.globeZ * 1e-3, out = [], m = 720;
    for (let i = 0; i < n; i++) {
      const al = Math.PI * i / (n - 1), nx = Math.sin(al), nz = Math.cos(al), Sx = Rg * nx, Sz = zc + Rg * nz;
      let E = 0;
      for (let k = 0; k < m; k++) {
        const ph = 2 * Math.PI * (k + 0.5) / m, dx = Sx - R0 * Math.cos(ph), dy = -R0 * Math.sin(ph), dz = Sz - z0, d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
        const c = (dx * nx + dz * nz) / d; if (c > 0) E += (Prad / (2 * Math.PI)) / (4 * Math.PI * d2) * c * (2 * Math.PI / m);
      }
      out.push([al, E]);
    }
    let tot = 0; for (let i = 1; i < out.length; i++) { const a0 = out[i - 1], a1 = out[i]; tot += 0.5 * (a0[1] * Math.sin(a0[0]) + a1[1] * Math.sin(a1[0])) * (a1[0] - a0[0]) * 2 * Math.PI * Rg * Rg; }
    return { rows: out, total: tot, Rg };
  }

  const api = { torusSurface, glassIrradiance, runSlim, DEFAULTS, MU0, QE, ME, MXE, ellipKE, loopField, mutual, ringSelfL, coilRingM, sigmaM, sigmaIz, sigmaEx, rate, integrand,
                plasmaModel, makeCircuit, runCircuit, trapStep, wsbuf, analyse, operatingPoint, fieldAt, EIZ, EEX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PT = api;
})(typeof window !== 'undefined' ? window : globalThis);
