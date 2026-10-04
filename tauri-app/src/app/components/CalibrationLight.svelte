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
  let gvStore: GvValues = {};
  let gvSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let machineId = '';
  let modelName = '';

  const gvRows = $derived(pageIndex < 2 ? ['AU', 'OSP'] : ['SR', 'Space']);
  const selectedMachine = $derived(appStore.machines.find((machine) => machine.id === appStore.activeSelection?.machineId));

  // Light 1-2 inspect the pad areas, light 3 inspects the SR/space structure (Parameter_Template).
  $effect(() => {
    channels = record ? appService.getLightChannels(record, selectedHost, pageIndex) : [];
  });

  // Data Collection's Clear bumps the epoch: drop the loaded model + GV state
  const epochAtMount = appStore.selectionEpoch;
  $effect(() => {
    if (appStore.selectionEpoch !== epochAtMount) {
      record = null;
      selectedHost = 'FM1';
      pageIndex = 0;
      globalOn = true;
      gvStore = {};
      machineId = '';
      modelName = '';
    }
  });

  onMount(() => {
    (async () => {
      appStore.machines = await appService.getMachines();
      const active = appStore.activeSelection ?? await appService.getActiveSelection();
      if (active) appStore.activeSelection = active;
      machineId = active?.machineId ?? '';
      modelName = active?.modelName ?? '';
      record = active ? await appService.getModelData(active.machineId, active.modelName) : null;
      gvStore = machineId && modelName ? await appService.getGvValues(machineId, modelName) : {};
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
</script>

<div class="host">
  <div class="model-bar">
  <select bind:value={selectedHost} aria-label="Host"><option value="FM1">FM1 / TOP-1</option><option value="FM2">FM2 / TOP-2</option><option value="BM">BM / BOTTOM</option></select>
  <span class="model-name">{selectedMachine?.name || 'No device'} / {appStore.activeSelection?.modelName || 'No model selected'}</span>
</div>
{#if !record}
  <div class="empty">Choose and collect a Model first.</div>
{:else}
  <section class="calibration">
    <div class="gv-box">
      <div class="gv-title">GV 밝기 <span>(measured and entered manually — not in the spec XML)</span></div>
      <table class="gv-table">
        <thead><tr><th class="row-label"></th>{#each gvColors as color}<th class={color.toLowerCase()}>{color.toUpperCase()}</th>{/each}</tr></thead>
        <tbody>
          {#each gvRows as row (row)}
            <tr>
              <th class="row-label">{row}</th>
              {#each gvColors as color (color)}
                <td>
                  <input
                    type="text"
                    maxlength="24"
                    autocomplete="off"
                    spellcheck="false"
                    value={gvValue(row, color)}
                    oninput={(event) => setGvValue(row, color, event.currentTarget.value)}
                    aria-label="{row} {color} GV"
                    placeholder=""
                  />
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if gvSaveError}<div class="gv-error">{gvSaveError}</div>{/if}
    </div>
    <header>
      <label class="power"><input type="checkbox" bind:checked={globalOn}> <b>{globalOn ? 'ON' : 'OFF'}</b></label>
      <label>Page Index:
        <select bind:value={pageIndex}>
          <option value={0}>1</option><option value={1}>2</option><option value={2}>3</option>
        </select>
      </label>
    </header>
    <div class="title">• Calibration - Light</div>
    <table>
      <thead><tr><th>Channel</th><th>Brightness</th><th>Value</th><th>Angle</th><th>Color</th><th>ON/OFF</th></tr></thead>
      <tbody>
        {#each channels as channel (channel.index)}
          <tr>
            <td>{channel.index}</td>
            <td><input type="range" min="0" max="1000" bind:value={channel.value} disabled={!channel.enable}></td>
            <td>{channel.value}</td>
            <td>{channel.angle}°</td>
            <td class:dim={!channel.enable}>{channel.color}</td>
            <td><label class="toggle"><input type="checkbox" bind:checked={channel.enable}><span></span></label></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}
</div>

<style>
  .host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .model-bar { display: flex; gap: 6px; padding: 6px; background: #252525; } .model-bar select { background: #1e1e1e; border: 1px solid #555; color: #eee; padding: 4px; } .model-name { color: #8cc63f; font-size: 12px; overflow: hidden; padding: 5px; text-overflow: ellipsis; white-space: nowrap; } .empty { color: #999; padding: 30px; text-align: center; }
  .calibration { display: flex; flex: 1; flex-direction: column; min-height: 0; background: #303030; }
  .gv-box { background: #262626; border-bottom: 1px solid #505050; padding: 5px 8px 7px; }
  .gv-title { color: #eee; font-size: 12px; font-weight: 700; padding: 0 1px 3px; } .gv-title span { color: #9a9a9a; font-size: 10px; font-weight: 400; }
  .gv-table { border-collapse: collapse; table-layout: fixed; width: 100%; } .gv-table th, .gv-table td { border: 1px solid #4a4a4a; height: 22px; padding: 0; text-align: center; }
  .gv-table .row-label { background: #333; color: #ddd; font-size: 11px; font-weight: 400; width: 64px; }
  .gv-table thead th { background: #3c3c3c; color: #eee; font-size: 11px; font-weight: 700; letter-spacing: .4px; }
  .gv-table thead th.red { background: #e0182d; color: #fff; } .gv-table thead th.green { background: #92d050; color: #000; } .gv-table thead th.blue { background: #00b0f0; color: #000; }
  .gv-table input { background: #1e1e1e; border: 1px solid #555; box-sizing: border-box; color: #eee; font: 11px/19px 'Segoe UI', sans-serif; height: 20px; padding: 0 3px; text-align: center; width: 100%; } .gv-table input:focus { border-color: #0088cc; outline: none; }
  .gv-error { background: #4a2d2d; border-left: 3px solid #ff5252; color: #ffd9d9; font-size: 11px; margin-top: 5px; padding: 4px 7px; }
  header { align-items: center; background: #333; color: #ddd; display: flex; justify-content: space-between; padding: 7px 10px; } header select { background: #202020; border: 1px solid #555; color: #fff; } .power b { color: #8cc63f; } .title { border-bottom: 1px solid #505050; color: #eee; padding: 5px 10px; }
  table { border-collapse: collapse; color: #ddd; font-size: 12px; width: 100%; } th { background: #3c3c3c; border: 1px solid #4a4a4a; font-weight: 400; padding: 4px; } td { border-bottom: 1px solid #414141; padding: 3px; text-align: center; } td:nth-child(2) { width: 43%; } input[type="range"] { width: 100%; } .dim { color: #777; }
  .toggle { display: inline-block; height: 15px; position: relative; width: 31px; } .toggle input { opacity: 0; } .toggle span { background: #666; border-radius: 9px; inset: 0; position: absolute; } .toggle span::after { background: #ddd; border-radius: 50%; content: ''; height: 11px; left: 2px; position: absolute; top: 2px; width: 11px; } .toggle input:checked + span { background: #0088cc; } .toggle input:checked + span::after { left: 18px; }
</style>
