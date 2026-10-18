import type { GrayImage, Point, Rect } from './gray.ts';
import { clampByte } from './gray.ts';
import type { CameraChannel, LightScene, LightSetting, Material } from './light.ts';
import { channelTransfer, linearValue, renderChannel } from './light.ts';
import { createRng } from './rng.ts';

export type DefectShape = 'spot' | 'line' | 'rect';
export type DefectAmplitude = 'absolute' | 'relative' | 'target';
export type DefectProfile = 'linear' | 'gaussian';

export interface DefectStroke {
  kind: 'bright' | 'dark';
  shape: DefectShape;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  radius: number;
  deltaGv: number;
  softness: number;
  amplitude?: DefectAmplitude;
  relativePct?: number;
  targetGv?: number;
  profile?: DefectProfile;
  grain?: number;
  seed?: number;
}

export interface SceneStroke {
  mode: 'material' | 'texture';
  shape: DefectShape;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  radius: number;
  material?: Material;
  factor?: number;
}

export interface DefectParams {
  brightTh: number;
  darkTh: number;
  brightMinSize: number;
  darkMinSize: number;
  minDefectSize: number;
  brightRelPct?: number;
  darkRelPct?: number;
}

export interface DefectBlob {
  kind: 'bright' | 'dark';
  area: number;
  bbox: Rect;
  centroid: Point;
  peakDelta: number;
  meanDelta: number;
  detected: boolean;
  rule: string;
  rejectReason: string | null;
  goldenMean: number;
  thresholdMean: number;
  saturatedPixels: number;
}

export interface DefectRegionStats {
  pixels: number;
  goldenMean: number;
  goldenSaturatedHigh: number;
  goldenSaturatedLow: number;
  testSaturatedHigh: number;
  testSaturatedLow: number;
}

export interface DefectReport {
  blobs: DefectBlob[];
  detectedCount: number;
  rejectedCount: number;
  simulatedParams: string[];
  unsimulatedParams: string[];
  regionStats: DefectRegionStats;
}

export interface SensorNoise {
  readSigma: number;
  shotGain: number;
  seed: number;
}

export const NO_NOISE: SensorNoise = { readSigma: 0, shotGain: 0, seed: 1 };

export interface ProbeReport {
  pixels: number;
  maxBright: number;
  maxDark: number;
  brightPixels: number;
  darkPixels: number;
  largestBright: number;
  largestDark: number;
  requiredBright: number;
  requiredDark: number;
  wouldDetectBright: boolean;
  wouldDetectDark: boolean;
  goldenMean: number;
  goldenMin: number;
  goldenMax: number;
  brightThMin: number;
  brightThMax: number;
  darkThMin: number;
  darkThMax: number;
  goldenSaturatedHigh: number;
  testSaturatedHigh: number;
  testSaturatedLow: number;
}

export interface RandomDefectOptions {
  count: number;
  seed: number;
  width: number;
  height: number;
  kind: 'bright' | 'dark' | 'mixed';
  shape: 'spot' | 'line' | 'mixed';
  radiusMin: number;
  radiusMax: number;
  valueMin: number;
  valueMax: number;
  amplitude: DefectAmplitude;
  profile: DefectProfile;
  softness: number;
  grain: number;
  lineLengthMax: number;
  material?: Uint8Array;
  materials?: Material[];
}

export const DEFAULT_DEFECT_PARAMS: DefectParams = {
  brightTh: 30,
  darkTh: 30,
  brightMinSize: 10,
  darkMinSize: 10,
  minDefectSize: 1,
  brightRelPct: 0,
  darkRelPct: 0,
};

export function effectiveThreshold(kind: 'bright' | 'dark', goldenGv: number, params: DefectParams): number {
  if (kind === 'bright') {
    const rel = params.brightRelPct ?? 0;
    return params.brightTh + (goldenGv * rel) / 100;
  }
  const rel = params.darkRelPct ?? 0;
  return params.darkTh + (goldenGv * rel) / 100;
}

const MATERIAL_INDEX: Record<Material, number> = { base: 0, sr: 1, open: 2, metal: 3 };

