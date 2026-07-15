const COMPASS_VISUAL = Object.freeze({
  primary: "#7b75ff",
  primaryDark: "#8b85ff",
  accent: "#fd9927",
  accentSoft: "#fdb768",
  light: "#ffffff",
  neutral: "#f9f9f9",
  info: "#ebe4ff",
  mint: "#e6ffdc",
  success: "#a4ff80",
  baseDark: "#131019",
  baseMid: "#1b1726",
  baseMuted: "#4f4870",
  content: "#ece9f5",
  textDim: "#a8a2b8",
  hudBg: "rgba(19, 16, 25, 0.72)",
  hudBorder: "rgba(123, 117, 255, 0.35)",
  hudHighlight: "rgba(235, 228, 255, 0.1)",
  sealFill: "#a4ff80",
  sealRing: "#7b75ff",
  sealMark: "#1a2e14",
  skyDayTop: "#6eb5ff",
  skyDayMid: "#ebe4ff",
  skyDayBot: "#e6ffdc",
  skyNightTop: "#131019",
  skyNightBot: "#1b1726",
  floorDayInner: "#edf5ec",
  floorDayMid: "#d7e5dc",
  floorDayOuter: "#b8cfbd",
  floorNightInner: "#1b1726",
  floorNightMid: "#131019",
  floorNightOuter: "#0e1810",
});

