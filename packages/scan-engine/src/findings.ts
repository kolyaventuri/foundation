import type {
  Finding,
  InventoryGraph,
  ScanAuditSummary,
} from '@ha-repair/contracts';
import type {ScanGraphArtifacts} from './clustering';
import {
  ambiguousHelperNameTokens,
  classifyEntities,
  createAffectedObject,
  createEntityFinding,
  createFinding,
  createSourceObjectAffectedObject,
  getAreaLabel,
  getAuditHelpers,
  getAutomationLabel,
  getDeviceLabel,
  getEntity,
  getEntityDomain,
  getEntityLabel,
  getHelperLabel,
  getResolvedAreaId,
  getSceneLabel,
  getScriptLabel,
  getTemplateLabel,
  getWriterKindForId,
  indexDevices,
  normalizeConfidence,
  normalizeScore,
  tokenizeLabel,
  uniqueValues,
  type InboundReferenceIndex,
  type OwnershipHotspot,
  type WriterProfile,
} from './shared';

function addInboundReferences(
  index: Map<string, string[]>,
  targetIds: string[],
  sourceId: string,
): void {
  for (const targetId of uniqueValues(targetIds)) {
    const matches = index.get(targetId) ?? [];
    matches.push(sourceId);
    index.set(targetId, uniqueValues(matches));
  }
}

function buildInboundReferenceIndex(
  inventory: InventoryGraph,
): InboundReferenceIndex {
  const helperIds = new Map<string, string[]>();
  const sceneIds = new Map<string, string[]>();
  const scriptIds = new Map<string, string[]>();

  for (const automation of inventory.automations) {
    addInboundReferences(
      helperIds,
      automation.references?.helperIds ?? [],
      automation.automationId,
    );
    addInboundReferences(
      sceneIds,
      automation.references?.sceneIds ?? [],
      automation.automationId,
    );
    addInboundReferences(
      scriptIds,
      automation.references?.scriptIds ?? [],
      automation.automationId,
    );
  }

  for (const script of inventory.scripts ?? []) {
    addInboundReferences(
      helperIds,
      script.references?.helperIds ?? [],
      script.scriptId,
    );
    addInboundReferences(
      sceneIds,
      script.references?.sceneIds ?? [],
      script.scriptId,
    );
    addInboundReferences(
      scriptIds,
      script.references?.scriptIds ?? [],
      script.scriptId,
    );
  }

  for (const scene of inventory.scenes) {
    addInboundReferences(
      helperIds,
      scene.references?.helperIds ?? [],
      scene.sceneId,
    );
    addInboundReferences(
      sceneIds,
      scene.references?.sceneIds ?? [],
      scene.sceneId,
    );
    addInboundReferences(
      scriptIds,
      scene.references?.scriptIds ?? [],
      scene.sceneId,
    );
  }

  for (const template of inventory.templates ?? []) {
    const sourceId = template.sourceObjectId ?? template.templateId;
    addInboundReferences(helperIds, template.helperIds, sourceId);
    addInboundReferences(sceneIds, template.sceneIds, sourceId);
    addInboundReferences(scriptIds, template.scriptIds, sourceId);
  }

  return {
    helperIds,
    sceneIds,
    scriptIds,
  };
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
  const entitiesByLabel = new Map<string, typeof classified>();

  for (const entry of classified) {
    const matches = entitiesByLabel.get(entry.normalizedLabel) ?? [];
    matches.push(entry);
    entitiesByLabel.set(entry.normalizedLabel, matches);
  }

  for (const entries of entitiesByLabel.values()) {
    if (entries.length < 2) {
      continue;
    }

    const userFacingByArea = new Map<string, typeof entries>();

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

function createInvalidTargetFinding(input: {
  checkId: string;
  kind:
    | 'automation_invalid_target'
    | 'scene_invalid_target'
    | 'script_invalid_target';
  label: string;
  objectId: string;
  objectKind: 'automation' | 'scene' | 'script';
  severity: 'medium' | 'high';
  sourcePath?: string | undefined;
  tag: string;
  title: string;
}): (missingTargetIds: string[]) => Finding {
  return (missingTargetIds) =>
    createFinding({
      affectedObjects: [
        createAffectedObject(
          input.objectKind,
          input.objectId,
          `${input.label} (${input.objectId})`,
        ),
        ...missingTargetIds.map((targetId) =>
          createAffectedObject('entity', targetId, targetId),
        ),
      ],
      category: 'broken_references',
      checkId: input.checkId,
      confidence: normalizeConfidence(0.99),
      evidence: `${input.objectKind === 'script' ? 'Script' : input.objectKind === 'scene' ? 'Scene' : 'Automation'} ${input.label} references ${missingTargetIds.length} missing entity target(s).`,
      evidenceDetails: {
        missingTargetCount: missingTargetIds.length,
        missingTargetIds,
        ...(input.sourcePath ? {sourcePath: input.sourcePath} : {}),
        [`${input.objectKind}Id`]: input.objectId,
      },
      id: `${input.kind}:${input.objectId}`,
      kind: input.kind,
      objectIds: [input.objectId, ...missingTargetIds],
      recommendation: {
        action:
          input.objectKind === 'scene'
            ? 'Replace or remove the stale entity references in the scene membership.'
            : 'Replace or remove the stale entity references in the target set.',
        steps: [
          `Open the ${input.objectKind} definition or YAML source.`,
          'Repair or remove the missing entity references.',
          'Rerun the scan to confirm the broken reference clears.',
        ],
      },
      scores: {
        fragility:
          input.objectKind === 'scene'
            ? 74
            : input.objectKind === 'script'
              ? 82
              : 90,
      },
      severity: input.severity,
      summary: `${input.label} references ${missingTargetIds.length} entity target(s) that are missing from the current inventory.`,
      tags: [input.tag],
      title: `${input.title}: ${input.label}`,
    });
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
      createInvalidTargetFinding({
        checkId: 'AUTOMATION_MISSING_REFERENCE',
        kind: 'automation_invalid_target',
        label: automation.name,
        objectId: automation.automationId,
        objectKind: 'automation',
        severity: 'high',
        sourcePath: automation.sourcePath,
        tag: 'automation-missing-reference',
        title: 'Automation has invalid targets',
      })(missingTargetIds),
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
      createInvalidTargetFinding({
        checkId: 'SCENE_TARGET_MISSING_ENTITY',
        kind: 'scene_invalid_target',
        label: scene.name,
        objectId: scene.sceneId,
        objectKind: 'scene',
        severity: 'medium',
        sourcePath: scene.sourcePath,
        tag: 'scene-missing-target',
        title: 'Scene has invalid targets',
      })(missingTargetIds),
    ];
  });
}