function distanceToShape(
  x: number,
  y: number,
  shape: 'spot' | 'line',
  sx: number,
  sy: number,
  x2: number,
  y2: number,
): number {
  if (shape === 'spot') {
    return Math.hypot(x - sx, y - sy);
  }
  const vx = x2 - sx;
  const vy = y2 - sy;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return Math.hypot(x - sx, y - sy);
  let t = ((x - sx) * vx + (y - sy) * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = sx + t * vx;
  const py = sy + t * vy;
  return Math.hypot(x - px, y - py);
}

function shapeWeight(d: number, radius: number, softness: number): number {
  if (radius <= 0) return 0;
  const inner = radius * (1 - softness);
  if (d <= inner) return 1;
  if (d >= radius) return 0;
  return (radius - d) / (radius - inner);
}

function rectWeight(
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  softness: number,
): number {
  const depth = Math.min(x - minX, maxX - x, y - minY, maxY - y);
  if (depth < 0) return 0;
  const feather = softness * Math.max(0.5, Math.min(maxX - minX, maxY - minY) / 2);
  if (feather <= 0 || depth >= feather) return 1;
  return depth / feather;
}

function shapeBounds(
  shape: DefectShape,
  x: number,
  y: number,
  x2: number,
  y2: number,
  radius: number,
): Rect {
  if (shape === 'rect') {
    const minX = Math.min(x, x2);
    const maxX = Math.max(x, x2);
    const minY = Math.min(y, y2);
    const maxY = Math.max(y, y2);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  const minX = Math.min(x, shape === 'line' ? x2 : x) - radius;
  const maxX = Math.max(x, shape === 'line' ? x2 : x) + radius;
  const minY = Math.min(y, shape === 'line' ? y2 : y) - radius;
  const maxY = Math.max(y, shape === 'line' ? y2 : y) + radius;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function hashGrain(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967296) * 2 - 1;
}

function applyProfile(lw: number, profile: DefectProfile): number {
  if (profile === 'gaussian') {
    if (lw <= 0) return 0;
    if (lw >= 1) return 1;
    const k = 1 - lw;
    return Math.exp(-4.5 * k * k);
  }
  return lw;
}

function strokeWeight(
  stroke: DefectStroke,
  x: number,
  y: number,
  x2: number,
  y2: number,
): number {
  let lw: number;
  if (stroke.shape === 'rect') {
    const minX = Math.min(stroke.x, x2);
    const maxX = Math.max(stroke.x, x2);
    const minY = Math.min(stroke.y, y2);
    const maxY = Math.max(stroke.y, y2);
    lw = rectWeight(x, y, minX, maxX, minY, maxY, stroke.softness);
  } else {
    const d = distanceToShape(x, y, stroke.shape, stroke.x, stroke.y, x2, y2);
    lw = shapeWeight(d, stroke.radius, stroke.softness);
  }
  let w = applyProfile(lw, stroke.profile ?? 'linear');
  const grain = stroke.grain ?? 0;
  if (grain > 0 && w > 0) {
    const h = hashGrain(x, y, stroke.seed ?? 1);
    w = Math.max(0, w * (1 + grain * h));
  }
  return w;
}

function applyAmplitude(stroke: DefectStroke, v: number, w: number): number {
  const amplitude = stroke.amplitude ?? 'absolute';
  const sign = stroke.kind === 'bright' ? 1 : -1;
  if (amplitude === 'relative') {
    const pct = stroke.relativePct ?? 30;
    return v + sign * Math.max(v, 0) * (pct / 100) * w;
  }
  if (amplitude === 'target') {
    const tg = stroke.targetGv ?? (stroke.kind === 'bright' ? 255 : 0);
    const nv = v + (tg - v) * w;
    return stroke.kind === 'bright' ? Math.max(v, nv) : Math.min(v, nv);
  }
  return v + sign * stroke.deltaGv * w;
}

export function paintDefects(image: GrayImage, strokes: DefectStroke[]): GrayImage {
  const { width, height } = image;
  const touched = new Map<number, number>();
  for (const stroke of strokes) {
    const x2 = stroke.x2 ?? stroke.x;
    const y2 = stroke.y2 ?? stroke.y;
    const bounds = shapeBounds(stroke.shape, stroke.x, stroke.y, x2, y2, stroke.radius);
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(width, Math.floor(bounds.x + bounds.w) + 1);
    const y1 = Math.min(height, Math.floor(bounds.y + bounds.h) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const w = strokeWeight(stroke, x, y, x2, y2);
        if (w <= 0) continue;
        const idx = y * width + x;
        const base = touched.get(idx) ?? image.data[idx];
        touched.set(idx, applyAmplitude(stroke, base, w));
      }
    }
  }
  const out = new Uint8Array(image.data);
  for (const [idx, v] of touched) out[idx] = clampByte(v);
  return { width, height, data: out };
}

export function paintScene(scene: LightScene, strokes: SceneStroke[]): LightScene {
  const material = new Uint8Array(scene.material);
  const texture = new Float32Array(scene.texture);
  const { width, height } = scene;
  for (const stroke of strokes) {
    const x2 = stroke.x2 ?? stroke.x;
    const y2 = stroke.y2 ?? stroke.y;
    const bounds = shapeBounds(stroke.shape, stroke.x, stroke.y, x2, y2, stroke.radius);
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(width, Math.floor(bounds.x + bounds.w) + 1);
    const y1 = Math.min(height, Math.floor(bounds.y + bounds.h) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let w: number;
        if (stroke.shape === 'rect') {
          const minX = Math.min(stroke.x, x2);
          const maxX = Math.max(stroke.x, x2);
          const minY = Math.min(stroke.y, y2);
          const maxY = Math.max(stroke.y, y2);
          w = rectWeight(x, y, minX, maxX, minY, maxY, 0);
        } else {
          const d = distanceToShape(x, y, stroke.shape, stroke.x, stroke.y, x2, y2);
          w = shapeWeight(d, stroke.radius, 0);
        }
        if (w <= 0) continue;
        const idx = y * width + x;
        if (stroke.mode === 'material') {
          if (w > 0.5 && stroke.material !== undefined) {
            material[idx] = MATERIAL_INDEX[stroke.material];
          }
        } else {
          const factor = stroke.factor ?? 1;
          let t = texture[idx] * (1 + (factor - 1) * w);
          if (t < 0) t = 0;
          else if (t > 4) t = 4;
          texture[idx] = t;
        }
      }
    }
  }
  return { width, height, material, texture };
}

