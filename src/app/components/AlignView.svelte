<script lang="ts">
  /**
   * Align 视图：Metal 配准教学界面
   * 点击 Metal 按钮后显示，包含画 ROI 框功能和右侧分析面板
   * 还原实机界面和交互
   */
  import { appStore } from '../../lib/stores.svelte';
  import { appService, type MedianImage, type RoiRect } from '../../lib/service';
  import RoiOverlay from './RoiOverlay.svelte';
  import RoiToolPalette from './RoiToolPalette.svelte';
  import { type RoiPaletteTool } from '../../lib/roi-tools';

  let {
    image,
    metalImage,
    natW = 0,
    natH = 0,
    side,
    onClose,
  }: {
    image: MedianImage | null;
    metalImage: MedianImage | null;
    natW: number;
    natH: number;
    side: 'TOP' | 'BOTTOM';
    onClose?: () => void;
  } = $props();

  const target = $derived(appStore.stageTarget ?? appStore.activeSelection);
  const machine = $derived(appStore.machines.find((item) => item.id === target?.machineId) ?? null);

  // ROI 绘制状态
  let paletteTool = $state<RoiPaletteTool>('pointer');
  let roiCount = $state(0);
  let roiHasSelection = $state(false);
  let roiOverlay = $state<ReturnType<typeof RoiOverlay> | null>(null);

  // 图像显示状态
  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragging = $state(false);
  let dragStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  // 分析结果
  let analyzing = $state(false);
  let analysisResult = $state<{
    aligned: boolean;
    offset: { tx: number; ty: number; theta_deg: number };
    confidence: number;
  } | null>(null);

  // SR Align 复选框状态
  let srAlignExpanded = $state(true);
  let overlayMk = $state(false);
  let overlayAC = $state(false);
  let overlayLC = $state(false);
  let overlaySK = $state(false);

  const roiKey = $derived(
    target && machine
      ? `${target.machineId}|${target.modelName}|${side}|align`
      : ''
  );

  const paletteEnabled: Partial<Record<RoiPaletteTool, boolean>> = {
    pointer: true,
    'add-rect': true,
    'add-ellipse': true,
    'add-polygon': true,
    'delete-rect': true,
    'delete-ellipse': true,
    'delete-polygon': true,
    'delete-roi': true,
  };

  function handlePaletteSelect(tool: RoiPaletteTool): void {
    paletteTool = tool;
  }

  function handlePaletteClear(): void {
    roiOverlay?.clearAll();
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.max(0.5, Math.min(5, scale * delta));
  }

  function handlePointerDown(event: PointerEvent): void {
    if (event.button === 0 && paletteTool === 'pointer') {
      dragging = true;
      dragStart = {
        x: event.clientX,
        y: event.clientY,
        offsetX,
        offsetY,
      };
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (dragging) {
      offsetX = dragStart.offsetX + (event.clientX - dragStart.x);
      offsetY = dragStart.offsetY + (event.clientY - dragStart.y);
    }
  }

  function handlePointerUp(): void {
    dragging = false;
  }

  async function runAlignment(): Promise<void> {
    if (!machine || !target || roiCount === 0 || analyzing) return;
    analyzing = true;
    try {
      // 调用配准算法
      // const result = await appService.alignRunRois(...);
      // 模拟结果
      await new Promise((resolve) => setTimeout(resolve, 1500));
      analysisResult = {
        aligned: true,
        offset: { tx: 12.5, ty: -8.3, theta_deg: 0.45 },
        confidence: 0.92,
      };
    } catch (error) {
      console.error('Alignment failed:', error);
    } finally {
      analyzing = false;
    }
  }

  function resetView(): void {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
  }
</script>

<div class="align-view">
  <!-- 左侧工具栏 -->
  <div class="tool-sidebar">
    <RoiToolPalette
      enabled={paletteEnabled}
      active={paletteTool}
      onselect={handlePaletteSelect}
      onclear={handlePaletteClear}
      ariaLabel="Align ROI 工具"
    />
  </div>

  <!-- 中间图像区域 -->
  <div class="image-area">
    <div class="image-toolbar">
      <div class="toolbar-left">
        <button onclick={resetView} title="重置视图">
          <svg viewBox="0 0 24 24"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/></svg>
        </button>
        <span class="zoom-label">缩放: {(scale * 100).toFixed(0)}%</span>
      </div>
      <div class="toolbar-right">
        <button class="close-btn" onclick={onClose} title="退出 Align 模式">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div
      class="canvas-container"
      onwheel={handleWheel}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      style:cursor={paletteTool === 'pointer' ? (dragging ? 'grabbing' : 'grab') : 'crosshair'}
    >
      <div
        class="canvas-wrapper"
        style:transform="translate({offsetX}px, {offsetY}px) scale({scale})"
        style:--roi-scale={scale}
      >
        {#if image}
          <img
            src="data:image/jpeg;base64,{image.data}"
            alt="Base layer"
            draggable="false"
            class="base-image"
          />
          {#if metalImage}
            <img
              src="data:image/jpeg;base64,{metalImage.data}"
              alt="Metal layer"
              draggable="false"
              class="metal-overlay"
              style:opacity={analysisResult?.aligned ? 0.5 : 0.7}
            />
          {/if}
          <RoiOverlay
            bind:this={roiOverlay}
            {natW}
            {natH}
            tool={paletteTool === 'pointer' ? 'select' : paletteTool.replace('add-', '').replace('delete-', '') as any}
            enabled={true}
            imageKey={roiKey}
            bind:count={roiCount}
            bind:hasSelection={roiHasSelection}
          />
        {:else}
          <div class="placeholder">加载图像中...</div>
        {/if}
      </div>
    </div>
  </div>

  <!-- 右侧分析面板 -->
  <aside class="analysis-panel">
    <div class="panel-section">
      <div class="section-header">
        <span class="section-title">Align / ROI</span>
      </div>

      <div class="section-content">
        <div class="stat-row">
          <span class="stat-label">Unit</span>
          <span class="stat-value">Dummy</span>
        </div>

        <div class="subsection">
          <div class="subsection-title">Global Align :</div>
          <div class="align-rows">
            <div class="align-row">
              <span class="align-label">Light : 1</span>
              <span class="align-channel">Channel : Red</span>
            </div>
            <div class="align-row">
              <span class="align-label">Light : 2</span>
              <span class="align-channel">Channel : Red</span>
            </div>
            <div class="align-row">
              <span class="align-label">Light : 3</span>
              <span class="align-channel">Channel : Red</span>
            </div>
          </div>

          <div class="subsection-title sr-align-header" style:margin-top="12px">
            <button
              class="expand-toggle"
              onclick={() => srAlignExpanded = !srAlignExpanded}
              aria-expanded={srAlignExpanded}
            >
              <span class="arrow">{srAlignExpanded ? '▼' : '▶'}</span>
              SR Align :
            </button>
          </div>

          {#if srAlignExpanded}
            <div class="sr-align-content">
              <div class="align-row">
                <span class="align-label">Light : 3</span>
                <span class="align-arrow">►</span>
                <span class="align-channel">Channel : Red</span>
              </div>

              <div class="sr-checkboxes">
                <div class="checkbox-row">
                  <span class="checkbox-label">Ov :</span>
                  <div class="checkbox-items">
                    <label class="sr-checkbox">
                      <input type="checkbox" bind:checked={overlayMk} />
                      <span class="check-box" class:checked={overlayMk}>
                        {#if overlayMk}<span class="check-mark">✓</span>{/if}
                      </span>
                      <span class="check-text">Mk</span>
                    </label>
                    <label class="sr-checkbox">
                      <input type="checkbox" bind:checked={overlayAC} />
                      <span class="check-box" class:checked={overlayAC}>
                        {#if overlayAC}<span class="check-mark">✓</span>{/if}
                      </span>
                      <span class="check-text">A_C</span>
                    </label>
                    <label class="sr-checkbox">
                      <input type="checkbox" bind:checked={overlayLC} />
                      <span class="check-box" class:checked={overlayLC}>
                        {#if overlayLC}<span class="check-mark">✓</span>{/if}
                      </span>
                      <span class="check-text">L_C</span>
                    </label>
                    <label class="sr-checkbox">
                      <input type="checkbox" bind:checked={overlaySK} />
                      <span class="check-box" class:checked={overlaySK}>
                        {#if overlaySK}<span class="check-mark">✓</span>{/if}
                      </span>
                      <span class="check-text">SK</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <div class="subsection">
          <div class="subsection-title">Overlay</div>
          <div class="overlay-checkboxes">
            <label class="overlay-checkbox">
              <input type="checkbox" />
              <span class="check-box">
                <span class="check-mark">✓</span>
              </span>
              <span class="check-text">Mk</span>
            </label>
            <label class="overlay-checkbox">
              <input type="checkbox" />
              <span class="check-box"></span>
              <span class="check-text">A_C</span>
            </label>
            <label class="overlay-checkbox">
              <input type="checkbox" />
              <span class="check-box"></span>
              <span class="check-text">L_C</span>
            </label>
            <label class="overlay-checkbox">
              <input type="checkbox" />
              <span class="check-box"></span>
              <span class="check-text">SK</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-section result-section">
      <div class="section-header">
        <span class="section-title">对齐结果</span>
      </div>

      <div class="section-content">
        <div class="roi-info">
          <span class="info-label">ROI 数量:</span>
          <span class="info-value">{roiCount}</span>
        </div>

        <button
          class="align-btn primary"
          disabled={roiCount === 0 || analyzing}
          onclick={runAlignment}
        >
          {analyzing ? '对齐中...' : '▶ 运行对齐'}
        </button>

        {#if analysisResult}
          <div class="result-box" class:success={analysisResult.aligned}>
            <div class="result-header">
              <span class="result-status">{analysisResult.aligned ? 'OK' : 'NG'}</span>
              <span class="result-confidence">置信度: {(analysisResult.confidence * 100).toFixed(1)}%</span>
            </div>
            <div class="result-params">
              <div class="param-row">
                <span class="param-label">tx:</span>
                <span class="param-value">{analysisResult.offset.tx.toFixed(2)} px</span>
              </div>
              <div class="param-row">
                <span class="param-label">ty:</span>
                <span class="param-value">{analysisResult.offset.ty.toFixed(2)} px</span>
              </div>
              <div class="param-row">
                <span class="param-label">θ:</span>
                <span class="param-value">{analysisResult.offset.theta_deg.toFixed(3)}°</span>
              </div>
            </div>
          </div>
        {/if}

        <div class="hint-text">
          在共同特征点处画 ROI 框，然后运行对齐算法。系统将分析两层图像的偏移量并显示配准结果。
        </div>
      </div>
    </div>
  </aside>
</div>

<style>
  .align-view {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--machine-panel);
    overflow: hidden;
  }

  .tool-sidebar {
    flex: none;
    border-right: 2px solid var(--machine-line);
  }

  .image-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .image-toolbar {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: var(--machine-shell);
    border-bottom: 2px solid var(--machine-line);
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .image-toolbar button {
    width: 32px;
    height: 32px;
    padding: 6px;
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text-main);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .image-toolbar button:hover {
    border-color: var(--machine-cyan);
  }

  .image-toolbar button svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .close-btn {
    background: rgba(226, 117, 90, 0.15) !important;
    border-color: #e2755a !important;
    color: #e2755a !important;
  }

  .close-btn:hover {
    background: rgba(226, 117, 90, 0.25) !important;
  }

  .zoom-label {
    font-size: 12px;
    color: var(--status-green);
    font-weight: 600;
  }

  .canvas-container {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #000;
  }

  .canvas-wrapper {
    position: absolute;
    top: 50%;
    left: 50%;
    transform-origin: center;
    will-change: transform;
  }

  .base-image,
  .metal-overlay {
    display: block;
    pointer-events: none;
    user-select: none;
  }

  .metal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    mix-blend-mode: screen;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: var(--text-muted);
    font-size: 14px;
  }

  .analysis-panel {
    width: 320px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--machine-shell);
    border-left: 3px solid var(--machine-line);
    overflow-y: auto;
  }

  .panel-section {
    background: var(--machine-shell);
    border-bottom: 2px solid var(--machine-line);
  }

  .section-header {
    height: 38px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    background: color-mix(in srgb, var(--machine-blue) 85%, transparent);
    border-bottom: 1px solid var(--machine-line);
  }

  .section-title {
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }

  .section-content {
    padding: 14px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    font-size: 12px;
  }

  .stat-label {
    color: var(--text-muted);
  }

  .stat-value {
    color: var(--text-main);
    font-weight: 600;
  }

  .subsection {
    margin-bottom: 16px;
  }

  .subsection-title {
    color: var(--text-main);
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .sr-align-header {
    margin-bottom: 0;
  }

  .expand-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--text-main);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }

  .expand-toggle .arrow {
    font-size: 9px;
    color: var(--text-muted);
  }

  .sr-align-content {
    margin-top: 8px;
    padding: 8px;
    background: rgba(139, 48, 66, 0.15);
    border: 1px solid #8b3042;
    border-radius: 3px;
  }

  .sr-align-content .align-row {
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .align-arrow {
    color: var(--text-muted);
    font-size: 10px;
  }

  .sr-checkboxes {
    margin-top: 8px;
  }

  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .checkbox-label {
    color: var(--text-main);
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .checkbox-items {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
  }

  .sr-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-main);
  }

  .sr-checkbox input[type='checkbox'] {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .sr-checkbox .check-box {
    width: 16px;
    height: 16px;
    border: 1.5px solid #d84a5c;
    background: transparent;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    position: relative;
  }

  .sr-checkbox .check-box.checked {
    background: rgba(216, 74, 92, 0.1);
  }

  .sr-checkbox .check-mark {
    color: #4ea94c;
    font-size: 12px;
    font-weight: bold;
    line-height: 1;
  }

  .check-text {
    user-select: none;
  }

  .align-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .align-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: var(--bg-darker);
    border-radius: 3px;
    font-size: 11px;
  }

  .align-label {
    color: var(--text-main);
  }

  .align-channel {
    color: var(--status-green);
    font-weight: 600;
  }

  .overlay-checkboxes {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .overlay-checkbox {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-main);
    cursor: pointer;
  }

  .overlay-checkbox input[type='checkbox'] {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .overlay-checkbox .check-box {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-strong);
    background: var(--bg-darker);
    border-radius: 2px;
    flex-shrink: 0;
  }

  .overlay-checkbox .check-mark {
    color: var(--status-green);
    font-size: 10px;
    font-weight: bold;
    line-height: 1;
  }

  .result-section {
    flex: 1;
  }

  .roi-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    font-size: 12px;
  }

  .info-label {
    color: var(--text-muted);
  }

  .info-value {
    color: var(--status-green);
    font-weight: 600;
  }

  .align-btn {
    width: 100%;
    padding: 8px 16px;
    background: var(--bg-header);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    color: var(--text-main);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 14px;
  }

  .align-btn.primary {
    background: var(--accent-blue-bright);
    border-color: var(--accent-blue-bright);
    color: #fff;
  }

  .align-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .align-btn:not(:disabled):hover {
    filter: brightness(1.1);
  }

  .result-box {
    padding: 12px;
    background: var(--bg-darker);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    margin-bottom: 14px;
  }

  .result-box.success {
    border-color: var(--status-green);
    background: color-mix(in srgb, var(--status-green) 8%, var(--bg-darker));
  }

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .result-status {
    padding: 2px 10px;
    background: var(--status-green);
    color: #fff;
    font-size: 12px;
    font-weight: bold;
    border-radius: 3px;
  }

  .result-confidence {
    font-size: 11px;
    color: var(--text-muted);
  }

  .result-params {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .param-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .param-label {
    color: var(--text-muted);
  }

  .param-value {
    color: var(--status-green);
    font-weight: 600;
  }

  .hint-text {
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-muted);
  }
</style>
