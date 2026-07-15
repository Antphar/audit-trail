import { TUNING } from "../config/tuning.js";
import { CHARACTERS } from "../config/characters.js";
import { clamp, TAU } from "../core/math.js";
import {
  MAPS, GRAND_PRIX_ID, clampGrandPrixRaces, regenerateDragonTrail,
} from "../config/maps.js";
import {
  STATE, game, isBattleMode, isGrandPrixSelection, isGrandPrixActive, shouldShowGrandPrixCard,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { sendP2pMessage, resetP2pReadyForLobbyChange } from "../net/p2p.js";
import { uiRuntime } from "./ui-runtime.js";
import { screens } from "./screens.js";
import {
  updateSelectionHighlight, updateP2pStartButton, updateP2pBattleLobbyUi,
  setLocalP2pCharacterIdx, syncP2pSelectionFromRoster,
} from "./lobby.js";

const TRAINED_AI_ENABLED = true;
const aiSelectSection = document.getElementById("ai-select-section");
const driveBtn = document.getElementById("drive-btn");

function isArenaMap(mapOrIdx) {
  const m = typeof mapOrIdx === "number" ? MAPS[mapOrIdx] : mapOrIdx;
  return !!(m && m.arena);
}
const BATTLE_ARENA_ID = "battle_arena";
function getArenaMapIdx() {
  const idx = MAPS.findIndex((m) => m.id === BATTLE_ARENA_ID);
  return idx >= 0 ? idx : 0;
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
function getTotalLaps() { return uiRuntime.getTotalLaps ? uiRuntime.getTotalLaps() : 3; }
function getGrandPrixRaces() { return uiRuntime.getGrandPrixRaces ? uiRuntime.getGrandPrixRaces() : 3; }

export function initRaceSetupListeners(deps = {}) {
  const saveGameSettings = deps.saveGameSettings || (() => {});
  const setTotalLaps = deps.setTotalLaps || (() => {});
  const setGrandPrixRaces = deps.setGrandPrixRaces || (() => {});
  const setAiCount = deps.setAiCount || (() => {});
  const setAiDifficulty = deps.setAiDifficulty || (() => {});
  const normalizeAiDifficulty = deps.normalizeAiDifficulty || ((v) => v);
  const clampLaps = deps.clampLaps || ((v) => v);
  const clampAiCount = deps.clampAiCount || ((v) => v);

  const lapsGroup = document.getElementById("laps-group");
  if (lapsGroup) {
    lapsGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-laps]");
      if (!btn) return;
      Sound.ensure(); Sound.resume();
      setTotalLaps(clampLaps(btn.dataset.laps));
      saveGameSettings({ totalLaps: getTotalLaps() });
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
      setGrandPrixRaces(clampGrandPrixRaces(btn.dataset.gpRaces));
      saveGameSettings({ grandPrixRaces: getGrandPrixRaces() });
      Sound.tone(660, 0.07, "square", 0.1);
      renderRaceSetupSettings();
      if (game.state === STATE.SELECT) renderMapSelect();
      if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) resetP2pReadyForLobbyChange();
    });
  }
  const aiCountGroup = document.getElementById("aicount-group");
  if (aiCountGroup) {
    aiCountGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-aicount]");
      if (!btn) return;
      Sound.ensure(); Sound.resume();
      setAiCount(clampAiCount(btn.dataset.aicount));
      saveGameSettings({ aiCount: uiRuntime.getAiCount() });
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
      setAiDifficulty(normalizeAiDifficulty(btn.dataset.aidiff));
      saveGameSettings({ aiDifficulty: uiRuntime.getAiDifficulty() });
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
      if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) resetP2pReadyForLobbyChange();
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
      if (game.p2pMode && game.p2pRole === "host" && game.state === STATE.SELECT) resetP2pReadyForLobbyChange();
    });
  }
}

