<script lang="ts">
  import ModelPickerDialog from './ModelPickerDialog.svelte';
  import { appService, type Machine } from '../../lib/service';
  import { appStore, setActiveConnector } from '../../lib/stores.svelte';

  let selectedMachineId = $state('');
  let modelName = $state('');
  let loading = $state(false);
  let isError = $state(false);
  let statusMessage = $state('');
  let isModelPickerOpen = $state(false);
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const selectedMachine = $derived(appStore.machines.find(machine => machine.id === selectedMachineId));

  $effect(() => {
    selectedMachineId = appStore.activeConnector?.machineId ?? appStore.activeSelection?.machineId ?? '';
    modelName = appStore.activeSelection?.modelName ?? '';
  });

  async function loadModel(): Promise<void> {
    const machine = selectedMachine;
    const name = modelName.trim();
    if (!machine || !name) return;
    const seq = ++request;
    loading = true;
    isError = false;
    statusMessage = '正在读取型号 XML…';
    try {
      const record = await appService.getModelData(machine.id, name);
      if (seq !== request) return;
      if (!record) throw new Error('机台不存在。');
      await appService.saveActiveSelection({ machineId: machine.id, modelName: record.modelName });
      appStore.stageTarget = { machineId: machine.id, modelName: record.modelName };
      statusMessage = '型号已加载到 TEACH / CALIBRATE，参数修改仅在本次会话内保留。';
    } catch (error) {
      if (seq !== request) return;
      isError = true;
      statusMessage = error instanceof Error ? error.message : String(error);
    } finally {
      if (seq === request) loading = false;
    }
  }

  function onTargetChanged(): void {
    request++;
    loading = false;
    statusMessage = '';
    if (selectedMachineId) setActiveConnector({ machineId: selectedMachineId, host: appStore.activeConnector?.host ?? 'FM1' });
    if (modelName.trim()) void loadModel();
  }

  function onModelInputChanged(): void {
    request++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void loadModel(); }, 400);
  }

  $effect(() => () => { if (timer) clearTimeout(timer); });

  function onModelPicked(machine: Machine, name: string): void {
    selectedMachineId = machine.id;
    modelName = name;
    void loadModel();
  }

  function clearSelection(): void {
    request++;
    if (timer) clearTimeout(timer);
    modelName = '';
    loading = false;
    statusMessage = '';
    appStore.stageTarget = null;
    appStore.teachSelection = null;
    appStore.selectionEpoch++;
    void appService.clearActiveSelection().catch(error => {
      isError = true;
      statusMessage = String(error);
    });
  }
</script>

<section class="container">
  <h2>型号选择</h2>
  <div class="card">
    <p class="desc">选择机台和型号，实时读取 PxInventory 中的光源与检测参数。</p>
    <div class="form-group">
      <label for="model-machine">AFVI Device</label>
      <select id="model-machine" bind:value={selectedMachineId} onchange={onTargetChanged}>
        <option value="">-- Choose a machine --</option>
        {#each appStore.machines as machine (machine.id)}<option value={machine.id}>{machine.name}</option>{/each}
      </select>
    </div>
    <div class="form-group">
      <label for="model-name">Model Name</label>
      <div class="model-input">
        <input id="model-name" bind:value={modelName} oninput={onModelInputChanged} placeholder="Select or type a model name, e.g. 6ST2001Q01">
        <button type="button" class="choose-button" disabled={!selectedMachineId} onclick={() => (isModelPickerOpen = true)}>Choose Model</button>
      </div>
    </div>
    {#if selectedMachine}<div class="target-summary">Target: <strong>{selectedMachine.name}</strong><span>FM1 / FM2 / BM · 参数仅在会话内存中解析。</span></div>{/if}
    <div class="action-row">
      <button class="btn-primary" type="button" onclick={loadModel} disabled={loading || !selectedMachine || !modelName.trim()}>{loading ? '读取中…' : '加载型号'}</button>
      {#if appStore.activeSelection}<button class="btn-open" type="button" onclick={() => (appStore.activeTab = 'teach')}>Open TEACH</button>{/if}
      <button class="btn-clear" type="button" onclick={clearSelection} disabled={loading || !modelName.trim()}>Clear</button>
    </div>
    {#if statusMessage}<div class="status-box" class:error={isError}>{statusMessage}</div>{/if}
  </div>
</section>
<ModelPickerDialog bind:open={isModelPickerOpen} machineId={selectedMachineId} onapply={onModelPicked} />

<style>
  .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: var(--text-main); margin: 0 0 16px; font-size: 20px; }
  .card { background: var(--bg-panel); border: 1px solid var(--bg-elev); border-radius: 4px; padding: 20px; } .desc { color: var(--text-muted); font-size: 13px; line-height: 1.45; margin: 0 0 20px; }
  .form-group { margin: 0 0 14px; } label { display: block; color: var(--text-muted); font-size: 12px; margin-bottom: 6px; } select, input { background: var(--bg-input); border: 1px solid var(--bg-elev); box-sizing: border-box; color: var(--text-main); height: 36px; padding: 7px 10px; width: 100%; } select:focus, input:focus { border-color: var(--accent-blue-bright); outline: none; }
  .model-input { display: flex; } .model-input input { border-right: 0; } .choose-button { background: var(--bg-elev); border: 1px solid var(--bg-elev); color: var(--text-main); min-width: 116px; cursor: pointer; } .choose-button:disabled { color: var(--text-muted); cursor: default; }
  .target-summary { color: var(--text-muted); font-size: 11px; margin: -2px 0 14px; } .target-summary strong { color: var(--status-green); } .target-summary span { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-row { display: flex; gap: 8px; } .btn-primary { background: var(--accent-blue-bright); border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; width: 100%; } .btn-primary:disabled { background: var(--bg-elev); color: var(--text-muted); cursor: default; }
  .btn-open { background: #2e7d46; border: 0; color: #fff; cursor: pointer; flex: 0 0 auto; font-weight: 700; height: 36px; padding: 0 16px; } .btn-open:hover { background: #379454; }
  .btn-clear { background: var(--border-color); border: 0; color: #fff; cursor: pointer; flex: 0 0 auto; font-weight: 700; height: 36px; padding: 0 16px; } .btn-clear:hover:not(:disabled) { background: var(--toggle-bg)55e; }
  .btn-clear:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-box { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 15px; padding: 10px; } .status-box.error { background: #4a2d2d; border-left-color: #ff5252; }
</style>
