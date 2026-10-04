import * as THREE from 'three';
import { Batcher, makeMaterials, mat, sweep, circleProfile, rectProfile } from './build.js';
import { bakeGround, GROUND, detailTexture, stripeTexture, textTexture, radialTexture, woodTexture, roofTexture, waterNormal, flowerBeds } from './textures.js';
import { NODES, EDGES, COASTER, WHEEL, CAROUSEL, SHOPS, BENCHES, LAKE, PARK, DEPOT } from '../sim/layout.js';
import { getTrack } from '../sim/rides.js';
import { STATION } from '../sim/track.js';
import { offsetPath } from '../sim/graph.js';
import { mulberry32 } from '../sim/util.js';

const C = {
  cream: 0xf3e9d6, white: 0xf7f4ee, stone: 0xd8cdb8, darkStone: 0x9d9384, terracotta: 0xc9714f, marigold: 0xf2a423, coral: 0xe4553f,
  teal: 0x2a9d8f, navy: 0x2b3a55, green: 0x3d7a4f, darkGreen: 0x2f5d3f, wood: 0xa8774a, darkWood: 0x6b4a30, metal: 0x8d939a,
  darkMetal: 0x3e444c, gold: 0xd8a640, red: 0xd2402f, rail: 0xd8442f, support: 0xf2efe8,
};

