import { TAU, lerp, clamp } from "../core/math.js";
import { game, isDayMode, isBattleMode } from "../core/state.js";
import { MAPS, getActiveMapConfig } from "../config/maps.js";
import { WORLD_W, WORLD_H } from "../entities/track.js";
import {
  THREE_STATE,
  ENABLE_3D_SHADOWS,
  ENABLE_DECORATIVE_3D_LIGHTS,
  dispose3DObject,
  getCompassSurfaceTexture3D,
} from "./three-state.js";
import { apply3DMapTheme } from "./three-scene.js";
import { buildAllKartModels, buildDragonModel3D, disposeTethers3D } from "./three-karts.js";
import {
  init3DParticles,
  build3DSpectators,
  build3DStartLine,
  enhance3DKartModels,
  reset3DParticlePool,
} from "./three-frame.js";

export function get3DRoadEdges(track) {
  const wp = track.waypoints;
  const edges = [];
  const closed = !track.isOpen;
  const n = wp.length;
  for (let i = 0; i < n; i++) {
    const segNext = track.segments[i] || track.segments[track.segments.length - 1];
    const segPrev = track.segments[(i - 1 + track.segments.length) % track.segments.length] || segNext;
    if (!segNext) continue;
    let nx, ny;
    if (!closed && i === 0) {
      nx = segNext.nx; ny = segNext.ny;
    } else if (!closed && i === n - 1) {
      nx = segPrev.nx; ny = segPrev.ny;
    } else {
      nx = segPrev.nx + segNext.nx;
      ny = segPrev.ny + segNext.ny;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
    }
    const baseW = ((segPrev.halfW || track.halfWidth) + (segNext.halfW || track.halfWidth)) * 0.5;
    const denom = Math.max(0.35, Math.abs(nx * segNext.nx + ny * segNext.ny));
    const w = Math.min(baseW / denom, baseW * 1.8);
    const p = wp[i];
    edges.push({
      left: { x: p.x + nx * w, y: p.y + ny * w },
      right: { x: p.x - nx * w, y: p.y - ny * w },
      center: p,
    });
  }
  return edges;
}


export function build3DArenaFloor(group, track) {
  if (!window.THREE || !track?.arenaFloor) return;
  const T = window.THREE;
  const floor = track.arenaFloor;
  const day = isDayMode();
  const floorTexture = getCompassSurfaceTexture3D(T, "arena", day);
  floorTexture.repeat.set(
    Math.max(4, floor.rx / 160),
    Math.max(4, floor.ry / 160)
  );
  const floorGeo = new T.CircleGeometry(floor.rx, 72);
  floorGeo.scale(1, 1, floor.ry / floor.rx);
  const floorMat = new T.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTexture,
    roughness: 0.9,
    metalness: 0.03,
    emissive: day ? 0x000000 : 0x131019,
    emissiveIntensity: day ? 0 : 0.1,
  });
  const floorMesh = new T.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  // Keep arena floor cleanly below the road ribbon (y = 0.50) to prevent z-fighting.
  floorMesh.position.set(floor.cx, 0.25, floor.cy);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  THREE_STATE.arenaFloorMesh = floorMesh;

  const ringGeo = new T.RingGeometry(floor.rx - 8, floor.rx + 2, 96);
  ringGeo.scale(1, 1, floor.ry / floor.rx);
  const ringMat = new T.MeshStandardMaterial({
    color: day ? 0x7b75ff : 0x8b85ff,
    emissive: day ? 0x2a2860 : 0x1a1840,
    emissiveIntensity: day ? 0.12 : 0.45,
    transparent: true,
    opacity: 0.85,
    side: T.DoubleSide,
  });
  const ringMesh = new T.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(floor.cx, 0.65, floor.cy);
  group.add(ringMesh);

  const innerRingGeo = new T.RingGeometry(floor.rx * 0.52, floor.rx * 0.55, 64);
  innerRingGeo.scale(1, 1, floor.ry / floor.rx);
  const innerRingMat = new T.MeshStandardMaterial({
    color: day ? 0xa4ff80 : 0x4f4870,
    emissive: day ? 0x10220c : 0x131019,
    emissiveIntensity: day ? 0.08 : 0.25,
    transparent: true,
    opacity: 0.45,
    side: T.DoubleSide,
  });
  const innerRing = new T.Mesh(innerRingGeo, innerRingMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.set(floor.cx, 0.58, floor.cy);
  group.add(innerRing);

  if (track.reviewPlatformRadius > 0) {
    const platHeight = 1.2;
    const platGeo = new T.CylinderGeometry(track.reviewPlatformRadius, track.reviewPlatformRadius, platHeight, 48);
    const platMat = new T.MeshStandardMaterial({
      color: day ? 0xb3d9aa : 0x1b1726,
      emissive: day ? 0x10220c : 0x7b75ff,
      emissiveIntensity: day ? 0.05 : 0.2,
      roughness: 0.5,
      metalness: 0.35,
    });
    const plat = new T.Mesh(platGeo, platMat);
    // Base at y = 0.62 clears innerRing (y = 0.58) with zero coplanar overlap.
    plat.position.set(floor.cx, 0.62 + platHeight * 0.5, floor.cy);
    plat.receiveShadow = true;
    group.add(plat);
    THREE_STATE.reviewPlatformMesh = plat;
  }
}


export function build3DArenaBoundaryMarkers(group, track) {
  if (!window.THREE || !track?.arenaBoundaryLandmarks?.length) return;
  const T = window.THREE;
  const day = isDayMode();
  const landmarks = track.arenaBoundaryLandmarks;
  const panelGeo = new T.BoxGeometry(14, 18, 1.2);
  const capGeo = new T.BoxGeometry(16, 2.5, 1.6);
  const panelMat = new T.MeshStandardMaterial({
    color: day ? 0x1b1726 : 0x131019,
    emissive: day ? 0x2a2860 : 0x0a0818,
    emissiveIntensity: day ? 0.06 : 0.25,
    roughness: 0.55,
    metalness: 0.35,
  });
  const capMat = new T.MeshStandardMaterial({
    color: 0xfd9927,
    emissive: 0x442208,
    emissiveIntensity: day ? 0.12 : 0.45,
    roughness: 0.4,
    metalness: 0.5,
  });
  const panelMesh = new T.InstancedMesh(panelGeo, panelMat, landmarks.length);
  const capMesh = new T.InstancedMesh(capGeo, capMat, landmarks.length);
  const m4 = new T.Matrix4();
  const q = new T.Quaternion();
  const pos = new T.Vector3();
  const scl = new T.Vector3(1, 1, 1);
  const up = new T.Vector3(0, 1, 0);
  landmarks.forEach((lm, i) => {
    q.setFromAxisAngle(up, -lm.ang);
    pos.set(lm.x, 9, lm.y);
    m4.compose(pos, q, scl);
    panelMesh.setMatrixAt(i, m4);
    pos.set(lm.x, 19, lm.y);
    m4.compose(pos, q, scl);
    capMesh.setMatrixAt(i, m4);
  });
  panelMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
  group.add(panelMesh);
  group.add(capMesh);
  THREE_STATE.arenaMarkerPanelMesh = panelMesh;
  THREE_STATE.arenaMarkerCapMesh = capMesh;
}


export function buildRampWedgeGeometry3D(T, length, width, height) {
  const l = length * 0.5;
  const w = width * 0.5;
  const positions = [
    -l, 0, -w,  -l, 0, w,   l, 0, w,   l, 0, -w,
    -l, 0.4, -w, -l, 0.4, w, l, height, w, l, height, -w,
  ];
  const indices = [
    4, 5, 6, 4, 6, 7, // sloped driving surface
    0, 2, 1, 0, 3, 2, // underside
    0, 4, 7, 0, 7, 3, // side
    1, 2, 6, 1, 6, 5, // side
    0, 1, 5, 0, 5, 4, // entry
    3, 7, 6, 3, 6, 2, // launch lip
  ];
  const colors = [
    0.08, 0.07, 0.12, 0.08, 0.07, 0.12, 0.18, 0.11, 0.04, 0.18, 0.11, 0.04,
    0.24, 0.22, 0.42, 0.24, 0.22, 0.42, 0.99, 0.60, 0.15, 0.99, 0.60, 0.15,
  ];
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}


