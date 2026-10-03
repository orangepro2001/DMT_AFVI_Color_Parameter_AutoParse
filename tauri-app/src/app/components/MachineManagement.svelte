<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, deriveHostPath, type HostId, type Machine } from '../../lib/service';
  import { appStore } from '../../lib/stores.svelte';

  // one Vision PC = one PxInventory + one PxRepository share, both derived from the Main PC IP
  const hostFields: Array<{ host: HostId; inventory: keyof Machine; repository: keyof Machine; inventoryKey: string; repositoryKey: string }> = [
    { host: 'FM1', inventory: 'fm1_path', repository: 'fm1_repository_path', inventoryKey: 'fm1_path', repositoryKey: 'fm1_repository_path' },
    { host: 'FM2', inventory: 'fm2_path', repository: 'fm2_repository_path', inventoryKey: 'fm2_path', repositoryKey: 'fm2_repository_path' },
    { host: 'BM', inventory: 'bm_path', repository: 'bm_repository_path', inventoryKey: 'bm_path', repositoryKey: 'bm_repository_path' }
  ];

  /** Fields the user typed into manually keep their value when the IP changes. */
  let manuallyEdited = new Set<string>();
  let newMachine = $state<Machine>(emptyMachine());

  onMount(async () => {
    appStore.machines = await appService.getMachines();
  });

  function isAutoFilled(key: string): boolean {
    return !manuallyEdited.has(key) && !!derivedValue(key);
  }

  function touch(key: string) {
    manuallyEdited.add(key);
  }

  /** Refill every untouched path field from the Main PC IP. */
  function applyDerivedPaths() {
    for (const field of hostFields) {
      for (const key of [field.inventoryKey, field.repositoryKey]) {
        if (!manuallyEdited.has(key)) {
          newMachine[key as keyof Machine] = derivedValue(key);
        }
      }
    }
  }

  async function addMachine() {
    if (!newMachine.name) return;
    newMachine.id = Date.now().toString();
    appStore.machines.push({ ...newMachine });
    await appService.saveMachines(appStore.machines);
    newMachine = emptyMachine();
    manuallyEdited = new Set<string>();
  }

  async function deleteMachine(index: number) {
    appStore.machines.splice(index, 1);
    await appService.saveMachines(appStore.machines);
  }

  function derivedValue(key: string): string {
    const field = hostFields.find(item => item.inventoryKey === key || item.repositoryKey === key);
    if (!field) return '';
    const kind = key.endsWith('_repository_path') ? 'repository' : 'inventory';
    return deriveHostPath(newMachine.main_ip ?? '', field.host, kind);
  }

  function emptyMachine(): Machine {
    return { id: '', name: '', main_ip: '', fm1_path: '', fm2_path: '', bm_path: '', username: '', password: '' };
  }
</script>

<div class="container">
  <h2>Machine Management</h2>
  <div class="machine-list">
    {#each appStore.machines as m, i (m.id)}
      <div class="machine-item">
        <div class="machine-header">
          <strong>{m.name}</strong>
          {#if m.main_ip}<span class="main-ip">{m.main_ip}</span>{/if}
          <button class="btn-delete" onclick={() => deleteMachine(i)}>Delete</button>
        </div>
        <div class="machine-paths">
          {#each hostFields as f (f.host)}
            <div><strong>{f.host}</strong> — Inventory: {m[f.inventory]} · Repository: {m[f.repository] || '(auto)'}</div>
          {/each}
          {#if m.username}<div>Network User: {m.username}</div>{/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="add-machine-form">
    <h3>Register New Machine</h3>
    <div class="form-group">
      <label>Name (e.g. AFVI 14)</label>
      <input type="text" bind:value={newMachine.name} placeholder="AFVI 14">
    </div>
    <div class="form-group">
      <label>Main PC IP (Vision PCs derive from it: +1 FM1, +2 FM2, +3 BM)</label>
      <input type="text" value={newMachine.main_ip ?? ''} placeholder="192.168.1.60"
             oninput={(event) => { newMachine.main_ip = event.currentTarget.value; applyDerivedPaths(); }}>
    </div>

    {#each hostFields as f (f.host)}
      <div class="host-block">
        <div class="host-title">{f.host} Vision PC</div>
        <div class="host-paths">
          <div class="form-group">
            <label>PxInventory {#if isAutoFilled(f.inventoryKey)}<span class="derived-hint">(auto)</span>{/if}</label>
            <input type="text" bind:value={newMachine[f.inventory]} placeholder="\\192.168.1.61\PxInventory"
                   oninput={() => touch(f.inventoryKey)}>
          </div>
          <div class="form-group">
            <label>PxRepository {#if isAutoFilled(f.repositoryKey)}<span class="derived-hint">(auto)</span>{/if}</label>
            <input type="text" bind:value={newMachine[f.repository]} placeholder="\\192.168.1.61\PxRepository"
                   oninput={() => touch(f.repositoryKey)}>
          </div>
        </div>
      </div>
    {/each}

    <div class="form-group">
      <label>Network Username (optional, for UNC shares)</label>
      <input type="text" bind:value={newMachine.username} autocomplete="off" placeholder="domain\user or user">
    </div>
    <div class="form-group">
      <label>Network Password (optional)</label>
      <input type="password" bind:value={newMachine.password} autocomplete="new-password" placeholder="">
    </div>
    <button class="btn-primary" onclick={addMachine}>Register Machine</button>
  </div>
</div>

<style>
  .container { padding: 20px; max-width: 600px; margin: 0 auto; }
  h2, h3 { color: var(--text-main); margin-top: 0; }
  .machine-list { margin-bottom: 30px; }
  .machine-item { background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; margin-bottom: 10px; }
  .machine-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px; }
  .main-ip { color: var(--accent-blue); font-size: 12px; margin-left: auto; margin-right: 10px; }
  .machine-paths { font-size: 12px; color: var(--text-muted); }
  .machine-paths div { margin-bottom: 4px; }

  .add-machine-form { background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; }
  .form-group { margin-bottom: 15px; }
  .form-group label { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
  .form-group input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
  .form-group input:focus { outline: none; border-color: var(--accent-blue); }
  .derived-hint { color: var(--accent-blue); }
  .host-block { border: 1px solid #3f3f46; border-radius: 4px; padding: 12px; margin-bottom: 12px; }
  .host-title { font-size: 12px; font-weight: bold; color: var(--text-main); margin-bottom: 8px; }

  button { padding: 8px 16px; border: none; border-radius: 2px; cursor: pointer; font-weight: bold; }
  .btn-primary { background: var(--accent-blue); color: white; width: 100%; }
  .btn-primary:hover { background: #006ebd; }
  .btn-delete { background: #d32f2f; color: white; padding: 4px 8px; font-size: 11px; }
  .btn-delete:hover { background: #b71c1c; }
</style>
