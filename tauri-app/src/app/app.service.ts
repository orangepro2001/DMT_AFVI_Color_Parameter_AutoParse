import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { XMLParser } from 'fast-xml-parser';
import { HostAlignment, InspectionGroup, InspectionParameter } from './spec-model';
import { createDocumentStore, DocumentStoreClient } from './document-store';

export type HostId = 'FM1' | 'FM2' | 'BM';

export interface Machine {
  id: string;
  name: string;
  fm1_path: string;
  fm2_path: string;
  bm_path: string;
}

export interface ModelCandidate {
  name: string;
  hosts: HostId[];
}

export interface HostSources {
  model_name: string;
  host: HostId;
  side: 'TOP' | 'BOTTOM';
  light_spec_xml: string;
  inspection_specs: Array<{ light: string; xml: string }>;
  spec_parameter_xml?: string;
  spec_tree_node_xml?: string;
}

export interface TeachSelection {
  host: HostId;
  light: number;
  group: string;
  parent: string;
  node: string;
  color: string;
}

// GV brightness targets are measured and typed by the user; no config file carries them.
export interface GvValueSet {
  Red: string;
  Green: string;
  Blue: string;
}

// host -> pageIndex (0-based) -> row label (AU/OSP/SR/Space) -> per-camera-colour value.
export type GvValues = Record<string, Record<string, Record<string, GvValueSet>>>;

export interface StoredModelRecord {
  schemaVersion: 2;
  machine: Pick<Machine, 'id' | 'name'>;
  modelName: string;
  collectedAt: string;
  hosts: Record<HostId, StoredHostRecord>;
}

export interface StoredHostRecord {
  rootPath: string;
  side: 'TOP' | 'BOTTOM';
  lightSpec: unknown;
  alignment: HostAlignment;
  parameterDictionary: Record<string, string>;
  treeDictionary: { gp: Record<string, string>; p: Record<string, string>; c: Record<string, string> };
  inspectionSpecs: Record<string, { groups: InspectionGroup[] }>;
}

interface NodeInfo {
  name: string;
  color: string;
}

interface NodeDictionaries {
  gp: Record<string, NodeInfo>;
  p: Record<string, NodeInfo>;
  c: Record<string, NodeInfo>;
}

