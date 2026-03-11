export type ProviderKind = 'none' | 'ollama' | 'openai';
export type SurfaceState = 'ready' | 'planned';
export type CapabilityStatus = 'supported' | 'unsupported';
export type FindingSeverity = 'low' | 'medium' | 'high';
export type FindingKind =
  | 'duplicate_name'
  | 'orphaned_entity_device'
  | 'stale_entity';

export type ConnectionProfile = {
  baseUrl: string;
  configPath?: string;
  name: string;
  token: string;
};

export type ConnectionResult = {
  capabilities: CapabilitySet;
  checkedAt: string;
  endpoint: string;
  latencyMs: number;
  mode: 'mock';
  ok: boolean;
};

export type ConnectionTestResponse = {
  result: ConnectionResult;
};

export type CapabilitySet = {
  entityRegistry: CapabilityStatus;
  exposureControl: CapabilityStatus;
  labels: CapabilityStatus;
  floors: CapabilityStatus;
};

export type InventoryEntity = {
  deviceId?: string;
  entityId: string;
  friendlyName: string;
  isStale: boolean;
};

export type InventoryDevice = {
  deviceId: string;
  name: string;
};

export type InventoryGraph = {
  devices: InventoryDevice[];
  entities: InventoryEntity[];
  source: 'mock';
};

export type Finding = {
  evidence: string;
  id: string;
  kind: FindingKind;
  objectIds: string[];
  severity: FindingSeverity;
  title: string;
};

export type ScanRun = {
  createdAt: string;
  findings: Finding[];
  id: string;
  inventory: InventoryGraph;
};

export type ScanCreateResponse = {
  scan: ScanRun;
};

export type ScanReadResponse = {
  scan: ScanRun;
};

export type ScanFindingsResponse = {
  findings: Finding[];
  scanId: string;
};

export type ScanHistoryEntry = {
  createdAt: string;
  findingsCount: number;
  id: string;
};

export type ScanHistoryResponse = {
  scans: ScanHistoryEntry[];
};

export type ApiErrorResponse = {
  error: string;
};

export type RuntimeSurface = {
  id: string;
  name: string;
  state: SurfaceState;
  summary: string;
};

export type FrameworkSummary = {
  priorities: string[];
  surfaces: RuntimeSurface[];
  tagline: string;
  title: string;
};

export type ProviderDescriptor = {
  description: string;
  id: ProviderKind;
  label: string;
};

export type FrameworkApiResponse = {
  framework: FrameworkSummary;
  providers: ProviderDescriptor[];
};

export type HealthResponse = {
  service: 'api';
  status: 'ok';
  timestamp: string;
};
