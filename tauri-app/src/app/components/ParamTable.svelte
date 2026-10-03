<script module lang="ts">
  export interface ParamDisplayRow {
    key: string;
    name: string;
    value: string;
    min?: string;
    enabled?: boolean;
    color: string;
    disabled?: boolean;
    invalid?: boolean;
  }

  export interface ParamValueChange {
    row: ParamDisplayRow;
    value: string;
  }
</script>

<script lang="ts">
  let {
    title = '',
    rows = [],
    showMin = false,
    emptyText = '',
    disabled = false,
    onvaluechange,
    oninvalidchange,
  }: {
    title?: string;
    rows?: ParamDisplayRow[];
    showMin?: boolean;
    emptyText?: string;
    disabled?: boolean;
    onvaluechange?: (change: ParamValueChange) => void;
    oninvalidchange?: (change: { row: ParamDisplayRow; invalid: boolean }) => void;
  } = $props();

  function edit(row: ParamDisplayRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    row.invalid = !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
      || !Number.isFinite(Number(value));
    oninvalidchange?.({ row, invalid: row.invalid });
    // Keep incomplete input visible; never substitute zero for invalid/missing data.
    if (!row.invalid) onvaluechange?.({ row, value });
  }

  function format(row: ParamDisplayRow, event: Event): void {
    if (!row.invalid) (event.target as HTMLInputElement).value = decimal(row.value);
  }

  function commit(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  function restore(row: ParamDisplayRow, event: Event): void {
    row.invalid = false;
    (event.target as HTMLInputElement).value = decimal(row.value);
    oninvalidchange?.({ row, invalid: false });
  }

  function decimal(value: string): string {
    return value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value).toFixed(3) : value;
  }
</script>

<div class="host">
  <section class="param-table" tabindex="0" role="region" aria-label="{title} parameters">
  <table aria-label={title}>
    <colgroup><col class="number-column"><col><col class="value-column">{#if showMin}<col class="min-column">{/if}</colgroup>
    <thead><tr><th scope="col">No.</th><th scope="col">{title}</th><th scope="col">Value</th>{#if showMin}<th scope="col">Min</th>{/if}</tr></thead>
    <tbody>
      {#each rows as row, index (index)}
        <tr>
          <td>{index + 1}</td>
          <td class="parameter-name" style="color: {row.color}" title={row.name}>{row.name}</td>
          <td class="value">
            {#if row.enabled === undefined}
              <input
                type="text"
                inputmode="decimal"
                autocomplete="off"
                spellcheck="false"
                value={row.value}
                placeholder="—"
                disabled={disabled || row.disabled}
                aria-label="{row.name} value"
                aria-invalid={row.invalid || undefined}
                title={row.invalid ? 'Enter a finite decimal number. Escape restores the current value.' : row.name}
                oninput={(event) => edit(row, event)}
                onblur={(event) => format(row, event)}
                onkeydown={(event) => {
                  if (event.key === 'Enter') commit(event);
                  if (event.key === 'Escape') restore(row, event);
                }}
              />
            {:else}
              <button
                type="button"
                class="switch"
                role="switch"
                class:on={row.enabled}
                aria-checked={row.enabled}
                aria-label={row.name}
                title="{row.name}{row.enabled ? ': ON' : ': OFF'}"
                disabled={disabled || row.disabled}
                onclick={() => onvaluechange?.({ row, value: row.enabled ? '0.000' : '1.000' })}
              ></button>
            {/if}
          </td>
          {#if showMin}<td class="min">{row.min}</td>{/if}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if !rows.length}
    <p>{emptyText || 'No parameters for this node.'}</p>
  {/if}
  </section>
</div>

<style>
  .host { display: block; height: 100%; min-height: 0; min-width: 0; overflow: hidden; }
  * { box-sizing: border-box; }
  .param-table { height: 100%; overflow: auto; overscroll-behavior: contain; background: #303030; }
  table { border-collapse: separate; border-spacing: 0; color: #ddd; font-size: 11px; table-layout: fixed; width: 100%; }
  .number-column { width: 27px; } .value-column { width: 69px; } .min-column { width: 56px; }
  tr, th, td { height: 20px; max-height: 20px; }
  th, td { border-right: 1px solid #484848; border-bottom: 1px solid #484848; padding: 0 4px; line-height: 19px; }
  th { position: sticky; top: 0; z-index: 1; background: #3c3c3c; color: #eee; font-weight: 400; }
  th:first-child, td:first-child { text-align: center; color: #c0c0c0; }
  th:nth-child(n+3) { text-align: right; }
  .parameter-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.value { padding: 0 2px; text-align: right; }
  td.min { color: #bbb; font-variant-numeric: tabular-nums; }
  input[type="text"] { display: block; width: 100%; height: 19px; margin: 0; padding: 0 3px; border: 1px solid transparent;
    border-radius: 0; background: #282828; color: #eee; font: 11px/17px 'Segoe UI', sans-serif; text-align: right; font-variant-numeric: tabular-nums; }
  input:hover:not(:disabled) { border-color: #777; }
  input[aria-invalid="true"] { border-color: #ff9494; background: #512f2f; }
  input:disabled { color: #aaa; background: #333; }
  p { color: #bdbdbd; font-size: 11px; line-height: 1.4; margin: 10px 6px; text-align: center; }
  .switch { vertical-align: middle; background: #7a7a7a; border: 1px solid #9a9a9a; border-radius: 8px;
    display: inline-block; height: 15px; padding: 0; position: relative; width: 32px; cursor: pointer; }
  .switch::after { background: #fff; border-radius: 50%; box-shadow: 0 0 1px #000a; content: ''; height: 11px;
    left: 1px; position: absolute; top: 1px; width: 11px; }
  .switch.on { background: #0079b5; border-color: #0079b5; } .switch.on::after { left: 18px; }
  .switch:disabled { cursor: default; opacity: 0.55; }
  .switch:hover:not(:disabled) { border-color: #fff; }
  button:focus-visible, input[type="text"]:focus-visible, .param-table:focus-visible { outline: 2px solid #8edcff; outline-offset: -2px; }
</style>
