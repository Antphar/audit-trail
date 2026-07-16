/**
 * Deterministic transcendental math (fdlibm ports).
 *
 * V8's Math.sin/cos/tan/atan/atan2/exp/log/pow are NOT correctly rounded and
 * their implementations differ between V8 versions (e.g. Node 22 vs current
 * Chromium), producing ~1ulp differences that break bit-exact browser/Node
 * sim parity. These pure-JS ports only use +,-,*,/ and Math.sqrt/floor (all
 * IEEE-exact), so every engine computes identical bit patterns.
 *
 * installDeterministicMath() patches globalThis.Math in HEADLESS runtimes
 * only; normal browser play keeps native Math.
 */

const _buf = new DataView(new ArrayBuffer(8));

// Signed, matching fdlibm's int32_t high-word semantics (sign checks rely on it).
function highWord(x) {
  _buf.setFloat64(0, x);
  return _buf.getInt32(0);
}

function lowWord(x) {
  _buf.setFloat64(0, x);
  return _buf.getUint32(4);
}

function setHighWord(x, hi) {
  _buf.setFloat64(0, x);
  _buf.setUint32(0, hi >>> 0);
  return _buf.getFloat64(0);
}

// ---------------------------------------------------------------- sin / cos

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x, y, iy) {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x, y) {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}

// -------------------------------------------------- argument reduction pi/2

const invpio2 = 6.36619772367581382433e-01;
const pio2_1 = 1.57079632673412561417e+00;
const pio2_1t = 6.07710050650619224932e-11;
const pio2_2 = 6.07710050630396597660e-11;
const pio2_2t = 2.02226624879595063154e-21;
const pio2_3 = 2.02226624871116645580e-21;
const pio2_3t = 8.47842766036889956997e-32;
const twoPi = 6.283185307179586476925286766559;

// Returns [n, y0, y1]. Accurate for |x| < 2^20 * pi/2; for larger |x| falls
// back to a coarse (but still deterministic) modulo reduction.
function remPio2(x) {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) return [0, x, 0]; // |x| <= pi/4
  if (ix >= 0x413921fb) {
    // |x| beyond fdlibm's medium-size reduction — coarse deterministic
    // fallback (sim angles never get near this range).
    const reduced = x % twoPi;
    return remPio2(reduced === x ? 0 : reduced);
  }
  // medium size
  const n = Math.floor(Math.abs(x) * invpio2 + 0.5) * (x < 0 ? -1 : 1);
  const fn = n;
  let r = x - fn * pio2_1;
  let w = fn * pio2_1t;
  let y0 = r - w;
  const high = highWord(y0);
  const i = (ix >> 20) - ((high >> 20) & 0x7ff);
  if (i > 16) { // 2nd round needed
    const t = r;
    w = fn * pio2_2;
    r = t - w;
    w = fn * pio2_2t - ((t - r) - w);
    y0 = r - w;
    const high2 = highWord(y0);
    const i2 = (ix >> 20) - ((high2 >> 20) & 0x7ff);
    if (i2 > 49) { // 3rd round
      const t2 = r;
      w = fn * pio2_3;
      r = t2 - w;
      w = fn * pio2_3t - ((t2 - r) - w);
      y0 = r - w;
    }
  }
  const y1 = (r - y0) - w;
  return [n, y0, y1];
}

function dsin(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return x; // |x| < 2^-26
    return kernelSin(x, 0, 0);
  }
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0: return kernelSin(y0, y1, 1);
    case 1: return kernelCos(y0, y1);
    case 2: return -kernelSin(y0, y1, 1);
    default: return -kernelCos(y0, y1);
  }
}

function dcos(x) {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) return 1; // |x| < 2^-27 * sqrt(2)
    return kernelCos(x, 0);
  }
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0: return kernelCos(y0, y1);
    case 1: return -kernelSin(y0, y1, 1);
    case 2: return -kernelCos(y0, y1);
    default: return kernelSin(y0, y1, 1);
  }
}

// ------------------------------------------------------------------- atan

const atanhi = [
  4.63647609000806093515e-01, 7.85398163397448278999e-01,
  9.82793723247329054082e-01, 1.57079632679489655800e+00,
];
const atanlo = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17,
  1.39033110312309984516e-17, 6.12323399573676603587e-17,
];
const aT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01,
  1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02,
  1.62858201153657823623e-02,
];

function datan(x) {
  if (x !== x) return NaN;
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) { // |x| >= 2^66
    if (x > 0) return atanhi[3] + 7.5231638452626401e-37;
    return -atanhi[3] - 7.5231638452626401e-37;
  }
  let id;
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) { // |x| < 1.1875
      if (ix < 0x3fe60000) { // 7/16 <= |x| < 11/16
        id = 0;
        x = (2.0 * x - 1.0) / (2.0 + x);
      } else { // 11/16 <= |x| < 19/16
        id = 1;
        x = (x - 1.0) / (x + 1.0);
      }
    } else {
      if (ix < 0x40038000) { // |x| < 2.4375
        id = 2;
        x = (x - 1.5) / (1.0 + 1.5 * x);
      } else { // 2.4375 <= |x| < 2^66
        id = 3;
        x = -1.0 / x;
      }
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
  const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const zz = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return hx < 0 ? -zz : zz;
}

const PI = 3.1415926535897931160e+00;
const PI_LO = 1.2246467991473531772e-16;

