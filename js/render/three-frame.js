import { TAU, lerp, clamp, dist, rand } from "../core/math.js";
import { COMPASS_VISUAL } from "../config/themes.js";
import { MAPS, getActiveMapConfig } from "../config/maps.js";
import { game, STATE, isBattleMode, isDayMode, getActiveKarts } from "../core/state.js";
import {
  COMPASS_FX_3D_OVERLAY_MAX,
  drawCompassSealMini,
  kartVisualZOffset,
} from "../entities/particles.js";
import { renderRuntime } from "./render-runtime.js";
import {
  THREE_STATE,
  ENABLE_3D_PROFILE,
  hudCtx,
  dispose3DObject,
  getParticleGlowTexture3D,
} from "./three-state.js";
import { sync3DSkidMarks } from "./three-track.js";
import {
  syncMergeTethers3D,
  buildDragonModel3D,
  createHazardMesh3D,
} from "./three-karts.js";
import * as hud from "./hud.js";

let _compassFxProjectVec3 = null;
const _compassFxViewportFull = { x: 0, y: 0, width: 0, height: 0 };
const _compassFxViewportLeft = { x: 0, y: 0, width: 0, height: 0 };
const _compassFxViewportRight = { x: 0, y: 0, width: 0, height: 0 };

function compassFxScreenX(v, viewport) {
  return viewport.x + (v.x * 0.5 + 0.5) * viewport.width;
}

function compassFxScreenY(v, viewport) {
  return viewport.y + (-v.y * 0.5 + 0.5) * viewport.height;
}

