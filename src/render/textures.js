import * as THREE from 'three';
import { NODES, EDGES, COASTER, WHEEL, CAROUSEL, SHOPS, LAKE, PARK, DEPOT } from '../sim/layout.js';
import { mulberry32 } from '../sim/util.js';

export const GROUND = { minX: -110, maxX: 110, minZ: -80, maxZ: 90, ppm: 18 };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function makeTexture(c, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

// The whole park floor is painted into one large texture: lawns, paths, plazas,
// queue pens and service roads. This gives seamless joints and no z-fighting.
export function bakeGround() {
  const W = Math.round((GROUND.maxX - GROUND.minX) * GROUND.ppm);
  const H = Math.round((GROUND.maxZ - GROUND.minZ) * GROUND.ppm);
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const S = GROUND.ppm;
  const X = (x) => (x - GROUND.minX) * S;
  const Z = (z) => (z - GROUND.minZ) * S;
  const rnd = mulberry32(99);

  // Lawn.
  g.fillStyle = '#86b25a';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * W, y = rnd() * H, r = (6 + rnd() * 40) * S * 0.25;
    const tone = rnd();
    g.fillStyle = tone < 0.5 ? `rgba(70,120,40,${0.05 + rnd() * 0.07})` : `rgba(190,210,110,${0.04 + rnd() * 0.06})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Mown stripes inside the park.
  g.save();
  g.beginPath();
  g.rect(X(PARK.minX), Z(PARK.minZ), (PARK.maxX - PARK.minX) * S, (PARK.maxZ - PARK.minZ) * S);
  g.clip();
  for (let x = PARK.minX; x < PARK.maxX; x += 6) {
    g.fillStyle = 'rgba(255,255,220,0.035)';
    g.fillRect(X(x), 0, 3 * S, H);
  }
  g.restore();
  // Outside the park: meadow tone.
  g.fillStyle = 'rgba(150,170,80,0.22)';
  g.fillRect(0, 0, W, Z(PARK.minZ - 1));
  g.fillRect(0, Z(PARK.maxZ + 1), W, H);
  g.fillRect(0, 0, X(PARK.minX - 1), H);
  g.fillRect(X(PARK.maxX + 1), 0, W, H);

  const strokePath = (pts, width, color, cap = 'round') => {
    g.strokeStyle = color;
    g.lineWidth = width * S;
    g.lineCap = cap; g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))));
    g.stroke();
  };
  const disc = (x, z, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(X(x), Z(z), r * S, 0, Math.PI * 2); g.fill(); };
  const rect = (x0, z0, x1, z1, color) => { g.fillStyle = color; g.fillRect(X(x0), Z(z0), (x1 - x0) * S, (z1 - z0) * S); };
  const poly = (pts, color) => { g.fillStyle = color; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.closePath(); g.fill(); };

  // Lake shore (water is a separate mesh).
  g.save();
  g.translate(X(LAKE.center[0]), Z(LAKE.center[1]));
  g.scale(1, LAKE.rz / LAKE.rx);
  g.fillStyle = '#cbb790';
  g.beginPath(); g.arc(0, 0, (LAKE.rx + 1.6) * S, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5c7d6a';
  g.beginPath(); g.arc(0, 0, (LAKE.rx + 0.2) * S, 0, Math.PI * 2); g.fill();
  g.restore();

  // Outside road and drop-off.
  rect(-110, 74, 110, 86, '#5f6266');
  for (let x = -108; x < 110; x += 8) rect(x, 79.8, x + 4, 80.2, '#e8e2cf');
  rect(-26, 66, 26, 74, '#c9c1b2');

  // Service roads (asphalt).
  const svc = EDGES.filter((e) => e[2] === 'service');
  for (const [a, b] of svc) strokePath([NODES[a], NODES[b]], 3.6, '#8a857e');
  for (const [a, b] of svc) strokePath([NODES[a], NODES[b]], 3.0, '#6e6b67');
  // Depot yard.
  rect(DEPOT.pos[0] - 12, DEPOT.pos[1] - 10, DEPOT.pos[0] + 12, DEPOT.pos[1] + 9, '#8b8780');
  rect(DEPOT.pos[0] - 11.5, DEPOT.pos[1] - 9.5, DEPOT.pos[0] + 11.5, DEPOT.pos[1] + 8.5, '#a39e95');
  for (let z = DEPOT.pos[1] - 9; z < DEPOT.pos[1] + 8.5; z += 3) rect(DEPOT.pos[0] - 11.5, z, DEPOT.pos[0] + 11.5, z + 0.06, 'rgba(0,0,0,0.12)');

  // Public paths: curb, then paving.
  const pub = EDGES.filter((e) => e[2] !== 'service');
  const width = (k) => (k === 'main' ? 7.2 : k === 'plaza' ? 4 : 3.8);
  for (const [a, b, k] of pub) strokePath([NODES[a], NODES[b]], width(k) + 0.7, '#bba98a');
  // Plazas
  disc(0, 16, 16.4, '#bba98a');
  disc(0, 53, 10.4, '#bba98a');
  disc(-66, 10, 7.4, '#bba98a');
  disc(13, -20, 5.8, '#bba98a');
  for (const [a, b, k] of pub) strokePath([NODES[a], NODES[b]], width(k), '#e9dcc3');
  disc(0, 16, 15.8, '#ecdfc6');
  disc(0, 53, 9.8, '#ecdfc6');
  disc(-66, 10, 6.8, '#ecdfc6');
  disc(13, -20, 5.2, '#ecdfc6');

  // Plaza patterns: concentric rings and radial joints.
  const rings = (cx, cz, r0, r1, step, color) => {
    g.strokeStyle = color; g.lineWidth = 0.08 * S;
    for (let r = r0; r < r1; r += step) { g.beginPath(); g.arc(X(cx), Z(cz), r * S, 0, Math.PI * 2); g.stroke(); }
  };
  rings(0, 16, 6.6, 15.8, 1.2, 'rgba(150,120,80,0.28)');
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath();
    g.moveTo(X(Math.cos(a) * 6.6), Z(16 + Math.sin(a) * 6.6));
    g.lineTo(X(Math.cos(a) * 15.8), Z(16 + Math.sin(a) * 15.8));
    g.stroke();
  }
  // Terracotta inlay ring.
  g.strokeStyle = '#c9805a'; g.lineWidth = 0.6 * S;
  g.beginPath(); g.arc(X(0), Z(16), 9.4 * S, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#c9805a'; g.lineWidth = 0.4 * S;
  g.beginPath(); g.arc(X(0), Z(53), 7.2 * S, 0, Math.PI * 2); g.stroke();
  rings(0, 53, 2, 9.8, 1.3, 'rgba(150,120,80,0.22)');
  // Boulevard banding.
  for (let z = 30; z < 74; z += 2.4) rect(-3.6, z, 3.6, z + 0.08, 'rgba(150,120,80,0.25)');
  rect(-0.4, 30, 0.4, 62, 'rgba(201,128,90,0.55)');

  // Paver joints on regular paths (subtle crosshatch).
  g.save();
  g.globalCompositeOperation = 'multiply';
  for (const [a, b, k] of pub) {
    if (k === 'main') continue;
    const A = NODES[a], B = NODES[b];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const dx = (B[0] - A[0]) / len, dz = (B[1] - A[1]) / len;
    const nx = -dz, nz = dx;
    const w = width(k) / 2;
    g.strokeStyle = 'rgba(170,150,120,0.35)';
    g.lineWidth = 0.05 * S;
    for (let d = 0; d < len; d += 0.9) {
      const cx = A[0] + dx * d, cz = A[1] + dz * d;
      g.beginPath();
      g.moveTo(X(cx - nx * w), Z(cz - nz * w));
      g.lineTo(X(cx + nx * w), Z(cz + nz * w));
      g.stroke();
    }
  }
  g.restore();

  // Queue pens.
  const lanes = [COASTER.queue, WHEEL.queue, CAROUSEL.queue];
  for (const lane of lanes) strokePath(lane.pts.map((p) => [p.x, p.z]), 2.3, '#cdb99a', 'square');
  for (const lane of lanes) strokePath(lane.pts.map((p) => [p.x, p.z]), 1.9, '#e2d2b4', 'square');
  // Exit paths.
  for (const lane of [COASTER.exitLane, WHEEL.exitLane, CAROUSEL.exitLane]) {
    strokePath(lane.pts.map((p) => [p.x, p.z]), 2.4, '#bba98a');
    strokePath(lane.pts.map((p) => [p.x, p.z]), 1.9, '#e9dcc3');
  }
  // Shop forecourts.
  for (const s of SHOPS) {
    strokePath(s.queue.pts.map((p) => [p.x, p.z]), 2.4, '#e2d2b4');
    rect(s.center[0] - 4.2, s.center[1] - 3.6, s.center[0] + 4.2, s.center[1] + 3.6, '#d9c8aa');
  }
  // Coaster station forecourt and area under the station.
  rect(-48.5, -3.2, -19.5, 5.6, '#c8bba4');
  // Wheel deck surround (rotated).
  g.save();
  g.translate(X(WHEEL.hub[0]), Z(WHEEL.hub[2]));
  g.rotate(WHEEL.yaw);
  g.fillStyle = '#d6c7aa';
  g.fillRect(-9 * S, -4 * S, 18 * S, 9.5 * S);
  g.restore();
  // Carousel surround.
  disc(CAROUSEL.center[0], CAROUSEL.center[1], 10.2, '#bba98a');
  disc(CAROUSEL.center[0], CAROUSEL.center[1], 9.7, '#e7d6b9');
  rings(CAROUSEL.center[0], CAROUSEL.center[1], 8.2, 9.7, 0.7, 'rgba(150,120,80,0.3)');

  // Flower beds (soil) — 3D flowers are added on top.
  const beds = flowerBeds();
  for (const b of beds) {
    g.save();
    g.translate(X(b.x), Z(b.z));
    g.rotate(b.rot || 0);
    g.scale(1, b.rz / b.rx);
    g.fillStyle = '#6b4e35';
    g.beginPath(); g.arc(0, 0, b.rx * S, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // Fine noise for texture.
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 10;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = makeTexture(c);
  t.anisotropy = 16;
  return t;
}

export function flowerBeds() {
  return [
    { x: 0, z: 16, rx: 3.0, rz: 3.0, inner: true },
    { x: -7.5, z: 47.5, rx: 2.4, rz: 1.4 }, { x: 7.5, z: 47.5, rx: 2.4, rz: 1.4 },
    { x: -6.5, z: 60.5, rx: 3.2, rz: 1.2 }, { x: 6.5, z: 60.5, rx: 3.2, rz: 1.2 },
    { x: -16, z: 10, rx: 2.2, rz: 1.5 }, { x: 16, z: 10, rx: 2.2, rz: 1.5 },
    { x: -4.5, z: 33, rx: 1.1, rz: 3.2 }, { x: 4.5, z: 33, rx: 1.1, rz: 3.2 },
    { x: -70, z: 15, rx: 2.4, rz: 1.6 }, { x: 18, z: -17, rx: 2.0, rz: 1.4 },
    { x: 60, z: 12, rx: 2.4, rz: 1.6 }, { x: 47, z: 27, rx: 2.4, rz: 1.2 },
  ];
}

// Tileable detail noise for close-up ground detail.
export function detailTexture() {
  const N = 256;
  const c = canvas(N, N);
  const g = c.getContext('2d');
  const rnd = mulberry32(5);
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = 200 + (rnd() - 0.5) * 70;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.25;
  for (let i = 0; i < 300; i++) {
    g.fillStyle = rnd() < 0.5 ? '#ffffff' : '#808080';
    g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  return makeTexture(c, { repeat: true, linear: true });
}

export function stripeTexture(c1, c2, n = 8, scallop = true) {
  const w = 512, h = 128;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? c2 : c1;
    g.fillRect((i * w) / n, 0, w / n + 1, h);
  }
  if (scallop) {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(((i + 0.5) * w) / n, h + w / n / 2.6, w / n / 1.7, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = makeTexture(c, { repeat: true });
  return t;
}

export function textTexture(lines, opts = {}) {
  const w = opts.w || 512, h = opts.h || 128;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  if (opts.bg) {
    g.fillStyle = opts.bg;
    const r = opts.radius ?? 18;
    g.beginPath();
    g.roundRect(0, 0, w, h, r);
    g.fill();
    if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = opts.borderWidth || 8; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, r - 4); g.stroke(); }
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((l, i) => {
    const text = typeof l === 'string' ? l : l.text;
    const size = (typeof l === 'object' && l.size) || opts.size || h * 0.5;
    const weight = (typeof l === 'object' && l.weight) || opts.weight || 800;
    g.font = `${weight} ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    g.fillStyle = (typeof l === 'object' && l.color) || opts.color || '#ffffff';
    if (opts.letterSpacing) g.letterSpacing = opts.letterSpacing;
    const y = (h * (i + 0.5)) / n + (opts.dy || 0);
    if (opts.shadow) { g.shadowColor = opts.shadow; g.shadowBlur = 6; g.shadowOffsetY = 2; }
    g.fillText(text, w / 2, y);
  });
  const t = makeTexture(c);
  return { texture: t, canvas: c };
}

