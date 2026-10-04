import * as THREE from 'three';
import { NODES, NODE_NAMES, BENCHES } from './layout.js';
import { offsetPath } from './graph.js';
import { FIRST_NAMES, pad, clamp, fmtDuration } from './util.js';
import { QUEUE_SLOT } from './rides.js';

const SHIRTS = [0xe85d4a, 0xf2a93b, 0x4a90d9, 0x5bb98c, 0x9b6bd3, 0xf06ba8, 0x2ec4b6, 0xffd166, 0xef476f, 0x118ab2, 0x8ac926, 0xff924c, 0x6a4c93, 0xffffff, 0x3d5a80, 0xe9c46a];
const PANTS = [0x2b3a55, 0x3f4a5a, 0x6b5b4b, 0x24324a, 0x8c8c8c, 0x4a6670, 0xc2b280, 0x30343f];
const SKIN = [0xf1c8a8, 0xe0ac87, 0xc68863, 0x9d6b4a, 0x6e4a33, 0xf6d5bd];
const HAIR = [0x2a1c14, 0x5a3a22, 0x8a5a2b, 0xd9b26b, 0x1b1b1b, 0xa33b20, 0x777777];

const SCENIC = [
  { node: 'W3', label: 'Lift Hill Lookout' },
  { node: 'N2', label: 'Lakeside Walk' },
  { node: 'P2', label: 'Fountain Plaza' },
  { node: 'E8', label: 'East Promenade' },
];

const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion();

export const MOOD_LABELS = [
  [85, 'Delighted'], [70, 'Happy'], [52, 'Content'], [35, 'Restless'], [0, 'Unhappy'],
];

export class VisitorSystem {
  constructor(sim) {
    this.sim = sim;
    this.benchSeats = {};
    for (const b of BENCHES) this.benchSeats[b.id] = [null, null];
  }

  get rng() {
    return this.sim.rng;
  }

  // ---------------------------------------------------------------- creation
  createParty(atNode, opts = {}) {
    const sim = this.sim, r = this.rng;
    const roll = r();
    let size = roll < 0.3 ? 1 : roll < 0.6 ? 2 : roll < 0.85 ? 3 : 4;
    if (opts.size) size = opts.size;
    const family = size >= 3 && r() < 0.75;
    const party = {
      id: size > 1 ? `F-${pad(++sim.counters.F, 3)}` : `_P${++sim.counters.P}`,
      kind: 'group', members: [], plan: null, hasKids: false,
      label: size === 1 ? 'Solo' : family ? 'Family' : size === 2 ? (r() < 0.5 ? 'Couple' : 'Friends') : 'Friends',
      events: [], planHistory: [], formedAt: sim.time,
    };
    const thrillBase = family ? 0.35 : 0.4 + r() * 0.6;
    for (let i = 0; i < size; i++) {
      const kid = family && i >= 2;
      if (kid) party.hasKids = true;
      const v = {
        id: `G-${pad(++sim.counters.G, 3)}`, kind: 'visitor', name: pickName(r, party),
        partyId: party.id, kid, scale: kid ? 0.66 + r() * 0.08 : 0.92 + r() * 0.16,
        shirt: SHIRTS[Math.floor(r() * SHIRTS.length)], pants: PANTS[Math.floor(r() * PANTS.length)],
        skin: SKIN[Math.floor(r() * SKIN.length)], hair: HAIR[Math.floor(r() * HAIR.length)], hat: r() < 0.22,
        x: 0, y: 0, z: 0, yaw: 0, pose: 'stand', quat: new THREE.Quaternion(), stride: r() * 10, moving: false,
        speed: (kid ? 0.48 : 0.53) * (0.92 + r() * 0.16),
        state: 'idle', stateSince: sim.time, node: atNode, walk: null, dest: null,
        budget: Math.round(kid ? 15 + r() * 15 : 30 + r() * 60), spent: 0,
        prefs: { thrill: clamp(thrillBase + (r() - 0.5) * 0.4, 0, 1), gentle: clamp((family ? 0.75 : 0.45) + (r() - 0.5) * 0.5, 0, 1), snack: 0.3 + r() * 0.7 },
        patience: 0.5 + r() * 1.0, mood: 62 + r() * 18, appetite: r() * 0.45, fatigue: r() * 0.3,
        visited: [], purchases: [], events: [], queueRide: null, queueShop: null, qDist: 0, queueSince: 0,
        seat: null, order: null, arrivedAt: sim.time, stayFor: 1500 + r() * 1800, active: true, item: null,
        laneOff: 0, impatient: false,
      };
      const [nx, nz] = NODES[atNode];
      v.x = nx + (r() - 0.5) * 2;
      v.z = nz + (r() - 0.5) * 2;
      party.members.push(v.id);
      sim.register(v);
      sim.visitors.push(v);
    }
    const base = (r() - 0.5) * 1.4;
    party.members.forEach((id, i) => {
      const v = sim.get(id);
      v.laneOff = clamp(base + (i - (size - 1) / 2) * 0.55, -1.25, 1.25);
    });
    party.speed = Math.min(...party.members.map((id) => sim.get(id).speed));
    sim.register(party);
    sim.parties.push(party);
    return party;
  }

