import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createLiveHomeAssistantMocks} from '../../../test/live-home-assistant';
import {
  collectMockInventory,
  collectScanData,
  createBackupCheckpoint,
  normalizeBaseUrl,
  probeCapabilities,
  testConnection,
} from './index';

const temporaryDirectories: string[] = [];

function createTempConfigRoot() {
  const directory = mkdtempSync(join(tmpdir(), 'ha-repair-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
});

describe('ha-client', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeBaseUrl('http://homeassistant.local:8123///')).toBe(
      'http://homeassistant.local:8123',
    );
  });

  it('probes mocked capabilities from endpoint posture', () => {
    expect(probeCapabilities('http://ha.local:8123').labelRegistry.status).toBe(
      'supported',
    );
    expect(
      probeCapabilities('https://ha.local:8123').labelRegistry.status,
    ).toBe('supported');
  });

  it('collects a baseline mock inventory fixture', () => {
    const inventory = collectMockInventory();

    expect(inventory.source).toBe('mock');
    expect(inventory.entities.length).toBeGreaterThan(0);
  });

  it('reports a mock healthy connection when url and token exist', async () => {
    await expect(
      testConnection({
        baseUrl: 'http://ha.local:8123/',
        name: 'primary',
        token: 'abc123',
      }),
    ).resolves.toMatchObject({
      endpoint: 'http://ha.local:8123',
      mode: 'mock',
      ok: true,
    });
  });

  it('reports live connection posture through REST and websocket discovery', async () => {
    const mocks = createLiveHomeAssistantMocks();

    await expect(
      testConnection(
        {
          baseUrl: 'http://ha.local:8123/',
          name: 'primary',
          token: 'abc123',
        },
        {
          WebSocketCtor: mocks.WebSocketCtor,
          fetch: mocks.fetch,
          mode: 'live',
        },
      ),
    ).resolves.toMatchObject({
      capabilities: {
        backups: {
          status: 'supported',
        },
        floorRegistry: {
          status: 'supported',
        },
        labelRegistry: {
          status: 'supported',
        },
      },
      endpoint: 'http://ha.local:8123',
      mode: 'live',
      ok: true,
    });
  });

  it('collects live scan data with deep config parsing and partial inventory notes', async () => {
    const configRoot = createTempConfigRoot();
    writeFileSync(
      join(configRoot, 'configuration.yaml'),
      [
        'automation: !include automations.yaml',
        'scene: !include scenes.yaml',
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'automations.yaml'),
      [
        '- id: kitchen-lights',
        '  alias: Kitchen Lights',
        '  action:',
        '    - target:',
        '        entity_id: light.kitchen_light',
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'scenes.yaml'),
      [
        '- id: evening-scene',
        '  name: Evening',
        '  entities:',
        '    light.kitchen_light:',
        '      state: "on"',
      ].join('\n'),
    );

    const mocks = createLiveHomeAssistantMocks({
      webSocketResults: {
        'config/area_registry/list': {
          result: [],
          success: false,
        },
        'config/device_registry/list': {
          result: [],
          success: false,
        },
      },
    });

    const result = await collectScanData(
      {
        deep: true,
        mode: 'live',
        profile: {
          baseUrl: 'http://ha.local:8123',
          configPath: configRoot,
          name: 'primary',
          token: 'abc123',
        },
      },
      {
        WebSocketCtor: mocks.WebSocketCtor,
        fetch: mocks.fetch,
      },
    );

    expect(result.connection.mode).toBe('live');
    expect(result.connection.warnings).toEqual([
      'Device registry listing failed; area inheritance will be incomplete.',
    ]);
    expect(result.inventory.automations).toEqual([
      expect.objectContaining({
        automationId: 'kitchen-lights',
        name: 'Kitchen Lights',
      }),
    ]);
    expect(result.inventory.scenes).toEqual([
      expect.objectContaining({
        name: 'Evening',
        sceneId: 'evening-scene',
      }),
    ]);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inventory:area_registry',
          severity: 'warning',
        }),
      ]),
    );
    expect(result.passes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'inventory',
          status: 'partial',
        }),
        expect.objectContaining({
          name: 'config',
          status: 'completed',
          summary: 'Loaded 3 config file(s).',
        }),
      ]),
    );
  });

  it('marks config analysis as skipped when deep parsing is not requested', async () => {
    const result = await collectScanData({
      mode: 'mock',
      profile: {
        baseUrl: 'http://ha.local:8123',
        name: 'primary',
        token: 'abc123',
      },
    });

    expect(result.passes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'config',
          status: 'skipped',
          summary: 'Deep config analysis was not requested.',
        }),
      ]),
    );
  });

  it('creates and downloads a backup checkpoint when the instance supports it', async () => {
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();
    const mocks = createLiveHomeAssistantMocks({
      backupServiceResponse: {
        data: {
          download_url: '/download/nightly.tar',
          slug: 'nightly',
        },
      },
    });

    const checkpoint = await createBackupCheckpoint(
      {
        download: true,
        outputDir: './exports',
        profile: {
          baseUrl: 'http://ha.local:8123',
          name: 'primary',
          token: 'abc123',
        },
        scanFingerprint: 'fingerprint-1234567890',
      },
      {
        cwd: '/tmp/workspace',
        fetch: mocks.fetch,
        fs: {
          mkdirSync,
          writeFileSync,
        },
      },
    );

    expect(checkpoint).toMatchObject({
      localPath: '/tmp/workspace/exports/nightly.tar',
      method: 'supervisor',
      status: 'created',
      summary: 'Backup checkpoint created and downloaded locally.',
    });
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/workspace/exports', {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });
});
