import {createHash} from 'node:crypto';
import type {
  AssistantKind,
  Finding,
  FindingAdvisory,
  FindingAffectedObject,
  FindingCategory,
  FindingEvidenceDetails,
  FindingScores,
  FixAction,
  FixArtifact,
  FixCommand,
  FixPreviewInput,
  FixRequiredInput,
  InventoryEntity,
  InventoryGraph,
  ScanAuditSummary,
  ScanEnrichment,
  ScanMode,
  ScanNote,
  ScanPassResult,
  ScanRun,
  ScanOwnershipHotspot,
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

const userFacingDomains = new Set([
  'alarm_control_panel',
  'climate',
  'cover',
  'fan',
  'humidifier',
  'light',
  'lock',
  'media_player',
  'remote',
  'scene',
  'script',
  'siren',
  'switch',
  'vacuum',
  'valve',
  'water_heater',
]);

type ClassifiedEntity = {
  displayLabel: string;
  domain: string;
  entity: InventoryEntity;
  isUserFacing: boolean;
  normalizedLabel: string;
  resolvedAreaId: string | null;
};

type AssistantExposureRequiredInput = Extract<
  FixRequiredInput,
  {field: 'assistant_exposures'}
>;
type NameRequiredInput = Extract<FixRequiredInput, {field: 'name'}>;

type WriterTarget = {
  areaIds: string[];
  id: string;
  kind: 'automation' | 'scene';
  label: string;
  targetEntityIds: string[];
};

type OwnershipHotspot = ScanOwnershipHotspot & {
  findingId: string;
};

const helperEntityDomains = new Set([
  'counter',
  'input_boolean',
  'input_button',
  'input_datetime',
  'input_number',
  'input_select',
  'input_text',
  'timer',
]);

const ambiguousHelperNameTokens = new Set([
  'active',
  'default',
  'enable',
  'mode',
  'normal',
  'scene1',
  'state',
  'status',
  'switch',
  'temp',
  'test',
  'toggle',
]);

function normalizeLabelKey(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

function normalizeLabelDisplay(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ');
}

function getEntityDomain(entityId: string): string {
  return entityId.split('.', 1)[0] ?? entityId;
}

function tokenizeLabel(value: string): string[] {
  return normalizeLabelKey(value)
    .split(/[\s._-]+/u)
    .filter((token) => token.length > 0);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function createFinding(input: Finding): Finding {
  return {
    ...input,
    ...(input.relatedFindingIds
      ? {relatedFindingIds: uniqueValues(input.relatedFindingIds)}
      : {}),
    ...(input.tags ? {tags: uniqueValues(input.tags)} : {}),
  };
}

function createAffectedObject(
  kind: FindingAffectedObject['kind'],
  id: string,
  label?: string,
): FindingAffectedObject {
  return {
    id,
    kind,
    ...(label ? {label} : {}),
  };
}

function classifyEntities(inventory: InventoryGraph): ClassifiedEntity[] {
  const devicesById = indexDevices(inventory);

  return inventory.entities.flatMap((entity) => {
    const displayLabel = normalizeLabelDisplay(entity.displayName);

    if (displayLabel.length === 0) {
      return [];
    }

    const device = entity.deviceId
      ? devicesById.get(entity.deviceId)
      : undefined;
    const domain = getEntityDomain(entity.entityId);

    return [
      {
        displayLabel,
        domain,
        entity,
        isUserFacing:
          userFacingDomains.has(domain) ||
          (entity.assistantExposures?.length ?? 0) > 0,
        normalizedLabel: normalizeLabelKey(displayLabel),
        resolvedAreaId: entity.areaId ?? device?.areaId ?? null,
      },
    ];
  });
}

function getAreaLabel(inventory: InventoryGraph, areaId: string): string {
  return inventory.areas.find((area) => area.areaId === areaId)?.name ?? areaId;
}

function getDeviceLabel(inventory: InventoryGraph, deviceId: string): string {
  return (
    inventory.devices.find((device) => device.deviceId === deviceId)?.name ??
    deviceId
  );
}

function getAutomationLabel(
  inventory: InventoryGraph,
  automationId: string,
): string {
  return (
    inventory.automations.find(
      (automation) => automation.automationId === automationId,
    )?.name ?? automationId
  );
}

function getSceneLabel(inventory: InventoryGraph, sceneId: string): string {
  return (
    inventory.scenes.find((scene) => scene.sceneId === sceneId)?.name ?? sceneId
  );
}

function getWriterKindForId(
  inventory: InventoryGraph,
  writerId: string,
): WriterTarget['kind'] {
  return inventory.scenes.some((scene) => scene.sceneId === writerId)
    ? 'scene'
    : 'automation';
}

function getResolvedAreaId(
  inventory: InventoryGraph,
  entity: InventoryEntity | undefined,
): string | null {
  if (!entity) {
    return null;
  }

  const device = entity.deviceId
    ? indexDevices(inventory).get(entity.deviceId)
    : undefined;

  return entity.areaId ?? device?.areaId ?? null;
}

function createEntityFinding(
  inventory: InventoryGraph,
  input: {
    category: FindingCategory;
    checkId: string;
    confidence: number;
    entityId: string;
    evidence: string;
    evidenceDetails?: FindingEvidenceDetails;
    id: string;
    kind: Finding['kind'];
    objectIds?: string[];
    recommendation: NonNullable<Finding['recommendation']>;
    scores?: FindingScores;
    severity: Finding['severity'];
    summary: string;
    tags?: string[];
    title: string;
    whyItMatters?: string;
  },
): Finding {
  const entity = getEntity(inventory, input.entityId);
  const objectIds = input.objectIds ?? [input.entityId];

  return createFinding({
    affectedObjects: [
      createAffectedObject(
        'entity',
        input.entityId,
        entity ? getEntityLabel(inventory, input.entityId) : input.entityId,
      ),
    ],
    category: input.category,
    checkId: input.checkId,
    confidence: normalizeConfidence(input.confidence),
    evidence: input.evidence,
    ...(input.evidenceDetails ? {evidenceDetails: input.evidenceDetails} : {}),
    id: input.id,
    kind: input.kind,
    objectIds,
    recommendation: input.recommendation,
    ...(input.scores ? {scores: input.scores} : {}),
    severity: input.severity,
    summary: input.summary,
    ...(input.tags ? {tags: input.tags} : {}),
    title: input.title,
    ...(input.whyItMatters ? {whyItMatters: input.whyItMatters} : {}),
  });
}

function buildWriterTargets(inventory: InventoryGraph): WriterTarget[] {
  const entityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );
  const devicesById = indexDevices(inventory);
  const entitiesById = new Map(
    inventory.entities.map((entity) => [entity.entityId, entity] as const),
  );

  function getTargetAreaIds(targetEntityIds: string[]): string[] {
    return uniqueValues(
      targetEntityIds.flatMap((entityId) => {
        const entity = entitiesById.get(entityId);
        const device = entity?.deviceId
          ? devicesById.get(entity.deviceId)
          : undefined;
        const areaId = entity?.areaId ?? device?.areaId ?? null;

        return areaId ? [areaId] : [];
      }),
    );
  }

  return [
    ...inventory.automations.map((automation) => {
      const targetEntityIds = uniqueValues(
        automation.targetEntityIds.filter((entityId) =>
          entityIds.has(entityId),
        ),
      );

      return {
        areaIds: getTargetAreaIds(targetEntityIds),
        id: automation.automationId,
        kind: 'automation' as const,
        label: automation.name,
        targetEntityIds,
      };
    }),
    ...inventory.scenes.map((scene) => {
      const targetEntityIds = uniqueValues(
        scene.targetEntityIds.filter((entityId) => entityIds.has(entityId)),
      );

      return {
        areaIds: getTargetAreaIds(targetEntityIds),
        id: scene.sceneId,
        kind: 'scene' as const,
        label: scene.name,
        targetEntityIds,
      };
    }),
  ].filter((writer) => writer.targetEntityIds.length > 0);
}

function buildOwnershipHotspots(inventory: InventoryGraph): OwnershipHotspot[] {
  const writers = buildWriterTargets(inventory);
  const writersByEntityId = new Map<string, WriterTarget[]>();

  for (const writer of writers) {
    for (const entityId of writer.targetEntityIds) {
      const matches = writersByEntityId.get(entityId) ?? [];
      matches.push(writer);
      writersByEntityId.set(entityId, matches);
    }
  }

  return [...writersByEntityId.entries()]
    .filter(([, writersForEntity]) => writersForEntity.length >= 3)
    .map(([entityId, writersForEntity]) => ({
      areaIds: uniqueValues(
        writersForEntity.flatMap((writer) => writer.areaIds),
      ),
      entityId,
      entityLabel: getEntityLabel(inventory, entityId),
      findingId: `entity_ownership_hotspot:${entityId}`,
      writerIds: uniqueValues(writersForEntity.map((writer) => writer.id)),
      writerKinds: uniqueValues(
        writersForEntity.map((writer) => writer.kind),
      ) as Array<'automation' | 'scene'>,
    }));
}

function attachRelatedFindings(findings: Finding[]): Finding[] {
  const findingIdsByObjectId = new Map<string, string[]>();

  for (const finding of findings) {
    for (const objectId of uniqueValues(finding.objectIds)) {
      const related = findingIdsByObjectId.get(objectId) ?? [];
      related.push(finding.id);
      findingIdsByObjectId.set(objectId, related);
    }
  }

  return findings.map((finding) => {
    const relatedFindingIds = uniqueValues(
      finding.objectIds.flatMap(
        (objectId) => findingIdsByObjectId.get(objectId) ?? [],
      ),
    ).filter((candidateId) => candidateId !== finding.id);

    return createFinding({
      ...finding,
      ...(relatedFindingIds.length > 0 ? {relatedFindingIds} : {}),
    });
  });
}

function findNameLabelFindings(inventory: InventoryGraph): Finding[] {
  const findings: Finding[] = [];
  const classified = classifyEntities(inventory);
  const entitiesByLabel = new Map<string, ClassifiedEntity[]>();

  for (const entry of classified) {
    const matches = entitiesByLabel.get(entry.normalizedLabel) ?? [];
    matches.push(entry);
    entitiesByLabel.set(entry.normalizedLabel, matches);
  }

  for (const entries of entitiesByLabel.values()) {
    if (entries.length < 2) {
      continue;
    }

    const userFacingByArea = new Map<string, ClassifiedEntity[]>();

    for (const entry of entries) {
      if (!entry.isUserFacing || !entry.resolvedAreaId) {
        continue;
      }

      const matches = userFacingByArea.get(entry.resolvedAreaId) ?? [];
      matches.push(entry);
      userFacingByArea.set(entry.resolvedAreaId, matches);
    }

    const actionableClusters = [...userFacingByArea.entries()].filter(
      ([, areaEntries]) => areaEntries.length > 1,
    );

    if (actionableClusters.length > 0) {
      for (const [areaId, areaEntries] of actionableClusters) {
        const label = areaEntries[0]!.displayLabel;
        const areaLabel = getAreaLabel(inventory, areaId);
        const entityIds = areaEntries.map((entry) => entry.entity.entityId);

        findings.push(
          createFinding({
            affectedObjects: [
              createAffectedObject('area', areaId, areaLabel),
              ...entityIds.map((entityId) =>
                createAffectedObject(
                  'entity',
                  entityId,
                  getEntityLabel(inventory, entityId),
                ),
              ),
            ],
            category: 'naming_intent_drift',
            checkId: 'SEMANTIC_DUPLICATE_NAMING',
            confidence: normalizeConfidence(0.98),
            evidence: `Found ${areaEntries.length} user-facing entities in ${areaLabel} that all display as "${label}", which creates an ambiguous in-area label collision.`,
            evidenceDetails: {
              areaId,
              areaLabel,
              entityCount: areaEntries.length,
              normalizedLabel: areaEntries[0]!.normalizedLabel,
            },
            id: `duplicate_name:${label}:${areaId}`,
            kind: 'duplicate_name',
            objectIds: entityIds,
            recommendation: {
              action:
                'Assign distinct entity names that stay clear within the room.',
              steps: [
                'Review the colliding entities and confirm they really need different labels.',
                'Pick names that stay understandable in dashboards and voice flows.',
                'Rerun the scan to confirm the in-area collision clears.',
              ],
            },
            scores: {
              clarity: 90,
              noise: 68,
            },
            severity: 'medium',
            summary: `${label} appears on ${areaEntries.length} user-facing entities in ${areaLabel}.`,
            tags: ['ambiguous-name', areaId],
            title: `Ambiguous name in ${areaLabel}: ${label}`,
            whyItMatters:
              'Same-area labels are difficult to distinguish when operators or assistants target entities by room.',
          }),
        );
      }

      continue;
    }

    const label = entries[0]!.displayLabel;
    const domains = [...new Set(entries.map((entry) => entry.domain))].sort();
    const areaLabels = [
      ...new Set(
        entries.map((entry) =>
          entry.resolvedAreaId
            ? getAreaLabel(inventory, entry.resolvedAreaId)
            : 'Unassigned',
        ),
      ),
    ].sort();
    const entityIds = entries.map((entry) => entry.entity.entityId);

    findings.push(
      createFinding({
        affectedObjects: entityIds.map((entityId) =>
          createAffectedObject(
            'entity',
            entityId,
            getEntityLabel(inventory, entityId),
          ),
        ),
        category: 'naming_intent_drift',
        checkId: 'SHARED_LABEL_OBSERVATION',
        confidence: normalizeConfidence(0.82),
        evidence: `Label "${label}" is shared by ${entries.length} entities across domains ${domains.join(', ')} and areas ${areaLabels.join(', ')}, but does not create a user-facing in-area collision.`,
        evidenceDetails: {
          areaLabels,
          domainCount: domains.length,
          domains,
          entityCount: entries.length,
        },
        id: `shared_label_observation:${label}`,
        kind: 'shared_label_observation',
        objectIds: entityIds,
        recommendation: {
          action:
            'Keep the shared label only if it remains understandable in practice.',
          steps: [
            'Check whether the overlap is confusing in dashboards or assistant flows.',
            'Rename only the entries that create real operator friction.',
            'Rerun the scan after any manual cleanup.',
          ],
        },
        scores: {
          clarity: 34,
          noise: 28,
        },
        severity: 'low',
        summary: `${label} is reused across ${entries.length} scan-visible entities.`,
        tags: ['shared-label'],
        title: `Shared label observation: ${label}`,
      }),
    );
  }

  return findings;
}

function findOrphanedDeviceLinks(inventory: InventoryGraph): Finding[] {
  const deviceIds = new Set(inventory.devices.map((device) => device.deviceId));

  return inventory.entities
    .filter((entity) => entity.deviceId && !deviceIds.has(entity.deviceId))
    .map((entity) =>
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'entity',
            entity.entityId,
            getEntityLabel(inventory, entity.entityId),
          ),
          createAffectedObject(
            'device',
            entity.deviceId!,
            `Missing device reference ${entity.deviceId!}`,
          ),
        ],
        category: 'broken_references',
        checkId: 'ENTITY_ORPHANED_DEVICE_LINK',
        confidence: normalizeConfidence(0.99),
        evidence: `Entity ${entity.entityId} references missing device ${entity.deviceId}.`,
        evidenceDetails: {
          entityId: entity.entityId,
          missingDeviceId: entity.deviceId!,
        },
        id: `orphaned_entity_device:${entity.entityId}`,
        kind: 'orphaned_entity_device',
        objectIds: [entity.entityId, entity.deviceId!],
        recommendation: {
          action:
            'Repair the underlying integration or recreate the missing device relationship.',
          steps: [
            'Confirm whether the missing device still exists in Home Assistant.',
            'Repair or recreate the registry relationship from the source integration.',
            'Rerun the scan to confirm the orphaned link clears.',
          ],
        },
        scores: {
          fragility: 88,
        },
        severity: 'high',
        summary: `${entity.entityId} still points at missing device ${entity.deviceId}.`,
        tags: ['orphaned-device-link'],
        title: `Orphaned entity/device link for ${entity.entityId}`,
      }),
    );
}

