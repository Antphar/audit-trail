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
let _approvalProjVec3 = null;

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
    // Crisp dark outline + mint success seal with outer ring
    c.strokeStyle = "rgba(8, 10, 24, 0.85)";
    c.lineWidth = 3.2;
    c.beginPath(); c.arc(cx, cy, r + 0.5, 0, TAU); c.stroke();
    c.fillStyle = COMPASS_VISUAL.sealFill;
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
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
  ctx().font = `bold ${fontSize}px sans-serif`;
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().lineJoin = "round";
  ctx().strokeStyle = "rgba(8, 10, 24, 0.9)";
  ctx().lineWidth = 6;
  ctx().strokeText(hf.text, 0, 0);

  ctx().fillStyle = hf.color;
  ctx().fillText(hf.text, 0, 0);

  ctx().strokeStyle = "rgba(255,255,255,0.6)";
  ctx().lineWidth = 1.5;
  ctx().strokeText(hf.text, 0, 0);

  ctx().restore();
}

export function drawStatusEffects(x, y, kart, time, opts = {}) {
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

  const barW = 110, barH = 14, gap = 4, colGap = 6, padX = 8, padY = 4;
  const cols = effects.length > 4 ? 2 : 1;
  const rows = cols === 2 ? Math.ceil(effects.length / 2) : effects.length;
  const panelW = cols * barW + (cols - 1) * colGap + padX * 2;
  const panelH = rows * (barH + gap) - gap + padY * 2;

  let drawX = opts.alignRight ? (opts.rightEdge != null ? opts.rightEdge - panelW : x - panelW) : x;
  let drawY = opts.stackUp ? (opts.bottomEdge != null ? opts.bottomEdge - panelH : y - panelH) : y;
  if (opts.minTop != null) drawY = Math.max(opts.minTop, drawY);
  drawX = clamp(drawX, 8, Math.max(8, VIEW_W() - panelW - 8));

  ctx().save();
  ctx().translate(drawX, drawY);

  ctx().fillStyle = "rgba(8, 10, 24, 0.72)";
  roundRect(ctx(), 0, 0, panelW, panelH, 10);
  ctx().fill();
  ctx().strokeStyle = "rgba(255,255,255,0.12)";
  ctx().lineWidth = 1;
  roundRect(ctx(), 0.5, 0.5, panelW - 1, panelH - 1, 10);
  ctx().stroke();

  effects.forEach((eff, i) => {
    const colIdx = cols === 2 ? Math.floor(i / rows) : 0;
    const rowIdx = cols === 2 ? (i % rows) : i;
    const ex = padX + colIdx * (barW + colGap);
    const ey = padY + rowIdx * (barH + gap);
    const ratio = clamp(eff.ratio, 0, 1);

    ctx().fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx(), ex, ey, barW, barH, 3);
    ctx().fill();

    const isDebuff = (eff.label === "BLINDED" || eff.label === "SLOWED" || eff.label === "SPINNING" || eff.label === "TETHERED!");
    const pulse = isDebuff ? (0.6 + 0.4 * Math.sin(time * 0.02)) : 1;

    ctx().fillStyle = hexToRgba(eff.color, 0.72 * pulse);
    roundRect(ctx(), ex, ey, barW * ratio, barH, 3);
    ctx().fill();

    if (isDebuff) {
      ctx().strokeStyle = hexToRgba(eff.color, 0.85 * pulse);
      ctx().lineWidth = 1.5;
      roundRect(ctx(), ex, ey, barW, barH, 3);
      ctx().stroke();
    }

    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "left";
    ctx().textBaseline = "middle";
    ctx().fillText(eff.label, ex + 4, ey + barH / 2);
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
  ctx().lineJoin = "round";

  // Headline
  ctx().font = "bold 20px sans-serif";
  ctx().strokeStyle = "rgba(8, 10, 24, 0.9)";
  ctx().lineWidth = 4;
  ctx().strokeText("SUBMISSION REJECTED", cx, y);
  ctx().fillStyle = "#ff3366";
  ctx().fillText("SUBMISSION REJECTED", cx, y);

  // Subline: who we're watching now
  if (t) {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "12px sans-serif";
    const followingKiller = killerName && t.name === killerName;
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 3;
    ctx().strokeText(followingKiller ? "Following your rival" : "Following the leader", cx, y + 20);
    ctx().fillText(followingKiller ? "Following your rival" : "Following the leader", cx, y + 20);
    ctx().font = "bold 16px sans-serif";
    const subLabel = `\u25B6 ${t.name}  (${Math.max(0, t.approvals || 0)} \u2713)`;
    ctx().strokeText(subLabel, cx, y + 40);
    ctx().fillStyle = t.color || "#fff";
    ctx().fillText(subLabel, cx, y + 40);
  }
  ctx().restore();
}

export function drawWrongWay(kart, left, top, width, height, time) {
  if (!kart || !kart.wrongWayTimer || kart.wrongWayTimer < 15) return;
  const alpha = clamp((kart.wrongWayTimer - 15) / 20, 0, 1);
  const blink = Math.sin(time * 0.012) > 0 ? 1 : 0.4;

  ctx().save();
  ctx().globalAlpha = alpha * blink;

  const cx = left + width / 2;
  const cy = top + height * 0.28;

  ctx().fillStyle = "rgba(255, 30, 30, 0.15)";
  ctx().fillRect(left, top, width, height);

  ctx().font = "bold 48px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().lineJoin = "round";
  ctx().strokeStyle = "rgba(15, 4, 10, 0.92)";
  ctx().lineWidth = 7;
  ctx().strokeText("WRONG WAY!", cx, cy);

  ctx().fillStyle = "#ff2222";
  ctx().fillText("WRONG WAY!", cx, cy);

  ctx().strokeStyle = "rgba(255,255,255,0.55)";
  ctx().lineWidth = 1.5;
  ctx().strokeText("WRONG WAY!", cx, cy);

  ctx().font = "bold 16px sans-serif";
  ctx().strokeStyle = "rgba(15, 4, 10, 0.85)";
  ctx().lineWidth = 3.5;
  ctx().strokeText("Turn around!", cx, cy + 36);
  ctx().fillStyle = "#ffaaaa";
  ctx().fillText("Turn around!", cx, cy + 36);

  ctx().restore();
}

export function drawPositionChange(x, y, kart) {
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

  ctx().fillStyle = "rgba(8, 10, 24, 0.88)";
  roundRect(ctx(), -60, -16, 120, 32, 8);
  ctx().fill();
  ctx().strokeStyle = color;
  ctx().lineWidth = 1.8;
  roundRect(ctx(), -60, -16, 120, 32, 8);
  ctx().stroke();

  ctx().font = "bold 18px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().strokeStyle = "rgba(8, 10, 24, 0.9)";
  ctx().lineWidth = 3;
  ctx().strokeText(text, 0, 0);
  ctx().fillStyle = color;
  ctx().fillText(text, 0, 0);

  ctx().restore();
}

export function drawItemNamePopup(x, y, kart, time) {
  if (!kart || !kart.itemNamePopup || kart.itemNamePopup.timer <= 0) return;
  const pop = kart.itemNamePopup;
  const alpha = clamp(pop.timer / 15, 0, 1) * clamp((pop.maxTimer - pop.timer) / 5, 0, 1);

  ctx().save();
  ctx().globalAlpha = alpha;
  ctx().font = "bold 11px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "top";
  ctx().lineJoin = "round";
  ctx().strokeStyle = "rgba(8, 10, 24, 0.92)";
  ctx().lineWidth = 3;
  ctx().strokeText(pop.name, x, y);
  ctx().fillStyle = pop.color;
  ctx().fillText(pop.name, x, y);
  ctx().restore();
}

export function drawApprovals3DOverlay(arg1, arg2, arg3, arg4 = 0, arg5 = 0, arg6 = 0, arg7 = 0) {
  if (!isBattleMode() || !window.THREE) return;
  let c, time, camera, viewW, viewH, vx, vy;
  if (arg1 && typeof arg1.save === "function") {
    c = arg1;
    time = arg2 || 0;
    camera = arg3 || THREE_STATE.camera;
    viewW = arg4 || VIEW_W();
    viewH = arg5 || VIEW_H();
    vx = arg6 || 0;
    vy = arg7 || 0;
  } else {
    c = ctx();
    camera = arg1 || THREE_STATE.camera;
    viewW = arg2 ?? VIEW_W();
    viewH = arg3 ?? VIEW_H();
    vx = arg4 || 0;
    vy = arg5 || 0;
    time = arg6 || (game.raceTime || 0) * 1000;
  }
  if (!c || !camera) return;
  if (!_approvalProjVec3) _approvalProjVec3 = new THREE.Vector3();

  c.save();
  c.beginPath();
  c.rect(vx, vy, viewW, viewH);
  c.clip();
  for (const k of getActiveKarts()) {
    if (!k || k.eliminated) continue;
    const n = k.approvals || 0;
    if (n <= 0) continue;
    _approvalProjVec3.set(k.x, 52 + (k.z || 0), k.y);
    _approvalProjVec3.project(camera);
    if (_approvalProjVec3.z > 1) continue; // behind the camera
    const sx = vx + (_approvalProjVec3.x * 0.5 + 0.5) * viewW;
    const sy = vy + (-_approvalProjVec3.y * 0.5 + 0.5) * viewH;
    drawApprovalSeals(c, sx, sy, n, time, 7);
  }
  c.restore();
}

export function drawFinishBanner(time = (game.raceTime || 0) * 1000) {
  ctx().save();
  ctx().translate(VIEW_W() / 2, VIEW_H() / 2);

  // Pulsing scale based on simulation/frame time
  const t = time * 0.005;
  const scale = 1.0 + Math.sin(t) * 0.06;
  ctx().scale(scale, scale);

  // Glassmorphic backing bar
  ctx().fillStyle = "rgba(10, 8, 30, 0.78)";
  ctx().strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx().lineWidth = 2.5;

  const bw = 550, bh = 110;
  roundRect(ctx(), -bw / 2, -bh / 2, bw, bh, 18);
  ctx().fill();
  ctx().stroke();

  // Crisp outlined gold text
  ctx().font = "bold 72px sans-serif";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  ctx().lineJoin = "round";
  ctx().strokeStyle = "rgba(10, 8, 30, 0.94)";
  ctx().lineWidth = 8;
  ctx().strokeText("FINISH!", 0, 0);
  ctx().fillStyle = "#ffd86b";
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

export function drawDriftBar(x, y, w, h, kart, compact = false) {
  if (!kart || kart.driftCharge <= 5) return;
  const c = ctx();
  c.save();

  const charge = clamp(kart.driftCharge / TUNING.DRIFT_TIER3, 0, 1);
  let col = "#57f2ff"; // Tier 1
  if (kart.driftCharge >= TUNING.DRIFT_TIER3) col = "#ff4d6d"; // Tier 3
  else if (kart.driftCharge >= TUNING.DRIFT_TIER2) col = "#fd9927"; // Tier 2

  c.fillStyle = "rgba(8, 10, 24, 0.78)";
  roundRect(c, x - 2, y - 2, w + 4, h + 4, 4);
  c.fill();

  c.fillStyle = col;
  roundRect(c, x, y, w * charge, h, 3);
  c.fill();

  // Drift tier notch markers (T1, T2, T3)
  const tiers = [
    { frac: TUNING.DRIFT_TIER1 / TUNING.DRIFT_TIER3, threshold: TUNING.DRIFT_TIER1, label: "T1", color: "#57f2ff" },
    { frac: TUNING.DRIFT_TIER2 / TUNING.DRIFT_TIER3, threshold: TUNING.DRIFT_TIER2, label: "T2", color: "#fd9927" },
    { frac: 1.0, threshold: TUNING.DRIFT_TIER3, label: "T3", color: "#ff4d6d" },
  ];

  for (const t of tiers) {
    const nx = x + w * t.frac;
    const reached = kart.driftCharge >= t.threshold;
    c.fillStyle = reached ? t.color : "rgba(255, 255, 255, 0.45)";
    c.fillRect(nx - 1, y - 2, 2, h + 4);
    if (!compact) {
      c.font = "bold 8px monospace";
      c.textAlign = t.frac >= 1 ? "right" : "center";
      c.textBaseline = "top";
      c.fillStyle = reached ? t.color : "rgba(255, 255, 255, 0.45)";
      c.fillText(t.label, t.frac >= 1 ? nx : nx, y + h + 3);
    }
  }

  c.strokeStyle = col;
  c.lineWidth = 1.2;
  roundRect(c, x - 1, y - 1, w + 2, h + 2, 3);
  c.stroke();

  c.font = compact ? "bold 9px sans-serif" : "bold 10px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "bottom";
  c.strokeStyle = "rgba(8, 10, 24, 0.9)";
  c.lineWidth = 3;
  const label = kart.driftCharge >= TUNING.DRIFT_TIER3
    ? "ULTRA TURBO"
    : kart.driftCharge >= TUNING.DRIFT_TIER2
      ? "SUPER TURBO"
      : kart.driftCharge >= TUNING.DRIFT_TIER1
        ? "MINI TURBO"
        : "CHARGING";
  c.strokeText(label, x + w / 2, y - 3);
  c.fillStyle = col;
  c.fillText(label, x + w / 2, y - 3);

  c.restore();
}

export function drawBoostSpeedLines(c, left, top, width, height, time, intensity = 1) {
  if (!c || width <= 0 || height <= 0 || intensity <= 0.01) return;
  const inten = clamp(intensity, 0, 1.5);
  const cx = left + width / 2;
  const cy = top + height / 2;
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);

  c.save();
  c.beginPath();
  c.rect(left, top, width, height);
  c.clip();

  // Subtle warm/cyan edge glow during boost / high speed
  const edgeGrad = c.createRadialGradient(cx, cy, minDim * 0.34, cx, cy, maxDim * 0.72);
  edgeGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
  edgeGrad.addColorStop(0.65, `rgba(87, 242, 255, ${0.05 * inten})`);
  edgeGrad.addColorStop(1, `rgba(253, 153, 39, ${0.18 * inten})`);
  c.fillStyle = edgeGrad;
  c.fillRect(left, top, width, height);

  // Crisp radial streak lines
  const count = 20;
  const innerBase = minDim * 0.32;
  const span = maxDim * 0.42;
  c.lineCap = "round";

  for (let i = 0; i < count; i++) {
    const ang = (i / count) * TAU + Math.sin(time * 0.0018 + i) * 0.05 + time * 0.0004;
    const phase = ((time * 0.0042 + i * 0.37) % 1);
    const r1 = innerBase + phase * span * 0.55;
    const len = 36 + (i % 3) * 24 + phase * 32;
    const r2 = r1 + len;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const alpha = (1 - phase) * 0.45 * inten;
    if (alpha <= 0.02) continue;

    c.strokeStyle = i % 3 === 0
      ? `rgba(87, 242, 255, ${alpha})`
      : i % 3 === 1
        ? `rgba(255, 224, 140, ${alpha})`
        : `rgba(255, 255, 255, ${alpha * 0.9})`;
    c.lineWidth = i % 2 === 0 ? 2 : 1.3;
    c.beginPath();
    c.moveTo(cx + cos * r1, cy + sin * r1);
    c.lineTo(cx + cos * r2, cy + sin * r2);
    c.stroke();
  }

  c.restore();
}

export function drawRearThreatIndicator(c, kart, left, top, width, height, time) {
  if (!c || !kart || kart.eliminated) return;

  const sources = [
    game.track && game.track.projectiles,
    game.track && game.track.dragonProjectiles,
    game.hazards,
  ];

  const fx = Math.cos(kart.heading);
  const fy = Math.sin(kart.heading);
  let bestUrgency = 0;
  let bestLateral = 0;

  for (const list of sources) {
    if (!list || !list.length) continue;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.active === false) continue;
      const isProjectile = list !== game.hazards ||
        p.kind === "regulatory_projectile" ||
        p.constructor?.name === "DossierProjectile" ||
        p.constructor?.name === "RegulatoryProjectile";
      if (!isProjectile) continue;
      if (p.owner === kart && (p.ignoreOwnerTimer || 0) > 0) continue;

      const dx = p.x - kart.x;
      const dy = p.y - kart.y;
      const d = Math.hypot(dx, dy);
      if (d <= 1 || d > 420) continue;

      const ux = dx / d;
      const uy = dy / d;
      // Must be behind the kart
      const dotForward = ux * fx + uy * fy;
      if (dotForward > -0.15) continue;

      const pvx = p.vx != null ? p.vx : Math.cos(p.heading || 0) * (p.speed || 0);
      const pvy = p.vy != null ? p.vy : Math.sin(p.heading || 0) * (p.speed || 0);
      const relVx = pvx - (kart.vx || 0);
      const relVy = pvy - (kart.vy || 0);
      // Closing speed toward kart: -ux, -uy is from projectile to kart
      const closing = relVx * (-ux) + relVy * (-uy);
      if (closing <= 0.5) continue;

      const urgency = 1 - d / 420;
      if (urgency > bestUrgency) {
        bestUrgency = urgency;
        bestLateral = fx * uy - fy * ux;
      }
    }
  }

  if (bestUrgency <= 0) return;

  const pulse = 0.55 + 0.45 * Math.sin(time * 0.024);
  const wx = clamp(left + width / 2 + clamp(-bestLateral, -0.75, 0.75) * (width * 0.25), left + 36, left + width - 36);
  const wy = top + height - 28;
  const sz = 12 + bestUrgency * 4;

  c.save();
  c.beginPath();
  c.rect(left, top, width, height);
  c.clip();

  // Subtle bottom edge red warning glow
  const g = c.createLinearGradient(0, top + height - 42, 0, top + height);
  g.addColorStop(0, "rgba(255, 30, 60, 0)");
  g.addColorStop(1, `rgba(255, 30, 60, ${(0.18 + bestUrgency * 0.16) * pulse})`);
  c.fillStyle = g;
  c.fillRect(left, top + height - 42, width, 42);

  // Pulsing red warning chevron
  c.translate(wx, wy);
  const scale = 0.92 + pulse * 0.14;
  c.scale(scale, scale);

  c.beginPath();
  c.moveTo(0, -sz);
  c.lineTo(sz * 0.95, sz * 0.72);
  c.lineTo(0, sz * 0.34);
  c.lineTo(-sz * 0.95, sz * 0.72);
  c.closePath();

  c.strokeStyle = "rgba(8, 10, 24, 0.92)";
  c.lineWidth = 4;
  c.lineJoin = "round";
  c.stroke();

  c.fillStyle = `rgba(255, 51, 85, ${0.75 + 0.25 * pulse})`;
  c.fill();

  c.strokeStyle = "#ffd86b";
  c.lineWidth = 1.4;
  c.stroke();

  c.fillStyle = "#ffffff";
  c.font = "bold 9px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("!", 0, 0);

  c.restore();
}

