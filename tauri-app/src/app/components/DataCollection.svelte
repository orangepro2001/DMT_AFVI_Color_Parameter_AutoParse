<script lang="ts">
  import { onMount } from 'svelte';
  import ModelPickerDialog from './ModelPickerDialog.svelte';
  import { appService, type Machine, type StoredModelRecord } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';

  let selectedMachineId = $state('');
  let modelName = $state('');
  let isCollecting = $state(false);
  let isError = $state(false);
  let isHint = $state(false);
  let statusMessage = $state('');
  let isModelPickerOpen = $state(false);
  // Snapshot of the model in the local database, if one was collected before.
  let existingRecord = $state<StoredModelRecord | null>(null);
  let toast = $state('');
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedMachine = $derived(appStore.machines.find((machine) => machine.id === selectedMachineId));
  const hasExistingData = $derived(!!existingRecord);
  // Highlight Collect while the selected model has no data to load yet.
  const needsCollect = $derived(!hasExistingData && !!selectedMachine && !!modelName.trim());

  // Publish the stage target as soon as a device + model are picked - no
  // database record required, so the center images start loading while the
  // user is still choosing. Debounced like checkExisting so typing doesn't
  // fire a share read per keystroke; clearing resets at once. The armed timer
  // survives tab switches (stageTarget keeps its value when this page unmounts).
  let stageTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const machineId = selectedMachineId;
    const name = modelName.trim();
    if (stageTimer) clearTimeout(stageTimer);
    if (!machineId || !name) {
      stageTimer = null;
      appStore.stageTarget = null;
      return;
    }
    stageTimer = setTimeout(() => {
      stageTimer = null;
      appStore.stageTarget = { machineId, modelName: name };
    }, 400);
    return () => {
      if (stageTimer) {
        clearTimeout(stageTimer);
        stageTimer = null;
      }
    };
  });

  onMount(() => {
    (async () => {
      appStore.machines = await appService.getMachines();
      const active = appStore.activeSelection ?? await appService.getActiveSelection();
      if (active) appStore.activeSelection = active;
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
    };
  });

  function onTargetChanged(): void {
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

  /** The picker (shared with the rail's Model button) only fills the field in:
   * collecting is this page's job, and the database check decides whether the
   * model is already loaded. */
  function onModelPicked(picked: Machine, pickedModel: string): void {
    selectedMachineId = picked.id;
    modelName = pickedModel;
    void checkExisting(true);
  }

  function openTeach(): void {
    appStore.activeTab = 'teach';
  }

  /** Reset the model selection: empty form, drop the loaded-record state,
   * clear the persisted active selection and tell the keep-alive TEACH /
   * CALIBRATE pages to drop their loaded state too. */
  function clearSelection(): void {
    selectedMachineId = '';
    modelName = '';
    existingRecord = null;
    statusMessage = 'Selection cleared - pick a device and model to continue.';
    isError = false;
    isHint = false;
    appStore.teachSelection = null;
    appStore.selectionEpoch++;
    void appService.clearActiveSelection().catch(() => {});
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
        <button type="button" class="choose-button" disabled={!selectedMachineId} onclick={() => (isModelPickerOpen = true)}>Choose Model</button>
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
      <button class="btn-clear" type="button" onclick={clearSelection}
        disabled={isCollecting || (!selectedMachineId && !modelName.trim())} title="Reset the device/model selection">
        Clear
      </button>
    </div>
    {#if statusMessage}<div class="status-box" class:error={isError} class:hint={isHint && !isError}>{statusMessage}</div>{/if}
  </div>
</section>

<ModelPickerDialog bind:open={isModelPickerOpen} machineId={selectedMachineId} onapply={onModelPicked} />

{#if toast}
  <div class="toast" onclick={dismissToast} role="status">{toast}</div>
{/if}

<style>
  .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: var(--text-main); margin: 0 0 16px; font-size: 20px; }
  .card { background: var(--bg-panel); border: 1px solid var(--bg-elev); border-radius: 4px; padding: 20px; } .desc { color: var(--text-muted); font-size: 13px; line-height: 1.45; margin: 0 0 20px; }
  .form-group { margin: 0 0 14px; } label { display: block; color: var(--text-muted); font-size: 12px; margin-bottom: 6px; } select, input { background: var(--bg-input); border: 1px solid var(--bg-elev); box-sizing: border-box; color: var(--text-main); height: 36px; padding: 7px 10px; width: 100%; } select:focus, input:focus { border-color: var(--accent-blue-bright); outline: none; }
  .model-input { display: flex; } .model-input input { border-right: 0; } .choose-button { background: var(--bg-elev); border: 1px solid var(--bg-elev); color: var(--text-main); min-width: 116px; cursor: pointer; } .choose-button:disabled { color: var(--text-muted); cursor: default; }
  .target-summary { color: var(--text-muted); font-size: 11px; margin: -2px 0 14px; } .target-summary strong { color: var(--status-green); } .target-summary span { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action-row { display: flex; gap: 8px; } .btn-primary { background: var(--accent-blue-bright); border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; width: 100%; } .btn-primary:disabled { background: var(--bg-elev); color: var(--text-muted); cursor: default; }
  .btn-primary.optional { background: var(--bg-elev); border: 1px solid var(--text-muted); color: var(--text-main); font-weight: 400; }
  .btn-primary.needed { animation: needed-pulse 1.6s ease-in-out infinite; }
  @keyframes needed-pulse { 0%, 100% { box-shadow: 0 0 0 0 var(--accent-blue-bright)00; } 50% { box-shadow: 0 0 0 4px var(--accent-blue-bright)45; } }
  .btn-open { background: #2e7d46; border: 0; color: #fff; cursor: pointer; flex: 0 0 auto; font-weight: 700; height: 36px; padding: 0 16px; } .btn-open:hover { background: #379454; }
  .btn-clear { background: var(--border-color); border: 0; color: #fff; cursor: pointer; flex: 0 0 auto; font-weight: 700; height: 36px; padding: 0 16px; } .btn-clear:hover:not(:disabled) { background: var(--toggle-bg)55e; }
  .btn-clear:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-box { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 15px; padding: 10px; } .status-box.error { background: #4a2d2d; border-left-color: #ff5252; } .status-box.hint { background: #4a3d2e; border-left-color: #e0a040; }
  .toast { animation: toast-in .18s ease-out; background: #2e3d56; border: 1px solid #42c66d; border-left: 4px solid #42c66d; border-radius: 3px; box-shadow: 0 8px 24px #000a; color: #fff; cursor: pointer; font-size: 12px; max-width: 460px; padding: 10px 14px; position: fixed; right: 16px; top: 52px; z-index: 20; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
</style>
