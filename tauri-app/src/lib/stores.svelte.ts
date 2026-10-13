import type { HostId, Machine, TeachSelection } from './service';
import type { DisplayChannel, LightPageState } from './light-simulation';

export type AppTab = 'teach' | 'review' | 'calibrate' | 'settings';

/**
 * What the center stage displays. "median" is the strip image; "pattern" is
 * the GB Pattern.tif master render - the Align/ROI view on the real machine.
 * The TEACH tree toggles it: the align parent (Metal) selects "pattern", any
 * other node goes back to "median".
 */
export type StageMode = 'median' | 'pattern';

export interface ConnectorSelection {
  machineId: string;
  host: HostId;
}

const CONNECTOR_STORAGE_KEY = 'afvi-connector';

const validHost = (value: unknown): value is HostId => value === 'FM1' || value === 'FM2' || value === 'BM';

/** Publish the one machine/Vision source used by the application. */
export function setActiveConnector(selection: ConnectorSelection | null): void {
  appStore.activeConnector = selection;
  if (selection) appStore.lightSimulation.host = selection.host;
  try {
    if (selection) localStorage.setItem(CONNECTOR_STORAGE_KEY, JSON.stringify(selection));
    else localStorage.removeItem(CONNECTOR_STORAGE_KEY);
  } catch {
    // Local persistence is best-effort; the in-memory selection still applies.
  }
}

/** Restore a saved connector after the machine list has loaded. */
export function restoreActiveConnector(machines: Machine[], fallbackMachineId?: string): void {
  let stored: ConnectorSelection | null = null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONNECTOR_STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && typeof (parsed as { machineId?: unknown }).machineId === 'string' && validHost((parsed as { host?: unknown }).host)) {
      stored = { machineId: (parsed as { machineId: string }).machineId, host: (parsed as { host: HostId }).host };
    }
  } catch {
    stored = null;
  }
  const machineIds = new Set(machines.map((machine) => machine.id));
  const candidate = stored && machineIds.has(stored.machineId)
    ? stored
    : (fallbackMachineId && machineIds.has(fallbackMachineId) ? { machineId: fallbackMachineId, host: 'FM1' as HostId } : null);
  appStore.activeConnector = candidate;
  if (candidate) appStore.lightSimulation.host = candidate.host;
  try {
    if (candidate) localStorage.setItem(CONNECTOR_STORAGE_KEY, JSON.stringify(candidate));
    else localStorage.removeItem(CONNECTOR_STORAGE_KEY);
  } catch {
    // Keep the in-memory fallback when browser storage is unavailable.
  }
}

export function emptyLightSimulation(): {
  enabled: boolean;
  host: HostId;
  selectedPage: number;
  displayChannel: DisplayChannel;
  pages: LightPageState[];
} {
  return {
    enabled: true,
    host: 'FM1',
    selectedPage: 0,
    displayChannel: 'Red',
    pages: [],
  };
}

// Global reactive app state (Svelte 5 runes). Replaces the former RxJS
// Subject + manual markForCheck pattern: components read these values
// through $derived and follow updates automatically.
export const appStore = $state({
  machines: [] as Machine[],
  activeSelection: null as { machineId: string; modelName: string } | null,
  activeConnector: null as ConnectorSelection | null,
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
  lightSimulation: emptyLightSimulation(),
  /**
   * Live hover readout from the center stage (GV measure). Updated by
   * CenterImage on pointermove (rAF-throttled), rendered by App.svelte's
   * status bar; null fields show as "—". Coordinates are ORIGINAL tif
   * pixels; GV stats come from a small window around the cursor on the
   * 4096 preview (approximate - exact numbers go through measure_median_gv).
   */
  stageReadout: null as {
    width: number;
    height: number;
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    avgGv: number;
    stdGv: number;
  } | null,
});
