// Catalogue matching. Pure functions, unit-tested in Node.
import { COLORS } from './colors.js';
import { hexToRgb, rgbToLinear, linearToLab, deltaE2000 } from './color.js';

// Catalogue shades closer than this cannot be told apart by colour alone.
export const TWIN_DE = 2.5;
// A runner-up this close to the winner makes the call ambiguous.
export const CLOSE_CALL_DE = 2;
export const HIGH_DE = 4;
export const MID_DE = 8;
const MAX_SAMPLES = 10;

export const CATALOG = COLORS.map((c) => ({
  ...c,
  lab: linearToLab(rgbToLinear(hexToRgb(c.hex))),
}));
for (const c of CATALOG) {
  c.twins = CATALOG
    .filter((o) => o !== c && deltaE2000(c.lab, o.lab) < TWIN_DE)
    .map((o) => o.code);
}

export const byCode = Object.fromEntries(CATALOG.map((c) => [c.code, c]));

// `learned` maps code -> { lab: [L,a,b], n } measured from physical samples.
// A learned reference replaces the website value for that shade.
export function rank(lab, learned = {}) {
  return CATALOG
    .map((color) => ({ color, dE: deltaE2000(lab, learned[color.code]?.lab ?? color.lab) }))
    .sort((a, b) => a.dE - b.dE);
}

export function confidence(matches) {
  const d = matches[0].dE;
  return d <= HIGH_DE ? 'high' : d <= MID_DE ? 'mid' : 'low';
}

// Runner-up that is too close to call, excluding known texture twins.
export function closeCall(matches) {
  const [a, b] = matches;
  if (!b || b.dE - a.dE >= CLOSE_CALL_DE || a.color.twins.includes(b.color.code)) return null;
  return b.color.code;
}

// Fold a new sample into a shade's learned reference (running mean, capped
// so that recent samples keep some weight).
export function learn(learned, code, lab) {
  const prev = learned[code];
  if (!prev) return { ...learned, [code]: { lab: [...lab], n: 1 } };
  const n = Math.min(prev.n, MAX_SAMPLES - 1);
  return {
    ...learned,
    [code]: { lab: prev.lab.map((v, i) => (v * n + lab[i]) / (n + 1)), n: n + 1 },
  };
}
