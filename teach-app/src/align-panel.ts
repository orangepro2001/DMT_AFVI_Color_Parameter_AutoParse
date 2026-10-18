import type { CameraChannel } from '../../teach-core/src/light.ts';
import type { AlignConfig, AlignRoi, AlignReport, NccSurface, RoiMatch } from '../../teach-core/src/align.ts';
import type { WarpParams } from '../../teach-core/src/warp.ts';
import { DEFAULT_ALIGN_CONFIG } from '../../teach-core/src/index.ts';
import type { AppContext, Panel } from './main.ts';
import type { AlignResult, WarpResult } from './protocol.ts';
import { OVERLAY, badge, button, checkbox, debounce, drawHeatmap, el, formatNumber, section, select, slider, table } from './ui.ts';
import { defineMessages, t } from './i18n.ts';

defineMessages({
  zh: {
    'align.section.source': '源图',
    'align.source.median': 'MEDIAN 原图',
    'align.source.light': '当前光照渲染图',
    'align.section.warp': '扭曲参数',
    'align.param.tx': 'tx',
    'align.param.ty': 'ty',
    'align.param.theta': '旋转°',
    'align.param.scale': '缩放',
    'align.param.shearX': '剪切 X',
    'align.param.shearY': '剪切 Y',
    'align.param.bendAmplitude': '弯曲幅度',
    'align.param.bendWavelength': '弯曲波长',
    'align.param.blurSigma': '模糊 σ',
    'align.param.noiseSigma': '噪声 σ',
    'align.param.gain': '增益',
    'align.param.offset': '偏移',
    'align.param.gradient': '光照梯度',
    'align.param.seed': '随机种子',
    'align.resetAll': '全部归零',
    'align.section.occlusion': '遮挡',
    'align.occlusion.draw': '画遮挡（拖框）',
    'align.occlusion.hint': '在模板视图拖框添加遮挡',
    'align.occlusion.fill': '填充值',
    'align.occlusion.empty': '尚无遮挡。',
    'align.occlusion.delete': '删除',
    'align.section.match': '匹配参数',
    'align.match.searchRadius': '搜索半径',
    'align.match.pyramid1': '金字塔 1',
    'align.match.pyramid2': '金字塔 2',
    'align.match.pyramid4': '金字塔 4',
    'align.match.pyramid8': '金字塔 8',
    'align.match.minNcc': '最小 NCC',
    'align.match.minUniqueness': '最小唯一性',
    'align.match.ransac': 'RANSAC 阈值',
    'align.match.okResidual': 'OK 残差',
    'align.match.ngResidual': 'NG 残差',
    'align.section.roi': 'ROI',
    'align.roi.restore': '恢复机台定位点',
    'align.roi.new': '新建 ROI（拖框）',
    'align.roi.newHint': '在模板视图拖框新建 ROI',
    'align.roi.select': '选择/移动',
    'align.roi.selectHint': '拖动 ROI 移动，Delete 删除选中',
    'align.roi.empty': '尚无 ROI。',
    'align.section.action': '执行',
    'align.action.generate': '生成输入图',
    'align.action.run': '执行对齐',
    'align.action.autoRun': '参数变化后自动执行',
    'align.view.template': '模板',
    'align.view.input': '输入',
    'align.view.diff': '差异',
    'align.section.verdict': '判定',
    'align.section.ncc': 'NCC 曲面',
    'align.result.empty': '尚未执行对齐。',
    'align.result.fitFailed': '失败',
    'align.result.fit': '拟合',
    'align.result.truthMean': '真值误差 mean',
    'align.result.truthMax': '真值误差 max',
    'align.result.residualRms': '内点残差 RMS',
    'align.result.meanNcc': '平均 NCC',
    'align.result.elapsed': '耗时',
    'align.col.roi': 'ROI',
    'align.col.ncc': 'NCC',
    'align.col.uniqueness': '唯一性',
    'align.col.located': '定位',
    'align.col.residual': '残差',
    'align.col.reason': '原因',
    'align.yes': '是',
    'align.no': '否',
    'align.needRois': '至少需要 2 个 ROI',
    'align.currentGray': '对齐 {kind}',
  },
  en: {
    'align.section.source': 'Source',
    'align.source.median': 'MEDIAN original',
    'align.source.light': 'Current lighting render',
    'align.section.warp': 'Warp Parameters',
    'align.param.tx': 'tx',
    'align.param.ty': 'ty',
    'align.param.theta': 'Rotation°',
    'align.param.scale': 'Scale',
    'align.param.shearX': 'Shear X',
    'align.param.shearY': 'Shear Y',
    'align.param.bendAmplitude': 'Bend amplitude',
    'align.param.bendWavelength': 'Bend wavelength',
    'align.param.blurSigma': 'Blur σ',
    'align.param.noiseSigma': 'Noise σ',
    'align.param.gain': 'Gain',
    'align.param.offset': 'Offset',
    'align.param.gradient': 'Lighting gradient',
    'align.param.seed': 'Random seed',
    'align.resetAll': 'Reset All',
    'align.section.occlusion': 'Occlusion',
    'align.occlusion.draw': 'Draw occlusion (drag box)',
    'align.occlusion.hint': 'Drag a box on the template view to add an occlusion',
    'align.occlusion.fill': 'Fill value',
    'align.occlusion.empty': 'No occlusions yet.',
    'align.occlusion.delete': 'Delete',
    'align.section.match': 'Matching Parameters',
    'align.match.searchRadius': 'Search range',
    'align.match.pyramid1': 'Pyramid 1',
    'align.match.pyramid2': 'Pyramid 2',
    'align.match.pyramid4': 'Pyramid 4',
    'align.match.pyramid8': 'Pyramid 8',
    'align.match.minNcc': 'Min NCC',
    'align.match.minUniqueness': 'Min uniqueness',
    'align.match.ransac': 'RANSAC threshold',
    'align.match.okResidual': 'OK residual',
    'align.match.ngResidual': 'NG residual',
    'align.section.roi': 'ROI',
    'align.roi.restore': 'Restore machine anchors',
    'align.roi.new': 'New ROI (drag box)',
    'align.roi.newHint': 'Drag a box on the template view to create an ROI',
    'align.roi.select': 'Select/Move',
    'align.roi.selectHint': 'Drag an ROI to move it, press Delete to remove the selected one',
    'align.roi.empty': 'No ROIs yet.',
    'align.section.action': 'Run',
    'align.action.generate': 'Generate input image',
    'align.action.run': 'Run alignment',
    'align.action.autoRun': 'Auto run on parameter change',
    'align.view.template': 'Template',
    'align.view.input': 'Input',
    'align.view.diff': 'Difference',
    'align.section.verdict': 'Verdict',
    'align.section.ncc': 'NCC Surface',
    'align.result.empty': 'Alignment has not been run yet.',
    'align.result.fitFailed': 'Failed',
    'align.result.fit': 'Fit',
    'align.result.truthMean': 'Truth error mean',
    'align.result.truthMax': 'Truth error max',
    'align.result.residualRms': 'Inlier residual RMS',
    'align.result.meanNcc': 'Mean NCC',
    'align.result.elapsed': 'Elapsed',
    'align.col.roi': 'ROI',
    'align.col.ncc': 'NCC',
    'align.col.uniqueness': 'Uniqueness',
    'align.col.located': 'Located',
    'align.col.residual': 'Residual',
    'align.col.reason': 'Reason',
    'align.yes': 'Yes',
    'align.no': 'No',
    'align.needRois': 'At least 2 ROIs are required',
    'align.currentGray': 'Align {kind}',
  },
  ko: {
    'align.section.source': '소스',
    'align.source.median': 'MEDIAN 원본',
    'align.source.light': '현재 조명 렌더링',
    'align.section.warp': '왜곡 파라미터',
    'align.param.tx': 'tx',
    'align.param.ty': 'ty',
    'align.param.theta': '회전°',
    'align.param.scale': '스케일',
    'align.param.shearX': '전단 X',
    'align.param.shearY': '전단 Y',
    'align.param.bendAmplitude': '굽힘 진폭',
    'align.param.bendWavelength': '굽힘 파장',
    'align.param.blurSigma': '블러 σ',
    'align.param.noiseSigma': '노이즈 σ',
    'align.param.gain': '게인',
    'align.param.offset': '오프셋',
    'align.param.gradient': '조명 그라디언트',
    'align.param.seed': '랜덤 시드',
    'align.resetAll': '모두 초기화',
    'align.section.occlusion': '가림',
    'align.occlusion.draw': '가림 그리기 (드래그 박스)',
    'align.occlusion.hint': '템플릿 뷰에서 박스를 드래그하여 가림을 추가합니다',
    'align.occlusion.fill': '채움 값',
    'align.occlusion.empty': '아직 가림이 없습니다.',
    'align.occlusion.delete': '삭제',
    'align.section.match': '매칭 파라미터',
    'align.match.searchRadius': '탐색 범위',
    'align.match.pyramid1': '피라미드 1',
    'align.match.pyramid2': '피라미드 2',
    'align.match.pyramid4': '피라미드 4',
    'align.match.pyramid8': '피라미드 8',
    'align.match.minNcc': '최소 NCC',
    'align.match.minUniqueness': '최소 고유성',
    'align.match.ransac': 'RANSAC 임계값',
    'align.match.okResidual': 'OK 잔차',
    'align.match.ngResidual': 'NG 잔차',
    'align.section.roi': 'ROI',
    'align.roi.restore': '기계 기준점 복원',
    'align.roi.new': 'ROI 생성 (드래그 박스)',
    'align.roi.newHint': '템플릿 뷰에서 박스를 드래그하여 ROI 를 생성합니다',
    'align.roi.select': '선택/이동',
    'align.roi.selectHint': 'ROI 를 드래그하여 이동, Delete 로 선택 항목 삭제',
    'align.roi.empty': '아직 ROI 가 없습니다.',
    'align.section.action': '실행',
    'align.action.generate': '입력 이미지 생성',
    'align.action.run': '정렬 실행',
    'align.action.autoRun': '파라미터 변경 시 자동 실행',
    'align.view.template': '템플릿',
    'align.view.input': '입력',
    'align.view.diff': '차이',
    'align.section.verdict': '판정',
    'align.section.ncc': 'NCC 곡면',
    'align.result.empty': '아직 정렬을 실행하지 않았습니다.',
    'align.result.fitFailed': '실패',
    'align.result.fit': '피팅',
    'align.result.truthMean': '정답 오차 mean',
    'align.result.truthMax': '정답 오차 max',
    'align.result.residualRms': '인라이어 잔차 RMS',
    'align.result.meanNcc': '평균 NCC',
    'align.result.elapsed': '소요',
    'align.col.roi': 'ROI',
    'align.col.ncc': 'NCC',
    'align.col.uniqueness': '고유성',
    'align.col.located': '위치',
    'align.col.residual': '잔차',
    'align.col.reason': '원인',
    'align.yes': '예',
    'align.no': '아니오',
    'align.needRois': 'ROI 가 최소 2 개 필요합니다',
    'align.currentGray': '정렬 {kind}',
  },
});

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
  private heatSurface: NccSurface | null = null;
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

    const sourceSection = section(t('align.section.source'));
    sourceSection.body.appendChild(
      select(
        [
          { value: 'median', label: t('align.source.median') },
          { value: 'light', label: t('align.source.light') },
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

    const warpSection = section(t('align.section.warp'));
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
    addSlider(t('align.param.tx'), 'tx', -300, 300, 1, 0);
    addSlider(t('align.param.ty'), 'ty', -300, 300, 1, 0);
    addSlider(t('align.param.theta'), 'thetaDeg', -5, 5, 0.05, 0);
    addSlider(t('align.param.scale'), 'scale', 0.95, 1.05, 0.001, 1);
    addSlider(t('align.param.shearX'), 'shearX', -0.05, 0.05, 0.001, 0);
    addSlider(t('align.param.shearY'), 'shearY', -0.05, 0.05, 0.001, 0);
    addSlider(t('align.param.bendAmplitude'), 'bendAmplitude', 0, 30, 0.5, 0);
    addSlider(t('align.param.bendWavelength'), 'bendWavelength', 200, 6000, 10, 0);
    addSlider(t('align.param.blurSigma'), 'blurSigma', 0, 6, 0.1, 0);
    addSlider(t('align.param.noiseSigma'), 'noiseSigma', 0, 40, 0.5, 0);
    addSlider(t('align.param.gain'), 'gain', 0.3, 2, 0.01, 1);
    addSlider(t('align.param.offset'), 'offset', -80, 80, 1, 0);
    addSlider(t('align.param.gradient'), 'gradient', -0.8, 0.8, 0.01, 0);
    const seedHandle = slider({
      label: t('align.param.seed'),
      min: 0,
      max: 9999,
      step: 1,
      value: 1,
      onInput: () => this.scheduleRun(),
    });
    warpSection.body.appendChild(seedHandle.root);
    warpSection.body.appendChild(
      button(t('align.resetAll'), () => {
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

    const occSection = section(t('align.section.occlusion'));
    occSection.body.appendChild(
      button(t('align.occlusion.draw'), () => {
        this.tool = 'occlusion';
        this.ctx.setHint(t('align.occlusion.hint'));
      }),
    );
    const valueRow = el('div', { class: 'row' }, [el('label', { text: t('align.occlusion.fill') })]);
    const valueInput = el('input', { type: 'number', min: 0, max: 255, step: 1, value: this.occlusionValue });
    valueInput.addEventListener('input', () => {
      const v = Number(valueInput.value);
      if (Number.isFinite(v)) this.occlusionValue = Math.min(255, Math.max(0, v));
    });
    valueRow.appendChild(valueInput);
    occSection.body.appendChild(valueRow);
    occSection.body.appendChild(this.occlusionListHost);
    this.left.appendChild(occSection.root);

    const matchSection = section(t('align.section.match'));
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
    addConfigSlider(t('align.match.searchRadius'), 'searchRadius', 10, 400, 1);
    matchSection.body.appendChild(
      select(
        [
          { value: '1', label: t('align.match.pyramid1') },
          { value: '2', label: t('align.match.pyramid2') },
          { value: '4', label: t('align.match.pyramid4') },
          { value: '8', label: t('align.match.pyramid8') },
        ],
        String(this.config.pyramidFactor),
        (value) => {
          this.config.pyramidFactor = Number(value);
          this.scheduleRun();
        },
      ),
    );
    addConfigSlider(t('align.match.minNcc'), 'minNcc', 0, 1, 0.01);
    addConfigSlider(t('align.match.minUniqueness'), 'minUniqueness', 0, 1, 0.01);
    addConfigSlider(t('align.match.ransac'), 'ransacThresholdPx', 0.5, 20, 0.5);
    addConfigSlider(t('align.match.okResidual'), 'okResidualPx', 0.1, 10, 0.1);
    addConfigSlider(t('align.match.ngResidual'), 'ngResidualPx', 0.1, 20, 0.1);
    this.left.appendChild(matchSection.root);

    const roiSection = section(t('align.section.roi'));
    const roiButtons = el('div', { class: 'row wrap' });
    roiButtons.appendChild(
      button(t('align.roi.restore'), () => {
        this.rois = this.ctx.state.machineRois.map((r) => ({ ...r }));
        this.selectedRoi = -1;
        this.renderRoiList();
        this.scheduleRun();
      }),
    );
    roiButtons.appendChild(
      button(t('align.roi.new'), () => {
        this.tool = 'roi';
        this.ctx.setHint(t('align.roi.newHint'));
      }),
    );
    roiButtons.appendChild(
      button(t('align.roi.select'), () => {
        this.tool = 'select';
        this.ctx.setHint(t('align.roi.selectHint'));
      }),
    );
    roiSection.body.appendChild(roiButtons);
    roiSection.body.appendChild(this.roiListHost);
    this.left.appendChild(roiSection.root);

    const actionSection = section(t('align.section.action'));
    const actionRow = el('div', { class: 'row' });
    actionRow.appendChild(
      button(t('align.action.generate'), () => {
        void this.generateWarp();
      }),
    );
    actionRow.appendChild(
      button(t('align.action.run'), () => {
        void this.runAlign();
      }, 'primary'),
    );
    actionSection.body.appendChild(actionRow);
    actionSection.body.appendChild(
      checkbox(t('align.action.autoRun'), this.autoRun, (checked) => {
        this.autoRun = checked;
      }),
    );
    actionSection.body.appendChild(
      select(
        [
          { value: 'template', label: t('align.view.template') },
          { value: 'input', label: t('align.view.input') },
          { value: 'diff', label: t('align.view.diff') },
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
    const verdictSection = section(t('align.section.verdict'));
    verdictSection.body.appendChild(this.resultHost);
    this.right.appendChild(verdictSection.root);
    const heatSection = section(t('align.section.ncc'));
    heatSection.body.appendChild(this.heatmapCanvas);
    this.right.appendChild(heatSection.root);
    this.renderResult();
  }

  private renderRoiList(): void {
    this.roiListHost.textContent = '';
    if (this.rois.length === 0) {
      this.roiListHost.appendChild(el('div', { class: 'note', text: t('align.roi.empty') }));
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
      this.occlusionListHost.appendChild(el('div', { class: 'note', text: t('align.occlusion.empty') }));
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
        button(t('align.occlusion.delete'), () => {
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
    ctx.setCurrentGray(image, t('align.currentGray', { kind: this.viewKind }));
    ctx.viewer.fit();
  }

  private async runAlign(): Promise<AlignResult | null> {
    const ctx = this.ctx;
    if (this.rois.length < 2) {
      ctx.setHint(t('align.needRois'));
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
      if (first.surface !== null) {
        this.heatSurface = first.surface;
        drawHeatmap(this.heatmapCanvas, first.surface);
      }
    }
    this.renderResult();
    ctx.viewer.redraw();
    return result;
  }

  private renderResult(): void {
    this.resultHost.textContent = '';
    const result = this.lastResult;
    if (result === null) {
      this.resultHost.appendChild(el('div', { class: 'note', text: t('align.result.empty') }));
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
      addKv(t('align.result.fit'), t('align.result.fitFailed'));
    }
    addKv(t('align.result.truthMean'), `${formatNumber(result.truth.meanErrorPx * this.scale, 3)} px`);
    addKv(t('align.result.truthMax'), `${formatNumber(result.truth.maxErrorPx * this.scale, 3)} px`);
    addKv(t('align.result.residualRms'), `${formatNumber(report.residualRms * this.scale, 3)} px`);
    addKv(t('align.result.meanNcc'), formatNumber(report.meanNcc, 4));
    addKv(t('align.result.elapsed'), `${formatNumber(result.elapsedMs, 1)} ms`);
    this.resultHost.appendChild(kv);

    const rows: Array<Array<string | Node>> = [];
    for (let i = 0; i < report.matches.length; i++) {
      const m: RoiMatch = report.matches[i];
      const residual = report.residuals[i];
      const tr = el('tr', { class: 'selectable' });
      tr.appendChild(el('td', { class: 'text', text: m.name }));
      tr.appendChild(el('td', { text: formatNumber(m.ncc, 4) }));
      tr.appendChild(el('td', { text: formatNumber(m.uniqueness, 4) }));
      tr.appendChild(el('td', { text: m.located ? t('align.yes') : t('align.no') }));
      tr.appendChild(el('td', { text: residual >= 0 ? formatNumber(residual * this.scale, 3) : '—' }));
      tr.appendChild(el('td', { class: 'text wrap', text: m.reason ?? '' }));
      tr.addEventListener('click', () => {
        this.selectedRoi = i;
        this.renderRoiList();
        if (m.surface !== null) {
          this.heatSurface = m.surface;
          drawHeatmap(this.heatmapCanvas, m.surface);
        }
        this.ctx.viewer.redraw();
      });
      rows.push([tr]);
    }
    const tableNode = table(
      [
        t('align.col.roi'),
        t('align.col.ncc'),
        t('align.col.uniqueness'),
        t('align.col.located'),
        t('align.col.residual'),
        t('align.col.reason'),
      ],
      [],
    );
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
    run().catch((err: unknown) => ctx.setHint(t('common.error', { msg: (err as Error).message })));
    ctx.viewer.setOverlay((c, view) => {
      if (this.viewKind === 'template') {
        for (let i = 0; i < this.rois.length; i++) {
          const roi = this.rois[i];
          const [x0, y0] = view.toScreen(roi.x / this.scale, roi.y / this.scale);
          const [x1, y1] = view.toScreen((roi.x + roi.w) / this.scale, (roi.y + roi.h) / this.scale);
          c.strokeStyle = OVERLAY.warn;
          c.lineWidth = i === this.selectedRoi ? 3 : 1.5;
          c.strokeRect(x0, y0, x1 - x0, y1 - y0);
          c.fillStyle = OVERLAY.warn;
          c.font = OVERLAY.font;
          c.fillText(roi.name, x0 + 2, y0 + 12);
        }
        for (const occ of this.occlusions) {
          const [x0, y0] = view.toScreen(occ.x / this.scale, occ.y / this.scale);
          const [x1, y1] = view.toScreen((occ.x + occ.w) / this.scale, (occ.y + occ.h) / this.scale);
          c.fillStyle = OVERLAY.ngFill;
          c.fillRect(x0, y0, x1 - x0, y1 - y0);
          c.strokeStyle = OVERLAY.ng;
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
          c.strokeStyle = OVERLAY.muted;
          c.lineWidth = 1.5;
          c.setLineDash([4, 4]);
          c.strokeRect(ex - halfW, ey - halfH, halfW * 2, halfH * 2);
          c.setLineDash([]);
          if (m.found !== null) {
            const [fx, fy] = view.toScreen(m.found[0], m.found[1]);
            c.strokeStyle = m.located ? OVERLAY.ok : OVERLAY.ng;
            c.lineWidth = 2;
            c.strokeRect(fx - halfW, fy - halfH, halfW * 2, halfH * 2);
            c.fillStyle = c.strokeStyle;
            c.font = OVERLAY.font;
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
        c.strokeStyle = OVERLAY.roi;
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

  themeChanged(): void {
    if (this.heatSurface !== null) drawHeatmap(this.heatmapCanvas, this.heatSurface);
  }

  refresh(): void {
    if (this.source === 'light') this.dirty = true;
    if (this.ctx.state.tab === 'align' && this.autoRun) this.scheduleRun();
  }

  reset(): void {
    this.rois = this.ctx.state.machineRois.map((r) => ({ ...r }));
    this.occlusions = [];
    this.lastResult = null;
    this.heatSurface = null;
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
