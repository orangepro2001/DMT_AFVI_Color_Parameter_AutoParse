import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, CopyPlan, CopyReport, HostId, Machine } from './app.service';
import { SearchSelectComponent } from './search-select.component';

const HOSTS: HostId[] = ['FM1', 'FM2', 'BM'];

/** FM1/FM2 may never exchange models with BM (either direction, even across machines). */
function hostsCompatible(a: HostId, b: HostId): boolean {
  const isBottom = (host: HostId) => host === 'BM';
  return isBottom(a) === isBottom(b);
}

interface PairPlan {
  host: HostId;
  plan?: CopyPlan;
  error?: string;
}

interface PairReport {
  host: HostId;
  report?: CopyReport;
  error?: string;
}

@Component({
  selector: 'app-model-copier',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchSelectComponent],
  template: `
    <div class="copier">
      <h2>Model Copier</h2>

      <label class="fullcopy-toggle">
        <input type="checkbox" [(ngModel)]="fullCopy" (ngModelChange)="onModeChanged()">
        One-click full machine copy (FM1→FM1, FM2→FM2, BM→BM between two different machines)
      </label>

      <div class="endpoints">
        <div class="endpoint-panel">
          <h3>Source</h3>
          <label>Machine</label>
          <select [(ngModel)]="sourceMachineId" (ngModelChange)="onMachineChanged('source')">
            <option [ngValue]="''" disabled>— select machine —</option>
            <option *ngFor="let m of machines" [ngValue]="m.id">{{m.name}}</option>
          </select>
          <label>Vision PC</label>
          <div class="all-hosts" *ngIf="fullCopy">FM1 / FM2 / BM <span class="all-note">(all three)</span></div>
          <select *ngIf="!fullCopy" [(ngModel)]="sourceHost" (ngModelChange)="onHostChanged('source')">
            <option *ngFor="let h of hosts" [value]="h">{{h}}</option>
          </select>
          <div class="path-hint mono" *ngIf="sourceReady && !fullCopy">
            Inventory: {{endpointPaths('source').inventory}}<br>Repository: {{endpointPaths('source').repository || '(not configured)'}}
          </div>
        </div>

        <div class="arrow">→</div>

        <div class="endpoint-panel">
          <h3>Target</h3>
          <label>Machine</label>
          <select [(ngModel)]="targetMachineId" (ngModelChange)="onMachineChanged('target')">
            <option [ngValue]="''" disabled>— select machine —</option>
            <option *ngFor="let m of machines" [ngValue]="m.id">{{m.name}}</option>
          </select>
          <label>Vision PC</label>
          <div class="all-hosts" *ngIf="fullCopy">FM1 / FM2 / BM <span class="all-note">(all three)</span></div>
          <select *ngIf="!fullCopy" [(ngModel)]="targetHost" (ngModelChange)="onHostChanged('target')">
            <option *ngFor="let h of hosts" [value]="h">{{h}}</option>
          </select>
          <div class="path-hint mono" *ngIf="targetReady && !fullCopy">
            Inventory: {{endpointPaths('target').inventory}}<br>Repository: {{endpointPaths('target').repository || '(not configured)'}}
          </div>
        </div>
      </div>

      <div class="warning" *ngIf="lastAutoSwitch && !fullCopy">
        FM1/FM2 and BM cannot exchange models - {{lastAutoSwitch}} was switched to match.
      </div>
      <div class="warning" *ngIf="fullCopy && sameMachineSelected">
        Full machine copy needs two different machines - pick another one on the target side.
      </div>

      <div class="model-row" *ngIf="modelRowVisible">
        <div class="form-group">
          <label>Model on {{sourceMachine?.name}} / {{fullCopy ? 'FM1+FM2+BM' : sourceHost}}</label>
          <app-search-select [options]="modelNames" [(value)]="modelName" (valueChange)="onModelPicked()"
                             placeholder="{{scanning ? 'Scanning models…' : '— select model —'}}" [disabled]="scanning">
          </app-search-select>
        </div>
        <button class="btn-secondary" (click)="buildPreview()" [disabled]="!modelName || previewing || scanning || copying">
          {{previewing ? 'Scanning…' : (fullCopy ? 'Preview Full Copy' : 'Preview Copy')}}
        </button>
      </div>

      <div class="status" *ngIf="statusMessage" [class.error]="statusIsError">{{statusMessage}}</div>

      <div class="plan" *ngIf="pairPlans.length">
        <h3>Copy plan for {{planModelName}}</h3>
        <ng-container *ngFor="let pair of pairPlans">
          <div class="pair-title" *ngIf="fullCopy">{{sourceMachine?.name}}/{{pair.host}} → {{targetMachine?.name}}/{{pair.host}}</div>
          <table *ngIf="pair.plan; else pairError">
            <thead><tr><th>Kind</th><th>Source (copy from)</th><th>Target (delete + copy)</th></tr></thead>
            <tbody>
              <tr *ngFor="let entry of pair.plan.entries">
                <td>{{entry.kind}}</td>
                <td class="mono">{{entry.source || '—'}}</td>
                <td class="mono">{{entry.target}} <span class="tag" *ngIf="entry.exists_on_target">existing folder will be replaced</span></td>
              </tr>
            </tbody>
          </table>
          <ng-template #pairError><div class="result-line error">{{pair.error}}</div></ng-template>
        </ng-container>
        <button class="btn-danger" (click)="confirming = true" [disabled]="!allPairsPlanned || copying">
          Start {{fullCopy ? 'Full ' : ''}}Copy…
        </button>
        <div class="result-line error" *ngIf="!allPairsPlanned">Fix the failed pair above before copying.</div>
      </div>

      <div class="report" *ngIf="pairReports.length">
        <h3>Result for {{planModelName}}</h3>
        <ng-container *ngFor="let pair of pairReports">
          <div class="pair-title" *ngIf="fullCopy">{{pair.host}}</div>
          <ng-container *ngIf="pair.report">
            <div *ngFor="let entry of pair.report.entries" class="result-line" [class.error]="!entry.ok">
              {{entry.kind}}: {{entry.ok ? 'copied to ' + entry.target : entry.error}}
            </div>
          </ng-container>
          <div class="result-line error" *ngIf="pair.error">{{pair.host}}: {{pair.error}}</div>
        </ng-container>
      </div>

      <!-- Danger confirmation: the target model folders are deleted before the copy. -->
      <div class="overlay" *ngIf="confirming">
        <div class="dialog">
          <h3>Confirm the {{fullCopy ? 'full machine ' : ''}}copy</h3>
          <p>This will <strong>delete</strong> the existing {{planModelName}} folders listed below and replace them
            with the ones from <strong>{{sourceMachine?.name}}</strong>{{fullCopy ? '' : ' / ' + sourceHost}}:</p>
          <ul>
            <ng-container *ngFor="let pair of pairPlans">
              <li class="pair-title" *ngIf="fullCopy">→ {{targetMachine?.name}} / {{pair.host}}</li>
              <li *ngFor="let entry of pair.plan?.entries"><span class="mono">{{entry.target}}</span></li>
            </ng-container>
          </ul>
          <p>Type the model name <strong>{{planModelName}}</strong> to enable the copy.</p>
          <input type="text" [(ngModel)]="confirmText" placeholder="{{planModelName}}">
          <div class="dialog-buttons">
            <button class="btn-secondary" (click)="cancelConfirm()">Cancel</button>
            <button class="btn-danger" [disabled]="confirmText !== planModelName || copying" (click)="runCopy()">
              {{copying ? 'Copying…' : (fullCopy ? 'Delete and Copy All Hosts' : 'Delete and Copy')}}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .copier { padding: 20px; max-width: 900px; margin: 0 auto; color: var(--text-main); }
    h2, h3 { margin-top: 0; }
    .fullcopy-toggle { display: flex; align-items: center; gap: 8px; margin: 10px 0 16px; font-size: 13px; cursor: pointer; }
    .fullcopy-toggle input { width: auto; }
    .endpoints { display: flex; align-items: flex-start; gap: 16px; }
    .endpoint-panel { flex: 1; background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; display: flex; flex-direction: column; gap: 8px; }
    .endpoint-panel label { color: var(--text-muted); font-size: 12px; }
    .endpoint-panel select { padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
    .all-hosts { padding: 8px; background: #1a2a3a; border: 1px solid #2a4a6a; color: #8cc8ff; border-radius: 2px; font-size: 13px; font-weight: bold; }
    .all-note { font-size: 10px; font-weight: normal; color: var(--text-muted); }
    .path-hint { margin-top: 4px; font-size: 10px; color: var(--text-muted); word-break: break-all; }
    .warning { margin-top: 12px; padding: 10px; background: #4a3200; border: 1px solid #b8860b; border-radius: 4px; }
    .model-row { display: flex; align-items: flex-end; gap: 12px; margin-top: 16px; }
    .form-group { flex: 1; }
    .form-group label { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
    select, input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
    .status { margin-top: 12px; padding: 8px; border-radius: 4px; background: var(--bg-panel); border: 1px solid var(--border-color); }
    .status.error { border-color: #d32f2f; color: #ef9a9a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
    .mono { font-family: Consolas, monospace; font-size: 11px; word-break: break-all; }
    .tag { color: #ffb74d; margin-left: 6px; }
    .plan, .report { margin-top: 16px; background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; }
    .pair-title { color: var(--accent-blue); font-size: 12px; font-weight: bold; margin: 8px 0 4px; }
    .result-line { padding: 4px 0; font-size: 12px; }
    .result-line.error { color: #ef9a9a; }
    button { padding: 8px 16px; border: none; border-radius: 2px; cursor: pointer; font-weight: bold; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: #3f3f46; color: white; }
    .btn-danger { background: #d32f2f; color: white; }
    .btn-danger:hover:not(:disabled) { background: #b71c1c; }
    .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .dialog { background: #232323; border: 1px solid #d32f2f; padding: 20px; border-radius: 4px; width: 560px; max-width: 90vw; max-height: 85vh; overflow: auto; }
    .dialog ul { font-size: 12px; list-style: none; padding-left: 0; }
    .dialog ul li { padding: 2px 0; }
    .dialog-buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
  `]
})
export class ModelCopierComponent implements OnInit {
  readonly hosts = HOSTS;
  machines: Machine[] = [];
  sourceMachineId = '';
  targetMachineId = '';
  sourceHost: HostId = 'FM1';
  targetHost: HostId = 'FM1';
  /** One-click mode: copy FM1→FM1, FM2→FM2, BM→BM between two different machines at once. */
  fullCopy = false;
  modelNames: string[] = [];
  modelName = '';
  pairPlans: PairPlan[] = [];
  pairReports: PairReport[] = [];
  statusMessage = '';
  statusIsError = false;
  previewing = false;
  scanning = false;
  copying = false;
  confirming = false;
  confirmText = '';
  /** Set briefly when a conflicting FM↔BM pick was auto-corrected, for the warning line. */
  lastAutoSwitch = '';

