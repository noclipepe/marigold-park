import * as THREE from 'three';
import { COASTER, WHEEL, CAROUSEL } from './layout.js';
import { Track, STATION, CAR_COUNT, carCenterOffset } from './track.js';
import { pad, clamp } from './util.js';

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

export const QUEUE_SLOT = 0.78;

let sharedTrack = null;
export function getTrack() {
  if (!sharedTrack) sharedTrack = new Track();
  return sharedTrack;
}

class RideBase {
  constructor(sim, def, rideType) {
    this.sim = sim;
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.short = def.short;
    this.kind = 'ride';
    this.rideType = rideType;
    this.open = true;
    this.price = def.price;
    this.fairPrice = def.fairPrice;
    this.queue = [];
    this.lane = def.queue;
    this.queueCap = Math.floor(this.lane.length / QUEUE_SLOT);
    this.condition = 100;
    this.cycles = 0;
    this.ridersTotal = 0;
    this.revenue = 0;
    this.events = [];
    this.maint = null; // { jobId, stage: 'requested' | 'stopping' | 'inProgress' }
    this.phase = 'boarding';
    this.phaseTime = 0;
    this.boarders = new Set(); // assigned, walking to their seat
    this.unloaders = new Set(); // released, walking out
    this.vehicles = [];
    this.lastAdmitTry = 0;
    this.closedAt = null;
    this.waitSamples = [];
  }

  get admitting() {
    return this.open && (!this.maint || this.maint.stage === 'requested');
  }

  statusKey() {
    if (this.maint && this.maint.stage === 'inProgress') return 'maintenance';
    if (this.maint && this.maint.stage === 'stopping') return 'stopping';
    if (!this.open) return this.isEmpty() && this.phase === 'idle' ? 'closed' : 'closing';
    if (this.maint) return 'maintPending';
    return 'operating';
  }

  statusLabel() {
    return {
      operating: 'Operating', maintPending: 'Operating · maintenance requested', stopping: 'Stopping for maintenance',
      maintenance: 'Under maintenance', closing: 'Closing · finishing cycle', closed: 'Closed',
    }[this.statusKey()];
  }

  setPhase(p) {
    this.phase = p;
    this.phaseTime = 0;
  }

  riders() {
    const out = [];
    for (const veh of this.vehicles) for (const s of veh.seats) if (s) out.push(s);
    return out;
  }

  seatedCount() {
    let n = 0;
    for (const veh of this.vehicles) for (const s of veh.seats) if (s) n++;
    return n;
  }

  capacity() {
    let n = 0;
    for (const veh of this.vehicles) n += veh.seats.length;
    return n;
  }

  isEmpty() {
    return this.seatedCount() === 0 && this.boarders.size === 0;
  }

  // Queue -------------------------------------------------------------------
  canJoin(partySize = 1) {
    return this.admitting && this.queue.length + partySize <= this.queueCap;
  }

  join(v) {
    if (this.queue.includes(v.id)) return false;
    this.queue.push(v.id);
    return true;
  }

  removeFromQueue(vid) {
    const i = this.queue.indexOf(vid);
    if (i >= 0) this.queue.splice(i, 1);
    return i >= 0;
  }

  disperseQueue(reason) {
    const ids = this.queue.slice();
    this.queue.length = 0;
    for (const id of ids) {
      const v = this.sim.get(id);
      if (v) this.sim.visitors_.onQueueDispersed(v, this, reason);
    }
    if (ids.length) this.sim.log(`${ids.length} guests left the ${this.name} queue (${reason}).`, [this.id], { noteworthy: true });
  }

  queueHeadReady() {
    if (!this.queue.length) return null;
    const v = this.sim.get(this.queue[0]);
    if (v && v.state === 'queuing' && v.qDist < 0.35) return v;
    return null;
  }