function findStaleEntities(inventory: InventoryGraph): Finding[] {
  return inventory.entities
    .filter((entity) => entity.isStale)
    .map((entity) =>
      createEntityFinding(inventory, {
        category: 'dead_legacy_objects',
        checkId: 'STALE_ENTITY',
        confidence: 0.96,
        entityId: entity.entityId,
        evidence: `Entity ${entity.entityId} is marked stale by inventory collection.`,
        evidenceDetails: {
          entityId: entity.entityId,
          state: entity.state ?? 'unknown',
        },
        id: `stale_entity:${entity.entityId}`,
        kind: 'stale_entity',
        recommendation: {
          action:
            'Disable or remove the stale entity if it no longer represents a live integration surface.',
          steps: [
            'Confirm the entity is no longer needed by dashboards, automations, or assistants.',
            'Disable the entity or remove its source integration/helper.',
            'Rerun the scan to confirm the stale entity finding clears.',
          ],
        },
        scores: {
          noise: 72,
        },
        severity: 'low',
        summary: `${entity.entityId} looks stale in the current inventory snapshot.`,
        tags: ['cleanup-candidate', 'stale-entity'],
        title: `Stale entity ${entity.entityId}`,
      }),
    );
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
    .map((entity) =>
      createEntityFinding(inventory, {
        category: 'inventory_hygiene',
        checkId: 'MISSING_AREA_ASSIGNMENT',
        confidence: 0.95,
        entityId: entity.entityId,
        evidence: `Entity ${entity.entityId} has no direct area assignment and no area inherited from its device.`,
        evidenceDetails: {
          deviceId: entity.deviceId ?? 'none',
          entityId: entity.entityId,
        },
        id: `missing_area_assignment:${entity.entityId}`,
        kind: 'missing_area_assignment',
        recommendation: {
          action:
            'Assign the entity or its backing device to the correct Home Assistant area.',
          steps: [
            'Confirm the entity physical location or dashboard grouping.',
            'Assign the entity or device to the correct area.',
            'Rerun the scan to confirm the coverage warning clears.',
          ],
        },
        scores: {
          clarity: 48,
        },
        severity: 'medium',
        summary: `${entity.entityId} does not resolve to any Home Assistant area.`,
        tags: ['missing-area'],
        title: `Missing area assignment for ${entity.entityId}`,
      }),
    );
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
    .map((entity) =>
      createEntityFinding(inventory, {
        category: 'inventory_hygiene',
        checkId: 'MISSING_FLOOR_ASSIGNMENT',
        confidence: 0.94,
        entityId: entity.entityId,
        evidence: `Entity ${entity.entityId} has no direct floor assignment and no floor inherited from its device, even though floors are configured in this inventory.`,
        evidenceDetails: {
          entityId: entity.entityId,
          floorCount: inventory.floors.length,
        },
        id: `missing_floor_assignment:${entity.entityId}`,
        kind: 'missing_floor_assignment',
        recommendation: {
          action:
            'Assign the entity or its backing device to the correct floor.',
          steps: [
            'Confirm which floor the entity belongs to physically.',
            'Assign the floor on the entity or its backing device.',
            'Rerun the scan to confirm the floor warning clears.',
          ],
        },
        scores: {
          clarity: 36,
        },
        severity: 'low',
        summary: `${entity.entityId} does not resolve to any floor even though floors exist in this install.`,
        tags: ['missing-floor'],
        title: `Missing floor assignment for ${entity.entityId}`,
      }),
    );
}

