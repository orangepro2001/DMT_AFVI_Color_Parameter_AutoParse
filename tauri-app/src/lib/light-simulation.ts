export const LIGHT_COLORS = ['Red', 'Green', 'Blue', 'White'] as const;
export type LightColor = typeof LIGHT_COLORS[number];
export const DISPLAY_CHANNELS = ['Red', 'Green', 'Blue', 'RGB'] as const;
export type DisplayChannel = typeof DISPLAY_CHANNELS[number];

export type SimulationChannel = {
  index: number;
  value: number;
  angle: number;
  color: string;
  enable: boolean;
};

export type LightPageState = {
  enabled: boolean;
  channels: SimulationChannel[];
};

export type LightGains = {
  red: number;
  green: number;
  blue: number;
};

export type GvStatsLike = {
  mean: number;
  std: number;
  min: number;
  max: number;
  pixels: number;
  /** Raw MEDIAN luma counts; used to measure the simulated, clipped pixels. */
  histogram?: number[];
};

export const LIGHT_VALUE_MIN = 0;
export const LIGHT_VALUE_MAX = 1024;

export function clampLightValue(value: number): number {
  if (!Number.isFinite(value)) return LIGHT_VALUE_MIN;
  return Math.min(LIGHT_VALUE_MAX, Math.max(LIGHT_VALUE_MIN, Math.round(value)));
}

export function createLightPage(channels: readonly SimulationChannel[]): LightPageState {
  const normalized = channels.map((channel) => ({
    ...channel,
    value: clampLightValue(channel.value),
  }));
  return {
    enabled: normalized.some((channel) => channel.enable),
    channels: normalized,
  };
}

function colorKey(color: string): LightColor | null {
  const normalized = color.trim().toLowerCase();
  if (normalized === 'r' || normalized === 'red') return 'Red';
  if (normalized === 'g' || normalized === 'green') return 'Green';
  if (normalized === 'b' || normalized === 'blue') return 'Blue';
  if (normalized === 'w' || normalized === 'white') return 'White';
  return null;
}

function pageContribution(page: LightPageState, color: LightColor): number {
  const values = page.channels
    .filter((channel) => channel.enable && colorKey(channel.color) === color)
    .map((channel) => clampLightValue(channel.value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length / LIGHT_VALUE_MAX;
}

export function computeLightGains(pages: readonly LightPageState[], enabled: boolean): LightGains {
  if (!enabled) return { red: 1, green: 1, blue: 1 };
  let red = 1;
  let green = 1;
  let blue = 1;
  for (const page of pages.slice(0, 3)) {
    if (!page.enabled) continue;
    const white = pageContribution(page, 'White');
    red += pageContribution(page, 'Red') + white;
    green += pageContribution(page, 'Green') + white;
    blue += pageContribution(page, 'Blue') + white;
  }
  return {
    red: Math.min(4, Math.max(1, red)),
    green: Math.min(4, Math.max(1, green)),
    blue: Math.min(4, Math.max(1, blue)),
  };
}

export function applyLightToRgb(
  rgb: readonly [number, number, number],
  gains: LightGains,
  displayChannel: DisplayChannel = 'RGB',
): [number, number, number] {
  const composed: [number, number, number] = [
    Math.min(255, Math.max(0, Math.round(rgb[0] * gains.red))),
    Math.min(255, Math.max(0, Math.round(rgb[1] * gains.green))),
    Math.min(255, Math.max(0, Math.round(rgb[2] * gains.blue))),
  ];
  if (displayChannel === 'RGB') return composed;
  const value = composed[displayChannel === 'Red' ? 0 : displayChannel === 'Green' ? 1 : 2];
  return [value, value, value];
}

export function effectiveLumaGain(gains: LightGains, displayChannel: DisplayChannel = 'RGB'): number {
  if (displayChannel === 'Red') return gains.red;
  if (displayChannel === 'Green') return gains.green;
  if (displayChannel === 'Blue') return gains.blue;
  return 0.299 * gains.red + 0.587 * gains.green + 0.114 * gains.blue;
}

export function applyLightToGvStats(
  stats: GvStatsLike,
  gains: LightGains,
  displayChannel: DisplayChannel = 'RGB',
): GvStatsLike & { approximate: boolean } {
  const counts = stats.histogram;
  if (counts?.length === 256 && stats.pixels > 0 &&
      counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
      counts.reduce((sum, count) => sum + count, 0) === stats.pixels) {
    let sum = 0;
    let sumSq = 0;
    let min = 255;
    let max = 0;
    for (let value = 0; value < counts.length; value++) {
      const count = counts[value];
      if (count === 0) continue;
      const rgb = applyLightToRgb([value, value, value], gains, displayChannel);
      const luma = displayChannel === 'RGB' ? 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] : rgb[0];
      sum += luma * count;
      sumSq += luma * luma * count;
      min = Math.min(min, luma);
      max = Math.max(max, luma);
    }
    const mean = sum / stats.pixels;
    return { mean, std: Math.sqrt(Math.max(0, sumSq / stats.pixels - mean * mean)), min, max, pixels: stats.pixels, approximate: false };
  }
  // Older backends return moments alone. They cannot reconstruct saturation;
  // callers must label the composed result as an estimate until rebuilt.
  const gain = effectiveLumaGain(gains, displayChannel);
  return {
    mean: Math.min(255, Math.max(0, stats.mean * gain)),
    std: Math.max(0, stats.std * gain),
    min: Math.min(255, Math.max(0, Math.round(stats.min * gain))),
    max: Math.min(255, Math.max(0, Math.round(stats.max * gain))),
    pixels: stats.pixels,
    approximate: gains.red !== 1 || gains.green !== 1 || gains.blue !== 1,
  };
}

export function lightMatrixValues(gains: LightGains, displayChannel: DisplayChannel = 'RGB'): string {
  if (displayChannel !== 'RGB') {
    const row = displayChannel === 'Red' ? `${gains.red} 0 0 0 0` :
      displayChannel === 'Green' ? `0 ${gains.green} 0 0 0` : `0 0 ${gains.blue} 0 0`;
    return `${row} ${row} ${row} 0 0 0 1 0`;
  }
  return `${gains.red} 0 0 0 0 0 ${gains.green} 0 0 0 0 0 ${gains.blue} 0 0 0 0 0 1 0`;
}
