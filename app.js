// Plasma Toroid Lab, paper layout. Physics in physics.js (window.PT); operating points in worker.js when workers are allowed.
(function () {
'use strict';
const PT = window.PT, $ = (s) => document.querySelector(s), NS = 'http://www.w3.org/2000/svg';
const DT = 0.25e-9;
let P = structuredClone(PT.DEFAULTS), mode = 'H', OP = null, running = true, reqId = 0;
const INK = '#1a1a1a', MUTED = '#666', GRID = '#e7e7e7', AX = '#9a9a9a';

/* ---------------- formatting ---------------- */
function si(v, unit, d = 3) { return siRaw(v, unit, d).replace(/^-/, '−'); }
function siRaw(v, unit, d = 3) {
  if (!isFinite(v)) return '–';
  if (v === 0) return '0 ' + unit;
  const a = Math.abs(v), pre = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  for (const [s, p] of pre) if (a >= s * 0.9995 || s === 1e-12) { const x = v / s; return (Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(d)) + ' ' + p + unit; }
  return v.toPrecision(d) + ' ' + unit;
}
const pct = (x) => isFinite(x) ? (100 * x).toFixed(x < 0.1 ? 2 : 1) + ' %' : '–';
const sci = (v, d = 2) => { if (!isFinite(v) || v === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(v))); return ((v / 10 ** e).toFixed(d) + '×10<sup>' + e + '</sup>').replace(/-/g, '−'); };
// a value may appear once per language: write it to the element with that id and to every [data-k] twin (id prefix t- or x- dropped)
const set = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; const k = id.replace(/^[tx]-/, ''); document.querySelectorAll(`[data-k="${k}"]`).forEach((x) => { x.innerHTML = html; }); };
const LANG = () => document.documentElement.dataset.lang === 'en' ? 'en' : 'th';
const tr = (th, en) => LANG() === 'en' ? en : th;
// equation numbers in document order, read from the raw TeX before MathJax replaces it (tags: 'all' numbers every display)
const EQN = {}; { let n = 0; document.querySelectorAll('.eq').forEach((e) => { n++; const m = /\\label\{([^}]+)\}/.exec(e.textContent); if (m) EQN[m[1]] = n; }); }
const eqn = (l) => `${tr('สมการ', 'Eq.')} (${EQN[l] || '?'})`;
const deg = (x) => (((x * 180 / Math.PI) % 360) + 360) % 360;

/* ---------------- operating point: worker, or main thread when workers are blocked (file://) ---------------- */
let worker = null;
try { worker = new Worker('worker.js'); worker.onerror = () => { worker = null; compute(); }; worker.onmessage = (ev) => { if (ev.data.id === reqId) accept(ev.data.op); }; }
catch (e) { worker = null; }
function accept(op) { OP = op; $('#busy').textContent = tr(`จุดทำงานพร้อม (${OP.ms.toFixed(0)} ms)`, `operating point ready (${OP.ms.toFixed(0)} ms)`); initLive(false); updateAll(); if (window.SCH) SCH.sync(); }
function compute() {
  reqId++; $('#busy').textContent = tr('กำลังคำนวณจุดทำงาน…', 'computing operating point…');
  const m = mode === 'strike' ? 'off' : mode;
  if (worker) worker.postMessage({ P, mode: m, id: reqId });
  else setTimeout(() => accept(PT.runSlim(P, m)), 30);
}

/* ---------------- live circuit ---------------- */
const live = { c: null, y: null, ws: PT.wsbuf(6), t: 0, Q: {}, buf: [], Vdd: 20 };
function initLive(fromRest) {
  const plasma = (mode === 'E' || mode === 'H') && OP.pm ? { M: OP.M, Lp: OP.Lgeom + OP.pm.Le, Rp: OP.pm.Rp } : null;
  live.c = PT.makeCircuit(P, plasma); live.Vdd = OP.Vdd; live.t = 0; live.buf = []; live.Q = {};
  live.y = fromRest ? new Float64Array([0, 0.01, 0, 0, 0, P.Vbias]) : Float64Array.from(OP.y);
}
function sample() {
  const [I2, Vd, I1, Ip, Vcb, Vg] = live.y, c = live.c;
  const Id = c.dev(Vg, Vd), Ir13 = (P.Vbias - Vg) / P.R13, Itvs = c.tvs(Vg), Icg = I1 + Ir13 - Itvs;
  return { t: live.t, I2, Vd, I1, Ip, Vcb, Vg, Vhv: Vcb + Vg, Id, Icoss: I2 - I1 - Id, Ir13, Itvs, Ic16: Icg * P.C16 / (P.C16 + P.Ciss), Igate: Icg * P.Ciss / (P.C16 + P.Ciss) };
}
const BR = { in: 'I2', L2: 'I2', dtop: (s) => s.Id + s.Icoss, fet: 'Id', fets: 'Id', coss: 'Icoss', L100: 'I1', cb: 'I1', ring: 'Ip', c16: 'Ic16', tvs: 'Itvs', r13: 'Ir13', gt: (s) => s.Ir13 - s.Itvs, gate: 'Igate' };
const brI = (k, s) => typeof BR[k] === 'function' ? BR[k](s) : s[BR[k]];
function stepLive(n) {
  for (let i = 0; i < n; i++) {
    PT.trapStep(live.c, live.y, DT, live.Vdd, live.ws); live.t += DT;
    const s = sample();
    for (const k in BR) live.Q[k] = (live.Q[k] || 0) + brI(k, s) * DT;
    live.buf.push(s); if (live.buf.length > 2400) live.buf.shift();
  }
}

/* ---------------- Figure 1: KiCad sheet viewer (schem.js) ---------------- */
const schAPI = { get: () => ({ P, OP, mode, running, s: live.buf.length ? live.buf[live.buf.length - 1] : null }), tr: (a, b) => tr(a, b), si: (v, u, d) => si(v, u, d),
  recompute: () => { buildAssump(); compute(); } };

/* ---------------- canvas helpers ---------------- */
function fitCanvas(cv) {
  // height follows the width (data-ar) within [data-min, data-max], so plots keep their proportions on a phone, a tablet and a desktop
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1, ar = +cv.dataset.ar;
  const h = Math.round(ar ? Math.max(+cv.dataset.min || 0, Math.min(+cv.dataset.max || 1e4, r.width * ar)) : +cv.getAttribute('height'));
  if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(h * d); cv.style.height = h + 'px'; }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); return [ctx, r.width, h];
}
const FONT = (px) => `${px}px "LM Roman", "Plex Thai", serif`, MONO = (px) => `${px}px "LM Mono", monospace`;
function axes(g, W, H, x0, x1, y0, y1, lx, ly, ticksX, pad = W < 520 ? { l: 30, r: 10, t: 28, b: 34 } : { l: 58, r: 14, t: 30, b: 34 }) {
  const X = (x) => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r), Y = (y) => H - pad.b - (y - y0) / (y1 - y0) * (H - pad.t - pad.b);
  g.strokeStyle = GRID; g.lineWidth = 1;
  for (const t of ticksX) { g.beginPath(); g.moveTo(X(t), pad.t); g.lineTo(X(t), H - pad.b); g.stroke(); }
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(pad.l + 0.5, pad.t + 0.5, W - pad.l - pad.r, H - pad.t - pad.b);
  g.fillStyle = INK; g.font = FONT(W < 520 ? 12 : 13); g.textAlign = 'center';
  for (const t of (W < 520 ? ticksX.filter((_, i) => i % 2 === 0) : ticksX)) g.fillText(String(+t.toFixed(3)), X(t), H - pad.b + 15);
  g.fillText(lx, (pad.l + W - pad.r) / 2, H - 4); g.textAlign = 'left'; gtext(g, ly, pad.l, pad.t - 8);
  return [X, Y];
}
function gtext(g, s, x, y) {
  const size = parseFloat(g.font) || 13, base = g.font, al = g.textAlign, parts = [];
  s.replace(/([^_]+)|_\{([^}]*)\}|_(.)/g, (m, t, b1, b2) => { parts.push(t !== undefined ? [t, 0] : [b1 !== undefined ? b1 : b2, 1]); return m; });
  const sub = base.replace(/[\d.]+px/, (size * 0.72).toFixed(1) + 'px'), wOf = (p) => { g.font = p[1] ? sub : base; return g.measureText(p[0]).width; };
  const W = parts.reduce((w, p) => w + wOf(p), 0); let cx = al === 'center' ? x - W / 2 : al === 'right' ? x - W : x;
  g.textAlign = 'left'; for (const p of parts) { g.font = p[1] ? sub : base; g.fillText(p[0], cx, y + (p[1] ? size * 0.28 : 0)); cx += g.measureText(p[0]).width; }
  g.font = base; g.textAlign = al;
}
function niceMax(m) { const e = 10 ** Math.floor(Math.log10(m)), f = m / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }

/* ---------------- Figure 2: scope ---------------- */
const TR = [{ k: 'Vd', name: 'V drain', unit: 'V', c: '#c0502b' }, { k: 'Vg', name: 'V gate', unit: 'V', c: '#b58500' }, { k: 'Vhv', name: 'V hv', unit: 'V', c: '#a3245a' },
            { k: 'I1', name: 'I coil', unit: 'A', c: '#7a4a1e' }, { k: 'Ip', name: 'I plasma', unit: 'A', c: '#5a3db3' }, { k: 'I2', name: 'I supply', unit: 'A', c: '#2c5fb8' }];
