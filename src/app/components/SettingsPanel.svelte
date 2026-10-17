<script lang="ts">
  // SETTINGS tab right panel: our original settings areas rearranged into the
  // real machine's collapsible-section ("accordion") layout. The center stage
  // stays mounted and visible the whole time - this panel only hosts content.
  import DataCollection from './DataCollection.svelte';
  import ImageAlignSettings from './ImageAlignSettings.svelte';
  import MachineManagement from './MachineManagement.svelte';
  import ParameterConfig from './ParameterConfig.svelte';
  import { stageApi } from '../../lib/stage-api.svelte';

  type SettingsPage = 'collect' | 'machines' | 'image' | 'parameters';

  let { page = $bindable<SettingsPage>('collect') }: { page?: SettingsPage } = $props();

  const sections: Array<{ id: SettingsPage; label: string; hint: string }> = [
    { id: 'collect', label: '型号选择', hint: '选择型号并实时加载' },
    { id: 'machines', label: 'Machine Configuration', hint: '机台与共享路径' },
    { id: 'image', label: 'Image / Alignment', hint: '图像显示与配准教学' },
    { id: 'parameters', label: 'Teaching Parameters', hint: '检测参数编辑' },
  ];

  // Accordion state: sections toggle independently; the first one is open on
  // arrival. Selecting a page (nav / rail shortcuts) opens its section too.
  let open = $state<Record<SettingsPage, boolean>>({
    collect: true, machines: false, image: false, parameters: false,
  });
  let lastPage: SettingsPage | null = null;

  $effect(() => {
    const target = page;
    if (target && target !== lastPage) {
      lastPage = target;
      open[target] = true;
    }
  });

  function toggle(id: SettingsPage): void {
    open[id] = !open[id];
    page = id;
    lastPage = id; // a manual toggle owns this page; do not auto-reopen it
  }
</script>

<div class="accordion">
  {#each sections as section (section.id)}
    <section class="acc" class:open={open[section.id]}>
      <button class="acc-head" class:active={page === section.id} aria-expanded={open[section.id]} onclick={() => toggle(section.id)}>
        <span class="dot"></span>
        <span class="acc-title">{section.label}</span>
        <span class="acc-hint">{section.hint}</span>
        <span class="chev">{open[section.id] ? '▾' : '▸'}</span>
      </button>
      <div class="acc-body" hidden={!open[section.id]}>
        {#if section.id === 'collect'}
          <DataCollection />
        {:else if section.id === 'machines'}
          <MachineManagement />
        {:else if section.id === 'image'}
          {#if stageApi.current}
            <ImageAlignSettings api={stageApi.current} />
          {:else}
            <p class="wait">Wait for the image stage to load.</p>
          {/if}
        {:else if section.id === 'parameters'}
          <div class="param-host"><ParameterConfig showSettings fullscreen={false} /></div>
        {/if}
      </div>
    </section>
  {/each}
</div>

<style>
  .accordion { height: 100%; min-height: 0; overflow: auto; background: var(--machine-shell); color: var(--text-main); font: 12px 'Segoe UI', sans-serif; }
  .acc { border-bottom: 1px solid #1c1c1e; }
  .acc-head { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: var(--machine-shell); color: var(--text-main); cursor: pointer; font: inherit; padding: 9px 10px; text-align: left; }
  .acc-head:hover { background: var(--machine-panel); }
  .acc-head.active { background: var(--machine-panel); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--machine-cyan); flex: none; }
  .acc-title { font-size: 12px; font-weight: 600; white-space: nowrap; }
  .acc-hint { color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { margin-left: auto; color: var(--machine-icon); font-size: 11px; }
  .acc-body { border-top: 1px solid #1c1c1e; }
  .acc-body[hidden] { display: none; }
  .wait { color: var(--text-muted); padding: 12px; }
  /* Teaching Parameters keeps its own two-pane layout; a fixed height gives the
     flex children (tables) a definite box inside the scrolling accordion. */
  .param-host { height: 560px; }
</style>