export function renderDefectPair(
  scene: LightScene,
  setting: LightSetting,
  channel: CameraChannel,
  sceneStrokes: SceneStroke[],
  gvStrokes: DefectStroke[],
  noise?: SensorNoise,
): { golden: GrayImage; test: GrayImage } {
  const golden = renderChannel(scene, setting, channel);
  const painted = sceneStrokes.length > 0 ? paintScene(scene, sceneStrokes) : scene;
  const test = renderChannel(painted, setting, channel);
  const transfer = channelTransfer(setting, channel);
  const n = painted.material.length;
  const touched = new Map<number, number>();
  for (const stroke of gvStrokes) {
    const x2 = stroke.x2 ?? stroke.x;
    const y2 = stroke.y2 ?? stroke.y;
    const bounds = shapeBounds(stroke.shape, stroke.x, stroke.y, x2, y2, stroke.radius);
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(painted.width, Math.floor(bounds.x + bounds.w) + 1);
    const y1 = Math.min(painted.height, Math.floor(bounds.y + bounds.h) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const w = strokeWeight(stroke, x, y, x2, y2);
        if (w <= 0) continue;
        const idx = y * painted.width + x;
        const base = touched.get(idx) ?? linearValue(painted, transfer, idx);
        touched.set(idx, applyAmplitude(stroke, base, w));
      }
    }
  }
  const active = noise !== undefined && (noise.readSigma > 0 || noise.shotGain > 0);
  if (active) {
    const rng = createRng(noise.seed);
    const readSigma = noise.readSigma;
    const shotGain = noise.shotGain;
    for (let idx = 0; idx < n; idx++) {
      const v = touched.get(idx) ?? linearValue(painted, transfer, idx);
      const sigma = Math.sqrt(readSigma * readSigma + shotGain * Math.max(v, 0));
      test.data[idx] = clampByte(v + sigma * rng.nextGaussian());
    }
  } else {
    for (const [idx, v] of touched) test.data[idx] = clampByte(v);
  }
  return { golden, test };
}

const PARAM_KEY_MAP: Record<string, keyof DefectParams> = {
  '1000': 'brightTh',
  '1002': 'brightMinSize',
  '1009': 'darkTh',
  '1011': 'darkMinSize',
  '1024': 'minDefectSize',
};

export function defectParamsFromInspection(values: Record<string, number>): {
  params: DefectParams;
  missing: string[];
} {
  const params: DefectParams = { ...DEFAULT_DEFECT_PARAMS };
  const missing: string[] = [];
  for (const key of Object.keys(PARAM_KEY_MAP)) {
    const value = values[key];
    if (value === undefined) {
      missing.push(key);
    } else {
      params[PARAM_KEY_MAP[key]] = value;
    }
  }
  return { params, missing };
}

