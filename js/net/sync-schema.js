import { lerp, dist, angleDiff } from "../core/math.js";

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

function readPacketValue(p, desc) {
  const verboseKey = desc.field;
  const compactKey = desc.compact;
  if (verboseKey !== undefined && p[verboseKey] !== undefined) return p[verboseKey];
  if (compactKey !== undefined && compactKey !== verboseKey && p[compactKey] !== undefined) {
    return p[compactKey];
  }
  return undefined;
}

function applyPositionGroup(kart, p, opts) {
  const px = p.x;
  const py = p.y;
  const ph = p.heading !== undefined ? p.heading : p.h;
  const pvx = p.vx !== undefined ? p.vx : 0;
  const pvy = p.vy !== undefined ? p.vy : 0;
  const pFinished = p.finished !== undefined ? p.finished : p.fin;
  const pElim = p.eliminated !== undefined ? p.eliminated : p.elim;

  const preserveBattleAuthority = !!opts.preserveBattleAuthority;
  const effectiveFinished = preserveBattleAuthority ? kart.finished : pFinished;
  const effectiveEliminated = preserveBattleAuthority ? kart.eliminated : pElim;
  const smooth = !!opts.smooth && !effectiveFinished && !effectiveEliminated;

  if (smooth && Number.isFinite(kart.x) && Number.isFinite(kart.y)) {
    const lead = opts.velocityLead ?? 0;
    const snapDist = opts.snapDist ?? 0;
    const interp = opts.interp ?? 0;
    const targetX = px + pvx * lead;
    const targetY = py + pvy * lead;
    const delta = dist(kart.x, kart.y, targetX, targetY);
    if (delta > snapDist) {
      kart.x = px;
      kart.y = py;
      kart.heading = ph;
    } else {
      kart.x = lerp(kart.x, targetX, interp);
      kart.y = lerp(kart.y, targetY, interp);
      kart.heading += angleDiff(kart.heading, ph) * interp;
    }
  } else {
    kart.x = px;
    kart.y = py;
    kart.heading = ph;
  }

  kart.vx = pvx;
  kart.vy = pvy;
  kart.z = Number.isFinite(p.z) ? p.z : 0;
  kart.vz = Number.isFinite(p.vz) ? p.vz : 0;
  kart._lastSyncAt = opts.now ?? performance.now();
}

