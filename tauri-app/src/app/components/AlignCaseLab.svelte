<script lang="ts">
  // ALIGN M1 case generator panel (Plan 05): one-click synthetic case with
  // ground-truth injection, side-by-side template/input previews and a
  // hideable truth sidebar (the "reveal" gate that M6's quiz mode reuses).
  // Lives over the Align/ROI (pattern) stage - it works on the currently
  // selected model and side, no extra navigation.
  import { appService, type AlignCaseOutcome, type AlignRunOutcome } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';

  let { side }: { side: 'TOP' | 'BOTTOM' } = $props();

  const target = $derived(appStore.stageTarget ?? appStore.activeSelection);
  const machine = $derived(appStore.machines.find((item) => item.id === target?.machineId) ?? null);
  const modelName = $derived(target?.modelName ?? '');

  // case definition; "random case" clears the pinned truth so the backend
  // derives it from the seed (case = seed + params, D4)
  let seed = $state(1);
  let downsample = $state(0);
  let noiseSigma = $state(3);
  let gain = $state(1);
  let offset = $state(0);
  let blurSigma = $state(0.8);
  let occlusionRatio = $state(0);
  let pinTruth = $state(false);
  let truth = $state({ tx_px: 10, ty_px: -5, theta_deg: 0.5, scale: 1 });
  let baseSource = $state<'median' | 'pattern'>('median');

  let generating = $state(false);
  let error = $state('');
  let result = $state<AlignCaseOutcome | null>(null);
  let revealTruth = $state(false); // the truth sidebar stays hidden by default

  // M2/M3: solver run over the generated case (ecc = coarse-to-fine pipeline)
  let runOutcome = $state<AlignRunOutcome | null>(null);
  let running = $state(false);

  function nextSeed(): number {
    return Math.floor(Math.random() * 900_000_000) + 1;
  }

  async function generate(random: boolean): Promise<void> {
    if (!machine || !modelName || generating) return;
    generating = true;
    error = '';
    if (random) {
      seed = nextSeed();
      pinTruth = false;
    }
    try {
      result = await appService.alignGenerateCase(machine, modelName, side, seed, {
        baseSource,
        truth: pinTruth ? { ...truth } : null,
        params: {
          noise_sigma: noiseSigma,
          gain,
          offset,
          blur_sigma: blurSigma,
          occlusion_ratio: occlusionRatio,
          downsample: downsample,
        },
      });
      runOutcome = null; // a fresh case invalidates the previous solve
    } catch (caught) {
      result = null;
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      generating = false;
    }
  }

  async function runAligner(): Promise<void> {
    if (!result || running) return;
    running = true;
    error = '';
    try {
      runOutcome = await appService.alignRun(result.case.case_id, runAlignerName);
    } catch (caught) {
      runOutcome = null;
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      running = false;
    }
  }

  // M3: "ecc" is the coarse-to-fine similarity solver; "phase" is kept as the
  // translation-only M2 baseline for teaching comparison.
  let runAlignerName = $state<'ecc' | 'phase'>('ecc');

  // M3 overlay modes (Plan 05 acceptance): red/green anaglyph, difference
  // image, flicker - all pure CSS on the existing working-grid previews.
  type OverlayMode = 'side' | 'anaglyph' | 'difference' | 'flicker';
  let overlay = $state<OverlayMode>('side');
  let flickerShowTemplate = $state(true);
  $effect(() => {
    if (overlay === 'flicker') {
      const id = setInterval(() => (flickerShowTemplate = !flickerShowTemplate), 350);
      return () => clearInterval(id);
    }
    flickerShowTemplate = true;
  });

  async function deleteCase(): Promise<void> {
    if (!result || generating) return;
    generating = true;
    error = '';
    try {
      await appService.alignDeleteCase(result.case.case_id);
      result = null;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      generating = false;
    }
  }
</script>

