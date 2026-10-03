<script lang="ts">
  import { onMount } from 'svelte';
  import { appService, type MigrationReport, type StorageConfig } from '../../lib/service';

  // Firestore connection settings are hardcoded (shipped in the Rust binary,
  // storage.rs) and shown here read-only - nothing to type for the operators.
  const FIRESTORE_SETTINGS = {
    projectId: 'project-f8cc5d3d-f29a-43ed-b7e',
    apiKey: 'AIzaSyAApVXlQFEKtq9Nd5lhgqytrxVUMtVmjP0',
    database: 'dmtafviparse0923',
    collection: 'documents'
  };

  const firestore = FIRESTORE_SETTINGS;
  let config = $state<StorageConfig | null>(null);
  let draft = $state<{ backend: 'local' | 'mongodb' | 'firestore'; mongodb: { url: string; database: string } }>({ backend: 'local', mongodb: { url: '', database: 'dmt_afvi' } });
  let testing = $state(false);
  let saving = $state(false);
  let migrating = $state(false);
  let isError = $state(false);
  let statusMessage = $state('');
  let mongoStatus = $state('');
  let firestoreStatus = $state('');
  let migrationReport = $state<(MigrationReport & { failedText: string }) | null>(null);

  onMount(async () => {
    await reload();
  });

  function backendLabel(backend: StorageConfig['backend'] | undefined | null): string {
    switch (backend) {
      case 'mongodb': return 'MongoDB';
      case 'firestore': return 'Firestore (Firebase)';
      default: return 'Local JSON files';
    }
  }

  async function reload(): Promise<void> {
    config = await appService.getStorageConfig();
    draft = {
      backend: config.backend === 'mongodb' || config.backend === 'firestore' ? config.backend : 'local',
      mongodb: { url: config.mongodb?.url ?? '', database: config.mongodb?.database ?? 'dmt_afvi' }
    };
    statusMessage = '';
    isError = false;
  }

  async function testConnection(): Promise<void> {
    testing = true;
    statusMessage = 'Testing...';
    isError = false;
    migrationReport = null;
    try {
      if (draft.backend === 'firestore') {
        statusMessage = await appService.testFirestoreConnection();
        firestoreStatus = 'connected';
      } else {
        statusMessage = await appService.testMongoConnection(draft.mongodb.url, draft.mongodb.database);
        mongoStatus = `${draft.mongodb.database}`;
      }
    } catch (error) {
      isError = true;
      statusMessage = toErrorMessage(error);
    } finally {
      testing = false;
    }
  }

  async function migrate(): Promise<void> {
    migrating = true;
    statusMessage = draft.backend === 'firestore' ? 'Migrating local documents into Firestore...' : 'Migrating local documents into MongoDB...';
    isError = false;
    try {
      const report = draft.backend === 'firestore'
        ? await appService.migrateLocalToFirestore()
        : await appService.migrateLocalToMongo(draft.mongodb.url, draft.mongodb.database);
      migrationReport = { ...report, failedText: report.failed.map((f) => `${f.key}: ${f.reason}`).join('; ') };
      statusMessage = 'Migration finished.';
    } catch (error) {
      isError = true;
      statusMessage = toErrorMessage(error);
    } finally {
      migrating = false;
    }
  }

  async function apply(): Promise<void> {
    saving = true;
    statusMessage = 'Applying...';
    isError = false;
    try {
      const next: StorageConfig = {
        backend: draft.backend,
        // keep the MongoDB settings so switching back restores them
        mongodb: { url: draft.mongodb.url.trim(), database: draft.mongodb.database.trim() || 'dmt_afvi' }
      };
      await appService.saveStorageConfig(next);
      config = await appService.getStorageConfig();
      statusMessage = `Applied. The app now reads and writes ${backendLabel(next.backend)}.`;
    } catch (error) {
      isError = true;
      statusMessage = toErrorMessage(error);
    } finally {
      saving = false;
    }
  }

  function toErrorMessage(error: unknown): string {
    return `Operation failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
  }
</script>

<div class="container">
  <h2>Database</h2>

  <div class="card">
    <div class="in-use">
      <span class="in-use-label">In use:</span>
      <span class="backend-badge" class:mongo={config?.backend === 'mongodb'} class:firestore={config?.backend === 'firestore'}>
        {backendLabel(config?.backend)}
      </span>
      {#if config?.backend === 'mongodb' && config?.mongodb?.database}
        <span class="in-use-detail">db: {config.mongodb.database}{mongoStatus ? ` · ${mongoStatus}` : ''}</span>
      {/if}
      {#if config?.backend === 'firestore'}
        <span class="in-use-detail">project: {firestore.projectId}{firestoreStatus ? ` · ${firestoreStatus}` : ''}</span>
      {/if}
    </div>

    <div class="form-group">
      <label>Backend</label>
      <select bind:value={draft.backend}>
        <option value="local">Local JSON files (offline, no server)</option>
        <option value="mongodb">MongoDB (shared cluster)</option>
        <option value="firestore">Firestore (Firebase cloud)</option>
      </select>
    </div>

    {#if draft.backend === 'mongodb'}
      <div class="form-group">
        <label>Connection String (mongodb+srv://user:password&#64;host/...)</label>
        <input type="text" bind:value={draft.mongodb.url} autocomplete="off" spellcheck="false" placeholder="mongodb+srv://user:password&#64;cluster0.xxx.mongodb.net">
      </div>
      <div class="form-group">
        <label>Database Name</label>
        <input type="text" bind:value={draft.mongodb.database} autocomplete="off" spellcheck="false" placeholder="dmt_afvi">
      </div>
      <div class="action-row">
        <button type="button" class="btn-secondary" disabled={testing} onclick={testConnection}>
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <button type="button" class="btn-secondary" disabled={migrating} onclick={migrate}>
          {migrating ? 'Migrating...' : 'Migrate Local Data → MongoDB'}
        </button>
        <button type="button" class="btn-primary-inline" disabled={saving} onclick={apply}>
          {saving ? 'Applying...' : 'Save & Apply'}
        </button>
      </div>
      <p class="note">Save &amp; Apply switches the app to this database immediately (also persisted in storage.json). Local JSON files stay as a read fallback and backup.</p>
    {/if}

    {#if draft.backend === 'firestore'}
      <div class="form-group">
        <label>Firebase Project (hardcoded)</label>
        <input type="text" value={firestore.projectId} readonly disabled>
      </div>
      <div class="form-group">
        <label>Web API Key (hardcoded)</label>
        <input type="text" value={firestore.apiKey} readonly disabled spellcheck="false">
      </div>
      <div class="form-group">
        <label>Collection / Database</label>
        <input type="text" value="{firestore.collection} · {firestore.database}" readonly disabled>
      </div>
      <div class="action-row">
        <button type="button" class="btn-secondary" disabled={testing} onclick={testConnection}>
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <button type="button" class="btn-secondary" disabled={migrating} onclick={migrate}>
          {migrating ? 'Migrating...' : 'Migrate Local Data → Firestore'}
        </button>
        <button type="button" class="btn-primary-inline" disabled={saving} onclick={apply}>
          {saving ? 'Applying...' : 'Save & Apply'}
        </button>
      </div>
      <p class="note">Save &amp; Apply switches the app to Firestore immediately (also persisted in storage.json). Local JSON files stay as a read fallback and backup.</p>
    {/if}

    {#if statusMessage}<div class="db-status" class:error={isError}>{statusMessage}</div>{/if}
    {#if migrationReport}
      <div class="db-report">
        Migrated {migrationReport.migrated.length} documents ({migrationReport.targetDocuments} in the target now)
        {#if migrationReport.failed.length}&nbsp;— {migrationReport.failed.length} failed: {migrationReport.failedText}{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: #f1f1f1; margin: 0 0 16px; font-size: 20px; }
  .card { background: #262626; border: 1px solid #4a4a4a; border-radius: 4px; padding: 20px; }
  .in-use { align-items: center; display: flex; gap: 8px; margin-bottom: 18px; }
  .in-use-label { color: #aaa; font-size: 12px; }
  .backend-badge { background: #3a5a3a; border: 1px solid #42c66d; border-radius: 10px; color: #c9f2d4; font-size: 11px; padding: 2px 10px; }
  .backend-badge.mongo { background: #3d3a5a; border-color: #7d6ce0; color: #d9d2f7; }
  .backend-badge.firestore { background: #1f3d4d; border-color: #29b6f6; color: #cfeaff; }
  .in-use-detail { color: #888; font-size: 11px; }
  .form-group { margin-bottom: 14px; } label { color: #aaa; display: block; font-size: 12px; margin-bottom: 6px; }
  select, input { background: #1e1e1e; border: 1px solid #505050; box-sizing: border-box; color: #f2f2f2; height: 36px; padding: 7px 10px; width: 100%; }
  select:focus, input:focus { border-color: #0088cc; outline: none; }
  input:disabled { color: #9fb4c4; }
  .action-row { display: flex; gap: 8px; margin-top: 6px; }
  .btn-secondary { background: #4d4d4d; border: 1px solid #666; color: #eee; cursor: pointer; flex: 1; height: 36px; } .btn-secondary:hover { background: #5a5a5a; } .btn-secondary:disabled { color: #888; cursor: default; }
  .btn-primary-inline { background: #087fc1; border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; } .btn-primary-inline:disabled { background: #484848; color: #a0a0a0; cursor: default; }
  .note { color: #888; font-size: 11px; line-height: 1.5; margin: 10px 0 0; }
  .db-status { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 14px; padding: 8px 10px; word-break: break-all; }
  .db-status.error { background: #4a2d2d; border-left-color: #ff5252; }
  .db-report { background: #2d2d3d; border-left: 4px solid #6d3fc1; color: #ddd; font-size: 11px; margin-top: 10px; padding: 8px 10px; word-break: break-all; }
</style>