function findDanglingLabelReferences(inventory: InventoryGraph): Finding[] {
  const knownLabels = new Set(inventory.labels.map((label) => label.labelId));
  const findings: Finding[] = [];

  for (const entity of inventory.entities) {
    for (const labelId of entity.labelIds ?? []) {
      if (knownLabels.has(labelId)) {
        continue;
      }

      findings.push(
        createFinding({
          affectedObjects: [
            createAffectedObject(
              'entity',
              entity.entityId,
              getEntityLabel(inventory, entity.entityId),
            ),
            createAffectedObject('label', labelId, `Missing label ${labelId}`),
          ],
          category: 'broken_references',
          checkId: 'DANGLING_LABEL_REFERENCE',
          confidence: normalizeConfidence(0.98),
          evidence: `Entity ${entity.entityId} references label ${labelId}, which was not present in the label registry snapshot.`,
          evidenceDetails: {
            entityId: entity.entityId,
            labelId,
            objectKind: 'entity',
          },
          id: `dangling_label_reference:${entity.entityId}:${labelId}`,
          kind: 'dangling_label_reference',
          objectIds: [entity.entityId, labelId],
          recommendation: {
            action:
              'Recreate the intended label or remove the stale label reference.',
            steps: [
              'Confirm whether the label should still exist.',
              'Repair the label assignment on the affected object.',
              'Rerun the scan to confirm the label reference clears.',
            ],
          },
          scores: {
            clarity: 26,
          },
          severity: 'low',
          summary: `${entity.entityId} references missing label ${labelId}.`,
          tags: ['dangling-label'],
          title: `Dangling label reference on ${entity.entityId}`,
        }),
      );
    }
  }

  for (const device of inventory.devices) {
    for (const labelId of device.labelIds ?? []) {
      if (knownLabels.has(labelId)) {
        continue;
      }

      findings.push(
        createFinding({
          affectedObjects: [
            createAffectedObject(
              'device',
              device.deviceId,
              `${getDeviceLabel(inventory, device.deviceId)} (${device.deviceId})`,
            ),
            createAffectedObject('label', labelId, `Missing label ${labelId}`),
          ],
          category: 'broken_references',
          checkId: 'DANGLING_LABEL_REFERENCE',
          confidence: normalizeConfidence(0.98),
          evidence: `Device ${device.deviceId} references label ${labelId}, which was not present in the label registry snapshot.`,
          evidenceDetails: {
            deviceId: device.deviceId,
            labelId,
            objectKind: 'device',
          },
          id: `dangling_label_reference:${device.deviceId}:${labelId}`,
          kind: 'dangling_label_reference',
          objectIds: [device.deviceId, labelId],
          recommendation: {
            action:
              'Recreate the intended label or remove the stale label reference.',
            steps: [
              'Confirm whether the label should still exist.',
              'Repair the label assignment on the affected device.',
              'Rerun the scan to confirm the label reference clears.',
            ],
          },
          scores: {
            clarity: 26,
          },
          severity: 'low',
          summary: `${device.deviceId} references missing label ${labelId}.`,
          tags: ['dangling-label'],
          title: `Dangling label reference on ${device.deviceId}`,
        }),
      );
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
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'automation',
            automation.automationId,
            `${automation.name} (${automation.automationId})`,
          ),
          ...missingTargetIds.map((targetId) =>
            createAffectedObject('entity', targetId, targetId),
          ),
        ],
        category: 'broken_references',
        checkId: 'AUTOMATION_MISSING_REFERENCE',
        confidence: normalizeConfidence(0.99),
        evidence: `Automation ${automation.name} references ${missingTargetIds.length} missing entity target(s).`,
        evidenceDetails: {
          automationId: automation.automationId,
          missingTargetIds,
          missingTargetCount: missingTargetIds.length,
          ...(automation.sourcePath ? {sourcePath: automation.sourcePath} : {}),
        },
        id: `automation_invalid_target:${automation.automationId}`,
        kind: 'automation_invalid_target',
        objectIds: [automation.automationId, ...missingTargetIds],
        recommendation: {
          action:
            'Replace or remove the stale entity references in the automation target set.',
          steps: [
            'Open the automation definition or YAML source.',
            'Repair or remove the missing entity references.',
            'Rerun the scan to confirm the broken reference clears.',
          ],
        },
        scores: {
          fragility: 90,
        },
        severity: 'high',
        summary: `${automation.name} references ${missingTargetIds.length} entity target(s) that are missing from the current inventory.`,
        tags: ['automation-missing-reference'],
        title: `Automation has invalid targets: ${automation.name}`,
      }),
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
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'scene',
            scene.sceneId,
            `${scene.name} (${scene.sceneId})`,
          ),
          ...missingTargetIds.map((targetId) =>
            createAffectedObject('entity', targetId, targetId),
          ),
        ],
        category: 'broken_references',
        checkId: 'SCENE_TARGET_MISSING_ENTITY',
        confidence: normalizeConfidence(0.99),
        evidence: `Scene ${scene.name} references ${missingTargetIds.length} missing entity target(s).`,
        evidenceDetails: {
          missingTargetCount: missingTargetIds.length,
          missingTargetIds,
          ...(scene.sourcePath ? {sourcePath: scene.sourcePath} : {}),
          sceneId: scene.sceneId,
        },
        id: `scene_invalid_target:${scene.sceneId}`,
        kind: 'scene_invalid_target',
        objectIds: [scene.sceneId, ...missingTargetIds],
        recommendation: {
          action:
            'Replace or remove the stale entity references in the scene membership.',
          steps: [
            'Open the scene definition or YAML source.',
            'Repair or remove the missing entity references.',
            'Rerun the scan to confirm the broken scene target clears.',
          ],
        },
        scores: {
          fragility: 74,
        },
        severity: 'medium',
        summary: `${scene.name} references ${missingTargetIds.length} entity target(s) that are missing from the current inventory.`,
        tags: ['scene-missing-target'],
        title: `Scene has invalid targets: ${scene.name}`,
      }),
    ];
  });
}

