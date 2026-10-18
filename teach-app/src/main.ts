import type { Rect } from '../../teach-core/src/gray.ts';
import type { CameraChannel, LightSetting, Material } from '../../teach-core/src/light.ts';
import { DEFAULT_REFLECTANCE, irradiance } from '../../teach-core/src/index.ts';
import type { AlignRoi } from '../../teach-core/src/align.ts';
import { Viewer } from './viewer.ts';
import type { LightUniforms } from './viewer.ts';
import { WorkerClient } from './protocol.ts';
import type { LoadResult, MeasureResultItem, ModelInfo } from './protocol.ts';
import { el } from './ui.ts';
import { LightPanel } from './light-panel.ts';
import { AlignPanel } from './align-panel.ts';
import { DefectPanel } from './defect-panel.ts';

export type TabName = 'light' | 'align' | 'defect';
export type DisplayChannel = 'Red' | 'Green' | 'Blue' | 'RGB';

export interface SharedState {
  model: ModelInfo | null;
  width: number;
  height: number;
  material: Uint8Array | null;
  median: Uint8Array | null;
  materialMeans: [number, number, number, number];
  materialCounts: [number, number, number, number];
  machineRois: AlignRoi[];
  lightSetting: LightSetting;
  displayChannel: DisplayChannel;
  tab: TabName;
  currentGray: { width: number; height: number; data: Uint8Array } | null;
  currentGrayLabel: string;
  showMaterial: boolean;
}

export interface Panel {
  attach(ctx: AppContext, left: HTMLElement, right: HTMLElement): void;
  activate(): void;
  deactivate(): void;
  refresh(): void;
  reset(): void;
}

export interface AppContext {
  state: SharedState;
  viewer: Viewer;
  client: WorkerClient;
  setStatus(text: string): void;
  setHint(text: string): void;
  setElapsed(ms: number): void;
  setDisplayChannel(channel: DisplayChannel): void;
  updateLightUniforms(): void;
  setCurrentGray(image: { width: number; height: number; data: Uint8Array } | null, label: string): void;
  refreshLight(): void;
}

function defaultLightSetting(): LightSetting {
  return {
    channels: [
      { color: 'Red', value: 512, enable: true },
      { color: 'Green', value: 0, enable: false },
      { color: 'Blue', value: 0, enable: false },
      { color: 'White', value: 0, enable: false },
    ],
    reflectance: {
      base: { ...DEFAULT_REFLECTANCE.base },
      sr: { ...DEFAULT_REFLECTANCE.sr },
      open: { ...DEFAULT_REFLECTANCE.open },
      metal: { ...DEFAULT_REFLECTANCE.metal },
    },
    gain: 1,
    offset: 0,
    textureStrength: 1,
  };
}

function channelToCamera(channel: DisplayChannel): CameraChannel {
  if (channel === 'Green') return 'Green';
  if (channel === 'Blue') return 'Blue';
  return 'Red';
}

function buildUniforms(state: SharedState): LightUniforms {
  const reflectance = new Float32Array(12);
  const materials: Material[] = ['base', 'sr', 'open', 'metal'];
  const channels: CameraChannel[] = ['Red', 'Green', 'Blue'];
  for (let mi = 0; mi < materials.length; mi++) {
    for (let ci = 0; ci < channels.length; ci++) {
      reflectance[mi * 3 + ci] = state.lightSetting.reflectance[materials[mi]][channels[ci]];
    }
  }
  const irr: [number, number, number] = [
    irradiance(state.lightSetting, 'Red'),
    irradiance(state.lightSetting, 'Green'),
    irradiance(state.lightSetting, 'Blue'),
  ];
  return {
    reflectance,
    irradiance: irr,
    gain: state.lightSetting.gain ?? 1,
    offset: state.lightSetting.offset ?? 0,
    textureStrength: state.lightSetting.textureStrength ?? 1,
    channel: state.displayChannel,
    showMaterial: state.showMaterial,
  };
}

function computeGvAt(state: SharedState, x: number, y: number): { r: number; g: number; b: number } | null {
  if (state.material === null || state.median === null) return null;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= state.width || iy >= state.height) return null;
  const idx = iy * state.width + ix;
  const m = state.material[idx];
  const v = state.median[idx];
  const mean = state.materialMeans[m];
  const t = mean > 0 ? Math.min(4, Math.max(0, v / mean)) : 1;
  const s = state.lightSetting.textureStrength ?? 1;
  const tp = 1 + s * (t - 1);
  const gain = state.lightSetting.gain ?? 1;
  const offset = state.lightSetting.offset ?? 0;
  const materials: Material[] = ['base', 'sr', 'open', 'metal'];
  const mat = materials[m];
  const compute = (channel: CameraChannel): number => {
    const E = irradiance(state.lightSetting, channel);
    const raw = gain * E * state.lightSetting.reflectance[mat][channel] * tp * 255 + offset + 0.5;
    return Math.min(255, Math.max(0, Math.floor(raw)));
  };
  return { r: compute('Red'), g: compute('Green'), b: compute('Blue') };
}

