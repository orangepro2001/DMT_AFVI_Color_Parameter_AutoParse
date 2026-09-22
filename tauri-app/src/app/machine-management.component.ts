import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, Machine } from './app.service';

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
            <button class="btn-delete" (click)="deleteMachine(i)">Delete</button>
          </div>
          <div class="machine-paths">
            <div>FM1 Path: {{m.fm1_path}}</div>
            <div>FM2 Path: {{m.fm2_path}}</div>
            <div>BM Path: {{m.bm_path}}</div>
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
          <label>FM1 Path</label>
          <input type="text" [(ngModel)]="newMachine.fm1_path" placeholder="\\\\192.168.1.61\\PxInventory">
        </div>
        <div class="form-group">
          <label>FM2 Path</label>
          <input type="text" [(ngModel)]="newMachine.fm2_path" placeholder="\\\\192.168.1.62\\PxInventory">
        </div>
        <div class="form-group">
          <label>BM Path</label>
          <input type="text" [(ngModel)]="newMachine.bm_path" placeholder="\\\\192.168.1.63\\PxInventory">
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
    .machine-header { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px; }
    .machine-paths { font-size: 12px; color: var(--text-muted); }
    .machine-paths div { margin-bottom: 4px; }
    
    .add-machine-form { background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 4px; }
    .form-group { margin-bottom: 15px; }
    .form-group label { display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; }
    .form-group input { width: 100%; box-sizing: border-box; padding: 8px; background: #1e1e1e; border: 1px solid #3f3f46; color: white; border-radius: 2px; }
    .form-group input:focus { outline: none; border-color: var(--accent-blue); }
    
    button { padding: 8px 16px; border: none; border-radius: 2px; cursor: pointer; font-weight: bold; }
    .btn-primary { background: var(--accent-blue); color: white; width: 100%; }
    .btn-primary:hover { background: #006ebd; }
    .btn-delete { background: #d32f2f; color: white; padding: 4px 8px; font-size: 11px; }
    .btn-delete:hover { background: #b71c1c; }
  `]
})
export class MachineManagementComponent implements OnInit {
  machines: Machine[] = [];
  newMachine: Machine = { id: '', name: '', fm1_path: '', fm2_path: '', bm_path: '' };

  constructor(private appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    this.machines = await this.appService.getMachines();
    this.cdr.markForCheck();
  }

  async addMachine() {
    if (!this.newMachine.name) return;
    this.newMachine.id = Date.now().toString();
    this.machines.push({ ...this.newMachine });
    await this.appService.saveMachines(this.machines);
    this.newMachine = { id: '', name: '', fm1_path: '', fm2_path: '', bm_path: '' };
    this.cdr.markForCheck();
  }

  async deleteMachine(index: number) {
    this.machines.splice(index, 1);
    await this.appService.saveMachines(this.machines);
    this.cdr.markForCheck();
  }
}
