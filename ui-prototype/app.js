import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

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
let exprHappy = 0.2;
let exprSad = 0;
let exprAngry = 0;

function miraStage() {
  return Math.max(1, Math.min(15, Math.round(state.age)));
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
    },
    undefined,
    (e) => console.warn(`Could not load ${url}`, e)
  );
}

// blink timing
let blinkUntil = -1;
let nextBlinkAt = 3.2;

let childPose = "stand";
let childBaseY = 0;

function setChildPose(pose) {
  childPose = pose;
  if (!vrm) return;
  const sit = pose === "sit";
  for (const side of ["left", "right"]) {
    const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`);
    const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`);
    if (upper) upper.rotation.x = sit ? Math.PI / 2.15 : 0;
    if (lower) lower.rotation.x = sit ? -Math.PI / 2.05 : 0;
  }
}

function placeChild() {
  if (!current) return;
  const a = current.childAnchor;
  const y = a.pose === "sit" ? (a.seat || 0) - vrmHeight * 0.38 : 0;
  child.position.set(a.x, y, a.z);
  child.rotation.y = a.yaw;
  childBaseY = y;
  setChildPose(a.pose);
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
  wall(g, colliders, wallA, 0, 6, 14, 0.2);
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

  // windows (emissive daylight)
  const win = glowMat(0xcfe8ff);
  box(g, 1.9, 1.2, 0.05, win, -4, 1.8, -5.87, { cast: false, receive: false });
  box(g, 1.9, 1.2, 0.05, win, -3.4, 1.8, 5.87, { cast: false, receive: false });
  box(g, 0.05, 1.2, 1.9, win, 6.87, 1.8, -3, { cast: false, receive: false });

  /* --- living room (real furniture models) --- */
  prop(g, "furniture/rugRound", -3.4, 3.2, { s: 3.6 });
  prop(g, "furniture/loungeSofa", -6.15, 3.4, { s: 2, ry: Math.PI / 2 });
  solid(colliders, -6.15, 3.4, 1.1, 2.2);
  prop(g, "furniture/tableCoffee", -4.3, 3.4, { s: 2, ry: Math.PI / 2 });
  solid(colliders, -4.3, 3.4, 0.95, 1.5);
  box(g, 0.08, 1.35, 1.95, mat(0x2b2924, 0.68), 0.42, 0.92, 3.4, { cast: false });
  prop(g, "furniture/cabinetTelevision", 0.28, 3.4, { s: 1.85, ry: -Math.PI / 2 });
  prop(g, "furniture/televisionModern", 0.3, 3.4, { s: 1.45, ry: -Math.PI / 2, y: 0.62 });
  solid(colliders, 0.28, 3.4, 0.75, 1.9);
  prop(g, "furniture/bookcaseClosedWide", -1.4, 5.6, { s: 2, ry: Math.PI });
  solid(colliders, -1.4, 5.6, 1.8, 0.7);
  prop(g, "furniture/lampRoundFloor", -6.45, 5.3, { s: 2 });
  solid(colliders, -6.45, 5.3, 0.5, 0.5);
  prop(g, "furniture/pottedPlant", -0.5, 5.25, { s: 2 });
  solid(colliders, -0.5, 5.25, 0.6, 0.6);

  // Mira's play corner: little table, teddy bear, books
  prop(g, "furniture/tableCoffeeSquare", -3.1, 0.6, { s: 1.6 });
  prop(g, "furniture/books", -3.2, 0.62, { s: 1.6, y: 0.37, ry: 0.4 });
  prop(g, "furniture/bear", -2.4, 1.15, { s: 1.2, ry: -0.7 });
  solid(colliders, -3.1, 0.6, 1.2, 0.8);

  // painting + warm floor lamp light
  box(g, 1.5, 1.0, 0.05, mat(0xd98632, 0.7), -3.4, 1.9, 5.87, { cast: false });
  box(g, 1.3, 0.8, 0.03, mat(0x1c5a5a, 0.6), -3.4, 1.9, 5.84, { cast: false });
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
  prop(g, "furniture/tableRound", -3, -3.1, { s: 2 });
  kitchenTableLegs(g, -3, -3.1);
  prop(g, "food/plate-dinner", -3.34, -3.02, { s: 0.34, y: 0.78, ry: 0.3 });
  prop(g, "food/cup-coffee", -2.68, -3.28, { s: 0.5, y: 0.78, ry: -0.4 });
  prop(g, "food/bowl-cereal", -2.95, -2.82, { s: 0.45, y: 0.78 });
  prop(g, "food/apple", -3.18, -3.38, { s: 0.45, y: 0.78 });
  prop(g, "furniture/chairCushion", -3.95, -3.1, { s: 2, ry: Math.PI / 2 });
  prop(g, "furniture/chairCushion", -2.05, -3.1, { s: 2, ry: -Math.PI / 2 });
  prop(g, "food/cutting-board", -4.2, -5.5, { s: 1.15, y: 0.86, ry: Math.PI / 2 });
  prop(g, "food/pan", -3.55, -5.5, { s: 1.1, y: 0.9, ry: -0.35 });
  prop(g, "food/banana", -5.75, -5.45, { s: 0.9, y: 0.88, ry: 0.6 });
  solid(colliders, -3, -3.1, 1.7, 1.7);
  const kitchenLight = new THREE.PointLight(0xfff1cf, 1.1, 7, 2);
  kitchenLight.position.set(-3.4, 2.7, -3.4);
  g.add(kitchenLight);

  /* --- bedroom (wall-aligned, clearer circulation) --- */
  prop(g, "furniture/rugRectangle", 4.6, -3.55, { s: 2.7, ry: Math.PI / 2 });
  prop(g, "furniture/bedSingle", 5.65, -5.05, { s: 2.05, ry: Math.PI / 2 });
  solid(colliders, 5.65, -5.05, 2.15, 1.2);
  prop(g, "furniture/pillowBlue", 6.08, -5.48, { s: 1.05, y: 0.58, ry: Math.PI / 2 });
  prop(g, "furniture/pillow", 5.72, -5.48, { s: 0.95, y: 0.6, ry: Math.PI / 2 });
  prop(g, "furniture/bear", 5.0, -4.78, { s: 0.95, y: 0.7, ry: -2.2 });
  prop(g, "furniture/sideTableDrawers", 4.12, -5.45, { s: 1.75 });
  prop(g, "furniture/lampSquareTable", 4.12, -5.45, { s: 1.25, y: 0.78 });
  solid(colliders, 4.12, -5.45, 0.72, 0.72);
  const bedLight = new THREE.PointLight(0xffb066, 1.05, 5.2, 2);
  bedLight.position.set(4.25, 1.35, -5.25);
  g.add(bedLight);
  prop(g, "furniture/bookcaseOpenLow", 1.45, -5.55, { s: 1.9 });
  solid(colliders, 1.45, -5.55, 1.35, 0.62);
  prop(g, "furniture/desk", 6.48, -2.45, { s: 1.75, ry: -Math.PI / 2 });
  prop(g, "furniture/chairDesk", 5.6, -2.45, { s: 1.55, ry: Math.PI / 2 });
  prop(g, "furniture/computerScreen", 6.46, -2.45, { s: 1.05, y: 0.78, ry: -Math.PI / 2 });
  prop(g, "furniture/books", 6.42, -2.88, { s: 0.82, y: 0.78, ry: -0.4 });
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
  wallTileSurface(g, 0.62, 1.25, 3.85, 3.9, 2.35, "west", { cols: 4, rows: 4 });
  wallTileSurface(g, 5.32, 1.25, 0.12, 3.0, 2.35, "south", { cols: 3, rows: 4 });

  const marble = mat(0xe6e0d6, 0.62);
  box(g, 3.9, 0.12, 0.72, marble, 2.82, 0.9, 5.48, { cast: true });
  prop(g, "furniture/bathroomCabinetDrawer", 1.35, 5.42, { s: 1.55, ry: Math.PI });
  prop(g, "furniture/bathroomSinkSquare", 2.48, 5.43, { s: 1.75, ry: Math.PI });
  prop(g, "furniture/bathroomCabinet", 3.45, 5.42, { s: 1.55, ry: Math.PI });
  prop(g, "furniture/bathroomCabinetDrawer", 4.15, 5.42, { s: 1.35, ry: Math.PI });
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
  const paint = mat(0xa63c3c, 0.45, { metalness: 0.25 });
  const darkTrim = mat(0x24262b, 0.6);
  const seatMat = mat(0x54463a, 0.8);
  box(g, 1.9, 0.1, 3.4, darkTrim, 0, 0.44, 0.2, { cast: false });
  box(g, 1.85, 0.34, 1.2, paint, 0, 0.8, -1.95);
  box(g, 1.8, 0.52, 0.55, darkTrim, 0, 1.06, -0.9);
  box(g, 1.8, 0.07, 0.62, mat(0x33363c, 0.5), 0, 1.33, -0.92);
  box(g, 0.5, 0.22, 0.04, glowMat(0x8fd8cf), -0.45, 1.22, -0.66, { cast: false, receive: false });
  box(g, 0.34, 0.2, 0.04, glowMat(0x3b4754), 0.1, 1.2, -0.66, { cast: false, receive: false });

  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.032, 12, 28), mat(0x1b1d21, 0.4));
  wheel.position.set(-0.45, 1.16, -0.6);
  wheel.rotation.x = -0.95;
  g.add(wheel);
  const spoke = box(g, 0.32, 0.035, 0.035, mat(0x1b1d21, 0.4), -0.45, 1.16, -0.6, { rx: -0.95 });
  cyl(g, 0.035, 0.045, 0.4, darkTrim, -0.45, 1.0, -0.72, { rx: 0.6 });

  for (const sx of [-0.45, 0.5]) {
    box(g, 0.62, 0.16, 0.6, seatMat, sx, 0.78, 0.35);
    box(g, 0.62, 0.78, 0.16, seatMat, sx, 1.22, 0.72, { rx: -0.1 });
    box(g, 0.3, 0.18, 0.12, seatMat, sx, 1.68, 0.78);
  }
  box(g, 1.7, 0.16, 0.6, seatMat, 0, 0.78, 1.55);
  box(g, 1.7, 0.7, 0.16, seatMat, 0, 1.2, 1.85, { rx: -0.08 });

  box(g, 0.07, 0.5, 2.9, paint, -0.94, 0.72, 0.2);
  box(g, 0.07, 0.5, 2.9, paint, 0.94, 0.72, 0.2);
  box(g, 1.95, 0.09, 2.2, paint, 0, 2.1, 0.7, { cast: false });
  for (const [px, pz, tilt] of [[-0.9, -0.72, 0.28], [0.9, -0.72, 0.28], [-0.9, 1.62, -0.2], [0.9, 1.62, -0.2]]) {
    cyl(g, 0.045, 0.045, 0.95, darkTrim, px, 1.6, pz, { rx: tilt });
  }
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.78, 0.85),
    new THREE.MeshBasicMaterial({ color: 0xbfe0f2, transparent: true, opacity: 0.14 })
  );
  glass.position.set(0, 1.72, -1.1);
  glass.rotation.x = -0.3;
  g.add(glass);
  box(g, 0.32, 0.1, 0.04, mat(0x1b1d21, 0.3), 0, 1.9, -0.7);

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
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
    childAnchor: { x: 0.5, z: 0.38, seat: 0.86, yaw: 0, pose: "sit" },
    aimAtChild: false,
    canMove: false,
    eye: 1.58,
    env: { bg: 0xbfe0f2, fog: [0xbfe0f2, 30, 90], hemi: 0.85, envI: 0.5 },
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
      wheel.rotation.z = Math.sin(t * 0.7) * 0.06;
      spoke.rotation.z = Math.sin(t * 0.7) * 0.06;
    },
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
  const palette = [0xd14b3f, 0xe08536, 0xf2c531, 0x64b54e, 0x3f8fd1, 0x9b59b6, 0x2aa8a0, 0xd96a9b];

  box(g, 26, 0.1, 20, mat(0x66a39b, 0.9), 0, -0.05, 0, { cast: false });
  box(g, 26, 0.1, 20, mat(0xb9bec2, 1), 0, 4.4, 0, { cast: false, receive: false });
  const wallM = mat(0xd9b477, 0.9);
  wall(g, colliders, wallM, 0, -10, 26, 0.2, 4.5);
  wall(g, colliders, wallM, 0, 10, 26, 0.2, 4.5);
  wall(g, colliders, wallM, -13, 0, 0.2, 20, 4.5);
  wall(g, colliders, wallM, 13, 0, 0.2, 20, 4.5);

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      box(g, 4.5, 0.14, 0.5, glowMat(0xf6f4ec), -7.5 + r * 15, 4.3, -7.5 + c * 5, { cast: false, receive: false });
    }
  }

  function gondola(cx, cz, len, seed) {
    box(g, len, 0.3, 1.0, mat(0xb5413a, 0.7), cx, 0.15, cz);
    box(g, len, 1.95, 0.14, mat(0x8f9498, 0.6), cx, 1.05, cz);
    for (const side of [-1, 1]) {
      for (let lvl = 0; lvl < 3; lvl++) {
        const y = 0.55 + lvl * 0.5;
        box(g, len, 0.05, 0.44, mat(0x9aa0a4, 0.5), cx, y, cz + side * 0.29, { cast: false });
        const foods = ["can", "soda", "loaf", "cheese", "pizza-box", "carton", "bag", "bottle-ketchup", "honey", "chocolate", "peanut-butter", "banana", "apple", "watermelon", "pumpkin-basic", "bread", "croissant", "cookie"];
        const slots = Math.floor(len / 0.65);
        for (let s = 0; s < slots; s++) {
          const idx = seed + lvl * 31 + s * 7 + (side + 1) * 53;
          if (rnd(idx) < 0.2) continue;
          const item = foods[Math.floor(rnd(idx + 1) * foods.length)];
          prop(g, `food/${item}`, cx - len / 2 + 0.4 + s * 0.65, cz + side * 0.3, {
            s: 1.05,
            y: y + 0.03,
            ry: rnd(idx + 2) * 6.28,
          });
        }
      }
    }
    solid(colliders, cx, cz, len + 0.2, 1.3);
  }

  for (const [gx, seedBase] of [[-4.5, 11], [4.5, 77]]) {
    gondola(gx, -6, 7, seedBase);
    gondola(gx, -3, 7, seedBase + 13);
    gondola(gx, 0, 7, seedBase + 29);
  }

  // wall coolers
  for (let i = 0; i < 5; i++) {
    const cx = -9 + i * 4.5;
    box(g, 3.6, 2.4, 0.7, mat(0x3b4754, 0.6), cx, 1.2, -9.4);
    box(g, 3.2, 1.6, 0.06, glowMat(0xa8d4de), cx, 1.3, -9.02, { cast: false, receive: false });
    solid(colliders, cx, -9.4, 3.8, 1.0);
  }

  // checkout lanes
  for (let i = 0; i < 3; i++) {
    const cx = -6 + i * 4;
    box(g, 0.95, 0.95, 2.6, mat(0xb5413a, 0.65), cx, 0.475, 6.4);
    box(g, 0.85, 0.05, 1.6, mat(0x24262b, 0.4), cx, 1.0, 6.1, { cast: false });
    cyl(g, 0.03, 0.03, 1.3, mat(0x8f9498, 0.5), cx + 0.35, 1.65, 7.4);
    const laneSign = textPanel(String(i + 1), 0.42, 0.42, "#b5413a", "#fff6dd");
    laneSign.position.set(cx + 0.35, 2.4, 7.4);
    g.add(laneSign);
    solid(colliders, cx, 6.4, 1.2, 2.9);
  }

  // stock boxes near the coolers
  prop(g, "furniture/cardboardBoxClosed", -11.4, -7.6, { s: 2 });
  prop(g, "furniture/cardboardBoxOpen", -10.7, -8.2, { s: 2, ry: 0.5 });
  solid(colliders, -11, -7.9, 1.6, 1.4);

  // shopping cart
  {
    const cart = new THREE.Group();
    cart.position.set(8.2, 0, 6.8);
    cart.rotation.y = 0.6;
    box(cart, 0.6, 0.4, 0.9, mat(0x3f8fd1, 0.4, { metalness: 0.4 }), 0, 0.55, 0);
    box(cart, 0.55, 0.05, 0.85, mat(0x2c6ea8, 0.5), 0, 0.36, 0);
    cyl(cart, 0.02, 0.02, 0.5, mat(0x8f9498, 0.4), 0, 0.9, 0.55, { rz: Math.PI / 2 });
    for (const [wx, wz] of [[-0.24, -0.38], [0.24, -0.38], [-0.24, 0.38], [0.24, 0.38]]) {
      cyl(cart, 0.07, 0.07, 0.04, mat(0x24262b, 0.5), wx, 0.07, wz, { rz: Math.PI / 2 });
    }
    g.add(cart);
    solid(colliders, 8.2, 6.8, 1.1, 1.1);
  }

  // signs
  const banner = textPanel("DIGI MART", 6, 1.1, "#b5413a", "#fff6dd");
  banner.position.set(0, 3.5, -9.85);
  g.add(banner);
  const aisle1 = textPanel("AISLE 1", 1.8, 0.55, "#e08536", "#ffffff");
  aisle1.position.set(-4.5, 3.2, -4.5);
  g.add(aisle1);
  const aisle2 = textPanel("AISLE 2", 1.8, 0.55, "#e08536", "#ffffff");
  aisle2.position.set(4.5, 3.2, -4.5);
  g.add(aisle2);
  const sale = textPanel("SALE 50%", 1.5, 0.9, "#f2c531", "#7a2c14");
  sale.position.set(0, 1.6, -1.4);
  sale.rotation.y = Math.PI / 6;
  g.add(sale);

  for (const [lx, lz] of [[-6, -2], [6, -2], [0, 5]]) {
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
  wall(g, colliders, warmWall, 0, 6, 16, 0.2, 3.4);
  wall(g, colliders, warmWall, -8, 0, 0.2, 12, 3.4);
  wall(g, colliders, warmWall, 8, 0, 0.2, 12, 3.4);

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
    prop(g, "food/plate-dinner", px, pz, { s: 0.34, y: 0.87 });
    prop(g, "food/glass-wine", px + 0.34, pz + 0.14, { s: 0.42, y: 0.87 });
  }
  // holiday feast (offset so it doesn't hide Mira)
  prop(g, "food/turkey", -0.75, -0.5, { s: 0.62, y: 0.87 });
  prop(g, "food/pie", 0.8, -0.42, { s: 0.52, y: 0.87 });
  prop(g, "food/cake-birthday", -1.9, -0.5, { s: 0.5, y: 0.87 });
  prop(g, "food/loaf-baguette", 1.95, -0.55, { s: 0.45, y: 0.87, ry: 0.6 });
  prop(g, "food/wine-red", 0.38, -0.75, { s: 0.45, y: 0.87 });
  prop(g, "holiday/gingerbread-man", -0.3, -0.88, { s: 0.55, y: 0.87, ry: 0.4 });

  // Mira's booster seat on the middle chair
  box(g, 0.4, 0.14, 0.4, mat(0x3f8fd1, 0.7), 0, 0.57, -1.75);

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
  chair(-1.5, -1.75, Math.PI);
  chair(0, -1.75, Math.PI);
  chair(1.5, -1.75, Math.PI);
  chair(-1.5, 0.75, 0);
  chair(1.5, 0.75, 0);
  chair(2.85, -0.5, -Math.PI / 2);
  chair(-2.85, -0.5, Math.PI / 2);

  // family, seated
  const mom = makePerson({ shirt: 0x9d3b34, hairColor: 0x4a2c17 });
  mom.position.set(-1.5, 0.28, -1.72);
  mom.rotation.y = 0;
  g.add(mom);
  const dad = makePerson({ shirt: 0x556457, hairColor: 0x241a12, scale: 1.08 });
  dad.position.set(1.5, 0.28, -1.72);
  dad.rotation.y = 0;
  g.add(dad);
  const grandma = makePerson({ shirt: 0x7b5796, hairColor: 0xc9c3b8, scale: 0.96 });
  grandma.position.set(2.82, 0.28, -0.5);
  grandma.rotation.y = -Math.PI / 2;
  g.add(grandma);
  const sibling = makePerson({ shirt: 0x3f8fd1, hairColor: 0x2b1b12, scale: 0.85 });
  sibling.position.set(-1.5, 0.28, 0.72);
  sibling.rotation.y = Math.PI;
  g.add(sibling);

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
    childAnchor: { x: 0, z: -1.72, seat: 0.64, yaw: 0, pose: "sit" },
    canMove: true,
    eye: 1.55,
    env: { bg: 0x170f0a, fog: [0x170f0a, 12, 30], hemi: 0.55, envI: 0.3 },
    tick: (t) => {
      for (const c of candles) {
        const f = 0.85 + Math.sin(t * 11 + c.phase) * 0.12 + Math.sin(t * 23 + c.phase * 2) * 0.06;
        c.light.intensity = f;
        c.flame.scale.setScalar(0.85 + f * 0.25);
      }
    },
  };
}

