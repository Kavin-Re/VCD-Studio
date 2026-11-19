/* ---------- data access, formatting ---------- */
function ub(d, x){ let lo = 0, hi = d.n; const t = d.t; while (lo < hi){ const m = (lo + hi) >>> 1; if (t[m] <= x) lo = m + 1; else hi = m; } return lo; }
function lb(d, x, lo){ lo = lo || 0; let hi = d.n; const t = d.t; while (lo < hi){ const m = (lo + hi) >>> 1; if (t[m] < x) lo = m + 1; else hi = m; } return lo; }
function idxAt(d, t){ return ub(d, t) - 1; }

function trimNum(v, sig){ if (v === 0) return '0'; const s = Math.abs(v) >= 1e21 ? v.toExponential(sig - 1) : String(parseFloat(v.toPrecision(sig))); return s; }
function fmtT(t, sig){
  if (t == null || !isFinite(t)) return '-';
  const sec = t * D.tsMag * UNIT_S[D.tsUnit], a = Math.abs(sec);
  if (a === 0) return '0 ' + D.tsUnit;
  let u = UNITS[UNITS.length - 1];
  for (const x of UNITS) if (a >= x[1] * 0.9999999){ u = x; break; }
  return trimNum(sec / u[1], sig || 6) + ' ' + u[0];
}
function fmtFreq(hz){
  if (!isFinite(hz) || hz <= 0) return '-';
  const U = [['THz',1e12],['GHz',1e9],['MHz',1e6],['kHz',1e3],['Hz',1]];
  for (const [n, f] of U) if (hz >= f * 0.9999999) return trimNum(hz / f, 5) + ' ' + n;
  return trimNum(hz, 4) + ' Hz';
}
function secPerUnit(){ return D.tsMag * UNIT_S[D.tsUnit]; }

function xzOf(d, idx){            // 0 clean, 1 has x, 2 z only
  if (!d.m || idx < 0) return 0;
  const o = idx * d.nw; let hx = false, hz = false;
  for (let k = 0; k < d.nw; k++){ const m = d.m[o + k], z = d.z[o + k]; if (m & ~z) hx = true; if (z) hz = true; }
  return hx ? 1 : hz ? 2 : 0;
}
function fmtReal(v){ return Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, '').replace(/\.?0+e/, 'e'); }

