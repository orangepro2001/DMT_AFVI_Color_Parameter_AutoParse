import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppService, HostId, Machine, StoredModelRecord } from './app.service';
import { InspectionGroup, InspectionParent, InspectionNode, InspectionParameter } from './spec-model';
import { ParamDisplayRow, ParamTableComponent, ParamValueChange } from './param-table.component';

type ValueField = 'Val' | 'ValR' | 'ValG' | 'ValB';
interface DisplayRow extends ParamDisplayRow {
  parameter: InspectionParameter;
  field: ValueField;
}
interface LocalEdits {
  dirty: boolean;
  saving: boolean;
  invalid: Set<ParamDisplayRow>;
  rows: WeakMap<InspectionParameter, Map<ValueField, DisplayRow>>;
}
// Metadata follows the service's cached snapshot across route destruction.
// Actual edits live on that snapshot, never in a flattened node-ID map.
const localEdits = new WeakMap<StoredModelRecord, LocalEdits>();

@Component({
  selector: 'app-parameter-config',
  standalone: true,
  imports: [CommonModule, FormsModule, ParamTableComponent],
  templateUrl: './parameter-config.component.html',
  styleUrl: './parameter-config.component.css'
})
export class ParameterConfigComponent implements OnInit, OnDestroy {
  selectedMachine?: Machine;
  selectedHost: HostId = 'FM1';
  machineId = '';
  modelName = '';
  record: StoredModelRecord | null = null;
  activeLight = 0;
  activeColor = 'Green';
  readonly colors = ['Red', 'Green', 'Blue'];
  readonly overlays = ['MK', 'A_C', 'I_C', 'SK'].map(name => ({ name, checked: false }));
  groups: InspectionGroup[] = [];
  activeGroup?: InspectionGroup;
  selectedParent?: InspectionParent;
  selectedNode?: InspectionNode;
  masterRows: DisplayRow[] = [];
  submasterRows: DisplayRow[] = [];
  inspectionRows: DisplayRow[] = [];
  edits?: LocalEdits;
  loading = false;
  confirmReload = false;
  error = '';
  message = '';
  private destroyed = false;

  constructor(private readonly appService: AppService, private readonly cdr: ChangeDetectorRef) {}

  get busy(): boolean { return this.loading || !!this.edits?.saving; }
  get dirty(): boolean { return !!this.edits?.dirty || this.hasInvalid; }
  get hasInvalid(): boolean { return !!this.edits?.invalid.size; }
  get alignment() { return this.record?.hosts[this.selectedHost]?.alignment; }
  get groupTabs() {
    const tabs = ['Unit', 'Dummy'].map((name, index) => {
      const group = this.groups.find(item => item.name.toLowerCase() === name.toLowerCase())
        ?? this.groups.find(item => item.id === String(index + 1));
      return { id: group?.id ?? `missing-${name}`, name, group };
    });
    return [...tabs, ...this.groups.filter(group => !tabs.some(tab => tab.group === group))
      .map(group => ({ id: group.id, name: group.name, group }))];
  }
  get selectionLabel(): string {
    return [this.activeGroup?.name, this.selectedParent?.name, this.selectedNode?.name].filter(Boolean).join(' / ') || 'No node selected';
  }
  // Records collected before schemaVersion 2 hold a flat parameter list without the node tree.
  get legacyRecord(): boolean {
    const specs = this.record?.hosts?.[this.selectedHost]?.inspectionSpecs;
    if (!specs) return false;
    const values = Object.values(specs) as unknown[];
    return values.length > 0 && !values.some(spec => !!spec && typeof spec === 'object' && 'groups' in spec);
  }
  get tableEmptyText(): string {
    return this.selectedNode ? 'No parameters for this node.' : 'Select a child node.';
  }
  get submasterEmptyText(): string {
    if (!this.selectedNode) return this.tableEmptyText;
    return this.selectedNode.parameters.some(item => item.kind === 'SUBMASTER')
      ? 'Enable the matching Chain switch in Master.' : 'No Submaster parameters.';
  }

  async ngOnInit(): Promise<void> {
    this.loading = true;
    try {
      const [machines, active] = await Promise.all([this.appService.getMachines(), this.appService.getActiveSelection()]);
      if (this.destroyed) return;
      this.machineId = active?.machineId ?? '';
      this.modelName = active?.modelName ?? '';
      this.selectedMachine = machines.find(machine => machine.id === this.machineId);
      const selection = await this.appService.getTeachSelection();
      if (selection) {
        this.selectedHost = ['FM1', 'FM2', 'BM'].includes(selection.host) ? selection.host : 'FM1';
        this.activeLight = [0, 1, 2].includes(selection.light) ? selection.light : 0;
        this.activeColor = this.colors.includes(selection.color) ? selection.color : 'Green';
      }
      const record = active ? await this.appService.getModelData(active.machineId, active.modelName) : null;
      if (!this.destroyed) this.attachRecord(record);
    } catch (error) {
      this.error = this.errorText(error);
    } finally {
      this.loading = false;
      this.detectChanges();
    }
  }