  // Pop the head visitor, charge them and send them to a seat.
  admitHead(veh, seatIdx) {
    const v = this.queueHeadReady();
    if (!v) return null;
    if (v.budget - v.spent < this.price) {
      this.queue.shift();
      this.sim.visitors_.cannotAfford(v, this);
      return null;
    }
    this.queue.shift();
    veh.seats[seatIdx] = v.id;
    this.boarders.add(v.id);
    this.sim.charge(v, this.price, this, `Ticket · ${this.name}`);
    this.revenue += this.price;
    v.seat = { rideId: this.id, vehId: veh.id, seat: seatIdx };
    this.waitSamples.push(this.sim.time - v.queueSince);
    if (this.waitSamples.length > 20) this.waitSamples.shift();
    this.sim.visitors_.startBoarding(v, this, veh, seatIdx);
    return v;
  }

  // Called by visitor logic when the boarder reaches the seat.
  seated(v) {
    this.boarders.delete(v.id);
  }

  release(v) {
    const veh = this.vehicles.find((x) => x.id === v.seat.vehId);
    if (veh) veh.seats[v.seat.seat] = null;
    this.unloaders.add(v.id);
    this.sim.visitors_.startUnloading(v, this);
  }

  unloaded(v) {
    this.unloaders.delete(v.id);
  }

  avgWaitObserved() {
    if (!this.waitSamples.length) return 0;
    return this.waitSamples.reduce((a, b) => a + b, 0) / this.waitSamples.length;
  }

  postedWait() {
    return this.estimateWait(this.queue.length);
  }

  // Maintenance hooks --------------------------------------------------------
  onMechanicArrived() {
    if (!this.maint) return;
    this.maint.stage = 'stopping';
    this.sim.log(`${this.name} stopped admitting guests for maintenance.`, [this.id, this.maint.jobId], { noteworthy: true });
    if (this.queue.length) this.disperseQueue('maintenance');
    this.sim.visitors_.redirectFrom(this.id);
  }

  readyForMaintenance() {
    return this.phase === 'idle' && this.isEmpty() && this.unloaders.size === 0;
  }

  completeMaintenance() {
    this.condition = 100;
    const job = this.maint && this.maint.jobId;
    this.maint = null;
    this.sim.log(`${this.name} maintenance complete${this.open ? ' — reopened to guests' : ''}.`, [this.id, job], { noteworthy: true });
  }

  setOpen(open) {
    if (open === this.open) return;
    this.open = open;
    if (!open) {
      this.sim.log(`${this.name} closed to new guests by the park manager.`, [this.id], { noteworthy: true });
      if (this.queue.length) this.disperseQueue('ride closed');
    } else {
      this.sim.log(`${this.name} reopened by the park manager.`, [this.id], { noteworthy: true });
    }
  }

  setPrice(p) {
    p = clamp(Math.round(p), 0, 30);
    if (p === this.price) return;
    const old = this.price;
    this.price = p;
    this.sim.log(`${this.name} ticket price changed from $${old} to $${p}.`, [this.id], { noteworthy: true });
  }

  wearAfterCycle(amount) {
    this.cycles++;
    this.condition = Math.max(5, this.condition - amount);
    if (this.condition < 40 && !this.maint) this.sim.jobs_.requestMaintenance(this, 'auto');
  }
}

// ---------------------------------------------------------------------------
export class Coaster extends RideBase {
  constructor(sim) {
    super(sim, COASTER, 'coaster');
    this.track = getTrack();
    this.train = { id: 'T-01', kind: 'vehicle', vtype: 'train', rideId: this.id, name: 'Train T-01', events: [], s: STATION.stopS, v: 0, lapTarget: 0, seats: [] };
    for (let i = 0; i < CAR_COUNT; i++) {
      const car = { id: `C-${pad(i + 1, 2)}`, kind: 'vehicle', vtype: 'car', rideId: this.id, trainId: 'T-01', index: i, name: `Car C-${pad(i + 1, 2)}`, seats: [null, null, null, null], events: [] };
      this.vehicles.push(car);
    }
    this.train.cars = this.vehicles.map((c) => c.id);
    this.avgRun = 150;
    this.avgCycle = 205;
    this.runStart = 0;
    this.releaseTimer = 0;
    this.cycleStart = sim.time;
    this.lastDispatchCount = 0;
  }

  seatLocal(seat) {
    const row = seat < 2 ? 0 : 1;
    const side = seat % 2 === 0 ? 1 : -1;
    return [side * 0.34, 0.42, row === 0 ? 0.42 : -0.52];
  }

