export type ProviderKind = 'none' | 'ollama' | 'openai';
export type SurfaceState = 'ready' | 'planned';
export type ScanMode = 'mock' | 'live';
export type CapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'partial'
  | 'unknown';
export type FindingSeverity = 'low' | 'medium' | 'high';
export type FindingCategory =
  | 'broken_references'
  | 'conflict_overlap'
  | 'configuration_smells'
  | 'dead_legacy_objects'
  | 'fragile_automation_patterns'
  | 'inventory_hygiene'
  | 'naming_intent_drift';
export type FindingKind =
  | 'ambiguous_helper_name'
  | 'assistant_context_bloat'
  | 'automation_disabled_dependency'
  | 'automation_invalid_target'
  | 'dangling_label_reference'
  | 'duplicate_name'
  | 'entity_ownership_hotspot'
  | 'highly_coupled_automation'
  | 'likely_conflicting_controls'
  | 'missing_area_assignment'
  | 'missing_floor_assignment'
  | 'monolithic_config_file'
  | 'orphan_config_module'
  | 'orphaned_entity_device'
  | 'scene_invalid_target'
  | 'script_invalid_target'
  | 'shared_label_observation'
  | 'stale_entity'
  | 'template_missing_reference'
  | 'template_no_unknown_handling'
  | 'unused_helper'
  | 'unused_scene'
  | 'unused_script';
export type AssistantKind = 'assist' | 'alexa' | 'homekit';
export type AssistantExposureOptionKey = AssistantKind | 'conversation';
export type AssistantExposureFlagKey = 'enabled' | 'expose' | 'should_expose';
export type AssistantExposureBinding = {
  flagKey: AssistantExposureFlagKey;
  optionKey: AssistantExposureOptionKey;
};
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
  assistantExposureBindings?: Partial<
    Record<AssistantKind, AssistantExposureBinding>
  >;
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

export type InventoryReferenceSet = {
  entityIds: string[];
  helperIds: string[];
  sceneIds: string[];
  scriptIds: string[];
  serviceIds: string[];
};

export type InventoryAutomation = {
  automationId: string;
  name: string;
  references?: InventoryReferenceSet;
  sourcePath?: string;
  targetEntityIds: string[];
};

export type InventoryScene = {
  name: string;
  references?: InventoryReferenceSet;
  sceneId: string;
  sourcePath?: string;
  targetEntityIds: string[];
};

export type InventoryScript = {
  name: string;
  references?: InventoryReferenceSet;
  scriptId: string;
  sourcePath?: string;
  targetEntityIds: string[];
};

export type InventoryHelperType =
  | 'counter'
  | 'group'
  | 'input_boolean'
  | 'input_button'
  | 'input_datetime'
  | 'input_number'
  | 'input_select'
  | 'input_text'
  | 'timer';

export type InventoryHelper = {
  helperId: string;
  helperType: InventoryHelperType;
  name: string;
  sourcePath?: string;
};

export type InventoryTemplateSourceType =
  | 'automation'
  | 'config'
  | 'script'
  | 'template';

export type InventoryTemplate = {
  entityIds: string[];
  helperIds: string[];
  parseValid: boolean;
  sceneIds: string[];
  scriptIds: string[];
  sourceObjectId?: string;
  sourcePath?: string;
  sourceType: InventoryTemplateSourceType;
  templateId: string;
  templateText: string;
};

export type ConfigModule = {
  automationCount: number;
  filePath: string;
  helperCount: number;
  lineCount: number;
  objectTypesPresent: string[];
  sceneCount: number;
  scriptCount: number;
  templateCount: number;
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
  configModules?: ConfigModule[];
  devices: InventoryDevice[];
  entities: InventoryEntity[];
  floors: InventoryFloor[];
  helpers?: InventoryHelper[];
  labels: InventoryLabel[];
  scenes: InventoryScene[];
  scripts?: InventoryScript[];
  source: ScanMode;
  templates?: InventoryTemplate[];
};

export type FindingAffectedObjectKind =
  | 'area'
  | 'assistant'
  | 'automation'
  | 'config_module'
  | 'device'
  | 'entity'
  | 'floor'
  | 'helper'
  | 'label'
  | 'scene'
  | 'script'
  | 'template';