// Ordered for compact wire format (matches legacy serializeKartCompact literal order).
export const KART_SYNC_FIELDS = [
  {
    field: "x",
    compact: "x",
    serializeCompact: (k) => round1(k.x),
    apply: () => {},
  },
  {
    field: "y",
    compact: "y",
    serializeCompact: (k) => round1(k.y),
    apply: () => {},
  },
  {
    field: "heading",
    compact: "h",
    serializeCompact: (k) => round3(k.heading),
    apply: () => {},
  },
  {
    field: "vx",
    compact: "vx",
    serializeCompact: (k) => round2(k.vx),
    apply: () => {},
  },
  {
    field: "vy",
    compact: "vy",
    serializeCompact: (k) => round2(k.vy),
    apply: () => {},
  },
  {
    field: "boostTimer",
    compact: "bt",
    serializeVerbose: (k) => k.boostTimer,
    serializeCompact: (k) => (k.boostTimer > 0 ? k.boostTimer : undefined),
    apply: (kart, v) => { kart.boostTimer = v ?? 0; },
  },
  {
    field: "citationBoostTimer",
    compact: "cbt",
    serializeVerbose: (k) => k.citationBoostTimer || 0,
    serializeCompact: (k) => (k.citationBoostTimer > 0 ? k.citationBoostTimer : undefined),
    apply: (kart, v) => { kart.citationBoostTimer = v ?? 0; },
  },
  {
    field: "shieldTimer",
    compact: "st",
    serializeVerbose: (k) => k.shieldTimer,
    serializeCompact: (k) => (k.shieldTimer > 0 ? k.shieldTimer : undefined),
    apply: (kart, v) => { kart.shieldTimer = v ?? 0; },
  },
  {
    field: "doubleBlindTimer",
    compact: "dbt",
    serializeVerbose: (k) => k.doubleBlindTimer || 0,
    serializeCompact: (k) => (k.doubleBlindTimer > 0 ? k.doubleBlindTimer : undefined),
    apply: (kart, v) => { kart.doubleBlindTimer = v ?? 0; },
  },
  {
    field: "placeboSlowTimer",
    compact: "pst",
    serializeVerbose: (k) => k.placeboSlowTimer || 0,
    serializeCompact: (k) => (k.placeboSlowTimer > 0 ? k.placeboSlowTimer : undefined),
    apply: (kart, v) => { kart.placeboSlowTimer = v ?? 0; },
  },
  {
    field: "throttleLockTimer",
    compact: "tlt",
    serializeVerbose: (k) => k.throttleLockTimer || 0,
    serializeCompact: (k) => (k.throttleLockTimer > 0 ? k.throttleLockTimer : undefined),
    apply: (kart, v) => { kart.throttleLockTimer = v ?? 0; },
  },
  {
    field: "amendmentTimer",
    compact: "amt",
    serializeVerbose: (k) => k.amendmentTimer || 0,
    serializeCompact: (k) => (k.amendmentTimer > 0 ? k.amendmentTimer : undefined),
    apply: (kart, v) => { kart.amendmentTimer = v ?? 0; },
  },
  {
    field: "itemSlot",
    compact: "it",
    serializeVerbose: (k) => k.itemSlot,
    serializeCompact: (k) => k.itemSlot || undefined,
    apply: (kart, v) => { kart.itemSlot = v ?? null; },
  },
  {
    field: "itemState",
    compact: "is",
    serializeVerbose: (k) => k.itemState,
    serializeCompact: (k) => (k.itemState !== "empty" ? k.itemState : undefined),
    apply: (kart, v) => { kart.itemState = v ?? "empty"; },
  },
  {
    field: "finished",
    compact: "fin",
    serializeVerbose: (k) => k.finished,
    serializeCompact: (k) => k.finished || undefined,
    authority: "host",
    apply: (kart, v, opts) => {
      if (!opts.preserveBattleAuthority) kart.finished = v || false;
    },
  },
  {
    field: "eliminated",
    compact: "elim",
    serializeVerbose: (k) => !!k.eliminated,
    serializeCompact: (k) => k.eliminated || undefined,
    authority: "host",
    apply: (kart, v, opts) => {
      if (!opts.preserveBattleAuthority && v !== undefined) kart.eliminated = !!v;
    },
  },
  {
    field: "lap",
    compact: "lap",
    serializeVerbose: (k) => k.lap,
    serializeCompact: (k) => k.lap,
    apply: (kart, v) => { kart.lap = v; },
  },
  {
    field: "nextCheckpoint",
    compact: "nc",
    serializeVerbose: (k) => k.nextCheckpoint,
    serializeCompact: (k) => k.nextCheckpoint,
    applyAbsent: true,
    apply: (kart, v) => { kart.nextCheckpoint = v; },
  },
  {
    field: "checkpointsThisLap",
    compact: "cl",
    serializeVerbose: (k) => k.checkpointsThisLap,
    serializeCompact: (k) => k.checkpointsThisLap,
    applyAbsent: true,
    apply: (kart, v) => { kart.checkpointsThisLap = v; },
  },
  {
    field: "finishTime",
    compact: "ft",
    serializeVerbose: (k) => k.finishTime,
    serializeCompact: (k) => k.finishTime || undefined,
    applyAbsent: true,
    apply: (kart, v) => { kart.finishTime = v; },
  },
  {
    field: "activeQuote",
    compact: "aq",
    serializeVerbose: (k) => k.activeQuote,
    serializeCompact: (k) => k.activeQuote || undefined,
    apply: (kart, v) => { kart.activeQuote = v ?? null; },
  },
  {
    field: "quoteTimer",
    compact: "qt",
    serializeVerbose: (k) => k.quoteTimer,
    serializeCompact: (k) => (k.quoteTimer > 0 ? k.quoteTimer : undefined),
    apply: (kart, v) => { kart.quoteTimer = v ?? 0; },
  },
  {
    field: "spinoutTimer",
    compact: "sp",
    serializeVerbose: (k) => k.spinoutTimer,
    serializeCompact: (k) => (k.spinoutTimer > 0 ? k.spinoutTimer : undefined),
    apply: (kart, v, opts) => {
      const incoming = v ?? 0;
      kart.spinoutTimer = opts.preserveBattleAuthority
        ? Math.max(kart.spinoutTimer || 0, incoming)
        : incoming;
    },
  },
  {
    field: "coinsCollected",
    compact: "cc",
    serializeVerbose: (k) => k.coinsCollected,
    serializeCompact: (k) => k.coinsCollected || undefined,
    apply: (kart, v) => { kart.coinsCollected = v ?? 0; },
  },
  {
    field: "mergePullTimer",
    compact: "mp",
    serializeVerbose: (k) => k.mergePullTimer || 0,
    serializeCompact: (k) => (k.mergePullTimer > 0 ? k.mergePullTimer : undefined),
    authority: "host",
    apply: (kart, v, opts) => {
      if (opts.preserveBattleAuthority) return;
      kart.mergePullTimer = v ?? 0;
    },
  },
  {
    field: "mergePullTargetId",
    compact: "mt",
    serializeVerbose: (k) => k.mergePullTargetId || null,
    serializeCompact: (k) => k.mergePullTargetId || undefined,
    authority: "host",
    apply: (kart, v, opts) => {
      if (opts.preserveBattleAuthority) return;
      kart.mergePullTargetId = v ?? null;
      kart.mergePullTarget = opts.resolveKartById ? opts.resolveKartById(kart.mergePullTargetId) : null;
    },
  },
  {
    field: "ultCharge",
    compact: "uc",
    serializeVerbose: (k) => k.ultCharge || 0,
    serializeCompact: (k) => (k.ultCharge > 0 ? Math.round(k.ultCharge) : undefined),
    applyAbsent: true,
    apply: (kart, v) => { kart.ultCharge = v ?? 0; },
  },
  {
    field: "ultReady",
    compact: "ur",
    serializeVerbose: (k) => !!k.ultReady,
    serializeCompact: (k) => k.ultReady || undefined,
    applyAbsent: true,
    apply: (kart, v) => { kart.ultReady = !!v; },
  },
  {
    field: "ultActiveTimer",
    compact: "ua",
    serializeVerbose: (k) => k.ultActiveTimer || 0,
    serializeCompact: (k) => (k.ultActiveTimer > 0 ? k.ultActiveTimer : undefined),
    applyAbsent: true,
    apply: (kart, v) => { kart.ultActiveTimer = v ?? 0; },
  },
  {
    field: "ultTier",
    compact: "ut",
    serializeVerbose: (k) => k.ultTier || 0,
    serializeCompact: (k) => (k.ultTier > 0 ? k.ultTier : undefined),
    applyAbsent: true,
    apply: (kart, v) => { kart.ultTier = v ?? 0; },
  },
  {
    field: "z",
    compact: "z",
    serializeVerbose: (k) => k.z || 0,
    serializeCompact: (k) => ((k.z > 0.05) ? round1(k.z) : undefined),
    apply: () => {},
  },
  {
    field: "vz",
    compact: "vz",
    serializeVerbose: (k) => k.vz || 0,
    serializeCompact: (k) => ((k.vz && Math.abs(k.vz) > 0.05) ? round2(k.vz) : undefined),
    apply: () => {},
  },
];

