import * as THREE from 'three';

// The Cyclone track: built from turtle segments, smoothed, resampled at a
// fixed spacing and given rotation-minimising frames with banking.
// s = 0 is the start of the station straight; the train runs toward -x there.

const STEP = 0.25;

export const STATION = { startX: -22, z: 0, height: 1.3, length: 26, stopS: 22 };
export const CAR_SPACING = 2.55;
export const CAR_COUNT = 5;

export function carCenterOffset(i) {
  return -1.25 - i * CAR_SPACING;
}

function buildRaw() {
  const pts = [];
  const flags = [];
  const zones = {};
  let x = STATION.startX, z = STATION.z, yaw = Math.PI, h = STATION.height;
  let s = 0;
  const push = (px, py, pz, f = 0) => {
    if (pts.length) {
      const p = pts[pts.length - 1];
      s += Math.hypot(px - p.x, py - p.y, pz - p.z);
    }
    pts.push(new THREE.Vector3(px, py, pz));
    flags.push(f);
  };
  push(x, h, z);
  const mark = (name) => (zones[name] = s);

  const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2;
  function straight(len, h1, bump = 0, linear = false) {
    const n = Math.max(2, Math.round(len / STEP));
    const h0 = h;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      x += (Math.cos(yaw) * len) / n;
      z += (Math.sin(yaw) * len) / n;
      const e = linear ? t : ease(t);
      push(x, h0 + (h1 - h0) * e + bump * Math.sin(Math.PI * t) ** 2, z);
    }
    h = h1;
  }
  function turn(radius, angle, h1, bump = 0) {
    const len = Math.abs(angle) * radius;
    const n = Math.max(4, Math.round(len / STEP));
    const h0 = h;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const dy = angle / n;
      const ym = yaw + dy / 2;
      x += (Math.cos(ym) * len) / n;
      z += (Math.sin(ym) * len) / n;
      yaw += dy;
      push(x, h0 + (h1 - h0) * ease(t) + bump * Math.sin(Math.PI * t) ** 2, z);
    }
    h = h1;
  }
  function loop(radius, lateral) {
    const n = Math.round((2 * Math.PI * radius * 1.1) / STEP);
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const rx = -Math.sin(yaw), rz = Math.cos(yaw);
    const x0 = x, z0 = z, h0 = h;
    for (let i = 1; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      // Slightly tear-dropped: tighter at the top than at the entry.
      const fwd = radius * Math.sin(th) * (1 - 0.18 * Math.sin(th / 2) ** 2);
      const up = radius * (1 - Math.cos(th)) * (1 + 0.08 * Math.sin(th / 2) ** 2);
      const lat = (lateral * (th - Math.sin(th))) / (Math.PI * 2);
      push(x0 + fx * fwd + rx * lat, h0 + up, z0 + fz * fwd + rz * lat, 1);
    }
    x = x0 + rx * lateral;
    z = z0 + rz * lateral;
  }
  function hermiteTo(tx, tz, tyaw, h1, k = 1) {
    const x0 = x, z0 = z, h0 = h;
    const d = Math.hypot(tx - x0, tz - z0);
    const m = d * k;
    const t0x = Math.cos(yaw) * m, t0z = Math.sin(yaw) * m;
    const t1x = Math.cos(tyaw) * m, t1z = Math.sin(tyaw) * m;
    const n = 400;
    for (let i = 1; i <= n; i++) {
      const t = i / n, t2 = t * t, t3 = t2 * t;
      const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, e = t3 - t2;
      const px = a * x0 + b * t0x + c * tx + e * t1x;
      const pz = a * z0 + b * t0z + c * tz + e * t1z;
      push(px, h0 + (h1 - h0) * ease(t), pz);
    }
    x = tx; z = tz; yaw = tyaw; h = h1;
  }

  // Station straight, heading west.
  straight(STATION.length, STATION.height);
  mark('stationEnd');
  turn(8, Math.PI / 2, 2.2); // right turn -> north
  straight(5, 3.2);
  mark('liftStart');
  straight(30, 25, 0, true); // chain lift
  mark('liftEnd');
  straight(3, 25.6);
  turn(8.5, Math.PI / 2, 24.6, 0.4); // crest turn -> east
  mark('dropStart');
  straight(24, 1.6); // first drop
  straight(4, 1.6);
  mark('loopStart');
  loop(8.2, 3.2);
  mark('loopEnd');
  straight(6, 2.2);
  turn(6.5, Math.PI / 2, 3.4); // -> south
  straight(19, 3.6, 5.6); // camelback
  turn(6.5, Math.PI / 2, 3.4); // -> west
  straight(15, 3.0, 3.4); // airtime hill
  turn(5.2, -Math.PI / 2, 3.2); // left -> south
  turn(5.2, -Math.PI / 2, 3.0); // left -> east
  mark('brakeStart');
  // Brake run east, a 180° turnaround, then straight into the station.
  const turnX = STATION.startX + 10;
  straight(turnX - x, 2.6);
  turn((STATION.z - z) / 2, Math.PI, 1.9);
  straight(x - STATION.startX, STATION.height);
  mark('end');
  return { pts, flags, zones };
}

function resample(pts, flags) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = cum[cum.length - 1];
  const n = Math.round(L / STEP);
  const out = [], of = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const d = (i / n) * L;
    while (j < cum.length - 1 && cum[j] < d) j++;
    const t = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    out.push(new THREE.Vector3().lerpVectors(pts[j - 1], pts[j], t));
    of.push(Math.max(flags[j - 1], flags[j]));
  }
  return { pts: out, flags: of, ratio: L / n };
}

