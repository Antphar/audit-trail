import { TUNING } from "../config/tuning.js";
import { CHARACTERS } from "../config/characters.js";
import { MAPS, clampAiCount } from "../config/maps.js";
import { clamp, dist, rand, mulberry32 } from "../core/math.js";
import { URL_PARAMS, HEADLESS_MODE, headlessFlag } from "../core/env.js";
import { STATE, game, isBattleMode, getActiveKarts } from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { Kart } from "../entities/kart.js";
import { AIKart } from "../entities/ai-kart.js";
import { rlRuntime } from "./rl-runtime.js";
import {
  HEADLESS_DQN_ACTIONS, HEADLESS_OBS_KEYS, HEADLESS_BATTLE_OBS_KEYS,
  headlessObsKeys, getHeadlessObservation, applyHeadlessAction,
  computeHeadlessStepReward,
} from "./observation.js";

export class HeadlessRandomKart extends Kart {
  constructor(x, y, heading, char) {
    super(x, y, heading, char, true);
    this.playerIndex = 1;
    this.randomSteer = 0;
    this.randomSteerTimer = 0;
  }

  update(dt, track) {
    if (this.eliminated) return;
    this.randomSteerTimer -= dt;
    if (this.randomSteerTimer <= 0) {
      this.randomSteerTimer = rand(10, 42);
      const roll = Math.random();
      this.randomSteer = roll < 0.36 ? -1 : roll < 0.72 ? 1 : 0;
    }

    if (this.ultActiveTimer > 0) this.ultActiveTimer -= dt;
    const input = {
      forward: true,
      back: false,
      left: this.randomSteer < 0,
      right: this.randomSteer > 0,
      drift: false,
    };
    const onRoad = track.isOnRoad(this.x, this.y);
    this.applyPhysics(input, track, dt, onRoad);
  }
}

export class HeadlessMlpKart extends Kart {
  constructor(x, y, heading, char, weights) {
    super(x, y, heading, char, true);
    this.playerIndex = 1;
    this.weights = weights;
  }

  update(dt, track) {
    if (this.eliminated) return;
    const observation = getHeadlessObservation(this);
    const action = runHeadlessMlp(this.weights, observation);
    this.lastHeadlessObservation = observation.values;
    applyHeadlessAction(this, track, dt, action);
  }
}

export class HeadlessDqnKart extends Kart {
  constructor(x, y, heading, char, weights) {
    super(x, y, heading, char, true);
    this.playerIndex = 1;
    this.weights = weights;
    this.frameSkip = Math.max(1, Math.floor(Number(weights?.meta?.frameSkip) || 1));
    this.skipCounter = 0;
    this.cachedAction = HEADLESS_DQN_ACTIONS[0];
  }

  update(dt, track) {
    if (this.eliminated) return;
    this.skipCounter--;
    if (this.skipCounter <= 0) {
      this.skipCounter = this.frameSkip;
      const observation = getHeadlessObservation(this);
      const decision = runHeadlessDqn(this.weights, observation, this);
      this.lastHeadlessObservation = observation.values;
      this.lastHeadlessActionIndex = decision.actionIndex;
      this.lastHeadlessQValues = decision.qValues;
      this.cachedAction = decision.action;
    }
    applyHeadlessAction(this, track, dt, this.cachedAction);
  }
}

export class HeadlessExternalKart extends Kart {
  constructor(x, y, heading, char) {
    super(x, y, heading, char, true);
    this.playerIndex = 1;
    this.pendingAction = HEADLESS_DQN_ACTIONS[0];
  }

  update(dt, track) {
    if (this.eliminated) return;
    applyHeadlessAction(this, track, dt, this.pendingAction || HEADLESS_DQN_ACTIONS[0]);
  }
}

export class TrainedAIKart extends Kart {
  constructor(x, y, heading, char, weights, skill = 1.0) {
    super(x, y, heading, char, false);
    this.weights = weights;
    this.isSac = weights?.type === "sac";
    this.skill = skill;
    this.maxSpeed = this.baseMaxSpeed * (0.91 + skill * 0.1);
    this.acceleration = char.acceleration * (0.92 + skill * 0.08);
    this.turnSpeed = char.turnSpeed * (0.92 + skill * 0.08);
    this.aiTargetIdx = 1;
    this.frameSkip = Math.max(1, Math.floor(Number(weights?.meta?.frameSkip) || 1));
    this.skipCounter = 0;
    this.cachedAction = this.isSac ? { steer: 0, throttle: 1, brake: 0, drift: false, item: false, ultimate: false } : HEADLESS_DQN_ACTIONS[0];
  }

