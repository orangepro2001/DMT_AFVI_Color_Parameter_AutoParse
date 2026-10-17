// Tree model of one InspectionSpec.xml, resolved against SpecTreeNode.xml / SpecParameter.xml.
export type ParameterKind = 'MASTER' | 'SUBMASTER' | 'INSPECTION';

export interface InspectionParameter {
  kind: ParameterKind;
  key: string;
  name: string;
  controlType: number;
  specGroup: number;
  values: Record<string, string>;
}

export interface InspectionNode {
  id: string;
  name: string;
  color: string;
  checked: boolean;
  parameters: InspectionParameter[];
}

export interface InspectionParent {
  id: string;
  name: string;
  color: string;
  checked: boolean;
  children: InspectionNode[];
}

export interface InspectionGroup {
  id: string;
  name: string;
  color: string;
  parents: InspectionParent[];
}

export interface AlignRow {
  light: number;
  channel: string;
}

export interface HostAlignment {
  global: AlignRow[];
  sr: AlignRow[];
}
