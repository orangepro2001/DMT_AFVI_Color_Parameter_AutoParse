<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import CalibrationLight from './components/CalibrationLight.svelte';
  import CenterImage from './components/CenterImage.svelte';
  import ParameterConfig from './components/ParameterConfig.svelte';
  import ReviewDefect from './components/ReviewDefect.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { appService } from '../lib/service';
  import { appStore, type AppTab } from '../lib/stores.svelte';
  import { initialTheme, persistTheme, type Theme } from '../lib/theme';

  let theme = $state<Theme>(initialTheme());
  let now = $state(new Date());
  let functionMenu = $state(false);
  let settingsPage = $state<'collect' | 'machines' | 'database' | 'image' | 'parameters'>('collect');
  let centerImage = $state<ReturnType<typeof CenterImage>>();
  let toolState = $state({ scale: 1, drawMode: false, measureMode: false, grid: false, hasImage: false, canMeasure: false, side: 'TOP' as 'TOP' | 'BOTTOM', metalOn: false });
  let light = $state(1);
  let channel = $state('Red');
  let ready = $state(false);
  let startupError = $state('');
  let logs = $state<string[]>([]);
  let loggedModel = '';
  const readout = $derived(appStore.stageReadout);
  const target = $derived(appStore.stageTarget ?? appStore.activeSelection);
  const timeText = $derived(now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: true }));
  const dateText = $derived(now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }));
  function logEvent(message: string): void {
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
    logs = [...logs.slice(-199), `${stamp}  ${message}`];
  }
  function navigate(tab: AppTab): void { appStore.activeTab = tab; functionMenu = false; }
  function openSettings(page: typeof settingsPage): void {
    settingsPage = page;
    navigate('settings');
  }
  function toggleTheme(): void { persistTheme(theme === 'dark' ? 'light' : 'dark'); location.reload(); }
  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { logEvent(`Fullscreen: ${error instanceof Error ? error.message : String(error)}`); }
  }
  $effect(() => { try { localStorage.setItem('afvi-tab', appStore.activeTab); } catch { /* best-effort */ } });
  $effect(() => {
    const model = target?.modelName;
    if (ready && model && model !== loggedModel) {
      loggedModel = model;
      untrack(() => logEvent(`[Model] Selected ${model}`));
    }
    if (!model) loggedModel = '';
  });
  onMount(() => {
    const timer = window.setInterval(() => now = new Date(), 1000);
    let disposed = false;
    try {
      const tab = localStorage.getItem('afvi-tab');
      if (tab === 'teach' || tab === 'review' || tab === 'calibrate' || tab === 'settings') appStore.activeTab = tab;
    } catch { /* best-effort */ }
    void (async () => {
      try {
        const [machines, active] = await Promise.all([appService.getMachines(), appService.getActiveSelection()]);
        if (disposed) return;
        appStore.machines = machines;
        if (active) appStore.activeSelection = active;
        ready = true;
        logEvent('[UI] Ready');
        logEvent(`[Configuration] ${machines.length} machine(s) available`);
        if (!active) logEvent('[Model] Select a model in Settings > Model / Data Collection');
      } catch (error) {
        if (disposed) return;
        startupError = error instanceof Error ? error.message : String(error);
        logEvent(`[Error] ${startupError}`);
      }
    })();
    return () => { disposed = true; window.clearInterval(timer); };
  });
</script>