  update(dt, track) {
    if (this.eliminated) return;
    this.skipCounter--;
    if (this.skipCounter <= 0) {
      this.skipCounter = this.frameSkip;
      const observation = getHeadlessObservation(this);
      if (this.isSac) {
        const decision = runHeadlessSac(this.weights, observation, this);
        this.cachedAction = decision.action;
      } else {
        const decision = runHeadlessDqn(this.weights, observation, this);
        this.cachedAction = decision.action;
      }
    }
    applyHeadlessAction(this, track, dt, this.cachedAction);
    const target = getPolicyCheckpointCenter(this);
    if (target) {
      const advanceRadius = Math.max(55, track.halfWidth * 1.2);
      if (dist(this.x, this.y, target.x, target.y) < advanceRadius) {
        this.aiTargetIdx = this.nextCheckpoint;
      }
    }
  }
}

export const HEADLESS_EXTERNAL_STATE = {
  config: null,
  simSeconds: 0,
  frames: 0,
  reward: 0,
};

export const DqnAIKart = TrainedAIKart;

export function selectHeadlessMap(mapOverride = null) {
  const requestedMap = mapOverride || URL_PARAMS.get("map") || URL_PARAMS.get("headlessMap") || "protocol_amendment_labyrinth";
  const idx = MAPS.findIndex(m => m.id === requestedMap || m.name === requestedMap);
  game.selectedMapIdx = idx >= 0 ? idx : 0;
  return MAPS[game.selectedMapIdx];
}

export function selectHeadlessCharacter(charOverride = null) {
  const requestedChar = charOverride || URL_PARAMS.get("char") || URL_PARAMS.get("character") || "anton";
  const idx = CHARACTERS.findIndex(c => c.id === requestedChar || c.name.toLowerCase() === requestedChar.toLowerCase());
  game.selectedCharIdx = idx >= 0 ? idx : 0;
  return CHARACTERS[game.selectedCharIdx];
}

export function _mlpLayerForward(x, layer) {
  const w = layer.weights || layer.w || [];
  const b = layer.biases || layer.b || [];
  const outSize = b.length || Math.floor(w.length / Math.max(1, x.length));
  const next = new Array(outSize).fill(0);
  for (let o = 0; o < outSize; o++) {
    let sum = Number(b[o] || 0);
    for (let i = 0; i < x.length; i++) {
      sum += Number(w[o * x.length + i] || 0) * x[i];
    }
    next[o] = sum;
  }
  if (layer.layernorm) {
    const ln = layer.layernorm;
    const eps = ln.eps || 1e-5;
    let mean = 0;
    for (let i = 0; i < outSize; i++) mean += next[i];
    mean /= outSize;
    let variance = 0;
    for (let i = 0; i < outSize; i++) variance += (next[i] - mean) * (next[i] - mean);
    variance /= outSize;
    const invStd = 1 / Math.sqrt(variance + eps);
    for (let i = 0; i < outSize; i++) {
      next[i] = (next[i] - mean) * invStd * (ln.weight?.[i] ?? 1) + (ln.bias?.[i] ?? 0);
    }
  }
  const act = layer.activation;
  if (act === "linear") return next;
  for (let o = 0; o < outSize; o++) {
    if (act === "relu") next[o] = Math.max(0, next[o]);
    else if (act === "gelu") {
      const v = next[o];
      next[o] = 0.5 * v * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (v + 0.044715 * v * v * v)));
    }
    else next[o] = Math.tanh(next[o]);
  }
  return next;
}

export function headlessMlpForward(weights, inputValues) {
  if (!weights) return null;
  let x = inputValues.slice();
  if (weights.architecture === "gaussian_actor" && Array.isArray(weights.trunk)) {
    for (const layer of weights.trunk) x = _mlpLayerForward(x, layer);
    const mean = _mlpLayerForward(x, weights.mean_head);
    const action = new Array(mean.length);
    action[0] = Math.tanh(mean[0]);
    for (let i = 1; i < mean.length; i++) action[i] = 1 / (1 + Math.exp(-mean[i]));
    return action;
  }
  if (weights.architecture === "dueling" && Array.isArray(weights.trunk)) {
    for (const layer of weights.trunk) x = _mlpLayerForward(x, layer);
    const v = _mlpLayerForward(x, weights.value_head);
    const a = _mlpLayerForward(x, weights.advantage_head);
    const centerAdvantages = weights.advantageCentering ?? weights.meta?.advantageCentering ?? true;
    let meanA = 0;
    if (centerAdvantages) {
      for (let i = 0; i < a.length; i++) meanA += a[i];
      meanA /= a.length || 1;
    }
    const q = new Array(a.length);
    for (let i = 0; i < a.length; i++) q[i] = v[0] + a[i] - meanA;
    applyMeanExpansion(q, weights.meanExpansionK ?? weights.meta?.meanExpansionK ?? 0);
    return q;
  }
  if (!Array.isArray(weights.layers)) return null;
  for (let li = 0; li < weights.layers.length; li++) {
    const layer = weights.layers[li];
    const isLast = li === weights.layers.length - 1;
    const patched = isLast ? { ...layer, activation: layer.activation || "linear" } : layer;
    x = _mlpLayerForward(x, patched);
  }
  return x;
}

