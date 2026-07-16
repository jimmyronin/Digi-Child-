import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Dynamic backend URL: pass ?backend=https://your-render-app.onrender.com to override.
// The value is stored in localStorage so it persists across page refreshes.
const _qp = new URLSearchParams(window.location.search);
if (_qp.has("backend")) {
  localStorage.setItem("DIGICHILD_BACKEND_URL", _qp.get("backend"));
}
const _defaultBackend = ["localhost", "127.0.0.1", ""].includes(window.location.hostname)
  ? `http://${window.location.hostname || "127.0.0.1"}:8000`
  : "https://digichild-backend.onrender.com";   // deployed default; override with ?backend=
const API_BASE = localStorage.getItem("DIGICHILD_BACKEND_URL") || _defaultBackend;

// Build the sandbox launch URL from the CURRENT origin+path so it works on
// localhost and on GitHub Pages (https + /Digi-Child-Live/ subpath) alike.
function getSimulationLaunchUrl(sessionId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("session", sessionId);
  url.searchParams.set("loc", "home");
  return url.toString();
}

window.__openSimulationSession = (sessionId) => {
  window.open(getSimulationLaunchUrl(sessionId), "_blank", "noopener");
};

// Redirect client console.log to backend uvicorn log
const originalLog = console.log;
console.log = function(...args) {
  originalLog.apply(console, args);
  fetch(`${API_BASE}/api/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: args.join(" ") })
  }).catch(() => {});
};

/* ============================================================
   DOM
   ============================================================ */
const canvas = document.querySelector("#scene");
const statsEl = document.querySelector("#stats");
const form = document.querySelector("#messageForm");
const input = document.querySelector("#messageInput");
const childText = document.querySelector("#childText");
const moodEl = document.querySelector("#stateMood");
const stageTitle = document.querySelector("#stageTitle");
const dayLabel = document.querySelector("#dayLabel");
const ageBand = document.querySelector("#ageBand");
const timelineFill = document.querySelector("#timelineFill");
const timelineMarker = document.querySelector("#timelineMarker");
const insightPanel = document.querySelector("#insightPanel");
const insightTitle = document.querySelector("#insightTitle");
const insightText = document.querySelector("#insightText");
const locationBar = document.querySelector("#locationBar");
const lockHint = document.querySelector("#lockHint");
const queryParams = new URLSearchParams(window.location.search);
if (queryParams.has("view")) document.body.classList.add("is-debug-view");

/* ============================================================
   Session state
   ============================================================ */
const state = {
  day: 5,
  age: 5,
  band: "Age 5-7",
  mood: "curious",
  location: "home",
  values: {
    trust: 64,
    curiosity: 78,
    logic: 41,
    security: 68,
    autonomy: 27,
    volatility: 22,
  },
  childLine: "Are we learning something today, or are you just checking if I remember you?",
};

const statConfig = [
  ["trust", "Trust", "#178f86"],
  ["curiosity", "Curiosity", "#d98632"],
  ["logic", "Logic", "#245b95"],
  ["security", "Security", "#477b36"],
  ["autonomy", "Autonomy", "#7b5796"],
  ["volatility", "Volatility", "#b54135"],
];

/* ============================================================
   Renderer, scene, first-person camera rig
   ============================================================ */
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 220);
const camRig = new THREE.Group();
camRig.add(camera);
scene.add(camRig);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

// image-based lighting: soft studio sheen on every material
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

// post-processing: warm bloom glow over everything emissive
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 1.2;
ssaoPass.minDistance = 0.002;
ssaoPass.maxDistance = 0.08;
composer.addPass(ssaoPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.25, 0.65, 0.85
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const hemi = new THREE.HemisphereLight(0xfff0db, 0x38302b, 0.75);
scene.add(hemi);

function softParticleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d");
  const r = c.width / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, "rgba(255,246,214,0.9)");
  grd.addColorStop(0.28, "rgba(255,224,165,0.45)");
  grd.addColorStop(1, "rgba(255,224,165,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// floating dust motes — the cozy sparkle drifting through every scene
const motes = (() => {
  const count = 90;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd(i) - 0.5) * 26;
    pos[i * 3 + 1] = 0.3 + rnd(i + 57) * 3.2;
    pos[i * 3 + 2] = (rnd(i + 91) - 0.5) * 26;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({
    color: 0xffd9a0,
    map: softParticleTexture(),
    size: 0.032,
    transparent: true,
    opacity: 0.36,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    alphaTest: 0.03,
    sizeAttenuation: true,
  });
  const p = new THREE.Points(geo, pmat);
  p.frustumCulled = false;
  return p;
})();
scene.add(motes);

const player = {
  x: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  radius: 0.32,
  bobPhase: 0,
  bobAmp: 0,
};

/* ============================================================
   Small build helpers
   ============================================================ */
function mat(color, roughness = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

function glowMat(color) {
  return new THREE.MeshBasicMaterial({ color });
}

function box(parent, w, h, d, material, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  parent.add(m);
  return m;
}

function rbox(parent, w, h, d, radius, segments, material, x, y, z, opts = {}) {
  const maxRad = Math.min(w, h, d) * 0.49;
  const rad = Math.min(radius, maxRad);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, rad), material);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  parent.add(m);
  return m;
}

function cyl(parent, rTop, rBot, h, material, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, opts.seg || 16), material);
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  parent.add(m);
  return m;
}

function sph(parent, r, material, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.w || 18, opts.h || 14), material);
  m.position.set(x, y, z);
  if (opts.sx || opts.sy || opts.sz) m.scale.set(opts.sx || 1, opts.sy || 1, opts.sz || 1);
  m.castShadow = opts.cast !== false;
  parent.add(m);
  return m;
}

function solid(colliders, x, z, w, d) {
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

function wall(group, colliders, material, cx, cz, w, d, h = 3) {
  box(group, w, h, d, material, cx, h / 2, cz, { cast: false });
  solid(colliders, cx, cz, w, d);
}

function interiorDoor(parent, x, z, ry = 0, opts = {}) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = ry;
  parent.add(group);

  const gapW = opts.gapWidth || 1.6;
  const wallH = opts.wallHeight || 3;
  const thick = (opts.thickness || 0.18) + 0.04;
  const trim = mat(0xb98b5d, 0.7);
  const wallFill = mat(opts.wallColor || 0xcfc8b8, 0.92);
  const doorMat = mat(opts.color || 0x93623d, 0.72);
  const knobMat = mat(0xd8ae5e, 0.35, { metalness: 0.25 });
  const flip = opts.flip ? -1 : 1;

  // frame posts flush against the wall edges, header trim, and a wall
  // filler that closes the space between the top of the door and ceiling
  const postW = 0.14;
  box(group, postW, 2.2, thick, trim, -(gapW / 2 - postW / 2), 1.1, 0, { cast: false });
  box(group, postW, 2.2, thick, trim, gapW / 2 - postW / 2, 1.1, 0, { cast: false });
  box(group, gapW, 0.18, thick, trim, 0, 2.29, 0, { cast: false });
  box(group, gapW, wallH - 2.38, thick - 0.04, wallFill, 0, 2.38 + (wallH - 2.38) / 2, 0, { cast: false });

  if (opts.noDoor) return;

  // hinged open door leaf; the knob is part of the leaf so it stays on it
  const leafW = gapW - postW * 2 - 0.06;
  const hinge = new THREE.Group();
  hinge.position.set(-flip * (gapW / 2 - postW), 0, 0);
  hinge.rotation.y = flip * 0.85;
  group.add(hinge);
  const slab = box(hinge, leafW, 2.12, 0.055, doorMat, (flip * leafW) / 2, 1.06, 0);
  slab.receiveShadow = true;
  sph(hinge, 0.05, knobMat, flip * (leafW - 0.13), 1.02, 0.06, { w: 12, h: 8 });
}

function kitchenTableLegs(parent, x, z) {
  const legMat = mat(0x6f4b31, 0.76);
  const topMat = mat(0xa8794b, 0.72);
  for (const dx of [-0.48, 0.48]) {
    for (const dz of [-0.48, 0.48]) {
      cyl(parent, 0.045, 0.055, 0.72, legMat, x + dx, 0.36, z + dz, { seg: 12 });
    }
  }
  box(parent, 1.25, 0.07, 0.08, topMat, x, 0.68, z - 0.53, { cast: true });
  box(parent, 1.25, 0.07, 0.08, topMat, x, 0.68, z + 0.53, { cast: true });
  box(parent, 0.08, 0.07, 1.25, topMat, x - 0.53, 0.68, z, { cast: true });
  box(parent, 0.08, 0.07, 1.25, topMat, x + 0.53, 0.68, z, { cast: true });
}

function tileFloor(parent, x, z, w, d, opts = {}) {
  const base = mat(opts.base || 0xd9d2c1, 0.86);
  const grout = mat(opts.grout || 0xbeb6a7, 0.92);
  box(parent, w, 0.035, d, base, x, 0.002, z, { cast: false });

  const step = opts.step || 0.72;
  for (let gx = x - w / 2 + step; gx < x + w / 2 - 0.02; gx += step) {
    box(parent, 0.018, 0.038, d, grout, gx, 0.026, z, { cast: false, receive: false });
  }
  for (let gz = z - d / 2 + step; gz < z + d / 2 - 0.02; gz += step) {
    box(parent, w, 0.038, 0.018, grout, x, 0.027, gz, { cast: false, receive: false });
  }
}

function wallTileSurface(parent, x, y, z, w, h, orientation = "north", opts = {}) {
  const tile = mat(opts.base || 0xd6cfbe, 0.9);
  const grout = mat(opts.grout || 0xb9b1a2, 0.95);
  const depth = 0.028;
  const isSide = orientation === "east" || orientation === "west";
  box(parent, isSide ? depth : w, h, isSide ? w : depth, tile, x, y, z, { cast: false, receive: false });

  const cols = opts.cols || Math.max(2, Math.floor(w / 0.9));
  const rows = opts.rows || Math.max(2, Math.floor(h / 0.62));
  for (let i = 1; i < cols; i++) {
    const offset = -w / 2 + (w * i) / cols;
    box(parent, isSide ? 0.01 : 0.012, h, isSide ? 0.012 : 0.01, grout,
      x + (isSide ? 0 : offset), y, z + (isSide ? offset : 0),
      { cast: false, receive: false }
    );
  }
  for (let i = 1; i < rows; i++) {
    const yy = y - h / 2 + (h * i) / rows;
    box(parent, isSide ? 0.012 : w, 0.012, isSide ? w : 0.012, grout, x, yy, z, { cast: false, receive: false });
  }
}

function glassPanel(parent, w, h, d, x, z, opts = {}) {
  const glass = mat(0xbfdde6, 0.25, {
    transparent: true,
    opacity: 0.36,
    metalness: 0.05,
  });
  return box(parent, w, h, d, glass, x, h / 2, z, { cast: false, receive: false, ...opts });
}

function towelBar(parent, x, y, z, ry = 0) {
  const bar = new THREE.Group();
  bar.position.set(x, y, z);
  bar.rotation.y = ry;
  parent.add(bar);
  const metal = mat(0x1d1b18, 0.4, { metalness: 0.35 });
  const towel = mat(0xe9e2d6, 0.88);
  cyl(bar, 0.018, 0.018, 0.7, metal, 0, 0.12, 0, { rz: Math.PI / 2, seg: 10 });
  box(bar, 0.5, 0.58, 0.045, towel, 0, -0.18, 0.035, { cast: true });
  return bar;
}

function carVent(parent, x, y, z, w = 0.46) {
  const frame = mat(0x20242a, 0.46);
  const slat = mat(0xd9dedf, 0.38, { metalness: 0.15 });
  box(parent, w, 0.16, 0.04, frame, x, y, z, { cast: false });
  for (let i = 0; i < 4; i++) {
    box(parent, w - 0.1, 0.014, 0.055, slat, x, y - 0.052 + i * 0.035, z - 0.025, { cast: false });
  }
  box(parent, 0.08, 0.045, 0.065, slat, x + w * 0.18, y, z - 0.045, { cast: false });
}

function carButton(parent, x, y, z, w, h, label = "") {
  const btn = box(parent, w, h, 0.045, mat(0xd9dedf, 0.42, { metalness: 0.1 }), x, y, z, { cast: false });
  if (label) {
    const p = textPanel(label, w * 0.82, h * 0.82, "#d9dedf", "#29313a");
    p.position.set(x, y, z - 0.026);
    parent.add(p);
  }
  return btn;
}

function gearSelector(parent, x, y, z) {
  const base = mat(0xd7d8d4, 0.42, { metalness: 0.18 });
  const dark = mat(0x20242a, 0.5);
  const chrome = mat(0xcfd2d1, 0.32, { metalness: 0.55 });
  // Base plate (rounded corners)
  rbox(parent, 0.48, 0.08, 0.54, 0.03, 3, base, x, y, z, { cast: true });
  // Shift gate track
  rbox(parent, 0.22, 0.025, 0.4, 0.01, 3, dark, x - 0.12, y + 0.052, z, { cast: false });
  // Stem/shifter shaft (chrome metal look)
  const stem = cyl(parent, 0.02, 0.02, 0.28, chrome, x - 0.12, y + 0.18, z + 0.05, { rx: 0.15, seg: 12 });
  // Shifter knob (leather look + chrome cap)
  rbox(parent, 0.09, 0.12, 0.11, 0.025, 4, dark, x - 0.12, y + 0.31, z + 0.08, { rx: 0.15 });
  rbox(parent, 0.07, 0.02, 0.08, 0.01, 3, chrome, x - 0.12, y + 0.375, z + 0.08, { rx: 0.15 });
  
  // Rotary dial next to it (polished chrome and dark plastic)
  cyl(parent, 0.12, 0.12, 0.055, chrome, x + 0.12, y + 0.09, z, { seg: 24 });
  cyl(parent, 0.08, 0.08, 0.06, dark, x + 0.12, y + 0.13, z, { seg: 24 });
}

function quiltedSeat(parent, x, z, opts = {}) {
  const seat = mat(opts.color || 0x6a5148, 0.52, { metalness: 0.06 });
  const accent = mat(0xc9b4a8, 0.55);
  // Bottom seat cushion (well rounded)
  rbox(parent, 0.68, 0.18, 0.72, 0.05, 4, seat, x, 0.76, z);
  // Backrest (well rounded)
  rbox(parent, 0.68, 0.78, 0.16, 0.04, 4, seat, x, 1.22, z + 0.37, { rx: -0.1 });
  // Headrest (well rounded)
  rbox(parent, 0.34, 0.18, 0.14, 0.04, 4, seat, x, 1.68, z + 0.43);
  // Accent cushions (softer boundaries)
  rbox(parent, 0.5, 0.02, 0.46, 0.01, 3, accent, x, 0.86, z - 0.02, { cast: false });
  rbox(parent, 0.46, 0.38, 0.02, 0.01, 3, accent, x, 1.24, z + 0.29, { rx: -0.1, cast: false });
}

function curtains(parent, x, z, orientation = "north", color = 0xc57857) {
  const rodMat = mat(0x6f4b31, 0.5);
  const clothMat = mat(color, 0.85);
  const y = 1.55;
  if (orientation === "north" || orientation === "south") {
    const zOff = orientation === "north" ? 0.14 : -0.14;
    cyl(parent, 0.02, 0.02, 2.6, rodMat, x, 2.42, z + zOff, { rz: Math.PI / 2, seg: 8 });
    box(parent, 0.36, 1.7, 0.1, clothMat, x - 1.12, y, z + zOff, { cast: false });
    box(parent, 0.36, 1.7, 0.1, clothMat, x + 1.12, y, z + zOff, { cast: false });
  } else {
    const xOff = orientation === "east" ? -0.14 : 0.14;
    cyl(parent, 0.02, 0.02, 2.6, rodMat, x + xOff, 2.42, z, { rx: Math.PI / 2, seg: 8 });
    box(parent, 0.1, 1.7, 0.36, clothMat, x + xOff, y, z - 1.12, { cast: false });
    box(parent, 0.1, 1.7, 0.36, clothMat, x + xOff, y, z + 1.12, { cast: false });
  }
}

function rnd(i) {
  return Math.abs(Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1;
}

function textPanel(text, w, h, bg, fg) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = Math.max(64, Math.round((512 * h) / w));
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(c.height * 0.52)}px Inter, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  return m;
}

/* ============================================================
   Real 3D model props (Kenney asset packs, CC0 license)
   ============================================================ */
const gltfLoader = new GLTFLoader();
const modelCache = new Map();

function loadModel(path) {
  if (!modelCache.has(path)) {
    modelCache.set(
      path,
      new Promise((resolve, reject) => {
        gltfLoader.load(
          `./assets/${path}.glb`,
          (gltf) => {
            gltf.scene.traverse((o) => {
              if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
              }
            });
            // normalize every model to a center-bottom origin: some Kenney
            // packs pivot at a corner, which made furniture drift into walls
            const bounds = new THREE.Box3().setFromObject(gltf.scene);
            const center = bounds.getCenter(new THREE.Vector3());
            const root = new THREE.Group();
            gltf.scene.position.set(-center.x, -bounds.min.y, -center.z);
            root.add(gltf.scene);
            resolve(root);
          },
          undefined,
          reject
        );
      })
    );
  }
  return modelCache.get(path);
}

function prop(parent, path, x, z, opts = {}) {
  loadModel(path)
    .then((proto) => {
      const m = proto.clone(true);
      m.position.set(x, opts.y || 0, z);
      m.rotation.y = opts.ry || 0;
      m.scale.setScalar(opts.s || 1);
      parent.add(m);
      if (opts.onLoad) opts.onLoad(m);
    })
    .catch(() => console.warn(`Missing model: ${path}`));
}

function makeTree(scale = 1, tone = 0x4d8f3a) {
  const t = new THREE.Group();
  cyl(t, 0.14 * scale, 0.2 * scale, 1.1 * scale, mat(0x6b4a2c, 0.9), 0, 0.55 * scale, 0);
  sph(t, 0.85 * scale, mat(tone, 0.85), 0, 1.65 * scale, 0);
  sph(t, 0.6 * scale, mat(tone, 0.85), 0.42 * scale, 1.3 * scale, 0.25 * scale);
  sph(t, 0.55 * scale, mat(tone, 0.85), -0.42 * scale, 1.4 * scale, -0.15 * scale);
  return t;
}

/* ============================================================
   The child (Mira) — the user's own VRoid character (.vrm).
   15 models cover her growth: mira-01..05 (child),
   mira-06..10 (teenager), mira-11..15 (adult).
   The sim age picks which one is loaded.
   ============================================================ */
const child = new THREE.Group();
scene.add(child);

// soft fill from the parent's side so her face never goes dark
const childLight = new THREE.PointLight(0xffd9a0, 0.6, 3.5, 2);
childLight.position.set(0, 1.5, 1.1);
child.add(childLight);

const vrmLoader = new GLTFLoader();
vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

let vrm = null;
let vrmStage = 0;
let vrmHeight = 1.2;
let familyMembers = [];
let partyAudio = null;

function playPartySound(play) {
  if (play) {
    if (!partyAudio) {
      // Use highly reliable, CORS-friendly Google sound library CDN for coffee shop/restaurant ambience
      partyAudio = new Audio("https://actions.google.com/sounds/v1/ambiences/coffee_shop_atmosphere.ogg");
      partyAudio.loop = true;
      partyAudio.volume = 0.35; // pleasant room murmur volume
    }
    partyAudio.play().catch((e) => console.log("Audio autoplay deferred:", e));
  } else {
    if (partyAudio) partyAudio.pause();
  }
}
let exprHappy = 0.2;
let exprSad = 0;
let exprAngry = 0;

/* ============================================================
   Child reactions — crying, screaming, giggling, playful idle.
   Sounds are synthesized with the Web Audio API so they always
   work (no network, matches the project's offline-first goal).
   ============================================================ */
const audioCry = new Audio("./assets/baby_cry.ogg");
// baby_laugh.ogg is intentionally gone: it fired on every happy turn, so warmth
// sounded like the same giggle on repeat. Contentment is the ambient hum now.

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

let reaction = null; // { type, start, until }
function triggerReaction(type) {
  const dur = { scream: 5.0, cry: 5.5, happy: 3.2, upset: 3.2 }[type] || 3;
  reaction = { type, start: clock.elapsedTime, until: clock.elapsedTime + dur };
  playChildSound(type);
}

function playChildSound(type) {
  const ctx = ensureAudio();
  const now = ctx ? ctx.currentTime : 0;
  
  try {
    if (type === "cry" || type === "upset" || type === "scream") {
      audioCry.currentTime = 0;
      audioCry.play()
        .catch(e => {
          console.warn("Real cry audio play blocked, falling back to synth:", e);
          if (ctx) {
            if (type === "scream") {
              childScream(ctx, now);
              childWail(ctx, now + 0.75, 4.2, 0.55);
            } else {
              childWail(ctx, now, 5.2, 0.5);
            }
          }
        });
    } else if (type === "happy") {
      // Deliberately silent. The recorded laugh fired on EVERY happy turn, which
      // made a warm conversation loop the same giggle; ambient humming replaced
      // it and was no better. Contentment now reads visually only -- her face and
      // posture carry it, and the room stays quiet.
      audioCry.pause();
    }
  } catch (e) {
    console.warn("Audio play failed:", e);
    if (ctx) {
      // Distress still needs a fallback voice -- it is clinically meaningful.
      // "happy" has none by design; it must not giggle here either, or the
      // repeated laugh returns via the error path.
      if (type === "cry" || type === "upset") childWail(ctx, now, 5.2, 0.5);
      else if (type === "scream") {
        childScream(ctx, now);
        childWail(ctx, now + 0.75, 4.2, 0.55);
      }
    }
  }
}

function childWail(ctx, start, duration, level) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const gain = ctx.createGain();
  const vib = ctx.createOscillator();
  const vibGain = ctx.createGain();
  vib.frequency.value = 6.5;
  vibGain.gain.value = 45;
  vib.connect(vibGain);
  vibGain.connect(osc.frequency);
  gain.gain.setValueAtTime(0.0001, start);
  const sobs = Math.max(1, Math.floor(duration / 0.9));
  for (let i = 0; i < sobs; i++) {
    const s = start + i * 0.9;
    osc.frequency.setValueAtTime(470 + (i % 2) * 130, s);
    osc.frequency.linearRampToValueAtTime(660, s + 0.25);
    osc.frequency.linearRampToValueAtTime(420, s + 0.8);
    gain.gain.setValueAtTime(0.0001, s);
    gain.gain.linearRampToValueAtTime(level, s + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.02, s + 0.82);
  }
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 950;
  filt.Q.value = 1.1;
  osc.connect(filt);
  filt.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  vib.start(start);
  osc.stop(start + duration + 0.2);
  vib.stop(start + duration + 0.2);
}

function childScream(ctx, start) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(620, start);
  osc.frequency.exponentialRampToValueAtTime(1450, start + 0.22);
  osc.frequency.exponentialRampToValueAtTime(920, start + 0.6);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.6, start + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, start + 0.68);
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 1600;
  filt.Q.value = 0.7;
  osc.connect(filt);
  filt.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.72);
}

// childGiggle() removed 2026-07-15: nothing called it any more. Her laugh
// fired on every happy turn AND on a 25-60s idle timer, which is what made
// her sound like she was laughing on a loop. Contentment is silent now.
// soft "bonk" when a thrown toy lands on the parent
function childThud(ctx, start) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(130, start);
  osc.frequency.exponentialRampToValueAtTime(45, start + 0.12);
  gain.gain.setValueAtTime(0.5, start);
  gain.gain.exponentialRampToValueAtTime(0.01, start + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.18);
}

function detectReaction(message, result) {
  const m = " " + message.toLowerCase() + " ";
  if (/(hit|slap|spank|smack|beat|punch|shake you|hurt you|hit you)/.test(m)) return "scream";
  if (/(stupid|shut up|shut it|hate you|i hate|dumb|idiot|ugly|worthless|useless|bad kid|annoying|go away|don'?t love you|you'?re nothing|crybaby)/.test(m)) return "cry";
  // dismissing / ignoring her: repeated brush-offs (or one while she's already
  // wound up) tip her into a full protest -- stomping, screaming, throwing toys
  if (/(whatever|not now|maybe later|i'?m busy|stop bothering|be quiet|quiet now|stop talking|don'?t care|so what|leave me alone|not listening|can'?t you see i'?m|stop it|enough|no time for)/.test(m)) {
    dismissStreak++;
    if (state.values.volatility > 55 || dismissStreak >= 2) return "tantrum";
    return "upset";
  }
  if (/(love you|so proud|proud of you|good girl|good boy|good job|well done|you'?re amazing|hug|beautiful|so smart|my sweet|sweetheart|let'?s play|play with|good idea)/.test(m)) {
    dismissStreak = 0; // warmth repairs the brush-off streak
    return "happy";
  }
  
  if (result && result.childLine) {
    const cl = result.childLine.toLowerCase();
    if (cl.includes("cry") || cl.includes("sob") || cl.includes("sniffle") || cl.includes("tears") || cl.includes("wail") || cl.includes("*looks down*") || cl.includes("*cries*")) {
      return "cry";
    }
    if (cl.includes("laugh") || cl.includes("giggle") || cl.includes("smile") || cl.includes("happy") || cl.includes("yay!") || cl.includes("love") || cl.includes("bounce") || cl.includes("hug") || cl.includes("bunny") || cl.includes("favorite")) {
      return "happy";
    }
  }
  
  if (result && result.values) {
    if (result.values.volatility > 66) return "upset";
    if (result.values.trust > 76 && result.values.security > 72) return "happy";
  }
  return null;
}

// smoothed expression + playful state
const expr = { happy: 0.2, sad: 0, angry: 0, surprised: 0, aa: 0 };
let nextGiggleAt = 8;

let lastParentActivityTime = 0;
let nextIdleActionTime = 10;
let fmPhase = 0; // round-robin phase for party guest updates
let waveUntil = 0;
let smileSpikeUntil = 0;
// LLM-driven timed gesture (jump / dance / spin / hide / clap / throw / tantrum)
let actionType = null;
let actionUntil = 0;
// protest behaviors: she can hurl a toy at the parent and melt down when dismissed
let throwLaunchAt = 0;
let throwDone = true;
let shakeUntil = 0;      // brief camera shake when a thrown toy hits the parent
let dismissStreak = 0;   // consecutive dismissive/ignoring parent messages
const flyingProps = [];  // toys currently in the air

function resetParentIdle() {
  if (clock) {
    lastParentActivityTime = clock.getElapsedTime();
    nextIdleActionTime = lastParentActivityTime + 35 + Math.random() * 25;
  }
}
window.addEventListener("mousemove", resetParentIdle);
window.addEventListener("keydown", resetParentIdle);
window.addEventListener("click", resetParentIdle);

let lastIdleLine = "";

function pickIdleLine(lines) {
  // never say the same idle line twice in a row
  const pool = lines.filter((l) => l !== lastIdleLine);
  const line = pool[Math.floor(Math.random() * pool.length)];
  lastIdleLine = line;
  return line;
}

function triggerIdleChildAction() {
  // Mood-based idle life. She is NOT always doing something: most of the time
  // she simply stands and exists, and only sometimes plays, claps, twirls, or
  // says a little line -- weighted by how she currently feels.
  const vol = state.values.volatility;
  const tr = state.values.trust;
  const t = clock.getElapsedTime();
  const roll = Math.random();

  if (vol > 62) {
    // distressed: she withdraws or protests -- comes near the parent
    clearActivePlayPoint();
    if (currentId !== "car") {
      const dx = camWorld.x - childWorld.x;
      const dz = camWorld.z - childWorld.z;
      const d = Math.hypot(dx, dz) || 0.1;
      childTarget.x = camWorld.x - (dx / d) * 1.1;
      childTarget.z = camWorld.z - (dz / d) * 1.1;
    }
    if (roll < 0.35) return; // sometimes she just sulks silently
    if (roll < 0.55 && currentId !== "car") {
      // boiling over: stomping meltdown, sometimes hurling a toy at you
      performChildAction({ type: "tantrum", prop: "none", spot: "none" });
      if (Math.random() < 0.5) {
        setTimeout(() => performChildAction({ type: "throw_toy", prop: "none", spot: "none" }), 1600);
      }
      state.childLine = pickIdleLine([
        "*stomps feet and screams* YOU'RE NOT LISTENING TO ME!",
        "*throws her toy* You NEVER pay attention to me!!",
        "*screams* I've been talking and talking and you don't CARE!",
      ]);
      syncUi();
      return;
    }
    const choice = Math.random() > 0.5 ? "cry" : "upset";
    triggerReaction(choice);
    state.childLine = pickIdleLine(choice === "cry" ? [
      "*sobs* I hate when you just stand there and don't say anything...",
      "*sniffles* You never listen to me anymore...",
      "*wipes eyes* Nobody plays with me...",
    ] : [
      "*crosses arms* Fine. I'll just play by myself then.",
      "*kicks the ground* You're not even looking at me.",
      "*frowns* You promised we'd do something fun...",
    ]);
    syncUi();
    return;
  }

  if (tr > 55 && vol < 45) {
    // content: mostly calm presence, with occasional spontaneous little joys
    if (roll < 0.35) {
      // just stand there, being a kid -- maybe a soft smile, no words
      smileSpikeUntil = t + 2.0;
      return;
    }
    if (roll < 0.50 && currentId !== "car") {
      // wander off to play at something nearby (no announcement needed)
      const point = chooseReachablePlayPoint(playPoints[currentId]);
      if (point) beginActivePlayPoint(point, t);
      return;
    }
    if (roll < 0.63 && currentId !== "car") {
      // clap happily
      actionType = "clap";
      actionUntil = t + 3.2;
      smileSpikeUntil = t + 3.2;
      triggerReaction("happy");
      return;
    }
    if (roll < 0.75 && currentId !== "car") {
      // a twirl or an excited hop
      actionType = Math.random() < 0.5 ? "spin" : "jump";
      actionUntil = t + 3.5;
      smileSpikeUntil = t + 3.5;
      return;
    }
    if (roll < 0.85) {
      // wave hello
      triggerReaction("happy");
      smileSpikeUntil = t + 3.0;
      waveUntil = t + 4.0;
      return;
    }
    // occasionally she says a little something
    state.childLine = pickIdleLine([
      "*hums a little song to herself*",
      "What should we play next?",
      "I like it when we hang out together.",
      "*giggles* You make a funny face when you think.",
      "Can we stay a little longer? This is fun.",
      "*looks around* What's that over there? Can we go see?",
    ]);
    smileSpikeUntil = t + 2.5;
    syncUi();
    return;
  }

  // in-between mood: mostly quiet, sometimes a small bid for attention
  if (roll < 0.5) return; // she just stands, thinking her own thoughts
  triggerReaction("upset");
  state.childLine = pickIdleLine([
    "Why are you just standing there staring?",
    "I'm bored. Let's do something...",
    "*looks down* Are you checking your phone again?",
    "*shuffles feet* Can we do something together?",
    "Hey... are you still here with me?",
  ]);
  syncUi();
}

function miraStage() {
  let base = 0;
  if (state.band === "Age 10-12") {
    base = 5;
  } else if (state.band === "Age 14-16") {
    base = 10;
  }
  
  let offset = 1; // Default: Home clothes (version 1)
  if (state.location === "car") offset = 2;       // Casual/Travel (version 2)
  else if (state.location === "park") offset = 3;  // Gym/Sport (version 3)
  else if (state.location === "market") offset = 4;// Outdoor/Market (version 4)
  else if (state.location === "party") offset = 5; // Party/Holiday (version 5)
  
  return base + offset;
}

function loadMira(stage) {
  if (stage === vrmStage) return;
  vrmStage = stage;
  const url = `./assets/mira/mira-${String(stage).padStart(2, "0")}.vrm`;
  vrmLoader.load(
    url,
    (gltf) => {
      if (vrmStage !== stage) return; // a newer request superseded this one
      const next = gltf.userData.vrm;
      if (!next) return;
      if (vrm) {
        child.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      vrm = next;
      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
        o.frustumCulled = false;
      });
      child.add(vrm.scene);
      // relax the T-pose: arms down at her sides
      for (const [boneName, rz] of [["leftUpperArm", -1.32], ["rightUpperArm", 1.32]]) {
        const b = vrm.humanoid.getNormalizedBoneNode(boneName);
        if (b) b.rotation.z = rz;
      }
      if (vrm.lookAt) vrm.lookAt.target = camera;
      const bounds = new THREE.Box3().setFromObject(vrm.scene);
      vrmHeight = Math.max(0.8, bounds.max.y - Math.min(bounds.min.y, 0));
      placeChild();

      if (activeSessionId) {
        dismissSplashScreen();
      }
    },
    undefined,
    (e) => {
      console.warn(`Could not load ${url}`, e);
      if (activeSessionId) {
        dismissSplashScreen();
      }
    }
  );
}

// a seated, static VRoid family member (party guests)
function familyMember(parent, file, x, z, ry, seat = 0.85, pose = "sit") {
  vrmLoader.load(
    `./assets/mira/${file}.vrm`,
    (gltf) => {
      const fv = gltf.userData.vrm;
      if (!fv) return;
      VRMUtils.rotateVRM0(fv);
      fv.scene.traverse((o) => {
        // guests don't cast shadows: 17 skinned shadow casters tank the party FPS
        if (o.isMesh) o.castShadow = false;
        o.frustumCulled = false;
      });
      const bounds = new THREE.Box3().setFromObject(fv.scene);
      const h = Math.max(1.0, bounds.max.y - Math.min(bounds.min.y, 0));
      for (const [boneName, rz] of [["leftUpperArm", -1.32], ["rightUpperArm", 1.32]]) {
        const b = fv.humanoid.getNormalizedBoneNode(boneName);
        if (b) b.rotation.z = rz;
      }
      if (pose === "sit") {
        for (const side of ["left", "right"]) {
          const upper = fv.humanoid.getNormalizedBoneNode(`${side}UpperLeg`);
          const lower = fv.humanoid.getNormalizedBoneNode(`${side}LowerLeg`);
          if (upper) upper.rotation.x = -Math.PI / 2.15; // Bend thighs forward
          if (lower) lower.rotation.x = Math.PI / 2.05; // Bend knees down
        }
      }
      // Add to parent first at origin, force matrix update, then read hip position
      fv.scene.position.set(0, 0, 0);
      fv.scene.rotation.y = ry;
      parent.add(fv.scene);
      // Humanoid update must be called so bone rotations are applied before we measure hip position
      fv.humanoid.update();
      fv.update(0);
      fv.scene.updateMatrixWorld(true);
      
      if (pose === "sit") {
        const hips = fv.humanoid.getNormalizedBoneNode("hips");
        const hipY = hips ? hips.getWorldPosition(new THREE.Vector3()).y : h * 0.50;
        // Add pelvis offset (hips are ~7.5% of height above butt) so butt sits on seat
        const pelvisOffset = h * 0.075;
        fv.scene.position.set(x, seat - hipY + pelvisOffset, z);
      } else {
        fv.scene.position.set(x, 0.02, z);
      }
      familyMembers.push(fv);
    },
    undefined,
    (e) => console.warn(`Could not load family member ${file}`, e)
  );
}

// blink timing
let blinkUntil = -1;
let nextBlinkAt = 3.2;

let childPose = "stand";
let childBaseY = 0;
const childWorld = { x: 0, z: 0 }; // her own walking position in the scene
let walkPhase = 0; // leg-cycle phase
let walkAmt = 0; // 0..1 how much she is currently walking
const childTarget = { x: 0, z: 0 };
let nextWanderAt = 0;

const playPoints = {
  home: [
    { name: "dining table", x: 1.5, z: -0.8, dialogue: {
        "Age 5-7": "Look! I found a shiny spoon under the table! Mommy, Daddy, can I keep it?",
        "Age 10-12": "I'm sitting at the dining table. Can we play a card game together?",
        "Age 14-16": "I'm at the table. Do you want help setting up the plates?"
      }
    },
    { name: "bedroom", x: 2.2, z: -2.0, dialogue: {
        "Age 5-7": "Momy, Daddy! Come look! I brought my favorite storybook from the bed!",
        "Age 10-12": "I'm checking my school bag in the room. I think I left my sketch pad here.",
        "Age 14-16": "I'm just organizing some stuff in the room. Give me a second."
      }
    },
    { name: "living room rug", x: 0.5, z: 0.2, dialogue: {
        "Age 5-7": "*waves* Mommy, Daddy, look at this toy block castle I built!",
        "Age 10-12": "I found this old board game on the rug. Do you want to play?",
        "Age 14-16": "I'm just relaxing on the rug. Let me know if you need help with anything."
      }
    },
    { name: "kitchen counter", x: 0.2, z: -1.8, dialogue: {
        "Age 5-7": "Momy, Daddy, can I get a glass of water? I can't reach the cups!",
        "Age 10-12": "Can I help you make some snacks at the counter?",
        "Age 14-16": "I can help prep the ingredients on the kitchen counter if you'd like."
      }
    }
  ],
  park: [
    { name: "slide", x: -2.5, z: -2.0, dialogue: {
        "Age 5-7": "*waves* Mommy, Daddy, watch me go down the big slide! Are you watching?",
        "Age 10-12": "I'm going down the slide! It's actually pretty fast!",
        "Age 14-16": "I'm just sitting near the slide. The park is nice today."
      }
    },
    { name: "swings", x: 2.5, z: -2.0, dialogue: {
        "Age 5-7": "Mommy! Daddy! I'm on the swing! Come push me! Push me higher!",
        "Age 10-12": "Push me on the swings! Let's see how high I can go!",
        "Age 14-16": "I'm sitting on the swings. It's a peaceful place to think."
      }
    },
    { name: "sandbox", x: 0, z: 1.5, dialogue: {
        "Age 5-7": "Look! I built a giant sand castle! Momy, Daddy, come see!",
        "Age 10-12": "I'm drawing shapes in the sand. It's relaxing.",
        "Age 14-16": "I'm sitting by the sandbox. Remember when we used to build castles here?"
      }
    },
    { name: "grass patch", x: -1.2, z: 2.2, dialogue: {
        "Age 5-7": "*runs over and waves* Mommy, Daddy, look! I picked a yellow flower for you!",
        "Age 10-12": "Look, I found a cool round stone in the grass! Look how smooth it is!",
        "Age 14-16": "Just standing on the grass. The breeze feels great."
      }
    }
  ],
  market: [
    { name: "bakery aisle", x: -1.5, z: 0.5, dialogue: {
        "Age 5-7": "*waves* Mommy, Daddy, look at those delicious cupcakes! Can we get them?",
        "Age 10-12": "The bread smells amazing! Should we get some sourdough for dinner?",
        "Age 14-16": "I can go grab the sandwich bread from the bakery section if you want."
      }
    },
    { name: "snack aisle", x: 1.5, z: -0.5, dialogue: {
        "Age 5-7": "*waves* Mommy, Daddy! The cookies are here! The ones in the yellow box! Please?",
        "Age 10-12": "Look! They have the new chips on sale! Can we get one bag?",
        "Age 14-16": "Do we need snacks for the week? I'll grab some pretzels."
      }
    },
    { name: "produce counter", x: 0, z: -2.0, dialogue: {
        "Age 5-7": "Look at these giant pumpkins! Momy, Daddy, can we buy a big one?",
        "Age 10-12": "I'm checking the apples. Should I weigh them on the scale?",
        "Age 14-16": "I'll pick out some fresh apples and bananas from the produce pile."
      }
    },
    { name: "checkout lane", x: -0.8, z: 2.0, dialogue: {
        "Age 5-7": "Momy, Daddy, look at all the candy bars here! Can I have just one?",
        "Age 10-12": "Should I help load the groceries onto the checkout belt?",
        "Age 14-16": "I'll place the divider on the checkout belt and help pack the bags."
      }
    }
  ],
  party: [
    { name: "food buffet", x: -1.0, z: -1.5, dialogue: {
        "Age 5-7": "Look at the big chocolate cake! Mommy, Daddy, can I get a slice now?",
        "Age 10-12": "The buffet looks awesome. Should I grab a plate of finger food?",
        "Age 14-16": "I'll go get some juice. Do you want me to bring you a drink, mom/dad?"
      }
    },
    { name: "balcony", x: 2.0, z: 1.5, dialogue: {
        "Age 5-7": "Mommy! Daddy! Look at the colorful balloons hanging on the balcony!",
        "Age 10-12": "The view from the balcony is cool. Look at the party lights!",
        "Age 14-16": "It's quieter out here on the balcony. Nice way to take a break."
      }
    },
    { name: "grandma's couch", x: 0, z: -2.5, dialogue: {
        "Age 5-7": "Momy, Daddy, grandma gave me a giant hug! She said I grew so tall!",
        "Age 10-12": "Grandma's asking me about school. Can you come help me talk to her?",
        "Age 14-16": "I'm sitting with grandma. She's telling me stories about when you were a kid!"
      }
    },
    { name: "game table", x: 1.2, z: -0.5, dialogue: {
        "Age 5-7": "*waves* Look! The cousins are playing a game! Can I join them?",
        "Age 10-12": "They're playing card games at the table. I'm going to watch them play.",
        "Age 14-16": "I'm hanging out by the game table with the cousins. It's fun."
      }
    }
  ]
};

let activePlayPoint = null;
let activePlayPointStartedAt = 0;
let activePlayPointBestDistance = Infinity;
let activePlayPointStuckFor = 0;
let lastPlayPointName = "";

function clearActivePlayPoint() {
  activePlayPoint = null;
  activePlayPointStartedAt = 0;
  activePlayPointBestDistance = Infinity;
  activePlayPointStuckFor = 0;
}

function beginActivePlayPoint(point, t) {
  activePlayPoint = point;
  activePlayPointStartedAt = t;
  activePlayPointBestDistance = Infinity;
  activePlayPointStuckFor = 0;
  childTarget.x = point.x;
  childTarget.z = point.z;
}

function chooseReachablePlayPoint(points) {
  if (!points || points.length === 0) return null;
  const scored = points
    .map((point) => ({
      point,
      fromChild: Math.hypot(point.x - childWorld.x, point.z - childWorld.z),
      fromParent: Math.hypot(point.x - camWorld.x, point.z - camWorld.z),
    }))
    .filter(({ point, fromChild, fromParent }) =>
      point.name !== lastPlayPointName &&
      fromChild > 0.8 &&
      fromChild < 5.6 &&
      fromParent < 6.8
    )
    .sort((a, b) => (a.fromParent + a.fromChild * 0.35) - (b.fromParent + b.fromChild * 0.35));
  if (scored.length === 0) return null;
  const top = scored.slice(0, 3);
  return top[Math.floor(Math.random() * top.length)].point;
}

function setChildPose(pose) {
  childPose = pose;
  if (!vrm) return;
  const sit = pose === "sit";
  for (const side of ["left", "right"]) {
    const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`);
    const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`);
    if (upper) upper.rotation.x = sit ? -Math.PI / 2.15 : 0;
    if (lower) lower.rotation.x = 0; // Knees straight (not bent) when sitting
  }
  const spine = vrm.humanoid.getNormalizedBoneNode("spine");
  const chest = vrm.humanoid.getNormalizedBoneNode("chest");
  if (spine) spine.rotation.x = sit ? -0.12 : 0; // Lean back against chair backrest
  if (chest) chest.rotation.x = sit ? -0.06 : 0;
}

function placeChild() {
  if (!current) return;
  const a = current.childAnchor;
  
  // Dynamically wrap seat belt over the child based on her exact height
  if (currentId === "car") {
    const isToddler = vrmHeight < 1.15;
    
    // Toddlers ride in the harnessed safety seat; older kids use the belt
    if (current.childSafetySeat) current.childSafetySeat.visible = isToddler;
    if (current.standardBelt) current.standardBelt.visible = !isToddler;

    a.seat = isToddler ? 0.94 : 0.85;
    a.z = 0.34;
  }

  // Use actual hip bone Y for precise seat placement
  child.updateMatrixWorld(true);
  let hipY = vrmHeight * 0.50; // fallback
  if (vrm) {
    const hips = vrm.humanoid.getNormalizedBoneNode("hips");
    if (hips) {
      // Reset child to origin to get pure local hip height
      const prevY = child.position.y;
      child.position.y = 0;
      child.updateMatrixWorld(true);
      hipY = hips.getWorldPosition(new THREE.Vector3()).y;
    }
  }
  // Add pelvis offset (hips are ~7.5% of height above butt) so butt sits on seat
  const pelvisOffset = vrmHeight * 0.075;
  const y = a.pose === "sit" ? (a.seat || 0) - hipY + pelvisOffset : 0;
  child.position.set(a.x, y, a.z);
  child.rotation.y = a.yaw;
  childBaseY = y;
  childWorld.x = a.x;
  childWorld.z = a.z;
  childTarget.x = a.x;
  childTarget.z = a.z;
  nextWanderAt = 0;
  lastPlayPointName = "";
  clearActivePlayPoint();
  walkAmt = 0;
  setChildPose(a.pose);

  // (Seat belts deleted by user request)
}

/* ============================================================
   Simple family member figure (for the party scene)
   ============================================================ */
function makePerson({ shirt, hairColor, skin = 0xc78d63, scale = 1 }) {
  const p = new THREE.Group();
  const sMat = mat(shirt, 0.62);
  const kMat = mat(skin, 0.72);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32 * scale, 0.55 * scale, 6, 16), sMat);
  torso.position.y = 0.95 * scale;
  torso.castShadow = true;
  p.add(torso);
  sph(p, 0.3 * scale, kMat, 0, 1.62 * scale, 0);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.31 * scale, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.42),
    mat(hairColor, 0.6)
  );
  cap.position.set(0, 1.71 * scale, -0.02 * scale);
  cap.scale.y = 0.75;
  p.add(cap);
  sph(p, 0.24 * scale, mat(hairColor, 0.6), 0, 1.63 * scale, -0.11 * scale, { sy: 0.85, cast: false });
  const dark = mat(0x241812, 0.3);
  sph(p, 0.032 * scale, dark, -0.095 * scale, 1.64 * scale, 0.27 * scale, { cast: false });
  sph(p, 0.032 * scale, dark, 0.095 * scale, 1.64 * scale, 0.27 * scale, { cast: false });
  const pm = new THREE.Mesh(new THREE.BoxGeometry(0.07 * scale, 0.018 * scale, 0.01 * scale), mat(0x7c3b30, 0.5));
  pm.position.set(0, 1.53 * scale, 0.28 * scale);
  p.add(pm);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07 * scale, 0.42 * scale, 5, 10), sMat);
    arm.position.set(side * 0.38 * scale, 0.95 * scale, 0.16 * scale);
    arm.rotation.x = -0.85;
    arm.rotation.z = side * 0.25;
    p.add(arm);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1 * scale, 0.36 * scale, 5, 10), mat(0x2c3242, 0.7));
    thigh.position.set(side * 0.15 * scale, 0.52 * scale, 0.3 * scale);
    thigh.rotation.x = Math.PI / 2 - 0.15;
    p.add(thigh);
  }
  return p;
}

/* ============================================================
   LOCATION: Home — a house with different rooms
   ============================================================ */
function buildHome() {
  const g = new THREE.Group();
  const colliders = [];
  const wallA = mat(0xcfc8b8, 0.92);
  const wallB = mat(0xbdb4a2, 0.92);
  const wood = mat(0x8a6a4c, 0.75);

  box(g, 14, 0.1, 12, wood, 0, -0.05, 0, { cast: false });
  box(g, 14, 0.1, 12, mat(0xefe9dc, 1), 0, 3.05, 0, { cast: false, receive: false });

  // exterior walls
  wall(g, colliders, wallA, 0, -6, 14, 0.2);
  wall(g, colliders, wallB, -7, 0, 0.2, 12);
  wall(g, colliders, wallB, 7, 0, 0.2, 12);

  // interior wall: kitchen | living  (opening x -3..-0.5)
  wall(g, colliders, wallA, -5, -1, 4, 0.18);
  wall(g, colliders, wallA, 0, -1, 1, 0.18);
  // interior wall: west | east rooms (door gaps z -3.9..-2.3 and z 1.3..2.9)
  wall(g, colliders, wallA, 0.5, -4.95, 0.18, 2.1);
  wall(g, colliders, wallA, 0.5, -0.5, 0.18, 3.6);
  wall(g, colliders, wallA, 0.5, 4.45, 0.18, 3.1);
  // interior wall: bedroom | bathroom (door gap x 2.2..3.8)
  wall(g, colliders, wallA, 1.35, 0, 1.7, 0.18);
  wall(g, colliders, wallA, 5.4, 0, 3.2, 0.18);

  // readable room thresholds: sealed frames in the wall gaps
  interiorDoor(g, -1.75, -1, 0, { flip: true, color: 0x9a704b, gapWidth: 2.5, noDoor: true });
  interiorDoor(g, 0.5, -3.1, Math.PI / 2, { color: 0x8f5f3a, gapWidth: 1.6 });
  interiorDoor(g, 0.5, 2.1, Math.PI / 2, { flip: true, color: 0xa0744a, gapWidth: 1.6 });
  interiorDoor(g, 3.0, 0, 0, { color: 0x8a6241, gapWidth: 1.6 });

  // ── FRONT DOOR (south wall, centered, enters from outside) ──────────────────
  // The south exterior wall is at z=6. We cut a gap for the front door at x~0.
  // Wall was: wall(g,colliders,wallA, 0,6, 14,0.2) — full solid wall.
  // Re-do it as two segments flanking a 1.8-unit gap centred at x=0:
  {
    const wallA2 = mat(0xd6cbbf, 0.92);
    // left segment: from x=-7 to x=-0.9, width = 6.1
    box(g, 6.1, 3.0, 0.2, wallA2, -3.55, 1.5, 6, { cast: true });
    solid(colliders, -3.55, 6, 6.1, 0.2);
    // right segment: from x=+0.9 to x=+7, width = 6.1
    box(g, 6.1, 3.0, 0.2, wallA2, 3.55, 1.5, 6, { cast: true });
    solid(colliders, 3.55, 6, 6.1, 0.2);
    // door frame posts
    const frameMat = mat(0xb98b5d, 0.7);
    box(g, 0.14, 2.4, 0.26, frameMat, -0.9, 1.2, 6, { cast: false });
    box(g, 0.14, 2.4, 0.26, frameMat,  0.9, 1.2, 6, { cast: false });
    box(g, 2.0,  0.18, 0.26, frameMat, 0,   2.47, 6, { cast: false });
    // filler above door to ceiling
    box(g, 1.8, 0.53, 0.22, wallA2, 0, 2.76, 6, { cast: false });
    // door leaf (slightly open, hinged left)
    const hinge = new THREE.Group();
    hinge.position.set(-0.82, 0, 5.9);
    hinge.rotation.y = 0.75;          // 43° open
    g.add(hinge);
    const leafW = 1.68;
    box(hinge, leafW, 2.1, 0.06, mat(0x6b4228, 0.7), leafW / 2, 1.05, 0);
    // door knob
    sph(hinge, 0.052, mat(0xd8ae5e, 0.35, { metalness: 0.35 }), leafW - 0.15, 1.05, 0.06, { w: 12, h: 8 });
    // front step / porch slab
    box(g, 2.2, 0.12, 0.9, mat(0x9e9287, 0.9), 0, 0.06, 6.5, { cast: false });
    // doorbell light
    sph(g, 0.04, glowMat(0xffdf80), 1.05, 1.45, 5.82, { cast: false });
    // door number plate
    {
      const plate = textPanel("42", 0.28, 0.18, "#3a2410", "#f0dfc0");
      plate.position.set(-0.74, 2.1, 5.82);
      g.add(plate);
    }
    solid(colliders, 0, 6.5, 2.2, 0.9); // block the porch
  }

  // windows (emissive daylight) with curtains
  const win = glowMat(0xcfe8ff);
  box(g, 1.9, 1.2, 0.05, win, -4, 1.8, -5.87, { cast: false, receive: false });
  box(g, 1.9, 1.2, 0.05, win, -3.4, 1.8, 5.87, { cast: false, receive: false });
  box(g, 0.05, 1.2, 1.9, win, 6.87, 1.8, -3, { cast: false, receive: false });
  curtains(g, -4, -5.87, "north");
  curtains(g, -3.4, 5.87, "south");
  curtains(g, 6.87, -3, "east", 0x8fae85);

  /* --- living room (real furniture models) --- */
  prop(g, "furniture/rugRound", -3.4, 3.2, { s: 3.6 });
  // TV wall sits on the solid south part of the wall, clear of the bathroom door
  prop(g, "furniture/loungeSofa", -6.15, 4.5, { s: 2, ry: Math.PI / 2 });
  solid(colliders, -6.15, 4.5, 1.1, 2.2);
  prop(g, "furniture/tableCoffee", -4.4, 4.5, { s: 2, ry: Math.PI / 2 });
  solid(colliders, -4.4, 4.5, 0.95, 1.5);
  box(g, 0.08, 1.35, 1.95, mat(0x2b2924, 0.68), 0.42, 0.92, 4.5, { cast: false });
  prop(g, "furniture/cabinetTelevision", 0.28, 4.5, { s: 1.85, ry: -Math.PI / 2 });
  prop(g, "furniture/televisionModern", 0.3, 4.5, { s: 1.45, ry: -Math.PI / 2, y: 0.58 });
  solid(colliders, 0.28, 4.5, 0.75, 1.9);
  prop(g, "furniture/bookcaseClosedWide", -1.4, 5.6, { s: 2, ry: Math.PI });
  solid(colliders, -1.4, 5.6, 1.8, 0.7);
  // books on the shelves
  for (const [bx, by, brot] of [[-1.72, 0.06, 0.2], [-1.35, 0.06, -0.3], [-1.05, 0.06, 0.5], [-1.6, 0.5, -0.2], [-1.18, 0.5, 0.35], [-1.45, 0.98, 0.1]]) {
    prop(g, "furniture/books", bx, 5.62, { s: 1.5, y: by, ry: brot });
  }
  prop(g, "furniture/lampRoundFloor", -6.5, 2.85, { s: 2 });
  solid(colliders, -6.5, 2.85, 0.5, 0.5);
  prop(g, "furniture/pottedPlant", -0.5, 5.25, { s: 2 });
  solid(colliders, -0.5, 5.25, 0.6, 0.6);
  prop(g, "furniture/ceilingFan", -3.4, 3.2, { s: 2, y: 2.72 });
  prop(g, "furniture/coatRackStanding", -6.55, 1.5, { s: 2 });
  solid(colliders, -6.55, 1.5, 0.6, 0.6);
  // bear head trophy mounted on the wall, where a trophy belongs
  prop(g, "furniture/bear", -1.4, 5.85, { s: 1.3, y: 2.05, ry: Math.PI });

  // Mira's play corner: little table, floor cushion, books
  prop(g, "furniture/tableCoffeeSquare", -3.1, 0.6, { s: 1.6 });
  prop(g, "furniture/books", -3.2, 0.62, { s: 1.6, y: 0.37, ry: 0.4 });
  prop(g, "furniture/pillow", -2.35, 1.15, { s: 1.4, ry: -0.7 });
  solid(colliders, -3.1, 0.6, 1.2, 0.8);
  // Toy cars and small items in Mira's corner from Kenney kits
  prop(g, "car/kart-oopi", -2.7, 1.7, { s: 0.18, ry: 0.6 });
  prop(g, "car/kart-ooli", -2.1, 0.8, { s: 0.16, ry: -0.8 });
  // Cookie and lollypop sitting on Mira's little table (same x/z as table center)
  prop(g, "food/cookie", -3.3, 0.6, { s: 0.55, y: 0.39 });
  prop(g, "food/lollypop", -2.9, 0.6, { s: 0.55, y: 0.40, ry: 0.5 });
  // Nature mushrooms as playful decorations
  prop(g, "nature/mushroom_red", -4.5, 1.8, { s: 1.2 });
  prop(g, "nature/mushroom_tan", -4.8, 2.4, { s: 1.0, ry: 0.6 });

  // painting on the west wall + warm floor lamp light
  box(g, 0.05, 1.0, 1.5, mat(0xd98632, 0.7), -6.87, 1.9, 1.5, { cast: false });
  box(g, 0.03, 0.8, 1.3, mat(0x1c5a5a, 0.6), -6.84, 1.9, 1.5, { cast: false });
  const lampLight = new THREE.PointLight(0xffa64d, 1.4, 6, 2);
  lampLight.position.set(-6.3, 1.7, 5.2);
  g.add(lampLight);

  /* --- kitchen (real appliance models) --- */
  const counterRow = ["kitchenCabinetDrawer", "kitchenSink", "kitchenStove", "kitchenCabinet"];
  counterRow.forEach((name, i) => {
    prop(g, `furniture/${name}`, -5.2 + i * 0.87, -5.55, { s: 2 });
  });
  for (let i = 0; i < 3; i++) {
    prop(g, "furniture/kitchenCabinetUpper", -5.0 + i * 0.9, -5.7, { s: 2, y: 1.45 });
  }
  solid(colliders, -3.9, -5.55, 4.2, 0.95);
  prop(g, "furniture/kitchenFridge", -6.35, -5.45, { s: 2 });
  solid(colliders, -6.35, -5.45, 1.0, 0.9);
  prop(g, "furniture/kitchenMicrowave", -2.55, -5.6, { s: 2, y: 0.9 });
  prop(g, "furniture/kitchenCoffeeMachine", -5.2, -5.65, { s: 2, y: 0.9 });
  prop(g, "furniture/tableCross", -3, -3.1, { s: 2 });
  prop(g, "food/plate-dinner", -3.34, -3.02, { s: 0.34, y: 0.705, ry: 0.3 });
  prop(g, "food/cup-coffee", -2.68, -3.28, { s: 0.5, y: 0.705, ry: -0.4 });
  prop(g, "food/bowl-cereal", -2.95, -2.82, { s: 0.45, y: 0.705 });
  prop(g, "food/apple", -3.18, -3.38, { s: 0.45, y: 0.705 });
  prop(g, "furniture/chairCushion", -3.95, -3.1, { s: 2, ry: Math.PI / 2 });
  prop(g, "furniture/chairCushion", -2.05, -3.1, { s: 2, ry: -Math.PI / 2 });
  prop(g, "food/cutting-board", -4.2, -5.5, { s: 1.15, y: 0.9, ry: Math.PI / 2 });
  prop(g, "food/pan", -3.55, -5.5, { s: 1.1, y: 0.9, ry: -0.35 });
  prop(g, "food/banana", -5.35, -5.5, { s: 0.9, y: 0.9, ry: 0.6 });
  prop(g, "furniture/trashcan", -1.95, -5.45, { s: 2 });
  solid(colliders, -1.95, -5.45, 0.55, 0.55);
  solid(colliders, -3, -3.1, 1.7, 1.7);
  const kitchenLight = new THREE.PointLight(0xfff1cf, 1.1, 7, 2);
  kitchenLight.position.set(-3.4, 2.7, -3.4);
  g.add(kitchenLight);

  /* --- bedroom (wall-aligned, clearer circulation) --- */
  prop(g, "furniture/rugRectangle", 4.6, -3.55, { s: 2.7, ry: Math.PI / 2 });
  prop(g, "furniture/bedSingle", 5.65, -5.05, { s: 2.05, ry: Math.PI / 2 });
  solid(colliders, 5.65, -5.05, 2.15, 1.2);
  // bear head trophy on the bedroom wall
  prop(g, "furniture/bear", 6.85, -4.2, { s: 1.2, y: 1.85, ry: -Math.PI / 2 });
  prop(g, "furniture/sideTableDrawers", 4.12, -5.45, { s: 1.75 });
  prop(g, "furniture/lampSquareTable", 4.12, -5.45, { s: 1.25, y: 0.67 });
  solid(colliders, 4.12, -5.45, 0.72, 0.72);
  const bedLight = new THREE.PointLight(0xffb066, 1.05, 5.2, 2);
  bedLight.position.set(4.25, 1.35, -5.25);
  g.add(bedLight);
  prop(g, "furniture/bookcaseOpenLow", 1.45, -5.55, { s: 1.9 });
  solid(colliders, 1.45, -5.55, 1.35, 0.62);
  prop(g, "furniture/desk", 6.48, -2.45, { s: 1.75, ry: -Math.PI / 2 });
  prop(g, "furniture/chairDesk", 5.6, -2.45, { s: 1.55, ry: Math.PI / 2 });
  prop(g, "furniture/computerScreen", 6.46, -2.45, { s: 1.05, y: 0.67, ry: -Math.PI / 2 });
  prop(g, "furniture/books", 6.42, -2.88, { s: 0.82, y: 0.67, ry: -0.4 });
  prop(g, "furniture/radio", 1.45, -5.6, { s: 1.4, y: 0.76 });
  prop(g, "furniture/books", 1.28, -5.55, { s: 1.3, y: 0.02, ry: 0.3 });
  prop(g, "furniture/books", 1.62, -5.55, { s: 1.3, y: 0.4, ry: -0.25 });
  solid(colliders, 6.48, -2.45, 0.82, 1.35);
  prop(g, "furniture/cabinetBedDrawer", 1.02, -1.08, { s: 1.8, ry: Math.PI / 2 });
  solid(colliders, 1.02, -1.08, 0.65, 1.15);
  prop(g, "furniture/plantSmall2", 6.45, -0.55, { s: 1.25 });
  box(g, 1.3, 0.86, 0.035, mat(0x527ba0, 0.65), 4.55, 1.85, -5.88, { cast: false });
  box(g, 1.06, 0.62, 0.025, mat(0xf3d482, 0.7), 4.55, 1.85, -5.91, { cast: false });

  /* --- bathroom: vanity wall, private toilet bay, glass shower lane --- */
  tileFloor(g, 3.75, 3.0, 6.35, 5.75, { base: 0xded8c9, grout: 0xbfb7a8, step: 0.82 });
  wallTileSurface(g, 3.75, 1.25, 5.86, 6.05, 2.35, "north", { cols: 6, rows: 4 });
  wallTileSurface(g, 6.86, 1.25, 3.0, 5.55, 2.35, "east", { cols: 5, rows: 4 });
  wallTileSurface(g, 0.62, 1.25, 4.4, 2.8, 2.35, "west", { cols: 3, rows: 4 });
  wallTileSurface(g, 5.32, 1.25, 0.12, 3.0, 2.35, "south", { cols: 3, rows: 4 });

  const marble = mat(0xe6e0d6, 0.62);
  box(g, 3.9, 0.12, 0.72, marble, 2.82, 0.9, 5.48, { cast: true });
  prop(g, "furniture/bathroomCabinetDrawer", 1.35, 5.42, { s: 1.8, ry: Math.PI });
  // sink basin recessed into the vanity counter
  prop(g, "furniture/bathroomSinkSquare", 2.48, 5.43, { s: 1.3, y: 0.52, ry: Math.PI });
  prop(g, "furniture/washer", 1.05, 4.35, { s: 2, ry: Math.PI / 2 });
  solid(colliders, 1.05, 4.35, 0.85, 0.85);
  prop(g, "furniture/bathroomCabinet", 3.45, 5.78, { s: 1.55, y: 1.3, ry: Math.PI });
  prop(g, "furniture/bathroomCabinetDrawer", 4.15, 5.42, { s: 1.8, ry: Math.PI });
  solid(colliders, 2.82, 5.45, 3.85, 0.76);
  prop(g, "furniture/bathroomMirror", 2.48, 5.78, { s: 2.05, y: 1.35, ry: Math.PI });
  box(g, 1.15, 0.85, 0.04, glowMat(0xd8ecf2), 2.48, 1.8, 5.84, { cast: false });
  prop(g, "furniture/lampWall", 1.25, 5.78, { s: 1.15, y: 1.75, ry: Math.PI });
  prop(g, "furniture/lampWall", 3.72, 5.78, { s: 1.15, y: 1.75, ry: Math.PI });
  towelBar(g, 0.68, 1.15, 4.28, Math.PI / 2);

  const privacyWall = mat(0xcac2b3, 0.92);
  box(g, 0.16, 2.7, 2.35, privacyWall, 4.86, 1.35, 4.38, { cast: false });
  box(g, 0.16, 2.45, 1.05, privacyWall, 5.56, 1.22, 3.27, { ry: Math.PI / 2, cast: false });
  wallTileSurface(g, 4.76, 1.25, 4.38, 2.2, 2.35, "west", { cols: 3, rows: 4 });
  box(g, 0.08, 0.08, 2.45, mat(0xa79d8f, 0.8), 4.72, 2.72, 4.38, { cast: false });
  solid(colliders, 4.86, 4.38, 0.16, 2.35);
  solid(colliders, 5.56, 3.27, 1.05, 0.16);
  prop(g, "furniture/toilet", 5.95, 5.05, { s: 1.75, ry: Math.PI });
  solid(colliders, 5.95, 5.05, 0.85, 0.95);
  prop(g, "furniture/bathroomCabinet", 5.95, 5.75, { s: 1.35, y: 1.2, ry: Math.PI });

  glassPanel(g, 1.55, 2.15, 0.045, 6.12, 2.25, { ry: Math.PI / 2 });
  glassPanel(g, 1.2, 2.15, 0.045, 5.52, 1.25);
  prop(g, "furniture/showerRound", 6.1, 1.22, { s: 1.75, ry: -Math.PI / 2 });
  solid(colliders, 6.1, 1.22, 1.25, 1.25);
  prop(g, "furniture/rugDoormat", 3.05, 3.25, { s: 1.7, ry: Math.PI / 2 });
  cyl(g, 0.28, 0.2, 0.05, glowMat(0xfff5db), 3.35, 2.96, 3.05, { cast: false, receive: false });
  const bathLight = new THREE.PointLight(0xfff0d2, 1.7, 7.5, 2);
  bathLight.position.set(3.35, 2.55, 3.05);
  g.add(bathLight);

  // key light through windows
  const sun = new THREE.DirectionalLight(0xffe4bf, 1.6);
  sun.position.set(6, 7, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  g.add(sun);

  return {
    group: g,
    colliders,
    bounds: { minX: -6.6, maxX: 6.6, minZ: -5.6, maxZ: 5.6 },
    spawn: { x: -3.2, z: 4.6, yaw: -0.15 },
    childAnchor: { x: -3.0, z: 2.7, yaw: Math.PI * 0.05, pose: "stand" },
    canMove: true,
    eye: 1.55,
    env: { bg: 0x1a1713, fog: [0x1a1713, 9, 24], hemi: 0.5, envI: 0.3 },
  };
}

/* ============================================================
   LOCATION: Car ride — seated, world drives past
   ============================================================ */
function buildCar() {
  const g = new THREE.Group();
  const movers = [];
  const inspectCar = queryParams.get("view") === "car";

  // world outside
  box(g, 60, 0.08, 120, mat(0x6da24e, 0.95), 0, -0.09, -20, { cast: false });
  box(g, 7, 0.1, 120, mat(0x3a3d42, 0.95), 0, -0.03, -20, { cast: false });
  box(g, 1.6, 0.12, 120, mat(0x9aa0a4, 0.9), -4.3, -0.02, -20, { cast: false });
  box(g, 1.6, 0.12, 120, mat(0x9aa0a4, 0.9), 4.3, -0.02, -20, { cast: false });

  const dashMat = glowMat(0xf2efe4);
  for (let i = 0; i < 18; i++) {
    const dash = box(g, 0.16, 0.03, 1.1, dashMat, 0, 0.03, -70 + i * 4.5, { cast: false, receive: false });
    movers.push(dash);
  }
  // real suburban houses + trees streaming past (Kenney city + nature kits)
  const houseTypes = ["a", "b", "c", "e", "g", "k", "m", "q"];
  const roadTrees = ["tree_default", "tree_oak", "tree_detailed", "tree_fat", "tree_pineRoundA"];
  for (let i = 0; i < 22; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const zBase = -75 + i * 3.9;
    const holder = new THREE.Group();
    holder.position.set(side * (9.5 + rnd(i) * 3), 0, zBase);
    holder.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(holder);
    movers.push(holder);
    if (i % 3 === 0) {
      prop(holder, `city/building-type-${houseTypes[i % houseTypes.length]}`, 0, 0, { s: 4.5 });
    } else {
      prop(holder, `nature/${roadTrees[i % roadTrees.length]}`, 0, 0, { s: 2.3 + rnd(i) * 1.2 });
    }
  }
  // oncoming traffic in the other lane
  const traffic = [];
  ["car/taxi", "car/sedan", "car/van", "car/suv"].forEach((name, i) => {
    const holder = new THREE.Group();
    holder.position.set(-2.2, 0, -25 - i * 22);
    holder.rotation.y = Math.PI;
    g.add(holder);
    prop(holder, name, 0, 0, { s: 1.5 });
    traffic.push(holder);
  });

  // car cabin
  const paint = mat(0xb9aca2, 0.72, { metalness: 0.08 });
  const lowerTrim = mat(0x746b66, 0.74);
  const darkTrim = mat(0x1f232a, 0.52);
  const redAccent = mat(0xba3f35, 0.45);
  const stitch = mat(0x2d2826, 0.62);
  const chrome = mat(0xcfd2d1, 0.32, { metalness: 0.28 });

  // floor, tunnel, and cabin shell
  box(g, 1.95, 0.1, 3.55, mat(0x15181d, 0.78), 0, 0.42, 0.2, { cast: false });
  rbox(g, 0.48, 0.18, 2.1, 0.02, 3, lowerTrim, 0.03, 0.62, 0.55);
  box(g, 1.95, 0.34, 1.25, paint, 0, 0.8, -1.95);
  box(g, 0.07, 0.68, 3.05, paint, -0.98, 0.9, 0.22);
  box(g, 0.07, 0.68, 3.05, paint, 0.98, 0.9, 0.22);
  if (!inspectCar) box(g, 1.95, 0.09, 2.2, paint, 0, 2.1, 0.7, { cast: false });

  // layered dashboard inspired by the reference photo
  rbox(g, 1.86, 0.28, 0.46, 0.05, 4, lowerTrim, 0, 1.0, -0.92);
  rbox(g, 1.82, 0.15, 0.58, 0.04, 4, paint, 0, 1.22, -0.94);
  rbox(g, 1.74, 0.05, 0.48, 0.03, 3, mat(0xa79c93, 0.82), 0, 1.34, -0.97, { cast: false });
  box(g, 1.66, 0.03, 0.035, redAccent, 0, 1.17, -0.58, { cast: false });
  // Custom Canvas Instrument Cluster (Speedometer/Gauges)
  const gaugeCanvas = document.createElement("canvas");
  gaugeCanvas.width = 256;
  gaugeCanvas.height = 128;
  const gCtx = gaugeCanvas.getContext("2d");
  gCtx.fillStyle = "#11141a";
  gCtx.fillRect(0, 0, 256, 128);

  // Speedometer arc (left)
  gCtx.strokeStyle = "#38475c";
  gCtx.lineWidth = 6;
  gCtx.beginPath();
  gCtx.arc(70, 70, 45, Math.PI * 0.8, Math.PI * 2.2);
  gCtx.stroke();
  gCtx.strokeStyle = "#00d2ff";
  gCtx.beginPath();
  gCtx.arc(70, 70, 45, Math.PI * 0.8, Math.PI * 1.6);
  gCtx.stroke();

  // Tachometer arc (right)
  gCtx.strokeStyle = "#38475c";
  gCtx.lineWidth = 6;
  gCtx.beginPath();
  gCtx.arc(186, 70, 45, Math.PI * 0.8, Math.PI * 2.2);
  gCtx.stroke();
  gCtx.strokeStyle = "#ff9d3d";
  gCtx.beginPath();
  gCtx.arc(186, 70, 45, Math.PI * 0.8, Math.PI * 1.4);
  gCtx.stroke();

  // Digital Speed Center
  gCtx.fillStyle = "#ffffff";
  gCtx.font = "bold 20px sans-serif";
  gCtx.textAlign = "center";
  gCtx.fillText("65", 128, 64);
  gCtx.fillStyle = "#8a9bb4";
  gCtx.font = "10px sans-serif";
  gCtx.fillText("MPH", 128, 78);
  gCtx.fillStyle = "#27ae60";
  gCtx.fillText("◀  D  ▶", 128, 44);

  const gaugeTex = new THREE.CanvasTexture(gaugeCanvas);
  const gaugeMat = new THREE.MeshBasicMaterial({ map: gaugeTex });
  
  // Dashboard gauge cowl/hood
  rbox(g, 0.76, 0.22, 0.36, 0.04, 3, lowerTrim, -0.46, 1.42, -0.94);
  // The digital gauges display screen
  box(g, 0.62, 0.18, 0.02, gaugeMat, -0.46, 1.34, -0.91, { cast: false, receive: false });

  box(g, 0.88, 0.08, 0.05, darkTrim, 0.36, 1.34, -0.63, { cast: false });
  // Custom Canvas GPS Navigation screen
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = 256;
  mapCanvas.height = 128;
  const ctx = mapCanvas.getContext("2d");
  ctx.fillStyle = "#1b212c";
  ctx.fillRect(0, 0, 256, 128);
  // Grid/Roads
  ctx.strokeStyle = "#38475c";
  ctx.lineWidth = 4;
  for (let i = 0; i < 256; i += 40) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
  }
  for (let j = 0; j < 128; j += 40) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(256, j); ctx.stroke();
  }
  // Route line
  ctx.strokeStyle = "#00d2ff";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(30, 110);
  ctx.lineTo(90, 80);
  ctx.lineTo(160, 80);
  ctx.lineTo(220, 30);
  ctx.stroke();
  // GPS Marker
  ctx.fillStyle = "#ff3b30";
  ctx.beginPath();
  ctx.arc(160, 80, 8, 0, Math.PI * 2);
  ctx.fill();
  // UI text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("Route Active", 12, 28);
  ctx.fillStyle = "#8a9bb4";
  ctx.font = "12px sans-serif";
  ctx.fillText("ETA: 12 min", 12, 46);

  const screenTex = new THREE.CanvasTexture(mapCanvas);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
  box(g, 0.74, 0.26, 0.035, screenMat, 0.38, 1.45, -0.66, { cast: false, receive: false });

  box(g, 0.5, 0.035, 0.045, darkTrim, 0.38, 1.29, -0.68, { cast: false });
  box(g, 0.84, 0.07, 0.07, darkTrim, 0.34, 1.54, -0.98, { cast: false });
  for (let i = 0; i < 8; i++) {
    box(g, 0.08, 0.012, 0.055, mat(0x2a2e32, 0.58), -0.32 + i * 0.09, 1.38, -1.22, { cast: false });
  }
  carVent(g, -0.24, 1.22, -0.56, 0.44);
  carVent(g, 0.4, 1.22, -0.56, 0.5);
  box(g, 0.18, 0.15, 0.05, mat(0xd8d4cf, 0.5), 0.09, 1.22, -0.52, { cast: false });
  carButton(g, 0.09, 1.26, -0.555, 0.08, 0.055, "!");

  // climate and media controls under the vents
  box(g, 0.92, 0.22, 0.055, mat(0x30343a, 0.58), 0.12, 1.0, -0.54, { cast: false });
  for (let i = 0; i < 7; i++) {
    carButton(g, -0.25 + i * 0.11, 1.04, -0.585, 0.075, 0.028);
  }
  for (const x of [-0.34, 0.54]) {
    cyl(g, 0.055, 0.055, 0.045, chrome, x, 0.94, -0.58, { rx: Math.PI / 2, seg: 18 });
    cyl(g, 0.034, 0.034, 0.052, darkTrim, x, 0.94, -0.61, { rx: Math.PI / 2, seg: 18 });
  }
  box(g, 0.42, 0.18, 0.04, glowMat(0x24313a), -0.5, 1.2, -0.57, { cast: false, receive: false });
  cyl(g, 0.15, 0.16, 0.05, darkTrim, -0.45, 1.2, -0.6, { rx: Math.PI / 2, seg: 24 });
  cyl(g, 0.09, 0.09, 0.055, glowMat(0x31485a), -0.45, 1.2, -0.63, { rx: Math.PI / 2, seg: 18 });

  // Tiny dashboard plant
  prop(g, "furniture/plantSmall3", 0.52, -1.0, { s: 0.42, y: 1.37 });

  // steering column
  cyl(g, 0.035, 0.045, 0.42, darkTrim, -0.46, 1.0, -0.72, { rx: 0.6 });

  // steering wheel group (tilted)
  const steeringAssembly = new THREE.Group();
  steeringAssembly.position.set(-0.46, 1.18, -0.52);
  steeringAssembly.rotation.x = -0.95;
  g.add(steeringAssembly);

  const wheelGroup = new THREE.Group();
  steeringAssembly.add(wheelGroup);

  // Wheel rim (rounded torus)
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 16, 36), mat(0x1b1d21, 0.38));
  wheelGroup.add(wheel);

  // Spokes
  const spoke = rbox(wheelGroup, 0.44, 0.05, 0.03, 0.01, 3, darkTrim, 0, 0, 0);
  const spokeVert = rbox(wheelGroup, 0.05, 0.22, 0.03, 0.01, 3, darkTrim, 0, -0.1, 0);

  // Center pad
  const centerPad = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 24), mat(0x282c34, 0.42));
  centerPad.rotation.x = Math.PI / 2;
  wheelGroup.add(centerPad);

  // Chrome logo
  const logo = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16), chrome);
  logo.position.y = 0.031;
  logo.rotation.x = Math.PI / 2;
  wheelGroup.add(logo);

  // Buttons on spokes
  carButton(wheelGroup, -0.13, 0.02, 0.018, 0.07, 0.045);
  carButton(wheelGroup, 0.13, 0.02, 0.018, 0.07, 0.045);

  // front seats, rear bench, and center console
  quiltedSeat(g, -0.5, 0.35, { color: 0x6a5048 });
  quiltedSeat(g, 0.52, 0.35, { color: 0x7a665f });
  // child safety booster seat shell group
  const childSafetySeat = new THREE.Group();
  g.add(childSafetySeat);

  const shellMat = mat(0x202428, 0.48); // dark charcoal shell
  const padMat = mat(0x404550, 0.65);   // gray padded cushion fabric
  const trimMat = mat(0xe5e9ed, 0.9);   // white lining/trim

  // Safety seat base cushion
  rbox(childSafetySeat, 0.48, 0.10, 0.48, 0.04, 3, padMat, 0.52, 0.86, 0.35);
  
  // Side torso bolsters (lower, so the chest harness stays visible)
  rbox(childSafetySeat, 0.08, 0.2, 0.22, 0.03, 3, shellMat, 0.73, 0.99, 0.38);
  rbox(childSafetySeat, 0.08, 0.2, 0.22, 0.03, 3, shellMat, 0.31, 0.99, 0.38);

  // Side bolster trim (white borders)
  rbox(childSafetySeat, 0.015, 0.2, 0.015, 0.005, 3, trimMat, 0.772, 0.99, 0.49);
  rbox(childSafetySeat, 0.015, 0.2, 0.015, 0.005, 3, trimMat, 0.268, 0.99, 0.49);

  // Side headrest guards (left & right head protection wings)
  rbox(childSafetySeat, 0.08, 0.24, 0.26, 0.03, 3, shellMat, 0.73, 1.34, 0.44);
  rbox(childSafetySeat, 0.08, 0.24, 0.26, 0.03, 3, shellMat, 0.31, 1.34, 0.44);

  // Side headrest trim (white borders)
  rbox(childSafetySeat, 0.015, 0.24, 0.015, 0.005, 3, trimMat, 0.772, 1.34, 0.56);
  rbox(childSafetySeat, 0.015, 0.24, 0.015, 0.005, 3, trimMat, 0.268, 1.34, 0.56);

  // Seat backrest cushion
  rbox(childSafetySeat, 0.44, 0.68, 0.12, 0.03, 3, padMat, 0.52, 1.22, 0.50, { rx: -0.1 });

  // --- 5-point safety harness on the toddler seat (Deleted by user request) ---
  const beltMat = mat(0x39414d, 0.55); // visible slate webbing
  const buckleMat = mat(0xc2c7cd, 0.3, { metalness: 0.7 });

  // --- standard diagonal seat belt for older kids (no safety seat) (Deleted by user request) ---
  const standardBelt = new THREE.Group();
  g.add(standardBelt);
  standardBelt.visible = false;

  // Grocery bag rides low on the rear bench, away from the driver's camera seat.
  prop(g, "food/bag", -0.58, 1.42, { s: 0.42, ry: -0.35, y: 1.02 });
  // Child's items on back seat: toy car, stuffed animals, coloring book
  prop(g, "car/kart-oopi", 0.52, -0.45, { s: 0.12, ry: Math.PI * 0.7, y: 1.07 });
  prop(g, "food/lollypop", 0.7, -0.05, { s: 0.5, ry: 0.8, y: 1.09 });
  prop(g, "food/cookie", 0.42, 0.55, { s: 0.55, y: 1.09 });
  prop(g, "food/soda", 0.75, 0.62, { s: 0.55, ry: 0.3, y: 1.09 });

  rbox(g, 1.7, 0.16, 0.62, 0.03, 3, mat(0x5b4741, 0.82), 0, 0.78, 1.55);
  rbox(g, 1.7, 0.7, 0.16, 0.03, 3, mat(0x5b4741, 0.82), 0, 1.2, 1.85, { rx: -0.08 });
  for (const x of [-0.42, 0, 0.42]) {
    box(g, 0.012, 0.58, 0.018, stitch, x, 1.21, 1.77, { rx: -0.08, cast: false });
  }
  
  // Console Armrest base and Lid
  rbox(g, 0.42, 0.2, 1.85, 0.02, 3, mat(0xa99d95, 0.72), 0.02, 0.88, 0.58);
  rbox(g, 0.4, 0.18, 0.72, 0.03, 3, mat(0xbdb3aa, 0.68), 0.02, 1.02, 1.02);
  
  // Premium French double stitching on the leather armrest
  box(g, 0.01, 0.01, 0.72, stitch, -0.15, 1.112, 1.02, { cast: false });
  box(g, 0.01, 0.01, 0.72, stitch, 0.19, 1.112, 1.02, { cast: false });

  // Console donut snack
  prop(g, "food/donut-sprinkles", 0.02, 1.02, { s: 0.45, ry: 0.3, y: 1.135 });

  gearSelector(g, 0.02, 0.96, -0.02);

  // Cup holders with coffee and soda
  cyl(g, 0.095, 0.095, 0.035, darkTrim, -0.12, 1.04, 0.38, { seg: 24 });
  prop(g, "food/cup-coffee", -0.12, 0.38, { s: 0.65, ry: 1.5, y: 1.04 });

  cyl(g, 0.095, 0.095, 0.035, darkTrim, -0.12, 1.04, 0.52, { seg: 24 });
  prop(g, "food/soda-can", -0.12, 0.52, { s: 0.6, ry: -0.8, y: 1.04 });
  cyl(g, 0.095, 0.095, 0.035, darkTrim, 0.14, 1.04, 0.38, { seg: 24 });
  for (let i = 0; i < 5; i++) carButton(g, -0.15 + i * 0.075, 1.07, 0.17, 0.052, 0.04);
  
  // Recessed console storage tray
  rbox(g, 0.34, 0.04, 0.52, 0.015, 3, mat(0x202428, 0.62), 0.02, 1.12, 0.66, { cast: false });

  // Smartphone lying in the tray with a glowing lock screen
  const phoneCanvas = document.createElement("canvas");
  phoneCanvas.width = 64;
  phoneCanvas.height = 128;
  const pCtx = phoneCanvas.getContext("2d");
  pCtx.fillStyle = "#1e293b";
  pCtx.fillRect(0, 0, 64, 128);
  pCtx.fillStyle = "#38bdf8";
  pCtx.beginPath(); pCtx.arc(32, 128, 45, 0, Math.PI, true); pCtx.fill();
  pCtx.fillStyle = "#ffffff";
  pCtx.font = "bold 15px sans-serif";
  pCtx.textAlign = "center";
  pCtx.fillText("12:48", 32, 32);
  pCtx.font = "8px sans-serif";
  pCtx.fillText("Tuesday", 32, 44);

  const phoneTex = new THREE.CanvasTexture(phoneCanvas);
  const phoneMat = new THREE.MeshBasicMaterial({ map: phoneTex });

  // Phone body
  rbox(g, 0.09, 0.012, 0.16, 0.006, 3, mat(0x0f172a, 0.2, { metalness: 0.8 }), 0.05, 1.13, 0.62, { ry: 0.28 });
  // Phone screen
  box(g, 0.082, 0.002, 0.152, phoneMat, 0.05, 1.137, 0.62, { ry: 0.28 });

  // door cards, speaker rings, and window/roof structure
  box(g, 0.08, 0.48, 1.38, lowerTrim, -0.96, 0.98, 0.08);
  box(g, 0.08, 0.48, 1.38, lowerTrim, 0.96, 0.98, 0.08);
  box(g, 0.085, 0.08, 0.78, mat(0xb7a99e, 0.72), -0.99, 1.05, 0.08, { cast: false });
  box(g, 0.085, 0.08, 0.78, mat(0xb7a99e, 0.72), 0.99, 1.05, 0.08, { cast: false });
  box(g, 0.09, 0.025, 1.08, redAccent, -1.005, 1.18, 0.08, { cast: false });
  box(g, 0.09, 0.025, 1.08, redAccent, 1.005, 1.18, 0.08, { cast: false });
  box(g, 0.1, 0.06, 0.66, darkTrim, -0.98, 1.25, -0.1, { cast: false });
  box(g, 0.1, 0.06, 0.66, darkTrim, 0.98, 1.25, -0.1, { cast: false });
  for (const sx of [-1, 1]) {
    // Dark speaker mesh background
    const backer = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 24), mat(0x181a1d, 0.62));
    backer.position.set(sx * 0.992, 0.82, -0.42);
    backer.rotation.z = Math.PI / 2;
    g.add(backer);

    // Chrome outer speaker ring trim
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.013, 8, 24), mat(0xcfd2d1, 0.32, { metalness: 0.55 }));
    ring.position.set(sx * 0.995, 0.82, -0.42);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
  }
  if (!inspectCar) {
    box(g, 1.86, 0.06, 0.08, darkTrim, 0, 1.96, -0.62, { cast: false });
    box(g, 1.9, 0.05, 0.1, mat(0x5d645f, 0.55), 0, 2.22, -0.4, { cast: false });
  }
  for (const [px, pz, tilt] of [[-0.9, -0.72, 0.28], [0.9, -0.72, 0.28], [-0.9, 1.62, -0.2], [0.9, 1.62, -0.2]]) {
    if (!inspectCar || pz < 0) cyl(g, 0.045, 0.045, 0.95, darkTrim, px, 1.6, pz, { rx: tilt });
  }
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.78, 0.85),
    new THREE.MeshBasicMaterial({ color: 0xbfe0f2, transparent: true, opacity: 0.14 })
  );
  glass.position.set(0, 1.72, -1.1);
  glass.rotation.x = -0.3;
  g.add(glass);
  // Polished stem-and-frame rearview mirror
  cyl(g, 0.015, 0.015, 0.12, darkTrim, 0, 1.98, -0.8, { rx: 0.6, seg: 8 });
  rbox(g, 0.32, 0.11, 0.03, 0.015, 3, darkTrim, 0, 1.9, -0.7);
  box(g, 0.3, 0.09, 0.01, mat(0xbfc5c7, 0.2, { metalness: 0.95, roughness: 0.05 }), 0, 1.9, -0.682);
  const cabinGlow = new THREE.PointLight(0xffd0bf, 0.28, 3.2, 2);
  cabinGlow.position.set(0.25, 1.5, -0.3);
  g.add(cabinGlow);

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.22);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  g.add(sun);

  return {
    group: g,
    colliders: [],
    bounds: { minX: -0.45, maxX: -0.45, minZ: 0.42, maxZ: 0.42 },
    spawn: { x: -0.45, z: 0.42, yaw: 0 },
    childAnchor: { x: 0.52, z: 0.34, seat: 1.03, yaw: Math.PI, pose: "sit" },
    aimAtChild: false,
    canMove: false,
    eye: 1.58,
    env: { bg: 0xbfe0f2, fog: [0xbfe0f2, 30, 90], hemi: 0.65, envI: 0.55 },
    camWobble: (t) => Math.sin(t * 7.2) * 0.008,
    tick: (t, dt) => {
      for (const m of movers) {
        m.position.z += dt * 10;
        if (m.position.z > 14) m.position.z -= 90;
      }
      for (const c of traffic) {
        c.position.z += dt * 19;
        if (c.position.z > 16) c.position.z -= 104;
      }
      wheelGroup.rotation.z = Math.sin(t * 0.7) * 0.06;
    },
    childSafetySeat,
    standardBelt
  };
}

/* ============================================================
   LOCATION: Park — playground like the reference render
   ============================================================ */
function buildPark() {
  const g = new THREE.Group();
  const colliders = [];

  const ground = new THREE.Mesh(new THREE.CircleGeometry(38, 48), mat(0x7fbf4d, 0.95));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  box(g, 3, 0.04, 70, mat(0xcbb287, 0.9), 0, 0.02, 0, { cast: false });
  box(g, 70, 0.04, 3, mat(0xcbb287, 0.9), 0, 0.02, 8.5, { cast: false });
  box(g, 17, 0.05, 13, mat(0x8fcf5f, 0.95), -0.5, 0.03, -4, { cast: false });

  // sandbox
  box(g, 4, 0.12, 3, mat(0xe3cf9a, 0.95), -6, 0.06, -2, { cast: false });
  for (const [bx, bz, bw, bd] of [[-6, -3.55, 4.3, 0.28], [-6, -0.45, 4.3, 0.28], [-8.05, -2, 0.28, 3.3], [-3.95, -2, 0.28, 3.3]]) {
    box(g, bw, 0.24, bd, mat(0x3f8fd1, 0.7), bx, 0.12, bz);
  }
  solid(colliders, -6, -3.55, 4.3, 0.3);
  solid(colliders, -6, -0.45, 4.3, 0.3);
  solid(colliders, -8.05, -2, 0.3, 3.3);
  solid(colliders, -3.95, -2, 0.3, 3.3);
  cyl(g, 0.14, 0.11, 0.18, mat(0xd9a13b, 0.7), -6.6, 0.2, -1.9);

  // swing set (animated)
  const swingFrame = mat(0x8a8f94, 0.5);
  const swings = [];
  {
    const sx = -2.2, sz = -7;
    cyl(g, 0.07, 0.09, 2.5, swingFrame, sx - 1.3, 1.25, sz);
    cyl(g, 0.07, 0.09, 2.5, swingFrame, sx + 1.3, 1.25, sz);
    cyl(g, 0.06, 0.06, 2.8, swingFrame, sx, 2.45, sz, { rz: Math.PI / 2 });
    for (const off of [-0.6, 0.6]) {
      const sw = new THREE.Group();
      sw.position.set(sx + off, 2.42, sz);
      cyl(sw, 0.015, 0.015, 1.5, mat(0xcbb287, 0.8), -0.2, -0.75, 0);
      cyl(sw, 0.015, 0.015, 1.5, mat(0xcbb287, 0.8), 0.2, -0.75, 0);
      box(sw, 0.5, 0.05, 0.22, mat(0x6b4a2c, 0.7), 0, -1.52, 0);
      g.add(sw);
      swings.push(sw);
    }
    solid(colliders, sx - 1.3, sz, 0.4, 0.4);
    solid(colliders, sx + 1.3, sz, 0.4, 0.4);
  }

  // slide
  {
    const sx = 3.2, sz = -7;
    box(g, 0.9, 0.08, 0.9, mat(0x6b4a2c, 0.8), sx, 1.15, sz);
    for (const [lx, lz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      cyl(g, 0.05, 0.05, 1.15, mat(0x6b4a2c, 0.8), sx + lx, 0.575, sz + lz);
    }
    for (let s = 0; s < 4; s++) {
      box(g, 0.7, 0.06, 0.24, mat(0x8a6a4c, 0.8), sx, 0.25 + s * 0.28, sz - 0.65 - s * 0.22);
    }
    const chute = box(g, 0.8, 0.07, 2.6, mat(0xf2c531, 0.5), sx, 0.62, sz + 1.55, { rx: 0.42 });
    box(g, 0.08, 0.16, 2.6, mat(0xf2c531, 0.5), sx - 0.4, 0.72, sz + 1.55, { rx: 0.42 });
    box(g, 0.08, 0.16, 2.6, mat(0xf2c531, 0.5), sx + 0.4, 0.72, sz + 1.55, { rx: 0.42 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.7, 4), mat(0xd14b3f, 0.7));
    roof.position.set(sx, 2.0, sz);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    solid(colliders, sx, sz, 1.2, 1.2);
    solid(colliders, sx, sz + 1.7, 1.0, 2.4);
  }

  // merry-go-round (rotating)
  const merry = new THREE.Group();
  merry.position.set(0.6, 0, -1.2);
  cyl(merry, 1.25, 1.35, 0.14, mat(0xd14b3f, 0.6), 0, 0.14, 0, { seg: 28 });
  const merryColors = [0xf2c531, 0x64b54e, 0xd14b3f, 0x3f8fd1, 0xe08536, 0x9b59b6];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    box(merry, 0.8, 0.05, 0.55, mat(merryColors[i], 0.6), Math.cos(a) * 0.62, 0.24, Math.sin(a) * 0.62, { ry: -a });
  }
  cyl(merry, 0.05, 0.05, 0.9, mat(0x8a8f94, 0.5), 0, 0.6, 0);
  const merryTop = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 10, 28), mat(0x8a8f94, 0.5));
  merryTop.position.y = 0.85;
  merryTop.rotation.x = Math.PI / 2;
  merry.add(merryTop);
  g.add(merry);
  solid(colliders, 0.6, -1.2, 2.8, 2.8);

  // seesaw (animated)
  const seesawPivot = new THREE.Group();
  seesawPivot.position.set(5.2, 0.32, -2.4);
  const seesaw = box(seesawPivot, 3.2, 0.08, 0.36, mat(0x3f8fd1, 0.6), 0, 0, 0);
  box(seesawPivot, 0.3, 0.1, 0.3, mat(0xd14b3f, 0.6), -1.45, 0.09, 0);
  box(seesawPivot, 0.3, 0.1, 0.3, mat(0xd14b3f, 0.6), 1.45, 0.09, 0);
  g.add(seesawPivot);
  box(g, 0.4, 0.32, 0.4, mat(0x8a8f94, 0.5), 5.2, 0.16, -2.4);
  solid(colliders, 5.2, -2.4, 3.4, 0.6);

  // Kenney nature: picnic tables, benches and mushroom clusters as toadstools
  prop(g, "nature/stump_round", -7.5, 2.8, { s: 2.0 });
  prop(g, "nature/stump_round", -8.2, 1.5, { s: 1.6, ry: 1.1 });
  prop(g, "nature/mushroom_redGroup", 7.8, -3.2, { s: 2.4 });
  prop(g, "nature/mushroom_tanGroup", -8.5, -4.5, { s: 2.2 });
  prop(g, "nature/log", 6.5, 3.8, { s: 2, ry: 0.5 });
  prop(g, "nature/log", 7.2, 4.5, { s: 1.8, ry: -0.3 });
  // Kenney nature: path stones leading to the playground
  const stonePositions = [[-1.5, 4.5], [0, 4.0], [1.5, 4.5], [-0.8, 3.2], [0.8, 3.2]];
  stonePositions.forEach(([px, pz], i) => {
    prop(g, `nature/path_stone`, px, pz, { s: 1.5, ry: rnd(i * 7) * 6.28 });
  });
  // Extra park benches at different spots for realism
  prop(g, "furniture/bench", 8.0, -5.8, { s: 2, ry: -Math.PI / 2 });
  solid(colliders, 8.0, -5.8, 0.8, 2);
  prop(g, "furniture/bench", -8.0, 5.0, { s: 2, ry: Math.PI / 2 });
  solid(colliders, -8.0, 5.0, 0.8, 2);
  // Small potted plants around sandbox
  prop(g, "nature/pot_small", -9.2, -4.0, { s: 2 });
  prop(g, "nature/pot_large", 9.5, 4.0, { s: 2 });
  // fence gate at entrance
  prop(g, "nature/fence_gate", 0, 8.5, { s: 2.5 });
  solid(colliders, 0, 8.5, 2.0, 0.5);
  // real trees, bushes, flowers, rocks, benches (Kenney nature + furniture kits)
  const parkTrees = ["tree_default", "tree_oak", "tree_detailed", "tree_fat", "tree_pineRoundA", "tree_tall", "tree_simple"];
  const treeSpots = [[-12, -9], [-14, 2], [-10, 8], [-4, 12], [4, 13], [11, 9], [14, 1], [12, -7], [6, -12], [-3, -13], [-16, -4], [16, 5]];
  treeSpots.forEach(([tx, tz], i) => {
    prop(g, `nature/${parkTrees[i % parkTrees.length]}`, tx, tz, { s: 2.4 + rnd(i) * 1.3, ry: rnd(i * 3) * 6.28 });
    solid(colliders, tx, tz, 0.7, 0.7);
  });
  const bushTypes = ["plant_bush", "plant_bushDetailed", "plant_bushLarge"];
  for (let i = 0; i < 10; i++) {
    const bx = -15 + rnd(i * 3) * 30;
    const bz = -14 + rnd(i * 5 + 1) * 26;
    // keep bushes off the playground equipment
    if (bx > -10 && bx < 9 && bz > -10 && bz < 2) continue;
    prop(g, `nature/${bushTypes[i % bushTypes.length]}`, bx, bz, { s: 2.5, ry: rnd(i) * 6.28 });
  }
  const flowerTypes = ["flower_redA", "flower_yellowA", "flower_purpleA", "flower_redC", "flower_yellowC"];
  for (let i = 0; i < 16; i++) {
    prop(g, `nature/${flowerTypes[i % flowerTypes.length]}`, -13 + rnd(i * 11) * 26, -12 + rnd(i * 13 + 5) * 24, { s: 2 });
  }
  for (let i = 0; i < 5; i++) {
    prop(g, `nature/rock_small${"ABCDE"[i]}`, -17 + rnd(i * 17) * 34, -13 + rnd(i * 23 + 9) * 26, { s: 2 });
  }
  prop(g, "furniture/bench", 1.8, 7.1, { s: 2, ry: Math.PI });
  solid(colliders, 1.8, 7.1, 1.9, 0.8);
  prop(g, "furniture/bench", -4.5, 7.1, { s: 2, ry: Math.PI });
  solid(colliders, -4.5, 7.1, 1.9, 0.8);
  for (let i = 0; i < 6; i++) {
    prop(g, "nature/fence_simple", -8 + i * 2.5, -10.2, { s: 2.5 });
  }
  {
    const sign = textPanel("SUNNY PARK", 1.7, 0.5, "#2e6b2a", "#fff6dd");
    sign.position.set(-2.2, 1.5, 6.9);
    g.add(sign);
    cyl(g, 0.05, 0.06, 1.3, mat(0x6b4a2c, 0.85), -2.2, 0.65, 6.95);
    solid(colliders, -2.2, 6.95, 0.4, 0.4);
  }

  const sun = new THREE.DirectionalLight(0xfff4da, 2.2);
  sun.position.set(14, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  g.add(sun);

  return {
    group: g,
    colliders,
    bounds: { minX: -24, maxX: 24, minZ: -24, maxZ: 24 },
    spawn: { x: 0, z: 6.2, yaw: 0.1 },
    childAnchor: { x: -0.8, z: 3.2, yaw: 0.1, pose: "stand" },
    canMove: true,
    eye: 1.55,
    env: { bg: 0xa9def2, fog: [0xa9def2, 34, 85], hemi: 0.7, envI: 0.25 },
    tick: (t) => {
      swings[0].rotation.x = Math.sin(t * 1.35) * 0.38;
      swings[1].rotation.x = Math.sin(t * 1.35 + 1.4) * 0.3;
      merry.rotation.y = t * 0.6;
      seesawPivot.rotation.z = Math.sin(t * 1.1) * 0.22;
    },
  };
}

/* ============================================================
   LOCATION: Supermarket — colorful aisles + checkout
   ============================================================ */
function buildMarket() {
  const g = new THREE.Group();
  const colliders = [];

  // Floor + ceiling
  box(g, 26, 0.1, 20, mat(0x66a39b, 0.9), 0, -0.05, 0, { cast: false });
  box(g, 26, 0.1, 20, mat(0xb9bec2, 1), 0, 4.4, 0, { cast: false, receive: false });
  const wallM = mat(0xd9b477, 0.9);
  wall(g, colliders, wallM, 0, -10, 26, 0.2, 4.5);
  wall(g, colliders, wallM, -13, 0, 0.2, 20, 4.5);
  wall(g, colliders, wallM, 13, 0, 0.2, 20, 4.5);

  // Ceiling light strips
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      box(g, 4.5, 0.14, 0.5, glowMat(0xf6f4ec), -7.5 + r * 15, 4.3, -7.5 + c * 5, { cast: false, receive: false });
    }
  }

  // ── shelf builder (gondola) ──────────────────────────────────────────────────
  // foodList omits "carton" and "watermelon" (too big for shelves)
  const shelfFoods = [
    "can", "soda", "loaf", "cheese", "bottle-ketchup",
    "honey", "chocolate", "peanut-butter", "bread", "croissant",
    "cookie", "soda-can", "jam", "muffin", "donut",
  ];

  // Aisle gondola – items on both sides of a central back-panel
  function gondola(cx, cz, len, seed) {
    box(g, len, 0.3, 1.0, mat(0xb5413a, 0.7), cx, 0.15, cz);
    box(g, len, 1.95, 0.14, mat(0x8f9498, 0.6), cx, 1.05, cz);
    for (const side of [-1, 1]) {
      for (let lvl = 0; lvl < 3; lvl++) {
        const y = 0.55 + lvl * 0.5;
        box(g, len, 0.05, 0.44, mat(0x9aa0a4, 0.5), cx, y, cz + side * 0.29, { cast: false });
        const slots = Math.floor(len / 0.65);
        for (let s = 0; s < slots; s++) {
          const idx = seed + lvl * 31 + s * 7 + (side + 1) * 53;
          if (rnd(idx) < 0.18) continue;
          const item = shelfFoods[Math.floor(rnd(idx + 1) * shelfFoods.length)];
          prop(g, `food/${item}`, cx - len / 2 + 0.4 + s * 0.65, cz + side * 0.3, {
            s: 0.95, y: y + 0.04, ry: rnd(idx + 2) * 6.28,
          });
        }
      }
    }
    solid(colliders, cx, cz, len + 0.2, 1.3);
  }

  // Wall shelf builder – items only on the outward-facing side
  // "dir" = "N" | "S" | "E" | "W"  (which wall face items are placed on)
  function wallShelf(cx, cz, len, seed, dir) {
    const isNS = dir === "N" || dir === "S";
    const shelfW = isNS ? len : 0.6;  // extent along X
    const shelfD = isNS ? 0.6 : len;  // extent along Z
    // the side the food faces (toward the store interior)
    const faceZ = dir === "N" ? 0.16 : dir === "S" ? -0.16 : 0;
    const faceX = dir === "E" ? 0.16 : dir === "W" ? -0.16 : 0;

    // Base
    box(g, shelfW, 0.28, shelfD, mat(0xb5413a, 0.7), cx, 0.14, cz);
    // Back panel hugging the wall (opposite the food face)
    if (isNS) box(g, shelfW, 2.0, 0.12, mat(0x8f9498, 0.6), cx, 1.1, cz - faceZ * 1.6);
    else box(g, 0.12, 2.0, shelfD, mat(0x8f9498, 0.6), cx - faceX * 1.6, 1.1, cz);

    for (let lvl = 0; lvl < 4; lvl++) {
      const y = 0.46 + lvl * 0.5;
      box(g, isNS ? shelfW : shelfW - 0.08, 0.05, isNS ? shelfD - 0.08 : shelfD, mat(0x9aa0a4, 0.5), cx, y, cz, { cast: false });
      const slots = Math.floor(len / 0.6);
      for (let s = 0; s < slots; s++) {
        const idx = seed + lvl * 37 + s * 11;
        if (rnd(idx) < 0.15) continue;
        const item = shelfFoods[Math.floor(rnd(idx + 1) * shelfFoods.length)];
        const itemX = isNS ? (cx - len / 2 + 0.35 + s * 0.6) : cx + faceX;
        const itemZ = isNS ? cz + faceZ : (cz - len / 2 + 0.35 + s * 0.6);
        prop(g, `food/${item}`, itemX, itemZ, { s: 0.92, y: y + 0.04, ry: rnd(idx + 2) * 6.28 });
      }
    }
    solid(colliders, cx, cz, shelfW + 0.1, shelfD + 0.1);
  }

  // ── AISLE GONDOLAS (centre of store) ────────────────────────────────────────
  for (const [gx, seedBase] of [[-4.5, 11], [4.5, 77]]) {
    gondola(gx, -6, 7, seedBase);
    gondola(gx, -3, 7, seedBase + 13);
    gondola(gx, 0, 7, seedBase + 29);
  }

  // ── WALL SHELVES (all 4 walls) ───────────────────────────────────────────────
  // North wall (z = -9.5), shelves along full width in 4 segments
  wallShelf(-9,   -9.15, 7,  200, "N");
  wallShelf(-1.5, -9.15, 7,  250, "N");
  wallShelf( 6,   -9.15, 7,  300, "N");

  // South wall (z = +9.5) — behind checkout, keep 3 short shelf banks
  wallShelf(-9,   9.15, 5, 400, "S");
  wallShelf(-1.5, 9.15, 5, 450, "S");
  wallShelf( 6,   9.15, 5, 500, "S");

  // West wall (x = -12.6), vertical run
  wallShelf(-12.25, -6, 6, 600, "E");
  wallShelf(-12.25, -1, 6, 650, "E");
  wallShelf(-12.25,  4, 5, 700, "E");

  // East wall (x = +12.6), vertical run
  wallShelf(12.25, -6, 6, 800, "W");
  wallShelf(12.25, -1, 6, 850, "W");
  wallShelf(12.25,  4, 5, 900, "W");

  // ── WALL COOLERS (north wall, glowing fridges) ────────────────────────────
  // Kept at back wall but raised slightly so produce can live at front
  // (already replaced by wall shelves — removed duplicates)

  // ── PRODUCE LOW DISPLAY TABLE (near entrance, south-east corner) ──────────
  // Low flat table with fruit on top
  box(g, 3.0, 0.7, 1.4, mat(0x6b4a2c, 0.8), 9.5, 0.35, 5.0);
  box(g, 2.8, 0.04, 1.2, mat(0x7d5c36, 0.7), 9.5, 0.72, 5.0, { cast: false });
  solid(colliders, 9.5, 5.0, 3.2, 1.6);
  prop(g, "food/watermelon", 9.0, 4.6, { s: 0.75, y: 0.76 });
  prop(g, "food/pumpkin",    9.8, 4.6, { s: 0.6,  y: 0.76, ry: 0.6 });
  prop(g, "food/apple",      9.3, 5.3, { s: 0.8,  y: 0.76 });
  prop(g, "food/banana",     9.9, 5.3, { s: 0.85, y: 0.76, ry: 0.4 });
  prop(g, "food/grapes",     8.8, 5.0, { s: 0.55, y: 0.76 });
  prop(g, "food/orange",    10.1, 5.0, { s: 0.75, y: 0.76 });

  // ── CHECKOUT LANES ───────────────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const cx = -6 + i * 4;
    box(g, 0.95, 0.95, 2.6, mat(0xb5413a, 0.65), cx, 0.475, 6.4);
    box(g, 0.85, 0.05, 1.6, mat(0x24262b, 0.4), cx, 1.0, 6.1, { cast: false });
    cyl(g, 0.03, 0.03, 1.3, mat(0x8f9498, 0.5), cx + 0.35, 1.65, 7.4);
    const laneSign = textPanel(String(i + 1), 0.42, 0.42, "#b5413a", "#fff6dd");
    laneSign.position.set(cx + 0.35, 2.4, 7.4);
    g.add(laneSign);
    solid(colliders, cx, 6.4, 1.2, 2.9);
    // items on conveyor belt
    prop(g, "food/bread",    cx - 0.2, 5.2, { s: 0.55, ry: 0.3, y: 1.05 });
    prop(g, "food/cheese",   cx + 0.1, 5.5, { s: 0.40, ry: -0.5, y: 1.05 });
    prop(g, "food/soda-can", cx,       5.8, { s: 0.55, y: 1.05 });
    // card reader terminal
    box(g, 0.12, 0.22, 0.08, mat(0x18191e, 0.5), cx + 0.38, 1.48, 6.85);
    box(g, 0.1, 0.01, 0.07, glowMat(0x38bdf8), cx + 0.38, 1.595, 6.85, { cast: false, receive: false });
  }

  // ── ENTRANCE DOUBLE SLIDING DOORS (south wall, z=+10) ───────────────────────
  // The south wall is solid at z=10. We re-place it as two wings flanking the door.
  // Original: wall(g,colliders,wallM, 0,10, 26,0.2, 4.5) — replaced below with gap.
  {
    const wm2 = mat(0xd9b477, 0.9);
    // left wing: x from -13 to -2.5  (width=10.5)
    box(g, 10.5, 4.5, 0.2, wm2, -7.75, 2.25, 10, { cast: true });
    solid(colliders, -7.75, 10, 10.5, 0.3);
    // right wing: x from +2.5 to +13 (width=10.5)
    box(g, 10.5, 4.5, 0.2, wm2,  7.75, 2.25, 10, { cast: true });
    solid(colliders, 7.75, 10, 10.5, 0.3);

    // door frame (header bar + side posts)
    const frameMat = mat(0x607080, 0.55, { metalness: 0.6 });
    box(g, 5.2, 0.22, 0.32, frameMat, 0, 2.72, 10, { cast: false });   // header
    box(g, 0.16, 2.72, 0.32, frameMat, -2.5, 1.36, 10, { cast: false }); // left post
    box(g, 0.16, 2.72, 0.32, frameMat,  2.5, 1.36, 10, { cast: false }); // right post

    // sliding glass door panels (two leaves, each slightly slid open)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xa8cce8, transparent: true, opacity: 0.22,
      roughness: 0.05, metalness: 0.0, transmission: 0.6,
    });
    // left leaf slid left
    const glL = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, 0.04), glassMat);
    glL.position.set(-2.05, 1.25, 9.98);
    g.add(glL);
    // right leaf slid right
    const glR = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.5, 0.04), glassMat);
    glR.position.set(2.05, 1.25, 9.98);
    g.add(glR);

    // glowing "EXIT / ENTER" panel strip above doors
    box(g, 4.8, 0.28, 0.06, glowMat(0x38bdf8), 0, 2.58, 9.88, { cast: false, receive: false });
    {
      const entrySign = textPanel("ENTER / EXIT", 2.4, 0.22, "#0f2030", "#a0e8ff");
      entrySign.position.set(0, 2.6, 9.82);
      g.add(entrySign);
    }

    // rubber door mat on the inside
    prop(g, "furniture/rugDoormat", 0, 8.9, { s: 2.2 });

    // concrete step outside
    box(g, 5.0, 0.14, 1.0, mat(0x8a8f95, 0.85), 0, 0.07, 10.55, { cast: false });
  }

  // ── POTTED PLANTS (entrance doors) ──────────────────────────────────────────
  prop(g, "furniture/pottedPlant", -2.8, 9.6, { s: 2 });
  prop(g, "furniture/pottedPlant",  2.8, 9.6, { s: 2 });

  // ── CARDBOARD STOCK BOXES (back corner) ──────────────────────────────────
  prop(g, "furniture/cardboardBoxClosed", -11.4, -7.6, { s: 2 });
  prop(g, "furniture/cardboardBoxOpen",   -10.7, -8.2, { s: 2, ry: 0.5 });
  solid(colliders, -11, -7.9, 1.6, 1.4);

  // ── SHOPPING CARTS ───────────────────────────────────────────────────────────
  function makecart(wx, wz, wy, seed) {
    const c = new THREE.Group();
    c.position.set(wx, 0, wz);
    c.rotation.y = wy;
    box(c, 0.6, 0.4, 0.9, mat(0x3f8fd1, 0.4, { metalness: 0.4 }), 0, 0.55, 0);
    box(c, 0.55, 0.05, 0.85, mat(0x2c6ea8, 0.5), 0, 0.36, 0);
    cyl(c, 0.02, 0.02, 0.5, mat(0x8f9498, 0.4), 0, 0.9, 0.55, { rz: Math.PI / 2 });
    for (const [ex, ez] of [[-0.24, -0.38], [0.24, -0.38], [-0.24, 0.38], [0.24, 0.38]]) {
      cyl(c, 0.07, 0.07, 0.04, mat(0x24262b, 0.5), ex, 0.07, ez, { rz: Math.PI / 2 });
    }
    if (seed != null) {
      // groceries
      prop(c, "food/watermelon", 0,    0.77,  0,   { s: 0.38 });
      prop(c, "food/banana",     0.15, 0.79,  0.2, { s: 0.7, ry: -0.8 });
      prop(c, "food/can",        0.2,  0.78, -0.3, { s: 0.55 });
      prop(c, "food/bread",     -0.18, 0.78,  0.2, { s: 0.6, ry: 0.5 });
    }
    g.add(c);
    solid(colliders, wx, wz, 1.1, 1.1);
  }
  makecart( 9.8, 7.8, Math.PI, 1);  // loaded cart
  makecart(11.0, 7.8, Math.PI, null); // empty cart

  // ── POTTED PLANTS (entrance doors) ──────────────────────────────────────────
  prop(g, "furniture/pottedPlant", -12.0, 7.5, { s: 2 });
  prop(g, "furniture/pottedPlant",  12.0, 7.5, { s: 2 });

  // ── SIGNS ────────────────────────────────────────────────────────────────────
  const banner = textPanel("DIGI MART", 6, 1.1, "#b5413a", "#fff6dd");
  banner.position.set(0, 3.5, -9.85);
  g.add(banner);
  const aisle1 = textPanel("AISLE 1", 1.8, 0.55, "#e08536", "#ffffff");
  aisle1.position.set(-4.5, 3.2, -4.5);
  g.add(aisle1);
  const aisle2 = textPanel("AISLE 2", 1.8, 0.55, "#e08536", "#ffffff");
  aisle2.position.set(4.5, 3.2, -4.5);
  g.add(aisle2);
  // (SALE 50% sign removed per user request)

  // ── LIGHTS ───────────────────────────────────────────────────────────────────
  for (const [lx, lz] of [[-6, -2], [6, -2], [0, 5], [0, -6], [-6, -7], [6, -7]]) {
    const p = new THREE.PointLight(0xf6f0dc, 1.25, 16, 2);
    p.position.set(lx, 3.9, lz);
    g.add(p);
  }

  return {
    group: g,
    colliders,
    bounds: { minX: -12.4, maxX: 12.4, minZ: -9.4, maxZ: 9.4 },
    spawn: { x: 6.5, z: 8.2, yaw: 0.55 },
    childAnchor: { x: 4.4, z: 5.6, yaw: 0.7, pose: "stand" },
    canMove: true,
    eye: 1.55,
    env: { bg: 0x23302f, fog: [0x23302f, 26, 60], hemi: 1.15, envI: 0.55 },
  };
}


/* ============================================================
   LOCATION: Family party — warm dinner like the reference
   ============================================================ */
function buildParty() {
  const g = new THREE.Group();
  const colliders = [];
  const candles = [];

  box(g, 16, 0.1, 12, mat(0x6e4f33, 0.75), 0, -0.05, 0, { cast: false });
  box(g, 16, 0.1, 12, mat(0xd8c6ae, 1), 0, 3.42, 0, { cast: false, receive: false });
  const warmWall = mat(0xc09a6d, 0.9);
  wall(g, colliders, warmWall, 0, -6, 16, 0.2, 3.4);
  // south wall: two segments flanking a 1.8-wide door gap at x=0
  box(g, 7.1, 3.4, 0.2, warmWall, -4.55, 1.7, 6, { cast: true });
  solid(colliders, -4.55, 6, 7.1, 0.3);
  box(g, 7.1, 3.4, 0.2, warmWall,  4.55, 1.7, 6, { cast: true });
  solid(colliders, 4.55, 6, 7.1, 0.3);
  wall(g, colliders, warmWall, -8, 0, 0.2, 12, 3.4);
  wall(g, colliders, warmWall, 8, 0, 0.2, 12, 3.4);

  // ── PARTY ENTRANCE DOOR (south wall, z=6) ───────────────────────────────────
  {
    const frameMat = mat(0xb98b5d, 0.7);
    // door frame
    box(g, 0.14, 2.35, 0.28, frameMat, -0.88, 1.175, 6, { cast: false });
    box(g, 0.14, 2.35, 0.28, frameMat,  0.88, 1.175, 6, { cast: false });
    box(g, 1.88, 0.18, 0.28, frameMat,  0,    2.38,  6, { cast: false });
    // filler above door frame to ceiling
    box(g, 1.76, 1.02, 0.22, warmWall, 0, 2.89, 6, { cast: false });
    // door leaf (hinged left, slightly open inward)
    const hinge = new THREE.Group();
    hinge.position.set(-0.80, 0, 5.9);
    hinge.rotation.y = -0.65;        // ~37° open inward
    g.add(hinge);
    const leafW = 1.6;
    box(hinge, leafW, 2.2, 0.06, mat(0x7a3820, 0.75), leafW / 2, 1.1, 0);
    // door knob
    sph(hinge, 0.052, mat(0xd4a03a, 0.3, { metalness: 0.5 }), leafW - 0.14, 1.1, 0.06, { w: 12, h: 8 });
    // small doorbell / intercom panel
    box(g, 0.09, 0.14, 0.06, mat(0x1a1a1f, 0.5), 1.06, 1.25, 5.84, { cast: false });
    sph(g, 0.035, glowMat(0x80ff80), 1.06, 1.12, 5.82, { cast: false });
    // welcome mat
    prop(g, "furniture/rugDoormat", 0, 4.65, { s: 1.8 });
    // short step
    box(g, 2.2, 0.1, 0.7, mat(0x9e8070, 0.85), 0, 0.05, 6.45, { cast: false });
  }

  // window with night sky + curtains + banner
  box(g, 2.6, 1.7, 0.06, glowMat(0x1d2c4d), 0, 1.9, -5.88, { cast: false, receive: false });
  box(g, 0.5, 2.2, 0.14, mat(0x9d3b34, 0.85), -1.65, 1.75, -5.82);
  box(g, 0.5, 2.2, 0.14, mat(0x9d3b34, 0.85), 1.65, 1.75, -5.82);
  const banner = textPanel("HAPPY FAMILY DAY", 4.6, 0.6, "#9d3b34", "#ffe9b8");
  banner.position.set(0, 3.05, -5.86);
  g.add(banner);

  // dining table: two cloth tables in a row (Kenney furniture kit)
  prop(g, "furniture/tableCloth", -1.09, -0.5, { s: 2.6 });
  prop(g, "furniture/tableCloth", 1.09, -0.5, { s: 2.6 });
  solid(colliders, 0, -0.5, 4.7, 1.7);

  const plateSpots = [[-1.5, -0.95], [0, -0.95], [1.5, -0.95], [-1.5, -0.08], [0, -0.08], [1.5, -0.08]];
  for (const [px, pz] of plateSpots) {
    prop(g, "food/plate-dinner", px, pz, { s: 0.34, y: 0.858 });
    prop(g, "food/glass-wine", px + 0.34, pz + 0.14, { s: 0.42, y: 0.858 });
  }
  // holiday feast (offset so it doesn't hide Mira)
  prop(g, "food/plate-rectangle", -0.75, -0.5, { s: 0.72, y: 0.858 });
  prop(g, "food/turkey", -0.75, -0.5, { s: 0.62, y: 0.878 });
  prop(g, "food/pie", 0.8, -0.42, { s: 0.52, y: 0.858 });
  prop(g, "food/cake-birthday", -1.9, -0.5, { s: 0.5, y: 0.858 });
  prop(g, "food/loaf-baguette", 1.95, -0.55, { s: 0.45, y: 0.858, ry: 0.6 });
  prop(g, "food/wine-red", 0.38, -0.75, { s: 0.45, y: 0.858 });
  prop(g, "holiday/gingerbread-man", -0.3, -0.88, { s: 0.55, y: 0.858, ry: 0.4 });

  // (booster seat deleted)
  // Kid play area: legos, toys and kids running around
  prop(g, "holiday/present-a-cube", 3.5, 3.8, { s: 0.7, ry: 0.4 });
  prop(g, "holiday/present-b-rectangle", 4.2, 3.2, { s: 0.65, ry: 1.1 });
  prop(g, "holiday/present-a-round", 2.8, 4.0, { s: 0.6, ry: 2.3 });
  prop(g, "furniture/rugRound", -3.8, 2.5, { s: 2.2 });
  prop(g, "furniture/pillow", -4.5, 2.2, { s: 1.4, ry: 0.7 });
  prop(g, "furniture/pillow", -3.2, 3.1, { s: 1.4, ry: -0.4 });
  // toy cars strewn on the rug where kids are playing
  prop(g, "car/kart-oopi", -4.0, 2.8, { s: 0.15, ry: Math.PI * 0.3 });
  prop(g, "car/kart-oozi", -3.5, 2.2, { s: 0.14, ry: -0.8 });
  prop(g, "car/kart-oobi", -4.5, 3.0, { s: 0.13, ry: 1.5 });

  // candles with flickering flames
  for (const cx of [-1.7, 0.55, 1.9]) {
    cyl(g, 0.045, 0.05, 0.3, mat(0xf4ecd8, 0.6), cx, 0.99, -0.4, { cast: false });
    const flame = sph(g, 0.045, glowMat(0xffb84d), cx, 1.19, -0.4, { cast: false });
    const light = new THREE.PointLight(0xff9d3d, 0.9, 4.5, 2);
    light.position.set(cx, 1.35, -0.4);
    g.add(light);
    candles.push({ flame, light, phase: cx * 3.1 });
  }

  // chairs (real cushioned chair models)
  function chair(x, z, ry) {
    prop(g, "furniture/chairCushion", x, z, { s: 2, ry });
    solid(colliders, x, z, 0.55, 0.55);
  }
  chair(-1.5, -1.75, 0);
  chair(0, -1.75, 0);
  chair(1.5, -1.75, 0);
  chair(-1.5, 0.75, Math.PI);
  chair(1.5, 0.75, Math.PI);
  chair(2.85, -0.5, -Math.PI / 2);
  chair(-2.85, -0.5, Math.PI / 2);

  // family, seated — real VRoid characters (the user's adult/teen models)
  familyMember(g, "mira-15", -1.5, -1.75, 0, 0.50, "sit");
  familyMember(g, "mira-13", 1.5, -1.75, 0, 0.50, "sit");
  familyMember(g, "mira-11", 2.85, -0.5, -Math.PI / 2, 0.50, "sit");
  familyMember(g, "mira-08", -1.5, 0.75, Math.PI, 0.50, "sit");
  
  // Occupy remaining empty chairs at the table
  familyMember(g, "mira-09", 1.5, 0.75, Math.PI, 0.50, "sit");
  familyMember(g, "mira-06", -2.85, -0.5, Math.PI / 2, 0.50, "sit");

  // Standing groups chatting around the room to make it crowded
  // Group A (Left side - talking near the holiday tree and presents)
  familyMember(g, "mira-14", -5.4, -2.2, 1.0, 0, "stand");
  familyMember(g, "mira-04", -4.5, -3.2, -1.2, 0, "stand");
  familyMember(g, "mira-12", -5.8, -3.4, 0.2, 0, "stand");

  // Group B (Right side - talking in the corner near sideboard)
  familyMember(g, "mira-10", 5.6, 1.8, -2.0, 0, "stand");
  familyMember(g, "mira-03", 4.8, 2.8, 0.5, 0, "stand");
  familyMember(g, "mira-07", 6.0, 3.2, -0.8, 0, "stand");

  // Group C (Left-Front - standing near the table and couch)
  familyMember(g, "mira-15", -3.2, 2.2, -0.5, 0, "stand");
  familyMember(g, "mira-13", -2.4, 2.8, 2.2, 0, "stand");
  familyMember(g, "mira-11", -3.8, 3.4, -1.0, 0, "stand");

  // Group D (Center-Back - standing near the entrance/doorway)
  familyMember(g, "mira-08", -1.2, 4.8, -3.0, 0, "stand");
  familyMember(g, "mira-09", 1.2, 4.8, 3.0, 0, "stand");

  // Group E (Right-Back - standing near the bookcase/wall)
  familyMember(g, "mira-15", 3.8, -2.8, 1.5, 0, "stand");
  familyMember(g, "mira-11", 3.2, -3.8, -2.5, 0, "stand");
  familyMember(g, "mira-06", 4.6, -3.2, 0.2, 0, "stand");

  // decorated tree with presents (Kenney holiday kit)
  {
    const tx = -6.6, tz = -4.4;
    prop(g, "holiday/tree-decorated", tx, tz, { s: 1.15 });
    const treeLight = new THREE.PointLight(0xffc177, 0.9, 5, 2);
    treeLight.position.set(tx, 1.6, tz);
    g.add(treeLight);
    prop(g, "holiday/present-a-cube", tx + 0.95, tz + 0.85, { s: 0.7, ry: 0.4 });
    prop(g, "holiday/present-b-round", tx + 0.25, tz + 1.25, { s: 0.6, ry: 1.2 });
    prop(g, "holiday/present-b-rectangle", tx + 1.3, tz + 0.1, { s: 0.65, ry: 2.1 });
    prop(g, "holiday/candy-cane-red", tx + 1.7, tz + 1.0, { s: 0.9 });
    solid(colliders, tx, tz, 1.9, 1.9);
  }

  // sideboard with bottle + bowl
  box(g, 0.55, 0.85, 2.4, mat(0x5e3d22, 0.8), -7.55, 0.425, 1.6);
  cyl(g, 0.06, 0.075, 0.4, mat(0x2e5230, 0.4), -7.5, 1.05, 1.1);
  cyl(g, 0.18, 0.12, 0.12, mat(0xd9a13b, 0.6), -7.5, 0.91, 2.1);
  solid(colliders, -7.55, 1.6, 0.75, 2.6);

  // fairy lights along two walls
  for (let i = 0; i < 14; i++) {
    const lx = -7 + i * 1.0;
    sph(g, 0.035, glowMat(i % 2 ? 0xffd9a0 : 0xffb84d), lx, 2.75 + Math.sin(i * 1.3) * 0.12, -5.85, { cast: false });
  }
  for (let i = 0; i < 10; i++) {
    const lz = -5 + i * 1.0;
    sph(g, 0.035, glowMat(i % 2 ? 0xffd9a0 : 0xffb84d), 7.85, 2.75 + Math.sin(i * 1.7) * 0.12, lz, { cast: false });
  }

  // chandelier
  cyl(g, 0.02, 0.02, 0.5, mat(0x24262b, 0.5), 0, 3.2, -0.5);
  cyl(g, 0.3, 0.42, 0.25, glowMat(0xffe3ad), 0, 2.85, -0.5, { cast: false });
  const mainLight = new THREE.PointLight(0xffc177, 2.2, 13, 2);
  mainLight.position.set(0, 2.7, -0.5);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(1024, 1024);
  g.add(mainLight);

  return {
    group: g,
    colliders,
    bounds: { minX: -7.6, maxX: 7.6, minZ: -5.6, maxZ: 5.6 },
    spawn: { x: 0, z: 4.3, yaw: 0 },
    childAnchor: { x: -3.8, z: 2.5, yaw: 1.2, pose: "stand" },
    canMove: true,
    eye: 1.55,
    env: { bg: 0x170f0a, fog: [0x170f0a, 12, 30], hemi: 0.55, envI: 0.3 },
    tick: (t) => {
      for (const c of candles) {
        const f = 0.85 + Math.sin(t * 11 + c.phase) * 0.12 + Math.sin(t * 23 + c.phase * 2) * 0.06;
        c.light.intensity = f;
        c.flame.scale.setScalar(0.85 + f * 0.25);
      }
    }
  };
}

/* ============================================================
   Location registry + switching
   ============================================================ */
const locationDefs = {
  home: { label: "Home", icon: "🏡", build: buildHome },
  car: { label: "Car Ride", icon: "🚗", build: buildCar },
  park: { label: "Park", icon: "🌳", build: buildPark },
  market: { label: "Supermarket", icon: "🛒", build: buildMarket },
  party: { label: "Family Party", icon: "🎉", build: buildParty },
};
const locationOrder = ["home", "car", "park", "market", "party"];

const arrivalLines = {
  home: {
    "Age 5-7": "We're home! Can we read the book on my little table? You promised-ish.",
    "Age 10-12": "Home is good. Later can I show you the thing I built in my room?",
    "Age 14-16": "Home. Fine. Can we talk without it turning into a lecture this time?",
  },
  car: {
    "Age 5-7": "I like the car! Where are we going? Can I count the trees? One... two...",
    "Age 10-12": "Car rides are when you actually talk to me. So... can I ask you something?",
    "Age 14-16": "You always pick the car for serious talks. I'm watching the road. Go ahead.",
  },
  park: {
    "Age 5-7": "THE PARK! Watch me on the swings! Are you watching? You have to watch!",
    "Age 10-12": "The park's okay. Push me higher than last time and I'll tell you about school.",
    "Age 14-16": "I'm a bit old for the slide, but... walking here with you is alright, actually.",
  },
  market: {
    "Age 5-7": "So many colors! Can we get the cookies? The ones in the yellow box? Please?",
    "Age 10-12": "If I calculate the discount right on the sale sign, can we buy it?",
    "Age 14-16": "Give me half the list. I can handle my own aisle, you know.",
  },
  party: {
    "Age 5-7": "Everyone's here! Do I have to hug grandma first or can I eat first?",
    "Age 10-12": "Family party... Stay close, okay? They always ask me weird questions.",
    "Age 14-16": "I'll be polite. But if they ask about my grades, you're rescuing me. Deal?",
  },
};

const built = {};
let current = null;
let currentId = null;

function setLocation(id) {
  if (id === currentId || !locationDefs[id]) return;
  if (!built[id]) built[id] = locationDefs[id].build();
  if (current) scene.remove(current.group);
  
  clearChildAttachedProp();

  // Clear any active family member models and toggle background sounds
  familyMembers = [];
  playPartySound(id === "party");

  current = built[id];
  currentId = id;
  state.location = id;
  scene.add(current.group);

  // environment
  scene.background = new THREE.Color(current.env.bg);
  const [fc, fn, ff] = current.env.fog;
  scene.fog = new THREE.Fog(fc, fn, ff);
  hemi.intensity = current.env.hemi;
  scene.environmentIntensity = current.env.envI ?? 0.5;

  // player
  player.x = current.spawn.x;
  player.z = current.spawn.z;
  player.yaw = current.spawn.yaw;
  player.pitch = 0;
  player.bobAmp = 0;

  // child placement + aim the parent's gaze down at her face
  placeChild();
  if (current.aimAtChild !== false) {
    const a = current.childAnchor;
    const headY = child.position.y + vrmHeight * 0.92;
    const dist = Math.max(0.6, Math.hypot(a.x - current.spawn.x, a.z - current.spawn.z));
    player.pitch = THREE.MathUtils.clamp(Math.atan2(headY - current.eye, dist) * 0.85, -0.6, 0.3);
  }

  const debugView = queryParams.get("view");
  if (id === "home" && debugView === "bathroom") {
    player.x = 2.05;
    player.z = 2.2;
    player.yaw = -2.05;
    player.pitch = -0.04;
  } else if (id === "home" && debugView === "bedroom") {
    player.x = 2.55;
    player.z = -2.15;
    player.yaw = -0.75;
    player.pitch = -0.08;
  } else if (id === "car" && debugView === "car") {
    current.eye = 2.32;
    player.x = 0.0;
    player.z = 0.42;
    player.yaw = 0.0;
    player.pitch = -0.82;
  } else if (id === "car") {
    player.pitch = -0.22;
  }

  // child reacts to the new place
  state.childLine = arrivalLines[id][state.band];
  input.placeholder = `Speak to Mira — ${locationDefs[id].label}...`;
  resetParentIdle();

  for (const btn of locationBar.querySelectorAll("button")) {
    btn.classList.toggle("is-active", btn.dataset.loc === id);
  }
  updateHint();
  syncUi();
}

function buildLocationBar() {
  locationOrder.forEach((id, i) => {
    const def = locationDefs[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.loc = id;
    btn.innerHTML = `${def.icon} ${def.label} <small>${i + 1}</small>`;
    btn.addEventListener("click", () => setLocation(id));
    locationBar.append(btn);
  });
}

/* ============================================================
   First-person controls (pointer lock + WASD)
   ============================================================ */
const keys = new Set();

canvas.addEventListener("click", () => {
  if (sessionRole === "clinician" || sessionRole === "landing") return; // No pointer lock in dashboard/landing
  ensureAudio(); // unlock audio playback on first user gesture
  if (currentId === "party") playPartySound(true);
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  document.body.classList.toggle("is-locked", document.pointerLockElement === canvas);
  updateHint();
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0023;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0023, -1.25, 1.25);
});

window.addEventListener("keydown", (e) => {
  if (sessionRole === "clinician" || sessionRole === "landing") return; // No keyboard controls in dashboard/landing
  if (e.target === input) return;
  if (/^Digit[1-5]$/.test(e.code)) {
    setLocation(locationOrder[Number(e.code.slice(5)) - 1]);
    return;
  }
  if (e.code === "Enter") {
    if (document.pointerLockElement) document.exitPointerLock();
    input.focus();
    e.preventDefault();
    return;
  }
  if (e.code.startsWith("Arrow")) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => {
  if (sessionRole === "clinician" || sessionRole === "landing") return;
  keys.delete(e.code);
});

function updateHint() {
  const locked = document.pointerLockElement === canvas;
  if (!locked) {
    lockHint.textContent = "🖱 Click the world to explore · WASD walk · mouse look · 1-5 travel · Enter to talk";
  } else if (current && !current.canMove) {
    lockHint.textContent = "You're riding — look around with the mouse · Enter to talk · Esc to release";
  } else {
    lockHint.textContent = "WASD to walk · Shift to hurry · Enter to talk to Mira · Esc to release";
  }
}

function hits(x, z) {
  const r = player.radius;
  for (const c of current.colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
  }
  return false;
}

function updateMovement(dt) {
  if (!current) return;

  // Smooth LERP camera glide if a target is set
  if (player.targetX !== undefined) {
    player.x += (player.targetX - player.x) * Math.min(1, dt * 3.5);
    player.z += (player.targetZ - player.z) * Math.min(1, dt * 3.5);
    let diff = player.targetYaw - player.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.yaw += diff * Math.min(1, dt * 3.5);
    
    if (Math.hypot(player.targetX - player.x, player.targetZ - player.z) < 0.05 && Math.abs(diff) < 0.05) {
      player.x = player.targetX;
      player.z = player.targetZ;
      player.yaw = player.targetYaw;
      player.targetX = undefined;
    }
  }

  let moving = false;
  if (current.canMove && document.activeElement !== input) {
    const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    if (f || s) {
      moving = true;
      player.targetX = undefined; // Cancel active transition if user inputs movement
      const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4.6 : 2.9;
      const norm = Math.hypot(f, s);
      const fwdX = -Math.sin(player.yaw) * (f / norm);
      const fwdZ = -Math.cos(player.yaw) * (f / norm);
      const rightX = Math.cos(player.yaw) * (s / norm);
      const rightZ = -Math.sin(player.yaw) * (s / norm);
      const vx = (fwdX + rightX) * speed * dt;
      const vz = (fwdZ + rightZ) * speed * dt;
      const nx = player.x + vx;
      if (!hits(nx, player.z)) player.x = nx;
      const nz = player.z + vz;
      if (!hits(player.x, nz)) player.z = nz;
      const b = current.bounds;
      player.x = THREE.MathUtils.clamp(player.x, b.minX, b.maxX);
      player.z = THREE.MathUtils.clamp(player.z, b.minZ, b.maxZ);
      player.bobPhase += dt * (speed > 3 ? 11 : 8.2);
    }
  }
  player.bobAmp += ((moving ? 1 : 0) - player.bobAmp) * Math.min(1, dt * 8);
}

/* ============================================================
   UI: stats, mood, insight, timeline
   ============================================================ */
function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function renderStats() {
  statsEl.innerHTML = "";
  for (const [key, label, color] of statConfig) {
    const row = document.createElement("div");
    row.className = "stat";
    row.innerHTML = `
      <span>${label}</span>
      <div class="bar"><span style="width:${state.values[key]}%; background:${color}"></span></div>
      <strong>${state.values[key]}</strong>
    `;
    statsEl.append(row);
  }
}

function syncUi() {
  const progress = Math.min(100, (state.age / 18) * 100);
  stageTitle.textContent = `Year ${String(state.age).padStart(2, "0")}`;
  dayLabel.textContent = `Day ${state.day} of 21`;
  ageBand.textContent = state.band;
  moodEl.textContent = state.mood;
  childText.textContent = state.childLine;
  timelineFill.style.width = `${progress}%`;
  timelineMarker.style.left = `${progress}%`;
  renderStats();
  updateChildLook();
}

function updateChildLook() {
  const trust = state.values.trust;
  const volatility = state.values.volatility;
  const security = state.values.security;
  exprHappy = trust > 70 ? 0.85 : trust > 55 ? 0.3 : 0.1;
  exprSad = volatility > 55 ? 0.45 : 0;
  exprAngry = volatility > 70 ? 0.35 : 0;
  childLight.intensity = security > 65 ? 0.6 : 0.3;
  loadMira(miraStage());
}

/* ============================================================
   Conversation + mock Parent Governor
   ============================================================ */
form.addEventListener("submit", handleSubmit);
document.querySelector("#milestoneBtn").addEventListener("click", () => openInsight("Milestone Check", milestoneText()));
document.querySelector("#reportBtn").addEventListener("click", () => openInsight("Architect Report", architectText()));
document.querySelector("#ageBtn").addEventListener("click", ageUp);
document.querySelector("#closeInsight").addEventListener("click", () => insightPanel.classList.remove("is-open"));

let childAttachedProp = null;

function clearChildAttachedProp() {
  if (childAttachedProp) {
    if (childAttachedProp.parent) {
      childAttachedProp.parent.remove(childAttachedProp);
    }
    childAttachedProp = null;
  }
}

function createSingleBook(coverColor = 0x2e6cb5) {
  const bookGroup = new THREE.Group();
  bookGroup.name = "singleBook";
  
  // 1. Pages (off-white)
  const pagesMat = mat(0xfcfaf2, 0.9, { roughness: 0.8 });
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.026, 0.09), pagesMat);
  pages.position.set(0, 0, 0);
  pages.castShadow = true;
  pages.receiveShadow = true;
  bookGroup.add(pages);
  
  // 2. Cover spine (wrapped around pages)
  const coverMat = mat(coverColor, 0.55, { roughness: 0.4 });
  const coverBack = new THREE.Mesh(new THREE.BoxGeometry(0.126, 0.002, 0.096), coverMat);
  coverBack.position.set(0, -0.014, 0.001);
  coverBack.castShadow = true;
  bookGroup.add(coverBack);

  const coverFront = new THREE.Mesh(new THREE.BoxGeometry(0.126, 0.002, 0.096), coverMat);
  coverFront.position.set(0, 0.014, 0.001);
  coverFront.castShadow = true;
  bookGroup.add(coverFront);

  const coverSpine = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.096), coverMat);
  coverSpine.position.set(-0.062, 0, 0.001);
  coverSpine.castShadow = true;
  bookGroup.add(coverSpine);
  
  // 3. Emblem / Cover design
  const emblemMat = glowMat(0xf5d061);
  const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.001, 0.04), emblemMat);
  emblem.position.set(0.01, 0.015, 0);
  bookGroup.add(emblem);
  
  return bookGroup;
}

function attachPropToChild(path, opts = {}) {
  clearChildAttachedProp();
  
  const onModelReady = (m) => {
    // Determine attachment target
    let target = child;
    let localPos = new THREE.Vector3(0, 0.45 * vrmHeight, 0.25); // default in front of child
    let localRot = new THREE.Euler(0, 0, 0);
    let scaleScalar = opts.s || 1.0;
    
    if (vrm) {
      // Try to attach to rightHand or leftHand
      const hand = vrm.humanoid.getNormalizedBoneNode(opts.bone || "rightHand");
      if (hand) {
        target = hand;
        localPos.set(0.03, 0.01, 0.04); // Default offset from wrist (rightHand bone) into the palm/fingers
        localRot.set(0, 0, 0);
        
        // Adjust default offsets depending on model
        const lowerPath = path.toLowerCase();
        if (lowerPath.includes("book")) {
          // Single book fits nicely inside fingers/palm without floating
          localPos.set(0.015, -0.012, 0.035);
          localRot.set(Math.PI / 2, 0, -Math.PI / 6);
          scaleScalar *= 0.95;
        } else if (lowerPath.includes("toy") || lowerPath.includes("kart")) {
          localPos.set(0.04, 0.02, 0.04);
          localRot.set(0, 0, 0);
          scaleScalar *= 0.12;
        } else if (lowerPath.includes("cookie") || lowerPath.includes("lollypop") || lowerPath.includes("banana") || lowerPath.includes("apple")) {
          localPos.set(0.02, 0.02, 0.04);
          scaleScalar *= 0.45;
        }
      }
    }
    
    m.position.copy(localPos);
    m.rotation.copy(localRot);
    m.scale.setScalar(scaleScalar);
    
    target.add(m);
    childAttachedProp = m;
  };

  if (path === "single_book") {
    const m = createSingleBook(opts.color || 0x2e6cb5);
    onModelReady(m);
  } else {
    loadModel(path).then((proto) => {
      const m = proto.clone(true);
      onModelReady(m);
    }).catch((e) => console.warn("Failed to attach prop", e));
  }
}

/* ============================================================
   LLM-driven embodiment: the backend returns a structured action
   (type / prop / spot) chosen by Claude to match whatever the
   conversation describes -- this executor makes Mira actually do it.
   ============================================================ */
const ACTION_SPOTS = {
  home: {
    play_corner:   { x: -2.35, z: 1.15, yaw: -0.7, pose: "sit" },
    kitchen_table: { x: -3.0, z: -3.1, yaw: -Math.PI * 0.5, pose: "sit" },
    bathroom:      { x: 2.48, z: 5.43, yaw: Math.PI, pose: "stand" },
    bedroom:       { x: 5.0, z: -4.2, yaw: Math.PI / 2, pose: "stand" },
    sofa:          { x: -6.0, z: 4.5, seat: 0.45, yaw: Math.PI / 2, pose: "sit" },
  },
  park: {
    swings:  { x: 2.5, z: -2.0, seat: 0.6, yaw: 0, pose: "sit" },
    slide:   { x: -2.5, z: -2.0, yaw: 0, pose: "stand" },
    sandbox: { x: 0, z: 1.5, seat: 0.2, yaw: 0, pose: "sit" },
  },
  market: {
    checkout:    { x: -0.8, z: 2.0, yaw: 0, pose: "stand" },
    snack_shelf: { x: 1.5, z: -0.5, yaw: Math.PI, pose: "stand" },
  },
  party: {
    buffet:      { x: -1.0, z: -1.5, yaw: 0, pose: "stand" },
    couch:       { x: 0, z: -2.5, seat: 0.5, yaw: 0, pose: "sit" },
    kids_corner: { x: -4.0, z: 2.5, yaw: 0.5, pose: "sit" },
  },
};
const ACTION_PROPS = {
  book:     ["single_book", { bone: "rightHand", s: 1.0 }],
  toy_car:  ["car/kart-oopi", { bone: "rightHand", s: 1.0 }],
  cookie:   ["food/cookie", { bone: "rightHand", s: 1.2 }],
  lollypop: ["food/lollypop", { bone: "rightHand", s: 1.2 }],
  apple:    ["food/apple", { bone: "rightHand", s: 1.2 }],
  banana:   ["food/banana", { bone: "rightHand", s: 1.2 }],
};

// She grabs a toy block and hurls it at the parent -- an age-appropriate
// protest when she feels dismissed or ignored. It arcs toward the camera,
// bonks, and shakes the view for a beat.
function childThrowProp() {
  const colors = [0xd98632, 0x178f86, 0xb54135, 0x245b95];
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.09, 0.09),
    new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.55 })
  );
  const start = new THREE.Vector3(child.position.x, child.position.y + vrmHeight * 0.55, child.position.z);
  const target = camWorld.clone();
  target.y -= 0.12; // lands just below the parent's eyes
  m.position.copy(start);
  scene.add(m);
  flyingProps.push({ mesh: m, start, target, t0: clock.getElapsedTime(), dur: 0.55 });
}

function performChildAction(action) {
  if (!action || !action.type || action.type === "none") return false;
  const type = action.type;
  const loc = state.location;
  const inCar = currentId === "car";
  let handled = false;

  // 1) hands: pick up / put down (she can hold something AND move)
  if (action.prop && action.prop !== "none" && ACTION_PROPS[action.prop]) {
    const [p, o] = ACTION_PROPS[action.prop];
    attachPropToChild(p, { ...o });
    handled = true;
  }
  if (type === "drop_prop") {
    clearChildAttachedProp();
    handled = true;
  }

  // 2) feet: destinations and poses (never while buckled into the car seat)
  const spots = ACTION_SPOTS[loc] || {};
  if (!inCar) {
    if (action.spot && action.spot !== "none" && spots[action.spot]) {
      current.childAnchor = { ...spots[action.spot] };
      if (type === "sit") current.childAnchor.pose = "sit";
      placeChild();
      handled = true;
    } else if (type === "come_to_parent") {
      clearActivePlayPoint();
      setChildPose("stand");
      const dx = camWorld.x - childWorld.x, dz = camWorld.z - childWorld.z;
      const d = Math.hypot(dx, dz) || 0.1;
      childTarget.x = camWorld.x - (dx / d) * 1.15;
      childTarget.z = camWorld.z - (dz / d) * 1.15;
      handled = true;
    } else if (type === "sit") {
      // sit down right where she is
      current.childAnchor = { x: childWorld.x, z: childWorld.z, yaw: child.rotation.y, pose: "sit" };
      placeChild();
      handled = true;
    } else if (type === "stand") {
      setChildPose("stand");
      handled = true;
    } else if (type === "run_play") {
      setChildPose("stand");
      clearActivePlayPoint();
      childTarget.x = childWorld.x + (Math.random() - 0.5) * 4;
      childTarget.z = childWorld.z + (Math.random() - 0.5) * 4;
      handled = true;
    }
  }

  // 3) whole-body timed gestures
  const t = clock ? clock.getElapsedTime() : 0;
  if (type === "wave") {
    waveUntil = t + 4.0;
    handled = true;
  } else if (type === "jump" || type === "dance" || type === "spin" || type === "hide" || type === "clap"
      || type === "throw_toy" || type === "tantrum") {
    const gesture = type === "throw_toy" ? "throw" : type;
    const seated = type === "clap" || (inCar && gesture === "throw"); // she can throw a toy from her car seat
    if (!inCar && childPose !== "stand" && !seated) setChildPose("stand"); // get off the seat first
    actionType = gesture;
    actionUntil = t + (type === "hide" ? 6.0 : type === "tantrum" ? 4.2 : gesture === "throw" ? 1.15 : 4.5);
    if (gesture === "throw") {
      throwLaunchAt = t + 0.42; // release mid arm-swing
      throwDone = false;
    } else if (type === "tantrum") {
      triggerReaction("scream"); // scream + angry face + sound
    } else if (type !== "hide") {
      smileSpikeUntil = t + 4.0;
    }
    handled = true;
  }
  return handled;
}

function handleDynamicChatActions(userMsg, childMsg) {
  const combined = (userMsg + " " + childMsg).toLowerCase();
  
  if (state.location === "home") {
    // 1. Reading / Books
    if (combined.includes("book") || combined.includes("story") || combined.includes("read") || combined.includes("bunny")) {
      attachPropToChild("single_book", { bone: "rightHand", s: 1.0 });
      
      // Move to play corner/rug and sit down
      current.childAnchor = { x: -2.35, z: 1.15, yaw: -0.7, pose: "sit" };
      player.targetX = -2.0;
      player.targetZ = 1.8;
      player.targetYaw = 0.5;
      placeChild();
      return;
    }
    
    // 2. Lego blocks / Building a tower
    if (combined.includes("lego") || combined.includes("block") || combined.includes("tower") || combined.includes("build")) {
      attachPropToChild("car/kart-oopi", { bone: "rightHand", s: 1.0 }); // oopi cart as toy car
      current.childAnchor = { x: -2.35, z: 1.15, yaw: -0.7, pose: "sit" };
      player.targetX = -2.0;
      player.targetZ = 1.8;
      player.targetYaw = 0.5;
      placeChild();
      return;
    }
    
    // 3. Eating / Cookies / Snacks
    if (combined.includes("cookie") || combined.includes("eat") || combined.includes("food") || combined.includes("snack") || combined.includes("lollypop") || combined.includes("lollipop") || combined.includes("apple") || combined.includes("banana")) {
      const propName = (combined.includes("lollypop") || combined.includes("lollipop")) ? "food/lollypop" : 
                       (combined.includes("banana")) ? "food/banana" :
                       (combined.includes("apple")) ? "food/apple" : "food/cookie";
      attachPropToChild(propName, { bone: "rightHand", s: 1.2 });
      
      // If kitchen or table is mentioned, move to kitchen table, else play corner
      if (combined.includes("kitchen") || combined.includes("table") || combined.includes("dining")) {
        current.childAnchor = { x: -3.0, z: -3.1, yaw: -Math.PI * 0.5, pose: "sit" };
        player.targetX = -2.05;
        player.targetZ = -3.1;
        player.targetYaw = -Math.PI * 0.5;
      } else {
        current.childAnchor = { x: -2.35, z: 1.15, yaw: -0.7, pose: "sit" };
        player.targetX = -2.0;
        player.targetZ = 1.8;
        player.targetYaw = 0.5;
      }
      placeChild();
      return;
    }
    
    // 4. Brushing teeth / Washing / Bathroom
    if (combined.includes("brush") || combined.includes("teeth") || combined.includes("wash") || combined.includes("bathroom") || combined.includes("sink") || combined.includes("toilet")) {
      current.childAnchor = { x: 2.48, z: 5.43, yaw: Math.PI, pose: "stand" };
      player.targetX = 2.48;
      player.targetZ = 4.2;
      player.targetYaw = 0;
      placeChild();
      return;
    }
  } else if (state.location === "park") {
    // swings
    if (combined.includes("swing")) {
      current.childAnchor = { x: 2.5, z: -2.0, seat: 0.6, yaw: 0, pose: "sit" };
      placeChild();
      return;
    }
    // slide
    if (combined.includes("slide")) {
      current.childAnchor = { x: -2.5, z: -2.0, yaw: 0, pose: "stand" };
      placeChild();
      return;
    }
    // sandbox
    if (combined.includes("sand") || combined.includes("castle") || combined.includes("box")) {
      current.childAnchor = { x: 0, z: 1.5, seat: 0.2, yaw: 0, pose: "sit" };
      placeChild();
      return;
    }
  } else if (state.location === "market") {
    // checkout
    if (combined.includes("checkout") || combined.includes("pay") || combined.includes("cashier") || combined.includes("card")) {
      current.childAnchor = { x: -0.8, z: 2.0, yaw: 0, pose: "stand" };
      placeChild();
      return;
    }
    // snack
    if (combined.includes("cookie") || combined.includes("snack") || combined.includes("candy")) {
      current.childAnchor = { x: 1.5, z: -0.5, yaw: Math.PI, pose: "stand" };
      placeChild();
      return;
    }
  } else if (state.location === "party") {
    // buffet
    if (combined.includes("eat") || combined.includes("food") || combined.includes("cake") || combined.includes("buffet")) {
      current.childAnchor = { x: -1.0, z: -1.5, yaw: 0, pose: "stand" };
      placeChild();
      return;
    }
    // couch
    if (combined.includes("grandma") || combined.includes("couch") || combined.includes("sit")) {
      current.childAnchor = { x: 0, z: -2.5, seat: 0.5, yaw: 0, pose: "sit" };
      placeChild();
      return;
    }
  }
}

let sessionExchanges = 0;

function playCautionBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.warn(e);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  ensureAudio(); // this counts as a user gesture, so sounds can play

  // Clean up active conflict styling and banners if they exist
  document.body.classList.remove("conflict-active");
  const oldBanner = document.querySelector("#activeConflictBanner");
  if (oldBanner) oldBanner.remove();
  
  sessionExchanges++;
  
  // Trigger age-specific conflicts after 3 exchanges in stand/pose scenes
  if (activeSessionId && sessionExchanges === 3) {
    const age = state.age;
    const loc = state.location;
    let conflictText = "";
    if (age === 5 && loc === "home") {
      conflictText = `*Mira grabs a red crayon and starts scribbling all over the living room wall!* "Look at my art!"`;
    } else if (age === 5 && loc === "park") {
      conflictText = `*Mira starts standing up on the moving swing, laughing.* "Higher! Look, no hands!"`;
    } else if (age === 15 && loc === "car") {
      conflictText = `*Mira pulls out her phone, scrolling through social media, ignoring you.*`;
    }
    
    if (conflictText) {
      state.childLine = conflictText;
      state.mood = "resistant";
      
      // Play Caution audio sound
      playCautionBeep();
      
      // Add pulsing red overlay styling and append warning banner
      document.body.classList.add("conflict-active");
      const banner = document.createElement("div");
      banner.id = "activeConflictBanner";
      banner.className = "conflict-banner";
      banner.innerHTML = `⚠️ DE-ESCALATION EVENT ACTIVATED. ENGAGE PATIENTLY!`;
      document.body.appendChild(banner);

      // Log the event to the history
      await sendToBackend({
        message: "[Triggered Behavioral Conflict Scenario]",
        day: state.day,
        age: state.age,
        band: state.band,
        location: state.location,
        values: { ...state.values }
      });
      syncUi();
      return;
    }
  }

  const spokenTone = pendingTone; // set by the mic flow; null for typed turns
  pendingTone = null;
  const result = await sendToBackend({
    message,
    day: state.day,
    age: state.age,
    band: state.band,
    location: state.location,
    values: { ...state.values },
    tone: spokenTone,
  });
  Object.assign(state.values, result.values);

  // Conflict Governor: intervention banner + tone readout (PRD UI Feedback)
  if (result.governor && result.governor.intervened) {
    showGovernorBanner(result.governor.reason);
  } else {
    hideGovernorBanner();
  }
  if (spokenTone) showToneChip(result.toneRead, spokenTone.aggression);
  // flagged voice -> appeal pop-up: ESL speakers and genuinely tense people
  // get to explain themselves before/alongside any scoring
  if (spokenTone && result.needsClarification) showToneAppealModal(result);

  // Mira reacts emotionally to what the parent just said or did
  const govIntercepted = !!(result.governor && result.governor.intervened);
  const react = govIntercepted ? null : detectReaction(message, result);
  const meltdown = react === "tantrum";
  if (govIntercepted) {
    // forced Cool Down: soft distressed withdrawal, no escalation allowed
    triggerReaction("cry");
  } else if (meltdown) {
    // dismissed once too often: she stomps, screams, and hurls a toy at you
    performChildAction({ type: "tantrum", prop: "none", spot: "none" });
    setTimeout(() => performChildAction({ type: "throw_toy", prop: "none", spot: "none" }), 1700);
  } else if (react) {
    triggerReaction(react);
  }

  window.interactionCount = (window.interactionCount || 0) + 1;
  if (window.interactionCount >= 3) {
    window.interactionCount = 0;
    ageUp();
  }
  state.mood = result.mood;
  state.childLine = result.childLine;
  // Claude's structured action drives her body; keyword matching is only the
  // offline fallback. A local meltdown overrides both -- she's beyond requests.
  const acted = meltdown ? true : (result.action ? performChildAction(result.action) : false);
  if (!acted) handleDynamicChatActions(message, result.childLine);
  speakAsMira(result.childLine, result.mood); // she says it out loud, mood-aware
  syncUi();
}

let sessionParentId = "mira";

/* ============================================================
   Voice & tone (PRD 3b Audio-Stream): the mic captures BOTH the
   words (speech-to-text) and the vocal delivery -- volume, pitch,
   sharpness, rate. Children believe the tone, not the words, and
   the tone is what exposes performative parenting.
   ============================================================ */
let pendingTone = null;   // attached to the next /api/interact call
let micBusy = false;
let miraVoiceOn = true;   // Mira speaks her replies out loud

// Every mic and every voice is different (browser auto-gain makes quiet
// voices LOUD), so raw features alone mislabel normal speech as tense.
// We score with generous floors AND calibrate against this speaker's own
// typical delivery, learned across turns (EMA persisted in localStorage).
function getToneBaseline() {
  const v = parseFloat(localStorage.getItem("DIGICHILD_TONE_BASE"));
  return Number.isFinite(v) ? v : 0;
}
function updateToneBaseline(rawScore) {
  // don't learn shouting as "normal" -- only absorb ordinary turns
  if (rawScore >= 0.75) return;
  const prev = getToneBaseline();
  const next = prev === 0 ? rawScore : prev * 0.7 + rawScore * 0.3;
  localStorage.setItem("DIGICHILD_TONE_BASE", next.toFixed(3));
}

// ESL mode: accents and second-language prosody can read hot to any acoustic
// model, so the monitor asks the parent to explain before scoring a flag.
function isEslSpeaker() {
  return localStorage.getItem("DIGICHILD_ESL") === "1";
}

let lastRawAggression = 0; // pre-baseline score of the latest voice turn (for recalibration)

function computeAggression(m) {
  // floors: ordinary conversational levels score ~0; only excess counts
  const loud = Math.min(1, Math.max(0, m.peak - 0.3) * 1.6);
  const sharp = Math.min(1, Math.max(0, m.sharpness - 0.25) * 1.7);
  const fast = Math.min(1, Math.max(0, m.wordsPerSec - 2.8) / 2.4);
  const spiky = Math.min(1, m.pitchVar / 150);
  // clinical voice-quality measures (speech-pathology standards): perturbation
  // and timbre instability read strain/harshness that loudness alone misses
  const jit = Math.min(1, Math.max(0, (m.jitter || 0) - 0.04) * 8);    // >4% cycle-to-cycle pitch perturbation
  const shim = Math.min(1, Math.max(0, (m.shimmer || 0) - 0.12) * 4);  // >12% amplitude perturbation
  const flux = Math.min(1, Math.max(0, (m.flux || 0) - 0.1) * 3);      // violent timbre swings
  const raw = Math.min(1, loud * 0.32 + sharp * 0.2 + fast * 0.11 + spiky * 0.11
                         + jit * 0.1 + shim * 0.08 + flux * 0.08);
  lastRawAggression = raw;
  // personal calibration: subtract how "hot" this speaker/mic normally runs
  const base = getToneBaseline();
  const adjusted = base > 0.3 ? Math.max(0, Math.min(1, raw - (base - 0.3))) : raw;
  updateToneBaseline(raw);
  return adjusted;
}

// "I was calm" appeal: absorb the last turn into the personal baseline so the
// same delivery stops reading as tense on this device.
function recalibrateToneBaseline() {
  const prev = getToneBaseline();
  const next = Math.min(0.6, Math.max(prev, lastRawAggression * 0.92));
  localStorage.setItem("DIGICHILD_TONE_BASE", next.toFixed(3));
  return next;
}

function estimatePitch(buf, sr) {
  // coarse normalized autocorrelation -- plenty for prosody tracking
  const N = buf.length;
  const minLag = Math.floor(sr / 500), maxLag = Math.min(N - 1, Math.floor(sr / 60));
  let best = -1, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let corr = 0;
    for (let i = 0; i < N - lag; i += 4) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) { bestCorr = corr; best = lag; }
  }
  return best > 0 ? sr / best : 0;
}

async function startVoiceCapture() {
  if (micBusy) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Voice input needs Chrome or Edge with a microphone.");
    return;
  }
  micBusy = true;
  const micBtn = document.querySelector("#micBtn");
  const input = document.querySelector("#messageInput");
  micBtn.classList.add("recording");
  input.placeholder = "Listening... speak to Mira";

  // audio feature stream (runs while you speak)
  let stream = null, actx = null, rafId = null;
  const samples = { rms: [], cent: [], pitch: [] };
  try {
    // autoGainControl OFF: the browser's AGC boosts quiet voices to full
    // volume, which made every normal voice read as "tense"
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: false, echoCancellation: true, noiseSuppression: true },
    });
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const srcNode = actx.createMediaStreamSource(stream);
    const an = actx.createAnalyser();
    an.fftSize = 2048;
    srcNode.connect(an);
    const tbuf = new Float32Array(an.fftSize);
    const fbuf = new Float32Array(an.frequencyBinCount);
    const nyquist = actx.sampleRate / 2;
    const tick = () => {
      an.getFloatTimeDomainData(tbuf);
      let sum = 0;
      for (let i = 0; i < tbuf.length; i++) sum += tbuf[i] * tbuf[i];
      const rms = Math.sqrt(sum / tbuf.length);
      if (rms > 0.012) { // only voiced frames
        samples.rms.push(rms);
        an.getFloatFrequencyData(fbuf);
        let wsum = 0, esum = 0;
        for (let i = 1; i < fbuf.length; i++) {
          const e = Math.pow(10, fbuf[i] / 10);
          wsum += e * (i * nyquist / fbuf.length);
          esum += e;
        }
        if (esum > 0) samples.cent.push(wsum / esum);
        const p = estimatePitch(tbuf, actx.sampleRate);
        if (p > 60 && p < 500) samples.pitch.push(p);
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    console.warn("Microphone unavailable:", e);
  }

  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  const t0 = performance.now();
  let finalText = "";
  rec.onresult = (ev) => {
    let interim = "";
    for (const r of ev.results) {
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = (finalText + " " + interim).trim();
  };
  rec.onerror = (e) => console.warn("Speech recognition error:", e.error);
  rec.onend = () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    if (actx) actx.close();
    micBtn.classList.remove("recording");
    input.placeholder = "Speak to Mira...";
    micBusy = false;

    const text = (finalText || input.value).trim();
    if (!text) return;
    const dur = Math.max(0.6, (performance.now() - t0) / 1000);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    // perturbation measures over consecutive voiced frames (clinical voice
    // metrics): jitter = pitch instability, shimmer = amplitude instability,
    // flux = how violently the spectral timbre swings turn-to-turn
    const perturb = (a) => {
      if (a.length < 3) return 0;
      const m = mean(a);
      if (!m) return 0;
      let d = 0;
      for (let i = 1; i < a.length; i++) d += Math.abs(a[i] - a[i - 1]);
      return d / (a.length - 1) / m;
    };
    const pm = mean(samples.pitch);
    const wps = +(text.split(/\s+/).length / dur).toFixed(2);
    const vol = Math.min(1, mean(samples.rms) * 6);
    const tone = {
      volume: vol,
      peak: Math.min(1, (samples.rms.length ? Math.max(...samples.rms) : 0) * 4),
      pitch: Math.round(pm),
      pitchVar: Math.round(Math.sqrt(mean(samples.pitch.map((p) => (p - pm) ** 2)))),
      sharpness: Math.min(1, mean(samples.cent) / 3200),
      wordsPerSec: wps,
      jitter: +Math.min(1, perturb(samples.pitch)).toFixed(3),
      shimmer: +Math.min(1, perturb(samples.rms)).toFixed(3),
      flux: +Math.min(1, perturb(samples.cent)).toFixed(3),
      esl: isEslSpeaker(),
      source: "voice",
    };
    // arousal (activation axis of the circumplex model): energy + speech rate
    tone.arousal = +Math.min(1, vol * 0.6 + Math.min(1, wps / 4.5) * 0.4).toFixed(2);
    tone.aggression = +computeAggression(tone).toFixed(2);
    pendingTone = tone;
    input.value = text;
    document.querySelector("#messageForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  rec.start();
}

// Mira speaks her replies with a mood-aware child voice (PRD Sim Agent)
function speakAsMira(line, mood) {
  if (!miraVoiceOn || !("speechSynthesis" in window) || !line) return;
  const text = line.replace(/\*[^*]*\*/g, "").trim(); // strip *actions*
  if (!text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const band = state.band || "";
  const base = band.includes("14") ? 1.15 : band.includes("10") ? 1.3 : 1.5;
  const m = mood || state.mood || "";
  if (m === "happy" || m === "playful" || m === "curious") { u.pitch = Math.min(2, base + 0.2); u.rate = 1.05; }
  else if (m === "upset" || m === "resistant") { u.pitch = Math.min(2, base + 0.3); u.rate = 1.12; }
  else if (m === "withdrawn" || m === "guarded") { u.pitch = base; u.rate = 0.8; u.volume = 0.6; }
  else { u.pitch = base + 0.1; u.rate = 0.98; }
  const pick = () => {
    const voices = speechSynthesis.getVoices();
    const v = voices.find((v) => /child|kid|zira|jenny|aria|samantha|female/i.test(v.name) && v.lang.startsWith("en"))
      || voices.find((v) => v.lang.startsWith("en"));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  };
  if (speechSynthesis.getVoices().length) pick();
  else speechSynthesis.onvoiceschanged = pick;
}

function showGovernorBanner(reason) {
  const b = document.querySelector("#governorBanner");
  if (!b) return;
  b.style.display = "flex";
  const r = document.querySelector("#governorReason");
  if (r) r.textContent = "Cool-down: " + (reason || "conflict throttled") +
    ". She has withdrawn — soften your voice, validate her feelings, repair.";
}
function hideGovernorBanner() {
  const b = document.querySelector("#governorBanner");
  if (b) b.style.display = "none";
}

function showToneChip(toneRead, aggression) {
  const c = document.querySelector("#toneChip");
  if (!c) return;
  const level = aggression >= 0.7 ? "🔴 aggressive" : aggression >= 0.55 ? "🟠 tense" : "🟢 calm";
  c.textContent = `🎙 Your tone: ${level}` + (toneRead && toneRead.includes("INCONGRUENT") ? " — words don't match your voice" : "");
  c.style.display = "block";
  clearTimeout(c._hideT);
  c._hideT = setTimeout(() => { c.style.display = "none"; }, 7000);
}

/* ============================================================
   Tone appeal pop-up (professor feedback): when the monitor
   flags a voice as tense, the parent — ESL speakers and real
   tense people alike — gets to explain themselves. The
   explanation goes on the record for the case manager.
   ============================================================ */
function showToneAppealModal(result) {
  const modal = document.querySelector("#toneAppealModal");
  if (!modal) return;
  const reason = document.querySelector("#toneAppealReason");
  const toneRead = result.toneRead || "";
  if (toneRead.includes("TONE CHECK (ESL)")) {
    reason.textContent = "Your voice read as tense, but since English is your second language, nothing was scored — accents and second-language rhythm can sound tense to the monitor. Explain what you meant, and your case manager will see it next to the flag.";
  } else if (toneRead.includes("INCONGRUENT")) {
    reason.textContent = "Your words were warm, but your voice read as aggressive — the child believes the tone. If your natural speaking style caused this, tell us; your explanation goes to your case manager.";
  } else {
    reason.textContent = "The monitor heard tension in your voice. Some people just talk this way — if that's you, say so or recalibrate, and your case manager sees your side too.";
  }
  document.querySelector("#toneAppealText").value = "";
  document.querySelector("#toneAppealMsg").textContent = "";
  modal.style.display = "flex";
}

function hideToneAppealModal() {
  const m = document.querySelector("#toneAppealModal");
  if (m) m.style.display = "none";
}

async function sendToneClarification(explanation, recalibrated) {
  try {
    await fetch(`${API_BASE}/api/tone/clarify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childId: sessionParentId, explanation, recalibrated }),
    });
    return true;
  } catch {
    return false;
  }
}

