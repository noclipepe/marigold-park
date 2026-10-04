import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WHEEL, CAROUSEL } from '../sim/layout.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

// Portrait demo: the park view is nearly square, so pull back a little.
export const PORTRAIT_VIEW = { target: new THREE.Vector3(2, 0, -2), azimuth: 0.34, polar: 0.84, distance: 292 };
export const DEFAULT_VIEW = { target: new THREE.Vector3(2, 0, 3), azimuth: 0.34, polar: 0.86, distance: 238 };
const BOUNDS = { minX: -95, maxX: 95, minZ: -70, maxZ: 75 };

export class CameraController {
  constructor(camera, dom, sim) {
    this.camera = camera;
    this.dom = dom;
    this.sim = sim;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.085;
    c.minDistance = 10;
    c.maxDistance = 260;
    c.minPolarAngle = 0.22;
    c.maxPolarAngle = 1.25;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 1.1;
    c.panSpeed = 1.0;
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls = c;
    this.mode = 'orbit';
    this.follow = null; // () => Vector3
    this.followId = null;
    this.focusAnim = null;
    this.listeners = [];
    this.lookYaw = 0; this.lookPitch = 0;
    this.defaultView = DEFAULT_VIEW;
    this.applyView(DEFAULT_VIEW);

    // Panning releases follow mode (orbiting and zooming keep it).
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; this.dragging = false; });
    dom.addEventListener('pointermove', (e) => {
      if (!down) return;
      const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (d > 5) {
        this.dragging = true;
        if (this.mode === 'orbit') {
          // Orbiting keeps the camera locked to a followed object; panning releases it.
          if (this.followId && down.b !== 0) this.stopFollow(true);
          this.focusAnim = null;
        }
        if (this.mode === 'ride') {
          this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - e.movementX * 0.004, -1.6, 1.6);
          this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - e.movementY * 0.004, -0.6, 0.6);
        }
      }
    });
    window.addEventListener('pointerup', () => { down = null; });
    dom.addEventListener('wheel', () => { if (this.mode === 'orbit') this.focusAnim = null; }, { passive: true });

    // WASD / arrow keys pan across the ground; Shift moves faster.
    this.keys = new Set();
    const MOVE = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
    const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    window.addEventListener('keydown', (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (MOVE[e.code]) { this.keys.add(e.code); e.preventDefault(); }
      if (e.key === 'Shift') this.keys.add('Shift');
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.key === 'Shift') this.keys.delete('Shift'); });
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Ground-plane movement from held keys (orbit mode only).
  applyKeys(dt) {
    const k = this.keys;
    if (!k.size) return;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    if (!f && !r) return;
    const cam = this.camera, c = this.controls;
    const fwd = _v.subVectors(c.target, cam.position).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = _v2.set(-fwd.z, 0, fwd.x);
    const dist = cam.position.distanceTo(c.target);
    const speed = Math.max(6, dist * 0.35) * (k.has('Shift') ? 2.5 : 1);
    const move = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, r).normalize().multiplyScalar(speed * dt);
    c.target.add(move);
    cam.position.add(move);
    if (this.followId) this.stopFollow(true);
    this.focusAnim = null;
  }

  on(fn) { this.listeners.push(fn); }
  emit(type) { for (const f of this.listeners) f(type); }

  applyView(v) {
    const off = new THREE.Vector3().setFromSphericalCoords(v.distance, v.polar, v.azimuth);
    this.controls.target.copy(v.target);
    this.camera.position.copy(v.target).add(off);
    this.camera.lookAt(v.target);
    this.controls.update();
  }

  // Smoothly return to the default overview.
  overview() {
    this.stopFollow();
    const V = this.defaultView;
    if (this.mode !== 'orbit') { this.exitRide(V); return; }
    const off = new THREE.Vector3().setFromSphericalCoords(V.distance, V.polar, V.azimuth);
    this.focusAnim = {
      t: 0, dur: 1.6, fromT: this.controls.target.clone(), fromP: this.camera.position.clone(),
      toT: () => V.target, toOff: off,
    };
  }

  // Frame a (possibly moving) point without changing the viewing angle.
  focus(getPos, distance, follow = false, id = null) {
    if (this.mode !== 'orbit') return;
    const off = this.camera.position.clone().sub(this.controls.target);
    const dist = distance ? THREE.MathUtils.clamp(distance, this.controls.minDistance, this.controls.maxDistance) : off.length();
    off.setLength(dist);
    this.focusAnim = { t: 0, dur: 1.15, fromT: this.controls.target.clone(), fromP: this.camera.position.clone(), toT: getPos, toOff: off };
    if (follow) { this.follow = getPos; this.followId = id; this.emit('follow'); }
    else this.stopFollow();
  }

  startFollow(getPos, id, distance) {
    this.focus(getPos, distance, true, id);
  }

  stopFollow(byUser = false) {
    if (!this.followId) return;
    this.follow = null;
    this.followId = null;
    this.emit(byUser ? 'followReleased' : 'follow');
  }

  // ------------------------------------------------------------------ ride-along
  enterRide(rideId, vehId, seat) {
    if (this.mode !== 'orbit') return;
    this.stopFollow();
    this.focusAnim = null;
    this.saved = { target: this.controls.target.clone(), pos: this.camera.position.clone(), fov: this.camera.fov };
    this.ride = { rideId, vehId, seat };
    this.controls.enabled = false;
    this.mode = 'toRide';
    this.trans = { t: 0, dur: 2.4, fromP: this.camera.position.clone(), fromQ: this.camera.quaternion.clone(), fromFov: this.camera.fov };
    this.lookYaw = 0; this.lookPitch = 0;
    this.smoothQ = null;
    this.emit('ride');
  }

  exitRide(toView) {
    if (this.mode !== 'ride' && this.mode !== 'toRide') return;
    const s = this.saved;
    let target = s.target, pos = s.pos;
    if (toView) {
      target = toView.target.clone();
      pos = target.clone().add(new THREE.Vector3().setFromSphericalCoords(toView.distance, toView.polar, toView.azimuth));
    }
    const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0));
    this.mode = 'fromRide';
    this.trans = { t: 0, dur: 1.9, fromP: this.camera.position.clone(), fromQ: this.camera.quaternion.clone(), fromFov: this.camera.fov, toP: pos, toQ: new THREE.Quaternion().setFromRotationMatrix(m), toT: target, toFov: s.fov };
    this.emit('ride');
  }

  // Seat-level pose for the current ride-along.
  ridePose(outPos, outQuat) {
    const sim = this.sim;
    const ride = sim.get(this.ride.rideId);
    if (ride.rideType === 'coaster') {
      const car = ride.vehicles.find((c) => c.id === this.ride.vehId) || ride.vehicles[0];
      const tr = ride.track;
      ride.carPose(car.index, _p, _q);
      // Eye between the two front-row seats.
      // Eye just behind the front row so riders and the car nose stay in view.
      const back = this.ride.seat != null && this.ride.seat >= 2;
      outPos.set(0, back ? 1.5 : 1.3, back ? -0.42 : 0.55).applyQuaternion(_q).add(_p);
      const s = ride.carS(car.index);
      tr.frame(s, _v, _t, _u, _r);
      const ahead = tr.point(s + 8, _v2);
      const look = _v.subVectors(ahead, outPos).normalize();
      // Keep a readable horizon: blend the track's roll with world up.
      const inLoop = tr.loopMask[Math.floor(tr.wrap(s) / tr.step)];
      const steep = Math.min(1, inLoop + Math.max(0, Math.abs(_t.y) - 0.75) * 4);
      const up = new THREE.Vector3(0, 1, 0).lerp(_u, 0.3 + 0.7 * steep).normalize();
      _m.lookAt(outPos, outPos.clone().add(look), up);
      outQuat.setFromRotationMatrix(_m);
      return;
    }
    if (ride.rideType === 'wheel') {
      const cab = ride.vehicles.find((c) => c.id === this.ride.vehId) || ride.vehicles[0];
      ride.cabinPos(cab.index, outPos);
      outPos.y += 0.4;
      // Look out of the wheel (not along its own spokes), toward the heart of the park.
      const dir = new THREE.Vector3().addScaledVector(ride.a, 0.3).addScaledVector(ride.t, -0.95).normalize();
      outPos.addScaledVector(dir, 0.55); // sit by the window
      dir.y = -0.22 - Math.max(0, (outPos.y - 10) / 60);
      _m.lookAt(outPos, outPos.clone().add(dir), new THREE.Vector3(0, 1, 0));
      outQuat.setFromRotationMatrix(_m);
      return;
    }
    // Carousel.
    const m = ride.vehicles.find((c) => c.id === this.ride.vehId) || ride.vehicles[0];
    ride.mountPos(m, outPos);
    outPos.y += 0.95;
    const a = ride.angle + m.base;
    const dir = new THREE.Vector3(Math.sin(a), -0.08, -Math.cos(a)).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.35)).normalize();
    _m.lookAt(outPos, outPos.clone().add(dir), new THREE.Vector3(0, 1, 0));
    outQuat.setFromRotationMatrix(_m);
  }

  applyLook(q) {
    if (Math.abs(this.lookYaw) < 1e-4 && Math.abs(this.lookPitch) < 1e-4) return q;
    const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'));
    return q.multiply(e);
  }

  update(dt) {
    const cam = this.camera;
    const c = this.controls;
    if (this.mode === 'orbit') {
      this.applyKeys(dt);
      if (this.focusAnim) {
        const f = this.focusAnim;
        f.t += dt / f.dur;
        const k = ease(Math.min(1, f.t));
        const to = f.toT();
        c.target.lerpVectors(f.fromT, to, k);
        const toP = _v.copy(to).add(f.toOff);
        cam.position.lerpVectors(f.fromP, toP, k);
        if (f.t >= 1) this.focusAnim = null;
      } else if (this.follow) {
        const to = this.follow();
        if (to) {
          const k = 1 - Math.exp(-dt * 5);
          const d = _v.subVectors(to, c.target).multiplyScalar(k);
          c.target.add(d);
          cam.position.add(d);
        }
      }
      // Keep the target inside the park.
      const tx = THREE.MathUtils.clamp(c.target.x, BOUNDS.minX, BOUNDS.maxX), tz = THREE.MathUtils.clamp(c.target.z, BOUNDS.minZ, BOUNDS.maxZ);
      const ty = THREE.MathUtils.clamp(c.target.y, 0, 32);
      if (tx !== c.target.x || tz !== c.target.z || ty !== c.target.y) {
        const dx = tx - c.target.x, dz = tz - c.target.z, dy = ty - c.target.y;
        c.target.set(tx, ty, tz);
        cam.position.x += dx; cam.position.z += dz; cam.position.y += dy;
      }
      c.update();
      if (cam.position.y < 2) cam.position.y = 2;
      return;
    }
    const pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    if (this.mode === 'toRide') {
      this.ridePose(pose.p, pose.q);
      const tr = this.trans;
      tr.t += dt / tr.dur;
      const k = ease(Math.min(1, tr.t));
      // Swoop: arc above the train then settle into the seat.
      const lift = Math.max(6, tr.fromP.distanceTo(pose.p) * 0.28);
      const ctrl = _v.lerpVectors(tr.fromP, pose.p, 0.6);
      ctrl.y = Math.max(tr.fromP.y, pose.p.y) + lift * 0.4;
      const a = _v2.lerpVectors(tr.fromP, ctrl, k);
      const b = new THREE.Vector3().lerpVectors(ctrl, pose.p, k);
      cam.position.lerpVectors(a, b, k);
      const kq = ease(Math.min(1, Math.max(0, (tr.t - 0.15) / 0.85)));
      cam.quaternion.slerpQuaternions(tr.fromQ, pose.q, kq);
      cam.fov = tr.fromFov + (68 - tr.fromFov) * k;
      cam.near = 0.5 + (0.06 - 0.5) * k;
      cam.updateProjectionMatrix();
      if (tr.t >= 1) { this.mode = 'ride'; this.smoothQ = pose.q.clone(); this.emit('ride'); }
      return;
    }
    if (this.mode === 'ride') {
      this.ridePose(pose.p, pose.q);
      if (!this.dragging) { this.lookYaw *= Math.exp(-dt * 1.5); this.lookPitch *= Math.exp(-dt * 1.5); }
      this.smoothQ.slerp(pose.q, 1 - Math.exp(-dt * 9));
      cam.position.copy(pose.p);
      cam.quaternion.copy(this.applyLook(this.smoothQ.clone()));
      return;
    }
    if (this.mode === 'fromRide') {
      const tr = this.trans;
      tr.t += dt / tr.dur;
      const k = ease(Math.min(1, tr.t));
      const ctrl = _v.lerpVectors(tr.fromP, tr.toP, 0.35);
      ctrl.y = Math.max(tr.fromP.y, tr.toP.y) + 10;
      const a = _v2.lerpVectors(tr.fromP, ctrl, k);
      const b = new THREE.Vector3().lerpVectors(ctrl, tr.toP, k);
      cam.position.lerpVectors(a, b, k);
      cam.quaternion.slerpQuaternions(tr.fromQ, tr.toQ, k);
      cam.fov = tr.fromFov + (tr.toFov - tr.fromFov) * k;
      cam.near = 0.06 + (0.5 - 0.06) * k;
      cam.updateProjectionMatrix();
      if (tr.t >= 1) {
        this.mode = 'orbit';
        c.target.copy(tr.toT);
        c.enabled = true;
        c.update();
        this.ride = null;
        this.emit('ride');
      }
    }
  }
}
