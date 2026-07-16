import { TUNING, QUOTES } from "../config/tuning.js";
import { HEADLESS_MODE } from "../core/env.js";
import { bus } from "../core/events.js";
import { rand, dist, angleDiff, pick } from "../core/math.js";
import {
  STATE, game, isBattleMode, getActiveKarts, canResolveBattleCombat,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { runtime } from "../entities/runtime.js";
import { isKartAirborne } from "../entities/kart.js";
import {
  spawnCompassRevokeFx, spawnApprovalTransferToken, spawnCompassRamFx,
} from "../entities/particles.js";
import { DoubleBlindCloud } from "../entities/items.js";
import { simRandom } from "../core/rng.js";

function clampApprovals(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.max(3, Math.min(5, n));
}

export function triggerHitFlash(text, color, duration = 90, kart = null) {
  const hf = { text, color, timer: duration, maxTimer: duration };
  if (kart) {
    kart.hitFlash = hf;
  } else {
    if (game.player) game.player.hitFlash = hf;
  }
}

const BATTLE_ATTRIBUTION_WINDOW = 2;
// High-speed ram qualification (units/frame; closing velocity along attacker→defender).
const APPROVAL_RAM_MIN_SPEED = 4.5;
const APPROVAL_RAM_SPEED_MARGIN = 1.25;
const APPROVAL_RAM_MIN_CLOSING = 3.0;
const APPROVAL_RAM_MAX_BEARING_DEG = 50;

export function isUntimedHumanBattle() {
  return isBattleMode() && !!game.battleUntimed && !HEADLESS_MODE;
}

export function resolveFreshBattleAttribution(victim, attackerField, attackerAtField, windowSec = BATTLE_ATTRIBUTION_WINDOW) {
  if (!victim) return null;
  const attacker = victim[attackerField];
  const at = victim[attackerAtField] || 0;
  if (!attacker || attacker === victim || attacker.eliminated) return null;
  if ((game.raceTime - at) >= windowSec) return null;
  return attacker;
}

export function resolveFreshKillAttacker(victim) {
  return resolveFreshBattleAttribution(victim, "lastAttacker", "lastAttackerAt");
}

export function resolveFreshTransferAttacker(victim) {
  return resolveFreshBattleAttribution(victim, "pendingApprovalTransferFrom", "pendingApprovalTransferAt");
}

function clearPendingApprovalTransfer(victim) {
  if (!victim) return;
  victim.pendingApprovalTransferFrom = null;
  victim.pendingApprovalTransferAt = 0;
}

export function setKillAttribution(victim, attacker) {
  if (!victim || !attacker) return;
  victim.lastAttacker = attacker;
  victim.lastAttackerAt = game.raceTime;
}

export function setTransferAttribution(victim, attacker) {
  if (!victim || !attacker) return;
  victim.pendingApprovalTransferFrom = attacker;
  victim.pendingApprovalTransferAt = game.raceTime;
}

export function qualifiesApprovalRam(att, def, dirx, diry) {
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
export function applyDeauthShockwave(sourceKart) {
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
  if (game.viewMode === "3d" && runtime.spawn3DShockwave) {
    runtime.spawn3DShockwave(sourceKart.x, sourceKart.y, radius, "#ff3366");
  }
}

export function showComboHit(kart, count) {
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

export function findMergeRequestTarget(kart) {
  const ranking = runtime.rankAll().filter(k => k && k !== kart && !k.finished);
  const myRank = runtime.rankAll().indexOf(kart);
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

export function startMergeRequestPull(kart) {
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
  kart.mergePullTargetId = runtime.getKartId(target);
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


function makeTypo(str) {
  if (simRandom() > 0.45) return str;
  const chars = str.split("");
  if (chars.length < 4) return str;
  const i = Math.floor(rand(1, chars.length - 2));
  const r = simRandom();
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

export function triggerQuote(kart, event, otherKart = null) {
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
  if (simRandom() < 0.55) return pick(lines);
  return null;
}

function getUltimateTier(kart) {
  const ranking = runtime.rankAll();
  const rank = ranking.indexOf(kart) + 1;
  const total = ranking.length;
  if (total <= 1) return 2;
  if (rank >= total) return 3;
  if (rank >= Math.ceil(total * 0.5)) return 2;
  return 1;
}

export function activateUltimate(kart) {
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






export function eliminateKart(kart, label = "ELIMINATED!", x = null, y = null, color = "#ff3366", killer = null) {
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
  if (runtime.areAllHumansDone() && !isBattleMode()) {
    runtime.scheduleFinishRace(900);
  }
}

// Battle mode: revoke one Approval from a kart that just got hit. Eliminates at zero.
// Only a qualifying high-speed ram or Merge Request may transfer the popped Approval.
export function popApproval(kart, opts = {}) {
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
export function initBattleKartState() {
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
export function registerBattleHit(attacker) {
  if (attacker && attacker.isPlayer && isBattleMode()) game.rlHits = (game.rlHits || 0) + 1;
}

// Detects new spin-out events (rising edge) and revokes an approval per hit.
export function updateBattleApprovals() {
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
export function checkBattleEnd() {
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
    runtime.finishRaceSim();
  }
}

// The living kart with the most Approvals — used as a spectator fallback if the kill chain breaks.
export function battleLeader() {
  const alive = getActiveKarts().filter((k) => k && !k.eliminated);
  if (!alive.length) return null;
  return alive.reduce((best, k) => ((k.approvals || 0) > (best.approvals || 0) ? k : best), alive[0]);
}

// Who to watch after `victim` is out: follow their killer if still alive, else the current leader.
export function pickSpectateTarget(victim) {
  const killer = victim && victim.killedBy;
  if (killer && !killer.eliminated) return killer;
  return battleLeader();
}

// Battle spectator chain: once you're rejected you follow your killer; when they get rejected you
// follow whoever got them, and so on, until one kart is left standing.
export function updateSpectate() {
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
export function getViewKart() {
  if (isBattleMode() && game.spectateTarget && !game.spectateTarget.eliminated) return game.spectateTarget;
  return game.player;
}

export function absorbFatalHitWithShield(kart, x, y) {
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

export function tryApprovalRam(att, def, dirx, diry) {
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