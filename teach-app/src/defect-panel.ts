import type { Rect } from '../../teach-core/src/gray.ts';
import type { CameraChannel, Material } from '../../teach-core/src/light.ts';
import type { DefectBlob, DefectParams, DefectReport, DefectStroke, SceneStroke } from '../../teach-core/src/defect.ts';
import { DEFAULT_DEFECT_PARAMS } from '../../teach-core/src/index.ts';
import type { AppContext, Panel } from './main.ts';
import type { DefectRenderResult, ProbeResult } from './protocol.ts';
import { button, checkbox, debounce, el, formatNumber, section, select, slider, table } from './ui.ts';

type Tool = 'none' | 'brightSpot' | 'darkSpot' | 'brightLine' | 'darkLine' | 'foreign' | 'contamination' | 'probe';

interface StrokeEntry {
  stroke: DefectStroke | SceneStroke;
  kind: 'gv' | 'scene';
  label: string;
}

export class DefectPanel implements Panel {
  private ctx: AppContext;
  private left: HTMLElement;
  private right: HTMLElement;
  private tool: Tool = 'none';
  private radius = 6;
  private deltaGv = 60;
  private softness = 0.3;
  private foreignMaterial: Material = 'metal';
  private contaminationFactor = 1.5;
  private strokes: StrokeEntry[] = [];
  private params: DefectParams;
  private regionMaterials: Material[] = [];
  private viewKind: 'test' | 'golden' | 'diff' = 'test';
  private channel: CameraChannel = 'Red';
  private dragging = false;
  private dragStart: [number, number] = [0, 0];
  private dragCurrent: [number, number] = [0, 0];
  private probeRect: Rect | null = null;
  private lastReport: DefectReport | null = null;
  private lastProbe: ProbeResult | null = null;
  private dirty = true;
  private active = false;
  private resultHost: HTMLElement;
  private probeHost: HTMLElement;
  private strokeListHost: HTMLElement;
  private scheduleRun: () => void;

