<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type HostId, type Machine, type StoredModelRecord } from '../../lib/service';
  import type { InspectionGroup, InspectionNode, InspectionParent, InspectionParameter } from '../../lib/spec-model';
  import { appStore } from '../../lib/stores.svelte';
  import ParamTable from './ParamTable.svelte';
  import type { ParamDisplayRow, ParamValueChange } from './ParamTable.svelte';

  type ValueField = 'Val' | 'ValR' | 'ValG' | 'ValB';
  interface DisplayRow extends ParamDisplayRow {
    parameter: InspectionParameter;
    field: ValueField;
  }
  interface LocalEdits {
    dirty: boolean;
    saving: boolean;
    invalid: Set<ParamDisplayRow>;
    rows: WeakMap<InspectionParameter, Map<ValueField, DisplayRow>>;
  }
  // Metadata follows the service's cached snapshot across tab destruction.
  // Actual edits live on that snapshot, never in a flattened node-ID map.
  const localEdits = new WeakMap<StoredModelRecord, LocalEdits>();

  let selectedMachine = $state<Machine | undefined>();
  let selectedHost = $state<HostId>('FM1');
  let machineId = $state('');
  let modelName = $state('');
  let record = $state<StoredModelRecord | null>(null);
  let activeLight = $state(0);
  let activeColor = $state('Green');
  const colors = ['Red', 'Green', 'Blue'];
  const overlays = ['MK', 'A_C', 'I_C', 'SK'].map((name) => ({ name, checked: false }));
  let groups = $state<InspectionGroup[]>([]);
  let activeGroup = $state<InspectionGroup | undefined>();
  let selectedParent = $state<InspectionParent | undefined>();
  let selectedNode = $state<InspectionNode | undefined>();
  let masterRows = $state<DisplayRow[]>([]);
  let submasterRows = $state<DisplayRow[]>([]);
  let inspectionRows = $state<DisplayRow[]>([]);
  let edits = $state<LocalEdits | undefined>();
  let loading = $state(false);
  let confirmReload = $state(false);
  let error = $state('');
  let message = $state('');
  let destroyed = false;
  let xmlInput: HTMLInputElement | undefined;

  const busy = $derived(loading || !!edits?.saving);
  const hasInvalid = $derived(!!edits?.invalid.size);
  const dirty = $derived(!!edits?.dirty || hasInvalid);
  const alignment = $derived(record?.hosts[selectedHost]?.alignment);
  const groupTabs = $derived.by(() => {
    const tabs = ['Unit', 'Dummy'].map((name, index) => {
      const group = groups.find((item) => item.name.toLowerCase() === name.toLowerCase())
        ?? groups.find((item) => item.id === String(index + 1));
      return { id: group?.id ?? `missing-${name}`, name, group };
    });
    return [...tabs, ...groups.filter((group) => !tabs.some((tab) => tab.group === group))
      .map((group) => ({ id: group.id, name: group.name, group }))];
  });
  // Records collected before schemaVersion 2 hold a flat parameter list without the node tree.
  const legacyRecord = $derived.by(() => {
    const specs = record?.hosts?.[selectedHost]?.inspectionSpecs;
    if (!specs) return false;
    const values = Object.values(specs) as unknown[];
    return values.length > 0 && !values.some((spec) => !!spec && typeof spec === 'object' && 'groups' in spec);
  });
  const tableEmptyText = $derived(selectedNode ? 'No parameters for this node.' : 'Select a child node.');
  const submasterEmptyText = $derived.by(() => {
    if (!selectedNode) return tableEmptyText;
    return selectedNode.parameters.some((item) => item.kind === 'SUBMASTER')
      ? 'Enable the matching Chain switch in Master.' : 'No Submaster parameters.';
  });

  // Data Collection's Clear bumps the epoch: drop the loaded model and tree state
  const epochAtMount = appStore.selectionEpoch;
  $effect(() => {
    if (appStore.selectionEpoch !== epochAtMount) {
      selectedMachine = undefined;
      machineId = '';
      modelName = '';
      selectedHost = 'FM1';
      activeLight = 0;
      activeColor = 'Green';
      attachRecord(null);
      error = '';
      message = '';
    }
  });

  onMount(() => {
    loading = true;
    (async () => {
      try {
        const [machines, active] = await Promise.all([appService.getMachines(), appService.getActiveSelection()]);
        if (destroyed) return;
        machineId = active?.machineId ?? '';
        modelName = active?.modelName ?? '';
        selectedMachine = machines.find((machine) => machine.id === machineId);
        appStore.machines = machines;
        const selection = await appService.getTeachSelection();
        if (selection) {
          selectedHost = ['FM1', 'FM2', 'BM'].includes(selection.host) ? selection.host : 'FM1';
          activeLight = [0, 1, 2].includes(selection.light) ? selection.light : 0;
          activeColor = colors.includes(selection.color) ? selection.color : 'Green';
        }
        const loaded = active ? await appService.getModelData(active.machineId, active.modelName) : null;
        if (!destroyed) attachRecord(loaded);
      } catch (err) {
        error = errorText(err);
      } finally {
        loading = false;
      }
    })();
    return () => {
      destroyed = true;
    };
  });

  function selectHost(host: HostId): void {
    selectedHost = host;
    resolveSelection();
  }

  function selectLight(light: number): void {
    activeLight = light;
    resolveSelection();
  }

  function selectColor(color: string): void {
    activeColor = color;
    rememberSelection();
    refreshRows();
  }

  function selectGroup(group?: InspectionGroup): void {
    if (group) resolveSelection(group.id);
  }

  function selectParent(parent: InspectionParent): void {
    selectedParent = parent;
    // A parent has no parameters of its own. Never combine its children.
    selectedNode = undefined;
    rememberSelection();
    refreshRows();
  }

  function selectNode(parent: InspectionParent, node: InspectionNode): void {
    selectedParent = parent;
    selectedNode = node;
    rememberSelection();
    refreshRows();
  }

  function setChecked(target: InspectionParent | InspectionNode, event: Event): void {
    if (busy) return;
    target.checked = (event.target as HTMLInputElement).checked;
    markDirty();
  }

  // The Align / ROI subtree is fixed by the machine and shows no checkboxes.
  function checkable(parent: InspectionParent): boolean {
    return parent.id !== '1';
  }

  function changeValue(change: ParamValueChange): void {
    if (busy) return;
    const row = change.row as DisplayRow;
    // Original object + channel, not a globally ambiguous node ID or ParamKey.
    if (!row.parameter || row.disabled) return;
    const previous = row.parameter.values[row.field];
    row.value = change.value;
    if (row.enabled !== undefined) row.enabled = Number(change.value) !== 0;
    if (previous !== change.value && Number(previous) !== Number(change.value)) {
      row.parameter.values[row.field] = change.value;
      markDirty();
    }
    if (row.parameter.kind === 'MASTER' && ['103', '104'].includes(row.parameter.key)) refreshRows();
  }

  function setInvalid(change: { row: ParamDisplayRow; invalid: boolean }): void {
    if (change.invalid) edits?.invalid.add(change.row);
    else edits?.invalid.delete(change.row);
  }

  async function saveLocal(): Promise<void> {
    if (!record || !edits || busy || hasInvalid || !dirty) return;
    const snapshot = record;
    const currentEdits = edits;
    currentEdits.saving = true;
    error = '';
    message = '';
    try {
      await appService.saveModelData(machineId, modelName, snapshot);
      currentEdits.dirty = false;
      message = 'Saved local snapshot. Production files are unchanged.';
    } catch (err) {
      error = `Save Local failed: ${errorText(err)} Your edits are retained.`;
    } finally {
      currentEdits.saving = false;
    }
  }

  function requestReload(): void {
    if (dirty) confirmReload = true;
    else void reloadLocal();
  }

  async function reloadLocal(): Promise<void> {
    if (!machineId || busy) return;
    loading = true;
    error = '';
    message = '';
    try {
      const loaded = await appService.getModelData(machineId, modelName, true);
      if (!loaded) throw new Error('Local snapshot was not found.');
      if (!destroyed) {
        localEdits.delete(loaded);
        attachRecord(loaded);
        confirmReload = false;
        message = 'Reloaded local snapshot. Production files were not accessed.';
      }
    } catch (err) {
      error = `Reload failed: ${errorText(err)} Current edits are retained.`;
    } finally {
      loading = false;
    }
  }

  function pickXml(): void {
    if (busy || !record || legacyRecord) return;
    message = '';
    xmlInput?.click();
  }

  function readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error(`Cannot read ${file.name}.`));
      reader.readAsText(file);
    });
  }

  // The old SpecParamTool's single-XML entry: one InspectionSpec.xml fills the
  // current Host + Light tab; a LightSpec.xml refreshes the whole host's light
  // pages. The overlay lives on the in-memory snapshot - Save Local keeps it.
  async function onXmlPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !record || busy) return;
    const host = record.hosts[selectedHost];
    if (!host) {
      error = `No snapshot data for ${selectedHost}.`;
      return;
    }
    loading = true;
    error = '';
    try {
      const xml = await readAsText(file);
      if (/^lightspec\.xml$/i.test(file.name)) {
        const parsed = appService.parseLightSpec(xml);
        host.lightSpec = parsed.lightSpec;
        host.alignment = parsed.alignment;
        markDirty();
        message = `Loaded ${file.name} into ${selectedHost}. Use Save Local to keep it in the snapshot.`;
      } else {
        const groups = appService.parseInspectionSpecGroups(xml, host);
        if (!groups.length) throw new Error(`${file.name} holds no GPNODE entries - is it really an InspectionSpec.xml?`);
        host.inspectionSpecs[`LIGHT${activeLight}`] = { groups };
        markDirty();
        message = `Loaded ${file.name} into ${selectedHost} / Light-${activeLight + 1}. Use Save Local to keep it in the snapshot.`;
        resolveSelection();
      }
    } catch (err) {
      error = `Load XML failed: ${errorText(err)} If the file sits on a Vision PC share, copy it locally or collect the model instead.`;
    } finally {
      loading = false;
    }
  }

  function nodeColor(color: string): string {
    const parts = color.split(',').map((part) => Number(part.trim()));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part) && part >= 0 && part <= 255)) return `rgb(${parts.join(',')})`;
    return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color) || /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(color) ? color : '#c0c0c0';
  }

  function nodeTextColor(color: string): string {
    const normalized = nodeColor(color);
    let rgb = normalized.match(/\d+/g)?.map(Number) ?? [];
    if (normalized.startsWith('#')) {
      let hex = normalized.slice(1);
      if (hex.length === 3) hex = hex.split('').map((value) => value + value).join('');
      rgb = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
    }
    const linear = rgb.map((value) => value / 255 <= .04045 ? value / 255 / 12.92 : ((value / 255 + .055) / 1.055) ** 2.4);
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2] > .2 ? '#111111' : '#ffffff';
  }

  function attachRecord(loaded: StoredModelRecord | null): void {
    record = loaded;
    if (loaded) {
      edits = localEdits.get(loaded) ?? { dirty: false, saving: false, invalid: new Set(), rows: new WeakMap() };
      localEdits.set(loaded, edits);
    } else edits = undefined;
    resolveSelection();
  }

  function resolveSelection(groupId?: string): void {
    const saved = appStore.teachSelection;
    groups = record?.hosts[selectedHost]?.inspectionSpecs[`LIGHT${activeLight}`]?.groups ?? [];
    activeGroup = groups.find((group) => group.id === (groupId ?? saved?.group))
      ?? groups.find((group) => group.name.toLowerCase() === 'unit' && group.parents.some((parent) => parent.children.some((node) => node.parameters.length)))
      ?? groups.find((group) => group.parents.some((parent) => parent.children.some((node) => node.parameters.length)))
      ?? groups[0];
    const parents = activeGroup?.parents ?? [];
    // Restore only the complete path. ID 20 under AU never resolves to OSP ID 20.
    const sameGroup = activeGroup?.id === saved?.group || groupId !== undefined;
    const parent = sameGroup ? parents.find((item) => item.id === saved?.parent) : undefined;
    const node = parent?.children.find((item) => item.id === saved?.node);
    if (parent && (node || saved?.node === '')) {
      selectedParent = parent;
      selectedNode = node;
    } else {
      const au = parents.find((item) => item.name.toUpperCase() === 'AU');
      const cPad = au?.children.find((item) => /^c[-\s]?pad$/i.test(item.name) && item.parameters.length);
      selectedParent = cPad ? au : parent?.children.some((item) => item.parameters.length) ? parent
        : parents.find((item) => item.children.some((child) => child.parameters.length)) ?? parents[0];
      selectedNode = cPad ?? selectedParent?.children.find((item) => item.parameters.length) ?? selectedParent?.children[0];
    }
    rememberSelection();
    refreshRows();
  }

  function rememberSelection(): void {
    appService.teachSelection = {
      host: selectedHost, light: activeLight, group: activeGroup?.id ?? '',
      parent: selectedParent?.id ?? '', node: selectedNode?.id ?? '', color: activeColor
    };
  }

  function refreshRows(): void {
    const parameters = selectedNode?.parameters ?? [];
    const toRows = (kind: InspectionParameter['kind']) => parameters
      .filter((item) => item.kind === kind && !(kind === 'MASTER' && item.key === '100'))
      .filter((item) => kind !== 'SUBMASTER' || submasterVisible(item, parameters))
      .map((item) => displayRow(item));
    masterRows = toRows('MASTER');
    submasterRows = toRows('SUBMASTER');
    inspectionRows = toRows('INSPECTION');
  }

  function submasterVisible(parameter: InspectionParameter, parameters: InspectionParameter[]): boolean {
    const key = parameter.specGroup === 3 ? '103' : parameter.specGroup === 4 ? '104' : undefined;
    const gates = parameters.filter((item) => item.kind === 'MASTER' && item.controlType === 1
      && (key ? item.key === key : ['103', '104'].includes(item.key)));
    return !gates.length || gates.some((item) => Number(item.values['Val']) !== 0 && Number.isFinite(Number(item.values['Val'])));
  }

  function displayRow(parameter: InspectionParameter): DisplayRow {
    const channel: Record<string, ValueField> = { Red: 'ValR', Green: 'ValG', Blue: 'ValB' };
    const field = parameter.kind === 'INSPECTION' ? channel[activeColor] ?? 'ValG' : 'Val';
    let rows = edits?.rows.get(parameter);
    if (!rows) {
      rows = new Map();
      edits?.rows.set(parameter, rows);
    }
    const raw = parameter.values[field];
    const numeric = raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw));
    const row: DisplayRow = rows.get(field) ?? {
      key: parameter.key, name: '', value: '', color: '', parameter, field
    };
    // Dictionary text first; the collected name is the same lookup, Param <key> is the last resort.
    row.name = record?.hosts[selectedHost]?.parameterDictionary[parameter.key]
      || parameter.name || `Param ${parameter.key}`;
    row.color = parameter.kind === 'INSPECTION' ? '#00ff00' : parameter.kind === 'SUBMASTER' ? '#ffff00' : '#dddddd';
    row.value = numeric ? Number(raw).toFixed(3) : raw ?? '';
    const minKey = field === 'Val' ? 'MinVal' : `MinVal${field.slice(3)}`;
    const minRaw = parameter.values[minKey];
    row.min = minRaw !== undefined && minRaw.trim() !== '' && Number.isFinite(Number(minRaw)) ? Number(minRaw).toFixed(2) : '';
    row.enabled = parameter.controlType === 1 ? numeric && Number(raw) !== 0 : undefined;
    row.disabled = !numeric || ![0, 1].includes(parameter.controlType);
    rows.set(field, row);
    return row;
  }

  function markDirty(): void {
    if (edits) edits.dirty = true;
    message = '';
    confirmReload = false;
  }

  function errorText(err: unknown): string { return err instanceof Error ? err.message : String(err); }
