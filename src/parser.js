/* ---------- VCD parser: byte-level, chunk-resumable, typed-array storage ---------- */
const UNIT_S = {s:1, ms:1e-3, us:1e-6, ns:1e-9, ps:1e-12, fs:1e-15};
const UNITS = [['s',1],['ms',1e-3],['us',1e-6],['ns',1e-9],['ps',1e-12],['fs',1e-15]];

function packBits(bits, L, w, sv, sm, sz, nw){
  // bits: array-like of char codes, MSB first (length L). Verilog left-extension: x/z extend, 0/1 extend with 0.
  for (let k = 0; k < nw; k++){ sv[k] = 0; sm[k] = 0; sz[k] = 0; }
  const f = L ? (bits[0] | 32) : 48;
  const ext = (L < w && (f === 120 || f === 122)) ? f : 48;
  for (let j = 0; j < w; j++){
    const ch = j < L ? (bits[L - 1 - j] | 32) : ext;
    if (ch === 48) continue;
    const k = j >>> 5, b = 1 << (j & 31);
    if (ch === 49) sv[k] |= b;
    else if (ch === 122) { sm[k] |= b; sz[k] |= b; }
    else sm[k] |= b;                       // x, u, w, - ... all unknown
  }
}

class VcdParser {
  constructor(){
    this.root = {name:'', type:'root', kids:[], sigs:[], parent:null, path:'', n:0};
    this.cur = this.root; this.sigs = []; this.map = new Map(); this.datas = [];
    this.cmd = null; this.args = []; this.vals = false; this.defsDone = false;
    this.t = 0; this.tmin = Infinity; this.tmax = 0;
    this.pk = 0; this.pb = null; this.pr = 0;      // pending vector kind (1 bin, 2 real, 3 string), payload
    this.carry = null; this.bytes = 0;
    this.meta = {date:'', version:'', comments:[], timescale:'1 ns'};
    this.tsMag = 1; this.tsUnit = 'ns';
    this.maxNw = 1; this.sv = new Uint32Array(1); this.sm = new Uint32Array(1); this.sz = new Uint32Array(1);
  }
  static key(b, s, e){
    if (e - s > 8) { let r = ''; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; }
    let k = 0; for (let i = s; i < e; i++) k = k * 95 + (b[i] - 32); return k;
  }
  static str(b, s, e){ let r = ''; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; }
  feed(u8, last){
    let b = u8;
    if (this.carry){ const nb = new Uint8Array(this.carry.length + u8.length); nb.set(this.carry); nb.set(u8, this.carry.length); b = nb; this.carry = null; }
    this.bytes += u8.length;
    const n = b.length; let i = 0;
    while (i < n){
      if (b[i] <= 32){ i++; continue; }
      const s = i++;
      while (i < n && b[i] > 32) i++;
      if (i >= n && !last){ this.carry = b.slice(s); break; }
      this.tok(b, s, i);
    }
    // A pending "b1010" still points into the caller's buffer; copy it so the caller may reuse that buffer for the next chunk.
    if (this.pk === 1) this.pb = this.pb.slice();
  }
  tok(b, s, e){
    const c = b[s];
    if (this.cmd !== null && !this.vals){                // collecting arguments of a $command
      if (c === 36 && e - s === 4 && b[s+1] === 101 && b[s+2] === 110 && b[s+3] === 100) this.endCmd();
      else if (this.args.length < 400) this.args.push(VcdParser.str(b, s, e));
      return;
    }
    if (this.defsDone && this.pk){                                        // second token of "b101 id" / "r1.5 id"
      const k = this.pk; this.pk = 0;
      const d = this.map.get(VcdParser.key(b, s, e));
      if (!d) return;
      if (k === 1){ if (!d.real) { packBits(this.pb, this.pb.length, d.w, this.sv, this.sm, this.sz, d.nw); this.commit(d); } }
      else if (k === 2){ if (d.real) this.commitReal(d, this.pr); }
      return;
    }
    if (c === 36){                                       // $
      if (e - s === 4 && b[s+1] === 101 && b[s+2] === 110 && b[s+3] === 100){ this.cmd = null; this.vals = false; return; }
      const name = VcdParser.str(b, s + 1, e);
      this.cmd = name;
      if (this.defsDone && (name === 'dumpvars' || name === 'dumpall' || name === 'dumpon' || name === 'dumpoff')) this.vals = true;
      else { this.vals = false; this.args = []; }
      return;
    }
    if (!this.defsDone) return;
    if (c === 35){                                       // #time
      let t = 0; for (let i = s + 1; i < e; i++) t = t * 10 + (b[i] - 48);
      this.t = t; if (t < this.tmin) this.tmin = t; if (t > this.tmax) this.tmax = t;
      return;
    }
    const lc = c | 32;
    if (lc === 98){ this.pk = 1; this.pb = b.subarray(s + 1, e); return; }            // b / B
    if (lc === 114){ this.pk = 2; this.pr = parseFloat(VcdParser.str(b, s + 1, e)); return; }   // r / R
    if (lc === 115){ this.pk = 3; return; }                                           // s / S (string values ignored)
    // scalar: 0 1 x z u w l h -
    const d = this.map.get(VcdParser.key(b, s + 1, e));
    if (!d || d.real) return;
    const sv = this.sv, sm = this.sm, sz = this.sz;
    if (d.nw === 1 && d.w === 1){
      sv[0] = 0; sm[0] = 0; sz[0] = 0;
      if (lc === 49 || lc === 104) sv[0] = 1;
      else if (lc === 122) { sm[0] = 1; sz[0] = 1; }
      else if (lc !== 48 && lc !== 108) sm[0] = 1;
      this.commit(d);
    } else {
      const ch = lc === 104 ? 49 : lc === 108 ? 48 : lc;
      packBits([ch], 1, d.w, sv, sm, sz, d.nw); this.commit(d);
    }
  }
  endCmd(){
    const a = this.args;
    switch (this.cmd){
      case 'scope': {
        const name = a[1] || a[0] || '?';
        const node = {name, type: a[0] || 'module', kids:[], sigs:[], parent:this.cur, path:(this.cur.path ? this.cur.path + '.' : '') + name, n:0};
        this.cur.kids.push(node); this.cur = node; break; }
      case 'upscope': if (this.cur.parent) this.cur = this.cur.parent; break;
      case 'timescale': {
        const txt = a.join(' '); this.meta.timescale = txt;
        const m = /(\d+)\s*(fs|ps|ns|us|ms|s)/.exec(txt); if (m){ this.tsMag = +m[1]; this.tsUnit = m[2]; }
        break; }
      case 'date': this.meta.date = a.join(' '); break;
      case 'version': this.meta.version = a.join(' '); break;
      case 'comment': if (this.meta.comments.length < 20) this.meta.comments.push(a.join(' ')); break;
      case 'enddefinitions': this.defsDone = true; break;
      case 'var': this.declVar(a); break;
    }
    this.cmd = null;
  }
  declVar(a){
    if (a.length < 4) return;
    const type = a[0], w = Math.max(1, parseInt(a[1], 10) || 1), id = a[2];
    let name = a[3]; const idx = a.length > 4 ? a.slice(4).join('') : ''; let range = '';
    if (idx){ if (w === 1 && /^\[\d+\]$/.test(idx)) name += idx; else range = idx; }
    let key; { const tmp = new Uint8Array(id.length); for (let i = 0; i < id.length; i++) tmp[i] = id.charCodeAt(i); key = VcdParser.key(tmp, 0, tmp.length); }
    let d = this.map.get(key);
    if (!d){
      const real = (type === 'real' || type === 'realtime' || type === 'shortreal');
      const nw = real ? 2 : (w + 31) >>> 5;
      d = {w: real ? 64 : w, nw, n:0, cap:16, t:new Float64Array(16), v:new Uint32Array(16 * nw), m:null, z:null,
           real, rv: real ? new Float64Array(16) : null, same:0};
      this.map.set(key, d); this.datas.push(d);
      if (nw > this.maxNw){ this.maxNw = nw; this.sv = new Uint32Array(nw); this.sm = new Uint32Array(nw); this.sz = new Uint32Array(nw); }
    }
    const path = (this.cur.path ? this.cur.path + '.' : '') + name;
    const sig = {name, range, path, lpath: path.toLowerCase(), width: d.w, type, id, data: d, scope: this.cur, idx: this.sigs.length};
    this.cur.sigs.push(sig); this.sigs.push(sig);
  }
  grow(d){
    const nc = d.cap * 2, nw = d.nw;
    const t = new Float64Array(nc); t.set(d.t); d.t = t;
    const v = new Uint32Array(nc * nw); v.set(d.v); d.v = v;
    if (d.m){ const m = new Uint32Array(nc * nw); m.set(d.m); d.m = m; const z = new Uint32Array(nc * nw); z.set(d.z); d.z = z; }
    if (d.rv){ const r = new Float64Array(nc); r.set(d.rv); d.rv = r; }
    d.cap = nc;
  }
  commit(d){
    const nw = d.nw, n = d.n, sv = this.sv, sm = this.sm, sz = this.sz;
    if (n > 0){
      const o = (n - 1) * nw; let same = true;
      for (let k = 0; k < nw; k++) if (d.v[o + k] !== sv[k]){ same = false; break; }
      if (same){
        if (d.m){ for (let k = 0; k < nw; k++) if (d.m[o + k] !== sm[k] || d.z[o + k] !== sz[k]){ same = false; break; } }
        else { for (let k = 0; k < nw; k++) if (sm[k]){ same = false; break; } }
      }
      if (same) return;
    }
    if (n === d.cap) this.grow(d);
    const o = n * nw;
    d.t[n] = this.t;
    for (let k = 0; k < nw; k++) d.v[o + k] = sv[k];
    let any = 0; for (let k = 0; k < nw; k++) any |= sm[k];
    if (any && !d.m){ d.m = new Uint32Array(d.cap * nw); d.z = new Uint32Array(d.cap * nw); }
    if (d.m) for (let k = 0; k < nw; k++){ d.m[o + k] = sm[k]; d.z[o + k] = sz[k]; }
    if (n > 0 && d.t[n - 1] === this.t) d.same++;
    d.n = n + 1;
  }
  commitReal(d, val){
    const n = d.n;
    if (n > 0 && d.rv[n - 1] === val) return;
    if (n === d.cap) this.grow(d);
    d.t[n] = this.t; d.rv[n] = val;
    if (n > 0 && d.t[n - 1] === this.t) d.same++;
    d.n = n + 1;
  }
  finish(){
    if (this.carry) this.feed(new Uint8Array(0), true);
    let total = 0;
    for (const d of this.datas){
      const n = d.n, nw = d.nw;
      d.t = d.t.slice(0, n); d.v = d.v.slice(0, n * nw);
      if (d.m){ d.m = d.m.slice(0, n * nw); d.z = d.z.slice(0, n * nw); }
      if (d.rv) d.rv = d.rv.slice(0, n);
      total += n;
      if (n && d.t[n - 1] > this.tmax) this.tmax = d.t[n - 1];
      if (n && d.t[0] < this.tmin) this.tmin = d.t[0];
      d.cap = n;
    }
    const count = (nd) => { let c = nd.sigs.length; for (const k of nd.kids) c += count(k); nd.n = c; return c; };
    count(this.root);
    return {root: this.root, sigs: this.sigs, datas: this.datas, tmin: isFinite(this.tmin) ? this.tmin : 0, tmax: this.tmax,
            tsMag: this.tsMag, tsUnit: this.tsUnit, meta: this.meta, nChanges: total, bytes: this.bytes};
  }
}
