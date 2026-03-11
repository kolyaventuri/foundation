import type {
  CapabilitySet,
  ConnectionProfile,
  ConnectionResult,
  InventoryGraph,
} from '@ha-repair/contracts';

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/u, '');
}

function probeCapabilities(endpoint: string): CapabilitySet {
  const isSecure = endpoint.startsWith('https://');

  return {
    entityRegistry: 'supported',
    exposureControl: 'supported',
    floors: isSecure ? 'supported' : 'unsupported',
    labels: isSecure ? 'supported' : 'unsupported',
  };
}

export function collectMockInventory(): InventoryGraph {
  return {
    devices: [
      {
        deviceId: 'device.living_room_lamp',
        name: 'Living Room Lamp',
      },
    ],
    entities: [
      {
        deviceId: 'device.living_room_lamp',
        disabledBy: null,
        displayName: 'Living Room Lamp',
        entityId: 'light.living_room_lamp',
        isStale: false,
        name: null,
      },
      {
        disabledBy: null,
        displayName: 'Living Room Lamp',
        entityId: 'sensor.living_room_lamp_power',
        isStale: true,
        name: null,
      },
      {
        deviceId: 'device.missing',
        disabledBy: null,
        displayName: 'Bedroom Fan',
        entityId: 'switch.orphaned_fan',
        isStale: false,
        name: null,
      },
    ],
    source: 'mock',
  };
}

export async function testConnection(
  profile: ConnectionProfile,
): Promise<ConnectionResult> {
  const endpoint = normalizeBaseUrl(profile.baseUrl);

  return {
    capabilities: probeCapabilities(endpoint),
    checkedAt: new Date().toISOString(),
    endpoint,
    latencyMs: 0,
    mode: 'mock',
    ok: endpoint.length > 0 && profile.token.trim().length > 0,
  };
}

export {normalizeBaseUrl, probeCapabilities};
