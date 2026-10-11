<script lang="ts">
  import { appService, type RoiRect } from '../../lib/service';

  /**
   * Rectangle-ROI overlay for the stage image. The SVG exactly covers the
   * preview (same box as the <img>, so the wrapper's CSS transform moves both)
   * and the labels / resize handles are percentage-positioned HTML that keeps
   * a constant screen size at any zoom. All geometry is preview-image pixels.
   *
 * Interaction: in draw mode a left-drag on the background draws a new box;
 * otherwise boxes can be selected, dragged to move, resized at the corners
 * and deleted (Del key or the parent's meta-bar buttons). Persistence goes
 * through appService.getRoiBoxes/saveRoiBoxes; the boxes are consumed by the
 * case lab's 「ROI 对齐」 (align_run_rois), not by drawing itself.
   */
  let {
    natW,
    natH,
    drawMode = false,
    imageKey,
    count = $bindable(0),
    hasSelection = $bindable(false),
  }: {
    natW: number;
    natH: number;
    drawMode?: boolean;
    imageKey: string;
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
  let gesture: Gesture | null = null; // plain field: only read inside handlers

  const selected = $derived(rois.find((roi) => roi.id === selectedId) ?? null);

  $effect(() => {
    count = rois.length;
  });
  $effect(() => {
    hasSelection = selectedId !== null;
  });

  // Load the box group of the displayed image; a new imageKey replaces everything.
  $effect(() => {
    const key = imageKey;
    let cancelled = false;
    void appService.getRoiBoxes(key).then((list) => {
      if (!cancelled) {
        rois = list;
        selectedId = null;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  function clamp(value: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, value));
  }

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

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !layerEl || !drawMode || natW === 0) return;
    const point = toImagePoint(event);
    gesture = {
      kind: 'draw',
      startX: point.x,
      startY: point.y,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    draft = { id: '', name: '', x: point.x, y: point.y, w: 0, h: 0 };
    selectedId = null;
    layerEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function startMove(event: PointerEvent, roi: RoiRect): void {
    if (event.button !== 0 || drawMode || !layerEl) return;
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

  function onPointerMove(event: PointerEvent): void {
    const g = gesture;
    if (!g || natW === 0) return;
    const point = toImagePoint(event);
    if (g.kind === 'draw') {
      draft = {
        id: '',
        name: '',
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
      rois[index] = {
        ...g.orig,
        x: clamp(g.orig.x + (point.x - g.grabX), 0, natW - g.orig.w),
        y: clamp(g.orig.y + (point.y - g.grabY), 0, natH - g.orig.h),
      };
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
        };
        rois = [...rois, roi];
        selectedId = roi.id;
        commit();
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
      };
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
    rois = rois.filter((roi) => roi.id !== selectedId);
    selectedId = null;
    commit();
  }

  export function clearAll(): void {
    if (rois.length === 0) return;
    rois = [];
    selectedId = null;
    commit();
  }

  // Del removes the selected box, Esc cancels a draft / clears the selection.
  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        if (draft) {
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
</script>

<svg
  bind:this={layerEl}
  class="roi-layer"
  class:drawing={drawMode}
  role="application"
  aria-label="ROI 框绘制层"
  viewBox="0 0 {natW} {natH}"
  preserveAspectRatio="none"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {#each rois as roi (roi.id)}
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
      onpointerdown={(event) => startMove(event, roi)}
    />
  {/each}
  {#if draft}
    <rect
      class="draft"
      x={draft.x}
      y={draft.y}
      width={draft.w}
      height={draft.h}
      vector-effect="non-scaling-stroke"
    />
  {/if}
</svg>

{#each rois as roi (roi.id)}
  <span
    class="roi-label"
    class:selected={roi.id === selectedId}
    style="left:{pct(roi.x, natW)}; top:{pct(roi.y, natH)};"
  >
    {roi.name}
  </span>
  {#if roi.id === selectedId && !drawMode}
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
  .roi-layer rect {
    fill: rgba(255, 210, 0, 0.08);
    stroke: #ffd200;
    stroke-width: 1.5;
    cursor: move;
    pointer-events: auto;
  }
  /* while drawing, existing boxes must not swallow the background drag */
  .roi-layer.drawing rect {
    pointer-events: none;
  }
  .roi-layer rect.selected {
    stroke: #37a6ff;
    fill: rgba(55, 166, 255, 0.1);
  }
  .roi-layer rect.draft {
    stroke: #ffffff;
    stroke-dasharray: 5 3;
    fill: rgba(255, 255, 255, 0.06);
  }

  .roi-label {
    position: absolute;
    transform: translateY(-100%);
    padding: 1px 4px;
    background: rgba(17, 17, 17, 0.72);
    border: 1px solid rgba(255, 210, 0, 0.35);
    color: #ffd200;
    font-size: 10px;
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
  }
  .roi-label.selected {
    color: #37a6ff;
    border-color: rgba(55, 166, 255, 0.5);
  }

  .handle {
    position: absolute;
    width: 9px;
    height: 9px;
    background: #ffffff;
    border: 1px solid #14557a;
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
