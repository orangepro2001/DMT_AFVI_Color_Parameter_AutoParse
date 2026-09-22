import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MachineManagementComponent } from './machine-management.component';
import { DataCollectionComponent } from './data-collection.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, MachineManagementComponent, DataCollectionComponent],
  template: `
    <div class="settings-container">
      <div class="tabs top-tabs">
        <div class="tab" [class.active]="activeTab === 'machines'" (click)="activeTab = 'machines'">Machine Configuration</div>
        <div class="tab" [class.active]="activeTab === 'collect'" (click)="activeTab = 'collect'">Data Collection</div>
      </div>
      
      <div class="settings-content">
        <app-machine-management *ngIf="activeTab === 'machines'"></app-machine-management>
        <app-data-collection *ngIf="activeTab === 'collect'"></app-data-collection>
      </div>
    </div>
  `,
  styles: [`
    .settings-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background-color: #2b2b2b;
      color: white;
    }
    .tabs {
      display: flex;
      background-color: #333;
    }
    .tab {
      padding: 10px 15px;
      cursor: pointer;
      flex: 1;
      text-align: center;
      font-weight: bold;
      border-right: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
      background-color: #444;
      color: #aaa;
    }
    .tab.active {
      background-color: #e6e6fa;
      color: #000;
      border-bottom: none;
    }
    .settings-content {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
    }
  `]
})
export class SettingsComponent {
  activeTab: 'machines' | 'collect' = 'collect';
}
