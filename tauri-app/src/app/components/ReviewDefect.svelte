<script lang="ts">
  // REVIEW tab right panel: the defect list + defect-image preview, mirroring
  // the real machine's "Inspection - Defect" layout. No inspection results are
  // wired in this build, so the list is presented empty (honest placeholder).
  interface DefectRow {
    image: string;
    mergeId: string;
    ch: string;
    code: string;
    size: string;
    avr: string;
  }
  const rows = $state<DefectRow[]>([]);
</script>

<div class="review">
  <div class="list-head">
    <div class="list-title"><span class="dot"></span>Inspection - Defect</div>
    <div class="columns" role="row">
      <span>Image</span><span>Merge ID</span><span>CH</span><span class="gap"></span><span>Code</span><span>Size</span><span>Avr</span>
    </div>
  </div>
  <div class="list-body" role="region" aria-label="Defect list">
    {#each rows as row, index (index)}
      <div class="row">
        <span>{row.image}</span><span>{row.mergeId}</span><span>{row.ch}</span><span class="gap"></span>
        <span>{row.code}</span><span>{row.size}</span><span>{row.avr}</span>
      </div>
    {/each}
    {#if !rows.length}<p class="empty">No defects loaded. Inspection results will list here.</p>{/if}
  </div>
  <div class="preview" role="region" aria-label="Defect image preview">
    <span class="preview-hint">Defect image preview</span>
  </div>
</div>

<style>
  .review { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--machine-shell); color: var(--text-main); font: 12px 'Segoe UI', sans-serif; }
  .list-head { flex: none; border-bottom: 1px solid #000; }
  .list-title { display: flex; align-items: center; gap: 6px; padding: 6px 8px 3px; font-size: 12px; color: var(--text-main); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-main); flex: none; }
  .columns, .row { display: grid; grid-template-columns: 22% 22% 12% 6px 1fr 1fr 1fr; align-items: center; gap: 4px; padding: 2px 8px; }
  .columns { color: var(--text-main); font-size: 11px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
  .columns .gap, .row .gap { padding: 0; }
  .list-body { flex: 1; min-height: 0; overflow: auto; }
  .row { border-bottom: 1px solid var(--border-color); font-size: 11px; height: 22px; }
  .empty { color: var(--text-muted); font-size: 11px; line-height: 1.6; padding: 14px 10px; }
  .preview { flex: 0 0 34%; min-height: 120px; border-top: 1px solid #000; background: var(--bg-header); display: flex; align-items: center; justify-content: center; }
  .preview-hint { color: var(--text-muted); font-size: 11px; }
</style>
