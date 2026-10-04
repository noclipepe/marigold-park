import * as THREE from 'three';
import { NODES, EDGES, SHOPS, COASTER, WHEEL, CAROUSEL, LAKE } from '../sim/layout.js';
import { getTrack } from '../sim/rides.js';
import { offsetPath } from '../sim/graph.js';
import { mulberry32 } from '../sim/util.js';
import { radialTexture } from './textures.js';

// Decorative evening lighting: bulb strings, bollards, fairy lights, fountain
// colours, floating lanterns, searchlights and fireworks. Purely presentational.
const _c = new THREE.Color(), _d = new THREE.Object3D();

class BulbSet {
  constructor(parent, pts, { size = 0.07, color = 0xffd27a, mode = 'static', colors = null } = {}) {
    this.pts = pts;
    this.mode = mode;
    this.base = pts.map((p, i) => new THREE.Color(colors ? colors[i % colors.length] : color));
    this.phase = pts.map((p, i) => (i * 0.6180339) % 1);
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), pts.length);
    pts.forEach((p, i) => { _d.position.copy(p); _d.updateMatrix(); this.mesh.setMatrixAt(i, _d.matrix); this.mesh.setColorAt(i, _c.set(0x222222)); });
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  update(t, k) {
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      let lvl = 1;
      switch (this.mode) {
        case 'chase': { // rainbow wave travelling along the string
          const h = (i / n * 4 - t * 0.18) % 1;
          _c.setHSL((h + 1) % 1, 0.9, 0.6);
          lvl = 0.85 + 0.15 * Math.sin(t * 6 + i * 0.5);
          break;
        }
        case 'twinkle':
          _c.copy(this.base[i]);
          lvl = 0.55 + 0.45 * Math.max(0, Math.sin(t * (1.3 + this.phase[i] * 2.2) + this.phase[i] * 40));
          break;
        case 'hue':
          _c.setHSL((t * 0.07 + i / n) % 1, 0.85, 0.6);
          break;
        case 'alternate':
          _c.copy(this.base[i]);
          lvl = (Math.floor(t * 1.6) + i) % 2 ? 1 : 0.45;
          break;
        default:
          _c.copy(this.base[i]);
      }
      _c.multiplyScalar(lvl * (0.35 + 2.4 * k));
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export class EveningFx {
  constructor(sceneMgr, sim, park, rides) {
    this.sm = sceneMgr;
    this.sim = sim;
    this.park = park;
    this.rides = rides;
    this.rng = mulberry32(77);
    this.group = new THREE.Group();
    this.group.visible = false;
    sceneMgr.scene.add(this.group);
    this.sets = [];
    this.k = 0;
    this.time = 0;
    this.glowTex = radialTexture('rgba(255,255,255,1)');
    this.coasterLights();
    this.gateLights();
    this.shopLights();
    this.queueLights();
    this.bollards();
    this.fairyLights();
    this.fountainLights();
    this.lanterns();
    this.searchlights();
    this.fireworksInit();
  }

  add(pts, opts) { const s = new BulbSet(this.group, pts, opts); this.sets.push(s); return s; }

  // --------------------------------------------------------------- strings
  coasterLights() {
    const tr = getTrack();
    const P = new THREE.Vector3(), T = new THREE.Vector3(), U = new THREE.Vector3(), R = new THREE.Vector3();
    const pts = [];
    for (let s = 0; s < tr.length; s += 1.6) {
      tr.frame(s, P, T, U, R);
      for (const side of [-1, 1]) pts.push(P.clone().addScaledVector(R, side * 0.62).addScaledVector(U, -0.12));
    }
    this.add(pts, { size: 0.075, mode: 'chase' });
  }

  gateLights() {
    const pts = [];
    const z = 63;
    for (const zz of [z + 0.74, z - 0.74]) for (let x = -8.6; x <= 8.6; x += 0.55) { pts.push(new THREE.Vector3(x, 8.92, zz), new THREE.Vector3(x, 7.08, zz)); }
    for (const sx of [-1, 1]) {
      const cx = sx * 10.5;
      for (const [dx, dz] of [[-1.85, -1.85], [1.85, -1.85], [-1.85, 1.85], [1.85, 1.85]]) {
        for (let y = 0.8; y <= 8.4; y += 0.5) pts.push(new THREE.Vector3(cx + dx, y, z + dz));
        // Roof ridges up to the finial.
        for (let k = 0; k <= 8; k++) { const f = k / 8; pts.push(new THREE.Vector3(cx + dx * (1 - f) * 0.95, 9.0 + f * 4.1, z + dz * (1 - f) * 0.95)); }
      }
    }
    this.add(pts, { size: 0.08, mode: 'twinkle', colors: [0xffe2a8, 0xfff1d6, 0xffc46b] });
  }

  shopLights() {
    const pts = [], cols = [];
    for (const s of SHOPS) {
      const [x, z] = s.center;
      const f = s.facing;
      for (let dz = -2.6; dz <= 2.6; dz += 0.32) { pts.push(new THREE.Vector3(x + f * 4.3, 2.18 + 0.05 * Math.cos(dz * 4), z + dz)); cols.push(s.id === 'K-01' ? 0xff9fb6 : 0x9fd2ff); }
      // Roof edge outline.
      for (let dx = -3.5; dx <= 3.5; dx += 0.45) for (const sz of [-1, 1]) { pts.push(new THREE.Vector3(x + dx, 3.5, z + sz * 2.75)); cols.push(0xffe0a0); }
    }
    this.add(pts, { size: 0.065, mode: 'alternate', colors: cols });
    this.shopPts = pts;
  }

  queueLights() {
    const pts = [];
    for (const lane of [COASTER.queue, WHEEL.queue, CAROUSEL.queue]) {
      const base = lane.pts.map((p) => [p.x, p.z]);
      for (const off of [-0.98, 0.98]) {
        const o = offsetPath(base, off).slice(0, -1);
        for (let i = 0; i < o.length - 1; i++) {
          const a = o[i], b = o[i + 1];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let d = 0; d < len; d += 0.9) { const t = d / len; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 0.97, a[1] + (b[1] - a[1]) * t)); }
        }
      }
    }
    this.add(pts, { size: 0.045, color: 0x9fd8ff, mode: 'twinkle' });
  }

  bollards() {
    const pts = [];
    for (const [a, b, kind] of EDGES) {
      if (kind !== 'path') continue;
      const A = NODES[a], B = NODES[b];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
      for (let d = 3; d < len - 3; d += 7) {
        for (const side of [-1, 1]) {
          const x = A[0] + dx * d - dz * 2.25 * side, z = A[1] + dz * d + dx * 2.25 * side;
          if (Math.hypot(x, z - 16) < 17.5) continue;
          if (!this.park.isFree(x, z, 0) && false) continue;
          pts.push([x, z]);
        }
      }
    }
    // Posts are real furniture, visible by day too.
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.5, metalness: 0.4 }), pts.length);
    pts.forEach(([x, z], i) => { _d.position.set(x, 0.31, z); _d.updateMatrix(); post.setMatrixAt(i, _d.matrix); });
    post.castShadow = true;
    this.sm.scene.add(post);
    this.add(pts.map(([x, z]) => new THREE.Vector3(x, 0.66, z)), { size: 0.085, color: 0xffd9a0 });
    // Small light pools on the paving.
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const pool = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,214,150,1)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }), pts.length);
    pts.forEach(([x, z], i) => { _d.position.set(x, 0.05, z); _d.scale.set(3.2, 1, 3.2); _d.updateMatrix(); pool.setMatrixAt(i, _d.matrix); });
    _d.scale.set(1, 1, 1);
    pool.renderOrder = 2;
    this.group.add(pool);
    this.bollardPool = pool;
  }

  fairyLights() {
    const spots = (this.park.treeSpots || []).filter(([x, z]) => {
      // Trees near the main walkways and plazas.
      for (const [a, b, kind] of EDGES) {
        if (kind === 'service') continue;
        const A = NODES[a], B = NODES[b];
        const vx = B[0] - A[0], vz = B[1] - A[1];
        const t = Math.max(0, Math.min(1, ((x - A[0]) * vx + (z - A[1]) * vz) / (vx * vx + vz * vz)));
        if (Math.hypot(A[0] + vx * t - x, A[1] + vz * t - z) < 9) return true;
      }
      return false;
    }).slice(0, 70);
    const pts = [], cols = [];
    const palette = [0xfff0c8, 0xffd27a, 0xffe9a8, 0xfff6e0];
    for (const [x, z, s, v] of spots) {
      const cy = v === 0 ? 3.4 : v === 2 ? 2.5 : 4.5, r = v === 0 ? 1.85 : v === 2 ? 1.5 : 1.5;
      for (let i = 0; i < 16; i++) {
        const u = this.rng() * Math.PI * 2, w = Math.acos(1 - this.rng() * 1.4);
        const ry = v === 3 ? 1.5 : 0.95;
        pts.push(new THREE.Vector3(x + Math.cos(u) * Math.sin(w) * r * s, cy * s + Math.cos(w) * r * s * ry, z + Math.sin(u) * Math.sin(w) * r * s));
        cols.push(palette[i % palette.length]);
      }
    }
    this.add(pts, { size: 0.06, mode: 'twinkle', colors: cols });
  }

  fountainLights() {
    const pts = [];
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 5.0, 0.66, 16 + Math.sin(a) * 5.0)); }
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 2.35, 2.47, 16 + Math.sin(a) * 2.35)); }
    this.add(pts, { size: 0.12, mode: 'hue' });
    const geo = new THREE.CircleGeometry(5.1, 40);
    geo.rotateX(-Math.PI / 2);
    this.fountainGlow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,255,255,1)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0x66ccff }));
    this.fountainGlow.position.set(0, 0.63, 16);
    this.group.add(this.fountainGlow);
  }

  lanterns() {
    this.lanternData = [];
    const n = 16;
    const geo = new THREE.SphereGeometry(0.22, 10, 8);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,190,110,1)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }), n);
    for (let i = 0; i < n; i++) this.lanternData.push({ a: this.rng() * Math.PI * 2, r: 0.3 + this.rng() * 0.6, sp: (this.rng() - 0.5) * 0.04, ph: this.rng() * 6 });
    mesh.frustumCulled = halo.frustumCulled = false;
    this.group.add(mesh, halo);
    this.lanternMesh = mesh;
    this.lanternHalo = halo;
  }

  searchlights() {
    const h = 90;
    const geo = new THREE.ConeGeometry(7, h, 32, 1, true);
    geo.translate(0, -h / 2, 0);
    geo.rotateX(Math.PI); // apex at the origin, opening upwards
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(0xcfe2ff) }, opacity: { value: 0 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y / ${h.toFixed(1)}; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float a = opacity * pow(clamp(1.0 - vY, 0.0, 1.0), 1.4) * edge * 0.32; a = clamp(a, 0.0, 1.0); gl_FragColor = vec4(color * a, a); }`,
    });
    this.beams = [];
    for (const [x, z, ph] of [[-18, 72, 0], [18, 72, 2.1], [-30, -64, 4.2], [55, -62, 1.3]]) {
      const b = new THREE.Mesh(geo, mat);
      b.position.set(x, 0.6, z);
      b.userData.ph = ph;
      b.frustumCulled = false;
      b.renderOrder = 3;
      this.group.add(b);
      this.beams.push(b);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.0, 12), new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.4, metalness: 0.6 }));
      base.position.set(x, 0.5, z);
      this.sm.scene.add(base);
    }
    this.beamMat = mat;
  }

  // --------------------------------------------------------------- fireworks
  fireworksInit() {
    const N = 2400;
    this.fw = { N, pos: new Float32Array(N * 3), col: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), base: new Float32Array(N * 3), next: 0, shells: [], timer: 2 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.fw.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.fw.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({ size: 2.0, map: this.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
    this.fwPoints = new THREE.Points(g, m);
    this.fwPoints.frustumCulled = false;
    this.group.add(this.fwPoints);
  }

  spawnParticle(x, y, z, vx, vy, vz, color, life) {
    const f = this.fw;
    const i = f.next;
    f.next = (f.next + 1) % f.N;
    f.pos.set([x, y, z], i * 3);
    f.vel.set([vx, vy, vz], i * 3);
    f.base.set([color.r, color.g, color.b], i * 3);
    f.life[i] = life;
    f.max[i] = life;
  }

  launch() {
    const r = this.rng;
    const x = -15 + r() * 70, z = -60 + r() * 14;
    const hue = r();
    this.fw.shells.push({ x, y: 1, z, vy: 26 + r() * 6, target: 24 + r() * 14, hue, hue2: (hue + 0.12 + r() * 0.3) % 1, kind: r() < 0.3 ? 'ring' : 'peony' });
  }

  burst(s) {
    const r = this.rng;
    const n = 140 + Math.floor(r() * 80);
    const c1 = new THREE.Color().setHSL(s.hue, 0.9, 0.62), c2 = new THREE.Color().setHSL(s.hue2, 0.95, 0.66);
    for (let i = 0; i < n; i++) {
      let vx, vy, vz;
      if (s.kind === 'ring') {
        const a = (i / n) * Math.PI * 2;
        vx = Math.cos(a); vy = Math.sin(a) * 0.25; vz = Math.sin(a);
      } else {
        const u = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        vx = q * Math.cos(a); vy = u; vz = q * Math.sin(a);
      }
      const sp = 11 + r() * 4;
      this.spawnParticle(s.x, s.y, s.z, vx * sp, vy * sp + 2, vz * sp, i % 3 ? c1 : c2, 1.8 + r() * 0.9);
    }
  }

  updateFireworks(dt) {
    const f = this.fw;
    if (this.k > 0.6) {
      f.timer -= dt;
      if (f.timer <= 0) { this.launch(); if (this.rng() < 0.35) this.launch(); f.timer = 1.4 + this.rng() * 3.2; }
    }
    const trail = new THREE.Color(1, 0.8, 0.5);
    for (let i = f.shells.length - 1; i >= 0; i--) {
      const s = f.shells[i];
      s.y += s.vy * dt;
      s.vy -= 9 * dt;
      this.spawnParticle(s.x + (this.rng() - 0.5) * 0.2, s.y, s.z, 0, -1, 0, trail, 0.5);
      if (s.y >= s.target || s.vy < 4) { this.burst(s); f.shells.splice(i, 1); }
    }
    for (let i = 0; i < f.N; i++) {
      if (f.life[i] <= 0) { f.col[i * 3] = f.col[i * 3 + 1] = f.col[i * 3 + 2] = 0; continue; }
      f.life[i] -= dt;
      const j = i * 3;
      f.vel[j + 1] -= 6.5 * dt;
      const drag = Math.exp(-dt * 1.3);
      f.vel[j] *= drag; f.vel[j + 1] *= drag; f.vel[j + 2] *= drag;
      f.pos[j] += f.vel[j] * dt; f.pos[j + 1] += f.vel[j + 1] * dt; f.pos[j + 2] += f.vel[j + 2] * dt;
      const lf = Math.max(0, f.life[i] / f.max[i]);
      const flick = lf < 0.35 ? (Math.random() < 0.5 ? 0.3 : 1) : 1;
      const b = lf * lf * 2.2 * flick;
      f.col[j] = f.base[j] * b; f.col[j + 1] = f.base[j + 1] * b; f.col[j + 2] = f.base[j + 2] * b;
    }
    this.fwPoints.geometry.attributes.position.needsUpdate = true;
    this.fwPoints.geometry.attributes.color.needsUpdate = true;
  }

  // --------------------------------------------------------------- per frame
  setEvening(k) {
    this.k = k;
    this.group.visible = k > 0.02;
    if (this.bollardPool) this.bollardPool.material.opacity = k * 0.5;
    this.beamMat.uniforms.opacity.value = k;
    this.fountainGlow.material.opacity = k * 0.55;
  }

  update(dt, paused) {
    if (!this.group.visible) {
      const jm = this.rides.jets.im.material;
      if (jm.emissive.r > 0) { jm.emissive.setRGB(0, 0, 0); }
      return;
    }
    const k = this.k;
    if (!paused) this.time += dt;
    const t = this.time;
    this.colorTimer = (this.colorTimer || 0) - dt;
    if (this.colorTimer <= 0) {
      for (const s of this.sets) s.update(t, k);
      this.colorTimer = 1 / 30;
    }
    // Fountain colours.
    const hue = (t * 0.07) % 1;
    this.rides.jets.im.material.emissive.setHSL(hue, 0.9, 0.5).multiplyScalar(k * 1.6);
    this.fountainGlow.material.color.setHSL(hue, 0.8, 0.6);
    // Lanterns drifting on the lake.
    const L = this.lanternData;
    for (let i = 0; i < L.length; i++) {
      const d = L[i];
      if (!paused) d.a += d.sp * dt;
      const x = LAKE.center[0] + Math.cos(d.a) * LAKE.rx * d.r, z = LAKE.center[1] + Math.sin(d.a) * LAKE.rz * d.r;
      const y = 0.25 + Math.sin(t * 1.2 + d.ph) * 0.04;
      _d.position.set(x, y, z); _d.scale.set(1, 1.25, 1); _d.updateMatrix();
      this.lanternMesh.setMatrixAt(i, _d.matrix);
      const fl = 0.85 + 0.15 * Math.sin(t * 9 + d.ph * 3);
      this.lanternMesh.setColorAt(i, _c.set(0xffa648).multiplyScalar(fl * (0.4 + 2.2 * k)));
      _d.position.set(x, 0.09, z); _d.scale.set(2.6, 1, 2.6); _d.updateMatrix();
      this.lanternHalo.setMatrixAt(i, _d.matrix);
    }
    _d.scale.set(1, 1, 1);
    this.lanternMesh.instanceMatrix.needsUpdate = true;
    this.lanternMesh.instanceColor.needsUpdate = true;
    this.lanternHalo.instanceMatrix.needsUpdate = true;
    this.lanternHalo.material.opacity = 0.75 * k;
    // Searchlights sweep slowly.
    for (const b of this.beams) {
      const ph = b.userData.ph;
      b.rotation.set(0.42 + 0.16 * Math.sin(t * 0.21 + ph), 0, 0);
      b.rotation.order = 'YXZ';
      b.rotation.y = ph + t * 0.18 + Math.sin(t * 0.13 + ph) * 0.8;
    }
    this.updateFireworks(paused ? 0 : dt);
  }
}
