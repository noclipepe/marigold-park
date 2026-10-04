import { SHOPS, NODES } from './layout.js';
import { pad, clamp } from './util.js';

const PREP_TIME = { food: 11, drink: 7 };

export class ShopSystem {
  constructor(sim) {
    this.sim = sim;
  }

  create() {
    const sim = this.sim;
    for (const def of SHOPS) {
      const shop = {
        id: def.id, kind: 'shop', name: def.name, def, lane: def.queue, open: true,
        products: def.products.map((p) => ({ ...p, base: p.price, sold: 0 })),
        queue: [], current: null, completed: [], cancelled: 0, revenue: 0, events: [],
        replenish: null, blocked: false, prepProgress: 0, workerId: null, served: 0,
        reserved(pid) {
          let n = 0;
          for (const vid of this.queue) {
            const v = sim.get(vid);
            const o = v && sim.get(v.order);
            if (o && o.status === 'queued' && o.productId === pid) n++;
          }
          return n;
        },
      };
      sim.register(shop);
      sim.shops.push(shop);
    }
  }

  joinQueue(v, shop, product) {
    const sim = this.sim;
    const order = {
      id: `O-${pad(++sim.counters.O, 3)}`, kind: 'order', visitorId: v.id, shopId: shop.id, productId: product.id,
      item: product.name, price: product.price, status: 'queued', createdAt: sim.time, preparedAt: null, collectedAt: null, paid: false, events: [],
    };
    sim.register(order);
    sim.orders.push(order);
    shop.queue.push(v.id);
    v.queueShop = shop.id;
    v.order = order.id;
    v.qDist = shop.lane.length;
    v.queueSince = sim.time;
    v.impatient = false;
    v.walk = null;
    sim.visitors_.setState(v, 'shopQueue');
    sim.log(`Order ${order.id} queued: ${v.id} · ${v.name} wants ${product.name.toLowerCase()} at ${shop.name}.`, [order.id, v.id, shop.id], { quiet: true });
  }

  giveUp(v, shop, reason = 'the line was too slow') {
    const sim = this.sim;
    const i = shop.queue.indexOf(v.id);
    if (i >= 0) shop.queue.splice(i, 1);
    const order = sim.get(v.order);
    if (order && order.status === 'queued') {
      order.status = 'cancelled';
      shop.cancelled++;
      sim.log(`Order ${order.id} cancelled — ${v.id} · ${v.name} left the ${shop.name} line (${reason}).`, [order.id, v.id, shop.id], { quiet: true });
    }
    v.order = null;
    v.queueShop = null;
    v.mood = clamp(v.mood - 7, 0, 100);
    this.leaveToPickup(v, shop, 'exitQueue');
  }

  leaveToPickup(v, shop, purpose) {
    const sim = this.sim;
    const pts = shop.lane.slice(v.qDist, shop.lane.length);
    const [px, pz] = NODES[shop.def.queueNode];
    pts.push([px, pz]);
    sim.visitors_.setState(v, 'walking');
    v.dest = { type: 'regroup', node: shop.def.queueNode, label: 'Leaving the line' };
    sim.visitors_.walkTo(v, pts, purpose, { endNode: shop.def.queueNode });
  }

  setOpen(shop, open) {
    const sim = this.sim;
    if (shop.open === open) return;
    shop.open = open;
    sim.log(`${shop.name} ${open ? 'reopened' : 'closed'} by the park manager.`, [shop.id], { noteworthy: true });
    if (!open) {
      for (const vid of shop.queue.slice()) {
        const v = sim.get(vid);
        if (v) this.giveUp(v, shop, 'the stand closed');
      }
      sim.visitors_.redirectFrom(shop.id);
    }
  }

  setPrice(shop, pid, price) {
    const p = shop.products.find((x) => x.id === pid);
    price = clamp(Math.round(price), 1, 20);
    if (!p || p.price === price) return;
    const old = p.price;
    p.price = price;
    this.sim.log(`${shop.name}: ${p.name} price changed from $${old} to $${price}.`, [shop.id], { noteworthy: true });
  }

  needsReplenishment(shop) {
    return shop.products.some((p) => p.stock <= Math.ceil(p.max * 0.3));
  }

