import { screens } from "./ui/screens.js";
import {
  SETTINGS_STORAGE_KEY,
  RECORDS_STORAGE_KEY,
  loadGameSettings,
  loadRecords,
  getMapRecord,
  updateMapRecord,
} from "./core/settings.js";
import { TUNING, QUOTES } from "./config/tuning.js";
import {
  DEFAULT_KART_COLLISION_RADIUS,
  CHARACTERS,
  DEFAULT_VEHICLE_PROFILE,
  VEHICLE_PROFILES_BY_ID,
  getVehicleProfile,
} from "./config/characters.js";
import {
  TAU,
  lerp,
  clamp,
  dist,
  angleDiff,
  pointSegProjection,
  rand,
  pick,
  hexToRgba,
  ellipseNormDist,
  mulberry32,
} from "./core/math.js";
import {
  COMPASS_VISUAL,
  getMapDayPalette,
  getMap3DTheme,
} from "./config/themes.js";
import {
  keysP1,
  keysP2,
  keysGlobal,
  setActionCode,
  resetAllInputs,
  pollGamepads,
  consumePressedGlobal,
  consumePressedP1,
  consumePressedP2,
  consumePressed,
} from "./core/input.js";
import {
  MAPS,
  GRAND_PRIX_ID,
  clampLaps,
  clampGrandPrixRaces,
  clampAiCount,
  regenerateDragonTrail,
} from "./config/maps.js";
import { bus } from "./core/events.js";
import {
  STATE,
  game,
  normalizeTimeOfDay,
  applySavedSettingsBoot,
  isBattleMode,
  isDayMode,
  isGrandPrixSelection,
  isGrandPrixActive,
  shouldShowGrandPrixCard,
  isP2pBattleGuest,
  isP2pBattleHost,
  canResolveBattleCombat,
  getActiveKarts,
  getKartById,
} from "./core/state.js";
import { Sound, registerSoundListeners } from "./audio/sound.js";
import {
  serializeKart,
  applyKartSync,
} from "./net/sync-schema.js";

import { runtime } from "./entities/runtime.js";
import {
  ParticleSystem,
  pushSkidMark,
  spawnCompassRevokeFx,
  spawnApprovalTransferToken,
  spawnCompassRamFx,
  spawnRampLaunchFx,
  spawnRampLandingFx,
  drawCompassSealMini,
  kartVisualZOffset,
  COMPASS_FX_3D_OVERLAY_MAX,
} from "./entities/particles.js";
import {
  MergeConflict,
  PlaceboPill,
  DoubleBlindCloud,
  RegulatoryProjectile,
  DossierProjectile,
  DragonFire,
  resetHazardIdCounter,
} from "./entities/items.js";
import { Track, WORLD_W, WORLD_H } from "./entities/track.js";
import {
  Kart,
  isKartAirborne,
  isKartGrounded,
  integrateKartVertical,
  constrainArenaKart,
  checkTrackRamps,
  applyMergeRequestPull,
} from "./entities/kart.js";
import { PlayerKart } from "./entities/player-kart.js";
import { AIKart } from "./entities/ai-kart.js";

import { renderRuntime } from "./render/render-runtime.js";
import {
  THREE_STATE,
  loadThreeJS,
  hudCanvas,
} from "./render/three-state.js";
import {
  setViewMode,
  init3DScene,
  apply3DMapTheme,
} from "./render/three-scene.js";
import { rebuild3DTrack } from "./render/three-track.js";
import {
  draw3D,
  spawn3DShockwave,
  emit3DItemPickupBurst,
} from "./render/three-frame.js";
import { URL_PARAMS, HEADLESS_MODE, headlessFlag } from "./core/env.js";
import { netRuntime } from "./net/net-runtime.js";
import { rlRuntime } from "./rl/rl-runtime.js";
import {
  peer,
  setPeer,
  p2pConnections,
  loadPeerJS,
  generateLobbyCode,
  getKartId,
  sendP2pMessage,
  serializeKartState,
  applyKartState,
  serializeKartCompact,
  sendHostSync,
  sendGuestSync,
  handleP2pData,
  handleP2pDisconnect,
  addP2pGuest,
  removeP2pGuestByConn,
  broadcastP2pLobby,
  broadcastP2pMessage,
  resetP2pReadyForLobbyChange,
  getP2pLobbyMapPayload,
  p2pReturnToLobbyLocal,
  p2pHostCancelRaceToLobby,
  p2pGuestLeaveMatch,
  sendP2pBattleEnd,
  applyP2pPickupRequest,
  sendToConn,
} from "./net/p2p.js";
import {
  HEADLESS_DQN_ACTIONS,
  HEADLESS_OBS_KEYS,
  headlessObsKeys,
} from "./rl/observation.js";
import {
  validateModelPayload,
  makeHeadlessConfig,
  runHeadlessSimulation,
  loadHeadlessPolicyModel,
} from "./rl/headless.js";
import {
  setupExternalRlApi,
  installWindowExports,
  installTestHooks,
} from "./rl/api.js";

import { simulationStep } from "./sim/step.js";
import {
  applyDeauthShockwave, startMergeRequestPull, triggerQuote, activateUltimate,
  initBattleKartState, eliminateKart, popApproval, tryApprovalRam, qualifiesApprovalRam,
  resolveFreshBattleAttribution, checkBattleEnd, isUntimedHumanBattle, getViewKart,
  updateSpectate, triggerHitFlash, absorbFatalHitWithShield, registerBattleHit,
  updateBattleApprovals,
} from "./modes/battle.js";
import {
  gridSlot, buildRaceSim, finishRaceSim, areAllHumansDone, rankAll, progressValue,
  getWeightedItem, ITEM_NAMES, checkProgress, checkItems, kartCollisions,
  getDragonTarget, createDragonEscapeEntity, updateDragonEscapeEntity,
  applyRocketStart, startRaceSim, getKartCollisionRadius, kartPickupThreshold, getRayObjectRadius,
  isDragonEscape, isGroundHazardImmuneWhenAirborne, shouldSkipGroundHazardForKart,
  applyMovingObstacleHit, showMovingObstacleHit, AI_DIFFICULTIES, BATTLE_ARENA_ID,
  normalizeAiDifficulty,
} from "./modes/race.js";


import { draw } from "./render/draw2d.js";
import {
  drawHUD, drawHUDMultiplayer, drawCountdown, drawFinishBanner, drawApprovals3DOverlay,
} from "./render/hud.js";
import { uiRuntime } from "./ui/ui-runtime.js";
import {
  showSelectScreen, renderSelectScreen, renderMapSelect, renderApprovalsSelect,
  renderRaceSetupSettings, applyLobbyMapSelection, ensureSelectedMapMatchesMode,
  prepareRaceFormatFromSelection, clampApprovals, getTournamentRaceMapIdx,
  createGrandPrixTournament, selectGrandPrixMap, getCharAvatarSVG, getRaceStartButtonLabel,
  updateDriveButtonLabel, initRaceSetupListeners,
} from "./ui/select.js";
import {
  renderP2pLobby, resetP2pLobbyDom, ensureHostP2pPlayer, startP2pJoinAttempt,
  updateSelectionHighlight, updateP2pStartButton, updateP2pBattleLobbyUi,
  checkMultiplayerSelectFinish, enterP2pSelectScreen,
  syncP2pSelectionFromRoster, startP2pRaceFromSelection, initLobbyUi,
  updatePauseScreenUi, getP2pIceConfig, setLocalP2pCharacterIdx, getP2pReadyCount,
  getLocalP2pPlayer,
} from "./ui/lobby.js";
import {
  showFinishScreen, hideAll, showMainMenu, showSettingsScreen, returnFromSettings,
  setMusicTrack, previewSelectedMapMusic, setTimeOfDay, initMenusUi, showGameToast,
} from "./ui/menus.js";
import { TrainedAIKart, DqnAIKart } from "./rl/headless.js";


/* ============================================================
   AUDIT TRAIL — single-file arcade kart racer
   - Top-down kart racing with curved track and AI opponents
   - Custom physics (accel, friction, drift, lateral grip, boost)
   - Items: coins, boost pads, mystery item boxes
   - HUD, mini-map, particles, screen shake, Web Audio SFX
   ============================================================ */

