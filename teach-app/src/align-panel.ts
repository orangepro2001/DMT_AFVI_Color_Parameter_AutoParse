import type { CameraChannel } from '../../teach-core/src/light.ts';
import type { AlignConfig, AlignRoi, AlignReport, RoiMatch } from '../../teach-core/src/align.ts';
import type { WarpParams } from '../../teach-core/src/warp.ts';
import { DEFAULT_ALIGN_CONFIG } from '../../teach-core/src/index.ts';
import type { AppContext, Panel } from './main.ts';
import type { AlignResult, WarpResult } from './protocol.ts';
import { badge, button, checkbox, debounce, drawHeatmap, el, formatNumber, section, select, slider, table } from './ui.ts';

type Tool = 'none' | 'roi' | 'select' | 'occlusion';

interface Occlusion {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
}

export class AlignPanel implements Panel {
  private ctx: AppContext;
  private left: HTMLElement;
  private right: HTMLElement;
  private rois: AlignRoi[] = [];
  private occlusions: Occlusion[] = [];
  private selectedRoi = -1;
  private tool: Tool = 'none';
  private dragging = false;
  private dragStart: [number, number] = [0, 0];
  private dragCurrent: [number, number] = [0, 0];
  private moveOrigin: [number, number] = [0, 0];
  private moveRoiIndex = -1;
  private viewKind: 'template' | 'input' | 'diff' = 'template';
  private source: 'median' | 'light' = 'median';
  private scale: 1 | 2 | 4 = 2;
  private params: WarpParams;
  private config: AlignConfig;
  private autoRun = true;
  private dirty = true;
  private lastResult: AlignResult | null = null;
  private heatmapCanvas: HTMLCanvasElement;
  private resultHost: HTMLElement;
  private roiListHost: HTMLElement;
  private occlusionListHost: HTMLElement;
  private occlusionValue = 0;
  private scheduleRun: () => void;
  private paramSliders: Array<{ key: keyof WarpParams; handle: ReturnType<typeof slider> }> = [];