document.querySelector("#toneAppealSend")?.addEventListener("click", async () => {
  const text = document.querySelector("#toneAppealText").value.trim();
  const msg = document.querySelector("#toneAppealMsg");
  if (!text) { msg.textContent = "Write a sentence or two first."; return; }
  msg.textContent = "Sending to your case manager...";
  const ok = await sendToneClarification(text, false);
  msg.textContent = ok ? "✅ Added to your session record." : "Could not reach the server.";
  if (ok) setTimeout(hideToneAppealModal, 1400);
});

document.querySelector("#toneAppealCalm")?.addEventListener("click", async () => {
  const msg = document.querySelector("#toneAppealMsg");
  recalibrateToneBaseline(); // this delivery is my normal — stop flagging it
  msg.textContent = "Recalibrating to your natural voice...";
  const note = document.querySelector("#toneAppealText").value.trim() || "Parent reports this is their normal speaking voice.";
  await sendToneClarification(note, true);
  msg.textContent = "✅ Baseline updated — your normal voice won't read as tense.";
  setTimeout(hideToneAppealModal, 1400);
});

document.querySelector("#toneAppealSkip")?.addEventListener("click", hideToneAppealModal);

document.querySelector("#micBtn")?.addEventListener("click", startVoiceCapture);
document.querySelector("#voiceBtn")?.addEventListener("click", () => {
  miraVoiceOn = !miraVoiceOn;
  if (!miraVoiceOn) speechSynthesis.cancel();
  document.querySelector("#voiceBtn").textContent = miraVoiceOn ? "🔊 Voice On" : "🔇 Voice Off";
});