function findScriptInvalidTargets(inventory: InventoryGraph): Finding[] {
  const entityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );

  return (inventory.scripts ?? []).flatMap((script) => {
    const missingTargetIds = script.targetEntityIds.filter(
      (entityId) => !entityIds.has(entityId),
    );

    if (missingTargetIds.length === 0) {
      return [];
    }

    return [
      createInvalidTargetFinding({
        checkId: 'SCRIPT_MISSING_REFERENCE',
        kind: 'script_invalid_target',
        label: script.name,
        objectId: script.scriptId,
        objectKind: 'script',
        severity: 'high',
        sourcePath: script.sourcePath,
        tag: 'script-missing-reference',
        title: 'Script has invalid targets',
      })(missingTargetIds),
    ];
  });
}

function findAutomationDisabledDependencies(
  inventory: InventoryGraph,
): Finding[] {
  const entitiesById = new Map(
    inventory.entities.map((entity) => [entity.entityId, entity] as const),
  );

  return inventory.automations.flatMap((automation) => {
    const disabledEntityIds = uniqueValues(
      (automation.references?.entityIds ?? []).filter((entityId) => {
        const entity = entitiesById.get(entityId);
        return entity?.disabledBy !== null && entity?.disabledBy !== undefined;
      }),
    );

    if (disabledEntityIds.length === 0) {
      return [];
    }

    const targetedDisabledEntityIds = uniqueValues(
      disabledEntityIds.filter((entityId) =>
        automation.targetEntityIds.includes(entityId),
      ),
    );

    return [
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'automation',
            automation.automationId,
            `${automation.name} (${automation.automationId})`,
          ),
          ...disabledEntityIds.map((entityId) =>
            createAffectedObject(
              'entity',
              entityId,
              getEntityLabel(inventory, entityId),
            ),
          ),
        ],
        category: 'broken_references',
        checkId: 'AUTOMATION_DISABLED_DEPENDENCY',
        confidence: normalizeConfidence(
          0.86 + Math.min(0.12, disabledEntityIds.length * 0.03),
        ),
        evidence: `Automation ${automation.name} depends on ${disabledEntityIds.length} disabled entity reference(s): ${disabledEntityIds.join(', ')}.`,
        evidenceDetails: {
          automationId: automation.automationId,
          disabledEntityCount: disabledEntityIds.length,
          disabledEntityIds,
          ...(automation.sourcePath ? {sourcePath: automation.sourcePath} : {}),
          targetedDisabledEntityIds,
        },
        id: `automation_disabled_dependency:${automation.automationId}`,
        kind: 'automation_disabled_dependency',
        objectIds: [automation.automationId, ...disabledEntityIds],
        recommendation: {
          action:
            'Review whether the dependency should be re-enabled, replaced, or removed from the automation.',
          steps: [
            'Inspect the automation references and confirm the disabled entity is still intended.',
            'Either re-enable the dependency or replace/remove the stale reference.',
            'Rerun the scan to confirm the disabled dependency warning clears.',
          ],
        },
        scores: {
          fragility: normalizeScore(42 + disabledEntityIds.length * 14),
        },
        severity: targetedDisabledEntityIds.length > 0 ? 'high' : 'medium',
        summary: `${automation.name} still references ${disabledEntityIds.length} disabled entity dependency${disabledEntityIds.length === 1 ? '' : 'ies'}.`,
        tags: ['disabled-dependency'],
        title: `Automation depends on disabled entities: ${automation.name}`,
        whyItMatters:
          'Automations that still depend on disabled entities are prone to silent failures and stale behavior when those references never become valid again.',
      }),
    ];
  });
}