  // ---------------------------------------------------------------- helpers
  moodLabel(v) {
    if (v.impatient) return 'Growing impatient';
    for (const [t, l] of MOOD_LABELS) if (v.mood >= t) return l;
    return 'Unhappy';
  }

  setState(v, s) {
    v.state = s;
    v.stateSince = this.sim.time;
  }

  walkTo(v, pts, purpose, opts = {}) {
    v.walk = { pts, i: 0, purpose, endNode: opts.endNode || null, nodes: opts.nodes || null, data: opts.data || null, delay: opts.delay || 0 };
    v.moving = true;
  }

  routeTo(v, node, purpose, opts = {}) {
    const r = this.sim.graph.route(v.node, node, 'visitor');
    if (!r) return false;
    let pts = r.nodes.map((n) => NODES[n].slice());
    pts = offsetPath(pts, v.laneOff);
    pts.unshift([v.x, v.z]);
    const nodes = [null, ...r.nodes];
    this.walkTo(v, pts, purpose, { ...opts, endNode: node, nodes });
    return true;
  }

  // Advance along walk; returns true on arrival.
  stepWalk(v, dt, speedMul = 1) {
    const w = v.walk;
    if (!w) return true;
    if (w.delay > 0) { w.delay -= dt; v.moving = false; return false; }
    let budget = v.speed * speedMul * dt;
    while (budget > 0 && w.i < w.pts.length) {
      const [tx, tz] = w.pts[w.i];
      const dx = tx - v.x, dz = tz - v.z;
      const d = Math.hypot(dx, dz);
      if (d <= budget) {
        v.x = tx; v.z = tz; budget -= d; v.stride += d; w.i++;
      } else {
        v.x += (dx / d) * budget; v.z += (dz / d) * budget; v.stride += budget;
        const ty = Math.atan2(dx, dz);
        let dy = ty - v.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        v.yaw += dy * Math.min(1, dt * 6);
        budget = 0;
      }
    }
    v.moving = w.i < w.pts.length;
    return w.i >= w.pts.length;
  }

  remainingRoute(v) {
    const pts = [[v.x, v.z]];
    if (v.walk && (v.state !== 'queuing' && v.state !== 'shopQueue')) {
      for (let i = v.walk.i; i < v.walk.pts.length; i++) pts.push(v.walk.pts[i]);
    }
    if (v.state === 'queuing') {
      const ride = this.sim.get(v.queueRide);
      for (const p of ride.lane.slice(v.qDist, 0)) pts.push(p);
      if (ride.rideType === 'coaster') pts.push([-37.6, 4.2], [-36, 2.6]);
      else if (ride.rideType === 'carousel') pts.push(ride.def.gate);
      else pts.push([ride.def.hub[0], ride.def.hub[2]]);
    }
    if (v.state === 'shopQueue') {
      const shop = this.sim.get(v.queueShop);
      for (const p of shop.lane.slice(v.qDist, 0)) pts.push(p);
    }
    return pts;
  }

  // ---------------------------------------------------------------- decisions
  partyReady(party) {
    for (const id of party.members) {
      const v = this.sim.get(id);
      if (!v || !v.active) continue;
      if (v.state !== 'idle' && v.state !== 'waitingGroup') return false;
    }
    return true;
  }

