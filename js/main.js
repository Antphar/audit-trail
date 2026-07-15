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
  showFinishScreen, hideAll, showMainMenu, showSettingsScreen,
  setMusicTrack, previewSelectedMapMusic, setTimeOfDay, initMenusUi,
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

function getKartCollisionRadius(kart) {
  if (!kart) return DEFAULT_KART_COLLISION_RADIUS;
  const id = kart.charId != null ? kart.charId : kart;
  const profile = getVehicleProfile(id);
  const r = profile.hitboxRadius;
  return Number.isFinite(r) ? r : DEFAULT_KART_COLLISION_RADIUS;
}

function kartPickupThreshold(baseThreshold, kart) {
  return baseThreshold + getKartCollisionRadius(kart) - DEFAULT_KART_COLLISION_RADIUS;
}

function getRayObjectRadius(obj, defaultRadius) {
  if (obj && obj.charId != null) return getKartCollisionRadius(obj);
  return obj.r || defaultRadius;
}

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

function applyDeauthShockwave(sourceKart) {
  if (!sourceKart) return;
  const radius = 175;
  let affected = 0;

  for (const kart of getActiveKarts()) {
    if (!kart || kart === sourceKart || kart.finished) continue;
    const d = dist(sourceKart.x, sourceKart.y, kart.x, kart.y);
    if (d > radius) continue;

    const falloff = 1 - d / radius;
    const nx = (kart.x - sourceKart.x) / Math.max(0.001, d);
    const ny = (kart.y - sourceKart.y) / Math.max(0.001, d);
    kart.vx += nx * (3.5 + falloff * 4.0);
    kart.vy += ny * (3.5 + falloff * 4.0);

    if (kart.shieldTimer > 0) {
      kart.shieldTimer = 0;
      if (game.particles) {
        game.particles.burst(kart.x, kart.y, "#78dcff", 18, { spdMin: 1.5, spdMax: 4 });
      }
    } else {
      kart.spinoutTimer = Math.max(kart.spinoutTimer, 32);
      kart.spinAngle = 0;
      kart.lastAttacker = sourceKart;
      kart.lastAttackerAt = game.raceTime;
      triggerQuote(kart, "crash");
      if (kart.isPlayer) triggerHitFlash("DE-AUTH!", "#ff3366", 80, kart);
      if (game.particles) {
        game.particles.add({
          type: "text",
          text: "DE-AUTH!",
          x: kart.x,
          y: kart.y - 24,
          vx: 0,
          vy: -0.9,
          life: 45,
          maxLife: 45,
          size: 16,
          color: "#ff3366",
          drag: 0.98
        });
        game.particles.burst(kart.x, kart.y, "#ff3366", 18, { spdMin: 2, spdMax: 5 });
      }
    }
    affected++;
  }

  if (affected > 0) {
    game.shake = Math.max(game.shake, 7 + affected * 2);
    game.flash = Math.max(game.flash, 6 + affected);
    showComboHit(sourceKart, affected);
    if (sourceKart.isPlayer || (game.player && dist(sourceKart.x, sourceKart.y, game.player.x, game.player.y) < 600)) {
      Sound.duckMusic(0.5, 340);
    }
  }

  // Spawn 3D shockwave rings
  if (game.viewMode === "3d" && window.THREE && THREE_STATE.scene) {
    spawn3DShockwave(sourceKart.x, sourceKart.y, radius, "#ff3366");
  }
}

function showComboHit(kart, count) {
  if (!kart || count < 2) return;
  const labels = { 2: "DOUBLE HIT!", 3: "TRIPLE HIT!", 4: "QUAD HIT!" };
  const colors = { 2: "#ffd86b", 3: "#ff4d6d", 4: "#ff00ff" };
  const label = labels[Math.min(count, 4)] || `${count}x COMBO!`;
  const col = colors[Math.min(count, 4)] || "#ff00ff";
  game.particles.add({
    type: "text", text: label,
    x: kart.x, y: kart.y - 42,
    vx: 0, vy: -1.3,
    life: 80, maxLife: 80, size: 22 + count * 2, color: col, drag: 0.98
  });
  if (kart.isPlayer) {
    triggerHitFlash(label, col, 90, kart);
    Sound.tone(880 + count * 220, 0.15, "square", 0.2, 440);
  }
}