export function applyMeanExpansion(values, k) {
  k = Number(k || 0);
  if (!Number.isFinite(k) || k <= 0 || !values.length) return values;
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i];
  mean /= values.length;
  for (let i = 0; i < values.length; i++) values[i] = values[i] - mean + (k + 1) * mean;
  return values;
}

export function runHeadlessMlp(weights, observation) {
  const x = headlessMlpForward(weights, observation.values);
  if (!x) {
    return { steer: 0, throttle: 1, brake: 0, drift: false };
  }
  return {
    steer: x[0] || 0,
    throttle: x.length > 1 ? (x[1] + 1) / 2 : 1,
    brake: x.length > 2 ? (x[2] + 1) / 2 : 0,
    drift: (x[3] || 0) > 0.2,
  };
}

export function buildModelObservationValues(weights, observation, kart = null) {
  const obsKeys = Array.isArray(weights?.observationKeys) ? weights.observationKeys : HEADLESS_OBS_KEYS;
  const current = new Map();
  observation.keys.forEach((key, idx) => current.set(key, observation.values[idx] ?? 0));

  if (kart) {
    if (!kart._dqnObsFrames) kart._dqnObsFrames = [];
    kart._dqnObsFrames.unshift(current);
    const requestedStack = obsKeys.reduce((maxLag, key) => {
      const m = String(key).match(/@-(\d+)$/);
      return m ? Math.max(maxLag, Number(m[1]) + 1) : maxLag;
    }, 1);
    while (kart._dqnObsFrames.length < requestedStack) kart._dqnObsFrames.push(current);
    kart._dqnObsFrames.length = Math.max(requestedStack, 1);
  }

  return obsKeys.map(key => {
    const strKey = String(key);
    const m = strKey.match(/^(.*)@-(\d+)$/);
    if (!m) return current.get(strKey) ?? 0;
    const frame = kart?._dqnObsFrames?.[Number(m[2])] || current;
    return frame.get(m[1]) ?? 0;
  });
}

export function runHeadlessDqn(weights, observation, kart = null) {
  const values = buildModelObservationValues(weights, observation, kart);
  const qValues = headlessMlpForward(weights, values);
  const actionSchema = Array.isArray(weights?.actions) && weights.actions.length ? weights.actions : HEADLESS_DQN_ACTIONS;
  if (!qValues || !qValues.length) return { actionIndex: 0, action: actionSchema[0] || HEADLESS_DQN_ACTIONS[0], qValues: [] };
  let bestIdx = 0;
  for (let i = 1; i < Math.min(qValues.length, actionSchema.length); i++) {
    if (qValues[i] > qValues[bestIdx]) bestIdx = i;
  }
  return { actionIndex: bestIdx, action: actionSchema[bestIdx] || HEADLESS_DQN_ACTIONS[0], qValues };
}

export function runHeadlessSac(weights, observation, kart = null) {
  const values = buildModelObservationValues(weights, observation, kart);
  const raw = headlessMlpForward(weights, values);
  if (!raw || !raw.length) return { action: { steer: 0, throttle: 1, brake: 0, drift: false, item: false, ultimate: false }, raw: [] };
  return {
    action: {
      steer: raw[0] || 0,
      throttle: raw[1] !== undefined ? raw[1] : 1,
      brake: raw[2] || 0,
      drift: (raw[3] || 0) > 0.5,
      item: (raw[4] || 0) > 0.5,
      ultimate: (raw[5] || 0) > 0.5,
    },
    raw,
  };
}

export function validateModelPayload(payload) {
  if (!payload || !payload.type) throw new Error("Not an Audit Trail model");
  if (payload.type === "sac") return validateSacModelPayload(payload);
  return validateDqnModelPayload(payload);
}