function findTemplateMissingReferences(inventory: InventoryGraph): Finding[] {
  const knownEntityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );
  const knownHelperIds = new Set(
    getAuditHelpers(inventory).map((helper) => helper.helperId),
  );
  const knownSceneIds = new Set(inventory.scenes.map((scene) => scene.sceneId));
  const knownScriptIds = new Set(
    (inventory.scripts ?? []).map((script) => script.scriptId),
  );

  return (inventory.templates ?? []).flatMap((template) => {
    const missingEntityIds = uniqueValues(
      template.entityIds.filter((entityId) => !knownEntityIds.has(entityId)),
    );
    const missingHelperIds = uniqueValues(
      template.helperIds.filter((helperId) => !knownHelperIds.has(helperId)),
    );
    const missingSceneIds = uniqueValues(
      template.sceneIds.filter((sceneId) => !knownSceneIds.has(sceneId)),
    );
    const missingScriptIds = uniqueValues(
      template.scriptIds.filter((scriptId) => !knownScriptIds.has(scriptId)),
    );
    const missingReferenceIds = uniqueValues([
      ...missingEntityIds,
      ...missingHelperIds,
      ...missingSceneIds,
      ...missingScriptIds,
    ]);

    if (missingReferenceIds.length === 0) {
      return [];
    }

    return [
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'template',
            template.templateId,
            getTemplateLabel(template.templateId, template.sourceObjectId),
          ),
          ...(template.sourceObjectId
            ? [
                createSourceObjectAffectedObject(
                  inventory,
                  template.sourceObjectId,
                ),
              ]
            : []),
          ...missingEntityIds.map((entityId) =>
            createAffectedObject('entity', entityId, entityId),
          ),
          ...missingHelperIds.map((helperId) =>
            createAffectedObject(
              'helper',
              helperId,
              getHelperLabel(inventory, helperId),
            ),
          ),
          ...missingSceneIds.map((sceneId) =>
            createAffectedObject('scene', sceneId, sceneId),
          ),
          ...missingScriptIds.map((scriptId) =>
            createAffectedObject('script', scriptId, scriptId),
          ),
        ],
        category: 'broken_references',
        checkId: 'TEMPLATE_MISSING_REFERENCE',
        confidence: normalizeConfidence(
          0.8 +
            Math.min(
              0.16,
              (missingReferenceIds.length +
                missingSceneIds.length +
                missingScriptIds.length) *
                0.03,
            ),
        ),
        evidence: `${getTemplateLabel(template.templateId, template.sourceObjectId)} references ${missingReferenceIds.length} missing object(s): ${missingReferenceIds.join(', ')}.`,
        evidenceDetails: {
          missingEntityIds,
          missingHelperIds,
          missingReferenceCount: missingReferenceIds.length,
          missingSceneIds,
          missingScriptIds,
          ...(template.sourceObjectId
            ? {sourceObjectId: template.sourceObjectId}
            : {}),
          sourceType: template.sourceType,
          templateId: template.templateId,
        },
        id: `template_missing_reference:${template.templateId}`,
        kind: 'template_missing_reference',
        objectIds: [
          template.templateId,
          ...(template.sourceObjectId ? [template.sourceObjectId] : []),
          ...missingReferenceIds,
        ],
        recommendation: {
          action:
            'Open the template source and repair or remove the missing references before relying on its output.',
          steps: [
            'Inspect the template source object or YAML file.',
            'Replace or remove the missing entity, helper, scene, or script references.',
            'Rerun the scan to confirm the broken template reference clears.',
          ],
        },
        scores: {
          fragility: normalizeScore(46 + missingReferenceIds.length * 12),
        },
        severity:
          missingSceneIds.length > 0 ||
          missingScriptIds.length > 0 ||
          missingReferenceIds.length >= 2
            ? 'high'
            : 'medium',
        summary: `${template.templateId} references ${missingReferenceIds.length} missing object(s).`,
        tags: ['template-missing-reference'],
        title: `Template has missing references: ${template.templateId}`,
        whyItMatters:
          'Templates with missing dependencies can silently degrade runtime logic and produce brittle conditions that are hard to spot in day-to-day use.',
      }),
    ];
  });
}

