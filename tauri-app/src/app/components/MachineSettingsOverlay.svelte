<script lang="ts">
  import { tick } from 'svelte';

  // The wrench rail button opens THIS panel: a slide-over that glides in from
  // the right edge and overlays the workspace (it never reflows the layout).
  //
  // It is deliberately a different thing from the top-nav SETTINGS page
  // (SettingsPanel.svelte), which keeps our own configuration areas. This panel
  // is ONLY the real AFVI machine's Settings pane, reproduced item for item:
  // Language / Export / Backup / 3DResult / Strip saving / Data Format /
  // Miscellaneous. The values are user-editable and persist locally, but have
  // no backend effect - they exist so nothing from the machine is missing.
  //
  // Our own settings sections are intentionally NOT reachable from here (see
  // Plan/SETTINGS_HIDDEN_ENTRIES.md for the stashed list and their names).
  let { open = $bindable(false) }: { open?: boolean } = $props();

  type MachineSettings = {
    language: { code: string };
    export: { ip: string; directory: string };
    backup: { ip: string; directory: string };
    result3d: { enable: boolean; ip: string; directory: string };
    strip: { enable: boolean; scale: number; light: string; colorChannel: string };
    format: { tavis: boolean; json: boolean; tw: boolean };
    misc: {
      maxLogCount: number;
      maxDefectCount: number;
      defectImageSize: number;
      alignSearchOffset: number;
      alignMinimumScore: number;
      subPixelSize: number;
      subPixelInterval: number;
      alignMethod: string;
      alignModelScale: number;
      unitAlign: number;
      autofocusLight: number;
      defectImageFormat: string;
      keepFolderCount: number;
      cameraUserset: number;
    };
  };

  const STORE_KEY = 'afvi-machine-settings';

  function defaults(): MachineSettings {
    return {
      language: { code: 'English' },
      export: { ip: '192.168.1.203', directory: 'Pixel\\ResultData\\Data' },
      backup: { ip: '192.168.200.10', directory: 'PxData\\StripImage' },
      result3d: { enable: false, ip: '192.168.1.9', directory: '3d xml' },
      strip: { enable: false, scale: 5, light: 'Light1', colorChannel: 'Color' },
      format: { tavis: false, json: false, tw: false },
      misc: {
        maxLogCount: 50,
        maxDefectCount: 50000,
        defectImageSize: 400,
        alignSearchOffset: 200,
        alignMinimumScore: 50,
        subPixelSize: 7,
        subPixelInterval: 0.2,
        alignMethod: 'FFTW',
        alignModelScale: 1.0,
        unitAlign: 0,
        autofocusLight: 1,
        defectImageFormat: 'BMP',
        keepFolderCount: 11,
        cameraUserset: 2,
      },
    };
  }

  function loadSettings(): MachineSettings {
    const base = defaults();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw) as Partial<MachineSettings>;
      return {
        ...base,
        ...saved,
        language: { ...base.language, ...saved.language },
        export: { ...base.export, ...saved.export },
        backup: { ...base.backup, ...saved.backup },
        result3d: { ...base.result3d, ...saved.result3d },
        strip: { ...base.strip, ...saved.strip },
        format: { ...base.format, ...saved.format },
        misc: { ...base.misc, ...saved.misc },
      };
    } catch {
      return base;
    }
  }

  // Read storage synchronously at init so the persist effect below can never
  // race ahead of the restore and overwrite the saved values with defaults.
  let ms = $state<MachineSettings>(loadSettings());
  $effect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(ms));
    } catch {
      /* persistence is best-effort */
    }
  });

  type SectionId = 'language' | 'export' | 'backup' | 'result3d' | 'strip' | 'format' | 'misc';
  let openMap = $state<Record<SectionId, boolean>>({
    language: true, export: true, backup: true, result3d: true, strip: true, format: true, misc: true,
  });
  function toggle(id: SectionId): void {
    openMap[id] = !openMap[id];
  }

  let query = $state('');
  let alphabetical = $state(false);
  const searching = $derived(query.trim().length > 0);
  // Every section's searchable terms, in one place: the per-section `hit()`
  // gates use it, and `nothingVisible` uses it to decide the empty message.
  const SECTION_TERMS: string[][] = [
    ['Language', 'Code'],
    ['Export', 'IP Adress', 'Directory'],
    ['Backup', 'IP Adress', 'Directory'],
    ['3DResult', '3D', 'IP Adress', 'Directory'],
    ['Strip saving', 'Enable', 'Scale', 'Light', 'Color Channel'],
    ['Data Format', 'Tavis', 'Json', 'TW'],
    ['Miscellaneous', 'Max Log Count', 'Max Defect Count', 'Defect Image Size', 'Align', 'SubPixel', 'Unit Align', 'Autofocus', 'Defect Image Format', 'Keep Folder', 'Camera Userset'],
  ];
  const nothingVisible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return !SECTION_TERMS.some((terms) => terms.some((term) => term.toLowerCase().includes(q)));
  });
  function hit(...terms: string[]): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return terms.some((term) => term.toLowerCase().includes(q));
  }

  const LANGUAGES = ['English', 'Korean', 'Chinese', 'Japanese'];
  const LIGHTS = ['Light1', 'Light2', 'Light3'];
  const COLOR_CHANNELS = ['Color', 'Gray', 'Red', 'Green', 'Blue'];
  const ALIGN_METHODS = ['FFTW', 'OpenCV', 'Direct', 'Phase'];
  const IMAGE_FORMATS = ['BMP', 'JPG', 'PNG', 'TIFF'];

  let sheet = $state<HTMLDivElement>();
  let returnFocus: HTMLElement | null = null;
  $effect(() => {
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void tick().then(() => { if (open) sheet?.focus({ preventScroll: true }); });
    } else if (returnFocus) {
      returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
    } else if (event.key === 'Tab' && sheet) {
      const controls = Array.from(sheet.querySelectorAll<HTMLElement>('button, input, select'))
        .filter((control) => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet)) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
</script>

{#snippet txt(label: string, value: string, set: (v: string) => void)}
  <div class="row">
    <span class="lbl">{label}</span>
    <input class="val" type="text" {value} aria-label={label} spellcheck="false" autocomplete="off" oninput={(event) => set(event.currentTarget.value)} />
  </div>
{/snippet}

{#snippet num(label: string, value: number, set: (v: number) => void, step = 'any', decimals = 0)}
  <div class="row">
    <span class="lbl">{label}</span>
    <input class="val" type="number" value={Number.isFinite(value) ? (decimals ? value.toFixed(decimals) : value) : ''} {step} aria-label={label}
      oninput={(event) => {
        const input = event.currentTarget;
        if (input.value !== '' && input.validity.valid && Number.isFinite(input.valueAsNumber)) set(input.valueAsNumber);
      }} />
  </div>
{/snippet}

{#snippet sw(label: string, value: boolean, set: (v: boolean) => void)}
  <div class="row">
    <span class="lbl">{label}</span>
    <span class="ctl">
      <button class="switch" class:on={value} role="switch" aria-checked={value} aria-label={label} onclick={() => set(!value)}><i></i></button>
      <span class="sw-text">{value ? 'On' : 'Off'}</span>
    </span>
  </div>
{/snippet}

{#snippet sel(label: string, value: string, options: string[], set: (v: string) => void)}
  <div class="row">
    <span class="lbl">{label}</span>
    <select class="val" {value} aria-label={label} onchange={(event) => set(event.currentTarget.value)}>
      {#each options as option}<option value={option}>{option}</option>{/each}
    </select>
  </div>
{/snippet}

<svelte:window onkeydown={handleKeydown} />

<div class="overlay-root" class:open inert={!open}>
  <button class="scrim" tabindex="-1" aria-label="Close settings" onclick={() => (open = false)}></button>

  <div class="sheet" bind:this={sheet} tabindex="-1" role="dialog" aria-modal="true" aria-label="Settings" aria-hidden={!open}>
    <header class="sheet-toolbar">
      <button class="view-tool" class:selected={!alphabetical} title="Categorized settings" aria-label="Categorized settings" aria-pressed={!alphabetical} onclick={() => (alphabetical = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v6H3zM3 15h6v6H3zM4.5 6h3M6 4.5v3M4.5 18h3M6 16.5v3M12 3h9M12 6h9M12 9h6M12 15h9M12 18h9M12 21h6" /></svg>
      </button>
      <button class="view-tool sort-tool" class:selected={alphabetical} title="Sort groups alphabetically" aria-label="Sort groups alphabetically" aria-pressed={alphabetical} onclick={() => (alphabetical = true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><text x="2" y="10">A</text><text x="2" y="22">Z</text><path d="M18 3v17m-3-3 3 3 3-3" /></svg>
      </button>
      <div class="search-wrap">
        <input class="search" type="search" aria-label="Search settings" placeholder="Search" bind:value={query} spellcheck="false" autocomplete="off" />
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="14" cy="9" r="7" /><path d="m9 14-7 8" /></svg>
      </div>
    </header>

    <div class="sheet-body">
      {#if hit('Language', 'Code')}
        <section class="sec" aria-label="Language" class:open={openMap.language || searching} style:order={alphabetical ? 4 : 0}>
          <button class="sec-head" aria-expanded={openMap.language || searching} onclick={() => toggle('language')}>
            <span class="chev" aria-hidden="true"></span><span>Language</span>
          </button>
          <div class="sec-body" hidden={!openMap.language && !searching}>
            {@render sel('Code', ms.language.code, LANGUAGES, (v) => (ms.language.code = v))}
          </div>
        </section>
      {/if}

      {#if hit('Export', 'IP Adress', 'Directory')}
        <section class="sec" aria-label="Export" class:open={openMap.export || searching} style:order={alphabetical ? 3 : 0}>
          <button class="sec-head" aria-expanded={openMap.export || searching} onclick={() => toggle('export')}>
            <span class="chev" aria-hidden="true"></span><span>Export</span>
          </button>
          <div class="sec-body" hidden={!openMap.export && !searching}>
            {@render txt('IP Adress', ms.export.ip, (v) => (ms.export.ip = v))}
            {@render txt('Directory', ms.export.directory, (v) => (ms.export.directory = v))}
          </div>
        </section>
      {/if}

      {#if hit('Backup', 'IP Adress', 'Directory')}
        <section class="sec" aria-label="Backup" class:open={openMap.backup || searching} style:order={alphabetical ? 1 : 0}>
          <button class="sec-head" aria-expanded={openMap.backup || searching} onclick={() => toggle('backup')}>
            <span class="chev" aria-hidden="true"></span><span>Backup</span>
          </button>
          <div class="sec-body" hidden={!openMap.backup && !searching}>
            {@render txt('IP Adress', ms.backup.ip, (v) => (ms.backup.ip = v))}
            {@render txt('Directory', ms.backup.directory, (v) => (ms.backup.directory = v))}
          </div>
        </section>
      {/if}

      {#if hit('3DResult', '3D', 'IP Adress', 'Directory')}
        <section class="sec" aria-label="3DResult" class:open={openMap.result3d || searching}>
          <button class="sec-head" aria-expanded={openMap.result3d || searching} onclick={() => toggle('result3d')}>
            <span class="chev" aria-hidden="true"></span><span>3DResult</span>
          </button>
          <div class="sec-body" hidden={!openMap.result3d && !searching}>
            {@render sw('3D Enable', ms.result3d.enable, (v) => (ms.result3d.enable = v))}
            {@render txt('IP Adress', ms.result3d.ip, (v) => (ms.result3d.ip = v))}
            {@render txt('Directory', ms.result3d.directory, (v) => (ms.result3d.directory = v))}
          </div>
        </section>
      {/if}

      {#if hit('Strip saving', 'Enable', 'Scale', 'Light', 'Color Channel')}
        <section class="sec" aria-label="Strip saving" class:open={openMap.strip || searching} style:order={alphabetical ? 6 : 0}>
          <button class="sec-head" aria-expanded={openMap.strip || searching} onclick={() => toggle('strip')}>
            <span class="chev" aria-hidden="true"></span><span>Strip saving</span>
          </button>
          <div class="sec-body" hidden={!openMap.strip && !searching}>
            {@render sw('Enable', ms.strip.enable, (v) => (ms.strip.enable = v))}
            {@render num('Scale', ms.strip.scale, (v) => (ms.strip.scale = v), '1')}
            {@render sel('Light', ms.strip.light, LIGHTS, (v) => (ms.strip.light = v))}
            {@render sel('Color Channel', ms.strip.colorChannel, COLOR_CHANNELS, (v) => (ms.strip.colorChannel = v))}
          </div>
        </section>
      {/if}

      {#if hit('Data Format', 'Tavis', 'Json', 'TW')}
        <section class="sec" aria-label="Data Format" class:open={openMap.format || searching} style:order={alphabetical ? 2 : 0}>
          <button class="sec-head" aria-expanded={openMap.format || searching} onclick={() => toggle('format')}>
            <span class="chev" aria-hidden="true"></span><span>Data Format</span>
          </button>
          <div class="sec-body" hidden={!openMap.format && !searching}>
            {@render sw('Tavis Format', ms.format.tavis, (v) => (ms.format.tavis = v))}
            {@render sw('Json Format', ms.format.json, (v) => (ms.format.json = v))}
            {@render sw('TW Format', ms.format.tw, (v) => (ms.format.tw = v))}
          </div>
        </section>
      {/if}

      {#if hit('Miscellaneous', 'Max Log Count', 'Max Defect Count', 'Defect Image Size', 'Align', 'SubPixel', 'Unit Align', 'Autofocus', 'Defect Image Format', 'Keep Folder', 'Camera Userset')}
        <section class="sec" aria-label="Miscellaneous" class:open={openMap.misc || searching} style:order={alphabetical ? 5 : 0}>
          <button class="sec-head" aria-expanded={openMap.misc || searching} onclick={() => toggle('misc')}>
            <span class="chev" aria-hidden="true"></span><span>Miscellaneous</span>
          </button>
          <div class="sec-body" hidden={!openMap.misc && !searching}>
            {@render num('Max Log Count (Auto Save)', ms.misc.maxLogCount, (v) => (ms.misc.maxLogCount = v), '1')}
            {@render num('Max Defect Count', ms.misc.maxDefectCount, (v) => (ms.misc.maxDefectCount = v), '1')}
            {@render num('Defect Image Size', ms.misc.defectImageSize, (v) => (ms.misc.defectImageSize = v), '1')}
            {@render num('Align Search Offset', ms.misc.alignSearchOffset, (v) => (ms.misc.alignSearchOffset = v), '1')}
            {@render num('Align Minimum Score', ms.misc.alignMinimumScore, (v) => (ms.misc.alignMinimumScore = v), '1')}
            {@render num('SubPixelSize', ms.misc.subPixelSize, (v) => (ms.misc.subPixelSize = v), '1')}
            {@render num('SubPixelInterval', ms.misc.subPixelInterval, (v) => (ms.misc.subPixelInterval = v), '0.1')}
            {@render sel('Align Method', ms.misc.alignMethod, ALIGN_METHODS, (v) => (ms.misc.alignMethod = v))}
            {@render num('Align Model Scale', ms.misc.alignModelScale, (v) => (ms.misc.alignModelScale = v), '0.1', 1)}
            {@render num('Unit Align', ms.misc.unitAlign, (v) => (ms.misc.unitAlign = v), '1')}
            {@render num('Autofocus Light', ms.misc.autofocusLight, (v) => (ms.misc.autofocusLight = v), '1')}
            {@render sel('Defect Image Format', ms.misc.defectImageFormat, IMAGE_FORMATS, (v) => (ms.misc.defectImageFormat = v))}
            {@render num('Keep Folder Count', ms.misc.keepFolderCount, (v) => (ms.misc.keepFolderCount = v), '1')}
            {@render num('Camera Userset', ms.misc.cameraUserset, (v) => (ms.misc.cameraUserset = v), '1')}
          </div>
        </section>
      {/if}

      {#if nothingVisible}
        <p class="no-hit">No setting matches "{query}".</p>
      {/if}
    </div>
    <footer class="sheet-foot" aria-hidden="true"></footer>
  </div>
</div>

<style>
  /* The reference property grid is 502px wide at 2490px, with 24px rows. */
  .overlay-root {
    position: fixed;
    inset: 0;
    z-index: 60;
    pointer-events: none;
    visibility: hidden;
    transition: visibility 0s linear .3s;
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
    background: rgba(0, 0, 0, .28);
    opacity: 0;
    transition: opacity .3s ease;
  }
  .overlay-root.open .scrim { opacity: 1; }

  .sheet {
    --sheet-w: min(92vw, clamp(350px, 20.16vw, 502px));
    --sheet-font: clamp(12px, .56225vw, 14px);
    --row-h: clamp(20px, .96386vw, 24px);
    --field-indent: calc(var(--sheet-font) * 1.857143);
    --pane-bg: #303030;
    --pane-text: #ccc;
    --pane-line: #535353;
    --pane-toggle: #929292;
    --pane-dot: #656565;
    position: absolute;
    top: 0;
    right: calc(-1 * var(--sheet-w));
    width: var(--sheet-w);
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: var(--pane-bg);
    border-left: 1px solid #454545;
    box-shadow: -3px 0 5px rgba(0, 0, 0, .2);
    color: var(--pane-text);
    font: var(--sheet-font)/1 'Segoe UI', sans-serif;
    outline: none;
    transition: right .3s cubic-bezier(.22, .61, .36, 1);
  }
  .overlay-root.open .sheet { right: 0; }

  .sheet-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    height: clamp(30px, 1.44578vw, 36px);
    padding: 0 0 0 calc(var(--sheet-font) * .571429);
    box-sizing: border-box;
  }
  .view-tool {
    flex: none;
    width: calc(var(--sheet-font) * 2);
    height: calc(var(--sheet-font) * 2);
    box-sizing: border-box;
    padding: 3px;
    border: 1px solid transparent;
    background: transparent;
    color: #818181;
    cursor: pointer;
  }
  .view-tool.selected { border-color: #454545; background: #272727; }
  .view-tool:hover { color: var(--pane-text); }
  .view-tool svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.4; }
  .sort-tool text { font: 600 12px 'Segoe UI', sans-serif; fill: #587cba; stroke: none; }
  .search-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    height: calc(var(--sheet-font) * 1.857143);
    margin-left: calc(var(--sheet-font) * .428571);
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    height: 100%;
    background: transparent;
    border: 2px solid #454545;
    color: var(--pane-text);
    font: inherit;
    padding: 0 calc(var(--sheet-font) * 2) 0 5px;
    text-align: left;
  }
  .search::placeholder { color: #909090; opacity: 1; }
  .search::-webkit-search-cancel-button { display: none; }
  .search:focus { outline: none; border-color: var(--machine-cyan); }
  .search-icon {
    position: absolute;
    right: 3px;
    top: 2px;
    width: calc(var(--sheet-font) * 1.571429);
    height: calc(var(--sheet-font) * 1.571429);
    fill: none;
    stroke: #527693;
    stroke-width: 1.8;
    pointer-events: none;
  }

  .sheet-body { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; padding-top: 8px; }

  .sec { flex: none; }
  .sec-head {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--row-h);
    box-sizing: border-box;
    border: 0;
    background: transparent;
    color: var(--pane-text);
    cursor: pointer;
    padding: 0 0 0 var(--field-indent);
    font: 600 var(--sheet-font)/1 'Segoe UI', sans-serif;
    text-align: left;
  }
  .sec-head:hover { background: #ffffff06; }
  .chev {
    position: absolute;
    left: calc(var(--sheet-font) * .642857);
    width: 0;
    height: 0;
    border-top: 3px solid transparent;
    border-bottom: 3px solid transparent;
    border-left: 5px solid #6d6d6d;
  }
  .sec.open .chev {
    width: 7px;
    height: 7px;
    border: 0;
    background: #6d6d6d;
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }
  .sec-body[hidden] { display: none; }

  .row {
    display: grid;
    grid-template-columns: 51.2% minmax(0, 1fr);
    align-items: center;
    height: var(--row-h);
    box-sizing: border-box;
  }
  .lbl {
    padding-left: var(--field-indent);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctl { display: flex; align-items: center; gap: 6px; padding-left: 3px; }
  .val {
    appearance: none;
    min-width: 0;
    width: calc(100% - 8px);
    height: var(--row-h);
    box-sizing: border-box;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0;
    color: var(--pane-text);
    font: inherit;
    text-align: left;
    padding: 0 2px;
  }
  select.val { text-align-last: left; cursor: pointer; }
  select.val option { background: var(--pane-bg); color: var(--pane-text); }
  input.val[type=number] { appearance: textfield; -moz-appearance: textfield; }
  input.val::-webkit-inner-spin-button, input.val::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .val:hover { border-color: var(--pane-line); }
  .val:focus { border-color: var(--machine-cyan); background: var(--pane-bg); outline: none; }

  .switch {
    position: relative;
    flex: none;
    width: calc(var(--sheet-font) * 2.571429);
    height: var(--sheet-font);
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: var(--pane-toggle);
    box-shadow: 0 0 2px #b0b0b080;
    cursor: pointer;
  }
  .switch i {
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(var(--sheet-font) - 4px);
    height: calc(var(--sheet-font) - 4px);
    border-radius: 50%;
    background: var(--pane-dot);
    transition: transform .15s ease;
  }
  .switch.on { background: var(--toggle-bg-on); }
  .switch.on i { transform: translateX(calc(var(--sheet-font) * 1.571429)); background: #ddd; }
  .sw-text { min-width: 22px; }

  .sheet-foot { flex: none; height: clamp(42px, 2.57028vw, 64px); border-top: 1px solid var(--pane-line); }
  .sheet button:focus-visible { outline: 1px solid var(--machine-cyan); outline-offset: -1px; }
  .no-hit { color: var(--pane-text); padding: 20px 14px; text-align: center; }

  :global(body[data-theme="light"]) .sheet {
    --pane-bg: var(--machine-shell);
    --pane-text: var(--text-main);
    --pane-line: var(--machine-tool-border);
    --pane-toggle: #a7afb5;
    --pane-dot: #f3f4f6;
  }
  :global(body[data-theme="light"]) .view-tool.selected { background: #ffffff80; border-color: var(--pane-line); }
  @media (prefers-reduced-motion: reduce) {
    .overlay-root, .scrim, .sheet, .switch i { transition: none; }
  }
</style>