  constructor() {
    this.ctx = null as unknown as AppContext;
    this.left = el('div');
    this.right = el('div');
    this.params = { ...DEFAULT_DEFECT_PARAMS };
    this.resultHost = el('div');
    this.probeHost = el('div');
    this.strokeListHost = el('div', { class: 'list' });
    this.scheduleRun = debounce(() => {
      void this.runDetect();
    }, 300);
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
    this.left.textContent = '';

    const channelSection = section('渲染通道');
    channelSection.body.appendChild(
      select(
        [
          { value: 'Red', label: 'Red' },
          { value: 'Green', label: 'Green' },
          { value: 'Blue', label: 'Blue' },
        ],
        this.channel,
        (value) => {
          this.channel = value === 'Green' ? 'Green' : value === 'Blue' ? 'Blue' : 'Red';
          this.dirty = true;
          this.scheduleRun();
        },
      ),
    );
    this.left.appendChild(channelSection.root);

    const brushSection = section('笔刷');
    const brushRow = el('div', { class: 'row wrap' });
    const tools: Array<{ tool: Tool; label: string }> = [
      { tool: 'brightSpot', label: '亮点' },
      { tool: 'darkSpot', label: '暗点' },
      { tool: 'brightLine', label: '亮线' },
      { tool: 'darkLine', label: '暗线' },
      { tool: 'foreign', label: '异物' },
      { tool: 'contamination', label: '污染' },
    ];
    for (const entry of tools) {
      brushRow.appendChild(
        button(entry.label, () => {
          this.tool = entry.tool;
          ctx.setHint(`工具：${entry.label}`);
        }),
      );
    }
    brushSection.body.appendChild(brushRow);
    brushSection.body.appendChild(
      slider({
        label: '半径',
        min: 0.5,
        max: 40,
        step: 0.5,
        value: this.radius,
        onInput: (v) => {
          this.radius = v;
        },
      }).root,
    );
    brushSection.body.appendChild(
      slider({
        label: 'ΔGV',
        min: 1,
        max: 255,
        step: 1,
        value: this.deltaGv,
        onInput: (v) => {
          this.deltaGv = v;
        },
      }).root,
    );
    brushSection.body.appendChild(
      slider({
        label: '柔和度',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.softness,
        onInput: (v) => {
          this.softness = v;
        },
      }).root,
    );
    brushSection.body.appendChild(
      select(
        [
          { value: 'metal', label: '异物材料 metal' },
          { value: 'sr', label: '异物材料 sr' },
          { value: 'open', label: '异物材料 open' },
        ],
        this.foreignMaterial,
        (value) => {
          this.foreignMaterial = value === 'sr' ? 'sr' : value === 'open' ? 'open' : 'metal';
        },
      ),
    );
    brushSection.body.appendChild(
      slider({
        label: '污染系数',
        min: 0.2,
        max: 3,
        step: 0.05,
        value: this.contaminationFactor,
        onInput: (v) => {
          this.contaminationFactor = v;
        },
      }).root,
    );
    brushSection.body.appendChild(this.strokeListHost);
    const strokeButtons = el('div', { class: 'row' });
    strokeButtons.appendChild(
      button('撤销', () => {
        this.strokes.pop();
        this.dirty = true;
        this.renderStrokeList();
        this.scheduleRun();
      }),
    );
    strokeButtons.appendChild(
      button('清空', () => {
        this.strokes = [];
        this.dirty = true;
        this.renderStrokeList();
        this.scheduleRun();
      }),
    );
    brushSection.body.appendChild(strokeButtons);
    this.left.appendChild(brushSection.root);

    const paramSection = section('检出参数');
    const addParam = (label: string, key: keyof DefectParams, min: number, max: number, step: number): void => {
      paramSection.body.appendChild(
        slider({
          label,
          min,
          max,
          step,
          value: this.params[key],
          onInput: (v) => {
            this.params[key] = v;
            this.dirty = true;
            this.scheduleRun();
          },
        }).root,
      );
    };
    addParam('Bright TH', 'brightTh', 1, 255, 1);
    addParam('Dark TH', 'darkTh', 1, 255, 1);
    addParam('Bright Size', 'brightMinSize', 1, 500, 1);
    addParam('Dark Size', 'darkMinSize', 1, 500, 1);
    addParam('Min Size', 'minDefectSize', 1, 500, 1);
    paramSection.body.appendChild(el('div', { class: 'note', text: '检查区域' }));
    for (const material of ['metal', 'sr', 'open'] as Material[]) {
      paramSection.body.appendChild(
        checkbox(material, this.regionMaterials.includes(material), (checked) => {
          if (checked) {
            if (!this.regionMaterials.includes(material)) this.regionMaterials.push(material);
          } else {
            this.regionMaterials = this.regionMaterials.filter((m) => m !== material);
          }
          this.dirty = true;
          this.scheduleRun();
        }),
      );
    }
    this.left.appendChild(paramSection.root);

    const toolSection = section('工具');
    toolSection.body.appendChild(
      button('探查（拖框）', () => {
        this.tool = 'probe';
        ctx.setHint('在视图上拖框进行探查');
      }),
    );
    toolSection.body.appendChild(
      select(
        [
          { value: 'test', label: '测试图' },
          { value: 'golden', label: '标准图' },
          { value: 'diff', label: '差异图' },
        ],
        this.viewKind,
        (value) => {
          this.viewKind = value === 'golden' ? 'golden' : value === 'diff' ? 'diff' : 'test';
          if (this.dirty) {
            this.runDetect().catch((err: unknown) => {
              ctx.setHint('错误：' + (err as Error).message);
            });
          } else {
            this.showView().catch((err: unknown) => {
              ctx.setHint('错误：' + (err as Error).message);
            });
          }
        },
      ),
    );
    this.left.appendChild(toolSection.root);

    this.renderStrokeList();
  }

  private buildRight(): void {
    this.right.textContent = '';
    const resultSection = section('检出结果');
    resultSection.body.appendChild(this.resultHost);
    this.right.appendChild(resultSection.root);
    const probeSection = section('探查');
    probeSection.body.appendChild(this.probeHost);
    this.right.appendChild(probeSection.root);
    this.renderResult();
  }

