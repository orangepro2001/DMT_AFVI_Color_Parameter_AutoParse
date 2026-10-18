import type { CameraChannel, GvStats, LightColor, Material } from '../../teach-core/src/light.ts';
import type { SliderHandle } from './ui.ts';
import type { Rect } from '../../teach-core/src/gray.ts';
import { DEFAULT_REFLECTANCE } from '../../teach-core/src/index.ts';
import type { AppContext, DisplayChannel, Panel } from './main.ts';
import type { MeasureResultItem } from './protocol.ts';
import { button, checkbox, debounce, drawHistogram, el, formatNumber, section, slider, table } from './ui.ts';

const MATERIALS: Material[] = ['base', 'sr', 'open', 'metal'];
const CAMERA_CHANNELS: CameraChannel[] = ['Red', 'Green', 'Blue'];
const LIGHT_COLORS: LightColor[] = ['Red', 'Green', 'Blue', 'White'];

export class LightPanel implements Panel {
  private ctx: AppContext;
  private left: HTMLElement;
  private right: HTMLElement;
  private measureRect: Rect | null = null;
  private dragging = false;
  private dragStart: [number, number] = [0, 0];
  private dragCurrent: [number, number] = [0, 0];
  private lastStats: MeasureResultItem[] = [];
  private histogramCanvas: HTMLCanvasElement;
  private statsHost: HTMLElement;
  private materialHost: HTMLElement;
  private reflectanceInputs = new Map<string, HTMLInputElement>();
  private channelSelect: HTMLSelectElement | null = null;
  private lightSliders = new Map<LightColor, SliderHandle>();
  private lightChecks = new Map<LightColor, HTMLInputElement>();
  private gainSlider: SliderHandle | null = null;
  private offsetSlider: SliderHandle | null = null;
  private textureSlider: SliderHandle | null = null;
  private active = false;
  private scheduleMeasure: () => void;

  constructor() {
    this.ctx = null as unknown as AppContext;
    this.left = el('div');
    this.right = el('div');
    this.histogramCanvas = el('canvas', { class: 'chart', attrs: { width: '300', height: '120' } });
    this.statsHost = el('div');
    this.materialHost = el('div');
    this.scheduleMeasure = debounce(() => {
      void this.runMeasure();
    }, 150);
  }

  attach(ctx: AppContext, left: HTMLElement, right: HTMLElement): void {
    this.ctx = ctx;
    this.left = left;
    this.right = right;
    this.buildLeft();
    this.buildRight();
  }

