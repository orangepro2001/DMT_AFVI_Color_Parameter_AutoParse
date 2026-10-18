import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clampByte,
  cloneGray,
  createGray,
  cropGray,
  downsampleArea,
  gaussianBlur,
  getPixel,
  sampleBilinear,
} from '../src/gray.ts';

test('sampleBilinear returns pixel value at integer coordinates', () => {
  const img = createGray(4, 3);
  img.data[1 * 4 + 2] = 200;
  assert.equal(sampleBilinear(img, 2, 1), 200);
  assert.equal(sampleBilinear(img, 0, 0), 0);
});

test('sampleBilinear averages at midpoints', () => {
  const img = createGray(2, 2);
  img.data[0] = 0;
  img.data[1] = 100;
  img.data[2] = 200;
  img.data[3] = 300 % 256;
  const mid = sampleBilinear(img, 0.5, 0.5);
  assert.ok(mid !== null);
  assert.ok(Math.abs((mid as number) - (0 + 100 + 200 + 44) / 4) < 1e-9);
});

test('sampleBilinear returns null out of bounds', () => {
  const img = createGray(3, 3);
  assert.equal(sampleBilinear(img, -0.1, 0), null);
  assert.equal(sampleBilinear(img, 0, -1), null);
  assert.equal(sampleBilinear(img, 3, 0), null);
  assert.equal(sampleBilinear(img, 0, 3), null);
});

test('gaussianBlur with sigma 0 returns a copy', () => {
  const img = createGray(3, 3, 10);
  const out = gaussianBlur(img, 0);
  assert.notEqual(out.data, img.data);
  assert.deepEqual(Array.from(out.data), Array.from(img.data));
});

test('gaussianBlur leaves constant images unchanged', () => {
  const img = createGray(8, 8, 77);
  const out = gaussianBlur(img, 1.5);
  for (const v of out.data) assert.equal(v, 77);
});

test('downsampleArea averages 2x2 blocks', () => {
  const img = createGray(4, 4);
  img.data[0] = 0;
  img.data[1] = 100;
  img.data[4] = 200;
  img.data[5] = 44;
  const out = downsampleArea(img, 2);
  assert.equal(out.width, 2);
  assert.equal(out.height, 2);
  assert.equal(out.data[0], Math.round((0 + 100 + 200 + 44) / 4));
});

test('downsampleArea factor 1 returns a copy', () => {
  const img = createGray(3, 3, 5);
  const out = downsampleArea(img, 1);
  assert.notEqual(out.data, img.data);
  assert.deepEqual(Array.from(out.data), Array.from(img.data));
});

test('cropGray clamps to image bounds', () => {
  const img = createGray(5, 5, 3);
  const out = cropGray(img, { x: -2, y: -2, w: 4, h: 4 });
  assert.equal(out.width, 2);
  assert.equal(out.height, 2);
  assert.equal(getPixel(out, 0, 0), 3);
});

test('cropGray throws on empty region', () => {
  const img = createGray(5, 5);
  assert.throws(() => cropGray(img, { x: 10, y: 10, w: 2, h: 2 }));
});

test('clampByte rounds and clamps', () => {
  assert.equal(clampByte(-5), 0);
  assert.equal(clampByte(300), 255);
  assert.equal(clampByte(12.6), 13);
  assert.equal(clampByte(12.4), 12);
});

test('cloneGray produces an independent copy', () => {
  const img = createGray(2, 2, 1);
  const copy = cloneGray(img);
  copy.data[0] = 9;
  assert.equal(img.data[0], 1);
});