export function radialTexture(inner = 'rgba(255,220,160,1)', outer = 'rgba(255,200,120,0)') {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return makeTexture(c);
}

export function woodTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const rnd = mulberry32(3);
  g.fillStyle = '#a8784c';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = `rgba(${90 + rnd() * 40},${55 + rnd() * 25},30,0.35)`;
    g.fillRect(0, y, 256, 15);
    g.fillStyle = 'rgba(60,35,20,0.6)';
    g.fillRect(0, y + 15, 256, 1);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = 'rgba(80,50,25,0.25)';
      g.beginPath();
      const yy = y + rnd() * 14;
      g.moveTo(0, yy);
      g.bezierCurveTo(80, yy + rnd() * 4 - 2, 170, yy + rnd() * 4 - 2, 256, yy);
      g.stroke();
    }
  }
  return makeTexture(c, { repeat: true });
}

export function roofTexture(color = '#b5523b') {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x, 0, 3, 256);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x + 13, 0, 3, 256);
  }
  return makeTexture(c, { repeat: true });
}

export function waterNormal() {
  const N = 256;
  const c = canvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const a = Math.sin((x / N) * Math.PI * 8 + Math.sin((y / N) * Math.PI * 4) * 1.5);
    const b = Math.cos((y / N) * Math.PI * 6 + Math.sin((x / N) * Math.PI * 2) * 2.0);
    const i = (y * N + x) * 4;
    img.data[i] = 128 + a * 30;
    img.data[i + 1] = 128 + b * 30;
    img.data[i + 2] = 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return makeTexture(c, { repeat: true, linear: true });
}
