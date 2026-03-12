import type {
  Finding,
  FindingAffectedObject,
  FindingCategory,
  FindingEvidenceDetails,
  FindingScores,
  InventoryEntity,
  InventoryGraph,
  ScanOwnershipHotspot,
} from '@ha-repair/contracts';

export type ClassifiedEntity = {
  displayLabel: string;
  domain: string;
  entity: InventoryEntity;
  isUserFacing: boolean;
  normalizedLabel: string;
  resolvedAreaId: string | null;
};

export type WriterTarget = {
  areaIds: string[];
  id: string;
  kind: 'automation' | 'scene' | 'script';
  label: string;
  targetEntityIds: string[];
};

export type WriterProfile = WriterTarget & {
  actionTags: string[];
  helperIds: string[];
  nameTokens: string[];
  serviceIds: string[];
};

export type WriterRelation = {
  score: number;
  sharedAreaIds: string[];
  sharedHelperIds: string[];
  sharedNameTokens: string[];
  sharedTargetEntityIds: string[];
};

export type OwnershipHotspot = ScanOwnershipHotspot & {
  findingId: string;
};

export type ConflictCandidate = {
  finding: Finding;
  sharedEntityIds: string[];
  writerIds: string[];
  writerKinds: Array<'automation' | 'scene' | 'script'>;
};

export type InboundReferenceIndex = {
  helperIds: Map<string, string[]>;
  sceneIds: Map<string, string[]>;
  scriptIds: Map<string, string[]>;
};

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

export const helperEntityDomains = new Set([
  'counter',
  'group',
  'input_boolean',
  'input_button',
  'input_datetime',
  'input_number',
  'input_select',
  'input_text',
  'timer',
]);