  private renderStrokeList(): void {
    this.strokeListHost.textContent = '';
    if (this.strokes.length === 0) {
      this.strokeListHost.appendChild(el('div', { class: 'note', text: '尚无笔画。' }));
      return;
    }
    for (let i = 0; i < this.strokes.length; i++) {
      const entry = this.strokes[i];
      const item = el('div', { class: 'list-item' });
      item.appendChild(el('span', { class: 'grow', text: entry.label }));
      item.appendChild(
        button('删除', () => {
          this.strokes.splice(i, 1);
          this.dirty = true;
          this.renderStrokeList();
          this.scheduleRun();
        }),
      );
      this.strokeListHost.appendChild(item);
    }
  }

  private gvStrokes(): DefectStroke[] {
    const out: DefectStroke[] = [];
    for (const entry of this.strokes) {
      if (entry.kind === 'gv') out.push(entry.stroke as DefectStroke);
    }
    return out;
  }

  private sceneStrokes(): SceneStroke[] {
    const out: SceneStroke[] = [];
    for (const entry of this.strokes) {
      if (entry.kind === 'scene') out.push(entry.stroke as SceneStroke);
    }
    return out;
  }

  private async renderDefect(): Promise<DefectRenderResult> {
    const ctx = this.ctx;
    const start = performance.now();
    const result = await ctx.client.request<DefectRenderResult>({
      type: 'defectRender',
      setting: ctx.state.lightSetting,
      channel: this.channel,
      sceneStrokes: this.sceneStrokes(),
      gvStrokes: this.gvStrokes(),
    });
    ctx.setElapsed(performance.now() - start);
    return result;
  }

  private async showView(): Promise<void> {
    const ctx = this.ctx;
    const image = await ctx.client.request<{ width: number; height: number; data: Uint8Array }>({
      type: 'defectView',
      kind: this.viewKind,
    });
    ctx.viewer.showGray(`defect-${this.viewKind}`, image);
    ctx.setCurrentGray(image, `缺陷 ${this.viewKind}`);
    ctx.viewer.fit();
  }

  private async runDetect(): Promise<DefectReport | null> {
    const ctx = this.ctx;
    await this.renderDefect();
    const start = performance.now();
    const report = await ctx.client.latest<DefectReport>('detect', {
      type: 'detect',
      params: this.params,
      regionMaterials: this.regionMaterials.length > 0 ? this.regionMaterials : null,
    });
    if (report === null) return null;
    this.lastReport = report;
    this.dirty = false;
    ctx.setElapsed(performance.now() - start);
    await this.showView();
    this.renderResult();
    ctx.viewer.redraw();
    return report;
  }

  private renderResult(): void {
    this.resultHost.textContent = '';
    const report = this.lastReport;
    if (report === null) {
      this.resultHost.appendChild(el('div', { class: 'note', text: '尚未执行检出。' }));
      return;
    }
    const kv = el('div', { class: 'kv' });
    kv.appendChild(el('span', { class: 'k', text: '检出数' }));
    kv.appendChild(el('span', { class: 'v', text: String(report.detectedCount) }));
    kv.appendChild(el('span', { class: 'k', text: '被拒数' }));
    kv.appendChild(el('span', { class: 'v', text: String(report.rejectedCount) }));
    this.resultHost.appendChild(kv);

    const tableNode = table(['类型', '面积', '峰值Δ', '均值Δ', '结果', '规则'], []);
    const tbody = tableNode.querySelector('tbody');
    if (tbody !== null) {
      for (const blob of report.blobs) {
        const tr = el('tr', { class: 'selectable' });
        tr.appendChild(el('td', { class: 'text', text: blob.kind === 'bright' ? '亮' : '暗' }));
        tr.appendChild(el('td', { text: String(blob.area) }));
        tr.appendChild(el('td', { text: formatNumber(blob.peakDelta, 1) }));
        tr.appendChild(el('td', { text: formatNumber(blob.meanDelta, 1) }));
        tr.appendChild(el('td', { class: 'text wrap', text: blob.detected ? '检出' : (blob.rejectReason ?? '') }));
        tr.appendChild(el('td', { class: 'text wrap', text: blob.rule }));
        tr.addEventListener('click', () => {
          this.centerOn(blob);
        });
        tbody.appendChild(tr);
      }
    }
    this.resultHost.appendChild(el('div', { class: 'table-wrap' }, [tableNode]));

    const simSection = el('div');
    simSection.appendChild(el('div', { class: 'note', text: '已模拟参数' }));
    const simList = el('ul', { class: 'reasons' });
    for (const p of report.simulatedParams) simList.appendChild(el('li', { text: p }));
    simSection.appendChild(simList);
    simSection.appendChild(el('div', { class: 'note', text: '未模拟参数' }));
    const unList = el('ul', { class: 'reasons' });
    for (const p of report.unsimulatedParams) unList.appendChild(el('li', { text: p }));
    simSection.appendChild(unList);
    this.resultHost.appendChild(simSection);
  }