const SIMULATED_PARAMS = [
  'Bright Defect(TH)',
  'Bright Defect Size(Pixel)',
  'Dark Defect(TH)',
  'Dark Defect Size(Pixel)',
  'Min Defect Size(Pixel)',
  'Bright Relative TH (% of Golden) [teaching]',
  'Dark Relative TH (% of Golden) [teaching]',
];

const UNSIMULATED_PARAMS = [
  'Bright Defect Margine(TH)',
  'Bright Defect Offest1(%)',
  'Bright Defect Offest2(TH)',
  'Bright Defect Pad Offest(TH)',
  'Dark Defect Margine(TH)',
  'Dark Defect Offset1(%)',
  'Dark Defect Offset2(TH)',
  'Dark Defect Pad Offset(TH)',
  'Block Bright Defect Offset(TH)',
  'Block Dark Offset(TH)',
];

interface BlobAccumulator {
  kind: 'bright' | 'dark';
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
  peak: number;
  sumDelta: number;
  sumGolden: number;
  sumThreshold: number;
  saturated: number;
}

function collectBlobs(
  diff: Int16Array,
  golden: Uint8Array,
  test: Uint8Array,
  width: number,
  height: number,
  region: Uint8Array | undefined,
  kind: 'bright' | 'dark',
  params: DefectParams,
): BlobAccumulator[] {
  const visited = new Uint8Array(width * height);
  const blobs: BlobAccumulator[] = [];
  const stack: number[] = [];
  const isCandidate = (idx: number): boolean => {
    if (region !== undefined && region[idx] === 0) return false;
    const d = diff[idx];
    const th = effectiveThreshold(kind, golden[idx], params);
    return kind === 'bright' ? d >= th : -d >= th;
  };
  for (let start = 0; start < width * height; start++) {
    if (visited[start] || !isCandidate(start)) continue;
    const blob: BlobAccumulator = {
      kind,
      area: 0,
      minX: width,
      minY: height,
      maxX: -1,
      maxY: -1,
      sumX: 0,
      sumY: 0,
      peak: 0,
      sumDelta: 0,
      sumGolden: 0,
      sumThreshold: 0,
      saturated: 0,
    };
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = (idx - x) / width;
      const delta = Math.abs(diff[idx]);
      blob.area++;
      blob.sumX += x;
      blob.sumY += y;
      blob.sumDelta += delta;
      blob.sumGolden += golden[idx];
      blob.sumThreshold += effectiveThreshold(kind, golden[idx], params);
      if (kind === 'bright' ? test[idx] === 255 : test[idx] === 0) blob.saturated++;
      if (delta > blob.peak) blob.peak = delta;
      if (x < blob.minX) blob.minX = x;
      if (y < blob.minY) blob.minY = y;
      if (x > blob.maxX) blob.maxX = x;
      if (y > blob.maxY) blob.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !isCandidate(nIdx)) continue;
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }
    blobs.push(blob);
  }
  return blobs;
}