  carS(i) {
    return this.train.s + carCenterOffset(i);
  }

  carPose(i, pos, quat) {
    const s = this.carS(i);
    const tr = this.track;
    // Orientation from the chord between bogies keeps wheels on the rails.
    tr.point(s + 0.85, _v);
    tr.point(s - 0.85, _p);
    _t.subVectors(_v, _p).normalize();
    tr.frame(s, pos, _r, _u, _r);
    _u.addScaledVector(_t, -_u.dot(_t)).normalize();
    _r.crossVectors(_t, _u);
    _m.makeBasis(_r.negate(), _u, _t);
    quat.setFromRotationMatrix(_m);
    return pos;
  }

  seatPose(vehId, seat, pos, quat) {
    const car = this.vehicles.find((c) => c.id === vehId);
    this.carPose(car.index, pos, quat);
    const [lx, ly, lz] = this.seatLocal(seat);
    _v.set(lx, ly, lz).applyQuaternion(quat);
    pos.add(_v);
    return pos;
  }

  boardingPath(veh, seat) {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    this.seatPose(veh.id, seat, pos, q);
    return [[-37.6, 4.2], [pos.x, 2.6], [pos.x, pos.z]];
  }

  unloadPath(v, veh, seat) {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    this.seatPose(veh.id, seat, pos, q);
    const pts = [[pos.x, pos.z], [pos.x, 2.8]];
    for (const p of this.def.exitLane.pts) pts.push([p.x, p.z]);
    return pts;
  }

  nextFreeSeat() {
    for (const car of this.vehicles) for (let s = 0; s < 4; s++) if (!car.seats[s]) return [car, s];
    return null;
  }

  update(dt) {
    this.phaseTime += dt;
    const tr = this.track;
    switch (this.phase) {
      case 'boarding': {
        this.lastAdmitTry -= dt;
        if (this.admitting && this.lastAdmitTry <= 0) {
          const free = this.nextFreeSeat();
          if (free && this.queueHeadReady()) {
            this.admitHead(free[0], free[1]);
            this.lastAdmitTry = 0.7;
          }
        }
        const assigned = this.seatedCount();
        const allSeated = this.boarders.size === 0;
        const full = !this.nextFreeSeat();
        const headReady = this.admitting && !!this.queueHeadReady();
        if (assigned > 0 && allSeated && this.phaseTime >= 12) {
          if (full || !this.admitting || (!headReady && this.phaseTime >= 22 && this.queue.length === 0) || this.phaseTime >= 48) this.dispatch();
        } else if (assigned === 0 && !this.admitting) {
          this.setPhase('idle');
        }
        break;
      }
      case 'running': {
        const sc = this.train.s - 6;
        let v = this.train.v;
        const onLift = tr.inZone(this.train.s, 'liftStart', 'liftEnd') || tr.inZone(this.train.s - 12, 'liftStart', 'liftEnd');
        const remaining = this.train.lapTarget - this.train.s;
        const traveled = tr.length - remaining;
        if (traveled < tr.zones.liftStart - STATION.stopS) {
          v += (1.5 - v) * Math.min(1, dt * 0.8); // station tyres
        } else if (onLift) {
          v += (1.0 - v) * Math.min(1, dt * 1.5);
        } else {
          v += (-0.55 * tr.slope(sc) - 0.0035 * v * v - 0.006) * dt;
          if (v < 0.7) v = 0.7; // booster tyres
        }
        if (tr.inZone(this.train.s, 'brakeStart', 'end') && v > 1.4) v = Math.max(1.4, v - 1.2 * dt);
        if (remaining < 25) v = Math.min(v, Math.max(0.1, Math.sqrt(2 * 0.05 * Math.max(0, remaining))));
        this.train.v = v;
        this.train.s += v * dt;
        if (this.train.lapTarget - this.train.s <= 0.02) {
          this.train.s = this.train.lapTarget;
          this.train.s = tr.wrap(this.train.s);
          this.train.v = 0;
          const run = this.phaseTime;
          this.avgRun = this.avgRun * 0.6 + run * 0.4;
          this.sim.log(`Train T-01 returned to the ${this.name} station.`, [this.id, 'T-01']);
          this.setPhase('unloading');
          this.releaseTimer = 0.6;
          this.wearAfterCycle(1.3);
        }
        break;
      }
      case 'unloading': {
        this.releaseTimer -= dt;
        if (this.releaseTimer <= 0) {
          let released = false;
          for (const car of this.vehicles) {
            for (let s = 0; s < 4 && !released; s++) {
              const vid = car.seats[s];
              if (vid) {
                const v = this.sim.get(vid);
                if (v) this.release(v);
                else car.seats[s] = null;
                released = true;
              }
            }
            if (released) break;
          }
          this.releaseTimer = 0.45;
          if (!released && this.phaseTime > 4) {
            const now = this.sim.time;
            this.avgCycle = this.avgCycle * 0.6 + (now - this.cycleStart) * 0.4;
            this.cycleStart = now;
            this.setPhase(this.admitting ? 'boarding' : 'idle');
          }
        }
        break;
      }
      case 'idle': {
        if (this.admitting) {
          this.cycleStart = this.sim.time;
          this.setPhase('boarding');
        }
        break;
      }
    }
  }

