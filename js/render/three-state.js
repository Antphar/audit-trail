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
  camSmooth: { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 },
  // Visual enhancements
  nameTagSprites: new Map(),
  speechBubbleSprites: new Map(),
  particles3dSystem: null,
  skidMarks3d: [],
  spectatorMeshes: [],
  startLineMesh: null,
  edgeGlowLines: [],
  pillarRings: [],
  arenaMarkerPanelMesh: null,
  arenaMarkerCapMesh: null,
};

export const ENABLE_3D_SHADOWS = new URLSearchParams(window.location.search).has("shadows3d");
export const ENABLE_DECORATIVE_3D_LIGHTS = new URLSearchParams(window.location.search).has("lights3d");
export const ENABLE_3D_PROFILE = new URLSearchParams(window.location.search).has("profile3d");


export const canvas3d = document.getElementById("game3d");
export const hudCanvas = document.getElementById("hud-overlay");
export const hudCtx = hudCanvas ? hudCanvas.getContext("2d") : null;


export function loadThreeJS(callback) {
  if (window.THREE) { callback(); return; }
  if (THREE_STATE.loading) return;
  THREE_STATE.loading = true;
  const script = document.createElement("script");
  script.src = "three.min.js";
  script.onload = () => { THREE_STATE.loaded = true; callback(); };
  script.onerror = () => { alert("Could not load Three.js"); THREE_STATE.loading = false; };
  document.head.appendChild(script);
}


export function dispose3DObject(obj) {
  if (!obj) return;
  obj.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
      else child.material.dispose?.();
    }
  });
}


// Small, cached procedural textures add surface detail without extra geometry or per-frame work.
// Material disposal intentionally leaves these shared CanvasTextures alive for later map rebuilds.
const _compassSurfaceTexture3DCache = new Map();
export function getCompassSurfaceTexture3D(T, surface, day) {
  const key = `${day ? "day" : "night"}:${surface}`;
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
    c.fillStyle = day ? "#211c30" : "#15121f";
    c.fillRect(0, 0, size, size);
    c.strokeStyle = day ? "rgba(235,228,255,0.1)" : "rgba(139,133,255,0.08)";
    c.lineWidth = 1;
    c.beginPath();
    for (let p = 32; p < size; p += 64) {
      c.moveTo(0, p + 0.5); c.lineTo(size, p + 0.5);
    }
    c.stroke();
    c.strokeStyle = day ? "rgba(123,117,255,0.28)" : "rgba(79,72,112,0.32)";
    c.setLineDash([20, 28]);
    c.beginPath(); c.moveTo(0, size / 2 + 0.5); c.lineTo(size, size / 2 + 0.5); c.stroke();
    c.setLineDash([]);
    c.fillStyle = day ? "rgba(253,153,39,0.28)" : "rgba(253,153,39,0.16)";
    for (let i = 0; i < 8; i++) c.fillRect(18 + i * 29, 18 + ((i * 37) % 210), 3, 3);
  }

  const texture = new T.CanvasTexture(tile);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  if (T.SRGBColorSpace) texture.colorSpace = T.SRGBColorSpace;
  if (THREE_STATE.renderer?.capabilities) {
    texture.anisotropy = Math.min(4, THREE_STATE.renderer.capabilities.getMaxAnisotropy());
  }
  texture.needsUpdate = true;
  _compassSurfaceTexture3DCache.set(key, texture);
  return texture;
}
