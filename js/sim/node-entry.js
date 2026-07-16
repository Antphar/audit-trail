import "./node-env.js";

import { runtime } from "../entities/runtime.js";
import { rlRuntime } from "../rl/rl-runtime.js";
import { getKartById } from "../core/state.js";
import {
  buildRaceSim,
  rankAll,
  progressValue,
  finishRaceSim,
  areAllHumansDone,
  getKartCollisionRadius,
  getDragonTarget,
  getWeightedItem,
  AI_DIFFICULTIES,
  BATTLE_ARENA_ID,
} from "../modes/race.js";
import {
  triggerQuote,
  activateUltimate,
  startMergeRequestPull,
} from "../modes/battle.js";
import { getKartId } from "../net/p2p.js";
import { game } from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { setupExternalRlApi } from "../rl/api.js";
import { loadHeadlessPolicyModel } from "../rl/headless.js";

const TOTAL_LAPS = 3;
const AI_COUNT = 4;
const AI_DIFFICULTY = "normal";

function wireRuntime() {
  runtime.aiCount = AI_COUNT;
  runtime.aiDifficulty = AI_DIFFICULTY;
  runtime.rankAll = rankAll;
  runtime.progressValue = progressValue;
  runtime.finishRaceSim = finishRaceSim;
  runtime.finishRace = finishRaceSim;
  runtime.areAllHumansDone = areAllHumansDone;
  runtime.getTotalLaps = () => TOTAL_LAPS;
  runtime.getKartCollisionRadius = getKartCollisionRadius;
  runtime.getDragonTarget = getDragonTarget;
  runtime.getKartById = getKartById;
  runtime.getWeightedItem = getWeightedItem;
  runtime.triggerQuote = triggerQuote;
  runtime.activateUltimate = activateUltimate;
  runtime.getKartId = getKartId;
  runtime.startMergeRequestPull = startMergeRequestPull;
  runtime.pushSkidMark = () => {};
  runtime.triggerShootEffect = () => {};
  runtime.sendP2pMessage = () => {};
  runtime.applyDeauthShockwave = () => {};
  runtime.scheduleFinishRace = () => {};
  runtime.requestP2pPickup = () => {};
}

function wireRlRuntime() {
  rlRuntime.hideAll = () => {};
  rlRuntime.buildRace = () => {
    runtime.aiCount = AI_COUNT;
    runtime.aiDifficulty = AI_DIFFICULTY;
    buildRaceSim();
  };
  rlRuntime.update = () => {};
  rlRuntime.finishRace = finishRaceSim;
  rlRuntime.AI_DIFFICULTIES = AI_DIFFICULTIES;
  rlRuntime.aiDifficulty = AI_DIFFICULTY;
  rlRuntime.BATTLE_ARENA_ID = BATTLE_ARENA_ID;
}

wireRuntime();
wireRlRuntime();

Sound.init({
  getInitialSettings: () => ({ muted: true, musicVolume: 0, sfxVolume: 0 }),
  saveSettings: () => {},
  getPlayerSpatial: () => {
    const p = game?.player;
    return p ? { x: p.x, y: p.y, heading: p.heading } : null;
  },
  isPlayerOnFinalLap: () => false,
  getMusicIntensity: () => 0,
});
Sound.muted = true;

try {
  await loadHeadlessPolicyModel();
} catch (err) {
  globalThis.__HEADLESS_MODEL_ERROR__ = String(err?.message ?? err);
}

setupExternalRlApi();

export const rlReset = (...args) => globalThis.rlReset(...args);
export const rlStep = (...args) => globalThis.rlStep(...args);
export const rlSetRolloutPolicy = (...args) => globalThis.rlSetRolloutPolicy(...args);
export const rlRollout = (...args) => globalThis.rlRollout(...args);
export const rlActions = globalThis.rlActions;
export const rlObservationKeys = globalThis.rlObservationKeys;

export default {
  rlReset,
  rlStep,
  rlSetRolloutPolicy,
  rlRollout,
  rlActions,
  rlObservationKeys,
};