<div class="lab" role="region" aria-label="Align case generator">
  <div class="lab-head">
    <span class="lab-title">合成案例生成器 · {modelName || '未选模型'} · {side}</span>
    <span class="dim">同 seed 同参数 → 字节级复现（案例库存于应用数据目录 align-cases）</span>
  </div>

  <div class="lab-form">
    <label>
      seed
      <input type="number" min="1" bind:value={seed} />
    </label>
    <label>
      底图
      <select bind:value={baseSource}>
        <option value="median">MEDIAN 实拍条图</option>
        <option value="pattern">GB Pattern 金属层</option>
      </select>
    </label>
    <label>
      降采样 (0=自动)
      <input type="number" min="0" max="16" bind:value={downsample} />
    </label>
    <label>
      噪声σ
      <input type="number" min="0" step="0.5" bind:value={noiseSigma} />
    </label>
    <label>
      增益
      <input type="number" min="0" step="0.05" bind:value={gain} />
    </label>
    <label>
      偏移
      <input type="number" step="1" bind:value={offset} />
    </label>
    <label>
      模糊σ
      <input type="number" min="0" step="0.1" bind:value={blurSigma} />
    </label>
    <label>
      遮挡占比
      <input type="number" min="0" max="1" step="0.05" bind:value={occlusionRatio} />
    </label>
    <label class="pin">
      <input type="checkbox" bind:checked={pinTruth} />
      指定真值
    </label>
    {#if pinTruth}
      <label>tx <input type="number" step="0.5" bind:value={truth.tx_px} /></label>
      <label>ty <input type="number" step="0.5" bind:value={truth.ty_px} /></label>
      <label>θ° <input type="number" step="0.1" bind:value={truth.theta_deg} /></label>
      <label>scale <input type="number" step="0.001" bind:value={truth.scale} /></label>
    {/if}
    <button class="primary" disabled={generating || !machine || !modelName} onclick={() => generate(false)}>
      {generating ? '生成中…' : '生成案例'}
    </button>
    <button disabled={generating || !machine || !modelName} onclick={() => generate(true)} title="随机 seed，真值由 seed 派生">
      随机案例
    </button>
    {#if result}
      <button class="danger" disabled={generating} onclick={deleteCase}>删除本案例</button>
      <label class="solver">
        求解器
        <select bind:value={runAlignerName}>
          <option value="ecc">ECC 相似变换（M3）</option>
          <option value="phase">相位相关·仅平移（M2）</option>
        </select>
      </label>
      <button class="primary" disabled={generating || running} onclick={runAligner}>
        {running ? '求解中…' : '▶ 运行对位'}
      </button>
    {/if}
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if result}
    <div class="lab-result">
      <div class="pair" data-mode={overlay}>
        <figure>
          <img class="ch-t" class:flicker-hide={overlay === 'flicker' && !flickerShowTemplate} src="data:image/jpeg;base64,{result.template.data}" alt="template" draggable="false" />
          {#if overlay !== 'side'}
            <img class="ch-i" class:flicker-hide={overlay === 'flicker' && flickerShowTemplate} src="data:image/jpeg;base64,{result.input.data}" alt="input overlay" draggable="false" />
          {/if}
          <figcaption>
            {#if overlay === 'side'}Template（理想图）{:else if overlay === 'anaglyph'}红绿叠加（对齐区域呈黄色）{:else if overlay === 'difference'}差异图（亮 = 不重合）{:else}闪烁（3 Hz 交替两图）{/if}
          </figcaption>
        </figure>
        {#if overlay === 'side'}
          <figure>
            <img src="data:image/jpeg;base64,{result.input.data}" alt="input" draggable="false" />
            <figcaption>Input（真值变换 + 退化）</figcaption>
          </figure>
        {/if}
      </div>
      <div class="mode-toggle" role="group" aria-label="Overlay mode">
        <button class:on={overlay === 'side'} onclick={() => (overlay = 'side')}>并排</button>
        <button class:on={overlay === 'anaglyph'} onclick={() => (overlay = 'anaglyph')}>红绿</button>
        <button class:on={overlay === 'difference'} onclick={() => (overlay = 'difference')}>差异</button>
        <button class:on={overlay === 'flicker'} onclick={() => (overlay = 'flicker')}>闪烁</button>
      </div>
      <aside class="truth" class:revealed={revealTruth}>
        <button class="reveal" onclick={() => (revealTruth = !revealTruth)}>
          {revealTruth ? '隐藏真值' : '揭示真值'}
        </button>
        {#if revealTruth}
          <dl>
            <dt>tx</dt>
            <dd>{result.case.truth.tx_px.toFixed(2)} px</dd>
            <dt>ty</dt>
            <dd>{result.case.truth.ty_px.toFixed(2)} px</dd>
            <dt>θ</dt>
            <dd>{result.case.truth.theta_deg.toFixed(3)}°</dd>
            <dt>scale</dt>
            <dd>{result.case.truth.scale.toFixed(4)}</dd>
            <dt>工作网格</dt>
            <dd>{result.template.width} × {result.template.height}</dd>
            <dt>案例 id</dt>
            <dd class="mono">{result.case.case_id}</dd>
          </dl>
        {:else}
          <p class="dim">真值已隐藏——先目测估计偏移，再揭示对照。</p>
        {/if}
      </aside>
    </div>
    {#if runOutcome}
      <div class="run">
        <div class="run-head">
          <span class="badge" class:ok={runOutcome.result.ok} class:ng={!runOutcome.result.ok}>
            {runOutcome.result.ok ? 'OK' : 'NG'}
          </span>
          <span>
            {runOutcome.result.aligner} · PSR {runOutcome.result.psr.toFixed(1)} · {runOutcome.result.elapsed_ms} ms
          </span>
          <span class="dim">{runOutcome.result.message}</span>
        </div>
        <dl>
          <dt>求解 tx</dt>
          <dd>{runOutcome.result.tx_px.toFixed(2)} px</dd>
          <dt>求解 ty</dt>
          <dd>{runOutcome.result.ty_px.toFixed(2)} px</dd>
          <dt>θ / scale</dt>
          <dd>{runOutcome.result.theta_deg.toFixed(2)}° / {runOutcome.result.scale.toFixed(4)}</dd>
        </dl>
        {#if revealTruth}
          <p class="compare">
            误差 dx {runOutcome.comparison.tx_error_px.toFixed(2)} px · dy {runOutcome.comparison.ty_error_px.toFixed(2)} px · 合计
            {runOutcome.comparison.total_px.toFixed(2)} px
            {#if runOutcome.result.aligner === 'phase' && !runOutcome.comparison.translation_only}
              <span class="dim">——M2 相位相关只解平移，残余含旋转/尺度部分（切换 ECC 求解器对照）</span>
            {/if}
          </p>
        {:else}
          <p class="dim">揭示真值后显示与真值的误差对照。</p>
        {/if}
      </div>
    {/if}
  {:else if !error}
    <p class="dim hint">选择参数后点击「生成案例」；「随机案例」由 seed 派生全部随机量，可复现、可考核。</p>
  {/if}
</div>

<style>
  .lab {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    background-color: rgba(17, 17, 17, 0.96);
    overflow: auto;
  }
  .lab-head {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .lab-title {
    color: #8cc63f;
    font-weight: bold;
    font-size: 13px;
  }
  .lab-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
  }
  .lab-form label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: #aaa;
  }
  .lab-form label.pin {
    flex-direction: row;
    align-items: center;
    gap: 5px;
  }
  .lab-form input[type='number'] {
    width: 72px;
    padding: 4px 6px;
    background-color: #222;
    border: 1px solid #333;
    color: #ddd;
    font-size: 12px;
  }
  .lab-form select {
    padding: 4px 6px;
    background-color: #222;
    border: 1px solid #333;
    color: #ddd;
    font-size: 12px;
  }
  .lab-form button {
    padding: 5px 14px;
    background-color: #3a3a3a;
    border: 1px solid #111;
    color: #ddd;
    font-size: 12px;
    cursor: pointer;
  }
  .lab-form button.primary {
    background-color: #0088cc;
    color: white;
    font-weight: bold;
  }
  .lab-form button.danger {
    color: #e2755a;
  }
  .lab-form button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .lab-result {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .pair {
    display: flex;
    gap: 14px;
    flex: 1;
    min-width: 0;
  }
  figure {
    flex: 1;
    min-width: 0;
    margin: 0;
    position: relative;
  }
  figure img {
    max-width: 100%;
    border: 1px solid #333;
    background-color: #000;
  }
  figcaption {
    margin-top: 4px;
    color: #8cc63f;
    font-size: 11px;
  }
  .mode-toggle {
    display: flex;
    align-self: flex-start;
    border: 1px solid #111;
  }
  .mode-toggle button {
    padding: 5px 12px;
    background-color: #3a3a3a;
    border: 0;
    border-right: 1px solid #222;
    color: #aaa;
    font-size: 12px;
    cursor: pointer;
  }
  .mode-toggle button:last-child {
    border-right: 0;
  }
  .mode-toggle button.on {
    background-color: #0088cc;
    color: white;
  }
  /* Overlay stacking: in every overlay mode the input sits on top of the
     template; the mode decides the blend. Flicker hides whichever image is
     currently "off" (3 Hz toggle). */
  .pair[data-mode='anaglyph'] figure,
  .pair[data-mode='difference'] figure,
  .pair[data-mode='flicker'] figure {
    align-self: flex-start;
  }
  .pair[data-mode='anaglyph'] img.ch-i,
  .pair[data-mode='difference'] img.ch-i,
  .pair[data-mode='flicker'] img.ch-i {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: calc(100% - 20px);
    object-fit: contain;
  }
  .pair[data-mode='anaglyph'] img.ch-t {
    filter: grayscale(1) sepia(1) saturate(6) hue-rotate(55deg) brightness(0.8);
  }
  .pair[data-mode='anaglyph'] img.ch-i {
    mix-blend-mode: screen;
    filter: grayscale(1) sepia(1) saturate(6) hue-rotate(-45deg) brightness(0.8);
  }
  .pair[data-mode='difference'] img.ch-i {
    mix-blend-mode: difference;
  }
  .flicker-hide {
    visibility: hidden;
  }
  .truth {
    width: 220px;
    flex-shrink: 0;
    padding: 10px;
    border: 1px dashed #444;
    font-size: 12px;
  }
  .truth.revealed {
    border-color: #8cc63f;
  }
  .truth dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 8px 0 0;
  }
  .truth dt {
    color: #888;
  }
  .truth dd {
    margin: 0;
    color: #8cc63f;
  }
  .truth .reveal {
    width: 100%;
    padding: 4px 0;
    background-color: #3a3a3a;
    border: 1px solid #111;
    color: #ddd;
    cursor: pointer;
  }
  .mono {
    font-family: monospace;
    word-break: break-all;
  }
  .run {
    padding: 10px;
    border: 1px solid #333;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .run-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .run dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0;
  }
  .run dt {
    color: #888;
  }
  .run dd {
    margin: 0;
    color: #ddd;
  }
  .badge {
    padding: 2px 10px;
    font-weight: bold;
    font-size: 12px;
  }
  .badge.ok {
    background-color: #1c6b2f;
    color: white;
  }
  .badge.ng {
    background-color: #8b2f1c;
    color: white;
  }
  .compare {
    margin: 0;
    color: #8cc63f;
  }
  .dim {
    color: #888;
    font-size: 11px;
  }
  .error {
    color: #e2755a;
    font-size: 12px;
  }
  .hint {
    margin: 0;
  }
</style>
