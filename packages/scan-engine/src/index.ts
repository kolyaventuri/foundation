import {createHash} from 'node:crypto';
import type {
  Finding,
  FindingAdvisory,
  FixAction,
  FixArtifact,
  FixCommand,
  FixPreviewInput,
  FixRequiredInput,
  InventoryEntity,
  InventoryGraph,
  ScanEnrichment,
  ScanMode,
  ScanNote,
  ScanPassResult,
  ScanRun,
} from '@ha-repair/contracts';

type RunScanOptions = {
  backupCheckpoint?: ScanRun['backupCheckpoint'];
  createdAt?: string;
  enrichment?: ScanEnrichment;
  id?: string;
  mode?: ScanMode;
  notes?: ScanNote[];
  passes?: ScanPassResult[];
  profileName?: string | null;
};

function createScanId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `scan-${uuid}`;
  }

  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function indexDevices(inventory: InventoryGraph) {
  return new Map(
    inventory.devices.map((device) => [device.deviceId, device] as const),
  );
}

function findDuplicateNameFindings(inventory: InventoryGraph): Finding[] {
  const names = new Map<string, string[]>();

  for (const entity of inventory.entities) {
    const normalizedName = entity.displayName.trim();

    if (normalizedName.length === 0) {
      continue;
    }

    const matches = names.get(normalizedName) ?? [];
    matches.push(entity.entityId);
    names.set(normalizedName, matches);
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

function findMissingAreaAssignments(inventory: InventoryGraph): Finding[] {
  const devicesById = indexDevices(inventory);

  return inventory.entities
    .filter((entity) => {
      const device = entity.deviceId
        ? devicesById.get(entity.deviceId)
        : undefined;

      return !entity.areaId && !device?.areaId;
    })
    .map((entity) => ({
      evidence: `Entity ${entity.entityId} has no direct area assignment and no area inherited from its device.`,
      id: `missing_area_assignment:${entity.entityId}`,
      kind: 'missing_area_assignment',
      objectIds: [entity.entityId],
      severity: 'medium',
      title: `Missing area assignment for ${entity.entityId}`,
    }));
}

function findMissingFloorAssignments(inventory: InventoryGraph): Finding[] {
  if (inventory.floors.length === 0) {
    return [];
  }

  const devicesById = indexDevices(inventory);

  return inventory.entities
    .filter((entity) => {
      const device = entity.deviceId
        ? devicesById.get(entity.deviceId)
        : undefined;

      return !entity.floorId && !device?.floorId;
    })
    .map((entity) => ({
      evidence: `Entity ${entity.entityId} has no direct floor assignment and no floor inherited from its device, even though floors are configured in this inventory.`,
      id: `missing_floor_assignment:${entity.entityId}`,
      kind: 'missing_floor_assignment',
      objectIds: [entity.entityId],
      severity: 'low',
      title: `Missing floor assignment for ${entity.entityId}`,
    }));
}

function findDanglingLabelReferences(inventory: InventoryGraph): Finding[] {
  const knownLabels = new Set(inventory.labels.map((label) => label.labelId));
  const findings: Finding[] = [];

  for (const entity of inventory.entities) {
    for (const labelId of entity.labelIds ?? []) {
      if (knownLabels.has(labelId)) {
        continue;
      }

      findings.push({
        evidence: `Entity ${entity.entityId} references label ${labelId}, which was not present in the label registry snapshot.`,
        id: `dangling_label_reference:${entity.entityId}:${labelId}`,
        kind: 'dangling_label_reference',
        objectIds: [entity.entityId, labelId],
        severity: 'low',
        title: `Dangling label reference on ${entity.entityId}`,
      });
    }
  }

  for (const device of inventory.devices) {
    for (const labelId of device.labelIds ?? []) {
      if (knownLabels.has(labelId)) {
        continue;
      }

      findings.push({
        evidence: `Device ${device.deviceId} references label ${labelId}, which was not present in the label registry snapshot.`,
        id: `dangling_label_reference:${device.deviceId}:${labelId}`,
        kind: 'dangling_label_reference',
        objectIds: [device.deviceId, labelId],
        severity: 'low',
        title: `Dangling label reference on ${device.deviceId}`,
      });
    }
  }

  return findings;
}

function findAutomationInvalidTargets(inventory: InventoryGraph): Finding[] {
  const entityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );

  return inventory.automations.flatMap((automation) => {
    const missingTargetIds = automation.targetEntityIds.filter(
      (entityId) => !entityIds.has(entityId),
    );

    if (missingTargetIds.length === 0) {
      return [];
    }

    return [
      {
        evidence: `Automation ${automation.name} references ${missingTargetIds.length} missing entity target(s).`,
        id: `automation_invalid_target:${automation.automationId}`,
        kind: 'automation_invalid_target',
        objectIds: [automation.automationId, ...missingTargetIds],
        severity: 'high',
        title: `Automation has invalid targets: ${automation.name}`,
      },
    ];
  });
}

function findSceneInvalidTargets(inventory: InventoryGraph): Finding[] {
  const entityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );

  return inventory.scenes.flatMap((scene) => {
    const missingTargetIds = scene.targetEntityIds.filter(
      (entityId) => !entityIds.has(entityId),
    );

    if (missingTargetIds.length === 0) {
      return [];
    }

    return [
      {
        evidence: `Scene ${scene.name} references ${missingTargetIds.length} missing entity target(s).`,
        id: `scene_invalid_target:${scene.sceneId}`,
        kind: 'scene_invalid_target',
        objectIds: [scene.sceneId, ...missingTargetIds],
        severity: 'medium',
        title: `Scene has invalid targets: ${scene.name}`,
      },
    ];
  });
}

