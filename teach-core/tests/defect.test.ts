import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGray } from '../src/gray.ts';
import {
  DEFAULT_DEFECT_PARAMS,
  defectParamsFromInspection,
  detectDefects,
  generateRandomDefects,
  paintDefects,
  paintScene,
  probeArea,
  renderDefectPair,
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

function uniformScene(width: number, height: number, materialIndex: number, medianValue: number) {
  const median = createGray(width, height, medianValue);
  const material = new Uint8Array(width * height).fill(materialIndex);
  return createLightScene(median, material);
}

function redSetting(value: number, gain = 1): LightSetting {
  return {
    channels: [{ color: 'Red', value, enable: true }],
    reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
    gain,
  };
}

test('renderDefectPair with no strokes and no noise matches golden byte for byte', () => {
  const scene = uniformScene(30, 30, 3, 100);
  const { golden, test } = renderDefectPair(scene, redSetting(512), 'Red', [], []);
  assert.equal(golden.width, test.width);
  assert.equal(golden.height, test.height);
  assert.deepEqual(Array.from(test.data), Array.from(golden.data));
});

test('renderDefectPair paints before clamping so saturated dark spots stay saturated', () => {
  const scene = uniformScene(40, 40, 3, 100);
  const setting = redSetting(1024, 3);
  const golden = renderChannel(scene, setting, 'Red');
  assert.equal(golden.data[20 * 40 + 20], 255);
  const { test } = renderDefectPair(scene, setting, 'Red', [], [
    { kind: 'dark', shape: 'spot', x: 20, y: 20, radius: 5, deltaGv: 60, softness: 0 },
  ]);
  assert.equal(test.data[20 * 40 + 20], 255);
  const report = detectDefects(golden, test, DEFAULT_DEFECT_PARAMS);
  assert.equal(report.blobs.filter((b) => b.kind === 'dark').length, 0);
});

test('relative amplitude scales with illumination', () => {
  const scene = uniformScene(40, 40, 2, 100);
  const stroke = {
    kind: 'bright' as const,
    shape: 'spot' as const,
    x: 20,
    y: 20,
    radius: 5,
    deltaGv: 0,
    softness: 0,
    amplitude: 'relative' as const,
    relativePct: 50,
  };
  const low = renderDefectPair(scene, redSetting(512), 'Red', [], [stroke]);
  const high = renderDefectPair(scene, redSetting(1024), 'Red', [], [stroke]);
  const idx = 20 * 40 + 20;
  const lowDelta = low.test.data[idx] - low.golden.data[idx];
  const highDelta = high.test.data[idx] - high.golden.data[idx];
  assert.ok(lowDelta > 0);
  assert.ok(Math.abs(highDelta - 2 * lowDelta) <= 2);
});

test('target amplitude clamps to the target and never lowers a brighter pixel', () => {
  const dark = paintDefects(createGray(20, 20, 200), [
    { kind: 'bright', shape: 'spot', x: 10, y: 10, radius: 4, deltaGv: 0, softness: 0, amplitude: 'target', targetGv: 250 },
  ]);
  assert.equal(dark.data[10 * 20 + 10], 250);

  const bright = paintDefects(createGray(20, 20, 252), [
    { kind: 'bright', shape: 'spot', x: 10, y: 10, radius: 4, deltaGv: 0, softness: 0, amplitude: 'target', targetGv: 250 },
  ]);
  assert.equal(bright.data[10 * 20 + 10], 252);
});

test('paintScene line strokes follow the second endpoint', () => {
  const scene = uniformScene(40, 40, 1, 100);
  const painted = paintScene(scene, [
    { mode: 'texture', shape: 'line', x: 5, y: 5, x2: 30, y2: 30, radius: 2, factor: 2 },
  ]);
  const onLine = painted.texture[25 * 40 + 25];
  const offLine = painted.texture[5 * 40 + 25];
  const base = scene.texture[25 * 40 + 25];
  assert.ok(onLine / base > 1.9);
  assert.equal(offLine, scene.texture[5 * 40 + 25]);
});

test('relative threshold raises the effective threshold with background GV', () => {
  const golden = createGray(40, 40, 200);
  const test = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 20, y: 20, radius: 6, deltaGv: 40, softness: 0 },
  ]);
  const base = detectDefects(golden, test, DEFAULT_DEFECT_PARAMS);
  assert.ok(base.blobs.some((b) => b.kind === 'bright' && b.detected));

  const rel = detectDefects(golden, test, { ...DEFAULT_DEFECT_PARAMS, brightRelPct: 10 });
  assert.equal(rel.blobs.filter((b) => b.kind === 'bright' && b.detected).length, 0);

  const darkGolden = createGray(40, 40, 50);
  const darkTest = paintDefects(darkGolden, [
    { kind: 'bright', shape: 'spot', x: 20, y: 20, radius: 6, deltaGv: 40, softness: 0 },
  ]);
  const darkRel = detectDefects(darkGolden, darkTest, { ...DEFAULT_DEFECT_PARAMS, brightRelPct: 10 });
  assert.ok(darkRel.blobs.some((b) => b.kind === 'bright' && b.detected));
});