const directTemplateStatePattern =
  /\bstates\.([a-z0-9_]+\.[a-z0-9_]+)\.(state|attributes(?:\.[a-z0-9_]+)*)\b/giu;

function hasTemplateUnknownGuard(templateText: string): boolean {
  const normalized = templateText.toLowerCase();

  return (
    normalized.includes('is_state(') ||
    normalized.includes('state_attr(') ||
    normalized.includes('has_value(') ||
    normalized.includes('| default') ||
    normalized.includes('default(') ||
    normalized.includes('unknown') ||
    normalized.includes('unavailable')
  );
}

function findTemplateNoUnknownHandling(inventory: InventoryGraph): Finding[] {
  return (inventory.templates ?? []).flatMap((template) => {
    if (hasTemplateUnknownGuard(template.templateText)) {
      return [];
    }

    const directAccessMatches = [
      ...template.templateText.matchAll(directTemplateStatePattern),
    ];

    if (directAccessMatches.length === 0) {
      return [];
    }

    const directEntityIds = uniqueValues(
      directAccessMatches.map((match) => match[1] ?? '').filter(Boolean),
    );
    const directAccessPaths = uniqueValues(
      directAccessMatches
        .map((match) =>
          match[1] && match[2] ? `states.${match[1]}.${match[2]}` : '',
        )
        .filter(Boolean),
    );

    return [
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'template',
            template.templateId,
            getTemplateLabel(template.templateId, template.sourceObjectId),
          ),
          ...(template.sourceObjectId
            ? [
                createSourceObjectAffectedObject(
                  inventory,
                  template.sourceObjectId,
                ),
              ]
            : []),
          ...directEntityIds.map((entityId) =>
            createAffectedObject(
              'entity',
              entityId,
              getEntityLabel(inventory, entityId),
            ),
          ),
        ],
        category: 'fragile_automation_patterns',
        checkId: 'TEMPLATE_NO_UNKNOWN_HANDLING',
        confidence: normalizeConfidence(
          0.79 + Math.min(0.12, directAccessPaths.length * 0.03),
        ),
        evidence: `${getTemplateLabel(template.templateId, template.sourceObjectId)} uses direct state access without visible unknown/unavailable handling: ${directAccessPaths.join(', ')}.`,
        evidenceDetails: {
          directAccessCount: directAccessPaths.length,
          directAccessPaths,
          directEntityIds,
          ...(template.sourceObjectId
            ? {sourceObjectId: template.sourceObjectId}
            : {}),
          sourceType: template.sourceType,
          templateId: template.templateId,
        },
        id: `template_no_unknown_handling:${template.templateId}`,
        kind: 'template_no_unknown_handling',
        objectIds: [
          template.templateId,
          ...(template.sourceObjectId ? [template.sourceObjectId] : []),
          ...directEntityIds,
        ],
        recommendation: {
          action:
            'Wrap direct state access in Home Assistant-safe guards such as states(), state_attr(), has_value(), or default handling.',
          steps: [
            'Open the template source and inspect each direct state or attribute access.',
            'Replace brittle direct access with guarded helper calls or fallback defaults.',
            'Rerun the scan to confirm the fragile template pattern clears.',
          ],
        },
        scores: {
          fragility: normalizeScore(42 + directAccessPaths.length * 12),
        },
        severity: 'medium',
        summary: `${template.templateId} reads entity state directly without visible unknown/unavailable handling.`,
        tags: ['template-unknown-handling'],
        title: `Template lacks unknown handling: ${template.templateId}`,
        whyItMatters:
          'Direct template access can fail or produce brittle runtime behavior when entities are unavailable, unknown, or still starting up.',
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
  return getAuditHelpers(inventory)
    .filter((helper) => {
      const tokens = tokenizeLabel(helper.name);

      return (
        tokens.length > 0 &&
        tokens.length <= 2 &&
        tokens.every((token) => ambiguousHelperNameTokens.has(token))
      );
    })
    .map((helper) => {
      const entity = getEntity(inventory, helper.helperId);
      const areaId = getResolvedAreaId(inventory, entity);
      const tokens = tokenizeLabel(helper.name);

      return createFinding({
        affectedObjects: [
          createAffectedObject(
            'helper',
            helper.helperId,
            getHelperLabel(inventory, helper.helperId),
          ),
        ],
        category: 'naming_intent_drift',
        checkId: 'AMBIGUOUS_HELPER_NAME',
        confidence: normalizeConfidence(0.91),
        evidence: `Helper ${helper.helperId} still uses ambiguous label "${helper.name}", which does not explain what the helper controls.`,
        evidenceDetails: {
          areaId: areaId ?? 'unassigned',
          helperDomain: helper.helperType,
          helperNameTokens: tokens,
        },
        id: `ambiguous_helper_name:${helper.helperId}`,
        kind: 'ambiguous_helper_name',
        objectIds: [helper.helperId],
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
        summary: `${helper.helperId} still uses weak helper label "${helper.name}".`,
        tags: [
          'ambiguous-helper',
          helper.helperType,
          ...(areaId ? [areaId] : []),
        ],
        title: `Ambiguous helper name on ${helper.helperId}`,
      });
    });
}

function findUnusedHelpers(
  inventory: InventoryGraph,
  references: InboundReferenceIndex,
): Finding[] {
  return (inventory.helpers ?? [])
    .filter(
      (helper) =>
        (references.helperIds.get(helper.helperId)?.length ?? 0) === 0,
    )
    .map((helper) =>
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'helper',
            helper.helperId,
            getHelperLabel(inventory, helper.helperId),
          ),
        ],
        category: 'dead_legacy_objects',
        checkId: 'UNUSED_HELPER',
        confidence: normalizeConfidence(0.76),
        evidence: `Helper ${helper.helperId} was found in config analysis, but no scan-visible automations, scripts, or templates referenced it.`,
        evidenceDetails: {
          helperId: helper.helperId,
          helperType: helper.helperType,
          inboundReferenceCount: 0,
          ...(helper.sourcePath ? {sourcePath: helper.sourcePath} : {}),
        },
        id: `unused_helper:${helper.helperId}`,
        kind: 'unused_helper',
        objectIds: [helper.helperId],
        recommendation: {
          action:
            'Review whether the helper is still used manually or indirectly before removing it.',
          steps: [
            'Confirm whether dashboards, manual controls, or hidden integrations still use the helper.',
            'Remove or archive the helper only if it is truly dead.',
            'Rerun the scan to confirm the cleanup candidate clears.',
          ],
        },
        scores: {
          noise: 74,
          redundancy: 52,
        },
        severity: 'low',
        summary: `${helper.helperId} has no inbound references from scan-visible logic.`,
        tags: ['cleanup-candidate', 'safe-review-candidate', 'unused-helper'],
        title: `Unused helper candidate: ${helper.helperId}`,
        whyItMatters:
          'Unused helpers create clutter and make it harder to tell which control surfaces still matter.',
      }),
    );
}