function findAssistantContextBloat(inventory: InventoryGraph): Finding[] {
  return inventory.entities
    .filter((entity) => (entity.assistantExposures?.length ?? 0) > 1)
    .map((entity) => ({
      evidence: `Entity ${entity.entityId} is exposed to ${entity.assistantExposures!.length} assistant surfaces: ${entity.assistantExposures!.join(', ')}.`,
      id: `assistant_context_bloat:${entity.entityId}`,
      kind: 'assistant_context_bloat',
      objectIds: [entity.entityId, ...(entity.assistantExposures ?? [])],
      severity: 'low',
      title: `Assistant context bloat for ${entity.entityId}`,
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

      case 'assistant_context_bloat':
      case 'automation_invalid_target':
      case 'dangling_label_reference':
      case 'missing_area_assignment':
      case 'missing_floor_assignment':
      case 'orphaned_entity_device':
      case 'scene_invalid_target': {
        return [];
      }
    }

    throw new Error('Unhandled finding kind');
  });
}

// eslint-disable-next-line max-params
function createGenericAdvisory(
  inventory: InventoryGraph,
  finding: Finding,
  rationale: string,
  summary: string,
  steps: string[],
  warnings: string[],
): FindingAdvisory {
  return {
    findingId: finding.id,
    id: `advisory:${finding.id}`,
    rationale,
    steps,
    summary,
    targets: finding.objectIds.map((objectId, index) => ({
      id: objectId,
      kind: index === 0 ? ('entity' as const) : ('device' as const),
      label: getEntityLabel(inventory, objectId),
    })),
    title: `Manual review required for ${finding.title}`,
    warnings,
  };
}

