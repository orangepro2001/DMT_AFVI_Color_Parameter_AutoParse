<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type CopyPlan, type CopyReport, type HostId, type Machine } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';
  import SearchSelect from './SearchSelect.svelte';

  const HOSTS: HostId[] = ['FM1', 'FM2', 'BM'];

  /** FM1/FM2 may never exchange models with BM (either direction, even across machines). */
  function hostsCompatible(a: HostId, b: HostId): boolean {
    const isBottom = (host: HostId) => host === 'BM';
    return isBottom(a) === isBottom(b);
  }

  interface PairPlan {
    host: HostId;
    plan?: CopyPlan;
    error?: string;
  }

  interface PairReport {
    host: HostId;
    report?: CopyReport;
    error?: string;
  }

  let sourceMachineId = $state('');
  let targetMachineId = $state('');
  let sourceHost = $state<HostId>('FM1');
  let targetHost = $state<HostId>('FM1');
  /** One-click mode: copy FM1→FM1, FM2→FM2, BM→BM between two different machines at once. */
  let fullCopy = $state(false);
  let modelNames = $state<string[]>([]);
  let modelName = $state('');
  let pairPlans = $state<PairPlan[]>([]);
  let pairReports = $state<PairReport[]>([]);
  let statusMessage = $state('');
  let statusIsError = $state(false);
  let previewing = $state(false);
  let scanning = $state(false);
  let copying = $state(false);
  let confirming = $state(false);
  let confirmText = $state('');
  /** Set briefly when a conflicting FM↔BM pick was auto-corrected, for the warning line. */
  let lastAutoSwitch = $state('');

  const sourceMachine = $derived(machineById(sourceMachineId));
  const targetMachine = $derived(machineById(targetMachineId));
  const sourceReady = $derived(!!sourceMachine);
  const targetReady = $derived(!!targetMachine);
  const sameMachineSelected = $derived(!!fullCopy && sourceReady && targetReady && sourceMachineId === targetMachineId);
  const modelRowVisible = $derived(sourceReady && targetReady && (fullCopy ? !sameMachineSelected : true));
  const planModelName = $derived(pairPlans.find((pair) => pair.plan)?.plan?.model_name ?? modelName);
  const allPairsPlanned = $derived(pairPlans.length > 0 && pairPlans.every((pair) => !!pair.plan));

  onMount(async () => {
    appStore.machines = await appService.getMachines();
  });

  function machineById(id: string): Machine | undefined {
    return appStore.machines.find((machine) => machine.id === id);
  }

  function onModeChanged() {
    pairPlans = [];
    pairReports = [];
    statusMessage = '';
    void loadModels();
  }

  function onMachineChanged(side: 'source' | 'target') {
    if (side === 'source') {
      modelNames = [];
      modelName = '';
    }
    pairPlans = [];
    pairReports = [];
    void loadModels();
  }

  /** All three sides stay selectable; a conflicting FM↔BM pick flips the
   * OTHER side to the same class (BM→BM, FM→FM) instead of being blocked. */
  function onHostChanged(side: 'source' | 'target') {
    pairPlans = [];
    pairReports = [];
    if (sourceReady && targetReady && !hostsCompatible(sourceHost, targetHost)) {
      const host = side === 'source' ? sourceHost : targetHost;
      const flipped = host === 'BM' ? 'FM1' : 'BM';
      if (side === 'source') {
        targetHost = flipped;
      } else {
        sourceHost = flipped;
      }
      lastAutoSwitch = `${flipped} on the ${side === 'source' ? 'target' : 'source'} side`;
      window.setTimeout(() => { lastAutoSwitch = ''; }, 4000);
    }
    void loadModels();
  }

  /** Picking a model invalidates the previous plan/report. */
  function onModelPicked() {
    pairPlans = [];
    pairReports = [];
  }

  async function buildPreview() {
    if (!sourceMachine || !targetMachine || !modelName) return;
    previewing = true;
    statusMessage = '';
    statusIsError = false;
    pairReports = [];
    const source = sourceMachine;
    const target = targetMachine;
    const name = modelName;
    const sourceEndpoints = fullCopy
      ? HOSTS.map((host) => appService.endpointFor(source, host))
      : [appService.endpointFor(source, sourceHost)];
    const targetEndpoints = fullCopy
      ? HOSTS.map((host) => appService.endpointFor(target, host))
      : [appService.endpointFor(target, targetHost)];
    try {
      // read-only previews can run in parallel; per-pair errors are shown inline
      const plans = await Promise.all(sourceEndpoints.map(async (endpoint, index) => {
        try {
          return { host: sourceEndpoints.length === 1 ? sourceHost : HOSTS[index], plan: await appService.previewModelCopy(endpoint, targetEndpoints[index], name) };
        } catch (error) {
          return { host: sourceEndpoints.length === 1 ? sourceHost : HOSTS[index], error: String(error) };
        }
      }));
      pairPlans = plans;
    } catch (error) {
      statusMessage = String(error);
      statusIsError = true;
    }
    previewing = false;
  }

  function cancelConfirm() {
    confirming = false;
    confirmText = '';
  }

  async function runCopy() {
    if (copying) return; // never run two copies at once
    if (!sourceMachine || !targetMachine || confirmText !== planModelName || !allPairsPlanned) return;
    copying = true;
    confirming = false;
    confirmText = '';
    statusMessage = '';
    const target = targetMachine; // capture before awaiting
    const reports: PairReport[] = [];
    try {
      // pairs run sequentially and stop at the first failure, so the operator
      // always knows exactly which host copy broke off
      for (let index = 0; index < pairPlans.length; index++) {
        const host = pairPlans[index].host;
        statusMessage = `Copying to ${target.name} / ${host}… (${index + 1}/${pairPlans.length})`;
        const source = appService.endpointFor(sourceMachine, host);
        const destination = appService.endpointFor(target, host);
        try {
          const report = await appService.copyModelBetweenHosts(source, destination, modelName, true);
          reports.push({ host, report });
          const failed = report.entries.find((entry) => !entry.ok);
          if (failed) {
            statusMessage = `Copy stopped on ${host} at ${failed.kind}: ${failed.error}`;
            statusIsError = true;
            break;
          }
        } catch (error) {
          reports.push({ host, error: String(error) });
          statusMessage = `Copy failed on ${host}: ${error}`;
          statusIsError = true;
          break;
        }
      }
      if (!statusIsError) {
        statusMessage = `Model ${planModelName} copied to ${target.name}${fullCopy ? ' (FM1/FM2/BM)' : ' / ' + targetHost}.`;
        statusIsError = false;
        pairPlans = [];
      }
    } catch (error) {
      statusMessage = String(error);
      statusIsError = true;
    }
    pairReports = reports;
    copying = false;
  }

  /** The UNC paths the copy will actually use for a side, resolved like endpointFor does. */
  function endpointPaths(side: 'source' | 'target'): { inventory: string; repository: string } {
    const machine = side === 'source' ? sourceMachine : targetMachine;
    const host = side === 'source' ? sourceHost : targetHost;
    if (!machine) return { inventory: '', repository: '' };
    const endpoint = appService.endpointFor(machine, host);
    return { inventory: endpoint.inventory_path, repository: endpoint.repository_path };
  }

  async function loadModels() {
    const machine = sourceMachine;
    if (!machine) {
      modelNames = [];
      scanning = false;
      return;
    }
    scanning = true;
    // scan only the chosen source Vision PC: the other slots stay empty so the
    // Rust scanner skips them (a path that does not exist is skipped silently).
    // In full-copy mode the union of all three hosts is what matters, so the
    // machine is scanned whole.
    const pseudoMachine: Machine = fullCopy
      ? { ...machine }
      : {
          ...machine,
          fm1_path: sourceHost === 'FM1' ? appService.getHostPath(machine, sourceHost) : '',
          fm2_path: sourceHost === 'FM2' ? appService.getHostPath(machine, sourceHost) : '',
          bm_path: sourceHost === 'BM' ? appService.getHostPath(machine, sourceHost) : ''
        };
    try {
      const candidates = await appService.scanModels(pseudoMachine);
      modelNames = candidates.map((candidate) => candidate.name);
    } catch (error) {
      modelNames = [];
      statusMessage = String(error);
      statusIsError = true;
    } finally {
      scanning = false;
    }
  }
