// KiCad sheet viewer for Section 2. The drawing is the board's own schematic (sky guided plasma toroid v2.3.0, CC BY-SA),
// exported by KiCad; wires, junctions and current are redrawn here from the .kicad_sch netlist (sheet.js).
(function () {
'use strict';
const S = window.SHEET, NS = 'http://www.w3.org/2000/svg', $ = (q) => document.querySelector(q);
const BLOCKS = [
  { id: 'all', th: 'ทั้งแผ่น', en: 'Full sheet', box: [9, 9, 270.4, 206.9] },
  { id: 'pwr', th: 'ไฟเข้าและไฟแสดงสถานะ', en: 'Power in and LED', box: [12, 12, 81.3, 49.5] },
  { id: 'reg', th: 'เรกูเลเตอร์ +12 V และ +5 V', en: '+12 V and +5 V regulators', box: [81.3, 12, 165.1, 49.5] },
  { id: 'oh', th: 'พัดลมและวัดความร้อน', en: 'Fan and overheat sense', box: [165.1, 12, 267.4, 49.5] },
  { id: 'en', th: 'ปุ่มเปิดปิด', en: 'Enable toggler', box: [12, 49.5, 81.3, 101.6] },
  { id: 'lim', th: 'จำกัดกระแส', en: 'Adjustable current limit', box: [81.3, 49.5, 219.7, 101.6] },
  { id: 'drv', th: 'วงจรขับทอรอยด์', en: 'Toroid driver', box: [12, 101.6, 105.4, 171.4] },
  { id: 'mag', th: 'ไฟแสดงสนามแม่เหล็ก', en: 'Mag indicator', box: [105.4, 101.6, 153.7, 137.2] },
  { id: 'arc', th: 'จุดชนวน', en: 'Arc start', box: [153.7, 101.6, 267.4, 171.4] }];
let A = null;               // host API from app.js
let svg, gUL, gW, gJ, gHit, gLab, dotPath, tip, frameEl;
let block = 'drv', view = null, target = null, dark = false;
const pinIx = {}; S.pins.forEach((p, i) => { pinIx[p[0] + '.' + p[1]] = i; });
const fragOfPin = new Int32Array(S.pins.length).fill(-1); S.frags.forEach((f, i) => f.pins.forEach((p) => { fragOfPin[p] = i; }));
const segOff = new Float64Array(S.segs.length), segI = new Float64Array(S.segs.length), pinI = new Float64Array(S.pins.length);
const segEls = [], hitEls = [];
const opt = { dots: true, volt: false, vals: false, mode: 'inst', speed: 6, i0: 1e-3, size: 1, sw2: false, oh: false };
let arcPh = 0;

/* ---------------- physics of each part: current into every pin ---------------- */
function dcModel() {
  const { P, OP } = A.get(); if (!OP) return null;
  const Vin = P.Vdd, Vdrv = OP.Vdd, Idrv = OP.avg.in / OP.Vdd, RV1 = P.RV1 ?? 0;
  const IR9 = Vdrv / 10e3, IU4q = 60e-6, IR7 = Idrv + IR9 + IU4q, Io = 1e-3 * IR7 * 0.05, IL1 = IR7 + Io;
  // with Vdrive near Vin the buck sits in dropout (switch always on); its conduction loss shows up as extra input current
  const D = Math.min(1, (Vdrv + IR7 * 0.05) / Vin), IU3q = 0.1e-3, IU3in = IL1 * D + IU3q + (OP.buck || 0) / Vin;
  const ID4 = (5 - 2.8) / 10e3, IU5q = 10e-6, IU7q = 25e-6, ID7 = opt.oh ? (5 - 2.0) / 470 : 0, IrvBot = 0.5e-3;
  const I5 = IrvBot + ID4 + IU5q + IU7q + ID7, IU2q = 50e-6, I5in = I5 + IU2q;
  const pressed = opt.sw2 || A.get().mode === 'strike', IU6q = 0.3e-3, IR17 = pressed ? 12 / 470 : 0;
  const I12 = IU6q + I5in + IR17, IU1q = 20e-6, I12in = I12 + IU1q, ID2 = (Vin - 2.9) / 100e3, Iin = IU3in + I12in + ID2;
  return { Vin, Vdrv, Idrv, RV1, IR9, IU4q, IR7, Io, IL1, D, IU3q, IU3in, ID4, IU5q, IU7q, ID7, IrvBot, I5, IU2q, I5in, pressed, IU6q, IR17, I12, IU1q, I12in, ID2, Iin,
    VFb: Math.min(0.75, Io * (4700 + RV1)), Ilim: 0.75 / (1e-3 * 0.05 * (4700 + RV1)) };
}
function arcState() {
  const out = (arcPh % 1) < 0.5, frac = ((arcPh % 1) * 2) % 1;
  return { out, frac, IR16: (out ? 1 : -1) * 1.3e-3 * (1 - 0.6 * frac) };
}
function driverState() {
  const g = A.get(), s = g.s;
  if (!s) return null;
  if (opt.mode === 'inst') return s;
  const Idrv = g.OP.avg.in / g.OP.Vdd;
  return { ...s, I2: Idrv, I1: 0, Id: Idrv, Icoss: 0, Igate: 0, Ic16: 0, Ir13: 0, Itvs: 0, Ip: 0 };
}
function fillPins() {
  pinI.fill(0);
  const dc = dcModel(), s = driverState(), g = A.get(); if (!dc || !s) return null;
  const a = arcState(), set = (k, v) => { const i = pinIx[k]; if (i !== undefined) pinI[i] = v; };
  const two = (ref, pa, pb, I) => { set(ref + '.' + pa, I); set(ref + '.' + pb, -I); };
  // toroid driver, from the live circuit simulation
  two('L2', 1, 2, s.I2); two('L100', 2, 1, s.I1);
  for (const c of ['C1', 'C2', 'C3', 'C4']) two(c, 1, 2, s.I1 / 4);
  for (const q of ['Q1', 'Q2']) { set(q + '.2', (s.Id + s.Icoss) / 2); set(q + '.1', s.Igate / 2); set(q + '.3', -(s.Id + s.Icoss) / 2 - s.Igate / 2); }
  for (const r of ['R1', 'R2', 'R3', 'R4']) two(r, 1, 2, s.Igate / 4);
  two('C16', 1, 2, s.Ic16); two('R13', 2, 1, s.Ir13); two('D5', 2, 1, s.Itvs); two('R14', 2, 1, s.Itvs);
  set('RV2.3', dc.IrvBot + s.Ir13); set('RV2.1', -dc.IrvBot); set('RV2.2', -s.Ir13);
  // current limit (LMR14050 buck at near full duty, INA139 sense on R7)
  two('R7', 1, 2, dc.IR7); two('R9', 1, 2, dc.IR9); two('L1', 1, 2, dc.IL1); two('D3', 2, 1, dc.IL1 * (1 - dc.D));
  set('U4.3', dc.Io); set('U4.5', dc.IU4q); set('U4.1', -dc.Io); set('U4.2', -dc.IU4q);
  two('R8', 1, 2, dc.Io); two('RV1', 2, 1, dc.Io);
  const Iloss = dc.IU3in - dc.IL1 * dc.D - dc.IU3q;
  set('U3.2', dc.IU3in); set('U3.8', -dc.IL1 * dc.D); set('U3.7', -(dc.IU3q + Iloss) / 2); set('U3.9', -(dc.IU3q + Iloss) / 2);
  // rails, LEDs, logic
  two('J1', 2, 1, dc.Iin); two('D2', 2, 1, dc.ID2); two('R5', 1, 2, dc.ID2);
  set('U1.5', dc.I12in); set('U1.1', -dc.I12); set('U1.2', -dc.IU1q);
  set('U2.3', dc.I5in); set('U2.2', -dc.I5); set('U2.1', -dc.IU2q);
  set('U5.5', dc.ID4 + dc.IU5q); set('U5.2', -dc.IU5q); set('U5.4', -dc.ID4); two('R12', 2, 1, dc.ID4); two('D4', 2, 1, dc.ID4);
  set('U7.5', dc.IU7q); set('U7.3', dc.ID7); set('U7.2', -(dc.IU7q + dc.ID7)); two('D7', 2, 1, dc.ID7); two('R20', 1, 2, dc.ID7);
  // arc start: MIC1557 runs whenever +12 V is up; SW2 connects it to Q3 and T1 (pulse shape is illustrative)
  const IR18 = dc.pressed && a.out ? 12 / 1e3 : 0, x = IR18 + a.IR16;
  set('U6.5', -x); set('U6.4', dc.IU6q + Math.max(0, x)); set('U6.2', -(dc.IU6q + Math.max(0, -x)));
  two('R16', 1, 2, a.IR16); two('C18', 1, 2, a.IR16); two('SW2', 1, 2, IR18); two('R18', 1, 2, IR18);
  const Ipri = dc.pressed && a.out ? 0.3 * a.frac : 0;
  two('T1', 1, 2, Ipri); two('Q3', 2, 3, Ipri); two('R17', 1, 2, dc.IR17); two('C19', 1, 2, dc.IR17 - Ipri);
  // mag indicator: L101 picks up the coil field, D6 conducts on one half cycle (scale is illustrative)
  const pk = g.OP.an.pk.I1 || 1, Imag = opt.mode === 'inst' ? 4e-3 * Math.max(0, s.I1 / pk) * Math.min(1, pk / 3) : 4e-3 / Math.PI * Math.min(1, pk / 3);
  two('D6', 2, 1, Imag); two('L101', 2, 1, Imag); two('R15', 1, 2, Imag);
  return { dc, s, a, Ipri, IR18, Imag };
}
function netV(fi, st) {
  const f = S.frags[fi], { dc, s, a } = st, n = f.name;
  const byName = { '+VDC': dc.Vin, Vdc: dc.Vin, '+12V': 12, '+5V': 5, GND: 0, Vdrive: dc.Vdrv, "Reg'd": dc.Vdrv + dc.IR7 * 0.05, Sw: dc.Vin * dc.D, Fb: dc.VFb,
    en_toggle: 5, bias: A.get().P.Vbias, 'gate drive': s.Vg, drain: s.Vd, hv: s.Vhv };
  if (n in byName) return byName[n];
  const has = (k) => f.pins.includes(pinIx[k]);
  if (has('J1.1')) return dc.Vin;
  if (has('Q1.1') || has('Q2.1')) return s.Vg;
  if (has('R14.2')) return s.Itvs * 470;
  if (has('R5.1')) return dc.Vin - 2.9;
  if (has('D4.2')) return 2.8;
  if (has('RV1.2')) return dc.Io * dc.RV1;
  if (has('T1.1')) return 12 - (dc.pressed ? 0.6 : 0);
  if (has('U6.5')) return a.out ? 12 : 0;
  if (has('Q3.1')) return dc.pressed && a.out ? 12 : 0;
  if (has('U6.1')) return a.out ? 4 + 4 * a.frac : 8 - 4 * a.frac;
  if (has('R20.1')) return opt.oh ? 0.4 + 470 * dc.ID7 : 5;
  if (has('R20.2')) return opt.oh ? 0.4 : 5;
  return null;
}

/* ---------------- drawing ---------------- */
const el = (tag, at, parent) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); parent.appendChild(e); return e; };
const WIRE = () => dark ? '#98C379' : '#009600', DOT = () => dark ? '#E5C07B' : '#e08a00';
function vColor(v) {
  if (v === null || v === undefined || !isFinite(v)) return WIRE();
  const t = Math.sign(v) * Math.min(1, Math.log10(1 + Math.abs(v)) / Math.log10(1001)), c = t < 0 ? [44, 95, 184] : [200, 40, 30], m = dark ? [150, 160, 150] : [120, 140, 120];
  const u = Math.abs(t) ** 0.8; return `rgb(${m.map((x, i) => Math.round(x + (c[i] - x) * u)).join(',')})`;
}
function build() {
  svg = $('#schem'); frameEl = $('#schframe'); tip = $('#schtip');
  svg.innerHTML = ''; svg.setAttribute('viewBox', '0 0 279.4 215.9');
  gUL = el('g', {}, svg); gUL.innerHTML = S.underlay;
  gW = el('g', { fill: 'none', 'stroke-width': 0.1524, 'stroke-linecap': 'round' }, svg);
  S.segs.forEach((g) => segEls.push(el('path', { d: `M${g[0]} ${g[1]}L${g[2]} ${g[3]}` }, gW)));
  gJ = el('g', {}, svg); S.junc.forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 0.4572 }, gJ));
  dotPath = el('path', { stroke: 'none' }, svg);
  gLab = el('g', { 'font-family': 'LM Mono, monospace', 'font-size': 1.5 }, svg);
  gHit = el('g', { fill: 'none', stroke: 'transparent', 'stroke-width': 1.6, 'pointer-events': 'stroke' }, svg);
  S.segs.forEach((g, i) => { const h = el('path', { d: `M${g[0]} ${g[1]}L${g[2]} ${g[3]}` }, gHit); h.dataset.seg = i; hitEls.push(h); });
  for (const c of S.syms) if (/^(R|C|L|D|Q|U|T|J|SW|RV)\d/.test(c.ref)) { const h = el('circle', { cx: c.x, cy: c.y, r: 2.4, fill: 'transparent', stroke: 'none', 'pointer-events': 'all' }, gHit); h.dataset.sym = c.ref; }
  recolor(); buildTabs(); bindView(); bindCtl();
  setBlock(block, true);
}
function recolor() {
  gJ.setAttribute('fill', WIRE());
  if (!opt.volt) segEls.forEach((e) => e.setAttribute('stroke', WIRE()));
  dotPath.setAttribute('fill', DOT());
  frameEl.classList.toggle('dark', dark);
}
async function setDark(on) {
  dark = on;
  if (on && !window.SHEET_DARK) await new Promise((res) => { const s = document.createElement('script'); s.src = 'sheet_dark.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  gUL.innerHTML = on && window.SHEET_DARK ? window.SHEET_DARK : S.underlay; recolor();
}
function buildTabs() {
  const host = $('#shtabs'); host.innerHTML = '';
  for (const b of BLOCKS) { const t = document.createElement('button'); t.type = 'button'; t.dataset.b = b.id; t.setAttribute('role', 'tab'); t.textContent = A.tr(b.th, b.en); t.onclick = () => setBlock(b.id); host.appendChild(t); }
  host.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.b === block));
}
function boxOf(id) { const b = BLOCKS.find((x) => x.id === id).box, pad = id === 'all' ? 0 : 1.2; return [b[0] - pad, b[1] - pad, b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad]; }
function setBlock(id, now) {
  block = id; const b = boxOf(id); target = b.slice(); if (now || !view) view = b.slice();
  $('#shtabs').querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x.dataset.b === id); x.setAttribute('aria-selected', x.dataset.b === id); });
  sizeFrame(); const cap = BLOCKS.find((x) => x.id === id); $('#shname').textContent = A.tr(cap.th, cap.en);
}
function sizeFrame() {
  const b = boxOf(block), w = frameEl.clientWidth || 600, h = Math.min(w * b[3] / b[2], innerHeight * 0.72);
  svg.style.height = Math.max(180, h) + 'px';
}
function applyView() {
  if (target) { let done = true; for (let k = 0; k < 4; k++) { const d = target[k] - view[k]; if (Math.abs(d) > 0.02) done = false; view[k] += d * 0.22; } if (done) { view = target.slice(); target = null; } }
  svg.setAttribute('viewBox', view.map((v) => v.toFixed(2)).join(' '));
}
function bindView() {
  const toSheet = (ev) => { const r = svg.getBoundingClientRect(), sc = Math.max(view[2] / r.width, view[3] / r.height), ox = view[0] + (view[2] - r.width * sc) / 2, oy = view[1] + (view[3] - r.height * sc) / 2; return [ox + (ev.clientX - r.left) * sc, oy + (ev.clientY - r.top) * sc, sc]; };
  const zoom = (f, cx, cy) => { const v = target || view; const nw = Math.min(280, Math.max(12, v[2] * f)), k = nw / v[2]; target = [cx - (cx - v[0]) * k, cy - (cy - v[1]) * k, nw, v[3] * k]; };
  svg.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const [x, y] = toSheet(e); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y); }, { passive: false });
  $('#zin').onclick = () => { const v = target || view; zoom(1 / 1.4, v[0] + v[2] / 2, v[1] + v[3] / 2); };
  $('#zout').onclick = () => { const v = target || view; zoom(1.4, v[0] + v[2] / 2, v[1] + v[3] / 2); };
  $('#zfit').onclick = () => setBlock(block);
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && view[2] >= boxOf(block)[2] * 0.98) return; drag = { x: e.clientX, y: e.clientY, v: view.slice(), moved: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (drag) { const r = svg.getBoundingClientRect(), sc = Math.max(view[2] / r.width, view[3] / r.height), dx = (e.clientX - drag.x) * sc, dy = (e.clientY - drag.y) * sc;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) drag.moved = true; if (drag.moved) { target = null; view = [drag.v[0] - dx, drag.v[1] - dy, drag.v[2], drag.v[3]]; return; } }
    hover(e);
  });
  svg.addEventListener('pointerup', (e) => { const d = drag; drag = null; if (d && d.moved) return; hover(e, true); if (block === 'all' && !e.target.dataset.seg && !e.target.dataset.sym) { const [x, y] = toSheet(e); const b = BLOCKS.find((q) => q.id !== 'all' && x > q.box[0] && x < q.box[2] && y > q.box[1] && y < q.box[3]); if (b) setBlock(b.id); } });
  svg.addEventListener('pointerleave', () => { if (!drag) tip.classList.remove('on'); });
  svg.style.touchAction = 'pan-y';
}
let tipKey = null;
function hover(e, pin) {
  const t = e.target, r = frameEl.getBoundingClientRect();
  if (t.dataset && t.dataset.seg !== undefined) tipKey = ['seg', +t.dataset.seg];
  else if (t.dataset && t.dataset.sym) tipKey = ['sym', t.dataset.sym];
  else { if (!pin) { tip.classList.remove('on'); tipKey = null; } return; }
  tip.style.left = Math.min(r.width - 230, Math.max(4, e.clientX - r.left + 12)) + 'px'; tip.style.top = Math.max(4, e.clientY - r.top + 14) + 'px';
  tip.classList.add('on'); fillTip();
}
function fillTip() {
  if (!tipKey || !LAST) return;
  const { si, tr } = A;
  if (tipKey[0] === 'seg') {
    const g = S.segs[tipKey[1]], f = S.frags[g[4]], v = netV(g[4], LAST), I = segI[tipKey[1]];
    const nm = f.name || f.pins.filter((p) => !S.pins[p][5]).slice(0, 3).map((p) => S.pins[p][0] + '.' + S.pins[p][1]).join(', ');
    tip.innerHTML = `<b>${nm}</b><br>${tr('แรงดัน', 'voltage')} ${v === null ? tr('ไม่ได้คำนวณ', 'not modelled') : si(v, 'V')}<br>${tr('กระแสในสายช่วงนี้', 'current in this wire')} ${si(Math.abs(I), 'A')}`;
  } else {
    const ref = tipKey[1], c = S.syms.find((q) => q.ref === ref), ps = S.pins.map((p, i) => [p, i]).filter(([p]) => p[0] === ref);
    const rows = ps.map(([p, i]) => `${p[2] && p[2] !== '~' ? p[2] : 'pin ' + p[1]} ${pinI[i] >= 0 ? '→' : '←'} ${si(Math.abs(pinI[i]), 'A')}`).join('<br>');
    const illus = /^(T1|Q3|R17|C19|SW2|R18|D6|L101|R15)$/.test(ref) ? `<br><i>${tr('ขนาดกระแสเป็นภาพประกอบ', 'current scale is illustrative')}</i>` : '';
    tip.innerHTML = `<b>${ref}</b> ${c ? c.val : ''}<br>${rows}${illus}`;
  }
}

