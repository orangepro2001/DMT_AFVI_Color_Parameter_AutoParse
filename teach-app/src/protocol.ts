import type { GrayImage, Point, Rect } from '../../teach-core/src/gray.ts';
import type { CameraChannel, GvStats, LightSetting, Material } from '../../teach-core/src/light.ts';
import type { WarpParams } from '../../teach-core/src/warp.ts';
import type { AlignConfig, AlignReport, AlignRoi } from '../../teach-core/src/align.ts';
import type { DefectParams, DefectReport, DefectStroke, SceneStroke } from '../../teach-core/src/defect.ts';

export interface ModelInfo {
  id: string;
  host: 'FM1' | 'FM2' | 'BM';
  model: string;
  side: 'TOP' | 'BOTTOM';
  version: string;
  files: { metal: string; sr: string; open: string; median: string; pattern: string | null };
  alignSpec: string | null;
}

export interface LoadResult {
  width: number;
  height: number;
  material: Uint8Array;
  median: Uint8Array;
  materialMeans: [number, number, number, number];
  materialCounts: [number, number, number, number];
  machineRois: AlignRoi[];
}

export interface MeasureResultItem {
  channel: CameraChannel;
  stats: GvStats;
}

export interface WarpResult {
  template: GrayImage;
  input: GrayImage;
}

export interface AlignTruth {
  perRoiErrorPx: number[];
  meanErrorPx: number;
  maxErrorPx: number;
}

export interface AlignResult {
  report: AlignReport;
  truth: AlignTruth;
  elapsedMs: number;
}

export interface DefectRenderResult {
  golden: GrayImage;
  test: GrayImage;
}

export interface ProbeResult {
  maxBright: number;
  maxDark: number;
  brightPixels: number;
  darkPixels: number;
  wouldDetectBright: boolean;
  wouldDetectDark: boolean;
}

export type WorkerRequest =
  | { id: number; type: 'load'; files: ModelInfo['files']; alignSpec: string | null }
  | { id: number; type: 'measure'; setting: LightSetting; channels: CameraChannel[]; rect: Rect }
  | { id: number; type: 'estimate'; setting: LightSetting; channel: CameraChannel }
  | {
      id: number;
      type: 'warp';
      source: 'median' | 'light';
      setting: LightSetting;
      channel: CameraChannel;
      scale: 1 | 2 | 4;
      params: WarpParams;
      seed: number;
    }
  | { id: number; type: 'align'; rois: AlignRoi[]; config: AlignConfig; params: WarpParams }
  | { id: number; type: 'alignView'; kind: 'template' | 'input' | 'diff' }
  | {
      id: number;
      type: 'defectRender';
      setting: LightSetting;
      channel: CameraChannel;
      sceneStrokes: SceneStroke[];
      gvStrokes: DefectStroke[];
    }
  | { id: number; type: 'detect'; params: DefectParams; regionMaterials: Material[] | null }
  | { id: number; type: 'probe'; rect: Rect; params: DefectParams }
  | { id: number; type: 'defectView'; kind: 'test' | 'golden' | 'diff' };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export interface WorkerResultMap {
  load: LoadResult;
  measure: MeasureResultItem[];
  estimate: Record<Material, number | null>;
  warp: WarpResult;
  align: AlignResult;
  alignView: GrayImage;
  defectRender: DefectRenderResult;
  detect: DefectReport;
  probe: ProbeResult;
  defectView: GrayImage;
}

export type WorkerRequestType = keyof WorkerResultMap;

export interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  key: string | null;
  seq: number;
}

export class WorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, PendingEntry>();
  private latestSeq = new Map<string, number>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    });
    this.worker.addEventListener('error', (event: ErrorEvent) => {
      const err = new Error(`worker error: ${event.message}`);
      for (const entry of this.pending.values()) entry.reject(err);
      this.pending.clear();
    });
  }

  private handleMessage(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.id);
    if (entry === undefined) return;
    this.pending.delete(msg.id);
    if (entry.key !== null) {
      const latest = this.latestSeq.get(entry.key);
      if (latest !== undefined && latest !== entry.seq) {
        entry.resolve(null);
        return;
      }
    }
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error));
  }

  request<T>(msg: Omit<WorkerRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    const full = { ...msg, id } as WorkerRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        key: null,
        seq: 0,
      });
      this.worker.postMessage(full);
    });
  }

  latest<T>(key: string, msg: Omit<WorkerRequest, 'id'>): Promise<T | null> {
    const id = this.nextId++;
    const seq = id;
    this.latestSeq.set(key, seq);
    const full = { ...msg, id } as WorkerRequest;
    return new Promise<T | null>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        key,
        seq,
      });
      this.worker.postMessage(full);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
}
