import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppService } from './app.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="afvi-shell">
      <!-- Top Navigation -->
      <header class="top-nav">
        <div class="nav-links">
          <a routerLink="/home" routerLinkActive="active" class="nav-item disabled">HOME</a>
          <a routerLink="/teach" routerLinkActive="active" class="nav-item">TEACH</a>
          <a routerLink="/review" routerLinkActive="active" class="nav-item disabled">REVIEW</a>
          <a routerLink="/calibrate" routerLinkActive="active" class="nav-item">CALIBRATE</a>
          <a routerLink="/settings" routerLinkActive="active" class="nav-item">SETTINGS</a>
        </div>
        <div class="status-indicator">Ready</div>
      </header>

      <div class="workspace">
        <!-- Model selection entry -->
        <aside class="icon-sidebar">
          <a routerLink="/settings" class="model-button">Model</a>
        </aside>

        <!-- Center Area -->
        <main class="center-area">
          <div class="info-bar">
            <div class="info-item">
              <div class="info-label">MODEL :</div>
              <div class="info-value">{{ modelName || '—' }}</div>
            </div>
            <div class="info-item">
              <div class="info-label">LOT :</div>
              <div class="info-value">TEST</div>
            </div>
          </div>
          
          <div class="image-view">
            <!-- Main Image Mock -->
            <div class="main-image">
              <div class="strip-mock">
                <div class="strip-section">
                  <div class="pcb-dots"></div>
                </div>
                <div class="strip-section">
                  <div class="pcb-dots"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="status-bar">
            <span>CELL : 0</span>
            <div class="spacer"></div>
            <span>STRIP : 3659, 8309</span>
            <span>WH : 16384, 28672</span>
            <span>XY : 3659, 8309</span>
            <span>RGB : 22, 22, 22</span>
            <span>Avg. GV : 0</span>
            <span>Std. GV : 0.00</span>
          </div>

          <div class="log-panel">
            <div>2026-09-22 17:37:29 [Camera] Current Task Size=0</div>
            <div>2026-09-22 17:37:29 Defect Count [Total]: 77, [Light1]: 0, [Light2]: 15, [Light3]: 62</div>
            <div>2026-09-22 19:34:49 KeepAlive IP:192.168.200.13, PORT2000</div>
            <div>2026-09-22 19:34:49 KeepAlive IP:192.168.200.12, PORT2000</div>
            <div>2026-09-22 19:34:49 KeepAlive IP:192.168.200.11, PORT2000</div>
          </div>
        </main>

        <!-- Right Panel (Router Outlet) -->
        <aside class="right-panel">
          <router-outlet></router-outlet>
        </aside>
      </div>
    </div>
  `,
  styles: [`
    .afvi-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      background-color: #2b2b2b;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    /* Top Navigation */
    .top-nav {
      display: flex;
      height: 40px;
      background-color: #333;
      border-bottom: 1px solid #111;
    }
    .nav-links {
      display: flex;
      flex: 1;
    }
    .nav-item {
      width: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #aaa;
      text-decoration: none;
      font-size: 14px;
      font-weight: bold;
      border-right: 1px solid #222;
      background-color: #3a3a3a;
    }
    .nav-item.active {
      background-color: #0088cc;
      color: white;
    }
    .nav-item.disabled {
      pointer-events: none;
      opacity: 0.5;
    }
    .status-indicator {
      min-width: 180px;
      width: 22%;
      background-color: #8cc63f;
      color: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
    }

    /* Workspace */
    .workspace {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* Icon Sidebar */
    .icon-sidebar {
      width: 62px;
      background-color: #222;
      display: flex;
      flex-direction: column;
      align-items: center;
      border-right: 1px solid #111;
    }
    .model-button {
      align-items: center;
      background: #343434;
      border-bottom: 1px solid #111;
      color: #ddd;
      display: flex;
      justify-content: center;
      min-height: 52px;
      cursor: pointer;
      font-weight: bold;
      font-size: 11px;
      text-decoration: none;
    }
    .model-button:hover { background-color: #087fc1; color: white; }
    .spacer { flex: 1; }

    /* Center Area */
    .center-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background-color: #1e1e1e;
    }
    .info-bar {
      display: flex;
      background-color: #333;
      padding: 5px 15px;
      border-bottom: 1px solid #111;
      align-items: center;
    }
    .info-item {
      margin-right: 30px;
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 10px;
      color: #888;
    }
    .info-value {
      font-size: 14px;
      color: #8cc63f;
      font-weight: bold;
    }

    .image-view {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .main-image {
      flex: 1;
      background-color: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      overflow: auto;
    }
    .strip-mock {
      width: min(360px, 45%);
      height: 78%;
      background-color: #1a1a1a;
      border: 1px solid #333;
      display: flex;
      flex-direction: column;
    }
    .strip-section {
      flex: 1;
      border-bottom: 1px solid #333;
      position: relative;
    }
    .pcb-dots {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 100px; height: 100px;
      background-image: radial-gradient(#fff 1px, transparent 1px);
      background-size: 10px 10px;
      opacity: 0.3;
    }

    .status-bar {
      display: flex;
      background-color: #222;
      padding: 5px 15px;
      font-size: 11px;
      color: #aaa;
      border-top: 1px solid #111;
      gap: 20px;
    }
    .log-panel {
      height: 120px;
      background-color: #2b2b2b;
      color: #ccc;
      font-family: monospace;
      font-size: 11px;
      padding: 5px 10px;
      overflow-y: auto;
      border-top: 1px solid #111;
      line-height: 1.4;
    }

    /* Right Panel */
    .right-panel {
      width: clamp(440px, 29vw, 560px);
      min-width: 440px;
      background-color: #2b2b2b;
      border-left: 1px solid #111;
      display: flex;
      flex-direction: column;
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  modelName = '';
  private selectionSub?: Subscription;

  constructor(private readonly appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    // The MODEL readout follows the active model selection (Settings → Data Collection).
    this.selectionSub = this.appService.activeSelectionChanged$.subscribe((selection) => {
      this.modelName = selection?.modelName ?? '';
      this.cdr.markForCheck();
    });
    void this.loadModelName();
  }

  ngOnDestroy(): void {
    this.selectionSub?.unsubscribe();
  }

  private async loadModelName(): Promise<void> {
    const active = await this.appService.getActiveSelection();
    this.modelName = active?.modelName ?? '';
    this.cdr.markForCheck();
  }
}