export function validateSacModelPayload(payload) {
  if (payload.type !== "sac") throw new Error("Expected an Audit Trail SAC model");
  if (!Array.isArray(payload.trunk) || !payload.mean_head) throw new Error("SAC model missing trunk or mean_head");
  if (!Array.isArray(payload.observationKeys)) throw new Error("Model has no observation key schema");
  for (const key of payload.observationKeys) {
    const baseKey = String(key).replace(/@-\d+$/, "");
    if (!HEADLESS_OBS_KEYS.includes(baseKey) && !HEADLESS_BATTLE_OBS_KEYS.includes(baseKey)) {
      console.warn(`Model references removed observation key "${key}" — will use 0`);
    }
  }
  return payload;
}

export function validateDqnModelPayload(payload) {
  if (!payload || payload.type !== "dqn") throw new Error("Expected an Audit Trail DQN model");
  const isDueling = payload.architecture === "dueling" && Array.isArray(payload.trunk);
  if (!isDueling && (!Array.isArray(payload.layers) || payload.layers.length === 0)) throw new Error("Model has no layers");
  if (isDueling && (!payload.value_head || !payload.advantage_head)) throw new Error("Dueling model missing value/advantage heads");
  if (!Array.isArray(payload.observationKeys)) throw new Error("Model has no observation key schema");
  for (const key of payload.observationKeys) {
    const baseKey = String(key).replace(/@-\d+$/, "");
    if (!HEADLESS_OBS_KEYS.includes(baseKey) && !HEADLESS_BATTLE_OBS_KEYS.includes(baseKey)) {
      console.warn(`Model references removed observation key "${key}" — will use 0`);
    }
  }
  if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
    throw new Error("Model action schema does not match this game build");
  }
  function _checkLayer(label, layer, expectedIn) {
    const w = layer.weights || layer.w;
    const b = layer.biases || layer.b;
    const isNumericArray = value => Array.isArray(value) || ArrayBuffer.isView(value);
    if (!isNumericArray(w) || !isNumericArray(b) || b.length === 0) throw new Error(`${label} missing weights/biases`);
    if (expectedIn !== null && w.length !== expectedIn * b.length) throw new Error(`${label} shape mismatch`);
    return b.length;
  }
  let inputSize = payload.observationKeys.length;
  if (isDueling) {
    for (let i = 0; i < payload.trunk.length; i++) inputSize = _checkLayer(`Trunk[${i}]`, payload.trunk[i], inputSize);
    _checkLayer("value_head", payload.value_head, inputSize);
    const advOut = _checkLayer("advantage_head", payload.advantage_head, inputSize);
    if (advOut !== payload.actions.length) throw new Error("Advantage head output size must match action count");
  } else {
    for (let i = 0; i < payload.layers.length; i++) inputSize = _checkLayer(`Layer ${i}`, payload.layers[i], inputSize);
    if (inputSize !== payload.actions.length) throw new Error("Model output size must match its action count");
  }
  return payload;
}

export function expandCompactDqnPolicy(payload) {
  if (payload?.format !== "turbo-kart-headless-dqn-compact-v1") return payload;
  if (payload.encoding !== "base64-f32le" || typeof payload.weightsBase64 !== "string") {
    throw new Error("Compact DQN policy has unsupported encoding");
  }
  const binary = atob(payload.weightsBase64);
  if (binary.length % 4 !== 0) throw new Error("Compact DQN byte length is not float32 aligned");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const floats = new Float32Array(bytes.buffer);
  if (floats.length !== Number(payload.floatCount)) {
    throw new Error("Compact DQN float count mismatch");
  }
  const view = descriptor => {
    const offset = Number(descriptor?.offset);
    const length = Number(descriptor?.length);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0
        || offset + length > floats.length) {
      throw new Error("Compact DQN tensor descriptor is out of bounds");
    }
    return floats.subarray(offset, offset + length);
  };
  const expandLayer = layer => {
    const expanded = {
      weights: view(layer.weights),
      biases: view(layer.biases),
      activation: layer.activation,
    };
    if (layer.layernorm) {
      expanded.layernorm = {
        weight: view(layer.layernorm.weight),
        bias: view(layer.layernorm.bias),
        eps: layer.layernorm.eps,
      };
    }
    return expanded;
  };
  return {
    type: "dqn",
    format: payload.format,
    architecture: "dueling",
    observationKeys: payload.observationKeys,
    actions: payload.actions,
    trunk: payload.trunk.map(expandLayer),
    value_head: expandLayer(payload.value_head),
    advantage_head: expandLayer(payload.advantage_head),
    advantageCentering: payload.advantageCentering,
    meanExpansionK: payload.meanExpansionK,
    meta: payload.meta || {},
    _compactWeights: floats,
  };
}

