import { NODES, NODE_NAMES, DEPOT, LITTER_SPOTS, COASTER, WHEEL, CAROUSEL, SHOPS } from './layout.js';
import { pad, clamp } from './util.js';

export const ROLE_LABEL = {
  attendant: 'Ride attendant', shop: 'Shop worker', mechanic: 'Mechanic', cleaner: 'Cleaner', delivery: 'Delivery driver',
};

const STAFF_DEFS = [
  { id: 'S-001', name: 'Ana', role: 'attendant', post: 'R-01', pos: COASTER.attendantPos, color: 0xd6403a },
  { id: 'S-002', name: 'Marco', role: 'attendant', post: 'R-02', pos: WHEEL.attendantPos, color: 0x3b8fd9 },
  { id: 'S-003', name: 'Priya', role: 'attendant', post: 'R-03', pos: CAROUSEL.attendantPos, color: 0xe0a526 },
  { id: 'S-004', name: 'Jun', role: 'shop', post: 'K-01', pos: SHOPS[0].workerPos, color: 0xf06c8b },
  { id: 'S-005', name: 'Bella', role: 'shop', post: 'K-02', pos: SHOPS[1].workerPos, color: 0x2f7fd0 },
  { id: 'S-006', name: 'Tomas', role: 'cleaner', home: 'P2', color: 0x3fa66b },
  { id: 'S-007', name: 'Dana', role: 'mechanic', home: 'DEPOT', color: 0xf07f22 },
  { id: 'S-008', name: 'Viktor', role: 'delivery', home: 'DEPOT', color: 0x8a6a3c },
  { id: 'S-009', name: 'Lea', role: 'cleaner', home: 'E7', color: 0x3fa66b },
];

const PATROL = {
  'S-006': ['P2', 'P4', 'CQE', 'W2', 'CX', 'W3', 'CX', 'W2', 'K1X', 'P3', 'B1', 'ENT', 'B1', 'P2'],
  'S-009': ['E7', 'E8', 'E3', 'WX', 'E3', 'E2', 'P7', 'P6', 'N1', 'N2', 'WQE', 'E2', 'P0', 'E1', 'E7', 'K2X', 'P1', 'P0'],
};

export class JobSystem {
  constructor(sim) {
    this.sim = sim;
  }

