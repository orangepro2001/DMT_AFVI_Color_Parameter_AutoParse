<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type GvValueSet, type GvValues, type HostId, type StoredModelRecord } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';

  type Channel = { index: number; value: number; angle: number; color: string; enable: boolean };

  let selectedHost = $state<HostId>('FM1');
  let record = $state<StoredModelRecord | null>(null);
  let channels = $state<Channel[]>([]);
  let pageIndex = $state(0);
  let globalOn = $state(true);
  const gvColors = ['Red', 'Green', 'Blue'] as const;
  let gvSaveError = $state('');
  let calibMessage = $state('');
  let gvStore: GvValues = {};
  let gvSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let machineId = $state('');
  let modelName = $state('');

  const gvRows = $derived(pageIndex < 2 ? ['AU', 'OSP'] : ['SR', 'Space']);
  const selectedMachine = $derived(appStore.machines.find((machine) => machine.id === appStore.activeSelection?.machineId));

  // Light 1-2 inspect the pad areas, light 3 inspects the SR/space structure (Parameter_Template).
  $effect(() => {
    channels = record ? appService.getLightChannels(record, selectedHost, pageIndex) : [];
  });

  // Data Collection's Clear bumps the epoch: reset the light tab state. The
  // record and GV store follow the cleared activeSelection in the effect below.
  const epochAtMount = appStore.selectionEpoch;
  $effect(() => {
    if (appStore.selectionEpoch !== epochAtMount) {
      selectedHost = 'FM1';
      pageIndex = 0;
      globalOn = true;
    }
  });

  // Follow the active selection live: the page is keep-alive, and on a fresh
  // install the snapshot appears only after the user collects in Data
  // Collection. Reload the record + GV store when the selection identity
  // changes - never while it stays the same (that would clobber GV edits).
  let loadedIdentity = '';
  let loadSeq = 0;
  $effect(() => {
    const active = appStore.activeSelection;
    const identity = active ? `${active.machineId}|${active.modelName}` : '';
    if (identity !== loadedIdentity) void followSelection(identity, active);
  });

  async function followSelection(
    identity: string,
    active: { machineId: string; modelName: string } | null,
  ): Promise<void> {
    const seq = ++loadSeq;
    loadedIdentity = identity;
    machineId = active?.machineId ?? '';
    modelName = active?.modelName ?? '';
    pageIndex = 0;
    const loaded = active ? await appService.getModelData(active.machineId, active.modelName) : null;
    if (seq !== loadSeq) return;
    record = loaded;
    const stored = active ? await appService.getGvValues(active.machineId, active.modelName) : {};
    if (seq !== loadSeq) return;
    gvStore = stored;
  }

  onMount(() => {
    (async () => {
      appStore.machines = await appService.getMachines();
      const active = appStore.activeSelection ?? await appService.getActiveSelection();
      if (active) appStore.activeSelection = active;
    })();
    return () => flushGvSave();
  });

  function gvValue(row: string, color: string): string {
    return gvStore[selectedHost]?.[String(pageIndex)]?.[row]?.[color as keyof GvValueSet] ?? '';
  }

  function setGvValue(row: string, color: string, value: string): void {
    const pageStore = gvStore[selectedHost] ??= {};
    const rowStore = pageStore[String(pageIndex)] ??= {};
    rowStore[row] ??= { Red: '', Green: '', Blue: '' };
    rowStore[row][color as keyof GvValueSet] = value;
    scheduleGvSave();
  }

  function scheduleGvSave(): void {
    if (gvSaveTimer) clearTimeout(gvSaveTimer);
    gvSaveTimer = setTimeout(() => flushGvSave(), 500);
  }

  function flushGvSave(): void {
    if (gvSaveTimer) {
      clearTimeout(gvSaveTimer);
      gvSaveTimer = null;
    }
    if (!machineId || !modelName) return;
    appService.saveGvValues(machineId, modelName, gvStore).then(() => {
      if (gvSaveError) gvSaveError = '';
    }).catch((error) => {
      // a failed save must be visible - the values would silently vanish otherwise
      gvSaveError = `GV save failed: ${typeof error === 'string' ? error : 'unexpected error'} - check the Database tab connection.`;
    });
  }

  function saveCalibration(): void {
    flushGvSave();
    calibMessage = 'GV values saved to the local database.';
  }

  async function reloadCalibration(): Promise<void> {
    if (!machineId || !modelName) return;
    calibMessage = '';
    gvStore = await appService.getGvValues(machineId, modelName);
    const loaded = await appService.getModelData(machineId, modelName);
    if (loaded) record = loaded;
    calibMessage = 'Reloaded the stored calibration values.';
  }