export class ParkBuilder {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    this.scene = sceneMgr.scene;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.tex = { wood: woodTexture(), roof: roofTexture('#b85a3e') };
    this.mats = makeMaterials(this.tex);
    this.B = new Batcher(this.mats);
    this.pickables = [];
    this.glowMats = [this.mats.glow];
    this.lightPools = [];
    this.bulbs = []; // {pos, color}
    this.signs = {};
    this.rng = mulberry32(42);
    this.exclusions = [];
  }

  build() {
    this.ground();
    this.lake();
    this.entrance();
    this.fountain();
    this.coasterStatic();
    this.wheelStatic();
    this.carouselStatic();
    this.shopsStatic();
    this.depot();
    this.queueFences();
    this.furniture();
    this.perimeter();
    this.landscape();
    this.festoons();
    this.B.build(this.root);
    this.buildBulbs();
    this.buildLightPools();
    return this;
  }

  addPick(mesh, id) {
    mesh.userData.pick = id;
    this.pickables.push(mesh);
  }

  pickBox(id, w, h, d, x, y, z, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.updateMatrixWorld();
    this.root.add(m);
    this.addPick(m, id);
    return m;
  }

  exclude(x, z, r) { this.exclusions.push({ x, z, r }); }
  excludeRect(x0, z0, x1, z1) { this.exclusions.push({ x0, z0, x1, z1 }); }

  // ------------------------------------------------------------------ ground
  ground() {
    const tex = bakeGround();
    const w = GROUND.maxX - GROUND.minX, h = GROUND.maxZ - GROUND.minZ;
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((GROUND.minX + GROUND.maxX) / 2, 0, (GROUND.minZ + GROUND.maxZ) / 2);
    const detail = detailTexture();
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform sampler2D detailMap;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n float dn = texture2D(detailMap, vWPos.xz * 0.35).r * 0.6 + texture2D(detailMap, vWPos.xz * 0.06).r * 0.4; diffuseColor.rgb *= mix(1.0, dn * 1.25, 0.55);');
    };
    const ground = new THREE.Mesh(geo, m);
    ground.receiveShadow = true;
    this.root.add(ground);
    // Far ground.
    const far = new THREE.Mesh(new THREE.RingGeometry(150, 1300, 48, 1), new THREE.MeshStandardMaterial({ color: 0x8aa860, roughness: 1 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.05;
    this.root.add(far);
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(320, 280), new THREE.MeshStandardMaterial({ color: 0x8aaf5f, roughness: 1 }));
    mid.rotation.x = -Math.PI / 2;
    mid.position.set(0, -0.08, 5);
    mid.receiveShadow = true;
    this.root.add(mid);
    // Exclusion zones for scattering (paths and structures).
    for (const [a, b, k] of EDGES) {
      const A = NODES[a], B = NODES[b];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      for (let d = 0; d <= len; d += 2) {
        const t = d / len;
        this.exclude(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, k === 'main' ? 5 : 3.3);
      }
    }
    this.exclude(0, 16, 18); this.exclude(0, 53, 12); this.exclude(-66, 10, 8.5); this.exclude(13, -20, 7);
    this.exclude(CAROUSEL.center[0], CAROUSEL.center[1], 11.5);
    this.exclude(LAKE.center[0], LAKE.center[1], LAKE.rx + 2.5);
    this.excludeRect(-50, -4, -18, 16);
    for (const lane of [COASTER.queue, WHEEL.queue, CAROUSEL.queue, COASTER.exitLane, WHEEL.exitLane]) {
      for (let d = 0; d <= lane.length; d += 1.5) { const p = lane.at(d); this.exclude(p.x, p.z, 2.4); }
    }
    for (const s of SHOPS) this.exclude(s.center[0], s.center[1], 6.5);
    this.excludeRect(DEPOT.pos[0] - 13, DEPOT.pos[1] - 11, DEPOT.pos[0] + 13, DEPOT.pos[1] + 10);
    this.excludeRect(-28, 62, 28, 90);
    // Coaster footprint.
    const tr = getTrack();
    for (let i = 0; i < tr.n; i += 6) this.exclude(tr.pts[i].x, tr.pts[i].z, 3.2);
    // Wheel footprint.
    const t = new THREE.Vector3(Math.cos(WHEEL.yaw), 0, Math.sin(WHEEL.yaw));
    for (let k = -15; k <= 15; k += 2) this.exclude(WHEEL.hub[0] + t.x * k, WHEEL.hub[2] + t.z * k, 5);
  }

  isFree(x, z, r = 0) {
    for (const e of this.exclusions) {
      if (e.r !== undefined) { if (Math.hypot(e.x - x, e.z - z) < e.r + r) return false; }
      else if (x > e.x0 - r && x < e.x1 + r && z > e.z0 - r && z < e.z1 + r) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ lake
  lake() {
    const shape = new THREE.Shape();
    shape.absellipse(0, 0, LAKE.rx + 0.3, LAKE.rz + 0.3, 0, Math.PI * 2);
    const geo = new THREE.ShapeGeometry(shape, 64);
    geo.rotateX(-Math.PI / 2);
    const nrm = waterNormal();
    nrm.repeat.set(0.25, 0.25);
    const m = new THREE.MeshStandardMaterial({ color: 0x3f8fa5, roughness: 0.06, metalness: 0.1, normalMap: nrm, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.4, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(geo, m);
    water.position.set(LAKE.center[0], 0.06, LAKE.center[1]);
    water.receiveShadow = true;
    this.root.add(water);
    this.water = water;
    // Stone edging and rocks.
    const B = this.B;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + this.rng() * 0.05;
      const x = LAKE.center[0] + Math.cos(a) * (LAKE.rx + 0.9), z = LAKE.center[1] + Math.sin(a) * (LAKE.rz + 0.9);
      const s = 0.35 + this.rng() * 0.4;
      B.add(new THREE.DodecahedronGeometry(s, 0), mat(x, s * 0.35, z, this.rng(), this.rng(), this.rng(), 1.3, 0.6, 1), [0xb7ad9c, 0xa39a8a, 0xc6bdab][i % 3], 'concrete');
    }
    // Lily pads.
    for (let i = 0; i < 14; i++) {
      const a = this.rng() * Math.PI * 2, r = 0.55 + this.rng() * 0.35;
      const x = LAKE.center[0] + Math.cos(a) * LAKE.rx * r, z = LAKE.center[1] + Math.sin(a) * LAKE.rz * r;
      B.cyl(0.45 + this.rng() * 0.2, 0.45, 0.04, 10, x, 0.09, z, 0x4f8a3c, 'foliage');
      if (i % 3 === 0) B.add(new THREE.SphereGeometry(0.12, 6, 4), mat(x + 0.1, 0.16, z), 0xf4b6c8, 'paint');
    }
    // Pier.
    const px = 11, pz0 = -26.5, pz1 = -31.5;
    B.box(2.0, 0.14, pz0 - pz1, px, 0.42, (pz0 + pz1) / 2, 0xc89463, 'wood');
    for (const sx of [-0.9, 0.9]) for (let z = pz1; z <= pz0; z += 1.6) B.cyl(0.08, 0.08, 0.9, 6, px + sx, 0.2, z, C.darkWood, 'wood');
    for (const sx of [-0.95, 0.95]) B.bar(new THREE.Vector3(px + sx, 1.25, pz0), new THREE.Vector3(px + sx, 1.25, pz1), 0.06, 0.06, C.white, 'paint');
    for (const sx of [-0.95, 0.95]) for (let z = pz1; z <= pz0 + 0.1; z += 1.6) B.cyl(0.04, 0.04, 0.8, 6, px + sx, 0.88, z, C.white, 'paint');
    // Little boat.
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 2.2, 10, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xe2553e, roughness: 0.5 }));
    hull.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    hull.castShadow = true;
    boat.add(hull);
    boat.position.set(16, 0.3, -38);
    boat.rotation.y = 0.6;
    this.root.add(boat);
    this.boat = boat;
  }

  // ------------------------------------------------------------------ entrance
  entrance() {
    const B = this.B;
    const z = 63;
    for (const sx of [-1, 1]) {
      const x = sx * 10.5;
      // Tower
      B.box(4.4, 0.6, 4.4, x, 0.3, z, C.stone, 'concrete');
      B.box(3.6, 8.2, 3.6, x, 4.4, z, C.cream, 'paint');
      for (let k = 0; k < 4; k++) B.box(3.7, 0.25, 3.7, x, 1.6 + k * 2.1, z, C.terracotta, 'paint');
      B.box(4.0, 0.5, 4.0, x, 8.7, z, C.white, 'paint');
      B.add(new THREE.ConeGeometry(3.0, 4.2, 4, 1), mat(x, 11.0, z, 0, Math.PI / 4, 0), 0x2f8f86, 'gloss');
      B.add(new THREE.SphereGeometry(0.35, 12, 8), mat(x, 13.3, z), C.gold, 'metal');
      B.cyl(0.05, 0.05, 2.2, 6, x, 14.4, z, C.white, 'metal');
      // windows
      for (const wz of [-1.82, 1.82]) {
        B.box(1.1, 1.6, 0.06, x, 5.6, z + wz, 0xffd99a, 'glow');
        B.box(1.1, 1.0, 0.06, x, 2.8, z + wz, 0xffd99a, 'glow');
      }
      // Ticket booth
      const bx = x + sx * 5.6;
      B.box(3.4, 3.0, 3.0, bx, 1.5, z + 0.5, C.cream, 'paint');
      B.box(3.9, 0.3, 3.5, bx, 3.15, z + 0.5, C.terracotta, 'paint');
      B.box(2.4, 1.2, 0.06, bx, 1.8, z + 2.02, 0xffe2b0, 'glow');
      B.box(2.8, 0.12, 0.5, bx, 1.12, z + 2.2, C.wood, 'wood');
      const st = stripeTexture('#e9a23a', '#fff6e4', 10);
      st.repeat.set(1, 1);
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.2), new THREE.MeshStandardMaterial({ map: st, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, roughness: 0.8 }));
      awn.position.set(bx, 2.75, z + 2.35);
      awn.rotation.x = -0.9;
      awn.castShadow = true;
      this.root.add(awn);
    }
    // Arch beam and sign.
    B.box(17.4, 1.3, 1.2, 0, 8.0, z, C.white, 'paint');
    B.box(17.6, 0.25, 1.4, 0, 8.75, z, C.terracotta, 'paint');
    B.box(17.6, 0.25, 1.4, 0, 7.25, z, C.terracotta, 'paint');
    const sign = textTexture([{ text: 'MARIGOLD PARK', size: 92, weight: 900 }], { w: 1024, h: 140, bg: '#2c7c76', color: '#fff4dc', radius: 20, border: '#f2c264', borderWidth: 6 });
    const signMat = new THREE.MeshStandardMaterial({ map: sign.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: sign.texture, emissiveIntensity: 0 });
    this.signGlow = [signMat];
    for (const sz of [1, -1]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 1.7), signMat);
      s.position.set(0, 9.9, z + sz * 0.62);
      if (sz < 0) s.rotation.y = Math.PI;
      this.root.add(s);
    }
    B.box(13, 1.9, 1.0, 0, 9.9, z, 0x2c7c76, 'paint');
    // Big marigold emblem.
    const flower = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf6a51d : 0xf7c23c, roughness: 0.5 }));
      p.scale.set(1, 0.35, 0.55);
      const a = (i / 12) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0);
      p.rotation.z = a;
      flower.add(p);
    }
    const ctr = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 10), new THREE.MeshStandardMaterial({ color: 0xc8611c, roughness: 0.6 }));
    ctr.scale.z = 0.5;
    flower.add(ctr);
    flower.position.set(0, 12.0, z);
    flower.traverse((o) => (o.castShadow = true));
    this.root.add(flower);
    this.gateFlower = flower;
    // Turnstiles.
    for (let i = -3; i <= 3; i++) {
      const x = i * 1.55;
      if (i === 0) continue;
      B.box(0.35, 1.0, 1.4, x, 0.5, z, C.darkMetal, 'metal');
      B.box(0.42, 0.08, 1.5, x, 1.04, z, C.metal, 'metal');
    }
    // Flags.
    for (const x of [-20, -16, 16, 20]) {
      B.cyl(0.07, 0.07, 9, 8, x, 4.5, z - 1.2, C.white, 'metal');
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 6, 1), new THREE.MeshStandardMaterial({ color: x < 0 ? 0xf2a423 : 0x2a9d8f, side: THREE.DoubleSide, roughness: 0.7 }));
      flag.position.set(x + 0.9, 8.3, z - 1.2);
      flag.castShadow = true;
      this.root.add(flag);
      (this.flags ||= []).push(flag);
    }
    // Planters along the entrance plaza.
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
      const px = sx * 6.6, pz = 44 + k * 7;
      if (k === 1) continue;
      B.box(1.6, 0.6, 1.6, px, 0.3, pz, C.terracotta, 'concrete');
    }
    this.pickBox('GATE', 22, 10, 3, 0, 5, z);
    // Outside: parked cars and a bus shelter.
    const carCols = [0xd94b3d, 0x3c7bd6, 0xf2f0ea, 0x2f343c, 0xf2b33d, 0x5aa36b, 0x8b8fa0, 0xc9d1d9];
    for (let i = 0; i < 16; i++) {
      const side = i < 8 ? -1 : 1;
      const x = side * (30 + (i % 8) * 3.4);
      if (Math.abs(x) > 105) continue;
      const zc = 70.5;
      const col = carCols[i % carCols.length];
      B.box(1.8, 0.7, 4.0, x, 0.55, zc, col, 'gloss');
      B.box(1.6, 0.6, 2.2, x, 1.15, zc + 0.2, 0x2a3440, 'glass');
      B.box(1.62, 0.08, 2.3, x, 1.48, zc + 0.2, col, 'gloss');
      for (const wx of [-0.85, 0.85]) for (const wz of [-1.3, 1.3]) B.cyl(0.33, 0.33, 0.25, 10, x + wx, 0.33, zc + wz, 0x1d1f22, 'paint', 0, 0, Math.PI / 2);
    }
    // Bus at the drop-off.
    B.box(2.6, 2.6, 11, 14, 1.65, 77, 0xf0b23a, 'gloss', Math.PI / 2);
    B.box(2.62, 0.9, 10.4, 14, 2.3, 77, 0x26303c, 'glass', Math.PI / 2);
    for (const wx of [-3.6, 3.6]) for (const wz of [-1.3, 1.3]) B.cyl(0.5, 0.5, 0.35, 12, 14 + wx, 0.5, 77 + wz, 0x1d1f22, 'paint', Math.PI / 2);
    B.box(4.5, 0.12, 2.0, -10, 2.6, 72.3, C.teal, 'paint');
    for (const x of [-12, -8]) B.cyl(0.06, 0.06, 2.6, 6, x, 1.3, 71.6, C.darkMetal, 'metal');
  }

  // ------------------------------------------------------------------ fountain
  fountain() {
    const B = this.B;
    B.cyl(5.8, 6.0, 0.7, 48, 0, 0.35, 16, C.stone, 'concrete');
    B.cyl(5.2, 5.2, 0.72, 48, 0, 0.37, 16, 0x7d8f8f, 'concrete');
    const water = new THREE.Mesh(new THREE.CircleGeometry(5.2, 48), new THREE.MeshStandardMaterial({ color: 0x4aa6bd, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.5, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.3, 0.3) }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.6, 16);
    water.receiveShadow = true;
    this.root.add(water);
    this.fountainWater = water;
    B.cyl(0.9, 1.3, 1.6, 20, 0, 1.2, 16, C.stone, 'concrete');
    B.cyl(2.6, 0.9, 0.5, 28, 0, 2.2, 16, C.cream, 'concrete');
    B.cyl(0.45, 0.6, 1.6, 16, 0, 3.2, 16, C.stone, 'concrete');
    B.cyl(1.4, 0.45, 0.35, 24, 0, 4.0, 16, C.cream, 'concrete');
    B.add(new THREE.SphereGeometry(0.42, 16, 10), mat(0, 4.55, 16), C.gold, 'metal');
    const w1 = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), water.material);
    w1.rotation.x = -Math.PI / 2; w1.position.set(0, 2.42, 16);
    this.root.add(w1);
    // Ring of planters around the plaza.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 16.6, z = 16 + Math.sin(a) * 16.6;
      if (Math.abs(Math.sin(a)) > 0.92 || Math.abs(Math.cos(a)) > 0.92) continue;
    }
  }

  // ------------------------------------------------------------------ coaster
  coasterStatic() {
    const B = this.B;
    const tr = getTrack();
    const pts = tr.pts, R = tr.right, U = tr.up;
    const railMat = new THREE.MeshStandardMaterial({ color: C.rail, roughness: 0.35, metalness: 0.35 });
    const spineMat = new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.45, metalness: 0.3 });
    const g1 = sweep(pts, R, U, circleProfile(0.075, 8, 0.42, 0));
    const g2 = sweep(pts, R, U, circleProfile(0.075, 8, -0.42, 0));
    const g3 = sweep(pts, R, U, rectProfile(0.26, 0.3, 0, -0.42));
    const track = new THREE.Group();
    for (const [g, m] of [[g1, railMat], [g2, railMat], [g3, spineMat]]) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      track.add(mesh);
      this.addPick(mesh, 'R-01');
    }
    this.root.add(track);
    this.trackGroup = track;
    // Ties.
    const P = new THREE.Vector3(), T = new THREE.Vector3(), Uv = new THREE.Vector3(), Rv = new THREE.Vector3();
    const tieGeo = new THREE.BoxGeometry(1.0, 0.1, 0.14);
    for (let s = 0; s < tr.length; s += 1.0) {
      tr.frame(s, P, T, Uv, Rv);
      const m = new THREE.Matrix4().makeBasis(Rv, Uv, T);
      m.setPosition(P.clone().addScaledVector(Uv, -0.18));
      B.add(tieGeo, m, 0xb83728, 'metal');
    }
    // Chain lift and catwalk.
    const liftA = tr.zones.liftStart, liftB = tr.zones.liftEnd;
    for (let s = liftA; s < liftB; s += 0.5) {
      tr.frame(s, P, T, Uv, Rv);
      const m = new THREE.Matrix4().makeBasis(Rv, Uv, T);
      m.setPosition(P.clone().addScaledVector(Uv, -0.03));
      B.add(new THREE.BoxGeometry(0.16, 0.05, 0.45), m, 0x2b2b2b, 'metal');
      // catwalk steps on the left side
      const cm = new THREE.Matrix4().makeBasis(Rv, Uv, T);
      cm.setPosition(P.clone().addScaledVector(Rv, -1.05).addScaledVector(Uv, -0.25));
      B.add(new THREE.BoxGeometry(0.75, 0.05, 0.42), cm, 0x9aa0a6, 'metal');
    }
    for (let s = liftA; s < liftB; s += 2.0) {
      tr.frame(s, P, T, Uv, Rv);
      const base = P.clone().addScaledVector(Rv, -1.4).addScaledVector(Uv, -0.25);
      B.beam(base, base.clone().addScaledVector(Uv, 1.0), 0.03, 0xf2efe8, 'metal', 6);
      const P2 = new THREE.Vector3(), T2 = new THREE.Vector3(), U2 = new THREE.Vector3(), R2 = new THREE.Vector3();
      tr.frame(Math.min(s + 2, liftB), P2, T2, U2, R2);
      const b2 = P2.clone().addScaledVector(R2, -1.4).addScaledVector(U2, 0.75);
      B.beam(base.clone().addScaledVector(Uv, 1.0), b2, 0.025, 0xf2efe8, 'metal', 6);
    }
    // Supports.
    const supportCol = C.support;
    const lower = (x, z, y) => {
      for (let i = 0; i < tr.n; i += 2) {
        const q = pts[i];
        if (Math.abs(q.x - x) < 1.4 && Math.abs(q.z - z) < 1.4 && q.y < y - 1.2) return true;
      }
      return false;
    };
    const column = (top, x, z, r) => {
      const a = new THREE.Vector3(x, 0, z);
      B.beam(a, top, r, supportCol, 'gloss', 10);
      B.cyl(r * 2.4, r * 2.8, 0.35, 8, x, 0.17, z, 0xc9c1b3, 'concrete');
    };
    for (let s = STATION.length + 3; s < tr.length - 4; s += 6.2) {
      const i = Math.floor(s / tr.step);
      if (tr.flags[i]) continue;
      tr.frame(s, P, T, Uv, Rv);
      const top = P.clone().addScaledVector(Uv, -0.55);
      if (top.y < 0.7 || Uv.y < 0.3) continue;
      if (lower(top.x, top.z, top.y)) continue;
      const h = top.y;
      // Saddle under the spine.
      const sm = new THREE.Matrix4().makeBasis(Rv, Uv, T);
      sm.setPosition(top);
      B.add(new THREE.BoxGeometry(0.5, 0.18, 0.4), sm, supportCol, 'gloss');
      if (h > 7.5) {
        const spread = 0.8 + h * 0.06;
        const side = new THREE.Vector3(Rv.x, 0, Rv.z).normalize();
        const fa = new THREE.Vector3(top.x + side.x * spread, 0, top.z + side.z * spread);
        const fb = new THREE.Vector3(top.x - side.x * spread, 0, top.z - side.z * spread);
        B.beam(fa, top, 0.2, supportCol, 'gloss', 10);
        B.beam(fb, top, 0.2, supportCol, 'gloss', 10);
        B.cyl(0.5, 0.6, 0.35, 8, fa.x, 0.17, fa.z, 0xc9c1b3, 'concrete');
        B.cyl(0.5, 0.6, 0.35, 8, fb.x, 0.17, fb.z, 0xc9c1b3, 'concrete');
        for (let y = 3.5; y < h - 1.5; y += 4.5) {
          const k = y / h;
          const pa = fa.clone().lerp(top, k), pb = fb.clone().lerp(top, k);
          B.beam(pa, pb, 0.08, supportCol, 'gloss', 6);
          const k2 = Math.min(0.98, (y + 4.5) / h);
          if (y + 4.5 < h - 1.0) B.beam(pa, fb.clone().lerp(top, k2), 0.06, supportCol, 'gloss', 6);
        }
      } else {
        column(top, top.x, top.z, 0.22);
      }
    }
    // Loop side supports.
    for (let i = 0; i < tr.n; i++) {
      if (!tr.flags[i]) continue;
      if (Math.abs(tr.tan[i].y) > 0.985 && Math.abs(tr.tan[(i + 3) % tr.n].y) <= Math.abs(tr.tan[i].y)) {
        const p = pts[i];
        const top = p.clone(); top.y -= 0.1;
        // Offset outward from the loop centre.
        column(new THREE.Vector3(p.x, p.y - 0.4, p.z), p.x, p.z, 0.26);
        i += 20;
      }
    }
    // Station.
    const x0 = -47.4, x1 = -20.6;
    B.box(x1 - x0, 0.9, 4.0, (x0 + x1) / 2, 0.45, 2.8, 0xd9d1c3, 'concrete');
    B.box(x1 - x0, 0.06, 0.25, (x0 + x1) / 2, 0.93, 0.92, 0xf2c94c, 'paint'); // safety edge
    B.box(x1 - x0, 0.9, 1.2, (x0 + x1) / 2, 0.45, -1.6, 0xd9d1c3, 'concrete');
    // Ramp to the gate.
    B.add(new THREE.BoxGeometry(2.6, 0.12, 2.2), mat(-37.6, 0.45, 5.75, 0.38, 0, 0), 0xcfc6b6, 'concrete');
    // Exit stairs at the west end.
    for (let k = 0; k < 5; k++) B.box(1.8, 0.9 - k * 0.18, 0.5, -48.4 - k * 0.0, (0.9 - k * 0.18) / 2, 3.0 + k * 0.5, 0xd2c9b9, 'concrete');
    // Railing along the platform edge, gap at the gate.
    const railY = 1.95;
    for (let x = x0 + 0.2; x <= x1 - 0.2; x += 1.6) {
      if (Math.abs(x + 37.6) < 1.2) continue;
      B.cyl(0.04, 0.04, 1.0, 6, x, 1.4, 4.75, C.darkMetal, 'metal');
    }
    B.bar(new THREE.Vector3(x0 + 0.2, railY, 4.75), new THREE.Vector3(-38.9, railY, 4.75), 0.06, 0.06, C.darkMetal, 'metal');
    B.bar(new THREE.Vector3(-36.3, railY, 4.75), new THREE.Vector3(x1 - 0.2, railY, 4.75), 0.06, 0.06, C.darkMetal, 'metal');
    // Roof structure.
    for (let x = x0 + 0.6; x <= x1; x += 4.4) {
      B.box(0.3, 4.6, 0.3, x, 3.2, 4.85, C.cream, 'paint');
      B.box(0.3, 4.6, 0.3, x, 3.2, -2.0, C.cream, 'paint');
      B.bar(new THREE.Vector3(x, 5.4, 4.85), new THREE.Vector3(x, 6.9, 1.4), 0.2, 0.25, C.darkWood, 'wood');
      B.bar(new THREE.Vector3(x, 5.4, -2.0), new THREE.Vector3(x, 6.9, 1.4), 0.2, 0.25, C.darkWood, 'wood');
    }
    const roofLen = x1 - x0 + 1.6;
    const pitch = Math.atan2(1.5, 3.45);
    // Translucent canopy (frosted panels between timber rafters) keeps the platform readable from above.
    B.add(new THREE.BoxGeometry(roofLen, 0.08, 4.4), mat((x0 + x1) / 2, 6.25, 3.25, pitch, 0, 0), 0xffe6d2, 'glass');
    B.add(new THREE.BoxGeometry(roofLen, 0.08, 4.4), mat((x0 + x1) / 2, 6.25, -0.45, -pitch, 0, 0), 0xffe6d2, 'glass');
    for (const zz of [4.95, -2.15]) B.box(roofLen, 0.22, 0.3, (x0 + x1) / 2, 5.45, zz, 0xb34a33, 'paint');
    B.box(roofLen, 0.35, 0.35, (x0 + x1) / 2, 7.05, 1.4, C.cream, 'paint');
    B.box(roofLen, 0.5, 0.2, (x0 + x1) / 2, 5.35, 5.25, C.cream, 'paint');
    // Station sign.
    const sign = textTexture([{ text: 'CYCLONE', size: 110, weight: 900 }], { w: 1024, h: 180, bg: '#c23a2a', color: '#fff3dc', radius: 24, border: '#f2c264', borderWidth: 8 });
    const sm = new THREE.MeshStandardMaterial({ map: sign.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: sign.texture, emissiveIntensity: 0 });
    this.signGlow.push(sm);
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 1.45), sm);
    sg.position.set(-33, 5.95, 5.42);
    sg.rotation.x = -0.12;
    this.root.add(sg);
    // Control booth.
    B.box(2.4, 2.4, 2.2, -21.8, 2.1, 3.4, C.cream, 'paint');
    B.box(2.42, 1.0, 2.22, -21.8, 2.4, 3.4, 0x9fc6d8, 'glass');
    B.box(2.7, 0.2, 2.5, -21.8, 3.4, 3.4, C.coral, 'paint');
    this.bulbsAlong([[-47.4, 5.5, 5.3], [-20.6, 5.5, 5.3]], 22, 0xffd27a);
    this.pickBox('R-01', 28, 7, 8, -34, 3.5, 1.4);
    // Themed tower at the queue entrance.
    B.box(0.5, 6.5, 0.5, -24.4, 3.25, 16.0, C.cream, 'paint');
    const ts = textTexture([{ text: 'CYCLONE', size: 74, weight: 900 }, { text: 'THRILL COASTER', size: 34, weight: 700, color: '#ffe3b0' }], { w: 512, h: 220, bg: '#c23a2a', color: '#fff3dc', radius: 26, border: '#f2c264', borderWidth: 7 });
    const tm = new THREE.MeshStandardMaterial({ map: ts.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: ts.texture, emissiveIntensity: 0, side: THREE.DoubleSide });
    this.signGlow.push(tm);
    const tsm = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.46), tm);
    tsm.position.set(-24.4, 5.3, 16.3);
    tsm.rotation.y = 0.5;
    this.root.add(tsm);
    this.waitBoard('R-01', -27.0, 15.6, 0.3);
  }

  // Live "wait time" board at a queue entrance.
  waitBoard(id, x, z, ry) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 });
    this.signGlow.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), m);
    mesh.position.set(x, 1.55, z);
    mesh.rotation.y = ry;
    this.root.add(mesh);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.86, 0.08), new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.6 }));
    back.position.set(x - Math.sin(ry) * 0.05, 1.55, z - Math.cos(ry) * 0.05);
    back.rotation.y = ry;
    back.castShadow = true;
    this.root.add(back);
    this.B.cyl(0.05, 0.05, 1.2, 6, x - Math.sin(ry) * 0.06, 0.6, z - Math.cos(ry) * 0.06, C.darkMetal, 'metal');
    this.signs[id] = { canvas: c, tex, last: '' };
  }

  // ------------------------------------------------------------------ wheel
  wheelStatic() {
    const B = this.B;
    const hub = new THREE.Vector3(...WHEEL.hub);
    const t = new THREE.Vector3(Math.cos(WHEEL.yaw), 0, Math.sin(WHEEL.yaw));
    const a = new THREE.Vector3(-Math.sin(WHEEL.yaw), 0, Math.cos(WHEEL.yaw));
    const W = (u, v, y) => new THREE.Vector3(hub.x + t.x * u + a.x * v, y, hub.z + t.z * u + a.z * v);
    for (const side of [-1, 1]) {
      const top = W(0, side * 2.7, hub.y);
      for (const u of [-7.2, 7.2]) {
        const foot = W(u, side * 3.9, 0);
        B.beam(foot, top, 0.32, 0xf4f1ea, 'gloss', 12);
        B.box(1.6, 0.5, 1.6, foot.x, 0.25, foot.z, 0xc9c1b3, 'concrete', -WHEEL.yaw);
      }
      // Cross bracing.
      const l1 = W(-7.2, side * 3.9, 0).lerp(top, 0.35), l2 = W(7.2, side * 3.9, 0).lerp(top, 0.35);
      B.beam(l1, l2, 0.14, 0xf4f1ea, 'gloss', 8);
      const m1 = W(-7.2, side * 3.9, 0).lerp(top, 0.68), m2 = W(7.2, side * 3.9, 0).lerp(top, 0.68);
      B.beam(m1, m2, 0.12, 0xf4f1ea, 'gloss', 8);
      // Bearing housing.
      B.cyl(0.75, 0.75, 0.8, 16, top.x, top.y, top.z, 0x2b3a55, 'metal', 0, 0, 0);
    }
    // Axle.
    B.beam(W(0, -3.0, hub.y), W(0, 3.0, hub.y), 0.38, 0x8d939a, 'metal', 16);
    // Boarding deck.
    const deckC = W(0, 1.0, 0.225);
    B.add(new THREE.BoxGeometry(6.8, 0.45, 6.8), mat(deckC.x, 0.225, deckC.z, 0, -WHEEL.yaw, 0), 0xd2c6b2, 'concrete');
    const ramp = W(-0.8, 5.2, 0.22);
    B.add(new THREE.BoxGeometry(1.8, 0.1, 1.8), mat(ramp.x, 0.22, ramp.z, 0, -WHEEL.yaw, 0).multiply(new THREE.Matrix4().makeRotationX(0.24)), 0xcfc6b6, 'concrete');
    // Railings on the deck.
    for (let u = -3.3; u <= 3.3; u += 1.1) {
      if (Math.abs(u + 0.8) < 0.9 || Math.abs(u - 0.9) < 0.9 || Math.abs(u) < 0.3) continue;
      const p = W(u, 4.35, 0.45);
      B.cyl(0.035, 0.035, 1.0, 6, p.x, 0.95, p.z, 0x2b3a55, 'metal');
    }
    // Drive house (maintenance point).
    const dh = W(-1.6, -4.6, 0);
    B.box(3.4, 2.4, 2.6, dh.x, 1.2, dh.z, 0xe9e1d0, 'paint', -WHEEL.yaw);
    B.box(3.8, 0.25, 3.0, dh.x, 2.5, dh.z, 0x2b3a55, 'paint', -WHEEL.yaw);
    // Ticket booth + sign.
    const tb = W(-5.0, 6.6, 0);
    B.box(1.8, 2.3, 1.6, tb.x, 1.15, tb.z, 0xf4f1ea, 'paint', -WHEEL.yaw);
    B.box(2.1, 0.22, 1.9, tb.x, 2.4, tb.z, 0x3b8fd9, 'paint', -WHEEL.yaw);
    const ts = textTexture([{ text: 'SKYVIEW', size: 74, weight: 900 }, { text: 'OBSERVATION WHEEL', size: 30, weight: 700, color: '#d8ecff' }], { w: 512, h: 200, bg: '#2f6fb4', color: '#ffffff', radius: 26, border: '#f2c264', borderWidth: 7 });
    const tm = new THREE.MeshStandardMaterial({ map: ts.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: ts.texture, emissiveIntensity: 0, side: THREE.DoubleSide });
    this.signGlow.push(tm);
    const sp = W(-9.6, 12.4, 0);
    B.box(0.4, 5.2, 0.4, sp.x, 2.6, sp.z, C.cream, 'paint');
    const tsm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.25), tm);
    tsm.position.set(sp.x, 4.6, sp.z + 0.25);
    tsm.rotation.y = 0.35;
    this.root.add(tsm);
    this.waitBoard('R-02', sp.x + 2.0, sp.z + 1.0, 0.2);
    this.pickBox('R-02', 30, 34, 8, hub.x, 16, hub.z, -WHEEL.yaw);
  }

  // ------------------------------------------------------------------ carousel
  carouselStatic() {
    const B = this.B;
    const [cx, cz] = CAROUSEL.center;
    B.cyl(7.9, 8.1, 0.32, 48, cx, 0.16, cz, 0xe6dccb, 'concrete');
    // Fence ring with gaps for entry and exit.
    const ga = Math.atan2(CAROUSEL.gate[1] - cz, CAROUSEL.gate[0] - cx);
    const ea = Math.atan2(CAROUSEL.exitGate[1] - cz, CAROUSEL.exitGate[0] - cx);
    const R = 9.3;
    let prev = null;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const near = (x) => Math.abs(Math.atan2(Math.sin(a - x), Math.cos(a - x))) < 0.1;
      const p = new THREE.Vector3(cx + Math.cos(a) * R, 0, cz + Math.sin(a) * R);
      if (near(ga) || near(ea)) { prev = null; continue; }
      B.cyl(0.05, 0.05, 1.0, 6, p.x, 0.5, p.z, 0xd8a640, 'metal');
      if (prev) {
        B.bar(prev.clone().setY(0.95), p.clone().setY(0.95), 0.05, 0.05, 0xd8a640, 'metal');
        B.bar(prev.clone().setY(0.5), p.clone().setY(0.5), 0.04, 0.04, 0xd8a640, 'metal');
      }
      prev = p;
    }
    // Sign.
    const ts = textTexture([{ text: 'GRAND', size: 50, weight: 800, color: '#7a3b12' }, { text: 'CAROUSEL', size: 72, weight: 900 }], { w: 512, h: 200, bg: '#f7d48a', color: '#9e2a2b', radius: 26, border: '#9e2a2b', borderWidth: 7 });
    const tm = new THREE.MeshStandardMaterial({ map: ts.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: ts.texture, emissiveIntensity: 0, side: THREE.DoubleSide });
    this.signGlow.push(tm);
    B.box(0.35, 4.2, 0.35, 22.2, 2.1, 16.4, C.cream, 'paint');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.2), tm);
    s.position.set(22.2, 3.9, 16.65);
    s.rotation.y = 0.3;
    this.root.add(s);
    this.waitBoard('R-03', 24.6, 16.6, 0.15);
    this.pickBox('R-03', 17, 9, 17, cx, 4.5, cz);
  }

  // ------------------------------------------------------------------ shops
  shopsStatic() {
    const B = this.B;
    for (const s of SHOPS) {
      const [x, z] = s.center;
      const f = s.facing; // +1 counter faces +x
      const wallC = 0xfaf3e6;
      const trim = s.color;
      // Body: 6.4 deep (x) x 4.6 wide (z)
      B.box(6.4, 0.25, 5.0, x, 0.12, z, 0xd9cdb8, 'concrete');
      B.box(0.3, 3.0, 4.6, x - f * 3.0, 1.5, z, wallC, 'paint'); // back wall
      for (const sz of [-1, 1]) B.box(6.0, 3.0, 0.3, x, 1.5, z + sz * 2.15, wallC, 'paint');
      // Front: counter + posts, open window.
      B.box(0.6, 1.05, 4.6, x + f * 3.0, 0.52, z, trim, 'paint');
      B.box(0.9, 0.08, 4.8, x + f * 3.05, 1.08, z, 0xf7f4ee, 'gloss');
      for (const sz of [-1, 1]) B.box(0.3, 3.0, 0.4, x + f * 3.0, 1.5, z + sz * 2.1, wallC, 'paint');
      B.box(0.3, 0.6, 4.6, x + f * 3.0, 2.75, z, trim, 'paint');
      // Glass display on counter.
      B.box(0.5, 0.4, 2.6, x + f * 3.05, 1.32, z, 0xcfe8f2, 'glass');
      // Roof
      B.box(7.0, 0.3, 5.4, x, 3.15, z, 0xf7f4ee, 'paint');
      B.box(7.1, 0.12, 5.5, x, 3.36, z, trim, 'paint');
      // Back shelf (stock items are dynamic).
      B.box(0.45, 0.06, 4.0, x - f * 2.6, 1.2, z, C.wood, 'wood');
      B.box(0.45, 0.06, 4.0, x - f * 2.6, 1.75, z, C.wood, 'wood');
      // Service door at the back.
      B.box(0.06, 2.1, 1.0, x - f * 3.17, 1.05, z + 1.2, 0x6b4a30, 'wood');
      // Warm interior glow panel (lit in the evening).
      B.box(0.05, 0.5, 3.8, x - f * 2.84, 2.3, z, 0xffd59a, 'glow');
      // Awning.
      const st = stripeTexture(s.id === 'K-01' ? '#e2495b' : '#2f7fd0', '#fff8ef', 12);
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.6), new THREE.MeshStandardMaterial({ map: st, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, roughness: 0.85 }));
      awn.position.set(x + f * 3.75, 2.75, z);
      awn.rotation.set(0, f > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      awn.rotateX(-0.85);
      awn.castShadow = true;
      this.root.add(awn);
      // Rooftop icon.
      if (s.id === 'K-01') {
        const berry = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe0313f, roughness: 0.35 }));
        body.scale.set(1, 1.15, 1);
        body.geometry.translate(0, 0, 0);
        const pos = body.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const k = 1 - Math.max(0, -y) * 0.45; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
        body.geometry.computeVertexNormals();
        berry.add(body);
        for (let i = 0; i < 5; i++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0x3f9b4a, roughness: 0.6 }));
          const a = (i / 5) * Math.PI * 2;
          leaf.position.set(Math.cos(a) * 0.35, 1.05, Math.sin(a) * 0.35);
          leaf.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
          berry.add(leaf);
        }
        for (let i = 0; i < 26; i++) {
          const seed = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), new THREE.MeshStandardMaterial({ color: 0xfff1a8 }));
          const u = this.rng() * Math.PI * 2, v = 0.3 + this.rng() * 2.0;
          seed.position.set(Math.cos(u) * Math.sin(v) * 0.96, Math.cos(v) * 1.0, Math.sin(u) * Math.sin(v) * 0.96);
          berry.add(seed);
        }
        berry.position.set(x, 4.6, z);
        berry.traverse((o) => (o.castShadow = true));
        this.root.add(berry);
        this.rooftop = [berry];
      } else {
        const pretzel = new THREE.Mesh(new THREE.TorusKnotGeometry(0.62, 0.2, 96, 12, 2, 3), new THREE.MeshStandardMaterial({ color: 0xa8662e, roughness: 0.55 }));
        pretzel.scale.set(1, 1, 0.5);
        pretzel.position.set(x, 4.4, z);
        pretzel.castShadow = true;
        this.root.add(pretzel);
        this.rooftop.push(pretzel);
      }
      // Fascia sign.
      const t = textTexture([{ text: s.name.toUpperCase(), size: 64, weight: 900 }], { w: 768, h: 120, bg: s.id === 'K-01' ? '#e2495b' : '#2f7fd0', color: '#ffffff', radius: 14 });
      const tm = new THREE.MeshStandardMaterial({ map: t.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: t.texture, emissiveIntensity: 0 });
      this.signGlow.push(tm);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.7), tm);
      sg.position.set(x + f * 3.17, 2.75, z);
      sg.rotation.y = f > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.root.add(sg);
      // Tables & umbrellas nearby.
      for (const k of [0, 1]) {
        const tx = x + f * (5.8 + k * 0.4), tz = z + (k ? -6.2 : 6.0);
        if (!this.isFree(tx, tz, 0.5) && false) continue;
        B.cyl(0.55, 0.55, 0.06, 16, tx, 0.75, tz, C.white, 'paint');
        B.cyl(0.05, 0.05, 0.75, 6, tx, 0.37, tz, C.darkMetal, 'metal');
        B.cyl(0.03, 0.03, 2.2, 6, tx, 1.5, tz, C.white, 'metal');
        B.add(new THREE.ConeGeometry(1.3, 0.5, 8, 1, true), mat(tx, 2.45, tz), k ? trim : 0xf2c94c, 'paint');
        for (const ca of [0, Math.PI]) B.box(0.4, 0.45, 0.4, tx + Math.cos(ca) * 0.9, 0.22, tz + Math.sin(ca) * 0.9, C.white, 'paint');
      }
      this.pickBox(s.id, 7, 5, 5.4, x, 2.5, z);
    }
  }

  // ------------------------------------------------------------------ depot
  depot() {
    const B = this.B;
    const [x, z] = DEPOT.pos;
    // Warehouse: 13 x 9, door faces -x
    B.box(13, 5.0, 9, x + 4, 2.5, z, 0xb9c2bd, 'paint');
    for (let k = -4; k <= 4; k += 0.5) B.box(13.05, 4.9, 0.05, x + 4, 2.5, z + k, 0xa9b3ad, 'paint');
    B.add(new THREE.BoxGeometry(14, 0.3, 10), mat(x + 4, 5.25, z, 0, 0, 0.05), 0x5a6470, 'roof');
    B.box(0.1, 3.4, 4.2, x - 2.52, 1.7, z - 0.5, 0x3a3f45, 'paint'); // open door (dark interior)
    B.box(0.2, 0.4, 4.6, x - 2.5, 3.6, z - 0.5, 0xf2a423, 'paint');
    // Loading dock.
    B.box(2.2, 0.8, 5.2, x - 3.6, 0.4, z - 0.5, 0xc9c1b3, 'concrete');
    // Workshop annex.
    B.box(5, 3.2, 5, x + 4, 1.6, z + 7, 0xe9dfcc, 'paint');
    B.box(5.6, 0.25, 5.6, x + 4, 3.3, z + 7, 0x2b3a55, 'paint');
    B.box(2.0, 1.3, 0.06, x + 4, 1.8, z + 4.48, 0xffd59a, 'glow');
    // Crates & pallets.
    const crateCols = [0xc89463, 0xb5814f, 0xd4a374];
    for (let i = 0; i < 9; i++) {
      const cx = x - 4 - (i % 3) * 1.2, cz = z - 6.5 + Math.floor(i / 3) * 1.2;
      B.box(1.1, 0.14, 1.1, cx, 0.07, cz, 0x9b7b55, 'wood');
      const h = 1 + (i % 2);
      for (let k = 0; k < h; k++) B.box(0.9, 0.7, 0.9, cx, 0.5 + k * 0.72, cz, crateCols[(i + k) % 3], 'wood');
    }
    // Gas cylinders / bins.
    for (let i = 0; i < 3; i++) B.cyl(0.45, 0.45, 1.1, 12, x + 11.5, 0.55, z - 3 + i * 1.1, [0x3f8f5a, 0x2b6cb0, 0x6b6f75][i], 'paint');
    const t = textTexture([{ text: 'SERVICE DEPOT', size: 60, weight: 900 }, { text: 'STAFF ONLY', size: 34, weight: 700, color: '#ffe0a0' }], { w: 640, h: 180, bg: '#2b3a55', color: '#ffffff', radius: 16 });
    const sm = new THREE.MeshStandardMaterial({ map: t.texture, roughness: 0.5, emissive: 0xffffff, emissiveMap: t.texture, emissiveIntensity: 0 });
    this.signGlow.push(sm);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.2), sm);
    s.position.set(x - 2.58, 4.4, z - 0.5);
    s.rotation.y = -Math.PI / 2;
    this.root.add(s);
    // Yard fence.
    const fence = [[x - 12, z - 10], [x + 12, z - 10], [x + 12, z + 9], [x - 4, z + 9]];
    this.fenceLine(fence, 0x4a5560, 1.5);
    this.pickBox('DEPOT', 14, 6, 10, x + 4, 3, z);
  }

  fenceLine(pts, color, h = 1.1, spacing = 2.2) {
    const B = this.B;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = new THREE.Vector3(pts[i][0], 0, pts[i][1]), b = new THREE.Vector3(pts[i + 1][0], 0, pts[i + 1][1]);
      const len = a.distanceTo(b);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        B.cyl(0.045, 0.045, h, 6, p.x, h / 2, p.z, color, 'metal');
      }
      B.bar(a.clone().setY(h * 0.92), b.clone().setY(h * 0.92), 0.05, 0.05, color, 'metal');
      B.bar(a.clone().setY(h * 0.45), b.clone().setY(h * 0.45), 0.04, 0.04, color, 'metal');
    }
  }

  // ------------------------------------------------------------------ queue fences
  queueFences() {
    const lanes = [COASTER.queue, WHEEL.queue, CAROUSEL.queue];
    for (const lane of lanes) {
      const pts = lane.pts.map((p) => [p.x, p.z]);
      for (const off of [-0.98, 0.98]) {
        const o = offsetPath(pts, off);
        this.fenceLine(o.slice(0, -1), 0x2b3a55, 1.0, 1.6);
      }
    }
  }

  // ------------------------------------------------------------------ furniture
  furniture() {
    const B = this.B;
    // Benches.
    const bench = (x, z, yaw) => {
      const m = mat(x, 0, z, 0, yaw, 0);
      const part = (g, px, py, pz, col, kind) => B.add(g, m.clone().multiply(mat(px, py, pz)), col, kind);
      for (let k = 0; k < 3; k++) part(new THREE.BoxGeometry(1.7, 0.05, 0.13), 0, 0.46, -0.16 + k * 0.16, 0xb07a48, 'wood');
      for (let k = 0; k < 2; k++) B.add(new THREE.BoxGeometry(1.7, 0.12, 0.04), m.clone().multiply(mat(0, 0.66 + k * 0.16, -0.3, -0.2, 0, 0)), 0xb07a48, 'wood');
      for (const sx of [-0.72, 0.72]) part(new THREE.BoxGeometry(0.06, 0.46, 0.5), sx, 0.23, -0.05, 0x2b3a55, 'metal');
    };
    for (const b of BENCHES) {
      bench(b.pos[0], b.pos[1], b.yaw);
      // Bin next to the bench.
      const bx = b.pos[0] + Math.cos(b.yaw) * 1.4, bz = b.pos[1] - Math.sin(b.yaw) * 1.4;
      B.cyl(0.28, 0.25, 0.85, 12, bx, 0.42, bz, 0x2f5d3f, 'paint');
      B.cyl(0.3, 0.3, 0.06, 12, bx, 0.87, bz, 0x23452f, 'paint');
    }
    // Extra decorative benches around the fountain.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      bench(Math.cos(a) * 7.4, 16 + Math.sin(a) * 7.4, -a - Math.PI / 2);
    }
    // Lamps along public paths.
    const lamps = [];
    for (const [a, b, k] of EDGES) {
      if (k === 'service' || k === 'plaza') continue;
      if (a === 'SPAWN' || b === 'SPAWN') continue;
      const A = NODES[a], Bn = NODES[b];
      const len = Math.hypot(Bn[0] - A[0], Bn[1] - A[1]);
      const dx = (Bn[0] - A[0]) / len, dz = (Bn[1] - A[1]) / len;
      const w = k === 'main' ? 4.2 : 2.5;
      let side = 1;
      for (let d = 6; d < len - 4; d += 12) {
        const x = A[0] + dx * d - dz * w * side, z = A[1] + dz * d + dx * w * side;
        if (Math.hypot(x, z - 16) < 17) continue;
        lamps.push([x, z]);
        if (k === 'main') lamps.push([A[0] + dx * d + dz * w * side, A[1] + dz * d - dx * w * side]);
        side = -side;
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      lamps.push([Math.cos(a) * 16.6, 16 + Math.sin(a) * 16.6]);
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; lamps.push([Math.cos(a) * 10.6, 53 + Math.sin(a) * 10.6]); }
    const filtered = [];
    for (const l of lamps) if (!filtered.some((f) => Math.hypot(f[0] - l[0], f[1] - l[1]) < 4)) filtered.push(l);
    for (const [x, z] of filtered) {
      B.cyl(0.07, 0.1, 3.6, 8, x, 1.8, z, 0x2b3a55, 'metal');
      B.cyl(0.16, 0.16, 0.2, 8, x, 0.1, z, 0x2b3a55, 'metal');
      B.add(new THREE.SphereGeometry(0.26, 14, 10), mat(x, 3.85, z), 0xfff1d0, 'glow');
      B.cyl(0.3, 0.1, 0.14, 10, x, 4.12, z, 0x2b3a55, 'metal');
      this.lightPools.push([x, z, 4.6]);
      this.exclude(x, z, 0.8);
    }
    this.lampPositions = filtered;
  }

  // ------------------------------------------------------------------ perimeter
  perimeter() {
    const B = this.B;
    const { minX, maxX, minZ, maxZ } = PARK;
    const fence = (pts) => this.fenceLine(pts, 0x2f4a3c, 1.4, 2.6);
    fence([[-13.5, 64.5], [minX, 64.5], [minX, minZ], [maxX, minZ], [maxX, 64.5], [13.5, 64.5]]);
    // Hedge just inside.
    const hedge = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / 1.6);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        const s = 0.9 + this.rng() * 0.35;
        B.add(new THREE.SphereGeometry(1, 10, 7), mat(x, 0.75 * s, z, 0, this.rng() * 3, 0, 1.0 * s, 0.85 * s, 1.0 * s), [0x3f7a3f, 0x4a8a45, 0x386f3a][i % 3], 'foliage');
      }
    };
    hedge(-15, 63.2, minX + 1.5, 63.2);
    hedge(15, 63.2, maxX - 1.5, 63.2);
    hedge(minX + 1.3, 62, minX + 1.3, minZ + 1.5);
    hedge(maxX - 1.3, 62, maxX - 1.3, minZ + 1.5);
    hedge(minX + 1.5, minZ + 1.3, maxX - 1.5, minZ + 1.3);
  }

  // ------------------------------------------------------------------ landscape
  landscape() {
    const rng = this.rng;
    // Tree variants: merged geometry with vertex colours, instanced.
    const variants = [makeRoundTree(), makeConifer(), makeBlossom(), makeTallTree()];
    const lists = variants.map(() => []);
    const tryPlace = (x, z, r, inside) => {
      if (!this.isFree(x, z, r)) return false;
      if (inside && (x < PARK.minX + 3 || x > PARK.maxX - 3 || z < PARK.minZ + 3 || z > PARK.maxZ - 3)) return false;
      for (const l of lists) for (const t of l) if (Math.hypot(t[0] - x, t[1] - z) < r + t[2] * 0.9) return false;
      return true;
    };
    // Inside: clustered groves.
    const groves = [[-78, -40], [-75, 40], [-60, 50], [-35, 45], [-80, -10], [-70, -58], [-30, -62], [5, -55], [30, -55], [70, -50], [80, -20], [80, 5], [60, -10], [75, 60], [45, 55], [-45, 30], [-88, 20], [20, 5], [-5, -30], [30, -40], [-15, 55], [60, 30], [-12, -20], [-5, -45], [50, 40], [85, 45], [40, -5]];
    for (const [gx, gz] of groves) {
      const n = 6 + Math.floor(rng() * 8);
      for (let i = 0; i < n * 3 && n > 0; i++) {
        const x = gx + (rng() - 0.5) * 22, z = gz + (rng() - 0.5) * 18;
        const v = rng() < 0.5 ? 0 : rng() < 0.45 ? 1 : rng() < 0.5 ? 3 : 2;
        const s = 0.75 + rng() * 0.6;
        if (tryPlace(x, z, 2.2 * s, true)) lists[v].push([x, z, 2.2 * s, s, rng() * 6]);
      }
    }
    // Scatter.
    for (let i = 0; i < 900; i++) {
      const x = PARK.minX + rng() * (PARK.maxX - PARK.minX), z = PARK.minZ + rng() * (PARK.maxZ - PARK.minZ);
      const v = rng() < 0.55 ? 0 : rng() < 0.4 ? 2 : rng() < 0.5 ? 1 : 3;
      const s = 0.7 + rng() * 0.5;
      if (tryPlace(x, z, 3.0 * s, true)) lists[v].push([x, z, 2.2 * s, s, rng() * 6]);
    }
    // Outside ring of trees for framing.
    for (let i = 0; i < 1400; i++) {
      const x = -150 + rng() * 300, z = -120 + rng() * 230;
      if (x > PARK.minX - 3 && x < PARK.maxX + 3 && z > PARK.minZ - 3 && z < PARK.maxZ + 3) continue;
      if (z > 66 && z < 90 && Math.abs(x) < 112) continue;
      const v = rng() < 0.5 ? 1 : rng() < 0.6 ? 0 : 3;
      const s = 0.9 + rng() * 0.7;
      if (tryPlace(x, z, 1.6 * s, false)) lists[v].push([x, z, 1.6 * s, s, rng() * 6]);
    }
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    variants.forEach((geo, k) => {
      const list = lists[k];
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, this.mats.foliage, list.length);
      list.forEach(([x, z, , s, r], i) => {
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, r, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        const hsl = 0.92 + rng() * 0.16;
        col.setRGB(hsl, hsl * (0.97 + rng() * 0.06), hsl * (0.9 + rng() * 0.1));
        im.setColorAt(i, col);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.root.add(im);
    });
    this.treeCount = lists.reduce((a, l) => a + l.length, 0);
    // Deciduous trees inside the park (for evening fairy lights): [x, z, scale, variant].
    this.treeSpots = [];
    lists.forEach((l, v) => { if (v === 1) return; for (const [x, z, , s] of l) if (x > PARK.minX && x < PARK.maxX && z > PARK.minZ && z < PARK.maxZ) this.treeSpots.push([x, z, s, v]); });

    // Bushes along paths and flowers in beds.
    const B = this.B;
    for (let i = 0; i < 700; i++) {
      const x = PARK.minX + rng() * (PARK.maxX - PARK.minX), z = PARK.minZ + rng() * (PARK.maxZ - PARK.minZ);
      if (!this.isFree(x, z, 0.4)) continue;
      // Prefer near paths: require a path within 6 m.
      let near = false;
      for (const e of this.exclusions) if (e.r !== undefined && e.r <= 5 && Math.hypot(e.x - x, e.z - z) < e.r + 2.0) { near = true; break; }
      if (!near) continue;
      const s = 0.45 + rng() * 0.45;
      B.add(new THREE.IcosahedronGeometry(1, 1), mat(x, s * 0.55, z, 0, rng() * 3, 0, s * 1.2, s * 0.85, s * 1.2), [0x4f8f45, 0x5c9a4c, 0x3f7f3f, 0x6aa553][i % 4], 'foliage');
      if (rng() < 0.35) {
        for (let k = 0; k < 5; k++) B.add(new THREE.IcosahedronGeometry(0.1, 0), mat(x + (rng() - 0.5) * s * 1.6, s * (0.7 + rng() * 0.5), z + (rng() - 0.5) * s * 1.6), [0xf4a6c1, 0xffffff, 0xf7d046, 0xe0525e][i % 4], 'paint');
      }
    }
    const fcols = [0xf2a423, 0xf7d046, 0xe24d3d, 0xf4a6c1, 0xffffff, 0x9b6bd3, 0xf47c2c];
    const flowerGeo = new THREE.IcosahedronGeometry(0.11, 0);
    const stemGeo = new THREE.SphereGeometry(0.16, 6, 4);
    for (const b of flowerBeds()) {
      const n = Math.round(b.rx * b.rz * 18);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.92;
        let x = Math.cos(a) * r * b.rx, z = Math.sin(a) * r * b.rz;
        x += b.x; z += b.z;
        B.add(stemGeo, mat(x, 0.14, z, 0, 0, 0, 1, 0.9, 1), 0x4a8a45, 'foliage');
        B.add(flowerGeo, mat(x, 0.3 + rng() * 0.08, z), b.inner ? fcols[i % 3] : fcols[(i + Math.floor(b.x)) % fcols.length], 'paint');
      }
    }
  }

  // ------------------------------------------------------------------ string lights
  festoons() {
    const B = this.B;
    // Poles along the boulevard with catenary strings across.
    const poles = [];
    for (let z = 30; z <= 58; z += 7) for (const x of [-4.4, 4.4]) {
      B.cyl(0.06, 0.08, 5.2, 8, x, 2.6, z, 0x2b3a55, 'metal');
      poles.push([x, z]);
    }
    const cols = [0xffc66e, 0xff8f6e, 0xffe3a0, 0x8fd3ff, 0xffb3d1];
    for (let z = 30; z < 58; z += 7) {
      this.catenary(new THREE.Vector3(-4.4, 5.1, z), new THREE.Vector3(4.4, 5.1, z + 7), 1.0, 14, cols);
      this.catenary(new THREE.Vector3(4.4, 5.1, z), new THREE.Vector3(-4.4, 5.1, z + 7), 1.0, 14, cols);
    }
    // Around the fountain plaza.
    const ringPoles = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = Math.cos(a) * 14.6, z = 16 + Math.sin(a) * 14.6;
      ringPoles.push(new THREE.Vector3(x, 5.0, z));
    }
    for (let i = 0; i < 10; i++) {
      const p = ringPoles[i];
      B.cyl(0.06, 0.08, 5.2, 8, p.x, 2.6, p.z, 0x2b3a55, 'metal');
      this.catenary(p, new THREE.Vector3(0, 6.2, 16), 0.6, 12, cols);
    }
  }

  catenary(a, b, sag, n, cols) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(Math.PI * t) * sag;
      pts.push(p);
      if (i > 0 && i < n) this.bulbs.push({ p, c: cols[i % cols.length] });
    }
    for (let i = 0; i < n; i++) this.B.bar(pts[i], pts[i + 1], 0.015, 0.015, 0x333333, 'paint');
  }

  bulbsAlong(seg, n, color) {
    const a = new THREE.Vector3(...seg[0]), b = new THREE.Vector3(...seg[1]);
    for (let i = 0; i <= n; i++) this.bulbs.push({ p: a.clone().lerp(b, i / n), c: color });
  }

  buildBulbs() {
    const geo = new THREE.SphereGeometry(0.075, 6, 4);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const im = new THREE.InstancedMesh(geo, m, this.bulbs.length);
    const d = new THREE.Object3D();
    this.bulbColors = [];
    this.bulbs.forEach((b, i) => {
      d.position.copy(b.p);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      im.setColorAt(i, new THREE.Color(b.c));
      this.bulbColors.push(new THREE.Color(b.c));
    });
    this.bulbMesh = im;
    this.root.add(im);
  }

  buildLightPools() {
    const tex = radialTexture('rgba(255,214,150,1)');
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0xffd7a0 });
    const im = new THREE.InstancedMesh(geo, m, this.lightPools.length);
    const d = new THREE.Object3D();
    this.lightPools.forEach(([x, z, r], i) => {
      d.position.set(x, 0.04, z);
      d.scale.set(r * 2.2, 1, r * 2.2);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.renderOrder = 2;
    this.poolMesh = im;
    this.root.add(im);
  }

  // Evening factor 0..1.
  setEvening(k) {
    this.mats.glow.emissiveIntensity = 0.05 + k * 2.6;
    for (const m of this.signGlow) m.emissiveIntensity = 0.0 + k * 0.55;
    if (this.poolMesh) this.poolMesh.material.opacity = k * 0.55;
    if (this.bulbMesh) {
      const c = new THREE.Color();
      this.bulbColors.forEach((bc, i) => {
        c.copy(bc).multiplyScalar(0.55 + k * 2.6);
        if (k < 0.05) c.set(0xf3efe6).multiplyScalar(0.85);
        this.bulbMesh.setColorAt(i, c);
      });
      this.bulbMesh.instanceColor.needsUpdate = true;
    }
  }

  updateSigns(sim) {
    for (const id in this.signs) {
      const r = sim.get(id);
      const sg = this.signs[id];
      const key = r.statusKey();
      const text = key === 'maintenance' || key === 'stopping' ? ['MAINTENANCE', '#f2b13a'] : !r.open ? ['CLOSED', '#e5675a'] : [Math.max(1, Math.round(r.postedWait() / 60)) + ' MIN', '#ffffff'];
      const sig = text.join();
      if (sg.last === sig) continue;
      sg.last = sig;
      const g = sg.canvas.getContext('2d');
      g.fillStyle = '#1f2a44';
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#f2c264';
      g.font = '700 22px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(key === 'operating' || key === 'maintPending' ? 'WAIT TIME' : 'STATUS', 128, 34);
      g.fillStyle = text[1];
      g.font = `900 ${text[0].length > 7 ? 30 : 52}px "Segoe UI", Arial, sans-serif`;
      g.fillText(text[0], 128, 92);
      sg.tex.needsUpdate = true;
    }
  }

  update(time) {
    if (this.water) this.water.material.normalMap.offset.set(time * 0.01, time * 0.006);
    if (this.fountainWater) this.fountainWater.material.normalMap.offset.set(-time * 0.03, time * 0.02);
    if (this.flags) this.flags.forEach((f, i) => { f.rotation.y = Math.sin(time * 1.3 + i) * 0.25; });
    if (this.gateFlower) this.gateFlower.rotation.z = time * 0.15;
    if (this.boat) { this.boat.position.x = 13 + Math.cos(time * 0.05) * 6; this.boat.position.z = -36 + Math.sin(time * 0.05) * 3.5; this.boat.rotation.y = -time * 0.05 + Math.PI; }
  }
}