const trOn = Object.fromEntries(TR.map((t) => [t.k, t.k !== 'I2']));
function buildScopeChk() {
  $('#scopechk').innerHTML = TR.map((t) => `<label><input type="checkbox" data-k="${t.k}" ${trOn[t.k] ? 'checked' : ''}><span class="sw" style="background:${t.c}"></span>${t.name}</label>`).join('');
  $('#scopechk').querySelectorAll('input').forEach((i) => i.onchange = () => { trOn[i.dataset.k] = i.checked; });
}
function drawScope() {
  const cv = $('#scope'), [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const on = TR.filter((t) => trOn[t.k]), n = on.length || 1, lane = (H - 24) / n, buf = live.buf;
  if (buf.length < 2) return;
  const b = buf.slice(-Math.min(buf.length, 1600)), t0 = b[0].t, t1 = b[b.length - 1].t, L = W < 520 ? 76 : 112, R = W - 8, fs = W < 520 ? 12 : 13.5;
  on.forEach((tr, i) => {
    const y0 = 4 + i * lane, mid = y0 + lane / 2; let m = 1e-9; for (const s of b) m = Math.max(m, Math.abs(s[tr.k])); const nice = niceMax(m);
    g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); g.moveTo(L, mid); g.lineTo(R, mid); g.stroke();
    g.strokeStyle = '#cfcfcf'; g.beginPath(); g.moveTo(L, y0 + lane - 0.5); g.lineTo(R, y0 + lane - 0.5); g.stroke();
    g.strokeStyle = tr.c; g.lineWidth = 1.6; g.beginPath();
    b.forEach((s, j) => { const x = L + (s.t - t0) / (t1 - t0) * (R - L), y = mid - s[tr.k] / nice * (lane * 0.42); j ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    g.fillStyle = INK; g.font = FONT(fs); g.fillText(tr.name, 6, mid - 2); g.fillStyle = MUTED; g.font = MONO(fs - 2); g.fillText('±' + si(nice, tr.unit, 2), 6, mid + 12);
  });
  g.fillStyle = MUTED; g.font = FONT(13); g.textAlign = 'right'; g.fillText(tr(`${si(t1 - t0, 's', 3)} ต่อความกว้าง`, `${si(t1 - t0, 's', 3)} full width`), R, H - 6); g.textAlign = 'left';
}
function drawInst() {
  const s = live.buf[live.buf.length - 1]; if (!s) return;
  const rows = [[tr('เวลาจำลอง t', 'simulated time t'), si(s.t, 's')], ['V<sub>drain</sub>', si(s.Vd, 'V')], ['V<sub>gate</sub>', si(s.Vg, 'V')], ['V<sub>hv</sub>', si(s.Vhv, 'V')],
    ['I<sub>coil</sub>', si(s.I1, 'A')], ['I<sub>plasma</sub>', si(s.Ip, 'A')], ['I<sub>supply</sub>', si(s.I2, 'A')], ['I<sub>FET</sub>', si(s.Id, 'A')]];
  $('#inst').innerHTML = `<tr><th>${tr('ปริมาณ', 'Quantity')}</th><th class="n">${tr('ค่า', 'Value')}</th></tr>` + rows.map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join('');
}

/* ---------------- Figure 3: 3D ---------------- */
let T3 = null;
async function initThree() {
  let THREE, OrbitControls;
  try { THREE = await import('three'); ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js')); }
  catch (e) { $('#three').innerHTML = `<p class="note" style="padding:18px">${tr('โหลด three.js ไม่ได้ (ต้องต่ออินเทอร์เน็ต) รูปที่ 4 ยังใช้งานได้', 'three.js could not be loaded (needs a network connection); Figure 4 still works')}</p>`; return; }
  const host = $('#three'), R = new THREE.WebGLRenderer({ antialias: true });
  R.setPixelRatio(devicePixelRatio); R.localClippingEnabled = true; R.setClearColor(0xf7f7f5); host.appendChild(R.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(38, 1, 0.1, 500); cam.position.set(25, 15, 25);
  const ctl = new OrbitControls(cam, R.domElement); ctl.target.set(0, 3, 0); ctl.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.75)); const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(10, 20, 8); scene.add(dl);
  const clip = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)], U = 0.1;
  const coilMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.6, roughness: 0.4 }), coil = new THREE.Group();
  for (const [r, z] of P.coilTurns) { const m = new THREE.Mesh(new THREE.TorusGeometry(r * U, 0.28, 16, 96), coilMat); m.rotation.x = Math.PI / 2; m.position.y = z * U; coil.add(m); }
  scene.add(coil);
  const pcbMat = new THREE.MeshStandardMaterial({ color: 0x2e6b4a, side: THREE.DoubleSide, roughness: 0.8 });
  const pcb = new THREE.Mesh(new THREE.RingGeometry(4.8, 7.4, 6, 1), pcbMat); pcb.rotation.x = -Math.PI / 2; pcb.position.y = -0.2; scene.add(pcb);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(P.globeR * U, 64, 32), new THREE.MeshPhysicalMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.12, roughness: 0.1, depthWrite: false }));
  globe.position.y = P.globeZ * U; scene.add(globe);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8e6ff0, transparent: true, opacity: 0.55 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(P.Rring * U, P.aring * U, 24, 120), ringMat); ring.rotation.x = Math.PI / 2; scene.add(ring);
  const grid = new THREE.PolarGridHelper(16, 12, 8, 64, 0xcfcfcf, 0xe2e2e2); grid.position.y = -0.3; scene.add(grid);
  function arrows(n, color) {
    const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color }), n);
    const head = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.42, 8).translate(0, 0.21, 0), new THREE.MeshBasicMaterial({ color }), n);
    scene.add(shaft); scene.add(head); return { shaft, head };
  }
  const pts = [], fpts = [];
  for (let ip = 0; ip < 6; ip++) { const ph = ip * Math.PI / 3; for (let r = 12; r <= 150; r += 14) for (let z = -48; z <= 132; z += 14) pts.push([r, z, ph]); }
  for (let ip = 0; ip < 24; ip++) { const ph = ip * Math.PI / 12; fpts.push([0, 0, ph]); for (let k = 0; k < 6; k++) fpts.push([0.6 * Math.cos(k * Math.PI / 3), 0.6 * Math.sin(k * Math.PI / 3), ph]); }
  T3 = { THREE, R, scene, cam, ctl, host, globe, ring, ringMat, AB: arrows(pts.length, 0x2457c5), AE: arrows(pts.length, 0x0f8c78), AF: arrows(fpts.length, 0xd2491e),
         pts, fpts, clip, U, mats: [coilMat, globe.material, ringMat, pcbMat], phase: 0, data: null, q: new THREE.Quaternion(), v: new THREE.Vector3(), o: new THREE.Object3D(), up: new THREE.Vector3(0, 1, 0) };
  addEventListener('resize', sizeThree); sizeThree();
}
function sizeThree() { if (!T3) return; const w = T3.host.clientWidth, h = T3.host.clientHeight; T3.R.setSize(w, h); T3.cam.aspect = w / h; T3.cam.updateProjectionMatrix(); }
function fieldData() {
  const op = { mode: OP.mode, an: OP.an }, opCoil = { mode: 'off', an: OP.an }, cache = new Map();
  const at = (r, z) => { const k = r + ',' + z; if (!cache.has(k)) cache.set(k, PT.fieldAt(P, op, r * 1e-3, z * 1e-3)); return cache.get(k); };
  const a = P.aring * 1e-3, Ip = OP.an.Ipph, J = [Ip[0] / (Math.PI * a * a), Ip[1] / (Math.PI * a * a)];
  const F = T3.fpts.map(([u, v, ph]) => { const r = P.Rring + u * P.aring, z = P.zring + v * P.aring, f = PT.fieldAt(P, opCoil, r * 1e-3, z * 1e-3);
    return { r, z, ph, fr: 0.5 * (J[0] * f.Bz[0] + J[1] * f.Bz[1]), fz: -0.5 * (J[0] * f.Br[0] + J[1] * f.Br[1]) }; });
  return { at, F };
}
function setArrow(A, i, pos, dir, len) {
  const T = T3, o = T.o; o.position.set(pos[0], pos[1], pos[2]);
  if (!(len > 0)) { o.scale.set(0, 0, 0); o.updateMatrix(); A.shaft.setMatrixAt(i, o.matrix); A.head.setMatrixAt(i, o.matrix); return; }
  T.v.set(dir[0], dir[1], dir[2]).normalize(); o.quaternion.setFromUnitVectors(T.up, T.v);
  o.scale.set(1, Math.max(len - 0.42, 0.01), 1); o.updateMatrix(); A.shaft.setMatrixAt(i, o.matrix);
  o.position.set(pos[0] + T.v.x * (len - 0.42), pos[1] + T.v.y * (len - 0.42), pos[2] + T.v.z * (len - 0.42)); o.scale.set(1, 1, 1); o.updateMatrix(); A.head.setMatrixAt(i, o.matrix);
}
const loglen = (v, vmin, vmax, L) => !(v > vmin) ? 0 : Math.min(1, Math.log(v / vmin) / Math.log(vmax / vmin)) * L;
function drawThree(dtms) {
  if (!T3 || !OP) return;
  const T = T3; if (!T.data) T.data = fieldData();
  if ($('#spin').checked && running) T.phase += dtms * 0.0012;
  const c = Math.cos(T.phase), s = Math.sin(T.phase), cut = $('#cut').checked, U = T.U;
  for (const m of T.mats) m.clippingPlanes = cut ? T.clip : [];
  T.globe.visible = $('#showGlobe').checked; T.ring.position.y = P.zring * U; T.ring.visible = mode === 'E' || mode === 'H'; T.ringMat.opacity = mode === 'H' ? 0.7 : 0.25;
  const vis = (A, on) => { A.shaft.visible = A.head.visible = on; };
  vis(T.AB, $('#showB').checked); vis(T.AE, $('#showE').checked); vis(T.AF, $('#showF').checked && T.ring.visible);
  let bmax = 0, emax = 0;
  const vals = T.pts.map(([r, z]) => { const f = T.data.at(r, z); bmax = Math.max(bmax, Math.hypot(Math.hypot(...f.Br), Math.hypot(...f.Bz))); emax = Math.max(emax, Math.hypot(...f.E));
    return [f.Br[0] * c - f.Br[1] * s, f.Bz[0] * c - f.Bz[1] * s, f.E[0] * c - f.E[1] * s]; });
  T.pts.forEach(([r, z, ph], i) => {
    const x = r * Math.cos(ph) * U, y = z * U, zz = r * Math.sin(ph) * U, hide = cut && x > 0, inGlass = r * r + (z - P.globeZ) ** 2 < (P.globeR + 2) ** 2, [br, bz, e] = vals[i];
    setArrow(T.AB, i, [x, y, zz], [br * Math.cos(ph), bz, br * Math.sin(ph)], hide ? 0 : loglen(Math.hypot(br, bz), bmax * 2e-3, bmax, 1.5));
    setArrow(T.AE, i, [x, y, zz], [-Math.sin(ph) * Math.sign(e), 0, Math.cos(ph) * Math.sign(e)], hide || !inGlass ? 0 : loglen(Math.abs(e), emax * 5e-3, emax, 1.4));
  });
  let fmax = 0; for (const f of T.data.F) fmax = Math.max(fmax, Math.hypot(f.fr, f.fz));
  T.data.F.forEach((f, i) => { const x = f.r * Math.cos(f.ph) * U, hide = cut && x > 0;
    setArrow(T.AF, i, [x, f.z * U, f.r * Math.sin(f.ph) * U], [f.fr * Math.cos(f.ph), f.fz, f.fr * Math.sin(f.ph)], hide ? 0 : 0.3 + loglen(Math.hypot(f.fr, f.fz), fmax * 0.05, fmax, 1.4)); });
  for (const A of [T.AB, T.AE, T.AF]) { A.shaft.instanceMatrix.needsUpdate = true; A.head.instanceMatrix.needsUpdate = true; }
  T.ctl.update(); T.R.render(T.scene, T.cam);
}