  dispatch() {
    const n = this.seatedCount();
    this.lastDispatchCount = n;
    this.ridersTotal += n;
    this.train.lapTarget = this.train.s + this.track.length;
    this.train.v = 0.2;
    this.setPhase('running');
    const att = this.sim.staffByPost(this.id);
    this.sim.log(`Train T-01 dispatched from ${this.name} with ${n} rider${n === 1 ? '' : 's'}.`, [this.id, 'T-01', att && att.id]);
    for (const id of this.riders()) {
      const v = this.sim.get(id);
      if (v) this.sim.visitors_.rideStarted(v, this);
    }
  }

  timeToNextBoarding() {
    switch (this.phase) {
      case 'boarding': return Math.max(0, 26 - this.phaseTime) + this.avgRun + 14;
      case 'running': return Math.max(5, this.avgRun - this.phaseTime) + 14;
      case 'unloading': return Math.max(3, 12 - this.phaseTime);
      default: return 0;
    }
  }

  estimateWait(p) {
    const cap = this.capacity();
    const free = this.phase === 'boarding' && this.admitting ? cap - this.seatedCount() : 0;
    if (p < free) return 10 + p * 1.2;
    return this.timeToNextBoarding() + Math.floor((p - free) / cap) * this.avgCycle + 15;
  }

  phaseLabel() {
    switch (this.phase) {
      case 'boarding': return this.seatedCount() ? `Boarding · ${this.seatedCount()}/${this.capacity()} seated` : 'Boarding · waiting for riders';
      case 'running': {
        const tr = this.track;
        if (tr.inZone(this.train.s, 'liftStart', 'liftEnd')) return 'Running · climbing the lift hill';
        if (tr.inZone(this.train.s, 'loopStart', 'loopEnd')) return 'Running · vertical loop';
        if (tr.inZone(this.train.s, 'brakeStart', 'end')) return 'Running · brake run';
        return 'Running';
      }
      case 'unloading': return 'Unloading';
      default: return 'Stopped';
    }
  }

  cycleProgress() {
    if (this.phase === 'running') return clamp((this.train.s - (this.train.lapTarget - this.track.length)) / this.track.length, 0, 1);
    if (this.phase === 'boarding') return clamp(this.phaseTime / 40, 0, 1);
    return 0;
  }

  speedKmh() {
    return this.train.v * 3.6 * 4; // shown in real-world terms
  }
}

