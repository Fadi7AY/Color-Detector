// Colour maths: sRGB <-> linear, CIE Lab (D65), CIEDE2000, robust sampling.
// No DOM access here so it can be unit-tested in Node.

const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToLinear([r, g, b]) {
  return [LUT[r], LUT[g], LUT[b]];
}

function encode(v) {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export function linearToHex(lin) {
  return '#' + lin.map((v) => encode(v).toString(16).padStart(2, '0')).join('');
}

const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function linearToLab([r, g, b]) {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = f(x / XN), fy = f(y / YN), fz = f(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;

// CIEDE2000 colour difference (Sharma, Wu & Dalal 2005).
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const Lmp = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hmp = (h1p + h2p) / 2;
    else hmp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1
    - 0.17 * Math.cos((hmp - 30) * RAD)
    + 0.24 * Math.cos(2 * hmp * RAD)
    + 0.32 * Math.cos((3 * hmp + 6) * RAD)
    - 0.2 * Math.cos((4 * hmp - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

// Average an RGBA pixel block in linear light, ignoring the brightest and
// darkest `trim` share of pixels (specular glare, texture shadows, dust).
export function robustMeanLinear(data, trim = 0.15) {
  const n = data.length >> 2;
  const lum = new Float32Array(n);
  let clipped = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r >= 250 || g >= 250 || b >= 250) clipped++;
    lum[i] = 0.2126729 * LUT[r] + 0.7151522 * LUT[g] + 0.072175 * LUT[b];
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => lum[a] - lum[b]);
  const lo = Math.floor(n * trim), hi = n - lo;
  let sr = 0, sg = 0, sb = 0, sl = 0;
  for (let k = lo; k < hi; k++) {
    const p = idx[k] << 2;
    sr += LUT[data[p]]; sg += LUT[data[p + 1]]; sb += LUT[data[p + 2]];
    sl += lum[idx[k]];
  }
  const m = hi - lo;
  return { lin: [sr / m, sg / m, sb / m], luma: sl / m, clipped: clipped / n };
}

// White-card calibration: per-channel gains that map the measured white to
// the reference white level.
export const WHITE_TARGET = 0.88; // linear; ~L* 95, typical white paper

export function gainsFromWhite(lin) {
  return lin.map((v) => WHITE_TARGET / v);
}

export function applyGains(lin, gains) {
  if (!gains) return lin;
  return lin.map((v, i) => Math.min(1, v * gains[i]));
}
