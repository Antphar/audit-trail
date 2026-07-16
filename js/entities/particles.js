import { TAU, lerp, clamp, rand, pick } from "../core/math.js";
import { COMPASS_VISUAL } from "../config/themes.js";
import { game } from "../core/state.js";
import { simRandom } from "../core/rng.js";

export function kartVisualZOffset(kart) {
  return (kart?.z || 0) * 0.65;
}

export const PARTICLE_2D_MAX = 360;
export const PARTICLE_2D_IMPORTANT_RESERVE = 80;
export const SKID_2D_MAX = 400;
export const COMPASS_FX_3D_OVERLAY_MAX = 24;
export const APPROVAL_TOKEN_FRAMES = 40;

function particleTrimPriority(p) {
  if (p.type === "approvalToken") return 100;
  if (p.type === "text" && p.text && /APPROVAL|STOLEN|\+1|REVOKED/i.test(p.text)) return 85;
  if (p.compassFx) return 70;
  if (p.type === "text") return 55;
  if (p.type === "ring") return 45;
  if (p.type === "line") return 35;
  return 15;
}

function isImportantParticle(p) {
  return particleTrimPriority(p) >= 70;
}

export function admitParticle(list, p) {
  const incomingPriority = particleTrimPriority(p);
  if (!isImportantParticle(p)) {
    let genericCount = 0;
    for (let i = 0; i < list.length; i++) {
      if (!isImportantParticle(list[i])) genericCount++;
    }
    if (genericCount >= PARTICLE_2D_MAX - PARTICLE_2D_IMPORTANT_RESERVE || list.length >= PARTICLE_2D_MAX) {
      return false;
    }
    list.push(p);
    return true;
  }

  if (list.length >= PARTICLE_2D_MAX) {
    let evictIndex = -1;
    let evictPriority = incomingPriority;
    for (let i = 0; i < list.length; i++) {
      const priority = particleTrimPriority(list[i]);
      if (priority < evictPriority) {
        evictPriority = priority;
        evictIndex = i;
      }
    }
    if (evictIndex < 0) return false;
    list.splice(evictIndex, 1);
  }
  list.push(p);
  return true;
}

export function pushSkidMark(mark) {
  game.skidMarks.push(mark);
  while (game.skidMarks.length > SKID_2D_MAX) game.skidMarks.shift();
}

export function drawCompassSealMini(c, x, y, r = 7) {
  c.save();
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath(); c.arc(x, y + 1, r, 0, TAU); c.fill();
  c.fillStyle = COMPASS_VISUAL.sealFill;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.strokeStyle = COMPASS_VISUAL.sealRing;
  c.lineWidth = 1.6;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  c.fillStyle = COMPASS_VISUAL.sealMark;
  c.font = `bold ${Math.round(r * 1.35)}px sans-serif`;
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText("✓", x, y + 0.5);
  c.restore();
}

export function spawnCompassRevokeFx(kart) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(kart);
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - 24 - zOff,
    vx: 0, vy: 0, life: 22, maxLife: 22, size: 6, startSize: 22,
    color: "#ff3366", drag: 1,
  });
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * TAU + rand(-0.15, 0.15);
    const sp = rand(2.2, 4.8);
    game.particles.add({
      type: "rect", compassFx: true,
      x: kart.x + Math.cos(ang) * 4, y: kart.y - 26 - zOff + Math.sin(ang) * 4,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.4,
      life: rand(18, 28), maxLife: 28, size: rand(3, 5),
      angle: ang, spin: rand(-0.25, 0.25), color: "#ff3366", drag: 0.9,
    });
  }
}

export function spawnApprovalTransferToken(victim, attacker) {
  if (!game.particles || !victim || !attacker) return;
  const zOff = kartVisualZOffset(victim);
  game.particles.add({
    type: "approvalToken", compassFx: true,
    victimRef: victim, attackerRef: attacker,
    fromX: victim.x, fromY: victim.y - zOff,
    toX: attacker.x, toY: attacker.y - kartVisualZOffset(attacker),
    vx: 0, vy: 0, life: APPROVAL_TOKEN_FRAMES, maxLife: APPROVAL_TOKEN_FRAMES,
    drag: 1,
  });
}

export function spawnCompassRamFx(def, att, dirx, diry) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(def);
  game.particles.add({
    type: "ring", compassFx: true, x: def.x, y: def.y - zOff,
    vx: 0, vy: 0, life: 24, maxLife: 24, size: 8, startSize: 26,
    color: COMPASS_VISUAL.primary, drag: 1,
  });
  game.particles.add({
    type: "ring", compassFx: true, x: def.x, y: def.y - zOff,
    vx: 0, vy: 0, life: 18, maxLife: 18, size: 4, startSize: 18,
    color: COMPASS_VISUAL.accent, drag: 1,
  });
  game.particles.burst(def.x, def.y - zOff, COMPASS_VISUAL.mint, 6, {
    type: "spark", spdMin: 2.5, spdMax: 5.5, compassFx: true,
  });
  game.particles.add({
    type: "line", compassFx: true,
    x: def.x + dirx * 8, y: def.y - zOff + diry * 8,
    vx: dirx * 6, vy: diry * 6,
    life: 16, maxLife: 16, size: 3, color: COMPASS_VISUAL.success, drag: 0.94,
  });
}

