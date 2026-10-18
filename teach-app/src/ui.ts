import type { NccSurface } from '../../teach-core/src/align.ts';
import { cssVar } from './theme.ts';

export const OVERLAY = {
  ok: '#00ff00',
  ng: '#ff0000',
  warn: '#ffff00',
  roi: '#00ffff',
  muted: '#808080',
  probe: '#ffffff',
  ngFill: 'rgba(255,0,0,0.25)',
  font: '11px Tahoma, "SimSun", sans-serif',
} as const;

export type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  id?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string | number;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  checked?: boolean;
  disabled?: boolean;
  placeholder?: string;
  style?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: Record<string, (event: Event) => void>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.id !== undefined) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.type !== undefined) node.setAttribute('type', props.type);
  if (props.value !== undefined) (node as HTMLInputElement).value = String(props.value);
  if (props.min !== undefined) node.setAttribute('min', String(props.min));
  if (props.max !== undefined) node.setAttribute('max', String(props.max));
  if (props.step !== undefined) node.setAttribute('step', String(props.step));
  if (props.checked !== undefined) (node as HTMLInputElement).checked = props.checked;
  if (props.disabled !== undefined) (node as HTMLButtonElement).disabled = props.disabled;
  if (props.placeholder !== undefined) node.setAttribute('placeholder', props.placeholder);
  if (props.style !== undefined) node.setAttribute('style', props.style);
  if (props.dataset !== undefined) {
    for (const key of Object.keys(props.dataset)) node.dataset[key] = props.dataset[key];
  }
  if (props.attrs !== undefined) {
    for (const key of Object.keys(props.attrs)) node.setAttribute(key, props.attrs[key]);
  }
  if (props.on !== undefined) {
    for (const key of Object.keys(props.on)) node.addEventListener(key, props.on[key]);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (value: number) => void;
}

export interface SliderHandle {
  root: HTMLElement;
  set(v: number): void;
  get(): number;
}

export function slider(options: SliderOptions): SliderHandle {
  const range = el('input', {
    type: 'range',
    min: options.min,
    max: options.max,
    step: options.step,
    value: options.value,
  });
  const number = el('input', {
    type: 'number',
    min: options.min,
    max: options.max,
    step: options.step,
    value: options.value,
  });
  const root = el('div', { class: 'slider-row' }, [el('label', { text: options.label }), range, number]);
  const apply = (raw: number, fromRange: boolean): void => {
    let v = raw;
    if (!Number.isFinite(v)) v = options.value;
    v = Math.min(options.max, Math.max(options.min, v));
    if (fromRange) number.value = String(v);
    else range.value = String(v);
    options.onInput(v);
  };
  range.addEventListener('input', () => apply(Number(range.value), true));
  number.addEventListener('input', () => apply(Number(number.value), false));
  return {
    root,
    set(v: number): void {
      range.value = String(v);
      number.value = String(v);
    },
    get(): number {
      return Number(range.value);
    },
  };
}

export function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'row' }, [input, el('span', { text: label })]);
}

export interface SelectOption {
  value: string;
  label: string;
}

export function select(options: SelectOption[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const node = el('select');
  for (const option of options) {
    node.appendChild(el('option', { value: option.value, text: option.label }));
  }
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const node = el('button', { class: className, text: label, type: 'button' });
  node.addEventListener('click', onClick);
  return node;
}

export interface SectionHandle {
  root: HTMLElement;
  body: HTMLElement;
}

export function section(title: string, collapsed = false): SectionHandle {
  const caret = el('span', { class: 'caret', text: collapsed ? '+' : '−' });
  const head = el('div', { class: 'section-head' }, [caret, el('span', { text: title })]);
  const body = el('div', { class: 'section-body' });
  const root = el('div', { class: collapsed ? 'section collapsed' : 'section' }, [head, body]);
  head.addEventListener('click', () => {
    const isCollapsed = root.classList.toggle('collapsed');
    caret.textContent = isCollapsed ? '+' : '−';
  });
  return { root, body };
}

export function table(headers: string[], rows: Array<Array<string | Node>>): HTMLTableElement {
  const thead = el('thead');
  const headRow = el('tr');
  for (const header of headers) headRow.appendChild(el('th', { text: header }));
  thead.appendChild(headRow);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const cell of row) {
      const td = el('td');
      if (typeof cell === 'string') td.textContent = cell;
      else td.appendChild(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  return el('table', { class: 'grid' }, [thead, tbody]);
}

export function badge(level: 'ok' | 'manual' | 'ng'): HTMLElement {
  const text = level === 'ok' ? 'OK' : level === 'manual' ? 'MANUAL' : 'NG';
  return el('span', { class: `badge ${level}`, text });
}

export function drawHistogram(canvas: HTMLCanvasElement, histogram: number[], highlight?: number): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  const bg = cssVar('--c-chart-bg') || '#000000';
  const bar = cssVar('--c-chart-bar') || '#00c000';
  const mark = cssVar('--c-chart-mark') || '#ffff00';
  const frame = cssVar('--c-chart-frame') || '#404040';
  const grid = cssVar('--c-chart-grid') || '#1e3a1e';
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  let max = 0;
  for (const v of histogram) if (v > max) max = v;
  if (max === 0) return;
  const logMax = Math.log(max + 1);
  const barW = w / histogram.length;
  ctx.fillStyle = grid;
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = Math.round(h * frac) + 0.5;
    ctx.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < histogram.length; i++) {
    const v = histogram[i];
    if (v === 0) continue;
    const norm = Math.log(v + 1) / logMax;
    const barH = norm * (h - 2);
    ctx.fillStyle = highlight !== undefined && i === highlight ? mark : bar;
    ctx.fillRect(i * barW, h - barH, Math.max(1, barW), barH);
  }
  ctx.strokeStyle = frame;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

export function drawHeatmap(canvas: HTMLCanvasElement, surface: NccSurface): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const { width, height, values } = surface;
  if (width <= 0 || height <= 0) return;
  const cellW = w / width;
  const cellH = h / height;
  let peakIdx = 0;
  let peakVal = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peakVal) {
      peakVal = values[i];
      peakIdx = i;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = values[y * width + x];
      const t = Math.min(1, Math.max(0, (v + 1) / 2));
      let r: number;
      let g: number;
      let b: number;
      if (t < 0.5) {
        const k = t / 0.5;
        r = 0;
        g = 0;
        b = Math.round(255 * k);
      } else {
        const k = (t - 0.5) / 0.5;
        r = Math.round(255 * k);
        g = Math.round(255 * k);
        b = Math.round(255 * (1 - k));
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }
  const px = (peakIdx % width) * cellW + cellW / 2;
  const py = Math.floor(peakIdx / width) * cellH + cellH / 2;
  ctx.strokeStyle = OVERLAY.ok;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.stroke();
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: number | null = null;
  return (...args: Parameters<T>): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

export function formatNumber(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
