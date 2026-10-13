import { invoke } from '@tauri-apps/api/core';
import { XMLParser } from 'fast-xml-parser';
import type { HostAlignment, InspectionGroup, InspectionParameter } from './spec-model';
import { createDocumentStore, type DocumentStoreClient } from './document-store';
import { appStore } from './stores.svelte';

export type HostId = 'FM1' | 'FM2' | 'BM';

export interface Machine {
  id: string;
  name: string;
  fm1_path: string;
  fm2_path: string;
  bm_path: string;
  /** Main PC IP (e.g. 192.168.1.60). The Vision PCs derive from it: FM1=.61, FM2=.62, BM=.63. */
  main_ip?: string;
  /** Gerber/MasterData share (\\IP\PxRepository) - one per Vision PC, same level as PxInventory. */
  fm1_repository_path?: string;
  fm2_repository_path?: string;
  bm_repository_path?: string;
  /** Optional credentials for network shares (UNC paths); applied with `net use` before file access. */
  username?: string;
  password?: string;
}

const HOST_IP_OFFSETS: Record<HostId, number> = { FM1: 1, FM2: 2, BM: 3 };

/**
 * Mirrors the Rust collector's `canonical_model_name` (uppercase, no -00
 * variant suffix) so lookups keep matching whatever the user typed. Exported
 * because the model picker joins the Product and Model lists on it.
 */
export function canonicalModelName(name: string): string {
  return name.trim().toUpperCase().replace(/-00$/i, '');
}

/** Flat network topology: main PC 192.168.1.60 -> FM1 192.168.1.61, FM2 .62, BM .63. */
export function deriveHostIp(mainIp: string, host: HostId): string {
  const parts = mainIp.trim().split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return '';
  }
  // last octet + offset, carrying into the third octet (254 -> 255 -> next subnet start)
  let value = parts[3] + HOST_IP_OFFSETS[host];
  parts[2] += Math.floor(value / 256);
  value %= 256;
  return [parts[0], parts[1], parts[2], value].join('.');
}

export function deriveHostPath(mainIp: string, host: HostId, kind: 'inventory' | 'repository' = 'inventory'): string {
  const ip = deriveHostIp(mainIp, host);
  if (!ip) return '';
  return kind === 'repository' ? `\\\\${ip}\\PxRepository` : `\\\\${ip}\\PxInventory`;
}

export interface ModelCandidate {
  name: string;
  hosts: HostId[];
  /** Creation time of the model folder (epoch ms UTC); absent when the share
   * does not report one. */
  created_ms?: number;
  /** Comma-joined Vision version folders ("2.0", "2.0, 3.5"). Filled by the
   * repository ("Product") scan only - the inventory tree has no version level. */
  resolution?: string;
}

/** Which share tree a scan walks: the inspection station's model list
 * (`PxInventory`) or the Vision software's product list (`PxRepository`). */
export type ScanKind = 'inventory' | 'repository';

/** One share to scan, when the paths are not the machine's own inventory
 * shares (e.g. the per-host `PxRepository` roots of the Product tab). */
export interface ScanTarget {
  host: HostId;
  path: string;
}

export interface HostSources {
  model_name: string;
  host: HostId;
  side: 'TOP' | 'BOTTOM';
  light_spec_xml: string;
  inspection_specs: Array<{ light: string; xml: string }>;
  spec_parameter_xml?: string;
  spec_tree_node_xml?: string;
}

export interface TeachSelection {
  host: HostId;
  light: number;
  group: string;
  parent: string;
  node: string;
  color: string;
}

// ---- Center stage MEDIAN image ----

export interface MedianImage {
  side: 'TOP' | 'BOTTOM';
  host: 'FM1' | 'BM';
  /** Version folder the tif was found in ("2.0" on FM1, "3.5" on BM, or a fallback sibling). */
  version: string;
  path: string;
  /** Original pixel dimensions of the tif on disk. */
  width: number;
  height: number;
  /** Downscaled preview as base64 JPEG. */
  data: string;
}

export interface MedianImageOutcome {
  /** "found" when a preview is available, "missing" when this side simply has no median image. */
  status: 'found' | 'missing';
  image: MedianImage | null;
  /** Share locations that were probed while the image was missing. */
  searched: string[];
}

// ---- GV measurement (exact stats over the full-resolution median tif) ----