export function buildRoundedBumpGeometry3D(T, length, width, height, segments = 6) {
  const positions = [];
  const colors = [];
  const indices = [];
  const l = length * 0.5;
  const w = width * 0.5;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = lerp(-l, l, t);
    const y = 0.3 + Math.sin(t * Math.PI) * height;
    const glow = 0.72 + Math.sin(t * Math.PI) * 0.28;
    // top left/right, then matching bottom left/right
    positions.push(x, y, -w, x, y, w, x, 0, -w, x, 0, w);
    colors.push(
      glow, 0.42 * glow, 0.08, glow, 0.42 * glow, 0.08,
      0.28, 0.14, 0.04, 0.28, 0.14, 0.04
    );
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    indices.push(
      a, b, b + 1, a, b + 1, a + 1,         // curved top
      a + 2, a + 3, b + 3, a + 2, b + 3, b + 2, // bottom
      a, a + 2, b + 2, a, b + 2, b,         // left side
      a + 1, b + 1, b + 3, a + 1, b + 3, a + 3 // right side
    );
  }
  const end = segments * 4;
  indices.push(0, 1, 3, 0, 3, 2, end, end + 2, end + 3, end, end + 3, end + 1);
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}


export function build3DRamps(group, track) {
  if (!window.THREE || !track?.ramps?.length) return;
  const T = window.THREE;
  const day = isDayMode();
  for (const ramp of track.ramps) {
    let mesh;
    if (ramp.kind === "bump") {
      const bumpHeight = clamp(ramp.h * 0.2, 3.5, 5);
      const geo = buildRoundedBumpGeometry3D(T, ramp.w, ramp.h, bumpHeight);
      const mat = new T.MeshStandardMaterial({
        vertexColors: true,
        emissive: 0x442208,
        emissiveIntensity: day ? 0.06 : 0.24,
        roughness: 0.72,
        metalness: 0.12,
      });
      mesh = new T.Mesh(geo, mat);
      mesh.position.set(ramp.x, 0.55, ramp.y);
      mesh.rotation.y = -ramp.ang;
      mesh.userData.rampHeight = bumpHeight;
    } else {
      const rampHeight = clamp(ramp.w * 0.09, 10, 18);
      const geo = buildRampWedgeGeometry3D(T, ramp.w, ramp.h, rampHeight);
      const mat = new T.MeshStandardMaterial({
        vertexColors: true,
        emissive: day ? 0x120c20 : 0x131019,
        emissiveIntensity: day ? 0.04 : 0.22,
        roughness: 0.58,
        metalness: 0.22,
      });
      mesh = new T.Mesh(geo, mat);
      mesh.position.set(ramp.x, 0.55, ramp.y);
      mesh.rotation.y = -ramp.ang;
      mesh.userData.rampHeight = rampHeight;
    }
    mesh.userData.rampKind = ramp.kind;
    group.add(mesh);
    THREE_STATE.rampMeshes.push(mesh);
  }
}


let _chevronTexLeft3D = null;
let _chevronTexRight3D = null;
let _citationLabelTex3D = null;

function getChevronSignTexture3D(T, turnRight) {
  if (turnRight && _chevronTexRight3D) return _chevronTexRight3D;
  if (!turnRight && _chevronTexLeft3D) return _chevronTexLeft3D;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const cx = c.getContext("2d");
  cx.fillStyle = "#12101d";
  cx.fillRect(0, 0, 128, 64);
  cx.strokeStyle = "#fd9927";
  cx.lineWidth = 4;
  cx.strokeRect(3, 3, 122, 58);

  const dir = turnRight ? 1 : -1;
  for (let k = 0; k < 2; k++) {
    const ox = 64 + (k - 0.5) * 32 * dir;
    cx.strokeStyle = k === 1 ? "#ffd86b" : "#fd9927";
    cx.lineWidth = 8;
    cx.lineCap = "round";
    cx.lineJoin = "round";
    cx.beginPath();
    cx.moveTo(ox - 12 * dir, 16);
    cx.lineTo(ox + 10 * dir, 32);
    cx.lineTo(ox - 12 * dir, 48);
    cx.stroke();
  }

  const tex = new T.CanvasTexture(c);
  if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
  tex.userData = { shared: true };
  tex.needsUpdate = true;
  if (turnRight) _chevronTexRight3D = tex;
  else _chevronTexLeft3D = tex;
  return tex;
}

export function build3DCornerChevrons(group, track, edges) {
  if (!window.THREE || !track || track.arenaFloor || !edges || edges.length < 3) return;
  const T = window.THREE;
  const n = edges.length;
  const startIdx = track.isOpen ? 1 : 0;
  const endIdx = track.isOpen ? n - 1 : n;

  const postGeo = new T.CylinderGeometry(1.1, 1.3, 16, 6);
  const boardGeo = new T.BoxGeometry(20, 11, 1.6);
  const faceGeo = new T.PlaneGeometry(18.5, 9.5);
  const postMat = new T.MeshStandardMaterial({ color: 0x222036, metalness: 0.7, roughness: 0.35 });
  const boardMat = new T.MeshStandardMaterial({ color: 0x131019, metalness: 0.5, roughness: 0.45 });
  const faceMatRight = new T.MeshStandardMaterial({
    map: getChevronSignTexture3D(T, true),
    emissive: 0xffffff,
    emissiveMap: getChevronSignTexture3D(T, true),
    emissiveIntensity: 0.95,
    roughness: 0.3,
  });
  const faceMatLeft = new T.MeshStandardMaterial({
    map: getChevronSignTexture3D(T, false),
    emissive: 0xffffff,
    emissiveMap: getChevronSignTexture3D(T, false),
    emissiveIntensity: 0.95,
    roughness: 0.3,
  });

  let lastSignX = -99999;
  let lastSignY = -99999;
  for (let i = startIdx; i < endIdx; i++) {
    const prev = edges[(i - 1 + n) % n].center;
    const curr = edges[i].center;
    const next = edges[(i + 1) % n].center;
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const l1 = Math.hypot(dx1, dy1), l2 = Math.hypot(dx2, dy2);
    if (l1 < 1 || l2 < 1) continue;
    const u1x = dx1 / l1, u1y = dy1 / l1;
    const u2x = dx2 / l2, u2y = dy2 / l2;
    const cross = u1x * u2y - u1y * u2x;
    const dot = clamp(u1x * u2x + u1y * u2y, -1, 1);
    const turnAngle = Math.atan2(cross, dot);
    if (Math.abs(turnAngle) <= 0.42) continue;

    const edgePt = turnAngle > 0 ? edges[i].right : edges[i].left;
    let ox = edgePt.x - curr.x;
    let oz = edgePt.y - curr.y;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;

    const sx = edgePt.x + ox * 14;
    const sz = edgePt.y + oz * 14;
    if (Math.hypot(sx - lastSignX, sz - lastSignY) < 70) continue;
    lastSignX = sx;
    lastSignY = sz;

    const signGroup = new T.Group();
    const post = new T.Mesh(postGeo, postMat);
    post.position.y = 8;
    signGroup.add(post);

    const board = new T.Mesh(boardGeo, boardMat);
    board.position.y = 18;
    signGroup.add(board);

    const face = new T.Mesh(faceGeo, turnAngle > 0 ? faceMatRight : faceMatLeft);
    face.position.set(0, 18, 0.9);
    signGroup.add(face);

    const faceDirX = -u1x * 0.72 - ox * 0.28;
    const faceDirZ = -u1y * 0.72 - oz * 0.28;
    signGroup.position.set(sx, 0, sz);
    signGroup.rotation.y = Math.atan2(faceDirX, faceDirZ);
    group.add(signGroup);
    THREE_STATE.chevronMeshes.push(signGroup);
  }
}


const _gantryBannerTexCache = new Map();

