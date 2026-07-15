import { MAPS, GRAND_PRIX_ID } from "../config/maps.js";

export const STATE = {
  TITLE: "title",
  SELECT: "select",
  COUNTDOWN: "countdown",
  RACING: "racing",
  PAUSED: "paused",
  FINISHED: "finished",
};

export const game = {
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
  particles: null,
  skidMarks: [],
  startTime: 0,
  raceTime: 0,
  countdownStart: 0,
  countdownText: "",
  rocketStartP1: { holdStart: 0, holding: false, result: null },
  rocketStartP2: { holdStart: 0, holding: false, result: null },
  viewMode: "2d",
  timeOfDay: "day",
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
  battleUntimed: false,
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

let savedSettingsTimeOfDay;

export function applySavedSettingsBoot(savedSettings) {
  game.viewMode = savedSettings.viewMode === "3d" ? "3d" : "2d";
  game.timeOfDay = normalizeTimeOfDay(savedSettings.timeOfDay);
  game.battleUntimed = !!savedSettings.battleUntimed;
  savedSettingsTimeOfDay = savedSettings.timeOfDay;
}

export function normalizeTimeOfDay(v) {
  return v === "night" ? "night" : "day";
}

export function isBattleMode() {
  return game.mode === "battle";
}

export function isDayMode() {
  return normalizeTimeOfDay(game?.timeOfDay ?? savedSettingsTimeOfDay) === "day";
}

export function isGrandPrixSelection() {
  return game.mapSelection === GRAND_PRIX_ID;
}

export function isGrandPrixActive(t = game.tournament) {
  return !!(t && t.format === "grand_prix" && t.totalRaces > 1);
}

export function shouldShowGrandPrixCard() {
  return !isBattleMode() && (!game.multiplayer || game.p2pMode);
}

export function isP2pBattleGuest() {
  return !!(game.p2pMode && isBattleMode() && game.p2pRole === "guest");
}

export function isP2pBattleHost() {
  return !!(game.p2pMode && isBattleMode() && game.p2pRole === "host");
}

export function canResolveBattleCombat() {
  return !isP2pBattleGuest();
}

export function getActiveKarts() {
  return [
    game.player,
    ...(game.multiplayer && game.player2 ? [game.player2] : []),
    ...(game.remotePlayers || []),
    ...game.ais
  ].filter(Boolean);
}

export function getKartById(id) {
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
