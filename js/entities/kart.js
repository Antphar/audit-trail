import { TUNING } from "../config/tuning.js";
import {
  DEFAULT_KART_COLLISION_RADIUS,
  getVehicleProfile,
} from "../config/characters.js";
import { COMPASS_VISUAL } from "../config/themes.js";
import {
  TAU, lerp, clamp, dist, angleDiff, rand, pick, ellipseNormDist,
} from "../core/math.js";
import { bus } from "../core/events.js";
import {
  game,
  isBattleMode,
  isP2pBattleGuest,
  getActiveKarts,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { WORLD_W, WORLD_H } from "./track.js";
import {
  MergeConflict,
  PlaceboPill,
  DoubleBlindCloud,
  DossierProjectile,
} from "./items.js";
import {
  kartVisualZOffset,
  spawnRampLaunchFx,
  spawnRampLandingFx,
} from "./particles.js";
import { runtime } from "./runtime.js";

const VERTICAL_GRAVITY = 0.32;
const AIRBORNE_THRESHOLD = 4;
const KART_MAX_JUMP_Z = 120;
const RAMP_COOLDOWN_MS = 900;
const KART_GROUNDED_Z = 0.5;

export function isKartAirborne(kart) {
  return !!(kart && (kart.z || 0) > AIRBORNE_THRESHOLD);
}

export function isKartGrounded(kart) {
  return !kart || (kart.z || 0) <= KART_GROUNDED_Z;
}

export function integrateKartVertical(kart, dt) {
  if (!kart) return;
  let z = kart.z || 0;
  let vz = kart.vz || 0;
  if (z <= 0 && vz <= 0) {
    kart.z = 0;
    kart.vz = 0;
    return;
  }
  vz -= VERTICAL_GRAVITY * dt;
  z += vz * dt;
  if (z <= 0) {
    const wasAir = (kart.z || 0) > AIRBORNE_THRESHOLD;
    kart.z = 0;
    kart.vz = 0;
    if (wasAir && kart.isPlayer) {
      bus.emit("kart:land", { kart });
      if (game.particles) spawnRampLandingFx(kart);
    }
  } else {
    kart.z = Math.min(z, KART_MAX_JUMP_Z);
    kart.vz = vz;
  }
}

export function constrainArenaKart(kart, track) {
  const floor = track?.arenaFloor;
  if (!floor || !kart) return false;
  const nd = ellipseNormDist(kart.x, kart.y, floor);
  const limit = 1.0;
  const wallPad = 0.015;
  if (nd <= limit) return false;

  const nx = (kart.x - floor.cx) / Math.max(1, floor.rx);
  const ny = (kart.y - floor.cy) / Math.max(1, floor.ry);
  const len = Math.hypot(nx, ny) || 1;
  const ux = nx / len;
  const uy = ny / len;
  kart.x = floor.cx + ux * floor.rx * (limit - wallPad);
  kart.y = floor.cy + uy * floor.ry * (limit - wallPad);

  const gx = (kart.x - floor.cx) / (floor.rx * floor.rx);
  const gy = (kart.y - floor.cy) / (floor.ry * floor.ry);
  const glen = Math.hypot(gx, gy) || 1;
  const outNx = gx / glen;
  const outNy = gy / glen;

  const dot = kart.vx * outNx + kart.vy * outNy;
  if (dot > 0) {
    kart.vx -= dot * outNx * 2.2;
    kart.vy -= dot * outNy * 2.2;
    kart.vx *= 0.78;
    kart.vy *= 0.78;
  } else {
    kart.vx -= outNx * 0.8;
    kart.vy -= outNy * 0.8;
  }

  if (performance.now() - (kart.lastBumpAt || -999) > 1100) {
    runtime.triggerQuote(kart, "crash");
    kart.lastBumpAt = performance.now();
    if (kart.isPlayer) {
      Sound.bump();
      game.shake = Math.max(game.shake, 5);
    }
  }
  return true;
}

export function checkTrackRamps(kart, track) {
  if (!track?.ramps?.length || !isKartGrounded(kart)) return false;
  const now = performance.now();
  for (const ramp of track.ramps) {
    if (!ramp.cooldown) ramp.cooldown = new Map();
    const last = ramp.cooldown.get(kart);
    if (last && (now - last) < RAMP_COOLDOWN_MS) continue;

    const cos = Math.cos(ramp.ang);
    const sin = Math.sin(ramp.ang);
    const lx = kart.x - ramp.x;
    const ly = kart.y - ramp.y;
    const localX = lx * cos + ly * sin;
    const localY = -lx * sin + ly * cos;
    if (Math.abs(localX) > ramp.w * 0.5 || Math.abs(localY) > ramp.h * 0.5) continue;

    const speed = Math.hypot(kart.vx, kart.vy);
    const minSpeed = ramp.minSpeed ?? (ramp.kind === "bump" ? 2.0 : 3.2);
    if (speed < minSpeed) continue;

    if (ramp.kind === "ramp") {
      const along = kart.vx * cos + kart.vy * sin;
      if (along < minSpeed) continue;
    }

    ramp.cooldown.set(kart, now);
    const impulse = ramp.impulse ?? (ramp.kind === "bump" ? BUMP_IMPULSE : RAMP_IMPULSE);
    kart.vz = Math.max(kart.vz || 0, impulse);
    if (kart.isPlayer) {
      if (ramp.kind === "ramp") bus.emit("kart:jump", { kart, ramp });
      else Sound.tone(420, 0.05, "triangle", 0.1, 200);
      if (game.particles) spawnRampLaunchFx(kart, ramp);
    }
    return true;
  }
  return false;
}

export function applyMergeRequestPull(kart, dt) {
  if (!kart.mergePullTimer || kart.mergePullTimer <= 0) return;
  let target = kart.mergePullTarget;
  if ((!target || target.finished) && kart.mergePullTargetId) {
    target = runtime.getKartById(kart.mergePullTargetId);
    kart.mergePullTarget = target;
  }
  if (!target || target === kart || target.finished) {
    kart.mergePullTimer = 0;
    kart.mergePullTarget = null;
    kart.mergePullTargetId = null;
    kart.mergeBattleStole = false;
    return;
  }

  const dx = target.x - kart.x;
  const dy = target.y - kart.y;
  const d = Math.hypot(dx, dy);
  if (d < 58) {
    kart.mergePullTimer = 0;
    kart.mergePullTarget = null;
    kart.mergePullTargetId = null;
    kart.mergeBattleStole = false;
    kart.boostTimer = Math.max(kart.boostTimer, 48);
    return;
  }

  const nx = dx / Math.max(0.001, d);
  const ny = dy / Math.max(0.001, d);
  const pull = clamp((d - 55) / 280, 0.12, 0.65);
  kart.vx += nx * pull * dt;
  kart.vy += ny * pull * dt;

  const pushback = clamp((d - 55) / 500, 0.04, 0.25);
  target.vx -= nx * pushback * dt;
  target.vy -= ny * pushback * dt;

  kart.mergePullTimer -= dt;

  if (game.particles && Math.random() < 0.35 * dt) {
    game.particles.add({
      type: "line",
      x: kart.x + rand(-4, 4),
      y: kart.y + rand(-4, 4),
      vx: nx * rand(2, 4),
      vy: ny * rand(2, 4),
      life: 14,
      maxLife: 14,
      size: rand(1.5, 3),
      color: "rgba(57, 255, 20, 0.55)",
      drag: 0.95
    });
  }

  if (game.particles && Math.random() < 0.25 * dt) {
    game.particles.add({
      type: "line",
      x: target.x + rand(-4, 4),
      y: target.y + rand(-4, 4),
      vx: -nx * rand(1.5, 3),
      vy: -ny * rand(1.5, 3),
      life: 12,
      maxLife: 12,
      size: rand(1.5, 2.5),
      color: "rgba(57, 255, 20, 0.4)",
      drag: 0.95
    });
  }
}

export class Kart {
  constructor(x, y, heading, char, isPlayer = false) {
    this.x = x; this.y = y;
    this.heading = heading;        // facing direction (radians)
    this.vx = 0; this.vy = 0;       // velocity vector
    this.z = 0; this.vz = 0;        // vertical jump state (same dt units as vx/vy)
    this.charId = char.id;
    this.color = char.color;
    this.name = char.name;
    this.isPlayer = isPlayer;

    // Tunables from character configuration
    this.baseMaxSpeed = char.maxSpeed;
    this.maxSpeed = char.maxSpeed;
    this.reverseMax = TUNING.REVERSE_MAX;
    this.acceleration = char.acceleration;
    this.brakeForce = TUNING.BRAKE_FORCE;
    this.friction = TUNING.FRICTION;
    this.turnSpeed = char.turnSpeed;
    this.weight = char.weight || 20;

    this.gripNormal = char.id === "anton" ? TUNING.GRIP_NORMAL_ANTON : TUNING.GRIP_NORMAL;
    this.gripDrift = char.id === "anton" ? TUNING.GRIP_DRIFT_ANTON : TUNING.GRIP_DRIFT;

    // State
    this.boostTimer = 0;       // active boost duration (frames)
    this.boostStock = 0;       // legacy boost stock compatibility
    this.citationBoostTimer = 0;
    this.shieldTimer = 0;
    this.handlingTimer = 0;    // temporary handling improvement
    this.doubleBlindTimer = 0;
    this.placeboSlowTimer = 0;
    this.throttleLockTimer = 0;
    this.amendmentTimer = 0;
    this.driftCharge = 0;      // increases while drifting -> mini-turbo
    this.driftDir = 0;
    this.invuln = 0;

    // Arcade Item System
    this.itemSlot = null;
    this.itemState = "empty";   // "empty", "rolling", "active"
    this.itemRollTimer = 0;
    this.coinsCollected = 0;
    this.itemUseCount = 0;
    this.ultUseCount = 0;
    this.driftBoostCount = 0;
    this.spinoutTimer = 0;
    this.spinAngle = 0;
    this.gripRecovery = 1.0;
    this.eliminated = false;

    // Battle mode: attacker attribution + post-recovery grace so you can't be chain-revoked
    this.killedBy = null;
    this.lastAttacker = null;
    this.lastAttackerAt = 0;
    this.pendingApprovalTransferFrom = null;
    this.pendingApprovalTransferAt = 0;
    this.recoverGraceTimer = 0;

    // Race progress
    this.nextCheckpoint = 1;
    this.lap = 0;
    this.checkpointsThisLap = 0;
    this.progressPrevX = x;
    this.progressPrevY = y;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.lastLapAt = 0;

    // Visuals / SFX
    this.skidEmitTimer = 0;
    this.lastBumpAt = -999;

    // Speech bubble state
    this.activeQuote = null;
    this.quoteTimer = 0;

    // Drafting / Boost state
    this.draftTimer = 0;
    this.draftBoostTimer = 0;
    this.ultraBoostActive = false;
    this.mergePullTimer = 0;
    this.mergePullTarget = null;
    this.mergePullTargetId = null;

    // Ultimate ability
    this.ultCharge = 0;
    this.ultReady = false;
    this.ultActiveTimer = 0;
    this.ultTier = 0;
  }

  forwardSpeed() {
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    return this.vx * fx + this.vy * fy;
  }
  speed() { return Math.hypot(this.vx, this.vy); }

  useItem() {
    if (this.itemState !== "active") return;
    this.itemUseCount = (this.itemUseCount || 0) + 1;
    const type = this.itemSlot;
    this.itemState = "empty";
    this.itemSlot = null;

    // Play localized visual feedback and spatialized sound!
    runtime.triggerShootEffect(this, type);

    // If multiplayer, broadcast the action event to peer so they play the spatial audio/particles too!
    if (game.p2pMode) {
      runtime.sendP2pMessage({
        type: "action_event",
        kartId: runtime.getKartId(this),
        item: type
      });
    }

    if (type === "boost") {
      this.boostTimer = Math.max(this.boostTimer, TUNING.BOOST_DURATION);
      runtime.triggerQuote(this, "boost");
    } else if (type === "shield") {
      this.shieldTimer = this.charId === "rissal" ? TUNING.SHIELD_DURATION_RISSAL : TUNING.SHIELD_DURATION;
    } else if (type === "handling") {
      this.handlingTimer = TUNING.HANDLING_DURATION;
    } else if (type === "conflict") {
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const dropX = this.x - fx * 32;
      const dropY = this.y - fy * 32;
      if (!isP2pBattleGuest()) {
        const h = new MergeConflict(dropX, dropY, this);
        game.hazards.push(h);
      }
      if (game.p2pMode && game.p2pRole === "guest") {
        runtime.sendP2pMessage({
          type: "drop_conflict",
          kartId: runtime.getKartId(this),
          x: dropX,
          y: dropY
        });
      }
    } else if (type === "placebo") {
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const dropX = this.x - fx * 34;
      const dropY = this.y - fy * 34;
      if (!isP2pBattleGuest()) game.hazards.push(new PlaceboPill(dropX, dropY, this));
      if (game.p2pMode && game.p2pRole === "guest") {
        runtime.sendP2pMessage({
          type: "drop_placebo",
          kartId: runtime.getKartId(this),
          x: dropX,
          y: dropY
        });
      }
    } else if (type === "doubleblind") {
      if (!isP2pBattleGuest()) game.hazards.push(new DoubleBlindCloud(this.x, this.y, this.heading, this));
      if (game.p2pMode && game.p2pRole === "guest") {
        runtime.sendP2pMessage({
          type: "double_blind_cloud",
          kartId: runtime.getKartId(this),
          x: this.x,
          y: this.y,
          heading: this.heading
        });
      }
    } else if (type === "dossier") {
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const spawnX = this.x + fx * 32;
      const spawnY = this.y + fy * 32;
      if (!isP2pBattleGuest()) {
        const d = new DossierProjectile(spawnX, spawnY, this.heading, this);
        game.hazards.push(d);
      }
      if (game.p2pMode && game.p2pRole === "guest") {
        runtime.sendP2pMessage({
          type: "shoot_dossier",
          kartId: runtime.getKartId(this),
          x: spawnX,
          y: spawnY,
          heading: this.heading
        });
      }
    } else if (type === "deauth") {
      if (isP2pBattleGuest()) {
        runtime.sendP2pMessage({
          type: "deauth_shockwave",
          kartId: runtime.getKartId(this),
          x: this.x,
          y: this.y
        });
      } else {
        runtime.applyDeauthShockwave(this);
        if (game.p2pMode && game.p2pRole === "guest") {
          runtime.sendP2pMessage({
            type: "deauth_shockwave",
            kartId: runtime.getKartId(this),
            x: this.x,
            y: this.y
          });
        }
      }
    } else if (type === "mergerequest") {
      if (isP2pBattleGuest()) {
        runtime.sendP2pMessage({ type: "merge_request", kartId: runtime.getKartId(this) });
        if (game.particles) {
          game.particles.add({
            type: "text",
            text: "MERGE REQUEST!",
            x: this.x,
            y: this.y - 22,
            vx: 0,
            vy: -0.8,
            life: 42,
            maxLife: 42,
            size: 14,
            color: "#39ff14"
          });
        }
        runtime.triggerQuote(this, "boost");
      } else {
        runtime.startMergeRequestPull(this);
      }
    } else if (type === "hotfix") {
      this.boostTimer = Math.max(this.boostTimer, TUNING.HOTFIX_DURATION);
      this.shieldTimer = Math.max(this.shieldTimer, TUNING.HOTFIX_DURATION);
      this.invuln = Math.max(this.invuln, TUNING.HOTFIX_DURATION);
      this.ultraBoostActive = true;
      runtime.triggerQuote(this, "boost");
    } else if (type === "fasttrack") {
      this.boostTimer = Math.max(this.boostTimer, TUNING.FAST_TRACK_DURATION);
      this.shieldTimer = Math.max(this.shieldTimer, TUNING.FAST_TRACK_DURATION);
      this.handlingTimer = Math.max(this.handlingTimer, TUNING.FAST_TRACK_DURATION);
      this.invuln = Math.max(this.invuln, TUNING.FAST_TRACK_DURATION);
      this.ultraBoostActive = true;
      runtime.triggerQuote(this, "boost");
    }
  }

  applyPhysics(input, track, dt, onSurface) {
    // Spinout state
    if (this.spinoutTimer > 0) {
      this.spinoutTimer -= dt;
      this.spinAngle += 0.3 * dt;

      // Battle: brief invulnerability the instant you recover, so a hit can't be chained to zero
      if (this.spinoutTimer <= 0 && isBattleMode()) {
        this.recoverGraceTimer = Math.max(this.recoverGraceTimer || 0, 48);
      }

      if (this.boostTimer > 0) this.boostTimer -= dt;
      if (this.citationBoostTimer > 0) this.citationBoostTimer -= dt;
      if (this.shieldTimer > 0) this.shieldTimer -= dt;
      if (this.handlingTimer > 0) this.handlingTimer -= dt;
      if (this.doubleBlindTimer > 0) this.doubleBlindTimer -= dt;
      if (this.placeboSlowTimer > 0) this.placeboSlowTimer -= dt;
      if (this.throttleLockTimer > 0) this.throttleLockTimer -= dt;
      if (this.amendmentTimer > 0) this.amendmentTimer -= dt;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.draftBoostTimer > 0) this.draftBoostTimer -= dt;

      this.vx *= Math.pow(0.92, dt);
      this.vy *= Math.pow(0.92, dt);

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      if (track.arenaFloor) {
        this.x = clamp(this.x, 30, WORLD_W - 30);
        this.y = clamp(this.y, 30, WORLD_H - 30);
        integrateKartVertical(this, dt);
        checkTrackRamps(this, track);
        constrainArenaKart(this, track);
      } else {
        const c = track.closestSegment(this.x, this.y);
        const seg = track.segments[c.idx];
        const wallLimit = seg.halfW + 70;
        if (c.dist > wallLimit) {
          const proj = c.proj;
          const nx = (this.x - proj.x) / Math.max(0.001, c.dist);
          const ny = (this.y - proj.y) / Math.max(0.001, c.dist);
          const push = c.dist - wallLimit;
          this.x -= nx * push;
          this.y -= ny * push;
        }
        integrateKartVertical(this, dt);
        checkTrackRamps(this, track);
        this.x = clamp(this.x, 30, WORLD_W - 30);
        this.y = clamp(this.y, 30, WORLD_H - 30);
      }

      return { drifting: false, onSurface };
    }

    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    const lx = -fy, ly = fx;

    // Decompose velocity
    let vF = this.vx * fx + this.vy * fy;
    let vL = this.vx * lx + this.vy * ly;

    // Throttle / brake
    const canThrottle = this.throttleLockTimer <= 0;
    if (input.forward && canThrottle) vF += this.acceleration * dt;
    else if (input.back) {
      if (vF > 0.05) vF -= this.brakeForce * dt;
      else vF = Math.max(-this.reverseMax, vF - this.acceleration * 0.65 * dt);
    } else {
      vF *= Math.pow(1 - this.friction, dt);
    }

    // Off-road slowdown
    let speedCapMul = 1;
    if (!onSurface && this.boostTimer <= 0) {
      vF *= Math.pow(0.965, dt);
      speedCapMul = 0.55;
    }

    // Speed cap (boost increases, drafting increases it slightly too)
    const powerMult = this.boostTimer > 0 ? 1.55 : (this.draftBoostTimer > 0 ? 1.25 : this.citationBoostTimer > 0 ? 1.12 : 1);
    const slowMult = this.placeboSlowTimer > 0 ? 0.72 : 1;
    const cap = this.maxSpeed * powerMult * slowMult * speedCapMul;
    if (vF > cap) vF = cap;
    if (vF < -this.reverseMax) vF = -this.reverseMax;

    // Lateral grip — drift reduces it for sliding, with continuous traction recovery
    const drifting = input.drift && Math.abs(vF) > 1.5;
    if (drifting) {
      this.gripRecovery = 0;
      vF *= Math.pow(TUNING.DRIFT_SPEED_RETENTION, dt);
    } else if (this.gripRecovery < 1.0) {
      this.gripRecovery = Math.min(1.0, this.gripRecovery + 0.08 * dt);
    }
    const grip = lerp(this.gripDrift, this.gripNormal, this.gripRecovery);
    vL *= Math.pow(1 - grip, dt);

    const steerInput = input.continuousSteer !== undefined
      ? clamp(input.continuousSteer, -1, 1)
      : (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (steerInput !== 0) {
      let speedFactor = clamp(Math.abs(vF) / 2.0, 0, 1);
      let turn = this.turnSpeed * speedFactor;
      if (drifting) turn *= TUNING.DRIFT_TURN_MULT;
      if (this.handlingTimer > 0) turn *= 1.25;
      if (this.amendmentTimer > 0) turn *= 0.68;
      if (this.doubleBlindTimer > 0) turn *= -0.85;
      // Reverse — steering inverts feel
      const sign = vF < -0.05 ? -1 : 1;
      this.heading += steerInput * turn * sign * dt;
    }

    // Drift mini-turbo charge
    if (drifting && steerInput !== 0 && Math.abs(vF) > 2) {
      if (this.driftDir === 0) this.driftDir = steerInput;
      if (this.driftDir === steerInput) {
        // Artur trailing desperation mechanic: 1.8x charging rate!
        let chargeAmt = dt * TUNING.DRIFT_CHARGE_RATE;
        if (this.charId === "artur") {
          const ranking = runtime.rankAll();
          const rank = ranking.indexOf(this) + 1;
          if (rank >= 3) {
            chargeAmt *= 1.8;
          }
        }
        this.driftCharge += chargeAmt;
      }

      // Drift sparks generation from rear wheels
      if (Math.random() < TUNING.DRIFT_SPARK_CHANCE * dt) {
        let sparkColor = null;
        if (this.driftCharge >= TUNING.DRIFT_TIER3) {
          sparkColor = pick(["#ff4d6d", "#7b75ff", "#ff00ff"]); // Purple/Pink (Tier 3)
        } else if (this.driftCharge >= TUNING.DRIFT_TIER2) {
          sparkColor = "#fd9927"; // Orange (Tier 2)
        } else if (this.driftCharge >= TUNING.DRIFT_TIER1) {
          sparkColor = "#00e5ff"; // Blue (Tier 1)
        }

        if (sparkColor) {
          for (const side of [-1, 1]) {
            const wx = this.x - fx * 10 + lx * side * 10;
            const wy = this.y - fy * 10 + ly * side * 10;
            game.particles.add({
              type: "spark",
              x: wx + rand(-3, 3),
              y: wy + rand(-3, 3),
              vx: -fx * rand(1.5, 3) + rand(-1, 1),
              vy: -fy * rand(1.5, 3) + rand(-1, 1),
              life: rand(10, 20),
              maxLife: 20,
              size: rand(2, 4.5),
              color: sparkColor,
              drag: 0.92
            });
          }
        }
      }
    } else {
      // Release drift -> boost if charged enough
      if (this.driftCharge >= TUNING.DRIFT_TIER1 && Math.abs(vF) > 2) {
        this.driftBoostCount = (this.driftBoostCount || 0) + 1;
        let boostTime = 0;
        let text = "";
        let color = "";

        if (this.driftCharge >= TUNING.DRIFT_TIER3) {
          boostTime = TUNING.DRIFT_BOOST_T3;
          text = "ULTRA TURBO!";
          color = "#ff4d6d";
          this.ultraBoostActive = true;
        } else if (this.driftCharge >= TUNING.DRIFT_TIER2) {
          boostTime = TUNING.DRIFT_BOOST_T2;
          text = "SUPER TURBO!";
          color = "#fd9927";
        } else {
          boostTime = TUNING.DRIFT_BOOST_T1;
          text = "MINI TURBO";
          color = "#00e5ff";
        }

        this.boostTimer = Math.max(this.boostTimer, boostTime);
        runtime.triggerQuote(this, "boost");

        // Add floaty text particle
        game.particles.add({
          type: "text",
          x: this.x,
          y: this.y - 20,
          vx: 0,
          vy: -0.8,
          life: 35,
          maxLife: 35,
          size: 12,
          color: color,
          text: text
        });

        // Instant drift-release traction alignment "snapback" screen shake & sound
        if (this.isPlayer) {
          bus.emit("kart:boost", { kart: this, driftRelease: true });
          game.flash = Math.max(game.flash, 8);
          game.shake = Math.max(game.shake, 4);
        }

        // Generate smoke puffs on drift release snapback
        for (let i = 0; i < 8; i++) {
          const ang = Math.random() * TAU;
          const sp = rand(1, 3);
          game.particles.add({
            type: "spark",
            x: this.x + rand(-6, 6),
            y: this.y + rand(-6, 6),
            vx: Math.cos(ang) * sp,
            vy: Math.sin(ang) * sp,
            life: rand(15, 30),
            maxLife: 30,
            size: rand(3, 6),
            color: "rgba(220, 220, 240, 0.6)",
            drag: 0.94
          });
        }
      }
      this.driftCharge = 0;
      this.driftDir = 0;
    }

    // Recompose velocity
    this.vx = vF * fx + vL * lx;
    this.vy = vF * fy + vL * ly;
    applyMergeRequestPull(this, dt);

    // Move
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // World clamp (soft)
    this.x = clamp(this.x, 30, WORLD_W - 30);
    this.y = clamp(this.y, 30, WORLD_H - 30);

    integrateKartVertical(this, dt);
    checkTrackRamps(this, track);

    // Wall (deep off-road) collision: clamp position back toward road / arena boundary
    if (track.arenaFloor) {
      constrainArenaKart(this, track);
    } else {
      const c = track.closestSegment(this.x, this.y);
      const seg = track.segments[c.idx];
      const wallLimit = seg.halfW + 70;       // hard wall offset
      if (c.dist > wallLimit) {
        const proj = c.proj;
        const nx = (this.x - proj.x) / Math.max(0.001, c.dist);
        const ny = (this.y - proj.y) / Math.max(0.001, c.dist);
        const push = c.dist - wallLimit;
        this.x -= nx * push;
        this.y -= ny * push;

        // Bounce / recoil: elastic bounce off the wall normal
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
          // Reflect velocity with 2.5x elasticity coefficient
          this.vx -= dot * nx * 2.5;
          this.vy -= dot * ny * 2.5;
          // Dampen non-normal velocity slightly to prevent sliding along wall
          this.vx *= 0.75;
          this.vy *= 0.75;
        } else {
          // Extra kick back onto track
          this.vx -= nx * 0.8 * dt;
          this.vy -= ny * 0.8 * dt;
        }

        if (performance.now() - this.lastBumpAt > 1100) {
          runtime.triggerQuote(this, "crash");
          this.lastBumpAt = performance.now();
          if (this.isPlayer) {
            Sound.bump();
            game.shake = Math.max(game.shake, 5);
          }
        }
      }
    }

    // Decay timers & roulette timer
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;

      // Generate pink exhaust flame trails if ultra boost is active
      if (this.ultraBoostActive) {
        if (Math.random() < 0.8 * dt) {
          game.particles.add({
            type: "spark",
            x: this.x - fx * 18 + rand(-4, 4),
            y: this.y - fy * 18 + rand(-4, 4),
            vx: -fx * rand(3, 5) + rand(-1, 1),
            vy: -fy * rand(3, 5) + rand(-1, 1),
            life: 15, maxLife: 15,
            size: rand(3, 5.5),
            color: pick(["#ff00ff", "#ff4d6d", "#ffffff"]),
            drag: 0.9
          });
        }
      }
    } else {
      this.ultraBoostActive = false;

      // Idle exhaust puffs when driving without boost
      if (Math.abs(vF) > 2.5 && Math.random() < 0.12 * dt) {
        game.particles.add({
          type: "spark",
          x: this.x - fx * 16 + rand(-2, 2),
          y: this.y - fy * 16 + rand(-2, 2),
          vx: -fx * rand(0.5, 1.5) + rand(-0.3, 0.3),
          vy: -fy * rand(0.5, 1.5) + rand(-0.3, 0.3),
          life: rand(12, 22),
          maxLife: 22,
          size: rand(2, 4),
          color: "rgba(180, 180, 200, 0.25)",
          drag: 0.96
        });
      }
    }

    if (this.citationBoostTimer > 0) this.citationBoostTimer -= dt;
    if (this.shieldTimer > 0) this.shieldTimer -= dt;
    if (this.handlingTimer > 0) this.handlingTimer -= dt;
    if (this.doubleBlindTimer > 0) this.doubleBlindTimer -= dt;
    if (this.placeboSlowTimer > 0) this.placeboSlowTimer -= dt;
    if (this.throttleLockTimer > 0) this.throttleLockTimer -= dt;
    if (this.amendmentTimer > 0) this.amendmentTimer -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.recoverGraceTimer > 0) this.recoverGraceTimer -= dt;
    if (this.mergePullVictimTimer > 0) this.mergePullVictimTimer -= dt;

    // Slipstream drafting search
    let isDraftingNow = false;
    const allKarts = getActiveKarts();
    for (const k of allKarts) {
      if (k === this || k.spinoutTimer > 0) continue;
      const d = dist(this.x, this.y, k.x, k.y);
      if (d < 160 && d > 12) {
        const dx = k.x - this.x;
        const dy = k.y - this.y;
        const angleToK = Math.atan2(dy, dx);
        const headingDiff = Math.abs(angleDiff(this.heading, angleToK));
        const directionDiff = Math.abs(angleDiff(this.heading, k.heading));

        if (headingDiff < 0.22 && directionDiff < 0.45) { // <12.5 deg and <25 deg
          isDraftingNow = true;
          break;
        }
      }
    }

    if (isDraftingNow) {
      this.draftTimer += dt;
      if (this.draftTimer >= 45) {
        this.draftTimer = 0;
        this.draftBoostTimer = 60;
        this.boostTimer = Math.max(this.boostTimer, 45); // short boost surge

        // Floaty SLIPSTREAM! text
        game.particles.add({
          type: "text",
          x: this.x,
          y: this.y - 20,
          vx: 0,
          vy: -0.8,
          life: 40,
          maxLife: 40,
          size: 13,
          color: "#00e5ff", // Electric Blue
          text: "SLIPSTREAM!"
        });

        if (this.isPlayer) {
          bus.emit("kart:boost", { kart: this });
          game.flash = Math.max(game.flash, 4);
        }
      }

      // Wind-tunnel blue overlay trails
      if (this.draftTimer > 15 && Math.random() < 0.5 * dt) {
        const side = Math.random() < 0.5 ? -1 : 1;
        game.particles.add({
          type: "line",
          x: this.x + lx * side * rand(6, 12) - fx * 15,
          y: this.y + ly * side * rand(6, 12) - fy * 15,
          vx: fx * rand(2, 4),
          vy: fy * rand(2, 4),
          life: 12,
          maxLife: 12,
          size: rand(1.5, 3),
          color: "rgba(0, 229, 255, 0.45)",
          drag: 0.95
        });
      }
    } else {
      this.draftTimer = Math.max(0, this.draftTimer - 0.4 * dt);
    }

    if (this.draftBoostTimer > 0) {
      this.draftBoostTimer -= dt;
    }

    if (this.itemState === "rolling") {
      this.itemRollTimer -= dt;
      if (this.itemRollTimer <= 0) {
        this.itemState = "active";
        let rolled = runtime.getWeightedItem(this);
        // Anti-frustration: don't hand the player the exact same item twice in a row.
        if (this.isPlayer && rolled === this.lastItemSlot) {
          const reroll = runtime.getWeightedItem(this);
          if (reroll !== this.lastItemSlot) rolled = reroll;
        }
        this.itemSlot = rolled;
        this.lastItemSlot = rolled;
        const RARE_ITEMS = { hotfix: 1, mergerequest: 1, deauth: 1 };
        const isRare = !!RARE_ITEMS[rolled];
        if (this.isPlayer && this.itemSlot) {
          const itemColor = { boost: "#fd9927", shield: "#57f2ff", handling: "#a4ff80", conflict: "#ff4d6d", placebo: "#ffcc00", doubleblind: "#bd57ff", dossier: "#57f2ff", deauth: "#ff3366", mergerequest: "#39ff14", hotfix: "#ffcc00", fasttrack: "#a4ff80" };
          const col = itemColor[this.itemSlot] || "#fff";
          this.itemNamePopup = { name: runtime.ITEM_NAMES[this.itemSlot] || this.itemSlot.toUpperCase(), color: col, timer: isRare ? 110 : 75, maxTimer: isRare ? 110 : 75 };
          if (isRare) {
            bus.emit("kart:itemPickup", { kart: this, type: "rareItem" });
            game.flash = Math.max(game.flash, 5);
            if (game.particles) game.particles.burst(this.x, this.y, col, 16, { spdMin: 1.5, spdMax: 4.5 });
          }
        }
        if (!this.isPlayer) {
          this.aiItemUseTimer = rand(60, 180);
        }
      }
    }
    if (this.itemNamePopup && this.itemNamePopup.timer > 0) this.itemNamePopup.timer -= dt;

    return { drifting, onSurface };
  }

  draw(ctx, time) {
    const profile = getVehicleProfile(this.charId);
    const style = profile.style || "generic";
    const z = this.z || 0;
    const zOff = kartVisualZOffset(this);
    const airScale = 1 + Math.min(z * 0.004, 0.12);
    const shadowScale = 1 - Math.min(z / 80, 0.45);
    const shadowAlpha = 0.35 * (1 - Math.min(z / 50, 0.7));
    const shadowRx = (profile.shadowRx || 18) * shadowScale;
    const shadowRy = (profile.shadowRy || 10) * shadowScale;

    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(this.x + 2, this.y + 4, shadowRx, shadowRy, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const spd = this.speed();
    const latV = this.vx * (-Math.sin(this.heading)) + this.vy * Math.cos(this.heading);
    const bob = clamp(Math.sin(time * 0.018 + this.heading) * spd * 0.06, -1.2, 1.2);
    const lean = clamp(latV * 0.05, -1.5, 1.5);
    const airBob = clamp(z * 0.015, 0, 1.5);

    ctx.save();
    ctx.translate(this.x, this.y - zOff - (bob + airBob) * 0.5);
    ctx.rotate(this.heading + lean * 0.025);
    if (airScale !== 1) ctx.scale(airScale, airScale);

    const frameCol = COMPASS_VISUAL.baseDark;
    const railCol = this.color;
    const panelCol = COMPASS_VISUAL.info;
    const panelHi = COMPASS_VISUAL.neutral;
    const noseCol = COMPASS_VISUAL.accent;
    const rearCol = COMPASS_VISUAL.primary;
    const halfL = (profile.length || 30) * 0.5;
    const halfW = (profile.width || 22) * 0.5;
    const hitR = profile.hitboxRadius || DEFAULT_KART_COLLISION_RADIUS;

    this._drawVehicleWheels(ctx, style, halfL, halfW);
    this._drawVehicleChassis(ctx, style, profile, {
      frameCol, railCol, panelCol, panelHi, noseCol, rearCol, halfL, halfW, bob, time,
    });
    this._drawVehicleCockpit(ctx, style, halfL, halfW);
    this._drawVehicleLights(ctx, style, halfL, halfW, time);
    this._drawVehicleFlourishes(ctx, style, bob, rearCol);

    if (this.ultReady) {
      const pulse = 0.4 + 0.4 * Math.sin(time * 0.015);
      ctx.strokeStyle = `rgba(255, 216, 107, ${pulse})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, hitR + 9, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.ultActiveTimer > 0) {
      const a = 0.5 + 0.3 * Math.sin(time * 0.025);
      ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, hitR + 6, 0, TAU);
      ctx.stroke();
    }
    if (this.shieldTimer > 0) {
      const a = 0.3 + 0.2 * Math.sin(time * 0.02);
      ctx.strokeStyle = `rgba(120, 220, 255, ${a + 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, hitR + 5, 0, TAU);
      ctx.stroke();
    }
    if (this.handlingTimer > 0) {
      ctx.strokeStyle = "rgba(160, 255, 160, 0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, hitR + 2, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();

    if (this.boostTimer > 0) this._drawFlame(ctx, time);
  }

  _drawVehicleWheels(ctx, style, halfL, halfW) {
    ctx.fillStyle = "#0a0a0a";
    if (style === "formula") {
      const fw = 5, fh = 3, rw = 5, rh = 3;
      ctx.fillRect(halfL - 6, -halfW - 1, fw, fh);
      ctx.fillRect(halfL - 6, halfW - fh + 1, fw, fh);
      ctx.fillRect(-halfL + 1, -halfW - 1, rw, rh);
      ctx.fillRect(-halfL + 1, halfW - rh + 1, rw, rh);
      ctx.fillStyle = "#222";
      ctx.fillRect(halfL - 5, -halfW, 2, 2);
      ctx.fillRect(halfL - 5, halfW - 2, 2, 2);
    } else if (style === "muscle") {
      ctx.fillRect(halfL - 8, -halfW + 1, 6, 3);
      ctx.fillRect(halfL - 8, halfW - 4, 6, 3);
      ctx.fillRect(-halfL + 2, -halfW - 2, 8, 4);
      ctx.fillRect(-halfL + 2, halfW - 2, 8, 4);
      ctx.fillStyle = "#333";
      ctx.fillRect(-halfL + 4, -halfW - 1, 3, 2);
      ctx.fillRect(-halfL + 4, halfW - 1, 3, 2);
    } else if (style === "compact") {
      ctx.fillRect(halfL - 5, -halfW + 3, 5, 2.5);
      ctx.fillRect(halfL - 5, halfW - 5.5, 5, 2.5);
      ctx.fillRect(-halfL + 2, -halfW + 3, 5, 2.5);
      ctx.fillRect(-halfL + 2, halfW - 5.5, 5, 2.5);
    } else if (style === "armored") {
      ctx.fillRect(halfL - 7, -halfW + 2, 7, 4);
      ctx.fillRect(halfL - 7, halfW - 6, 7, 4);
      ctx.fillRect(-halfL + 1, -halfW + 2, 7, 4);
      ctx.fillRect(-halfL + 1, halfW - 6, 7, 4);
    } else if (style === "coupe") {
      ctx.fillRect(halfL - 6, -halfW + 2, 6, 3);
      ctx.fillRect(halfL - 6, halfW - 5, 6, 3);
      ctx.fillRect(-halfL + 2, -halfW + 1, 7, 3.5);
      ctx.fillRect(-halfL + 2, halfW - 4.5, 7, 3.5);
    } else {
      ctx.fillRect(-12, -12, 7, 4);
      ctx.fillRect(-12, 8, 7, 4);
      ctx.fillRect(7, -12, 7, 4);
      ctx.fillRect(7, 8, 7, 4);
    }
  }

  _drawVehicleChassis(ctx, style, profile, colors) {
    const { frameCol, railCol, panelCol, panelHi, noseCol, rearCol, halfL, halfW, bob, time } = colors;

    if (style === "formula") {
      ctx.fillStyle = frameCol;
      ctx.beginPath();
      ctx.moveTo(-halfL + 2, -halfW + 2);
      ctx.lineTo(halfL - 4, -halfW + 4);
      ctx.lineTo(halfL, -4);
      ctx.lineTo(halfL, 4);
      ctx.lineTo(halfL - 4, halfW - 4);
      ctx.lineTo(-halfL + 2, halfW - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COMPASS_VISUAL.baseMuted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = railCol;
      ctx.fillRect(-halfL + 2, -halfW + 3, 2, halfW * 2 - 6);
      ctx.fillRect(halfL - 6, -halfW + 5, 2, halfW * 2 - 10);
      ctx.fillStyle = panelCol;
      this._roundRect(ctx, -halfL + 6, -halfW + 5, halfL * 1.1, halfW * 1.4, 3);
      ctx.fill();
      ctx.fillStyle = panelHi;
      this._roundRect(ctx, -halfL + 8, -halfW + 6, halfL * 0.8, 4, 2);
      ctx.fill();
      ctx.fillStyle = noseCol;
      ctx.fillRect(halfL - 2, -3, 3, 6);
      ctx.fillStyle = rearCol;
      ctx.fillRect(-halfL, -5, 2, 10);
      ctx.fillStyle = frameCol;
      ctx.fillRect(halfL - 1, -halfW - 2, 2, 3);
      ctx.fillRect(halfL - 1, halfW - 1, 2, 3);
      ctx.fillRect(-halfL - 1, -halfW - 1, 2, 3);
      ctx.fillRect(-halfL - 1, halfW - 2, 2, 3);
      ctx.fillStyle = frameCol;
      ctx.fillRect(-halfL - 2, -halfW - 3, halfW * 1.6, 2);
      ctx.fillRect(-halfL - 2, halfW + 1, halfW * 1.6, 2);
    } else if (style === "muscle") {
      ctx.fillStyle = frameCol;
      this._roundRect(ctx, -halfL + 1, -halfW + 1, halfL * 1.85, halfW * 2 - 2, 4);
      ctx.fill();
      ctx.strokeStyle = COMPASS_VISUAL.baseMuted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = railCol;
      ctx.fillRect(-halfL + 1, -halfW + 2, 3, halfW * 2 - 4);
      ctx.fillRect(halfL - 4, -halfW + 2, 3, halfW * 2 - 4);
      ctx.fillStyle = this._lighten(railCol, 0.15);
      ctx.fillRect(-halfL + 4, -halfW + 4, halfL * 1.2, halfW * 1.5);
      ctx.fill();
      ctx.fillStyle = panelCol;
      this._roundRect(ctx, -halfL + 6, -halfW + 5, halfL * 0.75, halfW * 1.2, 3);
      ctx.fill();
      ctx.fillStyle = this._darken(railCol, 0.35);
      ctx.fillRect(-halfL + 2, -6, 10, 12);
      ctx.fillRect(-halfL + 3, -4, 6, 8);
      ctx.fillStyle = noseCol;
      this._roundRect(ctx, halfL - 8, -5, 7, 10, 2);
      ctx.fill();
      ctx.fillStyle = rearCol;
      ctx.fillRect(-halfL, -halfW + 3, 3, halfW * 2 - 6);
      ctx.fillStyle = this._darken(frameCol, 0.2);
      ctx.fillRect(-halfL - 1, -halfW, 2, halfW * 2);
    } else if (style === "compact") {
      ctx.fillStyle = frameCol;
      this._roundRect(ctx, -halfL + 2, -halfW + 2, halfL * 1.7, halfW * 2 - 4, halfW - 2);
      ctx.fill();
      ctx.strokeStyle = COMPASS_VISUAL.baseMuted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = railCol;
      ctx.fillRect(-halfL + 3, -halfW + 3, 2, halfW * 2 - 6);
      ctx.fillRect(halfL - 5, -halfW + 3, 2, halfW * 2 - 6);
      ctx.fillStyle = panelCol;
      ctx.beginPath();
      ctx.ellipse(0, -1, halfL * 0.55, halfW * 0.55, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = panelHi;
      ctx.beginPath();
      ctx.ellipse(0, -3, halfL * 0.4, halfW * 0.35, 0, Math.PI, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(77,255,170,0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -halfW + 1, halfL * 0.75, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.fillStyle = noseCol;
      this._roundRect(ctx, halfL - 4, -4, 4, 8, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(77,255,170,0.45)";
      ctx.fillRect(-halfL + 6, -1, halfL, 1);
      ctx.fillRect(-halfL + 6, 0, halfL, 1);
    } else if (style === "armored") {
      ctx.fillStyle = frameCol;
      this._roundRect(ctx, -halfL + 1, -halfW + 1, halfL * 1.9, halfW * 2 - 2, 3);
      ctx.fill();
      ctx.strokeStyle = COMPASS_VISUAL.baseMuted;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = this._darken(railCol, 0.35);
      ctx.fillRect(-halfL, -halfW - 1, halfL * 2, 2);
      ctx.fillRect(-halfL, halfW - 1, halfL * 2, 2);
      ctx.fillStyle = railCol;
      ctx.fillRect(-halfL + 2, -halfW + 3, 3, halfW * 2 - 6);
      ctx.fillRect(halfL - 5, -halfW + 3, 3, halfW * 2 - 6);
      ctx.fillStyle = panelCol;
      this._roundRect(ctx, -halfL + 7, -halfW + 4, halfL * 1.1, halfW * 1.3, 2);
      ctx.fill();
      ctx.fillStyle = this._darken(frameCol, 0.15);
      ctx.fillRect(-halfL + 1, -halfW - 2, halfL * 1.8, 3);
      ctx.fillRect(-halfL + 4, -halfW - 4, halfL * 1.2, 2);
      ctx.fillRect(-halfL + 5, -halfW + 4, halfL * 1.5, 3);
      ctx.fillRect(-halfL + 5, halfW - 7, halfL * 1.5, 3);
      ctx.fillStyle = rearCol;
      ctx.fillRect(halfL - 2, -halfW + 2, 2, halfW * 2 - 4);
      ctx.fillStyle = "#888";
      ctx.fillRect(halfL - 1, -halfW + 4, 1, halfW * 2 - 8);
      ctx.fillRect(halfL - 1, -2, halfL * 0.35, 4);
      ctx.fillRect(halfL - 1, -halfW + 2, 2, 2);
      ctx.fillRect(halfL - 1, halfW - 4, 2, 2);
    } else if (style === "coupe") {
      ctx.fillStyle = frameCol;
      ctx.beginPath();
      ctx.moveTo(-halfL + 3, -halfW + 2);
      ctx.lineTo(halfL - 6, -halfW + 3);
      ctx.lineTo(halfL, -5);
      ctx.lineTo(halfL, 5);
      ctx.lineTo(halfL - 6, halfW - 3);
      ctx.lineTo(-halfL + 3, halfW - 2);
      ctx.lineTo(-halfL + 1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COMPASS_VISUAL.baseMuted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = railCol;
      ctx.fillRect(-halfL + 3, -halfW + 3, 2, halfW * 2 - 6);
      ctx.fillRect(halfL - 5, -halfW + 4, 2, halfW * 2 - 8);
      ctx.fillStyle = panelCol;
      this._roundRect(ctx, -halfL + 7, -halfW + 4, halfL * 0.85, halfW * 1.2, 4);
      ctx.fill();
      ctx.fillStyle = panelHi;
      this._roundRect(ctx, -halfL + 9, -halfW + 5, halfL * 0.6, 4, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(164,255,128,0.45)";
      ctx.fillRect(-halfL + 6, -1, halfL * 1.3, 2);
      ctx.fillStyle = noseCol;
      this._roundRect(ctx, halfL - 5, -4, 5, 8, 2);
      ctx.fill();
      ctx.fillStyle = rearCol;
      ctx.fillRect(-halfL, -halfW + 4, 2, halfW * 2 - 8);
      ctx.fillStyle = "#57f2ff";
      ctx.beginPath();
      ctx.moveTo(halfL - 6, 0); ctx.lineTo(halfL - 8, -2); ctx.lineTo(halfL - 10, 0); ctx.lineTo(halfL - 8, 2); ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = frameCol;
      this._roundRect(ctx, -15, -11, 30, 22, 5);
      ctx.fill();
      ctx.strokeStyle = COMPASS_VISUAL.baseMuted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = railCol;
      ctx.fillRect(-15, -10, 3, 20);
      ctx.fillRect(12, -10, 3, 20);
      ctx.fillStyle = panelCol;
      this._roundRect(ctx, -10, -8, 20, 16, 4);
      ctx.fill();
      ctx.fillStyle = panelHi;
      this._roundRect(ctx, -8, -6, 16, 5, 2);
      ctx.fill();
      ctx.fillStyle = noseCol;
      this._roundRect(ctx, 10, -5, 5, 10, 2);
      ctx.fill();
      ctx.fillStyle = rearCol;
      ctx.fillRect(-15, -8, 2, 16);
    }
  }

  _drawVehicleCockpit(ctx, style, halfL, halfW) {
    const cabinX = style === "muscle" ? -2 : style === "armored" ? -1 : -3;
    const cabinW = style === "compact" ? 7 : style === "armored" ? 10 : 8;
    const cabinH = style === "compact" ? 8 : style === "armored" ? 11 : 10;
    ctx.fillStyle = COMPASS_VISUAL.baseMid;
    this._roundRect(ctx, cabinX, -cabinH * 0.5, cabinW, cabinH, style === "compact" ? 4 : 3);
    ctx.fill();
    ctx.fillStyle = this._lighten(this.color, 0.45);
    ctx.beginPath();
    ctx.arc(cabinX + cabinW * 0.35, 0, style === "armored" ? 3.5 : 3, 0, TAU);
    ctx.fill();
  }

  _drawVehicleLights(ctx, style, halfL, halfW, time) {
    const headX = halfL - 1;
    const headlightBrightness = 0.8 + 0.2 * Math.sin(time * 0.008 + this.x * 0.01);
    ctx.fillStyle = `rgba(255, 245, 176, ${headlightBrightness})`;
    const headSize = style === "armored" ? 3 : 2;
    ctx.fillRect(headX, -6, headSize, headSize + 1);
    ctx.fillRect(headX, 6 - headSize - 1, headSize, headSize + 1);
    const tailX = -halfL;
    if (style !== "formula") {
      ctx.fillStyle = COMPASS_VISUAL.baseDark;
      ctx.fillRect(tailX - 1, -halfW + 2, 2, halfW * 2 - 4);
    }
    const isBraking = this.speed() < 1.5 || this.spinoutTimer > 0;
    const tailAlpha = isBraking ? 0.9 : 0.35;
    ctx.fillStyle = `rgba(255, 40, 40, ${tailAlpha})`;
    ctx.fillRect(tailX, -5, 2, 3);
    ctx.fillRect(tailX, 2, 2, 3);
  }

  _drawVehicleFlourishes(ctx, style, bob, rearCol) {
    if (style === "formula" || this.charId === "anton") {
      ctx.strokeStyle = "#aaa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-8, -10);
      ctx.lineTo(-12, -17 + bob * 0.3);
      ctx.stroke();
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.arc(-12, -17 + bob * 0.3, 2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,77,109,0.5)";
      ctx.fillRect(4, -2, 8, 1);
      ctx.fillRect(4, 1, 8, 1);
    } else if (style === "muscle" || this.charId === "artur") {
      ctx.fillStyle = "rgba(255,138,59,0.55)";
      ctx.beginPath();
      ctx.moveTo(-10, -10); ctx.lineTo(2, -8); ctx.lineTo(-4, -6); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-10, 10); ctx.lineTo(2, 8); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = this._darken(this.color, 0.3);
      ctx.fillRect(-4, -4, 5, 8);
    } else if (style === "compact" || this.charId === "rissal") {
      ctx.strokeStyle = "rgba(77,255,170,0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-14, -11); ctx.lineTo(14, -11);
      ctx.moveTo(-14, 11); ctx.lineTo(14, 11);
      ctx.stroke();
    } else if (style === "armored" || this.charId === "pia") {
      ctx.fillStyle = this._darken(this.color, 0.4);
      ctx.fillRect(-16, -12, 32, 2);
      ctx.fillRect(-16, 10, 32, 2);
      ctx.fillStyle = rearCol;
      ctx.fillRect(15, -8, 2, 16);
    } else if (style === "coupe" || this.charId === "florian") {
      ctx.fillStyle = "rgba(164,255,128,0.45)";
      ctx.fillRect(-10, -1, 20, 2);
      ctx.fillStyle = "#57f2ff";
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(6, -2); ctx.lineTo(4, 0); ctx.lineTo(6, 2); ctx.closePath();
      ctx.fill();
    }
  }

  _drawFlame(ctx, time) {
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    const baseX = this.x - fx * 16, baseY = this.y - fy * 16;
    for (let i = 0; i < 3; i++) {
      const len = 22 + Math.sin(time * 0.05 + i) * 6 + i * 4;
      const w = 8 - i * 2;
      const tipX = baseX - fx * len + (-fy * (i - 1) * 2);
      const tipY = baseY - fy * len + (fx * (i - 1) * 2);
      ctx.fillStyle = i === 0 ? "rgba(255,80,40,0.9)" : i === 1 ? "rgba(255,180,40,0.85)" : "rgba(255,250,180,0.8)";
      ctx.beginPath();
      ctx.moveTo(baseX + fy * w, baseY - fx * w);
      ctx.lineTo(baseX - fy * w, baseY + fx * w);
      ctx.lineTo(tipX, tipY);
      ctx.closePath();
      ctx.fill();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _lighten(hex, t) {
    const c = this._parseHex(hex);
    return `rgb(${Math.round(lerp(c[0], 255, t))},${Math.round(lerp(c[1], 255, t))},${Math.round(lerp(c[2], 255, t))})`;
  }
  _darken(hex, t) {
    const c = this._parseHex(hex);
    return `rgb(${Math.round(lerp(c[0], 0, t))},${Math.round(lerp(c[1], 0, t))},${Math.round(lerp(c[2], 0, t))})`;
  }
  _parseHex(h) {
    if (h.startsWith("rgb")) {
      const m = h.match(/\d+/g); return [+m[0], +m[1], +m[2]];
    }
    let s = h.replace("#", "");
    if (s.length === 3) s = s.split("").map(c => c + c).join("");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  update(dt, track, allKarts) {
    if (this.eliminated) return;
    const ctrl = this.getControls(dt, track, allKarts);
    if (!ctrl) return;
    const { input, onRoad } = ctrl;
    const r = this.runPhysics(input, track, dt, onRoad);
    this.postPhysicsEffects(dt, track, r, onRoad);
    this.afterUpdate(dt, track, allKarts);
  }

  getControls(dt, track, allKarts) {
    const onRoad = track.isOnRoad(this.x, this.y);
    return { input: { forward: false, back: false, left: false, right: false, drift: false }, onRoad };
  }

  afterUpdate(dt, track, allKarts) {}

  prepareSpeedModifier(track, allKarts) {
    return null;
  }

  runPhysics(input, track, dt, onRoad) {
    const mod = this.prepareSpeedModifier(track, null);
    if (mod) {
      const origMaxSpeed = this.maxSpeed;
      const origAcceleration = this.acceleration;
      this.maxSpeed *= mod.speedMult;
      this.acceleration *= mod.accelMult;
      const r = this.applyPhysics(input, track, dt, onRoad);
      this.maxSpeed = origMaxSpeed;
      this.acceleration = origAcceleration;
      return r;
    }
    return this.applyPhysics(input, track, dt, onRoad);
  }

  postPhysicsEffects(dt, track, r, onRoad) {
    this._driftTimer = r.drifting
      ? Math.max(this._driftTimer || 0, 2)
      : Math.max(0, (this._driftTimer || 0) - dt);

    if (!onRoad && this.speed() > 1.0) {
      if (!this.offRoadAudioTimer) this.offRoadAudioTimer = 0;
      this.offRoadAudioTimer -= dt;
      if (this.offRoadAudioTimer <= 0) {
        this.offRoadAudioTimer = rand(8, 16);
        Sound.spatialNoise(this.x, this.y, 0.10, 0.04, 700);
      }
      if (Math.random() < 0.4 * dt) {
        const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
        const lx = -fy, ly = fx;
        for (const side of [-1, 1]) {
          game.particles.add({
            type: "rect",
            x: this.x - fx * 12 + lx * side * 6 + rand(-2, 2),
            y: this.y - fy * 12 + ly * side * 6 + rand(-2, 2),
            vx: -fx * rand(1.5, 3.5) + rand(-1, 1),
            vy: -fy * rand(1.5, 3.5) + rand(-1, 1),
            life: rand(15, 30),
            maxLife: 30,
            size: rand(3, 6),
            angle: rand(0, TAU),
            spin: rand(-0.2, 0.2),
            color: pick(["#00ff66", "#adff2f", "#39ff14", "rgba(0, 255, 102, 0.4)"]),
            drag: 0.92
          });
        }
      }
    }

    const skidCfg = this.isPlayer
      ? { speedMin: 1.5, emitInterval: 1.5, life: 220, col: "rgba(20,20,30,0.6)", rissalCol: "rgba(104, 255, 157, 0.75)" }
      : { speedMin: 1.8, emitInterval: 1.8, life: 180, col: "rgba(20,20,30,0.5)", rissalCol: "rgba(104, 255, 157, 0.7)" };

    this.skidEmitTimer -= dt;
    if (r.drifting && Math.abs(this.forwardSpeed()) > skidCfg.speedMin && this.skidEmitTimer <= 0) {
      this.skidEmitTimer = skidCfg.emitInterval;
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const lx = -fy, ly = fx;
      for (const side of [-1, 1]) {
        let col = skidCfg.col;
        if (this.charId === "rissal") col = skidCfg.rissalCol;
        runtime.pushSkidMark({
          x: this.x - fx * 10 + lx * side * 7,
          y: this.y - fy * 10 + ly * side * 7,
          life: skidCfg.life, maxLife: skidCfg.life, size: this.charId === "rissal" ? 5 : 4,
          color: col
        });
      }
    }

    if (this.boostTimer > 0) {
      if (this.isPlayer) {
        if (Math.random() < 0.6 * dt) {
          const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
          game.particles.add({
            type: "spark",
            x: this.x - fx * 18 + rand(-4, 4),
            y: this.y - fy * 18 + rand(-4, 4),
            vx: -fx * rand(2, 4) + rand(-1, 1),
            vy: -fy * rand(2, 4) + rand(-1, 1),
            life: 18, maxLife: 18,
            size: rand(2.5, 4.5),
            color: pick(["#ff4020", "#ff8a20", "#ffd860"]),
            drag: 0.9,
          });
        }
        if (Math.random() < 0.5 * dt) {
          const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
          game.particles.add({
            type: "line",
            x: this.x - fx * 15 + rand(-8, 8),
            y: this.y - fy * 15 + rand(-8, 8),
            vx: -fx * rand(4, 7), vy: -fy * rand(4, 7),
            life: 15, maxLife: 15,
            size: rand(1.5, 3),
            color: this.color,
            drag: 0.95
          });
        }
      } else if (Math.random() < 0.25 * dt) {
        const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
        game.particles.add({
          type: "line",
          x: this.x - fx * 15 + rand(-6, 6),
          y: this.y - fy * 15 + rand(-6, 6),
          vx: -fx * rand(3, 6), vy: -fy * rand(3, 6),
          life: 12, maxLife: 12,
          size: rand(1, 2),
          color: this.color,
          drag: 0.95
        });
      }
    }
  }

}