function getMapTrackStyle3D(mapId, day) {
  switch (mapId) {
    case "compliance_chicane":
      return {
        roadAccent: "#b36bff",
        curbA: [0.96, 0.24, 0.36],
        curbB: [0.95, 0.96, 1.0],
        wallLeft: [0.62, 0.3, 1.0],
        wallRight: [1.0, 0.32, 0.48],
        wallDark: day ? [0.2, 0.18, 0.32] : [0.12, 0.1, 0.22],
        railLeftHex: 0xb36bff,
        railRightHex: 0xff4d6d,
        gantryAccent: "#b36bff",
        gantryAccentHex: 0xb36bff,
        propStyle: "server",
      };
    case "audit_super_ring":
      return {
        roadAccent: "#56f2a0",
        curbA: [0.34, 0.95, 0.62],
        curbB: [1.0, 0.84, 0.34],
        wallLeft: [0.28, 0.9, 0.58],
        wallRight: [0.34, 0.88, 1.0],
        wallDark: day ? [0.15, 0.24, 0.24] : [0.09, 0.16, 0.16],
        railLeftHex: 0x56f2a0,
        railRightHex: 0x57f2ff,
        gantryAccent: "#a4ff80",
        gantryAccentHex: 0xa4ff80,
        propStyle: "stadium",
      };
    case "black_ice_data_vault":
      return {
        roadAccent: "#57f2ff",
        curbA: [0.34, 0.94, 1.0],
        curbB: [0.9, 0.96, 1.0],
        wallLeft: [0.32, 0.88, 1.0],
        wallRight: [0.48, 0.68, 1.0],
        wallDark: day ? [0.16, 0.24, 0.32] : [0.08, 0.14, 0.22],
        railLeftHex: 0x57f2ff,
        railRightHex: 0xa6e8ff,
        gantryAccent: "#57f2ff",
        gantryAccentHex: 0x57f2ff,
        propStyle: "ice",
      };
    case "protocol_amendment_labyrinth":
      return {
        roadAccent: "#fd9927",
        curbA: [0.99, 0.6, 0.16],
        curbB: [0.96, 0.26, 0.36],
        wallLeft: [0.99, 0.64, 0.18],
        wallRight: [0.95, 0.32, 0.42],
        wallDark: day ? [0.26, 0.21, 0.18] : [0.16, 0.12, 0.11],
        railLeftHex: 0xfd9927,
        railRightHex: 0xff5a6e,
        gantryAccent: "#fd9927",
        gantryAccentHex: 0xfd9927,
        propStyle: "labyrinth",
      };
    case "regulatory_dragon_run":
      return {
        roadAccent: "#ff5c6c",
        curbA: [0.98, 0.28, 0.34],
        curbB: [1.0, 0.82, 0.32],
        wallLeft: [0.98, 0.3, 0.34],
        wallRight: [1.0, 0.72, 0.22],
        wallDark: day ? [0.28, 0.16, 0.18] : [0.18, 0.09, 0.12],
        railLeftHex: 0xff4d6d,
        railRightHex: 0xffd86b,
        gantryAccent: "#ffd86b",
        gantryAccentHex: 0xffd86b,
        propStyle: "dragon",
      };
    case "dragon_escape":
      return {
        roadAccent: "#66d88a",
        curbA: [0.38, 0.86, 0.56],
        curbB: [0.95, 0.28, 0.32],
        wallLeft: [0.35, 0.78, 0.5],
        wallRight: [0.92, 0.28, 0.3],
        wallDark: day ? [0.16, 0.24, 0.18] : [0.09, 0.14, 0.1],
        railLeftHex: 0x66d88a,
        railRightHex: 0xff4d6d,
        gantryAccent: "#66d88a",
        gantryAccentHex: 0x66d88a,
        propStyle: "dragon",
      };
    default:
      return {
        roadAccent: "#7b75ff",
        curbA: [0.48, 0.46, 1.0],
        curbB: [0.64, 1.0, 0.5],
        wallLeft: [0.48, 0.46, 1.0],
        wallRight: [0.99, 0.6, 0.15],
        wallDark: day ? [0.18, 0.16, 0.34] : [0.11, 0.09, 0.22],
        railLeftHex: 0x7b75ff,
        railRightHex: 0xfd9927,
        gantryAccent: "#ffd86b",
        gantryAccentHex: 0xffd86b,
        propStyle: "server",
      };
  }
}

function getGantryBannerTexture3D(T, trackName, accentHex) {
  const key = `${trackName}:${accentHex}`;
  if (_gantryBannerTexCache.has(key)) return _gantryBannerTexCache.get(key);
  const w = 1024, h = 80;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");

  cx.fillStyle = "#12101f";
  cx.fillRect(0, 0, w, h);

  // Checkered left & right racing wings
  const sq = 16;
  for (let row = 0; row < h / sq; row++) {
    for (let col = 0; col < 5; col++) {
      cx.fillStyle = (row + col) % 2 === 0 ? "#f4f6ff" : "#1c192e";
      cx.fillRect(col * sq, row * sq, sq, sq);
      cx.fillRect(w - (col + 1) * sq, row * sq, sq, sq);
    }
  }

  // Top & bottom neon accent bars
  cx.fillStyle = accentHex;
  cx.fillRect(80, 3, w - 160, 5);
  cx.fillRect(80, h - 8, w - 160, 5);

  // Track name + subtitle
  cx.fillStyle = "#ffffff";
  cx.font = "900 32px 'Segoe UI', system-ui, sans-serif";
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText((trackName || "AUDIT TRAIL CIRCUIT").toUpperCase(), w / 2, h * 0.42, w - 190);

  cx.fillStyle = accentHex;
  cx.font = "700 15px 'SFMono-Regular', Consolas, monospace";
  cx.fillText("START   ///   FINISH", w / 2, h * 0.77);

  const tex = new T.CanvasTexture(c);
  if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
  tex.userData = { shared: true };
  tex.needsUpdate = true;
  _gantryBannerTexCache.set(key, tex);
  return tex;
}

