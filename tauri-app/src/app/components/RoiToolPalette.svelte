<script lang="ts">
  /**
   * Reusable ROI tool rail. Renders the full button set every time and enables
   * only the entries the host switches on, so the same component backs TEACH,
   * GV measurement and future tools - the difference is purely the `enabled`
   * map. Layout matches the machine's shape editor: a pointer at the top, an
   * "add selection" half, a "delete selection" half, and the delete-ROI action
   * pinned at the bottom.
   */
  import {
    ROI_PALETTE_ADD,
    ROI_PALETTE_DELETE,
    ROI_PALETTE_LABELS,
    type RoiPaletteTool,
  } from '../../lib/roi-tools';

  let {
    enabled = {},
    active = null,
    onselect,
    onclear,
    ariaLabel = 'ROI 工具',
  }: {
    /** Which buttons are clickable. Omitted/empty = everything disabled. */
    enabled?: Partial<Record<RoiPaletteTool, boolean>>;
    /** Currently highlighted button. */
    active?: RoiPaletteTool | null;
    onselect?: (tool: RoiPaletteTool) => void;
    /** Right-click on the delete-ROI button: clear every box at once. */
    onclear?: () => void;
    ariaLabel?: string;
  } = $props();

  const isEnabled = (tool: RoiPaletteTool): boolean => enabled[tool] === true;
  const title = (tool: RoiPaletteTool): string => ROI_PALETTE_LABELS[tool];
</script>

{#snippet glyph(tool: RoiPaletteTool)}
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if tool === 'pointer'}
      <path d="M5 3.2 17.6 11l-5.2.9 3 5.5-2.4 1.2-2.9-5.6-3.9 3.1z" />
      <path d="M17.5 3.5v3M16 5h3M18.8 8.4l-.9.9M18.8 2.1l-.9-.9" />
    {:else if tool === 'add-rect'}
      <rect x="4" y="5.5" width="16" height="13" rx="2" />
    {:else if tool === 'add-ellipse'}
      <circle cx="12" cy="12" r="6.6" />
    {:else if tool === 'add-polygon'}
      <path d="M12 4l7.2 3.6-1.8 9.4-9.8 2L4.2 11z" />
    {:else if tool === 'delete-rect'}
      <rect x="4" y="5.5" width="16" height="13" rx="2" stroke-dasharray="3.2 2.6" />
    {:else if tool === 'delete-ellipse'}
      <circle cx="12" cy="12" r="6.6" stroke-dasharray="3.2 2.6" />
    {:else if tool === 'delete-polygon'}
      <path d="M12 4l7.2 3.6-1.8 9.4-9.8 2L4.2 11z" stroke-dasharray="3.2 2.6" />
    {:else if tool === 'delete-roi'}
      <path d="M5 7h14M9.5 7V4.4h5V7M6.6 7l1 12.6h8.8L17.4 7M10.2 10.2v6.6M13.8 10.2v6.6" />
    {/if}
  </svg>
{/snippet}

{#snippet railButton(tool: RoiPaletteTool)}
  <button
    type="button"
    class:active={active === tool}
    disabled={!isEnabled(tool)}
    title={title(tool)}
    aria-label={title(tool)}
    aria-pressed={active === tool}
    onclick={() => onselect?.(tool)}
    oncontextmenu={(event) => {
      // the delete-ROI button additionally offers clear-all on right-click;
      // every other button just swallows the WebView2 menu
      event.preventDefault();
      if (tool === 'delete-roi' && onclear) onclear();
    }}
  >
    {@render glyph(tool)}
  </button>
{/snippet}

<div
  class="roi-tool-rail"
  role="group"
  aria-label={ariaLabel}
  oncontextmenu={(event) => event.preventDefault()}
>
  {@render railButton('pointer')}
  <span class="rail-divider" role="separator"></span>
  <div class="rail-group" role="group" aria-label="添加选区">
    {#each ROI_PALETTE_ADD as tool (tool)}{@render railButton(tool)}{/each}
  </div>
  <span class="rail-divider" role="separator"></span>
  <div class="rail-group" role="group" aria-label="删除选取">
    {#each ROI_PALETTE_DELETE as tool (tool)}{@render railButton(tool)}{/each}
  </div>
  <span class="rail-spacer"></span>
  <span class="rail-divider" role="separator"></span>
  {@render railButton('delete-roi')}
</div>

<style>
  .roi-tool-rail {
    width: 46px;
    flex: none;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 7px 4px;
    overflow-y: auto;
    scrollbar-width: none;
    background: var(--bg-dark, var(--machine-shell));
    border-left: 1px solid var(--border-strong);
  }
  .rail-group { display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .rail-divider { width: 24px; height: 1px; flex: none; background: var(--border-color); }
  .rail-spacer { flex: 1; min-height: 12px; }
  .roi-tool-rail button {
    width: 34px;
    height: 34px;
    box-sizing: border-box;
    padding: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--text-main);
    cursor: pointer;
  }
  .roi-tool-rail button svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    display: block;
  }
  .roi-tool-rail button:disabled { opacity: 0.35; cursor: default; }
  .roi-tool-rail button:not(:disabled):hover { border-color: var(--accent-blue-bright); }
  .roi-tool-rail button.active {
    color: #fff;
    border-color: var(--accent-blue-bright);
    background: color-mix(in srgb, var(--accent-blue-bright) 28%, transparent);
  }
  .roi-tool-rail button:focus-visible { outline: 2px solid var(--accent-blue-bright); outline-offset: -3px; }
</style>
