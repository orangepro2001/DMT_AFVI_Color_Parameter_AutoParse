import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTiffGray } from '../src/tiff.ts';
import type { GrayImage } from '../src/gray.ts';
import {
  DEFAULT_REFLECTANCE,
  buildMaterialMap,
  cloneReflectance,
  createLightScene,
  materialStats,
  measureGv,
  renderChannel,
  withReflectance,
} from '../src/light.ts';
import type { LightSetting } from '../src/light.ts';
import { IDENTITY_WARP, applyWarp } from '../src/warp.ts';
import type { WarpParams } from '../src/warp.ts';
import { DEFAULT_ALIGN_CONFIG, alignWithRois, compareToTruth } from '../src/align.ts';
import type { AlignRoi } from '../src/align.ts';
import { DEFAULT_DEFECT_PARAMS, detectDefects, paintDefects, paintScene, probeArea } from '../src/defect.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = process.argv[2] !== undefined ? resolve(process.argv[2]) : resolve(scriptDir, '..', '..');

let failures = 0;
const summary: Record<string, unknown> = {};

function report(name: string, pass: boolean, detail: unknown): void {
  if (!pass) failures++;
  summary[name] = { pass, detail };
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
}

function loadTiff(relPath: string): GrayImage {
  const bytes = new Uint8Array(readFileSync(join(repoRoot, relPath)));
  return readTiffGray(bytes);
}

function meanOf(img: GrayImage): number {
  let sum = 0;
  for (const v of img.data) sum += v;
  return sum / img.data.length;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

const base = 'reference/FM1/PxRepository/25fbo015-15';
const images: Record<string, GrayImage> = {
  Metal: loadTiff(`${base}/Metal.tif`),
  SR: loadTiff(`${base}/SR.tif`),
  Open: loadTiff(`${base}/Open.tif`),
  Pattern: loadTiff(`${base}/2.0/Line/Top/Layer/GB/Pattern.tif`),
  Median_0_1_0: loadTiff(`${base}/2.0/Line/Top/Layer/MEDIAN/Median_0_1_0.tif`),
  Median_0_1_1: loadTiff(`${base}/2.0/Line/Top/Layer/MEDIAN/Median_0_1_1.tif`),
  Median_0_1_2: loadTiff(`${base}/2.0/Line/Top/Layer/MEDIAN/Median_0_1_2.tif`),
};

const expectedMeans: Record<string, number> = {
  Metal: 16.7327,
  Open: 15.3378,
  SR: 152.0661,
  Pattern: 6.9965,
  Median_0_1_0: 31.0297,
  Median_0_1_1: 18.0989,
  Median_0_1_2: 52.3734,
};

for (const name of Object.keys(expectedMeans)) {
  const img = images[name];
  const sizeOk = img.width === 5860 && img.height === 4020;
  const mean = meanOf(img);
  const pass = sizeOk && round4(mean) === expectedMeans[name];
  report(`tiff-mean-${name}`, pass, { width: img.width, height: img.height, mean: round4(mean), expected: expectedMeans[name] });
}

const median0 = images.Median_0_1_0;
const gvCases: Array<{ roi: { x: number; y: number; w: number; h: number }; expected: { roi: { x: number; y: number; w: number; h: number }; mean: number; std: number; min: number; max: number; pixels: number } }> = [
  {
    roi: { x: 1000, y: 1000, w: 200, h: 150 },
    expected: { roi: { x: 1000, y: 1000, w: 200, h: 150 }, mean: 28.411967, std: 5.351746, min: 13, max: 34, pixels: 30000 },
  },
  {
    roi: { x: 5700.5, y: 3900.2, w: 400, h: 400 },
    expected: { roi: { x: 5700, y: 3900, w: 160, h: 120 }, mean: 38.168906, std: 39.087484, min: 16, max: 164, pixels: 19200 },
  },
  {
    roi: { x: 2930, y: 2010, w: 1, h: 1 },
    expected: { roi: { x: 2930, y: 2010, w: 1, h: 1 }, mean: 123, std: 0, min: 123, max: 123, pixels: 1 },
  },
];

for (let i = 0; i < gvCases.length; i++) {
  const c = gvCases[i];
  const stats = measureGv(median0, c.roi);
  const roiOk =
    stats.roi.x === c.expected.roi.x &&
    stats.roi.y === c.expected.roi.y &&
    stats.roi.w === c.expected.roi.w &&
    stats.roi.h === c.expected.roi.h;
  const meanOk = Math.abs(stats.mean - c.expected.mean) < 1e-5;
  const stdOk = Math.abs(stats.std - c.expected.std) < 1e-5;
  const restOk =
    stats.min === c.expected.min &&
    stats.max === c.expected.max &&
    stats.pixels === c.expected.pixels;
  report(`gv-${i}`, roiOk && meanOk && stdOk && restOk, {
    roi: stats.roi,
    mean: stats.mean,
    std: stats.std,
    min: stats.min,
    max: stats.max,
    pixels: stats.pixels,
  });
}

const material = buildMaterialMap({ metal: images.Metal, sr: images.SR, open: images.Open });
const scene = createLightScene(median0, material);
const stats = materialStats(median0, material);
console.log('material stats', JSON.stringify(stats));

const redSetting: LightSetting = {
  channels: [{ color: 'Red', value: 512, enable: true }],
  reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
};
const blueSetting: LightSetting = {
  channels: [{ color: 'Blue', value: 512, enable: true }],
  reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
};
const redImg = renderChannel(scene, redSetting, 'Red');
const blueImg = renderChannel(scene, blueSetting, 'Blue');
const redStats = materialStats(redImg, material);
const blueStats = materialStats(blueImg, material);
console.log('red material means', JSON.stringify(redStats));
console.log('blue material means', JSON.stringify(blueStats));
const redRatio = redStats.metal.mean / Math.max(1e-9, redStats.sr.mean);
const blueRatio = blueStats.metal.mean / Math.max(1e-9, blueStats.sr.mean);
report('light-metal-sr-ratio', redRatio > blueRatio, { redRatio, blueRatio });

const adjusted = withReflectance(DEFAULT_REFLECTANCE, 'metal', 'Red', 0.3);
const adjustedSetting: LightSetting = { ...redSetting, reflectance: adjusted };
const adjustedImg = renderChannel(scene, adjustedSetting, 'Red');
const adjustedStats = materialStats(adjustedImg, material);
report('light-reflectance-adjustable', adjustedStats.metal.mean < redStats.metal.mean, {
  before: redStats.metal.mean,
  after: adjustedStats.metal.mean,
});

const xml = readFileSync(join(repoRoot, 'reference/FM1/PxInventory/INSPECT_SPEC/25FBO015-15-00/TOP/AlignSpec.xml'), 'utf8');
const unitMatch = xml.match(/<Unit[^>]*>([\s\S]*?)<\/Unit>/);
const rois: AlignRoi[] = [];
if (unitMatch) {
  const paramRe = /<Param\s+ID="(\d+)"\s+Left="(-?\d+)"\s+Top="(-?\d+)"\s+Right="(-?\d+)"\s+Bottom="(-?\d+)"\s+Type="0"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(unitMatch[1])) !== null) {
    const left = Number(m[2]);
    const top = Number(m[3]);
    const right = Number(m[4]);
    const bottom = Number(m[5]);
    rois.push({ name: `P${m[1]}`, x: left, y: top, w: right - left, h: bottom - top });
  }
}
console.log('align rois', JSON.stringify(rois));