export function rebuild3DTrack() {
  if (!window.THREE || !THREE_STATE.scene || !game.track) return;
  const T = window.THREE;
  const sc = THREE_STATE.scene;

  // Remove old track/world meshes
  if (THREE_STATE.trackGroup) {
    sc.remove(THREE_STATE.trackGroup);
    dispose3DObject(THREE_STATE.trackGroup);
    THREE_STATE.trackGroup = null;
  }
  THREE_STATE.trackMesh = null;
  THREE_STATE.arenaFloorMesh = null;
  THREE_STATE.reviewPlatformMesh = null;
  THREE_STATE.arenaMarkerPanelMesh = null;
  THREE_STATE.arenaMarkerCapMesh = null;
  THREE_STATE.rampMeshes = [];
  if (THREE_STATE.chevronMeshes?.length) {
    THREE_STATE.chevronMeshes.forEach(m => { sc.remove(m); dispose3DObject(m); });
  }
  THREE_STATE.chevronMeshes = [];
  // Remove old kart models
  THREE_STATE.kartModels.forEach(m => {
    sc.remove(m);
    dispose3DObject(m);
  });
  THREE_STATE.kartModels.clear();
  disposeTethers3D();
  if (THREE_STATE._ultAuras) {
    THREE_STATE._ultAuras.forEach(a => { sc.remove(a); dispose3DObject(a); });
    THREE_STATE._ultAuras.clear();
  }
  if (THREE_STATE._shockwaves?.length) {
    THREE_STATE._shockwaves.forEach(sw => {
      sc.remove(sw.mesh);
      dispose3DObject(sw.mesh);
      if (sw.light) sc.remove(sw.light);
    });
    THREE_STATE._shockwaves.length = 0;
  }
  THREE_STATE.itemMeshes = [];
  THREE_STATE.coinMeshes = [];
  THREE_STATE.boostPadMeshes = [];
  THREE_STATE.movingObjectMeshes = [];
  THREE_STATE.hazardMeshes.forEach(m => { sc.remove(m); dispose3DObject(m); });
  THREE_STATE.hazardMeshes.clear();
  if (THREE_STATE.dragonModel) { sc.remove(THREE_STATE.dragonModel); dispose3DObject(THREE_STATE.dragonModel); THREE_STATE.dragonModel = null; }
  if (THREE_STATE.dragonEscapeModel) { sc.remove(THREE_STATE.dragonEscapeModel); dispose3DObject(THREE_STATE.dragonEscapeModel); THREE_STATE.dragonEscapeModel = null; }
  // Clean enhancement state
  THREE_STATE.spectatorMeshes.forEach(s => { sc.remove(s.group); dispose3DObject(s.group); });
  THREE_STATE.spectatorMeshes = [];
  if (THREE_STATE.startLineMesh) { sc.remove(THREE_STATE.startLineMesh); dispose3DObject(THREE_STATE.startLineMesh); THREE_STATE.startLineMesh = null; }
  THREE_STATE.startLightMats = [];
  if (THREE_STATE.particles3dSystem) { sc.remove(THREE_STATE.particles3dSystem); dispose3DObject(THREE_STATE.particles3dSystem); THREE_STATE.particles3dSystem = null; }
  reset3DParticlePool();
  THREE_STATE.pillarRings = [];
  if (THREE_STATE._sceneryGroup) { sc.remove(THREE_STATE._sceneryGroup); dispose3DObject(THREE_STATE._sceneryGroup); THREE_STATE._sceneryGroup = null; }
  // Clean up old name tags / speech bubbles from previous track
  THREE_STATE.nameTagSprites.forEach(s => {
    sc.remove(s);
    s.material.map?.dispose();
    s.material.dispose();
  });
  THREE_STATE.nameTagSprites.clear();
  THREE_STATE.speechBubbleSprites.forEach(s => {
    sc.remove(s);
    s.material.map?.dispose();
    s.material.dispose();
  });
  THREE_STATE.speechBubbleSprites.clear();

  const group = new T.Group();
  THREE_STATE.trackGroup = group;
  sc.add(group);
  THREE_STATE.rampMeshes = [];

  if (game.track.arenaFloor) {
    build3DArenaFloor(group, game.track);
    build3DRamps(group, game.track);
    build3DArenaBoundaryMarkers(group, game.track);
  }

  // Build track ribbon from waypoints with arc-length UVs
  const wp = game.track.waypoints;
  const verts = [];
  const colors = [];
  const roadUvs = [];
  const edges = get3DRoadEdges(game.track);
  const segmentCount = game.track.isOpen ? edges.length - 1 : edges.length;
  let cumDist = 0;

  for (let i = 0; i < segmentCount; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    if (!e0 || !e1) continue;

    const segLen = Math.hypot(e1.center.x - e0.center.x, e1.center.y - e0.center.y);
    const u0 = cumDist / 160;
    cumDist += segLen;
    const u1 = cumDist / 160;

    // Wound CCW when viewed from +Y so vertex normals point upward (+Y) for lighting & front-face rendering
    verts.push(e0.left.x, 0, e0.left.y, e1.left.x, 0, e1.left.y, e0.right.x, 0, e0.right.y);
    verts.push(e0.right.x, 0, e0.right.y, e1.left.x, 0, e1.left.y, e1.right.x, 0, e1.right.y);
    roadUvs.push(
      u0, 0,
      u1, 0,
      u0, 1,
      u0, 1,
      u1, 0,
      u1, 1
    );

    // Edge glow coloring
    for (let v = 0; v < 6; v++) {
      colors.push(0.05, 0.04, 0.13);
    }
  }

  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(roadUvs, 2));
  geo.computeVertexNormals();

  const activeMap = getActiveMapConfig(game);
  const currentMapId = activeMap.id;
  const roadDay = isDayMode();
  const trackStyle = getMapTrackStyle3D(currentMapId, roadDay);
  const roadTexture = getCompassSurfaceTexture3D(T, "road", roadDay, trackStyle.roadAccent);
  roadTexture.repeat.set(1, 1);
  const roadMat = new T.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTexture,
    emissive: roadDay ? 0x000000 : 0x131019,
    emissiveIntensity: roadDay ? 0 : 0.14,
    roughness: 0.74,
    metalness: 0.14,
    vertexColors: false,
    side: T.DoubleSide,
  });
  THREE_STATE.trackMesh = new T.Mesh(geo, roadMat);
  THREE_STATE.trackMesh.position.y = 0.5;
  THREE_STATE.trackMesh.receiveShadow = true;
  group.add(THREE_STATE.trackMesh);

  // Raised 3D racing curbs (subdivided into crisp alternating blocks with beveled profile)
  const rumbleVerts = [];
  const rumbleColors = [];
  const rumbleExtra = 10;
  const curbCrestY = 1.45;
  const curbInnerY = 0.52;
  const curbOuterY = 0.25;
  let curbBlockCounter = 0;
  for (let i = 0; i < segmentCount; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    if (!e0 || !e1) continue;
    const c0 = e0.center, c1 = e1.center;
    const segLen = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    const subDivs = Math.max(1, Math.min(10, Math.round(segLen / 95)));
    for (let side of [-1, 1]) {
      const s0 = side === 1 ? e0.left : e0.right;
      const s1 = side === 1 ? e1.left : e1.right;
      const dx0 = s0.x - c0.x, dy0 = s0.y - c0.y;
      const dl0 = Math.hypot(dx0, dy0) || 1;
      const dx1 = s1.x - c1.x, dy1 = s1.y - c1.y;
      const dl1 = Math.hypot(dx1, dy1) || 1;
      const nx0 = dx0 / dl0, nz0 = dy0 / dl0;
      const nx1 = dx1 / dl1, nz1 = dy1 / dl1;

      for (let sub = 0; sub < subDivs; sub++) {
        const t0 = sub / subDivs;
        const t1 = (sub + 1) / subDivs;
        const ix0 = lerp(s0.x, s1.x, t0), iz0 = lerp(s0.y, s1.y, t0);
        const ix1 = lerp(s0.x, s1.x, t1), iz1 = lerp(s0.y, s1.y, t1);
        const mx0 = ix0 + lerp(nx0, nx1, t0) * (rumbleExtra * 0.45);
        const mz0 = iz0 + lerp(nz0, nz1, t0) * (rumbleExtra * 0.45);
        const mx1 = ix1 + lerp(nx0, nx1, t1) * (rumbleExtra * 0.45);
        const mz1 = iz1 + lerp(nz0, nz1, t1) * (rumbleExtra * 0.45);
        const ox0 = ix0 + lerp(nx0, nx1, t0) * rumbleExtra;
        const oz0 = iz0 + lerp(nz0, nz1, t0) * rumbleExtra;
        const ox1 = ix1 + lerp(nx0, nx1, t1) * rumbleExtra;
        const oz1 = iz1 + lerp(nz0, nz1, t1) * rumbleExtra;

        const r = ((curbBlockCounter + sub) % 2 === 0) ? trackStyle.curbA : trackStyle.curbB;
        // Inner bevel up to crest + outer bevel down to ground
        if (side === 1) {
          rumbleVerts.push(ix0, curbInnerY, iz0, mx0, curbCrestY, mz0, ix1, curbInnerY, iz1);
          rumbleVerts.push(mx0, curbCrestY, mz0, mx1, curbCrestY, mz1, ix1, curbInnerY, iz1);
          rumbleVerts.push(mx0, curbCrestY, mz0, ox0, curbOuterY, oz0, mx1, curbCrestY, mz1);
          rumbleVerts.push(ox0, curbOuterY, oz0, ox1, curbOuterY, oz1, mx1, curbCrestY, mz1);
        } else {
          rumbleVerts.push(ix0, curbInnerY, iz0, ix1, curbInnerY, iz1, mx0, curbCrestY, mz0);
          rumbleVerts.push(mx0, curbCrestY, mz0, ix1, curbInnerY, iz1, mx1, curbCrestY, mz1);
          rumbleVerts.push(mx0, curbCrestY, mz0, mx1, curbCrestY, mz1, ox0, curbOuterY, oz0);
          rumbleVerts.push(ox0, curbOuterY, oz0, mx1, curbCrestY, mz1, ox1, curbOuterY, oz1);
        }
        for (let v = 0; v < 12; v++) rumbleColors.push(r[0], r[1], r[2]);
      }
    }
    curbBlockCounter += subDivs;
  }
  if (rumbleVerts.length > 0) {
    const rGeo = new T.BufferGeometry();
    rGeo.setAttribute("position", new T.Float32BufferAttribute(rumbleVerts, 3));
    rGeo.setAttribute("color", new T.Float32BufferAttribute(rumbleColors, 3));
    rGeo.computeVertexNormals();
    const rMat = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.18,
      emissive: 0x111111,
      emissiveIntensity: roadDay ? 0.08 : 0.28,
      side: T.DoubleSide,
    });
    const rumble = new T.Mesh(rGeo, rMat);
    group.add(rumble);
  }

  // 3D barrier walls + solid glowing top-rail ribbons + instanced metallic stanchion posts
  const barrierH = 14;
  const barrierOffset = 9;
  const stanchionTransforms = [];
  for (let side = -1; side <= 1; side += 2) {
    const wallVerts = [];
    const wallColors = [];
    const railVerts = [];
    let wallPanelIdx = 0;
    for (let i = 0; i < segmentCount; i++) {
      const e0 = edges[i];
      const e1 = edges[(i + 1) % edges.length];
      if (!e0 || !e1) continue;
      const c0 = e0.center, c1 = e1.center;
      const s0 = side === 1 ? e0.left : e0.right;
      const s1 = side === 1 ? e1.left : e1.right;
      const dx0 = s0.x - c0.x, dy0 = s0.y - c0.y;
      const dl0 = Math.hypot(dx0, dy0) || 1;
      const dx1 = s1.x - c1.x, dy1 = s1.y - c1.y;
      const dl1 = Math.hypot(dx1, dy1) || 1;
      const nx0 = dx0 / dl0, nz0 = dy0 / dl0;
      const nx1 = dx1 / dl1, nz1 = dy1 / dl1;
      const b0x = s0.x + nx0 * barrierOffset;
      const b0z = s0.y + nz0 * barrierOffset;
      const b1x = s1.x + nx1 * barrierOffset;
      const b1z = s1.y + nz1 * barrierOffset;
      const bLen = Math.hypot(b1x - b0x, b1z - b0z);
      const subPanels = Math.max(1, Math.min(8, Math.round(bLen / 170)));

      for (let sp = 0; sp < subPanels; sp++) {
        const t0 = sp / subPanels;
        const t1 = (sp + 1) / subPanels;
        const px0 = lerp(b0x, b1x, t0), pz0 = lerp(b0z, b1z, t0);
        const px1 = lerp(b0x, b1x, t1), pz1 = lerp(b0z, b1z, t1);
        wallVerts.push(px0, 0, pz0, px1, 0, pz1, px0, barrierH, pz0);
        wallVerts.push(px1, 0, pz1, px1, barrierH, pz1, px0, barrierH, pz0);
        const isAccent = ((wallPanelIdx + sp) % 3 === 0);
        const cr = isAccent
          ? (side === 1 ? trackStyle.wallLeft : trackStyle.wallRight)
          : trackStyle.wallDark;
        for (let v = 0; v < 6; v++) wallColors.push(cr[0], cr[1], cr[2]);

        // Collect stanchion post position at panel joints
        stanchionTransforms.push({ x: px0, z: pz0 });
      }
      wallPanelIdx += subPanels;

      // 3D top-rail cap ribbon (2.8 units wide so it reads clearly instead of a 1px WebGL line)
      const railHalf = 1.6;
      const ry = barrierH + 0.7;
      const rIn0x = b0x - nx0 * railHalf, rIn0z = b0z - nz0 * railHalf;
      const rOut0x = b0x + nx0 * railHalf, rOut0z = b0z + nz0 * railHalf;
      const rIn1x = b1x - nx1 * railHalf, rIn1z = b1z - nz1 * railHalf;
      const rOut1x = b1x + nx1 * railHalf, rOut1z = b1z + nz1 * railHalf;
      railVerts.push(rIn0x, ry, rIn0z, rOut0x, ry, rOut0z, rIn1x, ry, rIn1z);
      railVerts.push(rOut0x, ry, rOut0z, rOut1x, ry, rOut1z, rIn1x, ry, rIn1z);
    }
    if (wallVerts.length > 0) {
      const wGeo = new T.BufferGeometry();
      wGeo.setAttribute("position", new T.Float32BufferAttribute(wallVerts, 3));
      wGeo.setAttribute("color", new T.Float32BufferAttribute(wallColors, 3));
      wGeo.computeVertexNormals();
      const wMat = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.45,
        metalness: 0.55,
        emissive: side === 1 ? trackStyle.railLeftHex : trackStyle.railRightHex,
        emissiveIntensity: roadDay ? 0.08 : 0.24,
        transparent: true,
        opacity: roadDay ? 0.92 : 0.86,
        side: T.DoubleSide,
      });
      const wall = new T.Mesh(wGeo, wMat);
      wall.position.y = 0.5;
      group.add(wall);
    }
    if (railVerts.length > 0) {
      const rGeo = new T.BufferGeometry();
      rGeo.setAttribute("position", new T.Float32BufferAttribute(railVerts, 3));
      rGeo.computeVertexNormals();
      const railHex = side === 1 ? trackStyle.railLeftHex : trackStyle.railRightHex;
      const railMat = new T.MeshStandardMaterial({
        color: railHex,
        emissive: railHex,
        emissiveIntensity: roadDay ? 0.55 : 1.15,
        roughness: 0.25,
        metalness: 0.5,
        side: T.DoubleSide,
      });
      group.add(new T.Mesh(rGeo, railMat));
    }
  }
  if (stanchionTransforms.length > 0 && !game.track.arenaFloor) {
    const postGeo = new T.BoxGeometry(2.6, barrierH + 2.2, 2.6);
    const postMat = new T.MeshStandardMaterial({
      color: roadDay ? 0x2c2b3d : 0x1c1a2c,
      roughness: 0.4,
      metalness: 0.72,
    });
    const inst = new T.InstancedMesh(postGeo, postMat, stanchionTransforms.length);
    const m4 = new T.Matrix4();
    const pos = new T.Vector3();
    const q = new T.Quaternion();
    const scl = new T.Vector3(1, 1, 1);
    for (let i = 0; i < stanchionTransforms.length; i++) {
      pos.set(stanchionTransforms[i].x, (barrierH + 2.2) * 0.5, stanchionTransforms[i].z);
      m4.compose(pos, q, scl);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // Center dashed line (kept subtle since road texture already carries crisp markings)
  const centerVerts = [];
  for (let i = 0; i < wp.length; i++) {
    centerVerts.push(wp[i].x, 0.85, wp[i].y);
  }
  if (centerVerts.length > 3) {
    const centerGeo = new T.BufferGeometry();
    centerGeo.setAttribute("position", new T.Float32BufferAttribute(centerVerts, 3));
    const centerMat = new T.LineDashedMaterial({
      color: trackStyle.railLeftHex,
      dashSize: 24,
      gapSize: 36,
      transparent: true,
      opacity: 0.45,
      linewidth: 1,
    });
    const centerLine = game.track.isOpen ? new T.Line(centerGeo, centerMat) : new T.LineLoop(centerGeo, centerMat);
    centerLine.computeLineDistances();
    group.add(centerLine);
  }

  build3DCornerChevrons(group, game.track, edges);

  if (!game.track.isOpen && !isBattleMode()) {
    const gate = game.track.startLineGate();
    if (gate) {
      const lx = gate.x + gate.nx * (gate.halfW + 8);
      const ly = gate.y + gate.ny * (gate.halfW + 8);
      const rx = gate.x - gate.nx * (gate.halfW + 8);
      const ry = gate.y - gate.ny * (gate.halfW + 8);
      const archW = (gate.halfW + 8) * 2;
      const archH = 48;
      const archYaw = -Math.atan2(gate.ny, gate.nx);
      const archGroup = new T.Group();
      const darkSteelMat = new T.MeshStandardMaterial({
        color: 0x1d1c2e,
        metalness: 0.78,
        roughness: 0.28,
      });
      const accentArchMat = new T.MeshStandardMaterial({
        color: trackStyle.gantryAccentHex,
        emissive: trackStyle.gantryAccentHex,
        emissiveIntensity: roadDay ? 0.45 : 0.9,
        metalness: 0.7,
        roughness: 0.25,
      });

      // Twin architectural support towers with wide bases and glowing accent strips
      const towerGeo = new T.BoxGeometry(6.5, archH, 8.5);
      const baseGeo = new T.BoxGeometry(10, 5, 12);
      const stripGeo = new T.BoxGeometry(1.6, archH - 8, 9.2);
      for (const [px, pz] of [[lx, ly], [rx, ry]]) {
        const tGroup = new T.Group();
        tGroup.position.set(px, 0, pz);
        tGroup.rotation.y = archYaw;
        const base = new T.Mesh(baseGeo, darkSteelMat);
        base.position.y = 2.5;
        tGroup.add(base);
        const tower = new T.Mesh(towerGeo, darkSteelMat);
        tower.position.y = archH * 0.5;
        tower.castShadow = ENABLE_3D_SHADOWS;
        tGroup.add(tower);
        const strip = new T.Mesh(stripGeo, accentArchMat);
        strip.position.y = archH * 0.5;
        tGroup.add(strip);
        archGroup.add(tGroup);
      }

      // Overhead gantry bridge & custom track-name banner
      const bridgeGroup = new T.Group();
      bridgeGroup.position.set(gate.x, archH, gate.y);
      bridgeGroup.rotation.y = archYaw;

      const topBeam = new T.Mesh(new T.BoxGeometry(archW + 10, 4.5, 9), darkSteelMat);
      topBeam.castShadow = ENABLE_3D_SHADOWS;
      bridgeGroup.add(topBeam);

      const trimTop = new T.Mesh(new T.BoxGeometry(archW + 11, 1.4, 9.6), accentArchMat);
      trimTop.position.y = 2.7;
      bridgeGroup.add(trimTop);

      const bannerTex = getGantryBannerTexture3D(T, activeMap.name, trackStyle.gantryAccent);
      const bannerGeo = new T.BoxGeometry(archW * 0.88, 15, 2.2);
      const bannerFaceMat = new T.MeshStandardMaterial({
        map: bannerTex,
        emissive: 0xffffff,
        emissiveMap: bannerTex,
        emissiveIntensity: roadDay ? 0.35 : 0.72,
        roughness: 0.35,
        metalness: 0.2,
      });
      const banner = new T.Mesh(bannerGeo, [
        darkSteelMat, darkSteelMat, darkSteelMat, darkSteelMat, bannerFaceMat, bannerFaceMat,
      ]);
      banner.position.y = -8.5;
      bridgeGroup.add(banner);

      // 5 hanging F1-style start light pods underneath the banner
      const podHousingGeo = new T.BoxGeometry(7.2, 5.2, 4.2);
      const lensGeo = new T.CylinderGeometry(1.7, 1.7, 4.6, 12);
      lensGeo.rotateX(Math.PI / 2);
      const podSpacing = Math.min(18, (archW * 0.52) / 4);
      for (let li = 0; li < 5; li++) {
        const px = (li - 2) * podSpacing;
        const housing = new T.Mesh(podHousingGeo, darkSteelMat);
        housing.position.set(px, -18.5, 0);
        bridgeGroup.add(housing);
        const lensMat = new T.MeshStandardMaterial({
          color: 0x22cc66,
          emissive: 0x22ff77,
          emissiveIntensity: 1.1,
          roughness: 0.2,
        });
        const lens = new T.Mesh(lensGeo, lensMat);
        lens.position.set(px, -18.5, 0);
        bridgeGroup.add(lens);
        THREE_STATE.startLightMats.push(lensMat);
      }

      archGroup.add(bridgeGroup);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const archLight = new T.PointLight(trackStyle.gantryAccentHex, 0.7, 160);
        archLight.position.set(gate.x, archH + 5, gate.y);
        archGroup.add(archLight);
      }
      group.add(archGroup);
    }
  }

  // Build kart models for all active karts
  buildAllKartModels();

  if (game.track.itemBoxes) {
    game.track.itemBoxes.forEach(ib => {
      const boxGroup = new T.Group();
      const outerGeo = new T.DodecahedronGeometry(22, 0);
      const outerMat = new T.MeshStandardMaterial({
        color: 0xffd86b,
        emissive: 0xffd86b,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      });
      boxGroup.add(new T.Mesh(outerGeo, outerMat));
      const midGeo = new T.IcosahedronGeometry(19, 0);
      const midMat = new T.MeshStandardMaterial({
        color: 0xffd86b,
        emissive: 0xffd86b,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.2,
        wireframe: true,
      });
      boxGroup.add(new T.Mesh(midGeo, midMat));
      const innerGeo = new T.OctahedronGeometry(12, 1);
      const innerMat = new T.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffd86b,
        emissiveIntensity: 1.8,
        transparent: true,
        opacity: 0.9,
        metalness: 0.4,
        roughness: 0.2,
      });
      boxGroup.add(new T.Mesh(innerGeo, innerMat));
      const qMat = new T.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffd86b, emissiveIntensity: 1.5 });
      const qDot = new T.Mesh(new T.SphereGeometry(2.5, 8, 6), qMat);
      qDot.position.y = -8;
      boxGroup.add(qDot);
      const qCurve = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 10, 8), qMat);
      qCurve.position.y = 2;
      boxGroup.add(qCurve);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const boxLight = new T.PointLight(0xffd86b, 0.9, 140);
        boxGroup.add(boxLight);
      }
      boxGroup.position.set(ib.x, 22, ib.y);
      boxGroup._itemRef = ib;
      boxGroup._innerMat = innerMat;
      boxGroup._outerMat = outerMat;
      boxGroup._midMat = midMat;
      boxGroup.castShadow = ENABLE_3D_SHADOWS;
      group.add(boxGroup);
      THREE_STATE.itemMeshes.push(boxGroup);
    });
  }

  if (game.track.boostPads) {
    game.track.boostPads.forEach(bp => {
      const padGroup = new T.Group();
      const pw = bp.h || 36;
      const ph = bp.w || 70;
      const padGeo = new T.BoxGeometry(pw, 1.5, ph);
      const padMat = new T.MeshStandardMaterial({
        color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.55, metalness: 0.3, roughness: 0.4,
      });
      padGroup.add(new T.Mesh(padGeo, padMat));
      const arrowMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xa4ff80, emissiveIntensity: 1.5, transparent: true, opacity: 0.85, side: T.DoubleSide });
      for (let a = 0; a < 3; a++) {
        const hw = pw * 0.35;
        const arrowGeo = new T.BufferGeometry();
        arrowGeo.setAttribute("position", new T.Float32BufferAttribute([
          0, 0, 8, -hw, 0, -6, 0, 0, -2,
          0, 0, 8, 0, 0, -2, hw, 0, -6,
        ], 3));
        arrowGeo.computeVertexNormals();
        const arrow = new T.Mesh(arrowGeo, arrowMat);
        arrow.position.z = -ph * 0.3 + a * (ph * 0.3);
        arrow.position.y = 1.2;
        padGroup.add(arrow);
      }
      const barMat = new T.MeshStandardMaterial({ color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 1.1 });
      for (const s of [-1, 1]) {
        const bar = new T.Mesh(new T.BoxGeometry(2, 3, ph + 4), barMat);
        bar.position.x = s * (pw / 2 + 1);
        bar.position.y = 1.5;
        padGroup.add(bar);
      }
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const padLight = new T.PointLight(0xa4ff80, 0.3, 60);
        padLight.position.y = 5;
        padGroup.add(padLight);
      }
      padGroup.position.set(bp.x, 1.5, bp.y);
      padGroup.rotation.y = -bp.ang + Math.PI / 2;
      padGroup._boostPadRef = bp;
      padGroup._padMat = padMat;
      group.add(padGroup);
      THREE_STATE.boostPadMeshes.push(padGroup);
    });
  }

  if (game.track.coins) {
    if (!_citationLabelTex3D) {
      const citationLabelCanvas = document.createElement("canvas");
      citationLabelCanvas.width = 128;
      citationLabelCanvas.height = 72;
      const labelCtx = citationLabelCanvas.getContext("2d");
      labelCtx.clearRect(0, 0, citationLabelCanvas.width, citationLabelCanvas.height);
      labelCtx.fillStyle = "rgba(6,5,20,0.74)";
      labelCtx.fillRect(8, 8, 112, 56);
      labelCtx.strokeStyle = "rgba(255,216,107,0.95)";
      labelCtx.lineWidth = 3;
      labelCtx.strokeRect(8, 8, 112, 56);
      labelCtx.fillStyle = "#ffffff";
      labelCtx.font = "bold 26px 'SFMono-Regular', Consolas, monospace";
      labelCtx.textAlign = "center";
      labelCtx.textBaseline = "middle";
      labelCtx.fillText("PMC", 64, 30);
      labelCtx.fillStyle = "#ffd86b";
      labelCtx.font = "bold 15px 'SFMono-Regular', Consolas, monospace";
      labelCtx.fillText("CITE", 64, 51);
      _citationLabelTex3D = new T.CanvasTexture(citationLabelCanvas);
      _citationLabelTex3D.minFilter = T.LinearFilter;
      _citationLabelTex3D.userData = { shared: true };
    }
    const citationLabelMat = new T.MeshBasicMaterial({ map: _citationLabelTex3D, transparent: true, depthWrite: false, side: T.DoubleSide });
    const citationMat = new T.MeshStandardMaterial({
      color: 0xffd86b,
      emissive: 0xffd86b,
      emissiveIntensity: 1.2,
      metalness: 0.85,
      roughness: 0.16,
    });
    const frameMat = new T.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd86b, emissiveIntensity: 1.0, metalness: 0.9, roughness: 0.08 });
    const foldMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, side: T.DoubleSide });
    const lineMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const glowCoreMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd86b, emissiveIntensity: 1.4, transparent: true, opacity: 0.9 });

    const bodyGeo = new T.BoxGeometry(12, 16, 3);
    const frameGeos = [
      [0, 10.75, new T.BoxGeometry(11.6, 0.55, 0.38)],
      [0, -4.75, new T.BoxGeometry(11.6, 0.55, 0.38)],
      [-5.75, 3, new T.BoxGeometry(0.55, 15.2, 0.38)],
      [5.75, 3, new T.BoxGeometry(0.55, 15.2, 0.38)],
    ];
    const topTabGeo = new T.BoxGeometry(7.5, 1.2, 3.4);
    const foldGeo = new T.BufferGeometry();
    foldGeo.setAttribute("position", new T.Float32BufferAttribute([
      2.3, 9.2, 1.98,
      5.0, 9.2, 1.98,
      5.0, 6.5, 1.98,
    ], 3));
    foldGeo.computeVertexNormals();
    const lineGeoLong = new T.BoxGeometry(7, 0.28, 0.18);
    const lineGeoShort = new T.BoxGeometry(4.6, 0.28, 0.18);
    const labelGeo = new T.PlaneGeometry(8.7, 4.9);
    const glowCoreGeo = new T.OctahedronGeometry(1.4, 0);

    game.track.coins.forEach(c => {
      if (c.collected) return;
      const coinGroup = new T.Group();
      const citationBody = new T.Mesh(bodyGeo, citationMat);
      citationBody.position.y = 3;
      citationBody.castShadow = ENABLE_3D_SHADOWS;
      coinGroup.add(citationBody);

      for (const [px, py, fGeo] of frameGeos) {
        const frameBar = new T.Mesh(fGeo, frameMat);
        frameBar.position.set(px, py, 1.78);
        coinGroup.add(frameBar);
      }

      const topTab = new T.Mesh(topTabGeo, frameMat);
      topTab.position.set(0, 10.2, 0);
      coinGroup.add(topTab);

      coinGroup.add(new T.Mesh(foldGeo, foldMat));

      [-1.8, -3.2, -4.6].forEach((lineY, idx) => {
        const line = new T.Mesh(idx === 2 ? lineGeoShort : lineGeoLong, lineMat);
        line.position.set(0, lineY, 1.78);
        coinGroup.add(line);
      });

      const label = new T.Mesh(labelGeo, citationLabelMat);
      label.position.set(0, 3.0, 1.91);
      coinGroup.add(label);

      const glowCore = new T.Mesh(glowCoreGeo, glowCoreMat);
      glowCore.position.set(0, -7.0, 1.8);
      coinGroup.add(glowCore);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const coinLight = new T.PointLight(0xffd86b, 0.2, 30);
        coinGroup.add(coinLight);
      }
      coinGroup.position.set(c.x, 9, c.y);
      coinGroup._coinRef = c;
      coinGroup._discMat = citationMat;
      group.add(coinGroup);
      THREE_STATE.coinMeshes.push(coinGroup);
    });
  }

  if (game.track.movingObjects) {
    game.track.movingObjects.forEach(obj => {
      const gateGroup = new T.Group();
      const col = new T.Color(obj.color || "#57f2ff");
      const kind = obj.kind || "blackice";
      const wallGeo = kind === "amend"
        ? new T.BoxGeometry(8, 30, 82)
        : kind === "clause"
          ? new T.BoxGeometry(8, 64, 42)
          : kind === "redline"
            ? new T.BoxGeometry(8, 18, 105)
            : kind === "signoff"
              ? new T.BoxGeometry(12, 58, 66)
              : new T.BoxGeometry(8, 50, 55);
      const wallMat = new T.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.5, side: T.DoubleSide,
      });
      gateGroup.add(new T.Mesh(wallGeo, wallMat));
      const wireMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, wireframe: true, transparent: true, opacity: 0.4 });
      gateGroup.add(new T.Mesh(kind === "redline" ? new T.BoxGeometry(10, 22, 112) : new T.BoxGeometry(10, 52, 57), wireMat));
      const hexMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, wireframe: true, transparent: true, opacity: 0.2 });
      if (kind === "clause") {
        gateGroup.add(new T.Mesh(new T.TorusGeometry(24, 2, 8, 24), hexMat));
      } else if (kind === "signoff") {
        gateGroup.add(new T.Mesh(new T.OctahedronGeometry(26, 0), hexMat));
      } else {
        gateGroup.add(new T.Mesh(new T.IcosahedronGeometry(30, 1), hexMat));
      }
      const barMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.4 });
      const topBar = new T.Mesh(new T.BoxGeometry(10, 3, 58), barMat);
      topBar.position.y = 26;
      gateGroup.add(topBar);
      const bottomBar = new T.Mesh(new T.BoxGeometry(10, 3, 58), barMat);
      bottomBar.position.y = -24;
      gateGroup.add(bottomBar);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const wLight = new T.PointLight(col, 0.8, 150);
        wLight.position.y = 30;
        gateGroup.add(wLight);
        const wLight2 = new T.PointLight(col, 0.3, 80);
        wLight2.position.y = -20;
        gateGroup.add(wLight2);
      }
      gateGroup.position.set(obj.x, 26, obj.y);
      gateGroup.rotation.y = -(obj.ang || 0) + Math.PI / 2;
      gateGroup._movingObjectRef = obj;
      group.add(gateGroup);
      THREE_STATE.movingObjectMeshes.push(gateGroup);
    });
  }

  // Only create the dragon model relevant to the current map
  if (game.track.regulatoryDragon && currentMapId !== "dragon_escape") {
    THREE_STATE.dragonModel = buildDragonModel3D(false);
    sc.add(THREE_STATE.dragonModel);
  }
  if (currentMapId === "dragon_escape") {
    THREE_STATE.dragonEscapeModel = buildDragonModel3D(true);
    sc.add(THREE_STATE.dragonEscapeModel);
  }

  // Theme-specific trackside architecture (shared geometries & materials per map for high FPS)
  if (game.track.decorations && !game.track.isOpen && !game.track.arenaFloor) {
    const propStyle = trackStyle.propStyle;
    const darkMetalMat = new T.MeshStandardMaterial({
      color: roadDay ? 0x262538 : 0x161426,
      roughness: 0.35,
      metalness: 0.78,
    });
    const accentColors = propStyle === "ice"
      ? [0x57f2ff, 0x9be8ff, 0x5cb8ff]
      : propStyle === "stadium"
        ? [0xa4ff80, 0x57f2ff, 0xffd86b]
        : propStyle === "labyrinth"
          ? [0xfd9927, 0xffd86b, 0xff4d6d]
          : propStyle === "dragon"
            ? [0xff4d6d, 0xffd86b, 0xff8844]
            : [0x7b75ff, 0x57f2ff, 0xfd9927, 0xa4ff80];
    const accentMats = accentColors.map((col) => new T.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: roadDay ? 0.55 : 1.05,
      roughness: 0.25,
      metalness: 0.45,
    }));

    // Shared unit geometries scaled per prop
    const unitBox = new T.BoxGeometry(1, 1, 1);
    const unitCone5 = new T.ConeGeometry(1, 1, 5);
    const unitCyl6 = new T.CylinderGeometry(0.45, 0.72, 1, 6);
    const unitRing = new T.TorusGeometry(1, 0.14, 6, 12);

    const iceCrystalMat = propStyle === "ice" ? new T.MeshStandardMaterial({
      color: roadDay ? 0xbef5ff : 0x45c8e8,
      emissive: 0x2299cc,
      emissiveIntensity: roadDay ? 0.22 : 0.55,
      transparent: true,
      opacity: 0.82,
      roughness: 0.12,
      metalness: 0.25,
    }) : null;
    const sandstoneMat = propStyle === "labyrinth" ? new T.MeshStandardMaterial({
      color: roadDay ? 0x4a3d33 : 0x241d19,
      roughness: 0.65,
      metalness: 0.22,
    }) : null;
    const crimsonMat = propStyle === "dragon" ? new T.MeshStandardMaterial({
      color: roadDay ? 0x982430 : 0x62151e,
      roughness: 0.45,
      metalness: 0.35,
    }) : null;

    game.track.decorations.forEach((d, idx) => {
      if (d.isJapanese) return;
      const h = d.h || 54;
      const r = (d.r || 12) * 0.72;
      const aMat = accentMats[idx % accentMats.length];
      const prop = new T.Group();
      prop.position.set(d.x, 0, d.y);
      const yaw = (idx * 1.6180339) % TAU;
      prop.rotation.y = yaw;

      if (propStyle === "ice") {
        // Faceted glacier crystal cluster
        const mainSpire = new T.Mesh(unitCone5, iceCrystalMat);
        mainSpire.scale.set(r * 1.15, h * 1.15, r * 1.15);
        mainSpire.position.y = h * 0.56;
        mainSpire.rotation.z = ((idx % 2 === 0 ? 1 : -1) * 0.1);
        prop.add(mainSpire);
        const sideSpire = new T.Mesh(unitCone5, aMat);
        sideSpire.scale.set(r * 0.72, h * 0.68, r * 0.72);
        sideSpire.position.set(r * 0.85, h * 0.32, r * 0.3);
        sideSpire.rotation.z = -0.26;
        prop.add(sideSpire);
        const sideSpire2 = new T.Mesh(unitCone5, iceCrystalMat);
        sideSpire2.scale.set(r * 0.58, h * 0.48, r * 0.58);
        sideSpire2.position.set(-r * 0.75, h * 0.23, -r * 0.35);
        sideSpire2.rotation.z = 0.24;
        prop.add(sideSpire2);
      } else if (propStyle === "stadium") {
        // Speedway floodlight tower facing closest track point
        const nearest = game.track.closestSegment(d.x, d.y);
        if (nearest?.proj) {
          prop.rotation.y = Math.atan2(nearest.proj.x - d.x, nearest.proj.y - d.y);
        }
        const poleH = h * 1.35;
        const pole = new T.Mesh(unitCyl6, darkMetalMat);
        pole.scale.set(r * 0.42, poleH, r * 0.42);
        pole.position.y = poleH * 0.5;
        prop.add(pole);
        const head = new T.Mesh(unitBox, darkMetalMat);
        head.scale.set(r * 2.4, r * 0.85, r * 0.6);
        head.position.set(0, poleH, r * 0.35);
        head.rotation.x = 0.35;
        prop.add(head);
        const lamp = new T.Mesh(unitBox, aMat);
        lamp.scale.set(r * 2.1, r * 0.58, r * 0.22);
        lamp.position.set(0, poleH - 0.6, r * 0.68);
        lamp.rotation.x = 0.35;
        prop.add(lamp);
      } else if (propStyle === "labyrinth") {
        // Stepped regulatory archive obelisk with glowing compliance seal collar
        const plinth = new T.Mesh(unitBox, sandstoneMat);
        plinth.scale.set(r * 2.1, 8, r * 2.1);
        plinth.position.y = 4;
        prop.add(plinth);
        const shaft = new T.Mesh(unitBox, sandstoneMat);
        shaft.scale.set(r * 1.35, h, r * 1.35);
        shaft.position.y = 8 + h * 0.5;
        prop.add(shaft);
        const band = new T.Mesh(unitBox, aMat);
        band.scale.set(r * 1.5, 4.2, r * 1.5);
        band.position.y = 8 + h * 0.72;
        prop.add(band);
        const apex = new T.Mesh(unitCone5, aMat);
        apex.scale.set(r * 1.05, r * 1.3, r * 1.05);
        apex.position.y = 8 + h + r * 0.65;
        prop.add(apex);
      } else if (propStyle === "dragon") {
        // Imperial cyber-lantern pillar with pagoda eaves
        const post = new T.Mesh(unitCyl6, crimsonMat);
        post.scale.set(r * 0.65, h, r * 0.65);
        post.position.y = h * 0.5;
        prop.add(post);
        const eave1 = new T.Mesh(unitBox, crimsonMat);
        eave1.scale.set(r * 2.5, 3, r * 2.5);
        eave1.position.y = h * 0.85;
        prop.add(eave1);
        const lantern = new T.Mesh(unitBox, aMat);
        lantern.scale.set(r * 1.2, r * 1.4, r * 1.2);
        lantern.position.y = h * 0.98;
        prop.add(lantern);
        const roof = new T.Mesh(unitCone5, crimsonMat);
        roof.scale.set(r * 1.9, r * 1.1, r * 1.9);
        roof.position.y = h * 0.98 + r * 1.2;
        prop.add(roof);
      } else {
        // Mainframe server monolith with glowing vertical LED data strips & orbiting telemetry ring
        const chassis = new T.Mesh(unitBox, darkMetalMat);
        chassis.scale.set(r * 1.5, h, r * 1.5);
        chassis.position.y = h * 0.5;
        chassis.castShadow = ENABLE_3D_SHADOWS;
        prop.add(chassis);
        for (const s of [-1, 1]) {
          const led = new T.Mesh(unitBox, aMat);
          led.scale.set(r * 0.22, h * 0.82, r * 1.58);
          led.position.set(s * r * 0.42, h * 0.5, 0);
          prop.add(led);
        }
        const cap = new T.Mesh(unitBox, aMat);
        cap.scale.set(r * 1.2, 3.2, r * 1.2);
        cap.position.y = h + 1.8;
        prop.add(cap);
        const ring = new T.Mesh(unitRing, aMat);
        ring.scale.setScalar(r * 1.18);
        ring.position.set(d.x, h * 0.78, d.y);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        THREE_STATE.pillarRings.push(ring);
      }
      group.add(prop);
    });
  }

  // Reposition ground
  if (THREE_STATE.groundMesh) {
    THREE_STATE.groundMesh.position.set(WORLD_W / 2, -1, WORLD_H / 2);
    const gs = Math.max(WORLD_W, WORLD_H) * 3;
    THREE_STATE.groundMesh.scale.set(gs / 12000, 1, gs / 12000);
  }

  // Visual enhancements
  apply3DMapTheme();
  init3DParticles();
  build3DSpectators();
  build3DStartLine();
  enhance3DKartModels();

  recycleAll3DSkidMarks();
}


