import { mulberry32 } from "../core/math.js";
import { ellipseNormDist } from "../core/math.js";
import { CHARACTERS } from "../config/characters.js";
import { game, isDayMode } from "../core/state.js";
import { Track } from "../entities/track.js";
import { PlayerKart } from "../entities/player-kart.js";
import { AIKart } from "../entities/ai-kart.js";
import {
  isKartAirborne,
  integrateKartVertical,
  checkTrackRamps,
  constrainArenaKart,
} from "../entities/kart.js";
import { kartVisualZOffset } from "../entities/particles.js";
import {
  HEADLESS_DQN_ACTIONS,
  HEADLESS_OBS_KEYS,
  getHeadlessObservation,
} from "./observation.js";
import {
  HEADLESS_EXTERNAL_STATE,
  TrainedAIKart,
  HeadlessExternalKart,
  makeHeadlessConfig,
  configureHeadlessEpisode,
  headlessRlStepOnce,
  headlessExternalTerminal,
  runHeadlessDqn,
  expandCompactDqnPolicy,
  validateDqnModelPayload,
  selectHeadlessCharacter,
  selectHeadlessMap,
  enableHeadlessAgent,
  noopParticleSystem,
} from "./headless.js";
import { STATE } from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { rlRuntime } from "./rl-runtime.js";
import {
  serializeKartCompact,
  serializeKartState,
  applyKartState,
  handleP2pData,
} from "../net/p2p.js";

import { setTimeOfDay } from "../ui/menus.js";
let testHooks = {};

export function installTestHooks(hooks = {}) {
  testHooks = { ...testHooks, ...hooks };
}

