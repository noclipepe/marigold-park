import { Graph } from './graph.js';
import { mulberry32, clamp, fmtClock } from './util.js';
import { NODES, LITTER_SPOTS, WHEEL } from './layout.js';
import { Coaster, Wheel, Carousel } from './rides.js';
import { VisitorSystem } from './visitors.js';
import { ShopSystem } from './shops.js';
import { JobSystem } from './jobs.js';

export const TIME_SCALE = 4; // park seconds per real second at 1×

const START_NODES = ['P2', 'P4', 'P0', 'P6', 'CQE', 'W2', 'E1', 'E7', 'E2', 'N2', 'B1', 'K1X', 'K2X', 'E3', 'W3', 'N1', 'WX', 'E8'];

export class Simulation {
  constructor(seed = 20261004) {
    this.seed = seed;
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.rng = mulberry32(this.seed);
    this.time = -480;
    this.entities = new Map();
    this.events = [];
    this.eventSeq = 0;
    this.counters = { G: 0, F: 0, P: 0, O: 0, J: 0, D: 0 };
    this.finance = { rides: 0, shops: 0, transactions: [] };
    this.visitors = [];
    this.parties = [];
    this.retired = [];
    this.departed = 0;
    this.arrivedTotal = 0;
    this.staff = [];
    this.jobs = [];
    this.deliveries = [];
    this.orders = [];
    this.shops = [];
    this.graph = new Graph();
    this.visitors_ = new VisitorSystem(this);
    this.shops_ = new ShopSystem(this);
    this.jobs_ = new JobSystem(this);
    this.rides = [new Coaster(this), new Wheel(this), new Carousel(this)];
    for (const r of this.rides) {
      this.register(r);
      for (const v of r.vehicles) this.register(v);
    }
    this.register(this.rides[0].train);
    this.shops_.create();
    this.register({ id: 'GATE', kind: 'place', name: 'Entrance & exit', events: [] });
    this.register({ id: 'DEPOT', kind: 'place', name: 'Service Depot', events: [] });
    this.jobs_.create();
    this.spawnTimer = 0;
    // Ride wear at opening so maintenance becomes relevant early.
    this.rides[0].condition = 71;
    this.rides[1].condition = 64;
    this.rides[2].condition = 46;
    // Seed an established park and let it run for a while.
    for (let i = 0; i < 26; i++) {
      const node = START_NODES[Math.floor(this.rng() * START_NODES.length)];
      const party = this.visitors_.createParty(node);
      for (const id of party.members) {
        const v = this.get(id);
        v.arrivedAt = this.time - this.rng() * 900;
        v.appetite = this.rng() * 0.8;
        v.mood = 60 + this.rng() * 25;
        this.visitors_.setState(v, 'idle');
      }
      this.arrivedTotal += party.members.length;
    }
    this.warm = true;
    let boosted = false;
    while (this.time < 0) {
      this.step(0.5);
      // Late in the warm-up some guests get peckish, so the stands are busy at opening.
      if (!boosted && this.time > -330) {
        boosted = true;
        for (const v of this.visitors) if (this.rng() < 0.3) v.appetite = Math.max(v.appetite, 0.85);
      }
    }
    this.warm = false;
    this.log('Marigold Park is open. Have a great afternoon!', [], { noteworthy: true });
    this.emit('reset');
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  register(e) { this.entities.set(e.id, e); }
  get(id) { return id ? this.entities.get(id) : undefined; }
  retire(v) {
    this.retired.push(v.id);
    if (this.retired.length > 400) {
      const old = this.retired.shift();
      // Keep entities referenced by orders; just drop the oldest anonymous ones.
      if (!this.orders.some((o) => o.visitorId === old)) this.entities.delete(old);
    }
  }

  partyOf(v) { return this.get(v.partyId); }
  sameParty(a, b) {
    const A = this.get(a), B = this.get(b);
    return A && B && A.partyId === B.partyId;
  }
  staffByPost(post) { return this.staff.find((s) => s.post === post); }

  log(text, refs = [], opts = {}) {
    const ev = { seq: ++this.eventSeq, t: this.time, text, refs: refs.filter(Boolean), noteworthy: !!opts.noteworthy, quiet: !!opts.quiet };
    this.events.push(ev);
    if (this.events.length > 900) this.events.splice(0, this.events.length - 900);
    for (const id of ev.refs) {
      const e = this.get(id);
      if (e && e.events) {
        e.events.push(ev);
        if (e.events.length > 40) e.events.shift();
      }
    }
    if (ev.noteworthy && !this.warm) this.emit('event', ev);
    return ev;
  }

  charge(v, amount, source, label) {
    if (amount <= 0) return;
    const amt = Math.min(amount, v.budget - v.spent);
    v.spent += amt;
    if (source.kind === 'ride') this.finance.rides += amt; else this.finance.shops += amt;
    this.finance.transactions.push({ t: this.time, visitorId: v.id, amount: amt, sourceId: source.id, label });
    if (this.finance.transactions.length > 500) this.finance.transactions.shift();
  }

  get revenue() { return this.finance.rides + this.finance.shops; }

  satisfaction() {
    if (!this.visitors.length) return 0;
    let s = 0;
    for (const v of this.visitors) s += v.mood;
    return s / this.visitors.length;
  }

  clock() { return fmtClock(this.time); }

  groundHeight(x, z) {
    // Coaster station platform.
    let h = platform(x, z, -47.2, -20.8, 0.8, 4.8, 0.9, 1.4);
    if (h) return h;
    // Wheel boarding deck (in wheel-local coordinates).
    const dx = x - WHEEL.hub[0], dz = z - WHEEL.hub[2];
    const c = Math.cos(WHEEL.yaw), s = Math.sin(WHEEL.yaw);
    const u = dx * c + dz * s, v = -dx * s + dz * c;
    h = platform(u, v, -3.4, 3.4, -2.4, 4.4, 0.45, 1.4);
    if (h) return h;
    // Carousel platform.
    const cx = x - 36, cz = z - 11;
    const r = Math.hypot(cx, cz);
    if (r < 8.4) return r < 7.4 ? 0.55 : 0.55 * (1 - (r - 7.4) / 1.0);
    return 0;
  }

  addLitter(x, z) {
    let best = null, bd = Infinity;
    for (const s of this.litter) {
      const d = Math.hypot(s.pos[0] - x, s.pos[1] - z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best || bd > 30 || best.items.length >= 8) return;
    const a = this.rng() * Math.PI * 2, r = 0.4 + this.rng() * 2.2;
    best.items.push({ x: best.pos[0] + Math.cos(a) * r, z: best.pos[1] + Math.sin(a) * r, rot: this.rng() * 6, c: Math.floor(this.rng() * 4) });
  }

  spawn(dt) {
    const target = 78 + Math.round(8 * Math.sin(this.time / 900));
    this.spawnTimer -= dt;
    if (this.visitors.length < target && this.spawnTimer <= 0) {
      const party = this.visitors_.createParty('SPAWN');
      this.arrivedTotal += party.members.length;
      party.members.forEach((id, i) => {
        const v = this.get(id);
        v.node = 'SPAWN';
        v.x = NODES.SPAWN[0] + (this.rng() - 0.5) * 3;
        v.z = NODES.SPAWN[1] + i * 0.8;
        this.visitors_.setState(v, 'walking');
        v.dest = { type: 'enter', node: 'ENT', label: 'Arriving at the park' };
        this.visitors_.routeTo(v, 'ENT', 'enter', { delay: i * 0.6 });
      });
      this.spawnTimer = 7 + this.rng() * 8;
    }
  }

  step(dt) {
    this.time += dt;
    this.spawn(dt);
    for (const r of this.rides) r.update(dt);
    this.shops_.update(dt);
    this.visitors_.update(dt);
    this.jobs_.update(dt);
    // Litter nudges nearby guests' mood a little.
    for (const spot of this.litter) {
      if (spot.items.length < 4) continue;
      for (const v of this.visitors) {
        if (Math.abs(v.x - spot.pos[0]) < 6 && Math.abs(v.z - spot.pos[1]) < 6) v.mood = clamp(v.mood - dt * 0.02, 0, 100);
      }
    }
  }

  // Advance by a real-time delta at the given speed multiplier.
  advance(realDt, speed) {
    let dt = Math.min(realDt, 0.1) * TIME_SCALE * speed;
    while (dt > 0) {
      const h = Math.min(dt, 0.25);
      this.step(h);
      dt -= h;
    }
  }

  // ---------------------------------------------------------------- manager
  setRideOpen(ride, open) {
    ride.setOpen(open);
    if (!open) this.visitors_.redirectFrom(ride.id);
  }

  requestMaintenance(ride) {
    const job = this.jobs_.requestMaintenance(ride, 'manager');
    return job;
  }
}

function platform(x, z, x0, x1, z0, z1, h, fall) {
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0;
  const d = Math.hypot(dx, dz);
  if (d >= fall) return 0;
  return h * (1 - d / fall);
}
