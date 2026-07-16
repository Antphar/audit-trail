import { TAU, clamp } from "../core/math.js";
import { simRandom } from "../core/rng.js";

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

let _hazardIdCounter = 0;
function nextHazardId() { return ++_hazardIdCounter; }
export function resetHazardIdCounter() { _hazardIdCounter = 0; }

export class MergeConflict {
  constructor(x, y, owner = null) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.r = 15;
    this.spin = simRandom() * Math.PI * 2;
    this.active = true;
    this.ignoreOwnerTimer = 28;
  }

  update(dt) {
    this.spin += 0.08 * dt;
    if (this.ignoreOwnerTimer > 0) this.ignoreOwnerTimer -= dt;
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);

    ctx.fillStyle = "rgba(255, 30, 80, 0.25)";
    ctx.strokeStyle = "#ff4d6d";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "#ff4d6d";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.rect(-14, -14, 28, 28);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Err", 0, 0);

    ctx.restore();
  }
}

export class PlaceboPill {
  constructor(x, y, owner = null) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.r = 15;
    this.spin = simRandom() * TAU;
    this.active = true;
  }

  update(dt) {
    this.spin += 0.065 * dt;
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ffcc00";
    ctx.fillStyle = "rgba(255, 204, 0, 0.25)";
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2.5;
    roundRect(ctx, -18, -9, 36, 18, 9);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Rx", -8, 0);
    ctx.restore();
  }
}

