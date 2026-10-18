import type { GrayImage, Point, Rect } from './gray.ts';
import { downsampleArea } from './gray.ts';
import type { Similarity } from './warp.ts';
import { applySimilarity, warpPoint } from './warp.ts';
import type { WarpParams } from './warp.ts';
import { createRng } from './rng.ts';

export interface AlignRoi extends Rect {
  name: string;
}

export interface AlignConfig {
  searchRadius: number;
  pyramidFactor: number;
  minNcc: number;
  minUniqueness: number;
  ransacThresholdPx: number;
  ransacIterations: number;
  okResidualPx: number;
  ngResidualPx: number;
  seed: number;
}

export const DEFAULT_ALIGN_CONFIG: AlignConfig = {
  searchRadius: 120,
  pyramidFactor: 4,
  minNcc: 0.6,
  minUniqueness: 0.15,
  ransacThresholdPx: 3,
  ransacIterations: 200,
  okResidualPx: 1.5,
  ngResidualPx: 5,
  seed: 1,
};

export interface NccSurface {
  width: number;
  height: number;
  originX: number;
  originY: number;
  step: number;
  values: Float32Array;
}

export interface RoiMatch {
  name: string;
  template: Point;
  expected: Point;
  found: Point | null;
  ncc: number;
  secondNcc: number;
  uniqueness: number;
  located: boolean;
  reason: string | null;
  surface: NccSurface | null;
}

export interface AlignVerdictReason {
  code: string;
  message: string;
}

export interface AlignReport {
  matches: RoiMatch[];
  fit: Similarity | null;
  inliers: number[];
  residuals: number[];
  residualRms: number;
  meanNcc: number;
  verdict: { level: 'ok' | 'manual' | 'ng'; reasons: AlignVerdictReason[] };
}

export function ncc(a: Float32Array | number[], b: Float32Array | number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA <= 0 || varB <= 0) return 0;
  return num / Math.sqrt(varA * varB);
}