export class Track {
  constructor() {
    const raw = buildRaw();
    let { pts, flags } = resample(raw.pts, raw.flags);
    const n = pts.length;
    // Smooth (closed curve); keep the station straight pinned to remain exact.
    const stationN = Math.round(STATION.length / STEP);
    const tmp = pts.map((p) => p.clone());
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < n; i++) {
        if (i <= stationN - 6 && i >= 2) { tmp[i].copy(pts[i]); continue; }
        const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
        tmp[i].set((a.x + 2 * b.x + c.x) / 4, (a.y + 2 * b.y + c.y) / 4, (a.z + 2 * b.z + c.z) / 4);
      }
      for (let i = 0; i < n; i++) pts[i].copy(tmp[i]);
    }
    const res = resample(pts.concat([pts[0].clone()]), flags.concat([flags[0]]));
    pts = res.pts; flags = res.flags;
    this.n = pts.length;
    this.step = res.ratio;
    this.length = this.n * this.step;
    this.pts = pts;
    // Zones expressed in resampled arc length (approximately preserved).
    const scale = this.length / raw.zones.end;
    this.zones = {};
    for (const k in raw.zones) this.zones[k] = raw.zones[k] * scale;
    this.zones.stationEnd = STATION.length;

    // Tangents.
    this.tan = pts.map((p, i) => {
      const a = pts[(i - 1 + this.n) % this.n], b = pts[(i + 1) % this.n];
      return new THREE.Vector3().subVectors(b, a).normalize();
    });
    // Parallel-transport frames.
    const up = [new THREE.Vector3(0, 1, 0)];
    const q = new THREE.Quaternion();
    for (let i = 1; i <= this.n; i++) {
      q.setFromUnitVectors(this.tan[i - 1], this.tan[i % this.n]);
      up.push(up[i - 1].clone().applyQuaternion(q));
    }
    // Distribute closure twist.
    const t0 = this.tan[0];
    const end = up[this.n].clone().projectOnPlane(t0).normalize();
    const start = new THREE.Vector3(0, 1, 0).projectOnPlane(t0).normalize();
    let twist = Math.acos(THREE.MathUtils.clamp(end.dot(start), -1, 1));
    if (new THREE.Vector3().crossVectors(end, start).dot(t0) < 0) twist = -twist;
    this.up = [];
    for (let i = 0; i < this.n; i++) {
      const u = up[i].clone().applyAxisAngle(this.tan[i], (twist * i) / this.n);
      u.projectOnPlane(this.tan[i]).normalize();
      this.up.push(u);
    }
    // Banking from horizontal curvature, masked in the loop and on steep parts.
    const bank = new Float32Array(this.n);
    const loopMask = new Float32Array(this.n);
    const dil = Math.round(10 / this.step);
    for (let i = 0; i < this.n; i++) if (flags[i]) for (let k = -dil; k <= dil; k++) loopMask[(i + k + this.n) % this.n] = 1;
    for (let i = 0; i < this.n; i++) {
      const a = this.tan[(i - 4 + this.n) % this.n], b = this.tan[(i + 4) % this.n];
      const ya = Math.atan2(a.z, a.x), yb = Math.atan2(b.z, b.x);
      let dy = yb - ya;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const kappa = dy / (8 * this.step);
      const w = THREE.MathUtils.clamp(1 - Math.abs(this.tan[i].y) * 1.6, 0, 1) * (1 - loopMask[i]);
      bank[i] = THREE.MathUtils.clamp(kappa * 6.5, -1.0, 1.0) * w;
    }
    // Smooth the bank.
    const win = Math.round(7 / this.step);
    this.bank = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      let acc = 0;
      for (let k = -win; k <= win; k++) acc += bank[(i + k + this.n) % this.n];
      this.bank[i] = acc / (2 * win + 1);
    }
    for (let i = 0; i < this.n; i++) {
      // Keep the station level.
      if (i * this.step < STATION.length - 2) this.bank[i] = 0;
      this.up[i].applyAxisAngle(this.tan[i], this.bank[i]);
    }
    this.right = this.tan.map((t, i) => new THREE.Vector3().crossVectors(t, this.up[i]).normalize());
    this.loopMask = loopMask;
    this.flags = flags;
    this._v = new THREE.Vector3();
  }

  wrap(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }
  _idx(s) {
    const f = this.wrap(s) / this.step;
    const i = Math.floor(f) % this.n;
    return [i, (i + 1) % this.n, f - Math.floor(f)];
  }
  point(s, out = new THREE.Vector3()) {
    const [i, j, t] = this._idx(s);
    return out.lerpVectors(this.pts[i], this.pts[j], t);
  }
  height(s) {
    const [i, j, t] = this._idx(s);
    return this.pts[i].y + (this.pts[j].y - this.pts[i].y) * t;
  }
  slope(s) {
    const [i, j, t] = this._idx(s);
    return this.tan[i].y * (1 - t) + this.tan[j].y * t;
  }
  // Frame at s: position, tangent (direction of travel), up, right.
  frame(s, pos, tan, up, right) {
    const [i, j, t] = this._idx(s);
    pos.lerpVectors(this.pts[i], this.pts[j], t);
    tan.lerpVectors(this.tan[i], this.tan[j], t).normalize();
    up.lerpVectors(this.up[i], this.up[j], t);
    up.addScaledVector(tan, -up.dot(tan)).normalize();
    right.crossVectors(tan, up).normalize();
  }
  // Orientation quaternion for an object whose local +Z is forward, +Y up.
  quat(s, out = new THREE.Quaternion()) {
    const p = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3();
    this.frame(s, p, t, u, r);
    const m = new THREE.Matrix4().makeBasis(r.negate(), u, t);
    return out.setFromRotationMatrix(m);
  }
  inZone(s, a, b) {
    s = this.wrap(s);
    return s >= this.zones[a] && s < this.zones[b];
  }
}