</script>

<div class="host">
  <div class="model-bar">
    <select bind:value={selectedHost} onchange={(event) => selectHost(event.currentTarget.value as HostId)} disabled={busy} aria-label="Host">
      <option value="FM1">FM1 / TOP-1</option>
      <option value="FM2">FM2 / TOP-2</option>
      <option value="BM">BM / BOTTOM</option>
    </select>
    <span class="model-name" title="{selectedMachine?.name || 'No device'} / {appStore.activeSelection?.modelName || 'No model selected'}">
      {selectedMachine?.name || 'No device'} / {appStore.activeSelection?.modelName || 'No model selected'}
    </span>
    <span class="bar-buttons">
      <button type="button" disabled={busy || !record || legacyRecord}
        title="Load one InspectionSpec.xml into the current Host / Light tab (a LightSpec.xml refreshes the light pages)"
        onclick={pickXml}>Load XML</button>
      <button type="button" class:dirty={dirty} disabled={busy || !dirty || hasInvalid} onclick={saveLocal}>Save Local</button>
      <button type="button" disabled={busy || !machineId} onclick={requestReload}>Reload</button>
    </span>
  </div>
  <input type="file" accept=".xml" hidden bind:this={xmlInput} onchange={onXmlPicked}>

  {#if error || message || loading}
    <div class="status-line" class:error={!!error}>{error || message || 'Loading...'}</div>
  {/if}

  {#if confirmReload}
    <div class="reload-confirm">
      Discard unsaved edits and reload the local snapshot?
      <button type="button" onclick={reloadLocal}>Reload</button>
      <button type="button" onclick={() => (confirmReload = false)}>Cancel</button>
    </div>
  {/if}

  {#if record && legacyRecord}
    <div class="legacy-warning">
      Stored model data uses the previous flat format. Re-collect the model in Settings &rarr; Data Collection to enable the parameter tree.
    </div>
  {/if}

  {#if record}
    <div class="afvi-panel">
      <div class="tab-row">
        <div class="group-tabs" role="tablist" aria-label="Inspection group">
          {#each groupTabs as tab (tab.id)}
            <button type="button" role="tab" class:active={activeGroup?.id === tab.id} disabled={busy}
              onclick={() => selectGroup(tab.group)}>{tab.name}</button>
          {/each}
        </div>
        <div class="light-tabs" role="tablist" aria-label="Light">
          {#each [0, 1, 2] as light (light)}
            <button type="button" role="tab" class:active={activeLight === light} disabled={busy}
              onclick={() => selectLight(light)}>Light-{light + 1}</button>
          {/each}
        </div>
      </div>

      <div class="panel-columns">
        <div class="tree-col">
          <div class="align-box">
            <div class="box-title">Global Align :</div>
            {#each alignment?.global ?? [] as row, index (index)}
              <div class="align-row"><span>Light&nbsp;: {row.light}</span><span class="channel">Channel&nbsp;: {row.channel}</span></div>
            {/each}
            <div class="box-title sr">SR Align :</div>
            {#each alignment?.sr ?? [] as row, index (index)}
              <div class="align-row"><span>Light&nbsp;: {row.light}</span><span class="channel">Channel&nbsp;: {row.channel}</span></div>
            {/each}
          </div>

          <div class="overlay-box">
            <div class="overlay-title">Overlay</div>
            <div class="overlay-row">
              {#each overlays as overlay (overlay.name)}
                <label><input type="checkbox" bind:checked={overlay.checked} />{overlay.name}</label>
              {/each}
            </div>
          </div>

          <div class="tree" role="tree" aria-label="{activeGroup?.name} nodes">
            {#each activeGroup?.parents ?? [] as parent (parent.id)}
              <div class="tree-parent">
                <div class="tree-row">
                  {#if checkable(parent)}
                    <label class="tree-check">
                      <input type="checkbox" checked={parent.checked} disabled={busy} onchange={(event) => setChecked(parent, event)}>
                    </label>
                  {/if}
                  <button type="button" class="node-label parent-label"
                    style="--node-bg: {nodeColor(parent.color)}; color: {nodeTextColor(parent.color)}"
                    class:selected={selectedParent === parent && !selectedNode}
                    title={parent.name} onclick={() => selectParent(parent)}>{parent.name}</button>
                </div>
                <div class="tree-children">
                  {#each parent.children as node (node.id)}
                    <div class="tree-row">
                      {#if checkable(parent)}
                        <label class="tree-check">
                          <input type="checkbox" checked={node.checked} disabled={busy} onchange={(event) => setChecked(node, event)}>
                        </label>
                      {/if}
                      <button type="button" class="node-label"
                        style="--node-bg: {nodeColor(node.color)}; color: {nodeTextColor(node.color)}"
                        class:selected={selectedNode === node} title={node.name}
                        onclick={() => selectNode(parent, node)}>{node.name}</button>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="table-col">
          <div class="table-wrap master">
            <ParamTable title="Name" rows={masterRows} emptyText={tableEmptyText} disabled={busy}
              onvaluechange={changeValue} oninvalidchange={setInvalid} />
          </div>
          <div class="table-wrap submaster">
            <ParamTable title="Name" rows={submasterRows} emptyText={submasterEmptyText} disabled={busy}
              onvaluechange={changeValue} oninvalidchange={setInvalid} />
          </div>
          <div class="color-tabs" role="tablist" aria-label="Camera channel">
            {#each colors as color (color)}
              <button type="button" role="tab" class:active={activeColor === color} class={color.toLowerCase()} disabled={busy}
                onclick={() => selectColor(color)}>{color}</button>
            {/each}
          </div>
          <div class="table-wrap inspection">
            <ParamTable title="Name" rows={inspectionRows} showMin={true} emptyText={tableEmptyText} disabled={busy}
              onvaluechange={changeValue} oninvalidchange={setInvalid} />
          </div>
        </div>
      </div>
    </div>
  {:else if !loading}
    <div class="empty-record">Choose and collect a Model first.</div>
  {/if}
</div>

<style>
  .host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #37414a;
    color: #eee;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 12px;
  }

  .host :global(*) { box-sizing: border-box; }

  /* ---- model bar ---------------------------------------------------- */
  .model-bar {
    align-items: center;
    background: #252525;
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
    padding: 5px 6px;
  }
  .model-bar select {
    background: #1e1e1e;
    border: 1px solid #555;
    color: #eee;
    padding: 3px 4px;
  }
  .model-name {
    color: #8cc63f;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-buttons { display: flex; gap: 4px; }
  .bar-buttons button {
    background: #4d4d4d;
    border: 1px solid #666;
    color: #eee;
    cursor: pointer;
    font-size: 11px;
    padding: 3px 8px;
  }
  .bar-buttons button:disabled { color: #888; cursor: default; }
  .bar-buttons button.dirty { background: #087fc1; border-color: #16a4ee; color: #fff; }

  /* ---- status / warnings -------------------------------------------- */
  .status-line {
    background: #2e3d56;
    border-left: 4px solid #42c66d;
    flex: 0 0 auto;
    font-size: 11px;
    padding: 4px 8px;
  }
  .status-line.error { background: #4a2d2d; border-left-color: #ff5252; }
  .legacy-warning { background: #5a4a2d; color: #ffd88a; flex: 0 0 auto; font-size: 11px; padding: 4px 8px; }
  .reload-confirm {
    align-items: center;
    background: #4a2d2d;
    color: #ffd88a;
    display: flex;
    flex: 0 0 auto;
    font-size: 11px;
    gap: 8px;
    padding: 4px 8px;
  }
  .reload-confirm button {
    background: #4d4d4d;
    border: 1px solid #666;
    color: #eee;
    cursor: pointer;
    font-size: 11px;
    padding: 1px 10px;
  }
  .reload-confirm button:first-of-type { background: #087fc1; border-color: #16a4ee; color: #fff; }
  .empty-record { color: #999; padding: 30px; text-align: center; }

  /* ---- panel --------------------------------------------------------- */
  .afvi-panel { display: flex; flex: 1; flex-direction: column; min-height: 0; }

  .tab-row { display: flex; flex: 0 0 auto; }
  .group-tabs, .light-tabs { display: flex; }
  .group-tabs { flex: 0 0 236px; }
  .light-tabs { flex: 1; }
  .group-tabs button, .light-tabs button, .color-tabs button {
    border: 1px solid #131a20;
    cursor: pointer;
    flex: 1;
    font: 13px/22px 'Segoe UI', sans-serif;
    height: 24px;
    padding: 0;
  }
  .group-tabs button:disabled, .light-tabs button:disabled, .color-tabs button:disabled { cursor: default; opacity: .6; }
  .group-tabs button { background: #ccd8f0; color: #000; }
  .group-tabs button.active { background: #1c86d2; color: #fff; }
  .light-tabs button { background: #d9d9f4; color: #000; }
  .light-tabs button.active { background: #6d6dd8; color: #fff; }
  .group-tabs button:focus-visible, .light-tabs button:focus-visible, .color-tabs button:focus-visible {
    outline: 2px solid #8edcff;
    outline-offset: -2px;
  }

  .panel-columns { display: flex; flex: 1; min-height: 0; }

  /* ---- left column: align, overlay, tree ----------------------------- */
  .tree-col {
    border-right: 1px solid #131a20;
    display: flex;
    flex: 0 0 236px;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .align-box { flex: 0 0 auto; padding: 5px 7px 3px; }
  .box-title { background: #2c3640; color: #fff; font-size: 13px; padding: 2px 8px; }
  .box-title.sr { margin-top: 4px; }
  .align-row {
    color: #e2e2e2;
    display: flex;
    font-size: 13px;
    line-height: 20px;
    padding: 0 14px;
  }
  .align-row .channel { margin-left: auto; margin-right: 30px; }

  .overlay-box { flex: 0 0 auto; padding: 4px 7px 3px; }
  .overlay-title { color: #fff; font-size: 13px; text-align: center; }
  .overlay-row { display: flex; gap: 12px; padding: 3px 8px 4px; }
  .overlay-row label { align-items: center; color: #eee; display: flex; font-size: 12px; gap: 5px; }
  .overlay-row input { margin: 0; }

  .tree { flex: 1; min-height: 0; overflow: visible; padding: 8px 6px; }
  .tree-parent { margin-top: 7px; }
  .tree-row { align-items: center; display: flex; min-height: 22px; position: relative; }
  .tree-check { align-items: center; display: flex; flex: 0 0 20px; }
  .tree-check input { height: 14px; margin: 0; width: 14px; }
  .node-label {
    background: var(--node-bg, #c0c0c0);
    border: 0;
    cursor: pointer;
    font: 13px/21px 'Segoe UI', sans-serif;
    min-width: 74px;
    padding: 0 8px;
    text-align: left;
  }
  .tree-children .node-label { min-width: 96px; }
  .node-label:hover { filter: brightness(1.08); }
  .node-label.selected { background: #ff5000 !important; color: #111 !important; }
  .tree-children { border-left: 1px solid #6a7480; margin-left: 11px; }
  .tree-children .tree-row { padding-left: 10px; }
  .tree-children .tree-row::before {
    background: #6a7480;
    content: '';
    height: 1px;
    left: 1px;
    position: absolute;
    top: 50%;
    width: 9px;
  }
  .tree-row button:focus-visible { outline: 2px solid #8edcff; outline-offset: -1px; }

  /* ---- right column: parameter tables -------------------------------- */
  .table-col {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .table-wrap { min-height: 0; overflow: auto; }
  .table-wrap.master { flex: 0 1 auto; max-height: 44%; }
  .table-wrap.submaster { flex: 0 1 auto; max-height: 30%; }
  .table-wrap.inspection { flex: 1 1 60px; }

  .color-tabs { border-bottom: 1px solid #131a20; display: flex; flex: 0 0 auto; }
  .color-tabs button { background: #dce8f8; color: #000; }
  .color-tabs button.red { background: #f2a08c; }
  .color-tabs button.green { background: #a8d8a0; }
  .color-tabs button.blue { background: #a8c8f0; }
  .color-tabs button.red.active { background: #e04040; color: #fff; }
  .color-tabs button.green.active { background: #2aa02a; color: #fff; }
  .color-tabs button.blue.active { background: #00a0f0; color: #fff; }
</style>