  constructor(private appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    this.machines = await this.appService.getMachines();
    this.cdr.markForCheck();
  }

  get sourceMachine(): Machine | undefined { return this.machineById(this.sourceMachineId); }
  get targetMachine(): Machine | undefined { return this.machineById(this.targetMachineId); }
  get sourceReady(): boolean { return !!this.sourceMachine; }
  get targetReady(): boolean { return !!this.targetMachine; }
  get sameMachineSelected(): boolean {
    return !!this.fullCopy && this.sourceReady && this.targetReady && this.sourceMachineId === this.targetMachineId;
  }
  get modelRowVisible(): boolean {
    if (!this.sourceReady || !this.targetReady) return false;
    return this.fullCopy ? !this.sameMachineSelected : true;
  }
  get planModelName(): string { return this.pairPlans.find(pair => pair.plan)?.plan?.model_name ?? this.modelName; }
  get allPairsPlanned(): boolean {
    return this.pairPlans.length > 0 && this.pairPlans.every(pair => !!pair.plan);
  }

  onModeChanged() {
    this.pairPlans = [];
    this.pairReports = [];
    this.statusMessage = '';
    void this.loadModels();
  }

  onMachineChanged(side: 'source' | 'target') {
    if (side === 'source') {
      this.modelNames = [];
      this.modelName = '';
    }
    this.pairPlans = [];
    this.pairReports = [];
    void this.loadModels();
  }

