/**
 * Bridge between the center stage (CenterImage, which owns the image/tone/ROI/
 * metal-sim state) and the Settings accordion's "Image / Alignment" section,
 * which renders the SAME controls inside a different container (the right
 * panel). CenterImage publishes an accessor object here on mount; the settings
 * component reads it. Every field is a getter over CenterImage's own runes, so
 * reading it while rendering tracks CenterImage's $state directly (Svelte 5
 * fine-grained reactivity does not care where the state was declared).
 */
import type { HostId, MedianImage } from './service';
import type { RoiPaletteTool } from './roi-tools';

export type StageSide = 'TOP' | 'BOTTOM';
export type StageMode = 'median' | 'pattern';

export type StageTool =
  | 'fit' | 'zoom-in' | 'zoom-out' | 'gv' | 'roi' | 'grid' | 'refresh'
  | 'median' | 'pattern' | 'roi-delete' | 'roi-clear' | 'metal';

export interface StageSettingsApi {
  readonly side: StageSide;
  readonly host: HostId;
  readonly stageMode: StageMode;
  readonly hasImage: boolean;
  readonly image: MedianImage | null;
  readonly natW: number;
  readonly natH: number;
  readonly lightGv: number;
  readonly contrastPct: number;
  readonly toneAdjusted: boolean;
  readonly drawMode: boolean;
  /** Active button of the reusable ROI tool rail (see lib/roi-tools.ts). */
  readonly tool: RoiPaletteTool;
  readonly measureMode: boolean;
  readonly roiCount: number;
  readonly roiHasSelection: boolean;
  readonly measureVerdict: { ok: boolean; text: string } | null;
  readonly metalOn: boolean;
  readonly alignedOn: boolean;
  readonly simBusy: boolean;
  readonly simOffset: { tx: number; ty: number; theta_deg: number } | null;
  readonly simVerdict: { success: boolean; text: string } | null;
  readonly labOpen: boolean;
  /** A model + machine are selected (the stage can hold an image). */
  readonly ready: boolean;
  setTool(tool: RoiPaletteTool): void;
  setStageMode(mode: StageMode): void;
  setLightGv(value: number): void;
  setContrast(value: number): void;
  resetTone(): void;
  refresh(): void;
  runTool(action: StageTool): void;
  toggleMetal(): void;
  setLabOpen(open: boolean): void;
  generateOffset(): void;
  runAlign(): void;
  revealTruth(): void;
}

/** Populated by CenterImage once it mounts; null before that. */
export const stageApi = $state<{ current: StageSettingsApi | null }>({ current: null });
