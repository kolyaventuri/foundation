import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {DatabaseSync} from 'node:sqlite';
import {afterEach, describe, expect, it} from 'vitest';
import type {InventoryGraph} from '@ha-repair/contracts';
import {createRepairService, renderScanExportMarkdown} from './index';

const temporaryDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'ha-repair-storage-'));
  temporaryDirectories.push(directory);
  return join(directory, 'ha-repair.sqlite');
}

function seedVersionOneDatabase(dbPath: string) {
  const database = new DatabaseSync(dbPath);
  const createdAt = '2026-03-01T08:30:00.000Z';

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE profiles (
        name TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        config_path TEXT,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE scan_runs (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        profile_name TEXT,
        inventory_json TEXT NOT NULL,
        findings_count INTEGER NOT NULL
      );

      CREATE INDEX scan_runs_profile_sequence_idx
      ON scan_runs (profile_name, sequence);

      CREATE TABLE scan_findings (
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

      CREATE UNIQUE INDEX scan_findings_scan_id_finding_id_idx
      ON scan_findings (scan_id, finding_id);

      CREATE INDEX scan_findings_scan_id_idx
      ON scan_findings (scan_id);

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);

    database
      .prepare(
        `
          INSERT INTO profiles (
            name,
            base_url,
            config_path,
            token,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'primary',
        'https://ha.local:8123',
        null,
        'abc123',
        createdAt,
        createdAt,
      );

    database
      .prepare(
        `
          INSERT INTO app_settings (
            key,
            value,
            updated_at
          ) VALUES (?, ?, ?)
        `,
      )
      .run('defaultProfileName', 'primary', createdAt);

    database
      .prepare(
        `
          INSERT INTO scan_runs (
            id,
            created_at,
            profile_name,
            inventory_json,
            findings_count
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        'scan-v1',
        createdAt,
        'primary',
        JSON.stringify(baselineInventory),
        1,
      );

    database
      .prepare(
        `
          INSERT INTO scan_findings (
            scan_id,
            finding_id,
            kind,
            severity,
            title,
            evidence,
            object_ids_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'scan-v1',
        'stale_entity:sensor.kitchen_light_power',
        'stale_entity',
        'low',
        'Stale entity sensor.kitchen_light_power',
        'Entity sensor.kitchen_light_power is marked stale by inventory collection.',
        JSON.stringify(['sensor.kitchen_light_power']),
      );
  } finally {
    database.close();
  }
}

const baselineInventory: InventoryGraph = {
  areas: [
    {
      areaId: 'area.kitchen',
      name: 'Kitchen',
    },
    {
      areaId: 'area.utility',
      name: 'Utility',
    },
  ],
  automations: [],
  devices: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      name: 'Kitchen Light',
    },
  ],
  entities: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      isStale: false,
      name: null,
    },
    {
      assistantExposureBindings: {
        assist: {
          flagKey: 'enabled',
          optionKey: 'conversation',
        },
      },
      assistantExposures: ['assist'],
      areaId: 'area.kitchen',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'sensor.kitchen_light_power',
      isStale: true,
      name: null,
    },
    {
      areaId: 'area.utility',
      deviceId: 'device.ghost',
      disabledBy: null,
      displayName: 'Orphaned Fan',
      entityId: 'switch.orphaned_fan',
      isStale: false,
      name: null,
    },
  ],
  floors: [],
  labels: [],
  scenes: [],
  source: 'mock',
};

const changedInventory: InventoryGraph = {
  areas: [
    {
      areaId: 'area.kitchen',
      name: 'Kitchen',
    },
    {
      areaId: 'area.utility',
      name: 'Utility',
    },
  ],
  automations: [],
  devices: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      name: 'Kitchen Light',
    },
  ],
  entities: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      isStale: false,
      name: null,
    },
    {
      assistantExposureBindings: {
        assist: {
          flagKey: 'enabled',
          optionKey: 'conversation',
        },
      },
      assistantExposures: ['assist'],
      areaId: 'area.kitchen',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'sensor.kitchen_light_power',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.utility',
      deviceId: 'device.ghost',
      disabledBy: null,
      displayName: 'New Orphan',
      entityId: 'switch.new_orphan',
      isStale: false,
      name: null,
    },
  ],
  floors: [],
  labels: [],
  scenes: [],
  source: 'mock',
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
});

describe('storage service', () => {
  it('bootstraps the sqlite database and persists redacted profiles', async () => {
    const dbPath = createTempDatabasePath();
    const firstService = await createRepairService({dbPath});

    try {
      expect(existsSync(dbPath)).toBe(true);

      const profile = await firstService.saveProfile({
        baseUrl: 'https://ha.local:8123',
        name: 'primary',
        token: 'abc123',
      });

      expect(profile).toMatchObject({
        baseUrl: 'https://ha.local:8123',
        hasToken: true,
        isDefault: false,
        name: 'primary',
      });
      expect('token' in profile).toBe(false);

      await firstService.setDefaultProfile('primary');
    } finally {
      await firstService.close();
    }

    const secondService = await createRepairService({dbPath});

    try {
      const profiles = await secondService.listProfiles();
      const [firstProfile] = profiles;
      expect(profiles).toEqual([
        expect.objectContaining({
          hasToken: true,
          isDefault: true,
          name: 'primary',
        }),
      ]);
      expect(firstProfile).toBeDefined();
      expect('token' in firstProfile!).toBe(false);
    } finally {
      await secondService.close();
    }
  });

  it('uses HA_REPAIR_DB_PATH from process.env when no explicit dbPath is passed', async () => {
    const dbPath = createTempDatabasePath();
    const previousDbPath = process.env.HA_REPAIR_DB_PATH;
    process.env.HA_REPAIR_DB_PATH = dbPath;

    const service = await createRepairService();

    try {
      expect(service.resolveDatabasePath()).toBe(dbPath);

      await service.saveProfile({
        baseUrl: 'https://ha.local:8123',
        name: 'env-profile',
        token: 'abc123',
      });

      expect(existsSync(dbPath)).toBe(true);
    } finally {
      await service.close();

      if (previousDbPath === undefined) {
        delete process.env.HA_REPAIR_DB_PATH;
      } else {
        process.env.HA_REPAIR_DB_PATH = previousDbPath;
      }
    }
  });

  it('migrates a schema-v1 database without losing profiles, scans, or history', async () => {
    const dbPath = createTempDatabasePath();
    seedVersionOneDatabase(dbPath);

    const service = await createRepairService({dbPath});

    try {
      const profiles = await service.listProfiles();
      expect(profiles).toEqual([
        expect.objectContaining({
          hasToken: true,
          isDefault: true,
          name: 'primary',
        }),
      ]);

      const scan = await service.getScan('scan-v1');
      expect(scan.profileName).toBe('primary');
      expect(scan.findings).toHaveLength(1);
      expect(scan.diffSummary).toMatchObject({
        previousScanId: null,
        regressedCount: 1,
        resolvedCount: 0,
        unchangedCount: 0,
      });

      const history = await service.listHistory();
      expect(history).toEqual([
        expect.objectContaining({
          findingsCount: 1,
          id: 'scan-v1',
          profileName: 'primary',
        }),
      ]);

      const preview = await service.previewFixes({scanId: 'scan-v1'});
      expect(preview.queue.status).toBe('pending_review');
    } finally {
      await service.close();
    }

    const database = new DatabaseSync(dbPath);

    try {
      expect(
        Number(database.prepare('PRAGMA user_version').get()?.user_version),
      ).toBe(5);
      expect(
        database
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table' AND name = ?
            `,
          )
          .get('fix_queue_entries'),
      ).toBeDefined();
      expect(
        database
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table' AND name = ?
            `,
          )
          .get('scan_workbenches'),
      ).toBeDefined();
      expect(
        database
          .prepare(
            `
              SELECT name
              FROM sqlite_master
              WHERE type = 'table' AND name = ?
            `,
          )
          .get('scan_workbench_items'),
      ).toBeDefined();
    } finally {
      database.close();
    }
  });

  it('persists scans across restarts and computes per-scan diffs', async () => {
    const dbPath = createTempDatabasePath();
    const firstService = await createRepairService({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    let firstScanId = '';

    try {
      const firstScan = await firstService.createScan();
      firstScanId = firstScan.id;

      expect(firstScan.diffSummary).toMatchObject({
        previousScanId: null,
        regressedCount: firstScan.findings.length,
        resolvedCount: 0,
        unchangedCount: 0,
      });
    } finally {
      await firstService.close();
    }

    const secondService = await createRepairService({
      dbPath,
      inventoryProvider: () => changedInventory,
    });

    try {
      const secondScan = await secondService.createScan();

      expect(secondScan.diffSummary).toMatchObject({
        previousScanId: firstScanId,
        regressedCount: 1,
        resolvedCount: 2,
        unchangedCount: 1,
      });
      expect(secondScan.diffSummary.unchangedFindingIds).toContain(
        'duplicate_name:Kitchen Light:area.kitchen',
      );
      expect(secondScan.diffSummary.regressedFindingIds).toContain(
        'orphaned_entity_device:switch.new_orphan',
      );
      expect(secondScan.diffSummary.resolvedFindingIds).toEqual(
        expect.arrayContaining([
          'orphaned_entity_device:switch.orphaned_fan',
          'stale_entity:sensor.kitchen_light_power',
        ]),
      );

      const persistedFirstScan = await secondService.getScan(firstScanId);
      expect(persistedFirstScan.id).toBe(firstScanId);
      expect(persistedFirstScan.audit?.scores.correctness).toEqual(
        expect.any(Number),
      );
      expect(
        persistedFirstScan.findings.find(
          (finding) => finding.id === 'stale_entity:sensor.kitchen_light_power',
        ),
      ).toMatchObject({
        category: 'dead_legacy_objects',
        checkId: 'STALE_ENTITY',
      });

      const history = await secondService.listHistory();
      expect(history).toHaveLength(2);
      expect(history[0]?.id).toBe(secondScan.id);
      expect(history[1]?.id).toBe(firstScanId);
    } finally {
      await secondService.close();
    }
  });

  it('persists reviewed preview snapshots across restarts and rejects invalid apply requests', async () => {
    const dbPath = createTempDatabasePath();
    const firstService = await createRepairService({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    let previewActions: unknown[] = [];
    let previewSelection: {actionIds: string[]; findingIds: string[]} = {
      actionIds: [],
      findingIds: [],
    };
    let previewToken = '';
    let scanId = '';

    try {
      const scan = await firstService.createScan();
      scanId = scan.id;

      await expect(firstService.previewFixes({scanId})).rejects.toMatchObject({
        code: 'fix_input_required',
        statusCode: 400,
      });

      const preview = await firstService.previewFixes({
        inputs: [
          {
            field: 'name',
            findingId: 'duplicate_name:Kitchen Light:area.kitchen',
            targetId: 'light.kitchen_light',
            value: 'Kitchen Light (light.kitchen_light)',
          },
          {
            field: 'name',
            findingId: 'duplicate_name:Kitchen Light:area.kitchen',
            targetId: 'sensor.kitchen_light_power',
            value: 'Kitchen Light (sensor.kitchen_light_power)',
          },
        ],
        scanId,
      });
      previewActions = preview.actions;
      previewSelection = preview.selection;
      previewToken = preview.previewToken;

      expect(preview.actions.map((action) => action.kind)).toEqual(
        expect.arrayContaining([
          'rename_duplicate_name',
          'review_stale_entity',
        ]),
      );
      expect(preview.actions.map((action) => action.id)).toEqual(
        expect.arrayContaining([
          'fix:duplicate_name:Kitchen Light:area.kitchen:rename',
          'fix:stale_entity:sensor.kitchen_light_power:review-stale',
        ]),
      );
      expect(preview.advisories.map((advisory) => advisory.findingId)).toEqual([
        'orphaned_entity_device:switch.orphaned_fan',
      ]);
      expect(preview.previewToken).toEqual(expect.any(String));
      expect(preview.queue.createdAt).toEqual(expect.any(String));
      expect(preview.queue.id).toEqual(expect.any(String));
      expect(preview.queue.status).toBe('pending_review');
      expect(preview.selection.actionIds).toHaveLength(2);
      expect(preview.selection.findingIds).toHaveLength(2);
      const previewAction = preview.actions[0];
      expect(previewAction).toBeDefined();
      if (!previewAction) {
        throw new Error('Expected preview action');
      }

      expect(previewAction.requiresConfirmation).toBe(true);
      expect(previewAction.intent.length).toBeGreaterThan(0);
      expect(previewAction.warnings.length).toBeGreaterThan(0);
      expect(previewAction.commands.length).toBeGreaterThan(0);

      const previewArtifact = previewAction.artifacts[0];
      expect(previewArtifact).toBeDefined();
      if (!previewArtifact) {
        throw new Error('Expected preview artifact');
      }

      expect(previewArtifact.kind).toBe('text_diff');
      expect(previewArtifact.content).toContain('@@ entity_registry/');

      const previewCommand = previewAction.commands[0];
      expect(previewCommand).toBeDefined();
      if (!previewCommand) {
        throw new Error('Expected preview command');
      }

      expect(previewCommand.payload.type).toBe('config/entity_registry/update');
      expect(previewCommand.targetId.length).toBeGreaterThan(0);

      const previewTarget = previewAction.targets[0];
      expect(previewTarget).toBeDefined();
      if (!previewTarget) {
        throw new Error('Expected preview target');
      }

      expect(previewTarget.id.length).toBeGreaterThan(0);
      expect(previewTarget.kind.length).toBeGreaterThan(0);
    } finally {
      await firstService.close();
    }

    const secondService = await createRepairService({
      dbPath,
      inventoryProvider: () => changedInventory,
    });

    try {
      const applyResponse = await secondService.applyFixes({
        actionIds: previewSelection.actionIds,
        dryRun: true,
        previewToken,
        scanId,
      });

      expect(applyResponse.actions).toEqual(previewActions);
      expect(applyResponse.appliedCount).toBe(0);
      expect(applyResponse.mode).toBe('dry_run');
      expect(applyResponse.previewToken).toBe(previewToken);
      expect(applyResponse.queue.id).toEqual(expect.any(String));
      expect(applyResponse.queue.lastAppliedAt).toEqual(expect.any(String));
      expect(applyResponse.queue.status).toBe('dry_run_applied');
      expect(applyResponse.scanId).toBe(scanId);
      expect(applyResponse.selection).toEqual(previewSelection);

      const reversedActionIds = [...previewSelection.actionIds].reverse();
      expect(reversedActionIds).not.toEqual(previewSelection.actionIds);

      await expect(
        secondService.applyFixes({
          actionIds: reversedActionIds,
          dryRun: true,
          previewToken,
          scanId,
        }),
      ).rejects.toMatchObject({
        code: 'preview_mismatch',
        statusCode: 409,
      });

      await expect(
        secondService.applyFixes({
          actionIds: previewSelection.actionIds,
          dryRun: true,
          previewToken: 'invalid-token',
          scanId,
        }),
      ).rejects.toMatchObject({
        code: 'preview_mismatch',
        statusCode: 409,
      });

      await expect(
        secondService.applyFixes({
          actionIds: previewSelection.actionIds,
          previewToken,
          scanId,
        }),
      ).rejects.toMatchObject({
        code: 'dry_run_required',
        statusCode: 400,
      });
    } finally {
      await secondService.close();
    }
  });

  it('persists server-side workbench batches and invalidates previews after staged edits', async () => {
    const dbPath = createTempDatabasePath();
    const firstService = await createRepairService({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    let scanId = '';

    try {
      const scan = await firstService.createScan();
      scanId = scan.id;

      const initialWorkbench = await firstService.getScanWorkbench(scanId);
      expect(initialWorkbench.workbench.stagedCount).toBe(0);
      expect(initialWorkbench.workbench.isPreviewStale).toBe(false);
      expect(
        initialWorkbench.workbench.entries.find(
          (entry) =>
            entry.findingId === 'duplicate_name:Kitchen Light:area.kitchen',
        ),
      ).toMatchObject({
        status: 'recommended',
        treatment: 'actionable',
      });
      expect(
        initialWorkbench.workbench.entries.find(
          (entry) =>
            entry.findingId === 'orphaned_entity_device:switch.orphaned_fan',
        ),
      ).toMatchObject({
        status: 'advisory',
        treatment: 'advisory',
      });

      await expect(
        firstService.saveWorkbenchItem(
          scanId,
          'orphaned_entity_device:switch.orphaned_fan',
          {},
        ),
      ).rejects.toMatchObject({
        code: 'finding_not_stageable',
        statusCode: 400,
      });

      await expect(
        firstService.saveWorkbenchItem(
          scanId,
          'duplicate_name:Kitchen Light:area.kitchen',
          {
            inputs: [
              {
                field: 'name',
                findingId: 'duplicate_name:Kitchen Light:area.kitchen',
                targetId: 'light.kitchen_light',
                value: 'Kitchen Light (light.kitchen_light)',
              },
            ],
          },
        ),
      ).rejects.toMatchObject({
        code: 'fix_input_required',
        statusCode: 400,
      });

      const stagedDuplicate = await firstService.saveWorkbenchItem(
        scanId,
        'duplicate_name:Kitchen Light:area.kitchen',
        {
          inputs: [
            {
              field: 'name',
              findingId: 'duplicate_name:Kitchen Light:area.kitchen',
              targetId: 'light.kitchen_light',
              value: 'Kitchen Light (light.kitchen_light)',
            },
            {
              field: 'name',
              findingId: 'duplicate_name:Kitchen Light:area.kitchen',
              targetId: 'sensor.kitchen_light_power',
              value: 'Kitchen Light (sensor.kitchen_light_power)',
            },
          ],
        },
      );

      expect(stagedDuplicate.entry).toMatchObject({
        findingId: 'duplicate_name:Kitchen Light:area.kitchen',
        status: 'staged',
      });
      expect(stagedDuplicate.workbench.stagedCount).toBe(1);
      expect(stagedDuplicate.workbench.isPreviewStale).toBe(true);
      expect(stagedDuplicate.workbench.latestPreviewToken).toBeUndefined();

      const stagedStale = await firstService.saveWorkbenchItem(
        scanId,
        'stale_entity:sensor.kitchen_light_power',
        {},
      );
      expect(stagedStale.workbench.stagedCount).toBe(2);
      expect(stagedStale.workbench.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            findingId: 'duplicate_name:Kitchen Light:area.kitchen',
            status: 'staged',
          }),
          expect.objectContaining({
            findingId: 'stale_entity:sensor.kitchen_light_power',
            status: 'staged',
          }),
        ]),
      );

      const previewResponse = await firstService.previewWorkbench(scanId);
      expect(previewResponse.preview.selection.findingIds).toEqual([
        'duplicate_name:Kitchen Light:area.kitchen',
        'stale_entity:sensor.kitchen_light_power',
      ]);
      expect(previewResponse.workbench.isPreviewStale).toBe(false);
      expect(previewResponse.workbench.latestPreviewToken).toBe(
        previewResponse.preview.previewToken,
      );

      const applyResponse = await firstService.applyWorkbench({scanId});
      expect(applyResponse.apply.mode).toBe('dry_run');
      expect(applyResponse.apply.queue.status).toBe('dry_run_applied');
      expect(
        applyResponse.workbench.entries.filter(
          (entry) => entry.status === 'dry_run_applied',
        ),
      ).toHaveLength(2);
    } finally {
      await firstService.close();
    }

    const secondService = await createRepairService({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    try {
      const reopenedWorkbench = await secondService.getScanWorkbench(scanId);
      expect(reopenedWorkbench.workbench.stagedCount).toBe(2);
      expect(reopenedWorkbench.workbench.isPreviewStale).toBe(false);
      expect(
        reopenedWorkbench.workbench.entries.filter(
          (entry) => entry.status === 'dry_run_applied',
        ),
      ).toHaveLength(2);

      const updatedStale = await secondService.saveWorkbenchItem(
        scanId,
        'stale_entity:sensor.kitchen_light_power',
        {},
      );
      expect(updatedStale.workbench.isPreviewStale).toBe(true);
      expect(updatedStale.workbench.latestPreviewToken).toBeUndefined();
      expect(
        updatedStale.workbench.entries.filter(
          (entry) => entry.status === 'staged',
        ),
      ).toHaveLength(2);

      const removedStale = await secondService.removeWorkbenchItem(
        scanId,
        'stale_entity:sensor.kitchen_light_power',
      );
      expect(removedStale.deleted).toBe(true);
      expect(removedStale.workbench.stagedCount).toBe(1);
    } finally {
      await secondService.close();
    }
  });

  it('returns audit-ready export bundles and markdown reports', async () => {
    const dbPath = createTempDatabasePath();
    const service = await createRepairService({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    try {
      const scan = await service.createScan();
      const exportBundle = await service.exportScan(scan.id);

      expect(exportBundle.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'fix:duplicate_name:Kitchen Light:area.kitchen:rename',
          }),
        ]),
      );
      expect(exportBundle.advisories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            findingId: 'orphaned_entity_device:switch.orphaned_fan',
          }),
        ]),
      );
      expect(exportBundle.generatedAt).toEqual(expect.any(String));
      expect(exportBundle.scan.id).toBe(scan.id);
      expect(exportBundle.actions).toHaveLength(2);
      expect(exportBundle.scan.audit?.scores.maintainability).toEqual(
        expect.any(Number),
      );

      const markdown = renderScanExportMarkdown(exportBundle);
      const normalizedMarkdown = markdown
        .replace(/Generated: .+/u, 'Generated: <generatedAt>')
        .replace(/Scan ID: .+/u, 'Scan ID: <scanId>')
        .replace(/Scanned at: .+/u, 'Scanned at: <scannedAt>');

      expect(normalizedMarkdown).toContain('## Audit Summary');
      expect(normalizedMarkdown).toContain('Conflict candidate finding IDs');
      expect(normalizedMarkdown).toContain('Intent clusters: None');
      expect(normalizedMarkdown).toContain('Check ID: STALE_ENTITY');
      expect(normalizedMarkdown).toContain('## Fix Actions');
      expect(normalizedMarkdown).toContain(
        'Commands: No literal Home Assistant payloads generated yet.',
      );
      expect(normalizedMarkdown).toContain(
        'Definition: A stale entity is present in the registry, but it has no live state or currently reports as unavailable.',
      );
      expect(normalizedMarkdown).toContain(
        'Definition: This fix stages entity-registry name updates so the colliding entities stop sharing the same in-area user-facing label.',
      );
      expect(normalizedMarkdown).toContain(
        'Review focus: Confirm no dashboards, automations, templates, or assistant flows still depend on the entity before disabling it.',
      );
      expect(normalizedMarkdown).toContain('## Advisory Findings');
      expect(normalizedMarkdown).toContain(
        'This finding stays advisory-only because there is no supported literal Home Assistant mutation for clearing the broken device link.',
      );
      expect(normalizedMarkdown).toContain(
        'Definition: An orphaned entity/device link means the entity registry entry still points at a device ID that no longer exists in the device registry.',
      );
      expect(normalizedMarkdown).toContain(
        '"type": "config/entity_registry/update"',
      );
    } finally {
      await service.close();
    }
  });
});
