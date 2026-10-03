import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, deriveHostPath, HostId, Machine } from './app.service';

interface HostField {
  host: HostId;
  inventory: keyof Machine;
  repository: keyof Machine;
  inventoryKey: string;
  repositoryKey: string;
}

// one Vision PC = one PxInventory + one PxRepository share, both derived from the Main PC IP
const HOST_FIELDS: HostField[] = [
  { host: 'FM1', inventory: 'fm1_path', repository: 'fm1_repository_path', inventoryKey: 'fm1_path', repositoryKey: 'fm1_repository_path' },
  { host: 'FM2', inventory: 'fm2_path', repository: 'fm2_repository_path', inventoryKey: 'fm2_path', repositoryKey: 'fm2_repository_path' },
  { host: 'BM', inventory: 'bm_path', repository: 'bm_repository_path', inventoryKey: 'bm_path', repositoryKey: 'bm_repository_path' }
];

@Component({
  selector: 'app-machine-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container">
      <h2>Machine Management</h2>
      <div class="machine-list">
        <div class="machine-item" *ngFor="let m of machines; let i = index">
          <div class="machine-header">
            <strong>{{m.name}}</strong>
            <span class="main-ip" *ngIf="m.main_ip">{{m.main_ip}}</span>
            <button class="btn-delete" (click)="deleteMachine(i)">Delete</button>
          </div>
          <div class="machine-paths">
            <div *ngFor="let f of hostFields">
              <strong>{{f.host}}</strong> — Inventory: {{m[f.inventory]}} · Repository: {{m[f.repository] || '(auto)'}}
            </div>
            <div *ngIf="m.username">Network User: {{m.username}}</div>
          </div>
        </div>
      </div>

      <div class="add-machine-form">
        <h3>Register New Machine</h3>
        <div class="form-group">
          <label>Name (e.g. AFVI 14)</label>
          <input type="text" [(ngModel)]="newMachine.name" placeholder="AFVI 14">
        </div>
        <div class="form-group">
          <label>Main PC IP (Vision PCs derive from it: +1 FM1, +2 FM2, +3 BM)</label>
          <input type="text" [(ngModel)]="newMachine.main_ip" (ngModelChange)="applyDerivedPaths()" placeholder="192.168.1.60">
        </div>

        <div class="host-block" *ngFor="let f of hostFields">
          <div class="host-title">{{f.host}} Vision PC</div>
          <div class="host-paths">
            <div class="form-group">
              <label>PxInventory <span class="derived-hint" *ngIf="isAutoFilled(f.inventoryKey)">(auto)</span></label>
              <input type="text" [(ngModel)]="newMachine[f.inventory]" (ngModelChange)="touch(f.inventoryKey)"
                     placeholder="\\\\192.168.1.61\\PxInventory">
            </div>
            <div class="form-group">
              <label>PxRepository <span class="derived-hint" *ngIf="isAutoFilled(f.repositoryKey)">(auto)</span></label>
              <input type="text" [(ngModel)]="newMachine[f.repository]" (ngModelChange)="touch(f.repositoryKey)"
                     placeholder="\\\\192.168.1.61\\PxRepository">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>Network Username (optional, for UNC shares)</label>
          <input type="text" [(ngModel)]="newMachine.username" autocomplete="off" placeholder="domain\\user or user">
        </div>
        <div class="form-group">
          <label>Network Password (optional)</label>
          <input type="password" [(ngModel)]="newMachine.password" autocomplete="new-password" placeholder="">
        </div>
        <button class="btn-primary" (click)="addMachine()">Register Machine</button>
      </div>
    </div>
  `,
  styles: [`
    .container { padding: 20px; max-width: 600px; margin: 0 auto; }
    h2, h3 { color: var(--text-main); margin-top: 0; }
    .machine-list { margin-bottom: 30px; }
    .machine-item { background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; margin-bottom: 10px; }
    .machine-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px; }
    .main-ip { color: var(--accent-blue); font-size: 12px; margin-left: auto; margin-right: 10px; }
    .machine-paths { font-size: 12px; color: var(--text-muted); }
    .machine-paths div { margin-bottom: 4px; }

    .add-machine-form { background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
    .form-group input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
    .form-group input:focus { outline: none; border-color: var(--accent-blue); }
    .derived-hint { color: var(--accent-blue); }
    .host-block { border: 1px solid #3f3f46; border-radius: 4px; padding: 12px; margin-bottom: 12px; }
    .host-title { font-size: 12px; font-weight: bold; color: var(--text-main); margin-bottom: 8px; }

    button { padding: 8px 16px; border: none; border-radius: 2px; cursor: pointer; font-weight: bold; }
    .btn-primary { background: var(--accent-blue); color: white; width: 100%; }
    .btn-primary:hover { background: #006ebd; }
    .btn-delete { background: #d32f2f; color: white; padding: 4px 8px; font-size: 11px; }
    .btn-delete:hover { background: #b71c1c; }
  `]
})
export class MachineManagementComponent implements OnInit {
  readonly hostFields = HOST_FIELDS;
  machines: Machine[] = [];
  newMachine: Machine = this.emptyMachine();
  /** Fields the user typed into manually keep their value when the IP changes. */
  private manuallyEdited = new Set<string>();

  constructor(private appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    this.machines = await this.appService.getMachines();
    this.cdr.markForCheck();
  }

  isAutoFilled(key: string): boolean {
    return !this.manuallyEdited.has(key) && !!this.derivedValue(key);
  }

  touch(key: string) {
    this.manuallyEdited.add(key);
  }

  /** Refill every untouched path field from the Main PC IP. */
  applyDerivedPaths() {
    for (const field of HOST_FIELDS) {
      for (const key of [field.inventoryKey, field.repositoryKey]) {
        if (!this.manuallyEdited.has(key)) {
          this.newMachine[key as keyof Machine] = this.derivedValue(key);
        }
      }
    }
  }

  async addMachine() {
    if (!this.newMachine.name) return;
    this.newMachine.id = Date.now().toString();
    this.machines.push({ ...this.newMachine });
    await this.appService.saveMachines(this.machines);
    this.newMachine = this.emptyMachine();
    this.manuallyEdited.clear();
    this.cdr.markForCheck();
  }

  async deleteMachine(index: number) {
    this.machines.splice(index, 1);
    await this.appService.saveMachines(this.machines);
    this.cdr.markForCheck();
  }

  private derivedValue(key: string): string {
    const field = HOST_FIELDS.find(item => item.inventoryKey === key || item.repositoryKey === key);
    if (!field) return '';
    const kind = key.endsWith('_repository_path') ? 'repository' : 'inventory';
    return deriveHostPath(this.newMachine.main_ip ?? '', field.host, kind);
  }

  private emptyMachine(): Machine {
    return { id: '', name: '', main_ip: '', fm1_path: '', fm2_path: '', bm_path: '', username: '', password: '' };
  }
}