export function setupExternalRlApi() {
  window.rlActions = HEADLESS_DQN_ACTIONS;
  window.rlObservationKeys = HEADLESS_OBS_KEYS;
  window.rlReset = (overrides = {}) => {
    const config = makeHeadlessConfig({ ...overrides, agent: "external" });
    HEADLESS_EXTERNAL_STATE.config = config;
    HEADLESS_EXTERNAL_STATE.simSeconds = 0;
    HEADLESS_EXTERNAL_STATE.frames = 0;
    HEADLESS_EXTERNAL_STATE.reward = 0;
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
    const agent = enableHeadlessAgent("external");
    configureHeadlessEpisode(config);
    game.particles = noopParticleSystem();
    game.skidMarks = [];
    game.state = STATE.RACING;
    game.startTime = performance.now();
    game.raceTime = 0;
    const obs = getHeadlessObservation(game.player);
    return {
      obs: obs.values,
      obsKeys: obs.keys,
      actions: HEADLESS_DQN_ACTIONS,
      done: false,
      info: {
        agent,
        mode: config.mode,
        map: map.id,
        mapName: map.name,
        character: CHARACTERS[game.selectedCharIdx || 0].id,
        opponentModelsApplied: game.ais ? game.ais.filter(ai => ai instanceof TrainedAIKart).length : 0,
        opponentCount: game.ais ? game.ais.length : 0,
      },
    };
  };
  window.rlStep = (action) => {
    const config = HEADLESS_EXTERNAL_STATE.config || makeHeadlessConfig({ agent: "external" });
    if (!HEADLESS_EXTERNAL_STATE.config) window.rlReset(config);
    return headlessRlStepOnce(action);
  };
  window.rlSetRolloutPolicy = (policy) => {
    if (!policy || policy.type !== "dqn") {
      throw new Error("rlSetRolloutPolicy requires a DQN policy");
    }
    const expanded = expandCompactDqnPolicy(policy);
    validateDqnModelPayload(expanded);
    window.__ROLLOUT_POLICY__ = expanded;
    return true;
  };
  window.rlRollout = (config) => {
    const policy = config?.policy || window.__ROLLOUT_POLICY__;
    if (!policy || policy.type !== "dqn") {
      throw new Error("rlRollout requires a DQN policy");
    }
    if (config?.policy) {
      validateDqnModelPayload(policy);
      window.__ROLLOUT_POLICY__ = policy;
    }
    if (headlessExternalTerminal()) {
      return { trajectory: [], stoppedReason: "alreadyDone", count: 0 };
    }
    const epsilons = Array.isArray(config.epsilons) ? config.epsilons : [];
    const maxSteps = Math.max(0, Math.floor(config.maxSteps ?? epsilons.length));
    const rng = mulberry32((config.seed >>> 0) || 0);
    const trajectory = [];
    for (let i = 0; i < maxSteps; i++) {
      if (headlessExternalTerminal()) break;
      const epsilon = Math.min(1, Math.max(0, Number(epsilons[i] ?? 0)));
      const baseObs = getHeadlessObservation(game.player);
      const decision = runHeadlessDqn(policy, baseObs, game.player);
      const actionCount = Array.isArray(policy.actions) && policy.actions.length
        ? policy.actions.length
        : HEADLESS_DQN_ACTIONS.length;
      let actionIndex;
      if (rng() < epsilon) {
        actionIndex = Math.floor(rng() * actionCount);
      } else {
        actionIndex = decision.actionIndex;
      }
      const stepResult = headlessRlStepOnce(actionIndex);
      let qMax = null;
      let qMean = null;
      if (Array.isArray(decision.qValues) && decision.qValues.length) {
        qMax = decision.qValues[0];
        let sum = 0;
        for (let qi = 0; qi < decision.qValues.length; qi++) {
          const v = decision.qValues[qi];
          if (v > qMax) qMax = v;
          sum += v;
        }
        qMean = sum / decision.qValues.length;
        if (!Number.isFinite(qMax)) qMax = null;
        if (!Number.isFinite(qMean)) qMean = null;
      }
      trajectory.push({
        obs: stepResult.obs,
        action: actionIndex,
        reward: stepResult.reward,
        done: stepResult.done,
        info: stepResult.info,
        qMax,
        qMean,
      });
      if (stepResult.done) {
        return { trajectory, stoppedReason: "done", count: trajectory.length };
      }
    }
    return {
      trajectory,
      stoppedReason: trajectory.length < maxSteps ? "terminal" : "maxSteps",
      count: trajectory.length,
    };
  };
  window.__HEADLESS_READY__ = true;
}

/** Assign every window.* Playwright / test-hook export from this module. */
export function installWindowExports() {
  window.game = game;
  window.update = rlRuntime.update;
  window.handleP2pData = handleP2pData;
  window.startMergeRequestPull = rlRuntime.startMergeRequestPull;
  window.Track = Track;
  window.PlayerKart = PlayerKart;
  window.AIKart = AIKart;
  window.CHARACTERS = CHARACTERS;
  window.isUntimedHumanBattle = testHooks.isUntimedHumanBattle;
  window.qualifiesApprovalRam = testHooks.qualifiesApprovalRam;
  window.resolveFreshBattleAttribution = testHooks.resolveFreshBattleAttribution;
  window.popApproval = testHooks.popApproval;
  window.tryApprovalRam = testHooks.tryApprovalRam;
  window.checkBattleEnd = testHooks.checkBattleEnd;
  window.isKartAirborne = isKartAirborne;
  window.integrateKartVertical = integrateKartVertical;
  window.checkTrackRamps = checkTrackRamps;
  window.constrainArenaKart = constrainArenaKart;
  window.kartVisualZOffset = kartVisualZOffset;
  window.isGroundHazardImmuneWhenAirborne = testHooks.isGroundHazardImmuneWhenAirborne;
  window.serializeKartCompact = serializeKartCompact;
  window.serializeKartState = serializeKartState;
  window.applyKartState = applyKartState;
  window.isDayMode = isDayMode;
  window.setTimeOfDay = setTimeOfDay;
  window.ellipseNormDist = ellipseNormDist;
}