const easyWarp: WarpParams = { ...IDENTITY_WARP, tx: 15, ty: -10, thetaDeg: 0.3, scale: 1.002 };
const easyInput = applyWarp(median0, easyWarp, 7);
const easyStart = Date.now();
const easyReport = alignWithRois(median0, easyInput, rois, DEFAULT_ALIGN_CONFIG);
const easyTruth = compareToTruth(easyReport.fit, easyWarp, rois, median0.width, median0.height);
console.log('easy verdict', easyReport.verdict.level, JSON.stringify(easyReport.verdict.reasons));
console.log('easy matches', JSON.stringify(easyReport.matches.map((m) => ({ name: m.name, ncc: m.ncc, uniqueness: m.uniqueness, located: m.located }))));
console.log('easy meanErrorPx', easyTruth.meanErrorPx, 'elapsedMs', Date.now() - easyStart);
report('align-easy', easyReport.verdict.level !== 'ng' && easyTruth.meanErrorPx < 1.0, {
  level: easyReport.verdict.level,
  meanErrorPx: easyTruth.meanErrorPx,
});

const p5 = rois.find((r) => r.name === 'P5');
const occlusions = p5
  ? [{ x: p5.x + p5.w * 0.2, y: p5.y + p5.h * 0.2, w: p5.w * 0.6, h: p5.h * 0.6, value: 0 }]
  : [];
const hardWarp: WarpParams = {
  ...easyWarp,
  bendAmplitude: 6,
  bendWavelength: 1500,
  blurSigma: 2,
  noiseSigma: 12,
  gradient: 0.4,
  occlusions,
};
const hardInput = applyWarp(median0, hardWarp, 7);
const hardStart = Date.now();
const hardReport = alignWithRois(median0, hardInput, rois, DEFAULT_ALIGN_CONFIG);
const hardTruth = compareToTruth(hardReport.fit, hardWarp, rois, median0.width, median0.height);
console.log('hard verdict', hardReport.verdict.level, JSON.stringify(hardReport.verdict.reasons));
console.log('hard matches', JSON.stringify(hardReport.matches.map((m) => ({ name: m.name, ncc: m.ncc, uniqueness: m.uniqueness, located: m.located }))));
console.log('hard meanErrorPx', hardTruth.meanErrorPx, 'elapsedMs', Date.now() - hardStart);