  constructor() {
    this.ctx = null as unknown as AppContext;
    this.left = el('div');
    this.right = el('div');
    this.params = {
      tx: 0,
      ty: 0,
      thetaDeg: 0,
      scale: 1,
      shearX: 0,
      shearY: 0,
      bendAmplitude: 0,
      bendWavelength: 0,
      blurSigma: 0,
      noiseSigma: 0,
      gain: 1,
      offset: 0,
      gradient: 0,
      occlusions: [],
    };
    this.config = { ...DEFAULT_ALIGN_CONFIG };
    this.heatmapCanvas = el('canvas', { class: 'chart', attrs: { width: '300', height: '300' } });
    this.resultHost = el('div');
    this.roiListHost = el('div', { class: 'list' });
    this.occlusionListHost = el('div', { class: 'list' });
    this.scheduleRun = debounce(() => {
      void this.runAlign();
    }, 400);
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

    const sourceSection = section('源图');
    sourceSection.body.appendChild(
      select(
        [
          { value: 'median', label: 'MEDIAN 原图' },
          { value: 'light', label: '当前光照渲染图' },
        ],
        this.source,
        (value) => {
          this.source = value === 'light' ? 'light' : 'median';
          this.dirty = true;
          this.scheduleRun();
        },
      ),
    );
    sourceSection.body.appendChild(
      select(
        [
          { value: '1', label: '1/1' },
          { value: '2', label: '1/2' },
          { value: '4', label: '1/4' },
        ],
        String(this.scale),
        (value) => {
          this.scale = value === '1' ? 1 : value === '4' ? 4 : 2;
          this.dirty = true;
          this.scheduleRun();
        },
      ),
    );
    this.left.appendChild(sourceSection.root);

    const warpSection = section('扭曲参数');
    const addSlider = (
      label: string,
      key: keyof WarpParams,
      min: number,
      max: number,
      step: number,
      value: number,
    ): void => {
      const handle = slider({
        label,
        min,
        max,
        step,
        value,
        onInput: (v) => {
          (this.params[key] as number) = v;
          this.dirty = true;
          this.scheduleRun();
        },
      });
      this.paramSliders.push({ key, handle });
      warpSection.body.appendChild(handle.root);
    };
    addSlider('tx', 'tx', -300, 300, 1, 0);
    addSlider('ty', 'ty', -300, 300, 1, 0);
    addSlider('旋转°', 'thetaDeg', -5, 5, 0.05, 0);
    addSlider('缩放', 'scale', 0.95, 1.05, 0.001, 1);
    addSlider('剪切 X', 'shearX', -0.05, 0.05, 0.001, 0);
    addSlider('剪切 Y', 'shearY', -0.05, 0.05, 0.001, 0);
    addSlider('弯曲幅度', 'bendAmplitude', 0, 30, 0.5, 0);
    addSlider('弯曲波长', 'bendWavelength', 200, 6000, 10, 0);
    addSlider('模糊 σ', 'blurSigma', 0, 6, 0.1, 0);
    addSlider('噪声 σ', 'noiseSigma', 0, 40, 0.5, 0);
    addSlider('增益', 'gain', 0.3, 2, 0.01, 1);
    addSlider('偏移', 'offset', -80, 80, 1, 0);
    addSlider('光照梯度', 'gradient', -0.8, 0.8, 0.01, 0);
    const seedHandle = slider({
      label: '随机种子',
      min: 0,
      max: 9999,
      step: 1,
      value: 1,
      onInput: () => this.scheduleRun(),
    });
    warpSection.body.appendChild(seedHandle.root);
    warpSection.body.appendChild(
      button('全部归零', () => {
        this.params = {
          tx: 0,
          ty: 0,
          thetaDeg: 0,
          scale: 1,
          shearX: 0,
          shearY: 0,
          bendAmplitude: 0,
          bendWavelength: 0,
          blurSigma: 0,
          noiseSigma: 0,
          gain: 1,
          offset: 0,
          gradient: 0,
          occlusions: [],
        };
        for (const entry of this.paramSliders) {
          const v = this.params[entry.key];
          if (typeof v === 'number') entry.handle.set(v);
        }
        seedHandle.set(1);
        this.occlusions = [];
        this.dirty = true;
        this.renderOcclusionList();
        this.scheduleRun();
      }),
    );
    this.left.appendChild(warpSection.root);

    const occSection = section('遮挡');
    occSection.body.appendChild(
      button('画遮挡（拖框）', () => {
        this.tool = 'occlusion';
        this.ctx.setHint('在模板视图拖框添加遮挡');
      }),
    );
    const valueRow = el('div', { class: 'row' }, [el('label', { text: '填充值' })]);
    const valueInput = el('input', { type: 'number', min: 0, max: 255, step: 1, value: this.occlusionValue });
    valueInput.addEventListener('input', () => {
      const v = Number(valueInput.value);
      if (Number.isFinite(v)) this.occlusionValue = Math.min(255, Math.max(0, v));
    });
    valueRow.appendChild(valueInput);
    occSection.body.appendChild(valueRow);
    occSection.body.appendChild(this.occlusionListHost);
    this.left.appendChild(occSection.root);

    const matchSection = section('匹配参数');
    const addConfigSlider = (
      label: string,
      key: keyof AlignConfig,
      min: number,
      max: number,
      step: number,
    ): void => {
      const handle = slider({
        label,
        min,
        max,
        step,
        value: this.config[key],
        onInput: (v) => {
          this.config[key] = v;
          this.scheduleRun();
        },
      });
      matchSection.body.appendChild(handle.root);
    };
    addConfigSlider('搜索半径', 'searchRadius', 10, 400, 1);
    matchSection.body.appendChild(
      select(
        [
          { value: '1', label: '金字塔 1' },
          { value: '2', label: '金字塔 2' },
          { value: '4', label: '金字塔 4' },
          { value: '8', label: '金字塔 8' },
        ],
        String(this.config.pyramidFactor),
        (value) => {
          this.config.pyramidFactor = Number(value);
          this.scheduleRun();
        },
      ),
    );
    addConfigSlider('最小 NCC', 'minNcc', 0, 1, 0.01);
    addConfigSlider('最小唯一性', 'minUniqueness', 0, 1, 0.01);
    addConfigSlider('RANSAC 阈值', 'ransacThresholdPx', 0.5, 20, 0.5);
    addConfigSlider('OK 残差', 'okResidualPx', 0.1, 10, 0.1);
    addConfigSlider('NG 残差', 'ngResidualPx', 0.1, 20, 0.1);
    this.left.appendChild(matchSection.root);

    const roiSection = section('ROI');
    const roiButtons = el('div', { class: 'row wrap' });
    roiButtons.appendChild(
      button('恢复机台定位点', () => {
        this.rois = this.ctx.state.machineRois.map((r) => ({ ...r }));
        this.selectedRoi = -1;
        this.renderRoiList();
        this.scheduleRun();
      }),
    );
    roiButtons.appendChild(
      button('新建 ROI（拖框）', () => {
        this.tool = 'roi';
        this.ctx.setHint('在模板视图拖框新建 ROI');
      }),
    );
    roiButtons.appendChild(
      button('选择/移动', () => {
        this.tool = 'select';
        this.ctx.setHint('拖动 ROI 移动，Delete 删除选中');
      }),
    );
    roiSection.body.appendChild(roiButtons);
    roiSection.body.appendChild(this.roiListHost);
    this.left.appendChild(roiSection.root);

    const actionSection = section('执行');
    const actionRow = el('div', { class: 'row' });
    actionRow.appendChild(
      button('生成输入图', () => {
        void this.generateWarp();
      }),
    );
    actionRow.appendChild(
      button('执行对齐', () => {
        void this.runAlign();
      }, 'primary'),
    );
    actionSection.body.appendChild(actionRow);
    actionSection.body.appendChild(
      checkbox('参数变化后自动执行', this.autoRun, (checked) => {
        this.autoRun = checked;
      }),
    );
    actionSection.body.appendChild(
      select(
        [
          { value: 'template', label: '模板' },
          { value: 'input', label: '输入' },
          { value: 'diff', label: '差异' },
        ],
        this.viewKind,
        (value) => {
          this.viewKind = value === 'input' ? 'input' : value === 'diff' ? 'diff' : 'template';
          void this.showView();
        },
      ),
    );
    this.left.appendChild(actionSection.root);

    this.renderRoiList();
    this.renderOcclusionList();
  }

