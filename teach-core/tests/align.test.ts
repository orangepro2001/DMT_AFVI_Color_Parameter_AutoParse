import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGray } from '../src/gray.ts';
import { createRng } from '../src/rng.ts';
import { IDENTITY_WARP, applySimilarity, applyWarp, warpPoint } from '../src/warp.ts';
import type { WarpParams } from '../src/warp.ts';
import {
  DEFAULT_ALIGN_CONFIG,
  alignWithRois,
  compareToTruth,
  fitSimilarity,
  ransacSimilarity,
} from '../src/align.ts';
import type { AlignRoi } from '../src/align.ts';

function makeTexture(width: number, height: number, seed: number): ReturnType<typeof createGray> {
  const img = createGray(width, height);
  const rng = createRng(seed);
  const block = 8;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const v = Math.floor(rng.next() * 256);
      for (let y = by; y < Math.min(by + block, height); y++) {
        for (let x = bx; x < Math.min(bx + block, width); x++) {
          img.data[y * width + x] = v;
        }
      }
    }
  }
  const drawCross = (cx: number, cy: number): void => {
    for (let d = -6; d <= 6; d++) {
      const x = cx + d;
      const y = cy + d;
      if (x >= 0 && x < width && y >= 0 && y < height) img.data[y * width + x] = 255;
      if (x >= 0 && x < width && cy - d >= 0 && cy - d < height) img.data[(cy - d) * width + x] = 0;
    }
  };
  drawCross(40, 40);
  drawCross(width - 40, 40);
  drawCross(40, height - 40);
  drawCross(width - 40, height - 40);
  return img;
}

test('fitSimilarity recovers a known similarity transform', () => {
  const s = { tx: 12.5, ty: -7.25, thetaDeg: 0.4, scale: 1.003 };
  const src: [number, number][] = [
    [0, 0],
    [100, 0],
    [0, 100],
    [100, 100],
  ];
  const dst = src.map((p) => applySimilarity(s, p));
  const fit = fitSimilarity(src, dst);
  assert.ok(fit !== null);
  const f = fit as { tx: number; ty: number; thetaDeg: number; scale: number };
  assert.ok(Math.abs(f.tx - s.tx) < 1e-6);
  assert.ok(Math.abs(f.ty - s.ty) < 1e-6);
  assert.ok(Math.abs(f.thetaDeg - s.thetaDeg) < 1e-6);
  assert.ok(Math.abs(f.scale - s.scale) < 1e-6);
});

test('ransacSimilarity tolerates a single outlier', () => {
  const s = { tx: 3, ty: 4, thetaDeg: 1, scale: 1.0 };
  const src: [number, number][] = [
    [0, 0],
    [50, 0],
    [0, 50],
    [50, 50],
    [25, 25],
  ];
  const dst = src.map((p) => applySimilarity(s, p));
  dst[2] = [dst[2][0] + 40, dst[2][1] - 30];
  const result = ransacSimilarity(src, dst, 3, 200, 1);
  assert.ok(result.fit !== null);
  assert.ok(!result.inliers.includes(2));
  assert.ok(result.inliers.length >= 4);
});

test('alignWithRois recovers a small similarity transform on synthetic texture', () => {
  const width = 400;
  const height = 300;
  const template = makeTexture(width, height, 7);
  const warp: WarpParams = {
    ...IDENTITY_WARP,
    tx: 12.5,
    ty: -7.25,
    thetaDeg: 0.4,
    scale: 1.003,
  };
  const input = applyWarp(template, warp, 7);
  const rois: AlignRoi[] = [
    { name: 'TL', x: 20, y: 20, w: 60, h: 60 },
    { name: 'TR', x: width - 80, y: 20, w: 60, h: 60 },
    { name: 'BL', x: 20, y: height - 80, w: 60, h: 60 },
    { name: 'BR', x: width - 80, y: height - 80, w: 60, h: 60 },
  ];
  const report = alignWithRois(template, input, rois, DEFAULT_ALIGN_CONFIG);
  assert.equal(report.verdict.level, 'ok');
  const truth = compareToTruth(report.fit, warp, rois, width, height);
  assert.ok(truth.meanErrorPx < 0.5);
});

test('matchRoi locates a ROI larger than the search radius', () => {
  const width = 400;
  const height = 400;
  const template = makeTexture(width, height, 21);
  const warp: WarpParams = { ...IDENTITY_WARP, tx: 5, ty: -3 };
  const input = applyWarp(template, warp, 21);
  const roi: AlignRoi = { name: 'big', x: 150, y: 150, w: 80, h: 80 };
  const config = { ...DEFAULT_ALIGN_CONFIG, searchRadius: 16, pyramidFactor: 4 };
  const report = alignWithRois(template, input, [roi], config);
  const match = report.matches[0];
  assert.equal(match.located, true);
  assert.ok(match.found !== null);
  const center: [number, number] = [roi.x + roi.w / 2, roi.y + roi.h / 2];
  const truth = warpPoint(warp, center, width, height);
  const found = match.found as [number, number];
  const err = Math.hypot(found[0] - truth[0], found[1] - truth[1]);
  assert.ok(err < 0.5, `expected error < 0.5px, got ${err}`);
});

test('flat ROI is reported as flat', () => {
  const width = 200;
  const height = 200;
  const template = createGray(width, height, 128);
  const input = createGray(width, height, 128);
  const rois: AlignRoi[] = [{ name: 'flat', x: 50, y: 50, w: 40, h: 40 }];
  const report = alignWithRois(template, input, rois, DEFAULT_ALIGN_CONFIG);
  assert.equal(report.matches[0].reason, 'flat');
  assert.equal(report.verdict.level, 'ng');
});

test('translation beyond searchRadius fails and yields ng', () => {
  const width = 300;
  const height = 300;
  const template = makeTexture(width, height, 11);
  const warp: WarpParams = { ...IDENTITY_WARP, tx: 400, ty: 0 };
  const input = applyWarp(template, warp, 11);
  const rois: AlignRoi[] = [
    { name: 'A', x: 40, y: 40, w: 60, h: 60 },
    { name: 'B', x: width - 100, y: 40, w: 60, h: 60 },
  ];
  const report = alignWithRois(template, input, rois, DEFAULT_ALIGN_CONFIG);
  assert.equal(report.verdict.level, 'ng');
});

test('periodic stripe ROI is flagged as ambiguous', () => {
  const width = 300;
  const height = 300;
  const template = createGray(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      template.data[y * width + x] = x % 8 < 4 ? 30 : 220;
    }
  }
  const input = applyWarp(template, { ...IDENTITY_WARP, tx: 3, ty: 2 }, 1);
  const rois: AlignRoi[] = [
    { name: 'stripe', x: 100, y: 100, w: 80, h: 80 },
    { name: 'stripe2', x: 150, y: 150, w: 80, h: 80 },
  ];
  const report = alignWithRois(template, input, rois, DEFAULT_ALIGN_CONFIG);
  assert.ok(report.verdict.reasons.some((r) => r.code === 'ambiguous'));
});
