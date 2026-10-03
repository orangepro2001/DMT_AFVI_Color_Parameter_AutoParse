<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type ExportConfig, type ModelCandidate, type StoredModelRecord } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';

  let selectedMachineId = $state('');
  let modelName = $state('');
  let isCollecting = $state(false);
  let isScanning = $state(false);
  let isError = $state(false);
  let isHint = $state(false);
  let statusMessage = $state('');
  let isModelPickerOpen = $state(false);
  let modelCandidates = $state<ModelCandidate[]>([]);
  let modelFilter = $state('');
  let selectedModelCandidate = $state<ModelCandidate | null>(null);
  // Snapshot of the model in the local database, if one was collected before.
  let existingRecord = $state<StoredModelRecord | null>(null);
  let exportConfig = $state<ExportConfig>({ exportPath: '', templatePath: '' });
  let isExporting = $state(false);
  let exportSummary = $state('');
  let toast = $state('');
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let configTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedMachine = $derived(appStore.machines.find((machine) => machine.id === selectedMachineId));
  const hasExistingData = $derived(!!existingRecord);
  // Highlight Collect while the selected model has no data to load yet.
  const needsCollect = $derived(!hasExistingData && !!selectedMachine && !!modelName.trim());
  const filteredModelCandidates = $derived.by(() => {
    const needle = modelFilter.trim().toUpperCase();
    return needle ? modelCandidates.filter((model) => model.name.toUpperCase().includes(needle)) : modelCandidates;
  });

  onMount(() => {
    (async () => {
      appStore.machines = await appService.getMachines();
      const active = appStore.activeSelection ?? await appService.getActiveSelection();
      if (active) appStore.activeSelection = active;
      exportConfig = await appService.getExportConfig();
      if (active && appStore.machines.some((machine) => machine.id === active.machineId)) {
        // Reopen on the model that is already active; no toast on a silent restore.
        selectedMachineId = active.machineId;
        modelName = active.modelName;
        await checkExisting(false);
      }
    })();
    return () => {
      if (checkTimer) clearTimeout(checkTimer);
      if (toastTimer) clearTimeout(toastTimer);
      if (configTimer) clearTimeout(configTimer);
    };
  });

  function onExportConfigChanged(): void {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(() => {
      configTimer = null;
      appService.saveExportConfig(exportConfig).then(() => {
        exportSummary = '';
      }).catch((error) => {
        exportSummary = `Saving the paths failed - they will be lost on restart: ${typeof error === 'string' ? error : 'unexpected error'}. Check the Database tab (Test Connection).`;
      });
    }, 500);
  }

  async function exportExcel(): Promise<void> {
    const machine = selectedMachine;
    if (!machine || !modelName.trim()) return;
    // no hardcoded fallback: the paths live in the database and are configured
    // once; exporting demands both of them explicitly
    const exportPath = exportConfig.exportPath.trim();
    const templatePath = exportConfig.templatePath.trim();
    if (!exportPath || !templatePath) {
      isHint = true;
      isError = false;
      statusMessage = 'Set the export path and the template workbook path first - they are saved to the database and remembered.';
      return;
    }
    isExporting = true;
    exportSummary = '';
    isError = false;
    isHint = false;
    statusMessage = 'Exporting the parameter workbook...';
    try {
      const config: ExportConfig = { exportPath, templatePath };
      const report = await appService.exportParameterExcel(machine.id, modelName, machine.name, config);
      const filled = report.sheets.reduce((sum, s) => sum + s.filledCells, 0);
      const gv = report.sheets.reduce((sum, s) => sum + s.gvCells, 0);
      const axis = report.sheets.reduce((sum, s) => sum + (s.axisCells ?? 0), 0);
      const appended = report.sheets.flatMap((s) => s.appendedAreas);
      const unresolved = report.sheets.reduce((sum, s) => sum + s.unresolvedLabels.length, 0);
      exportSummary = `Saved ${report.outputPath} - ${filled} parameter cells, ${gv} GV cells${
        axis ? `, ${axis} light-axis ratios` : ''
      }${appended.length ? `, completed areas: ${appended.join(', ')}` : ''}${
        unresolved ? `, ${unresolved} labels need manual attention` : ''
      }.`;
      statusMessage = `Export complete: ${report.fileName}`;
      isError = false;
      isHint = false;
      showToast(`Parameter Excel exported: ${report.fileName}`);
    } catch (error) {
      isError = true;
      statusMessage = `Export failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
    } finally {
      isExporting = false;
    }
  }

  function onTargetChanged(): void {
    modelCandidates = [];
    selectedModelCandidate = null;
    existingRecord = null;
    statusMessage = '';
    isHint = false;
  }

  // Typed model names are checked (debounced) against the local database.
  function onModelInputChanged(): void {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      checkTimer = null;
      void checkExisting(true);
    }, 400);
  }

  async function openModelPicker(): Promise<void> {
    if (!selectedMachine) return;
    isModelPickerOpen = true;
    await scanModalMachine();
  }

  async function scanModalMachine(): Promise<void> {
    if (!selectedMachine) return;
    isScanning = true;
    modelFilter = '';
    selectedModelCandidate = null;
    statusMessage = `Scanning FM1, FM2, and BM for ${selectedMachine.name} models...`;
    isError = false;
    isHint = false;
    try {
      modelCandidates = await appService.scanModels(selectedMachine);
    } catch (error) {
      isError = true;
      statusMessage = toErrorMessage(error);
    } finally {
      isScanning = false;
    }
  }

  function closeModelPicker(): void {
    isModelPickerOpen = false;
    selectedModelCandidate = null;
  }

  function applyModel(): void {
    if (!selectedModelCandidate) return;
    modelName = selectedModelCandidate.name;
    isModelPickerOpen = false;
    selectedModelCandidate = null;
    void checkExisting(true);
  }

  function openTeach(): void {
    appStore.activeTab = 'teach';
  }

  async function collectData(): Promise<void> {
    if (!selectedMachine || !modelName.trim()) return;
    isCollecting = true;
    isError = false;
    isHint = false;
    statusMessage = `Reading FM1, FM2, and BM for ${selectedMachine.name} / ${modelName}...`;
    try {
      const record = await appService.collectAndPersist(selectedMachine, modelName);
      modelName = record.modelName;
      existingRecord = record;
      statusMessage = `Saved ${record.modelName}: FM1/TOP, FM2/TOP, and BM/BOTTOM are ready in the local database.`;
      showToast(`Model ${record.modelName} collected and applied to TEACH / CALIBRATE.`);
    } catch (error) {
      isError = true;
      statusMessage = toErrorMessage(error);
    } finally {
      isCollecting = false;
    }
  }

  function dismissToast(): void {
    toast = '';
    if (toastTimer) clearTimeout(toastTimer);
  }

  async function checkExisting(announce: boolean): Promise<void> {
    const machine = selectedMachine;
    const name = modelName.trim();
    if (!machine || !name) {
      existingRecord = null;
      return;
    }
    try {
      const record = await appService.getModelData(machine.id, name);
      existingRecord = record;
      if (record) {
        // Model already in the database: make it the active selection so TEACH
        // and CALIBRATE pick it up on their next load.
        modelName = record.modelName;
        await appService.saveActiveSelection({ machineId: machine.id, modelName: record.modelName });
        isError = false;
        isHint = false;
        statusMessage = `Loaded model ${record.modelName} from the local database (collected ${new Date(record.collectedAt).toLocaleString()}). It is applied to TEACH / CALIBRATE; Collect is optional and re-reads the device files.`;
        if (announce) showToast(`Model ${record.modelName} loaded successfully and applied to TEACH / CALIBRATE.`);
      } else {
        isError = false;
        isHint = true;
        statusMessage = `No data for ${name} in the local database yet - press Collect & Save below to read it from the device files.`;
      }
    } catch (error) {
      isError = true;
      isHint = false;
      statusMessage = toErrorMessage(error);
    }
  }

  function showToast(message: string): void {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = '';
    }, 3500);
  }

  function toErrorMessage(error: unknown): string {
    return `Operation failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
  }
</script>

<section class="container">
  <h2>Data Collection</h2>
  <div class="card">
    <p class="desc">Read the selected AFVI host's LightSpec and InspectionSpec XML files, then persist the normalized parameter record locally.</p>

    <div class="form-group">
      <label>AFVI Device</label>
      <select bind:value={selectedMachineId} onchange={onTargetChanged}>
        <option value="">-- Select Machine --</option>
        {#each appStore.machines as machine (machine.id)}
          <option value={machine.id}>{machine.name}</option>
        {/each}
      </select>
    </div>

    <div class="form-group">
      <label>Model Name</label>
      <div class="model-input">
        <input bind:value={modelName} oninput={onModelInputChanged} placeholder="Select or type a model name, e.g. 6ST2001Q01">
        <button type="button" class="choose-button" disabled={!selectedMachineId || isScanning} onclick={openModelPicker}>{isScanning ? 'Scanning...' : 'Choose Model'}</button>
      </div>
    </div>

    {#if selectedMachine}
      <div class="target-summary">
        Target: <strong>{selectedMachine.name}</strong> <span>FM1 / TOP-1 + FM2 / TOP-2 + BM / BOTTOM will be collected as one snapshot.</span>
      </div>
    {/if}

    <div class="action-row">
      <button class="btn-primary" type="button"
        class:optional={hasExistingData} class:needed={needsCollect}
        onclick={collectData} disabled={isCollecting || !selectedMachine || !modelName.trim()}>
        {isCollecting ? 'Reading and Saving...' : hasExistingData ? 'Re-collect (optional)' : 'Collect & Save'}
      </button>
      {#if hasExistingData}<button class="btn-open" type="button" onclick={openTeach}>Open TEACH</button>{/if}
    </div>
    {#if statusMessage}<div class="status-box" class:error={isError} class:hint={isHint && !isError}>{statusMessage}</div>{/if}

    <h3>Export Parameter Excel (검사기술파라미터)</h3>
    <div class="form-group">
      <label>Export Path</label>
      <input type="text" bind:value={exportConfig.exportPath} oninput={onExportConfigChanged} placeholder="D:\검사기술파라미터">
    </div>
    <div class="form-group">
      <label>Template Workbook (blank Parameter_Template.xlsx)</label>
      <input type="text" bind:value={exportConfig.templatePath} oninput={onExportConfigChanged} placeholder="D:\검사기술파라미터\Parameter_Template.xlsx">
    </div>
    <div class="action-row">
      <button class="btn-export" type="button" onclick={exportExcel} disabled={isExporting || !hasExistingData}>
        {isExporting ? 'Exporting...' : 'Export Parameter Excel'}
      </button>
    </div>
    {#if exportSummary}<div class="export-result">{exportSummary}</div>{/if}
  </div>
</section>

{#if isModelPickerOpen}
  <div class="modal-backdrop">
    <section class="model-modal" role="dialog" aria-modal="true">
      <header>Choose Model Names <button type="button" onclick={closeModelPicker}>x</button></header>
      <div class="model-caption">AFVI Device
        <select bind:value={selectedMachineId} onchange={scanModalMachine}>
          {#each appStore.machines as machine (machine.id)}
            <option value={machine.id}>{machine.name}</option>
          {/each}
        </select>
        <span>FM1 + FM2 + BM</span>
      </div>
      <div class="model-search"><input type="text" bind:value={modelFilter} placeholder="Filter models (e.g. MSP)" autocomplete="off" spellcheck="false"></div>
      <div class="model-table">
        <div class="model-row header"><span>Index</span><span>Name</span><span>Available Hosts</span></div>
        {#each filteredModelCandidates as model, index (model.name)}
          <button class="model-row" type="button" class:selected={selectedModelCandidate?.name === model.name} onclick={() => (selectedModelCandidate = model)}>
            <span>{(index + 1).toString().padStart(2, '0')}</span><span>{model.name}</span><span>{model.hosts.join(' / ')}</span>
          </button>
        {/each}
        {#if !modelCandidates.length}<p class="empty">No matching model folders were found.</p>{/if}
        {#if modelCandidates.length && !filteredModelCandidates.length}<p class="empty">No model matches "{modelFilter}".</p>{/if}
      </div>
      <footer><button type="button" class="apply" disabled={!selectedModelCandidate} onclick={applyModel}>Apply</button><button type="button" onclick={closeModelPicker}>Cancel</button></footer>
    </section>
  </div>
{/if}

{#if toast}
  <div class="toast" onclick={dismissToast} role="status">{toast}</div>
{/if}

<style>
  .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: #f1f1f1; margin: 0 0 16px; font-size: 20px; }
  .card { background: #262626; border: 1px solid #4a4a4a; border-radius: 4px; padding: 20px; } .desc { color: #a9a9a9; font-size: 13px; line-height: 1.45; margin: 0 0 20px; }
  .form-group { margin: 0 0 14px; } label { display: block; color: #aaa; font-size: 12px; margin-bottom: 6px; } select, input { background: #1e1e1e; border: 1px solid #505050; box-sizing: border-box; color: #f2f2f2; height: 36px; padding: 7px 10px; width: 100%; } select:focus, input:focus { border-color: #0088cc; outline: none; }
  .model-input { display: flex; } .model-input input { border-right: 0; } .choose-button { background: #4d4d4d; border: 1px solid #606060; color: #eee; min-width: 116px; cursor: pointer; } .choose-button:disabled { color: #888; cursor: default; }
  .target-summary { color: #a8a8a8; font-size: 11px; margin: -2px 0 14px; } .target-summary strong { color: #8cc63f; } .target-summary span { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-row { display: flex; gap: 8px; } .btn-primary { background: #087fc1; border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; width: 100%; } .btn-primary:disabled { background: #484848; color: #a0a0a0; cursor: default; }
  .btn-primary.optional { background: #4d4d4d; border: 1px solid #666; color: #ddd; font-weight: 400; }
  .btn-primary.needed { animation: needed-pulse 1.6s ease-in-out infinite; }
  @keyframes needed-pulse { 0%, 100% { box-shadow: 0 0 0 0 #087fc100; } 50% { box-shadow: 0 0 0 4px #087fc145; } }
  .btn-open { background: #2e7d46; border: 0; color: #fff; cursor: pointer; flex: 0 0 auto; font-weight: 700; height: 36px; padding: 0 16px; } .btn-open:hover { background: #379454; }
  h3 { color: #f1f1f1; font-size: 14px; margin: 22px 0 12px; }
  .btn-export { background: #6d3fc1; border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; } .btn-export:hover { background: #7d4fd6; } .btn-export:disabled { background: #484848; color: #a0a0a0; cursor: default; }
  .export-result { background: #2d2d3d; border-left: 4px solid #6d3fc1; color: #ddd; font-size: 11px; line-height: 1.5; margin-top: 12px; padding: 8px 10px; word-break: break-all; }
  .status-box { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 15px; padding: 10px; } .status-box.error { background: #4a2d2d; border-left-color: #ff5252; } .status-box.hint { background: #4a3d2e; border-left-color: #e0a040; }
  .modal-backdrop { align-items: center; background: rgba(0, 0, 0, .65); display: flex; inset: 0; justify-content: center; position: fixed; z-index: 10; } .model-modal { background: #2d2d2d; border: 2px solid #0088cc; box-shadow: 0 12px 40px #000; color: #eee; width: min(580px, calc(100vw - 30px)); } .model-modal header { border-bottom: 1px solid #4a4a4a; display: flex; font-size: 14px; font-weight: 700; justify-content: space-between; padding: 7px 10px; } .model-modal header button { background: transparent; border: 0; color: #bbb; cursor: pointer; font-size: 18px; } .model-caption { align-items: center; color: #cfcfcf; display: flex; font-size: 12px; gap: 8px; padding: 7px 10px; } .model-caption select { background: #1e1e1e; border: 1px solid #555; color: #eee; padding: 3px; } .model-caption span { color: #8cc63f; margin-left: auto; }
  .model-search { padding: 0 10px 7px; } .model-search input { height: 30px; }
  .model-table { border: 1px solid #555; margin: 0 10px; max-height: 290px; overflow-y: auto; } .model-row { background: #303030; border: 0; border-bottom: 1px solid #414141; color: #ddd; display: grid; font: inherit; grid-template-columns: 70px 1fr 115px; padding: 6px; text-align: left; width: 100%; } button.model-row { cursor: pointer; } button.model-row:hover, .model-row.selected { background: #14557a; } .model-row.header { background: #3a3a3a; color: #bbb; } .empty { color: #aaa; padding: 18px; text-align: center; } footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 10px; } footer button { background: #666; border: 0; color: #fff; min-width: 105px; padding: 8px; } footer .apply { background: #087fc1; } footer .apply:disabled { background: #444; color: #888; }
  .toast { animation: toast-in .18s ease-out; background: #2e3d56; border: 1px solid #42c66d; border-left: 4px solid #42c66d; border-radius: 3px; box-shadow: 0 8px 24px #000a; color: #fff; cursor: pointer; font-size: 12px; max-width: 460px; padding: 10px 14px; position: fixed; right: 16px; top: 52px; z-index: 20; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
</style>
