import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname, resolve as resolvePath} from 'node:path';
import process from 'node:process';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {and, asc, desc, eq, isNull, lt} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  ApiErrorResponse,
  ConnectionProfile,
  ConnectionResult,
  Finding,
  FindingAdvisory,
  FindingKind,
  FindingTreatment,
  FindingSeverity,
  FixAction,
  FixApplyRequest,
  FixApplyResponse,
  FixPreviewInput,
  FixQueueEntry,
  FixQueueStatus,
  FixPreviewRequest,
  FixPreviewResponse,
  FixSelection,
  InventoryGraph,
  ProfileDeleteResponse,
  SavedConnectionProfile,
  ScanDetail,
  ScanDiffSummary,
  ScanExportBundle,
  ScanHistoryEntry,
  ScanRun,
  ScanWorkbench,
  ScanWorkbenchResponse,
  WorkbenchApplyRequest,
  WorkbenchApplyResponse,
  WorkbenchEntry,
  WorkbenchEntryStatus,
  WorkbenchItemDeleteResponse,
  WorkbenchItemMutationResponse,
  WorkbenchItemSaveRequest,
  WorkbenchPreviewResponse,
} from '@ha-repair/contracts';
import {collectMockInventory, testConnection} from '@ha-repair/ha-client';
import {
  createFindingAdvisories,
  createFixActions,
  runScan,
} from '@ha-repair/scan-engine';

const defaultDatabasePath = './data/ha-repair.sqlite';
const currentSchemaVersion = 3;
const defaultProfileSettingKey = 'defaultProfileName';

type StoredWorkbenchItemStatus = 'staged' | 'dry_run_applied';

const profilesTable = sqliteTable('profiles', {
  name: text('name').primaryKey(),
  baseUrl: text('base_url').notNull(),
  configPath: text('config_path'),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

const scanRunsTable = sqliteTable(
  'scan_runs',
  {
    sequence: integer('sequence').primaryKey({autoIncrement: true}),
    id: text('id').notNull(),
    createdAt: text('created_at').notNull(),
    profileName: text('profile_name'),
    inventoryJson: text('inventory_json').notNull(),
    findingsCount: integer('findings_count').notNull(),
  },
  (table) => ({
    idIndex: uniqueIndex('scan_runs_id_idx').on(table.id),
    profileSequenceIndex: index('scan_runs_profile_sequence_idx').on(
      table.profileName,
      table.sequence,
    ),
  }),
);

const scanFindingsTable = sqliteTable(
  'scan_findings',
  {
    sequence: integer('sequence').primaryKey({autoIncrement: true}),
    scanId: text('scan_id').notNull(),
    findingId: text('finding_id').notNull(),
    kind: text('kind').$type<FindingKind>().notNull(),
    severity: text('severity').$type<FindingSeverity>().notNull(),
    title: text('title').notNull(),
    evidence: text('evidence').notNull(),
    objectIdsJson: text('object_ids_json').notNull(),
  },
  (table) => ({
    scanFindingIndex: uniqueIndex('scan_findings_scan_id_finding_id_idx').on(
      table.scanId,
      table.findingId,
    ),
    scanIdIndex: index('scan_findings_scan_id_idx').on(table.scanId),
  }),
);

const appSettingsTable = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  updatedAt: text('updated_at').notNull(),
  value: text('value').notNull(),
});

const fixQueueEntriesTable = sqliteTable(
  'fix_queue_entries',
  {
    sequence: integer('sequence').primaryKey({autoIncrement: true}),
    id: text('id').notNull(),
    scanId: text('scan_id').notNull(),
    previewToken: text('preview_token').notNull(),
    status: text('status').$type<FixQueueStatus>().notNull(),
    selectionJson: text('selection_json').notNull(),
    actionsJson: text('actions_json').notNull(),
    createdAt: text('created_at').notNull(),
    lastAppliedAt: text('last_applied_at'),
  },
  (table) => ({
    idIndex: uniqueIndex('fix_queue_entries_id_idx').on(table.id),
    scanPreviewTokenIndex: uniqueIndex(
      'fix_queue_entries_scan_id_preview_token_idx',
    ).on(table.scanId, table.previewToken),
    scanSequenceIndex: index('fix_queue_entries_scan_sequence_idx').on(
      table.scanId,
      table.sequence,
    ),
  }),
);

const scanWorkbenchesTable = sqliteTable(
  'scan_workbenches',
  {
    sequence: integer('sequence').primaryKey({autoIncrement: true}),
    scanId: text('scan_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    latestPreviewToken: text('latest_preview_token'),
  },
  (table) => ({
    scanIdIndex: uniqueIndex('scan_workbenches_scan_id_idx').on(table.scanId),
  }),
);

const scanWorkbenchItemsTable = sqliteTable(
  'scan_workbench_items',
  {
    sequence: integer('sequence').primaryKey({autoIncrement: true}),
    scanId: text('scan_id').notNull(),
    findingId: text('finding_id').notNull(),
    inputsJson: text('inputs_json').notNull(),
    status: text('status').$type<StoredWorkbenchItemStatus>().notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    scanFindingIndex: uniqueIndex(
      'scan_workbench_items_scan_id_finding_id_idx',
    ).on(table.scanId, table.findingId),
    scanStatusUpdatedIndex: index(
      'scan_workbench_items_scan_id_status_updated_at_idx',
    ).on(table.scanId, table.status, table.updatedAt),
  }),
);

type ProfilesRow = typeof profilesTable.$inferSelect;
type ScanRunRow = typeof scanRunsTable.$inferSelect;
type ScanFindingRow = typeof scanFindingsTable.$inferSelect;
type FixQueueEntryRow = typeof fixQueueEntriesTable.$inferSelect;
type ScanWorkbenchRow = typeof scanWorkbenchesTable.$inferSelect;
type ScanWorkbenchItemRow = typeof scanWorkbenchItemsTable.$inferSelect;

export type RepairServiceOptions = {
  cwd?: string;
  dbPath?: string;
  env?: NodeJS.ProcessEnv;
  inventoryProvider?: () => InventoryGraph | Promise<InventoryGraph>;
};

export class RepairServiceError extends Error {
  readonly code: ApiErrorResponse['error'];
  readonly statusCode: number;