/** Rectangle to measure, in ORIGINAL tif pixels (fractional ok, clamped backend-side). */
export interface GvRoiIn {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MedianGvStats {
  /** Rectangle actually measured (clamped, original pixels). */
  roi: { x: number; y: number; w: number; h: number };
  mean: number;
  /** Population standard deviation. */
  std: number;
  min: number;
  max: number;
  pixels: number;
  /** 256 raw luma counts for measuring clipped teaching light locally. */
  histogram?: number[];
}

export interface MedianGvOutcome {
  status: 'found' | 'missing';
  stats: MedianGvStats | null;
  /** Full tif dimensions (0/0 while missing). */
  width: number;
  height: number;
  path: string;
  searched: string[];
}

// ---- Stage ROI boxes (UI drawing; algorithm seam reserved, Plan 05 D5) ----

/** The geometric kinds a drawn ROI can take. Rectangle is the historical
 * kind; ellipse and polygon boxes carry the same preview-px bounding box. */
export type RoiShape = 'rect' | 'ellipse' | 'polygon';

/** A user-drawn ROI on the stage preview. x/y/w/h are preview-image
 * pixels (x/y = top-left); map to full-res tif pixels with roiToOriginalPixels
 * before handing boxes to an algorithm. Ellipse uses the bounds as its
 * axes; polygon keeps its vertices in `points` (flat x,y preview px) and the
 * bounds only summarize them. */
export interface RoiRect {
  id: string;
  /** Auto number ("ROI-1", ...). The future algorithm wiring gives it a meaning. */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Absent on boxes saved before shapes existed - treated as 'rect'. */
  shape?: RoiShape;
  /** Polygon vertices, flat [x0,y0,x1,y1,...] in preview px (shape === 'polygon'). */
  points?: number[];
}

/** Storage layout of ui/roi-boxes.json: imageKey -> boxes drawn on that image. */
export type RoiBoxFile = Record<string, RoiRect[]>;

/**
 * Preview-space ROI -> original tif pixels. This is the reserved Plan 05 D5
 * seam ("ROI 精修"), now wired: `alignRunRois` converts the drawn boxes with
 * it before invoking the `align_run_rois` command (fiducial-style matching in
 * src-tauri/src/align/fiducial.rs).
 */
export function roiToOriginalPixels(
  roi: RoiRect,
  original: { width: number; height: number },
  preview: { width: number; height: number },
): RoiRect {
  const sx = preview.width > 0 ? original.width / preview.width : 1;
  const sy = preview.height > 0 ? original.height / preview.height : 1;
  return {
    ...roi,
    x: Math.round(roi.x * sx),
    y: Math.round(roi.y * sy),
    w: Math.round(roi.w * sx),
    h: Math.round(roi.h * sy),
  };
}

// ---- ALIGN tab (offline alignment simulation, Plan 05 M0) ----

/** One probed data source: a missing MasterData is an everyday case, not an error. */
export interface AlignSourcePath {
  status: 'found' | 'missing';
  path: string | null;
  version: string | null;
  /** Share locations probed while the source was missing. */
  searched: string[];
}

export interface AlignSourceProbe {
  side: 'TOP' | 'BOTTOM';
  model_name: string;
  median: AlignSourcePath;
  master_data: AlignSourcePath;
}

// ---- ALIGN M1: synthetic case generator (Plan 05) ----

/** The injected geometric truth: input = template warped by this (working-grid px). */
export interface AlignTruthTransform {
  tx_px: number;
  ty_px: number;
  theta_deg: number;
  scale: number;
}

/** Degradations applied on top of the warp. Field names mirror the Rust serde names. */
export interface AlignCaseParams {
  noise_sigma: number;
  gain: number;
  offset: number;
  blur_sigma: number;
  /** Fraction of the canvas covered by the synthetic occluder (0 = none). */
  occlusion_ratio: number;
  /** Integer downsample factor of the base image; 0 = auto-fit to the 2K grid. */
  downsample: number;
}

/** One reproducible case: seed + params + truth + the stored file names. */
export interface AlignCase {
  schema_version: number;
  case_id: string;
  seed: number;
  model_name: string;
  side: 'TOP' | 'BOTTOM';
  template_path: string;
  input_path: string;
  truth: AlignTruthTransform;
  params: AlignCaseParams;
}

export interface CaseImagePreview {
  width: number;
  height: number;
  /** Base64 JPEG of the working-grid image. */
  data: string;
}

export interface AlignCaseOutcome {
  case: AlignCase;
  /** Absolute path of the written case folder in the app data library. */
  case_dir: string;
  template: CaseImagePreview;
  input: CaseImagePreview;
}

// ---- ALIGN M2: phase-correlation run over a case ----

/** What an aligner reports. Translations in working-grid px; angles in degrees. */
export interface AlignResult {
  aligner: string;
  tx_px: number;
  ty_px: number;
  theta_deg: number;
  scale: number;
  score: number;
  psr: number;
  ok: boolean;
  elapsed_ms: number;
  message: string;
}

/** Solver vs truth. The frontend keeps this behind the truth-reveal gate. */
export interface TruthComparison {
  tx_error_px: number;
  ty_error_px: number;
  total_px: number;
  /** False when the truth carries rotation/scale that M2 cannot see. */
  translation_only: boolean;
}

export interface AlignRunOutcome {
  case: AlignCase;
  result: AlignResult;
  comparison: TruthComparison;
}

// ---- ALIGN M4: pipeline step-through artifacts ----

export interface StepImage {
  label: string;
  width: number;
  height: number;
  /** Base64 JPEG preview of the artifact. */
  data: string;
}

export interface StepOut {
  /** Stable id the explanation texts key on ("preprocess" | "phase" | "ecc" | "result"). */
  id: string;
  title: string;
  subtitle: string;
  /** (label, value) pairs. */
  numbers: Array<[string, string]>;
  /** The ECC correlation-per-iteration curve (step "ecc" only). */
  curve: number[] | null;
  images: StepImage[];
}

// ---- ALIGN M5: fiducial verification + confidence verdict ----

export interface FiducialConfig {
  num_fiducials: number;
  patch: number;
  local_search_px: number;
  ncc_min: number;
  psr_ok: number;
  ncc_ok: number;
  ncc_ng: number;
  resid_ok_px: number;
  resid_ng_px: number;
  scale_tol: number;
  ransac_inlier_px: number;
  min_matches: number;
}

export interface FiducialMatch {
  template: [number, number];
  input: [number, number];
  ncc: number;
  residual_px: number;
  inlier: boolean;
}

export interface DistanceConsistency {
  mean_ratio: number;
  std_ratio: number;
  scale_flagged: boolean;
}

export interface FiducialVerdict {
  /** "ok" | "manual" | "ng" */
  level: string;
  reasons: string[];
}

export interface FiducialReport {
  matches: FiducialMatch[];
  /** Umeyama similarity fit over the inliers (template -> input). */
  fit: { tx: number; ty: number; theta_deg: number; scale: number };
  residual_rms: number;
  mean_ncc: number;
  psr: number;
  distance: DistanceConsistency;
  inliers: number;
  verdict: FiducialVerdict;
}

// ---- user-drawn ROI alignment (画定位框) ----

/** Per-box result - one entry per drawn box, in input order. A box that
 * found nothing stays in the list with `located: false` (and `input` holding
 * only the prior prediction) so the UI can paint it red. */
export interface RoiMatch {
  name: string;
  /** Box center on the template / located position on the input (grid px). */
  template: [number, number];
  input: [number, number];
  /** Box size on the working grid (what the outline overlay draws). */
  w: number;
  h: number;
  ncc: number;
  residual_px: number;
  inlier: boolean;
  located: boolean;
}

export interface RoiReport {
  matches: RoiMatch[];
  /** Umeyama similarity fit over the located inliers (template -> input). */
  fit: { tx: number; ty: number; theta_deg: number; scale: number };
  residual_rms: number;
  mean_ncc: number;
  psr: number;
  distance: DistanceConsistency;
  inliers: number;
  verdict: FiducialVerdict;
}

/** Stateless result of one 画定位框 exercise: freshly synthesized pair plus
 * the fit and its truth comparison. Nothing is persisted backend-side. */
export interface RoiAlignOutcome {
  base: string;
  grid_width: number;
  grid_height: number;
  template: CaseImagePreview;
  input: CaseImagePreview;
  truth: AlignTruthTransform;
  comparison: TruthComparison;
  report: RoiReport;
  elapsed_ms: number;
}

// ---- Metal align simulation (median + seed-displaced Metal, Plan 07 C) ----

export interface MetalSimAligned {
  /** Honest verdict: true only when the ROI report level is "ok". */
  success: boolean;
  /** Umeyama similarity fit (displaced Metal -> median), grid px. */
  fit: { tx: number; ty: number; theta_deg: number; scale: number };
  report: RoiReport;
  preview: string;
  preview_width: number;
  preview_height: number;
}

export interface MetalSimTruth {
  /** The ground-truth correction (inverse of the simulated offset). */
  fit: { tx: number; ty: number; theta_deg: number; scale: number };
  preview: string;
  preview_width: number;
  preview_height: number;
}

export interface MetalSimOutcome {
  seed: number;
  /** The simulated misalignment (grid px) - display/debug only. */
  offset: { tx: number; ty: number; theta_deg: number; scale: number };
  grid_width: number;
  grid_height: number;
  preview: string;
  preview_width: number;
  preview_height: number;
  /** Present only when ROIs were supplied - the alignment attempt. */
  aligned: MetalSimAligned | null;
  /** Present only when forceTruth was set - the ground-truth correction. */
  truth: MetalSimTruth | null;
}

// GV brightness targets are measured and typed by the user; no config file carries them.
export interface GvValueSet {
  Red: string;
  Green: string;
  Blue: string;
}

// host -> pageIndex (0-based) -> row label (AU/OSP/SR/Space) -> per-camera-colour value.
export type GvValues = Record<string, Record<string, Record<string, GvValueSet>>>;

export interface StorageConfig {
  backend: 'local' | 'mongodb' | 'firestore';
  mongodb?: { url: string; database: string };
}

export interface MigrationReport {
  migrated: string[];
  failed: Array<{ key: string; reason: string }>;
  targetDocuments: number;
}

// ---- stored model records ----

export interface StoredModelRecord {
  schemaVersion: 2;
  machine: Pick<Machine, 'id' | 'name'>;
  modelName: string;
  collectedAt: string;
  hosts: Record<HostId, StoredHostRecord>;
}

export interface StoredHostRecord {
  rootPath: string;
  side: 'TOP' | 'BOTTOM';
  lightSpec: unknown;
  alignment: HostAlignment;
  parameterDictionary: Record<string, string>;
  treeDictionary: { gp: Record<string, string>; p: Record<string, string>; c: Record<string, string> };
  inspectionSpecs: Record<string, { groups: InspectionGroup[] }>;
}

interface NodeInfo {
  name: string;
  color: string;
}

interface NodeDictionaries {
  gp: Record<string, NodeInfo>;
  p: Record<string, NodeInfo>;
  c: Record<string, NodeInfo>;
}

export class AppService {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['Page', 'Channel', 'MASTER', 'SUBMASTER', 'INSPECTION', 'string', 'node'].includes(name)
  });

  // All persistence goes through the document-store seam (default: local JSON
  // document database; MongoDB later only swaps this client).
  private readonly documents: DocumentStoreClient = createDocumentStore();
  private readonly modelCache = new Map<string, StoredModelRecord>();

  async getMachines(): Promise<Machine[]> {
    try {
      const data = await this.documents.read('machines.json');
      return data ? JSON.parse(data) as Machine[] : [];
    } catch {
      return [];
    }
  }

  async saveMachines(machines: Machine[]): Promise<void> {
    await this.documents.write('machines.json', JSON.stringify(machines, null, 2));
  }

  getHostPath(machine: Machine, host: HostId): string {
    return machine[`${host.toLowerCase()}_path` as keyof Machine] as string;
  }

  getRepositoryPath(machine: Machine, host: HostId): string {
    return machine[`${host.toLowerCase()}_repository_path` as keyof Machine] as string | undefined ?? '';
  }

  async scanModels(machine: Machine, options?: { kind?: ScanKind; targets?: ScanTarget[] }): Promise<ModelCandidate[]> {
    return invoke<ModelCandidate[]>('scan_machine_models', {
      machine,
      kind: options?.kind ?? 'inventory',
      targets: options?.targets ?? null,
    });
  }

  /** The per-host `PxRepository` roots of a machine, built the same way the
   * MEDIAN loader builds them (explicit field, else the derived UNC path). */
  repositoryTargets(machine: Machine): ScanTarget[] {
    return (['FM1', 'FM2', 'BM'] as HostId[]).map((host) => ({
      host,
      path: this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository'),
    }));
  }

  /**
   * Loads the model's MEDIAN strip image for the center stage: TOP from FM1's
   * PxRepository share, BOTTOM from BM's (FM2 is skipped). The backend decodes
   * the huge tif on the worker pool and returns a downscaled JPEG preview;
   * a missing image comes back as status "missing", not as a rejection.
   */
  loadMedianImage(machine: Machine, modelName: string, side: 'TOP' | 'BOTTOM'): Promise<MedianImageOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<MedianImageOutcome>('load_median_image', { machine, repositoryPath, modelName, side });
  }

  /**
   * Measures exact gray-value statistics (mean / std / min / max) over a
   * rectangle of the median tif. `sourcePath` is the tif path the displayed
   * preview came from - when its local snapshot exists the backend measures
   * it with ZERO share access (no credentials, no stat); only a cold cache
   * falls back to resolving and copying from the share.
   */
  measureMedianGv(
    machine: Machine,
    modelName: string,
    side: 'TOP' | 'BOTTOM',
    roi: GvRoiIn | null,
    sourcePath: string,
  ): Promise<MedianGvOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<MedianGvOutcome>('measure_median_gv', { machine, repositoryPath, modelName, side, roi, sourcePath: sourcePath || null });
  }

  /**
   * Probes the ALIGN data foundations for one side: resolves the MEDIAN tif
   * and the MasterData folder paths without decoding any image (M0). Missing
   * sources come back as status "missing", never as a rejection.
   */
  alignProbeSources(machine: Machine, modelName: string, side: 'TOP' | 'BOTTOM'): Promise<AlignSourceProbe> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<AlignSourceProbe>('align_probe_sources', { machine, repositoryPath, modelName, side });
  }

  /**
   * Loads the side's colored Align/ROI render: the SR board body
   * (L01\UNIT_0) in green with the metal marks (GB\Pattern) in yellow,
   * registered via the corner fiducial crosses and display-idealized.
   * TOP = FM1 2.0, BOTTOM = BM 3.5 with sibling-version fallback. The backend
   * silently degrades to the plain grey pattern preview whenever the overlay
   * is not possible (missing UNIT_0, no fiducial crosses) - never a rejection.
   */
  alignLoadOverlay(machine: Machine, modelName: string, side: 'TOP' | 'BOTTOM'): Promise<MedianImageOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<MedianImageOutcome>('align_load_overlay', { machine, repositoryPath, modelName, side });
  }

  /**
   * Align simulation on the median stage: the unit-sized MEDIAN tif with the
   * AlignData Metal marks painted yellow on top at the identity transform
   * (both layers share one grid - what the machine shows after align).
   * Missing median or Metal comes back as status "missing", never a rejection.
   */
  alignLoadMetalMedian(machine: Machine, modelName: string, side: 'TOP' | 'BOTTOM'): Promise<MedianImageOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<MedianImageOutcome>('align_load_metal_median', { machine, repositoryPath, modelName, side });
  }

  /**
   * One metal-align simulation step (Plan 07 C): `rois = null` (re)generates
   * the seed-displaced "pre-align" view; with boxes it also runs the REAL ROI
   * aligner and returns the corrected view plus the honest verdict - badly
   * drawn boxes yield `aligned.success: false` with reasons. `forceTruth`
   * skips the pipeline and corrects by the known offset ("show the answer").
   * ROI coordinates are preview px, which equal the backend's working grid.
   */
  alignMetalSim(
    machine: Machine,
    modelName: string,
    side: 'TOP' | 'BOTTOM',
    seed: number,
    rois: RoiRect[] | null,
    forceTruth = false,
  ): Promise<MetalSimOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<MetalSimOutcome>('align_metal_sim', { machine, repositoryPath, modelName, side, seed, rois, forceTruth });
  }

  /**
   * Generates one synthetic align case from the side's base image ("median"
   * default, or the metal-marks "pattern"): truth warp + degradations, seeded
   * and byte-reproducible. `truth = null` derives it from the seed; a missing
   * base image rejects with the probed share locations.
   */
  alignGenerateCase(
    machine: Machine,
    modelName: string,
    side: 'TOP' | 'BOTTOM',
    seed: number,
    options?: { baseSource?: 'median' | 'pattern'; truth?: AlignTruthTransform | null; params?: AlignCaseParams | null },
  ): Promise<AlignCaseOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    return invoke<AlignCaseOutcome>('align_generate_case', {
      machine,
      repositoryPath,
      modelName,
      side,
      seed,
      baseSource: options?.baseSource ?? 'median',
      truth: options?.truth ?? null,
      params: options?.params ?? null,
    });
  }

  /** Lists the stored cases from the app data library, sorted by id. */
  alignListCases(): Promise<AlignCase[]> {
    return invoke<AlignCase[]>('align_list_cases');
  }

  /** Deletes one case folder from the library. Returns false when absent. */
  alignDeleteCase(caseId: string): Promise<boolean> {
    return invoke<boolean>('align_delete_case', { caseId });
  }

  /**
   * Runs the phase-correlation aligner over a stored case from the library.
   * Only numbers cross the IPC (D3); the truth comparison comes back for the
   * frontend to keep behind its reveal gate.
   */
  alignRun(caseId: string, aligner?: string): Promise<AlignRunOutcome> {
    return invoke<AlignRunOutcome>('align_run', { caseId, aligner: aligner ?? 'ecc' });
  }

  /**
   * Runs the pipeline stage by stage on a stored case and returns each
   * stage's teaching artifacts (preview JPEGs, numbers, the ECC curve).
   * Only previews cross the IPC (D3).
   */
  alignRunSteps(caseId: string): Promise<StepOut[]> {
    return invoke<StepOut[]>('align_run_steps', { caseId });
  }

  /**
   * Fiducial verification (M5): locates distinctive patches around the
   * translation-only prior, fits similarity with Umeyama+RANSAC, and returns
   * the confidence verdict (ok / manual / ng) with per-point scores. The
   * prior inside is the M2 phase solve, so the distance-consistency metric
   * is what exposes scale errors.
   */
  alignVerify(caseId: string, config?: Partial<FiducialConfig>): Promise<FiducialReport> {
    return invoke<FiducialReport>('align_verify', { caseId, config: config ?? null });
  }

  /**
   * 画定位框对齐: the side's base image is synthesized into a fresh exercise
   * (truth warp + degradations), each drawn box is NCC-located around the
   * phase prior and the box centers feed the Umeyama+RANSAC similarity fit,
   * scored against the truth. The boxes arrive in preview px of the CURRENT
   * stage view and are converted to original-tif px here (the reserved
   * roiToOriginalPixels seam, now wired); the backend maps them onto the
   * working grid. A new random seed = a new exercise per call.
   */
  alignRunRois(
    machine: Machine,
    modelName: string,
    side: 'TOP' | 'BOTTOM',
    rois: RoiRect[],
    original: { width: number; height: number },
    preview: { width: number; height: number },
    options?: { baseSource?: 'median' | 'pattern'; seed?: number; truth?: AlignTruthTransform | null },
  ): Promise<RoiAlignOutcome> {
    const host: HostId = side === 'TOP' ? 'FM1' : 'BM';
    const repositoryPath = this.getRepositoryPath(machine, host) || deriveHostPath(machine.main_ip ?? '', host, 'repository');
    const payload = rois
      .map((roi) => roiToOriginalPixels(roi, original, preview))
      .map(({ name, x, y, w, h }) => ({ name, x, y, w, h }));
    return invoke<RoiAlignOutcome>('align_run_rois', {
      machine,
      repositoryPath,
      modelName,
      side,
      baseSource: options?.baseSource ?? appStore.stageMode,
      seed: options?.seed ?? Date.now() % 100000,
      truth: options?.truth ?? null,
      config: null,
      rois: payload,
    });
  }

  async collectAndPersist(machine: Machine, modelName: string): Promise<StoredModelRecord> {
    const sources = await invoke<HostSources[]>('collect_machine_sources', { machine, modelName });
    if (sources.length !== 3) {
      throw new Error('All FM1, FM2, and BM sources must be collected together.');
    }
    // The dictionaries live in every PxInventory root; FM1's copy stands for all hosts.
    const parameterDictionary = this.parseStringDictionary(sources[0].spec_parameter_xml);
    const nodeDictionaries = this.parseNodeDictionaries(sources[0].spec_tree_node_xml);
    const treeDictionary = Object.fromEntries((['gp', 'p', 'c'] as const).map(level => [level,
      Object.fromEntries(Object.entries(nodeDictionaries[level]).map(([id, info]) => [id, info.name]))]));
    const record: StoredModelRecord = {
      schemaVersion: 2,
      machine: { id: machine.id, name: machine.name },
      modelName: sources[0].model_name,
      collectedAt: new Date().toISOString(),
      hosts: Object.fromEntries(sources.map((source) => {
        const lightSpec = this.parser.parse(source.light_spec_xml);
        return [source.host, {
          rootPath: this.getHostPath(machine, source.host),
          side: source.side,
          lightSpec,
          alignment: this.buildAlignment(lightSpec),
          parameterDictionary,
          treeDictionary,
          inspectionSpecs: Object.fromEntries(source.inspection_specs.map(({ light, xml }) =>
            [light, { groups: this.buildInspectionGroups(xml, parameterDictionary, nodeDictionaries) }]))
        }];
      })) as Record<HostId, StoredHostRecord>
    };
    await this.saveModelData(machine.id, record.modelName, record);
    await this.saveActiveSelection({ machineId: machine.id, modelName: record.modelName });
    return record;
  }

  /**
   * Parses a single InspectionSpec.xml with the snapshot's dictionaries, so one
   * file can be loaded into the Calibrate panel without re-collecting the machine.
   * The stored tree dictionary keeps names but not colors; colors are recovered
   * from the node tree already in the snapshot (same machine, same node IDs).
   */
  parseInspectionSpecGroups(xml: string, host: StoredHostRecord): InspectionGroup[] {
    const colors: Record<'gp' | 'p' | 'c', Map<string, string>> = { gp: new Map(), p: new Map(), c: new Map() };
    for (const spec of Object.values(host.inspectionSpecs)) {
      for (const group of spec && typeof spec === 'object' && 'groups' in spec ? spec.groups : []) {
        colors.gp.set(group.id, group.color || colors.gp.get(group.id) || '');
        for (const parent of group.parents ?? []) {
          colors.p.set(parent.id, parent.color || colors.p.get(parent.id) || '');
          for (const child of parent.children ?? []) {
            colors.c.set(child.id, child.color || colors.c.get(child.id) || '');
          }
        }
      }
    }
    const nodes: NodeDictionaries = {
      gp: this.nodeInfosWithColors(host.treeDictionary.gp, colors.gp),
      p: this.nodeInfosWithColors(host.treeDictionary.p, colors.p),
      c: this.nodeInfosWithColors(host.treeDictionary.c, colors.c)
    };
    return this.buildInspectionGroups(xml, host.parameterDictionary, nodes);
  }

  /** Parses a LightSpec.xml and rebuilds the alignment rows shown beside the tree. */
  parseLightSpec(xml: string): { lightSpec: unknown; alignment: HostAlignment } {
    const lightSpec = this.parser.parse(xml);
    return { lightSpec, alignment: this.buildAlignment(lightSpec) };
  }

  private nodeInfosWithColors(names: Record<string, string>, colors: Map<string, string>): Record<string, NodeInfo> {
    return Object.fromEntries(Object.entries(names ?? {}).map(([id, name]) => [id, { name, color: colors.get(id) ?? '' }]));
  }

  async getModelData(machineId: string, modelName: string, force = false): Promise<StoredModelRecord | null> {
    const filename = this.modelFilename(machineId, modelName);
    if (!force) {
      const cached = this.modelCache.get(filename);
      if (cached) return cached;
    } else {
      this.modelCache.delete(filename);
    }
    try {
      const data = await this.documents.read(filename);
      // the record may live under another machine id (a re-added machine gets a
      // new id after an update) - fall back to a by-name search across machines
      const recovered = data ?? (await this.readByModelName(filename));
      if (!recovered) return null;
      const record = JSON.parse(recovered) as StoredModelRecord;
      this.modelCache.set(filename, record);
      return record;
    } catch {
      return null;
    }
  }

  /** Finds the model snapshot by file name under any machine folder. */
  private async readByModelName(filename: string): Promise<string | null> {
    const base = filename.split('/').pop()?.toLowerCase() ?? '';
    if (!base) return null;
    const keys = await this.documents.list('models/');
    const match = keys.find(key => key.split('/').pop()?.toLowerCase() === base);
    return match ? this.documents.read(match) : null;
  }

  async saveModelData(machineId: string, modelName: string, data: StoredModelRecord): Promise<void> {
    const filename = this.modelFilename(machineId, modelName);
    await this.documents.write(filename, JSON.stringify(data));
    this.modelCache.set(filename, data);
  }

  async getActiveSelection(): Promise<{ machineId: string; modelName: string } | null> {
    try {
      const data = await this.documents.read('ui/active-selection.json');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async saveActiveSelection(selection: { machineId: string; modelName: string }): Promise<void> {
    await this.documents.write('ui/active-selection.json', JSON.stringify(selection));
    appStore.activeSelection = selection;
  }

  /** Reset the persisted active selection (Data Collection "Clear"). */
  async clearActiveSelection(): Promise<void> {
    // writing the JSON literal `null` round-trips: getActiveSelection parses it
    // back to null, so no stale selection is restored on restart
    await this.documents.write('ui/active-selection.json', 'null');
    appStore.activeSelection = null;
  }

  get teachSelection(): TeachSelection | null {
    return appStore.teachSelection;
  }

  set teachSelection(value: TeachSelection | null) {
    appStore.teachSelection = value;
    if (value) {
      this.documents.write('ui/teach-selection.json', JSON.stringify(value)).catch(() => {});
    }
  }

  async getTeachSelection(): Promise<TeachSelection | null> {
    if (appStore.teachSelection) return appStore.teachSelection;
    try {
      const data = await this.documents.read('ui/teach-selection.json');
      appStore.teachSelection = data ? JSON.parse(data) as TeachSelection : null;
    } catch {
      appStore.teachSelection = null;
    }
    return appStore.teachSelection;
  }

  async getGvValues(machineId: string, modelName: string): Promise<GvValues> {
    try {
      const data = await this.documents.read(this.gvFilename(machineId, modelName));
      return data ? JSON.parse(data) as GvValues : {};
    } catch {
      return {};
    }
  }

  async saveGvValues(machineId: string, modelName: string, values: GvValues): Promise<void> {
    await this.documents.write(this.gvFilename(machineId, modelName), JSON.stringify(values));
  }

  /** Boxes drawn on one stage image (`machineId|modelName|side|stageMode`). */
  async getRoiBoxes(imageKey: string): Promise<RoiRect[]> {
    try {
      const data = await this.documents.read('ui/roi-boxes.json');
      const file: RoiBoxFile = data ? JSON.parse(data) : {};
      return file[imageKey] ?? [];
    } catch {
      return [];
    }
  }

  async saveRoiBoxes(imageKey: string, rois: RoiRect[]): Promise<void> {
    let file: RoiBoxFile = {};
    try {
      const data = await this.documents.read('ui/roi-boxes.json');
      file = data ? JSON.parse(data) : {};
    } catch {
      file = {};
    }
    if (rois.length === 0) delete file[imageKey];
    else file[imageKey] = rois;
    await this.documents.write('ui/roi-boxes.json', JSON.stringify(file));
  }

  getStorageConfig(): Promise<StorageConfig> {
    return invoke<StorageConfig>('get_storage_config');
  }

  saveStorageConfig(config: StorageConfig): Promise<void> {
    return invoke('set_storage_config', { config });
  }

  testMongoConnection(url?: string, database?: string): Promise<string> {
    return invoke<string>('test_mongo_connection', { url, database });
  }

  migrateLocalToMongo(url?: string, database?: string): Promise<MigrationReport> {
    return invoke<MigrationReport>('migrate_local_to_mongo', { url, database });
  }

  // Firestore settings (project + web API key) are hardcoded in Rust storage.rs
  testFirestoreConnection(): Promise<string> {
    return invoke<string>('test_firestore_connection');
  }

  migrateLocalToFirestore(): Promise<MigrationReport> {
    return invoke<MigrationReport>('migrate_local_to_firestore');
  }

  getLightChannels(record: StoredModelRecord, host: HostId, pageIndex: number): Array<{ index: number; value: number; angle: number; color: string; enable: boolean }> {
    const lightSet = (record.hosts[host]?.lightSpec as any)?.pixel?.Light_Setting?.LightSet;
    const pages = Array.isArray(lightSet?.Page) ? lightSet.Page : [];
    const page = pages[pageIndex] ?? pages.find((item: any) => Number(item?.['@_Index']) === pageIndex);
    const channels = Array.isArray(page?.Channel) ? page.Channel : [];
    const colors: Record<string, string> = { W: 'White', B: 'Blue', G: 'Green', R: 'Red' };
    return channels.map((channel: Record<string, string>, index: number) => ({
      index: Number(channel['@_Index'] ?? index) + 1,
      value: Number(channel['@_Value'] ?? 0),
      angle: Number(channel['@_Angle'] ?? 0),
      color: colors[channel['@_Color']] ?? channel['@_Color'] ?? '',
      enable: channel['@_Enable'] === '1'
    }));
  }

  // SpecParameter.xml packs one <stringpack> per language. The dictionary must join every
  // pack (English first, so its text wins) instead of reading the first element only.
  private parseStringDictionary(xml?: string): Record<string, string> {
    if (!xml) return {};
    const packs = this.asArray<Record<string, unknown>>(this.parser.parse(xml)?.pixel?.stringpack);
    const englishFirst = [...packs].sort((a, b) =>
      Number(/english/i.test(String(b?.['@_LangName'] ?? ''))) - Number(/english/i.test(String(a?.['@_LangName'] ?? ''))));
    const dictionary: Record<string, string> = {};
    for (const pack of englishFirst) {
      for (const item of this.asArray<Record<string, string>>(pack?.['string'] as Record<string, string>)) {
        const key = item?.['@_ParamKey'];
        if (key !== undefined && dictionary[key] === undefined) dictionary[key] = item?.['@_Text'] ?? '';
      }
    }
    return dictionary;
  }

  private parseNodeDictionaries(xml?: string): NodeDictionaries {
    const pixel = xml ? this.parser.parse(xml)?.pixel ?? {} : {};
    const read = (group: unknown): Record<string, NodeInfo> => Object.fromEntries(
      this.asArray<Record<string, unknown>>(group as Record<string, unknown>).flatMap((entry) =>
        this.asArray<Record<string, string>>(entry?.['node'] as Record<string, string>).map((node) =>
          [String(node?.['@_ID']), { name: String(node?.['@_Name'] ?? ''), color: String(node?.['@_Color'] ?? '') }])));
    return { gp: read(pixel?.gpnode), p: read(pixel?.pnode), c: read(pixel?.cnode) };
  }

  private buildAlignment(lightSpec: unknown): HostAlignment {
    const lightSet = (lightSpec as any)?.pixel?.Light_Setting?.LightSet;
    const pages = this.asArray(lightSet?.Page);
    const lightCount = Math.max(pages.length, 1);
    const global = Array.from({ length: lightCount }, (_, index) => ({ light: index + 1, channel: 'Red' }));
    return { global, sr: [{ light: lightCount, channel: 'Red' }] };
  }

  private buildInspectionGroups(xml: string, parameterDictionary: Record<string, string>, nodes: NodeDictionaries): InspectionGroup[] {
    const pixel = this.parser.parse(xml)?.pixel ?? {};
    return this.asArray(pixel.GPNODE).map((gpnode: Record<string, any>) => {
      const gpInfo = nodes.gp[gpnode['@_ID']];
      return {
        id: String(gpnode['@_ID']),
        name: gpInfo?.name || `G${gpnode['@_ID']}`,
        color: gpInfo?.color ?? '',
        parents: this.asArray(gpnode['PNODE']).map((pnode: Record<string, any>) => {
          const pnInfo = nodes.p[pnode['@_ID']];
          return {
            id: String(pnode['@_ID']),
            name: pnInfo?.name || `P${pnode['@_ID']}`,
            color: pnInfo?.color ?? '',
            checked: pnode['@_NodeCheck'] === '1',
            children: this.asArray(pnode['CNODE']).map((cnode: Record<string, any>) => {
              const cnInfo = nodes.c[cnode['@_ID']];
              return {
                id: String(cnode['@_ID']),
                name: cnInfo?.name || `C${cnode['@_ID']}`,
                color: cnInfo?.color ?? '',
                checked: cnode['@_NodeCheck'] === '1',
                parameters: this.buildParameters(cnode, parameterDictionary)
              };
            })
          };
        })
      };
    });
  }

  private buildParameters(cnode: Record<string, any>, parameterDictionary: Record<string, string>): InspectionParameter[] {
    const parameters: InspectionParameter[] = [];
    for (const kind of ['MASTER', 'SUBMASTER', 'INSPECTION'] as const) {
      for (const item of this.asArray(cnode[kind]) as Array<Record<string, string>>) {
        const key = String(item?.['@_ParamKey'] ?? '');
        parameters.push({
          kind,
          key,
          name: parameterDictionary[key] ?? '',
          controlType: Number(item?.['@_ControlType'] ?? 0),
          specGroup: Number(item?.['@_SpecGroup'] ?? 0),
          values: Object.fromEntries(Object.entries(item ?? {})
            .filter(([attribute]) => /^@_(Val|MinVal|MaxVal)/.test(attribute))
            .map(([attribute, value]) => [attribute.slice(2), String(value)]))
        });
      }
    }
    return parameters;
  }

  // Mirrors the Rust collector's canonical_model_name (uppercase, no -00 suffix)
  // so lookups keep matching whatever the user typed.
  private canonicalModelName(name: string): string {
    return canonicalModelName(name);
  }

  private modelFilename(machineId: string, modelName: string): string {
    const safe = this.canonicalModelName(modelName).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `models/${machineId}/${safe}.json`;
  }

  private gvFilename(machineId: string, modelName: string): string {
    const safe = this.canonicalModelName(modelName).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `ui/gv/${machineId}/${safe}.json`;
  }

  private asArray<T>(value: T | T[] | undefined | null): T[] {
    return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  }
}

export const appService = new AppService();
