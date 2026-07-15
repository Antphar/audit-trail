import { screens } from "./screens.js";
import { TUNING } from "../config/tuning.js";
import { CHARACTERS } from "../config/characters.js";
import { clamp } from "../core/math.js";
import { MAPS, GRAND_PRIX_ID } from "../config/maps.js";
import { getMapRecord } from "../core/settings.js";
import {
  STATE, game, normalizeTimeOfDay, isBattleMode, isDayMode, isGrandPrixActive, isGrandPrixSelection,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { handleP2pDisconnect } from "../net/p2p.js";
import { setViewMode, apply3DMapTheme } from "../render/three-scene.js";
import { THREE_STATE, loadThreeJS } from "../render/three-state.js";
import { rebuild3DTrack } from "../render/three-track.js";
import { renderRuntime } from "../render/render-runtime.js";
import { uiRuntime } from "./ui-runtime.js";
import { formatTime, ordinal } from "../render/hud.js";

const titleScreen = document.getElementById("title-screen");
const finishResults = document.getElementById("finish-results");
const finishTitle = document.getElementById("finish-title");
const settingsBtn = document.getElementById("settings-btn");
const settingsBackBtn = document.getElementById("settings-back-btn");
const musicVolumeInput = document.getElementById("music-volume-input");
const musicVolumeValue = document.getElementById("music-volume-value");
const sfxVolumeInput = document.getElementById("sfx-volume-input");
const sfxVolumeValue = document.getElementById("sfx-volume-value");
const view2dBtn = document.getElementById("view-2d-btn");
const view3dBtn = document.getElementById("view-3d-btn");
const timeDayBtn = document.getElementById("time-day-btn");
const timeNightBtn = document.getElementById("time-night-btn");
const promptlyTitleBubble = document.getElementById("promptly-title-bubble");
const promptlyTitleImg = document.getElementById("promptly-title-img");
const restartBtn = document.getElementById("restart-btn");
const nextTrackBtn = document.getElementById("next-track-btn");

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
  "Fast Track through the field — comebacks are always in scope.",
];
let promptlyTipIdx = 0;

function getTotalLaps() { return uiRuntime.getTotalLaps ? uiRuntime.getTotalLaps() : 3; }

export function getPromptlyStandingsComment(standings, isFinal) {
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

export function buildTournamentStandingsHtml() {
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
export function showFinishScreen() {
  const ranking = game.finalRanking || uiRuntime.rankAll();

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
        html += `<div style="width:36px;height:36px;border-radius:50%;background:${charDef.gradient};display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${charDef.colorGlow};margin-bottom:4px;">${uiRuntime.getCharAvatarSVG({...charDef, color: "#050510"}).replace(/width="48"/g,'width="28"').replace(/height="48"/g,'height="28"')}</div>`;
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
      html += `<div class="row"><span class="label">Laps Completed</span><span class="value">${game.player.lap} / ${getTotalLaps()}</span></div>`;

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

  screens.show("finish");
}

export function hideAll() {
  screens.hideAll();
}

export function showMainMenu() {
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
  screens.show("title");
  if (Sound.ctx) Sound.playVocoderTitle();
}

export function renderAudioSettings() {
  if (musicVolumeInput) musicVolumeInput.value = String(Math.round(Sound.musicVolume * 100));
  if (musicVolumeValue) musicVolumeValue.textContent = `${Math.round(Sound.musicVolume * 100)}%`;
  if (sfxVolumeInput) sfxVolumeInput.value = String(Math.round(Sound.sfxVolume * 100));
  if (sfxVolumeValue) sfxVolumeValue.textContent = `${Math.round(Sound.sfxVolume * 100)}%`;
}

export function setMusicTrack(idx) {
  const safeIdx = Math.floor(clamp(idx, 0, Sound.tracks.length - 1));
  if (Sound.isPlayingMusic) {
    Sound.switchTrack(safeIdx);
  } else {
    Sound.trackIdx = safeIdx;
    const track = Sound.tracks[safeIdx];
    Sound.tempo = track.tempo;
    if (game.player && game.player.lap >= getTotalLaps() - 1) {
      Sound.tempo = track.tempo + TUNING.FINAL_LAP_TEMPO_BOOST;
    }
    uiRuntime.saveGameSettings({ musicTrack: safeIdx });
  }
  if (Sound.isPlayingMusic) {
    Sound.showTrackToast();
  }
}

export function previewSelectedMapMusic(map) {
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

export function showSettingsScreen() {
  Sound.stopTitleTheme(false);
  hideAll();
  renderAudioSettings();
  uiRuntime.renderRaceSetupSettings();
  renderTimeOfDaySettings();
  if (view2dBtn) view2dBtn.classList.toggle("active", game.viewMode !== "3d");
  if (view3dBtn) view3dBtn.classList.toggle("active", game.viewMode === "3d");
  screens.show("settings");
}

export function renderTimeOfDaySettings() {
  const day = isDayMode();
  if (timeDayBtn) timeDayBtn.classList.toggle("active", day);
  if (timeNightBtn) timeNightBtn.classList.toggle("active", !day);
}

export function setTimeOfDay(mode) {
  game.timeOfDay = normalizeTimeOfDay(mode);
  uiRuntime.saveGameSettings({ timeOfDay: game.timeOfDay });
  renderTimeOfDaySettings();
  if (game.viewMode === "3d" && THREE_STATE.loaded) {
    if (THREE_STATE.renderer && game.track) rebuild3DTrack();
    else apply3DMapTheme();
  }
}

export function showPromptlyTip() {
  if (!screens.isVisible("title") && game.state !== STATE.TITLE) return;
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

export function initMenusUi(deps = {}) {
  if (settingsBtn) settingsBtn.addEventListener("click", () => { Sound.ensure(); Sound.resume(); showSettingsScreen(); });
  if (settingsBackBtn) settingsBackBtn.addEventListener("click", () => { Sound.ensure(); Sound.resume(); showMainMenu(); });
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
    sfxVolumeInput.addEventListener("change", () => Sound.tone(660, 0.08, "square", 0.12));
  }
  if (view2dBtn) view2dBtn.addEventListener("click", () => setViewMode("2d"));
  if (view3dBtn) view3dBtn.addEventListener("click", () => loadThreeJS(() => setViewMode("3d")));
  if (timeDayBtn) timeDayBtn.addEventListener("click", () => { Sound.ensure(); Sound.resume(); setTimeOfDay("day"); Sound.tone(520, 0.06, "sine", 0.1); });
  if (timeNightBtn) timeNightBtn.addEventListener("click", () => { Sound.ensure(); Sound.resume(); setTimeOfDay("night"); Sound.tone(320, 0.06, "sine", 0.1); });
  if (titleScreen) titleScreen.addEventListener("click", () => { Sound.ensure(); Sound.resume(); Sound.playVocoderTitle(); }, { once: true });
  showPromptlyTip();
  setInterval(showPromptlyTip, 6000);
}