export function enableHeadlessAgent(agentType) {
  const existing = game.player;
  const char = CHARACTERS[game.selectedCharIdx || 0];
  const type = (agentType || "waypoint").toLowerCase();
  const mlpWeights = window.HEADLESS_MLP_WEIGHTS || null;
  const dqnWeights = window.HEADLESS_DQN_WEIGHTS || mlpWeights;
  let bot;
  if (type === "random") {
    bot = new HeadlessRandomKart(existing.x, existing.y, existing.heading, char);
  } else if (type === "external") {
    bot = new HeadlessExternalKart(existing.x, existing.y, existing.heading, char);
  } else if (type === "dqn") {
    bot = new HeadlessDqnKart(existing.x, existing.y, existing.heading, char, dqnWeights);
  } else if (type === "mlp") {
    bot = new HeadlessMlpKart(existing.x, existing.y, existing.heading, char, mlpWeights);
  } else {
    bot = new AIKart(existing.x, existing.y, existing.heading, char, 1.05);
  }
  bot.isPlayer = true;
  bot.playerIndex = 1;
  bot.name = existing.name;
  bot.color = existing.color;
  bot.charId = existing.charId;
  game.player = bot;
  return ["random", "mlp", "dqn", "external"].includes(type) ? type : "waypoint";
}

export function makeHeadlessConfig(overrides = {}) {
  let mode = String(overrides.mode ?? URL_PARAMS.get("mode") ?? "race").toLowerCase();
  if (mode === "arena") mode = "battle";
  const battle = mode === "battle";
  return {
    mode,
    frames: Math.max(1, Math.floor(Number(overrides.frames ?? URL_PARAMS.get("frames") ?? URL_PARAMS.get("headlessFrames") ?? 60 * 120))),
    episodes: Math.max(1, Math.floor(Number(overrides.episodes ?? URL_PARAMS.get("episodes") ?? 1))),
    agent: String(overrides.agent ?? URL_PARAMS.get("agent") ?? "waypoint").toLowerCase(),
    trace: overrides.trace ?? headlessFlag("trace", false),
    traceEvery: Math.max(1, Math.floor(Number(overrides.traceEvery ?? URL_PARAMS.get("traceEvery") ?? 30))),
    frameSkip: Math.max(1, Math.floor(Number(overrides.frameSkip ?? URL_PARAMS.get("frameSkip") ?? 4))),
    // Battle is a free-for-all: force opponents on and items on regardless of race defaults.
    solo: battle ? false : (overrides.solo ?? headlessFlag("solo", false)),
    noItems: battle ? false : (overrides.noItems ?? (headlessFlag("noItems", false) || (headlessFlag("items", false) === false && URL_PARAMS.get("items") === "0"))),
    noHazards: battle ? true : (overrides.noHazards ?? (headlessFlag("noHazards", false) || (headlessFlag("hazards", false) === false && URL_PARAMS.get("hazards") === "0"))),
    map: overrides.map ?? URL_PARAMS.get("map") ?? URL_PARAMS.get("headlessMap") ?? (battle ? rlRuntime.BATTLE_ARENA_ID : "protocol_amendment_labyrinth"),
    character: overrides.character ?? URL_PARAMS.get("char") ?? URL_PARAMS.get("character") ?? "anton",
    opponentModels: Array.isArray(overrides.opponentModels) && overrides.opponentModels.length ? overrides.opponentModels : null,
    classicOpponentSlots: Math.max(0, Math.floor(Number(overrides.classicOpponentSlots ?? 0))),
    opponentCount: Number.isFinite(Number(overrides.opponentCount)) && overrides.opponentCount !== null && overrides.opponentCount !== undefined ? Math.min(7, Math.max(0, Math.floor(Number(overrides.opponentCount)))) : null,
  };
}

