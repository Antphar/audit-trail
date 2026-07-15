import { CHARACTERS } from "../config/characters.js";
import { clamp } from "../core/math.js";
import { MAPS, regenerateDragonTrail } from "../config/maps.js";
import { STATE, game, isBattleMode, isGrandPrixSelection } from "../core/state.js";
import { Sound } from "../audio/sound.js";
import {
  sendP2pMessage, loadPeerJS, generateLobbyCode, addP2pGuest, removeP2pGuestByConn,
  broadcastP2pLobby, handleP2pData, handleP2pDisconnect, getP2pLobbyMapPayload, peer, setPeer,
  sendToConn, p2pHostCancelRaceToLobby, p2pGuestLeaveMatch,
} from "../net/p2p.js";
import { uiRuntime } from "./ui-runtime.js";
import { getRaceStartButtonLabel } from "./select.js";

const p2pHostStatus = document.getElementById("p2p-host-status");
const p2pCodeBox = document.getElementById("p2p-code-box");
const p2pMyCode = document.getElementById("p2p-my-code");
const p2pHostRoster = document.getElementById("p2p-host-roster");
const p2pJoinRoster = document.getElementById("p2p-join-roster");
const p2pStartRaceBtn = document.getElementById("p2p-start-race-btn");
const p2pJoinInput = document.getElementById("p2p-join-input");
const p2pJoinBtn = document.getElementById("p2p-join-btn");
const p2pJoinStatus = document.getElementById("p2p-join-status");
const p2pHostBtn = document.getElementById("p2p-host-btn");
const p2pBackBtn = document.getElementById("p2p-back-btn");
const driveBtn = document.getElementById("drive-btn");
const startP2pBtn = document.getElementById("start-p2p-btn");

let p2pJoinAttemptSeq = 0;
function isArenaMap(mapOrIdx) {
  const m = typeof mapOrIdx === "number" ? MAPS[mapOrIdx] : mapOrIdx;
  return !!(m && m.arena);
}



const pauseP2pSubtitle = document.getElementById("pause-p2p-subtitle");
const pauseDefaultSubtitle = document.getElementById("pause-default-subtitle");
const p2pCancelLobbyBtn = document.getElementById("p2p-cancel-lobby-btn");
const p2pLeaveMatchBtn = document.getElementById("p2p-leave-match-btn");

export function updatePauseScreenUi() {
  const isP2pPaused = game.p2pMode && game.state === STATE.PAUSED;
  if (pauseP2pSubtitle) pauseP2pSubtitle.style.display = isP2pPaused ? "block" : "none";
  if (pauseDefaultSubtitle) pauseDefaultSubtitle.style.display = isP2pPaused ? "none" : "block";
  if (p2pCancelLobbyBtn) p2pCancelLobbyBtn.style.display = (isP2pPaused && game.p2pRole === "host") ? "inline-block" : "none";
  if (p2pLeaveMatchBtn) p2pLeaveMatchBtn.style.display = (isP2pPaused && game.p2pRole === "guest") ? "inline-block" : "none";
}

export function resetP2pLobbyDom() {
  if (p2pHostStatus) { p2pHostStatus.innerText = "Click Create Lobby to generate a code"; p2pHostStatus.className = "p2p-status"; }
  if (p2pCodeBox) p2pCodeBox.style.display = "none";
  if (p2pMyCode) p2pMyCode.innerText = "------";
  if (p2pHostRoster) p2pHostRoster.innerHTML = "";
  if (p2pJoinRoster) p2pJoinRoster.innerHTML = "";
  if (p2pStartRaceBtn) p2pStartRaceBtn.style.display = "none";
  if (p2pJoinInput) p2pJoinInput.value = "";
  if (p2pJoinStatus) { p2pJoinStatus.innerText = "Enter code and click Join"; p2pJoinStatus.className = "p2p-status"; }
}

export function getLocalP2pPlayer() {
  if (!game.p2pMode || !game.p2pPlayers) return null;
  return game.p2pPlayers.find(p => p.id === game.p2pLocalId) || null;
}

export function setLocalP2pCharacterIdx(idx) {
  const safeIdx = Math.round(clamp(Number(idx), 0, CHARACTERS.length - 1));
  game.selectedCharIdx = safeIdx;
  const local = getLocalP2pPlayer();
  if (local) local.charIdx = safeIdx;
}

export function setLocalP2pLocked(locked) {
  const local = getLocalP2pPlayer();
  if (local) local.locked = !!locked;
  game.p1Locked = !!locked;
}

export function getP2pReadyCount() {
  return (game.p2pPlayers || []).filter(p => p.locked).length;
}

export function areAllP2pPlayersReady() {
  const players = game.p2pPlayers || [];
  return players.length >= 2 && players.every(p => p.locked);
}