// ---------------------------------------------------------------------------
export class Wheel extends RideBase {
  constructor(sim) {
    super(sim, WHEEL, 'wheel');
    const d = WHEEL;
    this.hub = new THREE.Vector3(d.hub[0], d.hub[1], d.hub[2]);
    this.R = d.radius;
    this.yaw = d.yaw;
    this.t = new THREE.Vector3(Math.cos(d.yaw), 0, Math.sin(d.yaw));
    this.a = new THREE.Vector3(-Math.sin(d.yaw), 0, Math.cos(d.yaw));
    this.n = d.cabins;
    for (let i = 0; i < this.n; i++) {
      this.vehicles.push({ id: `W-${pad(i + 1, 2)}`, kind: 'vehicle', vtype: 'cabin', rideId: this.id, index: i, name: `Cabin W-${pad(i + 1, 2)}`, seats: [null, null, null, null], events: [], boardedAt: [0, 0, 0, 0] });
    }
    this.angle = -Math.PI / 2; // cabin 0 at the bottom
    this.angVel = 0;
    this.stopIndex = 0; // which cabin is at the platform
    this.stopsDone = 0;
    this.sub = 'dwell';
    this.subTime = 0;
    this.phase = 'exchange';
    this.avgCycle = 230;
    this.cycleStart = sim.time;
    this.rotTarget = 0;
    this.releaseTimer = 0;
  }

  cabinAngle(i) {
    return this.angle + (i * Math.PI * 2) / this.n;
  }

  cabinPos(i, out) {
    const a = this.cabinAngle(i);
    out.copy(this.hub).addScaledVector(this.t, Math.cos(a) * this.R);
    out.y += Math.sin(a) * this.R;
    out.y -= 1.75; // hangs below its pivot
    return out;
  }

  seatLocal(seat) {
    // Two benches facing each other along the wheel plane.
    const side = seat < 2 ? 1 : -1;
    const lat = seat % 2 === 0 ? 0.36 : -0.36;
    return [lat, -0.38, side * 0.48, side];
  }

  seatPose(vehId, seat, pos, quat) {
    const cab = this.vehicles.find((c) => c.id === vehId);
    this.cabinPos(cab.index, pos);
    const [lx, ly, lz, side] = this.seatLocal(seat);
    // local x along axle (a), local z along plane tangent (t)
    pos.addScaledVector(this.a, lx).addScaledVector(this.t, lz);
    pos.y += ly;
    const yaw = Math.atan2(this.t.x, this.t.z) + (side > 0 ? Math.PI : 0);
    quat.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    return pos;
  }

  boardingPath(veh, seat) {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    this.seatPose(veh.id, seat, pos, q);
    const door = this.cabinPos(veh.index, new THREE.Vector3()).addScaledVector(this.a, 1.25);
    return [[door.x, door.z], [pos.x, pos.z]];
  }

  unloadPath(v, veh, seat) {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    this.seatPose(veh.id, seat, pos, q);
    const door = this.cabinPos(veh.index, new THREE.Vector3()).addScaledVector(this.a, 1.25).addScaledVector(this.t, 0.6);
    const pts = [[pos.x, pos.z], [door.x, door.z]];
    for (const p of this.def.exitLane.pts) pts.push([p.x, p.z]);
    return pts;
  }

  targetAngleFor(i) {
    return -Math.PI / 2 - (i * Math.PI * 2) / this.n;
  }

  anyAboard() {
    return this.seatedCount() > 0 || this.boarders.size > 0;
  }