/* ---------------- current solver and animation ---------------- */
let LAST = null;
function solve() {
  const st = fillPins(); if (!st) return null; LAST = st;
  S.segs.forEach((g, i) => { let I = 0; for (const p of g[5]) I += pinI[p]; segI[i] = I; });
  return st;
}
function frame(dtms) {
  if (!svg) return;
  const g = A.get(); if (g.running) arcPh += dtms * 0.0008;
  const st = solve(); applyView(); if (!st) return;
  if (opt.volt) S.segs.forEach((s, i) => segEls[i].setAttribute('stroke', vColor(netV(s[4], st))));
  const dt = dtms / 1000, i0 = opt.i0, ppm = Math.min(svg.clientWidth / view[2], svg.clientHeight / view[3]) || 4, sp = Math.max(1.2, 15 / ppm), d = [];
  if (opt.dots) S.segs.forEach((s, i) => {
    const I = segI[i], a = Math.abs(I); if (a < i0 * 0.3) return;
    const lg = Math.log10(1 + a / i0), v = Math.sign(I) * opt.speed * (0.4 + lg);
    if (g.running) segOff[i] = (segOff[i] + v * dt) % 1e5;
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]); if (L < 0.01) return;
    const ux = (s[2] - s[0]) / L, uy = (s[3] - s[1]) / L, r = Math.min(4, (1.4 + 0.6 * lg) * opt.size) / ppm;
    let u = segOff[i] + Math.ceil((s[6] - segOff[i]) / sp) * sp;
    for (; u <= s[6] + L; u += sp) { const t = u - s[6], x = s[0] + ux * t, y = s[1] + uy * t; d.push(`M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`); }
  });
  dotPath.setAttribute('d', d.join(''));
  if (opt.vals) drawVals(); else if (gLab.firstChild) gLab.innerHTML = '';
  if (tip.classList.contains('on')) fillTip();
}
let valT = 0;
function drawVals() {
  const now = performance.now(); if (now - valT < 150) return; valT = now;
  gLab.innerHTML = ''; const placed = [], { si } = A, bg = dark ? '#282C34' : '#ffffff', fg = dark ? '#E5C07B' : '#7a4a00';
  for (const c of S.syms) {
    if (!/^(R|C|L|D|J|SW|T)\d/.test(c.ref)) continue;
    const ps = S.pins.map((p, i) => [p, i]).filter(([p]) => p[0] === c.ref); if (ps.length < 2) continue;
    const [pa, ia] = ps[0], [pb] = ps[1], I = pinI[ia]; if (Math.abs(I) < opt.i0) continue;
    const dx = pb[3] - pa[3], dy = pb[4] - pa[4], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, vert = Math.abs(dy) > Math.abs(dx);
    const x = c.x + (vert ? -3.4 : 0), y = c.y + (vert ? 0.5 : 3.2), s = (I >= 0 ? 1 : -1), ax = dx / L * s, ay = dy / L * s;
    const txt = si(Math.abs(I), 'A', 2), w = txt.length * 0.9 + 2.2;
    if (placed.some((q) => Math.abs(q[0] - x) < (q[2] + w) / 2 + 0.3 && Math.abs(q[1] - y) < 2.4)) continue; placed.push([x, y, w]);
    el('rect', { x: x - w / 2, y: y - 1.25, width: w, height: 2.1, rx: 0.5, fill: bg, 'fill-opacity': 0.88, stroke: fg, 'stroke-width': 0.08 }, gLab);
    const t = el('text', { x: x + 0.9, y: y + 0.45, 'text-anchor': 'middle', fill: fg }, gLab); t.textContent = txt;
    const tx = x - w / 2 + 1.1, ty = y - 0.2;
    el('path', { d: `M${tx + ax * 0.6} ${ty + ay * 0.6}L${tx - ax * 0.5 + ay * 0.45} ${ty - ay * 0.5 - ax * 0.45}L${tx - ax * 0.5 - ay * 0.45} ${ty - ay * 0.5 + ax * 0.45}Z`, fill: fg }, gLab);
    void nx; void ny;
  }
}