export function configureHeadlessEpisode(config) {
  if (config.solo) {
    game.ais = [];
    game.totalRacers = 1;
  }
  if (config.noItems && game.track) {
    game.track.coins = [];
    game.track.itemBoxes = [];
    game.track.boostPads = [];
  }
  if (config.noHazards && game.track) {
    game.hazards = [];
    game.track.movingObjects = [];
    game.track.regulatoryDragon = null;
  }
  const targetOpponents = config.opponentCount !== null && config.opponentCount !== undefined
    ? Math.min(7, Math.max(0, Math.floor(Number(config.opponentCount))))
    : null;
  if (targetOpponents !== null && !config.solo && game.ais && game.track) {
    if (game.ais.length < targetOpponents) {
      const seg0 = game.track.segments[0];
      const ang = Math.atan2(seg0.dy, seg0.dx);
      const sx = seg0.a.x + seg0.dx * 0.04;
      const sy = seg0.a.y + seg0.dy * 0.04;
      const fx = Math.cos(ang), fy = Math.sin(ang);
      const lx = -Math.sin(ang), ly = Math.cos(ang);
      const aiChars = CHARACTERS.filter((_, idx) => idx !== (game.selectedCharIdx || 0));
      const baseSkills = [0.95, 0.97, 0.99, 1.01];
      const diffMult = rlRuntime.AI_DIFFICULTIES[rlRuntime.aiDifficulty] || 1.0;
      for (let idx = game.ais.length; idx < targetOpponents; idx++) {
        const pos = rlRuntime.gridSlot(idx + 1);
        const x = sx + fx * pos.f + lx * pos.l;
        const y = sy + fy * pos.f + ly * pos.l;
        game.ais.push(new AIKart(x, y, ang, aiChars[idx % aiChars.length], baseSkills[idx % baseSkills.length] * diffMult));
      }
    }
    if (game.ais.length > targetOpponents) {
      game.ais = game.ais.slice(0, targetOpponents);
    }
    game.totalRacers = 1 + game.ais.length;
  }
  if (!config.solo && Array.isArray(config.opponentModels) && config.opponentModels.length && game.ais?.length) {
    const classicSlots = Math.max(0, Math.floor(Number(config.classicOpponentSlots || 0)));
    game.ais = game.ais.map((ai, idx) => {
      if (idx < classicSlots) return ai;
      const weights = config.opponentModels[(idx - classicSlots) % config.opponentModels.length];
      if (!weights) return ai;
      try {
        validateModelPayload(weights);
        const char = CHARACTERS.find(c => c.id === ai.charId) || CHARACTERS[(idx + 1) % CHARACTERS.length];
        const dqn = new TrainedAIKart(ai.x, ai.y, ai.heading, char, weights, ai.skill || 0.96);
        dqn.lateralOffset = ai.lateralOffset || 0;
        return dqn;
      } catch (e) {
        return ai;
      }
    });
  }
  game.headlessNoItems = !!config.noItems;
  game.headlessNoHazards = !!config.noHazards;
  // Re-init battle lives: the agent kart (and self-play opponents) replaced the karts
  // that rlRuntime.buildRace() originally initialized, leaving their `approvals` undefined.
  if (isBattleMode()) rlRuntime.initBattleKartState();
}

export function summarizeHeadlessEpisode(map, frames, simSeconds, episodeIdx = 0) {
  const ranking = rlRuntime.rankAll().map((kart, idx) => ({
    place: idx + 1,
    name: kart.name,
    charId: kart.charId,
    lap: kart.lap,
    nextCheckpoint: kart.nextCheckpoint,
    progress: Math.round(rlRuntime.progressValue(kart) * 1000) / 1000,
    finished: !!kart.finished,
    eliminated: !!kart.eliminated,
    finishTime: Math.round((kart.finishTime || game.raceTime) * 1000) / 1000,
  }));

  return {
    episode: episodeIdx,
    map: map.id,
    mapName: map.name,
    character: CHARACTERS[game.selectedCharIdx || 0].id,
    frames,
    simSeconds: Math.round(simSeconds * 1000) / 1000,
    state: game.state,
    raceTime: Math.round(game.raceTime * 1000) / 1000,
    playerFinished: !!game.player?.finished,
    playerPlace: ranking.find(r => r.charId === game.player?.charId && r.name === game.player?.name)?.place || null,
    playerLap: game.player?.lap || 0,
    playerApprovals: game.player?.approvals || 0,
    playerSteals: game.player?.battleSteals || 0,
    playerEliminated: !!game.player?.eliminated,
    reward: Math.round((game.headlessEpisodeReward || 0) * 1000) / 1000,
    ranking,
  };
}

