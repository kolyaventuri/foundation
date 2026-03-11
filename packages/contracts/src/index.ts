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

export type SavedConnectionProfile = {
  baseUrl: string;
  configPath?: string;
  createdAt: string;
  hasToken: boolean;
  isDefault: boolean;
  name: string;
  updatedAt: string;
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

export type ProfileListResponse = {
  profiles: SavedConnectionProfile[];
};

export type ProfileReadResponse = {
  profile: SavedConnectionProfile;
};

export type ProfileDeleteResponse = {
  deleted: boolean;
  name: string;
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
  profileName: string | null;
};

export type ScanDiffSummary = {
  previousScanId: string | null;
  regressedCount: number;
  regressedFindingIds: string[];
  resolvedCount: number;
  resolvedFindingIds: string[];
  unchangedCount: number;
  unchangedFindingIds: string[];
};

export type ScanDetail = ScanRun & {
  diffSummary: ScanDiffSummary;
};

export type ScanCreateRequest = {
  profileName?: string;
};

export type ScanCreateResponse = {
  scan: ScanDetail;
};

export type ScanReadResponse = {
  scan: ScanDetail;
};

export type ScanFindingsResponse = {
  findings: Finding[];
  scanId: string;
};

export type ScanHistoryEntry = {
  createdAt: string;
  findingsCount: number;
  id: string;
  profileName: string | null;
};

export type ScanHistoryResponse = {
  scans: ScanHistoryEntry[];
};

export type FixActionKind =
  | 'rename_duplicate_name'
  | 'repair_orphaned_entity_device'
  | 'review_stale_entity';

export type FixRisk = 'low' | 'medium' | 'high';

export type FixAction = {
  findingId: string;
  id: string;
  kind: FixActionKind;
  rationale: string;
  risk: FixRisk;
  steps: string[];
  title: string;
};

export type FixPreviewRequest = {
  findingIds?: string[];
  scanId: string;
};

export type FixPreviewResponse = {
  actions: FixAction[];
  scanId: string;
};

export type FixApplyRequest = FixPreviewRequest & {
  dryRun?: boolean;
};

export type FixApplyResponse = {
  actions: FixAction[];
  appliedCount: number;
  mode: 'dry_run';
  scanId: string;
};

export type ScanExportBundle = {
  diffSummary: ScanDiffSummary;
  findings: Finding[];
  scan: {
    createdAt: string;
    id: string;
    inventory: InventoryGraph;
    profileName: string | null;
  };
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
