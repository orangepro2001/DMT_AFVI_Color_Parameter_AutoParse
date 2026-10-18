import {
  buildMaterialMap,
  createLightScene,
  downsampleArea,
  materialMask,
  measureGv,
  paintDefects,
  paintScene,
  readTiffGray,
  renderChannel,
  alignWithRois,
  compareToTruth,
  detectDefects,
  probeArea,
  applyWarp,
  DEFAULT_ALIGN_CONFIG,
  DEFAULT_DEFECT_PARAMS,
} from '../../teach-core/src/index.ts';
import type {
  AlignConfig,
  AlignRoi,
  CameraChannel,
  DefectParams,
  DefectReport,
  DefectStroke,
  GrayImage,
  LightScene,
  LightSetting,
  Material,
  Rect,
  SceneStroke,
  WarpParams,
} from '../../teach-core/src/index.ts';
import type {
  AlignResult,
  DefectRenderResult,
  LoadResult,
  MeasureResultItem,
  ProbeResult,
  WarpResult,
  WorkerRequest,
  WorkerResponse,
} from './protocol.ts';

interface WorkerState {
  scene: LightScene | null;
  median: GrayImage | null;
  material: Uint8Array | null;
  materialMeans: [number, number, number, number];
  materialCounts: [number, number, number, number];
  machineRois: AlignRoi[];
  warpTemplate: GrayImage | null;
  warpInput: GrayImage | null;
  warpScale: 1 | 2 | 4;
  defectGolden: GrayImage | null;
  defectTest: GrayImage | null;
}

const state: WorkerState = {
  scene: null,
  median: null,
  material: null,
  materialMeans: [0, 0, 0, 0],
  materialCounts: [0, 0, 0, 0],
  machineRois: [],
  warpTemplate: null,
  warpInput: null,
  warpScale: 2,
  defectGolden: null,
  defectTest: null,
};

function requireScene(): LightScene {
  if (state.scene === null) throw new Error('scene not loaded');
  return state.scene;
}

function requireMedian(): GrayImage {
  if (state.median === null) throw new Error('median not loaded');
  return state.median;
}

