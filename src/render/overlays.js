import * as THREE from 'three';

// Selection marker, route ribbons, and scene labels.
export class Overlays {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    const scene = sceneMgr.scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    // Ground ring.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 48), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 5;
    this.ring.visible = false;
    this.group.add(this.ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.9, 48), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    ring2.rotation.x = -Math.PI / 2;
    ring2.renderOrder = 5;
    this.ring2 = ring2;
    this.ring.add(ring2);
    ring2.rotation.x = 0;
    // Floating chevron.
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 4), new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false }));
    chev.rotation.x = Math.PI;
    chev.visible = false;
    this.chev = chev;
    this.group.add(chev);
    // Route ribbon (dashed, scrolling).
    const c = document.createElement('canvas');
    c.width = 64; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,1)';
    g.fillRect(0, 0, 40, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    this.routeTex = tex;
    this.routeMat = new THREE.MeshBasicMaterial({ color: 0xffb547, map: tex, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, alphaTest: 0.1, side: THREE.DoubleSide });
    this.routeMatAlt = new THREE.MeshBasicMaterial({ color: 0x7fd3ff, map: tex, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, alphaTest: 0.1, side: THREE.DoubleSide });
    this.routes = new Map();
    this.pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.32, 0.8, 12), new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false }));
    this.pin.rotation.x = Math.PI;
    this.pin.visible = false;
    this.group.add(this.pin);
    // Labels.
    this.labelLayer = document.getElementById('labels');
    this.labels = new Map();
  }

  setMarker(pos, radius, height, show, ring = true) {
    this.ring.visible = show && ring;
    this.chev.visible = show;
    if (!show) return;
    this.ring.position.set(pos.x, pos.groundY + 0.06, pos.z);
    if (this.ringR !== radius) {
      this.ringR = radius;
      this.ring.geometry.dispose();
      this.ring.geometry = new THREE.RingGeometry(radius * 0.8, radius * 0.8 + 0.16, 64);
      this.ring2.geometry.dispose();
      this.ring2.geometry = new THREE.RingGeometry(radius * 0.8 + 0.25, radius * 0.8 + 0.33, 64);
    }
    this.chev.position.set(pos.x, pos.y + height, pos.z);
    this.chev.scale.setScalar(Math.max(1, radius * 0.6));
  }

  animate(t) {
    this.chev.position.y += Math.sin(t * 3) * 0.004;
    this.chev.rotation.y = t * 1.5;
    this.ring2.scale.setScalar(1 + (t * 0.8 % 1) * 0.35);
    this.ring2.material.opacity = 0.8 * (1 - (t * 0.8 % 1));
    this.routeTex.offset.x = -t * 1.4;
  }

  // Route ribbon from a list of [x,z] points (y from groundFn).
  setRoute(key, pts, groundFn, alt = false) {
    let r = this.routes.get(key);
    if (!pts || pts.length < 2) {
      if (r) { r.mesh.visible = false; r.sig = ''; }
      if (key === 'main') this.pin.visible = false;
      return;
    }
    const sig = pts.length + ':' + pts[pts.length - 1].join(',') + ':' + Math.round(pts[0][0] * 4) + ',' + Math.round(pts[0][1] * 4);
    if (!r) {
      r = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), alt ? this.routeMatAlt : this.routeMat), sig: '' };
      r.mesh.renderOrder = 4;
      r.mesh.frustumCulled = false;
      this.group.add(r.mesh);
      this.routes.set(key, r);
    }
    r.mesh.visible = true;
    if (r.sig !== sig) {
      r.sig = sig;
      r.mesh.geometry.dispose();
      r.mesh.geometry = ribbon(pts, alt ? 0.22 : 0.32, groundFn);
    }
    if (key === 'main') {
      const end = pts[pts.length - 1];
      this.pin.visible = true;
      this.pin.position.set(end[0], groundFn(end[0], end[1]) + 0.9 + Math.sin(performance.now() / 300) * 0.08, end[1]);
    }
  }

  clearRoutes(except) {
    for (const [k, r] of this.routes) if (k !== except) { r.mesh.visible = false; r.sig = ''; }
    if (except !== 'main') this.pin.visible = false;
  }

  // ----------------------------------------------------------- labels
  setLabels(items, camera, w, h) {
    const seen = new Set();
    const v = new THREE.Vector3();
    for (const it of items) {
      seen.add(it.key);
      let el = this.labels.get(it.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'scene-label';
        el.dataset.ref = it.ref || '';
        this.labelLayer.appendChild(el);
        this.labels.set(it.key, el);
      }
      v.copy(it.pos).project(camera);
      const visible = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
      if (!visible) { el.style.display = 'none'; continue; }
      el.style.display = '';
      if (el._html !== it.html) { el.innerHTML = it.html; el._html = it.html; }
      el.className = 'scene-label ' + (it.cls || '');
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)${this.labelScale && this.labelScale !== 1 ? ` scale(${this.labelScale})` : ''}`;
    }
    for (const [k, el] of this.labels) if (!seen.has(k)) { el.remove(); this.labels.delete(k); }
  }
}

function ribbon(pts, width, groundFn) {
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const y = groundFn(p[0], p[1]) + 0.09;
    pos.push(p[0] - dz * width, y, p[1] + dx * width, p[0] + dz * width, y, p[1] - dx * width);
    uv.push(acc / 1.2, 0, acc / 1.2, 1);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
