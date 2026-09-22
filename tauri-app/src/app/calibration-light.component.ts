import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, GvValueSet, GvValues, HostId, Machine, StoredModelRecord } from './app.service';

@Component({
  selector: 'app-calibration-light',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="model-bar">
      <select [(ngModel)]="selectedHost" (ngModelChange)="refreshChannels()"><option value="FM1">FM1 / TOP-1</option><option value="FM2">FM2 / TOP-2</option><option value="BM">BM / BOTTOM</option></select>
      <span class="model-name">{{ selectedMachine?.name || 'No device' }} / {{ modelName || 'No model selected' }}</span>
    </div>
    <div class="empty" *ngIf="!record">Choose and collect a Model first.</div>
    <section class="calibration" *ngIf="record">
      <div class="gv-box">
        <div class="gv-title">GV 밝기 <span>(measured and entered manually — not in the spec XML)</span></div>
        <table class="gv-table">
          <thead><tr><th class="row-label"></th><th class="red" *ngFor="let color of gvColors">{{ color.toUpperCase() }}</th></tr></thead>
          <tbody>
            <tr *ngFor="let row of gvRows">
              <th class="row-label">{{ row }}</th>
              <td *ngFor="let color of gvColors">
                <input type="text" maxlength="24" autocomplete="off" spellcheck="false"
                  [ngModel]="gvValue(row, color)" (ngModelChange)="setGvValue(row, color, $event)"
                  [attr.aria-label]="row + ' ' + color + ' GV'" placeholder="">
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <header><label class="power"><input type="checkbox" [(ngModel)]="globalOn"> <b>{{ globalOn ? 'ON' : 'OFF' }}</b></label><label>Page Index: <select [(ngModel)]="pageIndex" (ngModelChange)="refreshChannels()"><option [ngValue]="0">1</option><option [ngValue]="1">2</option><option [ngValue]="2">3</option></select></label></header>
      <div class="title">• Calibration - Light</div>
      <table><thead><tr><th>Channel</th><th>Brightness</th><th>Value</th><th>Angle</th><th>Color</th><th>ON/OFF</th></tr></thead>
        <tbody><tr *ngFor="let channel of channels"><td>{{ channel.index }}</td><td><input type="range" min="0" max="1000" [(ngModel)]="channel.value" [disabled]="!channel.enable"></td><td>{{ channel.value }}</td><td>{{ channel.angle }}°</td><td [class.dim]="!channel.enable">{{ channel.color }}</td><td><label class="toggle"><input type="checkbox" [(ngModel)]="channel.enable"><span></span></label></td></tr></tbody>
      </table>
    </section>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; } .model-bar { display:flex; gap:6px; padding:6px; background:#252525; } .model-bar select { background:#1e1e1e; border:1px solid #555; color:#eee; padding:4px; } .model-name { color:#8cc63f; font-size:12px; overflow:hidden; padding:5px; text-overflow:ellipsis; white-space:nowrap; } .empty { color:#999; padding:30px; text-align:center; }
    .calibration { display:flex; flex:1; flex-direction:column; min-height:0; background:#303030; }
    .gv-box { background:#262626; border-bottom:1px solid #505050; padding:5px 8px 7px; }
    .gv-title { color:#eee; font-size:12px; font-weight:700; padding:0 1px 3px; } .gv-title span { color:#9a9a9a; font-size:10px; font-weight:400; }
    .gv-table { border-collapse:collapse; table-layout:fixed; width:100%; } .gv-table th, .gv-table td { border:1px solid #4a4a4a; height:22px; padding:0; text-align:center; }
    .gv-table .row-label { background:#333; color:#ddd; font-size:11px; font-weight:400; width:64px; }
    .gv-table thead th { background:#3c3c3c; color:#eee; font-size:11px; font-weight:700; letter-spacing:.4px; }
    .gv-table thead th.red { background:#e0182d; color:#fff; } .gv-table thead th.green { background:#92d050; color:#000; } .gv-table thead th.blue { background:#00b0f0; color:#000; }
    .gv-table input { background:#1e1e1e; border:1px solid #555; box-sizing:border-box; color:#eee; font:11px/19px 'Segoe UI',sans-serif; height:20px; padding:0 3px; text-align:center; width:100%; } .gv-table input:focus { border-color:#0088cc; outline:none; }
    header { align-items:center; background:#333; color:#ddd; display:flex; justify-content:space-between; padding:7px 10px; } header select { background:#202020; border:1px solid #555; color:#fff; } .power b { color:#8cc63f; } .title { border-bottom:1px solid #505050; color:#eee; padding:5px 10px; }
    table { border-collapse:collapse; color:#ddd; font-size:12px; width:100%; } th { background:#3c3c3c; border:1px solid #4a4a4a; font-weight:400; padding:4px; } td { border-bottom:1px solid #414141; padding:3px; text-align:center; } td:nth-child(2) { width:43%; } input[type=range] { width:100%; } .dim { color:#777; }
    .toggle { display:inline-block; height:15px; position:relative; width:31px; } .toggle input { opacity:0; } .toggle span { background:#666; border-radius:9px; inset:0; position:absolute; } .toggle span::after { background:#ddd; border-radius:50%; content:''; height:11px; left:2px; position:absolute; top:2px; width:11px; } .toggle input:checked + span { background:#0088cc; } .toggle input:checked + span::after { left:18px; }
  `]
})
export class CalibrationLightComponent implements OnInit, OnDestroy {
  machines: Machine[] = [];
  selectedMachine?: Machine;
  selectedHost: HostId = 'FM1';
  machineId = '';
  modelName = '';
  record: StoredModelRecord | null = null;
  channels: Array<{ index: number; value: number; angle: number; color: string; enable: boolean }> = [];
  pageIndex = 0;
  globalOn = true;
  readonly gvColors = ['Red', 'Green', 'Blue'] as const;
  private gvStore: GvValues = {};
  private gvSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  // Light 1-2 inspect the pad areas, light 3 inspects the SR/space structure (Parameter_Template).
  get gvRows(): string[] {
    return this.pageIndex < 2 ? ['AU', 'OSP'] : ['SR', 'Space'];
  }

  async ngOnInit(): Promise<void> {
    this.machines = await this.appService.getMachines();
    const active = await this.appService.getActiveSelection();
    this.selectedMachine = this.machines.find((machine) => machine.id === active?.machineId);
    this.machineId = active?.machineId ?? '';
    this.modelName = active?.modelName ?? '';
    this.record = active ? await this.appService.getModelData(active.machineId, active.modelName) : null;
    this.refreshChannels();
    this.gvStore = this.machineId && this.modelName ? await this.appService.getGvValues(this.machineId, this.modelName) : {};
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.flushGvSave();
  }

  refreshChannels(): void {
    this.channels = this.record ? this.appService.getLightChannels(this.record, this.selectedHost, this.pageIndex) : [];
    this.cdr.markForCheck();
  }

  gvValue(row: string, color: string): string {
    return this.gvStore[this.selectedHost]?.[String(this.pageIndex)]?.[row]?.[color as keyof GvValueSet] ?? '';
  }

  setGvValue(row: string, color: string, value: string): void {
    const pageStore = this.gvStore[this.selectedHost] ??= {};
    const rowStore = pageStore[String(this.pageIndex)] ??= {};
    rowStore[row] ??= { Red: '', Green: '', Blue: '' };
    rowStore[row][color as keyof GvValueSet] = value;
    this.scheduleGvSave();
  }

  private scheduleGvSave(): void {
    if (this.gvSaveTimer) clearTimeout(this.gvSaveTimer);
    this.gvSaveTimer = setTimeout(() => this.flushGvSave(), 500);
  }

  private flushGvSave(): void {
    if (this.gvSaveTimer) {
      clearTimeout(this.gvSaveTimer);
      this.gvSaveTimer = null;
    }
    if (this.destroyed || !this.machineId || !this.modelName) return;
    this.appService.saveGvValues(this.machineId, this.modelName, this.gvStore).catch(() => {});
  }
}
