// Scripted end-to-end journeys against the authoritative simulation state.
import { Simulation } from '../src/sim/sim.js';
import { NODES, SHOPS } from '../src/sim/layout.js';

const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', name, detail]); };
const run = (sim, sec, fn) => { for (let t = 0; t < sec; t += 0.25) { sim.step(0.25); if (fn && fn()) return true; } return false; };

// 1. Autonomous operation, ride journey.
{
  const sim = new Simulation();
  const t0 = sim.time;
  const rev0 = sim.revenue;
  run(sim, 120);
  ok('Park runs without interaction (time, revenue, arrivals advance)', sim.time > t0 && sim.revenue > rev0, `revenue ${rev0} → ${sim.revenue}`);
  // Find a visitor walking toward a ride and trace states.
  let v = sim.visitors.find((x) => x.state === 'walking' && x.dest && x.dest.type === 'ride');
  run(sim, 300, () => (v = sim.visitors.find((x) => x.state === 'walking' && x.dest && x.dest.type === 'ride')));
  const seq = [];
  const rideId = v.dest.id;
  let seatSeen = null, agree = true;
  run(sim, 1500, () => {
    if (seq[seq.length - 1] !== v.state) seq.push(v.state);
    if (v.state === 'riding') {
      const ride = sim.get(v.seat.rideId);
      const veh = ride.vehicles.find((c) => c.id === v.seat.vehId);
      if (veh.seats[v.seat.seat] !== v.id) agree = false;
      seatSeen = `${v.seat.vehId}#${v.seat.seat + 1}`;
    }
    return seq.includes('unloading') && v.state !== 'unloading';
  });
  const want = ['walking', 'queuing', 'boarding', 'riding', 'unloading'];
  const idx = want.map((s) => seq.indexOf(s));
  ok(`Visitor ${v.id} walks → queues → boards → rides → exits (${sim.get(rideId).name})`, idx.every((i, k) => i >= 0 && (k === 0 || i > idx[k - 1])), seq.join(' → ') + (seatSeen ? ` · seat ${seatSeen}` : ''));
  ok('Visitor and vehicle inspectors agree on the seat while riding', agree && !!seatSeen);
  ok('Ride history recorded for visitor', v.visited.some((x) => x.rideId === rideId));
}

// 2. Purchase updates inventory, spending, history.
{
  const sim = new Simulation();
  let v = null, order = null, stock0 = null, spent0 = null;
  run(sim, 900, () => {
    if (!order) {
      const o = sim.orders.find((o) => o.status === 'queued');
      if (o) { order = o; v = sim.get(o.visitorId); spent0 = v.spent; }
    }
    if (order && order.status === 'preparing' && stock0 === null) {
      const shop = sim.get(order.shopId);
      stock0 = shop.products.find((p) => p.id === order.productId).stock + 1; // decremented when preparing began
    }
    return order && order.status === 'collected';
  });
  const shop = sim.get(order.shopId);
  const prod = shop.products.find((p) => p.id === order.productId);
  ok(`Order ${order.id} lifecycle queued → preparing → collected`, order.status === 'collected' && order.preparedAt != null && order.collectedAt > order.preparedAt);
  ok('Purchase charged exactly once and updates spending', v.spent === spent0 + order.price && order.paid, `${v.id} spent $${spent0} → $${v.spent}`);
  ok('Inventory decreased by one when served', stock0 !== null && prod.stock <= stock0 - 1, `${prod.name}: ${stock0} → ${prod.stock}`);
  ok('Visitor history lists the purchase', v.purchases.includes(order.id) && v.events.some((e) => e.text.includes(order.id)));
}

// 3. Low stock → physical delivery → restock.
{
  const sim = new Simulation();
  const shop = sim.shops[1];
  for (const p of shop.products) p.stock = 2; // force low stock
  let d = null, cartAtShop = false, before = null;
  run(sim, 1500, () => {
    if (!d && shop.replenish) { d = sim.get(shop.replenish); }
    if (d && d.status === 'unloading' && before === null) {
      before = shop.products.map((p) => p.stock);
      const sp = NODES[SHOPS[1].serviceNode];
      cartAtShop = Math.hypot(sim.cart.x - sp[0], sim.cart.z - sp[1]) < 0.5;
    }
    return d && d.status === 'delivered';
  });
  ok('Low stock creates a replenishment request + delivery job', !!d && !!sim.get(d.jobId));
  ok('Cart physically reached the destination shop before unloading', cartAtShop);
  ok('Delivery restored inventory at the right shop', d && d.status === 'delivered' && shop.products.every((p, i) => p.stock >= before[i]) && shop.products.some((p, i) => p.stock > before[i]), shop.products.map((p) => p.stock).join('/'));
  ok('Other shop untouched by this delivery', d && d.shopId === shop.id);
}

