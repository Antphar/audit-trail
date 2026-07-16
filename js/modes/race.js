import { TUNING } from "../config/tuning.js";
import { CHARACTERS, DEFAULT_KART_COLLISION_RADIUS, getVehicleProfile } from "../config/characters.js";
import { MAPS, clampAiCount, regenerateDragonTrail } from "../config/maps.js";
import { clamp, dist, len2d, rand, pointSegProjection, pick, lerp, angleDiff } from "../core/math.js";
import { simRandom } from "../core/rng.js";
import { simNow } from "../core/clock.js";
import { bus } from "../core/events.js";
import {
  STATE, game, isBattleMode, isGrandPrixActive, getActiveKarts,
  isP2pBattleGuest, isP2pBattleHost, canResolveBattleCombat,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { runtime } from "../entities/runtime.js";
import { getMapRecord, updateMapRecord } from "../core/settings.js";
import {
  ParticleSystem, pushSkidMark,
} from "../entities/particles.js";
import {
  MergeConflict, PlaceboPill, DoubleBlindCloud, RegulatoryProjectile,
  DossierProjectile, DragonFire, resetHazardIdCounter,
} from "../entities/items.js";
import { Track, WORLD_W, WORLD_H } from "../entities/track.js";
import {
  Kart, isKartAirborne, isKartGrounded, integrateKartVertical,
  constrainArenaKart, checkTrackRamps, applyMergeRequestPull,
} from "../entities/kart.js";
import { PlayerKart } from "../entities/player-kart.js";
import { AIKart } from "../entities/ai-kart.js";
import {
  initBattleKartState, triggerQuote, triggerHitFlash, registerBattleHit,
  eliminateKart, tryApprovalRam, absorbFatalHitWithShield,
} from "./battle.js";

export const AI_DIFFICULTIES = { easy: 0.86, normal: 1.0, hard: 1.12 };
export const BATTLE_ARENA_ID = "battle_arena";

export function normalizeAiDifficulty(v) {
  return Object.prototype.hasOwnProperty.call(AI_DIFFICULTIES, v) ? v : "normal";
}

export function getKartCollisionRadius(kart) {
  if (!kart) return DEFAULT_KART_COLLISION_RADIUS;
  const id = kart.charId != null ? kart.charId : kart;
  const profile = getVehicleProfile(id);
  const r = profile.hitboxRadius;
  return Number.isFinite(r) ? r : DEFAULT_KART_COLLISION_RADIUS;
}

export function kartPickupThreshold(baseThreshold, kart) {
  return baseThreshold + getKartCollisionRadius(kart) - DEFAULT_KART_COLLISION_RADIUS;
}

export function getRayObjectRadius(obj, defaultRadius) {
  if (obj && obj.charId != null) return getKartCollisionRadius(obj);
  return obj.r || defaultRadius;
}
export function isGroundHazardImmuneWhenAirborne(h) {
  return (h instanceof MergeConflict) || (h instanceof PlaceboPill) || (h instanceof DoubleBlindCloud);
}

export function shouldSkipGroundHazardForKart(kart, h) {
  if (!isKartAirborne(kart)) return false;
  if (h instanceof DossierProjectile || h instanceof RegulatoryProjectile || h instanceof DragonFire) return false;
  return isGroundHazardImmuneWhenAirborne(h);
}
export function isDragonEscape() { return MAPS[game.selectedMapIdx || 0].id === "dragon_escape"; }
export function gridSlot(i) {
  return { f: -5 - 40 * i, l: (i % 2 === 0 ? -28 : 28) };
}
export function buildRaceSim() {
  game.track = new Track();
  game.particles = new ParticleSystem();
  game.skidMarks = [];
  game.shake = 0;
  game.flash = 0;
  game.coinsCollected = 0;
  game.finishOrder = [];
  game.finishScheduled = false;
  game.hazards = []; // Initialize active physical hazard block elements!
  game.dragonTimer = 0;
  game.dragonFireTimer = 0;
  game.dragonWarnTimer = 60; // First warning after about 1 second
  game.dragonEscape = null;
  game.p2pLastPickupSyncAt = 0;
  game.p2pLastHostSyncAt = 0;
  game.p2pLastGuestSyncAt = 0;
  game.p2pLastHazardSyncAt = 0;
  resetHazardIdCounter();

  const mapConfig = MAPS[game.selectedMapIdx || 0];
  const mapId = mapConfig.id;

  // Line up karts on starting grid (across from start line)
  const seg0 = game.track.segments[0];
  const ang = Math.atan2(seg0.dy, seg0.dx);
  const sx = seg0.a.x + seg0.dx * 0.04;
  const sy = seg0.a.y + seg0.dy * 0.04;
  const lx = -Math.sin(ang), ly = Math.cos(ang);
  const fx = Math.cos(ang), fy = Math.sin(ang);

  game.ais = [];
  game.player2 = null;
  game.remotePlayers = [];
  game.p2pKartById = {};

  const playerChar = CHARACTERS[game.selectedCharIdx || 0];

  if (game.p2pMode && game.p2pPlayers && game.p2pPlayers.length) {
    const racePlayers = game.p2pPlayers.slice(0, 8);
    racePlayers.forEach((p, idx) => {
      const pos = gridSlot(idx);
      const x = sx + fx * pos.f + lx * pos.l;
      const y = sy + fy * pos.f + ly * pos.l;
      const char = CHARACTERS[p.charIdx || 0];
      const kart = new PlayerKart(x, y, ang, char, p.id === game.p2pLocalId ? 1 : 2);
      kart.p2pId = p.id;
      game.p2pKartById[p.id] = kart;
      if (p.id === game.p2pLocalId) {
        game.player = kart;
      } else if (!game.player2) {
        game.player2 = kart;
      } else {
        game.remotePlayers.push(kart);
      }
    });

    if (racePlayers.length < 4) {
      const usedChars = new Set(racePlayers.map(p => p.charIdx || 0));
      const aiChars = CHARACTERS.filter((_, idx) => !usedChars.has(idx));
      const aiSkills = [0.95, 0.97, 0.99];
      for (let i = racePlayers.length; i < 4; i++) {
        const pos = gridSlot(i);
        const x = sx + fx * pos.f + lx * pos.l;
        const y = sy + fy * pos.f + ly * pos.l;
        game.ais.push(new AIKart(x, y, ang, aiChars[i - racePlayers.length] || CHARACTERS[(i + 1) % CHARACTERS.length], aiSkills[i - racePlayers.length] || 0.96));
      }
    }

    game.totalRacers = racePlayers.length + game.ais.length;
  } else if (game.multiplayer) {
    const player2Char = CHARACTERS[game.selectedCharIdx2 !== undefined ? game.selectedCharIdx2 : 1];

    const p1pos = gridSlot(0);
    const p1x = sx + fx * p1pos.f + lx * p1pos.l;
    const p1y = sy + fy * p1pos.f + ly * p1pos.l;
    game.player = new PlayerKart(p1x, p1y, ang, playerChar, 1);

    const p2pos = gridSlot(1);
    const p2x = sx + fx * p2pos.f + lx * p2pos.l;
    const p2y = sy + fy * p2pos.f + ly * p2pos.l;
    game.player2 = new PlayerKart(p2x, p2y, ang, player2Char, 2);

    let aiChars = CHARACTERS.filter((_, idx) => idx !== (game.selectedCharIdx || 0) && idx !== (game.selectedCharIdx2 || 0));
    if (aiChars.length < 2) {
      aiChars = CHARACTERS.filter((_, idx) => idx !== (game.selectedCharIdx || 0));
    }
    const diffMult2p = AI_DIFFICULTIES[runtime.aiDifficulty || 'normal'] || 1.0;
    const aiSkills = [0.96 * diffMult2p, 0.98 * diffMult2p];

    const ai0pos = gridSlot(2);
    const ai0_x = sx + fx * ai0pos.f + lx * ai0pos.l;
    const ai0_y = sy + fy * ai0pos.f + ly * ai0pos.l;
    game.ais.push(new AIKart(ai0_x, ai0_y, ang, aiChars[0] || CHARACTERS[2], aiSkills[0]));

    const ai1pos = gridSlot(3);
    const ai1_x = sx + fx * ai1pos.f + lx * ai1pos.l;
    const ai1_y = sy + fy * ai1pos.f + ly * ai1pos.l;
    game.ais.push(new AIKart(ai1_x, ai1_y, ang, aiChars[1] || CHARACTERS[3], aiSkills[1]));

    game.totalRacers = 2 + game.ais.length;
  } else {
    game.player2 = null;

    const p0pos = gridSlot(0);
    const px = sx + fx * p0pos.f + lx * p0pos.l;
    const py = sy + fy * p0pos.f + ly * p0pos.l;
    game.player = new PlayerKart(px, py, ang, playerChar, 1);

    const aiChars = CHARACTERS.filter((_, idx) => idx !== (game.selectedCharIdx || 0));
    const baseSkills = [0.95, 0.97, 0.99, 1.01];
    const diffMult = AI_DIFFICULTIES[runtime.aiDifficulty || 'normal'] || 1.0;
    const n = clampAiCount(runtime.aiCount ?? 4);
    for (let idx = 0; idx < n; idx++) {
      const pos = gridSlot(idx + 1);
      const x = sx + fx * pos.f + lx * pos.l;
      const y = sy + fy * pos.f + ly * pos.l;
      game.ais.push(new AIKart(x, y, ang, aiChars[idx % aiChars.length], baseSkills[idx] * diffMult));
    }

    runtime.applySelectedAiModelToOpponents?.();
    game.totalRacers = 1 + game.ais.length;
  }

  if (mapId === "dragon_escape") {
    game.dragonEscape = createDragonEscapeEntity();
  }

  if (isBattleMode()) {
    initBattleKartState();
  }

  // Camera centered on player
  game.cam.x = game.player.x;
  game.cam.y = game.player.y;
  game.cam.scale = 1;

}
export function startRaceSim() {
  game.state = STATE.RACING;
  game.startTime = simNow();
  if (game.p2pMode && game.p2pRole === "guest") {
    game.p2pLastHostSyncReceivedAt = performance.now();
  }
  game.p2pConnectionUnstable = false;
  for (const k of getActiveKarts()) {
    if (!k) continue;
    k.lapTimes = [];
    k.lastLapAt = game.startTime;
  }
  game.newRecord = null;
  game.mapRecordCache = (!game.multiplayer && !isDragonEscape() && !isBattleMode())
    ? getMapRecord(MAPS[game.selectedMapIdx || 0].id)
    : null;
}

export function applyRocketStart() {
  const applyToKart = (kart, rs) => {
    if (!kart || !rs.holding) return;
    // holdStart is when they began holding gas (ms into countdown)
    // Countdown: 0-900 = "3", 900-1800 = "2", 1800-2700 = "1", 2700+ = "GO!"
    // Perfect window: started holding during "2" phase (900-1800ms)
    // Good window: started holding during early "1" phase (1800-2200ms)
    // Burnout: held from "3" phase (before 900ms) -- too early, tires spin out
    const hs = rs.holdStart;
    if (hs < 900) {
      // Burnout: held gas too early through the whole countdown
      kart.spinoutTimer = Math.max(kart.spinoutTimer, 40);
      kart.spinAngle = 0;
      triggerQuote(kart, "crash");
      if (kart.isPlayer) {
        Sound.crash();
        game.shake = Math.max(game.shake, 6);
        triggerHitFlash("BURNOUT!", "#ff4d6d", 70, kart);
      }
      game.particles.burst(kart.x, kart.y, "#ff4d6d", 20, { spdMin: 2, spdMax: 5 });
      game.particles.add({
        type: "text", text: "BURNOUT!", x: kart.x, y: kart.y - 30,
        vx: 0, vy: -1, life: 55, maxLife: 55, size: 18, color: "#ff4d6d", drag: 0.98
      });
    } else if (hs >= 900 && hs <= 2200) {
      // Rocket start: perfect or good timing
      const isPerfect = hs >= 1400 && hs <= 1900;
      const boostDur = isPerfect ? 90 : 55;
      kart.boostTimer = Math.max(kart.boostTimer, boostDur);
      if (isPerfect) kart.ultraBoostActive = true;
      triggerQuote(kart, "boost");
      if (kart.isPlayer) {
        bus.emit("kart:boost", { kart });
        game.shake = Math.max(game.shake, isPerfect ? 8 : 4);
        game.flash = Math.max(game.flash, isPerfect ? 6 : 3);
      }
      const label = isPerfect ? "ROCKET START!" : "BOOST START!";
      const col = isPerfect ? "#ffd86b" : "#a4ff80";
      game.particles.burst(kart.x, kart.y, col, isPerfect ? 28 : 16, { spdMin: 2, spdMax: 6 });
      game.particles.add({
        type: "text", text: label, x: kart.x, y: kart.y - 30,
        vx: 0, vy: -1, life: 60, maxLife: 60, size: isPerfect ? 20 : 16, color: col, drag: 0.98
      });
    }
    // If hs > 2200 (started holding during late "1" or "GO!"), no bonus, no penalty
  };
  applyToKart(game.player, game.rocketStartP1);
  if (game.multiplayer && game.player2) applyToKart(game.player2, game.rocketStartP2);

  // Reset state
  game.rocketStartP1 = { holdStart: 0, holding: false, result: null };
  game.rocketStartP2 = { holdStart: 0, holding: false, result: null };
}
const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

function tournamentKey(kart) {
  return kart.p2pId || (kart.isPlayer ? "p" + (kart.playerIndex || 1) : "ai_" + kart.charId);
}

function getNextCircuitMapIdx(fromIdx) {
  let idx = fromIdx;
  for (let i = 0; i < MAPS.length; i++) {
    idx = (idx + 1) % MAPS.length;
    const m = MAPS[idx];
    if (!m.arena && m.id !== "dragon_escape") return idx;
  }
  return fromIdx;
}

function applyTournamentPoints(ranking) {
  if (!game.tournament) return;
  ranking.forEach((kart, i) => {
    const key = tournamentKey(kart);
    let entry = game.tournament.standings.find((s) => s.key === key);
    if (!entry) {
      entry = { key, name: kart.name, charId: kart.charId, isLocalHuman: kart === game.player, points: 0 };
      game.tournament.standings.push(entry);
    } else {
      entry.name = kart.name;
      entry.charId = kart.charId;
    }
    entry.points += GP_POINTS[i] || 0;
  });
  game.tournament.standings.sort((a, b) => b.points - a.points);
}
export function areAllHumansDone() {
  const humans = getActiveKarts().filter(k => k && k.isPlayer);
  return humans.length > 0 && humans.every(k => k.finished || k.eliminated);
}

export function finishRaceSim() {
  if (game.state === STATE.FINISHED) return;
  game.state = STATE.FINISHED;
  game.raceFinishedAt = simNow();

  // Stop continuous engine, drift, and rumble sounds

  // Build finish order from progress. Eliminated racers are ranked behind anyone still alive.
  const all = getActiveKarts();
  const finished = game.finishOrder.filter(k => k && !k.eliminated); // already in finish order
  const eliminated = all.filter(k => k.eliminated && !finished.includes(k));
  const unfinished = all.filter(k => !k.finished && !k.eliminated);
  unfinished.sort((a, b) => {
    if (isBattleMode()) {
      const da = (b.approvals || 0) - (a.approvals || 0);
      if (da !== 0) return da;
      // Battle tie-break: balloons popped beats race progress (progress is a racing concept).
      const ds = (b.battleSteals || 0) - (a.battleSteals || 0);
      if (ds !== 0) return ds;
    }
    return progressValue(b) - progressValue(a);
  });
  eliminated.sort((a, b) => {
    const survivalDelta = (b.finishTime || 0) - (a.finishTime || 0);
    if (Math.abs(survivalDelta) > 0.001) return survivalDelta;
    return progressValue(b) - progressValue(a);
  });
  for (const k of unfinished) finished.push(k);
  for (const k of eliminated) finished.push(k);
  game.finalRanking = finished;
  if (isGrandPrixActive(game.tournament)) {
    if (!game.p2pMode || game.p2pRole === "host") {
      applyTournamentPoints(game.finalRanking);
    }
  }
}

export function progressValue(k) {
  if (!k) return 0;
  if (game.track.isOpen) {
    return k.x;
  }
  const checkpointCount = game.track.checkpointCount || game.track.n;
  const targetIdx = k.nextCheckpoint % checkpointCount;
  const prevIdx = (k.nextCheckpoint - 1 + checkpointCount) % checkpointCount;
  const target = game.track.checkpointCenter(targetIdx);
  const prev = game.track.checkpointCenter(prevIdx);
  if (!target || !prev) return k.lap * checkpointCount + k.checkpointsThisLap;
  const proj = pointSegProjection(k.x, k.y, prev.x, prev.y, target.x, target.y);
  return k.lap * checkpointCount + k.checkpointsThisLap + clamp(proj.t, 0, 1);
}

export function rankAll() {
  const all = getActiveKarts();
  const sorted = all.slice().sort((a, b) => {
    if (a.eliminated || b.eliminated) {
      if (a.eliminated && !b.eliminated) return 1;
      if (b.eliminated && !a.eliminated) return -1;
      const survivalDelta = (b.finishTime || 0) - (a.finishTime || 0);
      if (Math.abs(survivalDelta) > 0.001) return survivalDelta;
      return progressValue(b) - progressValue(a);
    }
    if (a.finished && !b.finished) return -1;
    if (b.finished && !a.finished) return 1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (isBattleMode()) {
      const da = (b.approvals || 0) - (a.approvals || 0);
      if (da !== 0) return da;
      // Battle tie-break: balloons popped beats race progress (progress is a racing concept).
      const ds = (b.battleSteals || 0) - (a.battleSteals || 0);
      if (ds !== 0) return ds;
    }
    return progressValue(b) - progressValue(a);
  });
  return sorted;
}

export const ITEM_NAMES = {
  boost: "TURBO BOOST",
  shield: "COMPLIANCE SHIELD",
  handling: "HANDLING+",
  conflict: "MERGE CONFLICT",
  placebo: "PLACEBO PILL",
  doubleblind: "DOUBLE BLIND",
  dossier: "DOSSIER",
  deauth: "DE-AUTH PULSE",
  mergerequest: "MERGE REQUEST",
  hotfix: "HOTFIX DEPLOY",
  fasttrack: "FAST TRACK"
};

export function getWeightedItem(kart) {
  const rankings = rankAll();
  const totalKarts = rankings.length;
  const rank = rankings.indexOf(kart) + 1;
  const posRatio = totalKarts > 1 ? (rank - 1) / (totalKarts - 1) : 0;

  const weights = {
    boost:        8 + posRatio * 22,
    shield:       12 - posRatio * 4,
    handling:     10,
    conflict:     14 - posRatio * 9,
    placebo:      10 - posRatio * 5,
    doubleblind:  8 + posRatio * 3,
    dossier:      12 - posRatio * 4,
    deauth:       9 - posRatio * 5,
    mergerequest: 4 + posRatio * 20,
    hotfix:       posRatio >= 0.6 ? (posRatio * 22) : 0,
    fasttrack:    posRatio >= 0.4 ? (posRatio * 14) : 1
  };

  const entries = Object.entries(weights);
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = simRandom() * totalWeight;
  for (const [item, w] of entries) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return "boost";
}

export function completeClosedCircuitLap(kart) {
  kart.lap++;
  const now = simNow();
  if (kart.lastLapAt) {
    kart.lapTimes.push((now - kart.lastLapAt) / 1000);
  }
  kart.lastLapAt = now;
  triggerQuote(kart, "lap");
  if (kart.isPlayer) {
    bus.emit("race:lapCompleted", { kart, isFinalLap: kart.lap === runtime.getTotalLaps() - 1 && !isDragonEscape() });
  }
  if (kart.isPlayer && kart.lap === runtime.getTotalLaps() - 1 && !isDragonEscape()) {
    triggerHitFlash("FINAL LAP!", "#ffd86b", 120, kart);
    game.shake = Math.max(game.shake, 6);
    game.flash = Math.max(game.flash, 8);
  }
  if (isBattleMode()) {
    // In battle there is no lap-based finish; laps just loop around the arena.
    return;
  }
  if (kart.lap >= runtime.getTotalLaps()) {
    kart.finished = true;
    kart.finishTime = (simNow() - game.startTime) / 1000;
    if (!game.finishOrder.includes(kart)) game.finishOrder.push(kart);
    if (kart === game.player && !isDragonEscape() && !game.multiplayer) {
      const bestLapThisRun = kart.lapTimes.length ? Math.min(...kart.lapTimes) : 0;
      game.newRecord = updateMapRecord(MAPS[game.selectedMapIdx || 0].id, {
        total: kart.finishTime,
        lap: bestLapThisRun,
      });
    }
    if (kart.isPlayer) {
      const colors = ["#ff4d6d", "#a4ff80", "#7b75ff", "#ffd86b", "#00f0ff"];
      for (let i = 0; i < 75; i++) {
        const ang = simRandom() * Math.PI * 2;
        const sp = rand(3, 10);
        game.particles.add({
          type: "rect", x: kart.x, y: kart.y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: rand(45, 90), maxLife: 90, size: rand(6, 13),
          color: colors[Math.floor(simRandom() * colors.length)],
          drag: 0.95, angle: simRandom() * Math.PI * 2, spin: rand(-0.15, 0.15),
        });
      }
      game.slowMoEnd = simNow() + 1500;
      let allHumanFinished = true;
      if (game.player && !game.player.finished) allHumanFinished = false;
      if (game.multiplayer && game.player2 && !game.player2.finished) allHumanFinished = false;
      if (allHumanFinished) setTimeout(() => runtime.finishRace(), 1500);
    }
  }
}

export function checkProgress(kart) {
  if (kart.finished) return;
  const open = game.track.isOpen;
  const checkpointCount = game.track.checkpointCount || game.track.n;
  const checkpointIdx = open ? Math.min(kart.nextCheckpoint, checkpointCount - 1) : (kart.nextCheckpoint % checkpointCount);
  let hitCheckpoint = false;
  const completingLapAtGoalLine = !open && checkpointIdx === 0 && kart.checkpointsThisLap >= checkpointCount - 1;

  if (completingLapAtGoalLine) {
    hitCheckpoint = game.track.crossedStartLine(kart.progressPrevX, kart.progressPrevY, kart.x, kart.y)
      || game.track.hitCheckpoint(checkpointIdx, kart.x, kart.y);
  } else if (game.track.hitCheckpoint(checkpointIdx, kart.x, kart.y)) {
    hitCheckpoint = true;
  } else if (open && !game.track.hasCustomCheckpoints) {
    const cs = game.track.closestSegment(kart.x, kart.y);
    const openSeg = game.track.segments[kart.nextCheckpoint];
    const openMaxDist = openSeg ? openSeg.halfW + 30 : 140;
    if (cs.dist < openMaxDist && cs.idx === kart.nextCheckpoint) {
      hitCheckpoint = true;
    }
  }

  if (!hitCheckpoint && !open && !game.track.hasCustomCheckpoints && !completingLapAtGoalLine) {
    const cs = game.track.closestSegment(kart.x, kart.y);
    const cpSeg = game.track.segments[kart.nextCheckpoint];
    const maxDist = cpSeg ? cpSeg.halfW + 20 : 100;
    if (cs.dist < maxDist && cs.idx === kart.nextCheckpoint) {
      hitCheckpoint = true;
    }
  }

  if (hitCheckpoint) {
    kart.nextCheckpoint++;
    kart.checkpointsThisLap++;

    if (open) {
      // Lap milestone every 30 checkpoints (Battle has no laps — checkpoints only steer the AI).
      if (kart.checkpointsThisLap >= 30) {
        if (!isBattleMode()) {
          kart.lap++;
          triggerQuote(kart, "lap");
          if (kart.isPlayer) {
            bus.emit("race:lapCompleted", { kart, isFinalLap: false });
            game.bestLap = Math.max(game.bestLap || 0, kart.lap);
          }
        }
        kart.checkpointsThisLap = 0;
      }
      // End-of-trail safety (shouldn't happen)
      if (kart.nextCheckpoint >= checkpointCount) {
        kart.nextCheckpoint = checkpointCount - 1;
      }
    } else {
      // Closed circuit: final checkpoint arms the lap, the goal-line crossing completes it.
      // In Battle we still loop nextCheckpoint (so AI keeps circling) but never count a lap.
      if (kart.nextCheckpoint >= checkpointCount) {
        kart.nextCheckpoint = 0;
      } else if (kart.nextCheckpoint === 1 && kart.checkpointsThisLap >= checkpointCount) {
        if (!isBattleMode()) completeClosedCircuitLap(kart);
        kart.checkpointsThisLap = 0;
      }
    }
  }

  kart.progressPrevX = kart.x;
  kart.progressPrevY = kart.y;
}

/* ============================================================
   ITEMS — collisions & rewards
   ============================================================ */
export function checkItems(kart) {
  if (!isKartGrounded(kart)) return;
  // Coins
  for (let i = 0; i < game.track.coins.length; i++) {
    const c = game.track.coins[i];
    if (c.collected) {
      if (c.respawn > 0) {
        c.respawn--;
        if (c.respawn <= 0) c.collected = false;
      }
      continue;
    }
    if (dist(kart.x, kart.y, c.x, c.y) < kartPickupThreshold(18, kart)) {
      c.collected = true;
      c.respawn = 700;
      kart.coinsCollected++;
      runtime.requestP2pPickup("coin", i, kart);

      if (!kart.ultReady) {
        kart.ultCharge = Math.min(kart.ultCharge + 1, TUNING.ULTIMATE_COINS_NEEDED);
        if (kart.ultCharge >= TUNING.ULTIMATE_COINS_NEEDED) {
          kart.ultReady = true;
          if (kart.isPlayer) {
            Sound.tone(880, 0.15, "triangle", 0.18, 1760);
            Sound.tone(1320, 0.12, "sine", 0.12, 1760);
            game.particles.add({
              type: "text", text: "ULTIMATE READY!", x: kart.x, y: kart.y - 34,
              vx: 0, vy: -1.0, life: 70, maxLife: 70, size: 20, color: "#ffd86b", drag: 0.98,
            });
            game.particles.burst(kart.x, kart.y, "#ffd86b", 24, { type: "spark", spdMin: 2, spdMax: 5 });
          }
        }
      }

      if (kart.isPlayer) {
        bus.emit("kart:itemPickup", { kart, type: "coin" });
        game.particles.burst(c.x, c.y, "#ffd86b", 10, { type: "spark" });
        const chargeText = kart.ultReady ? "ULT READY" : `${kart.ultCharge}/${TUNING.ULTIMATE_COINS_NEEDED}`;
        game.particles.add({
          type: "text", text: "+1 REF", x: c.x, y: c.y - 10,
          vx: 0, vy: -1.2, life: 40, maxLife: 40, size: 14, color: "#ffd86b", drag: 1,
        });
        if (game.viewMode === "3d") runtime.emit3DItemPickupBurst?.(c.x, c.y, "coin");
      }
    }
  }

  // Boost pads
  for (const p of game.track.boostPads) {
    if (dist(kart.x, kart.y, p.x, p.y) < kartPickupThreshold(28, kart)) {
      const now = simNow();
      const last = p.cooldown.get(kart) || 0;
      if (now - last > 1100) {
        p.cooldown.set(kart, now);
        kart.boostTimer = Math.max(kart.boostTimer, 60);
        if (kart.isPlayer) {
          bus.emit("kart:boost", { kart });
          game.flash = Math.max(game.flash, 6);
          game.particles.burst(kart.x, kart.y, "#ffd86b", 14, { type: "spark", spdMin: 2, spdMax: 5 });
          if (game.viewMode === "3d") runtime.emit3DItemPickupBurst?.(kart.x, kart.y, "boost");
        }
      }
    }
  }

  // Item boxes
  for (let i = 0; i < game.track.itemBoxes.length; i++) {
    const b = game.track.itemBoxes[i];
    if (!b.active) {
      b.respawn--;
      if (b.respawn <= 0) b.active = true;
      continue;
    }
    if (dist(kart.x, kart.y, b.x, b.y) < kartPickupThreshold(24, kart)) {
      b.active = false;
      b.respawn = 240;
      runtime.requestP2pPickup("itemBox", i, kart);

      // Mario Kart-style Item Slot Roulette trigger
      if (kart.itemState === "empty") {
        kart.itemState = "rolling";
        kart.itemRollTimer = TUNING.ITEM_ROLL_TIME;

        if (kart.isPlayer) {
          bus.emit("kart:itemPickup", { kart, type: "itembox" });
          game.particles.burst(b.x, b.y, "#ff66cc", 18, { type: "spark", spdMin: 2, spdMax: 5 });
          if (game.viewMode === "3d") runtime.emit3DItemPickupBurst?.(b.x, b.y, "itemBox");
        }
      }
    }
  }
}

/* ============================================================
   KART vs KART COLLISION
   ============================================================ */
export function kartCollisions() {
  const all = getActiveKarts();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (isKartAirborne(a) || isKartAirborne(b)) continue;
      const rA = getKartCollisionRadius(a);
      const rB = getKartCollisionRadius(b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = len2d(dx, dy);
      if (d < rA + rB && d > 0.001) {
        const overlap = rA + rB - d;
        const nx = dx / d, ny = dy / d;

        // Weight-based position resolution: heavier kart pushes more, moves less
        const totalW = a.weight + b.weight;
        const wa = b.weight / totalW;
        const wb = a.weight / totalW;

        a.x -= nx * overlap * wa;
        a.y -= ny * overlap * wa;
        b.x += nx * overlap * wb;
        b.y += ny * overlap * wb;

        // Velocity exchange
        const va = a.vx * nx + a.vy * ny;
        const vb = b.vx * nx + b.vy * ny;
        const transfer = (vb - va) * 0.55;

        // Apply weight ratio to velocity exchange
        let tfA = transfer * (b.weight / totalW);
        let tfB = transfer * (a.weight / totalW);

        // Apply Pia's savage 2.5x ramming multiplier
        let piaMult = 1.0;
        if (a.charId === "pia" || b.charId === "pia") {
          piaMult = 2.5;
          tfA *= piaMult;
          tfB *= piaMult;
        }

        a.vx += nx * tfA; a.vy += ny * tfA;
        b.vx -= nx * tfB; b.vy -= ny * tfB;

        // Dampen slightly
        a.vx *= 0.93; a.vy *= 0.93;
        b.vx *= 0.93; b.vy *= 0.93;

        // Artur Prayer Protocol: touching opponents spins them out
        if (a.charId === "artur" && a.ultActiveTimer > 0 && b.spinoutTimer <= 0) {
          b.spinoutTimer = Math.max(b.spinoutTimer, 35);
          b.spinAngle = 0;
          b.lastAttacker = a; b.lastAttackerAt = game.raceTime;
          registerBattleHit(a);
          game.particles.burst(b.x, b.y, "#ff8a3b", 18, { type: "spark", spdMin: 2, spdMax: 5 });
        } else if (b.charId === "artur" && b.ultActiveTimer > 0 && a.spinoutTimer <= 0) {
          a.spinoutTimer = Math.max(a.spinoutTimer, 35);
          a.spinAngle = 0;
          a.lastAttacker = b; a.lastAttackerAt = game.raceTime;
          registerBattleHit(b);
          game.particles.burst(a.x, a.y, "#ff8a3b", 18, { type: "spark", spdMin: 2, spdMax: 5 });
        }

        // High-speed ram: whoever is charging into the other spins them out (transfer in Battle).
        const arturUlt = (a.charId === "artur" && a.ultActiveTimer > 0) || (b.charId === "artur" && b.ultActiveTimer > 0);
        if (!arturUlt) {
          if (!tryApprovalRam(a, b, nx, ny)) tryApprovalRam(b, a, -nx, -ny);
        }

        // Trigger collision quotes — with rivalry awareness
        triggerQuote(a, "collide", b);
        triggerQuote(b, "collide", a);

        const now = simNow();
        if ((a.isPlayer || b.isPlayer) && now - Math.max(a.lastBumpAt, b.lastBumpAt) > 280) {
          Sound.bump();
          a.lastBumpAt = b.lastBumpAt = now;
          game.shake = Math.max(game.shake, 3 * piaMult);
          // Explode particles at the contact point
          const px = (a.x + b.x) / 2;
          const py = (a.y + b.y) / 2;
          game.particles.burst(px, py, "#ffffff", 8, { type: "spark", spdMin: 2, spdMax: 5 });
        }
      }
    }
  }
}
export function getDragonTarget() {
  const humans = getActiveHumanKarts();
  if (!humans.length) return null;
  return humans.slice().sort((a, b) => progressValue(a) - progressValue(b))[0];
}

