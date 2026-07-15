import { TAU, lerp, clamp } from "../core/math.js";
import { game, isDayMode, isBattleMode } from "../core/state.js";
import { MAPS } from "../config/maps.js";
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
  // Keep the daylight road ribbon above the arena floor instead of z-fighting with it.
  floorMesh.position.set(floor.cx, day ? 0.1 : 0.5, floor.cy);
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
  innerRing.position.set(floor.cx, 0.62, floor.cy);
  group.add(innerRing);

  if (track.reviewPlatformRadius > 0) {
    const platGeo = new T.CylinderGeometry(track.reviewPlatformRadius, track.reviewPlatformRadius, 1.5, 48);
    const platMat = new T.MeshStandardMaterial({
      color: day ? 0xb3d9aa : 0x1b1726,
      emissive: day ? 0x10220c : 0x7b75ff,
      emissiveIntensity: day ? 0.05 : 0.2,
      roughness: 0.5,
      metalness: 0.35,
    });
    const plat = new T.Mesh(platGeo, platMat);
    plat.position.set(floor.cx, 0.75, floor.cy);
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
  // Remove old kart models
  THREE_STATE.kartModels.forEach(m => {
    sc.remove(m);
    dispose3DObject(m);
  });
  THREE_STATE.kartModels.clear();
  disposeTethers3D();
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
  if (THREE_STATE.particles3dSystem) { sc.remove(THREE_STATE.particles3dSystem); dispose3DObject(THREE_STATE.particles3dSystem); THREE_STATE.particles3dSystem = null; }
  reset3DParticlePool();
  THREE_STATE.pillarRings = [];
  if (THREE_STATE._sceneryGroup) { sc.remove(THREE_STATE._sceneryGroup); dispose3DObject(THREE_STATE._sceneryGroup); THREE_STATE._sceneryGroup = null; }

  const group = new T.Group();
  THREE_STATE.trackGroup = group;
  sc.add(group);
  THREE_STATE.rampMeshes = [];

  if (game.track.arenaFloor) {
    build3DArenaFloor(group, game.track);
    build3DRamps(group, game.track);
    build3DArenaBoundaryMarkers(group, game.track);
  }

  // Build track ribbon from waypoints
  const wp = game.track.waypoints;
  const verts = [];
  const colors = [];
  const roadUvs = [];
  const edges = get3DRoadEdges(game.track);
  const segmentCount = game.track.isOpen ? edges.length - 1 : edges.length;
  const roadUvScale = 1 / 192;

  for (let i = 0; i < segmentCount; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    if (!e0 || !e1) continue;

    verts.push(e0.left.x, 0, e0.left.y, e0.right.x, 0, e0.right.y, e1.left.x, 0, e1.left.y);
    verts.push(e0.right.x, 0, e0.right.y, e1.right.x, 0, e1.right.y, e1.left.x, 0, e1.left.y);
    roadUvs.push(
      e0.left.x * roadUvScale, e0.left.y * roadUvScale,
      e0.right.x * roadUvScale, e0.right.y * roadUvScale,
      e1.left.x * roadUvScale, e1.left.y * roadUvScale,
      e0.right.x * roadUvScale, e0.right.y * roadUvScale,
      e1.right.x * roadUvScale, e1.right.y * roadUvScale,
      e1.left.x * roadUvScale, e1.left.y * roadUvScale
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

  const roadDay = isDayMode();
  const roadTexture = getCompassSurfaceTexture3D(T, "road", roadDay);
  roadTexture.repeat.set(1, 1);
  const roadMat = new T.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTexture,
    emissive: roadDay ? 0x000000 : 0x131019,
    emissiveIntensity: roadDay ? 0 : 0.12,
    roughness: 0.78,
    metalness: 0.12,
    vertexColors: false,
  });
  THREE_STATE.trackMesh = new T.Mesh(geo, roadMat);
  THREE_STATE.trackMesh.position.y = 0.5;
  THREE_STATE.trackMesh.receiveShadow = true;
  group.add(THREE_STATE.trackMesh);

  // Rumble strip (slightly wider road with alternating colors)
  const rumbleVerts = [];
  const rumbleColors = [];
  const rumbleExtra = 8;
  for (let i = 0; i < segmentCount; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    if (!e0 || !e1) continue;
    const c0 = e0.center, c1 = e1.center;
    const isEven = i % 2 === 0;
    const r = isEven ? [0.48, 0.46, 1.0] : [0.64, 1.0, 0.5];
    for (let side of [-1, 1]) {
      const s0 = side === 1 ? e0.left : e0.right;
      const s1 = side === 1 ? e1.left : e1.right;
      const dx0 = s0.x - c0.x, dy0 = s0.y - c0.y;
      const dl0 = Math.hypot(dx0, dy0) || 1;
      const dx1 = s1.x - c1.x, dy1 = s1.y - c1.y;
      const dl1 = Math.hypot(dx1, dy1) || 1;
      const o0x = s0.x + (dx0 / dl0) * rumbleExtra, o0z = s0.y + (dy0 / dl0) * rumbleExtra;
      const o1x = s1.x + (dx1 / dl1) * rumbleExtra, o1z = s1.y + (dy1 / dl1) * rumbleExtra;
      rumbleVerts.push(s0.x, 0, s0.y, o0x, 0, o0z, s1.x, 0, s1.y);
      rumbleVerts.push(o0x, 0, o0z, o1x, 0, o1z, s1.x, 0, s1.y);
      for (let v = 0; v < 6; v++) rumbleColors.push(r[0], r[1], r[2]);
    }
  }
  if (rumbleVerts.length > 0) {
    const rGeo = new T.BufferGeometry();
    rGeo.setAttribute("position", new T.Float32BufferAttribute(rumbleVerts, 3));
    rGeo.setAttribute("color", new T.Float32BufferAttribute(rumbleColors, 3));
    rGeo.computeVertexNormals();
    const rMat = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.2,
      emissive: 0x111111,
      emissiveIntensity: roadDay ? 0.08 : 0.3,
    });
    const rumble = new T.Mesh(rGeo, rMat);
    rumble.position.y = 0.3;
    group.add(rumble);
  }

  // 3D barrier walls along track edges
  const barrierH = 14;
  const barrierOffset = 6;
  for (let side = -1; side <= 1; side += 2) {
    const wallVerts = [];
    const wallColors = [];
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
      const b0x = s0.x + (dx0 / dl0) * barrierOffset;
      const b0z = s0.y + (dy0 / dl0) * barrierOffset;
      const b1x = s1.x + (dx1 / dl1) * barrierOffset;
      const b1z = s1.y + (dy1 / dl1) * barrierOffset;
      // Front face of barrier (two triangles)
      wallVerts.push(b0x, 0, b0z, b1x, 0, b1z, b0x, barrierH, b0z);
      wallVerts.push(b1x, 0, b1z, b1x, barrierH, b1z, b0x, barrierH, b0z);
      // Alternating neon color stripes
      const isEven = i % 4 < 2;
      const cr = side === 1 ? (isEven ? [0.48, 0.46, 1.0] : [0.15, 0.12, 0.35]) : (isEven ? [0.99, 0.6, 0.15] : [0.15, 0.12, 0.35]);
      for (let v = 0; v < 6; v++) wallColors.push(cr[0], cr[1], cr[2]);
    }
    if (wallVerts.length > 0) {
      const wGeo = new T.BufferGeometry();
      wGeo.setAttribute("position", new T.Float32BufferAttribute(wallVerts, 3));
      wGeo.setAttribute("color", new T.Float32BufferAttribute(wallColors, 3));
      wGeo.computeVertexNormals();
      const wMat = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.6,
        emissive: side === 1 ? 0x1a1840 : 0x2a1808,
        emissiveIntensity: roadDay ? 0.12 : 0.4,
        transparent: true,
        opacity: roadDay ? 0.88 : 0.82,
      });
      const wall = new T.Mesh(wGeo, wMat);
      wall.position.y = 0.5;
      group.add(wall);
    }

    // Glowing top edge line on barrier
    const topVerts = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (!e) continue;
      const p = side === 1 ? e.left : e.right;
      const c = e.center;
      const dx = p.x - c.x, dy = p.y - c.y;
      const dl = Math.hypot(dx, dy) || 1;
      topVerts.push(p.x + (dx / dl) * barrierOffset, barrierH + 0.5, p.y + (dy / dl) * barrierOffset);
    }
    if (topVerts.length > 3) {
      const tGeo = new T.BufferGeometry();
      tGeo.setAttribute("position", new T.Float32BufferAttribute(topVerts, 3));
      const tMat = new T.LineBasicMaterial({ color: side === 1 ? 0x7b75ff : 0xfd9927, linewidth: 2 });
      group.add(game.track.isOpen ? new T.Line(tGeo, tMat) : new T.LineLoop(tGeo, tMat));
    }
  }

  // Center dashed line
  const centerVerts = [];
  for (let i = 0; i < wp.length; i++) {
    centerVerts.push(wp[i].x, 1, wp[i].y);
  }
  if (centerVerts.length > 3) {
    const centerGeo = new T.BufferGeometry();
    centerGeo.setAttribute("position", new T.Float32BufferAttribute(centerVerts, 3));
    const centerMat = new T.LineDashedMaterial({
      color: roadDay ? 0x5a54c8 : 0x7b75ff,
      dashSize: 24,
      gapSize: 32,
      linewidth: 1,
    });
    const centerLine = game.track.isOpen ? new T.Line(centerGeo, centerMat) : new T.LineLoop(centerGeo, centerMat);
    centerLine.computeLineDistances();
    group.add(centerLine);
  }

  if (!game.track.isOpen && edges.length > 1) {
    const e = edges[0];
    const archW = Math.hypot(e.left.x - e.right.x, e.left.y - e.right.y);
    const archH = 45;
    const archGroup = new T.Group();
    const archMat = new T.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffd86b, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.2 });
    const pillarGeo = new T.CylinderGeometry(2.5, 3, archH, 10);
    const lp = new T.Mesh(pillarGeo, archMat);
    lp.position.set(e.left.x, archH / 2, e.left.y);
    lp.castShadow = true;
    archGroup.add(lp);
    const rp = new T.Mesh(pillarGeo, archMat);
    rp.position.set(e.right.x, archH / 2, e.right.y);
    rp.castShadow = true;
    archGroup.add(rp);
    const beamLen = archW;
    const beamGeo = new T.BoxGeometry(beamLen, 5, 7);
    const beam = new T.Mesh(beamGeo, archMat);
    beam.position.set((e.left.x + e.right.x) / 2, archH, (e.left.y + e.right.y) / 2);
    beam.rotation.y = -Math.atan2(e.left.y - e.right.y, e.left.x - e.right.x);
    beam.castShadow = true;
    archGroup.add(beam);
    const bannerGeo = new T.PlaneGeometry(beamLen * 0.9, 10);
    const bannerMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd86b, emissiveIntensity: 0.4, side: T.DoubleSide, transparent: true, opacity: 0.9 });
    const banner = new T.Mesh(bannerGeo, bannerMat);
    banner.position.set((e.left.x + e.right.x) / 2, archH - 7, (e.left.y + e.right.y) / 2);
    banner.rotation.y = -Math.atan2(e.left.y - e.right.y, e.left.x - e.right.x);
    archGroup.add(banner);
    if (ENABLE_DECORATIVE_3D_LIGHTS) {
      const archLight = new T.PointLight(0xffd86b, 0.6, 150);
      archLight.position.set((e.left.x + e.right.x) / 2, archH + 5, (e.left.y + e.right.y) / 2);
      archGroup.add(archLight);
    }
    group.add(archGroup);
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
    const citationLabelTex = new T.CanvasTexture(citationLabelCanvas);
    citationLabelTex.minFilter = T.LinearFilter;
    const citationLabelMat = new T.MeshBasicMaterial({ map: citationLabelTex, transparent: true, depthWrite: false, side: T.DoubleSide });

    game.track.coins.forEach(c => {
      if (c.collected) return;
      const coinGroup = new T.Group();
      const citationMat = new T.MeshStandardMaterial({
        color: 0xffd86b,
        emissive: 0xffd86b,
        emissiveIntensity: 1.2,
        metalness: 0.85,
        roughness: 0.16,
      });
      const citationBody = new T.Mesh(new T.BoxGeometry(12, 16, 3), citationMat);
      citationBody.position.y = 3;
      citationBody.castShadow = ENABLE_3D_SHADOWS;
      coinGroup.add(citationBody);

      const frameMat = new T.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd86b, emissiveIntensity: 1.0, metalness: 0.9, roughness: 0.08 });
      [
        [0, 10.75, 11.6, 0.55],
        [0, -4.75, 11.6, 0.55],
        [-5.75, 3, 0.55, 15.2],
        [5.75, 3, 0.55, 15.2],
      ].forEach(([px, py, w, h]) => {
        const frameBar = new T.Mesh(new T.BoxGeometry(w, h, 0.38), frameMat);
        frameBar.position.set(px, py, 1.78);
        coinGroup.add(frameBar);
      });

      const topTab = new T.Mesh(new T.BoxGeometry(7.5, 1.2, 3.4), frameMat);
      topTab.position.set(0, 10.2, 0);
      coinGroup.add(topTab);

      const foldGeo = new T.BufferGeometry();
      foldGeo.setAttribute("position", new T.Float32BufferAttribute([
        2.3, 9.2, 1.98,
        5.0, 9.2, 1.98,
        5.0, 6.5, 1.98,
      ], 3));
      foldGeo.computeVertexNormals();
      const foldMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, side: T.DoubleSide });
      coinGroup.add(new T.Mesh(foldGeo, foldMat));

      const lineMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      [-1.8, -3.2, -4.6].forEach((lineY, idx) => {
        const line = new T.Mesh(new T.BoxGeometry(idx === 2 ? 4.6 : 7, 0.28, 0.18), lineMat);
        line.position.set(0, lineY, 1.78);
        coinGroup.add(line);
      });

      const label = new T.Mesh(new T.PlaneGeometry(8.7, 4.9), citationLabelMat);
      label.position.set(0, 3.0, 1.91);
      coinGroup.add(label);

      const glowCore = new T.Mesh(
        new T.OctahedronGeometry(1.4, 0),
        new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd86b, emissiveIntensity: 1.4, transparent: true, opacity: 0.9 })
      );
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
  const currentMapId = MAPS[game.selectedMapIdx || 0].id;
  if (game.track.regulatoryDragon && currentMapId !== "dragon_escape") {
    THREE_STATE.dragonModel = buildDragonModel3D(false);
    sc.add(THREE_STATE.dragonModel);
  }
  if (currentMapId === "dragon_escape") {
    THREE_STATE.dragonEscapeModel = buildDragonModel3D(true);
    sc.add(THREE_STATE.dragonEscapeModel);
  }

  if (game.track.decorations && !game.track.isOpen && !game.track.arenaFloor) {
    const pillarColors = [0x7b75ff, 0xfd9927, 0xff4d6d, 0xa4ff80, 0x57f2ff];
    game.track.decorations.forEach((d, idx) => {
      if (d.isJapanese) return;
      const h = d.h || 50;
      const r = (d.r || 12) * 0.6;
      const col = pillarColors[idx % pillarColors.length];
      const pillarGeo = new T.CylinderGeometry(r * 0.5, r, h, 8);
      const pillarMat = new T.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.5,
        roughness: 0.15,
        metalness: 0.85,
      });
      const pillar = new T.Mesh(pillarGeo, pillarMat);
      pillar.position.set(d.x, h / 2, d.y);
      pillar.castShadow = ENABLE_3D_SHADOWS;
      group.add(pillar);
      for (let ri = 0; ri < 3; ri++) {
        const ringY = h * 0.25 + ri * (h * 0.25);
        const ringR = r * (0.9 - ri * 0.1);
        const ringGeo = new T.TorusGeometry(ringR, 0.4, 6, 12);
        const ringMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, transparent: true, opacity: 0.6 });
        const ring = new T.Mesh(ringGeo, ringMat);
        ring.position.set(d.x, ringY, d.y);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        THREE_STATE.pillarRings.push(ring);
      }
      const capGeo = new T.SphereGeometry(r * 0.7, 10, 8);
      const capMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.0 });
      const cap = new T.Mesh(capGeo, capMat);
      cap.position.set(d.x, h + 2, d.y);
      group.add(cap);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const pillarLight = new T.PointLight(col, 0.25, 80);
        pillarLight.position.set(d.x, h + 5, d.y);
        group.add(pillarLight);
      }
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

  // Clean up old name tags / speech bubbles from previous track
  THREE_STATE.nameTagSprites.forEach(s => THREE_STATE.scene.remove(s));
  THREE_STATE.nameTagSprites.clear();
  THREE_STATE.speechBubbleSprites.forEach(s => { THREE_STATE.scene.remove(s); s.material.map?.dispose(); s.material.dispose(); });
  THREE_STATE.speechBubbleSprites.clear();
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
  if (!_skidGeo3d) _skidGeo3d = new T.PlaneGeometry(4, 6);
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