function findUnusedScenes(
  inventory: InventoryGraph,
  references: InboundReferenceIndex,
): Finding[] {
  return inventory.scenes
    .filter(
      (scene) => (references.sceneIds.get(scene.sceneId)?.length ?? 0) === 0,
    )
    .map((scene) =>
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'scene',
            scene.sceneId,
            `${scene.name} (${scene.sceneId})`,
          ),
        ],
        category: 'dead_legacy_objects',
        checkId: 'UNUSED_SCENE',
        confidence: normalizeConfidence(0.74),
        evidence: `Scene ${scene.name} was found in config analysis, but no scan-visible automations, scripts, or templates referenced it.`,
        evidenceDetails: {
          inboundReferenceCount: 0,
          ...(scene.sourcePath ? {sourcePath: scene.sourcePath} : {}),
          sceneId: scene.sceneId,
        },
        id: `unused_scene:${scene.sceneId}`,
        kind: 'unused_scene',
        objectIds: [scene.sceneId],
        recommendation: {
          action:
            'Review whether the scene is still used manually or from dashboards before removing it.',
          steps: [
            'Confirm whether the scene is still activated outside scan-visible automations and scripts.',
            'Remove or archive it only if it is no longer needed.',
            'Rerun the scan to confirm the cleanup candidate clears.',
          ],
        },
        scores: {
          noise: 66,
          redundancy: 48,
        },
        severity: 'low',
        summary: `${scene.sceneId} has no inbound references from scan-visible logic.`,
        tags: ['cleanup-candidate', 'safe-review-candidate', 'unused-scene'],
        title: `Unused scene candidate: ${scene.name}`,
      }),
    );
}

