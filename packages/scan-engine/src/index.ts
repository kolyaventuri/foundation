import {randomUUID} from 'node:crypto';
import type {
  Finding,
  FixAction,
  FrameworkSummary,
  InventoryGraph,
  ScanRun,
} from '@ha-repair/contracts';

export function createFrameworkSummary(): FrameworkSummary {
  return {
    priorities: [
      'Replace the mock Home Assistant client with a real authenticated websocket + REST adapter.',
      'Expand deterministic rule packs for naming, area coverage, and assistant exposure.',
      'Move from dry-run previews into guarded live apply flows and richer exports.',
    ],
    surfaces: [
      {
        id: 'api',
        name: 'API shell',
        state: 'ready',
        summary:
          'Fastify now exposes persisted profile, scan, history, preview, and dry-run apply endpoints.',
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
          'The CLI now manages saved profiles and local scan, findings, dry-run apply, and export flows.',
      },
      {
        id: 'rules',
        name: 'Repair engine',
        state: 'ready',
        summary:
          'Deterministic findings now persist with diff summaries and stable dry-run preview actions.',
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

export function createFixActions(findings: Finding[]): FixAction[] {
  return findings.map((finding) => {
    switch (finding.kind) {
      case 'duplicate_name': {
        return {
          findingId: finding.id,
          id: `fix:${finding.id}:rename`,
          kind: 'rename_duplicate_name',
          rationale:
            'Duplicate friendly names create ambiguous cleanup and assistant experiences.',
          risk: 'medium',
          steps: [
            'Review each entity sharing the duplicate name.',
            'Choose a disambiguated friendly name for each duplicate entity.',
            'Apply the naming change after confirming the new labels in Home Assistant.',
          ],
          title: `Rename duplicate entities for ${finding.title.replace('Duplicate name: ', '')}`,
        };
      }

      case 'orphaned_entity_device': {
        return {
          findingId: finding.id,
          id: `fix:${finding.id}:repair-link`,
          kind: 'repair_orphaned_entity_device',
          rationale:
            'Missing device links usually indicate stale registry state or a partially removed integration.',
          risk: 'high',
          steps: [
            'Confirm whether the referenced device still exists in Home Assistant.',
            'Relink the entity to the correct device or remove the broken registry entry.',
            'Rescan after the registry cleanup to confirm the orphan is gone.',
          ],
          title: `Repair missing device link for ${finding.objectIds[0]}`,
        };
      }

      case 'stale_entity': {
        return {
          findingId: finding.id,
          id: `fix:${finding.id}:review-stale`,
          kind: 'review_stale_entity',
          rationale:
            'Stale entities often represent integrations or helpers that can be disabled or removed safely.',
          risk: 'low',
          steps: [
            'Verify the entity is no longer needed.',
            'Disable or remove the stale entity from the registry or source integration.',
            'Run another scan to confirm the stale entity finding resolves.',
          ],
          title: `Review stale entity ${finding.objectIds[0]}`,
        };
      }
    }

    throw new Error('Unhandled finding kind');
  });
}

export function runScan(
  inventory: InventoryGraph,
  profileName: string | null = null,
): ScanRun {
  const findings = [
    ...findDuplicateNameFindings(inventory),
    ...findOrphanedDeviceLinks(inventory),
    ...findStaleEntities(inventory),
  ];

  return {
    createdAt: new Date().toISOString(),
    findings,
    id: `scan-${randomUUID()}`,
    inventory,
    profileName,
  };
}