  create() {
    const sim = this.sim;
    for (const d of STAFF_DEFS) {
      const s = {
        id: d.id, kind: 'staff', name: d.name, role: d.role, roleLabel: ROLE_LABEL[d.role], post: d.post || null,
        x: 0, y: 0, z: 0, yaw: 0, pose: 'stand', stride: 0, moving: false, speed: 0.5, shirt: d.color,
        node: d.home || null, home: d.home || null, walk: null, jobId: null, state: 'available', status: 'Available',
        history: [], events: [], patrolIdx: 0, wait: 0, workAnim: 0,
      };
      if (d.pos) { s.x = d.pos[0]; s.z = d.pos[1]; s.state = 'onPost'; }
      else { const p = NODES[d.home]; s.x = p[0] + 1; s.z = p[1] + 1; }
      if (d.role === 'mechanic') { s.x = DEPOT.pos[0] - 3; s.z = DEPOT.pos[1] + 3.5; }
      if (d.role === 'delivery') { s.x = DEPOT.cartHome[0] + 1.2; s.z = DEPOT.cartHome[1] + 1.4; }
      sim.register(s);
      sim.staff.push(s);
      if (d.role === 'shop') sim.get(d.post).workerId = s.id;
      if (d.role === 'attendant') { const r = sim.get(d.post); r.attendantId = s.id; s.yaw = Math.PI; }
      if (d.role === 'shop') s.yaw = sim.get(d.post).def.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const cart = {
      id: 'V-01', kind: 'cart', name: 'Delivery cart V-01', x: DEPOT.cartHome[0], z: DEPOT.cartHome[1], y: 0, yaw: Math.PI,
      speed: 1.05, walk: null, cargo: null, driver: null, state: 'parked', node: 'DEPOT', events: [], stride: 0, moving: false,
    };
    sim.register(cart);
    sim.cart = cart;
    sim.litter = LITTER_SPOTS.map((l) => ({ ...l, items: [], jobId: null }));
  }

  newJob(type, targetId, title, opts = {}) {
    const sim = this.sim;
    const job = {
      id: `J-${pad(++sim.counters.J, 3)}`, kind: 'job', type, targetId, title, status: 'pending', priority: opts.priority || 'normal',
      assignedTo: null, reservedFor: null, progress: 0, createdAt: sim.time, startedAt: null, completedAt: null, events: [], source: opts.source || 'auto',
      role: type === 'maintenance' ? 'mechanic' : type === 'delivery' ? 'delivery' : 'cleaner', stage: 'Waiting for an available worker',
    };
    sim.register(job);
    sim.jobs.push(job);
    return job;
  }

  requestMaintenance(ride, source = 'auto') {
    const sim = this.sim;
    if (ride.maint) return null;
    const job = this.newJob('maintenance', ride.id, `Maintenance · ${ride.name}`, { source, priority: source === 'manager' ? 'high' : 'normal' });
    ride.maint = { jobId: job.id, stage: 'requested' };
    sim.log(source === 'manager'
      ? `Park manager requested maintenance for ${ride.name} (${job.id}).`
      : `${ride.name} requested maintenance (${job.id}) — condition ${Math.round(ride.condition)}%.`, [ride.id, job.id], { noteworthy: true });
    return job;
  }

  requestDelivery(shop) {
    const sim = this.sim;
    const items = [];
    for (const p of shop.products) {
      if (p.stock < p.max * 0.8) items.push({ productId: p.id, name: p.name, qty: p.max - p.stock });
    }
    if (!items.length) return null;
    const d = {
      id: `D-${pad(++sim.counters.D, 3)}`, kind: 'delivery', shopId: shop.id, origin: 'DEPOT', items, status: 'requested',
      createdAt: sim.time, jobId: null, workerId: null, cartId: null, events: [], deliveredAt: null,
    };
    sim.register(d);
    sim.deliveries.push(d);
    const job = this.newJob('delivery', d.id, `Deliver ${d.id} to ${shop.name}`);
    d.jobId = job.id;
    shop.replenish = d.id;
    sim.log(`Shop ${shop.id} ${shop.name} requested replenishment — delivery ${d.id} created (${items.map((i) => i.qty + '× ' + i.name.toLowerCase()).join(', ')}).`, [shop.id, d.id, job.id], { noteworthy: true });
    return d;
  }

  requestCleaning(spot) {
    const job = this.newJob('cleaning', spot.id, `Clean up · ${spot.name}`);
    spot.jobId = job.id;
    this.sim.log(`Litter reported at ${spot.name} — cleaning job ${job.id} created.`, [job.id], { quiet: true });
    return job;
  }

  // Manager actions -------------------------------------------------------
  prioritize(job) {
    if (job.status !== 'pending') return;
    job.priority = 'high';
    this.sim.log(`${job.id} marked high priority by the park manager.`, [job.id], { noteworthy: true });
  }

  assign(job, staff) {
    if (job.status !== 'pending' || staff.role !== job.role) return false;
    job.reservedFor = staff.id;
    job.priority = 'high';
    this.sim.log(`${job.id} assigned to ${staff.roleLabel.toLowerCase()} ${staff.id} · ${staff.name} by the park manager.`, [job.id, staff.id], { noteworthy: true });
    return true;
  }

  pendingFor(role) {
    return this.sim.jobs.filter((j) => j.status === 'pending' && j.role === role)
      .sort((a, b) => (b.priority === 'high') - (a.priority === 'high') || a.createdAt - b.createdAt);
  }

  nextJobFor(s) {
    const list = this.pendingFor(s.role).filter((j) => !j.reservedFor || j.reservedFor === s.id);
    // Reserved jobs first.
    list.sort((a, b) => (b.reservedFor === s.id) - (a.reservedFor === s.id));
    return list[0] || null;
  }

  // Movement --------------------------------------------------------------
  route(s, node, purpose, mode = 'staff') {
    const sim = this.sim;
    let from = s.node || sim.graph.nearest(s.x, s.z, 'staff');
    const r = sim.graph.route(from, node, mode);
    if (!r) return false;
    const pts = r.nodes.map((n) => NODES[n].slice());
    pts.unshift([s.x, s.z]);
    s.walk = { pts, i: 0, purpose, endNode: node, delay: 0 };
    s.moving = true;
    return true;
  }

  stepWalk(e, dt, mul = 1) {
    return this.sim.visitors_.stepWalk(e, dt, mul);
  }

  // Per-step --------------------------------------------------------------
  update(dt) {
    const sim = this.sim;
    for (const s of sim.staff) {
      switch (s.role) {
        case 'attendant': this.updateAttendant(s, dt); break;
        case 'shop': this.updateShopWorker(s, dt); break;
        case 'mechanic': this.updateMechanic(s, dt); break;
        case 'cleaner': this.updateCleaner(s, dt); break;
        case 'delivery': this.updateDelivery(s, dt); break;
      }
      if (s.pose !== 'sit') s.y = sim.groundHeight(s.x, s.z);
    }
    // Cleaning requests.
    for (const spot of sim.litter) {
      if (!spot.jobId && spot.items.length >= 4) this.requestCleaning(spot);
    }
  }

  updateAttendant(s, dt) {
    const ride = this.sim.get(s.post);
    s.pose = 'stand';
    s.moving = false;
    s.status = ride.statusKey() === 'maintenance' ? `Assisting the mechanic at ${ride.name}` : `Operating ${ride.name} · ${ride.phaseLabel()}`;
    s.progress = ride.cycleProgress();
    s.workAnim += dt;
  }

  updateShopWorker(s, dt) {
    const shop = this.sim.get(s.post);
    s.moving = false;
    s.pose = 'stand';
    if (!shop.open) s.status = 'Shop closed';
    else if (shop.current) s.status = `Preparing order ${shop.current}`;
    else if (shop.blocked) s.status = `Sold out — waiting for delivery ${shop.replenish || ''}`.trim();
    else s.status = shop.queue.length ? 'Taking the next order' : 'Waiting for customers';
    s.progress = shop.current ? shop.prepProgress : 0;
    s.workAnim += shop.current ? dt : 0;
  }

  takeJob(s, job) {
    const sim = this.sim;
    job.status = 'travelling';
    job.assignedTo = s.id;
    job.startedAt = sim.time;
    s.jobId = job.id;
    s.state = 'travelling';
    sim.log(`${s.roleLabel} ${s.id} · ${s.name} accepted ${job.id} (${job.title}).`, [s.id, job.id, job.targetId], { noteworthy: job.type !== 'cleaning' });
  }

  finishJob(s, job, text) {
    const sim = this.sim;
    job.status = 'completed';
    job.progress = 1;
    job.completedAt = sim.time;
    job.stage = 'Completed';
    s.history.unshift({ jobId: job.id, title: job.title, t: sim.time, duration: sim.time - job.startedAt });
    if (s.history.length > 8) s.history.pop();
    s.jobId = null;
    sim.log(text, [s.id, job.id, job.targetId], { noteworthy: job.type !== 'cleaning' });
  }

  // Mechanic ------------------------------------------------------------
  updateMechanic(s, dt) {
    const sim = this.sim;
    const job = s.jobId ? sim.get(s.jobId) : null;
    if (!job) {
      const next = this.nextJobFor(s);
      if (next) {
        const ride = sim.get(next.targetId);
        this.takeJob(s, next);
        this.route(s, ride.def.maintNode, 'job');
        next.stage = `Travelling to ${ride.name}`;
        return;
      }
      if (s.node !== 'DEPOT' && !s.walk) { this.route(s, 'DEPOT', 'home'); s.state = 'returning'; }
      if (s.walk) {
        s.pose = 'walk';
        s.status = 'Returning to the workshop';
        if (this.stepWalk(s, dt)) { s.node = s.walk.endNode; s.walk = null; s.state = 'available'; }
      } else {
        s.state = 'available'; s.status = 'Available at the workshop'; s.pose = 'stand'; s.moving = false;
      }
      s.progress = 0;
      return;
    }
    const ride = sim.get(job.targetId);
    if (job.status === 'travelling') {
      s.pose = 'walk';
      s.status = `Travelling to ${ride.name}`;
      job.stage = s.status;
      if (this.stepWalk(s, dt)) {
        s.node = s.walk.endNode; s.walk = null; s.moving = false;
        job.status = 'waiting';
        sim.log(`Mechanic ${s.id} · ${s.name} arrived at ${ride.name}.`, [s.id, job.id, ride.id]);
        ride.onMechanicArrived();
      }
      s.progress = 0;
    } else if (job.status === 'waiting') {
      s.pose = 'stand';
      s.moving = false;
      s.status = `Waiting for ${ride.name} to clear`;
      job.stage = s.status;
      if (ride.readyForMaintenance()) {
        job.status = 'working';
        job.workStart = sim.time;
        ride.maint.stage = 'inProgress';
        sim.log(`Mechanic ${s.id} · ${s.name} started maintenance on ${ride.name}.`, [s.id, job.id, ride.id], { noteworthy: true });
      }
    } else if (job.status === 'working') {
      s.pose = 'work';
      s.workAnim += dt;
      job.progress = clamp((sim.time - job.workStart) / 55, 0, 1);
      s.progress = job.progress;
      s.status = `Servicing ${ride.name}`;
      job.stage = `Servicing · ${Math.round(job.progress * 100)}%`;
      if (job.progress >= 1) {
        ride.completeMaintenance();
        this.finishJob(s, job, `Mechanic ${s.id} · ${s.name} completed ${job.id} at ${ride.name}.`);
        s.state = 'available';
      }
    }
  }

  // Cleaner ---------------------------------------------------------------
  updateCleaner(s, dt) {
    const sim = this.sim;
    const job = s.jobId ? sim.get(s.jobId) : null;
    if (!job) {
      const next = this.nextJobFor(s);
      if (next) {
        const spot = sim.litter.find((l) => l.id === next.targetId);
        this.takeJob(s, next);
        this.route(s, spot.node, 'job');
        s.walk.pts.push(spot.pos.slice());
        next.stage = `Travelling to ${spot.name}`;
        return;
      }
      s.state = 'patrolling';
      s.status = 'Patrolling for litter';
      s.progress = 0;
      if (!s.walk) {
        const loop = PATROL[s.id];
        s.patrolIdx = (s.patrolIdx + 1) % loop.length;
        if (!this.route(s, loop[s.patrolIdx], 'patrol')) s.walk = null;
      }
      if (s.walk) {
        s.pose = 'walk';
        if (this.stepWalk(s, dt, 0.7)) { s.node = s.walk.endNode; s.walk = null; }
      }
      return;
    }
    const spot = sim.litter.find((l) => l.id === job.targetId);
    if (job.status === 'travelling') {
      s.pose = 'walk';
      s.status = `Heading to ${spot.name}`;
      job.stage = s.status;
      if (this.stepWalk(s, dt)) {
        s.node = s.walk.endNode; s.walk = null; s.moving = false;
        job.status = 'working';
        job.workStart = sim.time;
        job.total = Math.max(1, spot.items.length);
        sim.log(`Cleaner ${s.id} · ${s.name} started cleaning ${spot.name}.`, [s.id, job.id], { quiet: true });
      }
    } else if (job.status === 'working') {
      s.pose = 'sweep';
      s.workAnim += dt;
      s.status = `Cleaning ${spot.name}`;
      const per = 3.5;
      const elapsed = sim.time - job.workStart;
      const toRemove = Math.floor(elapsed / per);
      while (spot.items.length && job.total - spot.items.length < toRemove) spot.items.shift();
      job.progress = clamp(elapsed / (per * job.total + 1), 0, 1);
      s.progress = job.progress;
      job.stage = `Sweeping · ${Math.round(job.progress * 100)}%`;
      if (!spot.items.length && elapsed > per * job.total) {
        spot.jobId = null;
        this.finishJob(s, job, `Cleaner ${s.id} · ${s.name} finished cleaning ${spot.name} (${job.total} pieces of litter).`);
        s.state = 'patrolling';
      }
    }
  }

  // Delivery driver + cart ------------------------------------------------
  updateDelivery(s, dt) {
    const sim = this.sim;
    const cart = sim.cart;
    const job = s.jobId ? sim.get(s.jobId) : null;
    const seat = () => {
      s.x = cart.x - Math.sin(cart.yaw) * 0.25 + Math.cos(cart.yaw) * 0.3;
      s.z = cart.z - Math.cos(cart.yaw) * 0.25 - Math.sin(cart.yaw) * 0.3;
      s.yaw = cart.yaw;
      s.pose = 'sit';
      s.y = 0.12;
      s.moving = false;
    };
    const standBy = () => {
      s.x = cart.x + Math.cos(cart.yaw) * 1.25 + Math.sin(cart.yaw) * -0.9;
      s.z = cart.z - Math.sin(cart.yaw) * 1.25 + Math.cos(cart.yaw) * -0.9;
      s.yaw = cart.yaw - Math.PI / 2;
      s.pose = 'carry';
      s.moving = false;
    };
    if (!job) {
      // Returning with the empty cart, or idle at the depot.
      if (cart.walk) {
        cart.state = 'moving';
        if (this.stepWalk(cart, dt)) { cart.node = cart.walk.endNode; cart.walk = null; cart.state = 'parked'; cart.driver = null; }
        seat();
        s.state = 'returning';
        s.status = 'Driving back to the depot';
        s.node = cart.node;
        return;
      }
      const next = this.nextJobFor(s);
      if (next && cart.node === 'DEPOT') {
        const d = sim.get(next.targetId);
        this.takeJob(s, next);
        next.status = 'loading';
        next.workStart = sim.time;
        d.status = 'loading';
        d.workerId = s.id;
        d.cartId = cart.id;
        cart.cargo = d.id;
        sim.log(`Delivery ${d.id} is being loaded onto cart ${cart.id} at the depot.`, [d.id, cart.id, s.id], { quiet: true });
        return;
      }
      s.state = 'available';
      s.status = 'Available at the depot';
      s.progress = 0;
      s.pose = 'stand';
      s.moving = false;
      s.x = DEPOT.cartHome[0] + 1.6; s.z = DEPOT.cartHome[1] + 1.2; s.yaw = -Math.PI / 2;
      return;
    }
    const d = sim.get(job.targetId);
    const shop = sim.get(d.shopId);
    if (job.status === 'loading') {
      standBy();
      s.workAnim += dt;
      job.progress = clamp((sim.time - job.workStart) / 18, 0, 1) * 0.2;
      s.progress = job.progress / 0.2;
      s.status = `Loading ${d.id} at the depot`;
      job.stage = s.status;
      if (sim.time - job.workStart >= 18) {
        job.status = 'travelling';
        d.status = 'in transit';
        cart.driver = s.id;
        const r = sim.graph.route(cart.node, shop.def.serviceNode, 'cart');
        cart.walk = { pts: [[cart.x, cart.z], ...r.nodes.slice(1).map((n) => NODES[n].slice())], i: 0, endNode: shop.def.serviceNode, delay: 0 };
        job.routeLen = r.length;
        sim.log(`Delivery ${d.id} departed the depot for ${shop.name} on cart ${cart.id}.`, [d.id, shop.id, s.id, cart.id], { noteworthy: true });
      }
    } else if (job.status === 'travelling') {
      cart.state = 'moving';
      const arrived = this.stepWalk(cart, dt);
      seat();
      const left = cart.walk ? remainingLen(cart) : 0;
      job.progress = 0.2 + 0.55 * clamp(1 - left / (job.routeLen || 1), 0, 1);
      s.progress = clamp(1 - left / (job.routeLen || 1), 0, 1);
      s.status = `Driving ${d.id} to ${shop.name}`;
      job.stage = `In transit · ${Math.round(left)} m to go`;
      if (arrived) {
        cart.node = cart.walk.endNode; cart.walk = null; cart.state = 'parked';
        job.status = 'unloading';
        job.workStart = sim.time;
        d.status = 'unloading';
        d.arrivedAt = sim.time;
        sim.log(`Delivery ${d.id} arrived at ${shop.name}.`, [d.id, shop.id, s.id], { noteworthy: true });
      }
    } else if (job.status === 'unloading') {
      standBy();
      s.workAnim += dt;
      const k = clamp((sim.time - job.workStart) / 14, 0, 1);
      job.progress = 0.75 + 0.25 * k;
      s.progress = k;
      s.status = `Unloading ${d.id} at ${shop.name}`;
      job.stage = s.status;
      if (k >= 1) {
        if (cart.node !== shop.def.serviceNode) throw new Error('Delivery at wrong shop');
        sim.shops_.restock(shop, d);
        d.status = 'delivered';
        d.deliveredAt = sim.time;
        cart.cargo = null;
        this.finishJob(s, job, `Delivery driver ${s.id} · ${s.name} completed ${job.id}: ${d.id} delivered to ${shop.name}.`);
        // Drive back.
        const r = sim.graph.route(cart.node, 'DEPOT', 'cart');
        cart.walk = { pts: [[cart.x, cart.z], ...r.nodes.slice(1).map((n) => NODES[n].slice()), DEPOT.cartHome.slice()], i: 0, endNode: 'DEPOT', delay: 0 };
      }
    }
  }
}

function remainingLen(e) {
  const w = e.walk;
  let L = 0, px = e.x, pz = e.z;
  for (let i = w.i; i < w.pts.length; i++) {
    L += Math.hypot(w.pts[i][0] - px, w.pts[i][1] - pz);
    px = w.pts[i][0]; pz = w.pts[i][1];
  }
  return L;
}

export { NODE_NAMES };