function drawCompassFx3DOverlayParticle(c, p, time, camera, viewport, v) {
  if (p.type === "approvalToken") {
    const prog = 1 - clamp(p.life / p.maxLife, 0, 1);
    const ease = prog * prog * (3 - 2 * prog);
    let vx = p.fromX, vy = p.fromY, ax = p.toX, ay = p.toY;
    const victim = p.victimRef;
    const attacker = p.attackerRef;
    if (victim && !victim.eliminated) {
      vx = victim.x; vy = victim.y - kartVisualZOffset(victim);
    }
    if (attacker && !attacker.eliminated) {
      ax = attacker.x; ay = attacker.y - kartVisualZOffset(attacker);
    } else if (!attacker) {
      return false;
    }

    v.set(
      lerp(vx, ax, ease),
      18 + lerp(victim?.z || 0, attacker?.z || 0, ease) * 0.5,
      lerp(vy, ay, ease) - 18
    );
    v.project(camera);
    if (v.z > 1) return false;
    const sx = compassFxScreenX(v, viewport);
    const sy = compassFxScreenY(v, viewport);
    const trailLen = 5;
    for (let i = 1; i <= trailLen; i++) {
      const te = ease - i * 0.07;
      if (te < 0) break;
      v.set(
        lerp(vx, ax, te),
        18 + lerp(victim?.z || 0, attacker?.z || 0, te) * 0.5,
        lerp(vy, ay, te) - 18
      );
      v.project(camera);
      if (v.z > 1) continue;
      c.globalAlpha = 0.15 + 0.12 * (trailLen - i);
      c.strokeStyle = i % 2 ? COMPASS_VISUAL.mint : COMPASS_VISUAL.primary;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(compassFxScreenX(v, viewport), compassFxScreenY(v, viewport));
      c.lineTo(sx, sy);
      c.stroke();
    }
    c.globalAlpha = 0.88 + 0.12 * Math.sin(time * 0.02);
    drawCompassSealMini(c, sx, sy, 10.5);
    c.globalAlpha = 0.32 + 0.12 * Math.sin(time * 0.018);
    c.strokeStyle = COMPASS_VISUAL.accent;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(sx, sy, 13 + Math.sin(time * 0.018) * 1.2, 0, TAU);
    c.stroke();
    if (p.life < 8 && attacker && !attacker.eliminated) {
      v.set(attacker.x, 20 + (attacker.z || 0), attacker.y - kartVisualZOffset(attacker) - 16);
      v.project(camera);
      if (v.z <= 1) {
        const pulse = (8 - p.life) / 8;
        c.globalAlpha = pulse * 0.6;
        c.strokeStyle = COMPASS_VISUAL.success;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(compassFxScreenX(v, viewport), compassFxScreenY(v, viewport), 10 + pulse * 8, 0, TAU);
        c.stroke();
      }
    }
    return true;
  }

  v.set(p.x, 14 + (p.zOff || 0), p.y);
  v.project(camera);
  if (v.z > 1) return false;
  const sx = compassFxScreenX(v, viewport);
  const sy = compassFxScreenY(v, viewport);
  const t = clamp(p.life / p.maxLife, 0, 1);
  c.globalAlpha = t;
  if (p.type === "ring") {
    const rad = p.size * (1 - t) + (p.startSize || p.size) * t;
    c.strokeStyle = p.color;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(sx, sy, rad, 0, TAU);
    c.stroke();
  } else if (p.type === "text") {
    c.fillStyle = p.color;
    c.font = `bold ${p.size}px sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(p.text, sx, sy);
  } else if (p.type === "spark") {
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(sx, sy, (p.size || 3) * t, 0, TAU);
    c.fill();
  } else if (p.type === "line") {
    c.strokeStyle = p.color;
    c.lineWidth = p.size || 2;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx - (p.vx || 0) * 2, sy - (p.vy || 0) * 2);
    c.stroke();
  } else if (p.type === "rect") {
    c.fillStyle = p.color;
    c.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
  }
  return true;
}

export function drawCompassFx3DOverlay(c, time, camera = THREE_STATE.camera, viewport = null) {
  if (!window.THREE || !camera || !game.particles) return;
  if (!_compassFxProjectVec3) _compassFxProjectVec3 = new THREE.Vector3();
  const vp = viewport || _compassFxViewportFull;
  if (!viewport) {
    vp.x = 0; vp.y = 0; vp.width = renderRuntime.getViewW(); vp.height = renderRuntime.getViewH();
  }

  c.save();
  c.beginPath();
  c.rect(vp.x, vp.y, vp.width, vp.height);
  c.clip();
  let drawn = 0;
  const list = game.particles.list;

  // Two allocation-free priority passes: Approval transfers can never be hidden by rings.
  for (let i = 0; i < list.length && drawn < COMPASS_FX_3D_OVERLAY_MAX; i++) {
    const p = list[i];
    if (p.type !== "approvalToken") continue;
    c.save();
    if (drawCompassFx3DOverlayParticle(c, p, time, camera, vp, _compassFxProjectVec3)) drawn++;
    c.restore();
  }
  for (let i = 0; i < list.length && drawn < COMPASS_FX_3D_OVERLAY_MAX; i++) {
    const p = list[i];
    if (p.type === "approvalToken" || !p.compassFx) continue;
    c.save();
    if (drawCompassFx3DOverlayParticle(c, p, time, camera, vp, _compassFxProjectVec3)) drawn++;
    c.restore();
  }
  c.restore();
}


function updateLightsForKart(kart) {
  if (!kart) return;
  const fx = Math.cos(kart.heading), fy = Math.sin(kart.heading);
  if (THREE_STATE.playerLight) {
    THREE_STATE.playerLight.position.set(kart.x, 150, kart.y);
  }
  if (THREE_STATE.dirLight) {
    THREE_STATE.dirLight.position.set(kart.x + 300, 600, kart.y - 300);
    THREE_STATE.dirLight.target.position.set(kart.x, 0, kart.y);
    THREE_STATE.dirLight.target.updateMatrixWorld();
  }
  if (THREE_STATE.rimLight) {
    THREE_STATE.rimLight.position.set(kart.x - 150, 120, kart.y + 150);
  }
  if (THREE_STATE.backLight) {
    THREE_STATE.backLight.position.set(kart.x - fx * 80, 60, kart.y - fy * 80);
  }
}

function sync3DKarts(dt, time) {
  const day = isDayMode();
  const wheelSpinFactor = 0.16 * dt;
  const animLerp = 1 - Math.pow(0.78, dt);

  for (const [kart, model] of THREE_STATE.kartModels) {
    const z = kart.z || 0;
    const vz = kart.vz || 0;
    model.rotation.order = "YXZ";
    model.position.set(kart.x, z, kart.y);

    const fx = Math.cos(kart.heading);
    const fy = Math.sin(kart.heading);
    const lx = -fy;
    const ly = fx;
    const fwdSpeed = kart.forwardSpeed ? kart.forwardSpeed() : kart.speed();
    const lateralV = kart.vx * lx + kart.vy * ly;

    // Drift yaw slip + spinout
    const drifting = (kart._driftTimer || 0) > 0;
    const targetDriftSlip = drifting
      ? -(kart.driftDir || clamp(lateralV * 0.18, -1, 1)) * 0.22
      : 0;
    model._driftSlip = lerp(model._driftSlip || 0, targetDriftSlip, animLerp);
    model.rotation.y = -kart.heading + Math.PI / 2 + model._driftSlip + (kart.spinoutTimer > 0 ? (kart.spinAngle || 0) : 0);

    // Dynamic kart pitch: nose up on boost / positive vz, dip on braking
    const braking = fwdSpeed < -0.2 || kart.spinoutTimer > 0 || (model._prevFwd !== undefined && fwdSpeed < model._prevFwd - 0.08 && fwdSpeed > 0.2);
    model._prevFwd = fwdSpeed;
    const targetPitch = (kart.boostTimer > 0 ? -0.065 : 0)
      + clamp(-vz * 0.02, -0.22, 0.16)
      + (braking && fwdSpeed > 0.2 ? 0.055 : 0);
    model.rotation.x = lerp(model.rotation.x || 0, targetPitch, animLerp);

    // Body roll into turns
    const targetLean = clamp(lateralV * 0.04, -0.18, 0.18);
    model.rotation.z = lerp(model.rotation.z || 0, targetLean, animLerp);

    // Squash & stretch
    const base = model.userData._baseScale || 1;
    const squashY = 1 - Math.min(z * 0.003, 0.06) - (vz > 0 ? Math.min(vz * 0.008, 0.04) : 0);
    const squashXZ = 1 + (1 - squashY) * 0.2;
    model.scale.set(base * squashXZ, base * squashY, base * squashXZ);

    // Front wheel steering + all-wheel spin
    const steerTarget = kart.steerVisual !== undefined
      ? kart.steerVisual
      : clamp((kart.heading - (model._prevHeading ?? kart.heading)) * 8, -1, 1);
    model._prevHeading = kart.heading;
    model._steerAnim = lerp(model._steerAnim || 0, steerTarget, animLerp);
    if (model._frontWheelPivots) {
      const steerAngle = -model._steerAnim * 0.38;
      for (const pivot of model._frontWheelPivots) {
        pivot.rotation.y = steerAngle;
      }
    }
    if (model._wheels) {
      const spinDelta = fwdSpeed * wheelSpinFactor;
      for (const w of model._wheels) {
        w.rotation.x += spinDelta;
      }
    }

    // Ground contact shadow pinned to ground y=0.68, scaled & faded with altitude
    if (model._contactShadow) {
      const airFrac = clamp(z / 80, 0, 1);
      const sScale = 1 - airFrac * 0.45;
      model._contactShadow.position.y = (0.68 - z) / Math.max(0.5, model.scale.y);
      model._contactShadow.scale.set(sScale, sScale, 1);
      model._contactShadow.material.opacity = kart.eliminated ? 0 : 0.72 * (1 - airFrac * 0.7);
    }

    // Taillights brake/spinout flare + night headlight pool
    if (model._taillights) {
      const intensity = braking ? 2.5 : 0.9;
      for (const tlMat of model._taillights) {
        tlMat.emissiveIntensity = intensity;
      }
    }
    if (model._headlightPool) {
      model._headlightPool.visible = !day && !kart.eliminated;
    }

    // Shield visibility + rotation
    if (model._shieldMat) {
      const shieldOn = kart.shieldTimer > 0;
      model._shieldMat.opacity = shieldOn ? 0.35 + 0.15 * Math.sin(time * 0.005) : 0;
      if (model._shield) {
        model._shield.rotation.y = time * 0.001;
        model._shield.rotation.x = Math.sin(time * 0.0008) * 0.3;
      }
      if (model._shieldInner && model._shieldInner.material) {
        model._shieldInner.material.opacity = shieldOn ? 0.08 + 0.06 * Math.sin(time * 0.007) : 0;
      }
    }

    const boostMaterial = model.userData.boostMaterial;
    if (kart.boostTimer > 0) {
      if (boostMaterial) {
        boostMaterial.emissive.copy(boostMaterial.color);
        boostMaterial.emissiveIntensity = 0.4 + 0.3 * Math.sin(time * 0.01);
      }
      if (model._flameMat && model._flame) {
        model._flame.visible = true;
        model._flameMat.opacity = 0.7 + 0.2 * Math.sin(time * 0.03);
        const flameScale = 1 + 0.25 * Math.sin(time * 0.05);
        const speedStretch = 1 + Math.min(1.0, kart.speed() * 0.1);
        model._flame.scale.set(flameScale, speedStretch, flameScale);
        if (model._flame._coreMat) {
          model._flame._coreMat.opacity = 0.5 + 0.3 * Math.sin(time * 0.04);
        }
        if (model._flame._flameLight) {
          model._flame._flameLight.intensity = 0.8 + 0.4 * Math.sin(time * 0.06);
        }
      }
    } else {
      if (boostMaterial) {
        boostMaterial.emissiveIntensity = model.userData.boostBaseEmissiveIntensity || 0;
      }
      if (model._flameMat && model._flame) {
        model._flame.visible = false;
        model._flameMat.opacity = 0;
        if (model._flame._coreMat) model._flame._coreMat.opacity = 0;
        if (model._flame._flameLight) model._flame._flameLight.intensity = 0;
      }
    }
  }
}

export function sync3DScene(time, dt = game.lastDt || 1) {
  if (!THREE_STATE.scene || !game.player) return;

  sync3DKarts(dt, time);

  // Camera is handled in setCameraForKart() called from draw3D() for split-screen
  const isSplitScreen = game.multiplayer && game.player2 && !game.p2pMode;
  if (!isSplitScreen) {
    setCameraForKart(renderRuntime.getViewKart(), time, dt, THREE_STATE.camSmooth);
    updateLightsForKart(renderRuntime.getViewKart() || game.player);
  }

  THREE_STATE.itemMeshes.forEach(m => {
    if (m._itemRef && !m._itemRef.active) { m.visible = false; return; }
    m.visible = true;
    const spin = (m._itemRef?.spin || 0) + time * 0.002;
    m.rotation.y = spin;
    m.rotation.x = Math.sin(time * 0.004 + m.position.x * 0.01) * 0.3;
    m.position.y = 22 + Math.sin(time * 0.003 + m.position.x * 0.01) * 5;
    if (m.children && m.children[1]) {
      m.children[1].rotation.y = spin * 0.7;
      m.children[1].rotation.x = -spin * 0.5;
    }
    if (m.children && m.children[2]) {
      m.children[2].rotation.y = -spin * 1.5;
      m.children[2].rotation.x = spin * 0.8;
    }
    if (m._innerMat) m._innerMat.emissiveIntensity = 0.8 + 0.5 * Math.sin(time * 0.008 + m.position.x * 0.01);
    if (m._outerMat) m._outerMat.opacity = 0.2 + 0.15 * Math.sin(time * 0.006 + m.position.x * 0.01);
    if (m._midMat) m._midMat.opacity = 0.1 + 0.1 * Math.sin(time * 0.007 + m.position.z * 0.01);
  });

  // Animate coins (spinning gold discs with bob)
  THREE_STATE.coinMeshes.forEach(m => {
    if (m._coinRef && m._coinRef.collected) { m.visible = false; return; }
    m.visible = true;
    m.rotation.y = time * 0.005;
    m.rotation.x = 0;
    m.position.y = 9 + Math.sin(time * 0.004 + m.position.x * 0.01) * 2.5;
    if (m._discMat) m._discMat.emissiveIntensity = 0.3 + 0.2 * Math.sin(time * 0.007 + m.position.z * 0.01);
  });

  // Ultimate 3D effects
  sync3DUltimates(time);

  THREE_STATE.boostPadMeshes.forEach(m => {
    const pulse = 0.55 + 0.35 * Math.sin(time * 0.01 + m.position.x * 0.01);
    if (m._padMat) m._padMat.emissiveIntensity = 0.4 + 0.4 * pulse;
    m.position.y = 1.5 + pulse * 0.5;
  });

  THREE_STATE.movingObjectMeshes.forEach(m => {
    const obj = m._movingObjectRef;
    if (!obj) return;
    m.position.set(obj.x, 24 + Math.sin(time * 0.01 + obj.idx) * 4, obj.y);
    m.rotation.y = -(obj.ang || 0) + Math.PI / 2;
    if (m.material) m.material.emissiveIntensity = 0.45 + 0.25 * Math.sin(time * 0.012 + obj.idx);
  });

  syncMergeTethers3D();

  syncHazards3D(time);
  syncDragons3D(time);
  update3DShockwaves();

  // Visual enhancements
  sync3DNameTags(time);
  sync3DSpeechBubbles(time);
  sync3DParticleEffects(time);
  sync3DCoinSparkles(time);
  sync3DItemBoxHalos(time);
  sync3DSkidMarks();
  sync3DSpectators(time);
  sync3DKartFlair(time);
  sync3DPillarRings(time);
}


export function sync3DUltimates(time) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  // Manage per-kart ultimate aura meshes
  if (!THREE_STATE._ultAuras) THREE_STATE._ultAuras = new Map();

  for (const [kart, model] of THREE_STATE.kartModels) {
    const active = kart.ultActiveTimer > 0;
    let aura = THREE_STATE._ultAuras.get(kart);

    if (active && !aura) {
      aura = new T.Group();
      const kartColor = new T.Color(kart.color);

      // Expanding rings
      for (let i = 0; i < 3; i++) {
        const ringGeo = new T.TorusGeometry(20 + i * 8, 1.5, 8, 24);
        const ringMat = new T.MeshStandardMaterial({
          color: kartColor,
          emissive: kartColor,
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0.6,
          side: T.DoubleSide,
        });
        const ring = new T.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 8 + i * 5;
        ring._ringIdx = i;
        ring._ringMat = ringMat;
        aura.add(ring);
      }

      // Character-specific ultimate visuals
      if (kart.charId === "anton") {
        // Typo Storm: floating red glitch cubes orbiting
        for (let i = 0; i < 6; i++) {
          const cube = new T.Mesh(
            new T.BoxGeometry(4, 6, 1.5),
            new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 1.0, transparent: true, opacity: 0.8 })
          );
          cube._orbitIdx = i;
          cube._orbitRadius = 35;
          aura.add(cube);
        }
      } else if (kart.charId === "artur") {
        // Prayer Protocol: golden fire column
        const pillarGeo = new T.CylinderGeometry(6, 14, 60, 10);
        const pillarMat = new T.MeshStandardMaterial({ color: 0xff8a3b, emissive: 0xff8a3b, emissiveIntensity: 1.5, transparent: true, opacity: 0.3 });
        const pillar = new T.Mesh(pillarGeo, pillarMat);
        pillar.position.y = 30;
        aura.add(pillar);
        aura._pillarMat = pillarMat;
      } else if (kart.charId === "rissal") {
        // Panic Deploy: swirling green panic clouds
        for (let i = 0; i < 4; i++) {
          const cloud = new T.Mesh(
            new T.SphereGeometry(10, 8, 6),
            new T.MeshStandardMaterial({ color: 0x4dffaa, emissive: 0x4dffaa, emissiveIntensity: 0.8, transparent: true, opacity: 0.3 })
          );
          cloud._orbitIdx = i;
          cloud._orbitRadius = 40;
          aura.add(cloud);
        }
      } else if (kart.charId === "pia") {
        // ThinkPad Slam: purple shockwave spheres
        const slamSphere = new T.Mesh(
          new T.SphereGeometry(30, 16, 12),
          new T.MeshStandardMaterial({ color: 0x9d4dff, emissive: 0x9d4dff, emissiveIntensity: 0.9, transparent: true, opacity: 0.2, side: T.DoubleSide })
        );
        slamSphere.position.y = 10;
        aura.add(slamSphere);
        aura._slamSphere = slamSphere;
      } else if (kart.charId === "florian") {
        // Regulatory Lockdown: cyan holographic shield grid
        const gridGeo = new T.IcosahedronGeometry(32, 1);
        const gridMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.7, wireframe: true, transparent: true, opacity: 0.5 });
        const grid = new T.Mesh(gridGeo, gridMat);
        grid.position.y = 12;
        aura.add(grid);
        aura._gridMat = gridMat;
      }

      // Aura point light
      const auraLight = new T.PointLight(kartColor, 1.2, 200);
      auraLight.position.y = 20;
      aura.add(auraLight);
      aura._auraLight = auraLight;

      THREE_STATE.scene.add(aura);
      THREE_STATE._ultAuras.set(kart, aura);
    }

    if (aura) {
      if (!active) {
        THREE_STATE.scene.remove(aura);
        dispose3DObject(aura);
        THREE_STATE._ultAuras.delete(kart);
        continue;
      }

      aura.position.set(kart.x, 0, kart.y);
      const t = time * 0.001;

      // Animate rings
      aura.children.forEach(child => {
        if (child._ringIdx !== undefined) {
          const i = child._ringIdx;
          child.rotation.z = t * (1 + i * 0.3);
          child.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.15);
          if (child._ringMat) child._ringMat.opacity = 0.4 + 0.25 * Math.sin(t * 3 + i * 1.5);
        }

        // Orbiting objects (Anton typo cubes, Rissal clouds)
        if (child._orbitIdx !== undefined) {
          const i = child._orbitIdx;
          const r = child._orbitRadius;
          const ang = t * 2.5 + (i / 6) * Math.PI * 2;
          child.position.set(Math.cos(ang) * r, 15 + Math.sin(t * 4 + i) * 6, Math.sin(ang) * r);
          child.rotation.y = t * 3;
          child.rotation.x = t * 2;
        }
      });

      // Character-specific animations
      if (aura._pillarMat) {
        aura._pillarMat.opacity = 0.2 + 0.2 * Math.sin(t * 5);
        aura._pillarMat.emissiveIntensity = 1.0 + 0.8 * Math.sin(t * 4);
      }
      if (aura._slamSphere) {
        const pulse = 1 + 0.3 * Math.sin(t * 6);
        aura._slamSphere.scale.setScalar(pulse);
        aura._slamSphere.material.opacity = 0.15 + 0.1 * Math.sin(t * 4);
      }
      if (aura._gridMat) {
        aura._gridMat.opacity = 0.3 + 0.2 * Math.sin(t * 3);
      }
      if (aura._auraLight) {
        aura._auraLight.intensity = 0.8 + 0.6 * Math.sin(t * 4);
      }
    }
  }
}


if (!THREE_STATE._shockwaves) THREE_STATE._shockwaves = [];


export function spawn3DShockwave(x, z, maxRadius, colorHex) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;
  const col = new T.Color(colorHex);
  for (let i = 0; i < 3; i++) {
    const ringGeo = new T.TorusGeometry(10, 2.5 - i * 0.5, 8, 32);
    const ringMat = new T.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 1.5,
      transparent: true, opacity: 0.85, side: T.DoubleSide,
    });
    const ring = new T.Mesh(ringGeo, ringMat);
    ring.position.set(x, 8 + i * 6, z);
    ring.rotation.x = Math.PI / 2;
    THREE_STATE.scene.add(ring);
    const light = (i === 0) ? new T.PointLight(col, 1.5, maxRadius * 2) : null;
    if (light) { light.position.set(x, 20, z); THREE_STATE.scene.add(light); }
    THREE_STATE._shockwaves.push({
      mesh: ring, light, maxRadius, age: 0, delay: i * 4,
      startX: x, startZ: z,
    });
  }
}


export function update3DShockwaves() {
  if (!THREE_STATE._shockwaves.length) return;
  const toRemove = [];
  for (const sw of THREE_STATE._shockwaves) {
    sw.age++;
    if (sw.age < sw.delay) { sw.mesh.visible = false; continue; }
    sw.mesh.visible = true;
    const life = sw.age - sw.delay;
    const maxLife = 45;
    const t = life / maxLife;
    if (t >= 1) { toRemove.push(sw); continue; }
    const currentR = sw.maxRadius * t;
    const scale = Math.max(0.1, currentR / 10);
    sw.mesh.scale.set(scale, scale, 1);
    sw.mesh.material.opacity = (1 - t) * 0.8;
    sw.mesh.material.emissiveIntensity = (1 - t) * 2.0;
    if (sw.light) {
      sw.light.intensity = (1 - t) * 2.0;
    }
  }
  for (const sw of toRemove) {
    THREE_STATE.scene.remove(sw.mesh);
    dispose3DObject(sw.mesh);
    if (sw.light) THREE_STATE.scene.remove(sw.light);
    THREE_STATE._shockwaves.splice(THREE_STATE._shockwaves.indexOf(sw), 1);
  }
}


export function syncHazards3D(time) {
  if (!THREE_STATE.scene || !window.THREE) return;
  const live = new Set(game.hazards || []);
  for (const hazard of live) {
    if (!hazard || hazard.active === false) continue;
    let mesh = THREE_STATE.hazardMeshes.get(hazard);
    if (!mesh) {
      mesh = createHazardMesh3D(hazard);
      if (!mesh) continue;
      THREE_STATE.scene.add(mesh);
      THREE_STATE.hazardMeshes.set(hazard, mesh);
    }
    mesh.visible = true;
    mesh.position.x = hazard.x;
    mesh.position.z = hazard.y;
    mesh.rotation.y = -(hazard.heading || 0) + Math.PI / 2 + (hazard.spin || 0);
    const ctor2 = hazard.constructor?.name || "";
    if (ctor2 === "DoubleBlindCloud") {
      const a = clamp((hazard.life || 240) / 240, 0, 1);
      const sizeScale = Math.min(1.4, (hazard.r || 48) / 48);
      mesh.scale.setScalar(sizeScale * (1 + Math.sin(time * 0.004 + (hazard.phase || 0)) * 0.06));
      // Animate individual cloud puffs for roiling effect
      mesh.children.forEach(child => {
        if (child._cloudIdx !== undefined) {
          const ci = child._cloudIdx;
          child.position.y += Math.sin(time * 0.003 + ci * 0.9) * 0.04;
          child.position.x += Math.cos(time * 0.002 + ci * 1.1) * 0.03;
          child.position.z += Math.sin(time * 0.0025 + ci * 0.7) * 0.03;
          if (child.material) child.material.opacity = (ci < 5 ? 0.18 : 0.10) * a + Math.sin(time * 0.005 + ci) * 0.04;
        }
      });
    } else if (ctor2 !== "DoubleBlindCloud") {
      mesh.rotation.x += 0.03;
    }
  }
  for (const [hazard, mesh] of THREE_STATE.hazardMeshes) {
    if (!live.has(hazard) || hazard.active === false) {
      THREE_STATE.scene.remove(mesh);
      dispose3DObject(mesh);
      THREE_STATE.hazardMeshes.delete(hazard);
    }
  }
}


function animateDragonModel(model, wingPhase, jawPhase, enraged, time) {
  if (!model) return;
  const wingAmp = enraged ? 0.55 : 0.38;
  if (model._wingR) model._wingR.rotation.x = Math.sin(wingPhase) * wingAmp;
  if (model._wingL) model._wingL.rotation.x = -Math.sin(wingPhase) * wingAmp;
  if (model._lowerJaw) {
    const jawOpen = (enraged ? 6 : 4) * Math.max(0, Math.sin(jawPhase));
    model._lowerJaw.position.y = 38 - jawOpen;
  }
  if (model._fireLight) {
    model._fireLight.intensity = enraged ? 1.2 + 0.6 * Math.sin(time * 0.012) : 0.5 + 0.3 * Math.sin(time * 0.008);
  }
}


export function syncDragons3D(time) {
  if (!THREE_STATE.scene) return;
  const dragon = game.track && game.track.regulatoryDragon;
  const currentMapId = MAPS[game.selectedMapIdx || 0].id;
  if (dragon && currentMapId !== "dragon_escape" && !THREE_STATE.dragonModel) {
    THREE_STATE.dragonModel = buildDragonModel3D(false);
    if (THREE_STATE.dragonModel) THREE_STATE.scene.add(THREE_STATE.dragonModel);
  }
  if (THREE_STATE.dragonModel) {
    THREE_STATE.dragonModel.visible = !!(dragon && dragon.active && currentMapId !== "dragon_escape");
    if (dragon && dragon.active) {
      const dragonHover = 42 + Math.sin(time * 0.002) * 12;
      THREE_STATE.dragonModel.position.set(dragon.x, dragonHover, dragon.y);
      THREE_STATE.dragonModel.rotation.y = -dragon.heading;
      const scale = dragon.enraged ? 1.55 : 1.35;
      THREE_STATE.dragonModel.scale.setScalar(scale);
      animateDragonModel(THREE_STATE.dragonModel, dragon.wingPhase || time * 0.004, dragon.jawPhase || time * 0.006, dragon.enraged, time);
    }
  }

  if (currentMapId === "dragon_escape" && !THREE_STATE.dragonEscapeModel) {
    THREE_STATE.dragonEscapeModel = buildDragonModel3D(true);
    if (THREE_STATE.dragonEscapeModel) THREE_STATE.scene.add(THREE_STATE.dragonEscapeModel);
  }
  if (THREE_STATE.dragonEscapeModel) {
    const escapeDragon = game.dragonEscape;
    THREE_STATE.dragonEscapeModel.visible = !!(escapeDragon && escapeDragon.active && currentMapId === "dragon_escape");
    if (escapeDragon && escapeDragon.active) {
      const bob = Math.sin(time * 0.002) * 30;
      THREE_STATE.dragonEscapeModel.position.set(escapeDragon.x, 16 + bob, escapeDragon.y);
      THREE_STATE.dragonEscapeModel.rotation.y = -escapeDragon.heading;
      animateDragonModel(
        THREE_STATE.dragonEscapeModel,
        escapeDragon.wingPhase || time * 0.007,
        escapeDragon.jawPhase || time * 0.009,
        escapeDragon.enraged,
        time
      );
    }
  }
}


function sync3DFirmamentToCamera() {
  if (!THREE_STATE.camera) return;
  if (THREE_STATE.skyMesh) THREE_STATE.skyMesh.position.copy(THREE_STATE.camera.position);
  if (THREE_STATE.starField) THREE_STATE.starField.position.copy(THREE_STATE.camera.position);
}


export function setCameraForKart(kart, time, dt = game.lastDt || 1, cs = THREE_STATE.camSmooth) {
  if (!kart || !THREE_STATE.camera) return;
  if (!Number.isFinite(cs.fov)) cs.fov = 66;
  if (!Number.isFinite(cs.roll)) cs.roll = 0;

  const fx = Math.cos(kart.heading), fy = Math.sin(kart.heading);
  const lx = -fy, ly = fx;
  const sp = kart.speed();
  const latV = kart.vx * lx + kart.vy * ly;
  const mapId = getActiveMapConfig(game).id;
  const isDragonChaseView = !!(
    (game.track?.regulatoryDragon?.active && mapId === "regulatory_dragon_run") ||
    (game.dragonEscape?.active && mapId === "dragon_escape")
  );
  const camDist = 140 + sp * 8 + (isDragonChaseView ? 95 : 0);
  const camHeight = 70 + sp * 5 + (isDragonChaseView ? 16 : 0);
  const lookAhead = 60 + sp * 15 + (isDragonChaseView ? 22 : 0);

  // Drift lateral camera swing: swing outside turn and lead lookAt into the corner
  const driftActive = (kart._driftTimer || 0) > 0;
  const driftDir = driftActive ? (kart.driftDir || clamp(latV * 0.2, -1, 1)) : 0;
  const camSwing = -driftDir * 16 + clamp(-latV * 2.5, -14, 14);
  const lookSwing = driftDir * 20;

  // Ramp landing dip
  const z = kart.z || 0;
  if ((cs._prevZ || 0) > 6 && z <= 0.5) {
    cs._landDip = 8;
  }
  cs._prevZ = z;
  cs._landDip = (cs._landDip || 0) * Math.pow(0.82, dt);

  const targetX = kart.x - fx * camDist + lx * camSwing;
  const targetZ = kart.y - fy * camDist + ly * camSwing;
  const targetCamHeight = Math.max(24, camHeight + z * 0.45 - cs._landDip);
  const lookX = kart.x + fx * lookAhead + lx * lookSwing;
  const lookZ = kart.y + fy * lookAhead + ly * lookSwing;
  const lookY = (isDragonChaseView ? 15 : 12) + Math.min(z, 40) * 0.35 - cs._landDip * 0.4;

  const posAlpha = 1 - Math.pow(0.935, dt);
  const lookAlpha = 1 - Math.pow(0.91, dt);
  const fovAlpha = 1 - Math.pow(0.94, dt);
  const rollAlpha = 1 - Math.pow(0.90, dt);

  cs.x += (targetX - cs.x) * posAlpha;
  cs.y += (targetCamHeight - cs.y) * posAlpha;
  cs.z += (targetZ - cs.z) * posAlpha;
  cs.lx += (lookX - cs.lx) * lookAlpha;
  cs.ly += (lookY - cs.ly) * lookAlpha;
  cs.lz += (lookZ - cs.lz) * lookAlpha;

  const shake = game.shake || 0;
  THREE_STATE.camera.position.set(
    cs.x + (Math.random() - 0.5) * shake * 1.5,
    cs.y + (Math.random() - 0.5) * shake * 1.5,
    cs.z
  );
  THREE_STATE.camera.lookAt(cs.lx, cs.ly, cs.lz);

  const targetRoll = clamp(latV * 0.012 - driftDir * 0.038, -0.075, 0.075);
  cs.roll += (targetRoll - cs.roll) * rollAlpha;
  if (Math.abs(cs.roll) > 0.0005) {
    THREE_STATE.camera.rotateZ(cs.roll);
  }

  const boostActive = kart.boostTimer > 0;
  const slipActive = (kart.slipstreamBoostTimer || kart.draftBoostTimer || 0) > 0;
  const targetFov = 66 + sp * 4 + (boostActive ? 11 : 0) + (slipActive ? 6 : 0) + (isDragonChaseView ? 4 : 0);
  cs.fov += (targetFov - cs.fov) * fovAlpha;
  THREE_STATE.camera.fov = cs.fov;
  THREE_STATE.camera.updateProjectionMatrix();
  sync3DFirmamentToCamera();
}


function makeTextSprite(text, opts = {}) {
  const T = window.THREE;
  const fontSize = opts.fontSize || 28;
  const fontFamily = opts.fontFamily || "'SFMono-Regular', Consolas, monospace";
  const color = opts.color || "#ffffff";
  const bgColor = opts.bgColor || "rgba(10, 8, 28, 0.88)";
  const borderColor = opts.borderColor || "#7b75ff";
  const padding = opts.padding || 12;
  const maxWidth = opts.maxWidth || 400;

  const c = document.createElement("canvas");
  const cx = c.getContext("2d");
  cx.font = `bold ${fontSize}px ${fontFamily}`;
  const tw = Math.min(cx.measureText(text).width, maxWidth);
  const w = tw + padding * 2 + 4;
  const h = fontSize + padding * 2;
  c.width = Math.ceil(w * 2); c.height = Math.ceil(h * 2);
  cx.scale(2, 2);

  cx.fillStyle = bgColor;
  cx.strokeStyle = borderColor;
  cx.lineWidth = 2;
  cx.beginPath();
  const rr = 8;
  cx.moveTo(rr, 0); cx.lineTo(w - rr, 0); cx.quadraticCurveTo(w, 0, w, rr);
  cx.lineTo(w, h - rr); cx.quadraticCurveTo(w, h, w - rr, h);
  cx.lineTo(rr, h); cx.quadraticCurveTo(0, h, 0, h - rr);
  cx.lineTo(0, rr); cx.quadraticCurveTo(0, 0, rr, 0);
  cx.closePath();
  cx.fill(); cx.stroke();

  if (opts.showStem) {
    cx.fillStyle = bgColor;
    cx.beginPath();
    cx.moveTo(w / 2 - 6, h); cx.lineTo(w / 2, h + 8); cx.lineTo(w / 2 + 6, h);
    cx.closePath(); cx.fill();
    cx.beginPath();
    cx.moveTo(w / 2 - 6, h); cx.lineTo(w / 2, h + 8); cx.lineTo(w / 2 + 6, h);
    cx.stroke();
  }

  cx.fillStyle = color;
  cx.font = `bold ${fontSize}px ${fontFamily}`;
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillText(text, w / 2, h / 2);

  const tex = new T.CanvasTexture(c);
  tex.minFilter = T.LinearFilter;
  const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
  const sprite = new T.Sprite(mat);
  sprite.scale.set(w * 0.12, (opts.showStem ? h + 8 : h) * 0.12, 1);
  sprite._spriteW = w;
  sprite._spriteH = h;
  return sprite;
}


function sync3DNameTags(time) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;
  const activeKarts = getActiveKarts();

  for (const kart of activeKarts) {
    if (kart.eliminated) {
      const old = THREE_STATE.nameTagSprites.get(kart);
      if (old) {
        THREE_STATE.scene.remove(old);
        old.material.map?.dispose();
        old.material.dispose();
        THREE_STATE.nameTagSprites.delete(kart);
      }
      continue;
    }
    let sprite = THREE_STATE.nameTagSprites.get(kart);
    if (sprite && sprite._nameTagVersion !== 2) {
      THREE_STATE.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      THREE_STATE.nameTagSprites.delete(kart);
      sprite = null;
    }
    if (!sprite) {
      sprite = makeTextSprite(kart.name, {
        fontSize: 33,
        color: kart.color,
        bgColor: "rgba(6, 5, 20, 0.75)",
        borderColor: kart.color,
        padding: 10,
      });
      sprite._nameTagVersion = 2;
      THREE_STATE.scene.add(sprite);
      THREE_STATE.nameTagSprites.set(kart, sprite);
    }
    sprite.position.set(kart.x, 34, kart.y);
    const isUlt = kart.ultActiveTimer > 0;
    sprite.material.opacity = isUlt ? 0.6 + 0.3 * Math.sin(time * 0.02) : 0.85;
  }

  for (const [kart, sprite] of THREE_STATE.nameTagSprites) {
    if (!activeKarts.includes(kart)) {
      THREE_STATE.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      THREE_STATE.nameTagSprites.delete(kart);
    }
  }
}


function sync3DSpeechBubbles(time) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const activeKarts = getActiveKarts();

  for (const kart of activeKarts) {
    const hasQuote = !kart.eliminated && kart.activeQuote && kart.quoteTimer > 0;
    let sprite = THREE_STATE.speechBubbleSprites.get(kart);

    if (hasQuote && !sprite) {
      sprite = makeTextSprite(kart.activeQuote, {
        fontSize: 48,
        color: "#ffffff",
        bgColor: "rgba(10, 8, 28, 0.92)",
        borderColor: kart.color || "#ffffff",
        padding: 20,
        maxWidth: 800,
        showStem: true,
      });
      THREE_STATE.scene.add(sprite);
      THREE_STATE.speechBubbleSprites.set(kart, sprite);
      sprite._quoteText = kart.activeQuote;
    }

    if (sprite) {
      if (!hasQuote || kart.activeQuote !== sprite._quoteText) {
        THREE_STATE.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        THREE_STATE.speechBubbleSprites.delete(kart);
        if (hasQuote) {
          const newSprite = makeTextSprite(kart.activeQuote, {
            fontSize: 48, color: "#ffffff",
            bgColor: "rgba(10, 8, 28, 0.92)",
            borderColor: kart.color || "#ffffff",
            padding: 20, maxWidth: 800, showStem: true,
          });
          THREE_STATE.scene.add(newSprite);
          THREE_STATE.speechBubbleSprites.set(kart, newSprite);
          newSprite._quoteText = kart.activeQuote;
          newSprite.position.set(kart.x, 58, kart.y);
        }
        continue;
      }
      sprite.position.set(kart.x, 58, kart.y);
      const fadeIn = Math.min(1, kart.quoteTimer / 10);
      sprite.material.opacity = fadeIn;
    }
  }

  for (const [kart, sprite] of THREE_STATE.speechBubbleSprites) {
    if (!activeKarts.includes(kart) || kart.eliminated) {
      THREE_STATE.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      THREE_STATE.speechBubbleSprites.delete(kart);
    }
  }
}


const PARTICLE_3D_MAX = 250;
const _p3dPositions = new Float32Array(PARTICLE_3D_MAX * 3);
const _p3dColors = new Float32Array(PARTICLE_3D_MAX * 3);
const _p3dSizes = new Float32Array(PARTICLE_3D_MAX);
const _p3dPool = [];
let _p3dCount = 0;

export function reset3DParticlePool() {
  _p3dPool.length = 0;
  _p3dCount = 0;
}


export function init3DParticles() {
  if (!window.THREE || THREE_STATE.particles3dSystem) return;
  const T = window.THREE;
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(_p3dPositions, 3));
  geo.setAttribute("color", new T.BufferAttribute(_p3dColors, 3));
  geo.setAttribute("size", new T.BufferAttribute(_p3dSizes, 1));
  geo.setDrawRange(0, 0);
  const mat = new T.PointsMaterial({
    size: 10,
    map: getParticleGlowTexture3D(T),
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    vertexColors: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const points = new T.Points(geo, mat);
  points.frustumCulled = false;
  THREE_STATE.scene.add(points);
  THREE_STATE.particles3dSystem = points;
}


export function emit3DParticle(x, y, z, vx, vy, vz, r, g, b, life, size) {
  if (_p3dPool.length >= PARTICLE_3D_MAX) return;
  _p3dPool.push({ x, y, z, vx, vy, vz, r, g, b, life, maxLife: life, size: size || 3, drag: 0.96 });
  _p3dCount = _p3dPool.length;
}

export function emit3DBurst(x, y, z, r, g, b, count, spread, life) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * TAU;
    const up = Math.random() * spread;
    const sp = 0.5 + Math.random() * spread;
    emit3DParticle(
      x + (Math.random() - 0.5) * 4, y + Math.random() * 4, z + (Math.random() - 0.5) * 4,
      Math.cos(ang) * sp, up, Math.sin(ang) * sp,
      r, g, b, life || 40, 2 + Math.random() * 3
    );
  }
}


function update3DParticles(dt) {
  if (!THREE_STATE.particles3dSystem) return;
  let i = 0;
  while (i < _p3dPool.length) {
    const p = _p3dPool[i];
    p.life -= dt;
    if (p.life <= 0) {
      _p3dPool[i] = _p3dPool[_p3dPool.length - 1];
      _p3dPool.pop();
      continue;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 0.02 * dt;
    const drag = Math.pow(p.drag, dt);
    p.vx *= drag; p.vy *= drag; p.vz *= drag;
    const fade = p.life / p.maxLife;
    _p3dPositions[i * 3] = p.x;
    _p3dPositions[i * 3 + 1] = p.y;
    _p3dPositions[i * 3 + 2] = p.z;
    _p3dColors[i * 3] = p.r * fade;
    _p3dColors[i * 3 + 1] = p.g * fade;
    _p3dColors[i * 3 + 2] = p.b * fade;
    _p3dSizes[i] = p.size * (0.5 + fade * 0.5);
    i++;
  }
  _p3dCount = _p3dPool.length;

  const geo = THREE_STATE.particles3dSystem.geometry;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.attributes.size.needsUpdate = true;
  geo.setDrawRange(0, _p3dCount);
}


function sync3DParticleEffects(time) {
  const dt = game.lastDt || 1;
  for (const [kart, model] of THREE_STATE.kartModels) {
    const fxCos = Math.cos(kart.heading), fxSin = Math.sin(kart.heading);

    // Boost exhaust particles
    if (kart.boostTimer > 0 && Math.random() < 0.6 * dt) {
      const bx = kart.x - fxCos * 18, bz = kart.y - fxSin * 18;
      emit3DParticle(
        bx + (Math.random() - 0.5) * 6, 4 + Math.random() * 6, bz + (Math.random() - 0.5) * 6,
        -fxCos * (2 + Math.random() * 3) + (Math.random() - 0.5), Math.random() * 2, -fxSin * (2 + Math.random() * 3) + (Math.random() - 0.5),
        1.0, 0.4 + Math.random() * 0.4, 0.1, 20 + Math.random() * 15, 3 + Math.random() * 3
      );
    }

    // Drift sparks
    if (kart._driftTimer > 0 && Math.abs(kart.forwardSpeed()) > 1.5 && Math.random() < 0.5 * dt) {
      const lx = -fxSin, lz = fxCos;
      for (const side of [-1, 1]) {
        const sx = kart.x - fxCos * 10 + lx * side * 7;
        const sz = kart.y - fxSin * 10 + lz * side * 7;
        const tier = kart.driftCharge || 0;
        const cr = tier > 80 ? 1.0 : tier > 40 ? 1.0 : 0.3;
        const cg = tier > 80 ? 0.5 : tier > 40 ? 0.7 : 0.7;
        const cb = tier > 80 ? 0.2 : tier > 40 ? 0.15 : 1.0;
        emit3DParticle(
          sx, 2, sz,
          (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2,
          cr, cg, cb, 12 + Math.random() * 10, 2 + Math.random() * 2
        );
      }
    }

    // Off-road dust
    const onRoad = game.track && game.track.isOnRoad(kart.x, kart.y);
    if (!onRoad && kart.speed() > 1.0 && Math.random() < 0.3 * dt) {
      emit3DParticle(
        kart.x + (Math.random() - 0.5) * 8, 1, kart.y + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 1.5, 0.5 + Math.random(), (Math.random() - 0.5) * 1.5,
        0.15, 0.5, 0.2, 25, 4 + Math.random() * 3
      );
    }
  }
  update3DParticles(dt);
}


export function build3DSpectators() {
  if (!window.THREE || !THREE_STATE.scene || !game.track || !game.track.spectators) return;
  const T = window.THREE;

  THREE_STATE.spectatorMeshes.forEach(s => {
    THREE_STATE.scene.remove(s.group);
    dispose3DObject(s.group);
  });
  THREE_STATE.spectatorMeshes = [];

  const specs = game.track.spectators;
  const maxSpecs = Math.min(specs.length, 40);
  const step = Math.max(1, Math.floor(specs.length / maxSpecs));

  const baseH = 7;
  const bodyGeo = new T.BoxGeometry(2.5, baseH * 0.55, 2);
  const headGeo = new T.SphereGeometry(2, 8, 6);
  const legGeo = new T.BoxGeometry(1.2, baseH * 0.45, 1.2);
  const armGeo = new T.BoxGeometry(1, baseH * 0.4, 1);
  const legMat = new T.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 });

  for (let si = 0; si < specs.length; si += step) {
    const sp = specs[si];
    const group = new T.Group();
    const col = new T.Color(sp.color);
    const h = sp.height || baseH;

    // Body
    const bodyMat = new T.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.1 });
    const body = new T.Mesh(bodyGeo, bodyMat);
    body.position.y = baseH * 0.45;
    group.add(body);

    // Head
    const head = new T.Mesh(headGeo, bodyMat);
    head.position.y = baseH + 1;
    group.add(head);

    // Legs
    for (const lx of [-0.7, 0.7]) {
      const leg = new T.Mesh(legGeo, legMat);
      leg.position.set(lx, baseH * 0.22, 0);
      group.add(leg);
    }

    // Arms (animated)
    const armL = new T.Mesh(armGeo, bodyMat);
    armL.position.set(-1.8, baseH * 0.55, 0);
    group.add(armL);
    const armR = new T.Mesh(armGeo, bodyMat);
    armR.position.set(1.8, baseH * 0.55, 0);
    group.add(armR);

    group.position.set(sp.x, 0, sp.y);
    group.scale.setScalar(1.2 * (h / baseH));
    THREE_STATE.scene.add(group);
    THREE_STATE.spectatorMeshes.push({
      group, sp, baseY: 0, armL, armR,
    });
  }
}


function sync3DSpectators(time) {
  for (const s of THREE_STATE.spectatorMeshes) {
    let cheering = false;
    for (const k of getActiveKarts()) {
      if (dist(s.sp.x, s.sp.y, k.x, k.y) < (s.sp.cheerThreshold || 120)) { cheering = true; break; }
    }
    const bounce = cheering ? Math.abs(Math.sin(time * 0.012 + (s.sp.phase || 0))) * 3 : 0;
    s.group.position.y = s.baseY + bounce;

    if (cheering) {
      const wave = Math.sin(time * 0.018 + (s.sp.phase || 0)) * 0.6;
      if (s.armL) s.armL.rotation.z = 0.5 + wave * 0.8;
      if (s.armR) s.armR.rotation.z = -0.5 - wave * 0.8;
    } else {
      if (s.armL) s.armL.rotation.z = 0;
      if (s.armR) s.armR.rotation.z = 0;
    }
  }
}


export function build3DStartLine() {
  if (!window.THREE || !THREE_STATE.scene || !game.track || game.track.isOpen || isBattleMode()) return;
  const T = window.THREE;
  if (THREE_STATE.startLineMesh) {
    THREE_STATE.scene.remove(THREE_STATE.startLineMesh);
    dispose3DObject(THREE_STATE.startLineMesh);
    THREE_STATE.startLineMesh = null;
  }
  const gate = game.track.startLineGate();
  if (!gate) return;
  const roadW = gate.halfW * 2;
  const lineW = 14;

  const startGroup = new T.Group();

  const c = document.createElement("canvas");
  c.width = 128; c.height = 32;
  const cx = c.getContext("2d");
  const sq = 16;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      cx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "#111111";
      cx.fillRect(col * sq, row * sq, sq, sq);
    }
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = T.RepeatWrapping;
  tex.repeat.set(Math.max(1, Math.round(roadW / 40)), 1);

  const geo = new T.PlaneGeometry(roadW, lineW);
  const mat = new T.MeshStandardMaterial({
    map: tex, roughness: 0.45, metalness: 0.18,
    transparent: true, opacity: 0.92, side: T.DoubleSide,
  });
  const mesh = new T.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(gate.x, 0.72, gate.y);
  mesh.rotation.z = -Math.atan2(gate.ny, gate.nx);
  startGroup.add(mesh);

  // Painted F1-style starting grid boxes behind the start line (matching gridSlot)
  const seg0 = game.track.segments[0];
  if (seg0) {
    const ang = Math.atan2(seg0.dy, seg0.dx);
    const sx = seg0.a.x + seg0.dx * 0.04;
    const sy = seg0.a.y + seg0.dy * 0.04;
    const fx = Math.cos(ang), fy = Math.sin(ang);
    const lx = -Math.sin(ang), ly = Math.cos(ang);
    const gridMat = new T.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      side: T.DoubleSide,
    });
    const frontBarGeo = new T.PlaneGeometry(24, 2.2);
    const sideBarGeo = new T.PlaneGeometry(2.2, 16);
    for (let i = 0; i < 5; i++) {
      const f = -5 - 40 * i;
      const l = i % 2 === 0 ? -28 : 28;
      const gx = sx + fx * f + lx * l;
      const gy = sy + fy * f + ly * l;
      const box = new T.Group();
      box.position.set(gx, 0.68, gy);
      box.rotation.y = -ang + Math.PI / 2;
      const front = new T.Mesh(frontBarGeo, gridMat);
      front.rotation.x = -Math.PI / 2;
      front.position.set(0, 0, 12);
      box.add(front);
      for (const s of [-1, 1]) {
        const sb = new T.Mesh(sideBarGeo, gridMat);
        sb.rotation.x = -Math.PI / 2;
        sb.position.set(s * 11, 0, 4);
        box.add(sb);
      }
      startGroup.add(box);
    }
  }

  THREE_STATE.scene.add(startGroup);
  THREE_STATE.startLineMesh = startGroup;
}


function sync3DPillarRings(time) {
  for (const ring of THREE_STATE.pillarRings) {
    ring.rotation.z = time * 0.001 + ring.position.y * 0.1;
  }
  const lights = THREE_STATE.startLightMats;
  if (lights && lights.length) {
    const isCountdown = game.state === STATE.COUNTDOWN;
    const cdText = game.countdownText || "";
    const litCount = isCountdown
      ? (cdText === "3" ? 2 : cdText === "2" ? 4 : cdText === "1" ? 5 : 5)
      : 5;
    const isGo = !isCountdown || cdText === "GO!";
    for (let i = 0; i < lights.length; i++) {
      const m = lights[i];
      if (isGo) {
        m.color.setHex(0x30ff88);
        m.emissive.setHex(0x28ff77);
        m.emissiveIntensity = 1.2;
      } else if (i < litCount) {
        m.color.setHex(0xff3b52);
        m.emissive.setHex(0xff2244);
        m.emissiveIntensity = 1.5;
      } else {
        m.color.setHex(0x281c22);
        m.emissive.setHex(0x18080c);
        m.emissiveIntensity = 0.2;
      }
    }
  }
}


function sync3DCoinSparkles(time) {
  THREE_STATE.coinMeshes.forEach(m => {
    if (!m.visible || (m._coinRef && m._coinRef.collected)) return;
    if (Math.random() < 0.008) {
      emit3DParticle(
        m.position.x + (Math.random() - 0.5) * 8,
        m.position.y + (Math.random() - 0.5) * 4,
        m.position.z + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5,
        1.0, 0.85, 0.4, 25, 1.5 + Math.random() * 2
      );
    }
  });
}


function sync3DItemBoxHalos(time) {
  THREE_STATE.itemMeshes.forEach(m => {
    if (!m.visible) return;
    if (Math.random() < 0.008) {
      emit3DParticle(
        m.position.x + (Math.random() - 0.5) * 15,
        m.position.y + (Math.random() - 0.5) * 10,
        m.position.z + (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3,
        1.0, 0.85, 0.42, 30, 2 + Math.random() * 2
      );
    }
  });
}


export function emit3DItemPickupBurst(x, z, type) {
  if (!THREE_STATE.particles3dSystem) return;
  if (type === "coin") {
    emit3DBurst(x, 10, z, 1.0, 0.85, 0.42, 10, 2.5, 25);
  } else if (type === "itemBox") {
    emit3DBurst(x, 22, z, 1.0, 0.4, 0.8, 14, 3, 30);
  } else if (type === "boost") {
    emit3DBurst(x, 3, z, 0.64, 1.0, 0.5, 12, 3, 20);
  }
}


export function enhance3DKartModels() {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  for (const [kart, model] of THREE_STATE.kartModels) {
    if (model._flairAdded) continue;
    model._flairAdded = true;

    if (kart.charId === "anton") {
      // Antenna with spring bobble
      const antGeo = new T.CylinderGeometry(0.2, 0.3, 10, 6);
      const antMat = new T.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 });
      const antenna = new T.Mesh(antGeo, antMat);
      antenna.position.set(0, 14, -6);
      model.add(antenna);
      const tipMat = new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 1.2 });
      const tip = new T.Mesh(new T.SphereGeometry(1.2, 8, 6), tipMat);
      tip.position.set(0, 19.5, -6);
      model.add(tip);
      model._antennaTip = tip;

      // Speed stripes
      const stripeMat = new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.6, transparent: true, opacity: 0.6 });
      for (const sz of [-1.5, 1.5]) {
        const stripe = new T.Mesh(new T.BoxGeometry(8, 0.3, 0.6), stripeMat);
        stripe.position.set(0, 5.5, sz);
        model.add(stripe);
      }
    } else if (kart.charId === "artur") {
      // Flame decals as emissive mesh on sides
      const flameMat = new T.MeshStandardMaterial({ color: 0xff8a3b, emissive: 0xff8a3b, emissiveIntensity: 0.8, transparent: true, opacity: 0.6 });
      for (const side of [-1, 1]) {
        const flameGeo = new T.BufferGeometry();
        flameGeo.setAttribute("position", new T.Float32BufferAttribute([
          -6, 4, side * 9, 4, 6, side * 8, -2, 5.5, side * 7,
        ], 3));
        flameGeo.computeVertexNormals();
        const flame = new T.Mesh(flameGeo, flameMat);
        model.add(flame);
      }
      // Roof scoop
      const scoopMat = new T.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 });
      const scoop = new T.Mesh(new T.BoxGeometry(4, 3, 6), scoopMat);
      scoop.position.set(0, 10, -2);
      model.add(scoop);
    } else if (kart.charId === "rissal") {
      // Neon underglow strips along Z on left/right sides
      const glowMat = new T.MeshStandardMaterial({ color: 0x4dffaa, emissive: 0x4dffaa, emissiveIntensity: 1.5, transparent: true, opacity: 0.7 });
      for (const side of [-1, 1]) {
        const strip = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 28), glowMat);
        strip.position.set(side * 9, 1.2, 0);
        model.add(strip);
      }
      model._underglowMat = glowMat;
    } else if (kart.charId === "pia") {
      // Wider bumper bars
      const bumperMat = new T.MeshStandardMaterial({ color: 0x9d4dff, emissive: 0x9d4dff, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 });
      const frontBumper = new T.Mesh(new T.BoxGeometry(1.5, 3, 20), bumperMat);
      frontBumper.position.set(0, 4, 16);
      model.add(frontBumper);
      const rearBumper = new T.Mesh(new T.BoxGeometry(1.5, 3, 20), bumperMat);
      rearBumper.position.set(0, 4, -14);
      model.add(rearBumper);
    } else if (kart.charId === "florian") {
      // Center racing stripe cleanly on top of body running along Z
      const stripeMat = new T.MeshStandardMaterial({ color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 0.5, transparent: true, opacity: 0.5 });
      const stripe = new T.Mesh(new T.BoxGeometry(1.5, 0.3, 28), stripeMat);
      stripe.position.set(0, 10.15, 0);
      model.add(stripe);
      // Regulatory badge diamond
      const badgeMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 1.0 });
      const badge = new T.Mesh(new T.OctahedronGeometry(1.5), badgeMat);
      badge.position.set(0, 7, 8);
      model.add(badge);
      model._badge = badge;
    }
  }
}


function sync3DKartFlair(time) {
  for (const [kart, model] of THREE_STATE.kartModels) {
    // Antenna bob for Anton
    if (kart.charId === "anton" && model._antennaTip) {
      const baseY = model._antennaTipBaseY ?? 19.5;
      model._antennaTip.position.y = baseY + Math.sin(time * 0.008 + kart.speed() * 0.3) * 1.1;
      model._antennaTip.position.x = Math.sin(time * 0.006) * 0.45;
    }
    // Rissal underglow pulse
    if (kart.charId === "rissal" && model._underglowMat) {
      model._underglowMat.emissiveIntensity = 1.0 + 0.7 * Math.sin(time * 0.008);
      model._underglowMat.opacity = 0.65 + 0.25 * Math.sin(time * 0.006);
    }
    // Florian badge spin
    if (kart.charId === "florian" && model._badge) {
      model._badge.rotation.y = time * 0.003;
    }
  }
}


function update3DProfile(renderMs, time) {
  if (!ENABLE_3D_PROFILE || !THREE_STATE.renderer) return;
  const info = THREE_STATE.renderer.info;
  const prev = THREE_STATE._profile || {
    lastTime: time,
    fps: 60,
    renderMs: 0,
  };
  const frameMs = Math.max(1, time - prev.lastTime);
  const fps = 1000 / frameMs;
  THREE_STATE._profile = {
    lastTime: time,
    fps: prev.fps * 0.9 + fps * 0.1,
    renderMs: prev.renderMs * 0.85 + renderMs * 0.15,
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
  };
}


function draw3DProfile(ctx) {
  const p = THREE_STATE._profile;
  if (!ENABLE_3D_PROFILE || !p) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(16, 126, 180, 76);
  ctx.fillStyle = p.fps >= 45 ? "#a4ff80" : p.fps >= 25 ? "#ffd86b" : "#ff4d6d";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`3D ${p.fps.toFixed(0)} FPS`, 26, 136);
  ctx.fillStyle = "#ebe4ff";
  ctx.fillText(`render ${p.renderMs.toFixed(1)}ms`, 26, 154);
  ctx.fillText(`calls ${p.calls}`, 26, 172);
  ctx.fillText(`tris ${Math.round(p.triangles / 1000)}k`, 26, 190);
  ctx.restore();
}


function drawViewportHudExtras3D(c, kart, vx, vy, vw, vh, time, viewportRect) {
  if (!c || !kart) return;
  const prevCtx = renderRuntime.getCtx?.();
  if (renderRuntime.setCtx) renderRuntime.setCtx(c);
  c.save();
  try {
    c.beginPath();
    c.rect(vx, vy, vw, vh);
    c.clip();
    if (kart.boostTimer > 0 || kart.slipstreamBoostTimer > 0 || kart.draftBoostTimer > 0) {
      const boostIntensity = kart.boostTimer > 0 ? Math.min(1.2, 0.7 + kart.boostTimer / 60) : 0.75;
      hud.drawBoostSpeedLines?.(c, vx, vy, vw, vh, time, boostIntensity);
    }
    hud.drawRearThreatIndicator?.(c, kart, vx, vy, vw, vh, time);
    const drawApprovals = hud.drawApprovals3DOverlay || renderRuntime.drawApprovals3DOverlay;
    drawApprovals?.(c, time, THREE_STATE.camera, vw, vh, vx, vy);
    drawCompassFx3DOverlay(c, time, THREE_STATE.camera, viewportRect);
  } finally {
    c.restore();
    if (renderRuntime.setCtx && prevCtx !== undefined) renderRuntime.setCtx(prevCtx);
  }
}

export function draw3D(dtOrTime, maybeTime) {
  if (!THREE_STATE.renderer || !THREE_STATE.scene || !THREE_STATE.camera) return;
  const time = maybeTime !== undefined ? maybeTime : (dtOrTime !== undefined ? dtOrTime : performance.now());
  const dt = maybeTime !== undefined ? (dtOrTime || 1) : (game.lastDt || 1);
  const renderer = THREE_STATE.renderer;
  const renderStart = ENABLE_3D_PROFILE ? performance.now() : 0;

  sync3DScene(time, dt);
  if (hudCtx) hudCtx.clearRect(0, 0, renderRuntime.getViewW(), renderRuntime.getViewH());

  const isSplitScreen = game.multiplayer && game.player2 && !game.p2pMode;
  const viewW = renderRuntime.getViewW();
  const viewH = renderRuntime.getViewH();

  if (isSplitScreen) {
    const dpr = renderer.getPixelRatio();
    const fullW = Math.floor(viewW * dpr);
    const fullH = Math.floor(viewH * dpr);
    const halfW = Math.floor(fullW / 2);
    const halfCssW = viewW / 2 - 2;

    renderer.autoClear = false;
    renderer.setScissorTest(true);

    // Initialize P2 camSmooth behind player2 if at origin
    const p2Cam = THREE_STATE.camSmoothP2;
    if (p2Cam.x === 0 && p2Cam.z === 0 && game.player2) {
      const h2 = game.player2.heading || 0;
      p2Cam.x = game.player2.x - Math.cos(h2) * 95;
      p2Cam.y = 44;
      p2Cam.z = game.player2.y - Math.sin(h2) * 95;
      p2Cam.lx = game.player2.x + Math.cos(h2) * 40;
      p2Cam.ly = 12;
      p2Cam.lz = game.player2.y + Math.sin(h2) * 40;
      p2Cam.fov = 66;
      p2Cam.roll = 0;
    }

    // ---- Left viewport: Player 1 ----
    renderer.setViewport(0, 0, halfW, fullH);
    renderer.setScissor(0, 0, halfW, fullH);
    renderer.clear();
    THREE_STATE.camera.aspect = (viewW / 2) / viewH;
    setCameraForKart(game.player, time, dt, THREE_STATE.camSmooth);
    updateLightsForKart(game.player);
    renderer.render(THREE_STATE.scene, THREE_STATE.camera);
    _compassFxViewportLeft.x = 0;
    _compassFxViewportLeft.y = 0;
    _compassFxViewportLeft.width = halfCssW;
    _compassFxViewportLeft.height = viewH;
    if (hudCtx) {
      drawViewportHudExtras3D(hudCtx, game.player, 0, 0, halfCssW, viewH, time, _compassFxViewportLeft);
    }

    // ---- Right viewport: Player 2 ----
    const p2CssX = viewW / 2 + 2;
    renderer.setViewport(halfW + 2, 0, halfW - 2, fullH);
    renderer.setScissor(halfW + 2, 0, halfW - 2, fullH);
    setCameraForKart(game.player2, time, dt, THREE_STATE.camSmoothP2);
    updateLightsForKart(game.player2);
    renderer.render(THREE_STATE.scene, THREE_STATE.camera);
    _compassFxViewportRight.x = p2CssX;
    _compassFxViewportRight.y = 0;
    _compassFxViewportRight.width = halfCssW;
    _compassFxViewportRight.height = viewH;
    if (hudCtx) {
      drawViewportHudExtras3D(hudCtx, game.player2, p2CssX, 0, halfCssW, viewH, time, _compassFxViewportRight);
    }

    // Restore full-canvas camera & viewport state
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.setViewport(0, 0, fullW, fullH);
    THREE_STATE.camera.aspect = viewW / viewH;
    THREE_STATE.camera.updateProjectionMatrix();
    THREE_STATE.camera.updateMatrixWorld();
    sync3DFirmamentToCamera();
  } else {
    renderer.render(THREE_STATE.scene, THREE_STATE.camera);
  }
  if (ENABLE_3D_PROFILE) update3DProfile(performance.now() - renderStart, time);

  // Draw HUD on overlay canvas
  if (hudCtx) {
    const origCtx = renderRuntime.getCtx();
    renderRuntime.setCtx(hudCtx);
    if (isSplitScreen) {
      // Draw split-screen divider underneath center HUD elements (watermark, battle pill, minimap)
      hudCtx.fillStyle = "rgba(8, 6, 26, 0.75)";
      hudCtx.fillRect(viewW / 2 - 3, 0, 6, viewH);
      const grad = hudCtx.createLinearGradient(0, 0, 0, viewH);
      grad.addColorStop(0, "#7b75ff");
      grad.addColorStop(0.5, "#ff4d6d");
      grad.addColorStop(1, "#fd9927");
      hudCtx.fillStyle = grad;
      hudCtx.fillRect(viewW / 2 - 1, 0, 2, viewH);
      renderRuntime.drawHUDMultiplayer(time);
    } else {
      _compassFxViewportFull.x = 0;
      _compassFxViewportFull.y = 0;
      _compassFxViewportFull.width = viewW;
      _compassFxViewportFull.height = viewH;
      drawViewportHudExtras3D(hudCtx, renderRuntime.getViewKart(), 0, 0, viewW, viewH, time, _compassFxViewportFull);
      renderRuntime.drawHUD(time);
    }
    if (game.state === STATE.COUNTDOWN) {
      renderRuntime.drawCountdown();
    } else if ((game.player && game.player.finished && !game.player.eliminated) || (game.player2 && game.player2.finished && !game.player2.eliminated)) {
      if (game.state === STATE.RACING) {
        renderRuntime.drawFinishBanner(time);
      }
    }
    draw3DProfile(hudCtx);
    renderRuntime.setCtx(origCtx);
  }
}
