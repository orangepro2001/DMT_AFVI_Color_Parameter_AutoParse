<script lang="ts">
  import DataCollection from './DataCollection.svelte';
  import DatabaseSettings from './DatabaseSettings.svelte';
  import MachineManagement from './MachineManagement.svelte';

  let activeTab = $state<'machines' | 'collect' | 'database'>('collect');
</script>

<div class="settings-container">
  <div class="tabs top-tabs">
    <div class="tab" class:active={activeTab === 'collect'} onclick={() => (activeTab = 'collect')} onkeydown={(e) => e.key === 'Enter' && (activeTab = 'collect')} role="tab" tabindex="0">Data Collection</div>
    <div class="tab" class:active={activeTab === 'machines'} onclick={() => (activeTab = 'machines')} onkeydown={(e) => e.key === 'Enter' && (activeTab = 'machines')} role="tab" tabindex="0">Machine Configuration</div>
    <div class="tab" class:active={activeTab === 'database'} onclick={() => (activeTab = 'database')} onkeydown={(e) => e.key === 'Enter' && (activeTab = 'database')} role="tab" tabindex="0">Database</div>
  </div>

  <div class="settings-content">
    {#if activeTab === 'machines'}
      <MachineManagement />
    {:else if activeTab === 'collect'}
      <DataCollection />
    {:else if activeTab === 'database'}
      <DatabaseSettings />
    {/if}
  </div>
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: #2b2b2b;
    color: white;
  }
  .tabs {
    display: flex;
    background-color: #333;
  }
  .tab {
    padding: 10px 15px;
    cursor: pointer;
    flex: 1;
    text-align: center;
    font-weight: bold;
    border-right: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    background-color: #444;
    color: #aaa;
  }
  .tab.active {
    background-color: #e6e6fa;
    color: #000;
    border-bottom: none;
  }
  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }
</style>