function patchStd(img: GrayImage, roi: Rect): number {
  const x0 = Math.max(0, Math.floor(roi.x));
  const y0 = Math.max(0, Math.floor(roi.y));
  const x1 = Math.min(img.width, Math.ceil(roi.x + roi.w));
  const y1 = Math.min(img.height, Math.ceil(roi.y + roi.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return 0;
  let sum = 0;
  let sumSq = 0;
  const count = w * h;
  for (let y = y0; y < y1; y++) {
    const row = y * img.width;
    for (let x = x0; x < x1; x++) {
      const v = img.data[row + x];
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
}

function extractPatch(img: GrayImage, x0: number, y0: number, w: number, h: number): Float32Array | null {
  if (x0 < 0 || y0 < 0 || x0 + w > img.width || y0 + h > img.height) return null;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * img.width + x0;
    for (let x = 0; x < w; x++) out[y * w + x] = img.data[row + x];
  }
  return out;
}

function nccAt(img: GrayImage, patch: Float32Array, pw: number, ph: number, x0: number, y0: number): number {
  const sub = extractPatch(img, x0, y0, pw, ph);
  if (sub === null) return -2;
  return ncc(patch, sub);
}

export function matchRoi(
  template: GrayImage,
  input: GrayImage,
  roi: AlignRoi,
  prior: Similarity,
  config: AlignConfig,
): RoiMatch {
  const center: Point = [roi.x + roi.w / 2, roi.y + roi.h / 2];
  const expected = applySimilarity(prior, center);
  const base: RoiMatch = {
    name: roi.name,
    template: center,
    expected,
    found: null,
    ncc: 0,
    secondNcc: 0,
    uniqueness: 0,
    located: false,
    reason: null,
    surface: null,
  };

  const pw = Math.max(1, Math.round(roi.w));
  const ph = Math.max(1, Math.round(roi.h));
  const px0 = Math.max(0, Math.floor(roi.x));
  const py0 = Math.max(0, Math.floor(roi.y));
  const patch = extractPatch(template, px0, py0, pw, ph);
  if (patch === null) {
    return { ...base, reason: 'out-of-range' };
  }
  if (patchStd(template, roi) < 2) {
    return { ...base, reason: 'flat' };
  }

  const f = Math.max(1, Math.floor(config.pyramidFactor));
  const tplSmall = downsampleArea(template, f);
  const inSmall = downsampleArea(input, f);
  const pwS = Math.max(1, Math.floor(pw / f));
  const phS = Math.max(1, Math.floor(ph / f));
  const patchSmall = extractPatch(tplSmall, Math.floor(px0 / f), Math.floor(py0 / f), pwS, phS);
  if (patchSmall === null) {
    return { ...base, reason: 'out-of-range' };
  }

  const radiusS = Math.ceil(config.searchRadius / f);
  const cxS = Math.round((expected[0] - pw / 2) / f);
  const cyS = Math.round((expected[1] - ph / 2) / f);
  const originX = cxS - radiusS;
  const originY = cyS - radiusS;
  const sizeS = radiusS * 2 + 1;
  const values = new Float32Array(sizeS * sizeS).fill(-2);
  let peak = -2;
  let peakX = 0;
  let peakY = 0;
  let anyValid = false;
  for (let dy = 0; dy < sizeS; dy++) {
    for (let dx = 0; dx < sizeS; dx++) {
      const x0 = originX + dx;
      const y0 = originY + dy;
      const score = nccAt(inSmall, patchSmall, pwS, phS, x0, y0);
      values[dy * sizeS + dx] = score;
      if (score > -2) anyValid = true;
      if (score > peak) {
        peak = score;
        peakX = dx;
        peakY = dy;
      }
    }
  }
  if (!anyValid) {
    return { ...base, reason: 'out-of-range' };
  }

  const surface: NccSurface = {
    width: sizeS,
    height: sizeS,
    originX: originX * f,
    originY: originY * f,
    step: f,
    values,
  };

  const minSep = Math.max(2, Math.floor(Math.min(roi.w, roi.h) / (2 * f)));
  let second = -2;
  for (let dy = 0; dy < sizeS; dy++) {
    for (let dx = 0; dx < sizeS; dx++) {
      if (Math.max(Math.abs(dx - peakX), Math.abs(dy - peakY)) <= minSep) continue;
      const score = values[dy * sizeS + dx];
      if (score > second) second = score;
    }
  }
  if (second < -1) second = 0;

  const fineX = originX * f + peakX * f;
  const fineY = originY * f + peakY * f;
  const range = f + 1;
  let bestScore = -2;
  let bestX = fineX;
  let bestY = fineY;
  const scoreGrid = new Map<string, number>();
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x0 = fineX + dx;
      const y0 = fineY + dy;
      const score = nccAt(input, patch, pw, ph, x0, y0);
      scoreGrid.set(`${dx},${dy}`, score);
      if (score > bestScore) {
        bestScore = score;
        bestX = x0;
        bestY = y0;
      }
    }
  }

  const getScore = (dx: number, dy: number): number => scoreGrid.get(`${dx},${dy}`) ?? -2;
  const bestDx = bestX - fineX;
  const bestDy = bestY - fineY;
  let subX = bestX;
  let subY = bestY;
  const s0x = getScore(bestDx - 1, bestDy);
  const s1x = getScore(bestDx, bestDy);
  const s2x = getScore(bestDx + 1, bestDy);
  if (s0x > -2 && s1x > -2 && s2x > -2) {
    const denom = s0x - 2 * s1x + s2x;
    if (denom !== 0) {
      const delta = (0.5 * (s0x - s2x)) / denom;
      if (delta > -1 && delta < 1) subX = bestX + delta;
    }
  }
  const s0y = getScore(bestDx, bestDy - 1);
  const s1y = getScore(bestDx, bestDy);
  const s2y = getScore(bestDx, bestDy + 1);
  if (s0y > -2 && s1y > -2 && s2y > -2) {
    const denom = s0y - 2 * s1y + s2y;
    if (denom !== 0) {
      const delta = (0.5 * (s0y - s2y)) / denom;
      if (delta > -1 && delta < 1) subY = bestY + delta;
    }
  }

  const found: Point = [subX + pw / 2, subY + ph / 2];
  const uniqueness = bestScore - second;
  const located = bestScore >= config.minNcc;
  return {
    name: roi.name,
    template: center,
    expected,
    found,
    ncc: bestScore,
    secondNcc: second,
    uniqueness,
    located,
    reason: located ? null : 'low-ncc',
    surface,
  };
}

export function fitSimilarity(src: Point[], dst: Point[]): Similarity | null {
  const n = Math.min(src.length, dst.length);
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  let dx0 = 0;
  let dy0 = 0;
  for (let i = 0; i < n; i++) {
    mx += src[i][0];
    my += src[i][1];
    dx0 += dst[i][0];
    dy0 += dst[i][1];
  }
  mx /= n;
  my /= n;
  dx0 /= n;
  dy0 /= n;
  let numRe = 0;
  let numIm = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - mx;
    const sy = src[i][1] - my;
    const tx = dst[i][0] - dx0;
    const ty = dst[i][1] - dy0;
    // a = sum(dst' * conj(src')) / sum|src'|^2
    // dst' * conj(src') = (tx + i ty)(sx - i sy) = (tx*sx + ty*sy) + i(ty*sx - tx*sy)
    numRe += tx * sx + ty * sy;
    numIm += ty * sx - tx * sy;
    den += sx * sx + sy * sy;
  }
  if (den === 0) return null;
  const aRe = numRe / den;
  const aIm = numIm / den;
  const scale = Math.hypot(aRe, aIm);
  const thetaDeg = (Math.atan2(aIm, aRe) * 180) / Math.PI;
  const tx = dx0 - (aRe * mx - aIm * my);
  const ty = dy0 - (aIm * mx + aRe * my);
  return { tx, ty, thetaDeg, scale };
}

