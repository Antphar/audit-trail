import { TAU, rand } from "../core/math.js";
import { game, getActiveKarts, getKartById } from "../core/state.js";
import { getVehicleProfile } from "../config/characters.js";
import { THREE_STATE, ENABLE_3D_SHADOWS, dispose3DObject } from "./three-state.js";

export function getCompassKartMats3D(T, charColor) {
  const railColor = new T.Color(charColor);
  const shellColor = new T.Color(charColor).lerp(new T.Color(0x131019), 0.22);
  return {
    shell: new T.MeshStandardMaterial({
      color: shellColor, emissive: railColor, emissiveIntensity: 0.08,
      roughness: 0.32, metalness: 0.55,
    }),
    frame: new T.MeshStandardMaterial({
      color: 0x131019, emissive: 0x131019, emissiveIntensity: 0,
      roughness: 0.35, metalness: 0.55,
    }),
    nose: new T.MeshStandardMaterial({
      color: 0xfd9927, emissive: 0xfd9927, emissiveIntensity: 0.35,
      roughness: 0.2, metalness: 0.45,
    }),
    rear: new T.MeshStandardMaterial({
      color: 0x7b75ff, emissive: 0x7b75ff, emissiveIntensity: 0.15,
      roughness: 0.3, metalness: 0.4,
    }),
    rail: new T.MeshStandardMaterial({
      color: railColor, emissive: railColor, emissiveIntensity: 0.18,
      roughness: 0.22, metalness: 0.65,
    }),
  };
}