  private buildLeft(): void {
    const ctx = this.ctx;
    const state = ctx.state;
    this.left.textContent = '';

    const lightSection = section('光源');
    for (const color of LIGHT_COLORS) {
      const channel = state.lightSetting.channels.find((c) => c.color === color);
      if (channel === undefined) continue;
      const enable = checkbox('', channel.enable, (checked) => {
        channel.enable = checked;
        ctx.refreshLight();
      });
      const handle = slider({
        label: color,
        min: 0,
        max: 1024,
        step: 1,
        value: channel.value,
        onInput: (v) => {
          channel.value = v;
          if (v > 0) channel.enable = true;
          ctx.refreshLight();
        },
      });
      this.lightSliders.set(color, handle);
      this.lightChecks.set(color, enable.querySelector('input') as HTMLInputElement);
      lightSection.body.appendChild(el('div', { class: 'row' }, [enable, handle.root]));
    }
    this.left.appendChild(lightSection.root);

    const displaySection = section('相机通道');
    const channelOptions = [
      { value: 'Red', label: 'Red' },
      { value: 'Green', label: 'Green' },
      { value: 'Blue', label: 'Blue' },
      { value: 'RGB', label: 'RGB' },
    ];
    this.channelSelect = el('select');
    for (const option of channelOptions) {
      this.channelSelect.appendChild(el('option', { value: option.value, text: option.label }));
    }
    this.channelSelect.value = state.displayChannel;
    this.channelSelect.addEventListener('change', () => {
      const value = this.channelSelect?.value as DisplayChannel | undefined;
      if (value !== undefined) {
        ctx.setDisplayChannel(value);
        ctx.refreshLight();
      }
    });
    displaySection.body.appendChild(el('div', { class: 'row' }, [el('label', { text: '显示' }), this.channelSelect]));
    displaySection.body.appendChild(
      checkbox('显示材料图', state.showMaterial, (checked) => {
        state.showMaterial = checked;
        ctx.updateLightUniforms();
      }),
    );
    this.left.appendChild(displaySection.root);

    const renderSection = section('渲染');
    this.gainSlider = slider({
      label: '增益',
      min: 0,
      max: 4,
      step: 0.01,
      value: state.lightSetting.gain ?? 1,
      onInput: (v) => {
        state.lightSetting.gain = v;
        ctx.refreshLight();
      },
    });
    renderSection.body.appendChild(this.gainSlider.root);
    this.offsetSlider = slider({
      label: '偏移',
      min: -100,
      max: 100,
      step: 1,
      value: state.lightSetting.offset ?? 0,
      onInput: (v) => {
        state.lightSetting.offset = v;
        ctx.refreshLight();
      },
    });
    renderSection.body.appendChild(this.offsetSlider.root);
    this.textureSlider = slider({
      label: '纹理强度',
      min: 0,
      max: 1,
      step: 0.01,
      value: state.lightSetting.textureStrength ?? 1,
      onInput: (v) => {
        state.lightSetting.textureStrength = v;
        ctx.refreshLight();
      },
    });
    renderSection.body.appendChild(this.textureSlider.root);
    this.left.appendChild(renderSection.root);

    const reflSection = section('反射率');
    const header = el('div', { class: 'row' }, [
      el('span', { class: 'grow', text: '材料' }),
      el('span', { text: 'R' }),
      el('span', { text: 'G' }),
      el('span', { text: 'B' }),
    ]);
    reflSection.body.appendChild(header);
    for (const material of MATERIALS) {
      const row = el('div', { class: 'row' });
      row.appendChild(el('span', { class: 'grow', text: material }));
      for (const channel of CAMERA_CHANNELS) {
        const input = el('input', {
          type: 'number',
          min: 0,
          max: 2,
          step: 0.01,
          value: state.lightSetting.reflectance[material][channel],
          style: 'width:52px',
        });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          state.lightSetting.reflectance[material][channel] = Math.min(2, Math.max(0, v));
          ctx.refreshLight();
        });
        this.reflectanceInputs.set(`${material}:${channel}`, input);
        row.appendChild(input);
      }
      reflSection.body.appendChild(row);
    }
    const reflButtons = el('div', { class: 'row' });
    reflButtons.appendChild(
      button('恢复默认', () => {
        for (const material of MATERIALS) {
          for (const channel of CAMERA_CHANNELS) {
            state.lightSetting.reflectance[material][channel] = DEFAULT_REFLECTANCE[material][channel];
            const input = this.reflectanceInputs.get(`${material}:${channel}`);
            if (input !== undefined) input.value = String(DEFAULT_REFLECTANCE[material][channel]);
          }
        }
        ctx.refreshLight();
      }),
    );
    reflButtons.appendChild(
      button('由 MEDIAN 反推当前通道', () => {
        this.estimateReflectance().catch((err: unknown) => {
          ctx.setHint('错误：' + (err as Error).message);
        });
      }),
    );
    reflSection.body.appendChild(reflButtons);
    reflSection.body.appendChild(
      el('div', {
        class: 'note',
        text: '假设 MEDIAN 在当前光照下拍摄，仅作初值。',
      }),
    );
    this.left.appendChild(reflSection.root);

    const toolSection = section('工具');
    toolSection.body.appendChild(
      button('GV 测量（拖框）', () => {
        this.measureRect = null;
        this.ctx.setHint('在视图上左键拖框进行 GV 测量');
      }),
    );
    toolSection.body.appendChild(
      button('清除测量框', () => {
        this.measureRect = null;
        this.ctx.viewer.redraw();
      }),
    );
    this.left.appendChild(toolSection.root);
  }

  private buildRight(): void {
    this.right.textContent = '';
    const statsSection = section('GV 统计');
    statsSection.body.appendChild(this.statsHost);
    statsSection.body.appendChild(this.histogramCanvas);
    this.right.appendChild(statsSection.root);

    const materialSection = section('材料');
    materialSection.body.appendChild(this.materialHost);
    this.right.appendChild(materialSection.root);
    this.renderMaterialStats();
  }

  private renderMaterialStats(): void {
    const state = this.ctx.state;
    const rows: Array<Array<string | Node>> = [];
    for (let i = 0; i < MATERIALS.length; i++) {
      rows.push([
        MATERIALS[i],
        String(state.materialCounts[i]),
        formatNumber(state.materialMeans[i], 2),
      ]);
    }
    this.materialHost.textContent = '';
    this.materialHost.appendChild(el('div', { class: 'table-wrap' }, [table(['材料', '像素数', 'MEDIAN 均值'], rows)]));
  }

  private applyUniforms(): void {
    this.ctx.updateLightUniforms();
  }

  private async estimateReflectance(): Promise<void> {
    const ctx = this.ctx;
    const state = ctx.state;
    const channel: CameraChannel = state.displayChannel === 'RGB' ? 'Red' : state.displayChannel;
    const result = await ctx.client.request<Record<Material, number | null>>({
      type: 'estimate',
      setting: state.lightSetting,
      channel,
    });
    for (const material of MATERIALS) {
      const value = result[material];
      if (value === null) continue;
      state.lightSetting.reflectance[material][channel] = Math.min(2, Math.max(0, value));
      const input = this.reflectanceInputs.get(`${material}:${channel}`);
      if (input !== undefined) input.value = value.toFixed(3);
    }
    ctx.refreshLight();
  }

  private async runMeasure(): Promise<void> {
    const ctx = this.ctx;
    const state = ctx.state;
    if (state.width === 0 || state.height === 0) return;
    const rect = this.measureRect ?? { x: 0, y: 0, w: state.width, h: state.height };
    const channels: CameraChannel[] =
      state.displayChannel === 'RGB' ? ['Red', 'Green', 'Blue'] : [state.displayChannel];
    const start = performance.now();
    const result = await ctx.client.latest<MeasureResultItem[]>('measure', {
      type: 'measure',
      setting: state.lightSetting,
      channels,
      rect,
    });
    if (result === null) return;
    this.lastStats = result;
    ctx.setElapsed(performance.now() - start);
    this.renderStats();
  }

  private renderStats(): void {
    this.statsHost.textContent = '';
    if (this.lastStats.length === 0) {
      this.statsHost.appendChild(el('div', { class: 'note', text: '尚无测量结果。' }));
      return;
    }
    const rows: Array<Array<string | Node>> = [];
    for (const item of this.lastStats) {
      const s: GvStats = item.stats;
      rows.push([
        item.channel,
        formatNumber(s.mean, 2),
        formatNumber(s.std, 2),
        String(s.min),
        String(s.max),
        String(s.pixels),
        String(s.saturatedHigh),
        String(s.saturatedLow),
      ]);
    }
    this.statsHost.appendChild(
      el('div', { class: 'table-wrap' }, [
        table(['通道', '均值', '标准差', '最小', '最大', '像素', '饱和255', '截断0'], rows),
      ]),
    );
    const first = this.lastStats[0];
    const highlight = this.ctx.state.displayChannel === 'RGB' ? undefined : first.stats.mean;
    drawHistogram(this.histogramCanvas, first.stats.histogram, highlight !== undefined ? Math.round(highlight) : undefined);
  }

  activate(): void {
    const ctx = this.ctx;
    this.active = true;
    ctx.viewer.showLight();
    this.applyUniforms();
    ctx.viewer.setOverlay((c, view) => {
      if (this.measureRect === null) return;
      const [x0, y0] = view.toScreen(this.measureRect.x, this.measureRect.y);
      const [x1, y1] = view.toScreen(this.measureRect.x + this.measureRect.w, this.measureRect.y + this.measureRect.h);
      c.strokeStyle = '#e0c83c';
      c.lineWidth = 1.5;
      c.setLineDash([6, 4]);
      c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      c.setLineDash([]);
    });
    ctx.viewer.onPointer((p) => {
      if (p.type === 'down' && p.button === 0) {
        this.dragging = true;
        this.dragStart = [p.x, p.y];
        this.dragCurrent = [p.x, p.y];
        return true;
      }
      if (p.type === 'move' && this.dragging) {
        this.dragCurrent = [p.x, p.y];
        const x = Math.min(this.dragStart[0], this.dragCurrent[0]);
        const y = Math.min(this.dragStart[1], this.dragCurrent[1]);
        const w = Math.abs(this.dragCurrent[0] - this.dragStart[0]);
        const h = Math.abs(this.dragCurrent[1] - this.dragStart[1]);
        this.measureRect = { x, y, w, h };
        ctx.viewer.redraw();
        return true;
      }
      if (p.type === 'up' && this.dragging) {
        this.dragging = false;
        if (this.measureRect !== null && this.measureRect.w >= 1 && this.measureRect.h >= 1) {
          this.runMeasure().catch((err: unknown) => {
            ctx.setHint('错误：' + (err as Error).message);
          });
        }
        return true;
      }
      return false;
    });
    this.renderMaterialStats();
    this.runMeasure().catch((err: unknown) => {
      ctx.setHint('错误：' + (err as Error).message);
    });
  }

  deactivate(): void {
    this.active = false;
    this.ctx.viewer.onPointer(null);
    this.ctx.viewer.setOverlay(null);
  }

  refresh(): void {
    const ctx = this.ctx;
    const state = ctx.state;
    if (this.channelSelect !== null) this.channelSelect.value = state.displayChannel;
    for (const color of LIGHT_COLORS) {
      const channel = state.lightSetting.channels.find((c) => c.color === color);
      if (channel === undefined) continue;
      const handle = this.lightSliders.get(color);
      if (handle !== undefined) handle.set(channel.value);
      const check = this.lightChecks.get(color);
      if (check !== undefined) check.checked = channel.enable;
    }
    for (const material of MATERIALS) {
      for (const channel of CAMERA_CHANNELS) {
        const input = this.reflectanceInputs.get(`${material}:${channel}`);
        if (input !== undefined) {
          input.value = String(state.lightSetting.reflectance[material][channel]);
        }
      }
    }
    if (this.gainSlider !== null) this.gainSlider.set(state.lightSetting.gain ?? 1);
    if (this.offsetSlider !== null) this.offsetSlider.set(state.lightSetting.offset ?? 0);
    if (this.textureSlider !== null) this.textureSlider.set(state.lightSetting.textureStrength ?? 1);
    ctx.updateLightUniforms();
    if (this.active) this.scheduleMeasure();
  }

  reset(): void {
    this.measureRect = null;
    this.lastStats = [];
    this.renderStats();
    this.renderMaterialStats();
    this.ctx.viewer.redraw();
  }

  getLeft(): HTMLElement {
    return this.left;
  }

  getRight(): HTMLElement {
    return this.right;
  }
}