/* ---------------- controls ---------------- */
function logI0(v) { return 10 ** (-6 + 5 * v / 100); }
function bindCtl() {
  const on = (id, f) => { $(id).addEventListener('input', f); f(); };
  on('#cDots', () => { opt.dots = $('#cDots').checked; if (!opt.dots) dotPath.setAttribute('d', ''); });
  on('#cVolt', () => { opt.volt = $('#cVolt').checked; $('#vbar').hidden = !opt.volt; recolor(); });
  on('#cVals', () => { opt.vals = $('#cVals').checked; });
  $('#cDark').addEventListener('input', () => setDark($('#cDark').checked));
  on('#cMode', () => { opt.mode = $('#cMode').value; });
  on('#cSpd', () => { opt.speed = +$('#cSpd').value; $('#cSpdV').textContent = opt.speed.toFixed(0); });
  on('#cI0', () => { opt.i0 = logI0(+$('#cI0').value); $('#cI0V').textContent = A.si(opt.i0, 'A', 2); });
  on('#cSize', () => { opt.size = +$('#cSize').value; });
  on('#cOH', () => { opt.oh = $('#cOH').checked; });
  const sw = $('#cSW2'), press = (v) => { opt.sw2 = v; sw.classList.toggle('on', v); sw.setAttribute('aria-pressed', v); };
  sw.addEventListener('pointerdown', (e) => { e.preventDefault(); press(true); sw.setPointerCapture(e.pointerId); });
  sw.addEventListener('pointerup', () => press(false)); sw.addEventListener('pointercancel', () => press(false));
  sw.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') press(true); }); sw.addEventListener('keyup', () => press(false));
  let tmr = 0; const heavy = (f) => () => { f(); clearTimeout(tmr); tmr = setTimeout(() => A.recompute(), 450); };
  $('#cRV1').addEventListener('input', heavy(() => { const P = A.get().P; P.RV1 = +$('#cRV1').value; P.Ilim = 0.75 / (1e-3 * 0.05 * (4700 + P.RV1)); showRV(); }));
  $('#cRV2').addEventListener('input', heavy(() => { const P = A.get().P; P.Vbias = +$('#cRV2').value; showRV(); }));
  addEventListener('resize', () => sizeFrame());
}
function showRV() {
  const P = A.get().P, rv1 = P.RV1 ?? Math.max(0, Math.min(10e3, 15000 / P.Ilim - 4700));
  $('#cRV1').value = rv1; $('#cRV1V').textContent = `${A.si(rv1, 'Ω', 2)}, I_lim ${A.si(0.75 / (1e-3 * 0.05 * (4700 + rv1)), 'A', 3)}`.replace('I_lim', A.tr('จำกัดที่', 'limit'));
  $('#cRV2').value = P.Vbias; $('#cRV2V').textContent = P.Vbias.toFixed(2) + ' V';
}
window.SCH = {
  init(api) { A = api; build(); showRV(); window.SCH.lang(); },
  frame, sync: showRV,
  lang() { buildTabs(); setBlock(block, true); fillTip(); showRV(); const o = $('#cMode').options; o[0].textContent = A.tr('ค่าทันที', 'instantaneous'); o[1].textContent = A.tr('ค่าเฉลี่ย', 'average'); },
  resize: sizeFrame,
  summary() { return LAST; },
  debug() { return { segI: Array.from(segI), pinI: Array.from(pinI) }; },
};
})();