// --------------------------------------------------------------------- trees
function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function mergeColored(parts) {
  return mergeG(parts.map(([geo, m, c]) => { const g = colored(geo, c); g.applyMatrix4(m); return g; }));
}

import { mergeGeometries as mergeG } from 'three/addons/utils/BufferGeometryUtils.js';

function makeRoundTree() {
  return mergeColored([
    [new THREE.CylinderGeometry(0.16, 0.24, 2.4, 7), mat(0, 1.2, 0), 0x7a5a3c],
    [new THREE.IcosahedronGeometry(1.7, 1), mat(0, 3.4, 0, 0, 0, 0, 1, 0.9, 1), 0x5a9a48],
    [new THREE.IcosahedronGeometry(1.2, 1), mat(0.9, 3.0, 0.4), 0x66a852],
    [new THREE.IcosahedronGeometry(1.1, 1), mat(-0.7, 3.9, -0.5), 0x4f8e40],
  ]);
}
function makeConifer() {
  return mergeColored([
    [new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6), mat(0, 0.8, 0), 0x6b4a30],
    [new THREE.ConeGeometry(1.5, 2.6, 8), mat(0, 2.3, 0), 0x2f6b44],
    [new THREE.ConeGeometry(1.15, 2.2, 8), mat(0, 3.5, 0), 0x357a4b],
    [new THREE.ConeGeometry(0.75, 1.8, 8), mat(0, 4.6, 0), 0x3b8452],
  ]);
}
function makeBlossom() {
  return mergeColored([
    [new THREE.CylinderGeometry(0.12, 0.18, 1.8, 6), mat(0, 0.9, 0), 0x6e4e3a],
    [new THREE.IcosahedronGeometry(1.25, 1), mat(0, 2.5, 0, 0, 0, 0, 1.2, 0.8, 1.2), 0xf1a7c0],
    [new THREE.IcosahedronGeometry(0.8, 1), mat(0.7, 2.9, 0.3), 0xf6bfd2],
  ]);
}
function makeTallTree() {
  return mergeColored([
    [new THREE.CylinderGeometry(0.18, 0.28, 3.6, 7), mat(0, 1.8, 0), 0x7a5a3c],
    [new THREE.IcosahedronGeometry(1.5, 1), mat(0, 4.4, 0, 0, 0, 0, 0.9, 1.5, 0.9), 0x6a9f3c],
    [new THREE.IcosahedronGeometry(1.0, 1), mat(0.5, 5.8, 0.2), 0x77ac46],
  ]);
}
