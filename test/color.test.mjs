import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToRgb, rgbToLinear, linearToHex, linearToLab, deltaE2000,
  robustMeanLinear, gainsFromWhite, applyGains, WHITE_TARGET,
} from '../color.js';
import { COLORS } from '../colors.js';
import { CATALOG, rank, confidence, closeCall, learn } from '../matcher.js';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const labOf = (hex) => linearToLab(rgbToLinear(hexToRgb(hex)));

test('sRGB -> Lab reference values', () => {
  const white = labOf('#ffffff');
  near(white[0], 100, 0.01); near(white[1], 0, 0.01); near(white[2], 0, 0.01);
  const red = labOf('#ff0000');
  near(red[0], 53.24, 0.05); near(red[1], 80.09, 0.05); near(red[2], 67.2, 0.05);
  near(labOf('#777777')[0], 50.03, 0.05);
});

test('hex round trip', () => {
  for (const c of COLORS) assert.equal(linearToHex(rgbToLinear(hexToRgb(c.hex))), c.hex);
});

test('CIEDE2000 matches Sharma et al. test data', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, want] of cases) {
    near(deltaE2000(a, b), want, 1e-4);
    near(deltaE2000(b, a), want, 1e-4);
  }
});

test('catalogue is complete and well formed', () => {
  assert.equal(COLORS.length, 44);
  assert.equal(new Set(COLORS.map((c) => c.code)).size, 44);
  const perFamily = {};
  for (const c of COLORS) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/);
    assert.ok(c.he && c.en);
    perFamily[c.family] = (perFamily[c.family] ?? 0) + 1;
  }
  assert.deepEqual(perFamily, { neutral: 9, present: 13, sophisticated: 8, woodland: 14 });
});

test('every catalogue colour matches itself', () => {
  for (const c of CATALOG) {
    const m = rank(c.lab);
    near(m[0].dE, 0, 1e-9);
    // The winner is the colour itself or an identical-looking twin.
    assert.ok(m[0].color.code === c.code || c.twins.includes(m[0].color.code));
    assert.equal(confidence(m), 'high');
  }
});

test('texture twins are detected', () => {
  const twins = Object.fromEntries(CATALOG.map((c) => [c.code, c.twins]));
  assert.ok(twins['34F'].includes('34I'));
  assert.ok(twins['34I'].includes('34F'));
  assert.ok(twins['95F'].includes('66I'));
  assert.deepEqual(twins['55I'], []);
});

test('confidence and close calls', () => {
  assert.equal(confidence(rank(labOf('#ff00ff'))), 'low');
  const m = rank(labOf('#36465f'));
  assert.equal(m[0].color.code, '55I');
  assert.equal(closeCall(m), null);
});

test('robust mean ignores glare and shadow pixels', () => {
  const n = 100;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = i < 10 ? 255 : i < 20 ? 0 : 128; // 10% glare, 10% shadow
    data.set([v, v, v, 255], i * 4);
  }
  const m = robustMeanLinear(data);
  const want = rgbToLinear([128, 128, 128])[0];
  near(m.lin[0], want, 1e-6); near(m.lin[1], want, 1e-6); near(m.lin[2], want, 1e-6);
  near(m.clipped, 0.1, 1e-9);
});

test('white calibration removes a colour cast', () => {
  const cast = [0.9, 0.8, 0.6]; // warm light
  const paper = cast.map((k) => 0.7 * k);
  const gains = gainsFromWhite(paper);
  applyGains(paper, gains).forEach((v) => near(v, WHITE_TARGET, 1e-9));

  // A catalogue colour seen under the same cast is recovered after correction.
  const target = CATALOG.find((c) => c.code === '55I');
  const truth = rgbToLinear(hexToRgb(target.hex));
  const seen = truth.map((v, i) => v * cast[i] * 0.7 / WHITE_TARGET);
  assert.notEqual(rank(linearToLab(seen))[0].color.code, '55I');
  const fixed = rank(linearToLab(applyGains(seen, gains)));
  assert.equal(fixed[0].color.code, '55I');
  near(fixed[0].dE, 0, 1e-6);
  assert.deepEqual(applyGains(seen, null), seen);
});

test('learned samples override the website value', () => {
  const sample = labOf('#7a5a40'); // far from every website swatch
  assert.equal(confidence(rank(sample)), 'low');
  let learned = learn({}, '74I', sample);
  const m = rank(sample, learned);
  assert.equal(m[0].color.code, '74I');
  near(m[0].dE, 0, 1e-9);

  learned = learn(learned, '74I', sample.map((v) => v + 2));
  assert.equal(learned['74I'].n, 2);
  near(learned['74I'].lab[0], sample[0] + 1, 1e-9);
  for (let i = 0; i < 30; i++) learned = learn(learned, '74I', sample);
  assert.equal(learned['74I'].n, 10);
});
