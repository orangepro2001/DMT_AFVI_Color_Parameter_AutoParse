import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGray } from '../src/gray.ts';
import {
  DEFAULT_REFLECTANCE,
  buildMaterialMap,
  cloneReflectance,
  createLightScene,
  estimateReflectance,
  irradiance,
  materialStats,
  measureGv,
  renderChannel,
  withReflectance,
} from '../src/light.ts';
import type { LightSetting } from '../src/light.ts';

function setting(overrides: Partial<LightSetting> = {}): LightSetting {
  return {
    channels: [{ color: 'Red', value: 512, enable: true }],
    reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
    ...overrides,
  };
}

test('buildMaterialMap respects priority metal > open > sr > base', () => {
  const metal = createGray(2, 1);
  const sr = createGray(2, 1);
  const open = createGray(2, 1);
  metal.data[0] = 200;
  sr.data[0] = 200;
  open.data[0] = 200;
  sr.data[1] = 200;
  open.data[1] = 200;
  const map = buildMaterialMap({ metal, sr, open });
  assert.equal(map[0], 3);
  assert.equal(map[1], 2);
});

test('createLightScene texture has mean approximately 1 per material', () => {
  const median = createGray(4, 1);
  median.data.set([10, 20, 30, 40]);
  const material = new Uint8Array([1, 1, 1, 1]);
  const scene = createLightScene(median, material);
  let sum = 0;
  for (const t of scene.texture) sum += t;
  assert.ok(Math.abs(sum / 4 - 1) < 1e-6);
});

test('metal is brighter than sr under red light by more than under blue light', () => {
  const median = createGray(2, 1, 100);
  const material = new Uint8Array([3, 1]);
  const scene = createLightScene(median, material);
  const red = renderChannel(scene, setting({ channels: [{ color: 'Red', value: 1024, enable: true }] }), 'Red');
  const blue = renderChannel(scene, setting({ channels: [{ color: 'Blue', value: 1024, enable: true }] }), 'Blue');
  const redRatio = red.data[0] / Math.max(1, red.data[1]);
  const blueRatio = blue.data[0] / Math.max(1, blue.data[1]);
  assert.ok(redRatio > blueRatio);
});

test('withReflectance changes rendering and does not mutate the original', () => {
  const median = createGray(1, 1, 100);
  const material = new Uint8Array([3]);
  const scene = createLightScene(median, material);
  const base = cloneReflectance(DEFAULT_REFLECTANCE);
  const s1 = setting({ reflectance: base });
  const before = renderChannel(scene, s1, 'Red').data[0];
  const modified = withReflectance(base, 'metal', 'Red', 0.3);
  const s2 = setting({ reflectance: modified });
  const after = renderChannel(scene, s2, 'Red').data[0];
  assert.ok(after < before);
  assert.equal(base.metal.Red, DEFAULT_REFLECTANCE.metal.Red);
});

test('strong light saturates the high end', () => {
  const median = createGray(1, 1, 200);
  const material = new Uint8Array([3]);
  const scene = createLightScene(median, material);
  const img = renderChannel(
    scene,
    setting({ channels: [{ color: 'White', value: 1024, enable: true }], gain: 2 }),
    'Red',
  );
  assert.equal(img.data[0], 255);
  const stats = measureGv(img, { x: 0, y: 0, w: 1, h: 1 });
  assert.ok(stats.saturatedHigh > 0);
});

test('estimateReflectance recovers the configured reflectance', () => {
  const median = createGray(2, 1, 100);
  const material = new Uint8Array([3, 1]);
  const scene = createLightScene(median, material);
  const s = setting({
    channels: [{ color: 'Red', value: 512, enable: true }],
    reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
  });
  const rendered = renderChannel(scene, s, 'Red');
  const estimated = estimateReflectance(rendered, scene, s, 'Red');
  assert.ok(estimated.metal !== null);
  assert.ok(Math.abs((estimated.metal as number) - DEFAULT_REFLECTANCE.metal.Red) < 0.01);
  assert.ok(estimated.sr !== null);
  assert.ok(Math.abs((estimated.sr as number) - DEFAULT_REFLECTANCE.sr.Red) < 0.01);
});

test('measureGv clamps fractional and out-of-bounds ROIs', () => {
  const img = createGray(10, 10, 5);
  const stats = measureGv(img, { x: 2.5, y: 3.2, w: 4.1, h: 2.9 });
  assert.deepEqual(stats.roi, { x: 2, y: 3, w: 5, h: 4 });
  assert.equal(stats.pixels, 20);
  const oob = measureGv(img, { x: -5, y: -5, w: 100, h: 100 });
  assert.deepEqual(oob.roi, { x: 0, y: 0, w: 10, h: 10 });
  assert.equal(oob.pixels, 100);
});

test('measureGv histogram sums to pixel count', () => {
  const img = createGray(4, 4, 7);
  const stats = measureGv(img, { x: 0, y: 0, w: 4, h: 4 });
  let sum = 0;
  for (const v of stats.histogram) sum += v;
  assert.equal(sum, stats.pixels);
});

test('irradiance sums enabled channels with crosstalk', () => {
  const s = setting({
    channels: [
      { color: 'Red', value: 1024, enable: true },
      { color: 'Blue', value: 512, enable: false },
    ],
  });
  assert.ok(Math.abs(irradiance(s, 'Red') - 1) < 1e-9);
  assert.equal(irradiance(s, 'Green'), 0);
});

test('materialStats reports count, mean and std', () => {
  const img = createGray(3, 1);
  img.data.set([10, 20, 30]);
  const material = new Uint8Array([1, 1, 0]);
  const stats = materialStats(img, material);
  assert.equal(stats.sr.count, 2);
  assert.equal(stats.sr.mean, 15);
  assert.ok(Math.abs(stats.sr.std - 5) < 1e-9);
  assert.equal(stats.base.count, 1);
});