// ---- DOM ----
const canvas = document.getElementById("game");
let ctx = canvas.getContext("2d");
const titleScreen = document.getElementById("title-screen");
const settingsScreen = document.getElementById("settings-screen");
const selectScreen = document.getElementById("select-screen");
const pauseScreen = document.getElementById("pause-screen");
const finishScreen = document.getElementById("finish-screen");
const finishResults = document.getElementById("finish-results");
const finishTitle = document.getElementById("finish-title");
const start1pBtn = document.getElementById("start-1p-btn");
const start2pBtn = document.getElementById("start-2p-btn");
const startBattleBtn = document.getElementById("start-battle-btn");
const driveBtn = document.getElementById("drive-btn");
const selectBackBtn = document.getElementById("select-back-btn");
const pauseResumeBtn = document.getElementById("pause-resume-btn");
const pauseRestartBtn = document.getElementById("pause-restart-btn");
const pauseSettingsBtn = document.getElementById("pause-settings-btn");
const pauseMenuBtn = document.getElementById("pause-menu-btn");
const restartBtn = document.getElementById("restart-btn");
const nextTrackBtn = document.getElementById("next-track-btn");
const finishMenuBtn = document.getElementById("finish-menu-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsBackBtn = document.getElementById("settings-back-btn");
const musicVolumeInput = document.getElementById("music-volume-input");
const musicVolumeValue = document.getElementById("music-volume-value");
const sfxVolumeInput = document.getElementById("sfx-volume-input");
const sfxVolumeValue = document.getElementById("sfx-volume-value");
const aiSelectSection = document.getElementById("ai-select-section");
const aiModelSelect = document.getElementById("ai-model-select");
const aiModelStatus = document.getElementById("ai-model-status");
const aiImportBtn = document.getElementById("ai-import-btn");
const aiImportInput = document.getElementById("ai-import-input");
const aiOpponentGrid = document.getElementById("ai-opponent-grid");

const p2pScreen = document.getElementById("p2p-screen");

screens.register("title", titleScreen);
screens.register("settings", settingsScreen);
screens.register("select", selectScreen);
screens.register("pause", pauseScreen);
screens.register("finish", finishScreen);
screens.register("p2p", p2pScreen);

let aiModelManifest = null;
const DEFAULT_AI_MODEL_ID = "dqn-selfplay-booster-stack4-skip6";
// Trained-model opponents in interactive play: the lobby model picker lets you
// battle trained agents (e.g. DQN Arena v5). Flip to false to hide the picker.
const TRAINED_AI_ENABLED = true;
let selectedAiModelId = DEFAULT_AI_MODEL_ID;
let selectedAiModelWeights = null;
let selectedAiOpponentModels = {};
let selectedAiOpponentWeights = {};
let isStartingRace = false;

const savedSettings = loadGameSettings();
applySavedSettingsBoot(savedSettings);


function saveGameSettings(patch = {}) {
  try {
    const next = {
      viewMode: game?.viewMode || savedSettings.viewMode || "2d",
      musicTrack: Sound?.trackIdx ?? savedSettings.musicTrack ?? 0,
      muted: !!Sound?.muted,
      musicVolume: Sound?.musicVolume ?? savedSettings.musicVolume ?? 0.8,
      sfxVolume: Sound?.sfxVolume ?? savedSettings.sfxVolume ?? 1.0,
      totalLaps: typeof TOTAL_LAPS === "number" ? TOTAL_LAPS : (savedSettings.totalLaps ?? 3),
      grandPrixRaces: typeof grandPrixRaces === "number" ? grandPrixRaces : clampGrandPrixRaces(savedSettings.grandPrixRaces ?? savedSettings.seriesRaces ?? 3),
      aiCount: typeof aiCount === "number" ? aiCount : (savedSettings.aiCount ?? 4),
      aiDifficulty: typeof aiDifficulty === "string" ? aiDifficulty : (savedSettings.aiDifficulty ?? "normal"),
      battleUntimed: !!(game?.battleUntimed ?? savedSettings.battleUntimed),
      timeOfDay: normalizeTimeOfDay(game?.timeOfDay ?? savedSettings.timeOfDay),
      ...patch,
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    // Storage can be unavailable in private mode or sandboxed embeds.
  }
}

function normalizeVolume(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

// ---- Personal best records (per map) ----

// ---- Game Tuning Constants ----

// ---- Character Configurations ----


// ---- Speech Bubble Commit Quotes ----

function makeTypo(str) {
  if (Math.random() > 0.45) return str;
  const chars = str.split("");
  if (chars.length < 4) return str;
  const i = Math.floor(rand(1, chars.length - 2));
  const r = Math.random();
  if (r < 0.4) {
    const temp = chars[i];
    chars[i] = chars[i+1];
    chars[i+1] = temp;
  } else if (r < 0.7) {
    chars.splice(i, 1);
  } else {
    chars.splice(i, 0, chars[i]);
  }
  return chars.join("");
}

function triggerShootEffect(kart, item) {
  bus.emit("kart:itemUsed", { kart, item });
  const fx = Math.cos(kart.heading);
  const fy = Math.sin(kart.heading);
  const lx = -Math.sin(kart.heading);
  const ly = Math.cos(kart.heading);

  if (item === "boost") {
    // Smoke & orange sparks behind kart
    if (game.particles) {
      game.particles.burst(kart.x - fx * 20, kart.y - fy * 20, "#ff9d00", 15, { spdMin: 1, spdMax: 3 });
      for (let i = 0; i < 8; i++) {
        const ang = kart.heading + Math.PI + rand(-0.3, 0.3);
        const sp = rand(1, 2.5);
        game.particles.add({
          type: "spark",
          x: kart.x - fx * 20,
          y: kart.y - fy * 20,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          life: rand(20, 40),
          maxLife: 40,
          size: rand(3, 7),
          color: "rgba(200, 200, 200, 0.4)",
          drag: 0.94
        });
      }
    }
  } else if (item === "shield") {
    if (game.particles) {
      // Circular glow ring
      game.particles.add({
        type: "ring",
        x: kart.x,
        y: kart.y,
        vx: 0,
        vy: 0,
        life: 25,
        maxLife: 25,
        size: 32,
        startSize: 5,
        color: "#00ffcc"
      });
      game.particles.burst(kart.x, kart.y, "#00ffcc", 10, { spdMin: 1.5, spdMax: 3.5 });
    }
  } else if (item === "handling") {
    if (game.particles) {
      game.particles.add({
        type: "ring",
        x: kart.x,
        y: kart.y,
        vx: 0,
        vy: 0,
        life: 20,
        maxLife: 20,
        size: 24,
        startSize: 3,
        color: "#d946ef"
      });
      game.particles.burst(kart.x, kart.y, "#d946ef", 8, { spdMin: 1, spdMax: 3 });
    }
  } else if (item === "conflict") {
    if (game.particles) {
      game.particles.burst(kart.x - fx * 20, kart.y - fy * 20, "#ff4d6d", 12, { spdMin: 1, spdMax: 2.5 });
    }
  } else if (item === "placebo") {
    if (game.particles) game.particles.burst(kart.x - fx * 22, kart.y - fy * 22, "#ffcc00", 14, { spdMin: 1.5, spdMax: 3.5 });
  } else if (item === "doubleblind") {
    if (game.particles) game.particles.burst(kart.x, kart.y, "#bd57ff", 18, { spdMin: 1.5, spdMax: 4 });
  } else if (item === "dossier") {
    if (game.particles) {
      // Cyan muzzle burst in front of kart
      game.particles.burst(kart.x + fx * 24, kart.y + fy * 24, "#57f2ff", 15, { spdMin: 2, spdMax: 5 });
    }
  } else if (item === "deauth") {
    if (game.particles) {
      for (let i = 0; i < 3; i++) {
        game.particles.add({
          type: "ring",
          x: kart.x,
          y: kart.y,
          vx: 0,
          vy: 0,
          life: 26 + i * 8,
          maxLife: 26 + i * 8,
          size: 95 + i * 34,
          startSize: 18 + i * 8,
          color: i === 0 ? "#ff3366" : "rgba(255, 51, 102, 0.65)"
        });
      }
      game.particles.burst(kart.x, kart.y, "#ff3366", 22, { spdMin: 2, spdMax: 6 });
    }
  } else if (item === "mergerequest") {
    if (game.particles) {
      game.particles.add({
        type: "ring",
        x: kart.x,
        y: kart.y,
        vx: 0,
        vy: 0,
        life: 24,
        maxLife: 24,
        size: 46,
        startSize: 8,
        color: "#39ff14"
      });
      game.particles.burst(kart.x + fx * 18, kart.y + fy * 18, "#39ff14", 14, { spdMin: 1.5, spdMax: 4 });
    }
  } else if (item === "hotfix") {
    if (game.particles) {
      for (let i = 0; i < 4; i++) {
        game.particles.add({
          type: "ring",
          x: kart.x,
          y: kart.y,
          vx: 0,
          vy: 0,
          life: 20 + i * 6,
          maxLife: 20 + i * 6,
          size: 40 + i * 20,
          startSize: 5,
          color: i % 2 === 0 ? "#ffcc00" : "#ff6600"
        });
      }
      game.particles.burst(kart.x, kart.y, "#ffcc00", 30, { spdMin: 3, spdMax: 7 });
      game.particles.burst(kart.x, kart.y, "#ff6600", 20, { spdMin: 2, spdMax: 5 });
    }
  } else if (item === "fasttrack") {
    if (game.particles) {
      game.particles.add({
        type: "ring", x: kart.x, y: kart.y, vx: 0, vy: 0,
        life: 34, maxLife: 34, size: 72, startSize: 12, color: "#a4ff80"
      });
      game.particles.burst(kart.x, kart.y, "#a4ff80", 32, { spdMin: 2.5, spdMax: 7 });
    }
  }
}






// ---- Canvas sizing ----
let VIEW_W = 0, VIEW_H = 0;
let DPR = 1;
function resizeCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VIEW_W = window.innerWidth;
  VIEW_H = window.innerHeight;
  canvas.width = Math.floor(VIEW_W * DPR);
  canvas.height = Math.floor(VIEW_H * DPR);
  canvas.style.width = VIEW_W + "px";
  canvas.style.height = VIEW_H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

/* ============================================================
   MATH HELPERS
   ============================================================ */
/** Frozen App Compass palette for canvas/HUD drawing (checkpoint 1). */



/* ============================================================
   INPUT
   ============================================================ */

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  const tag = target && target.tagName ? target.tagName : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  const code = e.code;
  const key = e.key;
  const isGameplayActive = game.state === STATE.COUNTDOWN || game.state === STATE.RACING;
  const interactiveFocus = !!(target && typeof target.closest === "function" && target.closest("button, a, [role='button']"));

  // Prevent default scroll behavior for navigation keys only during active gameplay
  if (isGameplayActive && (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", " "].includes(key) || ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code))) {
    e.preventDefault();
  }

  // Global triggers (ignore repeat for one-shot toggles)
  if (!e.repeat) {
    if (key === "p" || key === "P" || code === "KeyP") {
      setActionCode("global", "pause", code, true);
    }
    if (key === "r" || key === "R" || code === "KeyR") {
      setActionCode("global", "restart", code, true);
    }
    if (key === "m" || key === "M" || code === "KeyM") {
      setActionCode("global", "mute", code, true);
    }
    if (key === "n" || key === "N" || code === "KeyN") {
      if (Sound.isPlayingMusic) {
        const nextIdx = ((Sound.trackIdx || 0) + 1) % Sound.tracks.length;
        Sound.switchTrack(nextIdx);
        Sound.showTrackToast();
      }
    }
    if ((key === "Enter" || code === "Enter") && !interactiveFocus) {
      setActionCode("global", "enter", code, true);
    }
    if (key === "Escape" || code === "Escape") {
      setActionCode("global", "back", code, true);
    }
  }

  // Player 1 mappings (WASD + Space + LeftShift)
  if (code === "KeyW") setActionCode("p1", "up", code, true);
  if (code === "KeyS") setActionCode("p1", "down", code, true);
  if (code === "KeyA") setActionCode("p1", "left", code, true);
  if (code === "KeyD") setActionCode("p1", "right", code, true);
  if (code === "Space" && !interactiveFocus) setActionCode("p1", "drift", code, true);
  if (code === "ShiftLeft") setActionCode("p1", "item", code, true);
  if (code === "KeyQ") setActionCode("p1", "ult", code, true);
  if (code === "KeyE") setActionCode("p1", "honk", code, true);

  // Player 2 mappings — only in local split-screen (not P2P online)
  const isSplitScreen = game.multiplayer && !game.p2pMode;
  const arrowTarget = isSplitScreen ? "p2" : "p1";
  if (code === "ArrowUp") setActionCode(arrowTarget, "up", code, true);
  if (code === "ArrowDown") setActionCode(arrowTarget, "down", code, true);
  if (code === "ArrowLeft") setActionCode(arrowTarget, "left", code, true);
  if (code === "ArrowRight") setActionCode(arrowTarget, "right", code, true);
  if (code === "ShiftRight") setActionCode(arrowTarget, "drift", code, true);
  if (code === "Slash" || code === "Period" || key === "/" || key === ".") setActionCode(arrowTarget, "item", code, true);
  if (code === "KeyL") setActionCode(arrowTarget, "ult", code, true);
  if (code === "KeyK") setActionCode(arrowTarget, "honk", code, true);

  Sound.ensure(); Sound.resume();
}, { passive: false });

window.addEventListener("keyup", (e) => {
  const code = e.code;
  const key = e.key;

  if (key === "p" || key === "P" || code === "KeyP") setActionCode("global", "pause", code, false);
  if (key === "r" || key === "R" || code === "KeyR") setActionCode("global", "restart", code, false);
  if (key === "m" || key === "M" || code === "KeyM") setActionCode("global", "mute", code, false);
  if (key === "Enter" || code === "Enter") setActionCode("global", "enter", code, false);
  if (key === "Escape" || code === "Escape") setActionCode("global", "back", code, false);

  // Player 1 keyups
  if (code === "KeyW") setActionCode("p1", "up", code, false);
  if (code === "KeyS") setActionCode("p1", "down", code, false);
  if (code === "KeyA") setActionCode("p1", "left", code, false);
  if (code === "KeyD") setActionCode("p1", "right", code, false);
  if (code === "Space") setActionCode("p1", "drift", code, false);
  if (code === "ShiftLeft") setActionCode("p1", "item", code, false);
  if (code === "KeyQ") setActionCode("p1", "ult", code, false);
  if (code === "KeyE") setActionCode("p1", "honk", code, false);
  if (code === "KeyL") {
    setActionCode("p2", "ult", code, false);
    setActionCode("p1", "ult", code, false);
  }
  if (code === "KeyK") {
    setActionCode("p2", "honk", code, false);
    setActionCode("p1", "honk", code, false);
  }

  // Player 2 / P1 fallback keyups
  if (code === "ArrowUp") {
    setActionCode("p2", "up", code, false);
    setActionCode("p1", "up", code, false);
  }
  if (code === "ArrowDown") {
    setActionCode("p2", "down", code, false);
    setActionCode("p1", "down", code, false);
  }
  if (code === "ArrowLeft") {
    setActionCode("p2", "left", code, false);
    setActionCode("p1", "left", code, false);
  }
  if (code === "ArrowRight") {
    setActionCode("p2", "right", code, false);
    setActionCode("p1", "right", code, false);
  }
  if (code === "ShiftRight") {
    setActionCode("p2", "drift", code, false);
    setActionCode("p1", "drift", code, false);
  }
  if (code === "Slash" || code === "Period" || key === "/" || key === ".") {
    setActionCode("p2", "item", code, false);
    setActionCode("p1", "item", code, false);
  }
});

window.addEventListener("blur", resetAllInputs);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetAllInputs();
    if (!HEADLESS_MODE && !game.p2pMode && (game.state === STATE.RACING || game.state === STATE.COUNTDOWN)) {
      pauseGame();
    }
  }
});