export function detectDefects(
  golden: GrayImage,
  test: GrayImage,
  params: DefectParams,
  region?: Uint8Array,
): DefectReport {
  if (golden.width !== test.width || golden.height !== test.height) {
    throw new Error('detectDefects: image sizes must match');
  }
  const width = golden.width;
  const height = golden.height;
  const n = width * height;
  if (region !== undefined && region.length !== n) {
    throw new Error('detectDefects: region size mismatch');
  }
  const diff = new Int16Array(n);
  for (let i = 0; i < n; i++) diff[i] = test.data[i] - golden.data[i];

  const brightBlobs = collectBlobs(diff, golden.data, test.data, width, height, region, 'bright', params);
  const darkBlobs = collectBlobs(diff, golden.data, test.data, width, height, region, 'dark', params);

  const blobs: DefectBlob[] = [];
  const build = (acc: BlobAccumulator): DefectBlob => {
    const minSize = acc.kind === 'bright' ? params.brightMinSize : params.darkMinSize;
    const required = Math.max(minSize, params.minDefectSize);
    const detected = acc.area >= required;
    const relPct = acc.kind === 'bright' ? params.brightRelPct ?? 0 : params.darkRelPct ?? 0;
    const baseTh = acc.kind === 'bright' ? params.brightTh : params.darkTh;
    const rule =
      relPct > 0
        ? acc.kind === 'bright'
          ? `Bright Defect(TH)=${baseTh} + ${relPct}%×Golden, Bright Defect Size(Pixel)>=${required}`
          : `Dark Defect(TH)=${baseTh} + ${relPct}%×Golden, Dark Defect Size(Pixel)>=${required}`
        : acc.kind === 'bright'
          ? `Bright Defect(TH)=${baseTh}, Bright Defect Size(Pixel)>=${required}`
          : `Dark Defect(TH)=${baseTh}, Dark Defect Size(Pixel)>=${required}`;
    return {
      kind: acc.kind,
      area: acc.area,
      bbox: { x: acc.minX, y: acc.minY, w: acc.maxX - acc.minX + 1, h: acc.maxY - acc.minY + 1 },
      centroid: [acc.sumX / acc.area, acc.sumY / acc.area],
      peakDelta: acc.peak,
      meanDelta: acc.sumDelta / acc.area,
      detected,
      rule,
      rejectReason: detected ? null : 'below-size',
      goldenMean: acc.sumGolden / acc.area,
      thresholdMean: acc.sumThreshold / acc.area,
      saturatedPixels: acc.saturated,
    };
  };
  for (const acc of brightBlobs) blobs.push(build(acc));
  for (const acc of darkBlobs) blobs.push(build(acc));
  blobs.sort((a, b) => b.area - a.area);

  let detectedCount = 0;
  let rejectedCount = 0;
  for (const blob of blobs) {
    if (blob.detected) detectedCount++;
    else rejectedCount++;
  }

  const regionStats: DefectRegionStats = {
    pixels: 0,
    goldenMean: 0,
    goldenSaturatedHigh: 0,
    goldenSaturatedLow: 0,
    testSaturatedHigh: 0,
    testSaturatedLow: 0,
  };
  let goldenSum = 0;
  for (let i = 0; i < n; i++) {
    if (region !== undefined && region[i] === 0) continue;
    regionStats.pixels++;
    goldenSum += golden.data[i];
    if (golden.data[i] === 255) regionStats.goldenSaturatedHigh++;
    if (golden.data[i] === 0) regionStats.goldenSaturatedLow++;
    if (test.data[i] === 255) regionStats.testSaturatedHigh++;
    if (test.data[i] === 0) regionStats.testSaturatedLow++;
  }
  regionStats.goldenMean = regionStats.pixels > 0 ? goldenSum / regionStats.pixels : 0;

  return {
    blobs,
    detectedCount,
    rejectedCount,
    simulatedParams: [...SIMULATED_PARAMS],
    unsimulatedParams: [...UNSIMULATED_PARAMS],
    regionStats,
  };
}

function largestComponent(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  let largest = 0;
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const start = sy * width + sx;
      if (visited[start] || mask[start] === 0) continue;
      let area = 0;
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;
      while (stack.length > 0) {
        const idx = stack.pop() as number;
        const x = idx % width;
        const y = (idx - x) / width;
        area++;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < y0 || ny >= y1) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < x0 || nx >= x1) continue;
            const nIdx = ny * width + nx;
            if (visited[nIdx] || mask[nIdx] === 0) continue;
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
      if (area > largest) largest = area;
    }
  }
  return largest;
}