export const ambiguousHelperNameTokens = new Set([
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

export const opposingActionTags = new Map<string, string[]>([
  ['activate', ['deactivate']],
  ['deactivate', ['activate']],
  ['open', ['close']],
  ['close', ['open']],
  ['lock', ['unlock']],
  ['unlock', ['lock']],
]);

export function indexDevices(inventory: InventoryGraph) {
  return new Map(
    inventory.devices.map((device) => [device.deviceId, device] as const),
  );
}

export function normalizeLabelKey(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

export function normalizeLabelDisplay(value: string): string {
  return value.trim().replaceAll(/\s+/gu, ' ');
}

export function getEntityDomain(entityId: string): string {
  return entityId.split('.', 1)[0] ?? entityId;
}

export function tokenizeLabel(value: string): string[] {
  return normalizeLabelKey(value)
    .split(/[\s._-]+/u)
    .filter((token) => token.length > 0);
}

export function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function intersectValues(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return uniqueValues(left.filter((value) => rightSet.has(value)));
}

export function calculateJaccardScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const intersection = intersectValues(left, right).length;
  const union = new Set([...left, ...right]).size;

  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

export function normalizeRatio(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function normalizeScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function createFinding(input: Finding): Finding {
  return {
    ...input,
    ...(input.relatedFindingIds
      ? {relatedFindingIds: uniqueValues(input.relatedFindingIds)}
      : {}),
    ...(input.tags ? {tags: uniqueValues(input.tags)} : {}),
  };
}

export function createAffectedObject(
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

export function classifyEntities(
  inventory: InventoryGraph,
): ClassifiedEntity[] {
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

export function getAreaLabel(
  inventory: InventoryGraph,
  areaId: string,
): string {
  return inventory.areas.find((area) => area.areaId === areaId)?.name ?? areaId;
}

export function getDeviceLabel(
  inventory: InventoryGraph,
  deviceId: string,
): string {
  return (
    inventory.devices.find((device) => device.deviceId === deviceId)?.name ??
    deviceId
  );
}

export function getAutomationLabel(
  inventory: InventoryGraph,
  automationId: string,
): string {
  return (
    inventory.automations.find(
      (automation) => automation.automationId === automationId,
    )?.name ?? automationId
  );
}

export function getSceneLabel(
  inventory: InventoryGraph,
  sceneId: string,
): string {
  return (
    inventory.scenes.find((scene) => scene.sceneId === sceneId)?.name ?? sceneId
  );
}

export function getScriptLabel(
  inventory: InventoryGraph,
  scriptId: string,
): string {
  return (
    inventory.scripts?.find((script) => script.scriptId === scriptId)?.name ??
    scriptId
  );
}

export function getEntity(
  inventory: InventoryGraph,
  entityId: string,
): InventoryEntity | undefined {
  return inventory.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
}

export function getEntityLabel(
  inventory: InventoryGraph,
  entityId: string,
): string {
  const entity = getEntity(inventory, entityId);

  if (!entity) {
    return entityId;
  }

  return `${entity.displayName} (${entity.entityId})`;
}

export function getHelperLabel(
  inventory: InventoryGraph,
  helperId: string,
): string {
  const helper = inventory.helpers?.find(
    (candidate) => candidate.helperId === helperId,
  );

  if (helper) {
    return `${helper.name} (${helper.helperId})`;
  }

  return getEntityLabel(inventory, helperId);
}

export function getWriterKindForId(
  inventory: InventoryGraph,
  writerId: string,
): WriterTarget['kind'] {
  if (inventory.scripts?.some((script) => script.scriptId === writerId)) {
    return 'script';
  }

  return inventory.scenes.some((scene) => scene.sceneId === writerId)
    ? 'scene'
    : 'automation';
}

export function getWriterLabel(
  inventory: InventoryGraph,
  writerId: string,
): string {
  const writerKind = getWriterKindForId(inventory, writerId);

  return writerKind === 'scene'
    ? getSceneLabel(inventory, writerId)
    : writerKind === 'script'
      ? getScriptLabel(inventory, writerId)
      : getAutomationLabel(inventory, writerId);
}

export function formatWriterKind(kind: WriterTarget['kind']): string {
  return kind;
}

export function classifyServiceActionTag(
  serviceId: string,
): string | undefined {
  if (serviceId === 'script.turn_on') {
    return 'call_script';
  }

  if (serviceId === 'scene.turn_on') {
    return 'activate_scene';
  }

  if (
    /^(fan|humidifier|input_boolean|light|media_player|remote|siren|switch|vacuum|valve|water_heater)\.turn_on$/u.test(
      serviceId,
    )
  ) {
    return 'activate';
  }

  if (
    /^(fan|humidifier|input_boolean|light|media_player|remote|siren|switch|vacuum|valve|water_heater)\.turn_off$/u.test(
      serviceId,
    )
  ) {
    return 'deactivate';
  }

  if (serviceId === 'cover.open_cover') {
    return 'open';
  }

  if (serviceId === 'cover.close_cover') {
    return 'close';
  }

  if (serviceId === 'lock.lock') {
    return 'lock';
  }

  if (serviceId === 'lock.unlock') {
    return 'unlock';
  }

  if (serviceId.endsWith('.toggle')) {
    return 'toggle';
  }

  return undefined;
}

export function getWriterActionTags(
  kind: WriterTarget['kind'],
  serviceIds: string[],
): string[] {
  const actionTags = uniqueValues(
    serviceIds.flatMap((serviceId) => {
      const tag = classifyServiceActionTag(serviceId);
      return tag ? [tag] : [];
    }),
  );

  if (actionTags.length > 0) {
    return actionTags;
  }

  return kind === 'scene' ? ['activate_scene'] : [];
}

export function getWriterPairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join('::');
}

export function getResolvedAreaId(
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

export function getAuditHelpers(inventory: InventoryGraph) {
  const helpers = new Map<
    string,
    {
      helperId: string;
      helperType: string;
      name: string;
      sourcePath?: string;
    }
  >();

  for (const helper of inventory.helpers ?? []) {
    helpers.set(helper.helperId, {
      helperId: helper.helperId,
      helperType: helper.helperType,
      name: helper.name,
      ...(helper.sourcePath ? {sourcePath: helper.sourcePath} : {}),
    });
  }

  for (const entity of inventory.entities) {
    const helperType = getEntityDomain(entity.entityId);

    if (!helperEntityDomains.has(helperType)) {
      continue;
    }

    if (!helpers.has(entity.entityId)) {
      helpers.set(entity.entityId, {
        helperId: entity.entityId,
        helperType,
        name: entity.displayName,
      });
    }
  }

  return [...helpers.values()];
}

export function getTemplateLabel(
  templateId: string,
  sourceObjectId?: string,
): string {
  return sourceObjectId
    ? `Template in ${sourceObjectId}`
    : `Template ${templateId}`;
}

export function createSourceObjectAffectedObject(
  inventory: InventoryGraph,
  objectId: string,
): FindingAffectedObject {
  if (objectId.startsWith('automation.')) {
    return createAffectedObject(
      'automation',
      objectId,
      `${getAutomationLabel(inventory, objectId)} (${objectId})`,
    );
  }

  if (objectId.startsWith('scene.')) {
    return createAffectedObject(
      'scene',
      objectId,
      `${getSceneLabel(inventory, objectId)} (${objectId})`,
    );
  }

  if (objectId.startsWith('script.')) {
    return createAffectedObject(
      'script',
      objectId,
      `${getScriptLabel(inventory, objectId)} (${objectId})`,
    );
  }

  return createAffectedObject('template', objectId, objectId);
}

export function createEntityFinding(
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