  private buildRight(): void {
    this.right.textContent = '';
    const verdictSection = section('判定');
    verdictSection.body.appendChild(this.resultHost);
    this.right.appendChild(verdictSection.root);
    const heatSection = section('NCC 曲面');
    heatSection.body.appendChild(this.heatmapCanvas);
    this.right.appendChild(heatSection.root);
    this.renderResult();
  }

  private renderRoiList(): void {
    this.roiListHost.textContent = '';
    if (this.rois.length === 0) {
      this.roiListHost.appendChild(el('div', { class: 'note', text: '尚无 ROI。' }));
      return;
    }
    for (let i = 0; i < this.rois.length; i++) {
      const roi = this.rois[i];
      const item = el('div', { class: i === this.selectedRoi ? 'list-item selected' : 'list-item' });
      item.appendChild(
        el('span', {
          class: 'grow',
          text: `${roi.name}  x${roi.x.toFixed(0)} y${roi.y.toFixed(0)} w${roi.w.toFixed(0)} h${roi.h.toFixed(0)}`,
        }),
      );
      item.addEventListener('click', () => {
        this.selectedRoi = i;
        this.renderRoiList();
        this.ctx.viewer.redraw();
      });
      this.roiListHost.appendChild(item);
    }
  }

  private renderOcclusionList(): void {
    this.occlusionListHost.textContent = '';
    if (this.occlusions.length === 0) {
      this.occlusionListHost.appendChild(el('div', { class: 'note', text: '尚无遮挡。' }));
      return;
    }
    for (let i = 0; i < this.occlusions.length; i++) {
      const occ = this.occlusions[i];
      const item = el('div', { class: 'list-item' });
      item.appendChild(
        el('span', {
          class: 'grow',
          text: `x${occ.x.toFixed(0)} y${occ.y.toFixed(0)} w${occ.w.toFixed(0)} h${occ.h.toFixed(0)} v${occ.value}`,
        }),
      );
      item.appendChild(
        button('删除', () => {
          this.occlusions.splice(i, 1);
          this.dirty = true;
          this.renderOcclusionList();
          this.scheduleRun();
        }),
      );
      this.occlusionListHost.appendChild(item);
    }
  }