export function runHeadlessEpisode(config, episodeIdx = 0) {
  Sound.muted = true;
  game.multiplayer = false;
  game.p2pMode = false;
  game.p2pRole = null;
  game.mode = config.mode === "battle" ? "battle" : "race";
  game.rlSteals = 0;
  game.rlLosses = 0;
  game.rlHits = 0;
  selectHeadlessCharacter(config.character);
  const map = selectHeadlessMap(config.map);
  rlRuntime.hideAll();
  rlRuntime.buildRace();
  const agent = enableHeadlessAgent(config.agent);
  configureHeadlessEpisode(config);
  game.particles = noopParticleSystem();
  game.skidMarks = [];
  game.state = STATE.RACING;
  game.startTime = performance.now();
  game.raceTime = 0;

  const maxFrames = config.frames;
  const dt = 1;
  let simSeconds = 0;
  let frames = 0;
  const trace = [];
  let totalReward = 0;

  for (; frames < maxFrames && game.state !== STATE.FINISHED; frames++) {
    const beforeProgress = rlRuntime.progressValue(game.player);
    const beforeFinished = !!game.player.finished;
    const beforeLap = game.player.lap || 0;
    const beforeObs = config.trace ? getHeadlessObservation(game.player) : null;
    simSeconds += 1 / 60;
    game.startTime = performance.now() - simSeconds * 1000;
    rlRuntime.update(dt, simSeconds * 1000);
    game.skidMarks.length = 0;
    const afterProgress = rlRuntime.progressValue(game.player);
    const reward = computeHeadlessStepReward(game.player, beforeProgress, beforeLap, beforeFinished);
    totalReward += reward;
    if (config.trace && frames % config.traceEvery === 0) {
      trace.push({
        frame: frames,
        t: Math.round(simSeconds * 1000) / 1000,
        obs: beforeObs ? beforeObs.values : [],
        action: game.player.lastHeadlessAction || null,
        reward: Math.round(reward * 1000) / 1000,
        progress: Math.round(afterProgress * 1000) / 1000,
        lap: game.player.lap,
        x: Math.round(game.player.x * 10) / 10,
        y: Math.round(game.player.y * 10) / 10,
      });
    }
    if (rlRuntime.areAllHumansDone()) {
      rlRuntime.finishRace();
    }
  }

  game.headlessEpisodeReward = totalReward;
  const result = summarizeHeadlessEpisode(map, frames, simSeconds, episodeIdx);
  result.agent = agent;
  if (config.trace) {
    result.observationKeys = headlessObsKeys();
    result.trace = trace;
  }
  return result;
}

export function runHeadlessSimulation() {
  const config = makeHeadlessConfig();
  const startedAt = performance.now();
  const episodes = [];
  for (let i = 0; i < config.episodes; i++) {
    episodes.push(runHeadlessEpisode(config, i));
  }
  const elapsedMs = performance.now() - startedAt;
  const last = episodes[episodes.length - 1];
  const totalFrames = episodes.reduce((sum, e) => sum + e.frames, 0);
  const totalSimSeconds = episodes.reduce((sum, e) => sum + e.simSeconds, 0);
  const totalPlayerLaps = episodes.reduce((sum, e) => sum + (e.playerLap || 0), 0);
  const totalReward = episodes.reduce((sum, e) => sum + (e.reward || 0), 0);

  const result = {
    mode: "headless",
    ...last,
    config,
    episodes,
    aggregate: {
      elapsedMs: Math.round(elapsedMs * 1000) / 1000,
      totalFrames,
      totalSimSeconds: Math.round(totalSimSeconds * 1000) / 1000,
      simSecondsPerRealSecond: Math.round((totalSimSeconds / Math.max(0.001, elapsedMs / 1000)) * 1000) / 1000,
      totalPlayerLaps,
      totalReward: Math.round(totalReward * 1000) / 1000,
      avgReward: Math.round((totalReward / episodes.length) * 1000) / 1000,
      finishCount: episodes.filter(e => e.playerFinished).length,
      avgPlayerProgress: Math.round((episodes.reduce((sum, e) => {
        const player = e.ranking.find(r => r.charId === e.character);
        return sum + (player ? player.progress : 0);
      }, 0) / episodes.length) * 1000) / 1000,
      realMsPerPlayerLap: totalPlayerLaps > 0 ? Math.round((elapsedMs / totalPlayerLaps) * 1000) / 1000 : null,
    },
  };

  window.__HEADLESS_RESULT__ = result;
  document.body.textContent = JSON.stringify(result, null, 2);
  console.log("HEADLESS_RESULT " + JSON.stringify(result));
  return result;
}