/* ---------------- Figure 4: cross section ---------------- */
let XS = null;
function computeXS() {
  const op = { mode: OP.mode, an: OP.an }, opCoil = { mode: 'off', an: OP.an }, nr = 81, nz = 101, R1 = 160, Z0 = -60, Z1 = 140, B = [], E = [], F = [];
  const a = P.aring, Ip = OP.an.Ipph, J = [Ip[0] / (Math.PI * (a * 1e-3) ** 2), Ip[1] / (Math.PI * (a * 1e-3) ** 2)];
  for (let i = 0; i < nr; i++) for (let j = 0; j < nz; j++) {
    const r = R1 * i / (nr - 1), z = Z0 + (Z1 - Z0) * j / (nz - 1), f = PT.fieldAt(P, op, r * 1e-3, z * 1e-3);
    B.push(Math.sqrt(0.5 * (f.Br[0] ** 2 + f.Br[1] ** 2 + f.Bz[0] ** 2 + f.Bz[1] ** 2))); E.push(Math.sqrt(0.5 * (f.E[0] ** 2 + f.E[1] ** 2)));
    if (op.mode !== 'off' && (r - P.Rring) ** 2 + (z - P.zring) ** 2 < a * a) { const g = PT.fieldAt(P, opCoil, r * 1e-3, z * 1e-3); F.push(Math.hypot(0.5 * (J[0] * g.Bz[0] + J[1] * g.Bz[1]), 0.5 * (J[0] * g.Br[0] + J[1] * g.Br[1]))); }
    else F.push(0);
  }
  XS = { nr, nz, R1, Z0, Z1, B, E, F, op };
}
const RAMP = { B: [255, 255, 255, 31, 79, 160], E: [255, 255, 255, 13, 122, 107], F: [255, 255, 255, 179, 58, 18] };
function ramp(q, t) { const c = RAMP[q], u = Math.max(0, Math.min(1, t)) ** 0.85; return [0, 1, 2].map((k) => Math.round(c[k] + (c[k + 3] - c[k]) * u)); }
function drawXS() {
  if (!XS) return;
  const q = $('#xsq').value, plane = $('#xsp').value, zc = +$('#xsz').value; $('#xszv').textContent = zc + ' mm';
  const cv = $('#xsec'), [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const arr = XS[q], vmax = Math.max(...arr), vmin = vmax * (q === 'F' ? 1e-2 : 1e-4), val = (i, j) => arr[i * XS.nz + j];
  const t = (v) => v > 0 ? Math.log(v / vmin) / Math.log(vmax / vmin) : -1, unit = q === 'B' ? 'T' : q === 'E' ? 'V/m' : 'N/m³';
  if (plane === 'rz') {
    // the field is axisymmetric: draw r from -160 to 160 so the figure is a full vertical cut through the globe
    const nar = W < 520, pad = { l: nar ? 38 : 56, r: nar ? 62 : 118, t: 14, b: 38 }, s = Math.min((W - pad.l - pad.r) / (2 * XS.R1), (H - pad.t - pad.b) / (XS.Z1 - XS.Z0));
    const x0 = pad.l + ((W - pad.l - pad.r) - 2 * XS.R1 * s) / 2, X = (r) => x0 + (r + XS.R1) * s, Y = (z) => pad.t + (XS.Z1 - z) * s;
    const cw = s * XS.R1 / (XS.nr - 1), ch = s * (XS.Z1 - XS.Z0) / (XS.nz - 1);
    for (let i = 0; i < XS.nr; i++) for (let j = 0; j < XS.nz; j++) { const u = t(val(i, j)); if (u < 0) continue; const [r, gg, b] = ramp(q, u); g.fillStyle = `rgb(${r},${gg},${b})`;
      const rr = i * XS.R1 / (XS.nr - 1), zz = XS.Z0 + j * (XS.Z1 - XS.Z0) / (XS.nz - 1);
      g.fillRect(X(rr) - cw / 2, Y(zz) - ch / 2, cw + 0.6, ch + 0.6); g.fillRect(X(-rr) - cw / 2, Y(zz) - ch / 2, cw + 0.6, ch + 0.6); }
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(X(-XS.R1) + 0.5, Y(XS.Z1) + 0.5, 2 * XS.R1 * s, (XS.Z1 - XS.Z0) * s);
    g.strokeStyle = '#999'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(0), Y(XS.Z1)); g.lineTo(X(0), Y(XS.Z0)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#555'; g.lineWidth = 1; g.beginPath(); g.arc(X(0), Y(P.globeZ), P.globeR * s, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = '#b87333'; for (const [r, z] of P.coilTurns) for (const sg of [1, -1]) g.fillRect(X(sg * r) - 6 * s, Y(z + 0.8), 12 * s, 1.6 * s + 1);
    g.strokeStyle = '#2e6b4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(48), Y(-1)); g.lineTo(X(75), Y(-1)); g.moveTo(X(-48), Y(-1)); g.lineTo(X(-75), Y(-1)); g.stroke();
    if (XS.op.mode !== 'off') { g.strokeStyle = '#5a3db3'; g.lineWidth = 1.5; for (const sg of [1, -1]) { g.beginPath(); g.arc(X(sg * P.Rring), Y(P.zring), P.aring * s, 0, 2 * Math.PI); g.stroke(); } }
    if (q === 'B') { const ph = T3 ? T3.phase : 0, c = Math.cos(ph), sn = Math.sin(ph); g.strokeStyle = 'rgba(20,20,20,0.6)'; g.fillStyle = 'rgba(20,20,20,0.6)'; g.lineWidth = 1;
      const st = nar ? 20 : 12, L = nar ? 3.5 : 4.5;
      for (let r = 8; r <= 152; r += st) for (let z = -52; z <= 132; z += st) { const f = PT.fieldAt(P, XS.op, r * 1e-3, z * 1e-3), br = f.Br[0] * c - f.Br[1] * sn, bz = f.Bz[0] * c - f.Bz[1] * sn, m = Math.hypot(br, bz); if (!m) continue;
        for (const sg of [1, -1]) { const x = X(sg * r), y = Y(z), dx = sg * br / m * L, dy = -bz / m * L; g.beginPath(); g.moveTo(x - dx, y - dy); g.lineTo(x + dx, y + dy); g.stroke(); g.beginPath(); g.arc(x + dx, y + dy, 1.2, 0, 7); g.fill(); } } }
    g.fillStyle = INK; g.font = FONT(nar ? 11.5 : 13); g.textAlign = 'center'; for (let r = -160; r <= 160; r += nar ? 80 : 40) g.fillText(r, X(r), Y(XS.Z0) + 16);
    g.fillText('r (mm)', X(0), Y(XS.Z0) + 32); g.textAlign = 'right'; for (let z = -40; z <= 120; z += 40) g.fillText(z, X(-XS.R1) - 6, Y(z) + 4);
    g.save(); g.translate(Math.max(12, X(-XS.R1) - (nar ? 28 : 40)), Y(40)); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('z (mm)', 0, 0); g.restore(); g.textAlign = 'left';
  } else {
    const s = Math.min((W - (W < 520 ? 80 : 140)) / (2 * XS.R1), (H - 40) / (2 * XS.R1)), cx = (W - (W < 520 ? 60 : 120)) / 2, cy = H / 2, j = Math.round((zc - XS.Z0) / (XS.Z1 - XS.Z0) * (XS.nz - 1));
    for (let i = XS.nr - 1; i >= 0; i--) { const u = t(val(i, j)); if (u < 0) continue; const [rr, gg, b] = ramp(q, u); g.fillStyle = `rgb(${rr},${gg},${b})`; g.beginPath(); g.arc(cx, cy, (i * XS.R1 / (XS.nr - 1) + 1) * s, 0, 2 * Math.PI); g.fill(); }
    const gr = Math.sqrt(Math.max(0, P.globeR ** 2 - (zc - P.globeZ) ** 2)); g.strokeStyle = '#555'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, gr * s, 0, 7); g.stroke();
    g.strokeStyle = '#b87333'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 54 * s, 0, 7); g.stroke();
    if (q === 'E') { const ph = T3 ? T3.phase : 0, f = PT.fieldAt(P, XS.op, P.Rring * 1e-3, zc * 1e-3), sg = Math.sign(f.E[0] * Math.cos(ph) - f.E[1] * Math.sin(ph)) || 1; g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.2;
      for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, r = P.Rring * s, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), dx = -Math.sin(a) * 8 * sg, dy = Math.cos(a) * 8 * sg;
        g.beginPath(); g.moveTo(x - dx, y - dy); g.lineTo(x + dx, y + dy); g.stroke(); g.beginPath(); g.arc(x + dx, y + dy, 2, 0, 7); g.fill(); } }
    g.fillStyle = INK; g.font = FONT(13); g.fillText(tr(`ระนาบ z = ${zc} mm, รัศมีภาพ 160 mm`, `plane z = ${zc} mm, image radius 160 mm`), 10, H - 8);
  }
  const nar2 = W < 520, bx = W - (nar2 ? 56 : 104), by0 = 24, bh = H - 70; for (let k = 0; k < bh; k++) { const [r, gg, b] = ramp(q, 1 - k / (bh - 1)); g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(bx, by0 + k, 14, 1.2); }
  g.strokeStyle = INK; g.strokeRect(bx + 0.5, by0 + 0.5, 14, bh); g.fillStyle = INK; g.font = MONO(nar2 ? 9.5 : 11.5);
  g.fillText(si(vmax, unit, 2), bx + 18, by0 + 9); g.fillText(si(Math.sqrt(vmax * vmin), unit, 2), bx + 18, by0 + bh / 2 + 4); g.fillText(si(vmin, unit, 2), bx + 18, by0 + bh);
}

