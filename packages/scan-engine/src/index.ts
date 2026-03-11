import type {
  Finding,
  FrameworkSummary,
  InventoryGraph,
  ScanRun,
} from '@ha-repair/contracts';

export function createFrameworkSummary(): FrameworkSummary {
  return {
    priorities: [
      'Replace the mock Home Assistant client with a real authenticated websocket + REST adapter.',
      'Persist connection profiles, scan runs, and findings in SQLite.',
      'Ship the first deterministic rule packs for naming, area coverage, and assistant exposure.',
    ],
    surfaces: [
      {
        id: 'api',
        name: 'API shell',
        state: 'ready',
        summary:
          'Fastify now exposes health, framework summary, and a stubbed connection-test endpoint.',
      },
      {
        id: 'web',
        name: 'Guided UI shell',
        state: 'ready',
        summary:
          'React + Vite render the shared framework model and are ready for live scan workflows.',
      },
      {
        id: 'cli',
        name: 'CLI path',
        state: 'ready',
        summary:
          'The CLI can already report framework status and exercise the shared Home Assistant client.',
      },
      {
        id: 'rules',
        name: 'Repair engine',
        state: 'planned',
        summary:
          'Rule packs, prioritization, and fix previews are the next vertical slice on top of this scaffold.',
      },
    ],
    tagline:
      'A local-first framework for deep Home Assistant inventory repair, cleanup, and guided improvement.',
    title: 'Home Assistant Repair Console',
  };
}

function findDuplicateNameFindings(inventory: InventoryGraph): Finding[] {
  const names = new Map<string, string[]>();

  for (const entity of inventory.entities) {
    const matches = names.get(entity.friendlyName) ?? [];
    matches.push(entity.entityId);
    names.set(entity.friendlyName, matches);
  }

  return [...names.entries()]
    .filter(([, entityIds]) => entityIds.length > 1)
    .map(([name, entityIds]) => ({
      evidence: `Found ${entityIds.length} entities named "${name}".`,
      id: `duplicate_name:${name}`,
      kind: 'duplicate_name',
      objectIds: entityIds,
      severity: 'medium',
      title: `Duplicate name: ${name}`,
    }));
}

function findOrphanedDeviceLinks(inventory: InventoryGraph): Finding[] {
  const deviceIds = new Set(inventory.devices.map((device) => device.deviceId));

  return inventory.entities
    .filter((entity) => entity.deviceId && !deviceIds.has(entity.deviceId))
    .map((entity) => ({
      evidence: `Entity ${entity.entityId} references missing device ${entity.deviceId}.`,
      id: `orphaned_entity_device:${entity.entityId}`,
      kind: 'orphaned_entity_device',
      objectIds: [entity.entityId, entity.deviceId!],
      severity: 'high',
      title: `Orphaned entity/device link for ${entity.entityId}`,
    }));
}

function findStaleEntities(inventory: InventoryGraph): Finding[] {
  return inventory.entities
    .filter((entity) => entity.isStale)
    .map((entity) => ({
      evidence: `Entity ${entity.entityId} is marked stale by inventory collection.`,
      id: `stale_entity:${entity.entityId}`,
      kind: 'stale_entity',
      objectIds: [entity.entityId],
      severity: 'low',
      title: `Stale entity ${entity.entityId}`,
    }));
}

export function runScan(inventory: InventoryGraph): ScanRun {
  const findings = [
    ...findDuplicateNameFindings(inventory),
    ...findOrphanedDeviceLinks(inventory),
    ...findStaleEntities(inventory),
  ];

  return {
    createdAt: new Date().toISOString(),
    findings,
    id: `scan-${Date.now().toString(36)}`,
    inventory,
  };
}
