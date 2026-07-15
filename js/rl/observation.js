import { TUNING } from "../config/tuning.js";
import { clamp, dist, angleDiff } from "../core/math.js";
import { game, STATE, isBattleMode, getActiveKarts } from "../core/state.js";
import { rlRuntime } from "./rl-runtime.js";

// Mode-agnostic "self" features shared by every agent (race + arena/battle).
// Kept as an identical PREFIX of both observation vectors so a battle policy can
// optionally warm-start from a race trunk later (transfer learning).
export const HEADLESS_BASE_SELF_KEYS = [
  "speed",
  "forwardSpeed",
  "onRoad",
  "driftCharge",
  "boostActive",
  "spinout",
  "carMaxSpeed",
  "carAcceleration",
  "carTurnSpeed",
  "carWeight",
  "carGripNormal",
  "carGripDrift",
  "citationCount",
  "ultimateCharge",
  "shieldActive",
  "invulnActive",
  "doubleBlind",
  "placeboSlow",
  "mergePulling",
  "mergeTethered",
];
// Race-only navigation tail (checkpoint targeting).
export const HEADLESS_RACE_TAIL_KEYS = [
  "headingError",
  "targetDistance",
  "lateralOffset",
  "nextHeadingError",
  "nextTargetDistance",
];
// Arena/Battle-only combat tail: own lives, field state, and the 3 nearest rivals.
export const HEADLESS_BATTLE_RIVAL_COUNT = 3;
export const HEADLESS_BATTLE_TAIL_KEYS = ["ownApprovals", "survivorsFraction", "battleTimeLeft", "ramOpportunity"];
for (let i = 0; i < HEADLESS_BATTLE_RIVAL_COUNT; i++) {
  HEADLESS_BATTLE_TAIL_KEYS.push(`rival${i}Bearing`, `rival${i}Distance`, `rival${i}Approvals`, `rival${i}Spinning`);
}
export const HEADLESS_RAY_ANGLES_DEG = [-90, -60, -35, -15, 0, 15, 35, 60, 90];
export const HEADLESS_RAY_ANGLES = HEADLESS_RAY_ANGLES_DEG.map(deg => deg * Math.PI / 180);
export const HEADLESS_RAY_RANGE = 760;
export const HEADLESS_RAY_STEP = 28;
export const HEADLESS_ITEM_TYPES = ["boost", "shield", "handling", "conflict", "placebo", "doubleblind", "dossier", "deauth", "mergerequest", "hotfix", "fasttrack"];
// Base = shared self features + rays + item slot flags (identical for both modes).
export const HEADLESS_BASE_OBS_KEYS = [...HEADLESS_BASE_SELF_KEYS];
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`roadRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`kartRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`hazardRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`pickupRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`boosterRay${deg}`);
for (const item of HEADLESS_ITEM_TYPES) HEADLESS_BASE_OBS_KEYS.push(`item:${item}`);
// Full per-mode vectors: base prefix + mode-specific tail.
export const HEADLESS_OBS_KEYS = [...HEADLESS_BASE_OBS_KEYS, ...HEADLESS_RACE_TAIL_KEYS];
export const HEADLESS_BATTLE_OBS_KEYS = [...HEADLESS_BASE_OBS_KEYS, ...HEADLESS_BATTLE_TAIL_KEYS];
// Keys for whichever mode is currently active (used by reset/step/observation).
export function headlessObsKeys() {
  return isBattleMode() ? HEADLESS_BATTLE_OBS_KEYS : HEADLESS_OBS_KEYS;
}
export const HEADLESS_DQN_ACTIONS = [
  { name: "forward", steer: 0, throttle: 1, brake: 0, drift: false },
  { name: "soft_left", steer: -0.45, throttle: 1, brake: 0, drift: false },
  { name: "soft_right", steer: 0.45, throttle: 1, brake: 0, drift: false },
  { name: "hard_left", steer: -1, throttle: 1, brake: 0, drift: false },
  { name: "hard_right", steer: 1, throttle: 1, brake: 0, drift: false },
  { name: "drift_left", steer: -1, throttle: 1, brake: 0, drift: true },
  { name: "drift_right", steer: 1, throttle: 1, brake: 0, drift: true },
  { name: "soft_drift_left", steer: -0.45, throttle: 1, brake: 0, drift: true },
  { name: "soft_drift_right", steer: 0.45, throttle: 1, brake: 0, drift: true },
  { name: "brake_left", steer: -0.6, throttle: 0, brake: 1, drift: false },
  { name: "brake_right", steer: 0.6, throttle: 0, brake: 1, drift: false },
  { name: "use_item", steer: 0, throttle: 1, brake: 0, drift: false, item: true },
  { name: "item_left", steer: -0.45, throttle: 1, brake: 0, drift: false, item: true },
  { name: "item_right", steer: 0.45, throttle: 1, brake: 0, drift: false, item: true },
  { name: "use_ultimate", steer: 0, throttle: 1, brake: 0, drift: false, ultimate: true },
];