/* ---------------- Figures 5, 6, 7 ---------------- */
function drawFar() {
  const cv = $('#cvFar'); if (!cv || !OP) return; const [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const op = { mode: OP.mode, an: OP.an }, z = (P.zring + P.aring + 4) * 1e-3, w = OP.an.w, N = 160, R1 = 0.15, closed = [], numeric = []; let Phi = [0, 0];
  for (let i = 1; i <= N; i++) {
    const r = R1 * i / N, dr = R1 / N, f = PT.fieldAt(P, op, r, z), fm = PT.fieldAt(P, op, r - dr / 2, z);
    Phi = [Phi[0] + 2 * Math.PI * (r - dr / 2) * fm.Bz[0] * dr, Phi[1] + 2 * Math.PI * (r - dr / 2) * fm.Bz[1] * dr];
    closed.push([r * 1e3, Math.hypot(...f.E) / Math.SQRT2]); numeric.push([r * 1e3, w * Math.hypot(...Phi) / (2 * Math.PI * r) / Math.SQRT2]);
  }
  const ymax = niceMax(Math.max(...closed.map((p) => p[1]))), [X, Y] = axes(g, W, H, 0, 150, 0, ymax, 'r (mm)', tr(`E_φ rms (V/m), สเกลเต็ม ${si(ymax, 'V/m', 2)}`, `E_φ rms (V/m), full scale ${si(ymax, 'V/m', 2)}`), [0, 25, 50, 75, 100, 125, 150]);
  const ln = (arr, col, dash) => { g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); arr.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); g.setLineDash([]); };
  g.strokeStyle = '#5a3db3'; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(P.Rring), Y(0)); g.lineTo(X(P.Rring), Y(ymax)); g.stroke(); g.setLineDash([]);
  ln(closed, '#0f8c78', []); ln(numeric, '#c0502b', [6, 5]);
}
function drawEn() {
  const cv = $('#cvEn'); if (!cv || !OP || !OP.rec.length) return; const [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const rec = OP.rec.slice(-700), t0 = rec[0][0], t1 = rec[rec.length - 1][0];
  const A = rec.map((r) => [(r[0] - t0) * 1e9, r[7] - rec[0][7]]), Wd = rec.map((r) => [(r[0] - t0) * 1e9, r[8] - rec[0][8]]);
  const ys = [...A, ...Wd].map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), span = (t1 - t0) * 1e9, step = niceMax(span / 6);
  const ticks = []; for (let x = 0; x <= span + 1e-9; x += step) ticks.push(x);
  const [X, Y] = axes(g, W, H, 0, span, lo, hi, 't (ns)', tr(`พลังงาน (J), ช่วง ${si(hi - lo, 'J', 2)}`, `energy (J), span ${si(hi - lo, 'J', 2)}`), ticks);
  const ln = (arr, col, dash) => { g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); arr.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); g.setLineDash([]); };
  ln(A, '#2c5fb8', []); ln(Wd, '#c0502b', [6, 5]);
}
function drawK() {
  const cv = $('#cvK'); if (!cv) return; const Te = +$('#teS').value, [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const Em = 40, iz = PT.integrand(PT.sigmaIz, Te, 320).filter((p) => p[0] <= Em), ex = PT.integrand(PT.sigmaEx, Te, 320).filter((p) => p[0] <= Em);
  const yI = Math.max(...ex.map((p) => p[1]), ...iz.map((p) => p[1])) || 1, fmax = Math.max(...iz.map((p) => p[2]));
  const [X, Y] = axes(g, W, H, 0, Em, 0, 1.05, 'ε (eV)', tr('แต่ละเส้นปรับสเกลให้ยอดเท่ากับ 1', 'each curve scaled to a peak of 1'), [0, 5, 10, 15, 20, 25, 30, 35, 40]);
  const line = (arr, fy, col, fill) => { g.beginPath(); arr.forEach((p, i) => { const x = X(p[0]), y = Y(fy(p)); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    if (fill) { g.lineTo(X(arr[arr.length - 1][0]), Y(0)); g.lineTo(X(arr[0][0]), Y(0)); g.closePath(); g.fillStyle = fill; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 1.8; g.stroke(); } };
  line(ex, (p) => p[1] / yI, null, 'rgba(90,61,179,0.25)'); line(iz, (p) => p[1] / yI, null, 'rgba(192,80,43,0.45)');
  line(iz, (p) => p[2] / fmax, '#2c5fb8'); line(iz, (p) => p[3] / 6e-20, '#c0502b'); line(ex, (p) => p[3] / 6e-20, '#5a3db3');
  set('teV', `$T_e$ = ${Te.toFixed(2)} eV, K<sub>iz</sub> = ${sci(PT.rate(PT.sigmaIz, Te))}, K<sub>ex</sub> = ${sci(PT.rate(PT.sigmaEx, Te))}, K<sub>m</sub> = ${sci(PT.rate(PT.sigmaM, Te))} m³/s`.replace('$T_e$', 'T<sub>e</sub>'));
}

/* ---------------- energy ---------------- */
function lightCalc() {
  if (!OP || !OP.pm) return null;
  const s = OP.pm.split, sum = P.fVUV + P.fNIR + P.fVIS || 1, Pex = s.ex * P.fRad, q = s.ex * (1 - P.fRad);
  const vuv = Pex * P.fVUV / sum, nir = Pex * P.fNIR / sum, vis = Pex * P.fVIS / sum;
  return { Pex, q, vuv, nir, vis, visOut: vis * P.tGlassVis, visIn: vis * (1 - P.tGlassVis), nirOut: nir * P.tGlassNIR, nirIn: nir * (1 - P.tGlassNIR), lm: vis * P.tGlassVis * 683 * P.Vbar };
}
function ledger() {
  const a = OP.avg, s = OP.pm ? OP.pm.split : { iz: 0, ex: 0, el: 0, wall: 0 }, board = P.Pboard;
  const Pwall = a.in + OP.buck + board + Math.max(a.bias, 0);
  return { Pwall, buck: OP.buck, board, Pdrv: a.in, fet: a.fet, choke: a.choke, coil: a.coil, gate: a.gate, pl: a.plasma, iz: s.iz, wall: s.wall, el: s.el, L: lightCalc() };
}
function drawLedger() {
  const g = ledger(), L = g.L || { q: 0, vuv: 0, nirOut: 0, nirIn: 0, visOut: 0, visIn: 0 };
  const rows = [[tr('แหล่งจ่าย', 'supply'), g.Pwall, 0], [tr('buck และสายไฟ', 'buck and wiring'), g.buck, 1], [tr('วงจรควบคุมบนบอร์ด', 'board logic'), g.board, 1], [tr('เข้าวงจรขับ', 'into the driver'), g.Pdrv, 1],
    ['MOSFET Q1 ‖ Q2', g.fet, 2], [tr('ความต้านทาน L2', 'L2 resistance'), g.choke, 2], [tr('ความต้านทานคอยล์', 'coil resistance'), g.coil, 2], ['gate, R13, TVS', g.gate, 2], [tr('เข้าพลาสมา', 'into the plasma'), g.pl, 2],
    [tr('ไอออไนซ์และผนัง (ร้อน)', 'ionisation and wall (heat)'), g.iz + g.wall, 3], [tr('ชนแบบยืดหยุ่น (แก๊สร้อน)', 'elastic collisions (gas heat)'), g.el, 3], [tr('กระตุ้นแต่ไม่แผ่แสง', 'excitation, not radiated'), L.q, 3], [tr('VUV ถูกแก้วดูด', 'VUV absorbed by glass'), L.vuv, 3],
    [tr('NIR ออกนอกแก้ว', 'NIR leaving the glass'), L.nirOut, 3], [tr('NIR ถูกแก้วดูด', 'NIR absorbed by glass'), L.nirIn, 3], [tr('แสงที่มองเห็นออกนอกแก้ว', 'visible light leaving the glass'), L.visOut, 3], [tr('แสงที่มองเห็นถูกแก้วดูด', 'visible light absorbed by glass'), L.visIn, 3]];
  $('#ledger').innerHTML = `<tr><th>${tr('ปลายทาง', 'Destination')}</th><th class="n">W</th><th class="n">%</th></tr>` + rows.map(([a, v, lv], i) => `<tr${i === 1 ? ' class="mid"' : ''}><td style="padding-left:${6 + lv * 14}px">${a}</td><td class="n">${v.toFixed(2)}</td><td class="n">${pct(v / g.Pwall)}</td></tr>`).join('');
  const Lx = g.L;
  const effs = [[tr('กำลังจากแหล่งจ่าย', 'supply power'), si(g.Pwall, 'W')], [tr('ส่งเข้าพลาสมา ($P_p/P_{wall}$)', 'delivered to plasma ($P_p/P_{wall}$)'), pct(g.pl / g.Pwall)], [tr('การส่งคอยล์สู่พลาสมา $\\eta_c$', 'coil to plasma transfer $\\eta_c$'), pct(OP.pm ? etac() : NaN)],
    [tr('รังสีจากพลาสมา (ทุกช่วงคลื่น)', 'plasma radiation (all wavelengths)'), Lx ? pct(Lx.Pex / g.Pwall) : '–'], [tr('แสงที่มองเห็น $\\eta_{vis}$', 'visible light $\\eta_{vis}$'), Lx ? pct(Lx.visOut / g.Pwall) : '–'],
    [tr('ความสว่าง $\\Phi_v$', 'luminous flux $\\Phi_v$'), Lx ? Lx.lm.toFixed(0) + ' lm' : '–'], [tr('ประสิทธิผลการส่องสว่าง', 'luminous efficacy'), Lx ? (Lx.lm / g.Pwall).toFixed(2) + ' lm/W' : '–'],
    [tr(`ส่วนต่างที่เหลือใน ${eqn('eq:integral')}`, `residual left in ${eqn('eq:integral')}`), si(OP.residual, 'J')]];
  $('#effs').innerHTML = `<tr><th>${tr('ปริมาณ', 'Quantity')}</th><th class="n">${tr('ค่า', 'Value')}</th></tr>` + effs.map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join('');
  typeset($('#effs'));
}
function etac() { const pm = OP.pm, w = OP.an.w, Lp = OP.Lgeom + pm.Le, Rr = w * w * OP.M * OP.M * pm.Rp / (pm.Rp ** 2 + w * w * Lp * Lp); return Rr / (Rr + P.Rc); }
function drawSankey() {
  const S = $('#sankey'); S.innerHTML = ''; const g = ledger(), L = g.L;
  const H = 400, top = 34, sc = H / g.Pwall, cols = [30, 250, 490, 730];
  const tx = (x, y, s) => { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('fill', INK); t.setAttribute('font-size', 13.5); t.setAttribute('font-family', 'LM Roman, Plex Thai, serif'); t.textContent = s; S.appendChild(t); };
  const rect = (x, y, h, c) => { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 12); r.setAttribute('height', Math.max(h, 0.8)); r.setAttribute('fill', c); S.appendChild(r); };
  const band = (x0, y0, x1, y1, h, c) => { const p = document.createElementNS(NS, 'path'), m = (x0 + x1) / 2; p.setAttribute('d', `M${x0} ${y0} C${m} ${y0} ${m} ${y1} ${x1} ${y1} L${x1} ${y1 + h} C${m} ${y1 + h} ${m} ${y0 + h} ${x0} ${y0 + h} Z`); p.setAttribute('fill', c); p.setAttribute('opacity', 0.32); S.appendChild(p); };
  const heat = '#d27a4f', pl = '#7a5bd6', vis = '#d9a400', nir = '#c8423c', sup = '#2c5fb8';
  rect(cols[0], top, g.Pwall * sc, sup); tx(cols[0], top - 10, `${tr('แหล่งจ่าย', 'supply')} ${g.Pwall.toFixed(1)} W`);
  let y0 = top, y1 = top; const p1 = {};
  for (const [k, n, v, c] of [['bb', tr('buck + บอร์ด', 'buck + board'), g.buck + g.board, heat], ['drv', tr('วงจรขับ', 'driver'), g.Pdrv, sup]]) { const h = v * sc; band(cols[0] + 12, y0, cols[1], y1, h, c); rect(cols[1], y1, h, c); tx(cols[1] + 18, y1 + Math.max(h / 2, 6) + 5, `${n} ${v.toFixed(1)} W`); p1[k] = y1; y0 += h; y1 += h + 16; }
  y0 = p1.drv; y1 = top; const p2 = {};
  for (const [k, n, v, c] of [['fet', 'MOSFET', g.fet, heat], ['cu', tr('L2, คอยล์, gate', 'L2, coil, gate'), g.choke + g.coil + g.gate, heat], ['pl', tr('พลาสมา', 'plasma'), g.pl, pl]]) { const h = v * sc; band(cols[1] + 12, y0, cols[2], y1, h, c); rect(cols[2], y1, h, c); tx(cols[2] + 18, y1 + Math.max(h / 2, 6) + 5, `${n} ${v.toFixed(1)} W`); p2[k] = y1; y0 += h; y1 += h + 16; }
  if (L) { y0 = p2.pl; y1 = top;
    for (const [n, v, c] of [[tr('ไอออไนซ์และผนัง', 'ionisation and wall'), g.iz + g.wall, heat], [tr('แก๊สร้อน', 'gas heating'), g.el, heat], [tr('กระตุ้นไม่แผ่แสง', 'excited, not radiated'), L.q, heat], [tr('VUV ถูกแก้วดูด', 'VUV absorbed'), L.vuv, heat],
                             [tr('NIR ออก', 'NIR out'), L.nirOut, nir], [tr('NIR ถูกดูด', 'NIR absorbed'), L.nirIn, heat], [tr('แสงที่มองเห็น ออก', 'visible out'), L.visOut, vis], [tr('แสงที่มองเห็น ถูกดูด', 'visible absorbed'), L.visIn, heat]]) {
      const h = v * sc; band(cols[2] + 12, y0, cols[3], y1, h, c); rect(cols[3], y1, h, c); tx(cols[3] + 18, y1 + Math.max(h / 2, 5) + 5, `${n} ${v.toFixed(2)} W`); y0 += h; y1 += Math.max(h + 10, 21); } }
}

/* ---------------- Section 6: the donut surface ---------------- */
let TS = null, GI = null;
const DIV = { neg: [44, 95, 184], mid: [236, 236, 233], pos: [192, 57, 43] }, SEQ = [[247, 247, 245], [31, 79, 160]];
function divColor(t) { const u = Math.max(-1, Math.min(1, t)), c = u < 0 ? DIV.neg : DIV.pos, a = Math.abs(u) ** 0.8; return DIV.mid.map((m, i) => Math.round(m + (c[i] - m) * a)); }
function seqColor(t) { const u = Math.max(0, Math.min(1, t)) ** 0.85; return SEQ[0].map((m, i) => Math.round(m + (SEQ[1][i] - m) * u)); }
const plasmaOn = () => mode === 'E' || mode === 'H';
const coilDir = () => { const n = P.coilTurns.length, rc = P.coilTurns.reduce((s, t) => s + t[0], 0) / n, zc = P.coilTurns.reduce((s, t) => s + t[1], 0) / n; return Math.atan2(zc - P.zring, rc - P.Rring); };
function surfVal(q, th) {   // interpolate a torusSurface row quantity at poloidal angle th (rad)
  const rows = TS.rows, n = rows.length - 1, x = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  return rows[i][q] * (1 - f) + rows[i + 1][q] * f;
}
function surfColor(q, th) {
  if (!TS) return DIV.mid;
  if (q === 'Bc') { let m = 0; for (const r of TS.rows) m = Math.max(m, r.Bc); return seqColor(m ? surfVal('Bc', th) / m : 0); }
  let m = 0; for (const r of TS.rows) m = Math.max(m, Math.abs(r[q])); return divColor(m ? surfVal(q, th) / m : 0);
}
function fillTorus() {
  if (!TS) return;
  const on = plasmaOn(), np = tr('– (ไม่มีพลาสมา)', '– (no plasma)');
  set('t-tA', (TS.A * 1e4).toFixed(2) + ' cm²'); set('t-tAnum', (TS.Anum * 1e4).toFixed(2) + ' cm²'); set('t-tV', (TS.V * 1e6).toFixed(2) + ' cm³');
  set('t-halfT', si(0.5 / OP.an.f, 's'));
  let im = 0; TS.rows.forEach((r, i) => { if (Math.abs(r.fn) > Math.abs(TS.rows[im].fn)) im = i; });
  set('t-tBth', on ? si(TS.Bth, 'T') : np); set('t-tpB', on ? si(TS.pB, 'Pa') : np);
  set('t-tThMax', on ? deg(TS.rows[im].th).toFixed(0) + '°' : np); set('t-tFz', on ? si(TS.Fz, 'N') : np);
  const L = lightCalc();
  if (L && GI) { const top = GI.rows[0][1], bot = GI.rows[GI.rows.length - 1][1];
    let ip = 0; GI.rows.forEach((r, i) => { if (r[1] > GI.rows[ip][1]) ip = i; });
    set('t-gTot', si(GI.total, 'W')); set('t-gP', si(L.Pex, 'W')); set('t-gRatio', (bot / top).toFixed(1)); set('t-gPeak', deg(GI.rows[ip][0]).toFixed(0) + '°');
    set('t-gDist', (P.globeR - Math.hypot(P.Rring, P.zring - P.globeZ)).toFixed(0) + ' mm'); }
  else for (const k of ['t-gTot', 't-gP', 't-gRatio', 't-gPeak', 't-gDist']) set(k, np);
}
function drawFth() {
  const cv = $('#cvFth'); if (!cv || !TS) return; const [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const pts = TS.rows.map((r) => [deg(r.th) || (r.th > 1 ? 360 : 0), r.fn, r.ft]); pts[pts.length - 1][0] = 360;
  let m = 1e-12; for (const p of pts) m = Math.max(m, Math.abs(p[1]), Math.abs(p[2])); m = niceMax(m);
  const [X, Y] = axes(g, W, H, 0, 360, -m, m, tr('θ (องศา)  0 นอก  90 บน  180 ใน  270 ล่าง', 'θ (deg)  0 outer  90 top  180 inner  270 bottom'),
    tr(`f (N/m³), สเกลเต็ม ±${si(m, 'N/m³', 2)}`, `f (N/m³), full scale ±${si(m, 'N/m³', 2)}`), [0, 60, 120, 180, 240, 300, 360]);
  g.strokeStyle = AX; g.lineWidth = 1; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(360), Y(0)); g.stroke();
  const tc = deg(coilDir()); g.strokeStyle = '#b87333'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(tc), Y(-m)); g.lineTo(X(tc), Y(m)); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#8a5523'; g.font = FONT(W < 520 ? 11 : 12.5); g.textAlign = tc > 300 ? 'right' : 'left'; g.fillText(tr('ทิศไปคอยล์', 'toward coil'), X(tc) + (tc > 300 ? -5 : 5), Y(m) + 15); g.textAlign = 'left';
  if (!plasmaOn()) { g.fillStyle = MUTED; g.font = FONT(14); g.textAlign = 'center'; g.fillText(tr('ไม่มีพลาสมา จึงไม่มีแรง เลือก S2 หรือ S3', 'no plasma, so no force; choose S2 or S3'), W / 2, H / 2); g.textAlign = 'left'; return; }
  const ln = (k, col, dash) => { g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[k])) : g.moveTo(X(p[0]), Y(p[k]))); g.stroke(); g.setLineDash([]); };
  ln(1, '#2c5fb8', []); ln(2, '#c0502b', [6, 5]);
  const th = +$('#dth').value, v = [surfVal('fn', th * Math.PI / 180), surfVal('ft', th * Math.PI / 180)];
  g.strokeStyle = '#5a3db3'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(th), Y(-m)); g.lineTo(X(th), Y(m)); g.stroke();
  for (const [k, c] of [[0, '#2c5fb8'], [1, '#c0502b']]) { g.fillStyle = c; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(X(th), Y(v[k]), 4.5, 0, 7); g.stroke(); g.fill(); }
  g.font = FONT(W < 520 ? 12.5 : 14); const lx = X(0) + 10, ly = Y(m) + 18;
  g.strokeStyle = '#2c5fb8'; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 22, ly); g.stroke(); g.fillStyle = INK; gtext(g, 'f_n', lx + 28, ly + 4);
  g.strokeStyle = '#c0502b'; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(lx, ly + 18); g.lineTo(lx + 22, ly + 18); g.stroke(); g.setLineDash([]); gtext(g, 'f_θ', lx + 28, ly + 22);
  g.fillStyle = MUTED; g.font = FONT(W < 520 ? 11.5 : 13); gtext(g, `θ = ${th}°   f_n = ${si(v[0], 'N/m³', 2)}   f_θ = ${si(v[1], 'N/m³', 2)}`, X(0) + 8, Y(-m) - 8);
}
let UW = null;
function drawUnwrap(dtms) {
  const cv = $('#cvUnwrap'); if (!cv || !TS) return; const [g, W, H] = fitCanvas(cv); if (W < 60) return;
  const nar = W < 520, pad = { l: nar ? 46 : 56, r: nar ? 84 : 100, t: 12, b: 36 }, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = H - pad.b;
  const X = (ph) => x0 + ph / 360 * (x1 - x0), Y = (th) => y1 - th / 360 * (y1 - y0), q = $('#dq').value;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const nb = Math.max(2, Math.round(y1 - y0));
  for (let k = 0; k < nb; k++) { const th = 2 * Math.PI * (k + 0.5) / nb, [r, gg, b] = plasmaOn() || q === 'Bc' ? surfColor(q, th) : DIV.mid; g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(x0, y1 - (k + 1) * (y1 - y0) / nb, x1 - x0, (y1 - y0) / nb + 0.6); }
  if (!UW) UW = { ph: 0, c: Array.from({ length: 5 }, (_, i) => i / 5), f: Array.from({ length: 4 }, (_, i) => i / 4) };
  const on = plasmaOn(), flow = $('#dflow').checked;
  if (running && $('#spin').checked) UW.ph += dtms * 0.0012;
  const ip = OP.an.Ipph, sgn = on ? Math.cos(UW.ph + Math.atan2(ip[1], ip[0])) : 0;
  if (running) { const d = dtms * 0.00012 * sgn; UW.c = UW.c.map((u) => (u + d + 1) % 1); UW.f = UW.f.map((u) => (u - d * 1.6 + 1) % 1); }
  g.lineWidth = 1;
  for (let th = 0; th < 360; th += 45) { g.strokeStyle = 'rgba(217,138,0,0.55)'; g.beginPath(); g.moveTo(x0, Y(th)); g.lineTo(x1, Y(th)); g.stroke(); }
  for (let ph = 0; ph < 360; ph += 45) { g.strokeStyle = 'rgba(36,87,197,0.45)'; g.beginPath(); g.moveTo(X(ph), y0); g.lineTo(X(ph), y1); g.stroke(); }
  if (on && flow) {
    g.fillStyle = '#d98a00'; for (let th = 0; th < 360; th += 45) for (const u of UW.c) for (let k = 0; k < 4; k++) { const ph = ((u + k / 4) % 1) * 360; g.beginPath(); g.arc(X(ph), Y(th), 3, 0, 7); g.fill(); }
    g.fillStyle = '#2457c5'; for (let ph = 0; ph < 360; ph += 45) for (const u of UW.f) for (let k = 0; k < 3; k++) { const th = ((u + k / 3) % 1) * 360; g.beginPath(); g.arc(X(ph), Y(th), 2.4, 0, 7); g.fill(); }
  }
  const pth = +$('#dth').value, pph = +$('#dph').value; g.strokeStyle = '#5a3db3'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(X(pph), y0); g.lineTo(X(pph), y1); g.moveTo(x0, Y(pth)); g.lineTo(x1, Y(pth)); g.stroke();
  g.fillStyle = '#5a3db3'; g.beginPath(); g.arc(X(pph), Y(pth), 5, 0, 7); g.fill();
  g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
  g.fillStyle = INK; g.font = FONT(nar ? 11.5 : 13); g.textAlign = 'center';
  for (let ph = 0; ph <= 360; ph += nar ? 90 : 45) g.fillText(ph, X(ph), y1 + 15);
  g.fillText(tr('φ (องศา) รอบวงใหญ่ ทิศของกระแส', 'φ (deg) around the ring, direction of the current'), (x0 + x1) / 2, H - 4); g.textAlign = 'right';
  for (let th = 0; th <= 360; th += 90) g.fillText(th, x0 - 5, Y(th) + 4);
  g.save(); g.translate(nar ? 11 : 14, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(tr('θ (องศา) รอบหน้าตัด', 'θ (deg) around the cross section'), 0, 0); g.restore(); g.textAlign = 'left';
  // colour bar
  const bx = W - pad.r + (nar ? 10 : 14), bh = y1 - y0; let m = 0; for (const r of TS.rows) m = Math.max(m, Math.abs(r[q]));
  for (let k = 0; k < bh; k++) { const t = 1 - 2 * k / (bh - 1), [r, gg, b] = q === 'Bc' ? seqColor((1 + t) / 2) : divColor(t); g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(bx, y0 + k, 12, 1.2); }
  g.strokeStyle = INK; g.strokeRect(bx + 0.5, y0 + 0.5, 12, bh); g.fillStyle = INK; g.font = MONO(nar ? 9.5 : 11); const unit = q === 'Bc' ? 'T' : 'N/m³';
  g.fillText(si(m, unit, 2), bx + 16, y0 + 9); g.fillText(q === 'Bc' ? '0' : '0', bx + 16, y0 + bh / 2 + 4); g.fillText(q === 'Bc' ? '' : si(-m, unit, 2), bx + 16, y1);
}
function drawGlass() {
  const cv = $('#cvGlass'); if (!cv) return; const [g, W, H] = fitCanvas(cv); if (W < 60) return;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const L = lightCalc();
  GI = L ? PT.glassIrradiance(P, L.Pex) : null;
  if (!GI) { axes(g, W, H, 0, 180, 0, 1, tr('α (องศา) จากขั้วบน', 'α (deg) from the top pole'), 'E (W/m²)', [0, 30, 60, 90, 120, 150, 180]);
    g.fillStyle = MUTED; g.font = FONT(14); g.textAlign = 'center'; g.fillText(tr('ไม่มีพลาสมา จึงไม่มีแสง เลือก S3', 'no plasma, so no light; choose S3'), W / 2, H / 2); g.textAlign = 'left'; return; }
  const pts = GI.rows.map(([a, E]) => [a * 180 / Math.PI, E]), m = niceMax(Math.max(...pts.map((p) => p[1])));
  const [X, Y] = axes(g, W, H, 0, 180, 0, m, tr('α (องศา) จากขั้วบน  0 บนสุด  180 ล่างสุด', 'α (deg) from the top pole  0 top  180 bottom'), tr(`E (W/m²), สเกลเต็ม ${si(m, 'W/m²', 2)}`, `E (W/m²), full scale ${si(m, 'W/m²', 2)}`), [0, 30, 60, 90, 120, 150, 180]);
  const ar = Math.atan2(P.Rring, P.zring - P.globeZ) * 180 / Math.PI;
  g.strokeStyle = '#5a3db3'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(ar), Y(0)); g.lineTo(X(ar), Y(m)); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#5a3db3'; g.font = FONT(W < 520 ? 11 : 12.5); g.fillText(tr('ทิศของวงแหวน', 'ring direction'), X(ar) + 4, Y(m) + 14);
  g.beginPath(); g.moveTo(X(0), Y(0)); pts.forEach((p) => g.lineTo(X(p[0]), Y(p[1]))); g.lineTo(X(180), Y(0)); g.closePath(); g.fillStyle = 'rgba(217,164,0,0.18)'; g.fill();
  g.strokeStyle = '#b07f00'; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
  g.fillStyle = MUTED; g.font = FONT(W < 520 ? 11.5 : 13); gtext(g, `∮ E dA = ${si(GI.total, 'W')}   P_{rad} = ${si(L.Pex, 'W')}`, X(0) + 8, Y(m) + 16);
}

