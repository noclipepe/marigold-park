import * as THREE from 'three';
import { Simulation } from './sim/sim.js';
import { SceneManager } from './render/scene.js';
import { ParkBuilder } from './render/park.js';
import { RideViews } from './render/rideViews.js';
import { PeopleRenderer } from './render/people.js';
import { Overlays } from './render/overlays.js';
import { CameraController } from './render/camera.js';
import { UI } from './ui/ui.js';
import { EveningFx } from './render/eveningFx.js';
import { DEFAULT_VIEW, PORTRAIT_VIEW } from './render/camera.js';
import { fmtWait } from './sim/util.js';
import { COASTER, CAROUSEL, WHEEL, SHOPS, DEPOT } from './sim/layout.js';

const _v = new THREE.Vector3();

class App {
  constructor() {
    this.sim = new Simulation();
    this.paused = false;
    this.speed = 1;
    this.evening = false;
    this.selectedId = null;
    this.moodMarkers = false;
    this.view = 'overview';
    const container = document.getElementById('scene');
    this.sm = new SceneManager(container);
    this.park = new ParkBuilder(this.sm).build();
    this.rides = new RideViews(this.sm, this.sim, this.park);
    this.people = new PeopleRenderer(this.sm.scene);
    this.overlays = new Overlays(this.sm);
    this.cam = new CameraController(this.sm.camera, this.sm.renderer.domElement, this.sim);
    this.ui = new UI(this);
    this.fx = new EveningFx(this.sm, this.sim, this.park, this.rides);
    this.sm.onEvening((k) => {
      this.park.setEvening(k);
      this.fx.setEvening(k);
      document.body.classList.toggle('eve', k > 0.5);
    });
    this.sim.on((type, ev) => {
      if (type === 'event' && ev.noteworthy) this.ui.pushFeed(ev);
    });
    this.cam.on((type) => {
      if (type === 'ride') this.updateRideHud();
      this.ui.render(true);
    });
    this.bindControls();
    this.bindPicking();
    window.addEventListener('resize', () => { this.layoutStage(); this.sm.resize(); });
    this.portrait = false;
    if (location.hash === '#portrait') this.setPortrait(true, true);
    new ResizeObserver(() => this.sm.resize()).observe(container);
    this.ui.setView('overview');
    this.last = performance.now();
    this.time = 0;
    this.fps = 60;
    requestAnimationFrame((t) => this.frame(t));
    setTimeout(() => document.getElementById('loading').classList.add('gone'), 250);
    window.__park = this; // handle for automated verification
  }

