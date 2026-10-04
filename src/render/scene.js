import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DAY = {
  skyTop: new THREE.Color('#5d9be0'), skyHorizon: new THREE.Color('#dfeaf2'), skyGround: new THREE.Color('#c7d3b0'),
  fog: new THREE.Color('#d8e4e8'), sun: new THREE.Color('#fff1da'), sunI: 3.1, hemiSky: new THREE.Color('#cfe3ff'), hemiGround: new THREE.Color('#8a8f5c'), hemiI: 1.05,
  env: 0.42, exposure: 1.0, sunDir: new THREE.Vector3(-0.55, 0.78, 0.42).normalize(),
};
const EVE = {
  skyTop: new THREE.Color('#141c3c'), skyHorizon: new THREE.Color('#d9825c'), skyGround: new THREE.Color('#2b2a35'),
  fog: new THREE.Color('#3d3c52'), sun: new THREE.Color('#ffb27a'), sunI: 0.55, hemiSky: new THREE.Color('#5a6aa8'), hemiGround: new THREE.Color('#2a2630'), hemiI: 0.5,
  env: 0.16, exposure: 1.05, sunDir: new THREE.Vector3(-0.85, 0.22, -0.3).normalize(),
};

export class SceneManager {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
    this.camera = camera;

    // Image-based ambient for soft reflections on paint and glass.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = DAY.env;

    // Sky dome.
    this.skyUniforms = {
      top: { value: DAY.skyTop.clone() }, horizon: { value: DAY.skyHorizon.clone() }, bottom: { value: DAY.skyGround.clone() },
      sunDir: { value: DAY.sunDir.clone() }, sunColor: { value: new THREE.Color('#fff4e0') }, eve: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float eve; varying vec3 vDir;
          void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h*1.6,0.0,1.0), 0.6)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * (0.15 + eve * 0.45));
          // a few stars in the evening
          float st = fract(sin(dot(floor(vDir.xz*420.0 + vDir.y*300.0), vec2(12.9898,78.233))) * 43758.5453);
          c += vec3(step(0.9975, st) * eve * smoothstep(0.15, 0.5, h) * 0.9);
          gl_FragColor = vec4(c, 1.0); }`,
      }),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    scene.add(sky);
    this.sky = sky;
    scene.fog = new THREE.Fog(DAY.fog.clone(), 260, 900);

    this.hemi = new THREE.HemisphereLight(DAY.hemiSky.clone(), DAY.hemiGround.clone(), DAY.hemiI);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(DAY.sun.clone(), DAY.sunI);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -125; sc.right = 125; sc.top = 105; sc.bottom = -105; sc.near = 10; sc.far = 420;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.045;
    sun.shadow.radius = 3;
    sun.target.position.set(0, 0, 0);
    scene.add(sun, sun.target);
    this.sun = sun;
    this.setSunDir(DAY.sunDir);

    // Evening point lights (always present so the shader count never changes).
    this.pointLights = [];
    const pl = [[0, 7, 16, '#ffd29a', 34], [36, 9, 11, '#ffc68a', 30], [-22, 6, 34, '#ffd0a0', 18], [22, 6, 34, '#ffd0a0', 18], [0, 8, 58, '#ffcf96', 26], [44, 7, -24, '#ffc0d8', 24], [-34, 3.6, 3.2, '#ffd29a', 22], [66, 7, 40, '#cfe0ff', 22]];
    for (const [x, y, z, c, d] of pl) {
      const l = new THREE.PointLight(c, 0, d, 1.6);
      l.position.set(x, y, z);
      scene.add(l);
      this.pointLights.push(l);
    }

    this.eve = 0;
    this.eveTarget = 0;
    this.eveListeners = [];
    this.setupPost();
    this.resize();
  }

  setSunDir(dir) {
    this.sun.position.copy(dir).multiplyScalar(220);
    this.skyUniforms.sunDir.value.copy(dir);
  }

  setupPost() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.gtao);
    this.outline = new OutlinePass(new THREE.Vector2(size.x, size.y), this.scene, this.camera);
    this.outline.edgeStrength = 3.2;
    this.outline.edgeGlow = 0.0;
    this.outline.edgeThickness = 1.2;
    this.outline.visibleEdgeColor.set('#ffffff');
    this.outline.hiddenEdgeColor.set('#ffcf6a');
    this.outline.enabled = false;
    this.composer.addPass(this.outline);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.0, 0.55, 0.82);
    this.bloom.enabled = false;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setOutline(objects) {
    this.outline.selectedObjects = objects || [];
    this.outline.enabled = !!(objects && objects.length);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.width = w; this.height = h;
  }

  // Keep the park centred in the area between the side panels.
  setInsets(left, right) {
    this.insetTarget = (left - right) / 2;
  }

  applyInset(dt) {
    const t = this.insetTarget || 0;
    this.inset = this.inset ?? t;
    this.inset += (t - this.inset) * Math.min(1, dt * 5);
    if (Math.abs(this.inset) < 0.5) { if (this.camera.view) this.camera.clearViewOffset(); return; }
    this.camera.setViewOffset(this.width, this.height, -this.inset, 0, this.width, this.height);
  }

  setEvening(on) {
    this.eveTarget = on ? 1 : 0;
  }

  update(dt) {
    this.applyInset(dt);
    if (Math.abs(this.eve - this.eveTarget) > 1e-4) {
      const sp = dt / 2.4;
      this.eve += Math.sign(this.eveTarget - this.eve) * Math.min(sp, Math.abs(this.eveTarget - this.eve));
      this.applyLighting();
    }
  }

  applyLighting() {
    const e = this.eve;
    const k = e * e * (3 - 2 * e);
    const u = this.skyUniforms;
    u.top.value.copy(DAY.skyTop).lerp(EVE.skyTop, k);
    u.horizon.value.copy(DAY.skyHorizon).lerp(EVE.skyHorizon, k);
    u.bottom.value.copy(DAY.skyGround).lerp(EVE.skyGround, k);
    u.eve.value = k;
    u.sunColor.value.set('#fff4e0').lerp(new THREE.Color('#ff9c5a'), k);
    this.scene.fog.color.copy(DAY.fog).lerp(EVE.fog, k);
    this.sun.color.copy(DAY.sun).lerp(EVE.sun, k);
    this.sun.intensity = DAY.sunI + (EVE.sunI - DAY.sunI) * k;
    this.hemi.color.copy(DAY.hemiSky).lerp(EVE.hemiSky, k);
    this.hemi.groundColor.copy(DAY.hemiGround).lerp(EVE.hemiGround, k);
    this.hemi.intensity = DAY.hemiI + (EVE.hemiI - DAY.hemiI) * k;
    this.scene.environmentIntensity = DAY.env + (EVE.env - DAY.env) * k;
    this.renderer.toneMappingExposure = DAY.exposure + (EVE.exposure - DAY.exposure) * k;
    const dir = DAY.sunDir.clone().lerp(EVE.sunDir, k).normalize();
    this.setSunDir(dir);
    for (const l of this.pointLights) l.intensity = 30 * k;
    this.bloom.strength = 0.85 * k;
    this.bloom.enabled = k > 0.02;
    for (const fn of this.eveListeners) fn(k);
  }

  onEvening(fn) {
    this.eveListeners.push(fn);
    fn(this.eve);
  }

  render() {
    this.composer.render();
  }
}
