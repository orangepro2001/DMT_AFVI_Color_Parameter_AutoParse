<script lang="ts">
  import { tick } from 'svelte';
  import { appService, type HostId, type Machine } from '../../lib/service';
  import { appStore, setActiveConnector, type ConnectorSelection } from '../../lib/stores.svelte';

  let {
    open = $bindable(false),
  }: { open?: boolean } = $props();

  const hosts: Array<{ id: HostId; label: string; side: string }> = [
    { id: 'FM1', label: 'FM1', side: 'Top 1' },
    { id: 'FM2', label: 'FM2', side: 'Top 2' },
    { id: 'BM', label: 'BM', side: 'Bottom' },
  ];

  let machineId = $state('');
  let host = $state<HostId>('FM1');
  let dialog = $state<HTMLDivElement>();
  let returnFocus: HTMLElement | null = null;
  let error = $state('');
  let wasOpen = false;

  const selectedMachine = $derived(appStore.machines.find((machine) => machine.id === machineId));
  const current = $derived(appStore.activeConnector);

  function seedFromCurrent(): void {
    const connector = appStore.activeConnector;
    const fallbackMachine = appStore.activeSelection?.machineId ?? appStore.machines[0]?.id ?? '';
    machineId = connector?.machineId ?? fallbackMachine;
    host = connector?.host ?? appStore.lightSimulation.host ?? 'FM1';
    error = '';
  }

  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      seedFromCurrent();
      void tick().then(() => dialog?.focus({ preventScroll: true }));
    } else if (!open && wasOpen) {
      wasOpen = false;
      const focusTarget = returnFocus;
      returnFocus = null;
      focusTarget?.focus({ preventScroll: true });
    }
  });

  function close(): void {
    open = false;
  }

  async function apply(): Promise<void> {
    const machine = selectedMachine;
    if (!machine) {
      error = '请先选择机台。';
      return;
    }
    const selection: ConnectorSelection = { machineId: machine.id, host };
    setActiveConnector(selection);
    const modelName = appStore.activeSelection?.modelName ?? appStore.stageTarget?.modelName ?? '';
    appStore.activeSelection = modelName ? { machineId: machine.id, modelName } : null;
    appStore.stageTarget = modelName ? { machineId: machine.id, modelName } : null;
    if (modelName) {
      try {
        await appService.saveActiveSelection({ machineId: machine.id, modelName });
      } catch {
        // The connector remains active in memory; the existing model save path
        // reports storage failures when the next model operation is attempted.
      }
    }
    close();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab' && dialog) {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, select'))
        .filter((control) => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay-root" class:open inert={!open}>
  <button class="scrim" tabindex="-1" aria-label="Close Connector" onclick={close}></button>
  <div class="dialog" bind:this={dialog} tabindex="-1" role="dialog" aria-modal="true" aria-label="Connector" aria-hidden={!open}>
    <header class="head">
      <div>
        <span class="title">Connector</span>
        <span class="subtitle">选择当前应用使用的机台与 Vision</span>
      </div>
      <button class="close" aria-label="Close" onclick={close}>&#10005;</button>
    </header>

    <div class="body">
      <label class="field">
        <span>Machine</span>
        <select bind:value={machineId} aria-label="Machine">
          <option value="">-- Select Machine --</option>
          {#each appStore.machines as machine (machine.id)}
            <option value={machine.id}>{machine.name}</option>
          {/each}
        </select>
      </label>

      <fieldset>
        <legend>Vision（一次只能选择一个）</legend>
        <div class="host-list" role="radiogroup" aria-label="Vision">
          {#each hosts as option}
            <label class="host-card" class:selected={host === option.id}>
              <input type="radio" name="connector-host" value={option.id} bind:group={host} />
              <span class="radio-mark" aria-hidden="true"></span>
              <span class="host-copy"><b>{option.label}</b><small>{option.side}</small></span>
            </label>
          {/each}
        </div>
      </fieldset>

      {#if current}<p class="current">当前：{appStore.machines.find((machine) => machine.id === current?.machineId)?.name ?? current.machineId} · {current.host}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>

    <footer class="foot">
      <button class="btn cancel" type="button" onclick={close}>Cancel</button>
      <button class="btn apply" type="button" disabled={!selectedMachine} onclick={() => void apply()}>Apply</button>
    </footer>
  </div>
</div>

<style>
  .overlay-root { display: none; inset: 0; position: fixed; z-index: 40; }
  .overlay-root.open { display: block; }
  .scrim { background: #0008; border: 0; inset: 0; position: absolute; width: 100%; }
  .dialog { background: var(--bg-panel); border: 1px solid var(--accent-blue-bright); box-shadow: 0 16px 48px #0009; color: var(--text-main); left: 50%; max-width: 520px; position: absolute; top: 50%; transform: translate(-50%, -50%); width: calc(100vw - 40px); }
  .head { align-items: flex-start; background: var(--bg-header); border-bottom: 1px solid var(--border-strong); display: flex; justify-content: space-between; padding: 14px 16px; }
  .title { display: block; font-size: 18px; font-weight: 700; }
  .subtitle { color: var(--text-muted); display: block; font-size: 12px; margin-top: 4px; }
  .close { background: transparent; border: 0; color: var(--text-muted); cursor: pointer; font-size: 18px; line-height: 1; padding: 0 2px; }
  .close:hover { color: var(--text-main); }
  .body { display: grid; gap: 18px; padding: 18px 20px 16px; }
  .field { display: grid; gap: 7px; }
  .field > span, legend { color: var(--text-muted); font-size: 12px; font-weight: 600; }
  select { background: var(--bg-input); border: 1px solid var(--border-strong); color: var(--text-main); height: 36px; padding: 0 10px; width: 100%; }
  fieldset { border: 1px solid var(--border-strong); margin: 0; min-width: 0; padding: 10px 12px 12px; }
  legend { padding: 0 5px; }
  .host-list { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .host-card { align-items: center; background: var(--bg-header); border: 1px solid var(--border-strong); cursor: pointer; display: flex; gap: 9px; min-height: 58px; padding: 0 10px; }
  .host-card.selected { background: var(--tint-blue); border-color: var(--accent-blue-bright); }
  .host-card input { height: 1px; opacity: 0; position: absolute; width: 1px; }
  .radio-mark { border: 2px solid var(--text-muted); border-radius: 50%; flex: 0 0 14px; height: 14px; position: relative; width: 14px; }
  .host-card.selected .radio-mark { border-color: var(--accent-blue-bright); }
  .host-card.selected .radio-mark::after { background: var(--accent-blue-bright); border-radius: 50%; content: ''; inset: 3px; position: absolute; }
  .host-copy { display: grid; gap: 3px; }
  .host-copy b { font-size: 14px; }
  .host-copy small { color: var(--text-muted); font-size: 11px; }
  .current, .error { font-size: 12px; margin: 0; }
  .current { color: var(--status-green); }
  .error { color: #e2755a; }
  .foot { border-top: 1px solid var(--border-strong); display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; }
  .btn { border: 1px solid var(--border-strong); cursor: pointer; font: inherit; height: 32px; min-width: 92px; }
  .cancel { background: var(--bg-header); color: var(--text-main); }
  .apply { background: var(--accent-blue-bright); border-color: var(--accent-blue-bright); color: #fff; }
  .apply:disabled { cursor: not-allowed; opacity: .45; }
  @media (max-width: 520px) { .host-list { grid-template-columns: 1fr; } }
</style>
