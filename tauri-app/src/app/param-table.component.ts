import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

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

@Component({
  selector: 'app-param-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="param-table" tabindex="0" role="region" [attr.aria-label]="title + ' parameters'">
      <table [attr.aria-label]="title">
        <colgroup><col class="number-column"><col><col class="value-column"><col *ngIf="showMin" class="min-column"></colgroup>
        <thead><tr><th scope="col">No.</th><th scope="col">{{ title }}</th><th scope="col">Value</th><th *ngIf="showMin" scope="col">Min</th></tr></thead>
        <tbody>
          <tr *ngFor="let row of rows; index as index">
            <td>{{ index + 1 }}</td>
            <td class="parameter-name" [style.color]="row.color" [title]="row.name">{{ row.name }}</td>
            <td class="value">
              <input *ngIf="row.enabled === undefined" type="text" inputmode="decimal"
                autocomplete="off" spellcheck="false" [value]="row.value" placeholder="—"
                [disabled]="disabled || row.disabled" [attr.aria-label]="row.name + ' value'"
                [attr.aria-invalid]="row.invalid || null"
                [title]="row.invalid ? 'Enter a finite decimal number. Escape restores the current value.' : row.name"
                (input)="edit(row, $event)" (blur)="format(row, $event)"
                (keydown.enter)="commit($event)" (keydown.escape)="restore(row, $event)">
              <button *ngIf="row.enabled !== undefined" type="button" class="switch"
                role="switch" [class.on]="row.enabled" [attr.aria-checked]="row.enabled"
                [attr.aria-label]="row.name" [title]="row.name + (row.enabled ? ': ON' : ': OFF')"
                [disabled]="disabled || row.disabled"
                (click)="valueChange.emit({ row: row, value: row.enabled ? '0.000' : '1.000' })"></button>
            </td>
            <td class="min" *ngIf="showMin">{{ row.min }}</td>
          </tr>
        </tbody>
      </table>
      <p *ngIf="!rows.length">{{ emptyText || 'No parameters for this node.' }}</p>
    </section>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; min-width:0; overflow:hidden; }
    * { box-sizing:border-box; }
    .param-table { height:100%; overflow:auto; overscroll-behavior:contain; background:#303030; }
    table { border-collapse:separate; border-spacing:0; color:#ddd; font-size:11px; table-layout:fixed; width:100%; }
    .number-column { width:27px; } .value-column { width:69px; } .min-column { width:56px; }
    tr,th,td { height:20px; max-height:20px; }
    th,td { border-right:1px solid #484848; border-bottom:1px solid #484848; padding:0 4px; line-height:19px; }
    th { position:sticky; top:0; z-index:1; background:#3c3c3c; color:#eee; font-weight:400; }
    th:first-child,td:first-child { text-align:center; color:#c0c0c0; }
    th:nth-child(n+3) { text-align:right; }
    .parameter-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    td.value { padding:0 2px; text-align:right; }
    td.min { color:#bbb; font-variant-numeric:tabular-nums; }
    input[type=text] { display:block; width:100%; height:19px; margin:0; padding:0 3px; border:1px solid transparent;
      border-radius:0; background:#282828; color:#eee; font:11px/17px 'Segoe UI',sans-serif; text-align:right; font-variant-numeric:tabular-nums; }
    input:hover:not(:disabled) { border-color:#777; }
    input[aria-invalid=true] { border-color:#ff9494; background:#512f2f; }
    input:disabled { color:#aaa; background:#333; }
    p { color:#bdbdbd; font-size:11px; line-height:1.4; margin:10px 6px; text-align:center; }
    .switch { vertical-align:middle; background:#7a7a7a; border:1px solid #9a9a9a; border-radius:8px;
      display:inline-block; height:15px; padding:0; position:relative; width:32px; cursor:pointer; }
    .switch::after { background:#fff; border-radius:50%; box-shadow:0 0 1px #000a; content:''; height:11px;
      left:1px; position:absolute; top:1px; width:11px; }
    .switch.on { background:#0079b5; border-color:#0079b5; } .switch.on::after { left:18px; }
    .switch:disabled { cursor:default; opacity:.55; }
    .switch:hover:not(:disabled) { border-color:#fff; }
    button:focus-visible,input[type=text]:focus-visible,.param-table:focus-visible { outline:2px solid #8edcff; outline-offset:-2px; }
  `]
})
export class ParamTableComponent {
  @Input() title = '';
  @Input() rows: ParamDisplayRow[] = [];
  @Input() showMin = false;
  @Input() emptyText = '';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<ParamValueChange>();
  @Output() invalidChange = new EventEmitter<{ row: ParamDisplayRow; invalid: boolean }>();

  edit(row: ParamDisplayRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    row.invalid = !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
      || !Number.isFinite(Number(value));
    this.invalidChange.emit({ row, invalid: row.invalid });
    // Keep incomplete input visible; never substitute zero for invalid/missing data.
    if (!row.invalid) this.valueChange.emit({ row, value });
  }

  format(row: ParamDisplayRow, event: Event): void {
    if (!row.invalid) (event.target as HTMLInputElement).value = this.decimal(row.value);
  }

  commit(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  restore(row: ParamDisplayRow, event: Event): void {
    row.invalid = false;
    (event.target as HTMLInputElement).value = this.decimal(row.value);
    this.invalidChange.emit({ row, invalid: false });
  }

  private decimal(value: string): string {
    return value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value).toFixed(3) : value;
  }
}
