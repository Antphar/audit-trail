import { TUNING } from "../config/tuning.js";
import { COMPASS_VISUAL } from "../config/themes.js";
import { TAU, clamp, hexToRgba } from "../core/math.js";
import {
  STATE,
  game,
  isBattleMode,
  getActiveKarts,
} from "../core/state.js";
import { MAPS } from "../config/maps.js";
import { Sound } from "../audio/sound.js";
import { kartVisualZOffset } from "../entities/particles.js";
import { WORLD_W, WORLD_H } from "../entities/track.js";
import { renderRuntime } from "./render-runtime.js";
import { THREE_STATE } from "./three-state.js";
import { uiRuntime } from "../ui/ui-runtime.js";

const ctx = () => renderRuntime.getCtx();
const VIEW_W = () => renderRuntime.getViewW();
const VIEW_H = () => renderRuntime.getViewH();
function getTotalLaps() { return renderRuntime.getTotalLaps ? renderRuntime.getTotalLaps() : 3; }
function isDragonEscape() { return MAPS[game.selectedMapIdx || 0].id === "dragon_escape"; }
export function drawApprovalSeals(c, x, y, n, time = 0, r = 8) {
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

function isUntimedHumanBattle() { return isBattleMode() && !!game.battleUntimed && !game.p2pMode; }

export function formatTime(t) {
  if (!Number.isFinite(t)) return "DNF";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(ms)}`;
}
export function pad2(n) { return n < 10 ? "0" + n : "" + n; }
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export function positionColor(p) {
  if (p === 1) return "#ffd86b";
  if (p === 2) return "#d8d8e0";
  if (p === 3) return "#cd7f32";
  return "#ff6b6b";
}

export function roundRect(c, x, y, w, h, r) {
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
export function drawHitFlash( kart, left, top, width, height, time) {
  const hf = kart ? kart.hitFlash : null;
  if (!hf || hf.timer <= 0) return;

  const fadeIn = clamp((hf.maxTimer - hf.timer) / 8, 0, 1);
  const fadeOut = clamp(hf.timer / 20, 0, 1);
  const alpha = Math.min(fadeIn, fadeOut);

  ctx().save();
  ctx().beginPath();
  ctx().rect(left, top, width, height);
  ctx().clip();

  const cx = left + width / 2;
  const cy = top + height * 0.35;

  const vignetteAlpha = alpha * 0.35;
  const vGrad = ctx().createRadialGradient(cx, top + height / 2, Math.min(width, height) * 0.2, cx, top + height / 2, Math.max(width, height) * 0.6);
  vGrad.addColorStop(0, "rgba(0,0,0,0)");
  vGrad.addColorStop(1, hexToRgba(hf.color, vignetteAlpha));
  ctx().fillStyle = vGrad;
  ctx().fillRect(left, top, width, height);

  const scale = 1 + (1 - fadeIn) * 0.8;
  ctx().translate(cx, cy);
  ctx().scale(scale, scale);
  ctx().globalAlpha = alpha;

  const fontSize = Math.min(52, width * 0.08);
  ctx().shadowBlur = 30;
  ctx().shadowColor = hf.color;
  ctx().fillStyle = hf.color;
  ctx().font = `bold ${fontSize}px sans-serif`;
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().fillText(hf.text, 0, 0);

  ctx().shadowBlur = 0;
  ctx().strokeStyle = "rgba(255,255,255,0.6)";
  ctx().lineWidth = 1.5;
  ctx().strokeText(hf.text, 0, 0);

  ctx().restore();
}

export function drawStatusEffects( x, y, kart, time) {
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

  ctx().save();
  ctx().translate(x, y);

  ctx().fillStyle = "rgba(8, 10, 24, 0.65)";
  roundRect(ctx(), 0, 0, barW + 16, panelH, 10);
  ctx().fill();
  ctx().strokeStyle = "rgba(255,255,255,0.08)";
  ctx().lineWidth = 1;
  roundRect(ctx(), 0.5, 0.5, barW + 15, panelH - 1, 10);
  ctx().stroke();

  effects.forEach((eff, i) => {
    const ey = 4 + i * (barH + gap);
    const ratio = clamp(eff.ratio, 0, 1);

    ctx().fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx(), 8, ey, barW, barH, 3);
    ctx().fill();

    const isDebuff = (eff.label === "BLINDED" || eff.label === "SLOWED" || eff.label === "SPINNING" || eff.label === "TETHERED!");
    const pulse = isDebuff ? (0.6 + 0.4 * Math.sin(time * 0.02)) : 1;

    ctx().fillStyle = hexToRgba(eff.color, 0.7 * pulse);
    roundRect(ctx(), 8, ey, barW * ratio, barH, 3);
    ctx().fill();

    if (isDebuff) {
      ctx().strokeStyle = hexToRgba(eff.color, 0.8 * pulse);
      ctx().lineWidth = 1.5;
      roundRect(ctx(), 8, ey, barW, barH, 3);
      ctx().stroke();
    }

    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "left";
    ctx().textBaseline = "middle";
    ctx().fillText(eff.label, 12, ey + barH / 2);
  });

  ctx().restore();
}

// "You were rejected — now spectating X" banner + the current kill-chain target.
export function drawSpectateBanner(cx, y, time) {
  const t = game.spectateTarget;
  const killerName = (game.player && game.player.killedBy && game.player.killedBy.name) || null;
  ctx().save();
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";

  // Headline
  ctx().shadowBlur = 10; ctx().shadowColor = "#ff3366";
  ctx().fillStyle = "#ff3366";
  ctx().font = "bold 20px sans-serif";
  ctx().fillText("SUBMISSION REJECTED", cx, y);
  ctx().shadowBlur = 0;

  // Subline: who we're watching now
  if (t) {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "12px sans-serif";
    const followingKiller = killerName && t.name === killerName;
    ctx().fillText(followingKiller ? "Following your rival" : "Following the leader", cx, y + 20);
    ctx().fillStyle = t.color || "#fff";
    ctx().font = "bold 16px sans-serif";
    ctx().fillText(`\u25B6 ${t.name}  (${Math.max(0, t.approvals || 0)} \u2713)`, cx, y + 40);
  }
  ctx().restore();
}

export function drawWrongWay( kart, left, top, width, height, time) {
  if (!kart || !kart.wrongWayTimer || kart.wrongWayTimer < 15) return;
  const alpha = clamp((kart.wrongWayTimer - 15) / 20, 0, 1);
  const blink = Math.sin(time * 0.012) > 0 ? 1 : 0.4;

  ctx().save();
  ctx().globalAlpha = alpha * blink;

  const cx = left + width / 2;
  const cy = top + height * 0.28;

  ctx().fillStyle = "rgba(255, 30, 30, 0.15)";
  ctx().fillRect(left, top, width, height);

  ctx().shadowBlur = 20;
  ctx().shadowColor = "#ff2222";
  ctx().fillStyle = "#ff2222";
  ctx().font = "bold 48px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().fillText("WRONG WAY!", cx, cy);

  ctx().shadowBlur = 0;
  ctx().strokeStyle = "rgba(255,255,255,0.5)";
  ctx().lineWidth = 1.5;
  ctx().strokeText("WRONG WAY!", cx, cy);

  ctx().font = "bold 16px sans-serif";
  ctx().fillStyle = "#ffaaaa";
  ctx().fillText("Turn around!", cx, cy + 36);

  ctx().restore();
}

export function drawPositionChange( x, y, kart) {
  if (isBattleMode()) return; // no race positions in Battle
  if (!kart || !kart.posChangeFlash || kart.posChangeFlash.timer <= 0) return;
  const pf = kart.posChangeFlash;
  const alpha = clamp(pf.timer / 20, 0, 1) * clamp((pf.maxTimer - pf.timer) / 6, 0, 1);
  const scale = 1 + (1 - clamp((pf.maxTimer - pf.timer) / 10, 0, 1)) * 0.5;

  ctx().save();
  ctx().translate(x, y);
  ctx().scale(scale, scale);
  ctx().globalAlpha = alpha;

  const color = pf.gained ? "#a4ff80" : "#ff4d6d";
  const arrow = pf.gained ? "\u2191" : "\u2193";
  const text = `${ordinal(pf.from)} ${arrow} ${ordinal(pf.to)}`;

  ctx().shadowBlur = 12;
  ctx().shadowColor = color;
  ctx().fillStyle = "rgba(8, 10, 24, 0.8)";
  roundRect(ctx(), -60, -16, 120, 32, 8);
  ctx().fill();

  ctx().fillStyle = color;
  ctx().font = "bold 18px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().fillText(text, 0, 0);

  ctx().restore();
}

export function drawItemNamePopup( x, y, kart, time) {
  if (!kart || !kart.itemNamePopup || kart.itemNamePopup.timer <= 0) return;
  const pop = kart.itemNamePopup;
  const alpha = clamp(pop.timer / 15, 0, 1) * clamp((pop.maxTimer - pop.timer) / 5, 0, 1);

  ctx().save();
  ctx().globalAlpha = alpha;
  ctx().fillStyle = pop.color;
  ctx().font = "bold 11px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "top";
  ctx().shadowBlur = 6;
  ctx().shadowColor = pop.color;
  ctx().fillText(pop.name, x, y);
  ctx().restore();
}

export function drawApprovals3DOverlay(c, time) {
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
    const sx = (v.x * 0.5 + 0.5) * VIEW_W();
    const sy = (-v.y * 0.5 + 0.5) * VIEW_H();
    drawApprovalSeals(c, sx, sy, n, time, 7);
  }
}
export function drawFinishBanner() {
  ctx().save();
  ctx().translate(VIEW_W() / 2, VIEW_H() / 2);

  // Pulsing scale based on time
  const t = performance.now() * 0.005;
  const scale = 1.0 + Math.sin(t) * 0.06;
  ctx().scale(scale, scale);

  // Glassmorphic backing bar
  ctx().fillStyle = "rgba(10, 8, 30, 0.72)";
  ctx().strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx().lineWidth = 2.5;

  const bw = 550, bh = 110;
  roundRect(ctx(), -bw / 2, -bh / 2, bw, bh, 18);
  ctx().fill();
  ctx().stroke();

  // Glowing neon yellow/orange text with deep drop-shadow blur
  ctx().font = "bold 72px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().fillStyle = "#ffd86b";
  ctx().shadowBlur = 30;
  ctx().shadowColor = "#ffd86b";
  ctx().fillText("FINISH!", 0, 0);

  ctx().restore();
}

export function drawUltimateMeter( x, y, w, kart, time) {
  if (!kart) return;
  const h = 10;
  const charge = clamp(kart.ultCharge / TUNING.ULTIMATE_COINS_NEEDED, 0, 1);
  const ready = kart.ultReady;
  const active = kart.ultActiveTimer > 0;

  ctx().save();

  ctx().fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx(), x - 2, y - 2, w + 4, h + 4, 5);
  ctx().fill();

  if (ready) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 0.012);
    ctx().fillStyle = `rgba(255, 216, 107, ${pulse})`;
    roundRect(ctx(), x, y, w, h, 3);
    ctx().fill();
    ctx().strokeStyle = "#ffd86b";
    ctx().lineWidth = 1.5;
    roundRect(ctx(), x, y, w, h, 3);
    ctx().stroke();

    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    const keyLabel = kart.playerIndex === 2 ? "[L]" : "[Q]";
    ctx().fillText(`ULTIMATE READY ${keyLabel}`, x + w / 2, y + h / 2);
  } else if (active) {
    const remaining = clamp(kart.ultActiveTimer / (TUNING.ULTIMATE_DURATION_BASE + kart.ultTier * 30), 0, 1);
    ctx().fillStyle = hexToRgba(kart.color, 0.7);
    roundRect(ctx(), x, y, w * remaining, h, 3);
    ctx().fill();
    ctx().strokeStyle = kart.color;
    ctx().lineWidth = 1;
    roundRect(ctx(), x, y, w, h, 3);
    ctx().stroke();
    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("ULTIMATE ACTIVE", x + w / 2, y + h / 2);
  } else if (charge > 0) {
    ctx().fillStyle = "rgba(255, 216, 107, 0.4)";
    roundRect(ctx(), x, y, w * charge, h, 3);
    ctx().fill();
    ctx().strokeStyle = "rgba(255, 216, 107, 0.5)";
    ctx().lineWidth = 1;
    roundRect(ctx(), x, y, w, h, 3);
    ctx().stroke();
    ctx().fillStyle = "#ebe4ff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText(`ULT ${kart.ultCharge}/${TUNING.ULTIMATE_COINS_NEEDED}`, x + w / 2, y + h / 2);
  }

  ctx().restore();
}

export function drawHUD(time) {
  if (!game.player) return;
  ctx().save();

  // Top-left: Lap/Distance, Position, Time
  drawHUDPanel(20, 20, 220, 92, () => {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "11px sans-serif";
    ctx().textAlign = "left"; ctx().textBaseline = "top";
    if (isBattleMode()) {
      const appr = game.player.approvals || 0;
      ctx().fillText("APPROVALS", 18, 14);
      ctx().font = "bold 22px sans-serif";
      for (let i = 0; i < Math.max(appr, 0); i++) {
        ctx().fillStyle = COMPASS_VISUAL.sealFill;
        ctx().beginPath(); ctx().arc(24 + i * 20, 34, 7, 0, TAU); ctx().fill();
        ctx().strokeStyle = COMPASS_VISUAL.sealRing;
        ctx().lineWidth = 1.2;
        ctx().stroke();
        ctx().fillStyle = COMPASS_VISUAL.sealMark;
        ctx().font = "bold 9px sans-serif";
        ctx().fillText("✓", 20 + i * 20, 29);
        ctx().font = "bold 22px sans-serif";
      }
      if (appr <= 0) {
        ctx().fillStyle = "#ff3366";
        ctx().font = "bold 16px sans-serif";
        ctx().fillText("REJECTED", 18, 28);
      }

      const untimed = isUntimedHumanBattle();
      const tl = untimed ? game.battleDuration : Math.max(0, game.battleTimeLeft || 0);
      ctx().fillStyle = !untimed && tl < 15 ? "#ff4d6d" : "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("TIME LEFT", 130, 14);
      ctx().fillStyle = !untimed && tl < 15 ? "#ff4d6d" : "#fff";
      ctx().font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      ctx().fillText(untimed ? "∞" : formatTime(tl), 130, 32);

      const aliveCount = getActiveKarts().filter((k) => k && !k.eliminated).length;
      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("SURVIVORS", 18, 64);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 22px sans-serif";
      ctx().fillText(`${aliveCount} / ${game.totalRacers}`, 18, 78);
    } else if (isDragonEscape()) {
      ctx().fillText("DISTANCE", 18, 14);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      const distKm = (game.player.x / 1000).toFixed(1);
      ctx().fillText(`${distKm} km`, 18, 28);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("SURVIVAL", 130, 14);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      ctx().fillText(formatTime(game.raceTime), 130, 32);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("POSITION", 18, 64);
      ctx().fillStyle = positionColor(game.hudPosition);
      ctx().font = "bold 22px sans-serif";
      ctx().fillText(`${ordinal(game.hudPosition)} / ${game.totalRacers}`, 18, 78);
    } else {
      ctx().fillText("LAP", 18, 14);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 28px sans-serif";
      ctx().fillText(`${Math.min(game.player.lap + 1, getTotalLaps())} / ${getTotalLaps()}`, 18, 28);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("TIME", 130, 14);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      ctx().fillText(formatTime(game.raceTime), 130, 32);

      if (game.mapRecordCache && Number.isFinite(game.mapRecordCache.bestTotal)) {
        ctx().fillStyle = "#ffd86b";
        ctx().font = "11px sans-serif";
        ctx().fillText("BEST", 240, 14);
        ctx().font = "bold 18px 'SFMono-Regular', Consolas, monospace";
        ctx().fillText(formatTime(game.mapRecordCache.bestTotal), 240, 31);
      }

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("POSITION", 18, 64);
      ctx().fillStyle = positionColor(game.hudPosition);
      ctx().font = "bold 22px sans-serif";
      ctx().fillText(`${ordinal(game.hudPosition)} / ${game.totalRacers}`, 18, 78);
    }
  });

  // Top-right: Coins / Item Roulette slot
  drawHUDPanel(VIEW_W() - 220 - 20, 20, 220, 92, () => {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "11px sans-serif";
    ctx().textAlign = "left"; ctx().textBaseline = "top";
    ctx().fillText("CITATIONS", 18, 14);

    // Coin icon
    ctx().fillStyle = "#ffd86b";
    ctx().beginPath(); ctx().arc(28, 42, 9, 0, TAU); ctx().fill();
    ctx().fillStyle = "#a87a13";
    ctx().beginPath(); ctx().arc(28, 42, 5, 0, TAU); ctx().fill();
    ctx().fillStyle = "#fff";
    ctx().font = "bold 22px sans-serif";
    ctx().fillText(`${game.player.coinsCollected}`, 50, 32);

    ctx().fillStyle = "#a8acd0";
    ctx().font = "11px sans-serif";
    ctx().fillText("ITEM", 132, 14);
  });

  // Draw the Item Slot panel perfectly overlapping the top-right panel slot
  drawItemSlot(ctx(), VIEW_W() - 20 - 90, 42, 70, game.player, time);

  // Bottom-left: Speedometer
  drawSpeedo(20, VIEW_H() - 160, 140, game.player);

  // Bottom-right: Mini-map
  drawMinimap(VIEW_W() - 200, VIEW_H() - 200, 180);

  // Drift charge bar (center bottom)
  if (game.player.driftCharge > 5) {
    const w = 160, h = 8;
    const x = (VIEW_W() - w) / 2, y = VIEW_H() - 30;
    ctx().fillStyle = "rgba(0,0,0,0.4)";
    ctx().fillRect(x, y, w, h);
    const charge = clamp(game.player.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
    let col = "#00e5ff"; // Blue (Tier 1)
    if (game.player.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Pink (Tier 3)
    else if (game.player.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Orange (Tier 2)
    ctx().fillStyle = col;
    ctx().fillRect(x, y, w * charge, h);
    ctx().strokeStyle = col;
    ctx().strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx().font = "bold 10px sans-serif";
    ctx().textAlign = "center";
    ctx().fillText(game.player.driftCharge >= TUNING.DRIFT_TIER3 ? "ULTRA TURBO READY" : game.player.driftCharge >= TUNING.DRIFT_TIER2 ? "SUPER TURBO" : "MINI TURBO", x + w / 2, y - 7);
  }

  // Ultimate charge meter (left of center bottom)
  drawUltimateMeter(ctx(), (VIEW_W() - 140) / 2, VIEW_H() - 52, 140, game.player, time);

  // Regulaido Autopilot Active Watermark Panel (top-center, beautifully glassmorphic)
  const wmW = 200, wmH = 24;
  const wmX = (VIEW_W() - wmW) / 2, wmY = 20;

  ctx().save();
  ctx().shadowBlur = 8;
  ctx().shadowColor = "rgba(123, 117, 255, 0.4)";
  ctx().fillStyle = "rgba(13, 11, 33, 0.75)";
  ctx().strokeStyle = "#7b75ff";
  ctx().lineWidth = 1;
  ctx().beginPath();
  ctx().roundRect ? ctx().roundRect(wmX, wmY, wmW, wmH, 5) : ctx().rect(wmX, wmY, wmW, wmH);
  ctx().fill();
  ctx().stroke();
  ctx().restore();

  ctx().fillStyle = "#ffffff";
  ctx().font = "bold 9px monospace";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  const dotPulse = Math.sin(time * 0.005) > 0 ? "●" : " ";
  ctx().fillStyle = "#a4ff80"; // Mint Green
  ctx().fillText(dotPulse, wmX + 22, wmY + wmH / 2);
  ctx().fillStyle = "#ffffff";
  ctx().fillText("REGULAIDO AUTOPILOT ACTIVE", wmX + 110, wmY + wmH / 2);

  // Active status effects panel (right side, above minimap)
  drawStatusEffects(VIEW_W() - 200, VIEW_H() - 400, game.player, time);

  // Hit flash overlay
  drawHitFlash(game.player, 0, 0, VIEW_W(), VIEW_H(), time);

  // Battle spectator banner: shown after you're rejected while you watch the kill chain play out
  if (isBattleMode() && game.player && game.player.eliminated) {
    drawSpectateBanner(VIEW_W() / 2, 70, time);
  }

  // Wrong-way overlay
  drawWrongWay(game.player, 0, 0, VIEW_W(), VIEW_H(), time);

  // Position change callout
  drawPositionChange(VIEW_W() / 2, VIEW_H() * 0.18, game.player);

  // Item name popup
  drawItemNamePopup(VIEW_W() - 20 - 55, 118, game.player, time);

  // Mute indicator
  if (Sound.muted) {
    ctx().fillStyle = "rgba(0,0,0,0.45)";
    ctx().fillRect(VIEW_W() - 70, 130, 56, 22);
    ctx().fillStyle = "#fff";
    ctx().font = "bold 11px sans-serif";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText("MUTED", VIEW_W() - 42, 141);
  }

  if (game.p2pMode && game.p2pPing > 0) {
    const pingY = Sound.muted ? 158 : 130;
    const pingColor = game.p2pPing < 60 ? "#a4ff80" : game.p2pPing < 120 ? "#ffd86b" : "#ff4d6d";
    ctx().fillStyle = "rgba(0,0,0,0.45)";
    ctx().fillRect(VIEW_W() - 82, pingY, 68, 20);
    ctx().fillStyle = pingColor;
    ctx().font = "bold 10px monospace";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText(`${game.p2pPing}ms`, VIEW_W() - 48, pingY + 10);
  }

  if (game.p2pConnectionUnstable) {
    const unstableY = (game.p2pMode && game.p2pPing > 0) ? (Sound.muted ? 184 : 156) : (Sound.muted ? 158 : 130);
    ctx().fillStyle = "rgba(0,0,0,0.45)";
    ctx().fillRect(VIEW_W() - 152, unstableY, 138, 20);
    ctx().fillStyle = "#ffd86b";
    ctx().font = "bold 9px monospace";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText("CONNECTION UNSTABLE", VIEW_W() - 83, unstableY + 10);
  }

  ctx().restore();
}

export function drawItemSlot( x, y, size, kart, time) {
  ctx().save();
  ctx().translate(x, y);

  // Panel background
  ctx().fillStyle = "rgba(8, 10, 24, 0.8)";
  roundRect(ctx(), 0, 0, size, size, 10);
  ctx().fill();
  ctx().strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx().lineWidth = 1.5;
  roundRect(ctx(), 0.5, 0.5, size - 1, size - 1, 10);
  ctx().stroke();

  if (kart.itemState === "empty") {
    ctx().fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx().font = "20px sans-serif";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("?", size / 2, size / 2);
  } else if (kart.itemState === "rolling") {
    const items = ["boost", "shield", "handling", "conflict", "placebo", "doubleblind", "dossier", "deauth", "mergerequest", "hotfix", "fasttrack"];
    const frameIdx = Math.floor(time * 0.05) % items.length;
    const item = items[frameIdx];
    drawItemIcon(ctx(), size / 2, size / 2, size * 0.55, item, time);
  } else if (kart.itemState === "active" && kart.itemSlot) {
    drawItemIcon(ctx(), size / 2, size / 2, size * 0.6, kart.itemSlot, time);

    const pulse = 0.5 + 0.5 * Math.sin(time * 0.015);
    ctx().strokeStyle = `rgba(255, 216, 107, ${pulse})`;
    ctx().lineWidth = 2.5;
    roundRect(ctx(), 1, 1, size - 2, size - 2, 10);
    ctx().stroke();

    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "center";
    ctx().textBaseline = "bottom";
    const shortcut = kart.playerIndex === 2 ? "[Period]" : "[LShift]";
    ctx().fillText(shortcut, size / 2, size - 3);
  }

  ctx().restore();
}

export function drawItemIcon( cx, cy, sz, item, time) {
  ctx().save();
  ctx().translate(cx, cy);

  if (item === "boost") {
    ctx().fillStyle = "#fd9927";
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#fd9927";
    ctx().beginPath();
    ctx().moveTo(0, -sz / 2);
    ctx().lineTo(sz / 2, sz / 2 - 2);
    ctx().lineTo(0, sz / 4);
    ctx().lineTo(-sz / 2, sz / 2 - 2);
    ctx().closePath();
    ctx().fill();
  } else if (item === "shield") {
    ctx().fillStyle = "rgba(87, 242, 255, 0.25)";
    ctx().strokeStyle = "#57f2ff";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#57f2ff";

    ctx().beginPath();
    ctx().moveTo(0, -sz / 2);
    ctx().lineTo(sz / 2 - 2, -sz / 4);
    ctx().quadraticCurveTo(sz / 2 - 2, sz / 4, 0, sz / 2);
    ctx().quadraticCurveTo(-sz / 2 + 2, sz / 4, -sz / 2 + 2, -sz / 4);
    ctx().closePath();
    ctx().fill();
    ctx().stroke();
  } else if (item === "handling") {
    ctx().strokeStyle = "#a4ff80";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#a4ff80";
    ctx().save();
    ctx().rotate(time * 0.003);

    ctx().beginPath();
    ctx().arc(0, 0, sz / 3, 0, TAU);
    ctx().stroke();

    ctx().lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx().rotate(TAU / 6);
      ctx().beginPath();
      ctx().moveTo(sz / 3, 0);
      ctx().lineTo(sz / 2, 0);
      ctx().stroke();
    }
    ctx().restore();
  } else if (item === "conflict") {
    ctx().fillStyle = "rgba(255, 77, 109, 0.25)";
    ctx().strokeStyle = "#ff4d6d";
    ctx().lineWidth = 2;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#ff4d6d";

    ctx().beginPath();
    ctx().rect(-sz / 2, -sz / 2, sz, sz);
    ctx().fill();
    ctx().stroke();

    ctx().shadowBlur = 0;
    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("Err", 0, 0);
  } else if (item === "placebo") {
    ctx().fillStyle = "rgba(255, 204, 0, 0.25)";
    ctx().strokeStyle = "#ffcc00";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#ffcc00";
    roundRect(ctx(), -sz * 0.48, -sz * 0.22, sz * 0.96, sz * 0.44, sz * 0.22);
    ctx().fill();
    ctx().stroke();
    ctx().beginPath();
    ctx().moveTo(0, -sz * 0.2);
    ctx().lineTo(0, sz * 0.2);
    ctx().stroke();
    ctx().shadowBlur = 0;
    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("Rx", -sz * 0.18, 0);
  } else if (item === "doubleblind") {
    ctx().fillStyle = "rgba(189, 87, 255, 0.24)";
    ctx().strokeStyle = "#bd57ff";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 10;
    ctx().shadowColor = "#bd57ff";
    ctx().beginPath();
    ctx().arc(0, 0, sz * 0.42, 0, TAU);
    ctx().fill();
    ctx().stroke();
    ctx().shadowBlur = 0;
    ctx().strokeStyle = "#fff";
    ctx().lineWidth = 2;
    ctx().beginPath();
    ctx().moveTo(-sz * 0.28, 0);
    ctx().quadraticCurveTo(0, -sz * 0.22, sz * 0.28, 0);
    ctx().quadraticCurveTo(0, sz * 0.22, -sz * 0.28, 0);
    ctx().stroke();
    ctx().beginPath();
    ctx().moveTo(-sz * 0.36, -sz * 0.28);
    ctx().lineTo(sz * 0.36, sz * 0.28);
    ctx().stroke();
  } else if (item === "dossier") {
    ctx().fillStyle = "rgba(87, 242, 255, 0.25)";
    ctx().strokeStyle = "#57f2ff";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#57f2ff";

    ctx().beginPath();
    ctx().rect(-sz / 2, -sz * 0.35, sz, sz * 0.7);
    ctx().moveTo(-sz / 2, -sz * 0.35);
    ctx().lineTo(-sz / 2, -sz / 2);
    ctx().lineTo(-sz / 8, -sz / 2);
    ctx().lineTo(0, -sz * 0.35);
    ctx().fill();
    ctx().stroke();

    ctx().shadowBlur = 0;
    ctx().strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx().lineWidth = 1.5;
    ctx().beginPath();
    ctx().moveTo(-sz * 0.3, -sz * 0.1);
    ctx().lineTo(sz * 0.3, -sz * 0.1);
    ctx().moveTo(-sz * 0.3, sz * 0.1);
    ctx().lineTo(sz * 0.1, sz * 0.1);
    ctx().moveTo(-sz * 0.3, sz * 0.25);
    ctx().lineTo(sz * 0.25, sz * 0.25);
    ctx().stroke();
  } else if (item === "deauth") {
    ctx().strokeStyle = "#ff3366";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#ff3366";

    // Draw concentric antenna waves
    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.12, 0, TAU);
    ctx().fillStyle = "#ff3366";
    ctx().fill();

    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.3, Math.PI * 1.2, Math.PI * 1.8);
    ctx().stroke();

    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.52, Math.PI * 1.25, Math.PI * 1.75);
    ctx().stroke();
  } else if (item === "mergerequest") {
    ctx().strokeStyle = "#39ff14";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 8;
    ctx().shadowColor = "#39ff14";

    // Draw bracket < > with a center pull arrow
    ctx().beginPath();
    ctx().moveTo(-sz * 0.35, -sz * 0.3);
    ctx().lineTo(-sz * 0.5, 0);
    ctx().lineTo(-sz * 0.35, sz * 0.3);

    ctx().moveTo(sz * 0.35, -sz * 0.3);
    ctx().lineTo(sz * 0.5, 0);
    ctx().lineTo(sz * 0.35, sz * 0.3);
    ctx().stroke();

    // Center arrow pointing down/in
    ctx().beginPath();
    ctx().moveTo(0, -sz * 0.25);
    ctx().lineTo(0, sz * 0.25);
    ctx().stroke();

    ctx().fillStyle = "#39ff14";
    ctx().beginPath();
    ctx().moveTo(-sz * 0.15, sz * 0.08);
    ctx().lineTo(0, sz * 0.25);
    ctx().lineTo(sz * 0.15, sz * 0.08);
    ctx().closePath();
    ctx().fill();
  } else if (item === "hotfix") {
    const pulse = 0.6 + 0.4 * Math.sin(time * 0.008);
    ctx().fillStyle = `rgba(255, 200, 0, ${pulse})`;
    ctx().strokeStyle = "#ffcc00";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 12;
    ctx().shadowColor = "#ffcc00";

    ctx().beginPath();
    ctx().moveTo(0, -sz * 0.5);
    ctx().lineTo(sz * 0.2, -sz * 0.1);
    ctx().lineTo(sz * 0.5, -sz * 0.1);
    ctx().lineTo(sz * 0.25, sz * 0.12);
    ctx().lineTo(sz * 0.35, sz * 0.5);
    ctx().lineTo(0, sz * 0.2);
    ctx().lineTo(-sz * 0.35, sz * 0.5);
    ctx().lineTo(-sz * 0.25, sz * 0.12);
    ctx().lineTo(-sz * 0.5, -sz * 0.1);
    ctx().lineTo(-sz * 0.2, -sz * 0.1);
    ctx().closePath();
    ctx().fill();
    ctx().stroke();
  } else if (item === "fasttrack") {
    ctx().strokeStyle = "#a4ff80";
    ctx().fillStyle = "rgba(164, 255, 128, 0.22)";
    ctx().lineWidth = 2.5;
    ctx().shadowBlur = 12;
    ctx().shadowColor = "#a4ff80";
    ctx().beginPath();
    ctx().moveTo(-sz * 0.42, sz * 0.2);
    ctx().lineTo(-sz * 0.12, -sz * 0.42);
    ctx().lineTo(sz * 0.38, -sz * 0.42);
    ctx().lineTo(sz * 0.1, sz * 0.04);
    ctx().lineTo(sz * 0.42, sz * 0.04);
    ctx().lineTo(-sz * 0.1, sz * 0.46);
    ctx().closePath();
    ctx().fill();
    ctx().stroke();
    ctx().shadowBlur = 0;
    ctx().fillStyle = "#fff";
    ctx().font = "bold 8px monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("FDA", 0, 0);
  }

  ctx().restore();
}

export function drawHUDMultiplayer(time) {
  if (!game.player || !game.player2) return;
  ctx().save();

  const ranking = uiRuntime.rankAll();
  const p1Pos = ranking.indexOf(game.player) + 1;
  const p2Pos = ranking.indexOf(game.player2) + 1;

  // 1. Player 1 HUD (Left side)
  drawHUDPanel(15, 15, 185, 105, () => {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().textAlign = "left"; ctx().textBaseline = "top";

    if (isDragonEscape()) { ctx().fillText("DIST", 12, 10); ctx().fillStyle = "#fff"; ctx().font = "bold 18px 'SFMono-Regular', Consolas, monospace"; ctx().fillText(`${(game.player.x / 1000).toFixed(1)}km`, 12, 22); }
    else { ctx().fillText("LAP", 12, 10); ctx().fillStyle = "#fff"; ctx().font = "bold 20px sans-serif"; ctx().fillText(`${Math.min(game.player.lap + 1, getTotalLaps())} / ${getTotalLaps()}`, 12, 22); }

    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("CITATIONS", 12, 54);
    ctx().fillStyle = "#ffd86b";
    ctx().font = "bold 18px sans-serif";
    ctx().fillText(`${game.player.coinsCollected}`, 12, 66);

    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("POS", 110, 10);
    ctx().fillStyle = positionColor(p1Pos);
    ctx().font = "bold 20px sans-serif";
    ctx().fillText(`${ordinal(p1Pos)}`, 110, 22);

    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("ITEM", 110, 54);
  });

  drawItemSlot(ctx(), 120, 68, 48, game.player, time);
  drawSpeedo(15, VIEW_H() - 135, 120, game.player);

  // 2. Player 2 HUD (Right side)
  drawHUDPanel(VIEW_W() - 200, 15, 185, 105, () => {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().textAlign = "left"; ctx().textBaseline = "top";

    if (isDragonEscape()) { ctx().fillText("DIST", 12, 10); ctx().fillStyle = "#fff"; ctx().font = "bold 18px 'SFMono-Regular', Consolas, monospace"; ctx().fillText(`${(game.player2.x / 1000).toFixed(1)}km`, 12, 22); }
    else { ctx().fillText("LAP", 12, 10); ctx().fillStyle = "#fff"; ctx().font = "bold 20px sans-serif"; ctx().fillText(`${Math.min(game.player2.lap + 1, getTotalLaps())} / ${getTotalLaps()}`, 12, 22); }

    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("CITATIONS", 12, 54);
    ctx().fillStyle = "#ffd86b";
    ctx().font = "bold 18px sans-serif";
    ctx().fillText(`${game.player2.coinsCollected}`, 12, 66);

    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("POS", 110, 10);
    ctx().fillStyle = positionColor(p2Pos);
    ctx().font = "bold 20px sans-serif";
    ctx().fillText(`${ordinal(p2Pos)}`, 110, 22);

    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("ITEM", 110, 54);
  });

  drawItemSlot(ctx(), VIEW_W() - 200 + 110, 68, 48, game.player2, time);
  drawSpeedo(VIEW_W() - 135, VIEW_H() - 135, 120, game.player2);

  // 3. Central Mini-map (Overlapping divider)
  drawMinimap(VIEW_W() / 2 - 75, VIEW_H() - 165, 150);

  // 4. Drift charge bars
  if (game.player.driftCharge > 5) {
    const w = 120, h = 6;
    const x = 145, y = VIEW_H() - 25;
    ctx().fillStyle = "rgba(0,0,0,0.4)";
    ctx().fillRect(x, y, w, h);
    const charge = clamp(game.player.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
    let col = "#00e5ff"; // Blue (Tier 1)
    if (game.player.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Pink (Tier 3)
    else if (game.player.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Orange (Tier 2)
    ctx().fillStyle = col;
    ctx().fillRect(x, y, w * charge, h);
  }

  if (game.player2.driftCharge > 5) {
    const w = 120, h = 6;
    const x = VIEW_W() - 135 - 130, y = VIEW_H() - 25;
    ctx().fillStyle = "rgba(0,0,0,0.4)";
    ctx().fillRect(x, y, w, h);
    const charge = clamp(game.player2.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
    let col = "#00e5ff"; // Blue (Tier 1)
    if (game.player2.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Pink (Tier 3)
    else if (game.player2.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Orange (Tier 2)
    ctx().fillStyle = col;
    ctx().fillRect(x, y, w * charge, h);
  }

  // 5. Ultimate meters
  drawUltimateMeter(ctx(), 15, VIEW_H() - 48, 110, game.player, time);
  drawUltimateMeter(ctx(), VIEW_W() - 125, VIEW_H() - 48, 110, game.player2, time);

  // Regulaido Autopilot Active Watermark (top-center below split border)
  const wmW = 180, wmH = 20;
  const wmX = (VIEW_W() - wmW) / 2, wmY = 40;

  ctx().save();
  ctx().shadowBlur = 6;
  ctx().shadowColor = "rgba(123, 117, 255, 0.3)";
  ctx().fillStyle = "rgba(13, 11, 33, 0.8)";
  ctx().strokeStyle = "#7b75ff";
  ctx().lineWidth = 1;
  ctx().beginPath();
  ctx().roundRect ? ctx().roundRect(wmX, wmY, wmW, wmH, 4) : ctx().rect(wmX, wmY, wmW, wmH);
  ctx().fill();
  ctx().stroke();
  ctx().restore();

  ctx().fillStyle = "#a4ff80"; // Mint Green pulsing dot
  const dotPulse = Math.sin(time * 0.005) > 0 ? "●" : " ";
  ctx().font = "bold 9px monospace";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().fillText(dotPulse, wmX + 18, wmY + wmH / 2);
  ctx().fillStyle = "#ffffff";
  ctx().fillText("REGULAIDO SYSTEM ACTIVE", wmX + 95, wmY + wmH / 2);

  // Active status effects panels
  drawStatusEffects(15, VIEW_H() / 2 - 60, game.player, time);
  drawStatusEffects(VIEW_W() - 140, VIEW_H() / 2 - 60, game.player2, time);

  // Per-player hit flash overlays (clipped to each viewport)
  const p1W = VIEW_W() / 2 - 2;
  const p2W = VIEW_W() / 2 - 2;
  const p2X = VIEW_W() / 2 + 2;
  drawHitFlash(game.player, 0, 0, p1W, VIEW_H(), time);
  drawHitFlash(game.player2, p2X, 0, p2W, VIEW_H(), time);

  // Wrong-way overlays
  drawWrongWay(game.player, 0, 0, p1W, VIEW_H(), time);
  drawWrongWay(game.player2, p2X, 0, p2W, VIEW_H(), time);

  // Position change callouts
  drawPositionChange(p1W / 2, VIEW_H() * 0.18, game.player);
  drawPositionChange(p2X + p2W / 2, VIEW_H() * 0.18, game.player2);

  // Item name popups
  drawItemNamePopup(145, 120, game.player, time);
  drawItemNamePopup(VIEW_W() - 200 + 135, 120, game.player2, time);

  // Mute indicator
  if (Sound.muted) {
    ctx().fillStyle = "rgba(0,0,0,0.45)";
    ctx().fillRect(VIEW_W() / 2 - 28, 15, 56, 20);
    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText("MUTED", VIEW_W() / 2, 25);
  }

  ctx().restore();
}

export function drawHUDPanel(x, y, w, h, drawFn) {
  ctx().save();
  ctx().translate(x, y);
  ctx().fillStyle = COMPASS_VISUAL.hudBg;
  roundRect(ctx(), 0, 0, w, h, 12); ctx().fill();
  ctx().fillStyle = COMPASS_VISUAL.hudHighlight;
  roundRect(ctx(), 1, 1, w - 2, 4, 8); ctx().fill();
  ctx().strokeStyle = COMPASS_VISUAL.hudBorder;
  ctx().lineWidth = 1;
  roundRect(ctx(), 0.5, 0.5, w - 1, h - 1, 12); ctx().stroke();
  drawFn();
  ctx().restore();
}

export function drawSpeedo(x, y, size, player) {
  if (!player) return;
  ctx().save();
  ctx().translate(x, y);
  ctx().fillStyle = COMPASS_VISUAL.hudBg;
  roundRect(ctx(), 0, 0, size, size, 14); ctx().fill();
  ctx().strokeStyle = COMPASS_VISUAL.hudBorder;
  roundRect(ctx(), 0.5, 0.5, size - 1, size - 1, 14); ctx().stroke();

  const cx = size / 2, cy = size / 2 + 14;
  const radius = size / 2 - 22;

  // Tick marks around the arc
  ctx().strokeStyle = "rgba(255,255,255,0.25)";
  ctx().lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const tickAng = Math.PI + (Math.PI * i / 10);
    const isMajor = i % 2 === 0;
    const inner = radius - (isMajor ? 10 : 6);
    const outer = radius + 2;
    ctx().lineWidth = isMajor ? 1.5 : 0.8;
    ctx().beginPath();
    ctx().moveTo(cx + Math.cos(tickAng) * inner, cy + Math.sin(tickAng) * inner);
    ctx().lineTo(cx + Math.cos(tickAng) * outer, cy + Math.sin(tickAng) * outer);
    ctx().stroke();
  }

  // Arc background
  ctx().lineWidth = 8;
  ctx().strokeStyle = "rgba(255,255,255,0.08)";
  ctx().beginPath();
  ctx().arc(cx, cy, radius, Math.PI, TAU);
  ctx().stroke();

  const sp = player.speed();
  const maxDisplay = 8.5;
  const frac = clamp(sp / maxDisplay, 0, 1);
  const col = sp > 7 ? COMPASS_VISUAL.accent : sp > 5 ? COMPASS_VISUAL.primaryDark : COMPASS_VISUAL.primary;

  // Arc filled with glow
  ctx().shadowBlur = 10;
  ctx().shadowColor = col;
  ctx().strokeStyle = col;
  ctx().lineWidth = 8;
  ctx().beginPath();
  ctx().arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * frac);
  ctx().stroke();
  ctx().shadowBlur = 0;

  // Needle with glow
  const ang = Math.PI + Math.PI * frac;
  ctx().shadowBlur = 8;
  ctx().shadowColor = col;
  ctx().strokeStyle = col;
  ctx().lineWidth = 2.5;
  ctx().beginPath();
  ctx().moveTo(cx, cy);
  ctx().lineTo(cx + Math.cos(ang) * (radius - 4), cy + Math.sin(ang) * (radius - 4));
  ctx().stroke();
  ctx().shadowBlur = 0;

  // Center hub
  ctx().fillStyle = col;
  ctx().beginPath(); ctx().arc(cx, cy, 4, 0, TAU); ctx().fill();
  ctx().fillStyle = "#050510";
  ctx().beginPath(); ctx().arc(cx, cy, 2, 0, TAU); ctx().fill();

  // Numeric
  ctx().fillStyle = "#fff";
  ctx().font = "bold 22px 'SFMono-Regular', Consolas, monospace";
  ctx().textAlign = "center"; ctx().textBaseline = "middle";
  ctx().fillText(`${Math.round(sp * 28)}`, cx, cy - 12);
  ctx().fillStyle = "#a8acd0";
  ctx().font = "10px sans-serif";
  ctx().fillText("KM/H", cx, cy + 8);

  if (player.boostTimer > 0) {
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.01);
    ctx().globalAlpha = pulse;
    ctx().fillStyle = "#ff8a3b";
    ctx().font = "bold 10px sans-serif";
    ctx().fillText("BOOST", cx, 18);
    ctx().globalAlpha = 1;
  }

  ctx().restore();
}

export function drawMinimap(x, y, size) {
  ctx().save();
  ctx().translate(x, y);
  ctx().fillStyle = COMPASS_VISUAL.hudBg;
  roundRect(ctx(), 0, 0, size, size, 12); ctx().fill();
  ctx().strokeStyle = COMPASS_VISUAL.hudBorder;
  roundRect(ctx(), 0.5, 0.5, size - 1, size - 1, 12); ctx().stroke();

  const pad = 12;
  const sx = (size - pad * 2) / WORLD_W;
  const sy = (size - pad * 2) / WORLD_H;
  const s = Math.min(sx, sy);
  const ox = pad + ((size - pad * 2) - WORLD_W * s) / 2;
  const oy = pad + ((size - pad * 2) - WORLD_H * s) / 2;

  // Track outline (sample for huge worlds)
  ctx().strokeStyle = "rgba(255,255,255,0.7)";
  ctx().lineWidth = 6;
  ctx().lineCap = "round";
  ctx().lineJoin = "round";
  ctx().beginPath();
  const step = game.track.isOpen ? 12 : 1;
  for (let i = 0; i < game.track.n; i += step) {
    const w = game.track.waypoints[i];
    const px = ox + w.x * s, py = oy + w.y * s;
    if (i === 0) ctx().moveTo(px, py);
    else ctx().lineTo(px, py);
  }
  if (!game.track.isOpen) ctx().closePath();
  ctx().stroke();
  ctx().strokeStyle = "rgba(58, 61, 73, 1)";
  ctx().lineWidth = 4;
  ctx().stroke();

  // Start line marker (no start/finish in the Battle arena)
  if (!isBattleMode()) {
    const w0 = game.track.waypoints[0];
    ctx().fillStyle = "#ffd86b";
    ctx().beginPath();
    ctx().arc(ox + w0.x * s, oy + w0.y * s, 3, 0, TAU);
    ctx().fill();
  }

  // Karts (drop the ones already knocked out in Battle)
  for (const k of game.ais) {
    if (k.eliminated) continue;
    ctx().fillStyle = k.color;
    ctx().beginPath();
    ctx().arc(ox + k.x * s, oy + k.y * s, 3, 0, TAU);
    ctx().fill();
  }

  // Player 2
  if (game.multiplayer && game.player2 && !game.p2pMode) {
    ctx().fillStyle = "#fff";
    ctx().strokeStyle = game.player2.color;
    ctx().lineWidth = 2;
    ctx().beginPath();
    ctx().arc(ox + game.player2.x * s, oy + game.player2.y * s, 3.5, 0, TAU);
    ctx().fill(); ctx().stroke();
  }

  // Player 1 — while spectating in Battle, mark the kart the camera is following instead
  const meMarker = (isBattleMode() && game.player.eliminated && game.spectateTarget && !game.spectateTarget.eliminated)
    ? game.spectateTarget : (game.player.eliminated && isBattleMode() ? null : game.player);
  if (meMarker) {
    ctx().fillStyle = "#fff";
    ctx().strokeStyle = meMarker.color;
    ctx().lineWidth = 2;
    ctx().beginPath();
    ctx().arc(ox + meMarker.x * s, oy + meMarker.y * s, 4, 0, TAU);
    ctx().fill(); ctx().stroke();
  }

  // Label
  ctx().fillStyle = "#a8acd0";
  ctx().font = "10px sans-serif";
  ctx().textAlign = "left"; ctx().textBaseline = "top";
  ctx().fillText("MAP", 8, 6);

  ctx().restore();
}

export function drawCountdown() {
  const elapsed = performance.now() - game.countdownStart;
  ctx().fillStyle = "rgba(0,0,0,0.32)";
  ctx().fillRect(0, 0, VIEW_W(), VIEW_H());

  let phase = (elapsed % 900) / 900;
  if (game.countdownText === "GO!") phase = (elapsed - 2700) / 800;
  const scale = 1 + (1 - phase) * 0.6;
  const a = clamp(1 - Math.pow(phase, 2), 0, 1);

  ctx().save();
  ctx().translate(VIEW_W() / 2, VIEW_H() / 2);
  ctx().scale(scale, scale);
  ctx().globalAlpha = a;
  ctx().font = "bold 180px sans-serif";
  ctx().textAlign = "center"; ctx().textBaseline = "middle";
  ctx().fillStyle = game.countdownText === "GO!" ? "#7aff66" : "#ff4d6d";
  ctx().shadowBlur = 30; ctx().shadowColor = ctx().fillStyle;
  ctx().fillText(game.countdownText, 0, 0);
  ctx().restore();

  // Rev meter / rocket start indicator
  if (game.rocketStartP1.holding) {
    const hs = game.rocketStartP1.holdStart;
    const mw = 180, mh = 14;
    const mx = VIEW_W() / 2 - mw / 2, my = VIEW_H() / 2 + 110;

    ctx().save();
    ctx().fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx(), mx - 2, my - 2, mw + 4, mh + 4, 5);
    ctx().fill();

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
    ctx().fillStyle = revCol;
    ctx().globalAlpha = revPulse;
    roundRect(ctx(), mx, my, mw, mh, 3);
    ctx().fill();
    ctx().globalAlpha = 1;

    ctx().fillStyle = "#fff";
    ctx().font = "bold 10px 'SFMono-Regular', Consolas, monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText(revLabel, mx + mw / 2, my + mh / 2);

    // Hint text
    ctx().fillStyle = "#a8acd0";
    ctx().font = "10px sans-serif";
    ctx().fillText("HOLD GAS TO REV", mx + mw / 2, my + mh + 14);
    ctx().restore();
  } else if (elapsed > 500) {
    ctx().save();
    ctx().fillStyle = "rgba(168, 172, 208, 0.5)";
    ctx().font = "10px sans-serif";
    ctx().textAlign = "center";
    ctx().fillText("HOLD GAS TO REV - RELEASE AT GO!", VIEW_W() / 2, VIEW_H() / 2 + 120);
    ctx().restore();
  }
}

/* ============================================================
   FORMATTERS
   ============================================================ */