  decide(party) {
    const sim = this.sim, r = this.rng;
    const members = party.members.map((id) => sim.get(id)).filter((v) => v && v.active);
    if (!members.length) return;
    const lead = members[0];
    const from = lead.node;
    const minRemaining = Math.min(...members.map((v) => v.budget - v.spent));
    const avg = (f) => members.reduce((a, v) => a + f(v), 0) / members.length;
    const options = [];
    const timeIn = sim.time - lead.arrivedAt;
    const avgMood = avg((v) => v.mood);

    // Leave?
    if (timeIn > lead.stayFor || minRemaining < 3 || avgMood < 22) {
      options.push({ type: 'leave', node: 'SPAWN', score: 5, label: 'Heading home' });
    }
    for (const ride of sim.rides) {
      if (!ride.canJoin(members.length)) continue;
      if (minRemaining < ride.price) continue;
      let appeal;
      if (ride.rideType === 'coaster') appeal = avg((v) => (v.kid ? 0 : v.prefs.thrill)) * (party.hasKids ? 0.12 : 1.15);
      else if (ride.rideType === 'wheel') appeal = 0.35 + avg((v) => v.prefs.gentle) * 0.55;
      else appeal = avg((v) => v.prefs.gentle) * (party.hasKids ? 1.2 : 0.55);
      const times = lead.visited.filter((x) => x.rideId === ride.id).length;
      appeal *= Math.pow(0.42, times);
      const pf = ride.price / ride.fairPrice;
      const value = ride.price === 0 ? 1.3 : pf <= 1 ? 1 + (1 - pf) * 0.6 : Math.exp(-(pf - 1) * 2.6);
      const wait = ride.estimateWait(ride.queue.length + members.length);
      const tol = avg((v) => v.patience) * 300;
      const wf = Math.exp(-Math.max(0, wait - 90) / tol);
      const route = sim.graph.route(from, ride.def.queueEntryNode, 'visitor');
      const df = 1 / (1 + (route ? route.length : 200) / 160);
      const score = appeal * value * wf * df * (0.65 + r() * 0.7) * 2.2;
      options.push({ type: 'ride', target: ride.id, node: ride.def.queueEntryNode, score, label: `Going to ${ride.name}` });
    }
    const hunger = avg((v) => v.appetite * (0.5 + v.prefs.snack));
    for (const shop of sim.shops) {
      if (!shop.open) continue;
      const avail = shop.products.filter((p) => p.stock > 0 && p.price <= minRemaining);
      if (!avail.length) continue;
      const pf = Math.min(...avail.map((p) => p.price / p.base));
      const value = pf <= 1 ? 1 : Math.exp(-(pf - 1) * 2.2);
      const route = sim.graph.route(from, shop.def.queueNode, 'visitor');
      const df = 1 / (1 + (route ? route.length : 200) / 140);
      const qf = 1 / (1 + shop.queue.length / 6);
      const score = Math.pow(clamp(hunger, 0, 1.5), 1.6) * 2.4 * value * df * qf * (0.7 + r() * 0.6) * (avail.length / shop.products.length + 0.3);
      options.push({ type: 'shop', target: shop.id, node: shop.def.queueNode, score, label: `Getting a snack at ${shop.name}` });
    }
    const tired = avg((v) => v.fatigue);
    options.push({ type: 'rest', node: null, score: tired * tired * 0.9 + 0.02, label: 'Taking a break' });
    const sc = SCENIC[Math.floor(r() * SCENIC.length)];
    if (sc.node !== from) options.push({ type: 'wander', node: sc.node, score: 0.08 + r() * 0.08, label: `Strolling to ${sc.label}` });

    options.sort((a, b) => b.score - a.score);
    let plan = options[0];
    if (plan.type === 'rest') {
      const bench = this.findBench(from, members.length);
      if (!bench) plan = options[1] || { type: 'wander', node: 'P2', label: 'Strolling to Fountain Plaza', score: 0 };
      else { plan.target = bench.id; plan.node = bench.node; plan.label = `Taking a break (bench ${bench.id})`; }
    }
    party.plan = { ...plan, since: sim.time };
    party.planHistory.push({ t: sim.time, label: plan.label });
    if (party.planHistory.length > 12) party.planHistory.shift();
    if (party.members.length > 1) this.sim.log(`Group ${party.id} decided: ${plan.label.toLowerCase()}.`, [party.id, plan.target], { quiet: true });
    members.forEach((v, i) => this.executePlan(v, party, i));
  }