/* ============================================================
   TRACK
   ============================================================ */

// Closed-loop centerline waypoints. World coordinates.
// Designed with: long straight, sweeping curve, hairpin, chicane, narrow section.
// WORLD_W/WORLD_H live bindings imported from entities/track.js

// Multiple premium "Regulaido" stylized maps (tracks)


function getArenaMapIdx() {
  const idx = MAPS.findIndex((m) => m.id === BATTLE_ARENA_ID);
  return idx >= 0 ? idx : 0;
}
function isArenaMap(mapOrIdx) {
  const m = typeof mapOrIdx === "number" ? MAPS[mapOrIdx] : mapOrIdx;
  return !!(m && m.arena);
}


let TOTAL_LAPS = clampLaps(savedSettings.totalLaps ?? 3);

Sound.init({
  getInitialSettings: () => savedSettings,
  saveSettings: (patch) => saveGameSettings(patch),
  getPlayerSpatial: () => {
    const p = game?.player;
    return p ? { x: p.x, y: p.y, heading: p.heading } : null;
  },
  isPlayerOnFinalLap: () => game?.player && game.player.lap >= TOTAL_LAPS - 1,
  getMusicIntensity: () => {
    let intensity = 1.0;
    if (game?.player && !game.player.finished && (game.state === "racing" || game.state === "countdown")) {
      try {
        const rankings = rankAll();
        const totalKarts = rankings.length;
        if (totalKarts > 1) {
          const rank = rankings.indexOf(game.player) + 1;
          intensity = 1.0 - (rank - 1) / (totalKarts - 1);
        }
      } catch (e) { intensity = 1.0; }
    }
    return intensity;
  },
});
if (!HEADLESS_MODE) {
  registerSoundListeners(bus);
  bus.on("kart:driftTier", ({ kart, tier }) => {
    if (kart && (kart === game.player || (game.multiplayer && !game.p2pMode && kart === game.player2))) {
      Sound.playDriftTier(tier);
    }
    if (kart) game.particles?.burstDriftTier?.(kart.x, kart.y, tier);
  });
}