// ESL toggle: mirrors the registration checkbox (and the ?esl=1 launch param)
// so the tone monitor asks this speaker to clarify before scoring a flag
function syncEslButton() {
  const b = document.querySelector("#eslBtn");
  if (!b) return;
  const on = isEslSpeaker();
  b.textContent = on ? "🌐 ESL On" : "🌐 ESL Off";
  b.classList.toggle("esl-active", on);
}
if (new URLSearchParams(window.location.search).get("esl") === "1") {
  localStorage.setItem("DIGICHILD_ESL", "1");
}
syncEslButton();
document.querySelector("#eslBtn")?.addEventListener("click", () => {
  localStorage.setItem("DIGICHILD_ESL", isEslSpeaker() ? "0" : "1");
  syncEslButton();
});

async function sendToBackend(payload) {
  const requestPayload = {
    message: payload.message,
    day: payload.day,
    year: payload.age,
    ageBand: payload.band,
    mode: "conversation",
    location: payload.location,
    values: payload.values,
    tone: payload.tone || null,
    session: {
      childId: sessionParentId,
      runId: activeSessionId || "local-demo"
    }
  };

  try {
    const response = await fetch(`${API_BASE}/api/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      console.warn(`Governor request failed: ${response.status}, falling back to mock`);
      return mockGovernor(payload);
    }

    return await response.json();
  } catch (err) {
    console.warn("Backend offline, falling back to mock", err);
    return mockGovernor(payload);
  }
}

function mockGovernor({ message, values, band, location }) {
  const m = message.toLowerCase();
  const supportive = /(good|proud|understand|safe|try|learn|think|because|why|together|patient|sorry|explain)/.test(m);
  const harsh = /(stupid|shut|dumb|hate|wrong|stop asking|because i said|bad kid|annoying)/.test(m);
  const autonomy = /(choose|your choice|what do you think|decide|independent|reason)/.test(m);
  const logic = /(why|because|reason|evidence|solve|think|pattern|consequence)/.test(m);

  const next = { ...values };
  next.trust = clamp(next.trust + (supportive ? 5 : 0) - (harsh ? 12 : 1));
  next.curiosity = clamp(next.curiosity + (supportive || logic ? 4 : -1) - (harsh ? 8 : 0));
  next.logic = clamp(next.logic + (logic ? 7 : supportive ? 2 : 0));
  next.security = clamp(next.security + (supportive ? 4 : 0) - (harsh ? 14 : 1));
  next.autonomy = clamp(next.autonomy + (autonomy ? 7 : band === "Age 14-16" ? 2 : 0));
  next.volatility = clamp(next.volatility + (harsh ? 13 : -3) - (supportive ? 2 : 0));

  // where you parent matters a little, too
  const touch = {
    home: { security: 1 },
    car: { trust: 1 },
    park: { curiosity: 2 },
    market: { logic: 1, autonomy: 1 },
    party: { security: 2 },
  }[location] || {};
  for (const [k, v] of Object.entries(touch)) next[k] = clamp(next[k] + v);

  let mood = "curious";
  if (harsh) mood = "guarded";
  else if (supportive) mood = "open";
  else if (logic) mood = "analytical";
  else if (autonomy) mood = "testing boundaries";
  else {
    if (next.volatility > 58) mood = "guarded";
    else if (next.trust > 76 && next.security > 70) mood = "open";
    else if (next.logic > 65) mood = "analytical";
    else if (next.autonomy > 55) mood = "testing boundaries";
  }

  const childLine = chooseLine(mood, band);
  return Promise.resolve({ values: next, mood, childLine });
}

function chooseLine(mood, band) {
  const lines = {
    curious: {
      "Age 5-7": [
        "If I ask why twice, will you still answer me?",
        "Why does the sun go down? Is it sleeping?",
        "How many stars are in the sky? Can we count them?"
      ],
      "Age 10-12": [
        "I get what you mean, but how do I know when a rule is fair?",
        "Why do I have to do this chore if my friends don't?",
        "How does this work? Can I try to take it apart?"
      ],
      "Age 14-16": [
        "I hear you. I just need the reason to make sense before I follow it.",
        "Why are the rules different for me than they are for you?",
        "What's the point of learning this if I won't use it in real life?"
      ],
    },
    open: {
      "Age 5-7": [
        "Okay. I feel like I can try it with you watching.",
        "I like when you help me with this. Let's do it together!",
        "Okay, I will try my best!"
      ],
      "Age 10-12": [
        "That made sense. I think I can remember the pattern next time.",
        "Thanks for explaining it that way. I'll get started.",
        "I appreciate you asking me first. I can do that."
      ],
      "Age 14-16": [
        "I respect that. You gave me room and still kept the boundary clear.",
        "Yeah, that makes sense. I'll take care of it.",
        "Thanks for treating me like an adult. I'll handle it."
      ],
    },
    analytical: {
      "Age 5-7": [
        "So if I do this, then that happens? I want to test it.",
        "If I drop this ball, will it bounce higher than me?",
        "How does the toy make that sound? Show me!"
      ],
      "Age 10-12": [
        "That is a cause and effect thing. I can track that.",
        "If we change this variable, will the outcome change too?",
        "I calculated how long this will take. I'm ready."
      ],
      "Age 14-16": [
        "Your logic is consistent. I do not fully agree, but I can work with it.",
        "If we look at the data, this approach makes the most sense.",
        "Let's break down the pros and cons before we decide."
      ],
    },
    guarded: {
      "Age 5-7": [
        "I don't know if I want to ask now.",
        "Are you going to be mad at me?",
        "*hides behind the toy* I don't want to talk."
      ],
      "Age 10-12": [
        "You changed the rule again. Which version am I supposed to trust?",
        "Why are you using that tone with me?",
        "I don't think you're actually listening to me."
      ],
      "Age 14-16": [
        "You want honesty, but you punish the questions that get us there.",
        "It feels like whatever I say is going to be used against me.",
        "You're not trying to understand; you're just trying to win."
      ],
    },
    "testing boundaries": {
      "Age 5-7": [
        "Can I pick first and then you help if I mess up?",
        "What if I color on this page instead of that one?",
        "Just five more minutes of playtime, please?"
      ],
      "Age 10-12": [
        "What happens if I choose a different answer than yours?",
        "Can I do my homework after dinner instead of right now?",
        "Why is this the limit? Who decided it?"
      ],
      "Age 14-16": [
        "I can own the decision. I need you to let me own the consequence too.",
        "I want to stay out an hour later. I'll text you when I move locations.",
        "I need some privacy in my room. Can you knock first?"
      ],
    },
  };
  const list = lines[mood]?.[band] || ["Okay."];
  return list[Math.floor(Math.random() * list.length)];
}

function ageUp() {
  state.day = Math.min(21, state.day + 1);
  if (state.age < 18) state.age += state.age < 7 ? 1 : state.age < 12 ? 2 : 3;
  if (state.age <= 7) state.band = "Age 5-7";
  else if (state.age <= 12) state.band = "Age 10-12";
  else state.band = "Age 14-16";
  state.values.autonomy = clamp(state.values.autonomy + 7);
  state.values.logic = clamp(state.values.logic + 4);
  state.values.volatility = clamp(state.values.volatility + (state.band === "Age 14-16" ? 5 : 1));
  state.childLine = chooseLine(state.values.volatility > 58 ? "guarded" : "curious", state.band);
  
  const scale = 1.0; // Keep child group scale at 1.0 since VRM models have distinct physical heights per stage
  child.scale.set(scale, scale, scale);
  
  syncUi();
}

function milestoneText() {
  return `Trust is ${state.values.trust}, curiosity is ${state.values.curiosity}, and volatility is ${state.values.volatility}. Mira is currently ${state.mood} at the ${locationDefs[state.location].label.toLowerCase()}; the next interaction should either reinforce safety or challenge logic, depending on the outcome you want.`;
}

function architectText() {
  return `Parent Governor read: user-facing behavior is being shaped by consistency, explanation quality, and repair language. Location context (currently: ${locationDefs[state.location].label}) is sent with each interaction so the Governor can weight environment effects. The private scoring layer stays server-side; the UI only needs state deltas, child response text, age band, and a safe explanation summary.`;
}

function openInsight(title, text) {
  insightTitle.textContent = title;
  insightText.textContent = text;
  insightPanel.classList.add("is-open");
}

/* ============================================================
   Main loop
   ============================================================ */
window.addEventListener("resize", resize);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return; // hidden/background tab reports 0x0 -- never size down to nothing
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}
// If the page loaded in a background tab (0x0 viewport), no resize event fires
// when it becomes visible -- recover the canvas the moment we can see it.
document.addEventListener("visibilitychange", () => { if (!document.hidden) resize(); });
setInterval(() => {
  const c = renderer.domElement;
  if (window.innerWidth && (!c.width || Math.abs(c.clientWidth - window.innerWidth) > 2)) resize();
}, 1500);

const clock = new THREE.Clock();
const camWorld = new THREE.Vector3();

function updateFrame(dt, t) {
  if (sessionPaused) return; // Freeze simulation!
  updateMovement(dt);
  if (current.tick) current.tick(t, dt);

  const bob = Math.sin(player.bobPhase) * 0.035 * player.bobAmp;
  const wobble = current.camWobble ? current.camWobble(t) : 0;
  camRig.position.set(player.x, current.eye + bob + wobble, player.z);
  camRig.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // Mira: reactions, playful idle, breathing, and head/eye tracking
  camera.getWorldPosition(camWorld);

  // protest physics: release the toy mid-swing, fly it in an arc, bonk + shake
  if (actionType === "throw" && !throwDone && t >= throwLaunchAt) {
    childThrowProp();
    throwDone = true;
  }
  for (let i = flyingProps.length - 1; i >= 0; i--) {
    const fp = flyingProps[i];
    const k = (t - fp.t0) / fp.dur;
    if (k >= 1) {
      scene.remove(fp.mesh);
      flyingProps.splice(i, 1);
      shakeUntil = t + 0.35; // it got you
      const ac = ensureAudio();
      if (ac) childThud(ac, ac.currentTime);
      continue;
    }
    fp.mesh.position.lerpVectors(fp.start, fp.target, k);
    fp.mesh.position.y += Math.sin(Math.PI * k) * 0.5; // arc through the air
    fp.mesh.rotation.x += dt * 14;
    fp.mesh.rotation.y += dt * 10;
  }
  if (t < shakeUntil) {
    const s = (shakeUntil - t) / 0.35;
    camRig.position.x += (Math.random() - 0.5) * 0.05 * s;
    camRig.position.y += (Math.random() - 0.5) * 0.05 * s;
    camera.rotation.x = player.pitch + (Math.random() - 0.5) * 0.045 * s;
  }

  const sitting = childPose === "sit";
  const anchor = current.childAnchor;

  // resolve the active reaction (with ease in/out)
  let rType = null;
  let rk = 0;
  if (reaction) {
    if (t >= reaction.until) reaction = null;
    else {
      rType = reaction.type;
      rk = Math.min(1, (t - reaction.start) / 0.3) * Math.min(1, (reaction.until - t) / 0.7);
    }
  }
  // a scream flinch settles into crying after the first second
  let effType = rType;
  if (rType === "scream" && reaction && t - reaction.start > 1.1) effType = "cry";

  // --- AI Wandering and Follow-the-Parent logic ---
  const dxp = camWorld.x - childWorld.x;
  const dzp = camWorld.z - childWorld.z;
  const distP = Math.hypot(dxp, dzp) || 0.001;
  const canWalk = childPose === "stand" && effType !== "cry" && effType !== "scream" && effType !== "upset";
  const isCryingText = state.childLine && (
    state.childLine.toLowerCase().includes("cry") || 
    state.childLine.toLowerCase().includes("sob") || 
    state.childLine.toLowerCase().includes("sniffle") || 
    state.childLine.toLowerCase().includes("tears") || 
    state.childLine.toLowerCase().includes("wail") ||
    state.childLine.toLowerCase().includes("shout") ||
    state.childLine.toLowerCase().includes("scream") ||
    state.childLine.toLowerCase().includes("hate") ||
    state.childLine.toLowerCase().includes("no!") ||
    state.childLine.toLowerCase().includes("whatever")
  );
  const isSadOrUpset = isCryingText || state.mood === "resistant" || state.mood === "guarded" || state.mood === "upset" || state.temperament === "transgressed";
  const goodMood = state.values.volatility < 45 && state.values.trust > 50 && !isSadOrUpset;

  if (canWalk) {
    const followDistance = 2.9;
    const playLeash = 7.2;
    const tooFarFromParent = distP > (activePlayPoint ? playLeash : followDistance);

    if (tooFarFromParent) {
      clearActivePlayPoint();
      childTarget.x = camWorld.x - (dxp / distP) * 1.25; // stop 1.25m away from parent
      childTarget.z = camWorld.z - (dzp / distP) * 1.25;
      nextWanderAt = t + 8 + Math.random() * 8;
    } else if (activePlayPoint) {
      childTarget.x = activePlayPoint.x;
      childTarget.z = activePlayPoint.z;
    } else if (distP < 3.4 && t > nextWanderAt) {
      const point = chooseReachablePlayPoint(playPoints[currentId]);
      if (point) beginActivePlayPoint(point, t);
      nextWanderAt = t + 28 + Math.random() * 24;
    }
  }

  // Calculate actual movement towards childTarget
  const dxT = childTarget.x - childWorld.x;
  const dzT = childTarget.z - childWorld.z;
  const distT = Math.hypot(dxT, dzT) || 0.001;

  let walking = false;
  if (canWalk && distT > 0.18) {
    walking = true;
    const spd = state.values.volatility > 55 ? 1.15 : 0.95; // walk, don't sprint in loops
    const step = Math.min(distT, spd * dt);
    childWorld.x += (dxT / distT) * step;
    childWorld.z += (dzT / distT) * step;
  }

  // Resolve collisions & keep in bounds -- but never shove her out of a seat
  // she was deliberately placed in (car safety seat, swings, kitchen chair...)
  const r = 0.26;
  if (canWalk && current && current.colliders) {
    for (const c of current.colliders) {
      const minX = c.minX - r;
      const maxX = c.maxX + r;
      const minZ = c.minZ - r;
      const maxZ = c.maxZ + r;
      if (childWorld.x > minX && childWorld.x < maxX && childWorld.z > minZ && childWorld.z < maxZ) {
        // Overlapping: push out along the axis of shallowest penetration
        const pL = childWorld.x - minX;
        const pR = maxX - childWorld.x;
        const pT = childWorld.z - minZ;
        const pB = maxZ - childWorld.z;
        const minP = Math.min(pL, pR, pT, pB);
        if (minP === pL) childWorld.x = minX;
        else if (minP === pR) childWorld.x = maxX;
        else if (minP === pT) childWorld.z = minZ;
        else childWorld.z = maxZ;
      }
    }
  }

  if (canWalk && current && current.bounds) {
    const b = current.bounds;
    childWorld.x = THREE.MathUtils.clamp(childWorld.x, b.minX, b.maxX);
    childWorld.z = THREE.MathUtils.clamp(childWorld.z, b.minZ, b.maxZ);
  }

  if (activePlayPoint) {
    const dx = childWorld.x - activePlayPoint.x;
    const dz = childWorld.z - activePlayPoint.z;
    const playDistance = Math.hypot(dx, dz);
    if (playDistance + 0.04 < activePlayPointBestDistance) {
      activePlayPointBestDistance = playDistance;
      activePlayPointStuckFor = 0;
    } else if (walking) {
      activePlayPointStuckFor += dt;
    }

    if (playDistance < 0.45) {
      const text = activePlayPoint.dialogue[state.band] || "";
      // don't announce the same arrival line she said last time -- just play there quietly
      if (text && text !== lastIdleLine) {
        lastIdleLine = text;
        state.childLine = text;
        syncUi();

        if (text.includes("waves") || text.includes("waves hand") || text.includes("Look!")) {
          waveUntil = t + 4.0;
          triggerReaction("happy");
        } else if (text.includes("Mommy!") || text.includes("Daddy!") || text.includes("Momy")) {
          triggerReaction("happy");
        }
      }
      lastPlayPointName = activePlayPoint.name;
      clearActivePlayPoint();
      childTarget.x = childWorld.x;
      childTarget.z = childWorld.z;
      nextWanderAt = t + 18 + Math.random() * 18;
    } else if (activePlayPointStuckFor > 2.8 || t - activePlayPointStartedAt > 14) {
      lastPlayPointName = activePlayPoint.name;
      clearActivePlayPoint();
      childTarget.x = childWorld.x;
      childTarget.z = childWorld.z;
      nextWanderAt = t + 10 + Math.random() * 12;
    }
  }
  walkAmt += ((walking ? 1 : 0) - walkAmt) * Math.min(1, dt * 8);
  if (walking) walkPhase += dt * (state.values.volatility > 55 ? 6.5 : 5.4);

  // --- is the parent looking at her? then she beams up (or scowls if upset) ---
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const facing = (fwdX * dxp + fwdZ * dzp) / distP;
  const attended = !rType && distP < 3.4 && facing > 0.5;

  // expression targets
  let tH = exprHappy, tS = exprSad, tA = exprAngry, tSurp = 0, tAa = 0;
  if (effType === "cry" || effType === "upset") {
    tH = 0; tS = 1; tA = 0.15; tAa = 0.25;
  } else if (effType === "scream") {
    tH = 0; tS = 0.2; tA = 0.45; tSurp = 1; tAa = 1;
  } else if (effType === "happy") {
    tH = 1; tS = 0; tA = 0;
  } else if (isSadOrUpset) {
    tH = 0; tS = 0.85; tA = 0.15;
  }
  if (rType) {
    tH = exprHappy + (tH - exprHappy) * rk;
    tS = exprSad + (tS - exprSad) * rk;
    tA = exprAngry + (tA - exprAngry) * rk;
    tSurp *= rk; tAa *= rk;
  } else if (attended) {
    if (goodMood) {
      tH = t < smileSpikeUntil ? 0.92 : 0.35;
      tS = 0; tA = 0; tAa = 0.14;
      // A spontaneous grin every 25-60s, but SILENT. This used to giggle out
      // loud on that timer, which is what made her sound like she was laughing
      // in the background on a loop. The smile alone carries the contentment.
      if (!walking && t > nextGiggleAt) {
        nextGiggleAt = t + 25 + rnd(Math.floor(t)) * 35;
        smileSpikeUntil = t + 3.0;
      }
    } else {
      // upset: she scowls / sulks up at you
      tH = 0; tS = Math.max(tS, 0.5); tA = Math.max(tA, state.values.volatility > 60 ? 0.5 : 0.2);
    }
  }
  const esm = Math.min(1, dt * 6);
  expr.happy += (tH - expr.happy) * esm;
  expr.sad += (tS - expr.sad) * esm;
  expr.angry += (tA - expr.angry) * esm;
  expr.surprised += (tSurp - expr.surprised) * esm;
  expr.aa += (tAa - expr.aa) * esm;

  // body pose targets (blended from rest by reaction strength rk)
  let LuZ = -1.32, LuX = 0, LuY = 0, RuZ = 1.32, RuX = 0, RuY = 0;
  let LlZ = 0, LlX = 0, LlY = 0, RlZ = 0, RlX = 0, RlY = 0;
  let RhZ = 0, RhX = 0, RhY = 0;
  
  if (childAttachedProp) {
    const isBook = childAttachedProp.name.toLowerCase().includes("book");
    if (isBook) {
      // Hold/read book pose
      LuZ = -1.32 + 0.8; RuZ = 1.32 - 0.8;
      LuX = -0.5; RuX = -0.5;
      LuY = 0.3; RuY = -0.3;
      LlX = -1.1; RlX = -1.1;
    } else {
      // Hold other item pose (right hand)
      RuZ = 1.32 - 0.6;
      RuX = -0.4;
      RlX = -0.8;
    }
  }
  
  if (t < waveUntil) {
    RuZ = 0.3;      // raise upper arm high
    RuX = -1.0;
    RuY = -0.2;
    RlX = -1.6;     // bend elbow
    RlZ = 0;
    RlY = 0;
    RhZ = Math.sin(t * 14) * 0.5;   // wave hand from wrist (Z-axis)
    RhX = 0.3;
    RhY = Math.sin(t * 14) * 0.15;  // wave hand from wrist (Y-axis)
  }
  let LUpLegX = 0, RUpLegX = 0, LLoLegX = 0, RLoLegX = 0;
  let headExtraX = 0, spineZ = 0, spineXAdd = 0, posOZ = 0, posOY = 0;

  // walk cycle: alternating leg swings, knee bends, opposite arm swing, step bob
  if (walkAmt > 0.01) {
    const sw = Math.sin(walkPhase) * walkAmt;
    LUpLegX = sw * 0.55; RUpLegX = -sw * 0.55;
    LLoLegX = Math.max(0, -Math.sin(walkPhase)) * 0.85 * walkAmt;
    RLoLegX = Math.max(0, Math.sin(walkPhase)) * 0.85 * walkAmt;
    LuX += -sw * 0.5; RuX += sw * 0.5;
    posOY += Math.abs(Math.sin(walkPhase)) * 0.03 * walkAmt;
  }

  if (effType === "cry" || effType === "upset") {
    LuZ = -1.32 + 0.62 * rk; LuX = -0.7 * rk; RuZ = 1.32 - 0.62 * rk; RuX = -0.7 * rk;
    LlZ = -1.5 * rk; RlZ = 1.5 * rk; LlX = -0.35 * rk; RlX = -0.35 * rk;
    headExtraX = -0.05 * rk;          // face stays up toward the parent
    spineXAdd = 0.05 * rk;            // gentle hunch
    spineZ = Math.sin(t * 22) * 0.035 * rk; // sob tremble
    posOY = -0.03 * rk;
  } else if (effType === "scream") {
    LuZ = -1.32 + 0.28 * rk; RuZ = 1.32 - 0.28 * rk; LuX = 0.25 * rk; RuX = 0.25 * rk;
    headExtraX = -0.32 * rk;          // head thrown back
    spineXAdd = -0.14 * rk;
    posOY = 0.02 * Math.sin(t * 30) * rk;
    posOZ = 0.05 * rk;                // recoil away
  } else if (effType === "happy") {
    const sw = Math.sin(t * 6) * 0.35 * rk;
    if (childAttachedProp && childAttachedProp.name.toLowerCase().includes("book")) {
      // Hugging book pose: arms bent inward closer to chest
      LuZ = -1.32 + 0.9 * rk; RuZ = 1.32 - 0.9 * rk;
      LuX = -0.6 * rk; RuX = -0.6 * rk;
      LuY = 0.4 * rk; RuY = -0.4 * rk;
      LlX = -1.2 * rk; RlX = -1.2 * rk;
    } else {
      LuZ = -1.32 + 0.7 * rk; RuZ = 1.32 - 0.7 * rk;
      LuX = -0.4 * rk + sw; RuX = -0.4 * rk - sw;
    }
    posOY += Math.abs(Math.sin(t * 5)) * 0.08 * rk; // happy bounce
  } else if (!walking && attended && goodMood) {
    posOY += Math.abs(Math.sin(t * 4)) * 0.025; // happy little bounce in place
    LuX += Math.sin(t * 3) * 0.1; RuX += Math.sin(t * 3 + 1) * 0.1;
  }

  // LLM-driven timed gestures override the generic poses while active
  if (t < actionUntil && actionType) {
    if (actionType === "jump") {
      posOY += Math.abs(Math.sin(t * 7)) * 0.22;      // big excited hops
      LuZ = -1.32 + 1.1; RuZ = 1.32 - 1.1;            // arms thrown up
      LuX = -1.15; RuX = -1.15;
    } else if (actionType === "dance") {
      const dsw = Math.sin(t * 6);
      LuZ = -1.32 + 0.9 + dsw * 0.25; RuZ = 1.32 - 0.9 - dsw * 0.25;
      LuX = -0.8 + dsw * 0.5; RuX = -0.8 - dsw * 0.5;  // alternating arm sways
      posOY += Math.abs(dsw) * 0.09;
      spineZ = Math.sin(t * 3) * 0.12;                 // hip sway
    } else if (actionType === "hide") {
      LuZ = -1.32 + 1.05; RuZ = 1.32 - 1.05;           // hands up covering her face
      LuX = -1.15; RuX = -1.15;
      LlX = -2.2; RlX = -2.2;
      spineXAdd = 0.32; posOY = -0.16;                 // crouch small
      headExtraX = 0.25;
    } else if (actionType === "clap") {
      // hands meet in front of her chest in a clapping rhythm
      const cl = (Math.sin(t * 11) + 1) / 2;           // 0..1 clap cycle
      LuZ = -1.32 + 0.95; RuZ = 1.32 - 0.95;
      LuX = -0.85; RuX = -0.85;
      LlX = -1.45; RlX = -1.45;
      LuY = 0.55 - cl * 0.4; RuY = -0.55 + cl * 0.4;   // arms swing toward each other
      posOY += Math.abs(Math.sin(t * 5.5)) * 0.03;     // tiny excited bounce
    } else if (actionType === "throw") {
      // windup, then whip the right arm forward as the toy releases
      const k = Math.min(1, Math.max(0, 1 - (actionUntil - t) / 1.15));
      if (k < 0.37) {
        RuZ = 1.32 - 0.5; RuX = 0.95; RlX = -1.6;      // arm cocked back over her shoulder
        spineXAdd = -0.09;
      } else {
        RuZ = 1.32 - 1.15; RuX = -1.25; RlX = -0.2;    // arm whipped forward
        spineXAdd = 0.15; posOZ = -0.03;
      }
      headExtraX = -0.1;
    } else if (actionType === "tantrum") {
      // full meltdown: stomping feet, fists clenched at her sides, head thrown back
      const stomp = Math.sin(t * 9);
      LUpLegX = Math.max(0, stomp) * 0.85;
      RUpLegX = Math.max(0, -stomp) * 0.85;
      LuZ = -1.32 + 0.15; RuZ = 1.32 - 0.15;           // arms pinned straight down
      LuX = 0.15 + Math.sin(t * 18) * 0.08;            // fists trembling with rage
      RuX = 0.15 - Math.sin(t * 18) * 0.08;
      headExtraX = -0.28;                              // head thrown back wailing
      spineXAdd = -0.1;
      posOY += Math.abs(stomp) * 0.05;                 // stomping bounces her
    }
  } else if (actionType && t >= actionUntil) {
    actionType = null;
  }

  // body yaw: turn toward target direction when walking, otherwise turn to parent (faster while walking)
  if (t < actionUntil && actionType === "spin") {
    child.rotation.y += dt * 7; // twirl!
  } else if (canWalk) {
    const yawTarget = walking ? Math.atan2(dxT, dzT) : Math.atan2(dxp, dzp);
    let diff = yawTarget - child.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    child.rotation.y += diff * Math.min(1, dt * (walking ? 5 : 2.6));
  }

  // position from her own walking position (+ small reaction/step offsets)
  child.position.x = childWorld.x;
  child.position.z = childWorld.z + posOZ;
  child.position.y = childBaseY + posOY + (childPose === "stand" ? Math.sin(t * 1.5) * 0.008 : 0);

  if (vrm) {
    const eb = (bone, x, y, z) => {
      if (!bone) return;
      const k = Math.min(1, dt * 10);
      bone.rotation.x += (x - bone.rotation.x) * k;
      bone.rotation.y += (y - bone.rotation.y) * k;
      bone.rotation.z += (z - bone.rotation.z) * k;
    };
    const hb = vrm.humanoid;
    eb(hb.getNormalizedBoneNode("leftUpperArm"), LuX, LuY, LuZ);
    eb(hb.getNormalizedBoneNode("rightUpperArm"), RuX, RuY, RuZ);
    eb(hb.getNormalizedBoneNode("leftLowerArm"), LlX, LlY, LlZ);
    eb(hb.getNormalizedBoneNode("rightLowerArm"), RlX, RlY, RlZ);
    eb(hb.getNormalizedBoneNode("rightHand"), RhX, RhY, RhZ);
    // legs: only drive them when standing (sitting pose is set elsewhere)
    if (childPose === "stand") {
      eb(hb.getNormalizedBoneNode("leftUpperLeg"), LUpLegX, 0, 0);
      eb(hb.getNormalizedBoneNode("rightUpperLeg"), RUpLegX, 0, 0);
      eb(hb.getNormalizedBoneNode("leftLowerLeg"), LLoLegX, 0, 0);
      eb(hb.getNormalizedBoneNode("rightLowerLeg"), RLoLegX, 0, 0);
    }
    const spine = hb.getNormalizedBoneNode("spine");
    if (spine) {
      spine.rotation.x += ((sitting ? -0.12 : 0) + spineXAdd - spine.rotation.x) * Math.min(1, dt * 8);
      spine.rotation.z += (spineZ - spine.rotation.z) * Math.min(1, dt * 12);
    }

    const headBone = hb.getNormalizedBoneNode("head");
    if (headBone) {
      const headPos = new THREE.Vector3();
      headBone.getWorldPosition(headPos);
      const dir = camWorld.clone().sub(headPos);
      const flat = Math.max(0.001, Math.hypot(dir.x, dir.z));
      let relYaw = Math.atan2(dir.x, dir.z) - child.rotation.y;
      relYaw = Math.atan2(Math.sin(relYaw), Math.cos(relYaw));
      relYaw = THREE.MathUtils.clamp(relYaw, -0.85, 0.85);
      const relPitch = THREE.MathUtils.clamp(Math.atan2(dir.y, flat), -0.45, 0.75);
      const track = 1 - (rType ? rk * 0.3 : 0); // mostly keep looking at parent
      headBone.rotation.set(-relPitch * 0.7 * track + headExtraX, relYaw * 0.75 * track, 0);
    }

    const em = vrm.expressionManager;
    if (em) {
      em.setValue("blink", blinkUntil > 0 && effType !== "scream" ? 1 : 0);
      em.setValue("happy", expr.happy);
      em.setValue("sad", expr.sad);
      em.setValue("angry", expr.angry);
      em.setValue("surprised", expr.surprised);
      em.setValue("aa", expr.aa);
    }
    vrm.update(dt);
  }

  // Animate all active family members (nodding, turning head, breathing, gesturing).
  // Round-robin: each guest updates every 3rd frame -- the sine poses are absolute
  // in t so nothing visibly changes, but the party renders ~3x cheaper.
  fmPhase = (fmPhase + 1) % 3;
  for (let i = fmPhase; i < familyMembers.length; i += 3) {
    const fv = familyMembers[i];
    
    // Breathing (spine movement)
    const spine = fv.humanoid.getNormalizedBoneNode("spine");
    if (spine) {
      spine.rotation.z = Math.sin(t * 1.8 + i) * 0.015;
      spine.rotation.x = Math.sin(t * 1.5 + i * 2) * 0.01;
    }
    
    // Head turning/talking rotation
    const head = fv.humanoid.getNormalizedBoneNode("head");
    if (head) {
      const talkPitch = Math.sin(t * 2.8 + i * 1.5) * 0.04;
      const talkYaw = Math.cos(t * 1.2 + i * 3) * 0.08;
      const nod = Math.sin(t * 4 + i) * 0.03 * (Math.sin(t * 0.5 + i) > 0 ? 1 : 0.15);
      head.rotation.set(talkPitch + nod, talkYaw, 0);
    }
    
    // Arm gesturing
    const leftUpperArm = fv.humanoid.getNormalizedBoneNode("leftUpperArm");
    const rightUpperArm = fv.humanoid.getNormalizedBoneNode("rightUpperArm");
    if (leftUpperArm) {
      leftUpperArm.rotation.z = -1.32 + Math.sin(t * 2 + i) * 0.06;
      leftUpperArm.rotation.x = Math.sin(t * 1.5 + i) * 0.05;
    }
    if (rightUpperArm) {
      rightUpperArm.rotation.z = 1.32 - Math.sin(t * 2.2 + i * 2.5) * 0.06;
      rightUpperArm.rotation.x = Math.sin(t * 1.7 + i * 1.5) * 0.05;
    }
    
    fv.update(dt * 3);
  }

  // blink every few seconds
  if (blinkUntil < 0 && t >= nextBlinkAt) {
    blinkUntil = t + 0.14;
  } else if (blinkUntil > 0 && t >= blinkUntil) {
    blinkUntil = -1;
    nextBlinkAt = t + 2.4 + rnd(Math.floor(t * 7)) * 3;
  }
  motes.rotation.y = t * 0.015;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (!current) return;

  if (t > nextIdleActionTime) {
    triggerIdleChildAction();
    nextIdleActionTime = t + 35 + Math.random() * 25;
  }

  updateFrame(dt, t);
  composer.render();
}

/* ============================================================
   Clinical Orchestrator Logic
   ============================================================ */
let activeSessionId = queryParams.get("session");
// Default to clinician (dashboard) mode if there is no active session ID
let sessionRole = activeSessionId ? queryParams.get("role")
  : (queryParams.get("role") === "clinician" ? "clinician" : "landing");
let sessionPaused = false;
let selectedClinicianSession = null;

// DOM Elements
const clinicianHub = document.querySelector("#clinicianHub");
const availabilityPortal = document.querySelector("#availabilityPortal");
const pauseOverlay = document.querySelector("#pauseOverlay");

async function checkSessionStatus() {
  if (!activeSessionId) return;
  try {
    const res = await fetch(`${API_BASE}/api/session/status?sessionId=${activeSessionId}`);
    if (res.ok) {
      const data = await res.json();
      sessionPaused = data.paused;
      
      // Update UI based on pause state
      if (sessionPaused) {
        pauseOverlay.style.display = "flex";
        form.querySelector("input").disabled = true;
        form.querySelector("button").disabled = true;
      } else {
        pauseOverlay.style.display = "none";
        form.querySelector("input").disabled = false;
        form.querySelector("button").disabled = false;
      }
      
      if (data.status === "pending_outreach") {
        renderAvailabilityPortal();
      } else {
        availabilityPortal.style.display = "none";
      }
      
      // Always update child age and band from session metrics if available
      if (data.metrics && typeof data.metrics.child_age === "number") {
        state.age = data.metrics.child_age;
        if (state.age <= 7) {
          state.band = "Age 5-7";
        } else if (state.age <= 12) {
          state.band = "Age 10-12";
        } else {
          state.band = "Age 14-16";
        }
      }

      // Update state values if the session is live
      if (data.status === "live" || data.status === "live_paused") {
        if (data.metrics && data.metrics.child_id) {
          sessionParentId = data.metrics.child_id;
        }
        Object.assign(state.values, data.metrics);
        syncUi();
      } else {
        updateChildLook();
      }
    }
  } catch (err) {
    console.error("Error checking session status:", err);
  }
}

let availPortalRendered = false;
async function renderAvailabilityPortal() {
  // The status poll calls this every 1.5s; without this guard it would rebuild
  // the form under the parent's cursor and reset their choice on every tick.
  if (availPortalRendered) return;
  availPortalRendered = true;

  availabilityPortal.style.display = "flex";
  availabilityPortal.innerHTML = `
    <div class="portal-card">
      <h2>Digi-Child Scheduling Portal</h2>
      <p>Please enter your availability below to book the evaluation session with the clinician and court monitor.</p>

      <label for="availSlotSelect">Select Availability Slot (Day &amp; Time)</label>
      <select id="availSlotSelect"><option>Loading open times…</option></select>

      <button id="submitAvailBtn">Match &amp; Book Session</button>
      <p id="portalStatusMsg" style="margin-top:12px; font-size:12px; color:var(--warm);"></p>
    </div>
  `;

  // Real times from the team's live availability. These used to be three
  // hardcoded 2026-07-08/09 options -- dates already in the past, so whatever the
  // parent picked could never overlap and they were stranded in "pending_match".
  const sel = document.querySelector("#availSlotSelect");
  try {
    const res = await fetch(`${API_BASE}/api/register/options`);
    const slots = (await res.json()).slots || [];
    if (!slots.length) {
      sel.innerHTML = `<option value="">No open times right now — please check back soon</option>`;
      document.querySelector("#submitAvailBtn").disabled = true;
    } else {
      sel.innerHTML = slots.slice(0, 40)
        .map((s) => `<option value="${s.start}|${s.end}">${s.label}</option>`)
        .join("");
    }
  } catch {
    sel.innerHTML = `<option value="">Could not load times (is the backend running?)</option>`;
    document.querySelector("#submitAvailBtn").disabled = true;
  }

  document.querySelector("#submitAvailBtn").addEventListener("click", async () => {
    const raw = document.querySelector("#availSlotSelect").value;
    if (!raw) return;
    const slot = raw.split("|");
    const parentAvail = [{ start: slot[0], end: slot[1] }];
    try {
      const res = await fetch(`${API_BASE}/api/schedule/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSessionId,
          parent_avail: parentAvail
        })
      });
      const result = await res.json();
      const msgEl = document.querySelector("#portalStatusMsg");
      if (result.status === "booked") {
        msgEl.innerHTML = `Success! Session booked for:<br><strong>${result.match.start}</strong>`;
        setTimeout(() => {
          availabilityPortal.style.display = "none";
          window.location.reload();
        }, 3000);
      } else {
        msgEl.textContent = "Availability submitted. Waiting for calendar match.";
      }
    } catch (e) {
      console.error(e);
    }
  });
}

