const TAU = Math.PI * 2;
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, mn, mx) { return v < mn ? mn : v > mx ? mx : v; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
function pointSegProjection(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { t: 0, x: ax, y: ay, d: dist(px, py, ax, ay) };
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const x = ax + t * dx, y = ay + t * dy;
  return { t, x, y, d: dist(px, py, x, y) };
}
function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function hexToRgba(hex, alpha) {
  let s = hex.replace("#", "");
  if (s.length === 3) s = s.split("").map(c => c + c).join("");
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function ellipseNormDist(x, y, floor) {
  if (!floor) return Infinity;
  const nx = (x - floor.cx) / Math.max(1, floor.rx);
  const ny = (y - floor.cy) / Math.max(1, floor.ry);
  return Math.hypot(nx, ny);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { TAU, lerp, clamp, dist, angleDiff, pointSegProjection, rand, pick, hexToRgba, ellipseNormDist, mulberry32 };
