<script lang="ts">
  import { tick } from 'svelte';
  import { appService, canonicalModelName, type Machine, type ModelCandidate } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';

  // The real AFVI machine's "Choose Model Names" dialog, reproduced item for
  // item: a fixed Product - Model source label, a five-column list
  // (Index / Creation Date/Time / Name / State / Resolution) and Apply / Cancel.
  // Both entry points share this one component - the rail's Model button and
  // Data Collection's "Choose Model" button.
  //
  // Product lists the PxRepository product folders (the Vision software's
  // per-model version folders); Model lists the PxInventory models the station
  // can teach and inspect. Apply makes the pick the active model, which is what
  // starts the MEDIAN images loading on the center stage.
  let {
    open = $bindable(false),
    machineId = '',
    onapply = (_machine: Machine, _modelName: string) => {},
  }: {
    open?: boolean;
    /** Pre-selected machine (Data Collection passes its own pick); empty falls
     * back to the active selection, then to the first configured machine. */
    machineId?: string;
    onapply?: (machine: Machine, modelName: string) => void;
  } = $props();

  let scanning = $state(false);
  let scanError = $state('');
  let selected = $state('');
  let cached = $state<{ rows: ModelCandidate[]; error: string } | null>(null);

  const machine = $derived.by<Machine | undefined>(() => {
    const explicit = machineId ? appStore.machines.find((item) => item.id === machineId) : undefined;
    if (explicit) return explicit;
    const activeId = appStore.activeSelection?.machineId;
    return appStore.machines.find((item) => item.id === activeId) ?? appStore.machines[0];
  });

  /** The model the machine is currently running - the row the real dialog
   * marks "Used", so an operator can find the one to reload. */
  const currentModel = $derived(appStore.activeSelection?.modelName ?? appStore.stageTarget?.modelName ?? '');
  const currentKey = $derived(canonicalModelName(currentModel));

  /** "2026-04-20 15:16:20" as the machine prints it. */
  function formatCreated(ms?: number): string {
    if (!ms) return '';
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sv-SE').replace('T', ' ');
  }

  async function runScan(kind: 'inventory' | 'repository'): Promise<void> {
    const target = machine;
    if (kind !== 'repository') return;
    if (!target) {
      scanError = 'No machine is configured yet - add one under Machine Configuration.';
      return;
    }
    scanning = true;
    scanError = '';
    try {
      const rows = kind === 'repository'
        ? await appService.scanModels(target, { kind, targets: appService.repositoryTargets(target) })
        : await appService.scanModels(target, { kind });
      cached = { rows, error: '' };
    } catch (error) {
      const message = typeof error === 'string' ? error : 'The scan failed.';
      cached = { rows: [], error: message };
      scanError = message;
    } finally {
      scanning = false;
    }
  }

  function close(): void {
    open = false;
  }

  function apply(): void {
    const target = machine;
    if (!target || !selected) return;
    const modelName = selected;
    void appService.saveActiveSelection({ machineId: target.id, modelName });
    // Publishing the stage target is what actually makes the center stage load
    // the model's MEDIAN images (same hop Data Collection's picker uses).
    appStore.stageTarget = { machineId: target.id, modelName };
    onapply(target, modelName);
    close();
  }

  let dialog = $state<HTMLDivElement>();
  let returnFocus: HTMLElement | null = null;
  $effect(() => {
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      selected = '';
      void tick().then(() => {
        if (open) dialog?.focus({ preventScroll: true });
      });
      // A fresh open always re-reads PxRepository: the folders may have
      // changed since the last pick, and a stale list is worse than a wait.
      cached = null;
      scanError = '';
      scanning = true;
      void runScan('repository');
    } else if (returnFocus) {
      returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab' && dialog) {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select'))
        .filter((control) => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay-root" class:open inert={!open}>
  <button class="scrim" tabindex="-1" aria-label="Close model picker" onclick={close}></button>

  <div class="dialog" bind:this={dialog} tabindex="-1" role="dialog" aria-modal="true" aria-label="Choose Model Names" aria-hidden={!open}>
    <header class="head">
      <span class="title">Choose Model Names</span>
      <button class="close" aria-label="Close" onclick={close}>&#10005;</button>
    </header>

    <div class="source-label">Product - Model</div>

    <div class="row head-row" role="presentation">
      <span>Index</span><span>Creation Date/Time</span><span>Name</span><span>State</span><span>Resolution</span>
    </div>

    <div class="list" id="model-list" role="listbox" aria-label="Product - Model names">
      {#each cached?.rows ?? [] as row, index (row.name)}
        <button class="row" type="button" role="option" aria-selected={selected === row.name}
          onclick={() => (selected = row.name)} ondblclick={apply}>
          <span>{(index + 1).toString().padStart(2, '0')}</span>
          <span>{formatCreated(row.created_ms)}</span>
          <span class="name">{row.name}</span>
          <span>{canonicalModelName(row.name) === currentKey ? 'Used' : ''}</span>
          <span></span>
        </button>
      {/each}
      {#if scanning}
        <p class="note">Scanning PxRepository on {machine?.name ?? 'the machine'}...</p>
      {:else if scanError}
        <p class="note error">{scanError}</p>
      {:else if !(cached?.rows.length ?? 0)}
        <p class="note">
          No model folders were found on this machine.
        </p>
      {/if}
    </div>

    <footer class="foot">
      <button class="btn apply" type="button" disabled={!selected} onclick={apply}>Apply</button>
      <button class="btn cancel" type="button" onclick={close}>Cancel</button>
    </footer>
  </div>
</div>

<style>
  /* Reference size 1692x1045: the dialog box measures about 595x395. */
  .overlay-root {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    visibility: hidden;
    transition: visibility 0s linear .18s;
  }
  .overlay-root.open {
    pointer-events: auto;
    visibility: visible;
    transition-delay: 0s;
  }

  .scrim {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: rgba(0, 0, 0, .32);
    opacity: 0;
    transition: opacity .18s ease;
  }
  .overlay-root.open .scrim { opacity: 1; }

  .dialog {
    --dlg-font: 14px;
    --row-h: 22px;
    --pane-bg: #303030;
    --pane-text: #ccc;
    --pane-line: #535353;
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(92vw, 595px);
    height: min(72vh, 395px);
    box-sizing: border-box;
    background: var(--pane-bg);
    border: 1px solid #168ac0;
    box-shadow: 0 6px 24px rgba(0, 0, 0, .5);
    color: var(--pane-text);
    font: var(--dlg-font)/1 'Segoe UI', sans-serif;
    outline: none;
    opacity: 0;
    transition: opacity .18s ease;
  }
  .overlay-root.open .dialog { opacity: 1; }

  .head {
    display: flex;
    align-items: center;
    gap: 0;
    flex: none;
    height: 33px;
    padding: 0 11px;
    box-sizing: border-box;
  }
  .title { flex: none; }
  .source-label {
    flex: none;
    height: 27px;
    box-sizing: border-box;
    padding: 0 10px;
    color: var(--pane-text);
    line-height: 27px;
  }
  .close {
    margin-left: auto;
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid transparent;
    background: transparent;
    color: #d0453f;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .close:hover { border-color: #d0453f; }

  .row {
    display: grid;
    grid-template-columns: 75px 152px 151px 51px 126px;
    align-items: center;
    flex: none;
    height: var(--row-h);
    box-sizing: border-box;
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0 10px;
  }
  .row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row > span:nth-child(1), .row > span:nth-child(2),
  .row > span:nth-child(3), .row > span:nth-child(5) { text-align: right; }
  .head-row {
    height: 27px;
    background: #3c3c3c;
    border-top: 1px solid var(--pane-line);
    border-bottom: 1px solid var(--pane-line);
  }
  button.row { cursor: pointer; }
  button.row:hover { background: #ffffff14; }
  button.row[aria-selected="true"] { background: var(--machine-blue); color: #fff; }
  .name { padding-left: 8px; }

  .list { flex: 1; min-height: 0; overflow-y: auto; }
  .note { color: var(--pane-text); margin: 0; padding: 18px 12px; text-align: center; }
  .note.error { color: #ef8a84; }

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: calc(var(--dlg-font) * .571429);
    flex: none;
    padding: 8px;
    box-sizing: border-box;
  }
  .btn {
    border: 1px solid var(--pane-line);
    width: 126px;
    min-width: 126px;
    height: 30px;
    padding: 0 12px;
    background: #454545;
    color: var(--pane-text);
    cursor: pointer;
    font: inherit;
  }
  .btn.apply { background: var(--machine-blue); border-color: var(--machine-blue); color: #fff; }
  .btn.apply:disabled { background: #454545; border-color: var(--pane-line); color: #7d7d7d; cursor: default; }
  .dialog button:focus-visible { outline: 1px solid var(--machine-cyan); outline-offset: -2px; }

  :global(body[data-theme="light"]) .dialog {
    --pane-bg: var(--machine-shell);
    --pane-text: var(--text-main);
    --pane-line: var(--machine-tool-border);
  }
  :global(body[data-theme="light"]) .head-row { background: var(--machine-panel); }
  :global(body[data-theme="light"]) .btn { background: #d5d9dd; }
  :global(body[data-theme="light"]) .btn.apply { background: var(--machine-blue); border-color: var(--machine-blue); color: #fff; }
  :global(body[data-theme="light"]) .btn.apply:disabled { background: #d5d9dd; border-color: var(--pane-line); color: #8b9299; }
  :global(body[data-theme="light"]) button.row:hover { background: #00000010; }
  :global(body[data-theme="light"]) .note.error { color: #b3261e; }
  @media (prefers-reduced-motion: reduce) {
    .overlay-root, .scrim, .dialog { transition: none; }
  }
</style>
