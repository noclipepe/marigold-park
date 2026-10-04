import morphdom from 'morphdom';
import { fmtClock, fmtClockSec, fmtDuration, fmtWait, money } from '../sim/util.js';
import { NODE_NAMES } from '../sim/layout.js';
import { ROLE_LABEL } from '../sim/jobs.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ID_RE = /\b(G-\d{3,}|F-\d{3,}|R-0\d|T-01|C-0\d|W-\d{2}|H-\d{2}|K-0\d|S-\d{3}|O-\d{3,}|J-\d{3,}|D-\d{3,}|V-01)\b/g;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const ACT_STYLE = {
  walking: ['info', 'Walking'], queuing: ['warn', 'Queuing'], riding: ['ok', 'Riding'], shopping: ['info', 'Shopping'],
  resting: ['muted', 'Resting'], waiting: ['muted', 'Waiting'], leaving: ['muted', 'Leaving'], left: ['muted', 'Left'],
};
const RIDE_STATUS = {
  operating: ['ok', 'Operating'], maintPending: ['warn', 'Maintenance requested'], stopping: ['warn', 'Stopping for maintenance'],
  maintenance: ['bad', 'Under maintenance'], closing: ['warn', 'Closing'], closed: ['muted', 'Closed'],
};
const JOB_STATUS = {
  pending: ['warn', 'Pending'], travelling: ['info', 'Travelling'], waiting: ['info', 'Waiting on site'], working: ['ok', 'In progress'],
  loading: ['info', 'Loading'], unloading: ['ok', 'Unloading'], completed: ['muted', 'Completed'], cancelled: ['muted', 'Cancelled'],
};
const DELIV_STATUS = { requested: ['warn', 'Requested'], loading: ['info', 'Loading'], 'in transit': ['info', 'In transit'], unloading: ['ok', 'Unloading'], delivered: ['muted', 'Delivered'] };
const ORDER_STATUS = { queued: ['warn', 'Queued'], preparing: ['info', 'Preparing'], collected: ['ok', 'Collected'], cancelled: ['muted', 'Cancelled'] };
const ROLE_COLOR = { attendant: '#d6403a', shop: '#e06a8b', mechanic: '#f07f22', cleaner: '#3fa66b', delivery: '#8a6a3c' };
const RIDE_COLOR = { 'R-01': '#d23f2f', 'R-02': '#3b8fd9', 'R-03': '#d8a640' };