function findAssistantContextBloat(inventory: InventoryGraph): Finding[] {
  return inventory.entities
    .filter((entity) => (entity.assistantExposures?.length ?? 0) > 1)
    .map((entity) =>
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'entity',
            entity.entityId,
            getEntityLabel(inventory, entity.entityId),
          ),
          ...(entity.assistantExposures ?? []).map((assistant) =>
            createAffectedObject(
              'assistant',
              assistant,
              `${assistant} exposure`,
            ),
          ),
        ],
        category: 'inventory_hygiene',
        checkId: 'ASSISTANT_CONTEXT_BLOAT',
        confidence: normalizeConfidence(0.93),
        evidence: `Entity ${entity.entityId} is exposed to ${entity.assistantExposures!.length} assistant surfaces: ${entity.assistantExposures!.join(', ')}.`,
        evidenceDetails: {
          assistantCount: entity.assistantExposures!.length,
          assistants: entity.assistantExposures!,
          entityId: entity.entityId,
        },
        id: `assistant_context_bloat:${entity.entityId}`,
        kind: 'assistant_context_bloat',
        objectIds: [entity.entityId, ...(entity.assistantExposures ?? [])],
        recommendation: {
          action:
            'Keep only the assistant surfaces that still need this entity.',
          steps: [
            'Review which assistants actively use the entity.',
            'Disable extra exposures that only add noise.',
            'Rerun the scan to confirm the exposure set is intentional.',
          ],
        },
        scores: {
          noise: 58,
        },
        severity:
          (entity.assistantExposures?.length ?? 0) >= 3 ? 'medium' : 'low',
        summary: `${entity.entityId} is exposed to ${entity.assistantExposures!.length} assistant surfaces.`,
        tags: ['assistant-exposure'],
        title: `Assistant context bloat for ${entity.entityId}`,
      }),
    );
}