function findMergeRequestTarget(kart) {
  const ranking = rankAll().filter(k => k && k !== kart && !k.finished);
  const myRank = rankAll().indexOf(kart);
  if (myRank > 0 && ranking[myRank - 1]) return ranking[myRank - 1];

  let best = null;
  let bestScore = Infinity;
  const fx = Math.cos(kart.heading);
  const fy = Math.sin(kart.heading);
  for (const other of getActiveKarts()) {
    if (!other || other === kart || other.finished) continue;
    const dx = other.x - kart.x;
    const dy = other.y - kart.y;
    const forward = dx * fx + dy * fy;
    if (forward <= 20) continue;
    const lateral = Math.abs(dx * -fy + dy * fx);
    const score = forward + lateral * 1.8;
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function startMergeRequestPull(kart) {
  kart.mergeBattleStole = false;
  const target = findMergeRequestTarget(kart);
  if (!target) {
    kart.boostTimer = Math.max(kart.boostTimer, 36);
    if (game.particles) {
      game.particles.add({
        type: "text",
        text: "NO REVIEWER",
        x: kart.x,
        y: kart.y - 22,
        vx: 0,
        vy: -0.8,
        life: 36,
        maxLife: 36,
        size: 13,
        color: "#39ff14"
      });
    }
    return;
  }

  kart.mergePullTarget = target;
  kart.mergePullTargetId = getKartId(target);
  kart.mergePullTimer = 110;
  target.mergePullVictimTimer = 110;
  if (isBattleMode() && !kart.mergeBattleStole) {
    kart.mergeBattleStole = true;
    if (target.shieldTimer > 0) {
      if (game.particles) {
        game.particles.add({
          type: "text", text: "BLOCKED", x: target.x, y: target.y - 28,
          vx: 0, vy: -0.9, life: 40, maxLife: 40, size: 15, color: "#78dcff", drag: 0.98,
        });
      }
    } else {
      target.lastAttacker = kart;
      target.lastAttackerAt = game.raceTime;
      popApproval(target, { explicitTransferSource: kart });
    }
  }
  triggerQuote(kart, "boost");
  if (target.isPlayer) {
    triggerHitFlash("MERGE REQUESTED!", "#39ff14", 80, target);
    game.shake = Math.max(game.shake, 3);
  }
  if (game.particles) {
    game.particles.add({
      type: "text",
      text: "MERGE REQUEST!",
      x: kart.x,
      y: kart.y - 22,
      vx: 0,
      vy: -0.8,
      life: 42,
      maxLife: 42,
      size: 14,
      color: "#39ff14"
    });
    game.particles.add({
      type: "text",
      text: "TETHERED!",
      x: target.x,
      y: target.y - 22,
      vx: 0,
      vy: -0.8,
      life: 42,
      maxLife: 42,
      size: 14,
      color: "#39ff14"
    });
  }
}


function triggerQuote(kart, event, otherKart = null) {
  if (kart.quoteTimer > 40) return;

  if (otherKart && event === "collide") {
    const rivalLine = getRivalryQuote(kart.charId, otherKart.charId);
    if (rivalLine) {
      kart.activeQuote = kart.charId === "anton" ? makeTypo(rivalLine) : rivalLine;
      kart.quoteTimer = 130;
      return;
    }
  }

  const charQuotes = QUOTES[kart.charId];
  if (!charQuotes) return;
  const eventQuotes = charQuotes[event];
  if (!eventQuotes || eventQuotes.length === 0) return;
  let quote = pick(eventQuotes);
  if (kart.charId === "anton") {
    quote = makeTypo(quote);
  }
  kart.activeQuote = quote;
  kart.quoteTimer = 130;
}

const RIVALRY_QUOTES = {
  "anton|artur": ["arutr nitpicks again!", "nice prompt bro", "who broke my tests??", "stop touching my worker!"],
  "artur|anton": ["damn anton got hands", "who spells like that?!", "fix your typos bro", "prompty vs worker war!"],
  "anton|rissal": ["don't panic rissal!", "works on my manchie", "just merge it bro"],
  "rissal|anton": ["Don't merge that!", "PANIC! Anton is here!", "Most dangerous merge!"],
  "anton|pia": ["nice endpoint bro", "thinkpad can't keep up!", "types faster than layouts"],
  "pia|anton": ["small loser speller!", "Protect our endpoints from typos!", "at least I can spell"],
  "anton|florian": ["regulatory shmegulatory", "just ship it florian!", "compliance who?"],
  "florian|anton": ["File a deficiency report!", "Typos violate GxP!", "Non-compliant code detected!"],
  "artur|rissal": ["stop panicking bro!", "holy shit rissal chill", "prayer > panic"],
  "rissal|artur": ["Stop praying and CODE!", "PANIC! Artur incoming!", "Most dangerous prayer!"],
  "artur|pia": ["Who broke my layout?!", "damn window heights!", "thinkpad vs ultrawide war"],
  "pia|artur": ["Fix your own heights!", "small loser ultrawide!", "Thinkpads don't crash!"],
  "artur|florian": ["damn florian got hands", "CEO diff!", "holy shit the exec!"],
  "florian|artur": ["Board meeting collision!", "Accelerated review needed!", "Executive override!"],
  "rissal|pia": ["Don't touch my workspace!", "PANIC! Pia rams!", "Careful with endpoints!"],
  "pia|rissal": ["Calm down rissal!", "Protect endpoints from panic!", "Grid beats panic!"],
  "rissal|florian": ["Most dangerous executive!", "PANIC! Compliance!", "Hopefully survives audit!"],
  "florian|rissal": ["Emotional non-compliance!", "File panic report!", "Audit your emotions!"],
  "pia|florian": ["Protect our code from execs!", "Sign the PR yourself!", "killed weird executive svg"],
  "florian|pia": ["Non-disclosure collision!", "ThinkPad audit scheduled!", "Regulatory endpoint check!"],
};

function getRivalryQuote(charA, charB) {
  const key = `${charA}|${charB}`;
  const lines = RIVALRY_QUOTES[key];
  if (!lines || !lines.length) return null;
  if (Math.random() < 0.55) return pick(lines);
  return null;
}

function getUltimateTier(kart) {
  const ranking = rankAll();
  const rank = ranking.indexOf(kart) + 1;
  const total = ranking.length;
  if (total <= 1) return 2;
  if (rank >= total) return 3;
  if (rank >= Math.ceil(total * 0.5)) return 2;
  return 1;
}

function activateUltimate(kart) {
  if (!kart || !kart.ultReady || kart.ultActiveTimer > 0 || kart.finished || kart.eliminated) return;
  kart.ultUseCount = (kart.ultUseCount || 0) + 1;
  kart.ultReady = false;
  kart.ultCharge = 0;
  const tier = getUltimateTier(kart);
  kart.ultTier = tier;
  kart.ultActiveTimer = TUNING.ULTIMATE_DURATION_BASE + tier * 30;

  if (kart.isPlayer) {
    game.shake = Math.max(game.shake, 6 + tier * 3);
    game.flash = Math.max(game.flash, 5 + tier * 2);
    Sound.tone(330, 0.3, "sawtooth", 0.2, 1320);
    Sound.tone(660, 0.25, "triangle", 0.15, 1980);
    Sound.noise(0.2, 0.1, 400);
  }

  game.particles.add({
    type: "ring", x: kart.x, y: kart.y, vx: 0, vy: 0,
    life: 30, maxLife: 30, size: 80 + tier * 20, startSize: 10,
    color: kart.color
  });
  game.particles.burst(kart.x, kart.y, kart.color, 30 + tier * 10, { type: "spark", spdMin: 3, spdMax: 8 });

  const charId = kart.charId;

  if (charId === "anton") {
    // Typo Storm: wobble/invert steering on opponents
    const duration = [45, 90, 150][tier - 1];
    for (const k of getActiveKarts()) {
      if (k === kart || k.finished || k.eliminated) continue;
      k.doubleBlindTimer = Math.max(k.doubleBlindTimer, duration);
      if (k.isPlayer) triggerHitFlash("TYPO STORM!", "#ff4d6d", 90, k);
      if (game.particles) {
        game.particles.add({
          type: "text", text: pick(["pomrpt!", "btet!", "naalysis!", "arutr!", "manchie!"]),
          x: k.x, y: k.y - 28, vx: rand(-0.5, 0.5), vy: -1.0,
          life: 60, maxLife: 60, size: 16, color: "#ff4d6d", drag: 0.98
        });
      }
    }
    game.particles.add({
      type: "text", text: tier >= 3 ? "TYPO STORM!!!" : tier >= 2 ? "TYPO STORM!" : "TYPO BURST",
      x: kart.x, y: kart.y - 38, vx: 0, vy: -1.2,
      life: 70, maxLife: 70, size: 22, color: "#ff4d6d", drag: 0.98
    });
    triggerQuote(kart, "boost");

  } else if (charId === "artur") {
    // Prayer Protocol: invuln + max speed + fire trail, touches spin out opponents
    const duration = [90, 150, 240][tier - 1];
    kart.invuln = Math.max(kart.invuln, duration);
    kart.boostTimer = Math.max(kart.boostTimer, duration);
    kart.shieldTimer = Math.max(kart.shieldTimer, duration);
    kart.ultraBoostActive = true;
    game.particles.add({
      type: "text", text: tier >= 3 ? "DIVINE INTERVENTION!!!" : tier >= 2 ? "PRAYER MODE!" : "BLESSED SPEED",
      x: kart.x, y: kart.y - 38, vx: 0, vy: -1.2,
      life: 70, maxLife: 70, size: 22, color: "#ff8a3b", drag: 0.98
    });
    triggerQuote(kart, "boost");

  } else if (charId === "rissal") {
    // Panic Deploy: drop panic clouds + wipe items from opponents
    const cloudCount = [2, 4, 6][tier - 1];
    for (let i = 0; i < cloudCount; i++) {
      const ang = kart.heading + Math.PI + rand(-0.8, 0.8);
      const spawnDist = 40 + i * 35;
      const cx = kart.x + Math.cos(ang) * spawnDist;
      const cy = kart.y + Math.sin(ang) * spawnDist;
      game.hazards.push(new DoubleBlindCloud(cx, cy, ang, kart));
    }
    if (tier >= 2) {
      for (const k of getActiveKarts()) {
        if (k === kart || k.finished || k.eliminated) continue;
        if (k.itemState === "rolling" || k.itemState === "active") {
          k.itemState = "empty";
          k.itemSlot = null;
        }
      }
    }
    if (tier >= 3) {
      kart.shieldTimer = Math.max(kart.shieldTimer, 180);
      kart.boostTimer = Math.max(kart.boostTimer, 90);
    }
    game.particles.add({
      type: "text", text: tier >= 3 ? "TOTAL PANIC!!!" : tier >= 2 ? "PANIC DEPLOY!" : "PANIC CLOUD",
      x: kart.x, y: kart.y - 38, vx: 0, vy: -1.2,
      life: 70, maxLife: 70, size: 22, color: "#4dffaa", drag: 0.98
    });
    triggerQuote(kart, "boost");

  } else if (charId === "pia") {
    // ThinkPad Slam: AOE shockwave that pushes/stuns nearby karts
    const radius = [120, 180, 260][tier - 1];
    const force = [4, 6.5, 10][tier - 1];
    const stunTime = [20, 35, 55][tier - 1];
    let slamHits = 0;
    for (const k of getActiveKarts()) {
      if (k === kart || k.finished || k.eliminated) continue;
      const d = dist(kart.x, kart.y, k.x, k.y);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      const nx = (k.x - kart.x) / Math.max(0.001, d);
      const ny = (k.y - kart.y) / Math.max(0.001, d);
      k.vx += nx * force * falloff;
      k.vy += ny * force * falloff;
      k.spinoutTimer = Math.max(k.spinoutTimer, stunTime);
      k.spinAngle = 0;
      k.lastAttacker = kart;
      k.lastAttackerAt = game.raceTime;
      triggerQuote(k, "crash");
      if (k.isPlayer) triggerHitFlash("THINKPAD SLAM!", "#9d4dff", 85, k);
      slamHits++;
    }
    if (slamHits >= 2) showComboHit(kart, slamHits);
    for (let i = 0; i < (tier >= 3 ? 3 : tier >= 2 ? 2 : 1); i++) {
      game.particles.add({
        type: "ring", x: kart.x, y: kart.y, vx: 0, vy: 0,
        life: 25 + i * 8, maxLife: 25 + i * 8,
        size: radius * (0.6 + i * 0.3), startSize: 15 + i * 10,
        color: "#9d4dff"
      });
    }
    game.particles.add({
      type: "text", text: tier >= 3 ? "THINKPAD SLAM!!!" : tier >= 2 ? "THINKPAD SLAM!" : "LAPTOP SLAP",
      x: kart.x, y: kart.y - 38, vx: 0, vy: -1.2,
      life: 70, maxLife: 70, size: 22, color: "#9d4dff", drag: 0.98
    });
    triggerQuote(kart, "boost");

  } else if (charId === "florian") {
    // Regulatory Lockdown: slow all opponents, lock their items, self boost
    const slowDuration = [60, 120, 180][tier - 1];
    const selfBoost = [60, 120, 180][tier - 1];
    for (const k of getActiveKarts()) {
      if (k === kart || k.finished || k.eliminated) continue;
      k.placeboSlowTimer = Math.max(k.placeboSlowTimer, slowDuration);
      if (tier >= 2 && (k.itemState === "rolling" || k.itemState === "active")) {
        k.itemState = "empty";
        k.itemSlot = null;
      }
      if (k.isPlayer) triggerHitFlash(tier >= 3 ? "REGULATORY LOCKDOWN!" : "COMPLIANCE FREEZE!", "#57f2ff", 90, k);
      if (game.particles) {
        game.particles.add({
          type: "text", text: tier >= 3 ? "FDA REVIEW!" : "PENDING...",
          x: k.x, y: k.y - 28, vx: rand(-0.3, 0.3), vy: -0.9,
          life: 55, maxLife: 55, size: 14, color: "#57f2ff", drag: 0.98
        });
      }
    }
    kart.boostTimer = Math.max(kart.boostTimer, selfBoost);
    kart.shieldTimer = Math.max(kart.shieldTimer, selfBoost);
    if (tier >= 3) kart.handlingTimer = Math.max(kart.handlingTimer, selfBoost);
    game.particles.add({
      type: "text", text: tier >= 3 ? "REGULATORY LOCKDOWN!!!" : tier >= 2 ? "COMPLIANCE FREEZE!" : "PENDING APPROVAL",
      x: kart.x, y: kart.y - 38, vx: 0, vy: -1.2,
      life: 70, maxLife: 70, size: 22, color: "#57f2ff", drag: 0.98
    });
    triggerQuote(kart, "boost");
  }
}

function getActiveHumanKarts() {
  return getActiveKarts().filter(k => k && k.isPlayer && !k.finished && !k.eliminated);
}

function getDragonTarget() {
  const humans = getActiveHumanKarts();
  if (!humans.length) return null;
  return humans.slice().sort((a, b) => progressValue(a) - progressValue(b))[0];
}

function createDragonEscapeEntity() {
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

function updateDragonEscapeEntity(dt) {
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

function areAllHumansDone() {
  const humans = getActiveKarts().filter(k => k && k.isPlayer);
  return humans.length > 0 && humans.every(k => k.finished || k.eliminated);
}

function scheduleFinishRace(delay = 900) {
  if (game.finishScheduled || game.state === STATE.FINISHED) return;
  game.finishScheduled = true;
  setTimeout(() => {
    game.finishScheduled = false;
    if (areAllHumansDone()) finishRace();
  }, delay);
}

function eliminateKart(kart, label = "ELIMINATED!", x = null, y = null, color = "#ff3366", killer = null) {
  if (!kart || kart.eliminated) return;
  // Remember who knocked us out (for the follow-your-killer spectator chain / end screen)
  kart.killedBy = killer || kart.lastAttacker || null;
  const hitX = x !== null ? x : kart.x;
  const hitY = y !== null ? y : kart.y;
  kart.eliminated = true;
  kart.finished = true;
  kart.finishTime = game.raceTime;
  kart.spinoutTimer = Math.max(kart.spinoutTimer, 90);
  kart.vx = 0;
  kart.vy = 0;
  triggerQuote(kart, "crash");
  if (kart.isPlayer) {
    bus.emit("battle:kartEliminated", { kart, isPlayer: true, killConfirm: false });
    game.shake = Math.max(game.shake, 14);
    game.flash = Math.max(game.flash, 10);
    triggerHitFlash(label, color, 100, kart);
  }
  if (game.particles) {
    game.particles.burst(hitX, hitY, color, 44, { type: "spark", spdMin: 3, spdMax: 8 });
    game.particles.add({
      type: "text",
      text: label,
      x: hitX,
      y: hitY - 34,
      vx: 0,
      vy: -1.1,
      life: 80,
      maxLife: 80,
      size: 22,
      color,
      drag: 0.98
    });
  }
  // In Battle we keep the match running after the human dies (they spectate); checkBattleEnd()
  // ends it on last-standing / time-up. Other modes finish once all humans are done.
  if (areAllHumansDone() && !isBattleMode()) {
    scheduleFinishRace(900);
  }
}

// Battle mode: revoke one Approval from a kart that just got hit. Eliminates at zero.
// Only a qualifying high-speed ram or Merge Request may transfer the popped Approval.
function popApproval(kart, opts = {}) {
  if (!kart || kart.eliminated) return;
  if ((kart.approvals || 0) <= 0) return;

  const killAttacker = resolveFreshKillAttacker(kart);
  const pendingTransfer = resolveFreshTransferAttacker(kart);
  const explicitTransfer = opts.explicitTransferSource
    && opts.explicitTransferSource !== kart
    && !opts.explicitTransferSource.eliminated
    ? opts.explicitTransferSource
    : null;
  const transferAttacker = explicitTransfer || pendingTransfer;
  clearPendingApprovalTransfer(kart);

  kart.approvals--;
  bus.emit("battle:approvalPopped", { kart, isPlayer: kart.isPlayer });
  if (kart.isPlayer) {
    game.rlLosses = (game.rlLosses || 0) + 1; // headless RL: own life lost this frame
    game.shake = Math.max(game.shake, 6);
  }
  if (game.particles) {
    game.particles.burst(kart.x, kart.y - 26, "#ff3366", 14, { type: "spark", spdMin: 1.5, spdMax: 4 });
    spawnCompassRevokeFx(kart);
    game.particles.add({
      type: "text", text: "REVOKED!", x: kart.x, y: kart.y - 34,
      vx: 0, vy: -1.1, life: 50, maxLife: 50, size: 15, color: "#ff3366", drag: 0.98, compassFx: true,
    });
  }
  if (transferAttacker) {
    transferAttacker.battleSteals = (transferAttacker.battleSteals || 0) + 1;
    transferAttacker.approvals = Math.min(5, (transferAttacker.approvals || 0) + 1);
    if (transferAttacker.isPlayer) {
      game.rlSteals = (game.rlSteals || 0) + 1; // headless RL: player stole a life this frame
      bus.emit("battle:approvalStolen", { kart, transferAttacker });
      game.shake = Math.max(game.shake, 7);
      game.flash = Math.max(game.flash, 4);
      triggerHitFlash("APPROVAL STOLEN +1", "#a4ff80", 80, transferAttacker);
    }
    if (game.particles) {
      spawnApprovalTransferToken(kart, transferAttacker);
      game.particles.add({
        type: "text", text: transferAttacker.isPlayer ? "+1 APPROVAL!" : "STOLEN!", x: kart.x, y: kart.y - 50,
        vx: 0, vy: -1.2, life: 60, maxLife: 60, size: 17, color: "#a4ff80", drag: 0.98,
      });
      game.particles.add({
        type: "text", text: "+1", x: transferAttacker.x, y: transferAttacker.y - 30,
        vx: 0, vy: -1.0, life: 45, maxLife: 45, size: 14, color: "#a4ff80", drag: 0.98,
      });
    }
  }
  if (kart.approvals <= 0) {
    if (killAttacker && killAttacker.isPlayer) {
      triggerHitFlash("REJECTED THEM!", "#ffd86b", 100, killAttacker);
      bus.emit("battle:kartEliminated", { kart: killAttacker, isPlayer: true, killConfirm: true });
    }
    eliminateKart(kart, "REJECTED!", kart.x, kart.y, "#ff3366", killAttacker);
  }
}

// Give every active kart its starting Approvals and clean combat state. Must run AFTER
// all kart objects are final: headless mode replaces game.player (enableHeadlessAgent)
// and, in self-play, game.ais (configureHeadlessEpisode) with fresh karts whose
// `approvals` is undefined — popApproval() no-ops on those, making them unkillable.
function initBattleKartState() {
  const n = clampApprovals(game.battleApprovals);
  game.battleTimeLeft = game.battleDuration;
  game.spectateTarget = null;
  for (const k of getActiveKarts()) {
    if (!k) continue;
    k.approvals = n;
    k.battleSteals = 0;
    k.eliminated = false;
    k._battleSpinSeen = false;
    k.killedBy = null;
    k.lastAttacker = null;
    k.lastAttackerAt = 0;
    k.pendingApprovalTransferFrom = null;
    k.pendingApprovalTransferAt = 0;
    k.recoverGraceTimer = 0;
  }
}

// Headless RL shaping: record that `attacker` landed an offensive hit on a rival this frame.
// Consumed (and reset) by computeHeadlessBattleReward(); harmless during interactive play.
function registerBattleHit(attacker) {
  if (attacker && attacker.isPlayer && isBattleMode()) game.rlHits = (game.rlHits || 0) + 1;
}

// Detects new spin-out events (rising edge) and revokes an approval per hit.
function updateBattleApprovals() {
  if (!isBattleMode()) return;
  const grace = game.raceTime < 1.5; // ignore rocket-start burnout at the line
  for (const k of getActiveKarts()) {
    if (!k) continue;
    const spinning = k.spinoutTimer > 0;
    if (spinning && !k._battleSpinSeen) {
      k._battleSpinSeen = true;
      if (!grace && !k.eliminated) popApproval(k);
    } else if (!spinning) {
      k._battleSpinSeen = false;
    }
  }
}

// Ends the battle when time runs out or only one kart is left standing.
function checkBattleEnd() {
  if (!isBattleMode()) return;
  const simRacing = game.state === STATE.RACING ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.RACING);
  if (!simRacing) return;
  const active = getActiveKarts();
  const alive = active.filter((k) => k && !k.eliminated);
  const timeUp = !isUntimedHumanBattle() && game.battleTimeLeft <= 0;
  // Last-one-standing only counts as a win when there were rivals to begin with.
  const lastStanding = active.length > 1 && alive.length <= 1;
  if (timeUp || lastStanding) {
    // Mark any survivors' finish time so ranking orders them ahead of the eliminated.
    for (const k of alive) {
      if (!k.finished) k.finishTime = game.raceTime;
    }
    finishRace();
  }
}

// The living kart with the most Approvals — used as a spectator fallback if the kill chain breaks.
function battleLeader() {
  const alive = getActiveKarts().filter((k) => k && !k.eliminated);
  if (!alive.length) return null;
  return alive.reduce((best, k) => ((k.approvals || 0) > (best.approvals || 0) ? k : best), alive[0]);
}

// Who to watch after `victim` is out: follow their killer if still alive, else the current leader.
function pickSpectateTarget(victim) {
  const killer = victim && victim.killedBy;
  if (killer && !killer.eliminated) return killer;
  return battleLeader();
}

// Battle spectator chain: once you're rejected you follow your killer; when they get rejected you
// follow whoever got them, and so on, until one kart is left standing.
function updateSpectate() {
  if (!isBattleMode()) { game.spectateTarget = null; return; }
  const p = game.player;
  if (!p || !p.eliminated) { game.spectateTarget = null; return; }
  if (!game.spectateTarget) {
    game.spectateTarget = pickSpectateTarget(p);        // follow your killer
  } else if (game.spectateTarget.eliminated) {
    game.spectateTarget = pickSpectateTarget(game.spectateTarget); // hop to their killer
  }
}

// Kart the camera should follow: the spectated kart while dead in Battle, otherwise the player.
function getViewKart() {
  if (isBattleMode() && game.spectateTarget && !game.spectateTarget.eliminated) return game.spectateTarget;
  return game.player;
}

function absorbFatalHitWithShield(kart, x, y) {
  if (!kart || kart.shieldTimer <= 0) return false;
  kart.shieldTimer = 0;
  Sound.spatialTone(x, y, 620, 0.12, "square", 0.12, 260);
  if (game.particles) {
    game.particles.burst(x, y, "#78dcff", 28, { type: "spark", spdMin: 2, spdMax: 5 });
    game.particles.add({
      type: "text",
      text: "SHIELD BLOCK!",
      x,
      y: y - 28,
      vx: 0,
      vy: -1.0,
      life: 48,
      maxLife: 48,
      size: 16,
      color: "#78dcff",
      drag: 0.98
    });
  }
  return true;
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
function isDragonEscape() { return MAPS[game.selectedMapIdx || 0].id === "dragon_escape"; }


/** Frozen App Compass palette for canvas/HUD drawing (checkpoint 1). */



/* ============================================================
   INPUT
   ============================================================ */

window.addEventListener("keydown", (e) => {
  const code = e.code;
  const key = e.key;

  // Prevent default scroll behavior for navigation keys
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", " "].includes(key) || ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
    e.preventDefault();
  }

  // Global triggers
  if (key === "p" || key === "P") {
    keysGlobal.pause = true;
    keysGlobal.pausePressed = true;
  }
  if (key === "r" || key === "R") {
    keysGlobal.restart = true;
    keysGlobal.restartPressed = true;
  }
  if (key === "m" || key === "M") {
    keysGlobal.mute = true;
    keysGlobal.mutePressed = true;
  }
  if (key === "n" || key === "N" || code === "KeyN") {
    if (Sound.isPlayingMusic) {
      const nextIdx = ((Sound.trackIdx || 0) + 1) % Sound.tracks.length;
      Sound.switchTrack(nextIdx);
      Sound.showTrackToast();
    }
  }
  if (key === "Enter") {
    keysGlobal.enter = true;
    keysGlobal.enterPressed = true;
  }
  if (key === "Escape" || code === "Escape") {
    keysGlobal.back = true;
    keysGlobal.backPressed = true;
  }

  // Player 1 mappings (WASD + Space + LeftShift)
  if (code === "KeyW") keysP1.up = true;
  if (code === "KeyS") keysP1.down = true;
  if (code === "KeyA") {
    if (!keysP1.left) keysP1.leftPressed = true;
    keysP1.left = true;
  }
  if (code === "KeyD") {
    if (!keysP1.right) keysP1.rightPressed = true;
    keysP1.right = true;
  }
  if (code === "Space") {
    if (!keysP1.drift) keysP1.driftPressed = true;
    keysP1.drift = true;
  }
  if (code === "ShiftLeft") {
    if (!keysP1.item) keysP1.itemPressed = true;
    keysP1.item = true;
  }
  if (code === "KeyQ") {
    if (!keysP1.ult) keysP1.ultPressed = true;
    keysP1.ult = true;
  }
  if (code === "KeyE") {
    if (!keysP1.honk) keysP1.honkPressed = true;
    keysP1.honk = true;
  }

  // Player 2 mappings — only in local split-screen (not P2P online)
  const isSplitScreen = game.multiplayer && !game.p2pMode;
  if (code === "ArrowUp") {
    if (isSplitScreen) {
      keysP2.up = true;
    } else {
      keysP1.up = true;
    }
  }
  if (code === "ArrowDown") {
    if (isSplitScreen) {
      keysP2.down = true;
    } else {
      keysP1.down = true;
    }
  }
  if (code === "ArrowLeft") {
    if (isSplitScreen) {
      if (!keysP2.left) keysP2.leftPressed = true;
      keysP2.left = true;
    } else {
      if (!keysP1.left) keysP1.leftPressed = true;
      keysP1.left = true;
    }
  }
  if (code === "ArrowRight") {
    if (isSplitScreen) {
      if (!keysP2.right) keysP2.rightPressed = true;
      keysP2.right = true;
    } else {
      if (!keysP1.right) keysP1.rightPressed = true;
      keysP1.right = true;
    }
  }
  if (code === "ShiftRight") {
    if (isSplitScreen) {
      if (!keysP2.drift) keysP2.driftPressed = true;
      keysP2.drift = true;
    } else {
      if (!keysP1.drift) keysP1.driftPressed = true;
      keysP1.drift = true;
    }
  }
  if (code === "Slash" || code === "Period" || key === "/" || key === ".") {
    if (isSplitScreen) {
      if (!keysP2.item) keysP2.itemPressed = true;
      keysP2.item = true;
    } else {
      if (!keysP1.item) keysP1.itemPressed = true;
      keysP1.item = true;
    }
  }
  if (code === "KeyL") {
    if (isSplitScreen) {
      if (!keysP2.ult) keysP2.ultPressed = true;
      keysP2.ult = true;
    } else {
      if (!keysP1.ult) keysP1.ultPressed = true;
      keysP1.ult = true;
    }
  }
  if (code === "KeyK") {
    if (isSplitScreen) {
      if (!keysP2.honk) keysP2.honkPressed = true;
      keysP2.honk = true;
    } else {
      if (!keysP1.honk) keysP1.honkPressed = true;
      keysP1.honk = true;
    }
  }

  Sound.ensure(); Sound.resume();
}, { passive: false });

window.addEventListener("keyup", (e) => {
  const code = e.code;
  const key = e.key;

  if (key === "Enter") keysGlobal.enter = false;
  if (key === "Escape" || code === "Escape") keysGlobal.back = false;

  // Player 1 keyups
  if (code === "KeyW") keysP1.up = false;
  if (code === "KeyS") keysP1.down = false;
  if (code === "KeyA") keysP1.left = false;
  if (code === "KeyD") keysP1.right = false;
  if (code === "Space") keysP1.drift = false;
  if (code === "ShiftLeft") keysP1.item = false;
  if (code === "KeyQ") keysP1.ult = false;
  if (code === "KeyE") keysP1.honk = false;
  if (code === "KeyL") { keysP2.ult = false; keysP1.ult = false; }
  if (code === "KeyK") { keysP2.honk = false; keysP1.honk = false; }

  // Player 2 keyups
  if (code === "ArrowUp") {
    keysP2.up = false;
    keysP1.up = false;
  }
  if (code === "ArrowDown") {
    keysP2.down = false;
    keysP1.down = false;
  }
  if (code === "ArrowLeft") {
    keysP2.left = false;
    keysP1.left = false;
  }
  if (code === "ArrowRight") {
    keysP2.right = false;
    keysP1.right = false;
  }
  if (code === "ShiftRight") {
    keysP2.drift = false;
    keysP1.drift = false;
  }
  if (code === "Slash" || code === "Period" || key === "/" || key === ".") {
    keysP2.item = false;
    keysP1.item = false;
  }
});


/* ============================================================
   TRACK
   ============================================================ */

// Closed-loop centerline waypoints. World coordinates.
// Designed with: long straight, sweeping curve, hairpin, chicane, narrow section.
// WORLD_W/WORLD_H live bindings imported from entities/track.js

// Multiple premium "Regulaido" stylized maps (tracks)


const AI_DIFFICULTIES = { easy: 0.86, normal: 1.0, hard: 1.12 };
function normalizeAiDifficulty(v) {
  return Object.prototype.hasOwnProperty.call(AI_DIFFICULTIES, v) ? v : "normal";
}

const BATTLE_ARENA_ID = "battle_arena";
function getArenaMapIdx() {
  const idx = MAPS.findIndex((m) => m.id === BATTLE_ARENA_ID);
  return idx >= 0 ? idx : 0;
}
function isArenaMap(mapOrIdx) {
  const m = typeof mapOrIdx === "number" ? MAPS[mapOrIdx] : mapOrIdx;
  return !!(m && m.arena);
}

function isGroundHazardImmuneWhenAirborne(h) {
  return (h instanceof MergeConflict) || (h instanceof PlaceboPill) || (h instanceof DoubleBlindCloud);
}

function shouldSkipGroundHazardForKart(kart, h) {
  if (!isKartAirborne(kart)) return false;
  if (h instanceof DossierProjectile || h instanceof RegulatoryProjectile || h instanceof DragonFire) return false;
  return isGroundHazardImmuneWhenAirborne(h);
}
// Battle timer: human lobby can pick no-limit; headless / external RL always stay timed.
function isUntimedHumanBattle() {
  return isBattleMode() && !!game.battleUntimed && !HEADLESS_MODE;
}

const BATTLE_ATTRIBUTION_WINDOW = 2;
// High-speed ram qualification (units/frame; closing velocity along attacker→defender).
const APPROVAL_RAM_MIN_SPEED = 4.5;
const APPROVAL_RAM_SPEED_MARGIN = 1.25;
const APPROVAL_RAM_MIN_CLOSING = 3.0;
const APPROVAL_RAM_MAX_BEARING_DEG = 50;

function resolveFreshBattleAttribution(victim, attackerField, attackerAtField, windowSec = BATTLE_ATTRIBUTION_WINDOW) {
  if (!victim) return null;
  const attacker = victim[attackerField];
  const at = victim[attackerAtField] || 0;
  if (!attacker || attacker === victim || attacker.eliminated) return null;
  if ((game.raceTime - at) >= windowSec) return null;
  return attacker;
}

function resolveFreshKillAttacker(victim) {
  return resolveFreshBattleAttribution(victim, "lastAttacker", "lastAttackerAt");
}

function resolveFreshTransferAttacker(victim) {
  return resolveFreshBattleAttribution(victim, "pendingApprovalTransferFrom", "pendingApprovalTransferAt");
}

function clearPendingApprovalTransfer(victim) {
  if (!victim) return;
  victim.pendingApprovalTransferFrom = null;
  victim.pendingApprovalTransferAt = 0;
}

function setKillAttribution(victim, attacker) {
  if (!victim || !attacker) return;
  victim.lastAttacker = attacker;
  victim.lastAttackerAt = game.raceTime;
}

function setTransferAttribution(victim, attacker) {
  if (!victim || !attacker) return;
  victim.pendingApprovalTransferFrom = attacker;
  victim.pendingApprovalTransferAt = game.raceTime;
}

function qualifiesApprovalRam(att, def, dirx, diry) {
  if (!att || !def) return false;
  if (isKartAirborne(att) || isKartAirborne(def)) return false;
  const attSpeed = att.speed();
  const defSpeed = def.speed();
  if (attSpeed < APPROVAL_RAM_MIN_SPEED) return false;
  if (attSpeed - defSpeed < APPROVAL_RAM_SPEED_MARGIN) return false;
  const closing = att.vx * dirx + att.vy * diry;
  if (closing < APPROVAL_RAM_MIN_CLOSING) return false;
  const targetAngle = Math.atan2(diry, dirx);
  const attVelAngle = Math.atan2(att.vy, att.vx);
  if (Math.abs(angleDiff(attVelAngle, targetAngle)) > (APPROVAL_RAM_MAX_BEARING_DEG * Math.PI / 180)) return false;
  return true;
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
if (!HEADLESS_MODE) registerSoundListeners(bus);


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
function triggerHitFlash(text, color, duration = 90, kart = null) {
  const hf = { text, color, timer: duration, maxTimer: duration };
  if (kart) {
    kart.hitFlash = hf;
  } else {
    if (game.player) game.player.hitFlash = hf;
  }
}

const ITEM_NAMES = {
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
netRuntime.grandPrixRaces = grandPrixRaces;

// ---- rl runtime (headless subsystem callbacks) ----
rlRuntime.hideAll = hideAll;
rlRuntime.buildRace = buildRace;
rlRuntime.update = update;
rlRuntime.finishRace = finishRace;
rlRuntime.areAllHumansDone = areAllHumansDone;
rlRuntime.rankAll = rankAll;
rlRuntime.progressValue = progressValue;
rlRuntime.gridSlot = gridSlot;
rlRuntime.initBattleKartState = initBattleKartState;
rlRuntime.getKartCollisionRadius = getKartCollisionRadius;
rlRuntime.getRayObjectRadius = getRayObjectRadius;
rlRuntime.qualifiesApprovalRam = qualifiesApprovalRam;
rlRuntime.activateUltimate = activateUltimate;
rlRuntime.startMergeRequestPull = startMergeRequestPull;
rlRuntime.AI_DIFFICULTIES = AI_DIFFICULTIES;
rlRuntime.aiDifficulty = aiDifficulty;
rlRuntime.BATTLE_ARENA_ID = BATTLE_ARENA_ID;







function gridSlot(i) {
  return { f: -5 - 40 * i, l: (i % 2 === 0 ? -28 : 28) };
}

function buildRace() {
  ensureSelectedMapMatchesMode();
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

  // Set music style based on map
  const mapConfig = MAPS[game.selectedMapIdx || 0];
  const mapId = mapConfig.id;
  const assignedTrack = Number.isInteger(mapConfig.musicTrack) ? mapConfig.musicTrack : (Sound.trackIdx || 0);
  Sound.trackIdx = Math.floor(clamp(assignedTrack, 0, Sound.tracks.length - 1));
  Sound.mapStyle = (mapId === "dragon_escape") ? "japanese" : "retro";
  if (Sound.mapStyle === "retro") {
    Sound.tempo = (Sound.tracks[Sound.trackIdx] || Sound.tracks[0]).tempo;
  } else {
    // Dragon's Escape uses the Japanese procedural arrangement, independent of the menu track.
    Sound.tempo = 90;
  }
  // Restart music to pick up style change
  if (Sound.ctx) {
    Sound.stopMusic();
    Sound.startMusic();
  }

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
    const diffMult2p = AI_DIFFICULTIES[aiDifficulty] || 1.0;
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
    const diffMult = AI_DIFFICULTIES[aiDifficulty] || 1.0;
    const n = clampAiCount(aiCount);
    for (let idx = 0; idx < n; idx++) {
      const pos = gridSlot(idx + 1);
      const x = sx + fx * pos.f + lx * pos.l;
      const y = sy + fy * pos.f + ly * pos.l;
      game.ais.push(new AIKart(x, y, ang, aiChars[idx % aiChars.length], baseSkills[idx] * diffMult));
    }

    applySelectedAiModelToOpponents();
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

  // Rebuild 3D scene if in 3D mode
  if (game.viewMode === "3d" && THREE_STATE.loaded) {
    if (!THREE_STATE.renderer) init3DScene();
    rebuild3DTrack();
    THREE_STATE.camSmooth = { x: game.player.x, y: 70, z: game.player.y, lx: game.player.x, ly: 12, lz: game.player.y };
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

function applyRocketStart() {
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

function startRace() {
  game.state = STATE.RACING;
  game.startTime = performance.now();
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
  Sound.countdown(true);
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


function finishRace() {
  if (game.state === STATE.FINISHED) return;
  game.state = STATE.FINISHED;
  game.raceFinishedAt = performance.now();

  // Stop continuous engine, drift, and rumble sounds
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();

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
      if (game.p2pMode) {
        sendP2pMessage({ type: "tournament_standings", tournament: game.tournament });
      }
    }
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

function progressValue(k) {
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

function rankAll() {
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

function getWeightedItem(kart) {
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
  let roll = Math.random() * totalWeight;
  for (const [item, w] of entries) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return "boost";
}

function completeClosedCircuitLap(kart) {
  kart.lap++;
  const now = performance.now();
  if (kart.lastLapAt) {
    kart.lapTimes.push((now - kart.lastLapAt) / 1000);
  }
  kart.lastLapAt = now;
  triggerQuote(kart, "lap");
  if (kart.isPlayer) {
    bus.emit("race:lapCompleted", { kart, isFinalLap: kart.lap === TOTAL_LAPS - 1 && !isDragonEscape() });
  }
  if (kart.isPlayer && kart.lap === TOTAL_LAPS - 1 && !isDragonEscape()) {
    triggerHitFlash("FINAL LAP!", "#ffd86b", 120, kart);
    game.shake = Math.max(game.shake, 6);
    game.flash = Math.max(game.flash, 8);
  }
  if (isBattleMode()) {
    // In battle there is no lap-based finish; laps just loop around the arena.
    return;
  }
  if (kart.lap >= TOTAL_LAPS) {
    kart.finished = true;
    kart.finishTime = (performance.now() - game.startTime) / 1000;
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
        const ang = Math.random() * Math.PI * 2;
        const sp = rand(3, 10);
        game.particles.add({
          type: "rect", x: kart.x, y: kart.y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: rand(45, 90), maxLife: 90, size: rand(6, 13),
          color: colors[Math.floor(Math.random() * colors.length)],
          drag: 0.95, angle: Math.random() * Math.PI * 2, spin: rand(-0.15, 0.15),
        });
      }
      game.slowMoEnd = performance.now() + 1500;
      let allHumanFinished = true;
      if (game.player && !game.player.finished) allHumanFinished = false;
      if (game.multiplayer && game.player2 && !game.player2.finished) allHumanFinished = false;
      if (allHumanFinished) setTimeout(() => finishRace(), 1500);
    }
  }
}

function checkProgress(kart) {
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
function checkItems(kart) {
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
      requestP2pPickup("coin", i, kart);

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
        if (game.viewMode === "3d") emit3DItemPickupBurst(c.x, c.y, "coin");
      }
    }
  }

  // Boost pads
  for (const p of game.track.boostPads) {
    if (dist(kart.x, kart.y, p.x, p.y) < kartPickupThreshold(28, kart)) {
      const now = performance.now();
      const last = p.cooldown.get(kart) || 0;
      if (now - last > 1100) {
        p.cooldown.set(kart, now);
        kart.boostTimer = Math.max(kart.boostTimer, 60);
        if (kart.isPlayer) {
          bus.emit("kart:boost", { kart });
          game.flash = Math.max(game.flash, 6);
          game.particles.burst(kart.x, kart.y, "#ffd86b", 14, { type: "spark", spdMin: 2, spdMax: 5 });
          if (game.viewMode === "3d") emit3DItemPickupBurst(kart.x, kart.y, "boost");
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
      requestP2pPickup("itemBox", i, kart);

      // Mario Kart-style Item Slot Roulette trigger
      if (kart.itemState === "empty") {
        kart.itemState = "rolling";
        kart.itemRollTimer = TUNING.ITEM_ROLL_TIME;

        if (kart.isPlayer) {
          bus.emit("kart:itemPickup", { kart, type: "itembox" });
          game.particles.burst(b.x, b.y, "#ff66cc", 18, { type: "spark", spdMin: 2, spdMax: 5 });
          if (game.viewMode === "3d") emit3DItemPickupBurst(b.x, b.y, "itemBox");
        }
      }
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



/* ============================================================
   KART vs KART COLLISION
   ============================================================ */
// Battle mechanic: a high-speed kart charging into a slower rival spins them out, which costs the
// victim one Approval (life) via updateBattleApprovals() on the spinout rising edge.
// A shield blocks the ram instead. Returns true if the ram connected.
function tryApprovalRam(att, def, dirx, diry) {
  if (!isBattleMode()) return false;
  if (isKartAirborne(att) || isKartAirborne(def)) return false;
  if (def.eliminated || def.finished || def.spinoutTimer > 0 || def.invuln > 0 || (def.recoverGraceTimer || 0) > 0) return false;
  if (!qualifiesApprovalRam(att, def, dirx, diry)) return false;
  if (def.shieldTimer > 0) {
    def.shieldTimer = 0;
    if (def.isPlayer || att.isPlayer) Sound.tone(600, 0.1, "square", 0.1, 300);
    if (game.particles) {
      game.particles.add({
        type: "text", text: "BLOCKED", x: def.x, y: def.y - 28,
        vx: 0, vy: -0.9, life: 40, maxLife: 40, size: 15, color: "#78dcff", drag: 0.98,
      });
    }
    game.particles.burst(def.x, def.y, "#78dcff", 15, { type: "spark", spdMin: 1.5, spdMax: 4 });
    return true;
  }
  setKillAttribution(def, att);
  setTransferAttribution(def, att);
  def.spinoutTimer = TUNING.SPINOUT_TIME; def.spinAngle = 0; def.vx = 0; def.vy = 0;
  registerBattleHit(att);
  if (def.isPlayer || att.isPlayer) { bus.emit("battle:ram", { attacker: att, victim: def }); game.shake = Math.max(game.shake, 8); }
  if (def.isPlayer) triggerHitFlash("RAMMED!", "#ff3366", 80, def);
  spawnCompassRamFx(def, att, dirx, diry);
  game.particles.burst(def.x, def.y, "#ff3366", 22, { type: "spark", spdMin: 2, spdMax: 6 });
  if (game.particles) {
    game.particles.add({
      type: "text", text: "RAMMED!", x: def.x, y: def.y - 34,
      vx: 0, vy: -1.1, life: 50, maxLife: 50, size: 15, color: "#ff3366", drag: 0.98,
    });
  }
  triggerQuote(def, "crash");
  return true; // the actual life loss + attacker reward is handled in popApproval()
}

function kartCollisions() {
  const all = getActiveKarts();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (isKartAirborne(a) || isKartAirborne(b)) continue;
      const rA = getKartCollisionRadius(a);
      const rB = getKartCollisionRadius(b);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
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

        const now = performance.now();
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

function showMovingObstacleHit(kart, obj, label, color, size = 17) {
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

function applyMovingObstacleHit(kart, obj) {
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

  update(dt, t);
  draw(t);
  requestAnimationFrame(loop);
}

function update(dt, time) {
  // Global keys
  if (consumePressed("mute")) {
    Sound.setMuted(!Sound.muted);
  }
  if (consumePressed("back")) {
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
    if (game.state !== STATE.TITLE && game.state !== STATE.SELECT) {
      Sound.stopAllEngines();
      Sound.stopAllDriftSqueals();
      Sound.stopAllRumbles();
      showSelectScreen();
    }
  }
  if (consumePressed("pause")) {
    if (game.state === STATE.RACING || (game.p2pMode && game.state === STATE.COUNTDOWN)) {
      game._pauseFromState = game.state;
      game.state = STATE.PAUSED;
      screens.show("pause");
      updatePauseScreenUi();
    } else if (game.state === STATE.PAUSED) {
      screens.hide("pause");
      game.state = game._pauseFromState || STATE.RACING;
      game._pauseFromState = null;
      updatePauseScreenUi();
    }
  }
  if (consumePressed("enter")) {
    if (game.state === STATE.TITLE) {
      showSelectScreen();
    } else if (game.state === STATE.FINISHED) {
      showSelectScreen();
    }
  }

  // Save the current delta time globally for dynamic smooth lerp follow calculations
  game.lastDt = dt;

  // Decrement speech bubble timers
  const activeKarts = getActiveKarts();
  for (const k of activeKarts) {
    if (k && k.quoteTimer > 0) {
      k.quoteTimer -= dt;
      if (k.quoteTimer <= 0) k.activeQuote = null;
    }
  }

  const countdownSim = game.state === STATE.COUNTDOWN ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.COUNTDOWN);
  const racingSim = game.state === STATE.RACING ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.RACING);

  if (countdownSim) {
    const elapsed = performance.now() - game.countdownStart;
    const prevText = game.countdownText;
    if (elapsed < 900) game.countdownText = "3";
    else if (elapsed < 1800) game.countdownText = "2";
    else if (elapsed < 2700) game.countdownText = "1";
    else if (elapsed < 3500) game.countdownText = "GO!";
    else { applyRocketStart(); startRace(); return; }
    if (prevText !== game.countdownText) {
      if (game.countdownText === "GO!") Sound.countdown(true);
      else Sound.countdown(false);
    }

    // Track gas hold for rocket start (P1)
    if (keysP1.up) {
      if (!game.rocketStartP1.holding) {
        game.rocketStartP1.holding = true;
        game.rocketStartP1.holdStart = elapsed;
      }
    } else {
      game.rocketStartP1.holding = false;
      game.rocketStartP1.holdStart = 0;
    }
    // Track gas hold for rocket start (P2)
    if (game.multiplayer && keysP2.up) {
      if (!game.rocketStartP2.holding) {
        game.rocketStartP2.holding = true;
        game.rocketStartP2.holdStart = elapsed;
      }
    } else if (game.multiplayer) {
      game.rocketStartP2.holding = false;
      game.rocketStartP2.holdStart = 0;
    }

    // Rev engine particles during countdown when holding gas
    if (game.rocketStartP1.holding && game.player && Math.random() < 0.3) {
      const k = game.player;
      const fx = Math.cos(k.heading), fy = Math.sin(k.heading);
      game.particles.add({
        type: "spark",
        x: k.x - fx * 16 + rand(-3, 3), y: k.y - fy * 16 + rand(-3, 3),
        vx: -fx * rand(1, 2.5) + rand(-0.5, 0.5), vy: -fy * rand(1, 2.5) + rand(-0.5, 0.5),
        life: rand(8, 16), maxLife: 16, size: rand(2, 4),
        color: elapsed > 1800 ? "rgba(255,160,40,0.5)" : "rgba(120,120,140,0.4)", drag: 0.94
      });
    }
  }

  if (racingSim) {
    game.raceTime = (performance.now() - game.startTime) / 1000;

    if (isBattleMode()) {
      if (isUntimedHumanBattle()) {
        game.battleTimeLeft = game.battleDuration;
      } else {
        game.battleTimeLeft = Math.max(0, game.battleDuration - game.raceTime);
      }
      if (canResolveBattleCombat()) {
        updateBattleApprovals();
        checkBattleEnd();
      }
      updateSpectate();
    }

    // Dynamic Retro Soundtrack Final Lap Tempo surge (only for retro music)
    if (game.player && Sound.mapStyle === "retro" && !isBattleMode()) {
      const track = Sound.tracks[Sound.trackIdx || 0] || Sound.tracks[0];
      Sound.tempo = track.tempo + (game.player.lap >= TOTAL_LAPS - 1 ? TUNING.FINAL_LAP_TEMPO_BOOST : 0);
    }

    // Player 1
    game.player.update(dt, game.track);
    checkProgress(game.player);
    if (!game.headlessNoItems) checkItems(game.player);

    // Player 2
    if (game.multiplayer && game.player2) {
      if (game.p2pMode) {
        if (game.player2.quoteTimer > 0) game.player2.quoteTimer -= dt;
        if (game.player2.boostTimer > 0) game.player2.boostTimer -= dt;
        if (game.player2.shieldTimer > 0) game.player2.shieldTimer -= dt;
        if (game.player2.spinoutTimer > 0) game.player2.spinoutTimer -= dt;
        if (game.player2.invuln > 0) game.player2.invuln -= dt;
        checkProgress(game.player2);
      } else {
        game.player2.update(dt, game.track);
        checkProgress(game.player2);
        if (!game.headlessNoItems) checkItems(game.player2);
      }
    }

    if (game.p2pMode) {
      const allRemote = new Set([
        ...(game.remotePlayers || []),
        ...(game.p2pRole === "guest" ? game.ais : []),
      ]);
      if (game.player2) allRemote.add(game.player2);
      for (const rk of allRemote) {
        if (isP2pBattleHost() && (rk.mergePullTimer || 0) > 0) {
          applyMergeRequestPull(rk, dt);
        }
        if (rk._lastSyncAt && !rk.finished && !rk.eliminated) {
          rk.x += rk.vx * dt;
          rk.y += rk.vy * dt;
          if ((rk.z || 0) > 0 || (rk.vz || 0) !== 0) {
            integrateKartVertical(rk, dt);
          }
        }
      }
    }

    if (game.p2pMode && game.remotePlayers) {
      for (const remote of game.remotePlayers) {
        if (remote.quoteTimer > 0) remote.quoteTimer -= dt;
        if (remote.boostTimer > 0) remote.boostTimer -= dt;
        if (remote.shieldTimer > 0) remote.shieldTimer -= dt;
        if (remote.spinoutTimer > 0) remote.spinoutTimer -= dt;
        if (remote.invuln > 0) remote.invuln -= dt;
        checkProgress(remote);
      }
    }

    // AI
    if (!game.p2pMode || game.p2pRole === "host") {
      for (const ai of game.ais) {
        ai.update(dt, game.track, activeKarts);
        checkProgress(ai);
        if (!game.headlessNoItems) checkItems(ai);
      }
    }

    if (game.track.regulatoryDragon && !game.headlessNoHazards) {
      if (!game.p2pMode || game.p2pRole === "host") {
        game.track.updateRegulatoryDragon(dt);
      }
      const dragon = game.track.regulatoryDragon;
      if (!game.p2pMode || game.p2pRole === "host") {
        for (const kart of activeKarts) {
          if (!kart || kart.finished || kart.eliminated) continue;
          if (isKartAirborne(kart)) continue;
          const d = dist(kart.x, kart.y, dragon.x, dragon.y);
          if (d < dragon.r + 24 + getKartCollisionRadius(kart) - DEFAULT_KART_COLLISION_RADIUS) {
            if (!absorbFatalHitWithShield(kart, kart.x, kart.y)) {
              eliminateKart(kart, "DEVOURED!", kart.x, kart.y, "#ff3366");
            }
          }
        }
      }
    }

    // Update physical hazards and check collisions
    if (game.hazards && !game.headlessNoHazards) {
      for (let i = game.hazards.length - 1; i >= 0; i--) {
        const h = game.hazards[i];

        if (h instanceof DossierProjectile) {
          h.update(dt, game.track);
        } else {
          h.update(dt);
        }

        if (h.active === false) {
          game.hazards.splice(i, 1);
          continue;
        }

        for (const kart of activeKarts) {
          if ((h instanceof DossierProjectile || h instanceof MergeConflict) && h.owner === kart && h.ignoreOwnerTimer > 0) {
            continue;
          }
          if ((h instanceof PlaceboPill || h instanceof DoubleBlindCloud) && h.owner === kart) {
            continue;
          }

          if (!kart.eliminated && kart.spinoutTimer <= 0 && (kart.recoverGraceTimer || 0) <= 0 && dist(kart.x, kart.y, h.x, h.y) < (h.r || 24) + getKartCollisionRadius(kart) - DEFAULT_KART_COLLISION_RADIUS) {
            if (shouldSkipGroundHazardForKart(kart, h)) continue;
            if (isP2pBattleGuest()) break;
            game.hazards.splice(i, 1);
            const isDossier = (h instanceof DossierProjectile);
            const isRegulatory = (h instanceof RegulatoryProjectile);
            const isPlacebo = (h instanceof PlaceboPill);
            const isDoubleBlind = (h instanceof DoubleBlindCloud);
            if (isBattleMode()) {
              // Balloon-battle: every item hit costs exactly one Approval (life), never an instant KO.
              // A shield still blocks one hit. The spinout gives feedback; updateBattleApprovals()
              // revokes a single Approval on the spinout rising edge (one source of truth, no double-count).
              if (h.owner && h.owner !== kart) { kart.lastAttacker = h.owner; kart.lastAttackerAt = game.raceTime; }
              if (kart.shieldTimer > 0) {
                kart.shieldTimer = 0;
                if (kart.isPlayer) Sound.tone(600, 0.1, "square", 0.1, 300);
                game.particles.burst(h.x, h.y, "#78dcff", 15, { type: "spark", spdMin: 1.5, spdMax: 4 });
              } else {
                kart.spinoutTimer = TUNING.SPINOUT_TIME; kart.spinAngle = 0; kart.vx = 0; kart.vy = 0;
                if (h.owner && h.owner !== kart) registerBattleHit(h.owner);
                if (kart.isPlayer) { Sound.crash(); game.shake = Math.max(game.shake, 8); triggerHitFlash("REVOKED!", "#ff3366", 80, kart); }
                game.particles.burst(h.x, h.y, "#ff3366", 20, { type: "spark", spdMin: 2, spdMax: 5.5 });
                triggerQuote(kart, "crash");
              }
              break;
            }
            if (isRegulatory) {
              if (absorbFatalHitWithShield(kart, h.x, h.y)) {
                // Shield consumed the fatal audit projectile.
              } else {
                eliminateKart(kart, "REGULATED!", h.x, h.y, "#ff3366");
              }
            } else if (kart.shieldTimer > 0) {
              kart.shieldTimer = 0; // Consume shield
              if (kart.isPlayer) {
                Sound.tone(600, 0.1, "square", 0.1, 300);
              }
              game.particles.burst(h.x, h.y, "#78dcff", 15, { type: "spark", spdMin: 1.5, spdMax: 4 });
            } else {
              if (isDossier && kart.charId === "florian") {
                kart.spinoutTimer = TUNING.SPINOUT_TIME_SHORT;
                kart.spinAngle = 0;
                kart.vx *= 0.5; kart.vy *= 0.5;
                kart.shieldTimer = 360; // instantly generates Compliance Shield
                if (kart.isPlayer) {
                  Sound.tone(500, 0.25, "sine", 0.15, 150);
                }
                game.particles.burst(h.x, h.y, "#57f2ff", 20, { type: "spark", spdMin: 1, spdMax: 3 });
                game.particles.add({
                  type: "text", text: "COMPLIANCE SHIELD!", x: h.x, y: h.y - 20,
                  vx: rand(-0.5, 0.5), vy: -1.2, life: 75, maxLife: 75, size: 18, color: "#57f2ff", drag: 0.98
                });
                triggerQuote(kart, "boost");
              } else if (h instanceof DragonFire && isDragonEscape()) {
                eliminateKart(kart, "GOT THE HANDS!", h.x, h.y, "#ff1a1a");
                game.particles.burst(h.x, h.y, "#ff2200", 40, { type: "spark", spdMin: 2, spdMax: 8 });
              } else if (isPlacebo) {
                kart.placeboSlowTimer = Math.max(kart.placeboSlowTimer || 0, TUNING.PLACEBO_SLOW_DURATION);
                if (kart.itemState === "rolling" || kart.itemState === "active") {
                  kart.itemState = "empty";
                  kart.itemSlot = null;
                }
                if (kart.isPlayer) { Sound.crash(); triggerHitFlash("PLACEBO!", "#ffcc00", 80, kart); game.flash = Math.max(game.flash, 6); }
                game.particles.burst(h.x, h.y, "#ffcc00", 22, { type: "spark", spdMin: 1.5, spdMax: 5 });
                game.particles.add({ type: "text", text: "PLACEBO!", x: h.x, y: h.y - 20,
                  vx: rand(-0.5, 0.5), vy: -1.2, life: 75, maxLife: 75, size: 20, color: "#ffcc00", drag: 0.98 });
              } else if (isDoubleBlind) {
                kart.doubleBlindTimer = Math.max(kart.doubleBlindTimer || 0, TUNING.DOUBLE_BLIND_DURATION);
                if (kart.isPlayer) { Sound.noise(0.18, 0.08, 500); game.shake = Math.max(game.shake, 5); triggerHitFlash("DOUBLE BLIND!", "#bd57ff", 90, kart); game.flash = Math.max(game.flash, 8); }
                game.particles.burst(h.x, h.y, "#bd57ff", 24, { type: "spark", spdMin: 1.2, spdMax: 4 });
                game.particles.add({ type: "text", text: "DOUBLE BLIND!", x: h.x, y: h.y - 28,
                  vx: rand(-0.5, 0.5), vy: -1.2, life: 85, maxLife: 85, size: 20, color: "#bd57ff", drag: 0.98 });
              } else {
                kart.spinoutTimer = TUNING.SPINOUT_TIME; kart.spinAngle = 0; kart.vx = 0; kart.vy = 0;
                if (kart.isPlayer) { Sound.crash(); game.shake = Math.max(game.shake, 8); }
                const hazardColor = isDossier ? "#57f2ff" : (isRegulatory ? "#ff3366" : "#ff4d6d");
                const hazardText = isDossier ? "AUDITED!" : (isRegulatory ? "REGULATED!" : "CONFLICT!");
                if (kart.isPlayer) triggerHitFlash(hazardText, hazardColor, 80, kart);
                game.particles.burst(h.x, h.y, hazardColor, 20, { type: "spark", spdMin: 2, spdMax: 5.5 });
                game.particles.add({ type: "text", text: hazardText, x: h.x, y: h.y - 20,
                  vx: rand(-0.5, 0.5), vy: -1.2, life: 75, maxLife: 75, size: 20, color: hazardColor, drag: 0.98 });
                triggerQuote(kart, "crash");
              }
            }
            break;
          }
        }
      }

      // Dragon Fire spawning (host only)
      if (isDragonEscape() && !game.headlessNoHazards) {
        const isDragonAuthority = !game.p2pMode || game.p2pRole === "host";
        if (isDragonAuthority) {
          updateDragonEscapeEntity(dt);
        }
        const raceProgress = clamp(game.raceTime / 90, 0, 1);
        const lapProgress = clamp(game.raceTime / 150, 0, 1);
        const intensity = Math.max(raceProgress, lapProgress);
        if (isDragonAuthority) game.dragonWarnTimer -= dt;
        if (isDragonAuthority && game.dragonWarnTimer <= 0) {
          game.dragonWarnTimer = (7 + Math.random() * 7) / (1 + intensity * 0.5);
          const targets = activeKarts.filter(k => k.spinoutTimer <= 0 && !k.finished && !k.eliminated);
          if (targets.length > 0) {
            const target = getDragonTarget() || pick(targets);
            game.particles.add({ type: "text", text: "DRAGON FIRE!", x: target.x, y: target.y - 40,
              vx: 0, vy: -0.8, life: 50, maxLife: 50, size: 18, color: "#ff3a1f", drag: 0.96 });
            if (target.isPlayer) game.shake = Math.max(game.shake, 3);
            // Number grows 2→7, speed 4→9, spawn slides closer over time
            const numFire = 2 + Math.floor(intensity * 5);
            const fireSpeed = 4 + intensity * 5.5;
            const spawnMin = lerp(1100, 550, intensity);
            const spawnMax = lerp(1700, 1000, intensity);
            const spread = 0.18 + intensity * 0.25;
            const dragon = game.dragonEscape;
            const originX = dragon ? dragon.x + Math.cos(dragon.heading) * 130 : target.x - rand(spawnMin, spawnMax);
            const originY = dragon ? dragon.y + Math.sin(dragon.heading) * 130 : target.y + rand(-220, 220);
            const fireFx = dragon ? Math.cos(dragon.heading) : 1;
            const fireFy = dragon ? Math.sin(dragon.heading) : 0;
            const fireLx = -fireFy;
            const fireLy = fireFx;
            // Occasional "fire wall" at higher intensity: vertical curtain
            const isFireWall = intensity > 0.35 && Math.random() < intensity * 0.45;
            if (isFireWall) {
              const wallCount = 5 + Math.floor(intensity * 7); // 5–12
              for (let i = 0; i < wallCount; i++) {
                const off = -280 + (i / (wallCount - 1)) * 560;
                const startX = originX + fireLx * off;
                const startY = originY + fireLy * off;
                const angle = Math.atan2(target.y - startY, target.x - startX) + rand(-0.08, 0.08);
                game.hazards.push(new DragonFire(startX, startY, angle, fireSpeed));
              }
            } else {
              for (let i = 0; i < numFire; i++) {
                const off = rand(-220, 220);
                const startX = originX + fireLx * off - fireFx * rand(0, 90);
                const startY = originY + fireLy * off - fireFy * rand(0, 90);
                const angle = Math.atan2(target.y - startY, target.x - startX) + rand(-spread, spread);
                game.hazards.push(new DragonFire(startX, startY, angle, fireSpeed));
              }
            }
            const anyPlayer = activeKarts.find(k => k.isPlayer && dist(k.x, k.y, target.x, target.y) < 400);
            if (anyPlayer) Sound.dragonBreath();
          }
        }
        for (const kart of activeKarts) {
          kart.maxSpeed = kart.baseMaxSpeed * (1 + intensity * 0.55);
        }
        if (Sound.mapStyle === "japanese") {
          Sound.tempo = 90 + Math.floor(intensity * 60);
        }
      }
    }

    if (game.track.movingObjects && game.track.movingObjects.length && !game.headlessNoHazards) {
      game.track.updateMovingObjects(dt);
      if (!game.p2pMode || game.p2pRole === "host") {
        for (const obj of game.track.movingObjects) {
          for (const kart of activeKarts) {
            if (kart.spinoutTimer > 0 || kart.finished) continue;
            if (isKartAirborne(kart)) continue;
            if (dist(kart.x, kart.y, obj.x, obj.y) < obj.r + getKartCollisionRadius(kart) - 1) {
              const now = performance.now();
              const lastHit = obj.cooldown?.get(kart) || 0;
              if (now - lastHit < 700) continue;
              obj.cooldown?.set(kart, now);
              applyMovingObstacleHit(kart, obj);
            }
          }
        }
      }
    }

    // Collisions
    if (!isP2pBattleGuest()) {
      kartCollisions();
    }

    // Particles
    game.particles.update(dt);

    // Skid marks fade
    for (let i = game.skidMarks.length - 1; i >= 0; i--) {
      game.skidMarks[i].life -= dt;
      if (game.skidMarks[i].life <= 0) game.skidMarks.splice(i, 1);
    }

    // Effects decay
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 0.45);
    if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 0.35);
    for (const k of activeKarts) {
      if (k.hitFlash && k.hitFlash.timer > 0) k.hitFlash.timer -= dt;
      if (k.posChangeFlash && k.posChangeFlash.timer > 0) k.posChangeFlash.timer -= dt;
    }

    // Position & Overtake checks
    const ranking = rankAll();
    ranking.forEach((kart, rankIdx) => {
      const currentRank = rankIdx + 1;
      if (kart.lastRank !== undefined && kart.lastRank !== currentRank && kart.isPlayer) {
        const gained = currentRank < kart.lastRank;
        kart.posChangeFlash = {
          from: kart.lastRank,
          to: currentRank,
          timer: 80,
          maxTimer: 80,
          gained
        };
        if (gained) triggerQuote(kart, "overtake");
      } else if (kart.lastRank !== undefined && currentRank < kart.lastRank) {
        triggerQuote(kart, "overtake");
      }
      kart.lastRank = currentRank;
    });
    game.hudPosition = ranking.indexOf(game.player) + 1;

    // Wrong-way detection for player karts (no lap direction in Battle)
    if (!isDragonEscape() && !isBattleMode()) {
      for (const pk of [game.player, game.player2].filter(Boolean)) {
        if (pk.finished || pk.eliminated || pk.speed() < 1.5) {
          pk.wrongWayTimer = Math.max(0, (pk.wrongWayTimer || 0) - dt * 2);
          continue;
        }
        const cs = game.track.closestSegment(pk.x, pk.y);
        const seg = game.track.segments[cs.idx];
        if (seg) {
          const segAng = Math.atan2(seg.dy, seg.dx);
          const headingDiff = Math.abs(angleDiff(pk.heading, segAng));
          if (headingDiff > Math.PI * 0.65) {
            pk.wrongWayTimer = Math.min((pk.wrongWayTimer || 0) + dt * 1.5, 60);
          } else {
            pk.wrongWayTimer = Math.max(0, (pk.wrongWayTimer || 0) - dt * 3);
          }
        }
      }
    }

    // Update continuous audio & rumble strips for Player 1
    const p1OnRumble = game.track.isOnRumble(game.player.x, game.player.y);
    const p1Speed = game.player.speed();
    if (p1OnRumble && p1Speed > 1.5) {
      game.shake = Math.max(game.shake, 1.15);
    }
    Sound.updateRumble(1, p1OnRumble, p1Speed);

    const isP1Drifting = !!keysP1.drift && p1Speed > 1.5;
    Sound.updateDriftSqueal(1, isP1Drifting, p1Speed);
    Sound.updateEngine(1, p1Speed, game.player.maxSpeed, game.player.boostTimer > 0);

    // Update continuous audio & rumble strips for Player 2
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
          alert("Lost connection to host.");
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
  if (selectedAiModelId === "classic" || !selectedAiModelWeights || !game.ais || !game.ais.length) return;
  game.ais = game.ais.map((ai, idx) => {
    const char = CHARACTERS.find(c => c.id === ai.charId) || CHARACTERS[(idx + 1) % CHARACTERS.length];
    const dqn = new DqnAIKart(ai.x, ai.y, ai.heading, char, selectedAiModelWeights, ai.skill || 0.96);
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

function renderAiModelSelector() {
  if (!aiModelSelect) return;
  const selectedMap = MAPS[game.selectedMapIdx || 0]?.id;
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
  const current = selectedAiModelId;
  const currentExists = current === "classic" || models.some(m => (m.id || m.path) === current);
  aiModelSelect.innerHTML = `<option value="classic">Classic Waypoint AI</option>`;
  for (const model of models) {
    const actionCount = model.actionCount;
    const incompatible = Number.isFinite(actionCount) && actionCount > HEADLESS_DQN_ACTIONS.length;
    const metrics = getTrackMetrics(model, selectedMap);
    const rate = headlineModelRate(metrics);
    const metricLabel = rate !== null
      ? ` · ${(rate * 100).toFixed(0)}% ${isBattleMode() ? "win" : "finish"} · ${Number(metrics.avg_reward || 0).toFixed(0)} reward`
      : "";
    const option = document.createElement("option");
    option.value = model.id || model.path;
    option.textContent = `${model.name || model.id || model.path}${metricLabel}${incompatible ? " (incompatible)" : ""}`;
    option.disabled = incompatible;
    aiModelSelect.appendChild(option);
  }
  aiModelSelect.value = currentExists ? current : "classic";
  selectedAiModelId = aiModelSelect.value;
  if (aiModelStatus) {
    aiModelStatus.textContent = models.length
      ? `${models.length} trained model${models.length === 1 ? "" : "s"} found`
      : (window.location.protocol === "file:" ? "Serve over HTTP to load trained models" : "Classic AI ready");
  }
  renderAiOpponentSelectors();
}

function getAiModelOptionsHtml(selectedId = "classic") {
  const selectedMap = MAPS[game.selectedMapIdx || 0]?.id;
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
  const options = [`<option value="classic"${selectedId === "classic" ? " selected" : ""}>Classic</option>`];
  for (const model of models) {
    const actionCount = model.actionCount;
    const incompatible = Number.isFinite(actionCount) && actionCount > HEADLESS_DQN_ACTIONS.length;
    const id = model.id || model.path;
    const metrics = getTrackMetrics(model, selectedMap);
    const rate = headlineModelRate(metrics);
    const label = rate !== null
      ? `${model.name || id} · ${(rate * 100).toFixed(0)}% · ${Number(metrics.avg_reward || 0).toFixed(0)}`
      : (model.name || id);
    options.push(`<option value="${id}"${selectedId === id ? " selected" : ""}${incompatible ? " disabled" : ""}>${label}</option>`);
  }
  return options.join("");
}

function renderAiOpponentSelectors() {
  if (!aiOpponentGrid) return;
  const playerIdx = game.selectedCharIdx || 0;
  const opponents = CHARACTERS.filter((_, idx) => idx !== playerIdx);
  aiOpponentGrid.innerHTML = opponents.map((char, idx) => {
    const selected = selectedAiOpponentModels[char.id] || selectedAiModelId || "classic";
    return `
      <label class="ai-opponent-row">
        <span class="ai-opponent-name">${char.name}</span>
        <select class="ai-model-select ai-opponent-select" data-char-id="${char.id}">
          ${getAiModelOptionsHtml(selected)}
        </select>
      </label>
    `;
  }).join("");
  aiOpponentGrid.querySelectorAll(".ai-opponent-select").forEach(select => {
    select.addEventListener("change", () => {
      selectedAiOpponentModels[select.dataset.charId] = select.value || "classic";
    });
  });
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

async function loadSelectedAiModel() {
  if (selectedAiModelId === "classic") {
    selectedAiModelWeights = null;
    if (aiModelStatus) aiModelStatus.textContent = "Classic AI ready";
    return null;
  }
  const model = (aiModelManifest?.models || []).find(m => (m.id || m.path) === selectedAiModelId);
  if (!model) {
    selectedAiModelWeights = null;
    if (aiModelStatus) aiModelStatus.textContent = "Model missing from manifest";
    return null;
  }
  if (model._weights) {
    selectedAiModelWeights = model._weights;
    return selectedAiModelWeights;
  }
  const path = model.path || `models/${model.id}.json`;
  if (aiModelStatus) aiModelStatus.textContent = "Loading model...";
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load AI model: ${response.status}`);
  model._weights = validateModelPayload(await response.json());
  selectedAiModelWeights = model._weights;
  if (aiModelStatus) aiModelStatus.textContent = `Loaded ${model.name || model.id || path}`;
  return selectedAiModelWeights;
}



// Resume audio context on any user click
installTestHooks({
  isUntimedHumanBattle,
  qualifiesApprovalRam,
  resolveFreshBattleAttribution,
  popApproval,
  tryApprovalRam,
  checkBattleEnd,
  isGroundHazardImmuneWhenAirborne,
  setTimeOfDay,
  startMergeRequestPull,
});
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

