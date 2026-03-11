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

function getEntityLabel(inventory: InventoryGraph, entityId: string): string {
  const entity = inventory.entities.find(
    (candidate) => candidate.entityId === entityId,
  );

  if (!entity) {
    return entityId;
  }

  return `${entity.friendlyName} (${entity.entityId})`;
}

function getEntityFriendlyName(
  inventory: InventoryGraph,
  entityId: string,
): string | undefined {
  return inventory.entities.find((candidate) => candidate.entityId === entityId)
    ?.friendlyName;
}

function formatScalar(value: string | null): string {
  return value === null ? 'null' : `"${value}"`;
}

function createDiffArtifact(
  actionId: string,
  lines: string[],
  label: string,
): FixAction['artifacts'][number] {
  return {
    content: lines.join('\n'),
    id: `${actionId}:diff`,
    kind: 'text_diff',
    label,
  };
}

export function createFixActions(
  inventory: InventoryGraph,
  findings: Finding[],
): FixAction[] {
  return findings.map((finding) => {
    switch (finding.kind) {
      case 'duplicate_name': {
        const edits = finding.objectIds.map((entityId, index) => {
          const before =
            getEntityFriendlyName(inventory, entityId) ?? finding.title;
          const after = `${before} (${entityId})`;

          return {
            after,
            before,
            fieldPath: 'friendlyName',
            id: `edit:${finding.id}:${index}:friendly_name`,
            summary: `Rename ${entityId} to remove the duplicate friendly name collision.`,
            targetId: entityId,
          };
        });

        const targets = finding.objectIds.map((entityId) => ({
          id: entityId,
          kind: 'entity' as const,
          label: getEntityLabel(inventory, entityId),
        }));

        const artifact = createDiffArtifact(
          `fix:${finding.id}:rename`,
          edits.flatMap((edit) => [
            `@@ entity/${edit.targetId}`,
            `- friendlyName: ${formatScalar(edit.before)}`,
            `+ friendlyName: ${formatScalar(edit.after)}`,
          ]),
          'friendly-name-review.diff',
        );

        return {
          artifacts: [artifact],
          edits,
          findingId: finding.id,
          id: `fix:${finding.id}:rename`,
          intent:
            'Rename every duplicated entity label so each entity can be reviewed and addressed unambiguously.',
          kind: 'rename_duplicate_name',
          rationale:
            'Duplicate friendly names create ambiguous cleanup and assistant experiences.',
          requiresConfirmation: true,
          risk: 'medium',
          steps: [
            'Review each entity sharing the duplicate name.',
            'Choose a disambiguated friendly name for each duplicate entity.',
            'Apply the naming change after confirming the new labels in Home Assistant.',
          ],
          targets,
          title: `Rename duplicate entities for ${finding.title.replace('Duplicate name: ', '')}`,
          warnings: [
            'Renaming entities can affect dashboards, automations, and voice-assistant phrases that reference the current friendly name.',
          ],
        };
      }

      case 'orphaned_entity_device': {
        const entityId = finding.objectIds[0]!;
        const missingDeviceId = finding.objectIds[1] ?? null;
        const edit = {
          after: null,
          before: missingDeviceId,
          fieldPath: 'deviceId',
          id: `edit:${finding.id}:device_id`,
          summary: `Clear the broken device link from ${entityId}.`,
          targetId: entityId,
        };
        const artifact = createDiffArtifact(
          `fix:${finding.id}:repair-link`,
          [
            `@@ entity/${entityId}`,
            `- deviceId: ${formatScalar(edit.before)}`,
            `+ deviceId: ${formatScalar(edit.after)}`,
          ],
          'entity-device-link-review.diff',
        );

        return {
          artifacts: [artifact],
          edits: [edit],
          findingId: finding.id,
          id: `fix:${finding.id}:repair-link`,
          intent:
            'Remove the broken entity-to-device link so the registry no longer references a missing device.',
          kind: 'repair_orphaned_entity_device',
          rationale:
            'Missing device links usually indicate stale registry state or a partially removed integration.',
          requiresConfirmation: true,
          risk: 'high',
          steps: [
            'Confirm whether the referenced device still exists in Home Assistant.',
            'Relink the entity to the correct device or remove the broken registry entry.',
            'Rescan after the registry cleanup to confirm the orphan is gone.',
          ],
          targets: [
            {
              id: entityId,
              kind: 'entity' as const,
              label: getEntityLabel(inventory, entityId),
            },
            ...(missingDeviceId
              ? [
                  {
                    id: missingDeviceId,
                    kind: 'device' as const,
                    label: `Missing device reference ${missingDeviceId}`,
                  },
                ]
              : []),
          ],
          title: `Repair missing device link for ${finding.objectIds[0]}`,
          warnings: [
            'Clearing the wrong device link can break entity grouping, dashboards, or automation assumptions tied to the current registry record.',
          ],
        };
      }

      case 'stale_entity': {
        const entityId = finding.objectIds[0]!;
        const edit = {
          after: 'user',
          before: null,
          fieldPath: 'disabledBy',
          id: `edit:${finding.id}:disabled_by`,
          summary: `Mark ${entityId} as user-disabled in the entity registry.`,
          targetId: entityId,
        };
        const artifact = createDiffArtifact(
          `fix:${finding.id}:review-stale`,
          [
            `@@ entity/${entityId}`,
            `- disabledBy: ${formatScalar(edit.before)}`,
            `+ disabledBy: ${formatScalar(edit.after)}`,
          ],
          'stale-entity-review.diff',
        );

        return {
          artifacts: [artifact],
          edits: [edit],
          findingId: finding.id,
          id: `fix:${finding.id}:review-stale`,
          intent:
            'Disable the stale entity in the registry so it no longer behaves like an active automation surface.',
          kind: 'review_stale_entity',
          rationale:
            'Stale entities often represent integrations or helpers that can be disabled or removed safely.',
          requiresConfirmation: true,
          risk: 'low',
          steps: [
            'Verify the entity is no longer needed.',
            'Disable or remove the stale entity from the registry or source integration.',
            'Run another scan to confirm the stale entity finding resolves.',
          ],
          targets: [
            {
              id: entityId,
              kind: 'entity' as const,
              label: getEntityLabel(inventory, entityId),
            },
          ],
          title: `Review stale entity ${finding.objectIds[0]}`,
          warnings: [
            'Disabling an entity will stop downstream dashboards or automations from seeing it as an active source.',
          ],
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