export function getHeadlessCheckpointCenter(index) {
  if (!game.track) return null;
  const count = game.track.checkpointCount || game.track.n;
  const idx = game.track.isOpen ? Math.min(index, count - 1) : ((index % count) + count) % count;
  return game.track.checkpointCenter(idx);
}

export function normalizedRoadRayDistance(kart, relAngle) {
  const track = game.track;
  const ang = kart.heading + relAngle;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (let d = HEADLESS_RAY_STEP; d <= HEADLESS_RAY_RANGE; d += HEADLESS_RAY_STEP) {
    if (!track.isOnRoad(kart.x + dx * d, kart.y + dy * d)) {
      return clamp(d / HEADLESS_RAY_RANGE, 0, 1);
    }
  }
  return 1;
}

export function normalizedObjectRayDistance(kart, relAngle, objects, defaultRadius = 20) {
  const ang = kart.heading + relAngle;
  const fx = Math.cos(ang);
  const fy = Math.sin(ang);
  const lx = -fy;
  const ly = fx;
  let best = HEADLESS_RAY_RANGE;

  for (const obj of objects) {
    if (!obj || obj === kart) continue;
    const ox = obj.x - kart.x;
    const oy = obj.y - kart.y;
    const forward = ox * fx + oy * fy;
    if (forward <= 0 || forward > HEADLESS_RAY_RANGE) continue;
    const lateral = Math.abs(ox * lx + oy * ly);
    const radius = rlRuntime.getRayObjectRadius(obj, defaultRadius) + rlRuntime.getKartCollisionRadius(kart);
    if (lateral <= radius) best = Math.min(best, Math.max(0, forward - radius));
  }

  return clamp(best / HEADLESS_RAY_RANGE, 0, 1);
}

export function getHeadlessRayObjects(kart) {
  const otherKarts = getActiveKarts().filter(k => k && k !== kart && !k.finished && !k.eliminated);
  const hazards = [
    ...(game.hazards || []),
    ...(game.track?.movingObjects || []),
  ];
  if (game.track?.regulatoryDragon) hazards.push(game.track.regulatoryDragon);

  const pickups = [
    ...(game.track?.itemBoxes || []).filter(b => b.active).map(b => ({ ...b, r: 24 })),
    ...(game.track?.coins || []).filter(c => !c.collected).map(c => ({ ...c, r: 16 })),
  ];

  const boosters = (game.track?.boostPads || []).map(p => ({ ...p, r: 28 }));

  return { otherKarts, hazards, pickups, boosters };
}

export function getHeadlessBaseValues(kart) {
  const track = game.track;
  const maxSpeed = Math.max(0.001, kart.maxSpeed || kart.baseMaxSpeed || 1);
  const values = [
    clamp(kart.speed() / maxSpeed, 0, 2),
    clamp(kart.forwardSpeed() / maxSpeed, -1, 2),
    track.isOnRoad(kart.x, kart.y) ? 1 : 0,
    clamp((kart.driftCharge || 0) / TUNING.DRIFT_TIER3, 0, 2),
    kart.boostTimer > 0 ? 1 : 0,
    kart.spinoutTimer > 0 ? 1 : 0,
    clamp((kart.baseMaxSpeed || kart.maxSpeed || 0) / 8.0, 0, 2),
    clamp((kart.acceleration || 0) / 0.16, 0, 2),
    clamp((kart.turnSpeed || 0) / 0.07, 0, 2),
    clamp((kart.weight || 0) / 36, 0, 2),
    clamp((kart.gripNormal || 0) / 0.22, 0, 2),
    clamp((kart.gripDrift || 0) / 0.06, 0, 2),
    clamp((kart.coinsCollected || 0) / 20, 0, 1),
    kart.ultReady ? 1 : clamp((kart.ultCharge || 0) / TUNING.ULTIMATE_COINS_NEEDED, 0, 1),
    kart.shieldTimer > 0 ? 1 : 0,
    kart.invuln > 0 ? 1 : 0,
    kart.doubleBlindTimer > 0 ? 1 : 0,
    kart.placeboSlowTimer > 0 ? 1 : 0,
    kart.mergePullTimer > 0 ? 1 : 0,
    (kart.mergePullVictimTimer || 0) > 0 ? 1 : 0,
  ];
  const rayObjects = getHeadlessRayObjects(kart);
  for (const angle of HEADLESS_RAY_ANGLES) values.push(normalizedRoadRayDistance(kart, angle));
  for (const angle of HEADLESS_RAY_ANGLES) values.push(normalizedObjectRayDistance(kart, angle, rayObjects.otherKarts, 18));
  for (const angle of HEADLESS_RAY_ANGLES) values.push(normalizedObjectRayDistance(kart, angle, rayObjects.hazards, 24));
  for (const angle of HEADLESS_RAY_ANGLES) values.push(normalizedObjectRayDistance(kart, angle, rayObjects.pickups, 20));
  for (const angle of HEADLESS_RAY_ANGLES) values.push(normalizedObjectRayDistance(kart, angle, rayObjects.boosters, 28));
  for (const item of HEADLESS_ITEM_TYPES) values.push(kart.itemSlot === item ? 1 : 0);
  return values;
}

