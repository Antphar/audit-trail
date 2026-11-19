import { TAU, rand } from "../core/math.js";
import { game, isDayMode, getActiveKarts, getKartById } from "../core/state.js";
import { getVehicleProfile } from "../config/characters.js";
import {
  THREE_STATE,
  ENABLE_3D_SHADOWS,
  dispose3DObject,
  getContactShadowTexture3D,
  getParticleGlowTexture3D,
} from "./three-state.js";

export function getCompassKartMats3D(T, charColor) {
  const railColor = new T.Color(charColor);
  const shellColor = new T.Color(charColor).lerp(new T.Color(0x131019), 0.16);
  return {
    shell: new T.MeshStandardMaterial({
      color: shellColor, emissive: railColor, emissiveIntensity: 0.12,
      roughness: 0.24, metalness: 0.45,
    }),
    frame: new T.MeshStandardMaterial({
      color: 0x161822, emissive: 0x000000, emissiveIntensity: 0,
      roughness: 0.48, metalness: 0.35,
    }),
    nose: new T.MeshStandardMaterial({
      color: 0xfd9927, emissive: 0xfd9927, emissiveIntensity: 0.3,
      roughness: 0.22, metalness: 0.4,
    }),
    rear: new T.MeshStandardMaterial({
      color: 0x7b75ff, emissive: 0x7b75ff, emissiveIntensity: 0.15,
      roughness: 0.3, metalness: 0.4,
    }),
    rail: new T.MeshStandardMaterial({
      color: railColor, emissive: railColor, emissiveIntensity: 0.22,
      roughness: 0.22, metalness: 0.55,
    }),
  };
}

export function applyCompassKartRestyle3D(group, charColor, T, charId) {
  if (!group || group.userData.sculptedKart) return;
  const mats = getCompassKartMats3D(T, charColor);
  const bodyMesh = group.userData.mainBody;
  if (!bodyMesh) {
    for (const mat of Object.values(mats)) mat.dispose();
    return;
  }
  const style = getVehicleProfile(charId).style || "generic";
  bodyMesh.material = mats.shell;
  for (const key of ["frame", "nose", "rear", "rail"]) {
    mats[key].dispose();
    mats[key] = null;
  }
  group.userData.compassMaterials = mats;
  group.userData.boostMaterial = mats.shell;
  group.userData.boostBaseEmissiveIntensity = mats.shell.emissiveIntensity;
  group.userData.vehicleStyle = style;
}


function getKartEnvMap3D(T) {
  if (!THREE_STATE.renderer || !T.PMREMGenerator) return null;
  if (THREE_STATE.kartEnvMap && THREE_STATE._kartEnvRenderer === THREE_STATE.renderer) {
    return THREE_STATE.kartEnvMap;
  }
  try {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const cx = c.getContext("2d");
    // Crisp automotive studio horizon gradient for glossy paint & chrome highlights
    const bg = cx.createLinearGradient(0, 0, 0, 64);
    bg.addColorStop(0.0, "#eef5ff");
    bg.addColorStop(0.18, "#8fb6f0");
    bg.addColorStop(0.45, "#232a46");
    bg.addColorStop(0.50, "#f5f0ff");
    bg.addColorStop(0.56, "#2c2238");
    bg.addColorStop(1.0, "#0b0c14");
    cx.fillStyle = bg;
    cx.fillRect(0, 0, 128, 64);
    // Overhead softbox specular bands
    cx.fillStyle = "rgba(255,255,255,0.92)";
    cx.fillRect(10, 6, 44, 7);
    cx.fillRect(72, 9, 38, 6);
    cx.fillStyle = "rgba(180,220,255,0.55)";
    cx.fillRect(0, 29, 128, 3);

    const srcTex = new T.CanvasTexture(c);
    srcTex.mapping = T.EquirectangularReflectionMapping;
    if (T.SRGBColorSpace) srcTex.colorSpace = T.SRGBColorSpace;
    const pmrem = new T.PMREMGenerator(THREE_STATE.renderer);
    const rt = pmrem.fromEquirectangular(srcTex);
    srcTex.dispose();
    pmrem.dispose();
    const envTex = rt.texture;
    envTex.userData = { shared: true };
    THREE_STATE.kartEnvMap = envTex;
    THREE_STATE._kartEnvRenderer = THREE_STATE.renderer;
    return envTex;
  } catch (_err) {
    return null;
  }
}

function addMesh3D(T, parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = false) {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  if (shadow && ENABLE_3D_SHADOWS) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  parent.add(m);
  return m;
}