export class DoubleBlindCloud {
  constructor(x, y, heading, owner) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.vx = Math.cos(heading + Math.PI) * 1.2;
    this.vy = Math.sin(heading + Math.PI) * 1.2;
    this.r = 48;
    this.life = 240;
    this.active = true;
    this.phase = simRandom() * TAU;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.phase += 0.06 * dt;
    this.life -= dt;
    this.r = Math.min(76, this.r + 0.05 * dt);
    if (this.life <= 0) this.active = false;
  }

  draw(ctx, time) {
    const a = clamp(this.life / 240, 0, 1);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#bd57ff";
    for (let i = 0; i < 5; i++) {
      const ang = this.phase + i * TAU / 5;
      ctx.fillStyle = `rgba(189, 87, 255, ${0.12 * a})`;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * 18, Math.sin(ang) * 12, this.r * (0.42 + i * 0.035), 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(255,255,255,${0.8 * a})`;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BLIND", 0, 0);
    ctx.restore();
  }
}

/* ============================================================
   REGULATORY DRAGON PROJECTILE HAZARD
   ============================================================ */
export class RegulatoryProjectile {
  constructor(x, y, heading, speed = 8.4, enraged = false) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed;
    this.vx = Math.cos(heading) * this.speed;
    this.vy = Math.sin(heading) * this.speed;
    this.r = enraged ? 20 : 17;
    this.spin = simRandom() * TAU;
    this.life = 300;
    this.active = true;
    this.kind = "regulatory_projectile";
    this.enraged = enraged;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += 0.24 * dt;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }

  draw(ctx, time) {
    const pulse = 0.7 + 0.3 * Math.sin(time * 0.018 + this.spin);
    const color = this.enraged ? "#ff7a18" : "#ff3366";
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    ctx.shadowBlur = (this.enraged ? 26 : 18) * pulse;
    ctx.shadowColor = color;
    ctx.fillStyle = this.enraged ? "rgba(255, 122, 24, 0.38)" : "rgba(255, 51, 102, 0.32)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("§", 0, 0);
    ctx.restore();
  }
}

/* ============================================================
   DOSSIER PROJECTILE HAZARD
   ============================================================ */
export class DossierProjectile {
  constructor(x, y, heading, owner) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.owner = owner;
    this.speed = 10.0;
    this.vx = Math.cos(heading) * this.speed;
    this.vy = Math.sin(heading) * this.speed;
    this.r = 12;
    this.spin = simRandom() * Math.PI * 2;
    this.active = true;
    this.life = 360;
    this.ignoreOwnerTimer = 20;
  }

  update(dt, track) {
    this.spin += 0.15 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
    }
    if (this.ignoreOwnerTimer > 0) {
      this.ignoreOwnerTimer -= dt;
    }

    // Bounce off track walls!
    if (track) {
      const c = track.closestSegment(this.x, this.y);
      const seg = track.segments[c.idx];
      const wallLimit = seg.halfW + 40;
      if (c.dist > wallLimit) {
        const proj = c.proj;
        const nx = (this.x - proj.x) / Math.max(0.001, c.dist);
        const ny = (this.y - proj.y) / Math.max(0.001, c.dist);
        const push = c.dist - wallLimit;
        this.x -= nx * push;

        // Reflect velocity with elastic bounce off normal
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
          this.vx -= dot * nx * 2.0;
          this.vy -= dot * ny * 2.0;
          this.heading = Math.atan2(this.vy, this.vx);
        }
      }
    }
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);

    // Folder Tab & Body in Neon Cyan
    ctx.fillStyle = "rgba(87, 242, 255, 0.25)";
    ctx.strokeStyle = "#57f2ff";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "#57f2ff";
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.rect(-12, -9, 24, 18);
    ctx.moveTo(-12, -9);
    ctx.lineTo(-12, -13);
    ctx.lineTo(-4, -13);
    ctx.lineTo(-2, -9);
    ctx.fill();
    ctx.stroke();

    // Document Lines in White/Cyan
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7, -4); ctx.lineTo(7, -4);
    ctx.moveTo(-7, 1);  ctx.lineTo(3, 1);
    ctx.moveTo(-7, 5);  ctx.lineTo(5, 5);
    ctx.stroke();

    ctx.restore();
  }
}

/* ============================================================
   DRAGON FIRE HAZARD
   ============================================================ */
export class DragonFire {
  constructor(x, y, heading, speed) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed || 6.0;
    this.vx = Math.cos(heading) * this.speed;
    this.vy = Math.sin(heading) * this.speed;
    this.r = 18;
    this.active = true;
    this.life = 420;
    this.pulsePhase = simRandom() * Math.PI * 2;
    this.sizePhase = 0;
  }

  update(dt) {
    this.sizePhase += 0.08 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
    }
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);

    const pulse = 0.80 + 0.20 * Math.sin(this.sizePhase * 4 + this.pulsePhase);
    const baseR = this.r * pulse;

    // ---- Directional motion blur trail ----
    const trailLen = this.speed * 3.5;
    const trailGrad = ctx.createLinearGradient(0, 0, -Math.cos(this.heading) * trailLen, -Math.sin(this.heading) * trailLen);
    trailGrad.addColorStop(0, `rgba(255, 200, 40, 0.5)`);
    trailGrad.addColorStop(0.5, `rgba(255, 80, 0, 0.25)`);
    trailGrad.addColorStop(1, `rgba(180, 0, 0, 0)`);
    ctx.fillStyle = trailGrad;
    ctx.beginPath();
    ctx.ellipse(-Math.cos(this.heading) * trailLen * 0.3, -Math.sin(this.heading) * trailLen * 0.3, trailLen * 0.7, baseR * 1.2, this.heading, 0, TAU);
    ctx.fill();

    // ---- Outer fiery aura (2 layers for depth) ----
    const outerGlow = ctx.createRadialGradient(0, 0, baseR * 0.2, 0, 0, baseR * 3.2);
    outerGlow.addColorStop(0, "rgba(255, 220, 80, 0.8)");
    outerGlow.addColorStop(0.25, "rgba(255, 120, 20, 0.55)");
    outerGlow.addColorStop(0.55, "rgba(255, 40, 0, 0.2)");
    outerGlow.addColorStop(1, "rgba(120, 0, 0, 0)");
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 3.2, 0, TAU);
    ctx.fill();

    const innerGlow = ctx.createRadialGradient(0, 0, baseR * 0.15, 0, 0, baseR * 2.0);
    innerGlow.addColorStop(0, "rgba(255, 200, 60, 0.6)");
    innerGlow.addColorStop(0.4, "rgba(255, 90, 15, 0.35)");
    innerGlow.addColorStop(1, "rgba(150, 0, 0, 0)");
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 2.0, 0, TAU);
    ctx.fill();

    // ---- Core ember body ----
    ctx.fillStyle = `rgba(255, ${180 + Math.floor(simRandom() * 75)}, ${40 + Math.floor(simRandom() * 60)}, 0.92)`;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.65, 0, TAU);
    ctx.fill();

    // ---- White-hot inner core ----
    ctx.fillStyle = "rgba(255, 250, 220, 0.95)";
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.28, 0, TAU);
    ctx.fill();

    // ---- Rotating flame tongues (more organic) ----
    const tongues = 7;
    for (let i = 0; i < tongues; i++) {
      const tAng = (i / tongues) * TAU + this.sizePhase * 3 + this.pulsePhase + Math.sin(i * 0.8) * 0.3;
      const tLen = baseR * (0.9 + 0.7 * Math.sin(this.sizePhase * 4 + i * 1.3));
      const tWidth = 2.5 + Math.sin(this.sizePhase * 6 + i * 2) * 1.2;
      ctx.strokeStyle = `rgba(255, ${140 + i * 15}, ${20 + i * 5}, 0.75)`;
      ctx.lineWidth = tWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(Math.cos(tAng) * baseR * 0.5, Math.sin(tAng) * baseR * 0.5);
      const midX = Math.cos(tAng - 0.1 * Math.sin(this.sizePhase * 2 + i)) * tLen * 0.6;
      const midY = Math.sin(tAng - 0.1 * Math.sin(this.sizePhase * 2 + i)) * tLen * 0.6;
      const endX = Math.cos(tAng + 0.15 * Math.cos(this.sizePhase * 3 + i)) * tLen;
      const endY = Math.sin(tAng + 0.15 * Math.cos(this.sizePhase * 3 + i)) * tLen;
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
    }

    // ---- Small random ember sparks inside ----
    ctx.fillStyle = "rgba(255, 255, 200, 0.7)";
    for (let i = 0; i < 3; i++) {
      const spkAng = (this.sizePhase * 2 + i * 2.1) % TAU;
      const spkDist = baseR * (0.3 + 0.3 * simRandom());
      ctx.beginPath();
      ctx.arc(Math.cos(spkAng) * spkDist, Math.sin(spkAng) * spkDist, 1.5 + simRandom() * 2, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
}