  findBench(nearNode, n) {
    let best = null, bd = Infinity;
    const [nx, nz] = NODES[nearNode];
    for (const b of BENCHES) {
      const free = this.benchSeats[b.id].filter((x) => !x).length;
      if (free < Math.min(2, n)) continue;
      const d = Math.hypot(b.pos[0] - nx, b.pos[1] - nz);
      if (d < bd) { bd = d; best = b; }
    }
    return bd < 90 ? best : null;
  }

  executePlan(v, party, i) {
    const plan = party.plan;
    v.dest = { type: plan.type, id: plan.target || null, node: plan.node, label: plan.label };
    this.setState(v, plan.type === 'leave' ? 'leaving' : 'walking');
    if (v.node === plan.node) {
      v.walk = { pts: [[v.x, v.z]], i: 1, purpose: 'plan', endNode: plan.node, delay: 0 };
      this.arrivePlan(v);
      return;
    }
    if (!this.routeTo(v, plan.node, 'plan', { delay: i * 0.7 })) {
      this.setState(v, 'waitingGroup');
    }
  }

  // ---------------------------------------------------------------- arrivals
  arrivePlan(v) {
    const sim = this.sim;
    const party = sim.get(v.partyId);
    v.node = v.walk.endNode || v.node;
    v.walk = null;
    v.moving = false;
    const plan = party.plan;
    if (!plan) { this.setState(v, 'idle'); return; }
    switch (plan.type) {
      case 'ride': {
        const ride = sim.get(plan.target);
        if (!ride.canJoin(1) || v.budget - v.spent < ride.price) {
          if (!ride.admitting) this.event(v, `Found ${ride.name} closed — choosing somewhere else.`, [ride.id]);
          v.mood -= 3;
          this.setState(v, 'waitingGroup');
          return;
        }
        ride.join(v);
        v.queueRide = ride.id;
        v.qDist = ride.lane.length;
        v.queueSince = sim.time;
        v.impatient = false;
        this.setState(v, 'queuing');
        this.event(v, `Joined the ${ride.name} queue (position ${ride.queue.length}, posted wait ${Math.round(ride.estimateWait(ride.queue.length - 1) / 60)} min).`, [ride.id]);
        return;
      }
      case 'shop': {
        const shop = sim.get(plan.target);
        const product = shop.open ? this.pickProduct(v, shop) : null;
        if (!product) {
          this.setState(v, 'waitingGroup');
          v.walk = null;
          // Wait near the pickup point for the rest of the party.
          const [px, pz] = NODES[shop.def.pickupNode];
          this.walkTo(v, [[px + (this.rng() - 0.5) * 2.5, pz + (this.rng() - 0.5) * 2]], 'stand');
          v.node = shop.def.pickupNode;
          return;
        }
        sim.shops_.joinQueue(v, shop, product);
        return;
      }
      case 'rest': {
        const bench = BENCHES.find((b) => b.id === plan.target);
        const seats = this.benchSeats[bench.id];
        const k = seats.indexOf(null);
        const yaw = bench.yaw;
        if (k >= 0) {
          seats[k] = v.id;
          v.bench = { id: bench.id, seat: k };
          const off = k === 0 ? -0.45 : 0.45;
          const px = bench.pos[0] + Math.cos(yaw) * off, pz = bench.pos[1] - Math.sin(yaw) * off;
          this.walkTo(v, [[px, pz]], 'bench');
        } else {
          this.walkTo(v, [[bench.pos[0] + Math.sin(yaw) * 1.3 + (this.rng() - 0.5), bench.pos[1] + Math.cos(yaw) * 1.3]], 'bench');
        }
        this.setState(v, 'walking');
        return;
      }
      case 'wander': {
        this.setState(v, 'sightseeing');
        v.restUntil = sim.time + 25 + this.rng() * 30;
        this.event(v, `Enjoying the view at ${NODE_NAMES[v.node]}.`);
        const [px, pz] = NODES[v.node];
        this.walkTo(v, [[px + (this.rng() - 0.5) * 4, pz + (this.rng() - 0.5) * 4]], 'stand');
        return;
      }
      case 'leave': {
        this.depart(v);
        return;
      }
      case 'enter': {
        this.setState(v, 'idle');
        return;
      }
    }
  }

