import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './build.js';
import { stripeTexture } from './textures.js';
import { WHEEL, CAROUSEL, SHOPS } from '../sim/layout.js';

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
function merge(parts) {
  return mergeGeometries(parts.map(([geo, m, c]) => { const g = colored(geo, c); if (m) g.applyMatrix4(m); return g; }));
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion();

export class RideViews {
  constructor(sceneMgr, sim, park) {
    this.sm = sceneMgr;
    this.sim = sim;
    this.park = park;
    this.root = new THREE.Group();
    sceneMgr.scene.add(this.root);
    this.pickables = [];
    this.vehicleMeshes = {}; // id -> object for outline
    this.gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2 });
    this.paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0xbfe2f0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false });
    this.buildTrain();
    this.buildWheel();
    this.buildCarousel();
    this.buildCart();
    this.buildShopStock();
    this.buildLitter();
    this.buildFountainJets();
    this.buildBarriers();
  }

  // Cones and a barrier across a queue entrance while a ride is not admitting.
  buildBarriers() {
    this.barriers = {};
    const coneGeo = merge([
      [new THREE.ConeGeometry(0.2, 0.6, 12), mat(0, 0.34, 0), 0xf07f22],
      [new THREE.CylinderGeometry(0.135, 0.165, 0.1, 12), mat(0, 0.34, 0), 0xffffff],
      [new THREE.BoxGeometry(0.46, 0.05, 0.46), mat(0, 0.025, 0), 0x2b2b2b],
    ]);
    for (const r of this.sim.rides) {
      const lane = r.def.queue;
      const a = lane.at(lane.length - 1.4), b = lane.at(lane.length - 0.4);
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const g = new THREE.Group();
      for (const k of [-0.75, 0, 0.75]) {
        const c = new THREE.Mesh(coneGeo, this.paint);
        c.position.set(a.x + nx * k, 0, a.z + nz * k);
        c.castShadow = true;
        g.add(c);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.05), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.5 }));
      bar.position.set(a.x - (dx / l) * 0.5, 0.75, a.z - (dz / l) * 0.5);
      bar.rotation.y = Math.atan2(-nz, nx);
      g.add(bar);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.04, 0.06), new THREE.MeshStandardMaterial({ color: 0xd4492f }));
      stripe.position.copy(bar.position);
      stripe.rotation.copy(bar.rotation);
      g.add(stripe);
      for (const k of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), bar.material);
        leg.position.set(bar.position.x + nx * k, 0.37, bar.position.z + nz * k);
        g.add(leg);
      }
      g.visible = false;
      this.root.add(g);
      this.barriers[r.id] = g;
    }
  }

  addPick(obj, id) {
    obj.traverse((o) => { if (o.isMesh) { o.userData.pick = id; this.pickables.push(o); } });
    this.vehicleMeshes[id] = obj;
  }

  // ------------------------------------------------------------- coaster train
  buildTrain() {
    const shape = new THREE.Shape();
    shape.moveTo(-1.02, 0.2);
    shape.lineTo(0.98, 0.2);
    shape.quadraticCurveTo(1.12, 0.2, 1.1, 0.42);
    shape.lineTo(1.04, 0.66);
    shape.lineTo(-0.98, 0.66);
    shape.quadraticCurveTo(-1.08, 0.66, -1.06, 0.42);
    shape.closePath();
    const body = new THREE.ExtrudeGeometry(shape, { depth: 1.05, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 8 });
    body.translate(0, 0, -0.525);
    body.rotateY(Math.PI / 2); // extrusion along x, profile in z/y
    const parts = (front, color) => {
      const list = [
        [body, null, color],
        [new THREE.BoxGeometry(1.16, 0.06, 2.0), mat(0, 0.5, 0), 0xffffff],
        [new THREE.BoxGeometry(0.95, 0.12, 2.05), mat(0, 0.1, 0), 0x30343b],
        // headrests / seat backs
        [new THREE.BoxGeometry(1.0, 0.5, 0.14), mat(0, 0.86, 0.12), 0x1f2a44],
        [new THREE.BoxGeometry(1.0, 0.5, 0.14), mat(0, 0.86, -0.86), 0x1f2a44],
        // lap bars
        [new THREE.BoxGeometry(0.9, 0.05, 0.05), mat(0, 0.78, 0.82), 0xc9ced6],
        [new THREE.BoxGeometry(0.9, 0.05, 0.05), mat(0, 0.78, -0.12), 0xc9ced6],
      ];
      for (const sx of [-0.42, 0.42]) for (const sz of [-0.72, 0.72]) {
        list.push([new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), mat(sx, 0.19, sz, 0, 0, Math.PI / 2), 0x22252a]);
        list.push([new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10), mat(sx, -0.17, sz, 0, 0, Math.PI / 2), 0x22252a]);
        list.push([new THREE.BoxGeometry(0.05, 0.42, 0.3), mat(sx * 1.22, 0.02, sz), 0x7d838c]);
      }
      if (front) {
        list.push([new THREE.SphereGeometry(0.55, 16, 10), mat(0, 0.42, 1.08, 0, 0, 0, 1.05, 0.42, 0.75), color]);
        list.push([new THREE.SphereGeometry(0.06, 8, 6), mat(0.3, 0.3, 1.47), 0xfff4c0]);
        list.push([new THREE.SphereGeometry(0.06, 8, 6), mat(-0.3, 0.3, 1.47), 0xfff4c0]);
      }
      return merge(list);
    };
    const colors = [0xf2a423, 0xd83a2c, 0xf2a423, 0xd83a2c, 0xf2a423];
    this.cars = [];
    const coaster = this.sim.rides[0];
    for (let i = 0; i < 5; i++) {
      const g = parts(i === 0, colors[i]);
      const m = new THREE.Mesh(g, this.gloss);
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m);
      this.addPick(m, coaster.vehicles[i].id);
      this.cars.push(m);
    }
  }

  // ------------------------------------------------------------- ferris wheel
  buildWheel() {
    const ride = this.sim.rides[1];
    const t = new THREE.Vector3(Math.cos(WHEEL.yaw), 0, Math.sin(WHEEL.yaw));
    const a = new THREE.Vector3(-Math.sin(WHEEL.yaw), 0, Math.cos(WHEEL.yaw));
    const frame = new THREE.Group();
    frame.position.set(...WHEEL.hub);
    frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t, new THREE.Vector3(0, 1, 0), a));
    this.root.add(frame);
    const rot = new THREE.Group();
    frame.add(rot);
    this.wheelRot = rot;
    this.wheelFrame = frame;
    const R = WHEEL.radius;
    const list = [];
    const white = 0xf6f3ec, blue = 0x3b8fd9;
    for (const z of [-1.15, 1.15]) {
      list.push([new THREE.TorusGeometry(R, 0.14, 8, 120), mat(0, 0, z), white]);
      list.push([new THREE.TorusGeometry(R * 0.62, 0.09, 6, 90), mat(0, 0, z), blue]);
      list.push([new THREE.CylinderGeometry(1.2, 1.2, 0.3, 24), mat(0, 0, z, Math.PI / 2, 0, 0), 0x2b3a55]);
      const spokes = 24;
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2;
        const p0 = new THREE.Vector3(Math.cos(ang) * 1.1, Math.sin(ang) * 1.1, z * 0.7);
        const p1 = new THREE.Vector3(Math.cos(ang + 0.13) * R, Math.sin(ang + 0.13) * R, z);
        const d = new THREE.Vector3().subVectors(p1, p0);
        const len = d.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        list.push([new THREE.CylinderGeometry(0.035, 0.035, len, 5), new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), white]);
      }
    }
    for (let i = 0; i < ride.n; i++) {
      const ang = (i / ride.n) * Math.PI * 2;
      const p = [Math.cos(ang) * R, Math.sin(ang) * R];
      list.push([new THREE.CylinderGeometry(0.09, 0.09, 2.5, 8), mat(p[0], p[1], 0, Math.PI / 2, 0, 0), 0x8d939a]);
      // Truss between the rims.
      const ang2 = ((i + 0.5) / ride.n) * Math.PI * 2;
      list.push([new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), mat(Math.cos(ang2) * R, Math.sin(ang2) * R, 0, Math.PI / 2, 0, 0), white]);
    }
    const g = mergeGeometries(list.map(([geo, m, c]) => { const gg = colored(geo, c); gg.applyMatrix4(m); return gg; }));
    const mesh = new THREE.Mesh(g, this.gloss);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rot.add(mesh);
    mesh.userData.pick = ride.id;
    this.pickables.push(mesh);
    // Bulbs on rims and spokes.
    const bulbs = [];
    for (const z of [-1.3, 1.3]) {
      for (let i = 0; i < 96; i++) { const ang = (i / 96) * Math.PI * 2; bulbs.push(new THREE.Vector3(Math.cos(ang) * (R + 0.12), Math.sin(ang) * (R + 0.12), z)); }
      for (let s = 0; s < 12; s++) {
        const ang = (s / 12) * Math.PI * 2 + 0.13;
        for (let k = 2; k < 13; k += 1.5) bulbs.push(new THREE.Vector3(Math.cos(ang) * k, Math.sin(ang) * k, z * 0.95));
      }
    }
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length);
    const d = new THREE.Object3D();
    bulbs.forEach((p, i) => { d.position.copy(p); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); bm.setColorAt(i, new THREE.Color(0xffffff)); });
    rot.add(bm);
    this.wheelBulbs = { mesh: bm, pts: bulbs };
    // Cabins.
    const cabColors = [0xe85d4a, 0xf2a423, 0x2a9d8f, 0x4a90d9, 0x9b6bd3, 0xf06ba8];
    this.cabins = [];
    for (let i = 0; i < ride.n; i++) {
      const c = cabColors[i % cabColors.length];
      const geo = merge([
        [new THREE.CylinderGeometry(0.95, 0.85, 0.18, 16), mat(0, -0.95, 0), 0xf1ece2],
        [new THREE.CylinderGeometry(0.97, 0.95, 0.75, 16, 1, true), mat(0, -0.5, 0), c],
        [new THREE.TorusGeometry(0.97, 0.045, 6, 24), mat(0, -0.12, 0, Math.PI / 2, 0, 0), 0xffffff],
        [new THREE.SphereGeometry(1.0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0.62, 0, 0, 0, 0, 1, 0.45, 1), c],
        [new THREE.CylinderGeometry(0.06, 0.06, 1.25, 6), mat(0, 1.3, 0), 0x8d939a],
        [new THREE.BoxGeometry(0.4, 0.2, 0.4), mat(0, 1.0, 0), 0x2b3a55],
        [new THREE.BoxGeometry(0.7, 0.12, 0.34), mat(0, -0.58, 0.58), 0x2b3a55],
        [new THREE.BoxGeometry(0.7, 0.12, 0.34), mat(0, -0.58, -0.58), 0x2b3a55],
        [new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), mat(0.68, 0.25, 0.68), 0xffffff],
        [new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), mat(-0.68, 0.25, -0.68), 0xffffff],
        [new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), mat(0.68, 0.25, -0.68), 0xffffff],
        [new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), mat(-0.68, 0.25, 0.68), 0xffffff],
      ]);
      const cab = new THREE.Group();
      const mesh = new THREE.Mesh(geo, this.gloss);
      mesh.castShadow = true;
      cab.add(mesh);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 0.62, 16, 1, true), this.glass);
      glass.position.y = 0.22;
      cab.add(glass);
      cab.rotation.y = Math.atan2(t.x, t.z);
      this.root.add(cab);
      this.addPick(cab, ride.vehicles[i].id);
      this.cabins.push(cab);
    }
  }

  // ------------------------------------------------------------- carousel
  buildCarousel() {
    const ride = this.sim.rides[2];
    const [cx, cz] = CAROUSEL.center;
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    this.root.add(g);
    this.carGroup = g;
    const deck = merge([
      [new THREE.CylinderGeometry(7.45, 7.45, 0.25, 64), mat(0, 0.44, 0), 0xb98a5a],
      [new THREE.CylinderGeometry(7.5, 7.5, 0.06, 64), mat(0, 0.58, 0), 0xd9a066],
      [new THREE.CylinderGeometry(1.7, 1.7, 4.5, 24), mat(0, 2.8, 0), 0xf6e3c0],
      [new THREE.CylinderGeometry(1.78, 1.78, 0.3, 24), mat(0, 1.0, 0), 0xb33b3b],
      [new THREE.CylinderGeometry(1.78, 1.78, 0.3, 24), mat(0, 4.9, 0), 0xb33b3b],
      [new THREE.CylinderGeometry(8.1, 8.1, 0.25, 64), mat(0, 5.15, 0), 0xf6e3c0],
      [new THREE.SphereGeometry(0.4, 12, 8), mat(0, 8.6, 0), 0xd8a640],
      [new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), mat(0, 9.2, 0), 0xd8a640],
    ]);
    const dm = new THREE.Mesh(deck, this.gloss);
    dm.castShadow = true; dm.receiveShadow = true;
    g.add(dm);
    // Mirror panels on the drum.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 2.4), new THREE.MeshStandardMaterial({ color: 0xdfe7ef, metalness: 1, roughness: 0.08 }));
      p.position.set(Math.cos(a) * 1.72, 2.9, Math.sin(a) * 1.72);
      p.rotation.y = -a + Math.PI / 2;
      g.add(p);
    }
    // Canopy.
    const stripes = stripeTexture('#c23b3b', '#fff3dc', 24, false);
    stripes.repeat.set(1, 1);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(8.4, 3.2, 48, 1, true), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8, side: THREE.DoubleSide }));
    canopy.position.y = 6.9;
    canopy.castShadow = true;
    g.add(canopy);
    const val = stripeTexture('#c23b3b', '#f7d48a', 48, true);
    const valance = new THREE.Mesh(new THREE.CylinderGeometry(8.42, 8.42, 0.8, 64, 1, true), new THREE.MeshStandardMaterial({ map: val, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
    valance.position.y = 4.95;
    valance.castShadow = true;
    g.add(valance);
    // Poles and horses.
    const horseCols = [0xf7f3ea, 0xe9d8b9, 0x9a9aa0, 0x3a2e28, 0xb66a3a, 0xf7f3ea, 0xd9c3a0, 0x6d5545];
    const saddleCols = [0xc23b3b, 0x2f6fb4, 0x2a9d8f, 0xd8a640, 0x9b6bd3];
    this.horses = [];
    for (const m of ride.vehicles) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 4.5, 8), new THREE.MeshStandardMaterial({ color: 0xe0b54f, metalness: 0.9, roughness: 0.25 }));
      pole.position.set(Math.cos(m.base) * m.radius, 2.8, Math.sin(m.base) * m.radius);
      g.add(pole);
      const horse = makeHorse(horseCols[m.index % horseCols.length], saddleCols[m.index % saddleCols.length]);
      const hg = new THREE.Group();
      hg.add(horse);
      hg.position.set(Math.cos(m.base) * m.radius, 1.4, Math.sin(m.base) * m.radius);
      hg.rotation.y = Math.atan2(Math.sin(m.base), -Math.cos(m.base));
      g.add(hg);
      this.addPick(hg, m.id);
      this.horses.push({ group: hg, mount: m });
    }
    // Bulbs on the valance.
    const bulbs = [];
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; bulbs.push(new THREE.Vector3(Math.cos(a) * 8.5, 5.38, Math.sin(a) * 8.5)); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; for (let k = 1; k < 5; k++) bulbs.push(new THREE.Vector3(Math.cos(a) * 8.3 * (1 - k * 0.2), 5.45 + k * 0.62, Math.sin(a) * 8.3 * (1 - k * 0.2))); }
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length);
    const d = new THREE.Object3D();
    bulbs.forEach((p, i) => { d.position.copy(p); d.updateMatrix(); bm.setMatrixAt(i, d.matrix); bm.setColorAt(i, new THREE.Color(0xffffff)); });
    g.add(bm);
    this.carBulbs = bm;
    dm.userData.pick = ride.id;
    canopy.userData.pick = ride.id;
    this.pickables.push(dm, canopy);
  }

  // ------------------------------------------------------------- delivery cart
  buildCart() {
    const geo = merge([
      [new THREE.BoxGeometry(1.3, 0.35, 2.9), mat(0, 0.5, 0), 0x2f7d6d],
      [new THREE.BoxGeometry(1.26, 0.5, 1.0), mat(0, 0.9, 0.85), 0x2f7d6d],
      [new THREE.BoxGeometry(1.2, 0.3, 0.5), mat(0, 0.86, 0.75), 0x1f2a44],
      [new THREE.BoxGeometry(1.4, 0.07, 1.25), mat(0, 2.05, 0.75), 0xf6f3ec],
      [new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), mat(0.62, 1.5, 0.2), 0xd9d9d9],
      [new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), mat(-0.62, 1.5, 0.2), 0xd9d9d9],
      [new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), mat(0.62, 1.5, 1.32), 0xd9d9d9],
      [new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), mat(-0.62, 1.5, 1.32), 0xd9d9d9],
      [new THREE.BoxGeometry(1.32, 0.3, 0.06), mat(0, 0.82, -1.45), 0x2f7d6d],
      [new THREE.BoxGeometry(0.06, 0.3, 1.6), mat(0.64, 0.82, -0.65), 0x2f7d6d],
      [new THREE.BoxGeometry(0.06, 0.3, 1.6), mat(-0.64, 0.82, -0.65), 0x2f7d6d],
      [new THREE.SphereGeometry(0.08, 6, 4), mat(0.45, 0.55, 1.46), 0xfff4c0],
      [new THREE.SphereGeometry(0.08, 6, 4), mat(-0.45, 0.55, 1.46), 0xfff4c0],
      ...[[-0.62, 0.95], [0.62, 0.95], [-0.62, -0.95], [0.62, -0.95]].map(([x, z]) => [new THREE.CylinderGeometry(0.27, 0.27, 0.2, 12), mat(x, 0.27, z, 0, 0, Math.PI / 2), 0x1d1f22]),
    ]);
    const cart = new THREE.Group();
    const m = new THREE.Mesh(geo, this.gloss);
    m.castShadow = true;
    cart.add(m);
    // Crates (shown when carrying a shipment).
    this.crates = [];
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.52), new THREE.MeshStandardMaterial({ color: [0xc89463, 0xd4a374, 0xb5814f, 0xc89463][i], roughness: 0.8 }));
      c.position.set(i % 2 ? 0.29 : -0.29, 0.9, -0.35 - Math.floor(i / 2) * 0.58);
      c.castShadow = true;
      cart.add(c);
      this.crates.push(c);
    }
    this.root.add(cart);
    this.cart = cart;
    this.addPick(cart, 'V-01');
  }

  // ------------------------------------------------------------- shop shelves
  buildShopStock() {
    this.shopStock = [];
    const itemGeo = {
      icecream: new THREE.ConeGeometry(0.07, 0.2, 8), lemonade: new THREE.CylinderGeometry(0.06, 0.05, 0.2, 8), shake: new THREE.CylinderGeometry(0.07, 0.05, 0.24, 8),
      pretzel: new THREE.TorusGeometry(0.08, 0.03, 6, 12), popcorn: new THREE.BoxGeometry(0.12, 0.2, 0.12), cola: new THREE.CylinderGeometry(0.055, 0.055, 0.2, 8),
    };
    const itemCol = { icecream: 0xf6a7b8, lemonade: 0xf9c6d0, shake: 0xe2495b, pretzel: 0xa8662e, popcorn: 0xf3e2a0, cola: 0xc23b3b };
    for (const def of SHOPS) {
      const shop = this.sim.get(def.id);
      const [x, z] = def.center;
      const f = def.facing;
      const rows = [];
      def.products.forEach((p, pi) => {
        const im = new THREE.InstancedMesh(itemGeo[p.id], new THREE.MeshStandardMaterial({ color: itemCol[p.id], roughness: 0.5 }), 12);
        const d = new THREE.Object3D();
        for (let k = 0; k < 12; k++) {
          const shelf = k < 6 ? 0 : 1;
          const zz = z - 1.75 + pi * 1.28 + (k % 6) * 0.2;
          d.position.set(x - f * 2.6, 1.33 + shelf * 0.55, zz);
          d.rotation.set(p.id === 'pretzel' ? Math.PI / 2 : 0, 0, 0);
          d.updateMatrix();
          im.setMatrixAt(k, d.matrix);
        }
        im.count = 12;
        this.root.add(im);
        rows.push({ im, product: p.id });
      });
      this.shopStock.push({ shopId: def.id, rows });
    }
  }

  buildLitter() {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.03, 0.11), new THREE.MeshStandardMaterial({ roughness: 0.7 }), 80);
    im.count = 0;
    im.receiveShadow = true;
    this.root.add(im);
    this.litter = im;
    this.litterCols = [new THREE.Color(0xffffff), new THREE.Color(0xe2495b), new THREE.Color(0xf2c94c), new THREE.Color(0x4a90d9)];
  }

  buildFountainJets() {
    const n = 140;
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 5, 3), new THREE.MeshStandardMaterial({ color: 0xdff4ff, roughness: 0.1, transparent: true, opacity: 0.75, emissive: 0x000000 }), n);
    this.root.add(im);
    this.jets = { im, n, seeds: Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2 * 7, o: (i * 0.618) % 1 })) };
  }

  // ------------------------------------------------------------- per frame
  update(time, eve) {
    const sim = this.sim;
    const coaster = sim.rides[0];
    for (let i = 0; i < 5; i++) {
      coaster.carPose(i, _p, _q);
      this.cars[i].position.copy(_p);
      this.cars[i].quaternion.copy(_q);
    }
    const wheel = sim.rides[1];
    this.wheelRot.rotation.z = wheel.angle - -Math.PI / 2 - Math.PI / 2;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < wheel.n; i++) {
      wheel.cabinPos(i, tmp);
      const cab = this.cabins[i];
      cab.position.copy(tmp);
      // Gentle swing when the wheel moves.
      cab.rotation.z = Math.sin(time * 1.3 + i) * 0.02;
    }
    const car = sim.rides[2];
    this.carGroup.rotation.y = -car.angle;
    for (const h of this.horses) {
      h.group.position.y = 0.55 + 1.05 + 0.28 * Math.sin(car.angle * 3 + h.mount.phase) - 0.2;
    }
    // Bulbs: chase pattern in the evening.
    if (eve > 0.02) {
      const c = new THREE.Color();
      const wb = this.wheelBulbs;
      for (let i = 0; i < wb.pts.length; i++) {
        const hue = ((i / 96) + time * 0.08) % 1;
        c.setHSL(hue, 0.85, 0.6).multiplyScalar(0.6 + eve * 2.2);
        wb.mesh.setColorAt(i, c);
      }
      wb.mesh.instanceColor.needsUpdate = true;
      for (let i = 0; i < this.carBulbs.count; i++) {
        const on = (Math.floor(time * 3) + i) % 3 !== 0;
        c.set(0xffd27a).multiplyScalar(on ? 0.6 + eve * 2.4 : 0.5);
        this.carBulbs.setColorAt(i, c);
      }
      this.carBulbs.instanceColor.needsUpdate = true;
      this.bulbsLit = true;
    } else if (this.bulbsLit !== false) {
      const c = new THREE.Color(0xf3efe6).multiplyScalar(0.85);
      for (let i = 0; i < this.wheelBulbs.pts.length; i++) this.wheelBulbs.mesh.setColorAt(i, c);
      this.wheelBulbs.mesh.instanceColor.needsUpdate = true;
      for (let i = 0; i < this.carBulbs.count; i++) this.carBulbs.setColorAt(i, c);
      this.carBulbs.instanceColor.needsUpdate = true;
      this.bulbsLit = false;
    }
    for (const r of sim.rides) this.barriers[r.id].visible = !r.admitting;
    // Cart.
    const cart = sim.cart;
    this.cart.position.set(cart.x, 0, cart.z);
    // Smooth heading.
    let dy = cart.yaw - this.cart.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.cart.rotation.y += dy * 0.25;
    const d = cart.cargo ? sim.get(cart.cargo) : null;
    const nCrates = d ? Math.min(4, Math.max(1, Math.ceil(d.items.reduce((a, it) => a + it.qty, 0) / 14))) : 0;
    const showCrates = d && (d.status === 'in transit' || d.status === 'unloading' || d.status === 'loading');
    const loadK = d && d.status === 'loading' ? sim.get(d.jobId).progress / 0.2 : d && d.status === 'unloading' ? 1 - (sim.get(d.jobId).progress - 0.75) / 0.25 : 1;
    this.crates.forEach((c, i) => { c.visible = !!showCrates && i < Math.ceil(nCrates * Math.min(1, loadK + 0.01)); });
    // Shop stock.
    for (const s of this.shopStock) {
      s.rows.forEach((r) => {
        const p = sim.get(s.shopId).products.find((x) => x.id === r.product);
        r.im.count = Math.ceil((p.stock / p.max) * 12);
      });
    }
    // Litter.
    let k = 0;
    const dd = new THREE.Object3D();
    for (const spot of sim.litter) {
      for (const it of spot.items) {
        if (k >= 80) break;
        dd.position.set(it.x, 0.03, it.z);
        dd.rotation.set(0, it.rot, 0);
        dd.updateMatrix();
        this.litter.setMatrixAt(k, dd.matrix);
        this.litter.setColorAt(k, this.litterCols[it.c]);
        k++;
      }
    }
    this.litter.count = k;
    this.litter.instanceMatrix.needsUpdate = true;
    if (this.litter.instanceColor) this.litter.instanceColor.needsUpdate = true;
    // Fountain droplets.
    const J = this.jets;
    for (let i = 0; i < J.n; i++) {
      const s = J.seeds[i];
      const ph = (time * 0.6 + s.o) % 1;
      const top = i % 2 === 0;
      const r0 = top ? 0.1 : 1.7, vr = top ? 1.6 : 1.9, h0 = top ? 4.7 : 2.5, vy = top ? 1.6 : 0.9;
      const a = s.a;
      const r = r0 + vr * ph;
      const y = h0 + vy * ph * 2.2 - 4.9 * ph * ph * (top ? 1.6 : 1.4);
      dd.position.set(Math.cos(a) * r, Math.max(0.55, y), 16 + Math.sin(a) * r);
      dd.rotation.set(0, 0, 0);
      dd.scale.setScalar(y < 0.6 ? 0.01 : 1);
      dd.updateMatrix();
      J.im.setMatrixAt(i, dd.matrix);
    }
    J.im.instanceMatrix.needsUpdate = true;
  }
}

