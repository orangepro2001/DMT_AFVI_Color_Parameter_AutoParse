import type { GrayImage, Point, Rect } from './gray.ts';
import { clampByte, gaussianBlur, sampleBilinear } from './gray.ts';
import { createRng } from './rng.ts';

export interface WarpParams {
  tx: number;
  ty: number;
  thetaDeg: number;
  scale: number;
  shearX: number;
  shearY: number;
  bendAmplitude: number;
  bendWavelength: number;
  blurSigma: number;
  noiseSigma: number;
  gain: number;
  offset: number;
  gradient: number;
  occlusions: Array<Rect & { value: number }>;
}

export const IDENTITY_WARP: WarpParams = {
  tx: 0,
  ty: 0,
  thetaDeg: 0,
  scale: 1,
  shearX: 0,
  shearY: 0,
  bendAmplitude: 0,
  bendWavelength: 0,
  blurSigma: 0,
  noiseSigma: 0,
  gain: 1,
  offset: 0,
  gradient: 0,
  occlusions: [],
};

export interface Similarity {
  tx: number;
  ty: number;
  thetaDeg: number;
  scale: number;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function warpPoint(params: WarpParams, p: Point, width: number, height: number): Point {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let dx = p[0] - cx;
  let dy = p[1] - cy;
  const sx = dx + params.shearX * dy;
  const sy = dy + params.shearY * dx;
  dx = sx;
  dy = sy;
  const theta = degToRad(params.thetaDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rx = params.scale * (cos * dx - sin * dy);
  const ry = params.scale * (sin * dx + cos * dy);
  let qx = cx + rx + params.tx;
  let qy = cy + ry + params.ty;
  if (params.bendAmplitude !== 0 && params.bendWavelength > 0) {
    qy += params.bendAmplitude * Math.sin((2 * Math.PI * qx) / params.bendWavelength);
  }
  return [qx, qy];
}

export function unwarpPoint(params: WarpParams, q: Point, width: number, height: number): Point | null {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  let qx = q[0];
  let qy = q[1];
  if (params.bendAmplitude !== 0 && params.bendWavelength > 0) {
    qy -= params.bendAmplitude * Math.sin((2 * Math.PI * qx) / params.bendWavelength);
  }
  const theta = degToRad(params.thetaDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const scale = params.scale;
  // forward: [rx, ry] = scale * R * [dx, dy]; then shear applied before rotation:
  // d_sheared = S * d, where S = [[1, shearX],[shearY, 1]]
  // So q - c - t = scale * R * S * d
  // => d = S^-1 * R^-1 * (q - c - t) / scale
  const ux = qx - cx - params.tx;
  const uy = qy - cy - params.ty;
  if (scale === 0) return null;
  const invScale = 1 / scale;
  const rx = (cos * ux + sin * uy) * invScale;
  const ry = (-sin * ux + cos * uy) * invScale;
  const det = 1 - params.shearX * params.shearY;
  if (det === 0) return null;
  const dx = (rx - params.shearX * ry) / det;
  const dy = (ry - params.shearY * rx) / det;
  return [cx + dx, cy + dy];
}

export function applyWarp(template: GrayImage, params: WarpParams, seed: number): GrayImage {
  const { width, height } = template;
  const cx = (width - 1) / 2;
  const n = width * height;
  const stage = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = unwarpPoint(params, [x, y], width, height);
      let v = 0;
      if (p !== null) {
        const s = sampleBilinear(template, p[0], p[1]);
        if (s !== null) v = s;
      }
      const gradTerm = cx === 0 ? 1 : 1 + params.gradient * ((x - cx) / cx);
      v = v * params.gain * gradTerm + params.offset;
      stage[y * width + x] = v;
    }
  }
  for (const occ of params.occlusions) {
    const x0 = Math.max(0, Math.floor(occ.x));
    const y0 = Math.max(0, Math.floor(occ.y));
    const x1 = Math.min(width, Math.ceil(occ.x + occ.w));
    const y1 = Math.min(height, Math.ceil(occ.y + occ.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        stage[y * width + x] = occ.value;
      }
    }
  }
  let img: GrayImage = { width, height, data: new Uint8Array(n) };
  for (let i = 0; i < n; i++) img.data[i] = clampByte(stage[i]);
  if (params.blurSigma > 0) img = gaussianBlur(img, params.blurSigma);
  if (params.noiseSigma > 0) {
    const rng = createRng(seed);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = clampByte(img.data[i] + params.noiseSigma * rng.nextGaussian());
    }
    img = { width, height, data: out };
  }
  return img;
}

export function warpToSimilarity(params: WarpParams, width: number, height: number): Similarity {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const theta = degToRad(params.thetaDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const scale = params.scale;
  const tx0 = cx + params.tx - scale * (cos * cx - sin * cy);
  const ty0 = cy + params.ty - scale * (sin * cx + cos * cy);
  return { tx: tx0, ty: ty0, thetaDeg: params.thetaDeg, scale };
}

export function applySimilarity(s: Similarity, p: Point): Point {
  const theta = degToRad(s.thetaDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [s.scale * (cos * p[0] - sin * p[1]) + s.tx, s.scale * (sin * p[0] + cos * p[1]) + s.ty];
}

export function invertSimilarity(s: Similarity): Similarity {
  const theta = degToRad(s.thetaDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const invScale = 1 / s.scale;
  const tx = -invScale * (cos * s.tx + sin * s.ty);
  const ty = -invScale * (-sin * s.tx + cos * s.ty);
  return { tx, ty, thetaDeg: -s.thetaDeg, scale: invScale };
}

export function composeSimilarity(a: Similarity, b: Similarity): Similarity {
  const thetaA = degToRad(a.thetaDeg);
  const thetaB = degToRad(b.thetaDeg);
  const cosA = Math.cos(thetaA);
  const sinA = Math.sin(thetaA);
  const cosB = Math.cos(thetaB);
  const sinB = Math.sin(thetaB);
  const scale = a.scale * b.scale;
  const cos = cosA * cosB - sinA * sinB;
  const sin = sinA * cosB + cosA * sinB;
  const tx = a.scale * (cosA * b.tx - sinA * b.ty) + a.tx;
  const ty = a.scale * (sinA * b.tx + cosA * b.ty) + a.ty;
  return { tx, ty, thetaDeg: (Math.atan2(sin, cos) * 180) / Math.PI, scale };
}
