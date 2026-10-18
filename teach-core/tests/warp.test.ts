import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGray, getPixel } from '../src/gray.ts';
import {
  IDENTITY_WARP,
  applySimilarity,
  applyWarp,
  composeSimilarity,
  invertSimilarity,
  unwarpPoint,
  warpPoint,
  warpToSimilarity,
} from '../src/warp.ts';
import type { WarpParams } from '../src/warp.ts';

function params(overrides: Partial<WarpParams> = {}): WarpParams {
  return { ...IDENTITY_WARP, ...overrides };
}

test('unwarpPoint inverts warpPoint including shear and bend', () => {
  const p: [number, number] = [123.4, 56.7];
  const w = 200;
  const h = 150;
  const wp = params({ tx: 12.5, ty: -7.25, thetaDeg: 0.4, scale: 1.003, shearX: 0.02, shearY: -0.015, bendAmplitude: 6, bendWavelength: 1500 });
  const q = warpPoint(wp, p, w, h);
  const back = unwarpPoint(wp, q, w, h);
  assert.ok(back !== null);
  assert.ok(Math.abs((back as [number, number])[0] - p[0]) < 1e-6);
  assert.ok(Math.abs((back as [number, number])[1] - p[1]) < 1e-6);
});

test('applyWarp with identity params returns the input', () => {
  const img = createGray(8, 8);
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 7) % 256;
  const out = applyWarp(img, IDENTITY_WARP, 1);
  assert.deepEqual(Array.from(out.data), Array.from(img.data));
});

test('applyWarp with integer translation moves content correctly', () => {
  const img = createGray(8, 8);
  img.data[3 * 8 + 3] = 200;
  const out = applyWarp(img, params({ tx: 2, ty: 1 }), 1);
  assert.equal(getPixel(out, 5, 4), 200);
});

test('applyWarp is deterministic per seed and differs across seeds', () => {
  const img = createGray(16, 16, 100);
  const p = params({ noiseSigma: 20 });
  const a = applyWarp(img, p, 42);
  const b = applyWarp(img, p, 42);
  const c = applyWarp(img, p, 43);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(c.data));
});

test('warpToSimilarity matches warpPoint when there is no shear or bend', () => {
  const w = 100;
  const h = 80;
  const p = params({ tx: 5, ty: -3, thetaDeg: 1.2, scale: 1.01 });
  const sim = warpToSimilarity(p, w, h);
  const point: [number, number] = [40, 30];
  const viaSim = applySimilarity(sim, point);
  const viaWarp = warpPoint(p, point, w, h);
  assert.ok(Math.abs(viaSim[0] - viaWarp[0]) < 1e-9);
  assert.ok(Math.abs(viaSim[1] - viaWarp[1]) < 1e-9);
});

test('invertSimilarity and composeSimilarity round-trip', () => {
  const s = { tx: 10, ty: -5, thetaDeg: 3, scale: 1.02 };
  const inv = invertSimilarity(s);
  const p: [number, number] = [12, 34];
  const round = applySimilarity(inv, applySimilarity(s, p));
  assert.ok(Math.abs(round[0] - p[0]) < 1e-9);
  assert.ok(Math.abs(round[1] - p[1]) < 1e-9);
  const a = { tx: 1, ty: 2, thetaDeg: 5, scale: 1.01 };
  const b = { tx: -3, ty: 4, thetaDeg: -2, scale: 0.99 };
  const composed = composeSimilarity(a, b);
  const viaCompose = applySimilarity(composed, p);
  const viaChain = applySimilarity(a, applySimilarity(b, p));
  assert.ok(Math.abs(viaCompose[0] - viaChain[0]) < 1e-9);
  assert.ok(Math.abs(viaCompose[1] - viaChain[1]) < 1e-9);
});