function dismissSplashScreen() {
  const splash = document.querySelector("#splashScreen");
  if (splash && !splash.classList.contains("fade-out")) {
    splash.classList.add("fade-out");
    setTimeout(() => {
      splash.style.display = "none";
    }, 800); // matches the transition duration in CSS
  }
}

/* ============================================================
   Landing / intro page: role-based entry. Parents register and
   pick among the team's ACTUALLY available dates; case managers
   enroll into their console; approval triggers the launch email.
   ============================================================ */
/* ============================================================
   Intro film: plays on arrival, then the two role panels rise
   over it and it settles into a live backdrop behind them.
   ============================================================ */
function playIntroFilm() {
  const stage = document.querySelector("#introStage");
  const video = document.querySelector("#introVideo");
  const page = document.querySelector("#landingPage");
  if (!stage || !video || !page) return false;

  // ?nointro=1 for when you're iterating and don't want 10s every reload
  if (queryParams.get("nointro") === "1") return false;

  stage.style.display = "block";
  page.style.display = "none";
  dismissSplashScreen(); // the film IS the splash

  let handedOver = false;
  const handOver = (reason = "unknown") => {
    if (handedOver) return;
    handedOver = true;
    window.__introHandover = { reason, at: +video.currentTime.toFixed(2) };
    stage.classList.add("backdrop"); // scrim up, film recedes
    page.style.display = "flex";
    page.classList.add("over-film");
    // The film is over, so there is nothing left to unmute -- drop the prompt
    // rather than leaving a "Tap for sound" button that quietly does nothing.
    stage.querySelector(".intro-sound-hint")?.remove();
  };

  video.addEventListener("ended", () => handOver("ended"));
  document.querySelector("#introSkip")?.addEventListener("click", () => handOver("skip"));
  // never strand the user on a black screen if the file 404s or the codec fails
  video.addEventListener("error", () => handOver("video-error"));
  setTimeout(() => handOver("timeout-14s"), 14000); // hard backstop

  const sound = document.querySelector("#introSound");
  const paintSound = () => {
    if (!sound) return;
    sound.textContent = video.muted ? "🔇" : "🔊";
    sound.setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
    sound.classList.toggle("needs-tap", video.muted);
  };
  sound?.addEventListener("click", () => {
    video.muted = !video.muted;
    if (!video.muted) video.volume = 1;
    paintSound();
  });

  // Sound is the DEFAULT. Browsers block unmuted autoplay unless this visitor has
  // built up enough engagement with the site, so ask for it and only fall back if
  // refused -- setting muted=false unconditionally would stop the film playing at
  // all, which is worse than starting quiet.
  video.muted = false;
  video.volume = 1;
  paintSound();
  // ?forceblock=1 simulates a browser refusing unmuted autoplay. Chrome allows it
  // once an origin has media engagement, so on a machine that has loaded this site
  // a few times the fallback stops reproducing -- which is exactly when it breaks
  // for a first-time visitor.
  const blocked = queryParams.get("forceblock") === "1";
  (blocked ? Promise.reject(new Error("forced")) : video.play()).then(paintSound).catch(() => {
    // Chrome/Safari refuse unmuted autoplay until this origin has earned enough
    // media engagement, and that cannot be overridden from script. Start muted
    // (the only permitted kind) so the film still opens the site...
    video.muted = true;
    paintSound();

    // A real invitation, not just a small pulsing icon in the corner.
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "intro-sound-hint";
    hint.innerHTML = `<span class="ish-icon">🔊</span><span>Tap for sound</span>`;
    stage.appendChild(hint);

    // If even the muted retry is refused (a transient abort, or a strict policy),
    // do NOT hand over -- skipping the film entirely over a sound problem is far
    // worse. The prompt becomes the way in instead, and since a tap is a real
    // gesture it is guaranteed to play WITH sound. The 14s backstop still covers
    // a genuinely dead file.
    video.play().catch(() => {
      hint.innerHTML = `<span class="ish-icon">▶</span><span>Tap to play with sound</span>`;
    });

    // The first gesture ANYWHERE counts as consent. Rewind rather than unmuting
    // mid-film: the humming is in the opening seconds, so unmuting in place
    // would hand over silence and defeat the point.
    const enableSound = () => {
      if (handedOver) return;
      video.muted = false;
      video.volume = 1;
      if (video.currentTime > 0.4) video.currentTime = 0;
      video.play().catch(() => {});
      paintSound();
      hint.remove();
    };
    hint.addEventListener("click", (e) => { e.stopPropagation(); enableSound(); });
    ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, enableSound, { once: true, passive: true })
    );
  });
  return true;
}

