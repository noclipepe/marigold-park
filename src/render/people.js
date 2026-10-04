import * as THREE from 'three';

// Instanced people. Every person is built from a handful of instanced parts;
// poses are produced by composing per-part matrices each frame.
const MAX = 260;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _base = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function part(geo, mat) {
  const im = new THREE.InstancedMesh(geo, mat, MAX);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false;
  im.count = 0;
  im.setColorAt(0, new THREE.Color(1, 1, 1));
  return im;
}

export class PeopleRenderer {
  constructor(scene) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    // Geometry with origins at joints.
    const torso = new THREE.CapsuleGeometry(0.17, 0.32, 4, 10); torso.scale(1, 1, 0.72); torso.translate(0, 0.33, 0);
    const leg = new THREE.CapsuleGeometry(0.075, 0.62, 3, 8); leg.translate(0, -0.38, 0);
    const arm = new THREE.CapsuleGeometry(0.055, 0.42, 3, 8); arm.translate(0, -0.26, 0);
    const head = new THREE.SphereGeometry(0.13, 14, 10);
    const hair = new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); hair.translate(0, 0.012, -0.008);
    const hat = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 14); hat.translate(0, 0.1, 0);
    const brim = new THREE.BoxGeometry(0.2, 0.02, 0.14); brim.translate(0, 0.075, 0.15);
    const item = new THREE.ConeGeometry(0.06, 0.18, 8); item.rotateX(Math.PI);
    this.parts = {
      torso: part(torso, mat), legL: part(leg, mat), legR: part(leg, mat), armL: part(arm, mat), armR: part(arm, mat),
      head: part(head, mat), hair: part(hair, mat), hat: part(hat, mat), brim: part(brim, mat), item: part(item, new THREE.MeshStandardMaterial({ roughness: 0.5 })),
    };
    // Mood markers (Guests view overlay).
    const mm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), MAX);
    mm.count = 0;
    mm.frustumCulled = false;
    mm.setColorAt(0, new THREE.Color(1, 1, 1));
    this.moodMarkers = mm;
    this.group = new THREE.Group();
    for (const k in this.parts) this.group.add(this.parts[k]);
    this.group.add(mm);
    scene.add(this.group);
    this.index = []; // instance -> entity id
    this.positions = []; // for screen picking
    this.showMood = false;
  }

  update(sim, time, camera) {
    const markerScale = camera ? Math.max(1, Math.min(5, camera.position.length() / 45)) : 1;
    const P = this.parts;
    let n = 0, nh = 0, ni = 0, nm = 0;
    this.index.length = 0;
    this.positions.length = 0;
    const list = sim.visitors.concat(sim.staff);
    for (const e of list) {
      if (n >= MAX) break;
      const isStaff = e.kind === 'staff';
      const scale = isStaff ? 1.0 : e.scale;
      const pose = e.pose;
      // Base transform.
      if (pose === 'ride') {
        _p.set(e.x, e.y, e.z);
        _q.copy(e.quat);
      } else {
        _p.set(e.x, e.y, e.z);
        _q.setFromAxisAngle(UP, e.yaw);
      }
      _base.compose(_p, _q, _s.set(scale, scale, scale));
      const walking = e.moving && (pose === 'walk' || pose === 'stand');
      const ph = e.stride * 5.2;
      const swing = walking ? Math.sin(ph) * 0.55 : 0;
      const bob = walking ? Math.abs(Math.cos(ph)) * 0.035 : 0;
      const seated = pose === 'sit' || pose === 'ride';
      // Hip height in local space.
      const hipY = pose === 'ride' ? 0.0 : pose === 'sit' ? 0.47 : 0.8 + bob;
      // Torso.
      let lean = 0;
      if (pose === 'work') lean = 0.5 + Math.sin(e.workAnim * 4) * 0.08;
      if (pose === 'sweep') lean = 0.25;
      if (pose === 'carry') lean = 0.15 + Math.sin(e.workAnim * 3) * 0.1;
      const workCrouch = pose === 'work' ? -0.22 : 0;
      _e.set(lean, 0, 0);
      _q2.setFromEuler(_e);
      _m.compose(_p.set(0, hipY + workCrouch, 0), _q2, _s.set(1, 1, 1));
      _m2.multiplyMatrices(_base, _m);
      P.torso.setMatrixAt(n, _m2);
      const torsoTop = new THREE.Vector3(0, 0.62, 0).applyQuaternion(_q2).add(new THREE.Vector3(0, hipY + workCrouch, 0));
      // Head.
      _m.compose(_p.set(torsoTop.x, torsoTop.y + 0.17, torsoTop.z), _q2, _s.set(1, 1, 1));
      _m2.multiplyMatrices(_base, _m);
      P.head.setMatrixAt(n, _m2);
      P.hair.setMatrixAt(n, _m2);
      const hatOn = isStaff || e.hat;
      if (hatOn) {
        P.hat.setMatrixAt(nh, _m2);
        P.brim.setMatrixAt(nh, _m2);
      }
      // Legs.
      for (const side of [-1, 1]) {
        const legPart = side < 0 ? P.legL : P.legR;
        let rx;
        if (pose === 'ride') rx = -1.45;
        else if (pose === 'sit') rx = -1.25;
        else if (pose === 'work') rx = -0.9;
        else rx = swing * side;
        _e.set(rx, 0, 0);
        _q2.setFromEuler(_e);
        _m.compose(_p.set(side * 0.09, hipY + (pose === 'work' ? -0.2 : 0), seated ? 0.02 : 0), _q2, _s.set(1, 1, 1));
        _m2.multiplyMatrices(_base, _m);
        legPart.setMatrixAt(n, _m2);
      }
      // Arms.
      for (const side of [-1, 1]) {
        const armPart = side < 0 ? P.armL : P.armR;
        let rx = -swing * side * 0.8, rz = side * 0.08;
        if (pose === 'ride' && e.kind === 'visitor') {
          // Arms up on the coaster when moving fast.
          const ride = e.seat && sim.get(e.seat.rideId);
          if (ride && ride.rideType === 'coaster' && ride.phase === 'running' && ride.train.v > 2.2) { rx = -2.9; rz = side * 0.35; }
          else rx = -0.6;
        } else if (pose === 'sit') rx = -0.5;
        else if (pose === 'work') rx = -1.2 + Math.sin(e.workAnim * 7 + side) * 0.35;
        else if (pose === 'sweep') rx = -0.7 + Math.sin(e.workAnim * 5) * 0.4;
        else if (pose === 'carry') rx = -1.3;
        else if (isStaff && e.role === 'shop' && e.workAnim) rx = -0.9 + Math.sin(e.workAnim * 5 + side) * 0.3;
        if (!isStaff && e.item && side > 0 && pose !== 'ride') rx = -0.9;
        _e.set(rx, 0, rz);
        _q2.setFromEuler(_e);
        const sh = new THREE.Vector3(side * 0.22, 0.56, 0).applyEuler(new THREE.Euler(lean, 0, 0)).add(new THREE.Vector3(0, hipY + workCrouch, 0));
        _m.compose(sh, _q2, _s.set(1, 1, 1));
        _m2.multiplyMatrices(_base, _m);
        armPart.setMatrixAt(n, _m2);
        if (side > 0 && !isStaff && e.item && pose !== 'ride' && ni < MAX) {
          const hand = new THREE.Vector3(0, -0.5, 0).applyQuaternion(_q2).add(sh);
          _m.compose(hand, _q2.identity(), _s.set(1, 1, 1));
          _m2.multiplyMatrices(_base, _m);
          P.item.setMatrixAt(ni, _m2);
          P.item.setColorAt(ni, _c.set(e.item.color));
          ni++;
        }
      }
      // Colours.
      if (isStaff) {
        P.torso.setColorAt(n, _c.set(e.shirt));
        P.armL.setColorAt(n, _c); P.armR.setColorAt(n, _c);
        P.legL.setColorAt(n, _c.set(0x2b3346)); P.legR.setColorAt(n, _c);
        P.head.setColorAt(n, _c.set(0xe8b98f));
        P.hair.setColorAt(n, _c.set(0x3a2a20));
        P.hat.setColorAt(nh, _c.set(e.shirt).multiplyScalar(0.75));
        P.brim.setColorAt(nh, _c);
      } else {
        P.torso.setColorAt(n, _c.set(e.shirt));
        P.armL.setColorAt(n, _c.set(e.skin)); P.armR.setColorAt(n, _c);
        P.legL.setColorAt(n, _c.set(e.pants)); P.legR.setColorAt(n, _c);
        P.head.setColorAt(n, _c.set(e.skin));
        P.hair.setColorAt(n, _c.set(e.hair));
        if (hatOn) { P.hat.setColorAt(nh, _c.set(e.shirt).offsetHSL(0.5, 0, 0)); P.brim.setColorAt(nh, _c); }
      }
      if (hatOn) nh++;
      // Mood marker above head.
      if (this.showMood && !isStaff) {
        const headW = new THREE.Vector3(0, 0, 0).applyMatrix4(_m2.multiplyMatrices(_base, _m.makeTranslation(0, (seated ? 0.8 : 1.6) + 0.25 + 0.16 * markerScale, 0)));
        _m.compose(headW, _q.identity(), _s.set(markerScale, markerScale, markerScale));
        this.moodMarkers.setMatrixAt(nm, _m);
        const md = e.mood;
        _c.set(md >= 70 ? 0x3ccf6e : md >= 50 ? 0xb6d33c : md >= 35 ? 0xf2b13a : 0xe5483b);
        if (e.impatient) _c.set(0xf28a2e);
        this.moodMarkers.setColorAt(nm, _c);
        nm++;
      }
      this.index[n] = e.id;
      const hy = seated ? 0.9 : 1.6 * scale;
      this.positions[n] = [e.x, e.y + hy * 0.6, e.z, scale];
      n++;
    }
    for (const k in P) {
      const im = P[k];
      im.count = k === 'hat' || k === 'brim' ? nh : k === 'item' ? ni : n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.moodMarkers.count = nm;
    this.moodMarkers.instanceMatrix.needsUpdate = true;
    if (this.moodMarkers.instanceColor) this.moodMarkers.instanceColor.needsUpdate = true;
  }
}