async function main(): Promise<void> {
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  const loadStatus = document.getElementById('load-status') as HTMLElement;
  const leftPanel = document.getElementById('left-panel') as HTMLElement;
  const rightPanel = document.getElementById('right-panel') as HTMLElement;
  const viewerHost = document.getElementById('viewer-host') as HTMLElement;
  const centerMessage = document.getElementById('center-message') as HTMLElement;
  const statusXy = document.getElementById('status-xy') as HTMLElement;
  const statusGv = document.getElementById('status-gv') as HTMLElement;
  const statusZoom = document.getElementById('status-zoom') as HTMLElement;
  const statusTime = document.getElementById('status-time') as HTMLElement;
  const statusHint = document.getElementById('status-hint') as HTMLElement;
  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#tabs .tab'));

  const state: SharedState = {
    model: null,
    width: 0,
    height: 0,
    material: null,
    median: null,
    materialMeans: [0, 0, 0, 0],
    materialCounts: [0, 0, 0, 0],
    machineRois: [],
    lightSetting: defaultLightSetting(),
    displayChannel: 'Red',
    tab: 'light',
    currentGray: null,
    currentGrayLabel: '',
    showMaterial: false,
  };

  const viewer = new Viewer(viewerHost);
  const worker = new Worker('/teach-app/src/worker.ts', { type: 'module' });
  const client = new WorkerClient(worker);

  let readyResolve: () => void = () => undefined;
  let readyReject: (reason: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => undefined);

  const panels: Record<TabName, Panel> = {
    light: new LightPanel(),
    align: new AlignPanel(),
    defect: new DefectPanel(),
  };

  const panelHosts: Record<TabName, { left: HTMLElement; right: HTMLElement }> = {
    light: { left: el('div'), right: el('div') },
    align: { left: el('div'), right: el('div') },
    defect: { left: el('div'), right: el('div') },
  };
  for (const name of ['light', 'align', 'defect'] as TabName[]) {
    panelHosts[name].left.hidden = panelHosts[name].right.hidden = name !== state.tab;
    leftPanel.appendChild(panelHosts[name].left);
    rightPanel.appendChild(panelHosts[name].right);
  }

  const ctx: AppContext = {
    state,
    viewer,
    client,
    setStatus(text: string): void {
      loadStatus.textContent = text;
    },
    setHint(text: string): void {
      statusHint.textContent = text;
    },
    setElapsed(ms: number): void {
      statusTime.textContent = `耗时 ${ms.toFixed(1)} ms`;
    },
    setDisplayChannel(channel: DisplayChannel): void {
      state.displayChannel = channel;
      ctx.updateLightUniforms();
    },
    updateLightUniforms(): void {
      viewer.setLightUniforms(buildUniforms(state));
    },
    setCurrentGray(image: { width: number; height: number; data: Uint8Array } | null, label: string): void {
      state.currentGray = image;
      state.currentGrayLabel = label;
    },
    refreshLight(): void {
      ctx.updateLightUniforms();
      panels.light.refresh();
      panels.align.refresh();
      panels.defect.refresh();
    },
  };

  for (const name of ['light', 'align', 'defect'] as TabName[]) {
    panels[name].attach(ctx, panelHosts[name].left, panelHosts[name].right);
  }

  viewer.onHover((x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    statusXy.textContent = `XY ${ix}, ${iy}`;
    if (state.tab === 'light') {
      const gv = computeGvAt(state, x, y);
      if (gv === null) {
        statusGv.textContent = 'GV —';
      } else if (state.displayChannel === 'RGB') {
        statusGv.textContent = `GV R${gv.r} G${gv.g} B${gv.b}`;
      } else {
        const v = state.displayChannel === 'Red' ? gv.r : state.displayChannel === 'Green' ? gv.g : gv.b;
        statusGv.textContent = `GV ${v}`;
      }
    } else if (state.currentGray !== null) {
      const img = state.currentGray;
      if (ix >= 0 && iy >= 0 && ix < img.width && iy < img.height) {
        statusGv.textContent = `GV ${img.data[iy * img.width + ix]}`;
      } else {
        statusGv.textContent = 'GV —';
      }
    } else {
      statusGv.textContent = 'GV —';
    }
  });

  const updateZoom = (): void => {
    statusZoom.textContent = `缩放 ${(viewer.zoom * 100).toFixed(0)}%`;
  };
  const zoomTimer = window.setInterval(updateZoom, 200);

  function switchTab(tab: TabName): void {
    if (state.tab === tab) return;
    panels[state.tab].deactivate();
    state.tab = tab;
    for (const btn of tabButtons) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    for (const name of ['light', 'align', 'defect'] as TabName[]) {
      panelHosts[name].left.hidden = name !== tab;
      panelHosts[name].right.hidden = name !== tab;
    }
    panels[tab].activate();
  }

  for (const btn of tabButtons) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabName | undefined;
      if (tab !== undefined) switchTab(tab);
    });
  }

  let firstLoad = true;

  async function loadModel(info: ModelInfo): Promise<void> {
    if (!firstLoad) panels[state.tab].deactivate();
    ctx.setStatus('加载中…');
    const start = performance.now();
    let result: LoadResult;
    try {
      result = await client.request<LoadResult>({
        type: 'load',
        files: info.files,
        alignSpec: info.alignSpec,
      });
    } catch (err) {
      const message = (err as Error).message;
      ctx.setStatus(`加载失败：${message}`);
      centerMessage.hidden = false;
      centerMessage.textContent = `加载失败：${message}`;
      throw err;
    }
    state.model = info;
    state.width = result.width;
    state.height = result.height;
    state.material = result.material;
    state.median = result.median;
    state.materialMeans = result.materialMeans;
    state.materialCounts = result.materialCounts;
    state.machineRois = result.machineRois;
    viewer.setScene(result.width, result.height, result.material, result.median, result.materialMeans);
    ctx.updateLightUniforms();
    viewer.fit();
    const elapsed = performance.now() - start;
    ctx.setStatus(`已加载 ${result.width}×${result.height} · 用时 ${elapsed.toFixed(0)} ms`);
    centerMessage.hidden = true;
    panels.light.reset();
    panels.align.reset();
    panels.defect.reset();
    panels[state.tab].activate();
    firstLoad = false;
    readyResolve();
  }

  let models: ModelInfo[] = [];
  try {
    const res = await fetch('/api/models');
    models = (await res.json()) as ModelInfo[];
  } catch (err) {
    models = [];
    ctx.setStatus(`型号列表获取失败：${(err as Error).message}`);
  }

  interface TeachApi {
    ready: Promise<void>;
    tab(name: TabName): Promise<void>;
    measure(rect: Rect): Promise<unknown>;
    runAlign(): Promise<unknown>;
    runDetect(): Promise<unknown>;
    setLight(patch: Partial<{ red: number; green: number; blue: number; white: number; channel: string }>): void;
    state(): unknown;
  }

  const api: TeachApi = {
    ready,
    async tab(name: TabName): Promise<void> {
      switchTab(name);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    async measure(rect: Rect): Promise<unknown> {
      const channels: CameraChannel[] =
        state.displayChannel === 'RGB' ? ['Red', 'Green', 'Blue'] : [channelToCamera(state.displayChannel)];
      return client.request<MeasureResultItem[]>({
        type: 'measure',
        setting: state.lightSetting,
        channels,
        rect,
      });
    },
    async runAlign(): Promise<unknown> {
      switchTab('align');
      const panel = panels.align as unknown as { runFull(): Promise<unknown> };
      return panel.runFull();
    },
    async runDetect(): Promise<unknown> {
      switchTab('defect');
      const panel = panels.defect as unknown as { runFull(): Promise<unknown> };
      return panel.runFull();
    },
    setLight(patch): void {
      const channels = state.lightSetting.channels;
      const setChannel = (color: 'Red' | 'Green' | 'Blue' | 'White', value: number): void => {
        for (const ch of channels) {
          if (ch.color === color) {
            ch.value = value;
            ch.enable = value > 0;
          }
        }
      };
      if (patch.red !== undefined) setChannel('Red', patch.red);
      if (patch.green !== undefined) setChannel('Green', patch.green);
      if (patch.blue !== undefined) setChannel('Blue', patch.blue);
      if (patch.white !== undefined) setChannel('White', patch.white);
      if (patch.channel !== undefined) {
        const c = patch.channel;
        if (c === 'Red' || c === 'Green' || c === 'Blue' || c === 'RGB') state.displayChannel = c;
      }
      ctx.refreshLight();
    },
    state(): unknown {
      return {
        model: state.model,
        width: state.width,
        height: state.height,
        tab: state.tab,
        displayChannel: state.displayChannel,
        lightSetting: state.lightSetting,
        materialCounts: state.materialCounts,
        materialMeans: state.materialMeans,
        machineRois: state.machineRois,
      };
    },
  };

  (window as unknown as { __teach: TeachApi }).__teach = api;

  window.addEventListener('beforeunload', () => {
    window.clearInterval(zoomTimer);
    client.terminate();
  });

  if (models.length === 0) {
    centerMessage.hidden = false;
    centerMessage.textContent =
      'reference 中没有可用型号。\n\n期望的目录结构：\nreference/<FM1|FM2|BM>/PxRepository/<型号>/\n  Metal.tif, SR.tif, Open.tif\n  <版本>/Line/<Top|Bottom>/Layer/MEDIAN/Median_0_1_0.tif';
    ctx.setStatus('无可用型号');
    readyReject(new Error('无可用型号'));
  } else {
    for (const info of models) {
      modelSelect.appendChild(el('option', { value: info.id, text: `${info.id} · ${info.version}` }));
    }
    modelSelect.value = models[0].id;
    modelSelect.addEventListener('change', () => {
      const found = models.find((m) => m.id === modelSelect.value);
      if (found !== undefined) {
        loadModel(found).catch(() => undefined);
      }
    });
    try {
      await loadModel(models[0]);
    } catch {
      readyReject(new Error('加载失败'));
    }
  }
}

void main();