export function createDragonEscapeEntity() {
  const target = getDragonTarget() || game.player;
  const heading = target ? target.heading : 0;
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  return {
    x: target ? target.x - fx * 520 : 0,
    y: target ? target.y - fy * 520 : WORLD_H * 0.5,
    vx: 0,
    vy: 0,
    heading,
    jawPhase: 0,
    wingPhase: 0,
    enraged: false,
    active: true
  };
}

export function updateDragonEscapeEntity(dt) {
  if (!isDragonEscape()) {
    game.dragonEscape = null;
    return;
  }
  if (!game.dragonEscape) game.dragonEscape = createDragonEscapeEntity();
  const dragon = game.dragonEscape;
  const target = getDragonTarget();
  if (!dragon || !target || game.state !== STATE.RACING) return;

  const fx = Math.cos(target.heading);
  const fy = Math.sin(target.heading);
  const lx = -fy;
  const ly = fx;
  const intensity = Math.max(clamp(game.raceTime / 90, 0, 1), clamp(game.raceTime / 150, 0, 1));
  dragon.enraged = intensity > 0.45;

  const gap = lerp(360, 210, intensity);
  const lateral = Math.sin(game.raceTime * 1.25) * lerp(95, 55, intensity);
  const desiredX = target.x - fx * gap + lx * lateral;
  const desiredY = target.y - fy * gap + ly * lateral;
  const chaseLerp = 1 - Math.pow(0.952 - intensity * 0.018, dt);

  dragon.vx = (desiredX - dragon.x) * chaseLerp;
  dragon.vy = (desiredY - dragon.y) * chaseLerp;
  dragon.x += dragon.vx;
  dragon.y += dragon.vy;
  dragon.heading = Math.atan2(target.y - dragon.y, target.x - dragon.x);
  dragon.jawPhase += (dragon.enraged ? 0.24 : 0.16) * dt;
  dragon.wingPhase += (dragon.enraged ? 0.12 : 0.08) * dt;
}
export function showMovingObstacleHit(kart, obj, label, color, size = 17) {
  if (kart.isPlayer) triggerHitFlash(label, color, 75, kart);
  game.particles.burst(obj.x, obj.y, color, 24, { type: "spark", spdMin: 2, spdMax: 6 });
  game.particles.add({
    type: "text",
    text: label,
    x: obj.x,
    y: obj.y - 28,
    vx: 0,
    vy: -1.0,
    life: 52,
    maxLife: 52,
    size,
    color,
    drag: 0.98
  });
}

