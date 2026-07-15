import { clamp, TAU } from "../core/math.js";

// Seeded PRNG (mulberry32) for deterministic dragon trail generation
function seededRng(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _dragonTrailSeed = Math.floor(Math.random() * 2147483647);

function generateDragonTrail(seed) {
  if (seed !== undefined) _dragonTrailSeed = seed;
  const rng = seededRng(_dragonTrailSeed);
  const wp = [];
  let x = 400, y = 1200;
  wp.push({ x, y });
  const xmax = 490000;
  let i = 0;
  while (x < xmax) {
    const segLen = 350 + rng() * 400;
    let targetY = 1000 + Math.sin(i * 0.07) * 300 + Math.cos(i * 0.12) * 180 + Math.sin(i * 0.19) * 80;
    if (i % 40 > 35) {
      targetY = 300 + rng() * 1200;
    }
    let dy = (targetY - y) * 0.12 + Math.sin(i * 0.3) * 40;
    dy = clamp(dy, -200, 200);
    y += dy;
    y = clamp(y, 400, 1600);
    x += segLen;
    wp.push({ x: Math.round(x), y: Math.round(y) });
    i++;
    if (rng() < 0.015 && x < xmax - 2000) {
      const backSteps = 2 + Math.floor(rng() * 3);
      for (let b = 0; b < backSteps; b++) {
        x += segLen * 0.3;
        y += (rng() > 0.5 ? 1 : -1) * (200 + rng() * 300);
        y = clamp(y, 400, 1600);
        wp.push({ x: Math.round(x), y: Math.round(y) });
        i++;
      }
    }
  }
  return wp;
}

const MAPS = [
  {
    name: "Core Mainframe Circuit",
    id: "core_mainframe",
    musicTrack: 0,
    worldW: 3400,
    worldH: 2400,
    waypoints: [
      { x:  650, y: 1900 },
      { x: 1500, y: 1900 },
      { x: 2100, y: 1850 },
      { x: 2600, y: 1700 },
      { x: 2900, y: 1480 },
      { x: 2950, y: 1180 },
      { x: 2780, y:  900 },
      { x: 2520, y:  720 },
      { x: 2200, y:  680 },
      { x: 1950, y:  830 },
      { x: 1800, y: 1080 },
      { x: 1620, y:  860 },
      { x: 1350, y:  690 },
      { x: 1020, y:  680 },
      { x:  720, y:  820 },
      { x:  470, y: 1080 },
      { x:  370, y: 1380 },
      { x:  390, y: 1700 },
      { x:  500, y: 1880 },
    ],
    roadHalfBase: 95,
    segWidth: {
      9: 0.78,
      10: 0.66,
      11: 0.74,
    },
    boostPadSegs: [0, 4, 13],
    itemBoxSegs: [2, 6, 10, 14],
    desc: "The classic Regulaido test speedway. High-speed straightaways and a tight, twisting chicane."
  },
  {
    name: "Compliance Chicane",
    id: "compliance_chicane",
    musicTrack: 1,
    worldW: 2400,
    worldH: 2400,
    waypoints: [
      { x:  500, y: 1900 },
      { x: 1900, y: 1900 },
      { x: 1900, y: 1200 },
      { x: 1300, y: 1200 },
      { x: 1300, y:  800 },
      { x: 1900, y:  500 },
      { x: 1200, y:  400 },
      { x:  500, y:  400 },
      { x:  500, y:  900 },
      { x: 1000, y: 1200 },
      { x:  500, y: 1500 },
    ],
    roadHalfBase: 85,
    segWidth: {
      2: 0.82,
      3: 0.82,
      9: 0.62,
    },
    boostPadSegs: [0, 5, 8],
    itemBoxSegs: [1, 4, 7, 10],
    desc: "Highly technical micro-circuit with acute 90° corners, double-back chicanes, and narrow tunnels."
  },
  {
    name: "Audit Super Ring",
    id: "audit_super_ring",
    musicTrack: 3,
    worldW: 3600,
    worldH: 2000,
    waypoints: [
      { x:  600, y: 1500 },
      { x: 1800, y: 1600 },
      { x: 3000, y: 1500 },
      { x: 3200, y: 1000 },
      { x: 2600, y:  500 },
      { x: 1000, y:  500 },
      { x:  400, y: 1000 },
    ],
    roadHalfBase: 110,
    segWidth: {},
    boostPadSegs: [1, 4, 5],
    itemBoxSegs: [0, 2, 3, 6],
    desc: "A giant wide-lane speed ring with gentle sweeps designed for massive drifts and continuous boost chaining."
  },
  {
    name: "Black Ice Data Vault",
    id: "black_ice_data_vault",
    musicTrack: 4,
    worldW: 4200,
    worldH: 2800,
    waypoints: [
      { x:  520, y: 2280 },
      { x: 1260, y: 2320 },
      { x: 1900, y: 2140 },
      { x: 2200, y: 1840 },
      { x: 1640, y: 1600 },
      { x:  900, y: 1660 },
      { x:  620, y: 1320 },
      { x:  820, y:  900 },
      { x: 1420, y:  720 },
      { x: 2020, y:  920 },
      { x: 2460, y:  560 },
      { x: 3280, y:  520 },
      { x: 3720, y:  900 },
      { x: 3500, y: 1320 },
      { x: 2840, y: 1360 },
      { x: 2500, y: 1660 },
      { x: 3120, y: 2000 },
      { x: 3740, y: 2220 },
      { x: 3380, y: 2580 },
      { x: 2360, y: 2460 },
      { x: 1600, y: 2580 },
      { x:  880, y: 2540 },
    ],
    roadHalfBase: 88,
    segWidth: {
      3: 0.68,
      4: 0.72,
      6: 0.74,
      9: 0.70,
      13: 0.66,
      15: 0.78,
      18: 0.72
    },
    boostPadSegs: [1, 7, 11, 16, 19],
    itemBoxSegs: [2, 5, 8, 12, 15, 20],
    movingObjects: [
      { seg: 3, t: 0.48, amp: 85, speed: 1.15, phase: 0.0, color: "#ff4d6d" },
      { seg: 6, t: 0.56, amp: 72, speed: 1.35, phase: 1.7, color: "#57f2ff" },
      { seg: 9, t: 0.50, amp: 78, speed: 1.05, phase: 3.2, color: "#fd9927" },
      { seg: 13, t: 0.58, amp: 92, speed: 1.25, phase: 4.4, color: "#a4ff80" },
      { seg: 18, t: 0.44, amp: 80, speed: 1.55, phase: 2.2, color: "#bd57ff" }
    ],
    desc: "A brutal vault breach with hairpins, split-flow switchbacks, narrow ice corridors, and moving firewall gates."
  },
  {
    name: "Regulatory Dragon Run",
    id: "regulatory_dragon_run",
    musicTrack: 5,
    worldW: 6600,
    worldH: 1900,
    waypoints: [
      { x:  520, y: 1320 },
      { x: 1300, y: 1320 },
      { x: 2180, y: 1280 },
      { x: 3180, y: 1320 },
      { x: 4200, y: 1280 },
      { x: 5200, y: 1320 },
      { x: 6020, y: 1180 },
      { x: 6260, y:  880 },
      { x: 5900, y:  540 },
      { x: 4920, y:  480 },
      { x: 3700, y:  520 },
      { x: 2460, y:  500 },
      { x: 1320, y:  560 },
      { x:  620, y:  820 },
    ],
    roadHalfBase: 118,
    segWidth: {
      0: 1.18,
      1: 1.12,
      2: 1.20,
      3: 1.22,
      4: 1.18,
      5: 1.20,
      6: 1.14,
      7: 1.10,
      8: 1.26,
      9: 1.18,
      10: 1.22,
      11: 1.18,
      12: 1.10,
      13: 1.20,
    },
    boostPadSegs: [2, 6, 9, 12],
    itemBoxSegs: [0, 3, 5, 8, 11, 13],
    regulatoryDragon: {
      startX: -180,
      startY: 1320,
      baseGap: 360,
      minGap: 190,
      closeSeconds: 85,
      fireEvery: 88
    },
    desc: "A high-stakes regulatory audit track with a massive bureaucratic dragon chasing you. Dodge firewalls, compliance gates, and audit trails while the Regulatory Dragon breathes down your neck!"
  },
  {
    name: "Protocol Amendment Labyrinth",
    id: "protocol_amendment_labyrinth",
    musicTrack: 2,
    worldW: 4100,
    worldH: 2500,
    waypoints: [
      { x:  520, y: 2140 },
      { x: 1180, y: 2140 },
      { x: 1700, y: 1980 },
      { x: 2220, y: 2160 },
      { x: 3080, y: 2100 },
      { x: 3600, y: 1680 },
      { x: 3180, y: 1320 },
      { x: 2500, y: 1320 },
      { x: 2920, y:  940 },
      { x: 3500, y:  620 },
      { x: 2840, y:  360 },
      { x: 2060, y:  520 },
      { x: 1500, y:  380 },
      { x:  760, y:  600 },
      { x:  460, y: 1020 },
      { x:  900, y: 1320 },
      { x:  520, y: 1620 },
      { x:  840, y: 1900 },
    ],
    checkpointGroups: [
      [{ x:  520, y: 2140, r: 90 }],
      [{ x: 1180, y: 2140, r: 90 }],
      [{ x: 1700, y: 1980, r: 92 }, { x: 1700, y: 1840, r: 92 }],
      [{ x: 2220, y: 2160, r: 95 }, { x: 2240, y: 2030, r: 95 }],
      [{ x: 3080, y: 2100, r: 95 }, { x: 3060, y: 1950, r: 95 }],
      [{ x: 3600, y: 1680, r: 90 }],
      [{ x: 3180, y: 1320, r: 90 }],
      [{ x: 2500, y: 1320, r: 95 }, { x: 2500, y: 1190, r: 95 }],
      [{ x: 2920, y:  940, r: 95 }, { x: 2740, y:  960, r: 95 }],
      [{ x: 3500, y:  620, r: 90 }],
      [{ x: 2840, y:  360, r: 90 }],
      [{ x: 2060, y:  520, r: 92 }, { x: 2060, y:  650, r: 92 }],
      [{ x: 1500, y:  380, r: 90 }],
      [{ x:  760, y:  600, r: 90 }],
      [{ x:  460, y: 1020, r: 90 }],
      [{ x:  900, y: 1320, r: 92 }, { x:  780, y: 1320, r: 92 }, { x: 1020, y: 1320, r: 92 }],
      [{ x:  520, y: 1620, r: 90 }],
      [{ x:  840, y: 1900, r: 90 }],
    ],
    roadHalfBase: 92,
    segWidth: {
      1: 1.18,
      2: 1.65,
      3: 1.62,
      6: 1.12,
      7: 1.55,
      8: 1.34,
      10: 1.18,
      11: 1.45,
      15: 1.42,
    },
    boostPadSegs: [1, 4, 8, 12, 16],
    itemBoxSegs: [2, 5, 7, 10, 14],
    movingObjects: [
      { seg: 2, t: 0.50, amp: 95, speed: 1.22, phase: 0.8, color: "#a4ff80", kind: "amend", label: "AMEND", hitLabel: "AMENDMENT!" },
      { seg: 7, t: 0.52, amp: 82, speed: 1.38, phase: 2.4, color: "#57f2ff", kind: "clause", label: "CLAUSE", hitLabel: "CLAUSE TRAP!" },
      { seg: 11, t: 0.48, amp: 88, speed: 1.08, phase: 4.1, color: "#ff4d6d", kind: "redline", label: "REDLINE", hitLabel: "REDLINED!" },
      { seg: 15, t: 0.50, amp: 76, speed: 1.52, phase: 1.6, color: "#fd9927", kind: "signoff", label: "SIGNOFF", hitLabel: "SIGNOFF BLOCK!" }
    ],
    desc: "A split-lane protocol maze with amendment gates, risky inside lines, safer outer detours, and chiptune route-choice pressure."
  },
  {
    name: "Dragon's Escape",
    id: "dragon_escape",
    musicTrack: 2,
    worldW: 490000,
    worldH: 2000,
    waypoints: generateDragonTrail(),
    roadHalfBase: 110,
    segWidth: {},
    boostPadSegs: [],
    itemBoxSegs: [],
    desc: "INFINITE SURVIVAL: True open-ended trail. Drive right forever. Dragon hunts from your left. Speed ramps forever. One hit = dead. How far can you escape?"
  },
  {
    name: "Compliance Colosseum",
    id: "battle_arena",
    arena: true,
    musicTrack: 3,
    worldW: 2800,
    worldH: 2800,
    arenaFloor: { cx: 1400, cy: 1400, rx: 1180, ry: 1180 },
    reviewPlatformRadius: 300,
    waypoints: (() => {
      const c = 1400, r = 1020;
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU - Math.PI / 2;
        pts.push({ x: c + r * Math.cos(a), y: c + r * Math.sin(a) });
      }
      return pts;
    })(),
    roadHalfBase: 280,
    segWidth: {},
    boostPadSegs: [1, 3, 5, 7, 9, 11],
    itemBoxSegs: [0, 2, 4, 6, 8, 10],
    ramps: [
      { x: 1400, y: 260, ang: Math.PI / 2, w: 130, h: 44, kind: "ramp", impulse: 5.8, minSpeed: 3.2 },
      { x: 1400, y: 2540, ang: -Math.PI / 2, w: 130, h: 44, kind: "ramp", impulse: 5.8, minSpeed: 3.2 },
      { x: 2540, y: 1400, ang: Math.PI, w: 130, h: 44, kind: "ramp", impulse: 5.8, minSpeed: 3.2 },
      { x: 260, y: 1400, ang: 0, w: 130, h: 44, kind: "ramp", impulse: 5.8, minSpeed: 3.2 },
      { x: 1400, y: 520, ang: 0, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 1980, y: 820, ang: Math.PI / 4, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 2280, y: 1400, ang: Math.PI / 2, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 1980, y: 1980, ang: (3 * Math.PI) / 4, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 1400, y: 2280, ang: Math.PI, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 820, y: 1980, ang: (-3 * Math.PI) / 4, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 520, y: 1400, ang: -Math.PI / 2, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
      { x: 820, y: 820, ang: -Math.PI / 4, w: 58, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.2 },
    ],
    desc: "SYMMETRIC ARENA BATTLE: Wide circular floor, cardinal launch ramps, and a central review platform. Jump over hazards and ram rivals to steal Approvals."
  },
  {
    name: "Open Enforcement Grounds",
    id: "battle_open_arena",
    arena: true,
    musicTrack: 3,
    worldW: 3600,
    worldH: 2600,
    arenaFloor: { cx: 1800, cy: 1300, rx: 1550, ry: 1050 },
    reviewPlatformRadius: 0,
    waypoints: (() => {
      const cx = 1800, cy = 1300, rx = 1280, ry = 820;
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      }
      return pts;
    })(),
    roadHalfBase: 220,
    segWidth: { 0: 1.35, 5: 1.35 },
    boostPadSegs: [2, 7],
    itemBoxSegs: [1, 6],
    ramps: [
      { x: 320, y: 1300, ang: 0, w: 200, h: 52, kind: "ramp", impulse: 5.8, minSpeed: 4.5 },
      { x: 3280, y: 1300, ang: Math.PI, w: 200, h: 52, kind: "ramp", impulse: 5.8, minSpeed: 4.5 },
      { x: 1800, y: 220, ang: Math.PI / 2, w: 140, h: 44, kind: "ramp", impulse: 5.8, minSpeed: 3.5 },
      { x: 1800, y: 2380, ang: -Math.PI / 2, w: 140, h: 44, kind: "ramp", impulse: 5.8, minSpeed: 3.5 },
      { x: 2550, y: 900, ang: Math.PI / 6, w: 62, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.5 },
      { x: 1050, y: 1700, ang: (-5 * Math.PI) / 6, w: 62, h: 20, kind: "bump", impulse: 2.7, minSpeed: 2.5 },
    ],
    desc: "OPEN FIELD BATTLE: Massive east-west run-up lanes for speed rams and long sightlines. Fewer pickups — positioning and jumps decide the brawl."
  }
];
function clampLaps(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(7, n));
}
const GRAND_PRIX_ID = "grand_prix";

function clampGrandPrixRaces(v) {
  const n = Math.round(Number(v));
  if (n === 3 || n === 5 || n === 7) return n;
  return 3;
}
function clampAiCount(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 4;
  return Math.max(0, Math.min(4, n));
}

function regenerateDragonTrail(seed) {
  const dragonMap = MAPS.find(m => m.id === "dragon_escape");
  if (dragonMap) dragonMap.waypoints = generateDragonTrail(seed);
}

export { MAPS, GRAND_PRIX_ID, clampLaps, clampGrandPrixRaces, clampAiCount, regenerateDragonTrail };
