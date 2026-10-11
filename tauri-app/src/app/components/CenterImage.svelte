<script lang="ts">
  import { appService, type MedianImage } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';
  import AlignCaseLab from './AlignCaseLab.svelte';
  import RoiOverlay from './RoiOverlay.svelte';

  type StageSide = 'TOP' | 'BOTTOM';
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

  const stage = $derived(states[side]);
  const pattern = $derived(patterns[side]);
  const view = $derived(appStore.stageMode === 'pattern' ? pattern : stage);
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
      resetZoom();
      dragging = false;
      drawMode = false;
      natW = 0;
      natH = 0;
      roiCount = 0;
      roiHasSelection = false;
      states = { TOP: idleState(), BOTTOM: idleState() };
      patterns = { TOP: idleState(), BOTTOM: idleState() };
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

  // Switching between the median strip and the Align/ROI pattern resets the
  // viewport - the two images do not share a transform.
  $effect(() => {
    void appStore.stageMode;
    resetZoom();
    // the case generator only exists in the Align/ROI view
    if (appStore.stageMode !== 'pattern') labOpen = false;
  });

  // ---- ALIGN M1: synthetic case generator drawer ----
  let labOpen = $state(false);

  // ---- ROI drawing (UI-only; the algorithm seam lives in lib/service.ts) ----
  // Boxes are keyed per displayed image: machine|model|side|median|pattern.
  let drawMode = $state(false);
  let natW = $state(0); // preview natural dims, published by the img onload
  let natH = $state(0);
  let viewW = $state(0); // stage viewport size, tracked for the contain fit
  let viewH = $state(0);
  let roiCount = $state(0);
  let roiHasSelection = $state(false);
  let roiOverlay = $state<ReturnType<typeof RoiOverlay> | null>(null);
  const roiKey = $derived(
    target ? `${target.machineId}|${target.modelName}|${side}|${appStore.stageMode}` : '',
  );

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
      ? Math.min((viewW - 2) / natW, (viewH - 2) / natH) // -2: the frame border
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
    return Math.min(0, Math.max(view - scaled, value));
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
    const px = clientX - rect.left;
    const py = clientY - rect.top;
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
    if (!imgEl) return;
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, event.clientX, event.clientY);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!imgEl) return;
    if (event.ctrlKey && (event.button === 2 || event.button === 0)) {
      // Ctrl + right button zooms in, Ctrl + left button zooms out
      event.preventDefault();
      zoomAt(event.button === 2 ? CLICK_STEP : 1 / CLICK_STEP, event.clientX, event.clientY);
      return;
    }
    if (event.button === 0 && event.target === imgEl) {
      // background press outside draw mode: drop the box selection
      // (in draw mode the svg swallows the press, so this never fires)
      roiOverlay?.clearSelection();
    }
    // in draw mode the left button belongs to the ROI overlay; right-drag pans
    const wantsPan = drawMode ? event.button === 2 : event.button === 0;
    if (wantsPan && scale > 1) {
      dragging = true;
      dragStart = { x: event.clientX, y: event.clientY, offsetX, offsetY };
      stageView?.setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    offsetX = dragStart.offsetX + (event.clientX - dragStart.x);
    offsetY = dragStart.offsetY + (event.clientY - dragStart.y);
    applyClamp();
  }

  function endDrag(): void {
    dragging = false;
  }

  function onDblClick(event: MouseEvent): void {
    if (event.ctrlKey) return; // rapid Ctrl+click zooming must not reset
    if (drawMode) return; // box gestures run on the overlay, not the viewport
    if (event.target !== imgEl && event.target !== stageView) return; // e.g. a box was double-clicked
    resetZoom();
  }

  function onContextMenu(event: MouseEvent): void {
    // Ctrl+right-click is a zoom gesture, and right-drag pans in draw mode -
    // swallow the browser menu in both cases
    if (event.ctrlKey || (drawMode && scale > 1)) event.preventDefault();
  }
</script>