function makeHorse(color, saddle) {
  const parts = [
    [new THREE.CapsuleGeometry(0.2, 0.62, 4, 10), mat(0, 0, 0, Math.PI / 2, 0, 0), color],
    [new THREE.BoxGeometry(0.16, 0.5, 0.2), mat(0, 0.28, 0.42, -0.6, 0, 0), color],
    [new THREE.BoxGeometry(0.17, 0.18, 0.4), mat(0, 0.52, 0.6, -0.25, 0, 0), color],
    [new THREE.BoxGeometry(0.06, 0.4, 0.3), mat(0, 0.35, 0.33, -0.6, 0, 0), 0x3a2b20],
    [new THREE.BoxGeometry(0.32, 0.08, 0.36), mat(0, 0.2, -0.05), saddle],
    [new THREE.BoxGeometry(0.34, 0.12, 0.12), mat(0, 0.24, -0.25), 0xd8a640],
    [new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6), mat(0.1, -0.33, 0.3, 0.7, 0, 0), color],
    [new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6), mat(-0.1, -0.33, 0.3, 0.9, 0, 0), color],
    [new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6), mat(0.1, -0.33, -0.32, -0.7, 0, 0), color],
    [new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6), mat(-0.1, -0.33, -0.32, -0.5, 0, 0), color],
    [new THREE.CylinderGeometry(0.03, 0.06, 0.4, 6), mat(0, 0.0, -0.58, -0.9, 0, 0), 0x3a2b20],
  ];
  const g = merge(parts);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }));
  m.castShadow = true;
  return m;
}