@Injectable({ providedIn: 'root' })
export class AppService {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['Page', 'Channel', 'MASTER', 'SUBMASTER', 'INSPECTION', 'string', 'node'].includes(name)
  });

  // All persistence goes through the document-store seam (default: local JSON
  // document database; MongoDB later only swaps this client).
  private readonly documents: DocumentStoreClient = createDocumentStore();
  private readonly modelCache = new Map<string, StoredModelRecord>();
  private teachSelectionState: TeachSelection | null = null;

  async getMachines(): Promise<Machine[]> {
    try {
      const data = await this.documents.read('machines.json');
      return data ? JSON.parse(data) as Machine[] : [];
    } catch {
      return [];
    }
  }

  async saveMachines(machines: Machine[]): Promise<void> {
    await this.documents.write('machines.json', JSON.stringify(machines, null, 2));
  }

  getHostPath(machine: Machine, host: HostId): string {
    return machine[`${host.toLowerCase()}_path` as keyof Machine] as string;
  }

  async scanModels(machine: Machine): Promise<ModelCandidate[]> {
    return invoke<ModelCandidate[]>('scan_machine_models', { machine });
  }

  async collectAndPersist(machine: Machine, modelName: string): Promise<StoredModelRecord> {
    const sources = await invoke<HostSources[]>('collect_machine_sources', { machine, modelName });
    if (sources.length !== 3) {
      throw new Error('All FM1, FM2, and BM sources must be collected together.');
    }
    // The dictionaries live in every PxInventory root; FM1's copy stands for all hosts.
    const parameterDictionary = this.parseStringDictionary(sources[0].spec_parameter_xml);
    const nodeDictionaries = this.parseNodeDictionaries(sources[0].spec_tree_node_xml);
    const treeDictionary = Object.fromEntries((['gp', 'p', 'c'] as const).map(level => [level,
      Object.fromEntries(Object.entries(nodeDictionaries[level]).map(([id, info]) => [id, info.name]))]));
    const record: StoredModelRecord = {
      schemaVersion: 2,
      machine: { id: machine.id, name: machine.name },
      modelName: sources[0].model_name,
      collectedAt: new Date().toISOString(),
      hosts: Object.fromEntries(sources.map((source) => {
        const lightSpec = this.parser.parse(source.light_spec_xml);
        return [source.host, {
          rootPath: this.getHostPath(machine, source.host),
          side: source.side,
          lightSpec,
          alignment: this.buildAlignment(lightSpec),
          parameterDictionary,
          treeDictionary,
          inspectionSpecs: Object.fromEntries(source.inspection_specs.map(({ light, xml }) =>
            [light, { groups: this.buildInspectionGroups(xml, parameterDictionary, nodeDictionaries) }]))
        }];
      })) as Record<HostId, StoredHostRecord>
    };
    await this.saveModelData(machine.id, record.modelName, record);
    await this.saveActiveSelection({ machineId: machine.id, modelName: record.modelName });
    return record;
  }

  async getModelData(machineId: string, modelName: string, force = false): Promise<StoredModelRecord | null> {
    const filename = this.modelFilename(machineId, modelName);
    if (!force) {
      const cached = this.modelCache.get(filename);
      if (cached) return cached;
    } else {
      this.modelCache.delete(filename);
    }
    // #region debug-point B:local-read-start
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'pre-fix', hypothesisId: 'B', location: 'app.service.ts:getModelData', msg: '[DEBUG] Local model read started', data: { filename }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    try {
      const data = await this.documents.read(filename);
      // #region debug-point B:local-read-complete
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'pre-fix', hypothesisId: 'B', location: 'app.service.ts:getModelData', msg: '[DEBUG] Local model read completed', data: { filename, bytes: data?.length ?? 0 }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      if (!data) return null;
      const record = JSON.parse(data) as StoredModelRecord;
      this.modelCache.set(filename, record);
      return record;
    } catch {
      // #region debug-point B:local-read-failed
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'pre-fix', hypothesisId: 'B', location: 'app.service.ts:getModelData', msg: '[DEBUG] Local model read failed', data: { filename }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      return null;
    }
  }

  async saveModelData(machineId: string, modelName: string, data: StoredModelRecord): Promise<void> {
    const filename = this.modelFilename(machineId, modelName);
    const content = JSON.stringify(data);
    // #region debug-point D:persist-start
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'pre-fix', hypothesisId: 'D', location: 'app.service.ts:saveModelData', msg: '[DEBUG] Local model save started', data: { filename, bytes: content.length }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    await this.documents.write(filename, content);
    // #region debug-point D:persist-complete
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'db-read-latency', runId: 'pre-fix', hypothesisId: 'D', location: 'app.service.ts:saveModelData', msg: '[DEBUG] Local model save completed', data: { filename }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    this.modelCache.set(filename, data);
  }

  async getActiveSelection(): Promise<{ machineId: string; modelName: string } | null> {
    try {
      const data = await this.documents.read('ui/active-selection.json');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async saveActiveSelection(selection: { machineId: string; modelName: string }): Promise<void> {
    await this.documents.write('ui/active-selection.json', JSON.stringify(selection));
  }

  get teachSelection(): TeachSelection | null {
    return this.teachSelectionState;
  }

  set teachSelection(value: TeachSelection | null) {
    this.teachSelectionState = value;
    if (value) {
      this.documents.write('ui/teach-selection.json', JSON.stringify(value)).catch(() => {});
    }
  }

  async getTeachSelection(): Promise<TeachSelection | null> {
    if (this.teachSelectionState) return this.teachSelectionState;
    try {
      const data = await this.documents.read('ui/teach-selection.json');
      this.teachSelectionState = data ? JSON.parse(data) as TeachSelection : null;
    } catch {
      this.teachSelectionState = null;
    }
    return this.teachSelectionState;
  }

  async getGvValues(machineId: string, modelName: string): Promise<GvValues> {
    try {
      const data = await this.documents.read(this.gvFilename(machineId, modelName));
      return data ? JSON.parse(data) as GvValues : {};
    } catch {
      return {};
    }
  }

  async saveGvValues(machineId: string, modelName: string, values: GvValues): Promise<void> {
    await this.documents.write(this.gvFilename(machineId, modelName), JSON.stringify(values));
  }

  getLightChannels(record: StoredModelRecord, host: HostId, pageIndex: number): Array<{ index: number; value: number; angle: number; color: string; enable: boolean }> {
    const lightSet = (record.hosts[host]?.lightSpec as any)?.pixel?.Light_Setting?.LightSet;
    const pages = Array.isArray(lightSet?.Page) ? lightSet.Page : [];
    const page = pages[pageIndex] ?? pages.find((item: any) => Number(item?.['@_Index']) === pageIndex);
    const channels = Array.isArray(page?.Channel) ? page.Channel : [];
    const colors: Record<string, string> = { W: 'White', B: 'Blue', G: 'Green', R: 'Red' };
    return channels.map((channel: Record<string, string>, index: number) => ({
      index: Number(channel['@_Index'] ?? index) + 1,
      value: Number(channel['@_Value'] ?? 0),
      angle: Number(channel['@_Angle'] ?? 0),
      color: colors[channel['@_Color']] ?? channel['@_Color'] ?? '',
      enable: channel['@_Enable'] === '1'
    }));
  }

  // SpecParameter.xml packs one <stringpack> per language. The dictionary must join every
  // pack (English first, so its text wins) instead of reading the first element only.
  private parseStringDictionary(xml?: string): Record<string, string> {
    if (!xml) return {};
    const packs = this.asArray<Record<string, unknown>>(this.parser.parse(xml)?.pixel?.stringpack);
    const englishFirst = [...packs].sort((a, b) =>
      Number(/english/i.test(String(b?.['@_LangName'] ?? ''))) - Number(/english/i.test(String(a?.['@_LangName'] ?? ''))));
    const dictionary: Record<string, string> = {};
    for (const pack of englishFirst) {
      for (const item of this.asArray<Record<string, string>>(pack?.['string'] as Record<string, string>)) {
        const key = item?.['@_ParamKey'];
        if (key !== undefined && dictionary[key] === undefined) dictionary[key] = item?.['@_Text'] ?? '';
      }
    }
    return dictionary;
  }

  private parseNodeDictionaries(xml?: string): NodeDictionaries {
    const pixel = xml ? this.parser.parse(xml)?.pixel ?? {} : {};
    const read = (group: unknown): Record<string, NodeInfo> => Object.fromEntries(
      this.asArray<Record<string, unknown>>(group as Record<string, unknown>).flatMap((entry) =>
        this.asArray<Record<string, string>>(entry?.['node'] as Record<string, string>).map((node) =>
          [String(node?.['@_ID']), { name: String(node?.['@_Name'] ?? ''), color: String(node?.['@_Color'] ?? '') }])));
    return { gp: read(pixel?.gpnode), p: read(pixel?.pnode), c: read(pixel?.cnode) };
  }

  private buildAlignment(lightSpec: unknown): HostAlignment {
    const lightSet = (lightSpec as any)?.pixel?.Light_Setting?.LightSet;
    const pages = this.asArray(lightSet?.Page);
    const lightCount = Math.max(pages.length, 1);
    const global = Array.from({ length: lightCount }, (_, index) => ({ light: index + 1, channel: 'Red' }));
    return { global, sr: [{ light: lightCount, channel: 'Red' }] };
  }

  private buildInspectionGroups(xml: string, parameterDictionary: Record<string, string>, nodes: NodeDictionaries): InspectionGroup[] {
    const pixel = this.parser.parse(xml)?.pixel ?? {};
    return this.asArray(pixel.GPNODE).map((gpnode: Record<string, any>) => {
      const gpInfo = nodes.gp[gpnode['@_ID']];
      return {
        id: String(gpnode['@_ID']),
        name: gpInfo?.name || `G${gpnode['@_ID']}`,
        color: gpInfo?.color ?? '',
        parents: this.asArray(gpnode['PNODE']).map((pnode: Record<string, any>) => {
          const pnInfo = nodes.p[pnode['@_ID']];
          return {
            id: String(pnode['@_ID']),
            name: pnInfo?.name || `P${pnode['@_ID']}`,
            color: pnInfo?.color ?? '',
            checked: pnode['@_NodeCheck'] === '1',
            children: this.asArray(pnode['CNODE']).map((cnode: Record<string, any>) => {
              const cnInfo = nodes.c[cnode['@_ID']];
              return {
                id: String(cnode['@_ID']),
                name: cnInfo?.name || `C${cnode['@_ID']}`,
                color: cnInfo?.color ?? '',
                checked: cnode['@_NodeCheck'] === '1',
                parameters: this.buildParameters(cnode, parameterDictionary)
              };
            })
          };
        })
      };
    });
  }

  private buildParameters(cnode: Record<string, any>, parameterDictionary: Record<string, string>): InspectionParameter[] {
    const parameters: InspectionParameter[] = [];
    for (const kind of ['MASTER', 'SUBMASTER', 'INSPECTION'] as const) {
      for (const item of this.asArray(cnode[kind]) as Array<Record<string, string>>) {
        const key = String(item?.['@_ParamKey'] ?? '');
        parameters.push({
          kind,
          key,
          name: parameterDictionary[key] ?? '',
          controlType: Number(item?.['@_ControlType'] ?? 0),
          specGroup: Number(item?.['@_SpecGroup'] ?? 0),
          values: Object.fromEntries(Object.entries(item ?? {})
            .filter(([attribute]) => /^@_(Val|MinVal|MaxVal)/.test(attribute))
            .map(([attribute, value]) => [attribute.slice(2), String(value)]))
        });
      }
    }
    return parameters;
  }

  private modelFilename(machineId: string, modelName: string): string {
    const safe = modelName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `models/${machineId}/${safe}.json`;
  }

  private gvFilename(machineId: string, modelName: string): string {
    const safe = modelName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `ui/gv/${machineId}/${safe}.json`;
  }

  private asArray<T>(value: T | T[] | undefined | null): T[] {
    return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  }
}