<div class="stage">
  <div class="stage-bar">
    <div class="side-toggle" role="group" aria-label="Strip side">
      <button class:on={side === 'TOP'} onclick={() => selectSide('TOP')}>TOP</button>
      <button class:on={side === 'BOTTOM'} onclick={() => selectSide('BOTTOM')}>BTM</button>
    </div>
    <div class="stage-meta">
      {#if view.kind === 'image'}
        <span>{view.image.host} · v{view.image.version}</span>
        <span>{view.image.width} × {view.image.height}</span>
      {/if}
      {#if view.kind === 'image'}
        <button
          class="zoom-badge"
          class:lab-on={drawMode}
          type="button"
          onclick={() => (drawMode = !drawMode)}
          title="画框:开启后左键拖拽画 ROI 框,Esc 取消,Del 删除选中"
        >
          □ 画框
        </button>
        {#if roiCount > 0}
          <span class="roi-count">框 {roiCount}</span>
          {#if roiHasSelection}
            <button class="zoom-badge" type="button" onclick={() => roiOverlay?.deleteSelected()}>
              删除选中
            </button>
          {/if}
          <button class="zoom-badge" type="button" onclick={() => roiOverlay?.clearAll()}>清空</button>
        {/if}
      {/if}
      {#if scale > 1}
        <button class="zoom-badge" type="button" onclick={resetZoom} title="Reset zoom (double-click works too)">
          {Math.round(scale * 100)}%
        </button>
      {/if}
      {#if appStore.stageMode === 'pattern'}
        <button class="zoom-badge" class:lab-on={labOpen} type="button" onclick={() => (labOpen = !labOpen)} title="ALIGN 合成案例生成器 (M1)">
          🧪 案例生成
        </button>
      {/if}
    </div>
  </div>

  <div
    class="stage-view"
    class:zoomed={scale > 1}
    class:dragging={dragging}
    class:draw-mode={drawMode}
    role="application"
    aria-label="Strip image view (wheel or Ctrl+right-click zooms in, Ctrl+left-click zooms out, drag pans, double-click resets)"
    bind:this={stageView}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
  >
    {#if labOpen && appStore.stageMode === 'pattern'}
      <AlignCaseLab {side} image={view.kind === 'image' ? view.image : null} {natW} {natH} />
    {:else if view.kind === 'image'}
      <!-- one transformed wrapper around img + ROI overlay: both track zoom/pan 1:1 -->
      <div
        class="stage-inner"
        style="width: {innerW}px; height: {innerH}px; transform: translate({offsetX}px, {offsetY}px) scale({scale})"
      >
        <img
          bind:this={imgEl}
          src="data:image/jpeg;base64,{view.image.data}"
          alt="{side} {appStore.stageMode === 'pattern' ? 'GB pattern render' : 'median image'}"
          draggable="false"
          onload={() => {
            natW = imgEl?.naturalWidth ?? 0;
            natH = imgEl?.naturalHeight ?? 0;
          }}
        />
        {#if innerW > 0 && roiKey}
          <RoiOverlay
            bind:this={roiOverlay}
            {natW}
            {natH}
            {drawMode}
            imageKey={roiKey}
            bind:count={roiCount}
            bind:hasSelection={roiHasSelection}
          />
        {/if}
      </div>
    {:else if view.kind === 'loading'}
      <div class="stage-note">
        <div class="stage-spinner"></div>
        <p>Loading {side === 'TOP' ? 'FM1' : 'BM'} {appStore.stageMode === 'pattern' ? 'Align/ROI overlay' : 'median'} image…</p>
        <p class="dim">The tif is read over the share and downscaled; large strips can take a moment.</p>
      </div>
    {:else if view.kind === 'error'}
      <div class="stage-note">
        <p class="error">{view.message}</p>
      </div>
    {:else if view.kind === 'missing'}
      <div class="stage-note">
        <p>No {appStore.stageMode === 'pattern' ? 'GB Pattern.tif' : 'median image'} for {target?.modelName} on {side === 'TOP' ? 'FM1' : 'BM'}.</p>
        {#each view.searched as location}
          <p class="dim path">{location}</p>
        {/each}
      </div>
    {:else}
      <div class="stage-note">
        <p class="dim">{view.message}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .stage {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .stage-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 12px;
    background-color: var(--bg-darker);
    border-bottom: 1px solid var(--border-strong);
  }
  .side-toggle {
    display: flex;
    border: 1px solid var(--border-strong);
  }
  .side-toggle button {
    width: 76px;
    padding: 5px 0;
    background-color: var(--bg-header);
    color: var(--text-muted);
    font-weight: bold;
    font-size: 12px;
    border: 0;
    border-right: 1px solid var(--bg-darker);
    cursor: pointer;
  }
  .side-toggle button:last-child {
    border-right: 0;
  }
  .side-toggle button.on {
    background-color: var(--accent-blue-bright);
    color: white;
  }
  .stage-meta {
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--status-green);
    font-size: 11px;
  }
  .zoom-badge {
    background-color: var(--bg-header);
    border: 1px solid var(--border-strong);
    color: var(--status-green);
    font-size: 11px;
    font-weight: bold;
    padding: 2px 8px;
    cursor: pointer;
  }
  .zoom-badge:hover {
    background-color: #14557a;
    color: white;
  }
  .zoom-badge.lab-on {
    background-color: #14557a;
    color: white;
  }

  .stage-view {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--border-strong);
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .stage-view.zoomed {
    cursor: grab;
  }
  .stage-view.dragging {
    cursor: grabbing;
  }
  .stage-view.draw-mode {
    cursor: crosshair;
  }
  /* The wrapper carries the pan/zoom transform and an explicit contain-fit
   * pixel size (computed from the viewport + preview dims), so the img fills
   * it exactly and the ROI overlay's inset:0 box == the img content box at
   * every zoom level. The frame border sits on the wrapper (box-sizing
   * border-box) so border and content never shift the overlay. */
  .stage-inner {
    position: relative;
    box-sizing: border-box;
    border: 1px solid var(--bg-header);
    background-color: #000;
    transform-origin: 0 0;
  }
  .stage-inner img {
    display: block;
    width: 100%;
    height: 100%;
  }
  .roi-count {
    padding: 2px 8px;
    border: 1px solid var(--border-strong);
    background-color: var(--bg-header);
  }
  .stage-note {
    text-align: center;
    color: var(--text-main);
    font-size: 13px;
    max-width: 90%;
  }
  .stage-note p {
    margin: 4px 0;
  }
  .stage-note .error {
    color: #e2755a;
  }
  .stage-note .dim {
    color: var(--text-muted);
    font-size: 11px;
  }
  .stage-note .path {
    font-family: monospace;
    word-break: break-all;
  }
  .stage-spinner {
    width: 26px;
    height: 26px;
    margin: 0 auto 10px;
    border: 3px solid var(--bg-header);
    border-top-color: var(--accent-blue-bright);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