  private scaledParams(): WarpParams {
    const s = this.scale;
    return {
      ...this.params,
      tx: this.params.tx / s,
      ty: this.params.ty / s,
      bendAmplitude: this.params.bendAmplitude / s,
      bendWavelength: this.params.bendWavelength / s,
      blurSigma: this.params.blurSigma / s,
      occlusions: this.occlusions.map((o) => ({
        x: o.x / s,
        y: o.y / s,
        w: o.w / s,
        h: o.h / s,
        value: o.value,
      })),
    };
  }

  private scaledRois(): AlignRoi[] {
    const s = this.scale;
    return this.rois.map((r) => ({ name: r.name, x: r.x / s, y: r.y / s, w: r.w / s, h: r.h / s }));
  }

  private currentChannel(): CameraChannel {
    const c = this.ctx.state.displayChannel;
    return c === 'Green' ? 'Green' : c === 'Blue' ? 'Blue' : 'Red';
  }

  private async generateWarp(): Promise<void> {
    const ctx = this.ctx;
    const start = performance.now();
    await ctx.client.request<WarpResult>({
      type: 'warp',
      source: this.source,
      setting: ctx.state.lightSetting,
      channel: this.currentChannel(),
      scale: this.scale,
      params: this.scaledParams(),
      seed: 1,
    });
    ctx.setElapsed(performance.now() - start);
    this.dirty = false;
    await this.showView();
  }

  private async showView(): Promise<void> {
    const ctx = this.ctx;
    const image = await ctx.client.request<{ width: number; height: number; data: Uint8Array }>({
      type: 'alignView',
      kind: this.viewKind,
    });
    ctx.viewer.showGray(`align-${this.viewKind}`, image);
    ctx.setCurrentGray(image, `对齐 ${this.viewKind}`);
    ctx.viewer.fit();
  }

  private async runAlign(): Promise<AlignResult | null> {
    const ctx = this.ctx;
    if (this.rois.length < 2) {
      ctx.setHint('至少需要 2 个 ROI');
      return null;
    }
    if (this.dirty) await this.generateWarp();
    const start = performance.now();
    const result = await ctx.client.latest<AlignResult>('align', {
      type: 'align',
      rois: this.scaledRois(),
      config: this.config,
      params: this.scaledParams(),
    });
    if (result === null) return null;
    this.lastResult = result;
    ctx.setElapsed(performance.now() - start);
    if (this.selectedRoi < 0 && result.report.matches.length > 0) {
      this.selectedRoi = 0;
      this.renderRoiList();
      const first = result.report.matches[0];
      if (first.surface !== null) drawHeatmap(this.heatmapCanvas, first.surface);
    }
    this.renderResult();
    ctx.viewer.redraw();
    return result;
  }

  private renderResult(): void {
    this.resultHost.textContent = '';
    const result = this.lastResult;
    if (result === null) {
      this.resultHost.appendChild(el('div', { class: 'note', text: '尚未执行对齐。' }));
      return;
    }
    const report: AlignReport = result.report;
    const head = el('div', { class: 'row' }, [badge(report.verdict.level)]);
    this.resultHost.appendChild(head);
    if (report.verdict.reasons.length > 0) {
      const list = el('ul', { class: 'reasons' });
      for (const reason of report.verdict.reasons) {
        list.appendChild(el('li', { text: `${reason.code}: ${reason.message}` }));
      }
      this.resultHost.appendChild(list);
    }
    const fit = report.fit;
    const kv = el('div', { class: 'kv' });
    const addKv = (k: string, v: string): void => {
      kv.appendChild(el('span', { class: 'k', text: k }));
      kv.appendChild(el('span', { class: 'v', text: v }));
    };
    if (fit !== null) {
      addKv('tx', formatNumber(fit.tx * this.scale, 2));
      addKv('ty', formatNumber(fit.ty * this.scale, 2));
      addKv('θ', formatNumber(fit.thetaDeg, 3));
      addKv('scale', formatNumber(fit.scale, 5));
    } else {
      addKv('拟合', '失败');
    }
    addKv('真值误差 mean', `${formatNumber(result.truth.meanErrorPx * this.scale, 3)} px`);
    addKv('真值误差 max', `${formatNumber(result.truth.maxErrorPx * this.scale, 3)} px`);
    addKv('内点残差 RMS', `${formatNumber(report.residualRms * this.scale, 3)} px`);
    addKv('平均 NCC', formatNumber(report.meanNcc, 4));
    addKv('耗时', `${formatNumber(result.elapsedMs, 1)} ms`);
    this.resultHost.appendChild(kv);

    const rows: Array<Array<string | Node>> = [];
    for (let i = 0; i < report.matches.length; i++) {
      const m: RoiMatch = report.matches[i];
      const residual = report.residuals[i];
      const tr = el('tr', { class: 'selectable' });
      tr.appendChild(el('td', { class: 'text', text: m.name }));
      tr.appendChild(el('td', { text: formatNumber(m.ncc, 4) }));
      tr.appendChild(el('td', { text: formatNumber(m.uniqueness, 4) }));
      tr.appendChild(el('td', { text: m.located ? '是' : '否' }));
      tr.appendChild(el('td', { text: residual >= 0 ? formatNumber(residual * this.scale, 3) : '—' }));
      tr.appendChild(el('td', { class: 'text wrap', text: m.reason ?? '' }));
      tr.addEventListener('click', () => {
        this.selectedRoi = i;
        this.renderRoiList();
        if (m.surface !== null) drawHeatmap(this.heatmapCanvas, m.surface);
        this.ctx.viewer.redraw();
      });
      rows.push([tr]);
    }
    const tableNode = table(['ROI', 'NCC', '唯一性', '定位', '残差', '原因'], []);
    const tbody = tableNode.querySelector('tbody');
    if (tbody !== null) {
      for (const row of rows) {
        const tr = row[0];
        if (tr instanceof HTMLTableRowElement) tbody.appendChild(tr);
      }
    }
    this.resultHost.appendChild(el('div', { class: 'table-wrap' }, [tableNode]));
  }