  update(dt) {
    this.phaseTime += dt;
    this.subTime += dt;
    const cab = this.vehicles[this.stopIndex];
    switch (this.phase) {
      case 'exchange': {
        if (this.sub === 'dwell') {
          // Unload riders who have been round, one by one.
          this.releaseTimer -= dt;
          const pending = cab.seats.findIndex((vid, s) => vid && !this.boarders.has(vid) && this.sim.time - cab.boardedAt[s] > 40);
          if (pending >= 0) {
            if (this.releaseTimer <= 0) {
              const v = this.sim.get(cab.seats[pending]);
              if (v) this.release(v);
              else cab.seats[pending] = null;
              this.releaseTimer = 0.6;
            }
            this.subTime = Math.min(this.subTime, 1);
            break;
          }
          // Board new riders (keep parties together where possible).
          const free = cab.seats.indexOf(null);
          let headFits = false;
          const head = this.admitting && free >= 0 ? this.queueHeadReady() : null;
          if (head) {
            const freeCount = cab.seats.filter((x) => !x).length;
            const party = this.sim.partyOf(head);
            const partyInQueue = party ? party.members.filter((id) => this.queue.includes(id)).length : 1;
            // Don't split a party across cabins when the next cabin could take them all.
            headFits = freeCount === 4 || partyInQueue <= freeCount || cab.seats.some((id) => id && this.sim.sameParty(id, head.id));
            if (headFits && this.releaseTimer <= 0) {
              this.admitHead(cab, free);
              cab.boardedAt[free] = this.sim.time;
              this.releaseTimer = 0.6;
              this.subTime = Math.min(this.subTime, 3);
            }
          }
          const boardingHere = cab.seats.some((vid) => vid && this.boarders.has(vid));
          const minDwell = 4.5;
          const headComing = this.admitting && free >= 0 && this.queue.length > 0 && (headFits || !head);
          if (!boardingHere && this.subTime > minDwell && this.seatedCount() === 0 && this.boarders.size === 0 && (!this.admitting || this.queue.length === 0)) {
            this.stopsDone = 0;
            this.setPhase('idle');
            break;
          }
          if (!boardingHere && this.subTime > minDwell && (!headComing || this.subTime > 12)) {
            this.stopsDone++;
            if (this.stopsDone >= this.n) {
              this.stopsDone = 0;
              if (this.seatedCount() > 0) {
                this.setPhase('rotating');
                this.rotTarget = this.angle + Math.PI * 2;
                this.ridersTotal += this.seatedCount();
                this.sim.log(`${this.name} started a full rotation with ${this.seatedCount()} riders.`, [this.id]);
                for (const id of this.riders()) { const v = this.sim.get(id); if (v) this.sim.visitors_.rideStarted(v, this); }
              } else {
                this.setPhase('idle');
              }
              break;
            }
            this.stopIndex = (this.stopIndex - 1 + this.n) % this.n;
            this.rotTarget = this.targetAngleFor(this.stopIndex);
            while (this.rotTarget < this.angle - 0.01) this.rotTarget += Math.PI * 2;
            this.rotFrom = this.angle;
            this.sub = 'move';
            this.subTime = 0;
          }
        } else if (this.sub === 'move') {
          const dur = 3.6;
          const k = clamp(this.subTime / dur, 0, 1);
          const e = k * k * (3 - 2 * k);
          this.angle = this.rotFrom + (this.rotTarget - this.rotFrom) * e;
          if (k >= 1) {
            this.angle = this.rotTarget;
            this.sub = 'dwell';
            this.subTime = 0;
            this.releaseTimer = 0.4;
          }
        }
        break;
      }
      case 'rotating': {
        const total = Math.PI * 2;
        const dur = 72;
        const k = clamp(this.phaseTime / dur, 0, 1);
        // Smooth start and stop.
        const e = k < 0.1 ? (k * k) / 0.2 : k > 0.9 ? 1 - ((1 - k) * (1 - k)) / 0.2 : (k - 0.05) / 0.9 * 1;
        const start = this.rotTarget - total;
        this.angle = start + total * clamp(e, 0, 1);
        if (k >= 1) {
          this.angle = this.rotTarget;
          this.wearAfterCycle(1.1);
          const now = this.sim.time;
          this.avgCycle = this.avgCycle * 0.6 + (now - this.cycleStart) * 0.4;
          this.cycleStart = now;
          this.setPhase('exchange');
          this.sub = 'dwell';
          this.subTime = 0;
          this.stopsDone = 0;
        }
        break;
      }
      case 'idle': {
        if ((this.admitting && this.queue.length) || this.seatedCount() > 0) {
          this.setPhase('exchange');
          this.sub = 'dwell';
          this.subTime = 0;
          this.stopsDone = 0;
          this.cycleStart = this.sim.time;
        }
        break;
      }
    }
    // Normalise angle occasionally.
    if (this.angle > Math.PI * 20) {
      this.angle -= Math.PI * 20;
      this.rotTarget -= Math.PI * 20;
      if (this.rotFrom !== undefined) this.rotFrom -= Math.PI * 20;
    }
  }

  readyForMaintenance() {
    return this.phase === 'idle' && this.isEmpty() && this.unloaders.size === 0;
  }

  timeToNextBoarding() {
    if (this.phase === 'rotating') return Math.max(3, 72 - this.phaseTime) + 8;
    return 8;
  }

