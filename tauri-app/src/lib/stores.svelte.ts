import type { Machine, TeachSelection } from './service';

export type AppTab = 'teach' | 'calibrate' | 'copier' | 'settings';

/**
 * What the center stage displays. "median" is the strip image; "pattern" is
 * the GB Pattern.tif master render - the Align/ROI view on the real machine.
 * The TEACH tree toggles it: the align parent (Metal) selects "pattern", any
 * other node goes back to "median".
 */
export type StageMode = 'median' | 'pattern';

// Global reactive app state (Svelte 5 runes). Replaces the former RxJS
// Subject + manual markForCheck pattern: components read these values
// through $derived and follow updates automatically.
export const appStore = $state({
  machines: [] as Machine[],
  activeSelection: null as { machineId: string; modelName: string } | null,
  teachSelection: null as TeachSelection | null,
  /** Tab navigation of the right panel (replaces the Angular router). */
  activeTab: 'teach' as AppTab,
  /**
   * Bumped when Data Collection's Clear resets the active selection. The
   * keep-alive TEACH / CALIBRATE pages watch it and drop their loaded
   * in-memory model state, which a plain activeSelection change cannot reach.
   */
  selectionEpoch: 0,
  /**
   * What the center stage should show right now. Unlike activeSelection this
   * is published the moment a device + model are picked (no database record
   * required), so the MEDIAN images load while the user is still choosing;
   * Clear resets it to null.
   */
  stageTarget: null as { machineId: string; modelName: string } | null,
  /**
   * What the center stage shows for the current stageTarget. The pattern
   * preview is preloaded alongside the median at model pick, so flipping this
   * flag (Align/ROI Metal node in the TEACH tree) displays instantly.
   */
  stageMode: 'median' as StageMode,
});
