import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, MigrationReport, StorageConfig } from './app.service';

@Component({
  selector: 'app-database-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container">
      <h2>Database</h2>

      <div class="card">
        <div class="in-use">
          <span class="in-use-label">In use:</span>
          <span class="backend-badge" [class.mongo]="config?.backend === 'mongodb'">
            {{ config?.backend === 'mongodb' ? 'MongoDB' : 'Local JSON files' }}
          </span>
          <span class="in-use-detail" *ngIf="config?.backend === 'mongodb' && config?.mongodb?.database">
            db: {{ config?.mongodb?.database }}{{ mongoStatus ? ' · ' + mongoStatus : '' }}
          </span>
        </div>

        <div class="form-group">
          <label>Backend</label>
          <select [(ngModel)]="draft.backend" (ngModelChange)="onBackendChanged()">
            <option value="local">Local JSON files (offline, no server)</option>
            <option value="mongodb">MongoDB (shared cluster)</option>
          </select>
        </div>

        <ng-container *ngIf="draft.backend === 'mongodb'">
          <div class="form-group">
            <label>Connection String (mongodb+srv://user:password&#64;host/...)</label>
            <input type="text" [(ngModel)]="draft.mongodb.url" autocomplete="off" spellcheck="false" placeholder="mongodb+srv://user:password&#64;cluster0.xxx.mongodb.net">
          </div>
          <div class="form-group">
            <label>Database Name</label>
            <input type="text" [(ngModel)]="draft.mongodb.database" autocomplete="off" spellcheck="false" placeholder="dmt_afvi">
          </div>

          <div class="action-row">
            <button type="button" class="btn-secondary" [disabled]="testing" (click)="testConnection()">
              {{ testing ? 'Testing...' : 'Test Connection' }}
            </button>
            <button type="button" class="btn-secondary" [disabled]="migrating" (click)="migrate()">
              {{ migrating ? 'Migrating...' : 'Migrate Local Data → MongoDB' }}
            </button>
            <button type="button" class="btn-primary-inline" [disabled]="saving" (click)="apply()">
              {{ saving ? 'Applying...' : 'Save & Apply' }}
            </button>
          </div>
          <p class="note">Save &amp; Apply switches the app to this database immediately (also persisted in storage.json). Local JSON files stay as a read fallback and backup.</p>
        </ng-container>

        <div class="db-status" *ngIf="statusMessage" [class.error]="isError">{{ statusMessage }}</div>
        <div class="db-report" *ngIf="migrationReport">
          Migrated {{ migrationReport.migrated.length }} documents ({{ migrationReport.targetDocuments }} in the target now)
          <span *ngIf="migrationReport.failed.length"> — {{ migrationReport.failed.length }} failed: {{ migrationReport.failedText }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .container { padding: 20px; max-width: 620px; margin: 0 auto; } h2 { color: #f1f1f1; margin: 0 0 16px; font-size: 20px; }
    .card { background: #262626; border: 1px solid #4a4a4a; border-radius: 4px; padding: 20px; }
    .in-use { align-items: center; display: flex; gap: 8px; margin-bottom: 18px; }
    .in-use-label { color: #aaa; font-size: 12px; }
    .backend-badge { background: #3a5a3a; border: 1px solid #42c66d; border-radius: 10px; color: #c9f2d4; font-size: 11px; padding: 2px 10px; }
    .backend-badge.mongo { background: #3d3a5a; border-color: #7d6ce0; color: #d9d2f7; }
    .in-use-detail { color: #888; font-size: 11px; }
    .form-group { margin-bottom: 14px; } label { color: #aaa; display: block; font-size: 12px; margin-bottom: 6px; }
    select, input { background: #1e1e1e; border: 1px solid #505050; box-sizing: border-box; color: #f2f2f2; height: 36px; padding: 7px 10px; width: 100%; }
    select:focus, input:focus { border-color: #0088cc; outline: none; }
    .action-row { display: flex; gap: 8px; margin-top: 6px; }
    .btn-secondary { background: #4d4d4d; border: 1px solid #666; color: #eee; cursor: pointer; flex: 1; height: 36px; } .btn-secondary:hover { background: #5a5a5a; } .btn-secondary:disabled { color: #888; cursor: default; }
    .btn-primary-inline { background: #087fc1; border: 0; color: #fff; cursor: pointer; flex: 1; font-weight: 700; height: 36px; } .btn-primary-inline:disabled { background: #484848; color: #a0a0a0; cursor: default; }
    .note { color: #888; font-size: 11px; line-height: 1.5; margin: 10px 0 0; }
    .db-status { background: #2e3d56; border-left: 4px solid #42c66d; color: #fff; font-size: 12px; margin-top: 14px; padding: 8px 10px; word-break: break-all; }
    .db-status.error { background: #4a2d2d; border-left-color: #ff5252; }
    .db-report { background: #2d2d3d; border-left: 4px solid #6d3fc1; color: #ddd; font-size: 11px; margin-top: 10px; padding: 8px 10px; word-break: break-all; }
  `]
})
export class DatabaseSettingsComponent implements OnInit {
  config: StorageConfig | null = null;
  draft: { backend: 'local' | 'mongodb'; mongodb: { url: string; database: string } } = { backend: 'local', mongodb: { url: '', database: 'dmt_afvi' } };
  testing = false;
  saving = false;
  migrating = false;
  isError = false;
  statusMessage = '';
  mongoStatus = '';
  migrationReport: (MigrationReport & { failedText: string }) | null = null;

  constructor(private readonly appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.config = await this.appService.getStorageConfig();
    this.draft = {
      backend: this.config.backend === 'mongodb' ? 'mongodb' : 'local',
      mongodb: { url: this.config.mongodb?.url ?? '', database: this.config.mongodb?.database ?? 'dmt_afvi' }
    };
    this.statusMessage = '';
    this.isError = false;
    this.cdr.markForCheck();
  }

  onBackendChanged(): void {
    this.cdr.markForCheck();
  }

  async testConnection(): Promise<void> {
    this.testing = true;
    this.statusMessage = 'Testing...';
    this.isError = false;
    this.migrationReport = null;
    this.cdr.markForCheck();
    try {
      this.statusMessage = await this.appService.testMongoConnection(this.draft.mongodb.url, this.draft.mongodb.database);
      this.mongoStatus = `${this.draft.mongodb.database}`;
    } catch (error) {
      this.isError = true;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.testing = false;
      this.cdr.markForCheck();
    }
  }

  async migrate(): Promise<void> {
    this.migrating = true;
    this.statusMessage = 'Migrating local documents into MongoDB...';
    this.isError = false;
    this.cdr.markForCheck();
    try {
      const report = await this.appService.migrateLocalToMongo(this.draft.mongodb.url, this.draft.mongodb.database);
      this.migrationReport = { ...report, failedText: report.failed.map(f => `${f.key}: ${f.reason}`).join('; ') };
      this.statusMessage = 'Migration finished.';
    } catch (error) {
      this.isError = true;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.migrating = false;
      this.cdr.markForCheck();
    }
  }

  async apply(): Promise<void> {
    this.saving = true;
    this.statusMessage = 'Applying...';
    this.isError = false;
    this.cdr.markForCheck();
    try {
      const config: StorageConfig = {
        backend: this.draft.backend,
        mongodb: { url: this.draft.mongodb.url.trim(), database: this.draft.mongodb.database.trim() || 'dmt_afvi' }
      };
      await this.appService.saveStorageConfig(config);
      this.config = await this.appService.getStorageConfig();
      this.statusMessage = `Applied. The app now reads and writes ${config.backend === 'mongodb' ? 'MongoDB' : 'the local JSON database'}.`;
    } catch (error) {
      this.isError = true;
      this.statusMessage = this.toErrorMessage(error);
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  private toErrorMessage(error: unknown): string {
    return `Operation failed: ${typeof error === 'string' ? error : 'Unexpected error'}`;
  }
}