  constructor(
    code: ApiErrorResponse['error'],
    statusCode: number,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'RepairServiceError';
    this.statusCode = statusCode;
  }
}

export type RepairService = {
  applyWorkbench: (
    request: {scanId: string} & WorkbenchApplyRequest,
  ) => Promise<WorkbenchApplyResponse>;
  close: () => Promise<void>;
  createScan: (input?: {profileName?: string}) => Promise<ScanDetail>;
  deleteProfile: (name: string) => Promise<ProfileDeleteResponse>;
  exportScan: (scanId?: string) => Promise<ScanExportBundle>;
  getLatestScanId: () => Promise<string | undefined>;
  getProfile: (name: string) => Promise<SavedConnectionProfile>;
  getScan: (scanId: string) => Promise<ScanDetail>;
  getScanFindings: (scanId: string) => Promise<Finding[]>;
  getScanWorkbench: (scanId: string) => Promise<ScanWorkbenchResponse>;
  listHistory: () => Promise<ScanHistoryEntry[]>;
  listProfiles: () => Promise<SavedConnectionProfile[]>;
  previewFixes: (request: FixPreviewRequest) => Promise<FixPreviewResponse>;
  previewWorkbench: (scanId: string) => Promise<WorkbenchPreviewResponse>;
  removeWorkbenchItem: (
    scanId: string,
    findingId: string,
  ) => Promise<WorkbenchItemDeleteResponse>;
  resolveDatabasePath: () => string;
  saveProfile: (profile: ConnectionProfile) => Promise<SavedConnectionProfile>;
  saveWorkbenchItem: (
    scanId: string,
    findingId: string,
    request: WorkbenchItemSaveRequest,
  ) => Promise<WorkbenchItemMutationResponse>;
  setDefaultProfile: (name: string) => Promise<SavedConnectionProfile>;
  testInlineProfile: (
    profile: Partial<ConnectionProfile>,
  ) => Promise<ConnectionResult>;
  testSavedProfile: (name: string) => Promise<ConnectionResult>;
  applyFixes: (request: FixApplyRequest) => Promise<FixApplyResponse>;
};

function createServiceError(
  code: ApiErrorResponse['error'],
  statusCode: number,
  message: string,
): RepairServiceError {
  return new RepairServiceError(code, statusCode, message);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function resolveOptionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function requireValue(
  value: string,
  code: ApiErrorResponse['error'],
  label: string,
): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw createServiceError(code, 400, `${label} is required.`);
  }

  return trimmed;
}

function normalizeStoredProfile(profile: ConnectionProfile): ConnectionProfile {
  const configPath = trimOptionalString(profile.configPath);

  return {
    baseUrl: requireValue(profile.baseUrl, 'invalid_profile', 'Base URL'),
    name: requireValue(profile.name, 'invalid_profile', 'Profile name'),
    token: requireValue(profile.token, 'invalid_profile', 'Token'),
    ...(configPath ? {configPath} : {}),
  };
}

function normalizeInlineProfile(
  profile: Partial<ConnectionProfile>,
): ConnectionProfile {
  const configPath = trimOptionalString(profile.configPath);
  const name = trimOptionalString(profile.name) ?? 'default';

  return {
    baseUrl: profile.baseUrl?.trim() ?? '',
    name,
    token: profile.token?.trim() ?? '',
    ...(configPath ? {configPath} : {}),
  };
}

function resolveDatabasePath(options: RepairServiceOptions = {}): string {
  const configuredPath = options.dbPath ?? options.env?.HA_REPAIR_DB_PATH;
  const selectedPath =
    configuredPath && configuredPath.length > 0
      ? configuredPath
      : defaultDatabasePath;

  if (selectedPath === ':memory:') {
    return selectedPath;
  }

  const cwd = options.cwd ?? process.cwd();
  return resolvePath(cwd, selectedPath);
}

function ensureDatabaseDirectory(databasePath: string) {
  if (databasePath === ':memory:') {
    return;
  }

  mkdirSync(dirname(databasePath), {recursive: true});
}

