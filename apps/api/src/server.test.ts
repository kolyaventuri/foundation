import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {
  ConnectionTestResponse,
  FixApplyResponse,
  FixPreviewResponse,
  InventoryGraph,
  ProfileListResponse,
  ProfileReadResponse,
  ScanCreateResponse,
  ScanFindingsResponse,
  ScanHistoryResponse,
  ScanReadResponse,
} from '@ha-repair/contracts';
import {createServer} from './server';

const temporaryDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'ha-repair-api-'));
  temporaryDirectories.push(directory);
  return join(directory, 'ha-repair.sqlite');
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
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
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      isStale: false,
      name: null,
    },
    {
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'sensor.kitchen_light_power',
      isStale: true,
      name: null,
    },
    {
      deviceId: 'device.ghost',
      disabledBy: null,
      displayName: 'Orphaned Fan',
      entityId: 'switch.orphaned_fan',
      isStale: false,
      name: null,
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
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      isStale: false,
      name: null,
    },
    {
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'sensor.kitchen_light_power',
      isStale: false,
      name: null,
    },
    {
      deviceId: 'device.ghost',
      disabledBy: null,
      displayName: 'New Orphan',
      entityId: 'switch.new_orphan',
      isStale: false,
      name: null,
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

describe('api server', () => {
  it('tests inline profile connections', async () => {
    const server = await createServer({
      dbPath: createTempDatabasePath(),
    });

    try {
      const response = await server.inject({
        method: 'POST',
        payload: {
          baseUrl: 'https://ha.local:8123',
          token: 'abc123',
        },
        url: '/api/profiles/test',
      });

      expect(response.statusCode).toBe(200);

      const body = parseJson<ConnectionTestResponse>(response.body);
      expect(body.result.ok).toBe(true);
      expect(body.result.capabilities.labels).toBe('supported');
    } finally {
      await server.close();
    }
  });

  it('supports persisted profile CRUD with redacted responses', async () => {
    const server = await createServer({
      dbPath: createTempDatabasePath(),
    });

    try {
      const createResponse = await server.inject({
        method: 'POST',
        payload: {
          baseUrl: 'https://ha.local:8123',
          name: 'primary',
          token: 'abc123',
        },
        url: '/api/profiles',
      });

      expect(createResponse.statusCode).toBe(200);
      const created = parseJson<ProfileReadResponse>(createResponse.body);
      expect(created.profile).toMatchObject({
        hasToken: true,
        isDefault: false,
        name: 'primary',
      });
      expect('token' in created.profile).toBe(false);

      const defaultResponse = await server.inject({
        method: 'POST',
        url: '/api/profiles/primary/default',
      });

      expect(defaultResponse.statusCode).toBe(200);

      const listResponse = await server.inject({
        method: 'GET',
        url: '/api/profiles',
      });

      expect(listResponse.statusCode).toBe(200);
      const listed = parseJson<ProfileListResponse>(listResponse.body);
      expect(listed.profiles).toEqual([
        expect.objectContaining({
          hasToken: true,
          isDefault: true,
          name: 'primary',
        }),
      ]);

      const readResponse = await server.inject({
        method: 'GET',
        url: '/api/profiles/primary',
      });

      expect(readResponse.statusCode).toBe(200);

      const storedTestResponse = await server.inject({
        method: 'POST',
        url: '/api/profiles/primary/test',
      });

      expect(storedTestResponse.statusCode).toBe(200);

      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: '/api/profiles/primary',
      });

      expect(deleteResponse.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('persists scans across restarts and serves diffs, previews, and dry-run apply', async () => {
    const dbPath = createTempDatabasePath();
    const firstServer = await createServer({
      dbPath,
      inventoryProvider: () => baselineInventory,
    });

    let firstScanId = '';

    try {
      await firstServer.inject({
        method: 'POST',
        payload: {
          baseUrl: 'https://ha.local:8123',
          name: 'primary',
          token: 'abc123',
        },
        url: '/api/profiles',
      });

      await firstServer.inject({
        method: 'POST',
        url: '/api/profiles/primary/default',
      });

      const firstScanResponse = await firstServer.inject({
        method: 'POST',
        url: '/api/scans',
      });

      expect(firstScanResponse.statusCode).toBe(200);
      const firstScan = parseJson<ScanCreateResponse>(firstScanResponse.body);
      firstScanId = firstScan.scan.id;
      expect(firstScan.scan.profileName).toBe('primary');
      expect(firstScan.scan.diffSummary.regressedCount).toBe(
        firstScan.scan.findings.length,
      );
    } finally {
      await firstServer.close();
    }

    const secondServer = await createServer({
      dbPath,
      inventoryProvider: () => changedInventory,
    });

    try {
      const secondScanResponse = await secondServer.inject({
        method: 'POST',
        url: '/api/scans',
      });

      expect(secondScanResponse.statusCode).toBe(200);
      const secondScan = parseJson<ScanCreateResponse>(secondScanResponse.body);

      const readResponse = await secondServer.inject({
        method: 'GET',
        url: `/api/scans/${secondScan.scan.id}`,
      });

      expect(readResponse.statusCode).toBe(200);
      const scanBody = parseJson<ScanReadResponse>(readResponse.body);
      expect(scanBody.scan.diffSummary).toMatchObject({
        previousScanId: firstScanId,
        regressedCount: 1,
        resolvedCount: 2,
        unchangedCount: 1,
      });

      const findingsResponse = await secondServer.inject({
        method: 'GET',
        url: `/api/scans/${secondScan.scan.id}/findings`,
      });

      expect(findingsResponse.statusCode).toBe(200);
      const findingsBody = parseJson<ScanFindingsResponse>(
        findingsResponse.body,
      );
      expect(findingsBody.findings).toHaveLength(2);

      const historyResponse = await secondServer.inject({
        method: 'GET',
        url: '/api/history',
      });

      expect(historyResponse.statusCode).toBe(200);
      const historyBody = parseJson<ScanHistoryResponse>(historyResponse.body);
      expect(historyBody.scans).toHaveLength(2);
      expect(historyBody.scans[0]?.id).toBe(secondScan.scan.id);

      const previewResponse = await secondServer.inject({
        method: 'POST',
        payload: {
          inputs: [
            {
              field: 'name',
              findingId: 'duplicate_name:Kitchen Light',
              targetId: 'light.kitchen_light',
              value: 'Kitchen Light (light.kitchen_light)',
            },
            {
              field: 'name',
              findingId: 'duplicate_name:Kitchen Light',
              targetId: 'sensor.kitchen_light_power',
              value: 'Kitchen Light (sensor.kitchen_light_power)',
            },
          ],
          scanId: secondScan.scan.id,
        },
        url: '/api/fixes/preview',
      });

      expect(previewResponse.statusCode).toBe(200);
      const previewBody = parseJson<FixPreviewResponse>(previewResponse.body);
      expect(previewBody.actions).toHaveLength(1);
      expect(previewBody.advisories).toHaveLength(1);
      expect(previewBody.previewToken).toEqual(expect.any(String));
      expect(previewBody.queue.createdAt).toEqual(expect.any(String));
      expect(previewBody.queue.id).toEqual(expect.any(String));
      expect(previewBody.queue.status).toBe('pending_review');
      expect(previewBody.selection.actionIds).toHaveLength(1);
      const previewAction = previewBody.actions[0];
      expect(previewAction).toBeDefined();
      if (!previewAction) {
        throw new Error('Expected preview action');
      }

      expect(previewAction.requiresConfirmation).toBe(true);

      const previewArtifact = previewAction.artifacts[0];
      expect(previewArtifact).toBeDefined();
      if (!previewArtifact) {
        throw new Error('Expected preview artifact');
      }

      expect(previewArtifact.content).toContain('@@ entity_registry/');

      const previewCommand = previewAction.commands[0];
      expect(previewCommand).toBeDefined();
      if (!previewCommand) {
        throw new Error('Expected preview command');
      }

      expect(previewCommand.payload.type).toBe('config/entity_registry/update');

      const applyResponse = await secondServer.inject({
        method: 'POST',
        payload: {
          actionIds: previewBody.selection.actionIds,
          dryRun: true,
          previewToken: previewBody.previewToken,
          scanId: secondScan.scan.id,
        },
        url: '/api/fixes/apply',
      });

      expect(applyResponse.statusCode).toBe(200);
      const applyBody = parseJson<FixApplyResponse>(applyResponse.body);
      expect(applyBody.appliedCount).toBe(0);
      expect(applyBody.mode).toBe('dry_run');
      expect(applyBody.previewToken).toBe(previewBody.previewToken);
      expect(applyBody.queue.id).toBe(previewBody.queue.id);
      expect(applyBody.queue.lastAppliedAt).toEqual(expect.any(String));
      expect(applyBody.queue.status).toBe('dry_run_applied');
      expect(applyBody.scanId).toBe(secondScan.scan.id);
      expect(applyBody.selection).toEqual(previewBody.selection);

      const rejectedApply = await secondServer.inject({
        method: 'POST',
        payload: {
          actionIds: ['fix:duplicate_name:Kitchen Light:rename:unexpected'],
          dryRun: true,
          previewToken: previewBody.previewToken,
          scanId: secondScan.scan.id,
        },
        url: '/api/fixes/apply',
      });

      expect(rejectedApply.statusCode).toBe(409);

      const rejectedToken = await secondServer.inject({
        method: 'POST',
        payload: {
          actionIds: previewBody.selection.actionIds,
          dryRun: true,
          previewToken: 'invalid-token',
          scanId: secondScan.scan.id,
        },
        url: '/api/fixes/apply',
      });

      expect(rejectedToken.statusCode).toBe(409);
    } finally {
      await secondServer.close();
    }
  });
});