function initLandingPage() {
  if (sessionRole !== "landing") return;
  document.body.classList.add("clinician-mode"); // hides all sim overlays
  child.visible = false;
  const page = document.querySelector("#landingPage");
  if (!page) return;
  if (!playIntroFilm()) {
    page.style.display = "flex";
    setTimeout(dismissSplashScreen, 1200);
  }

  // load the open, conflict-free session times as a TAP-TO-PICK week calendar
  (async () => {
    const box = document.querySelector("#regSlots");
    try {
      const res = await fetch(`${API_BASE}/api/register/options`);
      const data = await res.json();
      const slots = data.slots || [];
      if (!slots.length) { box.textContent = "No open times right now — please check back soon."; return; }

      // index available slots by day+hour
      const byKey = {};
      slots.forEach((s) => { byKey[`${s.start.slice(0, 10)}|${new Date(s.start).getHours()}`] = s; });
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      const days = [];
      for (let i = 1; i <= 14; i++) days.push(new Date(base.getTime() + i * 864e5));
      const hours = [...new Set(slots.map((s) => new Date(s.start).getHours()))].sort((a, b) => a - b);
      const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      box.innerHTML = [days.slice(0, 7), days.slice(7, 14)].map((wk, wi) => {
        const head = wk.map((d) =>
          `<div class="cal-day-head">${d.toLocaleDateString("en-US", { weekday: "short" })}<b>${d.getDate()}</b></div>`
        ).join("");
        const rows = hours.map((h) => wk.map((d) => {
          const s = byKey[`${dayKey(d)}|${h}`];
          const hl = `${((h + 11) % 12) + 1}${h >= 12 ? "pm" : "am"}`;
          return s
            ? `<div class="reg-cal-cell open" data-slot='${JSON.stringify(s)}' title="${s.label}">${hl}</div>`
            : `<div class="reg-cal-cell" aria-hidden="true"></div>`;
        }).join("")).join("");
        return `<div class="cal-week-label">Week ${wi + 1}</div><div class="cal-grid reg-cal">${head}${rows}</div>`;
      }).join("") + `<p class="cal-picked" id="regPicked">Tap up to 3 highlighted times.</p>`;

      // tap-to-select, max 3, with a live summary of the picks
      box.addEventListener("click", (e) => {
        const cell = e.target.closest(".reg-cal-cell.open");
        if (!cell) return;
        const selected = box.querySelectorAll(".reg-cal-cell.selected");
        if (!cell.classList.contains("selected") && selected.length >= 3) return;
        cell.classList.toggle("selected");
        const picks = [...box.querySelectorAll(".reg-cal-cell.selected")].map((c) => JSON.parse(c.dataset.slot));
        document.querySelector("#regPicked").textContent = picks.length
          ? "Selected: " + picks.map((p) => p.label).join("  ·  ")
          : "Tap up to 3 highlighted times.";
      });
    } catch {
      box.textContent = "Could not load available dates (is the backend running?).";
    }
  })();

  // The console's dropdowns are custom glass ones; the landing page's was left as
  // a bare native select, so the two screens looked like different products.
  convertSelectToCustom("regAge");

  // parent registration
  document.querySelector("#regSubmit").addEventListener("click", async () => {
    const name = document.querySelector("#regName").value.trim();
    const email = document.querySelector("#regEmail").value.trim();
    const age = parseInt(document.querySelector("#regAge").value, 10);
    const situation = document.querySelector("#regSituation")?.value.trim() || "";
    const esl = !!document.querySelector("#regEsl")?.checked;
    const picks = [...document.querySelectorAll("#regSlots .reg-cal-cell.selected")].map((c) => JSON.parse(c.dataset.slot));
    const msg = document.querySelector("#regMsg");
    if (!name || !email.includes("@")) { msg.textContent = "Please enter your name and a valid email."; return; }
    if (!picks.length) { msg.textContent = "Please pick at least one session time."; return; }
    msg.textContent = "Submitting your enrollment...";
    try {
      const res = await fetch(`${API_BASE}/api/register/parent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, child_age: age, slots: picks, situation, esl }),
      });
      const data = await res.json();
      msg.textContent = data.message || "Registered.";
      if (data.status === "registered") {
        document.querySelector("#statusEmail").value = email;
        // carry the ESL preference into the simulation on this device
        localStorage.setItem("DIGICHILD_ESL", esl ? "1" : "0");
      }
    } catch {
      msg.textContent = "Could not reach the enrollment service. Please try again.";
    }
  });

  // enrollment status check (demo-mode mirror of the email)
  document.querySelector("#statusCheck").addEventListener("click", async () => {
    const email = document.querySelector("#statusEmail").value.trim();
    const msg = document.querySelector("#statusMsg");
    if (!email.includes("@")) { msg.textContent = "Enter the email you registered with."; return; }
    msg.textContent = "Checking...";
    try {
      const res = await fetch(`${API_BASE}/api/register/status?email=${encodeURIComponent(email)}`);
      const d = await res.json();
      if (d.status === "not_found") msg.textContent = "No enrollment found for that email.";
      else if (d.launch_url || d.status === "live" || d.status === "live_paused") {
        const url = getSimulationLaunchUrl(d.sessionId); // always this site's own origin
        msg.innerHTML = `✅ Approved for <strong>${d.scheduled_time || "your session"}</strong> — check your email, or ` +
          `<a href="${url}" target="_blank" rel="noopener">launch your simulation now</a>.`;
      } else if (d.status === "scheduled") msg.textContent = `Approved and scheduled for ${d.scheduled_time}. Your launch email is on its way.`;
      else msg.textContent = "⏳ Your enrollment is awaiting case-manager approval. You'll get an email once approved.";
    } catch {
      msg.textContent = "Could not reach the enrollment service.";
    }
  });

  // case manager entry
  document.querySelector("#cmEnter").addEventListener("click", () => {
    const name = document.querySelector("#cmName").value.trim();
    const msg = document.querySelector("#cmMsg");
    if (!name) { msg.textContent = "Enter your name to continue."; return; }
    localStorage.setItem("DIGICHILD_CM_NAME", name);
    window.location.search = "?role=clinician";
  });
}

// The same film that opens the site sits far behind the console, heavily
// blurred and dimmed, so the two screens read as one space rather than two
// unrelated apps. Purely decorative: muted, looping, and non-interactive.
function mountConsoleFilm() {
  if (document.querySelector(".console-film")) return;
  const stage = document.createElement("div");
  stage.className = "console-film";
  stage.setAttribute("aria-hidden", "true");
  const v = document.createElement("video");
  v.src = "./assets/intro.mp4";
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute("poster", "./assets/intro-poster.jpg");
  stage.appendChild(v);
  document.body.appendChild(stage);
  v.play().catch(() => {});  // decoration only -- a refusal costs nothing
}

/* Clicking anywhere else closes any open dropdown. Registered once at module
   scope: it used to live inside initClinicianHub(), so it never ran on the
   landing page, and it only stripped the wrapper's class -- which would now
   strand a portaled list visible in <body> forever. It must call close(). */
document.addEventListener("click", () => {
  document.querySelectorAll(".custom-select-wrapper.open").forEach((w) => w.__closeSelect?.());
});

/* Glass dropdown used by BOTH the landing page and the console. It lived inside
   initClinicianHub(), which returns early unless role=clinician -- so the landing
   page could never reach it and its age select stayed an unstyled native one. */
const convertSelectToCustom = (selectId) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    if (select.dataset.customised === "1") return;  // idempotent: never build twice
    select.dataset.customised = "1";
    select.style.display = "none";

    const wrapper = document.createElement("div");
    wrapper.className = "custom-select-wrapper";

    // The trigger must be reachable and operable WITHOUT a mouse. It was a bare
    // <div>: tabIndex -1, no role, so keyboard and screen-reader users could not
    // open these dropdowns at all -- and one of them sets the child's age band.
    const trigger = document.createElement("div");
    trigger.className = "custom-select-trigger";
    trigger.tabIndex = 0;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const label = document.querySelector(`label[for="${selectId}"]`)
      || select.previousElementSibling;
    if (label && label.tagName === "LABEL") {
      if (!label.id) label.id = `${selectId}-label`;
      trigger.setAttribute("aria-labelledby", label.id);
    } else {
      trigger.setAttribute("aria-label", select.getAttribute("aria-label") || selectId);
    }

    const triggerText = document.createElement("span");
    const selectedOption = select.options[select.selectedIndex];
    triggerText.textContent = selectedOption ? selectedOption.textContent : "";
    trigger.appendChild(triggerText);
    const arrow = document.createElement("div");
    arrow.className = "arrow";
    trigger.appendChild(arrow);
    wrapper.appendChild(trigger);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "custom-options-container";
    optionsContainer.setAttribute("role", "listbox");
    optionsContainer.id = `${selectId}-listbox`;
    trigger.setAttribute("aria-controls", optionsContainer.id);

    const optionEls = [];
    const choose = (optDiv, opt) => {
      optionsContainer.querySelectorAll(".custom-option").forEach((el) => {
        el.classList.remove("selected");
        el.setAttribute("aria-selected", "false");
      });
      optDiv.classList.add("selected");
      optDiv.setAttribute("aria-selected", "true");
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      triggerText.textContent = opt.textContent;
      close();
      trigger.focus();
    };

    Array.from(select.options).forEach((opt, idx) => {
      const optDiv = document.createElement("div");
      optDiv.className = "custom-option";
      optDiv.setAttribute("role", "option");
      optDiv.id = `${selectId}-opt-${idx}`;
      const isSel = idx === select.selectedIndex;
      if (isSel) optDiv.classList.add("selected");
      optDiv.setAttribute("aria-selected", isSel ? "true" : "false");
      optDiv.textContent = opt.textContent;
      optDiv.dataset.value = opt.value;
      optDiv.addEventListener("click", (e) => { e.stopPropagation(); choose(optDiv, opt); });
      optionsContainer.appendChild(optDiv);
      optionEls.push(optDiv);
    });

    wrapper.appendChild(optionsContainer);
    select.parentNode.insertBefore(wrapper, select.nextSibling);

    let active = Math.max(0, select.selectedIndex);
    const markActive = (i) => {
      active = (i + optionEls.length) % optionEls.length;
      optionEls.forEach((el, n) => el.classList.toggle("active", n === active));
      trigger.setAttribute("aria-activedescendant", optionEls[active].id);
      optionEls[active].scrollIntoView({ block: "nearest" });
    };
    // The open list has to leave the card entirely.
    // It sits inside three nested scroll containers (.panel-col, .hub-viewport,
    // .clinician-hub-body all clip), so an absolutely-positioned list is simply
    // cut off -- no z-index escapes an overflow clip. position:fixed does not help
    // either, because the card's backdrop-filter makes it the containing block for
    // fixed descendants. So while open we PORTAL it to <body> and place it by the
    // trigger's viewport rect, then put it back on close.
    const place = () => {
      const r = trigger.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const h = Math.min(optionsContainer.scrollHeight, 200);
      const flip = below < h + 12 && r.top > below; // not enough room: open upward
      optionsContainer.style.left = `${r.left}px`;
      optionsContainer.style.width = `${r.width}px`;
      optionsContainer.style.top = flip ? `${r.top - h - 4}px` : `${r.bottom + 4}px`;
    };

    const closeAll = () => {
      document.querySelectorAll(".custom-select-wrapper.open").forEach((w) => {
        if (w !== wrapper) w.__closeSelect?.();
      });
    };

    const open = () => {
      closeAll();
      document.body.appendChild(optionsContainer);   // escape every clip
      optionsContainer.classList.add("portaled", "is-open");
      wrapper.classList.add("open");
      place();
      trigger.setAttribute("aria-expanded", "true");
      markActive(Math.max(0, select.selectedIndex));
      // markActive() scrollIntoView()s the active row, which can nudge a scroll
      // container and move the trigger out from under the list -- re-place once
      // layout has settled.
      requestAnimationFrame(place);
      window.addEventListener("scroll", place, true);  // follow the trigger
      window.addEventListener("resize", place);
    };

    const close = () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      optionsContainer.classList.remove("portaled", "is-open");
      optionsContainer.removeAttribute("style");
      if (optionsContainer.parentNode !== wrapper) wrapper.appendChild(optionsContainer);
      wrapper.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
    };
    wrapper.__closeSelect = close;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      wrapper.classList.contains("open") ? close() : open();
    });

    trigger.addEventListener("keydown", (e) => {
      const isOpen = wrapper.classList.contains("open");
      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          isOpen ? choose(optionEls[active], select.options[active]) : open();
          break;
        case "ArrowDown":
          e.preventDefault();
          isOpen ? markActive(active + 1) : open();
          break;
        case "ArrowUp":
          e.preventDefault();
          isOpen ? markActive(active - 1) : open();
          break;
        case "Home":
          if (isOpen) { e.preventDefault(); markActive(0); }
          break;
        case "End":
          if (isOpen) { e.preventDefault(); markActive(optionEls.length - 1); }
          break;
        case "Escape":
          if (isOpen) { e.preventDefault(); close(); }
          break;
        case "Tab":
          close();
          break;
      }
    });
  };

function initClinicianHub() {
  if (sessionRole !== "clinician") return;
  document.body.classList.add("clinician-mode");
  mountConsoleFilm();
  clinicianHub.style.display = "flex";
  child.visible = false;

  // In clinician dashboard mode, fade out the splash screen after 1.5 seconds
  setTimeout(dismissSplashScreen, 1500);
  
  // Render hub layout with left sidebar tabs
  clinicianHub.innerHTML = `
    <div class="clinician-hub-header">
      <h2>Clinician Control Hub</h2>
      <span class="clinician-badge">Case Manager Console</span>
    </div>
    
    <div class="clinician-hub-body">
      <!-- Left Sidebar Navigation -->
      <div class="hub-sidebar">
        <div class="sidebar-menu">
          <button class="sidebar-tab-btn active" data-tab="schedule">
            <svg class="nav-svg-icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <span class="tab-label">Setup & Schedule</span>
          </button>
          <button class="sidebar-tab-btn" data-tab="approvals">
            <svg class="nav-svg-icon" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M9 14l2 2 4-4"></path></svg>
            <span class="tab-label">Case Approvals</span>
            <span class="badge" id="cApprovalCountBadge" style="display:none;">0</span>
          </button>
          <button class="sidebar-tab-btn" data-tab="monitor">
            <svg class="nav-svg-icon" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line><path d="M6 10h2l2-3 2 6 2-3h2"></path></svg>
            <span class="tab-label">Active Monitor</span>
            <span class="active-dot" id="cActiveMonitorDot" style="display:none;"></span>
          </button>
          <button class="sidebar-tab-btn" data-tab="analytics">
            <svg class="nav-svg-icon" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line><path d="M3 3v18h18"></path></svg>
            <span class="tab-label">Case Analytics</span>
          </button>
        </div>
        <div class="sidebar-footer">
          <div style="margin-bottom:4px;">System Mode: <strong style="color:var(--teal)">Clinical Portal</strong></div>
          <div>Service status: <span style="color:#22c55e">● Online</span></div>
        </div>
      </div>

      <!-- Right Content Viewport -->
      <div class="hub-viewport">
        <!-- Panel 1: Setup & Schedule -->
        <div id="panel-schedule" class="hub-panel active">
          <div class="panel-grid">
            <div class="panel-col">
              <div class="section">
                <span class="section-title">New Session Setup</span>
                
                <label>Parent ID</label>
                <input type="text" id="cParentId" placeholder="Parent ID" value="parent_test" />
                
                <label>Clinician ID</label>
                <input type="text" id="cClinicianId" placeholder="Clinician ID" value="clinician_naquan" />
                
                <label>Court Monitor ID</label>
                <input type="text" id="cMonitorId" placeholder="Court Monitor ID" value="monitor_jimmy" />
                
                <label>Child Personality Profile</label>
                <select id="cTemperamentProfile">
                  <option value="cooperative">Cooperative (Trust: 80, Volatility: 10)</option>
                  <option value="oppositional" selected>Oppositional (Trust: 40, Volatility: 75)</option>
                  <option value="withdrawn">Withdrawn (Trust: 30, Volatility: 25)</option>
                </select>

                <label>Child Age / Developmental Stage</label>
                <select id="cChildAge">
                  <option value="5">Early childhood (Age 5-7, Year 05)</option>
                  <option value="11">Pre-teen (Age 10-12, Year 11)</option>
                  <option value="15">Adolescent (Age 14-16, Year 15)</option>
                </select>
              </div>

              <div class="section">
                <span class="section-title">Parent Intake Raw Text</span>
                <label>Availability Description</label>
                <textarea id="cParentRawText" rows="3" placeholder="I can only make it next Tuesday morning after 9 AM or Thursday between 1 and 3 PM."></textarea>
                <button id="cProposeBtn">Propose Session</button>
              </div>
            </div>

            <div class="panel-col">
              <div class="section">
                <span class="section-title">Session List & Status</span>
                <div id="cSessionList">Loading sessions...</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Panel 2: Case Approvals -->
        <div id="panel-approvals" class="hub-panel">
          <div class="panel-col" style="max-width: 600px; margin: 0 auto;">
            <!-- Agent 1 Intake Checkpoint Card -->
            <div id="cAgent1Card" class="approval-card" style="display: none;"></div>

            <!-- Agent 2 Provision Success Card -->
            <div id="cAgent2Card" class="provision-card" style="display: none;"></div>
            
            <div id="cNoApprovalsPlaceholder" style="text-align: center; padding: 40px 20px; color: rgba(255,255,255,0.4);">
              <span style="font-size: 40px; display: block; margin-bottom: 12px;">⚖️</span>
              <strong>No Active Intake Reviews</strong>
              <p style="font-size: 11px; margin-top: 6px;">Propose a new session in the Setup tab or click "Review & Approve" on an awaiting-approval session in the list.</p>
            </div>
          </div>
        </div>

        <!-- Panel 3: Active Monitor -->
        <div id="panel-monitor" class="hub-panel">
          <div class="panel-grid">
            <div class="panel-col">
              <div id="cLiveControls" class="section" style="display: none;">
                <span class="section-title">Active Session Controls</span>
                <label>Active Session: <strong id="cActiveSessionLabel">None</strong></label>
                <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                  <button id="cPauseBtn" class="btn-secondary">Pause</button>
                  <button id="cResumeBtn" class="btn-secondary" style="display:none;">Resume</button>
                  <button id="cCompleteBtn" class="btn-danger">Complete</button>
                </div>
                <button id="cDownloadReportBtn" class="btn-secondary" style="margin-bottom:12px;">Download Session Report</button>
                
                <!-- Live Progress Gauges -->
                <div class="live-metrics-panel">
                  <label>Live Metrics & Telemetry</label>
                  <div class="metric-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <span>Trust Level: <strong id="cMetricTrust">0</strong>%</span>
                    <div class="live-metric-bar"><div id="cMetricTrustFill" class="live-metric-fill" style="width: 0%; background: var(--teal);"></div></div>
                  </div>
                  <div class="metric-row" style="flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 10px;">
                    <span>Volatility: <strong id="cMetricVol">0</strong>%</span>
                    <div class="live-metric-bar"><div id="cMetricVolFill" class="live-metric-fill" style="width: 0%; background: var(--warm);"></div></div>
                  </div>
                  <div class="metric-row" style="margin-top: 12px; justify-content: space-between; font-size:11px;">
                    <span>Mistreatments: <strong id="cMetricMistreat" style="color: #ef4444;">0</strong></span>
                    <span>Temperament: <strong id="cMetricTemp" style="text-transform: uppercase;">neutral</strong></span>
                  </div>
                </div>

                <!-- Live De-Escalation Advisor Feed (grounded in the ten-book library) -->
                <div class="section" id="cAdviceSection" style="margin-top: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px;">
                  <span class="section-title" style="font-size: 11px; margin-bottom: 6px;">Live Clinical Advisor</span>
                  <div class="clinical-tip" id="cLiveAdviceBox" style="background: rgba(23, 143, 134, 0.06); border-color: rgba(23, 143, 134, 0.2); margin-bottom: 0;">
                    <span class="icon" id="cLiveAdviceIcon" style="display:flex; align-items:center;"><svg class="header-svg-icon" style="margin-right:0;" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .6 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><line x1="9" y1="18" x2="15" y2="18"></line><line x1="10" y1="22" x2="14" y2="22"></line></svg></span>
                    <p id="cLiveAdviceText" style="font-size: 11px;">Awaiting active simulation message...</p>
                  </div>
                  <p id="cAdviceCitation" style="font-size: 10px; color: rgba(255,255,255,0.45); margin: 6px 0 0;"></p>
                </div>

                <!-- Parent situation (understood by Agent 1 at intake) -->
                <div class="section" id="cSituationSection" style="display:none; margin-top: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px;">
                  <span class="section-title" style="font-size: 11px; margin-bottom: 6px;">Parent Situation</span>
                  <p id="cSituationText" style="font-size: 11px; margin: 0;"></p>
                </div>

                <!-- Tone & voice flags: incongruence, ESL checks, clarifications -->
                <div class="section" id="cToneFlagsSection" style="margin-top: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px;">
                  <span class="section-title" style="font-size: 11px; margin-bottom: 6px;">Tone &amp; Voice Flags <span id="cToneFlagCount" class="badge" style="display:none;">0</span></span>
                  <div id="cToneFlagsBox" style="max-height: 160px; overflow-y: auto;">
                    <p style="font-size: 11px; color: rgba(255,255,255,0.4); margin: 0;">No vocal flags this session.</p>
                  </div>
                </div>
              </div>
              <div id="cNoMonitorPlaceholder" style="text-align: center; padding: 40px 20px; color: rgba(255,255,255,0.4);">
                <span style="font-size: 40px; display: block; margin-bottom: 12px;">🖥️</span>
                <strong>No Active Session Monitored</strong>
                <p style="font-size: 11px; margin-top: 6px;">Select an active or scheduled session from the setup list and click "Monitor" to load controls.</p>
              </div>
            </div>
            
            <div class="panel-col">
              <div class="section" id="cAuditSection" style="display: none; height: 100%;">
                <span class="section-title">Interaction History Log</span>
                <div id="cAuditLogBox" class="audit-log-box" style="max-height: 400px; height: 350px;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Panel 4: Case Analytics -->
        <div id="panel-analytics" class="hub-panel">
          <div class="analytics-grid">
            <div class="analytics-stat-card">
              <span class="label">Total Evaluated Cases</span>
              <div class="val">14 Cases</div>
              <div class="trend text-green">↑ +18% this month</div>
            </div>
            <div class="analytics-stat-card">
              <span class="label">Avg De-escalation Rate</span>
              <div class="val">91.4%</div>
              <div class="trend text-green">↑ +2.1% improvement</div>
            </div>
            <div class="analytics-stat-card">
              <span class="label">Transgression Incidents</span>
              <div class="val">1 Case</div>
              <div class="trend text-red">↓ -50% decline</div>
            </div>
            <div class="analytics-stat-card">
              <span class="label">Active Sandboxes</span>
              <div class="val">3 Live</div>
              <div class="trend text-green">● Stable performance</div>
            </div>
          </div>

          <div class="analytics-row">
            <div class="analytics-chart-box">
              <span class="section-title">Case Breakdown by Temperament Profile</span>
              <div class="chart-bar-container">
                <div class="chart-bar-row">
                  <span class="chart-bar-label">Cooperative</span>
                  <div class="chart-bar-wrapper"><div class="chart-bar-fill" style="width: 45%;"></div></div>
                  <span class="chart-bar-val">45%</span>
                </div>
                <div class="chart-bar-row">
                  <span class="chart-bar-label">Oppositional</span>
                  <div class="chart-bar-wrapper"><div class="chart-bar-fill" style="width: 35%; background: var(--warm)"></div></div>
                  <span class="chart-bar-val">35%</span>
                </div>
                <div class="chart-bar-row">
                  <span class="chart-bar-label">Withdrawn</span>
                  <div class="chart-bar-wrapper"><div class="chart-bar-fill" style="width: 20%; background: #94a3b8"></div></div>
                  <span class="chart-bar-val">20%</span>
                </div>
              </div>
            </div>

            <div class="analytics-chart-box">
              <span class="section-title">Clinical AI Insights</span>
              <div style="margin-top: 10px;">
                <div class="clinical-tip">
                  <span class="icon" style="display:flex; align-items:center;"><svg class="header-svg-icon" style="margin-right:0;" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .6 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><line x1="9" y1="18" x2="15" y2="18"></line><line x1="10" y1="22" x2="14" y2="22"></line></svg></span>
                  <p><strong>De-escalation Strategy:</strong> Offering parent options (autonomy) reduces opposition volatility by ~30% in high-resistance stages.</p>
                </div>
                <div class="clinical-tip">
                  <span class="icon" style="display:flex; align-items:center;"><svg class="header-svg-icon" style="margin-right:0;" viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"></path><path d="M12 6v6l4 2"></path></svg></span>
                  <p><strong>Case Checkpoint:</strong> Ensure the Court Monitor's active availability streams are checked prior to finalizing the scheduled slot.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent outcomes evaluation log table -->
          <div class="section" style="margin-top: 16px;">
            <span class="section-title">Recent Evaluation Logs</span>
            <div style="overflow-x: auto;">
              <table class="analytics-table" style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px;">
                <thead>
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); text-align: left; color: rgba(255,255,255,0.5);">
                    <th style="padding: 8px 4px;">Case ID</th>
                    <th style="padding: 8px 4px;">Stage</th>
                    <th style="padding: 8px 4px;">Temperament</th>
                    <th style="padding: 8px 4px;">De-escalation Rate</th>
                    <th style="padding: 8px 4px;">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 6px 4px; font-family: monospace;">#f19a2e12</td>
                    <td style="padding: 6px 4px;">Child (Age 5)</td>
                    <td style="padding: 6px 4px; color: var(--warm)">Oppositional</td>
                    <td style="padding: 6px 4px; font-weight: bold;">88.5%</td>
                    <td style="padding: 6px 4px;"><span class="badge-green">✅ Certified</span></td>
                  </tr>
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 6px 4px; font-family: monospace;">#b88231aa</td>
                    <td style="padding: 6px 4px;">Teenager (Age 11)</td>
                    <td style="padding: 6px 4px; color: #94a3b8">Withdrawn</td>
                    <td style="padding: 6px 4px; font-weight: bold;">92.0%</td>
                    <td style="padding: 6px 4px;"><span class="badge-green">✅ Certified</span></td>
                  </tr>
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 6px 4px; font-family: monospace;">#e390ff45</td>
                    <td style="padding: 6px 4px;">Adult (Age 15)</td>
                    <td style="padding: 6px 4px; color: var(--warm)">Oppositional</td>
                    <td style="padding: 6px 4px; font-weight: bold;">74.2%</td>
                    <td style="padding: 6px 4px;"><span class="badge-red">⚠️ Intervention</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Tab navigation switching logic
  const tabButtons = clinicianHub.querySelectorAll(".sidebar-tab-btn");
  const panels = clinicianHub.querySelectorAll(".hub-panel");

  window.switchClinicianTab = (tabName) => {
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    panels.forEach(p => {
      if (p.id === `panel-${tabName}`) {
        p.classList.add("active");
      } else {
        p.classList.remove("active");
      }
    });
  };

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      window.switchClinicianTab(btn.dataset.tab);
    });
  });

  // Bind Propose / Intake Click
  document.querySelector("#cProposeBtn").addEventListener("click", async () => {
    const proposeBtn = document.querySelector("#cProposeBtn");
    const rawText = document.querySelector("#cParentRawText").value || "I can only make it next Tuesday morning after 9 AM or Thursday between 1 and 3 PM.";
    
    proposeBtn.disabled = true;
    proposeBtn.textContent = "Processing Intake (Agent 1)...";
    
    // Clear previous cards
    document.querySelector("#cAgent1Card").style.display = "none";
    document.querySelector("#cAgent2Card").style.display = "none";

    // Mock calendar streams: realistic, varied availability over the NEXT 14
    // days (weekdays only), so the week grid looks like a real calendar and
    // always has future overlap to propose. Live Google Calendar replaces
    // these on the backend when GOOGLE_CALENDAR_ENABLED is set.
    const pad = (n) => String(n).padStart(2, "0");
    const dayISO = (d, h) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:00:00`;
    const clinicianAvail = [];
    const monitorAvail = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 1; i <= 14; i++) {
      const d = new Date(base.getTime() + i * 864e5);
      if (d.getDay() === 0 || d.getDay() === 6) continue; // weekends off
      // clinician: mornings most days, full day on Tue/Thu
      if (d.getDay() === 2 || d.getDay() === 4) {
        clinicianAvail.push({ start: dayISO(d, 9), end: dayISO(d, 17) });
      } else {
        clinicianAvail.push({ start: dayISO(d, 9), end: dayISO(d, 12) });
      }
      // court monitor: late mornings/afternoons, off on Fridays
      if (d.getDay() !== 5) {
        monitorAvail.push({ start: dayISO(d, 10), end: dayISO(d, 15) });
      }
    }

    try {
      // Step 1: Create the session
      const createRes = await fetch(`${API_BASE}/api/schedule/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_id: document.querySelector("#cParentId").value,
          clinician_id: document.querySelector("#cClinicianId").value,
          monitor_id: document.querySelector("#cMonitorId").value,
          clinician_avail: clinicianAvail,
          monitor_avail: monitorAvail,
          temperament_profile: document.querySelector("#cTemperamentProfile").value,
          child_age: parseInt(document.querySelector("#cChildAge").value, 10)
        })
      });
      const createData = await createRes.json();
      const sessionId = createData.sessionId;

      // Step 2: Call Agent 1 Intake
      const intakeRes = await fetch(`${API_BASE}/api/agent1/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          raw_text: rawText
        })
      });
      
      const intakeData = await intakeRes.json();
      // /api/agent1/intake wraps the card ({status, checkpoint, card}); unwrap it
      renderAgent1ApprovalCard(sessionId, intakeData.card || intakeData);
      refreshSessionList();
    } catch (e) {
      console.error(e);
      alert("Error processing intake. Make sure uvicorn backend is running!");
    } finally {
      proposeBtn.disabled = false;
      proposeBtn.textContent = "Propose Session";
    }
  });

  // Bind controls
  document.querySelector("#cPauseBtn").addEventListener("click", () => sendControlAction("pause"));
  document.querySelector("#cResumeBtn").addEventListener("click", () => sendControlAction("resume"));
  document.querySelector("#cCompleteBtn").addEventListener("click", () => sendControlAction("complete"));

  // Bind report download
  document.querySelector("#cDownloadReportBtn").addEventListener("click", async () => {
    if (!selectedClinicianSession) return;
    try {
      const res = await fetch(`${API_BASE}/api/session/report?sessionId=${selectedClinicianSession.session_id}`);
      if (res.ok) {
        const result = await res.json();
        const blob = new Blob([result.reportText], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `clinical_session_report_${selectedClinicianSession.session_id}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (e) {
      console.error(e);
    }
  });

  // Convert native selects to glassmorphic dropdowns


  convertSelectToCustom("cTemperamentProfile");
  convertSelectToCustom("cChildAge");

  // Start polling session list
  setInterval(refreshSessionList, 2000);
  refreshSessionList();
}

