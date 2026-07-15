import { MAPS } from "../config/maps.js";
import { TAU, lerp, clamp, dist, pointSegProjection, rand, pick, hexToRgba, ellipseNormDist } from "../core/math.js";
import { COMPASS_VISUAL, getMapDayPalette } from "../config/themes.js";
import { game, isBattleMode, isDayMode, getActiveKarts, STATE } from "../core/state.js";
import { Sound } from "../audio/sound.js";
import { runtime } from "./runtime.js";
import { RegulatoryProjectile } from "./items.js";

export let WORLD_W = 3400;
export let WORLD_H = 2400;
export const CHECKPOINT_RADIUS = 80;
export const RAMP_IMPULSE = 5.8;
export const BUMP_IMPULSE = 2.7;

function roundRect(c, x, y, w, h, r) {
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

const _compassPatternCache = new WeakMap();

function getCompassFloorPattern(ctx, surfaceKey) {
  let surfaceMap = _compassPatternCache.get(ctx);
  if (!surfaceMap) {
    surfaceMap = new Map();
    _compassPatternCache.set(ctx, surfaceMap);
  }
  if (surfaceMap.has(surfaceKey)) return surfaceMap.get(surfaceKey);

  const parts = surfaceKey.split(":");
  const tod = parts[0];
  const surface = parts[1];
  const day = tod === "day";
  const tile = surface === "arena" ? 128 : surface === "road" ? 96 : 80;
  const off = document.createElement("canvas");
  off.width = tile;
  off.height = tile;
  const oc = off.getContext("2d");

  if (surface === "arena") {
    oc.strokeStyle = day ? "rgba(79, 72, 112, 0.08)" : "rgba(235, 228, 255, 0.045)";
    oc.lineWidth = 1;
    oc.beginPath();
    for (let p = 32; p < tile; p += 32) {
      oc.moveTo(p + 0.5, 0); oc.lineTo(p + 0.5, tile);
      oc.moveTo(0, p + 0.5); oc.lineTo(tile, p + 0.5);
    }
    oc.stroke();
    oc.strokeStyle = day ? "rgba(123, 117, 255, 0.19)" : "rgba(139, 133, 255, 0.12)";
    oc.strokeRect(0.5, 0.5, tile - 1, tile - 1);
    oc.fillStyle = day ? "rgba(253, 153, 39, 0.34)" : "rgba(253, 153, 39, 0.22)";
    oc.fillRect(5, 5, 11, 2);
    oc.fillRect(5, 5, 2, 11);
    oc.fillStyle = day ? "rgba(164, 255, 128, 0.38)" : "rgba(164, 255, 128, 0.18)";
    oc.beginPath(); oc.arc(tile / 2, tile / 2, 2, 0, TAU); oc.fill();
  } else if (surface === "grass") {
    const mapPal = day && parts[2] ? getMapDayPalette(parts[2]) : null;
    oc.strokeStyle = day ? (mapPal?.grassGrid || "rgba(79, 72, 112, 0.09)") : "rgba(123, 117, 255, 0.06)";
    oc.lineWidth = 1;
    oc.beginPath();
    oc.moveTo(0, tile - 0.5);
    oc.lineTo(tile, tile - 0.5);
    oc.moveTo(tile - 0.5, 0);
    oc.lineTo(tile - 0.5, tile);
    oc.stroke();
    oc.fillStyle = day ? (mapPal?.grassTint || "rgba(230, 255, 220, 0.24)") : "rgba(235, 228, 255, 0.04)";
    oc.fillRect(0, 0, tile, 2);
  } else {
    oc.fillStyle = day ? "#211c30" : "#15121f";
    oc.fillRect(0, 0, tile, tile);
    oc.strokeStyle = day ? "rgba(235, 228, 255, 0.08)" : "rgba(139, 133, 255, 0.08)";
    oc.lineWidth = 1;
    oc.beginPath();
    oc.moveTo(0, 24.5); oc.lineTo(tile, 24.5);
    oc.moveTo(0, 72.5); oc.lineTo(tile, 72.5);
    oc.stroke();
    oc.strokeStyle = day ? "rgba(123, 117, 255, 0.22)" : "rgba(79, 72, 112, 0.28)";
    oc.setLineDash([10, 14]);
    oc.beginPath(); oc.moveTo(0, tile / 2 + 0.5); oc.lineTo(tile, tile / 2 + 0.5); oc.stroke();
    oc.setLineDash([]);
    oc.fillStyle = day ? "rgba(253, 153, 39, 0.2)" : "rgba(253, 153, 39, 0.12)";
    for (let i = 0; i < 4; i++) oc.fillRect(12 + i * 23, 12 + ((i * 17) % 70), 2, 2);
  }

  const pattern = ctx.createPattern(off, "repeat");
  surfaceMap.set(surfaceKey, pattern);
  return pattern;
}

export class Track {
  constructor() {
    const mapConfig = MAPS[game.selectedMapIdx || 0];
    WORLD_W = mapConfig.worldW;
    WORLD_H = mapConfig.worldH;
    this.waypoints = mapConfig.waypoints;
    this.n = this.waypoints.length;
    this.halfWidth = mapConfig.roadHalfBase;
    const segWidthConfig = mapConfig.segWidth || {};

    this.isOpen = (mapConfig.id === "dragon_escape");
    this.hasCustomCheckpoints = Array.isArray(mapConfig.checkpointGroups) && mapConfig.checkpointGroups.length > 0;
    this.checkpointGroups = this._buildCheckpointGroups(mapConfig.checkpointGroups);
    this.checkpointCount = this.checkpointGroups.length;

    // Pre-compute segment data (length, normal, half-width)
    this.segments = [];
    for (let i = 0; i < this.n; i++) {
      const a = this.waypoints[i];
      let b;
      if (this.isOpen) {
        b = this.waypoints[i + 1];
        if (!b) break; // end of open trail
      } else {
        b = this.waypoints[(i + 1) % this.n];
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      const nx = -dy / len, ny = dx / len; // left normal
      const wScale = (segWidthConfig[i] || 1);
      this.segments.push({
        a, b, dx, dy, len, nx, ny,
        halfW: this.halfWidth * wScale,
      });
    }

    // Arena identity comes from fixed boundary landmarks; random pillars can obstruct chase view.
    this.decorations = mapConfig.arenaFloor ? [] : this._generateDecor();
    this.spectators = this._generateSpectators();

    // Coins, boost pads, item boxes
    this.coins = this._placeCoins();
    this.boostPads = this._placeBoostPads(mapConfig.boostPadSegs || []);
    this.itemBoxes = this._placeItemBoxes(mapConfig.itemBoxSegs || []);
    this.movingObjects = this._placeMovingObjects(mapConfig.movingObjects || []);
    this.regulatoryDragon = this._createRegulatoryDragon(mapConfig.regulatoryDragon);
    this.arenaFloor = mapConfig.arenaFloor || null;
    this.reviewPlatformRadius = mapConfig.reviewPlatformRadius || 0;
    this.ramps = this._normalizeRamps(mapConfig.ramps || []);
    this.arenaBoundaryLandmarks = this.arenaFloor ? this._buildArenaBoundaryLandmarks() : null;
  }

  _buildArenaBoundaryLandmarks() {
    const floor = this.arenaFloor;
    const labels = ["POLICY", "EVIDENCE", "REVIEW", "APPROVED", "AUDIT", "COMPLY", "SIGN-OFF", "VERIFY"];
    const count = Math.min(8, Math.max(4, labels.length));
    const landmarks = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU - Math.PI / 2;
      const dist = 0.9;
      landmarks.push({
        x: floor.cx + Math.cos(a) * floor.rx * dist,
        y: floor.cy + Math.sin(a) * floor.ry * dist,
        ang: a + Math.PI / 2,
        label: labels[i],
      });
    }
    return landmarks;
  }

  _normalizeRamps(entries) {
    return entries.map((r) => ({
      x: r.x,
      y: r.y,
      ang: r.ang,
      w: r.w || 70,
      h: r.h || 36,
      kind: r.kind || "ramp",
      impulse: r.impulse ?? (r.kind === "bump" ? BUMP_IMPULSE : RAMP_IMPULSE),
      minSpeed: r.minSpeed ?? (r.kind === "bump" ? 2.0 : 3.2),
      cooldown: new Map(),
    }));
  }

  _buildCheckpointGroups(groups) {
    const source = this.hasCustomCheckpoints ? groups : this.waypoints;
    return source.map((entry, idx) => {
      const fallback = this.waypoints[Math.min(idx, this.waypoints.length - 1)] || this.waypoints[0] || { x: 0, y: 0 };
      const list = Array.isArray(entry) ? entry : [entry];
      return list.map(point => ({
        x: Number.isFinite(point?.x) ? point.x : fallback.x,
        y: Number.isFinite(point?.y) ? point.y : fallback.y,
        r: Number.isFinite(point?.r) ? point.r : CHECKPOINT_RADIUS,
      }));
    });
  }

  checkpointCenter(idx) {
    const count = this.checkpointCount || 1;
    const group = this.checkpointGroups[((idx % count) + count) % count] || [];
    if (!group.length) return this.waypoints[((idx % this.n) + this.n) % this.n] || null;
    const sum = group.reduce((acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    }, { x: 0, y: 0 });
    return { x: sum.x / group.length, y: sum.y / group.length };
  }

  hitCheckpoint(idx, x, y) {
    const group = this.checkpointGroups[idx];
    if (!group || !group.length) return false;
    return group.some(point => dist(x, y, point.x, point.y) <= (point.r || CHECKPOINT_RADIUS));
  }

  startLineGate() {
    const s = this.segments[0];
    if (!s) return null;
    const ux = s.dx / s.len;
    const uy = s.dy / s.len;
    return {
      x: s.a.x + s.dx * 0.06,
      y: s.a.y + s.dy * 0.06,
      ux,
      uy,
      nx: s.nx,
      ny: s.ny,
      halfW: s.halfW,
    };
  }

  crossedStartLine(prevX, prevY, x, y) {
    const gate = this.startLineGate();
    if (!gate || !Number.isFinite(prevX) || !Number.isFinite(prevY)) return false;
    const prevAlong = (prevX - gate.x) * gate.ux + (prevY - gate.y) * gate.uy;
    const currAlong = (x - gate.x) * gate.ux + (y - gate.y) * gate.uy;
    if (!(prevAlong <= 0 && currAlong > 0)) return false;

    const denom = currAlong - prevAlong;
    const t = denom !== 0 ? clamp(-prevAlong / denom, 0, 1) : 0;
    const ix = lerp(prevX, x, t);
    const iy = lerp(prevY, y, t);
    const lateral = Math.abs((ix - gate.x) * gate.nx + (iy - gate.y) * gate.ny);
    return lateral <= gate.halfW + 12;
  }

  // Find closest segment to a world point
  closestSegment(x, y) {
    let bestI = 0, bestD = Infinity, bestT = 0, bestProj = null;
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const p = pointSegProjection(x, y, s.a.x, s.a.y, s.b.x, s.b.y);
      if (p.d < bestD) { bestD = p.d; bestI = i; bestT = p.t; bestProj = p; }
    }
    return { idx: bestI, dist: bestD, t: bestT, proj: bestProj };
  }

  // Is point on the road surface?
  isOnRoad(x, y) {
    if (this.arenaFloor) {
      return ellipseNormDist(x, y, this.arenaFloor) <= 1.0;
    }
    const c = this.closestSegment(x, y);
    return c.dist <= this.segments[c.idx].halfW;
  }

  // Is point on the outer rumble strip?
  isOnRumble(x, y) {
    const c = this.closestSegment(x, y);
    const seg = this.segments[c.idx];
    return c.dist > seg.halfW && c.dist <= seg.halfW + 10;
  }

  // Returns the over-edge distance (>0 if outside the road) on this segment
  offRoadDepth(x, y) {
    if (this.arenaFloor) {
      const nd = ellipseNormDist(x, y, this.arenaFloor);
      if (nd <= 1) return 0;
      const scale = Math.min(this.arenaFloor.rx, this.arenaFloor.ry);
      return (nd - 1) * scale;
    }
    const c = this.closestSegment(x, y);
    const seg = this.segments[c.idx];
    return c.dist - seg.halfW;
  }

  _generateDecor() {
    const mapId = MAPS[game.selectedMapIdx || 0].id;
    const isDragon = mapId === "dragon_escape";
    const decor = [];
    const colors = isDragon
      ? ["#ff4d4d", "#ffb84d", "#ffd700", "#ff6b6b", "#c0392b"]
      : ["#7b75ff", "#fd9927", "#ff4d6d", "#a4ff80"];

    if (isDragon) {
      // Open trail: place 1 decor every ~6 segments along alternating sides
      for (let i = 0; i < this.segments.length; i += 6) {
        const s = this.segments[i];
        if (!s) continue;
        const t = 0.5;
        const cx = s.a.x + s.dx * t;
        const cy = s.a.y + s.dy * t;
        const side = (i % 2 === 0) ? 1 : -1;
        const offDist = s.halfW + 60 + Math.random() * 120;
        decor.push({
          x: cx + s.nx * offDist * side,
          y: cy + s.ny * offDist * side,
          r: rand(8, 16),
          h: rand(40, 70),
          color: pick(colors),
          pulseOffset: Math.random() * Math.PI * 2,
          isJapanese: true,
          type: Math.random() < 0.3 ? "lantern" : (Math.random() < 0.5 ? "torii" : "sakura")
        });
      }
      return decor;
    }

    // Closed-loop maps: scattered random trees
    let attempts = 0;
    const count = 80;
    const maxDist = 380;
    while (decor.length < count && attempts < 4000) {
      attempts++;
      const x = rand(120, WORLD_W - 120);
      const y = rand(120, WORLD_H - 120);
      const c = this.closestSegment(x, y);
      const seg = this.segments[c.idx];
      if (c.dist > seg.halfW + 50 && c.dist < seg.halfW + maxDist) {
        decor.push({
          x, y,
          r: rand(10, 18),
          h: rand(35, 60),
          color: pick(colors),
          pulseOffset: Math.random() * Math.PI * 2,
          isJapanese: false,
          type: "pillar"
        });
      }
    }
    return decor;
  }

  _generateSpectators() {
    const specs = [];
    const mapId = MAPS[game.selectedMapIdx || 0].id;
    if (mapId === "dragon_escape") return specs;
    const colors = ["#ff4d6d", "#7b75ff", "#fd9927", "#a4ff80", "#57f2ff", "#b983ff", "#ff6b35", "#ffd86b"];
    // Place small clusters of spectators along track edges
    for (let i = 0; i < this.segments.length; i += 4) {
      if (Math.random() > 0.45) continue;
      const s = this.segments[i];
      if (!s) continue;
      const t = rand(0.2, 0.8);
      const cx = s.a.x + s.dx * t;
      const cy = s.a.y + s.dy * t;
      const side = Math.random() < 0.5 ? 1 : -1;
      const offDist = s.halfW + rand(18, 35);
      const clusterSize = Math.floor(rand(2, 5));
      for (let c = 0; c < clusterSize; c++) {
        specs.push({
          x: cx + s.nx * offDist * side + rand(-12, 12),
          y: cy + s.ny * offDist * side + rand(-8, 8),
          color: pick(colors),
          phase: Math.random() * TAU,
          height: rand(6, 9),
          cheerThreshold: rand(80, 160),
        });
      }
    }
    return specs;
  }

  drawSpectators(ctx, time) {
    for (const sp of this.spectators) {
      // Check if any kart is close enough to trigger cheering
      let cheering = false;
      for (const k of getActiveKarts()) {
        if (dist(sp.x, sp.y, k.x, k.y) < sp.cheerThreshold) { cheering = true; break; }
      }
      const bounce = cheering ? Math.abs(Math.sin(time * 0.012 + sp.phase)) * 4 : 0;
      const wave = cheering ? Math.sin(time * 0.02 + sp.phase) * 2 : 0;

      ctx.save();
      ctx.translate(sp.x + wave, sp.y);

      // Body (tiny pixel-art person)
      ctx.fillStyle = sp.color;
      ctx.fillRect(-2, -sp.height - bounce, 4, sp.height * 0.55);
      // Head
      ctx.beginPath();
      ctx.arc(0, -sp.height - bounce - 2, 2.5, 0, TAU);
      ctx.fill();
      // Legs
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(-2, -sp.height * 0.45 - bounce, 2, sp.height * 0.45);
      ctx.fillRect(0, -sp.height * 0.45 - bounce, 2, sp.height * 0.45);

      // Arms waving when cheering
      if (cheering) {
        const armAng = Math.sin(time * 0.018 + sp.phase) * 0.6;
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-2, -sp.height * 0.7 - bounce);
        ctx.lineTo(-5 + wave, -sp.height - bounce - 3 + armAng * 3);
        ctx.moveTo(2, -sp.height * 0.7 - bounce);
        ctx.lineTo(5 + wave, -sp.height - bounce - 3 - armAng * 3);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  _placeCoins() {
    const coins = [];
    // Lay coin pickups along the centerline
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const count = Math.max(2, Math.floor(s.len / 180));
      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const cx = s.a.x + s.dx * t;
        const cy = s.a.y + s.dy * t;
        // Side offset (left/right alternating slightly)
        const side = ((i + k) % 3) - 1; // -1, 0, 1
        const off = side * (s.halfW * 0.45);
        coins.push({
          x: cx + s.nx * off,
          y: cy + s.ny * off,
          collected: false,
          spin: Math.random() * TAU,
          respawn: 0,
        });
      }
    }
    return coins;
  }

  _placeBoostPads(segIdxs) {
    const pads = [];
    if (this.isOpen && segIdxs.length === 0) {
      for (let i = 4; i < this.segments.length; i += 12) {
        const s = this.segments[i];
        if (!s) continue;
        const t = 0.55;
        pads.push({
          x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
          ang: Math.atan2(s.dy, s.dx),
          w: 70, h: 36, cooldown: new Map(),
        });
      }
      return pads;
    }
    for (const i of segIdxs) {
      if (i >= this.segments.length) continue;
      const s = this.segments[i];
      const t = 0.55;
      pads.push({
        x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
        ang: Math.atan2(s.dy, s.dx),
        w: 70, h: 36, cooldown: new Map(),
      });
    }
    return pads;
  }

  _placeItemBoxes(segIdxs) {
    const boxes = [];
    if (this.isOpen && segIdxs.length === 0) {
      for (let i = 2; i < this.segments.length; i += 16) {
        const s = this.segments[i];
        if (!s) continue;
        const t = 0.5;
        boxes.push({
          x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
          active: true, respawn: 0, spin: Math.random() * TAU,
        });
      }
      return boxes;
    }
    for (const i of segIdxs) {
      if (i >= this.segments.length) continue;
      const s = this.segments[i];
      const t = 0.5;
      boxes.push({
        x: s.a.x + s.dx * t, y: s.a.y + s.dy * t,
        active: true, respawn: 0, spin: Math.random() * TAU,
      });
    }
    return boxes;
  }

  _placeMovingObjects(configs) {
    return configs
      .filter(cfg => cfg.seg < this.n)
      .map((cfg, idx) => {
        const s = this.segments[cfg.seg];
        const t = cfg.t !== undefined ? cfg.t : 0.5;
        const baseX = s.a.x + s.dx * t;
        const baseY = s.a.y + s.dy * t;
        const obj = {
          seg: cfg.seg,
          baseX,
          baseY,
          nx: s.nx,
          ny: s.ny,
          ang: Math.atan2(s.dy, s.dx),
          amp: cfg.amp || Math.max(55, s.halfW * 0.8),
          speed: cfg.speed || 1,
          phase: cfg.phase || 0,
          r: cfg.r || 24,
          color: cfg.color || "#57f2ff",
          kind: cfg.kind || "blackice",
          label: cfg.label || "FIREWALL",
          hitLabel: cfg.hitLabel || "BLACK ICE!",
          cooldown: new Map(),
          x: baseX,
          y: baseY,
          idx
        };
        this._updateMovingObjectPosition(obj);
        return obj;
      });
  }

  _updateMovingObjectPosition(obj) {
    const sweep = Math.sin(obj.phase) * obj.amp;
    obj.x = obj.baseX + obj.nx * sweep;
    obj.y = obj.baseY + obj.ny * sweep;
  }

  updateMovingObjects(dt) {
    for (const obj of this.movingObjects) {
      obj.phase += obj.speed * 0.035 * dt;
      this._updateMovingObjectPosition(obj);
    }
  }

  _createRegulatoryDragon(config) {
    if (!config) return null;
    return {
      x: config.startX || 120,
      y: config.startY || WORLD_H * 0.72,
      vx: 0,
      vy: 0,
      heading: 0,
      r: 88,
      baseGap: config.baseGap || 720,
      minGap: config.minGap || 260,
      closeSeconds: config.closeSeconds || 90,
      fireEvery: config.fireEvery || 90,
      fireTimer: 90,
      jawPhase: 0,
      wingPhase: 0,
      enraged: false,
      active: true
    };
  }

  isDragonFinalLapEnraged() {
    return getActiveKarts().some(k => k && k.isPlayer && !k.eliminated && k.lap >= runtime.getTotalLaps() - 1);
  }

  updateRegulatoryDragon(dt) {
    const dragon = this.regulatoryDragon;
    if (!dragon || !game.player || game.state !== STATE.RACING) return;

    const target = runtime.getDragonTarget();
    if (!target) return;
    const enraged = this.isDragonFinalLapEnraged();
    dragon.enraged = enraged;
    const fx = Math.cos(target.heading);
    const fy = Math.sin(target.heading);
    const lx = -fy;
    const ly = fx;
    const pressure = clamp(game.raceTime / dragon.closeSeconds, 0, 1);
    const gap = Math.max(155, lerp(dragon.baseGap, dragon.minGap, pressure) - (enraged ? 45 : 0));
    const weave = enraged ? 82 : 55;
    const desiredX = target.x - fx * gap + lx * Math.sin(game.raceTime * (enraged ? 2.0 : 1.4)) * weave;
    const desiredY = target.y - fy * gap + ly * Math.sin(game.raceTime * (enraged ? 1.7 : 1.1)) * weave;
    const chaseBase = Math.max(0.925, 0.965 - pressure * 0.018 - (enraged ? 0.014 : 0));
    const chaseLerp = 1 - Math.pow(chaseBase, dt);

    dragon.vx = (desiredX - dragon.x) * chaseLerp;
    dragon.vy = (desiredY - dragon.y) * chaseLerp;
    dragon.x += dragon.vx;
    dragon.y += dragon.vy;
    dragon.heading = Math.atan2(target.y - dragon.y, target.x - dragon.x);
    dragon.jawPhase += (enraged ? 0.28 : 0.18) * dt;
    dragon.wingPhase += (enraged ? 0.14 : 0.08) * dt;
    dragon.fireTimer -= dt;

    if (dragon.fireTimer <= 0) {
      dragon.fireTimer = Math.max(enraged ? 34 : 42, dragon.fireEvery - pressure * 28 - (enraged ? 22 : 0) + rand(-10, enraged ? 5 : 10));
      this.fireRegulatoryDragonShot(target, enraged);
    }
  }

  fireRegulatoryDragonShot(target, enraged = false) {
    const dragon = this.regulatoryDragon;
    if (!dragon || !target) return;
    const muzzleX = dragon.x + Math.cos(dragon.heading) * 72;
    const muzzleY = dragon.y + Math.sin(dragon.heading) * 72;
    const leadX = target.x + target.vx * 18;
    const leadY = target.y + target.vy * 18;
    const baseAng = Math.atan2(leadY - muzzleY, leadX - muzzleX);
    const spread = enraged ? 0.16 : 0.08;
    game.hazards.push(new RegulatoryProjectile(muzzleX, muzzleY, baseAng + rand(-spread, spread), enraged ? 9.4 : 8.4, enraged));
    if (enraged && Math.random() < 0.45) {
      const side = Math.random() < 0.5 ? -1 : 1;
      game.hazards.push(new RegulatoryProjectile(muzzleX, muzzleY, baseAng + side * rand(0.18, 0.28), 8.6, true));
    }
    Sound.spatialTone(muzzleX, muzzleY, enraged ? 82 : 120, 0.22, "sawtooth", enraged ? 0.17 : 0.13, 36);
    Sound.spatialNoise(muzzleX, muzzleY, 0.18, enraged ? 0.14 : 0.10, 260);
    if (game.particles) {
      game.particles.burst(muzzleX, muzzleY, enraged ? "#ff7a18" : "#ff3366", enraged ? 24 : 16, { type: "spark", spdMin: 2, spdMax: enraged ? 7 : 5.5 });
    }
  }

  drawRegulatoryDragon(ctx, time) {
    const dragon = this.regulatoryDragon;
    if (!dragon || !dragon.active) return;
    const enraged = !!dragon.enraged;
    const wing = Math.sin(dragon.wingPhase) * (enraged ? 0.62 : 0.45);
    const jaw = (enraged ? 1.0 : 0.86) + (enraged ? 0.46 : 0.34) * Math.sin(dragon.jawPhase);
    const scale = enraged ? 1.12 : 1.0;
    const glowColor = enraged ? "#ff7a18" : "#ff3366";

    ctx.save();
    ctx.translate(dragon.x, dragon.y);
    ctx.rotate(dragon.heading);
    ctx.scale(scale, scale);
    ctx.shadowBlur = enraged ? 42 : 26;
    ctx.shadowColor = glowColor;

    if (enraged) {
      ctx.strokeStyle = "rgba(255, 122, 24, 0.45)";
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 12]);
      ctx.lineDashOffset = -time * 0.08;
      ctx.beginPath();
      ctx.arc(-18, 0, 150 + Math.sin(time * 0.01) * 12, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Wings / regulatory stamp fins
    ctx.fillStyle = enraged ? "rgba(255, 122, 24, 0.34)" : "rgba(255, 51, 102, 0.28)";
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 4;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(1, side);
      ctx.rotate(wing * side);
      ctx.beginPath();
      ctx.moveTo(-22, 16);
      ctx.lineTo(-168, 96);
      ctx.lineTo(-92, 18);
      ctx.lineTo(-172, -74);
      ctx.lineTo(-22, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Body
    const bodyGrad = ctx.createLinearGradient(-80, 0, 80, 0);
    bodyGrad.addColorStop(0, enraged ? "rgba(62, 4, 0, 0.98)" : "rgba(24, 0, 20, 0.98)");
    bodyGrad.addColorStop(0.45, enraged ? "rgba(255, 82, 18, 0.95)" : "rgba(180, 0, 72, 0.92)");
    bodyGrad.addColorStop(1, "rgba(10, 4, 28, 0.98)");
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(-18, 0, 118, 58, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Back spines
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ff3366";
    for (let i = 0; i < 7; i++) {
      const sx = -92 + i * 28;
      ctx.beginPath();
      ctx.moveTo(sx, -50);
      ctx.lineTo(sx + 12, -86 - (i % 2) * 14);
      ctx.lineTo(sx + 26, -48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Head and jaws
    ctx.fillStyle = glowColor;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(64, -48);
    ctx.lineTo(168, -28 * jaw);
    ctx.lineTo(104, 0);
    ctx.lineTo(168, 28 * jaw);
    ctx.lineTo(64, 48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Teeth
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 5; i++) {
      const tx = 105 + i * 11;
      ctx.beginPath();
      ctx.moveTo(tx, -18);
      ctx.lineTo(tx + 5, -2);
      ctx.lineTo(tx + 10, -18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx, 18);
      ctx.lineTo(tx + 5, 2);
      ctx.lineTo(tx + 10, 18);
      ctx.fill();
    }

    // Eye and compliance stamp
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fffb8f";
    ctx.beginPath();
    ctx.arc(84, -19, 7, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(84, 19, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#0d0b21";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("REG", -18, 0);
    if (enraged) {
      ctx.fillStyle = "#fff4b0";
      ctx.font = "bold 7px monospace";
      ctx.fillText("FINAL NOTICE", -18, 18);
    }

    // Heat shimmer rings behind dragon
    ctx.strokeStyle = enraged
      ? `rgba(255, 122, 24, ${0.5 + 0.25 * Math.sin(time * 0.012)})`
      : `rgba(255, 51, 102, ${0.35 + 0.2 * Math.sin(time * 0.008)})`;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.arc(-92, 0, 42, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- Drawing ----
  drawPath(ctx) {
    if (this.n === 0) return;
    ctx.beginPath();
    ctx.moveTo(this.waypoints[0].x, this.waypoints[0].y);
    for (let i = 1; i < this.n; i++) ctx.lineTo(this.waypoints[i].x, this.waypoints[i].y);
    if (!this.isOpen) ctx.closePath();
  }

  draw(ctx, time) {
    if (this.arenaFloor) {
      this._drawArenaFloor(ctx, time);
      this._drawArenaLane(ctx, time);
      this.drawRamps(ctx, time);
      if (!this.isOpen && !isBattleMode()) this._drawStartLine(ctx);
      return;
    }

    // Grass background tile
    this._drawGrass(ctx);

    const mapId = MAPS[game.selectedMapIdx || 0].id;
    const day = isDayMode();
    const dayPal = day ? getMapDayPalette(mapId) : null;

    // Road Outer Shadow
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = dayPal ? dayPal.roadOuterShadow : "rgba(123, 117, 255, 0.15)";
    ctx.lineWidth = (this.halfWidth + 18) * 2;
    ctx.shadowColor = dayPal ? COMPASS_VISUAL.primary : "#7b75ff";
    ctx.shadowBlur = dayPal ? dayPal.roadShadowBlur : 10;
    this.drawPath(ctx); ctx.stroke();
    ctx.shadowBlur = 0;

    // Rumble strip — alternating neon Pink (#ff4d6d) and Mint Green (#a4ff80)
    ctx.strokeStyle = dayPal ? dayPal.roadRumbleA : "#ff4d6d";
    ctx.lineWidth = (this.halfWidth + 5) * 2;
    ctx.setLineDash([30, 30]);
    ctx.lineDashOffset = -((time * 0.04) % 60);
    this.drawPath(ctx); ctx.stroke();

    ctx.strokeStyle = dayPal ? dayPal.roadRumbleB : "#a4ff80";
    ctx.lineDashOffset = -((time * 0.04) % 60) + 30;
    this.drawPath(ctx); ctx.stroke();
    ctx.setLineDash([]);

    // Asphalt (Deep indigo mainframe circuit)
    ctx.strokeStyle = dayPal ? dayPal.roadAsphalt : "#0d0b21";
    ctx.lineWidth = this.halfWidth * 2;
    this.drawPath(ctx); ctx.stroke();

    // Re-stroke narrow segments with darker fill to indicate width change
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (s && s.halfW < this.halfWidth * 0.95) {
        ctx.strokeStyle = dayPal ? dayPal.roadAsphalt : "#0d0b21";
        ctx.lineWidth = s.halfW * 2;
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();

        // Wall edges where it's narrow - neon cyan boundary lines
        ctx.strokeStyle = dayPal ? dayPal.roadNarrowBoundary : "#00e5ff";
        ctx.lineWidth = (s.halfW + 2) * 2;
        ctx.globalCompositeOperation = "destination-over";
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // Glowing cyan edges for the main highway
    ctx.strokeStyle = dayPal ? dayPal.roadEdgeGlow : "#7b75ff";
    ctx.lineWidth = (this.halfWidth + 1) * 2;
    ctx.globalCompositeOperation = "destination-over";
    this.drawPath(ctx); ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Scrolling flowing lane speed-arrows on road surface
    ctx.strokeStyle = dayPal ? dayPal.roadFlowMarks : "rgba(0, 229, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 48]);
    ctx.lineDashOffset = -((time * 0.08) % 60);
    this.drawPath(ctx); ctx.stroke();
    ctx.setLineDash([]);

    // Center dashed line (neon purple)
    ctx.strokeStyle = dayPal ? dayPal.roadCenterLine : "rgba(123, 117, 255, 0.5)";
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 32]);
    this.drawPath(ctx); ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish line (checkered) — hidden in Battle (no laps/goal in the arena)
    if (!this.isOpen && !isBattleMode()) this._drawStartLine(ctx);

    // Trees / decorations (Holographic pillars)
    this._drawDecor(ctx);
  }

  drawMovingObjects(ctx, time) {
    for (const obj of this.movingObjects) {
      const pulse = 0.75 + 0.25 * Math.sin(time * 0.012 + obj.idx);
      const kind = obj.kind || "blackice";
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.ang);
      ctx.shadowBlur = 20 * pulse;
      ctx.shadowColor = obj.color;

      if (kind === "amend") {
        ctx.fillStyle = hexToRgba(obj.color, 0.20);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -42, -14, 84, 28, 12);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -time * 0.04;
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(30, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hexToRgba(obj.color, 0.55);
        ctx.beginPath();
        ctx.moveTo(26, -10);
        ctx.lineTo(42, 0);
        ctx.lineTo(26, 10);
        ctx.closePath();
        ctx.fill();
      } else if (kind === "clause") {
        ctx.fillStyle = hexToRgba(obj.color, 0.16);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -32, -26, 64, 52, 7);
        ctx.fill();
        ctx.stroke();
        const scanY = -18 + ((time * 0.05 + obj.idx * 9) % 36);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-24, scanY);
        ctx.lineTo(24, scanY);
        ctx.stroke();
        ctx.strokeStyle = hexToRgba(obj.color, 0.65);
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, TAU);
        ctx.stroke();
      } else if (kind === "redline") {
        ctx.fillStyle = hexToRgba(obj.color, 0.18);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 3;
        ctx.rotate(Math.sin(time * 0.004 + obj.idx) * 0.2);
        roundRect(ctx, -50, -9, 100, 18, 4);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(-44, 0);
        ctx.lineTo(44, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (kind === "signoff") {
        ctx.fillStyle = hexToRgba(obj.color, 0.24);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -36, -22, 72, 44, 10);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-17, 1);
        ctx.lineTo(-5, 13);
        ctx.lineTo(19, -13);
        ctx.stroke();
      } else {
        // Sweeping firewall gate body
        ctx.fillStyle = hexToRgba(obj.color, 0.22);
        ctx.strokeStyle = obj.color;
        ctx.lineWidth = 2.5;
        roundRect(ctx, -34, -18, 68, 36, 8);
        ctx.fill();
        ctx.stroke();

        // Rotating access-lock core
        ctx.rotate(-obj.phase * 1.8);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(12, 0);
        ctx.moveTo(0, -12);
        ctx.lineTo(0, 12);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, TAU);
        ctx.stroke();

        ctx.rotate(obj.phase * 1.8);
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(obj.label || "ICE", 0, 0);
      ctx.restore();
    }
  }

  _drawArenaFloor(ctx, time) {
    const floor = this.arenaFloor;
    if (!floor) return;
    const day = isDayMode();
    const cx = floor.cx;
    const cy = floor.cy;
    const rx = floor.rx;
    const ry = floor.ry;
    const todKey = day ? "day" : "night";

    const skyGrad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    if (day) {
      skyGrad.addColorStop(0, COMPASS_VISUAL.skyDayTop);
      skyGrad.addColorStop(0.45, COMPASS_VISUAL.skyDayMid);
      skyGrad.addColorStop(1, COMPASS_VISUAL.skyDayBot);
    } else {
      skyGrad.addColorStop(0, COMPASS_VISUAL.skyNightTop);
      skyGrad.addColorStop(1, COMPASS_VISUAL.skyNightBot);
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-500, -500, WORLD_W + 1000, WORLD_H + 1000);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const floorGrad = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
    if (day) {
      floorGrad.addColorStop(0, COMPASS_VISUAL.floorDayInner);
      floorGrad.addColorStop(0.5, COMPASS_VISUAL.floorDayMid);
      floorGrad.addColorStop(1, COMPASS_VISUAL.floorDayOuter);
    } else {
      floorGrad.addColorStop(0, COMPASS_VISUAL.floorNightInner);
      floorGrad.addColorStop(0.55, COMPASS_VISUAL.floorNightMid);
      floorGrad.addColorStop(1, COMPASS_VISUAL.floorNightOuter);
    }
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();

    const gridPattern = getCompassFloorPattern(ctx, `${todKey}:arena`);
    if (gridPattern) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = gridPattern;
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
      ctx.restore();
    }
    ctx.restore();

    if (this.reviewPlatformRadius > 0) {
      ctx.save();
      ctx.translate(cx, cy);
      const pr = this.reviewPlatformRadius;
      ctx.fillStyle = day ? hexToRgba(COMPASS_VISUAL.mint, 0.55) : hexToRgba(COMPASS_VISUAL.primary, 0.14);
      ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.success, 0.75) : hexToRgba(COMPASS_VISUAL.primaryDark, 0.45);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([18, 14]);
      ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.accent, 0.55) : hexToRgba(COMPASS_VISUAL.accent, 0.35);
      ctx.beginPath();
      ctx.arc(0, 0, pr * 0.72, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = day ? hexToRgba(COMPASS_VISUAL.baseMid, 0.65) : hexToRgba(COMPASS_VISUAL.baseDark, 0.82);
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("REVIEW PLATFORM", 0, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.accent, 0.45) : hexToRgba(COMPASS_VISUAL.accent, 0.3);
    ctx.lineWidth = 8;
    ctx.setLineDash([28, 24]);
    ctx.lineDashOffset = -((time * 0.05) % 52);
    ctx.beginPath();
    ctx.arc(0, 0, rx - 8, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.primary, 0.9) : hexToRgba(COMPASS_VISUAL.primaryDark, 0.65);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.success, 0.35) : hexToRgba(COMPASS_VISUAL.mint, 0.12);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.55, 0, TAU);
    ctx.stroke();
    ctx.restore();

    this._drawArenaBoundaryLandmarks(ctx, day);
  }

  _drawArenaBoundaryLandmarks(ctx, day) {
    const landmarks = this.arenaBoundaryLandmarks;
    if (!landmarks?.length) return;
    for (const lm of landmarks) {
      ctx.save();
      ctx.translate(lm.x, lm.y);
      ctx.rotate(lm.ang);
      const pw = 72;
      const ph = 34;
      ctx.fillStyle = day ? hexToRgba(COMPASS_VISUAL.baseMid, 0.88) : hexToRgba(COMPASS_VISUAL.baseDark, 0.92);
      ctx.strokeStyle = hexToRgba(COMPASS_VISUAL.primary, day ? 0.55 : 0.4);
      ctx.lineWidth = 1.5;
      roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hexToRgba(COMPASS_VISUAL.info, 0.12);
      roundRect(ctx, -pw / 2 + 2, -ph / 2 + 2, pw - 4, 6, 3);
      ctx.fill();
      ctx.fillStyle = lm.label === "APPROVED" ? COMPASS_VISUAL.success : COMPASS_VISUAL.accent;
      ctx.fillRect(-pw / 2 + 4, -ph / 2 + 4, 10, 3);
      ctx.fillStyle = day ? COMPASS_VISUAL.content : COMPASS_VISUAL.info;
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lm.label, 0, 2);
      ctx.restore();
    }
  }

  _drawArenaLane(ctx, time) {
    if (this.n < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const day = isDayMode();
    const roadPattern = getCompassFloorPattern(ctx, `${day ? "day" : "night"}:road`);

    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.primary, 0.22) : hexToRgba(COMPASS_VISUAL.primary, 0.14);
    ctx.lineWidth = (this.halfWidth + 16) * 2;
    ctx.shadowColor = COMPASS_VISUAL.primary;
    ctx.shadowBlur = day ? 6 : 10;
    this.drawPath(ctx);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = roadPattern || (day ? COMPASS_VISUAL.baseMid : COMPASS_VISUAL.baseDark);
    ctx.lineWidth = this.halfWidth * 2;
    this.drawPath(ctx);
    ctx.stroke();

    // Sparse orange wayfinding ticks and purple center dashes mirror App Compass badges.
    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.accent, 0.56) : hexToRgba(COMPASS_VISUAL.accent, 0.28);
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 48]);
    ctx.lineDashOffset = -((time * 0.08) % 60);
    this.drawPath(ctx);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = day ? hexToRgba(COMPASS_VISUAL.primary, 0.75) : hexToRgba(COMPASS_VISUAL.primaryDark, 0.55);
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 32]);
    this.drawPath(ctx);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawRamps(ctx, time) {
    if (!this.ramps?.length) return;
    const day = isDayMode();
    for (const ramp of this.ramps) {
      ctx.save();
      ctx.translate(ramp.x, ramp.y);
      ctx.rotate(ramp.ang);
      if (ramp.kind === "bump") {
        const hw = ramp.w * 0.5;
        const hh = ramp.h * 0.5;
        ctx.fillStyle = "rgba(19,16,25,0.28)";
        roundRect(ctx, -hw + 2, -hh + 3, ramp.w, ramp.h, hh);
        ctx.fill();
        ctx.fillStyle = day ? "#e78b24" : "#754b20";
        ctx.strokeStyle = day ? COMPASS_VISUAL.accent : COMPASS_VISUAL.accentSoft;
        ctx.lineWidth = 1.5;
        roundRect(ctx, -ramp.w * 0.5, -ramp.h * 0.5, ramp.w, ramp.h, 4);
        ctx.fill();
        ctx.stroke();
        // Contour bands make the low rounded hump legible from overhead.
        for (let i = -1; i <= 1; i++) {
          const x = i * ramp.w * 0.22;
          const bandH = hh * (0.5 + (1 - Math.abs(i)) * 0.32);
          ctx.strokeStyle = i === 0 ? "rgba(255,255,255,0.72)" : "rgba(19,16,25,0.28)";
          ctx.lineWidth = i === 0 ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(x, -bandH); ctx.lineTo(x, bandH); ctx.stroke();
        }
      } else {
        const hw = ramp.w * 0.5;
        const hh = ramp.h * 0.5;
        const lipHalf = hh * 0.72;
        ctx.fillStyle = "rgba(19,16,25,0.32)";
        ctx.beginPath();
        ctx.moveTo(-hw + 3, -hh + 4);
        ctx.lineTo(-hw + 3, hh + 4);
        ctx.lineTo(hw + 3, lipHalf + 4);
        ctx.lineTo(hw + 3, -lipHalf + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = day ? "#332d50" : "#211c35";
        ctx.strokeStyle = day ? COMPASS_VISUAL.primary : COMPASS_VISUAL.primaryDark;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh);
        ctx.lineTo(-hw, hh);
        ctx.lineTo(hw, lipHalf);
        ctx.lineTo(hw, -lipHalf);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Rising contour bands communicate the real 3D slope without adding animation cost.
        for (let i = 1; i <= 3; i++) {
          const t = i / 4;
          const x = lerp(-hw, hw, t);
          const halfAtX = lerp(hh, lipHalf, t);
          ctx.strokeStyle = i === 3 ? COMPASS_VISUAL.accentSoft : hexToRgba(COMPASS_VISUAL.info, 0.38 + i * 0.12);
          ctx.lineWidth = i === 3 ? 2.5 : 1.5;
          ctx.beginPath(); ctx.moveTo(x, -halfAtX); ctx.lineTo(x, halfAtX); ctx.stroke();
        }
        ctx.fillStyle = day ? COMPASS_VISUAL.info : hexToRgba(COMPASS_VISUAL.info, 0.72);
        for (let i = 0; i < 3; i++) {
          const cx = -hw * 0.48 + i * hw * 0.42;
          ctx.beginPath();
          ctx.moveTo(cx - 7, -6);
          ctx.lineTo(cx + 3, 0);
          ctx.lineTo(cx - 7, 6);
          ctx.fill();
        }
        ctx.fillStyle = COMPASS_VISUAL.accent;
        ctx.fillRect(hw - 4, -lipHalf, 4, lipHalf * 2);
      }
      ctx.restore();
    }
  }

  _drawGrass(ctx) {
    const mapId = MAPS[game.selectedMapIdx || 0].id;
    const isDragon = mapId === "dragon_escape";
    const day = isDayMode();
    const dayPal = day ? getMapDayPalette(mapId) : null;

    // Approx visible world X range from context transform (for huge world culling)
    let minX = -500, maxX = WORLD_W + 500;
    const huge = WORLD_W > 10000;
    if (huge) {
      try {
        const m = ctx.getTransform();
        const invScale = 1 / Math.max(0.001, Math.abs(m.a || 1));
        const viewW = ctx.canvas ? ctx.canvas.width : 1280;
        minX = (-m.e * invScale) - 200;
        maxX = minX + viewW * invScale + 500;
      } catch (e) {}
      minX = Math.max(-500, minX);
      maxX = Math.min(WORLD_W + 500, maxX);
    }

    if (isDragon) {
      if (day && dayPal) {
        // Morning-mist green highlands (day)
        const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
        grad.addColorStop(0, dayPal.skyTop);
        grad.addColorStop(0.45, dayPal.skyMid);
        grad.addColorStop(1, dayPal.skyBot);
        ctx.fillStyle = grad;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);

        const layers = dayPal.mountainLayers || [];
        for (let m = 0; m < layers.length; m++) {
          const mh = 140 + m * 45;
          const my = WORLD_H * 0.18 + m * 110;
          ctx.fillStyle = layers[m];
          ctx.beginPath();
          ctx.moveTo(minX, my + mh);
          for (let x = minX; x <= maxX + 60; x += 60) {
            ctx.lineTo(x, my + mh - Math.sin((x + m * 200) * 0.003) * mh * 0.38 - Math.abs(Math.sin((x + m * 300) * 0.001)) * mh * 0.28);
          }
          ctx.lineTo(maxX + 500, WORLD_H + 500);
          ctx.lineTo(minX, WORLD_H + 500);
          ctx.closePath();
          ctx.fill();
        }

        ctx.strokeStyle = dayPal.bambooStroke || "rgba(60, 120, 70, 0.28)";
        ctx.lineWidth = 1.5;
        const grassStart = Math.max(0, Math.floor(minX / 40) * 40);
        const grassEnd   = Math.min(WORLD_W, Math.ceil(maxX / 40) * 40);
        for (let i = grassStart; i < grassEnd; i += 40) {
          const h = 22 + Math.sin(i * 0.05) * 14;
          const sway = Math.sin(i * 0.02 + performance.now() * 0.0005) * 4;
          ctx.beginPath();
          ctx.moveTo(i, WORLD_H * 0.45);
          ctx.quadraticCurveTo(i + sway, WORLD_H * 0.45 - h * 0.5, i + sway * 0.3, WORLD_H * 0.45 - h);
          ctx.stroke();
        }

        const centerX = WORLD_W / 2;
        const centerY = WORLD_H / 2;
        const glowR = Math.min(WORLD_W * 0.7, 3000);
        const glow = ctx.createRadialGradient(centerX, centerY, 100, centerX, centerY, glowR);
        glow.addColorStop(0, dayPal.glowInner || "rgba(200, 240, 210, 0.06)");
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);
      } else {
        // Japanese highland dusk scene (night — unchanged)
        const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
        grad.addColorStop(0, "#1a0c0c");
        grad.addColorStop(0.4, "#2d1810");
        grad.addColorStop(1, "#0d1a10");
        ctx.fillStyle = grad;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);

        // Far misty mountains (multiple layers) — capped to visible range
        for (let m = 0; m < 4; m++) {
          const mh = 150 + m * 50;
          const my = WORLD_H * 0.2 + m * 120;
          const alpha = 0.06 - m * 0.01;
          ctx.fillStyle = `rgba(${60 + m * 20}, ${30 + m * 10}, ${20 + m * 5}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(minX, my + mh);
          for (let x = minX; x <= maxX + 60; x += 60) {
            ctx.lineTo(x, my + mh - Math.sin((x + m * 200) * 0.003) * mh * 0.4 - Math.abs(Math.sin((x + m * 300) * 0.001)) * mh * 0.3);
          }
          ctx.lineTo(maxX + 500, WORLD_H + 500);
          ctx.lineTo(minX, WORLD_H + 500);
          ctx.closePath();
          ctx.fill();
        }

        // Bamboo / grass swaying on edges — capped
        ctx.strokeStyle = "rgba(20, 50, 20, 0.2)";
        ctx.lineWidth = 1.5;
        const grassStart = Math.max(0, Math.floor(minX / 40) * 40);
        const grassEnd   = Math.min(WORLD_W, Math.ceil(maxX / 40) * 40);
        for (let i = grassStart; i < grassEnd; i += 40) {
          const h = 20 + Math.sin(i * 0.05) * 15;
          const sway = Math.sin(i * 0.02 + performance.now() * 0.0005) * 5;
          ctx.beginPath();
          ctx.moveTo(i, WORLD_H * 0.45);
          ctx.quadraticCurveTo(i + sway, WORLD_H * 0.45 - h * 0.5, i + sway * 0.3, WORLD_H * 0.45 - h);
          ctx.stroke();
        }

        // Subtle radial glow centered on track
        const centerX = WORLD_W / 2;
        const centerY = WORLD_H / 2;
        const glowR = Math.min(WORLD_W * 0.7, 3000);
        const glow = ctx.createRadialGradient(centerX, centerY, 100, centerX, centerY, glowR);
        glow.addColorStop(0, "rgba(255, 80, 20, 0.04)");
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);
      }
    } else {
      const todKey = day ? "day" : "night";
      const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
      if (day && dayPal) {
        grad.addColorStop(0, dayPal.skyTop);
        grad.addColorStop(0.5, dayPal.skyMid);
        grad.addColorStop(1, dayPal.skyBot);
      } else {
        grad.addColorStop(0, COMPASS_VISUAL.skyNightTop);
        grad.addColorStop(1, COMPASS_VISUAL.skyNightBot);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(-500, -500, WORLD_W + 1000, WORLD_H + 1000);

      const grassKey = day ? `${todKey}:grass:${mapId}` : `${todKey}:grass`;
      const grassPattern = getCompassFloorPattern(ctx, grassKey);
      if (grassPattern) {
        ctx.fillStyle = grassPattern;
        ctx.fillRect(minX, -500, maxX - minX + 1000, WORLD_H + 1000);
      }
    }
  }

  _drawDecor(ctx) {
    const time = performance.now();
    const day = isDayMode();
    for (const p of this.decorations) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 0.003 + p.pulseOffset);
      const h = p.h * pulse;

      ctx.save();
      ctx.translate(p.x, p.y);

      if (p.isJapanese) {
        if (p.type === "lantern") {
          // Japanese paper lantern
          ctx.shadowBlur = 18 * pulse;
          ctx.shadowColor = p.color;
          ctx.fillStyle = hexToRgba(p.color, 0.35);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          // Rounded lantern body
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.5, p.r, h * 0.45, 0, 0, TAU);
          ctx.fill();
          ctx.stroke();
          // Top/bottom rings
          ctx.fillStyle = "#2a0a0a";
          ctx.fillRect(-p.r * 1.1, -h * 0.05, p.r * 2.2, 4);
          ctx.fillRect(-p.r * 1.1, -h * 0.95, p.r * 2.2, 4);
          // Glowing center
          ctx.shadowBlur = 0;
          ctx.fillStyle = hexToRgba("#ffeebb", 0.6);
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.5, p.r * 0.5, h * 0.2, 0, 0, TAU);
          ctx.fill();
        } else if (p.type === "torii") {
          // Mini torii gate
          const tw = p.r * 2.5;
          const th = h * 0.8;
          ctx.shadowBlur = 12 * pulse;
          ctx.shadowColor = "#c0392b";
          ctx.strokeStyle = "#c0392b";
          ctx.fillStyle = "#c0392b";
          ctx.lineWidth = 3;
          // Two vertical pillars
          ctx.fillRect(-tw * 0.35, -th, 5, th);
          ctx.fillRect(tw * 0.35 - 5, -th, 5, th);
          // Top crossbar (kasagi)
          ctx.fillStyle = "#a93226";
          ctx.fillRect(-tw * 0.55, -th - 4, tw * 1.1, 7);
          // Lower lintel (shimaki)
          ctx.fillStyle = "#c0392b";
          ctx.fillRect(-tw * 0.45, -th * 0.75, tw * 0.9, 4);
        } else {
          // Sakura cherry blossom tree
          ctx.shadowBlur = 0;
          // Trunk
          ctx.strokeStyle = "#5c3a21";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(p.r * 0.3, -h * 0.3, 0, -h * 0.6);
          ctx.stroke();
          // Branches
          ctx.strokeStyle = "#5c3a21";
          ctx.lineWidth = 1.5;
          for (let b = 0; b < 5; b++) {
            const ba = (b / 5) * Math.PI - Math.PI * 0.2;
            ctx.beginPath();
            ctx.moveTo(0, -h * 0.55);
            ctx.lineTo(Math.cos(ba) * p.r, -h * 0.55 + Math.sin(ba) * p.r * 0.5);
            ctx.stroke();
          }
          // Cherry blossom clusters
          ctx.shadowBlur = 8 * pulse;
          ctx.shadowColor = p.color;
          ctx.fillStyle = p.color;
          for (let c = 0; c < 6; c++) {
            const ca = (c / 6) * TAU + p.pulseOffset;
            const cr = p.r * 0.6;
            ctx.beginPath();
            ctx.arc(Math.cos(ca) * cr, -h * 0.55 + Math.sin(ca) * cr * 0.3, 3 + pulse * 2, 0, TAU);
            ctx.fill();
          }
        }
      } else {
        // Default cyberpunk pillar
        ctx.shadowBlur = day ? 8 * pulse : 15 * pulse;
        ctx.shadowColor = p.color;
        ctx.fillStyle = hexToRgba(p.color, day ? 0.10 : 0.15);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-p.r, 0);
        ctx.lineTo(-p.r, -h);
        ctx.quadraticCurveTo(0, -h - p.r * 0.4, p.r, -h);
        ctx.lineTo(p.r, 0);
        ctx.quadraticCurveTo(0, p.r * 0.4, -p.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = day ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h);
        ctx.stroke();
        ctx.fillStyle = day ? hexToRgba("#ffffff", 0.85) : "#ffffff";
        ctx.shadowBlur = day ? 4 : 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(0, -h, p.r * 0.35, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawStartLine(ctx) {
    const gate = this.startLineGate();
    if (!gate) return;
    const day = isDayMode();
    const px = gate.x;
    const py = gate.y;
    const ang = Math.atan2(gate.uy, gate.ux);
    const halfW = gate.halfW;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);

    // Digital glassmorphic road base band
    ctx.fillStyle = day ? "rgba(123, 117, 255, 0.22)" : "rgba(123, 117, 255, 0.35)";
    ctx.fillRect(-12, -halfW, 24, halfW * 2);

    // White / Cyan cyber checker
    const tiles = 12;
    const tileH = (halfW * 2) / tiles;
    for (let i = 0; i < tiles; i++) {
      ctx.fillStyle = i % 2 === 0 ? (day ? "#2a2840" : "#111") : "#7b75ff";
      ctx.fillRect(-12, -halfW + i * tileH, 12, tileH);
      ctx.fillStyle = i % 2 === 0 ? "#7b75ff" : (day ? "#2a2840" : "#111");
      ctx.fillRect(0, -halfW + i * tileH, 12, tileH);
    }

    // Arch supporting structures on the sides
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(0, side * (halfW + 15));
      ctx.fillStyle = day ? "#2a2548" : "#0d0b21";
      ctx.strokeStyle = "#7b75ff";
      ctx.lineWidth = 3;
      ctx.shadowBlur = day ? 4 : 10;
      ctx.shadowColor = "#7b75ff";
      ctx.fillRect(-8, -8, 16, 16);
      ctx.strokeRect(-8, -8, 16, 16);
      ctx.restore();
    }

    // Glassmorphic Overarching Sign Banner
    ctx.shadowBlur = day ? 6 : 15;
    ctx.shadowColor = "#7b75ff";
    ctx.fillStyle = day ? "rgba(42, 37, 72, 0.72)" : "rgba(6, 5, 20, 0.85)";
    ctx.strokeStyle = "#7b75ff";
    ctx.lineWidth = 2.5;
    ctx.fillRect(-90, -halfW - 32, 180, 24);
    ctx.strokeRect(-90, -halfW - 32, 180, 24);

    // Glowing Tech Text
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("REGULAIDO CORE MAINPORT", 0, -halfW - 20);

    ctx.restore();
  }

  drawItems(ctx, time) {
    // Boost pads
    for (const p of this.boostPads) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      const phase = (time * 0.01) % 1;
      // Base
      ctx.fillStyle = "#ffaa1f";
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      // Chevrons
      ctx.fillStyle = "#fff";
      for (let i = -1; i <= 1; i++) {
        const off = (i * 22 + phase * 22) % 44 - 22;
        ctx.beginPath();
        ctx.moveTo(off - 8, -p.h / 2 + 4);
        ctx.lineTo(off + 6, 0);
        ctx.lineTo(off - 8, p.h / 2 - 4);
        ctx.lineTo(off - 2, 0);
        ctx.closePath();
        ctx.fill();
      }
      // Glow
      ctx.shadowBlur = 14;
      ctx.shadowColor = "#ffd86b";
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    // Coins (Spinning digital data tokens)
    for (const c of this.coins) {
      if (c.collected) continue;
      const sx = Math.sin(c.spin);
      ctx.save();
      ctx.translate(c.x, c.y);

      // Glow
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#fd9927";

      // Outer neon code ring
      ctx.strokeStyle = "#fd9927";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(9 * sx), 9, 0, 0, TAU);
      ctx.stroke();

      // Inner byte symbol
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.scale(sx, 1);
      ctx.fillText("PMC", 0, 0);
      ctx.restore();

      ctx.restore();
    }

    // Item boxes (Floating 3D-like rotating neon hypercubes)
    for (const b of this.itemBoxes) {
      if (!b.active) continue;
      ctx.save();
      ctx.translate(b.x, b.y);

      const rot = b.spin + time * 0.002;
      const pulse = 0.8 + 0.2 * Math.sin(time * 0.008);
      const sz = 15 * pulse;

      // Pulsing Neon glow
      ctx.shadowBlur = 20 * pulse;
      ctx.shadowColor = "#7b75ff";
      ctx.strokeStyle = "#7b75ff";
      ctx.lineWidth = 1.5;

      ctx.save();
      ctx.rotate(rot);
      ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
      ctx.restore();

      ctx.strokeStyle = "#ff4d6d";
      ctx.shadowColor = "#ff4d6d";
      ctx.save();
      ctx.rotate(-rot * 0.7);
      ctx.strokeRect(-sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();

      // Neon question mark in the dead center
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 0);

      ctx.restore();
    }
  }
}

/* ============================================================
   PARTICLES
   ============================================================ */
// Checkpoint 2: bounded 2D FX pools (documented caps)
const PARTICLE_2D_MAX = 360;
const PARTICLE_2D_IMPORTANT_RESERVE = 80;
const SKID_2D_MAX = 400;
const COMPASS_FX_3D_OVERLAY_MAX = 24;
const APPROVAL_TOKEN_FRAMES = 40;

function particleTrimPriority(p) {
  if (p.type === "approvalToken") return 100;
  if (p.type === "text" && p.text && /APPROVAL|STOLEN|\+1|REVOKED/i.test(p.text)) return 85;
  if (p.compassFx) return 70;
  if (p.type === "text") return 55;
  if (p.type === "ring") return 45;
  if (p.type === "line") return 35;
  return 15;
}

function isImportantParticle(p) {
  return particleTrimPriority(p) >= 70;
}