  ngOnDestroy(): void { this.destroyed = true; }

  selectHost(host: HostId): void {
    this.selectedHost = host;
    this.resolveSelection();
  }

  selectLight(light: number): void {
    this.activeLight = light;
    this.resolveSelection();
  }

  selectColor(color: string): void {
    this.activeColor = color;
    this.rememberSelection();
    this.refreshRows();
  }

  selectGroup(group?: InspectionGroup): void {
    if (group) this.resolveSelection(group.id);
  }

  selectParent(parent: InspectionParent): void {
    this.selectedParent = parent;
    // A parent has no parameters of its own. Never combine its children.
    this.selectedNode = undefined;
    this.rememberSelection();
    this.refreshRows();
  }

  selectNode(parent: InspectionParent, node: InspectionNode): void {
    this.selectedParent = parent;
    this.selectedNode = node;
    this.rememberSelection();
    this.refreshRows();
  }

  setChecked(target: InspectionParent | InspectionNode, event: Event): void {
    if (this.busy) return;
    target.checked = (event.target as HTMLInputElement).checked;
    this.markDirty();
  }

  // The Align / ROI subtree is fixed by the machine and shows no checkboxes.
  checkable(parent: InspectionParent): boolean {
    return parent.id !== '1';
  }

  changeValue(change: ParamValueChange): void {
    if (this.busy) return;
    const row = change.row as DisplayRow;
    // Original object + channel, not a globally ambiguous node ID or ParamKey.
    if (!row.parameter || row.disabled) return;
    const previous = row.parameter.values[row.field];
    row.value = change.value;
    if (row.enabled !== undefined) row.enabled = Number(change.value) !== 0;
    if (previous !== change.value && Number(previous) !== Number(change.value)) {
      row.parameter.values[row.field] = change.value;
      this.markDirty();
    }
    if (row.parameter.kind === 'MASTER' && ['103', '104'].includes(row.parameter.key)) this.refreshRows();
  }

  setInvalid(change: { row: ParamDisplayRow; invalid: boolean }): void {
    if (change.invalid) this.edits?.invalid.add(change.row);
    else this.edits?.invalid.delete(change.row);
  }

  async saveLocal(): Promise<void> {
    if (!this.record || !this.edits || this.busy || this.hasInvalid || !this.dirty) return;
    const record = this.record;
    const edits = this.edits;
    edits.saving = true;
    this.error = '';
    this.message = '';
    try {
      await this.appService.saveModelData(this.machineId, this.modelName, record);
      edits.dirty = false;
      this.message = 'Saved local snapshot. Production files are unchanged.';
    } catch (error) {
      this.error = `Save Local failed: ${this.errorText(error)} Your edits are retained.`;
    } finally {
      edits.saving = false;
      this.detectChanges();
    }
  }

  requestReload(): void {
    if (this.dirty) this.confirmReload = true;
    else void this.reloadLocal();
  }

  async reloadLocal(): Promise<void> {
    if (!this.machineId || this.busy) return;
    this.loading = true;
    this.error = '';
    this.message = '';
    try {
      const record = await this.appService.getModelData(this.machineId, this.modelName, true);
      if (!record) throw new Error('Local snapshot was not found.');
      if (!this.destroyed) {
        localEdits.delete(record);
        this.attachRecord(record);
        this.confirmReload = false;
        this.message = 'Reloaded local snapshot. Production files were not accessed.';
      }
    } catch (error) {
      this.error = `Reload failed: ${this.errorText(error)} Current edits are retained.`;
    } finally {
      this.loading = false;
      this.detectChanges();
    }
  }