game.particles = new ParticleSystem();
let grandPrixRaces = clampGrandPrixRaces(savedSettings.grandPrixRaces ?? savedSettings.seriesRaces ?? 3);
let aiCount = clampAiCount(savedSettings.aiCount ?? 4);
let aiDifficulty = normalizeAiDifficulty(savedSettings.aiDifficulty);



// ---- 3D view controls (canvas3d/hudCanvas in render/three-state.js) ----
const view2dBtn = document.getElementById("view-2d-btn");
const view3dBtn = document.getElementById("view-3d-btn");

/* ============================================================
   GAME
   ============================================================ */


function pauseGame() {
  if (!(game.state === STATE.RACING || (game.p2pMode && game.state === STATE.COUNTDOWN))) return;
  game._pauseFromState = game.state;
  game._pausedAt = performance.now();
  game.state = STATE.PAUSED;
  screens.show("pause");
  updatePauseScreenUi();
}

function resumeFromPause() {
  if (game.state !== STATE.PAUSED) return;
  if (!game.p2pMode && game._pausedAt) {
    const delta = Math.max(0, performance.now() - game._pausedAt);
    if (game.startTime) game.startTime += delta;
    if (game.countdownStart) game.countdownStart += delta;
    if (game.p2pLastHostSyncReceivedAt) game.p2pLastHostSyncReceivedAt += delta;
    for (const k of getActiveKarts()) {
      if (k && k.lastLapAt) k.lastLapAt += delta;
    }
  }
  game._pausedAt = 0;
  screens.hide("pause");
  game.state = game._pauseFromState || STATE.RACING;
  game._pauseFromState = null;
  updatePauseScreenUi();
}

function restartCurrentRace() {
  if (game.p2pMode) return;
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  screens.hide("pause");
  game._pauseFromState = null;
  game._pausedAt = 0;
  startSelectedRace().catch(() => showSelectScreen());
}

function scheduleFinishRace(delay = 900) {
  if (game.finishScheduled || game.state === STATE.FINISHED) return;
  if (game._finishTimeoutId) clearTimeout(game._finishTimeoutId);
  game.finishScheduled = true;
  game._finishTimeoutId = setTimeout(() => {
    game._finishTimeoutId = null;
    game.finishScheduled = false;
    if ([STATE.RACING, STATE.PAUSED].includes(game.state) && areAllHumansDone()) finishRace();
  }, delay);
}

function buildRace() {
  if (game._finishTimeoutId) {
    clearTimeout(game._finishTimeoutId);
    game._finishTimeoutId = null;
  }
  if (game._mpStartTimeoutId) {
    clearTimeout(game._mpStartTimeoutId);
    game._mpStartTimeoutId = null;
  }
  game.finishScheduled = false;
  ensureSelectedMapMatchesMode();
  const mapConfig = MAPS[game.selectedMapIdx || 0];
  const mapId = mapConfig.id;
  const assignedTrack = Number.isInteger(mapConfig.musicTrack) ? mapConfig.musicTrack : (Sound.trackIdx || 0);
  Sound.trackIdx = Math.floor(clamp(assignedTrack, 0, Sound.tracks.length - 1));
  Sound.mapStyle = (mapId === "dragon_escape") ? "japanese" : "retro";
  if (Sound.mapStyle === "retro") {
    Sound.tempo = (Sound.tracks[Sound.trackIdx] || Sound.tracks[0]).tempo;
  } else {
    Sound.tempo = 90;
  }
  if (Sound.ctx) {
    Sound.stopMusic();
    Sound.startMusic();
  }
  runtime.aiCount = aiCount;
  runtime.aiDifficulty = aiDifficulty;
  buildRaceSim();
  if (game.viewMode === "3d" && THREE_STATE.loaded) {
    if (!THREE_STATE.renderer) init3DScene();
    rebuild3DTrack();
    const h = game.player.heading || 0;
    THREE_STATE.camSmooth = {
      x: game.player.x - Math.cos(h) * 95,
      y: 44,
      z: game.player.y - Math.sin(h) * 95,
      lx: game.player.x + Math.cos(h) * 40,
      ly: 12,
      lz: game.player.y + Math.sin(h) * 40,
      fov: 66,
      roll: 0,
    };
  }
}

function startCountdown() {
  game.state = STATE.COUNTDOWN;
  game.countdownStart = performance.now();
  game.countdownText = "3";
  game.rocketStartP1 = { holdStart: 0, holding: false, result: null };
  game.rocketStartP2 = { holdStart: 0, holding: false, result: null };
  if (game.p2pMode && game.p2pRole === "guest") {
    game.p2pLastHostSyncReceivedAt = performance.now();
  }
  Sound.countdown(false);
}

function startRace() {
  startRaceSim();
  Sound.countdown(true);
}

function finishRace() {
  if (game.state === STATE.FINISHED) return;
  finishRaceSim();
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  if (isGrandPrixActive(game.tournament) && game.p2pMode && game.p2pRole === "host") {
    sendP2pMessage({ type: "tournament_standings", tournament: game.tournament });
  }
  if (game.p2pMode && game.p2pRole === "host" && isBattleMode()) {
    sendP2pBattleEnd();
  }
  if (!HEADLESS_MODE) {
    const guestWaitBattleEnd = game.p2pMode && game.p2pRole === "guest" && isBattleMode();
    if (!guestWaitBattleEnd) {
      showFinishScreen();
      bus.emit("race:finished", {});
    }
  }
}

function requestP2pPickup(pickup, index, kart) {
  if (!game.p2pMode || game.p2pRole !== "guest" || kart !== game.player) return;
  sendP2pMessage({
    type: "pickup_request",
    pickup,
    index,
    kartId: getKartId(kart)
  });
}


// Entity runtime callbacks (assigned at boot; used by js/entities/*)
runtime.pushSkidMark = pushSkidMark;
runtime.triggerShootEffect = triggerShootEffect;
runtime.sendP2pMessage = sendP2pMessage;
runtime.getKartId = getKartId;
runtime.startMergeRequestPull = startMergeRequestPull;
runtime.applyDeauthShockwave = applyDeauthShockwave;
runtime.triggerQuote = triggerQuote;
runtime.rankAll = rankAll;
runtime.progressValue = progressValue;
runtime.getWeightedItem = getWeightedItem;
runtime.ITEM_NAMES = ITEM_NAMES;
runtime.activateUltimate = activateUltimate;
runtime.getKartCollisionRadius = getKartCollisionRadius;
runtime.getKartById = getKartById;
runtime.getTotalLaps = () => TOTAL_LAPS;
runtime.getDragonTarget = getDragonTarget;

runtime.finishRaceSim = finishRaceSim;
runtime.finishRace = finishRace;
runtime.scheduleFinishRace = scheduleFinishRace;
runtime.areAllHumansDone = areAllHumansDone;
runtime.applySelectedAiModelToOpponents = applySelectedAiModelToOpponents;
runtime.requestP2pPickup = requestP2pPickup;
runtime.emit3DItemPickupBurst = emit3DItemPickupBurst;
runtime.spawn3DShockwave = spawn3DShockwave;
runtime.aiCount = aiCount;
runtime.aiDifficulty = aiDifficulty;
runtime.playCountdown = (go) => Sound.countdown(go);
runtime.playCrash = () => Sound.crash();
runtime.playTone = (f, d, w, v, g) => Sound.tone(f, d, w, v, g);
runtime.playNoise = (d, v, f) => Sound.noise(d, v, f);
runtime.playDragonBreath = () => Sound.dragonBreath();
runtime.updateRetroTempo = () => {
  if (game.player && Sound.mapStyle === "retro" && !isBattleMode()) {
    const track = Sound.tracks[Sound.trackIdx || 0] || Sound.tracks[0];
    Sound.tempo = track.tempo + (game.player.lap >= TOTAL_LAPS - 1 ? TUNING.FINAL_LAP_TEMPO_BOOST : 0);
  }
};
runtime.updateJapaneseTempo = (intensity) => {
  if (Sound.mapStyle === "japanese") {
    Sound.tempo = 90 + Math.floor(intensity * 60);
  }
};