const ICONS = {
  focus: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.4" fill="currentColor"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  follow: '<svg viewBox="0 0 16 16"><path d="M2 8a6 6 0 1 1 12 0" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.4" fill="currentColor"/><path d="M8 10.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  ride: '<svg viewBox="0 0 16 16"><path d="M1 12c2-6 4-9 7-9s3 5 7 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="3.6" r="1.6" fill="currentColor"/></svg>',
  wrench: '<svg viewBox="0 0 16 16"><path d="M10.5 1.5a3.5 3.5 0 0 0-3.3 4.6L1.8 11.5a1.4 1.4 0 0 0 2 2l5.4-5.4a3.5 3.5 0 0 0 4.6-3.3l-2 1.3-1.9-.6-.6-1.9z" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

export class UI {
  constructor(app) {
    this.app = app;
    this.view = null;
    this.filters = { guestAct: 'all', guestMood: 'all', guestTab: 'guests', rideStatus: 'all', staffRole: 'all', staffAvail: 'all', orderStatus: 'all', delivStatus: 'all' };
    this.panelBody = document.getElementById('panel-body');
    this.panelTitle = document.getElementById('panel-title');
    this.inspector = document.getElementById('inspector');
    this.inspectorBody = document.getElementById('inspector-body');
    this.feed = document.getElementById('feed');
    this.timer = 0;
    this.bind();
  }

  get sim() { return this.app.sim; }

  // ---------------------------------------------------------------- events
  bind() {
    const onClick = (e) => {
      const a = e.target.closest('[data-action]');
      if (a && !a.disabled) { e.preventDefault(); this.action(a.dataset.action, a.dataset); return; }
      const r = e.target.closest('[data-ref]');
      if (r && r.dataset.ref) { e.preventDefault(); this.app.select(r.dataset.ref, { focus: true }); }
    };
    for (const el of [this.panelBody, this.inspectorBody, this.feed, document.getElementById('labels'), document.getElementById('search-results')]) el.addEventListener('click', onClick);
    document.querySelectorAll('.rail-btn').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    document.getElementById('panel-close').addEventListener('click', () => this.togglePanel(false));
    // Search.
    const input = document.getElementById('search');
    const results = document.getElementById('search-results');
    input.addEventListener('input', () => this.search(input.value));
    input.addEventListener('focus', () => input.value && this.search(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = results.querySelector('.sr-item');
        if (first) { this.app.select(first.dataset.ref, { focus: true }); input.blur(); results.classList.remove('open'); }
      } else if (e.key === 'Escape') { input.blur(); results.classList.remove('open'); }
      e.stopPropagation();
    });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) results.classList.remove('open'); });
    results.addEventListener('click', () => { results.classList.remove('open'); input.blur(); });
  }

  togglePanel(open) {
    const p = document.getElementById('panel');
    p.classList.toggle('collapsed', !open);
    this.panelOpen = open;
    this.feed.classList.toggle('shift', open);
    if (!open) document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
  }

  setView(v) {
    if (this.app.portrait) {
      if (this.app.selectedId) this.app.select(null);
      if (this.view === v) { this.render(true); return; }
    }
    if (this.view === v && this.panelOpen !== false) { this.togglePanel(false); this.view = null; this.app.onViewChange(null); return; }
    this.view = v;
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    this.togglePanel(true);
    this.panelTitle.textContent = { overview: 'Overview', rides: 'Rides', guests: 'Guests', staff: 'Staff & jobs', shops: 'Shops & Supply' }[v];
    this.panelBody.scrollTop = 0;
    this.app.onViewChange(v);
    this.render(true);
  }

  action(name, d) {
    const sim = this.sim, app = this.app;
    const ent = d.id ? sim.get(d.id) : null;
    switch (name) {
      case 'filter': this.filters[d.key] = d.val; break;
      case 'ride-open': sim.setRideOpen(ent, true); break;
      case 'ride-close': sim.setRideOpen(ent, false); break;
      case 'ride-price': ent.setPrice(ent.price + Number(d.delta)); break;
      case 'ride-maint': sim.requestMaintenance(ent); break;
      case 'ride-along': app.rideAlong(d.id, d.veh || null, d.seat != null ? Number(d.seat) : null); break;
      case 'focus': app.focusEntity(d.id); break;
      case 'follow': app.followEntity(d.id); break;
      case 'unfollow': app.cam.stopFollow(); break;
      case 'shop-open': sim.shops_.setOpen(ent, true); break;
      case 'shop-close': sim.shops_.setOpen(ent, false); break;
      case 'shop-price': { const p = ent.products.find((x) => x.id === d.pid); sim.shops_.setPrice(ent, d.pid, p.price + Number(d.delta)); break; }
      case 'job-prioritize': sim.jobs_.prioritize(ent); break;
      case 'job-assign': sim.jobs_.assign(ent, sim.get(d.staff)); break;
      case 'toggle-mood': app.setMoodMarkers(!app.moodMarkers); break;
      case 'close-inspector': app.select(null); break;
      case 'view': this.setView(d.view); break;
    }
    this.render(true);
  }

  // ---------------------------------------------------------------- helpers
  ref(id, label) {
    const e = this.sim.get(id);
    if (!e) return esc(label || id);
    return `<a class="ref" data-ref="${id}">${esc(label || this.refLabel(e))}</a>`;
  }
  refLabel(e) {
    switch (e.kind) {
      case 'visitor': return `${e.id} · ${e.name}`;
      case 'staff': return `${e.id} · ${e.name}`;
      case 'ride': return e.name;
      case 'shop': return e.name;
      default: return e.id;
    }
  }
  linkify(text) {
    return esc(text).replace(ID_RE, (m) => (this.sim.get(m) ? `<a class="ref" data-ref="${m}">${m}</a>` : m));
  }
  pill(cls, text) { return `<span class="pill ${cls}">${esc(text)}</span>`; }
  bar(frac, cls = '') { return `<div class="bar ${cls}"><span style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></span></div>`; }
  moodColor(m) { return m >= 70 ? 'var(--ok)' : m >= 50 ? '#9cbf2f' : m >= 35 ? 'var(--warn)' : 'var(--bad)'; }
  events(list, n = 8) {
    const ev = (list || []).slice(-n).reverse();
    if (!ev.length) return '<div class="empty">No events yet.</div>';
    return `<div class="events">${ev.map((e) => `<div class="ev"><span class="t">${fmtClockSec(e.t)}</span><span>${this.linkify(e.text)}</span></div>`).join('')}</div>`;
  }
  chips(key, opts) {
    return `<div class="chips">${opts.map(([val, label, n]) => `<button class="chip ${this.filters[key] === val ? 'on' : ''}" data-action="filter" data-key="${key}" data-val="${val}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;
  }
  sel(id) { return this.app.selectedId === id ? 'sel' : ''; }
  nodeName(v) { return NODE_NAMES[v.node] || 'Park'; }

  // ---------------------------------------------------------------- top bar
  renderTop() {
    const sim = this.sim;
    document.getElementById('m-time').textContent = fmtClock(sim.time);
    document.getElementById('m-daystate').textContent = this.app.evening ? 'Evening' : 'Day';
    document.getElementById('m-guests').textContent = sim.visitors.length;
    document.getElementById('m-revenue').textContent = money(sim.revenue);
    const sat = sim.satisfaction();
    document.getElementById('m-sat').textContent = Math.round(sat) + '%';
    document.getElementById('m-satbar').style.width = Math.round(sat) + '%';
  }

  tick(dt) {
    this.timer -= dt;
    if (this.timer <= 0) { this.render(); this.timer = 0.25; }
  }

  render(force) {
    this.renderTop();
    if (this.view && this.panelOpen !== false) {
      const html = this.renderPanel();
      morphdom(this.panelBody, `<div id="panel-body" class="scroll">${html}</div>`, { childrenOnly: true });
    }
    const id = this.app.selectedId;
    const e = id ? this.sim.get(id) : null;
    if (e) {
      this.inspector.classList.remove('hidden');
      morphdom(this.inspectorBody, `<div id="inspector-body" class="scroll">${this.renderInspector(e)}</div>`, { childrenOnly: true });
    } else {
      this.inspector.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------- panels
  renderPanel() {
    switch (this.view) {
      case 'overview': return this.panelOverview();
      case 'rides': return this.panelRides();
      case 'guests': return this.panelGuests();
      case 'staff': return this.panelStaff();
      case 'shops': return this.panelShops();
    }
    return '';
  }

  rideRow(r) {
    const [cls, label] = RIDE_STATUS[r.statusKey()];
    return `<div class="row ${this.sel(r.id)}" data-ref="${r.id}">
      <span class="dot bg-${cls === 'muted' ? 'muted' : cls}"></span>
      <div class="row-main"><div class="row-title">${esc(r.name)} <span class="id">${r.id}</span></div>
      <div class="row-sub">${esc(label)} · ${esc(r.phaseLabel())}</div></div>
      <div class="row-side"><b>${r.admitting ? fmtWait(r.postedWait()) : '—'}</b><br>${r.queue.length} in queue</div></div>`;
  }

  panelOverview() {
    const sim = this.sim;
    const counts = { walking: 0, queuing: 0, riding: 0, shopping: 0, resting: 0, waiting: 0, leaving: 0 };
    for (const v of sim.visitors) counts[sim.visitors_.activityKey(v)] = (counts[sim.visitors_.activityKey(v)] || 0) + 1;
    const alerts = [];
    for (const r of sim.rides) {
      if (r.maint) { const j = sim.get(r.maint.jobId); alerts.push(`<div class="row" data-ref="${j.id}"><span class="dot bg-warn"></span><div class="row-main"><div class="row-title">${esc(r.name)} maintenance</div><div class="row-sub">${j.id} · ${esc(j.stage)}</div></div></div>`); }
      if (!r.open) alerts.push(`<div class="row" data-ref="${r.id}"><span class="dot bg-muted"></span><div class="row-main"><div class="row-title">${esc(r.name)} closed</div><div class="row-sub">Closed by the park manager</div></div></div>`);
    }
    for (const s of sim.shops) {
      if (s.replenish) { const d = sim.get(s.replenish); alerts.push(`<div class="row" data-ref="${d.id}"><span class="dot bg-info"></span><div class="row-main"><div class="row-title">${esc(s.name)} restock</div><div class="row-sub">${d.id} · ${esc(DELIV_STATUS[d.status][1])}</div></div></div>`); }
      if (s.blocked) alerts.push(`<div class="row" data-ref="${s.id}"><span class="dot bg-bad"></span><div class="row-main"><div class="row-title">${esc(s.name)} sold out</div><div class="row-sub">Customers waiting for a delivery</div></div></div>`);
    }
    const cleaning = sim.jobs.filter((j) => j.type === 'cleaning' && j.status !== 'completed');
    if (cleaning.length) alerts.push(`<div class="row" data-action="view" data-view="staff"><span class="dot bg-info"></span><div class="row-main"><div class="row-title">${cleaning.length} cleaning job${cleaning.length > 1 ? 's' : ''} open</div><div class="row-sub">${cleaning.map((j) => j.id).join(', ')}</div></div></div>`);
    const recent = sim.events.filter((e) => e.noteworthy).slice(-7).reverse();
    return `
      <div class="section"><div class="kpis">
        <div class="kpi"><div class="k-label">Guests in park</div><div class="k-value">${sim.visitors.length}</div><div class="k-sub">${sim.arrivedTotal} arrived · ${sim.departed} left</div></div>
        <div class="kpi"><div class="k-label">Satisfaction</div><div class="k-value" style="color:${this.moodColor(sim.satisfaction())}">${Math.round(sim.satisfaction())}%</div><div class="k-sub">Average guest mood</div></div>
        <div class="kpi"><div class="k-label">Ride revenue</div><div class="k-value">${money(sim.finance.rides)}</div><div class="k-sub">${sim.rides.reduce((a, r) => a + r.ridersTotal, 0)} riders</div></div>
        <div class="kpi"><div class="k-label">Shop revenue</div><div class="k-value">${money(sim.finance.shops)}</div><div class="k-sub">${sim.orders.filter((o) => o.status === 'collected').length} orders</div></div>
      </div></div>
      <div class="section"><div class="section-title">Guests right now</div>
        <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
          <div class="kpi"><div class="k-label">Riding</div><div class="k-value">${counts.riding}</div></div>
          <div class="kpi"><div class="k-label">Queuing</div><div class="k-value">${counts.queuing}</div></div>
          <div class="kpi"><div class="k-label">Shopping</div><div class="k-value">${counts.shopping}</div></div>
          <div class="kpi"><div class="k-label">Walking</div><div class="k-value">${counts.walking}</div></div>
          <div class="kpi"><div class="k-label">Resting</div><div class="k-value">${counts.resting + counts.waiting}</div></div>
          <div class="kpi"><div class="k-label">Leaving</div><div class="k-value">${counts.leaving}</div></div>
        </div></div>
      <div class="section"><div class="section-title">Attractions</div><div class="list">${sim.rides.map((r) => this.rideRow(r)).join('')}</div></div>
      <div class="section"><div class="section-title">Shops</div><div class="list">${sim.shops.map((s) => this.shopRow(s)).join('')}</div></div>
      <div class="section"><div class="section-title">Needs attention <span class="count">${alerts.length}</span></div><div class="list">${alerts.join('') || '<div class="empty">Everything is running smoothly.</div>'}</div></div>
      <div class="section"><div class="section-title">Recent activity</div>${this.events(recent.reverse(), 7)}</div>`;
  }

  panelRides() {
    const sim = this.sim;
    const f = this.filters.rideStatus;
    const match = (r) => f === 'all' || (f === 'operating' && (r.statusKey() === 'operating' || r.statusKey() === 'maintPending')) || (f === 'closed' && (r.statusKey() === 'closed' || r.statusKey() === 'closing')) || (f === 'maintenance' && !!r.maint);
    const n = (k) => sim.rides.filter((r) => { const o = this.filters.rideStatus; this.filters.rideStatus = k; const m = match(r); this.filters.rideStatus = o; return m; }).length;
    const list = sim.rides.filter(match);
    return `${this.chips('rideStatus', [['all', 'All', 3], ['operating', 'Operating', n('operating')], ['closed', 'Closed', n('closed')], ['maintenance', 'Maintenance', n('maintenance')]])}
      <div class="list">${list.map((r) => {
        const [cls, label] = RIDE_STATUS[r.statusKey()];
        return `<div class="row ${this.sel(r.id)}" data-ref="${r.id}" style="align-items:flex-start">
          <div class="ins-icon" style="width:30px;height:30px;border-radius:9px;background:${RIDE_COLOR[r.id]};font-size:12px">${r.name[0]}</div>
          <div class="row-main"><div class="row-title">${esc(r.name)} <span class="id">${r.id}</span></div>
          <div class="row-sub">${this.pill(cls, label)}</div>
          <div class="row-sub">${esc(r.phaseLabel())}</div>
          <div class="row-sub">Riders ${r.seatedCount()}/${r.capacity()} · Queue ${r.queue.length}/${r.queueCap} · $${r.price}</div>
          <div style="margin-top:5px">${this.bar(r.condition / 100, r.condition < 40 ? 'bad' : r.condition < 60 ? 'warn' : 'ok')}</div>
          <div class="row-sub">Condition ${Math.round(r.condition)}% · ${r.ridersTotal} riders today</div></div>
          <div class="row-side"><b>${r.admitting ? fmtWait(r.postedWait()) : '—'}</b><br>wait</div></div>`;
      }).join('') || '<div class="empty">No rides match this filter.</div>'}</div>
      <div class="note" style="margin-top:10px">Select a ride to change its price, open or close it, request maintenance or ride along.</div>`;
  }

  panelGuests() {
    const sim = this.sim, vs = sim.visitors_;
    const tab = this.filters.guestTab;
    const tabs = `<div class="chips"><button class="chip ${tab === 'guests' ? 'on' : ''}" data-action="filter" data-key="guestTab" data-val="guests">Guests<span class="n">${sim.visitors.length}</span></button><button class="chip ${tab === 'groups' ? 'on' : ''}" data-action="filter" data-key="guestTab" data-val="groups">Groups<span class="n">${sim.parties.filter((p) => !p.done && p.members.length > 1).length}</span></button></div>`;
    const moodToggle = `<div class="toggle-row" data-action="toggle-mood"><span class="switch ${this.app.moodMarkers ? 'on' : ''}"></span>Show guest mood in the park</div>`;
    if (tab === 'groups') {
      const parties = sim.parties.filter((p) => !p.done && p.members.length > 1);
      return tabs + moodToggle + `<div class="list">${parties.map((p) => {
        const ms = p.members.map((id) => sim.get(id)).filter((m) => m && m.active);
        return `<div class="row ${this.sel(p.id)}" data-ref="${p.id}"><div class="occ">${ms.map((m) => `<span class="dot" style="background:${hex(m.shirt)}"></span>`).join('')}</div>
          <div class="row-main"><div class="row-title">${p.id} <span class="id">${esc(p.label)} of ${p.members.length}</span></div><div class="row-sub">${esc(p.plan ? p.plan.label : 'Arriving')}</div></div></div>`;
      }).join('')}</div>`;
    }
    const act = this.filters.guestAct, mood = this.filters.guestMood;
    const counts = {};
    for (const v of sim.visitors) { const k = vs.activityKey(v); counts[k] = (counts[k] || 0) + 1; }
    const moodKey = (v) => (v.impatient || v.mood < 35 ? 'unhappy' : v.mood >= 70 ? 'happy' : 'content');
    const mc = { happy: 0, content: 0, unhappy: 0 };
    for (const v of sim.visitors) mc[moodKey(v)]++;
    let list = sim.visitors.filter((v) => (act === 'all' || vs.activityKey(v) === act) && (mood === 'all' || moodKey(v) === mood));
    list = list.slice().sort((a, b) => a.id.localeCompare(b.id));
    const shown = list.slice(0, 120);
    return tabs + this.chips('guestAct', [['all', 'All', sim.visitors.length], ['walking', 'Walking', counts.walking || 0], ['queuing', 'Queuing', counts.queuing || 0], ['riding', 'Riding', counts.riding || 0], ['shopping', 'Shopping', counts.shopping || 0], ['resting', 'Resting', counts.resting || 0], ['waiting', 'Waiting', counts.waiting || 0], ['leaving', 'Leaving', counts.leaving || 0]])
      + this.chips('guestMood', [['all', 'Any mood'], ['happy', 'Happy', mc.happy], ['content', 'Content', mc.content], ['unhappy', 'Unhappy / impatient', mc.unhappy]])
      + moodToggle
      + `<div class="list">${shown.map((v) => `<div class="row ${this.sel(v.id)}" data-ref="${v.id}">
          <span class="avatar" style="background:${hex(v.shirt)}">${esc(v.name[0])}</span>
          <div class="row-main"><div class="row-title">${esc(v.name)} <span class="id">${v.id}</span></div><div class="row-sub">${esc(vs.activity(v))}</div></div>
          <span class="dot" title="${esc(vs.moodLabel(v))}" style="background:${this.moodColor(v.impatient ? 30 : v.mood)}"></span></div>`).join('') || '<div class="empty">No guests match these filters.</div>'}</div>`;
  }

  panelStaff() {
    const sim = this.sim;
    const role = this.filters.staffRole, av = this.filters.staffAvail;
    const busy = (s) => !(s.state === 'available' || s.state === 'patrolling');
    const list = sim.staff.filter((s) => (role === 'all' || s.role === role) && (av === 'all' || (av === 'available' ? !busy(s) : busy(s))));
    const roleN = (r) => sim.staff.filter((s) => s.role === r).length;
    const jobs = sim.jobs.filter((j) => j.status !== 'completed').sort((a, b) => (a.status === 'pending') - (b.status === 'pending') || (b.priority === 'high') - (a.priority === 'high') || a.createdAt - b.createdAt);
    const done = sim.jobs.filter((j) => j.status === 'completed').slice(-6).reverse();
    return this.chips('staffRole', [['all', 'All', sim.staff.length], ['attendant', 'Attendants', roleN('attendant')], ['shop', 'Shop', roleN('shop')], ['mechanic', 'Mechanic', roleN('mechanic')], ['cleaner', 'Cleaners', roleN('cleaner')], ['delivery', 'Delivery', roleN('delivery')]])
      + this.chips('staffAvail', [['all', 'Any status'], ['available', 'Available'], ['busy', 'Busy']])
      + `<div class="list">${list.map((s) => `<div class="row ${this.sel(s.id)}" data-ref="${s.id}">
        <span class="avatar" style="background:${ROLE_COLOR[s.role]}">${esc(s.name[0])}</span>
        <div class="row-main"><div class="row-title">${esc(s.name)} <span class="id">${s.id} · ${esc(s.roleLabel)}</span></div><div class="row-sub">${esc(s.status)}</div>
        ${s.progress > 0 && s.progress < 1 ? `<div style="margin-top:4px">${this.bar(s.progress, 'info')}</div>` : ''}</div></div>`).join('') || '<div class="empty">No staff match these filters.</div>'}</div>
      <div class="section"><div class="section-title">Job board <span class="count">${jobs.length} open</span></div><div class="list">${jobs.map((j) => this.jobRow(j)).join('') || '<div class="empty">No open jobs.</div>'}</div></div>
      <div class="section"><div class="section-title">Recently completed</div><div class="list">${done.map((j) => this.jobRow(j)).join('') || '<div class="empty">Nothing completed yet.</div>'}</div></div>`;
  }

  jobRow(j) {
    const [cls, label] = JOB_STATUS[j.status];
    const who = j.assignedTo ? this.sim.get(j.assignedTo) : j.reservedFor ? this.sim.get(j.reservedFor) : null;
    return `<div class="row ${this.sel(j.id)}" data-ref="${j.id}"><span class="dot bg-${cls === 'muted' ? 'muted' : cls}"></span>
      <div class="row-main"><div class="row-title">${esc(j.title)} <span class="id">${j.id}</span></div>
      <div class="row-sub">${esc(label)}${j.priority === 'high' && j.status === 'pending' ? ' · high priority' : ''}${who ? ' · ' + esc(who.name) : ''}</div>
      ${j.status !== 'pending' && j.status !== 'completed' ? `<div style="margin-top:4px">${this.bar(j.progress, 'info')}</div>` : ''}</div></div>`;
  }

  shopRow(s) {
    const st = this.sim.shops_.status(s);
    const cls = !s.open ? 'muted' : s.blocked ? 'bad' : s.replenish ? 'warn' : 'ok';
    const low = s.products.filter((p) => p.stock <= p.max * 0.3).map((p) => p.name.toLowerCase());
    return `<div class="row ${this.sel(s.id)}" data-ref="${s.id}"><span class="dot bg-${cls}"></span>
      <div class="row-main"><div class="row-title">${esc(s.name)} <span class="id">${s.id}</span></div><div class="row-sub">${esc(st)}${low.length ? ' · low: ' + esc(low.join(', ')) : ''}</div></div>
      <div class="row-side"><b>${money(s.revenue)}</b><br>${s.queue.length} in line</div></div>`;
  }

  panelShops() {
    const sim = this.sim;
    const of = this.filters.orderStatus, df = this.filters.delivStatus;
    const orders = sim.orders.filter((o) => of === 'all' || o.status === of).slice(-30).reverse();
    const on = (st) => sim.orders.filter((o) => o.status === st).length;
    const dels = sim.deliveries.filter((d) => df === 'all' || d.status === df || (df === 'active' && d.status !== 'delivered')).slice().reverse();
    return `<div class="section"><div class="section-title">Shops</div><div class="list">${sim.shops.map((s) => `${this.shopRow(s)}<div style="padding:0 8px 6px 26px">${s.products.map((p) => `<div class="row-sub" style="display:flex;justify-content:space-between"><span>${esc(p.name)}</span><span>${p.stock}/${p.max}</span></div>${this.bar(p.stock / p.max, p.stock <= p.max * 0.3 ? 'bad' : p.stock <= p.max * 0.5 ? 'warn' : 'ok')}`).join('')}</div>`).join('')}</div></div>
      <div class="section"><div class="section-title">Deliveries <span class="count">${sim.deliveries.length}</span></div>
      ${this.chips('delivStatus', [['all', 'All'], ['active', 'Active', sim.deliveries.filter((d) => d.status !== 'delivered').length], ['requested', 'Requested'], ['loading', 'Loading'], ['in transit', 'In transit'], ['delivered', 'Delivered']])}
      <div class="list">${dels.map((d) => { const [c, l] = DELIV_STATUS[d.status]; return `<div class="row ${this.sel(d.id)}" data-ref="${d.id}"><span class="dot bg-${c === 'muted' ? 'muted' : c}"></span><div class="row-main"><div class="row-title">${d.id} <span class="id">→ ${esc(sim.get(d.shopId).name)}</span></div><div class="row-sub">${esc(l)} · ${d.items.map((i) => i.qty + '× ' + i.name.toLowerCase()).join(', ')}</div></div></div>`; }).join('') || '<div class="empty">No deliveries match.</div>'}</div></div>
      <div class="section"><div class="section-title">Orders <span class="count">${sim.orders.length} total</span></div>
      ${this.chips('orderStatus', [['all', 'All'], ['queued', 'Queued', on('queued')], ['preparing', 'Preparing', on('preparing')], ['collected', 'Collected', on('collected')], ['cancelled', 'Cancelled', on('cancelled')]])}
      <div class="list">${orders.map((o) => { const [c, l] = ORDER_STATUS[o.status]; const v = sim.get(o.visitorId); return `<div class="row ${this.sel(o.id)}" data-ref="${o.id}"><span class="dot bg-${c === 'muted' ? 'muted' : c}"></span><div class="row-main"><div class="row-title">${o.id} <span class="id">${esc(o.item)}</span></div><div class="row-sub">${esc(l)} · ${v ? esc(v.name) + ' (' + v.id + ')' : o.visitorId} · ${esc(sim.get(o.shopId).name)}</div></div><div class="row-side"><b>$${o.price}</b></div></div>`; }).join('') || '<div class="empty">No orders match.</div>'}</div></div>`;
  }

  // ---------------------------------------------------------------- inspector
  head(icon, color, name, kind, status, actions) {
    return `<div class="ins-head"><div class="ins-top"><div class="ins-icon" style="background:${color}">${icon}</div>
      <div class="ins-title"><div class="ins-name">${name}</div><div class="ins-kind">${kind}</div></div>
      <button class="icon-btn" data-action="close-inspector" title="Close">${ICONS.close.replace('<svg', '<svg width="14" height="14"')}</button></div>
      <div class="ins-status">${status}</div>${actions ? `<div class="ins-actions">${actions}</div>` : ''}</div>`;
  }
  focusBtns(id, canFollow = true) {
    const following = this.app.cam.followId === id;
    return `<button class="btn" data-action="focus" data-id="${id}">${ICONS.focus}Focus</button>` + (canFollow ? `<button class="btn ${following ? 'on' : ''}" data-action="${following ? 'unfollow' : 'follow'}" data-id="${id}">${ICONS.follow}${following ? 'Following' : 'Follow'}</button>` : '');
  }

  renderInspector(e) {
    switch (e.kind) {
      case 'visitor': return this.insVisitor(e);
      case 'group': return this.insGroup(e);
      case 'ride': return this.insRide(e);
      case 'vehicle': return e.vtype === 'train' ? this.insTrain(e) : this.insVehicle(e);
      case 'shop': return this.insShop(e);
      case 'order': return this.insOrder(e);
      case 'staff': return this.insStaff(e);
      case 'job': return this.insJob(e);
      case 'delivery': return this.insDelivery(e);
      case 'cart': return this.insCart(e);
      case 'place': return this.insPlace(e);
    }
    return '';
  }

  insVisitor(v) {
    const sim = this.sim, vs = sim.visitors_;
    const party = sim.get(v.partyId);
    const key = vs.activityKey(v);
    const [acls] = ACT_STYLE[key] || ['muted'];
    const groupLine = party && party.members.length > 1 ? `Guest · Group ${this.ref(party.id)} · ${esc(party.label)} of ${party.members.length}` : 'Guest · visiting solo';
    const status = this.pill(acls, vs.activity(v)) + this.pill(v.impatient || v.mood < 35 ? 'bad' : v.mood >= 70 ? 'ok' : 'warn', vs.moodLabel(v));
    const now = [];
    now.push(['Current activity', esc(vs.activity(v))]);
    if (!v.active) now.push(['Left the park', fmtClock(v.leftAt)]);
    if (v.dest && v.active) {
      const d = v.dest;
      let dest = d.id && sim.get(d.id) ? this.ref(d.id) : esc(d.label);
      if (d.type === 'ride') dest = `${this.ref(d.id)} <span class="sub">queue entrance</span>`;
      if (v.state === 'queuing' || v.state === 'boarding' || v.state === 'riding') dest = `${this.ref(v.queueRide || (v.seat && v.seat.rideId))} <span class="sub">${v.state === 'queuing' ? 'station' : 'seat'}</span>`;
      if (v.state === 'shopQueue' || v.state === 'ordering') dest = `${this.ref(v.queueShop || sim.get(v.order)?.shopId)} <span class="sub">counter</span>`;
      if (d.type === 'regroup' || d.type === 'enter') dest = esc(NODE_NAMES[d.node] || d.label);
      now.push(['Destination', dest]);
    }
    if (v.state === 'queuing') {
      const ride = sim.get(v.queueRide);
      const idx = ride.queue.indexOf(v.id);
      now.push(['Queue position', `${idx + 1} of ${ride.queue.length} · ${this.ref(ride.id)}`]);
      now.push(['Queue time', fmtDuration(sim.time - v.queueSince)]);
      now.push(['Est. to board', `~${fmtWait(ride.estimateWait(idx))}`]);
    }
    if (v.seat) {
      const ride = sim.get(v.seat.rideId);
      const chain = ride.rideType === 'coaster' ? `${this.ref('T-01')} → ${this.ref(v.seat.vehId)}` : this.ref(v.seat.vehId);
      now.push([v.state === 'boarding' ? 'Assigned seat' : 'Seat', `${this.ref(ride.id)} → ${chain} → seat ${v.seat.seat + 1}`]);
    }
    if (v.order) {
      const o = sim.get(v.order);
      now.push(['Order', `${this.ref(o.id)} · ${esc(o.item)} <span class="sub">(${o.status})</span>`]);
      if (v.state === 'shopQueue') { const s = sim.get(o.shopId); now.push(['Line position', `${s.queue.indexOf(v.id) + 1} of ${s.queue.length} · waited ${fmtDuration(sim.time - v.queueSince)}`]); }
    }
    if (v.active) now.push(['Near', esc(NODE_NAMES[sim.graph.nearest(v.x, v.z)] || 'Park')]);
    const remaining = v.budget - v.spent;
    const prefs = [];
    if (v.prefs.thrill > 0.65 && !v.kid) prefs.push('thrill rides');
    if (v.prefs.gentle > 0.6) prefs.push('gentle rides');
    if (v.prefs.snack > 0.7) prefs.push('snacks');
    const hunger = v.appetite > 0.7 ? 'Hungry' : v.appetite > 0.35 ? 'Peckish' : 'Satisfied';
    const visits = v.visited.slice().reverse();
    const buys = v.purchases.slice().reverse().map((id) => sim.get(id)).filter(Boolean);
    return this.head(esc(v.name[0]), hex(v.shirt), `${esc(v.name)} <span class="id">${v.id}</span>`, groupLine, status, v.active ? this.focusBtns(v.id) : '')
      + `<div class="ins-sec"><div class="kv">${now.map(([k, val]) => `<div class="k">${k}</div><div class="v">${val}</div>`).join('')}</div></div>
      <div class="ins-sec"><div class="kv">
        <div class="k">Mood</div><div class="v">${esc(vs.moodLabel(v))} <span class="sub">${Math.round(v.mood)}/100</span>${this.bar(v.mood / 100, v.mood >= 70 ? 'ok' : v.mood >= 45 ? 'warn' : 'bad')}</div>
        <div class="k">Patience</div><div class="v">${v.patience > 1.15 ? 'Very patient' : v.patience > 0.8 ? 'Patient' : 'Impatient'} <span class="sub">tolerates ~${Math.round((160 + v.patience * 260) / 60)} min queues</span></div>
        <div class="k">Budget</div><div class="v">${money(v.spent)} spent of ${money(v.budget)} <span class="sub">(${money(remaining)} left)</span>${this.bar(v.spent / v.budget, 'info')}</div>
        <div class="k">Appetite</div><div class="v">${hunger}</div>
        <div class="k">Enjoys</div><div class="v">${prefs.length ? esc(prefs.join(', ')) : 'a bit of everything'}${v.kid ? ' <span class="sub">(child)</span>' : ''}</div>
        <div class="k">In park</div><div class="v">${fmtDuration((v.active ? sim.time : v.leftAt) - v.arrivedAt)} <span class="sub">since ${fmtClock(Math.max(v.arrivedAt, -3600))}</span></div>
      </div></div>
      <div class="ins-sec"><div class="section-title">Visited <span class="count">${visits.length}</span></div>
        ${visits.length ? `<div class="events">${visits.slice(0, 6).map((x) => `<div class="ev"><span class="t">${fmtClock(x.t)}</span><span>${this.ref(x.rideId)}${x.vehId ? ' · ' + this.ref(x.vehId) : ''}</span></div>`).join('')}</div>` : '<div class="empty">No rides yet.</div>'}</div>
      <div class="ins-sec"><div class="section-title">Purchases <span class="count">${money(buys.filter((o) => o.paid).reduce((a, o) => a + o.price, 0))}</span></div>
        ${buys.length ? `<div class="events">${buys.slice(0, 6).map((o) => `<div class="ev"><span class="t">${fmtClock(o.collectedAt ?? o.createdAt)}</span><span>${this.ref(o.id)} · ${esc(o.item)} · $${o.price} at ${this.ref(o.shopId)}</span></div>`).join('')}</div>` : '<div class="empty">Nothing bought yet.</div>'}</div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(v.events, 10)}</div>`;
  }

  insGroup(p) {
    const sim = this.sim, vs = sim.visitors_;
    const ms = p.members.map((id) => sim.get(id)).filter(Boolean);
    const active = ms.filter((m) => m.active);
    return this.head(esc(p.label[0]), '#7a6bd1', `Group <span class="id">${p.id}</span>`, `${esc(p.label)} of ${p.members.length}${active.length < ms.length ? ` · ${ms.length - active.length} left the park` : ''}`,
      this.pill('info', p.plan ? p.plan.label : 'Arriving'), active.length ? this.focusBtns(p.id) : '')
      + `<div class="ins-sec"><div class="section-title">Members</div><div class="list">${ms.map((m) => `<div class="row" data-ref="${m.id}"><span class="avatar" style="background:${hex(m.shirt)}">${esc(m.name[0])}</span><div class="row-main"><div class="row-title">${esc(m.name)} <span class="id">${m.id}</span></div><div class="row-sub">${esc(vs.activity(m))}</div></div><span class="dot" style="background:${this.moodColor(m.mood)}"></span></div>`).join('')}</div></div>
      <div class="ins-sec"><div class="kv">
        <div class="k">Current plan</div><div class="v">${esc(p.plan ? p.plan.label : '—')}${p.plan && p.plan.target && sim.get(p.plan.target) ? ' · ' + this.ref(p.plan.target) : ''}</div>
        <div class="k">Decided at</div><div class="v">${p.plan ? fmtClock(p.plan.since) : '—'}</div>
        <div class="k">Spent together</div><div class="v">${money(ms.reduce((a, m) => a + m.spent, 0))}</div>
        <div class="k">Average mood</div><div class="v">${Math.round(ms.reduce((a, m) => a + m.mood, 0) / ms.length)}/100</div>
      </div><div class="note">Groups decide together, queue together where they can, and wait for each other after rides and purchases.</div></div>
      <div class="ins-sec"><div class="section-title">Plan history</div>${p.planHistory.length ? `<div class="events">${p.planHistory.slice().reverse().slice(0, 8).map((h) => `<div class="ev"><span class="t">${fmtClock(h.t)}</span><span>${esc(h.label)}</span></div>`).join('')}</div>` : '<div class="empty">—</div>'}</div>`;
  }

  insRide(r) {
    const sim = this.sim;
    const [cls, label] = RIDE_STATUS[r.statusKey()];
    const type = { coaster: 'Roller coaster', wheel: 'Observation wheel', carousel: 'Carousel' }[r.rideType];
    const maintJob = r.maint ? sim.get(r.maint.jobId) : null;
    const mech = maintJob && maintJob.assignedTo ? sim.get(maintJob.assignedTo) : null;
    const actions = `${r.open ? `<button class="btn" data-action="ride-close" data-id="${r.id}">Close ride</button>` : `<button class="btn primary" data-action="ride-open" data-id="${r.id}">Open ride</button>`}
      <button class="btn" data-action="ride-along" data-id="${r.id}">${ICONS.ride}Ride along</button>${this.focusBtns(r.id, false)}`;
    let vehicles = '';
    if (r.rideType === 'coaster') {
      vehicles = `<div class="veh" data-ref="T-01"><b>Train T-01</b><span class="sub" style="color:var(--muted)">${r.phase === 'running' ? Math.round(r.speedKmh()) + ' km/h' : 'in station'}</span></div>`
        + r.vehicles.map((c) => this.vehRow(c, `Car ${c.id}`)).join('');
    } else {
      vehicles = r.vehicles.map((c) => this.vehRow(c, r.rideType === 'wheel' ? `Cabin ${c.id}` : `${c.id} “${c.horse}”`)).join('');
    }
    const q = r.queue.slice(0, 10).map((id, i) => { const v = sim.get(id); return `<div class="row" data-ref="${id}"><span class="id" style="width:20px">${i + 1}</span><span class="avatar" style="width:20px;height:20px;font-size:9px;background:${hex(v.shirt)}">${esc(v.name[0])}</span><div class="row-main"><div class="row-title" style="font-weight:600">${esc(v.name)} <span class="id">${v.id}</span></div></div><div class="row-side">${fmtDuration(sim.time - v.queueSince)}</div></div>`; }).join('');
    const maintBtnDisabled = !!r.maint;
    return this.head(r.name[0], RIDE_COLOR[r.id], `${esc(r.name)} <span class="id">${r.id}</span>`, `${type} · ${r.capacity()} seats`, this.pill(cls, label) + this.pill('muted', r.phaseLabel()), actions)
      + `<div class="ins-sec">
        <div class="control-row"><span class="lbl">Ticket price</span><span class="stepper"><button data-action="ride-price" data-id="${r.id}" data-delta="-1" ${r.price <= 0 ? 'disabled' : ''}>−</button><span class="val">$${r.price}</span><button data-action="ride-price" data-id="${r.id}" data-delta="1" ${r.price >= 30 ? 'disabled' : ''}>+</button></span></div>
        <div class="note">Applies to new boardings. Guests consider about $${r.fairPrice} fair; higher prices shrink demand and mood.</div>
        <div class="control-row"><span class="lbl">Maintenance</span><button class="btn small" data-action="ride-maint" data-id="${r.id}" ${maintBtnDisabled ? 'disabled' : ''}>${ICONS.wrench}Request</button></div>
        ${maintJob ? `<div class="note warn">${this.ref(maintJob.id)} · ${esc(maintJob.stage)}${mech ? ' · ' + this.ref(mech.id) : ''} — already requested.</div>${maintJob.status === 'working' ? this.bar(maintJob.progress, 'warn') : ''}` : ''}
        ${!r.open ? `<div class="note">Closed to new guests${r.isEmpty() ? '' : ' — riders on board are finishing their cycle'}.</div>` : ''}
      </div>
      <div class="ins-sec"><div class="kv">
        <div class="k">Cycle</div><div class="v">${esc(r.phaseLabel())}${this.bar(r.cycleProgress(), 'info')}</div>
        <div class="k">On board</div><div class="v">${r.seatedCount()} / ${r.capacity()}${r.boarders.size ? ` <span class="sub">(${r.boarders.size} boarding)</span>` : ''}</div>
        <div class="k">Queue</div><div class="v">${r.queue.length} / ${r.queueCap} guests</div>
        <div class="k">Posted wait</div><div class="v">${r.admitting ? fmtWait(r.postedWait()) : 'Not admitting'}</div>
        <div class="k">Recent waits</div><div class="v">${r.waitSamples.length ? fmtDuration(r.avgWaitObserved()) + ' <span class="sub">avg of last ' + r.waitSamples.length + '</span>' : '—'}</div>
        <div class="k">Riders today</div><div class="v">${r.ridersTotal} <span class="sub">· ${r.cycles} cycles</span></div>
        <div class="k">Revenue</div><div class="v">${money(r.revenue)}</div>
        <div class="k">Condition</div><div class="v">${Math.round(r.condition)}%${this.bar(r.condition / 100, r.condition < 40 ? 'bad' : r.condition < 60 ? 'warn' : 'ok')}</div>
        <div class="k">Attendant</div><div class="v">${r.attendantId ? this.ref(r.attendantId) : '—'}</div>
      </div></div>
      <div class="ins-sec"><div class="section-title">${r.rideType === 'coaster' ? 'Train & cars' : r.rideType === 'wheel' ? 'Cabins' : 'Horses'}</div><div class="veh-grid">${vehicles}</div></div>
      <div class="ins-sec"><div class="section-title">Queue <span class="count">${r.queue.length}</span></div><div class="list">${q || '<div class="empty">Nobody waiting.</div>'}${r.queue.length > 10 ? `<div class="more">and ${r.queue.length - 10} more…</div>` : ''}</div></div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(r.events, 8)}</div>`;
  }

  vehRow(c, label) {
    return `<div class="veh ${this.sel(c.id)}" data-ref="${c.id}"><span style="flex:1;font-weight:600">${esc(label)}</span><span class="occ">${c.seats.map((s) => `<i class="${s ? 'f' : ''}"></i>`).join('')}</span><span class="id" style="width:26px;text-align:right">${c.seats.filter(Boolean).length}/${c.seats.length}</span></div>`;
  }

  insTrain(t) {
    const sim = this.sim, r = sim.get(t.rideId);
    const tr = r.track;
    const h = tr.height(t.s);
    return this.head('T', RIDE_COLOR[r.id], `Train <span class="id">T-01</span>`, `${this.ref(r.id)} · 5 cars · 20 seats`, this.pill(r.phase === 'running' ? 'ok' : 'info', r.phaseLabel()),
      `<button class="btn" data-action="ride-along" data-id="${r.id}" data-veh="C-01">${ICONS.ride}Ride along</button>` + this.focusBtns('T-01'))
      + `<div class="ins-sec"><div class="kv"><div class="k">Speed</div><div class="v">${Math.round(r.speedKmh())} km/h</div><div class="k">Height</div><div class="v">${h.toFixed(1)} m</div><div class="k">Riders</div><div class="v">${r.seatedCount()} / 20</div><div class="k">Lap</div><div class="v">${Math.round(r.cycleProgress() * 100)}%${this.bar(r.cycleProgress(), 'info')}</div></div></div>
      <div class="ins-sec"><div class="section-title">Cars</div><div class="veh-grid">${r.vehicles.map((c) => this.vehRow(c, `Car ${c.id}`)).join('')}</div></div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(r.events.filter((e) => e.refs.includes('T-01')), 8)}</div>`;
  }

  insVehicle(c) {
    const sim = this.sim, r = sim.get(c.rideId);
    let kind = '', info = [];
    if (c.vtype === 'car') {
      kind = `${this.ref(r.id)} · ${this.ref('T-01')} · car ${c.index + 1} of 5`;
      info.push(['Speed', `${Math.round(r.speedKmh())} km/h`], ['Height', `${r.track.height(r.carS(c.index)).toFixed(1)} m`], ['Ride phase', esc(r.phaseLabel())]);
    } else if (c.vtype === 'cabin') {
      const p = r.cabinPos(c.index, new (r.hub.constructor)());
      kind = `${this.ref(r.id)} · cabin ${c.index + 1} of ${r.n}`;
      const atPlat = r.phase === 'exchange' && r.stopIndex === c.index && r.sub === 'dwell';
      info.push(['Height', `${Math.max(0, p.y).toFixed(1)} m`], ['Position', atPlat ? 'At the platform' : 'On the wheel'], ['Ride phase', esc(r.phaseLabel())]);
    } else {
      kind = `${this.ref(r.id)} · ${c.radius > 5 ? 'outer' : 'inner'} ring`;
      info.push(['Horse', esc(c.horse)], ['Ride phase', esc(r.phaseLabel())]);
    }
    const seats = c.seats.map((id, i) => {
      if (!id) return `<div class="seat empty"><div class="sn">Seat ${i + 1}</div>Empty</div>`;
      const v = sim.get(id);
      return `<div class="seat"><div class="sn">Seat ${i + 1}</div>${this.ref(id, v.name + ' · ' + id)}<div class="row-sub">${v.state === 'boarding' ? 'Boarding…' : esc(sim.visitors_.moodLabel(v))}</div></div>`;
    }).join('');
    const canRide = true;
    return this.head(c.id.split('-')[0], RIDE_COLOR[r.id], `${esc(c.name)}`, kind, this.pill('info', `${c.seats.filter(Boolean).length}/${c.seats.length} occupied`),
      (canRide ? `<button class="btn" data-action="ride-along" data-id="${r.id}" data-veh="${c.id}">${ICONS.ride}Ride along</button>` : '') + this.focusBtns(c.id))
      + `<div class="ins-sec"><div class="kv">${info.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div></div>
      <div class="ins-sec"><div class="section-title">Passengers</div><div class="seats" style="${c.seats.length === 1 ? 'grid-template-columns:1fr' : ''}">${seats}</div></div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(c.events, 8)}</div>`;
  }

  insShop(s) {
    const sim = this.sim;
    const st = sim.shops_.status(s);
    const cls = !s.open ? 'muted' : s.blocked ? 'bad' : 'ok';
    const worker = sim.get(s.workerId);
    const cur = s.current ? sim.get(s.current) : null;
    const d = s.replenish ? sim.get(s.replenish) : null;
    const recent = s.completed.slice(0, 6).map((id) => sim.get(id));
    const q = s.queue.map((id, i) => { const v = sim.get(id); const o = sim.get(v.order); return `<div class="row" data-ref="${id}"><span class="id" style="width:18px">${i + 1}</span><div class="row-main"><div class="row-title" style="font-weight:600">${esc(v.name)} <span class="id">${v.id}</span></div><div class="row-sub">${o ? `${o.id} · ${esc(o.item)}` : ''}</div></div><div class="row-side">${fmtDuration(sim.time - v.queueSince)}</div></div>`; }).join('');
    return this.head(s.name[0], s.id === 'K-01' ? '#e2495b' : '#2f7fd0', `${esc(s.name)} <span class="id">${s.id}</span>`, 'Refreshment shop', this.pill(cls, st),
      (s.open ? `<button class="btn" data-action="shop-close" data-id="${s.id}">Close shop</button>` : `<button class="btn primary" data-action="shop-open" data-id="${s.id}">Open shop</button>`) + this.focusBtns(s.id, false))
      + `<div class="ins-sec"><div class="section-title">Products & inventory</div>${s.products.map((p) => `<div class="prod"><div><div class="pn">${esc(p.name)}</div><div class="ps">${p.stock} of ${p.max} in stock · ${p.sold} sold</div></div>
        <span class="stepper"><button data-action="shop-price" data-id="${s.id}" data-pid="${p.id}" data-delta="-1" ${p.price <= 1 ? 'disabled' : ''}>−</button><span class="val">$${p.price}</span><button data-action="shop-price" data-id="${s.id}" data-pid="${p.id}" data-delta="1" ${p.price >= 20 ? 'disabled' : ''}>+</button></span>
        ${this.bar(p.stock / p.max, p.stock <= p.max * 0.3 ? 'bad' : p.stock <= p.max * 0.5 ? 'warn' : 'ok')}</div>`).join('')}</div>
      <div class="ins-sec"><div class="kv">
        <div class="k">Shop worker</div><div class="v">${worker ? this.ref(worker.id) : '—'} <span class="sub">${worker ? esc(worker.status) : ''}</span></div>
        <div class="k">Preparing</div><div class="v">${cur ? `${this.ref(cur.id)} · ${esc(cur.item)} for ${this.ref(cur.visitorId)}${this.bar(s.prepProgress, 'info')}` : '—'}</div>
        <div class="k">Revenue</div><div class="v">${money(s.revenue)} <span class="sub">· ${s.served} served · ${s.cancelled} cancelled</span></div>
        <div class="k">Replenishment</div><div class="v">${d ? `${this.ref(d.id)} · ${esc(DELIV_STATUS[d.status][1])}${d.workerId ? ' · ' + this.ref(d.workerId) : ''}` : '<span class="sub">Stock OK — restock is requested automatically at 30%</span>'}</div>
      </div></div>
      <div class="ins-sec"><div class="section-title">Line <span class="count">${s.queue.length}</span></div><div class="list">${q || '<div class="empty">No customers waiting.</div>'}</div></div>
      <div class="ins-sec"><div class="section-title">Recent orders</div>${recent.length ? `<div class="events">${recent.map((o) => `<div class="ev"><span class="t">${fmtClock(o.collectedAt)}</span><span>${this.ref(o.id)} · ${esc(o.item)} · $${o.price} · ${this.ref(o.visitorId)}</span></div>`).join('')}</div>` : '<div class="empty">No completed orders yet.</div>'}</div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(s.events.filter((e) => !e.text.startsWith('Order')), 6)}</div>`;
  }

  insOrder(o) {
    const sim = this.sim;
    const [cls, label] = ORDER_STATUS[o.status];
    const steps = [['queued', 'Queued', o.createdAt], ['preparing', 'Preparing', o.preparedAt], ['collected', 'Collected', o.collectedAt]];
    const idx = { queued: 0, preparing: 1, collected: 2, cancelled: -1 }[o.status];
    return this.head('O', '#7d6b55', `Order <span class="id">${o.id}</span>`, `${this.ref(o.shopId)}`, this.pill(cls, label), o.status !== 'collected' && o.status !== 'cancelled' ? this.focusBtns(o.visitorId, false).replace(`data-id="${o.visitorId}"`, `data-id="${o.visitorId}"`) : '')
      + `<div class="ins-sec"><div class="kv">
        <div class="k">Customer</div><div class="v">${this.ref(o.visitorId)}</div>
        <div class="k">Shop</div><div class="v">${this.ref(o.shopId)}</div>
        <div class="k">Item</div><div class="v">${esc(o.item)}</div>
        <div class="k">Price</div><div class="v">$${o.price} <span class="sub">${o.paid ? '· paid at collection' : o.status === 'cancelled' ? '· not charged' : '· charged at collection'}</span></div>
      </div></div>
      <div class="ins-sec"><div class="section-title">Lifecycle</div><div class="timeline">${o.status === 'cancelled' ? `<div class="tl done"><span class="b"></span>Queued<span>${fmtClockSec(o.createdAt)}</span></div><div class="tl cur"><span class="b"></span>Cancelled — guest left the line<span></span></div>` : steps.map(([k, l, t], i) => `<div class="tl ${i < idx || (i === idx && k === 'collected') ? 'done' : i === idx ? 'cur' : ''}"><span class="b"></span>${l}<span>${t != null ? fmtClockSec(t) : ''}</span></div>`).join('')}</div></div>
      <div class="ins-sec"><div class="section-title">Events</div>${this.events(o.events, 6)}</div>`;
  }

  insStaff(s) {
    const sim = this.sim;
    const job = s.jobId ? sim.get(s.jobId) : null;
    const busy = !(s.state === 'available' || s.state === 'patrolling');
    const status = this.pill(busy ? 'info' : 'ok', busy ? (job ? JOB_STATUS[job.status][1] : 'On duty') : s.state === 'patrolling' ? 'Available · patrolling' : 'Available');
    let current = '';
    if (s.role === 'attendant') {
      const r = sim.get(s.post);
      current = `<div class="kv"><div class="k">Post</div><div class="v">${this.ref(r.id)}</div><div class="k">Doing</div><div class="v">${esc(s.status)}${this.bar(s.progress || 0, 'info')}</div><div class="k">Riders today</div><div class="v">${r.ridersTotal}</div></div>`;
    } else if (s.role === 'shop') {
      const sh = sim.get(s.post);
      current = `<div class="kv"><div class="k">Post</div><div class="v">${this.ref(sh.id)}</div><div class="k">Doing</div><div class="v">${this.linkify(s.status)}${sh.current ? this.bar(sh.prepProgress, 'info') : ''}</div><div class="k">Served today</div><div class="v">${sh.served}</div></div>`;
    } else if (job) {
      current = `<div class="kv"><div class="k">Current job</div><div class="v">${this.ref(job.id)} · ${esc(job.title)}</div><div class="k">Target</div><div class="v">${this.ref(job.targetId)}</div><div class="k">Stage</div><div class="v">${esc(job.stage)}${this.bar(job.progress, 'info')}</div><div class="k">Started</div><div class="v">${fmtClock(job.startedAt)}</div></div>`;
    } else {
      current = `<div class="kv"><div class="k">Doing</div><div class="v">${esc(s.status)}</div></div>`;
    }
    let pending = '';
    if (['mechanic', 'cleaner', 'delivery'].includes(s.role)) {
      const list = sim.jobs_.pendingFor(s.role);
      pending = `<div class="ins-sec"><div class="section-title">Pending ${esc(ROLE_LABEL[s.role].toLowerCase())} jobs <span class="count">${list.length}</span></div>${list.length ? `<div class="list">${list.map((j) => `<div class="row" data-ref="${j.id}"><div class="row-main"><div class="row-title">${esc(j.title)} <span class="id">${j.id}</span></div><div class="row-sub">${j.reservedFor ? 'Assigned to ' + esc(sim.get(j.reservedFor).name) : 'Unassigned'}${j.priority === 'high' ? ' · high priority' : ''} · waiting ${fmtDuration(sim.time - j.createdAt)}</div></div>${j.reservedFor === s.id ? '<span class="pill ok">Next</span>' : `<button class="btn small" data-action="job-assign" data-id="${j.id}" data-staff="${s.id}">Do next</button>`}</div>`).join('')}</div>` : '<div class="empty">No pending jobs for this role.</div>'}</div>`;
    }
    const hist = s.history;
    return this.head(esc(s.name[0]), ROLE_COLOR[s.role], `${esc(s.name)} <span class="id">${s.id}</span>`, esc(s.roleLabel), status, this.focusBtns(s.id))
      + `<div class="ins-sec">${current}</div>${pending}
      <div class="ins-sec"><div class="section-title">Completed jobs <span class="count">${hist.length}</span></div>${hist.length ? `<div class="events">${hist.map((h) => `<div class="ev"><span class="t">${fmtClock(h.t)}</span><span>${this.ref(h.jobId)} · ${esc(h.title)} <span style="color:var(--faint)">(${fmtDuration(h.duration)})</span></span></div>`).join('')}</div>` : '<div class="empty">None yet today.</div>'}</div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(s.events, 8)}</div>`;
  }

  insJob(j) {
    const sim = this.sim;
    const [cls, label] = JOB_STATUS[j.status];
    const who = j.assignedTo ? sim.get(j.assignedTo) : null;
    const reserved = j.reservedFor ? sim.get(j.reservedFor) : null;
    const type = { maintenance: 'Maintenance job', delivery: 'Delivery job', cleaning: 'Cleaning job' }[j.type];
    const candidates = sim.staff.filter((s) => s.role === j.role);
    let assign = '';
    if (j.status === 'pending') {
      assign = `<div class="ins-sec"><div class="section-title">Assign</div><div class="note">The job goes to the next available ${esc(ROLE_LABEL[j.role].toLowerCase())}. Assigning reserves it for that person and makes it their next job.</div>
        <div class="assign">${candidates.map((s) => `<button class="btn small ${j.reservedFor === s.id ? 'on' : ''}" data-action="job-assign" data-id="${j.id}" data-staff="${s.id}" ${j.reservedFor === s.id ? 'disabled' : ''}>${esc(s.name)} · ${s.id}</button>`).join('')}</div>
        <div class="assign">${candidates.map((s) => `<div class="row-sub" style="width:100%">${this.ref(s.id)}: ${esc(s.status)}</div>`).join('')}</div></div>`;
    }
    const target = sim.get(j.targetId) || sim.litter.find((l) => l.id === j.targetId);
    const targetHtml = j.type === 'cleaning' ? esc(target ? target.name : j.targetId) : this.ref(j.targetId);
    return this.head('J', j.type === 'maintenance' ? '#f07f22' : j.type === 'delivery' ? '#8a6a3c' : '#3fa66b', `${esc(j.title)} <span class="id">${j.id}</span>`, type, this.pill(cls, label) + (j.priority === 'high' && j.status !== 'completed' ? this.pill('bad', 'High priority') : ''),
      (j.status === 'pending' && j.priority !== 'high' ? `<button class="btn" data-action="job-prioritize" data-id="${j.id}">Prioritize</button>` : '') + (who && j.status !== 'completed' ? this.focusBtns(who.id) : ''))
      + `<div class="ins-sec"><div class="kv">
        <div class="k">Target</div><div class="v">${targetHtml}</div>
        <div class="k">Requested by</div><div class="v">${j.source === 'manager' ? 'Park manager' : 'Automatic'} <span class="sub">at ${fmtClockSec(j.createdAt)}</span></div>
        <div class="k">Assigned to</div><div class="v">${who ? this.ref(who.id) : reserved ? this.ref(reserved.id) + ' <span class="sub">(next)</span>' : '<span class="sub">Waiting for an available worker</span>'}</div>
        <div class="k">Stage</div><div class="v">${esc(j.stage)}${j.status !== 'pending' ? this.bar(j.progress, j.status === 'completed' ? 'ok' : 'info') : ''}</div>
        ${j.startedAt != null ? `<div class="k">Started</div><div class="v">${fmtClockSec(j.startedAt)}</div>` : ''}
        ${j.completedAt != null ? `<div class="k">Completed</div><div class="v">${fmtClockSec(j.completedAt)} <span class="sub">(${fmtDuration(j.completedAt - j.startedAt)})</span></div>` : ''}
      </div>${j.status === 'pending' && j.priority !== 'high' ? '' : j.status === 'pending' ? '<div class="note">High priority — taken before other pending jobs.</div>' : '<div class="note">Already accepted, so it can no longer be reassigned.</div>'}</div>
      ${assign}
      <div class="ins-sec"><div class="section-title">Events</div>${this.events(j.events, 8)}</div>`;
  }

  insDelivery(d) {
    const sim = this.sim;
    const [cls, label] = DELIV_STATUS[d.status];
    const order = ['requested', 'loading', 'in transit', 'unloading', 'delivered'];
    const idx = order.indexOf(d.status);
    const moving = d.status === 'loading' || d.status === 'in transit' || d.status === 'unloading';
    return this.head('D', '#8a6a3c', `Delivery <span class="id">${d.id}</span>`, `Shipment · Service Depot → ${this.ref(d.shopId)}`, this.pill(cls, label), moving ? this.focusBtns('V-01') : this.focusBtns(d.shopId, false))
      + `<div class="ins-sec"><div class="section-title">Contents</div>${d.items.map((i) => `<div class="prod"><div class="pn">${esc(i.name)}</div><div class="ps">${i.qty} units</div></div>`).join('')}</div>
      <div class="ins-sec"><div class="kv">
        <div class="k">Origin</div><div class="v">Service Depot</div>
        <div class="k">Destination</div><div class="v">${this.ref(d.shopId)}</div>
        <div class="k">Job</div><div class="v">${this.ref(d.jobId)}</div>
        <div class="k">Driver</div><div class="v">${d.workerId ? this.ref(d.workerId) : '<span class="sub">Not assigned yet</span>'}</div>
        <div class="k">Cart</div><div class="v">${d.cartId ? this.ref(d.cartId, 'V-01 · delivery cart') : '—'}</div>
        <div class="k">Requested</div><div class="v">${fmtClockSec(d.createdAt)}</div>
        ${d.deliveredAt != null ? `<div class="k">Delivered</div><div class="v">${fmtClockSec(d.deliveredAt)}</div>` : ''}
      </div></div>
      <div class="ins-sec"><div class="section-title">Progress</div><div class="timeline">${order.map((k, i) => `<div class="tl ${i < idx || (k === 'delivered' && idx === 4) ? 'done' : i === idx ? 'cur' : ''}"><span class="b"></span>${DELIV_STATUS[k][1]}<span></span></div>`).join('')}</div></div>
      <div class="ins-sec"><div class="section-title">Events</div>${this.events(d.events, 8)}</div>`;
  }

  insCart(c) {
    const sim = this.sim;
    const d = c.cargo ? sim.get(c.cargo) : null;
    const driver = sim.staff.find((s) => s.role === 'delivery');
    return this.head('V', '#2f7d6d', `Delivery cart <span class="id">V-01</span>`, 'Electric utility cart · Service Depot', this.pill(c.state === 'moving' ? 'info' : 'muted', c.state === 'moving' ? 'Moving' : 'Parked'), this.focusBtns('V-01'))
      + `<div class="ins-sec"><div class="kv">
        <div class="k">Driver</div><div class="v">${this.ref(driver.id)} <span class="sub">${esc(driver.status)}</span></div>
        <div class="k">Shipment</div><div class="v">${d ? `${this.ref(d.id)} · ${esc(DELIV_STATUS[d.status][1])} → ${this.ref(d.shopId)}` : '<span class="sub">Empty</span>'}</div>
        <div class="k">Location</div><div class="v">${esc(NODE_NAMES[sim.graph.nearest(c.x, c.z, 'staff')] || '')}</div>
      </div><div class="note">The cart uses the service roads and crosses Marigold Boulevard at the marked service crossing.</div></div>
      <div class="ins-sec"><div class="section-title">Recent events</div>${this.events(c.events, 8)}</div>`;
  }

  insPlace(p) {
    const sim = this.sim;
    if (p.id === 'GATE') {
      return this.head('E', '#2c7c76', 'Entrance & exit', 'Main gate · turnstiles and ticket booths', this.pill('ok', 'Open'), this.focusBtns('GATE', false))
        + `<div class="ins-sec"><div class="kv"><div class="k">Arrived today</div><div class="v">${sim.arrivedTotal}</div><div class="k">Left today</div><div class="v">${sim.departed}</div><div class="k">In park</div><div class="v">${sim.visitors.length}</div>
        <div class="k">Arriving now</div><div class="v">${sim.visitors.filter((v) => v.walk && v.walk.purpose === 'enter').length}</div><div class="k">Heading home</div><div class="v">${sim.visitors.filter((v) => v.state === 'leaving').length}</div></div></div>`;
    }
    const active = sim.deliveries.filter((d) => d.status !== 'delivered');
    return this.head('S', '#2b3a55', 'Service Depot', 'Workshop · stores · cart garage', this.pill('ok', 'Staff only'), this.focusBtns('DEPOT', false))
      + `<div class="ins-sec"><div class="kv"><div class="k">Based here</div><div class="v">${sim.staff.filter((s) => s.role === 'mechanic' || s.role === 'delivery').map((s) => this.ref(s.id)).join(', ')}</div>
      <div class="k">Cart</div><div class="v">${this.ref('V-01', 'V-01 · delivery cart')}</div>
      <div class="k">Active deliveries</div><div class="v">${active.map((d) => this.ref(d.id)).join(', ') || '<span class="sub">None</span>'}</div>
      <div class="k">Delivered today</div><div class="v">${sim.deliveries.filter((d) => d.status === 'delivered').length}</div></div></div>`;
  }

  // ---------------------------------------------------------------- feed
  pushFeed(ev) {
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.innerHTML = `<span class="t">${fmtClock(ev.t)}</span><span>${this.linkify(ev.text)}</span>`;
    this.feed.appendChild(el);
    while (this.feed.children.length > 3) this.feed.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 700); }, 7500);
  }

  // ---------------------------------------------------------------- search
  search(q) {
    const results = document.getElementById('search-results');
    q = q.trim().toLowerCase();
    if (!q) { results.classList.remove('open'); return; }
    const sim = this.sim;
    const out = [];
    const push = (e, kind, title, sub) => out.push({ id: e.id, kind, title, sub });
    for (const [id, e] of sim.entities) {
      if (out.length > 40) break;
      const name = (e.name || e.title || e.item || '').toLowerCase();
      if (!(id.toLowerCase().startsWith(q) || id.toLowerCase().replace('-', '') === q.replace('-', '') || (name && name.includes(q)))) continue;
      if (id.startsWith('_')) continue;
      switch (e.kind) {
        case 'visitor': push(e, 'Guest', `${e.name} · ${e.id}`, e.active ? sim.visitors_.activity(e) : 'Left the park'); break;
        case 'staff': push(e, 'Staff', `${e.name} · ${e.id}`, `${e.roleLabel} · ${e.status}`); break;
        case 'ride': push(e, 'Ride', `${e.name} · ${e.id}`, e.statusLabel()); break;
        case 'vehicle': push(e, 'Vehicle', `${e.name}`, sim.get(e.rideId).name); break;
        case 'shop': push(e, 'Shop', `${e.name} · ${e.id}`, sim.shops_.status(e)); break;
        case 'order': push(e, 'Order', `${e.id} · ${e.item}`, `${e.status} · ${sim.get(e.shopId).name}`); break;
        case 'job': push(e, 'Job', `${e.id} · ${e.title}`, JOB_STATUS[e.status][1]); break;
        case 'delivery': push(e, 'Delivery', `${e.id} → ${sim.get(e.shopId).name}`, DELIV_STATUS[e.status][1]); break;
        case 'group': if (e.members.length > 1) push(e, 'Group', `${e.id} · ${e.label} of ${e.members.length}`, e.plan ? e.plan.label : ''); break;
        case 'cart': push(e, 'Cart', `${e.name}`, e.state); break;
      }
    }
    const rank = (r) => (r.id.toLowerCase() === q ? 0 : r.id.toLowerCase().startsWith(q) ? 1 : 2);
    out.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    results.innerHTML = out.slice(0, 10).map((r) => `<div class="sr-item" data-ref="${r.id}"><span class="sr-kind">${r.kind}</span><div class="sr-main"><div class="sr-title">${esc(r.title)}</div><div class="sr-sub">${esc(r.sub)}</div></div></div>`).join('') || '<div class="sr-empty">No matches. Try an ID like G-012, C-02, O-031 or a name.</div>';
    results.classList.add('open');
  }
}
