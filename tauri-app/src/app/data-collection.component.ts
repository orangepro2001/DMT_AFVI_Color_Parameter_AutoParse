import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, HostId, Machine, ModelCandidate } from './app.service';

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
            <input [(ngModel)]="modelName" placeholder="Select or type a model name, e.g. 6ST2001Q01">
            <button type="button" class="choose-button" [disabled]="!selectedMachineId || isScanning" (click)="openModelPicker()">{{ isScanning ? 'Scanning...' : 'Choose Model' }}</button>
          </div>
        </div>

        <div class="target-summary" *ngIf="selectedMachine">
          Target: <strong>{{ selectedMachine.name }}</strong> <span>FM1 / TOP-1 + FM2 / TOP-2 + BM / BOTTOM will be collected as one snapshot.</span>
        </div>

        <button class="btn-primary" type="button" (click)="collectData()" [disabled]="isCollecting || !selectedMachine || !modelName">
          {{ isCollecting ? 'Reading and Saving...' : 'Collect & Save' }}
        </button>
        <div class="status-box" *ngIf="statusMessage" [class.error]="isError">{{ statusMessage }}</div>
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
  `,
  styles: [`
    .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: #f1f1f1; margin: 0 0 16px; font-size: 20px; }
    .card { background: #262626; border: 1px solid #4a4a4a; border-radius: 4px; padding: 20px; } .desc { color: #a9a9a9; font-size: 13px; line-height: 1.45; margin: 0 0 20px; }
    .form-group { margin: 0 0 14px; } label { display: block; color: #aaa; font-size: 12px; margin-bottom: 6px; } select, input { background: #1e1e1e; border: 1px solid #505050; box-sizing: border-box; color: #f2f2f2; height: 36px; padding: 7px 10px; width: 100%; } select:focus, input:focus { border-color: #0088cc; outline: none; }
    .host-selector { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 0 0 14px; } .host-selector button { background: #3a3a3a; border: 1px solid #555; color: #ddd; cursor: pointer; padding: 7px; } .host-selector button.active { background: #087fc1; border-color: #16a4ee; color: #fff; } .host-selector button:disabled { cursor: default; opacity: .45; } .host-selector strong, .host-selector small { display: block; } .host-selector small { font-size: 10px; margin-top: 2px; opacity: .8; }
    .model-input { display: flex; } .model-input input { border-right: 0; } .choose-button { background: #4d4d4d; border: 1px solid #606060; color: #eee; min-width: 116px; cursor: pointer; } .choose-button:disabled { color: #888; cursor: default; }
    .target-summary { color: #a8a8a8; font-size: 11px; margin: -2px 0 14px; } .target-summary strong { color: #8cc63f; } .target-summary span { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-primary { background: #087fc1; border: 0; color: #fff; cursor: pointer; font-weight: 700; height: 36px; width: 100%; } .btn-primary:disabled { background: #484848; color: #a0a0a0; cursor: default; }
    .status-box { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 15px; padding: 10px; } .status-box.error { background: #4a2d2d; border-left-color: #ff5252; }
    .modal-backdrop { align-items: center; background: rgba(0, 0, 0, .65); display: flex; inset: 0; justify-content: center; position: fixed; z-index: 10; } .model-modal { background: #2d2d2d; border: 2px solid #0088cc; box-shadow: 0 12px 40px #000; color: #eee; width: min(580px, calc(100vw - 30px)); } .model-modal header { border-bottom: 1px solid #4a4a4a; display: flex; font-size: 14px; font-weight: 700; justify-content: space-between; padding: 7px 10px; } .model-modal header button { background: transparent; border: 0; color: #bbb; cursor: pointer; font-size: 18px; } .model-caption { align-items:center; color: #cfcfcf; display:flex; font-size: 12px; gap:8px; padding: 7px 10px; } .model-caption select { background:#1e1e1e; border:1px solid #555; color:#eee; padding:3px; } .model-caption span { color: #8cc63f; margin-left:auto; }
    .model-table { border: 1px solid #555; margin: 0 10px; max-height: 290px; overflow-y: auto; } .model-row { background: #303030; border: 0; border-bottom: 1px solid #414141; color: #ddd; display: grid; font: inherit; grid-template-columns: 70px 1fr 115px; padding: 6px; text-align: left; width: 100%; } button.model-row { cursor: pointer; } button.model-row:hover, .model-row.selected { background: #14557a; } .model-row.header { background: #3a3a3a; color: #bbb; } .empty { color: #aaa; padding: 18px; text-align: center; } footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 10px; } footer button { background: #666; border: 0; color: #fff; min-width: 105px; padding: 8px; } footer .apply { background: #087fc1; } footer .apply:disabled { background: #444; color: #888; }
  `]
})
export class DataCollectionComponent implements OnInit {
  machines: Machine[] = [];
  selectedMachineId = '';
  modelName = '';
  isCollecting = false;
  isScanning = false;
  isError = false;
  statusMessage = '';
  isModelPickerOpen = false;
  modelCandidates: ModelCandidate[] = [];
  selectedModelCandidate: ModelCandidate | null = null;

  constructor(private readonly appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  get selectedMachine(): Machine | undefined {
    return this.machines.find((machine) => machine.id === this.selectedMachineId);
  }

  async ngOnInit(): Promise<void> {
    this.machines = await this.appService.getMachines();
    this.cdr.markForCheck();
  }

  onTargetChanged(): void {
    this.modelCandidates = [];
    this.selectedModelCandidate = null;
    this.cdr.markForCheck();
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
    this.cdr.markForCheck();
  }

  async collectData(): Promise<void> {
    if (!this.selectedMachine || !this.modelName.trim()) return;
    this.isCollecting = true;
    this.isError = false;
    this.statusMessage = `Reading FM1, FM2, and BM for ${this.selectedMachine.name} / ${this.modelName}...`;
    // #region debug-point A:collection-start
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'post-fix', hypothesisId: 'A', location: 'data-collection.component.ts:collectData', msg: '[DEBUG] Three-host collection started', data: { machineId: this.selectedMachine.id, modelName: this.modelName }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    this.cdr.markForCheck();
    try {
      const record = await this.appService.collectAndPersist(this.selectedMachine, this.modelName);
      this.modelName = record.modelName;
      this.statusMessage = `Saved ${record.modelName}: FM1/TOP, FM2/TOP, and BM/BOTTOM are ready in the local database.`;
    } catch (error) {
      this.isError = true;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.isCollecting = false;
      this.cdr.markForCheck();
    }
  }

  private toErrorMessage(error: unknown): string {
    return `Operation failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
  }
}