function findAmbiguousHelperNames(inventory: InventoryGraph): Finding[] {
  return inventory.entities
    .filter((entity) =>
      helperEntityDomains.has(getEntityDomain(entity.entityId)),
    )
    .filter((entity) => {
      const tokens = tokenizeLabel(entity.displayName);

      return (
        tokens.length > 0 &&
        tokens.length <= 2 &&
        tokens.every((token) => ambiguousHelperNameTokens.has(token))
      );
    })
    .map((entity) => {
      const areaId = getResolvedAreaId(inventory, entity);
      const tokens = tokenizeLabel(entity.displayName);

      return createEntityFinding(inventory, {
        category: 'naming_intent_drift',
        checkId: 'AMBIGUOUS_HELPER_NAME',
        confidence: 0.91,
        entityId: entity.entityId,
        evidence: `Helper ${entity.entityId} still uses ambiguous label "${entity.displayName}", which does not explain what the helper controls.`,
        evidenceDetails: {
          areaId: areaId ?? 'unassigned',
          helperDomain: getEntityDomain(entity.entityId),
          helperNameTokens: tokens,
        },
        id: `ambiguous_helper_name:${entity.entityId}`,
        kind: 'ambiguous_helper_name',
        recommendation: {
          action:
            'Rename the helper so its label describes the room, role, or automation intent.',
          steps: [
            'Review what the helper actually gates or represents.',
            'Choose a name that carries room or behavior context.',
            'Rerun the scan to confirm the ambiguity warning clears.',
          ],
        },
        scores: {
          clarity: 86,
        },
        severity: tokens.length === 1 ? 'medium' : 'low',
        summary: `${entity.entityId} still uses weak helper label "${entity.displayName}".`,
        tags: [
          'ambiguous-helper',
          getEntityDomain(entity.entityId),
          ...(areaId ? [areaId] : []),
        ],
        title: `Ambiguous helper name on ${entity.entityId}`,
      });
    });
}

