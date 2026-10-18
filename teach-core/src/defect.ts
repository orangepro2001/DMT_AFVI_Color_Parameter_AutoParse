import type { GrayImage, Point, Rect } from './gray.ts';
import { clampByte } from './gray.ts';
import type { LightScene, Material } from './light.ts';

export interface DefectStroke {
  kind: 'bright' | 'dark';
  shape: 'spot' | 'line';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  radius: number;
  deltaGv: number;
  softness: number;
}

export interface SceneStroke {
  mode: 'material' | 'texture';
  shape: 'spot' | 'line';
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
}

export interface DefectReport {
  blobs: DefectBlob[];
  detectedCount: number;
  rejectedCount: number;
  simulatedParams: string[];
  unsimulatedParams: string[];
}

export const DEFAULT_DEFECT_PARAMS: DefectParams = {
  brightTh: 30,
  darkTh: 30,
  brightMinSize: 10,
  darkMinSize: 10,
  minDefectSize: 1,
};

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

function shapeBounds(
  shape: 'spot' | 'line',
  x: number,
  y: number,
  x2: number,
  y2: number,
  radius: number,
): Rect {
  const minX = Math.min(x, shape === 'line' ? x2 : x) - radius;
  const maxX = Math.max(x, shape === 'line' ? x2 : x) + radius;
  const minY = Math.min(y, shape === 'line' ? y2 : y) - radius;
  const maxY = Math.max(y, shape === 'line' ? y2 : y) + radius;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function paintDefects(image: GrayImage, strokes: DefectStroke[]): GrayImage {
  const out = new Uint8Array(image.data);
  const { width, height } = image;
  for (const stroke of strokes) {
    const x2 = stroke.x2 ?? stroke.x;
    const y2 = stroke.y2 ?? stroke.y;
    const bounds = shapeBounds(stroke.shape, stroke.x, stroke.y, x2, y2, stroke.radius);
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(width, Math.floor(bounds.x + bounds.w) + 1);
    const y1 = Math.min(height, Math.floor(bounds.y + bounds.h) + 1);
    const sign = stroke.kind === 'bright' ? 1 : -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = distanceToShape(x, y, stroke.shape, stroke.x, stroke.y, x2, y2);
        const w = shapeWeight(d, stroke.radius, stroke.softness);
        if (w <= 0) continue;
        const idx = y * width + x;
        out[idx] = clampByte(out[idx] + sign * stroke.deltaGv * w);
      }
    }
  }
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
        const d = distanceToShape(x, y, stroke.shape, stroke.x, stroke.y, x2, y2);
        const w = shapeWeight(d, stroke.radius, 0);
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
}

function collectBlobs(
  diff: Int16Array,
  width: number,
  height: number,
  region: Uint8Array | undefined,
  kind: 'bright' | 'dark',
  threshold: number,
): BlobAccumulator[] {
  const visited = new Uint8Array(width * height);
  const blobs: BlobAccumulator[] = [];
  const stack: number[] = [];
  const isCandidate = (idx: number): boolean => {
    if (region !== undefined && region[idx] === 0) return false;
    const d = diff[idx];
    return kind === 'bright' ? d >= threshold : -d >= threshold;
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

  const brightBlobs = collectBlobs(diff, width, height, region, 'bright', params.brightTh);
  const darkBlobs = collectBlobs(diff, width, height, region, 'dark', params.darkTh);

  const blobs: DefectBlob[] = [];
  const build = (acc: BlobAccumulator): DefectBlob => {
    const minSize = acc.kind === 'bright' ? params.brightMinSize : params.darkMinSize;
    const required = Math.max(minSize, params.minDefectSize);
    const detected = acc.area >= required;
    const rule =
      acc.kind === 'bright'
        ? `Bright Defect(TH)=${params.brightTh}, Bright Defect Size(Pixel)>=${required}`
        : `Dark Defect(TH)=${params.darkTh}, Dark Defect Size(Pixel)>=${required}`;
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

  return {
    blobs,
    detectedCount,
    rejectedCount,
    simulatedParams: [...SIMULATED_PARAMS],
    unsimulatedParams: [...UNSIMULATED_PARAMS],
  };
}

export function probeArea(
  golden: GrayImage,
  test: GrayImage,
  rect: Rect,
  params: DefectParams,
): {
  maxBright: number;
  maxDark: number;
  brightPixels: number;
  darkPixels: number;
  wouldDetectBright: boolean;
  wouldDetectDark: boolean;
} {
  if (golden.width !== test.width || golden.height !== test.height) {
    throw new Error('probeArea: image sizes must match');
  }
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(golden.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(golden.height, Math.ceil(rect.y + rect.h));
  let maxBright = 0;
  let maxDark = 0;
  let brightPixels = 0;
  let darkPixels = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * golden.width;
    for (let x = x0; x < x1; x++) {
      const d = test.data[row + x] - golden.data[row + x];
      if (d > maxBright) maxBright = d;
      if (-d > maxDark) maxDark = -d;
      if (d >= params.brightTh) brightPixels++;
      if (-d >= params.darkTh) darkPixels++;
    }
  }
  return {
    maxBright,
    maxDark,
    brightPixels,
    darkPixels,
    wouldDetectBright: brightPixels >= Math.max(params.brightMinSize, params.minDefectSize),
    wouldDetectDark: darkPixels >= Math.max(params.darkMinSize, params.minDefectSize),
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
