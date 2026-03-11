import type {
  Finding,
  FindingAdvisory,
  FixAction,
  FixArtifact,
  FixCommand,
  FixPreviewInput,
  FixRequiredInput,
  FrameworkSummary,
  InventoryEntity,
  InventoryGraph,
  ScanRun,
} from '@ha-repair/contracts';

function createScanId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `scan-${uuid}`;
  }

  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createFrameworkSummary(): FrameworkSummary {
  return {
    priorities: [
      'Replace the mock Home Assistant client with a real authenticated websocket + REST adapter.',
      'Expand deterministic rule packs for naming, area coverage, and assistant exposure.',
      'Move from dry-run previews into guarded live apply flows backed by reviewed queue snapshots.',
    ],
    surfaces: [
      {
        id: 'api',
        name: 'API shell',
        state: 'ready',
        summary:
          'Fastify now exposes persisted profile, scan, history, queue-backed preview, and dry-run apply endpoints.',
      },
      {
        id: 'web',
        name: 'Guided UI shell',
        state: 'ready',
        summary:
          'React + Vite render queue-aware scan review flows with explicit preview and dry-run confirmation steps.',
      },
      {
        id: 'cli',
        name: 'CLI path',
        state: 'ready',
        summary:
          'The CLI now manages saved profiles and local scan, findings, queue-backed dry-run apply, and markdown/json export flows.',
      },
      {
        id: 'rules',
        name: 'Repair engine',
        state: 'ready',
        summary:
          'Deterministic findings now persist with diff summaries, reviewed preview snapshots, and audit-ready exports.',
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
    const matches = names.get(entity.displayName) ?? [];
    matches.push(entity.entityId);
    names.set(entity.displayName, matches);
  }

  return [...names.entries()]
    .filter(([, entityIds]) => entityIds.length > 1)
    .map(([name, entityIds]) => ({
      evidence: `Found ${entityIds.length} entities displayed as "${name}".`,
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

function getEntity(
  inventory: InventoryGraph,
  entityId: string,
): InventoryEntity | undefined {
  return inventory.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
}

function getEntityLabel(inventory: InventoryGraph, entityId: string): string {
  const entity = getEntity(inventory, entityId);

  if (!entity) {
    return entityId;
  }

  return `${entity.displayName} (${entity.entityId})`;
}

function formatScalar(value: string | null | undefined): string {
  return value === null || value === undefined ? 'null' : `"${value}"`;
}

function createDiffArtifact(
  actionId: string,
  lines: string[],
  label: string,
): FixArtifact {
  return {
    content: lines.join('\n'),
    id: `${actionId}:diff`,
    kind: 'text_diff',
    label,
  };
}

function createNameRecommendation(entity: InventoryEntity): string {
  return `${entity.displayName} (${entity.entityId})`;
}

function indexInputs(inputs: FixPreviewInput[]): Map<string, FixPreviewInput> {
  return new Map(
    inputs.map((input) => [
      `${input.findingId}:${input.targetId}:${input.field}`,
      input,
    ]),
  );
}

function createDuplicateNameAction(
  inventory: InventoryGraph,
  finding: Finding,
  indexedInputs: Map<string, FixPreviewInput>,
): FixAction {
  const requiredInputs: FixRequiredInput[] = finding.objectIds.map(
    (entityId, index) => {
      const entity = getEntity(inventory, entityId);
      const input = indexedInputs.get(`${finding.id}:${entityId}:name`);

      return {
        currentValue: entity?.name ?? null,
        field: 'name',
        id: `input:${finding.id}:${index}:name`,
        ...(input?.value ? {providedValue: input.value} : {}),
        ...(entity ? {recommendedValue: createNameRecommendation(entity)} : {}),
        summary: `Provide the exact Home Assistant entity registry name to assign to ${entityId}.`,
        targetId: entityId,
      };
    },
  );

  const hasAllNames = requiredInputs.every((input) => input.providedValue);
  const commands: FixCommand[] = hasAllNames
    ? requiredInputs.map((input, index) => ({
        id: `command:${finding.id}:${index}:entity_registry_update`,
        payload: {
          entity_id: input.targetId,
          name: input.providedValue!,
          type: 'config/entity_registry/update',
        },
        summary: `Send config/entity_registry/update for ${input.targetId} with the reviewed name override.`,
        targetId: input.targetId,
        transport: 'websocket',
      }))
    : [];

  const artifacts =
    commands.length === 0
      ? []
      : [
          createDiffArtifact(
            `fix:${finding.id}:rename`,
            requiredInputs.flatMap((input) => [
              `@@ entity_registry/${input.targetId}`,
              `- name: ${formatScalar(input.currentValue)}`,
              `+ name: ${formatScalar(input.providedValue)}`,
            ]),
            'entity-registry-name-review.diff',
          ),
        ];

  return {
    artifacts,
    commands,
    findingId: finding.id,
    id: `fix:${finding.id}:rename`,
    intent:
      'Send explicit entity registry rename commands so each duplicate display label can be reviewed and resolved with literal Home Assistant payloads.',
    kind: 'rename_duplicate_name',
    rationale:
      'Duplicate display names create ambiguous cleanup and assistant experiences, but the final registry name must be operator-reviewed before sending.',
    requiredInputs,
    requiresConfirmation: true,
    risk: 'medium',
    steps: [
      'Review each entity sharing the duplicate display name.',
      'Provide the exact entity registry name to send for each selected entity.',
      'Review the resulting websocket payloads before dry-run apply.',
    ],
    targets: finding.objectIds.map((entityId) => ({
      id: entityId,
      kind: 'entity' as const,
      label: getEntityLabel(inventory, entityId),
    })),
    title: `Rename duplicate entities for ${finding.title.replace('Duplicate name: ', '')}`,
    warnings: [
      'Renaming entities can affect dashboards, automations, and voice-assistant phrases that reference the current display name.',
    ],
  };
}

function createStaleEntityAction(
  inventory: InventoryGraph,
  finding: Finding,
): FixAction {
  const entityId = finding.objectIds[0]!;
  const entity = getEntity(inventory, entityId);
  const command: FixCommand = {
    id: `command:${finding.id}:entity_registry_update`,
    payload: {
      disabled_by: 'user',
      entity_id: entityId,
      type: 'config/entity_registry/update',
    },
    summary: `Send config/entity_registry/update for ${entityId} with disabled_by set to user.`,
    targetId: entityId,
    transport: 'websocket',
  };

  return {
    artifacts: [
      createDiffArtifact(
        `fix:${finding.id}:review-stale`,
        [
          `@@ entity_registry/${entityId}`,
          `- disabled_by: ${formatScalar(entity?.disabledBy ?? null)}`,
          '+ disabled_by: "user"',
        ],
        'entity-registry-disable-review.diff',
      ),
    ],
    commands: [command],
    findingId: finding.id,
    id: `fix:${finding.id}:review-stale`,
    intent:
      'Disable the stale entity through the entity registry so it no longer behaves like an active automation surface.',
    kind: 'review_stale_entity',
    rationale:
      'Stale entities often represent integrations or helpers that can be disabled or removed safely.',
    requiredInputs: [],
    requiresConfirmation: true,
    risk: 'low',
    steps: [
      'Verify the entity is no longer needed.',
      'Review the websocket update payload that disables the entity.',
      'Run another scan to confirm the stale entity finding resolves.',
    ],
    targets: [
      {
        id: entityId,
        kind: 'entity' as const,
        label: getEntityLabel(inventory, entityId),
      },
    ],
    title: `Review stale entity ${entityId}`,
    warnings: [
      'Disabling an entity will stop downstream dashboards or automations from seeing it as an active source.',
    ],
  };
}

export function createFixActions(
  inventory: InventoryGraph,
  findings: Finding[],
  inputs: FixPreviewInput[] = [],
): FixAction[] {
  const indexedInputs = indexInputs(inputs);

  return findings.flatMap((finding) => {
    switch (finding.kind) {
      case 'duplicate_name': {
        return [createDuplicateNameAction(inventory, finding, indexedInputs)];
      }

      case 'stale_entity': {
        return [createStaleEntityAction(inventory, finding)];
      }

      case 'orphaned_entity_device': {
        return [];
      }
    }

    throw new Error('Unhandled finding kind');
  });
}

export function createFindingAdvisories(
  inventory: InventoryGraph,
  findings: Finding[],
): FindingAdvisory[] {
  return findings.flatMap((finding) => {
    if (finding.kind !== 'orphaned_entity_device') {
      return [];
    }

    const entityId = finding.objectIds[0]!;
    const missingDeviceId = finding.objectIds[1] ?? null;

    return [
      {
        findingId: finding.id,
        id: `advisory:${finding.id}`,
        rationale:
          'Home Assistant does not expose a literal entity registry update for changing device_id through the normal admin websocket API.',
        steps: [
          'Confirm whether the referenced device still exists in Home Assistant.',
          'Repair the source integration or remove and recreate the stale registry entry.',
          'Run another scan to confirm the orphaned device finding resolves.',
        ],
        summary:
          'This finding stays advisory-only because there is no supported literal Home Assistant mutation for clearing the broken device link.',
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
        title: `Manual review required for ${entityId}`,
        warnings: [
          'Repairing the wrong integration or registry record can break entity grouping, dashboards, or automation assumptions tied to the current registry entry.',
        ],
      },
    ];
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
    id: createScanId(),
    inventory,
    profileName,
  };
}
