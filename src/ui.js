/* ---------- search (edges / values) ---------- */
function edgeKindAt(d, k){          // returns 1 rising, -1 falling, 0 none (1-bit only; strict 0->1 / 1->0)
  if (k < 1) return 0;
  const cm = d.m ? d.m[k] : 0, pm = d.m ? d.m[k - 1] : 0; if (cm || pm) return 0;
  const c = d.v[k] & 1, p = d.v[k - 1] & 1;
  return c === 1 && p === 0 ? 1 : c === 0 && p === 1 ? -1 : 0;
}
function findEdge(row, from, dir, kind){
  const d = row.sig.data, n = d.n, one = row.sig.width === 1 && !d.real;
  const ok = (k) => { if (k < 1) return false; if (!one || kind === 'any') return true; const e = edgeKindAt(d, k); return kind === 'rise' ? e === 1 : e === -1; };
  if (dir > 0){ for (let k = ub(d, from); k < n; k++) if (ok(k)) return d.t[k]; }
  else { for (let k = lb(d, from) - 1; k >= 1; k--) if (ok(k)) return d.t[k]; }
  return null;
}
function parseMatch(str, row){
  const w = row.sig.width, nw = row.sig.data.nw; let s = str.trim().toLowerCase().replace(/_/g, '');
  if (!s) return null;
  if (s === 'x') return {kind:'x'}; if (s === 'z') return {kind:'z'};
  let radix = row.radix === 's' ? 'd' : row.radix, body = s, m;
  if ((m = /^(?:\d+)?'([bhd])(.+)$/.exec(s))){ radix = m[1]; body = m[2]; }
  else if (/^0x/.test(s)){ radix = 'h'; body = s.slice(2); }
  else if (/^0b/.test(s)){ radix = 'b'; body = s.slice(2); }
  let bits;
  if (radix === 'b'){ if (!/^[01xz]+$/.test(body)) return {err:'not a binary value'}; bits = body; }
  else if (radix === 'h'){ if (!/^[0-9a-fxz]+$/.test(body)) return {err:'not a hex value'}; bits = ''; for (const ch of body) bits += ch === 'x' ? 'xxxx' : ch === 'z' ? 'zzzz' : parseInt(ch, 16).toString(2).padStart(4, '0'); }
  else { if (!/^-?\d+$/.test(body)) return {err:'not a decimal value'}; let big = BigInt(body); const mod = 1n << BigInt(w); big = ((big % mod) + mod) % mod; bits = big.toString(2); }
  const sv = new Uint32Array(nw), sm = new Uint32Array(nw), sz = new Uint32Array(nw);
  const arr = []; for (const ch of bits) arr.push(ch.charCodeAt(0));
  packBits(arr, arr.length, w, sv, sm, sz, nw);
  return {kind:'val', sv, sm, sz};
}
function matchAt(d, k, T){
  const nw = d.nw, o = k * nw;
  if (T.kind === 'x'){ return !!d.m && xzOf(d, k) === 1; }
  if (T.kind === 'z'){ if (!d.m) return false; for (let q = 0; q < nw; q++) if (d.z[o + q]) return true; return false; }
  for (let q = 0; q < nw; q++){
    if (d.v[o + q] !== T.sv[q]) return false;
    if ((d.m ? d.m[o + q] : 0) !== T.sm[q] || (d.z ? d.z[o + q] : 0) !== T.sz[q]) return false;
  }
  return true;
}
function findMatch(row, from, dir, T){
  const d = row.sig.data, n = d.n;
  if (dir > 0){ for (let k = ub(d, from); k < n; k++) if (matchAt(d, k, T) && (k === 0 || !matchAt(d, k - 1, T))) return d.t[k]; }
  else { for (let k = lb(d, from) - 1; k >= 0; k--) if (matchAt(d, k, T) && (k === 0 || !matchAt(d, k - 1, T))) return d.t[k]; }
  return null;
}
function gotoTime(t, msg){
  S.A = t; centerOn(t, true); updateValues(); requestDraw(); updateHash(); if (msg) toast(msg + ' ' + fmtT(t)); renderPanel();
}
function doEdge(dir){
  const r = selRow(); if (!r){ toast('Select a signal row first (click its name)'); return; }
  const from = S.A != null ? S.A : V.t0;
  const t = findEdge(r, from, dir, el.edgeKind.value);
  if (t == null) toast('No ' + (dir > 0 ? 'next' : 'previous') + ' edge for ' + r.sig.name); else gotoTime(t, r.sig.name + ' edge at');
}
function doMatch(dir){
  const r = selRow(); if (!r){ toast('Select a signal row first (click its name)'); return; }
  const T = parseMatch(el.matchIn.value, r);
  if (!T){ el.matchMsg.textContent = 'type a value first'; el.matchIn.focus(); return; }
  if (T.err){ el.matchMsg.textContent = T.err + ' (radix ' + RADIX_LBL[r.radix] + ')'; return; }
  const t = findMatch(r, S.A != null ? S.A : (dir > 0 ? V.t0 - 1 : V.t1 + 1), dir, T);
  if (t == null){ el.matchMsg.textContent = 'no ' + (dir > 0 ? 'later' : 'earlier') + ' match'; return; }
  el.matchMsg.textContent = ''; gotoTime(t, 'match at');
}

/* ---------- measurements ---------- */
function summarize(arr){
  if (!arr.length) return null;
  let s = 0, mn = Infinity, mx = -Infinity; for (const v of arr){ s += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const mean = s / arr.length; let q = 0; for (const v of arr) q += (v - mean) * (v - mean);
  return {n:arr.length, mean, min:mn, max:mx, sd:Math.sqrt(q / arr.length)};
}
function edgeLists(d, ta, tb){
  const rise = [], fall = [];
  for (let k = Math.max(1, lb(d, ta)); k < d.n && d.t[k] <= tb; k++){ const e = edgeKindAt(d, k); if (e === 1) rise.push(d.t[k]); else if (e === -1) fall.push(d.t[k]); }
  return {rise, fall};
}
function diffs(a){ const o = []; for (let i = 1; i < a.length; i++) o.push(a[i] - a[i - 1]); return o; }
function measureRow(r, ta, tb){
  const d = r.sig.data, out = {range:[ta, tb]};
  const i0 = lb(d, ta), i1 = ub(d, tb); out.changes = Math.max(0, i1 - i0);
  if (r.sig.width === 1 && !d.real){
    const {rise, fall} = edgeLists(d, ta, tb);
    out.rise = rise.length; out.fall = fall.length;
    out.period = summarize(diffs(rise)); if (!out.period) out.period = summarize(diffs(fall));
    const hi = [], lo = [];
    let fi = 0; for (const rt of rise){ while (fi < fall.length && fall[fi] <= rt) fi++; if (fi < fall.length) hi.push(fall[fi] - rt); }
    let ri = 0; for (const ft of fall){ while (ri < rise.length && rise[ri] <= ft) ri++; if (ri < rise.length) lo.push(rise[ri] - ft); }
    out.high = summarize(hi); out.low = summarize(lo);
    if (out.period && out.high && out.period.mean > 0) out.duty = out.high.mean / out.period.mean;
  } else {
    const iv = []; for (let k = Math.max(1, i0) + 1; k < i1; k++) iv.push(d.t[k] - d.t[k - 1]);
    out.interval = summarize(iv.filter(v => v > 0));
  }
  return out;
}
function scanClocks(){
  const res = [], seen = new Set(); let scanned = 0;
  for (const s of D.sigs){
    if (s.width !== 1 || s.data.real || seen.has(s.data)) continue; seen.add(s.data); if (++scanned > 30000) break;
    const d = s.data; if (d.n < 9) continue;
    const rise = []; for (let k = 1; k < d.n; k++) if (edgeKindAt(d, k) === 1) rise.push(d.t[k]);
    if (rise.length < 5) continue;
    const p = summarize(diffs(rise)); if (!p || p.mean <= 0) continue;
    const cv = p.sd / p.mean; if (cv > 0.05) continue;
    res.push({sig:s, rises:rise.length, p, cv});
  }
  res.sort((a, b) => b.rises - a.rises); return res;
}
function defaultGlitchThr(){
  const c = scanClocks(); if (c.length) return c[0].p.mean / 4;
  return Math.max(1, (D.tmax - D.tmin) / 2000);
}
function findGlitches(sig, thr){
  const d = sig.data, out = [], n = d.n, t = d.t;
  for (let i = 0; i < n - 1; i++){
    const dur = t[i + 1] - t[i];
    if (dur === 0){
      if (i === 0 || t[i - 1] === t[i]) continue;      // report a same-time group once, not the initial dump
      out.push({sig, t:t[i], w:0, kind:'zero-width (several changes at the same time)'});
    } else if (i > 0 && dur < thr){
      let kind = 'short-lived value';
      if (sig.width === 1 && !d.real){ kind = xzOf(d, i) ? 'short x/z' : (d.v[i] & 1) ? 'short high pulse' : 'short low pulse'; }
      out.push({sig, t:t[i], w:dur, kind});
    }
    if (out.length >= 2000) break;
  }
  return out;
}

/* ---------- bottom panel ---------- */
function statRow(label, s){ return s ? '<tr><td>' + label + '</td><td class="n">' + s.n + '</td><td class="n">' + fmtT(s.mean, 5) + '</td><td class="n">' + fmtT(s.min, 5) + '</td><td class="n">' + fmtT(s.max, 5) + '</td><td class="n">' + fmtT(s.sd, 3) + '</td></tr>' : ''; }
function renderMeasure(){
  const r = selRow(); const b = el.pbody;
  if (!r){ b.innerHTML = '<p class="note">Click a signal name to select it, then measure. Clock period, frequency, duty cycle and pulse widths are computed from its edges, over the A..B range if both cursors are set, otherwise over the whole dump.</p>' + clockScanHtml(); wireScan(); return; }
  const ranged = S.A != null && S.B != null, ta = ranged ? Math.min(S.A, S.B) : D.tmin, tb = ranged ? Math.max(S.A, S.B) : D.tmax;
  const m = measureRow(r, ta, tb); let h = '<div class="row"><b>' + esc(r.sig.path) + '</b><span class="note">range: ' + (ranged ? 'cursors A..B' : 'whole dump') + ' (' + fmtT(ta) + ' .. ' + fmtT(tb) + '), ' + m.changes + ' value changes</span></div>';
  if (r.sig.width === 1 && !r.sig.data.real){
    if (m.period){
      const f = m.period.mean > 0 ? 1 / (m.period.mean * secPerUnit()) : NaN;
      h += '<div class="row"><span class="chip">period <b>' + fmtT(m.period.mean, 6) + '</b></span><span class="chip">frequency <b>' + fmtFreq(f) + '</b></span>' +
           (m.duty != null ? '<span class="chip">duty <b>' + (m.duty * 100).toFixed(1) + '%</b></span>' : '') +
           '<span class="chip">jitter (sd/mean) <b>' + (m.period.mean ? (m.period.sd / m.period.mean * 100).toFixed(2) : '-') + '%</b></span>' +
           '<span class="chip">edges <b>' + m.rise + ' rising / ' + m.fall + ' falling</b></span></div>';
      h += '<table><tr><th></th><th>n</th><th>mean</th><th>min</th><th>max</th><th>std dev</th></tr>' + statRow('period', m.period) + statRow('high width', m.high) + statRow('low width', m.low) + '</table>';
    } else h += '<p class="note">Fewer than two clean 0&rarr;1 (or 1&rarr;0) edges in this range, so no period can be computed.</p>';
  } else if (m.interval){
    h += '<div class="row"><span class="chip">changes <b>' + m.changes + '</b></span><span class="chip">mean interval <b>' + fmtT(m.interval.mean, 5) + '</b></span><span class="chip">min <b>' + fmtT(m.interval.min, 5) + '</b></span><span class="chip">max <b>' + fmtT(m.interval.max, 5) + '</b></span></div>' +
         '<p class="note">For buses this is the spacing between value changes, not a clock period. Select a 1-bit signal for period / frequency / duty.</p>';
  } else h += '<p class="note">Not enough changes in range.</p>';
  b.innerHTML = h + clockScanHtml(); wireScan();
}
function clockScanHtml(){
  if (!S.pnl.clocks) return '<div class="row" style="margin-top:8px"><button id="bScan">Scan all 1-bit signals for clocks</button><span class="note">lists regular periodic signals (period spread under 5%)</span></div>';
  const c = S.pnl.clocks; if (!c.length) return '<p class="note">No regular clock-like signal found.</p><button id="bScan">Rescan</button>';
  let h = '<table style="margin-top:6px"><tr><th>clock candidate</th><th>rising edges</th><th>period</th><th>frequency</th><th>spread</th><th></th></tr>';
  c.slice(0, 12).forEach((x, i) => { h += '<tr class="clk" data-ci="' + i + '"><td>' + esc(x.sig.path) + '</td><td class="n">' + x.rises + '</td><td class="n">' + fmtT(x.p.mean, 5) + '</td><td class="n">' + fmtFreq(1 / (x.p.mean * secPerUnit())) + '</td><td class="n">' + (x.cv * 100).toFixed(2) + '%</td><td class="note">click to add</td></tr>'; });
  return h + '</table><button id="bScan" style="margin-top:6px">Rescan</button>';
}
function wireScan(){
  const b = $('#bScan'); if (b) b.onclick = () => { S.pnl.clocks = scanClocks(); renderMeasure(); };
  el.pbody.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => { const x = S.pnl.clocks[+tr.dataset.ci]; addSignal(x.sig); S.sel = S.rows.findIndex(r => r.sig === x.sig); afterRowsChange(); selectRow(S.sel); });
}
function renderGlitch(){
  const b = el.pbody; if (S.pnl.thr == null) S.pnl.thr = defaultGlitchThr();
  const un = D.tsMag === 1 ? D.tsUnit : D.tsMag + ' ' + D.tsUnit;
  b.innerHTML = '<div class="row"><label>pulse / value narrower than <input type="number" id="gThr" min="0" step="any" style="width:90px" value="' + trimNum(S.pnl.thr, 6) + '"> ' + esc(un) + '</label>' +
    '<label>in <select id="gScope"><option value="sel">selected signal</option><option value="all">all signals on screen</option></select></label><button id="bGl" class="primary">Find glitches</button>' +
    '<span class="note">default = 1/4 of the fastest detected clock period. Also reports zero-width events (several changes in the same timestamp).</span></div><div id="gRes"></div>';
  $('#gScope').value = S.pnl.gscope || 'sel';
  $('#bGl').onclick = () => {
    const thr = parseFloat($('#gThr').value); S.pnl.thr = isFinite(thr) ? thr : 0; S.pnl.gscope = $('#gScope').value;
    const rows = S.pnl.gscope === 'all' ? S.rows : (selRow() ? [selRow()] : []);
    if (!rows.length){ $('#gRes').innerHTML = '<p class="note">Select a signal row (or choose "all signals on screen").</p>'; return; }
    let all = []; for (const r of rows) all = all.concat(findGlitches(r.sig, S.pnl.thr));
    S.pnl.gl = all; showGlitches();
  };
  if (S.pnl.gl) showGlitches();
}
function showGlitches(){
  const gl = S.pnl.gl, box = $('#gRes'); if (!box) return;
  if (!gl.length){ box.innerHTML = '<p class="note">No glitches found at this threshold.</p>'; return; }
  let h = '<p class="note">' + gl.length + ' event(s)' + (gl.length >= 2000 ? ' (list capped)' : '') + '. Click a row to jump there.</p><table><tr><th>signal</th><th>time</th><th>width</th><th>kind</th></tr>';
  gl.slice(0, 300).forEach((g, i) => { h += '<tr class="clk" data-gi="' + i + '"><td>' + esc(g.sig.path) + '</td><td class="n">' + fmtT(g.t) + '</td><td class="n">' + fmtT(g.w) + '</td><td>' + g.kind + '</td></tr>'; });
  box.innerHTML = h + '</table>';
  box.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => {
    const g = gl[+tr.dataset.gi]; const idx = S.rows.findIndex(r => r.sig === g.sig); if (idx >= 0) selectRow(idx);
    const sp = Math.max(g.w * 12, (V.t1 - V.t0) > g.w * 400 ? g.w * 40 : (V.t1 - V.t0));
    S.A = g.t; if (g.w > 0) S.B = g.t + g.w; else S.B = null;
    setView(g.t - sp / 2, g.t + sp / 2, true); updateValues(); requestDraw(); updateHash();
  });
}
function renderInfo(){
  const m = D.meta || {}, nsig = D.sigs.length;
  const row = (k, v) => '<tr><td>' + k + '</td><td>' + esc(v) + '</td></tr>';
  let tog = '';
  if (S.rows.length){
    tog = '<h4 style="margin:10px 0 4px">Signals on screen</h4><table><tr><th>signal</th><th>width</th><th>changes</th><th>bit toggles</th><th>x/z</th></tr>';
    for (const r of S.rows){ const d = r.sig.data, tg = countToggles(d); tog += '<tr><td>' + esc(r.sig.path) + '</td><td class="n">' + r.sig.width + '</td><td class="n">' + Math.max(0, d.n - 1) + '</td><td class="n">' + tg + '</td><td>' + (d.m ? 'yes' : '') + '</td></tr>'; }
    tog += '</table>';
  }
  el.pbody.innerHTML = '<table class="kv">' + row('file', D.name) + row('timescale', m.timescale || '') + row('time span', fmtT(D.tmin) + ' .. ' + fmtT(D.tmax)) + row('signals', nsig + ' declared, ' + D.datas.length + ' distinct nets') +
    row('value changes', D.nChanges.toLocaleString()) + row('size', (D.bytes / 1048576).toFixed(2) + ' MB, parsed in ' + (D.parseMs | 0) + ' ms') + row('date', m.date || '-') + row('version', m.version || '-') +
    (m.comments && m.comments.length ? row('comment', m.comments.join(' | ')) : '') + '</table>' + tog;
}
function countToggles(d){
  if (d.real) return d.n - 1;
  let tg = 0; const nw = d.nw;
  for (let k = 1; k < d.n; k++){
    for (let q = 0; q < nw; q++){
      const a = d.v[k * nw + q], b = d.v[(k - 1) * nw + q];
      let known = 0xFFFFFFFF; if (d.m) known = ~(d.m[k * nw + q] | d.m[(k - 1) * nw + q]);
      let x = (a ^ b) & known; x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); tg += (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    }
  }
  return tg;
}
function renderPanel(){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === S.tab));
  if (!D.root) return;
  if (S.tab === 'measure') renderMeasure(); else if (S.tab === 'glitch') renderGlitch(); else renderInfo();
}