function fmtValue(d, idx, radix, w){
  if (idx < 0) return '-';
  if (d.real) return fmtReal(d.rv[idx]);
  const nw = d.nw, o = idx * nw, v = d.v, m = d.m, z = d.z;
  const bit = (arr, j) => (arr[o + (j >>> 5)] >>> (j & 31)) & 1;
  if (w === 1){ if (m && m[o]) return z[o] ? 'z' : 'x'; return String(v[o] & 1); }
  if (radix === 'b'){
    let s = '';
    for (let j = w - 1; j >= 0; j--) s += (m && bit(m, j)) ? (bit(z, j) ? 'z' : 'x') : bit(v, j);
    return s;
  }
  if (radix === 'h'){
    let s = '';
    for (let ni = ((w + 3) >> 2) - 1; ni >= 0; ni--){
      let nv = 0, xa = 0, za = 0, nb = 0;
      for (let j = ni * 4; j < ni * 4 + 4 && j < w; j++){
        nb++;
        if (m && bit(m, j)){ if (bit(z, j)) za++; else xa++; } else nv |= bit(v, j) << (j & 3);
      }
      if (xa + za === 0) s += nv.toString(16);
      else if (xa === nb) s += 'x'; else if (za === nb) s += 'z'; else s += xa ? 'X' : 'Z';
    }
    return s;
  }
  // decimal / signed
  if (m){ let any = false, all = true; for (let j = 0; j < w; j++){ if (bit(m, j)) any = true; else all = false; }
    if (any) return all ? 'x' : 'X'; }
  const signed = radix === 's';
  if (nw === 1){
    let u = v[o];
    if (signed){ if (w === 32) u = u | 0; else if ((u >>> (w - 1)) & 1) u = u - Math.pow(2, w); }
    return String(u);
  }
  let big = 0n; for (let k = nw - 1; k >= 0; k--) big = (big << 32n) | BigInt(v[o + k]);
  if (signed && bit(v, w - 1)) big -= (1n << BigInt(w));
  return big.toString();
}
function numAt(d, idx, signed, w){
  if (d.real) return d.rv[idx];
  if (xzOf(d, idx)) return NaN;
  const o = idx * d.nw;
  if (d.nw === 1){
    let u = d.v[o];
    if (signed){ if (w === 32) u = u | 0; else if ((u >>> (w - 1)) & 1) u -= Math.pow(2, w); }
    return u;
  }
  let u = d.v[o] + d.v[o + 1] * 4294967296;
  for (let k = 2; k < d.nw; k++) u += d.v[o + k] * Math.pow(2, 32 * k);
  if (signed && ((d.v[o + ((w - 1) >>> 5)] >>> ((w - 1) & 31)) & 1)) u -= Math.pow(2, w);
  return u;
}
function ensureXC(d){
  if (d.xcx || !d.m){ return; }
  const n = d.n, nw = d.nw; d.xcx = new Uint32Array(n + 1); d.xcz = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++){
    let x = 0, zz = 0;
    for (let k = 0; k < nw; k++){ const mk = d.m[i * nw + k], zk = d.z[i * nw + k]; if (mk & ~zk) x = 1; if (zk) zz = 1; }
    d.xcx[i + 1] = d.xcx[i] + x; d.xcz[i + 1] = d.xcz[i] + zz;
  }
}
function numRange(d, signed, w){
  const key = signed ? 's' : 'u';
  if (d.rng && d.rng[key]) return d.rng[key];
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < d.n; i++){ const v = numAt(d, i, signed, w); if (v === v){ if (v < mn) mn = v; if (v > mx) mx = v; } }
  if (!isFinite(mn)){ mn = 0; mx = 1; }
  d.rng = d.rng || {}; return d.rng[key] = [mn, mx];
}

/* ---------- global state ---------- */
const D = {tsMag:1, tsUnit:'ns', tmin:0, tmax:1, sigs:[], root:null, meta:{}, nChanges:0, name:'', demo:'', pathMap:new Map()};
const S = {rows:[], sel:-1, A:null, B:null, hover:null, hoverRow:-1, drag:null, theme:'light', tab:'measure', pnl:{}};
const V = {t0:0, t1:1};
let CL = {};
const $ = (s) => document.querySelector(s);
const el = {};
const RADIX_NEXT = {h:'b', b:'d', d:'s', s:'h'};
const RADIX_LBL = {b:'bin', h:'hex', d:'dec', s:'sdec'};
const H_DIG = 30, H_AN = 70;
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ el.toast.textContent = msg; el.toast.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.toast.classList.remove('on'), 2200); }

/* ---------- rows ---------- */
function newRow(sig){
  return {sig, radix: sig.width === 1 ? 'b' : 'h', analog: !!sig.data.real, y:0, h:0};
}
function layoutRows(){
  let y = 0;
  for (const r of S.rows){ r.h = (r.analog && r.sig.width > 1 || r.sig.data.real) ? H_AN : H_DIG; r.y = y; y += r.h; }
  S.totalH = y;
}
function addSignal(sig, opts){
  if (S.rows.some(r => r.sig === sig)) return null;
  const r = newRow(sig); if (opts) Object.assign(r, opts);
  S.rows.push(r); return r;
}
function afterRowsChange(){
  layoutRows(); renderNames(); markTree(); resizeCanvas(); requestDraw(); updateValues(); updateHash(); renderPanel();
}
function removeRowAt(i){ S.rows.splice(i, 1); if (S.sel >= S.rows.length) S.sel = S.rows.length - 1; afterRowsChange(); }
function moveRow(i, to){
  to = Math.max(0, Math.min(S.rows.length - 1, to)); if (i === to || i < 0) return;
  const [r] = S.rows.splice(i, 1); S.rows.splice(to, 0, r);
  if (S.sel === i) S.sel = to; afterRowsChange();
}
function selRow(){ return S.sel >= 0 ? S.rows[S.sel] : null; }
function selectRow(i){ S.sel = i; for (const e of el.names.children) e.classList.toggle('sel', +e.dataset.i === i); requestDraw(); renderPanel(); }