export function applyMovingObstacleHit(kart, obj) {
  const d = Math.max(0.001, dist(kart.x, kart.y, obj.x, obj.y));
  const nx = (kart.x - obj.x) / d;
  const ny = (kart.y - obj.y) / d;
  const color = obj.color || "#57f2ff";
  const label = obj.hitLabel || "BLACK ICE!";
  const kind = obj.kind || "blackice";

  if (kind === "signoff" && (kart.boostTimer > 0 || kart.shieldTimer > 0 || kart.invuln > 0)) {
    kart.shieldTimer = 0;
    kart.boostTimer = Math.max(kart.boostTimer, 42);
    kart.vx += Math.cos(kart.heading) * 4.2;
    kart.vy += Math.sin(kart.heading) * 4.2;
    kart.ultraBoostActive = true;
    showMovingObstacleHit(kart, obj, "APPROVED!", color, 18);
    if (kart.isPlayer) {
      bus.emit("kart:boost", { kart });
      game.flash = Math.max(game.flash, 5);
    }
    return;
  }

  if (kart.shieldTimer > 0) {
    kart.shieldTimer = 0;
    game.particles.burst(kart.x, kart.y, "#78dcff", 18, { type: "spark", spdMin: 1.5, spdMax: 4 });
    showMovingObstacleHit(kart, obj, "SHIELD BLOCK!", "#78dcff", 15);
    return;
  }

  if (kind === "amend") {
    const side = Math.sign(Math.sin(obj.phase)) || 1;
    kart.vx += obj.nx * side * 6.0 + nx * 1.5;
    kart.vy += obj.ny * side * 6.0 + ny * 1.5;
    kart.amendmentTimer = Math.max(kart.amendmentTimer || 0, 90);
    triggerQuote(kart, "crash");
    showMovingObstacleHit(kart, obj, label, color, 17);
    if (kart.isPlayer) {
      Sound.tone(420, 0.12, "triangle", 0.12, 260);
      game.shake = Math.max(game.shake, 4);
    }
    return;
  }

  if (kind === "clause") {
    kart.throttleLockTimer = Math.max(kart.throttleLockTimer || 0, 45);
    kart.vx *= 0.72;
    kart.vy *= 0.72;
    showMovingObstacleHit(kart, obj, label, color, 17);
    if (kart.isPlayer) {
      Sound.tone(720, 0.10, "square", 0.10, 180);
      game.flash = Math.max(game.flash, 4);
    }
    return;
  }

  if (kind === "redline") {
    kart.doubleBlindTimer = Math.max(kart.doubleBlindTimer || 0, 75);
    kart.spinoutTimer = Math.max(kart.spinoutTimer, 16);
    kart.spinAngle = 0;
    kart.vx = nx * 4.2;
    kart.vy = ny * 4.2;
    triggerQuote(kart, "crash");
    showMovingObstacleHit(kart, obj, label, color, 19);
    if (kart.isPlayer) {
      Sound.noise(0.16, 0.08, 700);
      game.shake = Math.max(game.shake, 6);
    }
    return;
  }

  kart.spinoutTimer = Math.max(kart.spinoutTimer, kind === "signoff" ? 50 : 38);
  kart.spinAngle = 0;
  kart.vx = nx * (kind === "signoff" ? 7.0 : 5.5);
  kart.vy = ny * (kind === "signoff" ? 7.0 : 5.5);
  triggerQuote(kart, "crash");
  showMovingObstacleHit(kart, obj, label, color, kind === "signoff" ? 18 : 16);
  if (kart.isPlayer) {
    Sound.bump();
    game.shake = Math.max(game.shake, kind === "signoff" ? 8 : 5);
  }
}