function findEntityOwnershipHotspots(
  inventory: InventoryGraph,
  hotspots: OwnershipHotspot[],
): Finding[] {
  return hotspots.map((hotspot) => {
    const writerLabels = hotspot.writerIds.map((writerId) => {
      const writerKind = getWriterKindForId(inventory, writerId);

      return writerKind === 'scene'
        ? getSceneLabel(inventory, writerId)
        : getAutomationLabel(inventory, writerId);
    });
    const affectedObjects = [
      createAffectedObject(
        'entity',
        hotspot.entityId,
        getEntityLabel(inventory, hotspot.entityId),
      ),
      ...hotspot.writerIds.map((writerId) => {
        const writerKind = getWriterKindForId(inventory, writerId);

        return writerKind === 'scene'
          ? createAffectedObject(
              'scene',
              writerId,
              `${getSceneLabel(inventory, writerId)} (${writerId})`,
            )
          : createAffectedObject(
              'automation',
              writerId,
              `${getAutomationLabel(inventory, writerId)} (${writerId})`,
            );
      }),
    ];

    return createFinding({
      affectedObjects,
      category: 'conflict_overlap',
      checkId: 'ENTITY_OWNERSHIP_HOTSPOT',
      confidence: normalizeConfidence(0.95),
      evidence: `Entity ${hotspot.entityId} is targeted by ${hotspot.writerIds.length} scan-visible writers: ${writerLabels.join(', ')}.`,
      evidenceDetails: {
        areaIds: hotspot.areaIds,
        entityId: hotspot.entityId,
        writerCount: hotspot.writerIds.length,
        writerIds: hotspot.writerIds,
        writerKinds: hotspot.writerKinds,
      },
      id: hotspot.findingId,
      kind: 'entity_ownership_hotspot',
      objectIds: [hotspot.entityId, ...hotspot.writerIds],
      recommendation: {
        action:
          'Review whether these writers should be consolidated or narrowed so fewer objects target the same entity.',
        steps: [
          'Inspect the automations or scenes that write to the entity.',
          'Decide whether overlapping writers should be merged, sequenced, or removed.',
          'Rerun the scan to verify the hotspot is reduced.',
        ],
      },
      scores: {
        coupling: normalizeScore(52 + hotspot.writerIds.length * 10),
        fragility: normalizeScore(40 + hotspot.writerIds.length * 8),
        redundancy: normalizeScore(24 + hotspot.writerIds.length * 6),
      },
      severity: hotspot.writerIds.length >= 4 ? 'high' : 'medium',
      summary: `${hotspot.entityId} is controlled by ${hotspot.writerIds.length} scan-visible writers.`,
      tags: ['ownership-hotspot', ...hotspot.areaIds],
      title: `Ownership hotspot for ${hotspot.entityId}`,
      whyItMatters:
        'Several writers targeting one entity increases coordination risk and makes future repair work harder to reason about.',
    });
  });
}

function findHighlyCoupledAutomations(inventory: InventoryGraph): Finding[] {
  const writerTargets = buildWriterTargets(inventory).filter(
    (writer) => writer.kind === 'automation',
  );

  return writerTargets.flatMap((writer) => {
    const targetDomains = uniqueValues(
      writer.targetEntityIds.map((entityId) => getEntityDomain(entityId)),
    );
    const targetCount = writer.targetEntityIds.length;
    const areaCount = writer.areaIds.length;
    const domainCount = targetDomains.length;
    const isHighlyCoupled =
      targetCount >= 5 ||
      areaCount >= 3 ||
      (targetCount >= 4 && domainCount >= 3);

    if (!isHighlyCoupled) {
      return [];
    }

    return [
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'automation',
            writer.id,
            `${writer.label} (${writer.id})`,
          ),
          ...writer.targetEntityIds.map((entityId) =>
            createAffectedObject(
              'entity',
              entityId,
              getEntityLabel(inventory, entityId),
            ),
          ),
        ],
        category: 'fragile_automation_patterns',
        checkId: 'HIGHLY_COUPLED_AUTOMATION',
        confidence: normalizeConfidence(0.87),
        evidence: `Automation ${writer.label} reaches ${targetCount} target entities across ${domainCount} domains and ${areaCount} area group(s), which makes it unusually broad for one automation.`,
        evidenceDetails: {
          areaCount,
          areaIds: writer.areaIds,
          automationId: writer.id,
          domainCount,
          targetCount,
          targetDomains,
        },
        id: `highly_coupled_automation:${writer.id}`,
        kind: 'highly_coupled_automation',
        objectIds: [writer.id, ...writer.targetEntityIds],
        recommendation: {
          action:
            'Review whether the automation should be split into smaller intent-specific automations or scripts.',
          steps: [
            'Inspect whether the automation is carrying multiple unrelated responsibilities.',
            'Split broad actions into narrower automations or shared scripts where helpful.',
            'Rerun the scan to verify the coupling warning is reduced.',
          ],
        },
        scores: {
          coupling: normalizeScore(36 + targetCount * 8 + domainCount * 6),
          fragility: normalizeScore(28 + areaCount * 12 + targetCount * 5),
        },
        severity:
          targetCount >= 7 || areaCount >= 3 || domainCount >= 4
            ? 'high'
            : 'medium',
        summary: `${writer.label} spans ${targetCount} targets across ${domainCount} domains and ${areaCount} area group(s).`,
        tags: ['high-coupling', ...writer.areaIds],
        title: `Highly coupled automation: ${writer.label}`,
        whyItMatters:
          'Large automations create wider blast radius when a single change or broken reference slips into the control path.',
      }),
    ];
  });
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

function createFindingTargets(
  inventory: InventoryGraph,
  finding: Finding,
): FindingAdvisory['targets'] {
  if (finding.affectedObjects && finding.affectedObjects.length > 0) {
    return finding.affectedObjects.map((object) => ({
      id: object.id,
      kind: object.kind,
      label: object.label ?? object.id,
    }));
  }

  return finding.objectIds.map((objectId, index) => ({
    id: objectId,
    kind: index === 0 ? ('entity' as const) : ('device' as const),
    label: getEntityLabel(inventory, objectId),
  }));
}

function createSharedLabelObservationAdvisory(
  inventory: InventoryGraph,
  finding: Finding,
): FindingAdvisory {
  return {
    findingId: finding.id,
    id: `advisory:${finding.id}`,
    rationale:
      'Repeated labels that span different roles or areas are noted for awareness, but they are not treated as a direct rename target unless they create a user-facing in-area collision.',
    steps: [
      'Review the entities sharing the label and confirm whether the overlap is intentional.',
      'Rename only if the overlap is actually confusing in your dashboards or assistant flows.',
      'Rerun the scan to confirm whether a future in-area collision remains.',
    ],
    summary:
      'Review whether the shared label is intentional, then rerun the scan after any manual cleanup.',
    targets: createFindingTargets(inventory, finding),
    title: `Manual review required for ${finding.title}`,
    warnings: [
      'Renaming helpers, automations, or sensors purely to eliminate harmless label reuse can create churn without improving the Home Assistant setup.',
    ],
  };
}

function indexInputs(inputs: FixPreviewInput[]): Map<string, FixPreviewInput> {
  return new Map(
    inputs.map((input) => [
      `${input.findingId}:${input.targetId}:${input.field}`,
      input,
    ]),
  );
}

