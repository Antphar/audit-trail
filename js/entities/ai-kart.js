import { TUNING } from "../config/tuning.js";
import {
  TAU, lerp, clamp, dist, angleDiff, rand,
} from "../core/math.js";
import {
  game,
  isBattleMode,
  getActiveKarts,
  getKartById,
} from "../core/state.js";
import { Kart } from "./kart.js";
import { runtime } from "./runtime.js";

export class AIKart extends Kart {
  constructor(x, y, heading, char, skill = 1.0) {
    super(x, y, heading, char, false);
    this.skill = skill;
    this.maxSpeed = this.baseMaxSpeed * (0.91 + skill * 0.1);
    this.acceleration = char.acceleration * (0.92 + skill * 0.08);
    this.turnSpeed = char.turnSpeed * (0.92 + skill * 0.08);
    this.aiTargetIdx = 1;
    this.aiNoise = rand(0, 100);
    this.lateralOffset = rand(-0.45, 0.45);
    this.itemTimer = rand(120, 360);
  }

  getControls(dt, track, allKarts) {

    const isOpen = !!track.isOpen;

    if (isOpen) {
      if (this.aiTargetIdx < this.nextCheckpoint) this.aiTargetIdx = this.nextCheckpoint;
      this.aiTargetIdx = Math.min(this.aiTargetIdx, track.n - 1);
    } else {
      const diffCheck = (this.nextCheckpoint - this.aiTargetIdx + track.n) % track.n;
      if (diffCheck !== 0 && diffCheck !== track.n - 1) {
        this.aiTargetIdx = this.nextCheckpoint;
      }
    }

    const target = track.waypoints[this.aiTargetIdx];
    const nextIdx = isOpen ? Math.min(this.aiTargetIdx + 1, track.n - 1) : (this.aiTargetIdx + 1) % track.n;
    const next = track.waypoints[nextIdx];

    const segIdx = isOpen ? Math.max(0, this.aiTargetIdx - 1) : (this.aiTargetIdx - 1 + track.n) % track.n;
    const seg = track.segments[Math.min(segIdx, track.segments.length - 1)];
    const segHalfW = seg.halfW;
    const lookAheadBlend = clamp(segHalfW / 120, 0.10, 0.35);
    let aimX = lerp(target.x, next.x, lookAheadBlend) + seg.nx * (this.lateralOffset * (segHalfW * 0.45));
    let aimY = lerp(target.y, next.y, lookAheadBlend) + seg.ny * (this.lateralOffset * (segHalfW * 0.45));

    this._battleTarget = null;
    this._battleTargetDist = Infinity;
    if (isBattleMode()) {
      let bd = Infinity, bt = null;
      for (const k of getActiveKarts()) {
        if (k === this || k.eliminated || k.finished) continue;
        const d = dist(this.x, this.y, k.x, k.y);
        if (d < bd) { bd = d; bt = k; }
      }
      if (bt) {
        this._battleTarget = bt;
        this._battleTargetDist = bd;
        aimX = lerp(aimX, bt.x, 0.62);
        aimY = lerp(aimY, bt.y, 0.62);
      }
    }

    const currentWP = track.waypoints[(this.aiTargetIdx - 1 + track.n) % track.n];
    const farWP = track.waypoints[(this.aiTargetIdx + 1) % track.n];
    const ang1 = Math.atan2(target.y - currentWP.y, target.x - currentWP.x);
    const ang2 = Math.atan2(farWP.y - target.y, farWP.x - target.x);
    const curvature = Math.abs(angleDiff(ang1, ang2));

    const speed = this.forwardSpeed();
    let brakeTarget = false;
    let forceEarlyDrift = false;

    if (curvature > 0.42 && speed > this.maxSpeed * 0.65) {
      brakeTarget = true;
      if (curvature > 0.6) forceEarlyDrift = true;
    }

    let steerAdj = 0;
    const lookDist = 160;
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    const lx = -fy, ly = fx;

    let bestBoost = null;
    let bestBoostScore = Infinity;
    for (const pad of game.track.boostPads || []) {
      const dx = pad.x - this.x;
      const dy = pad.y - this.y;
      const localForward = dx * fx + dy * fy;
      const localLateral = Math.abs(dx * lx + dy * ly);
      if (localForward > 35 && localForward < 520 && localLateral < Math.max(130, seg.halfW * 1.25)) {
        const score = localForward + localLateral * 2.2;
        if (score < bestBoostScore) { bestBoostScore = score; bestBoost = pad; }
      }
    }
    if (bestBoost && curvature < 0.75) {
      aimX = lerp(aimX, bestBoost.x, 0.72);
      aimY = lerp(aimY, bestBoost.y, 0.72);
    }

    const obstacles = [
      ...(game.hazards || []).map(h => ({ x: h.x, y: h.y, r: h.r || 15, isHazard: true })),
      ...(game.track.movingObjects || []).map(o => ({ x: o.x, y: o.y, r: o.r || 24, isHazard: true })),
      ...(game.track.regulatoryDragon ? [{ x: game.track.regulatoryDragon.x, y: game.track.regulatoryDragon.y, r: game.track.regulatoryDragon.r || 70, isHazard: true }] : []),
      ...(isBattleMode() ? [] : getActiveKarts().filter(k => k !== this).map(k => ({ x: k.x, y: k.y, r: runtime.getKartCollisionRadius(k), isHazard: false })))
    ];

    for (const obs of obstacles) {
      const d = dist(this.x, this.y, obs.x, obs.y);
      if (d < lookDist && d > 10) {
        const rx = obs.x - this.x;
        const ry = obs.y - this.y;
        const localForward = rx * fx + ry * fy;
        const localLateral = rx * lx + ry * ly;
        if (localForward > 5 && localForward < lookDist) {
          const clearDist = obs.r + 14;
          if (Math.abs(localLateral) < clearDist) {
            const dodgeDir = localLateral >= 0 ? -1 : 1;
            const weight = (1 - localForward / lookDist) * 0.55;
            steerAdj += dodgeDir * weight;
            if (localForward < 60 && Math.abs(localLateral) < obs.r) brakeTarget = true;
          }
        }
      }
    }

    const desired = Math.atan2(aimY - this.y, aimX - this.x);
    const diff = angleDiff(this.heading, desired) + steerAdj;
    const sharp = Math.abs(diff) > 0.55;
    const onRoad = track.isOnRoad(this.x, this.y);

    const input = {
      forward: !brakeTarget,
      back: false,
      left: diff < -0.04,
      right: diff > 0.04,
      drift: (sharp || forceEarlyDrift) && Math.abs(this.forwardSpeed()) > 2.5,
    };

    if (Math.abs(diff) > 1.0 && this.forwardSpeed() > this.maxSpeed * 0.8) {
      input.forward = false;
    }

    // Strategic AI Item Decision engine
    if (this.itemState === "active" && this.itemSlot) {
      let shouldUse = false;
      const rank = runtime.rankAll().indexOf(this) + 1;

      if (isBattleMode()) {
        const td = this._battleTargetDist;
        const OFFENSIVE = { dossier: 1, deauth: 1, conflict: 1, mergerequest: 1, hotfix: 1 };
        if (OFFENSIVE[this.itemSlot]) {
          shouldUse = td < 260;
        } else if (this.itemSlot === "boost" || this.itemSlot === "fasttrack") {
          shouldUse = td > 200 || td === Infinity;
        } else if (this.itemSlot === "shield" || this.itemSlot === "handling") {
          shouldUse = td < 170;
        } else {
          shouldUse = Math.random() < 0.01 * dt;
        }
      } else if (this.itemSlot === "conflict") {
        const rearLookDist = 180;
        let playerBehind = false;
        for (const k of getActiveKarts()) {
          if (k === this) continue;
          const d = dist(this.x, this.y, k.x, k.y);
          if (d < rearLookDist) {
            const rx = k.x - this.x;
            const ry = k.y - this.y;
            const localForward = rx * fx + ry * fy;
            const localLateral = rx * lx + ry * ly;
            if (localForward < 0 && localForward > -rearLookDist && Math.abs(localLateral) < 40) {
              playerBehind = true;
              break;
            }
          }
        }
        if (playerBehind || Math.random() < 0.005 * dt) shouldUse = true;
      } else if (this.itemSlot === "dossier") {
        const frontLookDist = 250;
        let playerAhead = false;
        for (const k of getActiveKarts()) {
          if (k === this) continue;
          const d = dist(this.x, this.y, k.x, k.y);
          if (d < frontLookDist) {
            const rx = k.x - this.x;
            const ry = k.y - this.y;
            const localForward = rx * fx + ry * fy;
            const localLateral = rx * lx + ry * ly;
            if (localForward > 0 && localForward < frontLookDist && Math.abs(localLateral) < 40) {
              playerAhead = true;
              break;
            }
          }
        }
        if (playerAhead || Math.random() < 0.005 * dt) shouldUse = true;
      } else if (this.itemSlot === "placebo" || this.itemSlot === "doubleblind") {
        shouldUse = rank <= 3 || Math.random() < 0.01 * dt;
      } else if (this.itemSlot === "boost" || this.itemSlot === "handling" || this.itemSlot === "fasttrack") {
        if (curvature < 0.25) shouldUse = true;
      } else if (this.itemSlot === "shield") {
        if (rank <= 2 || Math.random() < 0.02 * dt) shouldUse = true;
      } else if (this.itemSlot === "deauth") {
        shouldUse = getActiveKarts().some(k => k !== this && !k.finished && dist(this.x, this.y, k.x, k.y) < 150);
      } else if (this.itemSlot === "mergerequest") {
        shouldUse = rank > 1 && curvature < 0.35;
      } else if (this.itemSlot === "hotfix") {
        shouldUse = true;
      }

      if (shouldUse) this.useItem();
    }

    if (this.ultReady && this.ultActiveTimer <= 0) {
      const aiRank = runtime.rankAll().indexOf(this) + 1;
      const useChance = aiRank >= 3 ? 0.015 : aiRank >= 2 ? 0.008 : 0.004;
      if (Math.random() < useChance * dt) {
        runtime.activateUltimate(this);
      }
    }
    if (this.ultActiveTimer > 0) this.ultActiveTimer -= dt;

    this._aiSegHalfW = segHalfW;
    this._aiTarget = target;
    return { input, onRoad };
  }