  pickProduct(v, shop) {
    const remaining = v.budget - v.spent;
    if (v.appetite < 0.28 && this.rng() < 0.7) return null;
    const opts = shop.products.filter((p) => p.stock - shop.reserved(p.id) > 0 && p.price <= remaining);
    if (!opts.length) return null;
    // Weighted choice: food when hungry, drinks otherwise; cheaper is slightly better.
    const w = opts.map((p) => Math.max(0.05, (p.kind === 'food' ? 0.25 + v.appetite : 0.55) * (1.15 - p.price * 0.03) * (p.price <= p.base ? 1 : Math.exp(-(p.price / p.base - 1) * 2))));
    let r = this.rng() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[opts.length - 1];
  }

  // ---------------------------------------------------------------- ride hooks
  startBoarding(v, ride, veh, seat) {
    this.setState(v, 'boarding');
    v.queueRide = null;
    const pts = [[v.x, v.z], ...ride.boardingPath(veh, seat)];
    this.walkTo(v, pts, 'board', { data: { rideId: ride.id } });
    this.event(v, `Boarding ${ride.name}: ${veh.id}, seat ${seat + 1}. Paid $${ride.price}.`, [ride.id, veh.id]);
    sim_log_vehicle(this.sim, veh, `${v.id} · ${v.name} assigned seat ${seat + 1}.`, [v.id]);
  }

  rideStarted(v, ride) {
    v.rideStart = this.sim.time;
  }

  startUnloading(v, ride) {
    const seat = v.seat;
    const veh = ride.vehicles.find((x) => x.id === seat.vehId);
    this.setState(v, 'unloading');
    v.pose = 'stand';
    const pts = ride.unloadPath(v, veh, seat.seat);
    // Make the first point the actual seat position (no teleport).
    v.x = pts[0][0]; v.z = pts[0][1];
    this.walkTo(v, pts, 'unload', { data: { rideId: ride.id, vehId: veh.id, seat: seat.seat } });
    sim_log_vehicle(this.sim, veh, `${v.id} · ${v.name} left seat ${seat.seat + 1}.`, [v.id]);
    v.lastSeat = { ...seat };
    v.seat = null;
  }

  finishRide(v, ride) {
    const sim = this.sim;
    ride.unloaded(v);
    const pref = ride.rideType === 'coaster' ? v.prefs.thrill : v.prefs.gentle;
    const pf = ride.price / ride.fairPrice;
    const joy = 8 + pref * 16 - Math.max(0, pf - 1.15) * 10;
    v.mood = clamp(v.mood + joy, 0, 100);
    v.visited.push({ rideId: ride.id, t: sim.time, vehId: v.lastSeat && v.lastSeat.vehId });
    v.fatigue = clamp(v.fatigue + 0.08, 0, 1);
    this.event(v, `Finished ${ride.name} (${v.lastSeat ? v.lastSeat.vehId : ''}). ${joy >= 16 ? 'Loved it!' : joy >= 10 ? 'Enjoyed it.' : 'It was okay.'}`, [ride.id, v.lastSeat && v.lastSeat.vehId]);
    v.node = ride.def.exitNode;
    v.walk = null;
    this.setState(v, 'waitingGroup');
  }

  onQueueDispersed(v, ride, reason) {
    v.queueRide = null;
    v.mood = clamp(v.mood - 6, 0, 100);
    this.event(v, `Left the ${ride.name} queue — ${reason}.`, [ride.id]);
    this.exitLane(v, ride.lane, ride.def.queueEntryNode);
  }

  cannotAfford(v, ride) {
    v.queueRide = null;
    v.mood = clamp(v.mood - 5, 0, 100);
    this.event(v, `Left the ${ride.name} queue — the new $${ride.price} ticket is over budget.`, [ride.id]);
    this.exitLane(v, ride.lane, ride.def.queueEntryNode);
  }

  exitLane(v, lane, node) {
    const pts = lane.slice(v.qDist, lane.length);
    this.setState(v, 'walking');
    v.dest = { type: 'regroup', node, label: 'Leaving the queue' };
    this.walkTo(v, pts, 'exitQueue', { endNode: node });
  }