export function applyCompassKartRestyle3D(group, charColor, T, charId) {
  const mats = getCompassKartMats3D(T, charColor);
  const usedMats = new Set();
  const bodyMesh = group.userData.mainBody;
  if (!bodyMesh) {
    for (const mat of Object.values(mats)) mat.dispose();
    return;
  }

  const style = getVehicleProfile(charId).style || "generic";

  const bodyBox = new T.Box3().setFromObject(bodyMesh);
  const bodySize = bodyBox.getSize(new T.Vector3());
  const bodyCenter = bodyBox.getCenter(new T.Vector3());
  let cosmeticTopY = bodyBox.max.y;
  group.traverse((child) => {
    if (!child.isMesh || child.parent !== group) return;
    const box = new T.Box3().setFromObject(child);
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    const mat = child.material;
    if (mat && mat.transparent && mat.opacity <= 0.15) return;
    const centered = Math.abs(center.x - bodyCenter.x) < bodySize.x * 0.25
      && Math.abs(center.z - bodyCenter.z) < bodySize.z * 0.25;
    if (centered && size.x > bodySize.x * 0.45 && size.z > bodySize.z * 0.2) {
      cosmeticTopY = Math.max(cosmeticTopY, box.max.y);
    }
  });

  group.traverse((child) => {
    if (!child.isMesh || child.parent !== group) return;
    const box = new T.Box3().setFromObject(child);
    const size = box.getSize(new T.Vector3());
    const pos = child.position;
    if (child === bodyMesh) {
      child.material = mats.shell; usedMats.add(mats.shell);
    } else if (Math.abs(pos.x) > 7 && size.x < 3 && size.z > 10) {
      child.material = mats.rail; usedMats.add(mats.rail);
    } else if (pos.z > 10 && size.x > 4 && size.z < 12 && size.y < 6) {
      child.material = mats.nose; usedMats.add(mats.nose);
    } else if (pos.z < -12 && size.x > 8 && size.z < 5) {
      child.material = mats.rear; usedMats.add(mats.rear);
    } else if (
      box.max.y <= bodyBox.min.y + bodySize.y * 0.65
      && (size.x > 8 || size.z > 8)
    ) {
      child.material = mats.frame; usedMats.add(mats.frame);
    }
  });

  if (!group.userData.compassCosmetic) {
    const topY = cosmeticTopY + 0.3;
    const panelInsetX = bodySize.x * 0.18;
    const panelRear = bodyCenter.z - bodySize.z * 0.28;
    const panelFront = bodyCenter.z + bodySize.z * 0.18;
    const noseRear = panelFront + 0.2;
    const noseFront = bodyBox.max.z + 0.2;
    const noseHalfRear = bodySize.x * 0.11;
    const noseHalfFront = bodySize.x * 0.18;
    let positions;
    let colors;
    let indices;

    if (style === "formula") {
      const narrowInset = bodySize.x * 0.28;
      positions = [
        bodyBox.min.x + narrowInset, topY, panelRear,
        bodyBox.max.x - narrowInset, topY, panelRear,
        bodyBox.max.x - narrowInset, topY, panelFront,
        bodyBox.min.x + narrowInset, topY, panelFront,
        bodyCenter.x - noseHalfRear * 0.7, topY + 0.04, noseRear,
        bodyCenter.x + noseHalfRear * 0.7, topY + 0.04, noseRear,
        bodyCenter.x + noseHalfFront * 0.55, topY + 0.04, noseFront,
        bodyCenter.x - noseHalfFront * 0.55, topY + 0.04, noseFront,
        bodyCenter.x - bodySize.x * 0.42, topY + 0.5, bodyCenter.z - bodySize.z * 0.42,
        bodyCenter.x + bodySize.x * 0.42, topY + 0.5, bodyCenter.z - bodySize.z * 0.42,
        bodyCenter.x + bodySize.x * 0.35, topY + 0.5, bodyBox.min.z - 0.4,
        bodyCenter.x - bodySize.x * 0.35, topY + 0.5, bodyBox.min.z - 0.4,
      ];
      colors = [
        0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1,
        1, 0.6, 0.15, 1, 0.6, 0.15, 1, 0.72, 0.28, 1, 0.72, 0.28,
        0.75, 0.72, 0.95, 0.75, 0.72, 0.95, 0.75, 0.72, 0.95, 0.75, 0.72, 0.95,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else if (style === "muscle") {
      const hoodFront = bodyCenter.z + bodySize.z * 0.35;
      const hoodRear = bodyCenter.z - bodySize.z * 0.05;
      positions = [
        bodyBox.min.x + panelInsetX * 0.6, topY, hoodRear,
        bodyBox.max.x - panelInsetX * 0.6, topY, hoodRear,
        bodyBox.max.x - panelInsetX * 0.6, topY + 0.15, hoodFront,
        bodyBox.min.x + panelInsetX * 0.6, topY + 0.15, hoodFront,
        bodyCenter.x - bodySize.x * 0.08, topY + 0.35, hoodRear + 1,
        bodyCenter.x + bodySize.x * 0.08, topY + 0.35, hoodRear + 1,
        bodyCenter.x + bodySize.x * 0.08, topY + 0.35, hoodFront - 1,
        bodyCenter.x - bodySize.x * 0.08, topY + 0.35, hoodFront - 1,
        bodyCenter.x - noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfFront, topY + 0.02, noseFront,
        bodyCenter.x - noseHalfFront, topY + 0.02, noseFront,
      ];
      colors = [
        0.95, 0.9, 0.82, 0.95, 0.9, 0.82, 0.95, 0.9, 0.82, 0.95, 0.9, 0.82,
        1, 0.55, 0.12, 1, 0.55, 0.12, 1, 0.55, 0.12, 1, 0.55, 0.12,
        1, 0.62, 0.18, 1, 0.62, 0.18, 1, 0.72, 0.28, 1, 0.72, 0.28,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else if (style === "compact") {
      const canopyR = bodySize.x * 0.22;
      positions = [
        bodyCenter.x - canopyR, topY, bodyCenter.z - bodySize.z * 0.12,
        bodyCenter.x + canopyR, topY, bodyCenter.z - bodySize.z * 0.12,
        bodyCenter.x + canopyR * 0.8, topY + 0.25, bodyCenter.z + bodySize.z * 0.08,
        bodyCenter.x - canopyR * 0.8, topY + 0.25, bodyCenter.z + bodySize.z * 0.08,
        bodyCenter.x - canopyR * 1.1, topY + 0.05, bodyCenter.z - bodySize.z * 0.2,
        bodyCenter.x + canopyR * 1.1, topY + 0.05, bodyCenter.z - bodySize.z * 0.2,
        bodyCenter.x + canopyR * 0.9, topY + 0.05, bodyCenter.z + bodySize.z * 0.15,
        bodyCenter.x - canopyR * 0.9, topY + 0.05, bodyCenter.z + bodySize.z * 0.15,
      ];
      colors = [
        0.55, 1, 0.85, 0.55, 1, 0.85, 0.7, 1, 0.92, 0.7, 1, 0.92,
        0.45, 0.95, 0.75, 0.45, 0.95, 0.75, 0.45, 0.95, 0.75, 0.45, 0.95, 0.75,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    } else if (style === "armored") {
      const rackFront = bodyCenter.z + bodySize.z * 0.22;
      const rackRear = bodyCenter.z - bodySize.z * 0.32;
      positions = [
        bodyBox.min.x + panelInsetX * 0.4, topY + 0.2, rackRear,
        bodyBox.max.x - panelInsetX * 0.4, topY + 0.2, rackRear,
        bodyBox.max.x - panelInsetX * 0.4, topY + 0.2, rackFront,
        bodyBox.min.x + panelInsetX * 0.4, topY + 0.2, rackFront,
        bodyBox.min.x + 0.4, topY - bodySize.y * 0.15, bodyCenter.z - bodySize.z * 0.1,
        bodyBox.min.x + 1.2, topY - bodySize.y * 0.15, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.min.x + 1.2, topY + bodySize.y * 0.05, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.min.x + 0.4, topY + bodySize.y * 0.05, bodyCenter.z - bodySize.z * 0.1,
        bodyBox.max.x - 0.4, topY - bodySize.y * 0.15, bodyCenter.z - bodySize.z * 0.1,
        bodyBox.max.x - 1.2, topY - bodySize.y * 0.15, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.max.x - 1.2, topY + bodySize.y * 0.05, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.max.x - 0.4, topY + bodySize.y * 0.05, bodyCenter.z - bodySize.z * 0.1,
      ];
      colors = [
        0.82, 0.84, 0.92, 0.82, 0.84, 0.92, 0.82, 0.84, 0.92, 0.82, 0.84, 0.92,
        0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68,
        0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else if (style === "coupe") {
      const stripeRear = bodyCenter.z - bodySize.z * 0.35;
      const stripeFront = bodyBox.max.z + 0.1;
      const stripeHalf = bodySize.x * 0.06;
      positions = [
        bodyCenter.x - stripeHalf, topY + 0.05, stripeRear,
        bodyCenter.x + stripeHalf, topY + 0.05, stripeRear,
        bodyCenter.x + stripeHalf, topY + 0.05, stripeFront,
        bodyCenter.x - stripeHalf, topY + 0.05, stripeFront,
        bodyBox.min.x + panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelFront,
        bodyBox.min.x + panelInsetX, topY, panelFront,
        bodyCenter.x - noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfFront, topY + 0.02, noseFront,
        bodyCenter.x - noseHalfFront, topY + 0.02, noseFront,
      ];
      colors = [
        0.35, 1, 0.5, 0.35, 1, 0.5, 0.45, 1, 0.6, 0.45, 1, 0.6,
        0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1,
        0.35, 0.95, 1, 0.35, 0.95, 1, 0.45, 1, 1, 0.45, 1, 1,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else {
      positions = [
        bodyBox.min.x + panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelFront,
        bodyBox.min.x + panelInsetX, topY, panelFront,
        bodyCenter.x - noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfFront, topY + 0.02, noseFront,
        bodyCenter.x - noseHalfFront, topY + 0.02, noseFront,
      ];
      colors = [
        0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1,
        1, 0.6, 0.15, 1, 0.6, 0.15, 1, 0.72, 0.28, 1, 0.72, 0.28,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const cosmetic = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.25, side: T.DoubleSide }));
    cosmetic.position.y = 0;
    group.add(cosmetic);
    group.userData.compassCosmetic = cosmetic;
    mats.panel = cosmetic.material;
  }
  for (const key of ["shell", "frame", "nose", "rear", "rail"]) {
    if (!usedMats.has(mats[key])) {
      mats[key].dispose();
      mats[key] = null;
    }
  }
  group.userData.compassMaterials = mats;
  group.userData.boostMaterial = mats.shell;
  group.userData.boostBaseEmissiveIntensity = mats.shell.emissiveIntensity;
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

  const parseCol = (hex) => new T.Color(hex);
  const c = parseCol(color);
  const cDark = c.clone().multiplyScalar(0.5);
  const cBright = c.clone().lerp(new T.Color(0xffffff), 0.35);
  const wheelMat = new T.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.92, metalness: 0.05 });
  const hubMat = new T.MeshStandardMaterial({ color: 0x666666, metalness: 0.85, roughness: 0.15 });
  const headlightMat = new T.MeshStandardMaterial({ color: 0xfff8d0, emissive: 0xfff5b0, emissiveIntensity: 1.4 });
  const taillightMat = new T.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2828, emissiveIntensity: 0.9 });
  const glassMat = new T.MeshStandardMaterial({ color: 0x88ccff, emissive: 0x88ccff, emissiveIntensity: 0.2, transparent: true, opacity: 0.5, metalness: 0.95, roughness: 0.05 });
  const cockpitMat = new T.MeshStandardMaterial({ color: 0x12151e, roughness: 0.25, metalness: 0.7 });

  function addWheels(positions) {
    group._wheels = [];
    const tireGeo = new T.TorusGeometry(3.2, 1.6, 10, 16);
    const cylGeo = new T.CylinderGeometry(2.8, 2.8, 3.8, 14);
    const hubGeo = new T.CylinderGeometry(1.8, 1.8, 4.0, 8);
    const rimGeo = new T.TorusGeometry(2.2, 0.3, 6, 12);
    const rimMat = new T.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.1 });
    positions.forEach(([wx, wy, wz]) => {
      const wheelGroup = new T.Group();
      wheelGroup.position.set(wx, wy, wz);
      const tire = new T.Mesh(tireGeo, wheelMat);
      tire.rotation.x = Math.PI / 2;
      wheelGroup.add(tire);
      const inner = new T.Mesh(cylGeo, wheelMat);
      inner.rotation.z = Math.PI / 2;
      wheelGroup.add(inner);
      const hub = new T.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      wheelGroup.add(hub);
      const rim = new T.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      wheelGroup.add(rim);
      wheelGroup.castShadow = true;
      group.add(wheelGroup);
      group._wheels.push(wheelGroup);
    });
  }

  if (charId === "anton") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.18, metalness: 0.75 });
    const body = new T.Mesh(new T.BoxGeometry(16, 6, 34, 2, 1, 2), bodyMat);
    body.position.y = 5; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const noseMat = new T.MeshStandardMaterial({ color: cBright, roughness: 0.15, metalness: 0.8 });
    const nose = new T.Mesh(new T.BoxGeometry(12, 4, 10), noseMat);
    nose.position.set(0, 5, 18); nose.castShadow = true;
    group.add(nose);
    const sideSkirtMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    for (let s of [-1, 1]) {
      const skirt = new T.Mesh(new T.BoxGeometry(1.5, 3, 30), sideSkirtMat);
      skirt.position.set(s * 8.5, 3, 0);
      group.add(skirt);
    }
    group.add(new T.Mesh(new T.BoxGeometry(10, 4, 8), cockpitMat)).position.set(0, 9, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3, 12, 8), helmetMat)).position.set(0, 12, -2);
    const visorMat = new T.MeshStandardMaterial({ color: 0x222244, emissive: 0x3344ff, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(2.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 12.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(9, 3, 1.5), glassMat);
    ws.position.set(0, 10, 4); ws.rotation.x = -0.3;
    group.add(ws);
    group.add(new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 14, 6), new T.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 }))).position.set(0, 16, -10);
    group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2 }))).position.set(0, 23, -10);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1, 0.8, 30), new T.MeshStandardMaterial({ color: cBright, emissive: c, emissiveIntensity: 0.6 }))).position.set(s * 5, 8.5, 0);
    }
    const wingMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.5, 3), wingMat)).position.set(0, 10, -16);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.2, 4, 1.2), wingMat)).position.set(s * 7, 8, -16);
    }
    addWheels([[-7, 2.5, 12], [7, 2.5, 12], [-7, 2.5, -12], [7, 2.5, -12]]);
    [[-5, 5, 18], [5, 5, 18]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), headlightMat)).position.set(...p));
    [[-5, 5, -17], [5, 5, -17]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "artur") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.22, metalness: 0.7 });
    const body = new T.Mesh(new T.BoxGeometry(22, 8, 30, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const engineMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.4, metalness: 0.75 });
    group.add(new T.Mesh(new T.BoxGeometry(18, 6, 8), engineMat)).position.set(0, 12, -10);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(4, 4, 6), engineMat)).position.set(s * 5, 11, 4);
    }
    group.add(new T.Mesh(new T.BoxGeometry(14, 5, 10), cockpitMat)).position.set(0, 11, 0);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 14.5, -1);
    const visorMat = new T.MeshStandardMaterial({ color: 0x332200, emissive: 0xff6600, emissiveIntensity: 0.2, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 15, 0); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(13, 4, 1.5), glassMat);
    ws.position.set(0, 13, 6); ws.rotation.x = -0.35;
    group.add(ws);
    const flameMat = new T.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff8a3b, emissiveIntensity: 0.8, transparent: true, opacity: 0.75, side: T.DoubleSide });
    for (let s of [-1, 1]) {
      const flameGeo = new T.BufferGeometry();
      flameGeo.setAttribute("position", new T.Float32BufferAttribute([
        -8, 0, 0, 8, 0, -3, 0, 0, 3,
        -6, 0, -1, 10, 0, -4, 2, 0, 4,
      ], 3));
      flameGeo.computeVertexNormals();
      const flame = new T.Mesh(flameGeo, flameMat);
      flame.position.set(s * 11.5, 6, 6);
      flame.rotation.y = s * Math.PI / 2;
      group.add(flame);
    }
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(24, 2, 3), spoilerMat)).position.set(0, 16, -14);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(2, 6, 2), spoilerMat)).position.set(s * 9, 13, -14);
    }
    const pipeMat = new T.MeshStandardMaterial({ color: 0x555555, metalness: 0.85, roughness: 0.2 });
    const pipeGlowMat = new T.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 });
    for (let s of [-1, 1]) {
      const pipe = new T.Mesh(new T.CylinderGeometry(2, 2.5, 6, 12), pipeMat);
      pipe.position.set(s * 6, 4, -18); pipe.rotation.x = Math.PI / 2;
      group.add(pipe);
      const pipeGlow = new T.Mesh(new T.CylinderGeometry(1.5, 2, 2, 10), pipeGlowMat);
      pipeGlow.position.set(s * 6, 4, -21); pipeGlow.rotation.x = Math.PI / 2;
      group.add(pipeGlow);
    }
    addWheels([[-10, 3, 11], [10, 3, 11], [-10, 3, -11], [10, 3, -11]]);
    [[-8, 6, 16], [8, 6, 16]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.8, 8, 6), headlightMat)).position.set(...p));
    [[-7, 6, -15], [7, 6, -15]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.4, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "rissal") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.25, metalness: 0.65 });
    const body = new T.Mesh(new T.BoxGeometry(20, 8, 26, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    group.add(new T.Mesh(new T.SphereGeometry(10, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat)).position.set(0, 10, -2);
    group.add(new T.Mesh(new T.BoxGeometry(14, 4, 10), cockpitMat)).position.set(0, 11, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 14, -2);
    const visorMat = new T.MeshStandardMaterial({ color: 0x112222, emissive: c, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 14.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(12, 4, 1.5), glassMat);
    ws.position.set(0, 12, 4); ws.rotation.x = -0.35;
    group.add(ws);
    const glowMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5, transparent: true, opacity: 0.7 });
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 1.2, 28), glowMat)).position.set(s * 10.5, 1.5, 0);
    }
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.2, 1.5), glowMat)).position.set(0, 1.5, 13);
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.2, 1.5), glowMat)).position.set(0, 1.5, -13);
    const underGlow = new T.PointLight(new T.Color(c), 0.5, 60);
    underGlow.position.set(0, 1, 0);
    group.add(underGlow);
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(18, 1.5, 2), spoilerMat)).position.set(0, 11, -13);
    addWheels([[-9, 2.5, 10], [9, 2.5, 10], [-9, 2.5, -10], [9, 2.5, -10]]);
    [[-7, 6, 14], [7, 6, 14]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), headlightMat)).position.set(...p));
    [[-6, 6, -13], [6, 6, -13]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "pia") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.35, metalness: 0.55 });
    const body = new T.Mesh(new T.BoxGeometry(26, 10, 30, 2, 1, 2), bodyMat);
    body.position.y = 7; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const rackMat = new T.MeshStandardMaterial({ color: 0x333344, metalness: 0.7, roughness: 0.3 });
    group.add(new T.Mesh(new T.BoxGeometry(22, 1.5, 18), rackMat)).position.set(0, 13.5, -2);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 3, 1.5), rackMat)).position.set(s * 10, 12.5, 6);
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 3, 1.5), rackMat)).position.set(s * 10, 12.5, -8);
    }
    const spotlightBar = new T.MeshStandardMaterial({ color: 0xffdd44, emissive: 0xffdd44, emissiveIntensity: 0.6 });
    for (let i = -1; i <= 1; i++) {
      group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), spotlightBar)).position.set(i * 6, 15.5, -2);
    }
    group.add(new T.Mesh(new T.BoxGeometry(18, 6, 14), cockpitMat)).position.set(0, 13, -1);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 17, -1);
    const ws = new T.Mesh(new T.BoxGeometry(16, 5, 1.5), glassMat);
    ws.position.set(0, 14.5, 8); ws.rotation.x = -0.3;
    group.add(ws);
    const bumperMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.5, metalness: 0.55 });
    group.add(new T.Mesh(new T.BoxGeometry(28, 4, 4), bumperMat)).position.set(0, 4, 17);
    group.add(new T.Mesh(new T.BoxGeometry(28, 4, 4), bumperMat)).position.set(0, 4, -17);
    const bullBarMat = new T.MeshStandardMaterial({ color: 0x777777, metalness: 0.85, roughness: 0.15 });
    const bullBar = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 22, 10), bullBarMat);
    bullBar.position.set(0, 8, 18); bullBar.rotation.z = Math.PI / 2;
    group.add(bullBar);
    const bullBarV = new T.Mesh(new T.CylinderGeometry(0.8, 0.8, 6, 8), bullBarMat);
    bullBarV.position.set(0, 5, 18);
    group.add(bullBarV);
    for (let s of [-1, 1]) {
      const armor = new T.Mesh(new T.BoxGeometry(2, 6, 26), bumperMat);
      armor.position.set(s * 14, 5, 0); armor.castShadow = true;
      group.add(armor);
    }
    addWheels([[-12, 3.5, 12], [12, 3.5, 12], [-12, 3.5, -12], [12, 3.5, -12]]);
    [[-9, 7, 16], [9, 7, 16]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(2, 8, 6), headlightMat)).position.set(...p));
    [[-9, 7, -15], [9, 7, -15]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "florian") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.15, metalness: 0.8 });
    const body = new T.Mesh(new T.BoxGeometry(22, 8, 32, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const hoodMat = new T.MeshStandardMaterial({ color: cBright, roughness: 0.12, metalness: 0.85 });
    const hood = new T.Mesh(new T.BoxGeometry(20, 3, 10), hoodMat);
    hood.position.set(0, 9, 10); hood.rotation.x = -0.12; hood.castShadow = true;
    group.add(hood);
    group.add(new T.Mesh(new T.BoxGeometry(16, 6, 12), cockpitMat)).position.set(0, 12, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 16, -2);
    const visorMat = new T.MeshStandardMaterial({ color: 0x112233, emissive: 0x57f2ff, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 16.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(14, 5, 1.5), glassMat);
    ws.position.set(0, 14, 5); ws.rotation.x = -0.3;
    group.add(ws);
    const chromeMat = new T.MeshStandardMaterial({ color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 0.5, metalness: 0.95, roughness: 0.05 });
    group.add(new T.Mesh(new T.BoxGeometry(2, 0.8, 34), chromeMat)).position.set(0, 10.5, 0);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(0.8, 0.6, 28), chromeMat)).position.set(s * 8, 10.3, 0);
    }
    const badgeMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 1.0, metalness: 0.8 });
    const badge = new T.Mesh(new T.OctahedronGeometry(3, 1), badgeMat);
    badge.position.set(0, 11, 12);
    badge.scale.set(1, 0.4, 1);
    group.add(badge);
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.25, metalness: 0.65 });
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.5, 3), spoilerMat)).position.set(0, 11, -16);
    const trimMat = new T.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.95, roughness: 0.05 });
    group.add(new T.Mesh(new T.BoxGeometry(22, 0.8, 32), trimMat)).position.set(0, 2, 0);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(0.6, 7, 30), trimMat)).position.set(s * 11.2, 6, 0);
    }
    addWheels([[-10, 3, 12], [10, 3, 12], [-10, 3, -12], [10, 3, -12]]);
    [[-8, 6, 17], [8, 6, 17]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.6, 10, 8), headlightMat)).position.set(...p));
    [[-7, 6, -16], [7, 6, -16]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.3, 8, 6), taillightMat)).position.set(...p));

  } else {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.65 });
    const body = new T.Mesh(new T.BoxGeometry(20, 8, 28, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    // Rounded canopy on top
    const canopyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.1, roughness: 0.2, metalness: 0.7 });
    const canopy = new T.Mesh(new T.SphereGeometry(10, 12, 8, 0, TAU, 0, Math.PI / 2), canopyMat);
    canopy.scale.set(1, 0.5, 1.2);
    canopy.position.set(0, 10, -2);
    group.add(canopy);
    // Nose taper
    const noseMat = new T.MeshStandardMaterial({ color: cBright, roughness: 0.2, metalness: 0.75 });
    const nose = new T.Mesh(new T.BoxGeometry(16, 5, 8), noseMat);
    nose.position.set(0, 6, 16);
    group.add(nose);
    // Side skirts
    const skirtMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.4, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const skirt = new T.Mesh(new T.BoxGeometry(1.5, 4, 24), skirtMat);
      skirt.position.set(s * 10.5, 4, 0);
      group.add(skirt);
    }
    group.add(new T.Mesh(new T.BoxGeometry(12, 5, 10), cockpitMat)).position.set(0, 11, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 14, -2);
    // Visor
    const visorMat = new T.MeshStandardMaterial({ color: 0x222244, emissive: c, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 14.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    // Windshield
    const ws = new T.Mesh(new T.BoxGeometry(12, 4, 1.5), glassMat);
    ws.position.set(0, 12, 4); ws.rotation.x = -0.35;
    group.add(ws);
    // Exhaust pipes
    const pipeMat = new T.MeshStandardMaterial({ color: 0x444444, metalness: 0.85, roughness: 0.2 });
    const pipeGlowMat = new T.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 0.4, transparent: true, opacity: 0.5 });
    for (const s of [-1, 1]) {
      const pipe = new T.Mesh(new T.CylinderGeometry(1.5, 2, 4, 8), pipeMat);
      pipe.position.set(s * 5, 4, -16); pipe.rotation.x = Math.PI / 2;
      group.add(pipe);
      const glow = new T.Mesh(new T.CylinderGeometry(1, 1.5, 1.5, 8), pipeGlowMat);
      glow.position.set(s * 5, 4, -18); glow.rotation.x = Math.PI / 2;
      group.add(glow);
    }
    // Glow accent trim
    const accentMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, transparent: true, opacity: 0.6 });
    for (const s of [-1, 1]) {
      const trim = new T.Mesh(new T.BoxGeometry(0.6, 0.6, 24), accentMat);
      trim.position.set(s * 10.2, 9, 0);
      group.add(trim);
    }
    addWheels([[-8, 3, 10], [8, 3, 10], [-8, 3, -10], [8, 3, -10]]);
    [[-6, 6, 15], [6, 6, 15]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), headlightMat)).position.set(...p));
    [[-6, 6, -14], [6, 6, -14]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), taillightMat)).position.set(...p));
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(22, 2, 3), spoilerMat)).position.set(0, 12, -14);
    for (const s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 4, 1.5), spoilerMat)).position.set(s * 8, 11, -14);
    }
  }

  // Universal: headlight beam cones (all karts)
  const beamMat = new T.MeshBasicMaterial({ color: 0xfff8d0, transparent: true, opacity: 0.06, side: T.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) {
    const beamGeo = new T.ConeGeometry(8, 40, 8, 1, true);
    const beam = new T.Mesh(beamGeo, beamMat);
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(s * 6, 6, 30);
    group.add(beam);
  }

  // Universal: subtle body emissive on first child (main body) if not already set
  if (group.children[0] && group.children[0].material && group.children[0].material.emissiveIntensity < 0.05) {
    group.children[0].material.emissive = c;
    group.children[0].material.emissiveIntensity = 0.12;
  }

  // Shield (wireframe icosahedron for hex-grid look + solid inner glow)
  const shieldGeo = new T.IcosahedronGeometry(22, 1);
  const shieldMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.5, transparent: true, opacity: 0, wireframe: true, side: T.DoubleSide });
  const shield = new T.Mesh(shieldGeo, shieldMat);
  shield.position.y = 8;
  group.add(shield);
  const shieldInner = new T.Mesh(
    new T.IcosahedronGeometry(20, 1),
    new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.2, transparent: true, opacity: 0, side: T.DoubleSide })
  );
  shieldInner.position.y = 8;
  group.add(shieldInner);
  group._shield = shield;
  group._shieldMat = shieldMat;
  group._shieldInner = shieldInner;

  const flameGroup = new T.Group();
  flameGroup.rotation.x = -Math.PI / 2;
  flameGroup.position.set(0, 5, -28);
  const flameGeo = new T.ConeGeometry(7, 28, 12);
  const flameMat = new T.MeshStandardMaterial({
    color: 0xff8a3b,
    emissive: 0xff4d00,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0,
  });
  flameGroup.add(new T.Mesh(flameGeo, flameMat));
  const flameCore = new T.Mesh(
    new T.ConeGeometry(3.5, 22, 8),
    new T.MeshStandardMaterial({ color: 0xffdd66, emissive: 0xffaa00, emissiveIntensity: 2.0, transparent: true, opacity: 0 })
  );
  flameCore.position.y = 3;
  flameGroup.add(flameCore);
  flameGroup._coreMat = flameCore.material;
  const flameLight = new T.PointLight(0xff6600, 0, 80);
  flameLight.position.y = -5;
  flameGroup.add(flameLight);
  flameGroup._flameLight = flameLight;
  group.add(flameGroup);
  group._flame = flameGroup;
  group._flameMat = flameMat;

  applyCompassKartRestyle3D(group, color, T, charId);
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
    group.add(horn);
    const hornTip = new T.Mesh(new T.ConeGeometry(1.5, 8, 6), new T.MeshStandardMaterial({ color: 0x2a1510, emissive: glowColor, emissiveIntensity: 0.3 }));
    hornTip.position.set(68, 85, side * 14);
    hornTip.rotation.z = -0.4 * side;
    group.add(hornTip);
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