  activate(): void {
    const ctx = this.ctx;
    if (this.rois.length === 0) {
      this.rois = ctx.state.machineRois.map((r) => ({ ...r }));
      this.renderRoiList();
    }
    const run = async (): Promise<void> => {
      if (this.dirty) await this.generateWarp();
      else await this.showView();
      if (this.autoRun && this.lastResult === null) await this.runAlign();
    };
    run().catch((err: unknown) => ctx.setHint('错误：' + (err as Error).message));
    ctx.viewer.setOverlay((c, view) => {
      if (this.viewKind === 'template') {
        for (let i = 0; i < this.rois.length; i++) {
          const roi = this.rois[i];
          const [x0, y0] = view.toScreen(roi.x / this.scale, roi.y / this.scale);
          const [x1, y1] = view.toScreen((roi.x + roi.w) / this.scale, (roi.y + roi.h) / this.scale);
          c.strokeStyle = '#e0c83c';
          c.lineWidth = i === this.selectedRoi ? 3 : 1.5;
          c.strokeRect(x0, y0, x1 - x0, y1 - y0);
          c.fillStyle = '#e0c83c';
          c.font = '11px sans-serif';
          c.fillText(roi.name, x0 + 2, y0 + 12);
        }
        for (const occ of this.occlusions) {
          const [x0, y0] = view.toScreen(occ.x / this.scale, occ.y / this.scale);
          const [x1, y1] = view.toScreen((occ.x + occ.w) / this.scale, (occ.y + occ.h) / this.scale);
          c.fillStyle = 'rgba(224,82,82,0.25)';
          c.fillRect(x0, y0, x1 - x0, y1 - y0);
          c.strokeStyle = '#e05252';
          c.lineWidth = 1.5;
          c.strokeRect(x0, y0, x1 - x0, y1 - y0);
        }
      } else if (this.lastResult !== null) {
        const report = this.lastResult.report;
        for (let i = 0; i < report.matches.length; i++) {
          const m = report.matches[i];
          const roi = this.rois[i];
          const halfW = roi !== undefined ? roi.w / this.scale / 2 : 20;
          const halfH = roi !== undefined ? roi.h / this.scale / 2 : 20;
          const [ex, ey] = view.toScreen(m.expected[0], m.expected[1]);
          c.strokeStyle = '#8b93a1';
          c.lineWidth = 1.5;
          c.setLineDash([4, 4]);
          c.strokeRect(ex - halfW, ey - halfH, halfW * 2, halfH * 2);
          c.setLineDash([]);
          if (m.found !== null) {
            const [fx, fy] = view.toScreen(m.found[0], m.found[1]);
            c.strokeStyle = m.located ? '#3fbf6f' : '#e05252';
            c.lineWidth = 2;
            c.strokeRect(fx - halfW, fy - halfH, halfW * 2, halfH * 2);
            c.fillStyle = c.strokeStyle;
            c.font = '11px sans-serif';
            c.fillText(`${m.name} ${m.ncc.toFixed(3)}`, fx - halfW, fy - halfH - 4);
            const [tx, ty] = view.toScreen(m.template[0], m.template[1]);
            c.beginPath();
            c.moveTo(tx, ty);
            c.lineTo(fx, fy);
            c.stroke();
          }
        }
      }
      if (this.dragging) {
        const [x0, y0] = view.toScreen(
          Math.min(this.dragStart[0], this.dragCurrent[0]) / this.scale,
          Math.min(this.dragStart[1], this.dragCurrent[1]) / this.scale,
        );
        const [x1, y1] = view.toScreen(
          Math.max(this.dragStart[0], this.dragCurrent[0]) / this.scale,
          Math.max(this.dragStart[1], this.dragCurrent[1]) / this.scale,
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
    if (this.tool === 'roi' || this.tool === 'occlusion') {
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
        if (w >= 4 && h >= 4) {
          if (this.tool === 'roi') {
            this.rois.push({ name: `R${this.rois.length + 1}`, x: x * this.scale, y: y * this.scale, w: w * this.scale, h: h * this.scale });
            this.renderRoiList();
          } else {
            this.occlusions.push({ x: x * this.scale, y: y * this.scale, w: w * this.scale, h: h * this.scale, value: this.occlusionValue });
            this.renderOcclusionList();
          }
          this.dirty = true;
          this.scheduleRun();
        }
        this.tool = 'none';
        return true;
      }
      return false;
    }
    if (this.tool === 'select') {
      if (p.type === 'down' && p.button === 0) {
        const idx = this.hitTestRoi(p.x, p.y);
        if (idx >= 0) {
          this.selectedRoi = idx;
          this.moveRoiIndex = idx;
          this.moveOrigin = [p.x, p.y];
          this.dragging = true;
          this.renderRoiList();
          this.ctx.viewer.redraw();
          return true;
        }
        this.selectedRoi = -1;
        this.renderRoiList();
        this.ctx.viewer.redraw();
        return false;
      }
      if (p.type === 'move' && this.dragging && this.moveRoiIndex >= 0) {
        const roi = this.rois[this.moveRoiIndex];
        roi.x += (p.x - this.moveOrigin[0]) * this.scale;
        roi.y += (p.y - this.moveOrigin[1]) * this.scale;
        this.moveOrigin = [p.x, p.y];
        this.renderRoiList();
        this.ctx.viewer.redraw();
        return true;
      }
      if (p.type === 'up' && this.dragging) {
        this.dragging = false;
        this.moveRoiIndex = -1;
        this.dirty = true;
        this.scheduleRun();
        return true;
      }
      return false;
    }
    return false;
  }

  private hitTestRoi(x: number, y: number): number {
    const fx = x * this.scale;
    const fy = y * this.scale;
    for (let i = this.rois.length - 1; i >= 0; i--) {
      const roi = this.rois[i];
      if (fx >= roi.x && fy >= roi.y && fx <= roi.x + roi.w && fy <= roi.y + roi.h) return i;
    }
    return -1;
  }

  deactivate(): void {
    this.ctx.viewer.onPointer(null);
    this.ctx.viewer.setOverlay(null);
  }

  refresh(): void {
    if (this.source === 'light') this.dirty = true;
    if (this.ctx.state.tab === 'align' && this.autoRun) this.scheduleRun();
  }

  reset(): void {
    this.rois = this.ctx.state.machineRois.map((r) => ({ ...r }));
    this.occlusions = [];
    this.lastResult = null;
    this.selectedRoi = -1;
    this.dirty = true;
    this.renderRoiList();
    this.renderOcclusionList();
    this.renderResult();
  }

  async runFull(): Promise<unknown> {
    if (this.rois.length < 2) {
      this.rois = this.ctx.state.machineRois.map((r) => ({ ...r }));
      this.renderRoiList();
    }
    return this.runAlign();
  }

  getLeft(): HTMLElement {
    return this.left;
  }

  getRight(): HTMLElement {
    return this.right;
  }
}
