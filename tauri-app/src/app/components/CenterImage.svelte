<script lang="ts">
  import { appService, roiToOriginalPixels, type MedianGvStats, type MedianImage, type RoiRect } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';
  import { applyLightToGvStats, applyLightToRgb, computeLightGains, lightMatrixValues } from '../../lib/light-simulation';
  import { stageApi, type StageSide, type StageTool } from '../../lib/stage-api.svelte';
  import { drawToolFor, type RoiPaletteTool } from '../../lib/roi-tools';
  import RoiOverlay from './RoiOverlay.svelte';
  import RoiToolPalette from './RoiToolPalette.svelte';

  let {
    interactive = true,
    onToolStateChange,
  }: {
    interactive?: boolean;
    onToolStateChange?: (state: { scale: number; drawMode: boolean; measureMode: boolean; rulerMode: boolean; hasImage: boolean; canMeasure: boolean; side: StageSide; metalOn: boolean }) => void;
  } = $props();
  const SIDES: StageSide[] = ['TOP', 'BOTTOM'];

  type StageState =
    | { kind: 'idle'; message: string }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'missing'; searched: string[] }
    | { kind: 'image'; image: MedianImage };

  const idleState = (): StageState => ({ kind: 'idle', message: 'Select a model to display its strip image.' });

  let side = $state<StageSide>('TOP');
  // Both sides load in parallel; each keeps its own state so a slow side
  // never blocks the other and toggling shows whatever has already arrived.
  let states = $state<Record<StageSide, StageState>>({ TOP: idleState(), BOTTOM: idleState() });
  // Same story for the GB Pattern.tif master render (the Align/ROI view):
  // preloaded alongside the median so flipping appStore.stageMode later is
  // instant - the share read and decode already happened while the user was
  // still working in the TEACH tree.
  let patterns = $state<Record<StageSide, StageState>>({ TOP: idleState(), BOTTOM: idleState() });
  // And for the median+Metal align simulation (median mode only, on demand -
  // unlike the pattern it is a what-if view, not the everyday landing view).
  let metals = $state<Record<StageSide, StageState>>({ TOP: idleState(), BOTTOM: idleState() });
  let metalOn = $state(false);
  // Sim session: the seed pins the displaced view, the verdict carries the
  // align attempt's honest outcome (ok / manual / ng with reasons), and
  // simOffset is the last generated misalignment (shown in the toolbar).
  let simSeed = $state(0);
  let simBusy = $state(false);
  let alignedOn = $state(false);
  let simVerdict = $state<{ success: boolean; text: string } | null>(null);
  let simOffset = $state<{ tx: number; ty: number; theta_deg: number } | null>(null);

  const stage = $derived(states[side]);
  const pattern = $derived(patterns[side]);
  const metal = $derived(metals[side]);
  const view = $derived(
    appStore.stageMode === 'pattern' ? pattern : metalOn ? metal : stage,
  );
  const lightGains = $derived(computeLightGains(appStore.lightSimulation.pages, appStore.lightSimulation.enabled));
  const displayChannel = $derived(appStore.lightSimulation.displayChannel);
  const lightMatrix = $derived(lightMatrixValues(lightGains, displayChannel));
  // The stage follows what the user is picking in Data Collection (published
  // immediately, no collect needed); activeSelection is only the fallback.
  const target = $derived(appStore.stageTarget ?? appStore.activeSelection);
  const machine = $derived(appStore.machines.find((item) => item.id === target?.machineId) ?? null);

  // The stage is keep-alive: finished loads are cached per machine|model|side
  // so toggling back never re-reads the (potentially slow) share. The LRU cap
  // bounds resident memory: each entry is a multi-megabyte base64 JPEG and the
  // webview decodes the displayed one into a ~40 MB bitmap, so 4 entries per
  // cache keeps the worst case (median + pattern caches) around ~60 MB. The
  // caches are dropped whenever the target identity changes.
  const CACHE_LIMIT = 4;
  const cache = new Map<string, StageState>();
  const patternCache = new Map<string, StageState>();
  let cachedFor = '';
  const requestSeq: Record<StageSide, number> = { TOP: 0, BOTTOM: 0 };
  const patternSeq: Record<StageSide, number> = { TOP: 0, BOTTOM: 0 };
  const metalSeq: Record<StageSide, number> = { TOP: 0, BOTTOM: 0 };

  // One $effect drives all reloads: the target (machine + model) and the
  // machine list filling in at startup. Both sides are launched concurrently;
  // per-side sequence numbers drop stale responses.
  $effect(() => {
    const machineId = target?.machineId ?? '';
    const modelName = target?.modelName ?? '';
    const identity = `${machineId}|${modelName}`;
    if (cachedFor !== identity) {
      cache.clear();
      patternCache.clear();
      cachedFor = identity;
      side = 'TOP';
      appStore.stageMode = 'median';
      metalOn = false;
      resetZoom();
      dragging = false;
      paletteTool = 'pointer';
      natW = 0;
      natH = 0;
      roiCount = 0;
      roiHasSelection = false;
      states = { TOP: idleState(), BOTTOM: idleState() };
      patterns = { TOP: idleState(), BOTTOM: idleState() };
      metals = { TOP: idleState(), BOTTOM: idleState() };
      simSeed = 0;
      simVerdict = null;
      simOffset = null;
      alignedOn = false;
      simBusy = false;
      clearReadout();
      measureMode = false;
      lastMeasuredStats = null;
      measuredStats = {};
      measureVerdict = null;
      resetRuler();
    }
    for (const wanted of SIDES) void load(wanted, machineId, modelName);
    // The overlay preloads for the ACTIVE side only: each layer pair is
    // ~24 MB over the share, and preloading both sides doubled the model-pick
    // traffic for an image the user may never open. Toggling the side loads
    // the other one on demand (see the effect below).
    void loadPattern(side, machineId, modelName);
  });

  // Side toggle (or first load after identity change): fetch the overlay for
  // whichever side is now active if it is not cached yet. loadPattern is
  // sequence-guarded, so double fires are harmless.
  $effect(() => {
    const machineId = target?.machineId ?? '';
    const modelName = target?.modelName ?? '';
    if (machineId && modelName) void loadPattern(side, machineId, modelName);
  });

  // Metal align simulation loads on demand: only while the toggle is on in
  // the median view (a side flip or a toggle-on triggers the fetch).
  $effect(() => {
    const machineId = target?.machineId ?? '';
    const modelName = target?.modelName ?? '';
    if (metalOn && appStore.stageMode === 'median' && machineId && modelName) {
      void loadMetal(side, machineId, modelName);
    }
  });

  // Switching between the median strip and the Align/ROI pattern resets the
  // viewport - the two images do not share a transform.
  $effect(() => {
    void appStore.stageMode;
    resetZoom();
    clearReadout();
    measureMode = false;
    lastMeasuredStats = null;
    measuredStats = {};
    resetRuler();
    // the case generator only exists in the Align/ROI view
    if (appStore.stageMode !== 'pattern') labOpen = false;
  });

  // ---- ALIGN M1: synthetic case generator drawer ----
  let labOpen = $state(false);

  // ---- ROI drawing (UI-only; the algorithm seam lives in lib/service.ts) ----
  // Boxes are keyed per displayed image: machine|model|side|median|pattern.
  // The reusable ROI palette owns the active tool; drawMode (the stage cursor /
  // pan rules) is derived from it, so the stage and the overlay never disagree.
  let paletteTool = $state<RoiPaletteTool>('pointer');
  const overlayTool = $derived(drawToolFor(paletteTool));
  const drawMode = $derived(overlayTool !== 'select');
  let natW = $state(0); // preview natural dims, published by the img onload
  let natH = $state(0);
  let viewW = $state(0); // stage viewport size, tracked for the contain fit
  let viewH = $state(0);
  let roiCount = $state(0);
  let roiHasSelection = $state(false);
  let roiOverlay = $state<ReturnType<typeof RoiOverlay> | null>(null);
  const roiKey = $derived(
    target
      ? `${target.machineId}|${target.modelName}|${side}|${appStore.stageMode}${metalOn ? '|metal' : ''}`
      : '',
  );

  // ---- GV hover readout (preview-sampled, approximate) ----
  // The readout samples the original preview through an offscreen canvas and
  // applies the same channel gains as the visible light overlay. The older
  // teaching tone sliders remain display-only, as before.

  const READOUT_WINDOW = 32; // preview px of the GV averaging window around the cursor
  let readoutCtx: CanvasRenderingContext2D | null = null;
  let readoutRaf = 0;
  let readoutPending: { clientX: number; clientY: number } | null = null;
  let lastReadoutPoint: { clientX: number; clientY: number } | null = null;

  /** Copies the freshly loaded preview into an offscreen canvas for pixel
   * reads (data URI = same-origin, so getImageData stays allowed). One canvas
   * at a time (~40 MB), rebuilt by the img onload on every view swap. */
  function buildReadoutCanvas(): void {
    readoutCtx = null;
    if (!imgEl || natW === 0 || natH === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = natW;
    canvas.height = natH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(imgEl, 0, 0);
    readoutCtx = ctx;
  }

  function clearReadout(): void {
    if (readoutRaf) cancelAnimationFrame(readoutRaf);
    readoutRaf = 0;
    readoutPending = null;
    lastReadoutPoint = null;
    appStore.stageReadout = null;
  }

  /** rAF-throttled hover sample: cursor -> preview px -> RGB + GV window
   * stats, published in ORIGINAL strip pixels for the App.svelte status bar. */
  function scheduleReadout(event: PointerEvent): void {
    if (view.kind !== 'image' || !readoutCtx || !imgEl) return;
    lastReadoutPoint = { clientX: event.clientX, clientY: event.clientY };
    readoutPending = lastReadoutPoint;
    if (!readoutRaf) readoutRaf = requestAnimationFrame(applyReadout);
  }

  function applyReadout(): void {
    readoutRaf = 0;
    const pending = readoutPending;
    readoutPending = null;
    const image = view.kind === 'image' ? view.image : null;
    if (!pending || !image || !imgEl || !readoutCtx || natW === 0 || natH === 0) return;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = ((pending.clientX - rect.left) / rect.width) * natW;
    const py = ((pending.clientY - rect.top) / rect.height) * natH;
    if (px < 0 || py < 0 || px >= natW || py >= natH) {
      appStore.stageReadout = null; // cursor left the picture
      return;
    }
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    const rawCenter = readoutCtx.getImageData(cx, cy, 1, 1).data;
    const center = applyLightToRgb([rawCenter[0], rawCenter[1], rawCenter[2]], lightGains, displayChannel);
    const half = READOUT_WINDOW / 2;
    const x0 = Math.max(0, cx - half);
    const y0 = Math.max(0, cy - half);
    const w = Math.min(natW, x0 + READOUT_WINDOW) - x0;
    const h = Math.min(natH, y0 + READOUT_WINDOW) - y0;
    const pixels = readoutCtx.getImageData(x0, y0, w, h).data;
    let sum = 0;
    let sumSq = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const rgb = applyLightToRgb([pixels[index], pixels[index + 1], pixels[index + 2]], lightGains, displayChannel);
      const value = displayChannel === 'RGB' ? 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] : rgb[0];
      sum += value;
      sumSq += value * value;
    }
    const count = w * h;
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    appStore.stageReadout = {
      width: image.width,
      height: image.height,
      x: Math.round(px * (image.width / natW)),
      y: Math.round(py * (image.height / natH)),
      r: center[0],
      g: center[1],
      b: center[2],
      avgGv: mean,
      stdGv: Math.sqrt(variance),
    };
  }

  // A light slider can change while the cursor stays still. Re-run the last
  // sampled point so the status bar follows the composed image immediately.
  $effect(() => {
    void lightGains.red;
    void lightGains.green;
    void lightGains.blue;
    void displayChannel;
    if (!lastReadoutPoint || !readoutCtx || !imgEl || readoutRaf) return;
    readoutPending = lastReadoutPoint;
    readoutRaf = requestAnimationFrame(applyReadout);
  });

  // ---- exact ROI measurement (full-resolution tif, source of truth) ----

  // The in-flight/queue flags are deliberately PLAIN (non-reactive): an earlier
  // version read a $state busy flag from the scheduler and the scheduler fed
  // itself - an endless ~10ms invoke loop with the verdict frozen on "测量中…"
  // (reproduced live and confirmed in the backend log before this fix).
  // measureBusy is $state only so the elapsed-time ticker can show progress.
  let measureBusy = $state(false); // ticker only - never read by the scheduler
  let measureInFlight = false;
  let measureVerdict = $state<{ ok: boolean; text: string } | null>(null);
  type MeasuredStats = MedianGvStats;
  let lastMeasuredStats = $state<MeasuredStats | null>(null);
  // Per-box measurement result keyed by roi id: shown INSIDE each box label,
  // like the machine's on-image GV readout. Stored as raw stats so a light /
  // channel change recomposes every visible box live without another read.
  let measuredStats = $state<Record<string, MeasuredStats>>({});
  const measuredLabels = $derived.by(() => {
    const labels: Record<string, string> = {};
    for (const [id, stats] of Object.entries(measuredStats)) {
      labels[id] = String(Math.round(applyLightToGvStats(stats, lightGains, displayChannel).mean));
    }
    return labels;
  });

  // A different displayed image means a different box group: drop the cached
  // GV so a stale value can never be painted onto another image's box.
  $effect(() => {
    void roiKey;
    measuredStats = {};
  });
  // Measure mode is the whole flow: clicking the button enters box drawing on
  // the spot and every finished box measures AUTOMATICALLY - no pre-drawn
  // selection for the user to discover (the disabled-button version was
  // unclickable and said nothing, which read as "broken").
  let measureMode = $state(false);

  function toggleMeasureMode(): void {
    measureMode = !measureMode;
    // Entering GV lands on the rectangle tool (drag a box and it measures right
    // away, as before); leaving it hands the pointer back.
    paletteTool = measureMode ? 'add-rect' : 'pointer';
    lastMeasuredStats = null;
    measuredStats = {};
    if (measureMode) { rulerMode = false; resetRuler(); }
    measureVerdict = measureMode
      ? { ok: true, text: '测量模式：直接在图上拖拽拉框，松开即在框内显示 GV（Esc 退出）' }
      : null;
  }

  // The GV rail is the reusable palette, enabled in full. Picking a button
  // switches the overlay tool; the trash acts on the boxes immediately.
  const paletteEnabled: Partial<Record<RoiPaletteTool, boolean>> = {
    pointer: true,
    'add-rect': true,
    'add-ellipse': true,
    'add-polygon': true,
    'delete-rect': true,
    'delete-ellipse': true,
    'delete-polygon': true,
    'delete-roi': true,
  };

  function selectPaletteTool(tool: RoiPaletteTool): void {
    if (tool === 'delete-roi') {
      if (roiHasSelection) roiOverlay?.deleteSelected();
      else if (roiCount > 0) roiOverlay?.clearAll();
      return;
    }
    paletteTool = tool;
  }

  // Leaving the stage (another tab) ends GV measurement - and with it its
  // boxes, so they can never bleed into TEACH ROI drawing or another view.
  $effect(() => {
    if (!interactive && measureMode) {
      measureMode = false;
      paletteTool = 'pointer';
    }
  });

  // GV boxes are transient: the moment the mode ends (Esc, tab switch, Metal
  // toggle, model change) they are dropped, and the next entry starts clean
  // for the user to redraw - no stale selection can mix with a fresh one.
  let gvWasOn = false;
  $effect(() => {
    const on = measureMode;
    if (gvWasOn && !on) {
      lastMeasuredStats = null;
      measuredStats = {};
      measureVerdict = null;
      roiOverlay?.clearAll();
    }
    gvWasOn = on;
  });

  // The overlay owns the box list and drives measurement: it asks via onMeasure
  // for every box that needs one (a fresh draw, a re-shaped box, or all boxes
  // when GV mode turns on / the list loads), and the results are painted back
  // into each box label through `measuredLabels`.

  // Esc leaves measure mode (RoiOverlay's own Esc handler drops the draft).
  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!interactive) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.key === 'Escape' && measureMode) {
        measureMode = false;
        paletteTool = 'pointer';
        lastMeasuredStats = null;
        measuredStats = {};
        measureVerdict = null;
      }
      if (event.key === 'Escape' && rulerMode) resetRuler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function measuredText(stats: MeasuredStats): string {
    const composed = applyLightToGvStats(stats, lightGains, displayChannel);
    return `${side === 'TOP' ? 'TOP' : 'BTM'} ${displayChannel} GV${composed.approximate ? '（估算）' : ''}：均值 ${composed.mean.toFixed(2)} · 标准差 ${composed.std.toFixed(2)} · min ${composed.min.toFixed(1)} / max ${composed.max.toFixed(1)}` +
      ` · ROI ${stats.roi.w}×${stats.roi.h} @(${stats.roi.x},${stats.roi.y})`;
  }

  // Repaint the last exact ROI result immediately when a light value changes;
  // no second share read is needed because the raw statistics are cached here.
  $effect(() => {
    void lightGains.red;
    void lightGains.green;
    void lightGains.blue;
    void displayChannel;
    const stats = lastMeasuredStats;
    if (stats) measureVerdict = { ok: true, text: measuredText(stats) };
  });

  // Exact GV stats over the full-resolution tif (the backend decodes a
  // gigapixel strip, so the first box is slow and the rest are cheap - the
  // decoded luma is cached backend-side). Requests are serialized so entering
  // GV mode with several boxes on screen never floods the backend.
  const measureQueue: RoiRect[] = [];

  function measureRoi(roi: RoiRect): void {
    measureQueue.push(roi);
    void pumpMeasure();
  }

  async function pumpMeasure(): Promise<void> {
    if (measureInFlight) return;
    measureInFlight = true;
    try {
      while (measureQueue.length > 0) {
        const roi = measureQueue.shift();
        if (roi) await measureOne(roi);
      }
    } finally {
      measureInFlight = false;
    }
  }

  function dropMeasured(id: string): void {
    if (!(id in measuredStats)) return;
    const next = { ...measuredStats };
    delete next[id];
    measuredStats = next;
  }

  async function measureOne(roi: RoiRect): Promise<void> {
    if (!machine || !target || view.kind !== 'image') return;
    const image = view.image;
    const mapped = roiToOriginalPixels(roi, { width: image.width, height: image.height }, { width: natW, height: natH });
    measureBusy = true;
    measureVerdict = { ok: true, text: '测量中…' };
    try {
      // The snapshot should already be on disk (model pick prefetches it), so
      // this is normally instant. The timeout only ever fires on the cold path
      // - a stalled share must not hang the readout forever.
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        appService.measureMedianGv(machine, target.modelName, side, { x: mapped.x, y: mapped.y, w: mapped.w, h: mapped.h }, image.path),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error('共享 60 秒无响应，已取消等待。请检查 Vision PC 连接后重试（后台仍在预取，稍后重试会变快）')), 60_000);
        }),
      ]);
      clearTimeout(timeoutTimer);
      const stats = outcome.stats;
      if (outcome.status !== 'found' || !stats) {
        dropMeasured(roi.id);
        measureVerdict = { ok: false, text: '共享上没有 MEDIAN tif，无法测量' };
        return;
      }
      measuredStats = { ...measuredStats, [roi.id]: stats };
      lastMeasuredStats = stats;
      measureVerdict = { ok: true, text: measuredText(stats) };
    } catch (caught) {
      measureVerdict = { ok: false, text: caught instanceof Error ? caught.message : String(caught) };
    } finally {
      measureBusy = false;
    }
  }

  // Live elapsed counter while the measurement reads the share: a slow
  // Tailscale read must look like progress, not a dead button.
  $effect(() => {
    if (!measureBusy) return;
    const started = Date.now();
    const timer = setInterval(() => {
      measureVerdict = { ok: true, text: `测量中… 已等待 ${Math.floor((Date.now() - started) / 1000)}s（本地快照缺失，正从共享获取）` };
    }, 1000);
    return () => clearInterval(timer);
  });

  // ---- 量尺（线性距离测量，工具栏第二项）----
  // Drag between two points to draw a red measuring line: the two endpoints
  // carry their coordinates and the middle carries the pixel length, matching
  // the machine's ruler readout. Geometry lives in preview px (the same space
  // as the ROI overlay); the labels report the ORIGINAL strip pixels so the
  // numbers line up with the status-bar WH/XY readout.
  let rulerMode = $state(false);
  let rulerLine = $state<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  let rulerArmed = false; // plain: only read inside pointer handlers

  /** Pointer -> preview px, using the displayed <img> box (which the CSS
   * transform scales), clamped to the picture. */
  function rulerPoint(event: PointerEvent): { x: number; y: number } {
    const rect = imgEl?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0 || natW === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(natW, Math.max(0, ((event.clientX - rect.left) / rect.width) * natW)),
      y: Math.min(natH, Math.max(0, ((event.clientY - rect.top) / rect.height) * natH)),
    };
  }

  function resetRuler(): void {
    rulerArmed = false;
    rulerLine = null;
  }

  // Original-pixel endpoints + length for the on-image labels.
  const rulerReadout = $derived.by(() => {
    const line = rulerLine;
    const image = view.kind === 'image' ? view.image : null;
    if (!line || !image || natW === 0 || natH === 0) return null;
    const a = { x: line.x1 * (image.width / natW), y: line.y1 * (image.height / natH) };
    const b = { x: line.x2 * (image.width / natW), y: line.y2 * (image.height / natH) };
    return { a, b, dist: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  // Screen-space endpoints for the ruler overlay. It lives OUTSIDE the zoomed
  // .stage-inner on purpose: the image is scaled by a CSS transform, so anything
  // inside it (line, nodes, labels) would fatten/grow with the zoom. Mapping the
  // preview points into the viewport keeps the line hairline and the labels 1:1
  // at any zoom level.
  const rulerScreen = $derived.by(() => {
    const line = rulerLine;
    const readout = rulerReadout;
    if (!line || !readout || innerW <= 0 || innerH <= 0 || viewW <= 0) return null;
    const toScreen = (x: number, y: number) => ({
      x: viewW / 2 + ((x / natW) * innerW - innerW / 2) * scale + offsetX,
      y: viewH / 2 + ((y / natH) * innerH - innerH / 2) * scale + offsetY,
    });
    return { a: toScreen(line.x1, line.y1), b: toScreen(line.x2, line.y2), readout };
  });

  /** Exclusive toolbar selection: activating a tool clears the others. `id`
   * is one of the pre-bulb toolbar buttons; `null` drops the selection. */
  export function setActiveTool(id: string | null): void {
    rulerMode = id === 'measure';
    if (!rulerMode) resetRuler();
    if (id !== 'layers') appStore.stageMode = 'median';
    else appStore.stageMode = 'pattern';
    metalOn = id === 'metal' && appStore.stageMode === 'median';
    const wantGv = id === 'gv' && appStore.stageMode === 'median' && !metalOn;
    if (wantGv !== measureMode) {
      measureMode = wantGv;
      lastMeasuredStats = null;
      measuredStats = {};
      measureVerdict = wantGv
        ? { ok: true, text: '测量模式：直接在图上拖拽拉框，松开即在框内显示 GV（Esc 退出）' }
        : null;
    }
    if (!measureMode) paletteTool = id === 'roi' ? 'add-rect' : 'pointer';
    // 适应画布 / 缩放是瞬时动作：选中即执行（滚轮缩放不受工具影响，仍随时可用）。
    if (id === 'fit') resetZoom();
    else if (id === 'zoom-in' || id === 'zoom-out') {
      const rect = stageView?.getBoundingClientRect();
      if (rect) zoomAt(id === 'zoom-in' ? CLICK_STEP : 1 / CLICK_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }

  // ---- teaching tone: display-only brightness(GV) + contrast ----
  // The legacy GV/contrast sliders remain display-only. The filter sits on the
  // <img>, so ROI boxes and labels stay crisp; the new per-channel light
  // overlay is the only display control that changes GV readouts.

  const TONE_GV_BASE = 500;
  let lightGv = $state(TONE_GV_BASE);
  let contrastPct = $state(100);
  const toneAdjusted = $derived(lightGv !== TONE_GV_BASE || contrastPct !== 100);
  const imgFilter = $derived.by(() => {
    const filters = ['url(#afvi-light-filter)'];
    if (appStore.lightSimulation.enabled && toneAdjusted) filters.push(`brightness(${(lightGv / TONE_GV_BASE).toFixed(3)})`, `contrast(${(contrastPct / 100).toFixed(2)})`);
    return `filter: ${filters.join(' ')};`;
  });
  function resetTone(): void {
    lightGv = TONE_GV_BASE;
    contrastPct = 100;
  }

  // The wrapper gets an explicit contain-fit pixel size instead of max-width/
  // max-height percentages: flex percentage clamps do not constrain each other,
  // which lets the wrapper box go off-aspect and misplace the ROI overlay.
  $effect(() => {
    const el = stageView;
    if (!el) return;
    const measure = () => {
      viewW = el.clientWidth;
      viewH = el.clientHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });
  const fitScale = $derived(
    natW > 0 && natH > 0 && viewW > 2 && viewH > 2
      ? Math.min(Math.max(1, viewW - 36) / natW, Math.max(1, viewH - 36) / natH)
      : 0,
  );
  const innerW = $derived(fitScale > 0 ? Math.floor(natW * fitScale) : 0);
  const innerH = $derived(fitScale > 0 ? Math.floor(natH * fitScale) : 0);

  async function load(wanted: StageSide, machineId: string, modelName: string): Promise<void> {
    const seq = ++requestSeq[wanted];
    const key = `${machineId}|${modelName}|${wanted}`;
    const cached = cache.get(key);
    if (cached) {
      // refresh the LRU order
      cache.delete(key);
      cache.set(key, cached);
      states[wanted] = cached;
      return;
    }
    if (!machineId || !modelName) {
      states[wanted] = idleState();
      return;
    }
    if (!machine) {
      states[wanted] = { kind: 'error', message: 'The machine of the active model is not configured - check Machine Configuration.' };
      return;
    }
    states[wanted] = { kind: 'loading' };
    try {
      const outcome = await appService.loadMedianImage(machine, modelName, wanted);
      if (seq !== requestSeq[wanted]) return; // a newer toggle/selection superseded this request
      const result: StageState = outcome.status === 'found' && outcome.image
        ? { kind: 'image', image: outcome.image }
        : { kind: 'missing', searched: outcome.searched };
      cache.set(key, result);
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      states[wanted] = result;
    } catch (caught) {
      if (seq === requestSeq[wanted]) {
        states[wanted] = { kind: 'error', message: caught instanceof Error ? caught.message : String(caught) };
      }
    }
  }

  function selectSide(wanted: StageSide): void {
    if (side === wanted) return;
    side = wanted;
    resetZoom();
  }

  /** Re-probes the share for the current model: the user just dropped tif
   * files into the model folder, and the finished-load caches would otherwise
   * hide them until restart. Drops BOTH stages' cache entries for both sides,
   * then reloads - the per-request sequence numbers discard anything stale. */
  function refresh(): void {
    const machineId = target?.machineId ?? '';
    const modelName = target?.modelName ?? '';
    if (!machineId || !modelName) return;
    for (const wanted of SIDES) {
      cache.delete(`${machineId}|${modelName}|${wanted}`);
      patternCache.delete(`${machineId}|${modelName}|${wanted}`);
    }
    states = { TOP: idleState(), BOTTOM: idleState() };
    patterns = { TOP: idleState(), BOTTOM: idleState() };
    metals = { TOP: idleState(), BOTTOM: idleState() };
    resetZoom();
    clearReadout();
    measureMode = false;
    lastMeasuredStats = null;
    measuredStats = {};
    measureVerdict = null;
    resetRuler();
    for (const wanted of SIDES) void load(wanted, machineId, modelName);
    void loadPattern(side, machineId, modelName);
    if (metalOn && appStore.stageMode === 'median') void loadMetal(side, machineId, modelName);
  }

  /** Preloads the side's colored Align/ROI render (SR green + metal yellow)
   * through the same backend pipeline as the median (decode gate, downscaled
   * JPEG, no raw IPC). The backend falls back to the grey pattern preview
   * when the UNIT_0 layer or the fiducials are unavailable. */
  async function loadPattern(wanted: StageSide, machineId: string, modelName: string): Promise<void> {
    const seq = ++patternSeq[wanted];
    const key = `${machineId}|${modelName}|${wanted}`;
    const cached = patternCache.get(key);
    if (cached) {
      patternCache.delete(key);
      patternCache.set(key, cached);
      patterns[wanted] = cached;
      return;
    }
    if (!machineId || !modelName || !machine) return;
    patterns[wanted] = { kind: 'loading' };
    try {
      const outcome = await appService.alignLoadOverlay(machine, modelName, wanted);
      if (seq !== patternSeq[wanted]) return; // a newer toggle/selection superseded this request
      const result: StageState = outcome.status === 'found' && outcome.image
        ? { kind: 'image', image: outcome.image }
        : { kind: 'missing', searched: outcome.searched };
      patternCache.set(key, result);
      while (patternCache.size > CACHE_LIMIT) {
        const oldest = patternCache.keys().next().value;
        if (oldest === undefined) break;
        patternCache.delete(oldest);
      }
      patterns[wanted] = result;
    } catch (caught) {
      if (seq === patternSeq[wanted]) {
        patterns[wanted] = { kind: 'error', message: caught instanceof Error ? caught.message : String(caught) };
      }
    }
  }

  /** Generates the seed-displaced "pre-align" view (median + offset Metal).
   * The seed pins the offset, so the align call regenerates the exact view
   * the user drew their boxes on. The identity-aligned image stays available
   * in the cache - this session replaces the DISPLAY only. */
  async function loadMetal(wanted: StageSide, machineId: string, modelName: string): Promise<void> {
    const seq = ++metalSeq[wanted];
    if (!machineId || !modelName || !machine) return;
    if (simSeed === 0) simSeed = Date.now() % 1_000_000_007;
    metals[wanted] = { kind: 'loading' };
    alignedOn = false;
    simVerdict = null;
    try {
      const outcome = await appService.alignMetalSim(machine, modelName, wanted, simSeed, null);
      if (seq !== metalSeq[wanted]) return; // a newer toggle/selection superseded this request
      simOffset = outcome.offset;
      metals[wanted] = {
        kind: 'image',
        image: {
          side: wanted,
          host: wanted === 'TOP' ? 'FM1' : 'BM',
          version: `偏移模拟 #${outcome.seed % 10000}`,
          path: '',
          width: outcome.preview_width,
          height: outcome.preview_height,
          data: outcome.preview,
        },
      };
    } catch (caught) {
      if (seq === metalSeq[wanted]) {
        metals[wanted] = { kind: 'error', message: caught instanceof Error ? caught.message : String(caught) };
      }
    }
  }

  /** The align attempt: boxes drawn on the displaced view go through the real
   * M5 ROI pipeline. Success swaps the display to the corrected composite;
   * failure keeps the displaced view and reports the verdict honestly. */
  async function runMetalAlign(): Promise<void> {
    const machineId = target?.machineId ?? '';
    const modelName = target?.modelName ?? '';
    if (!machineId || !modelName || !machine || simBusy) return;
    const rois = await appService.getRoiBoxes(roiKey);
    if (rois.length === 0) {
      simVerdict = { success: false, text: '先画 ROI 框（框选 pad / 标记等两层共见的特征）再对齐' };
      return;
    }
    simBusy = true;
    try {
      const outcome = await appService.alignMetalSim(machine, modelName, side, simSeed, rois);
      const attempt = outcome.aligned;
      if (!attempt) {
        simVerdict = { success: false, text: '后端未返回对齐结果' };
        return;
      }
      const report = attempt.report;
      const unlocated = report.matches.filter((match) => !match.located).map((match) => match.name);
      const unlocatedNote = unlocated.length > 0 ? ` · 未定位:${unlocated.join(',')}(框内特征不足或已出画布,建议重画)` : '';
      const summary =
        `内点 ${report.inliers}/${report.matches.length} · 平均NCC ${report.mean_ncc.toFixed(2)}` +
        (Number.isFinite(report.residual_rms) ? ` · 残差 ${report.residual_rms.toFixed(1)}px` : '');
      if (attempt.success) {
        alignedOn = true;
        const prefix = report.verdict.level === 'manual' ? '对齐成功（需人工确认）' : '对齐成功';
        simVerdict = { success: true, text: `${prefix}（${summary}${unlocatedNote}）` };
        if (metalSeq[side] !== undefined) {
          metalSeq[side] += 1; // invalidate in-flight guards; we own the display now
          metals[side] = {
            kind: 'image',
            image: {
              side,
              host: side === 'TOP' ? 'FM1' : 'BM',
              version: `对齐结果 #${outcome.seed % 10000}`,
              path: '',
              width: attempt.preview_width,
              height: attempt.preview_height,
              data: attempt.preview,
            },
          };
        }
      } else {
        alignedOn = false;
        simVerdict = {
          success: false,
          text: `对齐失败（${report.verdict.level}）：${report.verdict.reasons.join('；')} · ${summary}${unlocatedNote}`,
        };
      }
    } catch (caught) {
      simVerdict = { success: false, text: caught instanceof Error ? caught.message : String(caught) };
    } finally {
      simBusy = false;
    }
  }

  /** "Show me the answer": corrects the displaced Metal by the known
   * simulated offset, bypassing the ROI pipeline (teaching/reveal). */
  async function showTruth(): Promise<void> {
    const machineId = target?.machineId ?? '';
    const modelName = target?.modelName ?? '';
    if (!machineId || !modelName || !machine || simBusy) return;
    simBusy = true;
    try {
      const outcome = await appService.alignMetalSim(machine, modelName, side, simSeed, null, true);
      if (!outcome.truth) {
        simVerdict = { success: false, text: '后端未返回正确答案' };
        return;
      }
      if (metalSeq[side] !== undefined) metalSeq[side] += 1; // own the display
      simOffset = outcome.offset;
      alignedOn = true;
      metals[side] = {
        kind: 'image',
        image: {
          side,
          host: side === 'TOP' ? 'FM1' : 'BM',
          version: `正确答案 #${outcome.seed % 10000}`,
          path: '',
          width: outcome.truth.preview_width,
          height: outcome.truth.preview_height,
          data: outcome.truth.preview,
        },
      };
      const offset = outcome.offset;
      simVerdict = {
        success: true,
        text: `正确答案：真实偏移 tx ${offset.tx.toFixed(1)}px · ty ${offset.ty.toFixed(1)}px · θ ${offset.theta_deg.toFixed(2)}°`,
      };
    } catch (caught) {
      simVerdict = { success: false, text: caught instanceof Error ? caught.message : String(caught) };
    } finally {
      simBusy = false;
    }
  }

  // ---- zoom & pan (CSS transform on the preview <img>, anchor-aware) ----

  const MIN_SCALE = 1;
  const MAX_SCALE = 10;
  const WHEEL_STEP = 1.2;
  const CLICK_STEP = 1.25;

  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragging = $state(false);
  let stageView = $state<HTMLDivElement | null>(null);
  let imgEl = $state<HTMLImageElement | null>(null);
  let dragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  function resetZoom(): void {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
  }

  function clampOffset(value: number, scaled: number, view: number): number {
    if (scaled <= view) return 0; // smaller than the viewport: keep centered
    const limit = (scaled - view) / 2;
    return Math.min(limit, Math.max(-limit, value));
  }

  function applyClamp(): void {
    if (!stageView || !imgEl) return;
    offsetX = clampOffset(offsetX, imgEl.clientWidth * scale, stageView.clientWidth);
    offsetY = clampOffset(offsetY, imgEl.clientHeight * scale, stageView.clientHeight);
  }

  /** Scale by `factor` keeping the point (clientX, clientY) fixed on screen. */
  function zoomAt(factor: number, clientX: number, clientY: number): void {
    if (!stageView || !imgEl) return;
    const rect = stageView.getBoundingClientRect();
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    if (next === scale) {
      applyClamp();
      return;
    }
    const k = next / scale;
    offsetX = px - (px - offsetX) * k;
    offsetY = py - (py - offsetY) * k;
    scale = next;
    applyClamp();
  }

  function onWheel(event: WheelEvent): void {
    if (!interactive || !imgEl) return;
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, event.clientX, event.clientY);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!imgEl) return;
    if (interactive && event.ctrlKey && (event.button === 2 || event.button === 0)) {
      // Ctrl + right button zooms in, Ctrl + left button zooms out
      event.preventDefault();
      zoomAt(event.button === 2 ? CLICK_STEP : 1 / CLICK_STEP, event.clientX, event.clientY);
      return;
    }
    // 量尺在所有 Tab 都可用（实机在 CALIBRATE/REVIEW 上也能量），所以不依赖 interactive。
    if (rulerMode && event.button === 0) {
      const point = rulerPoint(event);
      rulerLine = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
      rulerArmed = true;
      stageView?.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (!interactive) return;
    if (event.button === 0 && event.target === imgEl) {
      // background press outside draw mode: drop the box selection
      // (in draw mode the svg swallows the press, so this never fires)
      roiOverlay?.clearSelection();
    }
    // in draw mode the left button belongs to the ROI overlay; right-drag pans
    // (the pen tool reserves the right button for closing the path)
    const wantsPan = drawMode ? event.button === 2 && overlayTool !== 'polygon' : event.button === 0;
    if (wantsPan && scale > 1) {
      dragging = true;
      dragStart = { x: event.clientX, y: event.clientY, offsetX, offsetY };
      stageView?.setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (rulerArmed && rulerLine) {
      const point = rulerPoint(event);
      rulerLine = { ...rulerLine, x2: point.x, y2: point.y };
    }
    if (!interactive) return;
    scheduleReadout(event);
    if (!dragging) return;
    offsetX = dragStart.offsetX + (event.clientX - dragStart.x);
    offsetY = dragStart.offsetY + (event.clientY - dragStart.y);
    applyClamp();
  }

  function endDrag(): void {
    if (rulerArmed) rulerArmed = false;
    dragging = false;
  }

  function onDblClick(event: MouseEvent): void {
    if (!interactive) return;
    if (event.ctrlKey) return; // rapid Ctrl+click zooming must not reset
    if (drawMode) return; // box gestures run on the overlay, not the viewport
    if (event.target !== imgEl && event.target !== stageView) return; // e.g. a box was double-clicked
    resetZoom();
  }

  function onContextMenu(event: MouseEvent): void {
    if (!interactive) return;
    // This is a tool canvas: while a drawing tool is active the WebView2 menu
    // would cover the image, and the pen tool owns right-click (close path).
    // Ctrl+right-click stays a zoom gesture.
    if (event.ctrlKey || drawMode) event.preventDefault();
  }

  const navigationWindow = $derived.by(() => {
    const width = innerW * scale;
    const height = innerH * scale;
    if (width <= 0 || height <= 0) return { left: 0, top: 0, width: 100, height: 100 };
    return {
      left: Math.max(0, (width - viewW) / 2 - offsetX) / width * 100,
      top: Math.max(0, (height - viewH) / 2 - offsetY) / height * 100,
      width: Math.min(1, viewW / width) * 100,
      height: Math.min(1, viewH / height) * 100,
    };
  });

  function navigateOverview(event: MouseEvent): void {
    if (!interactive || view.kind !== 'image' || innerW <= 0 || innerH <= 0) return;
    const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = event.detail === 0 ? 0.5 : Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = event.detail === 0 ? 0.5 : Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    scale = Math.max(scale, 3);
    offsetX = (0.5 - x) * innerW * scale;
    offsetY = (0.5 - y) * innerH * scale;
    applyClamp();
  }

  // App owns the equipment toolbar; this component retains the image state.
  function toggleMetal(): void {
    if (!target || appStore.stageMode !== 'median') return;
    metalOn = !metalOn;
    if (metalOn) {
      measureMode = false;
      paletteTool = 'pointer';
      lastMeasuredStats = null;
      measuredStats = {};
      measureVerdict = null;
      rulerMode = false;
      resetRuler();
    }
  }

  export function runTool(action: StageTool): void {
    if (action === 'fit') resetZoom();
    else if (action === 'refresh') refresh();
    else if (action === 'top' || action === 'bottom') selectSide(action === 'top' ? 'TOP' : 'BOTTOM');
    else if (action === 'median' || action === 'pattern') appStore.stageMode = action;
    else if (action === 'grid') { /* 保留占位：左侧导航网格常显，按钮用途待定 */ }
    else if (action === 'metal') toggleMetal();
    else if (view.kind === 'image') {
      if (action === 'zoom-in' || action === 'zoom-out') {
        const rect = stageView?.getBoundingClientRect();
        if (rect) zoomAt(action === 'zoom-in' ? CLICK_STEP : 1 / CLICK_STEP, rect.left + rect.width / 2, rect.top + rect.height / 2);
      } else if (action === 'gv' && appStore.stageMode === 'median' && !metalOn) toggleMeasureMode();
      else if (action === 'roi') {
        paletteTool = drawMode ? 'pointer' : 'add-rect';
        if (paletteTool === 'add-rect') { measureMode = false; rulerMode = false; resetRuler(); }
        if (paletteTool === 'pointer') measureMode = false;
      } else if (action === 'roi-delete') roiOverlay?.deleteSelected();
      else if (action === 'roi-clear') roiOverlay?.clearAll();
    }
  }

  $effect(() => {
    onToolStateChange?.({ scale, drawMode, measureMode, rulerMode, hasImage: view.kind === 'image', canMeasure: view.kind === 'image' && appStore.stageMode === 'median' && !metalOn, side, metalOn });
  });

  // Publish the image/align controls to the Settings accordion (right panel).
  // Every member is a getter/setter over the local runes above, so the settings
  // component re-renders on exactly the changes the stage itself reacts to.
  stageApi.current = {
    get side() { return side; },
    get stageMode() { return appStore.stageMode; },
    get hasImage() { return view.kind === 'image'; },
    get image() { return view.kind === 'image' ? view.image : null; },
    get natW() { return natW; },
    get natH() { return natH; },
    get lightGv() { return lightGv; },
    get contrastPct() { return contrastPct; },
    get toneAdjusted() { return toneAdjusted; },
    get drawMode() { return drawMode; },
    get tool() { return paletteTool; },
    get measureMode() { return measureMode; },
    get roiCount() { return roiCount; },
    get roiHasSelection() { return roiHasSelection; },
    get measureVerdict() { return measureVerdict; },
    get metalOn() { return metalOn; },
    get alignedOn() { return alignedOn; },
    get simBusy() { return simBusy; },
    get simOffset() { return simOffset; },
    get simVerdict() { return simVerdict; },
    get labOpen() { return labOpen; },
    get ready() { return !!target; },
    setSide: (wanted) => selectSide(wanted),
    setTool: (tool) => { paletteTool = tool; },
    setStageMode: (mode) => { appStore.stageMode = mode; },
    setLightGv: (value) => { lightGv = value; },
    setContrast: (value) => { contrastPct = value; },
    resetTone,
    refresh,
    runTool,
    toggleMetal,
    setLabOpen: (open) => { labOpen = open; },
    generateOffset: () => {
      const machineId = target?.machineId ?? '';
      const modelName = target?.modelName ?? '';
      if (!machineId || !modelName) return;
      simSeed = Date.now() % 1_000_000_007;
      void loadMetal(side, machineId, modelName);
    },
    runAlign: () => void runMetalAlign(),
    revealTruth: () => void showTruth(),
  };
</script>

<svg class="light-filter-defs" aria-hidden="true" focusable="false">
  <defs>
    <filter id="afvi-light-filter" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values={lightMatrix} />
    </filter>
  </defs>
</svg>
<div class="stage">
  <aside class="strip-overview" aria-label="Strip overview">
    <div class="side-toggle" role="group" aria-label="Strip side">
      <button class:on={side === 'TOP'} onclick={() => selectSide('TOP')}>TOP</button>
      <button class:on={side === 'BOTTOM'} onclick={() => selectSide('BOTTOM')}>BTM</button>
    </div>
    <div class="overview-preview">
      {#if stage.kind === 'image'}
        <button class="strip-preview" onclick={resetZoom} title={`${stage.image.host} · ${stage.image.version} · ${stage.image.width} × ${stage.image.height} · 点击适应画布`}>
          <img src="data:image/jpeg;base64,{stage.image.data}" alt={`${side} strip overview`} draggable="false" style={imgFilter} />
        </button>
      {:else}
        <div class="overview-empty">{stage.kind === 'loading' ? 'LOADING' : 'STRIP'}</div>
      {/if}
    </div>
    <div class="overview-map">
      {#if view.kind === 'image'}
        <button
          class="navigation-map"
          style="aspect-ratio: 5 / 13;"
          title="导航网格：点击定位视口（非实际 Cell 编号）"
          aria-label="Navigation grid. Click to move the image viewport."
          onclick={navigateOverview}
        >
          <span
            class="navigation-window"
            style={`left: ${navigationWindow.left}%; top: ${navigationWindow.top}%; width: ${navigationWindow.width}%; height: ${navigationWindow.height}%;`}
          ></span>
        </button>
        <span class="map-caption">NAV GRID</span>
      {:else}
        <div class="overview-empty">NAV GRID</div>
      {/if}
    </div>
  </aside>

  <div
    class="stage-view"
    class:zoomed={scale > 1}
    class:dragging={dragging}
    class:draw-mode={drawMode}
    class:ruler-mode={rulerMode}
    role="application"
    aria-label="Strip image view (wheel or Ctrl+right-click zooms in, Ctrl+left-click zooms out, drag pans, double-click resets)"
    bind:this={stageView}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    onpointerleave={clearReadout}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
  >
    {#if view.kind === 'image'}
      <div
        class="stage-inner"
        style="width: {innerW}px; height: {innerH}px; transform: translate({offsetX}px, {offsetY}px) scale({scale})"
      >
        <img
          bind:this={imgEl}
          src="data:image/jpeg;base64,{view.image.data}"
          alt="{side} {appStore.stageMode === 'pattern' ? 'GB pattern render' : 'median image'}"
          draggable="false"
          style={imgFilter}
          onload={() => {
            natW = imgEl?.naturalWidth ?? 0;
            natH = imgEl?.naturalHeight ?? 0;
            buildReadoutCanvas();
            applyClamp();
          }}
        />
        {#if innerW > 0 && roiKey}
          <RoiOverlay
            bind:this={roiOverlay}
            enabled={interactive}
            {natW}
            {natH}
            tool={overlayTool}
            {measureMode}
            measurements={measuredLabels}
            onMeasure={measureRoi}
            imageKey={roiKey}
            bind:count={roiCount}
            bind:hasSelection={roiHasSelection}
          />
        {/if}
      </div>
    {:else if view.kind === 'loading'}
      <div class="stage-note" role="status">
        <div class="stage-spinner"></div>
        <p>正在读取 {side === 'TOP' ? 'FM1' : 'BM'} 图像…</p>
      </div>
    {:else if view.kind === 'error'}
      <div class="stage-note"><p class="error">{view.message}</p></div>
    {:else if view.kind === 'missing'}
      <div class="stage-note">
        <p>未找到 {side === 'TOP' ? 'FM1' : 'BM'} {appStore.stageMode === 'pattern' ? 'Align/ROI' : 'MEDIAN'} 图像</p>
        <details><summary>查看查找路径</summary>{#each view.searched as location}<p class="path">{location}</p>{/each}</details>
      </div>
    {:else}
      <div class="stage-note"><p>选择机台与模型后显示图像</p></div>
    {/if}
    {#if rulerMode && rulerScreen}
      <svg class="ruler-layer" aria-hidden="true">
        <line class="ruler-line" x1={rulerScreen.a.x} y1={rulerScreen.a.y} x2={rulerScreen.b.x} y2={rulerScreen.b.y} />
      </svg>
      <span class="ruler-node" style="left:{rulerScreen.a.x}px; top:{rulerScreen.a.y}px;"></span>
      <span class="ruler-node" style="left:{rulerScreen.b.x}px; top:{rulerScreen.b.y}px;"></span>
      <span class="ruler-tag ruler-coord ruler-a" style="left:{rulerScreen.a.x}px; top:{rulerScreen.a.y}px;">({Math.round(rulerScreen.readout.a.x)}, {Math.round(rulerScreen.readout.a.y)})</span>
      <span class="ruler-tag ruler-coord ruler-b" style="left:{rulerScreen.b.x}px; top:{rulerScreen.b.y}px;">({Math.round(rulerScreen.readout.b.x)}, {Math.round(rulerScreen.readout.b.y)})</span>
      <span class="ruler-tag ruler-dist" style="left:{(rulerScreen.a.x + rulerScreen.b.x) / 2}px; top:{(rulerScreen.a.y + rulerScreen.b.y) / 2}px;">{rulerScreen.readout.dist.toFixed(2)}px</span>
    {/if}
    {#if measureVerdict || simVerdict}
      <div class="stage-feedback" class:error={measureVerdict ? !measureVerdict.ok : !simVerdict?.success} role="status">
        {measureVerdict?.text ?? simVerdict?.text}
      </div>
    {/if}
    {#if scale > 1 || drawMode || rulerMode}
      <div class="view-indicator">{Math.round(scale * 100)}%{drawMode ? ` · ${measureMode ? 'GV' : 'ROI'}` : rulerMode ? ' · 量尺' : ''}</div>
    {/if}
  </div>
  {#if measureMode && interactive && view.kind === 'image'}
    <RoiToolPalette enabled={paletteEnabled} active={paletteTool} onselect={selectPaletteTool} onclear={() => roiOverlay?.clearAll()} ariaLabel="GV 测量工具" />
  {/if}
</div>

<style>
  .light-filter-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
  .stage { flex: 1; min-width: 0; min-height: 0; display: flex; background: var(--bg-stage, var(--border-strong)); }
  .strip-overview { width: var(--strip-overview-width, 8.2vw); min-width: 90px; max-width: 200px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--bg-stage, var(--border-strong)); border-right: 3px solid var(--bg-darker); }
  .side-toggle { display: flex; height: 23px; flex-shrink: 0; margin: 0 5px; }
  .side-toggle button { width: 50%; padding: 0; background: var(--bg-header); border: 1px solid var(--border-strong); color: var(--text-muted); font-size: 10px; cursor: pointer; }
  .side-toggle button.on { background: var(--accent-blue-bright); color: #fff; }
  .overview-preview { flex: 1; min-height: 0; display: flex; justify-content: flex-start; align-items: center; padding: 5px 8px; border-bottom: 3px solid var(--bg-darker); overflow: hidden; }
  .strip-preview { width: 100%; height: 100%; padding: 0; display: flex; align-items: center; justify-content: flex-start; border: 0; background: transparent; cursor: pointer; }
  .strip-preview img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--accent-blue-bright); }
  .overview-map { position: relative; flex: 1; min-height: 0; padding: 12px 10px 21px; display: flex; align-items: flex-start; justify-content: flex-start; overflow: hidden; }
  .navigation-map { position: relative; width: 100%; max-height: 100%; padding: 0; border: 1px solid #a23450; cursor: crosshair; background: repeating-linear-gradient(to right, transparent 0, transparent calc(20% - 1px), #a23450 calc(20% - 1px), #a23450 20%), repeating-linear-gradient(to bottom, transparent 0, transparent calc(7.6923% - 1px), #a23450 calc(7.6923% - 1px), #a23450 7.6923%); }
  .navigation-window { position: absolute; box-sizing: border-box; border: 2px solid #4ea94c; pointer-events: none; }
  .map-caption { position: absolute; bottom: 4px; left: 10px; color: var(--text-muted); font-size: 9px; letter-spacing: 0.06em; }
  .overview-empty { width: 100%; text-align: center; font-size: 10px; color: var(--text-dim, var(--text-muted)); }
  .stage-view { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; background: var(--bg-stage, var(--border-strong)); overflow: hidden; user-select: none; touch-action: none; }
  .stage-view.zoomed { cursor: grab; }
  .stage-view.dragging { cursor: grabbing; }
  .stage-view.draw-mode { cursor: crosshair; }
  .stage-view.ruler-mode { cursor: crosshair; }
  /* 量尺：红线 + 光蓝端点 + 绿色坐标 / 蓝色长度标签（实机样式）。
     挂在视口层（.stage-view）而非缩放层，缩放时线宽与字号恒定。 */
  .ruler-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .ruler-line { stroke: #e8232b; stroke-width: 2; }
  .ruler-node { position: absolute; width: 13px; height: 13px; border-radius: 50%; background: #8ac6e6; border: 2px solid #5f2b26; transform: translate(-50%, -50%); pointer-events: none; }
  .ruler-tag { position: absolute; padding: 0 4px; border-radius: 2px; background: rgba(8, 10, 12, 0.6); font: 600 11px 'Segoe UI', sans-serif; line-height: 1.4; white-space: nowrap; pointer-events: none; }
  .ruler-coord { color: #3fd23f; }
  .ruler-dist { color: #37a6ff; transform: translate(8px, -50%); }
  .ruler-a { transform: translate(calc(-100% - 5px), -100%); }
  .ruler-b { transform: translate(5px, 2px); }
  .stage-inner { position: relative; flex-shrink: 0; background: #000; transform-origin: center; }
  .stage-inner img { display: block; width: 100%; height: 100%; }
  .stage-note { max-width: 85%; text-align: center; color: var(--text-muted); font-size: 12px; }
  .stage-note p { margin: 5px 0; }
  .stage-note details { font-size: 11px; margin-top: 12px; }
  .stage-note summary { cursor: pointer; }
  .path { font-family: 'Consolas', monospace; overflow-wrap: anywhere; }
  .error { color: var(--status-red, #e2755a); }
  .stage-feedback { position: absolute; bottom: 0; left: 0; right: 0; padding: 6px 10px; color: var(--text-main); background: var(--bg-darker); font-size: 11px; pointer-events: none; }
  .stage-feedback.error { color: var(--status-red, #e2755a); }
  .view-indicator { position: absolute; top: 7px; right: 9px; color: var(--text-muted); font-size: 10px; pointer-events: none; }
  .stage-spinner { width: 20px; height: 20px; margin: 0 auto 10px; border: 2px solid var(--bg-header); border-top-color: var(--accent-blue-bright); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