function makeSculptedHullGeo(T, profilePts, width, bevel = 0.9, bevelSizeRatio = 0.72) {
  const shape = new T.Shape();
  shape.moveTo(profilePts[0][0], profilePts[0][1]);
  for (let i = 1; i < profilePts.length; i++) {
    shape.lineTo(profilePts[i][0], profilePts[i][1]);
  }
  shape.closePath();
  const innerDepth = Math.max(0.4, width - bevel * 2);
  const geo = new T.ExtrudeGeometry(shape, {
    depth: innerDepth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * bevelSizeRatio,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -innerDepth / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function makeSpokeWheelGeo(T, rimR, width) {
  const shape = new T.Shape();
  const spokes = 6;
  const rHub = rimR * 0.36;
  const rOut = rimR * 0.94;
  const halfAng = 0.14;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * TAU;
    const aPrev = a - Math.PI / spokes;
    const x0 = Math.cos(aPrev) * rHub, y0 = Math.sin(aPrev) * rHub;
    const x1 = Math.cos(a - halfAng) * rOut, y1 = Math.sin(a - halfAng) * rOut;
    const x2 = Math.cos(a + halfAng) * rOut, y2 = Math.sin(a + halfAng) * rOut;
    if (i === 0) shape.moveTo(x0, y0);
    else shape.lineTo(x0, y0);
    shape.lineTo(x1, y1);
    shape.lineTo(x2, y2);
  }
  shape.closePath();
  const depth = width * 0.84;
  const geo = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function makeTireGeo(T, radius, width) {
  const hw = width * 0.5;
  const rimR = radius * 0.58;
  const shoulderR = radius * 0.93;
  const pts = [
    new T.Vector2(rimR * 0.88, -hw * 0.84),
    new T.Vector2(rimR, -hw * 0.95),
    new T.Vector2(shoulderR, -hw),
    new T.Vector2(radius, -hw * 0.7),
    new T.Vector2(radius, hw * 0.7),
    new T.Vector2(shoulderR, hw),
    new T.Vector2(rimR, hw * 0.95),
    new T.Vector2(rimR * 0.88, hw * 0.84),
  ];
  const geo = new T.LatheGeometry(pts, 18);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}


export function disposeTethers3D() {
  if (!THREE_STATE._tethers || !window.THREE) return;
  const T = window.THREE;
  if (THREE_STATE._tethers instanceof Map) {
    for (const entry of THREE_STATE._tethers.values()) {
      if (entry.line) {
        THREE_STATE.scene.remove(entry.line);
        entry.line.geometry.dispose();
        entry.line.material.dispose();
      }
    }
    THREE_STATE._tethers.clear();
  } else if (Array.isArray(THREE_STATE._tethers)) {
    THREE_STATE._tethers.forEach(t => {
      THREE_STATE.scene.remove(t);
      t.geometry.dispose();
      t.material.dispose();
    });
    THREE_STATE._tethers = new Map();
  }
}


export function syncMergeTethers3D() {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;
  if (!THREE_STATE._tethers || !(THREE_STATE._tethers instanceof Map)) {
    THREE_STATE._tethers = new Map();
  }
  const currentKarts = getActiveKarts();
  for (const [kart, entry] of THREE_STATE._tethers) {
    if (currentKarts.indexOf(kart) >= 0) {
      entry.line.visible = false;
      continue;
    }
    THREE_STATE.scene.remove(entry.line);
    entry.line.geometry.dispose();
    entry.line.material.dispose();
    THREE_STATE._tethers.delete(kart);
  }

  for (const kart of currentKarts) {
    if (!kart || !kart.mergePullTimer || kart.mergePullTimer <= 0) continue;
    const target = kart.mergePullTarget || (kart.mergePullTargetId ? getKartById(kart.mergePullTargetId) : null);
    if (!target) continue;
    let entry = THREE_STATE._tethers.get(kart);
    if (!entry) {
      const pos = new Float32Array(6);
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      const mat = new T.LineBasicMaterial({ color: 0xa4ff80, transparent: true, opacity: 0.85 });
      const line = new T.Line(geo, mat);
      line.frustumCulled = false;
      THREE_STATE.scene.add(line);
      entry = { line, pos, geo };
      THREE_STATE._tethers.set(kart, entry);
    }
    entry.pos[0] = kart.x; entry.pos[1] = 12 + (kart.z || 0); entry.pos[2] = kart.y;
    entry.pos[3] = target.x; entry.pos[4] = 12 + (target.z || 0); entry.pos[5] = target.y;
    entry.geo.attributes.position.needsUpdate = true;
    entry.line.visible = true;
  }
}


export function buildKartModel3D(charId, color) {
  if (!window.THREE) return null;
  const T = window.THREE;
  const group = new T.Group();
  const envMap = getKartEnvMap3D(T);

  const c = new T.Color(color);
  const cDark = c.clone().multiplyScalar(0.42);
  const cBright = c.clone().lerp(new T.Color(0xffffff), 0.42);

  // Shared materials per kart (kept local to this kart group for safe disposal)
  const paintMat = new T.MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: 0.13,
    roughness: 0.22,
    metalness: 0.48,
    envMap,
    envMapIntensity: 1.05,
  });
  const trimMat = new T.MeshStandardMaterial({
    color: cDark,
    emissive: cDark,
    emissiveIntensity: 0.04,
    roughness: 0.34,
    metalness: 0.45,
    envMap,
    envMapIntensity: 0.7,
  });
  let _accentPaintMat = null;
  const getAccentPaintMat = () => _accentPaintMat || (_accentPaintMat = new T.MeshStandardMaterial({
    color: cBright,
    emissive: c,
    emissiveIntensity: 0.2,
    roughness: 0.18,
    metalness: 0.55,
    envMap,
    envMapIntensity: 1.15,
  }));
  const carbonMat = new T.MeshStandardMaterial({
    color: 0x171923,
    roughness: 0.5,
    metalness: 0.35,
    envMap,
    envMapIntensity: 0.5,
  });
  const chromeMat = new T.MeshStandardMaterial({
    color: 0xdce4f0,
    roughness: 0.12,
    metalness: 0.9,
    envMap,
    envMapIntensity: 1.35,
  });
  const tireMat = new T.MeshStandardMaterial({
    color: 0x121318,
    roughness: 0.88,
    metalness: 0.08,
  });
  const rimBarrelMat = new T.MeshStandardMaterial({
    color: 0x262a36,
    roughness: 0.35,
    metalness: 0.72,
    envMap,
    envMapIntensity: 0.8,
  });
  const alloyMat = new T.MeshStandardMaterial({
    color: 0xcfd6e4,
    roughness: 0.18,
    metalness: 0.88,
    envMap,
    envMapIntensity: 1.25,
  });
  const rimRingMat = new T.MeshStandardMaterial({
    color: cBright,
    emissive: c,
    emissiveIntensity: 0.38,
    roughness: 0.22,
    metalness: 0.65,
  });
  const headlightMat = new T.MeshStandardMaterial({
    color: 0xfffbe0,
    emissive: 0xfff4b8,
    emissiveIntensity: 1.65,
    roughness: 0.12,
    metalness: 0.2,
  });
  const taillightMat = new T.MeshStandardMaterial({
    color: 0xff2233,
    emissive: 0xff2438,
    emissiveIntensity: 0.95,
    roughness: 0.18,
    metalness: 0.2,
  });
  const glassMat = new T.MeshStandardMaterial({
    color: 0x1a2840,
    emissive: 0x18304d,
    emissiveIntensity: 0.18,
    roughness: 0.06,
    metalness: 0.85,
    transparent: true,
    opacity: 0.78,
    envMap,
    envMapIntensity: 1.5,
  });
  const cockpitMat = new T.MeshStandardMaterial({
    color: 0x11131b,
    roughness: 0.65,
    metalness: 0.2,
  });
  let _neonMat = null;
  const getNeonMat = () => _neonMat || (_neonMat = new T.MeshStandardMaterial({
    color: cBright,
    emissive: c,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    metalness: 0.3,
  }));
  const exhaustGlowMat = new T.MeshStandardMaterial({
    color: 0xff7722,
    emissive: 0xff5511,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });

  group._wheels = [];
  group._frontWheelPivots = [];
  group._taillights = [taillightMat];

  // Properly oriented LatheGeometry wheels with 6 spinning alloy spokes + outboard accent ring
  function addWheels(specs) {
    const geoCache = new Map();
    const getWheelGeos = (radius, width) => {
      const key = `${radius.toFixed(2)}:${width.toFixed(2)}`;
      if (geoCache.has(key)) return geoCache.get(key);
      const rimR = radius * 0.58;
      const geos = {
        tire: makeTireGeo(T, radius, width),
        barrel: new T.CylinderGeometry(rimR * 0.95, rimR * 0.95, width * 0.76, 14),
        spokes: makeSpokeWheelGeo(T, rimR, width),
        ring: new T.TorusGeometry(rimR * 0.93, 0.22, 6, 18),
      };
      geos.barrel.rotateZ(Math.PI / 2);
      geos.ring.rotateY(Math.PI / 2);
      geoCache.set(key, geos);
      return geos;
    };

    specs.forEach((spec, idx) => {
      const [wx, wz, radius = 3.8, width = 3.6, isFront = idx < 2] = spec;
      const wy = radius + 0.4;
      const geos = getWheelGeos(radius, width);
      const side = Math.sign(wx) || 1;

      const steerPivot = new T.Group();
      steerPivot.position.set(wx, wy, wz);
      const wheelGroup = new T.Group();

      addMesh3D(T, wheelGroup, geos.tire, tireMat, 0, 0, 0, 0, 0, 0, true);
      addMesh3D(T, wheelGroup, geos.barrel, rimBarrelMat);
      addMesh3D(T, wheelGroup, geos.spokes, alloyMat);
      addMesh3D(T, wheelGroup, geos.ring, rimRingMat, side * width * 0.43, 0, 0);

      steerPivot.add(wheelGroup);
      group.add(steerPivot);
      group._wheels.push(wheelGroup);
      if (isFront) group._frontWheelPivots.push(steerPivot);
    });
  }

  function addDriver(x, y, z, visorHex = 0x162238, visorEmissive = color, helmetScale = 1) {
    // Racing seat & shoulders
    addMesh3D(T, group, new T.BoxGeometry(5.6 * helmetScale, 3.2 * helmetScale, 3.2 * helmetScale), cockpitMat, x, y - 2.3 * helmetScale, z - 0.5);
    addMesh3D(T, group, new T.BoxGeometry(4.2 * helmetScale, 3.6 * helmetScale, 1.4 * helmetScale), trimMat, x, y - 1.2 * helmetScale, z - 2.2 * helmetScale);
    // Glossy helmet shell
    const helmetMat = new T.MeshStandardMaterial({
      color: cBright,
      emissive: c,
      emissiveIntensity: 0.22,
      roughness: 0.16,
      metalness: 0.55,
      envMap,
      envMapIntensity: 1.2,
    });
    const r = 2.85 * helmetScale;
    addMesh3D(T, group, new T.SphereGeometry(r, 14, 10), helmetMat, x, y + 0.5 * helmetScale, z);
    // Front-facing wrap-around visor (+Z is phi = PI/2)
    const visorMat = new T.MeshStandardMaterial({
      color: visorHex,
      emissive: visorEmissive,
      emissiveIntensity: 0.32,
      roughness: 0.06,
      metalness: 0.92,
      envMap,
      envMapIntensity: 1.5,
    });
    const visorGeo = new T.SphereGeometry(r * 1.03, 12, 6, Math.PI / 2 - 1.15, 2.3, 0.72, 0.62);
    addMesh3D(T, group, visorGeo, visorMat, x, y + 0.5 * helmetScale, z);
  }

  function addExhaustPair(xs, y, z, radius = 1.25, len = 3.8) {
    const pipeGeo = new T.CylinderGeometry(radius * 0.85, radius, len, 10);
    pipeGeo.rotateX(Math.PI / 2);
    const glowGeo = new T.CylinderGeometry(radius * 0.62, radius * 0.62, 0.7, 8);
    glowGeo.rotateX(Math.PI / 2);
    for (const ex of xs) {
      addMesh3D(T, group, pipeGeo, chromeMat, ex, y, z);
      addMesh3D(T, group, glowGeo, exhaustGlowMat, ex, y, z - len * 0.45);
    }
  }

  let body;
  let flameZ = -26;
  let flameY = 5.2;
  let shadowW = 36;
  let shadowL = 46;

  if (charId === "anton") {
    // FORMULA RACER: needle nosecone, sculpted sidepods, halo cockpit, dorsal fin, multi-plane F1 wings
    const hullGeo = makeSculptedHullGeo(T, [
      [-15.5, 2.6], [11.5, 2.2], [19.2, 3.0], [18.6, 4.4],
      [9.5, 6.2], [3.5, 7.6], [-2.5, 7.4], [-5.2, 10.6],
      [-12.5, 9.2], [-15.8, 6.2],
    ], 8.6, 0.85);
    body = addMesh3D(T, group, hullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    // Carbon undertray floor plank + rear diffuser
    addMesh3D(T, group, new T.BoxGeometry(15.6, 1.0, 27), carbonMat, 0, 2.1, -1.5);
    addMesh3D(T, group, new T.BoxGeometry(11.5, 2.4, 3.2), carbonMat, 0, 3.0, -15.4);
    for (const sx of [-3.6, 0, 3.6]) {
      addMesh3D(T, group, new T.BoxGeometry(0.55, 2.2, 3.4), trimMat, sx, 2.8, -15.6);
    }

    // Sculpted sidepods + radiator air intakes + neon accent strips
    const sidepodGeo = makeSculptedHullGeo(T, [
      [-12.5, 2.6], [6.5, 2.6], [8.0, 5.8], [4.5, 6.8], [-5.5, 6.4], [-13.2, 4.4],
    ], 4.4, 0.55);
    const intakeGeo = new T.BoxGeometry(3.2, 2.6, 0.9);
    const stripGeo = new T.BoxGeometry(0.45, 0.55, 18.5);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, sidepodGeo, paintMat, s * 6.0, 0, 0, 0, 0, 0, true);
      addMesh3D(T, group, intakeGeo, cockpitMat, s * 6.0, 4.8, 7.8);
      addMesh3D(T, group, stripGeo, getNeonMat(), s * 8.2, 5.2, -2.0);
    }

    // Nose racing stripe & dorsal shark fin
    addMesh3D(T, group, new T.BoxGeometry(2.0, 0.35, 16.5), getAccentPaintMat(), 0, 5.6, 10.2, 0.14, 0, 0);
    const finGeo = makeSculptedHullGeo(T, [[-14.5, 6.8], [-5.0, 7.6], [-5.5, 11.4], [-14.2, 10.0]], 0.7, 0.12);
    addMesh3D(T, group, finGeo, trimMat);

    // Open cockpit tub, driver, aero windscreen & F1 halo arch
    addMesh3D(T, group, new T.BoxGeometry(6.2, 2.4, 8.8), cockpitMat, 0, 6.9, -0.8);
    addDriver(0, 9.6, -1.6, 0x161a36, 0x57f2ff, 0.92);
    addMesh3D(T, group, new T.BoxGeometry(5.6, 1.9, 0.5), glassMat, 0, 8.5, 3.8, -0.58, 0, 0);
    const haloArc = new T.TorusGeometry(3.5, 0.42, 6, 14, Math.PI);
    addMesh3D(T, group, haloArc, carbonMat, 0, 10.6, 1.4, Math.PI / 2 - 0.16, 0, 0);
    addMesh3D(T, group, new T.CylinderGeometry(0.32, 0.36, 3.0, 6), carbonMat, 0, 9.2, 4.6, -0.35, 0, 0);

    // Wide multi-plane front wing + endplates
    addMesh3D(T, group, new T.BoxGeometry(19.6, 0.75, 4.2), carbonMat, 0, 2.5, 18.2);
    addMesh3D(T, group, new T.BoxGeometry(17.8, 0.55, 2.0), getAccentPaintMat(), 0, 3.4, 17.0, 0.18, 0, 0);
    const frontPlateGeo = new T.BoxGeometry(0.65, 2.9, 5.0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, frontPlateGeo, paintMat, s * 9.8, 3.4, 18.0);
    }

    // High swan-neck F1 rear wing + endplates
    addMesh3D(T, group, new T.BoxGeometry(19.2, 0.85, 3.6), paintMat, 0, 12.2, -16.4, 0.14, 0, 0);
    addMesh3D(T, group, new T.BoxGeometry(18.6, 0.55, 1.9), getAccentPaintMat(), 0, 13.4, -17.3, 0.32, 0, 0);
    const rearPlateGeo = new T.BoxGeometry(0.75, 5.2, 4.8);
    const pylonGeo = new T.BoxGeometry(0.7, 5.6, 1.6);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, rearPlateGeo, carbonMat, s * 9.5, 11.4, -16.6);
      addMesh3D(T, group, pylonGeo, carbonMat, s * 3.0, 9.2, -15.8, -0.15, 0, 0);
    }

    // Spring-mounted telemetry antenna (animated by sync3DKartFlair)
    addMesh3D(T, group, new T.CylinderGeometry(0.2, 0.32, 8.2, 6), chromeMat, 0, 14.5, -8.5);
    const antTip = addMesh3D(T, group, new T.SphereGeometry(1.15, 10, 8), getNeonMat(), 0, 18.8, -8.5);
    group._antennaTip = antTip;
    group._antennaTipBaseY = 18.8;

    // Suspension wishbones + exposed open wheels (wider rear slicks)
    const wishboneGeo = new T.BoxGeometry(14.5, 0.45, 0.7);
    addMesh3D(T, group, wishboneGeo, carbonMat, 0, 4.2, 12.4);
    addMesh3D(T, group, wishboneGeo, carbonMat, 0, 4.5, -11.8);
    addWheels([
      [-8.8, 12.4, 3.7, 3.4, true],
      [8.8, 12.4, 3.7, 3.4, true],
      [-9.2, -11.8, 4.2, 4.4, false],
      [9.2, -11.8, 4.2, 4.4, false],
    ]);

    // Nose LED headlights + central F1 rain/brake light + side rear LEDs + dual exhaust
    const hlGeo = new T.BoxGeometry(2.2, 0.75, 1.0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, hlGeo, headlightMat, s * 4.0, 4.3, 15.6);
      addMesh3D(T, group, new T.BoxGeometry(0.65, 2.2, 0.6), taillightMat, s * 9.5, 10.6, -18.8);
    }
    addMesh3D(T, group, new T.BoxGeometry(2.4, 1.8, 0.8), taillightMat, 0, 4.4, -17.0);
    addExhaustPair([-2.1, 2.1], 4.6, -16.2, 1.0, 3.0);
    flameZ = -27;

  } else if (charId === "artur") {
    // MUSCLE INTERCEPTOR: chiseled widebody fastback, chrome V8 supercharger blower, quad exhausts, GT wing
    const hullGeo = makeSculptedHullGeo(T, [
      [-16.2, 2.8], [16.5, 2.6], [17.4, 5.2], [16.2, 8.2],
      [6.5, 9.0], [1.5, 12.8], [-6.8, 12.6], [-14.2, 9.4],
      [-16.8, 8.6], [-16.6, 4.6],
    ], 19.2, 1.0);
    body = addMesh3D(T, group, hullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    // Aggressive front splitter, dark honeycomb grille & rear diffuser
    addMesh3D(T, group, new T.BoxGeometry(21.4, 1.0, 3.8), carbonMat, 0, 2.4, 16.5);
    addMesh3D(T, group, new T.BoxGeometry(15.6, 3.2, 1.2), cockpitMat, 0, 5.6, 17.5);
    addMesh3D(T, group, new T.BoxGeometry(19.6, 2.2, 2.8), carbonMat, 0, 3.2, -16.4);

    // Widebody fender flares + swept flame accent side strakes
    const flareGeo = new T.BoxGeometry(1.6, 4.4, 9.2);
    const flameAccentMat = new T.MeshStandardMaterial({
      color: 0xffb347,
      emissive: 0xff6a00,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.4,
    });
    const strakeGeo = makeSculptedHullGeo(T, [[-8.0, 4.8], [7.5, 5.6], [5.0, 7.0], [-6.5, 6.2]], 0.5, 0.08);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, flareGeo, trimMat, s * 10.1, 4.8, 10.6);
      addMesh3D(T, group, flareGeo, trimMat, s * 10.3, 5.1, -10.4);
      addMesh3D(T, group, strakeGeo, flameAccentMat, s * 9.8, 0, 0);
    }

    // Chrome V8 supercharger blower & intake butterflies poking through the hood
    addMesh3D(T, group, new T.BoxGeometry(6.6, 3.2, 7.4), carbonMat, 0, 10.2, 9.8);
    addMesh3D(T, group, new T.BoxGeometry(5.6, 2.2, 6.2), chromeMat, 0, 12.1, 10.0);
    for (const s of [-1.4, 1.4]) {
      addMesh3D(T, group, new T.CylinderGeometry(1.05, 1.05, 1.2, 10), exhaustGlowMat, s, 12.2, 13.1, Math.PI / 2, 0, 0);
    }

    // Sculpted wrap-around fastback glasshouse (windshield, side windows & rear fastback glass)
    const cabinGlassGeo = makeSculptedHullGeo(T, [
      [-13.4, 9.8], [6.6, 9.6], [1.6, 13.0], [-6.8, 12.9],
    ], 17.6, 0.75);
    addMesh3D(T, group, cabinGlassGeo, glassMat, 0, 0.25, 0);
    // Painted roof cap + rear window louvers + roof scoop
    addMesh3D(T, group, new T.BoxGeometry(15.2, 0.7, 8.6), paintMat, 0, 13.75, -2.6);
    for (let i = 0; i < 3; i++) {
      addMesh3D(T, group, new T.BoxGeometry(14.4, 0.45, 0.9), carbonMat, 0, 13.2 - i * 0.9, -8.0 - i * 1.9, 0.44, 0, 0);
    }
    addMesh3D(T, group, new T.BoxGeometry(5.2, 1.8, 5.2), trimMat, 0, 14.7, -2.2);
    addDriver(0, 10.6, -1.6, 0x2a1808, 0xff8a3b, 0.88);

    // Pedestal muscle GT spoiler
    addMesh3D(T, group, new T.BoxGeometry(22.2, 1.1, 3.6), carbonMat, 0, 13.4, -15.6, 0.14, 0, 0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(1.2, 4.4, 2.2), trimMat, s * 7.8, 11.1, -15.4);
      addMesh3D(T, group, new T.BoxGeometry(0.7, 2.6, 4.2), paintMat, s * 11.1, 13.5, -15.6);
    }

    // Quad muscle exhausts, aggressive quad headlights & full-width muscle LED taillight bar
    addExhaustPair([-5.8, -3.5, 3.5, 5.8], 3.4, -17.6, 1.15, 3.4);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(3.8, 1.4, 0.9), headlightMat, s * 6.8, 6.2, 17.8);
    }
    addMesh3D(T, group, new T.BoxGeometry(17.6, 1.65, 0.9), taillightMat, 0, 6.8, -17.4);

    // Wide muscle tires (beefier rear)
    addWheels([
      [-10.4, 10.6, 3.9, 3.8, true],
      [10.4, 10.6, 3.9, 3.8, true],
      [-10.8, -10.4, 4.4, 4.8, false],
      [10.8, -10.4, 4.4, 4.8, false],
    ]);
    shadowW = 40;
    shadowL = 48;
    flameZ = -27;

  } else if (charId === "rissal") {
    // CYBER COMPACT COUPE: aerodynamic hot-hatch wedge, panoramic glasshouse, pulsing neon underglow (0 PointLights)
    const hullGeo = makeSculptedHullGeo(T, [
      [-13.5, 2.6], [13.5, 2.4], [15.4, 4.8], [13.6, 7.6],
      [6.2, 8.6], [0.8, 12.6], [-7.4, 12.4], [-13.6, 9.2],
      [-14.2, 5.0],
    ], 17.4, 1.1);
    body = addMesh3D(T, group, hullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    // Dark carbon lower aero kit, front intake air dam & rear diffuser
    addMesh3D(T, group, new T.BoxGeometry(18.6, 1.2, 28.4), carbonMat, 0, 2.2, 0.2);
    addMesh3D(T, group, new T.BoxGeometry(13.4, 2.2, 1.0), cockpitMat, 0, 4.0, 15.6);
    addMesh3D(T, group, new T.BoxGeometry(14.0, 2.2, 2.4), carbonMat, 0, 3.2, -14.2);

    // Sleek panoramic tinted canopy + sloped windshield + side windows + cyber mint roof rails
    const canopyGeo = makeSculptedHullGeo(T, [
      [-11.4, 9.0], [6.8, 9.0], [1.6, 13.5], [-7.2, 13.4],
    ], 15.2, 0.75);
    addMesh3D(T, group, canopyGeo, glassMat, 0, 0.2, 0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(0.6, 0.55, 11.2), getNeonMat(), s * 6.8, 13.8, -2.6);
    }
    addDriver(0, 10.2, -1.8, 0x0a2626, 0x4dffaa, 0.86);

    // Compact twin-post hatchback wing
    addMesh3D(T, group, new T.BoxGeometry(17.8, 0.95, 3.0), trimMat, 0, 13.4, -12.8, 0.16, 0, 0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(1.0, 3.2, 1.8), carbonMat, s * 6.4, 11.7, -12.6);
    }

    // Signature neon underglow perimeter strips + subtle additive ground glow halo (animated by sync3DKartFlair)
    const underglowMat = new T.MeshStandardMaterial({
      color: 0x4dffaa,
      emissive: 0x4dffaa,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.85,
      roughness: 0.15,
    });
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(0.8, 0.75, 25.0), underglowMat, s * 9.5, 1.6, 0);
    }
    addMesh3D(T, group, new T.BoxGeometry(17.8, 0.75, 0.8), underglowMat, 0, 1.6, 14.5);
    addMesh3D(T, group, new T.BoxGeometry(17.8, 0.75, 0.8), underglowMat, 0, 1.6, -14.2);
    const underPoolMat = new T.MeshBasicMaterial({
      map: getParticleGlowTexture3D(T),
      color: 0x4dffaa,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    const underPool = addMesh3D(T, group, new T.PlaneGeometry(30, 42), underPoolMat, 0, 0.74, 0, -Math.PI / 2, 0, 0);
    underPool.renderOrder = 2;
    group._underglowMat = underglowMat;

    // Cyber full-width LED front lightbar & glowing rear lightbar + center twin titanium exhausts
    addMesh3D(T, group, new T.BoxGeometry(14.8, 0.9, 0.8), headlightMat, 0, 6.1, 15.8);
    addMesh3D(T, group, new T.BoxGeometry(15.6, 1.25, 0.8), taillightMat, 0, 6.8, -14.8);
    addExhaustPair([-1.7, 1.7], 3.3, -15.2, 1.15, 2.8);

    addWheels([
      [-9.3, 9.4, 3.6, 3.5, true],
      [9.3, 9.4, 3.6, 3.5, true],
      [-9.5, -9.4, 3.8, 3.9, false],
      [9.5, -9.4, 3.8, 3.9, false],
    ]);
    shadowW = 34;
    shadowL = 42;
    flameZ = -24;

  } else if (charId === "pia") {
    // ARMORED TACTICAL SUV: tall chamfered hull, heavy bullbar, roof rack + 4 rally spotlights, oversized off-road tires
    const hullGeo = makeSculptedHullGeo(T, [
      [-15.4, 4.0], [15.4, 4.0], [16.8, 6.6], [15.8, 10.2],
      [7.8, 10.8], [4.2, 16.0], [-12.2, 15.8], [-15.8, 12.2],
      [-16.2, 6.2],
    ], 22.0, 1.0);
    body = addMesh3D(T, group, hullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    // Armored lower chassis & heavy rock-slider side plating
    addMesh3D(T, group, new T.BoxGeometry(23.6, 2.4, 31.4), carbonMat, 0, 4.0, 0);
    const sideArmorGeo = new T.BoxGeometry(1.5, 4.6, 25.0);
    const fenderGeo = new T.BoxGeometry(2.2, 3.2, 10.5);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, sideArmorGeo, trimMat, s * 11.7, 6.8, 0);
      addMesh3D(T, group, fenderGeo, carbonMat, s * 11.6, 8.6, 10.8);
      addMesh3D(T, group, fenderGeo, carbonMat, s * 11.6, 8.6, -10.8);
    }

    // Sculpted wrap-around armored cabin glasshouse (windshield, side & rear tactical windows)
    const suvGlassGeo = makeSculptedHullGeo(T, [
      [-15.2, 11.6], [7.8, 11.4], [4.4, 15.8], [-12.2, 15.7],
    ], 21.4, 0.72);
    addMesh3D(T, group, suvGlassGeo, glassMat, 0, 0.15, 0);
    // Painted roof cap & armored A/C pillars
    addMesh3D(T, group, new T.BoxGeometry(20.6, 0.85, 16.4), paintMat, 0, 16.55, -4.0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(1.1, 4.2, 1.4), paintMat, s * 10.6, 13.9, -4.0);
    }
    addDriver(0, 12.4, -1.0, 0x1e1233, 0x9d4dff, 0.9);

    // Front heavy bullbar, skid plate & armored bumpers
    addMesh3D(T, group, new T.BoxGeometry(25.0, 3.0, 3.2), carbonMat, 0, 5.2, 17.2);
    addMesh3D(T, group, new T.BoxGeometry(25.0, 3.0, 3.2), carbonMat, 0, 5.2, -17.0);
    addMesh3D(T, group, new T.BoxGeometry(13.0, 2.6, 1.0), chromeMat, 0, 3.4, 17.8, 0.45, 0, 0);
    const bullH = new T.CylinderGeometry(0.95, 0.95, 19.6, 10);
    bullH.rotateZ(Math.PI / 2);
    addMesh3D(T, group, bullH, chromeMat, 0, 9.2, 18.4);
    addMesh3D(T, group, bullH, chromeMat, 0, 6.6, 18.8);
    const bullPost = new T.CylinderGeometry(0.8, 0.8, 4.4, 8);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, bullPost, chromeMat, s * 6.5, 7.6, 18.4);
    }

    // Tactical roof rack + 4 rally amber floodlight pods + rear roof spoiler
    addMesh3D(T, group, new T.BoxGeometry(19.2, 0.9, 15.6), carbonMat, 0, 17.3, -4.0);
    for (const sx of [-9.0, 9.0]) {
      for (const sz of [3.0, -11.0]) {
        addMesh3D(T, group, new T.BoxGeometry(1.0, 1.8, 1.0), carbonMat, sx, 16.5, sz);
      }
    }
    const rallyLightMat = new T.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffc822,
      emissiveIntensity: 1.4,
      roughness: 0.15,
    });
    const podGeo = new T.CylinderGeometry(1.15, 1.15, 1.4, 10);
    podGeo.rotateX(Math.PI / 2);
    for (const rx of [-6.0, -2.0, 2.0, 6.0]) {
      addMesh3D(T, group, podGeo, carbonMat, rx, 18.4, 3.6);
      addMesh3D(T, group, new T.SphereGeometry(0.95, 8, 6), rallyLightMat, rx, 18.4, 4.2);
    }
    addMesh3D(T, group, new T.BoxGeometry(20.6, 1.0, 2.8), trimMat, 0, 16.6, -14.2, 0.12, 0, 0);

    // Armored headlights, vertical tactical taillights & heavy twin exhausts
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(4.2, 1.6, 0.9), headlightMat, s * 8.2, 8.6, 17.2);
      addMesh3D(T, group, new T.BoxGeometry(2.2, 4.4, 0.9), taillightMat, s * 9.6, 9.2, -16.8);
    }
    addExhaustPair([-6.2, 6.2], 4.2, -18.2, 1.4, 3.2);

    // Oversized off-road wheels
    addWheels([
      [-12.2, 10.8, 4.7, 4.6, true],
      [12.2, 10.8, 4.7, 4.6, true],
      [-12.2, -10.8, 4.7, 4.6, false],
      [12.2, -10.8, 4.7, 4.6, false],
    ]);
    shadowW = 44;
    shadowL = 48;
    flameY = 5.8;
    flameZ = -28;

  } else if (charId === "florian") {
    // EXECUTIVE GT SUPERCAR: sweeping hypercar fuselage, lime racing stripe, chrome rocker trim, spinning holographic badge
    const hullGeo = makeSculptedHullGeo(T, [
      [-16.8, 2.6], [17.2, 2.4], [18.8, 4.4], [16.2, 6.8],
      [7.2, 8.2], [1.4, 11.4], [-7.4, 11.2], [-15.2, 8.2],
      [-17.4, 6.6], [-17.0, 3.8],
    ], 19.0, 1.0);
    body = addMesh3D(T, group, hullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);

    // Carbon aero splitter, side air curtains & rear diffuser
    addMesh3D(T, group, new T.BoxGeometry(20.6, 0.85, 34.4), carbonMat, 0, 2.2, 0.2);
    addMesh3D(T, group, new T.BoxGeometry(16.2, 2.4, 2.6), carbonMat, 0, 3.1, -17.0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(1.1, 3.4, 9.0), cockpitMat, s * 9.5, 5.4, -4.5);
      addMesh3D(T, group, new T.BoxGeometry(0.65, 0.9, 27.0), chromeMat, s * 9.9, 3.0, 0);
    }

    // Teardrop executive greenhouse canopy (proud of beveled hull) + driver
    const canopyGeo = makeSculptedHullGeo(T, [
      [-11.8, 8.2], [7.4, 8.2], [1.8, 12.5], [-7.2, 12.3],
    ], 15.0, 0.75);
    addMesh3D(T, group, canopyGeo, glassMat, 0, 0.25, 0);
    addDriver(0, 9.8, -1.8, 0x0b2236, 0x57f2ff, 0.86);

    // Signature luminous lime center racing stripe + twin pinstripe accents
    const limeMat = new T.MeshStandardMaterial({
      color: 0xa4ff80,
      emissive: 0xa4ff80,
      emissiveIntensity: 0.72,
      roughness: 0.16,
      metalness: 0.65,
      envMap,
      envMapIntensity: 1.2,
    });
    addMesh3D(T, group, new T.BoxGeometry(2.0, 0.3, 10.6), limeMat, 0, 8.2, 12.8, 0.16, 0, 0);
    addMesh3D(T, group, new T.BoxGeometry(2.0, 0.3, 8.8), limeMat, 0, 13.35, -2.6);
    addMesh3D(T, group, new T.BoxGeometry(2.0, 0.3, 5.8), limeMat, 0, 9.2, -13.8, -0.22, 0, 0);

    // Floating spinning Regulatory Compliance Seal diamond crest (animated by sync3DKartFlair)
    const badgeMat = new T.MeshStandardMaterial({
      color: 0x57f2ff,
      emissive: 0x57f2ff,
      emissiveIntensity: 1.35,
      roughness: 0.1,
      metalness: 0.85,
      envMap,
      envMapIntensity: 1.5,
    });
    const badge = addMesh3D(T, group, new T.OctahedronGeometry(2.2, 0), badgeMat, 0, 10.4, 12.8);
    badge.scale.set(1.0, 0.72, 1.0);
    group._badge = badge;

    // Low-drag swan-neck GT rear wing
    addMesh3D(T, group, new T.BoxGeometry(20.6, 0.85, 3.2), carbonMat, 0, 11.4, -16.8, 0.12, 0, 0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(0.85, 3.6, 1.8), chromeMat, s * 5.8, 9.6, -16.4);
      addMesh3D(T, group, new T.BoxGeometry(0.6, 2.2, 3.8), limeMat, s * 10.3, 11.4, -16.8);
    }

    // Laser headlights, twin-blade LED taillights & quad chrome exhausts
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(4.4, 0.9, 1.0), headlightMat, s * 6.5, 5.5, 18.3);
      addMesh3D(T, group, new T.BoxGeometry(6.8, 1.15, 0.8), taillightMat, s * 5.4, 6.6, -17.8);
    }
    addExhaustPair([-4.8, -2.5, 2.5, 4.8], 3.3, -18.0, 1.05, 3.2);

    addWheels([
      [-10.0, 11.4, 3.8, 3.6, true],
      [10.0, 11.4, 3.8, 3.6, true],
      [-10.3, -11.2, 4.1, 4.4, false],
      [10.3, -11.2, 4.1, 4.4, false],
    ]);
    shadowW = 38;
    shadowL = 48;
    flameZ = -28;

  } else {
    // GENERIC SPORT KART FALLBACK
    const hullGeo = makeSculptedHullGeo(T, [
      [-14.5, 2.8], [14.5, 2.6], [16.5, 4.8], [14.0, 7.4],
      [5.5, 8.6], [-12.5, 8.8], [-15.2, 6.2],
    ], 17.6, 0.95);
    body = addMesh3D(T, group, hullGeo, paintMat, 0, 0, 0, 0, 0, 0, true);
    addMesh3D(T, group, new T.BoxGeometry(18.6, 1.2, 29.0), carbonMat, 0, 2.2, 0);
    addMesh3D(T, group, new T.BoxGeometry(11.6, 3.2, 0.7), glassMat, 0, 10.2, 4.6, -0.5, 0, 0);
    addDriver(0, 10.4, -1.6, 0x1a1e38, color, 0.92);
    addMesh3D(T, group, new T.BoxGeometry(19.6, 1.0, 3.0), trimMat, 0, 11.8, -14.8, 0.14, 0, 0);
    for (const s of [-1, 1]) {
      addMesh3D(T, group, new T.BoxGeometry(1.0, 3.6, 1.6), carbonMat, s * 6.8, 10.0, -14.6);
      addMesh3D(T, group, new T.BoxGeometry(3.4, 1.2, 0.8), headlightMat, s * 5.8, 5.6, 16.4);
      addMesh3D(T, group, new T.BoxGeometry(4.4, 1.2, 0.8), taillightMat, s * 5.2, 6.2, -15.4);
    }
    addExhaustPair([-4.2, 4.2], 3.5, -16.0, 1.15, 3.0);
    addWheels([
      [-9.5, 10.2, 3.7, 3.6, true],
      [9.5, 10.2, 3.7, 3.6, true],
      [-9.8, -10.2, 4.0, 4.2, false],
      [9.8, -10.2, 4.0, 4.2, false],
    ]);
    flameZ = -25;
  }

  group.userData.mainBody = body;
  group.userData.sculptedKart = true;
  group.userData.boostMaterial = paintMat;
  group.userData.boostBaseEmissiveIntensity = paintMat.emissiveIntensity;
  group._flairAdded = true;

  // Shield (wireframe icosahedron hex-grid + subtle inner glow)
  const shieldGeo = new T.IcosahedronGeometry(22, 1);
  const shieldMat = new T.MeshStandardMaterial({
    color: 0x57f2ff,
    emissive: 0x57f2ff,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0,
    wireframe: true,
    side: T.DoubleSide,
  });
  const shield = addMesh3D(T, group, shieldGeo, shieldMat, 0, 8, 0);
  const shieldInner = addMesh3D(
    T,
    group,
    new T.IcosahedronGeometry(20, 1),
    new T.MeshStandardMaterial({
      color: 0x57f2ff,
      emissive: 0x57f2ff,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0,
      side: T.DoubleSide,
    }),
    0,
    8,
    0
  );
  group._shield = shield;
  group._shieldMat = shieldMat;
  group._shieldInner = shieldInner;

  // Boost exhaust flame (emissive dual cones, zero PointLight overhead)
  const flameGroup = new T.Group();
  flameGroup.rotation.x = -Math.PI / 2;
  flameGroup.position.set(0, flameY, flameZ);
  flameGroup.visible = false;
  const flameMat = new T.MeshBasicMaterial({
    color: 0xff6e20,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  addMesh3D(T, flameGroup, new T.ConeGeometry(6.2, 26, 10), flameMat);
  const flameCoreMat = new T.MeshBasicMaterial({
    color: 0xffe480,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  addMesh3D(T, flameGroup, new T.ConeGeometry(3.2, 20, 8), flameCoreMat, 0, 2.5, 0);
  flameGroup._coreMat = flameCoreMat;
  group.add(flameGroup);
  group._flame = flameGroup;
  group._flameMat = flameMat;

  // Ground contact shadow + night headlight pool
  const contactShadowMat = new T.MeshBasicMaterial({
    map: getContactShadowTexture3D(T),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const contactShadow = addMesh3D(
    T,
    group,
    new T.PlaneGeometry(shadowW, shadowL),
    contactShadowMat,
    0,
    0.68,
    0,
    -Math.PI / 2,
    0,
    0
  );
  contactShadow.renderOrder = 2;
  group._contactShadow = contactShadow;

  const headlightPoolMat = new T.MeshBasicMaterial({
    map: getParticleGlowTexture3D(T),
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const headlightPool = addMesh3D(
    T,
    group,
    new T.PlaneGeometry(34, 72),
    headlightPoolMat,
    0,
    0.72,
    46,
    -Math.PI / 2,
    0,
    0
  );
  headlightPool.renderOrder = 2;
  headlightPool.visible = !isDayMode();
  group._headlightPool = headlightPool;

  group.rotation.order = "YXZ";
  group.userData._baseScale = 1;

  return group;
}


export function buildDragonModel3D(isEscapeDragon = false) {
  if (!window.THREE) return null;
  const T = window.THREE;
  const group = new T.Group();
  const s = isEscapeDragon ? 1.6 : 1.15;
  const baseColor = isEscapeDragon ? 0x2a1010 : 0x3a0d20;
  const glowColor = isEscapeDragon ? 0xff3300 : 0xff3366;
  const bodyMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.28, roughness: 0.35, metalness: 0.3 });
  const boneMat = new T.MeshStandardMaterial({ color: 0x4a2818, emissive: glowColor, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.2 });
  const wingMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.4, transparent: true, opacity: 0.7, side: T.DoubleSide });

  [[-80, 28, 0, 32], [-42, 34, 0, 36], [-4, 38, 0, 38], [30, 42, 0, 32], [58, 48, 0, 26]].forEach(([px, py, pz, r]) => {
    const seg = new T.Mesh(new T.SphereGeometry(r, 16, 12), bodyMat);
    seg.position.set(px, py, pz);
    seg.scale.set(1.1, 0.7, 0.75);
    seg.castShadow = true;
    group.add(seg);
  });
  const scaleMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.4 });
  [[-60, 20, 0], [-20, 24, 0], [15, 28, 0], [45, 34, 0]].forEach(([px, py, pz]) => {
    const belly = new T.Mesh(new T.SphereGeometry(14, 10, 8), scaleMat);
    belly.position.set(px, py - 8, pz);
    belly.scale.set(1.6, 0.4, 0.8);
    group.add(belly);
  });

  const head = new T.Mesh(new T.SphereGeometry(24, 18, 14), bodyMat);
  head.scale.set(1.4, 0.85, 0.85);
  head.position.set(80, 52, 0);
  head.castShadow = true;
  group.add(head);
  group._head = head;
  const browMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.1, roughness: 0.5 });
  [[72, 62, -10], [72, 62, 10]].forEach(pos => {
    const brow = new T.Mesh(new T.BoxGeometry(12, 3, 8), browMat);
    brow.position.set(pos[0], pos[1], pos[2]);
    brow.rotation.z = pos[2] > 0 ? -0.2 : 0.2;
    group.add(brow);
  });

  // Snout / jaw
  const jaw = new T.Mesh(new T.BoxGeometry(38, 12, 20), bodyMat);
  jaw.position.set(108, 48, 0);
  group.add(jaw);
  group._jaw = jaw;

  // Lower jaw (animated)
  const lowerJaw = new T.Mesh(new T.BoxGeometry(32, 8, 18), bodyMat);
  lowerJaw.position.set(104, 38, 0);
  group.add(lowerJaw);
  group._lowerJaw = lowerJaw;

  const teethMat = new T.MeshStandardMaterial({ color: 0xf0e8d8, emissive: 0xffffff, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const tooth = new T.Mesh(new T.ConeGeometry(2.5, 10 + (i % 2) * 3, 5), teethMat);
    tooth.position.set(90 + i * 6, 42, (i % 2 === 0 ? -7 : 7));
    tooth.rotation.z = Math.PI;
    group.add(tooth);
  }
  for (let i = 0; i < 4; i++) {
    const lTooth = new T.Mesh(new T.ConeGeometry(2, 7, 4), teethMat);
    lTooth.position.set(93 + i * 7, 35, (i % 2 === 0 ? -6 : 6));
    group.add(lTooth);
  }

  const eyeMat = new T.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffaa00, emissiveIntensity: 2.2 });
  const pupilMat = new T.MeshStandardMaterial({ color: 0x110000, emissive: 0xff0000, emissiveIntensity: 0.5 });
  [[76, 60, -12], [76, 60, 12]].forEach(pos => {
    const eye = new T.Mesh(new T.SphereGeometry(5.5, 12, 8), eyeMat);
    eye.position.set(pos[0], pos[1], pos[2]);
    group.add(eye);
    const pupil = new T.Mesh(new T.SphereGeometry(2.5, 8, 6), pupilMat);
    pupil.position.set(pos[0] + 3, pos[1], pos[2]);
    group.add(pupil);
    const eyeGlow = new T.PointLight(0xffaa00, 0.4, 40);
    eyeGlow.position.set(pos[0] + 5, pos[1], pos[2]);
    group.add(eyeGlow);
  });

  [[-1, 1], [1, 1]].forEach(([side, _]) => {
    const horn = new T.Mesh(new T.ConeGeometry(4, 32, 8), boneMat);
    horn.position.set(68, 68, side * 14);
    horn.rotation.z = -0.4 * side;
    horn.rotation.x = 0.15 * side;
    horn.castShadow = true;
    const hornTip = new T.Mesh(
      new T.ConeGeometry(1.5, 8, 6),
      new T.MeshStandardMaterial({ color: 0x2a1510, emissive: glowColor, emissiveIntensity: 0.3 })
    );
    hornTip.position.set(0, 18, 0);
    horn.add(hornTip);
    group.add(horn);
  });

  const spikeMat = new T.MeshStandardMaterial({ color: 0x8b0000, emissive: glowColor, emissiveIntensity: 0.2, metalness: 0.3 });
  for (let i = 0; i < 10; i++) {
    const spikeH = 16 + i * 1.8 + (i > 6 ? -i * 0.5 : 0);
    const spike = new T.Mesh(new T.ConeGeometry(3, spikeH, 6), spikeMat);
    spike.position.set(-90 + i * 19, 50 + i * 1.2, 0);
    spike.castShadow = true;
    group.add(spike);
  }

  for (let i = 0; i < 7; i++) {
    const tailR = 18 - i * 2.2;
    const tailSeg = new T.Mesh(new T.SphereGeometry(tailR, 12, 8), bodyMat);
    tailSeg.position.set(-100 - i * 24, 24 - i * 1.8, Math.sin(i * 0.8) * 14);
    tailSeg.castShadow = true;
    group.add(tailSeg);
  }
  const tailTipMat = new T.MeshStandardMaterial({ color: 0x8b0000, emissive: glowColor, emissiveIntensity: 0.6, metalness: 0.3 });
  const tailTip = new T.Mesh(new T.ConeGeometry(5, 20, 6), tailTipMat);
  tailTip.position.set(-270, 12, Math.sin(4.8) * 14);
  tailTip.rotation.z = Math.PI / 2;
  group.add(tailTip);
  const tailBlade1 = new T.Mesh(new T.ConeGeometry(3, 12, 4), tailTipMat);
  tailBlade1.position.set(-268, 18, Math.sin(4.8) * 14 + 4);
  tailBlade1.rotation.z = 0.5;
  group.add(tailBlade1);
  const tailBlade2 = new T.Mesh(new T.ConeGeometry(3, 12, 4), tailTipMat);
  tailBlade2.position.set(-268, 18, Math.sin(4.8) * 14 - 4);
  tailBlade2.rotation.z = -0.5;
  group.add(tailBlade2);

  for (const side of [-1, 1]) {
    const wingGeo = new T.BufferGeometry();
    wingGeo.setAttribute("position", new T.Float32BufferAttribute([
      0, 0, 0,  -60, 30, side * 110,  -30, -6, side * 30,
      -60, 30, side * 110,  -100, 18, side * 80,  -30, -6, side * 30,
      0, 0, 0,  -30, -6, side * 30,  10, -4, side * 50,
      -60, 30, side * 110,  -40, 35, side * 130,  -100, 18, side * 80,
    ], 3));
    wingGeo.computeVertexNormals();
    const wing = new T.Mesh(wingGeo, wingMat);
    wing.position.set(-20, 48, 0);
    wing.castShadow = true;
    group.add(wing);
    if (side === 1) group._wingR = wing;
    else group._wingL = wing;
    const veinMat = new T.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.5, transparent: true, opacity: 0.4 });
    for (let v = 0; v < 3; v++) {
      const veinGeo = new T.CylinderGeometry(0.5, 0.3, 60 + v * 10, 4);
      const vein = new T.Mesh(veinGeo, veinMat);
      const ang = (v - 1) * 0.3;
      vein.position.set(-20 - 30 - v * 10, 48 + 10 + v * 5, side * (40 + v * 25));
      vein.rotation.z = ang * side + 0.5;
      vein.rotation.x = side * 0.3;
      group.add(vein);
    }
  }

  const fireLight = new T.PointLight(isEscapeDragon ? 0xff4400 : 0xff3366, 1.2, 400);
  fireLight.position.set(120, 46, 0);
  group.add(fireLight);
  group._fireLight = fireLight;
  const ambientGlow = new T.PointLight(glowColor, 0.4, 250);
  ambientGlow.position.set(0, 40, 0);
  group.add(ambientGlow);

  group.scale.setScalar(s);
  return group;
}


