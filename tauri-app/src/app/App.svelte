<script lang="ts">
  import { onMount } from 'svelte';
  import CalibrationLight from './components/CalibrationLight.svelte';
  import CenterImage from './components/CenterImage.svelte';
  import ParameterConfig from './components/ParameterConfig.svelte';
  import Settings from './components/Settings.svelte';
  import { appService } from '../lib/service';
  import { appStore } from '../lib/stores.svelte';
  import { initialTheme, persistTheme, type Theme } from '../lib/theme';

  // Set pre-mount by main.ts via the generated palette style sheet; only used
  // here for the button glyph.
  let theme = $state<Theme>(initialTheme());
  // A live in-place palette swap leaves mixed computed styles in this
  // WebView2 build, so toggling persists the choice and reloads the page -
  // the pre-mount application then paints the new theme from frame one.
  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    persistTheme(next);
    location.reload();
  }

  // Keep the last active tab across theme reloads.
  $effect(() => {
    try { localStorage.setItem('afvi-tab', appStore.activeTab); } catch { /* best-effort */ }
  });

  onMount(async () => {
    try {
      const tab = localStorage.getItem('afvi-tab');
      if (tab === 'teach' || tab === 'calibrate' || tab === 'settings') {
        appStore.activeTab = tab;
      }
    } catch { /* best-effort */ }
    appStore.machines = await appService.getMachines();
    const active = await appService.getActiveSelection();
    if (active) appStore.activeSelection = active;
  });
</script>