// 3D skid marks - shared geometry, pooled MeshBasicMaterial (cheap)
const SKID_3D_MAX = 200;
let _skidGeo3d = null;
let _skidMatDark = null;
let _skidMatNeon = null;
const _skidFreePool = [];

export function recycleAll3DSkidMarks() {
  if (!THREE_STATE.scene) return;
  for (const skid of THREE_STATE.skidMarks3d) {
    THREE_STATE.scene.remove(skid.mesh);
    skid.mesh.visible = false;
    if (_skidFreePool.indexOf(skid.mesh) < 0) _skidFreePool.push(skid.mesh);
  }
  THREE_STATE.skidMarks3d = [];
}

export function getSkidMark3D(isNeon) {
  if (!window.THREE) return null;
  const T = window.THREE;
  if (!_skidGeo3d) _skidGeo3d = new T.PlaneGeometry(8, 3.5);
  if (!_skidMatDark) _skidMatDark = new T.MeshBasicMaterial({ color: 0x141420, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide });
  if (!_skidMatNeon) _skidMatNeon = new T.MeshBasicMaterial({ color: 0x4dffaa, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide });
  if (_skidFreePool.length > 0) {
    const m = _skidFreePool.pop();
    m.material = isNeon ? _skidMatNeon : _skidMatDark;
    m.visible = true;
    return m;
  }
  return new T.Mesh(_skidGeo3d, isNeon ? _skidMatNeon : _skidMatDark);
}

