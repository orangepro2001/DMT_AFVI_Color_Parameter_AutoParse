<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type Machine, type ModelData } from '../../lib/service';
  import type { InspectionGroup, InspectionNode, InspectionParent, InspectionParameter } from '../../lib/spec-model';
  import { appStore } from '../../lib/stores.svelte';
  import ParamTable from './ParamTable.svelte';
  import type { ParamDisplayRow, ParamValueChange } from './ParamTable.svelte';

  let { showSettings = false, fullscreen = true }: { showSettings?: boolean; fullscreen?: boolean } = $props();

  type ValueField = 'Val' | 'ValR' | 'ValG' | 'ValB';
  interface DisplayRow extends ParamDisplayRow {
    parameter: InspectionParameter;
    field: ValueField;
  }
  interface LocalEdits {
    invalid: Set<ParamDisplayRow>;
    rows: WeakMap<InspectionParameter, Map<ValueField, DisplayRow>>;
  }
  // Edit validation follows the in-memory model across tab switches.
  // Actual edits live on that session model, never in a flattened node-ID map.
  const localEdits = new WeakMap<ModelData, LocalEdits>();

  let selectedMachine = $state<Machine | undefined>();
  const selectedHost = $derived(appStore.activeConnector?.host ?? appStore.lightSimulation.host);
  let machineId = $state('');
  let modelName = $state('');
  let record = $state<ModelData | null>(null);
  let activeLight = $state(0);
  let activeColor = $state('Green');
  const colors = ['Red', 'Green', 'Blue'];
  const overlays = $state(['MK', 'A_C', 'L_C', 'SK'].map((name, index) => ({ name, checked: index === 0 })));
  // SR Align 的 Light 下拉（实机在行内提供 1/2/3 选择）
  let srLightMenuOpen = $state(false);
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

  const busy = $derived(loading);
  const hasInvalid = $derived(!!edits?.invalid.size);
  const dirty = $derived(!!record?.sessionEdited || hasInvalid);
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
  const tableEmptyText = $derived(selectedNode ? 'No parameters for this node.' : 'Select a child node.');
  const submasterEmptyText = $derived.by(() => {
    if (!selectedNode) return tableEmptyText;
    return selectedNode.parameters.some((item) => item.kind === 'SUBMASTER')
      ? 'Enable the matching Chain switch in Master.' : 'No Submaster parameters.';
  });

  // 型号选择's Clear bumps the epoch: drop the loaded tree state. The
  // model itself follows the cleared activeSelection in the effect below.
  const epochAtMount = appStore.selectionEpoch;
  $effect(() => {
    if (appStore.selectionEpoch !== epochAtMount) {
      activeLight = 0;
      activeColor = 'Green';
      error = '';
      message = '';
    }
  });

  // Follow the active selection live. The page is keep-alive and mounts once,
  // but on a fresh install the device, model, and session model all appear AFTER
  // mount - the user configures the machine and loads first. Reload the
  // session model whenever the selection identity changes; a machine list that
  // fills in later only re-resolves the device name in the header.
  let loadedIdentity = '';
  let loadSeq = 0;
  $effect(() => {
    const active = appStore.activeSelection;
    const connector = appStore.activeConnector;
    const routed = active && connector ? { machineId: connector.machineId, modelName: active.modelName } : null;
    const identity = routed ? `${routed.machineId}|${routed.modelName}|${connector?.host ?? ''}|${appStore.modelEpoch}` : '';
    selectedMachine = appStore.machines.find((machine) => machine.id === connector?.machineId);
    if (identity !== loadedIdentity) void followSelection(identity, routed);
  });

  async function followSelection(
    identity: string,
    active: { machineId: string; modelName: string } | null,
  ): Promise<void> {
    const seq = ++loadSeq;
    loadedIdentity = identity;
    machineId = active?.machineId ?? '';
    modelName = active?.modelName ?? '';
    loading = true;
    try {
      const loaded = active ? await appService.getModelData(active.machineId, active.modelName) : null;
      if (seq !== loadSeq || destroyed) return;
      attachRecord(loaded);
      error = '';
    } catch (err) {
      if (seq !== loadSeq || destroyed) return;
      attachRecord(null);
      error = errorText(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  onMount(() => {
    (async () => {
      try {
        const selection = await appService.getTeachSelection();
        if (destroyed) return;
        if (selection) {
          activeLight = [0, 1, 2].includes(selection.light) ? selection.light : 0;
          activeColor = colors.includes(selection.color) ? selection.color : 'Green';
        }
        // the session model may have arrived before the persisted host/light did
        resolveSelection();
      } catch {
        // a broken teach selection must not block the page
      }
    })();
    return () => {
      destroyed = true;
    };
  });

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

  // The Align/ROI subtree is fixed by the machine: parent id 1 ("Align / ROI",
  // confirmed against source XML). Its children (Metal/SR/DMG) are
  // the align targets; matching the name too keeps this working should a
  // future model carry a different parent id.
  function isAlignParent(parent: InspectionParent): boolean {
    return parent.id === '1' || /align/i.test(parent.name);
  }

  function selectParent(parent: InspectionParent): void {
    selectedParent = parent;
    // A parent has no parameters of its own. Never combine its children.
    selectedNode = undefined;
    rememberSelection();
    refreshRows();
    // The align parent is the stage entry: it shows the GB Pattern render in
    // the center stage, like the real machine. Any other parent goes back to
    // the median strip.
    appStore.stageMode = isAlignParent(parent) ? 'pattern' : 'median';
  }

  function selectNode(parent: InspectionParent, node: InspectionNode): void {
    selectedParent = parent;
    selectedNode = node;
    rememberSelection();
    refreshRows();
    appStore.stageMode = isAlignParent(parent) ? 'pattern' : 'median';
  }

  function setChecked(target: InspectionParent | InspectionNode, event: Event): void {
    if (busy) return;
    target.checked = (event.target as HTMLInputElement).checked;
    markDirty();
  }

  // The Align / ROI subtree is fixed by the machine and shows no checkboxes.
  function checkable(parent: InspectionParent): boolean {
    return !isAlignParent(parent);
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

  function requestReload(): void {
    if (dirty) confirmReload = true;
    else void reloadSources();
  }

  async function reloadSources(): Promise<void> {
    if (!machineId || busy) return;
    const seq = ++loadSeq;
    loading = true;
    error = '';
    message = '';
    try {
      const loaded = await appService.getModelData(machineId, modelName, true);
      if (seq !== loadSeq || destroyed) return;
      if (!loaded) throw new Error('Model source was not found.');
      if (!destroyed) {
        localEdits.delete(loaded);
        attachRecord(loaded);
        confirmReload = false;
        message = '已从 PxInventory 重新读取 XML。';
        appStore.modelEpoch++;
      }
    } catch (err) {
      if (seq === loadSeq) error = `Reload failed: ${errorText(err)} Current edits are retained.`;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function pickXml(): void {
    if (busy || !record) return;
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

  // Load XML overlays the current host/light only for this session.
  async function onXmlPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !record || busy) return;
    const host = record.hosts[selectedHost];
    if (!host) {
      error = `No session model data for ${selectedHost}.`;
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
        message = `Loaded ${file.name} into ${selectedHost}. 仅本次会话生效，Reload 将丢弃修改。`;
      } else {
        const groups = appService.parseInspectionSpecGroups(xml, host);
        if (!groups.length) throw new Error(`${file.name} holds no GPNODE entries - is it really an InspectionSpec.xml?`);
        host.inspectionSpecs[`LIGHT${activeLight}`] = { groups };
        markDirty();
        message = `Loaded ${file.name} into ${selectedHost} / Light-${activeLight + 1}. 仅本次会话生效，Reload 将丢弃修改。`;
        resolveSelection();
      }
    } catch (err) {
      error = `Load XML failed: ${errorText(err)} If the file sits on a Vision PC share, choose a local XML file or reload the model sources.`;
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

  function attachRecord(loaded: ModelData | null): void {
    record = loaded;
    if (loaded) {
      edits = localEdits.get(loaded) ?? { invalid: new Set(), rows: new WeakMap() };
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
    // Dictionary text first; the parsed name is the same lookup, Param <key> is the last resort.
    row.name = record?.hosts[selectedHost]?.parameterDictionary[parameter.key]
      || parameter.name || `Param ${parameter.key}`;
    row.color = parameter.kind === 'INSPECTION' ? 'var(--row-insp)' : parameter.kind === 'SUBMASTER' ? 'var(--row-sub)' : 'var(--text-main)';
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
    if (record) record.sessionEdited = true;
    message = '';
    confirmReload = false;
  }

  function errorText(err: unknown): string { return err instanceof Error ? err.message : String(err); }
</script>
{#snippet table(rows: DisplayRow[], label: string, emptyText: string, showMin = false)}
  <div class="editor-table" hidden={!showSettings}>
    <ParamTable title="Name" {rows} {showMin} {emptyText} disabled={busy}
      onvaluechange={changeValue} oninvalidchange={setInvalid} />
  </div>
    <div class="read-table" hidden={showSettings} role="region" aria-label={label}>
      <table aria-label={label}>
        <colgroup><col class="number-column"><col><col class="value-column"></colgroup>
        <thead><tr><th scope="col">No.</th><th scope="col">Name</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {#each rows as row, index (index)}
            <tr>
              <td>{index + 1}</td>
              <td class="parameter-name" style="color: {row.color}" title={row.name}>{row.name}</td>
              <td class="parameter-value">{row.enabled === undefined ? row.value : row.enabled ? 'ON' : 'OFF'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if record && !rows.length}<p class="table-empty">{emptyText}</p>{/if}
    </div>
{/snippet}

<div class="host" class:settings-mode={showSettings && fullscreen} class:inline-settings={showSettings && !fullscreen} inert={!showSettings && appStore.activeTab !== 'teach'}>
  {#if showSettings}
    <div class="settings-heading">
      <div><h1>Teaching Parameters</h1><p>选择 Host、Light 和检测节点，在本次会话中调整参数。</p></div>
      <span class="edit-state">{dirty ? 'Session changes' : 'Live model data'}{hasInvalid ? ' · Invalid input' : ''}</span>
    </div>
    <div class="model-bar">
      <span class="host-field">Host: <strong>{selectedHost}</strong></span>
      <span class="model-name" title="{selectedMachine?.name || 'No device'} / {appStore.activeSelection?.modelName || 'No model selected'}">
        {selectedMachine?.name || 'No device'} / {appStore.activeSelection?.modelName || 'No model selected'}
      </span>
      <span class="bar-buttons">
        <button type="button" disabled={busy || !record}
          title="Load one InspectionSpec.xml into the current Host / Light tab. LightSpec.xml refreshes the host's light pages."
          onclick={pickXml}>Load XML</button>
        <button type="button" disabled={busy || !machineId} onclick={requestReload}>Reload</button>
      </span>
    </div>
    <div class="settings-note">修改仅在会话内存中保留，Reload 将重新读取源 XML。数值输入支持 Enter 确认、Escape 恢复；生产设备文件不会改写。</div>
  {/if}
  <input type="file" accept=".xml" hidden bind:this={xmlInput} onchange={onXmlPicked}>

  {#if error || message || loading}
    <div class="status-line" class:error={!!error} role="status">{error || message || 'Loading...'}</div>
  {/if}
  {#if confirmReload && showSettings}
    <div class="reload-confirm">
      丢弃本次会话修改并重新读取源 XML？
      <button type="button" onclick={reloadSources}>Reload</button>
      <button type="button" onclick={() => (confirmReload = false)}>Cancel</button>
    </div>
  {/if}

  <div class="afvi-panel">
    <div class="panel-head"><div class="specification-title">Specification</div><div class="analysis-title">Image Analysis</div></div>
    <div class="panel-columns">
      <div class="tree-col">
        <div class="group-tabs" role="tablist" aria-label="Inspection group">
          {#each groupTabs as tab (tab.id)}
            <button type="button" role="tab" aria-selected={activeGroup?.id === tab.id}
              class:active={activeGroup?.id === tab.id} class:dummy={tab.name.toLowerCase() === 'dummy'}
              disabled={busy || !tab.group} onclick={() => selectGroup(tab.group)}>{tab.name}</button>
          {/each}
        </div>
        <div class="align-box">
          <div class="box-title">Global Align :</div>
          <div class="align-rows global-align">
            {#each alignment?.global ?? [] as row, index (index)}
              <div class="align-row"><span>Light :</span><span>{row.light}</span><span>Channel :</span><span>{row.channel}</span></div>
            {/each}
          </div>
          <div class="box-title">SR Align :</div>
          <div class="align-rows sr-align">
            {#each alignment?.sr ?? [] as row, index (index)}
              <div class="sr-align-row">
                <span class="sr-light-label">Light :</span>
                <div class="sr-light-picker">
                  <span class="sr-light-val">{row.light}</span>
                  <button type="button" class="sr-light-btn" onclick={() => srLightMenuOpen = !srLightMenuOpen} aria-expanded={srLightMenuOpen} aria-haspopup="listbox" aria-label="SR Align Light">
                    <span class="sr-caret">▾</span>
                  </button>
                  {#if srLightMenuOpen}
                    <div class="sr-light-menu" role="listbox">
                      {#each [1, 2, 3] as n}
                        <button type="button" role="option" aria-selected={row.light === n}
                          class:selected={row.light === n}
                          onclick={() => (srLightMenuOpen = false)}>{n}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
                <span class="sr-channel-label">Channel :</span>
                <span class="sr-channel-val">{row.channel}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="overlay-box">
          <div class="overlay-title">Overlay</div>
          <div class="overlay-row">
            {#each overlays as overlay (overlay.name)}
              <label><input type="checkbox" bind:checked={overlay.checked} aria-label="{overlay.name} overlay display" />{overlay.name}</label>
            {/each}
          </div>
        </div>
        <div class="tree" aria-label="{activeGroup?.name || 'Inspection'} nodes">
          {#each activeGroup?.parents ?? [] as parent (parent.id)}
            <div class="tree-parent" class:align-parent={isAlignParent(parent)}>
              <div class="tree-row">
                {#if checkable(parent)}
                  <label class="tree-check">
                    <input type="checkbox" aria-label="Enable {parent.name}" checked={parent.checked} disabled={busy} onchange={(event) => setChecked(parent, event)}>
                  </label>
                {/if}
                <button type="button" class="node-label parent-label"
                  style="--node-bg: {nodeColor(parent.color)}; color: {nodeTextColor(parent.color)}"
                  class:selected={selectedParent === parent && !selectedNode}
                  aria-pressed={selectedParent === parent && !selectedNode}
                  title={parent.name} onclick={() => selectParent(parent)}>{parent.name}</button>
              </div>
              <div class="tree-children">
                {#each parent.children as node (node.id)}
                  <div class="tree-row">
                    {#if checkable(parent)}
                      <label class="tree-check">
                        <input type="checkbox" aria-label="Enable {parent.name} / {node.name}" checked={node.checked} disabled={busy} onchange={(event) => setChecked(node, event)}>
                      </label>
                    {/if}
                    <button type="button" class="node-label"
                      style="--node-bg: {nodeColor(node.color)}; color: {nodeTextColor(node.color)}"
                      class:selected={selectedNode === node} aria-pressed={selectedNode === node}
                      title={node.name} onclick={() => selectNode(parent, node)}>{node.name}</button>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
          {#if !record && !loading}<p class="empty-record">在 Settings → 型号选择 中选择并加载型号。</p>{/if}
        </div>
      </div>
      <div class="table-col">
        <div class="light-tabs" role="tablist" aria-label="Light">
          {#each [0, 1, 2] as light (light)}
            <button type="button" role="tab" aria-selected={activeLight === light} class:active={activeLight === light} disabled={busy}
              onclick={() => selectLight(light)}>Light-{light + 1}</button>
          {/each}
        </div>
        <div class="table-wrap master">{@render table(masterRows, 'Master', tableEmptyText)}</div>
        <div class="table-wrap submaster">{@render table(submasterRows, 'Submaster', submasterEmptyText)}</div>
        <div class="inspection-block">
          <div class="color-tabs" role="tablist" aria-label="Camera channel">
            {#each colors as color (color)}
              <button type="button" role="tab" aria-selected={activeColor === color} class:active={activeColor === color} class={color.toLowerCase()} disabled={busy}
                onclick={() => selectColor(color)}>{color}</button>
            {/each}
          </div>
          <div class="table-wrap inspection">{@render table(inspectionRows, 'Inspection', tableEmptyText, true)}</div>
        </div>
      </div>
    </div>
  </div>
  {#if dirty && !showSettings}<div class="dirty-note" role="status">Session changes · Reload 前保留</div>{/if}
</div>

<style>
  .host { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; overflow: hidden;
    background: var(--bg-header); color: var(--text-main); font: 12px 'Segoe UI', sans-serif; }
  .host :global(*) { box-sizing: border-box; }
  .afvi-panel { display: flex; flex: 1; flex-direction: column; min-height: 0; }
  .panel-head { display: grid; grid-template-columns: 50% 50%; flex: 0 0 var(--info-height); border-bottom: 3px solid var(--border-strong); box-sizing: border-box; }
  .panel-head > div { display: flex; justify-content: center; align-items: center; color: #232323; font-size: clamp(12px, 1.03vw, 21px); }
  .specification-title { background: var(--machine-spec); border-right: 2px solid var(--border-strong); }
  .analysis-title { background: var(--machine-image-heading); }
  .panel-columns { display: flex; flex: 1; min-height: 0; padding: 5px 3px 0; gap: 3px; }
  .tree-col { flex: 0 0 calc(43% - 2px); display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; border-right: 2px solid var(--border-color); }
  .table-col { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg-dark); }
  .group-tabs, .light-tabs, .color-tabs { display: flex; flex: 0 0 clamp(24px, 2.8vh, 34px); min-width: 0; }
  .group-tabs button, .light-tabs button, .color-tabs button { flex: 1; min-width: 0; border: 1px solid var(--border-color); border-radius: 0; padding: 0 2px;
    color: #202020; font: 600 clamp(9px, .6vw, 12px) 'Segoe UI', sans-serif; cursor: pointer; }
  .group-tabs button { background: #6495ec; }
  .group-tabs button.dummy { background: #add8e7; }
  .group-tabs button.active { box-shadow: inset 0 -2px 0 #ffffffb3; }
  .light-tabs button { background: #e7e6fb; }
  .light-tabs button.active { background: #9470db; }
  .color-tabs button { background: #ffe4c5; }
  .color-tabs button.red.active { background: #c13635; }
  .color-tabs button.green.active { background: #62ab64; }
  .color-tabs button.blue.active { background: #4396c7; }
  .group-tabs button:disabled { cursor: default; }
  .light-tabs button:disabled, .color-tabs button:disabled { opacity: .65; cursor: default; }
  .align-box { flex: 0 0 auto; padding: 4px 3px 2px; background: var(--bg-header); }
  .box-title { background: var(--bg-elev); border: 1px solid var(--border-color); font-size: clamp(9px, .6vw, 12px); font-weight: 600; line-height: 16px; padding: 0 2px; }
  .sr-align-row { display: grid; grid-template-columns: 24% 15% 40% 21%; font-size: clamp(8px, .61vw, 12px); line-height: clamp(15px, 1.8vh, 22px); gap: 0; white-space: nowrap; align-items: center; }
  .sr-light-label, .sr-channel-label { color: var(--text-main); }
  .sr-channel-val { color: var(--text-main); }
  .sr-light-picker { position: relative; display: inline-flex; align-items: center; gap: 2px; }
  .sr-light-val { color: var(--text-main); }
  .sr-light-btn { background: var(--bg-elev); border: 1px solid var(--border-color); color: var(--text-main); padding: 0 3px; cursor: pointer; line-height: 14px; display: inline-flex; align-items: center; justify-content: center; }
  .sr-light-btn:hover { border-color: var(--accent-blue-bright); }
  .sr-caret { color: var(--text-muted); font-size: 8px; line-height: 1; }
  .sr-light-menu { position: absolute; left: 0; top: 100%; z-index: 20; background: var(--bg-elev); border: 1px solid var(--border-color); display: flex; flex-direction: column; min-width: 100%; }
  .sr-light-menu button { background: transparent; border: none; padding: 2px 8px; font-size: clamp(8px, .61vw, 12px); color: var(--text-main); cursor: pointer; text-align: left; }
  .sr-light-menu button:hover, .sr-light-menu button.selected { background: var(--accent-blue-bright); color: #fff; }
  .align-rows { padding: 0 8px; }
  .global-align { min-height: clamp(45px, 5.25vh, 64px); }
  .sr-align { min-height: clamp(17px, 2.1vh, 26px); }
  .align-row { display: grid; grid-template-columns: 24% 15% 40% 21%; font-size: clamp(8px, .61vw, 12px); line-height: clamp(15px, 1.8vh, 22px); gap: 0; white-space: nowrap; }
  .overlay-box { flex: 0 0 auto; padding: 4px 8px 3px; }
  .overlay-title { font-weight: 600; font-size: clamp(9px, .6vw, 12px); padding: 0 18px 4px; }
  .overlay-row { display: flex; justify-content: space-between; gap: 3px; }
  .overlay-row label { display: flex; align-items: center; gap: 3px; white-space: nowrap; font-size: clamp(8px, .59vw, 12px); color: var(--text-muted); }
  .overlay-row input { width: 11px; height: 11px; margin: 0; accent-color: var(--text-muted); }
  .tree { flex: 1; min-height: 0; overflow: auto; padding: 4px 8px 6px; background: var(--bg-header); }
  .tree-parent { margin-top: 5px; }
  .tree-row { align-items: center; display: flex; position: relative; min-height: clamp(22px, 2.73vh, 32px); }
  .tree-check { align-items: center; display: flex; flex: 0 0 20px; }
  .tree-check input { height: 12px; margin: 0; width: 12px; accent-color: var(--accent-blue); }
  .node-label { background: var(--node-bg, var(--text-main)); border: 0; border-radius: 0; cursor: pointer;
    font: 600 clamp(9px, .59vw, 12px)/1.15 'Segoe UI', sans-serif; width: min(61%, 128px); min-width: 56px; height: clamp(18px, 2.04vh, 26px);
    padding: 0 5px; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .parent-label { width: min(49%, 128px); }
  .align-parent > .tree-row { margin-left: 20px; }
  .align-parent > .tree-row .parent-label { width: min(54%, 128px); }
  .align-parent .tree-children { margin-left: 37px; }
  .align-parent .tree-children .tree-row { padding-left: 34px; }
  .align-parent .tree-children .tree-row::before { width: 32px; }
  .node-label:hover { filter: brightness(1.1); }
  .node-label.selected { outline: 1px solid var(--text-main); outline-offset: 1px; }
  .tree-children { border-left: 1px solid var(--text-muted); margin-left: 36px; }
  .tree-children .tree-row { padding-left: 14px; }
  .tree-children .tree-row::before { background: var(--text-muted); content: ''; height: 1px; left: 0; position: absolute; top: 50%; width: 13px; }
  .table-wrap { min-height: 0; overflow: hidden; }
  .table-wrap.master { flex: 0 0 23.9%; }
  .table-wrap.submaster { flex: 0 0 23.1%; }
  .inspection-block { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .table-wrap.inspection { flex: 1; }
  .read-table { height: 100%; overflow: auto; background: var(--bg-dark); }
  .editor-table { height: 100%; min-height: 0; }
  .editor-table[hidden], .read-table[hidden] { display: none; }
  .read-table table { border-collapse: collapse; table-layout: fixed; width: 100%; font-size: clamp(9px, .6vw, 12px); }
  .number-column { width: 14%; } .value-column { width: 31%; }
  .read-table th { font-weight: 400; text-align: left; background: var(--bg-header); position: sticky; top: 0; z-index: 1; }
  .read-table th, .read-table td { height: 21px; padding: 0 5px; border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); }
  .parameter-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .parameter-value { text-align: right; font-variant-numeric: tabular-nums; }
  .table-empty, .empty-record { padding: 0 6px; font-size: 11px; line-height: 1.5; color: var(--text-muted); }
  button:focus-visible, input:focus-visible, .read-table:focus-visible { outline: 2px solid #36c1ef; outline-offset: -2px; }
  .status-line { flex: 0 0 auto; background: var(--tint-ok); border-left: 3px solid var(--status-green); font-size: 11px; padding: 3px 6px; }
  .status-line.error { background: var(--tint-bad); border-left-color: #ed6565; }
  .dirty-note { padding: 4px 7px; color: var(--tint-warn-text); background: var(--tint-warn); font-size: 10px; }
  .settings-mode { position: fixed; inset: calc(var(--title-height) + var(--nav-height) + 40px) 0 0 var(--rail-width); z-index: 30; height: auto; background: var(--bg-dark); padding: 20px 24px 24px; }
  .settings-heading { display: flex; justify-content: space-between; align-items: center; flex: 0 0 auto; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; }
  .settings-heading h1 { font-size: 20px; font-weight: 400; margin: 0 0 4px; }
  .settings-heading p { color: var(--text-muted); font-size: 12px; margin: 0; }
  .edit-state { color: var(--status-green); font-size: 12px; }
  .model-bar { display: flex; align-items: center; flex: 0 0 auto; gap: 14px; padding: 14px 0 10px; }
  .host-field { display: flex; align-items: center; gap: 6px; }
  .model-name { flex: 1; color: var(--status-green); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-buttons { display: flex; gap: 6px; }
  .bar-buttons button, .reload-confirm button { background: var(--bg-elev); border: 1px solid var(--border-color); color: var(--text-main); font: 12px 'Segoe UI', sans-serif; padding: 6px 12px; cursor: pointer; }
  .bar-buttons button:disabled { color: var(--text-muted); cursor: default; }
  .settings-note { padding: 0 0 12px; color: var(--text-muted); font-size: 12px; }
  .reload-confirm { display: flex; align-items: center; gap: 10px; background: var(--tint-bad); color: var(--tint-warn-text); padding: 6px 10px; }
  .settings-mode .panel-head { flex-basis: 34px; grid-template-columns: 280px 1fr; }
  .settings-mode .panel-head > div { font-size: 14px; }
  .settings-mode .panel-columns { padding: 4px 0 0; }
  .settings-mode .tree-col { flex-basis: 280px; }
  .settings-mode .node-label { font-size: 12px; }
  .settings-mode .group-tabs, .settings-mode .light-tabs, .settings-mode .color-tabs { flex-basis: 28px; }
  .settings-mode .group-tabs button, .settings-mode .light-tabs button, .settings-mode .color-tabs button { font-size: 12px; }
  .settings-mode .align-row { font-size: 12px; }
  .settings-mode .table-wrap.master, .settings-mode .table-wrap.submaster { flex-basis: 25%; }
</style>
