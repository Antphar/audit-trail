import { TUNING } from "../config/tuning.js";
import { TAU, rand } from "../core/math.js";
import {
  keysP1,
  keysP2,
  consumePressedP1,
  consumePressedP2,
} from "../core/input.js";
import {
  game,
  STATE,
  isBattleMode,
  getActiveKarts,
} from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { Kart } from "./kart.js";
import { runtime } from "./runtime.js";

export class PlayerKart extends Kart {
  constructor(x, y, heading, char, playerIndex = 1) {
    super(x, y, heading, char, true);
    this.playerIndex = playerIndex;
  }

  getControls(dt, track) {
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

    const itemPressed = !p2pLocalPaused && (this.playerIndex === 2 ? consumePressedP2("item") : consumePressedP1("item"));
    if (itemPressed && this.itemState === "active" && this.itemSlot) {
      this.useItem();
    }

    const ultPressed = !p2pLocalPaused && (this.playerIndex === 2 ? consumePressedP2("ult") : consumePressedP1("ult"));
    if (ultPressed && this.ultReady) {
      runtime.activateUltimate(this);
    }

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
    return { input, onRoad };
  }

  prepareSpeedModifier(track) {
    if (isBattleMode()) return null;
    const allKarts = getActiveKarts();
    let leaderProgress = 0;
    for (const k of allKarts) {
      leaderProgress = Math.max(leaderProgress, runtime.progressValue(k));
    }
    const deficit = leaderProgress - runtime.progressValue(this);
    let catchupMult = 1.0;
    if (deficit > 0) {
      catchupMult = 1 + Math.min(TUNING.PLAYER_CATCHUP_MAX, (deficit / TUNING.PLAYER_CATCHUP_RANGE) * TUNING.PLAYER_CATCHUP_MAX);
    }
    return { speedMult: catchupMult, accelMult: catchupMult };
  }
}
