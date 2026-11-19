import { TAU } from "../core/math.js";

export const THREE_STATE = {
  loaded: false,
  loading: false,
  renderer: null,
  scene: null,
  camera: null,
  trackMesh: null,
  trackGroup: null,
  groundMesh: null,
  skyMesh: null,
  starField: null,
  kartModels: new Map(),
  itemMeshes: [],
  coinMeshes: [],
  boostPadMeshes: [],
  hazardMeshes: new Map(),
  movingObjectMeshes: [],
  dragonModel: null,
  dragonEscapeModel: null,
  particles3d: [],
  camSmooth: { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 66, roll: 0 },
  camSmoothP2: { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 66, roll: 0 },
  // Visual enhancements
  nameTagSprites: new Map(),
  speechBubbleSprites: new Map(),
  particles3dSystem: null,
  skidMarks3d: [],
  spectatorMeshes: [],
  startLineMesh: null,
  startLightMats: [],
  edgeGlowLines: [],
  pillarRings: [],
  chevronMeshes: [],
  contactShadowTex: null,
  particleGlowTex: null,
  kartEnvMap: null,
  _kartEnvRenderer: null,
  hemiLight: null,
  ambientLight: null,
  gridHelper: null,
  arenaMarkerPanelMesh: null,
  arenaMarkerCapMesh: null,
};

export const ENABLE_3D_SHADOWS = new URLSearchParams(window.location.search).has("shadows3d");
export const ENABLE_DECORATIVE_3D_LIGHTS = new URLSearchParams(window.location.search).has("lights3d");
export const ENABLE_3D_PROFILE = new URLSearchParams(window.location.search).has("profile3d");


export const canvas3d = document.getElementById("game3d");
export const hudCanvas = document.getElementById("hud-overlay");
export const hudCtx = hudCanvas ? hudCanvas.getContext("2d") : null;


const _pendingThreeLoadListeners = [];

export function loadThreeJS(callback, onError) {
  if (window.THREE) {
    THREE_STATE.loaded = true;
    THREE_STATE.loading = false;
    callback?.();
    return;
  }
  _pendingThreeLoadListeners.push({ callback, onError });
  if (THREE_STATE.loading) return;
  THREE_STATE.loading = true;
  const script = document.createElement("script");
  script.src = "three.min.js";
  script.onload = () => {
    THREE_STATE.loaded = true;
    THREE_STATE.loading = false;
    const listeners = _pendingThreeLoadListeners.splice(0);
    for (const entry of listeners) {
      entry.callback?.();
    }
  };
  script.onerror = () => {
    script.remove();
    THREE_STATE.loaded = false;
    THREE_STATE.loading = false;
    const listeners = _pendingThreeLoadListeners.splice(0);
    let handled = false;
    for (const entry of listeners) {
      if (typeof entry.onError === "function") {
        handled = true;
        entry.onError();
      }
    }
    if (!handled) {
      window.showGameToast?.("Could not load 3D engine (Three.js)", "error");
    }
  };
  document.head.appendChild(script);
}


const _DISPOSABLE_TEXTURE_PROPS = ["map", "emissiveMap", "roughnessMap", "normalMap"];

function disposeMaterial3D(mat) {
  if (!mat) return;
  for (const prop of _DISPOSABLE_TEXTURE_PROPS) {
    const tex = mat[prop];
    if (tex && !tex.userData?.shared) {
      tex.dispose?.();
    }
  }
  mat.dispose?.();
}

export function dispose3DObject(obj) {
  if (!obj) return;
  obj.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(disposeMaterial3D);
      else disposeMaterial3D(child.material);
    }
  });
}