test('probeArea uses connectivity and respects the region mask', () => {
  const golden = createGray(40, 40, 100);
  const test = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 15, y: 20, radius: 1, deltaGv: 40, softness: 0 },
    { kind: 'bright', shape: 'spot', x: 25, y: 20, radius: 1, deltaGv: 40, softness: 0 },
  ]);
  const probe = probeArea(golden, test, { x: 10, y: 10, w: 20, h: 20 }, DEFAULT_DEFECT_PARAMS);
  assert.equal(probe.brightPixels, 10);
  assert.equal(probe.largestBright, 5);
  assert.equal(probe.wouldDetectBright, false);

  const region = new Uint8Array(40 * 40);
  const masked = probeArea(golden, test, { x: 10, y: 10, w: 20, h: 20 }, DEFAULT_DEFECT_PARAMS, region);
  assert.equal(masked.pixels, 0);
  assert.equal(masked.wouldDetectBright, false);
});

test('rect strokes fill the rectangle and detect as a single blob', () => {
  const golden = createGray(20, 20, 100);
  const test = paintDefects(golden, [
    { kind: 'bright', shape: 'rect', x: 5, y: 5, x2: 14, y2: 9, radius: 0, deltaGv: 50, softness: 0 },
  ]);
  assert.equal(test.data[7 * 20 + 7], 150);
  assert.equal(test.data[2 * 20 + 2], 100);
  const report = detectDefects(golden, test, DEFAULT_DEFECT_PARAMS);
  const bright = report.blobs.find((b) => b.kind === 'bright');
  assert.ok(bright !== undefined);
  assert.equal(bright?.area, 50);
});

test('gaussian profile lowers the transition band but keeps the center', () => {
  const golden = createGray(40, 40, 100);
  const linear = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 20, y: 20, radius: 6, deltaGv: 100, softness: 0.5, profile: 'linear' },
  ]);
  const gaussian = paintDefects(golden, [
    { kind: 'bright', shape: 'spot', x: 20, y: 20, radius: 6, deltaGv: 100, softness: 0.5, profile: 'gaussian' },
  ]);
  const center = 20 * 40 + 20;
  assert.equal(linear.data[center], gaussian.data[center]);
  const band = 20 * 40 + 24;
  assert.ok(gaussian.data[band] < linear.data[band]);
});

test('grain is deterministic per seed and inert at zero', () => {
  const golden = createGray(40, 40, 100);
  const base = { kind: 'bright' as const, shape: 'spot' as const, x: 20, y: 20, radius: 8, deltaGv: 80, softness: 0.2 };
  const a = paintDefects(golden, [{ ...base, grain: 0.5, seed: 7 }]);
  const b = paintDefects(golden, [{ ...base, grain: 0.5, seed: 7 }]);
  const c = paintDefects(golden, [{ ...base, grain: 0.5, seed: 8 }]);
  const plain = paintDefects(golden, [{ ...base, grain: 0 }]);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(c.data));
  assert.deepEqual(Array.from(plain.data), Array.from(paintDefects(golden, [base]).data));
});

test('sensor noise is deterministic and scales with signal', () => {
  const width = 40;
  const height = 40;
  const median = createGray(width, height, 100);
  const material = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      material[y * width + x] = x < width / 2 ? 1 : 3;
    }
  }
  const scene = createLightScene(median, material);
  const setting = redSetting(1024);
  const noise = { readSigma: 0, shotGain: 1, seed: 3 };
  const first = renderDefectPair(scene, setting, 'Red', [], [], noise);
  const second = renderDefectPair(scene, setting, 'Red', [], [], noise);
  assert.deepEqual(Array.from(first.test.data), Array.from(second.test.data));

  const std = (from: number, to: number): number => {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = from; x < to; x++) {
        const idx = y * width + x;
        const d = first.test.data[idx] - first.golden.data[idx];
        sum += d;
        sumSq += d * d;
        count++;
      }
    }
    const mean = sum / count;
    return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
  };
  assert.ok(std(0, width / 2) < std(width / 2, width));
});

test('generateRandomDefects is deterministic and respects material constraints', () => {
  const width = 60;
  const height = 60;
  const material = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      material[y * width + x] = x < width / 2 ? 1 : 3;
    }
  }
  const options = {
    count: 8,
    seed: 42,
    width,
    height,
    kind: 'mixed' as const,
    shape: 'mixed' as const,
    radiusMin: 2,
    radiusMax: 6,
    valueMin: 30,
    valueMax: 80,
    amplitude: 'absolute' as const,
    profile: 'linear' as const,
    softness: 0.3,
    grain: 0,
    lineLengthMax: 60,
  };
  const a = generateRandomDefects(options);
  const b = generateRandomDefects(options);
  assert.equal(a.length, 8);
  assert.deepEqual(a, b);
  for (const stroke of a) {
    assert.ok(stroke.x >= stroke.radius && stroke.x <= width - 1 - stroke.radius);
    assert.ok(stroke.y >= stroke.radius && stroke.y <= height - 1 - stroke.radius);
  }

  const constrained = generateRandomDefects({ ...options, material, materials: ['metal'] });
  assert.ok(constrained.length > 0);
  for (const stroke of constrained) {
    const ix = Math.round(stroke.x);
    const iy = Math.round(stroke.y);
    assert.equal(material[iy * width + ix], 3);
  }
});