export function updateP2pStartButton() {
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
export function startP2pRaceFromSelection() {
  if (!game.p2pMode || game.p2pRole !== "host") return;
  const fromFinish = game.state === STATE.FINISHED;
  if (!fromFinish && !areAllP2pPlayersReady()) return;
  uiRuntime.prepareRaceFormatFromSelection();
  // Regenerate dragon trail with current seed so host has fresh deterministic trail
  let dragonSeed = null;
  if (MAPS[game.selectedMapIdx || 0].id === "dragon_escape") {
    dragonSeed = Math.floor(Math.random() * 2147483647);
    regenerateDragonTrail(dragonSeed);
  }
  Sound.stopTitleTheme();
  uiRuntime.hideAll();
  uiRuntime.buildRace();
  uiRuntime.startCountdown();
  Sound.startEngine(1);
  sendP2pMessage({
    type: "start_race",
    mode: isBattleMode() ? "battle" : "race",
    battleApprovals: uiRuntime.clampApprovals(game.battleApprovals),
    battleUntimed: !!game.battleUntimed,
    players: game.p2pPlayers,
    mapIdx: game.selectedMapIdx,
    mapSelection: game.mapSelection,
    grandPrixRaces: uiRuntime.getGrandPrixRaces(),
    trackIdx: Sound.trackIdx,
    dragonSeed,
    tournament: game.tournament
  });
}
export function syncP2pSelectionFromRoster({ preserveLocal = false } = {}) {
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

export function checkMultiplayerSelectFinish() {
  if (game.p2pMode) {
    updateP2pStartButton();
    return;
  }

  if (game.p1Locked && game.p2Locked) {
    setTimeout(() => {
      if (game.p1Locked && game.p2Locked) {
        Sound.stopTitleTheme();
        uiRuntime.hideAll();
        uiRuntime.buildRace();
        uiRuntime.startCountdown();
        Sound.startEngine(1);
        Sound.startEngine(2);
      }
    }, 450);
  }
}
export function updateSelectionHighlight() {
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
export function updateP2pBattleLobbyUi() {
  const battleSection = document.getElementById("battle-select-section");
  const showBattleRules = isBattleMode() || (game.p2pMode && isArenaMap(game.selectedMapIdx));
  if (battleSection) battleSection.style.display = showBattleRules ? "flex" : "none";
  if (showBattleRules) uiRuntime.renderApprovalsSelect();
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
export function enterP2pSelectScreen() {
  syncP2pSelectionFromRoster();
  uiRuntime.showSelectScreen();
  uiRuntime.renderMapSelect();
}
export function getP2pPlayerLabel(player, idx) {
  if (player.id === "host") return "Host";
  return "Player " + (idx + 1);
}

export function getP2pRosterHtml() {
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

export function renderP2pLobby() {
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

export function ensureHostP2pPlayer() {
  game.p2pLocalId = "host";
  game.p2pPlayers = [{
    id: "host",
    charIdx: game.selectedCharIdx || 0,
    locked: false,
    joinedAt: Date.now()
  }];
  renderP2pLobby();
}
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

export function getP2pConfiguredTurnIceServers() {
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

export function isP2pTurnIceServer(server) {
  if (!server || !server.urls) return false;
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some(url => typeof url === "string" && /^(turn|turns):/i.test(url));
}

export function hasP2pTurnFallback() {
  return getP2pConfiguredTurnIceServers().length > 0;
}

export function getP2pIceConfig(mode = "direct") {
  const iceServers = P2P_STUN_ICE_SERVERS.slice();
  if (mode === "relay") {
    iceServers.push(...getP2pConfiguredTurnIceServers());
  }
  return {
    iceServers,
    iceCandidatePoolSize: 10
  };
}

export function startP2pJoinAttempt(rawCode, mode = "direct") {
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
    setPeer(new Peer(undefined, { config: getP2pIceConfig(mode) }));

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


function wireP2pHostClick() {
  if (!p2pHostBtn) return;
  p2pHostBtn.addEventListener("click", () => {
    Sound.ensure(); Sound.resume();
    p2pHostStatus.innerText = "Loading network library...";
    p2pHostStatus.className = "p2p-status";

    loadPeerJS(() => {
      p2pHostStatus.innerText = "Connecting to matchmaking...";
      const code = generateLobbyCode();

      try {
        if (peer) {
          try { peer.destroy(); } catch (e) {}
        }
        setPeer(new Peer("TKD-" + code, { config: getP2pIceConfig("relay") }));

        const hostTimeout = setTimeout(() => {
          if (!game.p2pMode) {
            p2pHostStatus.innerText = "Connection timed out. Try again.";
            p2pHostStatus.className = "p2p-status error";
            try { peer.destroy(); } catch (e) {}
          }
        }, 15000);

        peer.on("open", () => {
          clearTimeout(hostTimeout);
          p2pHostStatus.innerText = "Lobby active. Waiting for players...";
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
          conn.on("data", (data) => handleP2pData(data, conn));
          conn.on("close", () => removeP2pGuestByConn(conn));
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
      } catch (e) {
        p2pHostStatus.innerText = "Failed to create: " + e.message;
        p2pHostStatus.className = "p2p-status error";
      }
    });
  });
}

export function initLobbyUi(deps = {}) {
  const showMainMenu = deps.showMainMenu || (() => {});
  wireP2pHostClick();
  if (startP2pBtn) {
    startP2pBtn.addEventListener("click", () => {
      Sound.ensure(); Sound.resume();
      Sound.stopTitleTheme(false);
      game.tournament = null;
      game.mode = "race";
      uiRuntime.hideAll();
      const { screens } = deps;
      if (screens) screens.show("p2p");
    });
  }
  if (p2pJoinBtn) {
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
      loadPeerJS(() => startP2pJoinAttempt(rawCode, "direct"));
    });
  }
  if (p2pBackBtn) {
    p2pBackBtn.addEventListener("click", () => {
      Sound.ensure(); Sound.resume();
      handleP2pDisconnect();
      showMainMenu();
    });
  }
  if (p2pStartRaceBtn) {
    p2pStartRaceBtn.addEventListener("click", () => {
      if (game.p2pRole !== "host" || game.p2pPlayers.length < 2) return;
      enterP2pSelectScreen();
      broadcastP2pLobby();
    });
  }
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
}