// Legacy verbose serializer uses a different key order than compact.
const VERBOSE_FIELD_ORDER = [
  "x", "y", "heading", "vx", "vy",
  "boostTimer", "citationBoostTimer", "shieldTimer", "doubleBlindTimer",
  "placeboSlowTimer", "throttleLockTimer", "amendmentTimer",
  "itemSlot", "itemState", "finished", "eliminated", "lap",
  "nextCheckpoint", "checkpointsThisLap", "finishTime",
  "activeQuote", "quoteTimer", "spinoutTimer", "coinsCollected",
  "mergePullTimer", "mergePullTargetId",
  "ultCharge", "ultReady", "ultActiveTimer", "ultTier",
  "z", "vz",
];

// Legacy compact literal order (differs from verbose for timer fields).
const COMPACT_FIELD_ORDER = [
  "x", "y", "heading", "vx", "vy",
  "boostTimer", "shieldTimer", "spinoutTimer",
  "itemSlot", "itemState", "finished", "eliminated", "lap",
  "activeQuote", "quoteTimer", "coinsCollected",
  "mergePullTimer", "mergePullTargetId",
  "ultCharge", "ultReady", "ultActiveTimer", "ultTier",
  "citationBoostTimer", "doubleBlindTimer", "placeboSlowTimer",
  "throttleLockTimer", "amendmentTimer",
  "nextCheckpoint", "checkpointsThisLap", "finishTime",
  "z", "vz",
];