export type FindingAffectedObject = {
  id: string;
  kind: FindingAffectedObjectKind;
  label?: string;
};

export type FindingEvidenceValue = boolean | number | string | string[];

export type FindingEvidenceDetails = Record<string, FindingEvidenceValue>;

export type FindingRecommendation = {
  action: string;
  steps: string[];
};

export type FindingScoreKey =
  | 'clarity'
  | 'coupling'
  | 'fragility'
  | 'noise'
  | 'redundancy';

export type FindingScores = Partial<Record<FindingScoreKey, number>>;

export type Finding = {
  affectedObjects?: FindingAffectedObject[];
  category?: FindingCategory;
  checkId?: string;
  confidence?: number;
  evidence: string;
  evidenceDetails?: FindingEvidenceDetails;
  id: string;
  kind: FindingKind;
  objectIds: string[];
  recommendation?: FindingRecommendation;
  relatedFindingIds?: string[];
  scores?: FindingScores;
  severity: FindingSeverity;
  summary?: string;
  tags?: string[];
  title: string;
  whyItMatters?: string;
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

export type ScanAuditScores = {
  clarity: number;
  cleanupOpportunity: number;
  correctness: number;
  maintainability: number;
  redundancy: number;
};

export type ScanObjectCounts = {
  areas: number;
  automations: number;
  configModules: number;
  devices: number;
  entities: number;
  floors: number;
  helpers: number;
  labels: number;
  scenes: number;
  scripts: number;
  templates: number;
};

export type ScanOwnershipHotspot = {
  areaIds: string[];
  entityId: string;
  entityLabel: string;
  writerIds: string[];
  writerKinds: Array<'automation' | 'scene' | 'script'>;
};

export type ScanConflictHotspot = {
  entityId: string;
  entityLabel: string;
  findingIds: string[];
  writerIds: string[];
  writerKinds: Array<'automation' | 'scene' | 'script'>;
};

export type ScanIntentCluster = {
  areaIds: string[];
  averageSimilarity: number;
  clusterId: string;
  conceptTerms: string[];
  objectIds: string[];
  objectKinds: Array<'automation' | 'scene' | 'script'>;
  objectLabels: string[];
  targetEntityIds: string[];
};

export type ScanAuditSummary = {
  cleanupCandidateIds: string[];
  conflictCandidateIds: string[];
  conflictHotspots: ScanConflictHotspot[];
  objectCounts: ScanObjectCounts;
  intentClusters: ScanIntentCluster[];
  ownershipHotspotFindingIds: string[];
  ownershipHotspots: ScanOwnershipHotspot[];
  scores: ScanAuditScores;
};

export type ScanAuditDigest = {
  cleanupCandidateCount: number;
  conflictCandidateCount: number;
  intentClusterCount: number;
  objectCounts: ScanObjectCounts;
  ownershipHotspotCount: number;
  scores: ScanAuditScores;
};

export type ScanRun = {
  audit?: ScanAuditSummary;
  backupCheckpoint?: BackupCheckpoint;
  capabilities?: CapabilitySet;
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
  audit?: ScanAuditDigest;
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

export function createScanAuditDigest(
  audit: ScanAuditSummary,
): ScanAuditDigest {
  return {
    cleanupCandidateCount: audit.cleanupCandidateIds.length,
    conflictCandidateCount: audit.conflictCandidateIds.length,
    intentClusterCount: audit.intentClusters.length,
    objectCounts: audit.objectCounts,
    ownershipHotspotCount: audit.ownershipHotspots.length,
    scores: audit.scores,
  };
}

export type BackupCheckpointCreateRequest = {
  download?: boolean;
};

export type BackupCheckpointResponse = {
  checkpoint: BackupCheckpoint;
  scanId: string;
};

export type FixActionKind =
  | 'rename_duplicate_name'
  | 'rename_ambiguous_helper'
  | 'remove_unused_helper'
  | 'remove_unused_script'
  | 'remove_orphan_config_module'
  | 'review_assistant_exposure'
  | 'review_stale_entity';

export type FindingDefinition = {
  definition: string;
  label: string;
  operatorGuidance: string;
  whyItMatters: string;
};

export type FixActionDefinition = {
  definition: string;
  label: string;
  reviewFocus: string;
};

const findingDefinitions = {
  ambiguous_helper_name: {
    definition:
      'An ambiguous helper name means a helper entity still uses a weak or generic label such as "Mode" or "Status" without enough context to explain its purpose.',
    label: 'Ambiguous helpers',
    operatorGuidance:
      'Rename the helper so the label explains its room, role, or automation intent, then rerun the scan.',
    whyItMatters:
      'Generic helper names are hard to distinguish in dashboards, traces, automations, and future maintenance work.',
  },
  assistant_context_bloat: {
    definition:
      'Assistant exposure bloat means one entity is exposed to multiple assistant surfaces, such as Assist, Alexa, and HomeKit.',
    label: 'Assistant exposure',
    operatorGuidance:
      'Keep only the assistant surfaces that actively need this entity, then rerun the scan to confirm the remaining exposure set is intentional.',
    whyItMatters:
      'Each extra surface adds naming, routine, troubleshooting, and privacy overhead. If an entity only needs to exist in one or two assistants, the rest is usually noise.',
  },
  automation_disabled_dependency: {
    definition:
      'An automation disabled dependency means the automation still references an entity that is currently disabled in the entity registry.',
    label: 'Disabled dependencies',
    operatorGuidance:
      'Review whether the disabled entity should be re-enabled, replaced, or removed from the automation, then rerun the scan.',
    whyItMatters:
      'Automations that still depend on disabled entities are prone to stale behavior and silent failures when those references never become valid again.',
  },
  automation_invalid_target: {
    definition:
      'An automation invalid target means the automation still references an entity that is missing from the current Home Assistant inventory.',
    label: 'Automation targets',
    operatorGuidance:
      'Open the automation definition, repair or remove the missing entity references, and rerun the scan.',
    whyItMatters:
      'Broken targets can make automations fail, partially execute, or silently stop doing useful work.',
  },
  dangling_label_reference: {
    definition:
      'A dangling label reference means an entity or device still points at a label that no longer exists in the label registry.',
    label: 'Dangling labels',
    operatorGuidance:
      'Either recreate the intended label or remove the stale label reference from the affected object, then rerun the scan.',
    whyItMatters:
      'Missing labels break custom grouping, filters, and organizational conventions that depend on stable label IDs.',
  },
  duplicate_name: {
    definition:
      'A duplicate name finding means two or more user-facing entities in the same area resolve to the same normalized display name.',
    label: 'Ambiguous names',
    operatorGuidance:
      'Rename the entities so each user-facing surface has a distinct name that still makes sense in the room where it appears.',
    whyItMatters:
      'Same-area name collisions are hard to distinguish in dashboards, target pickers, and voice flows, so operators and assistants can target the wrong thing.',
  },
  entity_ownership_hotspot: {
    definition:
      'An entity ownership hotspot means several scan-visible automations or scenes all write to the same entity, increasing overlap and coordination risk.',
    label: 'Ownership hotspots',
    operatorGuidance:
      'Review whether the writers should be consolidated, sequenced more explicitly, or narrowed so fewer objects compete for the same entity.',
    whyItMatters:
      'The more writers that target one entity, the harder it becomes to predict state changes, troubleshoot regressions, and reason about intent.',
  },
  highly_coupled_automation: {
    definition:
      'A highly coupled automation reaches across many targets, domains, or areas, making one object responsible for too much live behavior.',
    label: 'Coupled automations',
    operatorGuidance:
      'Review whether the automation should be split into smaller intent-specific pieces or reuse scripts so each unit has a narrower scope.',
    whyItMatters:
      'Broad automations are harder to validate and repair because one change can affect several rooms, devices, or behavior paths at once.',
  },
  likely_conflicting_controls: {
    definition:
      'A likely conflicting controls finding means two scan-visible writers target the same entity set with opposing action patterns in overlapping context.',
    label: 'Likely conflicts',
    operatorGuidance:
      'Review whether the writers should be sequenced, narrowed, gated differently, or consolidated so they stop competing for the same targets.',
    whyItMatters:
      'Opposing writers on the same targets are a common source of flicker, surprising state changes, and hard-to-reproduce regressions.',
  },
  missing_area_assignment: {
    definition:
      'A missing area assignment means the entity and its backing device do not currently resolve to any Home Assistant area.',
    label: 'Area coverage',
    operatorGuidance:
      'Assign the entity or its backing device to the correct area, then rerun the scan.',
    whyItMatters:
      'Without an area, room-based dashboards, views, and assistant targeting lose useful context.',
  },
  missing_floor_assignment: {
    definition:
      'A missing floor assignment means the entity and its backing device do not currently resolve to any Home Assistant floor.',
    label: 'Floor coverage',
    operatorGuidance:
      'Assign the entity or its backing device to the correct floor, then rerun the scan.',
    whyItMatters:
      'Floor-aware dashboards and targeting depend on correct level context, especially in multi-story homes.',
  },
  monolithic_config_file: {
    definition:
      'A monolithic config file is a large Home Assistant YAML module whose size or extracted object count makes deterministic review and repair riskier.',
    label: 'Monolithic config',
    operatorGuidance:
      'Review whether the file should be split by intent, room, or object type so future repairs stay easier to inspect.',
    whyItMatters:
      'Oversized config files are harder to review safely, which increases the chance that repairs and refactors carry hidden side effects.',
  },
  orphan_config_module: {
    definition:
      'An orphan config module is a non-root YAML file that currently contributes no extracted automations, scenes, scripts, helpers, or templates.',
    label: 'Orphan config',
    operatorGuidance:
      'Review whether the file is obsolete, placeholder-only, or commented-out legacy content before removing or archiving it.',
    whyItMatters:
      'Dead config fragments add maintenance noise and make it harder to tell which files still shape live Home Assistant behavior.',
  },
  orphaned_entity_device: {
    definition:
      'An orphaned entity/device link means the entity registry entry still points at a device ID that no longer exists in the device registry.',
    label: 'Orphaned device links',
    operatorGuidance:
      'Repair the underlying integration or recreate the entity/device relationship in Home Assistant, then rerun the scan.',
    whyItMatters:
      'Broken device links make area inheritance, grouping, and device-level management unreliable.',
  },
  scene_invalid_target: {
    definition:
      'A scene invalid target means the scene still references an entity that is missing from the current inventory.',
    label: 'Scene targets',
    operatorGuidance:
      'Open the scene definition, repair or remove the missing entity references, and rerun the scan.',
    whyItMatters:
      'Broken scene membership changes what a scene controls and can leave activations incomplete or misleading.',
  },
  script_invalid_target: {
    definition:
      'A script invalid target means the script still references an entity target that is missing from the current Home Assistant inventory.',
    label: 'Script targets',
    operatorGuidance:
      'Open the script definition, repair or remove the missing entity references, and rerun the scan.',
    whyItMatters:
      'Broken script targets can propagate stale behavior into the automations and manual routines that call the script.',
  },
  shared_label_observation: {
    definition:
      'A shared label observation means multiple entities reuse the same display label, but they do not form the stricter same-area user-facing collision that warrants a rename by default.',
    label: 'Shared labels',
    operatorGuidance:
      'Treat this as awareness, not mandatory cleanup. Rename only if the shared label is actually confusing in your dashboards, voice flows, or maintenance work.',
    whyItMatters:
      'Repeated labels can still slow review and troubleshooting, but they are often legitimate when the entities play different roles or live in different areas.',
  },
  stale_entity: {
    definition:
      'A stale entity is present in the registry, but it has no live state or currently reports as unavailable.',
    label: 'Stale entities',
    operatorGuidance:
      'Confirm the entity is no longer needed, then disable it in the entity registry or remove its source integration or helper.',
    whyItMatters:
      'Stale entities add noise to dashboards, pickers, repairs, and assistant context, and they can keep dead integrations or helpers looking active.',
  },
  template_missing_reference: {
    definition:
      'A template missing reference means a template still points at entities, helpers, scenes, or scripts that are missing from the current scan-visible graph.',
    label: 'Template references',
    operatorGuidance:
      'Open the template source, repair or remove the missing references, and rerun the scan.',
    whyItMatters:
      'Broken template references can silently produce wrong logic, fallback values, or brittle runtime behavior that is hard to trace later.',
  },
  template_no_unknown_handling: {
    definition:
      'A template without unknown handling accesses entity state or attributes directly without visible guards for unknown or unavailable values.',
    label: 'Template guards',
    operatorGuidance:
      'Wrap direct state access in Home Assistant-safe guards such as states(), state_attr(), has_value(), or explicit default handling, then rerun the scan.',
    whyItMatters:
      'Direct template access can fail or produce brittle runtime behavior when entities are unavailable, unknown, or still starting up.',
  },
  unused_helper: {
    definition:
      'An unused helper means the helper was found in config analysis, but no scan-visible automations, scripts, or templates referenced it.',
    label: 'Unused helpers',
    operatorGuidance:
      'Review whether the helper is still used manually or indirectly, then remove or rename it only if it is truly dead.',
    whyItMatters:
      'Unused helpers increase cleanup cost and make it harder to identify which toggles, selectors, and timers still matter.',
  },
  unused_scene: {
    definition:
      'An unused scene means the scene was found in config analysis, but no scan-visible automations, scripts, or templates referenced it.',
    label: 'Unused scenes',
    operatorGuidance:
      'Review whether the scene is still activated manually or from dashboards, then remove it only if it is no longer needed.',
    whyItMatters:
      'Unused scenes add maintenance noise and can make the remaining scene set harder to understand.',
  },
  unused_script: {
    definition:
      'An unused script means the script was found in config analysis, but no scan-visible automations, scripts, or templates referenced it.',
    label: 'Unused scripts',
    operatorGuidance:
      'Review whether the script is still called manually, from dashboards, or by hidden integrations before removing it.',
    whyItMatters:
      'Dead scripts accumulate stale logic and make the real execution graph harder to reason about.',
  },
} satisfies Record<FindingKind, FindingDefinition>;

const fixActionDefinitions = {
  remove_orphan_config_module: {
    definition:
      'This repair plan stages a config-file removal diff for an orphan YAML module that no longer contributes extracted Home Assistant objects.',
    label: 'Remove orphan config module',
    reviewFocus:
      'Confirm the file is truly obsolete before accepting the deletion diff.',
  },
  remove_unused_helper: {
    definition:
      'This repair plan stages a YAML patch that removes the unused helper definition from its config source.',
    label: 'Remove unused helper',
    reviewFocus:
      'Confirm no dashboards, manual flows, or hidden integrations still depend on the helper before accepting the diff.',
  },
  remove_unused_script: {
    definition:
      'This repair plan stages a YAML patch that removes the unused script definition from its config source.',
    label: 'Remove unused script',
    reviewFocus:
      'Confirm no manual routines, dashboards, or hidden callers still depend on the script before accepting the diff.',
  },
  rename_ambiguous_helper: {
    definition:
      'This repair plan stages a YAML patch that rewrites the helper name in config so the label carries clearer room or intent context.',
    label: 'Rename ambiguous helper',
    reviewFocus:
      'Choose a durable helper name that explains room, role, or behavior intent before accepting the diff.',
  },
  rename_duplicate_name: {
    definition:
      'This fix stages entity-registry name updates so the colliding entities stop sharing the same in-area user-facing label.',
    label: 'Rename ambiguous entities',
    reviewFocus:
      'Pick distinct, durable names that remain clear in dashboards, target pickers, and voice commands.',
  },
  review_assistant_exposure: {
    definition:
      'This fix stages assistant exposure flag updates in the entity registry so the entity is exposed only to the assistant surfaces you keep.',
    label: 'Review assistant exposure',
    reviewFocus:
      'Remove assistants that do not need this entity. An unchecked surface stops seeing it after the change is applied.',
  },
  review_stale_entity: {
    definition:
      'This fix stages an entity-registry update that sets disabled_by to user, so Home Assistant stops treating the stale entity as an active surface.',
    label: 'Disable stale entity',
    reviewFocus:
      'Confirm no dashboards, automations, templates, or assistant flows still depend on the entity before disabling it.',
  },
} satisfies Record<FixActionKind, FixActionDefinition>;

export function getFindingDefinition(kind: FindingKind): FindingDefinition {
  return findingDefinitions[kind];
}

export function getFixActionDefinition(
  kind: FixActionKind,
): FixActionDefinition {
  return fixActionDefinitions[kind];
}

const findingActionKinds = new Map<FindingKind, FixActionKind>([
  ['ambiguous_helper_name', 'rename_ambiguous_helper'],
  ['assistant_context_bloat', 'review_assistant_exposure'],
  ['duplicate_name', 'rename_duplicate_name'],
  ['orphan_config_module', 'remove_orphan_config_module'],
  ['stale_entity', 'review_stale_entity'],
  ['unused_helper', 'remove_unused_helper'],
  ['unused_script', 'remove_unused_script'],
]);

export function getFindingActionKind(
  kind: FindingKind,
): FixActionKind | undefined {
  return findingActionKinds.get(kind);
}

export type FixRisk = 'low' | 'medium' | 'high';

export type FixTargetKind =
  | 'area'
  | 'assistant'
  | 'automation'
  | 'config_module'
  | 'device'
  | 'entity'
  | 'entity_registry'
  | 'floor'
  | 'helper'
  | 'label'
  | 'scene'
  | 'script'
  | 'template';

export type FixTarget = {
  id: string;
  kind: FixTargetKind;
  label: string;
};

export type EntityRegistryUpdatePayload = {
  disabled_by?: string | null;
  entity_id: string;
  name?: string;
  options?: Partial<
    Record<
      AssistantExposureOptionKey,
      Partial<Record<AssistantExposureFlagKey, boolean>>
    >
  >;
  type: 'config/entity_registry/update';
};

export type FixCommand = {
  id: string;
  summary: string;
  targetId: string;
  transport: 'websocket';
  payload: EntityRegistryUpdatePayload;
};

export type FixInputField = 'assistant_exposures' | 'name';

type BaseFixInput = {
  field: FixInputField;
  id: string;
  summary: string;
  targetId: string;
};

export type FixRequiredInput =
  | (BaseFixInput & {
      currentValue: string | null;
      field: 'name';
      providedValue?: string;
      recommendedValue?: string;
    })
  | (BaseFixInput & {
      currentValue: AssistantKind[];
      field: 'assistant_exposures';
      providedValue?: AssistantKind[];
      recommendedValue?: AssistantKind[];
    });

export type FixArtifactKind = 'text_diff' | 'yaml_diff';

export type FixArtifact = {
  content: string;
  id: string;
  kind: FixArtifactKind;
  label: string;
  path?: string;
};

export type FindingContext = {
  category?: FindingCategory;
  confidence?: number;
  evidence: string;
  recommendation?: FindingRecommendation;
  relatedFindingIds?: string[];
  summary?: string;
  whyItMatters?: string;
};

export type FixAction = {
  artifacts: FixArtifact[];
  commands: FixCommand[];
  executionMode: 'config_patch' | 'websocket_command';
  findingId: string;
  findingContext: FindingContext;
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

export type FixPreviewInput =
  | {
      field: 'name';
      findingId: string;
      targetId: string;
      value: string;
    }
  | {
      field: 'assistant_exposures';
      findingId: string;
      targetId: string;
      value: AssistantKind[];
    };

export type FindingAdvisory = {
  findingId: string;
  findingContext: FindingContext;
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

export function createFrameworkSummary(): FrameworkSummary {
  return {
    priorities: [
      'Run real read-only Home Assistant discovery over authenticated websocket + REST.',
      'Expand deterministic rule packs for area coverage, assistant bloat, and invalid automation targets.',
      'Capture optional backup checkpoints before any future live-apply milestone.',
    ],
    surfaces: [
      {
        id: 'api',
        name: 'API shell',
        state: 'ready',
        summary:
          'Fastify exposes persisted profile, scan, history, checkpoint, queue-backed preview, and dry-run apply endpoints.',
      },
      {
        id: 'web',
        name: 'Guided UI shell',
        state: 'ready',
        summary:
          'React + Vite render queue-aware scan review flows with pass metadata, scan notes, and explicit preview confirmation.',
      },
      {
        id: 'cli',
        name: 'CLI path',
        state: 'ready',
        summary:
          'The CLI now manages saved profiles plus local or live scan, checkpoint, findings, preview, apply, and export flows.',
      },
      {
        id: 'rules',
        name: 'Repair engine',
        state: 'ready',
        summary:
          'Deterministic findings persist with diff summaries, pass timing, checkpoint state, and audit-ready exports.',
      },
    ],
    tagline:
      'A local-first framework for deep Home Assistant inventory repair, cleanup, and guided improvement.',
    title: 'Home Assistant Repair Console',
  };
}

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