function findUnusedScripts(
  inventory: InventoryGraph,
  references: InboundReferenceIndex,
): Finding[] {
  return (inventory.scripts ?? [])
    .filter(
      (script) =>
        (references.scriptIds.get(script.scriptId)?.length ?? 0) === 0,
    )
    .map((script) =>
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'script',
            script.scriptId,
            `${script.name} (${script.scriptId})`,
          ),
        ],
        category: 'dead_legacy_objects',
        checkId: 'UNUSED_SCRIPT',
        confidence: normalizeConfidence(0.74),
        evidence: `Script ${script.name} was found in config analysis, but no scan-visible automations, scripts, or templates referenced it.`,
        evidenceDetails: {
          inboundReferenceCount: 0,
          ...(script.sourcePath ? {sourcePath: script.sourcePath} : {}),
          scriptId: script.scriptId,
        },
        id: `unused_script:${script.scriptId}`,
        kind: 'unused_script',
        objectIds: [script.scriptId],
        recommendation: {
          action:
            'Review whether the script is still used manually, from dashboards, or by hidden integrations before removing it.',
          steps: [
            'Confirm whether the script still has non-scan-visible callers.',
            'Remove or archive it only if it is truly dead.',
            'Rerun the scan to confirm the cleanup candidate clears.',
          ],
        },
        scores: {
          noise: 68,
          redundancy: 56,
        },
        severity: 'low',
        summary: `${script.scriptId} has no inbound references from scan-visible logic.`,
        tags: ['cleanup-candidate', 'safe-review-candidate', 'unused-script'],
        title: `Unused script candidate: ${script.name}`,
      }),
    );
}

