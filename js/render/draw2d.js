import { TUNING } from "../config/tuning.js";
import { COMPASS_VISUAL } from "../config/themes.js";
import { TAU, lerp, clamp, hexToRgba } from "../core/math.js";
import {
  STATE,
  game,
  isBattleMode,
  getActiveKarts,
  getKartById,
} from "../core/state.js";
import { MAPS } from "../config/maps.js";
import { kartVisualZOffset } from "../entities/particles.js";
import { renderRuntime } from "./render-runtime.js";
import { THREE_STATE } from "./three-state.js";
import { draw3D } from "./three-frame.js";
import { roundRect, drawApprovalSeals } from "./hud.js";
import {
  drawHUD, drawHUDMultiplayer, drawCountdown, drawFinishBanner, drawApprovals3DOverlay,
  drawBoostSpeedLines,
} from "./hud.js";

const ctx = () => renderRuntime.getCtx();
const VIEW_W = () => renderRuntime.getViewW();
const VIEW_H = () => renderRuntime.getViewH();

export function drawMergeRequestTethers( time) {
  const pulse = 0.45 + 0.35 * Math.sin(time * 0.018);
  for (const kart of getActiveKarts()) {
    if (!kart || !kart.mergePullTimer || kart.mergePullTimer <= 0) continue;
    const target = kart.mergePullTarget || getKartById(kart.mergePullTargetId);
    if (!target || target === kart) continue;
    const x1 = kart.x, y1 = kart.y - kartVisualZOffset(kart);
    const x2 = target.x, y2 = target.y - kartVisualZOffset(target);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    ctx().save();
    ctx().strokeStyle = `rgba(57, 255, 20, ${pulse})`;
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 12;
    ctx().shadowColor = "#39ff14";
    ctx().setLineDash([10, 7]);
    ctx().lineDashOffset = -time * 0.12;
    ctx().beginPath();
    ctx().moveTo(x1, y1);
    ctx().lineTo(x2, y2);
    ctx().stroke();
    ctx().shadowBlur = 0;
    ctx().setLineDash([]);
    ctx().strokeStyle = hexToRgba(COMPASS_VISUAL.info, 0.75);
    ctx().lineWidth = 1;
    ctx().beginPath();
    ctx().moveTo(x1, y1);
    ctx().lineTo(x2, y2);
    ctx().stroke();
    const beadCount = 4;
    for (let b = 0; b < beadCount; b++) {
      const phase = ((time * 0.0012 + b / beadCount) % 1);
      const bx = x1 + ux * len * phase;
      const by = y1 + uy * len * phase;
      ctx().fillStyle = b % 2 ? COMPASS_VISUAL.mint : COMPASS_VISUAL.primary;
      ctx().beginPath();
      ctx().arc(bx, by, 2.2, 0, TAU);
      ctx().fill();
    }
    ctx().restore();
  }
}
export function drawKartNameTag( kart, time) {
  if (!kart || kart.eliminated) return;
  const zOff = kartVisualZOffset(kart);
  ctx().save();
  const nx = kart.x;
  const ny = kart.y + 22 - zOff;
  ctx().font = "bold 8px 'SFMono-Regular', Consolas, monospace";
  ctx().textAlign = "center";
  ctx().textBaseline = "top";

  const isUlt = kart.ultActiveTimer > 0;
  const alpha = isUlt ? 0.6 + 0.3 * Math.sin(time * 0.02) : 0.65;
  ctx().fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
  const tw = ctx().measureText(kart.name).width;
  roundRect(ctx(), nx - tw / 2 - 4, ny - 1, tw + 8, 12, 3);
  ctx().fill();

  ctx().fillStyle = kart.color;
  ctx().globalAlpha = alpha;
  ctx().fillText(kart.name, nx, ny + 1);
  ctx().restore();
}

// Draws N Approval seals centered horizontally at (x, y) in whatever space `c` is in.

// Floating Approval seals above a kart in Battle mode (2D world-space).
export function drawApprovals( kart, time) {
  if (!isBattleMode() || !kart || kart.eliminated) return;
  const zOff = kartVisualZOffset(kart);
  drawApprovalSeals(ctx(), kart.x, kart.y - 40 - zOff, kart.approvals || 0, time, 8);
}