/* ---------- signal tree + search ---------- */
function sigRowEl(sig, showPath){
  const e = document.createElement('div'); e._sig = sig;
  e.className = 'sg' + (S.rows.some(r => r.sig === sig) ? ' added' : '');
  e.innerHTML = '<span class="ck">' + (e.classList.contains('added') ? '✓' : '') + '</span><span class="nm" title="' + esc(sig.path) + '">' + esc(sig.name) + '</span>' + (showPath ? '<span class="pp">' + esc(sig.scope.path) + '</span>' : '') +
    '<span class="w">' + (sig.data.real ? 'real' : sig.width > 1 ? '[' + (sig.width - 1) + ':0]' : '') + '</span>';
  e.onclick = () => toggleSig(sig);
  return e;
}
function toggleSig(sig){
  const i = S.rows.findIndex(r => r.sig === sig);
  if (i >= 0) removeRowAt(i); else { addSignal(sig); S.sel = S.rows.length - 1; afterRowsChange(); selectRow(S.sel); el.rows.scrollTop = el.rows.scrollHeight; }
}
function markTree(){
  const on = new Set(S.rows.map(r => r.sig));
  el.tree.querySelectorAll('.sg').forEach(e => { const a = on.has(e._sig); e.classList.toggle('added', a); e.firstChild.textContent = a ? '✓' : ''; });
}
function scopeEl(nd, depth){
  const e = document.createElement('div'); e.className = 'nd';
  const h = document.createElement('div'); h.className = 'nh';
  h.innerHTML = '<span class="tw">▸</span><span>' + esc(nd.name) + '</span><span class="cnt">' + nd.n + '</span><button class="all" title="Add all signals directly in this scope">+ all</button>';
  const kids = document.createElement('div'); kids.className = 'kids'; kids.style.display = 'none'; let built = false;
  const toggle = () => {
    const open = kids.style.display === 'none'; kids.style.display = open ? '' : 'none'; h.firstChild.textContent = open ? '▾' : '▸';
    if (open && !built){ built = true; for (const k of nd.kids) kids.appendChild(scopeEl(k, depth + 1)); for (const s of nd.sigs) kids.appendChild(sigRowEl(s)); }
  };
  h.onclick = (ev) => { if (ev.target.classList.contains('all')) { let c = 0; for (const s of nd.sigs){ if (c >= 256) break; if (addSignal(s)) c++; } afterRowsChange(); toast('Added ' + c + ' signals from ' + nd.name); return; } toggle(); };
  e.appendChild(h); e.appendChild(kids); e._open = () => { if (kids.style.display === 'none') toggle(); };
  if (depth === 0) toggle();
  return e;
}
function renderTree(){
  el.tree.textContent = '';
  const q = el.q.value.trim();
  if (!q){
    const root = D.root; if (root.sigs.length){ const top = {name:'(top level)', kids:[], sigs:root.sigs, n:root.sigs.length}; el.tree.appendChild(scopeEl(top, 0)); }
    for (const k of root.kids) el.tree.appendChild(scopeEl(k, 0));
    el.qhint.textContent = D.sigs.length + ' signals. Click a signal to add / remove it. Hover a scope for "+ all".'; return;
  }
  let test;
  if (q.length > 2 && q[0] === '/' && q[q.length - 1] === '/'){ try { const re = new RegExp(q.slice(1, -1), 'i'); test = s => re.test(s.path); } catch (e) { el.qhint.textContent = 'invalid regex'; return; } }
  else { const words = q.toLowerCase().split(/\s+/); test = s => words.every(w => s.lpath.indexOf(w) >= 0); }
  let c = 0, shown = 0; const seen = new Set();
  for (const s of D.sigs){
    if (!test(s)) continue; c++;
    if (shown < 400){ el.tree.appendChild(sigRowEl(s, true)); shown++; }
  }
  el.qhint.textContent = c + ' match' + (c === 1 ? '' : 'es') + (c > shown ? ', showing first ' + shown : '');
}