function findOrphanConfigModules(inventory: InventoryGraph): Finding[] {
  const configIssuePaths = new Set(
    (inventory.configAnalysis?.issues ?? []).map((issue) => issue.filePath),
  );

  return (inventory.configModules ?? [])
    .filter((module) => module.filePath !== 'configuration.yaml')
    .filter((module) => module.lineCount >= 5)
    .filter(
      (module) =>
        module.automationCount === 0 &&
        module.sceneCount === 0 &&
        module.scriptCount === 0 &&
        module.helperCount === 0 &&
        module.templateCount === 0,
    )
    .filter((module) => !configIssuePaths.has(module.filePath))
    .map((module) =>
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'config_module',
            module.filePath,
            module.filePath,
          ),
        ],
        category: 'dead_legacy_objects',
        checkId: 'ORPHAN_CONFIG_MODULE',
        confidence: normalizeConfidence(0.74),
        evidence: `Config module ${module.filePath} contributes no extracted automations, scenes, scripts, helpers, or templates in the current config analysis.`,
        evidenceDetails: {
          filePath: module.filePath,
          helperCount: module.helperCount,
          lineCount: module.lineCount,
          objectTypesPresent: module.objectTypesPresent,
          templateCount: module.templateCount,
        },
        id: `orphan_config_module:${module.filePath}`,
        kind: 'orphan_config_module',
        objectIds: [module.filePath],
        recommendation: {
          action:
            'Review whether the config module is obsolete, commented-out legacy content, or a file that should be removed.',
          steps: [
            'Open the config file and confirm it no longer contributes live Home Assistant objects.',
            'Remove, archive, or consolidate the file only if it is truly obsolete.',
            'Rerun the scan to confirm the orphan config module finding clears.',
          ],
        },
        scores: {
          noise: 42,
          redundancy: 38,
        },
        severity: 'low',
        summary: `${module.filePath} appears to be a non-root config module with no extracted objects.`,
        tags: [
          'cleanup-candidate',
          'orphan-config-module',
          'safe-review-candidate',
        ],
        title: `Orphan config module candidate: ${module.filePath}`,
        whyItMatters:
          'Dead config fragments increase review cost and make it harder to tell which files still shape live behavior.',
      }),
    );
}

