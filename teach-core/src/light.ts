import type { GrayImage, Rect } from './gray.ts';
import { clampByte } from './gray.ts';

export type Material = 'base' | 'sr' | 'open' | 'metal';
export const MATERIALS: readonly Material[] = ['base', 'sr', 'open', 'metal'];
export type CameraChannel = 'Red' | 'Green' | 'Blue';
export type LightColor = 'Red' | 'Green' | 'Blue' | 'White';

export interface LightChannel {
  color: LightColor;
  value: number;
  enable: boolean;
}

export type Reflectance = Record<Material, Record<CameraChannel, number>>;
export type Crosstalk = Record<LightColor, Record<CameraChannel, number>>;

export interface LightSetting {
  channels: LightChannel[];
  reflectance: Reflectance;
  crosstalk?: Crosstalk;
  gain?: number;
  offset?: number;
  textureStrength?: number;
}

export interface LightScene {
  width: number;
  height: number;
  material: Uint8Array;
  texture: Float32Array;
}

export interface GvStats {
  roi: Rect;
  mean: number;
  std: number;
  min: number;
  max: number;
  pixels: number;
  histogram: number[];
  saturatedHigh: number;
  saturatedLow: number;
}

export const DEFAULT_REFLECTANCE: Reflectance = {
  metal: { Red: 0.9, Green: 0.7, Blue: 0.45 },
  sr: { Red: 0.12, Green: 0.35, Blue: 0.15 },
  open: { Red: 0.5, Green: 0.45, Blue: 0.35 },
  base: { Red: 0.05, Green: 0.05, Blue: 0.05 },
};

export const DEFAULT_CROSSTALK: Crosstalk = {
  Red: { Red: 1, Green: 0, Blue: 0 },
  Green: { Red: 0, Green: 1, Blue: 0 },
  Blue: { Red: 0, Green: 0, Blue: 1 },
  White: { Red: 1, Green: 1, Blue: 1 },
};

const MATERIAL_INDEX: Record<Material, number> = { base: 0, sr: 1, open: 2, metal: 3 };
const INDEX_MATERIAL: Material[] = ['base', 'sr', 'open', 'metal'];

export function cloneReflectance(r: Reflectance): Reflectance {
  return {
    base: { ...r.base },
    sr: { ...r.sr },
    open: { ...r.open },
    metal: { ...r.metal },
  };
}

export function withReflectance(
  r: Reflectance,
  material: Material,
  channel: CameraChannel,
  value: number,
): Reflectance {
  const next = cloneReflectance(r);
  const clamped = Math.min(2, Math.max(0, value));
  next[material][channel] = clamped;
  return next;
}

export function buildMaterialMap(
  layers: { metal: GrayImage; sr: GrayImage; open: GrayImage },
  threshold = 128,
): Uint8Array {
  const { metal, sr, open } = layers;
  if (metal.width !== sr.width || metal.height !== sr.height || metal.width !== open.width || metal.height !== open.height) {
    throw new Error('buildMaterialMap: layer sizes must match');
  }
  const n = metal.width * metal.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (metal.data[i] >= threshold) out[i] = 3;
    else if (open.data[i] >= threshold) out[i] = 2;
    else if (sr.data[i] >= threshold) out[i] = 1;
    else out[i] = 0;
  }
  return out;
}

export function materialStats(
  image: GrayImage,
  material: Uint8Array,
): Record<Material, { count: number; mean: number; std: number }> {
  if (image.width * image.height !== material.length) {
    throw new Error('materialStats: size mismatch');
  }
  const counts = [0, 0, 0, 0];
  const sums = [0, 0, 0, 0];
  const sumsSq = [0, 0, 0, 0];
  const n = material.length;
  for (let i = 0; i < n; i++) {
    const m = material[i];
    const v = image.data[i];
    counts[m]++;
    sums[m] += v;
    sumsSq[m] += v * v;
  }
  const out = {} as Record<Material, { count: number; mean: number; std: number }>;
  for (let m = 0; m < 4; m++) {
    const count = counts[m];
    if (count === 0) {
      out[INDEX_MATERIAL[m]] = { count: 0, mean: 0, std: 0 };
    } else {
      const mean = sums[m] / count;
      const variance = Math.max(0, sumsSq[m] / count - mean * mean);
      out[INDEX_MATERIAL[m]] = { count, mean, std: Math.sqrt(variance) };
    }
  }
  return out;
}

export function createLightScene(median: GrayImage, material: Uint8Array): LightScene {
  if (median.width * median.height !== material.length) {
    throw new Error('createLightScene: size mismatch');
  }
  const stats = materialStats(median, material);
  const means = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) means[m] = stats[INDEX_MATERIAL[m]].mean;
  const n = material.length;
  const texture = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = material[i];
    const mean = means[m];
    let t = mean === 0 ? 1 : median.data[i] / mean;
    if (t < 0) t = 0;
    else if (t > 4) t = 4;
    texture[i] = t;
  }
  return { width: median.width, height: median.height, material, texture };
}

