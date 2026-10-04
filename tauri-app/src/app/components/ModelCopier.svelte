<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type AgentProgress, type CopyPlan, type CopyReport, type HostId, type Machine, type MachineAgent } from '../../lib/service';
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

  /** One planned copy operation in the sequential job queue. All execution
   * inputs are captured at enqueue time so later form edits cannot change a
   * queued job's meaning. */
  interface CopyJob {
    id: number;
    label: string;
    sourceMachine: Machine;
    targetMachine: Machine;
    hosts: HostId[];
    modelName: string;
    renameTo: string;
    agent: MachineAgent | null;
    crossSite: boolean;
    sourceAgent?: MachineAgent;
    targetAgent?: MachineAgent;
    forceFull: boolean;
    status: 'queued' | 'running' | 'done' | 'failed';
    message: string;
    progress: AgentProgress | null;
  }

  let sourceMachineId = $state('');
  let targetMachineId = $state('');
  let sourceHost = $state<HostId>('FM1');
  let targetHost = $state<HostId>('FM1');
  /** One-click mode: copy FM1→FM1, FM2→FM2, BM→BM between two different machines at once. */
  let fullCopy = $state(false);
  let modelNames = $state<string[]>([]);
  let modelName = $state('');
  /** Optional new model number on the target side (rename/clone copy). */
  let renameTo = $state('');
  /** Cross-site copies skip files the target already has unless forced. */
  let forceFull = $state(false);
  let pairPlans = $state<PairPlan[]>([]);
  let pairReports = $state<PairReport[]>([]);
  let statusMessage = $state('');
  let statusIsError = $state(false);
  let previewing = $state(false);
  let scanning = $state(false);
  let confirming = $state(false);
  let confirmText = $state('');
  /** Set briefly when a conflicting FM↔BM pick was auto-corrected, for the warning line. */
  let lastAutoSwitch = $state('');

  // ---- sequential copy job queue ----
  // Jobs are added while another copy is still running; exactly one runs at a
  // time, in enqueue order. The component stays mounted across tab switches
  // (App.svelte keeps pages alive), so the queue and its progress survive.
  let jobQueue = $state<CopyJob[]>([]);
  let jobsExpanded = $state(false);
  let nextJobId = $state(1);
  let queueRunning = $state(false);

  const copying = $derived(jobQueue.some((job) => job.status === 'running'));
  const runningJob = $derived(jobQueue.find((job) => job.status === 'running') ?? null);
  const queuedCount = $derived(jobQueue.filter((job) => job.status === 'queued').length);
  const copyProgress = $derived(runningJob?.progress ?? null);

  const sourceMachine = $derived(machineById(sourceMachineId));
  const targetMachine = $derived(machineById(targetMachineId));
  const sourceReady = $derived(!!sourceMachine);
  const targetReady = $derived(!!targetMachine);
  const sameMachineSelected = $derived(!!fullCopy && sourceReady && targetReady && sourceMachineId === targetMachineId);
  const modelRowVisible = $derived(sourceReady && targetReady && (fullCopy ? !sameMachineSelected : true));
  const planModelName = $derived(pairPlans.find((pair) => pair.plan)?.plan?.model_name ?? modelName);
  const targetModelName = $derived(pairPlans.find((pair) => pair.plan)?.plan?.target_model_name ?? '');
  const allPairsPlanned = $derived(pairPlans.length > 0 && pairPlans.every((pair) => !!pair.plan));
  /** LAN agent for the copy: both machines must point at the same site agent
   * for a single-site relay. Different addresses mean a cross-site copy,
   * which is relayed agent→agent over QUIC. */
  const copyAgent = $derived.by(() => {
    const sourceAddr = sourceMachine?.agent?.addr.trim() ?? '';
    const targetAddr = targetMachine?.agent?.addr.trim() ?? '';
    if (sourceAddr && sourceAddr === targetAddr) {
      return { agent: { addr: sourceAddr, token: sourceMachine?.agent?.token ?? '' } as MachineAgent, crossSite: false };
    }
    return {
      agent: null,
      crossSite: !!(sourceAddr && targetAddr && sourceAddr !== targetAddr),
      sourceAgent: sourceAddr ? ({ addr: sourceAddr, token: sourceMachine?.agent?.token ?? '' } as MachineAgent) : null,
      targetAgent: targetAddr ? ({ addr: targetAddr, token: targetMachine?.agent?.token ?? '' } as MachineAgent) : null
    };
  });

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  /** Human label for the active tier of the cross-site fallback chain. */
  function relayLabel(relayMode: string): string {
    if (relayMode === 'quic') return 'QUIC direct (fast)';
    if (relayMode === 'tcp') return 'TCP data plane (UDP blocked - slower)';
    return '';
  }

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
    renameTo = '';
    void loadModels();
  }

  function onMachineChanged(side: 'source' | 'target') {
    if (side === 'source') {
      modelNames = [];
      modelName = '';
    }
    pairPlans = [];
    pairReports = [];
    renameTo = '';
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

  /** Picking a model invalidates the previous plan/report and any rename. */
  function onModelPicked() {
    pairPlans = [];
    pairReports = [];
    renameTo = '';
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
          return { host: sourceEndpoints.length === 1 ? sourceHost : HOSTS[index], plan: await appService.previewModelCopy(endpoint, targetEndpoints[index], name, renameTo.trim() || undefined) };
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

  /** Turn the confirmed plan into a queued job and start the pump. All inputs
   * are captured now - editing the form afterwards only affects the NEXT job. */
  function enqueueConfirmedCopy() {
    if (!sourceMachine || !targetMachine || !allPairsPlanned) return;
    const hosts = fullCopy ? [...HOSTS] : [targetHost];
    const job: CopyJob = {
      id: nextJobId++,
      label: `${planModelName}${targetModelName && targetModelName !== planModelName ? ` → ${targetModelName}` : ''} · ${sourceMachine.name}/${fullCopy ? 'FM1+FM2+BM' : sourceHost} → ${targetMachine.name}`,
      sourceMachine,
      targetMachine,
      hosts,
      modelName: planModelName,
      renameTo: targetModelName && targetModelName !== planModelName ? targetModelName : '',
      agent: copyAgent.agent,
      crossSite: copyAgent.crossSite,
      sourceAgent: copyAgent.sourceAgent ?? undefined,
      targetAgent: copyAgent.targetAgent ?? undefined,
      forceFull,
      status: 'queued',
      message: 'Waiting for the previous copy to finish…',
      progress: null
    };
    jobQueue = [...jobQueue, job];
    confirming = false;
    confirmText = '';
    pairPlans = [];
    statusMessage = `Copy of ${job.label} queued (${queuedCount + 1} waiting).`;
    statusIsError = false;
    void pumpQueue();
  }

  /** Single-worker queue: run queued jobs strictly one at a time, in order. */
  async function pumpQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (true) {
        const job = jobQueue.find((item) => item.status === 'queued');
        if (!job) break;
        await runJob(job);
      }
    } finally {
      queueRunning = false;
    }
  }

  function updateJob(id: number, patch: Partial<CopyJob>) {
    jobQueue = jobQueue.map((job) => (job.id === id ? { ...job, ...patch } : job));
  }

  /** Remove a job that has not started yet. */
  function removeQueuedJob(id: number) {
    jobQueue = jobQueue.filter((job) => !(job.id === id && job.status === 'queued'));
  }

  /** Drop finished/failed jobs from the list. */
  function clearFinishedJobs() {
    jobQueue = jobQueue.filter((job) => job.status === 'queued' || job.status === 'running');
  }

  /** Execute one job: its host pairs run sequentially and stop at the first
   * failure, so the operator always knows exactly which host copy broke off. */
  async function runJob(job: CopyJob) {
    updateJob(job.id, { status: 'running', message: 'Starting…', progress: null });
    const reports: PairReport[] = [];
    for (let index = 0; index < job.hosts.length; index++) {
      const host = job.hosts[index];
      updateJob(job.id, { progress: null, message: `Copying to ${job.targetMachine.name} / ${host}… (${index + 1}/${job.hosts.length})` });
      const source = appService.endpointFor(job.sourceMachine, host);
      const destination = appService.endpointFor(job.targetMachine, host);
      try {
        let report: CopyReport;
        if (job.agent) {
          report = await appService.copyModelBetweenHosts(
            source,
            destination,
            job.modelName,
            true,
            job.agent,
            (progress) => updateJob(job.id, { progress }),
            job.renameTo || undefined
          );
        } else if (job.crossSite && job.sourceAgent && job.targetAgent) {
          try {
            report = await appService.copyModelCrossSite(
              job.sourceAgent,
              job.targetAgent,
              source,
              destination,
              job.modelName,
              job.renameTo || undefined,
              job.forceFull,
              (progress) => updateJob(job.id, { progress })
            );
          } catch (relayError) {
            // one retry: WAN hiccups break the control connection, and the
            // incremental skip makes a re-run cheap (finished files jump over)
            updateJob(job.id, { message: `Relay interrupted (${relayError}) - retrying once (finished files are skipped)…` });
            try {
              report = await appService.copyModelCrossSite(
                job.sourceAgent,
                job.targetAgent,
                source,
                destination,
                job.modelName,
                job.renameTo || undefined,
                job.forceFull,
                (progress) => updateJob(job.id, { progress })
              );
            } catch (retryError) {
              // staged transfers never touched the target, direct copy is safe
              updateJob(job.id, { message: `Agent relay unavailable (${retryError}) - falling back to direct SMB copy (slow)…`, progress: null });
              report = await appService.copyModelBetweenHosts(source, destination, job.modelName, true, undefined, undefined, job.renameTo || undefined);
            }
          }
        } else {
          report = await appService.copyModelBetweenHosts(
            source,
            destination,
            job.modelName,
            true,
            undefined,
            undefined,
            job.renameTo || undefined
          );
        }
        reports.push({ host, report });
        const failed = report.entries.find((entry) => !entry.ok);
        if (failed) {
          updateJob(job.id, { status: 'failed', message: `Stopped on ${host} at ${failed.kind}: ${failed.error}`, progress: null });
          pairReports = reports;
          return;
        }
      } catch (error) {
        reports.push({ host, error: String(error) });
        updateJob(job.id, { status: 'failed', message: `Copy failed on ${host}: ${error}`, progress: null });
        pairReports = reports;
        return;
      }
    }
    updateJob(job.id, {
      status: 'done',
      message: `Copied to ${job.targetMachine.name}${job.renameTo ? ` as ${job.renameTo}` : ''}${job.hosts.length === 3 ? ' (FM1/FM2/BM)' : ''}.`,
      progress: null
    });
    pairReports = reports;
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
    // scanner skips them (only empty paths are skipped - an unreachable share
    // surfaces as an error, never as a silently empty model list).
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
      {#if !fullCopy}
        <div class="form-group">
          <label>Rename to (optional clone)</label>
          <input type="text" bind:value={renameTo} placeholder="keep {modelName || 'model name'}"
                 oninput={() => { pairPlans = []; pairReports = []; }}>
        </div>
      {/if}
      {#if !fullCopy && copyAgent.crossSite}
        <label class="forcefull-toggle">
          <input type="checkbox" bind:checked={forceFull} onchange={() => { pairPlans = []; pairReports = []; }}>
          Force full transfer
        </label>
      {/if}
      <button class="btn-secondary" onclick={buildPreview} disabled={!modelName || previewing || scanning || copying}>
        {previewing ? 'Scanning…' : (fullCopy ? 'Preview Full Copy' : 'Preview Copy')}
      </button>
    </div>
  {/if}

  {#if statusMessage}<div class="status" class:error={statusIsError}>{statusMessage}</div>{/if}

  <!-- Sequential copy job queue: collapsible, always visible while jobs exist.
       "Start Copy" is allowed while a copy runs - the new job simply waits. -->
  {#if jobQueue.length}
    <div class="jobbar" class:open={jobsExpanded}>
      <button class="jobbar-header" onclick={() => (jobsExpanded = !jobsExpanded)}>
        <span class="jobbar-arrow">{jobsExpanded ? '▾' : '▸'}</span>
        <span>Copy jobs</span>
        {#if runningJob}<span class="job-pill running">1 running</span>{/if}
        {#if queuedCount}<span class="job-pill queued">{queuedCount} queued</span>{/if}
        {#if !runningJob && !queuedCount}<span class="job-pill done">{jobQueue.length} finished</span>{/if}
      </button>

      {#if jobsExpanded}
        <div class="job-list">
          {#each jobQueue as job (job.id)}
            <div class="job" class:running={job.status === 'running'} class:failed={job.status === 'failed'} class:done={job.status === 'done'}>
              <div class="job-line">
                <span class="job-status job-status-{job.status}">
                  {job.status === 'queued' ? 'QUEUED' : job.status === 'running' ? 'RUNNING' : job.status === 'done' ? 'DONE' : 'FAILED'}
                </span>
                <span class="job-label mono">{job.label}</span>
                {#if job.status === 'queued'}
                  <button class="btn-tiny" onclick={() => removeQueuedJob(job.id)}>remove</button>
                {/if}
              </div>
              <div class="job-message">{job.message}</div>
              {#if job.status === 'running' && job.progress && job.progress.files_total > 0}
                <div class="progress-bar">
                  <div class="progress-fill" style={`width: ${Math.min(100, Math.round((100 * job.progress.files_done) / job.progress.files_total))}%`}></div>
                </div>
                <div class="progress-text mono">
                  {job.progress.kind}: {job.progress.files_done}/{job.progress.files_total} files · {formatBytes(job.progress.bytes_done)}
                  {#if relayLabel(job.progress.relay_mode ?? '')}&nbsp;· {relayLabel(job.progress.relay_mode ?? '')}{/if}
                  {#if job.progress.file}&nbsp;· {job.progress.file}{/if}
                </div>
              {/if}
            </div>
          {/each}
          {#if !runningJob && !queuedCount}
            <button class="btn-tiny clear-finished" onclick={clearFinishedJobs}>clear finished jobs</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- live progress of the running job stays visible even with the list collapsed -->
  {#if runningJob?.progress && runningJob.progress.files_total > 0}
    <div class="progress">
      <div class="progress-bar">
        <div class="progress-fill" style={`width: ${Math.min(100, Math.round((100 * runningJob.progress.files_done) / runningJob.progress.files_total))}%`}></div>
      </div>
      <div class="progress-text mono">
        {runningJob.label} · {runningJob.progress.kind}: {runningJob.progress.files_done}/{runningJob.progress.files_total} files · {formatBytes(runningJob.progress.bytes_done)}
        {#if relayLabel(runningJob.progress.relay_mode ?? '')}&nbsp;· {relayLabel(runningJob.progress.relay_mode ?? '')}{/if}
        {#if runningJob.progress.file}&nbsp;· {runningJob.progress.file}{/if}
      </div>
    </div>
  {/if}

  {#if copyAgent.crossSite && pairPlans.length}
    <div class="warning">
      Cross-site copy relays through both site agents over QUIC (UDP 3777) — the gigabit transfers stay
      inside each site's LAN. Falls back to slow direct SMB if either agent is unavailable.
    </div>
  {/if}

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
      <button class="btn-danger" onclick={() => (confirming = true)} disabled={!allPairsPlanned}>
        {copying ? 'Queue Next Copy…' : `Start ${fullCopy ? 'Full ' : ''}Copy…`}
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
        {#if targetModelName && targetModelName !== planModelName}
          <p class="rename-note">The copied folders will be <strong>renamed to {targetModelName}</strong> on the target - it becomes a new model.</p>
        {/if}
        <ul>
          {#each pairPlans as pair (pair.host)}
            {#if fullCopy}<li class="pair-title">→ {targetMachine?.name} / {pair.host}</li>{/if}
            {#each pair.plan?.entries ?? [] as entry, index (index)}
              <li><span class="mono">{entry.target}</span></li>
            {/each}
          {/each}
        </ul>
        <p>Type the model name <strong>{planModelName}</strong> to enable the copy. It joins the
          sequential job queue{#if copying} (a copy is running - this one starts automatically after it){/if}.</p>
        <input type="text" bind:value={confirmText} placeholder={planModelName}>
        <div class="dialog-buttons">
          <button class="btn-secondary" onclick={cancelConfirm}>Cancel</button>
          <button class="btn-danger" disabled={confirmText !== planModelName} onclick={enqueueConfirmedCopy}>
            {copying ? 'Queue Copy' : (fullCopy ? 'Delete and Copy All Hosts' : 'Delete and Copy')}
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
  .forcefull-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); cursor: pointer; white-space: nowrap; padding-bottom: 8px; }
  .forcefull-toggle input { width: auto; }
  .rename-note { color: #ffb74d; }
  .form-group { flex: 1; }
  .form-group label { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
  select, input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
  .status { margin-top: 12px; padding: 8px; border-radius: 4px; background: var(--bg-panel); border: 1px solid var(--border-color); }
  .status.error { border-color: #d32f2f; color: #ef9a9a; }
  .progress { margin-top: 8px; }
  .progress-bar { height: 8px; background: #1e1e1e; border: 1px solid #3f3f46; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--accent-blue); transition: width 0.2s ease; }
  .progress-text { margin-top: 4px; font-size: 10px; color: var(--text-muted); word-break: break-all; }
  .jobbar { margin-top: 12px; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; }
  .jobbar-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; background: transparent; color: var(--text-main); font-size: 12px; font-weight: bold; text-align: left; }
  .jobbar-header:hover { background: #2e2e34; }
  .jobbar-arrow { width: 12px; color: var(--text-muted); }
  .job-pill { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: normal; }
  .job-pill.running { background: #1a3a5a; color: #8cc8ff; }
  .job-pill.queued { background: #3a3416; color: #ffd54f; }
  .job-pill.done { background: #1d3a1d; color: #a5d6a7; }
  .job-list { padding: 4px 12px 10px; display: flex; flex-direction: column; gap: 8px; }
  .job { border: 1px solid var(--border-color); border-radius: 4px; padding: 8px 10px; }
  .job.running { border-color: var(--accent-blue); }
  .job.done { opacity: 0.65; }
  .job.failed { border-color: #d32f2f; }
  .job-line { display: flex; align-items: center; gap: 8px; }
  .job-status { font-size: 10px; font-weight: bold; letter-spacing: 0.5px; }
  .job-status-queued { color: #ffd54f; }
  .job-status-running { color: #8cc8ff; }
  .job-status-done { color: #a5d6a7; }
  .job-status-failed { color: #ef9a9a; }
  .job-label { flex: 1; font-size: 11px; }
  .job-message { margin-top: 3px; font-size: 10px; color: var(--text-muted); }
  .btn-tiny { background: #3f3f46; color: white; padding: 2px 8px; font-size: 10px; font-weight: normal; }
  .btn-tiny:hover { background: #55555e; }
  .clear-finished { align-self: flex-start; }
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