<div class="afvi-shell">
  <!-- Top Navigation -->
  <header class="top-nav">
    <div class="nav-links">
      <button class="nav-item disabled" disabled>HOME</button>
      <button class="nav-item" class:active={appStore.activeTab === 'teach'} onclick={() => (appStore.activeTab = 'teach')}>TEACH</button>
      <button class="nav-item disabled" disabled>REVIEW</button>
      <button class="nav-item" class:active={appStore.activeTab === 'calibrate'} onclick={() => (appStore.activeTab = 'calibrate')}>CALIBRATE</button>
      <button class="nav-item" class:active={appStore.activeTab === 'settings'} onclick={() => (appStore.activeTab = 'settings')}>SETTINGS</button>
    </div>
    <button class="theme-toggle" onclick={toggleTheme} aria-label="切换主题" title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}>
      {theme === 'dark' ? '☀' : '🌙'}
    </button>
    <div class="status-indicator">Ready</div>
  </header>

  <div class="workspace">
    <!-- Model selection entry -->
    <aside class="icon-sidebar">
      <button class="model-button" onclick={() => (appStore.activeTab = 'settings')}>Model</button>
    </aside>

    <!-- Center Area -->
    <main class="center-area">
      <div class="info-bar">
        <div class="info-item">
          <div class="info-label">MODEL :</div>
          <div class="info-value">{appStore.activeSelection?.modelName || '—'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">LOT :</div>
          <div class="info-value">TEST</div>
        </div>
      </div>

      <div class="image-view">
        <CenterImage />
      </div>

      <div class="status-bar">
        <span>CELL : 0</span>
        <div class="spacer"></div>
        <span>STRIP : 3659, 8309</span>
        <span>WH : 16384, 28672</span>
        <span>XY : 3659, 8309</span>
        <span>RGB : 22, 22, 22</span>
        <span>Avg. GV : 0</span>
        <span>Std. GV : 0.00</span>
      </div>

      <div class="log-panel">
        <div>2026-09-22 17:37:29 [Camera] Current Task Size=0</div>
        <div>2026-09-22 17:37:29 Defect Count [Total]: 77, [Light1]: 0, [Light2]: 15, [Light3]: 62</div>
        <div>2026-09-22 19:34:49 KeepAlive IP:192.168.200.13, PORT2000</div>
        <div>2026-09-22 19:34:49 KeepAlive IP:192.168.200.12, PORT2000</div>
        <div>2026-09-22 19:34:49 KeepAlive IP:192.168.200.11, PORT2000</div>
      </div>
    </main>

    <!-- Right Panel (tab content) -->
    <!-- All pages stay mounted (inline display toggling, not {#if}) so in-flight
         state - a running copy queue, TEACH selections - survives tab switches. -->
    <aside class="right-panel">
      <div class="tab-page" style={appStore.activeTab === 'teach' ? '' : 'display: none'}>
        <ParameterConfig />
      </div>
      <div class="tab-page" style={appStore.activeTab === 'calibrate' ? '' : 'display: none'}>
        <CalibrationLight />
      </div>
      <div class="tab-page" style={appStore.activeTab === 'settings' ? '' : 'display: none'}>
        <Settings />
      </div>
    </aside>
  </div>
</div>

<style>
  .afvi-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background-color: var(--bg-dark);
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  /* Top Navigation */
  .top-nav {
    display: flex;
    height: 40px;
    background-color: var(--bg-header);
    border-bottom: 1px solid var(--border-strong);
  }
  .nav-links {
    display: flex;
    flex: 1;
  }
  .nav-item {
    width: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 14px;
    font-weight: bold;
    border-right: 1px solid var(--bg-darker);
    background-color: var(--bg-header);
    border-top: 0;
    border-bottom: 0;
    border-left: 0;
    cursor: pointer;
  }
  .nav-item.active {
    background-color: var(--accent-blue-bright);
    color: white;
  }
  .nav-item.disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  .theme-toggle {
    width: 44px;
    border: 0;
    border-left: 1px solid var(--border-strong);
    background-color: var(--bg-header);
    color: var(--text-main);
    font-size: 16px;
    cursor: pointer;
  }
  .theme-toggle:hover {
    background-color: var(--accent-blue-bright);
    color: white;
  }
  .status-indicator {
    min-width: 180px;
    width: 22%;
    background-color: var(--status-green);
    color: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 16px;
  }

  /* Workspace */
  .workspace {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Icon Sidebar */
  .icon-sidebar {
    width: 62px;
    background-color: var(--bg-darker);
    display: flex;
    flex-direction: column;
    align-items: center;
    border-right: 1px solid var(--border-strong);
  }
  .model-button {
    align-items: center;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border-strong);
    border-top: 0;
    border-right: 0;
    border-left: 0;
    color: var(--text-main);
    display: flex;
    justify-content: center;
    min-height: 52px;
    width: 100%;
    cursor: pointer;
    font-weight: bold;
    font-size: 11px;
    text-decoration: none;
  }
  .model-button:hover { background-color: var(--accent-blue-bright); color: white; }
  .spacer { flex: 1; }

  /* Center Area */
  .center-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-deep);
  }
  .info-bar {
    display: flex;
    background-color: var(--bg-header);
    padding: 5px 15px;
    border-bottom: 1px solid var(--border-strong);
    align-items: center;
  }
  .info-item {
    margin-right: 30px;
    display: flex;
    flex-direction: column;
  }
  .info-label {
    font-size: 10px;
    color: var(--text-muted);
  }
  .info-value {
    font-size: 14px;
    color: var(--status-green);
    font-weight: bold;
  }

  .image-view {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .status-bar {
    display: flex;
    background-color: var(--bg-darker);
    padding: 5px 15px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border-strong);
    gap: 20px;
  }
  .log-panel {
    height: 120px;
    background-color: var(--bg-dark);
    color: var(--text-main);
    font-family: monospace;
    font-size: 11px;
    padding: 5px 10px;
    overflow-y: auto;
    border-top: 1px solid var(--border-strong);
    line-height: 1.4;
  }

  /* Right Panel */
  .right-panel {
    width: clamp(440px, 29vw, 560px);
    min-width: 440px;
    background-color: var(--bg-dark);
    border-left: 1px solid var(--border-strong);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .right-panel > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .tab-page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