  giveUp(v, ride) {
    const sim = this.sim;
    const party = sim.get(v.partyId);
    const waited = sim.time - v.queueSince;
    const members = party.members.map((id) => sim.get(id)).filter((m) => m && m.active && m.queueRide === ride.id);
    for (const m of members) {
      ride.removeFromQueue(m.id);
      m.queueRide = null;
      m.mood = clamp(m.mood - 9, 0, 100);
      this.event(m, `Gave up waiting for ${ride.name} after ${fmtDuration(waited)}.`, [ride.id]);
      this.exitLane(m, ride.lane, ride.def.queueEntryNode);
    }
    sim.log(`${party.members.length > 1 ? 'Group ' + party.id : v.id + ' · ' + v.name} gave up on the ${ride.name} queue after ${fmtDuration(waited)}.`, [ride.id, party.members.length > 1 ? party.id : v.id], { noteworthy: true });
  }

  depart(v) {
    const sim = this.sim;
    v.active = false;
    v.leftAt = sim.time;
    this.setState(v, 'left');
    v.walk = null;
    v.moving = false;
    this.event(v, `Left the park. Spent $${v.spent}, rode ${v.visited.length} attraction${v.visited.length === 1 ? '' : 's'}.`);
    sim.departed++;
    sim.visitors.splice(sim.visitors.indexOf(v), 1);
    sim.retire(v);
  }

  event(v, text, refs = []) {
    this.sim.log(`${v.id} · ${v.name}: ${text}`, [v.id, ...refs], { quiet: true, actor: v.id });
  }

  // ---------------------------------------------------------------- per-step
  update(dt) {
    const sim = this.sim;
    for (let k = sim.visitors.length - 1; k >= 0; k--) {
      const v = sim.visitors[k];
      if (!v.active) continue;
      this.updateOne(v, dt);
    }
    for (const party of sim.parties) {
      if (party.done) continue;
      const alive = party.members.some((id) => sim.get(id).active);
      if (!alive) { party.done = true; continue; }
      if (this.partyReady(party)) this.decide(party);
    }
  }