  prepareSpeedModifier(track) {
    const isOpen = !!track.isOpen;
    let leadHumanProgress = runtime.progressValue(game.player);
    if (game.multiplayer && game.player2) {
      leadHumanProgress = Math.max(leadHumanProgress, runtime.progressValue(game.player2));
    }
    const myProgress = runtime.progressValue(this);
    let diffProgress = leadHumanProgress - myProgress;
    if (isOpen) diffProgress = clamp(diffProgress / 200, -5, 5);
    let rubberbandSpeedMult = 1.0;
    if (diffProgress > 0) {
      rubberbandSpeedMult = 1.0 + Math.min(0.22, diffProgress * 0.07);
    } else if (diffProgress < 0) {
      rubberbandSpeedMult = Math.max(0.82, 1.0 + diffProgress * 0.06);
    }
    return { speedMult: rubberbandSpeedMult, accelMult: rubberbandSpeedMult };
  }

  afterUpdate(dt, track) {
    const isOpen = !!track.isOpen;
    const target = this._aiTarget;
    const segHalfW = this._aiSegHalfW;
    if (!target) return;
    const advanceRadius = Math.max(55, segHalfW * 1.4);
    if (dist(this.x, this.y, target.x, target.y) < advanceRadius) {
      if (isOpen) {
        this.aiTargetIdx = Math.min(this.aiTargetIdx + 1, track.n - 1);
      } else {
        this.aiTargetIdx = (this.aiTargetIdx + 1) % track.n;
      }
      this.lateralOffset = rand(-0.5, 0.5);
    }
  }
}
