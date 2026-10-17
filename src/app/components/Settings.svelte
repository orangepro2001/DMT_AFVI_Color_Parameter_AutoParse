<script lang="ts">
  import DataCollection from './DataCollection.svelte';
  import MachineManagement from './MachineManagement.svelte';

  let { activeTab = $bindable<'machines' | 'collect'>('collect') }: {
    activeTab?: 'machines' | 'collect';
  } = $props();
</script>

<div class="settings-container">
  <section class="settings-page" hidden={activeTab !== 'collect'} aria-label="型号选择">
    <DataCollection />
  </section>
  <section class="settings-page" hidden={activeTab !== 'machines'} aria-label="Machine Configuration">
    <MachineManagement />
  </section>
</div>

<style>
  .settings-container { height: 100%; min-height: 0; background: var(--bg-dark); color: var(--text-main); overflow: hidden; }
  .settings-page { box-sizing: border-box; height: 100%; min-height: 0; overflow: auto; padding: 18px 24px; }
  .settings-page[hidden] { display: none; }
</style>
