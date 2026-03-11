import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
  devices: [
    {
      deviceId: 'device.kitchen_light',
      name: 'Kitchen Light',
    },
  ],
  entities: [
    {
      deviceId: 'device.kitchen_light',
      entityId: 'light.kitchen_light',
      friendlyName: 'Kitchen Light',
      isStale: false,
    },
    {
      entityId: 'sensor.kitchen_light_power',
      friendlyName: 'Kitchen Light',
      isStale: true,
    },
    {
      deviceId: 'device.ghost',
      entityId: 'switch.orphaned_fan',
      friendlyName: 'Orphaned Fan',
      isStale: false,
    },
  ],
  source: 'mock',
};

const changedInventory: InventoryGraph = {
  devices: [
    {
      deviceId: 'device.kitchen_light',
      name: 'Kitchen Light',
    },
  ],
  entities: [
    {
      deviceId: 'device.kitchen_light',
      entityId: 'light.kitchen_light',
      friendlyName: 'Kitchen Light',
      isStale: false,
    },
    {
      entityId: 'sensor.kitchen_light_power',
      friendlyName: 'Kitchen Light',
      isStale: false,
    },
    {
      deviceId: 'device.ghost',
      entityId: 'switch.new_orphan',
      friendlyName: 'New Orphan',
      isStale: false,
    },
  ],
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
      ).toBe(2);
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
        'duplicate_name:Kitchen Light',
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

      const preview = await firstService.previewFixes({scanId});
      previewActions = preview.actions;
      previewSelection = preview.selection;
      previewToken = preview.previewToken;

      expect(preview.actions.map((action) => action.kind)).toEqual(
        expect.arrayContaining([
          'rename_duplicate_name',
          'repair_orphaned_entity_device',
          'review_stale_entity',
        ]),
      );
      expect(preview.actions.map((action) => action.id)).toEqual(
        expect.arrayContaining([
          'fix:duplicate_name:Kitchen Light:rename',
          'fix:orphaned_entity_device:switch.orphaned_fan:repair-link',
          'fix:stale_entity:sensor.kitchen_light_power:review-stale',
        ]),
      );
      expect(preview.previewToken).toEqual(expect.any(String));
      expect(preview.queue.createdAt).toEqual(expect.any(String));
      expect(preview.queue.id).toEqual(expect.any(String));
      expect(preview.queue.status).toBe('pending_review');
      expect(preview.selection.actionIds).toHaveLength(3);
      expect(preview.selection.findingIds).toHaveLength(3);
      const previewAction = preview.actions[0];
      expect(previewAction).toBeDefined();
      if (!previewAction) {
        throw new Error('Expected preview action');
      }

      expect(previewAction.requiresConfirmation).toBe(true);
      expect(previewAction.intent.length).toBeGreaterThan(0);
      expect(previewAction.warnings.length).toBeGreaterThan(0);

      const previewArtifact = previewAction.artifacts[0];
      expect(previewArtifact).toBeDefined();
      if (!previewArtifact) {
        throw new Error('Expected preview artifact');
      }

      expect(previewArtifact.kind).toBe('text_diff');
      expect(previewArtifact.content).toContain('@@ entity/');

      const previewEdit = previewAction.edits[0];
      expect(previewEdit).toBeDefined();
      if (!previewEdit) {
        throw new Error('Expected preview edit');
      }

      expect(previewEdit.fieldPath.length).toBeGreaterThan(0);
      expect(previewEdit.targetId.length).toBeGreaterThan(0);

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
            id: 'fix:duplicate_name:Kitchen Light:rename',
          }),
        ]),
      );
      expect(exportBundle.generatedAt).toEqual(expect.any(String));
      expect(exportBundle.scan.id).toBe(scan.id);
      expect(exportBundle.actions).toHaveLength(3);

      const markdown = renderScanExportMarkdown(exportBundle);
      const normalizedMarkdown = markdown
        .replace(/Generated: .+/u, 'Generated: <generatedAt>')
        .replace(/Scan ID: .+/u, 'Scan ID: <scanId>')
        .replace(/Scanned at: .+/u, 'Scanned at: <scannedAt>');

      expect(normalizedMarkdown).toMatchInlineSnapshot(`
        "# Home Assistant Repair Report

        Generated: <generatedAt>
        Scan ID: <scanId>
        Profile: No profile
        Scanned at: <scannedAt>
        Inventory source: mock

        ## Diff Summary
        - Previous scan: None
        - Regressed count: 3
        - Regressed finding IDs: duplicate_name:Kitchen Light, orphaned_entity_device:switch.orphaned_fan, stale_entity:sensor.kitchen_light_power
        - Resolved count: 0
        - Resolved finding IDs: None
        - Unchanged count: 0
        - Unchanged finding IDs: None

        ## Findings
        ### Duplicate name: Kitchen Light
        - ID: duplicate_name:Kitchen Light
        - Kind: duplicate_name
        - Severity: medium
        - Evidence: Found 2 entities named "Kitchen Light".
        - Objects: light.kitchen_light, sensor.kitchen_light_power

        ### Orphaned entity/device link for switch.orphaned_fan
        - ID: orphaned_entity_device:switch.orphaned_fan
        - Kind: orphaned_entity_device
        - Severity: high
        - Evidence: Entity switch.orphaned_fan references missing device device.ghost.
        - Objects: switch.orphaned_fan, device.ghost

        ### Stale entity sensor.kitchen_light_power
        - ID: stale_entity:sensor.kitchen_light_power
        - Kind: stale_entity
        - Severity: low
        - Evidence: Entity sensor.kitchen_light_power is marked stale by inventory collection.
        - Objects: sensor.kitchen_light_power

        ## Fix Actions

        ### Rename duplicate entities for Kitchen Light
        - Action ID: fix:duplicate_name:Kitchen Light:rename
        - Finding ID: duplicate_name:Kitchen Light
        - Kind: rename_duplicate_name
        - Risk: medium
        - Intent: Rename every duplicated entity label so each entity can be reviewed and addressed unambiguously.
        - Rationale: Duplicate friendly names create ambiguous cleanup and assistant experiences.
        - Requires confirmation: yes
        - Targets: Kitchen Light (light.kitchen_light) [entity], Kitchen Light (sensor.kitchen_light_power) [entity]
        - Edits: Rename light.kitchen_light to remove the duplicate friendly name collision. (friendlyName: Kitchen Light -> Kitchen Light (light.kitchen_light)), Rename sensor.kitchen_light_power to remove the duplicate friendly name collision. (friendlyName: Kitchen Light -> Kitchen Light (sensor.kitchen_light_power))
        - Warnings: Renaming entities can affect dashboards, automations, and voice-assistant phrases that reference the current friendly name.
        - Steps: Review each entity sharing the duplicate name., Choose a disambiguated friendly name for each duplicate entity., Apply the naming change after confirming the new labels in Home Assistant.
        - Artifact: friendly-name-review.diff (text_diff)
        \`\`\`diff
        @@ entity/light.kitchen_light
        - friendlyName: "Kitchen Light"
        + friendlyName: "Kitchen Light (light.kitchen_light)"
        @@ entity/sensor.kitchen_light_power
        - friendlyName: "Kitchen Light"
        + friendlyName: "Kitchen Light (sensor.kitchen_light_power)"
        \`\`\`

        ### Repair missing device link for switch.orphaned_fan
        - Action ID: fix:orphaned_entity_device:switch.orphaned_fan:repair-link
        - Finding ID: orphaned_entity_device:switch.orphaned_fan
        - Kind: repair_orphaned_entity_device
        - Risk: high
        - Intent: Remove the broken entity-to-device link so the registry no longer references a missing device.
        - Rationale: Missing device links usually indicate stale registry state or a partially removed integration.
        - Requires confirmation: yes
        - Targets: Orphaned Fan (switch.orphaned_fan) [entity], Missing device reference device.ghost [device]
        - Edits: Clear the broken device link from switch.orphaned_fan. (deviceId: device.ghost -> null)
        - Warnings: Clearing the wrong device link can break entity grouping, dashboards, or automation assumptions tied to the current registry record.
        - Steps: Confirm whether the referenced device still exists in Home Assistant., Relink the entity to the correct device or remove the broken registry entry., Rescan after the registry cleanup to confirm the orphan is gone.
        - Artifact: entity-device-link-review.diff (text_diff)
        \`\`\`diff
        @@ entity/switch.orphaned_fan
        - deviceId: "device.ghost"
        + deviceId: null
        \`\`\`

        ### Review stale entity sensor.kitchen_light_power
        - Action ID: fix:stale_entity:sensor.kitchen_light_power:review-stale
        - Finding ID: stale_entity:sensor.kitchen_light_power
        - Kind: review_stale_entity
        - Risk: low
        - Intent: Disable the stale entity in the registry so it no longer behaves like an active automation surface.
        - Rationale: Stale entities often represent integrations or helpers that can be disabled or removed safely.
        - Requires confirmation: yes
        - Targets: Kitchen Light (sensor.kitchen_light_power) [entity]
        - Edits: Mark sensor.kitchen_light_power as user-disabled in the entity registry. (disabledBy: null -> user)
        - Warnings: Disabling an entity will stop downstream dashboards or automations from seeing it as an active source.
        - Steps: Verify the entity is no longer needed., Disable or remove the stale entity from the registry or source integration., Run another scan to confirm the stale entity finding resolves.
        - Artifact: stale-entity-review.diff (text_diff)
        \`\`\`diff
        @@ entity/sensor.kitchen_light_power
        - disabledBy: null
        + disabledBy: "user"
        \`\`\`"
      `);
    } finally {
      await service.close();
    }
  });
});
