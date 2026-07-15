import { TUNING } from "../config/tuning.js";
import { CHARACTERS } from "../config/characters.js";
import { MAPS, GRAND_PRIX_ID, regenerateDragonTrail } from "../config/maps.js";
import { clamp, dist } from "../core/math.js";
import { screens } from "../ui/screens.js";
import { bus } from "../core/events.js";
import {
  STATE,
  game,
  isBattleMode,
  getKartById,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { serializeKart, applyKartSync } from "../net/sync-schema.js";
import {
  MergeConflict,
  PlaceboPill,
  DoubleBlindCloud,
  RegulatoryProjectile,
  DossierProjectile,
  DragonFire,
} from "../entities/items.js";
import { netRuntime } from "./net-runtime.js";

export let peer = null;
export const p2pConnections = new Map();

export function setPeer(p) {
  peer = p;
}

export function addP2pGuest(conn) {
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
  netRuntime.renderP2pLobby();
  return player;
}

export function removeP2pGuestByConn(conn) {
  const removedId = getP2pIdForConn(conn);
  if (!removedId) return;
  p2pConnections.delete(removedId);
  handleP2pPlayerRemoved(removedId);
}

export function markP2pKartDisconnected(playerId) {
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
  netRuntime.triggerHitFlash("PLAYER LEFT", "#ff4d6d", 90, kart);
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

export function handleP2pPlayerRemoved(playerId) {
  const midRace = [STATE.COUNTDOWN, STATE.RACING, STATE.PAUSED].includes(game.state);
  if (midRace) {
    markP2pKartDisconnected(playerId);
    const p = game.p2pPlayers.find((row) => row.id === playerId);
    if (p) p.disconnected = true;
  } else {
    game.p2pPlayers = game.p2pPlayers.filter((p) => p.id !== playerId);
    if (game.state === STATE.SELECT) {
      netRuntime.syncP2pSelectionFromRoster({ preserveLocal: true });
      netRuntime.updateSelectionHighlight();
      netRuntime.updateP2pStartButton();
    }
  }
  netRuntime.renderP2pLobby();
  if (!midRace) broadcastP2pLobby();
}

export function p2pReturnToLobbyLocal(lobbyData = null) {
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  game.hazards = [];
  game.p2pBattleEndPending = false;
  game.tournament = null;
  game._pauseFromState = null;
  game.p2pConnectionUnstable = false;
  screens.hide("pause");
  if (lobbyData) {
    if (lobbyData.players) game.p2pPlayers = lobbyData.players;
    netRuntime.applyLobbyMapSelection(lobbyData);
    if (lobbyData.trackIdx !== undefined && lobbyData.trackIdx !== null) netRuntime.setMusicTrack(lobbyData.trackIdx);
  }
  if (game.p2pRole === "host") {
    game.p2pPlayers = (game.p2pPlayers || []).filter((p) => !p.disconnected);
  }
  resetP2pReadyForLobbyChange();
  netRuntime.hideAll();
  netRuntime.showSelectScreen();
}

export function p2pHostCancelRaceToLobby() {
  if (!game.p2pMode || game.p2pRole !== "host") return;
  resetP2pReadyForLobbyChange();
  broadcastP2pMessage({
    type: "return_lobby",
    players: game.p2pPlayers.filter((p) => !p.disconnected),
    ...getP2pLobbyMapPayload(),
  });
  p2pReturnToLobbyLocal();
}

export function p2pGuestLeaveMatch() {
  if (!game.p2pMode || game.p2pRole !== "guest") return;
  Sound.stopAllEngines();
  Sound.stopAllDriftSqueals();
  Sound.stopAllRumbles();
  screens.hide("pause");
  handleP2pDisconnect({ silent: true });
}

export function getP2pIdForConn(conn) {
  for (const [id, existing] of p2pConnections.entries()) {
    if (existing === conn) return id;
  }
  return null;
}

export function isHighFrequencyP2pMessage(data) {
  return data && (data.type === "host_sync" || data.type === "guest_sync");
}

export function sendToConn(conn, data) {
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

export function broadcastP2pMessage(data, exceptConn = null) {
  for (const conn of p2pConnections.values()) {
    if (conn !== exceptConn) sendToConn(conn, data);
  }
}

export function broadcastP2pLobby() {
  if (game.p2pRole !== "host") return;
  broadcastP2pMessage({
    type: "lobby_state",
    players: game.p2pPlayers,
    ...getP2pLobbyMapPayload(),
  });
  netRuntime.renderP2pLobby();
}

export function resetP2pReadyForLobbyChange() {
  if (!game.p2pMode) return;
  for (const p of (game.p2pPlayers || [])) p.locked = false;
  game.p1Locked = false;
  game.p2Locked = false;
  netRuntime.syncP2pSelectionFromRoster({ preserveLocal: true });
  if (game.p2pRole === "host") broadcastP2pLobby();
  netRuntime.updateSelectionHighlight();
  netRuntime.updateP2pStartButton();
}

export function getP2pLobbyMapPayload() {
  return {
    mode: isBattleMode() ? "battle" : "race",
    battleApprovals: netRuntime.clampApprovals(game.battleApprovals),
    battleUntimed: !!game.battleUntimed,
    mapIdx: game.selectedMapIdx,
    mapSelection: game.mapSelection,
    grandPrixRaces: netRuntime.grandPrixRaces,
    trackIdx: Sound.trackIdx,
  };
}

export function loadPeerJS(callback) {
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

export function generateLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function getKartId(kart) {
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

export function sendP2pMessage(data) {
  if (game.p2pRole === "host") {
    broadcastP2pMessage(data);
    return;
  }
  if (game.p2pConn && game.p2pConn.open) {
    sendToConn(game.p2pConn, data);
  }
}

export function serializeKartState(kart) {
  return serializeKart(kart, { battle: isBattleMode(), getKartId }, { compact: false });
}

export function applyKartState(kart, p, opts = {}) {
  applyKartSync(kart, p, {
    ...opts,
    velocityLead: TUNING.P2P_REMOTE_VELOCITY_LEAD,
    snapDist: TUNING.P2P_REMOTE_SNAP_DIST,
    interp: TUNING.P2P_REMOTE_INTERP,
    resolveKartById: getKartById,
  });
}

export function applyLocalAuthoritativeEffects(kart, p) {
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
    netRuntime.triggerHitFlash("BLACK ICE!", "#57f2ff", 75, kart);
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

export function serializeDragonState(dragon) {
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

export function applyDragonState(state) {
  const dragon = game.track && game.track.regulatoryDragon;
  applyDragonObjectState(dragon, state);
}

export function applyDragonEscapeState(state) {
  if (!state) return;
  if (!game.dragonEscape) game.dragonEscape = netRuntime.createDragonEscapeEntity();
  applyDragonObjectState(game.dragonEscape, state);
}

export function applyBattleCompactFields(kart, p) {
  if (!kart || !p) return;
  if (p.ap !== undefined) kart.approvals = p.ap;
  if (p.bs !== undefined) kart.battleSteals = p.bs;
  if (p.rg !== undefined) kart.recoverGraceTimer = p.rg;
  if (p.kb !== undefined) kart.killedBy = p.kb ? getKartById(p.kb) : null;
}

export function sendP2pBattleEnd() {
  if (!game.p2pMode || game.p2pRole !== "host" || !isBattleMode()) return;
  const ranking = game.finalRanking || [];
  sendP2pMessage({
    type: "battle_end",
    raceTime: game.raceTime,
    ranking: ranking.map((k) => getKartId(k)).filter(Boolean),
    karts: ranking.map((k) => ({ id: getKartId(k), s: serializeKartCompact(k) })).filter((row) => row.id),
  });
}

export function applyP2pBattleEnd(data) {
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
  screens.hide("pause");
  game.state = STATE.FINISHED;
  netRuntime.showFinishScreen();
  bus.emit("race:finished", {});
}

export function applyDragonObjectState(dragon, state) {
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

export function serializeKartCompact(k) {
  return serializeKart(k, { battle: isBattleMode(), getKartId }, { compact: true });
}

export function serializeHazardCompact(h) {
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

export function sendHostSync() {
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

export function sendGuestSync() {
  if (!game.player) return;
  sendP2pMessage({
    type: "guest_sync",
    playerId: game.p2pLocalId || "guest",
    state: serializeKartState(game.player),
    p2: serializeKartCompact(game.player),
  });
}

export function handleP2pDisconnect({ silent = false } = {}) {
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

  if (netRuntime.resetP2pLobbyDom) netRuntime.resetP2pLobbyDom();

  if (game.state === STATE.RACING || game.state === STATE.COUNTDOWN || game.state === STATE.PAUSED || battleEndPending) {
    Sound.stopAllEngines();
    Sound.stopAllDriftSqueals();
    Sound.stopAllRumbles();
    game.state = STATE.TITLE;
    netRuntime.hideAll();
    screens.show("title");
    if (!silent) alert("Peer disconnected! Returning to menu.");
  }
}

export function applyP2pPickupRequest(data, sourceConn = null) {
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

export function applyP2pPickupState(data) {
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

function handleP2pPing(data, sourceConn = null) {
  const reply = { type: "pong", t: data.t };
  if (sourceConn) sendToConn(sourceConn, reply);
  else sendP2pMessage(reply);
  return;
}

function handleP2pPong(data, sourceConn = null) {
  game.p2pPing = Math.round(performance.now() - data.t);
  return;
}

function handleP2pLobbyConnected(data, sourceConn = null) {
  game.p2pMode = true;
  game.p2pRole = "guest";
  game.multiplayer = true;
  game.p2pLocalId = data.playerId || "guest_1";
  game.p2pPlayers = data.players || [];
  netRuntime.applyLobbyMapSelection(data);
  if (data.trackIdx !== undefined && data.trackIdx !== null) netRuntime.setMusicTrack(data.trackIdx);
  netRuntime.renderP2pLobby();
  netRuntime.p2pJoinStatus.innerText = "Connected! Waiting for host to start...";
  netRuntime.p2pJoinStatus.className = "p2p-status ready";
  netRuntime.enterP2pSelectScreen();
}

function handleP2pLobbyFull(data, sourceConn = null) {
  netRuntime.p2pJoinStatus.innerText = "Lobby is full!";
  netRuntime.p2pJoinStatus.className = "p2p-status error";
}

function handleP2pLobbyState(data, sourceConn = null) {
  game.p2pPlayers = data.players || game.p2pPlayers;
  netRuntime.applyLobbyMapSelection(data);
  if (data.trackIdx !== undefined && data.trackIdx !== null) netRuntime.setMusicTrack(data.trackIdx);
  netRuntime.syncP2pSelectionFromRoster();
  netRuntime.renderP2pLobby();
  if (game.state === STATE.SELECT) {
    netRuntime.updateSelectionHighlight();
    netRuntime.updateP2pStartButton();
    netRuntime.renderMapSelect();
    netRuntime.renderApprovalsSelect();
    netRuntime.updateP2pBattleLobbyUi();
  }
}

function handleP2pLobbyCharUpdate(data, sourceConn = null) {
  if (game.p2pRole !== "host") return;
  const sourceId = getP2pIdForConn(sourceConn);
  const playerId = sourceId || data.playerId;
  const player = game.p2pPlayers.find(p => p.id === playerId);
  if (!player) return;
  player.charIdx = Math.round(clamp(Number(data.charIdx), 0, CHARACTERS.length - 1));
  player.locked = !!data.locked;
  broadcastP2pLobby();
  if (game.state === STATE.SELECT) {
    netRuntime.syncP2pSelectionFromRoster({ preserveLocal: true });
    netRuntime.updateSelectionHighlight();
    netRuntime.updateP2pStartButton();
    netRuntime.checkMultiplayerSelectFinish();
  }
}

function handleP2pSelectUpdate(data, sourceConn = null) {
  const sourceId = getP2pIdForConn(sourceConn);
  const playerId = sourceId || data.playerId || (game.p2pRole === "guest" ? "host" : "guest_1");
  const player = game.p2pPlayers && game.p2pPlayers.find(p => p.id === playerId);
  if (player) {
    player.charIdx = Math.round(clamp(Number(data.charIdx), 0, CHARACTERS.length - 1));
    player.locked = !!data.locked;
  }
  netRuntime.syncP2pSelectionFromRoster({ preserveLocal: true });
  netRuntime.updateSelectionHighlight();
  netRuntime.updateP2pStartButton();
  netRuntime.renderP2pLobby();
  if (game.p2pRole === "host") {
    broadcastP2pMessage({ ...data, playerId }, sourceConn);
  }
  netRuntime.checkMultiplayerSelectFinish();
}

function handleP2pMapUpdate(data, sourceConn = null) {
  netRuntime.applyLobbyMapSelection(data);
  const selectedMap = MAPS[game.selectedMapIdx || 0];
  if (selectedMap) netRuntime.previewSelectedMapMusic(selectedMap);
  netRuntime.renderMapSelect();
  netRuntime.renderApprovalsSelect();
  netRuntime.updateP2pBattleLobbyUi();
  netRuntime.updateDriveButtonLabel();
}

function handleP2pReturnLobby(data, sourceConn = null) {
  p2pReturnToLobbyLocal(data);
}

function handleP2pBattleEnd(data, sourceConn = null) {
  game.p2pLastHostSyncReceivedAt = performance.now();
  applyP2pBattleEnd(data);
}

function handleP2pMergeRequest(data, sourceConn = null) {
  if (game.p2pRole !== "host" || !isBattleMode()) return;
  const requesterId = getP2pIdForConn(sourceConn) || data.kartId;
  const kart = getKartById(requesterId);
  if (!kart || kart.eliminated || kart.finished) return;
  const now = performance.now();
  if ((kart.mergePullTimer || 0) > 0 || now - (kart._lastMergeRequestRpcAt || -Infinity) < 2500) return;
  kart._lastMergeRequestRpcAt = now;
  netRuntime.startMergeRequestPull(kart);
}

function handleP2pStartRace(data, sourceConn = null) {
  netRuntime.applyLobbyMapSelection(data);
  if (data.players) game.p2pPlayers = data.players;
  if (data.trackIdx !== undefined && data.trackIdx !== null) netRuntime.setMusicTrack(data.trackIdx);
  if (!data.players) {
    game.selectedCharIdx = data.guestCharIdx;
    game.selectedCharIdx2 = data.hostCharIdx;
  }
  game.tournament = data.tournament || null;
  if (game.tournament?.format === "grand_prix") {
    game.mapSelection = GRAND_PRIX_ID;
  }
  netRuntime.ensureSelectedMapMatchesMode();
  game.p2pBattleEndPending = false;
  if (game.p2pRole === "guest") {
    game.p2pLastHostSyncReceivedAt = performance.now();
  }

  // Sync dragon trail from host seed so all clients have the same map
  if (data.dragonSeed !== undefined && MAPS[game.selectedMapIdx].id === "dragon_escape") {
    regenerateDragonTrail(data.dragonSeed);
  }

  Sound.stopTitleTheme();
  netRuntime.hideAll();
  netRuntime.buildRace();
  netRuntime.startCountdown();
  Sound.startEngine(1);
}

function handleP2pTournamentStandings(data, sourceConn = null) {
  game.tournament = data.tournament;
  if (screens.isVisible("finish")) {
    netRuntime.showFinishScreen();
  }
}

function handleP2pHostSync(data, sourceConn = null) {
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
        screens.hide("pause");
        game.state = STATE.FINISHED;
        if (game.p2pMode && isBattleMode() && game.p2pRole === "guest") {
          game.p2pBattleEndPending = true;
        } else {
          netRuntime.showFinishScreen();
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

function handleP2pPickupRequest(data, sourceConn = null) {
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

function handleP2pPickupConfirm(data, sourceConn = null) {
  applyP2pPickupState(data);
}

function handleP2pGuestSync(data, sourceConn = null) {
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

function handleP2pShootDossier(data, sourceConn = null) {
  const ownerKart = getKartById(data.kartId) || game.player2;
  if (ownerKart) {
    const d = new DossierProjectile(data.x, data.y, data.heading, ownerKart);
    game.hazards.push(d);
  }
}

function handleP2pDropConflict(data, sourceConn = null) {
  if (game.p2pMode && game.p2pRole === "host" && game.player2) {
    const h = new MergeConflict(data.x, data.y, getKartById(data.kartId));
    game.hazards.push(h);
  }
}

function handleP2pDropPlacebo(data, sourceConn = null) {
  if (game.p2pMode && game.p2pRole === "host") {
    game.hazards.push(new PlaceboPill(data.x, data.y, getKartById(data.kartId)));
  }
}

function handleP2pDoubleBlindCloud(data, sourceConn = null) {
  if (game.p2pMode && game.p2pRole === "host") {
    game.hazards.push(new DoubleBlindCloud(data.x, data.y, data.heading, getKartById(data.kartId)));
  }
}

function handleP2pDeauthShockwave(data, sourceConn = null) {
  if (game.p2pMode && game.p2pRole === "host") {
    const kart = getKartById(data.kartId);
    if (kart) netRuntime.applyDeauthShockwave(kart);
  }
}

function handleP2pActionEvent(data, sourceConn = null) {
  const kart = getKartById(data.kartId);
  if (kart) {
    netRuntime.triggerShootEffect(kart, data.item);
  }
  if (game.p2pRole === "host") {
    broadcastP2pMessage(data, sourceConn);
  }
}

function handleP2pPlayerLeft(data, sourceConn = null) {
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

function handleP2pHazardCollision(data, sourceConn = null) {
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

const P2P_HANDLERS = {
  ping: handleP2pPing,
  pong: handleP2pPong,
  lobby_connected: handleP2pLobbyConnected,
  lobby_full: handleP2pLobbyFull,
  lobby_state: handleP2pLobbyState,
  lobby_char_update: handleP2pLobbyCharUpdate,
  select_update: handleP2pSelectUpdate,
  map_update: handleP2pMapUpdate,
  return_lobby: handleP2pReturnLobby,
  battle_end: handleP2pBattleEnd,
  merge_request: handleP2pMergeRequest,
  start_race: handleP2pStartRace,
  tournament_standings: handleP2pTournamentStandings,
  host_sync: handleP2pHostSync,
  pickup_request: handleP2pPickupRequest,
  pickup_confirm: handleP2pPickupConfirm,
  guest_sync: handleP2pGuestSync,
  shoot_dossier: handleP2pShootDossier,
  drop_conflict: handleP2pDropConflict,
  drop_placebo: handleP2pDropPlacebo,
  double_blind_cloud: handleP2pDoubleBlindCloud,
  deauth_shockwave: handleP2pDeauthShockwave,
  action_event: handleP2pActionEvent,
  player_left: handleP2pPlayerLeft,
  hazard_collision: handleP2pHazardCollision,
};

export function handleP2pData(data, sourceConn = null) {
  if (!data) return;
  const handler = P2P_HANDLERS[data.type];
  if (handler) handler(data, sourceConn);
}