function getNameInputValue(
  indexedInputs: Map<string, FixPreviewInput>,
  findingId: string,
  entityId: string,
): string | undefined {
  const input = indexedInputs.get(`${findingId}:${entityId}:name`);

  if (!input || input.field !== 'name') {
    return undefined;
  }

  const trimmedValue = input.value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getAssistantExposureInputValue(
  indexedInputs: Map<string, FixPreviewInput>,
  findingId: string,
  entityId: string,
): AssistantKind[] | undefined {
  const input = indexedInputs.get(
    `${findingId}:${entityId}:assistant_exposures`,
  );

  if (!input || input.field !== 'assistant_exposures') {
    return undefined;
  }

  return [...new Set(input.value)].sort();
}

function areAssistantExposureSetsEqual(
  left: AssistantKind[] | undefined,
  right: AssistantKind[] | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.length === right.length &&
    left.every((assistant, index) => assistant === right[index])
  );
}

function createDuplicateNameAction(
  inventory: InventoryGraph,
  finding: Finding,
  indexedInputs: Map<string, FixPreviewInput>,
): FixAction {
  const requiredInputs: NameRequiredInput[] = finding.objectIds.map(
    (entityId, index) => {
      const entity = getEntity(inventory, entityId);
      const providedValue = getNameInputValue(
        indexedInputs,
        finding.id,
        entityId,
      );

      return {
        currentValue: entity?.name ?? null,
        field: 'name',
        id: `input:${finding.id}:${index}:name`,
        ...(providedValue ? {providedValue} : {}),
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
      'Review each entity sharing the ambiguous in-area display name.',
      'Provide the exact entity registry name to send for each selected entity.',
      'Review the resulting websocket payloads before dry-run apply.',
    ],
    targets: finding.objectIds.map((entityId) => ({
      id: entityId,
      kind: 'entity' as const,
      label: getEntityLabel(inventory, entityId),
    })),
    title: `Rename entities for ${finding.title}`,
    warnings: [
      'Renaming entities can affect dashboards, automations, and voice-assistant phrases that reference the current display name.',
    ],
  };
}

function createAssistantExposureAction(
  inventory: InventoryGraph,
  finding: Finding,
  indexedInputs: Map<string, FixPreviewInput>,
): FixAction {
  const entityId = finding.objectIds[0]!;
  const entity = getEntity(inventory, entityId);
  const currentExposures = [
    ...new Set(entity?.assistantExposures ?? []),
  ].sort();
  const allowedExposureSet = new Set(currentExposures);
  const providedValue = getAssistantExposureInputValue(
    indexedInputs,
    finding.id,
    entityId,
  )?.filter((assistant) => allowedExposureSet.has(assistant));
  const requiredInput: AssistantExposureRequiredInput = {
    currentValue: currentExposures,
    field: 'assistant_exposures',
    id: `input:${finding.id}:assistant_exposures`,
    ...(providedValue ? {providedValue} : {}),
    summary: `Choose which assistant surfaces should keep exposing ${entityId}.`,
    targetId: entityId,
  };
  const hasChange =
    providedValue !== undefined &&
    !areAssistantExposureSetsEqual(currentExposures, providedValue);
  let optionUpdates: NonNullable<FixCommand['payload']['options']> | undefined;

  if (hasChange && entity?.assistantExposureBindings) {
    optionUpdates = {};

    for (const assistant of currentExposures) {
      const binding = entity.assistantExposureBindings[assistant];

      if (!binding) {
        continue;
      }

      optionUpdates[binding.optionKey] = {
        [binding.flagKey]: providedValue.includes(assistant),
      };
    }
  }

  const command: FixCommand | undefined =
    hasChange && optionUpdates && Object.keys(optionUpdates).length > 0
      ? {
          id: `command:${finding.id}:entity_registry_update`,
          payload: {
            entity_id: entityId,
            options: optionUpdates,
            type: 'config/entity_registry/update' as const,
          },
          summary: `Send config/entity_registry/update for ${entityId} with the reviewed assistant exposure set.`,
          targetId: entityId,
          transport: 'websocket' as const,
        }
      : undefined;

  return {
    artifacts:
      !command || !optionUpdates
        ? []
        : [
            createDiffArtifact(
              `fix:${finding.id}:review-exposure`,
              [
                `@@ entity_registry/${entityId}/options`,
                ...currentExposures.flatMap((assistant) => {
                  const binding =
                    entity?.assistantExposureBindings?.[assistant];

                  if (!binding) {
                    return [];
                  }

                  return [
                    `- ${binding.optionKey}.${binding.flagKey}: true`,
                    `+ ${binding.optionKey}.${binding.flagKey}: ${providedValue!.includes(assistant) ? 'true' : 'false'}`,
                  ];
                }),
              ],
              'entity-registry-assistant-exposure-review.diff',
            ),
          ],
    commands: command ? [command] : [],
    findingId: finding.id,
    id: `fix:${finding.id}:review-assistant-exposure`,
    intent:
      'Review and narrow assistant exposure for the entity by sending an explicit entity registry update payload.',
    kind: 'review_assistant_exposure',
    rationale:
      'Reducing redundant assistant exposure lowers ambiguity without renaming or disabling the entity.',
    requiredInputs: [requiredInput],
    requiresConfirmation: true,
    risk: 'low',
    steps: [
      'Review the currently exposed assistant surfaces.',
      'Choose which existing assistant surfaces should remain enabled.',
      'Review the resulting websocket payload before dry-run apply.',
    ],
    targets: [
      {
        id: entityId,
        kind: 'entity' as const,
        label: getEntityLabel(inventory, entityId),
      },
    ],
    title: `Review assistant exposure for ${entityId}`,
    warnings: [
      'Removing the wrong assistant exposure can break existing household voice routines or assistant-specific expectations.',
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
      case 'assistant_context_bloat': {
        return [
          createAssistantExposureAction(inventory, finding, indexedInputs),
        ];
      }

      case 'duplicate_name': {
        return [createDuplicateNameAction(inventory, finding, indexedInputs)];
      }

      case 'stale_entity': {
        return [createStaleEntityAction(inventory, finding)];
      }

      case 'automation_invalid_target':
      case 'ambiguous_helper_name':
      case 'dangling_label_reference':
      case 'entity_ownership_hotspot':
      case 'highly_coupled_automation':
      case 'missing_area_assignment':
      case 'missing_floor_assignment':
      case 'orphaned_entity_device':
      case 'scene_invalid_target': {
        return [];
      }

      case 'shared_label_observation': {
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
    targets: createFindingTargets(inventory, finding),
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

      case 'ambiguous_helper_name': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Helper renaming is advisory because the correct label depends on operator vocabulary, room naming, and automation intent.',
            'Rename the helper to include useful room or behavior context, then rerun the scan.',
            [
              'Review what the helper actually represents or gates.',
              'Rename it with room, role, or intent context.',
              'Rerun the scan to verify the ambiguity warning clears.',
            ],
            [
              'Renaming the wrong helper can create churn in dashboards, automations, or documentation that already references the old label.',
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

      case 'entity_ownership_hotspot': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Writer consolidation is advisory because overlapping automations and scenes usually reflect operator intent that must be reviewed, not auto-merged.',
            'Review whether fewer writers should target the entity, then rerun the scan.',
            [
              'Inspect the automations and scenes targeting the entity.',
              'Decide whether the overlap is intentional or should be simplified.',
              'Rerun the scan to confirm the hotspot shrinks after manual changes.',
            ],
            [
              'Removing or restructuring the wrong writer can change live entity behavior in ways that are hard to notice immediately.',
            ],
          ),
        ];
      }

      case 'highly_coupled_automation': {
        return [
          createGenericAdvisory(
            inventory,
            finding,
            'Automation splitting is advisory because only the operator can confirm which actions belong together and which should become separate intent-specific flows.',
            'Review whether the automation should be split or refactored into narrower pieces.',
            [
              'Inspect the automation responsibilities and target list.',
              'Split unrelated responsibilities into smaller automations or scripts where helpful.',
              'Rerun the scan to verify the coupling warning is reduced.',
            ],
            [
              'Breaking apart the wrong automation can change sequencing, timing, or shared conditions that current behavior depends on.',
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

      case 'shared_label_observation': {
        return [createSharedLabelObservationAdvisory(inventory, finding)];
      }

      case 'duplicate_name':
      case 'assistant_context_bloat':
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

function calculateAuditScores(findings: Finding[]): ScanAuditSummary['scores'] {
  const severityWeight = {
    high: 18,
    low: 4,
    medium: 10,
  } as const;
  let correctness = 100;
  let maintainability = 100;
  let clarity = 100;
  let redundancy = 100;
  let cleanupOpportunity = 0;

  for (const finding of findings) {
    const penalty = severityWeight[finding.severity];

    switch (finding.category ?? 'inventory_hygiene') {
      case 'broken_references': {
        correctness -= penalty * 1.4;
        maintainability -= penalty * 0.8;
        break;
      }

      case 'conflict_overlap': {
        correctness -= penalty;
        maintainability -= penalty;
        redundancy -= penalty * 0.6;
        break;
      }

      case 'dead_legacy_objects': {
        maintainability -= penalty * 0.9;
        cleanupOpportunity += penalty * 1.3;
        break;
      }

      case 'fragile_automation_patterns': {
        correctness -= penalty * 0.6;
        maintainability -= penalty;
        redundancy -= penalty * 0.5;
        break;
      }

      case 'naming_intent_drift': {
        clarity -= penalty * 1.2;
        maintainability -= penalty * 0.5;
        break;
      }

      case 'inventory_hygiene': {
        clarity -= penalty * 0.4;
        maintainability -= penalty * 0.7;
        cleanupOpportunity += penalty * 0.8;
        break;
      }
    }
  }

  return {
    clarity: normalizeScore(clarity),
    cleanupOpportunity: normalizeScore(cleanupOpportunity),
    correctness: normalizeScore(correctness),
    maintainability: normalizeScore(maintainability),
    redundancy: normalizeScore(redundancy),
  };
}

function buildAuditSummary(
  inventory: InventoryGraph,
  findings: Finding[],
  hotspots: OwnershipHotspot[],
): ScanAuditSummary {
  return {
    cleanupCandidateIds: uniqueValues(
      findings
        .filter((finding) => finding.category === 'dead_legacy_objects')
        .map((finding) => finding.id),
    ),
    objectCounts: {
      areas: inventory.areas.length,
      automations: inventory.automations.length,
      devices: inventory.devices.length,
      entities: inventory.entities.length,
      floors: inventory.floors.length,
      helpers: inventory.entities.filter((entity) =>
        helperEntityDomains.has(getEntityDomain(entity.entityId)),
      ).length,
      labels: inventory.labels.length,
      scenes: inventory.scenes.length,
    },
    ownershipHotspotFindingIds: uniqueValues(
      hotspots.map((hotspot) => hotspot.findingId),
    ),
    ownershipHotspots: hotspots.map(
      ({findingId: _findingId, ...hotspot}) => hotspot,
    ),
    scores: calculateAuditScores(findings),
  };
}

function buildFindings(
  inventory: InventoryGraph,
  hotspots: OwnershipHotspot[],
): Finding[] {
  return attachRelatedFindings([
    ...findNameLabelFindings(inventory),
    ...findAmbiguousHelperNames(inventory),
    ...findOrphanedDeviceLinks(inventory),
    ...findStaleEntities(inventory),
    ...findMissingAreaAssignments(inventory),
    ...findMissingFloorAssignments(inventory),
    ...findDanglingLabelReferences(inventory),
    ...findAutomationInvalidTargets(inventory),
    ...findSceneInvalidTargets(inventory),
    ...findAssistantContextBloat(inventory),
    ...findEntityOwnershipHotspots(inventory, hotspots),
    ...findHighlyCoupledAutomations(inventory),
  ]);
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
  const hotspots = buildOwnershipHotspots(inventory);
  const findings = buildFindings(inventory, hotspots);
  const audit = buildAuditSummary(inventory, findings, hotspots);
  const mode = options.mode ?? inventory.source;
  const profileName = options.profileName ?? null;
  const fingerprint = createScanFingerprint({
    findings,
    inventory,
    mode,
    profileName,
  });

  return {
    audit,
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