function applyMigrations(database: DatabaseSync) {
  const version = Number(
    database.prepare('PRAGMA user_version').get()?.user_version ?? 0,
  );

  if (version >= currentSchemaVersion) {
    return;
  }

  database.exec('PRAGMA foreign_keys = ON;');

  if (version < 1) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        config_path TEXT,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scan_runs (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        profile_name TEXT,
        inventory_json TEXT NOT NULL,
        findings_count INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS scan_runs_profile_sequence_idx
      ON scan_runs (profile_name, sequence);

      CREATE TABLE IF NOT EXISTS scan_findings (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        evidence TEXT NOT NULL,
        object_ids_json TEXT NOT NULL,
        FOREIGN KEY (scan_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS scan_findings_scan_id_finding_id_idx
      ON scan_findings (scan_id, finding_id);

      CREATE INDEX IF NOT EXISTS scan_findings_scan_id_idx
      ON scan_findings (scan_id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  if (version < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS fix_queue_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        scan_id TEXT NOT NULL,
        preview_token TEXT NOT NULL,
        status TEXT NOT NULL,
        selection_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_applied_at TEXT,
        FOREIGN KEY (scan_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS fix_queue_entries_scan_id_preview_token_idx
      ON fix_queue_entries (scan_id, preview_token);

      CREATE INDEX IF NOT EXISTS fix_queue_entries_scan_sequence_idx
      ON fix_queue_entries (scan_id, sequence);
    `);
  }

  if (version < 3) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS scan_workbenches (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        latest_preview_token TEXT,
        FOREIGN KEY (scan_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scan_workbench_items (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (scan_id) REFERENCES scan_runs(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS scan_workbenches_scan_id_idx
      ON scan_workbenches (scan_id);

      CREATE UNIQUE INDEX IF NOT EXISTS scan_workbench_items_scan_id_finding_id_idx
      ON scan_workbench_items (scan_id, finding_id);

      CREATE INDEX IF NOT EXISTS scan_workbench_items_scan_id_status_updated_at_idx
      ON scan_workbench_items (scan_id, status, updated_at);
    `);
  }

  database.exec(`PRAGMA user_version = ${currentSchemaVersion};`);
}

function createDatabaseClient(databasePath: string) {
  ensureDatabaseDirectory(databasePath);

  const client = new DatabaseSync(databasePath);
  client.exec('PRAGMA foreign_keys = ON;');
  client.exec('PRAGMA journal_mode = WAL;');
  applyMigrations(client);

  function executeAll(
    statement: ReturnType<DatabaseSync['prepare']>,
    parameters: Record<string, SQLInputValue> | SQLInputValue[],
  ) {
    return Array.isArray(parameters)
      ? statement.all(...parameters)
      : statement.all(parameters);
  }

  function executeGet(
    statement: ReturnType<DatabaseSync['prepare']>,
    parameters: Record<string, SQLInputValue> | SQLInputValue[],
  ) {
    return Array.isArray(parameters)
      ? statement.get(...parameters)
      : statement.get(parameters);
  }

  function executeRun(
    statement: ReturnType<DatabaseSync['prepare']>,
    parameters: Record<string, SQLInputValue> | SQLInputValue[],
  ) {
    return Array.isArray(parameters)
      ? statement.run(...parameters)
      : statement.run(parameters);
  }

  const callback = (async (
    sqlText: string,
    parameters: Record<string, SQLInputValue> | SQLInputValue[],
    method: 'values' | 'run' | 'all' | 'get',
  ) => {
    const statement = client.prepare(sqlText);

    switch (method) {
      case 'all': {
        statement.setReturnArrays(true);
        return {rows: executeAll(statement, parameters)};
      }

      case 'get': {
        statement.setReturnArrays(true);
        return {rows: executeGet(statement, parameters)};
      }

      case 'run': {
        executeRun(statement, parameters);
        return {rows: []};
      }

      case 'values': {
        statement.setReturnArrays(true);
        return {rows: executeAll(statement, parameters)};
      }
    }
  }) as Parameters<typeof drizzle>[0];

  const db = drizzle(callback, {
    schema: {
      appSettingsTable,
      fixQueueEntriesTable,
      profilesTable,
      scanFindingsTable,
      scanRunsTable,
      scanWorkbenchItemsTable,
      scanWorkbenchesTable,
    },
  });

  return {
    client,
    db,
  };
}

function toSavedConnectionProfile(
  row: ProfilesRow,
  defaultProfileName: string | undefined,
): SavedConnectionProfile {
  const configPath = resolveOptionalString(row.configPath);

  return {
    baseUrl: row.baseUrl,
    createdAt: row.createdAt,
    hasToken: row.token.length > 0,
    isDefault: row.name === defaultProfileName,
    name: row.name,
    updatedAt: row.updatedAt,
    ...(configPath ? {configPath} : {}),
  };
}

function toConnectionProfile(row: ProfilesRow): ConnectionProfile {
  const configPath = resolveOptionalString(row.configPath);

  return {
    baseUrl: row.baseUrl,
    name: row.name,
    token: row.token,
    ...(configPath ? {configPath} : {}),
  };
}

function toFinding(row: ScanFindingRow): Finding {
  return {
    evidence: row.evidence,
    id: row.findingId,
    kind: row.kind,
    objectIds: parseJson<string[]>(row.objectIdsJson),
    severity: row.severity,
    title: row.title,
  };
}

function toScanRun(row: ScanRunRow, findings: Finding[]): ScanRun {
  return {
    createdAt: row.createdAt,
    findings,
    id: row.id,
    inventory: parseJson<InventoryGraph>(row.inventoryJson),
    profileName: row.profileName,
  };
}

function toFixQueueEntry(row: FixQueueEntryRow): FixQueueEntry {
  const lastAppliedAt = resolveOptionalString(row.lastAppliedAt);

  return {
    createdAt: row.createdAt,
    id: row.id,
    ...(lastAppliedAt ? {lastAppliedAt} : {}),
    status: row.status,
  };
}

function toStoredPreviewResponse(
  scanId: string,
  row: FixQueueEntryRow,
): FixPreviewResponse {
  return {
    actions: parseJson<FixAction[]>(row.actionsJson),
    advisories: [],
    generatedAt: row.createdAt,
    previewToken: row.previewToken,
    queue: toFixQueueEntry(row),
    scanId,
    selection: parseJson<FixSelection>(row.selectionJson),
  };
}

function toStoredWorkbenchStatus(
  status: StoredWorkbenchItemStatus,
): WorkbenchEntryStatus {
  return status;
}

function getFindingTreatment(
  inventory: InventoryGraph,
  finding: Finding,
): FindingTreatment {
  return createFixActions(inventory, [finding]).length > 0
    ? 'actionable'
    : 'advisory';
}

function toWorkbenchEntry({
  finding,
  inventory,
  row,
}: {
  finding: Finding;
  inventory: InventoryGraph;
  row: ScanWorkbenchItemRow | undefined;
}): WorkbenchEntry {
  const treatment = getFindingTreatment(inventory, finding);
  const updatedAt = resolveOptionalString(row?.updatedAt ?? null);

  return {
    findingId: finding.id,
    savedInputs: row ? parseJson<FixPreviewInput[]>(row.inputsJson) : [],
    status: row
      ? toStoredWorkbenchStatus(row.status)
      : treatment === 'advisory'
        ? 'advisory'
        : 'recommended',
    treatment,
    ...(updatedAt ? {updatedAt} : {}),
  };
}

function buildDiffSummary(
  currentFindings: Finding[],
  previousFindings: Finding[],
  previousScanId: string | null,
): ScanDiffSummary {
  const currentFindingIds = currentFindings.map((finding) => finding.id);
  const previousFindingIds = previousFindings.map((finding) => finding.id);
  const previousSet = new Set(previousFindingIds);
  const currentSet = new Set(currentFindingIds);

  const unchangedFindingIds = currentFindingIds.filter((findingId) =>
    previousSet.has(findingId),
  );
  const regressedFindingIds = currentFindingIds.filter(
    (findingId) => !previousSet.has(findingId),
  );
  const resolvedFindingIds = previousFindingIds.filter(
    (findingId) => !currentSet.has(findingId),
  );

  return {
    previousScanId,
    regressedCount: regressedFindingIds.length,
    regressedFindingIds,
    resolvedCount: resolvedFindingIds.length,
    resolvedFindingIds,
    unchangedCount: unchangedFindingIds.length,
    unchangedFindingIds,
  };
}

function createFixSelection(actions: FixAction[]): FixSelection {
  const findingIds: string[] = [];
  const seenFindingIds = new Set<string>();

  for (const action of actions) {
    if (!seenFindingIds.has(action.findingId)) {
      seenFindingIds.add(action.findingId);
      findingIds.push(action.findingId);
    }
  }

  return {
    actionIds: actions.map((action) => action.id),
    findingIds,
  };
}

function createPreviewToken(): string {
  return `preview-${randomUUID()}`;
}

function createQueueEntryId(): string {
  return `queue-${randomUUID()}`;
}

function createScanExportBundle(scan: ScanDetail): ScanExportBundle {
  return {
    actions: createFixActions(scan.inventory, scan.findings),
    advisories: createFindingAdvisories(scan.inventory, scan.findings),
    diffSummary: scan.diffSummary,
    findings: scan.findings,
    generatedAt: new Date().toISOString(),
    scan: {
      createdAt: scan.createdAt,
      id: scan.id,
      inventory: scan.inventory,
      profileName: scan.profileName,
    },
  };
}

function formatLineItemList(
  label: string,
  values: string[],
  emptyLabel = 'None',
): string {
  return `- ${label}: ${values.length > 0 ? values.join(', ') : emptyLabel}`;
}

function formatCommandPayload(
  payload: FixAction['commands'][number]['payload'],
): string {
  return JSON.stringify(payload, null, 2);
}

export function renderScanExportMarkdown(bundle: ScanExportBundle): string {
  const lines = [
    '# Home Assistant Repair Report',
    '',
    `Generated: ${bundle.generatedAt}`,
    `Scan ID: ${bundle.scan.id}`,
    `Profile: ${bundle.scan.profileName ?? 'No profile'}`,
    `Scanned at: ${bundle.scan.createdAt}`,
    `Inventory source: ${bundle.scan.inventory.source}`,
    '',
    '## Diff Summary',
    `- Previous scan: ${bundle.diffSummary.previousScanId ?? 'None'}`,
    `- Regressed count: ${bundle.diffSummary.regressedCount}`,
    formatLineItemList(
      'Regressed finding IDs',
      bundle.diffSummary.regressedFindingIds,
    ),
    `- Resolved count: ${bundle.diffSummary.resolvedCount}`,
    formatLineItemList(
      'Resolved finding IDs',
      bundle.diffSummary.resolvedFindingIds,
    ),
    `- Unchanged count: ${bundle.diffSummary.unchangedCount}`,
    formatLineItemList(
      'Unchanged finding IDs',
      bundle.diffSummary.unchangedFindingIds,
    ),
    '',
    '## Findings',
  ];

  if (bundle.findings.length === 0) {
    lines.push('No findings recorded for this scan.', '');
  } else {
    for (const finding of bundle.findings) {
      lines.push(
        `### ${finding.title}`,
        `- ID: ${finding.id}`,
        `- Kind: ${finding.kind}`,
        `- Severity: ${finding.severity}`,
        `- Evidence: ${finding.evidence}`,
        formatLineItemList('Objects', finding.objectIds),
        '',
      );
    }
  }

  lines.push('## Fix Actions');

  if (bundle.actions.length === 0) {
    lines.push('No fix actions generated for this scan.');
  } else {
    for (const action of bundle.actions) {
      lines.push(
        '',
        `### ${action.title}`,
        `- Action ID: ${action.id}`,
        `- Finding ID: ${action.findingId}`,
        `- Kind: ${action.kind}`,
        `- Risk: ${action.risk}`,
        `- Intent: ${action.intent}`,
        `- Rationale: ${action.rationale}`,
        `- Requires confirmation: ${action.requiresConfirmation ? 'yes' : 'no'}`,
        formatLineItemList(
          'Targets',
          action.targets.map((target) => `${target.label} [${target.kind}]`),
        ),
        formatLineItemList('Warnings', action.warnings),
        formatLineItemList('Steps', action.steps),
      );

      if (action.requiredInputs.length === 0) {
        lines.push('- Required inputs: None');
      } else {
        lines.push(
          formatLineItemList(
            'Required inputs',
            action.requiredInputs.map(
              (input) =>
                `${input.summary} (field: ${input.field}, current: ${input.currentValue ?? 'null'}, recommended: ${input.recommendedValue ?? 'None'}, provided: ${input.providedValue ?? 'Missing'})`,
            ),
          ),
        );
      }

      if (action.commands.length === 0) {
        lines.push(
          '- Commands: No literal Home Assistant payloads generated yet.',
        );
      } else {
        for (const command of action.commands) {
          lines.push(
            `- Command: ${command.summary} [${command.transport}]`,
            '```json',
            formatCommandPayload(command.payload),
            '```',
          );
        }
      }

      for (const artifact of action.artifacts) {
        lines.push(
          `- Artifact: ${artifact.label} (${artifact.kind})`,
          '```diff',
          artifact.content,
          '```',
        );
      }
    }
  }

  lines.push('', '## Advisory Findings');

  if (bundle.advisories.length === 0) {
    lines.push('No advisory-only findings recorded for this scan.');
    return lines.join('\n');
  }

  for (const advisory of bundle.advisories) {
    lines.push(
      '',
      `### ${advisory.title}`,
      `- Finding ID: ${advisory.findingId}`,
      `- Summary: ${advisory.summary}`,
      `- Rationale: ${advisory.rationale}`,
      formatLineItemList(
        'Targets',
        advisory.targets.map((target) => `${target.label} [${target.kind}]`),
      ),
      formatLineItemList('Warnings', advisory.warnings),
      formatLineItemList('Steps', advisory.steps),
    );
  }

  return lines.join('\n');
}

function getIncompleteRequiredInputs(actions: FixAction[]) {
  return actions.flatMap((action) =>
    action.requiredInputs
      .filter((input) => !input.providedValue)
      .map((input) => ({action, input})),
  );
}

function formatMissingInputMessage(
  missingInputs: ReturnType<typeof getIncompleteRequiredInputs>,
): string {
  return missingInputs
    .map(
      ({action, input}) =>
        `${action.id} requires ${input.field} for ${input.targetId}`,
    )
    .join(', ');
}

function hasExactActionSelection(
  expectedActionIds: string[],
  receivedActionIds: string[],
): boolean {
  return (
    expectedActionIds.length === receivedActionIds.length &&
    expectedActionIds.every(
      (expectedActionId, index) =>
        expectedActionId === receivedActionIds[index],
    )
  );
}

async function maybeInsertRows<T>(
  rows: T[],
  insert: (rows: T[]) => Promise<unknown>,
) {
  if (rows.length === 0) {
    return;
  }

  await insert(rows);
}

export async function createRepairService(
  options: RepairServiceOptions = {},
): Promise<RepairService> {
  const databasePath = resolveDatabasePath(options);
  const {client, db} = createDatabaseClient(databasePath);
  const inventoryProvider = options.inventoryProvider ?? collectMockInventory;

  async function getDefaultProfileName(): Promise<string | undefined> {
    const [row] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, defaultProfileSettingKey))
      .limit(1);

    return row?.value;
  }

  async function upsertDefaultProfileName(name: string) {
    const timestamp = new Date().toISOString();

    await db
      .insert(appSettingsTable)
      .values({
        key: defaultProfileSettingKey,
        updatedAt: timestamp,
        value: name,
      })
      .onConflictDoUpdate({
        set: {
          updatedAt: timestamp,
          value: name,
        },
        target: appSettingsTable.key,
      });
  }

  async function clearDefaultProfileName() {
    await db
      .delete(appSettingsTable)
      .where(eq(appSettingsTable.key, defaultProfileSettingKey));
  }

  async function getProfileRow(name: string): Promise<ProfilesRow | undefined> {
    const [row] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.name, name))
      .limit(1);

    return row;
  }

  async function requireProfileRow(name: string): Promise<ProfilesRow> {
    const profile = await getProfileRow(name);

    if (!profile) {
      throw createServiceError(
        'profile_not_found',
        404,
        `Profile "${name}" was not found.`,
      );
    }

    return profile;
  }

  async function readFindings(scanId: string): Promise<Finding[]> {
    const rows = await db
      .select()
      .from(scanFindingsTable)
      .where(eq(scanFindingsTable.scanId, scanId))
      .orderBy(asc(scanFindingsTable.sequence));

    return rows.map((row) => toFinding(row));
  }

  async function getScanRow(scanId: string): Promise<ScanRunRow | undefined> {
    const [row] = await db
      .select()
      .from(scanRunsTable)
      .where(eq(scanRunsTable.id, scanId))
      .limit(1);

    return row;
  }

  async function requireScanRow(scanId: string): Promise<ScanRunRow> {
    const scan = await getScanRow(scanId);

    if (!scan) {
      throw createServiceError(
        'scan_not_found',
        404,
        `Scan "${scanId}" was not found.`,
      );
    }

    return scan;
  }

  async function getPreviousScanRow(
    scanRow: ScanRunRow,
  ): Promise<ScanRunRow | undefined> {
    const baseQuery = db
      .select()
      .from(scanRunsTable)
      .where(
        and(
          lt(scanRunsTable.sequence, scanRow.sequence),
          scanRow.profileName === null
            ? isNull(scanRunsTable.profileName)
            : eq(scanRunsTable.profileName, scanRow.profileName),
        ),
      )
      .orderBy(desc(scanRunsTable.sequence))
      .limit(1);
    const [row] = await baseQuery;

    return row;
  }

  async function buildScanDetail(scanRow: ScanRunRow): Promise<ScanDetail> {
    const findings = await readFindings(scanRow.id);
    const previousScanRow = await getPreviousScanRow(scanRow);
    const previousFindings = previousScanRow
      ? await readFindings(previousScanRow.id)
      : [];

    return {
      ...toScanRun(scanRow, findings),
      diffSummary: buildDiffSummary(
        findings,
        previousFindings,
        previousScanRow?.id ?? null,
      ),
    };
  }

  async function requireScanDetail(scanId: string): Promise<ScanDetail> {
    const scanRow = await requireScanRow(scanId);
    return buildScanDetail(scanRow);
  }

  async function requireSelectedFindings(
    scanId: string,
    findingIds?: string[],
  ): Promise<Finding[]> {
    const findings = await readFindings(scanId);

    if (!findingIds || findingIds.length === 0) {
      return findings;
    }

    const requestedIds = new Set(findingIds);
    const selected = findings.filter((finding) => requestedIds.has(finding.id));

    if (selected.length !== requestedIds.size) {
      const foundIds = new Set(selected.map((finding) => finding.id));
      const missing = [...requestedIds].filter(
        (findingId) => !foundIds.has(findingId),
      );
      throw createServiceError(
        'finding_not_found',
        400,
        `Unknown finding ids: ${missing.join(', ')}`,
      );
    }

    return selected;
  }

  function requireSelectedActionIds(actionIds: string[]) {
    if (actionIds.length === 0) {
      throw createServiceError(
        'action_selection_required',
        400,
        'Select at least one reviewed action before apply.',
      );
    }
  }

  async function getFixQueueEntryRow(
    scanId: string,
    previewToken: string,
  ): Promise<FixQueueEntryRow | undefined> {
    const [row] = await db
      .select()
      .from(fixQueueEntriesTable)
      .where(
        and(
          eq(fixQueueEntriesTable.scanId, scanId),
          eq(fixQueueEntriesTable.previewToken, previewToken),
        ),
      )
      .limit(1);

    return row;
  }

  async function getScanWorkbenchRow(
    scanId: string,
  ): Promise<ScanWorkbenchRow | undefined> {
    const [row] = await db
      .select()
      .from(scanWorkbenchesTable)
      .where(eq(scanWorkbenchesTable.scanId, scanId))
      .limit(1);

    return row;
  }

  async function ensureScanWorkbenchRow(
    scanId: string,
  ): Promise<ScanWorkbenchRow> {
    const existingRow = await getScanWorkbenchRow(scanId);

    if (existingRow) {
      return existingRow;
    }

    const timestamp = new Date().toISOString();

    await db.insert(scanWorkbenchesTable).values({
      createdAt: timestamp,
      latestPreviewToken: null,
      scanId,
      updatedAt: timestamp,
    });

    const nextRow = await getScanWorkbenchRow(scanId);

    if (!nextRow) {
      throw createServiceError(
        'internal_error',
        500,
        `Failed to create workbench for scan "${scanId}".`,
      );
    }

    return nextRow;
  }

  async function listScanWorkbenchItemRows(
    scanId: string,
  ): Promise<ScanWorkbenchItemRow[]> {
    return db
      .select()
      .from(scanWorkbenchItemsTable)
      .where(eq(scanWorkbenchItemsTable.scanId, scanId))
      .orderBy(desc(scanWorkbenchItemsTable.updatedAt));
  }

  async function getScanWorkbenchItemRow(
    scanId: string,
    findingId: string,
  ): Promise<ScanWorkbenchItemRow | undefined> {
    const [row] = await db
      .select()
      .from(scanWorkbenchItemsTable)
      .where(
        and(
          eq(scanWorkbenchItemsTable.scanId, scanId),
          eq(scanWorkbenchItemsTable.findingId, findingId),
        ),
      )
      .limit(1);

    return row;
  }

  function normalizeWorkbenchInputs(
    findingId: string,
    inputs: FixPreviewInput[] | undefined,
  ): FixPreviewInput[] {
    const nextInputs = inputs ?? [];

    if (nextInputs.some((input) => input.findingId !== findingId)) {
      throw createServiceError(
        'invalid_workbench_item',
        400,
        `Workbench inputs must target finding "${findingId}".`,
      );
    }

    return [...nextInputs].sort((left, right) =>
      `${left.targetId}:${left.field}`.localeCompare(
        `${right.targetId}:${right.field}`,
      ),
    );
  }

  async function requireFindingForScan(scanId: string, findingId: string) {
    const scan = await requireScanDetail(scanId);
    const finding = scan.findings.find(
      (candidate) => candidate.id === findingId,
    );

    if (!finding) {
      throw createServiceError(
        'finding_not_found',
        404,
        `Finding "${findingId}" was not found for scan "${scanId}".`,
      );
    }

    return {
      finding,
      scan,
    };
  }

  function validateActionableWorkbenchFinding(
    scan: ScanDetail,
    finding: Finding,
    inputs: FixPreviewInput[],
  ) {
    const actions = createFixActions(scan.inventory, [finding], inputs);

    if (actions.length === 0) {
      throw createServiceError(
        'finding_not_stageable',
        400,
        `Finding "${finding.id}" is advisory-only and cannot be staged.`,
      );
    }

    const missingInputs = getIncompleteRequiredInputs(actions);

    if (missingInputs.length > 0) {
      throw createServiceError(
        'fix_input_required',
        400,
        `Provide literal Home Assistant input values before staging: ${formatMissingInputMessage(missingInputs)}.`,
      );
    }
  }

  async function invalidateWorkbenchPreview(
    scanId: string,
    updatedAt: string,
  ): Promise<void> {
    await db
      .update(scanWorkbenchItemsTable)
      .set({
        status: 'staged',
      })
      .where(eq(scanWorkbenchItemsTable.scanId, scanId));

    await db
      .update(scanWorkbenchesTable)
      .set({
        latestPreviewToken: null,
        updatedAt,
      })
      .where(eq(scanWorkbenchesTable.scanId, scanId));
  }

  async function buildScanWorkbench(scan: ScanDetail): Promise<ScanWorkbench> {
    const workbenchRow = await ensureScanWorkbenchRow(scan.id);
    const itemRows = await listScanWorkbenchItemRows(scan.id);
    const itemRowLookup = new Map(
      itemRows.map((row) => [row.findingId, row] as const),
    );
    const latestQueueRow = workbenchRow.latestPreviewToken
      ? await getFixQueueEntryRow(scan.id, workbenchRow.latestPreviewToken)
      : undefined;
    const latestPreviewToken =
      workbenchRow.latestPreviewToken && latestQueueRow
        ? workbenchRow.latestPreviewToken
        : undefined;
    const latestQueue = latestQueueRow
      ? toFixQueueEntry(latestQueueRow)
      : undefined;
    const latestPreview =
      latestQueueRow && latestPreviewToken
        ? toStoredPreviewResponse(scan.id, latestQueueRow)
        : undefined;
    const entries = scan.findings.map((finding) =>
      toWorkbenchEntry({
        finding,
        inventory: scan.inventory,
        row: itemRowLookup.get(finding.id),
      }),
    );
    const stagedCount = itemRows.length;

    return {
      entries,
      isPreviewStale: stagedCount > 0 && !latestPreviewToken,
      ...(latestPreview ? {latestPreview} : {}),
      ...(latestPreviewToken ? {latestPreviewToken} : {}),
      ...(latestQueue ? {latestQueue} : {}),
      scanId: scan.id,
      stagedCount,
    };
  }

  async function resolveRequestedProfileName(
    requestedProfileName?: string,
  ): Promise<string | null> {
    if (requestedProfileName) {
      const normalizedName = requestedProfileName.trim();
      await requireProfileRow(normalizedName);
      return normalizedName;
    }

    return (await getDefaultProfileName()) ?? null;
  }

  async function saveScan(scan: ScanRun): Promise<ScanDetail> {
    await db.transaction(async (transaction) => {
      await transaction.insert(scanRunsTable).values({
        createdAt: scan.createdAt,
        findingsCount: scan.findings.length,
        id: scan.id,
        inventoryJson: JSON.stringify(scan.inventory),
        profileName: scan.profileName,
      });

      await maybeInsertRows(
        scan.findings.map((finding) => ({
          evidence: finding.evidence,
          findingId: finding.id,
          kind: finding.kind,
          objectIdsJson: JSON.stringify(finding.objectIds),
          scanId: scan.id,
          severity: finding.severity,
          title: finding.title,
        })),
        async (rows) => {
          await transaction.insert(scanFindingsTable).values(rows);
        },
      );
    });

    return requireScanDetail(scan.id);
  }

  async function getLatestScanId() {
    const [row] = await db
      .select({id: scanRunsTable.id})
      .from(scanRunsTable)
      .orderBy(desc(scanRunsTable.sequence))
      .limit(1);

    return row?.id;
  }

  async function getProfile(name: string) {
    const normalizedName = requireValue(
      name,
      'profile_name_required',
      'Profile name',
    );
    const profile = await requireProfileRow(normalizedName);
    const defaultProfileName = await getDefaultProfileName();

    return toSavedConnectionProfile(profile, defaultProfileName);
  }

  async function listProfiles() {
    const [profiles, defaultProfileName] = await Promise.all([
      db.select().from(profilesTable).orderBy(asc(profilesTable.name)),
      getDefaultProfileName(),
    ]);

    return profiles.map((profile) =>
      toSavedConnectionProfile(profile, defaultProfileName),
    );
  }

  async function previewFixes(request: FixPreviewRequest) {
    await requireScanRow(request.scanId);
    const findings = await requireSelectedFindings(
      request.scanId,
      request.findingIds,
    );
    const scan = await requireScanDetail(request.scanId);
    const actions = createFixActions(scan.inventory, findings, request.inputs);
    const advisories = createFindingAdvisories(scan.inventory, findings);
    const missingInputs = getIncompleteRequiredInputs(actions);

    if (missingInputs.length > 0) {
      throw createServiceError(
        'fix_input_required',
        400,
        `Provide literal Home Assistant input values before preview: ${formatMissingInputMessage(missingInputs)}.`,
      );
    }

    if (actions.length === 0) {
      throw createServiceError(
        'no_previewable_actions',
        400,
        'The selected findings do not map to literal previewable Home Assistant commands.',
      );
    }

    const selection = createFixSelection(actions);
    const createdAt = new Date().toISOString();
    const previewToken = createPreviewToken();
    const queue = {
      createdAt,
      id: createQueueEntryId(),
      status: 'pending_review' as const,
    };

    await db.insert(fixQueueEntriesTable).values({
      actionsJson: JSON.stringify(actions),
      createdAt,
      id: queue.id,
      lastAppliedAt: null,
      previewToken,
      scanId: request.scanId,
      selectionJson: JSON.stringify(selection),
      status: queue.status,
    });

    return {
      actions,
      advisories,
      generatedAt: createdAt,
      previewToken,
      queue,
      scanId: request.scanId,
      selection,
    };
  }

  async function applyFixes(request: FixApplyRequest) {
    if (!request.dryRun) {
      throw createServiceError(
        'dry_run_required',
        400,
        'Only dry-run apply is available in Phase B.',
      );
    }

    if (request.previewToken.trim().length === 0) {
      throw createServiceError(
        'preview_token_required',
        400,
        'Apply requires the preview token returned by the reviewed preview step.',
      );
    }

    requireSelectedActionIds(request.actionIds);

    const queueEntryRow = await getFixQueueEntryRow(
      request.scanId,
      request.previewToken,
    );

    if (!queueEntryRow) {
      throw createServiceError(
        'preview_mismatch',
        409,
        'The requested dry-run actions do not match the reviewed preview token. Generate a new preview before applying.',
      );
    }

    const selection = parseJson<FixSelection>(queueEntryRow.selectionJson);

    if (!hasExactActionSelection(selection.actionIds, request.actionIds)) {
      throw createServiceError(
        'preview_mismatch',
        409,
        'The requested dry-run actions do not match the reviewed preview token. Generate a new preview before applying.',
      );
    }

    const appliedAt = new Date().toISOString();

    await db
      .update(fixQueueEntriesTable)
      .set({
        lastAppliedAt: appliedAt,
        status: 'dry_run_applied',
      })
      .where(eq(fixQueueEntriesTable.id, queueEntryRow.id));

    const actions = parseJson<FixAction[]>(queueEntryRow.actionsJson);
    const queue = toFixQueueEntry({
      ...queueEntryRow,
      lastAppliedAt: appliedAt,
      status: 'dry_run_applied',
    });

    return {
      actions,
      appliedCount: 0,
      mode: 'dry_run' as const,
      previewToken: queueEntryRow.previewToken,
      queue,
      scanId: request.scanId,
      selection,
    };
  }

  async function createScan(input: {profileName?: string} = {}) {
    const profileName = await resolveRequestedProfileName(input.profileName);
    const inventory = await inventoryProvider();
    const scan = runScan(inventory, profileName);

    return saveScan(scan);
  }

  async function deleteProfile(name: string) {
    const normalizedName = requireValue(
      name,
      'profile_name_required',
      'Profile name',
    );
    await requireProfileRow(normalizedName);

    await db
      .delete(profilesTable)
      .where(eq(profilesTable.name, normalizedName));

    if ((await getDefaultProfileName()) === normalizedName) {
      await clearDefaultProfileName();
    }

    return {
      deleted: true,
      name: normalizedName,
    };
  }

  async function exportScan(scanId?: string) {
    const resolvedScanId = scanId ?? (await getLatestScanId());

    if (!resolvedScanId) {
      throw createServiceError('scan_not_found', 404, 'No scans found.');
    }

    const scan = await requireScanDetail(resolvedScanId);

    return createScanExportBundle(scan);
  }

  async function getScan(scanId: string) {
    return requireScanDetail(scanId);
  }

  async function getScanFindings(scanId: string) {
    await requireScanRow(scanId);
    return readFindings(scanId);
  }

  async function getScanWorkbench(scanId: string) {
    const scan = await requireScanDetail(scanId);
    const workbench = await buildScanWorkbench(scan);

    return {
      scan,
      workbench,
    } satisfies ScanWorkbenchResponse;
  }

  async function saveWorkbenchItem(
    scanId: string,
    findingId: string,
    request: WorkbenchItemSaveRequest,
  ) {
    const {finding, scan} = await requireFindingForScan(scanId, findingId);
    await ensureScanWorkbenchRow(scanId);

    const inputs = normalizeWorkbenchInputs(findingId, request.inputs);
    validateActionableWorkbenchFinding(scan, finding, inputs);
    const timestamp = new Date().toISOString();

    await db
      .insert(scanWorkbenchItemsTable)
      .values({
        findingId,
        inputsJson: JSON.stringify(inputs),
        scanId,
        status: 'staged',
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        set: {
          inputsJson: JSON.stringify(inputs),
          status: 'staged',
          updatedAt: timestamp,
        },
        target: [
          scanWorkbenchItemsTable.scanId,
          scanWorkbenchItemsTable.findingId,
        ],
      });

    await invalidateWorkbenchPreview(scanId, timestamp);

    const workbench = await buildScanWorkbench(scan);
    const entry = workbench.entries.find(
      (candidate) => candidate.findingId === findingId,
    );

    if (!entry) {
      throw createServiceError(
        'internal_error',
        500,
        `Failed to load staged workbench entry for "${findingId}".`,
      );
    }

    return {
      entry,
      workbench,
    } satisfies WorkbenchItemMutationResponse;
  }

  async function removeWorkbenchItem(scanId: string, findingId: string) {
    const {scan} = await requireFindingForScan(scanId, findingId);
    await ensureScanWorkbenchRow(scanId);

    const existingRow = await getScanWorkbenchItemRow(scanId, findingId);

    if (existingRow) {
      const timestamp = new Date().toISOString();

      await db
        .delete(scanWorkbenchItemsTable)
        .where(
          and(
            eq(scanWorkbenchItemsTable.scanId, scanId),
            eq(scanWorkbenchItemsTable.findingId, findingId),
          ),
        );

      await invalidateWorkbenchPreview(scanId, timestamp);
    }

    return {
      deleted: Boolean(existingRow),
      findingId,
      workbench: await buildScanWorkbench(scan),
    } satisfies WorkbenchItemDeleteResponse;
  }

  async function previewWorkbench(scanId: string) {
    const scan = await requireScanDetail(scanId);
    await ensureScanWorkbenchRow(scanId);

    const itemRows = await listScanWorkbenchItemRows(scanId);

    if (itemRows.length === 0) {
      throw createServiceError(
        'workbench_empty',
        400,
        'Stage at least one actionable finding before building a batch preview.',
      );
    }

    const preview = await previewFixes({
      findingIds: itemRows.map((row) => row.findingId),
      inputs: itemRows.flatMap((row) =>
        parseJson<FixPreviewInput[]>(row.inputsJson),
      ),
      scanId,
    });

    await db
      .update(scanWorkbenchesTable)
      .set({
        latestPreviewToken: preview.previewToken,
        updatedAt: preview.generatedAt,
      })
      .where(eq(scanWorkbenchesTable.scanId, scanId));

    return {
      preview,
      workbench: await buildScanWorkbench(scan),
    } satisfies WorkbenchPreviewResponse;
  }

  async function applyWorkbench(
    request: {scanId: string} & WorkbenchApplyRequest,
  ) {
    if (request.dryRun === false) {
      throw createServiceError(
        'dry_run_required',
        400,
        'Only dry-run apply is available in Phase B.',
      );
    }

    const scan = await requireScanDetail(request.scanId);
    const workbenchRow = await ensureScanWorkbenchRow(request.scanId);
    const previewToken = trimOptionalString(
      resolveOptionalString(workbenchRow.latestPreviewToken),
    );

    if (!previewToken) {
      throw createServiceError(
        'workbench_preview_required',
        409,
        'Build a fresh batch preview before running dry-run apply.',
      );
    }

    const queueEntryRow = await getFixQueueEntryRow(
      request.scanId,
      previewToken,
    );

    if (!queueEntryRow) {
      throw createServiceError(
        'preview_mismatch',
        409,
        'The saved workbench preview no longer matches a stored queue snapshot. Build a new preview before applying.',
      );
    }

    const selection = parseJson<FixSelection>(queueEntryRow.selectionJson);
    const apply = await applyFixes({
      actionIds: selection.actionIds,
      dryRun: true,
      previewToken,
      scanId: request.scanId,
    });
    const appliedAt = apply.queue.lastAppliedAt ?? new Date().toISOString();

    await db
      .update(scanWorkbenchItemsTable)
      .set({
        status: 'dry_run_applied',
        updatedAt: appliedAt,
      })
      .where(eq(scanWorkbenchItemsTable.scanId, request.scanId));

    await db
      .update(scanWorkbenchesTable)
      .set({
        updatedAt: appliedAt,
      })
      .where(eq(scanWorkbenchesTable.scanId, request.scanId));

    return {
      apply,
      workbench: await buildScanWorkbench(scan),
    } satisfies WorkbenchApplyResponse;
  }

  async function listHistory() {
    const rows = await db
      .select({
        createdAt: scanRunsTable.createdAt,
        findingsCount: scanRunsTable.findingsCount,
        id: scanRunsTable.id,
        profileName: scanRunsTable.profileName,
      })
      .from(scanRunsTable)
      .orderBy(desc(scanRunsTable.sequence));

    return rows satisfies ScanHistoryEntry[];
  }

  async function saveProfile(profile: ConnectionProfile) {
    const normalizedProfile = normalizeStoredProfile(profile);
    const existingProfile = await getProfileRow(normalizedProfile.name);
    const timestamp = new Date().toISOString();

    await db
      .insert(profilesTable)
      .values({
        baseUrl: normalizedProfile.baseUrl,
        configPath: normalizedProfile.configPath ?? null,
        createdAt: existingProfile?.createdAt ?? timestamp,
        name: normalizedProfile.name,
        token: normalizedProfile.token,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        set: {
          baseUrl: normalizedProfile.baseUrl,
          configPath: normalizedProfile.configPath ?? null,
          token: normalizedProfile.token,
          updatedAt: timestamp,
        },
        target: profilesTable.name,
      });

    return getProfile(normalizedProfile.name);
  }

  async function setDefaultProfile(name: string) {
    const normalizedName = requireValue(
      name,
      'profile_name_required',
      'Profile name',
    );
    await requireProfileRow(normalizedName);
    await upsertDefaultProfileName(normalizedName);
    return getProfile(normalizedName);
  }

  async function testInlineProfile(profile: Partial<ConnectionProfile>) {
    return testConnection(normalizeInlineProfile(profile));
  }

  async function testSavedProfile(name: string) {
    const normalizedName = requireValue(
      name,
      'profile_name_required',
      'Profile name',
    );
    const profile = await requireProfileRow(normalizedName);
    return testConnection(toConnectionProfile(profile));
  }

  return {
    applyWorkbench,
    applyFixes,
    async close() {
      client.close();
    },
    createScan,
    deleteProfile,
    exportScan,
    getLatestScanId,
    getProfile,
    getScan,
    getScanFindings,
    getScanWorkbench,
    listHistory,
    listProfiles,
    previewFixes,
    previewWorkbench,
    removeWorkbenchItem,
    resolveDatabasePath() {
      return databasePath;
    },
    saveProfile,
    saveWorkbenchItem,
    setDefaultProfile,
    testInlineProfile,
    testSavedProfile,
  };
}

export {resolveDatabasePath};