  updateOne(v, dt) {
    const sim = this.sim;
    v.appetite = clamp(v.appetite + dt * 0.0014, 0, 1.2);
    v.fatigue = clamp(v.fatigue + dt * 0.0002, 0, 1);
    v.mood += (62 - v.mood) * dt * 0.0006;
    if (v.item && sim.time > v.item.until) {
      v.item = null;
      if (this.rng() < 0.16) sim.addLitter(v.x, v.z);
    }
    switch (v.state) {
      case 'walking':
      case 'leaving': {
        v.pose = 'walk';
        if (this.stepWalk(v, dt, v.walk && v.walk.purpose === 'exitQueue' ? 0.9 : 1)) this.onWalkDone(v);
        break;
      }
      case 'queuing': {
        const ride = sim.get(v.queueRide);
        const idx = ride.queue.indexOf(v.id);
        const target = idx * QUEUE_SLOT;
        const d = target - v.qDist;
        const step = v.speed * 0.75 * dt;
        v.moving = Math.abs(d) > 0.02;
        if (v.moving) {
          const mv = Math.sign(d) * Math.min(Math.abs(d), step);
          const p0 = ride.lane.at(v.qDist);
          v.qDist += mv;
          const p1 = ride.lane.at(v.qDist);
          v.x = p1.x; v.z = p1.z; v.stride += Math.abs(mv);
          if (Math.abs(mv) > 1e-4) v.yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        } else {
          const p1 = ride.lane.at(v.qDist);
          v.x = p1.x; v.z = p1.z;
        }
        v.pose = v.moving ? 'walk' : 'stand';
        const waited = sim.time - v.queueSince;
        const tol = 160 + v.patience * 260;
        v.impatient = waited > tol;
        if (v.impatient) v.mood = clamp(v.mood - dt * 0.03, 0, 100);
        if (waited > tol * 1.55 && ride.estimateWait(idx) > 70 && idx > 2) this.giveUp(v, ride);
        break;
      }
      case 'shopQueue': {
        const shop = sim.get(v.queueShop);
        const idx = shop.queue.indexOf(v.id);
        const target = idx * 0.9;
        const d = target - v.qDist;
        const step = v.speed * 0.75 * dt;
        v.moving = Math.abs(d) > 0.02;
        if (v.moving) {
          const mv = Math.sign(d) * Math.min(Math.abs(d), step);
          v.qDist += mv;
          v.stride += Math.abs(mv);
        }
        const p1 = shop.lane.at(v.qDist);
        v.x = p1.x; v.z = p1.z;
        v.yaw = shop.def.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
        v.pose = v.moving ? 'walk' : 'stand';
        const waited = sim.time - v.queueSince;
        const tol = 120 + v.patience * 200;
        v.impatient = waited > tol;
        if (v.impatient) v.mood = clamp(v.mood - dt * 0.03, 0, 100);
        if (waited > tol * 1.5 && (idx > 0 || shop.blocked)) sim.shops_.giveUp(v, shop, shop.blocked ? 'everything was sold out' : 'the line was too slow');
        break;
      }
      case 'ordering': {
        v.pose = 'stand';
        v.moving = false;
        break;
      }
      case 'boarding': {
        v.pose = 'walk';
        if (this.stepWalk(v, dt, 0.85)) {
          const ride = sim.get(v.seat.rideId);
          ride.seated(v);
          this.setState(v, 'riding');
          v.pose = 'ride';
          v.walk = null;
          v.moving = false;
          this.event(v, `Seated in ${v.seat.vehId}, seat ${v.seat.seat + 1}.`, [ride.id, v.seat.vehId]);
        }
        break;
      }
      case 'riding': {
        const ride = sim.get(v.seat.rideId);
        ride.seatPose(v.seat.vehId, v.seat.seat, _pos, _quat);
        v.x = _pos.x; v.y = _pos.y; v.z = _pos.z;
        v.quat.copy(_quat);
        v.pose = 'ride';
        v.fatigue = clamp(v.fatigue - dt * 0.0004, 0, 1);
        break;
      }
      case 'unloading': {
        v.pose = 'walk';
        if (this.stepWalk(v, dt, 0.85)) this.finishRide(v, sim.get(v.walk.data.rideId));
        break;
      }
      case 'resting': {
        v.fatigue = clamp(v.fatigue - dt * 0.006, 0, 1);
        v.mood = clamp(v.mood + dt * 0.02, 0, 100);
        if (sim.time > v.restUntil) {
          if (v.bench) { this.benchSeats[v.bench.id][v.bench.seat] = null; v.bench = null; }
          v.pose = 'stand';
          this.setState(v, 'waitingGroup');
        }
        break;
      }
      case 'sightseeing': {
        if (v.walk) {
          v.pose = 'walk';
          if (this.stepWalk(v, dt, 0.6)) { v.walk = null; v.moving = false; }
        } else v.pose = 'stand';
        v.mood = clamp(v.mood + dt * 0.01, 0, 100);
        if (sim.time > v.restUntil) this.setState(v, 'waitingGroup');
        break;
      }
      case 'waitingGroup':
      case 'idle': {
        if (v.walk) {
          v.pose = 'walk';
          if (this.stepWalk(v, dt, 0.7)) { v.walk = null; v.moving = false; }
        } else {
          v.pose = 'stand';
          v.moving = false;
        }
        break;
      }
    }
    if (v.state !== 'riding') {
      v.y = sim.groundHeight(v.x, v.z);
    }
  }

  onWalkDone(v) {
    const w = v.walk;
    switch (w.purpose) {
      case 'plan':
        this.arrivePlan(v);
        break;
      case 'exitQueue':
      case 'stop':
        v.node = w.endNode || v.node;
        v.walk = null;
        v.moving = false;
        this.setState(v, 'waitingGroup');
        break;
      case 'bench': {
        v.walk = null;
        v.moving = false;
        this.setState(v, 'resting');
        v.restUntil = this.sim.time + 35 + this.rng() * 45;
        if (v.bench) {
          const b = BENCHES.find((x) => x.id === v.bench.id);
          v.yaw = b.yaw;
          v.pose = 'sit';
        }
        this.event(v, `Resting on bench ${v.dest && v.dest.id ? v.dest.id : ''} at ${NODE_NAMES[v.node]}.`);
        break;
      }
      case 'pickup':
        v.node = w.endNode;
        v.walk = null;
        v.moving = false;
        this.setState(v, 'waitingGroup');
        break;
      case 'enter':
        v.node = w.endNode;
        v.walk = null;
        v.moving = false;
        this.setState(v, 'idle');
        this.event(v, 'Entered Marigold Park.');
        break;
      default:
        v.walk = null;
        v.moving = false;
        this.setState(v, 'waitingGroup');
    }
  }

