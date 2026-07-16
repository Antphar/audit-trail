import fs from "node:fs";
import path from "node:path";

import "./node-env.js";

import { runtime } from "../entities/runtime.js";
import { rlRuntime } from "../rl/rl-runtime.js";
import { getKartById, game, getActiveKarts } from "../core/state.js";
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
  ITEM_NAMES,
} from "../modes/race.js";
import {
  triggerQuote,
  activateUltimate,
  startMergeRequestPull,
} from "../modes/battle.js";
import { getKartId } from "../net/p2p.js";
import { Sound } from "../audio/sound.js";
import { setupExternalRlApi } from "../rl/api.js";
import {
  loadHeadlessPolicyModel,
  makeHeadlessConfig,
  runHeadlessEpisode,
  runHeadlessDqn,
  runHeadlessSac,
  validateModelPayload,
} from "../rl/headless.js";
import { getHeadlessObservation } from "../rl/observation.js";

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
  runtime.ITEM_NAMES = ITEM_NAMES;
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

export function getRanking() {
  return globalThis.__lastRlRanking || rankAll().map((k) => ({
    name: k.name,
    charId: k.charId,
    finished: !!k.finished,
    eliminated: !!k.eliminated,
    progress: progressValue(k),
  }));
}

export function getOpponentApprovals(playerChar) {
  const karts = typeof getActiveKarts === "function" ? getActiveKarts() : [];
  const opp = karts.find((k) => k && k.charId !== playerChar);
  return opp ? (opp.approvals || 0) : 0;
}

export function decideHeadlessAction(weights) {
  const observation = getHeadlessObservation(game.player);
  const decision = weights.type === "sac"
    ? runHeadlessSac(weights, observation, game.player)
    : runHeadlessDqn(weights, observation, game.player);
  return decision.action;
}

export function getEpisodeRanking() {
  return rankAll().map((k) => ({
    name: k.name,
    charId: k.charId,
    finished: !!k.finished,
    eliminated: !!k.eliminated,
    progress: progressValue(k),
    lap: k.lap,
    coins: k.coinsCollected || 0,
    itemUses: k.itemUseCount || 0,
    ultUses: k.ultUseCount || 0,
    driftBoosts: k.driftBoostCount || 0,
  }));
}

export function runHeadlessModelEval(params = {}) {
  const modelPath = params.modelPath;
  if (!modelPath) throw new Error("modelPath is required");
  const resolved = path.resolve(String(modelPath));
  const model = JSON.parse(fs.readFileSync(resolved, "utf8"));
  validateModelPayload(model);
  globalThis.HEADLESS_DQN_WEIGHTS = model;

  const config = makeHeadlessConfig({
    agent: "dqn",
    mode: params.mode || "race",
    map: params.map,
    character: params.character,
    frames: params.frames ?? 7200,
    solo: params.solo ?? true,
    noItems: params.noItems ?? true,
    noHazards: params.noHazards ?? true,
    frameSkip: params.frameSkip ?? 4,
    trace: !!params.trace,
    traceEvery: params.traceEvery ?? 20,
  });

  const episodes = [];
  const episodeCount = Math.max(1, Number(params.episodes || 1));
  for (let i = 0; i < episodeCount; i++) {
    episodes.push(runHeadlessEpisode(config, i));
  }

  const totalFrames = episodes.reduce((sum, e) => sum + e.frames, 0);
  const totalSimSeconds = episodes.reduce((sum, e) => sum + e.simSeconds, 0);
  const totalPlayerLaps = episodes.reduce((sum, e) => sum + (e.playerLap || 0), 0);
  const totalReward = episodes.reduce((sum, e) => sum + (e.reward || 0), 0);

  return {
    mode: "headless",
    config,
    episodes,
    aggregate: {
      totalFrames,
      totalSimSeconds: Math.round(totalSimSeconds * 1000) / 1000,
      totalPlayerLaps,
      totalReward: Math.round(totalReward * 1000) / 1000,
      avgReward: Math.round((totalReward / episodes.length) * 1000) / 1000,
      finishCount: episodes.filter((e) => e.playerFinished).length,
      avgPlayerProgress: Math.round((episodes.reduce((sum, e) => {
        const player = e.ranking.find((r) => r.charId === e.character);
        return sum + (player ? player.progress : 0);
      }, 0) / episodes.length) * 1000) / 1000,
    },
  };
}

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
