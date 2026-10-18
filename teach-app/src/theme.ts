export type Theme = 'dark' | 'light';

export const THEMES: Array<{ code: Theme; labelKey: string }> = [
  { code: 'dark', labelKey: 'theme.dark' },
  { code: 'light', labelKey: 'theme.light' },
];

const STORAGE_KEY = 'teach.theme';

function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light';
}

function readUrlTheme(): Theme | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('theme');
    if (isTheme(value)) return value;
  } catch {
    return null;
  }
  return null;
}

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(value)) return value;
  } catch {
    return null;
  }
  return null;
}

function detectTheme(): Theme {
  const fromUrl = readUrlTheme();
  if (fromUrl !== null) return fromUrl;
  const stored = readStoredTheme();
  if (stored !== null) return stored;
  return 'dark';
}

let currentTheme: Theme = detectTheme();

if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = currentTheme;
}

const listeners: Array<(theme: Theme) => void> = [];

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme): void {
  currentTheme = theme;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage failures
  }
  for (const listener of listeners) listener(theme);
}

export function onThemeChange(cb: (theme: Theme) => void): void {
  listeners.push(cb);
}

export function cssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function cssColorRgb(name: string): [number, number, number] {
  const value = cssVar(name);
  if (value.length === 0) return [0.5, 0.5, 0.5];
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r / 255, g / 255, b / 255];
      }
      return [0.5, 0.5, 0.5];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [r / 255, g / 255, b / 255];
      }
      return [0.5, 0.5, 0.5];
    }
    return [0.5, 0.5, 0.5];
  }
  const match = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (match !== null) {
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r / 255, g / 255, b / 255];
    }
  }
  return [0.5, 0.5, 0.5];
}
