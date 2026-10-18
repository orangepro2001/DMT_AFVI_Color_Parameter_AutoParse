import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGray } from '../src/gray.ts';
import {
  DEFAULT_DEFECT_PARAMS,
  defectParamsFromInspection,
  detectDefects,
  paintDefects,
  paintScene,
  probeArea,
} from '../src/defect.ts';
import { DEFAULT_REFLECTANCE, cloneReflectance, createLightScene, renderChannel } from '../src/light.ts';
import type { LightSetting } from '../src/light.ts';

test('paintDefects brightens for bright strokes and darkens for dark strokes', () => {
  const img = createGray(20, 20, 100);
  const bright = paintDefects(img, [
    { kind: 'bright', shape: 'spot', x: 10, y: 10, radius: 3, deltaGv: 50, softness: 0 },
  ]);
  assert.equal(bright.data[10 * 20 + 10], 150);
  const dark = paintDefects(img, [
    { kind: 'dark', shape: 'spot', x: 10, y: 10, radius: 3, deltaGv: 50, softness: 0 },
  ]);
  assert.equal(dark.data[10 * 20 + 10], 50);
});

test('paintDefects line weight falls off with distance', () => {
  const img = createGray(20, 20, 0);
  const out = paintDefects(img, [
    { kind: 'bright', shape: 'line', x: 2, y: 10, x2: 18, y2: 10, radius: 4, deltaGv: 100, softness: 0.5 },
  ]);
  const center = out.data[10 * 20 + 10];
  const edge = out.data[13 * 20 + 10];
  assert.equal(center, 100);
  assert.equal(edge, 50);
});

test('detectDefects finds a large bright spot and rejects a tiny dark spot', () => {
  const golden = createGray(60, 60, 100);
  const test = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 20, y: 20, radius: 6, deltaGv: 60, softness: 0.3 },
    { kind: 'dark', shape: 'spot', x: 40, y: 40, radius: 1.5, deltaGv: 50, softness: 0 },
  ]);
  const report = detectDefects(golden, test, DEFAULT_DEFECT_PARAMS);
  const bright = report.blobs.find((b) => b.kind === 'bright');
  const dark = report.blobs.find((b) => b.kind === 'dark');
  assert.ok(bright !== undefined);
  assert.equal(bright?.detected, true);
  assert.ok(dark !== undefined);
  assert.equal(dark?.detected, false);
  assert.equal(dark?.rejectReason, 'below-size');
});

test('detectDefects ignores defects outside the region mask', () => {
  const golden = createGray(40, 40, 100);
  const test = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 10, y: 10, radius: 5, deltaGv: 80, softness: 0 },
  ]);
  const region = new Uint8Array(40 * 40);
  for (let y = 20; y < 40; y++) {
    for (let x = 20; x < 40; x++) region[y * 40 + x] = 1;
  }
  const report = detectDefects(golden, test, DEFAULT_DEFECT_PARAMS, region);
  assert.equal(report.detectedCount, 0);
});

test('defectParamsFromInspection maps keys and reports missing ones', () => {
  const { params, missing } = defectParamsFromInspection({ '1000': 25, '1002': 8 });
  assert.equal(params.brightTh, 25);
  assert.equal(params.brightMinSize, 8);
  assert.equal(params.darkTh, DEFAULT_DEFECT_PARAMS.darkTh);
  assert.ok(missing.includes('1009'));
  assert.ok(missing.includes('1011'));
  assert.ok(missing.includes('1024'));
});

test('probeArea explains why a defect was not detected', () => {
  const golden = createGray(30, 30, 100);
  const test = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 15, y: 15, radius: 1, deltaGv: 40, softness: 0 },
  ]);
  const probe = probeArea(golden, test, { x: 10, y: 10, w: 10, h: 10 }, DEFAULT_DEFECT_PARAMS);
  assert.ok(probe.maxBright >= 40);
  assert.equal(probe.brightPixels, 5);
  assert.equal(probe.wouldDetectBright, false);

  const test2 = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 15, y: 15, radius: 2, deltaGv: 40, softness: 0 },
  ]);
  const probe2 = probeArea(golden, test2, { x: 10, y: 10, w: 10, h: 10 }, DEFAULT_DEFECT_PARAMS);
  assert.equal(probe2.wouldDetectBright, true);
});

test('paintScene material mode produces different contrast under red and blue light', () => {
  const median = createGray(40, 40, 100);
  const material = new Uint8Array(40 * 40).fill(1);
  const scene = createLightScene(median, material);
  const withForeign = paintScene(scene, [
    { mode: 'material', shape: 'spot', x: 20, y: 20, radius: 5, material: 'metal' },
  ]);
  const redSetting: LightSetting = {
    channels: [{ color: 'Red', value: 600, enable: true }],
    reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
  };
  const blueSetting: LightSetting = {
    channels: [{ color: 'Blue', value: 600, enable: true }],
    reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
  };
  const redGolden = renderChannel(scene, redSetting, 'Red');
  const redTest = renderChannel(withForeign, redSetting, 'Red');
  const blueGolden = renderChannel(scene, blueSetting, 'Blue');
  const blueTest = renderChannel(withForeign, blueSetting, 'Blue');
  const idx = 20 * 40 + 20;
  const redDelta = Math.abs(redTest.data[idx] - redGolden.data[idx]);
  const blueDelta = Math.abs(blueTest.data[idx] - blueGolden.data[idx]);
  assert.notEqual(redDelta, blueDelta);
});
