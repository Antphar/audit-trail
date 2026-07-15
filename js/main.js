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
  MAP_DAY_PALETTES,
  getMapDayPalette,
  MAP_3D_THEMES,
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
import { Sound, registerSoundListeners } from "./audio/sound.js";

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
const pauseDefaultSubtitle = document.getElementById("pause-default-subtitle");
const pauseP2pSubtitle = document.getElementById("pause-p2p-subtitle");
const p2pCancelLobbyBtn = document.getElementById("p2p-cancel-lobby-btn");
const p2pLeaveMatchBtn = document.getElementById("p2p-leave-match-btn");
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

const startP2pBtn = document.getElementById("start-p2p-btn");
const p2pScreen = document.getElementById("p2p-screen");
const p2pHostBtn = document.getElementById("p2p-host-btn");
const p2pHostStatus = document.getElementById("p2p-host-status");
const p2pCodeBox = document.getElementById("p2p-code-box");
const p2pMyCode = document.getElementById("p2p-my-code");
const p2pHostRoster = document.getElementById("p2p-host-roster");
const p2pJoinRoster = document.getElementById("p2p-join-roster");
const p2pStartRaceBtn = document.getElementById("p2p-start-race-btn");
const p2pJoinInput = document.getElementById("p2p-join-input");
const p2pJoinBtn = document.getElementById("p2p-join-btn");
const p2pJoinStatus = document.getElementById("p2p-join-status");
const p2pBackBtn = document.getElementById("p2p-back-btn");

let peer = null;
let p2pConnections = new Map();
let p2pJoinAttemptSeq = 0;
let aiModelManifest = null;
const DEFAULT_AI_MODEL_ID = "dqn-selfplay-booster-stack4-skip6";
// Trained-model opponents in interactive play: the lobby model picker lets you
// battle trained agents (e.g. DQN Arena v5). Flip to false to hide the picker.
const TRAINED_AI_ENABLED = true;
let selectedAiModelId = DEFAULT_AI_MODEL_ID;
let selectedAiModelWeights = null;
let selectedAiOpponentModels = {};

const savedSettings = loadGameSettings();
const URL_PARAMS = new URLSearchParams(window.location.search);
const HEADLESS_MODE = URL_PARAMS.has("headless");


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

function applyMergeRequestPull(kart, dt) {
  if (!kart.mergePullTimer || kart.mergePullTimer <= 0) return;
  let target = kart.mergePullTarget;
  if ((!target || target.finished) && kart.mergePullTargetId) {
    target = getKartById(kart.mergePullTargetId);
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

function drawMergeRequestTethers(ctx, time) {
  const pulse = 0.45 + 0.35 * Math.sin(time * 0.018);
  for (const kart of getActiveKarts()) {
    if (!kart || !kart.mergePullTimer || kart.mergePullTimer <= 0) continue;
    const target = kart.mergePullTarget || getKartById(kart.mergePullTargetId);
    if (!target || target === kart) continue;
    const x1 = kart.x, y1 = kart.y - kartVisualZOffset(kart);
    const x2 = target.x, y2 = target.y - kartVisualZOffset(target);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    ctx.save();
    ctx.strokeStyle = `rgba(57, 255, 20, ${pulse})`;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#39ff14";
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -time * 0.12;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.strokeStyle = hexToRgba(COMPASS_VISUAL.info, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const beadCount = 4;
    for (let b = 0; b < beadCount; b++) {
      const phase = ((time * 0.0012 + b / beadCount) % 1);
      const bx = x1 + ux * len * phase;
      const by = y1 + uy * len * phase;
      ctx.fillStyle = b % 2 ? COMPASS_VISUAL.mint : COMPASS_VISUAL.primary;
      ctx.beginPath();
      ctx.arc(bx, by, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
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

function drawKartNameTag(ctx, kart, time) {
  if (!kart || kart.eliminated) return;
  const zOff = kartVisualZOffset(kart);
  ctx.save();
  const nx = kart.x;
  const ny = kart.y + 22 - zOff;
  ctx.font = "bold 8px 'SFMono-Regular', Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const isUlt = kart.ultActiveTimer > 0;
  const alpha = isUlt ? 0.6 + 0.3 * Math.sin(time * 0.02) : 0.65;
  ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
  const tw = ctx.measureText(kart.name).width;
  roundRect(ctx, nx - tw / 2 - 4, ny - 1, tw + 8, 12, 3);
  ctx.fill();

  ctx.fillStyle = kart.color;
  ctx.globalAlpha = alpha;
  ctx.fillText(kart.name, nx, ny + 1);
  ctx.restore();
}

// Draws N Approval seals centered horizontally at (x, y) in whatever space `c` is in.
function drawApprovalSeals(c, x, y, n, time = 0, r = 8) {
  if (n <= 0) return;
  c.save();
  const spacing = r * 2.4;
  const startX = x - ((n - 1) * spacing) / 2;
  for (let i = 0; i < n; i++) {
    const cx = startX + i * spacing;
    const bob = Math.sin(time * 0.006 + i * 0.9) * 1.5;
    const cy = y + bob;
    // Drop shadow
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath(); c.arc(cx, cy + 1.5, r, 0, TAU); c.fill();
    // Mint success seal with lavender/purple outer ring
    c.shadowBlur = 8; c.shadowColor = COMPASS_VISUAL.sealFill;
    c.fillStyle = COMPASS_VISUAL.sealFill;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = COMPASS_VISUAL.sealRing;
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
    c.strokeStyle = hexToRgba(COMPASS_VISUAL.info, 0.55);
    c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, r - 2.5, 0, TAU); c.stroke();
    // Check mark
    c.fillStyle = COMPASS_VISUAL.sealMark;
    c.font = `bold ${Math.round(r * 1.5)}px sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("✓", cx, cy + 0.5);
  }
  c.restore();
}

// Floating Approval seals above a kart in Battle mode (2D world-space).
function drawApprovals(ctx, kart, time) {
  if (!isBattleMode() || !kart || kart.eliminated) return;
  const zOff = kartVisualZOffset(kart);
  drawApprovalSeals(ctx, kart.x, kart.y - 40 - zOff, kart.approvals || 0, time, 8);
}

// Screen-space Approval overlay for the 3D chase cam (projects kart world pos).
function drawApprovals3DOverlay(c, time) {
  if (!isBattleMode() || !window.THREE || !THREE_STATE.camera) return;
  const cam = THREE_STATE.camera;
  const v = new THREE.Vector3();
  for (const k of getActiveKarts()) {
    if (!k || k.eliminated) continue;
    const n = k.approvals || 0;
    if (n <= 0) continue;
    v.set(k.x, 52 + (k.z || 0), k.y);
    v.project(cam);
    if (v.z > 1) continue; // behind the camera
    const sx = (v.x * 0.5 + 0.5) * VIEW_W;
    const sy = (-v.y * 0.5 + 0.5) * VIEW_H;
    drawApprovalSeals(c, sx, sy, n, time, 7);
  }
}

function drawSpeechBubble(ctx, kart) {
  if (!kart.activeQuote || kart.quoteTimer <= 0) return;

  ctx.save();
  const zOff = kartVisualZOffset(kart);
  // Position above kart
  const bx = kart.x;
  const by = kart.y - 32 - zOff;

  ctx.font = "bold 11px sans-serif";
  const textWidth = ctx.measureText(kart.activeQuote).width;
  const padH = 8;
  const padV = 5;
  const bw = textWidth + padH * 2;
  const bh = 14 + padV * 2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, bx - bw / 2 + 2, by - bh - 6 + 2, bw, bh, 6);
  ctx.fill();

  // Glassmorphic background with custom neon border matching developer theme
  ctx.fillStyle = "rgba(10, 8, 28, 0.88)";
  ctx.strokeStyle = kart.color || "#ffffff";
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  roundRect(ctx, bx - bw / 2, by - bh - 6, bw, bh, 6);
  ctx.fill();
  ctx.stroke();

  // Stem triangle pointing to kart
  ctx.fillStyle = "rgba(10, 8, 28, 0.88)";
  ctx.beginPath();
  ctx.moveTo(bx - 5, by - 6);
  ctx.lineTo(bx + 5, by - 6);
  ctx.lineTo(bx, by);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(bx - 5, by - 6);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + 5, by - 6);
  ctx.stroke();

  // Text rendering
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kart.activeQuote, bx, by - bh / 2 - 5);

  ctx.restore();
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

const _compassPatternCache = new WeakMap();

function getCompassFloorPattern(ctx, surfaceKey) {
  let surfaceMap = _compassPatternCache.get(ctx);
  if (!surfaceMap) {
    surfaceMap = new Map();
    _compassPatternCache.set(ctx, surfaceMap);
  }
  if (surfaceMap.has(surfaceKey)) return surfaceMap.get(surfaceKey);

  const parts = surfaceKey.split(":");
  const tod = parts[0];
  const surface = parts[1];
  const day = tod === "day";
  const tile = surface === "arena" ? 128 : surface === "road" ? 96 : 80;
  const off = document.createElement("canvas");
  off.width = tile;
  off.height = tile;
  const oc = off.getContext("2d");

  if (surface === "arena") {
    // Transparent dashboard grid: preserve the radial floor shading beneath it.
    oc.strokeStyle = day ? "rgba(79, 72, 112, 0.08)" : "rgba(235, 228, 255, 0.045)";
    oc.lineWidth = 1;
    oc.beginPath();
    for (let p = 32; p < tile; p += 32) {
      oc.moveTo(p + 0.5, 0); oc.lineTo(p + 0.5, tile);
      oc.moveTo(0, p + 0.5); oc.lineTo(tile, p + 0.5);
    }
    oc.stroke();
    oc.strokeStyle = day ? "rgba(123, 117, 255, 0.19)" : "rgba(139, 133, 255, 0.12)";
    oc.strokeRect(0.5, 0.5, tile - 1, tile - 1);
    oc.fillStyle = day ? "rgba(253, 153, 39, 0.34)" : "rgba(253, 153, 39, 0.22)";
    oc.fillRect(5, 5, 11, 2);
    oc.fillRect(5, 5, 2, 11);
    oc.fillStyle = day ? "rgba(164, 255, 128, 0.38)" : "rgba(164, 255, 128, 0.18)";
    oc.beginPath(); oc.arc(tile / 2, tile / 2, 2, 0, TAU); oc.fill();
  } else if (surface === "grass") {
    const mapPal = day && parts[2] ? getMapDayPalette(parts[2]) : null;
    // Transparent app-shell grid over the existing sky/ground gradient.
    oc.strokeStyle = day ? (mapPal?.grassGrid || "rgba(79, 72, 112, 0.09)") : "rgba(123, 117, 255, 0.06)";
    oc.lineWidth = 1;
    oc.beginPath();
    oc.moveTo(0, tile - 0.5);
    oc.lineTo(tile, tile - 0.5);
    oc.moveTo(tile - 0.5, 0);
    oc.lineTo(tile - 0.5, tile);
    oc.stroke();
    oc.fillStyle = day ? (mapPal?.grassTint || "rgba(230, 255, 220, 0.24)") : "rgba(235, 228, 255, 0.04)";
    oc.fillRect(0, 0, tile, 2);
  } else {
    // Dense, quiet road material; all detail is baked once into this tile.
    oc.fillStyle = day ? "#211c30" : "#15121f";
    oc.fillRect(0, 0, tile, tile);
    oc.strokeStyle = day ? "rgba(235, 228, 255, 0.08)" : "rgba(139, 133, 255, 0.08)";
    oc.lineWidth = 1;
    oc.beginPath();
    oc.moveTo(0, 24.5); oc.lineTo(tile, 24.5);
    oc.moveTo(0, 72.5); oc.lineTo(tile, 72.5);
    oc.stroke();
    oc.strokeStyle = day ? "rgba(123, 117, 255, 0.22)" : "rgba(79, 72, 112, 0.28)";
    oc.setLineDash([10, 14]);
    oc.beginPath(); oc.moveTo(0, tile / 2 + 0.5); oc.lineTo(tile, tile / 2 + 0.5); oc.stroke();
    oc.setLineDash([]);
    oc.fillStyle = day ? "rgba(253, 153, 39, 0.2)" : "rgba(253, 153, 39, 0.12)";
    for (let i = 0; i < 4; i++) oc.fillRect(12 + i * 23, 12 + ((i * 17) % 70), 2, 2);
  }

  const pattern = ctx.createPattern(off, "repeat");
  surfaceMap.set(surfaceKey, pattern);
  return pattern;
}

function getMapFeatureChips(map) {
  if (map.arena) {
    const ramps = (map.ramps || []).filter((r) => r.kind !== "bump").length;
    const bumps = (map.ramps || []).filter((r) => r.kind === "bump").length;
    const chips = ["OPEN", `${ramps} RAMPS`];
    if (bumps > 0) chips.push(`${bumps} BUMPS`);
    if (map.reviewPlatformRadius > 0) chips.push("REVIEW ZONE");
    return chips;
  }
  const chips = [`${(map.waypoints || []).length} SEGMENTS`];
  const boosts = (map.boostPadSegs || []).length;
  if (boosts > 0) chips.push(`${boosts} BOOSTS`);
  if (map.id === "dragon_escape") chips.push("ENDLESS");
  return chips;
}


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
let WORLD_W = 3400;
let WORLD_H = 2400;

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
function ensureSelectedMapMatchesMode() {
  const wantsArena = isBattleMode();
  const current = MAPS[game.selectedMapIdx];
  if (current && !!current.arena === wantsArena) {
    if (!wantsArena && game.mapSelection === GRAND_PRIX_ID) return game.selectedMapIdx;
    if (game.mapSelection !== GRAND_PRIX_ID) game.mapSelection = current.id;
    return game.selectedMapIdx;
  }

  const fallbackIdx = wantsArena
    ? getArenaMapIdx()
    : MAPS.findIndex((map) => !map.arena);
  game.selectedMapIdx = fallbackIdx >= 0 ? fallbackIdx : 0;
  game.mapSelection = MAPS[game.selectedMapIdx].id;
  return game.selectedMapIdx;
}

function getGrandPrixCircuitIndices() {
  const indices = [];
  for (let i = 0; i < MAPS.length; i++) {
    const m = MAPS[i];
    if (!m.arena && m.id !== "dragon_escape") indices.push(i);
  }
  return indices;
}

function getDefaultCircuitMapIdx() {
  const circuits = getGrandPrixCircuitIndices();
  return circuits.length ? circuits[0] : 0;
}

function isGrandPrixSelection() {
  return game.mapSelection === GRAND_PRIX_ID;
}

function isGrandPrixActive(t = game.tournament) {
  return !!(t && t.format === "grand_prix" && t.totalRaces > 1);
}

function shouldShowGrandPrixCard() {
  return !isBattleMode() && (!game.multiplayer || game.p2pMode);
}

function createGrandPrixTournament(totalRaces = grandPrixRaces) {
  const circuits = getGrandPrixCircuitIndices();
  const safeTotal = clampGrandPrixRaces(totalRaces);
  const circuitOrder = [];
  for (let i = 0; i < safeTotal; i++) {
    circuitOrder.push(circuits[i % circuits.length]);
  }
  return {
    format: "grand_prix",
    totalRaces: safeTotal,
    raceIndex: 0,
    standings: [],
    circuitOrder,
  };
}

function selectGrandPrixMap() {
  game.mapSelection = GRAND_PRIX_ID;
  game.tournament = null;
  game.selectedMapIdx = getDefaultCircuitMapIdx();
}

function selectCircuitMap(idx) {
  const map = MAPS[idx];
  if (!map) return;
  game.mapSelection = map.id;
  game.selectedMapIdx = idx;
  game.tournament = null;
}

function syncMapSelectionFromIdx(mapIdx) {
  const map = MAPS[mapIdx];
  if (map) game.mapSelection = map.id;
}

function sanitizeP2pLobbyMode(mode) {
  return mode === "battle" ? "battle" : "race";
}

function isP2pBattleGuest() {
  return !!(game.p2pMode && isBattleMode() && game.p2pRole === "guest");
}

function isP2pBattleHost() {
  return !!(game.p2pMode && isBattleMode() && game.p2pRole === "host");
}

function canResolveBattleCombat() {
  return !isP2pBattleGuest();
}

function resetP2pReadyForLobbyChange() {
  if (!game.p2pMode) return;
  for (const p of (game.p2pPlayers || [])) p.locked = false;
  game.p1Locked = false;
  game.p2Locked = false;
  syncP2pSelectionFromRoster({ preserveLocal: true });
  if (game.p2pRole === "host") broadcastP2pLobby();
  updateSelectionHighlight();
  updateP2pStartButton();
}

function selectArenaMap(idx) {
  const map = MAPS[idx];
  if (!map || !map.arena) return;
  game.mode = "battle";
  game.mapSelection = map.id;
  game.selectedMapIdx = idx;
  game.tournament = null;
}

function selectP2pMap({ mapIdx, mapSelection, mode } = {}) {
  if (game.p1Locked && game.p2pRole === "host") return;
  const nextMode = sanitizeP2pLobbyMode(mode);
  game.mode = nextMode;
  if (nextMode === "battle") {
    game.tournament = null;
    if (mapIdx !== undefined) selectArenaMap(mapIdx);
  } else if (mapSelection === GRAND_PRIX_ID) {
    selectGrandPrixMap();
  } else if (mapIdx !== undefined) {
    selectCircuitMap(mapIdx);
  }
  ensureSelectedMapMatchesMode();
  resetP2pReadyForLobbyChange();
  const selectedMap = MAPS[game.selectedMapIdx || 0];
  if (selectedMap) previewSelectedMapMusic(selectedMap);
  renderMapSelect();
  renderAiModelSelector();
  updateDriveButtonLabel();
  updateP2pBattleLobbyUi();
  Sound.tone(nextMode === "battle" ? 700 : 520, 0.08, "sine", 0.15);
}

function updateP2pBattleLobbyUi() {
  const battleSection = document.getElementById("battle-select-section");
  const showBattleRules = isBattleMode() || (game.p2pMode && isArenaMap(game.selectedMapIdx));
  if (battleSection) battleSection.style.display = showBattleRules ? "flex" : "none";
  if (showBattleRules) renderApprovalsSelect();
  const isGuest = game.p2pMode && game.p2pRole === "guest";
  if (battleSection) {
    battleSection.querySelectorAll("button").forEach((b) => {
      b.disabled = isGuest;
      b.classList.toggle("disabled", isGuest);
    });
  }
  if (game.p2pMode) {
    const subtitle = document.getElementById("lobby-subtitle");
    const hint = document.getElementById("lobby-hint");
    if (subtitle) {
      subtitle.innerText = game.p2pRole === "host"
        ? "Online Lobby: Pick Mode, Map & Coder"
        : "Online Lobby: Host Picks Mode & Map · Pick Your Coder";
    }
    if (hint) {
      hint.innerText = game.p2pRole === "host"
        ? "Host picks mode/map/rules · Everyone picks coder · Space/Enter to ready"
        : "Host picks mode/map/rules · Pick coder · Space/Enter to ready";
    }
  }
}

function applyLobbyMapSelection(data = {}) {
  if (data.mode !== undefined) game.mode = sanitizeP2pLobbyMode(data.mode);
  if (data.battleApprovals !== undefined) game.battleApprovals = clampApprovals(data.battleApprovals);
  if (data.battleUntimed !== undefined) game.battleUntimed = !!data.battleUntimed;
  if (data.mapIdx !== undefined) game.selectedMapIdx = data.mapIdx;
  if (data.mapSelection !== undefined) {
    game.mapSelection = data.mapSelection;
  } else if (data.mapIdx !== undefined) {
    syncMapSelectionFromIdx(data.mapIdx);
  }
  if (data.grandPrixRaces !== undefined) grandPrixRaces = clampGrandPrixRaces(data.grandPrixRaces);
  ensureSelectedMapMatchesMode();
  if (isBattleMode()) game.tournament = null;
  if (game.state === STATE.SELECT || !isGrandPrixSelection()) game.tournament = null;
}

function prepareRaceFormatFromSelection() {
  if (!isGrandPrixSelection()) {
    game.tournament = null;
    return;
  }
  if (!game.tournament || game.tournament.format !== "grand_prix") {
    game.tournament = createGrandPrixTournament(grandPrixRaces);
  }
  const order = game.tournament.circuitOrder || [];
  game.selectedMapIdx = order[game.tournament.raceIndex] ?? getDefaultCircuitMapIdx();
  game.mapSelection = GRAND_PRIX_ID;
}

function getTournamentRaceMapIdx(tournament) {
  if (tournament?.format === "grand_prix" && Array.isArray(tournament.circuitOrder) && tournament.circuitOrder.length) {
    return tournament.circuitOrder[tournament.raceIndex] ?? tournament.circuitOrder[0];
  }
  return getNextCircuitMapIdx(game.selectedMapIdx || 0);
}

function getRaceStartButtonLabel({ p2pHost = false, allReady = true, readyCount = 0, totalPlayers = 0 } = {}) {
  if (p2pHost) {
    if (!allReady) return `Waiting (${readyCount}/${totalPlayers})`;
    if (isBattleMode()) return "Start Online Battle";
    return isGrandPrixSelection() ? "Start Grand Prix" : "Start Online Race";
  }
  if (isBattleMode()) return "Battle!";
  return isGrandPrixSelection() ? "Start Grand Prix" : "Drive!";
}

function getGrandPrixPreviewSvg() {
  const colors = ["#57f2ff", "#fd9927", "#a4ff80", "#bd57ff"];
  let tracks = "";
  for (let i = 0; i < 4; i++) {
    const x = 24 + i * 36;
    const y = 30 + (i % 2) * 7;
    tracks += `<ellipse cx="${x}" cy="${y}" rx="13" ry="8" fill="none" stroke="${colors[i]}" stroke-width="2" opacity="0.75"/>`;
  }
  return `
    <svg viewBox="0 0 180 70" aria-hidden="true" focusable="false">
      <g opacity="0.9">${tracks}</g>
      <path d="M90 6 L97 22 L114 24 L101 36 L105 54 L90 45 L75 54 L79 36 L66 24 L83 22 Z" fill="#ffd86b" stroke="#c9a830" stroke-width="1.4"/>
      <rect x="84" y="40" width="12" height="10" rx="2" fill="#c9a830"/>
    </svg>
  `;
}

function getP2pLobbyMapPayload() {
  return {
    mode: isBattleMode() ? "battle" : "race",
    battleApprovals: clampApprovals(game.battleApprovals),
    battleUntimed: !!game.battleUntimed,
    mapIdx: game.selectedMapIdx,
    mapSelection: game.mapSelection,
    grandPrixRaces,
    trackIdx: Sound.trackIdx,
  };
}
function normalizeTimeOfDay(v) {
  return v === "night" ? "night" : "day";
}
function isDayMode() {
  return normalizeTimeOfDay(game?.timeOfDay ?? savedSettings.timeOfDay) === "day";
}

const VERTICAL_GRAVITY = 0.32;
const RAMP_IMPULSE = 5.8;
const BUMP_IMPULSE = 2.7;
const AIRBORNE_THRESHOLD = 4;
const KART_MAX_JUMP_Z = 120;
const RAMP_COOLDOWN_MS = 900;
const KART_GROUNDED_Z = 0.5;


function isKartAirborne(kart) {
  return !!(kart && (kart.z || 0) > AIRBORNE_THRESHOLD);
}

function isKartGrounded(kart) {
  return !kart || (kart.z || 0) <= KART_GROUNDED_Z;
}

function kartVisualZOffset(kart) {
  return (kart?.z || 0) * 0.65;
}

function integrateKartVertical(kart, dt) {
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

function constrainArenaKart(kart, track) {
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
    triggerQuote(kart, "crash");
    kart.lastBumpAt = performance.now();
    if (kart.isPlayer) {
      Sound.bump();
      game.shake = Math.max(game.shake, 5);
    }
  }
  return true;
}

function checkTrackRamps(kart, track) {
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

function isGroundHazardImmuneWhenAirborne(h) {
  return (h instanceof MergeConflict) || (h instanceof PlaceboPill) || (h instanceof DoubleBlindCloud);
}

function shouldSkipGroundHazardForKart(kart, h) {
  if (!isKartAirborne(kart)) return false;
  if (h instanceof DossierProjectile || h instanceof RegulatoryProjectile || h instanceof DragonFire) return false;
  return isGroundHazardImmuneWhenAirborne(h);
}
function isBattleMode() {
  return game.mode === "battle";
}
function clampApprovals(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.max(3, Math.min(5, n));
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

let grandPrixRaces = clampGrandPrixRaces(savedSettings.grandPrixRaces ?? savedSettings.seriesRaces ?? 3);
let aiCount = clampAiCount(savedSettings.aiCount ?? 4);
let aiDifficulty = normalizeAiDifficulty(savedSettings.aiDifficulty);
const CHECKPOINT_RADIUS = 80;

class Track {
  constructor() {
    const mapConfig = MAPS[game.selectedMapIdx || 0];
    WORLD_W = mapConfig.worldW;
    WORLD_H = mapConfig.worldH;
    this.waypoints = mapConfig.waypoints;
    this.n = this.waypoints.length;
    this.halfWidth = mapConfig.roadHalfBase;
    const segWidthConfig = mapConfig.segWidth || {};

    this.isOpen = (mapConfig.id === "dragon_escape");
    this.hasCustomCheckpoints = Array.isArray(mapConfig.checkpointGroups) && mapConfig.checkpointGroups.length > 0;
    this.checkpointGroups = this._buildCheckpointGroups(mapConfig.checkpointGroups);
    this.checkpointCount = this.checkpointGroups.length;

    // Pre-compute segment data (length, normal, half-width)
    this.segments = [];
    for (let i = 0; i < this.n; i++) {
      const a = this.waypoints[i];
      let b;
      if (this.isOpen) {
        b = this.waypoints[i + 1];
        if (!b) break; // end of open trail
      } else {
        b = this.waypoints[(i + 1) % this.n];
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      const nx = -dy / len, ny = dx / len; // left normal
      const wScale = (segWidthConfig[i] || 1);
      this.segments.push({
        a, b, dx, dy, len, nx, ny,
        halfW: this.halfWidth * wScale,
      });
    }

    // Arena identity comes from fixed boundary landmarks; random pillars can obstruct chase view.
    this.decorations = mapConfig.arenaFloor ? [] : this._generateDecor();
    this.spectators = this._generateSpectators();

    // Coins, boost pads, item boxes
    this.coins = this._placeCoins();
    this.boostPads = this._placeBoostPads(mapConfig.boostPadSegs || []);
    this.itemBoxes = this._placeItemBoxes(mapConfig.itemBoxSegs || []);
    this.movingObjects = this._placeMovingObjects(mapConfig.movingObjects || []);
    this.regulatoryDragon = this._createRegulatoryDragon(mapConfig.regulatoryDragon);
    this.arenaFloor = mapConfig.arenaFloor || null;
    this.reviewPlatformRadius = mapConfig.reviewPlatformRadius || 0;
    this.ramps = this._normalizeRamps(mapConfig.ramps || []);
    this.arenaBoundaryLandmarks = this.arenaFloor ? this._buildArenaBoundaryLandmarks() : null;
  }

  _buildArenaBoundaryLandmarks() {
    const floor = this.arenaFloor;
    const labels = ["POLICY", "EVIDENCE", "REVIEW", "APPROVED", "AUDIT", "COMPLY", "SIGN-OFF", "VERIFY"];
    const count = Math.min(8, Math.max(4, labels.length));
    const landmarks = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU - Math.PI / 2;
      const dist = 0.9;
      landmarks.push({
        x: floor.cx + Math.cos(a) * floor.rx * dist,
        y: floor.cy + Math.sin(a) * floor.ry * dist,
        ang: a + Math.PI / 2,
        label: labels[i],
      });
    }
    return landmarks;
  }

  _normalizeRamps(entries) {
    return entries.map((r) => ({
      x: r.x,
      y: r.y,
      ang: r.ang,
      w: r.w || 70,
      h: r.h || 36,
      kind: r.kind || "ramp",
      impulse: r.impulse ?? (r.kind === "bump" ? BUMP_IMPULSE : RAMP_IMPULSE),
      minSpeed: r.minSpeed ?? (r.kind === "bump" ? 2.0 : 3.2),
      cooldown: new Map(),
    }));
  }

  _buildCheckpointGroups(groups) {
    const source = this.hasCustomCheckpoints ? groups : this.waypoints;
    return source.map((entry, idx) => {
      const fallback = this.waypoints[Math.min(idx, this.waypoints.length - 1)] || this.waypoints[0] || { x: 0, y: 0 };
      const list = Array.isArray(entry) ? entry : [entry];
      return list.map(point => ({
        x: Number.isFinite(point?.x) ? point.x : fallback.x,
        y: Number.isFinite(point?.y) ? point.y : fallback.y,
        r: Number.isFinite(point?.r) ? point.r : CHECKPOINT_RADIUS,
      }));
    });
  }

  checkpointCenter(idx) {
    const count = this.checkpointCount || 1;
    const group = this.checkpointGroups[((idx % count) + count) % count] || [];
    if (!group.length) return this.waypoints[((idx % this.n) + this.n) % this.n] || null;
    const sum = group.reduce((acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    }, { x: 0, y: 0 });
    return { x: sum.x / group.length, y: sum.y / group.length };
  }

  hitCheckpoint(idx, x, y) {
    const group = this.checkpointGroups[idx];
    if (!group || !group.length) return false;
    return group.some(point => dist(x, y, point.x, point.y) <= (point.r || CHECKPOINT_RADIUS));
  }

  startLineGate() {
    const s = this.segments[0];
    if (!s) return null;
    const ux = s.dx / s.len;
    const uy = s.dy / s.len;
    return {
      x: s.a.x + s.dx * 0.06,
      y: s.a.y + s.dy * 0.06,
      ux,
      uy,
      nx: s.nx,
      ny: s.ny,
      halfW: s.halfW,
    };
  }

  crossedStartLine(prevX, prevY, x, y) {
    const gate = this.startLineGate();
    if (!gate || !Number.isFinite(prevX) || !Number.isFinite(prevY)) return false;
    const prevAlong = (prevX - gate.x) * gate.ux + (prevY - gate.y) * gate.uy;
    const currAlong = (x - gate.x) * gate.ux + (y - gate.y) * gate.uy;
    if (!(prevAlong <= 0 && currAlong > 0)) return false;

    const denom = currAlong - prevAlong;
    const t = denom !== 0 ? clamp(-prevAlong / denom, 0, 1) : 0;
    const ix = lerp(prevX, x, t);
    const iy = lerp(prevY, y, t);
    const lateral = Math.abs((ix - gate.x) * gate.nx + (iy - gate.y) * gate.ny);
    return lateral <= gate.halfW + 12;
  }

  // Find closest segment to a world point
  closestSegment(x, y) {
    let bestI = 0, bestD = Infinity, bestT = 0, bestProj = null;
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const p = pointSegProjection(x, y, s.a.x, s.a.y, s.b.x, s.b.y);
      if (p.d < bestD) { bestD = p.d; bestI = i; bestT = p.t; bestProj = p; }
    }
    return { idx: bestI, dist: bestD, t: bestT, proj: bestProj };
  }

  // Is point on the road surface?
  isOnRoad(x, y) {
    if (this.arenaFloor) {
      return ellipseNormDist(x, y, this.arenaFloor) <= 1.0;
    }
    const c = this.closestSegment(x, y);
    return c.dist <= this.segments[c.idx].halfW;
  }

  // Is point on the outer rumble strip?
  isOnRumble(x, y) {
    const c = this.closestSegment(x, y);
    const seg = this.segments[c.idx];
    return c.dist > seg.halfW && c.dist <= seg.halfW + 10;
  }

  // Returns the over-edge distance (>0 if outside the road) on this segment
  offRoadDepth(x, y) {
    if (this.arenaFloor) {
      const nd = ellipseNormDist(x, y, this.arenaFloor);
      if (nd <= 1) return 0;
      const scale = Math.min(this.arenaFloor.rx, this.arenaFloor.ry);
      return (nd - 1) * scale;
    }
    const c = this.closestSegment(x, y);
    const seg = this.segments[c.idx];
    return c.dist - seg.halfW;
  }

  _generateDecor() {
    const mapId = MAPS[game.selectedMapIdx || 0].id;
    const isDragon = mapId === "dragon_escape";
    const decor = [];
    const colors = isDragon
      ? ["#ff4d4d", "#ffb84d", "#ffd700", "#ff6b6b", "#c0392b"]
      : ["#7b75ff", "#fd9927", "#ff4d6d", "#a4ff80"];

    if (isDragon) {
      // Open trail: place 1 decor every ~6 segments along alternating sides
      for (let i = 0; i < this.segments.length; i += 6) {
        const s = this.segments[i];
        if (!s) continue;
        const t = 0.5;
        const cx = s.a.x + s.dx * t;
        const cy = s.a.y + s.dy * t;
        const side = (i % 2 === 0) ? 1 : -1;
        const offDist = s.halfW + 60 + Math.random() * 120;
        decor.push({
          x: cx + s.nx * offDist * side,
          y: cy + s.ny * offDist * side,
          r: rand(8, 16),
          h: rand(40, 70),
          color: pick(colors),
          pulseOffset: Math.random() * Math.PI * 2,
          isJapanese: true,
          type: Math.random() < 0.3 ? "lantern" : (Math.random() < 0.5 ? "torii" : "sakura")
        });
      }
      return decor;
    }

    // Closed-loop maps: scattered random trees
    let attempts = 0;
    const count = 80;
    const maxDist = 380;
    while (decor.length < count && attempts < 4000) {
      attempts++;
      const x = rand(120, WORLD_W - 120);
      const y = rand(120, WORLD_H - 120);
      const c = this.closestSegment(x, y);
      const seg = this.segments[c.idx];
      if (c.dist > seg.halfW + 50 && c.dist < seg.halfW + maxDist) {
        decor.push({
          x, y,
          r: rand(10, 18),
          h: rand(35, 60),
          color: pick(colors),
          pulseOffset: Math.random() * Math.PI * 2,
          isJapanese: false,
          type: "pillar"
        });
      }
    }
    return decor;
  }

  _generateSpectators() {
    const specs = [];
    const mapId = MAPS[game.selectedMapIdx || 0].id;
    if (mapId === "dragon_escape") return specs;
    const colors = ["#ff4d6d", "#7b75ff", "#fd9927", "#a4ff80", "#57f2ff", "#b983ff", "#ff6b35", "#ffd86b"];
    // Place small clusters of spectators along track edges
    for (let i = 0; i < this.segments.length; i += 4) {
      if (Math.random() > 0.45) continue;
      const s = this.segments[i];
      if (!s) continue;
      const t = rand(0.2, 0.8);
      const cx = s.a.x + s.dx * t;
      const cy = s.a.y + s.dy * t;
      const side = Math.random() < 0.5 ? 1 : -1;
      const offDist = s.halfW + rand(18, 35);
      const clusterSize = Math.floor(rand(2, 5));
      for (let c = 0; c < clusterSize; c++) {
        specs.push({
          x: cx + s.nx * offDist * side + rand(-12, 12),
          y: cy + s.ny * offDist * side + rand(-8, 8),
          color: pick(colors),
          phase: Math.random() * TAU,
          height: rand(6, 9),
          cheerThreshold: rand(80, 160),
        });
      }
    }
    return specs;
  }

  drawSpectators(ctx, time) {
    for (const sp of this.spectators) {
      // Check if any kart is close enough to trigger cheering
      let cheering = false;
      for (const k of getActiveKarts()) {
        if (dist(sp.x, sp.y, k.x, k.y) < sp.cheerThreshold) { cheering = true; break; }
      }
      const bounce = cheering ? Math.abs(Math.sin(time * 0.012 + sp.phase)) * 4 : 0;
      const wave = cheering ? Math.sin(time * 0.02 + sp.phase) * 2 : 0;

      ctx.save();
      ctx.translate(sp.x + wave, sp.y);

      // Body (tiny pixel-art person)
      ctx.fillStyle = sp.color;
      ctx.fillRect(-2, -sp.height - bounce, 4, sp.height * 0.55);
      // Head
      ctx.beginPath();
      ctx.arc(0, -sp.height - bounce - 2, 2.5, 0, TAU);
      ctx.fill();
      // Legs
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(-2, -sp.height * 0.45 - bounce, 2, sp.height * 0.45);
      ctx.fillRect(0, -sp.height * 0.45 - bounce, 2, sp.height * 0.45);

      // Arms waving when cheering
      if (cheering) {
        const armAng = Math.sin(time * 0.018 + sp.phase) * 0.6;
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-2, -sp.height * 0.7 - bounce);
        ctx.lineTo(-5 + wave, -sp.height - bounce - 3 + armAng * 3);
        ctx.moveTo(2, -sp.height * 0.7 - bounce);
        ctx.lineTo(5 + wave, -sp.height - bounce - 3 - armAng * 3);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  _placeCoins() {
    const coins = [];
    // Lay coin pickups along the centerline
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const count = Math.max(2, Math.floor(s.len / 180));
      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const cx = s.a.x + s.dx * t;
        const cy = s.a.y + s.dy * t;
        // Side offset (left/right alternating slightly)
        const side = ((i + k) % 3) - 1; // -1, 0, 1
        const off = side * (s.halfW * 0.45);
        coins.push({
          x: cx + s.nx * off,
          y: cy + s.ny * off,
          collected: false,
          spin: Math.random() * TAU,
          respawn: 0,
        });
      }
    }
    return coins;
  }

  _placeBoostPads(segIdxs) {
    const pads = [];
    if (this.isOpen && segIdxs.length === 0) {
      for (let i = 4; i < this.segments.length; i += 12) {
        const s = this.segments[i];
        if (!s) continue;
        const t = 0.55;
        pads.push({
          x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
          ang: Math.atan2(s.dy, s.dx),
          w: 70, h: 36, cooldown: new Map(),
        });
      }
      return pads;
    }
    for (const i of segIdxs) {
      if (i >= this.segments.length) continue;
      const s = this.segments[i];
      const t = 0.55;
      pads.push({
        x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
        ang: Math.atan2(s.dy, s.dx),
        w: 70, h: 36, cooldown: new Map(),
      });
    }
    return pads;
  }

  _placeItemBoxes(segIdxs) {
    const boxes = [];
    if (this.isOpen && segIdxs.length === 0) {
      for (let i = 2; i < this.segments.length; i += 16) {
        const s = this.segments[i];
        if (!s) continue;
        const t = 0.5;
        boxes.push({
          x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
          active: true, respawn: 0, spin: Math.random() * TAU,
        });
      }
      return boxes;
    }
    for (const i of segIdxs) {
      if (i >= this.segments.length) continue;
      const s = this.segments[i];
      const t = 0.5;
      boxes.push({
        x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
        active: true, respawn: 0, spin: Math.random() * TAU,
      });
    }
    return boxes;
  }

  _placeMovingObjects(configs) {
    return configs
      .filter(cfg => cfg.seg < this.n)
      .map((cfg, idx) => {
        const s = this.segments[cfg.seg];
        const t = cfg.t !== undefined ? cfg.t : 0.5;
        const baseX = s.a.x + s.dx * t;
        const baseY = s.a.y + s.dy * t;
        const obj = {
          seg: cfg.seg,
          baseX,
          baseY,
          nx: s.nx,
          ny: s.ny,
          ang: Math.atan2(s.dy, s.dx),
          amp: cfg.amp || Math.max(55, s.halfW * 0.8),
          speed: cfg.speed || 1,
          phase: cfg.phase || 0,
          r: cfg.r || 24,
          color: cfg.color || "#57f2ff",
          kind: cfg.kind || "blackice",
          label: cfg.label || "FIREWALL",
          hitLabel: cfg.hitLabel || "BLACK ICE!",
          cooldown: new Map(),
          x: baseX,
          y: baseY,
          idx
        };
        this._updateMovingObjectPosition(obj);
        return obj;
      });
  }

  _updateMovingObjectPosition(obj) {
    const sweep = Math.sin(obj.phase) * obj.amp;
    obj.x = obj.baseX + obj.nx * sweep;
    obj.y = obj.baseY + obj.ny * sweep;
  }

  updateMovingObjects(dt) {
    for (const obj of this.movingObjects) {
      obj.phase += obj.speed * 0.035 * dt;
      this._updateMovingObjectPosition(obj);
    }
  }

  _createRegulatoryDragon(config) {
    if (!config) return null;
    return {
      x: config.startX || 120,
      y: config.startY || WORLD_H * 0.72,
      vx: 0,
      vy: 0,
      heading: 0,
      r: 88,
      baseGap: config.baseGap || 720,
      minGap: config.minGap || 260,
      closeSeconds: config.closeSeconds || 90,
      fireEvery: config.fireEvery || 90,
      fireTimer: 90,
      jawPhase: 0,
      wingPhase: 0,
      enraged: false,
      active: true
    };
  }

  isDragonFinalLapEnraged() {
    return getActiveKarts().some(k => k && k.isPlayer && !k.eliminated && k.lap >= TOTAL_LAPS - 1);
  }

  updateRegulatoryDragon(dt) {
    const dragon = this.regulatoryDragon;
    if (!dragon || !game.player || game.state !== STATE.RACING) return;

    const target = getDragonTarget();
    if (!target) return;
    const enraged = this.isDragonFinalLapEnraged();
    dragon.enraged = enraged;
    const fx = Math.cos(target.heading);
    const fy = Math.sin(target.heading);
    const lx = -fy;
    const ly = fx;
    const pressure = clamp(game.raceTime / dragon.closeSeconds, 0, 1);
    const gap = Math.max(155, lerp(dragon.baseGap, dragon.minGap, pressure) - (enraged ? 45 : 0));
    const weave = enraged ? 82 : 55;
    const desiredX = target.x - fx * gap + lx * Math.sin(game.raceTime * (enraged ? 2.0 : 1.4)) * weave;
    const desiredY = target.y - fy * gap + ly * Math.sin(game.raceTime * (enraged ? 1.7 : 1.1)) * weave;
    const chaseBase = Math.max(0.925, 0.965 - pressure * 0.018 - (enraged ? 0.014 : 0));
    const chaseLerp = 1 - Math.pow(chaseBase, dt);

    dragon.vx = (desiredX - dragon.x) * chaseLerp;
    dragon.vy = (desiredY - dragon.y) * chaseLerp;
    dragon.x += dragon.vx;
    dragon.y += dragon.vy;
    dragon.heading = Math.atan2(target.y - dragon.y, target.x - dragon.x);
    dragon.jawPhase += (enraged ? 0.28 : 0.18) * dt;
    dragon.wingPhase += (enraged ? 0.14 : 0.08) * dt;
    dragon.fireTimer -= dt;

    if (dragon.fireTimer <= 0) {
      dragon.fireTimer = Math.max(enraged ? 34 : 42, dragon.fireEvery - pressure * 28 - (enraged ? 22 : 0) + rand(-10, enraged ? 5 : 10));
      this.fireRegulatoryDragonShot(target, enraged);
    }
  }

  fireRegulatoryDragonShot(target, enraged = false) {
    const dragon = this.regulatoryDragon;
    if (!dragon || !target) return;
    const muzzleX = dragon.x + Math.cos(dragon.heading) * 72;
    const muzzleY = dragon.y + Math.sin(dragon.heading) * 72;
    const leadX = target.x + target.vx * 18;
    const leadY = target.y + target.vy * 18;
    const baseAng = Math.atan2(leadY - muzzleY, leadX - muzzleX);
    const spread = enraged ? 0.16 : 0.08;
    game.hazards.push(new RegulatoryProjectile(muzzleX, muzzleY, baseAng + rand(-spread, spread), enraged ? 9.4 : 8.4, enraged));
    if (enraged && Math.random() < 0.45) {
      const side = Math.random() < 0.5 ? -1 : 1;
      game.hazards.push(new RegulatoryProjectile(muzzleX, muzzleY, baseAng + side * rand(0.18, 0.28), 8.6, true));
    }
    Sound.spatialTone(muzzleX, muzzleY, enraged ? 82 : 120, 0.22, "sawtooth", enraged ? 0.17 : 0.13, 36);
    Sound.spatialNoise(muzzleX, muzzleY, 0.18, enraged ? 0.14 : 0.10, 260);
    if (game.particles) {
      game.particles.burst(muzzleX, muzzleY, enraged ? "#ff7a18" : "#ff3366", enraged ? 24 : 16, { type: "spark", spdMin: 2, spdMax: enraged ? 7 : 5.5 });
    }
  }

  drawRegulatoryDragon(ctx, time) {
    const dragon = this.regulatoryDragon;
    if (!dragon || !dragon.active) return;
    const enraged = !!dragon.enraged;
    const wing = Math.sin(dragon.wingPhase) * (enraged ? 0.62 : 0.45);
    const jaw = (enraged ? 1.0 : 0.86) + (enraged ? 0.46 : 0.34) * Math.sin(dragon.jawPhase);
    const scale = enraged ? 1.12 : 1.0;
    const glowColor = enraged ? "#ff7a18" : "#ff3366";

    ctx.save();
    ctx.translate(dragon.x, dragon.y);
    ctx.rotate(dragon.heading);
    ctx.scale(scale, scale);
    ctx.shadowBlur = enraged ? 42 : 26;
    ctx.shadowColor = glowColor;

    if (enraged) {
      ctx.strokeStyle = "rgba(255, 122, 24, 0.45)";
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 12]);
      ctx.lineDashOffset = -time * 0.08;
      ctx.beginPath();
      ctx.arc(-18, 0, 150 + Math.sin(time * 0.01) * 12, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Wings / regulatory stamp fins
    ctx.fillStyle = enraged ? "rgba(255, 122, 24, 0.34)" : "rgba(255, 51, 102, 0.28)";
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 4;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(1, side);
      ctx.rotate(wing * side);
      ctx.beginPath();
      ctx.moveTo(-22, 16);
      ctx.lineTo(-168, 96);
      ctx.lineTo(-92, 18);
      ctx.lineTo(-172, -74);
      ctx.lineTo(-22, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Body
    const bodyGrad = ctx.createLinearGradient(-80, 0, 80, 0);
    bodyGrad.addColorStop(0, enraged ? "rgba(62, 4, 0, 0.98)" : "rgba(24, 0, 20, 0.98)");
    bodyGrad.addColorStop(0.45, enraged ? "rgba(255, 82, 18, 0.95)" : "rgba(180, 0, 72, 0.92)");
    bodyGrad.addColorStop(1, "rgba(10, 4, 28, 0.98)");
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(-18, 0, 118, 58, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Back spines
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ff3366";
    for (let i = 0; i < 7; i++) {
      const sx = -92 + i * 28;
      ctx.beginPath();
      ctx.moveTo(sx, -50);
      ctx.lineTo(sx + 12, -86 - (i % 2) * 14);
      ctx.lineTo(sx + 26, -48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Head and jaws
    ctx.fillStyle = glowColor;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(64, -48);
    ctx.lineTo(168, -28 * jaw);
    ctx.lineTo(104, 0);
    ctx.lineTo(168, 28 * jaw);
    ctx.lineTo(64, 48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Teeth
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 5; i++) {
      const tx = 105 + i * 11;
      ctx.beginPath();
      ctx.moveTo(tx, -18);
      ctx.lineTo(tx + 5, -2);
      ctx.lineTo(tx + 10, -18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx, 18);
      ctx.lineTo(tx + 5, 2);
      ctx.lineTo(tx + 10, 18);
      ctx.fill();
    }

    // Eye and compliance stamp
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fffb8f";
    ctx.beginPath();
    ctx.arc(84, -19, 7, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(84, 19, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#0d0b21";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("REG", -18, 0);
    if (enraged) {
      ctx.fillStyle = "#fff4b0";
      ctx.font = "bold 7px monospace";
      ctx.fillText("FINAL NOTICE", -18, 18);
    }

    // Heat shimmer rings behind dragon
    ctx.strokeStyle = enraged
      ? `rgba(255, 122, 24, ${0.5 + 0.25 * Math.sin(time * 0.012)})`
      : `rgba(255, 51, 102, ${0.35 + 0.2 * Math.sin(time * 0.008)})`;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(-92, 0, 42, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- Drawing ----
  drawPath(ctx) {
    if (this.n === 0) return;
    ctx.beginPath();
    ctx.moveTo(this.waypoints[0].x, this.waypoints[0].y);
    for (let i = 1; i < this.n; i++) ctx.lineTo(this.waypoints[i].x, this.waypoints[i].y);
    if (!this.isOpen) ctx.closePath();
  }

  draw(ctx, time) {
    if (this.arenaFloor) {
      this._drawArenaFloor(ctx, time);
      this._drawArenaLane(ctx, time);
      this.drawRamps(ctx, time);
      if (!this.isOpen && !isBattleMode()) this._drawStartLine(ctx);
      return;
    }

    // Grass background tile
    this._drawGrass(ctx);

    const mapId = MAPS[game.selectedMapIdx || 0].id;
    const day = isDayMode();
    const dayPal = day ? getMapDayPalette(mapId) : null;

    // Road Outer Shadow
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = dayPal ? dayPal.roadOuterShadow : "rgba(123, 117, 255, 0.15)";
    ctx.lineWidth = (this.halfWidth + 18) * 2;
    ctx.shadowColor = dayPal ? COMPASS_VISUAL.primary : "#7b75ff";
    ctx.shadowBlur = dayPal ? dayPal.roadShadowBlur : 10;
    this.drawPath(ctx); ctx.stroke();
    ctx.shadowBlur = 0;

    // Rumble strip — alternating neon Pink (#ff4d6d) and Mint Green (#a4ff80)
    ctx.strokeStyle = dayPal ? dayPal.roadRumbleA : "#ff4d6d";
    ctx.lineWidth = (this.halfWidth + 5) * 2;
    ctx.setLineDash([30, 30]);
    ctx.lineDashOffset = -((time * 0.04) % 60);
    this.drawPath(ctx); ctx.stroke();

    ctx.strokeStyle = dayPal ? dayPal.roadRumbleB : "#a4ff80";
    ctx.lineDashOffset = -((time * 0.04) % 60) + 30;
    this.drawPath(ctx); ctx.stroke();
    ctx.setLineDash([]);

    // Asphalt (Deep indigo mainframe circuit)
    ctx.strokeStyle = dayPal ? dayPal.roadAsphalt : "#0d0b21";
    ctx.lineWidth = this.halfWidth * 2;
    this.drawPath(ctx); ctx.stroke();

    // Re-stroke narrow segments with darker fill to indicate width change
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (s && s.halfW < this.halfWidth * 0.95) {
        ctx.strokeStyle = dayPal ? dayPal.roadAsphalt : "#0d0b21";
        ctx.lineWidth = s.halfW * 2;
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();

        // Wall edges where it's narrow - neon cyan boundary lines
        ctx.strokeStyle = dayPal ? dayPal.roadNarrowBoundary : "#00e5ff";
        ctx.lineWidth = (s.halfW + 2) * 2;
        ctx.globalCompositeOperation = "destination-over";
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // Glowing cyan edges for the main highway
    ctx.strokeStyle = dayPal ? dayPal.roadEdgeGlow : "#7b75ff";
    ctx.lineWidth = (this.halfWidth + 1) * 2;
    ctx.globalCompositeOperation = "destination-over";
    this.drawPath(ctx); ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Scrolling flowing lane speed-arrows on road surface
    ctx.strokeStyle = dayPal ? dayPal.roadFlowMarks : "rgba(0, 229, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 48]);
    ctx.lineDashOffset = -((time * 0.08) % 60);
    this.drawPath(ctx); ctx.stroke();
    ctx.setLineDash([]);

    // Center dashed line (neon purple)
    ctx.strokeStyle = dayPal ? dayPal.roadCenterLine : "rgba(123, 117, 255, 0.5)";
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 32]);
    this.drawPath(ctx); ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish line (checkered) — hidden in Battle (no laps/goal in the arena)
    if (!this.isOpen && !isBattleMode()) this._drawStartLine(ctx);

    // Trees / decorations (Holographic pillars)
    this._drawDecor(ctx);
  }

  drawMovingObjects(ctx, time) {
    for (const obj of this.movingObjects) {
      const pulse = 0.75 + 0.25 * Math.sin(time * 0.012 + obj.idx);
      const kind = obj.kind || "blackice";
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.ang);
      ctx.shadowBlur = 20 * pulse;
      ctx.shadowColor = obj.color;

      if (kind === "amend") {
        ctx.fillStyle = hexToRgba(obj.color, 0.20);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -42, -14, 84, 28, 12);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -time * 0.04;
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(30, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hexToRgba(obj.color, 0.55);
        ctx.beginPath();
        ctx.moveTo(26, -10);
        ctx.lineTo(42, 0);
        ctx.lineTo(26, 10);
        ctx.closePath();
        ctx.fill();
      } else if (kind === "clause") {
        ctx.fillStyle = hexToRgba(obj.color, 0.16);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -32, -26, 64, 52, 7);
        ctx.fill();
        ctx.stroke();
        const scanY = -18 + ((time * 0.05 + obj.idx * 9) % 36);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-24, scanY);
        ctx.lineTo(24, scanY);
        ctx.stroke();
        ctx.strokeStyle = hexToRgba(obj.color, 0.65);
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, TAU);
        ctx.stroke();
      } else if (kind === "redline") {
        ctx.fillStyle = hexToRgba(obj.color, 0.18);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 3;
        ctx.rotate(Math.sin(time * 0.004 + obj.idx) * 0.2);
        roundRect(ctx, -50, -9, 100, 18, 4);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(-44, 0);
        ctx.lineTo(44, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (kind === "signoff") {
        ctx.fillStyle = hexToRgba(obj.color, 0.24);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -36, -22, 72, 44, 10);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-17, 1);
        ctx.lineTo(-5, 13);
        ctx.lineTo(19, -13);
        ctx.stroke();
      } else {
        // Sweeping firewall gate body
        ctx.fillStyle = hexToRgba(obj.color, 0.22);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -34, -18, 68, 36, 8);
        ctx.fill();
        ctx.stroke();

        // Rotating access-lock core
        ctx.rotate(-obj.phase * 1.8);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(12, 0);
        ctx.moveTo(0, -12);
        ctx.lineTo(0, 12);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, TAU);
        ctx.stroke();

        ctx.rotate(obj.phase * 1.8);
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(obj.label || "ICE", 0, 0);
      ctx.restore();
    }
  }

  _drawArenaFloor(ctx, time) {
    const floor = this.arenaFloor;
    if (!floor) return;
    const day = isDayMode();
    const cx = floor.cx;
    const cy = floor.cy;
    const rx = floor.rx;
    const ry = floor.ry;
    const todKey = day ? "day" : "night";

    const skyGrad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    if (day) {
      skyGrad.addColorStop(0, COMPASS_VISUAL.skyDayTop);
      skyGrad.addColorStop(0.45, COMPASS_VISUAL.skyDayMid);
      skyGrad.addColorStop(1, COMPASS_VISUAL.skyDayBot);
    } else {
      skyGrad.addColorStop(0, COMPASS_VISUAL.skyNightTop);
      skyGrad.addColorStop(1, COMPASS_VISUAL.skyNightBot);
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-500, -500, WORLD_W + 1000, WORLD_H + 1000);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const floorGrad = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
    if (day) {
      floorGrad.addColorStop(0, COMPASS_VISUAL.floorDayInner);
      floorGrad.addColorStop(0.5, COMPASS_VISUAL.floorDayMid);
      floorGrad.addColorStop(1, COMPASS_VISUAL.floorDayOuter);
    } else {
      floorGrad.addColorStop(0, COMPASS_VISUAL.floorNightInner);
      floorGrad.addColorStop(0.55, COMPASS_VISUAL.floorNightMid);
      floorGrad.addColorStop(1, COMPASS_VISUAL.floorNightOuter);
    }
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();

    const gridPattern = getCompassFloorPattern(ctx, `${todKey}:arena`);
    if (gridPattern) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = gridPattern;
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
      ctx.restore();
    }
    ctx.restore();

    if (this.reviewPlatformRadius > 0) {
      ctx.save();
      ctx.translate(cx, cy);
      const pr = this.reviewPlatformRadius;
      ctx.fillStyle = day ? hexToRgba(COMPASS_VISUAL.mint, 0.55) : hexToRgba(COMPASS_VISUAL.primary, 0.14);
      ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.success, 0.75) : hexToRgba(COMPASS_VISUAL.primaryDark, 0.45);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([18, 14]);
      ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.accent, 0.55) : hexToRgba(COMPASS_VISUAL.accent, 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, pr * 0.72, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = day ? hexToRgba(COMPASS_VISUAL.baseMid, 0.65) : hexToRgba(COMPASS_VISUAL.baseDark, 0.82);
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("REVIEW PLATFORM", 0, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.accent, 0.45) : hexToRgba(COMPASS_VISUAL.accent, 0.3);
    ctx.lineWidth = 8;
    ctx.setLineDash([28, 24]);
    ctx.lineDashOffset = -((time * 0.05) % 52);
    ctx.beginPath();
    ctx.arc(0, 0, rx - 8, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.primary, 0.9) : hexToRgba(COMPASS_VISUAL.primaryDark, 0.65);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.success, 0.35) : hexToRgba(COMPASS_VISUAL.mint, 0.12);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.55, 0, TAU);
    ctx.stroke();
    ctx.restore();

    this._drawArenaBoundaryLandmarks(ctx, day);
  }

  _drawArenaBoundaryLandmarks(ctx, day) {
    const landmarks = this.arenaBoundaryLandmarks;
    if (!landmarks?.length) return;
    for (const lm of landmarks) {
      ctx.save();
      ctx.translate(lm.x, lm.y);
      ctx.rotate(lm.ang);
      const pw = 72;
      const ph = 34;
      ctx.fillStyle = day ? hexToRgba(COMPASS_VISUAL.baseMid, 0.88) : hexToRgba(COMPASS_VISUAL.baseDark, 0.92);
      ctx.strokeStyle = hexToRgba(COMPASS_VISUAL.primary, day ? 0.55 : 0.4);
      ctx.lineWidth = 1.5;
      roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hexToRgba(COMPASS_VISUAL.info, 0.12);
      roundRect(ctx, -pw / 2 + 2, -ph / 2 + 2, pw - 4, 6, 3);
      ctx.fill();
      ctx.fillStyle = lm.label === "APPROVED" ? COMPASS_VISUAL.success : COMPASS_VISUAL.accent;
      ctx.fillRect(-pw / 2 + 4, -ph / 2 + 4, 10, 3);
      ctx.fillStyle = day ? COMPASS_VISUAL.content : COMPASS_VISUAL.info;
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lm.label, 0, 2);
      ctx.restore();
    }
  }

  _drawArenaLane(ctx, time) {
    if (this.n < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const day = isDayMode();
    const roadPattern = getCompassFloorPattern(ctx, `${day ? "day" : "night"}:road`);

    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.primary, 0.22) : hexToRgba(COMPASS_VISUAL.primary, 0.14);
    ctx.lineWidth = (this.halfWidth + 16) * 2;
    ctx.shadowColor = COMPASS_VISUAL.primary;
    ctx.shadowBlur = day ? 6 : 10;
    this.drawPath(ctx);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = roadPattern || (day ? COMPASS_VISUAL.baseMid : COMPASS_VISUAL.baseDark);
    ctx.lineWidth = this.halfWidth * 2;
    this.drawPath(ctx);
    ctx.stroke();

    // Sparse orange wayfinding ticks and purple center dashes mirror App Compass badges.
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.accent, 0.56) : hexToRgba(COMPASS_VISUAL.accent, 0.28);
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 48]);
    ctx.lineDashOffset = -((time * 0.08) % 60);
    this.drawPath(ctx);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.primary, 0.75) : hexToRgba(COMPASS_VISUAL.primaryDark, 0.55);
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 32]);
    this.drawPath(ctx);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawRamps(ctx, time) {
    if (!this.ramps?.length) return;
    const day = isDayMode();
    for (const ramp of this.ramps) {
      ctx.save();
      ctx.translate(ramp.x, ramp.y);
      ctx.rotate(ramp.ang);
      if (ramp.kind === "bump") {
        const hw = ramp.w * 0.5;
        const hh = ramp.h * 0.5;
        ctx.fillStyle = "rgba(19,16,25,0.28)";
        roundRect(ctx, -hw + 2, -hh + 3, ramp.w, ramp.h, hh);
        ctx.fill();
        ctx.fillStyle = day ? "#e78b24" : "#754b20";
        ctx.strokeStyle = day ? COMPASS_VISUAL.accent : COMPASS_VISUAL.accentSoft;
        ctx.lineWidth = 1.5;
        roundRect(ctx, -ramp.w * 0.5, -ramp.h * 0.5, ramp.w, ramp.h, 4);
        ctx.fill();
        ctx.stroke();
        // Contour bands make the low rounded hump legible from overhead.
        for (let i = -1; i <= 1; i++) {
          const x = i * ramp.w * 0.22;
          const bandH = hh * (0.5 + (1 - Math.abs(i)) * 0.32);
          ctx.strokeStyle = i === 0 ? "rgba(255,255,255,0.72)" : "rgba(19,16,25,0.28)";
          ctx.lineWidth = i === 0 ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(x, -bandH); ctx.lineTo(x, bandH); ctx.stroke();
        }
      } else {
        const hw = ramp.w * 0.5;
        const hh = ramp.h * 0.5;
        const lipHalf = hh * 0.72;
        ctx.fillStyle = "rgba(19,16,25,0.32)";
        ctx.beginPath();
        ctx.moveTo(-hw + 3, -hh + 4);
        ctx.lineTo(-hw + 3, hh + 4);
        ctx.lineTo(hw + 3, lipHalf + 4);
        ctx.lineTo(hw + 3, -lipHalf + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = day ? "#332d50" : "#211c35";
        ctx.strokeStyle = day ? COMPASS_VISUAL.primary : COMPASS_VISUAL.primaryDark;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh);
        ctx.lineTo(-hw, hh);
        ctx.lineTo(hw, lipHalf);
        ctx.lineTo(hw, -lipHalf);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Rising contour bands communicate the real 3D slope without adding animation cost.
        for (let i = 1; i <= 3; i++) {
          const t = i / 4;
          const x = lerp(-hw, hw, t);
          const halfAtX = lerp(hh, lipHalf, t);
          ctx.strokeStyle = i === 3 ? COMPASS_VISUAL.accentSoft : hexToRgba(COMPASS_VISUAL.info, 0.38 + i * 0.12);
          ctx.lineWidth = i === 3 ? 2.5 : 1.5;
          ctx.beginPath(); ctx.moveTo(x, -halfAtX); ctx.lineTo(x, halfAtX); ctx.stroke();
        }
        ctx.fillStyle = day ? COMPASS_VISUAL.info : hexToRgba(COMPASS_VISUAL.info, 0.72);
        for (let i = 0; i < 3; i++) {
          const cx = -hw * 0.48 + i * hw * 0.42;
          ctx.beginPath();
          ctx.moveTo(cx - 7, -6);
          ctx.lineTo(cx + 3, 0);
          ctx.lineTo(cx - 7, 6);
          ctx.fill();
        }
        ctx.fillStyle = COMPASS_VISUAL.accent;
        ctx.fillRect(hw - 4, -lipHalf, 4, lipHalf * 2);
      }
      ctx.restore();
    }
  }

  _drawGrass(ctx) {
    const mapId = MAPS[game.selectedMapIdx || 0].id;
    const isDragon = mapId === "dragon_escape";
    const day = isDayMode();
    const dayPal = day ? getMapDayPalette(mapId) : null;

    // Approx visible world X range from context transform (for huge world culling)
    let minX = -500, maxX = WORLD_W + 500;
    const huge = WORLD_W > 10000;
    if (huge) {
      try {
        const m = ctx.getTransform();
        const invScale = 1 / Math.max(0.001, Math.abs(m.a || 1));
        const viewW = ctx.canvas ? ctx.canvas.width : 1280;
        minX = (-m.e * invScale) - 200;
        maxX = minX + viewW * invScale + 500;
      } catch (e) {}
      minX = Math.max(-500, minX);
      maxX = Math.min(WORLD_W + 500, maxX);
    }

    if (isDragon) {
      if (day && dayPal) {
        // Morning-mist green highlands (day)
        const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
        grad.addColorStop(0, dayPal.skyTop);
        grad.addColorStop(0.45, dayPal.skyMid);
        grad.addColorStop(1, dayPal.skyBot);
        ctx.fillStyle = grad;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);

        const layers = dayPal.mountainLayers || [];
        for (let m = 0; m < layers.length; m++) {
          const mh = 140 + m * 45;
          const my = WORLD_H * 0.18 + m * 110;
          ctx.fillStyle = layers[m];
          ctx.beginPath();
          ctx.moveTo(minX, my + mh);
          for (let x = minX; x <= maxX + 60; x += 60) {
            ctx.lineTo(x, my + mh - Math.sin((x + m * 200) * 0.003) * mh * 0.38 - Math.abs(Math.sin((x + m * 300) * 0.001)) * mh * 0.28);
          }
          ctx.lineTo(maxX + 500, WORLD_H + 500);
          ctx.lineTo(minX, WORLD_H + 500);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = dayPal.bambooStroke || "rgba(60, 120, 70, 0.28)";
        ctx.lineWidth = 1.5;
        const grassStart = Math.max(0, Math.floor(minX / 40) * 40);
        const grassEnd   = Math.min(WORLD_W, Math.ceil(maxX / 40) * 40);
        for (let i = grassStart; i < grassEnd; i += 40) {
          const h = 22 + Math.sin(i * 0.05) * 14;
          const sway = Math.sin(i * 0.02 + performance.now() * 0.0005) * 4;
          ctx.beginPath();
          ctx.moveTo(i, WORLD_H * 0.45);
          ctx.quadraticCurveTo(i + sway, WORLD_H * 0.45 - h * 0.5, i + sway * 0.3, WORLD_H * 0.45 - h);
          ctx.stroke();
        }

        const centerX = WORLD_W / 2;
        const centerY = WORLD_H / 2;
        const glowR = Math.min(WORLD_W * 0.7, 3000);
        const glow = ctx.createRadialGradient(centerX, centerY, 100, centerX, centerY, glowR);
        glow.addColorStop(0, dayPal.glowInner || "rgba(200, 240, 210, 0.06)");
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);
      } else {
        // Japanese highland dusk scene (night — unchanged)
        const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
        grad.addColorStop(0, "#1a0c0c");
        grad.addColorStop(0.4, "#2d1810");
        grad.addColorStop(1, "#0d1a10");
        ctx.fillStyle = grad;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);

        // Far misty mountains (multiple layers) — capped to visible range
        for (let m = 0; m < 4; m++) {
          const mh = 150 + m * 50;
          const my = WORLD_H * 0.2 + m * 120;
          const alpha = 0.06 - m * 0.01;
          ctx.fillStyle = `rgba(${60 + m * 20}, ${30 + m * 10}, ${20 + m * 5}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(minX, my + mh);
          for (let x = minX; x <= maxX + 60; x += 60) {
            ctx.lineTo(x, my + mh - Math.sin((x + m * 200) * 0.003) * mh * 0.4 - Math.abs(Math.sin((x + m * 300) * 0.001)) * mh * 0.3);
          }
          ctx.lineTo(maxX + 500, WORLD_H + 500);
          ctx.lineTo(minX, WORLD_H + 500);
          ctx.closePath();
          ctx.fill();
        }

        // Bamboo / grass swaying on edges — capped
        ctx.strokeStyle = "rgba(20, 50, 20, 0.2)";
        ctx.lineWidth = 1.5;
        const grassStart = Math.max(0, Math.floor(minX / 40) * 40);
        const grassEnd   = Math.min(WORLD_W, Math.ceil(maxX / 40) * 40);
        for (let i = grassStart; i < grassEnd; i += 40) {
          const h = 20 + Math.sin(i * 0.05) * 15;
          const sway = Math.sin(i * 0.02 + performance.now() * 0.0005) * 5;
          ctx.beginPath();
          ctx.moveTo(i, WORLD_H * 0.45);
          ctx.quadraticCurveTo(i + sway, WORLD_H * 0.45 - h * 0.5, i + sway * 0.3, WORLD_H * 0.45 - h);
          ctx.stroke();
        }

        // Subtle radial glow centered on track
        const centerX = WORLD_W / 2;
        const centerY = WORLD_H / 2;
        const glowR = Math.min(WORLD_W * 0.7, 3000);
        const glow = ctx.createRadialGradient(centerX, centerY, 100, centerX, centerY, glowR);
        glow.addColorStop(0, "rgba(255, 80, 20, 0.04)");
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);
      }
    } else {
      const todKey = day ? "day" : "night";
      const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
      if (day && dayPal) {
        grad.addColorStop(0, dayPal.skyTop);
        grad.addColorStop(0.5, dayPal.skyMid);
        grad.addColorStop(1, dayPal.skyBot);
      } else {
        grad.addColorStop(0, COMPASS_VISUAL.skyNightTop);
        grad.addColorStop(1, COMPASS_VISUAL.skyNightBot);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(-500, -500, WORLD_W + 1000, WORLD_H + 1000);

      const grassKey = day ? `${todKey}:grass:${mapId}` : `${todKey}:grass`;
      const grassPattern = getCompassFloorPattern(ctx, grassKey);
      if (grassPattern) {
        ctx.fillStyle = grassPattern;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);
      }
    }
  }

  _drawDecor(ctx) {
    const time = performance.now();
    const day = isDayMode();
    for (const p of this.decorations) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 0.003 + p.pulseOffset);
      const h = p.h * pulse;

      ctx.save();
      ctx.translate(p.x, p.y);

      if (p.isJapanese) {
        if (p.type === "lantern") {
          // Japanese paper lantern
          ctx.shadowBlur = 18 * pulse;
          ctx.shadowColor = p.color;
          ctx.fillStyle = hexToRgba(p.color, 0.35);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          // Rounded lantern body
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.5, p.r, h * 0.45, 0, 0, TAU);
          ctx.fill();
          ctx.stroke();
          // Top/bottom rings
          ctx.fillStyle = "#2a0a0a";
          ctx.fillRect(-p.r * 1.1, -h * 0.05, p.r * 2.2, 4);
          ctx.fillRect(-p.r * 1.1, -h * 0.95, p.r * 2.2, 4);
          // Glowing center
          ctx.shadowBlur = 0;
          ctx.fillStyle = hexToRgba("#ffeebb", 0.6);
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.5, p.r * 0.5, h * 0.2, 0, 0, TAU);
          ctx.fill();
        } else if (p.type === "torii") {
          // Mini torii gate
          const tw = p.r * 2.5;
          const th = h * 0.8;
          ctx.shadowBlur = 12 * pulse;
          ctx.shadowColor = "#c0392b";
          ctx.strokeStyle = "#c0392b";
          ctx.fillStyle = "#c0392b";
          ctx.lineWidth = 3;
          // Two vertical pillars
          ctx.fillRect(-tw * 0.35, -th, 5, th);
          ctx.fillRect(tw * 0.35 - 5, -th, 5, th);
          // Top crossbar (kasagi)
          ctx.fillStyle = "#a93226";
          ctx.fillRect(-tw * 0.55, -th - 4, tw * 1.1, 7);
          // Lower lintel (shimaki)
          ctx.fillStyle = "#c0392b";
          ctx.fillRect(-tw * 0.45, -th * 0.75, tw * 0.9, 4);
        } else {
          // Sakura cherry blossom tree
          ctx.shadowBlur = 0;
          // Trunk
          ctx.strokeStyle = "#5c3a21";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(p.r * 0.3, -h * 0.3, 0, -h * 0.6);
          ctx.stroke();
          // Branches
          ctx.strokeStyle = "#5c3a21";
          ctx.lineWidth = 1.5;
          for (let b = 0; b < 5; b++) {
            const ba = (b / 5) * Math.PI - Math.PI * 0.2;
            ctx.beginPath();
            ctx.moveTo(0, -h * 0.55);
            ctx.lineTo(Math.cos(ba) * p.r, -h * 0.55 + Math.sin(ba) * p.r * 0.5);
            ctx.stroke();
          }
          // Cherry blossom clusters
          ctx.shadowBlur = 8 * pulse;
          ctx.shadowColor = p.color;
          ctx.fillStyle = p.color;
          for (let c = 0; c < 6; c++) {
            const ca = (c / 6) * TAU + p.pulseOffset;
            const cr = p.r * 0.6;
            ctx.beginPath();
            ctx.arc(Math.cos(ca) * cr, -h * 0.55 + Math.sin(ca) * cr * 0.3, 3 + pulse * 2, 0, TAU);
            ctx.fill();
          }
        }
      } else {
        // Default cyberpunk pillar
        ctx.shadowBlur = day ? 8 * pulse : 15 * pulse;
        ctx.shadowColor = p.color;
        ctx.fillStyle = hexToRgba(p.color, day ? 0.10 : 0.15);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-p.r, 0);
        ctx.lineTo(-p.r, -h);
        ctx.quadraticCurveTo(0, -h - p.r * 0.4, p.r, -h);
        ctx.lineTo(p.r, 0);
        ctx.quadraticCurveTo(0, p.r * 0.4, -p.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = day ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h);
        ctx.stroke();
        ctx.fillStyle = day ? hexToRgba("#ffffff", 0.85) : "#ffffff";
        ctx.shadowBlur = day ? 4 : 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(0, -h, p.r * 0.35, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawStartLine(ctx) {
    const gate = this.startLineGate();
    if (!gate) return;
    const day = isDayMode();
    const px = gate.x;
    const py = gate.y;
    const ang = Math.atan2(gate.uy, gate.ux);
    const halfW = gate.halfW;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);

    // Digital glassmorphic road base band
    ctx.fillStyle = day ? "rgba(123, 117, 255, 0.22)" : "rgba(123, 117, 255, 0.35)";
    ctx.fillRect(-12, -halfW, 24, halfW * 2);

    // White / Cyan cyber checker
    const tiles = 12;
    const tileH = (halfW * 2) / tiles;
    for (let i = 0; i < tiles; i++) {
      ctx.fillStyle = i % 2 === 0 ? (day ? "#2a2840" : "#111") : "#7b75ff";
      ctx.fillRect(-12, -halfW + i * tileH, 12, tileH);
      ctx.fillStyle = i % 2 === 0 ? "#7b75ff" : (day ? "#2a2840" : "#111");
      ctx.fillRect(0, -halfW + i * tileH, 12, tileH);
    }

    // Arch supporting structures on the sides
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(0, side * (halfW + 15));
      ctx.fillStyle = day ? "#2a2548" : "#0d0b21";
      ctx.strokeStyle = "#7b75ff";
      ctx.lineWidth = 3;
      ctx.shadowBlur = day ? 4 : 10;
      ctx.shadowColor = "#7b75ff";
      ctx.fillRect(-8, -8, 16, 16);
      ctx.strokeRect(-8, -8, 16, 16);
      ctx.restore();
    }

    // Glassmorphic Overarching Sign Banner
    ctx.shadowBlur = day ? 6 : 15;
    ctx.shadowColor = "#7b75ff";
    ctx.fillStyle = day ? "rgba(42, 37, 72, 0.72)" : "rgba(6, 5, 20, 0.85)";
    ctx.strokeStyle = "#7b75ff";
    ctx.lineWidth = 2.5;
    ctx.fillRect(-90, -halfW - 32, 180, 24);
    ctx.strokeRect(-90, -halfW - 32, 180, 24);

    // Glowing Tech Text
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("REGULAIDO CORE MAINPORT", 0, -halfW - 20);

    ctx.restore();
  }

  drawItems(ctx, time) {
    // Boost pads
    for (const p of this.boostPads) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      const phase = (time * 0.01) % 1;
      // Base
      ctx.fillStyle = "#ffaa1f";
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      // Chevrons
      ctx.fillStyle = "#fff";
      for (let i = -1; i <= 1; i++) {
        const off = (i * 22 + phase * 22) % 44 - 22;
        ctx.beginPath();
        ctx.moveTo(off - 8, -p.h / 2 + 4);
        ctx.lineTo(off + 6, 0);
        ctx.lineTo(off - 8, p.h / 2 - 4);
        ctx.lineTo(off - 2, 0);
        ctx.closePath();
        ctx.fill();
      }
      // Glow
      ctx.shadowBlur = 14;
      ctx.shadowColor = "#ffd86b";
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    // Coins (Spinning digital data tokens)
    for (const c of this.coins) {
      if (c.collected) continue;
      const sx = Math.sin(c.spin);
      ctx.save();
      ctx.translate(c.x, c.y);

      // Glow
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#fd9927";

      // Outer neon code ring
      ctx.strokeStyle = "#fd9927";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(9 * sx), 9, 0, 0, TAU);
      ctx.stroke();

      // Inner byte symbol
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.scale(sx, 1);
      ctx.fillText("PMC", 0, 0);
      ctx.restore();

      ctx.restore();
    }

    // Item boxes (Floating 3D-like rotating neon hypercubes)
    for (const b of this.itemBoxes) {
      if (!b.active) continue;
      ctx.save();
      ctx.translate(b.x, b.y);

      const rot = b.spin + time * 0.002;
      const pulse = 0.8 + 0.2 * Math.sin(time * 0.008);
      const sz = 15 * pulse;

      // Pulsing Neon glow
      ctx.shadowBlur = 20 * pulse;
      ctx.shadowColor = "#7b75ff";
      ctx.strokeStyle = "#7b75ff";
      ctx.lineWidth = 1.5;

      ctx.save();
      ctx.rotate(rot);
      ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
      ctx.restore();

      ctx.strokeStyle = "#ff4d6d";
      ctx.shadowColor = "#ff4d6d";
      ctx.save();
      ctx.rotate(-rot * 0.7);
      ctx.strokeRect(-sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();

      // Neon question mark in the dead center
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 0);

      ctx.restore();
    }
  }
}

/* ============================================================
   PARTICLES
   ============================================================ */
// Checkpoint 2: bounded 2D FX pools (documented caps)
const PARTICLE_2D_MAX = 360;
const PARTICLE_2D_IMPORTANT_RESERVE = 80;
const SKID_2D_MAX = 400;
const COMPASS_FX_3D_OVERLAY_MAX = 24;
const APPROVAL_TOKEN_FRAMES = 40;

function particleTrimPriority(p) {
  if (p.type === "approvalToken") return 100;
  if (p.type === "text" && p.text && /APPROVAL|STOLEN|\+1|REVOKED/i.test(p.text)) return 85;
  if (p.compassFx) return 70;
  if (p.type === "text") return 55;
  if (p.type === "ring") return 45;
  if (p.type === "line") return 35;
  return 15;
}

function isImportantParticle(p) {
  return particleTrimPriority(p) >= 70;
}

function admitParticle(list, p) {
  const incomingPriority = particleTrimPriority(p);
  if (!isImportantParticle(p)) {
    let genericCount = 0;
    for (let i = 0; i < list.length; i++) {
      if (!isImportantParticle(list[i])) genericCount++;
    }
    if (genericCount >= PARTICLE_2D_MAX - PARTICLE_2D_IMPORTANT_RESERVE || list.length >= PARTICLE_2D_MAX) {
      return false;
    }
    list.push(p);
    return true;
  }

  if (list.length >= PARTICLE_2D_MAX) {
    let evictIndex = -1;
    let evictPriority = incomingPriority;
    for (let i = 0; i < list.length; i++) {
      const priority = particleTrimPriority(list[i]);
      if (priority < evictPriority) {
        evictPriority = priority;
        evictIndex = i;
      }
    }
    if (evictIndex < 0) return false;
    list.splice(evictIndex, 1);
  }
  list.push(p);
  return true;
}

function pushSkidMark(mark) {
  game.skidMarks.push(mark);
  while (game.skidMarks.length > SKID_2D_MAX) game.skidMarks.shift();
}

function drawCompassSealMini(c, x, y, r = 7) {
  c.save();
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.beginPath(); c.arc(x, y + 1, r, 0, TAU); c.fill();
  c.fillStyle = COMPASS_VISUAL.sealFill;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.strokeStyle = COMPASS_VISUAL.sealRing;
  c.lineWidth = 1.6;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  c.fillStyle = COMPASS_VISUAL.sealMark;
  c.font = `bold ${Math.round(r * 1.35)}px sans-serif`;
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText("✓", x, y + 0.5);
  c.restore();
}

function spawnCompassRevokeFx(kart) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(kart);
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - 24 - zOff,
    vx: 0, vy: 0, life: 22, maxLife: 22, size: 6, startSize: 22,
    color: "#ff3366", drag: 1,
  });
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * TAU + rand(-0.15, 0.15);
    const sp = rand(2.2, 4.8);
    game.particles.add({
      type: "rect", compassFx: true,
      x: kart.x + Math.cos(ang) * 4, y: kart.y - 26 - zOff + Math.sin(ang) * 4,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.4,
      life: rand(18, 28), maxLife: 28, size: rand(3, 5),
      angle: ang, spin: rand(-0.25, 0.25), color: "#ff3366", drag: 0.9,
    });
  }
}

function spawnApprovalTransferToken(victim, attacker) {
  if (!game.particles || !victim || !attacker) return;
  const zOff = kartVisualZOffset(victim);
  game.particles.add({
    type: "approvalToken", compassFx: true,
    victimRef: victim, attackerRef: attacker,
    fromX: victim.x, fromY: victim.y - zOff,
    toX: attacker.x, toY: attacker.y - kartVisualZOffset(attacker),
    vx: 0, vy: 0, life: APPROVAL_TOKEN_FRAMES, maxLife: APPROVAL_TOKEN_FRAMES,
    drag: 1,
  });
}

function spawnCompassRamFx(def, att, dirx, diry) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(def);
  game.particles.add({
    type: "ring", compassFx: true, x: def.x, y: def.y - zOff,
    vx: 0, vy: 0, life: 24, maxLife: 24, size: 8, startSize: 26,
    color: COMPASS_VISUAL.primary, drag: 1,
  });
  game.particles.add({
    type: "ring", compassFx: true, x: def.x, y: def.y - zOff,
    vx: 0, vy: 0, life: 18, maxLife: 18, size: 4, startSize: 18,
    color: COMPASS_VISUAL.accent, drag: 1,
  });
  game.particles.burst(def.x, def.y - zOff, COMPASS_VISUAL.mint, 6, {
    type: "spark", spdMin: 2.5, spdMax: 5.5, compassFx: true,
  });
  game.particles.add({
    type: "line", compassFx: true,
    x: def.x + dirx * 8, y: def.y - zOff + diry * 8,
    vx: dirx * 6, vy: diry * 6,
    life: 16, maxLife: 16, size: 3, color: COMPASS_VISUAL.success, drag: 0.94,
  });
}

function spawnRampLaunchFx(kart, ramp) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(kart);
  const cos = Math.cos(ramp.ang), sin = Math.sin(ramp.ang);
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - zOff,
    vx: 0, vy: 0, life: 20, maxLife: 20, size: 6, startSize: 24,
    color: COMPASS_VISUAL.accent, drag: 1,
  });
  for (let i = 0; i < 6; i++) {
    const ang = ramp.ang + rand(-0.35, 0.35);
    const sp = rand(2, 4.5);
    game.particles.add({
      type: "spark", compassFx: true,
      x: kart.x + cos * 6, y: kart.y - zOff + sin * 6,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.2,
      life: rand(14, 24), maxLife: 24, size: rand(2, 4),
      color: pick([COMPASS_VISUAL.accent, COMPASS_VISUAL.accentSoft]), drag: 0.9,
    });
  }
}

function spawnRampLandingFx(kart) {
  if (!game.particles) return;
  const zOff = kartVisualZOffset(kart);
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - zOff,
    vx: 0, vy: 0, life: 22, maxLife: 22, size: 5, startSize: 20,
    color: COMPASS_VISUAL.mint, drag: 1,
  });
  game.particles.add({
    type: "ring", compassFx: true, x: kart.x, y: kart.y - zOff,
    vx: 0, vy: 0, life: 16, maxLife: 16, size: 3, startSize: 14,
    color: COMPASS_VISUAL.primary, drag: 1,
  });
  game.particles.burst(kart.x, kart.y - zOff, COMPASS_VISUAL.success, 5, {
    type: "spark", spdMin: 0.8, spdMax: 2.2, compassFx: true,
  });
}

let _compassFxProjectVec3 = null;
const _compassFxViewportFull = { x: 0, y: 0, width: 0, height: 0 };
const _compassFxViewportLeft = { x: 0, y: 0, width: 0, height: 0 };
const _compassFxViewportRight = { x: 0, y: 0, width: 0, height: 0 };

function compassFxScreenX(v, viewport) {
  return viewport.x + (v.x * 0.5 + 0.5) * viewport.width;
}

function compassFxScreenY(v, viewport) {
  return viewport.y + (-v.y * 0.5 + 0.5) * viewport.height;
}

function drawCompassFx3DOverlayParticle(c, p, time, camera, viewport, v) {
  if (p.type === "approvalToken") {
    const prog = 1 - clamp(p.life / p.maxLife, 0, 1);
    const ease = prog * prog * (3 - 2 * prog);
    let vx = p.fromX, vy = p.fromY, ax = p.toX, ay = p.toY;
    const victim = p.victimRef;
    const attacker = p.attackerRef;
    if (victim && !victim.eliminated) {
      vx = victim.x; vy = victim.y - kartVisualZOffset(victim);
    }
    if (attacker && !attacker.eliminated) {
      ax = attacker.x; ay = attacker.y - kartVisualZOffset(attacker);
    } else if (!attacker) {
      return false;
    }

    v.set(
      lerp(vx, ax, ease),
      18 + lerp(victim?.z || 0, attacker?.z || 0, ease) * 0.5,
      lerp(vy, ay, ease) - 18
    );
    v.project(camera);
    if (v.z > 1) return false;
    const sx = compassFxScreenX(v, viewport);
    const sy = compassFxScreenY(v, viewport);
    const trailLen = 5;
    for (let i = 1; i <= trailLen; i++) {
      const te = ease - i * 0.07;
      if (te < 0) break;
      v.set(
        lerp(vx, ax, te),
        18 + lerp(victim?.z || 0, attacker?.z || 0, te) * 0.5,
        lerp(vy, ay, te) - 18
      );
      v.project(camera);
      if (v.z > 1) continue;
      c.globalAlpha = 0.15 + 0.12 * (trailLen - i);
      c.strokeStyle = i % 2 ? COMPASS_VISUAL.mint : COMPASS_VISUAL.primary;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(compassFxScreenX(v, viewport), compassFxScreenY(v, viewport));
      c.lineTo(sx, sy);
      c.stroke();
    }
    c.globalAlpha = 0.88 + 0.12 * Math.sin(time * 0.02);
    drawCompassSealMini(c, sx, sy, 10.5);
    c.globalAlpha = 0.32 + 0.12 * Math.sin(time * 0.018);
    c.strokeStyle = COMPASS_VISUAL.accent;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(sx, sy, 13 + Math.sin(time * 0.018) * 1.2, 0, TAU);
    c.stroke();
    if (p.life < 8 && attacker && !attacker.eliminated) {
      v.set(attacker.x, 20 + (attacker.z || 0), attacker.y - kartVisualZOffset(attacker) - 16);
      v.project(camera);
      if (v.z <= 1) {
        const pulse = (8 - p.life) / 8;
        c.globalAlpha = pulse * 0.6;
        c.strokeStyle = COMPASS_VISUAL.success;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(compassFxScreenX(v, viewport), compassFxScreenY(v, viewport), 10 + pulse * 8, 0, TAU);
        c.stroke();
      }
    }
    return true;
  }

  v.set(p.x, 14 + (p.zOff || 0), p.y);
  v.project(camera);
  if (v.z > 1) return false;
  const sx = compassFxScreenX(v, viewport);
  const sy = compassFxScreenY(v, viewport);
  const t = clamp(p.life / p.maxLife, 0, 1);
  c.globalAlpha = t;
  if (p.type === "ring") {
    const rad = p.size * (1 - t) + (p.startSize || p.size) * t;
    c.strokeStyle = p.color;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(sx, sy, rad, 0, TAU);
    c.stroke();
  } else if (p.type === "text") {
    c.fillStyle = p.color;
    c.font = `bold ${p.size}px sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(p.text, sx, sy);
  } else if (p.type === "spark") {
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(sx, sy, (p.size || 3) * t, 0, TAU);
    c.fill();
  } else if (p.type === "line") {
    c.strokeStyle = p.color;
    c.lineWidth = p.size || 2;
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(sx - (p.vx || 0) * 2, sy - (p.vy || 0) * 2);
    c.stroke();
  } else if (p.type === "rect") {
    c.fillStyle = p.color;
    c.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
  }
  return true;
}

function drawCompassFx3DOverlay(c, time, camera = THREE_STATE.camera, viewport = null) {
  if (!window.THREE || !camera || !game.particles) return;
  if (!_compassFxProjectVec3) _compassFxProjectVec3 = new THREE.Vector3();
  const vp = viewport || _compassFxViewportFull;
  if (!viewport) {
    vp.x = 0; vp.y = 0; vp.width = VIEW_W; vp.height = VIEW_H;
  }

  c.save();
  c.beginPath();
  c.rect(vp.x, vp.y, vp.width, vp.height);
  c.clip();
  let drawn = 0;
  const list = game.particles.list;

  // Two allocation-free priority passes: Approval transfers can never be hidden by rings.
  for (let i = 0; i < list.length && drawn < COMPASS_FX_3D_OVERLAY_MAX; i++) {
    const p = list[i];
    if (p.type !== "approvalToken") continue;
    c.save();
    if (drawCompassFx3DOverlayParticle(c, p, time, camera, vp, _compassFxProjectVec3)) drawn++;
    c.restore();
  }
  for (let i = 0; i < list.length && drawn < COMPASS_FX_3D_OVERLAY_MAX; i++) {
    const p = list[i];
    if (p.type === "approvalToken" || !p.compassFx) continue;
    c.save();
    if (drawCompassFx3DOverlayParticle(c, p, time, camera, vp, _compassFxProjectVec3)) drawn++;
    c.restore();
  }
  c.restore();
}

class ParticleSystem {
  constructor() { this.list = []; }
  add(p) {
    return admitParticle(this.list, p);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      if (p.type !== "approvalToken") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(p.drag || 0.96, dt);
        p.vy *= Math.pow(p.drag || 0.96, dt);
      }
      if (p.spin) p.angle = (p.angle || 0) + p.spin * dt;
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = t;
      if (p.type === "approvalToken") {
        const prog = 1 - t;
        const ease = prog * prog * (3 - 2 * prog);
        let vx = p.fromX, vy = p.fromY, ax = p.toX, ay = p.toY;
        const victim = p.victimRef;
        const attacker = p.attackerRef;
        if (victim && !victim.eliminated) {
          vx = victim.x; vy = victim.y - kartVisualZOffset(victim);
        }
        if (attacker && !attacker.eliminated) {
          ax = attacker.x; ay = attacker.y - kartVisualZOffset(attacker);
        }
        const cx = lerp(vx, ax, ease);
        const cy = lerp(vy, ay, ease) - 16;
        const trailSteps = 6;
        for (let i = 1; i <= trailSteps; i++) {
          const te = ease - i * 0.06;
          if (te < 0) break;
          const tx = lerp(vx, ax, te);
          const ty = lerp(vy, ay, te) - 16;
          ctx.globalAlpha = 0.12 + 0.1 * (trailSteps - i);
          ctx.strokeStyle = i % 2 ? COMPASS_VISUAL.mint : COMPASS_VISUAL.primary;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.9 + 0.1 * Math.sin(prog * Math.PI);
        drawCompassSealMini(ctx, cx, cy, 7);
        if (p.life < 8 && attacker && !attacker.eliminated) {
          const pulse = (8 - p.life) / 8;
          const ax2 = attacker.x, ay2 = attacker.y - kartVisualZOffset(attacker) - 14;
          ctx.globalAlpha = pulse * 0.65;
          ctx.strokeStyle = COMPASS_VISUAL.success;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ax2, ay2, 8 + pulse * 10, 0, TAU);
          ctx.stroke();
        }
      } else if (p.type === "spark") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, TAU);
        ctx.fill();
      } else if (p.type === "rect") {
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t) + (p.startSize || p.size) * t, 0, TAU);
        ctx.stroke();
      } else if (p.type === "text") {
        ctx.fillStyle = p.color;
        ctx.font = `bold ${p.size}px sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.type === "line") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  burst(x, y, color, count = 12, opts = {}) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * TAU;
      const sp = rand(opts.spdMin || 1.5, opts.spdMax || 4.5);
      const admitted = admitParticle(this.list, {
        type: opts.type || "spark",
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(15, 35), maxLife: 35,
        size: rand(2, 5),
        color, drag: 0.92,
        compassFx: !!opts.compassFx,
      });
      if (!admitted && !opts.compassFx) break;
    }
  }
}

/* ============================================================
   MERGE CONFLICT HAZARD
   ============================================================ */
let _hazardIdCounter = 0;
function nextHazardId() { return ++_hazardIdCounter; }

class MergeConflict {
  constructor(x, y, owner = null) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.r = 15;
    this.spin = Math.random() * Math.PI * 2;
    this.active = true;
    this.ignoreOwnerTimer = 28;
  }

  update(dt) {
    this.spin += 0.08 * dt;
    if (this.ignoreOwnerTimer > 0) this.ignoreOwnerTimer -= dt;
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);

    ctx.fillStyle = "rgba(255, 30, 80, 0.25)";
    ctx.strokeStyle = "#ff4d6d";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "#ff4d6d";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.rect(-14, -14, 28, 28);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Err", 0, 0);

    ctx.restore();
  }
}

class PlaceboPill {
  constructor(x, y, owner = null) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.r = 15;
    this.spin = Math.random() * TAU;
    this.active = true;
  }

  update(dt) {
    this.spin += 0.065 * dt;
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ffcc00";
    ctx.fillStyle = "rgba(255, 204, 0, 0.25)";
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2.5;
    roundRect(ctx, -18, -9, 36, 18, 9);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 8);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Rx", -8, 0);
    ctx.restore();
  }
}

class DoubleBlindCloud {
  constructor(x, y, heading, owner) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.owner = owner;
    this.vx = Math.cos(heading + Math.PI) * 1.2;
    this.vy = Math.sin(heading + Math.PI) * 1.2;
    this.r = 48;
    this.life = 240;
    this.active = true;
    this.phase = Math.random() * TAU;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.phase += 0.06 * dt;
    this.life -= dt;
    this.r = Math.min(76, this.r + 0.05 * dt);
    if (this.life <= 0) this.active = false;
  }

  draw(ctx, time) {
    const a = clamp(this.life / 240, 0, 1);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#bd57ff";
    for (let i = 0; i < 5; i++) {
      const ang = this.phase + i * TAU / 5;
      ctx.fillStyle = `rgba(189, 87, 255, ${0.12 * a})`;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * 18, Math.sin(ang) * 12, this.r * (0.42 + i * 0.035), 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(255,255,255,${0.8 * a})`;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BLIND", 0, 0);
    ctx.restore();
  }
}

/* ============================================================
   REGULATORY DRAGON PROJECTILE HAZARD
   ============================================================ */
class RegulatoryProjectile {
  constructor(x, y, heading, speed = 8.4, enraged = false) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed;
    this.vx = Math.cos(heading) * this.speed;
    this.vy = Math.sin(heading) * this.speed;
    this.r = enraged ? 20 : 17;
    this.spin = Math.random() * TAU;
    this.life = 300;
    this.active = true;
    this.kind = "regulatory_projectile";
    this.enraged = enraged;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += 0.24 * dt;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }

  draw(ctx, time) {
    const pulse = 0.7 + 0.3 * Math.sin(time * 0.018 + this.spin);
    const color = this.enraged ? "#ff7a18" : "#ff3366";
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    ctx.shadowBlur = (this.enraged ? 26 : 18) * pulse;
    ctx.shadowColor = color;
    ctx.fillStyle = this.enraged ? "rgba(255, 122, 24, 0.38)" : "rgba(255, 51, 102, 0.32)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("§", 0, 0);
    ctx.restore();
  }
}

/* ============================================================
   DOSSIER PROJECTILE HAZARD
   ============================================================ */
class DossierProjectile {
  constructor(x, y, heading, owner) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.owner = owner;
    this.speed = 10.0;
    this.vx = Math.cos(heading) * this.speed;
    this.vy = Math.sin(heading) * this.speed;
    this.r = 12;
    this.spin = Math.random() * Math.PI * 2;
    this.active = true;
    this.life = 360;
    this.ignoreOwnerTimer = 20;
  }

  update(dt, track) {
    this.spin += 0.15 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
    }
    if (this.ignoreOwnerTimer > 0) {
      this.ignoreOwnerTimer -= dt;
    }

    // Bounce off track walls!
    if (track) {
      const c = track.closestSegment(this.x, this.y);
      const seg = track.segments[c.idx];
      const wallLimit = seg.halfW + 40;
      if (c.dist > wallLimit) {
        const proj = c.proj;
        const nx = (this.x - proj.x) / Math.max(0.001, c.dist);
        const ny = (this.y - proj.y) / Math.max(0.001, c.dist);
        const push = c.dist - wallLimit;
        this.x -= nx * push;

        // Reflect velocity with elastic bounce off normal
        const dot = this.vx * nx + this.vy * ny;
        if (dot > 0) {
          this.vx -= dot * nx * 2.0;
          this.vy -= dot * ny * 2.0;
          this.heading = Math.atan2(this.vy, this.vx);
        }
      }
    }
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);

    // Folder Tab & Body in Neon Cyan
    ctx.fillStyle = "rgba(87, 242, 255, 0.25)";
    ctx.strokeStyle = "#57f2ff";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "#57f2ff";
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.rect(-12, -9, 24, 18);
    ctx.moveTo(-12, -9);
    ctx.lineTo(-12, -13);
    ctx.lineTo(-4, -13);
    ctx.lineTo(-2, -9);
    ctx.fill();
    ctx.stroke();

    // Document Lines in White/Cyan
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7, -4); ctx.lineTo(7, -4);
    ctx.moveTo(-7, 1);  ctx.lineTo(3, 1);
    ctx.moveTo(-7, 5);  ctx.lineTo(5, 5);
    ctx.stroke();

    ctx.restore();
  }
}

/* ============================================================
   DRAGON FIRE HAZARD
   ============================================================ */
class DragonFire {
  constructor(x, y, heading, speed) {
    this.hid = nextHazardId();
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed || 6.0;
    this.vx = Math.cos(heading) * this.speed;
    this.vy = Math.sin(heading) * this.speed;
    this.r = 18;
    this.active = true;
    this.life = 420;
    this.pulsePhase = Math.random() * Math.PI * 2;
    this.sizePhase = 0;
  }

  update(dt) {
    this.sizePhase += 0.08 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
    }
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);

    const pulse = 0.80 + 0.20 * Math.sin(this.sizePhase * 4 + this.pulsePhase);
    const baseR = this.r * pulse;

    // ---- Directional motion blur trail ----
    const trailLen = this.speed * 3.5;
    const trailGrad = ctx.createLinearGradient(0, 0, -Math.cos(this.heading) * trailLen, -Math.sin(this.heading) * trailLen);
    trailGrad.addColorStop(0, `rgba(255, 200, 40, 0.5)`);
    trailGrad.addColorStop(0.5, `rgba(255, 80, 0, 0.25)`);
    trailGrad.addColorStop(1, `rgba(180, 0, 0, 0)`);
    ctx.fillStyle = trailGrad;
    ctx.beginPath();
    ctx.ellipse(-Math.cos(this.heading) * trailLen * 0.3, -Math.sin(this.heading) * trailLen * 0.3, trailLen * 0.7, baseR * 1.2, this.heading, 0, TAU);
    ctx.fill();

    // ---- Outer fiery aura (2 layers for depth) ----
    const outerGlow = ctx.createRadialGradient(0, 0, baseR * 0.2, 0, 0, baseR * 3.2);
    outerGlow.addColorStop(0, "rgba(255, 220, 80, 0.8)");
    outerGlow.addColorStop(0.25, "rgba(255, 120, 20, 0.55)");
    outerGlow.addColorStop(0.55, "rgba(255, 40, 0, 0.2)");
    outerGlow.addColorStop(1, "rgba(120, 0, 0, 0)");
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 3.2, 0, TAU);
    ctx.fill();

    const innerGlow = ctx.createRadialGradient(0, 0, baseR * 0.15, 0, 0, baseR * 2.0);
    innerGlow.addColorStop(0, "rgba(255, 200, 60, 0.6)");
    innerGlow.addColorStop(0.4, "rgba(255, 90, 15, 0.35)");
    innerGlow.addColorStop(1, "rgba(150, 0, 0, 0)");
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 2.0, 0, TAU);
    ctx.fill();

    // ---- Core ember body ----
    ctx.fillStyle = `rgba(255, ${180 + Math.floor(Math.random() * 75)}, ${40 + Math.floor(Math.random() * 60)}, 0.92)`;
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.65, 0, TAU);
    ctx.fill();

    // ---- White-hot inner core ----
    ctx.fillStyle = "rgba(255, 250, 220, 0.95)";
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.28, 0, TAU);
    ctx.fill();

    // ---- Rotating flame tongues (more organic) ----
    const tongues = 7;
    for (let i = 0; i < tongues; i++) {
      const tAng = (i / tongues) * TAU + this.sizePhase * 3 + this.pulsePhase + Math.sin(i * 0.8) * 0.3;
      const tLen = baseR * (0.9 + 0.7 * Math.sin(this.sizePhase * 4 + i * 1.3));
      const tWidth = 2.5 + Math.sin(this.sizePhase * 6 + i * 2) * 1.2;
      ctx.strokeStyle = `rgba(255, ${140 + i * 15}, ${20 + i * 5}, 0.75)`;
      ctx.lineWidth = tWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(Math.cos(tAng) * baseR * 0.5, Math.sin(tAng) * baseR * 0.5);
      const midX = Math.cos(tAng - 0.1 * Math.sin(this.sizePhase * 2 + i)) * tLen * 0.6;
      const midY = Math.sin(tAng - 0.1 * Math.sin(this.sizePhase * 2 + i)) * tLen * 0.6;
      const endX = Math.cos(tAng + 0.15 * Math.cos(this.sizePhase * 3 + i)) * tLen;
      const endY = Math.sin(tAng + 0.15 * Math.cos(this.sizePhase * 3 + i)) * tLen;
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
    }

    // ---- Small random ember sparks inside ----
    ctx.fillStyle = "rgba(255, 255, 200, 0.7)";
    for (let i = 0; i < 3; i++) {
      const spkAng = (this.sizePhase * 2 + i * 2.1) % TAU;
      const spkDist = baseR * (0.3 + 0.3 * Math.random());
      ctx.beginPath();
      ctx.arc(Math.cos(spkAng) * spkDist, Math.sin(spkAng) * spkDist, 1.5 + Math.random() * 2, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
}

/* ============================================================
   KART BASE — physics shared by player & AI
   ============================================================ */
class Kart {
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
    triggerShootEffect(this, type);

    // If multiplayer, broadcast the action event to peer so they play the spatial audio/particles too!
    if (game.p2pMode) {
      sendP2pMessage({
        type: "action_event",
        kartId: getKartId(this),
        item: type
      });
    }

    if (type === "boost") {
      this.boostTimer = Math.max(this.boostTimer, TUNING.BOOST_DURATION);
      triggerQuote(this, "boost");
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
        sendP2pMessage({
          type: "drop_conflict",
          kartId: getKartId(this),
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
        sendP2pMessage({
          type: "drop_placebo",
          kartId: getKartId(this),
          x: dropX,
          y: dropY
        });
      }
    } else if (type === "doubleblind") {
      if (!isP2pBattleGuest()) game.hazards.push(new DoubleBlindCloud(this.x, this.y, this.heading, this));
      if (game.p2pMode && game.p2pRole === "guest") {
        sendP2pMessage({
          type: "double_blind_cloud",
          kartId: getKartId(this),
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
        sendP2pMessage({
          type: "shoot_dossier",
          kartId: getKartId(this),
          x: spawnX,
          y: spawnY,
          heading: this.heading
        });
      }
    } else if (type === "deauth") {
      if (isP2pBattleGuest()) {
        sendP2pMessage({
          type: "deauth_shockwave",
          kartId: getKartId(this),
          x: this.x,
          y: this.y
        });
      } else {
        applyDeauthShockwave(this);
        if (game.p2pMode && game.p2pRole === "guest") {
          sendP2pMessage({
            type: "deauth_shockwave",
            kartId: getKartId(this),
            x: this.x,
            y: this.y
          });
        }
      }
    } else if (type === "mergerequest") {
      if (isP2pBattleGuest()) {
        sendP2pMessage({ type: "merge_request", kartId: getKartId(this) });
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
        triggerQuote(this, "boost");
      } else {
        startMergeRequestPull(this);
      }
    } else if (type === "hotfix") {
      this.boostTimer = Math.max(this.boostTimer, TUNING.HOTFIX_DURATION);
      this.shieldTimer = Math.max(this.shieldTimer, TUNING.HOTFIX_DURATION);
      this.invuln = Math.max(this.invuln, TUNING.HOTFIX_DURATION);
      this.ultraBoostActive = true;
      triggerQuote(this, "boost");
    } else if (type === "fasttrack") {
      this.boostTimer = Math.max(this.boostTimer, TUNING.FAST_TRACK_DURATION);
      this.shieldTimer = Math.max(this.shieldTimer, TUNING.FAST_TRACK_DURATION);
      this.handlingTimer = Math.max(this.handlingTimer, TUNING.FAST_TRACK_DURATION);
      this.invuln = Math.max(this.invuln, TUNING.FAST_TRACK_DURATION);
      this.ultraBoostActive = true;
      triggerQuote(this, "boost");
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
          const ranking = rankAll();
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
        triggerQuote(this, "boost");

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
          triggerQuote(this, "crash");
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
        let rolled = getWeightedItem(this);
        // Anti-frustration: don't hand the player the exact same item twice in a row.
        if (this.isPlayer && rolled === this.lastItemSlot) {
          const reroll = getWeightedItem(this);
          if (reroll !== this.lastItemSlot) rolled = reroll;
        }
        this.itemSlot = rolled;
        this.lastItemSlot = rolled;
        const RARE_ITEMS = { hotfix: 1, mergerequest: 1, deauth: 1 };
        const isRare = !!RARE_ITEMS[rolled];
        if (this.isPlayer && this.itemSlot) {
          const itemColor = { boost: "#fd9927", shield: "#57f2ff", handling: "#a4ff80", conflict: "#ff4d6d", placebo: "#ffcc00", doubleblind: "#bd57ff", dossier: "#57f2ff", deauth: "#ff3366", mergerequest: "#39ff14", hotfix: "#ffcc00", fasttrack: "#a4ff80" };
          const col = itemColor[this.itemSlot] || "#fff";
          this.itemNamePopup = { name: ITEM_NAMES[this.itemSlot] || this.itemSlot.toUpperCase(), color: col, timer: isRare ? 110 : 75, maxTimer: isRare ? 110 : 75 };
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
}

/* ============================================================
   PLAYER KART
   ============================================================ */
class PlayerKart extends Kart {
  constructor(x, y, heading, char, playerIndex = 1) {
    super(x, y, heading, char, true);
    this.playerIndex = playerIndex;
  }

  update(dt, track) {
    if (this.eliminated) return;
    const keys = this.playerIndex === 2 ? keysP2 : keysP1;
    const p2pLocalPaused = game.p2pMode && game.state === STATE.PAUSED && this.isPlayer && this === game.player;
    const input = p2pLocalPaused ? {
      forward: false,
      back: false,
      left: false,
      right: false,
      drift: false,
    } : {
      forward: !!keys.up,
      back: !!keys.down,
      left: !!keys.left,
      right: !!keys.right,
      drift: !!keys.drift,
    };

    // Use Item Roulette active item on corresponding item press
    const itemPressed = !p2pLocalPaused && (this.playerIndex === 2 ? consumePressedP2("item") : consumePressedP1("item"));
    if (itemPressed && this.itemState === "active" && this.itemSlot) {
      this.useItem();
    }

    // Ultimate ability activation
    const ultPressed = !p2pLocalPaused && (this.playerIndex === 2 ? consumePressedP2("ult") : consumePressedP1("ult"));
    if (ultPressed && this.ultReady) {
      activateUltimate(this);
    }

    // Honk
    const honkPressed = !p2pLocalPaused && (this.playerIndex === 2 ? consumePressedP2("honk") : consumePressedP1("honk"));
    if (honkPressed && (!this.honkCooldown || this.honkCooldown <= 0)) {
      Sound.honk(this.charId);
      this.honkCooldown = 30;
      this.honkFlash = 20;
      game.particles.add({
        type: "text", text: "HONK!",
        x: this.x, y: this.y - 28,
        vx: 0, vy: -0.6, life: 25, maxLife: 25, size: 12, color: this.color, drag: 0.97
      });
    }
    if (this.honkCooldown > 0) this.honkCooldown -= dt;

    if (this.ultActiveTimer > 0) this.ultActiveTimer -= dt;

    const onRoad = track.isOnRoad(this.x, this.y);
    let r;
    if (!isBattleMode()) {
      const allKarts = getActiveKarts();
      let leaderProgress = 0;
      for (const k of allKarts) {
        leaderProgress = Math.max(leaderProgress, progressValue(k));
      }
      const deficit = leaderProgress - progressValue(this);
      let catchupMult = 1.0;
      if (deficit > 0) {
        catchupMult = 1 + Math.min(TUNING.PLAYER_CATCHUP_MAX, (deficit / TUNING.PLAYER_CATCHUP_RANGE) * TUNING.PLAYER_CATCHUP_MAX);
      }
      const origMaxSpeed = this.maxSpeed;
      const origAcceleration = this.acceleration;
      this.maxSpeed *= catchupMult;
      this.acceleration *= catchupMult;
      r = this.applyPhysics(input, track, dt, onRoad);
      this.maxSpeed = origMaxSpeed;
      this.acceleration = origAcceleration;
    } else {
      r = this.applyPhysics(input, track, dt, onRoad);
    }
    this._driftTimer = r.drifting
      ? Math.max(this._driftTimer || 0, 2)
      : Math.max(0, (this._driftTimer || 0) - dt);

    // Off-road effects (digital green dust particles + spatialized static noise)
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

    // Skid marks (with neon styling for Rissal)
    this.skidEmitTimer -= dt;
    if (r.drifting && Math.abs(this.forwardSpeed()) > 1.5 && this.skidEmitTimer <= 0) {
      this.skidEmitTimer = 1.5;
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const lx = -fy, ly = fx;
      for (const side of [-1, 1]) {
        let col = `rgba(20,20,30,0.6)`;
        if (this.charId === "rissal") col = `rgba(104, 255, 157, 0.75)`;
        pushSkidMark({
          x: this.x - fx * 10 + lx * side * 7,
          y: this.y - fy * 10 + ly * side * 7,
          life: 220, maxLife: 220, size: this.charId === "rissal" ? 5 : 4,
          color: col
        });
      }
    }

    // Boost particles & Wind Speed Lines
    if (this.boostTimer > 0) {
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

      // Neon speed streaks trailing
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
    }
  }
}

/* ============================================================
   AI KART
   ============================================================ */
class AIKart extends Kart {
  constructor(x, y, heading, char, skill = 1.0) {
    super(x, y, heading, char, false);
    this.skill = skill;
    this.maxSpeed = this.baseMaxSpeed * (0.91 + skill * 0.1);
    this.acceleration = char.acceleration * (0.92 + skill * 0.08);
    this.turnSpeed = char.turnSpeed * (0.92 + skill * 0.08);
    this.aiTargetIdx = 1;
    this.aiNoise = rand(0, 100);
    this.lateralOffset = rand(-0.45, 0.45); // racing line offset
    this.itemTimer = rand(120, 360);
  }

  update(dt, track, allKarts) {
    if (this.eliminated) return;
    const isOpen = !!track.isOpen;

    // Safeguard: Ensure aiTargetIdx is never behind nextCheckpoint
    if (isOpen) {
      if (this.aiTargetIdx < this.nextCheckpoint) this.aiTargetIdx = this.nextCheckpoint;
      this.aiTargetIdx = Math.min(this.aiTargetIdx, track.n - 1);
    } else {
      const diffCheck = (this.nextCheckpoint - this.aiTargetIdx + track.n) % track.n;
      if (diffCheck !== 0 && diffCheck !== track.n - 1) {
        this.aiTargetIdx = this.nextCheckpoint;
      }
    }

    // Pick target on next waypoint with look-ahead
    const target = track.waypoints[this.aiTargetIdx];
    const nextIdx = isOpen ? Math.min(this.aiTargetIdx + 1, track.n - 1) : (this.aiTargetIdx + 1) % track.n;
    const next = track.waypoints[nextIdx];

    // Lateral offset along the segment normal for varied racing line
    const segIdx = isOpen ? Math.max(0, this.aiTargetIdx - 1) : (this.aiTargetIdx - 1 + track.n) % track.n;
    const seg = track.segments[Math.min(segIdx, track.segments.length - 1)];
    const segHalfW = seg.halfW;
    const lookAheadBlend = clamp(segHalfW / 120, 0.10, 0.35);
    let aimX = lerp(target.x, next.x, lookAheadBlend) + seg.nx * (this.lateralOffset * (segHalfW * 0.45));
    let aimY = lerp(target.y, next.y, lookAheadBlend) + seg.ny * (this.lateralOffset * (segHalfW * 0.45));

    // ---- Simple scripted Battle AI: hunt the nearest surviving rival ----
    // (Placeholder behaviour until the RL agent is trained; battle-mode only.)
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
        // Steer toward the rival, but keep some pull to the ring waypoint so the
        // AI doesn't dive into the arena's empty centre or off the outer edge.
        aimX = lerp(aimX, bt.x, 0.62);
        aimY = lerp(aimY, bt.y, 0.62);
      }
    }

    // Curvature lookahead corners
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
      if (curvature > 0.6) {
        forceEarlyDrift = true;
      }
    }

    // 3-way multi-raycast scanner (Left, Center, Right) for hazards and slower karts
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
        if (score < bestBoostScore) {
          bestBoostScore = score;
          bestBoost = pad;
        }
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
      // In Battle mode the AI should ram rivals, not avoid them.
      ...(isBattleMode() ? [] : getActiveKarts().filter(k => k !== this).map(k => ({ x: k.x, y: k.y, r: getKartCollisionRadius(k), isHazard: false })))
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

            if (localForward < 60 && Math.abs(localLateral) < obs.r) {
              brakeTarget = true;
            }
          }
        }
      }
    }

    const desired = Math.atan2(aimY - this.y, aimX - this.x);
    const diff = angleDiff(this.heading, desired) + steerAdj;

    // Decide drift on sharp turns
    const sharp = Math.abs(diff) > 0.55;
    const onRoad = track.isOnRoad(this.x, this.y);

    const input = {
      forward: !brakeTarget,
      back: false,
      left: diff < -0.04,
      right: diff > 0.04,
      drift: (sharp || forceEarlyDrift) && Math.abs(this.forwardSpeed()) > 2.5,
    };

    // Slight braking when extremely sharp diff
    if (Math.abs(diff) > 1.0 && this.forwardSpeed() > this.maxSpeed * 0.8) {
      input.forward = false;
    }

    // Strategic AI Item Decision engine
    if (this.itemState === "active" && this.itemSlot) {
      let shouldUse = false;
      const rank = rankAll().indexOf(this) + 1;

      if (isBattleMode()) {
        // Aggressive scripted use: attack when a rival is close, boost to chase when far.
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
        if (playerBehind || Math.random() < 0.005 * dt) {
          shouldUse = true;
        }
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
        if (playerAhead || Math.random() < 0.005 * dt) {
          shouldUse = true;
        }
      } else if (this.itemSlot === "placebo" || this.itemSlot === "doubleblind") {
        shouldUse = rank <= 3 || Math.random() < 0.01 * dt;
      } else if (this.itemSlot === "boost" || this.itemSlot === "handling" || this.itemSlot === "fasttrack") {
        if (curvature < 0.25) {
          shouldUse = true;
        }
      } else if (this.itemSlot === "shield") {
        if (rank <= 2 || Math.random() < 0.02 * dt) {
          shouldUse = true;
        }
      } else if (this.itemSlot === "deauth") {
        shouldUse = getActiveKarts().some(k => k !== this && !k.finished && dist(this.x, this.y, k.x, k.y) < 150);
      } else if (this.itemSlot === "mergerequest") {
        shouldUse = rank > 1 && curvature < 0.35;
      } else if (this.itemSlot === "hotfix") {
        shouldUse = true;
      }

      if (shouldUse) {
        this.useItem();
      }
    }

    // AI ultimate usage
    if (this.ultReady && this.ultActiveTimer <= 0) {
      const aiRank = rankAll().indexOf(this) + 1;
      const useChance = aiRank >= 3 ? 0.015 : aiRank >= 2 ? 0.008 : 0.004;
      if (Math.random() < useChance * dt) {
        activateUltimate(this);
      }
    }
    if (this.ultActiveTimer > 0) this.ultActiveTimer -= dt;

    // Dynamic AI Rubberbanding pace adjustments
    let leadHumanProgress = progressValue(game.player);
    if (game.multiplayer && game.player2) {
      leadHumanProgress = Math.max(leadHumanProgress, progressValue(game.player2));
    }
    const myProgress = progressValue(this);
    let diffProgress = leadHumanProgress - myProgress;

    if (isOpen) {
      diffProgress = clamp(diffProgress / 200, -5, 5);
    }

    let rubberbandSpeedMult = 1.0;
    if (diffProgress > 0) {
      rubberbandSpeedMult = 1.0 + Math.min(0.22, diffProgress * 0.07);
    } else if (diffProgress < 0) {
      rubberbandSpeedMult = Math.max(0.82, 1.0 + diffProgress * 0.06);
    }

    const origMaxSpeed = this.maxSpeed;
    const origAcceleration = this.acceleration;
    this.maxSpeed *= rubberbandSpeedMult;
    this.acceleration *= rubberbandSpeedMult;

    const r = this.applyPhysics(input, track, dt, onRoad);

    this.maxSpeed = origMaxSpeed;
    this.acceleration = origAcceleration;
    this._driftTimer = r.drifting
      ? Math.max(this._driftTimer || 0, 2)
      : Math.max(0, (this._driftTimer || 0) - dt);

    // Off-road effects (digital green dust particles + spatialized static noise)
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

    // AI Skid marks (with neon color for Rissal)
    this.skidEmitTimer -= dt;
    if (r.drifting && Math.abs(this.forwardSpeed()) > 1.8 && this.skidEmitTimer <= 0) {
      this.skidEmitTimer = 1.8;
      const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
      const lx = -fy, ly = fx;
      for (const side of [-1, 1]) {
        let col = `rgba(20,20,30,0.5)`;
        if (this.charId === "rissal") col = `rgba(104, 255, 157, 0.7)`;
        pushSkidMark({
          x: this.x - fx * 10 + lx * side * 7,
          y: this.y - fy * 10 + ly * side * 7,
          life: 180, maxLife: 180, size: this.charId === "rissal" ? 5 : 4,
          color: col
        });
      }
    }

    // Boost trails for AI
    if (this.boostTimer > 0 && Math.random() < 0.25 * dt) {
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

    // Advance waypoint when close — adaptive radius based on road width
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

/* ============================================================
   GAME
   ============================================================ */
const STATE = {
  TITLE: "title",
  SELECT: "select",
  COUNTDOWN: "countdown",
  RACING: "racing",
  PAUSED: "paused",
  FINISHED: "finished",
};

const game = {
  state: STATE.TITLE,
  selectedCharIdx: 0,
  selectedMapIdx: 0,
  track: null,
  player: null,
  player2: null,
  remotePlayers: [],
  p2pKartById: {},
  p2pPlayers: [],
  p2pLocalId: null,
  ais: [],
  particles: new ParticleSystem(),
  skidMarks: [],
  startTime: 0,
  raceTime: 0,
  countdownStart: 0,
  countdownText: "",
  rocketStartP1: { holdStart: 0, holding: false, result: null },
  rocketStartP2: { holdStart: 0, holding: false, result: null },
  viewMode: savedSettings.viewMode === "3d" ? "3d" : "2d",
  timeOfDay: normalizeTimeOfDay(savedSettings.timeOfDay),
  shake: 0,
  flash: 0,
  cam: { x: 0, y: 0, scale: 1 },
  coinsCollected: 0,
  hudPosition: 1,
  totalRacers: 4,
  finishOrder: [],
  raceFinishedAt: 0,
  dragonTimer: 0,
  dragonFireTimer: 0,
  dragonWarnTimer: 0,
  dragonEscape: null,
  bestLap: 0,
  newRecord: null,
  mapRecordCache: null,
  mode: "race",
  battleApprovals: 3,
  battleUntimed: !!savedSettings.battleUntimed,
  battleDuration: 120,
  battleTimeLeft: 0,
  spectateTarget: null,
  p2pLastPickupSyncAt: 0,
  p2pLastHostSyncAt: 0,
  p2pLastGuestSyncAt: 0,
  p2pLastHazardSyncAt: 0,
  p2pPing: 0,
  p2pLastPingAt: 0,
  p2pBattleEndPending: false,
  p2pLastHostSyncReceivedAt: 0,
  p2pConnectionUnstable: false,
  _pauseFromState: null,
  tournament: null,
  mapSelection: (() => {
    const idx = MAPS.findIndex((m) => !m.arena && m.id !== "dragon_escape");
    return idx >= 0 ? MAPS[idx].id : MAPS[0].id;
  })(),
};

function triggerHitFlash(text, color, duration = 90, kart = null) {
  const hf = { text, color, timer: duration, maxTimer: duration };
  if (kart) {
    kart.hitFlash = hf;
  } else {
    if (game.player) game.player.hitFlash = hf;
  }
}

function drawHitFlash(ctx, kart, left, top, width, height, time) {
  const hf = kart ? kart.hitFlash : null;
  if (!hf || hf.timer <= 0) return;

  const fadeIn = clamp((hf.maxTimer - hf.timer) / 8, 0, 1);
  const fadeOut = clamp(hf.timer / 20, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  const cx = left + width / 2;
  const cy = top + height * 0.35;

  const vignetteAlpha = alpha * 0.35;
  const vGrad = ctx.createRadialGradient(cx, top + height / 2, Math.min(width, height) * 0.2, cx, top + height / 2, Math.max(width, height) * 0.6);
  vGrad.addColorStop(0, "rgba(0,0,0,0)");
  vGrad.addColorStop(1, hexToRgba(hf.color, vignetteAlpha));
  ctx.fillStyle = vGrad;
  ctx.fillRect(left, top, width, height);

  const scale = 1 + (1 - fadeIn) * 0.8;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  const fontSize = Math.min(52, width * 0.08);
  ctx.shadowBlur = 30;
  ctx.shadowColor = hf.color;
  ctx.fillStyle = hf.color;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(hf.text, 0, 0);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5;
  ctx.strokeText(hf.text, 0, 0);

  ctx.restore();
}

function drawStatusEffects(ctx, x, y, kart, time) {
  if (!kart) return;
  const effects = [];
  if (kart.shieldTimer > 0) effects.push({ label: "SHIELD", color: "#57f2ff", ratio: kart.shieldTimer / (kart.charId === "rissal" ? TUNING.SHIELD_DURATION_RISSAL : TUNING.SHIELD_DURATION) });
  if (kart.boostTimer > 0) effects.push({ label: "BOOST", color: "#fd9927", ratio: kart.boostTimer / TUNING.BOOST_DURATION });
  if (kart.handlingTimer > 0) effects.push({ label: "HANDLING+", color: "#a4ff80", ratio: kart.handlingTimer / TUNING.HANDLING_DURATION });
  if (kart.doubleBlindTimer > 0) effects.push({ label: "BLINDED", color: "#bd57ff", ratio: kart.doubleBlindTimer / TUNING.DOUBLE_BLIND_DURATION });
  if (kart.placeboSlowTimer > 0) effects.push({ label: "SLOWED", color: "#ffcc00", ratio: kart.placeboSlowTimer / TUNING.PLACEBO_SLOW_DURATION });
  if (kart.invuln > 0) effects.push({ label: "INVULN", color: "#ff00ff", ratio: kart.invuln / TUNING.HOTFIX_DURATION });
  if (kart.mergePullTimer > 0) effects.push({ label: "PULLING", color: "#39ff14", ratio: kart.mergePullTimer / 110 });
  if (kart.mergePullVictimTimer > 0) effects.push({ label: "TETHERED!", color: "#39ff14", ratio: kart.mergePullVictimTimer / 110 });
  if (kart.throttleLockTimer > 0) effects.push({ label: "THROTTLE LOCK", color: "#57f2ff", ratio: kart.throttleLockTimer / 45 });
  if (kart.amendmentTimer > 0) effects.push({ label: "AMENDED", color: "#a4ff80", ratio: kart.amendmentTimer / 90 });
  if (kart.spinoutTimer > 0) effects.push({ label: "SPINNING", color: "#ff4d6d", ratio: kart.spinoutTimer / TUNING.SPINOUT_TIME });
  if (kart.ultActiveTimer > 0) effects.push({ label: "ULTIMATE", color: kart.color, ratio: kart.ultActiveTimer / (TUNING.ULTIMATE_DURATION_BASE + (kart.ultTier || 1) * 30) });

  if (effects.length === 0) return;

  const barW = 110, barH = 14, gap = 4;
  const panelH = effects.length * (barH + gap) + 8;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "rgba(8, 10, 24, 0.65)";
  roundRect(ctx, 0, 0, barW + 16, panelH, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, barW + 15, panelH - 1, 10);
  ctx.stroke();

  effects.forEach((eff, i) => {
    const ey = 4 + i * (barH + gap);
    const ratio = clamp(eff.ratio, 0, 1);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, 8, ey, barW, barH, 3);
    ctx.fill();

    const isDebuff = (eff.label === "BLINDED" || eff.label === "SLOWED" || eff.label === "SPINNING" || eff.label === "TETHERED!");
    const pulse = isDebuff ? (0.6 + 0.4 * Math.sin(time * 0.02)) : 1;

    ctx.fillStyle = hexToRgba(eff.color, 0.7 * pulse);
    roundRect(ctx, 8, ey, barW * ratio, barH, 3);
    ctx.fill();

    if (isDebuff) {
      ctx.strokeStyle = hexToRgba(eff.color, 0.8 * pulse);
      ctx.lineWidth = 1.5;
      roundRect(ctx, 8, ey, barW, barH, 3);
      ctx.stroke();
    }

    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(eff.label, 12, ey + barH / 2);
  });

  ctx.restore();
}

// "You were rejected — now spectating X" banner + the current kill-chain target.
function drawSpectateBanner(c, cx, y, time) {
  const t = game.spectateTarget;
  const killerName = (game.player && game.player.killedBy && game.player.killedBy.name) || null;
  c.save();
  c.textAlign = "center";
  c.textBaseline = "middle";

  // Headline
  c.shadowBlur = 10; c.shadowColor = "#ff3366";
  c.fillStyle = "#ff3366";
  c.font = "bold 20px sans-serif";
  c.fillText("SUBMISSION REJECTED", cx, y);
  c.shadowBlur = 0;

  // Subline: who we're watching now
  if (t) {
    c.fillStyle = "#a8acd0";
    c.font = "12px sans-serif";
    const followingKiller = killerName && t.name === killerName;
    c.fillText(followingKiller ? "Following your rival" : "Following the leader", cx, y + 20);
    c.fillStyle = t.color || "#fff";
    c.font = "bold 16px sans-serif";
    c.fillText(`\u25B6 ${t.name}  (${Math.max(0, t.approvals || 0)} \u2713)`, cx, y + 40);
  }
  c.restore();
}

function drawWrongWay(ctx, kart, left, top, width, height, time) {
  if (!kart || !kart.wrongWayTimer || kart.wrongWayTimer < 15) return;
  const alpha = clamp((kart.wrongWayTimer - 15) / 20, 0, 1);
  const blink = Math.sin(time * 0.012) > 0 ? 1 : 0.4;

  ctx.save();
  ctx.globalAlpha = alpha * blink;

  const cx = left + width / 2;
  const cy = top + height * 0.28;

  ctx.fillStyle = "rgba(255, 30, 30, 0.15)";
  ctx.fillRect(left, top, width, height);

  ctx.shadowBlur = 20;
  ctx.shadowColor = "#ff2222";
  ctx.fillStyle = "#ff2222";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WRONG WAY!", cx, cy);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.strokeText("WRONG WAY!", cx, cy);

  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#ffaaaa";
  ctx.fillText("Turn around!", cx, cy + 36);

  ctx.restore();
}

function drawPositionChange(ctx, x, y, kart) {
  if (isBattleMode()) return; // no race positions in Battle
  if (!kart || !kart.posChangeFlash || kart.posChangeFlash.timer <= 0) return;
  const pf = kart.posChangeFlash;
  const alpha = clamp(pf.timer / 20, 0, 1) * clamp((pf.maxTimer - pf.timer) / 6, 0, 1);
  const scale = 1 + (1 - clamp((pf.maxTimer - pf.timer) / 10, 0, 1)) * 0.5;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  const color = pf.gained ? "#a4ff80" : "#ff4d6d";
  const arrow = pf.gained ? "\u2191" : "\u2193";
  const text = `${ordinal(pf.from)} ${arrow} ${ordinal(pf.to)}`;

  ctx.shadowBlur = 12;
  ctx.shadowColor = color;
  ctx.fillStyle = "rgba(8, 10, 24, 0.8)";
  roundRect(ctx, -60, -16, 120, 32, 8);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);

  ctx.restore();
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

function drawItemNamePopup(ctx, x, y, kart, time) {
  if (!kart || !kart.itemNamePopup || kart.itemNamePopup.timer <= 0) return;
  const pop = kart.itemNamePopup;
  const alpha = clamp(pop.timer / 15, 0, 1) * clamp((pop.maxTimer - pop.timer) / 5, 0, 1);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pop.color;
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowBlur = 6;
  ctx.shadowColor = pop.color;
  ctx.fillText(pop.name, x, y);
  ctx.restore();
}

function getCharAvatarSVG(char) {
  const s = 48;
  const c = char.color;
  // Cars-style anthropomorphized vehicles: eyes on windshield, mouth on grille
  if (char.id === "anton") {
    // Sleek speed machine with confident squinting eyes
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48">
      <rect x="14" y="18" width="20" height="24" rx="3" fill="${c}"/>
      <rect x="16" y="16" width="16" height="8" rx="2" fill="${c}" opacity="0.8"/>
      <rect x="13" y="14" width="22" height="4" rx="1" fill="#88ccff" opacity="0.5"/>
      <ellipse cx="19" cy="15" rx="4" ry="2.5" fill="#fff"/><ellipse cx="29" cy="15" rx="4" ry="2.5" fill="#fff"/>
      <ellipse cx="20" cy="15" rx="1.8" ry="2" fill="#050510"/><ellipse cx="30" cy="15" rx="1.8" ry="2" fill="#050510"/>
      <ellipse cx="20.5" cy="14.5" rx="0.8" ry="0.8" fill="#fff"/>
      <ellipse cx="30.5" cy="14.5" rx="0.8" ry="0.8" fill="#fff"/>
      <path d="M18 38 Q24 41 30 38" stroke="#050510" stroke-width="1.5" fill="none"/>
      <rect x="17" y="38" width="4" height="2" rx="1" fill="#ffd86b"/>
      <rect x="27" y="38" width="4" height="2" rx="1" fill="#ffd86b"/>
      <line x1="24" y1="6" x2="24" y2="13" stroke="#aaa" stroke-width="1.5"/>
      <circle cx="24" cy="5" r="2" fill="${c}"/>
      <rect x="17" y="30" width="14" height="1" rx="0.5" fill="${c}" opacity="0.5"/>
      <rect x="17" y="33" width="14" height="1" rx="0.5" fill="${c}" opacity="0.5"/>
    </svg>`;
  }
  if (char.id === "artur") {
    // Hot rod muscle car with fierce determined eyes
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48">
      <rect x="10" y="16" width="28" height="26" rx="3" fill="${c}"/>
      <rect x="12" y="12" width="24" height="10" rx="2" fill="${c}" opacity="0.85"/>
      <rect x="11" y="11" width="26" height="5" rx="1" fill="#88ccff" opacity="0.5"/>
      <polygon points="16,11 20,6 22,11" fill="${c}" opacity="0.5"/>
      <polygon points="26,11 28,6 32,11" fill="${c}" opacity="0.5"/>
      <ellipse cx="18" cy="12" rx="4.5" ry="3" fill="#fff"/><ellipse cx="30" cy="12" rx="4.5" ry="3" fill="#fff"/>
      <ellipse cx="19" cy="12" rx="2" ry="2.5" fill="#050510"/><ellipse cx="31" cy="12" rx="2" ry="2.5" fill="#050510"/>
      <path d="M15 9 L21 11" stroke="#050510" stroke-width="1.5"/><path d="M33 9 L27 11" stroke="#050510" stroke-width="1.5"/>
      <path d="M17 38 Q24 42 31 38" stroke="#050510" stroke-width="2" fill="none"/>
      <rect x="14" y="38" width="5" height="2.5" rx="1" fill="#ffd86b"/>
      <rect x="29" y="38" width="5" height="2.5" rx="1" fill="#ffd86b"/>
      <polygon points="12,28 18,24 18,28" fill="#ff6600" opacity="0.5"/>
      <polygon points="36,28 30,24 30,28" fill="#ff6600" opacity="0.5"/>
    </svg>`;
  }
  if (char.id === "rissal") {
    // Compact hatchback with big nervous/worried eyes
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48">
      <rect x="12" y="18" width="24" height="22" rx="5" fill="${c}"/>
      <ellipse cx="24" cy="14" rx="12" ry="6" fill="${c}" opacity="0.8"/>
      <rect x="13" y="12" width="22" height="5" rx="1" fill="#88ccff" opacity="0.5"/>
      <circle cx="19" cy="13" r="4" fill="#fff"/><circle cx="29" cy="13" r="4" fill="#fff"/>
      <circle cx="19" cy="13.5" r="2.5" fill="#050510"/><circle cx="29" cy="13.5" r="2.5" fill="#050510"/>
      <circle cx="18" cy="12.5" r="1.2" fill="#fff"/><circle cx="28" cy="12.5" r="1.2" fill="#fff"/>
      <path d="M15 10 Q19 8 21 11" stroke="#050510" stroke-width="1" fill="none"/>
      <path d="M33 10 Q29 8 27 11" stroke="#050510" stroke-width="1" fill="none"/>
      <ellipse cx="24" cy="37" rx="5" ry="2" fill="#050510" opacity="0.6"/>
      <rect x="15" y="37" width="4" height="2" rx="1" fill="#ffd86b"/>
      <rect x="29" y="37" width="4" height="2" rx="1" fill="#ffd86b"/>
      <rect x="10" y="22" width="1.5" height="16" rx="0.5" fill="${c}" opacity="0.7"/>
      <rect x="36.5" y="22" width="1.5" height="16" rx="0.5" fill="${c}" opacity="0.7"/>
      <rect x="10" y="38" width="28" height="1.5" rx="0.5" fill="${c}" opacity="0.7"/>
    </svg>`;
  }
  if (char.id === "pia") {
    // Wide tank/SUV with stern tough eyes and flat mouth
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48">
      <rect x="6" y="14" width="36" height="28" rx="3" fill="${c}"/>
      <rect x="8" y="10" width="32" height="10" rx="2" fill="${c}" opacity="0.85"/>
      <rect x="7" y="9" width="34" height="5" rx="1" fill="#88ccff" opacity="0.5"/>
      <rect x="14" y="10" rx="1" width="8" height="4" fill="#fff"/><rect x="26" y="10" rx="1" width="8" height="4" fill="#fff"/>
      <rect x="16" y="10.5" rx="0.5" width="4" height="3" fill="#050510"/><rect x="28" y="10.5" rx="0.5" width="4" height="3" fill="#050510"/>
      <line x1="14" y1="9" x2="22" y2="10" stroke="#050510" stroke-width="2"/>
      <line x1="34" y1="9" x2="26" y2="10" stroke="#050510" stroke-width="2"/>
      <line x1="15" y1="38" x2="33" y2="38" stroke="#050510" stroke-width="2.5"/>
      <rect x="10" y="38" width="6" height="3" rx="1" fill="#ffd86b"/>
      <rect x="32" y="38" width="6" height="3" rx="1" fill="#ffd86b"/>
      <rect x="6" y="14" width="36" height="2.5" rx="1" fill="${c}" opacity="0.9"/>
      <rect x="6" y="39" width="36" height="2.5" rx="1" fill="${c}" opacity="0.9"/>
      <line x1="12" y1="38" x2="12" y2="42" stroke="#666" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  if (char.id === "florian") {
    // Executive sedan with calm confident eyes and slight smile
    return `<svg width="${s}" height="${s}" viewBox="0 0 48 48">
      <rect x="10" y="14" width="28" height="28" rx="3" fill="${c}"/>
      <rect x="12" y="10" width="24" height="10" rx="2" fill="${c}" opacity="0.85"/>
      <rect x="11" y="9" width="26" height="5" rx="1" fill="#88ccff" opacity="0.5"/>
      <ellipse cx="19" cy="11" rx="4" ry="3" fill="#fff"/><ellipse cx="29" cy="11" rx="4" ry="3" fill="#fff"/>
      <ellipse cx="19.5" cy="11" rx="1.8" ry="2.2" fill="#050510"/><ellipse cx="29.5" cy="11" rx="1.8" ry="2.2" fill="#050510"/>
      <ellipse cx="18.5" cy="10.5" rx="0.7" ry="0.7" fill="#fff"/>
      <ellipse cx="28.5" cy="10.5" rx="0.7" ry="0.7" fill="#fff"/>
      <path d="M19 38 Q24 40 29 38" stroke="#050510" stroke-width="1.5" fill="none"/>
      <rect x="15" y="38" width="4" height="2" rx="1" fill="#ffd86b"/>
      <rect x="29" y="38" width="4" height="2" rx="1" fill="#ffd86b"/>
      <rect x="23" y="20" width="2" height="18" rx="0.5" fill="#a4ff80" opacity="0.5"/>
      <polygon points="24,7 22,10 26,10" fill="#57f2ff" opacity="0.6"/>
      <rect x="10" y="42" width="28" height="1.5" rx="0.5" fill="#ccc" opacity="0.5"/>
    </svg>`;
  }
  return `<span style="font-weight:900;font-size:20px;">${char.initials}</span>`;
}

const ULTIMATE_INFO = {
  anton: {
    name: "Typo Storm",
    desc: "Scrambles opponents with inverted steering and typo bursts.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h16" stroke="${c}" stroke-width="2" stroke-linecap="round"/><path d="M15 10l5 5M20 10l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`
  },
  artur: {
    name: "Prayer Protocol",
    desc: "Gains shield, invulnerability, boost, and spins out touched rivals.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M7 8h10" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><path d="M5 18c4-2 10-2 14 0" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`
  },
  rissal: {
    name: "Panic Deploy",
    desc: "Drops blind panic clouds, wipes items, and can gain shield/boost.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" fill="${c}" opacity="0.24"/><path d="M12 6v7" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.6" fill="#fff"/><path d="M5 19c3-2 11-2 14 0" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`
  },
  pia: {
    name: "ThinkPad Slam",
    desc: "Fires a heavy shockwave that pushes and stuns nearby racers.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="5" y="6" width="14" height="10" rx="2" stroke="${c}" stroke-width="2"/><path d="M4 19h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M12 3v4M8 4l2 3M16 4l-2 3" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/></svg>`
  },
  florian: {
    name: "Regulatory Lockdown",
    desc: "Slows all opponents, locks items, and grants self shield/boost.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 11V8a5 5 0 0110 0v3" stroke="${c}" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="9" rx="2" fill="${c}" opacity="0.28" stroke="${c}" stroke-width="2"/><path d="M12 14v3" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`
  }
};

function getUltimateInfo(charId) {
  return ULTIMATE_INFO[charId] || {
    name: "Ultimate",
    desc: "Charge with citations, then unleash a special ability.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.7 5.6 6.2.9-4.5 4.4 1.1 6.1L12 17l-5.5 3 1.1-6.1-4.5-4.4 6.2-.9L12 3z" fill="${c}"/></svg>`
  };
}

function renderSelectScreen() {
  const container = document.getElementById("cards-container");
  container.innerHTML = "";
  CHARACTERS.forEach((char, idx) => {
    const card = document.createElement("div");
    card.className = "char-card" + (idx === game.selectedCharIdx ? " selected" : "");
    card.style.setProperty("--char-color", char.color);
    card.style.setProperty("--char-glow", char.colorGlow);
    card.style.setProperty("--char-gradient", char.gradient);

    let statsHTML = "";
    for (const [statName, value] of Object.entries(char.stats)) {
      statsHTML += `
        <div class="stat-row">
          <span class="stat-label">${statName}</span>
          <div class="stat-bar-container">
            <div class="stat-bar" style="width: ${value}%;"></div>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="char-avatar">${getCharAvatarSVG(char)}</div>
      <div class="char-name">${char.name}</div>
      <div class="char-tag">${char.tagline}</div>
      <div class="char-stats">
        ${statsHTML}
      </div>
      <div class="char-passive">${char.passive}</div>
      <div class="char-ultimate">
        <div class="ultimate-icon">${getUltimateInfo(char.id).icon(char.color)}</div>
        <div class="ultimate-copy"><strong>Ultimate: ${getUltimateInfo(char.id).name}</strong>${getUltimateInfo(char.id).desc}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      if (game.p2pMode && game.p1Locked) return;
      game.selectedCharIdx = idx;
      if (game.p2pMode) setLocalP2pCharacterIdx(idx);
      updateSelectionHighlight();
      renderAiOpponentSelectors();
      Sound.tone(440, 0.08, "square", 0.12);
      if (game.p2pMode) {
        sendP2pMessage({
          type: "select_update",
          playerId: game.p2pLocalId,
          charIdx: game.selectedCharIdx,
          locked: game.p1Locked
        });
      }
    });

    container.appendChild(card);
  });
}

function getLocalP2pPlayer() {
  if (!game.p2pMode || !game.p2pPlayers) return null;
  return game.p2pPlayers.find(p => p.id === game.p2pLocalId) || null;
}

function setLocalP2pCharacterIdx(idx) {
  const safeIdx = Math.round(clamp(Number(idx), 0, CHARACTERS.length - 1));
  game.selectedCharIdx = safeIdx;
  const local = getLocalP2pPlayer();
  if (local) local.charIdx = safeIdx;
}

function setLocalP2pLocked(locked) {
  const local = getLocalP2pPlayer();
  if (local) local.locked = !!locked;
  game.p1Locked = !!locked;
}

function getP2pReadyCount() {
  return (game.p2pPlayers || []).filter(p => p.locked).length;
}

function areAllP2pPlayersReady() {
  const players = game.p2pPlayers || [];
  return players.length >= 2 && players.every(p => p.locked);
}

function updateP2pStartButton() {
  if (!driveBtn || !game.p2pMode || game.state !== STATE.SELECT) return;
  if (game.p2pRole !== "host") {
    driveBtn.style.display = "none";
    return;
  }
  driveBtn.style.display = "block";
  const players = game.p2pPlayers || [];
  const allReady = areAllP2pPlayersReady();
  driveBtn.textContent = getRaceStartButtonLabel({
    p2pHost: true,
    allReady,
    readyCount: getP2pReadyCount(),
    totalPlayers: players.length,
  });
  driveBtn.disabled = !allReady;
}

function updateDriveButtonLabel() {
  if (!driveBtn || game.state !== STATE.SELECT) return;
  if (game.p2pMode && game.p2pRole !== "host") {
    driveBtn.style.display = "none";
    return;
  }
  if (game.p2pMode && game.p2pRole === "host") {
    updateP2pStartButton();
    return;
  }
  driveBtn.textContent = getRaceStartButtonLabel();
}

function startP2pRaceFromSelection() {
  if (!game.p2pMode || game.p2pRole !== "host") return;
  const fromFinish = game.state === STATE.FINISHED;
  if (!fromFinish && !areAllP2pPlayersReady()) return;
  prepareRaceFormatFromSelection();
  // Regenerate dragon trail with current seed so host has fresh deterministic trail
  if (MAPS[game.selectedMapIdx || 0].id === "dragon_escape") {
    _dragonTrailSeed = Math.floor(Math.random() * 2147483647);
    regenerateDragonTrail(_dragonTrailSeed);
  }
  Sound.stopTitleTheme();
  hideAll();
  buildRace();
  startCountdown();
  Sound.startEngine(1);
  sendP2pMessage({
    type: "start_race",
    mode: isBattleMode() ? "battle" : "race",
    battleApprovals: clampApprovals(game.battleApprovals),
    battleUntimed: !!game.battleUntimed,
    players: game.p2pPlayers,
    mapIdx: game.selectedMapIdx,
    mapSelection: game.mapSelection,
    grandPrixRaces,
    trackIdx: Sound.trackIdx,
    dragonSeed: _dragonTrailSeed,
    tournament: game.tournament
  });
}

function syncP2pSelectionFromRoster({ preserveLocal = false } = {}) {
  if (!game.p2pMode || !game.p2pPlayers || !game.p2pPlayers.length) return;

  const local = getLocalP2pPlayer();
  if (local && !preserveLocal) {
    game.selectedCharIdx = local.charIdx || 0;
  } else if (local) {
    local.charIdx = game.selectedCharIdx || 0;
  }
  game.p1Locked = !!(local && local.locked);
  game.p2Locked = (game.p2pPlayers || []).some(p => p.id !== game.p2pLocalId && p.locked);

  const firstRemote = game.p2pPlayers.find(p => p.id !== game.p2pLocalId);
  if (firstRemote) {
    game.selectedCharIdx2 = firstRemote.charIdx || 0;
  }
}

function checkMultiplayerSelectFinish() {
  if (game.p2pMode) {
    updateP2pStartButton();
    return;
  }

  if (game.p1Locked && game.p2Locked) {
    setTimeout(() => {
      if (game.p1Locked && game.p2Locked) {
        Sound.stopTitleTheme();
        hideAll();
        buildRace();
        startCountdown();
        Sound.startEngine(1);
        Sound.startEngine(2);
      }
    }, 450);
  }
}

function updateSelectionHighlight() {
  const cards = document.querySelectorAll(".char-card");
  cards.forEach((card, idx) => {
    card.classList.remove("selected", "selected-p1", "selected-p2", "selected-both");

    // Remove any previous badges
    const badges = card.querySelectorAll(".p-badge");
    badges.forEach(b => b.remove());

    if (game.p2pMode) {
      const players = game.p2pPlayers && game.p2pPlayers.length
        ? game.p2pPlayers
        : [{ id: game.p2pLocalId || "host", charIdx: game.selectedCharIdx || 0 }];
      const matches = players.filter(p => (p.charIdx || 0) === idx);
      if (matches.length) {
        const hasLocal = matches.some(p => p.id === game.p2pLocalId);
        card.classList.add(hasLocal ? "selected-p1" : "selected-p2");
        matches.forEach((player, badgeIdx) => {
          const badge = document.createElement("div");
          badge.className = "p-badge " + (player.id === game.p2pLocalId ? "p1" : "p2");
          const label = player.id === game.p2pLocalId
            ? (player.locked ? "YOU READY" : "YOU")
            : (player.locked ? "READY" : getP2pPlayerLabel(player, badgeIdx));
          badge.innerText = matches.length > 1 ? `${label} ${badgeIdx + 1}` : label;
          card.appendChild(badge);
        });
      }
    } else if (game.multiplayer) {
      const isP1 = (idx === game.selectedCharIdx);
      const isP2 = (idx === game.selectedCharIdx2);

      if (isP1 && isP2) {
        card.classList.add("selected-both");

        const b1 = document.createElement("div");
        b1.className = "p-badge p1";
        b1.innerText = game.p1Locked ? "P1 READY" : "PLAYER 1";
        card.appendChild(b1);

        const b2 = document.createElement("div");
        b2.className = "p-badge p2";
        b2.innerText = game.p2Locked ? "P2 READY" : "PLAYER 2";
        card.appendChild(b2);
      } else if (isP1) {
        card.classList.add("selected-p1");

        const b1 = document.createElement("div");
        b1.className = "p-badge p1";
        b1.innerText = game.p1Locked ? "P1 READY" : "PLAYER 1";
        card.appendChild(b1);
      } else if (isP2) {
        card.classList.add("selected-p2");

        const b2 = document.createElement("div");
        b2.className = "p-badge p2";
        b2.innerText = game.p2Locked ? "P2 READY" : "PLAYER 2";
        card.appendChild(b2);
      }
    } else {
      if (idx === game.selectedCharIdx) {
        card.classList.add("selected");

        const b1 = document.createElement("div");
        b1.className = "p-badge p1";
        b1.innerText = "PLAYER 1";
        card.appendChild(b1);
      }
    }
  });

  // Update status label banners in select screen
  if (game.multiplayer) {
    const s1 = document.getElementById("status-p1");
    const s2 = document.getElementById("status-p2");

    const local = game.p2pMode ? getLocalP2pPlayer() : null;
    const localLabel = game.p2pMode ? "You" : "P1";
    const peerLabel = game.p2pMode ? "Online" : "P2";
    const readyCount = game.p2pMode ? getP2pReadyCount() : 0;
    const totalPlayers = game.p2pMode ? (game.p2pPlayers || []).length : 0;

    if (game.p2pMode ? !!(local && local.locked) : game.p1Locked) {
      s1.innerText = `${localLabel}: READY!`;
      s1.className = "p1-status ready";
    } else {
      s1.innerText = `${localLabel}: Selecting...`;
      s1.className = "p1-status selecting";
    }

    if (game.p2pMode) {
      s2.innerText = `${peerLabel}: ${readyCount}/${totalPlayers} Ready`;
      s2.className = readyCount === totalPlayers && totalPlayers >= 2 ? "p2-status ready" : "p2-status selecting";
    } else if (game.p2Locked) {
      s2.innerText = `${peerLabel}: READY!`;
      s2.className = "p2-status ready";
    } else {
      s2.innerText = `${peerLabel}: Selecting...`;
      s2.className = "p2-status selecting";
    }
  }
}

function showSelectScreen() {
  if (
    isGrandPrixActive() &&
    [STATE.COUNTDOWN, STATE.RACING, STATE.PAUSED, STATE.FINISHED].includes(game.state)
  ) {
    game.tournament = null;
  }
  if (Sound.ctx && !Sound.titleThemeActive && !Sound.isPlayingMusic) Sound.playVocoderTitle();
  ensureSelectedMapMatchesMode();
  if (game.multiplayer && !game.p2pMode && isGrandPrixSelection()) {
    syncMapSelectionFromIdx(game.selectedMapIdx || 0);
    game.tournament = null;
  }
  hideAll();
  selectScreen.classList.remove("hidden");
  game.state = STATE.SELECT;
  game.selectedCharIdx = game.selectedCharIdx || 0;

  if (game.multiplayer) {
    if (aiSelectSection) aiSelectSection.style.display = "none";
    if (game.p2pMode) syncP2pSelectionFromRoster();
    game.selectedCharIdx2 = game.selectedCharIdx2 !== undefined ? game.selectedCharIdx2 : 1;
    if (!game.p2pMode) {
      game.p1Locked = false;
      game.p2Locked = false;
    }
    document.getElementById("status-p1").style.display = "block";
    document.getElementById("status-p1").innerText = game.p2pMode && game.p1Locked ? "You: READY!" : (game.p2pMode ? "You: Selecting" : "P1: Selecting");
    document.getElementById("status-p1").className = "p1-status selecting";
    document.getElementById("status-p2").style.display = "block";
    document.getElementById("status-p2").innerText = game.p2pMode ? `Online: ${getP2pReadyCount()}/${(game.p2pPlayers || []).length} Ready` : "P2: Selecting";
    document.getElementById("status-p2").className = "p2-status selecting";
    document.getElementById("lobby-subtitle").innerText = game.p2pMode
      ? (game.p2pRole === "host" ? "Online Lobby: Pick Mode, Map & Coder" : "Online Lobby: Host Picks Mode & Map · Pick Your Coder")
      : "Lobby: 2 Players Ready Up";
    document.getElementById("lobby-hint").innerText = game.p2pMode
      ? (game.p2pRole === "host" ? "Host picks mode/map/rules · Everyone picks coder · Space/Enter to ready" : "Host picks mode/map/rules · Pick coder · Space/Enter to ready")
      : "Space to lock P1 · Right Shift to lock P2";
    driveBtn.disabled = false;
    driveBtn.style.display = game.p2pMode && game.p2pRole === "host" ? "block" : "none";
    updateDriveButtonLabel();
  } else {
    if (aiSelectSection) aiSelectSection.style.display = TRAINED_AI_ENABLED ? "flex" : "none";
    game.selectedCharIdx2 = undefined;
    game.p1Locked = false;
    game.p2Locked = false;
    document.getElementById("status-p1").style.display = "block";
    document.getElementById("status-p1").innerText = "P1: Selecting";
    document.getElementById("status-p1").className = "p1-status selecting";
    document.getElementById("status-p2").style.display = "none";
    document.getElementById("lobby-subtitle").innerText = "Lobby: Choose Your Coder";
    document.getElementById("lobby-hint").innerText = "Press Space or Enter to Drive!";
    driveBtn.disabled = false;
    driveBtn.style.display = "block";
    updateDriveButtonLabel();
  }

  const battleSection = document.getElementById("battle-select-section");
  const mapSection = document.getElementById("map-select-section");
  if (game.p2pMode) {
    if (mapSection) {
      mapSection.style.display = "";
      const mapTitle = document.getElementById("map-select-title");
      if (mapTitle) mapTitle.innerText = "Select Mode & Map";
    }
    updateP2pBattleLobbyUi();
  } else if (isBattleMode()) {
    if (mapSection) {
      mapSection.style.display = "";
      const mapTitle = document.getElementById("map-select-title");
      if (mapTitle) mapTitle.innerText = "Select Arena Map";
    }
    if (aiSelectSection) aiSelectSection.style.display = TRAINED_AI_ENABLED ? "flex" : "none";
    if (battleSection) battleSection.style.display = "flex";
    document.getElementById("lobby-subtitle").innerText = "Battle Arena: Choose Your Coder";
    document.getElementById("lobby-hint").innerText = "Press Space or Enter to Battle!";
    driveBtn.textContent = "Battle!";
    renderApprovalsSelect();
  } else {
    if (mapSection) {
      mapSection.style.display = "";
      const mapTitle = document.getElementById("map-select-title");
      if (mapTitle) mapTitle.innerText = shouldShowGrandPrixCard() ? "Select Circuit or Grand Prix" : "Select Circuit Track";
    }
    if (battleSection) battleSection.style.display = "none";
  }

  renderSelectScreen();
  updateSelectionHighlight();
  renderMapSelect();
  if (!game.multiplayer) refreshAiModelSelector();
  updateP2pStartButton();
}

function renderApprovalsSelect() {
  document.querySelectorAll("#approvals-group [data-approvals]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.approvals) === game.battleApprovals);
  });
  document.querySelectorAll("#battle-timing-group [data-battle-timed]").forEach((b) => {
    const timed = b.dataset.battleTimed === "1";
    b.classList.toggle("active", timed ? !game.battleUntimed : !!game.battleUntimed);
  });
}

function buildGrandPrixMapCard({ disabled = false, onSelect } = {}) {
  const gpCard = document.createElement("div");
  gpCard.className = "map-card grand-prix-card" + (isGrandPrixSelection() ? " selected" : "");
  if (disabled) gpCard.classList.add("disabled");

  let hostLabelHTML = "";
  if (game.p2pMode && isGrandPrixSelection()) {
    hostLabelHTML = `<span class="host-badge">${game.p2pRole === "host" ? "Host Pick" : "Host Choice"}</span>`;
  }

  const chipsHtml = [
    `<span class="feature-chip accent">CHAMPIONSHIP</span>`,
    `<span class="feature-chip">${grandPrixRaces} RACES</span>`,
    `<span class="feature-chip success">GP POINTS</span>`,
  ].join("");

  gpCard.innerHTML = `
    ${hostLabelHTML}
    <div class="map-preview">${getGrandPrixPreviewSvg()}</div>
    <div class="map-name">Grand Prix</div>
    <div class="map-feature-chips">${chipsHtml}</div>
    <div class="map-desc">Rotates through every circuit map in order. Points stack across races — highest total wins the championship.</div>
    <div class="map-stat">CIRCUITS: ${getGrandPrixCircuitIndices().length} · FORMAT: ${grandPrixRaces}-RACE SERIES</div>
  `;

  if (!disabled) {
    gpCard.addEventListener("click", () => {
      if (game.p1Locked) return;
      if (onSelect) onSelect();
    });
  }
  return gpCard;
}

function buildCircuitMapCard(map, idx, { disabled = false, onSelect, targetMode = null } = {}) {
  const card = document.createElement("div");
  const selectionMode = targetMode || (map.arena ? "battle" : "race");
  const isSelected = selectionMode === "battle"
    ? (isBattleMode() && idx === (game.selectedMapIdx || 0))
    : (!isGrandPrixSelection() && !isBattleMode() && idx === (game.selectedMapIdx || 0));
  card.className = "map-card" + (isSelected ? " selected" : "");
  if (disabled) card.classList.add("disabled");

  let hostLabelHTML = "";
  if (game.p2pMode && isSelected) {
    hostLabelHTML = `<span class="host-badge">${game.p2pRole === "host" ? "Host Pick" : "Host Choice"}</span>`;
  }

  const featureChips = getMapFeatureChips(map);
  const chipsHtml = featureChips.map((chip) => {
    const cls = chip === "OPEN" || chip === "ENDLESS" ? "accent" : (chip.includes("REVIEW") || chip.includes("APPROVED") ? "success" : "");
    return `<span class="feature-chip${cls ? " " + cls : ""}">${chip}</span>`;
  }).join("");

  const statLabel = map.arena
    ? `ARENA: ${map.worldW}x${map.worldH} · BATTLE`
    : `GRID: ${map.worldW}x${map.worldH} · SEGMENTS: ${map.waypoints.length} · 1 RACE`;

  card.innerHTML = `
    ${hostLabelHTML}
    <div class="map-preview">${getMapPreviewSvg(map)}</div>
    <div class="map-name">${map.name}</div>
    <div class="map-feature-chips">${chipsHtml}</div>
    <div class="map-desc">${map.desc}</div>
    <div class="map-stat">${statLabel}</div>
  `;

  if (!disabled) {
    card.addEventListener("click", () => {
      if (game.p1Locked) return;
      if (onSelect) onSelect(map, idx);
    });
  }
  return card;
}

function renderP2pDualMapSelect(container) {
  const isP2pGuest = game.p2pRole === "guest";

  const raceSection = document.createElement("div");
  raceSection.className = "p2p-map-category";
  raceSection.innerHTML = `<div class="map-select-title">Race &amp; Grand Prix</div>`;
  const raceGrid = document.createElement("div");
  raceGrid.className = "map-select-container";
  raceGrid.appendChild(buildGrandPrixMapCard({
    disabled: isP2pGuest,
    onSelect: () => selectP2pMap({ mapSelection: GRAND_PRIX_ID, mode: "race" }),
  }));
  MAPS.forEach((map, idx) => {
    if (map.arena) return;
    raceGrid.appendChild(buildCircuitMapCard(map, idx, {
      disabled: isP2pGuest,
      targetMode: "race",
      onSelect: (_, mapIdx) => selectP2pMap({ mapIdx, mode: "race" }),
    }));
  });
  raceSection.appendChild(raceGrid);

  const battleSection = document.createElement("div");
  battleSection.className = "p2p-map-category";
  battleSection.innerHTML = `<div class="map-select-title">Battle Arenas</div>`;
  const battleGrid = document.createElement("div");
  battleGrid.className = "map-select-container";
  MAPS.forEach((map, idx) => {
    if (!map.arena) return;
    battleGrid.appendChild(buildCircuitMapCard(map, idx, {
      disabled: isP2pGuest,
      targetMode: "battle",
      onSelect: (_, mapIdx) => selectP2pMap({ mapIdx, mode: "battle" }),
    }));
  });
  battleSection.appendChild(battleGrid);

  container.appendChild(raceSection);
  container.appendChild(battleSection);
  updateP2pBattleLobbyUi();
}

function renderMapSelect() {
  const container = document.getElementById("maps-container");
  if (!container) return;
  ensureSelectedMapMatchesMode();
  container.innerHTML = "";

  if (game.p2pMode) {
    renderP2pDualMapSelect(container);
    return;
  }

  const showGpCard = shouldShowGrandPrixCard();
  if (showGpCard) {
    container.appendChild(buildGrandPrixMapCard({
      onSelect: () => {
        selectGrandPrixMap();
        const firstMap = MAPS[game.selectedMapIdx];
        if (firstMap) previewSelectedMapMusic(firstMap);
        renderMapSelect();
        renderAiModelSelector();
        updateDriveButtonLabel();
        Sound.tone(620, 0.1, "sine", 0.18);
      },
    }));
  }

  MAPS.forEach((map, idx) => {
    if (!!map.arena !== isBattleMode()) return;
    container.appendChild(buildCircuitMapCard(map, idx, {
      onSelect: (m) => {
        if (isBattleMode()) selectArenaMap(idx);
        else selectCircuitMap(idx);
        previewSelectedMapMusic(m);
        renderMapSelect();
        renderAiModelSelector();
        updateDriveButtonLabel();
        Sound.tone(520, 0.08, "sine", 0.15);
      },
    }));
  });
}

function enterP2pSelectScreen() {
  syncP2pSelectionFromRoster();
  showSelectScreen();
  renderMapSelect();
}

function getMapPreviewSvg(map) {
  const points = map.waypoints || [];
  if (points.length < 2) return "";
  const maxPoints = 90;
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const sampled = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of sampled) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const vbW = 180;
  const vbH = 70;
  const pad = 8;
  const scale = Math.min((vbW - pad * 2) / w, (vbH - pad * 2) / h);
  const offX = (vbW - w * scale) / 2;
  const offY = (vbH - h * scale) / 2;
  const svgPoints = sampled.map(p => {
    const x = offX + (p.x - minX) * scale;
    const y = offY + (p.y - minY) * scale;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const closed = map.id !== "dragon_escape";
  if (closed) svgPoints.push(svgPoints[0]);
  const color = (Sound.tracks[map.musicTrack || 0] || Sound.tracks[0]).color || "#57f2ff";
  const start = svgPoints[0];
  return `
    <svg viewBox="0 0 ${vbW} ${vbH}" aria-hidden="true" focusable="false">
      <polyline points="${svgPoints.join(" ")}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${svgPoints.join(" ")}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${start.split(",")[0]}" cy="${start.split(",")[1]}" r="4" fill="#ffd86b"/>
    </svg>
  `;
}

function getActiveKarts() {
  return [
    game.player,
    ...(game.multiplayer && game.player2 ? [game.player2] : []),
    ...(game.remotePlayers || []),
    ...game.ais
  ].filter(Boolean);
}

function getP2pPlayerLabel(player, idx) {
  if (player.id === "host") return "Host";
  return "Player " + (idx + 1);
}

function getP2pRosterHtml() {
  const players = (game.p2pPlayers && game.p2pPlayers.length)
    ? game.p2pPlayers
    : [{ id: game.p2pLocalId || "host", charIdx: game.selectedCharIdx || 0, joinedAt: Date.now() }];
  return players.map((player, idx) => {
    const char = CHARACTERS[player.charIdx || 0];
    const localClass = player.id === game.p2pLocalId ? " local" : "";
    const chip = player.id === game.p2pLocalId
      ? (player.locked ? "You Ready" : "You")
      : (player.locked ? "Ready" : "Joined");
    return `
      <div class="p2p-player-row${localClass}">
        <span>${getP2pPlayerLabel(player, idx)} · ${char.name}</span>
        <span class="p2p-player-chip">${chip}</span>
      </div>
    `;
  }).join("");
}

function renderP2pLobby() {
  const html = getP2pRosterHtml();
  if (p2pHostRoster) p2pHostRoster.innerHTML = game.p2pRole === "host" ? html : "";
  if (p2pJoinRoster) p2pJoinRoster.innerHTML = game.p2pRole === "guest" ? html : "";
  if (p2pStartRaceBtn) {
    const canStart = game.p2pRole === "host" && (game.p2pPlayers || []).length >= 2;
    p2pStartRaceBtn.style.display = game.p2pRole === "host" ? "inline-block" : "none";
    p2pStartRaceBtn.disabled = !canStart;
    p2pStartRaceBtn.textContent = canStart ? "Open Selection" : "Waiting For Players";
  }
}

function ensureHostP2pPlayer() {
  game.p2pLocalId = "host";
  game.p2pPlayers = [{
    id: "host",
    charIdx: game.selectedCharIdx || 0,
    locked: false,
    joinedAt: Date.now()
  }];
  renderP2pLobby();
}

function addP2pGuest(conn) {
  const taken = new Set(game.p2pPlayers.map(p => p.id));
  let slot = 1;
  while (taken.has("guest_" + slot)) slot++;
  if (slot > 7) {
    try { conn.send({ type: "lobby_full" }); } catch(e) {}
    try { conn.close(); } catch(e) {}
    return null;
  }

  const id = "guest_" + slot;
  const usedChars = new Set(game.p2pPlayers.map(p => p.charIdx));
  let charIdx = slot % CHARACTERS.length;
  for (let i = 0; i < CHARACTERS.length; i++) {
    if (!usedChars.has(i)) { charIdx = i; break; }
  }

  const player = { id, charIdx, locked: false, joinedAt: Date.now() };
  game.p2pPlayers.push(player);
  p2pConnections.set(id, conn);
  renderP2pLobby();
  return player;
}

function removeP2pGuestByConn(conn) {
  const removedId = getP2pIdForConn(conn);
  if (!removedId) return;
  p2pConnections.delete(removedId);
  handleP2pPlayerRemoved(removedId);
}

function markP2pKartDisconnected(playerId) {
  const kart = getKartById(playerId);
  if (!kart) return;
  if (isBattleMode()) {
    if (!kart.eliminated) {
      kart.eliminated = true;
      kart.vx = 0;
      kart.vy = 0;
    }
  } else {
    kart.finished = true;
    kart.finishTime = undefined;
  }
  triggerHitFlash("PLAYER LEFT", "#ff4d6d", 90, kart);
  if (game.particles) {
    game.particles.add({
      type: "text",
      text: "PLAYER LEFT",
      x: kart.x,
      y: kart.y - 30,
      vx: 0,
      vy: -0.8,
      life: 55,
      maxLife: 55,
      size: 16,
      color: "#ff4d6d",
      drag: 0.98
    });
  }
}

function handleP2pPlayerRemoved(playerId) {
  const midRace = [STATE.COUNTDOWN, STATE.RACING, STATE.PAUSED].includes(game.state);
  if (midRace) {
    markP2pKartDisconnected(playerId);
    const p = game.p2pPlayers.find((row) => row.id === playerId);
    if (p) p.disconnected = true;
  } else {
    game.p2pPlayers = game.p2pPlayers.filter((p) => p.id !== playerId);
    if (game.state === STATE.SELECT) {
      syncP2pSelectionFromRoster({ preserveLocal: true });
      updateSelectionHighlight();
      updateP2pStartButton();
    }
  }
  renderP2pLobby();
  if (!midRace) broadcastP2pLobby();
}

function p2pReturnToLobbyLocal(lobbyData = null) {
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  game.hazards = [];
  game.p2pBattleEndPending = false;
  game.tournament = null;
  game._pauseFromState = null;
  game.p2pConnectionUnstable = false;
  pauseScreen.classList.add("hidden");
  if (lobbyData) {
    if (lobbyData.players) game.p2pPlayers = lobbyData.players;
    applyLobbyMapSelection(lobbyData);
    if (lobbyData.trackIdx !== undefined && lobbyData.trackIdx !== null) setMusicTrack(lobbyData.trackIdx);
  }
  if (game.p2pRole === "host") {
    game.p2pPlayers = (game.p2pPlayers || []).filter((p) => !p.disconnected);
  }
  resetP2pReadyForLobbyChange();
  hideAll();
  showSelectScreen();
}

function p2pHostCancelRaceToLobby() {
  if (!game.p2pMode || game.p2pRole !== "host") return;
  resetP2pReadyForLobbyChange();
  broadcastP2pMessage({
    type: "return_lobby",
    players: game.p2pPlayers.filter((p) => !p.disconnected),
    ...getP2pLobbyMapPayload(),
  });
  p2pReturnToLobbyLocal();
}

function p2pGuestLeaveMatch() {
  if (!game.p2pMode || game.p2pRole !== "guest") return;
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  pauseScreen.classList.add("hidden");
  handleP2pDisconnect({ silent: true });
}

function updatePauseScreenUi() {
  const isP2pPaused = game.p2pMode && game.state === STATE.PAUSED;
  if (pauseP2pSubtitle) pauseP2pSubtitle.style.display = isP2pPaused ? "block" : "none";
  if (pauseDefaultSubtitle) pauseDefaultSubtitle.style.display = isP2pPaused ? "none" : "block";
  if (p2pCancelLobbyBtn) {
    p2pCancelLobbyBtn.style.display = (isP2pPaused && game.p2pRole === "host") ? "inline-block" : "none";
  }
  if (p2pLeaveMatchBtn) {
    p2pLeaveMatchBtn.style.display = (isP2pPaused && game.p2pRole === "guest") ? "inline-block" : "none";
  }
}

function getP2pIdForConn(conn) {
  for (const [id, existing] of p2pConnections.entries()) {
    if (existing === conn) return id;
  }
  return null;
}

function isHighFrequencyP2pMessage(data) {
  return data && (data.type === "host_sync" || data.type === "guest_sync");
}

function sendToConn(conn, data) {
  if (!conn || !conn.open) return;
  const dataChannel = conn._dc || conn.dataChannel;
  if (
    isHighFrequencyP2pMessage(data) &&
    dataChannel &&
    dataChannel.bufferedAmount > TUNING.P2P_MAX_BUFFERED_BYTES
  ) {
    return;
  }
  conn.send(data);
}

function broadcastP2pMessage(data, exceptConn = null) {
  for (const conn of p2pConnections.values()) {
    if (conn !== exceptConn) sendToConn(conn, data);
  }
}

function broadcastP2pLobby() {
  if (game.p2pRole !== "host") return;
  broadcastP2pMessage({
    type: "lobby_state",
    players: game.p2pPlayers,
    ...getP2pLobbyMapPayload(),
  });
  renderP2pLobby();
}

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
  _hazardIdCounter = 0;

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

function getPromptlyStandingsComment(standings, isFinal) {
  if (!standings || !standings.length) return "Let's get this audit on the road!";
  const leader = standings[0];
  if (isFinal) {
    return `${leader.name} is the Champion of Compliance! Fully audited, zero findings.`;
  }
  if (standings.length < 2) {
    return `${leader.name} is setting the pace — keep that compliance streak alive!`;
  }
  const gap = leader.points - standings[1].points;
  if (gap >= 10) {
    return `${leader.name} is running away with it — someone file an objection!`;
  }
  return `Only ${gap} points in it — this audit is far from over.`;
}

function buildTournamentStandingsHtml() {
  const t = game.tournament;
  if (!isGrandPrixActive(t)) return "";
  const isFinal = t.raceIndex + 1 >= t.totalRaces;
  const standings = t.standings || [];
  const comment = getPromptlyStandingsComment(standings, isFinal);

  let html = `<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.1);">`;
  html += `<div class="row" style="margin-bottom:8px;font-weight:900;color:#fff;"><span class="label">Race ${t.raceIndex + 1} of ${t.totalRaces} — Grand Prix Standings</span><span></span></div>`;
  html += `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">`;
  html += `<img src="promptly.webp" alt="Promptly" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;" />`;
  html += `<div style="font-size:13px;color:var(--reg-text-dim);line-height:1.4;padding-top:4px;">${comment}</div>`;
  html += `</div>`;

  standings.forEach((s, i) => {
    const place = i + 1;
    const isChamp = isFinal && place === 1;
    const rowStyle = isChamp ? "font-size:17px;color:#ffd86b;font-weight:900;" : "";
    const nameLabel = s.name + (s.isLocalHuman ? " (You)" : "");
    html += `<div class="row" style="${isChamp ? "background:rgba(255,216,107,0.08);border-radius:8px;padding:10px 6px;margin:2px 0;" : ""}">`;
    html += `<span class="label" style="${rowStyle}"><span class="place-badge place-${Math.min(place, 4)}">${ordinal(place)}</span> ${nameLabel}</span>`;
    html += `<span class="value" style="${rowStyle}">${s.points} pts</span>`;
    html += `</div>`;
  });
  html += `</div>`;
  return html;
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

function applyP2pPickupRequest(data, sourceConn = null) {
  if (game.p2pRole !== "host" || !game.track) return false;

  const index = Math.floor(Number(data.index));
  if (!Number.isFinite(index) || index < 0) return false;

  const requesterId = getP2pIdForConn(sourceConn) || data.kartId;
  const kart = getKartById(requesterId);
  if (!kart || kart.finished || kart.eliminated) return false;

  if (data.pickup === "coin") {
    const coin = game.track.coins[index];
    if (!coin || coin.collected) return false;
    coin.collected = true;
    coin.respawn = 700;
    kart.coinsCollected++;
    if (!kart.ultReady) {
      kart.ultCharge = Math.min((kart.ultCharge || 0) + 1, TUNING.ULTIMATE_COINS_NEEDED);
      if (kart.ultCharge >= TUNING.ULTIMATE_COINS_NEEDED) kart.ultReady = true;
    }
    return true;
  }

  if (data.pickup === "itemBox") {
    const box = game.track.itemBoxes[index];
    if (!box || !box.active) return false;
    box.active = false;
    box.respawn = 240;
    if (kart.itemState === "empty") {
      kart.itemState = "rolling";
      kart.itemRollTimer = TUNING.ITEM_ROLL_TIME;
    }
    return true;
  }

  return false;
}

function applyP2pPickupState(data) {
  if (!game.track) return;
  const index = Math.floor(Number(data.index));
  if (!Number.isFinite(index) || index < 0) return;

  if (data.pickup === "coin") {
    const coin = game.track.coins[index];
    if (!coin) return;
    coin.collected = true;
    coin.respawn = 700;
    const kart = getKartById(data.kartId);
    if (kart && data.coinsCollected !== undefined) {
      kart.coinsCollected = Math.max(kart.coinsCollected || 0, data.coinsCollected);
      kart.citationBoostTimer = Math.max(kart.citationBoostTimer || 0, TUNING.CITATION_BOOST_DURATION);
    }
  } else if (data.pickup === "itemBox") {
    const box = game.track.itemBoxes[index];
    if (!box) return;
    box.active = false;
    box.respawn = 240;
  }
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
    if (titleScreen.classList.contains("hidden")) {
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
      pauseScreen.classList.remove("hidden");
      updatePauseScreenUi();
    } else if (game.state === STATE.PAUSED) {
      pauseScreen.classList.add("hidden");
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
function drawWorld(pKart, left, top, width, height, time, isP2) {
  if (!pKart) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  // Draw background grass
  ctx.fillStyle = "#0a1f0d";
  ctx.fillRect(left, top, width, height);

  const cx = left + width / 2;
  const cy = top + height / 2;

  if (!pKart.camX) {
    pKart.camX = pKart.x;
    pKart.camY = pKart.y;
    pKart.camScale = 1.0;
  }
  const lookX = pKart.x + pKart.vx * 12;
  const lookY = pKart.y + pKart.vy * 12;
  const dt = game.lastDt || 1;
  const followLerp = 1 - Math.pow(0.92, dt);
  pKart.camX = lerp(pKart.camX, lookX, followLerp);
  pKart.camY = lerp(pKart.camY, lookY, followLerp);

  const sp = pKart.speed();
  const targetScale = clamp(1.05 - sp * 0.025, 0.85, 1.05);
  pKart.camScale = lerp(pKart.camScale, targetScale, followLerp);

  const shake = game.shake;
  const sx = (Math.random() - 0.5) * shake * 2;
  const sy = (Math.random() - 0.5) * shake * 2;

  ctx.translate(cx + sx, cy + sy);
  ctx.scale(pKart.camScale, pKart.camScale);
  ctx.translate(-pKart.camX, -pKart.camY);

  // Track
  game.track.draw(ctx, time);

  // Skid marks
  for (const s of game.skidMarks) {
    const a = clamp(s.life / s.maxLife, 0, 1) * 0.6;
    ctx.fillStyle = s.color || `rgba(20,20,30,${a})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, TAU);
    ctx.fill();
  }

  // Spectators
  if (game.track.spectators && game.track.spectators.length) {
    game.track.drawSpectators(ctx, time);
  }

  // Items
  game.track.drawItems(ctx, time);

  // Moving mainframe objects
  if (game.track.movingObjects && game.track.movingObjects.length) {
    game.track.drawMovingObjects(ctx, time);
  }

  if (game.track.regulatoryDragon) {
    game.track.drawRegulatoryDragon(ctx, time);
  }

  // Hazards
  if (game.hazards) {
    for (const h of game.hazards) {
      h.draw(ctx, time);
    }
  }

  drawMergeRequestTethers(ctx, time);
  // Dragon head visual for Dragon's Escape map
  if (MAPS[game.selectedMapIdx || 0].id === "dragon_escape") {
    drawDragonHead(ctx, pKart, time);
  }

  // Karts sorted by depth
  const activeKarts = getActiveKarts();
  const sorted = activeKarts.slice().sort((a, b) => a.y - b.y);
  for (const k of sorted) k.draw(ctx, time);

  // Name tags below karts + speech bubbles above
  for (const k of sorted) {
    drawKartNameTag(ctx, k, time);
    drawApprovals(ctx, k, time);
    drawSpeechBubble(ctx, k);
  }

  // Particles
  game.particles.draw(ctx);

  // Speed lines while boosting
  if (pKart.boostTimer > 0) {
    drawSpeedLinesViewport(ctx, left, top, width, height, time);
  }

  ctx.restore();
}

function drawDragonHead(ctx, pKart, time) {
  // Dragon's Escape uses a shared world entity, not a per-camera decoration.
  const dragon = game.dragonEscape;
  if (!dragon || !dragon.active) return;
  const headX = dragon.x;
  const headY = dragon.y + Math.sin(time * 0.0018) * 34 + Math.sin(time * 0.004) * 12;

  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(dragon.heading || 0);

  const headScale = clamp(1.0 - (pKart.camScale - 0.85) * 0.3, 0.65, 1.1);
  ctx.scale(headScale, headScale);

  const breathe = Math.sin(time * 0.002);
  const eyeGlow = 0.85 + 0.15 * Math.sin(time * 0.006);
  const wingFlap = Math.sin(time * 0.004) * 0.15;

  // ---- Shadow ----
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(10, 150, 120, 22, 0, 0, TAU);
  ctx.fill();

  // ---- WINGS (drawn behind body) ----
  // Back wing (darker, offset)
  ctx.save();
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#660000";
  ctx.fillStyle = "#1a0a05";
  ctx.beginPath();
  ctx.moveTo(-40, -20);
  ctx.quadraticCurveTo(-200, -220 + wingFlap * 60, -320, -120 + wingFlap * 90);
  ctx.quadraticCurveTo(-240, -60 + wingFlap * 40, -180, -40 + wingFlap * 20);
  ctx.quadraticCurveTo(-140, -10 + wingFlap * 10, -50, 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#4a1a0a";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Wing membrane veins
  ctx.strokeStyle = "rgba(255, 50, 0, 0.2)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-40, -20);
    ctx.quadraticCurveTo(-160 - i * 30, -140 + wingFlap * 50 + i * 15, -280 - i * 15, -100 + wingFlap * 80);
    ctx.stroke();
  }
  ctx.restore();

  // Front wing (slightly lighter, different flap phase)
  ctx.save();
  ctx.shadowBlur = 15;
  ctx.shadowColor = "#aa2200";
  ctx.fillStyle = "#2a1008";
  const flap2 = Math.sin(time * 0.004 + 1.2) * 0.12;
  ctx.beginPath();
  ctx.moveTo(-10, 10);
  ctx.quadraticCurveTo(-180, -180 + flap2 * 70, -290, -80 + flap2 * 100);
  ctx.quadraticCurveTo(-220, -30 + flap2 * 45, -150, -10 + flap2 * 25);
  ctx.quadraticCurveTo(-110, 20 + flap2 * 15, -20, 50);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5c1a0a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ---- Serpentine BODY/NECK trailing back ----
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#551100";
  ctx.fillStyle = "#1e0d06";
  ctx.beginPath();
  ctx.moveTo(-50, 40);
  ctx.quadraticCurveTo(-120, 80 + breathe * 10, -180, 40 + breathe * 15);
  ctx.quadraticCurveTo(-260, 10 + breathe * 20, -340, -30 + breathe * 25);
  ctx.quadraticCurveTo(-400, -60 + breathe * 30, -450, -20 + breathe * 20);
  ctx.lineTo(-460, -10 + breathe * 20);
  ctx.quadraticCurveTo(-400, 40 + breathe * 25, -320, 80 + breathe * 15);
  ctx.quadraticCurveTo(-200, 120 + breathe * 10, -80, 70);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#3a1208";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // ---- Dorsal spikes along neck ----
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#aa0000";
  ctx.fillStyle = "#8b0000";
  const spikePts = [
    [-60, 20, 25], [-110, 50, 22], [-170, 30, 28], [-240, 5, 24],
    [-310, -15, 26], [-380, -40, 30], [-440, -15, 22]
  ];
  for (const [sx, sy, sh] of spikePts) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 8, sy - sh);
    ctx.lineTo(sx + 8, sy - sh + 6);
    ctx.closePath();
    ctx.fill();
  }

  // ---- MAIN HEAD (serpentine, menacing) ----
  ctx.shadowBlur = 20;
  ctx.shadowColor = "#ff2200";
  ctx.fillStyle = "#2a1010";
  ctx.beginPath();
  // Top of skull
  ctx.moveTo(-70, -50);
  ctx.quadraticCurveTo(-20, -120, 50, -80);
  ctx.quadraticCurveTo(90, -60, 110, -20);
  // Snout top
  ctx.quadraticCurveTo(125, 0, 130, 30);
  // Upper jaw / teeth line
  ctx.quadraticCurveTo(120, 45, 100, 45);
  // Mouth interior
  ctx.quadraticCurveTo(70, 40, 40, 35);
  // Lower jaw bottom
  ctx.quadraticCurveTo(20, 70, -20, 65);
  // Jaw hinge
  ctx.quadraticCurveTo(-40, 55, -50, 40);
  // Throat / neck down
  ctx.quadraticCurveTo(-80, 30, -90, 0);
  ctx.quadraticCurveTo(-100, -30, -70, -50);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#c0392b";
  ctx.lineWidth = 3;
  ctx.stroke();

  // ---- Jaw interior (dark fleshy cavity) ----
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ff6600";
  ctx.fillStyle = "#0a0302";
  ctx.beginPath();
  ctx.moveTo(30, 35);
  ctx.quadraticCurveTo(80, 40, 110, 30);
  ctx.quadraticCurveTo(100, 55, 60, 58);
  ctx.quadraticCurveTo(20, 55, 0, 45);
  ctx.closePath();
  ctx.fill();

  // ---- TEETH (upper row) ----
  ctx.shadowBlur = 4;
  ctx.shadowColor = "#ffffff";
  ctx.fillStyle = "#e8e0d0";
  for (let i = 0; i < 7; i++) {
    const tx = 45 + i * 12;
    const ty = 35 + (i % 2) * 5;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + 4, ty + 14);
    ctx.lineTo(tx + 8, ty + 2);
    ctx.closePath();
    ctx.fill();
  }

  // ---- TEETH (lower row) ----
  for (let i = 0; i < 5; i++) {
    const tx = 55 + i * 11;
    const ty = 55 - (i % 2) * 4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + 3, ty - 10);
    ctx.lineTo(tx + 6, ty + 1);
    ctx.closePath();
    ctx.fill();
  }

  // ---- EYES (glowing demonic) ----
  ctx.shadowBlur = 25 * eyeGlow;
  ctx.shadowColor = "#ffcc00";
  ctx.fillStyle = "#ffaa00";
  // Eye sockets (larger)
  ctx.beginPath();
  ctx.ellipse(30, -50, 18, 14, 0.15, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(75, -55, 14, 10, 0.1, 0, TAU);
  ctx.fill();
  // Pupils (vertical cat-like slits)
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#ff0000";
  ctx.fillStyle = "#110000";
  ctx.beginPath();
  ctx.ellipse(33, -50, 3.5, 12, 0.15, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(77, -55, 2.5, 8, 0.1, 0, TAU);
  ctx.fill();
  // Eye highlight glint
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(35, -54, 2.5, 0, TAU); ctx.fill();
  ctx.beginPath();
  ctx.arc(79, -58, 1.8, 0, TAU); ctx.fill();

  // ---- Forehead ridge / brow ----
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#551100";
  ctx.fillStyle = "#3a1510";
  ctx.beginPath();
  ctx.moveTo(10, -75);
  ctx.quadraticCurveTo(50, -95, 100, -70);
  ctx.quadraticCurveTo(80, -60, 40, -65);
  ctx.closePath();
  ctx.fill();

  // ---- Horns (swept back, much larger) ----
  ctx.shadowBlur = 15;
  ctx.shadowColor = "#883311";
  ctx.strokeStyle = "#4a2818";
  ctx.fillStyle = "#4a2818";
  ctx.lineWidth = 6;
  // Main left horn
  ctx.beginPath();
  ctx.moveTo(5, -80);
  ctx.quadraticCurveTo(-40, -160, -30, -260);
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-30, -260, 7, 0, TAU); ctx.fill();
  // Branch offshoot
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-20, -180);
  ctx.quadraticCurveTo(-60, -220, -70, -190);
  ctx.stroke();
  // Main right horn
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(70, -85);
  ctx.quadraticCurveTo(110, -170, 130, -240);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(130, -240, 6, 0, TAU); ctx.fill();
  // Branch offshoot
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(100, -160);
  ctx.quadraticCurveTo(150, -200, 155, -170);
  ctx.stroke();

  // ---- Nostril slits ----
  ctx.shadowBlur = 6;
  ctx.shadowColor = "#ff3300";
  ctx.fillStyle = "#1a0300";
  ctx.beginPath();
  ctx.ellipse(120, 20, 5, 3, 0.2, 0, TAU); ctx.fill();
  ctx.beginPath();
  ctx.ellipse(128, 18, 4, 2.5, 0.2, 0, TAU); ctx.fill();

  // ---- Scales on neck and jaw ----
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 60, 20, 0.35)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const sy = -60 + i * 18;
    for (let j = 0; j < 4; j++) {
      const sx = -55 + j * 30 + (i % 2) * 15;
      ctx.beginPath();
      ctx.arc(sx, sy + 80, 7, 0, Math.PI);
      ctx.stroke();
    }
  }

  // ---- Scattered glowing embers floating off the dragon ----
  const emberPhase = (time * 0.003) % 1;
  ctx.shadowBlur = 8;
  for (let i = 0; i < 8; i++) {
    const eph = (emberPhase + i / 8) % 1;
    const ex = -20 + i * 15 + eph * 30;
    const ey = -30 + Math.sin(eph * Math.PI * 3 + i) * 25 + eph * 80;
    const er = 3 + eph * 4;
    ctx.shadowColor = `rgba(255, ${80 + i * 20}, 0, ${1 - eph})`;
    ctx.fillStyle = `rgba(255, ${80 + i * 20}, 0, ${1 - eph})`;
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, TAU);
    ctx.fill();
  }

  // ---- Occasional continuous fire breath from nostrils ----
  if (breathe > 0.3) {
    ctx.shadowBlur = 20 + breathe * 15;
    ctx.shadowColor = "#ff4400";
    const fGrad = ctx.createRadialGradient(124, 19, 2, 124, 19, 40 + breathe * 30);
    fGrad.addColorStop(0, `rgba(255, 240, 100, ${0.8})`);
    fGrad.addColorStop(0.3, `rgba(255, 120, 20, ${0.5})`);
    fGrad.addColorStop(1, "rgba(200, 0, 0, 0)");
    ctx.fillStyle = fGrad;
    ctx.beginPath();
    ctx.moveTo(120, 15);
    ctx.quadraticCurveTo(170, 10, 210 + breathe * 40, 30 + Math.sin(time * 0.01) * 15);
    ctx.quadraticCurveTo(180, 35, 125, 25);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawSpeedLinesViewport(ctx, left, top, width, height, time) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  const cx = left + width / 2, cy = top + height / 2;
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * TAU + (time * 0.001);
    const r1 = 150 + ((time * 0.5 + i * 50) % 120);
    const r2 = r1 + 50;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
    ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   THREE.JS 3D RENDERER
   ============================================================ */
const THREE_STATE = {
  loaded: false,
  loading: false,
  renderer: null,
  scene: null,
  camera: null,
  trackMesh: null,
  trackGroup: null,
  groundMesh: null,
  skyMesh: null,
  starField: null,
  kartModels: new Map(),
  itemMeshes: [],
  coinMeshes: [],
  boostPadMeshes: [],
  hazardMeshes: new Map(),
  movingObjectMeshes: [],
  dragonModel: null,
  dragonEscapeModel: null,
  particles3d: [],
  camSmooth: { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 },
  // Visual enhancements
  nameTagSprites: new Map(),
  speechBubbleSprites: new Map(),
  particles3dSystem: null,
  skidMarks3d: [],
  spectatorMeshes: [],
  startLineMesh: null,
  edgeGlowLines: [],
  pillarRings: [],
  arenaMarkerPanelMesh: null,
  arenaMarkerCapMesh: null,
};

const ENABLE_3D_SHADOWS = new URLSearchParams(window.location.search).has("shadows3d");
const ENABLE_DECORATIVE_3D_LIGHTS = new URLSearchParams(window.location.search).has("lights3d");
const ENABLE_3D_PROFILE = new URLSearchParams(window.location.search).has("profile3d");

const canvas3d = document.getElementById("game3d");
const hudCanvas = document.getElementById("hud-overlay");
const hudCtx = hudCanvas ? hudCanvas.getContext("2d") : null;
const view2dBtn = document.getElementById("view-2d-btn");
const view3dBtn = document.getElementById("view-3d-btn");
const timeDayBtn = document.getElementById("time-day-btn");
const timeNightBtn = document.getElementById("time-night-btn");


function apply3DMapTheme() {
  if (!window.THREE || !THREE_STATE.scene || !THREE_STATE.renderer) return;
  const T = window.THREE;
  const mapId = MAPS[game.selectedMapIdx || 0].id;
  const baseTheme = MAP_3D_THEMES[mapId] || MAP_3D_THEMES.core_mainframe;
  const day = isDayMode();
  const isArenaDay = day && !!MAPS[game.selectedMapIdx || 0].arena;
  const theme = {
    ...baseTheme,
    sky: day && baseTheme.skyDay ? baseTheme.skyDay : baseTheme.sky,
    fog: day && baseTheme.fogDay ? baseTheme.fogDay : baseTheme.fog,
    ground: day && baseTheme.groundDay ? baseTheme.groundDay : baseTheme.ground,
    groundAccent: day && baseTheme.groundAccentDay ? baseTheme.groundAccentDay : baseTheme.groundAccent,
    clearColor: day && baseTheme.clearColorDay ? baseTheme.clearColorDay : baseTheme.clearColor,
    gridColor: day && baseTheme.gridColorDay ? baseTheme.gridColorDay : baseTheme.gridColor,
    gridSecondary: day && baseTheme.gridSecondaryDay ? baseTheme.gridSecondaryDay : baseTheme.gridSecondary,
    isDay: day,
  };

  THREE_STATE.renderer.setClearColor(theme.clearColor);
  THREE_STATE.renderer.toneMappingExposure = isArenaDay ? 0.9 : 1.15;
  THREE_STATE.scene.fog = new T.FogExp2(theme.fog[0], theme.fog[1]);

  if (THREE_STATE.starField) THREE_STATE.starField.visible = !day;

  // Daylight lighting tweaks
  if (THREE_STATE.dirLight) {
    if (day) {
      THREE_STATE.dirLight.color.setHex(isArenaDay ? 0xfff4e8 : 0xfff0d0);
      THREE_STATE.dirLight.intensity = isArenaDay ? 1.05 : 1.35;
    } else {
      THREE_STATE.dirLight.color.setHex(0x9999ff);
      THREE_STATE.dirLight.intensity = 0.9;
    }
  }
  THREE_STATE.scene.traverse((child) => {
    if (child.isHemisphereLight) {
      if (day) {
        child.color.setHex(isArenaDay ? 0x8fc7ef : 0xb8d4ff);
        child.groundColor.setHex(isArenaDay ? 0x78a977 : 0x8ab878);
        child.intensity = isArenaDay ? 0.75 : 1.1;
      } else {
        child.color.setHex(0x2a1860);
        child.groundColor.setHex(0x0a2f12);
        child.intensity = 0.8;
      }
    }
    if (child.isAmbientLight) {
      child.intensity = day ? (isArenaDay ? 0.28 : 0.55) : 0.35;
      child.color.setHex(day ? (isArenaDay ? 0xd8e7f0 : 0xf0f4ff) : 0x1a1040);
    }
  });
  if (THREE_STATE.playerLight) THREE_STATE.playerLight.intensity = isArenaDay ? 0.35 : 0.9;
  if (THREE_STATE.backLight) THREE_STATE.backLight.intensity = isArenaDay ? 0.18 : 0.35;
  if (THREE_STATE.rimLight) THREE_STATE.rimLight.intensity = isArenaDay ? 0.18 : 0.3;

  // Update sky dome texture
  THREE_STATE.scene.traverse(child => {
    if (child.geometry && child.geometry.type === "SphereGeometry" &&
        child.material && child.material.side === T.BackSide && child.material.map) {
      const c = document.createElement("canvas");
      c.width = 1; c.height = 256;
      const cx = c.getContext("2d");
      const grad = cx.createLinearGradient(0, 0, 0, 256);
      const stops = theme.sky;
      for (let i = 0; i < stops.length; i++) {
        grad.addColorStop(i / (stops.length - 1), stops[i]);
      }
      cx.fillStyle = grad;
      cx.fillRect(0, 0, 1, 256);
      child.material.map.image = c;
      child.material.map.needsUpdate = true;
      child.material.toneMapped = !(isArenaDay || (day && !MAPS[game.selectedMapIdx || 0].arena));
      child.material.needsUpdate = true;
    }
  });

  // Update ground texture
  if (THREE_STATE.groundMesh && THREE_STATE.groundMesh.material) {
    const gMat = THREE_STATE.groundMesh.material;
    gMat.color.set(theme.ground);
    if (gMat.map) {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 512;
      const cx = c.getContext("2d");
      const gGrad = cx.createRadialGradient(256, 256, 0, 256, 256, 360);
      gGrad.addColorStop(0, theme.groundAccent);
      gGrad.addColorStop(0.5, theme.ground);
      gGrad.addColorStop(1, theme.ground);
      cx.fillStyle = gGrad;
      cx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 2000; i++) {
        const col = new T.Color(theme.groundAccent);
        cx.fillStyle = `rgba(${Math.floor(col.r * 255)}, ${Math.floor(col.g * 255)}, ${Math.floor(col.b * 255)}, ${0.1 + Math.random() * 0.15})`;
        cx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
      gMat.map.image = c;
      gMat.map.needsUpdate = true;
    }
  }

  // Update grid colors
  THREE_STATE.scene.traverse(child => {
    if (child.isGridHelper) {
      child.material.color.set(theme.gridColor);
      child.material.opacity = 0.18;
    }
  });

  // Build distant scenery per map theme
  build3DScenery(theme);
}

function build3DScenery(theme) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  // Remove old scenery
  if (THREE_STATE._sceneryGroup) {
    THREE_STATE.scene.remove(THREE_STATE._sceneryGroup);
    dispose3DObject(THREE_STATE._sceneryGroup);
  }
  const sg = new T.Group();
  THREE_STATE._sceneryGroup = sg;
  THREE_STATE.scene.add(sg);

  // Fixed arena boundary markers replace random generic pillars and keep chase sightlines clear.
  if (game.track?.arenaFloor) return;

  const cx = WORLD_W / 2, cz = WORLD_H / 2;
  const mapRadius = Math.max(WORLD_W, WORLD_H) * 0.7;
  const day = !!theme.isDay;
  const sceneryOpacity = day ? 0.08 : 0.12;
  const sceneryGlowOpacity = day ? 0.14 : 0.25;

  if (theme.scenery === "cyber" || theme.scenery === "dragon") {
    // Distant holographic towers / data pillars
    const towerMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: sceneryOpacity });
    const towerGlowMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: sceneryGlowOpacity });
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * TAU + Math.random() * 0.3;
      const r = mapRadius + 200 + Math.random() * 600;
      const h = 200 + Math.random() * 400;
      const w = 15 + Math.random() * 30;
      const tower = new T.Mesh(new T.BoxGeometry(w, h, w), towerMat);
      tower.position.set(cx + Math.cos(ang) * r, h / 2, cz + Math.sin(ang) * r);
      sg.add(tower);
      // Glow cap
      const cap = new T.Mesh(new T.SphereGeometry(w * 0.4, 6, 4), towerGlowMat);
      cap.position.set(cx + Math.cos(ang) * r, h + w * 0.2, cz + Math.sin(ang) * r);
      sg.add(cap);
    }
  }

  if (theme.scenery === "ice") {
    // Icy crystal spires
    const iceMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: day ? 0.06 : 0.08 });
    const iceGlowMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: day ? 0.12 : 0.2 });
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * TAU + Math.random() * 0.3;
      const r = mapRadius + 100 + Math.random() * 800;
      const h = 150 + Math.random() * 350;
      const w = 8 + Math.random() * 20;
      const spire = new T.Mesh(new T.ConeGeometry(w, h, 5), iceMat);
      spire.position.set(cx + Math.cos(ang) * r, h / 2, cz + Math.sin(ang) * r);
      spire.rotation.z = (Math.random() - 0.5) * 0.15;
      sg.add(spire);
      const glow = new T.Mesh(new T.OctahedronGeometry(w * 0.5), iceGlowMat);
      glow.position.set(cx + Math.cos(ang) * r, h, cz + Math.sin(ang) * r);
      sg.add(glow);
    }
  }

  if (theme.scenery === "japanese") {
    // Distant mountain silhouettes
    const mtMat = new T.MeshBasicMaterial({
      color: day ? 0x6a9a7a : 0x1a0808,
      transparent: true,
      opacity: day ? 0.12 : 0.15,
    });
    for (let i = 0; i < 12; i++) {
      const x = WORLD_W * (i / 12) + Math.random() * 2000;
      const h = 300 + Math.random() * 500;
      const w = 400 + Math.random() * 600;
      const mt = new T.Mesh(new T.ConeGeometry(w, h, 4), mtMat);
      mt.position.set(x, h / 2, cz + mapRadius + 200 + Math.random() * 400);
      sg.add(mt);
      const mt2 = mt.clone();
      mt2.position.z = cz - mapRadius - 200 - Math.random() * 400;
      sg.add(mt2);
    }
    // Torii gate silhouettes
    const toriiMat = new T.MeshBasicMaterial({
      color: day ? 0xbb3333 : 0x661111,
      transparent: true,
      opacity: day ? 0.28 : 0.2,
    });
    for (let i = 0; i < 6; i++) {
      const x = WORLD_W * (i / 6) + 1000 + Math.random() * 2000;
      const z = (Math.random() > 0.5 ? 1 : -1) * (mapRadius + 150 + Math.random() * 200) + cz;
      const g = new T.Group();
      // Posts
      for (const s of [-1, 1]) {
        const post = new T.Mesh(new T.CylinderGeometry(5, 6, 120, 6), toriiMat);
        post.position.set(s * 35, 60, 0);
        g.add(post);
      }
      // Top beams
      g.add(new T.Mesh(new T.BoxGeometry(90, 6, 8), toriiMat)).position.y = 115;
      g.add(new T.Mesh(new T.BoxGeometry(80, 4, 6), toriiMat)).position.y = 100;
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * TAU;
      sg.add(g);
    }
  }
}

function loadThreeJS(callback) {
  if (window.THREE) { callback(); return; }
  if (THREE_STATE.loading) return;
  THREE_STATE.loading = true;
  const script = document.createElement("script");
  script.src = "three.min.js";
  script.onload = () => { THREE_STATE.loaded = true; callback(); };
  script.onerror = () => { alert("Could not load Three.js"); THREE_STATE.loading = false; };
  document.head.appendChild(script);
}

function setViewMode(mode) {
  game.viewMode = mode;
  saveGameSettings({ viewMode: mode });
  const is3d = mode === "3d";
  canvas.style.display = is3d ? "none" : "block";
  canvas3d.style.display = is3d ? "block" : "none";
  if (hudCanvas) hudCanvas.style.display = is3d ? "block" : "none";
  if (view2dBtn) view2dBtn.classList.toggle("active", !is3d);
  if (view3dBtn) view3dBtn.classList.toggle("active", is3d);
  if (is3d) {
    loadThreeJS(() => {
      if (!THREE_STATE.renderer) init3DScene();
      rebuild3DTrack();
    });
  }
}

if (view2dBtn) view2dBtn.addEventListener("click", () => setViewMode("2d"));
if (view3dBtn) view3dBtn.addEventListener("click", () => { loadThreeJS(() => setViewMode("3d")); });
if (timeDayBtn) timeDayBtn.addEventListener("click", () => { Sound.ensure(); Sound.resume(); setTimeOfDay("day"); Sound.tone(520, 0.06, "sine", 0.1); });
if (timeNightBtn) timeNightBtn.addEventListener("click", () => { Sound.ensure(); Sound.resume(); setTimeOfDay("night"); Sound.tone(320, 0.06, "sine", 0.1); });

function init3DScene() {
  if (!window.THREE || THREE_STATE.renderer) return;
  const T = window.THREE;

  THREE_STATE.renderer = new T.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: false });
  THREE_STATE.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  THREE_STATE.renderer.setSize(VIEW_W, VIEW_H);
  THREE_STATE.renderer.setClearColor(0x060514);
  THREE_STATE.renderer.toneMapping = T.ACESFilmicToneMapping;
  THREE_STATE.renderer.toneMappingExposure = 1.15;
  THREE_STATE.renderer.shadowMap.enabled = ENABLE_3D_SHADOWS;
  THREE_STATE.renderer.shadowMap.type = T.PCFSoftShadowMap;

  THREE_STATE.scene = new T.Scene();
  THREE_STATE.scene.fog = new T.FogExp2(0x060514, 0.0004);

  THREE_STATE.camera = new T.PerspectiveCamera(70, VIEW_W / VIEW_H, 1, 8000);
  THREE_STATE.camera.position.set(0, 120, -200);

  const hemiLight = new T.HemisphereLight(0x2a1860, 0x0a2f12, 0.8);
  THREE_STATE.scene.add(hemiLight);
  const ambient = new T.AmbientLight(0x1a1040, 0.35);
  THREE_STATE.scene.add(ambient);
  const dirLight = new T.DirectionalLight(0x9999ff, 0.9);
  dirLight.position.set(300, 600, -300);
  dirLight.castShadow = ENABLE_3D_SHADOWS;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 2000;
  dirLight.shadow.camera.left = -600;
  dirLight.shadow.camera.right = 600;
  dirLight.shadow.camera.top = 600;
  dirLight.shadow.camera.bottom = -600;
  dirLight.shadow.bias = -0.002;
  THREE_STATE.scene.add(dirLight);
  THREE_STATE.scene.add(dirLight.target);
  THREE_STATE.dirLight = dirLight;
  const pointLight = new T.PointLight(0x57f2ff, 0.9, 3000);
  pointLight.position.set(0, 200, 0);
  THREE_STATE.scene.add(pointLight);
  THREE_STATE.playerLight = pointLight;
  const backLight = new T.PointLight(0xff4d6d, 0.35, 1800);
  backLight.position.set(0, 100, 0);
  THREE_STATE.scene.add(backLight);
  THREE_STATE.backLight = backLight;
  const rimLight = new T.PointLight(0xfd9927, 0.3, 2000);
  rimLight.position.set(-200, 150, 200);
  THREE_STATE.scene.add(rimLight);
  THREE_STATE.rimLight = rimLight;

  // Ground plane with procedural texture
  const groundGeo = new T.PlaneGeometry(12000, 12000, 64, 64);
  const groundCanvas = document.createElement("canvas");
  groundCanvas.width = 512; groundCanvas.height = 512;
  const gCtx = groundCanvas.getContext("2d");
  const gGrad = gCtx.createRadialGradient(256, 256, 0, 256, 256, 360);
  gGrad.addColorStop(0, "#0e2a12");
  gGrad.addColorStop(0.5, "#0a1f0d");
  gGrad.addColorStop(1, "#061208");
  gCtx.fillStyle = gGrad;
  gCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3000; i++) {
    gCtx.fillStyle = `rgba(${20 + Math.random() * 30}, ${40 + Math.random() * 50}, ${15 + Math.random() * 20}, ${0.15 + Math.random() * 0.2})`;
    const gx = Math.random() * 512, gy = Math.random() * 512;
    gCtx.fillRect(gx, gy, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const groundTex = new T.CanvasTexture(groundCanvas);
  groundTex.wrapS = T.RepeatWrapping; groundTex.wrapT = T.RepeatWrapping;
  groundTex.repeat.set(40, 40);
  const groundMat = new T.MeshStandardMaterial({
    map: groundTex,
    color: 0x0a1f0d,
    roughness: 0.85,
    metalness: 0.15,
  });
  const ground = new T.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  ground.receiveShadow = true;
  THREE_STATE.scene.add(ground);
  THREE_STATE.groundMesh = ground;

  // Grid helper for cyberpunk feel
  const gridSize = 10000;
  const gridDiv = 100;
  const grid = new T.GridHelper(gridSize, gridDiv, 0x7b75ff, 0x1a1040);
  grid.position.y = -0.5;
  grid.material.opacity = 0.22;
  grid.material.transparent = true;
  THREE_STATE.scene.add(grid);

  // Gradient sky dome
  const skyGeo = new T.SphereGeometry(5000, 32, 24);
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 1; skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext("2d");
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, "#0a0820");
  skyGrad.addColorStop(0.3, "#0e0630");
  skyGrad.addColorStop(0.55, "#180a40");
  skyGrad.addColorStop(0.75, "#0d1a28");
  skyGrad.addColorStop(1, "#060514");
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 1, 256);
  const skyTex = new T.CanvasTexture(skyCanvas);
  const skyMat = new T.MeshBasicMaterial({ map: skyTex, side: T.BackSide });
  const skyMesh = new T.Mesh(skyGeo, skyMat);
  THREE_STATE.scene.add(skyMesh);
  THREE_STATE.skyMesh = skyMesh;

  // Stars with size variation and color tints
  const starVerts = [];
  const starColors = [];
  const starSizes = [];
  for (let i = 0; i < 2000; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 4500 + Math.random() * 400;
    starVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    const tint = Math.random();
    if (tint < 0.1) starColors.push(0.7, 0.75, 1.0);
    else if (tint < 0.15) starColors.push(1.0, 0.85, 0.6);
    else if (tint < 0.2) starColors.push(0.9, 0.6, 1.0);
    else starColors.push(0.93, 0.93, 1.0);
    starSizes.push(1.5 + Math.random() * 4);
  }
  const starGeo = new T.BufferGeometry();
  starGeo.setAttribute("position", new T.Float32BufferAttribute(starVerts, 3));
  starGeo.setAttribute("color", new T.Float32BufferAttribute(starColors, 3));
  starGeo.setAttribute("size", new T.Float32BufferAttribute(starSizes, 1));
  const starMat = new T.PointsMaterial({ size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.8, vertexColors: true });
  const starField = new T.Points(starGeo, starMat);
  THREE_STATE.scene.add(starField);
  THREE_STATE.starField = starField;

  // HUD overlay canvas
  if (hudCanvas) {
    hudCanvas.width = Math.floor(VIEW_W * DPR);
    hudCanvas.height = Math.floor(VIEW_H * DPR);
    hudCanvas.style.width = VIEW_W + "px";
    hudCanvas.style.height = VIEW_H + "px";
    if (hudCtx) hudCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener("resize", () => {
    if (THREE_STATE.renderer) {
      THREE_STATE.renderer.setSize(VIEW_W, VIEW_H);
      THREE_STATE.camera.aspect = VIEW_W / VIEW_H;
      THREE_STATE.camera.updateProjectionMatrix();
      if (hudCanvas) {
        hudCanvas.width = Math.floor(VIEW_W * DPR);
        hudCanvas.height = Math.floor(VIEW_H * DPR);
        hudCanvas.style.width = VIEW_W + "px";
        hudCanvas.style.height = VIEW_H + "px";
        if (hudCtx) hudCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      }
    }
  });
}

function dispose3DObject(obj) {
  if (!obj) return;
  obj.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
      else child.material.dispose?.();
    }
  });
}

// Small, cached procedural textures add surface detail without extra geometry or per-frame work.
// Material disposal intentionally leaves these shared CanvasTextures alive for later map rebuilds.
const _compassSurfaceTexture3DCache = new Map();
function getCompassSurfaceTexture3D(T, surface, day) {
  const key = `${day ? "day" : "night"}:${surface}`;
  if (_compassSurfaceTexture3DCache.has(key)) return _compassSurfaceTexture3DCache.get(key);

  const size = 256;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const c = tile.getContext("2d");
  if (surface === "arena") {
    c.fillStyle = day ? "#acc5b1" : "#1b1726";
    c.fillRect(0, 0, size, size);
    c.strokeStyle = day ? "rgba(79,72,112,0.13)" : "rgba(235,228,255,0.06)";
    c.lineWidth = 1;
    c.beginPath();
    for (let p = 32; p < size; p += 32) {
      c.moveTo(p + 0.5, 0); c.lineTo(p + 0.5, size);
      c.moveTo(0, p + 0.5); c.lineTo(size, p + 0.5);
    }
    c.stroke();
    c.strokeStyle = day ? "rgba(123,117,255,0.34)" : "rgba(139,133,255,0.18)";
    c.lineWidth = 2;
    c.strokeRect(1, 1, size - 2, size - 2);
    c.fillStyle = day ? "rgba(253,153,39,0.55)" : "rgba(253,153,39,0.3)";
    c.fillRect(9, 9, 24, 4);
    c.fillRect(9, 9, 4, 24);
    c.fillStyle = day ? "rgba(164,255,128,0.6)" : "rgba(164,255,128,0.26)";
    c.beginPath(); c.arc(size / 2, size / 2, 4, 0, TAU); c.fill();
  } else {
    c.fillStyle = day ? "#211c30" : "#15121f";
    c.fillRect(0, 0, size, size);
    c.strokeStyle = day ? "rgba(235,228,255,0.1)" : "rgba(139,133,255,0.08)";
    c.lineWidth = 1;
    c.beginPath();
    for (let p = 32; p < size; p += 64) {
      c.moveTo(0, p + 0.5); c.lineTo(size, p + 0.5);
    }
    c.stroke();
    c.strokeStyle = day ? "rgba(123,117,255,0.28)" : "rgba(79,72,112,0.32)";
    c.setLineDash([20, 28]);
    c.beginPath(); c.moveTo(0, size / 2 + 0.5); c.lineTo(size, size / 2 + 0.5); c.stroke();
    c.setLineDash([]);
    c.fillStyle = day ? "rgba(253,153,39,0.28)" : "rgba(253,153,39,0.16)";
    for (let i = 0; i < 8; i++) c.fillRect(18 + i * 29, 18 + ((i * 37) % 210), 3, 3);
  }

  const texture = new T.CanvasTexture(tile);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  if (T.SRGBColorSpace) texture.colorSpace = T.SRGBColorSpace;
  if (THREE_STATE.renderer?.capabilities) {
    texture.anisotropy = Math.min(4, THREE_STATE.renderer.capabilities.getMaxAnisotropy());
  }
  texture.needsUpdate = true;
  _compassSurfaceTexture3DCache.set(key, texture);
  return texture;
}

function get3DRoadEdges(track) {
  const wp = track.waypoints;
  const edges = [];
  const closed = !track.isOpen;
  const n = wp.length;
  for (let i = 0; i < n; i++) {
    const segNext = track.segments[i] || track.segments[track.segments.length - 1];
    const segPrev = track.segments[(i - 1 + track.segments.length) % track.segments.length] || segNext;
    if (!segNext) continue;
    let nx, ny;
    if (!closed && i === 0) {
      nx = segNext.nx; ny = segNext.ny;
    } else if (!closed && i === n - 1) {
      nx = segPrev.nx; ny = segPrev.ny;
    } else {
      nx = segPrev.nx + segNext.nx;
      ny = segPrev.ny + segNext.ny;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
    }
    const baseW = ((segPrev.halfW || track.halfWidth) + (segNext.halfW || track.halfWidth)) * 0.5;
    const denom = Math.max(0.35, Math.abs(nx * segNext.nx + ny * segNext.ny));
    const w = Math.min(baseW / denom, baseW * 1.8);
    const p = wp[i];
    edges.push({
      left: { x: p.x + nx * w, y: p.y + ny * w },
      right: { x: p.x - nx * w, y: p.y - ny * w },
      center: p,
    });
  }
  return edges;
}

function build3DArenaFloor(group, track) {
  if (!window.THREE || !track?.arenaFloor) return;
  const T = window.THREE;
  const floor = track.arenaFloor;
  const day = isDayMode();
  const floorTexture = getCompassSurfaceTexture3D(T, "arena", day);
  floorTexture.repeat.set(
    Math.max(4, floor.rx / 160),
    Math.max(4, floor.ry / 160)
  );
  const floorGeo = new T.CircleGeometry(floor.rx, 72);
  floorGeo.scale(1, 1, floor.ry / floor.rx);
  const floorMat = new T.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTexture,
    roughness: 0.9,
    metalness: 0.03,
    emissive: day ? 0x000000 : 0x131019,
    emissiveIntensity: day ? 0 : 0.1,
  });
  const floorMesh = new T.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  // Keep the daylight road ribbon above the arena floor instead of z-fighting with it.
  floorMesh.position.set(floor.cx, day ? 0.1 : 0.5, floor.cy);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  THREE_STATE.arenaFloorMesh = floorMesh;

  const ringGeo = new T.RingGeometry(floor.rx - 8, floor.rx + 2, 96);
  ringGeo.scale(1, 1, floor.ry / floor.rx);
  const ringMat = new T.MeshStandardMaterial({
    color: day ? 0x7b75ff : 0x8b85ff,
    emissive: day ? 0x2a2860 : 0x1a1840,
    emissiveIntensity: day ? 0.12 : 0.45,
    transparent: true,
    opacity: 0.85,
    side: T.DoubleSide,
  });
  const ringMesh = new T.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(floor.cx, 0.65, floor.cy);
  group.add(ringMesh);

  const innerRingGeo = new T.RingGeometry(floor.rx * 0.52, floor.rx * 0.55, 64);
  innerRingGeo.scale(1, 1, floor.ry / floor.rx);
  const innerRingMat = new T.MeshStandardMaterial({
    color: day ? 0xa4ff80 : 0x4f4870,
    emissive: day ? 0x10220c : 0x131019,
    emissiveIntensity: day ? 0.08 : 0.25,
    transparent: true,
    opacity: 0.45,
    side: T.DoubleSide,
  });
  const innerRing = new T.Mesh(innerRingGeo, innerRingMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.set(floor.cx, 0.62, floor.cy);
  group.add(innerRing);

  if (track.reviewPlatformRadius > 0) {
    const platGeo = new T.CylinderGeometry(track.reviewPlatformRadius, track.reviewPlatformRadius, 1.5, 48);
    const platMat = new T.MeshStandardMaterial({
      color: day ? 0xb3d9aa : 0x1b1726,
      emissive: day ? 0x10220c : 0x7b75ff,
      emissiveIntensity: day ? 0.05 : 0.2,
      roughness: 0.5,
      metalness: 0.35,
    });
    const plat = new T.Mesh(platGeo, platMat);
    plat.position.set(floor.cx, 0.75, floor.cy);
    plat.receiveShadow = true;
    group.add(plat);
    THREE_STATE.reviewPlatformMesh = plat;
  }
}

function build3DArenaBoundaryMarkers(group, track) {
  if (!window.THREE || !track?.arenaBoundaryLandmarks?.length) return;
  const T = window.THREE;
  const day = isDayMode();
  const landmarks = track.arenaBoundaryLandmarks;
  const panelGeo = new T.BoxGeometry(14, 18, 1.2);
  const capGeo = new T.BoxGeometry(16, 2.5, 1.6);
  const panelMat = new T.MeshStandardMaterial({
    color: day ? 0x1b1726 : 0x131019,
    emissive: day ? 0x2a2860 : 0x0a0818,
    emissiveIntensity: day ? 0.06 : 0.25,
    roughness: 0.55,
    metalness: 0.35,
  });
  const capMat = new T.MeshStandardMaterial({
    color: 0xfd9927,
    emissive: 0x442208,
    emissiveIntensity: day ? 0.12 : 0.45,
    roughness: 0.4,
    metalness: 0.5,
  });
  const panelMesh = new T.InstancedMesh(panelGeo, panelMat, landmarks.length);
  const capMesh = new T.InstancedMesh(capGeo, capMat, landmarks.length);
  const m4 = new T.Matrix4();
  const q = new T.Quaternion();
  const pos = new T.Vector3();
  const scl = new T.Vector3(1, 1, 1);
  const up = new T.Vector3(0, 1, 0);
  landmarks.forEach((lm, i) => {
    q.setFromAxisAngle(up, -lm.ang);
    pos.set(lm.x, 9, lm.y);
    m4.compose(pos, q, scl);
    panelMesh.setMatrixAt(i, m4);
    pos.set(lm.x, 19, lm.y);
    m4.compose(pos, q, scl);
    capMesh.setMatrixAt(i, m4);
  });
  panelMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
  group.add(panelMesh);
  group.add(capMesh);
  THREE_STATE.arenaMarkerPanelMesh = panelMesh;
  THREE_STATE.arenaMarkerCapMesh = capMesh;
}

function buildRampWedgeGeometry3D(T, length, width, height) {
  const l = length * 0.5;
  const w = width * 0.5;
  const positions = [
    -l, 0, -w,  -l, 0, w,   l, 0, w,   l, 0, -w,
    -l, 0.4, -w, -l, 0.4, w, l, height, w, l, height, -w,
  ];
  const indices = [
    4, 5, 6, 4, 6, 7, // sloped driving surface
    0, 2, 1, 0, 3, 2, // underside
    0, 4, 7, 0, 7, 3, // side
    1, 2, 6, 1, 6, 5, // side
    0, 1, 5, 0, 5, 4, // entry
    3, 7, 6, 3, 6, 2, // launch lip
  ];
  const colors = [
    0.08, 0.07, 0.12, 0.08, 0.07, 0.12, 0.18, 0.11, 0.04, 0.18, 0.11, 0.04,
    0.24, 0.22, 0.42, 0.24, 0.22, 0.42, 0.99, 0.60, 0.15, 0.99, 0.60, 0.15,
  ];
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildRoundedBumpGeometry3D(T, length, width, height, segments = 6) {
  const positions = [];
  const colors = [];
  const indices = [];
  const l = length * 0.5;
  const w = width * 0.5;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = lerp(-l, l, t);
    const y = 0.3 + Math.sin(t * Math.PI) * height;
    const glow = 0.72 + Math.sin(t * Math.PI) * 0.28;
    // top left/right, then matching bottom left/right
    positions.push(x, y, -w, x, y, w, x, 0, -w, x, 0, w);
    colors.push(
      glow, 0.42 * glow, 0.08, glow, 0.42 * glow, 0.08,
      0.28, 0.14, 0.04, 0.28, 0.14, 0.04
    );
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    indices.push(
      a, b, b + 1, a, b + 1, a + 1,         // curved top
      a + 2, a + 3, b + 3, a + 2, b + 3, b + 2, // bottom
      a, a + 2, b + 2, a, b + 2, b,         // left side
      a + 1, b + 1, b + 3, a + 1, b + 3, a + 3 // right side
    );
  }
  const end = segments * 4;
  indices.push(0, 1, 3, 0, 3, 2, end, end + 2, end + 3, end, end + 3, end + 1);
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function build3DRamps(group, track) {
  if (!window.THREE || !track?.ramps?.length) return;
  const T = window.THREE;
  const day = isDayMode();
  for (const ramp of track.ramps) {
    let mesh;
    if (ramp.kind === "bump") {
      const bumpHeight = clamp(ramp.h * 0.2, 3.5, 5);
      const geo = buildRoundedBumpGeometry3D(T, ramp.w, ramp.h, bumpHeight);
      const mat = new T.MeshStandardMaterial({
        vertexColors: true,
        emissive: 0x442208,
        emissiveIntensity: day ? 0.06 : 0.24,
        roughness: 0.72,
        metalness: 0.12,
      });
      mesh = new T.Mesh(geo, mat);
      mesh.position.set(ramp.x, 0.55, ramp.y);
      mesh.rotation.y = -ramp.ang;
      mesh.userData.rampHeight = bumpHeight;
    } else {
      const rampHeight = clamp(ramp.w * 0.09, 10, 18);
      const geo = buildRampWedgeGeometry3D(T, ramp.w, ramp.h, rampHeight);
      const mat = new T.MeshStandardMaterial({
        vertexColors: true,
        emissive: day ? 0x120c20 : 0x131019,
        emissiveIntensity: day ? 0.04 : 0.22,
        roughness: 0.58,
        metalness: 0.22,
      });
      mesh = new T.Mesh(geo, mat);
      mesh.position.set(ramp.x, 0.55, ramp.y);
      mesh.rotation.y = -ramp.ang;
      mesh.userData.rampHeight = rampHeight;
    }
    mesh.userData.rampKind = ramp.kind;
    group.add(mesh);
    THREE_STATE.rampMeshes.push(mesh);
  }
}

function rebuild3DTrack() {
  if (!window.THREE || !THREE_STATE.scene || !game.track) return;
  const T = window.THREE;
  const sc = THREE_STATE.scene;

  // Remove old track/world meshes
  if (THREE_STATE.trackGroup) {
    sc.remove(THREE_STATE.trackGroup);
    dispose3DObject(THREE_STATE.trackGroup);
    THREE_STATE.trackGroup = null;
  }
  THREE_STATE.trackMesh = null;
  THREE_STATE.arenaFloorMesh = null;
  THREE_STATE.reviewPlatformMesh = null;
  THREE_STATE.arenaMarkerPanelMesh = null;
  THREE_STATE.arenaMarkerCapMesh = null;
  THREE_STATE.rampMeshes = [];
  // Remove old kart models
  THREE_STATE.kartModels.forEach(m => {
    sc.remove(m);
    dispose3DObject(m);
  });
  THREE_STATE.kartModels.clear();
  disposeTethers3D();
  THREE_STATE.itemMeshes = [];
  THREE_STATE.coinMeshes = [];
  THREE_STATE.boostPadMeshes = [];
  THREE_STATE.movingObjectMeshes = [];
  THREE_STATE.hazardMeshes.forEach(m => { sc.remove(m); dispose3DObject(m); });
  THREE_STATE.hazardMeshes.clear();
  if (THREE_STATE.dragonModel) { sc.remove(THREE_STATE.dragonModel); dispose3DObject(THREE_STATE.dragonModel); THREE_STATE.dragonModel = null; }
  if (THREE_STATE.dragonEscapeModel) { sc.remove(THREE_STATE.dragonEscapeModel); dispose3DObject(THREE_STATE.dragonEscapeModel); THREE_STATE.dragonEscapeModel = null; }
  // Clean enhancement state
  THREE_STATE.spectatorMeshes.forEach(s => { sc.remove(s.group); dispose3DObject(s.group); });
  THREE_STATE.spectatorMeshes = [];
  if (THREE_STATE.startLineMesh) { sc.remove(THREE_STATE.startLineMesh); dispose3DObject(THREE_STATE.startLineMesh); THREE_STATE.startLineMesh = null; }
  if (THREE_STATE.particles3dSystem) { sc.remove(THREE_STATE.particles3dSystem); dispose3DObject(THREE_STATE.particles3dSystem); THREE_STATE.particles3dSystem = null; }
  _p3dPool.length = 0; _p3dCount = 0;
  THREE_STATE.pillarRings = [];
  if (THREE_STATE._sceneryGroup) { sc.remove(THREE_STATE._sceneryGroup); dispose3DObject(THREE_STATE._sceneryGroup); THREE_STATE._sceneryGroup = null; }

  const group = new T.Group();
  THREE_STATE.trackGroup = group;
  sc.add(group);
  THREE_STATE.rampMeshes = [];

  if (game.track.arenaFloor) {
    build3DArenaFloor(group, game.track);
    build3DRamps(group, game.track);
    build3DArenaBoundaryMarkers(group, game.track);
  }

  // Build track ribbon from waypoints
  const wp = game.track.waypoints;
  const verts = [];
  const colors = [];
  const roadUvs = [];
  const edges = get3DRoadEdges(game.track);
  const segmentCount = game.track.isOpen ? edges.length - 1 : edges.length;
  const roadUvScale = 1 / 192;

  for (let i = 0; i < segmentCount; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    if (!e0 || !e1) continue;

    verts.push(e0.left.x, 0, e0.left.y, e0.right.x, 0, e0.right.y, e1.left.x, 0, e1.left.y);
    verts.push(e0.right.x, 0, e0.right.y, e1.right.x, 0, e1.right.y, e1.left.x, 0, e1.left.y);
    roadUvs.push(
      e0.left.x * roadUvScale, e0.left.y * roadUvScale,
      e0.right.x * roadUvScale, e0.right.y * roadUvScale,
      e1.left.x * roadUvScale, e1.left.y * roadUvScale,
      e0.right.x * roadUvScale, e0.right.y * roadUvScale,
      e1.right.x * roadUvScale, e1.right.y * roadUvScale,
      e1.left.x * roadUvScale, e1.left.y * roadUvScale
    );

    // Edge glow coloring
    for (let v = 0; v < 6; v++) {
      colors.push(0.05, 0.04, 0.13);
    }
  }

  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(roadUvs, 2));
  geo.computeVertexNormals();

  const roadDay = isDayMode();
  const roadTexture = getCompassSurfaceTexture3D(T, "road", roadDay);
  roadTexture.repeat.set(1, 1);
  const roadMat = new T.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTexture,
    emissive: roadDay ? 0x000000 : 0x131019,
    emissiveIntensity: roadDay ? 0 : 0.12,
    roughness: 0.78,
    metalness: 0.12,
    vertexColors: false,
  });
  THREE_STATE.trackMesh = new T.Mesh(geo, roadMat);
  THREE_STATE.trackMesh.position.y = 0.5;
  THREE_STATE.trackMesh.receiveShadow = true;
  group.add(THREE_STATE.trackMesh);

  // Rumble strip (slightly wider road with alternating colors)
  const rumbleVerts = [];
  const rumbleColors = [];
  const rumbleExtra = 8;
  for (let i = 0; i < segmentCount; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    if (!e0 || !e1) continue;
    const c0 = e0.center, c1 = e1.center;
    const isEven = i % 2 === 0;
    const r = isEven ? [0.48, 0.46, 1.0] : [0.64, 1.0, 0.5];
    for (let side of [-1, 1]) {
      const s0 = side === 1 ? e0.left : e0.right;
      const s1 = side === 1 ? e1.left : e1.right;
      const dx0 = s0.x - c0.x, dy0 = s0.y - c0.y;
      const dl0 = Math.hypot(dx0, dy0) || 1;
      const dx1 = s1.x - c1.x, dy1 = s1.y - c1.y;
      const dl1 = Math.hypot(dx1, dy1) || 1;
      const o0x = s0.x + (dx0 / dl0) * rumbleExtra, o0z = s0.y + (dy0 / dl0) * rumbleExtra;
      const o1x = s1.x + (dx1 / dl1) * rumbleExtra, o1z = s1.y + (dy1 / dl1) * rumbleExtra;
      rumbleVerts.push(s0.x, 0, s0.y, o0x, 0, o0z, s1.x, 0, s1.y);
      rumbleVerts.push(o0x, 0, o0z, o1x, 0, o1z, s1.x, 0, s1.y);
      for (let v = 0; v < 6; v++) rumbleColors.push(r[0], r[1], r[2]);
    }
  }
  if (rumbleVerts.length > 0) {
    const rGeo = new T.BufferGeometry();
    rGeo.setAttribute("position", new T.Float32BufferAttribute(rumbleVerts, 3));
    rGeo.setAttribute("color", new T.Float32BufferAttribute(rumbleColors, 3));
    rGeo.computeVertexNormals();
    const rMat = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.2,
      emissive: 0x111111,
      emissiveIntensity: roadDay ? 0.08 : 0.3,
    });
    const rumble = new T.Mesh(rGeo, rMat);
    rumble.position.y = 0.3;
    group.add(rumble);
  }

  // 3D barrier walls along track edges
  const barrierH = 14;
  const barrierOffset = 6;
  for (let side = -1; side <= 1; side += 2) {
    const wallVerts = [];
    const wallColors = [];
    for (let i = 0; i < segmentCount; i++) {
      const e0 = edges[i];
      const e1 = edges[(i + 1) % edges.length];
      if (!e0 || !e1) continue;
      const c0 = e0.center, c1 = e1.center;
      const s0 = side === 1 ? e0.left : e0.right;
      const s1 = side === 1 ? e1.left : e1.right;
      const dx0 = s0.x - c0.x, dy0 = s0.y - c0.y;
      const dl0 = Math.hypot(dx0, dy0) || 1;
      const dx1 = s1.x - c1.x, dy1 = s1.y - c1.y;
      const dl1 = Math.hypot(dx1, dy1) || 1;
      const b0x = s0.x + (dx0 / dl0) * barrierOffset;
      const b0z = s0.y + (dy0 / dl0) * barrierOffset;
      const b1x = s1.x + (dx1 / dl1) * barrierOffset;
      const b1z = s1.y + (dy1 / dl1) * barrierOffset;
      // Front face of barrier (two triangles)
      wallVerts.push(b0x, 0, b0z, b1x, 0, b1z, b0x, barrierH, b0z);
      wallVerts.push(b1x, 0, b1z, b1x, barrierH, b1z, b0x, barrierH, b0z);
      // Alternating neon color stripes
      const isEven = i % 4 < 2;
      const cr = side === 1 ? (isEven ? [0.48, 0.46, 1.0] : [0.15, 0.12, 0.35]) : (isEven ? [0.99, 0.6, 0.15] : [0.15, 0.12, 0.35]);
      for (let v = 0; v < 6; v++) wallColors.push(cr[0], cr[1], cr[2]);
    }
    if (wallVerts.length > 0) {
      const wGeo = new T.BufferGeometry();
      wGeo.setAttribute("position", new T.Float32BufferAttribute(wallVerts, 3));
      wGeo.setAttribute("color", new T.Float32BufferAttribute(wallColors, 3));
      wGeo.computeVertexNormals();
      const wMat = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.6,
        emissive: side === 1 ? 0x1a1840 : 0x2a1808,
        emissiveIntensity: roadDay ? 0.12 : 0.4,
        transparent: true,
        opacity: roadDay ? 0.88 : 0.82,
      });
      const wall = new T.Mesh(wGeo, wMat);
      wall.position.y = 0.5;
      group.add(wall);
    }

    // Glowing top edge line on barrier
    const topVerts = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (!e) continue;
      const p = side === 1 ? e.left : e.right;
      const c = e.center;
      const dx = p.x - c.x, dy = p.y - c.y;
      const dl = Math.hypot(dx, dy) || 1;
      topVerts.push(p.x + (dx / dl) * barrierOffset, barrierH + 0.5, p.y + (dy / dl) * barrierOffset);
    }
    if (topVerts.length > 3) {
      const tGeo = new T.BufferGeometry();
      tGeo.setAttribute("position", new T.Float32BufferAttribute(topVerts, 3));
      const tMat = new T.LineBasicMaterial({ color: side === 1 ? 0x7b75ff : 0xfd9927, linewidth: 2 });
      group.add(game.track.isOpen ? new T.Line(tGeo, tMat) : new T.LineLoop(tGeo, tMat));
    }
  }

  // Center dashed line
  const centerVerts = [];
  for (let i = 0; i < wp.length; i++) {
    centerVerts.push(wp[i].x, 1, wp[i].y);
  }
  if (centerVerts.length > 3) {
    const centerGeo = new T.BufferGeometry();
    centerGeo.setAttribute("position", new T.Float32BufferAttribute(centerVerts, 3));
    const centerMat = new T.LineDashedMaterial({
      color: roadDay ? 0x5a54c8 : 0x7b75ff,
      dashSize: 24,
      gapSize: 32,
      linewidth: 1,
    });
    const centerLine = game.track.isOpen ? new T.Line(centerGeo, centerMat) : new T.LineLoop(centerGeo, centerMat);
    centerLine.computeLineDistances();
    group.add(centerLine);
  }

  if (!game.track.isOpen && edges.length > 1) {
    const e = edges[0];
    const archW = Math.hypot(e.left.x - e.right.x, e.left.y - e.right.y);
    const archH = 45;
    const archGroup = new T.Group();
    const archMat = new T.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffd86b, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.2 });
    const pillarGeo = new T.CylinderGeometry(2.5, 3, archH, 10);
    const lp = new T.Mesh(pillarGeo, archMat);
    lp.position.set(e.left.x, archH / 2, e.left.y);
    lp.castShadow = true;
    archGroup.add(lp);
    const rp = new T.Mesh(pillarGeo, archMat);
    rp.position.set(e.right.x, archH / 2, e.right.y);
    rp.castShadow = true;
    archGroup.add(rp);
    const beamLen = archW;
    const beamGeo = new T.BoxGeometry(beamLen, 5, 7);
    const beam = new T.Mesh(beamGeo, archMat);
    beam.position.set((e.left.x + e.right.x) / 2, archH, (e.left.y + e.right.y) / 2);
    beam.rotation.y = -Math.atan2(e.left.y - e.right.y, e.left.x - e.right.x);
    beam.castShadow = true;
    archGroup.add(beam);
    const bannerGeo = new T.PlaneGeometry(beamLen * 0.9, 10);
    const bannerMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd86b, emissiveIntensity: 0.4, side: T.DoubleSide, transparent: true, opacity: 0.9 });
    const banner = new T.Mesh(bannerGeo, bannerMat);
    banner.position.set((e.left.x + e.right.x) / 2, archH - 7, (e.left.y + e.right.y) / 2);
    banner.rotation.y = -Math.atan2(e.left.y - e.right.y, e.left.x - e.right.x);
    archGroup.add(banner);
    if (ENABLE_DECORATIVE_3D_LIGHTS) {
      const archLight = new T.PointLight(0xffd86b, 0.6, 150);
      archLight.position.set((e.left.x + e.right.x) / 2, archH + 5, (e.left.y + e.right.y) / 2);
      archGroup.add(archLight);
    }
    group.add(archGroup);
  }

  // Build kart models for all active karts
  buildAllKartModels();

  if (game.track.itemBoxes) {
    game.track.itemBoxes.forEach(ib => {
      const boxGroup = new T.Group();
      const outerGeo = new T.DodecahedronGeometry(22, 0);
      const outerMat = new T.MeshStandardMaterial({
        color: 0xffd86b,
        emissive: 0xffd86b,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      });
      boxGroup.add(new T.Mesh(outerGeo, outerMat));
      const midGeo = new T.IcosahedronGeometry(19, 0);
      const midMat = new T.MeshStandardMaterial({
        color: 0xffd86b,
        emissive: 0xffd86b,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.2,
        wireframe: true,
      });
      boxGroup.add(new T.Mesh(midGeo, midMat));
      const innerGeo = new T.OctahedronGeometry(12, 1);
      const innerMat = new T.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffd86b,
        emissiveIntensity: 1.8,
        transparent: true,
        opacity: 0.9,
        metalness: 0.4,
        roughness: 0.2,
      });
      boxGroup.add(new T.Mesh(innerGeo, innerMat));
      const qMat = new T.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffd86b, emissiveIntensity: 1.5 });
      const qDot = new T.Mesh(new T.SphereGeometry(2.5, 8, 6), qMat);
      qDot.position.y = -8;
      boxGroup.add(qDot);
      const qCurve = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 10, 8), qMat);
      qCurve.position.y = 2;
      boxGroup.add(qCurve);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const boxLight = new T.PointLight(0xffd86b, 0.9, 140);
        boxGroup.add(boxLight);
      }
      boxGroup.position.set(ib.x, 22, ib.y);
      boxGroup._itemRef = ib;
      boxGroup._innerMat = innerMat;
      boxGroup._outerMat = outerMat;
      boxGroup._midMat = midMat;
      boxGroup.castShadow = ENABLE_3D_SHADOWS;
      group.add(boxGroup);
      THREE_STATE.itemMeshes.push(boxGroup);
    });
  }

  if (game.track.boostPads) {
    game.track.boostPads.forEach(bp => {
      const padGroup = new T.Group();
      const pw = bp.h || 36;
      const ph = bp.w || 70;
      const padGeo = new T.BoxGeometry(pw, 1.5, ph);
      const padMat = new T.MeshStandardMaterial({
        color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.55, metalness: 0.3, roughness: 0.4,
      });
      padGroup.add(new T.Mesh(padGeo, padMat));
      const arrowMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xa4ff80, emissiveIntensity: 1.5, transparent: true, opacity: 0.85, side: T.DoubleSide });
      for (let a = 0; a < 3; a++) {
        const hw = pw * 0.35;
        const arrowGeo = new T.BufferGeometry();
        arrowGeo.setAttribute("position", new T.Float32BufferAttribute([
          0, 0, 8, -hw, 0, -6, 0, 0, -2,
          0, 0, 8, 0, 0, -2, hw, 0, -6,
        ], 3));
        arrowGeo.computeVertexNormals();
        const arrow = new T.Mesh(arrowGeo, arrowMat);
        arrow.position.z = -ph * 0.3 + a * (ph * 0.3);
        arrow.position.y = 1.2;
        padGroup.add(arrow);
      }
      const barMat = new T.MeshStandardMaterial({ color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 1.1 });
      for (const s of [-1, 1]) {
        const bar = new T.Mesh(new T.BoxGeometry(2, 3, ph + 4), barMat);
        bar.position.x = s * (pw / 2 + 1);
        bar.position.y = 1.5;
        padGroup.add(bar);
      }
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const padLight = new T.PointLight(0xa4ff80, 0.3, 60);
        padLight.position.y = 5;
        padGroup.add(padLight);
      }
      padGroup.position.set(bp.x, 1.5, bp.y);
      padGroup.rotation.y = -bp.ang + Math.PI / 2;
      padGroup._boostPadRef = bp;
      padGroup._padMat = padMat;
      group.add(padGroup);
      THREE_STATE.boostPadMeshes.push(padGroup);
    });
  }

  if (game.track.coins) {
    const citationLabelCanvas = document.createElement("canvas");
    citationLabelCanvas.width = 128;
    citationLabelCanvas.height = 72;
    const labelCtx = citationLabelCanvas.getContext("2d");
    labelCtx.clearRect(0, 0, citationLabelCanvas.width, citationLabelCanvas.height);
    labelCtx.fillStyle = "rgba(6,5,20,0.74)";
    labelCtx.fillRect(8, 8, 112, 56);
    labelCtx.strokeStyle = "rgba(255,216,107,0.95)";
    labelCtx.lineWidth = 3;
    labelCtx.strokeRect(8, 8, 112, 56);
    labelCtx.fillStyle = "#ffffff";
    labelCtx.font = "bold 26px 'SFMono-Regular', Consolas, monospace";
    labelCtx.textAlign = "center";
    labelCtx.textBaseline = "middle";
    labelCtx.fillText("PMC", 64, 30);
    labelCtx.fillStyle = "#ffd86b";
    labelCtx.font = "bold 15px 'SFMono-Regular', Consolas, monospace";
    labelCtx.fillText("CITE", 64, 51);
    const citationLabelTex = new T.CanvasTexture(citationLabelCanvas);
    citationLabelTex.minFilter = T.LinearFilter;
    const citationLabelMat = new T.MeshBasicMaterial({ map: citationLabelTex, transparent: true, depthWrite: false, side: T.DoubleSide });

    game.track.coins.forEach(c => {
      if (c.collected) return;
      const coinGroup = new T.Group();
      const citationMat = new T.MeshStandardMaterial({
        color: 0xffd86b,
        emissive: 0xffd86b,
        emissiveIntensity: 1.2,
        metalness: 0.85,
        roughness: 0.16,
      });
      const citationBody = new T.Mesh(new T.BoxGeometry(12, 16, 3), citationMat);
      citationBody.position.y = 3;
      citationBody.castShadow = ENABLE_3D_SHADOWS;
      coinGroup.add(citationBody);

      const frameMat = new T.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffd86b, emissiveIntensity: 1.0, metalness: 0.9, roughness: 0.08 });
      [
        [0, 10.75, 11.6, 0.55],
        [0, -4.75, 11.6, 0.55],
        [-5.75, 3, 0.55, 15.2],
        [5.75, 3, 0.55, 15.2],
      ].forEach(([px, py, w, h]) => {
        const frameBar = new T.Mesh(new T.BoxGeometry(w, h, 0.38), frameMat);
        frameBar.position.set(px, py, 1.78);
        coinGroup.add(frameBar);
      });

      const topTab = new T.Mesh(new T.BoxGeometry(7.5, 1.2, 3.4), frameMat);
      topTab.position.set(0, 10.2, 0);
      coinGroup.add(topTab);

      const foldGeo = new T.BufferGeometry();
      foldGeo.setAttribute("position", new T.Float32BufferAttribute([
        2.3, 9.2, 1.98,
        5.0, 9.2, 1.98,
        5.0, 6.5, 1.98,
      ], 3));
      foldGeo.computeVertexNormals();
      const foldMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, side: T.DoubleSide });
      coinGroup.add(new T.Mesh(foldGeo, foldMat));

      const lineMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      [-1.8, -3.2, -4.6].forEach((lineY, idx) => {
        const line = new T.Mesh(new T.BoxGeometry(idx === 2 ? 4.6 : 7, 0.28, 0.18), lineMat);
        line.position.set(0, lineY, 1.78);
        coinGroup.add(line);
      });

      const label = new T.Mesh(new T.PlaneGeometry(8.7, 4.9), citationLabelMat);
      label.position.set(0, 3.0, 1.91);
      coinGroup.add(label);

      const glowCore = new T.Mesh(
        new T.OctahedronGeometry(1.4, 0),
        new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd86b, emissiveIntensity: 1.4, transparent: true, opacity: 0.9 })
      );
      glowCore.position.set(0, -7.0, 1.8);
      coinGroup.add(glowCore);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const coinLight = new T.PointLight(0xffd86b, 0.2, 30);
        coinGroup.add(coinLight);
      }
      coinGroup.position.set(c.x, 9, c.y);
      coinGroup._coinRef = c;
      coinGroup._discMat = citationMat;
      group.add(coinGroup);
      THREE_STATE.coinMeshes.push(coinGroup);
    });
  }

  if (game.track.movingObjects) {
    game.track.movingObjects.forEach(obj => {
      const gateGroup = new T.Group();
      const col = new T.Color(obj.color || "#57f2ff");
      const kind = obj.kind || "blackice";
      const wallGeo = kind === "amend"
        ? new T.BoxGeometry(8, 30, 82)
        : kind === "clause"
          ? new T.BoxGeometry(8, 64, 42)
          : kind === "redline"
            ? new T.BoxGeometry(8, 18, 105)
            : kind === "signoff"
              ? new T.BoxGeometry(12, 58, 66)
              : new T.BoxGeometry(8, 50, 55);
      const wallMat = new T.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.5, side: T.DoubleSide,
      });
      gateGroup.add(new T.Mesh(wallGeo, wallMat));
      const wireMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, wireframe: true, transparent: true, opacity: 0.4 });
      gateGroup.add(new T.Mesh(kind === "redline" ? new T.BoxGeometry(10, 22, 112) : new T.BoxGeometry(10, 52, 57), wireMat));
      const hexMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, wireframe: true, transparent: true, opacity: 0.2 });
      if (kind === "clause") {
        gateGroup.add(new T.Mesh(new T.TorusGeometry(24, 2, 8, 24), hexMat));
      } else if (kind === "signoff") {
        gateGroup.add(new T.Mesh(new T.OctahedronGeometry(26, 0), hexMat));
      } else {
        gateGroup.add(new T.Mesh(new T.IcosahedronGeometry(30, 1), hexMat));
      }
      const barMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.4 });
      const topBar = new T.Mesh(new T.BoxGeometry(10, 3, 58), barMat);
      topBar.position.y = 26;
      gateGroup.add(topBar);
      const bottomBar = new T.Mesh(new T.BoxGeometry(10, 3, 58), barMat);
      bottomBar.position.y = -24;
      gateGroup.add(bottomBar);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const wLight = new T.PointLight(col, 0.8, 150);
        wLight.position.y = 30;
        gateGroup.add(wLight);
        const wLight2 = new T.PointLight(col, 0.3, 80);
        wLight2.position.y = -20;
        gateGroup.add(wLight2);
      }
      gateGroup.position.set(obj.x, 26, obj.y);
      gateGroup.rotation.y = -(obj.ang || 0) + Math.PI / 2;
      gateGroup._movingObjectRef = obj;
      group.add(gateGroup);
      THREE_STATE.movingObjectMeshes.push(gateGroup);
    });
  }

  // Only create the dragon model relevant to the current map
  const currentMapId = MAPS[game.selectedMapIdx || 0].id;
  if (game.track.regulatoryDragon && currentMapId !== "dragon_escape") {
    THREE_STATE.dragonModel = buildDragonModel3D(false);
    sc.add(THREE_STATE.dragonModel);
  }
  if (currentMapId === "dragon_escape") {
    THREE_STATE.dragonEscapeModel = buildDragonModel3D(true);
    sc.add(THREE_STATE.dragonEscapeModel);
  }

  if (game.track.decorations && !game.track.isOpen && !game.track.arenaFloor) {
    const pillarColors = [0x7b75ff, 0xfd9927, 0xff4d6d, 0xa4ff80, 0x57f2ff];
    game.track.decorations.forEach((d, idx) => {
      if (d.isJapanese) return;
      const h = d.h || 50;
      const r = (d.r || 12) * 0.6;
      const col = pillarColors[idx % pillarColors.length];
      const pillarGeo = new T.CylinderGeometry(r * 0.5, r, h, 8);
      const pillarMat = new T.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.5,
        roughness: 0.15,
        metalness: 0.85,
      });
      const pillar = new T.Mesh(pillarGeo, pillarMat);
      pillar.position.set(d.x, h / 2, d.y);
      pillar.castShadow = ENABLE_3D_SHADOWS;
      group.add(pillar);
      for (let ri = 0; ri < 3; ri++) {
        const ringY = h * 0.25 + ri * (h * 0.25);
        const ringR = r * (0.9 - ri * 0.1);
        const ringGeo = new T.TorusGeometry(ringR, 0.4, 6, 12);
        const ringMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, transparent: true, opacity: 0.6 });
        const ring = new T.Mesh(ringGeo, ringMat);
        ring.position.set(d.x, ringY, d.y);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        THREE_STATE.pillarRings.push(ring);
      }
      const capGeo = new T.SphereGeometry(r * 0.7, 10, 8);
      const capMat = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.0 });
      const cap = new T.Mesh(capGeo, capMat);
      cap.position.set(d.x, h + 2, d.y);
      group.add(cap);
      if (ENABLE_DECORATIVE_3D_LIGHTS) {
        const pillarLight = new T.PointLight(col, 0.25, 80);
        pillarLight.position.set(d.x, h + 5, d.y);
        group.add(pillarLight);
      }
    });
  }

  // Reposition ground
  if (THREE_STATE.groundMesh) {
    THREE_STATE.groundMesh.position.set(WORLD_W / 2, -1, WORLD_H / 2);
    const gs = Math.max(WORLD_W, WORLD_H) * 3;
    THREE_STATE.groundMesh.scale.set(gs / 12000, 1, gs / 12000);
  }

  // Visual enhancements
  apply3DMapTheme();
  init3DParticles();
  build3DSpectators();
  build3DStartLine();
  enhance3DKartModels();

  // Clean up old name tags / speech bubbles from previous track
  THREE_STATE.nameTagSprites.forEach(s => THREE_STATE.scene.remove(s));
  THREE_STATE.nameTagSprites.clear();
  THREE_STATE.speechBubbleSprites.forEach(s => { THREE_STATE.scene.remove(s); s.material.map?.dispose(); s.material.dispose(); });
  THREE_STATE.speechBubbleSprites.clear();
  recycleAll3DSkidMarks();
}

function getCompassKartMats3D(T, charColor) {
  const railColor = new T.Color(charColor);
  const shellColor = new T.Color(charColor).lerp(new T.Color(0x131019), 0.22);
  return {
    shell: new T.MeshStandardMaterial({
      color: shellColor, emissive: railColor, emissiveIntensity: 0.08,
      roughness: 0.32, metalness: 0.55,
    }),
    frame: new T.MeshStandardMaterial({
      color: 0x131019, emissive: 0x131019, emissiveIntensity: 0,
      roughness: 0.35, metalness: 0.55,
    }),
    nose: new T.MeshStandardMaterial({
      color: 0xfd9927, emissive: 0xfd9927, emissiveIntensity: 0.35,
      roughness: 0.2, metalness: 0.45,
    }),
    rear: new T.MeshStandardMaterial({
      color: 0x7b75ff, emissive: 0x7b75ff, emissiveIntensity: 0.15,
      roughness: 0.3, metalness: 0.4,
    }),
    rail: new T.MeshStandardMaterial({
      color: railColor, emissive: railColor, emissiveIntensity: 0.18,
      roughness: 0.22, metalness: 0.65,
    }),
  };
}

function applyCompassKartRestyle3D(group, charColor, T, charId) {
  const mats = getCompassKartMats3D(T, charColor);
  const usedMats = new Set();
  const bodyMesh = group.userData.mainBody;
  if (!bodyMesh) {
    for (const mat of Object.values(mats)) mat.dispose();
    return;
  }

  const style = getVehicleProfile(charId).style || "generic";

  const bodyBox = new T.Box3().setFromObject(bodyMesh);
  const bodySize = bodyBox.getSize(new T.Vector3());
  const bodyCenter = bodyBox.getCenter(new T.Vector3());
  let cosmeticTopY = bodyBox.max.y;
  group.traverse((child) => {
    if (!child.isMesh || child.parent !== group) return;
    const box = new T.Box3().setFromObject(child);
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    const mat = child.material;
    if (mat && mat.transparent && mat.opacity <= 0.15) return;
    const centered = Math.abs(center.x - bodyCenter.x) < bodySize.x * 0.25
      && Math.abs(center.z - bodyCenter.z) < bodySize.z * 0.25;
    if (centered && size.x > bodySize.x * 0.45 && size.z > bodySize.z * 0.2) {
      cosmeticTopY = Math.max(cosmeticTopY, box.max.y);
    }
  });

  group.traverse((child) => {
    if (!child.isMesh || child.parent !== group) return;
    const box = new T.Box3().setFromObject(child);
    const size = box.getSize(new T.Vector3());
    const pos = child.position;
    if (child === bodyMesh) {
      child.material = mats.shell; usedMats.add(mats.shell);
    } else if (Math.abs(pos.x) > 7 && size.x < 3 && size.z > 10) {
      child.material = mats.rail; usedMats.add(mats.rail);
    } else if (pos.z > 10 && size.x > 4 && size.z < 12 && size.y < 6) {
      child.material = mats.nose; usedMats.add(mats.nose);
    } else if (pos.z < -12 && size.x > 8 && size.z < 5) {
      child.material = mats.rear; usedMats.add(mats.rear);
    } else if (
      box.max.y <= bodyBox.min.y + bodySize.y * 0.65
      && (size.x > 8 || size.z > 8)
    ) {
      child.material = mats.frame; usedMats.add(mats.frame);
    }
  });

  if (!group.userData.compassCosmetic) {
    const topY = cosmeticTopY + 0.3;
    const panelInsetX = bodySize.x * 0.18;
    const panelRear = bodyCenter.z - bodySize.z * 0.28;
    const panelFront = bodyCenter.z + bodySize.z * 0.18;
    const noseRear = panelFront + 0.2;
    const noseFront = bodyBox.max.z + 0.2;
    const noseHalfRear = bodySize.x * 0.11;
    const noseHalfFront = bodySize.x * 0.18;
    let positions;
    let colors;
    let indices;

    if (style === "formula") {
      const narrowInset = bodySize.x * 0.28;
      positions = [
        bodyBox.min.x + narrowInset, topY, panelRear,
        bodyBox.max.x - narrowInset, topY, panelRear,
        bodyBox.max.x - narrowInset, topY, panelFront,
        bodyBox.min.x + narrowInset, topY, panelFront,
        bodyCenter.x - noseHalfRear * 0.7, topY + 0.04, noseRear,
        bodyCenter.x + noseHalfRear * 0.7, topY + 0.04, noseRear,
        bodyCenter.x + noseHalfFront * 0.55, topY + 0.04, noseFront,
        bodyCenter.x - noseHalfFront * 0.55, topY + 0.04, noseFront,
        bodyCenter.x - bodySize.x * 0.42, topY + 0.5, bodyCenter.z - bodySize.z * 0.42,
        bodyCenter.x + bodySize.x * 0.42, topY + 0.5, bodyCenter.z - bodySize.z * 0.42,
        bodyCenter.x + bodySize.x * 0.35, topY + 0.5, bodyBox.min.z - 0.4,
        bodyCenter.x - bodySize.x * 0.35, topY + 0.5, bodyBox.min.z - 0.4,
      ];
      colors = [
        0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1,
        1, 0.6, 0.15, 1, 0.6, 0.15, 1, 0.72, 0.28, 1, 0.72, 0.28,
        0.75, 0.72, 0.95, 0.75, 0.72, 0.95, 0.75, 0.72, 0.95, 0.75, 0.72, 0.95,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else if (style === "muscle") {
      const hoodFront = bodyCenter.z + bodySize.z * 0.35;
      const hoodRear = bodyCenter.z - bodySize.z * 0.05;
      positions = [
        bodyBox.min.x + panelInsetX * 0.6, topY, hoodRear,
        bodyBox.max.x - panelInsetX * 0.6, topY, hoodRear,
        bodyBox.max.x - panelInsetX * 0.6, topY + 0.15, hoodFront,
        bodyBox.min.x + panelInsetX * 0.6, topY + 0.15, hoodFront,
        bodyCenter.x - bodySize.x * 0.08, topY + 0.35, hoodRear + 1,
        bodyCenter.x + bodySize.x * 0.08, topY + 0.35, hoodRear + 1,
        bodyCenter.x + bodySize.x * 0.08, topY + 0.35, hoodFront - 1,
        bodyCenter.x - bodySize.x * 0.08, topY + 0.35, hoodFront - 1,
        bodyCenter.x - noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfFront, topY + 0.02, noseFront,
        bodyCenter.x - noseHalfFront, topY + 0.02, noseFront,
      ];
      colors = [
        0.95, 0.9, 0.82, 0.95, 0.9, 0.82, 0.95, 0.9, 0.82, 0.95, 0.9, 0.82,
        1, 0.55, 0.12, 1, 0.55, 0.12, 1, 0.55, 0.12, 1, 0.55, 0.12,
        1, 0.62, 0.18, 1, 0.62, 0.18, 1, 0.72, 0.28, 1, 0.72, 0.28,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else if (style === "compact") {
      const canopyR = bodySize.x * 0.22;
      positions = [
        bodyCenter.x - canopyR, topY, bodyCenter.z - bodySize.z * 0.12,
        bodyCenter.x + canopyR, topY, bodyCenter.z - bodySize.z * 0.12,
        bodyCenter.x + canopyR * 0.8, topY + 0.25, bodyCenter.z + bodySize.z * 0.08,
        bodyCenter.x - canopyR * 0.8, topY + 0.25, bodyCenter.z + bodySize.z * 0.08,
        bodyCenter.x - canopyR * 1.1, topY + 0.05, bodyCenter.z - bodySize.z * 0.2,
        bodyCenter.x + canopyR * 1.1, topY + 0.05, bodyCenter.z - bodySize.z * 0.2,
        bodyCenter.x + canopyR * 0.9, topY + 0.05, bodyCenter.z + bodySize.z * 0.15,
        bodyCenter.x - canopyR * 0.9, topY + 0.05, bodyCenter.z + bodySize.z * 0.15,
      ];
      colors = [
        0.55, 1, 0.85, 0.55, 1, 0.85, 0.7, 1, 0.92, 0.7, 1, 0.92,
        0.45, 0.95, 0.75, 0.45, 0.95, 0.75, 0.45, 0.95, 0.75, 0.45, 0.95, 0.75,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    } else if (style === "armored") {
      const rackFront = bodyCenter.z + bodySize.z * 0.22;
      const rackRear = bodyCenter.z - bodySize.z * 0.32;
      positions = [
        bodyBox.min.x + panelInsetX * 0.4, topY + 0.2, rackRear,
        bodyBox.max.x - panelInsetX * 0.4, topY + 0.2, rackRear,
        bodyBox.max.x - panelInsetX * 0.4, topY + 0.2, rackFront,
        bodyBox.min.x + panelInsetX * 0.4, topY + 0.2, rackFront,
        bodyBox.min.x + 0.4, topY - bodySize.y * 0.15, bodyCenter.z - bodySize.z * 0.1,
        bodyBox.min.x + 1.2, topY - bodySize.y * 0.15, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.min.x + 1.2, topY + bodySize.y * 0.05, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.min.x + 0.4, topY + bodySize.y * 0.05, bodyCenter.z - bodySize.z * 0.1,
        bodyBox.max.x - 0.4, topY - bodySize.y * 0.15, bodyCenter.z - bodySize.z * 0.1,
        bodyBox.max.x - 1.2, topY - bodySize.y * 0.15, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.max.x - 1.2, topY + bodySize.y * 0.05, bodyCenter.z + bodySize.z * 0.1,
        bodyBox.max.x - 0.4, topY + bodySize.y * 0.05, bodyCenter.z - bodySize.z * 0.1,
      ];
      colors = [
        0.82, 0.84, 0.92, 0.82, 0.84, 0.92, 0.82, 0.84, 0.92, 0.82, 0.84, 0.92,
        0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68,
        0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68, 0.55, 0.58, 0.68,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else if (style === "coupe") {
      const stripeRear = bodyCenter.z - bodySize.z * 0.35;
      const stripeFront = bodyBox.max.z + 0.1;
      const stripeHalf = bodySize.x * 0.06;
      positions = [
        bodyCenter.x - stripeHalf, topY + 0.05, stripeRear,
        bodyCenter.x + stripeHalf, topY + 0.05, stripeRear,
        bodyCenter.x + stripeHalf, topY + 0.05, stripeFront,
        bodyCenter.x - stripeHalf, topY + 0.05, stripeFront,
        bodyBox.min.x + panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelFront,
        bodyBox.min.x + panelInsetX, topY, panelFront,
        bodyCenter.x - noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfFront, topY + 0.02, noseFront,
        bodyCenter.x - noseHalfFront, topY + 0.02, noseFront,
      ];
      colors = [
        0.35, 1, 0.5, 0.35, 1, 0.5, 0.45, 1, 0.6, 0.45, 1, 0.6,
        0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1,
        0.35, 0.95, 1, 0.35, 0.95, 1, 0.45, 1, 1, 0.45, 1, 1,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    } else {
      positions = [
        bodyBox.min.x + panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelRear,
        bodyBox.max.x - panelInsetX, topY, panelFront,
        bodyBox.min.x + panelInsetX, topY, panelFront,
        bodyCenter.x - noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfRear, topY + 0.02, noseRear,
        bodyCenter.x + noseHalfFront, topY + 0.02, noseFront,
        bodyCenter.x - noseHalfFront, topY + 0.02, noseFront,
      ];
      colors = [
        0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1, 0.92, 0.89, 1,
        1, 0.6, 0.15, 1, 0.6, 0.15, 1, 0.72, 0.28, 1, 0.72, 0.28,
      ];
      indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const cosmetic = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.25, side: T.DoubleSide }));
    cosmetic.position.y = 0;
    group.add(cosmetic);
    group.userData.compassCosmetic = cosmetic;
    mats.panel = cosmetic.material;
  }
  for (const key of ["shell", "frame", "nose", "rear", "rail"]) {
    if (!usedMats.has(mats[key])) {
      mats[key].dispose();
      mats[key] = null;
    }
  }
  group.userData.compassMaterials = mats;
  group.userData.boostMaterial = mats.shell;
  group.userData.boostBaseEmissiveIntensity = mats.shell.emissiveIntensity;
}

function disposeTethers3D() {
  if (!THREE_STATE._tethers || !window.THREE) return;
  const T = window.THREE;
  if (THREE_STATE._tethers instanceof Map) {
    for (const entry of THREE_STATE._tethers.values()) {
      if (entry.line) {
        THREE_STATE.scene.remove(entry.line);
        entry.line.geometry.dispose();
        entry.line.material.dispose();
      }
    }
    THREE_STATE._tethers.clear();
  } else if (Array.isArray(THREE_STATE._tethers)) {
    THREE_STATE._tethers.forEach(t => {
      THREE_STATE.scene.remove(t);
      t.geometry.dispose();
      t.material.dispose();
    });
    THREE_STATE._tethers = new Map();
  }
}

function syncMergeTethers3D() {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;
  if (!THREE_STATE._tethers || !(THREE_STATE._tethers instanceof Map)) {
    THREE_STATE._tethers = new Map();
  }
  const currentKarts = getActiveKarts();
  for (const [kart, entry] of THREE_STATE._tethers) {
    if (currentKarts.indexOf(kart) >= 0) {
      entry.line.visible = false;
      continue;
    }
    THREE_STATE.scene.remove(entry.line);
    entry.line.geometry.dispose();
    entry.line.material.dispose();
    THREE_STATE._tethers.delete(kart);
  }

  for (const kart of currentKarts) {
    if (!kart || !kart.mergePullTimer || kart.mergePullTimer <= 0) continue;
    const target = kart.mergePullTarget || (kart.mergePullTargetId ? getKartById(kart.mergePullTargetId) : null);
    if (!target) continue;
    let entry = THREE_STATE._tethers.get(kart);
    if (!entry) {
      const pos = new Float32Array(6);
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      const mat = new T.LineBasicMaterial({ color: 0xa4ff80, transparent: true, opacity: 0.85 });
      const line = new T.Line(geo, mat);
      line.frustumCulled = false;
      THREE_STATE.scene.add(line);
      entry = { line, pos, geo };
      THREE_STATE._tethers.set(kart, entry);
    }
    entry.pos[0] = kart.x; entry.pos[1] = 12 + (kart.z || 0); entry.pos[2] = kart.y;
    entry.pos[3] = target.x; entry.pos[4] = 12 + (target.z || 0); entry.pos[5] = target.y;
    entry.geo.attributes.position.needsUpdate = true;
    entry.line.visible = true;
  }
}

function buildKartModel3D(charId, color) {
  if (!window.THREE) return null;
  const T = window.THREE;
  const group = new T.Group();

  const parseCol = (hex) => new T.Color(hex);
  const c = parseCol(color);
  const cDark = c.clone().multiplyScalar(0.5);
  const cBright = c.clone().lerp(new T.Color(0xffffff), 0.35);
  const wheelMat = new T.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.92, metalness: 0.05 });
  const hubMat = new T.MeshStandardMaterial({ color: 0x666666, metalness: 0.85, roughness: 0.15 });
  const headlightMat = new T.MeshStandardMaterial({ color: 0xfff8d0, emissive: 0xfff5b0, emissiveIntensity: 1.4 });
  const taillightMat = new T.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2828, emissiveIntensity: 0.9 });
  const glassMat = new T.MeshStandardMaterial({ color: 0x88ccff, emissive: 0x88ccff, emissiveIntensity: 0.2, transparent: true, opacity: 0.5, metalness: 0.95, roughness: 0.05 });
  const cockpitMat = new T.MeshStandardMaterial({ color: 0x12151e, roughness: 0.25, metalness: 0.7 });

  function addWheels(positions) {
    group._wheels = [];
    const tireGeo = new T.TorusGeometry(3.2, 1.6, 10, 16);
    const cylGeo = new T.CylinderGeometry(2.8, 2.8, 3.8, 14);
    const hubGeo = new T.CylinderGeometry(1.8, 1.8, 4.0, 8);
    const rimGeo = new T.TorusGeometry(2.2, 0.3, 6, 12);
    const rimMat = new T.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.1 });
    positions.forEach(([wx, wy, wz]) => {
      const wheelGroup = new T.Group();
      wheelGroup.position.set(wx, wy, wz);
      const tire = new T.Mesh(tireGeo, wheelMat);
      tire.rotation.x = Math.PI / 2;
      wheelGroup.add(tire);
      const inner = new T.Mesh(cylGeo, wheelMat);
      inner.rotation.z = Math.PI / 2;
      wheelGroup.add(inner);
      const hub = new T.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      wheelGroup.add(hub);
      const rim = new T.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI / 2;
      wheelGroup.add(rim);
      wheelGroup.castShadow = true;
      group.add(wheelGroup);
      group._wheels.push(wheelGroup);
    });
  }

  if (charId === "anton") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.18, metalness: 0.75 });
    const body = new T.Mesh(new T.BoxGeometry(16, 6, 34, 2, 1, 2), bodyMat);
    body.position.y = 5; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const noseMat = new T.MeshStandardMaterial({ color: cBright, roughness: 0.15, metalness: 0.8 });
    const nose = new T.Mesh(new T.BoxGeometry(12, 4, 10), noseMat);
    nose.position.set(0, 5, 18); nose.castShadow = true;
    group.add(nose);
    const sideSkirtMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    for (let s of [-1, 1]) {
      const skirt = new T.Mesh(new T.BoxGeometry(1.5, 3, 30), sideSkirtMat);
      skirt.position.set(s * 8.5, 3, 0);
      group.add(skirt);
    }
    group.add(new T.Mesh(new T.BoxGeometry(10, 4, 8), cockpitMat)).position.set(0, 9, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3, 12, 8), helmetMat)).position.set(0, 12, -2);
    const visorMat = new T.MeshStandardMaterial({ color: 0x222244, emissive: 0x3344ff, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(2.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 12.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(9, 3, 1.5), glassMat);
    ws.position.set(0, 10, 4); ws.rotation.x = -0.3;
    group.add(ws);
    group.add(new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 14, 6), new T.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 }))).position.set(0, 16, -10);
    group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2 }))).position.set(0, 23, -10);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1, 0.8, 30), new T.MeshStandardMaterial({ color: cBright, emissive: c, emissiveIntensity: 0.6 }))).position.set(s * 5, 8.5, 0);
    }
    const wingMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.5, 3), wingMat)).position.set(0, 10, -16);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.2, 4, 1.2), wingMat)).position.set(s * 7, 8, -16);
    }
    addWheels([[-7, 2.5, 12], [7, 2.5, 12], [-7, 2.5, -12], [7, 2.5, -12]]);
    [[-5, 5, 18], [5, 5, 18]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), headlightMat)).position.set(...p));
    [[-5, 5, -17], [5, 5, -17]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "artur") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.22, metalness: 0.7 });
    const body = new T.Mesh(new T.BoxGeometry(22, 8, 30, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const engineMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.4, metalness: 0.75 });
    group.add(new T.Mesh(new T.BoxGeometry(18, 6, 8), engineMat)).position.set(0, 12, -10);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(4, 4, 6), engineMat)).position.set(s * 5, 11, 4);
    }
    group.add(new T.Mesh(new T.BoxGeometry(14, 5, 10), cockpitMat)).position.set(0, 11, 0);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 14.5, -1);
    const visorMat = new T.MeshStandardMaterial({ color: 0x332200, emissive: 0xff6600, emissiveIntensity: 0.2, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 15, 0); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(13, 4, 1.5), glassMat);
    ws.position.set(0, 13, 6); ws.rotation.x = -0.35;
    group.add(ws);
    const flameMat = new T.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff8a3b, emissiveIntensity: 0.8, transparent: true, opacity: 0.75, side: T.DoubleSide });
    for (let s of [-1, 1]) {
      const flameGeo = new T.BufferGeometry();
      flameGeo.setAttribute("position", new T.Float32BufferAttribute([
        -8, 0, 0, 8, 0, -3, 0, 0, 3,
        -6, 0, -1, 10, 0, -4, 2, 0, 4,
      ], 3));
      flameGeo.computeVertexNormals();
      const flame = new T.Mesh(flameGeo, flameMat);
      flame.position.set(s * 11.5, 6, 6);
      flame.rotation.y = s * Math.PI / 2;
      group.add(flame);
    }
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(24, 2, 3), spoilerMat)).position.set(0, 16, -14);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(2, 6, 2), spoilerMat)).position.set(s * 9, 13, -14);
    }
    const pipeMat = new T.MeshStandardMaterial({ color: 0x555555, metalness: 0.85, roughness: 0.2 });
    const pipeGlowMat = new T.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 });
    for (let s of [-1, 1]) {
      const pipe = new T.Mesh(new T.CylinderGeometry(2, 2.5, 6, 12), pipeMat);
      pipe.position.set(s * 6, 4, -18); pipe.rotation.x = Math.PI / 2;
      group.add(pipe);
      const pipeGlow = new T.Mesh(new T.CylinderGeometry(1.5, 2, 2, 10), pipeGlowMat);
      pipeGlow.position.set(s * 6, 4, -21); pipeGlow.rotation.x = Math.PI / 2;
      group.add(pipeGlow);
    }
    addWheels([[-10, 3, 11], [10, 3, 11], [-10, 3, -11], [10, 3, -11]]);
    [[-8, 6, 16], [8, 6, 16]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.8, 8, 6), headlightMat)).position.set(...p));
    [[-7, 6, -15], [7, 6, -15]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.4, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "rissal") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.25, metalness: 0.65 });
    const body = new T.Mesh(new T.BoxGeometry(20, 8, 26, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    group.add(new T.Mesh(new T.SphereGeometry(10, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat)).position.set(0, 10, -2);
    group.add(new T.Mesh(new T.BoxGeometry(14, 4, 10), cockpitMat)).position.set(0, 11, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 14, -2);
    const visorMat = new T.MeshStandardMaterial({ color: 0x112222, emissive: c, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 14.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(12, 4, 1.5), glassMat);
    ws.position.set(0, 12, 4); ws.rotation.x = -0.35;
    group.add(ws);
    const glowMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5, transparent: true, opacity: 0.7 });
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 1.2, 28), glowMat)).position.set(s * 10.5, 1.5, 0);
    }
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.2, 1.5), glowMat)).position.set(0, 1.5, 13);
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.2, 1.5), glowMat)).position.set(0, 1.5, -13);
    const underGlow = new T.PointLight(new T.Color(c), 0.5, 60);
    underGlow.position.set(0, 1, 0);
    group.add(underGlow);
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(18, 1.5, 2), spoilerMat)).position.set(0, 11, -13);
    addWheels([[-9, 2.5, 10], [9, 2.5, 10], [-9, 2.5, -10], [9, 2.5, -10]]);
    [[-7, 6, 14], [7, 6, 14]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), headlightMat)).position.set(...p));
    [[-6, 6, -13], [6, 6, -13]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "pia") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.35, metalness: 0.55 });
    const body = new T.Mesh(new T.BoxGeometry(26, 10, 30, 2, 1, 2), bodyMat);
    body.position.y = 7; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const rackMat = new T.MeshStandardMaterial({ color: 0x333344, metalness: 0.7, roughness: 0.3 });
    group.add(new T.Mesh(new T.BoxGeometry(22, 1.5, 18), rackMat)).position.set(0, 13.5, -2);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 3, 1.5), rackMat)).position.set(s * 10, 12.5, 6);
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 3, 1.5), rackMat)).position.set(s * 10, 12.5, -8);
    }
    const spotlightBar = new T.MeshStandardMaterial({ color: 0xffdd44, emissive: 0xffdd44, emissiveIntensity: 0.6 });
    for (let i = -1; i <= 1; i++) {
      group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), spotlightBar)).position.set(i * 6, 15.5, -2);
    }
    group.add(new T.Mesh(new T.BoxGeometry(18, 6, 14), cockpitMat)).position.set(0, 13, -1);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 17, -1);
    const ws = new T.Mesh(new T.BoxGeometry(16, 5, 1.5), glassMat);
    ws.position.set(0, 14.5, 8); ws.rotation.x = -0.3;
    group.add(ws);
    const bumperMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.5, metalness: 0.55 });
    group.add(new T.Mesh(new T.BoxGeometry(28, 4, 4), bumperMat)).position.set(0, 4, 17);
    group.add(new T.Mesh(new T.BoxGeometry(28, 4, 4), bumperMat)).position.set(0, 4, -17);
    const bullBarMat = new T.MeshStandardMaterial({ color: 0x777777, metalness: 0.85, roughness: 0.15 });
    const bullBar = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 22, 10), bullBarMat);
    bullBar.position.set(0, 8, 18); bullBar.rotation.z = Math.PI / 2;
    group.add(bullBar);
    const bullBarV = new T.Mesh(new T.CylinderGeometry(0.8, 0.8, 6, 8), bullBarMat);
    bullBarV.position.set(0, 5, 18);
    group.add(bullBarV);
    for (let s of [-1, 1]) {
      const armor = new T.Mesh(new T.BoxGeometry(2, 6, 26), bumperMat);
      armor.position.set(s * 14, 5, 0); armor.castShadow = true;
      group.add(armor);
    }
    addWheels([[-12, 3.5, 12], [12, 3.5, 12], [-12, 3.5, -12], [12, 3.5, -12]]);
    [[-9, 7, 16], [9, 7, 16]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(2, 8, 6), headlightMat)).position.set(...p));
    [[-9, 7, -15], [9, 7, -15]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), taillightMat)).position.set(...p));

  } else if (charId === "florian") {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.15, metalness: 0.8 });
    const body = new T.Mesh(new T.BoxGeometry(22, 8, 32, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    const hoodMat = new T.MeshStandardMaterial({ color: cBright, roughness: 0.12, metalness: 0.85 });
    const hood = new T.Mesh(new T.BoxGeometry(20, 3, 10), hoodMat);
    hood.position.set(0, 9, 10); hood.rotation.x = -0.12; hood.castShadow = true;
    group.add(hood);
    group.add(new T.Mesh(new T.BoxGeometry(16, 6, 12), cockpitMat)).position.set(0, 12, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 16, -2);
    const visorMat = new T.MeshStandardMaterial({ color: 0x112233, emissive: 0x57f2ff, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 16.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    const ws = new T.Mesh(new T.BoxGeometry(14, 5, 1.5), glassMat);
    ws.position.set(0, 14, 5); ws.rotation.x = -0.3;
    group.add(ws);
    const chromeMat = new T.MeshStandardMaterial({ color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 0.5, metalness: 0.95, roughness: 0.05 });
    group.add(new T.Mesh(new T.BoxGeometry(2, 0.8, 34), chromeMat)).position.set(0, 10.5, 0);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(0.8, 0.6, 28), chromeMat)).position.set(s * 8, 10.3, 0);
    }
    const badgeMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 1.0, metalness: 0.8 });
    const badge = new T.Mesh(new T.OctahedronGeometry(3, 1), badgeMat);
    badge.position.set(0, 11, 12);
    badge.scale.set(1, 0.4, 1);
    group.add(badge);
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.25, metalness: 0.65 });
    group.add(new T.Mesh(new T.BoxGeometry(20, 1.5, 3), spoilerMat)).position.set(0, 11, -16);
    const trimMat = new T.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.95, roughness: 0.05 });
    group.add(new T.Mesh(new T.BoxGeometry(22, 0.8, 32), trimMat)).position.set(0, 2, 0);
    for (let s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(0.6, 7, 30), trimMat)).position.set(s * 11.2, 6, 0);
    }
    addWheels([[-10, 3, 12], [10, 3, 12], [-10, 3, -12], [10, 3, -12]]);
    [[-8, 6, 17], [8, 6, 17]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.6, 10, 8), headlightMat)).position.set(...p));
    [[-7, 6, -16], [7, 6, -16]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.3, 8, 6), taillightMat)).position.set(...p));

  } else {
    const bodyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.65 });
    const body = new T.Mesh(new T.BoxGeometry(20, 8, 28, 2, 1, 2), bodyMat);
    body.position.y = 6; body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    group.userData.mainBody = body;
    // Rounded canopy on top
    const canopyMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.1, roughness: 0.2, metalness: 0.7 });
    const canopy = new T.Mesh(new T.SphereGeometry(10, 12, 8, 0, TAU, 0, Math.PI / 2), canopyMat);
    canopy.scale.set(1, 0.5, 1.2);
    canopy.position.set(0, 10, -2);
    group.add(canopy);
    // Nose taper
    const noseMat = new T.MeshStandardMaterial({ color: cBright, roughness: 0.2, metalness: 0.75 });
    const nose = new T.Mesh(new T.BoxGeometry(16, 5, 8), noseMat);
    nose.position.set(0, 6, 16);
    group.add(nose);
    // Side skirts
    const skirtMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.4, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const skirt = new T.Mesh(new T.BoxGeometry(1.5, 4, 24), skirtMat);
      skirt.position.set(s * 10.5, 4, 0);
      group.add(skirt);
    }
    group.add(new T.Mesh(new T.BoxGeometry(12, 5, 10), cockpitMat)).position.set(0, 11, -2);
    const helmetMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, metalness: 0.5, roughness: 0.2 });
    group.add(new T.Mesh(new T.SphereGeometry(3.5, 12, 8), helmetMat)).position.set(0, 14, -2);
    // Visor
    const visorMat = new T.MeshStandardMaterial({ color: 0x222244, emissive: c, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.05 });
    const visor = new T.Mesh(new T.SphereGeometry(3.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), visorMat);
    visor.position.set(0, 14.5, -1); visor.rotation.x = -0.6;
    group.add(visor);
    // Windshield
    const ws = new T.Mesh(new T.BoxGeometry(12, 4, 1.5), glassMat);
    ws.position.set(0, 12, 4); ws.rotation.x = -0.35;
    group.add(ws);
    // Exhaust pipes
    const pipeMat = new T.MeshStandardMaterial({ color: 0x444444, metalness: 0.85, roughness: 0.2 });
    const pipeGlowMat = new T.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 0.4, transparent: true, opacity: 0.5 });
    for (const s of [-1, 1]) {
      const pipe = new T.Mesh(new T.CylinderGeometry(1.5, 2, 4, 8), pipeMat);
      pipe.position.set(s * 5, 4, -16); pipe.rotation.x = Math.PI / 2;
      group.add(pipe);
      const glow = new T.Mesh(new T.CylinderGeometry(1, 1.5, 1.5, 8), pipeGlowMat);
      glow.position.set(s * 5, 4, -18); glow.rotation.x = Math.PI / 2;
      group.add(glow);
    }
    // Glow accent trim
    const accentMat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, transparent: true, opacity: 0.6 });
    for (const s of [-1, 1]) {
      const trim = new T.Mesh(new T.BoxGeometry(0.6, 0.6, 24), accentMat);
      trim.position.set(s * 10.2, 9, 0);
      group.add(trim);
    }
    addWheels([[-8, 3, 10], [8, 3, 10], [-8, 3, -10], [8, 3, -10]]);
    [[-6, 6, 15], [6, 6, 15]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.5, 8, 6), headlightMat)).position.set(...p));
    [[-6, 6, -14], [6, 6, -14]].forEach(p => group.add(new T.Mesh(new T.SphereGeometry(1.2, 8, 6), taillightMat)).position.set(...p));
    const spoilerMat = new T.MeshStandardMaterial({ color: cDark, roughness: 0.3, metalness: 0.6 });
    group.add(new T.Mesh(new T.BoxGeometry(22, 2, 3), spoilerMat)).position.set(0, 12, -14);
    for (const s of [-1, 1]) {
      group.add(new T.Mesh(new T.BoxGeometry(1.5, 4, 1.5), spoilerMat)).position.set(s * 8, 11, -14);
    }
  }

  // Universal: headlight beam cones (all karts)
  const beamMat = new T.MeshBasicMaterial({ color: 0xfff8d0, transparent: true, opacity: 0.06, side: T.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) {
    const beamGeo = new T.ConeGeometry(8, 40, 8, 1, true);
    const beam = new T.Mesh(beamGeo, beamMat);
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(s * 6, 6, 30);
    group.add(beam);
  }

  // Universal: subtle body emissive on first child (main body) if not already set
  if (group.children[0] && group.children[0].material && group.children[0].material.emissiveIntensity < 0.05) {
    group.children[0].material.emissive = c;
    group.children[0].material.emissiveIntensity = 0.12;
  }

  // Shield (wireframe icosahedron for hex-grid look + solid inner glow)
  const shieldGeo = new T.IcosahedronGeometry(22, 1);
  const shieldMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.5, transparent: true, opacity: 0, wireframe: true, side: T.DoubleSide });
  const shield = new T.Mesh(shieldGeo, shieldMat);
  shield.position.y = 8;
  group.add(shield);
  const shieldInner = new T.Mesh(
    new T.IcosahedronGeometry(20, 1),
    new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.2, transparent: true, opacity: 0, side: T.DoubleSide })
  );
  shieldInner.position.y = 8;
  group.add(shieldInner);
  group._shield = shield;
  group._shieldMat = shieldMat;
  group._shieldInner = shieldInner;

  const flameGroup = new T.Group();
  flameGroup.rotation.x = -Math.PI / 2;
  flameGroup.position.set(0, 5, -28);
  const flameGeo = new T.ConeGeometry(7, 28, 12);
  const flameMat = new T.MeshStandardMaterial({
    color: 0xff8a3b,
    emissive: 0xff4d00,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0,
  });
  flameGroup.add(new T.Mesh(flameGeo, flameMat));
  const flameCore = new T.Mesh(
    new T.ConeGeometry(3.5, 22, 8),
    new T.MeshStandardMaterial({ color: 0xffdd66, emissive: 0xffaa00, emissiveIntensity: 2.0, transparent: true, opacity: 0 })
  );
  flameCore.position.y = 3;
  flameGroup.add(flameCore);
  flameGroup._coreMat = flameCore.material;
  const flameLight = new T.PointLight(0xff6600, 0, 80);
  flameLight.position.y = -5;
  flameGroup.add(flameLight);
  flameGroup._flameLight = flameLight;
  group.add(flameGroup);
  group._flame = flameGroup;
  group._flameMat = flameMat;

  applyCompassKartRestyle3D(group, color, T, charId);
  group.userData._baseScale = 1;

  return group;
}

function buildDragonModel3D(isEscapeDragon = false) {
  if (!window.THREE) return null;
  const T = window.THREE;
  const group = new T.Group();
  const s = isEscapeDragon ? 1.6 : 1.15;
  const baseColor = isEscapeDragon ? 0x2a1010 : 0x3a0d20;
  const glowColor = isEscapeDragon ? 0xff3300 : 0xff3366;
  const bodyMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.28, roughness: 0.35, metalness: 0.3 });
  const boneMat = new T.MeshStandardMaterial({ color: 0x4a2818, emissive: glowColor, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.2 });
  const wingMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.4, transparent: true, opacity: 0.7, side: T.DoubleSide });

  [[-80, 28, 0, 32], [-42, 34, 0, 36], [-4, 38, 0, 38], [30, 42, 0, 32], [58, 48, 0, 26]].forEach(([px, py, pz, r]) => {
    const seg = new T.Mesh(new T.SphereGeometry(r, 16, 12), bodyMat);
    seg.position.set(px, py, pz);
    seg.scale.set(1.1, 0.7, 0.75);
    seg.castShadow = true;
    group.add(seg);
  });
  const scaleMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.4 });
  [[-60, 20, 0], [-20, 24, 0], [15, 28, 0], [45, 34, 0]].forEach(([px, py, pz]) => {
    const belly = new T.Mesh(new T.SphereGeometry(14, 10, 8), scaleMat);
    belly.position.set(px, py - 8, pz);
    belly.scale.set(1.6, 0.4, 0.8);
    group.add(belly);
  });

  const head = new T.Mesh(new T.SphereGeometry(24, 18, 14), bodyMat);
  head.scale.set(1.4, 0.85, 0.85);
  head.position.set(80, 52, 0);
  head.castShadow = true;
  group.add(head);
  group._head = head;
  const browMat = new T.MeshStandardMaterial({ color: baseColor, emissive: glowColor, emissiveIntensity: 0.1, roughness: 0.5 });
  [[72, 62, -10], [72, 62, 10]].forEach(pos => {
    const brow = new T.Mesh(new T.BoxGeometry(12, 3, 8), browMat);
    brow.position.set(pos[0], pos[1], pos[2]);
    brow.rotation.z = pos[2] > 0 ? -0.2 : 0.2;
    group.add(brow);
  });

  // Snout / jaw
  const jaw = new T.Mesh(new T.BoxGeometry(38, 12, 20), bodyMat);
  jaw.position.set(108, 48, 0);
  group.add(jaw);
  group._jaw = jaw;

  // Lower jaw (animated)
  const lowerJaw = new T.Mesh(new T.BoxGeometry(32, 8, 18), bodyMat);
  lowerJaw.position.set(104, 38, 0);
  group.add(lowerJaw);
  group._lowerJaw = lowerJaw;

  const teethMat = new T.MeshStandardMaterial({ color: 0xf0e8d8, emissive: 0xffffff, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const tooth = new T.Mesh(new T.ConeGeometry(2.5, 10 + (i % 2) * 3, 5), teethMat);
    tooth.position.set(90 + i * 6, 42, (i % 2 === 0 ? -7 : 7));
    tooth.rotation.z = Math.PI;
    group.add(tooth);
  }
  for (let i = 0; i < 4; i++) {
    const lTooth = new T.Mesh(new T.ConeGeometry(2, 7, 4), teethMat);
    lTooth.position.set(93 + i * 7, 35, (i % 2 === 0 ? -6 : 6));
    group.add(lTooth);
  }

  const eyeMat = new T.MeshStandardMaterial({ color: 0xffd86b, emissive: 0xffaa00, emissiveIntensity: 2.2 });
  const pupilMat = new T.MeshStandardMaterial({ color: 0x110000, emissive: 0xff0000, emissiveIntensity: 0.5 });
  [[76, 60, -12], [76, 60, 12]].forEach(pos => {
    const eye = new T.Mesh(new T.SphereGeometry(5.5, 12, 8), eyeMat);
    eye.position.set(pos[0], pos[1], pos[2]);
    group.add(eye);
    const pupil = new T.Mesh(new T.SphereGeometry(2.5, 8, 6), pupilMat);
    pupil.position.set(pos[0] + 3, pos[1], pos[2]);
    group.add(pupil);
    const eyeGlow = new T.PointLight(0xffaa00, 0.4, 40);
    eyeGlow.position.set(pos[0] + 5, pos[1], pos[2]);
    group.add(eyeGlow);
  });

  [[-1, 1], [1, 1]].forEach(([side, _]) => {
    const horn = new T.Mesh(new T.ConeGeometry(4, 32, 8), boneMat);
    horn.position.set(68, 68, side * 14);
    horn.rotation.z = -0.4 * side;
    horn.rotation.x = 0.15 * side;
    horn.castShadow = true;
    group.add(horn);
    const hornTip = new T.Mesh(new T.ConeGeometry(1.5, 8, 6), new T.MeshStandardMaterial({ color: 0x2a1510, emissive: glowColor, emissiveIntensity: 0.3 }));
    hornTip.position.set(68, 85, side * 14);
    hornTip.rotation.z = -0.4 * side;
    group.add(hornTip);
  });

  const spikeMat = new T.MeshStandardMaterial({ color: 0x8b0000, emissive: glowColor, emissiveIntensity: 0.2, metalness: 0.3 });
  for (let i = 0; i < 10; i++) {
    const spikeH = 16 + i * 1.8 + (i > 6 ? -i * 0.5 : 0);
    const spike = new T.Mesh(new T.ConeGeometry(3, spikeH, 6), spikeMat);
    spike.position.set(-90 + i * 19, 50 + i * 1.2, 0);
    spike.castShadow = true;
    group.add(spike);
  }

  for (let i = 0; i < 7; i++) {
    const tailR = 18 - i * 2.2;
    const tailSeg = new T.Mesh(new T.SphereGeometry(tailR, 12, 8), bodyMat);
    tailSeg.position.set(-100 - i * 24, 24 - i * 1.8, Math.sin(i * 0.8) * 14);
    tailSeg.castShadow = true;
    group.add(tailSeg);
  }
  const tailTipMat = new T.MeshStandardMaterial({ color: 0x8b0000, emissive: glowColor, emissiveIntensity: 0.6, metalness: 0.3 });
  const tailTip = new T.Mesh(new T.ConeGeometry(5, 20, 6), tailTipMat);
  tailTip.position.set(-270, 12, Math.sin(4.8) * 14);
  tailTip.rotation.z = Math.PI / 2;
  group.add(tailTip);
  const tailBlade1 = new T.Mesh(new T.ConeGeometry(3, 12, 4), tailTipMat);
  tailBlade1.position.set(-268, 18, Math.sin(4.8) * 14 + 4);
  tailBlade1.rotation.z = 0.5;
  group.add(tailBlade1);
  const tailBlade2 = new T.Mesh(new T.ConeGeometry(3, 12, 4), tailTipMat);
  tailBlade2.position.set(-268, 18, Math.sin(4.8) * 14 - 4);
  tailBlade2.rotation.z = -0.5;
  group.add(tailBlade2);

  for (const side of [-1, 1]) {
    const wingGeo = new T.BufferGeometry();
    wingGeo.setAttribute("position", new T.Float32BufferAttribute([
      0, 0, 0,  -60, 30, side * 110,  -30, -6, side * 30,
      -60, 30, side * 110,  -100, 18, side * 80,  -30, -6, side * 30,
      0, 0, 0,  -30, -6, side * 30,  10, -4, side * 50,
      -60, 30, side * 110,  -40, 35, side * 130,  -100, 18, side * 80,
    ], 3));
    wingGeo.computeVertexNormals();
    const wing = new T.Mesh(wingGeo, wingMat);
    wing.position.set(-20, 48, 0);
    wing.castShadow = true;
    group.add(wing);
    if (side === 1) group._wingR = wing;
    else group._wingL = wing;
    const veinMat = new T.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.5, transparent: true, opacity: 0.4 });
    for (let v = 0; v < 3; v++) {
      const veinGeo = new T.CylinderGeometry(0.5, 0.3, 60 + v * 10, 4);
      const vein = new T.Mesh(veinGeo, veinMat);
      const ang = (v - 1) * 0.3;
      vein.position.set(-20 - 30 - v * 10, 48 + 10 + v * 5, side * (40 + v * 25));
      vein.rotation.z = ang * side + 0.5;
      vein.rotation.x = side * 0.3;
      group.add(vein);
    }
  }

  const fireLight = new T.PointLight(isEscapeDragon ? 0xff4400 : 0xff3366, 1.2, 400);
  fireLight.position.set(120, 46, 0);
  group.add(fireLight);
  group._fireLight = fireLight;
  const ambientGlow = new T.PointLight(glowColor, 0.4, 250);
  ambientGlow.position.set(0, 40, 0);
  group.add(ambientGlow);

  group.scale.setScalar(s);
  return group;
}

function createHazardMesh3D(hazard) {
  if (!window.THREE || !hazard) return null;
  const T = window.THREE;
  const ctor = hazard.constructor ? hazard.constructor.name : "";
  let mesh;

  if (ctor === "MergeConflict") {
    const g = new T.Group();
    const outer = new T.Mesh(
      new T.BoxGeometry(28, 28, 28),
      new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.8, wireframe: true })
    );
    g.add(outer);
    const mid = new T.Mesh(
      new T.BoxGeometry(22, 22, 22),
      new T.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff2244, emissiveIntensity: 0.4, wireframe: true, transparent: true, opacity: 0.5 })
    );
    mid.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    g.add(mid);
    const inner = new T.Mesh(
      new T.OctahedronGeometry(10, 1),
      new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff1a40, emissiveIntensity: 1.1, transparent: true, opacity: 0.75 })
    );
    g.add(inner);
    const arrowMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff4d6d, emissiveIntensity: 0.7, transparent: true, opacity: 0.7, side: T.DoubleSide });
    const arr1 = new T.Mesh(new T.PlaneGeometry(20, 6), arrowMat);
    arr1.rotation.y = Math.PI / 4;
    arr1.position.y = 2;
    g.add(arr1);
    const arr2 = new T.Mesh(new T.PlaneGeometry(20, 6), arrowMat);
    arr2.rotation.y = -Math.PI / 4;
    arr2.position.y = -2;
    g.add(arr2);
    const light = new T.PointLight(0xff4d6d, 0.7, 80);
    g.add(light);
    g.position.y = 16;
    mesh = g;

  } else if (ctor === "PlaceboPill") {
    // Pharmaceutical pill capsule (two-tone with Rx cross)
    const g = new T.Group();
    const halfL = new T.Mesh(
      new T.CapsuleGeometry(7, 10, 6, 8),
      new T.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.4 })
    );
    halfL.position.x = -5;
    halfL.rotation.z = Math.PI / 2;
    g.add(halfL);
    const halfR = new T.Mesh(
      new T.CapsuleGeometry(7, 10, 6, 8),
      new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffcc00, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.4 })
    );
    halfR.position.x = 5;
    halfR.rotation.z = Math.PI / 2;
    g.add(halfR);
    // Rx cross on surface
    const crossMat = new T.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.6 });
    const cv = new T.Mesh(new T.BoxGeometry(1.5, 10, 1.5), crossMat);
    g.add(cv);
    const ch = new T.Mesh(new T.BoxGeometry(8, 1.5, 1.5), crossMat);
    ch.position.y = 2;
    g.add(ch);
    g.position.y = 13;
    mesh = g;

  } else if (ctor === "DoubleBlindCloud") {
    // Dense volumetric fog cloud made of many overlapping billowed spheres
    const g = new T.Group();
    const baseR = Math.max(20, (hazard.r || 48) * 0.4);
    // Core cluster: many offset spheres at varying sizes for cloudiness
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const layerR = (i < 5) ? baseR * 0.5 : (i < 10 ? baseR * 0.7 : baseR * 0.35);
      const dist3 = (i < 5) ? 0 : (i < 10 ? baseR * 0.45 : baseR * 0.7);
      const yOff = (i % 3 === 0) ? 8 : (i % 3 === 1 ? 0 : -4);
      const s = new T.Mesh(
        new T.SphereGeometry(layerR, 8, 6),
        new T.MeshStandardMaterial({
          color: i < 5 ? 0xd480ff : 0xbd57ff,
          emissive: 0xbd57ff,
          emissiveIntensity: 0.3 + (i < 5 ? 0.2 : 0),
          transparent: true,
          opacity: i < 5 ? 0.22 : 0.12,
        })
      );
      s.position.set(Math.cos(ang) * dist3, yOff + Math.sin(i * 0.7) * 6, Math.sin(ang) * dist3);
      s._cloudIdx = i;
      g.add(s);
    }
    // Inner toxic glow
    const glow = new T.Mesh(
      new T.SphereGeometry(baseR * 0.3, 10, 8),
      new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbd57ff, emissiveIntensity: 1.5, transparent: true, opacity: 0.35 })
    );
    g.add(glow);
    const light = new T.PointLight(0xbd57ff, 0.8, 140);
    light.position.y = 5;
    g.add(light);
    g.position.y = 16;
    g._cloudBase = baseR;
    mesh = g;

  } else if (ctor === "RegulatoryProjectile") {
    const g = new T.Group();
    const enraged = hazard.enraged;
    const col = enraged ? 0xff7a18 : 0xff3366;
    const diamond = new T.Mesh(
      new T.OctahedronGeometry(enraged ? 18 : 14, 1),
      new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.0, transparent: true, opacity: 0.8, metalness: 0.4 })
    );
    g.add(diamond);
    const wireframe = new T.Mesh(
      new T.IcosahedronGeometry(enraged ? 22 : 17, 1),
      new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, wireframe: true, transparent: true, opacity: 0.45 })
    );
    g.add(wireframe);
    const innerGlow = new T.Mesh(
      new T.SphereGeometry(enraged ? 8 : 6, 10, 8),
      new T.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 1.5, transparent: true, opacity: 0.4 })
    );
    g.add(innerGlow);
    const trail = new T.PointLight(col, enraged ? 1.0 : 0.6, enraged ? 120 : 80);
    g.add(trail);
    g.position.y = 16;
    mesh = g;

  } else if (ctor === "DossierProjectile") {
    const g = new T.Group();
    const folderMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 });
    const back = new T.Mesh(new T.BoxGeometry(22, 26, 1.5), folderMat);
    back.position.z = -2;
    g.add(back);
    const frontMat = new T.MeshStandardMaterial({ color: 0x3ad0ee, emissive: 0x57f2ff, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.4 });
    const front = new T.Mesh(new T.BoxGeometry(22, 20, 1.5), frontMat);
    front.position.set(0, -3, 2);
    g.add(front);
    const tabMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 1.0 });
    const tab = new T.Mesh(new T.BoxGeometry(10, 5, 2), tabMat);
    tab.position.set(-4, 15, -2);
    g.add(tab);
    const paperMat = new T.MeshStandardMaterial({ color: 0xeeeeff, emissive: 0xffffff, emissiveIntensity: 0.2, side: T.DoubleSide });
    for (let p = 0; p < 4; p++) {
      const page = new T.Mesh(new T.BoxGeometry(18, 24, 0.4), paperMat);
      page.position.set(rand(-1, 1), 1 + p * 0.4, -0.5 + p * 0.7);
      page.rotation.z = (p - 1.5) * 0.035;
      g.add(page);
    }
    const lineMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.8 });
    for (let i = 0; i < 6; i++) {
      const line = new T.Mesh(new T.BoxGeometry(14 - (i % 2) * 4, 0.5, 0.3), lineMat);
      line.position.set(0, 9 - i * 3.5, 2.2);
      g.add(line);
    }
    const sealMat = new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.8 });
    const seal = new T.Mesh(new T.TorusGeometry(3.5, 0.5, 6, 12), sealMat);
    seal.position.set(6, -5, 2.5);
    g.add(seal);
    const trail = new T.PointLight(0x57f2ff, 0.7, 90);
    g.add(trail);
    g.position.y = 14;
    mesh = g;

  } else {
    // Generic hazard: glowing warning box
    const g = new T.Group();
    const box = new T.Mesh(
      new T.BoxGeometry(20, 20, 20),
      new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.65, wireframe: true })
    );
    g.add(box);
    const inner = new T.Mesh(
      new T.BoxGeometry(12, 12, 12),
      new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.5 })
    );
    g.add(inner);
    g.position.y = 12;
    mesh = g;
  }

  mesh._hazardRef = hazard;
  return mesh;
}

function buildAllKartModels() {
  if (!window.THREE || !THREE_STATE.scene) return;
  THREE_STATE.kartModels.forEach(m => {
    THREE_STATE.scene.remove(m);
    dispose3DObject(m);
  });
  THREE_STATE.kartModels.clear();
  for (const kart of getActiveKarts()) {
    const model = buildKartModel3D(kart.charId, kart.color);
    if (model) {
      THREE_STATE.scene.add(model);
      THREE_STATE.kartModels.set(kart, model);
    }
  }
}

function sync3DScene(time) {
  if (!THREE_STATE.scene || !game.player) return;
  const T = window.THREE;

  // Sync kart positions
  for (const [kart, model] of THREE_STATE.kartModels) {
    model.position.set(kart.x, kart.z || 0, kart.y);
    model.rotation.y = -kart.heading + Math.PI / 2;

    const z = kart.z || 0;
    const vz = kart.vz || 0;
    const base = model.userData._baseScale || 1;
    const squashY = 1 - Math.min(z * 0.003, 0.06) - (vz > 0 ? Math.min(vz * 0.008, 0.04) : 0);
    const squashXZ = 1 + (1 - squashY) * 0.2;
    model.scale.set(base * squashXZ, base * squashY, base * squashXZ);

    // Wheel spin based on speed
    if (model._wheels) {
      const spinRate = kart.speed() * 0.15;
      model._wheels.forEach(w => { w.rotation.x += spinRate; });
    }

    // Lean into turns (subtle body roll)
    const lateralV = kart.vx * Math.sin(kart.heading) - kart.vy * Math.cos(kart.heading);
    const targetLean = clamp(lateralV * 0.04, -0.18, 0.18);
    model.rotation.z = model.rotation.z * 0.85 + targetLean * 0.15;

    // Spinout rotation
    if (kart.spinoutTimer > 0) {
      model.rotation.y += kart.spinAngle;
    }

    // Shield visibility + rotation
    if (model._shieldMat) {
      const shieldOn = kart.shieldTimer > 0;
      model._shieldMat.opacity = shieldOn ? 0.35 + 0.15 * Math.sin(time * 0.005) : 0;
      if (model._shield) {
        model._shield.rotation.y = time * 0.001;
        model._shield.rotation.x = Math.sin(time * 0.0008) * 0.3;
      }
      if (model._shieldInner && model._shieldInner.material) {
        model._shieldInner.material.opacity = shieldOn ? 0.08 + 0.06 * Math.sin(time * 0.007) : 0;
      }
    }

    const boostMaterial = model.userData.boostMaterial;
    if (kart.boostTimer > 0) {
      if (boostMaterial) {
        boostMaterial.emissive.copy(boostMaterial.color);
        boostMaterial.emissiveIntensity = 0.4 + 0.3 * Math.sin(time * 0.01);
      }
      if (model._flameMat && model._flame) {
        model._flame.visible = true;
        model._flameMat.opacity = 0.7 + 0.2 * Math.sin(time * 0.03);
        const flameScale = 1 + 0.25 * Math.sin(time * 0.05);
        const speedStretch = 1 + Math.min(1.0, kart.speed() * 0.1);
        model._flame.scale.set(flameScale, speedStretch, flameScale);
        if (model._flame._coreMat) {
          model._flame._coreMat.opacity = 0.5 + 0.3 * Math.sin(time * 0.04);
        }
        if (model._flame._flameLight) {
          model._flame._flameLight.intensity = 0.8 + 0.4 * Math.sin(time * 0.06);
        }
      }
    } else {
      if (boostMaterial) {
        boostMaterial.emissiveIntensity = model.userData.boostBaseEmissiveIntensity || 0;
      }
      if (model._flameMat && model._flame) {
        model._flame.visible = false;
        model._flameMat.opacity = 0;
        if (model._flame._coreMat) model._flame._coreMat.opacity = 0;
        if (model._flame._flameLight) model._flame._flameLight.intensity = 0;
      }
    }
  }

  // Camera is now handled in setCameraForKart() called from draw3D()
  // Only set camera for single-player/P2P here (split-screen sets it per viewport in draw3D)
  const isSplitScreen = game.multiplayer && game.player2 && !game.p2pMode;
  if (!isSplitScreen) {
    setCameraForKart(getViewKart(), time);
  }

  const pk = game.player;
  const fx = Math.cos(pk.heading), fy = Math.sin(pk.heading);

  if (THREE_STATE.playerLight) {
    THREE_STATE.playerLight.position.set(pk.x, 150, pk.y);
  }
  if (THREE_STATE.dirLight) {
    THREE_STATE.dirLight.position.set(pk.x + 300, 600, pk.y - 300);
    THREE_STATE.dirLight.target.position.set(pk.x, 0, pk.y);
    THREE_STATE.dirLight.target.updateMatrixWorld();
  }
  if (THREE_STATE.rimLight) {
    THREE_STATE.rimLight.position.set(pk.x - 150, 120, pk.y + 150);
  }

  THREE_STATE.itemMeshes.forEach(m => {
    if (m._itemRef && !m._itemRef.active) { m.visible = false; return; }
    m.visible = true;
    const spin = (m._itemRef?.spin || 0) + time * 0.002;
    m.rotation.y = spin;
    m.rotation.x = Math.sin(time * 0.004 + m.position.x * 0.01) * 0.3;
    m.position.y = 22 + Math.sin(time * 0.003 + m.position.x * 0.01) * 5;
    if (m.children && m.children[1]) {
      m.children[1].rotation.y = spin * 0.7;
      m.children[1].rotation.x = -spin * 0.5;
    }
    if (m.children && m.children[2]) {
      m.children[2].rotation.y = -spin * 1.5;
      m.children[2].rotation.x = spin * 0.8;
    }
    if (m._innerMat) m._innerMat.emissiveIntensity = 0.8 + 0.5 * Math.sin(time * 0.008 + m.position.x * 0.01);
    if (m._outerMat) m._outerMat.opacity = 0.2 + 0.15 * Math.sin(time * 0.006 + m.position.x * 0.01);
    if (m._midMat) m._midMat.opacity = 0.1 + 0.1 * Math.sin(time * 0.007 + m.position.z * 0.01);
  });

  // Animate coins (spinning gold discs with bob)
  THREE_STATE.coinMeshes.forEach(m => {
    if (m._coinRef && m._coinRef.collected) { m.visible = false; return; }
    m.visible = true;
    m.rotation.y = time * 0.005;
    m.rotation.x = 0;
    m.position.y = 9 + Math.sin(time * 0.004 + m.position.x * 0.01) * 2.5;
    if (m._discMat) m._discMat.emissiveIntensity = 0.3 + 0.2 * Math.sin(time * 0.007 + m.position.z * 0.01);
  });

  // Ultimate 3D effects
  sync3DUltimates(time);

  THREE_STATE.boostPadMeshes.forEach(m => {
    const pulse = 0.55 + 0.35 * Math.sin(time * 0.01 + m.position.x * 0.01);
    if (m._padMat) m._padMat.emissiveIntensity = 0.4 + 0.4 * pulse;
    m.position.y = 1.5 + pulse * 0.5;
  });

  THREE_STATE.movingObjectMeshes.forEach(m => {
    const obj = m._movingObjectRef;
    if (!obj) return;
    m.position.set(obj.x, 24 + Math.sin(time * 0.01 + obj.idx) * 4, obj.y);
    m.rotation.y = -(obj.ang || 0) + Math.PI / 2;
    if (m.material) m.material.emissiveIntensity = 0.45 + 0.25 * Math.sin(time * 0.012 + obj.idx);
  });

  syncMergeTethers3D();

  // Move back light behind player
  if (THREE_STATE.backLight && pk) {
    THREE_STATE.backLight.position.set(pk.x - fx * 80, 60, pk.y - fy * 80);
  }

  syncHazards3D(time);
  syncDragons3D(time);
  update3DShockwaves();

  // Visual enhancements
  sync3DNameTags(time);
  sync3DSpeechBubbles(time);
  sync3DParticleEffects(time);
  sync3DCoinSparkles(time);
  sync3DItemBoxHalos(time);
  sync3DSkidMarks();
  sync3DSpectators(time);
  sync3DKartFlair(time);
  sync3DPillarRings(time);
}

function sync3DUltimates(time) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  // Manage per-kart ultimate aura meshes
  if (!THREE_STATE._ultAuras) THREE_STATE._ultAuras = new Map();

  for (const [kart, model] of THREE_STATE.kartModels) {
    const active = kart.ultActiveTimer > 0;
    let aura = THREE_STATE._ultAuras.get(kart);

    if (active && !aura) {
      aura = new T.Group();
      const kartColor = new T.Color(kart.color);

      // Expanding rings
      for (let i = 0; i < 3; i++) {
        const ringGeo = new T.TorusGeometry(20 + i * 8, 1.5, 8, 24);
        const ringMat = new T.MeshStandardMaterial({
          color: kartColor,
          emissive: kartColor,
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0.6,
          side: T.DoubleSide,
        });
        const ring = new T.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 8 + i * 5;
        ring._ringIdx = i;
        ring._ringMat = ringMat;
        aura.add(ring);
      }

      // Character-specific ultimate visuals
      if (kart.charId === "anton") {
        // Typo Storm: floating red glitch cubes orbiting
        for (let i = 0; i < 6; i++) {
          const cube = new T.Mesh(
            new T.BoxGeometry(4, 6, 1.5),
            new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 1.0, transparent: true, opacity: 0.8 })
          );
          cube._orbitIdx = i;
          cube._orbitRadius = 35;
          aura.add(cube);
        }
      } else if (kart.charId === "artur") {
        // Prayer Protocol: golden fire column
        const pillarGeo = new T.CylinderGeometry(6, 14, 60, 10);
        const pillarMat = new T.MeshStandardMaterial({ color: 0xff8a3b, emissive: 0xff8a3b, emissiveIntensity: 1.5, transparent: true, opacity: 0.3 });
        const pillar = new T.Mesh(pillarGeo, pillarMat);
        pillar.position.y = 30;
        aura.add(pillar);
        aura._pillarMat = pillarMat;
      } else if (kart.charId === "rissal") {
        // Panic Deploy: swirling green panic clouds
        for (let i = 0; i < 4; i++) {
          const cloud = new T.Mesh(
            new T.SphereGeometry(10, 8, 6),
            new T.MeshStandardMaterial({ color: 0x4dffaa, emissive: 0x4dffaa, emissiveIntensity: 0.8, transparent: true, opacity: 0.3 })
          );
          cloud._orbitIdx = i;
          cloud._orbitRadius = 40;
          aura.add(cloud);
        }
      } else if (kart.charId === "pia") {
        // ThinkPad Slam: purple shockwave spheres
        const slamSphere = new T.Mesh(
          new T.SphereGeometry(30, 16, 12),
          new T.MeshStandardMaterial({ color: 0x9d4dff, emissive: 0x9d4dff, emissiveIntensity: 0.9, transparent: true, opacity: 0.2, side: T.DoubleSide })
        );
        slamSphere.position.y = 10;
        aura.add(slamSphere);
        aura._slamSphere = slamSphere;
      } else if (kart.charId === "florian") {
        // Regulatory Lockdown: cyan holographic shield grid
        const gridGeo = new T.IcosahedronGeometry(32, 1);
        const gridMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 0.7, wireframe: true, transparent: true, opacity: 0.5 });
        const grid = new T.Mesh(gridGeo, gridMat);
        grid.position.y = 12;
        aura.add(grid);
        aura._gridMat = gridMat;
      }

      // Aura point light
      const auraLight = new T.PointLight(kartColor, 1.2, 200);
      auraLight.position.y = 20;
      aura.add(auraLight);
      aura._auraLight = auraLight;

      THREE_STATE.scene.add(aura);
      THREE_STATE._ultAuras.set(kart, aura);
    }

    if (aura) {
      if (!active) {
        THREE_STATE.scene.remove(aura);
        dispose3DObject(aura);
        THREE_STATE._ultAuras.delete(kart);
        continue;
      }

      aura.position.set(kart.x, 0, kart.y);
      const t = time * 0.001;

      // Animate rings
      aura.children.forEach(child => {
        if (child._ringIdx !== undefined) {
          const i = child._ringIdx;
          child.rotation.z = t * (1 + i * 0.3);
          child.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.15);
          if (child._ringMat) child._ringMat.opacity = 0.4 + 0.25 * Math.sin(t * 3 + i * 1.5);
        }

        // Orbiting objects (Anton typo cubes, Rissal clouds)
        if (child._orbitIdx !== undefined) {
          const i = child._orbitIdx;
          const r = child._orbitRadius;
          const ang = t * 2.5 + (i / 6) * Math.PI * 2;
          child.position.set(Math.cos(ang) * r, 15 + Math.sin(t * 4 + i) * 6, Math.sin(ang) * r);
          child.rotation.y = t * 3;
          child.rotation.x = t * 2;
        }
      });

      // Character-specific animations
      if (aura._pillarMat) {
        aura._pillarMat.opacity = 0.2 + 0.2 * Math.sin(t * 5);
        aura._pillarMat.emissiveIntensity = 1.0 + 0.8 * Math.sin(t * 4);
      }
      if (aura._slamSphere) {
        const pulse = 1 + 0.3 * Math.sin(t * 6);
        aura._slamSphere.scale.setScalar(pulse);
        aura._slamSphere.material.opacity = 0.15 + 0.1 * Math.sin(t * 4);
      }
      if (aura._gridMat) {
        aura._gridMat.opacity = 0.3 + 0.2 * Math.sin(t * 3);
      }
      if (aura._auraLight) {
        aura._auraLight.intensity = 0.8 + 0.6 * Math.sin(t * 4);
      }
    }
  }
}

// 3D shockwave expanding ring effects
if (!THREE_STATE._shockwaves) THREE_STATE._shockwaves = [];

function spawn3DShockwave(x, z, maxRadius, colorHex) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;
  const col = new T.Color(colorHex);
  for (let i = 0; i < 3; i++) {
    const ringGeo = new T.TorusGeometry(10, 2.5 - i * 0.5, 8, 32);
    const ringMat = new T.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 1.5,
      transparent: true, opacity: 0.85, side: T.DoubleSide,
    });
    const ring = new T.Mesh(ringGeo, ringMat);
    ring.position.set(x, 8 + i * 6, z);
    ring.rotation.x = Math.PI / 2;
    THREE_STATE.scene.add(ring);
    const light = (i === 0) ? new T.PointLight(col, 1.5, maxRadius * 2) : null;
    if (light) { light.position.set(x, 20, z); THREE_STATE.scene.add(light); }
    THREE_STATE._shockwaves.push({
      mesh: ring, light, maxRadius, age: 0, delay: i * 4,
      startX: x, startZ: z,
    });
  }
}

function update3DShockwaves() {
  if (!THREE_STATE._shockwaves.length) return;
  const toRemove = [];
  for (const sw of THREE_STATE._shockwaves) {
    sw.age++;
    if (sw.age < sw.delay) { sw.mesh.visible = false; continue; }
    sw.mesh.visible = true;
    const life = sw.age - sw.delay;
    const maxLife = 45;
    const t = life / maxLife;
    if (t >= 1) { toRemove.push(sw); continue; }
    const currentR = sw.maxRadius * t;
    const scale = Math.max(0.1, currentR / 10);
    sw.mesh.scale.set(scale, scale, 1);
    sw.mesh.material.opacity = (1 - t) * 0.8;
    sw.mesh.material.emissiveIntensity = (1 - t) * 2.0;
    if (sw.light) {
      sw.light.intensity = (1 - t) * 2.0;
    }
  }
  for (const sw of toRemove) {
    THREE_STATE.scene.remove(sw.mesh);
    dispose3DObject(sw.mesh);
    if (sw.light) THREE_STATE.scene.remove(sw.light);
    THREE_STATE._shockwaves.splice(THREE_STATE._shockwaves.indexOf(sw), 1);
  }
}

function syncHazards3D(time) {
  if (!THREE_STATE.scene || !window.THREE) return;
  const live = new Set(game.hazards || []);
  for (const hazard of live) {
    if (!hazard || hazard.active === false) continue;
    let mesh = THREE_STATE.hazardMeshes.get(hazard);
    if (!mesh) {
      mesh = createHazardMesh3D(hazard);
      if (!mesh) continue;
      THREE_STATE.scene.add(mesh);
      THREE_STATE.hazardMeshes.set(hazard, mesh);
    }
    mesh.visible = true;
    mesh.position.x = hazard.x;
    mesh.position.z = hazard.y;
    mesh.rotation.y = -(hazard.heading || 0) + Math.PI / 2 + (hazard.spin || 0);
    const ctor2 = hazard.constructor?.name || "";
    if (ctor2 === "DoubleBlindCloud") {
      const a = clamp((hazard.life || 240) / 240, 0, 1);
      const sizeScale = Math.min(1.4, (hazard.r || 48) / 48);
      mesh.scale.setScalar(sizeScale * (1 + Math.sin(time * 0.004 + (hazard.phase || 0)) * 0.06));
      // Animate individual cloud puffs for roiling effect
      mesh.children.forEach(child => {
        if (child._cloudIdx !== undefined) {
          const ci = child._cloudIdx;
          child.position.y += Math.sin(time * 0.003 + ci * 0.9) * 0.04;
          child.position.x += Math.cos(time * 0.002 + ci * 1.1) * 0.03;
          child.position.z += Math.sin(time * 0.0025 + ci * 0.7) * 0.03;
          if (child.material) child.material.opacity = (ci < 5 ? 0.18 : 0.10) * a + Math.sin(time * 0.005 + ci) * 0.04;
        }
      });
    } else if (ctor2 !== "DoubleBlindCloud") {
      mesh.rotation.x += 0.03;
    }
  }
  for (const [hazard, mesh] of THREE_STATE.hazardMeshes) {
    if (!live.has(hazard) || hazard.active === false) {
      THREE_STATE.scene.remove(mesh);
      dispose3DObject(mesh);
      THREE_STATE.hazardMeshes.delete(hazard);
    }
  }
}

function animateDragonModel(model, wingPhase, jawPhase, enraged, time) {
  if (!model) return;
  const wingAmp = enraged ? 0.55 : 0.38;
  if (model._wingR) model._wingR.rotation.x = Math.sin(wingPhase) * wingAmp;
  if (model._wingL) model._wingL.rotation.x = -Math.sin(wingPhase) * wingAmp;
  if (model._lowerJaw) {
    const jawOpen = (enraged ? 6 : 4) * Math.max(0, Math.sin(jawPhase));
    model._lowerJaw.position.y = 38 - jawOpen;
  }
  if (model._fireLight) {
    model._fireLight.intensity = enraged ? 1.2 + 0.6 * Math.sin(time * 0.012) : 0.5 + 0.3 * Math.sin(time * 0.008);
  }
}

function syncDragons3D(time) {
  if (!THREE_STATE.scene) return;
  const dragon = game.track && game.track.regulatoryDragon;
  const currentMapId = MAPS[game.selectedMapIdx || 0].id;
  if (dragon && currentMapId !== "dragon_escape" && !THREE_STATE.dragonModel) {
    THREE_STATE.dragonModel = buildDragonModel3D(false);
    if (THREE_STATE.dragonModel) THREE_STATE.scene.add(THREE_STATE.dragonModel);
  }
  if (THREE_STATE.dragonModel) {
    THREE_STATE.dragonModel.visible = !!(dragon && dragon.active && currentMapId !== "dragon_escape");
    if (dragon && dragon.active) {
      const dragonHover = 42 + Math.sin(time * 0.002) * 12;
      THREE_STATE.dragonModel.position.set(dragon.x, dragonHover, dragon.y);
      THREE_STATE.dragonModel.rotation.y = -dragon.heading;
      const scale = dragon.enraged ? 1.55 : 1.35;
      THREE_STATE.dragonModel.scale.setScalar(scale);
      animateDragonModel(THREE_STATE.dragonModel, dragon.wingPhase || time * 0.004, dragon.jawPhase || time * 0.006, dragon.enraged, time);
    }
  }

  if (currentMapId === "dragon_escape" && !THREE_STATE.dragonEscapeModel) {
    THREE_STATE.dragonEscapeModel = buildDragonModel3D(true);
    if (THREE_STATE.dragonEscapeModel) THREE_STATE.scene.add(THREE_STATE.dragonEscapeModel);
  }
  if (THREE_STATE.dragonEscapeModel) {
    const escapeDragon = game.dragonEscape;
    THREE_STATE.dragonEscapeModel.visible = !!(escapeDragon && escapeDragon.active && currentMapId === "dragon_escape");
    if (escapeDragon && escapeDragon.active) {
      const bob = Math.sin(time * 0.002) * 30;
      THREE_STATE.dragonEscapeModel.position.set(escapeDragon.x, 16 + bob, escapeDragon.y);
      THREE_STATE.dragonEscapeModel.rotation.y = -escapeDragon.heading;
      animateDragonModel(
        THREE_STATE.dragonEscapeModel,
        escapeDragon.wingPhase || time * 0.007,
        escapeDragon.jawPhase || time * 0.009,
        escapeDragon.enraged,
        time
      );
    }
  }
}

function sync3DFirmamentToCamera() {
  if (!THREE_STATE.camera) return;
  if (THREE_STATE.skyMesh) THREE_STATE.skyMesh.position.copy(THREE_STATE.camera.position);
  if (THREE_STATE.starField) THREE_STATE.starField.position.copy(THREE_STATE.camera.position);
}

function setCameraForKart(kart, time) {
  if (!kart) return;
  const fx = Math.cos(kart.heading), fy = Math.sin(kart.heading);
  const sp = kart.speed();
  const mapId = MAPS[game.selectedMapIdx || 0].id;
  const isDragonChaseView = !!(
    (game.track?.regulatoryDragon?.active && mapId === "regulatory_dragon_run") ||
    (game.dragonEscape?.active && mapId === "dragon_escape")
  );
  const camDist = 140 + sp * 8 + (isDragonChaseView ? 95 : 0);
  const camHeight = 70 + sp * 5 + (isDragonChaseView ? 16 : 0);
  const lookAhead = 60 + sp * 15 + (isDragonChaseView ? 22 : 0);

  const targetX = kart.x - fx * camDist;
  const targetZ = kart.y - fy * camDist;
  const targetCamHeight = camHeight;
  const lookX = kart.x + fx * lookAhead;
  const lookZ = kart.y + fy * lookAhead;
  const lookY = (isDragonChaseView ? 15 : 12) + Math.min(kart.z || 0, 40) * 0.35;

  const cs = THREE_STATE.camSmooth;
  const sm = 0.06;
  cs.x += (targetX - cs.x) * sm;
  cs.y += (targetCamHeight - cs.y) * sm;
  cs.z += (targetZ - cs.z) * sm;
  cs.lx += (lookX - cs.lx) * sm;
  cs.ly += (lookY - cs.ly) * sm;
  cs.lz += (lookZ - cs.lz) * sm;

  const shake = game.shake || 0;
  THREE_STATE.camera.position.set(cs.x + (Math.random() - 0.5) * shake * 1.5, cs.y + (Math.random() - 0.5) * shake * 1.5, cs.z);
  THREE_STATE.camera.lookAt(cs.lx, cs.ly, cs.lz);

  const targetFov = 70 + sp * 4 + (kart.boostTimer > 0 ? 10 : 0) + (isDragonChaseView ? 4 : 0);
  THREE_STATE.camera.fov += (targetFov - THREE_STATE.camera.fov) * 0.05;
  THREE_STATE.camera.updateProjectionMatrix();
  sync3DFirmamentToCamera();
}

/* ============================================================
   3D VISUAL ENHANCEMENTS
   ============================================================ */

const _spriteCanvasCache = new Map();
function makeTextSprite(text, opts = {}) {
  const T = window.THREE;
  const fontSize = opts.fontSize || 28;
  const fontFamily = opts.fontFamily || "'SFMono-Regular', Consolas, monospace";
  const color = opts.color || "#ffffff";
  const bgColor = opts.bgColor || "rgba(10, 8, 28, 0.88)";
  const borderColor = opts.borderColor || "#7b75ff";
  const padding = opts.padding || 12;
  const maxWidth = opts.maxWidth || 400;

  const c = document.createElement("canvas");
  const cx = c.getContext("2d");
  cx.font = `bold ${fontSize}px ${fontFamily}`;
  const tw = Math.min(cx.measureText(text).width, maxWidth);
  const w = tw + padding * 2 + 4;
  const h = fontSize + padding * 2;
  c.width = Math.ceil(w * 2); c.height = Math.ceil(h * 2);
  cx.scale(2, 2);

  cx.fillStyle = bgColor;
  cx.strokeStyle = borderColor;
  cx.lineWidth = 2;
  cx.beginPath();
  const rr = 8;
  cx.moveTo(rr, 0); cx.lineTo(w - rr, 0); cx.quadraticCurveTo(w, 0, w, rr);
  cx.lineTo(w, h - rr); cx.quadraticCurveTo(w, h, w - rr, h);
  cx.lineTo(rr, h); cx.quadraticCurveTo(0, h, 0, h - rr);
  cx.lineTo(0, rr); cx.quadraticCurveTo(0, 0, rr, 0);
  cx.closePath();
  cx.fill(); cx.stroke();

  if (opts.showStem) {
    cx.fillStyle = bgColor;
    cx.beginPath();
    cx.moveTo(w / 2 - 6, h); cx.lineTo(w / 2, h + 8); cx.lineTo(w / 2 + 6, h);
    cx.closePath(); cx.fill();
    cx.beginPath();
    cx.moveTo(w / 2 - 6, h); cx.lineTo(w / 2, h + 8); cx.lineTo(w / 2 + 6, h);
    cx.stroke();
  }

  cx.fillStyle = color;
  cx.font = `bold ${fontSize}px ${fontFamily}`;
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillText(text, w / 2, h / 2);

  const tex = new T.CanvasTexture(c);
  tex.minFilter = T.LinearFilter;
  const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
  const sprite = new T.Sprite(mat);
  sprite.scale.set(w * 0.12, (opts.showStem ? h + 8 : h) * 0.12, 1);
  sprite._spriteW = w;
  sprite._spriteH = h;
  return sprite;
}

function sync3DNameTags(time) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;
  const activeKarts = getActiveKarts();

  for (const kart of activeKarts) {
    if (kart.eliminated) {
      const old = THREE_STATE.nameTagSprites.get(kart);
      if (old) { THREE_STATE.scene.remove(old); THREE_STATE.nameTagSprites.delete(kart); }
      continue;
    }
    let sprite = THREE_STATE.nameTagSprites.get(kart);
    if (sprite && sprite._nameTagVersion !== 2) {
      THREE_STATE.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      THREE_STATE.nameTagSprites.delete(kart);
      sprite = null;
    }
    if (!sprite) {
      sprite = makeTextSprite(kart.name, {
        fontSize: 33,
        color: kart.color,
        bgColor: "rgba(6, 5, 20, 0.75)",
        borderColor: kart.color,
        padding: 10,
      });
      sprite._nameTagVersion = 2;
      THREE_STATE.scene.add(sprite);
      THREE_STATE.nameTagSprites.set(kart, sprite);
    }
    sprite.position.set(kart.x, 34, kart.y);
    const isUlt = kart.ultActiveTimer > 0;
    sprite.material.opacity = isUlt ? 0.6 + 0.3 * Math.sin(time * 0.02) : 0.85;
  }

  for (const [kart, sprite] of THREE_STATE.nameTagSprites) {
    if (!activeKarts.includes(kart)) {
      THREE_STATE.scene.remove(sprite);
      THREE_STATE.nameTagSprites.delete(kart);
    }
  }
}

function sync3DSpeechBubbles(time) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  for (const kart of getActiveKarts()) {
    const hasQuote = kart.activeQuote && kart.quoteTimer > 0;
    let sprite = THREE_STATE.speechBubbleSprites.get(kart);

    if (hasQuote && !sprite) {
      sprite = makeTextSprite(kart.activeQuote, {
        fontSize: 48,
        color: "#ffffff",
        bgColor: "rgba(10, 8, 28, 0.92)",
        borderColor: kart.color || "#ffffff",
        padding: 20,
        maxWidth: 800,
        showStem: true,
      });
      THREE_STATE.scene.add(sprite);
      THREE_STATE.speechBubbleSprites.set(kart, sprite);
      sprite._quoteText = kart.activeQuote;
    }

    if (sprite) {
      if (!hasQuote || kart.activeQuote !== sprite._quoteText) {
        THREE_STATE.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        THREE_STATE.speechBubbleSprites.delete(kart);
        if (hasQuote) {
          const newSprite = makeTextSprite(kart.activeQuote, {
            fontSize: 48, color: "#ffffff",
            bgColor: "rgba(10, 8, 28, 0.92)",
            borderColor: kart.color || "#ffffff",
            padding: 20, maxWidth: 800, showStem: true,
          });
          THREE_STATE.scene.add(newSprite);
          THREE_STATE.speechBubbleSprites.set(kart, newSprite);
          newSprite._quoteText = kart.activeQuote;
          newSprite.position.set(kart.x, 58, kart.y);
        }
        continue;
      }
      sprite.position.set(kart.x, 58, kart.y);
      const fadeIn = Math.min(1, kart.quoteTimer / 10);
      sprite.material.opacity = fadeIn;
    }
  }
}

// Lightweight 3D particle system using a single Points object
const PARTICLE_3D_MAX = 250;
const _p3dPositions = new Float32Array(PARTICLE_3D_MAX * 3);
const _p3dColors = new Float32Array(PARTICLE_3D_MAX * 3);
const _p3dSizes = new Float32Array(PARTICLE_3D_MAX);
const _p3dPool = [];
let _p3dCount = 0;

function init3DParticles() {
  if (!window.THREE || THREE_STATE.particles3dSystem) return;
  const T = window.THREE;
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(_p3dPositions, 3));
  geo.setAttribute("color", new T.BufferAttribute(_p3dColors, 3));
  geo.setAttribute("size", new T.BufferAttribute(_p3dSizes, 1));
  geo.setDrawRange(0, 0);
  const mat = new T.PointsMaterial({
    size: 4, sizeAttenuation: true, transparent: true, opacity: 0.85,
    vertexColors: true, depthWrite: false, blending: T.AdditiveBlending,
  });
  const points = new T.Points(geo, mat);
  points.frustumCulled = false;
  THREE_STATE.scene.add(points);
  THREE_STATE.particles3dSystem = points;
}

function emit3DParticle(x, y, z, vx, vy, vz, r, g, b, life, size) {
  if (_p3dCount >= PARTICLE_3D_MAX) return;
  _p3dPool.push({ x, y, z, vx, vy, vz, r, g, b, life, maxLife: life, size: size || 3, drag: 0.96 });
}

function emit3DBurst(x, y, z, r, g, b, count, spread, life) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * TAU;
    const up = Math.random() * spread;
    const sp = 0.5 + Math.random() * spread;
    emit3DParticle(
      x + (Math.random() - 0.5) * 4, y + Math.random() * 4, z + (Math.random() - 0.5) * 4,
      Math.cos(ang) * sp, up, Math.sin(ang) * sp,
      r, g, b, life || 40, 2 + Math.random() * 3
    );
  }
}

function update3DParticles(dt) {
  if (!THREE_STATE.particles3dSystem) return;
  const alive = [];
  for (let i = _p3dPool.length - 1; i >= 0; i--) {
    const p = _p3dPool[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 0.02 * dt;
    p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
    alive.push(p);
  }
  _p3dPool.length = 0;
  for (const p of alive) _p3dPool.push(p);
  _p3dCount = alive.length;

  for (let i = 0; i < _p3dCount; i++) {
    const p = alive[i];
    const fade = p.life / p.maxLife;
    _p3dPositions[i * 3] = p.x;
    _p3dPositions[i * 3 + 1] = p.y;
    _p3dPositions[i * 3 + 2] = p.z;
    _p3dColors[i * 3] = p.r * fade;
    _p3dColors[i * 3 + 1] = p.g * fade;
    _p3dColors[i * 3 + 2] = p.b * fade;
    _p3dSizes[i] = p.size * (0.5 + fade * 0.5);
  }
  const geo = THREE_STATE.particles3dSystem.geometry;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.attributes.size.needsUpdate = true;
  geo.setDrawRange(0, _p3dCount);
}

function sync3DParticleEffects(time) {
  const dt = game.lastDt || 1;
  for (const [kart, model] of THREE_STATE.kartModels) {
    const fxCos = Math.cos(kart.heading), fxSin = Math.sin(kart.heading);

    // Boost exhaust particles
    if (kart.boostTimer > 0 && Math.random() < 0.6 * dt) {
      const bx = kart.x - fxCos * 18, bz = kart.y - fxSin * 18;
      emit3DParticle(
        bx + (Math.random() - 0.5) * 6, 4 + Math.random() * 6, bz + (Math.random() - 0.5) * 6,
        -fxCos * (2 + Math.random() * 3) + (Math.random() - 0.5), Math.random() * 2, -fxSin * (2 + Math.random() * 3) + (Math.random() - 0.5),
        1.0, 0.4 + Math.random() * 0.4, 0.1, 20 + Math.random() * 15, 3 + Math.random() * 3
      );
    }

    // Drift sparks
    if (kart._driftTimer > 0 && Math.abs(kart.forwardSpeed()) > 1.5 && Math.random() < 0.5 * dt) {
      const lx = -fxSin, lz = fxCos;
      for (const side of [-1, 1]) {
        const sx = kart.x - fxCos * 10 + lx * side * 7;
        const sz = kart.y - fxSin * 10 + lz * side * 7;
        const tier = kart.driftCharge || 0;
        const cr = tier > 80 ? 1.0 : tier > 40 ? 1.0 : 0.3;
        const cg = tier > 80 ? 0.5 : tier > 40 ? 0.7 : 0.7;
        const cb = tier > 80 ? 0.2 : tier > 40 ? 0.15 : 1.0;
        emit3DParticle(
          sx, 2, sz,
          (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2,
          cr, cg, cb, 12 + Math.random() * 10, 2 + Math.random() * 2
        );
      }
    }

    // Off-road dust
    const onRoad = game.track && game.track.isOnRoad(kart.x, kart.y);
    if (!onRoad && kart.speed() > 1.0 && Math.random() < 0.3 * dt) {
      emit3DParticle(
        kart.x + (Math.random() - 0.5) * 8, 1, kart.y + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 1.5, 0.5 + Math.random(), (Math.random() - 0.5) * 1.5,
        0.15, 0.5, 0.2, 25, 4 + Math.random() * 3
      );
    }
  }
  update3DParticles(dt);
}

// 3D skid marks - shared geometry, pooled MeshBasicMaterial (cheap)
const SKID_3D_MAX = 200;
let _skidGeo3d = null;
let _skidMatDark = null;
let _skidMatNeon = null;
const _skidFreePool = [];

function recycleAll3DSkidMarks() {
  if (!THREE_STATE.scene) return;
  for (const skid of THREE_STATE.skidMarks3d) {
    THREE_STATE.scene.remove(skid.mesh);
    skid.mesh.visible = false;
    if (_skidFreePool.indexOf(skid.mesh) < 0) _skidFreePool.push(skid.mesh);
  }
  THREE_STATE.skidMarks3d = [];
}

function getSkidMark3D(isNeon) {
  if (!window.THREE) return null;
  const T = window.THREE;
  if (!_skidGeo3d) _skidGeo3d = new T.PlaneGeometry(4, 6);
  if (!_skidMatDark) _skidMatDark = new T.MeshBasicMaterial({ color: 0x141420, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide });
  if (!_skidMatNeon) _skidMatNeon = new T.MeshBasicMaterial({ color: 0x4dffaa, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide });
  if (_skidFreePool.length > 0) {
    const m = _skidFreePool.pop();
    m.material = isNeon ? _skidMatNeon : _skidMatDark;
    m.visible = true;
    return m;
  }
  return new T.Mesh(_skidGeo3d, isNeon ? _skidMatNeon : _skidMatDark);
}

function sync3DSkidMarks() {
  if (!window.THREE || !THREE_STATE.scene) return;
  const dt = game.lastDt || 1;

  for (const [kart] of THREE_STATE.kartModels) {
    if (kart._driftTimer > 0 && Math.abs(kart.forwardSpeed()) > 1.5) {
      if (!kart._skid3dTimer) kart._skid3dTimer = 0;
      kart._skid3dTimer -= dt;
      if (kart._skid3dTimer <= 0) {
        kart._skid3dTimer = 2.5;
        const fxCos = Math.cos(kart.heading), fxSin = Math.sin(kart.heading);
        const lx = -fxSin, lz = fxCos;
        const isRissal = kart.charId === "rissal";
        for (const side of [-1, 1]) {
          const sx = kart.x - fxCos * 10 + lx * side * 7;
          const sz = kart.y - fxSin * 10 + lz * side * 7;
          const mesh = getSkidMark3D(isRissal);
          if (!mesh) continue;
          mesh.rotation.x = -Math.PI / 2;
          mesh.rotation.z = -kart.heading;
          mesh.position.set(sx, 0.6, sz);
          THREE_STATE.scene.add(mesh);
          THREE_STATE.skidMarks3d.push({ mesh, life: 250, maxLife: 250 });
        }
      }
    }
  }

  for (let i = THREE_STATE.skidMarks3d.length - 1; i >= 0; i--) {
    const s = THREE_STATE.skidMarks3d[i];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      THREE_STATE.scene.remove(s.mesh);
      _skidFreePool.push(s.mesh);
      THREE_STATE.skidMarks3d.splice(i, 1);
    }
  }

  while (THREE_STATE.skidMarks3d.length > SKID_3D_MAX) {
    const oldest = THREE_STATE.skidMarks3d.shift();
    oldest.mesh.visible = false;
    THREE_STATE.scene.remove(oldest.mesh);
    _skidFreePool.push(oldest.mesh);
  }
}

// 3D spectators: low-poly stick figures placed along track edges
function build3DSpectators() {
  if (!window.THREE || !THREE_STATE.scene || !game.track || !game.track.spectators) return;
  const T = window.THREE;

  THREE_STATE.spectatorMeshes.forEach(s => { THREE_STATE.scene.remove(s.group); });
  THREE_STATE.spectatorMeshes = [];

  const specs = game.track.spectators;
  const maxSpecs = Math.min(specs.length, 40);
  const step = Math.max(1, Math.floor(specs.length / maxSpecs));

  for (let si = 0; si < specs.length; si += step) {
    const sp = specs[si];
    const group = new T.Group();
    const col = new T.Color(sp.color);
    const h = sp.height || 7;

    // Body
    const bodyMat = new T.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.1 });
    const body = new T.Mesh(new T.BoxGeometry(2.5, h * 0.55, 2), bodyMat);
    body.position.y = h * 0.45;
    group.add(body);

    // Head
    const head = new T.Mesh(new T.SphereGeometry(2, 8, 6), bodyMat);
    head.position.y = h + 1;
    group.add(head);

    // Legs
    const legMat = new T.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 });
    for (const lx of [-0.7, 0.7]) {
      const leg = new T.Mesh(new T.BoxGeometry(1.2, h * 0.45, 1.2), legMat);
      leg.position.set(lx, h * 0.22, 0);
      group.add(leg);
    }

    // Arms (will be animated)
    for (const ax of [-1.8, 1.8]) {
      const arm = new T.Mesh(new T.BoxGeometry(1, h * 0.4, 1), bodyMat);
      arm.position.set(ax, h * 0.55, 0);
      group.add(arm);
    }

    group.position.set(sp.x, 0, sp.y);
    group.scale.setScalar(1.2);
    THREE_STATE.scene.add(group);
    THREE_STATE.spectatorMeshes.push({
      group, sp, baseY: 0,
      armL: group.children[3],
      armR: group.children[4],
    });
  }
}

function sync3DSpectators(time) {
  for (const s of THREE_STATE.spectatorMeshes) {
    let cheering = false;
    for (const k of getActiveKarts()) {
      if (dist(s.sp.x, s.sp.y, k.x, k.y) < (s.sp.cheerThreshold || 120)) { cheering = true; break; }
    }
    const bounce = cheering ? Math.abs(Math.sin(time * 0.012 + (s.sp.phase || 0))) * 3 : 0;
    s.group.position.y = s.baseY + bounce;

    if (cheering) {
      const wave = Math.sin(time * 0.018 + (s.sp.phase || 0)) * 0.6;
      if (s.armL) s.armL.rotation.z = 0.5 + wave * 0.8;
      if (s.armR) s.armR.rotation.z = -0.5 - wave * 0.8;
    } else {
      if (s.armL) s.armL.rotation.z = 0;
      if (s.armR) s.armR.rotation.z = 0;
    }
  }
}

// Start/finish line on track surface
function build3DStartLine() {
  if (!window.THREE || !THREE_STATE.scene || !game.track || game.track.isOpen || isBattleMode()) return;
  const T = window.THREE;
  const gate = game.track.startLineGate();
  if (!gate) return;
  const roadW = gate.halfW * 2;
  const lineW = 12;

  const c = document.createElement("canvas");
  c.width = 128; c.height = 32;
  const cx = c.getContext("2d");
  const sq = 16;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      cx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "#111111";
      cx.fillRect(col * sq, row * sq, sq, sq);
    }
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = T.RepeatWrapping;
  tex.repeat.set(Math.max(1, Math.round(roadW / 40)), 1);

  const geo = new T.PlaneGeometry(roadW, lineW);
  const mat = new T.MeshStandardMaterial({
    map: tex, roughness: 0.5, metalness: 0.2,
    transparent: true, opacity: 0.85, side: T.DoubleSide,
  });
  const mesh = new T.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(gate.x, 0.7, gate.y);
  mesh.rotation.z = Math.atan2(gate.ny, gate.nx);
  THREE_STATE.scene.add(mesh);
  THREE_STATE.startLineMesh = mesh;
}

// Animate pillar rings (spin them) - uses cached list built in rebuild
function sync3DPillarRings(time) {
  for (const ring of THREE_STATE.pillarRings) {
    ring.rotation.z = time * 0.001 + ring.position.y * 0.1;
  }
}

// Coin sparkle trails (low frequency)
function sync3DCoinSparkles(time) {
  THREE_STATE.coinMeshes.forEach(m => {
    if (!m.visible || (m._coinRef && m._coinRef.collected)) return;
    if (Math.random() < 0.008) {
      emit3DParticle(
        m.position.x + (Math.random() - 0.5) * 8,
        m.position.y + (Math.random() - 0.5) * 4,
        m.position.z + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5,
        1.0, 0.85, 0.4, 25, 1.5 + Math.random() * 2
      );
    }
  });
}

// Item box glow halo (low frequency)
function sync3DItemBoxHalos(time) {
  THREE_STATE.itemMeshes.forEach(m => {
    if (!m.visible) return;
    if (Math.random() < 0.008) {
      emit3DParticle(
        m.position.x + (Math.random() - 0.5) * 15,
        m.position.y + (Math.random() - 0.5) * 10,
        m.position.z + (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3,
        1.0, 0.85, 0.42, 30, 2 + Math.random() * 2
      );
    }
  });
}

// Emit burst when item is collected (called from game logic hookpoint)
function emit3DItemPickupBurst(x, z, type) {
  if (!THREE_STATE.particles3dSystem) return;
  if (type === "coin") {
    emit3DBurst(x, 10, z, 1.0, 0.85, 0.42, 10, 2.5, 25);
  } else if (type === "itemBox") {
    emit3DBurst(x, 22, z, 1.0, 0.4, 0.8, 14, 3, 30);
  } else if (type === "boost") {
    emit3DBurst(x, 3, z, 0.64, 1.0, 0.5, 12, 3, 20);
  }
}

// Kart-specific 3D flair enhancements
function enhance3DKartModels() {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  for (const [kart, model] of THREE_STATE.kartModels) {
    if (model._flairAdded) continue;
    model._flairAdded = true;

    if (kart.charId === "anton") {
      // Antenna with spring bobble
      const antGeo = new T.CylinderGeometry(0.2, 0.3, 10, 6);
      const antMat = new T.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 });
      const antenna = new T.Mesh(antGeo, antMat);
      antenna.position.set(0, 14, -6);
      model.add(antenna);
      const tipMat = new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 1.2 });
      const tip = new T.Mesh(new T.SphereGeometry(1.2, 8, 6), tipMat);
      tip.position.set(0, 19.5, -6);
      model.add(tip);
      model._antennaTip = tip;

      // Speed stripes
      const stripeMat = new T.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.6, transparent: true, opacity: 0.6 });
      for (const sz of [-1.5, 1.5]) {
        const stripe = new T.Mesh(new T.BoxGeometry(8, 0.3, 0.6), stripeMat);
        stripe.position.set(0, 5.5, sz);
        model.add(stripe);
      }
    } else if (kart.charId === "artur") {
      // Flame decals as emissive mesh on sides
      const flameMat = new T.MeshStandardMaterial({ color: 0xff8a3b, emissive: 0xff8a3b, emissiveIntensity: 0.8, transparent: true, opacity: 0.6 });
      for (const side of [-1, 1]) {
        const flameGeo = new T.BufferGeometry();
        flameGeo.setAttribute("position", new T.Float32BufferAttribute([
          -6, 4, side * 9, 4, 6, side * 8, -2, 5.5, side * 7,
        ], 3));
        flameGeo.computeVertexNormals();
        const flame = new T.Mesh(flameGeo, flameMat);
        model.add(flame);
      }
      // Roof scoop
      const scoopMat = new T.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 });
      const scoop = new T.Mesh(new T.BoxGeometry(4, 3, 6), scoopMat);
      scoop.position.set(0, 10, -2);
      model.add(scoop);
    } else if (kart.charId === "rissal") {
      // Neon underglow strips
      const glowMat = new T.MeshStandardMaterial({ color: 0x4dffaa, emissive: 0x4dffaa, emissiveIntensity: 1.5, transparent: true, opacity: 0.7 });
      for (const side of [-1, 1]) {
        const strip = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 28), glowMat);
        strip.position.set(0, 1, side * 9);
        model.add(strip);
      }
      model._underglowMat = glowMat;
    } else if (kart.charId === "pia") {
      // Wider bumper bars
      const bumperMat = new T.MeshStandardMaterial({ color: 0x9d4dff, emissive: 0x9d4dff, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3 });
      const frontBumper = new T.Mesh(new T.BoxGeometry(1.5, 3, 20), bumperMat);
      frontBumper.position.set(0, 4, 16);
      model.add(frontBumper);
      const rearBumper = new T.Mesh(new T.BoxGeometry(1.5, 3, 20), bumperMat);
      rearBumper.position.set(0, 4, -14);
      model.add(rearBumper);
    } else if (kart.charId === "florian") {
      // Center racing stripe
      const stripeMat = new T.MeshStandardMaterial({ color: 0xa4ff80, emissive: 0xa4ff80, emissiveIntensity: 0.5, transparent: true, opacity: 0.5 });
      const stripe = new T.Mesh(new T.BoxGeometry(28, 0.3, 1.5), stripeMat);
      stripe.position.set(0, 6.2, 0);
      model.add(stripe);
      // Regulatory badge diamond
      const badgeMat = new T.MeshStandardMaterial({ color: 0x57f2ff, emissive: 0x57f2ff, emissiveIntensity: 1.0 });
      const badge = new T.Mesh(new T.OctahedronGeometry(1.5), badgeMat);
      badge.position.set(0, 7, 8);
      model.add(badge);
      model._badge = badge;
    }
  }
}

function sync3DKartFlair(time) {
  for (const [kart, model] of THREE_STATE.kartModels) {
    // Antenna bob for Anton
    if (kart.charId === "anton" && model._antennaTip) {
      model._antennaTip.position.y = 19.5 + Math.sin(time * 0.008 + kart.speed() * 0.3) * 1.5;
      model._antennaTip.position.x = Math.sin(time * 0.006) * 0.5;
    }
    // Rissal underglow pulse
    if (kart.charId === "rissal" && model._underglowMat) {
      model._underglowMat.emissiveIntensity = 1.0 + 0.8 * Math.sin(time * 0.008);
      model._underglowMat.opacity = 0.5 + 0.3 * Math.sin(time * 0.006);
    }
    // Florian badge spin
    if (kart.charId === "florian" && model._badge) {
      model._badge.rotation.y = time * 0.003;
    }
  }
}

function update3DProfile(renderMs, time) {
  if (!ENABLE_3D_PROFILE || !THREE_STATE.renderer) return;
  const info = THREE_STATE.renderer.info;
  const prev = THREE_STATE._profile || {
    lastTime: time,
    fps: 60,
    renderMs: 0,
  };
  const frameMs = Math.max(1, time - prev.lastTime);
  const fps = 1000 / frameMs;
  THREE_STATE._profile = {
    lastTime: time,
    fps: prev.fps * 0.9 + fps * 0.1,
    renderMs: prev.renderMs * 0.85 + renderMs * 0.15,
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
  };
}

function draw3DProfile(ctx) {
  const p = THREE_STATE._profile;
  if (!ENABLE_3D_PROFILE || !p) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(14, VIEW_H - 92, 180, 76);
  ctx.fillStyle = p.fps >= 45 ? "#a4ff80" : p.fps >= 25 ? "#ffd86b" : "#ff4d6d";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`3D ${p.fps.toFixed(0)} FPS`, 24, VIEW_H - 82);
  ctx.fillStyle = "#ebe4ff";
  ctx.fillText(`render ${p.renderMs.toFixed(1)}ms`, 24, VIEW_H - 64);
  ctx.fillText(`calls ${p.calls}`, 24, VIEW_H - 46);
  ctx.fillText(`tris ${Math.round(p.triangles / 1000)}k`, 24, VIEW_H - 28);
  ctx.restore();
}

function draw3D(time) {
  if (!THREE_STATE.renderer || !THREE_STATE.scene || !THREE_STATE.camera) return;
  const renderer = THREE_STATE.renderer;
  const renderStart = ENABLE_3D_PROFILE ? performance.now() : 0;

  sync3DScene(time);
  if (hudCtx) hudCtx.clearRect(0, 0, VIEW_W, VIEW_H);

  const isSplitScreen = game.multiplayer && game.player2 && !game.p2pMode;

  if (isSplitScreen) {
    const dpr = renderer.getPixelRatio();
    const fullW = Math.floor(VIEW_W * dpr);
    const fullH = Math.floor(VIEW_H * dpr);
    const halfW = Math.floor(fullW / 2);

    // Need autoClear off so the second render doesn't erase the first viewport
    renderer.autoClear = false;
    renderer.setScissorTest(true);

    // Initialize P2 cam smooth if needed
    if (!THREE_STATE._camSmoothP2) {
      THREE_STATE._camSmoothP2 = { x: game.player2.x, y: 70, z: game.player2.y, lx: game.player2.x, ly: 12, lz: game.player2.y };
    }

    // ---- Left viewport: Player 1 ----
    renderer.setViewport(0, 0, halfW, fullH);
    renderer.setScissor(0, 0, halfW, fullH);
    renderer.clear();
    THREE_STATE.camera.aspect = (VIEW_W / 2) / VIEW_H;
    THREE_STATE.camera.updateProjectionMatrix();
    setCameraForKart(game.player, time);
    renderer.render(THREE_STATE.scene, THREE_STATE.camera);
    _compassFxViewportLeft.x = 0;
    _compassFxViewportLeft.y = 0;
    _compassFxViewportLeft.width = VIEW_W / 2 - 2;
    _compassFxViewportLeft.height = VIEW_H;
    if (hudCtx) drawCompassFx3DOverlay(hudCtx, time, THREE_STATE.camera, _compassFxViewportLeft);

    // Save P1 cam state, load P2 cam state
    const savedP1 = { ...THREE_STATE.camSmooth };
    const savedP1CamX = THREE_STATE.camera.position.x;
    const savedP1CamY = THREE_STATE.camera.position.y;
    const savedP1CamZ = THREE_STATE.camera.position.z;
    const savedP1QuatX = THREE_STATE.camera.quaternion.x;
    const savedP1QuatY = THREE_STATE.camera.quaternion.y;
    const savedP1QuatZ = THREE_STATE.camera.quaternion.z;
    const savedP1QuatW = THREE_STATE.camera.quaternion.w;
    THREE_STATE.camSmooth = { ...THREE_STATE._camSmoothP2 };

    // ---- Right viewport: Player 2 ----
    renderer.setViewport(halfW + 2, 0, halfW - 2, fullH);
    renderer.setScissor(halfW + 2, 0, halfW - 2, fullH);
    setCameraForKart(game.player2, time);
    renderer.render(THREE_STATE.scene, THREE_STATE.camera);
    _compassFxViewportRight.x = VIEW_W / 2 + 2;
    _compassFxViewportRight.y = 0;
    _compassFxViewportRight.width = VIEW_W / 2 - 2;
    _compassFxViewportRight.height = VIEW_H;
    if (hudCtx) drawCompassFx3DOverlay(hudCtx, time, THREE_STATE.camera, _compassFxViewportRight);

    // Save P2 cam state, restore P1 cam state
    THREE_STATE._camSmoothP2 = { ...THREE_STATE.camSmooth };
    THREE_STATE.camSmooth = savedP1;
    THREE_STATE.camera.position.set(savedP1CamX, savedP1CamY, savedP1CamZ);
    THREE_STATE.camera.quaternion.set(savedP1QuatX, savedP1QuatY, savedP1QuatZ, savedP1QuatW);

    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.setViewport(0, 0, fullW, fullH);
    THREE_STATE.camera.aspect = VIEW_W / VIEW_H;
    THREE_STATE.camera.updateProjectionMatrix();
    THREE_STATE.camera.updateMatrixWorld();
    sync3DFirmamentToCamera();
  } else {
    renderer.render(THREE_STATE.scene, THREE_STATE.camera);
  }
  if (ENABLE_3D_PROFILE) update3DProfile(performance.now() - renderStart, time);

  // Draw HUD on overlay canvas
  if (hudCtx) {
    const origCtx = ctx;
    ctx = hudCtx;
    if (isSplitScreen) {
      drawHUDMultiplayer(time);
      // Draw split-screen divider
      hudCtx.fillStyle = "rgba(8, 6, 26, 0.75)";
      hudCtx.fillRect(VIEW_W / 2 - 3, 0, 6, VIEW_H);
      const grad = hudCtx.createLinearGradient(0, 0, 0, VIEW_H);
      grad.addColorStop(0, "#7b75ff");
      grad.addColorStop(0.5, "#ff4d6d");
      grad.addColorStop(1, "#fd9927");
      hudCtx.fillStyle = grad;
      hudCtx.fillRect(VIEW_W / 2 - 1, 0, 2, VIEW_H);
    } else {
      drawHUD(time);
    }
    if (!isSplitScreen) {
      drawApprovals3DOverlay(hudCtx, time);
      drawCompassFx3DOverlay(hudCtx, time);
    }
    if (game.state === STATE.COUNTDOWN) {
      drawCountdown();
    } else if ((game.player && game.player.finished && !game.player.eliminated) || (game.player2 && game.player2.finished && !game.player2.eliminated)) {
      if (game.state === STATE.RACING) {
        drawFinishBanner();
      }
    }
    draw3DProfile(hudCtx);
    ctx = origCtx;
  }
}

function draw(time) {
  if (!game.track) {
    ctx.fillStyle = "#07091a";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    return;
  }

  if (game.viewMode === "3d" && THREE_STATE.renderer) {
    draw3D(time);
    return;
  }

  if (game.multiplayer && game.player2 && !game.p2pMode) {
    // 1. Draw Left Viewport (Player 1)
    const p1W = VIEW_W / 2 - 2;
    drawWorld(game.player, 0, 0, p1W, VIEW_H, time, false);

    // 2. Draw Right Viewport (Player 2)
    const p2W = VIEW_W / 2 - 2;
    const p2X = VIEW_W / 2 + 2;
    drawWorld(game.player2, p2X, 0, p2W, VIEW_H, time, true);

    // 3. Draw Split-Screen Divider
    ctx.fillStyle = "rgba(8, 6, 26, 0.75)";
    ctx.fillRect(VIEW_W / 2 - 3, 0, 6, VIEW_H);

    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, "#7b75ff");
    grad.addColorStop(0.5, "#ff4d6d");
    grad.addColorStop(1, "#fd9927");
    ctx.fillStyle = grad;
    ctx.fillRect(VIEW_W / 2 - 1, 0, 2, VIEW_H);

    // 4. Boost flash overlays
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 240, 200, ${Math.min(0.3, game.flash * 0.04)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // 5. Dual Symmetrical HUD
    drawHUDMultiplayer(time);
  } else {
    // Single Player standard full screen drawing (follows the spectated kart when rejected in Battle)
    drawWorld(getViewKart(), 0, 0, VIEW_W, VIEW_H, time, false);

    // Boost flash overlay
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 240, 200, ${Math.min(0.3, game.flash * 0.04)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // Single Player standard HUD
    drawHUD(time);
  }

  // Unified Countdown overlay on top
  const countdownVisible = game.state === STATE.COUNTDOWN ||
    (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState === STATE.COUNTDOWN);
  if (countdownVisible) {
    drawCountdown();
  } else if ((game.player && game.player.finished && !game.player.eliminated) || (game.player2 && game.player2.finished && !game.player2.eliminated)) {
    if (game.state === STATE.RACING) {
      drawFinishBanner();
    }
  }
}

function drawFinishBanner() {
  ctx.save();
  ctx.translate(VIEW_W / 2, VIEW_H / 2);

  // Pulsing scale based on time
  const t = performance.now() * 0.005;
  const scale = 1.0 + Math.sin(t) * 0.06;
  ctx.scale(scale, scale);

  // Glassmorphic backing bar
  ctx.fillStyle = "rgba(10, 8, 30, 0.72)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 2.5;

  const bw = 550, bh = 110;
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 18);
  ctx.fill();
  ctx.stroke();

  // Glowing neon yellow/orange text with deep drop-shadow blur
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffd86b";
  ctx.shadowBlur = 30;
  ctx.shadowColor = "#ffd86b";
  ctx.fillText("FINISH!", 0, 0);

  ctx.restore();
}

function drawUltimateMeter(ctx, x, y, w, kart, time) {
  if (!kart) return;
  const h = 10;
  const charge = clamp(kart.ultCharge / TUNING.ULTIMATE_COINS_NEEDED, 0, 1);
  const ready = kart.ultReady;
  const active = kart.ultActiveTimer > 0;

  ctx.save();

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 5);
  ctx.fill();

  if (ready) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 0.012);
    ctx.fillStyle = `rgba(255, 216, 107, ${pulse})`;
    roundRect(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = "#ffd86b";
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 3);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const keyLabel = kart.playerIndex === 2 ? "[L]" : "[Q]";
    ctx.fillText(`ULTIMATE READY ${keyLabel}`, x + w / 2, y + h / 2);
  } else if (active) {
    const remaining = clamp(kart.ultActiveTimer / (TUNING.ULTIMATE_DURATION_BASE + kart.ultTier * 30), 0, 1);
    ctx.fillStyle = hexToRgba(kart.color, 0.7);
    roundRect(ctx, x, y, w * remaining, h, 3);
    ctx.fill();
    ctx.strokeStyle = kart.color;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 3);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ULTIMATE ACTIVE", x + w / 2, y + h / 2);
  } else if (charge > 0) {
    ctx.fillStyle = "rgba(255, 216, 107, 0.4)";
    roundRect(ctx, x, y, w * charge, h, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 216, 107, 0.5)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 3);
    ctx.stroke();
    ctx.fillStyle = "#ebe4ff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`ULT ${kart.ultCharge}/${TUNING.ULTIMATE_COINS_NEEDED}`, x + w / 2, y + h / 2);
  }

  ctx.restore();
}

function drawHUD(time) {
  if (!game.player) return;
  ctx.save();

  // Top-left: Lap/Distance, Position, Time
  drawHUDPanel(20, 20, 220, 92, () => {
    ctx.fillStyle = "#a8acd0";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    if (isBattleMode()) {
      const appr = game.player.approvals || 0;
      ctx.fillText("APPROVALS", 18, 14);
      ctx.font = "bold 22px sans-serif";
      for (let i = 0; i < Math.max(appr, 0); i++) {
        ctx.fillStyle = COMPASS_VISUAL.sealFill;
        ctx.beginPath(); ctx.arc(24 + i * 20, 34, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = COMPASS_VISUAL.sealRing;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = COMPASS_VISUAL.sealMark;
        ctx.font = "bold 9px sans-serif";
        ctx.fillText("✓", 20 + i * 20, 29);
        ctx.font = "bold 22px sans-serif";
      }
      if (appr <= 0) {
        ctx.fillStyle = "#ff3366";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("REJECTED", 18, 28);
      }

      const untimed = isUntimedHumanBattle();
      const tl = untimed ? game.battleDuration : Math.max(0, game.battleTimeLeft || 0);
      ctx.fillStyle = !untimed && tl < 15 ? "#ff4d6d" : "#a8acd0";
      ctx.font = "11px sans-serif";
      ctx.fillText("TIME LEFT", 130, 14);
      ctx.fillStyle = !untimed && tl < 15 ? "#ff4d6d" : "#fff";
      ctx.font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      ctx.fillText(untimed ? "∞" : formatTime(tl), 130, 32);

      const aliveCount = getActiveKarts().filter((k) => k && !k.eliminated).length;
      ctx.fillStyle = "#a8acd0";
      ctx.font = "11px sans-serif";
      ctx.fillText("SURVIVORS", 18, 64);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`${aliveCount} / ${game.totalRacers}`, 18, 78);
    } else if (isDragonEscape()) {
      ctx.fillText("DISTANCE", 18, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      const distKm = (game.player.x / 1000).toFixed(1);
      ctx.fillText(`${distKm} km`, 18, 28);

      ctx.fillStyle = "#a8acd0";
      ctx.font = "11px sans-serif";
      ctx.fillText("SURVIVAL", 130, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      ctx.fillText(formatTime(game.raceTime), 130, 32);

      ctx.fillStyle = "#a8acd0";
      ctx.font = "11px sans-serif";
      ctx.fillText("POSITION", 18, 64);
      ctx.fillStyle = positionColor(game.hudPosition);
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`${ordinal(game.hudPosition)} / ${game.totalRacers}`, 18, 78);
    } else {
      ctx.fillText("LAP", 18, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 28px sans-serif";
      ctx.fillText(`${Math.min(game.player.lap + 1, TOTAL_LAPS)} / ${TOTAL_LAPS}`, 18, 28);

      ctx.fillStyle = "#a8acd0";
      ctx.font = "11px sans-serif";
      ctx.fillText("TIME", 130, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      ctx.fillText(formatTime(game.raceTime), 130, 32);

      if (game.mapRecordCache && Number.isFinite(game.mapRecordCache.bestTotal)) {
        ctx.fillStyle = "#ffd86b";
        ctx.font = "11px sans-serif";
        ctx.fillText("BEST", 240, 14);
        ctx.font = "bold 18px 'SFMono-Regular', Consolas, monospace";
        ctx.fillText(formatTime(game.mapRecordCache.bestTotal), 240, 31);
      }

      ctx.fillStyle = "#a8acd0";
      ctx.font = "11px sans-serif";
      ctx.fillText("POSITION", 18, 64);
      ctx.fillStyle = positionColor(game.hudPosition);
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`${ordinal(game.hudPosition)} / ${game.totalRacers}`, 18, 78);
    }
  });

  // Top-right: Coins / Item Roulette slot
  drawHUDPanel(VIEW_W - 220 - 20, 20, 220, 92, () => {
    ctx.fillStyle = "#a8acd0";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText("CITATIONS", 18, 14);

    // Coin icon
    ctx.fillStyle = "#ffd86b";
    ctx.beginPath(); ctx.arc(28, 42, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = "#a87a13";
    ctx.beginPath(); ctx.arc(28, 42, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(`${game.player.coinsCollected}`, 50, 32);

    ctx.fillStyle = "#a8acd0";
    ctx.font = "11px sans-serif";
    ctx.fillText("ITEM", 132, 14);
  });

  // Draw the Item Slot panel perfectly overlapping the top-right panel slot
  drawItemSlot(ctx, VIEW_W - 20 - 90, 42, 70, game.player, time);

  // Bottom-left: Speedometer
  drawSpeedo(20, VIEW_H - 160, 140, game.player);

  // Bottom-right: Mini-map
  drawMinimap(VIEW_W - 200, VIEW_H - 200, 180);

  // Drift charge bar (center bottom)
  if (game.player.driftCharge > 5) {
    const w = 160, h = 8;
    const x = (VIEW_W - w) / 2, y = VIEW_H - 30;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(x, y, w, h);
    const charge = clamp(game.player.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
    let col = "#00e5ff"; // Blue (Tier 1)
    if (game.player.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Pink (Tier 3)
    else if (game.player.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Orange (Tier 2)
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * charge, h);
    ctx.strokeStyle = col;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(game.player.driftCharge >= TUNING.DRIFT_TIER3 ? "ULTRA TURBO READY" : game.player.driftCharge >= TUNING.DRIFT_TIER2 ? "SUPER TURBO" : "MINI TURBO", x + w / 2, y - 7);
  }

  // Ultimate charge meter (left of center bottom)
  drawUltimateMeter(ctx, (VIEW_W - 140) / 2, VIEW_H - 52, 140, game.player, time);

  // Regulaido Autopilot Active Watermark Panel (top-center, beautifully glassmorphic)
  const wmW = 200, wmH = 24;
  const wmX = (VIEW_W - wmW) / 2, wmY = 20;

  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(123, 117, 255, 0.4)";
  ctx.fillStyle = "rgba(13, 11, 33, 0.75)";
  ctx.strokeStyle = "#7b75ff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(wmX, wmY, wmW, wmH, 5) : ctx.rect(wmX, wmY, wmW, wmH);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const dotPulse = Math.sin(time * 0.005) > 0 ? "●" : " ";
  ctx.fillStyle = "#a4ff80"; // Mint Green
  ctx.fillText(dotPulse, wmX + 22, wmY + wmH / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("REGULAIDO AUTOPILOT ACTIVE", wmX + 110, wmY + wmH / 2);

  // Active status effects panel (right side, above minimap)
  drawStatusEffects(ctx, VIEW_W - 200, VIEW_H - 400, game.player, time);

  // Hit flash overlay
  drawHitFlash(ctx, game.player, 0, 0, VIEW_W, VIEW_H, time);

  // Battle spectator banner: shown after you're rejected while you watch the kill chain play out
  if (isBattleMode() && game.player && game.player.eliminated) {
    drawSpectateBanner(ctx, VIEW_W / 2, 70, time);
  }

  // Wrong-way overlay
  drawWrongWay(ctx, game.player, 0, 0, VIEW_W, VIEW_H, time);

  // Position change callout
  drawPositionChange(ctx, VIEW_W / 2, VIEW_H * 0.18, game.player);

  // Item name popup
  drawItemNamePopup(ctx, VIEW_W - 20 - 55, 118, game.player, time);

  // Mute indicator
  if (Sound.muted) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(VIEW_W - 70, 130, 56, 22);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("MUTED", VIEW_W - 42, 141);
  }

  if (game.p2pMode && game.p2pPing > 0) {
    const pingY = Sound.muted ? 158 : 130;
    const pingColor = game.p2pPing < 60 ? "#a4ff80" : game.p2pPing < 120 ? "#ffd86b" : "#ff4d6d";
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(VIEW_W - 82, pingY, 68, 20);
    ctx.fillStyle = pingColor;
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${game.p2pPing}ms`, VIEW_W - 48, pingY + 10);
  }

  if (game.p2pConnectionUnstable) {
    const unstableY = (game.p2pMode && game.p2pPing > 0) ? (Sound.muted ? 184 : 156) : (Sound.muted ? 158 : 130);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(VIEW_W - 152, unstableY, 138, 20);
    ctx.fillStyle = "#ffd86b";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("CONNECTION UNSTABLE", VIEW_W - 83, unstableY + 10);
  }

  ctx.restore();
}

function drawItemSlot(ctx, x, y, size, kart, time) {
  ctx.save();
  ctx.translate(x, y);

  // Panel background
  ctx.fillStyle = "rgba(8, 10, 24, 0.8)";
  roundRect(ctx, 0, 0, size, size, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 0.5, 0.5, size - 1, size - 1, 10);
  ctx.stroke();

  if (kart.itemState === "empty") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", size / 2, size / 2);
  } else if (kart.itemState === "rolling") {
    const items = ["boost", "shield", "handling", "conflict", "placebo", "doubleblind", "dossier", "deauth", "mergerequest", "hotfix", "fasttrack"];
    const frameIdx = Math.floor(time * 0.05) % items.length;
    const item = items[frameIdx];
    drawItemIcon(ctx, size / 2, size / 2, size * 0.55, item, time);
  } else if (kart.itemState === "active" && kart.itemSlot) {
    drawItemIcon(ctx, size / 2, size / 2, size * 0.6, kart.itemSlot, time);

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.015);
    ctx.strokeStyle = `rgba(255, 216, 107, ${pulse})`;
    ctx.lineWidth = 2.5;
    roundRect(ctx, 1, 1, size - 2, size - 2, 10);
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const shortcut = kart.playerIndex === 2 ? "[Period]" : "[LShift]";
    ctx.fillText(shortcut, size / 2, size - 3);
  }

  ctx.restore();
}

function drawItemIcon(ctx, cx, cy, sz, item, time) {
  ctx.save();
  ctx.translate(cx, cy);

  if (item === "boost") {
    ctx.fillStyle = "#fd9927";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#fd9927";
    ctx.beginPath();
    ctx.moveTo(0, -sz / 2);
    ctx.lineTo(sz / 2, sz / 2 - 2);
    ctx.lineTo(0, sz / 4);
    ctx.lineTo(-sz / 2, sz / 2 - 2);
    ctx.closePath();
    ctx.fill();
  } else if (item === "shield") {
    ctx.fillStyle = "rgba(87, 242, 255, 0.25)";
    ctx.strokeStyle = "#57f2ff";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#57f2ff";

    ctx.beginPath();
    ctx.moveTo(0, -sz / 2);
    ctx.lineTo(sz / 2 - 2, -sz / 4);
    ctx.quadraticCurveTo(sz / 2 - 2, sz / 4, 0, sz / 2);
    ctx.quadraticCurveTo(-sz / 2 + 2, sz / 4, -sz / 2 + 2, -sz / 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (item === "handling") {
    ctx.strokeStyle = "#a4ff80";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#a4ff80";
    ctx.save();
    ctx.rotate(time * 0.003);

    ctx.beginPath();
    ctx.arc(0, 0, sz / 3, 0, TAU);
    ctx.stroke();

    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(TAU / 6);
      ctx.beginPath();
      ctx.moveTo(sz / 3, 0);
      ctx.lineTo(sz / 2, 0);
      ctx.stroke();
    }
    ctx.restore();
  } else if (item === "conflict") {
    ctx.fillStyle = "rgba(255, 77, 109, 0.25)";
    ctx.strokeStyle = "#ff4d6d";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#ff4d6d";

    ctx.beginPath();
    ctx.rect(-sz / 2, -sz / 2, sz, sz);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Err", 0, 0);
  } else if (item === "placebo") {
    ctx.fillStyle = "rgba(255, 204, 0, 0.25)";
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#ffcc00";
    roundRect(ctx, -sz * 0.48, -sz * 0.22, sz * 0.96, sz * 0.44, sz * 0.22);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.2);
    ctx.lineTo(0, sz * 0.2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Rx", -sz * 0.18, 0);
  } else if (item === "doubleblind") {
    ctx.fillStyle = "rgba(189, 87, 255, 0.24)";
    ctx.strokeStyle = "#bd57ff";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#bd57ff";
    ctx.beginPath();
    ctx.arc(0, 0, sz * 0.42, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.28, 0);
    ctx.quadraticCurveTo(0, -sz * 0.22, sz * 0.28, 0);
    ctx.quadraticCurveTo(0, sz * 0.22, -sz * 0.28, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-sz * 0.36, -sz * 0.28);
    ctx.lineTo(sz * 0.36, sz * 0.28);
    ctx.stroke();
  } else if (item === "dossier") {
    ctx.fillStyle = "rgba(87, 242, 255, 0.25)";
    ctx.strokeStyle = "#57f2ff";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#57f2ff";

    ctx.beginPath();
    ctx.rect(-sz / 2, -sz * 0.35, sz, sz * 0.7);
    ctx.moveTo(-sz / 2, -sz * 0.35);
    ctx.lineTo(-sz / 2, -sz / 2);
    ctx.lineTo(-sz / 8, -sz / 2);
    ctx.lineTo(0, -sz * 0.35);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.3, -sz * 0.1);
    ctx.lineTo(sz * 0.3, -sz * 0.1);
    ctx.moveTo(-sz * 0.3, sz * 0.1);
    ctx.lineTo(sz * 0.1, sz * 0.1);
    ctx.moveTo(-sz * 0.3, sz * 0.25);
    ctx.lineTo(sz * 0.25, sz * 0.25);
    ctx.stroke();
  } else if (item === "deauth") {
    ctx.strokeStyle = "#ff3366";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#ff3366";

    // Draw concentric antenna waves
    ctx.beginPath();
    ctx.arc(0, sz * 0.15, sz * 0.12, 0, TAU);
    ctx.fillStyle = "#ff3366";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, sz * 0.15, sz * 0.3, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, sz * 0.15, sz * 0.52, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
  } else if (item === "mergerequest") {
    ctx.strokeStyle = "#39ff14";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#39ff14";

    // Draw bracket < > with a center pull arrow
    ctx.beginPath();
    ctx.moveTo(-sz * 0.35, -sz * 0.3);
    ctx.lineTo(-sz * 0.5, 0);
    ctx.lineTo(-sz * 0.35, sz * 0.3);

    ctx.moveTo(sz * 0.35, -sz * 0.3);
    ctx.lineTo(sz * 0.5, 0);
    ctx.lineTo(sz * 0.35, sz * 0.3);
    ctx.stroke();

    // Center arrow pointing down/in
    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.25);
    ctx.lineTo(0, sz * 0.25);
    ctx.stroke();

    ctx.fillStyle = "#39ff14";
    ctx.beginPath();
    ctx.moveTo(-sz * 0.15, sz * 0.08);
    ctx.lineTo(0, sz * 0.25);
    ctx.lineTo(sz * 0.15, sz * 0.08);
    ctx.closePath();
    ctx.fill();
  } else if (item === "hotfix") {
    const pulse = 0.6 + 0.4 * Math.sin(time * 0.008);
    ctx.fillStyle = `rgba(255, 200, 0, ${pulse})`;
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ffcc00";

    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.5);
    ctx.lineTo(sz * 0.2, -sz * 0.1);
    ctx.lineTo(sz * 0.5, -sz * 0.1);
    ctx.lineTo(sz * 0.25, sz * 0.12);
    ctx.lineTo(sz * 0.35, sz * 0.5);
    ctx.lineTo(0, sz * 0.2);
    ctx.lineTo(-sz * 0.35, sz * 0.5);
    ctx.lineTo(-sz * 0.25, sz * 0.12);
    ctx.lineTo(-sz * 0.5, -sz * 0.1);
    ctx.lineTo(-sz * 0.2, -sz * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (item === "fasttrack") {
    ctx.strokeStyle = "#a4ff80";
    ctx.fillStyle = "rgba(164, 255, 128, 0.22)";
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#a4ff80";
    ctx.beginPath();
    ctx.moveTo(-sz * 0.42, sz * 0.2);
    ctx.lineTo(-sz * 0.12, -sz * 0.42);
    ctx.lineTo(sz * 0.38, -sz * 0.42);
    ctx.lineTo(sz * 0.1, sz * 0.04);
    ctx.lineTo(sz * 0.42, sz * 0.04);
    ctx.lineTo(-sz * 0.1, sz * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FDA", 0, 0);
  }

  ctx.restore();
}

function drawHUDMultiplayer(time) {
  if (!game.player || !game.player2) return;
  ctx.save();

  const ranking = rankAll();
  const p1Pos = ranking.indexOf(game.player) + 1;
  const p2Pos = ranking.indexOf(game.player2) + 1;

  // 1. Player 1 HUD (Left side)
  drawHUDPanel(15, 15, 185, 105, () => {
    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";

    if (isDragonEscape()) { ctx.fillText("DIST", 12, 10); ctx.fillStyle = "#fff"; ctx.font = "bold 18px 'SFMono-Regular', Consolas, monospace"; ctx.fillText(`${(game.player.x / 1000).toFixed(1)}km`, 12, 22); }
    else { ctx.fillText("LAP", 12, 10); ctx.fillStyle = "#fff"; ctx.font = "bold 20px sans-serif"; ctx.fillText(`${Math.min(game.player.lap + 1, TOTAL_LAPS)} / ${TOTAL_LAPS}`, 12, 22); }

    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("CITATIONS", 12, 54);
    ctx.fillStyle = "#ffd86b";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`${game.player.coinsCollected}`, 12, 66);

    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("POS", 110, 10);
    ctx.fillStyle = positionColor(p1Pos);
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`${ordinal(p1Pos)}`, 110, 22);

    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("ITEM", 110, 54);
  });

  drawItemSlot(ctx, 120, 68, 48, game.player, time);
  drawSpeedo(15, VIEW_H - 135, 120, game.player);

  // 2. Player 2 HUD (Right side)
  drawHUDPanel(VIEW_W - 200, 15, 185, 105, () => {
    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";

    if (isDragonEscape()) { ctx.fillText("DIST", 12, 10); ctx.fillStyle = "#fff"; ctx.font = "bold 18px 'SFMono-Regular', Consolas, monospace"; ctx.fillText(`${(game.player2.x / 1000).toFixed(1)}km`, 12, 22); }
    else { ctx.fillText("LAP", 12, 10); ctx.fillStyle = "#fff"; ctx.font = "bold 20px sans-serif"; ctx.fillText(`${Math.min(game.player2.lap + 1, TOTAL_LAPS)} / ${TOTAL_LAPS}`, 12, 22); }

    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("CITATIONS", 12, 54);
    ctx.fillStyle = "#ffd86b";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`${game.player2.coinsCollected}`, 12, 66);

    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("POS", 110, 10);
    ctx.fillStyle = positionColor(p2Pos);
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`${ordinal(p2Pos)}`, 110, 22);

    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("ITEM", 110, 54);
  });

  drawItemSlot(ctx, VIEW_W - 200 + 110, 68, 48, game.player2, time);
  drawSpeedo(VIEW_W - 135, VIEW_H - 135, 120, game.player2);

  // 3. Central Mini-map (Overlapping divider)
  drawMinimap(VIEW_W / 2 - 75, VIEW_H - 165, 150);

  // 4. Drift charge bars
  if (game.player.driftCharge > 5) {
    const w = 120, h = 6;
    const x = 145, y = VIEW_H - 25;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(x, y, w, h);
    const charge = clamp(game.player.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
    let col = "#00e5ff"; // Blue (Tier 1)
    if (game.player.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Pink (Tier 3)
    else if (game.player.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Orange (Tier 2)
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * charge, h);
  }

  if (game.player2.driftCharge > 5) {
    const w = 120, h = 6;
    const x = VIEW_W - 135 - 130, y = VIEW_H - 25;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(x, y, w, h);
    const charge = clamp(game.player2.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
    let col = "#00e5ff"; // Blue (Tier 1)
    if (game.player2.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Pink (Tier 3)
    else if (game.player2.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Orange (Tier 2)
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * charge, h);
  }

  // 5. Ultimate meters
  drawUltimateMeter(ctx, 15, VIEW_H - 48, 110, game.player, time);
  drawUltimateMeter(ctx, VIEW_W - 125, VIEW_H - 48, 110, game.player2, time);

  // Regulaido Autopilot Active Watermark (top-center below split border)
  const wmW = 180, wmH = 20;
  const wmX = (VIEW_W - wmW) / 2, wmY = 40;

  ctx.save();
  ctx.shadowBlur = 6;
  ctx.shadowColor = "rgba(123, 117, 255, 0.3)";
  ctx.fillStyle = "rgba(13, 11, 33, 0.8)";
  ctx.strokeStyle = "#7b75ff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(wmX, wmY, wmW, wmH, 4) : ctx.rect(wmX, wmY, wmW, wmH);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#a4ff80"; // Mint Green pulsing dot
  const dotPulse = Math.sin(time * 0.005) > 0 ? "●" : " ";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(dotPulse, wmX + 18, wmY + wmH / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("REGULAIDO SYSTEM ACTIVE", wmX + 95, wmY + wmH / 2);

  // Active status effects panels
  drawStatusEffects(ctx, 15, VIEW_H / 2 - 60, game.player, time);
  drawStatusEffects(ctx, VIEW_W - 140, VIEW_H / 2 - 60, game.player2, time);

  // Per-player hit flash overlays (clipped to each viewport)
  const p1W = VIEW_W / 2 - 2;
  const p2W = VIEW_W / 2 - 2;
  const p2X = VIEW_W / 2 + 2;
  drawHitFlash(ctx, game.player, 0, 0, p1W, VIEW_H, time);
  drawHitFlash(ctx, game.player2, p2X, 0, p2W, VIEW_H, time);

  // Wrong-way overlays
  drawWrongWay(ctx, game.player, 0, 0, p1W, VIEW_H, time);
  drawWrongWay(ctx, game.player2, p2X, 0, p2W, VIEW_H, time);

  // Position change callouts
  drawPositionChange(ctx, p1W / 2, VIEW_H * 0.18, game.player);
  drawPositionChange(ctx, p2X + p2W / 2, VIEW_H * 0.18, game.player2);

  // Item name popups
  drawItemNamePopup(ctx, 145, 120, game.player, time);
  drawItemNamePopup(ctx, VIEW_W - 200 + 135, 120, game.player2, time);

  // Mute indicator
  if (Sound.muted) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(VIEW_W / 2 - 28, 15, 56, 20);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("MUTED", VIEW_W / 2, 25);
  }

  ctx.restore();
}

function drawHUDPanel(x, y, w, h, drawFn) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = COMPASS_VISUAL.hudBg;
  roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  ctx.fillStyle = COMPASS_VISUAL.hudHighlight;
  roundRect(ctx, 1, 1, w - 2, 4, 8); ctx.fill();
  ctx.strokeStyle = COMPASS_VISUAL.hudBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 12); ctx.stroke();
  drawFn();
  ctx.restore();
}

function drawSpeedo(x, y, size, player) {
  if (!player) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = COMPASS_VISUAL.hudBg;
  roundRect(ctx, 0, 0, size, size, 14); ctx.fill();
  ctx.strokeStyle = COMPASS_VISUAL.hudBorder;
  roundRect(ctx, 0.5, 0.5, size - 1, size - 1, 14); ctx.stroke();

  const cx = size / 2, cy = size / 2 + 14;
  const radius = size / 2 - 22;

  // Tick marks around the arc
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const tickAng = Math.PI + (Math.PI * i / 10);
    const isMajor = i % 2 === 0;
    const inner = radius - (isMajor ? 10 : 6);
    const outer = radius + 2;
    ctx.lineWidth = isMajor ? 1.5 : 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(tickAng) * inner, cy + Math.sin(tickAng) * inner);
    ctx.lineTo(cx + Math.cos(tickAng) * outer, cy + Math.sin(tickAng) * outer);
    ctx.stroke();
  }

  // Arc background
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, TAU);
  ctx.stroke();

  const sp = player.speed();
  const maxDisplay = 8.5;
  const frac = clamp(sp / maxDisplay, 0, 1);
  const col = sp > 7 ? COMPASS_VISUAL.accent : sp > 5 ? COMPASS_VISUAL.primaryDark : COMPASS_VISUAL.primary;

  // Arc filled with glow
  ctx.shadowBlur = 10;
  ctx.shadowColor = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * frac);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Needle with glow
  const ang = Math.PI + Math.PI * frac;
  ctx.shadowBlur = 8;
  ctx.shadowColor = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * (radius - 4), cy + Math.sin(ang) * (radius - 4));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Center hub
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, TAU); ctx.fill();
  ctx.fillStyle = "#050510";
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, TAU); ctx.fill();

  // Numeric
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px 'SFMono-Regular', Consolas, monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(sp * 28)}`, cx, cy - 12);
  ctx.fillStyle = "#a8acd0";
  ctx.font = "10px sans-serif";
  ctx.fillText("KM/H", cx, cy + 8);

  if (player.boostTimer > 0) {
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.01);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ff8a3b";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("BOOST", cx, 18);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawMinimap(x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = COMPASS_VISUAL.hudBg;
  roundRect(ctx, 0, 0, size, size, 12); ctx.fill();
  ctx.strokeStyle = COMPASS_VISUAL.hudBorder;
  roundRect(ctx, 0.5, 0.5, size - 1, size - 1, 12); ctx.stroke();

  const pad = 12;
  const sx = (size - pad * 2) / WORLD_W;
  const sy = (size - pad * 2) / WORLD_H;
  const s = Math.min(sx, sy);
  const ox = pad + ((size - pad * 2) - WORLD_W * s) / 2;
  const oy = pad + ((size - pad * 2) - WORLD_H * s) / 2;

  // Track outline (sample for huge worlds)
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const step = game.track.isOpen ? 12 : 1;
  for (let i = 0; i < game.track.n; i += step) {
    const w = game.track.waypoints[i];
    const px = ox + w.x * s, py = oy + w.y * s;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  if (!game.track.isOpen) ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "rgba(58, 61, 73, 1)";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Start line marker (no start/finish in the Battle arena)
  if (!isBattleMode()) {
    const w0 = game.track.waypoints[0];
    ctx.fillStyle = "#ffd86b";
    ctx.beginPath();
    ctx.arc(ox + w0.x * s, oy + w0.y * s, 3, 0, TAU);
    ctx.fill();
  }

  // Karts (drop the ones already knocked out in Battle)
  for (const k of game.ais) {
    if (k.eliminated) continue;
    ctx.fillStyle = k.color;
    ctx.beginPath();
    ctx.arc(ox + k.x * s, oy + k.y * s, 3, 0, TAU);
    ctx.fill();
  }

  // Player 2
  if (game.multiplayer && game.player2 && !game.p2pMode) {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = game.player2.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox + game.player2.x * s, oy + game.player2.y * s, 3.5, 0, TAU);
    ctx.fill(); ctx.stroke();
  }

  // Player 1 — while spectating in Battle, mark the kart the camera is following instead
  const meMarker = (isBattleMode() && game.player.eliminated && game.spectateTarget && !game.spectateTarget.eliminated)
    ? game.spectateTarget : (game.player.eliminated && isBattleMode() ? null : game.player);
  if (meMarker) {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = meMarker.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox + meMarker.x * s, oy + meMarker.y * s, 4, 0, TAU);
    ctx.fill(); ctx.stroke();
  }

  // Label
  ctx.fillStyle = "#a8acd0";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText("MAP", 8, 6);

  ctx.restore();
}

function drawCountdown() {
  const elapsed = performance.now() - game.countdownStart;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  let phase = (elapsed % 900) / 900;
  if (game.countdownText === "GO!") phase = (elapsed - 2700) / 800;
  const scale = 1 + (1 - phase) * 0.6;
  const a = clamp(1 - Math.pow(phase, 2), 0, 1);

  ctx.save();
  ctx.translate(VIEW_W / 2, VIEW_H / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = a;
  ctx.font = "bold 180px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = game.countdownText === "GO!" ? "#7aff66" : "#ff4d6d";
  ctx.shadowBlur = 30; ctx.shadowColor = ctx.fillStyle;
  ctx.fillText(game.countdownText, 0, 0);
  ctx.restore();

  // Rev meter / rocket start indicator
  if (game.rocketStartP1.holding) {
    const hs = game.rocketStartP1.holdStart;
    const mw = 180, mh = 14;
    const mx = VIEW_W / 2 - mw / 2, my = VIEW_H / 2 + 110;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, mx - 2, my - 2, mw + 4, mh + 4, 5);
    ctx.fill();

    // Color based on timing zone
    let revCol = "#ff4d6d";
    let revLabel = "TOO EARLY";
    if (hs >= 900 && hs <= 2200) {
      const isPerfect = hs >= 1400 && hs <= 1900;
      revCol = isPerfect ? "#ffd86b" : "#a4ff80";
      revLabel = isPerfect ? "PERFECT" : "GOOD";
    } else if (hs > 2200) {
      revCol = "#a8acd0";
      revLabel = "LATE";
    }

    // Pulsing fill
    const revPulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.015);
    ctx.fillStyle = revCol;
    ctx.globalAlpha = revPulse;
    roundRect(ctx, mx, my, mw, mh, 3);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px 'SFMono-Regular', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(revLabel, mx + mw / 2, my + mh / 2);

    // Hint text
    ctx.fillStyle = "#a8acd0";
    ctx.font = "10px sans-serif";
    ctx.fillText("HOLD GAS TO REV", mx + mw / 2, my + mh + 14);
    ctx.restore();
  } else if (elapsed > 500) {
    ctx.save();
    ctx.fillStyle = "rgba(168, 172, 208, 0.5)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HOLD GAS TO REV - RELEASE AT GO!", VIEW_W / 2, VIEW_H / 2 + 120);
    ctx.restore();
  }
}

/* ============================================================
   FORMATTERS
   ============================================================ */
function formatTime(t) {
  if (!Number.isFinite(t)) return "DNF";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(ms)}`;
}
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function positionColor(p) {
  if (p === 1) return "#ffd86b";
  if (p === 2) return "#d8d8e0";
  if (p === 3) return "#cd7f32";
  return "#ff6b6b";
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

/* ============================================================
   FINISH SCREEN
   ============================================================ */
function showFinishScreen() {
  const ranking = game.finalRanking || rankAll();

  if (isBattleMode()) {
    const playerPlace = ranking.indexOf(game.player) + 1;
    const playerWon = playerPlace === 1 && !game.player.eliminated;
    finishTitle.textContent = playerWon ? "Champion of Compliance!" : (game.player.eliminated ? "Submission Rejected!" : "Battle Over");
    finishTitle.style.background = "";
    let html = "";
    const battleWinner = ranking.find((k) => k && !k.eliminated) || ranking[0];
    if (battleWinner) {
      html += `<div class="row"><span class="label">Winner</span><span class="value" style="color:${battleWinner.color};font-weight:900;">${battleWinner === game.player ? "YOU" : battleWinner.name} \uD83C\uDFC6</span></div>`;
    }
    html += `<div class="row"><span class="label">Your Place</span><span class="value"><span class="place-badge place-${Math.min(playerPlace, 4)}">${ordinal(playerPlace)}</span></span></div>`;
    html += `<div class="row"><span class="label">Approvals Remaining</span><span class="value" style="color:#4dffaa;font-weight:900;">${Math.max(0, game.player.approvals || 0)}</span></div>`;
    html += `<div class="row"><span class="label">Status</span><span class="value">${game.player.eliminated ? `<span style="color:#ff3366;font-weight:900;">REJECTED</span>` : `<span style="color:#4dffaa;font-weight:900;">SURVIVED</span>`}</span></div>`;
    if (game.player.eliminated && game.player.killedBy) {
      html += `<div class="row"><span class="label">Rejected By</span><span class="value" style="color:${game.player.killedBy.color};font-weight:700;">${game.player.killedBy.name}</span></div>`;
    }
    html += `<div class="row"><span class="label">Battle Time</span><span class="value">${formatTime(game.raceTime)}</span></div>`;

    html += `<div class="row" style="border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;padding-top:10px;"><span class="label">Final Standings</span><span></span></div>`;
    ranking.forEach((k, i) => {
      const status = k.eliminated ? `<span style="color:#ff3366;">REJECTED</span>` : `${Math.max(0, k.approvals || 0)} ✓`;
      html += `<div class="row"><span class="label" style="color:${k.color};font-weight:700;">${i + 1}. ${k.name}</span><span class="value">${status}</span></div>`;
    });

    finishResults.innerHTML = html;
  } else if (game.multiplayer && game.player2) {
    if (isDragonEscape()) {
      // Dragon survival multiplayer results
      const p1Time = (game.player.finishTime || game.raceTime).toFixed(1);
      const p2Time = (game.player2.finishTime || game.raceTime).toFixed(1);
      const p1Lap = game.player.lap;
      const p2Lap = game.player2.lap;
      const p1Dist = (game.player.x / 1000).toFixed(1);
      const p2Dist = (game.player2.x / 1000).toFixed(1);

      let winnerName = "";
      if (p1Lap > p2Lap) winnerName = "P1 " + game.player.name + " Outran the Dragon!";
      else if (p2Lap > p1Lap) winnerName = "P2 " + game.player2.name + " Outran the Dragon!";
      else if (parseFloat(p1Dist) > parseFloat(p2Dist)) winnerName = "P1 " + game.player.name + " Outran the Dragon!";
      else if (parseFloat(p2Dist) > parseFloat(p1Dist)) winnerName = "P2 " + game.player2.name + " Outran the Dragon!";
      else winnerName = "Both Cooked by the Dragon!";

      finishTitle.textContent = winnerName;
      finishTitle.style.background = "linear-gradient(90deg, #ff4d4d, #ff8a00)";
      finishTitle.style.webkitBackgroundClip = "text";
      finishTitle.style.backgroundClip = "text";
      finishTitle.style.color = "transparent";

      let html = "";
      html += `<div style="display: flex; gap: 15px; width: 100%; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px;">`;
      // P1 Column
      html += `<div style="flex: 1; text-align: left; padding: 12px; background: rgba(123, 117, 255, 0.08); border-radius: 12px; border: 1px solid rgba(123, 117, 255, 0.2);">`;
      html += `<div style="font-weight: 900; color: #7b75ff; border-bottom: 1px solid rgba(123,117,255,0.2); padding-bottom: 4px; margin-bottom: 8px;">PLAYER 1 (${game.player.name})</div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Survival</span><span class="value">${formatTime(game.player.finishTime || game.raceTime)}</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Distance</span><span class="value">${p1Dist} km</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Laps</span><span class="value">${p1Lap}</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Citations</span><span class="value">${game.player.coinsCollected}</span></div>`;
      const p1Score = game.player.coinsCollected * 15 + p1Lap * 500 + Math.floor((game.player.finishTime || game.raceTime) * 10);
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Score</span><span class="value">${p1Score}</span></div>`;
      html += `</div>`;
      // P2 Column
      html += `<div style="flex: 1; text-align: left; padding: 12px; background: rgba(255, 77, 109, 0.08); border-radius: 12px; border: 1px solid rgba(255, 77, 109, 0.2);">`;
      html += `<div style="font-weight: 900; color: #ff4d6d; border-bottom: 1px solid rgba(255,77,109,0.2); padding-bottom: 4px; margin-bottom: 8px;">PLAYER 2 (${game.player2.name})</div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Survival</span><span class="value">${formatTime(game.player2.finishTime || game.raceTime)}</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Distance</span><span class="value">${p2Dist} km</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Laps</span><span class="value">${p2Lap}</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Citations</span><span class="value">${game.player2.coinsCollected}</span></div>`;
      const p2Score = game.player2.coinsCollected * 15 + p2Lap * 500 + Math.floor((game.player2.finishTime || game.raceTime) * 10);
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Score</span><span class="value">${p2Score}</span></div>`;
      html += `</div>`;
      html += `</div>`;

      // Rankings by who survived longest
      html += `<div class="row" style="margin-top:6px; font-weight: 900; color: #fff;"><span class="label">Survival Ranking</span><span></span></div>`;
      ranking.forEach((k, i) => {
        if (k.isPlayer) {
          html += `<div class="row"><span class="label" style="color:${k.color};font-weight:700;">${i + 1}. ${k.name}</span><span class="value">${k.finished ? "Cooked!" : formatTime(k.finishTime || game.raceTime)}</span></div>`;
        }
      });

      finishResults.innerHTML = html;
    } else {
      // Normal circuit multiplayer results
      const p1Place = ranking.indexOf(game.player) + 1;
      const p2Place = ranking.indexOf(game.player2) + 1;

      let winnerName = "";
      if (p1Place < p2Place) winnerName = "P1 " + game.player.name + " Wins!";
      else if (p2Place < p1Place) winnerName = "P2 " + game.player2.name + " Wins!";
      else winnerName = "It's a Tie!";

      finishTitle.textContent = winnerName;
      finishTitle.style.background = "";

      let html = "";
      html += `<div style="display: flex; gap: 15px; width: 100%; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px;">`;

      // Player 1 Column
      html += `<div style="flex: 1; text-align: left; padding: 12px; background: rgba(123, 117, 255, 0.08); border-radius: 12px; border: 1px solid rgba(123, 117, 255, 0.2);">`;
      html += `<div style="font-weight: 900; color: #7b75ff; border-bottom: 1px solid rgba(123,117,255,0.2); padding-bottom: 4px; margin-bottom: 8px;">PLAYER 1 (${game.player.name})</div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Place</span><span class="value"><span class="place-badge place-${Math.min(p1Place, 4)}">${ordinal(p1Place)}</span></span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Time</span><span class="value">${game.player.finished ? formatTime(game.player.finishTime) : "DNF"}</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Citations</span><span class="value">${game.player.coinsCollected}</span></div>`;
      const p1Score = game.player.coinsCollected * 10 + Math.max(0, (game.totalRacers + 1 - p1Place)) * 250;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Score</span><span class="value">${p1Score}</span></div>`;
      html += `</div>`;

      // Player 2 Column
      html += `<div style="flex: 1; text-align: left; padding: 12px; background: rgba(255, 77, 109, 0.08); border-radius: 12px; border: 1px solid rgba(255, 77, 109, 0.2);">`;
      html += `<div style="font-weight: 900; color: #ff4d6d; border-bottom: 1px solid rgba(255,77,109,0.2); padding-bottom: 4px; margin-bottom: 8px;">PLAYER 2 (${game.player2.name})</div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Place</span><span class="value"><span class="place-badge place-${Math.min(p2Place, 4)}">${ordinal(p2Place)}</span></span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Time</span><span class="value">${game.player2.finished ? formatTime(game.player2.finishTime) : "DNF"}</span></div>`;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Citations</span><span class="value">${game.player2.coinsCollected}</span></div>`;
      const p2Score = game.player2.coinsCollected * 10 + Math.max(0, (game.totalRacers + 1 - p2Place)) * 250;
      html += `<div class="row" style="margin: 4px 0;"><span class="label">Score</span><span class="value">${p2Score}</span></div>`;
      html += `</div>`;

      html += `</div>`;

      // Full ranking
      html += `<div class="row" style="margin-top:6px; font-weight: 900; color: #fff;"><span class="label">Final Grid Leaderboard</span><span></span></div>`;
      ranking.forEach((k, i) => {
        const time = k.finished ? formatTime(k.finishTime) : "DNF";
        html += `<div class="row"><span class="label" style="color:${k.color};font-weight:700;">${i + 1}. ${k.name}</span><span class="value">${time}</span></div>`;
      });

      finishResults.innerHTML = html;
    }
  } else {
    const playerPlace = ranking.indexOf(game.player) + 1;
    const isDragon = isDragonEscape();

    if (isDragon) {
      const bestDist = (game.player.x / 1000).toFixed(1);
      finishTitle.textContent = "Dragon's Wrath!";
      finishTitle.style.background = "linear-gradient(90deg, #ff4d4d, #ff8a00)";
      finishTitle.style.webkitBackgroundClip = "text";
      finishTitle.style.backgroundClip = "text";
      finishTitle.style.color = "transparent";
      let html = "";
      html += `<div class="row"><span class="label">Survival Time</span><span class="value">${formatTime(game.player.finishTime || game.raceTime)}</span></div>`;
      html += `<div class="row"><span class="label">Distance Escaped</span><span class="value">${bestDist} km</span></div>`;
      html += `<div class="row"><span class="label">Laps Survived</span><span class="value">${game.player.lap}</span></div>`;
      html += `<div class="row"><span class="label">Citations Collected</span><span class="value">${game.player.coinsCollected}</span></div>`;
      const dragonScore = Math.floor(game.player.x / 10 + game.player.coinsCollected * 15 + (game.player.finishTime || game.raceTime) * 10);
      html += `<div class="row"><span class="label">Score</span><span class="value">${dragonScore}</span></div>`;

      // Full ranking (just human and how long they survived)
      html += `<div class="row" style="border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;padding-top:10px;"><span class="label">Survival Ranking</span><span></span></div>`;
      ranking.forEach((k, i) => {
        if (k.isPlayer) {
          html += `<div class="row"><span class="label" style="color:${k.color};font-weight:700;">${i + 1}. ${k.name}</span><span class="value">${k.finished ? "Cooked!" : formatTime(k.finishTime || game.raceTime)}</span></div>`;
        }
      });

      finishResults.innerHTML = html;
    } else {
      finishTitle.textContent = playerPlace === 1 ? "Victory!" : "Race Over";
      finishTitle.style.background = "";
      let html = "";

      // Pixel-art podium for top 3
      const top3 = ranking.slice(0, Math.min(3, ranking.length));
      html += `<div style="display:flex;align-items:flex-end;justify-content:center;gap:6px;margin-bottom:14px;padding:8px 0;">`;
      const podiumH = [90, 68, 52];
      const podiumOrder = top3.length >= 2 ? [1, 0, 2] : [0];
      podiumOrder.forEach(pi => {
        const k = top3[pi];
        if (!k) return;
        const h = podiumH[pi] || 50;
        const charDef = CHARACTERS.find(c => c.id === k.charId) || CHARACTERS[0];
        const place = pi + 1;
        const crown = place === 1 ? `<svg width="20" height="12" viewBox="0 0 20 12" style="display:block;margin:0 auto 2px;"><polygon points="2,10 4,4 7,7 10,2 13,7 16,4 18,10" fill="#ffd86b" stroke="#a87a13" stroke-width="0.8"/><rect x="2" y="10" width="16" height="2" rx="1" fill="#ffd86b"/></svg>` : "";
        html += `<div style="display:flex;flex-direction:column;align-items:center;width:80px;">`;
        html += crown;
        html += `<div style="width:36px;height:36px;border-radius:50%;background:${charDef.gradient};display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${charDef.colorGlow};margin-bottom:4px;">${getCharAvatarSVG({...charDef, color: "#050510"}).replace(/width="48"/g,'width="28"').replace(/height="48"/g,'height="28"')}</div>`;
        html += `<div style="font-weight:900;font-size:11px;color:${k.color};margin-bottom:2px;">${k.name}</div>`;
        html += `<div style="width:70px;height:${h}px;background:linear-gradient(180deg,${k.color}33,${k.color}11);border:1px solid ${k.color}55;border-radius:6px 6px 0 0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;color:${k.color};">${place}</div>`;
        html += `</div>`;
      });
      html += `</div>`;

      html += `<div class="row"><span class="label">Your Place</span><span class="value"><span class="place-badge place-${Math.min(playerPlace, 4)}">${ordinal(playerPlace)}</span></span></div>`;
      html += `<div class="row"><span class="label">Final Time</span><span class="value">${game.player.finished ? formatTime(game.player.finishTime) : formatTime(game.raceTime)}</span></div>`;
      html += `<div class="row"><span class="label">Citations Collected</span><span class="value">${game.player.coinsCollected}</span></div>`;
      const score = game.player.coinsCollected * 10 + Math.max(0, (game.totalRacers + 1 - playerPlace)) * 250 + Math.max(0, Math.floor(60 - game.raceTime) * 5);
      html += `<div class="row"><span class="label">Score</span><span class="value">${score}</span></div>`;
      html += `<div class="row"><span class="label">Laps Completed</span><span class="value">${game.player.lap} / ${TOTAL_LAPS}</span></div>`;

      // Personal bests for this track
      const bestLapThisRun = (game.player.lapTimes && game.player.lapTimes.length) ? Math.min(...game.player.lapTimes) : 0;
      const rec = getMapRecord(MAPS[game.selectedMapIdx || 0].id);
      const nr = game.newRecord || {};
      if (bestLapThisRun > 0) {
        html += `<div class="row"><span class="label">Best Lap${nr.lap ? ` <span style="color:#ffd86b;font-weight:900;">★ NEW!</span>` : ``}</span><span class="value">${formatTime(bestLapThisRun)}</span></div>`;
      }
      if (rec && Number.isFinite(rec.bestTotal)) {
        html += `<div class="row"><span class="label">Track Record${nr.total ? ` <span style="color:#ffd86b;font-weight:900;">★ NEW!</span>` : ``}</span><span class="value">${formatTime(rec.bestTotal)}</span></div>`;
      }
      if (nr.total || nr.lap) {
        html += `<div class="row" style="justify-content:center;margin-top:4px;"><span style="color:#ffd86b;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;">★ New Personal Best! ★</span></div>`;
      }

      // Full ranking
      html += `<div class="row" style="border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;padding-top:10px;"><span class="label">Final Ranking</span><span></span></div>`;
      ranking.forEach((k, i) => {
        const time = k.finished ? formatTime(k.finishTime) : "—";
        html += `<div class="row"><span class="label" style="color:${k.color};font-weight:700;">${i + 1}. ${k.name}</span><span class="value">${time}</span></div>`;
      });

      finishResults.innerHTML = html;
    }
  }

  if (isGrandPrixActive(game.tournament)) {
    finishResults.innerHTML = buildTournamentStandingsHtml() + finishResults.innerHTML;
    if (game.tournament.raceIndex + 1 >= game.tournament.totalRaces) {
      finishTitle.textContent = "Grand Prix Complete!";
      finishTitle.style.background = "";
    }
  }

  const tourn = game.tournament;
  const tournActive = isGrandPrixActive(tourn);
  const tournDone = tournActive && tourn.raceIndex + 1 >= tourn.totalRaces;
  const waitHint = document.getElementById("finish-tournament-wait");
  const isP2pGuest = game.p2pMode && game.p2pRole === "guest";

  if (tournActive && !isBattleMode()) {
    if (nextTrackBtn) nextTrackBtn.style.display = "none";
    if (restartBtn) {
      if (isP2pGuest) {
        restartBtn.style.display = "none";
        if (waitHint) waitHint.style.display = "block";
      } else {
        restartBtn.style.display = "";
        restartBtn.textContent = tournDone ? "New Grand Prix" : "Next Race";
        if (waitHint) waitHint.style.display = "none";
      }
    }
  } else {
    if (nextTrackBtn) nextTrackBtn.style.display = isBattleMode() ? "none" : "";
    if (restartBtn) {
      restartBtn.style.display = isP2pGuest ? "none" : "";
      if (game.p2pMode && !tournActive) {
        restartBtn.textContent = "Return to Lobby";
      } else {
        restartBtn.textContent = isBattleMode() ? "Battle Again" : "Rematch";
      }
    }
    if (waitHint) waitHint.style.display = isP2pGuest ? "block" : "none";
  }

  finishScreen.classList.remove("hidden");
}

function hideAll() {
  titleScreen.classList.add("hidden");
  settingsScreen.classList.add("hidden");
  selectScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  finishScreen.classList.add("hidden");
  p2pScreen.classList.add("hidden");
}

function showMainMenu() {
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  Sound.stopMusic(true);
  if (game.p2pMode) handleP2pDisconnect({ silent: true });
  game.tournament = null;
  game.state = STATE.TITLE;
  game.p1Locked = false;
  game.p2Locked = false;
  hideAll();
  titleScreen.classList.remove("hidden");
  if (Sound.ctx) Sound.playVocoderTitle();
}

function renderAudioSettings() {
  if (musicVolumeInput) musicVolumeInput.value = String(Math.round(Sound.musicVolume * 100));
  if (musicVolumeValue) musicVolumeValue.textContent = `${Math.round(Sound.musicVolume * 100)}%`;
  if (sfxVolumeInput) sfxVolumeInput.value = String(Math.round(Sound.sfxVolume * 100));
  if (sfxVolumeValue) sfxVolumeValue.textContent = `${Math.round(Sound.sfxVolume * 100)}%`;
}

function setMusicTrack(idx) {
  const safeIdx = Math.floor(clamp(idx, 0, Sound.tracks.length - 1));
  if (Sound.isPlayingMusic) {
    Sound.switchTrack(safeIdx);
  } else {
    Sound.trackIdx = safeIdx;
    const track = Sound.tracks[safeIdx];
    Sound.tempo = track.tempo;
    if (game.player && game.player.lap >= TOTAL_LAPS - 1) {
      Sound.tempo = track.tempo + TUNING.FINAL_LAP_TEMPO_BOOST;
    }
    saveGameSettings({ musicTrack: safeIdx });
  }
  if (Sound.isPlayingMusic) {
    Sound.showTrackToast();
  }
}

function previewSelectedMapMusic(map) {
  if (!Sound.ctx) return;
  Sound.stopTitleTheme(false);
  const assignedTrack = Number.isInteger(map.musicTrack) ? map.musicTrack : (Sound.trackIdx || 0);
  const safeTrack = Math.floor(clamp(assignedTrack, 0, Sound.tracks.length - 1));
  Sound.mapStyle = map.id === "dragon_escape" ? "japanese" : "retro";
  if (Sound.mapStyle === "retro") {
    setMusicTrack(safeTrack);
  } else {
    Sound.stopMusic(true);
    Sound.trackIdx = safeTrack;
    Sound.tempo = 90;
    setTimeout(() => Sound.startMusic(), 80);
  }
  if (!Sound.isPlayingMusic) Sound.startMusic();
}

function showSettingsScreen() {
  Sound.stopTitleTheme(false);
  hideAll();
  renderAudioSettings();
  renderRaceSetupSettings();
  renderTimeOfDaySettings();
  if (view2dBtn) view2dBtn.classList.toggle("active", game.viewMode !== "3d");
  if (view3dBtn) view3dBtn.classList.toggle("active", game.viewMode === "3d");
  settingsScreen.classList.remove("hidden");
}

function renderTimeOfDaySettings() {
  const day = isDayMode();
  if (timeDayBtn) timeDayBtn.classList.toggle("active", day);
  if (timeNightBtn) timeNightBtn.classList.toggle("active", !day);
}

function setTimeOfDay(mode) {
  game.timeOfDay = normalizeTimeOfDay(mode);
  saveGameSettings({ timeOfDay: game.timeOfDay });
  renderTimeOfDaySettings();
  if (game.viewMode === "3d" && THREE_STATE.loaded) {
    if (THREE_STATE.renderer && game.track) rebuild3DTrack();
    else apply3DMapTheme();
  }
}

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

const PROMPTLY_TIPS = [
  "Small steering inputs, big mini-turbos — drift early, release late.",
  "Hold your item until someone files a Merge Conflict at you.",
  "Ten Citations charges your ultimate. Collect responsibly.",
  "Tap the gas exactly on GO for a rocket start. I believe in you.",
  "Trailing the pack? The item boxes remember. They provide.",
  "Boost pads are pre-approved. Use every single one.",
  "Off-road driving is a protocol deviation. 0.65× speed. Don't.",
  "Honk (E) has no gameplay effect. It is still mandatory.",
  "The dragon does not negotiate. Keep moving.",
  "Fast Track through the field — comebacks are always in scope."
];

let promptlyTipIdx = 0;
const promptlyTitleBubble = document.getElementById("promptly-title-bubble");
const promptlyTitleImg = document.getElementById("promptly-title-img");

function showPromptlyTip() {
  if (titleScreen.classList.contains("hidden") && game.state !== STATE.TITLE) return;
  if (!promptlyTitleBubble) return;
  promptlyTitleBubble.textContent = PROMPTLY_TIPS[promptlyTipIdx % PROMPTLY_TIPS.length];
  promptlyTipIdx++;
  if (promptlyTitleImg) {
    promptlyTitleImg.classList.remove("promptly-wiggle");
    void promptlyTitleImg.offsetWidth;
    promptlyTitleImg.classList.add("promptly-wiggle");
    setTimeout(() => promptlyTitleImg.classList.remove("promptly-wiggle"), 600);
  }
}

showPromptlyTip();
setInterval(showPromptlyTip, 6000);

/* ============================================================
   START / RESTART HOOKS
   ============================================================ */
settingsBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  showSettingsScreen();
});

settingsBackBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  showMainMenu();
});

if (musicVolumeInput) {
  musicVolumeInput.addEventListener("input", () => {
    Sound.ensure(); Sound.resume();
    Sound.setMusicVolume(Number(musicVolumeInput.value) / 100);
    renderAudioSettings();
  });
}

if (sfxVolumeInput) {
  sfxVolumeInput.addEventListener("input", () => {
    Sound.ensure(); Sound.resume();
    Sound.setSfxVolume(Number(sfxVolumeInput.value) / 100);
    renderAudioSettings();
  });
  sfxVolumeInput.addEventListener("change", () => {
    Sound.tone(660, 0.08, "square", 0.12);
  });
}

function renderRaceSetupSettings() {
  document.querySelectorAll("#laps-group [data-laps]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.laps) === TOTAL_LAPS);
  });
  document.querySelectorAll("#series-group [data-gp-races]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.gpRaces) === grandPrixRaces);
  });
  document.querySelectorAll("#aicount-group [data-aicount]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.aicount) === aiCount);
  });
  document.querySelectorAll("#aidiff-group [data-aidiff]").forEach((b) => {
    b.classList.toggle("active", b.dataset.aidiff === aiDifficulty);
  });
}

const lapsGroup = document.getElementById("laps-group");
if (lapsGroup) {
  lapsGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-laps]");
    if (!btn) return;
    Sound.ensure(); Sound.resume();
    TOTAL_LAPS = clampLaps(btn.dataset.laps);
    saveGameSettings({ totalLaps: TOTAL_LAPS });
    Sound.tone(660, 0.07, "square", 0.1);
    renderRaceSetupSettings();
  });
}

const seriesGroup = document.getElementById("series-group");
if (seriesGroup) {
  seriesGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-gp-races]");
    if (!btn) return;
    Sound.ensure(); Sound.resume();
    grandPrixRaces = clampGrandPrixRaces(btn.dataset.gpRaces);
    saveGameSettings({ grandPrixRaces });
    Sound.tone(660, 0.07, "square", 0.1);
    renderRaceSetupSettings();
    if (game.state === STATE.SELECT) renderMapSelect();
    if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) {
      resetP2pReadyForLobbyChange();
    }
  });
}

const aiCountGroup = document.getElementById("aicount-group");
if (aiCountGroup) {
  aiCountGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-aicount]");
    if (!btn) return;
    Sound.ensure(); Sound.resume();
    aiCount = clampAiCount(btn.dataset.aicount);
    saveGameSettings({ aiCount });
    Sound.tone(540, 0.07, "square", 0.1);
    renderRaceSetupSettings();
  });
}

const aiDiffGroup = document.getElementById("aidiff-group");
if (aiDiffGroup) {
  aiDiffGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-aidiff]");
    if (!btn) return;
    Sound.ensure(); Sound.resume();
    aiDifficulty = normalizeAiDifficulty(btn.dataset.aidiff);
    saveGameSettings({ aiDifficulty });
    Sound.tone(620, 0.07, "square", 0.1);
    renderRaceSetupSettings();
  });
}

const approvalsGroup = document.getElementById("approvals-group");
if (approvalsGroup) {
  approvalsGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-approvals]");
    if (!btn) return;
    if (game.p2pMode && game.p2pRole === "guest") return;
    Sound.ensure(); Sound.resume();
    game.battleApprovals = clampApprovals(btn.dataset.approvals);
    Sound.tone(700, 0.07, "square", 0.1);
    renderApprovalsSelect();
    if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) {
      resetP2pReadyForLobbyChange();
    }
  });
}

const battleTimingGroup = document.getElementById("battle-timing-group");
if (battleTimingGroup) {
  battleTimingGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-battle-timed]");
    if (!btn) return;
    if (game.p2pMode && game.p2pRole === "guest") return;
    Sound.ensure(); Sound.resume();
    game.battleUntimed = btn.dataset.battleTimed !== "1";
    saveGameSettings({ battleUntimed: game.battleUntimed });
    Sound.tone(700, 0.07, "square", 0.1);
    renderApprovalsSelect();
    if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) {
      resetP2pReadyForLobbyChange();
    }
  });
}

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

// Play vocoder jingle on first title screen interaction
titleScreen.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  Sound.playVocoderTitle();
}, { once: true });

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

if (p2pCancelLobbyBtn) {
  p2pCancelLobbyBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    p2pHostCancelRaceToLobby();
  });
}

if (p2pLeaveMatchBtn) {
  p2pLeaveMatchBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    p2pGuestLeaveMatch();
  });
}

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

// P2P Multiplayer button handlers
startP2pBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  Sound.stopTitleTheme(false);
  game.tournament = null;
  game.mode = "race";
  hideAll();
  p2pScreen.classList.remove("hidden");
});

p2pHostBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  p2pHostStatus.innerText = "Loading network library...";
  p2pHostStatus.className = "p2p-status";

  loadPeerJS(() => {
    p2pHostStatus.innerText = "Connecting to matchmaking...";
    const code = generateLobbyCode();

    try {
      if (peer) {
        try { peer.destroy(); } catch(e) {}
      }
      peer = new Peer("TKD-" + code, { config: getP2pIceConfig("relay") });

      const hostTimeout = setTimeout(() => {
        if (!game.p2pMode) {
          p2pHostStatus.innerText = "Connection timed out. Try again.";
          p2pHostStatus.className = "p2p-status error";
          try { peer.destroy(); } catch(e) {}
        }
      }, 15000);

      peer.on("open", (id) => {
        clearTimeout(hostTimeout);
        p2pHostStatus.innerText = hasP2pTurnFallback()
          ? "Lobby active. Direct P2P preferred; relay fallback available."
          : "Lobby active. Waiting for direct P2P players...";
        p2pHostStatus.className = "p2p-status ready";
        p2pMyCode.innerText = code;
        p2pCodeBox.style.display = "block";

        game.p2pMode = true;
        game.p2pRole = "host";
        game.multiplayer = true;
        ensureHostP2pPlayer();
      });

      peer.on("connection", (conn) => {
        conn.on("open", () => {
          const player = addP2pGuest(conn);
          if (!player) return;
          p2pHostStatus.innerText = `${game.p2pPlayers.length} players in lobby. Host starts the race.`;
          sendToConn(conn, {
            type: "lobby_connected",
            playerId: player.id,
            players: game.p2pPlayers,
            ...getP2pLobbyMapPayload(),
          });
          broadcastP2pLobby();
          if (game.state !== STATE.SELECT && game.state !== STATE.RACING && game.state !== STATE.COUNTDOWN) {
            enterP2pSelectScreen();
          } else if (game.state === STATE.SELECT) {
            syncP2pSelectionFromRoster({ preserveLocal: true });
            updateSelectionHighlight();
            updateP2pStartButton();
            renderP2pLobby();
          }
        });
        conn.on("data", (data) => {
          handleP2pData(data, conn);
        });
        conn.on("close", () => {
          removeP2pGuestByConn(conn);
        });
        conn.on("error", (err) => {
          p2pHostStatus.innerText = "Connection error: " + (err.message || "WebRTC negotiation failed");
          p2pHostStatus.className = "p2p-status error";
        });
      });

      peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          p2pHostBtn.click();
        } else {
          p2pHostStatus.innerText = "Matchmaking error: " + err.type;
          p2pHostStatus.className = "p2p-status error";
        }
      });
    } catch(e) {
      p2pHostStatus.innerText = "Failed to create: " + e.message;
      p2pHostStatus.className = "p2p-status error";
    }
  });
});

p2pJoinBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  const rawCode = p2pJoinInput.value.trim().toUpperCase();
  if (rawCode.length !== 6) {
    p2pJoinStatus.innerText = "Lobby code must be 6 characters!";
    p2pJoinStatus.className = "p2p-status error";
    return;
  }
  p2pJoinStatus.innerText = "Loading network library...";
  p2pJoinStatus.className = "p2p-status";

  loadPeerJS(() => {
    startP2pJoinAttempt(rawCode, "direct");
  });
});

p2pBackBtn.addEventListener("click", () => {
  Sound.ensure(); Sound.resume();
  handleP2pDisconnect();
  showMainMenu();
});

p2pStartRaceBtn.addEventListener("click", () => {
  if (game.p2pRole !== "host" || game.p2pPlayers.length < 2) return;
  enterP2pSelectScreen();
  broadcastP2pLobby();
});

const P2P_TURN_STORAGE_KEY = "turbokartTurnIceServers";
const P2P_STUN_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
  { urls: "stun:stun.relay.metered.ca:80" },
];

function getP2pConfiguredTurnIceServers() {
  if (Array.isArray(window.TURBOKART_TURN_ICE_SERVERS)) {
    return window.TURBOKART_TURN_ICE_SERVERS.filter(isP2pTurnIceServer);
  }

  try {
    const stored = localStorage.getItem(P2P_TURN_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isP2pTurnIceServer) : [];
  } catch(e) {
    return [];
  }
}

function isP2pTurnIceServer(server) {
  if (!server || !server.urls) return false;
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some(url => typeof url === "string" && /^(turn|turns):/i.test(url));
}

function hasP2pTurnFallback() {
  return getP2pConfiguredTurnIceServers().length > 0;
}

function getP2pIceConfig(mode = "direct") {
  const iceServers = P2P_STUN_ICE_SERVERS.slice();
  if (mode === "relay") {
    iceServers.push(...getP2pConfiguredTurnIceServers());
  }
  return {
    iceServers,
    iceCandidatePoolSize: 10
  };
}

function startP2pJoinAttempt(rawCode, mode = "direct") {
  const usingRelay = mode === "relay";
  const turnAvailable = hasP2pTurnFallback();
  const attemptSeq = ++p2pJoinAttemptSeq;
  const isCurrentAttempt = () => attemptSeq === p2pJoinAttemptSeq;
  p2pJoinStatus.innerText = usingRelay
    ? "Direct P2P failed. Trying TURN relay..."
    : "Connecting to lobby " + rawCode + " with direct P2P...";
  p2pJoinStatus.className = "p2p-status";

  try {
    if (peer) {
      try { peer.destroy(); } catch(e) {}
    }
    game.p2pConn = null;
    peer = new Peer(undefined, { config: getP2pIceConfig(mode) });

    peer.on("open", () => {
      if (!isCurrentAttempt()) return;
      const conn = peer.connect("TKD-" + rawCode, { serialization: "json", reliable: true });
      game.p2pConn = conn;

      let settled = false;
      const finishFailedAttempt = (message) => {
        if (!isCurrentAttempt() || settled || game.p2pMode) return;
        settled = true;
        try { conn.close(); } catch(e) {}

        if (!usingRelay && turnAvailable) {
          startP2pJoinAttempt(rawCode, "relay");
          return;
        }

        p2pJoinStatus.innerText = message;
        p2pJoinStatus.className = "p2p-status error";
      };

      const joinTimeout = setTimeout(() => {
        if (!isCurrentAttempt()) return;
        if (usingRelay) {
          finishFailedAttempt("TURN relay connection failed. The relay credentials may be expired, unreachable, or blocked by this network.");
        } else if (turnAvailable) {
          finishFailedAttempt("Direct P2P timed out. Trying relay fallback...");
        } else {
          finishFailedAttempt("Direct P2P timed out. No TURN relay is configured, so this build can only connect on compatible networks.");
        }
      }, usingRelay ? 14000 : 9000);

      conn.on("open", () => {
        if (!isCurrentAttempt()) return;
        settled = true;
        clearTimeout(joinTimeout);
        p2pJoinStatus.innerText = usingRelay ? "Connected via relay! Joining lobby..." : "Connected directly! Joining lobby...";
        p2pJoinStatus.className = "p2p-status ready";
        game.p2pMode = true;
        game.p2pRole = "guest";
        game.multiplayer = true;
      });
      conn.on("data", (data) => {
        if (!isCurrentAttempt()) return;
        handleP2pData(data, conn);
      });
      conn.on("close", () => {
        clearTimeout(joinTimeout);
        if (isCurrentAttempt() && game.p2pMode) handleP2pDisconnect();
      });
      conn.on("error", (err) => {
        clearTimeout(joinTimeout);
        finishFailedAttempt(usingRelay
          ? "TURN relay connection error: " + (err.message || "WebRTC negotiation failed")
          : "Direct P2P connection error: " + (err.message || "WebRTC negotiation failed"));
      });
    });

    peer.on("error", (err) => {
      if (!isCurrentAttempt()) return;
      if (err.type === "peer-unavailable") {
        p2pJoinStatus.innerText = "Lobby not found. Check the code and make sure the host lobby is still open.";
      } else {
        p2pJoinStatus.innerText = "Matchmaking error: " + err.type;
      }
      p2pJoinStatus.className = "p2p-status error";
    });
  } catch(e) {
    p2pJoinStatus.innerText = usingRelay
      ? "TURN relay setup failed: " + e.message
      : "Direct P2P setup failed: " + e.message;
    p2pJoinStatus.className = "p2p-status error";
  }
}

function loadPeerJS(callback) {
  if (window.Peer) {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "peerjs.min.js";
  script.onload = () => {
    callback();
  };
  script.onerror = () => {
    alert("Could not load PeerJS library. Please check your internet connection.");
  };
  document.head.appendChild(script);
}

function generateLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getKartId(kart) {
  if (!kart) return null;
  if (game.p2pMode && kart.p2pId) return kart.p2pId;
  if (game.p2pMode) {
    if (game.p2pRole === "host") {
      if (kart === game.player) return "host";
      if (kart === game.player2) return "guest";
    } else {
      if (kart === game.player) return "guest";
      if (kart === game.player2) return "host";
    }
  } else {
    if (kart === game.player) return "p1";
    if (kart === game.player2) return "p2";
  }
  if (game.ais) {
    const idx = game.ais.indexOf(kart);
    if (idx !== -1) return "ai_" + idx;
  }
  return null;
}

function getKartById(id) {
  if (!id) return null;
  if (game.p2pMode && game.p2pKartById && game.p2pKartById[id]) {
    return game.p2pKartById[id];
  }
  if (game.p2pMode) {
    if (game.p2pRole === "host") {
      if (id === "host") return game.player;
      if (id === "guest") return game.player2;
    } else {
      if (id === "host") return game.player2;
      if (id === "guest") return game.player;
    }
  } else {
    if (id === "p1") return game.player;
    if (id === "p2") return game.player2;
  }
  if (id.startsWith("ai_")) {
    const idx = parseInt(id.slice(3));
    if (game.ais && game.ais[idx]) return game.ais[idx];
  }
  return null;
}

function sendP2pMessage(data) {
  if (game.p2pRole === "host") {
    broadcastP2pMessage(data);
    return;
  }
  if (game.p2pConn && game.p2pConn.open) {
    sendToConn(game.p2pConn, data);
  }
}

function serializeKartState(kart) {
  if (!kart) return null;
  return {
    x: kart.x,
    y: kart.y,
    heading: kart.heading,
    vx: kart.vx,
    vy: kart.vy,
    boostTimer: kart.boostTimer,
    citationBoostTimer: kart.citationBoostTimer || 0,
    shieldTimer: kart.shieldTimer,
    doubleBlindTimer: kart.doubleBlindTimer || 0,
    placeboSlowTimer: kart.placeboSlowTimer || 0,
    throttleLockTimer: kart.throttleLockTimer || 0,
    amendmentTimer: kart.amendmentTimer || 0,
    itemSlot: kart.itemSlot,
    itemState: kart.itemState,
    finished: kart.finished,
    eliminated: !!kart.eliminated,
    lap: kart.lap,
    nextCheckpoint: kart.nextCheckpoint,
    checkpointsThisLap: kart.checkpointsThisLap,
    finishTime: kart.finishTime,
    activeQuote: kart.activeQuote,
    quoteTimer: kart.quoteTimer,
    spinoutTimer: kart.spinoutTimer,
    coinsCollected: kart.coinsCollected,
    mergePullTimer: kart.mergePullTimer || 0,
    mergePullTargetId: kart.mergePullTargetId || null,
    ultCharge: kart.ultCharge || 0,
    ultReady: !!kart.ultReady,
    ultActiveTimer: kart.ultActiveTimer || 0,
    ultTier: kart.ultTier || 0,
    z: kart.z || 0,
    vz: kart.vz || 0,
  };
}

function applyKartState(kart, p, opts = {}) {
  if (!kart || !p) return;

  const px = p.x !== undefined ? p.x : p.x;
  const py = p.y !== undefined ? p.y : p.y;
  const ph = p.heading !== undefined ? p.heading : p.h;
  const pvx = p.vx !== undefined ? p.vx : 0;
  const pvy = p.vy !== undefined ? p.vy : 0;
  const pFinished = p.finished !== undefined ? p.finished : p.fin;
  const pElim = p.eliminated !== undefined ? p.eliminated : p.elim;

  const preserveBattleAuthority = !!opts.preserveBattleAuthority;
  const effectiveFinished = preserveBattleAuthority ? kart.finished : pFinished;
  const effectiveEliminated = preserveBattleAuthority ? kart.eliminated : pElim;
  const smooth = !!opts.smooth && !effectiveFinished && !effectiveEliminated;
  if (smooth && Number.isFinite(kart.x) && Number.isFinite(kart.y)) {
    const targetX = px + pvx * TUNING.P2P_REMOTE_VELOCITY_LEAD;
    const targetY = py + pvy * TUNING.P2P_REMOTE_VELOCITY_LEAD;
    const delta = dist(kart.x, kart.y, targetX, targetY);
    if (delta > TUNING.P2P_REMOTE_SNAP_DIST) {
      kart.x = px;
      kart.y = py;
      kart.heading = ph;
    } else {
      kart.x = lerp(kart.x, targetX, TUNING.P2P_REMOTE_INTERP);
      kart.y = lerp(kart.y, targetY, TUNING.P2P_REMOTE_INTERP);
      kart.heading += angleDiff(kart.heading, ph) * TUNING.P2P_REMOTE_INTERP;
    }
  } else {
    kart.x = px;
    kart.y = py;
    kart.heading = ph;
  }

  kart.vx = pvx;
  kart.vy = pvy;
  // Compact packets omit z/vz when grounded; old peers never send them.
  kart.z = Number.isFinite(p.z) ? p.z : 0;
  kart.vz = Number.isFinite(p.vz) ? p.vz : 0;
  kart._lastSyncAt = performance.now();

  kart.boostTimer = p.boostTimer ?? p.bt ?? 0;
  kart.citationBoostTimer = p.citationBoostTimer ?? p.cbt ?? 0;
  kart.shieldTimer = p.shieldTimer ?? p.st ?? 0;
  kart.doubleBlindTimer = p.doubleBlindTimer ?? p.dbt ?? 0;
  kart.placeboSlowTimer = p.placeboSlowTimer ?? p.pst ?? 0;
  kart.throttleLockTimer = p.throttleLockTimer ?? p.tlt ?? 0;
  kart.amendmentTimer = p.amendmentTimer ?? p.amt ?? 0;
  kart.itemSlot = p.itemSlot ?? p.it ?? null;
  kart.itemState = p.itemState ?? p.is ?? "empty";
  if (!preserveBattleAuthority) {
    kart.finished = pFinished || false;
    if (pElim !== undefined) kart.eliminated = !!pElim;
  }
  kart.lap = p.lap;
  if ((p.nextCheckpoint ?? p.nc) !== undefined) kart.nextCheckpoint = p.nextCheckpoint ?? p.nc;
  if ((p.checkpointsThisLap ?? p.cl) !== undefined) kart.checkpointsThisLap = p.checkpointsThisLap ?? p.cl;
  if ((p.finishTime ?? p.ft) !== undefined) kart.finishTime = p.finishTime ?? p.ft;
  kart.activeQuote = p.activeQuote ?? p.aq ?? null;
  kart.quoteTimer = p.quoteTimer ?? p.qt ?? 0;
  const incomingSpinout = p.spinoutTimer ?? p.sp ?? 0;
  kart.spinoutTimer = preserveBattleAuthority
    ? Math.max(kart.spinoutTimer || 0, incomingSpinout)
    : incomingSpinout;
  kart.coinsCollected = p.coinsCollected ?? p.cc ?? 0;
  if (!preserveBattleAuthority) {
    kart.mergePullTimer = p.mergePullTimer ?? p.mp ?? 0;
    kart.mergePullTargetId = p.mergePullTargetId ?? p.mt ?? null;
    kart.mergePullTarget = getKartById(kart.mergePullTargetId);
  }
  if ((p.ultCharge ?? p.uc) !== undefined) kart.ultCharge = p.ultCharge ?? p.uc ?? 0;
  if ((p.ultReady ?? p.ur) !== undefined) kart.ultReady = !!(p.ultReady ?? p.ur);
  if ((p.ultActiveTimer ?? p.ua) !== undefined) kart.ultActiveTimer = p.ultActiveTimer ?? p.ua ?? 0;
  if ((p.ultTier ?? p.ut) !== undefined) kart.ultTier = p.ultTier ?? p.ut ?? 0;
  applyBattleCompactFields(kart, p);
}

function applyLocalAuthoritativeEffects(kart, p) {
  if (!kart || !p) return;
  if (game.p2pMode && isBattleMode()) {
    applyBattleCompactFields(kart, p);
    if (p.mp !== undefined) kart.mergePullTimer = p.mp;
    if (p.mt !== undefined) {
      kart.mergePullTargetId = p.mt;
      kart.mergePullTarget = getKartById(p.mt);
    }
    if (p.elim !== undefined || p.eliminated !== undefined) {
      kart.eliminated = !!(p.elim ?? p.eliminated);
    }
  }
  const remoteSpinout = p.spinoutTimer ?? p.sp ?? 0;
  if (remoteSpinout > (kart.spinoutTimer || 0) + 2) {
    kart.spinoutTimer = remoteSpinout;
    kart.spinAngle = 0;
    kart.vx = p.vx ?? kart.vx;
    kart.vy = p.vy ?? kart.vy;
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      kart.x = p.x;
      kart.y = p.y;
    }
    triggerHitFlash("BLACK ICE!", "#57f2ff", 75, kart);
  }

  const remoteShield = p.shieldTimer ?? p.st;
  if (remoteShield !== undefined && remoteShield < (kart.shieldTimer || 0)) {
    kart.shieldTimer = remoteShield;
  }

  const remoteDoubleBlind = p.doubleBlindTimer ?? p.dbt ?? 0;
  if (remoteDoubleBlind > (kart.doubleBlindTimer || 0)) kart.doubleBlindTimer = remoteDoubleBlind;

  const remotePlacebo = p.placeboSlowTimer ?? p.pst ?? 0;
  if (remotePlacebo > (kart.placeboSlowTimer || 0)) kart.placeboSlowTimer = remotePlacebo;

  if (p.eliminated || p.elim) {
    applyKartState(kart, p);
  }
}

function serializeDragonState(dragon) {
  if (!dragon) return null;
  return {
    x: dragon.x,
    y: dragon.y,
    vx: dragon.vx,
    vy: dragon.vy,
    heading: dragon.heading,
    fireTimer: dragon.fireTimer,
    jawPhase: dragon.jawPhase,
    wingPhase: dragon.wingPhase,
    enraged: dragon.enraged,
    active: dragon.active
  };
}

function applyDragonState(state) {
  const dragon = game.track && game.track.regulatoryDragon;
  applyDragonObjectState(dragon, state);
}

function applyDragonEscapeState(state) {
  if (!state) return;
  if (!game.dragonEscape) game.dragonEscape = createDragonEscapeEntity();
  applyDragonObjectState(game.dragonEscape, state);
}

function applyBattleCompactFields(kart, p) {
  if (!kart || !p) return;
  if (p.ap !== undefined) kart.approvals = p.ap;
  if (p.bs !== undefined) kart.battleSteals = p.bs;
  if (p.rg !== undefined) kart.recoverGraceTimer = p.rg;
  if (p.kb !== undefined) kart.killedBy = p.kb ? getKartById(p.kb) : null;
}

function sendP2pBattleEnd() {
  if (!game.p2pMode || game.p2pRole !== "host" || !isBattleMode()) return;
  const ranking = game.finalRanking || [];
  sendP2pMessage({
    type: "battle_end",
    raceTime: game.raceTime,
    ranking: ranking.map((k) => getKartId(k)).filter(Boolean),
    karts: ranking.map((k) => ({ id: getKartId(k), s: serializeKartCompact(k) })).filter((row) => row.id),
  });
}

function applyP2pBattleEnd(data) {
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  if (data.raceTime !== undefined) game.raceTime = data.raceTime;
  const snapshots = data.karts || [];
  for (const snap of snapshots) {
    const kart = getKartById(snap.id);
    if (kart && snap.s) applyKartState(kart, snap.s);
  }
  const ids = data.ranking || [];
  game.finalRanking = ids.map((id) => getKartById(id)).filter(Boolean);
  game.p2pBattleEndPending = false;
  game._pauseFromState = null;
  pauseScreen.classList.add("hidden");
  game.state = STATE.FINISHED;
  showFinishScreen();
  bus.emit("race:finished", {});
}

function applyDragonObjectState(dragon, state) {
  if (!dragon || !state) return;
  dragon.x = state.x;
  dragon.y = state.y;
  dragon.vx = state.vx || 0;
  dragon.vy = state.vy || 0;
  dragon.heading = state.heading || 0;
  dragon.fireTimer = state.fireTimer !== undefined ? state.fireTimer : dragon.fireTimer;
  dragon.jawPhase = state.jawPhase || 0;
  dragon.wingPhase = state.wingPhase || 0;
  dragon.enraged = !!state.enraged;
  dragon.active = state.active !== false;
}

function serializeKartCompact(k) {
  if (!k) return null;
  const out = {
    x: Math.round(k.x * 10) / 10,
    y: Math.round(k.y * 10) / 10,
    h: Math.round(k.heading * 1000) / 1000,
    vx: Math.round(k.vx * 100) / 100,
    vy: Math.round(k.vy * 100) / 100,
    bt: k.boostTimer > 0 ? k.boostTimer : undefined,
    st: k.shieldTimer > 0 ? k.shieldTimer : undefined,
    sp: k.spinoutTimer > 0 ? k.spinoutTimer : undefined,
    it: k.itemSlot || undefined,
    is: k.itemState !== "empty" ? k.itemState : undefined,
    fin: k.finished || undefined,
    elim: k.eliminated || undefined,
    lap: k.lap,
    aq: k.activeQuote || undefined,
    qt: k.quoteTimer > 0 ? k.quoteTimer : undefined,
    cc: k.coinsCollected || undefined,
    mp: k.mergePullTimer > 0 ? k.mergePullTimer : undefined,
    mt: k.mergePullTargetId || undefined,
    uc: k.ultCharge > 0 ? Math.round(k.ultCharge) : undefined,
    ur: k.ultReady || undefined,
    ua: k.ultActiveTimer > 0 ? k.ultActiveTimer : undefined,
    ut: k.ultTier > 0 ? k.ultTier : undefined,
    cbt: k.citationBoostTimer > 0 ? k.citationBoostTimer : undefined,
    dbt: k.doubleBlindTimer > 0 ? k.doubleBlindTimer : undefined,
    pst: k.placeboSlowTimer > 0 ? k.placeboSlowTimer : undefined,
    tlt: k.throttleLockTimer > 0 ? k.throttleLockTimer : undefined,
    amt: k.amendmentTimer > 0 ? k.amendmentTimer : undefined,
    nc: k.nextCheckpoint,
    cl: k.checkpointsThisLap,
    ft: k.finishTime || undefined,
    z: (k.z > 0.05) ? Math.round(k.z * 10) / 10 : undefined,
    vz: (k.vz && Math.abs(k.vz) > 0.05) ? Math.round(k.vz * 100) / 100 : undefined,
  };
  if (isBattleMode() || k.approvals !== undefined) {
    out.ap = k.approvals ?? 0;
    out.bs = k.battleSteals || 0;
    out.rg = k.recoverGraceTimer || 0;
    out.kb = k.killedBy ? getKartId(k.killedBy) : null;
    out.mp = k.mergePullTimer || 0;
    out.mt = k.mergePullTargetId || null;
  }
  return out;
}

function serializeHazardCompact(h) {
  const type = (h instanceof DossierProjectile) ? 1 :
    (h instanceof RegulatoryProjectile) ? 2 :
    (h instanceof PlaceboPill) ? 3 :
    (h instanceof DoubleBlindCloud) ? 4 :
    (h instanceof DragonFire) ? 5 : 0;
  const out = {
    id: h.hid,
    t: type,
    x: Math.round(h.x * 10) / 10,
    y: Math.round(h.y * 10) / 10,
  };
  if (h.heading) out.h = Math.round(h.heading * 1000) / 1000;
  if (h.vx) out.vx = Math.round(h.vx * 100) / 100;
  if (h.vy) out.vy = Math.round(h.vy * 100) / 100;
  if (h.speed) out.sp = Math.round(h.speed * 100) / 100;
  if (h.spin) out.sn = Math.round(h.spin * 100) / 100;
  if (h.life) out.li = Math.round(h.life);
  if (h.r && h.r !== 18 && h.r !== 15 && h.r !== 12 && h.r !== 17 && h.r !== 20) out.r = h.r;
  if (h.enraged) out.en = 1;
  if (h.owner) out.oi = getKartId(h.owner);
  if (h.ignoreOwnerTimer > 0) out.io = Math.round(h.ignoreOwnerTimer);
  return out;
}

function sendHostSync() {
  if (!game.player) return;
  const now = performance.now();
  const includePickupState = !game.p2pLastPickupSyncAt ||
    now - game.p2pLastPickupSyncAt >= TUNING.P2P_PICKUP_FULL_SYNC_INTERVAL_MS;
  const includeHazards = !game.p2pLastHazardSyncAt ||
    now - game.p2pLastHazardSyncAt >= (1000 / TUNING.P2P_HAZARD_SYNC_HZ);
  const authState = (game.p2pMode && game.state === STATE.PAUSED && game._pauseFromState)
    ? game._pauseFromState
    : game.state;
  const sync = {
    type: "host_sync",
    rt: game.raceTime,
    gs: authState,
    dr: serializeDragonState(game.track && game.track.regulatoryDragon),
    de: serializeDragonState(game.dragonEscape),
    pl: (game.p2pPlayers || []).map(p => ({
      id: p.id,
      s: serializeKartCompact(getKartById(p.id))
    })),
    p2: serializeKartCompact(game.player),
    ai: game.ais.map(ai => serializeKartCompact(ai)),
  };
  if (includeHazards) {
    game.p2pLastHazardSyncAt = now;
    sync.hz = (game.hazards || []).map(serializeHazardCompact);
  }
  if (includePickupState) {
    game.p2pLastPickupSyncAt = now;
    sync.co = game.track.coins.map(c => c.collected ? 1 : 0);
    sync.ib = game.track.itemBoxes.map(b => b.active ? 1 : 0);
  }
  if (isBattleMode()) sync.btl = game.battleTimeLeft;
  sendP2pMessage(sync);
}

function sendGuestSync() {
  if (!game.player) return;
  sendP2pMessage({
    type: "guest_sync",
    playerId: game.p2pLocalId || "guest",
    state: serializeKartState(game.player),
    p2: serializeKartCompact(game.player),
  });
}

function handleP2pDisconnect({ silent = false } = {}) {
  p2pJoinAttemptSeq++;
  const battleEndPending = !!game.p2pBattleEndPending;
  const leaveMsg = {
    type: "player_left",
    playerId: game.p2pLocalId || (game.p2pRole === "host" ? "host" : "guest"),
    role: game.p2pRole
  };
  for (const conn of p2pConnections.values()) {
    try { sendToConn(conn, leaveMsg); } catch(e) {}
  }
  if (game.p2pConn && game.p2pConn.open) {
    try { sendToConn(game.p2pConn, leaveMsg); } catch(e) {}
  }

  for (const conn of p2pConnections.values()) {
    try { conn.close(); } catch(e) {}
  }
  p2pConnections.clear();
  if (game.p2pConn) {
    try { game.p2pConn.close(); } catch(e) {}
    game.p2pConn = null;
  }
  if (peer) {
    try { peer.destroy(); } catch(e) {}
    peer = null;
  }

  game.p2pMode = false;
  game.p2pRole = null;
  game.p2pPlayers = [];
  game.p2pLocalId = null;
  game.p2pKartById = {};
  game.multiplayer = false;
  game.p1Locked = false;
  game.p2Locked = false;
  game.p2pBattleEndPending = false;

  p2pHostStatus.innerText = "Click Create Lobby to generate a code";
  p2pHostStatus.className = "p2p-status";
  p2pCodeBox.style.display = "none";
  p2pMyCode.innerText = "------";
  p2pHostRoster.innerHTML = "";
  p2pJoinRoster.innerHTML = "";
  p2pStartRaceBtn.style.display = "none";

  p2pJoinInput.value = "";
  p2pJoinStatus.innerText = "Enter code and click Join";
  p2pJoinStatus.className = "p2p-status";

  if (game.state === STATE.RACING || game.state === STATE.COUNTDOWN || game.state === STATE.PAUSED || battleEndPending) {
    Sound.stopAllEngines();
    Sound.stopAllDriftSqueals();
    Sound.stopAllRumbles();
    game.state = STATE.TITLE;
    hideAll();
    titleScreen.classList.remove("hidden");
    if (!silent) alert("Peer disconnected! Returning to menu.");
  }
}

function handleP2pData(data, sourceConn = null) {
  if (!data) return;

  if (data.type === "ping") {
    const reply = { type: "pong", t: data.t };
    if (sourceConn) sendToConn(sourceConn, reply);
    else sendP2pMessage(reply);
    return;
  }
  if (data.type === "pong") {
    game.p2pPing = Math.round(performance.now() - data.t);
    return;
  }

  if (data.type === "lobby_connected") {
    game.p2pMode = true;
    game.p2pRole = "guest";
    game.multiplayer = true;
    game.p2pLocalId = data.playerId || "guest_1";
    game.p2pPlayers = data.players || [];
    applyLobbyMapSelection(data);
    if (data.trackIdx !== undefined && data.trackIdx !== null) setMusicTrack(data.trackIdx);
    renderP2pLobby();
    p2pJoinStatus.innerText = "Connected! Waiting for host to start...";
    p2pJoinStatus.className = "p2p-status ready";
    enterP2pSelectScreen();
  }

  else if (data.type === "lobby_full") {
    p2pJoinStatus.innerText = "Lobby is full!";
    p2pJoinStatus.className = "p2p-status error";
  }

  else if (data.type === "lobby_state") {
    game.p2pPlayers = data.players || game.p2pPlayers;
    applyLobbyMapSelection(data);
    if (data.trackIdx !== undefined && data.trackIdx !== null) setMusicTrack(data.trackIdx);
    syncP2pSelectionFromRoster();
    renderP2pLobby();
    if (game.state === STATE.SELECT) {
      updateSelectionHighlight();
      updateP2pStartButton();
      renderMapSelect();
      renderApprovalsSelect();
      updateP2pBattleLobbyUi();
    }
  }

  else if (data.type === "lobby_char_update") {
    if (game.p2pRole !== "host") return;
    const sourceId = getP2pIdForConn(sourceConn);
    const playerId = sourceId || data.playerId;
    const player = game.p2pPlayers.find(p => p.id === playerId);
    if (!player) return;
    player.charIdx = Math.round(clamp(Number(data.charIdx), 0, CHARACTERS.length - 1));
    player.locked = !!data.locked;
    broadcastP2pLobby();
    if (game.state === STATE.SELECT) {
      syncP2pSelectionFromRoster({ preserveLocal: true });
      updateSelectionHighlight();
      updateP2pStartButton();
      checkMultiplayerSelectFinish();
    }
  }

  else if (data.type === "select_update") {
    const sourceId = getP2pIdForConn(sourceConn);
    const playerId = sourceId || data.playerId || (game.p2pRole === "guest" ? "host" : "guest_1");
    const player = game.p2pPlayers && game.p2pPlayers.find(p => p.id === playerId);
    if (player) {
      player.charIdx = Math.round(clamp(Number(data.charIdx), 0, CHARACTERS.length - 1));
      player.locked = !!data.locked;
    }
    syncP2pSelectionFromRoster({ preserveLocal: true });
    updateSelectionHighlight();
    updateP2pStartButton();
    renderP2pLobby();
    if (game.p2pRole === "host") {
      broadcastP2pMessage({ ...data, playerId }, sourceConn);
    }
    checkMultiplayerSelectFinish();
  }

  else if (data.type === "map_update") {
    applyLobbyMapSelection(data);
    const selectedMap = MAPS[game.selectedMapIdx || 0];
    if (selectedMap) previewSelectedMapMusic(selectedMap);
    renderMapSelect();
    renderApprovalsSelect();
    updateP2pBattleLobbyUi();
    updateDriveButtonLabel();
  }

  else if (data.type === "return_lobby") {
    p2pReturnToLobbyLocal(data);
  }

  else if (data.type === "battle_end") {
    game.p2pLastHostSyncReceivedAt = performance.now();
    applyP2pBattleEnd(data);
  }

  else if (data.type === "merge_request") {
    if (game.p2pRole !== "host" || !isBattleMode()) return;
    const requesterId = getP2pIdForConn(sourceConn) || data.kartId;
    const kart = getKartById(requesterId);
    if (!kart || kart.eliminated || kart.finished) return;
    const now = performance.now();
    if ((kart.mergePullTimer || 0) > 0 || now - (kart._lastMergeRequestRpcAt || -Infinity) < 2500) return;
    kart._lastMergeRequestRpcAt = now;
    startMergeRequestPull(kart);
  }

  else if (data.type === "start_race") {
    applyLobbyMapSelection(data);
    if (data.players) game.p2pPlayers = data.players;
    if (data.trackIdx !== undefined && data.trackIdx !== null) setMusicTrack(data.trackIdx);
    if (!data.players) {
      game.selectedCharIdx = data.guestCharIdx;
      game.selectedCharIdx2 = data.hostCharIdx;
    }
    game.tournament = data.tournament || null;
    if (game.tournament?.format === "grand_prix") {
      game.mapSelection = GRAND_PRIX_ID;
    }
    ensureSelectedMapMatchesMode();
    game.p2pBattleEndPending = false;
    if (game.p2pRole === "guest") {
      game.p2pLastHostSyncReceivedAt = performance.now();
    }

    // Sync dragon trail from host seed so all clients have the same map
    if (data.dragonSeed !== undefined && MAPS[game.selectedMapIdx].id === "dragon_escape") {
      regenerateDragonTrail(data.dragonSeed);
    }

    Sound.stopTitleTheme();
    hideAll();
    buildRace();
    startCountdown();
    Sound.startEngine(1);
  }

  else if (data.type === "tournament_standings") {
    game.tournament = data.tournament;
    if (!finishScreen.classList.contains("hidden")) {
      showFinishScreen();
    }
  }

  else if (data.type === "host_sync") {
    if (game.p2pRole === "guest") {
      game.p2pLastHostSyncReceivedAt = performance.now();
      game.p2pConnectionUnstable = false;
    }
    const gs = data.gs ?? data.state;
    if (gs !== undefined) {
      if (game.state !== gs) {
        if (game.p2pMode && game.state === STATE.PAUSED && gs !== STATE.FINISHED) {
          // Keep local pause overlay while the online race continues.
        } else if (gs === STATE.FINISHED) {
          game._pauseFromState = null;
          pauseScreen.classList.add("hidden");
          game.state = STATE.FINISHED;
          if (game.p2pMode && isBattleMode() && game.p2pRole === "guest") {
            game.p2pBattleEndPending = true;
          } else {
            showFinishScreen();
          }
        } else {
          game.state = gs;
        }
      }
    }
    if ((data.rt ?? data.raceTime) !== undefined) game.raceTime = data.rt ?? data.raceTime;
    if (data.btl !== undefined && isBattleMode()) game.battleTimeLeft = data.btl;
    if (data.dr ?? data.dragon) applyDragonState(data.dr ?? data.dragon);
    if (data.de ?? data.dragonEscape) applyDragonEscapeState(data.de ?? data.dragonEscape);

    const players = data.pl ?? data.players;
    if (players) {
      for (const ps of players) {
        if (!ps) continue;
        const state = ps.s ?? ps.state;
        if (ps.id === game.p2pLocalId) {
          applyLocalAuthoritativeEffects(game.player, state);
          continue;
        }
        applyKartState(getKartById(ps.id), state, { smooth: true });
      }
    }

    if (game.player2 && data.p2) {
      applyKartState(game.player2, data.p2, { smooth: true });
    }

    const ais = data.ai ?? data.ais;
    if (game.ais && ais) {
      for (let i = 0; i < game.ais.length; i++) {
        if (ais[i]) {
          applyKartState(game.ais[i], ais[i], { smooth: true });
        }
      }
    }

    const coins = data.co ?? data.coins;
    if (coins) {
      for (let i = 0; i < game.track.coins.length; i++) {
        game.track.coins[i].collected = !!coins[i];
      }
    }

    const ibs = data.ib ?? data.itemBoxes;
    if (ibs) {
      for (let i = 0; i < game.track.itemBoxes.length; i++) {
        game.track.itemBoxes[i].active = !!ibs[i];
      }
    }

    const hazards = data.hz ?? data.hazards;
    if (hazards) {
      const existingById = new Map();
      for (const h of (game.hazards || [])) {
        if (h.hid) existingById.set(h.hid, h);
      }
      const newHazards = [];
      for (const h of hazards) {
        const hid = h.id ?? h.hid;
        const type = h.t;
        let existing = hid ? existingById.get(hid) : null;
        if (existing) {
          existing.x = h.x;
          existing.y = h.y;
          if (h.h !== undefined || h.heading !== undefined) existing.heading = h.h ?? h.heading;
          if (h.vx !== undefined) existing.vx = h.vx;
          if (h.vy !== undefined) existing.vy = h.vy;
          if (h.sn !== undefined || h.spin !== undefined) existing.spin = h.sn ?? h.spin ?? existing.spin;
          if (h.li !== undefined || h.life !== undefined) existing.life = h.li ?? h.life ?? existing.life;
          if (h.r !== undefined) existing.r = h.r;
          existing.active = h.active !== false;
          if (h.io !== undefined || h.ignoreOwnerTimer !== undefined) existing.ignoreOwnerTimer = h.io ?? h.ignoreOwnerTimer ?? 0;
          existingById.delete(hid);
          newHazards.push(existing);
        } else {
          let obj;
          const hType = type ?? ((h.isDossier) ? 1 : (h.isRegulatory) ? 2 : (h.isPlacebo) ? 3 : (h.isDoubleBlind) ? 4 : (h.isDragonFire) ? 5 : 0);
          const heading = h.h ?? h.heading ?? 0;
          const speed = h.sp ?? h.speed ?? 8;
          if (hType === 1) {
            obj = new DossierProjectile(h.x, h.y, heading, getKartById(h.oi ?? h.ownerId));
          } else if (hType === 2) {
            obj = new RegulatoryProjectile(h.x, h.y, heading, speed, !!(h.en ?? h.enraged));
          } else if (hType === 3) {
            obj = new PlaceboPill(h.x, h.y, getKartById(h.oi ?? h.ownerId));
          } else if (hType === 4) {
            obj = new DoubleBlindCloud(h.x, h.y, heading, getKartById(h.oi ?? h.ownerId));
          } else if (hType === 5) {
            obj = new DragonFire(h.x, h.y, heading, speed);
          } else {
            obj = new MergeConflict(h.x, h.y, getKartById(h.oi ?? h.ownerId));
          }
          if (hid) obj.hid = hid;
          if (h.vx !== undefined) obj.vx = h.vx;
          if (h.vy !== undefined) obj.vy = h.vy;
          if (h.sn !== undefined || h.spin !== undefined) obj.spin = h.sn ?? h.spin ?? obj.spin;
          if (h.li !== undefined || h.life !== undefined) obj.life = h.li ?? h.life ?? obj.life;
          if (h.r !== undefined) obj.r = h.r;
          if (h.io !== undefined || h.ignoreOwnerTimer !== undefined) obj.ignoreOwnerTimer = h.io ?? h.ignoreOwnerTimer ?? 0;
          obj.active = h.active !== false;
          newHazards.push(obj);
        }
      }
      game.hazards = newHazards;
    }
  }

  else if (data.type === "pickup_request") {
    if (applyP2pPickupRequest(data, sourceConn)) {
      const requesterId = getP2pIdForConn(sourceConn) || data.kartId;
      const requester = getKartById(requesterId);
      broadcastP2pMessage({
        type: "pickup_confirm",
        pickup: data.pickup,
        index: data.index,
        kartId: requesterId,
        coinsCollected: requester ? requester.coinsCollected : undefined
      });
    }
  }

  else if (data.type === "pickup_confirm") {
    applyP2pPickupState(data);
  }

  else if (data.type === "guest_sync") {
    if (data.playerId && data.state) {
      applyKartState(getKartById(data.playerId), data.state, {
        smooth: true,
        preserveBattleAuthority: game.p2pMode && isBattleMode(),
      });
      if (game.p2pRole === "host") {
        broadcastP2pMessage(data, sourceConn);
      }
      return;
    }
    if (game.player2 && data.p2) {
      applyKartState(game.player2, data.p2, {
        smooth: true,
        preserveBattleAuthority: game.p2pMode && isBattleMode(),
      });
    }
  }

  else if (data.type === "shoot_dossier") {
    const ownerKart = getKartById(data.kartId) || game.player2;
    if (ownerKart) {
      const d = new DossierProjectile(data.x, data.y, data.heading, ownerKart);
      game.hazards.push(d);
    }
  }

  else if (data.type === "drop_conflict") {
    if (game.p2pMode && game.p2pRole === "host" && game.player2) {
      const h = new MergeConflict(data.x, data.y, getKartById(data.kartId));
      game.hazards.push(h);
    }
  }

  else if (data.type === "drop_placebo") {
    if (game.p2pMode && game.p2pRole === "host") {
      game.hazards.push(new PlaceboPill(data.x, data.y, getKartById(data.kartId)));
    }
  }

  else if (data.type === "double_blind_cloud") {
    if (game.p2pMode && game.p2pRole === "host") {
      game.hazards.push(new DoubleBlindCloud(data.x, data.y, data.heading, getKartById(data.kartId)));
    }
  }

  else if (data.type === "deauth_shockwave") {
    if (game.p2pMode && game.p2pRole === "host") {
      const kart = getKartById(data.kartId);
      if (kart) applyDeauthShockwave(kart);
    }
  }

  else if (data.type === "action_event") {
    const kart = getKartById(data.kartId);
    if (kart) {
      triggerShootEffect(kart, data.item);
    }
    if (game.p2pRole === "host") {
      broadcastP2pMessage(data, sourceConn);
    }
  }

  else if (data.type === "player_left") {
    if (game.p2pRole === "host") {
      handleP2pPlayerRemoved(data.playerId);
    } else {
      handleP2pDisconnect({ silent: true });
      const who = data.role === "host" ? "Host" : "A player";
      if (game.state === STATE.RACING || game.state === STATE.COUNTDOWN || game.state === STATE.PAUSED) {
        alert(`${who} left the race. Returning to menu.`);
      }
    }
  }

  else if (data.type === "hazard_collision") {
    let bestIdx = -1;
    let bestDist = 50;
    for (let i = 0; i < game.hazards.length; i++) {
      const d = dist(data.x, data.y, game.hazards[i].x, game.hazards[i].y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      const h = game.hazards[bestIdx];
      game.particles.burst(h.x, h.y, h instanceof DossierProjectile ? "#57f2ff" : "#ff4d6d", 15);
      game.hazards.splice(bestIdx, 1);
    }
  }
}

function noopParticleSystem() {
  return {
    list: [],
    add() {},
    burst() {},
    update() {},
    draw() {},
  };
}

function selectHeadlessMap(mapOverride = null) {
  const requestedMap = mapOverride || URL_PARAMS.get("map") || URL_PARAMS.get("headlessMap") || "protocol_amendment_labyrinth";
  const idx = MAPS.findIndex(m => m.id === requestedMap || m.name === requestedMap);
  game.selectedMapIdx = idx >= 0 ? idx : 0;
  return MAPS[game.selectedMapIdx];
}

function selectHeadlessCharacter(charOverride = null) {
  const requestedChar = charOverride || URL_PARAMS.get("char") || URL_PARAMS.get("character") || "anton";
  const idx = CHARACTERS.findIndex(c => c.id === requestedChar || c.name.toLowerCase() === requestedChar.toLowerCase());
  game.selectedCharIdx = idx >= 0 ? idx : 0;
  return CHARACTERS[game.selectedCharIdx];
}

function headlessFlag(name, defaultValue = false) {
  const raw = URL_PARAMS.get(name);
  if (raw === null) return defaultValue;
  return raw === "" || raw === "1" || raw === "true" || raw === "yes";
}

// Mode-agnostic "self" features shared by every agent (race + arena/battle).
// Kept as an identical PREFIX of both observation vectors so a battle policy can
// optionally warm-start from a race trunk later (transfer learning).
const HEADLESS_BASE_SELF_KEYS = [
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
const HEADLESS_RACE_TAIL_KEYS = [
  "headingError",
  "targetDistance",
  "lateralOffset",
  "nextHeadingError",
  "nextTargetDistance",
];
// Arena/Battle-only combat tail: own lives, field state, and the 3 nearest rivals.
const HEADLESS_BATTLE_RIVAL_COUNT = 3;
const HEADLESS_BATTLE_TAIL_KEYS = ["ownApprovals", "survivorsFraction", "battleTimeLeft", "ramOpportunity"];
for (let i = 0; i < HEADLESS_BATTLE_RIVAL_COUNT; i++) {
  HEADLESS_BATTLE_TAIL_KEYS.push(`rival${i}Bearing`, `rival${i}Distance`, `rival${i}Approvals`, `rival${i}Spinning`);
}
const HEADLESS_RAY_ANGLES_DEG = [-90, -60, -35, -15, 0, 15, 35, 60, 90];
const HEADLESS_RAY_ANGLES = HEADLESS_RAY_ANGLES_DEG.map(deg => deg * Math.PI / 180);
const HEADLESS_RAY_RANGE = 760;
const HEADLESS_RAY_STEP = 28;
const HEADLESS_ITEM_TYPES = ["boost", "shield", "handling", "conflict", "placebo", "doubleblind", "dossier", "deauth", "mergerequest", "hotfix", "fasttrack"];
// Base = shared self features + rays + item slot flags (identical for both modes).
const HEADLESS_BASE_OBS_KEYS = [...HEADLESS_BASE_SELF_KEYS];
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`roadRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`kartRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`hazardRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`pickupRay${deg}`);
for (const deg of HEADLESS_RAY_ANGLES_DEG) HEADLESS_BASE_OBS_KEYS.push(`boosterRay${deg}`);
for (const item of HEADLESS_ITEM_TYPES) HEADLESS_BASE_OBS_KEYS.push(`item:${item}`);
// Full per-mode vectors: base prefix + mode-specific tail.
const HEADLESS_OBS_KEYS = [...HEADLESS_BASE_OBS_KEYS, ...HEADLESS_RACE_TAIL_KEYS];
const HEADLESS_BATTLE_OBS_KEYS = [...HEADLESS_BASE_OBS_KEYS, ...HEADLESS_BATTLE_TAIL_KEYS];
// Keys for whichever mode is currently active (used by reset/step/observation).
function headlessObsKeys() {
  return isBattleMode() ? HEADLESS_BATTLE_OBS_KEYS : HEADLESS_OBS_KEYS;
}
const HEADLESS_DQN_ACTIONS = [
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

function getHeadlessCheckpointCenter(index) {
  if (!game.track) return null;
  const count = game.track.checkpointCount || game.track.n;
  const idx = game.track.isOpen ? Math.min(index, count - 1) : ((index % count) + count) % count;
  return game.track.checkpointCenter(idx);
}

function getPolicyCheckpointCenter(kart) {
  if (!game.track) return null;
  const count = game.track.checkpointCount || game.track.n;
  const idx = game.track.isOpen ? Math.min(kart.nextCheckpoint, count - 1) : (kart.nextCheckpoint % count);
  return game.track.checkpointCenter(idx);
}

function normalizedRoadRayDistance(kart, relAngle) {
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

function normalizedObjectRayDistance(kart, relAngle, objects, defaultRadius = 20) {
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
    const radius = getRayObjectRadius(obj, defaultRadius) + getKartCollisionRadius(kart);
    if (lateral <= radius) best = Math.min(best, Math.max(0, forward - radius));
  }

  return clamp(best / HEADLESS_RAY_RANGE, 0, 1);
}

function getHeadlessRayObjects(kart) {
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

// Shared, mode-agnostic base features: self kinematics + car stats + status + rays + item slot.
// Order MUST match HEADLESS_BASE_OBS_KEYS.
function getHeadlessBaseValues(kart) {
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

// Race navigation tail (checkpoint targeting). Order MUST match HEADLESS_RACE_TAIL_KEYS.
function getHeadlessRaceTail(kart) {
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

// Battle combat tail: own lives, field state, ram opportunity, and the N nearest rivals.
// Order MUST match HEADLESS_BATTLE_TAIL_KEYS.
function getHeadlessBattleTail(kart) {
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
    if (qualifiesApprovalRam(kart, def, dirx, diry)) ram = 1;
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

function getHeadlessObservation(kart) {
  const values = getHeadlessBaseValues(kart);
  if (isBattleMode()) {
    for (const v of getHeadlessBattleTail(kart)) values.push(v);
    return { keys: HEADLESS_BATTLE_OBS_KEYS, values, target: null, nextTarget: null };
  }
  const race = getHeadlessRaceTail(kart);
  for (const v of race.values) values.push(v);
  return { keys: HEADLESS_OBS_KEYS, values, target: race.target, nextTarget: race.nextTarget };
}

function normalizeHeadlessAction(action = {}) {
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

function applyHeadlessAction(kart, track, dt, action) {
  const a = normalizeHeadlessAction(action);
  if (a.item && kart.itemState === "active" && kart.itemSlot) kart.useItem();
  if (a.ultimate && kart.ultReady) activateUltimate(kart);
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

function _mlpLayerForward(x, layer) {
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

function headlessMlpForward(weights, inputValues) {
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

function applyMeanExpansion(values, k) {
  k = Number(k || 0);
  if (!Number.isFinite(k) || k <= 0 || !values.length) return values;
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i];
  mean /= values.length;
  for (let i = 0; i < values.length; i++) values[i] = values[i] - mean + (k + 1) * mean;
  return values;
}

function runHeadlessMlp(weights, observation) {
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

function buildModelObservationValues(weights, observation, kart = null) {
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

function runHeadlessDqn(weights, observation, kart = null) {
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

function runHeadlessSac(weights, observation, kart = null) {
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

function validateModelPayload(payload) {
  if (!payload || !payload.type) throw new Error("Not an Audit Trail model");
  if (payload.type === "sac") return validateSacModelPayload(payload);
  return validateDqnModelPayload(payload);
}

function validateSacModelPayload(payload) {
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

function validateDqnModelPayload(payload) {
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

function expandCompactDqnPolicy(payload) {
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

class HeadlessRandomKart extends Kart {
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

class HeadlessMlpKart extends Kart {
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

class HeadlessDqnKart extends Kart {
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

class HeadlessExternalKart extends Kart {
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

function enableHeadlessAgent(agentType) {
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

class TrainedAIKart extends Kart {
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
const DqnAIKart = TrainedAIKart;

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

function configureHeadlessEpisode(config) {
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
      const diffMult = AI_DIFFICULTIES[aiDifficulty] || 1.0;
      for (let idx = game.ais.length; idx < targetOpponents; idx++) {
        const pos = gridSlot(idx + 1);
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
  // that buildRace() originally initialized, leaving their `approvals` undefined.
  if (isBattleMode()) initBattleKartState();
}

function summarizeHeadlessEpisode(map, frames, simSeconds, episodeIdx = 0) {
  const ranking = rankAll().map((kart, idx) => ({
    place: idx + 1,
    name: kart.name,
    charId: kart.charId,
    lap: kart.lap,
    nextCheckpoint: kart.nextCheckpoint,
    progress: Math.round(progressValue(kart) * 1000) / 1000,
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

function computeHeadlessFrameReward(kart, beforeProgress, beforeLap, beforeFinished) {
  const afterProgress = progressValue(kart);
  let reward = (afterProgress - beforeProgress) * 10;
  if ((kart.lap || 0) > beforeLap) reward += 50;
  if (!beforeFinished && kart.finished) reward += 200;
  return reward;
}

// Arena/Battle reward, rebalanced toward the actual objective (win) so dense shaping
// can't be farmed without winning:
//   combat:   +1 land a hit, +1 revoke a rival life, -1.5 lose your own life
//   item loop: +0.3 pick up an item, +0.3 fire one, +0.03 per coin (charges items/ult)
//   terminal: +20 for winning (last standing / top rank), -8 on elimination
// There is deliberately NO ult-use bonus: ults earn reward only when they land a hit
// (registerBattleHit), so the agent must aim them at rivals rather than spam them.
// Steal/loss/hit counts are accumulated in the game logic and consumed (reset) here.
function computeHeadlessBattleReward(kart) {
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
    if (!kart.eliminated && (alive.length <= 1 || rankAll()[0] === kart)) reward += 20;
    else if (!kart.eliminated) reward -= 5; // surviving to a timeout without leading is a soft loss
  }
  return reward;
}

function computeHeadlessStepReward(kart, beforeProgress, beforeLap, beforeFinished) {
  if (isBattleMode()) return computeHeadlessBattleReward(kart);
  return computeHeadlessFrameReward(kart, beforeProgress, beforeLap, beforeFinished);
}

function makeHeadlessConfig(overrides = {}) {
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
    map: overrides.map ?? URL_PARAMS.get("map") ?? URL_PARAMS.get("headlessMap") ?? (battle ? BATTLE_ARENA_ID : "protocol_amendment_labyrinth"),
    character: overrides.character ?? URL_PARAMS.get("char") ?? URL_PARAMS.get("character") ?? "anton",
    opponentModels: Array.isArray(overrides.opponentModels) && overrides.opponentModels.length ? overrides.opponentModels : null,
    classicOpponentSlots: Math.max(0, Math.floor(Number(overrides.classicOpponentSlots ?? 0))),
    opponentCount: Number.isFinite(Number(overrides.opponentCount)) && overrides.opponentCount !== null && overrides.opponentCount !== undefined ? Math.min(7, Math.max(0, Math.floor(Number(overrides.opponentCount)))) : null,
  };
}

function runHeadlessEpisode(config, episodeIdx = 0) {
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
  hideAll();
  buildRace();
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
    const beforeProgress = progressValue(game.player);
    const beforeFinished = !!game.player.finished;
    const beforeLap = game.player.lap || 0;
    const beforeObs = config.trace ? getHeadlessObservation(game.player) : null;
    simSeconds += 1 / 60;
    game.startTime = performance.now() - simSeconds * 1000;
    update(dt, simSeconds * 1000);
    game.skidMarks.length = 0;
    const afterProgress = progressValue(game.player);
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
    if (areAllHumansDone()) {
      finishRace();
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

function runHeadlessSimulation() {
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

async function loadHeadlessPolicyModel() {
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

const HEADLESS_EXTERNAL_STATE = {
  config: null,
  simSeconds: 0,
  frames: 0,
  reward: 0,
};


function headlessExternalTerminal() {
  const config = HEADLESS_EXTERNAL_STATE.config;
  if (!config || !game.player) return true;
  return game.state === STATE.FINISHED
    || game.player.finished
    || game.player.eliminated
    || HEADLESS_EXTERNAL_STATE.frames >= config.frames;
}

function headlessRlStepOnce(action) {
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
    const beforeProgress = progressValue(game.player);
    const beforeLap = game.player.lap || 0;
    const beforeFinished = !!game.player.finished;
    HEADLESS_EXTERNAL_STATE.simSeconds += 1 / 60;
    HEADLESS_EXTERNAL_STATE.frames++;
    game.startTime = performance.now() - HEADLESS_EXTERNAL_STATE.simSeconds * 1000;
    update(1, HEADLESS_EXTERNAL_STATE.simSeconds * 1000);
    game.skidMarks.length = 0;
    reward += computeHeadlessStepReward(game.player, beforeProgress, beforeLap, beforeFinished);
    if (areAllHumansDone()) finishRace();
  }
  const done = game.state === STATE.FINISHED || game.player.finished || game.player.eliminated || HEADLESS_EXTERNAL_STATE.frames >= config.frames;
  const obs = getHeadlessObservation(game.player);
  window.__lastRlRanking = rankAll().map(k => ({
    name: k.name,
    charId: k.charId,
    finished: !!k.finished,
    eliminated: !!k.eliminated,
    progress: progressValue(k),
  }));
  return {
    obs: obs.values,
    reward,
    done,
    info: {
      frame: HEADLESS_EXTERNAL_STATE.frames,
      simSeconds: HEADLESS_EXTERNAL_STATE.simSeconds,
      raceTime: game.raceTime,
      progress: progressValue(game.player),
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

function setupExternalRlApi() {
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
    hideAll();
    buildRace();
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

// Test / Playwright helpers (page.evaluate accessible).
window.isUntimedHumanBattle = isUntimedHumanBattle;
window.qualifiesApprovalRam = qualifiesApprovalRam;
window.resolveFreshBattleAttribution = resolveFreshBattleAttribution;
window.popApproval = popApproval;
window.tryApprovalRam = tryApprovalRam;
window.checkBattleEnd = checkBattleEnd;
window.isKartAirborne = isKartAirborne;
window.integrateKartVertical = integrateKartVertical;
window.checkTrackRamps = checkTrackRamps;
window.constrainArenaKart = constrainArenaKart;
window.kartVisualZOffset = kartVisualZOffset;
window.isGroundHazardImmuneWhenAirborne = isGroundHazardImmuneWhenAirborne;
window.serializeKartCompact = serializeKartCompact;
window.applyKartState = applyKartState;
window.isDayMode = isDayMode;
window.setTimeOfDay = setTimeOfDay;
window.ellipseNormDist = ellipseNormDist;

// Resume audio context on any user click
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