  update(dt) {
    const sim = this.sim;
    for (const shop of sim.shops) {
      // Low stock -> replenishment request with a delivery job.
      if (!shop.replenish && this.needsReplenishment(shop)) sim.jobs_.requestDelivery(shop);

      if (shop.current) {
        const order = sim.get(shop.current);
        const prod = shop.products.find((p) => p.id === order.productId);
        shop.prepProgress += dt / PREP_TIME[prod.kind];
        if (shop.prepProgress >= 1) this.collect(shop, order);
        continue;
      }
      shop.blocked = false;
      if (!shop.queue.length) continue;
      const v = sim.get(shop.queue[0]);
      if (!v || v.state !== 'shopQueue' || v.qDist > 0.25) continue;
      const order = sim.get(v.order);
      let prod = shop.products.find((p) => p.id === order.productId);
      if (prod.stock <= 0) {
        // Offer an alternative that is in stock and affordable.
        const alt = shop.products.find((p) => p.stock > 0 && p.price <= v.budget - v.spent);
        if (alt) {
          sim.log(`Order ${order.id}: ${prod.name} sold out — ${v.name} switched to ${alt.name.toLowerCase()}.`, [order.id, v.id, shop.id], { quiet: true });
          order.productId = alt.id; order.item = alt.name; order.price = alt.price;
          prod = alt;
        } else {
          shop.blocked = true;
          continue;
        }
      }
      // Re-price at the counter if the manager changed it; customers may walk away.
      order.price = prod.price;
      if (order.price > v.budget - v.spent) {
        this.giveUp(v, shop, 'too expensive');
        continue;
      }
      shop.queue.shift();
      prod.stock -= 1; // served from inventory
      if (prod.stock < 0) prod.stock = 0;
      order.status = 'preparing';
      order.preparedAt = sim.time;
      shop.current = order.id;
      shop.prepProgress = 0;
      v.queueShop = null;
      sim.visitors_.setState(v, 'ordering');
      sim.log(`Order ${order.id} is being prepared at ${shop.name} (${prod.name.toLowerCase()}).`, [order.id, shop.id, v.id, shop.workerId], { quiet: true });
    }
  }

  collect(shop, order) {
    const sim = this.sim;
    const v = sim.get(order.visitorId);
    const prod = shop.products.find((p) => p.id === order.productId);
    shop.current = null;
    shop.prepProgress = 0;
    if (!order.paid) {
      order.paid = true;
      sim.charge(v, order.price, shop, `${order.item} · ${shop.name}`);
      shop.revenue += order.price;
      prod.sold++;
      shop.served++;
    }
    order.status = 'collected';
    order.collectedAt = sim.time;
    shop.completed.unshift(order.id);
    if (shop.completed.length > 40) shop.completed.pop();
    v.purchases.push(order.id);
    v.order = null;
    v.appetite = Math.max(0, v.appetite - (prod.kind === 'food' ? 0.7 : 0.35));
    const pf = order.price / prod.base;
    v.mood = clamp(v.mood + 9 - Math.max(0, pf - 1) * 12, 0, 100);
    v.item = { name: prod.name, kind: prod.kind, color: shop.def.color, until: sim.time + 50 + sim.rng() * 40 };
    sim.log(`Order ${order.id} was collected by ${v.id} · ${v.name} ($${order.price}).`, [order.id, v.id, shop.id], { quiet: true });
    const [px, pz] = NODES[shop.def.pickupNode];
    sim.visitors_.setState(v, 'walking');
    v.dest = { type: 'regroup', node: shop.def.pickupNode, label: 'Walking away with a snack' };
    sim.visitors_.walkTo(v, [[v.x - shop.def.facing * 0.6, v.z + 1.4], [px + (sim.rng() - 0.5) * 2, pz + (sim.rng() - 0.5) * 1.5]], 'pickup', { endNode: shop.def.pickupNode });
  }

  restock(shop, delivery) {
    const sim = this.sim;
    const lines = [];
    for (const it of delivery.items) {
      const p = shop.products.find((x) => x.id === it.productId);
      const before = p.stock;
      p.stock = Math.min(p.max, p.stock + it.qty);
      lines.push(`${p.name} ${before}→${p.stock}`);
    }
    shop.replenish = null;
    sim.log(`${shop.name} restocked from ${delivery.id}: ${lines.join(', ')}.`, [shop.id, delivery.id], { noteworthy: true });
  }

  status(shop) {
    if (!shop.open) return 'Closed';
    if (shop.blocked) return 'Sold out · waiting for delivery';
    if (shop.current) return 'Serving';
    return shop.queue.length ? 'Serving' : 'Open';
  }
}
