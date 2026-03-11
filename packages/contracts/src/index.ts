export type ProviderKind = 'none' | 'ollama' | 'openai';
export type SurfaceState = 'ready' | 'planned';
export type ScanMode = 'mock' | 'live';
export type CapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'partial'
  | 'unknown';
export type FindingSeverity = 'low' | 'medium' | 'high';
export type FindingKind =
  | 'assistant_context_bloat'
  | 'automation_invalid_target'
  | 'dangling_label_reference'
  | 'duplicate_name'
  | 'missing_area_assignment'
  | 'missing_floor_assignment'
  | 'orphaned_entity_device'
  | 'scene_invalid_target'
  | 'stale_entity';
export type AssistantKind = 'assist' | 'alexa' | 'homekit';
export type ScanPassName =
  | 'connection'
  | 'inventory'
  | 'config'
  | 'rules'
  | 'enrichment';
export type ScanPassStatus = 'completed' | 'failed' | 'partial' | 'skipped';
export type ScanNoteSeverity = 'info' | 'warning' | 'error';
export type BackupCheckpointStatus = 'created' | 'failed' | 'manual_required';
export type BackupCheckpointMethod = 'manual' | 'supervisor';

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

export type CapabilityCheck = {
  reason?: string;
  status: CapabilityStatus;
};

export type CapabilitySet = {
  areaRegistry: CapabilityCheck;
  automationMetadata: CapabilityCheck;
  backups: CapabilityCheck;
  configFiles: CapabilityCheck;
  deviceRegistry: CapabilityCheck;
  entityRegistry: CapabilityCheck;
  exposureControl: CapabilityCheck;
  floorRegistry: CapabilityCheck;
  labelRegistry: CapabilityCheck;
  sceneMetadata: CapabilityCheck;
};

export type ConnectionResult = {
  capabilities: CapabilitySet;
  checkedAt: string;
  endpoint: string;
  latencyMs: number;
  mode: ScanMode;
  ok: boolean;
  warnings: string[];
};

export type ConnectionTestRequest = Partial<ConnectionProfile> & {
  mode?: ScanMode;
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

export type InventoryEntity = {
  areaId?: string | null;
  assistantExposures?: AssistantKind[];
  deviceId?: string | null;
  disabledBy?: string | null;
  displayName: string;
  entityId: string;
  floorId?: string | null;
  hiddenBy?: string | null;
  isStale: boolean;
  labelIds?: string[];
  name?: string | null;
  state?: string | null;
};

export type InventoryDevice = {
  areaId?: string | null;
  deviceId: string;
  floorId?: string | null;
  labelIds?: string[];
  name: string;
};

export type InventoryArea = {
  areaId: string;
  name: string;
};

export type InventoryFloor = {
  floorId: string;
  name: string;
};

export type InventoryLabel = {
  labelId: string;
  name: string;
};

export type InventoryAutomation = {
  automationId: string;
  name: string;
  sourcePath?: string;
  targetEntityIds: string[];
};

export type InventoryScene = {
  name: string;
  sceneId: string;
  sourcePath?: string;
  targetEntityIds: string[];
};

export type ConfigIssueCode =
  | 'include_outside_root'
  | 'missing_file'
  | 'parse_error'
  | 'permission_denied';

export type ConfigIssue = {
  code: ConfigIssueCode;
  filePath: string;
  message: string;
  severity: ScanNoteSeverity;
};

export type ConfigFileStatus =
  | 'loaded'
  | 'missing'
  | 'parse_error'
  | 'permission_denied'
  | 'skipped';

export type ConfigFileSummary = {
  filePath: string;
  status: ConfigFileStatus;
  summary: string;
};

export type ConfigAnalysis = {
  files: ConfigFileSummary[];
  issues: ConfigIssue[];
  loadedFileCount: number;
  rootPath: string;
};

export type InventoryGraph = {
  areas: InventoryArea[];
  automations: InventoryAutomation[];
  configAnalysis?: ConfigAnalysis;
  devices: InventoryDevice[];
  entities: InventoryEntity[];
  floors: InventoryFloor[];
  labels: InventoryLabel[];
  scenes: InventoryScene[];
  source: ScanMode;
};

export type Finding = {
  evidence: string;
  id: string;
  kind: FindingKind;
  objectIds: string[];
  severity: FindingSeverity;
  title: string;
};

export type ScanPassResult = {
  completedAt: string;
  detail?: string;
  durationMs: number;
  name: ScanPassName;
  startedAt: string;
  status: ScanPassStatus;
  summary: string;
};

export type ScanNote = {
  id: string;
  message: string;
  scope: ScanPassName | 'backup';
  severity: ScanNoteSeverity;
};

export type EnrichmentFindingSummary = {
  findingId: string;
  summary: string;
};

export type ScanEnrichment = {
  error?: string;
  findingSummaries: EnrichmentFindingSummary[];
  generatedAt?: string;
  model?: string;
  provider: ProviderKind;
  status: 'completed' | 'disabled' | 'failed' | 'skipped';
};

export type BackupCheckpoint = {
  createdAt: string;
  downloadUrl?: string;
  id: string;
  localPath?: string;
  method: BackupCheckpointMethod;
  notes: string[];
  scanFingerprint: string;
  status: BackupCheckpointStatus;
  summary: string;
};

export type ScanRun = {
  backupCheckpoint?: BackupCheckpoint;
  createdAt: string;
  enrichment: ScanEnrichment;
  findings: Finding[];
  fingerprint: string;
  id: string;
  inventory: InventoryGraph;
  mode: ScanMode;
  notes: ScanNote[];
  passes: ScanPassResult[];
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
  deep?: boolean;
  llmProvider?: ProviderKind;
  mode?: ScanMode;
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
  backupCheckpointStatus?: BackupCheckpointStatus;
  createdAt: string;
  findingsCount: number;
  id: string;
  mode: ScanMode;
  profileName: string | null;
};

export type ScanHistoryResponse = {
  scans: ScanHistoryEntry[];
};

export type BackupCheckpointCreateRequest = {
  download?: boolean;
};

export type BackupCheckpointResponse = {
  checkpoint: BackupCheckpoint;
  scanId: string;
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
  scan: ScanRun;
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