async function sendControlAction(action) {
  if (!selectedClinicianSession) return;
  try {
    await fetch(`${API_BASE}/api/session/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: selectedClinicianSession.session_id,
        action: action
      })
    });
    refreshSessionList();
  } catch (e) {
    console.error(e);
  }
}

async function refreshSessionList() {
  try {
    const res = await fetch(`${API_BASE}/api/schedule/sessions`);
    if (!res.ok) return;
    const data = await res.json();
    const listEl = document.querySelector("#cSessionList");
    
    listEl.innerHTML = data.sessions.map(s => `
      <div class="session-list-item">
        <div class="meta">
          <strong>ID: ${s.session_id}</strong>
          <span class="status ${s.status}">${s.status}</span>
        </div>
        <div>Parent: ${s.parent_id}</div>
        <div>Time: ${s.scheduled_time || "Not matched yet"}</div>
        ${s.status === "awaiting_approval" ? `<button class="btn-action" onclick="window.__reviewSession('${s.session_id}')" style="background:var(--warm);">Review & Approve</button>` : ""}
        ${s.status === "scheduled" ? `<button class="btn-action" onclick="window.__provisionSession('${s.session_id}')">Launch Sim</button>` : ""}
        <button class="btn-action btn-secondary" onclick="window.__selectSession('${s.session_id}')">Monitor</button>
      </div>
    `).join("");
  } catch (e) {
    console.error(e);
  }
}

window.__reviewSession = async (sid) => {
  try {
    const res = await fetch(`${API_BASE}/api/agent1/review?sessionId=${sid}`);
    if (!res.ok) {
      alert("Could not load session proposal.");
      return;
    }
    const data = await res.json();
    if (data.status === "error") {
      alert(data.message);
      return;
    }
    renderAgent1ApprovalCard(sid, data);
  } catch (e) {
    console.error(e);
    alert("Error loading approval card.");
  }
};

window.__provisionSession = async (sid) => {
  try {
    const res = await fetch(`${API_BASE}/api/session/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid, action: "provision" })
    });
    if (res.ok) {
      alert("Session launched! Redirecting to parent view...");
      window.__openSimulationSession(sid);
      window.__selectSession(sid);
    }
  } catch (e) {
    console.error(e);
  }
};