/* the donut in 3D, coloured by the surface force, with current and field lines and the unit vectors of three coordinate systems */
let D3 = null, D3loading = false;
async function initDonut() {
  let THREE, OrbitControls;
  try { THREE = await import('three'); ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js')); }
  catch (e) { $('#donut').innerHTML = `<p class="note" style="padding:18px">${tr('โหลด three.js ไม่ได้ รูปที่ 7 และ 8 ยังใช้งานได้', 'three.js could not be loaded; Figures 7 and 8 still work')}</p>`; return; }
  const host = $('#donut'), R = new THREE.WebGLRenderer({ antialias: true });
  R.setPixelRatio(devicePixelRatio); R.setClearColor(0xf7f7f5); host.appendChild(R.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(36, 1, 0.1, 500); cam.position.set(7.5, 7.5, 10.5);
  const ctl = new OrbitControls(cam, R.domElement); ctl.target.set(0, 0.5, 0); ctl.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8d8, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(6, 14, 8); scene.add(dl);
  const U = 0.1, V = (x, y, z) => new THREE.Vector3(x * U, z * U, -y * U), Dv = (x, y, z) => new THREE.Vector3(x, z, -y);   // physics (x, y, z up) to three.js (x, y up, z)
  const grid = new THREE.PolarGridHelper(7, 12, 6, 64, 0xd2d2d2, 0xe6e6e6); grid.position.y = -0.05; scene.add(grid);
  const coilMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.5, roughness: 0.45 });
  for (const [r, z] of P.coilTurns) { const m = new THREE.Mesh(new THREE.TorusGeometry(r * U, 0.12, 12, 128), coilMat); m.rotation.x = Math.PI / 2; m.position.y = z * U; scene.add(m); }
  const nt = 72, np = 160, geo = new THREE.BufferGeometry(), pos = new Float32Array((nt + 1) * (np + 1) * 3), col = new Float32Array(pos.length), idx = [];
  for (let i = 0; i <= nt; i++) for (let j = 0; j <= np; j++) { const k = i * (np + 1) + j; if (i < nt && j < np) { const b = k + np + 1; idx.push(k, b, k + 1, b, b + 1, k + 1); } }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  const surf = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); scene.add(surf);
  const lineMat = (c, o = 0.8) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o });
  const loop = (fn, n, mat) => { const g = new THREE.BufferGeometry().setFromPoints(Array.from({ length: n + 1 }, (_, i) => fn(2 * Math.PI * i / n))); const l = new THREE.Line(g, mat); scene.add(l); return l; };
  const flow = new THREE.Group(); scene.add(flow);
  const dot = (c, r) => new THREE.InstancedMesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: c }), 160);
  const cDots = dot(0xd98a00, 0.075), fDots = dot(0x2457c5, 0.055); flow.add(cDots); flow.add(fDots);
  const arrow = (c) => { const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.6, c, 0.32, 0.16); scene.add(a); return a; };
  const label = (s, c) => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const g = cv.getContext('2d'); g.font = 'italic 88px "LM Roman", serif'; g.fillStyle = c; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 64, 70);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })); sp.scale.set(0.5, 0.5, 1); scene.add(sp); return sp; };
  const F = { x: [arrow(0x1a1a1a), label('x', '#1a1a1a')], y: [arrow(0x1a1a1a), label('y', '#1a1a1a')], z: [arrow(0x1a1a1a), label('z', '#1a1a1a')],
    r: [arrow(0x0f8c78), label('r', '#0f8c78')], p: [arrow(0x0f8c78), label('φ', '#0f8c78')], zc: [arrow(0x0f8c78), label('z', '#0f8c78')],
    n: [arrow(0x6b4bc4), label('n', '#6b4bc4')], t: [arrow(0x6b4bc4), label('θ', '#6b4bc4')] };
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0x6b4bc4 })); scene.add(marker);
  D3 = { THREE, R, scene, cam, ctl, host, U, V, Dv, surf, geo, pos, col, nt, np, loop, lineMat, flow, cDots, fDots, F, marker, lines: [], sel: [], key: '', ph: 0, uc: 0, uf: 0, o: new THREE.Object3D() };
  addEventListener('resize', sizeDonut); sizeDonut();
}
function sizeDonut() { if (!D3) return; const w = D3.host.clientWidth, h = D3.host.clientHeight; D3.R.setSize(w, h); D3.cam.aspect = w / h; D3.cam.updateProjectionMatrix(); }
const lin = (c) => { const u = c / 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
const torusPt = (R0, a, z0, th, ph, da = 0) => [(R0 + (a + da) * Math.cos(th)) * Math.cos(ph), (R0 + (a + da) * Math.cos(th)) * Math.sin(ph), z0 + (a + da) * Math.sin(th)];
function rebuildDonut() {
  const D = D3, R0 = P.Rring, a = P.aring, z0 = P.zring, q = $('#dq').value, on = plasmaOn() || q === 'Bc';
  for (let i = 0; i <= D.nt; i++) { const th = 2 * Math.PI * i / D.nt, c = on ? surfColor(q, th) : DIV.mid;
    for (let j = 0; j <= D.np; j++) { const ph = 2 * Math.PI * j / D.np, k = 3 * (i * (D.np + 1) + j), [x, y, z] = torusPt(R0, a, z0, th, ph), v = D.V(x, y, z);
      D.pos[k] = v.x; D.pos[k + 1] = v.y; D.pos[k + 2] = v.z; D.col[k] = lin(c[0]); D.col[k + 1] = lin(c[1]); D.col[k + 2] = lin(c[2]); } }
  D.geo.attributes.position.needsUpdate = true; D.geo.attributes.color.needsUpdate = true; D.geo.computeVertexNormals(); D.geo.computeBoundingSphere();
  for (const l of D.lines) { D.scene.remove(l); l.geometry.dispose(); } D.lines = [];
  for (let k = 0; k < 4; k++) { const th = k * Math.PI / 2; D.lines.push(D.loop((ph) => D.V(...torusPt(R0, a, z0, th, ph, 0.6)), 160, D.lineMat(0xd98a00, 0.9))); }
  for (let k = 0; k < 8; k++) { const ph = k * Math.PI / 4; D.lines.push(D.loop((th) => D.V(...torusPt(R0, a, z0, th, ph, 0.6)), 64, D.lineMat(0x2457c5, 0.75))); }
  D.key = [R0, a, z0, q, mode, OP && OP.an.f].join();
}
function placeFrame() {
  const D = D3, R0 = P.Rring, a = P.aring, z0 = P.zring, th = +$('#dth').value * Math.PI / 180, ph = +$('#dph').value * Math.PI / 180, sys = $('#dsys').value;
  const p = torusPt(R0, a, z0, th, ph, 0.2), P3 = D.V(...p), c = Math.cos, s = Math.sin, O = new D.THREE.Vector3(0, 0, 0);
  const put = (key, at, dir, len = 1.5) => { const [A, L] = D.F[key], d = D.Dv(...dir).normalize(); A.position.copy(at); A.setDirection(d); A.setLength(len, 0.3, 0.15); L.position.copy(at.clone().addScaledVector(d, len + 0.22)); };
  put('x', O, [1, 0, 0], 2.2); put('y', O, [0, 1, 0], 2.2); put('z', O, [0, 0, 1], 2.2);
  put('r', P3, [c(ph), s(ph), 0]); put('p', P3, [-s(ph), c(ph), 0]); put('zc', P3, [0, 0, 1], 1.2);
  put('n', P3, [c(th) * c(ph), c(th) * s(ph), s(th)], 1.3); put('t', P3, [-s(th) * c(ph), -s(th) * s(ph), c(th)], 1.3);
  const show = { x: sys === 'all' || sys === 'xyz', y: sys === 'all' || sys === 'xyz', z: sys === 'all' || sys === 'xyz', r: sys === 'all' || sys === 'cyl', p: sys === 'all' || sys === 'cyl' || sys === 'tor', zc: sys === 'cyl', n: sys === 'all' || sys === 'tor', t: sys === 'all' || sys === 'tor' };
  for (const k in D.F) D.F[k].forEach((o) => { o.visible = show[k]; });
  D.marker.position.copy(P3);
  for (const l of D.sel) { D.scene.remove(l); l.geometry.dispose(); } D.sel = [];
  // the two coordinate circles through the point, and the polar construction r, phi from the axis
  D.sel.push(D.loop((t) => D.V(...torusPt(R0, a, z0, t, ph, 0.25)), 64, D.lineMat(0x6b4bc4, 1)));
  D.sel.push(D.loop((f) => D.V(...torusPt(R0, a, z0, th, f, 0.25)), 160, D.lineMat(0x0f8c78, 1)));
  const rr = R0 + a * c(th), g = new D.THREE.BufferGeometry().setFromPoints([new D.THREE.Vector3(), D.V(rr * c(ph), rr * s(ph), 0), D.V(rr * c(ph), rr * s(ph), p[2])]);
  const pl = new D.THREE.Line(g, new D.THREE.LineDashedMaterial({ color: 0x0f8c78, dashSize: 0.12, gapSize: 0.08 })); pl.computeLineDistances(); D.scene.add(pl); D.sel.push(pl);
  D.selKey = [$('#dth').value, $('#dph').value, sys, R0, a, z0].join();
}
function drawDonut(dtms) {
  if (!D3 || !OP || !TS) return; const D = D3;
  const key = [P.Rring, P.aring, P.zring, $('#dq').value, mode, OP.an.f].join(); if (key !== D.key) rebuildDonut();
  if ([$('#dth').value, $('#dph').value, $('#dsys').value, P.Rring, P.aring, P.zring].join() !== D.selKey) placeFrame();
  const on = plasmaOn(), fl = $('#dflow').checked; D.flow.visible = on && fl; D.lines.forEach((l) => { l.visible = fl; });
  if (running && $('#spin').checked) D.ph += dtms * 0.0012;
  const ip = OP.an.Ipph, sg = on ? Math.cos(D.ph + Math.atan2(ip[1], ip[0])) : 0;
  if (running) { D.uc += dtms * 0.00012 * sg; D.uf -= dtms * 0.0002 * sg; }
  const R0 = P.Rring, a = P.aring, z0 = P.zring, o = D.o;
  let n = 0; for (let k = 0; k < 4; k++) for (let m = 0; m < 40; m++) { const ph = 2 * Math.PI * (m / 40 + D.uc), v = D.V(...torusPt(R0, a, z0, k * Math.PI / 2, ph, 0.6)); o.position.copy(v); o.updateMatrix(); D.cDots.setMatrixAt(n++, o.matrix); }
  D.cDots.count = n; D.cDots.instanceMatrix.needsUpdate = true;
  n = 0; for (let k = 0; k < 8; k++) for (let m = 0; m < 20; m++) { const th = 2 * Math.PI * (m / 20 + D.uf), v = D.V(...torusPt(R0, a, z0, th, k * Math.PI / 4, 0.6)); o.position.copy(v); o.updateMatrix(); D.fDots.setMatrixAt(n++, o.matrix); }
  D.fDots.count = n; D.fDots.instanceMatrix.needsUpdate = true;
  D.ctl.update(); D.R.render(D.scene, D.cam);
}

/* ---------------- language ---------------- */
function playText() { $('#play').textContent = running ? tr('หยุด', 'Pause') : tr('เล่น', 'Play'); }
function setLang(l, redraw = true) {
  const h = document.documentElement; h.dataset.lang = l; h.lang = l;
  try { localStorage.setItem('ptlab-lang', l); } catch (e) {}
  document.querySelectorAll('.langsw button').forEach((b) => { b.classList.toggle('on', b.dataset.l === l); b.setAttribute('aria-pressed', b.dataset.l === l); });
  document.title = tr('Plasma Toroid Lab วงแหวนพลาสมาซีนอน', 'Plasma Toroid Lab, xenon plasma ring');
  playText();
  const opt = (sel, labels) => $(sel).querySelectorAll('option').forEach((x, i) => { x.textContent = labels[i]; });
  opt('#dq', [tr('แรงตั้งฉาก fₙ', 'normal force fₙ'), tr('แรงตามผิว fθ', 'tangential fθ'), tr('|B| ของคอยล์', 'coil |B|')]);
  opt('#dsys', [tr('ทั้งสามระบบ', 'all three'), 'x y z', 'r φ z', 'n θ φ']);
  if (!redraw) return;
  if (window.SCH) SCH.lang(); buildAssump();
  if (OP) { $('#busy').textContent = tr(`จุดทำงานพร้อม (${OP.ms.toFixed(0)} ms)`, `operating point ready (${OP.ms.toFixed(0)} ms)`); fillNumbers(); drawLedger(); drawSankey(); drawXS(); drawFar(); drawEn(); drawK(); drawFth(); drawGlass(); fillTorus(); }
}

/* ---------------- live numbers in the text ---------------- */
function fillNumbers() {
  const o = OP, pm = o.pm, an = o.an, w = an.w, Lp = o.Lgeom + (pm ? pm.Le : 0);
  set('t-wM', si(w * o.M, 'Ω')); set('t-wLp', si(w * Lp, 'Ω')); set('t-Rc', si(P.Rc, 'Ω')); set('t-w', sci(w) + ' s<sup>−1</sup>'); set('t-f2', (an.f / 1e6).toFixed(1) + ' MHz');
  if (pm) {
    const Rr = w * w * o.M * o.M * pm.Rp / (pm.Rp ** 2 + w * w * Lp * Lp);
    set('t-Rp', si(pm.Rp, 'Ω')); set('t-Rref', si(Rr, 'Ω')); set('t-etac', pct(Rr / (Rr + P.Rc))); set('t-nu', sci(pm.nu) + ' s<sup>−1</sup>'); set('t-sig', pm.sig.toPrecision(3) + ' S/m');
    set('t-delta', (pm.delta * 1e3).toFixed(1) + ' mm'); set('t-Te', pm.Te.toFixed(2) + ' eV'); set('t-ne', sci(pm.ne) + ' m<sup>−3</sup>'); set('t-epsT', pm.epsT.toFixed(0) + ' eV'); set('t-epsEx', pm.eps.ex.toFixed(0) + ' eV');
  } else for (const id of ['t-Rp', 't-Rref', 't-etac', 't-nu', 't-sig', 't-delta', 't-Te', 't-ne', 't-epsT', 't-epsEx']) set(id, tr('– (ไม่มีพลาสมา)', '– (no plasma)'));
  set('t-dMdz', o.force ? si(o.force.dMdz, 'H/m') : '–'); set('t-Fz', o.force ? si(o.force.Fz, 'N') : '–'); set('t-FR', o.force ? si(o.force.FR, 'N') : '–');
  const g0 = PT.fieldAt(P, { mode: 'off', an }, P.Rring * 1e-3, P.zring * 1e-3), B2 = 0.5 * (g0.Br[0] ** 2 + g0.Br[1] ** 2 + g0.Bz[0] ** 2 + g0.Bz[1] ** 2);
  const pB = B2 / (2 * PT.MU0), pe = pm ? pm.ne * PT.QE * pm.Te : 0;
  set('t-beta', pm ? sci(pe / pB, 1) : '–'); set('t-res', si(o.residual, 'J')); set('t-Ein', si(o.E.in, 'J'));
  const fOn = an.f, fOff = o.fOff;
  set('x-foff', (fOff / 1e6).toFixed(3) + ' MHz'); set('x-fon', mode === 'H' || mode === 'E' ? (fOn / 1e6).toFixed(3) + ' MHz' : tr('– (เลือก S2 หรือ S3)', '– (choose S2 or S3)'));
  set('x-df', mode === 'H' || mode === 'E' ? `${((fOn - fOff) / 1e3).toFixed(0)} kHz (${(100 * (fOn - fOff) / fOff).toFixed(2)} %)` : '–');
  const Erms = Math.sqrt(0.5 * (g0.E[0] ** 2 + g0.E[1] ** 2));
  $('#fieldtab').innerHTML = `<tr><th>${tr('ปริมาณ', 'Quantity')}</th><th class="n">${tr('ค่า', 'Value')}</th><th>${tr('ที่มา', 'Source')}</th></tr>` + [
    [tr('$|\\mathbf B|$ rms จากคอยล์', '$|\\mathbf B|$ rms from the coil'), si(Math.sqrt(B2), 'T'), eqn('eq:aphi')], ['$|E_\\varphi|$ rms', si(Erms, 'V/m'), eqn('eq:faraday')], [tr('$I_p$ ยอด', '$I_p$ peak'), si(an.pk.Ip, 'A'), eqn('eq:zref')],
    ['$\\langle F_z\\rangle$', o.force ? si(o.force.Fz, 'N') : '–', eqn('eq:force')], [tr('$\\langle F_R\\rangle$ รวมแรงห่วง', '$\\langle F_R\\rangle$ incl. hoop force'), o.force ? si(o.force.FR, 'N') : '–', eqn('eq:force')],
    ['$B^2/2\\mu_0$', si(pB, 'Pa'), ''], ['$n_e k_B T_e$', si(pe, 'Pa'), tr('หัวข้อ 8', 'Sect. 8')], ['$\\beta$', pm ? (pe / pB).toPrecision(3) : '–', eqn('eq:beta')]]
    .map(([a, b, c]) => `<tr><td>${a}</td><td class="n">${b}</td><td>${c}</td></tr>`).join('');
  typeset($('#fieldtab'));
  const L = lightCalc(), g = ledger();
  const stage = $('#stage').selectedOptions[0].textContent;
  set('abs', tr(`เอกสารนี้จำลองบอร์ด sky guided plasma toroid v2.3.0 ตั้งแต่วงจรขับ สนามแม่เหล็กไฟฟ้า จนถึงพลาสมาซีนอนที่ 15 torr ในสถานะ <b>${stage}</b> วงจรสั่นที่ <span class="v">${(an.f / 1e6).toFixed(2)} MHz</span> ดึงกำลังจากแหล่งจ่าย <span class="v">${g.Pwall.toFixed(1)} W</span> ${pm ? `ส่งเข้าพลาสมา <span class="v">${g.pl.toFixed(1)} W</span> (${pct(g.pl / g.Pwall)}) ส่วนที่เหลือเป็นความร้อนที่ MOSFET เป็นหลัก` : `ในสถานะนี้ยังไม่มีพลาสมา กำลังทั้งหมดจึงกลายเป็นความร้อนใน MOSFET คอยล์ และวงจรไฟเลี้ยง ตัวเลขของพลาสมาด้านล่างจะแสดงเมื่อเลือก S2 หรือ S3`} ${pm ? `พลาสมามี $n_e \\approx$ <span class="v">${sci(pm.ne, 1)} m<sup>−3</sup></span> และ $T_e \\approx$ <span class="v">${pm.Te.toFixed(2)} eV</span> ` : ''}${L ? `แสงที่ตามองเห็นออกจากแก้วประมาณ <span class="v">${L.visOut.toFixed(2)} W</span> หรือ ${pct(L.visOut / g.Pwall)} ของกำลังไฟฟ้า ` : ''}${pm ? `บนผิวโดนัท กระแสไหลเป็นวงปิดตามทิศ $\\varphi$ สนามของพลาสมาเองพันรอบตามทิศ $\\theta$ และแรงจากคอยล์แรงที่สุดด้านที่หันเข้าหาคอยล์ แรงแม่เหล็กรวมอยู่ระดับไมโครนิวตัน และ $\\beta \\gg 1$ จึงไม่ได้กักพลาสมาแบบโทคาแมค ` : ''}การคำนวณพลังงานปิดบัญชีได้ภายใน <span class="v">${si(Math.abs(o.residual), 'J')}</span>`,
    `This paper simulates the sky guided plasma toroid v2.3.0 board from the drive circuit, through the electromagnetic field, to the xenon plasma at 15 torr, in state <b>${stage}</b>. The circuit oscillates at <span class="v">${(an.f / 1e6).toFixed(2)} MHz</span> and draws <span class="v">${g.Pwall.toFixed(1)} W</span> from the supply${pm ? `, of which <span class="v">${g.pl.toFixed(1)} W</span> (${pct(g.pl / g.Pwall)}) reaches the plasma and most of the rest heats the MOSFETs.` : `. No plasma exists in this state, so all of it becomes heat in the MOSFETs, the coil and the supply circuits. Plasma figures appear when S2 or S3 is selected.`} ${pm ? `The plasma has $n_e \\approx$ <span class="v">${sci(pm.ne, 1)} m<sup>−3</sup></span> and $T_e \\approx$ <span class="v">${pm.Te.toFixed(2)} eV</span>. ` : ''}${L ? `About <span class="v">${L.visOut.toFixed(2)} W</span> of visible light leaves the glass, ${pct(L.visOut / g.Pwall)} of the electrical power. ` : ''}${pm ? `On the donut surface the current runs in closed loops along $\\varphi$, the plasma's own field wraps around along $\\theta$, and the coil force is strongest on the side facing the coil. The net magnetic force is of order micronewtons and $\\beta \\gg 1$, so the field does not confine the plasma the way a tokamak does. ` : ''}The energy ledger closes to within <span class="v">${si(Math.abs(o.residual), 'J')}</span>.`));
  typeset($('#abs'));
  const on2 = mode === 'H' || mode === 'E';
  const ex = [[tr('วัดความหนาแน่นด้วยวิทยุ', 'Density from a radio'), 'S3–S5', tr('การเลื่อนความถี่ $\\Delta f$', 'frequency shift $\\Delta f$'), on2 ? `${((fOn - fOff) / 1e3).toFixed(0)} kHz` : '–'],
    [tr('คุมความสูงวงแหวน', 'Ring height control'), 'S4', tr('ความสูง $z$ จากกล้อง', 'height $z$ from a camera'), o.force ? `${tr('แรงยก', 'lift')} ${si(o.force.Fz, 'N')}` : '–'],
    [tr('เทอร์โมมิเตอร์ 823/828 nm', '823/828 nm thermometer'), 'S3–S4', tr('$T_e$ จากอัตราส่วนเส้น', '$T_e$ from the line ratio'), pm ? `${pm.Te.toFixed(2)} eV ${tr('(แบบง่าย)', '(simple model)')}` : '–'],
    [tr('สุ่มเลขจากสัญญาณรบกวน', 'Plasma noise TRNG'), tr('S4, LED ที่ S0', 'S4, LED at S0'), 'min-entropy', tr('ไม่ได้จำลอง', 'not simulated')]];
  $('#exptab').innerHTML = `<tr><th>${tr('การทดลอง', 'Experiment')}</th><th>${tr('ขั้น', 'Stage')}</th><th>${tr('สิ่งที่วัด', 'Measured')}</th><th class="n">${tr('แบบจำลองทำนาย', 'Model predicts')}</th></tr>` + ex.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="n">${r[3]}</td></tr>`).join('');
  typeset($('#exptab'));
  $('#minitab').innerHTML = [['f', (an.f / 1e6).toFixed(2) + ' MHz'], ['P<sub>wall</sub>', g.Pwall.toFixed(1) + ' W'], ['P<sub>plasma</sub>', g.pl.toFixed(1) + ' W'],
    ['n<sub>e</sub>', pm ? sci(pm.ne, 1) : '–'], ['T<sub>e</sub>', pm ? pm.Te.toFixed(2) + ' eV' : '–'], ['η<sub>vis</sub>', L ? pct(L.visOut / g.Pwall) : '–']].map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join('');
  const a = o.avg;
  $('#avgtab').innerHTML = `<tr><th>${tr('ปริมาณ', 'Quantity')}</th><th class="n">${tr('ค่า', 'Value')}</th></tr>` + [[tr('ความถี่', 'frequency'), (an.f / 1e6).toFixed(3) + ' MHz'], ['V<sub>drive</sub>', o.Vdd.toFixed(2) + ' V'], [tr('I เฉลี่ย', 'I mean'), (a.in / o.Vdd).toFixed(2) + ' A'],
    [tr('I<sub>coil</sub> ยอด', 'I<sub>coil</sub> peak'), an.pk.I1.toFixed(2) + ' A'], [tr('V<sub>hv</sub> ยอด', 'V<sub>hv</sub> peak'), an.pk.Vhv.toFixed(0) + ' V'], ['k', o.k.toFixed(3)], ['P<sub>FET</sub>', a.fet.toFixed(2) + ' W'], ['P<sub>plasma</sub>', a.plasma.toFixed(2) + ' W']]
    .map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join('');
  $('#circnote').textContent = mode === 'strike' ? tr('สถานะ S1 วงจร ARC START สร้างพัลส์แรงดันสูงที่ 14 kHz ผ่านผิวแก้ว วงจรขับยังไม่มีโหลดพลาสมา คอยล์จึงสั่นแรงที่สุด', 'In state S1 the ARC START circuit fires 14 kHz high-voltage pulses through the glass. The driver has no plasma load yet, so the coil rings hardest.')
    : mode === 'off' ? tr('สถานะ S0 ยังไม่มีพลาสมา วงจรเป็น LC ที่ Q สูง แรงดัน hv ขึ้นสูงแต่ดึงกำลังน้อยเพราะไม่มีโหลด', 'In state S0 there is no plasma yet. The circuit is a high-Q LC, so the hv node swings high but little power is drawn.')
    : mode === 'E' ? tr('สถานะ S2 พลาสมาบาง n_e ต่ำ (กำหนดไว้ที่ 3×10¹⁶ m⁻³) ความต้านทานพลาสมาสูงมาก จึงรับกำลังได้น้อย', 'State S2 has a thin plasma with low n_e (fixed at 3×10¹⁶ m⁻³). Its resistance is very high, so it takes little power.')
    : tr('สถานะ S3 โหมด H วงแหวนพลาสมาดึงกำลังจากคอยล์ แรงดัน hv และกระแสคอยล์ลดลงเพราะ Q ของวงจรลดลง', 'State S3 is H mode. The plasma ring draws power from the coil, and the hv voltage and coil current fall because the circuit Q drops.');
  fillTorus();
}

/* ---------------- references ---------------- */
const BOOK = { file: '', dir: '',
  pages: { 64: 82, 85: 102, 100: 117, 150: 166, 391: 403, 393: 405, 394: 406, 395: 407 },
  chapters: { 3: 'Single Particle Motion in Electric and Magnetic Fields', 4: 'Stochastic Processes in a Plasma', 6: 'Plasma Waves', 11: 'Plasma Generation' } };
const CH = (p) => p < 75 ? 3 : p < 140 ? 4 : p < 200 ? 6 : 11;
function openRef(a) {
  const ref = a.dataset.ref, card = $('#refcard');
  if (ref !== 'piel') { const li = document.getElementById('ref-' + ref); card.classList.remove('on'); li.scrollIntoView({ block: 'center' }); li.style.background = '#fff6d6'; setTimeout(() => li.style.background = '', 1600); return; }
  const pp = +(a.dataset.page || 391), pdf = BOOK.pages[pp] || pp + 12, ch = CH(pp), sec = a.dataset.sec, eq = a.dataset.eq;
  $('#refh').textContent = 'A. Piel, Plasma Physics, 2nd ed. (Springer, 2017)';
  const head = `<p style="margin:0 0 6px">Chapter ${ch}, <i>${BOOK.chapters[ch]}</i>${sec ? `, Sect. ${sec}` : ''}${eq ? `, Eq. (${eq})` : ''}<br>`;
  const springer = `<a href="https://doi.org/10.1007/978-3-319-63427-2_${ch}" target="_blank" rel="noopener" style="border:1px solid #9a9a9a;padding:4px 10px;border-radius:3px">${tr(`บทที่ ${ch} บน Springer`, `Chapter ${ch} on Springer`)}</a><button id="refclose">${tr('ปิด', 'Close')}</button>`;
  if (!BOOK.file) {   // public build: no local copy of the book, point to the publisher
    $('#refb').innerHTML = head + tr(`หน้า <b>${pp}</b> ในฉบับพิมพ์`, `printed page <b>${pp}</b>`) + '</p>';
    $('#refa').innerHTML = springer;
  } else {
  const enc = encodeURI(BOOK.file).replace(/\(/g, '%28').replace(/\)/g, '%29'), local = '../../' + enc + '#page=' + pdf, abs = BOOK.dir + enc + '#page=' + pdf;
  $('#refb').innerHTML = head + `${tr(`หน้าที่พิมพ์ในหนังสือ <b>${pp}</b> ตรงกับหน้า <b>${pdf}</b> ของไฟล์ PDF ในโฟลเดอร์ Plasma project`, `Printed page <b>${pp}</b> is page <b>${pdf}</b> of the PDF in the Plasma project folder`)}</p>`
    + (location.protocol === 'file:' ? '' : `<p class="note" style="margin:6px 0">${tr('เบราว์เซอร์ไม่ยอมให้หน้าเว็บเปิดไฟล์ในเครื่องโดยตรง ปุ่มเปิดหน้าจะทำงานเมื่อเปิด index.html จากโฟลเดอร์ Claude outputs\\plasma_lab ในเครื่อง หรือคัดลอกลิงก์ไปวางในแถบที่อยู่ของเบราว์เซอร์', 'Browsers do not let a web page open local files directly. The open button works when index.html is opened from the Claude outputs\\plasma_lab folder on your computer; otherwise copy the link into the address bar.')}</p><p style="margin:0"><code>${abs}</code></p>`);
  $('#refa').innerHTML = (location.protocol === 'file:' ? `<a class="primary" href="${local}" target="_blank" style="border:1px solid var(--link);padding:4px 10px;border-radius:3px">${tr(`เปิดหน้า ${pp} ในหนังสือ`, `open page ${pp} of the book`)}</a>` : `<button class="primary" id="refcopy">${tr(`คัดลอกลิงก์ไปหน้า ${pp}`, `copy link to page ${pp}`)}</button>`) + springer;
  const cp0 = $('#refcopy'); if (cp0) cp0.onclick = async () => { try { await navigator.clipboard.writeText(abs); cp0.textContent = tr('คัดลอกแล้ว', 'copied'); } catch (e) { cp0.textContent = tr('คัดลอกไม่ได้ ใช้ข้อความด้านบน', 'copy blocked, use the text above'); } };
  }
  card.classList.add('on'); $('#refclose').onclick = () => card.classList.remove('on'); $('#refclose').focus();
}

/* ---------------- parameters (Appendix A) ---------------- */
const AS = [['Vdd', ['V<sub>drive</sub> (V)', 'V<sub>drive</sub> (V)'], 12, 28, 0.5, 1, true], ['Vbias', ['gate bias จาก RV2 (V)', 'gate bias from RV2 (V)'], 3.0, 4.6, 0.05, 1, true], ['Coss', ['C<sub>oss</sub> ใช้งานจริง (nF)', 'working C<sub>oss</sub> (nF)'], 0.4, 4, 0.1, 1e-9, true],
  ['L1', ['L100 (µH)', 'L100 (µH)'], 1.0, 2.5, 0.05, 1e-6, true], ['Rc', ['R คอยล์ที่ 10 MHz (Ω)', 'coil R at 10 MHz (Ω)'], 0.03, 0.5, 0.01, 1, true], ['p_torr', ['ความดัน Xe (torr)', 'Xe pressure (torr)'], 1, 30, 0.5, 1, true],
  ['Tg', ['อุณหภูมิแก๊ส (K)', 'gas temperature (K)'], 300, 900, 10, 1, true], ['Rring', ['รัศมีวงแหวน (mm)', 'ring major radius (mm)'], 35, 58, 1, 1, true], ['aring', ['รัศมีหน้าตัดวงแหวน (mm)', 'ring minor radius (mm)'], 4, 14, 0.5, 1, true],
  ['zring', ['ความสูงวงแหวนเหนือคอยล์ (mm)', 'ring height above coil (mm)'], -5, 30, 1, 1, true], ['fRad', ['สัดส่วนการกระตุ้นที่กลายเป็นแสง', 'share of excitation radiated'], 0.2, 1, 0.01, 1, false], ['fVUV', ['น้ำหนัก VUV', 'VUV weight'], 0, 1, 0.01, 1, false],
  ['fNIR', ['น้ำหนัก NIR', 'NIR weight'], 0, 1, 0.01, 1, false], ['fVIS', ['น้ำหนักแสงที่มองเห็น', 'visible weight'], 0, 0.3, 0.005, 1, false], ['tGlassVis', ['แก้วยอมให้แสงผ่าน', 'glass visible transmission'], 0.5, 1, 0.01, 1, false],
  ['Vbar', ['V(λ) เฉลี่ยของเส้น Xe ที่มองเห็น', 'mean V(λ) of visible Xe lines'], 0.02, 0.6, 0.01, 1, false], ['Pboard', ['วงจรบนบอร์ด (W)', 'board logic (W)'], 0, 2, 0.05, 1, false]];
function buildAssump() {
  $('#assump').innerHTML = AS.map(([k, lab, lo, hi, st, sc, heavy]) => `<label for="as-${k}"><span>${tr(lab[0], lab[1])}${heavy ? ' ⟳' : ''}</span><output id="ao-${k}">${(P[k] / sc).toPrecision(3)}</output><input id="as-${k}" type="range" min="${lo}" max="${hi}" step="${st}" value="${P[k] / sc}"></label>`).join('');
  for (const [k, , , , , sc, heavy] of AS) { const i = $('#as-' + k); i.oninput = () => { P[k] = +i.value * sc; $('#ao-' + k).textContent = (+i.value).toPrecision(3); if (!heavy && OP) { drawGlass(); drawLedger(); drawSankey(); fillNumbers(); } }; }
}

/* ---------------- table of contents ---------------- */
function buildTOC() {
  const hs = [...document.querySelectorAll('#paper h2, #paper h3')], ol = $('#tocl'); let cur = null;
  for (const h of hs) { const li = document.createElement('li'), a = document.createElement('a'); a.href = '#' + h.id; a.innerHTML = h.innerHTML.replace(/<span class="sn">(.*?)<\/span>/, '$1&ensp;'); li.appendChild(a);
    if (h.tagName === 'H2') { ol.appendChild(li); cur = document.createElement('ol'); li.appendChild(cur); } else (cur || ol).appendChild(li); }
  const m = $('#mtocl'); m.innerHTML = ol.innerHTML; m.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { $('#mtoc').open = false; }));
  const links = [...ol.querySelectorAll('a')];
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }, { rootMargin: '0px 0px -70% 0px' });
  hs.forEach((h) => io.observe(h));
}

/* ---------------- visibility, typesetting, loop ---------------- */
const visible = {};
const vio = new IntersectionObserver((es) => { for (const e of es) visible[e.target.id] = e.isIntersecting; }, { rootMargin: '120px' });
function typeset(elm) { if (window.MathJax && MathJax.typesetPromise) { MathJax.typesetClear && MathJax.typesetClear([elm]); MathJax.typesetPromise([elm]).catch(() => {}); } else setTimeout(() => typeset(elm), 400); }
function updateAll() {
  TS = PT.torusSurface(P, OP); GI = null;
  drawGlass(); fillNumbers(); drawLedger(); drawSankey(); computeXS(); drawXS(); drawFar(); drawEn(); drawFth();
  if (OP.pm) $('#teS').value = OP.pm.Te.toFixed(2); drawK();
  if (T3) T3.data = null;
}
let last = performance.now();
function frame(now) {
  const dt = now - last; last = now;
  if (OP && live.c) {
    if (running) stepLive(+$('#speed').value);
    if (visible.fig1 && window.SCH) SCH.frame(dt); if (visible.fig2) drawScope(); drawInst();
    if (visible.fig3) { if (!T3 && !T3loading) { T3loading = true; initThree(); } drawThree(dt); }
    if (visible.fig6) { if (!D3 && !D3loading) { D3loading = true; initDonut(); } drawDonut(dt); }
    if (visible.fig7) drawUnwrap(dt);
    if (visible.fig4 && running && $('#xsq').value === 'B' && $('#xsp').value === 'rz' && Math.floor(now / 300) !== Math.floor((now - dt) / 300)) drawXS();
  }
  requestAnimationFrame(frame);
}
let T3loading = false;
function init() {
  if (window.SCH) SCH.init(schAPI); buildScopeChk(); buildAssump(); buildTOC();
  for (const id of ['fig1', 'fig2', 'fig3', 'fig4', 'fig6', 'fig7']) vio.observe(document.getElementById(id));
  $('#play').onclick = () => { running = !running; playText(); };
  $('#stepb').onclick = () => { running = false; playText(); stepLive(20); };
  $('#restart').onclick = () => { if (OP) initLive(true); };
  $('#stage').onchange = () => { mode = $('#stage').value; compute(); };
  $('#rerun').onclick = compute; $('#reset').onclick = () => { P = structuredClone(PT.DEFAULTS); buildAssump(); if (window.SCH) SCH.sync(); compute(); };
  ['#xsq', '#xsp', '#xsz'].forEach((s) => $(s).oninput = drawXS); $('#teS').oninput = drawK;
  ['#dth', '#dph', '#dq', '#dsys', '#dflow'].forEach((s) => $(s).addEventListener('input', () => { $('#dthv').textContent = $('#dth').value + '°'; $('#dphv').textContent = $('#dph').value + '°'; drawFth(); if (!running) drawUnwrap(0); }));
  document.querySelectorAll('.langsw button').forEach((b) => b.onclick = () => setLang(b.dataset.l));
  setLang(LANG(), false);
  document.addEventListener('click', (e) => { const a = e.target.closest('a.cite'); if (a) { e.preventDefault(); openRef(a); } });
  $('#refcard').addEventListener('click', (e) => { if (e.target.id === 'refcard') e.currentTarget.classList.remove('on'); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#refcard').classList.remove('on'); });
  let rz = 0; const redraw = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { if (OP) { drawXS(); drawFar(); drawEn(); drawK(); drawScope(); drawFth(); drawGlass(); drawUnwrap(0); } sizeThree(); sizeDonut(); if (window.SCH) SCH.resize(); }); };
  addEventListener('resize', redraw); addEventListener('orientationchange', () => setTimeout(redraw, 250));
  $('#copy').onclick = async () => { if (!OP) return; const { rec, ...rest } = OP; try { await navigator.clipboard.writeText(JSON.stringify({ params: P, mode, result: rest }, null, 1)); $('#busy').textContent = tr('คัดลอก JSON แล้ว', 'JSON copied'); } catch (e) { $('#busy').textContent = tr('เบราว์เซอร์ไม่อนุญาตให้คัดลอก', 'the browser blocked copying'); } };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { $('#speed').value = 4; $('#spin').checked = false; }
  compute(); requestAnimationFrame(frame);
}
init();
})();