/* ============================================================
   Location registry + switching
   ============================================================ */
const locationDefs = {
  home: { label: "Home", icon: "🏠", build: buildHome },
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
  }

  // child reacts to the new place
  state.childLine = arrivalLines[id][state.band];
  input.placeholder = `Speak to Mira — ${locationDefs[id].label}...`;

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
window.addEventListener("keyup", (e) => keys.delete(e.code));

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
  let moving = false;
  if (current.canMove && document.activeElement !== input) {
    const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    if (f || s) {
      moving = true;
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
  timelineFill.style.height = `${progress}%`;
  timelineMarker.style.bottom = `${progress}%`;
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
  placeChild();
}

/* ============================================================
   Conversation + mock Parent Governor
   ============================================================ */
form.addEventListener("submit", handleSubmit);
document.querySelector("#milestoneBtn").addEventListener("click", () => openInsight("Milestone Check", milestoneText()));
document.querySelector("#reportBtn").addEventListener("click", () => openInsight("Architect Report", architectText()));
document.querySelector("#ageBtn").addEventListener("click", ageUp);
document.querySelector("#closeInsight").addEventListener("click", () => insightPanel.classList.remove("is-open"));

async function handleSubmit(event) {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  const result = await sendToBackend({
    message,
    day: state.day,
    age: state.age,
    band: state.band,
    location: state.location,
    values: { ...state.values },
  });
  Object.assign(state.values, result.values);

  window.interactionCount = (window.interactionCount || 0) + 1;
  if (window.interactionCount >= 3) {
    window.interactionCount = 0;
    ageUp();
  }
  state.mood = result.mood;
  state.childLine = result.childLine;
  syncUi();
}

async function sendToBackend(payload) {
  const requestPayload = {
    message: payload.message,
    day: payload.day,
    year: payload.age,
    ageBand: payload.band,
    mode: "conversation",
    location: payload.location,
    values: payload.values,
    session: {
      childId: "mira",
      runId: "local-demo"
    }
  };

  try {
    const response = await fetch("http://127.0.0.1:8000/api/interact", {
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
  if (next.volatility > 58) mood = "guarded";
  else if (next.trust > 76 && next.security > 70) mood = "open";
  else if (next.logic > 65) mood = "analytical";
  else if (next.autonomy > 55) mood = "testing boundaries";

  const childLine = chooseLine(mood, band);
  return Promise.resolve({ values: next, mood, childLine });
}

function chooseLine(mood, band) {
  const lines = {
    curious: {
      "Age 5-7": "If I ask why twice, will you still answer me?",
      "Age 10-12": "I get what you mean, but how do I know when a rule is fair?",
      "Age 14-16": "I hear you. I just need the reason to make sense before I follow it.",
    },
    open: {
      "Age 5-7": "Okay. I feel like I can try it with you watching.",
      "Age 10-12": "That made sense. I think I can remember the pattern next time.",
      "Age 14-16": "I respect that. You gave me room and still kept the boundary clear.",
    },
    analytical: {
      "Age 5-7": "So if I do this, then that happens? I want to test it.",
      "Age 10-12": "That is a cause and effect thing. I can track that.",
      "Age 14-16": "Your logic is consistent. I do not fully agree, but I can work with it.",
    },
    guarded: {
      "Age 5-7": "I don't know if I want to ask now.",
      "Age 10-12": "You changed the rule again. Which version am I supposed to trust?",
      "Age 14-16": "You want honesty, but you punish the questions that get us there.",
    },
    "testing boundaries": {
      "Age 5-7": "Can I pick first and then you help if I mess up?",
      "Age 10-12": "What happens if I choose a different answer than yours?",
      "Age 14-16": "I can own the decision. I need you to let me own the consequence too.",
    },
  };
  return lines[mood][band];
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
  
  const scale = 1.0 + ((state.age - 5) * 0.08);
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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

const clock = new THREE.Clock();
const camWorld = new THREE.Vector3();

function updateFrame(dt, t) {
  updateMovement(dt);
  if (current.tick) current.tick(t, dt);

  const bob = Math.sin(player.bobPhase) * 0.035 * player.bobAmp;
  const wobble = current.camWobble ? current.camWobble(t) : 0;
  camRig.position.set(player.x, current.eye + bob + wobble, player.z);
  camRig.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // Mira: breathe, face the parent, track them with her head and eyes
  camera.getWorldPosition(camWorld);
  if (childPose === "stand") {
    child.position.y = childBaseY + Math.sin(t * 1.5) * 0.01;
    const targetYaw = Math.atan2(camWorld.x - child.position.x, camWorld.z - child.position.z);
    let diff = targetYaw - child.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    child.rotation.y += diff * Math.min(1, dt * 2.4);
  }
  if (vrm) {
    const headBone = vrm.humanoid.getNormalizedBoneNode("head");
    if (headBone) {
      const headPos = new THREE.Vector3();
      headBone.getWorldPosition(headPos);
      const dir = camWorld.clone().sub(headPos);
      const flat = Math.max(0.001, Math.hypot(dir.x, dir.z));
      let relYaw = Math.atan2(dir.x, dir.z) - child.rotation.y;
      relYaw = Math.atan2(Math.sin(relYaw), Math.cos(relYaw));
      relYaw = THREE.MathUtils.clamp(relYaw, -0.85, 0.85);
      const relPitch = THREE.MathUtils.clamp(Math.atan2(dir.y, flat), -0.45, 0.75);
      headBone.rotation.set(-relPitch * 0.7, relYaw * 0.75, 0);
    }
    const em = vrm.expressionManager;
    if (em) {
      em.setValue("blink", blinkUntil > 0 ? 1 : 0);
      em.setValue("happy", exprHappy);
      em.setValue("sad", exprSad);
      em.setValue("angry", exprAngry);
    }
    vrm.update(dt);
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
  updateFrame(dt, t);
  composer.render();
}

/* ============================================================
   Boot
   ============================================================ */
buildLocationBar();
setLocation("home");
renderStats();
syncUi();
animate();

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
