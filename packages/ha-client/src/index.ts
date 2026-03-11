import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve as resolvePath} from 'node:path';
import process from 'node:process';
import type {
  AssistantExposureBinding,
  AssistantKind,
  BackupCheckpoint,
  CapabilitySet,
  ConnectionProfile,
  ConnectionResult,
  InventoryGraph,
  ProviderKind,
  ScanMode,
  ScanNote,
  ScanPassResult,
} from '@ha-repair/contracts';
import {analyzeConfigDirectory} from './config-analysis';

type WebSocketMessageEventLike = {
  data: string | Uint8Array;
};

type WebSocketLike = {
  addEventListener: (
    type: 'close' | 'error' | 'message' | 'open',
    listener: (event: unknown) => void,
  ) => void;
  close: () => void;
  send: (data: string) => void;
};

type WebSocketConstructorLike = new (url: string) => WebSocketLike;

type FileSystemLike = {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
};

export type HomeAssistantRuntimeOptions = {
  cwd?: string;
  fetch?: typeof fetch;
  fs?: FileSystemLike;
  WebSocketCtor?: WebSocketConstructorLike;
};

export type ReadOnlyScanRequest = {
  deep?: boolean;
  mode?: ScanMode;
  profile?: ConnectionProfile;
};

export type CollectedScanData = {
  connection: ConnectionResult;
  inventory: InventoryGraph;
  notes: ScanNote[];
  passes: ScanPassResult[];
};

export type BackupCheckpointRequest = {
  download?: boolean;
  outputDir?: string;
  profile: ConnectionProfile;
  scanFingerprint: string;
};

type WebSocketCommandResult = {
  result?: unknown;
  success: boolean;
};

type WebSocketSnapshot = {
  areaRegistry: WebSocketCommandResult;
  deviceRegistry: WebSocketCommandResult;
  entityRegistry: WebSocketCommandResult;
  floorRegistry: WebSocketCommandResult;
  labelRegistry: WebSocketCommandResult;
};

type HomeAssistantState = {
  attributes?: Record<string, unknown>;
  entity_id: string;
  state: string;
};

type EntityRegistryRecord = {
  area_id?: string | null;
  device_id?: string | null;
  disabled_by?: string | null;
  entity_id: string;
  floor_id?: string | null;
  hidden_by?: string | null;
  labels?: string[];
  name?: string | null;
  options?: Record<string, unknown>;
};

type DeviceRegistryRecord = {
  area_id?: string | null;
  floor_id?: string | null;
  id: string;
  labels?: string[];
  name_by_user?: string | null;
  name?: string | null;
};

type AreaRegistryRecord = {
  area_id: string;
  name: string;
};

type LabelRegistryRecord = {
  label_id: string;
  name: string;
};