// ---- render runtime (3D subsystem callbacks) ----
renderRuntime.canvas = canvas;
renderRuntime.getCtx = () => ctx;
renderRuntime.setCtx = (c) => { ctx = c; };
renderRuntime.getViewW = () => VIEW_W;
renderRuntime.getViewH = () => VIEW_H;
renderRuntime.getDpr = () => DPR;
renderRuntime.saveGameSettings = saveGameSettings;
renderRuntime.getViewKart = getViewKart;
renderRuntime.view2dBtn = view2dBtn;
renderRuntime.view3dBtn = view3dBtn;
renderRuntime.getTotalLaps = () => TOTAL_LAPS;
renderRuntime.rankAll = rankAll;
renderRuntime.drawHUD = (time) => drawHUD(time);
renderRuntime.drawHUDMultiplayer = (time) => drawHUDMultiplayer(time);
renderRuntime.drawCountdown = () => drawCountdown();
renderRuntime.drawFinishBanner = () => drawFinishBanner();
renderRuntime.drawApprovals3DOverlay = (c, time) => drawApprovals3DOverlay(c, time);

// ---- ui runtime (menu/select/lobby callbacks) ----
uiRuntime.getTotalLaps = () => TOTAL_LAPS;
uiRuntime.setTotalLaps = (v) => { TOTAL_LAPS = clampLaps(v); };
uiRuntime.getGrandPrixRaces = () => grandPrixRaces;
uiRuntime.setGrandPrixRaces = (v) => { grandPrixRaces = clampGrandPrixRaces(v); };
uiRuntime.getAiCount = () => aiCount;
uiRuntime.setAiCount = (v) => { aiCount = clampAiCount(v); };
uiRuntime.getAiDifficulty = () => aiDifficulty;
uiRuntime.setAiDifficulty = (v) => { aiDifficulty = normalizeAiDifficulty(v); };
uiRuntime.saveGameSettings = saveGameSettings;
uiRuntime.hideAll = hideAll;
uiRuntime.buildRace = buildRace;
uiRuntime.startCountdown = startCountdown;
uiRuntime.rankAll = rankAll;
uiRuntime.showSelectScreen = showSelectScreen;
uiRuntime.renderMapSelect = renderMapSelect;
uiRuntime.renderApprovalsSelect = renderApprovalsSelect;
uiRuntime.renderRaceSetupSettings = renderRaceSetupSettings;
uiRuntime.previewSelectedMapMusic = previewSelectedMapMusic;
uiRuntime.renderAiModelSelector = renderAiModelSelector;
uiRuntime.refreshAiModelSelector = refreshAiModelSelector;
uiRuntime.renderAiOpponentSelectors = renderAiOpponentSelectors;
uiRuntime.getCharAvatarSVG = getCharAvatarSVG;
uiRuntime.prepareRaceFormatFromSelection = prepareRaceFormatFromSelection;
uiRuntime.clampApprovals = clampApprovals;
uiRuntime.updateSelectionHighlight = updateSelectionHighlight;
uiRuntime.updateP2pStartButton = updateP2pStartButton;
uiRuntime.updateP2pBattleLobbyUi = updateP2pBattleLobbyUi;
uiRuntime.updateDriveButtonLabel = updateDriveButtonLabel;
uiRuntime.updatePauseScreenUi = updatePauseScreenUi;
uiRuntime.getP2pReadyCount = getP2pReadyCount;
uiRuntime.setLocalP2pCharacterIdx = setLocalP2pCharacterIdx;
uiRuntime.syncP2pSelectionFromRoster = syncP2pSelectionFromRoster;

// ---- net runtime (p2p subsystem callbacks) ----
netRuntime.renderP2pLobby = renderP2pLobby;
netRuntime.applyLobbyMapSelection = applyLobbyMapSelection;
netRuntime.setMusicTrack = setMusicTrack;
netRuntime.previewSelectedMapMusic = previewSelectedMapMusic;
netRuntime.hideAll = hideAll;
netRuntime.showSelectScreen = showSelectScreen;
netRuntime.showFinishScreen = showFinishScreen;
netRuntime.buildRace = buildRace;
netRuntime.startCountdown = startCountdown;
netRuntime.enterP2pSelectScreen = enterP2pSelectScreen;
netRuntime.syncP2pSelectionFromRoster = syncP2pSelectionFromRoster;
netRuntime.updateSelectionHighlight = updateSelectionHighlight;
netRuntime.updateP2pStartButton = updateP2pStartButton;
netRuntime.renderMapSelect = renderMapSelect;
netRuntime.renderApprovalsSelect = renderApprovalsSelect;
netRuntime.updateP2pBattleLobbyUi = updateP2pBattleLobbyUi;
netRuntime.updateDriveButtonLabel = updateDriveButtonLabel;
netRuntime.checkMultiplayerSelectFinish = checkMultiplayerSelectFinish;
netRuntime.triggerHitFlash = triggerHitFlash;
netRuntime.applyDeauthShockwave = applyDeauthShockwave;
netRuntime.triggerShootEffect = triggerShootEffect;
netRuntime.startMergeRequestPull = startMergeRequestPull;
netRuntime.createDragonEscapeEntity = createDragonEscapeEntity;
netRuntime.ensureSelectedMapMatchesMode = ensureSelectedMapMatchesMode;
netRuntime.clampApprovals = clampApprovals;
netRuntime.resetP2pLobbyDom = resetP2pLobbyDom;
netRuntime.getGrandPrixRaces = () => grandPrixRaces;
netRuntime.showToast = showGameToast;
netRuntime.applyRocketStart = applyRocketStart;
netRuntime.startRaceSim = startRaceSim;

// ---- rl runtime (headless subsystem callbacks) ----
rlRuntime.hideAll = hideAll;
rlRuntime.buildRace = buildRace;
rlRuntime.update = update;
rlRuntime.finishRace = finishRace;
rlRuntime.AI_DIFFICULTIES = AI_DIFFICULTIES;
rlRuntime.aiDifficulty = aiDifficulty;
rlRuntime.BATTLE_ARENA_ID = BATTLE_ARENA_ID;








/* ============================================================
   UPDATE LOOP
   ============================================================ */
let lastTime = 0;
function loop(t) {
  if (!lastTime) lastTime = t;
  const raw = (t - lastTime) / 16.6667;
  let dt = clamp(raw, 0, 2.5); // dt as multiple of 60fps frames
  lastTime = t;

  // Scale down physics and particle simulation speed during post-finish matrix camera slow-mo
  if (game.slowMoEnd && performance.now() < game.slowMoEnd) {
    dt *= 0.3;
  }

  game.lastDt = dt;
  update(dt, t);
  draw(t, dt);
  requestAnimationFrame(loop);
}

