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
  deviceId?: string | null;
  disabledBy?: string | null;
  displayName: string;
  entityId: string;
  isStale: boolean;
  name?: string | null;
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

export type FixActionKind = 'rename_duplicate_name' | 'review_stale_entity';

export type FixRisk = 'low' | 'medium' | 'high';

export type FixTargetKind = 'entity' | 'device' | 'entity_registry';

export type FixTarget = {
  id: string;
  kind: FixTargetKind;
  label: string;
};

export type FixCommand = {
  id: string;
  summary: string;
  targetId: string;
  transport: 'websocket';
  payload: {
    disabled_by?: string | null;
    entity_id: string;
    name?: string;
    type: 'config/entity_registry/update';
  };
};

export type FixRequiredInput = {
  currentValue: string | null;
  field: 'name';
  id: string;
  providedValue?: string;
  recommendedValue?: string;
  summary: string;
  targetId: string;
};

export type FixArtifactKind = 'text_diff' | 'yaml_diff';

export type FixArtifact = {
  content: string;
  id: string;
  kind: FixArtifactKind;
  label: string;
};

export type FixAction = {
  artifacts: FixArtifact[];
  commands: FixCommand[];
  findingId: string;
  id: string;
  intent: string;
  kind: FixActionKind;
  rationale: string;
  requiredInputs: FixRequiredInput[];
  requiresConfirmation: boolean;
  risk: FixRisk;
  steps: string[];
  targets: FixTarget[];
  title: string;
  warnings: string[];
};

export type FixPreviewInput = {
  field: 'name';
  findingId: string;
  targetId: string;
  value: string;
};

export type FindingAdvisory = {
  findingId: string;
  id: string;
  rationale: string;
  steps: string[];
  summary: string;
  targets: FixTarget[];
  title: string;
  warnings: string[];
};

export type FindingTreatment = 'actionable' | 'advisory';

export type FixPreviewRequest = {
  findingIds?: string[];
  inputs?: FixPreviewInput[];
  scanId: string;
};

export type FixQueueStatus = 'pending_review' | 'dry_run_applied';

export type FixQueueEntry = {
  createdAt: string;
  id: string;
  lastAppliedAt?: string;
  status: FixQueueStatus;
};

export type FixSelection = {
  actionIds: string[];
  findingIds: string[];
};

export type FixPreviewResponse = {
  actions: FixAction[];
  advisories: FindingAdvisory[];
  generatedAt: string;
  previewToken: string;
  queue: FixQueueEntry;
  scanId: string;
  selection: FixSelection;
};

export type FixApplyRequest = {
  actionIds: string[];
  dryRun?: boolean;
  previewToken: string;
  scanId: string;
};

export type FixApplyResponse = {
  actions: FixAction[];
  appliedCount: number;
  mode: 'dry_run';
  previewToken: string;
  queue: FixQueueEntry;
  scanId: string;
  selection: FixSelection;
};

export type WorkbenchEntryStatus =
  | 'recommended'
  | 'staged'
  | 'advisory'
  | 'dry_run_applied';

export type WorkbenchEntry = {
  findingId: string;
  savedInputs: FixPreviewInput[];
  status: WorkbenchEntryStatus;
  treatment: FindingTreatment;
  updatedAt?: string;
};

export type ScanWorkbench = {
  entries: WorkbenchEntry[];
  isPreviewStale: boolean;
  latestPreview?: FixPreviewResponse;
  latestPreviewToken?: string;
  latestQueue?: FixQueueEntry;
  scanId: string;
  stagedCount: number;
};

export type ScanWorkbenchResponse = {
  scan: ScanDetail;
  workbench: ScanWorkbench;
};

export type WorkbenchItemSaveRequest = {
  inputs?: FixPreviewInput[];
};

export type WorkbenchItemMutationResponse = {
  entry: WorkbenchEntry;
  workbench: ScanWorkbench;
};

export type WorkbenchItemDeleteResponse = {
  deleted: boolean;
  findingId: string;
  workbench: ScanWorkbench;
};

export type WorkbenchPreviewResponse = {
  preview: FixPreviewResponse;
  workbench: ScanWorkbench;
};

export type WorkbenchApplyRequest = {
  dryRun?: boolean;
};

export type WorkbenchApplyResponse = {
  apply: FixApplyResponse;
  workbench: ScanWorkbench;
};

export type ScanExportBundle = {
  actions: FixAction[];
  advisories: FindingAdvisory[];
  diffSummary: ScanDiffSummary;
  findings: Finding[];
  generatedAt: string;
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
