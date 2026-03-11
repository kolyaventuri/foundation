import {createHash} from 'node:crypto';
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
  FindingKind,
  FindingSeverity,
  FixAction,
  FixApplyRequest,
  FixApplyResponse,
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
} from '@ha-repair/contracts';
import {collectMockInventory, testConnection} from '@ha-repair/ha-client';
import {createFixActions, runScan} from '@ha-repair/scan-engine';

const defaultDatabasePath = './data/ha-repair.sqlite';
const currentSchemaVersion = 1;
const defaultProfileSettingKey = 'defaultProfileName';

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

type ProfilesRow = typeof profilesTable.$inferSelect;
type ScanRunRow = typeof scanRunsTable.$inferSelect;
type ScanFindingRow = typeof scanFindingsTable.$inferSelect;

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
  close: () => Promise<void>;
  createScan: (input?: {profileName?: string}) => Promise<ScanDetail>;
  deleteProfile: (name: string) => Promise<ProfileDeleteResponse>;
  exportScan: (scanId?: string) => Promise<ScanExportBundle>;
  getLatestScanId: () => Promise<string | undefined>;
  getProfile: (name: string) => Promise<SavedConnectionProfile>;
  getScan: (scanId: string) => Promise<ScanDetail>;
  getScanFindings: (scanId: string) => Promise<Finding[]>;
  listHistory: () => Promise<ScanHistoryEntry[]>;
  listProfiles: () => Promise<SavedConnectionProfile[]>;
  previewFixes: (request: FixPreviewRequest) => Promise<FixPreviewResponse>;
  resolveDatabasePath: () => string;
  saveProfile: (profile: ConnectionProfile) => Promise<SavedConnectionProfile>;
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

  database.exec(`
    PRAGMA foreign_keys = ON;

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

    PRAGMA user_version = 1;
  `);
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
      profilesTable,
      scanFindingsTable,
      scanRunsTable,
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

function createPreviewToken(scanId: string, actions: FixAction[]): string {
  const canonicalActions = [...actions].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  return createHash('sha256')
    .update(
      JSON.stringify({
        actions: canonicalActions,
        scanId,
      }),
    )
    .digest('hex');
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

  function requireSelectedActions(
    actions: FixAction[],
    actionIds: string[],
  ): FixAction[] {
    if (actionIds.length === 0) {
      throw createServiceError(
        'action_selection_required',
        400,
        'Select at least one reviewed action before apply.',
      );
    }

    const requestedIds = new Set(actionIds);
    const selected = actions.filter((action) => requestedIds.has(action.id));

    if (selected.length !== requestedIds.size) {
      const foundIds = new Set(selected.map((action) => action.id));
      const missing = [...requestedIds].filter(
        (actionId) => !foundIds.has(actionId),
      );
      throw createServiceError(
        'action_not_found',
        400,
        `Unknown action ids: ${missing.join(', ')}`,
      );
    }

    return selected;
  }

  async function getFixActionsForScan(scanId: string): Promise<FixAction[]> {
    const scan = await requireScanDetail(scanId);
    return createFixActions(scan.inventory, scan.findings);
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
    const actions = createFixActions(scan.inventory, findings);
    const selection = createFixSelection(actions);

    return {
      actions,
      generatedAt: new Date().toISOString(),
      previewToken: createPreviewToken(request.scanId, actions),
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

    const selectedActions = requireSelectedActions(
      await getFixActionsForScan(request.scanId),
      request.actionIds,
    );
    const expectedPreviewToken = createPreviewToken(
      request.scanId,
      selectedActions,
    );

    if (expectedPreviewToken !== request.previewToken) {
      throw createServiceError(
        'preview_mismatch',
        409,
        'The requested dry-run actions do not match the reviewed preview token. Generate a new preview before applying.',
      );
    }

    const selection = createFixSelection(selectedActions);

    return {
      actions: selectedActions,
      appliedCount: 0,
      mode: 'dry_run' as const,
      previewToken: expectedPreviewToken,
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

    return {
      diffSummary: scan.diffSummary,
      findings: scan.findings,
      scan: {
        createdAt: scan.createdAt,
        id: scan.id,
        inventory: scan.inventory,
        profileName: scan.profileName,
      },
    };
  }

  async function getScan(scanId: string) {
    return requireScanDetail(scanId);
  }

  async function getScanFindings(scanId: string) {
    await requireScanRow(scanId);
    return readFindings(scanId);
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
    listHistory,
    listProfiles,
    previewFixes,
    resolveDatabasePath() {
      return databasePath;
    },
    saveProfile,
    setDefaultProfile,
    testInlineProfile,
    testSavedProfile,
  };
}

export {resolveDatabasePath};
