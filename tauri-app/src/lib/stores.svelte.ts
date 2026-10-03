import type { Machine, TeachSelection } from './service';

// Global reactive app state (Svelte 5 runes). Replaces the former RxJS
// Subject + manual markForCheck pattern: components read these values
// through $derived and follow updates automatically.
export const appStore = $state({
  machines: [] as Machine[],
  activeSelection: null as { machineId: string; modelName: string } | null,
  teachSelection: null as TeachSelection | null,
});
