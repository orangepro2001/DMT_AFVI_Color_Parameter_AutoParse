import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Searchable replacement for a <select> with many options: type to filter,
 * click a row to pick. The value only changes on an explicit pick; leaving
 * without picking reverts the text to the current value.
 */
@Component({
  selector: 'app-search-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="ss">
      <input type="text" [ngModel]="query" (ngModelChange)="onQuery($event)" [placeholder]="placeholder"
             [disabled]="disabled" autocomplete="off" spellcheck="false"
             (focus)="open = true" (blur)="onBlur()" />
      <ul class="ss-list" *ngIf="open && matches.length">
        <li *ngFor="let option of matches" (mousedown)="pick(option)" [class.active]="option === value">{{ option }}</li>
      </ul>
      <div class="ss-empty" *ngIf="open && query && !matches.length">No matching model.</div>
    </div>
  `,
  styles: [`
    .ss { position: relative; }
    .ss input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
    .ss input:focus { outline: none; border-color: var(--accent-blue); }
    .ss input:disabled { opacity: 0.5; }
    .ss-list { border: 1px solid #3f3f46; border-radius: 2px; list-style: none; margin: 2px 0 0; max-height: 260px; overflow-y: auto; padding: 0; position: absolute; top: 100%; width: 100%; z-index: 30; }
    .ss-list li { background: #262626; border-bottom: 1px solid #3a3a3a; color: #ddd; cursor: pointer; font-size: 13px; padding: 6px 10px; }
    .ss-list li:hover, .ss-list li.active { background: #14557a; }
    .ss-empty { background: #262626; border: 1px solid #3f3f46; color: #999; font-size: 12px; margin-top: 2px; padding: 6px 10px; position: absolute; top: 100%; width: 100%; box-sizing: border-box; z-index: 30; }
  `]
})
export class SearchSelectComponent implements OnChanges {
  @Input() options: string[] = [];
  @Input() value = '';
  @Input() placeholder = '';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  query = '';
  open = false;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges) {
    // keep the box showing the current value when the parent resets it (e.g. after a rescan)
    if (changes['value'] && !this.open) this.query = this.value;
  }

  get matches(): string[] {
    const needle = this.query.trim().toUpperCase();
    const pool = needle ? this.options.filter(option => option.toUpperCase().includes(needle)) : this.options;
    return pool.slice(0, 200);
  }

  onQuery(text: string) {
    this.query = text;
    this.open = true;
    this.cdr.markForCheck();
  }

  pick(option: string) {
    this.value = option;
    this.query = option;
    this.open = false;
    this.valueChange.emit(option);
  }

  onBlur() {
    // revert free text that was never picked so value and display stay in sync
    this.query = this.value;
    this.open = false;
    this.cdr.markForCheck();
  }
}
