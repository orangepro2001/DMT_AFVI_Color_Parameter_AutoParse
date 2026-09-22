import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppService, ExportConfig, Machine, ModelCandidate, ParameterExportReport, StoredModelRecord } from './app.service';

const DEFAULT_EXPORT_PATH = 'D:\\검사기술파라미터';
const DEFAULT_TEMPLATE_PATH = 'D:\\검사기술파라미터\\Parameter_Template.xlsx';

@Component({
  selector: 'app-data-collection',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="container">
      <h2>Data Collection</h2>
      <div class="card">
        <p class="desc">Read the selected AFVI host's LightSpec and InspectionSpec XML files, then persist the normalized parameter record locally.</p>

        <div class="form-group">
          <label>AFVI Device</label>
          <select [(ngModel)]="selectedMachineId" (ngModelChange)="onTargetChanged()">
            <option value="">-- Select Machine --</option>
            <option *ngFor="let machine of machines" [value]="machine.id">{{ machine.name }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>Model Name</label>
          <div class="model-input">
            <input [(ngModel)]="modelName" (ngModelChange)="onModelInputChanged()" placeholder="Select or type a model name, e.g. 6ST2001Q01">
            <button type="button" class="choose-button" [disabled]="!selectedMachineId || isScanning" (click)="openModelPicker()">{{ isScanning ? 'Scanning...' : 'Choose Model' }}</button>
          </div>
        </div>

        <div class="target-summary" *ngIf="selectedMachine">
          Target: <strong>{{ selectedMachine.name }}</strong> <span>FM1 / TOP-1 + FM2 / TOP-2 + BM / BOTTOM will be collected as one snapshot.</span>
        </div>

        <div class="action-row">
          <button class="btn-primary" type="button"
            [class.optional]="hasExistingData" [class.needed]="needsCollect"
            (click)="collectData()" [disabled]="isCollecting || !selectedMachine || !modelName.trim()">
            {{ isCollecting ? 'Reading and Saving...' : hasExistingData ? 'Re-collect (optional)' : 'Collect & Save' }}
          </button>
          <button class="btn-open" type="button" *ngIf="hasExistingData" (click)="openTeach()">Open TEACH</button>
        </div>
        <div class="status-box" *ngIf="statusMessage" [class.error]="isError" [class.hint]="isHint && !isError">{{ statusMessage }}</div>

        <h3>Export Parameter Excel (검사기술파라미터)</h3>
        <div class="form-group">
          <label>Export Path</label>
          <input type="text" [(ngModel)]="exportConfig.exportPath" (ngModelChange)="onExportConfigChanged()" placeholder="D:\검사기술파라미터">
        </div>
        <div class="form-group">
          <label>Template Workbook (blank Parameter_Template.xlsx)</label>
          <input type="text" [(ngModel)]="exportConfig.templatePath" (ngModelChange)="onExportConfigChanged()" placeholder="D:\검사기술파라미터\Parameter_Template.xlsx">
        </div>
        <div class="action-row">
          <button class="btn-export" type="button" (click)="exportExcel()" [disabled]="isExporting || !hasExistingData">
            {{ isExporting ? 'Exporting...' : 'Export Parameter Excel' }}
          </button>
        </div>
        <div class="export-result" *ngIf="exportSummary">{{ exportSummary }}</div>
      </div>
    </section>

    <div class="modal-backdrop" *ngIf="isModelPickerOpen">
      <section class="model-modal" role="dialog" aria-modal="true">
        <header>Choose Model Names <button type="button" (click)="closeModelPicker()">x</button></header>
        <div class="model-caption">AFVI Device
          <select [(ngModel)]="selectedMachineId" (ngModelChange)="scanModalMachine()"><option *ngFor="let machine of machines" [value]="machine.id">{{ machine.name }}</option></select>
          <span>FM1 + FM2 + BM</span>
        </div>
        <div class="model-table">
          <div class="model-row header"><span>Index</span><span>Name</span><span>Available Hosts</span></div>
          <button class="model-row" type="button" *ngFor="let model of modelCandidates; index as index" [class.selected]="selectedModelCandidate?.name === model.name" (click)="selectedModelCandidate = model">
            <span>{{ (index + 1).toString().padStart(2, '0') }}</span><span>{{ model.name }}</span><span>{{ model.hosts.join(' / ') }}</span>
          </button>
          <p *ngIf="!modelCandidates.length" class="empty">No matching model folders were found.</p>
        </div>
        <footer><button type="button" class="apply" [disabled]="!selectedModelCandidate" (click)="applyModel()">Apply</button><button type="button" (click)="closeModelPicker()">Cancel</button></footer>
      </section>
    </div>

    <div class="toast" *ngIf="toast" (click)="dismissToast()" role="status">{{ toast }}</div>
  `,
  styles: [`
    .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: #f1f1f1; margin: 0 0 16px; font-size: 20px; }
    .card { background: #262626; border: 1px solid #4a4a4a; border-radius: 4px; padding: 20px; } .desc { color: #a9a9a9; font-size: 13px; line-height: 1.45; margin: 0 0 20px; }
    .form-group { margin: 0 0 14px; } label { display: block; color: #aaa; font-size: 12px; margin-bottom: 6px; } select, input { background: #1e1e1e; border: 1px solid #505050; box-sizing: border-box; color: #f2f2f2; height: 36px; padding: 7px 10px; width: 100%; } select:focus, input:focus { border-color: #0088cc; outline: none; }
    .host-selector { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 0 0 14px; } .host-selector button { background: #3a3a3a; border: 1px solid #555; color: #ddd; cursor: pointer; padding: 7px; } .host-selector button.active { background: #087fc1; border-color: #16a4ee; color: #fff; } .host-selector button:disabled { cursor: default; opacity: .45; } .host-selector strong, .host-selector small { display: block; } .host-selector small { font-size: 10px; margin-top: 2px; opacity: .8; }
    .model-input { display: flex; } .model-input input { border-right: 0; } .choose-button { background: #4d4d4d; border: 1px solid #606060; color: #eee; min-width: 116px; cursor: pointer; } .choose-button:disabled { color: #888; cursor: default; }
    .target-summary { color: #a8a8a8; font-size: 11px; margin: -2px 0 14px; } .target-summary strong { color: #8cc63f; } .target-summary span { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .action-row { display: flex; gap: 8px; } .btn-primary { background: #087fc1; border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; width: 100%; } .btn-primary:disabled { background: #484848; color: #a0a0a0; cursor: default; }
    .btn-primary.optional { background: #4d4d4d; border: 1px solid #666; color: #ddd; font-weight: 400; }
    .btn-primary.needed { animation: needed-pulse 1.6s ease-in-out infinite; }
    @keyframes needed-pulse { 0%, 100% { box-shadow: 0 0 0 0 #087fc100; } 50% { box-shadow: 0 0 0 4px #087fc145; } }
    .btn-open { background: #2e7d46; border: 0; color: #fff; cursor: pointer; flex: 0 0 auto; font-weight: 700; height: 36px; padding: 0 16px; } .btn-open:hover { background: #379454; }
    h3 { color: #f1f1f1; font-size: 14px; margin: 22px 0 12px; }
    .btn-export { background: #6d3fc1; border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; } .btn-export:hover { background: #7d4fd6; } .btn-export:disabled { background: #484848; color: #a0a0a0; cursor: default; }
    .export-result { background: #2d2d3d; border-left: 4px solid #6d3fc1; color: #ddd; font-size: 11px; line-height: 1.5; margin-top: 12px; padding: 8px 10px; word-break: break-all; }
    .status-box { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 15px; padding: 10px; } .status-box.error { background: #4a2d2d; border-left-color: #ff5252; } .status-box.hint { background: #4a3d2e; border-left-color: #e0a040; }
    .modal-backdrop { align-items: center; background: rgba(0, 0, 0, .65); display: flex; inset: 0; justify-content: center; position: fixed; z-index: 10; } .model-modal { background: #2d2d2d; border: 2px solid #0088cc; box-shadow: 0 12px 40px #000; color: #eee; width: min(580px, calc(100vw - 30px)); } .model-modal header { border-bottom: 1px solid #4a4a4a; display: flex; font-size: 14px; font-weight: 700; justify-content: space-between; padding: 7px 10px; } .model-modal header button { background: transparent; border: 0; color: #bbb; cursor: pointer; font-size: 18px; } .model-caption { align-items:center; color: #cfcfcf; display:flex; font-size: 12px; gap:8px; padding: 7px 10px; } .model-caption select { background:#1e1e1e; border:1px solid #555; color:#eee; padding:3px; } .model-caption span { color: #8cc63f; margin-left:auto; }
    .model-table { border: 1px solid #555; margin: 0 10px; max-height: 290px; overflow-y: auto; } .model-row { background: #303030; border: 0; border-bottom: 1px solid #414141; color: #ddd; display: grid; font: inherit; grid-template-columns: 70px 1fr 115px; padding: 6px; text-align: left; width: 100%; } button.model-row { cursor: pointer; } button.model-row:hover, .model-row.selected { background: #14557a; } .model-row.header { background: #3a3a3a; color: #bbb; } .empty { color: #aaa; padding: 18px; text-align: center; } footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 10px; } footer button { background: #666; border: 0; color: #fff; min-width: 105px; padding: 8px; } footer .apply { background: #087fc1; } footer .apply:disabled { background: #444; color: #888; }
    .toast { animation: toast-in .18s ease-out; background: #2e3d56; border: 1px solid #42c66d; border-left: 4px solid #42c66d; border-radius: 3px; box-shadow: 0 8px 24px #000a; color: #fff; cursor: pointer; font-size: 12px; max-width: 460px; padding: 10px 14px; position: fixed; right: 16px; top: 52px; z-index: 20; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  `]
})
export class DataCollectionComponent implements OnInit, OnDestroy {
  machines: Machine[] = [];
  selectedMachineId = '';
  modelName = '';
  isCollecting = false;
  isScanning = false;
  isError = false;
  isHint = false;
  statusMessage = '';
  isModelPickerOpen = false;
  modelCandidates: ModelCandidate[] = [];
  selectedModelCandidate: ModelCandidate | null = null;
  // Snapshot of the model in the local database, if one was collected before.
  existingRecord: StoredModelRecord | null = null;
  exportConfig: ExportConfig = { exportPath: '', templatePath: '' };
  isExporting = false;
  exportSummary = '';
  toast = '';
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private configTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly appService: AppService, private readonly cdr: ChangeDetectorRef, private readonly router: Router) {}

  get selectedMachine(): Machine | undefined {
    return this.machines.find((machine) => machine.id === this.selectedMachineId);
  }

  get hasExistingData(): boolean {
    return !!this.existingRecord;
  }

  // Highlight Collect while the selected model has no data to load yet.
  get needsCollect(): boolean {
    return !this.hasExistingData && !!this.selectedMachine && !!this.modelName.trim();
  }

  async ngOnInit(): Promise<void> {
    this.machines = await this.appService.getMachines();
    const active = await this.appService.getActiveSelection();
    this.exportConfig = await this.appService.getExportConfig();
    if (active && this.machines.some((machine) => machine.id === active.machineId)) {
      // Reopen on the model that is already active; no toast on a silent restore.
      this.selectedMachineId = active.machineId;
      this.modelName = active.modelName;
      await this.checkExisting(false);
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.configTimer) clearTimeout(this.configTimer);
  }

  onExportConfigChanged(): void {
    if (this.configTimer) clearTimeout(this.configTimer);
    this.configTimer = setTimeout(() => {
      this.configTimer = null;
      void this.appService.saveExportConfig(this.exportConfig).catch(() => {});
    }, 500);
  }

  private resolveExportConfig(): ExportConfig {
    return {
      exportPath: this.exportConfig.exportPath.trim() || DEFAULT_EXPORT_PATH,
      templatePath: this.exportConfig.templatePath.trim() || DEFAULT_TEMPLATE_PATH
    };
  }

  async exportExcel(): Promise<void> {
    const machine = this.selectedMachine;
    if (!machine || !this.modelName.trim()) return;
    this.isExporting = true;
    this.exportSummary = '';
    this.isError = false;
    this.isHint = false;
    this.statusMessage = 'Exporting the parameter workbook...';
    this.cdr.markForCheck();
    try {
      const config = this.resolveExportConfig();
      const report = await this.appService.exportParameterExcel(machine.id, this.modelName, machine.name, config);
      const filled = report.sheets.reduce((sum, s) => sum + s.filledCells, 0);
      const gv = report.sheets.reduce((sum, s) => sum + s.gvCells, 0);
      const appended = report.sheets.flatMap((s) => s.appendedAreas);
      const unresolved = report.sheets.reduce((sum, s) => sum + s.unresolvedLabels.length, 0);
      this.exportSummary = `Saved ${report.outputPath} - ${filled} parameter cells, ${gv} GV cells${
        appended.length ? `, completed areas: ${appended.join(', ')}` : ''
      }${unresolved ? `, ${unresolved} labels need manual attention` : ''}.`;
      this.statusMessage = `Export complete: ${report.fileName}`;
      this.isError = false;
      this.isHint = false;
      this.showToast(`Parameter Excel exported: ${report.fileName}`);
    } catch (error) {
      this.isError = true;
      this.statusMessage = `Export failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  onTargetChanged(): void {
    this.modelCandidates = [];
    this.selectedModelCandidate = null;
    this.existingRecord = null;
    this.statusMessage = '';
    this.isHint = false;
    this.cdr.markForCheck();
  }

  // Typed model names are checked (debounced) against the local database.
  onModelInputChanged(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      void this.checkExisting(true);
    }, 400);
  }

  async openModelPicker(): Promise<void> {
    if (!this.selectedMachine) return;
    this.isModelPickerOpen = true;
    await this.scanModalMachine();
  }

  async scanModalMachine(): Promise<void> {
    if (!this.selectedMachine) return;
    this.isScanning = true;
    this.statusMessage = `Scanning FM1, FM2, and BM for ${this.selectedMachine.name} models...`;
    this.isError = false;
    this.isHint = false;
    this.cdr.markForCheck();
    try {
      this.modelCandidates = await this.appService.scanModels(this.selectedMachine);
    } catch (error) {
      this.isError = true;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.isScanning = false;
      this.cdr.markForCheck();
    }
  }

  closeModelPicker(): void {
    this.isModelPickerOpen = false;
    this.selectedModelCandidate = null;
  }

  applyModel(): void {
    if (!this.selectedModelCandidate) return;
    this.modelName = this.selectedModelCandidate.name;
    this.isModelPickerOpen = false;
    this.selectedModelCandidate = null;
    this.cdr.markForCheck();
    void this.checkExisting(true);
  }

  openTeach(): void {
    void this.router.navigate(['/teach']);
  }

  async collectData(): Promise<void> {
    if (!this.selectedMachine || !this.modelName.trim()) return;
    this.isCollecting = true;
    this.isError = false;
    this.isHint = false;
    this.statusMessage = `Reading FM1, FM2, and BM for ${this.selectedMachine.name} / ${this.modelName}...`;
    // #region debug-point A:collection-start
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'post-fix', hypothesisId: 'A', location: 'data-collection.component.ts:collectData', msg: '[DEBUG] Three-host collection started', data: { machineId: this.selectedMachine.id, modelName: this.modelName }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    this.cdr.markForCheck();
    try {
      const record = await this.appService.collectAndPersist(this.selectedMachine, this.modelName);
      this.modelName = record.modelName;
      this.existingRecord = record;
      this.statusMessage = `Saved ${record.modelName}: FM1/TOP, FM2/TOP, and BM/BOTTOM are ready in the local database.`;
      this.showToast(`Model ${record.modelName} collected and applied to TEACH / CALIBRATE.`);
    } catch (error) {
      this.isError = true;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.isCollecting = false;
      this.cdr.markForCheck();
    }
  }

  dismissToast(): void {
    this.toast = '';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.cdr.markForCheck();
  }

  private async checkExisting(announce: boolean): Promise<void> {
    const machine = this.selectedMachine;
    const name = this.modelName.trim();
    if (!machine || !name) {
      this.existingRecord = null;
      this.cdr.markForCheck();
      return;
    }
    try {
      const record = await this.appService.getModelData(machine.id, name);
      this.existingRecord = record;
      if (record) {
        // Model already in the database: make it the active selection so TEACH
        // and CALIBRATE pick it up on their next load.
        this.modelName = record.modelName;
        await this.appService.saveActiveSelection({ machineId: machine.id, modelName: record.modelName });
        this.isError = false;
        this.isHint = false;
        this.statusMessage = `Loaded model ${record.modelName} from the local database (collected ${new Date(record.collectedAt).toLocaleString()}). It is applied to TEACH / CALIBRATE; Collect is optional and re-reads the device files.`;
        if (announce) this.showToast(`Model ${record.modelName} loaded successfully and applied to TEACH / CALIBRATE.`);
      } else {
        this.isError = false;
        this.isHint = true;
        this.statusMessage = `No data for ${name} in the local database yet - press Collect & Save below to read it from the device files.`;
      }
    } catch (error) {
      this.isError = true;
      this.isHint = false;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.cdr.markForCheck();
    }
  }

  private showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = '';
      this.cdr.markForCheck();
    }, 3500);
    this.cdr.markForCheck();
  }

  private toErrorMessage(error: unknown): string {
    return `Operation failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
  }
}