export function getHeadlessRaceTail(kart) {
  const track = game.track;
  const target = getHeadlessCheckpointCenter(kart.nextCheckpoint) || { x: kart.x + Math.cos(kart.heading), y: kart.y + Math.sin(kart.heading) };
  const nextTarget = getHeadlessCheckpointCenter(kart.nextCheckpoint + 1) || target;
  const dx = target.x - kart.x;
  const dy = target.y - kart.y;
  const ndx = nextTarget.x - kart.x;
  const ndy = nextTarget.y - kart.y;
  const cs = track.closestSegment(kart.x, kart.y);
  const seg = track.segments[cs.idx] || { halfW: track.halfWidth || 100, nx: 0, ny: 1 };
  const signedOffset = ((kart.x - cs.proj.x) * seg.nx + (kart.y - cs.proj.y) * seg.ny) / Math.max(1, seg.halfW);
  const values = [
    clamp(angleDiff(kart.heading, Math.atan2(dy, dx)) / Math.PI, -1, 1),
    clamp(Math.hypot(dx, dy) / 1200, 0, 3),
    clamp(signedOffset, -2, 2),
    clamp(angleDiff(kart.heading, Math.atan2(ndy, ndx)) / Math.PI, -1, 1),
    clamp(Math.hypot(ndx, ndy) / 1600, 0, 3),
  ];
  return { values, target, nextTarget };
}

export function getHeadlessBattleTail(kart) {
  const alive = getActiveKarts().filter(k => k && !k.eliminated);
  const survivors = clamp(alive.length / Math.max(1, game.totalRacers || alive.length), 0, 1);
  const timeLeft = clamp((game.battleTimeLeft || 0) / Math.max(1, game.battleDuration || 1), 0, 1);
  const rivals = alive
    .filter(k => k !== kart)
    .map(k => ({ k, d: dist(kart.x, kart.y, k.x, k.y), bearing: angleDiff(kart.heading, Math.atan2(k.y - kart.y, k.x - kart.x)) }))
    .sort((a, b) => a.d - b.d);
  // Ram opportunity: high-speed closing window on the nearest rival ahead.
  let ram = 0;
  if (rivals.length && rivals[0].d < 260) {
    const def = rivals[0].k;
    const inv = Math.max(0.001, rivals[0].d);
    const dirx = (def.x - kart.x) / inv;
    const diry = (def.y - kart.y) / inv;
    if (rlRuntime.qualifiesApprovalRam(kart, def, dirx, diry)) ram = 1;
  }
  const values = [clamp((kart.approvals || 0) / 5, 0, 1), survivors, timeLeft, ram];
  for (let i = 0; i < HEADLESS_BATTLE_RIVAL_COUNT; i++) {
    const r = rivals[i];
    if (r) {
      values.push(
        clamp(r.bearing / Math.PI, -1, 1),
        clamp(r.d / HEADLESS_RAY_RANGE, 0, 2),
        clamp((r.k.approvals || 0) / 5, 0, 1),
        r.k.spinoutTimer > 0 ? 1 : 0,
      );
    } else {
      values.push(0, 2, 0, 0); // sentinel: no rival (far away, no lives)
    }
  }
  return values;
}