  // ------------------------------------------------------------------ controls
  bindControls() {
    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.addEventListener('click', () => this.setPaused(!this.paused));
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed))));
    document.querySelectorAll('[data-light]').forEach((b) => b.addEventListener('click', () => this.setEvening(b.dataset.light === 'evening')));
    document.getElementById('btn-overview').addEventListener('click', () => { this.cam.overview(); });
    document.getElementById('btn-reset').addEventListener('click', () => document.getElementById('confirm').classList.remove('hidden'));
    document.getElementById('confirm-no').addEventListener('click', () => document.getElementById('confirm').classList.add('hidden'));
    document.getElementById('confirm-yes').addEventListener('click', () => { document.getElementById('confirm').classList.add('hidden'); this.reset(); });
    document.getElementById('rh-exit').addEventListener('click', () => this.exitRide());
    document.getElementById('btn-portrait').addEventListener('click', () => this.setPortrait(!this.portrait));
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.setPaused(!this.paused); }
      else if (e.key === 'Escape') { if (this.cam.mode === 'ride' || this.cam.mode === 'toRide') this.exitRide(); else this.select(null); }
      else if (e.key === 'Home') this.cam.overview();
      else if (e.key === 'f' && this.selectedId) this.followEntity(this.selectedId);
      else if (e.key === 'p' || e.key === 'P') this.setPortrait(!this.portrait);
    });
  }

  setPaused(p) {
    this.paused = p;
    const b = document.getElementById('btn-pause');
    b.classList.toggle('paused', p);
    document.getElementById('pause-label').textContent = p ? 'Resume' : 'Pause';
  }
  setSpeed(s) {
    this.speed = s;
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s));
  }
  setEvening(on) {
    this.evening = on;
    this.sm.setEvening(on);
    document.querySelectorAll('[data-light]').forEach((b) => b.classList.toggle('active', (b.dataset.light === 'evening') === on));
    this.ui.renderTop();
  }
  // ---------------------------------------------------------------- portrait demo
  setPortrait(on, instant = false) {
    this.portrait = on;
    document.body.classList.toggle('portrait', on);
    document.getElementById('portrait-label').textContent = on ? 'Desktop' : 'Portrait';
    this.layoutStage();
    this.sm.resize();
    this.cam.defaultView = on ? PORTRAIT_VIEW : DEFAULT_VIEW;
    if (on && !this.ui.view) this.ui.setView('overview');
    if (on && this.ui.panelOpen === false) this.ui.togglePanel(true);
    if (this.cam.mode === 'orbit') {
      if (this.selectedId) this.focusEntity(this.selectedId);
      else if (instant) this.cam.applyView(this.cam.defaultView);
      else this.cam.overview();
    }
    this.ui.render(true);
  }

  // Fit a 9:16 stage inside the window (letterboxed) in portrait mode.
  layoutStage() {
    const app = document.getElementById('app');
    if (!this.portrait) {
      for (const k of ['left', 'top', 'width', 'height', 'right', 'bottom']) app.style[k] = '';
      app.style.removeProperty('--s');
      this.overlays.labelScale = 1;
      return;
    }
    const W = window.innerWidth, H = window.innerHeight;
    let h = H, w = Math.floor((H * 9) / 16);
    if (w > W) { w = W; h = Math.floor((W * 16) / 9); }
    Object.assign(app.style, { left: Math.floor((W - w) / 2) + 'px', top: Math.floor((H - h) / 2) + 'px', width: w + 'px', height: h + 'px', right: 'auto', bottom: 'auto' });
    const s = w / 420;
    app.style.setProperty('--s', s.toFixed(4));
    this.overlays.labelScale = Math.max(1, s * 0.92);
  }

  setMoodMarkers(on) {
    this.moodMarkers = on;
    this.people.showMood = on;
  }
  onViewChange(v) {
    this.view = v;
    this.people.showMood = this.moodMarkers && v === 'guests';
  }

  reset() {
    if (this.cam.mode !== 'orbit') this.exitRide();
    this.select(null);
    this.sim.reset();
    this.ui.feed.innerHTML = '';
    this.ui.render(true);
  }

  // ------------------------------------------------------------------ selection
  select(id, opts = {}) {
    if (id && !this.sim.get(id)) return;
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev !== id && this.cam.followId && this.cam.followId !== id) this.cam.stopFollow();
    document.body.classList.toggle('has-sel', !!id);
    // Vehicles lock the camera onto their movement; everything else just frames.
    // In portrait demo mode every selection is framed so the object and its panel stay in shot.
    if (id && prev !== id && this.isMover(id) && this.cam.mode === 'orbit') this.followEntity(id);
    else if (id && (opts.focus || (this.portrait && prev !== id))) this.focusEntity(id, !this.portrait);
    this.overlays.clearRoutes();
    this.ui.render(true);
  }

  isMover(id) {
    const e = this.sim.get(id);
    return !!e && (e.kind === 'vehicle' || e.kind === 'cart');
  }

  // Live world position of any entity.
  entityPos(id) {
    const sim = this.sim;
    const e = sim.get(id);
    if (!e) return null;
    switch (e.kind) {
      case 'visitor': case 'staff': return new THREE.Vector3(e.x, e.y, e.z);
      case 'cart': return new THREE.Vector3(e.x, 0, e.z);
      case 'ride':
        if (e.id === 'R-01') return new THREE.Vector3(-33, 0, 1);
        if (e.id === 'R-02') return new THREE.Vector3(WHEEL.hub[0], 9, WHEEL.hub[2]);
        return new THREE.Vector3(CAROUSEL.center[0], 0, CAROUSEL.center[1]);
      case 'vehicle': {
        if (e.vtype === 'train') { const o = this.rides.cars[2]; return o.position.clone(); }
        const o = this.rides.vehicleMeshes[e.id];
        return o ? o.getWorldPosition(new THREE.Vector3()) : null;
      }
      case 'shop': return new THREE.Vector3(e.def.center[0], 0, e.def.center[1]);
      case 'order': { const v = sim.get(e.visitorId); return v && v.active && e.status !== 'collected' && e.status !== 'cancelled' ? new THREE.Vector3(v.x, v.y, v.z) : this.entityPos(e.shopId); }
      case 'job': {
        if (e.assignedTo && e.status !== 'completed') return this.entityPos(e.assignedTo);
        if (e.type === 'cleaning') { const l = sim.litter.find((x) => x.id === e.targetId); return new THREE.Vector3(l.pos[0], 0, l.pos[1]); }
        return this.entityPos(e.targetId);
      }
      case 'delivery': return e.status === 'loading' || e.status === 'in transit' || e.status === 'unloading' ? this.entityPos('V-01') : this.entityPos(e.status === 'delivered' ? e.shopId : 'DEPOT');
      case 'group': {
        const ms = e.members.map((m) => sim.get(m)).filter((m) => m && m.active);
        if (!ms.length) return null;
        const p = new THREE.Vector3();
        for (const m of ms) p.add(_v.set(m.x, m.y, m.z));
        return p.multiplyScalar(1 / ms.length);
      }
      case 'place': return e.id === 'GATE' ? new THREE.Vector3(0, 0, 60) : new THREE.Vector3(DEPOT.pos[0], 0, DEPOT.pos[1]);
    }
    return null;
  }

  focusDistance(id) {
    const e = this.sim.get(id);
    switch (e.kind) {
      case 'visitor': case 'staff': case 'group': case 'order': return 34;
      case 'vehicle': return e.vtype === 'train' ? 55 : 40;
      case 'cart': case 'delivery': case 'job': return 42;
      case 'shop': return 46;
      case 'ride': return e.id === 'R-02' ? 95 : e.id === 'R-01' ? 115 : 70;
      case 'place': return 60;
    }
    return 60;
  }

  focusEntity(id, fromSelect = false) {
    const p = this.entityPos(id);
    if (!p) return;
    const getPos = () => this.entityPos(id) || p;
    // Selecting in the world keeps the current zoom unless we are far away.
    const cur = this.cam.camera.position.distanceTo(this.cam.controls.target);
    const want = this.focusDistance(id);
    const kind = this.sim.get(id).kind;
    const big = kind === 'ride' || kind === 'place' || kind === 'shop' || (kind === 'vehicle' && this.sim.get(id).vtype === 'train');
    const dist = fromSelect && !big ? Math.max(18, Math.min(cur, want)) : want;
    this.cam.focus(getPos, dist, this.cam.followId === id, this.cam.followId === id ? id : null);
  }

  followEntity(id) {
    if (this.cam.mode !== 'orbit') return;
    const getPos = () => this.entityPos(id);
    const cur = this.cam.camera.position.distanceTo(this.cam.controls.target);
    this.cam.startFollow(getPos, id, Math.min(cur, this.focusDistance(id)));
    this.ui.render(true);
  }

  // ------------------------------------------------------------------ ride along
  rideAlong(rideId, vehId, seat) {
    const sim = this.sim;
    const ride = sim.get(rideId);
    // Prefer the selected guest's seat if they are on this ride.
    const sel = this.selectedId && sim.get(this.selectedId);
    if (!vehId && sel && sel.kind === 'visitor' && sel.seat && sel.seat.rideId === rideId) { vehId = sel.seat.vehId; seat = sel.seat.seat; }
    if (!vehId) {
      if (ride.rideType === 'coaster') vehId = 'C-01';
      else if (ride.rideType === 'wheel') vehId = ride.vehicles[ride.stopIndex].id;
      else vehId = ride.vehicles[0].id;
    }
    // In portrait demo mode the panel shows the attraction being ridden.
    if (this.portrait && this.selectedId !== rideId && !(sel && sel.kind === 'visitor' && sel.seat && sel.seat.rideId === rideId)) {
      this.selectedId = rideId;
      document.body.classList.add('has-sel');
      this.ui.render(true);
    }
    document.body.classList.add('riding');
    this.cam.enterRide(rideId, vehId, seat);
    this.updateRideHud();
  }

  exitRide() {
    this.cam.exitRide();
    document.body.classList.remove('riding');
    this.updateRideHud();
  }

  updateRideHud() {
    const hud = document.getElementById('ridehud');
    const on = this.cam.mode === 'ride' || this.cam.mode === 'toRide';
    hud.classList.toggle('hidden', !on);
    if (!on) document.body.classList.remove('riding');
  }

  rideHudTick() {
    if (this.cam.mode !== 'ride' && this.cam.mode !== 'toRide') return;
    const r = this.cam.ride && this.sim.get(this.cam.ride.rideId);
    if (!r) return;
    document.getElementById('rh-name').textContent = `Riding ${r.name} · ${this.cam.ride.vehId}`;
    let stats = '';
    if (r.rideType === 'coaster') {
      const veh = r.vehicles.find((c) => c.id === this.cam.ride.vehId) || r.vehicles[0];
      const h = r.track.height(r.carS(veh.index));
      stats = `<span><b>${Math.round(r.speedKmh())}</b> km/h</span><span><b>${h.toFixed(0)}</b> m high</span><span>${r.phase === 'running' ? r.phaseLabel().replace('Running · ', '') : r.phase === 'boarding' ? 'Boarding — departs soon' : r.phaseLabel()}</span><span><b>${r.seatedCount()}</b> riders</span>`;
    } else if (r.rideType === 'wheel') {
      const veh = r.vehicles.find((c) => c.id === this.cam.ride.vehId);
      const p = r.cabinPos(veh.index, new THREE.Vector3());
      stats = `<span><b>${Math.max(0, p.y).toFixed(0)}</b> m high</span><span>${r.phaseLabel()}</span><span><b>${veh.seats.filter(Boolean).length}</b> in cabin</span>`;
    } else {
      stats = `<span>${r.phaseLabel()}</span><span><b>${r.seatedCount()}</b> riders</span>`;
    }
    const el = document.getElementById('rh-stats');
    if (el._h !== stats) { el.innerHTML = stats; el._h = stats; }
  }

  // ------------------------------------------------------------------ picking
  bindPicking() {
    const dom = this.sm.renderer.domElement;
    const ray = new THREE.Raycaster();
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5 || e.button !== 0 || this.cam.mode !== 'orbit') return;
      const id = this.pick(e.clientX, e.clientY, ray);
      this.select(id || null);
    });
    dom.addEventListener('dblclick', (e) => {
      if (this.cam.mode !== 'orbit') return;
      const id = this.pick(e.clientX, e.clientY, ray);
      if (id) { this.select(id); this.focusEntity(id); }
    });
  }

  pick(cx, cy, ray) {
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    const x = cx - rect.left, y = cy - rect.top;
    const cam = this.sm.camera;
    // People: nearest projected position.
    let best = null, bd = Infinity, bi = -1;
    const P = this.people.positions;
    const w = rect.width, h = rect.height;
    const dist = cam.position.distanceTo(this.cam.controls.target);
    const radius = Math.max(9, Math.min(26, 900 / dist));
    for (let i = 0; i < P.length; i++) {
      _v.set(P[i][0], P[i][1], P[i][2]).project(cam);
      if (_v.z > 1) continue;
      const sx = ((_v.x + 1) / 2) * w, sy = ((1 - _v.y) / 2) * h;
      const d = Math.hypot(sx - x, sy - y);
      if (d < radius && d < bd) { bd = d; best = this.people.index[i]; bi = i; }
    }
    // Meshes.
    ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), cam);
    const hits = ray.intersectObjects(this.rides.pickables.concat(this.park.pickables), false);
    const veh = hits.find((h) => this.sim.get(h.object.userData.pick)?.kind === 'vehicle' || h.object.userData.pick === 'V-01');
    if (best && veh) {
      const person = this.sim.get(best);
      const pd = cam.position.distanceTo(_v.set(P[bi][0], P[bi][1], P[bi][2]));
      const vehId = veh.object.userData.pick;
      // Riders sit inside their vehicle: only a click right on the rider picks them.
      if (person.seat && person.seat.vehId === vehId && person.state === 'riding' && bd > radius * 0.35) return vehId;
      if (veh.distance < pd - 1.5) return vehId; // vehicle in front of the person
    }
    if (best) return best;
    if (veh) return veh.object.userData.pick;
    if (hits.length) return hits[0].object.userData.pick;
    return null;
  }

  // ------------------------------------------------------------------ frame
  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (!this.paused) this.sim.advance(dt, this.speed);
    const simT = this.sim.time;
    this.sm.update(dt);
    this.park.update(this.time);
    this.rides.update(this.time, this.sm.eve);
    this.fx.update(dt, this.paused);
    this.people.showMood = this.moodMarkers && this.view === 'guests' && this.cam.mode === 'orbit';
    this.people.update(this.sim, this.time, this.sm.camera);
    this.cam.update(dt);
    this.updateSelectionVisuals();
    this.updateLabels();
    this.overlays.animate(this.time);
    this.rideHudTick();
    this.ui.tick(dt);
    this.signTimer = (this.signTimer || 0) - dt;
    if (this.signTimer <= 0) { this.park.updateSigns(this.sim); this.signTimer = 1; }
    const panelOpen = this.ui.panelOpen !== false && this.ui.view;
    const insOpen = !!this.selectedId;
    const riding = this.cam.mode !== 'orbit';
    this.sm.setInsets(riding || this.portrait ? 0 : panelOpen ? 380 : 82, 0);
    this.sm.render();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  updateSelectionVisuals() {
    const sim = this.sim;
    const id = this.selectedId;
    const e = id && sim.get(id);
    const riding = this.cam.mode !== 'orbit';
    if (!e || riding || (e.kind === 'visitor' && !e.active)) {
      this.overlays.setMarker(null, 1, 1, false);
      this.sm.setOutline(null);
      this.overlays.clearRoutes(riding ? null : undefined);
      this.staffRoutes();
      return;
    }
    const p = this.entityPos(id);
    let radius = 0.9, height = 2.5, outline = null, route = null;
    const ground = (x, z) => sim.groundHeight(x, z);
    switch (e.kind) {
      case 'visitor': {
        radius = 0.9 * e.scale;
        height = e.pose === 'ride' ? 1.7 : 2.4 * e.scale;
        if (e.seat && (e.state === 'riding')) outline = this.rides.vehicleMeshes[e.seat.vehId];
        route = sim.visitors_.remainingRoute(e);
        break;
      }
      case 'staff': {
        height = 2.5;
        if (e.role === 'delivery' && sim.cart.walk) route = this.walkPts(sim.cart);
        else if (e.walk) route = this.walkPts(e);
        break;
      }
      case 'group': {
        radius = 2.6;
        const lead = e.members.map((m) => sim.get(m)).find((m) => m && m.active);
        if (lead) route = sim.visitors_.remainingRoute(lead);
        break;
      }
      case 'vehicle':
        radius = 1.8; height = 3.0;
        outline = e.vtype === 'train' ? this.rides.cars : this.rides.vehicleMeshes[e.id];
        break;
      case 'cart': radius = 2.2; height = 3.2; outline = this.rides.cart; if (sim.cart.walk) route = this.walkPts(sim.cart); break;
      case 'delivery': radius = 2.2; height = 3.2; if (['loading', 'in transit', 'unloading'].includes(e.status)) { outline = this.rides.cart; if (sim.cart.walk) route = this.walkPts(sim.cart); } break;
      case 'shop': radius = 4.8; height = 6.5; break;
      case 'ride': radius = e.id === 'R-02' ? 8 : e.id === 'R-01' ? 9 : 10.5; height = e.id === 'R-02' ? 25 : e.id === 'R-01' ? 9 : 11; break;
      case 'order': { const v = sim.get(e.visitorId); if (v && v.active && (e.status === 'queued' || e.status === 'preparing')) route = sim.visitors_.remainingRoute(v); break; }
      case 'job': {
        const s = e.assignedTo && sim.get(e.assignedTo);
        if (s && e.status !== 'completed') {
          if (s.role === 'delivery' && sim.cart.walk) route = this.walkPts(sim.cart);
          else if (s.walk) route = this.walkPts(s);
        }
        break;
      }
      case 'place': radius = 8; height = 14; break;
    }
    if (!p) { this.overlays.setMarker(null, 1, 1, false); return; }
    const gy = e.kind === 'visitor' && e.pose === 'ride' ? p.y - 0.45 : e.kind === 'vehicle' ? p.y - 0.2 : ground(p.x, p.z);
    this.overlays.setMarker({ x: p.x, y: p.y, z: p.z, groundY: gy }, radius, height, true, e.kind !== 'ride' && e.kind !== 'place');
    this.sm.setOutline(outline ? (Array.isArray(outline) ? outline : [outline]) : null);
    if (route && route.length >= 2) this.overlays.setRoute('main', route, ground);
    else this.overlays.setRoute('main', null, ground);
    this.staffRoutes();
  }

  staffRoutes() {
    const sim = this.sim;
    const ground = (x, z) => sim.groundHeight(x, z);
    const show = this.view === 'staff' && this.cam.mode === 'orbit';
    const showCart = (this.view === 'shops' || this.view === 'staff') && this.cam.mode === 'orbit';
    for (const s of sim.staff) {
      if (s.id === this.selectedId) continue;
      const key = 'staff:' + s.id;
      if (show && s.walk && s.jobId && s.role !== 'delivery') this.overlays.setRoute(key, this.walkPts(s), ground, true);
      else this.overlays.setRoute(key, null, ground, true);
    }
    if (showCart && sim.cart.walk && this.selectedId !== 'V-01') this.overlays.setRoute('cart', this.walkPts(sim.cart), ground, true);
    else this.overlays.setRoute('cart', null, ground, true);
  }

  walkPts(e) {
    const w = e.walk;
    if (!w) return null;
    const pts = [[e.x, e.z]];
    for (let i = w.i; i < w.pts.length; i++) pts.push(w.pts[i]);
    return pts;
  }

  updateLabels() {
    const sim = this.sim;
    const items = [];
    const v = this.view;
    if (this.cam.mode === 'orbit') {
      const tops = { 'R-01': [-33, 9.2, 2], 'R-02': [WHEEL.hub[0], 3.2, WHEEL.hub[2] + 5.4], 'R-03': [CAROUSEL.center[0], 10.2, CAROUSEL.center[1]] };
      if (v === 'overview' || v === 'rides' || v === null) {
        for (const r of sim.rides) {
          const k = r.statusKey();
          const dot = k === 'operating' ? '#2f9e5b' : k === 'closed' || k === 'closing' ? '#9a9284' : k === 'maintenance' ? '#d4492f' : '#d99512';
          const html = v === 'rides'
            ? `<span class="dot" style="background:${dot}"></span> <b>${r.name}</b> <span class="ls">${r.statusLabel()}</span><br><span class="ls">Wait ${r.admitting ? fmtWait(r.postedWait()) : '—'} · ${r.queue.length} queuing · ${r.seatedCount()}/${r.capacity()} riding</span>`
            : `<span class="dot" style="background:${dot}"></span> <b>${r.name}</b> <span class="ls">${r.admitting ? fmtWait(r.postedWait()) : r.statusLabel()}</span>`;
          items.push({ key: r.id, ref: r.id, pos: new THREE.Vector3(...tops[r.id]), html, cls: (v === 'rides' ? '' : 'small') + (this.selectedId === r.id ? ' sel' : '') });
        }
      }
      if (v === 'shops' || v === 'overview' || v === null) {
        for (const s of sim.shops) {
          const low = s.products.filter((p) => p.stock <= p.max * 0.3).length;
          const html = v === 'shops'
            ? `<b>${s.name}</b> <span class="ls">${sim.shops_.status(s)}</span><br><span class="ls">${s.products.map((p) => `${p.name.split(' ').pop()} ${p.stock}`).join(' · ')}</span>`
            : `<b>${s.name}</b>${low ? ' <span class="ls" style="color:var(--bad)">low stock</span>' : ''}`;
          items.push({ key: s.id, ref: s.id, pos: new THREE.Vector3(s.def.center[0], 6.2, s.def.center[1]), html, cls: (v === 'shops' ? '' : 'small') + (this.selectedId === s.id ? ' sel' : '') });
        }
        if (v === 'shops') {
          const c = sim.cart;
          const d = c.cargo && sim.get(c.cargo);
          items.push({ key: 'V-01', ref: d ? d.id : 'V-01', pos: new THREE.Vector3(c.x, 3.2, c.z), html: d ? `<b>${d.id}</b> <span class="ls">${d.status} → ${sim.get(d.shopId).name}</span>` : `<b>Cart V-01</b> <span class="ls">${c.state}</span>`, cls: 'small' });
        }
      }
      if (v === 'staff') {
        for (const s of sim.staff) items.push({ key: s.id, ref: s.id, pos: new THREE.Vector3(s.x, s.y + 2.5, s.z), html: `<b>${s.name}</b> <span class="ls">${s.roleLabel}</span>`, cls: 'small' + (this.selectedId === s.id ? ' sel' : '') });
      }
    }
    this.overlays.setLabels(items, this.sm.camera, this.sm.width, this.sm.height);
  }
}

new App();