function update(dt, time) {
  if (!HEADLESS_MODE) {
    pollGamepads({ splitScreen: game.multiplayer && !game.p2pMode });
  }
  // Global keys
  if (consumePressed("mute")) {
    Sound.setMuted(!Sound.muted);
  }
  if (consumePressed("back")) {
    if (screens.isVisible("settings")) {
      returnFromSettings();
      return;
    }
    if (game.state === STATE.PAUSED) {
      resumeFromPause();
      return;
    }
    if (!screens.isVisible("title")) {
      showMainMenu();
      return;
    }
  }

  // Handle Character Selection State Input
  if (game.state === STATE.SELECT) {
    if (game.p2pMode) {
      let changed = false;
      const localLocked = !!(getLocalP2pPlayer() && getLocalP2pPlayer().locked);
      if (!localLocked && (consumePressed("left") || consumePressedP1("left"))) {
        game.selectedCharIdx = (game.selectedCharIdx - 1 + CHARACTERS.length) % CHARACTERS.length;
        setLocalP2pCharacterIdx(game.selectedCharIdx);
        changed = true;
      }
      if (!localLocked && (consumePressed("right") || consumePressedP1("right"))) {
        game.selectedCharIdx = (game.selectedCharIdx + 1) % CHARACTERS.length;
        setLocalP2pCharacterIdx(game.selectedCharIdx);
        changed = true;
      }
      if (changed) {
        updateSelectionHighlight();
        Sound.tone(440, 0.08, "square", 0.1);
        sendP2pMessage({
          type: "select_update",
          playerId: game.p2pLocalId,
          charIdx: game.selectedCharIdx,
          locked: !!(getLocalP2pPlayer() && getLocalP2pPlayer().locked)
        });
      }
      if (consumePressed("enter") || consumePressed("drift") || consumePressedP1("drift")) {
        const nextLocked = !(getLocalP2pPlayer() && getLocalP2pPlayer().locked);
        setLocalP2pLocked(nextLocked);
        updateSelectionHighlight();
        updateP2pStartButton();
        renderP2pLobby();
        Sound.tone(nextLocked ? 660 : 330, 0.12, "square", 0.14);
        sendP2pMessage({
          type: "select_update",
          playerId: game.p2pLocalId,
          charIdx: game.selectedCharIdx,
          locked: nextLocked
        });
        checkMultiplayerSelectFinish();
      }
      return; // Block other select actions
    }

    if (game.multiplayer) {
      // Player 1 controls (WASD + Space)
      if (!game.p1Locked) {
        if (consumePressedP1("left")) {
          game.selectedCharIdx = (game.selectedCharIdx - 1 + CHARACTERS.length) % CHARACTERS.length;
          updateSelectionHighlight();
          Sound.tone(440, 0.08, "square", 0.1);
        }
        if (consumePressedP1("right")) {
          game.selectedCharIdx = (game.selectedCharIdx + 1) % CHARACTERS.length;
          updateSelectionHighlight();
          Sound.tone(440, 0.08, "square", 0.1);
        }
      }
      if (consumePressedP1("drift")) {
        game.p1Locked = !game.p1Locked;
        updateSelectionHighlight();
        Sound.tone(game.p1Locked ? 660 : 330, 0.12, "square", 0.14);
        checkMultiplayerSelectFinish();
      }

      // Player 2 controls (Arrows + RShift)
      if (!game.p2Locked) {
        if (consumePressedP2("left")) {
          game.selectedCharIdx2 = (game.selectedCharIdx2 - 1 + CHARACTERS.length) % CHARACTERS.length;
          updateSelectionHighlight();
          Sound.tone(520, 0.08, "square", 0.1);
        }
        if (consumePressedP2("right")) {
          game.selectedCharIdx2 = (game.selectedCharIdx2 + 1) % CHARACTERS.length;
          updateSelectionHighlight();
          Sound.tone(520, 0.08, "square", 0.1);
        }
      }
      if (consumePressedP2("drift")) {
        game.p2Locked = !game.p2Locked;
        updateSelectionHighlight();
        Sound.tone(game.p2Locked ? 660 : 330, 0.12, "square", 0.14);
        checkMultiplayerSelectFinish();
      }
    } else {
      if (consumePressed("left")) {
        game.selectedCharIdx = (game.selectedCharIdx - 1 + CHARACTERS.length) % CHARACTERS.length;
        updateSelectionHighlight();
        Sound.tone(440, 0.08, "square", 0.1);
      }
      if (consumePressed("right")) {
        game.selectedCharIdx = (game.selectedCharIdx + 1) % CHARACTERS.length;
        updateSelectionHighlight();
        Sound.tone(440, 0.08, "square", 0.1);
      }
      if (consumePressed("enter") || consumePressed("drift")) {
        startSelectedRace();
      }
    }
    return; // Block gameplay updates while in select screen
  }

  if (consumePressed("restart")) {
    if (!game.p2pMode) {
      if (game.state === STATE.RACING || game.state === STATE.COUNTDOWN || game.state === STATE.PAUSED) {
        restartCurrentRace();
        return;
      }
      if (game.state === STATE.FINISHED) {
        Sound.stopAllEngines();
        Sound.stopAllDriftSqueals();
        Sound.stopAllRumbles();
        showSelectScreen();
        return;
      }
    }
  }
  if (consumePressed("pause")) {
    if (game.state === STATE.RACING || (game.p2pMode && game.state === STATE.COUNTDOWN)) {
      pauseGame();
    } else if (game.state === STATE.PAUSED) {
      if (screens.isVisible("settings")) returnFromSettings();
      resumeFromPause();
    }
  }
  if (consumePressed("enter")) {
    if (game.state === STATE.TITLE && !screens.isVisible("settings") && !screens.isVisible("p2p")) {
      game.tournament = null;
      game.mode = "race";
      game.multiplayer = false;
      showSelectScreen();
    } else if (game.state === STATE.FINISHED) {
      if (!(game.p2pMode && game.p2pRole === "guest")) {
        showSelectScreen();
      }
    }
  }

  game.lastDt = dt;

  const countdownSim = game.state === STATE.COUNTDOWN ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.COUNTDOWN);
  const racingSim = game.state === STATE.RACING ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.RACING);

  const simResult = simulationStep(dt, time);
  if (simResult?.earlyReturn) return;


  if (racingSim && game.player && game.track) {
    const p1OnRumble = game.track.isOnRumble(game.player.x, game.player.y);
    const p1Speed = game.player.speed();
    if (p1OnRumble && p1Speed > 1.5) {
      game.shake = Math.max(game.shake, 1.15);
    }
    Sound.updateRumble(1, p1OnRumble, p1Speed);
    const isP1Drifting = !!keysP1.drift && p1Speed > 1.5;
    Sound.updateDriftSqueal(1, isP1Drifting, p1Speed);
    Sound.updateEngine(1, p1Speed, game.player.maxSpeed, game.player.boostTimer > 0);
    if (game.multiplayer && game.player2) {
      const p2OnRumble = game.track.isOnRumble(game.player2.x, game.player2.y);
      const p2Speed = game.player2.speed();
      if (p2OnRumble && p2Speed > 1.5) {
        game.shake = Math.max(game.shake, 1.15);
      }
      Sound.updateRumble(2, p2OnRumble, p2Speed);
      const isP2Drifting = !!keysP2.drift && p2Speed > 1.5;
      Sound.updateDriftSqueal(2, isP2Drifting, p2Speed);
      Sound.updateEngine(2, p2Speed, game.player2.maxSpeed, game.player2.boostTimer > 0);
      const p2OnRoad = game.track.isOnRoad(game.player2.x, game.player2.y);
      if (!p2OnRoad && p2Speed > 1.0) {
        if (!game.player2.offRoadAudioTimer) game.player2.offRoadAudioTimer = 0;
        game.player2.offRoadAudioTimer -= dt;
        if (game.player2.offRoadAudioTimer <= 0) {
          game.player2.offRoadAudioTimer = rand(8, 16);
          Sound.spatialNoise(game.player2.x, game.player2.y, 0.10, 0.04, 700);
        }
        if (Math.random() < 0.4 * dt) {
          const fx = Math.cos(game.player2.heading), fy = Math.sin(game.player2.heading);
          const lx = -fy, ly = fx;
          for (const side of [-1, 1]) {
            game.particles.add({
              type: "rect",
              x: game.player2.x - fx * 12 + lx * side * 6 + rand(-2, 2),
              y: game.player2.y - fy * 12 + ly * side * 6 + rand(-2, 2),
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
    } else {
      Sound.stopRumble(2);
      Sound.stopDriftSqueal(2);
      Sound.stopEngine(2);
    }
  }

  if (game.p2pMode && (countdownSim || racingSim || game.p2pBattleEndPending)) {
    const now = performance.now();
    if (game.p2pRole === "host" && (countdownSim || racingSim)) {
      const hostInterval = 1000 / TUNING.P2P_HOST_SYNC_HZ;
      if (now - game.p2pLastHostSyncAt >= hostInterval) {
        game.p2pLastHostSyncAt = now;
        sendHostSync();
      }
    } else if (game.p2pRole === "guest" && racingSim) {
      const guestInterval = 1000 / TUNING.P2P_GUEST_SYNC_HZ;
      if (now - game.p2pLastGuestSyncAt >= guestInterval) {
        game.p2pLastGuestSyncAt = now;
        sendGuestSync();
      }
    }
    if (now - game.p2pLastPingAt >= 2000) {
      game.p2pLastPingAt = now;
      sendP2pMessage({ type: "ping", t: now });
    }
    if (game.p2pRole === "guest") {
      const watchActive = countdownSim || racingSim || game.p2pBattleEndPending;
      if (watchActive) {
        const sinceHostSync = now - (game.p2pLastHostSyncReceivedAt || 0);
        if (sinceHostSync > 7000) {
          handleP2pDisconnect({ silent: true });
          showGameToast("Lost connection to host.", "error");
          return;
        }
        game.p2pConnectionUnstable = racingSim && sinceHostSync > 2000;
      } else {
        game.p2pConnectionUnstable = false;
      }
    }
  } else if (game.p2pMode) {
    game.p2pConnectionUnstable = false;
  }

  // Camera follow for Single Player (split-screen computes internally)
  if (!game.multiplayer && game.player) {
    const lookX = game.player.x + game.player.vx * 12;
    const lookY = game.player.y + game.player.vy * 12;
    const followLerp = 1 - Math.pow(0.92, dt);
    game.cam.x = lerp(game.cam.x, lookX, followLerp);
    game.cam.y = lerp(game.cam.y, lookY, followLerp);

    const sp = game.player.speed();
    const target = clamp(1.05 - sp * 0.025, 0.85, 1.05);
    game.cam.scale = lerp(game.cam.scale, target, 1 - Math.pow(0.92, dt));
  }

  // Spin items
  if (game.track) {
    for (const c of game.track.coins) c.spin += 0.12 * dt;
    for (const b of game.track.itemBoxes) b.spin += 0.05 * dt;
  }
}

/* ============================================================
   DRAW
   ============================================================ */

/* ============================================================
   START / RESTART HOOKS
   ============================================================ */

async function startSelectedRace() {
  if (isStartingRace) return;
  isStartingRace = true;
  try {
    prepareRaceFormatFromSelection();
    if (!game.multiplayer) {
      await loadSelectedAiModel();
    }
    Sound.stopTitleTheme();
    hideAll();
    buildRace();
    startCountdown();
    Sound.startEngine(1);
    if (game.multiplayer && game.player2 && !game.p2pMode) Sound.startEngine(2);
  } finally {
    isStartingRace = false;
  }
}

function applyStoredSettings() {
  if (HEADLESS_MODE) {
    Sound.muted = true;
    game.viewMode = "2d";
    return;
  }
  setViewMode(savedSettings.viewMode === "3d" ? "3d" : "2d");
  Sound.setMusicVolume(savedSettings.musicVolume ?? Sound.musicVolume, { persist: false });
  Sound.setSfxVolume(savedSettings.sfxVolume ?? Sound.sfxVolume, { persist: false });
  Sound.setMuted(!!savedSettings.muted);
}

applyStoredSettings();

initMenusUi();
initRaceSetupListeners({
  saveGameSettings,
  setTotalLaps: (v) => { TOTAL_LAPS = clampLaps(v); },
  setGrandPrixRaces: (v) => { grandPrixRaces = clampGrandPrixRaces(v); },
  setAiCount: (v) => { aiCount = clampAiCount(v); },
  setAiDifficulty: (v) => { aiDifficulty = normalizeAiDifficulty(v); },
  normalizeAiDifficulty,
  clampLaps,
  clampAiCount,
});
initLobbyUi({ showMainMenu, screens });

if (aiModelSelect) {
  aiModelSelect.addEventListener("change", () => {
    selectedAiModelId = aiModelSelect.value || "classic";
    selectedAiModelWeights = null;
    selectedAiOpponentModels = {};
    if (aiModelStatus) {
      aiModelStatus.textContent = selectedAiModelId === "classic" ? "Classic AI ready" : "Model selected";
    }
    renderAiOpponentSelectors();
  });
}

if (aiImportBtn && aiImportInput) {
  aiImportBtn.addEventListener("click", () => aiImportInput.click());
  aiImportInput.addEventListener("change", async () => {
    const file = aiImportInput.files && aiImportInput.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      importAiModelPayload(payload, file.name);
    } catch (e) {
      if (aiModelStatus) aiModelStatus.textContent = e?.message || "Could not import model";
    } finally {
      aiImportInput.value = "";
    }
  });
}

selectBackBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  showMainMenu();
});

if (pauseResumeBtn) {
  pauseResumeBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    resumeFromPause();
  });
}
if (pauseRestartBtn) {
  pauseRestartBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    restartCurrentRace();
  });
}
if (pauseSettingsBtn) {
  pauseSettingsBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    showSettingsScreen({ returnTo: "pause" });
  });
}
if (pauseMenuBtn) {
  pauseMenuBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    showMainMenu();
  });
}