export function getMapFeatureChips(map) {
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
export function ensureSelectedMapMatchesMode() {
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

export function getGrandPrixCircuitIndices() {
  const indices = [];
  for (let i = 0; i < MAPS.length; i++) {
    const m = MAPS[i];
    if (!m.arena && m.id !== "dragon_escape") indices.push(i);
  }
  return indices;
}

export function getDefaultCircuitMapIdx() {
  const circuits = getGrandPrixCircuitIndices();
  return circuits.length ? circuits[0] : 0;
}

export function createGrandPrixTournament(totalRaces = getGrandPrixRaces()) {
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

export function selectGrandPrixMap() {
  game.mapSelection = GRAND_PRIX_ID;
  game.tournament = null;
  game.selectedMapIdx = getDefaultCircuitMapIdx();
}

export function selectCircuitMap(idx) {
  const map = MAPS[idx];
  if (!map) return;
  game.mapSelection = map.id;
  game.selectedMapIdx = idx;
  game.tournament = null;
}

export function syncMapSelectionFromIdx(mapIdx) {
  const map = MAPS[mapIdx];
  if (map) game.mapSelection = map.id;
}

export function sanitizeP2pLobbyMode(mode) {
  return mode === "battle" ? "battle" : "race";
}


export function selectArenaMap(idx) {
  const map = MAPS[idx];
  if (!map || !map.arena) return;
  game.mode = "battle";
  game.mapSelection = map.id;
  game.selectedMapIdx = idx;
  game.tournament = null;
}

export function selectP2pMap({ mapIdx, mapSelection, mode } = {}) {
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
  if (selectedMap) uiRuntime.previewSelectedMapMusic(selectedMap);
  renderMapSelect();
  uiRuntime.renderAiModelSelector();
  updateDriveButtonLabel();
  uiRuntime.updateP2pBattleLobbyUi();
  Sound.tone(nextMode === "battle" ? 700 : 520, 0.08, "sine", 0.15);
}

export function applyLobbyMapSelection(data = {}) {
  if (data.mode !== undefined) game.mode = sanitizeP2pLobbyMode(data.mode);
  if (data.battleApprovals !== undefined) game.battleApprovals = clampApprovals(data.battleApprovals);
  if (data.battleUntimed !== undefined) game.battleUntimed = !!data.battleUntimed;
  if (data.mapIdx !== undefined) game.selectedMapIdx = data.mapIdx;
  if (data.mapSelection !== undefined) {
    game.mapSelection = data.mapSelection;
  } else if (data.mapIdx !== undefined) {
    syncMapSelectionFromIdx(data.mapIdx);
  }
  if (data.grandPrixRaces !== undefined && uiRuntime.setGrandPrixRaces) uiRuntime.setGrandPrixRaces(clampGrandPrixRaces(data.grandPrixRaces));
  ensureSelectedMapMatchesMode();
  if (isBattleMode()) game.tournament = null;
  if (game.state === STATE.SELECT || !isGrandPrixSelection()) game.tournament = null;
}

export function prepareRaceFormatFromSelection() {
  if (!isGrandPrixSelection()) {
    game.tournament = null;
    return;
  }
  if (!game.tournament || game.tournament.format !== "grand_prix") {
    game.tournament = createGrandPrixTournament(getGrandPrixRaces());
  }
  const order = game.tournament.circuitOrder || [];
  game.selectedMapIdx = order[game.tournament.raceIndex] ?? getDefaultCircuitMapIdx();
  game.mapSelection = GRAND_PRIX_ID;
}

export function getTournamentRaceMapIdx(tournament) {
  if (tournament?.format === "grand_prix" && Array.isArray(tournament.circuitOrder) && tournament.circuitOrder.length) {
    return tournament.circuitOrder[tournament.raceIndex] ?? tournament.circuitOrder[0];
  }
  return getNextCircuitMapIdx(game.selectedMapIdx || 0);
}

export function getRaceStartButtonLabel({ p2pHost = false, allReady = true, readyCount = 0, totalPlayers = 0 } = {}) {
  if (p2pHost) {
    if (!allReady) return `Waiting (${readyCount}/${totalPlayers})`;
    if (isBattleMode()) return "Start Online Battle";
    return isGrandPrixSelection() ? "Start Grand Prix" : "Start Online Race";
  }
  if (isBattleMode()) return "Battle!";
  return isGrandPrixSelection() ? "Start Grand Prix" : "Drive!";
}

export function getCharAvatarSVG(char) {
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

export function getUltimateInfo(charId) {
  return ULTIMATE_INFO[charId] || {
    name: "Ultimate",
    desc: "Charge with citations, then unleash a special ability.",
    icon: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.7 5.6 6.2.9-4.5 4.4 1.1 6.1L12 17l-5.5 3 1.1-6.1-4.5-4.4 6.2-.9L12 3z" fill="${c}"/></svg>`
  };
}

export function renderSelectScreen() {
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
      if (game.p2pMode) uiRuntime.setLocalP2pCharacterIdx(idx);
      uiRuntime.updateSelectionHighlight();
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
export function updateDriveButtonLabel() {
  if (!driveBtn || game.state !== STATE.SELECT) return;
  if (game.p2pMode && game.p2pRole !== "host") {
    driveBtn.style.display = "none";
    return;
  }
  if (game.p2pMode && game.p2pRole === "host") {
    uiRuntime.updateP2pStartButton();
    return;
  }
  driveBtn.textContent = getRaceStartButtonLabel();
}



export function showSelectScreen() {
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
  uiRuntime.hideAll();
  screens.show("select");
  game.state = STATE.SELECT;
  game.selectedCharIdx = game.selectedCharIdx || 0;

  if (game.multiplayer) {
    if (aiSelectSection) aiSelectSection.style.display = "none";
    if (game.p2pMode) uiRuntime.syncP2pSelectionFromRoster();
    game.selectedCharIdx2 = game.selectedCharIdx2 !== undefined ? game.selectedCharIdx2 : 1;
    if (!game.p2pMode) {
      game.p1Locked = false;
      game.p2Locked = false;
    }
    document.getElementById("status-p1").style.display = "block";
    document.getElementById("status-p1").innerText = game.p2pMode && game.p1Locked ? "You: READY!" : (game.p2pMode ? "You: Selecting" : "P1: Selecting");
    document.getElementById("status-p1").className = "p1-status selecting";
    document.getElementById("status-p2").style.display = "block";
    document.getElementById("status-p2").innerText = game.p2pMode ? `Online: ${uiRuntime.getP2pReadyCount ? uiRuntime.getP2pReadyCount() : 0}/${(game.p2pPlayers || []).length} Ready` : "P2: Selecting";
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
    uiRuntime.updateP2pBattleLobbyUi();
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
  uiRuntime.updateSelectionHighlight();
  renderMapSelect();
  if (!game.multiplayer) uiRuntime.refreshAiModelSelector();
  uiRuntime.updateP2pStartButton();
}
export function renderApprovalsSelect() {
  document.querySelectorAll("#approvals-group [data-approvals]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.approvals) === game.battleApprovals);
  });
  document.querySelectorAll("#battle-timing-group [data-battle-timed]").forEach((b) => {
    const timed = b.dataset.battleTimed === "1";
    b.classList.toggle("active", timed ? !game.battleUntimed : !!game.battleUntimed);
  });
}

export function getMapPreviewSvg(map) {
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

export function getGrandPrixPreviewSvg() {
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

export function buildMapCard({
  classes = "map-card",
  preview = "",
  title,
  chipsHtml,
  desc,
  stat,
  badge = "",
  selected = false,
  disabled = false,
  onSelect,
} = {}) {
  const card = document.createElement("div");
  card.className = classes + (selected ? " selected" : "");
  if (disabled) card.classList.add("disabled");

  card.innerHTML = `
    ${badge}
    <div class="map-preview">${preview}</div>
    <div class="map-name">${title}</div>
    <div class="map-feature-chips">${chipsHtml}</div>
    <div class="map-desc">${desc}</div>
    <div class="map-stat">${stat}</div>
  `;

  if (!disabled && onSelect) {
    card.addEventListener("click", () => {
      if (game.p1Locked) return;
      onSelect();
    });
  }
  return card;
}

export function buildGrandPrixMapCard({ disabled = false, onSelect } = {}) {
  let hostLabelHTML = "";
  if (game.p2pMode && isGrandPrixSelection()) {
    hostLabelHTML = `<span class="host-badge">${game.p2pRole === "host" ? "Host Pick" : "Host Choice"}</span>`;
  }

  const chipsHtml = [
    `<span class="feature-chip accent">CHAMPIONSHIP</span>`,
    `<span class="feature-chip">${getGrandPrixRaces()} RACES</span>`,
    `<span class="feature-chip success">GP POINTS</span>`,
  ].join("");

  return buildMapCard({
    classes: "map-card grand-prix-card",
    preview: getGrandPrixPreviewSvg(),
    title: "Grand Prix",
    chipsHtml,
    desc: "Rotates through every circuit map in order. Points stack across races — highest total wins the championship.",
    stat: `CIRCUITS: ${getGrandPrixCircuitIndices().length} · FORMAT: ${getGrandPrixRaces()}-RACE SERIES`,
    badge: hostLabelHTML,
    selected: isGrandPrixSelection(),
    disabled,
    onSelect,
  });
}

export function buildCircuitMapCard(map, idx, { disabled = false, onSelect, targetMode = null } = {}) {
  const selectionMode = targetMode || (map.arena ? "battle" : "race");
  const isSelected = selectionMode === "battle"
    ? (isBattleMode() && idx === (game.selectedMapIdx || 0))
    : (!isGrandPrixSelection() && !isBattleMode() && idx === (game.selectedMapIdx || 0));

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

  return buildMapCard({
    classes: "map-card",
    preview: getMapPreviewSvg(map),
    title: map.name,
    chipsHtml,
    desc: map.desc,
    stat: statLabel,
    badge: hostLabelHTML,
    selected: isSelected,
    disabled,
    onSelect: onSelect ? () => onSelect(map, idx) : undefined,
  });
}

export function renderP2pDualMapSelect(container) {
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
  uiRuntime.updateP2pBattleLobbyUi();
}

export function renderMapSelect() {
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
        if (firstMap) uiRuntime.previewSelectedMapMusic(firstMap);
        renderMapSelect();
        uiRuntime.renderAiModelSelector();
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
        uiRuntime.previewSelectedMapMusic(m);
        renderMapSelect();
        uiRuntime.renderAiModelSelector();
        updateDriveButtonLabel();
        Sound.tone(520, 0.08, "sine", 0.15);
      },
    }));
  });
}
export function clampApprovals(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.max(3, Math.min(5, n));
}

export function renderRaceSetupSettings() {
  document.querySelectorAll("#laps-group [data-laps]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.laps) === getTotalLaps());
  });
  document.querySelectorAll("#series-group [data-gp-races]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.gpRaces) === getGrandPrixRaces());
  });
  document.querySelectorAll("#aicount-group [data-aicount]").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.aicount) === (uiRuntime.getAiCount ? uiRuntime.getAiCount() : 4));
  });
  document.querySelectorAll("#aidiff-group [data-aidiff]").forEach((b) => {
    b.classList.toggle("active", b.dataset.aidiff === (uiRuntime.getAiDifficulty ? uiRuntime.getAiDifficulty() : "normal"));
  });
}
