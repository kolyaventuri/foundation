import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {InventoryGraph} from '@ha-repair/contracts';
import {createRepairService} from './index';

const temporaryDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'ha-repair-storage-'));
  temporaryDirectories.push(directory);
  return join(directory, 'ha-repair.sqlite');
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

  it('returns deterministic preview actions, dry-run apply output, and export bundles', async () => {
    const dbPath = createTempDatabasePath();
    const service = await createRepairService({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    try {
      const scan = await service.createScan();
      const preview = await service.previewFixes({
        scanId: scan.id,
      });

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

      const applyResponse = await service.applyFixes({
        actionIds: preview.selection.actionIds,
        dryRun: true,
        previewToken: preview.previewToken,
        scanId: scan.id,
      });
      expect(applyResponse).toMatchObject({
        appliedCount: 0,
        mode: 'dry_run',
        previewToken: preview.previewToken,
        scanId: scan.id,
        selection: preview.selection,
      });

      await expect(
        service.applyFixes({
          actionIds: preview.selection.actionIds,
          dryRun: true,
          previewToken: 'stale-token',
          scanId: scan.id,
        }),
      ).rejects.toMatchObject({
        code: 'preview_mismatch',
      });

      const exportBundle = await service.exportScan();
      expect(exportBundle.scan.id).toBe(scan.id);
      expect(exportBundle.findings).toHaveLength(scan.findings.length);
      expect(exportBundle.diffSummary.regressedCount).toBe(
        scan.findings.length,
      );
    } finally {
      await service.close();
    }
  });
});