  private centerOn(blob: DefectBlob): void {
    const ctx = this.ctx;
    const viewer = ctx.viewer;
    const size = viewer.imageSize;
    if (size.width === 0) return;
    viewer.centerOn(blob.centroid[0], blob.centroid[1]);
    viewer.redraw();
  }

  private renderProbe(): void {
    this.probeHost.textContent = '';
    const probe = this.lastProbe;
    if (probe === null) {
      this.probeHost.appendChild(el('div', { class: 'note', text: '尚未探查。' }));
      return;
    }
    const lines: string[] = [];
    if (!probe.wouldDetectBright) {
      if (probe.maxBright < this.params.brightTh) {
        lines.push(`最大亮差 ${probe.maxBright} < Bright TH ${this.params.brightTh}：差值不足，不会检出`);
      } else {
        lines.push(`超阈像素 ${probe.brightPixels} < Size ${Math.max(this.params.brightMinSize, this.params.minDefectSize)}：面积不足`);
      }
    } else {
      lines.push(`亮缺陷会检出：最大亮差 ${probe.maxBright}，超阈像素 ${probe.brightPixels}`);
    }
    if (!probe.wouldDetectDark) {
      if (probe.maxDark < this.params.darkTh) {
        lines.push(`最大暗差 ${probe.maxDark} < Dark TH ${this.params.darkTh}：差值不足，不会检出`);
      } else {
        lines.push(`超阈像素 ${probe.darkPixels} < Size ${Math.max(this.params.darkMinSize, this.params.minDefectSize)}：面积不足`);
      }
    } else {
      lines.push(`暗缺陷会检出：最大暗差 ${probe.maxDark}，超阈像素 ${probe.darkPixels}`);
    }
    for (const line of lines) this.probeHost.appendChild(el('div', { class: 'note', text: line }));
  }