export function drawHUD(time) {
  if (!game.player) return;
  ctx().save();

  const vw = VIEW_W();
  const vh = VIEW_H();
  const battle = isBattleMode();
  const dragon = isDragonEscape();
  const hasBest = !battle && !dragon && game.mapRecordCache && Number.isFinite(game.mapRecordCache.bestTotal);
  const topLeftW = hasBest ? 316 : (battle ? 244 : 228);

  // Top-left: Lap/Distance, Position, Time
  drawHUDPanel(20, 20, topLeftW, 102, () => {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "11px sans-serif";
    ctx().textAlign = "left"; ctx().textBaseline = "top";
    if (battle) {
      const appr = game.player.approvals || 0;
      ctx().fillText("APPROVALS", 18, 12);
      if (appr <= 0) {
        ctx().fillStyle = "#ff3366";
        ctx().font = "bold 16px sans-serif";
        ctx().fillText("REJECTED", 18, 28);
      } else {
        const cap = appr > 5 ? 4 : appr;
        for (let i = 0; i < cap; i++) {
          const sx = 24 + i * 18;
          ctx().fillStyle = COMPASS_VISUAL.sealFill;
          ctx().beginPath(); ctx().arc(sx, 33, 6.5, 0, TAU); ctx().fill();
          ctx().strokeStyle = COMPASS_VISUAL.sealRing;
          ctx().lineWidth = 1.2;
          ctx().stroke();
          ctx().fillStyle = COMPASS_VISUAL.sealMark;
          ctx().font = "bold 8.5px sans-serif";
          ctx().fillText("✓", sx - 3.5, 29);
        }
        if (appr > 5) {
          ctx().fillStyle = "#ffd86b";
          ctx().font = "bold 13px 'SFMono-Regular', Consolas, monospace";
          ctx().fillText(`×${appr}`, 24 + cap * 18 - 4, 27);
        }
      }

      const untimed = isUntimedHumanBattle();
      const tl = untimed ? game.battleDuration : Math.max(0, game.battleTimeLeft || 0);
      ctx().fillStyle = !untimed && tl < 15 ? "#ff4d6d" : "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("TIME LEFT", 134, 12);
      ctx().fillStyle = !untimed && tl < 15 ? "#ff4d6d" : "#fff";
      ctx().font = "bold 20px 'SFMono-Regular', Consolas, monospace";
      ctx().fillText(untimed ? "∞" : formatTime(tl), 134, 29);

      const aliveCount = getActiveKarts().filter((k) => k && !k.eliminated).length;
      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("SURVIVORS", 18, 58);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 22px sans-serif";
      ctx().fillText(`${aliveCount} / ${game.totalRacers}`, 18, 72);
    } else if (dragon) {
      ctx().fillText("DISTANCE", 18, 12);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 22px 'SFMono-Regular', Consolas, monospace";
      const distKm = (game.player.x / 1000).toFixed(1);
      ctx().fillText(`${distKm} km`, 18, 26);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("SURVIVAL", 126, 12);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 20px 'SFMono-Regular', Consolas, monospace";
      ctx().fillText(formatTime(game.raceTime), 126, 29);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("POSITION", 18, 58);
      ctx().fillStyle = positionColor(game.hudPosition);
      ctx().font = "bold 22px sans-serif";
      ctx().fillText(`${ordinal(game.hudPosition)} / ${game.totalRacers}`, 18, 72);
    } else {
      ctx().fillText("LAP", 18, 12);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 26px sans-serif";
      ctx().fillText(`${Math.min(game.player.lap + 1, getTotalLaps())} / ${getTotalLaps()}`, 18, 25);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("TIME", 124, 12);
      ctx().fillStyle = "#fff";
      ctx().font = "bold 20px 'SFMono-Regular', Consolas, monospace";
      ctx().fillText(formatTime(game.raceTime), 124, 29);

      if (hasBest) {
        ctx().fillStyle = "#ffd86b";
        ctx().font = "11px sans-serif";
        ctx().fillText("BEST", 224, 12);
        ctx().font = "bold 17px 'SFMono-Regular', Consolas, monospace";
        ctx().fillText(formatTime(game.mapRecordCache.bestTotal), 224, 30);
      }

      ctx().fillStyle = "#a8acd0";
      ctx().font = "11px sans-serif";
      ctx().fillText("POSITION", 18, 58);
      ctx().fillStyle = positionColor(game.hudPosition);
      ctx().font = "bold 22px sans-serif";
      ctx().fillText(`${ordinal(game.hudPosition)} / ${game.totalRacers}`, 18, 72);
    }
  });

  // Top-right: Coins / Item Roulette slot
  drawHUDPanel(vw - 220 - 20, 20, 220, 102, () => {
    ctx().fillStyle = "#a8acd0";
    ctx().font = "11px sans-serif";
    ctx().textAlign = "left"; ctx().textBaseline = "top";
    ctx().fillText("CITATIONS", 18, 12);

    // Coin icon
    ctx().fillStyle = "#ffd86b";
    ctx().beginPath(); ctx().arc(28, 44, 9, 0, TAU); ctx().fill();
    ctx().fillStyle = "#a87a13";
    ctx().beginPath(); ctx().arc(28, 44, 5, 0, TAU); ctx().fill();
    ctx().fillStyle = "#fff";
    ctx().font = "bold 22px sans-serif";
    ctx().fillText(`${game.player.coinsCollected}`, 50, 34);

    ctx().fillStyle = "#a8acd0";
    ctx().font = "11px sans-serif";
    ctx().fillText("ITEM", 132, 12);
  });

  // Draw the Item Slot panel cleanly below the ITEM label inside the top-right panel
  drawItemSlot(vw - 20 - 88, 48, 64, game.player, time);

  // Responsive bottom HUD layout (1P)
  const narrow = vw < 680;
  const speedoSize = narrow ? (vw < 520 ? 104 : 118) : 140;
  const mapSize = narrow ? (vw < 520 ? 120 : 144) : 180;
  const speedoX = narrow ? 16 : 20;
  const speedoY = vh - speedoSize - (narrow ? 16 : 20);
  const mapX = vw - mapSize - (narrow ? 16 : 20);
  const mapY = vh - mapSize - (narrow ? 16 : 20);

  // Bottom-left: Speedometer
  drawSpeedo(speedoX, speedoY, speedoSize, game.player, time);

  // Bottom-right: Mini-map
  drawMinimap(mapX, mapY, mapSize);

  // Center bottom: Drift charge bar & Ultimate meter (responsive)
  const gapLeft = speedoX + speedoSize + 10;
  const gapRight = mapX - 10;
  const availGap = gapRight - gapLeft;
  const liftBars = narrow && availGap < 110;
  const barW = liftBars ? Math.min(160, vw - 40) : Math.min(160, Math.max(104, availGap));
  const barX = liftBars ? (vw - barW) / 2 : gapLeft + (availGap - barW) / 2;
  const driftY = liftBars ? Math.min(speedoY, mapY) - 22 : vh - 32;
  const ultY = liftBars ? driftY - 24 : vh - 56;

  drawDriftBar(barX, driftY, barW, 8, game.player, narrow);
  drawUltimateMeter(barX, ultY, Math.min(140, barW), game.player, time);

  // Regulaido Autopilot Active Watermark Panel (top-center, crisp dark stroke)
  const wmW = vw < 720 ? 176 : 200, wmH = 24;
  const wmX = (vw - wmW) / 2, wmY = 20;

  ctx().save();
  ctx().fillStyle = "rgba(13, 11, 33, 0.82)";
  ctx().strokeStyle = "rgba(4, 3, 14, 0.9)";
  ctx().lineWidth = 2.5;
  ctx().beginPath();
  roundRect(ctx(), wmX, wmY, wmW, wmH, 5);
  ctx().stroke();
  ctx().fill();
  ctx().strokeStyle = "#7b75ff";
  ctx().lineWidth = 1;
  ctx().stroke();
  ctx().restore();

  ctx().fillStyle = "#ffffff";
  ctx().font = "bold 9px monospace";
  ctx().textAlign = "center";
  ctx().textBaseline = "middle";
  const dotPulse = Math.sin(time * 0.005) > 0 ? "●" : " ";
  ctx().fillStyle = "#a4ff80"; // Mint Green
  ctx().fillText(dotPulse, wmX + 18, wmY + wmH / 2);
  ctx().fillStyle = "#ffffff";
  ctx().fillText(vw < 720 ? "AUTOPILOT ACTIVE" : "REGULAIDO AUTOPILOT ACTIVE", wmX + wmW / 2 + 6, wmY + wmH / 2);

  // Mute / P2P badges top-right below top-right panel
  let badgesBottom = 122;
  if (Sound.muted) {
    ctx().fillStyle = "rgba(0,0,0,0.55)";
    ctx().fillRect(vw - 70, 130, 56, 22);
    ctx().fillStyle = "#fff";
    ctx().font = "bold 11px sans-serif";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText("MUTED", vw - 42, 141);
    badgesBottom = 154;
  }

  if (game.p2pMode && game.p2pPing > 0) {
    const pingY = Sound.muted ? 158 : 130;
    const pingColor = game.p2pPing < 60 ? "#a4ff80" : game.p2pPing < 120 ? "#ffd86b" : "#ff4d6d";
    ctx().fillStyle = "rgba(0,0,0,0.55)";
    ctx().fillRect(vw - 82, pingY, 68, 20);
    ctx().fillStyle = pingColor;
    ctx().font = "bold 10px monospace";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText(`${game.p2pPing}ms`, vw - 48, pingY + 10);
    badgesBottom = pingY + 22;
  }

  if (game.p2pConnectionUnstable) {
    const unstableY = (game.p2pMode && game.p2pPing > 0) ? (Sound.muted ? 184 : 156) : (Sound.muted ? 158 : 130);
    ctx().fillStyle = "rgba(0,0,0,0.55)";
    ctx().fillRect(vw - 152, unstableY, 138, 20);
    ctx().fillStyle = "#ffd86b";
    ctx().font = "bold 9px monospace";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText("CONNECTION UNSTABLE", vw - 83, unstableY + 10);
    badgesBottom = unstableY + 22;
  }

  // Active status effects panel (right-aligned, stacked upwards safely above minimap)
  drawStatusEffects(vw - 20, mapY - 12, game.player, time, {
    alignRight: true,
    rightEdge: vw - 20,
    stackUp: true,
    bottomEdge: mapY - 12,
    minTop: badgesBottom + 8,
  });

  // Rear projectile threat warning chevron
  drawRearThreatIndicator(ctx(), game.player, 0, 0, vw, vh, time);

  // Hit flash overlay
  drawHitFlash(game.player, 0, 0, vw, vh, time);

  // Battle spectator banner: shown after you're rejected while you watch the kill chain play out
  if (battle && game.player && game.player.eliminated) {
    drawSpectateBanner(vw / 2, 70, time);
  }

  // Wrong-way overlay
  drawWrongWay(game.player, 0, 0, vw, vh, time);

  // Position change callout
  drawPositionChange(vw / 2, vh * 0.18, game.player);

  // Item name popup
  drawItemNamePopup(vw - 20 - 55, 118, game.player, time);

  ctx().restore();
}