/* ---------- share state in URL hash ---------- */
const enc = (s) => encodeURIComponent(s).replace(/~/g, '%7E').replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
function stateHash(){
  const parts = [];
  if (D.demo) parts.push('d=' + enc(D.demo));
  if (S.rows.length) parts.push('s=' + S.rows.map(r => enc(r.sig.path) + ';' + r.radix + (r.analog && !r.sig.data.real ? 'a' : '')).join(','));
  if (S.sel >= 0) parts.push('sel=' + S.sel);
  if (S.A != null) parts.push('a=' + S.A);
  if (S.B != null) parts.push('b=' + S.B);
  parts.push('v=' + trimNum(V.t0, 12) + '~' + trimNum(V.t1, 12));
  return parts.join('&');
}
function parseHash(h){
  h = (h || '').replace(/^#/, ''); const o = {}; if (!h) return o;
  for (const p of h.split('&')){ const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); }
  return o;
}
let hashTimer = 0;
function updateHash(){
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => { if (!D.root) return; try { history.replaceState(null, '', '#' + stateHash()); } catch (e) {} }, 250);
}
function applyHashSignals(o){
  if (!o.s) return 0;
  let n = 0;
  for (const item of o.s.split(',')){
    const [p, fl] = item.split(';'); let path; try { path = decodeURIComponent(p); } catch (e) { continue; }
    const sig = D.pathMap.get(path); if (!sig) continue;
    const r = addSignal(sig); if (!r) continue;
    if (fl){ const rx = fl[0]; if ('bhds'.indexOf(rx) >= 0 && sig.width > 1) r.radix = rx; if (fl.indexOf('a') >= 0 && sig.width > 1) r.analog = true; }
    n++;
  }
  return n;
}