  nodeColor(color: string): string {
    const parts = color.split(',').map(part => Number(part.trim()));
    if (parts.length === 3 && parts.every(part => Number.isFinite(part) && part >= 0 && part <= 255)) return `rgb(${parts.join(',')})`;
    return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color) || /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(color) ? color : '#c0c0c0';
  }

  nodeTextColor(color: string): string {
    const normalized = this.nodeColor(color);
    let rgb = normalized.match(/\d+/g)?.map(Number) ?? [];
    if (normalized.startsWith('#')) {
      let hex = normalized.slice(1);
      if (hex.length === 3) hex = hex.split('').map(value => value + value).join('');
      rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
    }
    const linear = rgb.map(value => value / 255 <= .04045 ? value / 255 / 12.92 : ((value / 255 + .055) / 1.055) ** 2.4);
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2] > .2 ? '#111111' : '#ffffff';
  }

  private attachRecord(record: StoredModelRecord | null): void {
    this.record = record;
    if (record) {
      this.edits = localEdits.get(record) ?? { dirty: false, saving: false, invalid: new Set(), rows: new WeakMap() };
      localEdits.set(record, this.edits);
    } else this.edits = undefined;
    this.resolveSelection();
  }

  private resolveSelection(groupId?: string): void {
    const saved = this.appService.teachSelection;
    this.groups = this.record?.hosts[this.selectedHost]?.inspectionSpecs[`LIGHT${this.activeLight}`]?.groups ?? [];
    this.activeGroup = this.groups.find(group => group.id === (groupId ?? saved?.group))
      ?? this.groups.find(group => group.name.toLowerCase() === 'unit' && group.parents.some(parent => parent.children.some(node => node.parameters.length)))
      ?? this.groups.find(group => group.parents.some(parent => parent.children.some(node => node.parameters.length)))
      ?? this.groups[0];
    const parents = this.activeGroup?.parents ?? [];
    // Restore only the complete path. ID 20 under AU never resolves to OSP ID 20.
    const sameGroup = this.activeGroup?.id === saved?.group || groupId !== undefined;
    const parent = sameGroup ? parents.find(item => item.id === saved?.parent) : undefined;
    const node = parent?.children.find(item => item.id === saved?.node);
    if (parent && (node || saved?.node === '')) {
      this.selectedParent = parent;
      this.selectedNode = node;
    } else {
      const au = parents.find(item => item.name.toUpperCase() === 'AU');
      const cPad = au?.children.find(item => /^c[-\s]?pad$/i.test(item.name) && item.parameters.length);
      this.selectedParent = cPad ? au : parent?.children.some(item => item.parameters.length) ? parent
        : parents.find(item => item.children.some(child => child.parameters.length)) ?? parents[0];
      this.selectedNode = cPad ?? this.selectedParent?.children.find(item => item.parameters.length) ?? this.selectedParent?.children[0];
    }
    this.rememberSelection();
    this.refreshRows();
  }

  private rememberSelection(): void {
    this.appService.teachSelection = {
      host: this.selectedHost, light: this.activeLight, group: this.activeGroup?.id ?? '',
      parent: this.selectedParent?.id ?? '', node: this.selectedNode?.id ?? '', color: this.activeColor
    };
  }

  private refreshRows(): void {
    const parameters = this.selectedNode?.parameters ?? [];
    const toRows = (kind: InspectionParameter['kind']) => parameters
      .filter(item => item.kind === kind && !(kind === 'MASTER' && item.key === '100'))
      .filter(item => kind !== 'SUBMASTER' || this.submasterVisible(item, parameters))
      .map(item => this.displayRow(item));
    this.masterRows = toRows('MASTER');
    this.submasterRows = toRows('SUBMASTER');
    this.inspectionRows = toRows('INSPECTION');
    this.detectChanges();
  }

  private submasterVisible(parameter: InspectionParameter, parameters: InspectionParameter[]): boolean {
    const key = parameter.specGroup === 3 ? '103' : parameter.specGroup === 4 ? '104' : undefined;
    const gates = parameters.filter(item => item.kind === 'MASTER' && item.controlType === 1
      && (key ? item.key === key : ['103', '104'].includes(item.key)));
    return !gates.length || gates.some(item => Number(item.values['Val']) !== 0 && Number.isFinite(Number(item.values['Val'])));
  }

  private displayRow(parameter: InspectionParameter): DisplayRow {
    const channel: Record<string, ValueField> = { Red: 'ValR', Green: 'ValG', Blue: 'ValB' };
    const field = parameter.kind === 'INSPECTION' ? channel[this.activeColor] ?? 'ValG' : 'Val';
    let rows = this.edits?.rows.get(parameter);
    if (!rows) {
      rows = new Map();
      this.edits?.rows.set(parameter, rows);
    }
    const raw = parameter.values[field];
    const numeric = raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw));
    const row: DisplayRow = rows.get(field) ?? {
      key: parameter.key, name: '', value: '', color: '', parameter, field
    };
    // Dictionary text first; the collected name is the same lookup, Param <key> is the last resort.
    row.name = this.record?.hosts[this.selectedHost]?.parameterDictionary[parameter.key]
      || parameter.name || `Param ${parameter.key}`;
    row.color = parameter.kind === 'INSPECTION' ? '#00ff00' : parameter.kind === 'SUBMASTER' ? '#ffff00' : '#dddddd';
    row.value = numeric ? Number(raw).toFixed(3) : raw ?? '';
    const minKey = field === 'Val' ? 'MinVal' : `MinVal${field.slice(3)}`;
    const minRaw = parameter.values[minKey];
    row.min = minRaw !== undefined && minRaw.trim() !== '' && Number.isFinite(Number(minRaw)) ? Number(minRaw).toFixed(2) : '';
    row.enabled = parameter.controlType === 1 ? numeric && Number(raw) !== 0 : undefined;
    row.disabled = !numeric || ![0, 1].includes(parameter.controlType);
    rows.set(field, row);
    return row;
  }

  private markDirty(): void {
    if (this.edits) this.edits.dirty = true;
    this.message = '';
    this.confirmReload = false;
  }

  private errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  private detectChanges(): void { if (!this.destroyed) this.cdr.markForCheck(); }
}