type FloorRegistryRecord = {
  floor_id: string;
  name: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function measureDuration(startedAt: number): number {
  return Date.now() - startedAt;
}

// eslint-disable-next-line max-params
function createPass(
  name: ScanPassResult['name'],
  status: ScanPassResult['status'],
  startedAt: string,
  summary: string,
  detail?: string,
): ScanPassResult {
  const completedAt = nowIso();

  return {
    completedAt,
    ...(detail ? {detail} : {}),
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    name,
    startedAt,
    status,
    summary,
  };
}

function createCapability(
  status: CapabilitySet[keyof CapabilitySet]['status'],
  reason?: string,
) {
  return reason ? {reason, status} : {status};
}

function createUnknownCapabilities(
  reason = 'Capability check has not run yet.',
): CapabilitySet {
  return {
    areaRegistry: createCapability('unknown', reason),
    automationMetadata: createCapability('unknown', reason),
    backups: createCapability('unknown', reason),
    configFiles: createCapability('unknown', reason),
    deviceRegistry: createCapability('unknown', reason),
    entityRegistry: createCapability('unknown', reason),
    exposureControl: createCapability('unknown', reason),
    floorRegistry: createCapability('unknown', reason),
    labelRegistry: createCapability('unknown', reason),
    sceneMetadata: createCapability('unknown', reason),
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/u, '');
}

function resolveFetch(override?: typeof fetch): typeof fetch {
  if (override) {
    return override;
  }

  if (typeof fetch !== 'function') {
    throw new TypeError('Global fetch is not available.');
  }

  return fetch;
}

function resolveWebSocketCtor(
  override?: WebSocketConstructorLike,
): WebSocketConstructorLike {
  if (override) {
    return override;
  }

  if (typeof WebSocket !== 'function') {
    throw new TypeError('Global WebSocket is not available.');
  }

  return WebSocket as unknown as WebSocketConstructorLike;
}

function createAuthHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function toWebSocketUrl(endpoint: string): string {
  return endpoint.replace(/^http/iu, 'ws') + '/api/websocket';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function extractAssistantExposureDetails(
  entityRegistryRecord: EntityRegistryRecord | undefined,
): {
  bindings: Partial<Record<AssistantKind, AssistantExposureBinding>>;
  exposures: AssistantKind[];
} {
  if (!entityRegistryRecord?.options) {
    return {
      bindings: {},
      exposures: [],
    };
  }

  const bindings: Partial<Record<AssistantKind, AssistantExposureBinding>> = {};
  const exposures: AssistantKind[] = [];
  const options = entityRegistryRecord.options;
  const knownOptions = [
    ['assist', ['conversation', 'assist']],
    ['alexa', ['alexa']],
    ['homekit', ['homekit']],
  ] as const;
  const knownFlagKeys = ['should_expose', 'expose', 'enabled'] as const;

  for (const [assistant, paths] of knownOptions) {
    for (const key of paths) {
      const section = asRecord(options[key]);

      if (!section) {
        continue;
      }

      const flagKey =
        knownFlagKeys.find(
          (candidate) => typeof section[candidate] === 'boolean',
        ) ?? 'should_expose';
      const isExposed = section[flagKey] === true;

      bindings[assistant] = {
        flagKey,
        optionKey: key,
      };

      if (isExposed) {
        exposures.push(assistant);
      }

      break;
    }
  }

  return {
    bindings,
    exposures,
  };
}

function findFriendlyName(
  state: HomeAssistantState | undefined,
): string | undefined {
  const friendlyName = state?.attributes?.friendly_name;
  return typeof friendlyName === 'string' ? friendlyName : undefined;
}

function createMockCapabilities(configPath?: string): CapabilitySet {
  return {
    areaRegistry: createCapability('supported'),
    automationMetadata: createCapability('supported'),
    backups: createCapability(
      'unsupported',
      'Mock mode does not create live Home Assistant backups.',
    ),
    configFiles: configPath
      ? createCapability('supported')
      : createCapability('unsupported', 'No config path configured.'),
    deviceRegistry: createCapability('supported'),
    entityRegistry: createCapability('supported'),
    exposureControl: createCapability('supported'),
    floorRegistry: createCapability('supported'),
    labelRegistry: createCapability('supported'),
    sceneMetadata: createCapability('supported'),
  };
}

function probeCapabilities(
  endpoint: string,
  options: {
    configPath?: string;
    mode?: ScanMode;
  } = {},
): CapabilitySet {
  if (options.mode === 'live') {
    return createUnknownCapabilities(
      'Live capabilities are determined during read-only discovery.',
    );
  }

  return createMockCapabilities(options.configPath);
}

export function collectMockInventory(): InventoryGraph {
  return {
    areas: [
      {
        areaId: 'area.living_room',
        name: 'Living Room',
      },
    ],
    automations: [
      {
        automationId: 'automation.night_lamp',
        name: 'Night Lamp',
        targetEntityIds: ['light.living_room_lamp', 'light.missing'],
      },
    ],
    devices: [
      {
        areaId: 'area.living_room',
        deviceId: 'device.living_room_lamp',
        floorId: 'floor.main',
        labelIds: ['label.energy'],
        name: 'Living Room Lamp',
      },
    ],
    entities: [
      {
        assistantExposureBindings: {
          alexa: {
            flagKey: 'should_expose',
            optionKey: 'alexa',
          },
          homekit: {
            flagKey: 'should_expose',
            optionKey: 'homekit',
          },
        },
        assistantExposures: ['alexa', 'homekit'],
        deviceId: 'device.living_room_lamp',
        disabledBy: null,
        displayName: 'Living Room Lamp',
        entityId: 'light.living_room_lamp',
        isStale: false,
        labelIds: ['label.energy'],
        name: null,
        state: 'on',
      },
      {
        assistantExposureBindings: {
          assist: {
            flagKey: 'enabled',
            optionKey: 'conversation',
          },
        },
        assistantExposures: ['assist'],
        deviceId: 'device.living_room_lamp',
        disabledBy: null,
        displayName: 'Living Room Lamp',
        entityId: 'sensor.living_room_lamp_power',
        isStale: true,
        name: null,
        state: 'unavailable',
      },
      {
        assistantExposureBindings: {
          assist: {
            flagKey: 'enabled',
            optionKey: 'conversation',
          },
        },
        assistantExposures: ['assist'],
        deviceId: 'device.missing',
        disabledBy: null,
        displayName: 'Bedroom Fan',
        entityId: 'switch.orphaned_fan',
        isStale: false,
        labelIds: ['label.missing'],
        name: null,
        state: 'off',
      },
    ],
    floors: [
      {
        floorId: 'floor.main',
        name: 'Main Floor',
      },
    ],
    labels: [
      {
        labelId: 'label.energy',
        name: 'Energy',
      },
    ],
    scenes: [
      {
        name: 'Movie Time',
        sceneId: 'scene.movie_time',
        targetEntityIds: ['light.living_room_lamp', 'switch.missing'],
      },
    ],
    source: 'mock',
  };
}

// eslint-disable-next-line max-params
async function fetchJson<T>(
  endpoint: string,
  path: string,
  token: string,
  runtime: HomeAssistantRuntimeOptions,
  init?: RequestInit,
): Promise<T> {
  const response = await resolveFetch(runtime.fetch)(`${endpoint}${path}`, {
    ...init,
    headers: {
      ...createAuthHeaders(token),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function callWebSocketCommands(
  endpoint: string,
  token: string,
  runtime: HomeAssistantRuntimeOptions,
): Promise<WebSocketSnapshot> {
  const WebSocketCtor = resolveWebSocketCtor(runtime.WebSocketCtor);

  return new Promise<WebSocketSnapshot>((resolve, reject) => {
    const socket = new WebSocketCtor(toWebSocketUrl(endpoint));
    const pending = new Map<number, keyof WebSocketSnapshot>();
    const results: Partial<WebSocketSnapshot> = {};
    let finished = false;

    const commands: Array<{
      key: keyof WebSocketSnapshot;
      type: string;
    }> = [
      {key: 'entityRegistry', type: 'config/entity_registry/list'},
      {key: 'deviceRegistry', type: 'config/device_registry/list'},
      {key: 'areaRegistry', type: 'config/area_registry/list'},
      {key: 'labelRegistry', type: 'config/label_registry/list'},
      {key: 'floorRegistry', type: 'config/floor_registry/list'},
    ];

    const finish = (callback: () => void) => {
      if (finished) {
        return;
      }

      finished = true;
      callback();
      socket.close();
    };

    const timeout = globalThis.setTimeout(() => {
      finish(() => {
        reject(new Error('Timed out waiting for Home Assistant websocket.'));
      });
    }, 5000);

    socket.addEventListener('message', (event) => {
      const messageEvent = event as WebSocketMessageEventLike;
      const message = JSON.parse(String(messageEvent.data)) as {
        error?: {message?: string};
        id?: number;
        result?: unknown;
        success?: boolean;
        type: string;
      };

      switch (message.type) {
        case 'auth_required': {
          socket.send(JSON.stringify({access_token: token, type: 'auth'}));
          return;
        }

        case 'auth_invalid': {
          globalThis.clearTimeout(timeout);
          finish(() => {
            reject(
              new Error(
                message.error?.message ?? 'Home Assistant auth failed.',
              ),
            );
          });
          return;
        }

        case 'auth_ok': {
          let nextId = 1;

          for (const command of commands) {
            pending.set(nextId, command.key);
            socket.send(JSON.stringify({id: nextId, type: command.type}));
            nextId += 1;
          }

          return;
        }

        case 'result': {
          if (typeof message.id !== 'number') {
            return;
          }

          const key = pending.get(message.id);

          if (!key) {
            return;
          }

          results[key] = {
            result: message.result,
            success: message.success === true,
          };
          pending.delete(message.id);

          if (pending.size === 0) {
            globalThis.clearTimeout(timeout);
            finish(() => {
              resolve({
                areaRegistry: results.areaRegistry ?? {success: false},
                deviceRegistry: results.deviceRegistry ?? {success: false},
                entityRegistry: results.entityRegistry ?? {success: false},
                floorRegistry: results.floorRegistry ?? {success: false},
                labelRegistry: results.labelRegistry ?? {success: false},
              });
            });
          }

          break;
        }

        default: {
          break;
        }
      }
    });

    socket.addEventListener('error', () => {
      globalThis.clearTimeout(timeout);
      finish(() => {
        reject(new Error('Home Assistant websocket request failed.'));
      });
    });
  });
}

function buildLiveCapabilities(
  services: Array<Record<string, unknown>>,
  snapshot: WebSocketSnapshot,
  configPath?: string,
): CapabilitySet {
  const hasBackupService = services.some(
    (domain) =>
      typeof domain.domain === 'string' &&
      domain.domain === 'backup' &&
      typeof asRecord(domain.services)?.create === 'object',
  );

  return {
    areaRegistry: snapshot.areaRegistry.success
      ? createCapability('supported')
      : createCapability('partial', 'Area registry could not be listed.'),
    automationMetadata: configPath
      ? createCapability('supported')
      : createCapability(
          'partial',
          'Automation target validation needs a config path.',
        ),
    backups: hasBackupService
      ? createCapability('supported')
      : createCapability(
          'unsupported',
          'No backup service was exposed by the live instance.',
        ),
    configFiles: configPath
      ? createCapability('supported')
      : createCapability(
          'unsupported',
          'No config path configured for deep scan.',
        ),
    deviceRegistry: snapshot.deviceRegistry.success
      ? createCapability('supported')
      : createCapability('partial', 'Device registry could not be listed.'),
    entityRegistry: snapshot.entityRegistry.success
      ? createCapability('supported')
      : createCapability('partial', 'Entity registry could not be listed.'),
    exposureControl: snapshot.entityRegistry.success
      ? createCapability('supported')
      : createCapability(
          'partial',
          'Assistant exposure requires entity registry metadata.',
        ),
    floorRegistry: snapshot.floorRegistry.success
      ? createCapability('supported')
      : createCapability('partial', 'Floor registry could not be listed.'),
    labelRegistry: snapshot.labelRegistry.success
      ? createCapability('supported')
      : createCapability('partial', 'Label registry could not be listed.'),
    sceneMetadata: configPath
      ? createCapability('supported')
      : createCapability(
          'partial',
          'Scene target validation needs a config path.',
        ),
  };
}

function buildInventoryFromLiveData(input: {
  configAnalysis?: ReturnType<typeof analyzeConfigDirectory>;
  snapshot: WebSocketSnapshot;
  states: HomeAssistantState[];
}): InventoryGraph {
  const stateByEntityId = new Map(
    input.states.map((state) => [state.entity_id, state] as const),
  );
  const entityRegistryRows = input.snapshot.entityRegistry.success
    ? (input.snapshot.entityRegistry.result as EntityRegistryRecord[])
    : [];
  const deviceRegistryRows = input.snapshot.deviceRegistry.success
    ? (input.snapshot.deviceRegistry.result as DeviceRegistryRecord[])
    : [];
  const areaRegistryRows = input.snapshot.areaRegistry.success
    ? (input.snapshot.areaRegistry.result as AreaRegistryRecord[])
    : [];
  const labelRegistryRows = input.snapshot.labelRegistry.success
    ? (input.snapshot.labelRegistry.result as LabelRegistryRecord[])
    : [];
  const floorRegistryRows = input.snapshot.floorRegistry.success
    ? (input.snapshot.floorRegistry.result as FloorRegistryRecord[])
    : [];
  const entityIds = new Set<string>([
    ...input.states.map((state) => state.entity_id),
    ...entityRegistryRows.map((row) => row.entity_id),
  ]);
  const deviceById = new Map(
    deviceRegistryRows.map((row) => [row.id, row] as const),
  );
  const entityById = new Map(
    entityRegistryRows.map((row) => [row.entity_id, row] as const),
  );

  return {
    areas: areaRegistryRows.map((area) => ({
      areaId: area.area_id,
      name: area.name,
    })),
    automations: input.configAnalysis?.automations ?? [],
    ...(input.configAnalysis
      ? {configAnalysis: input.configAnalysis.analysis}
      : {}),
    devices: deviceRegistryRows.map((device) => ({
      areaId: device.area_id ?? null,
      deviceId: device.id,
      floorId: device.floor_id ?? null,
      labelIds: device.labels ?? [],
      name: device.name_by_user ?? device.name ?? device.id,
    })),
    entities: [...entityIds].sort().map((entityId) => {
      const state = stateByEntityId.get(entityId);
      const registry = entityById.get(entityId);
      const device = registry?.device_id
        ? deviceById.get(registry.device_id)
        : undefined;
      const exposureDetails = extractAssistantExposureDetails(registry);

      return {
        areaId: registry?.area_id ?? device?.area_id ?? null,
        assistantExposureBindings: exposureDetails.bindings,
        assistantExposures: exposureDetails.exposures,
        deviceId: registry?.device_id ?? null,
        disabledBy: registry?.disabled_by ?? null,
        displayName:
          findFriendlyName(state) ??
          registry?.name ??
          registry?.entity_id ??
          entityId,
        entityId,
        floorId: registry?.floor_id ?? device?.floor_id ?? null,
        hiddenBy: registry?.hidden_by ?? null,
        isStale: !state || state.state === 'unavailable',
        labelIds: registry?.labels ?? [],
        name: registry?.name ?? null,
        state: state?.state ?? null,
      };
    }),
    floors: floorRegistryRows.map((floor) => ({
      floorId: floor.floor_id,
      name: floor.name,
    })),
    labels: labelRegistryRows.map((label) => ({
      labelId: label.label_id,
      name: label.name,
    })),
    scenes: input.configAnalysis?.scenes ?? [],
    source: 'live',
  };
}

function findServicesWithBackup(
  services: Array<Record<string, unknown>>,
): 'create' | 'create_automatic' | undefined {
  for (const domain of services) {
    if (domain.domain !== 'backup') {
      continue;
    }

    const serviceRecord = asRecord(domain.services);

    if (serviceRecord?.create) {
      return 'create';
    }

    if (serviceRecord?.create_automatic) {
      return 'create_automatic';
    }
  }

  return undefined;
}

function findStringByKeys(
  value: unknown,
  keys: Set<string>,
): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findStringByKeys(entry, keys);

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (
      keys.has(key) &&
      typeof nestedValue === 'string' &&
      nestedValue.length > 0
    ) {
      return nestedValue;
    }

    const nestedMatch = findStringByKeys(nestedValue, keys);

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

async function collectMockScanData(
  request: ReadOnlyScanRequest,
): Promise<CollectedScanData> {
  const endpoint = normalizeBaseUrl(
    request.profile?.baseUrl ?? 'http://mock.local:8123',
  );
  const notes: ScanNote[] = [];
  let inventory = collectMockInventory();
  const passes: ScanPassResult[] = [];
  const connectionStartedAt = nowIso();

  passes.push(
    createPass(
      'connection',
      'completed',
      connectionStartedAt,
      'Mock connection succeeded.',
    ),
  );

  const inventoryStartedAt = nowIso();
  passes.push(
    createPass(
      'inventory',
      'completed',
      inventoryStartedAt,
      `Loaded ${inventory.entities.length} mock entities.`,
    ),
  );

  const configStartedAt = nowIso();

  if (request.deep && request.profile?.configPath) {
    const configAnalysis = analyzeConfigDirectory(request.profile.configPath);
    inventory = {
      ...inventory,
      automations: configAnalysis.automations,
      configAnalysis: configAnalysis.analysis,
      scenes: configAnalysis.scenes,
    };
    notes.push(...configAnalysis.notes);
    passes.push(
      createPass(
        'config',
        configAnalysis.analysis.issues.length > 0 ? 'partial' : 'completed',
        configStartedAt,
        `Loaded ${configAnalysis.analysis.loadedFileCount} config file(s).`,
      ),
    );
  } else {
    passes.push(
      createPass(
        'config',
        'skipped',
        configStartedAt,
        'Deep config analysis was not requested.',
      ),
    );
  }

  return {
    connection: {
      capabilities: probeCapabilities(
        endpoint,
        request.profile?.configPath
          ? {
              configPath: request.profile.configPath,
            }
          : {},
      ),
      checkedAt: nowIso(),
      endpoint,
      latencyMs: 0,
      mode: 'mock',
      ok:
        endpoint.length > 0 && (request.profile?.token.trim().length ?? 1) > 0,
      warnings: [],
    },
    inventory,
    notes,
    passes,
  };
}

async function collectLiveScanData(
  profile: ConnectionProfile,
  request: ReadOnlyScanRequest,
  runtime: HomeAssistantRuntimeOptions,
): Promise<CollectedScanData> {
  const endpoint = normalizeBaseUrl(profile.baseUrl);
  const notes: ScanNote[] = [];
  const passes: ScanPassResult[] = [];
  const connectionStartedAtMs = Date.now();
  const connectionStartedAt = nowIso();
  const services = await fetchJson<Array<Record<string, unknown>>>(
    endpoint,
    '/api/services',
    profile.token,
    runtime,
  );
  const config = await fetchJson<Record<string, unknown>>(
    endpoint,
    '/api/config',
    profile.token,
    runtime,
  );
  const snapshot = await callWebSocketCommands(
    endpoint,
    profile.token,
    runtime,
  );
  const connectionWarnings: string[] = [];

  const capabilities = buildLiveCapabilities(
    services,
    snapshot,
    profile.configPath,
  );

  if (!snapshot.entityRegistry.success) {
    connectionWarnings.push(
      'Entity registry listing failed; scan will use partial inventory data.',
    );
  }

  if (!snapshot.deviceRegistry.success) {
    connectionWarnings.push(
      'Device registry listing failed; area inheritance will be incomplete.',
    );
  }

  passes.push(
    createPass(
      'connection',
      'completed',
      connectionStartedAt,
      `Connected to ${endpoint}.`,
      typeof config.location_name === 'string'
        ? `Home Assistant location: ${config.location_name}.`
        : undefined,
    ),
  );

  const inventoryStartedAt = nowIso();
  const states = await fetchJson<HomeAssistantState[]>(
    endpoint,
    '/api/states',
    profile.token,
    runtime,
  );
  let configAnalysis: ReturnType<typeof analyzeConfigDirectory> | undefined;

  if (request.deep && profile.configPath) {
    configAnalysis = analyzeConfigDirectory(profile.configPath);
    notes.push(...configAnalysis.notes);
  }

  const inventory = buildInventoryFromLiveData({
    ...(configAnalysis ? {configAnalysis} : {}),
    snapshot,
    states,
  });

  if (!snapshot.areaRegistry.success) {
    notes.push({
      id: 'inventory:area_registry',
      message: 'Area registry listing failed during live read-only discovery.',
      scope: 'inventory',
      severity: 'warning',
    });
  }

  passes.push(
    createPass(
      'inventory',
      snapshot.entityRegistry.success &&
        snapshot.deviceRegistry.success &&
        snapshot.areaRegistry.success
        ? 'completed'
        : 'partial',
      inventoryStartedAt,
      `Loaded ${inventory.entities.length} live entities and ${inventory.devices.length} devices.`,
    ),
  );

  const configStartedAt = nowIso();

  if (request.deep && profile.configPath) {
    passes.push(
      createPass(
        'config',
        configAnalysis && configAnalysis.analysis.issues.length > 0
          ? 'partial'
          : 'completed',
        configStartedAt,
        configAnalysis
          ? `Loaded ${configAnalysis.analysis.loadedFileCount} config file(s).`
          : 'No config analysis result was produced.',
      ),
    );
  } else {
    passes.push(
      createPass(
        'config',
        'skipped',
        configStartedAt,
        'Deep config analysis was not requested.',
      ),
    );
  }

  return {
    connection: {
      capabilities,
      checkedAt: nowIso(),
      endpoint,
      latencyMs: measureDuration(connectionStartedAtMs),
      mode: 'live',
      ok: true,
      warnings: connectionWarnings,
    },
    inventory,
    notes,
    passes,
  };
}

export async function collectScanData(
  request: ReadOnlyScanRequest = {},
  runtime: HomeAssistantRuntimeOptions = {},
): Promise<CollectedScanData> {
  if ((request.mode ?? 'mock') === 'mock' || !request.profile) {
    return collectMockScanData(request);
  }

  return collectLiveScanData(request.profile, request, runtime);
}

export async function testConnection(
  profile: ConnectionProfile,
  options: {
    mode?: ScanMode;
  } & HomeAssistantRuntimeOptions = {},
): Promise<ConnectionResult> {
  const endpoint = normalizeBaseUrl(profile.baseUrl);

  if ((options.mode ?? 'mock') === 'mock') {
    return {
      capabilities: probeCapabilities(
        endpoint,
        profile.configPath ? {configPath: profile.configPath} : {},
      ),
      checkedAt: nowIso(),
      endpoint,
      latencyMs: 0,
      mode: 'mock',
      ok: endpoint.length > 0 && profile.token.trim().length > 0,
      warnings: [],
    };
  }

  const startedAt = Date.now();

  try {
    const services = await fetchJson<Array<Record<string, unknown>>>(
      endpoint,
      '/api/services',
      profile.token,
      options,
    );
    const snapshot = await callWebSocketCommands(
      endpoint,
      profile.token,
      options,
    );

    return {
      capabilities: buildLiveCapabilities(
        services,
        snapshot,
        profile.configPath,
      ),
      checkedAt: nowIso(),
      endpoint,
      latencyMs: measureDuration(startedAt),
      mode: 'live',
      ok: true,
      warnings: [],
    };
  } catch (error) {
    return {
      capabilities: createUnknownCapabilities(
        error instanceof Error ? error.message : 'Connection failed.',
      ),
      checkedAt: nowIso(),
      endpoint,
      latencyMs: measureDuration(startedAt),
      mode: 'live',
      ok: false,
      warnings: [error instanceof Error ? error.message : 'Connection failed.'],
    };
  }
}

export async function createBackupCheckpoint(
  request: BackupCheckpointRequest,
  runtime: HomeAssistantRuntimeOptions = {},
): Promise<BackupCheckpoint> {
  const endpoint = normalizeBaseUrl(request.profile.baseUrl);
  const services = await fetchJson<Array<Record<string, unknown>>>(
    endpoint,
    '/api/services',
    request.profile.token,
    runtime,
  );
  const serviceName = findServicesWithBackup(services);

  if (!serviceName) {
    return {
      createdAt: nowIso(),
      id: `checkpoint-${request.scanFingerprint.slice(0, 12)}`,
      method: 'manual',
      notes: [
        'The live Home Assistant instance did not expose a backup service that this console can automate.',
        'Create a backup manually in Home Assistant before reviewing or applying fixes.',
      ],
      scanFingerprint: request.scanFingerprint,
      status: 'manual_required',
      summary: 'Manual backup required before committing live fixes.',
    };
  }

  const response = await fetchJson<unknown>(
    endpoint,
    `/api/services/backup/${serviceName}?return_response`,
    request.profile.token,
    runtime,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
  const rawDownloadUrl = findStringByKeys(
    response,
    new Set(['download_url', 'signed_path', 'url']),
  );
  const rawPath = findStringByKeys(response, new Set(['path']));
  const backupName =
    findStringByKeys(response, new Set(['slug', 'name', 'backup_id'])) ??
    `backup-${Date.now().toString(36)}`;
  let downloadUrl = rawDownloadUrl?.startsWith('http')
    ? rawDownloadUrl
    : rawDownloadUrl
      ? `${endpoint}${rawDownloadUrl}`
      : undefined;

  if (!downloadUrl && rawPath) {
    const signedPathResponse = await fetchJson<{path?: string}>(
      endpoint,
      '/auth/sign_path',
      request.profile.token,
      runtime,
      {
        body: JSON.stringify({path: rawPath}),
        method: 'POST',
      },
    );

    if (typeof signedPathResponse.path === 'string') {
      downloadUrl = `${endpoint}${signedPathResponse.path}`;
    }
  }

  if (!downloadUrl) {
    return {
      createdAt: nowIso(),
      id: `checkpoint-${request.scanFingerprint.slice(0, 12)}`,
      method: 'manual',
      notes: [
        'A backup was requested, but the instance did not return a verified download path.',
        'Verify the backup inside Home Assistant before proceeding.',
      ],
      scanFingerprint: request.scanFingerprint,
      status: 'manual_required',
      summary:
        'Backup requested, but download still requires manual verification.',
    };
  }

  if (!request.download) {
    return {
      createdAt: nowIso(),
      downloadUrl,
      id: `checkpoint-${request.scanFingerprint.slice(0, 12)}`,
      method: 'supervisor',
      notes: [
        'Download URL generated. The backup file was not downloaded locally.',
      ],
      scanFingerprint: request.scanFingerprint,
      status: 'created',
      summary: 'Backup checkpoint created and ready for download.',
    };
  }

  const downloadResponse = await resolveFetch(runtime.fetch)(downloadUrl, {
    headers: {
      authorization: `Bearer ${request.profile.token}`,
    },
  });

  if (!downloadResponse.ok) {
    return {
      createdAt: nowIso(),
      downloadUrl,
      id: `checkpoint-${request.scanFingerprint.slice(0, 12)}`,
      method: 'supervisor',
      notes: [`Backup download failed with ${downloadResponse.status}.`],
      scanFingerprint: request.scanFingerprint,
      status: 'failed',
      summary: 'Backup checkpoint was created, but the local download failed.',
    };
  }

  const outputDirectory = resolvePath(
    runtime.cwd ?? process.cwd(),
    request.outputDir ?? './data/backups',
  );
  const fileSystem = runtime.fs ?? {
    mkdirSync,
    writeFileSync,
  };
  const extension = downloadUrl.endsWith('.zip') ? '.zip' : '.tar';
  const localPath = resolvePath(outputDirectory, `${backupName}${extension}`);
  const arrayBuffer = await downloadResponse.arrayBuffer();

  fileSystem.mkdirSync(outputDirectory, {recursive: true});
  fileSystem.writeFileSync(localPath, Buffer.from(arrayBuffer));

  return {
    createdAt: nowIso(),
    downloadUrl,
    id: `checkpoint-${request.scanFingerprint.slice(0, 12)}`,
    localPath,
    method: 'supervisor',
    notes: ['Backup checkpoint created and downloaded locally.'],
    scanFingerprint: request.scanFingerprint,
    status: 'created',
    summary: 'Backup checkpoint created and downloaded locally.',
  };
}

export {normalizeBaseUrl, probeCapabilities};

export {analyzeConfigDirectory} from './config-analysis';