const oobWarp: WarpParams = { ...IDENTITY_WARP, tx: 400, ty: 0 };
const oobInput = applyWarp(median0, oobWarp, 7);
const oobReport = alignWithRois(median0, oobInput, rois, DEFAULT_ALIGN_CONFIG);
console.log('out-of-range verdict', oobReport.verdict.level, JSON.stringify(oobReport.verdict.reasons));
report('align-out-of-range', oobReport.verdict.level === 'ng', { level: oobReport.verdict.level });

const red600: LightSetting = {
  channels: [{ color: 'Red', value: 600, enable: true }],
  reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
};
const blue600: LightSetting = {
  channels: [{ color: 'Blue', value: 600, enable: true }],
  reflectance: cloneReflectance(DEFAULT_REFLECTANCE),
};
const goldenRed = renderChannel(scene, red600, 'Red');
const goldenBlue = renderChannel(scene, blue600, 'Blue');

function findSrPoint(minDistance: number): { x: number; y: number } | null {
  const w = scene.width;
  const h = scene.height;
  for (let y = minDistance; y < h - minDistance; y += 3) {
    for (let x = minDistance; x < w - minDistance; x += 3) {
      if (scene.material[y * w + x] !== 1) continue;
      let ok = true;
      for (let dy = -minDistance; dy <= minDistance && ok; dy += 5) {
        for (let dx = -minDistance; dx <= minDistance; dx += 5) {
          if (scene.material[(y + dy) * w + (x + dx)] !== 1) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

function findMetalPoint(minDistance: number): { x: number; y: number } | null {
  const w = scene.width;
  const h = scene.height;
  for (let y = minDistance; y < h - minDistance; y += 3) {
    for (let x = minDistance; x < w - minDistance; x += 3) {
      if (scene.material[y * w + x] !== 3) continue;
      let ok = true;
      for (let dy = -3; dy <= 3 && ok; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (scene.material[(y + dy) * w + (x + dx)] !== 3) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

const srPointA = findSrPoint(50);
const metalPoint = findMetalPoint(50);
if (srPointA && metalPoint) {
  const testRed = paintDefects(goldenRed, [
    { kind: 'bright', shape: 'spot', x: srPointA.x, y: srPointA.y, radius: 6, deltaGv: 60, softness: 0.3 },
    { kind: 'dark', shape: 'spot', x: metalPoint.x, y: metalPoint.y, radius: 1.5, deltaGv: 50, softness: 0 },
  ]);
  const defectReport = detectDefects(goldenRed, testRed, DEFAULT_DEFECT_PARAMS);
  const bright = defectReport.blobs.find((b) => b.kind === 'bright');
  const dark = defectReport.blobs.find((b) => b.kind === 'dark');
  report('defect-bright-detected', bright !== undefined && bright.detected, { bright });
  report(
    'defect-dark-below-size',
    dark !== undefined && !dark.detected && dark.rejectReason === 'below-size',
    { dark },
  );

  const srProbe = probeArea(
    goldenRed,
    paintDefects(goldenRed, [
      { kind: 'dark', shape: 'spot', x: srPointA.x, y: srPointA.y, radius: 1.5, deltaGv: 50, softness: 0 },
    ]),
    { x: srPointA.x - 5, y: srPointA.y - 5, w: 11, h: 11 },
    DEFAULT_DEFECT_PARAMS,
  );
  console.log(
    'note: 暗材料上的暗缺陷被 0 截断，ΔGV 不足 TH',
    JSON.stringify(srProbe),
  );
} else {
  report('defect-bright-detected', false, { reason: 'no SR point found' });
  report('defect-dark-below-size', false, { reason: 'no SR or metal point found' });
}

if (srPointA) {
  const foreign = paintScene(scene, [
    { mode: 'material', shape: 'spot', x: srPointA.x, y: srPointA.y, radius: 5, material: 'metal' },
  ]);
  const foreignRed = renderChannel(foreign, red600, 'Red');
  const foreignBlue = renderChannel(foreign, blue600, 'Blue');
  const idx = srPointA.y * scene.width + srPointA.x;
  const redDelta = Math.abs(foreignRed.data[idx] - goldenRed.data[idx]);
  const blueDelta = Math.abs(foreignBlue.data[idx] - goldenBlue.data[idx]);
  console.log('foreign peakDelta red', redDelta, 'blue', blueDelta);
  report('defect-foreign-light-dependent', redDelta !== blueDelta, { redDelta, blueDelta });
} else {
  report('defect-foreign-light-dependent', false, { reason: 'no SR point found' });
}

console.log('SUMMARY', JSON.stringify(summary, null, 2));
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('all checks passed');
}
