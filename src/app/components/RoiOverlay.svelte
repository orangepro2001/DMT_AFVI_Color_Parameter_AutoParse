<script lang="ts">
  import { appService, type RoiRect, type RoiShape } from '../../lib/service';
  import type { RoiDrawTool } from '../../lib/roi-tools';

  /**
   * Shape ROI overlay for the stage image. The SVG exactly covers the preview
   * (same box as the <img>, so the wrapper's CSS transform moves both) and the
   * labels / resize handles are percentage-positioned HTML that keeps a
   * constant screen size at any zoom. All geometry is preview-image pixels.
   *
   * Interaction is driven by `tool` (the reusable palette's active button):
   *  - select: existing shapes can be moved / resized / deleted, background
   *    press clears the selection.
   *  - rect / ellipse: left-drag draws a new shape of that kind.
   *  - polygon: left-click drops a vertex, right-click closes the path (the
   *    last vertex joins the first, referencing PS's pen tool) and commits it.
   *  - erase: clicking a shape removes it from the selection.
   * Persistence goes through appService.getRoiBoxes/saveRoiBoxes; the boxes are
   * consumed by the case lab's 「ROI 对齐」 (align_run_rois) and by GV
   * measurement (measure_median_gv, via the parent's onMeasure).
   */
  let {
    natW,
    natH,
    tool = 'select',
    enabled = true,
    imageKey,
    measureMode = false,
    measurements = {},
    onMeasure,
    count = $bindable(0),
    hasSelection = $bindable(false),
  }: {
    natW: number;
    natH: number;
    /** Active palette tool; drives the drawing gesture. */
    tool?: RoiDrawTool;
    enabled?: boolean;
    imageKey: string;
    /** GV mode: boxes request a measurement and show the value in their label. */
    measureMode?: boolean;
    /** roi id -> GV text to paint inside the box (from the parent's measurement). */
    measurements?: Record<string, string>;
    /** Requests an exact measurement of a box (id stable across the round-trip). */
    onMeasure?: (roi: RoiRect) => void;
    count?: number;
    hasSelection?: boolean;
  } = $props();

  const MIN_SIZE = 4; // preview px - a finished box below this is discarded
  const DRAW_THRESHOLD_PX = 4; // screen px of travel before a drag becomes a box

  type Corner = 'nw' | 'ne' | 'sw' | 'se';
  type Gesture =
    | { kind: 'draw'; startX: number; startY: number; clientX: number; clientY: number }
    | { kind: 'move'; id: string; grabX: number; grabY: number; orig: RoiRect }
    | { kind: 'resize'; id: string; corner: Corner; grabX: number; grabY: number; orig: RoiRect };

  let layerEl = $state<SVGSVGElement | null>(null);
  let rois = $state<RoiRect[]>([]);
  let selectedId = $state<string | null>(null);
  let draft = $state<RoiRect | null>(null);
  // In-progress polygon: flat [x0,y0,...] preview px; `polyCursor` trails the
  // pointer for the rubber-band segment until the path is closed.
  let polyPoints = $state<number[]>([]);
  let polyCursor = $state<{ x: number; y: number } | null>(null);
  let gesture: Gesture | null = null; // plain field: only read inside handlers

  const drawing = $derived(tool === 'rect' || tool === 'ellipse' || tool === 'polygon');
  const erasing = $derived(tool === 'erase');
  const selected = $derived(rois.find((roi) => roi.id === selectedId) ?? null);
  const shapeOf = (roi: RoiRect): RoiShape => roi.shape ?? 'rect';

  $effect(() => {
    count = rois.length;
  });
  $effect(() => {
    hasSelection = selectedId !== null;
  });

  // Leaving the polygon tool abandons any unfinished path.
  $effect(() => {
    void tool;
    if (tool !== 'polygon' && polyPoints.length > 0) {
      polyPoints = [];
      polyCursor = null;
    }
  });

  // Load the box group of the displayed image; a new imageKey replaces everything.
  // The reset of selectedId happens at REQUEST time (a fresh image must not
  // keep the previous image's selection) - NEVER in the response: a slow
  // document store (Mongo over the network) must not wipe a box the user just
  // drew and selected 400ms later, which used to kill the auto-measure.
  $effect(() => {
    const key = imageKey;
    let cancelled = false;
    selectedId = null;
    polyPoints = [];
    void appService.getRoiBoxes(key).then((list) => {
      if (!cancelled) rois = list;
    });
    return () => {
      cancelled = true;
    };
  });

  function clamp(value: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, value));
  }

  // ---- GV measurement requests (GV/measure mode only) ----
  // The overlay owns the box list, so it is the one that knows which boxes
  // need measuring: every box on screen when GV mode turns on (or a fresh
  // list lands) plus each freshly drawn / re-shaped box. Requests go up through
  // onMeasure; the values come back down through the `measurements` prop keyed
  // by box id and are painted into the box label. `requested` dedupes so the
  // per-frame reassignments during a drag never re-hit the backend.
  const requested = new Set<string>();

  function requestMeasure(roi: RoiRect): void {
    if (!measureMode || !onMeasure || requested.has(roi.id)) return;
    requested.add(roi.id);
    onMeasure({ ...roi });
  }

  // A new image brings a new box group: forget the previous requests so a box
  // on the fresh image is measured even if it reuses an id.
  $effect(() => {
    void imageKey;
    requested.clear();
  });

  $effect(() => {
    if (!measureMode) {
      requested.clear();
      return;
    }
    for (const roi of rois) requestMeasure(roi);
  });

  /** Pointer (client coords) -> preview-image pixel via the svg box == img box. */
  function toImagePoint(event: PointerEvent): { x: number; y: number } {
    const rect = layerEl?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * natW,
      y: ((event.clientY - rect.top) / rect.height) * natH,
    };
  }

  function newId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function nextName(): string {
    let max = 0;
    for (const roi of rois) {
      const match = /^ROI-(\d+)$/.exec(roi.name);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `ROI-${max + 1}`;
  }

  /** Persist the current boxes. Alignment runs on demand from the case lab
   * (「ROI 对齐」) - drawing alone never triggers the algorithm. */
  function commit(): void {
    const key = imageKey;
    const snapshot = rois.map((roi) => ({ ...roi }));
    void appService.saveRoiBoxes(key, snapshot).catch(() => {});
  }

  /** Bounding box of a flat vertex list. */
  function boundsOf(points: number[]): { x: number; y: number; w: number; h: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < points.length; index += 2) {
      minX = Math.min(minX, points[index]);
      maxX = Math.max(maxX, points[index]);
      minY = Math.min(minY, points[index + 1]);
      maxY = Math.max(maxY, points[index + 1]);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function addPolygonVertex(point: { x: number; y: number }): void {
    polyPoints = [...polyPoints, point.x, point.y];
    polyCursor = point;
  }

  /** Right-click on the pen tool: join the last vertex back to the first and
   * commit the shape when it has at least three vertices. */
  function closePolygon(): void {
    const points = polyPoints;
    polyPoints = [];
    polyCursor = null;
    if (points.length < 6) return;
    const bounds = boundsOf(points);
    if (bounds.w < MIN_SIZE || bounds.h < MIN_SIZE) return;
    const roi: RoiRect = {
      id: newId(),
      name: nextName(),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      w: Math.round(bounds.w),
      h: Math.round(bounds.h),
      shape: 'polygon',
      points: points.map((value) => Math.round(value)),
    };
    rois = [...rois, roi];
    selectedId = roi.id;
    commit();
    requestMeasure(roi);
  }

  function onContextMenu(event: MouseEvent): void {
    if (tool !== 'polygon') return;
    event.preventDefault();
    event.stopPropagation();
    closePolygon();
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !layerEl || natW === 0) return;
    if (tool === 'erase' || !drawing) return; // erase is handled per shape
    const point = toImagePoint(event);
    if (tool === 'polygon') {
      addPolygonVertex(point);
      return;
    }
    gesture = {
      kind: 'draw',
      startX: point.x,
      startY: point.y,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    draft = { id: '', name: '', x: point.x, y: point.y, w: 0, h: 0, shape: tool === 'ellipse' ? 'ellipse' : 'rect' };
    selectedId = null;
    layerEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function startMove(event: PointerEvent, roi: RoiRect): void {
    if (event.button !== 0 || drawing || erasing || !layerEl) return;
    event.stopPropagation(); // the stage must not start a pan from this press
    const point = toImagePoint(event);
    selectedId = roi.id;
    gesture = { kind: 'move', id: roi.id, grabX: point.x, grabY: point.y, orig: { ...roi } };
    layerEl.setPointerCapture(event.pointerId);
  }

  function startResize(event: PointerEvent, roi: RoiRect, corner: Corner): void {
    if (event.button !== 0 || !layerEl) return;
    event.stopPropagation();
    const point = toImagePoint(event);
    selectedId = roi.id;
    gesture = { kind: 'resize', id: roi.id, corner, grabX: point.x, grabY: point.y, orig: { ...roi } };
    layerEl.setPointerCapture(event.pointerId);
  }

  /** Erase tool: drop the shape under the pointer. */
  function eraseShape(event: PointerEvent, roi: RoiRect): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    requested.delete(roi.id);
    rois = rois.filter((item) => item.id !== roi.id);
    if (selectedId === roi.id) selectedId = null;
    commit();
  }

  function onShapePointerDown(event: PointerEvent, roi: RoiRect): void {
    if (tool === 'erase') {
      eraseShape(event, roi);
      return;
    }
    startMove(event, roi);
  }

  function onPointerMove(event: PointerEvent): void {
    if (natW === 0) return;
    const point = toImagePoint(event);
    if (tool === 'polygon' && polyPoints.length > 0) {
      polyCursor = point;
      return;
    }
    const g = gesture;
    if (!g) return;
    if (g.kind === 'draw') {
      draft = {
        id: '',
        name: '',
        shape: tool === 'ellipse' ? 'ellipse' : 'rect',
        x: Math.min(g.startX, point.x),
        y: Math.min(g.startY, point.y),
        w: Math.abs(point.x - g.startX),
        h: Math.abs(point.y - g.startY),
      };
      return;
    }
    const index = rois.findIndex((item) => item.id === g.id);
    if (index < 0) return;
    if (g.kind === 'move') {
      const x = clamp(g.orig.x + (point.x - g.grabX), 0, natW - g.orig.w);
      const y = clamp(g.orig.y + (point.y - g.grabY), 0, natH - g.orig.h);
      // A polygon carries absolute vertices, so moving it translates every point.
      const next: RoiRect = { ...g.orig, x, y };
      if (g.orig.points) {
        const dx = x - g.orig.x;
        const dy = y - g.orig.y;
        next.points = g.orig.points.map((value, i) => value + (i % 2 === 0 ? dx : dy));
      }
      rois[index] = next;
    } else {
      const { orig, corner } = g;
      let { x, y, w, h } = orig;
      if (corner === 'ne' || corner === 'se') {
        w = clamp(orig.w + (point.x - g.grabX), MIN_SIZE, natW - orig.x);
      }
      if (corner === 'sw' || corner === 'se') {
        h = clamp(orig.h + (point.y - g.grabY), MIN_SIZE, natH - orig.y);
      }
      if (corner === 'nw' || corner === 'sw') {
        x = clamp(orig.x + (point.x - g.grabX), 0, orig.x + orig.w - MIN_SIZE);
        w = orig.x + orig.w - x;
      }
      if (corner === 'nw' || corner === 'ne') {
        y = clamp(orig.y + (point.y - g.grabY), 0, orig.y + orig.h - MIN_SIZE);
        h = orig.y + orig.h - y;
      }
      rois[index] = { ...orig, x, y, w, h };
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const g = gesture;
    if (!g) return;
    gesture = null;
    if (g.kind === 'draw') {
      const box = draft;
      draft = null;
      const moved = Math.hypot(event.clientX - g.clientX, event.clientY - g.clientY);
      if (box && moved >= DRAW_THRESHOLD_PX && box.w >= MIN_SIZE && box.h >= MIN_SIZE) {
        const roi: RoiRect = {
          id: newId(),
          name: nextName(),
          x: Math.round(box.x),
          y: Math.round(box.y),
          w: Math.round(box.w),
          h: Math.round(box.h),
          shape: box.shape,
        };
        rois = [...rois, roi];
        selectedId = roi.id;
        commit();
        requestMeasure(roi);
      }
      return;
    }
    // round the final geometry of the dragged/resized box
    const index = rois.findIndex((item) => item.id === g.id);
    if (index >= 0) {
      const roi = rois[index];
      rois[index] = {
        ...roi,
        x: Math.round(roi.x),
        y: Math.round(roi.y),
        w: Math.round(roi.w),
        h: Math.round(roi.h),
        points: roi.points?.map((value) => Math.round(value)),
      };
      requested.delete(roi.id); // the area changed: its old GV is stale
      requestMeasure(rois[index]);
    }
    commit();
  }

  /** Clicking the image background (the click lands on the <img> because the
   * svg is click-through outside draw mode). Called by the parent. */
  export function clearSelection(): void {
    selectedId = null;
  }

  export function deleteSelected(): void {
    if (!selectedId) return;
    requested.delete(selectedId);
    rois = rois.filter((roi) => roi.id !== selectedId);
    selectedId = null;
    commit();
  }

  export function clearAll(): void {
    if (rois.length === 0) return;
    rois = [];
    selectedId = null;
    polyPoints = [];
    polyCursor = null;
    requested.clear();
    commit();
  }

  /** Geometry of the selected box (preview px), for consumers that measure
   * rather than align - null when nothing is selected. */
  export function getSelectedRect(): RoiRect | null {
    return selected ? { ...selected } : null;
  }

  // Del removes the selected box, Esc cancels a draft / polygon / selection.
  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!enabled || !layerEl?.getClientRects().length) return;
      const eventTarget = event.target as HTMLElement | null;
      if (
        eventTarget &&
        (eventTarget.tagName === 'INPUT' || eventTarget.tagName === 'TEXTAREA' || eventTarget.tagName === 'SELECT' || eventTarget.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        if (polyPoints.length > 0) {
          polyPoints = [];
          polyCursor = null;
        } else if (draft) {
          draft = null;
          gesture = null;
        } else {
          selectedId = null;
        }
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pct = (value: number, total: number): string => `${(value / total) * 100}%`;
  const polygonPoints = (roi: RoiRect): string => {
    const points = roi.points ?? [];
    let text = '';
    for (let index = 0; index < points.length; index += 2) text += `${points[index]},${points[index + 1]} `;
    return text.trim();
  };
  const draftPolyline = $derived.by(() => {
    let text = '';
    for (let index = 0; index < polyPoints.length; index += 2) text += `${polyPoints[index]},${polyPoints[index + 1]} `;
    if (polyCursor) text += `${polyCursor.x},${polyCursor.y}`;
    return text.trim();
  });
</script>

<svg
  bind:this={layerEl}
  class="roi-layer"
  class:drawing
  class:erasing
  role="application"
  aria-label="ROI 形状绘制层"
  viewBox="0 0 {natW} {natH}"
  preserveAspectRatio="none"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  oncontextmenu={onContextMenu}
>
  {#each rois as roi (roi.id)}
    {#if shapeOf(roi) === 'ellipse'}
      <ellipse
        class:selected={roi.id === selectedId}
        role="button"
        tabindex="-1"
        aria-label="{roi.name} (拖动移动,角点缩放)"
        cx={roi.x + roi.w / 2}
        cy={roi.y + roi.h / 2}
        rx={roi.w / 2}
        ry={roi.h / 2}
        vector-effect="non-scaling-stroke"
        onpointerdown={(event) => onShapePointerDown(event, roi)}
      />
    {:else if shapeOf(roi) === 'polygon'}
      <polygon
        class:selected={roi.id === selectedId}
        role="button"
        tabindex="-1"
        aria-label="{roi.name} (拖动移动)"
        points={polygonPoints(roi)}
        vector-effect="non-scaling-stroke"
        onpointerdown={(event) => onShapePointerDown(event, roi)}
      />
    {:else}
      <rect
        class:selected={roi.id === selectedId}
        role="button"
        tabindex="-1"
        aria-label="{roi.name} (拖动移动,角点缩放)"
        x={roi.x}
        y={roi.y}
        width={roi.w}
        height={roi.h}
        vector-effect="non-scaling-stroke"
        onpointerdown={(event) => onShapePointerDown(event, roi)}
      />
    {/if}
  {/each}
  {#if draft}
    {#if draft.shape === 'ellipse'}
      <ellipse
        class="draft"
        cx={draft.x + draft.w / 2}
        cy={draft.y + draft.h / 2}
        rx={draft.w / 2}
        ry={draft.h / 2}
        vector-effect="non-scaling-stroke"
      />
    {:else}
      <rect
        class="draft"
        x={draft.x}
        y={draft.y}
        width={draft.w}
        height={draft.h}
        vector-effect="non-scaling-stroke"
      />
    {/if}
  {/if}
  {#if polyPoints.length >= 2}
    <polyline class="polyline" points={draftPolyline} vector-effect="non-scaling-stroke" />
    {#if polyPoints.length >= 6 && polyCursor}
      <line
        class="polyline-hint"
        x1={polyCursor.x}
        y1={polyCursor.y}
        x2={polyPoints[0]}
        y2={polyPoints[1]}
        vector-effect="non-scaling-stroke"
      />
    {/if}
  {/if}
</svg>

{#each rois as roi (roi.id)}
  <span
    class="roi-label"
    class:selected={roi.id === selectedId}
    class:measured={measureMode && measurements[roi.id] != null}
    style="left:{pct(roi.x, natW)}; top:{pct(roi.y, natH)};"
  >
    {measureMode && measurements[roi.id] != null ? `GV: ${measurements[roi.id]}` : roi.name}
  </span>
  {#if roi.id === selectedId && !drawing && shapeOf(roi) !== 'polygon'}
    <span
      class="handle nw"
      role="button"
      tabindex="-1"
      aria-label="{roi.name} 左上角缩放"
      style="left:{pct(roi.x, natW)}; top:{pct(roi.y, natH)};"
      onpointerdown={(event) => startResize(event, roi, 'nw')}
></span>
    <span
      class="handle ne"
      role="button"
      tabindex="-1"
      aria-label="{roi.name} 右上角缩放"
      style="left:{pct(roi.x + roi.w, natW)}; top:{pct(roi.y, natH)};"
      onpointerdown={(event) => startResize(event, roi, 'ne')}
></span>
    <span
      class="handle sw"
      role="button"
      tabindex="-1"
      aria-label="{roi.name} 左下角缩放"
      style="left:{pct(roi.x, natW)}; top:{pct(roi.y + roi.h, natH)};"
      onpointerdown={(event) => startResize(event, roi, 'sw')}
></span>
    <span
      class="handle se"
      role="button"
      tabindex="-1"
      aria-label="{roi.name} 右下角缩放"
      style="left:{pct(roi.x + roi.w, natW)}; top:{pct(roi.y + roi.h, natH)};"
      onpointerdown={(event) => startResize(event, roi, 'se')}
></span>
  {/if}
{/each}

<style>
  /* The svg is the drawing surface; it never affects the wrapper's layout. */
  .roi-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .roi-layer.drawing {
    pointer-events: all;
    cursor: crosshair;
  }
  /* erase keeps the svg click-through so the shapes below stay hit-testable */
  .roi-layer.erasing {
    cursor: crosshair;
  }
  .roi-layer :is(rect, ellipse, polygon) {
    fill: rgba(255, 210, 0, 0.08);
    stroke: #ffd200;
    /* --roi-scale is the stage zoom, published by CenterImage on the zoomed
       layer. Dividing by it cancels the ancestor CSS scale so the outline,
       handles and labels stay hairline/1:1 at any zoom (the box GEOMETRY still
       tracks the image, since it lives in the scaled layer). */
    stroke-width: calc(1.5px / var(--roi-scale, 1));
    cursor: move;
    pointer-events: auto;
  }
  /* while drawing, existing shapes must not swallow the background drag */
  .roi-layer.drawing :is(rect, ellipse, polygon) {
    pointer-events: none;
  }
  .roi-layer.erasing :is(rect, ellipse, polygon) {
    cursor: crosshair;
  }
  .roi-layer :is(rect, ellipse, polygon).selected {
    stroke: #37a6ff;
    fill: rgba(55, 166, 255, 0.1);
  }
  .roi-layer :is(rect, ellipse, polygon).draft {
    stroke: #ffffff;
    stroke-dasharray: 5 3;
    fill: rgba(255, 255, 255, 0.06);
  }
  .roi-layer .polyline {
    fill: none;
    stroke: #ffffff;
    stroke-width: calc(1.5px / var(--roi-scale, 1));
    pointer-events: none;
  }
  .roi-layer .polyline-hint {
    fill: none;
    stroke: #ffffff;
    stroke-width: calc(1.2px / var(--roi-scale, 1));
    stroke-dasharray: 4 3;
    pointer-events: none;
  }

  .roi-label {
    position: absolute;
    transform: translateY(-100%);
    padding: calc(1px / var(--roi-scale, 1)) calc(4px / var(--roi-scale, 1));
    background: rgba(17, 17, 17, 0.72);
    border: calc(1px / var(--roi-scale, 1)) solid rgba(255, 210, 0, 0.35);
    color: #ffd200;
    font-size: calc(10px / var(--roi-scale, 1));
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
  }
  .roi-label.selected {
    color: #37a6ff;
    border-color: rgba(55, 166, 255, 0.5);
  }
  /* a measured box carries its GV value, like the machine's on-image readout */
  .roi-label.measured {
    padding: calc(1px / var(--roi-scale, 1)) calc(5px / var(--roi-scale, 1));
    background: rgba(17, 17, 17, 0.85);
    border-color: #ffd200;
    font-weight: 600;
  }
  .roi-label.measured.selected {
    border-color: rgba(55, 166, 255, 0.75);
  }

  .handle {
    position: absolute;
    width: calc(9px / var(--roi-scale, 1));
    height: calc(9px / var(--roi-scale, 1));
    background: #ffffff;
    border: calc(1px / var(--roi-scale, 1)) solid #14557a;
    transform: translate(-50%, -50%);
    pointer-events: auto;
  }
  .handle.nw {
    cursor: nwse-resize;
  }
  .handle.ne {
    cursor: nesw-resize;
  }
  .handle.sw {
    cursor: nesw-resize;
  }
  .handle.se {
    cursor: nwse-resize;
  }
</style>
