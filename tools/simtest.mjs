import { Simulation } from '../src/sim/sim.js';
const t0 = Date.now();
const sim = new Simulation();
console.log('warmup ms', Date.now()-t0);
function check() {
  const seen = new Map();
  for (const r of sim.rides) {
    for (const id of r.queue) { if (seen.has(id)) throw new Error('dup queue '+id); seen.set(id, r.id); const v=sim.get(id); if (v.state!=='queuing'||v.queueRide!==r.id) throw new Error('queue state mismatch '+id+' '+v.state); }
    if (r.queue.length > r.queueCap) throw new Error('queue over cap');
    for (const veh of r.vehicles) veh.seats.forEach((id, si) => { if (!id) return; if (seen.has('seat'+id)) throw new Error('dup seat '+id); seen.set('seat'+id,1); const v=sim.get(id); if (!v.seat || v.seat.vehId!==veh.id || v.seat.seat!==si) throw new Error('seat mismatch '+id+' '+JSON.stringify(v.seat)+' '+v.state); });
  }
  for (const v of sim.visitors) {
    if ((v.state==='riding'||v.state==='boarding') && !v.seat) throw new Error('rider without seat '+v.id);
    if (v.seat && seen.get('seat'+v.id)!==1) throw new Error('visitor seat not in vehicle '+v.id+' '+v.state);
    if (v.spent > v.budget + 1e-9) throw new Error('overspent '+v.id);
    if (!isFinite(v.x)||!isFinite(v.z)) throw new Error('nan pos '+v.id);
  }
  for (const sh of sim.shops) for (const p of sh.products) if (p.stock<0) throw new Error('neg stock');
  // finance consistency
  const tx = sim.orders.filter(o=>o.paid).reduce((a,o)=>a+o.price,0);
  const shopRev = sim.shops.reduce((a,s)=>a+s.revenue,0);
  if (Math.abs(shopRev - sim.finance.shops) > 1e-6) throw new Error('shop revenue mismatch '+shopRev+' '+sim.finance.shops);
  if (Math.abs(tx - shopRev) > 1e-6) throw new Error('orders vs revenue mismatch');
  const rideRev = sim.rides.reduce((a,r)=>a+r.revenue,0);
  if (Math.abs(rideRev - sim.finance.rides) > 1e-6) throw new Error('ride revenue mismatch '+rideRev+' '+sim.finance.rides);
}
const report = () => {
  const states = {};
  for (const v of sim.visitors) states[v.state]=(states[v.state]||0)+1;
  console.log(sim.clock(), 'guests', sim.visitors.length, JSON.stringify(states), 'rev', sim.revenue, 'sat', sim.satisfaction().toFixed(0));
  for (const r of sim.rides) console.log('  ', r.name, r.statusLabel(), r.phase, 'q', r.queue.length, 'riders', r.seatedCount(), 'cond', r.condition.toFixed(0), 'cycles', r.cycles, 'wait', Math.round(r.postedWait()), 'avgCycle', Math.round(r.avgCycle));
  for (const s of sim.shops) console.log('  ', s.name, sim.shops_.status(s), 'q', s.queue.length, s.products.map(p=>p.id+':'+p.stock).join(' '), 'rev', s.revenue, 'repl', s.replenish);
  for (const s of sim.staff) if (['mechanic','cleaner','delivery'].includes(s.role)) console.log('  ', s.id, s.role, s.state, s.status, s.jobId||'');
};
check(); report();
const t1=Date.now();
for (let i=0;i<4*60*30;i++){ sim.step(0.25); if (i%40===0) check(); if (i%(4*300)===0) report(); }
check(); report();
console.log('sim 30min ms', Date.now()-t1);
console.log('jobs', sim.jobs.map(j=>j.id+':'+j.type+':'+j.status).join(' '));
console.log('deliveries', sim.deliveries.map(d=>d.id+':'+d.status).join(' '));
console.log('orders', sim.orders.length, 'collected', sim.orders.filter(o=>o.status==='collected').length, 'cancelled', sim.orders.filter(o=>o.status==='cancelled').length);
console.log('departed', sim.departed, 'arrived', sim.arrivedTotal);
console.log(sim.events.filter(e=>e.noteworthy).slice(-25).map(e=>e.t.toFixed(0)+' '+e.text).join('\n'));
