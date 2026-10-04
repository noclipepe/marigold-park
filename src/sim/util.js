// Small shared helpers for the simulation.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const pad = (n, w) => String(n).padStart(w, '0');

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function fmtClock(simSeconds) {
  // Park opens the scenario at 13:00; one sim second = one park second.
  const total = 13 * 3600 + Math.floor(simSeconds);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${pad(h, 2)}:${pad(m, 2)}`;
}

export function fmtClockSec(simSeconds) {
  const total = 13 * 3600 + Math.floor(simSeconds);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} sec`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} sec`;
}

export function fmtWait(sec) {
  if (sec < 45) return '< 1 min';
  return `${Math.round(sec / 60)} min`;
}

export function money(v) {
  return '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Polyline helper with arc-length parameterisation (2D in x/z).
export class Lane {
  constructor(points) {
    this.pts = points.map((p) => ({ x: p[0], z: p[1] }));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      this.cum.push(this.cum[i - 1] + dist2(a.x, a.z, b.x, b.z));
    }
    this.length = this.cum[this.cum.length - 1];
  }
  at(d, out = { x: 0, z: 0 }) {
    d = clamp(d, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (d - this.cum[i - 1]) / seg;
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }
  // Points from distance d0 to d1 (either direction), as [x,z] list.
  slice(d0, d1) {
    const out = [];
    const p0 = this.at(d0);
    out.push([p0.x, p0.z]);
    if (d1 >= d0) {
      for (let i = 0; i < this.cum.length; i++) if (this.cum[i] > d0 && this.cum[i] < d1) out.push([this.pts[i].x, this.pts[i].z]);
    } else {
      for (let i = this.cum.length - 1; i >= 0; i--) if (this.cum[i] < d0 && this.cum[i] > d1) out.push([this.pts[i].x, this.pts[i].z]);
    }
    const p1 = this.at(d1);
    out.push([p1.x, p1.z]);
    return out;
  }
}

export const FIRST_NAMES = [
  'Mia', 'Leo', 'Ava', 'Noah', 'Zoe', 'Liam', 'Ivy', 'Owen', 'Ella', 'Jack', 'Lily', 'Max', 'Ruby', 'Finn', 'Nora', 'Theo',
  'Isla', 'Sam', 'Grace', 'Eli', 'Maya', 'Luke', 'Chloe', 'Ben', 'Hana', 'Omar', 'Lena', 'Kai', 'Rosa', 'Adam', 'Emma', 'Ravi',
  'Sara', 'Hugo', 'Anna', 'Tom', 'Aria', 'Dan', 'Jade', 'Ian', 'Mila', 'Joel', 'Elsa', 'Nico', 'Leah', 'Paul', 'Tess', 'Remy',
  'Yuki', 'Amir', 'Cleo', 'Felix', 'June', 'Oscar', 'Nina', 'Arlo', 'Vera', 'Milo', 'Iris', 'Ezra', 'Lucy', 'Jonas', 'Alma', 'Ted',
  'Priya', 'Luca', 'Daisy', 'Raj', 'Wren', 'Abel', 'Kira', 'Ada', 'Seth', 'Lola', 'Rhys', 'Esme', 'Gus', 'Bea', 'Cole', 'Fern',
];
