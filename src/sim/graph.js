import { NODES, EDGES } from './layout.js';

// Walkable network. Modes: 'visitor' (public paths), 'staff' (all), 'cart' (service roads).
export class Graph {
  constructor() {
    this.nodes = {};
    for (const k in NODES) this.nodes[k] = { id: k, x: NODES[k][0], z: NODES[k][1], adj: [] };
    for (const [a, b, kind] of EDGES) {
      const A = this.nodes[a], B = this.nodes[b];
      const len = Math.hypot(A.x - B.x, A.z - B.z);
      A.adj.push({ to: b, len, kind });
      B.adj.push({ to: a, len, kind });
    }
    this.cache = new Map();
  }
  allowed(kind, mode) {
    if (mode === 'staff') return true;
    if (mode === 'cart') return kind === 'service';
    return kind !== 'service';
  }
  route(from, to, mode = 'visitor') {
    if (from === to) return { nodes: [from], length: 0 };
    const key = from + '>' + to + '>' + mode;
    const c = this.cache.get(key);
    if (c) return c;
    const dist = {}, prev = {}, done = new Set();
    for (const k in this.nodes) dist[k] = Infinity;
    dist[from] = 0;
    for (;;) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
      if (u === null || u === to) break;
      done.add(u);
      for (const e of this.nodes[u].adj) {
        if (!this.allowed(e.kind, mode)) continue;
        const nd = dist[u] + e.len;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
      }
    }
    if (dist[to] === Infinity) return null;
    const nodes = [to];
    while (nodes[0] !== from) nodes.unshift(prev[nodes[0]]);
    const r = { nodes, length: dist[to] };
    this.cache.set(key, r);
    return r;
  }
  pos(id) {
    const n = this.nodes[id];
    return [n.x, n.z];
  }
  nearest(x, z, mode = 'visitor') {
    let best = null, bd = Infinity;
    for (const k in this.nodes) {
      if (k === 'SPAWN') continue;
      const n = this.nodes[k];
      if (mode === 'visitor' && n.adj.every((e) => e.kind === 'service')) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
}

// Offsets a polyline sideways so people do not all walk on the centreline.
export function offsetPath(pts, off) {
  if (!off || pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
    let n1x = 0, n1z = 0, n2x = 0, n2z = 0;
    if (i > 0) { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; n1x = -dz / l; n1z = dx / l; }
    if (i < pts.length - 1) { const dx = c[0] - b[0], dz = c[1] - b[1], l = Math.hypot(dx, dz) || 1; n2x = -dz / l; n2z = dx / l; }
    let nx = n1x + n2x, nz = n1z + n2z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const dot = i > 0 && i < pts.length - 1 ? Math.max(0.5, nx * n2x + nz * n2z) : 1;
    out.push([b[0] + (nx * off) / dot, b[1] + (nz * off) / dot]);
  }
  return out;
}