/** Unified per-map themes: day/night × 2D/3D palettes. */
const MAP_THEMES = Object.freeze({
  audit_super_ring: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#60d8a0",
        skyMid: "#b0f0c8",
        skyBot: "#98e8a8",
        grassTint: "rgba(164, 255, 128, 0.30)",
        grassGrid: "rgba(79, 72, 112, 0.08)",
        roadOuterShadow: "rgba(164, 255, 128, 0.18)",
        roadShadowBlur: 5,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#283828",
        roadNarrowBoundary: "#70e8a0",
        roadEdgeGlow: "rgba(164, 255, 128, 0.48)",
        roadFlowMarks: "rgba(164, 255, 128, 0.22)",
        roadCenterLine: "rgba(123, 117, 255, 0.58)",
      }),
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#70d0a0", "#88e0b0", "#a0f0c0", "#c0f8d8", "#90e8b0"],
        fog: [11071680, 0.00003],
        ground: "#98e8a8",
        groundAccent: "#b0f8b8",
        clearColor: 8972464,
        gridColor: 10813312,
        gridSecondary: 12646616,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#060a1a", "#081028", "#0a1838", "#0c2040", "#060a1a"],
        fog: [395802, 0.0003],
        ground: "#081810",
        groundAccent: "#0c2218",
        clearColor: 395802,
        gridColor: 10813312,
        gridSecondary: 663568,
      }),
    }),
  }),
  battle_arena: Object.freeze({
    day: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#7fbee0", "#70b3dc", "#5aa4d4", "#4293c9", "#287fbe"],
        fog: [9225439, 0.00004],
        ground: "#9fcf9d",
        groundAccent: "#79ad7f",
        clearColor: 9225439,
        gridColor: 8091135,
        gridSecondary: 5195888,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#131019", "#1b1726", "#4f4870", "#1b1726", "#131019"],
        fog: [1249305, 0.00035],
        ground: "#131019",
        groundAccent: "#1b1726",
        clearColor: 1249305,
        gridColor: 8091135,
        gridSecondary: 5195888,
      }),
    }),
  }),
  battle_open_arena: Object.freeze({
    day: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#7fbee0", "#70b3dc", "#5aa4d4", "#4293c9", "#287fbe"],
        fog: [9225439, 0.000035],
        ground: "#9fcf9d",
        groundAccent: "#79ad7f",
        clearColor: 9225439,
        gridColor: 8091135,
        gridSecondary: 5195888,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#131019", "#1b1726", "#4f4870", "#1b1726", "#131019"],
        fog: [1249305, 0.0003],
        ground: "#1b1726",
        groundAccent: "#131019",
        clearColor: 1249305,
        gridColor: 8091135,
        gridSecondary: 5195888,
      }),
    }),
  }),
  black_ice_data_vault: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#8aa8b8",
        skyMid: "#b8d0e0",
        skyBot: "#a0b8c8",
        grassTint: "rgba(176, 220, 240, 0.24)",
        grassGrid: "rgba(87, 242, 255, 0.09)",
        roadOuterShadow: "rgba(87, 242, 255, 0.18)",
        roadShadowBlur: 5,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#283038",
        roadNarrowBoundary: "#57f2ff",
        roadEdgeGlow: "rgba(87, 242, 255, 0.45)",
        roadFlowMarks: "rgba(87, 242, 255, 0.18)",
        roadCenterLine: "rgba(123, 117, 255, 0.55)",
      }),
      d3: Object.freeze({
        scenery: "ice",
        sky: ["#8aa8b8", "#9ab8c8", "#aac8d8", "#b8d4e0", "#a0b8c8"],
        fog: [11585752, 0.00004],
        ground: "#98b0c0",
        groundAccent: "#88a8b8",
        clearColor: 11059408,
        gridColor: 5763839,
        gridSecondary: 12113120,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "ice",
        sky: ["#020408", "#040810", "#081020", "#0a1830", "#020408"],
        fog: [132104, 0.00035],
        ground: "#060a10",
        groundAccent: "#080e18",
        clearColor: 132104,
        gridColor: 5763839,
        gridSecondary: 530472,
      }),
    }),
  }),
  compliance_chicane: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#8a9ad8",
        skyMid: "#c8d0f0",
        skyBot: "#b8c8d8",
        grassTint: "rgba(200, 212, 240, 0.28)",
        grassGrid: "rgba(157, 77, 255, 0.09)",
        roadOuterShadow: "rgba(157, 77, 255, 0.20)",
        roadShadowBlur: 6,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#2c2840",
        roadNarrowBoundary: "#9d4dff",
        roadEdgeGlow: "rgba(157, 77, 255, 0.50)",
        roadFlowMarks: "rgba(157, 77, 255, 0.20)",
        roadCenterLine: "rgba(123, 117, 255, 0.60)",
      }),
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#9aa8e0", "#b8c4f0", "#d0d8f8", "#c8d4e8", "#b0c0d8"],
        fog: [13161712, 0.000035],
        ground: "#b8c8d8",
        groundAccent: "#a8b8cc",
        clearColor: 11583712,
        gridColor: 10309119,
        gridSecondary: 13687032,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#080614", "#120830", "#201050", "#18123a", "#080614"],
        fog: [525844, 0.0005],
        ground: "#0d1420",
        groundAccent: "#0f1828",
        clearColor: 525844,
        gridColor: 10309119,
        gridSecondary: 1706032,
      }),
    }),
  }),
  core_mainframe: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#5eb0ff",
        skyMid: "#c8e8ff",
        skyBot: "#b8f0c8",
        grassTint: "rgba(184, 240, 200, 0.26)",
        grassGrid: "rgba(123, 117, 255, 0.10)",
        roadOuterShadow: "rgba(123, 117, 255, 0.22)",
        roadShadowBlur: 6,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#2a2548",
        roadNarrowBoundary: "#4db8ff",
        roadEdgeGlow: "rgba(123, 117, 255, 0.55)",
        roadFlowMarks: "rgba(123, 117, 255, 0.22)",
        roadCenterLine: "rgba(123, 117, 255, 0.65)",
      }),
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#87ceeb", "#a8d8ff", "#c8e8ff", "#b8f0c8", "#98d8a8"],
        fog: [12116168, 0.00003],
        ground: "#8ed4a0",
        groundAccent: "#a8e8b8",
        clearColor: 8900331,
        gridColor: 8091135,
        gridSecondary: 13166847,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#0a0820", "#0e0630", "#180a40", "#0d1a28", "#060514"],
        fog: [394516, 0.0004],
        ground: "#0a1f0d",
        groundAccent: "#0e2a12",
        clearColor: 394516,
        gridColor: 8091135,
        gridSecondary: 1708096,
      }),
    }),
  }),
  dragon_escape: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#a8d8c0",
        skyMid: "#d8f0d8",
        skyBot: "#98c8a0",
        grassTint: "rgba(200, 240, 210, 0.28)",
        grassGrid: "rgba(80, 140, 90, 0.10)",
        roadOuterShadow: "rgba(100, 160, 110, 0.18)",
        roadShadowBlur: 5,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#2a3830",
        roadNarrowBoundary: "#66aa77",
        roadEdgeGlow: "rgba(100, 170, 120, 0.45)",
        roadFlowMarks: "rgba(100, 170, 120, 0.18)",
        roadCenterLine: "rgba(123, 117, 255, 0.52)",
        mountainLayers: Object.freeze(["rgba(120, 160, 130, 0.10)", "rgba(100, 140, 110, 0.08)", "rgba(80, 120, 90, 0.06)", "rgba(60, 100, 70, 0.04)"]),
        bambooStroke: "rgba(60, 120, 70, 0.28)",
        glowInner: "rgba(200, 240, 210, 0.06)",
      }),
      d3: Object.freeze({
        scenery: "japanese",
        sky: ["#a8d8c0", "#b8e8c8", "#c8f0d0", "#d0e8c8", "#b0d8b8"],
        fog: [13166800, 0.00005],
        ground: "#90c8a0",
        groundAccent: "#a8d8b0",
        clearColor: 12118216,
        gridColor: 6728311,
        gridSecondary: 13691080,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "japanese",
        sky: ["#1a0c0c", "#2a1008", "#1a0a10", "#120818", "#0a0408"],
        fog: [1707020, 0.00008],
        ground: "#0d1a10",
        groundAccent: "#142818",
        clearColor: 1707020,
        gridColor: 16724736,
        gridSecondary: 1705992,
      }),
    }),
  }),
  protocol_amendment_labyrinth: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#e8d0a0",
        skyMid: "#f8ecd8",
        skyBot: "#e0d0b0",
        grassTint: "rgba(248, 232, 200, 0.28)",
        grassGrid: "rgba(253, 153, 39, 0.09)",
        roadOuterShadow: "rgba(253, 153, 39, 0.18)",
        roadShadowBlur: 5,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#383028",
        roadNarrowBoundary: "#fd9927",
        roadEdgeGlow: "rgba(253, 153, 39, 0.45)",
        roadFlowMarks: "rgba(253, 153, 39, 0.20)",
        roadCenterLine: "rgba(123, 117, 255, 0.55)",
      }),
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#e8d8b0", "#f0e0c0", "#f8ecd8", "#f0e4c8", "#e8d8b0"],
        fog: [15788240, 0.000035],
        ground: "#d8c8a8",
        groundAccent: "#e8d8b8",
        clearColor: 15786176,
        gridColor: 16619815,
        gridSecondary: 16313560,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "cyber",
        sky: ["#080610", "#100a20", "#1a1038", "#141030", "#080610"],
        fog: [525840, 0.0004],
        ground: "#0c0a14",
        groundAccent: "#12101e",
        clearColor: 525840,
        gridColor: 16619815,
        gridSecondary: 1576992,
      }),
    }),
  }),
  regulatory_dragon_run: Object.freeze({
    day: Object.freeze({
      d2: Object.freeze({
        skyTop: "#f0c060",
        skyMid: "#f8e0a8",
        skyBot: "#e8d0a0",
        grassTint: "rgba(248, 220, 160, 0.26)",
        grassGrid: "rgba(253, 153, 39, 0.10)",
        roadOuterShadow: "rgba(253, 153, 39, 0.20)",
        roadShadowBlur: 5,
        roadRumbleA: "#ff4d6d",
        roadRumbleB: "#a4ff80",
        roadAsphalt: "#3a3028",
        roadNarrowBoundary: "#fd9927",
        roadEdgeGlow: "rgba(253, 153, 39, 0.48)",
        roadFlowMarks: "rgba(255, 77, 109, 0.18)",
        roadCenterLine: "rgba(123, 117, 255, 0.55)",
      }),
      d3: Object.freeze({
        scenery: "dragon",
        sky: ["#f0c878", "#f8d890", "#ffe8a8", "#f0e0c0", "#e8d0a8"],
        fog: [15786168, 0.00003],
        ground: "#d8c8a0",
        groundAccent: "#e8d8b0",
        clearColor: 15784096,
        gridColor: 16731501,
        gridSecondary: 15786176,
      }),
    }),
    night: Object.freeze({
      d3: Object.freeze({
        scenery: "dragon",
        sky: ["#0a0414", "#180820", "#281038", "#1a0828", "#0a0414"],
        fog: [656404, 0.00025],
        ground: "#100a18",
        groundAccent: "#180e22",
        clearColor: 656404,
        gridColor: 16731501,
        gridSecondary: 2099224,
      }),
    }),
  }),
});

const _MAP_THEME_DEFAULT = MAP_THEMES.core_mainframe;

function getMapDayPalette(mapId) {
  return MAP_THEMES[mapId]?.day?.d2 || _MAP_THEME_DEFAULT.day.d2;
}

function getMap3DTheme(mapId, isDay) {
  const entry = MAP_THEMES[mapId] || _MAP_THEME_DEFAULT;
  const mode = isDay ? entry.day : entry.night;
  return { ...mode.d3, isDay: !!isDay };
}

/** @deprecated Use MAP_THEMES — retained for callers that read the flat day table. */
const MAP_DAY_PALETTES = Object.freeze(
  Object.fromEntries(
    Object.entries(MAP_THEMES)
      .filter(([, t]) => t.day?.d2)
      .map(([id, t]) => [id, t.day.d2])
  )
);

export { COMPASS_VISUAL, MAP_THEMES, MAP_DAY_PALETTES, getMapDayPalette, getMap3DTheme };
