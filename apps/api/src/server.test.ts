import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {
  BackupCheckpointResponse,
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
  ScanWorkbenchResponse,
  WorkbenchApplyResponse,
  WorkbenchItemDeleteResponse,
  WorkbenchItemMutationResponse,
  WorkbenchPreviewResponse,
} from '@ha-repair/contracts';
import {createLiveHomeAssistantMocks} from '../../../test/live-home-assistant';
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

async function withLiveHomeAssistantGlobals<T>(callback: () => Promise<T>) {
  const mocks = createLiveHomeAssistantMocks();
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  globalThis.fetch = mocks.fetch;
  globalThis.WebSocket = mocks.WebSocketCtor as unknown as typeof WebSocket;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;

    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket;
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
}

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
      expect(body.result.capabilities.labelRegistry.status).toBe('supported');
    } finally {
      await server.close();
    }
  });

  it('accepts live mode on inline and saved profile connection-test routes', async () => {
    await withLiveHomeAssistantGlobals(async () => {
      const server = await createServer({
        dbPath: createTempDatabasePath(),
      });

      try {
        const createProfileResponse = await server.inject({
          method: 'POST',
          payload: {
            baseUrl: 'http://ha.local:8123',
            name: 'primary',
            token: 'abc123',
          },
          url: '/api/profiles',
        });

        expect(createProfileResponse.statusCode).toBe(200);

        const inlineResponse = await server.inject({
          method: 'POST',
          payload: {
            baseUrl: 'http://ha.local:8123',
            mode: 'live',
            token: 'abc123',
          },
          url: '/api/profiles/test',
        });

        expect(inlineResponse.statusCode).toBe(200);
        expect(
          parseJson<ConnectionTestResponse>(inlineResponse.body),
        ).toMatchObject({
          result: {
            mode: 'live',
            ok: true,
          },
        });

        const savedResponse = await server.inject({
          method: 'POST',
          payload: {
            mode: 'live',
          },
          url: '/api/profiles/primary/test',
        });

        expect(savedResponse.statusCode).toBe(200);
        expect(
          parseJson<ConnectionTestResponse>(savedResponse.body),
        ).toMatchObject({
          result: {
            mode: 'live',
            ok: true,
          },
        });
      } finally {
        await server.close();
      }
    });
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
          actionIds: [
            'fix:duplicate_name:Kitchen Light:area.kitchen:rename:unexpected',
          ],
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

  it('serves persisted workbench staging, preview, and dry-run apply endpoints', async () => {
    const server = await createServer({
      dbPath: createTempDatabasePath(),
      inventoryProvider: () => baselineInventory,
    });

    try {
      const scanResponse = await server.inject({
        method: 'POST',
        url: '/api/scans',
      });

      expect(scanResponse.statusCode).toBe(200);
      const scan = parseJson<ScanCreateResponse>(scanResponse.body);

      const initialWorkbenchResponse = await server.inject({
        method: 'GET',
        url: `/api/scans/${scan.scan.id}/workbench`,
      });

      expect(initialWorkbenchResponse.statusCode).toBe(200);
      const initialWorkbench = parseJson<ScanWorkbenchResponse>(
        initialWorkbenchResponse.body,
      );
      expect(initialWorkbench.workbench.stagedCount).toBe(0);
      expect(initialWorkbench.workbench.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            findingId: 'duplicate_name:Kitchen Light:area.kitchen',
            status: 'recommended',
          }),
          expect.objectContaining({
            findingId: 'orphaned_entity_device:switch.orphaned_fan',
            status: 'advisory',
          }),
        ]),
      );

      const rejectedAdvisoryStage = await server.inject({
        method: 'PUT',
        payload: {},
        url: `/api/scans/${scan.scan.id}/workbench/items/orphaned_entity_device:switch.orphaned_fan`,
      });

      expect(rejectedAdvisoryStage.statusCode).toBe(400);

      const stagedDuplicateResponse = await server.inject({
        method: 'PUT',
        payload: {
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
        url: `/api/scans/${scan.scan.id}/workbench/items/${encodeURIComponent('duplicate_name:Kitchen Light:area.kitchen')}`,
      });

      expect(stagedDuplicateResponse.statusCode).toBe(200);
      const stagedDuplicate = parseJson<WorkbenchItemMutationResponse>(
        stagedDuplicateResponse.body,
      );
      expect(stagedDuplicate.entry.status).toBe('staged');
      expect(stagedDuplicate.workbench.stagedCount).toBe(1);

      const stagedStaleResponse = await server.inject({
        method: 'PUT',
        payload: {},
        url: `/api/scans/${scan.scan.id}/workbench/items/stale_entity:sensor.kitchen_light_power`,
      });

      expect(stagedStaleResponse.statusCode).toBe(200);

      const previewResponse = await server.inject({
        method: 'POST',
        url: `/api/scans/${scan.scan.id}/workbench/preview`,
      });

      expect(previewResponse.statusCode).toBe(200);
      const previewBody = parseJson<WorkbenchPreviewResponse>(
        previewResponse.body,
      );
      expect(previewBody.preview.selection.findingIds).toEqual([
        'duplicate_name:Kitchen Light:area.kitchen',
        'stale_entity:sensor.kitchen_light_power',
      ]);
      expect(previewBody.workbench.latestPreviewToken).toBe(
        previewBody.preview.previewToken,
      );
      expect(previewBody.workbench.isPreviewStale).toBe(false);

      const applyResponse = await server.inject({
        method: 'POST',
        payload: {
          dryRun: true,
        },
        url: `/api/scans/${scan.scan.id}/workbench/apply`,
      });

      expect(applyResponse.statusCode).toBe(200);
      const applyBody = parseJson<WorkbenchApplyResponse>(applyResponse.body);
      expect(applyBody.apply.queue.status).toBe('dry_run_applied');
      expect(
        applyBody.workbench.entries.filter(
          (entry) => entry.status === 'dry_run_applied',
        ),
      ).toHaveLength(2);

      const removedResponse = await server.inject({
        method: 'DELETE',
        url: `/api/scans/${scan.scan.id}/workbench/items/stale_entity:sensor.kitchen_light_power`,
      });

      expect(removedResponse.statusCode).toBe(200);
      const removedBody = parseJson<WorkbenchItemDeleteResponse>(
        removedResponse.body,
      );
      expect(removedBody.deleted).toBe(true);
      expect(removedBody.workbench.isPreviewStale).toBe(true);
      expect(removedBody.workbench.stagedCount).toBe(1);

      const staleApplyResponse = await server.inject({
        method: 'POST',
        payload: {
          dryRun: true,
        },
        url: `/api/scans/${scan.scan.id}/workbench/apply`,
      });

      expect(staleApplyResponse.statusCode).toBe(409);
    } finally {
      await server.close();
    }
  });

  it('creates and returns persisted backup checkpoints for live scans', async () => {
    const server = await createServer({
      backupCheckpointProvider: async ({scanFingerprint}) => ({
        createdAt: '2026-03-11T12:00:00.000Z',
        id: 'checkpoint-1',
        method: 'supervisor',
        notes: ['Backup checkpoint created and downloaded locally.'],
        scanFingerprint,
        status: 'created',
        summary: 'Backup checkpoint created and downloaded locally.',
      }),
      dbPath: createTempDatabasePath(),
      scanCollector: async () => ({
        connection: {
          capabilities: {
            areaRegistry: {status: 'supported'},
            automationMetadata: {status: 'supported'},
            backups: {status: 'supported'},
            configFiles: {status: 'supported'},
            deviceRegistry: {status: 'supported'},
            entityRegistry: {status: 'supported'},
            exposureControl: {status: 'supported'},
            floorRegistry: {status: 'supported'},
            labelRegistry: {status: 'supported'},
            sceneMetadata: {status: 'supported'},
          },
          checkedAt: '2026-03-11T11:59:00.000Z',
          endpoint: 'http://ha.local:8123',
          latencyMs: 12,
          mode: 'live',
          ok: true,
          warnings: [],
        },
        inventory: {
          ...baselineInventory,
          source: 'live',
        },
        notes: [],
        passes: [
          {
            completedAt: '2026-03-11T11:59:01.000Z',
            durationMs: 12,
            name: 'connection',
            startedAt: '2026-03-11T11:59:00.000Z',
            status: 'completed',
            summary: 'Connected to Home Assistant.',
          },
          {
            completedAt: '2026-03-11T11:59:02.000Z',
            durationMs: 18,
            name: 'inventory',
            startedAt: '2026-03-11T11:59:01.000Z',
            status: 'completed',
            summary: 'Loaded live inventory.',
          },
          {
            completedAt: '2026-03-11T11:59:03.000Z',
            durationMs: 5,
            name: 'config',
            startedAt: '2026-03-11T11:59:02.000Z',
            status: 'skipped',
            summary: 'Deep config analysis was not requested.',
          },
        ],
      }),
    });

    try {
      const createProfileResponse = await server.inject({
        method: 'POST',
        payload: {
          baseUrl: 'http://ha.local:8123',
          name: 'primary',
          token: 'abc123',
        },
        url: '/api/profiles',
      });

      expect(createProfileResponse.statusCode).toBe(200);

      const scanResponse = await server.inject({
        method: 'POST',
        payload: {
          mode: 'live',
          profileName: 'primary',
        },
        url: '/api/scans',
      });

      expect(scanResponse.statusCode).toBe(200);
      const scan = parseJson<ScanCreateResponse>(scanResponse.body);

      const checkpointCreateResponse = await server.inject({
        method: 'POST',
        payload: {
          download: true,
        },
        url: `/api/scans/${scan.scan.id}/backup-checkpoint`,
      });

      expect(checkpointCreateResponse.statusCode).toBe(200);
      const createdCheckpoint = parseJson<BackupCheckpointResponse>(
        checkpointCreateResponse.body,
      );
      expect(createdCheckpoint.checkpoint).toMatchObject({
        id: 'checkpoint-1',
        scanFingerprint: scan.scan.fingerprint,
        status: 'created',
      });

      const checkpointReadResponse = await server.inject({
        method: 'GET',
        url: `/api/scans/${scan.scan.id}/backup-checkpoint`,
      });

      expect(checkpointReadResponse.statusCode).toBe(200);
      expect(
        parseJson<BackupCheckpointResponse>(checkpointReadResponse.body),
      ).toEqual(createdCheckpoint);
    } finally {
      await server.close();
    }
  });
});