  activate(): void {
    const ctx = this.ctx;
    this.active = true;
    if (this.dirty) {
      this.runDetect().catch((err: unknown) => {
        ctx.setHint('错误：' + (err as Error).message);
      });
    } else {
      this.showView().catch((err: unknown) => {
        ctx.setHint('错误：' + (err as Error).message);
      });
    }
    ctx.viewer.setOverlay((c, view) => {
      if (this.lastReport !== null) {
        for (const blob of this.lastReport.blobs) {
          const [x0, y0] = view.toScreen(blob.bbox.x, blob.bbox.y);
          const [x1, y1] = view.toScreen(blob.bbox.x + blob.bbox.w, blob.bbox.y + blob.bbox.h);
          if (blob.detected) {
            c.strokeStyle = '#3fbf6f';
            c.lineWidth = 2;
            c.strokeRect(x0, y0, x1 - x0, y1 - y0);
          } else {
            c.strokeStyle = '#e0a83c';
            c.lineWidth = 1.5;
            c.setLineDash([5, 4]);
            c.strokeRect(x0, y0, x1 - x0, y1 - y0);
            c.setLineDash([]);
            c.fillStyle = '#e0a83c';
            c.font = '11px sans-serif';
            c.fillText(`面积 ${blob.area}`, x0 + 2, y0 - 2);
          }
        }
      }
      for (const entry of this.strokes) {
        const stroke = entry.stroke;
        c.strokeStyle = '#4a9eff';
        c.lineWidth = 1;
        if (stroke.shape === 'spot') {
          const [x0, y0] = view.toScreen(stroke.x - stroke.radius, stroke.y - stroke.radius);
          const [x1, y1] = view.toScreen(stroke.x + stroke.radius, stroke.y + stroke.radius);
          c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        } else {
          const x2 = stroke.x2 ?? stroke.x;
          const y2 = stroke.y2 ?? stroke.y;
          const [x0, y0] = view.toScreen(stroke.x, stroke.y);
          const [x1, y1] = view.toScreen(x2, y2);
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.stroke();
        }
      }
      if (this.probeRect !== null) {
        const [x0, y0] = view.toScreen(this.probeRect.x, this.probeRect.y);
        const [x1, y1] = view.toScreen(this.probeRect.x + this.probeRect.w, this.probeRect.y + this.probeRect.h);
        c.strokeStyle = '#ffffff';
        c.setLineDash([6, 4]);
        c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        c.setLineDash([]);
      }
      if (this.dragging) {
        const [x0, y0] = view.toScreen(
          Math.min(this.dragStart[0], this.dragCurrent[0]),
          Math.min(this.dragStart[1], this.dragCurrent[1]),
        );
        const [x1, y1] = view.toScreen(
          Math.max(this.dragStart[0], this.dragCurrent[0]),
          Math.max(this.dragStart[1], this.dragCurrent[1]),
        );
        c.strokeStyle = '#4a9eff';
        c.setLineDash([6, 4]);
        c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        c.setLineDash([]);
      }
    });
    ctx.viewer.onPointer((p) => this.handlePointer(p));
  }

  private handlePointer(p: { type: 'down' | 'move' | 'up'; x: number; y: number; button: number }): boolean {
    if (this.tool === 'none') return false;
    if (p.type === 'down' && p.button === 0) {
      this.dragging = true;
      this.dragStart = [p.x, p.y];
      this.dragCurrent = [p.x, p.y];
      return true;
    }
    if (p.type === 'move' && this.dragging) {
      this.dragCurrent = [p.x, p.y];
      this.ctx.viewer.redraw();
      return true;
    }
    if (p.type === 'up' && this.dragging) {
      this.dragging = false;
      const x = Math.min(this.dragStart[0], this.dragCurrent[0]);
      const y = Math.min(this.dragStart[1], this.dragCurrent[1]);
      const w = Math.abs(this.dragCurrent[0] - this.dragStart[0]);
      const h = Math.abs(this.dragCurrent[1] - this.dragStart[1]);
      if (this.tool === 'probe') {
        if (w >= 2 && h >= 2) {
          this.probeRect = { x, y, w, h };
          this.runProbe(this.probeRect).catch((err: unknown) => {
            this.ctx.setHint('错误：' + (err as Error).message);
          });
        }
      } else if (this.tool === 'brightSpot' || this.tool === 'darkSpot' || this.tool === 'foreign' || this.tool === 'contamination') {
        this.placeSpot(this.dragStart[0], this.dragStart[1]);
      } else if (this.tool === 'brightLine' || this.tool === 'darkLine') {
        if (w >= 2 || h >= 2) {
          this.placeLine(this.dragStart[0], this.dragStart[1], this.dragCurrent[0], this.dragCurrent[1]);
        }
      }
      this.tool = 'none';
      return true;
    }
    return false;
  }