function copyGray(img: GrayImage): GrayImage {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

function transferGray(img: GrayImage): { image: GrayImage; transfer: ArrayBuffer[] } {
  const copy = copyGray(img);
  return { image: copy, transfer: [copy.data.buffer] };
}

async function fetchBytes(relPath: string): Promise<Uint8Array> {
  const res = await fetch(`/api/file?path=${encodeURIComponent(relPath)}`);
  if (!res.ok) throw new Error(`fetch ${relPath} failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function parseAlignSpec(xml: string): AlignRoi[] {
  const rois: AlignRoi[] = [];
  const unitMatch = /<Unit\b[^>]*>([\s\S]*?)<\/Unit>/i.exec(xml);
  if (unitMatch === null) return rois;
  const body = unitMatch[1];
  const paramRe = /<Param\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(body)) !== null) {
    const attrs = m[1];
    const type = /Type="(\d+)"/i.exec(attrs);
    if (type === null || type[1] !== '0') continue;
    const id = /ID="(\d+)"/i.exec(attrs);
    const left = /Left="(-?\d+)"/i.exec(attrs);
    const top = /Top="(-?\d+)"/i.exec(attrs);
    const right = /Right="(-?\d+)"/i.exec(attrs);
    const bottom = /Bottom="(-?\d+)"/i.exec(attrs);
    if (id === null || left === null || top === null || right === null || bottom === null) continue;
    const x = Number(left[1]);
    const y = Number(top[1]);
    const w = Number(right[1]) - x;
    const h = Number(bottom[1]) - y;
    if (w <= 0 || h <= 0) continue;
    rois.push({ name: `P${id[1]}`, x, y, w, h });
  }
  return rois;
}

async function handleLoad(files: LoadResult extends never ? never : WorkerRequest & { type: 'load' }): Promise<LoadResult> {
  const [metalBytes, srBytes, openBytes, medianBytes] = await Promise.all([
    fetchBytes(files.files.metal),
    fetchBytes(files.files.sr),
    fetchBytes(files.files.open),
    fetchBytes(files.files.median),
  ]);
  const metal = readTiffGray(metalBytes);
  const sr = readTiffGray(srBytes);
  const open = readTiffGray(openBytes);
  const median = readTiffGray(medianBytes);
  const material = buildMaterialMap({ metal, sr, open });
  const scene = createLightScene(median, material);
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  const sums: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < material.length; i++) {
    const m = material[i];
    counts[m]++;
    sums[m] += median.data[i];
  }
  const means: [number, number, number, number] = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) means[m] = counts[m] > 0 ? sums[m] / counts[m] : 0;

  let machineRois: AlignRoi[] = [];
  if (files.alignSpec !== null) {
    try {
      const xmlBytes = await fetchBytes(files.alignSpec);
      const xml = new TextDecoder('utf-8').decode(xmlBytes);
      machineRois = parseAlignSpec(xml);
    } catch {
      machineRois = [];
    }
  }

  state.scene = scene;
  state.median = median;
  state.material = material;
  state.materialMeans = means;
  state.materialCounts = counts;
  state.machineRois = machineRois;
  state.warpTemplate = null;
  state.warpInput = null;
  state.defectGolden = null;
  state.defectTest = null;

  return {
    width: median.width,
    height: median.height,
    material: new Uint8Array(material),
    median: new Uint8Array(median.data),
    materialMeans: means,
    materialCounts: counts,
    machineRois,
  };
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  const x0 = Math.min(Math.floor(Math.max(rect.x, 0)), width - 1);
  const y0 = Math.min(Math.floor(Math.max(rect.y, 0)), height - 1);
  const x1 = Math.min(Math.max(Math.ceil(rect.x + rect.w), x0 + 1), width);
  const y1 = Math.min(Math.max(Math.ceil(rect.y + rect.h), y0 + 1), height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function subScene(scene: LightScene, rect: Rect): LightScene {
  const { x, y, w, h } = rect;
  const material = new Uint8Array(w * h);
  const texture = new Float32Array(w * h);
  for (let row = 0; row < h; row++) {
    const src = (y + row) * scene.width + x;
    material.set(scene.material.subarray(src, src + w), row * w);
    texture.set(scene.texture.subarray(src, src + w), row * w);
  }
  return { width: w, height: h, material, texture };
}

function handleMeasure(setting: LightSetting, channels: CameraChannel[], rect: Rect): MeasureResultItem[] {
  const scene = requireScene();
  const clamped = clampRect(rect, scene.width, scene.height);
  const sub = subScene(scene, clamped);
  const out: MeasureResultItem[] = [];
  for (const channel of channels) {
    const img = renderChannel(sub, setting, channel);
    const stats = measureGv(img, { x: 0, y: 0, w: sub.width, h: sub.height });
    out.push({
      channel,
      stats: { ...stats, roi: { x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h } },
    });
  }
  return out;
}

function handleWarp(
  source: 'median' | 'light',
  setting: LightSetting,
  channel: CameraChannel,
  scale: 1 | 2 | 4,
  params: WarpParams,
  seed: number,
): WarpResult {
  const scene = requireScene();
  const median = requireMedian();
  let base: GrayImage;
  if (source === 'median') base = median;
  else base = renderChannel(scene, setting, channel);
  const template = scale > 1 ? downsampleArea(base, scale) : base;
  const input = applyWarp(template, params, seed);
  state.warpTemplate = template;
  state.warpInput = input;
  state.warpScale = scale;
  return { template: copyGray(template), input: copyGray(input) };
}

function handleAlign(rois: AlignRoi[], config: AlignConfig, params: WarpParams): AlignResult {
  if (state.warpTemplate === null || state.warpInput === null) {
    throw new Error('warp not generated yet');
  }
  const template = state.warpTemplate;
  const input = state.warpInput;
  const start = performance.now();
  const report = alignWithRois(template, input, rois, config);
  const truth = compareToTruth(report.fit, params, rois, template.width, template.height);
  const elapsedMs = performance.now() - start;
  return { report, truth, elapsedMs };
}

function handleAlignView(kind: 'template' | 'input' | 'diff'): GrayImage {
  if (state.warpTemplate === null || state.warpInput === null) {
    throw new Error('warp not generated yet');
  }
  const t = state.warpTemplate;
  const i = state.warpInput;
  if (kind === 'template') return copyGray(t);
  if (kind === 'input') return copyGray(i);
  const n = Math.min(t.data.length, i.data.length);
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = Math.abs(t.data[k] - i.data[k]);
  return { width: t.width, height: t.height, data: out };
}

function handleDefectRender(
  setting: LightSetting,
  channel: CameraChannel,
  sceneStrokes: SceneStroke[],
  gvStrokes: DefectStroke[],
): DefectRenderResult {
  const scene = requireScene();
  const golden = renderChannel(scene, setting, channel);
  const painted = sceneStrokes.length > 0 ? paintScene(scene, sceneStrokes) : scene;
  const test = paintDefects(renderChannel(painted, setting, channel), gvStrokes);
  state.defectGolden = golden;
  state.defectTest = test;
  return { golden: copyGray(golden), test: copyGray(test) };
}

function handleDetect(params: DefectParams, regionMaterials: Material[] | null): DefectReport {
  if (state.defectGolden === null || state.defectTest === null) {
    throw new Error('defect render not generated yet');
  }
  const scene = requireScene();
  const region = regionMaterials !== null ? materialMask(scene, regionMaterials) : undefined;
  return detectDefects(state.defectGolden, state.defectTest, params, region);
}

function handleProbe(rect: Rect, params: DefectParams): ProbeResult {
  if (state.defectGolden === null || state.defectTest === null) {
    throw new Error('defect render not generated yet');
  }
  return probeArea(state.defectGolden, state.defectTest, rect, params);
}

function handleDefectView(kind: 'test' | 'golden' | 'diff'): GrayImage {
  if (state.defectGolden === null || state.defectTest === null) {
    throw new Error('defect render not generated yet');
  }
  const g = state.defectGolden;
  const t = state.defectTest;
  if (kind === 'golden') return copyGray(g);
  if (kind === 'test') return copyGray(t);
  const n = Math.min(g.data.length, t.data.length);
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const v = 128 + t.data[k] - g.data[k];
    out[k] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return { width: g.width, height: g.height, data: out };
}

function collectTransfer(result: unknown): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (value instanceof Uint8Array) {
      buffers.push(value.buffer);
      return;
    }
    if (value instanceof Float32Array) {
      buffers.push(value.buffer);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object') {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        visit((value as Record<string, unknown>)[key]);
      }
    }
  };
  visit(result);
  return buffers;
}

async function dispatch(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'load':
      return handleLoad(msg);
    case 'measure':
      return handleMeasure(msg.setting, msg.channels, msg.rect);
    case 'estimate': {
      const scene = requireScene();
      const median = requireMedian();
      const { estimateReflectance } = await import('../../teach-core/src/index.ts');
      return estimateReflectance(median, scene, msg.setting, msg.channel);
    }
    case 'warp':
      return handleWarp(msg.source, msg.setting, msg.channel, msg.scale, msg.params, msg.seed);
    case 'align':
      return handleAlign(msg.rois, msg.config, msg.params);
    case 'alignView':
      return handleAlignView(msg.kind);
    case 'defectRender':
      return handleDefectRender(msg.setting, msg.channel, msg.sceneStrokes, msg.gvStrokes);
    case 'detect':
      return handleDetect(msg.params, msg.regionMaterials);
    case 'probe':
      return handleProbe(msg.rect, msg.params);
    case 'defectView':
      return handleDefectView(msg.kind);
    default: {
      const exhaustive: never = msg;
      throw new Error(`unknown request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  void (async () => {
    try {
      const result = await dispatch(msg);
      const transfer = collectTransfer(result);
      const response: WorkerResponse = { id: msg.id, ok: true, result };
      (self as unknown as Worker).postMessage(response, transfer);
    } catch (err) {
      const response: WorkerResponse = { id: msg.id, ok: false, error: (err as Error).message };
      (self as unknown as Worker).postMessage(response);
    }
  })();
});

export const WORKER_DEFAULTS = {
  align: DEFAULT_ALIGN_CONFIG,
  defect: DEFAULT_DEFECT_PARAMS,
};
