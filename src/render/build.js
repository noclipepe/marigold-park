import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects world-space geometry per material "kind" and merges it into a few
// large meshes. Colours are stored as vertex colours so one material serves
// many differently painted parts.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _c = new THREE.Color();

export class Batcher {
  constructor(materials) {
    this.materials = materials; // kind -> material
    this.parts = {};
  }

  add(geo, matrix, color, kind = 'paint') {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color ?? 0xffffff);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    (this.parts[kind] ||= []).push(g);
    return g;
  }

  box(w, h, d, x, y, z, color, kind, ry = 0, rx = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), mat(x, y, z, rx, ry, rz), color, kind);
  }

  cyl(rt, rb, h, seg, x, y, z, color, kind, rx = 0, ry = 0, rz = 0, open = false) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat(x, y, z, rx, ry, rz), color, kind);
  }

  // Cylinder between two points.
  beam(a, b, r, color, kind = 'paint', seg = 8) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, m, color, kind);
  }

  // Thin box between two points (for rails, planks).
  bar(a, b, w, h, color, kind = 'paint') {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.BoxGeometry(w, h, len);
    const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
    if (Math.abs(d.clone().normalize().y) > 0.99) m.lookAt(a, b, new THREE.Vector3(1, 0, 0));
    m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    return this.add(g, m, color, kind);
  }

  build(parent, opts = {}) {
    const meshes = [];
    for (const kind of Object.keys(this.parts)) {
      const list = this.parts[kind];
      if (!list.length) continue;
      // Merge in chunks to keep buffers reasonable.
      const chunk = 400;
      for (let i = 0; i < list.length; i += chunk) {
        const g = mergeGeometries(list.slice(i, i + chunk), false);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, this.materials[kind]);
        mesh.castShadow = opts.castShadow ?? (kind !== 'glass' && kind !== 'glow');
        mesh.receiveShadow = kind !== 'glow';
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
        meshes.push(mesh);
      }
    }
    this.parts = {};
    return meshes;
  }
}

export function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p.clone(), _q.clone(), _s.clone());
}

export function makeMaterials(tex = {}) {
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 });
  const gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.75 });
  const concrete = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 });
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: tex.wood || null });
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.38, envMapIntensity: 1.6, depthWrite: false });
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0, toneMapped: true });
  glow.onBeforeCompile = (sh) => {
    // Emissive follows the vertex colour.
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
  };
  const roof = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, map: tex.roof || null });
  return { paint, gloss, metal, concrete, wood, glass, foliage, glow, roof };
}

// Swept profile along a sampled curve with frames (pts, right, up arrays).
export function sweep(pts, rights, ups, profile, closed = true, step = 1) {
  const n = pts.length;
  const count = closed ? Math.floor(n / step) : Math.floor((n - 1) / step) + 1;
  const m = profile.length;
  const pos = [], nor = [], uv = [], idx = [];
  const center = new THREE.Vector3(), tmp = new THREE.Vector3();
  // Profile normals (outward from profile centroid).
  let cx = 0, cy = 0;
  for (const p of profile) { cx += p[0]; cy += p[1]; }
  cx /= m; cy /= m;
  for (let k = 0; k <= count; k++) {
    const i = closed ? (k * step) % n : Math.min(k * step, n - 1);
    const P = pts[i], R = rights[i], U = ups[i];
    for (let j = 0; j < m; j++) {
      const [a, b] = profile[j];
      center.copy(P).addScaledVector(R, a).addScaledVector(U, b);
      pos.push(center.x, center.y, center.z);
      tmp.set(0, 0, 0).addScaledVector(R, a - cx).addScaledVector(U, b - cy).normalize();
      nor.push(tmp.x, tmp.y, tmp.z);
      uv.push(j / m, k * 0.25);
    }
  }
  for (let k = 0; k < count; k++) {
    for (let j = 0; j < m; j++) {
      const a = k * m + j, b = k * m + ((j + 1) % m), c = (k + 1) * m + j, d = (k + 1) * m + ((j + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function circleProfile(r, seg, ox = 0, oy = 0) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
  }
  return out;
}

export function rectProfile(w, h, ox = 0, oy = 0) {
  return [[ox - w / 2, oy - h / 2], [ox + w / 2, oy - h / 2], [ox + w / 2, oy + h / 2], [ox - w / 2, oy + h / 2]];
}