{#snippet icon(name: string)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if name === 'info'}<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>
    {:else if name === 'user'}<circle cx="12" cy="8" r="4"/><path d="M3 22v-2a9 9 0 0 1 18 0v2"/>
    {:else if name === 'share'}<circle cx="5" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8 10 7-4M8 14l7 4"/>
    {:else if name === 'cube'}<path d="M12 3 20 7.5v9L12 21 4 16.5v-9zM4 7.5 12 12l8-4.5M12 12v9"/>
    {:else if name === 'sheets'}<rect x="3" y="3" width="14" height="13" rx="1"/><rect x="7" y="8" width="14" height="13" rx="1"/><path d="m3 13 5-5 5 4 4-3"/>
    {:else if name === 'flow'}<circle cx="12" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="19" cy="20" r="2"/><path d="M12 6v9M5 17v-4h14v4"/>
    {:else if name === 'flag'}<path d="M4 3v18M8 5h13v5H8zM8 14h8v5H8z"/>
    {:else if name === 'region'}<path d="M4 8V4h5M10 4 6 12h5M4 12v8h5M15 4h5v6"/><circle cx="15" cy="15" r="4"/><path d="m18 18 3 3"/>
    {:else if name === 'stack'}<rect x="3" y="3" width="15" height="14" rx="1"/><path d="M7 7h15v14H7v-4M6 7h9M6 11h9"/>
    {:else if name === 'save'}<path d="M3 3h15l3 3v15H3zM7 3v6h10V3M7 21v-9h10v9M14 3v4"/>
    {:else if name === 'search'}<rect x="3" y="3" width="16" height="18" rx="1"/><path d="M6 7h10M6 11h7"/><circle cx="16" cy="16" r="3.4"/><path d="m18.4 18.4 3 3"/>
    {:else if name === 'tools'}<path d="M14 4a4 4 0 0 0-3.7 5.5L4 15.8 8.2 20l6.3-6.3A4 4 0 0 0 20 10zM7 6l3 3M5 18l2-2"/>
    {:else if name === 'fit'}<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>
    {:else if name === 'ruler'}<path d="m3 7 4-4 14 14-4 4zM8 6l-2 2M11 9l-2 2M14 12l-2 2M17 15l-2 2"/>
    {:else if name === 'layers'}<path d="M12 4 20 8l-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"/>
    {:else if name === 'grid'}<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/>
    {:else if name === 'points'}<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 8h1M12 8h1M16 8h1M8 12h1M12 12h1M16 12h1M8 16h1M12 16h1M16 16h1"/>
    {:else if name === 'columns'}<path d="M6 5v14M9 5v14M12 5v14M15 5v14M18 5v14"/>
    {:else if name === 'cells'}<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>
    {:else if name === 'bulb'}<path d="M9 15v-2a5 5 0 1 1 6 0v2zM9 18h6M11 21h2"/>
    {:else if name === 'zoom-in' || name === 'zoom-out'}<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/>{#if name === 'zoom-in'}<path d="M10 7v6"/>{/if}
    {:else if name === 'sun'}<circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/>
    {:else if name === 'moon'}<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11z"/>
    {:else if name === 'aperture'}<circle cx="12" cy="12" r="9"/><path d="m8 4 9 5 2 9M17 9l-1 11M16 20l-9-6-2-8M7 14l1-10M7 14h12M5 6h12"/>
    {/if}
  </svg>
{/snippet}
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') functionMenu = false; }}/>
<div class="afvi-shell">
  <header class="title-bar">
    <div class="brand"><div>Pixel Vision Inspection System - Master</div><small>Provide high quality and high speed inspection machines</small></div>
    <div class="clock"><span>{timeText}</span><span>{dateText}</span></div>
    <div class="operator"><span>Admin</span><small>AFVI · Teaching workspace</small></div>
    <div class="title-actions">
      <button title="Machine Configuration" aria-label="Machine Configuration" onclick={() => openSettings('machines')}>{@render icon('user')}</button>
      <button title="Calibration" aria-label="Calibration" onclick={() => navigate('calibrate')}>{@render icon('aperture')}</button>
      <button title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'} aria-label="切换主题" onclick={toggleTheme}>{@render icon(theme === 'dark' ? 'sun' : 'moon')}</button>
    </div>
  </header>
  <header class="top-nav">
    <nav class="nav-links" aria-label="Main navigation">
      <button class="nav-item" disabled title="功能待对接">HOME</button>
      <button class="nav-item" class:active={appStore.activeTab === 'teach'} aria-current={appStore.activeTab === 'teach' ? 'page' : undefined} onclick={() => navigate('teach')}>TEACH</button>
      <button class="nav-item" class:active={appStore.activeTab === 'review'} aria-current={appStore.activeTab === 'review' ? 'page' : undefined} onclick={() => navigate('review')}>REVIEW</button>
      <button class="nav-item" class:active={appStore.activeTab === 'calibrate'} aria-current={appStore.activeTab === 'calibrate' ? 'page' : undefined} onclick={() => navigate('calibrate')}>CALIBRATE</button>
      <button class="nav-item" class:active={appStore.activeTab === 'settings'} aria-current={appStore.activeTab === 'settings' ? 'page' : undefined} onclick={() => navigate('settings')}>SETTINGS</button>
    </nav>
    <div class="status-indicator" class:error={!!startupError} role="status">{startupError ? 'Configuration Error' : ready ? 'Ready' : 'Initializing'}</div>
  </header>
  <div class="workspace">
    <aside class="icon-sidebar" aria-label="功能导航">
      <button title="功能导航" aria-label="功能导航" class:active={functionMenu} aria-expanded={functionMenu} onclick={() => functionMenu = !functionMenu}>{@render icon('info')}</button>
      <button title="Machine Configuration" aria-label="Machine Configuration" onclick={() => openSettings('machines')}>{@render icon('user')}</button>
      <button title="Data Collection" aria-label="Data Collection" onclick={() => openSettings('collect')}>{@render icon('share')}</button>
      <button title="选择模型" aria-label="选择模型" onclick={() => openSettings('collect')}>{@render icon('cube')}</button>
      <button title="Strip / Align view" aria-label="Strip / Align view" aria-pressed={appStore.stageMode === 'pattern'} onclick={() => centerImage?.runTool(appStore.stageMode === 'pattern' ? 'median' : 'pattern')}>{@render icon('sheets')}</button>
      <button title="Calibration" aria-label="Calibration" onclick={() => navigate('calibrate')}>{@render icon('flow')}</button>
      <button title="功能待对接" aria-label="功能待对接" disabled>{@render icon('flag')}</button>
      <button title="绘制 ROI" aria-label="绘制 ROI" disabled={!toolState.hasImage || appStore.activeTab !== 'teach'} class:active={toolState.drawMode} aria-pressed={toolState.drawMode} onclick={() => centerImage?.runTool('roi')}>{@render icon('region')}</button>
      <button title="Teaching Parameters" aria-label="Teaching Parameters" onclick={() => openSettings('parameters')}>{@render icon('stack')}</button>
      <button title="保存入口在 Teaching Parameters" aria-label="保存入口在 Teaching Parameters" onclick={() => openSettings('parameters')}>{@render icon('save')}</button>
      <button title="Model / Data Collection" aria-label="Model / Data Collection" onclick={() => openSettings('collect')}>{@render icon('search')}</button>
      <button title="Settings · Image / Alignment" aria-label="Settings · Image / Alignment" onclick={() => openSettings('image')}>{@render icon('tools')}</button>
      <div class="rail-spacer"></div><button title="全屏" aria-label="全屏" onclick={toggleFullscreen}>{@render icon('fit')}</button>
    </aside>
    <main class="center-area">
      <div class="info-bar" inert={appStore.activeTab !== 'teach'}>
        <button class="info-item model-info" title="选择模型" onclick={() => openSettings('collect')}><span class="info-label">MODEL :</span><span class="info-value">{target?.modelName || '—'}</span></button>
        <div class="info-item lot-info"><span class="info-label">LOT :</span><span class="info-value">—</span></div>
        <div class="info-item strip-info"><span class="info-label">STRIP :</span><span class="info-value">{target ? '1' : '—'}</span></div>
        <div class="toolbar" aria-label="Image tools">
          <button title="适应画布" aria-label="适应画布" disabled={!toolState.hasImage} onclick={() => centerImage?.runTool('fit')}>{@render icon('fit')}</button>
          <button title="绘制 ROI" aria-label="工具栏绘制 ROI" disabled={!toolState.hasImage} class:active={toolState.drawMode} aria-pressed={toolState.drawMode} onclick={() => centerImage?.runTool('roi')}>{@render icon('ruler')}</button>
          <button title="GV 区域测量" aria-label="GV 区域测量" disabled={!toolState.canMeasure} class:active={toolState.measureMode} aria-pressed={toolState.measureMode} onclick={() => centerImage?.runTool('gv')}>GV</button>
          <button title="导航网格" aria-label="导航网格" class:active={toolState.grid} aria-pressed={toolState.grid} onclick={() => centerImage?.runTool('grid')}>{@render icon('grid')}</button>
          <button title="Strip / Align view" aria-label="工具栏 Strip / Align view" class:active={appStore.stageMode === 'pattern'} aria-pressed={appStore.stageMode === 'pattern'} onclick={() => centerImage?.runTool(appStore.stageMode === 'pattern' ? 'median' : 'pattern')}>{@render icon('layers')}</button>
          <button title="缩小" aria-label="缩小" disabled={!toolState.hasImage || toolState.scale === 1} onclick={() => centerImage?.runTool('zoom-out')}>{@render icon('zoom-out')}</button>
          <button title="放大" aria-label="放大" disabled={!toolState.hasImage || toolState.scale === 10} onclick={() => centerImage?.runTool('zoom-in')}>{@render icon('zoom-in')}</button>
          {#each ['points', 'columns', 'cells'] as item}<button disabled title="功能待对接" aria-label={`${item} · 功能待对接`}>{@render icon(item)}</button>{/each}
          <button title="叠加 Metal" aria-label="叠加 Metal" disabled={!target || appStore.stageMode !== 'median'} class:active={toolState.metalOn} aria-pressed={toolState.metalOn} onclick={() => centerImage?.runTool('metal')}>{@render icon('cube')}</button>
          <span class="tool-separator"></span>
          {#each [1, 2, 3] as item}<button class="light-tool" class:active={light === item} title={`Light-${item} · 界面选择`} aria-label={`工具栏 Light-${item}`} aria-pressed={light === item} onclick={() => light = item}>{@render icon('bulb')}</button>{/each}
          {#each ['Red', 'Green', 'Blue', 'Yellow'] as item}<button class="channel-tool" style={`--channel-color: ${item === 'Red' ? '#c13635' : item === 'Green' ? '#4aaf50' : item === 'Blue' ? '#29a8d7' : '#d4aa24'}`} class:active={channel === item} title={`${item} · 界面选择`} aria-label={`工具栏 ${item}`} aria-pressed={channel === item} onclick={() => channel = item}><span></span></button>{/each}
        </div>
      </div>
      <div class="image-view"><CenterImage bind:this={centerImage} interactive={appStore.activeTab === 'teach'} onToolStateChange={(state) => toolState = state}/></div>
      <div class="status-bar" inert={appStore.activeTab !== 'teach'}>
        <span>CELL : <b>—</b></span><span class="status-spacer"></span><span>STRIP : <b>{target ? toolState.side : '—'}</b></span>
        <span>WH : <b>{readout ? `${readout.width}, ${readout.height}` : '—'}</b></span><span>XY : <b>{readout ? `${readout.x}, ${readout.y}` : '—'}</b></span>
        <span>RGB : <b>{readout ? `${readout.r}, ${readout.g}, ${readout.b}` : '—'}</b></span><span>Avg. GV : <b>{readout ? readout.avgGv.toFixed(1) : '—'}</b></span><span>Std. GV : <b>{readout ? readout.stdGv.toFixed(2) : '—'}</b></span>
      </div>
      <div class="log-panel" aria-label="Application log" inert={appStore.activeTab !== 'teach'}>{#each logs as line}<div>{line}</div>{/each}</div>
    </main>
    <aside class="right-panel">
      <div class="tab-page" style:display={appStore.activeTab === 'teach' ? 'flex' : 'none'}><ParameterConfig /></div>
      <div class="tab-page" style:display={appStore.activeTab === 'review' ? 'flex' : 'none'}><ReviewDefect /></div>
      <div class="tab-page" style:display={appStore.activeTab === 'calibrate' ? 'flex' : 'none'}><CalibrationLight /></div>
      <div class="tab-page" style:display={appStore.activeTab === 'settings' ? 'flex' : 'none'}><SettingsPanel bind:page={settingsPage} /></div>
    </aside>
    {#if functionMenu}<div class="function-menu"><div class="menu-heading">功能导航</div>
      <button onclick={() => navigate('teach')}>TEACH <span>图像与规格</span></button><button onclick={() => navigate('calibrate')}>CALIBRATE <span>光源标定</span></button>
      <button onclick={() => openSettings('collect')}>MODEL <span>模型与数据采集</span></button><button onclick={() => openSettings('image')}>SETTINGS <span>教学与图像参数</span></button>
    </div>{/if}
  </div>
</div>
<style>
  .afvi-shell { display:flex; flex-direction:column; width:100vw; height:100dvh; overflow:hidden; background:var(--machine-shell); }
  .title-bar { height:var(--title-height); flex:none; display:flex; align-items:center; padding:0 12px; background:var(--machine-shell); border-bottom:3px solid var(--machine-line); position:relative; box-sizing:border-box; }
  .brand { flex:1; min-width:0; color:#1597c2; font-size:clamp(15px,1vw,24px); line-height:1.3; white-space:nowrap; }
  .brand small { display:block; color:var(--text-muted); font-size:clamp(9px,.59vw,14px); margin-top:4px; }
  .clock { position:absolute; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; text-align:center; color:var(--text-main); font-size:clamp(9px,.62vw,15px); line-height:1.25; font-weight:600; }
  .operator { margin-right:clamp(25px,5vw,120px); color:var(--text-muted); display:flex; flex-direction:column; align-items:center; font-size:11px; }
  .operator small { font-size:10px; }
  .title-actions { display:flex; gap:16px; padding:0 10px; color:#51b957; }
  .title-actions button { background:none; border:0; color:inherit; cursor:pointer; padding:4px; }
  svg { width:24px; height:24px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; display:block; }
  .top-nav { display:flex; height:var(--nav-height); flex:none; border-bottom:3px solid var(--machine-line); box-sizing:border-box; }
  .nav-links { display:flex; flex:1; min-width:0; }
  .nav-item { flex:1; padding:0; border:0; border-right:3px solid var(--machine-line); background:var(--machine-shell); color:var(--text-main); cursor:pointer; font-size:clamp(14px,1vw,24px); font-weight:400; }
  .nav-item.active { background:var(--machine-blue); color:#fff; }
  .nav-item:disabled { cursor:default; }
  .status-indicator { width:var(--right-width); flex:none; display:flex; align-items:center; justify-content:center; color:#f2f5de; background:var(--machine-ready); font-size:clamp(15px,1.1vw,26px); }
  .status-indicator.error { background:#b93f43; }
  .workspace { position:relative; display:flex; flex:1; min-height:0; overflow:hidden; }
  .icon-sidebar { width:var(--rail-width); box-sizing:border-box; flex:none; background:var(--machine-shell); border-right:3px solid var(--machine-line); display:flex; flex-direction:column; align-items:center; padding:3px 0; }
  .icon-sidebar button { border:0; background:transparent; color:var(--machine-icon); width:100%; height:clamp(32px,2.94vw,71px); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none; padding:0; }
  .icon-sidebar svg { width:clamp(22px,1.75vw,42px); height:clamp(22px,1.75vw,42px); stroke-width:1.6; }
  .icon-sidebar button.active { color:var(--machine-cyan); background:var(--machine-panel); }
  .icon-sidebar button:disabled { cursor:default; opacity:.55; }
  .rail-spacer { flex:1; }
  .center-area { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--machine-panel); }
  .info-bar { height:var(--info-height); box-sizing:border-box; flex:none; display:flex; align-items:center; padding:4px; gap:4px; background:var(--machine-shell); }
  .info-item { border:0; border-left:4px solid var(--machine-ready); padding:1px 6px; background:none; color:var(--machine-ready); display:flex; flex-direction:column; text-align:left; line-height:1.2; min-width:0; }
  .model-info { width:17%; flex:none; cursor:pointer; }
  .lot-info { width:14%; flex:none; }
  .strip-info { flex:1; min-width:38px; }
  .info-label { font-size:clamp(9px,.59vw,14px); font-weight:600; }
  .info-value { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:clamp(12px,.86vw,21px); }
  .toolbar { display:flex; align-items:center; gap:4px; max-width:60%; overflow-x:auto; flex:none; scrollbar-width:none; }
  .toolbar button { width:clamp(24px,1.47vw,35px); height:clamp(24px,1.47vw,35px); box-sizing:border-box; border:2px solid var(--machine-tool-border); border-radius:6px; display:flex; flex:none; align-items:center; justify-content:center; padding:2px; background:transparent; color:var(--machine-icon); font:600 11px 'Segoe UI',sans-serif; cursor:pointer; }
  .toolbar svg { width:100%; height:100%; stroke-width:1.5; }
  .toolbar button.active { color:var(--machine-cyan); border-color:var(--machine-cyan); }
  .toolbar button:disabled { opacity:.65; cursor:default; }
  .toolbar .light-tool.active { color:#efc52b; border-color:#c6a328; }
  .toolbar .channel-tool { border-color:var(--channel-color); }
  .channel-tool span { width:11px; height:11px; border-radius:50%; }
  .channel-tool.active span { background:var(--channel-color); }
  .tool-separator { width:8px; flex:none; }
  .image-view { flex:1; min-height:0; display:flex; overflow:hidden; }
  .status-bar { flex:none; min-height:var(--status-height); box-sizing:border-box; padding:0 8px; display:flex; align-items:center; gap:clamp(7px,1.1vw,25px); background:var(--machine-shell); border-top:2px solid var(--machine-line); color:var(--text-main); font:600 clamp(9px,.59vw,14px) 'Segoe UI',sans-serif; white-space:nowrap; overflow-x:auto; }
  .status-bar b { margin-left:7px; font-weight:400; }
  .status-spacer { flex:1; }
  .log-panel { height:clamp(96px,9.14vw,220px); box-sizing:border-box; flex:none; padding:4px 8px; border-top:3px solid var(--machine-line); background:var(--machine-panel); overflow:auto; color:var(--text-main); font:clamp(10px,.59vw,14px)/1.55 Consolas,'Segoe UI',monospace; white-space:nowrap; }
  .right-panel { width:var(--right-width); box-sizing:border-box; min-width:0; flex:none; border-left:3px solid var(--machine-line); background:var(--machine-shell); display:flex; flex-direction:column; }
  .tab-page { display:flex; flex-direction:column; height:100%; min-height:0; }
  .function-menu { position:absolute; left:var(--rail-width); top:0; width:300px; z-index:40; border:1px solid var(--border-color); background:var(--bg-panel); box-shadow:4px 4px 12px #0005; }
  .menu-heading { font-size:11px; color:var(--text-muted); padding:12px; border-bottom:1px solid var(--border-color); }
  .function-menu button { display:flex; width:100%; gap:20px; padding:14px 12px; border:0; border-bottom:1px solid var(--border-color); background:transparent; color:var(--text-main); text-align:left; cursor:pointer; }
  .function-menu span { color:var(--text-muted); font-size:11px; }
  button:not(:disabled):hover { filter:brightness(1.16); }
  button:focus-visible { outline:2px solid var(--machine-cyan); outline-offset:-3px; }
  @media (max-width:1250px) { .operator { display:none; } .toolbar { gap:2px; } .info-item { padding-left:4px; } .lot-info { width:13%; } }
</style>