export function probeArea(
  golden: GrayImage,
  test: GrayImage,
  rect: Rect,
  params: DefectParams,
  region?: Uint8Array,
): ProbeReport {
  if (golden.width !== test.width || golden.height !== test.height) {
    throw new Error('probeArea: image sizes must match');
  }
  const width = golden.width;
  const height = golden.height;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  const requiredBright = Math.max(params.brightMinSize, params.minDefectSize);
  const requiredDark = Math.max(params.darkMinSize, params.minDefectSize);
  const report: ProbeReport = {
    pixels: 0,
    maxBright: 0,
    maxDark: 0,
    brightPixels: 0,
    darkPixels: 0,
    largestBright: 0,
    largestDark: 0,
    requiredBright,
    requiredDark,
    wouldDetectBright: false,
    wouldDetectDark: false,
    goldenMean: 0,
    goldenMin: 0,
    goldenMax: 0,
    brightThMin: 0,
    brightThMax: 0,
    darkThMin: 0,
    darkThMax: 0,
    goldenSaturatedHigh: 0,
    testSaturatedHigh: 0,
    testSaturatedLow: 0,
  };
  if (x1 <= x0 || y1 <= y0) return report;
  const brightMask = new Uint8Array(width * height);
  const darkMask = new Uint8Array(width * height);
  let goldenSum = 0;
  let goldenMin = 255;
  let goldenMax = 0;
  let brightThMin = Infinity;
  let brightThMax = -Infinity;
  let darkThMin = Infinity;
  let darkThMax = -Infinity;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const idx = row + x;
      if (region !== undefined && region[idx] === 0) continue;
      const g = golden.data[idx];
      const t = test.data[idx];
      const d = t - g;
      report.pixels++;
      goldenSum += g;
      if (g < goldenMin) goldenMin = g;
      if (g > goldenMax) goldenMax = g;
      if (g === 255) report.goldenSaturatedHigh++;
      if (t === 255) report.testSaturatedHigh++;
      if (t === 0) report.testSaturatedLow++;
      const bTh = effectiveThreshold('bright', g, params);
      const dTh = effectiveThreshold('dark', g, params);
      if (bTh < brightThMin) brightThMin = bTh;
      if (bTh > brightThMax) brightThMax = bTh;
      if (dTh < darkThMin) darkThMin = dTh;
      if (dTh > darkThMax) darkThMax = dTh;
      if (d > report.maxBright) report.maxBright = d;
      if (-d > report.maxDark) report.maxDark = -d;
      if (d >= bTh) {
        report.brightPixels++;
        brightMask[idx] = 1;
      }
      if (-d >= dTh) {
        report.darkPixels++;
        darkMask[idx] = 1;
      }
    }
  }
  if (report.pixels === 0) return report;
  report.goldenMean = goldenSum / report.pixels;
  report.goldenMin = goldenMin;
  report.goldenMax = goldenMax;
  report.brightThMin = brightThMin;
  report.brightThMax = brightThMax;
  report.darkThMin = darkThMin;
  report.darkThMax = darkThMax;
  report.largestBright = largestComponent(brightMask, width, height, x0, y0, x1, y1);
  report.largestDark = largestComponent(darkMask, width, height, x0, y0, x1, y1);
  report.wouldDetectBright = report.largestBright >= requiredBright;
  report.wouldDetectDark = report.largestDark >= requiredDark;
  return report;
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

export function generateRandomDefects(options: RandomDefectOptions): DefectStroke[] {
  const rng = createRng(options.seed);
  const out: DefectStroke[] = [];
  const wanted = new Set<number>();
  if (options.materials !== undefined) {
    for (const m of options.materials) wanted.add(MATERIAL_INDEX[m]);
  }
  const maxAttempts = options.count * 50;
  let attempts = 0;
  while (out.length < options.count && attempts < maxAttempts) {
    attempts++;
    const radius = options.radiusMin + rng.next() * (options.radiusMax - options.radiusMin);
    const lo = Math.ceil(radius);
    const hiX = options.width - 1 - Math.ceil(radius);
    const hiY = options.height - 1 - Math.ceil(radius);
    if (hiX < lo || hiY < lo) break;
    const cx = lo + rng.next() * (hiX - lo);
    const cy = lo + rng.next() * (hiY - lo);
    if (wanted.size > 0 && options.material !== undefined) {
      const ix = Math.min(options.width - 1, Math.max(0, Math.round(cx)));
      const iy = Math.min(options.height - 1, Math.max(0, Math.round(cy)));
      if (!wanted.has(options.material[iy * options.width + ix])) continue;
    }
    const kind: 'bright' | 'dark' =
      options.kind === 'mixed' ? (rng.next() < 0.5 ? 'bright' : 'dark') : options.kind;
    const shape: 'spot' | 'line' =
      options.shape === 'mixed' ? (rng.next() < 0.5 ? 'spot' : 'line') : options.shape;
    const value = options.valueMin + rng.next() * (options.valueMax - options.valueMin);
    const stroke: DefectStroke = {
      kind,
      shape,
      x: cx,
      y: cy,
      radius,
      deltaGv: 0,
      softness: options.softness,
      amplitude: options.amplitude,
      profile: options.profile,
      grain: options.grain,
      seed: options.seed * 1000 + out.length,
    };
    if (shape === 'line') {
      const minLen = 2 * radius;
      const maxLen = Math.max(minLen, options.lineLengthMax);
      const len = minLen + rng.next() * (maxLen - minLen);
      const angle = rng.next() * Math.PI * 2;
      stroke.x2 = cx + Math.cos(angle) * len;
      stroke.y2 = cy + Math.sin(angle) * len;
    }
    if (options.amplitude === 'absolute') {
      stroke.deltaGv = value;
    } else if (options.amplitude === 'relative') {
      stroke.relativePct = value;
    } else {
      stroke.targetGv = Math.min(255, Math.max(0, value));
    }
    out.push(stroke);
  }
  return out;
}