/* ---------- export ---------- */
function download(name, blob){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function baseName(){ return (D.name || 'dump').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_'); }
function exportPNG(){
  if (!D.root) return;
  const nameW = 330, valW = 90, left = nameW + valW + (S.B != null ? valW : 0), Wp = Math.max(300, W), head = 52, foot = 18, sc = 2;
  const Hp = Math.max(60, S.totalH || 60), TW = left + Wp, TH = head + Hp + foot;
  const cv = document.createElement('canvas'); cv.width = TW * sc; cv.height = TH * sc; const ctx = cv.getContext('2d'); ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.fillStyle = CL.bg; ctx.fillRect(0, 0, TW, TH);
  ctx.fillStyle = CL.ink; ctx.font = 'bold 13px system-ui,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('VCD-Studio  |  ' + D.name, 10, 14);
  ctx.font = '11px ui-monospace,Menlo,Consolas,monospace'; ctx.fillStyle = CL.muted;
  ctx.fillText(fmtT(V.t0, 5) + ' .. ' + fmtT(V.t1, 5) + '   timescale ' + (D.meta.timescale || ''), 10, 30);
  const ppt = Wp / (V.t1 - V.t0);
  ctx.save(); ctx.translate(left, 8); ctx.beginPath(); ctx.rect(0, 0, Wp, 44); ctx.clip(); drawRulerOn(ctx, Wp, 44, ppt, V.t0, true); ctx.restore();
  ctx.save(); ctx.translate(left, head); ctx.beginPath(); ctx.rect(0, 0, Wp, Hp); ctx.clip();
  paintWaves(ctx, Wp, Hp, 0, V.t0, ppt, {noSel:true, noHover:true}); ctx.restore();
  // names
  S.rows.forEach((r, i) => {
    const y = head + r.y; ctx.fillStyle = (i & 1) ? CL.alt : 'transparent'; ctx.fillRect(0, y, left, r.h);
    ctx.strokeStyle = CL.line; ctx.beginPath(); ctx.moveTo(0, y + r.h - .5); ctx.lineTo(left, y + r.h - .5); ctx.stroke();
    ctx.fillStyle = CL.ink; ctx.font = '12px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let nm = r.sig.name + (r.sig.range || (r.sig.width > 1 ? '[' + (r.sig.width - 1) + ':0]' : '')); ctx.fillText(nm.length > 38 ? nm.slice(0, 37) + '…' : nm, 8, y + r.h / 2);
    ctx.font = '11px ui-monospace,Menlo,Consolas,monospace'; ctx.textAlign = 'right';
    const vals = (t, col, x) => { if (t == null) return; const d = r.sig.data, s = fmtValue(d, idxAt(d, t), r.radix, r.sig.width); ctx.fillStyle = xzOf(d, idxAt(d, t)) ? CL.x : col; ctx.fillText(s.length > 13 ? s.slice(0, 12) + '…' : s, x, y + r.h / 2); };
    vals(S.A, CL.A, nameW + valW - 6); vals(S.B, CL.B, nameW + valW * 2 - 6);
  });
  ctx.fillStyle = CL.muted; ctx.font = '10px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText('exported by VCD-Studio (offline viewer)', 10, TH - 9);
  ctx.strokeStyle = CL.line; ctx.beginPath(); ctx.moveTo(left - .5, head); ctx.lineTo(left - .5, head + Hp); ctx.stroke();
  cv.toBlob(b => { download(baseName() + '.png', b); toast('PNG exported (' + TW + 'x' + TH + ' @2x)'); }, 'image/png');
  return {w: TW * sc, h: TH * sc};
}
function buildSummary(){
  const L = [], sps = secPerUnit();
  L.push('VCD-Studio summary'); L.push('file        : ' + D.name); L.push('timescale   : ' + (D.meta.timescale || '?'));
  L.push('time span   : ' + fmtT(D.tmin) + ' .. ' + fmtT(D.tmax) + '  (' + fmtT(D.tmax - D.tmin) + ')');
  L.push('signals     : ' + D.sigs.length + ' declared, ' + D.datas.length + ' distinct nets, ' + D.nChanges + ' value changes');
  L.push('view        : ' + fmtT(V.t0) + ' .. ' + fmtT(V.t1));
  L.push('cursor A    : ' + (S.A == null ? '-' : fmtT(S.A)));
  L.push('cursor B    : ' + (S.B == null ? '-' : fmtT(S.B)));
  if (S.A != null && S.B != null){ const dt = Math.abs(S.B - S.A); L.push('delta       : ' + fmtT(dt) + (dt > 0 ? '   (1/delta = ' + fmtFreq(1 / (dt * sps)) + ')' : '')); }
  L.push('');
  L.push('Signals on screen:');
  for (const r of S.rows){
    const d = r.sig.data, rng = r.sig.width > 1 ? '[' + (r.sig.width - 1) + ':0]' : '';
    L.push('  ' + r.sig.path + rng + '  (' + (d.real ? 'real' : r.sig.width + ' bit, ' + RADIX_LBL[r.radix]) + ')');
    L.push('      changes ' + Math.max(0, d.n - 1) + ', bit toggles ' + countToggles(d) + ', has x/z: ' + (d.m ? 'yes' : 'no'));
    const at = (t, nm) => { if (t != null) L.push('      ' + nm + ' = ' + fmtValue(d, idxAt(d, t), r.radix, r.sig.width)); };
    at(S.A, 'at A'); at(S.B, 'at B');
    if (r.sig.width === 1 && !d.real){
      const m = measureRow(r, D.tmin, D.tmax);
      if (m.period) L.push('      period ' + fmtT(m.period.mean, 5) + ' (' + fmtFreq(1 / (m.period.mean * sps)) + '), spread ' + (m.period.sd / m.period.mean * 100).toFixed(2) + '%' + (m.duty != null ? ', duty ' + (m.duty * 100).toFixed(1) + '%' : '') + ', rising edges ' + m.rise);
    }
  }
  if (S.pnl.gl && S.pnl.gl.length){
    L.push(''); L.push('Last glitch scan (threshold ' + fmtT(S.pnl.thr) + '): ' + S.pnl.gl.length + ' event(s)');
    for (const g of S.pnl.gl.slice(0, 40)) L.push('  ' + g.sig.path + ' @ ' + fmtT(g.t) + ' width ' + fmtT(g.w) + ' : ' + g.kind);
  }
  L.push(''); L.push('Generated by VCD-Studio (single-file offline viewer). Share state: #' + stateHash());
  return L.join('\n') + '\n';
}

/* ---------- loading ---------- */
function setDump(res, name, demoKey, parseMs){
  Object.assign(D, {tsMag:res.tsMag, tsUnit:res.tsUnit, tmin:res.tmin, tmax:Math.max(res.tmax, res.tmin + 1), sigs:res.sigs, root:res.root, meta:res.meta, nChanges:res.nChanges, bytes:res.bytes,
    datas:res.datas, name, demo:demoKey || '', parseMs, pathMap:new Map()});
  for (const s of res.sigs) if (!D.pathMap.has(s.path)) D.pathMap.set(s.path, s);
  S.rows = []; S.sel = -1; S.A = S.B = null; S.pnl = {}; el.q.value = '';
  const o = parseHash(location.hash);
  let n = 0, viewFromHash = false;
  const sameDemo = demoKey ? o.d === demoKey : true;
  if (o.s && sameDemo) n = applyHashSignals(o);
  if (!n){
    const def = demoKey && DEMOS[demoKey] ? DEMOS[demoKey].defaults : null;
    if (def) for (const p of def){ const s = D.pathMap.get(p); if (s) addSignal(s); }
    else { // first scope that has signals, up to 12
      const walk = (nd) => { for (const s of nd.sigs){ if (S.rows.length >= 12) return; if (s.type !== 'parameter') addSignal(s); } if (S.rows.length === 0) for (const k of nd.kids){ walk(k); if (S.rows.length) return; } };
      walk(D.root);
    }
  } else {
    if (o.sel != null && +o.sel < S.rows.length) S.sel = +o.sel;
    if (o.a != null && isFinite(+o.a)) S.A = +o.a; if (o.b != null && isFinite(+o.b)) S.B = +o.b;
    if (o.v){ const [a, b] = o.v.split('~').map(Number); if (isFinite(a) && isFinite(b) && b > a){ V.t0 = a; V.t1 = b; viewFromHash = true; } }
  }
  if (S.sel < 0 && S.rows.length) S.sel = 0;
  document.title = 'VCD-Studio - ' + name; el.fname.textContent = name; el.fname.title = name;
  el.sFile.textContent = res.sigs.length + ' signals, ' + res.nChanges.toLocaleString() + ' changes, ' + (res.bytes / 1048576).toFixed(2) + ' MB, parsed in ' + Math.round(parseMs) + ' ms';
  el.emptyMsg.innerHTML = 'No signals on screen.<br>Pick signals in the tree on the left (click to add).';
  renderTree(); layoutRows(); renderNames(); resizeCanvas();
  if (!viewFromHash) fitView(false); else setView(V.t0, V.t1, false);
  updateValues(); renderPanel(); markTree(); requestDraw(); updateHash();
  return n;
}
function parseBuffer(u8){
  const t0 = performance.now(), p = new VcdParser(); p.feed(u8, true); const res = p.finish();
  return {res, ms: performance.now() - t0};
}
async function loadFile(file){
  const t0 = performance.now(); const p = new VcdParser(); const CH = 16 * 1048576;
  try {
    for (let off = 0; off < file.size; off += CH){
      const buf = new Uint8Array(await file.slice(off, off + CH).arrayBuffer());
      p.feed(buf, off + CH >= file.size);
      el.sFile.textContent = 'reading ' + Math.min(100, Math.round((off + CH) / file.size * 100)) + '% ...';
      await new Promise(r => setTimeout(r, 0));
    }
    if (file.size === 0) p.feed(new Uint8Array(0), true);
    const res = p.finish();
    if (!res.sigs.length){ toast('No signals found: is this a VCD file?'); el.sFile.textContent = ''; return false; }
    setDump(res, file.name, '', performance.now() - t0); toast('Loaded ' + file.name); return true;
  } catch (e) { console.error(e); toast('Could not read file: ' + e.message); return false; }
}
async function inflateB64(b64){
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}
async function loadDemo(key){
  const dm = DEMOS[key]; if (!dm) return;
  try {
    const u8 = await inflateB64(dm.z); const {res, ms} = parseBuffer(u8);
    setDump(res, dm.file, key, ms);
  } catch (e) { console.error(e); toast('Could not unpack the demo (browser lacks DecompressionStream?)'); }
}

/* ---------- interaction ---------- */
function timeAtX(x){ return V.t0 + x / (W / (V.t1 - V.t0)); }
function rowAtY(y){ const yy = y + el.rows.scrollTop; for (let i = 0; i < S.rows.length; i++) if (yy >= S.rows[i].y && yy < S.rows[i].y + S.rows[i].h) return i; return -1; }
function snapTime(t, ri){
  if (!el.snap.checked) return t;
  const ppt = W / (V.t1 - V.t0), tol = 6 / ppt;
  const rows = ri >= 0 ? [S.rows[ri]] : S.rows; let best = null, bd = tol;
  for (const r of rows){
    const d = r.sig.data, k = ub(d, t);
    for (const q of [k - 1, k]){ if (q >= 0 && q < d.n){ const dd = Math.abs(d.t[q] - t); if (dd <= bd){ bd = dd; best = d.t[q]; } } }
  }
  return best != null ? best : t;
}
function hoverText(x, y){
  const t = timeAtX(x); let s = 'T = ' + fmtT(t, 6);
  const ri = rowAtY(y); if (ri >= 0){ const r = S.rows[ri], d = r.sig.data; s += '   ' + r.sig.name + ' = ' + fmtValue(d, idxAt(d, t), r.radix, r.sig.width); }
  el.sHover.textContent = s;
}
function initCanvasEvents(){
  const cv = el.cv; let pan = null;
  cv.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return; cv.setPointerCapture(ev.pointerId);
    pan = {x:ev.clientX, y:ev.clientY, t0:V.t0, t1:V.t1, moved:false, shift:ev.shiftKey, rect:cv.getBoundingClientRect()};
  });
  cv.addEventListener('pointermove', ev => {
    const rect = cv.getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    if (pan){
      const dx = ev.clientX - pan.x;
      if (!pan.moved && Math.abs(dx) > 3) pan.moved = true;
      if (pan.moved){ const ppt = W / (pan.t1 - pan.t0), [a, b] = clampView(pan.t0 - dx / ppt, pan.t1 - dx / ppt); V.t0 = a; V.t1 = b; S.hover = null; requestDraw(); updateHash(); }
    } else { S.hover = timeAtX(x); requestDraw(); }
    hoverText(x, y);
  });
  const up = ev => {
    if (!pan) return; const p = pan; pan = null;
    if (!p.moved){
      const x = ev.clientX - p.rect.left, y = ev.clientY - p.rect.top, ri = rowAtY(y), t = snapTime(timeAtX(x), ri);
      if (ri >= 0) selectRow(ri);
      if (p.shift) S.B = t; else S.A = t;
      updateValues(); requestDraw(); updateHash(); renderPanel();
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { pan = null; });
  cv.addEventListener('pointerleave', () => { S.hover = null; requestDraw(); });
  cv.addEventListener('wheel', ev => {
    if (ev.ctrlKey || ev.metaKey){
      ev.preventDefault(); const rect = cv.getBoundingClientRect(); const f = Math.exp(ev.deltaY * 0.0022);
      zoomBy(f, timeAtX(ev.clientX - rect.left), false); updateHash();
    } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)){
      ev.preventDefault(); const d = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX; panBy(d / W, false); updateHash();
    }
  }, {passive:false});
  el.rows.addEventListener('scroll', requestDraw);
  // ruler: click = cursor A, drag = zoom range
  const rl = el.ruler; let rd = null;
  rl.addEventListener('pointerdown', ev => { rl.setPointerCapture(ev.pointerId); const rect = rl.getBoundingClientRect(); rd = {x:ev.clientX, a:timeAtX(ev.clientX - rect.left), moved:false, rect, shift:ev.shiftKey}; });
  rl.addEventListener('pointermove', ev => {
    if (!rd) return; if (Math.abs(ev.clientX - rd.x) > 4) rd.moved = true;
    if (rd.moved){ S.drag = {zoom:true, a:rd.a, b:timeAtX(ev.clientX - rd.rect.left)}; requestDraw(); }
  });
  rl.addEventListener('pointerup', ev => {
    if (!rd) return; const r = rd; rd = null; const t = timeAtX(ev.clientX - r.rect.left); S.drag = null;
    if (r.moved){ const a = Math.min(r.a, t), b = Math.max(r.a, t); if (b - a > 1) setView(a, b, true); updateHash(); }
    else { if (r.shift) S.B = t; else S.A = t; updateValues(); updateHash(); renderPanel(); }
    requestDraw();
  });
}
function inField(ev){ const t = ev.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'); }
function onKey(ev){
  if (ev.key === 'Escape'){ if (el.help.open) el.help.close(); else if (inField(ev)) ev.target.blur(); return; }
  if (inField(ev) || ev.ctrlKey || ev.metaKey) return;
  if (el.help.open) return;
  const k = ev.key, K = k.length === 1 ? k.toLowerCase() : k;
  let handled = true;
  if (K === 'o') el.fin.click();
  else if (K === 't') setTheme(S.theme === 'dark' ? 'light' : 'dark');
  else if (K === 'f') fitView(true);
  else if (K === 'z'){ if (S.A != null && S.B != null){ const a = Math.min(S.A, S.B), b = Math.max(S.A, S.B), m = (b - a) * 0.05 || 1; setView(a - m, b + m, true); } else toast('Set cursors A (click) and B (Shift+click) first'); }
  else if (K === '+' || K === '='){ zoomBy(0.5, null, true); }
  else if (K === '-' || K === '_'){ zoomBy(2, null, true); }
  else if (K === 'ArrowLeft'){ panBy(ev.shiftKey ? -0.5 : -0.1, true); }
  else if (K === 'ArrowRight'){ panBy(ev.shiftKey ? 0.5 : 0.1, true); }
  else if (K === 'ArrowUp'){ if (ev.altKey) moveRow(S.sel, S.sel - 1); else if (S.rows.length) selectRow(Math.max(0, S.sel - 1)); }
  else if (K === 'ArrowDown'){ if (ev.altKey) moveRow(S.sel, S.sel + 1); else if (S.rows.length) selectRow(Math.min(S.rows.length - 1, S.sel + 1)); }
  else if (K === 'Home'){ const sp = V.t1 - V.t0; setView(D.tmin - sp * 0.01, D.tmin - sp * 0.01 + sp, true); }
  else if (K === 'End'){ const sp = V.t1 - V.t0; setView(D.tmax + sp * 0.01 - sp, D.tmax + sp * 0.01, true); }
  else if (K === '/'){ el.q.focus(); el.q.select(); }
  else if (K === 'n') doEdge(ev.shiftKey ? -1 : 1);
  else if (K === 'p') doEdge(-1);
  else if (K === ']') doMatch(1);
  else if (K === '[') doMatch(-1);
  else if (K === 'r'){ const r = selRow(); if (r && r.sig.width > 1 && !r.sig.data.real) cycleRadix(S.sel); }
  else if (K === 'g'){ if (S.sel >= 0) toggleAnalog(S.sel); }
  else if (K === 'Delete' || K === 'Backspace'){ if (S.sel >= 0) removeRowAt(S.sel); }
  else if (K === 'c'){ S.A = S.B = null; updateValues(); requestDraw(); updateHash(); renderPanel(); }
  else if (K === 'e'){ if (ev.shiftKey) exportText(); else exportPNG(); }
  else if (K === 'l') copyLink();
  else if (K === '?') el.help.showModal();
  else handled = false;
  if (handled) ev.preventDefault();
}
function exportText(){ if (!D.root) return; download(baseName() + '_summary.txt', new Blob([buildSummary()], {type:'text/plain'})); toast('Summary exported'); }
function copyLink(){
  const url = location.href.split('#')[0] + '#' + stateHash();
  try { history.replaceState(null, '', '#' + stateHash()); } catch (e) {}
  const done = () => toast('Link copied (selected signals, cursors, view)');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast('Link is in the address bar'));
  else toast('Link is in the address bar');
}

