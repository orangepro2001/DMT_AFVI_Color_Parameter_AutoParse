<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type GvValueSet, type GvValues, type HostId, type StoredModelRecord } from '../../lib/service';
  import { clampLightValue, createLightPage, LIGHT_VALUE_MAX, LIGHT_VALUE_MIN, type LightColor, type SimulationChannel } from '../../lib/light-simulation';
  import { appStore } from '../../lib/stores.svelte';

  let selectedHost = $state<HostId>('FM1');
  let record = $state<StoredModelRecord | null>(null);
  const pageIndex = $derived(appStore.lightSimulation.selectedPage);
  const globalOn = $derived(appStore.lightSimulation.enabled);
  const displayChannel = $derived(appStore.lightSimulation.displayChannel);
  const channels = $derived(appStore.lightSimulation.pages[pageIndex]?.channels ?? []);
  const gvColors = ['Red', 'Green', 'Blue'] as const;
  let gvSaveError = $state('');
  let calibMessage = $state('');
  let valueErrors = $state<Record<string, string>>({});
  let gvStore: GvValues = {};
  let gvSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let machineId = $state('');
  let modelName = $state('');

  const gvRows = $derived(pageIndex < 2 ? ['AU', 'OSP'] : ['SR', 'Space']);
  const selectedMachine = $derived(appStore.machines.find((machine) => machine.id === appStore.activeSelection?.machineId));

  let lightIdentity = '';

  // Light 1-2 inspect the pad areas, light 3 inspects the SR/space structure (Parameter_Template).
  function syncLightSimulation(): void {
    const identity = `${machineId}|${modelName}|${selectedHost}`;
    if (identity === lightIdentity) return;
    lightIdentity = identity;
    const loadedRecord = record;
    appStore.lightSimulation = {
      enabled: true,
      host: selectedHost,
      selectedPage: 0,
      displayChannel: 'Red',
      pages: loadedRecord
        ? [0, 1, 2].map((index) => createLightPage(appService.getLightChannels(loadedRecord, selectedHost, index)))
        : [],
    };
    valueErrors = {};
  }

  $effect(() => {
    void record;
    void machineId;
    void modelName;
    void selectedHost;
    syncLightSimulation();
  });

  // Data Collection's Clear bumps the epoch: reset the light tab state. The
  // record and GV store follow the cleared activeSelection in the effect below.
  const epochAtMount = appStore.selectionEpoch;
  $effect(() => {
    if (appStore.selectionEpoch !== epochAtMount) {
      selectedHost = 'FM1';
      lightIdentity = '';
      appStore.lightSimulation = {
        enabled: true,
        host: 'FM1',
        selectedPage: 0,
        displayChannel: 'Red',
        pages: [],
      };
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
    record = null;
    lightIdentity = '';
    appStore.lightSimulation.selectedPage = 0;
    const loaded = active ? await appService.getModelData(active.machineId, active.modelName) : null;
    if (seq !== loadSeq) return;
    record = loaded;
    lightIdentity = '';
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
    if (loaded) {
      record = loaded;
      lightIdentity = '';
    }
    calibMessage = 'Reloaded the stored calibration values.';
  }

  function setGlobalOn(enabled: boolean): void {
    appStore.lightSimulation.enabled = enabled;
  }

  function setPage(index: number): void {
    appStore.lightSimulation.selectedPage = index;
  }

  function setHost(host: HostId): void {
    selectedHost = host;
    appStore.lightSimulation.host = host;
    lightIdentity = '';
  }

  function channelFor(index: number): SimulationChannel | undefined {
    return appStore.lightSimulation.pages[pageIndex]?.channels.find((channel) => channel.index === index);
  }

  function errorKey(index: number): string {
    return `${pageIndex}:${index}`;
  }

  function setChannelValue(index: number, value: number): void {
    const channel = channelFor(index);
    if (!channel) return;
    channel.value = clampLightValue(value);
    valueErrors[errorKey(index)] = '';
  }

  function setChannelFromInput(index: number, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const raw = input.value.trim();
    const value = Number(raw);
    const valid = raw !== '' && Number.isFinite(value) && value >= LIGHT_VALUE_MIN && value <= LIGHT_VALUE_MAX;
    if (!valid) {
      valueErrors[errorKey(index)] = `请输入 ${LIGHT_VALUE_MIN}~${LIGHT_VALUE_MAX}`;
      return;
    }
    setChannelValue(index, value);
  }

  function normalizeInputOnBlur(index: number, event: Event): void {
    const key = errorKey(index);
    if (!valueErrors[key]) return;
    const channel = channelFor(index);
    if (channel) (event.currentTarget as HTMLInputElement).value = String(channel.value);
    valueErrors[key] = '';
  }

  function setChannelEnabled(index: number, enabled: boolean): void {
    const channel = channelFor(index);
    if (channel) channel.enable = enabled;
  }

  function normalizeColor(color: string): LightColor | '' {
    const value = color.trim().toLowerCase();
    if (value === 'r' || value === 'red') return 'Red';
    if (value === 'g' || value === 'green') return 'Green';
    if (value === 'b' || value === 'blue') return 'Blue';
    if (value === 'w' || value === 'white') return 'White';
    return '';
  }
</script>

<div class="calib">
  <div class="pattern-preview" aria-hidden="true">
    <span class="preview-caption">{selectedMachine?.name || 'No device'} · {modelName || 'No model selected'}</span>
  </div>

  <header class="calib-head">
    <label class="power"><input type="checkbox" checked={globalOn} onchange={(event) => setGlobalOn((event.currentTarget as HTMLInputElement).checked)}> <span class="pill" class:on={globalOn}>{globalOn ? 'ON' : 'OFF'}</span></label>
    <span class="head-spacer"></span>
    <label class="host">Host
      <select value={selectedHost} onchange={(event) => setHost((event.currentTarget as HTMLSelectElement).value as HostId)} aria-label="Host"><option value="FM1">FM1</option><option value="FM2">FM2</option><option value="BM">BM</option></select>
    </label>
    <label class="page">Page Index:
      <select value={pageIndex} onchange={(event) => setPage(Number((event.currentTarget as HTMLSelectElement).value))}><option value={0}>1</option><option value={1}>2</option><option value={2}>3</option></select>
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
            {@const color = normalizeColor(channel.color)}
            <tr class:selected={color !== '' && (displayChannel === 'RGB' || color === displayChannel)} class:disabled-row={!channel.enable}>
              <td>{channel.index}</td>
              <td class="bright"><input type="range" min={LIGHT_VALUE_MIN} max={LIGHT_VALUE_MAX} step="1" value={channel.value} oninput={(event) => setChannelValue(channel.index, Number((event.currentTarget as HTMLInputElement).value))} disabled={!globalOn}></td>
              <td class="value-cell">
                <input class:invalid={!!valueErrors[errorKey(channel.index)]} type="number" min={LIGHT_VALUE_MIN} max={LIGHT_VALUE_MAX} step="1" value={channel.value} oninput={(event) => setChannelFromInput(channel.index, event)} onblur={(event) => normalizeInputOnBlur(channel.index, event)} disabled={!globalOn} aria-invalid={!!valueErrors[errorKey(channel.index)]} aria-label={`Channel ${channel.index} brightness`} title={valueErrors[errorKey(channel.index)] || `Brightness ${LIGHT_VALUE_MIN}~${LIGHT_VALUE_MAX}`}>
                {#if valueErrors[errorKey(channel.index)]}<small class="input-error">0~1024</small>{/if}
              </td>
              <td>{channel.angle}°</td>
              <td class:dim={!channel.enable}>{channel.color}</td>
              <td><label class="toggle"><input type="checkbox" checked={channel.enable} onchange={(event) => setChannelEnabled(channel.index, (event.currentTarget as HTMLInputElement).checked)} disabled={!globalOn}><span></span></label></td>
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
  tr.selected td { background: color-mix(in srgb, var(--accent-blue-bright) 18%, transparent); }
  tr.disabled-row td { opacity: .68; }
  input[type="range"] { width: 100%; }
  .value-cell { width: 82px; position: relative; }
  .value-cell input[type="number"] { width: 68px; box-sizing: border-box; background: var(--bg-input); border: 1px solid var(--toggle-bg); color: var(--text-main); font: 11px 'Segoe UI', sans-serif; padding: 2px 3px; text-align: right; }
  .value-cell input[type="number"].invalid { border-color: var(--status-red, #e2755a); }
  .input-error { display: block; color: var(--status-red, #e2755a); font-size: 9px; line-height: 1; }
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