function residual(s: Similarity, p: Point, q: Point): number {
  const f = applySimilarity(s, p);
  return Math.hypot(f[0] - q[0], f[1] - q[1]);
}

export function ransacSimilarity(
  src: Point[],
  dst: Point[],
  thresholdPx: number,
  iterations: number,
  seed: number,
): { fit: Similarity | null; inliers: number[] } {
  const n = Math.min(src.length, dst.length);
  if (n < 2) return { fit: null, inliers: [] };
  let bestFit: Similarity | null = null;
  let bestInliers: number[] = [];
  let bestResidualSum = Infinity;

  const evaluate = (fit: Similarity | null): void => {
    if (fit === null) return;
    const inliers: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const r = residual(fit, src[i], dst[i]);
      if (r < thresholdPx) {
        inliers.push(i);
        sum += r;
      }
    }
    if (inliers.length > bestInliers.length || (inliers.length === bestInliers.length && sum < bestResidualSum)) {
      bestFit = fit;
      bestInliers = inliers;
      bestResidualSum = sum;
    }
  };

  if (n <= 12) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        evaluate(fitSimilarity([src[i], src[j]], [dst[i], dst[j]]));
      }
    }
  } else {
    const rng = createRng(seed);
    for (let it = 0; it < iterations; it++) {
      const i = rng.nextInt(n);
      let j = rng.nextInt(n);
      if (j === i) j = (j + 1) % n;
      evaluate(fitSimilarity([src[i], src[j]], [dst[i], dst[j]]));
    }
  }

  if (bestFit === null || bestInliers.length < 2) {
    return { fit: bestFit, inliers: bestInliers };
  }
  const refined = fitSimilarity(
    bestInliers.map((i) => src[i]),
    bestInliers.map((i) => dst[i]),
  );
  if (refined !== null) bestFit = refined;
  return { fit: bestFit, inliers: bestInliers };
}