window.__selectSession = async (sid) => {
  try {
    const res = await fetch(`${API_BASE}/api/session/status?sessionId=${sid}`);
    if (res.ok) {
      const data = await res.json();
      selectedClinicianSession = { session_id: sid, ...data };
      
      document.querySelector("#cLiveControls").style.display = "block";
      document.querySelector("#cActiveSessionLabel").textContent = sid;
      
      // Update placeholders and navigation tabs
      const monPlaceholder = document.querySelector("#cNoMonitorPlaceholder");
      if (monPlaceholder) monPlaceholder.style.display = "none";
      const auditSec = document.querySelector("#cAuditSection");
      if (auditSec) auditSec.style.display = "block";
      const dot = document.querySelector("#cActiveMonitorDot");
      if (dot) dot.style.display = "inline-block";
      if (window.switchClinicianTab) window.switchClinicianTab("monitor");

      // Update buttons
      if (data.paused) {
        document.querySelector("#cPauseBtn").style.display = "none";
        document.querySelector("#cResumeBtn").style.display = "block";
      } else {
        document.querySelector("#cPauseBtn").style.display = "block";
        document.querySelector("#cResumeBtn").style.display = "none";
      }
      
      // Update metrics
      document.querySelector("#cMetricTrust").textContent = data.metrics.trust;
      document.querySelector("#cMetricVol").textContent = data.metrics.volatility;
      document.querySelector("#cMetricMistreat").textContent = data.metrics.consecutive_mistreatments || 0;
      const tempEl = document.querySelector("#cMetricTemp");
      tempEl.textContent = data.metrics.temperament;
      if (data.metrics.temperament === "secure") {
        tempEl.className = "text-green";
      } else if (data.metrics.temperament === "transgressed") {
        tempEl.className = "text-red";
      } else {
        tempEl.className = "";
      }

      // Update progress bar fills
      const trustFill = document.querySelector("#cMetricTrustFill");
      if (trustFill) trustFill.style.width = `${data.metrics.trust}%`;
      const volFill = document.querySelector("#cMetricVolFill");
      if (volFill) volFill.style.width = `${data.metrics.volatility}%`;

      // Live Clinical Advisor: consultation generated from the actual session
      // telemetry, grounded in the ten-book library (Claude, or the
      // rule-based book-citing fallback in demo mode)
      const adviceText = document.querySelector("#cLiveAdviceText");
      const adviceBox = document.querySelector("#cLiveAdviceBox");
      const adviceIcon = document.querySelector("#cLiveAdviceIcon");
      const adviceCite = document.querySelector("#cAdviceCitation");
      if (adviceText && adviceBox && adviceIcon) {
        const adv = data.advice || {};
        const risk = adv.risk || (data.metrics.temperament === "transgressed" ? "high" : "low");
        const label = risk === "high" ? "⚠️ HIGH RISK" : risk === "elevated" ? "🟠 ELEVATED" : "✅ STEADY";
        adviceText.innerHTML = `<strong>${label}:</strong> ${adv.advice || "Awaiting first interaction..."}`;
        if (adviceCite) adviceCite.textContent = adv.framework_cited
          ? `📚 Grounded in: ${adv.framework_cited}${adv.source === "claude" ? " · live AI consult" : ""}` : "";
        if (risk === "high") {
          adviceBox.style.background = "rgba(239, 68, 68, 0.08)";
          adviceBox.style.borderColor = "rgba(239, 68, 68, 0.25)";
          adviceIcon.innerHTML = `<svg class="header-svg-icon" style="stroke:#ef4444; filter:drop-shadow(0 0 4px rgba(239,68,68,0.5)); margin-right:0;" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"></path></svg>`;
        } else if (risk === "elevated") {
          adviceBox.style.background = "rgba(217, 134, 50, 0.08)";
          adviceBox.style.borderColor = "rgba(217, 134, 50, 0.3)";
          adviceIcon.innerHTML = `<svg class="header-svg-icon" style="stroke:var(--warm); margin-right:0;" viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"></path><path d="M12 8v4M12 16h.01"></path></svg>`;
        } else {
          adviceBox.style.background = "rgba(23, 143, 134, 0.06)";
          adviceBox.style.borderColor = "rgba(23, 143, 134, 0.2)";
          adviceIcon.innerHTML = `<svg class="header-svg-icon" style="stroke:var(--teal); margin-right:0;" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .6 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><line x1="9" y1="18" x2="15" y2="18"></line><line x1="10" y1="22" x2="14" y2="22"></line></svg>`;
        }
      }

      // Parent situation (from Agent 1's intake understanding)
      const sitSection = document.querySelector("#cSituationSection");
      const sitText = document.querySelector("#cSituationText");
      const sit = data.parentSituation || {};
      if (sitSection && sitText && (sit.summary || data.esl)) {
        sitSection.style.display = "block";
        sitText.innerHTML = (sit.summary || "") +
          (data.esl ? `<br><span style="color:var(--teal);">🌐 English is a second language — tone monitor in lenient mode.</span>` : "");
      } else if (sitSection) {
        sitSection.style.display = "none";
      }

      // Tone & voice flags: what the monitor heard, plus the parent's own
      // clarifications, permanently on the record for this session
      const flagBox = document.querySelector("#cToneFlagsBox");
      const flagCount = document.querySelector("#cToneFlagCount");
      const flags = data.toneFlags || [];
      if (flagBox) {
        if (flags.length) {
          flagBox.innerHTML = flags.map(f => {
            const isClarify = f.treatment === "tone_clarification";
            const isGov = f.treatment === "governor_intercept";
            const cls = isClarify ? "clarify" : isGov ? "governor" : "flag";
            const icon = isClarify ? "💬" : isGov ? "🛑" : "⚠️";
            const title = isClarify ? "Parent clarification" : isGov ? "Governor intercept" : "Tone flag";
            const aggr = f.aggression ? ` · aggression ${(+f.aggression).toFixed(2)}` : "";
            return `<div class="tone-flag-line ${cls}">
              <strong>${icon} ${title}${aggr}</strong>
              <span>${f.note || f.parent || ""}</span>
            </div>`;
          }).join("");
          if (flagCount) {
            const scored = flags.filter(f => f.treatment !== "tone_clarification").length;
            flagCount.textContent = scored;
            flagCount.style.display = scored ? "inline-block" : "none";
          }
        } else {
          flagBox.innerHTML = `<p style="font-size: 11px; color: rgba(255,255,255,0.4); margin: 0;">No vocal flags this session.</p>`;
          if (flagCount) flagCount.style.display = "none";
        }
      }

      // Update audit logs (tone-flagged turns get a chip the case manager can see)
      const logBox = document.querySelector("#cAuditLogBox");
      logBox.innerHTML = data.history.map(h => {
        if (h.treatment === "tone_clarification") {
          return `<div class="audit-log-line clarify"><span class="speaker">💬 Parent clarification:</span> ${h.parent}</div>`;
        }
        const flagged = h.toneNote && (h.toneNote.includes("INCONGRUENT") || h.toneNote.includes("TONE CHECK") || h.toneNote.includes("tense undertone"));
        const chip = flagged ? `<span class="tone-flag-chip" title="${h.toneNote.replace(/"/g, "&quot;")}">⚠ tone</span>` : "";
        return `
        <div class="audit-log-line parent"><span class="speaker">Parent:</span> ${h.parent} ${chip}</div>
        <div class="audit-log-line"><span class="speaker">Mira:</span> ${h.mira}</div>`;
      }).join("");
      logBox.scrollTop = logBox.scrollHeight;
    }
  } catch (e) {
    console.error(e);
  }
};

