import { TUNING } from "../config/tuning.js";
import { DEFAULT_KART_COLLISION_RADIUS } from "../config/characters.js";
import { clamp, dist, lerp, rand, angleDiff, pick } from "../core/math.js";
import { TAU } from "../core/math.js";
import { keysP1, keysP2 } from "../core/input.js";
import { bus } from "../core/events.js";
import {
  STATE, game, isBattleMode, getActiveKarts,
  isP2pBattleGuest, isP2pBattleHost, canResolveBattleCombat,
} from "../core/state.js";
import { runtime } from "../entities/runtime.js";
import {
  MergeConflict, PlaceboPill, DoubleBlindCloud, RegulatoryProjectile,
  DossierProjectile, DragonFire,
} from "../entities/items.js";
import {
  isKartAirborne, integrateKartVertical, applyMergeRequestPull,
} from "../entities/kart.js";
import {
  updateBattleApprovals, checkBattleEnd, updateSpectate, isUntimedHumanBattle,
  eliminateKart, registerBattleHit, absorbFatalHitWithShield, triggerHitFlash, triggerQuote,
} from "../modes/battle.js";
import {
  checkProgress, checkItems, kartCollisions, rankAll, progressValue,
  isDragonEscape, getDragonTarget, updateDragonEscapeEntity,
  getKartCollisionRadius, shouldSkipGroundHazardForKart,
  applyMovingObstacleHit,   applyRocketStart, isGroundHazardImmuneWhenAirborne, startRaceSim,
} from "../modes/race.js";

export function simulationStep(dt, time) {
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
    else { applyRocketStart(); startRaceSim(); return { earlyReturn: true }; }
    if (prevText !== game.countdownText) {
      if (runtime.playCountdown) runtime.playCountdown(game.countdownText === "GO!");
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
    runtime.updateRetroTempo?.();

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
                if (kart.isPlayer) runtime.playTone?.(600, 0.1, "square", 0.1, 300);
                game.particles.burst(h.x, h.y, "#78dcff", 15, { type: "spark", spdMin: 1.5, spdMax: 4 });
              } else {
                kart.spinoutTimer = TUNING.SPINOUT_TIME; kart.spinAngle = 0; kart.vx = 0; kart.vy = 0;
                if (h.owner && h.owner !== kart) registerBattleHit(h.owner);
                if (kart.isPlayer) { runtime.playCrash?.(); game.shake = Math.max(game.shake, 8); triggerHitFlash("REVOKED!", "#ff3366", 80, kart); }
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
                runtime.playTone?.(600, 0.1, "square", 0.1, 300);
              }
              game.particles.burst(h.x, h.y, "#78dcff", 15, { type: "spark", spdMin: 1.5, spdMax: 4 });
            } else {
              if (isDossier && kart.charId === "florian") {
                kart.spinoutTimer = TUNING.SPINOUT_TIME_SHORT;
                kart.spinAngle = 0;
                kart.vx *= 0.5; kart.vy *= 0.5;
                kart.shieldTimer = 360; // instantly generates Compliance Shield
                if (kart.isPlayer) {
                  runtime.playTone?.(500, 0.25, "sine", 0.15, 150);
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
                if (kart.isPlayer) { runtime.playCrash?.(); triggerHitFlash("PLACEBO!", "#ffcc00", 80, kart); game.flash = Math.max(game.flash, 6); }
                game.particles.burst(h.x, h.y, "#ffcc00", 22, { type: "spark", spdMin: 1.5, spdMax: 5 });
                game.particles.add({ type: "text", text: "PLACEBO!", x: h.x, y: h.y - 20,
                  vx: rand(-0.5, 0.5), vy: -1.2, life: 75, maxLife: 75, size: 20, color: "#ffcc00", drag: 0.98 });
              } else if (isDoubleBlind) {
                kart.doubleBlindTimer = Math.max(kart.doubleBlindTimer || 0, TUNING.DOUBLE_BLIND_DURATION);
                if (kart.isPlayer) { runtime.playNoise?.(0.18, 0.08, 500); game.shake = Math.max(game.shake, 5); triggerHitFlash("DOUBLE BLIND!", "#bd57ff", 90, kart); game.flash = Math.max(game.flash, 8); }
                game.particles.burst(h.x, h.y, "#bd57ff", 24, { type: "spark", spdMin: 1.2, spdMax: 4 });
                game.particles.add({ type: "text", text: "DOUBLE BLIND!", x: h.x, y: h.y - 28,
                  vx: rand(-0.5, 0.5), vy: -1.2, life: 85, maxLife: 85, size: 20, color: "#bd57ff", drag: 0.98 });
              } else {
                kart.spinoutTimer = TUNING.SPINOUT_TIME; kart.spinAngle = 0; kart.vx = 0; kart.vy = 0;
                if (kart.isPlayer) { runtime.playCrash?.(); game.shake = Math.max(game.shake, 8); }
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
            if (anyPlayer) runtime.playDragonBreath?.();
          }
        }
        for (const kart of activeKarts) {
          kart.maxSpeed = kart.baseMaxSpeed * (1 + intensity * 0.55);
        }
        runtime.updateJapaneseTempo?.(intensity);
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
  }
  return {};
}