export function alignWithRois(
  template: GrayImage,
  input: GrayImage,
  rois: AlignRoi[],
  config: AlignConfig = DEFAULT_ALIGN_CONFIG,
  prior: Similarity = { tx: 0, ty: 0, thetaDeg: 0, scale: 1 },
): AlignReport {
  const matches = rois.map((roi) => matchRoi(template, input, roi, prior, config));
  const locatedIdx: number[] = [];
  const src: Point[] = [];
  const dst: Point[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.located && m.found !== null) {
      locatedIdx.push(i);
      src.push(m.template);
      dst.push(m.found);
    }
  }

  let fit: Similarity | null = null;
  let inliers: number[] = [];
  if (src.length >= 2) {
    const r = ransacSimilarity(src, dst, config.ransacThresholdPx, config.ransacIterations, config.seed);
    fit = r.fit;
    inliers = r.inliers;
  }

  const residuals: number[] = matches.map(() => -1);
  let residualRms = 0;
  if (fit !== null) {
    let sumSq = 0;
    for (const idx of inliers) {
      const m = matches[locatedIdx[idx]];
      const r = residual(fit, m.template, m.found as Point);
      residuals[locatedIdx[idx]] = r;
      sumSq += r * r;
    }
    residualRms = inliers.length > 0 ? Math.sqrt(sumSq / inliers.length) : 0;
  }

  let nccSum = 0;
  let nccCount = 0;
  for (const m of matches) {
    if (m.located) {
      nccSum += m.ncc;
      nccCount++;
    }
  }
  const meanNcc = nccCount > 0 ? nccSum / nccCount : 0;

  const reasons: AlignVerdictReason[] = [];
  let level: 'ok' | 'manual' | 'ng' = 'ok';

  const locatedCount = locatedIdx.length;
  if (locatedCount < 2) {
    level = 'ng';
    reasons.push({ code: 'too-few-located', message: `定位成功的 ROI 只有 ${locatedCount} 个，至少需要 2 个` });
  }
  if (fit === null) {
    level = 'ng';
    reasons.push({ code: 'no-fit', message: '无法拟合相似变换' });
  }
  if (fit !== null && residualRms > config.ngResidualPx) {
    level = 'ng';
    reasons.push({ code: 'residual-high', message: `内点残差 RMS ${residualRms.toFixed(3)}px 超过 NG 阈值 ${config.ngResidualPx}px` });
  }

  if (level !== 'ng') {
    const inlierSet = new Set(inliers);
    let hasOutlier = false;
    let hasAmbiguous = false;
    let hasMissing = false;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (!m.located) {
        hasMissing = true;
        continue;
      }
      const localIdx = locatedIdx.indexOf(i);
      if (localIdx >= 0 && !inlierSet.has(localIdx)) hasOutlier = true;
      if (m.uniqueness < config.minUniqueness) hasAmbiguous = true;
    }
    if (hasOutlier) {
      level = 'manual';
      reasons.push({ code: 'outlier', message: '存在定位成功但被判定为外点的 ROI' });
    }
    if (hasAmbiguous) {
      level = 'manual';
      reasons.push({ code: 'ambiguous', message: '存在唯一性不足的 ROI，可能是重复纹理' });
    }
    if (fit !== null && residualRms > config.okResidualPx) {
      level = 'manual';
      reasons.push({ code: 'residual-warn', message: `内点残差 RMS ${residualRms.toFixed(3)}px 超过 OK 阈值 ${config.okResidualPx}px` });
    }
    if (hasMissing) {
      level = 'manual';
      reasons.push({ code: 'roi-missing', message: '存在未定位的 ROI' });
    }
  }

  return { matches, fit, inliers, residuals, residualRms, meanNcc, verdict: { level, reasons } };
}

export function compareToTruth(
  fit: Similarity | null,
  params: WarpParams,
  rois: AlignRoi[],
  width: number,
  height: number,
): { perRoiErrorPx: number[]; meanErrorPx: number; maxErrorPx: number } {
  const perRoiErrorPx: number[] = [];
  if (fit === null) {
    for (let i = 0; i < rois.length; i++) perRoiErrorPx.push(NaN);
    return { perRoiErrorPx, meanErrorPx: NaN, maxErrorPx: NaN };
  }
  let sum = 0;
  let max = 0;
  for (const roi of rois) {
    const center: Point = [roi.x + roi.w / 2, roi.y + roi.h / 2];
    const predicted = applySimilarity(fit, center);
    const truth = warpPoint(params, center, width, height);
    const err = Math.hypot(predicted[0] - truth[0], predicted[1] - truth[1]);
    perRoiErrorPx.push(err);
    sum += err;
    if (err > max) max = err;
  }
  return { perRoiErrorPx, meanErrorPx: sum / rois.length, maxErrorPx: max };
}