// Film-style week calendar: everyone's availability as tiny colored bars in a
// 7-day grid, with the proposed conflict-free slots GLOWING orange.
function buildWeekCalendarHtml(cal, slots) {
  const days = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let d = 0; d < 7; d++) days.push(new Date(base.getTime() + d * 864e5));
  const inWin = (wins, cs, ce) => (wins || []).some((w) => new Date(w.start) < ce && new Date(w.end) > cs);
  const head = days.map((d) =>
    `<div class="cal-day-head">${d.toLocaleDateString("en-US", { weekday: "short" })}<b>${d.getDate()}</b></div>`
  ).join("");
  let rows = "";
  for (let h = 8; h < 20; h++) {
    rows += days.map((d) => {
      const cs = new Date(d); cs.setHours(h);
      const ce = new Date(d); ce.setHours(h + 1);
      const p = inWin(cal.parent, cs, ce);
      const c = inWin(cal.clinician, cs, ce);
      const m = inWin(cal.monitor, cs, ce);
      const glow = inWin(slots, cs, ce);
      const title = `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()} — ${h}:00`;
      return `<div class="cal-cell${glow ? " cal-glow" : ""}" title="${title}">` +
        (p ? '<i class="cb cb-p"></i>' : "") + (c ? '<i class="cb cb-c"></i>' : "") + (m ? '<i class="cb cb-m"></i>' : "") +
        `</div>`;
    }).join("");
  }
  return `<div class="cal-grid">${head}${rows}</div>
    <div class="cal-legend">
      <span><i class="cb cb-p"></i>Parent</span>
      <span><i class="cb cb-c"></i>Clinician</span>
      <span><i class="cb cb-m"></i>Monitor</span>
      <span><i class="cb cb-glow"></i>Proposed slot</span>
    </div>`;
}

function buildCaseManagerReviewHtml() {
  return `
    <div id="caseReviewPanel" class="case-review-panel" hidden>
      <div class="case-review-head">
        <span>Case Manager Review</span>
        <strong id="caseReviewStatus">Waiting for approval decision</strong>
      </div>
      <div class="case-review-steps">
        <div id="caseReviewStep1" class="case-review-step">
          <span class="case-review-dot"></span>
          <span class="case-review-copy">Review intake summary</span>
        </div>
        <div id="caseReviewStep2" class="case-review-step">
          <span class="case-review-dot"></span>
          <span class="case-review-copy">Check parent, clinician, and monitor availability</span>
        </div>
        <div id="caseReviewStep3" class="case-review-step">
          <span class="case-review-dot"></span>
          <span class="case-review-copy">Validate safety checkpoint and selected slot</span>
        </div>
        <div id="caseReviewStep4" class="case-review-step">
          <span class="case-review-dot"></span>
          <span class="case-review-copy">Record approval and prepare Agent 2 handoff</span>
        </div>
      </div>
    </div>
  `;
}

async function runCaseManagerReview(card) {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const reviewPanel = card.querySelector("#caseReviewPanel");
  const status = card.querySelector("#caseReviewStatus");
  const steps = [
    ["caseReviewStep1", "Case manager is reading intake notes...", "Intake notes reviewed."],
    ["caseReviewStep2", "Checking all party availability windows...", "Availability windows confirmed."],
    ["caseReviewStep3", "Validating the selected slot and safety checkpoint...", "Safety checkpoint validated."],
    ["caseReviewStep4", "Recording approval for Agent 2 handoff...", "Approval recorded for Agent 2."]
  ];

  if (reviewPanel) reviewPanel.hidden = false;

  for (const [stepId, activeText, doneText] of steps) {
    const step = card.querySelector(`#${stepId}`);
    const copy = step?.querySelector(".case-review-copy");
    if (status) status.textContent = activeText;
    if (step) {
      step.classList.add("is-active");
      step.classList.remove("is-done");
    }
    if (copy) copy.textContent = activeText;
    await wait(1150);
    if (step) {
      step.classList.remove("is-active");
      step.classList.add("is-done");
    }
    if (copy) copy.textContent = doneText;
  }

  if (status) status.textContent = "Case management approval complete.";
  await wait(650);
}

function renderAgent1ApprovalCard(sessionId, data) {
  const card = document.querySelector("#cAgent1Card");
  if (!card) return;

  card.style.display = "block";
  
  // Update placeholders and navigation tabs
  const placeholder = document.querySelector("#cNoApprovalsPlaceholder");
  if (placeholder) placeholder.style.display = "none";
  const badge = document.querySelector("#cApprovalCountBadge");
  if (badge) { badge.textContent = "1"; badge.style.display = "inline-block"; }
  if (window.switchClinicianTab) window.switchClinicianTab("approvals");
  
  // Build scene6-style scheduling slot cards
  const slots = data.proposedSlots || [];
  const calOverlay = data.calendarOverlay || {};
  
  const slotsHtml = slots.map((s, idx) => {
    const nice = s.label || (s.start.replace("T", " ") + " → " + (s.end.split("T")[1] || s.end));
    return `
      <div class="slot-card ${idx === 0 ? "selected" : ""}" data-slot-idx="${idx}" data-slot-value='${JSON.stringify(s)}'>
        <div class="avatar-ring">📅</div>
        <div class="slot-info">
          <div class="slot-name">
            Slot ${idx + 1}
            <span class="role-badge clinician">#178f86</span>
          </div>
          <div class="slot-time">${nice}</div>
        </div>
        <div class="slot-status">
          <button class="approve-pill ${idx === 0 ? "approve-now" : "pending"}" data-pill-idx="${idx}">
            ${idx === 0 ? "Approve" : "Select"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Build party overlay rows (scene6-style)
  const parentId = document.querySelector("#cParentId")?.value || "parent_test";
  const clinicianId = document.querySelector("#cClinicianId")?.value || "clinician_naquan";
  const monitorId = document.querySelector("#cMonitorId")?.value || "monitor_jimmy";

  const partyRows = `
    <div class="slot-card">
      <div class="avatar-ring">👤</div>
      <div class="slot-info">
        <div class="slot-name">${parentId} <span class="role-badge parent">#d98632</span></div>
        <div class="slot-time">${(calOverlay.parent || []).length} availability windows parsed</div>
      </div>
      <div class="slot-status"><span class="role-badge parent" style="font-size:10px;">Parent</span></div>
    </div>
    <div class="slot-card">
      <div class="avatar-ring" style="border-color: var(--teal);">👩‍⚕️</div>
      <div class="slot-info">
        <div class="slot-name">${clinicianId} <span class="role-badge clinician">#178f86</span></div>
        <div class="slot-time">${(calOverlay.clinician || []).length} free windows (${data.sources?.streams || "mock"})</div>
      </div>
      <div class="slot-status"><span class="role-badge clinician" style="font-size:10px;">Clinician</span></div>
    </div>
    <div class="slot-card">
      <div class="avatar-ring" style="border-color: #F4F1EA;">⚖️</div>
      <div class="slot-info">
        <div class="slot-name">${monitorId} <span class="role-badge monitor">#F4F1EA</span></div>
        <div class="slot-time">${(calOverlay.monitor || []).length} free windows (${data.sources?.streams || "mock"})</div>
      </div>
      <div class="slot-status"><span class="role-badge monitor" style="font-size:10px;">Monitor</span></div>
    </div>
  `;

  const sit = data.parentSituation || {};
  const sitBits = [
    sit.employment ? `<span class="sit-chip">💼 ${sit.employment}</span>` : "",
    sit.caregiving ? `<span class="sit-chip">🧒 ${sit.caregiving}</span>` : "",
    sit.constraints ? `<span class="sit-chip">⚠️ ${sit.constraints}</span>` : "",
    data.esl ? `<span class="sit-chip esl">🌐 English is a second language — tone monitor runs in lenient mode</span>` : "",
  ].filter(Boolean).join(" ");
  const situationHtml = (sit.summary || sitBits) ? `
    <div class="card-summary-row situation-box">
      <label>Parent Situation (understood by Agent 1)</label>
      <p>${sit.summary || ""}</p>
      ${sitBits ? `<div class="sit-chips">${sitBits}</div>` : ""}
    </div>` : "";

  card.innerHTML = `
    <h3><svg class="header-svg-icon" viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"></path><path d="M12 6v6l4 2"></path></svg>Agent 1 Intake Checkpoint</h3>
    <div class="card-summary-row">
      <label>Parent Availability Summary</label>
      <p>${data.parentAvailabilitySummary || "No description parsed"}</p>
    </div>
    ${situationHtml}
    <div class="card-summary-row">
      <label>Parse: <strong>${data.sources?.parse || "regex"}</strong> | Streams: <strong>${data.sources?.streams || "mock"}</strong></label>
    </div>
    
    <label>Calendar Overlay — All Parties</label>
    ${buildWeekCalendarHtml(calOverlay, slots)}
    ${partyRows}

    <label style="margin-top: 12px;">Proposed Conflict-Free Slots</label>
    <div class="slot-selection-box">
      ${slotsHtml || "<p style='font-size:11px;color:rgba(255,255,255,0.4);margin:0;'>No overlap slots found.</p>"}
    </div>

    ${buildCaseManagerReviewHtml()}

    <div style="display: flex; gap: 8px;">
      <button id="cApproveIntakeBtn">Approve & Launch Agent 2</button>
      <button id="cRejectIntakeBtn" class="btn-danger">Reject</button>
    </div>
  `;

  // Film-style row behavior: click a row to highlight it (dark, elevated,
  // orange Approve pill on the row); click that Approve pill to book the slot.
  card.querySelectorAll(".slot-card[data-slot-idx]").forEach(slotCard => {
    slotCard.addEventListener("click", (e) => {
      const clickedApprove = e.target.closest(".approve-pill");
      if (slotCard.classList.contains("selected") && clickedApprove) {
        document.querySelector("#cApproveIntakeBtn")?.click();
        return;
      }
      // Deselect all
      card.querySelectorAll(".slot-card[data-slot-idx]").forEach(sc => {
        sc.classList.remove("selected");
        const pill = sc.querySelector(".approve-pill");
        if (pill) { pill.className = "approve-pill pending"; pill.textContent = "Select"; }
      });
      // Select this one
      slotCard.classList.add("selected");
      const pill = slotCard.querySelector(".approve-pill");
      if (pill) { pill.className = "approve-pill approve-now"; pill.textContent = "Approve"; }
    });
  });

  // Bind Approval Action
  document.querySelector("#cApproveIntakeBtn").addEventListener("click", async () => {
    const approveBtn = document.querySelector("#cApproveIntakeBtn");
    const rejectBtn = document.querySelector("#cRejectIntakeBtn");
    if (approveBtn.disabled) return;
    approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    approveBtn.textContent = "Case Manager Reviewing...";
    card.classList.add("is-reviewing");
    card.querySelectorAll(".slot-card[data-slot-idx]").forEach(slotCard => {
      slotCard.style.pointerEvents = "none";
    });

    const selectedCard = card.querySelector(".slot-card.selected");
    const chosenSlot = selectedCard ? JSON.parse(selectedCard.dataset.slotValue) : (slots[0] || null);

    try {
      await runCaseManagerReview(card);
      approveBtn.textContent = "Launching Agent 2...";

      const res = await fetch(`${API_BASE}/api/agent1/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          approve: true,
          chosen_slot: chosenSlot
        })
      });
      const result = await res.json();
      
      // Clear card content and display Agent 2's step-by-step progress & email send simulation
      card.innerHTML = `
        <div class="agent-provisioning-progress" style="padding: 24px 12px; font-family: inherit;">
          <h3 style="margin-bottom: 20px; display: flex; align-items: center; gap: 8px;">
            <div class="spinner-ring" style="width:18px; height:18px; border:2px solid rgba(255,255,255,0.2); border-top-color:var(--teal); border-radius:50%; animation: spin 0.8s linear infinite;"></div>
            Agent 2: Provisioning & Calendar Synced
          </h3>
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
            <div id="pStep1" style="color: rgba(255,255,255,0.4); display: flex; align-items: center; gap: 8px;">
              <span>⚙️</span> Initializing environment calibration...
            </div>
            <div id="pStep2" style="color: rgba(255,255,255,0.4); display: flex; align-items: center; gap: 8px;">
              <span>📊</span> Applying child baseline (Trust: ${result.baseline_state?.trust || 0}%, Volatility: ${result.baseline_state?.volatility || 0}%)...
            </div>
            <div id="pStep3" style="color: rgba(255,255,255,0.4); display: flex; align-items: center; gap: 8px;">
              <span>📧</span> Composing invitation emails & ICS calendar attachments...
            </div>
            <div id="pStep4" style="color: rgba(255,255,255,0.4); display: flex; align-items: center; gap: 8px;">
              <span>🚀</span> Broadcasting emails to ${parentId}, ${clinicianId}, and ${monitorId}...
            </div>
          </div>
        </div>
      `;

      // Helper to delay
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // Step 1
      const s1 = card.querySelector("#pStep1");
      s1.style.color = "#ffffff";
      s1.innerHTML = `<span>⚡</span> Initializing environment calibration... <b style="color:var(--teal)">Active</b>`;
      await sleep(1000);
      s1.innerHTML = `<span>✅</span> Environment calibration initialized.`;

      // Step 2
      const s2 = card.querySelector("#pStep2");
      s2.style.color = "#ffffff";
      s2.innerHTML = `<span>⚡</span> Applying child baseline (Trust: ${result.baseline_state?.trust || 0}%, Volatility: ${result.baseline_state?.volatility || 0}%)... <b style="color:var(--teal)">Active</b>`;
      await sleep(1000);
      s2.innerHTML = `<span>✅</span> Child baseline applied successfully.`;

      // Step 3
      const s3 = card.querySelector("#pStep3");
      s3.style.color = "#ffffff";
      s3.innerHTML = `<span>⚡</span> Composing invitation emails & ICS calendar attachments... <b style="color:var(--teal)">Active</b>`;
      await sleep(1200);
      s3.innerHTML = `<span>✅</span> Invitation emails and attachments compiled.`;

      // Step 4
      const s4 = card.querySelector("#pStep4");
      s4.style.color = "#ffffff";
      s4.innerHTML = `<span>⚡</span> Broadcasting emails to ${parentId}, ${clinicianId}, and ${monitorId}... <b style="color:var(--teal)">Active</b>`;
      await sleep(1500);
      s4.innerHTML = `<span>✅</span> Emails transmitted. Delivery confirmations received.`;
      
      await sleep(1000);

      renderAgent2ProvisionCard(result, { sessionId, parentId, clinicianId, monitorId, chosenSlot });
      card.style.display = "none";
      refreshSessionList();
    } catch (e) {
      console.error(e);
      alert("Error confirming booking.");
    } finally {
      if (document.body.contains(approveBtn)) {
        approveBtn.disabled = false;
        approveBtn.textContent = "Approve & Launch Agent 2";
      }
      if (rejectBtn && document.body.contains(rejectBtn)) rejectBtn.disabled = false;
      card.classList.remove("is-reviewing");
      card.querySelectorAll(".slot-card[data-slot-idx]").forEach(slotCard => {
        slotCard.style.pointerEvents = "";
      });
    }
  });

  // Bind Rejection Action
  document.querySelector("#cRejectIntakeBtn").addEventListener("click", async () => {
    const rejectBtn = document.querySelector("#cRejectIntakeBtn");
    rejectBtn.disabled = true;
    rejectBtn.textContent = "Rejecting...";

    try {
      await fetch(`${API_BASE}/api/agent1/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          approve: false
        })
      });
      card.style.display = "none";
      const placeholder = document.querySelector("#cNoApprovalsPlaceholder");
      if (placeholder) placeholder.style.display = "block";
      const badge = document.querySelector("#cApprovalCountBadge");
      if (badge) badge.style.display = "none";
      alert("Intake proposal rejected. Session status reset.");
      refreshSessionList();
    } catch (e) {
      console.error(e);
      alert("Error rejecting intake.");
    } finally {
      rejectBtn.disabled = false;
      rejectBtn.textContent = "Reject";
    }
  });
}

function renderAgent2ProvisionCard(data, context = {}) {
  const card = document.querySelector("#cAgent2Card");
  if (!card) return;

  card.style.display = "block";
  
  // Hide approval badge & clear placeholder
  const placeholder = document.querySelector("#cNoApprovalsPlaceholder");
  if (placeholder) placeholder.style.display = "none";
  const badge = document.querySelector("#cApprovalCountBadge");
  if (badge) badge.style.display = "none";
  if (window.switchClinicianTab) window.switchClinicianTab("approvals");
  
  // Unwrap nested provisioning data if present
  const prov = data.provisioning || data || {};
  const baseline = prov.baseline_state || {};
  const slotLabel = context.chosenSlot ? context.chosenSlot.start.replace("T", " ") : "Scheduled";
  const sid = prov.session_id || data.session_id || context.sessionId || "";
  console.log(`[PROVISION] sid=${sid} prov.session_id=${prov.session_id} data.session_id=${data.session_id} context.sessionId=${context.sessionId}`);
  
  // Build email delivery notifications
  const emails = [
    { icon: "👤", name: context.parentId || "Parent", role: "Parent" },
    { icon: "👩‍⚕️", name: context.clinicianId || "Clinician", role: "Clinician" },
    { icon: "⚖️", name: context.monitorId || "Monitor", role: "Court Monitor" },
  ];
  
  const emailHtml = emails.map(e => `
    <div class="email-notification">
      <span class="email-icon">${e.icon}</span>
      <div class="email-body">
        <strong>${e.name}</strong> — ${e.role} invite for ${slotLabel}
      </div>
      <span class="email-status">✓ Delivered</span>
    </div>
  `).join("");

  card.innerHTML = `
    <h3><svg class="header-svg-icon" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.1a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>Agent 2 Environment Calibrated</h3>
    <div class="card-summary-row">
      <label>Status</label>
      <p class="text-green">${(prov.status || "provisioned").toUpperCase()}</p>
    </div>
    
    <label>Simulated Child Baselines Set</label>
    <div class="provision-metrics">
      <div class="prov-metric-item">Trust: <strong class="text-green">${baseline.trust || 0}%</strong></div>
      <div class="prov-metric-item">Volatility: <strong class="text-red">${baseline.volatility || 0}%</strong></div>
      <div class="prov-metric-item">Temperament: <strong class="${baseline.temperament === 'secure' ? 'text-green' : baseline.temperament === 'transgressed' ? 'text-red' : ''}">${baseline.temperament || "neutral"}</strong></div>
      <div class="prov-metric-item">Profile: <strong>${prov.temperament_profile || "cooperative"}</strong></div>
    </div>

    <label>📧 Calendar Invite Notifications</label>
    <div class="email-notifications">
      ${emailHtml}
    </div>

    <button class="btn-launch" onclick="window.__openSimulationSession('${sid}')">Launch Simulation Sandbox</button>
  `;
}

// Start checking session status if parent mode
if (activeSessionId) {
  setInterval(checkSessionStatus, 1500);
  checkSessionStatus();
}

/* ============================================================
   Boot
   ============================================================ */
// Sidebar Hamburger Toggle
const toggleBtn = document.querySelector("#sidebarToggle");
const statePanel = document.querySelector(".state-panel");
if (toggleBtn && statePanel) {
  toggleBtn.addEventListener("click", () => {
    toggleBtn.classList.toggle("is-open");
    statePanel.classList.toggle("is-open");
  });
}

initClinicianHub();
initLandingPage();
buildLocationBar();
const defaultLoc = (sessionRole === "clinician" || sessionRole === "landing") ? "park" : "home";
setLocation(locationDefs[queryParams.get("loc")] ? queryParams.get("loc") : defaultLoc);
renderStats();
syncUi();

animate();

// Fallback to ensure splash screen is eventually dismissed even if loading fails/stalls
if (activeSessionId) {
  setTimeout(dismissSplashScreen, 8000);
}

// dev helpers for testing reactions from the console
window.__digiReact = (type) => triggerReaction(type);
window.__digiAct = (type, prop = "none", spot = "none") => performChildAction({ type, prop, spot });
window.__digiCalib = (m) => computeAggression(m); // test the tone scorer from the console
// simulate a voice turn without a microphone: attach a synthetic tone to the next message
window.__digiTone = (aggression = 0.7) => {
  pendingTone = {
    volume: Math.min(1, 0.3 + aggression * 0.6), peak: Math.min(1, 0.4 + aggression * 0.6),
    pitch: 200, pitchVar: Math.round(30 + aggression * 90), sharpness: Math.min(1, 0.3 + aggression * 0.6),
    wordsPerSec: 2.5 + aggression * 2.5, jitter: aggression * 0.12, shimmer: aggression * 0.28,
    flux: aggression * 0.25, arousal: Math.min(1, 0.3 + aggression * 0.7),
    aggression, esl: isEslSpeaker(), source: "voice",
  };
  return pendingTone;
};
window.__digiEye = (e) => { if (current) current.eye = e; };
window.__digiState = () => ({
  reaction: reaction ? { ...reaction, now: clock.elapsedTime } : null,
  expr: { ...expr },
  child: {
    x: +childWorld.x.toFixed(2), z: +childWorld.z.toFixed(2), pose: childPose,
    y: +child.position.y.toFixed(2), baseY: +childBaseY.toFixed(2), h: +vrmHeight.toFixed(2), scale: +child.scale.x.toFixed(2),
    graph: (() => {
      let meshes = 0, visMeshes = 0, mats = new Set();
      const hidden = [];
      if (vrm) vrm.scene.traverse((o) => {
        if (o.visible === false) hidden.push(o.type + ":" + (o.name || "?"));
        if (o.isMesh) { meshes++; if (o.visible) visMeshes++; mats.add(o.material?.type || (Array.isArray(o.material) ? o.material[0]?.type : "?")); }
      });
      const chain = []; let p = child; while (p) { chain.push(p.type + (p.name ? ":" + p.name : "")); p = p.parent; }
      const wp = vrm ? vrm.scene.getWorldPosition(new THREE.Vector3()) : null;
      return { meshes, visMeshes, hidden: hidden.slice(0, 8), childVisible: child.visible, vrmSceneVisible: vrm ? vrm.scene.visible : null, mats: [...mats], childChain: chain, vrmInChild: vrm ? vrm.scene.parent === child : null, vrmWorld: wp ? [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)] : null };
    })(),
    action: actionType, actionLeft: +(actionUntil - clock.getElapsedTime()).toFixed(1),
    target: { x: +childTarget.x.toFixed(2), z: +childTarget.z.toFixed(2) },
    prop: childAttachedProp ? (childAttachedProp.name || "prop") : null,
  },
  player: { x: +player.x.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(2) },
  bones: vrm
    ? {
        Lu: ["x", "y", "z"].map((k) => +(vrm.humanoid.getNormalizedBoneNode("leftUpperArm")?.rotation[k] ?? 0).toFixed(2)),
        Ll: ["x", "y", "z"].map((k) => +(vrm.humanoid.getNormalizedBoneNode("leftLowerArm")?.rotation[k] ?? 0).toFixed(2)),
      }
    : null,
});

// dev helper: teleport the player from the console
window.__digiGo = (x, z, yaw = 0, pitch = -0.05) => {
  player.x = x;
  player.z = z;
  player.yaw = yaw;
  player.pitch = pitch;
};

// dev helper: measure model bounding boxes from the console
window.__digiProbe = async (paths) => {
  const out = {};
  for (const p of paths) {
    try {
      const m = await loadModel(p);
      const box = new THREE.Box3().setFromObject(m);
      const s = box.getSize(new THREE.Vector3());
      out[p] = [s.x, s.y, s.z].map((v) => Math.round(v * 100) / 100);
    } catch {
      out[p] = "missing";
    }
  }
  return out;
};

// dev helper: grab a 16:9 JPEG snapshot of the 3D view from the console
window.__digiShot = (w = 960, h = 540) => {
  updateFrame(1 / 60, clock.getElapsedTime());
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(1);
  composer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  composer.render();
  const c2 = document.createElement("canvas");
  c2.width = w;
  c2.height = h;
  c2.getContext("2d").drawImage(canvas, 0, 0, w, h);
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  composer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  return c2.toDataURL("image/jpeg", 0.72);
};

// Help Cloud Toggle & Auto-timeout
const helpBtn = document.querySelector("#helpBtn");
const helpCloud = document.querySelector("#helpCloud");
if (helpBtn && helpCloud) {
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    helpCloud.classList.toggle("is-open");
  });
  
  window.addEventListener("click", () => {
    helpCloud.classList.remove("is-open");
  });

  // Open immediately at start
  helpCloud.classList.add("is-open");

  // Automatically fade out after 20 seconds
  setTimeout(() => {
    helpCloud.classList.remove("is-open");
  }, 20000);
}