export function drawSpeechBubble( kart) {
  if (!kart.activeQuote || kart.quoteTimer <= 0) return;

  ctx().save();
  const zOff = kartVisualZOffset(kart);
  // Position above kart
  const bx = kart.x;
  const by = kart.y - 32 - zOff;

  ctx().font = "bold 11px sans-serif";
  const textWidth = ctx().measureText(kart.activeQuote).width;
  const padH = 8;
  const padV = 5;
  const bw = textWidth + padH * 2;
  const bh = 14 + padV * 2;

  // Shadow
  ctx().fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx(), bx - bw / 2 + 2, by - bh - 6 + 2, bw, bh, 6);
  ctx().fill();

  // Glassmorphic background with custom neon border matching developer theme
  ctx().fillStyle = "rgba(10, 8, 28, 0.88)";
  ctx().strokeStyle = kart.color || "#ffffff";
  ctx().lineWidth = 1.5;

  ctx().beginPath();
  roundRect(ctx(), bx - bw / 2, by - bh - 6, bw, bh, 6);
  ctx().fill();
  ctx().stroke();

  // Stem triangle pointing to kart
  ctx().fillStyle = "rgba(10, 8, 28, 0.88)";
  ctx().beginPath();
  ctx().moveTo(bx - 5, by - 6);
  ctx().lineTo(bx + 5, by - 6);
  ctx().lineTo(bx, by);
  ctx().closePath();
  ctx().fill();

  ctx().beginPath();
  ctx().moveTo(bx - 5, by - 6);
  ctx().lineTo(bx, by);
  ctx().lineTo(bx + 5, by - 6);
  ctx().stroke();

  // Text rendering
  ctx().fillStyle = "#ffffff";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().fillText(kart.activeQuote, bx, by - bh / 2 - 5);

  ctx().restore();
}
export function drawWorld(pKart, left, top, width, height, time, isP2) {
  if (!pKart) return;

  ctx().save();
  ctx().beginPath();
  ctx().rect(left, top, width, height);
  ctx().clip();

  // Draw background grass
  ctx().fillStyle = "#0a1f0d";
  ctx().fillRect(left, top, width, height);

  const cx = left + width / 2;
  const cy = top + height / 2;

  if (!pKart.camX) {
    pKart.camX = pKart.x;
    pKart.camY = pKart.y;
    pKart.camScale = 1.0;
  }
  const lookX = pKart.x + pKart.vx * 12;
  const lookY = pKart.y + pKart.vy * 12;
  const dt = game.lastDt || 1;
  const followLerp = 1 - Math.pow(0.92, dt);
  pKart.camX = lerp(pKart.camX, lookX, followLerp);
  pKart.camY = lerp(pKart.camY, lookY, followLerp);

  const sp = pKart.speed();
  const targetScale = clamp(1.05 - sp * 0.025, 0.85, 1.05);
  pKart.camScale = lerp(pKart.camScale, targetScale, followLerp);

  const shake = game.shake;
  const sx = (Math.random() - 0.5) * shake * 2;
  const sy = (Math.random() - 0.5) * shake * 2;

  ctx().translate(cx + sx, cy + sy);
  ctx().scale(pKart.camScale, pKart.camScale);
  ctx().translate(-pKart.camX, -pKart.camY);

  // Track
  game.track.draw(ctx(), time);

  // Skid marks (batched into grouped angled dash strokes)
  if (game.skidMarks && game.skidMarks.length) {
    const c = ctx();
    c.save();
    c.lineCap = "round";
    const buckets = new Map();
    const lenMarks = game.skidMarks.length;
    for (let i = 0; i < lenMarks; i++) {
      const s = game.skidMarks[i];
      if (!s) continue;
      const lifeFrac = (s.life != null && s.maxLife)
        ? clamp(s.life / s.maxLife, 0, 1)
        : (s.alpha != null ? clamp(s.alpha, 0, 1) : 1);
      if (lifeFrac <= 0.02) continue;
      const alphaQ = Math.max(1, Math.min(4, Math.ceil(lifeFrac * 4))) * 0.25;
      const w = Math.max(1.5, Math.round((s.size || 4) * 2) / 2);
      const col = s.color || "rgba(20,20,30,0.6)";
      const key = `${col}|${w}|${alphaQ}`;
      let list = buckets.get(key);
      if (!list) {
        list = { col, w, alpha: alphaQ, segs: [] };
        buckets.set(key, list);
      }

      let x1, y1, x2, y2;
      if (Number.isFinite(s.px) && Number.isFinite(s.py)) {
        x1 = s.px; y1 = s.py; x2 = s.x; y2 = s.y;
      } else if (Number.isFinite(s.angle)) {
        const half = Math.max(3, (s.size || 4) * 1.35);
        const dx = Math.cos(s.angle) * half;
        const dy = Math.sin(s.angle) * half;
        x1 = s.x - dx; y1 = s.y - dy; x2 = s.x + dx; y2 = s.y + dy;
      } else {
        // Infer alignment from previous mark of the same wheel side (marks alternate left/right)
        let prev = i >= 2 ? game.skidMarks[i - 2] : null;
        if (!prev || prev.color !== s.color || Math.hypot(s.x - prev.x, s.y - prev.y) > 26) {
          prev = i >= 1 ? game.skidMarks[i - 1] : null;
        }
        if (prev && prev.color === s.color) {
          const dx = s.x - prev.x;
          const dy = s.y - prev.y;
          const d = Math.hypot(dx, dy);
          if (d > 1.5 && d < 26) {
            const half = Math.min(d * 0.55, Math.max(3.5, (s.size || 4) * 1.4));
            const ux = (dx / d) * half;
            const uy = (dy / d) * half;
            x1 = s.x - ux; y1 = s.y - uy; x2 = s.x + ux; y2 = s.y + uy;
          } else {
            const r = Math.max(2, (s.size || 4) * 0.75);
            x1 = s.x - r; y1 = s.y - r * 0.3; x2 = s.x + r; y2 = s.y + r * 0.3;
          }
        } else {
          const r = Math.max(2, (s.size || 4) * 0.75);
          x1 = s.x - r; y1 = s.y - r * 0.3; x2 = s.x + r; y2 = s.y + r * 0.3;
        }
      }
      list.segs.push(x1, y1, x2, y2);
    }

    for (const bucket of buckets.values()) {
      const segs = bucket.segs;
      c.globalAlpha = bucket.alpha;
      c.strokeStyle = bucket.col;
      c.lineWidth = bucket.w;
      c.beginPath();
      for (let j = 0; j < segs.length; j += 4) {
        c.moveTo(segs[j], segs[j + 1]);
        c.lineTo(segs[j + 2], segs[j + 3]);
      }
      c.stroke();
    }
    c.restore();
  }

  // Spectators
  if (game.track.spectators && game.track.spectators.length) {
    game.track.drawSpectators(ctx(), time);
  }

  // Items
  game.track.drawItems(ctx(), time);

  // Moving mainframe objects
  if (game.track.movingObjects && game.track.movingObjects.length) {
    game.track.drawMovingObjects(ctx(), time);
  }

  if (game.track.regulatoryDragon) {
    game.track.drawRegulatoryDragon(ctx(), time);
  }

  // Hazards
  if (game.hazards) {
    for (const h of game.hazards) {
      h.draw(ctx(), time);
    }
  }

  drawMergeRequestTethers(time);
  // Dragon head visual for Dragon's Escape map
  if (MAPS[game.selectedMapIdx || 0].id === "dragon_escape") {
    drawDragonHead(pKart, time);
  }

  // Karts sorted by depth
  const activeKarts = getActiveKarts();
  const sorted = activeKarts.slice().sort((a, b) => a.y - b.y);
  for (const k of sorted) k.draw(ctx(), time);

  // Name tags below karts + speech bubbles above
  for (const k of sorted) {
    drawKartNameTag(k, time);
    drawApprovals(k, time);
    drawSpeechBubble(k);
  }

  // Particles
  game.particles.draw(ctx());

  ctx().restore();

  // Speed lines while boosting (drawn in viewport screen space)
  if (pKart.boostTimer > 0) {
    drawSpeedLinesViewport(left, top, width, height, time);
  }
}