// Small, cached procedural textures add surface detail without extra geometry or per-frame work.
// Material disposal intentionally leaves these shared CanvasTextures alive for later map rebuilds.
const _compassSurfaceTexture3DCache = new Map();
export function getCompassSurfaceTexture3D(T, surface, day, accentHex = null) {
  const key = `${day ? "day" : "night"}:${surface}:${accentHex || "default"}`;
  if (_compassSurfaceTexture3DCache.has(key)) return _compassSurfaceTexture3DCache.get(key);

  const size = 256;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const c = tile.getContext("2d");
  if (surface === "arena") {
    c.fillStyle = day ? "#acc5b1" : "#1b1726";
    c.fillRect(0, 0, size, size);
    c.strokeStyle = day ? "rgba(79,72,112,0.13)" : "rgba(235,228,255,0.06)";
    c.lineWidth = 1;
    c.beginPath();
    for (let p = 32; p < size; p += 32) {
      c.moveTo(p + 0.5, 0); c.lineTo(p + 0.5, size);
      c.moveTo(0, p + 0.5); c.lineTo(size, p + 0.5);
    }
    c.stroke();
    c.strokeStyle = day ? "rgba(123,117,255,0.34)" : "rgba(139,133,255,0.18)";
    c.lineWidth = 2;
    c.strokeRect(1, 1, size - 2, size - 2);
    c.fillStyle = day ? "rgba(253,153,39,0.55)" : "rgba(253,153,39,0.3)";
    c.fillRect(9, 9, 24, 4);
    c.fillRect(9, 9, 4, 24);
    c.fillStyle = day ? "rgba(164,255,128,0.6)" : "rgba(164,255,128,0.26)";
    c.beginPath(); c.arc(size / 2, size / 2, 4, 0, TAU); c.fill();
  } else {
    const accent = accentHex || (day ? "#7b75ff" : "#8b85ff");
    // Base tarmac gradient (slightly lighter crown in center, darker shoulders)
    const roadGrad = c.createLinearGradient(0, 0, 0, size);
    if (day) {
      roadGrad.addColorStop(0, "#1d1a2a");
      roadGrad.addColorStop(0.18, "#2a263a");
      roadGrad.addColorStop(0.5, "#312d42");
      roadGrad.addColorStop(0.82, "#2a263a");
      roadGrad.addColorStop(1, "#1d1a2a");
    } else {
      roadGrad.addColorStop(0, "#100e18");
      roadGrad.addColorStop(0.18, "#181524");
      roadGrad.addColorStop(0.5, "#1f1b2e");
      roadGrad.addColorStop(0.82, "#181524");
      roadGrad.addColorStop(1, "#100e18");
    }
    c.fillStyle = roadGrad;
    c.fillRect(0, 0, size, size);

    // Dual subtle tire-wear grooves running along U (x-axis)
    c.fillStyle = day ? "rgba(12,10,20,0.22)" : "rgba(4,3,10,0.34)";
    c.fillRect(0, 62, size, 30);
    c.fillRect(0, 164, size, 30);

    // Deterministic fine asphalt aggregate grain
    let h = 0x517cc1b7;
    for (let i = 0; i < 620; i++) {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      const gx = h & 255;
      const gy = (h >>> 8) & 255;
      const bright = (h >>> 16) & 1;
      c.fillStyle = bright
        ? (day ? "rgba(255,255,255,0.045)" : "rgba(210,205,255,0.035)")
        : "rgba(0,0,0,0.09)";
      c.fillRect(gx, gy, 2, 2);
    }

    // Crisp outer shoulder lines (racing boundary markings)
    c.fillStyle = day ? "rgba(244,246,255,0.72)" : "rgba(235,232,255,0.5)";
    c.fillRect(0, 7, size, 5);
    c.fillRect(0, size - 12, size, 5);

    // Thin inner accent trim inside shoulders
    c.globalAlpha = day ? 0.45 : 0.42;
    c.fillStyle = accent;
    c.fillRect(0, 15, size, 2);
    c.fillRect(0, size - 17, size, 2);
    c.globalAlpha = 1;

    // Subtle expansion joints across the tarmac
    c.strokeStyle = day ? "rgba(255,255,255,0.04)" : "rgba(180,175,255,0.04)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0.5, 16); c.lineTo(0.5, size - 16);
    c.moveTo(128.5, 16); c.lineTo(128.5, size - 16);
    c.stroke();

    // Dashed racing centerline
    c.save();
    c.strokeStyle = accent;
    c.globalAlpha = day ? 0.48 : 0.42;
    c.lineWidth = 3;
    c.setLineDash([24, 24]);
    c.beginPath();
    c.moveTo(0, size / 2);
    c.lineTo(size, size / 2);
    c.stroke();
    c.restore();

    // Faint forward flow chevron on centerline for high-speed motion read
    c.save();
    c.strokeStyle = day ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.07)";
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(56, size / 2 - 20);
    c.lineTo(74, size / 2);
    c.lineTo(56, size / 2 + 20);
    c.moveTo(184, size / 2 - 20);
    c.lineTo(202, size / 2);
    c.lineTo(184, size / 2 + 20);
    c.stroke();
    c.restore();
  }

  const texture = new T.CanvasTexture(tile);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  if (T.SRGBColorSpace) texture.colorSpace = T.SRGBColorSpace;
  if (THREE_STATE.renderer?.capabilities) {
    texture.anisotropy = Math.min(4, THREE_STATE.renderer.capabilities.getMaxAnisotropy());
  }
  texture.userData = { shared: true };
  texture.needsUpdate = true;
  _compassSurfaceTexture3DCache.set(key, texture);
  return texture;
}

export function getContactShadowTexture3D(T) {
  if (THREE_STATE.contactShadowTex) return THREE_STATE.contactShadowTex;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  const grad = cx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  grad.addColorStop(0.45, "rgba(0, 0, 0, 0.42)");
  grad.addColorStop(0.8, "rgba(0, 0, 0, 0.12)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  cx.fillStyle = grad;
  cx.fillRect(0, 0, size, size);
  const tex = new T.CanvasTexture(c);
  tex.userData = { shared: true };
  tex.needsUpdate = true;
  THREE_STATE.contactShadowTex = tex;
  return tex;
}

export function getParticleGlowTexture3D(T) {
  if (THREE_STATE.particleGlowTex) return THREE_STATE.particleGlowTex;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  const grad = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255, 255, 255, 1)");
  grad.addColorStop(0.28, "rgba(255, 255, 255, 0.72)");
  grad.addColorStop(0.65, "rgba(255, 255, 255, 0.18)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  cx.fillStyle = grad;
  cx.fillRect(0, 0, size, size);
  const tex = new T.CanvasTexture(c);
  tex.userData = { shared: true };
  tex.needsUpdate = true;
  THREE_STATE.particleGlowTex = tex;
  return tex;
}