</script>

<div class="copier">
  <h2>Model Copier</h2>

  <label class="fullcopy-toggle">
    <input type="checkbox" bind:checked={fullCopy} onchange={onModeChanged}>
    One-click full machine copy (FM1→FM1, FM2→FM2, BM→BM between two different machines)
  </label>

  <div class="endpoints">
    <div class="endpoint-panel">
      <h3>Source</h3>
      <label>Machine</label>
      <select bind:value={sourceMachineId} onchange={() => onMachineChanged('source')}>
        <option value="" disabled>— select machine —</option>
        {#each appStore.machines as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
      <label>Vision PC</label>
      {#if fullCopy}<div class="all-hosts">FM1 / FM2 / BM <span class="all-note">(all three)</span></div>{/if}
      {#if !fullCopy}
        <select bind:value={sourceHost} onchange={() => onHostChanged('source')}>
          {#each HOSTS as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      {/if}
      {#if sourceReady && !fullCopy}
        <div class="path-hint mono">Inventory: {endpointPaths('source').inventory}<br>Repository: {endpointPaths('source').repository || '(not configured)'}</div>
      {/if}
    </div>

    <div class="arrow">→</div>

    <div class="endpoint-panel">
      <h3>Target</h3>
      <label>Machine</label>
      <select bind:value={targetMachineId} onchange={() => onMachineChanged('target')}>
        <option value="" disabled>— select machine —</option>
        {#each appStore.machines as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
      <label>Vision PC</label>
      {#if fullCopy}<div class="all-hosts">FM1 / FM2 / BM <span class="all-note">(all three)</span></div>{/if}
      {#if !fullCopy}
        <select bind:value={targetHost} onchange={() => onHostChanged('target')}>
          {#each HOSTS as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      {/if}
      {#if targetReady && !fullCopy}
        <div class="path-hint mono">Inventory: {endpointPaths('target').inventory}<br>Repository: {endpointPaths('target').repository || '(not configured)'}</div>
      {/if}
    </div>
  </div>

  {#if lastAutoSwitch && !fullCopy}
    <div class="warning">FM1/FM2 and BM cannot exchange models - {lastAutoSwitch} was switched to match.</div>
  {/if}
  {#if fullCopy && sameMachineSelected}
    <div class="warning">Full machine copy needs two different machines - pick another one on the target side.</div>
  {/if}

  {#if modelRowVisible}
    <div class="model-row">
      <div class="form-group">
        <label>Model on {sourceMachine?.name} / {fullCopy ? 'FM1+FM2+BM' : sourceHost}</label>
        <SearchSelect options={modelNames} bind:value={modelName} onpick={onModelPicked}
          placeholder={scanning ? 'Scanning models…' : '— select model —'} disabled={scanning} />
      </div>
      <button class="btn-secondary" onclick={buildPreview} disabled={!modelName || previewing || scanning || copying}>
        {previewing ? 'Scanning…' : (fullCopy ? 'Preview Full Copy' : 'Preview Copy')}
      </button>
    </div>
  {/if}

  {#if statusMessage}<div class="status" class:error={statusIsError}>{statusMessage}</div>{/if}

  {#if pairPlans.length}
    <div class="plan">
      <h3>Copy plan for {planModelName}</h3>
      {#each pairPlans as pair (pair.host)}
        {#if fullCopy}<div class="pair-title">{sourceMachine?.name}/{pair.host} → {targetMachine?.name}/{pair.host}</div>{/if}
        {#if pair.plan}
          <table>
            <thead><tr><th>Kind</th><th>Source (copy from)</th><th>Target (delete + copy)</th></tr></thead>
            <tbody>
              {#each pair.plan.entries as entry (entry.kind + entry.target)}
                <tr>
                  <td>{entry.kind}</td>
                  <td class="mono">{entry.source || '—'}</td>
                  <td class="mono">{entry.target} {#if entry.exists_on_target}<span class="tag">existing folder will be replaced</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="result-line error">{pair.error}</div>
        {/if}
      {/each}
      <button class="btn-danger" onclick={() => (confirming = true)} disabled={!allPairsPlanned || copying}>
        Start {fullCopy ? 'Full ' : ''}Copy…
      </button>
      {#if !allPairsPlanned}<div class="result-line error">Fix the failed pair above before copying.</div>{/if}
    </div>
  {/if}

  {#if pairReports.length}
    <div class="report">
      <h3>Result for {planModelName}</h3>
      {#each pairReports as pair (pair.host)}
        {#if fullCopy}<div class="pair-title">{pair.host}</div>{/if}
        {#if pair.report}
          {#each pair.report.entries as entry, index (index)}
            <div class="result-line" class:error={!entry.ok}>
              {entry.kind}: {entry.ok ? `copied to ${entry.target}` : entry.error}
            </div>
          {/each}
        {/if}
        {#if pair.error}<div class="result-line error">{pair.host}: {pair.error}</div>{/if}
      {/each}
    </div>
  {/if}

  <!-- Danger confirmation: the target model folders are deleted before the copy. -->
  {#if confirming}
    <div class="overlay">
      <div class="dialog">
        <h3>Confirm the {fullCopy ? 'full machine ' : ''}copy</h3>
        <p>This will <strong>delete</strong> the existing {planModelName} folders listed below and replace them
          with the ones from <strong>{sourceMachine?.name}</strong>{fullCopy ? '' : ` / ${sourceHost}`}:</p>
        <ul>
          {#each pairPlans as pair (pair.host)}
            {#if fullCopy}<li class="pair-title">→ {targetMachine?.name} / {pair.host}</li>{/if}
            {#each pair.plan?.entries ?? [] as entry, index (index)}
              <li><span class="mono">{entry.target}</span></li>
            {/each}
          {/each}
        </ul>
        <p>Type the model name <strong>{planModelName}</strong> to enable the copy.</p>
        <input type="text" bind:value={confirmText} placeholder={planModelName}>
        <div class="dialog-buttons">
          <button class="btn-secondary" onclick={cancelConfirm}>Cancel</button>
          <button class="btn-danger" disabled={confirmText !== planModelName || copying} onclick={runCopy}>
            {copying ? 'Copying…' : (fullCopy ? 'Delete and Copy All Hosts' : 'Delete and Copy')}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .copier { padding: 20px; max-width: 900px; margin: 0 auto; color: var(--text-main); }
  h2, h3 { margin-top: 0; }
  .fullcopy-toggle { display: flex; align-items: center; gap: 8px; margin: 10px 0 16px; font-size: 13px; cursor: pointer; }
  .fullcopy-toggle input { width: auto; }
  .endpoints { display: flex; align-items: flex-start; gap: 16px; }
  .endpoint-panel { flex: 1; background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; display: flex; flex-direction: column; gap: 8px; }
  .endpoint-panel label { color: var(--text-muted); font-size: 12px; }
  .endpoint-panel select { padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
  .all-hosts { padding: 8px; background: #1a2a3a; border: 1px solid #2a4a6a; color: #8cc8ff; border-radius: 2px; font-size: 13px; font-weight: bold; }
  .all-note { font-size: 10px; font-weight: normal; color: var(--text-muted); }
  .path-hint { margin-top: 4px; font-size: 10px; color: var(--text-muted); word-break: break-all; }
  .warning { margin-top: 12px; padding: 10px; background: #4a3200; border: 1px solid #b8860b; border-radius: 4px; }
  .model-row { display: flex; align-items: flex-end; gap: 12px; margin-top: 16px; }
  .form-group { flex: 1; }
  .form-group label { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
  select, input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
  .status { margin-top: 12px; padding: 8px; border-radius: 4px; background: var(--bg-panel); border: 1px solid var(--border-color); }
  .status.error { border-color: #d32f2f; color: #ef9a9a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
  .mono { font-family: Consolas, monospace; font-size: 11px; word-break: break-all; }
  .tag { color: #ffb74d; margin-left: 6px; }
  .plan, .report { margin-top: 16px; background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; }
  .pair-title { color: var(--accent-blue); font-size: 12px; font-weight: bold; margin: 8px 0 4px; }
  .result-line { padding: 4px 0; font-size: 12px; }
  .result-line.error { color: #ef9a9a; }
  button { padding: 8px 16px; border: none; border-radius: 2px; cursor: pointer; font-weight: bold; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: #3f3f46; color: white; }
  .btn-danger { background: #d32f2f; color: white; }
  .btn-danger:hover:not(:disabled) { background: #b71c1c; }
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: #232323; border: 1px solid #d32f2f; padding: 20px; border-radius: 4px; width: 560px; max-width: 90vw; max-height: 85vh; overflow: auto; }
  .dialog ul { font-size: 12px; list-style: none; padding-left: 0; }
  .dialog ul li { padding: 2px 0; }
  .dialog-buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
</style>
