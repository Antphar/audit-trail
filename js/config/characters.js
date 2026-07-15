const CHARACTERS = [
  {
    id: "anton",
    name: "Anton",
    initials: "AW",
    tagline: '"Types faster than he spells"',
    color: "#ff4d6d",
    colorGlow: "rgba(255, 77, 109, 0.4)",
    gradient: "linear-gradient(135deg, #ff4d6d, #ff85a2)",
    stats: { speed: 88, accel: 82, handling: 35, weight: 30 },
    maxSpeed: 6.9,
    acceleration: 0.145,
    turnSpeed: 0.042,
    weight: 18,
    vehicle: { style: "formula", length: 34, width: 18, hitboxRadius: 17, shadowRx: 18, shadowRy: 9 },
    passive: "<strong>Worst Speller</strong>: Supreme speed but slides around corners. Types typos above his kart when crashing!"
  },
  {
    id: "artur",
    name: "Artur",
    initials: "AG",
    tagline: '"The prayer-driven developer"',
    color: "#ff8a3b",
    colorGlow: "rgba(255, 138, 59, 0.4)",
    gradient: "linear-gradient(135deg, #ff8a3b, #ffd86b)",
    stats: { speed: 68, accel: 72, handling: 62, weight: 55 },
    maxSpeed: 6.7,
    acceleration: 0.138,
    turnSpeed: 0.050,
    weight: 22,
    vehicle: { style: "muscle", length: 33, width: 24, hitboxRadius: 19.5, shadowRx: 20, shadowRy: 11 },
    passive: "<strong>Prayer-Driven</strong>: Gains a 1.8x multiplier to mini-turbo charges when running in 3rd or 4th place. Highly vocal!"
  },
  {
    id: "rissal",
    name: "Rissal",
    initials: "RI",
    tagline: '"The emotional coder"',
    color: "#4dffaa",
    colorGlow: "rgba(77, 255, 170, 0.4)",
    gradient: "linear-gradient(135deg, #4dffaa, #33ccff)",
    stats: { speed: 72, accel: 74, handling: 68, weight: 58 },
    maxSpeed: 6.75,
    acceleration: 0.140,
    turnSpeed: 0.052,
    weight: 24,
    vehicle: { style: "compact", length: 27, width: 20, hitboxRadius: 16.5, shadowRx: 16, shadowRy: 10 },
    passive: "<strong>Emotional Coder</strong>: Shields last 50% longer. Leaves neon glowing green tire trails. Prone to panic quotes."
  },
  {
    id: "pia",
    name: "Pia",
    initials: "P",
    tagline: '"The quiet savage"',
    color: "#9d4dff",
    colorGlow: "rgba(157, 77, 255, 0.4)",
    gradient: "linear-gradient(135deg, #9d4dff, #57f2ff)",
    stats: { speed: 58, accel: 60, handling: 88, weight: 88 },
    maxSpeed: 6.55,
    acceleration: 0.128,
    turnSpeed: 0.062,
    weight: 32,
    vehicle: { style: "armored", length: 34, width: 27, hitboxRadius: 21, shadowRx: 22, shadowRy: 12 },
    passive: "<strong>Quiet Savage</strong>: Incredible weight and handling stability. Ramming other karts knocks them back with 2.5x force."
  },
  {
    id: "florian",
    name: "Florian",
    initials: "FW",
    tagline: '"Regulatory Overlord"',
    color: "#57f2ff",
    colorGlow: "rgba(87, 242, 255, 0.4)",
    gradient: "linear-gradient(135deg, #57f2ff, #a4ff80)",
    stats: { speed: 70, accel: 70, handling: 70, weight: 70 },
    maxSpeed: 6.8,
    acceleration: 0.135,
    turnSpeed: 0.054,
    weight: 26,
    vehicle: { style: "coupe", length: 34, width: 22, hitboxRadius: 18.5, shadowRx: 19, shadowRy: 10 },
    passive: "<strong>Executive Compliance</strong>: Cuts spinout duration in half when hit by dossiers, and instantly generates a protective Compliance Shield!"
  }
];

const DEFAULT_KART_COLLISION_RADIUS = 18;
const DEFAULT_VEHICLE_PROFILE = Object.freeze({
  style: "generic",
  length: 30,
  width: 22,
  hitboxRadius: DEFAULT_KART_COLLISION_RADIUS,
  shadowRx: 18,
  shadowRy: 10,
});
const VEHICLE_PROFILES_BY_ID = Object.freeze(Object.fromEntries(
  CHARACTERS.map(character => [character.id, Object.freeze({ ...character.vehicle })])
));

function getVehicleProfile(charOrId) {
  if (!charOrId) return DEFAULT_VEHICLE_PROFILE;
  const id = typeof charOrId === "string"
    ? charOrId
    : (charOrId.charId != null ? charOrId.charId : charOrId.id);
  return VEHICLE_PROFILES_BY_ID[id] || DEFAULT_VEHICLE_PROFILE;
}

export { DEFAULT_KART_COLLISION_RADIUS, CHARACTERS, DEFAULT_VEHICLE_PROFILE, VEHICLE_PROFILES_BY_ID, getVehicleProfile };
