import type { Machine, TeachSelection } from './service';

export type AppTab = 'teach' | 'calibrate' | 'copier' | 'settings';

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
});