  /** All three sides stay selectable; a conflicting FM↔BM pick flips the
   * OTHER side to the same class (BM→BM, FM→FM) instead of being blocked. */
  onHostChanged(side: 'source' | 'target') {
    this.pairPlans = [];
    this.pairReports = [];
    if (this.sourceReady && this.targetReady && !hostsCompatible(this.sourceHost, this.targetHost)) {
      const host = side === 'source' ? this.sourceHost : this.targetHost;
      const flipped = host === 'BM' ? 'FM1' : 'BM';
      if (side === 'source') {
        this.targetHost = flipped;
      } else {
        this.sourceHost = flipped;
      }
      this.lastAutoSwitch = `${flipped} on the ${side === 'source' ? 'target' : 'source'} side`;
      window.setTimeout(() => { this.lastAutoSwitch = ''; this.cdr.markForCheck(); }, 4000);
    }
    void this.loadModels();
  }

  /** Picking a model invalidates the previous plan/report. */
  onModelPicked() {
    this.pairPlans = [];
    this.pairReports = [];
  }

  async buildPreview() {
    if (!this.sourceMachine || !this.targetMachine || !this.modelName) return;
    this.previewing = true;
    this.statusMessage = '';
    this.pairReports = [];
    const sourceEndpoints = this.fullCopy
      ? HOSTS.map(host => this.appService.endpointFor(this.sourceMachine!, host))
      : [this.appService.endpointFor(this.sourceMachine, this.sourceHost)];
    const targetEndpoints = this.fullCopy
      ? HOSTS.map(host => this.appService.endpointFor(this.targetMachine!, host))
      : [this.appService.endpointFor(this.targetMachine, this.targetHost)];
    try {
      // read-only previews can run in parallel; per-pair errors are shown inline
      const plans = await Promise.all(sourceEndpoints.map(async (source, index) => {
        try {
          return { host: sourceEndpoints.length === 1 ? this.sourceHost : HOSTS[index], plan: await this.appService.previewModelCopy(source, targetEndpoints[index], this.modelName) };
        } catch (error) {
          return { host: sourceEndpoints.length === 1 ? this.sourceHost : HOSTS[index], error: String(error) };
        }
      }));
      this.pairPlans = plans;
    } catch (error) {
      this.statusMessage = String(error);
      this.statusIsError = true;
    }
    this.previewing = false;
    this.cdr.markForCheck();
  }

