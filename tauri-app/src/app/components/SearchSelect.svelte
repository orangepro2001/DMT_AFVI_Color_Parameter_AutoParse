<script lang="ts">
  /**
   * Searchable replacement for a <select> with many options: type to filter,
   * click a row to pick. The value only changes on an explicit pick; leaving
   * without picking reverts the text to the current value.
   */
  let {
    options = [],
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    onpick,
  }: {
    options?: string[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onpick?: (option: string) => void;
  } = $props();

  let query = $state(value);
  let open = $state(false);

  const matches = $derived.by(() => {
    const needle = query.trim().toUpperCase();
    const pool = needle ? options.filter((option) => option.toUpperCase().includes(needle)) : options;
    return pool.slice(0, 200);
  });

  // keep the box showing the current value when the parent resets it (e.g. after a rescan)
  $effect(() => {
    if (!open) query = value;
  });

  function pick(option: string) {
    value = option;
    query = option;
    open = false;
    onpick?.(option);
  }

  function onBlur() {
    // revert free text that was never picked so value and display stay in sync
    query = value;
    open = false;
  }
</script>

<div class="ss">
  <input
    type="text"
    bind:value={query}
    {placeholder}
    {disabled}
    autocomplete="off"
    spellcheck="false"
    onfocus={() => (open = true)}
    oninput={() => (open = true)}
    onblur={onBlur}
  />
  {#if open && matches.length}
    <ul class="ss-list">
      {#each matches as option (option)}
        <li
          onclick={() => pick(option)}
          onmousedown={(event) => event.preventDefault()}
          class:active={option === value}
        >{option}</li>
      {/each}
    </ul>
  {/if}
  {#if open && query && !matches.length}
    <div class="ss-empty">No matching model.</div>
  {/if}
</div>

<style>
  .ss { position: relative; }
  .ss input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
  .ss input:focus { outline: none; border-color: var(--accent-blue); }
  .ss input:disabled { opacity: 0.5; }
  .ss-list { border: 1px solid #3f3f46; border-radius: 2px; list-style: none; margin: 2px 0 0; max-height: 260px; overflow-y: auto; padding: 0; position: absolute; top: 100%; width: 100%; z-index: 30; }
  .ss-list li { background: #262626; border-bottom: 1px solid #3a3a3a; color: #ddd; cursor: pointer; font-size: 13px; padding: 6px 10px; }
  .ss-list li:hover, .ss-list li.active { background: #14557a; }
  .ss-empty { background: #262626; border: 1px solid #3f3f46; color: #999; font-size: 12px; margin-top: 2px; padding: 6px 10px; position: absolute; top: 100%; width: 100%; box-sizing: border-box; z-index: 30; }
</style>
