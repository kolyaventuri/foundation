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
        'script: !include scripts.yaml',
        'input_boolean: !include input_boolean.yaml',
        'template:',
        '  - sensor:',
        '      - name: Night Mode Template',
        `        state: "{{ states('input_boolean.night_mode') }}"`,
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'automations.yaml'),
      [
        '- id: kitchen-lights',
        '  alias: Kitchen Lights',
        '  action:',
        '    - service: script.turn_on',
        '      target:',
        '        entity_id: script.goodnight',
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'scenes.yaml'),
      [
        '- id: evening_scene',
        '  name: Evening Scene',
        '  entities:',
        '    light.kitchen_light:',
        '      state: "on"',
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'scripts.yaml'),
      [
        'goodnight:',
        '  alias: Goodnight',
        '  sequence:',
        '    - service: scene.turn_on',
        '      target:',
        '        entity_id: scene.evening_scene',
        '    - variables:',
        `        mode_state: "{{ states('input_boolean.night_mode') }}"`,
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'input_boolean.yaml'),
      ['night_mode:', '  name: Night Mode'].join('\n'),
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
    const automation = result.inventory.automations[0];
    const scene = result.inventory.scenes[0];
    const script = result.inventory.scripts?.[0];
    const helper = result.inventory.helpers?.[0];
    const scriptModule = result.inventory.configModules?.find(
      (module) => module.filePath === 'scripts.yaml',
    );

    expect(result.connection.mode).toBe('live');
    expect(result.connection.warnings).toEqual([
      'Device registry listing failed; area inheritance will be incomplete.',
    ]);
    expect(automation).toBeDefined();
    expect(scene).toBeDefined();
    expect(script).toBeDefined();
    expect(helper).toBeDefined();
    expect(scriptModule).toBeDefined();

    if (!automation || !scene || !script || !helper || !scriptModule) {
      throw new Error('Expected live scan config analysis objects');
    }

    expect(automation.automationId).toBe('automation.kitchen_lights');
    expect(automation.name).toBe('Kitchen Lights');
    expect(automation.references?.scriptIds).toEqual(['script.goodnight']);

    expect(scene.name).toBe('Evening Scene');
    expect(scene.sceneId).toBe('scene.evening_scene');

    expect(script.name).toBe('Goodnight');
    expect(script.references?.helperIds).toEqual(['input_boolean.night_mode']);
    expect(script.references?.sceneIds).toEqual(['scene.evening_scene']);
    expect(script.scriptId).toBe('script.goodnight');

    expect(helper.helperId).toBe('input_boolean.night_mode');
    expect(helper.helperType).toBe('input_boolean');

    expect(result.inventory.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          helperIds: ['input_boolean.night_mode'],
          sourcePath: 'configuration.yaml',
        }),
      ]),
    );
    expect(scriptModule.objectTypesPresent).toEqual(
      expect.arrayContaining(['script', 'template']),
    );
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
          summary: 'Loaded 5 config file(s).',
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
