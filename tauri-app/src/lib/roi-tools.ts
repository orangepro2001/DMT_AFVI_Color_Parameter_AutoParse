/**
 * Model for the reusable ROI tool rail (RoiToolPalette.svelte) and its mapping
 * onto the drawing overlay (RoiOverlay.svelte).
 *
 * The palette is a dumb UI: it renders every button and enables only the ones
 * a host passes in. Hosts differ solely in which buttons they switch on, so the
 * same component serves TEACH, GV measurement, and future tools.
 */
import type { RoiShape } from './service';

/** Every button the palette can render. */
export type RoiPaletteTool =
  | 'pointer'
  | 'add-rect'
  | 'add-ellipse'
  | 'add-polygon'
  | 'delete-rect'
  | 'delete-ellipse'
  | 'delete-polygon'
  | 'delete-roi';

/** What the overlay should do while a palette button is active. `select` is
 * the neutral pointer; `erase` removes the shape under the cursor. */
export type RoiDrawTool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'erase';

/** Upper half of the rail: shape buttons that ADD to the selection. */
export const ROI_PALETTE_ADD: readonly RoiPaletteTool[] = ['add-rect', 'add-ellipse', 'add-polygon'];

/** Lower half of the rail: shape buttons that REMOVE from the selection. */
export const ROI_PALETTE_DELETE: readonly RoiPaletteTool[] = ['delete-rect', 'delete-ellipse', 'delete-polygon'];

/** Short labels, also used as tooltips/aria labels by the palette. */
export const ROI_PALETTE_LABELS: Record<RoiPaletteTool, string> = {
  pointer: '选择器（指针）',
  'add-rect': '添加矩形选区',
  'add-ellipse': '添加椭圆选区',
  'add-polygon': '添加多边形选区（右键闭合并首尾相接）',
  'delete-rect': '删除矩形选取',
  'delete-ellipse': '删除椭圆选取',
  'delete-polygon': '删除多边形选取',
  'delete-roi': '删除用户 ROI 选框（右键一键清空）',
};

/** The shape a palette button draws, or null for pointer / delete-ROI. */
export function shapeForTool(tool: RoiPaletteTool): RoiShape | null {
  if (tool === 'add-rect' || tool === 'delete-rect') return 'rect';
  if (tool === 'add-ellipse' || tool === 'delete-ellipse') return 'ellipse';
  if (tool === 'add-polygon' || tool === 'delete-polygon') return 'polygon';
  return null;
}

/** Overlay mode for a palette button. The three delete-shape buttons all map
 * to `erase` (the overlay drops the shape under the cursor); delete-ROI is an
 * action handled by the host, not a draw mode. */
export function drawToolFor(tool: RoiPaletteTool | null): RoiDrawTool {
  switch (tool) {
    case 'add-rect':
      return 'rect';
    case 'add-ellipse':
      return 'ellipse';
    case 'add-polygon':
      return 'polygon';
    case 'delete-rect':
    case 'delete-ellipse':
    case 'delete-polygon':
      return 'erase';
    default:
      return 'select';
  }
}