  // Redirect visitors heading to an attraction that stopped admitting.
  redirectFrom(targetId) {
    const sim = this.sim;
    for (const v of sim.visitors) {
      if (v.state !== 'walking' || !v.walk || v.walk.purpose !== 'plan' || !v.dest || v.dest.id !== targetId) continue;
      const w = v.walk;
      // Continue to the next graph node, then rethink.
      let k = w.i;
      while (k < w.pts.length && (!w.nodes || !w.nodes[k])) k++;
      if (k >= w.pts.length) continue;
      w.pts.length = k + 1;
      w.purpose = 'stop';
      w.endNode = w.nodes[k];
      v.dest = { type: 'regroup', node: w.endNode, label: 'Changing plans' };
      this.event(v, `Changed plans — ${sim.get(targetId).name} is no longer admitting guests.`, [targetId]);
    }
  }

  activity(v) {
    const sim = this.sim;
    switch (v.state) {
      case 'walking':
        if (v.walk && v.walk.purpose === 'exitQueue') return 'Leaving the queue';
        if (v.walk && v.walk.purpose === 'bench') return 'Looking for a seat';
        if (v.walk && v.walk.purpose === 'pickup') return 'Walking away with a snack';
        if (v.walk && v.walk.purpose === 'enter') return 'Arriving at the park';
        if (v.walk && v.walk.purpose === 'stop') return 'Changing plans';
        return v.dest ? v.dest.label : 'Walking';
      case 'leaving': return 'Heading to the exit';
      case 'queuing': return `Waiting for ${sim.get(v.queueRide).name}`;
      case 'boarding': return `Boarding ${sim.get(v.seat.rideId).name}`;
      case 'riding': {
        const ride = sim.get(v.seat.rideId);
        if (ride.rideType === 'coaster' && ride.phase !== 'running') return `Seated on ${ride.name}, waiting for dispatch`;
        if (ride.rideType === 'carousel' && ride.phase !== 'running') return `On ${ride.name}, waiting to start`;
        return `Riding ${ride.name}`;
      }
      case 'unloading': return `Leaving ${sim.get(v.walk.data.rideId).name}`;
      case 'shopQueue': return `Queuing at ${sim.get(v.queueShop).name}`;
      case 'ordering': {
        const o = sim.get(v.order);
        return o ? `Waiting for ${o.item.toLowerCase()} (${o.status})` : 'Ordering';
      }
      case 'resting': return v.bench ? 'Resting on a bench' : 'Taking a break';
      case 'sightseeing': return `Enjoying the view`;
      case 'waitingGroup': {
        const party = sim.get(v.partyId);
        if (party.members.length > 1) {
          const others = party.members.map((id) => sim.get(id)).filter((m) => m.id !== v.id && m.active && m.state !== 'waitingGroup' && m.state !== 'idle');
          if (others.length) return `Waiting for ${others.map((m) => m.name).join(' & ')}`;
        }
        return 'Deciding where to go';
      }
      case 'left': return 'Left the park';
      default: return 'Deciding where to go';
    }
  }

  activityKey(v) {
    switch (v.state) {
      case 'queuing': return 'queuing';
      case 'boarding': case 'riding': case 'unloading': return 'riding';
      case 'shopQueue': case 'ordering': return 'shopping';
      case 'resting': case 'sightseeing': return 'resting';
      case 'leaving': return 'leaving';
      case 'left': return 'left';
      case 'waitingGroup': case 'idle': return 'waiting';
      default: return 'walking';
    }
  }
}

function pickName(r, party) {
  for (let k = 0; k < 20; k++) {
    const n = FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)];
    if (!party.names || !party.names.includes(n)) { (party.names ||= []).push(n); return n; }
  }
  return FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)];
}

function sim_log_vehicle(sim, veh, text, refs) {
  veh.events.push({ t: sim.time, text, refs });
  if (veh.events.length > 30) veh.events.shift();
}