function findMonolithicConfigFiles(inventory: InventoryGraph): Finding[] {
  return (inventory.configModules ?? []).flatMap((module) => {
    const extractedObjectCount =
      module.automationCount +
      module.sceneCount +
      module.scriptCount +
      module.helperCount +
      module.templateCount;
    const isFlagged = module.lineCount >= 250 || extractedObjectCount >= 12;

    if (!isFlagged) {
      return [];
    }

    return [
      createFinding({
        affectedObjects: [
          createAffectedObject(
            'config_module',
            module.filePath,
            module.filePath,
          ),
        ],
        category: 'configuration_smells',
        checkId: 'MONOLITHIC_CONFIG_FILE',
        confidence: normalizeConfidence(
          0.72 +
            (module.lineCount >= 500 || extractedObjectCount >= 20
              ? 0.12
              : 0.04),
        ),
        evidence: `Config module ${module.filePath} spans ${module.lineCount} lines and contributes ${extractedObjectCount} extracted object(s)/template(s), which makes it unusually large for deterministic review.`,
        evidenceDetails: {
          extractedObjectCount,
          filePath: module.filePath,
          lineCount: module.lineCount,
          objectTypesPresent: module.objectTypesPresent,
        },
        id: `monolithic_config_file:${module.filePath}`,
        kind: 'monolithic_config_file',
        objectIds: [module.filePath],
        recommendation: {
          action:
            'Review whether the config module should be split by intent, room, or object type so repair work stays easier to inspect.',
          steps: [
            'Inspect the large file and identify unrelated concerns living together.',
            'Split or reorganize the file only where the boundaries are clear and operator-friendly.',
            'Rerun the scan to confirm the configuration smell is reduced.',
          ],
        },
        scores: {
          clarity: normalizeScore(24 + Math.round(extractedObjectCount * 1.8)),
          redundancy: normalizeScore(
            18 + Math.round(extractedObjectCount * 1.4),
          ),
        },
        severity:
          module.lineCount >= 500 || extractedObjectCount >= 20
            ? 'medium'
            : 'low',
        summary: `${module.filePath} is large enough to be a structural review risk (${module.lineCount} lines, ${extractedObjectCount} extracted objects/templates).`,
        tags: ['configuration-smell', 'monolithic-config-file'],
        title: `Monolithic config module: ${module.filePath}`,
        whyItMatters:
          'Oversized config files are harder to review safely, which increases the chance that repairs and refactors carry hidden side effects.',
      }),
    ];
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
        : writerKind === 'script'
          ? getScriptLabel(inventory, writerId)
          : getAutomationLabel(inventory, writerId);
    });

    return createFinding({
      affectedObjects: [
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
            : writerKind === 'script'
              ? createAffectedObject(
                  'script',
                  writerId,
                  `${getScriptLabel(inventory, writerId)} (${writerId})`,
                )
              : createAffectedObject(
                  'automation',
                  writerId,
                  `${getAutomationLabel(inventory, writerId)} (${writerId})`,
                );
        }),
      ],
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

function findHighlyCoupledAutomations(
  inventory: InventoryGraph,
  writerProfiles: WriterProfile[],
): Finding[] {
  return writerProfiles
    .filter((writer) => writer.kind === 'automation')
    .flatMap((writer) => {
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

export function calculateAuditScores(
  findings: Finding[],
): ScanAuditSummary['scores'] {
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

      case 'configuration_smells': {
        maintainability -= penalty;
        clarity -= penalty * 0.6;
        redundancy -= penalty * 0.3;
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

      case 'inventory_hygiene': {
        clarity -= penalty * 0.4;
        maintainability -= penalty * 0.7;
        cleanupOpportunity += penalty * 0.8;
        break;
      }

      case 'naming_intent_drift': {
        clarity -= penalty * 1.2;
        maintainability -= penalty * 0.5;
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

export function buildAuditSummary(
  inventory: InventoryGraph,
  findings: Finding[],
  graphArtifacts: Pick<
    ScanGraphArtifacts,
    'clusters' | 'conflictCandidates' | 'conflictHotspots' | 'hotspots'
  >,
): ScanAuditSummary {
  const auditHelpers = getAuditHelpers(inventory);

  return {
    cleanupCandidateIds: uniqueValues(
      findings
        .filter((finding) => finding.category === 'dead_legacy_objects')
        .map((finding) => finding.id),
    ),
    conflictCandidateIds: uniqueValues(
      graphArtifacts.conflictCandidates.map(
        (candidate) => candidate.finding.id,
      ),
    ),
    conflictHotspots: graphArtifacts.conflictHotspots,
    objectCounts: {
      areas: inventory.areas.length,
      automations: inventory.automations.length,
      configModules: inventory.configModules?.length ?? 0,
      devices: inventory.devices.length,
      entities: inventory.entities.length,
      floors: inventory.floors.length,
      helpers: auditHelpers.length,
      labels: inventory.labels.length,
      scenes: inventory.scenes.length,
      scripts: inventory.scripts?.length ?? 0,
      templates: inventory.templates?.length ?? 0,
    },
    intentClusters: graphArtifacts.clusters,
    ownershipHotspotFindingIds: uniqueValues(
      graphArtifacts.hotspots.map((hotspot) => hotspot.findingId),
    ),
    ownershipHotspots: graphArtifacts.hotspots.map(
      ({findingId: _findingId, ...hotspot}) => hotspot,
    ),
    scores: calculateAuditScores(findings),
  };
}

export function buildFindings(
  inventory: InventoryGraph,
  graphArtifacts: Pick<
    ScanGraphArtifacts,
    'conflictCandidates' | 'hotspots' | 'writerProfiles'
  >,
): Finding[] {
  const inboundReferences = buildInboundReferenceIndex(inventory);

  return attachRelatedFindings([
    ...findNameLabelFindings(inventory),
    ...findAmbiguousHelperNames(inventory),
    ...findOrphanedDeviceLinks(inventory),
    ...findStaleEntities(inventory),
    ...findUnusedHelpers(inventory, inboundReferences),
    ...findUnusedScenes(inventory, inboundReferences),
    ...findUnusedScripts(inventory, inboundReferences),
    ...findOrphanConfigModules(inventory),
    ...findMissingAreaAssignments(inventory),
    ...findMissingFloorAssignments(inventory),
    ...findDanglingLabelReferences(inventory),
    ...findAutomationInvalidTargets(inventory),
    ...findSceneInvalidTargets(inventory),
    ...findScriptInvalidTargets(inventory),
    ...findAutomationDisabledDependencies(inventory),
    ...findTemplateMissingReferences(inventory),
    ...findTemplateNoUnknownHandling(inventory),
    ...findAssistantContextBloat(inventory),
    ...findEntityOwnershipHotspots(inventory, graphArtifacts.hotspots),
    ...findHighlyCoupledAutomations(inventory, graphArtifacts.writerProfiles),
    ...findMonolithicConfigFiles(inventory),
    ...graphArtifacts.conflictCandidates.map((candidate) => candidate.finding),
  ]);
}