function renderNames(){
  el.names.textContent = '';
  S.rows.forEach((r, i) => {
    const e = document.createElement('div');
    e.className = 'nrow' + (i === S.sel ? ' sel' : ''); e.dataset.i = i; e.style.height = r.h + 'px'; e.draggable = true;
    const rng = r.sig.range || (r.sig.width > 1 ? '[' + (r.sig.width - 1) + ':0]' : '');
    e.innerHTML = '<span class="grip" title="drag to reorder">&#8942;&#8942;</span><span class="nm" title="' + esc(r.sig.path) + '">' + esc(r.sig.name) + '<small>' + esc(rng) + '</small></span>' +
      '<span class="val"></span><span class="valb"></span>' +
      (r.sig.width > 1 && !r.sig.data.real ? '<button class="rdx" title="radix (R)">' + RADIX_LBL[r.radix] + '</button><button class="an' + (r.analog ? ' on' : '') + '" title="analog view (G)">~</button>' : '<span style="width:22px"></span><span style="width:22px"></span>') +
      '<button class="rm" title="remove (Del)">&times;</button>';
    e.addEventListener('click', ev => {
      const t = ev.target;
      if (t.classList.contains('rm')) return removeRowAt(i);
      if (t.classList.contains('rdx')) { cycleRadix(i); return; }
      if (t.classList.contains('an')) { toggleAnalog(i); return; }
      selectRow(i);
    });
    e.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', String(i)); ev.dataTransfer.effectAllowed = 'move'; S.dragRow = i; });
    e.addEventListener('dragover', ev => { ev.preventDefault(); e.classList.add('dragover'); });
    e.addEventListener('dragleave', () => e.classList.remove('dragover'));
    e.addEventListener('drop', ev => { ev.preventDefault(); ev.stopPropagation(); e.classList.remove('dragover'); const from = S.dragRow; S.dragRow = -1; if (from >= 0 && from !== i) moveRow(from, i); });
    el.names.appendChild(e);
  });
  el.names.style.height = Math.max(S.totalH || 0, 0) + 'px';
  el.empty.style.display = S.rows.length ? 'none' : 'flex';
}
function cycleRadix(i){ const r = S.rows[i]; r.radix = RADIX_NEXT[r.radix]; const b = el.names.children[i].querySelector('.rdx'); if (b) b.textContent = RADIX_LBL[r.radix]; updateValues(); requestDraw(); updateHash(); }
function toggleAnalog(i){ const r = S.rows[i]; if (r.sig.width < 2 && !r.sig.data.real) return; r.analog = !r.analog; afterRowsChange(); }

function updateValues(){
  const kids = el.names.children;
  S.rows.forEach((r, i) => {
    const e = kids[i]; if (!e) return;
    const va = e.querySelector('.val'), vb = e.querySelector('.valb'), d = r.sig.data;
    const set = (node, t) => {
      if (t == null){ node.textContent = ''; node.title = ''; node.className = node.classList.contains('val') ? 'val' : 'valb'; return; }
      const ix = idxAt(d, t), s = fmtValue(d, ix, r.radix, r.sig.width), x = xzOf(d, ix);
      node.textContent = s; node.title = s;
      node.className = (node.classList.contains('val') ? 'val' : 'valb') + (x === 1 ? ' x' : x === 2 ? ' z' : '');
    };
    set(va, S.A); set(vb, S.B);
  });
  el.cA.textContent = S.A == null ? '-' : fmtT(S.A);
  el.cB.textContent = S.B == null ? '-' : fmtT(S.B);
  if (S.A != null && S.B != null){
    const dt = Math.abs(S.B - S.A); el.cD.textContent = fmtT(dt);
    el.cF.textContent = dt > 0 ? '(1/Δ = ' + fmtFreq(1 / (dt * secPerUnit())) + ')' : '';
  } else { el.cD.textContent = '-'; el.cF.textContent = ''; }
}