export function drawDragonHead( pKart, time) {
  // Dragon's Escape uses a shared world entity, not a per-camera decoration.
  const dragon = game.dragonEscape;
  if (!dragon || !dragon.active) return;
  const headX = dragon.x;
  const headY = dragon.y + Math.sin(time * 0.0018) * 34 + Math.sin(time * 0.004) * 12;

  ctx().save();
  ctx().translate(headX, headY);
  ctx().rotate(dragon.heading || 0);

  const headScale = clamp(1.0 - (pKart.camScale - 0.85) * 0.3, 0.65, 1.1);
  ctx().scale(headScale, headScale);

  const breathe = Math.sin(time * 0.002);
  const eyeGlow = 0.85 + 0.15 * Math.sin(time * 0.006);
  const wingFlap = Math.sin(time * 0.004) * 0.15;

  // ---- Shadow ----
  ctx().fillStyle = "rgba(0,0,0,0.35)";
  ctx().beginPath();
  ctx().ellipse(10, 150, 120, 22, 0, 0, TAU);
  ctx().fill();

  // ---- WINGS (drawn behind body) ----
  // Back wing (darker, offset)
  ctx().save();
  ctx().beginPath();
  ctx().moveTo(-40, -20);
  ctx().quadraticCurveTo(-200, -220 + wingFlap * 60, -320, -120 + wingFlap * 90);
  ctx().quadraticCurveTo(-240, -60 + wingFlap * 40, -180, -40 + wingFlap * 20);
  ctx().quadraticCurveTo(-140, -10 + wingFlap * 10, -50, 20);
  ctx().closePath();
  ctx().strokeStyle = "rgba(120, 16, 0, 0.28)";
  ctx().lineWidth = 8;
  ctx().stroke();
  ctx().fillStyle = "#1a0a05";
  ctx().fill();
  ctx().strokeStyle = "#4a1a0a";
  ctx().lineWidth = 2;
  ctx().stroke();
  // Wing membrane veins
  ctx().strokeStyle = "rgba(255, 50, 0, 0.2)";
  ctx().lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx().beginPath();
    ctx().moveTo(-40, -20);
    ctx().quadraticCurveTo(-160 - i * 30, -140 + wingFlap * 50 + i * 15, -280 - i * 15, -100 + wingFlap * 80);
    ctx().stroke();
  }
  ctx().restore();

  // Front wing (slightly lighter, different flap phase)
  ctx().save();
  const flap2 = Math.sin(time * 0.004 + 1.2) * 0.12;
  ctx().beginPath();
  ctx().moveTo(-10, 10);
  ctx().quadraticCurveTo(-180, -180 + flap2 * 70, -290, -80 + flap2 * 100);
  ctx().quadraticCurveTo(-220, -30 + flap2 * 45, -150, -10 + flap2 * 25);
  ctx().quadraticCurveTo(-110, 20 + flap2 * 15, -20, 50);
  ctx().closePath();
  ctx().strokeStyle = "rgba(180, 42, 0, 0.32)";
  ctx().lineWidth = 9;
  ctx().stroke();
  ctx().fillStyle = "#2a1008";
  ctx().fill();
  ctx().strokeStyle = "#5c1a0a";
  ctx().lineWidth = 2;
  ctx().stroke();
  ctx().restore();

  // ---- Serpentine BODY/NECK trailing back ----
  ctx().beginPath();
  ctx().moveTo(-50, 40);
  ctx().quadraticCurveTo(-120, 80 + breathe * 10, -180, 40 + breathe * 15);
  ctx().quadraticCurveTo(-260, 10 + breathe * 20, -340, -30 + breathe * 25);
  ctx().quadraticCurveTo(-400, -60 + breathe * 30, -450, -20 + breathe * 20);
  ctx().lineTo(-460, -10 + breathe * 20);
  ctx().quadraticCurveTo(-400, 40 + breathe * 25, -320, 80 + breathe * 15);
  ctx().quadraticCurveTo(-200, 120 + breathe * 10, -80, 70);
  ctx().closePath();
  ctx().strokeStyle = "rgba(110, 24, 6, 0.35)";
  ctx().lineWidth = 9;
  ctx().stroke();
  ctx().fillStyle = "#1e0d06";
  ctx().fill();
  ctx().strokeStyle = "#3a1208";
  ctx().lineWidth = 2.5;
  ctx().stroke();

  // ---- Dorsal spikes along neck ----
  const spikePts = [
    [-60, 20, 25], [-110, 50, 22], [-170, 30, 28], [-240, 5, 24],
    [-310, -15, 26], [-380, -40, 30], [-440, -15, 22]
  ];
  ctx().beginPath();
  for (const [sx, sy, sh] of spikePts) {
    ctx().moveTo(sx, sy);
    ctx().lineTo(sx - 8, sy - sh);
    ctx().lineTo(sx + 8, sy - sh + 6);
    ctx().closePath();
  }
  ctx().strokeStyle = "rgba(190, 20, 0, 0.35)";
  ctx().lineWidth = 5;
  ctx().stroke();
  ctx().fillStyle = "#8b0000";
  ctx().fill();

  // ---- MAIN HEAD (serpentine, menacing) ----
  ctx().beginPath();
  // Top of skull
  ctx().moveTo(-70, -50);
  ctx().quadraticCurveTo(-20, -120, 50, -80);
  ctx().quadraticCurveTo(90, -60, 110, -20);
  // Snout top
  ctx().quadraticCurveTo(125, 0, 130, 30);
  // Upper jaw / teeth line
  ctx().quadraticCurveTo(120, 45, 100, 45);
  // Mouth interior
  ctx().quadraticCurveTo(70, 40, 40, 35);
  // Lower jaw bottom
  ctx().quadraticCurveTo(20, 70, -20, 65);
  // Jaw hinge
  ctx().quadraticCurveTo(-40, 55, -50, 40);
  // Throat / neck down
  ctx().quadraticCurveTo(-80, 30, -90, 0);
  ctx().quadraticCurveTo(-100, -30, -70, -50);
  ctx().closePath();
  ctx().strokeStyle = "rgba(255, 45, 10, 0.22)";
  ctx().lineWidth = 14;
  ctx().stroke();
  ctx().strokeStyle = "rgba(255, 70, 20, 0.42)";
  ctx().lineWidth = 7;
  ctx().stroke();
  ctx().fillStyle = "#2a1010";
  ctx().fill();
  ctx().strokeStyle = "#c0392b";
  ctx().lineWidth = 3;
  ctx().stroke();

  // ---- Jaw interior (dark fleshy cavity) ----
  ctx().beginPath();
  ctx().moveTo(30, 35);
  ctx().quadraticCurveTo(80, 40, 110, 30);
  ctx().quadraticCurveTo(100, 55, 60, 58);
  ctx().quadraticCurveTo(20, 55, 0, 45);
  ctx().closePath();
  ctx().strokeStyle = "rgba(255, 102, 0, 0.35)";
  ctx().lineWidth = 4;
  ctx().stroke();
  ctx().fillStyle = "#0a0302";
  ctx().fill();

  // ---- TEETH (upper row) ----
  ctx().fillStyle = "#e8e0d0";
  ctx().beginPath();
  for (let i = 0; i < 7; i++) {
    const tx = 45 + i * 12;
    const ty = 35 + (i % 2) * 5;
    ctx().moveTo(tx, ty);
    ctx().lineTo(tx + 4, ty + 14);
    ctx().lineTo(tx + 8, ty + 2);
    ctx().closePath();
  }
  ctx().fill();

  // ---- TEETH (lower row) ----
  ctx().beginPath();
  for (let i = 0; i < 5; i++) {
    const tx = 55 + i * 11;
    const ty = 55 - (i % 2) * 4;
    ctx().moveTo(tx, ty);
    ctx().lineTo(tx + 3, ty - 10);
    ctx().lineTo(tx + 6, ty + 1);
    ctx().closePath();
  }
  ctx().fill();

  // ---- EYES (glowing demonic - layered halo fills) ----
  ctx().fillStyle = `rgba(255, 180, 20, ${0.22 * eyeGlow})`;
  ctx().beginPath(); ctx().ellipse(30, -50, 26, 20, 0.15, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(75, -55, 20, 15, 0.1, 0, TAU); ctx().fill();
  ctx().fillStyle = `rgba(255, 210, 40, ${0.45 * eyeGlow})`;
  ctx().beginPath(); ctx().ellipse(30, -50, 21, 16, 0.15, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(75, -55, 16.5, 12, 0.1, 0, TAU); ctx().fill();
  ctx().fillStyle = "#ffaa00";
  // Eye sockets (larger)
  ctx().beginPath(); ctx().ellipse(30, -50, 18, 14, 0.15, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(75, -55, 14, 10, 0.1, 0, TAU); ctx().fill();
  // Pupils (vertical cat-like slits with red rim)
  ctx().fillStyle = "rgba(255, 20, 0, 0.45)";
  ctx().beginPath(); ctx().ellipse(33, -50, 5.5, 13, 0.15, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(77, -55, 4, 9.5, 0.1, 0, TAU); ctx().fill();
  ctx().fillStyle = "#110000";
  ctx().beginPath(); ctx().ellipse(33, -50, 3.5, 12, 0.15, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(77, -55, 2.5, 8, 0.1, 0, TAU); ctx().fill();
  // Eye highlight glint
  ctx().fillStyle = "#ffffff";
  ctx().beginPath(); ctx().arc(35, -54, 2.5, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().arc(79, -58, 1.8, 0, TAU); ctx().fill();

  // ---- Forehead ridge / brow ----
  ctx().fillStyle = "#3a1510";
  ctx().strokeStyle = "#6c2418";
  ctx().lineWidth = 2;
  ctx().beginPath();
  ctx().moveTo(10, -75);
  ctx().quadraticCurveTo(50, -95, 100, -70);
  ctx().quadraticCurveTo(80, -60, 40, -65);
  ctx().closePath();
  ctx().fill();
  ctx().stroke();

  // ---- Horns (swept back, 2-pass layered halo strokes) ----
  ctx().lineCap = "round";
  // Outer horn halo pass
  ctx().strokeStyle = "rgba(160, 60, 20, 0.35)";
  ctx().lineWidth = 11;
  ctx().beginPath();
  ctx().moveTo(5, -80); ctx().quadraticCurveTo(-40, -160, -30, -260);
  ctx().moveTo(70, -85); ctx().quadraticCurveTo(110, -170, 130, -240);
  ctx().stroke();

  ctx().strokeStyle = "#4a2818";
  ctx().fillStyle = "#4a2818";
  // Main left horn
  ctx().beginPath();
  ctx().moveTo(5, -80);
  ctx().quadraticCurveTo(-40, -160, -30, -260);
  ctx().lineWidth = 5;
  ctx().stroke();
  ctx().beginPath();
  ctx().arc(-30, -260, 7, 0, TAU); ctx().fill();
  // Branch offshoot
  ctx().lineWidth = 3;
  ctx().beginPath();
  ctx().moveTo(-20, -180);
  ctx().quadraticCurveTo(-60, -220, -70, -190);
  ctx().stroke();
  // Main right horn
  ctx().lineWidth = 5;
  ctx().beginPath();
  ctx().moveTo(70, -85);
  ctx().quadraticCurveTo(110, -170, 130, -240);
  ctx().stroke();
  ctx().beginPath();
  ctx().arc(130, -240, 6, 0, TAU); ctx().fill();
  // Branch offshoot
  ctx().lineWidth = 3;
  ctx().beginPath();
  ctx().moveTo(100, -160);
  ctx().quadraticCurveTo(150, -200, 155, -170);
  ctx().stroke();

  // ---- Nostril slits ----
  ctx().fillStyle = "rgba(255, 60, 0, 0.4)";
  ctx().beginPath(); ctx().ellipse(120, 20, 7, 4.5, 0.2, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(128, 18, 6, 4, 0.2, 0, TAU); ctx().fill();
  ctx().fillStyle = "#1a0300";
  ctx().beginPath(); ctx().ellipse(120, 20, 5, 3, 0.2, 0, TAU); ctx().fill();
  ctx().beginPath(); ctx().ellipse(128, 18, 4, 2.5, 0.2, 0, TAU); ctx().fill();

  // ---- Scales on neck and jaw ----
  ctx().strokeStyle = "rgba(255, 60, 20, 0.35)";
  ctx().lineWidth = 1.2;
  ctx().beginPath();
  for (let i = 0; i < 6; i++) {
    const sy = -60 + i * 18;
    for (let j = 0; j < 4; j++) {
      const sx = -55 + j * 30 + (i % 2) * 15;
      ctx().moveTo(sx + 7, sy + 80);
      ctx().arc(sx, sy + 80, 7, 0, Math.PI);
    }
  }
  ctx().stroke();

  // ---- Scattered glowing embers floating off the dragon (2-pass halo fills) ----
  const emberPhase = (time * 0.003) % 1;
  for (let i = 0; i < 8; i++) {
    const eph = (emberPhase + i / 8) % 1;
    const ex = -20 + i * 15 + eph * 30;
    const ey = -30 + Math.sin(eph * Math.PI * 3 + i) * 25 + eph * 80;
    const er = 3 + eph * 4;
    const g = 80 + i * 20;
    const a = 1 - eph;
    ctx().fillStyle = `rgba(255, ${g}, 0, ${a * 0.28})`;
    ctx().beginPath(); ctx().arc(ex, ey, er * 2.1, 0, TAU); ctx().fill();
    ctx().fillStyle = `rgba(255, ${g}, 0, ${a})`;
    ctx().beginPath(); ctx().arc(ex, ey, er, 0, TAU); ctx().fill();
  }

  // ---- Occasional continuous fire breath from nostrils ----
  if (breathe > 0.3) {
    ctx().beginPath();
    ctx().moveTo(120, 15);
    ctx().quadraticCurveTo(170, 10, 210 + breathe * 40, 30 + Math.sin(time * 0.01) * 15);
    ctx().quadraticCurveTo(180, 35, 125, 25);
    ctx().closePath();
    ctx().strokeStyle = "rgba(255, 80, 0, 0.25)";
    ctx().lineWidth = 10;
    ctx().stroke();
    const fGrad = ctx().createRadialGradient(124, 19, 2, 124, 19, 40 + breathe * 30);
    fGrad.addColorStop(0, `rgba(255, 240, 100, ${0.85})`);
    fGrad.addColorStop(0.3, `rgba(255, 120, 20, ${0.55})`);
    fGrad.addColorStop(1, "rgba(200, 0, 0, 0)");
    ctx().fillStyle = fGrad;
    ctx().fill();
  }

  ctx().restore();
}

export function drawSpeedLinesViewport(left, top, width, height, time) {
  drawBoostSpeedLines(ctx(), left, top, width, height, time, 1);
}

export function draw(time, dt = 1) {
  if (!game.track) {
    ctx().fillStyle = "#07091a";
    ctx().fillRect(0, 0, VIEW_W(), VIEW_H());
    return;
  }

  if (game.viewMode === "3d" && THREE_STATE.renderer) {
    draw3D(dt, time);
    return;
  }

  if (game.multiplayer && game.player2 && !game.p2pMode) {
    // 1. Draw Left Viewport (Player 1)
    const p1W = VIEW_W() / 2 - 2;
    drawWorld(game.player, 0, 0, p1W, VIEW_H(), time, false);

    // 2. Draw Right Viewport (Player 2)
    const p2W = VIEW_W() / 2 - 2;
    const p2X = VIEW_W() / 2 + 2;
    drawWorld(game.player2, p2X, 0, p2W, VIEW_H(), time, true);

    // 3. Draw Split-Screen Divider
    ctx().fillStyle = "rgba(8, 6, 26, 0.75)";
    ctx().fillRect(VIEW_W() / 2 - 3, 0, 6, VIEW_H());

    const grad = ctx().createLinearGradient(0, 0, 0, VIEW_H());
    grad.addColorStop(0, "#7b75ff");
    grad.addColorStop(0.5, "#ff4d6d");
    grad.addColorStop(1, "#fd9927");
    ctx().fillStyle = grad;
    ctx().fillRect(VIEW_W() / 2 - 1, 0, 2, VIEW_H());

    // 4. Boost flash overlays
    if (game.flash > 0) {
      ctx().fillStyle = `rgba(255, 240, 200, ${Math.min(0.3, game.flash * 0.04)})`;
      ctx().fillRect(0, 0, VIEW_W(), VIEW_H());
    }

    // 5. Dual Symmetrical HUD
    drawHUDMultiplayer(time);
  } else {
    // Single Player standard full screen drawing (follows the spectated kart when rejected in Battle)
    drawWorld(renderRuntime.getViewKart(), 0, 0, VIEW_W(), VIEW_H(), time, false);

    // Boost flash overlay
    if (game.flash > 0) {
      ctx().fillStyle = `rgba(255, 240, 200, ${Math.min(0.3, game.flash * 0.04)})`;
      ctx().fillRect(0, 0, VIEW_W(), VIEW_H());
    }

    // Single Player standard HUD
    drawHUD(time);
  }

  // Unified Countdown overlay on top
  const countdownVisible = game.state === STATE.COUNTDOWN ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.COUNTDOWN);
  if (countdownVisible) {
    drawCountdown();
  } else if ((game.player && game.player.finished && !game.player.eliminated) || (game.player2 && game.player2.finished && !game.player2.eliminated)) {
    if (game.state === STATE.RACING) {
      drawFinishBanner(time);
    }
  }
}