</script>

<div class="calib">
  <div class="pattern-preview" aria-hidden="true">
    <span class="preview-caption">{selectedMachine?.name || 'No device'} · {modelName || 'No model selected'}</span>
  </div>

  <header class="calib-head">
    <label class="power"><input type="checkbox" bind:checked={globalOn}> <span class="pill" class:on={globalOn}>{globalOn ? 'ON' : 'OFF'}</span></label>
    <span class="head-spacer"></span>
    <label class="host">Host
      <select bind:value={selectedHost} aria-label="Host"><option value="FM1">FM1</option><option value="FM2">FM2</option><option value="BM">BM</option></select>
    </label>
    <label class="page">Page Index:
      <select bind:value={pageIndex}><option value={0}>1</option><option value={1}>2</option><option value={2}>3</option></select>
    </label>
  </header>

  {#if !record}
    <div class="empty">Choose and collect a Model first.</div>
  {:else}
    <div class="title">• Calibration - Light</div>
    <div class="channel-list">
      <table>
        <thead><tr><th>Channel</th><th>Brightness</th><th>Value</th><th>Angle</th><th>Color</th><th>ON/OFF</th></tr></thead>
        <tbody>
          {#each channels as channel (channel.index)}
            <tr>
              <td>{channel.index}</td>
              <td class="bright"><input type="range" min="0" max="1000" bind:value={channel.value} disabled={!channel.enable}></td>
              <td>{channel.value}</td>
              <td>{channel.angle}°</td>
              <td class:dim={!channel.enable}>{channel.color}</td>
              <td><label class="toggle"><input type="checkbox" bind:checked={channel.enable}><span></span></label></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="actions">
      <button class="auto" type="button" disabled>Auto</button>
      <span class="head-spacer"></span>
      <button type="button" onclick={reloadCalibration}>Reload</button>
      <button type="button" onclick={saveCalibration}>Save</button>
    </div>
    {#if calibMessage}<div class="calib-status" role="status">{calibMessage}</div>{/if}

    <details class="gv">
      <summary>GV 亮度值 (AU / OSP / SR / Space)</summary>
      <div class="gv-box">
        <table class="gv-table">
          <thead><tr><th class="row-label"></th>{#each gvColors as color}<th class={color.toLowerCase()}>{color.toUpperCase()}</th>{/each}</tr></thead>
          <tbody>
            {#each gvRows as row (row)}
              <tr>
                <th class="row-label">{row}</th>
                {#each gvColors as color (color)}
                  <td>
                    <input type="text" maxlength="24" autocomplete="off" spellcheck="false"
                      value={gvValue(row, color)}
                      oninput={(event) => setGvValue(row, color, event.currentTarget.value)}
                      aria-label="{row} {color} GV" placeholder="" />
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#if gvSaveError}<div class="gv-error">{gvSaveError}</div>{/if}
      </div>
    </details>
  {/if}
</div>

<style>
  .calib { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--machine-shell); color: var(--text-main); font: 12px 'Segoe UI', sans-serif; }
  .pattern-preview { position: relative; flex: 0 0 18%; min-height: 92px; border-bottom: 2px solid #a23450; background-color: #141114; background-image: repeating-linear-gradient(0deg, #35131b 0, #35131b 2px, #141114 2px, #141114 6px), repeating-linear-gradient(90deg, rgba(200,60,60,.30) 0 3px, transparent 3px 9px); background-blend-mode: screen; }
  .preview-caption { position: absolute; left: 8px; bottom: 5px; color: #d8b9c0; font-size: 10px; letter-spacing: .03em; text-shadow: 0 1px 2px #000; }
  .calib-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--bg-header); border-bottom: 1px solid var(--bg-elev); }
  .head-spacer { flex: 1; }
  .power { display: flex; align-items: center; gap: 5px; } .power input { display: none; }
  .pill { background: #555; color: #ddd; border-radius: 10px; font-size: 11px; font-weight: 700; padding: 2px 12px; cursor: pointer; }
  .pill.on { background: #4caf50; color: #fff; }
  .host, .page { color: var(--text-main); font-size: 11px; display: flex; align-items: center; gap: 5px; }
  .host select, .page select { background: var(--bg-panel); border: 1px solid var(--toggle-bg); color: #fff; font-size: 11px; padding: 2px 4px; }
  .title { color: var(--text-main); padding: 5px 9px 4px; border-bottom: 1px solid var(--bg-elev); font-size: 12px; }
  .channel-list { flex: 1; min-height: 0; overflow: auto; }
  table { border-collapse: collapse; color: var(--text-main); font-size: 12px; width: 100%; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--bg-elev); border: 1px solid var(--bg-elev); font-weight: 400; padding: 4px; }
  td { border-bottom: 1px solid var(--bg-elev); padding: 3px; text-align: center; }
  td.bright { width: 40%; }
  input[type="range"] { width: 100%; }
  .dim { color: var(--text-muted); }
  .actions { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--bg-elev); }
  .actions button { background: var(--bg-elev); border: 1px solid var(--border-color); color: var(--text-main); font: inherit; font-size: 12px; padding: 4px 16px; cursor: pointer; }
  .actions button:disabled { color: var(--text-muted); cursor: default; }
  .calib-status { padding: 4px 9px; color: var(--status-green); font-size: 11px; border-top: 1px solid var(--bg-elev); }
  .empty { color: var(--text-muted); padding: 30px; text-align: center; }
  .gv { border-top: 1px solid var(--bg-elev); }
  .gv summary { cursor: pointer; color: var(--text-muted); font-size: 11px; padding: 6px 9px; }
  .gv-box { padding: 4px 8px 8px; }
  .gv-table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  .gv-table th, .gv-table td { border: 1px solid var(--bg-elev); height: 22px; padding: 0; text-align: center; }
  .gv-table .row-label { background: var(--bg-header); color: var(--text-main); font-size: 11px; font-weight: 400; width: 64px; }
  .gv-table thead th { background: var(--bg-elev); color: var(--text-main); font-size: 11px; font-weight: 700; letter-spacing: .4px; }
  .gv-table thead th.red { background: #e0182d; color: #fff; } .gv-table thead th.green { background: #92d050; color: #000; } .gv-table thead th.blue { background: #00b0f0; color: #000; }
  .gv-table input { background: var(--bg-input); border: 1px solid var(--toggle-bg); box-sizing: border-box; color: var(--text-main); font: 11px/19px 'Segoe UI', sans-serif; height: 20px; padding: 0 3px; text-align: center; width: 100%; }
  .gv-error { background: #4a2d2d; border-left: 3px solid #ff5252; color: #ffd9d9; font-size: 11px; margin-top: 5px; padding: 4px 7px; }
  .toggle { display: inline-block; height: 15px; position: relative; width: 31px; } .toggle input { opacity: 0; }
  .toggle span { background: var(--text-muted); border-radius: 9px; inset: 0; position: absolute; }
  .toggle span::after { background: var(--text-main); border-radius: 50%; content: ''; height: 11px; left: 2px; position: absolute; top: 2px; width: 11px; }
  .toggle input:checked + span { background: var(--accent-blue-bright); } .toggle input:checked + span::after { left: 18px; }
</style>