/* ---------- view / viewport ---------- */
let dpr = 1, W = 600, Hh = 300, needDraw = false, anim = null;
function clampView(a, b){
  let span = b - a; const full = Math.max(1, D.tmax - D.tmin);
  span = Math.max(4, Math.min(span, full * 50 + 10));
  const mid = (a + b) / 2; a = mid - span / 2; b = mid + span / 2;
  if (a < D.tmin - span * 0.9){ a = D.tmin - span * 0.9; b = a + span; }
  if (b > D.tmax + span * 0.9){ b = D.tmax + span * 0.9; a = b - span; }
  return [a, b];
}
function setView(a, b, animate){
  [a, b] = clampView(a, b);
  if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
  if (!animate || window.__noAnim){ V.t0 = a; V.t1 = b; requestDraw(); return; }
  const s0 = V.t0, s1 = V.t1, c0 = (s0 + s1) / 2, c1 = (a + b) / 2, l0 = Math.log(s1 - s0), l1 = Math.log(b - a), t0 = performance.now(), dur = 160;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    const c = c0 + (c1 - c0) * e, sp = Math.exp(l0 + (l1 - l0) * e);
    V.t0 = c - sp / 2; V.t1 = c + sp / 2; drawNow();
    if (k < 1) anim.raf = requestAnimationFrame(step); else { anim = null; V.t0 = a; V.t1 = b; requestDraw(); }
  };
  anim = {raf: requestAnimationFrame(step)};
}
function fitView(animate){ const span = Math.max(1, D.tmax - D.tmin); setView(D.tmin - span * 0.01, D.tmax + span * 0.01, animate); }
function zoomBy(f, focus, animate){
  const c = focus != null ? focus : (S.A != null && S.A >= V.t0 && S.A <= V.t1 ? S.A : (V.t0 + V.t1) / 2);
  setView(c - (c - V.t0) * f, c + (V.t1 - c) * f, animate);
}
function panBy(frac, animate){ const sp = V.t1 - V.t0; setView(V.t0 + sp * frac, V.t1 + sp * frac, animate); }
function centerOn(t, animate){
  if (t >= V.t0 && t <= V.t1) return;
  const sp = V.t1 - V.t0; setView(t - sp / 2, t + sp / 2, animate);
}
function requestDraw(){ if (needDraw) return; needDraw = true; requestAnimationFrame(() => { needDraw = false; drawNow(); }); }
function resizeCanvas(){
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const rows = el.rows;
  Hh = Math.max(40, rows.clientHeight); el.cwrap.style.height = Hh + 'px';
  W = Math.max(50, el.cwrap.clientWidth);
  el.cv.width = Math.round(W * dpr); el.cv.height = Math.round(Hh * dpr);
  el.hdr.style.paddingRight = (rows.offsetWidth - rows.clientWidth) + 'px';
  const rwid = el.ruler.clientWidth; el.ruler.width = Math.round(rwid * dpr); el.ruler.height = Math.round(44 * dpr);
  requestDraw();
}

