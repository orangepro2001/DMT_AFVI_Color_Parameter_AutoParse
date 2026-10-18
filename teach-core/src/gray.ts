export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Point = [number, number];

export function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

export function createGray(width: number, height: number, fill = 0): GrayImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`createGray: invalid size ${width}x${height}`);
  }
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(clampByte(fill));
  return { width, height, data };
}

export function cloneGray(img: GrayImage): GrayImage {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

export function getPixel(img: GrayImage, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= img.width || y >= img.height) {
    throw new Error(`getPixel: out of bounds (${x},${y}) for ${img.width}x${img.height}`);
  }
  return img.data[y * img.width + x];
}

export function sampleBilinear(img: GrayImage, x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const w = img.width;
  const v00 = img.data[y0 * w + x0];
  const v10 = img.data[y0 * w + x1];
  const v01 = img.data[y1 * w + x0];
  const v11 = img.data[y1 * w + x1];
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const size = radius * 2 + 1;
  const kernel = new Float64Array(size);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    const v = Math.exp(-(d * d) / denom);
    kernel[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

export function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  if (!(sigma > 0)) return cloneGray(img);
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const { width, height } = img;
  const tmp = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sx = x + k;
        if (sx < 0) sx = 0;
        else if (sx > width - 1) sx = width - 1;
        acc += img.data[row + sx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        let sy = y + k;
        if (sy < 0) sy = 0;
        else if (sy > height - 1) sy = height - 1;
        acc += tmp[sy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = clampByte(acc);
    }
  }
  return { width, height, data: out };
}

export function downsampleArea(img: GrayImage, factor: number): GrayImage {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`downsampleArea: invalid factor ${factor}`);
  }
  if (factor === 1) return cloneGray(img);
  const outW = Math.max(1, Math.floor(img.width / factor));
  const outH = Math.max(1, Math.floor(img.height / factor));
  const out = new Uint8Array(outW * outH);
  const inv = 1 / (factor * factor);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = oy * factor + dy;
        const row = sy * img.width;
        for (let dx = 0; dx < factor; dx++) {
          sum += img.data[row + ox * factor + dx];
        }
      }
      out[oy * outW + ox] = clampByte(sum * inv);
    }
  }
  return { width: outW, height: outH, data: out };
}

export function cropGray(img: GrayImage, rect: Rect): GrayImage {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) {
    throw new Error(`cropGray: empty region ${JSON.stringify(rect)}`);
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (y0 + y) * img.width + x0;
    out.set(img.data.subarray(src, src + w), y * w);
  }
  return { width: w, height: h, data: out };
}
