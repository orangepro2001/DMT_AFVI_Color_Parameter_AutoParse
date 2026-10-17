import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyLightToGvStats,
  applyLightToRgb,
  computeLightGains,
  createLightPage,
  lightMatrixValues,
} from '../src/lib/light-simulation.ts';

const identity = { red: 1, green: 1, blue: 1 };
const gains = { red: 2, green: 1.5, blue: 1 };
const channel = (color, value) => ({ index: 1, color, value, angle: 0, enable: true });

test('R/G/B views extract a single component as grayscale; RGB keeps color', () => {
  assert.deepEqual(applyLightToRgb([40, 80, 120], gains, 'Red'), [80, 80, 80]);
  assert.deepEqual(applyLightToRgb([40, 80, 120], gains, 'Green'), [120, 120, 120]);
  assert.deepEqual(applyLightToRgb([40, 80, 120], gains, 'Blue'), [120, 120, 120]);
  assert.deepEqual(applyLightToRgb([40, 80, 120], gains, 'RGB'), [80, 120, 120]);
  assert.deepEqual(applyLightToRgb([20, 80, 160], identity, 'Green'), [80, 80, 80]);
});

test('Red lighting cannot change Green/Blue views; White affects every view equally', () => {
  const red = computeLightGains([createLightPage([channel('Red', 1024)])], true);
  assert.deepEqual(red, { red: 2, green: 1, blue: 1 });
  assert.deepEqual(applyLightToRgb([50, 60, 70], red, 'Green'), [60, 60, 60]);
  assert.deepEqual(applyLightToRgb([50, 60, 70], red, 'Blue'), [70, 70, 70]);
  const white = computeLightGains([createLightPage([channel('White', 512)])], true);
  assert.deepEqual(white, { red: 1.5, green: 1.5, blue: 1.5 });
  for (const view of ['Red', 'Green', 'Blue', 'RGB']) {
    assert.deepEqual(applyLightToRgb([80, 80, 80], white, view), [120, 120, 120]);
  }
});

test('Page contributions stay independent and OFF uses the original components', () => {
  const pages = [createLightPage([channel('Red', 1024)]), createLightPage([channel('Green', 512)]), createLightPage([channel('Blue', 256)])];
  pages[1].enabled = false;
  assert.deepEqual(computeLightGains(pages, true), { red: 2, green: 1, blue: 1.25 });
  assert.equal(pages[0].channels[0].value, 1024);
  const off = computeLightGains(pages, false);
  assert.deepEqual(off, identity);
  assert.deepEqual(applyLightToRgb([30, 60, 90], off, 'RGB'), [30, 60, 90]);
  assert.deepEqual(applyLightToRgb([30, 60, 90], off, 'Red'), [30, 30, 30]);
});

test('The SVG matrix projects the same components as the numeric readout', () => {
  for (const view of ['Red', 'Green', 'Blue', 'RGB']) {
    const matrix = lightMatrixValues(gains, view).split(' ').map(Number);
    assert.equal(matrix.length, 20);
    const input = [40, 80, 120, 255, 255];
    const output = [0, 1, 2].map((row) => Math.round(Math.min(255, matrix.slice(row * 5, row * 5 + 5).reduce((value, coefficient, column) => value + coefficient * input[column], 0))));
    assert.deepEqual(output, applyLightToRgb([40, 80, 120], gains, view));
  }
});

test('GV histogram measures saturation per channel before computing mean and std', () => {
  const histogram = Array(256).fill(0);
  histogram[100] = 1;
  histogram[200] = 1;
  const raw = { mean: 150, std: 50, min: 100, max: 200, pixels: 2, histogram };
  const red = applyLightToGvStats(raw, gains, 'Red');
  assert.equal(red.mean, 227.5);
  assert.equal(red.std, 27.5);
  assert.equal(red.min, 200);
  assert.equal(red.max, 255);
  const green = applyLightToGvStats(raw, gains, 'Green');
  assert.equal(green.mean, 202.5);
  assert.equal(green.std, 52.5);
  const blue = applyLightToGvStats(raw, gains, 'Blue');
  assert.equal(blue.mean, 150);
  assert.equal(blue.std, 50);
  const rgb = applyLightToGvStats(raw, gains, 'RGB');
  assert.ok(Math.abs(rgb.mean - 203.99) < 1e-8);
  assert.equal(rgb.approximate, false);
  assert.deepEqual(raw.histogram, histogram);
});

test('Older backends explicitly return an estimate for composed GV', () => {
  const raw = { mean: 50, std: 10, min: 0, max: 80, pixels: 2 };
  assert.equal(applyLightToGvStats(raw, gains, 'Red').mean, 100);
  assert.equal(applyLightToGvStats(raw, gains, 'Red').approximate, true);
  assert.equal(applyLightToGvStats(raw, identity, 'Blue').approximate, false);
});