  estimateWait(p) {
    const perSec = this.capacity() / Math.max(60, this.avgCycle);
    const base = this.phase === 'rotating' ? Math.max(0, 72 - this.phaseTime) : 0;
    return base + 8 + p / perSec;
  }

  phaseLabel() {
    if (this.phase === 'rotating') return 'Rotating';
    if (this.phase === 'idle') return 'Stopped';
    const cab = this.vehicles[this.stopIndex];
    return this.sub === 'move' ? 'Indexing to next cabin' : `Loading cabin ${cab.id}`;
  }

  cycleProgress() {
    if (this.phase === 'rotating') return clamp(this.phaseTime / 72, 0, 1);
    if (this.phase === 'exchange') return this.stopsDone / this.n;
    return 0;
  }
}

// ---------------------------------------------------------------------------
const MOUNT_NAMES = ['Bluebell', 'Comet', 'Juniper', 'Pepper', 'Saffron', 'Willow', 'Maple', 'Biscuit', 'Clover', 'Duchess', 'Ember', 'Fable', 'Ginger', 'Honey', 'Indigo', 'Jasper'];

export class Carousel extends RideBase {
  constructor(sim) {
    super(sim, CAROUSEL, 'carousel');
    const d = CAROUSEL;
    this.center = new THREE.Vector3(d.center[0], 0, d.center[1]);
    for (let i = 0; i < d.mounts; i++) {
      const outer = i % 2 === 0;
      const k = Math.floor(i / 2);
      this.vehicles.push({
        id: `H-${pad(i + 1, 2)}`, kind: 'vehicle', vtype: 'mount', rideId: this.id, index: i,
        name: `Horse H-${pad(i + 1, 2)} “${MOUNT_NAMES[i]}”`, horse: MOUNT_NAMES[i],
        radius: outer ? 5.9 : 4.1, base: (k / 8) * Math.PI * 2 + (outer ? 0 : Math.PI / 8), phase: (i * 1.7) % (Math.PI * 2),
        seats: [null], events: [],
      });
    }
    this.angle = 0;
    this.omega = 0;
    this.avgCycle = 112;
    this.cycleStart = sim.time;
    this.releaseTimer = 0;
    this.lastAdmitTry = 0;
  }

  mountPos(m, out) {
    const a = this.angle + m.base;
    out.set(this.center.x + Math.cos(a) * m.radius, 0, this.center.z + Math.sin(a) * m.radius);
    out.y = 0.55 + 1.05 + 0.28 * Math.sin(this.angle * 3 + m.phase);
    return out;
  }

  seatPose(vehId, seat, pos, quat) {
    const m = this.vehicles.find((c) => c.id === vehId);
    this.mountPos(m, pos);
    const a = this.angle + m.base;
    // Riders face the direction of travel (counter-clockwise seen from above).
    const yaw = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI;
    quat.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    return pos;
  }

