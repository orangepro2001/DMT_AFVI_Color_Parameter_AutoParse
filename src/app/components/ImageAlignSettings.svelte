<script lang="ts">
  // The image/alignment teaching controls, extracted from CenterImage so the
  // Settings accordion can render them inside the right panel. All state and
  // actions live in CenterImage; `api` is the accessor bridge (see
  // lib/stage-api.svelte.ts). The center stage stays mounted and visible the
  // whole time - this component only hosts the controls.
  import AlignCaseLab from './AlignCaseLab.svelte';
  import type { StageSettingsApi } from '../../lib/stage-api.svelte';

  let { api }: { api: StageSettingsApi } = $props();
</script>

<div class="image-align">
  <fieldset>
    <legend>图像显示</legend>
    <div class="setting-row"><span>图像来源</span><div class="setting-buttons"><button class:on={api.stageMode === 'median'} onclick={() => api.setStageMode('median')}>MEDIAN</button><button class:on={api.stageMode === 'pattern'} onclick={() => api.setStageMode('pattern')}>Align / ROI</button></div></div>
    <div class="setting-row"><span>重新读取共享</span><button onclick={() => api.refresh()} disabled={!api.ready}>刷新图像</button></div>
    {#if api.image}<p class="setting-note path">{api.image.host} · {api.image.version}<br />{api.image.width} × {api.image.height}<br />{api.image.path}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>教学显示调整</legend>
    <label class="range-row"><span>光源 GV <b>{api.lightGv}</b></span><input type="range" min="0" max="1000" step="10" value={api.lightGv} oninput={(event) => api.setLightGv(Number(event.currentTarget.value))} /></label>
    <label class="range-row"><span>对比度 <b>{api.contrastPct}%</b></span><input type="range" min="50" max="200" step="5" value={api.contrastPct} oninput={(event) => api.setContrast(Number(event.currentTarget.value))} /></label>
    <div class="setting-row"><span class="setting-note">光源叠加会同步 GV；整体亮度/对比度仍只调整显示。</span><button onclick={() => api.resetTone()} disabled={!api.toneAdjusted}>重置显示</button></div>
  </fieldset>

  <fieldset>
    <legend>ROI 与灰度测量</legend>
    <div class="setting-buttons"><button class:on={api.drawMode} onclick={() => api.runTool('roi')} disabled={!api.hasImage}>ROI 画框</button><button class:on={api.measureMode} onclick={() => api.runTool('gv')} disabled={!api.hasImage || api.stageMode !== 'median' || api.metalOn}>测量 GV</button><button onclick={() => api.runTool('roi-delete')} disabled={!api.roiHasSelection}>删除选中</button><button onclick={() => api.runTool('roi-clear')} disabled={api.roiCount === 0}>清空 ROI</button></div>
    <p class="setting-note">已有 {api.roiCount} 个 ROI。返回 TEACH 画布后拖拽画框；Esc 退出，Delete 删除选中。GV 测量使用原始分辨率 MEDIAN。</p>
    {#if api.measureVerdict}<p class="verdict" class:error={!api.measureVerdict.ok}>{api.measureVerdict.text}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>Metal 配准教学</legend>
    <div class="setting-row"><span>错位叠加</span><button class:on={api.metalOn} disabled={!api.ready || api.stageMode !== 'median'} onclick={() => api.toggleMetal()}>{api.metalOn ? '关闭 Metal' : '叠加 Metal'}</button></div>
    <div class="setting-buttons"><button disabled={!api.metalOn || !api.hasImage || api.simBusy} onclick={() => api.generateOffset()}>生成新偏移</button><button class:on={api.alignedOn} disabled={!api.metalOn || !api.hasImage || api.simBusy || api.roiCount === 0} onclick={() => api.runAlign()}>{api.simBusy ? '对齐中…' : '用 ROI 对齐'}</button><button disabled={!api.metalOn || !api.hasImage || api.simBusy} onclick={() => api.revealTruth()}>显示正确答案</button></div>
    <p class="setting-note">开启后返回 TEACH，在两层共见特征上画 ROI，再运行配准。先观察偏移，后查看配准结果。</p>
    {#if api.simOffset}<p class="setting-note">tx {api.simOffset.tx.toFixed(1)}px · ty {api.simOffset.ty.toFixed(1)}px · θ {api.simOffset.theta_deg.toFixed(2)}°</p>{/if}
    {#if api.simVerdict}<p class="verdict" class:error={!api.simVerdict.success}>{api.simVerdict.text}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>合成案例与配准步骤</legend>
    <div class="setting-row"><span>Align / ROI 案例实验</span><button class:on={api.labOpen} disabled={!api.ready || api.stageMode !== 'pattern'} onclick={() => api.setLabOpen(!api.labOpen)}>{api.labOpen ? '收起案例实验' : '打开案例实验'}</button></div>
    <p class="setting-note">切换图像来源为 Align / ROI 后使用现有案例生成、对比、步骤讲解与配准验证。</p>
  </fieldset>

  {#if api.labOpen && api.stageMode === 'pattern'}
    <div class="lab-host"><AlignCaseLab side={api.side} host={api.host} image={api.image} natW={api.natW} natH={api.natH} /></div>
  {/if}
</div>

<style>
  .image-align { display: flex; flex-direction: column; gap: 14px; padding: 12px; color: var(--text-main); font-size: 12px; }
  fieldset { margin: 0; min-width: 0; padding: 12px 14px; border: 1px solid var(--border-strong); }
  legend { padding: 0 7px; color: var(--status-green); font-size: 12px; font-weight: 600; }
  .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; font-size: 12px; }
  .setting-row:last-child { margin-bottom: 0; }
  .setting-buttons { display: flex; flex-wrap: wrap; gap: 5px; }
  .image-align button { padding: 4px 10px; background: var(--bg-header); border: 1px solid var(--border-strong); color: var(--text-main); font: inherit; font-size: 12px; cursor: pointer; }
  .image-align button.on { color: #fff; background: var(--accent-blue-bright); border-color: var(--accent-blue-bright); }
  .image-align button:hover:not(:disabled) { border-color: var(--accent-blue-bright); }
  .image-align button:disabled { opacity: 0.4; cursor: not-allowed; }
  .range-row { display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 12px; }
  .range-row b { color: var(--status-green); padding-left: 6px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-blue-bright); }
  .setting-note { margin: 10px 0 0; font-size: 11px; color: var(--text-muted); line-height: 1.6; }
  .setting-row .setting-note { margin: 0; }
  .path { overflow-wrap: anywhere; }
  .verdict { margin: 10px 0 0; font-size: 12px; line-height: 1.5; }
  .verdict.error { color: #e2755a; }
  .lab-host { position: relative; min-height: 520px; border: 1px solid var(--border-strong); }
  .lab-host :global(.lab) { background: var(--bg-dark); }
</style>