/* ---------- colours / theme ---------- */
function loadColors(){
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  CL = {bg:g('--panel'), ink:g('--ink'), muted:g('--muted'), line:g('--line'), w1:g('--w1'), bus:g('--wbus'), x:g('--wx'), z:g('--wz'), an:g('--wan'),
        A:g('--curA'), B:g('--curB'), grid:g('--grid'), gridmaj:g('--gridmaj'), alt:g('--rowalt'), sel:g('--sel'), panel2:g('--panel2')};
}
function setTheme(t){
  S.theme = t; document.documentElement.dataset.theme = t; loadColors(); requestDraw();
  try { localStorage.setItem('vcdstudio.theme', t); } catch (e) {}
}

/* ---------- ruler / ticks ---------- */
function niceStep(raw){ const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }
function tickInfo(t0, ppt){
  const step = niceStep(110 / ppt), sps = secPerUnit();
  const stepSec = step * sps; let u = UNITS[UNITS.length - 1];
  for (const x of UNITS) if (stepSec >= x[1] * 0.9999999){ u = x; break; }
  const dec = Math.max(0, Math.min(9, -Math.floor(Math.log10(stepSec / u[1]) + 1e-9)));
  return {step, unit:u, dec};
}
function tickLabel(t, ti){ const v = t * secPerUnit() / ti.unit[1]; return (Math.abs(v) < 1e-12 ? '0' : v.toFixed(ti.dec)) + ' ' + ti.unit[0]; }

function drawRulerOn(ctx, Wp, hgt, ppt, t0, showCur){
  ctx.fillStyle = CL.bg; ctx.fillRect(0, 0, Wp, hgt);
  ctx.font = '11px ui-monospace,Menlo,Consolas,monospace'; ctx.textBaseline = 'middle';
  const ti = tickInfo(t0, ppt), step = ti.step, minor = step / 5;
  const t1 = t0 + Wp / ppt;
  ctx.strokeStyle = CL.muted; ctx.fillStyle = CL.muted; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = Math.ceil(t0 / minor) * minor, c = 0; t <= t1 && c < 4000; t += minor, c++){ const x = Math.round((t - t0) * ppt) + .5; ctx.moveTo(x, hgt - 5); ctx.lineTo(x, hgt - 1); }
  ctx.stroke(); ctx.beginPath();
  const labs = [];
  for (let t = Math.ceil(t0 / step) * step, c = 0; t <= t1 && c < 1000; t += step, c++){ const x = Math.round((t - t0) * ppt) + .5; ctx.moveTo(x, hgt - 12); ctx.lineTo(x, hgt - 1); labs.push([x, t]); }
  ctx.stroke();
  ctx.textAlign = 'left';
  for (const [x, t] of labs) ctx.fillText(tickLabel(t, ti), x + 3, hgt - 20);
  if (showCur){
    const flag = (t, name, col) => {
      const x = (t - t0) * ppt; if (x < -40 || x > Wp + 40) return;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, hgt); ctx.lineTo(x - 5, hgt - 10); ctx.lineTo(x + 5, hgt - 10); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 11px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'left'; ctx.fillText(name, x + 6, 8);
    };
    if (S.A != null) flag(S.A, 'A ' + fmtT(S.A), CL.A);
    if (S.B != null) flag(S.B, 'B ' + fmtT(S.B), CL.B);
    if (S.A != null && S.B != null){
      const xa = (S.A - t0) * ppt, xb = (S.B - t0) * ppt, lo = Math.min(xa, xb), hi = Math.max(xa, xb);
      ctx.fillStyle = CL.ink; ctx.font = '11px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'center';
      const txt = 'Δ ' + fmtT(Math.abs(S.B - S.A)); const cx = Math.max(Math.min((lo + hi) / 2, Wp - 50), 50);
      ctx.fillText(txt, cx, 22);
      ctx.strokeStyle = CL.ink; ctx.beginPath(); ctx.moveTo(lo, 28); ctx.lineTo(hi, 28); ctx.stroke();
    }
  }
}