  cancelConfirm() {
    this.confirming = false;
    this.confirmText = '';
  }

  async runCopy() {
    if (this.copying) return; // zoneless UI can lag - never run two copies at once
    if (!this.sourceMachine || !this.targetMachine || this.confirmText !== this.planModelName || !this.allPairsPlanned) return;
    this.copying = true;
    this.confirming = false;
    this.confirmText = '';
    this.statusMessage = '';
    this.cdr.markForCheck(); // close the dialog NOW, not after the copy finishes
    const reports: PairReport[] = [];
    try {
      // pairs run sequentially and stop at the first failure, so the operator
      // always knows exactly which host copy broke off
      for (let index = 0; index < this.pairPlans.length; index++) {
        const pair = this.pairPlans[index];
        const host = pair.host;
        this.statusMessage = `Copying to ${this.targetMachine.name} / ${host}… (${index + 1}/${this.pairPlans.length})`;
        this.cdr.markForCheck();
        const source = this.appService.endpointFor(this.sourceMachine, host);
        const target = this.appService.endpointFor(this.targetMachine, host);
        try {
          const report = await this.appService.copyModelBetweenHosts(source, target, this.modelName, true);
          reports.push({ host, report });
          const failed = report.entries.find(entry => !entry.ok);
          if (failed) {
            this.statusMessage = `Copy stopped on ${host} at ${failed.kind}: ${failed.error}`;
            this.statusIsError = true;
            break;
          }
        } catch (error) {
          reports.push({ host, error: String(error) });
          this.statusMessage = `Copy failed on ${host}: ${error}`;
          this.statusIsError = true;
          break;
        }
      }
      if (!this.statusIsError) {
        this.statusMessage = `Model ${this.planModelName} copied to ${this.targetMachine.name}${this.fullCopy ? ' (FM1/FM2/BM)' : ' / ' + this.targetHost}.`;
        this.statusIsError = false;
        this.pairPlans = [];
      }
    } catch (error) {
      this.statusMessage = String(error);
      this.statusIsError = true;
    }
    this.pairReports = reports;
    this.copying = false;
    this.cdr.markForCheck();
  }

  /** The UNC paths the copy will actually use for a side, resolved like endpointFor does. */
  endpointPaths(side: 'source' | 'target'): { inventory: string; repository: string } {
    const machine = side === 'source' ? this.sourceMachine : this.targetMachine;
    const host = side === 'source' ? this.sourceHost : this.targetHost;
    if (!machine) return { inventory: '', repository: '' };
    const endpoint = this.appService.endpointFor(machine, host);
    return { inventory: endpoint.inventory_path, repository: endpoint.repository_path };
  }

  private async loadModels() {
    if (!this.sourceMachine) {
      this.modelNames = [];
      this.scanning = false;
      return;
    }
    this.scanning = true;
    this.cdr.markForCheck();
    // scan only the chosen source Vision PC: the other slots stay empty so the
    // Rust scanner skips them (a path that does not exist is skipped silently).
    // In full-copy mode the union of all three hosts is what matters, so the
    // machine is scanned whole.
    const pseudoMachine: Machine = this.fullCopy
      ? { ...this.sourceMachine }
      : {
          ...this.sourceMachine,
          fm1_path: this.sourceHost === 'FM1' ? this.appService.getHostPath(this.sourceMachine, this.sourceHost) : '',
          fm2_path: this.sourceHost === 'FM2' ? this.appService.getHostPath(this.sourceMachine, this.sourceHost) : '',
          bm_path: this.sourceHost === 'BM' ? this.appService.getHostPath(this.sourceMachine, this.sourceHost) : ''
        };
    try {
      const candidates = await this.appService.scanModels(pseudoMachine);
      this.modelNames = candidates.map(candidate => candidate.name);
    } catch (error) {
      this.modelNames = [];
      this.statusMessage = String(error);
      this.statusIsError = true;
    } finally {
      this.scanning = false;
      this.cdr.markForCheck();
    }
  }

  private machineById(id: string): Machine | undefined {
    return this.machines.find(machine => machine.id === id);
  }
}