start1pBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  Sound.playVocoderTitle();
  game.tournament = null;
  game.mode = "race";
  game.multiplayer = false;
  showSelectScreen();
});
start2pBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  Sound.playVocoderTitle();
  game.tournament = null;
  game.mode = "race";
  game.multiplayer = true;
  showSelectScreen();
});
if (startBattleBtn) {
  startBattleBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    Sound.playVocoderTitle();
    game.tournament = null;
    game.mode = "battle";
    game.multiplayer = false;
    ensureSelectedMapMatchesMode();
    // Default to the classic waypoint AI; the select screen lists battle-trained models to pick from.
    selectedAiModelId = "classic";
    selectedAiModelWeights = null;
    selectedAiOpponentModels = {};
    showSelectScreen();
  });
}
driveBtn.addEventListener("click", async () => {
  Sound.ensure(); Sound.resume();
  if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) {
    startP2pRaceFromSelection();
    return;
  }
  driveBtn.disabled = true;
  try {
    await startSelectedRace();
  } catch (e) {
    if (aiModelStatus) aiModelStatus.textContent = e?.message || "Could not load model";
  } finally {
    driveBtn.disabled = false;
  }
});
function rematchRace() {
  Sound.ensure(); Sound.resume();
  const tourn = game.tournament;
  const tournActive = isGrandPrixActive(tourn);
  const tournDone = tournActive && tourn.raceIndex + 1 >= tourn.totalRaces;

  if (tournActive && !tournDone) {
    if (game.p2pMode && game.p2pRole !== "host") return;
    tourn.raceIndex += 1;
    game.selectedMapIdx = getTournamentRaceMapIdx(tourn);
    if (isGrandPrixSelection() || tourn.format === "grand_prix") game.mapSelection = GRAND_PRIX_ID;
    if (game.p2pMode) {
      startP2pRaceFromSelection();
    } else {
      startSelectedRace().catch(() => showSelectScreen());
    }
    return;
  }

  if (tournDone) {
    if (game.p2pMode && game.p2pRole !== "host") return;
    if (isGrandPrixSelection() || tourn.format === "grand_prix") {
      game.tournament = createGrandPrixTournament(grandPrixRaces);
      game.mapSelection = GRAND_PRIX_ID;
      game.selectedMapIdx = game.tournament.circuitOrder[0];
    } else {
      game.tournament = null;
    }
    if (game.p2pMode) {
      startP2pRaceFromSelection();
    } else {
      startSelectedRace().catch(() => showSelectScreen());
    }
    return;
  }

  // P2P rematches must renegotiate the lobby, so fall back to the select screen.
  if (game.p2pMode) {
    if (game.p2pRole === "host") {
      resetP2pReadyForLobbyChange();
      broadcastP2pMessage({
        type: "return_lobby",
        players: game.p2pPlayers.filter((p) => !p.disconnected),
        ...getP2pLobbyMapPayload(),
      });
    }
    p2pReturnToLobbyLocal();
    return;
  }
  startSelectedRace().catch(() => showSelectScreen());
}

restartBtn.addEventListener("click", rematchRace);

if (nextTrackBtn) {
  nextTrackBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    if (game.p2pMode) { showSelectScreen(); return; }
    game.selectedMapIdx = ((game.selectedMapIdx || 0) + 1) % MAPS.length;
    startSelectedRace().catch(() => showSelectScreen());
  });
}

if (finishMenuBtn) {
  finishMenuBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    game.tournament = null;
    showMainMenu();
  });
}































// Shared, mode-agnostic base features: self kinematics + car stats + status + rays + item slot.
// Order MUST match HEADLESS_BASE_OBS_KEYS.

// Race navigation tail (checkpoint targeting). Order MUST match HEADLESS_RACE_TAIL_KEYS.

// Battle combat tail: own lives, field state, ram opportunity, and the N nearest rivals.
// Order MUST match HEADLESS_BATTLE_TAIL_KEYS.





