/* ---------- waveform drawing ---------- */
const RUN = {xs:[], xe:[], i:[], j:[], dn:[]};
function buildRuns(d, t0, ppt, Wp, tEnd){
  RUN.xs.length = RUN.xe.length = RUN.i.length = RUN.j.length = RUN.dn.length = 0;
  const n = d.n; if (!n) return 0;
  const t = d.t, t1 = t0 + Wp / ppt, inv = 1 / ppt;
  let cur = ub(d, t0) - 1, k, xcur = 0;
  if (cur < 0){ if (t[0] >= t1) return 0; cur = 0; k = 1; xcur = (t[0] - t0) * ppt; } else k = cur + 1;
  const push = (xs, xe, i, j, dn) => { RUN.xs.push(xs); RUN.xe.push(xe); RUN.i.push(i); RUN.j.push(j); RUN.dn.push(dn); };
  while (k < n){
    const tk = t[k]; if (tk >= t1) break;
    const xk = (tk - t0) * ppt, c = Math.floor(xk);
    const j = lb(d, t0 + (c + 1) * inv, k + 1);
    if (j === k + 1){ push(xcur, xk, cur, cur, 0); cur = k; xcur = xk; k = j; }
    else { if (c > xcur) push(xcur, c, cur, cur, 0); push(c, c + 1, cur, j - 1, 1); cur = j - 1; xcur = c + 1; k = j; }
  }
  const xend = (Math.min(tEnd, t1) - t0) * ppt;
  if (xend > xcur) push(xcur, xend, cur, cur, 0);
  return RUN.xs.length;
}
let CW = 6.6;
function drawBit(ctx, r, y, Wp, t0, ppt){
  const d = r.sig.data, nr = buildRuns(d, t0, ppt, Wp, D.tmax);
  const top = y + 6, bot = y + r.h - 6, mid = (top + bot) / 2;
  ensureXC(d);
  ctx.lineWidth = 1.5; ctx.strokeStyle = CL.w1; ctx.beginPath();
  let first = true; const xz = [];
  for (let q = 0; q < nr; q++){
    const xs = RUN.xs[q], xe = RUN.xe[q], i = RUN.i[q];
    if (RUN.dn[q]){
      const j = RUN.j[q], xp = Math.round(xs) + .5;
      ctx.moveTo(xp, top); ctx.lineTo(xp, bot); first = true;
      if (d.xcx && d.xcx[j + 1] - d.xcx[i] > 0) xz.push([xs, xe, 1]); else if (d.xcz && d.xcz[j + 1] - d.xcz[i] > 0) xz.push([xs, xe, 2]);
      continue;
    }
    const s = xzOf(d, i); let yl;
    if (s){ yl = mid; xz.push([xs, xe, s]); } else yl = (d.v[i] & 1) ? top : bot;
    if (first){ ctx.moveTo(xs, yl); first = false; } else ctx.lineTo(xs, yl);
    ctx.lineTo(xe, yl);
  }
  ctx.stroke();
  for (const [xs, xe, s] of xz){
    if (s === 1){ ctx.fillStyle = CL.x; ctx.globalAlpha = .28; ctx.fillRect(xs, top, Math.max(1, xe - xs), bot - top); ctx.globalAlpha = 1; ctx.strokeStyle = CL.x; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xs, mid); ctx.lineTo(xe, mid); ctx.stroke(); }
    else { ctx.strokeStyle = CL.z; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xs, mid); ctx.lineTo(xe, mid); ctx.stroke(); ctx.setLineDash([]); }
  }
}
function drawBus(ctx, r, y, Wp, t0, ppt){
  const d = r.sig.data, nr = buildRuns(d, t0, ppt, Wp, D.tmax), w = r.sig.width;
  const top = y + 5, bot = y + r.h - 5, mid = (top + bot) / 2;
  ensureXC(d);
  ctx.lineWidth = 1.2; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = '11px ui-monospace,Menlo,Consolas,monospace';
  for (let q = 0; q < nr; q++){
    const xs = RUN.xs[q], xe = RUN.xe[q], i = RUN.i[q], wd = xe - xs;
    if (RUN.dn[q]){
      const j = RUN.j[q]; let col = CL.bus;
      if (d.xcx && d.xcx[j + 1] - d.xcx[i] > 0) col = CL.x; else if (d.xcz && d.xcz[j + 1] - d.xcz[i] > 0) col = CL.z;
      ctx.fillStyle = col; ctx.globalAlpha = .75; ctx.fillRect(xs, top, Math.max(1, wd), bot - top); ctx.globalAlpha = 1; continue;
    }
    if (wd < 0.5) continue;
    const s = xzOf(d, i), col = s === 1 ? CL.x : s === 2 ? CL.z : CL.bus, sl = Math.min(3, wd / 2);
    ctx.beginPath(); ctx.moveTo(xs + sl, top); ctx.lineTo(xe - sl, top); ctx.lineTo(xe, mid); ctx.lineTo(xe - sl, bot); ctx.lineTo(xs + sl, bot); ctx.lineTo(xs, mid); ctx.closePath();
    if (s){ ctx.globalAlpha = s === 1 ? .22 : .16; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = col; ctx.stroke();
    if (wd > 22){
      let txt = fmtValue(d, i, r.radix, w); const maxc = Math.floor((wd - 8) / CW);
      if (txt.length > maxc){ txt = maxc >= 3 ? txt.slice(0, maxc - 1) + '…' : ''; }
      if (txt){ ctx.fillStyle = s ? col : CL.ink; ctx.fillText(txt, (Math.max(xs, 0) + Math.min(xe, Wp)) / 2, mid + .5); }
    }
  }
}
function drawAnalog(ctx, r, y, Wp, t0, ppt){
  const d = r.sig.data, w = r.sig.width, signed = r.radix === 's';
  const nr = buildRuns(d, t0, ppt, Wp, D.tmax);
  const [mn, mx] = numRange(d, signed, w);
  const top = y + 8, bot = y + r.h - 6, span = mx - mn || 1;
  const Y = v => mx === mn ? (top + bot) / 2 : bot - (v - mn) / span * (bot - top);
  ctx.lineWidth = 1.5; ctx.strokeStyle = CL.an; ctx.beginPath(); let first = true; const bad = [];
  for (let q = 0; q < nr; q++){
    const xs = RUN.xs[q], xe = RUN.xe[q], i = RUN.i[q];
    if (RUN.dn[q]){
      const j = RUN.j[q], stride = Math.max(1, Math.floor((j - i + 1) / 48)); let lo = Infinity, hi = -Infinity;
      for (let k = i; k <= j; k += stride){ const v = numAt(d, k, signed, w); if (v === v){ if (v < lo) lo = v; if (v > hi) hi = v; } }
      const v2 = numAt(d, j, signed, w); if (v2 === v2){ if (v2 < lo) lo = v2; if (v2 > hi) hi = v2; }
      if (isFinite(lo)){ const xp = Math.round(xs) + .5; ctx.moveTo(xp, Y(lo)); ctx.lineTo(xp, Y(hi)); }
      first = true; continue;
    }
    const v = numAt(d, i, signed, w);
    if (v !== v){ bad.push([xs, xe]); first = true; continue; }
    const yl = Y(v);
    if (first){ ctx.moveTo(xs, yl); first = false; } else ctx.lineTo(xs, yl);
    ctx.lineTo(xe, yl);
  }
  ctx.stroke();
  for (const [xs, xe] of bad){ ctx.fillStyle = CL.x; ctx.globalAlpha = .25; ctx.fillRect(xs, top, Math.max(1, xe - xs), bot - top); ctx.globalAlpha = 1; }
  ctx.fillStyle = CL.muted; ctx.font = '10px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(r.sig.data.real ? fmtReal(mx) : fmtValue2(mx, r, w), 3, y + 1);
  ctx.textBaseline = 'bottom'; ctx.fillText(r.sig.data.real ? fmtReal(mn) : fmtValue2(mn, r, w), 3, y + r.h - 1);
}
function fmtValue2(v, r, w){ return r.radix === 'h' ? '0x' + Math.round(v).toString(16) : String(Math.round(v)); }

function paintWaves(ctx, Wp, Hp, scrollTop, t0, ppt, o){
  o = o || {};
  ctx.fillStyle = CL.bg; ctx.fillRect(0, 0, Wp, Hp);
  CW = ctx.measureText ? (ctx.font = '11px ui-monospace,Menlo,Consolas,monospace', ctx.measureText('0000000000').width / 10) : 6.6;
  // grid
  const ti = tickInfo(t0, ppt), t1 = t0 + Wp / ppt;
  ctx.lineWidth = 1; ctx.strokeStyle = CL.grid; ctx.beginPath();
  for (let t = Math.ceil(t0 / ti.step) * ti.step, c = 0; t <= t1 && c < 1000; t += ti.step, c++){ const x = Math.round((t - t0) * ppt) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, Hp); }
  ctx.stroke();
  // rows
  S.rows.forEach((r, i) => {
    const y = r.y - scrollTop; if (y + r.h < 0 || y > Hp) return;
    if (i === S.sel && !o.noSel){ ctx.fillStyle = CL.sel; ctx.fillRect(0, y, Wp, r.h); }
    else if (i & 1){ ctx.fillStyle = CL.alt; ctx.fillRect(0, y, Wp, r.h); }
    ctx.strokeStyle = CL.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y + r.h - .5); ctx.lineTo(Wp, y + r.h - .5); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(0, y, Wp, r.h); ctx.clip();
    if (r.sig.data.real || (r.analog && r.sig.width > 1)) drawAnalog(ctx, r, y, Wp, t0, ppt);
    else if (r.sig.width === 1) drawBit(ctx, r, y, Wp, t0, ppt);
    else drawBus(ctx, r, y, Wp, t0, ppt);
    ctx.restore();
  });
  // end-of-dump marker
  const xe = (D.tmax - t0) * ppt;
  if (xe >= 0 && xe <= Wp){ ctx.strokeStyle = CL.muted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(Math.round(xe) + .5, 0); ctx.lineTo(Math.round(xe) + .5, Hp); ctx.stroke(); ctx.setLineDash([]); }
  // cursors
  const cur = (t, col, dash) => {
    if (t == null) return; const x = Math.round((t - t0) * ppt) + .5; if (x < -2 || x > Wp + 2) return;
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; if (dash) ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hp); ctx.stroke(); ctx.setLineDash([]);
  };
  if (o.hover != null && !o.noHover) cur(o.hover, CL.muted, true);
  cur(S.A, CL.A); cur(S.B, CL.B);
  if (S.drag && S.drag.zoom && !o.noHover){
    const xa = (S.drag.a - t0) * ppt, xb = (S.drag.b - t0) * ppt; ctx.fillStyle = CL.sel; ctx.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), Hp);
  }
}
function drawNow(){
  if (!D.root) return;
  const ppt = W / (V.t1 - V.t0), ctx = el.cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintWaves(ctx, W, Hh, el.rows.scrollTop, V.t0, ppt, {hover: S.hover});
  const rc = el.ruler.getContext('2d'); rc.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawRulerOn(rc, el.ruler.clientWidth, 44, ppt, V.t0, true);
  if (S.drag && S.drag.zoom){ const xa = (S.drag.a - V.t0) * ppt, xb = (S.drag.b - V.t0) * ppt; rc.fillStyle = CL.sel; rc.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), 44); }
  el.sView.textContent = 'view ' + fmtT(V.t0, 5) + ' .. ' + fmtT(V.t1, 5) + '  (' + fmtT(V.t1 - V.t0, 4) + ')';
}