export function spawnRampLaunchFx(kart, ramp) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(kart);
  const cos = Math.cos(ramp.ang), sin = Math.sin(ramp.ang);
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - zOff,
    vx: 0, vy: 0, life: 20, maxLife: 20, size: 6, startSize: 24,
    color: COMPASS_VISUAL.accent, drag: 1,
  });
  for (let i = 0; i < 6; i++) {
    const ang = ramp.ang + rand(-0.35, 0.35);
    const sp = rand(2, 4.5);
    game.particles.add({
      type: "spark", compassFx: true,
      x: kart.x + cos * 6, y: kart.y - zOff + sin * 6,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.2,
      life: rand(14, 24), maxLife: 24, size: rand(2, 4),
      color: pick([COMPASS_VISUAL.accent, COMPASS_VISUAL.accentSoft]), drag: 0.9,
    });
  }
}

export function spawnRampLandingFx(kart) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(kart);
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - zOff,
    vx: 0, vy: 0, life: 22, maxLife: 22, size: 5, startSize: 20,
    color: COMPASS_VISUAL.mint, drag: 1,
  });
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - zOff,
    vx: 0, vy: 0, life: 16, maxLife: 16, size: 3, startSize: 14,
    color: COMPASS_VISUAL.primary, drag: 1,
  });
  game.particles.burst(kart.x, kart.y - zOff, COMPASS_VISUAL.success, 5, {
    type: "spark", spdMin: 0.8, spdMax: 2.2, compassFx: true,
  });
}


export class ParticleSystem {
  constructor() { this.list = []; }
  add(p) {
    return admitParticle(this.list, p);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      if (p.type !== "approvalToken") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(p.drag || 0.96, dt);
        p.vy *= Math.pow(p.drag || 0.96, dt);
      }
      if (p.spin) p.angle = (p.angle || 0) + p.spin * dt;
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = t;
      if (p.type === "approvalToken") {
        const prog = 1 - t;
        const ease = prog * prog * (3 - 2 * prog);
        let vx = p.fromX, vy = p.fromY, ax = p.toX, ay = p.toY;
        const victim = p.victimRef;
        const attacker = p.attackerRef;
        if (victim && !victim.eliminated) {
          vx = victim.x; vy = victim.y - kartVisualZOffset(victim);
        }
        if (attacker && !attacker.eliminated) {
          ax = attacker.x; ay = attacker.y - kartVisualZOffset(attacker);
        }
        const cx = lerp(vx, ax, ease);
        const cy = lerp(vy, ay, ease) - 16;
        const trailSteps = 6;
        for (let i = 1; i <= trailSteps; i++) {
          const te = ease - i * 0.06;
          if (te < 0) break;
          const tx = lerp(vx, ax, te);
          const ty = lerp(vy, ay, te) - 16;
          ctx.globalAlpha = 0.12 + 0.1 * (trailSteps - i);
          ctx.strokeStyle = i % 2 ? COMPASS_VISUAL.mint : COMPASS_VISUAL.primary;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9 + 0.1 * Math.sin(prog * Math.PI);
        drawCompassSealMini(ctx, cx, cy, 7);
        if (p.life < 8 && attacker && !attacker.eliminated) {
          const pulse = (8 - p.life) / 8;
          const ax2 = attacker.x, ay2 = attacker.y - kartVisualZOffset(attacker) - 14;
          ctx.globalAlpha = pulse * 0.65;
          ctx.strokeStyle = COMPASS_VISUAL.success;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ax2, ay2, 8 + pulse * 10, 0, TAU);
          ctx.stroke();
        }
      } else if (p.type === "spark") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, TAU);
        ctx.fill();
      } else if (p.type === "rect") {
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t) + (p.startSize || p.size) * t, 0, TAU);
        ctx.stroke();
      } else if (p.type === "text") {
        ctx.fillStyle = p.color;
        ctx.font = `bold ${p.size}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.type === "line") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  burst(x, y, color, count = 12, opts = {}) {
    for (let i = 0; i < count; i++) {
      const ang = simRandom() * TAU;
      const sp = rand(opts.spdMin || 1.5, opts.spdMax || 4.5);
      const admitted = admitParticle(this.list, {
        type: opts.type || "spark",
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(15, 35), maxLife: 35,
        size: rand(2, 5),
        color, drag: 0.92,
        compassFx: !!opts.compassFx,
      });
      if (!admitted && !opts.compassFx) break;
    }
  }
}