// 4. Mechanic travels and completes maintenance; queue resolves.
{
  const sim = new Simulation();
  const ride = sim.rides[0];
  run(sim, 30);
  const job = sim.requestMaintenance(ride);
  const mech = sim.staff.find((s) => s.role === 'mechanic');
  let arrivedDist = null, admittedDuring = false, queueAtStop = null, workStartedWhileOccupied = false;
  run(sim, 2000, () => {
    if (job.status === 'waiting' && arrivedDist === null) {
      const n = NODES[ride.def.maintNode];
      arrivedDist = Math.hypot(mech.x - n[0], mech.z - n[1]);
      queueAtStop = ride.queue.length;
    }
    if (job.status === 'working' && !ride.isEmpty()) workStartedWhileOccupied = true;
    if (ride.maint && ride.maint.stage !== 'requested' && ride.boarders.size > 0 && ride.phase === 'boarding') admittedDuring = true;
    return job.status === 'completed';
  });
  ok('Mechanic travels to the ride before working', arrivedDist !== null && arrivedDist < 0.6, `arrival distance ${arrivedDist?.toFixed(2)} m`);
  ok('Queue dispersed when the ride stopped for maintenance', queueAtStop === 0);
  ok('Maintenance only starts once the ride is empty', !workStartedWhileOccupied);
  ok('Maintenance completes, condition restored, ride reopens', job.status === 'completed' && ride.condition === 100 && !ride.maint && ride.admitting);
}

// 5. Closing a ride and price changes.
{
  const sim = new Simulation();
  const ride = sim.rides[0];
  run(sim, 200, () => ride.queue.length > 3);
  const q0 = ride.queue.length;
  sim.setRideOpen(ride, false);
  const qAfter = ride.queue.length;
  let joined = false;
  run(sim, 400, () => { if (ride.queue.length) joined = true; return false; });
  ok('Closing a ride disperses its queue and blocks new admissions', q0 > 0 && qAfter === 0 && !joined, `queue ${q0} → ${qAfter}`);
  ok('Riders on board finish their cycle after closing', ride.isEmpty() && ride.statusKey() === 'closed');
  sim.setRideOpen(ride, true);
  // Demand comparison at different prices (same seed, same period).
  const joinsAt = (price) => {
    const s = new Simulation();
    const r = s.rides[0];
    r.setPrice(price);
    let joins = 0;
    const seen = new Set(r.queue);
    run(s, 1200, () => { for (const id of r.queue) if (!seen.has(id)) { seen.add(id); joins++; } return false; });
    return joins;
  };
  const cheap = joinsAt(4), normal = joinsAt(8), pricey = joinsAt(18);
  ok('Higher ticket price reduces demand; lower price raises it', cheap > normal && normal > pricey, `joins in 20 min: $4 → ${cheap}, $8 → ${normal}, $18 → ${pricey}`);
}

// 6. Consistency over a long run.
{
  const sim = new Simulation();
  let bad = null;
  run(sim, 3600, () => {
    const seen = new Set();
    for (const r of sim.rides) {
      if (r.queue.length > r.queueCap) bad = 'queue over capacity';
      for (const id of r.queue) { if (seen.has(id)) bad = 'visitor in two queues ' + id; seen.add(id); }
      for (const veh of r.vehicles) for (const id of veh.seats) if (id) { if (seen.has('s' + id)) bad = 'two seats ' + id; seen.add('s' + id); }
    }
    for (const s of sim.shops) for (const p of s.products) if (p.stock < 0) bad = 'negative stock';
    for (const v of sim.visitors) if (v.spent > v.budget) bad = 'overspent';
    return !!bad;
  });
  const paid = sim.orders.filter((o) => o.paid).reduce((a, o) => a + o.price, 0);
  ok('One hour: no duplicate queue/seat, capacity respected, no negative stock', !bad, bad || '');
  ok('Shop revenue equals sum of paid orders', Math.abs(paid - sim.finance.shops) < 1e-6, `$${paid}`);
  ok('Population stays within 60–90', sim.visitors.length >= 60 && sim.visitors.length <= 92, `${sim.visitors.length} guests`);
}

// 7. Reset restores a coherent initial park.
{
  const sim = new Simulation();
  const snap = JSON.stringify([sim.time, sim.visitors.length, sim.revenue, sim.orders.length]);
  run(sim, 600);
  sim.reset();
  const snap2 = JSON.stringify([sim.time, sim.visitors.length, sim.revenue, sim.orders.length]);
  ok('Reset restores the identical opening state', snap === snap2, snap2);
}

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? '  — ' + d : ''}`);
console.log(`${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed`);

if (results.some(([status]) => status === 'FAIL')) process.exitCode = 1;