export function sync3DSkidMarks() {
  if (!window.THREE || !THREE_STATE.scene) return;
  const dt = game.lastDt || 1;

  for (const [kart] of THREE_STATE.kartModels) {
    if (kart._driftTimer > 0 && Math.abs(kart.forwardSpeed()) > 1.5) {
      if (!kart._skid3dTimer) kart._skid3dTimer = 0;
      kart._skid3dTimer -= dt;
      if (kart._skid3dTimer <= 0) {
        kart._skid3dTimer = 2.5;
        const fxCos = Math.cos(kart.heading), fxSin = Math.sin(kart.heading);
        const lx = -fxSin, lz = fxCos;
        const isRissal = kart.charId === "rissal";
        for (const side of [-1, 1]) {
          const sx = kart.x - fxCos * 10 + lx * side * 7;
          const sz = kart.y - fxSin * 10 + lz * side * 7;
          const mesh = getSkidMark3D(isRissal);
          if (!mesh) continue;
          mesh.rotation.x = -Math.PI / 2;
          mesh.rotation.z = -kart.heading;
          mesh.position.set(sx, 0.6, sz);
          THREE_STATE.scene.add(mesh);
          THREE_STATE.skidMarks3d.push({ mesh, life: 250, maxLife: 250 });
        }
      }
    }
  }

  for (let i = THREE_STATE.skidMarks3d.length - 1; i >= 0; i--) {
    const s = THREE_STATE.skidMarks3d[i];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      THREE_STATE.scene.remove(s.mesh);
      _skidFreePool.push(s.mesh);
      THREE_STATE.skidMarks3d.splice(i, 1);
    }
  }

  while (THREE_STATE.skidMarks3d.length > SKID_3D_MAX) {
    const oldest = THREE_STATE.skidMarks3d.shift();
    oldest.mesh.visible = false;
    THREE_STATE.scene.remove(oldest.mesh);
    _skidFreePool.push(oldest.mesh);
  }
}