function datan2(y, x) {
  if (x !== x || y !== y) return NaN;
  if (x === 1.0) return datan(y);
  const hx = highWord(x);
  const lx = lowWord(x);
  const hy = highWord(y);
  const ly = lowWord(y);
  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  const m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2); // 2*sign(x)+sign(y)

  if ((iy | ly) === 0) { // y = 0
    switch (m) {
      case 0:
      case 1: return y;                 // atan(+-0, +anything)
      case 2: return PI;                // atan(+0, -anything)
      default: return -PI;              // atan(-0, -anything)
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI / 2 : PI / 2; // x = 0
  if (ix === 0x7ff00000) { // x is inf
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0: return PI / 4;
        case 1: return -PI / 4;
        case 2: return 3.0 * PI / 4;
        default: return -3.0 * PI / 4;
      }
    }
    switch (m) {
      case 0: return 0.0;
      case 1: return -0.0;
      case 2: return PI;
      default: return -PI;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI / 2 : PI / 2; // y is inf

  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) { // |y/x| > 2^60
    z = PI / 2 + 0.5 * PI_LO;
  } else if (hx < 0 && k < -60) { // |y|/x < -2^60
    z = 0.0;
  } else {
    z = datan(Math.abs(y / x));
  }
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// -------------------------------------------------------------------- exp

const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const invln2 = 1.44269504088896338700e+00;
const expP1 = 1.66666666666666019037e-01;
const expP2 = -2.77777777770155933842e-03;
const expP3 = 6.61375632143793436117e-05;
const expP4 = -1.65339022054652515390e-06;
const expP5 = 4.13813679705723846039e-08;
const o_threshold = 7.09782712893383973096e+02;
const u_threshold = -7.45133219101941108420e+02;
const twom1000 = 9.33263618503218878990e-302;

function dexp(x) {
  if (x !== x) return NaN;
  let hx = highWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862E42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lowWord(x)) !== 0) return NaN;
      return xsb === 0 ? x : 0.0;
    }
    if (x > o_threshold) return Infinity;
    if (x < u_threshold) return 0.0;
  }
  let hi = 0, lo = 0, k = 0;
  if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
    if (hx < 0x3FF0A2B2) { // |x| < 1.5 ln2
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (invln2 * x + (xsb === 1 ? -0.5 : 0.5)) | 0;
      const t = k;
      hi = x - t * ln2HI[0];
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) { // |x| < 2^-28
    return 1.0 + x;
  }
  const t = x * x;
  const c = x - t * (expP1 + t * (expP2 + t * (expP3 + t * (expP4 + t * expP5))));
  let y;
  if (k === 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    return setHighWord(y, (highWord(y) + (k << 20)) >>> 0);
  }
  y = setHighWord(y, (highWord(y) + ((k + 1000) << 20)) >>> 0);
  return y * twom1000;
}

// ------------------------------------------------------------------- log

const lg1 = 6.666666666666735130e-01;
const lg2 = 3.999999999940941908e-01;
const lg3 = 2.857142874366239149e-01;
const lg4 = 2.222219843214978396e-01;
const lg5 = 1.818357216161805012e-01;
const lg6 = 1.531383769920937332e-01;
const lg7 = 1.479819860511658591e-01;
const two54 = 1.80143985094819840000e+16;

function dlog(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let hx = highWord(x);
  let lx = lowWord(x);
  let k = 0;
  if (hx < 0x00100000) { // subnormal
    x *= two54;
    k -= 54;
    hx = highWord(x);
    lx = lowWord(x);
  }
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = setHighWord(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) {
      if (k === 0) return 0;
      return k * ln2HI[0] + k * ln2LO[0];
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return k * ln2HI[0] - ((R - k * ln2LO[0]) - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  const ii = hx - 0x6147a;
  const w = z * z;
  const jj = 0x6b851 - hx;
  const t1 = w * (lg2 + w * (lg4 + w * lg6));
  const t2 = z * (lg1 + w * (lg3 + w * (lg5 + w * lg7)));
  const ij = ii | jj;
  const R = t2 + t1;
  if (ij > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2HI[0] - ((hfsq - (s * (hfsq + R) + dk * ln2LO[0])) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2HI[0] - ((s * (f - R) - dk * ln2LO[0]) - f);
}

// ------------------------------------------------------------------- pow

function dpow(x, y) {
  // Exact-result fast paths (identical in every engine).
  if (y === 0) return 1;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (x !== x || y !== y) return NaN;
  if (y === 0.5 && x >= 0) return Math.sqrt(x);
  // General case via exp(y*log(|x|)) with integer-y sign handling; not
  // correctly rounded, but bit-identical across engines (all pure JS).
  if (x === 0) {
    if (y > 0) return (1 / x === -Infinity) && (Math.floor(y) === y) && (y % 2 === 1) ? -0 : 0;
    return (1 / x === -Infinity) && (Math.floor(y) === y) && (y % 2 === 1) ? -Infinity : Infinity;
  }
  let sign = 1;
  if (x < 0) {
    if (Math.floor(y) !== y) return NaN;
    x = -x;
    if (y % 2 === 1 || y % 2 === -1) sign = -1;
  }
  return sign * dexp(y * dlog(x));
}

// ------------------------------------------------------------------ tanh

function dtanh(x) {
  if (x !== x) return NaN;
  if (x === 0) return x;
  const ax = Math.abs(x);
  if (ax >= 20) return x > 0 ? 1 : -1;
  const e2 = dexp(2 * ax);
  const t = (e2 - 1) / (e2 + 1);
  return x > 0 ? t : -t;
}

function dhypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

let installed = false;

export function installDeterministicMath() {
  if (installed) return;
  installed = true;
  const M = globalThis.Math;
  M.sin = dsin;
  M.cos = dcos;
  M.atan = datan;
  M.atan2 = datan2;
  M.exp = dexp;
  M.log = dlog;
  M.pow = dpow;
  M.tanh = dtanh;
  M.hypot = dhypot;
}

export { dsin, dcos, datan, datan2, dexp, dlog, dpow, dtanh };