// Headline success rate for a model's metrics: battle win rate in Battle mode
// (finish_rate also exists there but is always 0 — battles aren't "finished"), else finish rate.
function headlineModelRate(metrics) {
  const candidates = isBattleMode()
    ? [metrics.battle_win_rate, metrics.player_win_rate, metrics.win_rate]
    : [metrics.finish_rate, metrics.win_rate];
  for (const v of candidates) {
    if (Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

// A model is offered only for the mode it was trained on: battle policies in Battle,
// race policies (mode "race" or legacy entries with no mode) everywhere else.
function modelMatchesCurrentMode(model) {
  const modelMode = String(model?.mode || model?.meta?.mode || "race").toLowerCase();
  return isBattleMode() ? modelMode === "battle" : modelMode !== "battle";
}

function applySelectedAiModelToOpponents() {
  if (!TRAINED_AI_ENABLED && !HEADLESS_MODE) return;
  if (!game.ais || !game.ais.length) return;
  game.ais = game.ais.map((ai, idx) => {
    const char = CHARACTERS.find(c => c.id === ai.charId) || CHARACTERS[(idx + 1) % CHARACTERS.length];
    const overrideId = selectedAiOpponentModels[char.id];
    const modelId = overrideId || selectedAiModelId || "classic";
    if (modelId === "classic") return ai;
    const weights = overrideId ? selectedAiOpponentWeights[char.id] : selectedAiModelWeights;
    if (!weights) return ai;
    const dqn = new DqnAIKart(ai.x, ai.y, ai.heading, char, weights, ai.skill || 0.96);
    dqn.lateralOffset = ai.lateralOffset || 0;
    return dqn;
  });
}

async function loadAiModelManifest() {
  if (aiModelManifest) return aiModelManifest;
  try {
    const response = await fetch("models/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await response.json();
    aiModelManifest = parsed && Array.isArray(parsed.models) ? parsed : { models: [] };
  } catch (e) {
    aiModelManifest = { models: [] };
    if (aiModelStatus) {
      aiModelStatus.textContent = window.location.protocol === "file:"
        ? "Serve over HTTP to load trained models"
        : "No model manifest found";
    }
  }
  return aiModelManifest;
}

function getSortedModeModels(selectedMap) {
  const getTrackMetrics = (model, mapId) => {
    const trackEntry = model.eval?.tracks?.[mapId];
    if (trackEntry) return trackEntry.battle || trackEntry.classic || trackEntry.solo || trackEntry;
    return model.metrics || {};
  };
  const scoreModel = (model) => {
    const m = getTrackMetrics(model, selectedMap);
    const rate = Number(headlineModelRate(m) ?? 0);
    const reward = Number(m.avg_reward ?? -999999);
    return rate * 100000 + reward;
  };
  const models = (aiModelManifest?.models || []).filter(modelMatchesCurrentMode).sort((a, b) => scoreModel(b) - scoreModel(a));
  return { models, getTrackMetrics };
}

function populateAiModelSelect(selectEl, selectedId = "classic", { shortLabels = false } = {}) {
  const selectedMap = MAPS[game.selectedMapIdx || 0]?.id;
  const { models, getTrackMetrics } = getSortedModeModels(selectedMap);
  selectEl.textContent = "";

  const classicOpt = document.createElement("option");
  classicOpt.value = "classic";
  classicOpt.textContent = shortLabels ? "Classic" : "Classic Waypoint AI";
  classicOpt.selected = selectedId === "classic";
  selectEl.appendChild(classicOpt);

  for (const model of models) {
    const actionCount = model.actionCount;
    const incompatible = Number.isFinite(actionCount) && actionCount > HEADLESS_DQN_ACTIONS.length;
    const id = model.id || model.path;
    const metrics = getTrackMetrics(model, selectedMap);
    const rate = headlineModelRate(metrics);
    const label = shortLabels
      ? (rate !== null
        ? `${model.name || id} · ${(rate * 100).toFixed(0)}% · ${Number(metrics.avg_reward || 0).toFixed(0)}`
        : (model.name || id))
      : `${model.name || id}${rate !== null
        ? ` · ${(rate * 100).toFixed(0)}% ${isBattleMode() ? "win" : "finish"} · ${Number(metrics.avg_reward || 0).toFixed(0)} reward`
        : ""}${incompatible ? " (incompatible)" : ""}`;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.disabled = incompatible;
    option.selected = selectedId === id;
    selectEl.appendChild(option);
  }
  return models;
}

function renderAiModelSelector() {
  if (!aiModelSelect) return;
  const selectedMap = MAPS[game.selectedMapIdx || 0]?.id;
  const { models } = getSortedModeModels(selectedMap);
  const current = selectedAiModelId;
  const currentExists = current === "classic" || models.some(m => (m.id || m.path) === current);
  const nextId = currentExists ? current : "classic";
  populateAiModelSelect(aiModelSelect, nextId, { shortLabels: false });
  aiModelSelect.value = nextId;
  selectedAiModelId = aiModelSelect.value;
  if (aiModelStatus) {
    aiModelStatus.textContent = models.length
      ? `${models.length} trained model${models.length === 1 ? "" : "s"} found`
      : (window.location.protocol === "file:" ? "Serve over HTTP to load trained models" : "Classic AI ready");
  }
  renderAiOpponentSelectors();
}

function renderAiOpponentSelectors() {
  if (!aiOpponentGrid) return;
  const playerIdx = game.selectedCharIdx || 0;
  const opponents = CHARACTERS.filter((_, idx) => idx !== playerIdx);
  aiOpponentGrid.textContent = "";
  for (const char of opponents) {
    const selected = selectedAiOpponentModels[char.id] || selectedAiModelId || "classic";
    const row = document.createElement("label");
    row.className = "ai-opponent-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "ai-opponent-name";
    nameSpan.textContent = char.name;

    const select = document.createElement("select");
    select.className = "ai-model-select ai-opponent-select";
    select.dataset.charId = char.id;
    populateAiModelSelect(select, selected, { shortLabels: true });
    select.addEventListener("change", () => {
      selectedAiOpponentModels[char.id] = select.value || "classic";
    });

    row.append(nameSpan, select);
    aiOpponentGrid.appendChild(row);
  }
}

async function refreshAiModelSelector() {
  await loadAiModelManifest();
  renderAiModelSelector();
}

function importAiModelPayload(payload, fileName = "imported-model.json") {
  validateModelPayload(payload);
  const meta = payload.meta || {};
  const idBase = meta.id || fileName.replace(/\.json$/i, "") || "imported-dqn";
  const id = `imported:${idBase}`;
  const name = meta.name || `${idBase} (imported)`;
  if (!aiModelManifest) aiModelManifest = { models: [] };
  aiModelManifest.models = (aiModelManifest.models || []).filter(m => m.id !== id);
  aiModelManifest.models.unshift({
    id,
    name,
    path: null,
    mode: meta.mode || "race",
    map: meta.map || "unknown",
    character: meta.character || "unknown",
    metrics: meta.metrics || {},
    _weights: payload,
  });
  selectedAiModelId = id;
  selectedAiModelWeights = payload;
  renderAiModelSelector();
  if (aiModelSelect) aiModelSelect.value = id;
  if (aiModelStatus) aiModelStatus.textContent = `Imported ${name}`;
}

async function loadAiModelWeightsById(modelId) {
  if (!modelId || modelId === "classic") return null;
  if (!aiModelManifest) await loadAiModelManifest();
  const model = (aiModelManifest?.models || []).find(m => (m.id || m.path) === modelId);
  if (!model) return null;
  if (model._weights) return model._weights;
  const path = model.path || `models/${model.id}.json`;
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load AI model: ${response.status}`);
  model._weights = validateModelPayload(await response.json());
  return model._weights;
}

async function loadSelectedAiModel() {
  selectedAiOpponentWeights = {};
  const hasGlobal = selectedAiModelId && selectedAiModelId !== "classic";
  const overrideEntries = Object.entries(selectedAiOpponentModels).filter(([, id]) => id && id !== "classic");
  if (!hasGlobal && !overrideEntries.length) {
    selectedAiModelWeights = null;
    if (aiModelStatus) aiModelStatus.textContent = "Classic AI ready";
    return null;
  }

  if (aiModelStatus) aiModelStatus.textContent = "Loading model...";
  selectedAiModelWeights = hasGlobal ? await loadAiModelWeightsById(selectedAiModelId) : null;
  for (const [charId, modelId] of overrideEntries) {
    selectedAiOpponentWeights[charId] = await loadAiModelWeightsById(modelId);
  }
  if (aiModelStatus) {
    if (selectedAiModelWeights) {
      const model = (aiModelManifest?.models || []).find(m => (m.id || m.path) === selectedAiModelId);
      aiModelStatus.textContent = `Loaded ${model?.name || selectedAiModelId}`;
    } else if (overrideEntries.length) {
      aiModelStatus.textContent = `Loaded ${overrideEntries.length} opponent model${overrideEntries.length === 1 ? "" : "s"}`;
    } else {
      aiModelStatus.textContent = "Model missing from manifest";
    }
  }
  return selectedAiModelWeights;
}



// Resume audio context on any user click
installTestHooks({ setTimeOfDay });
installWindowExports();


document.addEventListener("click", () => { Sound.ensure(); Sound.resume(); });

// Kick off the game loop
if (HEADLESS_MODE) {
  loadHeadlessPolicyModel()
    .catch(err => {
      console.error(err);
      window.__HEADLESS_MODEL_ERROR__ = String(err && err.message ? err.message : err);
    })
    .finally(() => {
      if (headlessFlag("external", false)) {
        setupExternalRlApi();
      } else {
        runHeadlessSimulation();
      }
    });
} else {
  buildRace(); // build a track for backdrop on title screen
  requestAnimationFrame(loop);
}