export function createHazardMesh3D(hazard) {
  if (!window.THREE || !hazard) return null;
  const T = window.THREE;
  const ctor = hazard.constructor ? hazard.constructor.name : "";
  let mesh;

  if (ctor === "MergeConflict") {
    const g = new T.Group();
    const outer = new T.Mesh(
      new T.BoxGeometry(28, 28, 28),
      new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.8, wireframe: true })
    );
    g.add(outer);
    const mid = new T.Mesh(
      new T.BoxGeometry(22, 22, 22),
      new T.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff2244, emissiveIntensity: 0.4, wireframe: true, transparent: true, opacity: 0.5 })
    );
    mid.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    g.add(mid);
    const inner = new T.Mesh(
      new T.OctahedronGeometry(10, 1),
      new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff1a40, emissiveIntensity: 1.1, transparent: true, opacity: 0.75 })
    );
    g.add(inner);
    const arrowMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff4d6d, emissiveIntensity: 0.7, transparent: true, opacity: 0.7, side: T.DoubleSide });
    const arr1 = new T.Mesh(new T.PlaneGeometry(20, 6), arrowMat);
    arr1.rotation.y = Math.PI / 4;
    arr1.position.y = 2;
    g.add(arr1);
    const arr2 = new T.Mesh(new T.PlaneGeometry(20, 6), arrowMat);
    arr2.rotation.y = -Math.PI / 4;
    arr2.position.y = -2;
    g.add(arr2);
    const light = new T.PointLight(0xff4d6d, 0.7, 80);
    g.add(light);
    g.position.y = 16;
    mesh = g;

  } else if (ctor === "PlaceboPill") {
    // Pharmaceutical pill capsule (two-tone with Rx cross)
    const g = new T.Group();
    const halfL = new T.Mesh(
      new T.CapsuleGeometry(7, 10, 6, 8),
      new T.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.4 })
    );
    halfL.position.x = -5;
    halfL.rotation.z = Math.PI / 2;
    g.add(halfL);
    const halfR = new T.Mesh(
      new T.CapsuleGeometry(7, 10, 6, 8),
      new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffcc00, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 })
    );
    halfR.position.x = 5;
    halfR.rotation.z = Math.PI / 2;
    g.add(halfR);
    // Rx cross on surface
    const crossMat = new T.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.6 });
    const cv = new T.Mesh(new T.BoxGeometry(1.5, 10, 1.5), crossMat);
    g.add(cv);
    const ch = new T.Mesh(new T.BoxGeometry(8, 1.5, 1.5), crossMat);
    ch.position.y = 2;
    g.add(ch);
    g.position.y = 13;
    mesh = g;

  } else if (ctor === "DoubleBlindCloud") {
    // Dense volumetric fog cloud made of many overlapping billowed spheres
    const g = new T.Group();
    const baseR = Math.max(20, (hazard.r || 48) * 0.4);
    // Core cluster: many offset spheres at varying sizes for cloudiness
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const layerR = (i < 5) ? baseR * 0.5 : (i < 10 ? baseR * 0.7 : baseR * 0.35);
      const dist3 = (i < 5) ? 0 : (i < 10 ? baseR * 0.45 : baseR * 0.7);
      const yOff = (i % 3 === 0) ? 8 : (i % 3 === 1 ? 0 : -4);
      const s = new T.Mesh(
        new T.SphereGeometry(layerR, 8, 6),
        new T.MeshStandardMaterial({
          color: i < 5 ? 0xd480ff : 0xbd57ff,
          emissive: 0xbd57ff,
          emissiveIntensity: 0.3 + (i < 5 ? 0.2 : 0),
          transparent: true,
          opacity: i < 5 ? 0.22 : 0.12,
        })
      );
      s.position.set(Math.cos(ang) * dist3, yOff + Math.sin(i * 0.7) * 6, Math.sin(ang) * dist3);
      s._cloudIdx = i;
      g.add(s);
    }
    // Inner toxic glow
    const glow = new T.Mesh(
      new T.SphereGeometry(baseR * 0.3, 10, 8),
      new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbd57ff, emissiveIntensity: 1.5, transparent: true, opacity: 0.35 })
    );
    g.add(glow);
    const light = new T.PointLight(0xbd57ff, 0.8, 140);
    light.position.y = 5;
    g.add(light);
    g.position.y = 16;
    g._cloudBase = baseR;
    mesh = g;

  } else if (ctor === "RegulatoryProjectile") {
    const g = new T.Group();
    const enraged = hazard.enraged;
    const col = enraged ? 0xff7a18 : 0xff3366;
    const diamond = new T.Mesh(
      new T.OctahedronGeometry(enraged ? 18 : 14, 1),
      new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.0, transparent: true, opacity: 0.8, metalness: 0.4 })
    );
    g.add(diamond);
    const wireframe = new T.Mesh(
      new T.IcosahedronGeometry(enraged ? 22 : 17, 1),
      new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, wireframe: true, transparent: true, opacity: 0.45 })
    );
    g.add(wireframe);
    const innerGlow = new T.Mesh(
      new T.SphereGeometry(enraged ? 8 : 6, 10, 8),
      new T.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 1.5, transparent: true, opacity: 0.4 })
    );
    g.add(innerGlow);
    const trail = new T.PointLight(col, enraged ? 1.0 : 0.6, enraged ? 120 : 80);
    g.add(trail);
    g.position.y = 16;
    mesh = g;

  } else if (ctor === "DossierProjectile") {
    const g = new T.Group();
    const folderMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 });
    const back = new T.Mesh(new T.BoxGeometry(22, 26, 1.5), folderMat);
    back.position.z = -2;
    g.add(back);
    const frontMat = new T.MeshStandardMaterial({ color: 0x3ad0ee, emissive: 0x57f2ff, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.4 });
    const front = new T.Mesh(new T.BoxGeometry(22, 20, 1.5), frontMat);
    front.position.set(0, -3, 2);
    g.add(front);
    const tabMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 1.0 });
    const tab = new T.Mesh(new T.BoxGeometry(10, 5, 2), tabMat);
    tab.position.set(-4, 15, -2);
    g.add(tab);
    const paperMat = new T.MeshStandardMaterial({ color: 0xeeeeff, emissive: 0xffffff, emissiveIntensity: 0.2, side: T.DoubleSide });
    for (let p = 0; p < 4; p++) {
      const page = new T.Mesh(new T.BoxGeometry(18, 24, 0.4), paperMat);
      page.position.set(rand(-1, 1), 1 + p * 0.4, -0.5 + p * 0.7);
      page.rotation.z = (p - 1.5) * 0.035;
      g.add(page);
    }
    const lineMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.8 });
    for (let i = 0; i < 6; i++) {
      const line = new T.Mesh(new T.BoxGeometry(14 - (i % 2) * 4, 0.5, 0.3), lineMat);
      line.position.set(0, 9 - i * 3.5, 2.2);
      g.add(line);
    }
    const sealMat = new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.8 });
    const seal = new T.Mesh(new T.TorusGeometry(3.5, 0.5, 6, 12), sealMat);
    seal.position.set(6, -5, 2.5);
    g.add(seal);
    const trail = new T.PointLight(0x57f2ff, 0.7, 90);
    g.add(trail);
    g.position.y = 14;
    mesh = g;

  } else {
    // Generic hazard: glowing warning box
    const g = new T.Group();
    const box = new T.Mesh(
      new T.BoxGeometry(20, 20, 20),
      new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.65, wireframe: true })
    );
    g.add(box);
    const inner = new T.Mesh(
      new T.BoxGeometry(12, 12, 12),
      new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.5 })
    );
    g.add(inner);
    g.position.y = 12;
    mesh = g;
  }

  mesh._hazardRef = hazard;
  return mesh;
}


export function buildAllKartModels() {
  if (!window.THREE || !THREE_STATE.scene) return;
  THREE_STATE.kartModels.forEach(m => {
    THREE_STATE.scene.remove(m);
    dispose3DObject(m);
  });
  THREE_STATE.kartModels.clear();
  for (const kart of getActiveKarts()) {
    const model = buildKartModel3D(kart.charId, kart.color);
    if (model) {
      THREE_STATE.scene.add(model);
      THREE_STATE.kartModels.set(kart, model);
    }
  }
}