const BATTLE_COMPACT_FIELDS = [
  {
    field: "approvals",
    compact: "ap",
    includeBattle: (k, ctx) => ctx.battle || k.approvals !== undefined,
    serializeCompact: (k) => k.approvals ?? 0,
    applyAbsent: true,
    apply: (kart, v) => { if (v !== undefined) kart.approvals = v; },
  },
  {
    field: "battleSteals",
    compact: "bs",
    includeBattle: (k, ctx) => ctx.battle || k.approvals !== undefined,
    serializeCompact: (k) => k.battleSteals || 0,
    applyAbsent: true,
    apply: (kart, v) => { if (v !== undefined) kart.battleSteals = v; },
  },
  {
    field: "recoverGraceTimer",
    compact: "rg",
    includeBattle: (k, ctx) => ctx.battle || k.approvals !== undefined,
    serializeCompact: (k) => k.recoverGraceTimer || 0,
    applyAbsent: true,
    apply: (kart, v) => { if (v !== undefined) kart.recoverGraceTimer = v; },
  },
  {
    field: "killedBy",
    compact: "kb",
    includeBattle: (k, ctx) => ctx.battle || k.approvals !== undefined,
    serializeCompact: (k, ctx) => (k.killedBy ? ctx.getKartId(k.killedBy) : null),
    applyAbsent: true,
    apply: (kart, v, opts) => {
      if (v === undefined) return;
      kart.killedBy = v ? (opts.resolveKartById ? opts.resolveKartById(v) : null) : null;
    },
  },
];

const fieldByName = new Map(KART_SYNC_FIELDS.map((desc) => [desc.field, desc]));

function serializeVerboseValue(desc, k) {
  if (desc.serializeVerbose) return desc.serializeVerbose(k);
  return k[desc.field];
}

function serializeCompactValue(desc, k, ctx) {
  if (desc.serializeCompact) return desc.serializeCompact(k, ctx);
  return k[desc.field];
}

export function serializeKart(k, ctx = {}, options = {}) {
  if (!k) return null;
  const compact = !!options.compact;
  const out = {};

  if (compact) {
    for (const name of COMPACT_FIELD_ORDER) {
      const desc = fieldByName.get(name);
      out[desc.compact] = serializeCompactValue(desc, k, ctx);
    }

    const battle = ctx.battle || k.approvals !== undefined;
    if (battle) {
      for (const desc of BATTLE_COMPACT_FIELDS) {
        if (!desc.includeBattle(k, ctx)) continue;
        out[desc.compact] = desc.serializeCompact(k, ctx);
      }
      out.mp = k.mergePullTimer || 0;
      out.mt = k.mergePullTargetId || null;
    }
  } else {
    for (const name of VERBOSE_FIELD_ORDER) {
      const desc = fieldByName.get(name);
      out[desc.field] = serializeVerboseValue(desc, k);
    }
  }

  return out;
}

export function applyKartSync(kart, p, opts = {}) {
  if (!kart || !p) return;

  applyPositionGroup(kart, p, opts);

  for (const desc of KART_SYNC_FIELDS) {
    if (desc.field === "x" || desc.field === "y" || desc.field === "heading"
      || desc.field === "vx" || desc.field === "vy" || desc.field === "z" || desc.field === "vz") {
      continue;
    }
    if (desc.authority === "host" && opts.preserveBattleAuthority) continue;

    const value = readPacketValue(p, desc);
    if (desc.applyAbsent && value === undefined) continue;
    if (desc.apply) desc.apply(kart, value, opts);
  }

  for (const desc of BATTLE_COMPACT_FIELDS) {
    const value = readPacketValue(p, desc);
    if (value === undefined) continue;
    if (desc.apply) desc.apply(kart, value, opts);
  }
}