export function createFindingAdvisories(
  inventory: InventoryGraph,
  findings: Finding[],
): FindingAdvisory[] {
  return findings.flatMap((finding) => {
    switch (finding.kind) {
      case 'orphaned_entity_device': {
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
      }

      case 'missing_area_assignment': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Area coverage requires operator judgement because the correct room assignment depends on physical placement and dashboard intent.',
            'Assign the entity or its backing device to an area, then rerun the scan.',
            [
              'Review where the entity is physically located.',
              'Assign an area on the entity or device in Home Assistant.',
              'Rerun the scan to verify the coverage warning clears.',
            ],
            [
              'Applying the wrong area can distort dashboards, floor plans, and assistant room targeting.',
            ],
          ),
        ];
      }

      case 'missing_floor_assignment': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Floor coverage needs operator judgement because the right level assignment depends on the home layout, multi-story boundaries, and how the entity is surfaced in dashboards.',
            'Assign the entity or its backing device to a floor, then rerun the scan.',
            [
              'Review which floor the entity belongs to physically.',
              'Assign a floor on the entity or device in Home Assistant.',
              'Rerun the scan to verify the floor coverage warning clears.',
            ],
            [
              'Applying the wrong floor can distort floor plans, dashboard grouping, and voice targeting across levels.',
            ],
          ),
        ];
      }

      case 'dangling_label_reference': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Label cleanup is advisory because Home Assistant label usage often reflects operator-specific organization and automations.',
            'Review whether the missing label should be recreated or removed from the affected object.',
            [
              'Confirm the label still exists or should exist.',
              'Repair the label assignment on the affected object.',
              'Rerun the scan to verify the label hygiene warning clears.',
            ],
            [
              'Removing or renaming the wrong label can break dashboards and views that rely on custom grouping.',
            ],
          ),
        ];
      }

      case 'automation_invalid_target': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Automation target repair is advisory because the correct replacement entity must be chosen in Home Assistant or config YAML.',
            'Review the automation target list and repair or remove the missing entity references.',
            [
              'Open the automation definition or YAML source.',
              'Repair or remove missing entity references.',
              'Rerun the scan to confirm the invalid target warning clears.',
            ],
            [
              'Repairing the wrong automation target can silently change live behavior or stop the automation from working.',
            ],
          ),
        ];
      }

      case 'scene_invalid_target': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Scene target repair is advisory because scene membership depends on operator intent and live device state.',
            'Review the scene target list and repair or remove missing entity references.',
            [
              'Open the scene definition or YAML source.',
              'Repair or remove missing entity references.',
              'Rerun the scan to confirm the invalid scene target warning clears.',
            ],
            [
              'Repairing the wrong scene target can change what a scene controls when it is activated.',
            ],
          ),
        ];
      }

      case 'assistant_context_bloat': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Assistant exposure should be reviewed manually because each voice surface has different naming and exposure expectations.',
            'Review whether the entity really needs to be exposed to multiple assistant surfaces.',
            [
              'Review the entity exposure settings for Assist, Alexa, and HomeKit.',
              'Disable exposure where the entity is redundant.',
              'Rerun the scan to confirm the exposure warning clears.',
            ],
            [
              'Removing the wrong exposure can break existing voice routines or household expectations.',
            ],
          ),
        ];
      }

      case 'duplicate_name':
      case 'stale_entity': {
        return [];
      }
    }

    throw new Error('Unhandled finding kind');
  });
}

function createDefaultEnrichment(): ScanEnrichment {
  return {
    findingSummaries: [],
    provider: 'none',
    status: 'disabled',
  };
}

function buildFindings(inventory: InventoryGraph): Finding[] {
  return [
    ...findDuplicateNameFindings(inventory),
    ...findOrphanedDeviceLinks(inventory),
    ...findStaleEntities(inventory),
    ...findMissingAreaAssignments(inventory),
    ...findMissingFloorAssignments(inventory),
    ...findDanglingLabelReferences(inventory),
    ...findAutomationInvalidTargets(inventory),
    ...findSceneInvalidTargets(inventory),
    ...findAssistantContextBloat(inventory),
  ];
}

export function createScanFingerprint(input: {
  findings: Finding[];
  inventory: InventoryGraph;
  mode: ScanMode;
  profileName: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        findings: input.findings,
        inventory: input.inventory,
        mode: input.mode,
        profileName: input.profileName,
      }),
    )
    .digest('hex');
}

export function runScan(
  inventory: InventoryGraph,
  options: RunScanOptions = {},
): ScanRun {
  const findings = buildFindings(inventory);
  const mode = options.mode ?? inventory.source;
  const profileName = options.profileName ?? null;
  const fingerprint = createScanFingerprint({
    findings,
    inventory,
    mode,
    profileName,
  });

  return {
    createdAt: options.createdAt ?? new Date().toISOString(),
    enrichment: options.enrichment ?? createDefaultEnrichment(),
    findings,
    fingerprint,
    id: options.id ?? createScanId(),
    inventory,
    mode,
    notes: options.notes ?? [],
    passes: options.passes ?? [],
    profileName,
    ...(options.backupCheckpoint
      ? {backupCheckpoint: options.backupCheckpoint}
      : {}),
  };
}