export function getHeadlessObservation(kart) {
  const values = getHeadlessBaseValues(kart);
  if (isBattleMode()) {
    for (const v of getHeadlessBattleTail(kart)) values.push(v);
    return { keys: HEADLESS_BATTLE_OBS_KEYS, values, target: null, nextTarget: null };
  }
  const race = getHeadlessRaceTail(kart);
  for (const v of race.values) values.push(v);
  return { keys: HEADLESS_OBS_KEYS, values, target: race.target, nextTarget: race.nextTarget };
}

export function normalizeHeadlessAction(action = {}) {
  if (typeof action === "number") return HEADLESS_DQN_ACTIONS[Math.max(0, Math.min(HEADLESS_DQN_ACTIONS.length - 1, Math.floor(action)))] || HEADLESS_DQN_ACTIONS[0];
  return {
    steer: clamp(Number(action.steer || 0), -1, 1),
    throttle: clamp(action.throttle === undefined ? 1 : Number(action.throttle), 0, 1),
    brake: clamp(Number(action.brake || 0), 0, 1),
    drift: !!action.drift,
    item: !!action.item,
    ultimate: !!action.ultimate,
  };
}

export function applyHeadlessAction(kart, track, dt, action) {
  const a = normalizeHeadlessAction(action);
  if (a.item && kart.itemState === "active" && kart.itemSlot) kart.useItem();
  if (a.ultimate && kart.ultReady) rlRuntime.activateUltimate(kart);
  const input = {
    forward: a.throttle >= 0.5,
    back: a.brake >= 0.5,
    left: a.steer < -0.15,
    right: a.steer > 0.15,
    drift: a.drift,
    continuousSteer: a.steer,
  };
  if (kart.ultActiveTimer > 0) kart.ultActiveTimer -= dt;
  const onRoad = track.isOnRoad(kart.x, kart.y);
  kart.applyPhysics(input, track, dt, onRoad);
  kart.lastHeadlessAction = a;
}

export function computeHeadlessFrameReward(kart, beforeProgress, beforeLap, beforeFinished) {
  const afterProgress = rlRuntime.progressValue(kart);
  let reward = (afterProgress - beforeProgress) * 10;
  if ((kart.lap || 0) > beforeLap) reward += 50;
  if (!beforeFinished && kart.finished) reward += 200;
  return reward;
}

export function computeHeadlessBattleReward(kart) {
  const steals = game.rlSteals || 0;
  const losses = game.rlLosses || 0;
  const hits = game.rlHits || 0;
  game.rlSteals = 0;
  game.rlLosses = 0;
  game.rlHits = 0;
  // Aggression-shaped: pops/steals pay far more than passive survival, and every frame
  // costs a little so running out the clock is never the best policy.
  let reward = 3.0 * steals - 1.5 * losses + 1.5 * hits;
  reward -= 0.001; // time pressure: ~-7.2 over a full 120s match
  const uses = kart.itemUseCount || 0;
  if (uses > (kart._rlPrevItemUses || 0)) reward += 0.3 * (uses - (kart._rlPrevItemUses || 0));
  kart._rlPrevItemUses = uses;
  const hasItem = kart.itemState === "active";
  if (hasItem && !kart._rlHadItem) reward += 0.3; // picked up a fresh item
  kart._rlHadItem = hasItem;
  const coins = kart.coinsCollected || 0;
  if (coins > (kart._rlPrevCoins || 0)) reward += 0.03 * (coins - (kart._rlPrevCoins || 0));
  kart._rlPrevCoins = coins;
  if (kart.eliminated && !kart._rlEliminationCounted) {
    kart._rlEliminationCounted = true;
    reward -= 8;
  }
  if (game.state === STATE.FINISHED && !kart._rlWinCounted) {
    kart._rlWinCounted = true;
    const alive = getActiveKarts().filter(k => k && !k.eliminated);
    if (!kart.eliminated && (alive.length <= 1 || rlRuntime.rankAll()[0] === kart)) reward += 20;
    else if (!kart.eliminated) reward -= 5; // surviving to a timeout without leading is a soft loss
  }
  return reward;
}

export function computeHeadlessStepReward(kart, beforeProgress, beforeLap, beforeFinished) {
  if (isBattleMode()) return computeHeadlessBattleReward(kart);
  return computeHeadlessFrameReward(kart, beforeProgress, beforeLap, beforeFinished);
}