  private placeSpot(x: number, y: number): void {
    if (this.tool === 'foreign') {
      const stroke: SceneStroke = {
        mode: 'material',
        shape: 'spot',
        x,
        y,
        radius: this.radius,
        material: this.foreignMaterial,
      };
      this.strokes.push({ stroke, kind: 'scene', label: `异物 ${this.foreignMaterial} @${x.toFixed(0)},${y.toFixed(0)}` });
    } else if (this.tool === 'contamination') {
      const stroke: SceneStroke = {
        mode: 'texture',
        shape: 'spot',
        x,
        y,
        radius: this.radius,
        factor: this.contaminationFactor,
      };
      this.strokes.push({ stroke, kind: 'scene', label: `污染 ×${this.contaminationFactor} @${x.toFixed(0)},${y.toFixed(0)}` });
    } else {
      const kind = this.tool === 'brightSpot' ? 'bright' : 'dark';
      const stroke: DefectStroke = {
        kind,
        shape: 'spot',
        x,
        y,
        radius: this.radius,
        deltaGv: this.deltaGv,
        softness: this.softness,
      };
      this.strokes.push({ stroke, kind: 'gv', label: `${kind === 'bright' ? '亮' : '暗'}点 @${x.toFixed(0)},${y.toFixed(0)}` });
    }
    this.dirty = true;
    this.renderStrokeList();
    this.scheduleRun();
  }

  private placeLine(x: number, y: number, x2: number, y2: number): void {
    const kind = this.tool === 'brightLine' ? 'bright' : 'dark';
    const stroke: DefectStroke = {
      kind,
      shape: 'line',
      x,
      y,
      x2,
      y2,
      radius: this.radius,
      deltaGv: this.deltaGv,
      softness: this.softness,
    };
    this.strokes.push({
      stroke,
      kind: 'gv',
      label: `${kind === 'bright' ? '亮' : '暗'}线 @${x.toFixed(0)},${y.toFixed(0)}→${x2.toFixed(0)},${y2.toFixed(0)}`,
    });
    this.dirty = true;
    this.renderStrokeList();
    this.scheduleRun();
  }

  private async runProbe(rect: Rect): Promise<void> {
    const ctx = this.ctx;
    const result = await ctx.client.request<ProbeResult>({
      type: 'probe',
      rect,
      params: this.params,
    });
    this.lastProbe = result;
    this.renderProbe();
    ctx.viewer.redraw();
  }

  deactivate(): void {
    this.active = false;
    this.ctx.viewer.onPointer(null);
    this.ctx.viewer.setOverlay(null);
  }

  refresh(): void {
    this.dirty = true;
    if (this.active) this.scheduleRun();
  }

  reset(): void {
    this.strokes = [];
    this.lastReport = null;
    this.lastProbe = null;
    this.probeRect = null;
    this.dirty = true;
    this.renderStrokeList();
    this.renderResult();
    this.renderProbe();
    this.ctx.viewer.redraw();
  }

  private findSrPoint(): [number, number] {
    const state = this.ctx.state;
    const material = state.material;
    const width = state.width;
    const height = state.height;
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    if (material === null || width === 0 || height === 0) return [cx, cy];
    const isSr = (x: number, y: number): boolean => {
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) return false;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (material[(y + dy) * width + (x + dx)] !== 1) return false;
        }
      }
      return true;
    };
    if (isSr(cx, cy)) return [cx, cy];
    const maxRing = Math.max(width, height);
    for (let r = 8; r <= maxRing; r += 8) {
      for (let d = -r; d <= r; d += 8) {
        const candidates: Array<[number, number]> = [
          [cx + d, cy - r],
          [cx + d, cy + r],
          [cx - r, cy + d],
          [cx + r, cy + d],
        ];
        for (const [x, y] of candidates) {
          if (isSr(x, y)) return [x, y];
        }
      }
    }
    return [cx, cy];
  }

  async runFull(): Promise<unknown> {
    if (this.strokes.length === 0) {
      const [cx, cy] = this.findSrPoint();
      const stroke: DefectStroke = {
        kind: 'bright',
        shape: 'spot',
        x: cx,
        y: cy,
        radius: 6,
        deltaGv: 60,
        softness: 0.3,
      };
      this.strokes.push({ stroke, kind: 'gv', label: `亮点 @${cx.toFixed(0)},${cy.toFixed(0)}` });
      this.dirty = true;
      this.renderStrokeList();
    }
    return this.runDetect();
  }

  getLeft(): HTMLElement {
    return this.left;
  }

  getRight(): HTMLElement {
    return this.right;
  }
}