  ringPath(a0, a1, r) {
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const n = Math.max(1, Math.ceil(Math.abs(d) / 0.35));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (d * i) / n;
      out.push([this.center.x + Math.cos(a) * r, this.center.z + Math.sin(a) * r]);
    }
    return out;
  }

  boardingPath(veh, seat) {
    const p = this.mountPos(veh, new THREE.Vector3());
    const a = this.angle + veh.base;
    const g = this.def.gate;
    const ga = Math.atan2(g[1] - this.center.z, g[0] - this.center.x);
    const pts = [[g[0], g[1]], ...this.ringPath(ga, a, 7.0)];
    pts.push([p.x + Math.cos(a) * 0.6, p.z + Math.sin(a) * 0.6], [p.x, p.z]);
    return pts;
  }

  unloadPath(v, veh, seat) {
    const p = this.mountPos(veh, new THREE.Vector3());
    const a = this.angle + veh.base;
    const e = this.def.exitGate;
    const ea = Math.atan2(e[1] - this.center.z, e[0] - this.center.x);
    const pts = [[p.x, p.z], [p.x + Math.cos(a) * 0.6, p.z + Math.sin(a) * 0.6], ...this.ringPath(a, ea, 7.0)];
    for (const q of this.def.exitLane.pts) pts.push([q.x, q.z]);
    return pts;
  }

  nextFreeSeat() {
    // Fill outer horses first; they are the favourites.
    const order = this.vehicles.slice().sort((a, b) => b.radius - a.radius || a.index - b.index);
    for (const m of order) if (!m.seats[0]) return [m, 0];
    return null;
  }

  update(dt) {
    this.phaseTime += dt;
    switch (this.phase) {
      case 'boarding': {
        this.omega = 0;
        this.lastAdmitTry -= dt;
        if (this.admitting && this.lastAdmitTry <= 0) {
          const free = this.nextFreeSeat();
          if (free && this.queueHeadReady()) {
            this.admitHead(free[0], free[1]);
            this.lastAdmitTry = 0.55;
          }
        }
        const n = this.seatedCount();
        const allSeated = this.boarders.size === 0;
        const full = !this.nextFreeSeat();
        if (n > 0 && allSeated && this.phaseTime >= 10) {
          if (full || !this.admitting || (this.queue.length === 0 && this.phaseTime >= 18) || this.phaseTime >= 40) {
            this.setPhase('running');
            this.ridersTotal += n;
            this.sim.log(`${this.name} started with ${n} rider${n === 1 ? '' : 's'}.`, [this.id, this.sim.staffByPost(this.id)?.id]);
            for (const id of this.riders()) { const v = this.sim.get(id); if (v) this.sim.visitors_.rideStarted(v, this); }
          }
        } else if (n === 0 && !this.admitting) {
          this.setPhase('idle');
        }
        break;
      }
      case 'running': {
        const dur = 64;
        const k = this.phaseTime / dur;
        const target = k < 0.15 ? k / 0.15 : k > 0.82 ? Math.max(0, (1 - k) / 0.18) : 1;
        this.omega = 0.15 * target;
        this.angle -= this.omega * dt; // counter-clockwise seen from above
        if (k >= 1) {
          this.omega = 0;
          this.wearAfterCycle(1.6);
          this.setPhase('unloading');
          this.releaseTimer = 0.5;
        }
        break;
      }
      case 'unloading': {
        this.releaseTimer -= dt;
        if (this.releaseTimer <= 0) {
          const m = this.vehicles.find((x) => x.seats[0]);
          if (m) {
            const v = this.sim.get(m.seats[0]);
            if (v) this.release(v);
            else m.seats[0] = null;
            this.releaseTimer = 0.4;
          } else if (this.phaseTime > 3) {
            const now = this.sim.time;
            this.avgCycle = this.avgCycle * 0.6 + (now - this.cycleStart) * 0.4;
            this.cycleStart = now;
            this.setPhase(this.admitting ? 'boarding' : 'idle');
          }
        }
        break;
      }
      case 'idle': {
        if (this.admitting) {
          this.cycleStart = this.sim.time;
          this.setPhase('boarding');
        }
        break;
      }
    }
  }

  timeToNextBoarding() {
    switch (this.phase) {
      case 'boarding': return Math.max(0, 20 - this.phaseTime) + 64 + 10;
      case 'running': return Math.max(3, 64 - this.phaseTime) + 10;
      case 'unloading': return 6;
      default: return 0;
    }
  }

  estimateWait(p) {
    const cap = this.capacity();
    const free = this.phase === 'boarding' && this.admitting ? cap - this.seatedCount() : 0;
    if (p < free) return 10 + p;
    return this.timeToNextBoarding() + Math.floor((p - free) / cap) * this.avgCycle + 12;
  }

  phaseLabel() {
    switch (this.phase) {
      case 'boarding': return this.seatedCount() ? `Boarding · ${this.seatedCount()}/${this.capacity()} mounted` : 'Boarding · waiting for riders';
      case 'running': return 'Turning';
      case 'unloading': return 'Unloading';
      default: return 'Stopped';
    }
  }

  cycleProgress() {
    if (this.phase === 'running') return clamp(this.phaseTime / 64, 0, 1);
    if (this.phase === 'boarding') return clamp(this.phaseTime / 30, 0, 1);
    return 0;
  }
}