export function irradiance(setting: LightSetting, channel: CameraChannel): number {
  const crosstalk = setting.crosstalk ?? DEFAULT_CROSSTALK;
  let sum = 0;
  for (const ch of setting.channels) {
    if (!ch.enable) continue;
    const value = Math.min(1024, Math.max(0, ch.value));
    sum += (value / 1024) * crosstalk[ch.color][channel];
  }
  return sum;
}

export function renderChannel(scene: LightScene, setting: LightSetting, channel: CameraChannel): GrayImage {
  const gain = setting.gain ?? 1;
  const offset = setting.offset ?? 0;
  const s = setting.textureStrength ?? 1;
  const E = irradiance(setting, channel);
  const perMaterial = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) {
    perMaterial[m] = gain * E * setting.reflectance[INDEX_MATERIAL[m]][channel] * 255;
  }
  const n = scene.material.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const m = scene.material[i];
    const t = 1 + s * (scene.texture[i] - 1);
    out[i] = clampByte(perMaterial[m] * t + offset);
  }
  return { width: scene.width, height: scene.height, data: out };
}

export function renderRgb(
  scene: LightScene,
  setting: LightSetting,
): { red: GrayImage; green: GrayImage; blue: GrayImage } {
  return {
    red: renderChannel(scene, setting, 'Red'),
    green: renderChannel(scene, setting, 'Green'),
    blue: renderChannel(scene, setting, 'Blue'),
  };
}

export function toLuma(rgb: { red: GrayImage; green: GrayImage; blue: GrayImage }): GrayImage {
  const { red, green, blue } = rgb;
  if (red.width !== green.width || red.height !== green.height || red.width !== blue.width || red.height !== blue.height) {
    throw new Error('toLuma: size mismatch');
  }
  const n = red.data.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = clampByte(0.299 * red.data[i] + 0.587 * green.data[i] + 0.114 * blue.data[i]);
  }
  return { width: red.width, height: red.height, data: out };
}

export function estimateReflectance(
  median: GrayImage,
  scene: LightScene,
  setting: LightSetting,
  channel: CameraChannel,
): Record<Material, number | null> {
  if (median.width * median.height !== scene.material.length) {
    throw new Error('estimateReflectance: size mismatch');
  }
  const gain = setting.gain ?? 1;
  const offset = setting.offset ?? 0;
  const E = irradiance(setting, channel);
  const counts = [0, 0, 0, 0];
  const sums = [0, 0, 0, 0];
  const n = scene.material.length;
  for (let i = 0; i < n; i++) {
    const m = scene.material[i];
    counts[m]++;
    sums[m] += median.data[i];
  }
  const out = {} as Record<Material, number | null>;
  for (let m = 0; m < 4; m++) {
    const count = counts[m];
    if (count === 0 || E === 0) {
      out[INDEX_MATERIAL[m]] = null;
    } else {
      const mean = sums[m] / count;
      out[INDEX_MATERIAL[m]] = (mean - offset) / (gain * E * 255);
    }
  }
  return out;
}

export function measureGv(img: GrayImage, roi: Rect): GvStats {
  if (img.width <= 0 || img.height <= 0) throw new Error('measureGv: empty image');
  const x0 = Math.min(Math.floor(Math.max(roi.x, 0)), img.width - 1);
  const y0 = Math.min(Math.floor(Math.max(roi.y, 0)), img.height - 1);
  const x1 = Math.min(Math.max(Math.ceil(roi.x + roi.w), x0 + 1), img.width);
  const y1 = Math.min(Math.max(Math.ceil(roi.y + roi.h), y0 + 1), img.height);
  const w = x1 - x0;
  const h = y1 - y0;
  const histogram = new Array<number>(256).fill(0);
  let sum = 0;
  let sumSq = 0;
  let min = 255;
  let max = 0;
  let saturatedHigh = 0;
  let saturatedLow = 0;
  const pixels = w * h;
  for (let y = y0; y < y1; y++) {
    const row = y * img.width;
    for (let x = x0; x < x1; x++) {
      const v = img.data[row + x];
      histogram[v]++;
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (v === 255) saturatedHigh++;
      if (v === 0) saturatedLow++;
    }
  }
  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  return {
    roi: { x: x0, y: y0, w, h },
    mean,
    std: Math.sqrt(variance),
    min,
    max,
    pixels,
    histogram,
    saturatedHigh,
    saturatedLow,
  };
}

export function materialMask(scene: LightScene, materials: Material[]): Uint8Array {
  const wanted = new Set<number>();
  for (const m of materials) wanted.add(MATERIAL_INDEX[m]);
  const n = scene.material.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = wanted.has(scene.material[i]) ? 1 : 0;
  }
  return out;
}