export function drawItemSlot(x, y, size, kart, time) {
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
    drawItemIcon(size / 2, size / 2, size * 0.55, item, time);
  } else if (kart.itemState === "active" && kart.itemSlot) {
    drawItemIcon(size / 2, size / 2, size * 0.6, kart.itemSlot, time);

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

export function drawItemIcon(cx, cy, sz, item, time) {
  ctx().save();
  ctx().translate(cx, cy);

  if (item === "boost") {
    ctx().beginPath();
    ctx().moveTo(0, -sz / 2);
    ctx().lineTo(sz / 2, sz / 2 - 2);
    ctx().lineTo(0, sz / 4);
    ctx().lineTo(-sz / 2, sz / 2 - 2);
    ctx().closePath();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 3;
    ctx().stroke();
    ctx().fillStyle = "#fd9927";
    ctx().fill();
  } else if (item === "shield") {
    ctx().beginPath();
    ctx().moveTo(0, -sz / 2);
    ctx().lineTo(sz / 2 - 2, -sz / 4);
    ctx().quadraticCurveTo(sz / 2 - 2, sz / 4, 0, sz / 2);
    ctx().quadraticCurveTo(-sz / 2 + 2, sz / 4, -sz / 2 + 2, -sz / 4);
    ctx().closePath();
    ctx().fillStyle = "rgba(87, 242, 255, 0.28)";
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#57f2ff";
    ctx().lineWidth = 2.4;
    ctx().stroke();
  } else if (item === "handling") {
    ctx().save();
    ctx().rotate(time * 0.003);

    ctx().beginPath();
    ctx().arc(0, 0, sz / 3, 0, TAU);
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4.2;
    ctx().stroke();
    ctx().strokeStyle = "#a4ff80";
    ctx().lineWidth = 2.5;
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
    ctx().fillStyle = "rgba(255, 77, 109, 0.28)";
    ctx().beginPath();
    ctx().rect(-sz / 2, -sz / 2, sz, sz);
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 3.5;
    ctx().stroke();
    ctx().strokeStyle = "#ff4d6d";
    ctx().lineWidth = 2;
    ctx().stroke();

    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("Err", 0, 0);
  } else if (item === "placebo") {
    ctx().fillStyle = "rgba(255, 204, 0, 0.28)";
    roundRect(ctx(), -sz * 0.48, -sz * 0.22, sz * 0.96, sz * 0.44, sz * 0.22);
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#ffcc00";
    ctx().lineWidth = 2.4;
    ctx().stroke();
    ctx().beginPath();
    ctx().moveTo(0, -sz * 0.2);
    ctx().lineTo(0, sz * 0.2);
    ctx().stroke();
    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillText("Rx", -sz * 0.18, 0);
  } else if (item === "doubleblind") {
    ctx().fillStyle = "rgba(189, 87, 255, 0.28)";
    ctx().beginPath();
    ctx().arc(0, 0, sz * 0.42, 0, TAU);
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#bd57ff";
    ctx().lineWidth = 2.4;
    ctx().stroke();
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
    ctx().fillStyle = "rgba(87, 242, 255, 0.28)";
    ctx().beginPath();
    ctx().rect(-sz / 2, -sz * 0.35, sz, sz * 0.7);
    ctx().moveTo(-sz / 2, -sz * 0.35);
    ctx().lineTo(-sz / 2, -sz / 2);
    ctx().lineTo(-sz / 8, -sz / 2);
    ctx().lineTo(0, -sz * 0.35);
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#57f2ff";
    ctx().lineWidth = 2.4;
    ctx().stroke();

    ctx().strokeStyle = "rgba(255, 255, 255, 0.85)";
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
    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.12, 0, TAU);
    ctx().fillStyle = "#ff3366";
    ctx().fill();

    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.3, Math.PI * 1.2, Math.PI * 1.8);
    ctx().stroke();
    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.52, Math.PI * 1.25, Math.PI * 1.75);
    ctx().stroke();

    ctx().strokeStyle = "#ff3366";
    ctx().lineWidth = 2.4;
    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.3, Math.PI * 1.2, Math.PI * 1.8);
    ctx().stroke();
    ctx().beginPath();
    ctx().arc(0, sz * 0.15, sz * 0.52, Math.PI * 1.25, Math.PI * 1.75);
    ctx().stroke();
  } else if (item === "mergerequest") {
    ctx().beginPath();
    ctx().moveTo(-sz * 0.35, -sz * 0.3);
    ctx().lineTo(-sz * 0.5, 0);
    ctx().lineTo(-sz * 0.35, sz * 0.3);

    ctx().moveTo(sz * 0.35, -sz * 0.3);
    ctx().lineTo(sz * 0.5, 0);
    ctx().lineTo(sz * 0.35, sz * 0.3);

    ctx().moveTo(0, -sz * 0.25);
    ctx().lineTo(0, sz * 0.25);
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#39ff14";
    ctx().lineWidth = 2.4;
    ctx().stroke();

    ctx().fillStyle = "#39ff14";
    ctx().beginPath();
    ctx().moveTo(-sz * 0.15, sz * 0.08);
    ctx().lineTo(0, sz * 0.25);
    ctx().lineTo(sz * 0.15, sz * 0.08);
    ctx().closePath();
    ctx().fill();
  } else if (item === "hotfix") {
    const pulse = 0.65 + 0.35 * Math.sin(time * 0.008);
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
    ctx().fillStyle = `rgba(255, 200, 0, ${pulse})`;
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#ffcc00";
    ctx().lineWidth = 2.4;
    ctx().stroke();
  } else if (item === "fasttrack") {
    ctx().beginPath();
    ctx().moveTo(-sz * 0.42, sz * 0.2);
    ctx().lineTo(-sz * 0.12, -sz * 0.42);
    ctx().lineTo(sz * 0.38, -sz * 0.42);
    ctx().lineTo(sz * 0.1, sz * 0.04);
    ctx().lineTo(sz * 0.42, sz * 0.04);
    ctx().lineTo(-sz * 0.1, sz * 0.46);
    ctx().closePath();
    ctx().fillStyle = "rgba(164, 255, 128, 0.25)";
    ctx().fill();
    ctx().strokeStyle = "rgba(8, 10, 24, 0.85)";
    ctx().lineWidth = 4;
    ctx().stroke();
    ctx().strokeStyle = "#a4ff80";
    ctx().lineWidth = 2.4;
    ctx().stroke();
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

  const vw = VIEW_W();
  const vh = VIEW_H();
  const battle = isBattleMode();
  const dragon = isDragonEscape();
  const narrow = vw < 720;
  const panelW = narrow ? 172 : 185;

  const ranking = uiRuntime.rankAll();
  const p1Pos = ranking.indexOf(game.player) + 1;
  const p2Pos = ranking.indexOf(game.player2) + 1;
  const aliveCount = battle ? getActiveKarts().filter((k) => k && !k.eliminated).length : 0;

  const drawPlayerBattleOrRacePanel = (kart, pos, isRight) => {
    const px = isRight ? vw - panelW - 15 : 15;
    drawHUDPanel(px, 15, panelW, 114, () => {
      ctx().fillStyle = "#a8acd0";
      ctx().font = "10px sans-serif";
      ctx().textAlign = "left"; ctx().textBaseline = "top";

      if (battle) {
        const appr = kart.approvals || 0;
        ctx().fillText("APPROVALS", 12, 10);
        if (kart.eliminated || appr <= 0) {
          ctx().fillStyle = "rgba(255, 51, 102, 0.22)";
          roundRect(ctx(), 12, 24, 78, 18, 4);
          ctx().fill();
          ctx().strokeStyle = "#ff3366";
          ctx().lineWidth = 1;
          ctx().stroke();
          ctx().fillStyle = "#ff4d6d";
          ctx().font = "bold 10px sans-serif";
          ctx().fillText("ELIMINATED", 17, 28);
        } else {
          const cap = appr > 5 ? 4 : appr;
          for (let i = 0; i < cap; i++) {
            const sx = 18 + i * 16;
            ctx().fillStyle = COMPASS_VISUAL.sealFill;
            ctx().beginPath(); ctx().arc(sx, 31, 5.5, 0, TAU); ctx().fill();
            ctx().strokeStyle = COMPASS_VISUAL.sealRing;
            ctx().lineWidth = 1.1;
            ctx().stroke();
            ctx().fillStyle = COMPASS_VISUAL.sealMark;
            ctx().font = "bold 7.5px sans-serif";
            ctx().fillText("✓", sx - 3, 27);
          }
          if (appr > 5) {
            ctx().fillStyle = "#ffd86b";
            ctx().font = "bold 11px monospace";
            ctx().fillText(`×${appr}`, 18 + cap * 16 - 3, 25);
          }
        }
      } else if (dragon) {
        ctx().fillText("DIST", 12, 10);
        ctx().fillStyle = "#fff";
        ctx().font = "bold 18px 'SFMono-Regular', Consolas, monospace";
        ctx().fillText(`${(kart.x / 1000).toFixed(1)}km`, 12, 22);
      } else {
        ctx().fillText("LAP", 12, 10);
        ctx().fillStyle = "#fff";
        ctx().font = "bold 20px sans-serif";
        ctx().fillText(`${Math.min(kart.lap + 1, getTotalLaps())} / ${getTotalLaps()}`, 12, 22);
      }

      ctx().fillStyle = "#a8acd0";
      ctx().font = "10px sans-serif";
      ctx().fillText("CITATIONS", 12, 54);
      ctx().fillStyle = "#ffd86b";
      ctx().font = "bold 18px sans-serif";
      ctx().fillText(`${kart.coinsCollected}`, 12, 66);

      ctx().fillStyle = "#a8acd0";
      ctx().font = "10px sans-serif";
      const rightColX = narrow ? 100 : 110;
      if (battle) {
        ctx().fillText("STATUS", rightColX, 10);
        ctx().fillStyle = kart.eliminated ? "#ff4d6d" : "#a4ff80";
        ctx().font = "bold 15px sans-serif";
        ctx().fillText(kart.eliminated ? "OUT" : "ALIVE", rightColX, 24);
      } else {
        ctx().fillText("POS", rightColX, 10);
        ctx().fillStyle = positionColor(pos);
        ctx().font = "bold 20px sans-serif";
        ctx().fillText(`${ordinal(pos)}`, rightColX, 22);
      }

      ctx().fillStyle = "#a8acd0";
      ctx().font = "10px sans-serif";
      ctx().fillText("ITEM", rightColX, 46);
    });
    drawItemSlot(px + (narrow ? 96 : 105), 74, 44, kart, time);
  };

  // 1. Player 1 & Player 2 Top Panels
  drawPlayerBattleOrRacePanel(game.player, p1Pos, false);
  drawPlayerBattleOrRacePanel(game.player2, p2Pos, true);

  // Shared Battle Time Left + Alive count pill (top-center)
  if (battle) {
    const untimed = isUntimedHumanBattle();
    const tl = untimed ? game.battleDuration : Math.max(0, game.battleTimeLeft || 0);
    const lowTime = !untimed && tl < 15;
    const bw = 178, bh = 24;
    const bx = vw / 2 - bw / 2, by = 66;
    ctx().save();
    ctx().fillStyle = "rgba(10, 12, 28, 0.86)";
    roundRect(ctx(), bx, by, bw, bh, 6);
    ctx().fill();
    ctx().strokeStyle = lowTime ? "#ff4d6d" : COMPASS_VISUAL.hudBorder;
    ctx().lineWidth = 1.2;
    ctx().stroke();
    ctx().font = "bold 10px 'SFMono-Regular', Consolas, monospace";
    ctx().textAlign = "center";
    ctx().textBaseline = "middle";
    ctx().fillStyle = lowTime ? "#ff4d6d" : "#fff";
    const tStr = untimed ? "∞" : formatTime(tl);
    ctx().fillText(`TIME ${tStr}  |  ALIVE ${aliveCount}/${game.totalRacers}`, vw / 2, by + bh / 2);
    ctx().restore();
  }

  // Responsive Bottom HUD (Speedos, Central Minimap, Drift & Ultimate bars)
  const mapSize = narrow ? clamp(Math.floor(vw * 0.19), 96, 130) : 150;
  const mapX = vw / 2 - mapSize / 2;
  const mapY = vh - mapSize - 15;
  const speedoSize = narrow ? 104 : 120;
  const speedoY = vh - speedoSize - 15;

  drawSpeedo(15, speedoY, speedoSize, game.player, time);
  drawSpeedo(vw - 15 - speedoSize, speedoY, speedoSize, game.player2, time);
  drawMinimap(mapX, mapY, mapSize);

  // Ultimate meters cleanly above each speedometer
  drawUltimateMeter(15, speedoY - 18, speedoSize, game.player, time);
  drawUltimateMeter(vw - 15 - speedoSize, speedoY - 18, speedoSize, game.player2, time);

  // Drift charge bars (never overlap minimap on narrow widths < 720px)
  const gapP1 = mapX - (15 + speedoSize + 14);
  if (gapP1 >= 76) {
    const dw = Math.min(120, gapP1);
    drawDriftBar(15 + speedoSize + 7, vh - 26, dw, 6, game.player, true);
    drawDriftBar(vw - 15 - speedoSize - 7 - dw, vh - 26, dw, 6, game.player2, true);
  } else {
    drawDriftBar(15, speedoY - 36, speedoSize, 6, game.player, true);
    drawDriftBar(vw - 15 - speedoSize, speedoY - 36, speedoSize, 6, game.player2, true);
  }

  // Regulaido Autopilot Active Watermark (top-center below split border)
  const wmW = 180, wmH = 20;
  const wmX = (vw - wmW) / 2, wmY = 40;

  ctx().save();
  ctx().fillStyle = "rgba(13, 11, 33, 0.85)";
  ctx().strokeStyle = "rgba(4, 3, 14, 0.9)";
  ctx().lineWidth = 2.5;
  ctx().beginPath();
  roundRect(ctx(), wmX, wmY, wmW, wmH, 4);
  ctx().stroke();
  ctx().fill();
  ctx().strokeStyle = "#7b75ff";
  ctx().lineWidth = 1;
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

  // Active status effects panels (stacked cleanly above speedometers)
  drawStatusEffects(15, speedoY - 46, game.player, time, {
    stackUp: true,
    bottomEdge: speedoY - 46,
    minTop: 126,
  });
  drawStatusEffects(vw - 15, speedoY - 46, game.player2, time, {
    alignRight: true,
    rightEdge: vw - 15,
    stackUp: true,
    bottomEdge: speedoY - 46,
    minTop: 126,
  });

  // Per-player hit flash, rear threat, wrong-way, and position callouts (clipped to each viewport)
  const p1W = vw / 2 - 2;
  const p2W = vw / 2 - 2;
  const p2X = vw / 2 + 2;
  drawRearThreatIndicator(ctx(), game.player, 0, 0, p1W, vh, time);
  drawRearThreatIndicator(ctx(), game.player2, p2X, 0, p2W, vh, time);

  drawHitFlash(game.player, 0, 0, p1W, vh, time);
  drawHitFlash(game.player2, p2X, 0, p2W, vh, time);

  // Wrong-way overlays
  drawWrongWay(game.player, 0, 0, p1W, vh, time);
  drawWrongWay(game.player2, p2X, 0, p2W, vh, time);

  // Position change callouts
  drawPositionChange(p1W / 2, vh * 0.18, game.player);
  drawPositionChange(p2X + p2W / 2, vh * 0.18, game.player2);

  // Item name popups
  drawItemNamePopup(145, 120, game.player, time);
  drawItemNamePopup(vw - panelW - 15 + 125, 120, game.player2, time);

  // Mute indicator
  if (Sound.muted) {
    ctx().fillStyle = "rgba(0,0,0,0.55)";
    ctx().fillRect(vw / 2 - 28, 15, 56, 20);
    ctx().fillStyle = "#fff";
    ctx().font = "bold 9px sans-serif";
    ctx().textAlign = "center"; ctx().textBaseline = "middle";
    ctx().fillText("MUTED", vw / 2, 25);
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

export function drawSpeedo(x, y, size, player, time = 0) {
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
  ctx().strokeStyle = "rgba(255,255,255,0.28)";
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
  ctx().strokeStyle = "rgba(255,255,255,0.1)";
  ctx().beginPath();
  ctx().arc(cx, cy, radius, Math.PI, TAU);
  ctx().stroke();

  const sp = player.speed();
  const maxDisplay = 8.5;
  const frac = clamp(sp / maxDisplay, 0, 1);
  const col = sp > 7 ? COMPASS_VISUAL.accent : sp > 5 ? COMPASS_VISUAL.primaryDark : COMPASS_VISUAL.primary;

  // Arc filled with crisp dark backing stroke
  ctx().lineCap = "round";
  ctx().strokeStyle = "rgba(5, 6, 16, 0.85)";
  ctx().lineWidth = 11;
  ctx().beginPath();
  ctx().arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * frac);
  ctx().stroke();

  ctx().strokeStyle = col;
  ctx().lineWidth = 8;
  ctx().beginPath();
  ctx().arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * frac);
  ctx().stroke();

  // Needle with crisp dark outline
  const ang = Math.PI + Math.PI * frac;
  ctx().strokeStyle = "rgba(5, 6, 16, 0.9)";
  ctx().lineWidth = 4.5;
  ctx().beginPath();
  ctx().moveTo(cx, cy);
  ctx().lineTo(cx + Math.cos(ang) * (radius - 4), cy + Math.sin(ang) * (radius - 4));
  ctx().stroke();

  ctx().strokeStyle = col;
  ctx().lineWidth = 2.5;
  ctx().beginPath();
  ctx().moveTo(cx, cy);
  ctx().lineTo(cx + Math.cos(ang) * (radius - 4), cy + Math.sin(ang) * (radius - 4));
  ctx().stroke();

  // Center hub
  ctx().fillStyle = col;
  ctx().beginPath(); ctx().arc(cx, cy, 4, 0, TAU); ctx().fill();
  ctx().fillStyle = "#050510";
  ctx().beginPath(); ctx().arc(cx, cy, 2, 0, TAU); ctx().fill();

  // Numeric
  const numFontPx = size < 115 ? 18 : 22;
  ctx().font = `bold ${numFontPx}px 'SFMono-Regular', Consolas, monospace`;
  ctx().textAlign = "center"; ctx().textBaseline = "middle";
  ctx().strokeStyle = "rgba(5, 6, 16, 0.85)";
  ctx().lineWidth = 3;
  ctx().strokeText(`${Math.round(sp * 28)}`, cx, cy - 12);
  ctx().fillStyle = "#fff";
  ctx().fillText(`${Math.round(sp * 28)}`, cx, cy - 12);
  ctx().fillStyle = "#a8acd0";
  ctx().font = "10px sans-serif";
  ctx().fillText("KM/H", cx, cy + 8);

  if (player.boostTimer > 0) {
    const pulse = 0.7 + 0.3 * Math.sin(time * 0.01);
    ctx().globalAlpha = pulse;
    ctx().font = "bold 10px sans-serif";
    ctx().strokeStyle = "rgba(5, 6, 16, 0.85)";
    ctx().lineWidth = 2.5;
    ctx().strokeText("BOOST", cx, 18);
    ctx().fillStyle = "#ff8a3b";
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
  const countColor = game.countdownText === "GO!" ? "#7aff66" : "#ff4d6d";
  ctx().lineJoin = "round";
  ctx().strokeStyle = "rgba(8, 10, 24, 0.92)";
  ctx().lineWidth = 10;
  ctx().strokeText(game.countdownText, 0, 0);
  ctx().fillStyle = countColor;
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