/* ---------- init ---------- */
function init(){
  for (const id of ['cv','rows','names','cwrap','ruler','hdr','tree','q','qhint','fname','cA','cB','cD','cF','sHover','sView','sFile','pbody','toast','fin','demoSel','edgeKind','matchIn','matchMsg','snap','help','empty','emptyMsg','side','panel'])
    el[id] = document.getElementById(id);
  let th = null; try { th = localStorage.getItem('vcdstudio.theme'); } catch (e) {}
  if (!th) th = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  setTheme(th);
  for (const k of Object.keys(DEMOS)){ const o = document.createElement('option'); o.value = k; o.textContent = DEMOS[k].title; el.demoSel.appendChild(o); }
  el.demoSel.onchange = () => { if (el.demoSel.value) loadDemo(el.demoSel.value); };
  $('#bOpen').onclick = () => el.fin.click();
  el.fin.onchange = () => { if (el.fin.files[0]) loadFile(el.fin.files[0]); el.fin.value = ''; };
  $('#bFit').onclick = () => fitView(true); $('#bZin').onclick = () => zoomBy(0.5, null, true); $('#bZout').onclick = () => zoomBy(2, null, true);
  $('#bZcur').onclick = () => onKey({key:'z', target:document.body, preventDefault(){}});
  $('#bTheme').onclick = () => setTheme(S.theme === 'dark' ? 'light' : 'dark');
  $('#bPng').onclick = exportPNG; $('#bTxt').onclick = exportText; $('#bLink').onclick = copyLink; $('#bHelp').onclick = () => el.help.showModal();
  $('#helpClose').onclick = () => el.help.close();
  $('#bPrev').onclick = () => doEdge(-1); $('#bNext').onclick = () => doEdge(1);
  $('#bMPrev').onclick = () => doMatch(-1); $('#bMNext').onclick = () => doMatch(1);
  el.matchIn.addEventListener('keydown', ev => { if (ev.key === 'Enter') doMatch(ev.shiftKey ? -1 : 1); });
  $('#sidetoggle').onclick = () => el.side.classList.toggle('open');
  let qt = 0; el.q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => D.root && renderTree(), 80); });
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => { S.tab = t.dataset.tab; el.panel.classList.remove('min'); renderPanel(); });
  $('#bMin').onclick = () => { el.panel.classList.toggle('min'); resizeCanvas(); };
  document.addEventListener('keydown', onKey);
  initCanvasEvents();
  // drag and drop a file
  let dc = 0; const drop = $('#drop');
  const hasFiles = ev => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf('Files') >= 0;
  window.addEventListener('dragenter', ev => { if (hasFiles(ev)){ dc++; drop.classList.add('on'); } });
  window.addEventListener('dragleave', ev => { if (hasFiles(ev)){ dc = Math.max(0, dc - 1); if (!dc) drop.classList.remove('on'); } });
  window.addEventListener('dragover', ev => { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener('drop', ev => { dc = 0; drop.classList.remove('on'); if (hasFiles(ev)){ ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) loadFile(f); } });
  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) new ResizeObserver(() => resizeCanvas()).observe(el.rows);
  window.matchMedia && matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => { try { if (localStorage.getItem('vcdstudio.theme')) return; } catch (x) {} setTheme(e.matches ? 'dark' : 'light'); });
  window.addEventListener('hashchange', () => { /* manual hash edits: reload signals if same dump */
    if (!D.root) return; const o = parseHash(location.hash); if (o.d && o.d !== D.demo && DEMOS[o.d]) loadDemo(o.d); });
  const o = parseHash(location.hash);
  loadDemo(o.d && DEMOS[o.d] ? o.d : 'counter');
}
window.VCDStudio = {drawNow, parseBuffer, VcdParser, S, V, D, fmtValue, findEdge, findMatch, parseMatch, measureRow, findGlitches, scanClocks, stateHash, buildSummary, exportPNG, get el(){ return el; }, loadFile, loadDemo, addSignal, afterRowsChange, setView, countToggles, W: () => W};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
