// Theme engine. The palette is applied as a generated <style> sheet on
// startup (main.ts, pre-mount) so the first frame already has the persisted
// theme. Live in-place swaps are unreliable in this WebView2 build (style
// recalculation is lazily per-element and leaves mixed palettes), so the
// toggle in App.svelte persists the choice and reloads the page instead.

export type Theme = 'dark' | 'light';

export const DARK_VARS: Record<string, string> = {
  '--bg-dark': '#2d2d30',
  '--bg-darker': '#222222',
  '--bg-deep': '#1e1e1e',
  '--bg-panel': '#252526',
  '--bg-header': '#333337',
  '--bg-input': '#1e1e1e',
  '--bg-elev': '#484848',
  '--tint-ok': '#2e3d56',
  '--tint-bad': '#4a2d2d',
  '--tint-info': '#2d2d3d',
  '--tint-warn': '#4a3200',
  '--tint-warn-text': '#ffd88a',
  '--text-main': '#d4d4d4',
  '--text-muted': '#808080',
  '--accent-blue': '#007acc',
  '--accent-blue-bright': '#0088cc',
  '--status-green': '#8cc63f',
  '--border-color': '#3f3f46',
  '--border-strong': '#111111',
  '--slider-track': '#3e3e42',
  '--slider-thumb': '#007acc',
  '--toggle-bg': '#555555',
  '--toggle-bg-on': '#007acc',
  '--scrollbar-thumb': '#424242',
  '--scrollbar-thumb-hover': '#4f4f4f',
  '--row-insp': '#00ff00',
  '--row-sub': '#ffff00',
};

export const LIGHT_VARS: Record<string, string> = {
  '--bg-dark': '#f3f3f3',
  '--bg-darker': '#e4e4e4',
  '--bg-deep': '#eaeaea',
  '--bg-panel': '#ffffff',
  '--bg-header': '#e8e8e8',
  '--bg-input': '#ffffff',
  '--bg-elev': '#dcdcdc',
  '--tint-ok': '#dcefe2',
  '--tint-bad': '#f4dede',
  '--tint-info': '#e6e4f4',
  '--tint-warn': '#f7ecd2',
  '--tint-warn-text': '#6b5310',
  '--text-main': '#1f1f1f',
  '--text-muted': '#616161',
  '--accent-blue': '#0067c4',
  '--accent-blue-bright': '#0067c4',
  '--status-green': '#5a9e0d',
  '--border-color': '#d4d4d4',
  '--border-strong': '#c0c0c0',
  '--slider-track': '#c8c8c8',
  '--slider-thumb': '#0067c4',
  '--toggle-bg': '#b5b5b5',
  '--toggle-bg-on': '#0067c4',
  '--scrollbar-thumb': '#c1c1c1',
  '--scrollbar-thumb-hover': '#a8a8a8',
  '--row-insp': '#0a8a0a',
  '--row-sub': '#a07c00',
};

let epoch = 0;

export function applyTheme(theme: Theme): void {
  document.body.dataset['theme'] = theme;
  // Full-sheet swap with the palette. This WebView2 build recalculates style
  // lazily per element, so a live in-place swap leaves mixed palettes behind;
  // the toggle therefore persists and reloads (see App.svelte) - a fresh page
  // with the palette applied pre-mount always renders correctly.
  const vars = theme === 'light' ? LIGHT_VARS : DARK_VARS;
  const css = ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('') + '}';
  let styleEl = document.getElementById('afvi-theme-vars') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'afvi-theme-vars';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem('afvi-theme', theme);
  } catch {
    // persistence is best-effort
  }
}

export function initialTheme(): Theme {
  try {
    return localStorage.getItem('afvi-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