export async function loadHeadlessPolicyModel() {
  const modelUrl = URL_PARAMS.get("model") || URL_PARAMS.get("dqnModel") || URL_PARAMS.get("policy");
  if (!modelUrl) return null;
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Failed to load policy model: ${response.status}`);
  const model = await response.json();
  validateModelPayload(model);
  if (model.type === "dqn" || model.type === "sac") window.HEADLESS_DQN_WEIGHTS = model;
  else window.HEADLESS_MLP_WEIGHTS = model;
  return model;
}

export function headlessExternalTerminal() {
  const config = HEADLESS_EXTERNAL_STATE.config;
  if (!config || !game.player) return true;
  return game.state === STATE.FINISHED
    || game.player.finished
    || game.player.eliminated
    || HEADLESS_EXTERNAL_STATE.frames >= config.frames;
}

export function headlessRlStepOnce(action) {
  const config = HEADLESS_EXTERNAL_STATE.config || makeHeadlessConfig({ agent: "external" });
  let actionObj;
  if (typeof action === "number") {
    actionObj = HEADLESS_DQN_ACTIONS[Math.max(0, Math.min(HEADLESS_DQN_ACTIONS.length - 1, Math.floor(action)))];
  } else if (Array.isArray(action)) {
    actionObj = {
      steer: action[0] || 0,
      throttle: action[1] !== undefined ? action[1] : 1,
      brake: action[2] || 0,
      drift: (action[3] || 0) > 0.5,
      item: (action[4] || 0) > 0.5,
      ultimate: (action[5] || 0) > 0.5,
    };
  } else {
    actionObj = action;
  }
  if (game.player instanceof HeadlessExternalKart) game.player.pendingAction = actionObj;
  let reward = 0;
  const repeat = Math.max(1, Math.floor(config.frameSkip || 1));
  for (let i = 0; i < repeat; i++) {
    if (game.state === STATE.FINISHED || game.player.finished || game.player.eliminated || HEADLESS_EXTERNAL_STATE.frames >= config.frames) break;
    const beforeProgress = rlRuntime.progressValue(game.player);
    const beforeLap = game.player.lap || 0;
    const beforeFinished = !!game.player.finished;
    HEADLESS_EXTERNAL_STATE.simSeconds += 1 / 60;
    HEADLESS_EXTERNAL_STATE.frames++;
    game.startTime = performance.now() - HEADLESS_EXTERNAL_STATE.simSeconds * 1000;
    rlRuntime.update(1, HEADLESS_EXTERNAL_STATE.simSeconds * 1000);
    game.skidMarks.length = 0;
    reward += computeHeadlessStepReward(game.player, beforeProgress, beforeLap, beforeFinished);
    if (rlRuntime.areAllHumansDone()) rlRuntime.finishRace();
  }
  const done = game.state === STATE.FINISHED || game.player.finished || game.player.eliminated || HEADLESS_EXTERNAL_STATE.frames >= config.frames;
  const obs = getHeadlessObservation(game.player);
  window.__lastRlRanking = rlRuntime.rankAll().map(k => ({
    name: k.name,
    charId: k.charId,
    finished: !!k.finished,
    eliminated: !!k.eliminated,
    progress: rlRuntime.progressValue(k),
  }));
  return {
    obs: obs.values,
    reward,
    done,
    info: {
      frame: HEADLESS_EXTERNAL_STATE.frames,
      simSeconds: HEADLESS_EXTERNAL_STATE.simSeconds,
      raceTime: game.raceTime,
      progress: rlRuntime.progressValue(game.player),
      lap: game.player.lap,
      finished: !!game.player.finished,
      totalReward: HEADLESS_EXTERNAL_STATE.reward,
      coins: game.player.coinsCollected || 0,
      itemUses: game.player.itemUseCount || 0,
      ultUses: game.player.ultUseCount || 0,
      driftBoosts: game.player.driftBoostCount || 0,
      mode: config.mode,
      approvals: game.player.approvals || 0,
      steals: game.player.battleSteals || 0,
      eliminated: !!game.player.eliminated,
      survivors: getActiveKarts().filter(k => k && !k.eliminated).length,
      battleWin: game.state === STATE.FINISHED && !game.player.eliminated,
    },
  };
}

export function noopParticleSystem() {
  return {
    list: [],
    add() {},
    burst() {},
    update() {},
    draw() {},
  };
}

export function getPolicyCheckpointCenter(kart) {
  if (!game.track) return null;
  const count = game.track.checkpointCount || game.track.n;
  const idx = game.track.isOpen ? Math.min(kart.nextCheckpoint, count - 1) : (kart.nextCheckpoint % count);
  return game.track.checkpointCenter(idx);
}
