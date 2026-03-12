import {createHash} from 'node:crypto';
import type {
  Finding,
  InventoryGraph,
  ScanConflictHotspot,
  ScanIntentCluster,
} from '@ha-repair/contracts';
import {
  calculateJaccardScore,
  createAffectedObject,
  createFinding,
  formatWriterKind,
  getEntityLabel,
  getWriterActionTags,
  getWriterPairKey,
  indexDevices,
  intersectValues,
  normalizeConfidence,
  normalizeRatio,
  normalizeScore,
  opposingActionTags,
  tokenizeLabel,
  uniqueValues,
  type ConflictCandidate,
  type OwnershipHotspot,
  type WriterProfile,
  type WriterRelation,
  type WriterTarget,
} from './shared';

function getTargetAreaIds(
  inventory: InventoryGraph,
  targetEntityIds: string[],
): string[] {
  const devicesById = indexDevices(inventory);
  const entitiesById = new Map(
    inventory.entities.map((entity) => [entity.entityId, entity] as const),
  );

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

function buildWriterTargets(inventory: InventoryGraph): WriterTarget[] {
  const entityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );

  return [
    ...inventory.automations.map((automation) => {
      const targetEntityIds = uniqueValues(
        automation.targetEntityIds.filter((entityId) =>
          entityIds.has(entityId),
        ),
      );

      return {
        areaIds: getTargetAreaIds(inventory, targetEntityIds),
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
        areaIds: getTargetAreaIds(inventory, targetEntityIds),
        id: scene.sceneId,
        kind: 'scene' as const,
        label: scene.name,
        targetEntityIds,
      };
    }),
    ...(inventory.scripts ?? []).map((script) => {
      const targetEntityIds = uniqueValues(
        script.targetEntityIds.filter((entityId) => entityIds.has(entityId)),
      );

      return {
        areaIds: getTargetAreaIds(inventory, targetEntityIds),
        id: script.scriptId,
        kind: 'script' as const,
        label: script.name,
        targetEntityIds,
      };
    }),
  ].filter((writer) => writer.targetEntityIds.length > 0);
}

function buildWriterProfiles(inventory: InventoryGraph): WriterProfile[] {
  const entityIds = new Set(
    inventory.entities.map((entity) => entity.entityId),
  );
  const writerTargetsById = new Map(
    buildWriterTargets(inventory).map((writer) => [writer.id, writer] as const),
  );

  return [
    ...inventory.automations.map((automation) => ({
      actionTags: getWriterActionTags(
        'automation',
        automation.references?.serviceIds ?? [],
      ),
      areaIds: writerTargetsById.get(automation.automationId)?.areaIds ?? [],
      helperIds: uniqueValues(automation.references?.helperIds ?? []),
      id: automation.automationId,
      kind: 'automation' as const,
      label: automation.name,
      nameTokens: tokenizeLabel(automation.name),
      serviceIds: uniqueValues(automation.references?.serviceIds ?? []),
      targetEntityIds: uniqueValues(
        automation.targetEntityIds.filter((entityId) =>
          entityIds.has(entityId),
        ),
      ),
    })),
    ...inventory.scenes.map((scene) => ({
      actionTags: getWriterActionTags(
        'scene',
        scene.references?.serviceIds ?? [],
      ),
      areaIds: writerTargetsById.get(scene.sceneId)?.areaIds ?? [],
      helperIds: uniqueValues(scene.references?.helperIds ?? []),
      id: scene.sceneId,
      kind: 'scene' as const,
      label: scene.name,
      nameTokens: tokenizeLabel(scene.name),
      serviceIds: uniqueValues(scene.references?.serviceIds ?? []),
      targetEntityIds: uniqueValues(
        scene.targetEntityIds.filter((entityId) => entityIds.has(entityId)),
      ),
    })),
    ...(inventory.scripts ?? []).map((script) => ({
      actionTags: getWriterActionTags(
        'script',
        script.references?.serviceIds ?? [],
      ),
      areaIds: writerTargetsById.get(script.scriptId)?.areaIds ?? [],
      helperIds: uniqueValues(script.references?.helperIds ?? []),
      id: script.scriptId,
      kind: 'script' as const,
      label: script.name,
      nameTokens: tokenizeLabel(script.name),
      serviceIds: uniqueValues(script.references?.serviceIds ?? []),
      targetEntityIds: uniqueValues(
        script.targetEntityIds.filter((entityId) => entityIds.has(entityId)),
      ),
    })),
  ];
}

function calculateWriterRelation(
  left: WriterProfile,
  right: WriterProfile,
): WriterRelation {
  const sharedAreaIds = intersectValues(left.areaIds, right.areaIds);
  const sharedHelperIds = intersectValues(left.helperIds, right.helperIds);
  const sharedNameTokens = intersectValues(left.nameTokens, right.nameTokens);
  const sharedTargetEntityIds = intersectValues(
    left.targetEntityIds,
    right.targetEntityIds,
  );
  const score = normalizeRatio(
    calculateJaccardScore(left.targetEntityIds, right.targetEntityIds) * 0.45 +
      calculateJaccardScore(left.nameTokens, right.nameTokens) * 0.25 +
      calculateJaccardScore(left.helperIds, right.helperIds) * 0.15 +
      calculateJaccardScore(left.areaIds, right.areaIds) * 0.15,
  );

  return {
    score,
    sharedAreaIds,
    sharedHelperIds,
    sharedNameTokens,
    sharedTargetEntityIds,
  };
}

function buildWriterRelationIndex(
  profiles: WriterProfile[],
): Map<string, WriterRelation> {
  const relations = new Map<string, WriterRelation>();

  for (let leftIndex = 0; leftIndex < profiles.length; leftIndex += 1) {
    const left = profiles[leftIndex]!;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < profiles.length;
      rightIndex += 1
    ) {
      const right = profiles[rightIndex]!;
      relations.set(
        getWriterPairKey(left.id, right.id),
        calculateWriterRelation(left, right),
      );
    }
  }

  return relations;
}

function buildWriterAdjacency(input: {
  relationIndex: Map<string, WriterRelation>;
  writerProfiles: WriterProfile[];
}): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const profile of input.writerProfiles) {
    adjacency.set(profile.id, new Set<string>());
  }

  for (
    let leftIndex = 0;
    leftIndex < input.writerProfiles.length;
    leftIndex += 1
  ) {
    const left = input.writerProfiles[leftIndex]!;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < input.writerProfiles.length;
      rightIndex += 1
    ) {
      const right = input.writerProfiles[rightIndex]!;
      const relation = input.relationIndex.get(
        getWriterPairKey(left.id, right.id),
      );

      if (!relation) {
        continue;
      }

      const hasSharedSignal =
        relation.sharedAreaIds.length > 0 ||
        relation.sharedHelperIds.length > 0 ||
        relation.sharedNameTokens.length > 0 ||
        relation.sharedTargetEntityIds.length > 0;

      if (!hasSharedSignal || relation.score < 0.55) {
        continue;
      }

      adjacency.get(left.id)?.add(right.id);
      adjacency.get(right.id)?.add(left.id);
    }
  }

  return adjacency;
}

function collectClusterComponentIds(input: {
  adjacency: Map<string, Set<string>>;
  visited: Set<string>;
  writerId: string;
}): string[] {
  const queue = [input.writerId];
  const componentIds: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();

    if (!currentId || input.visited.has(currentId)) {
      continue;
    }

    input.visited.add(currentId);
    componentIds.push(currentId);

    for (const neighborId of input.adjacency.get(currentId) ?? []) {
      if (!input.visited.has(neighborId)) {
        queue.push(neighborId);
      }
    }
  }

  return componentIds;
}

function getClusterAverageSimilarity(input: {
  componentProfiles: WriterProfile[];
  relationIndex: Map<string, WriterRelation>;
}): number {
  const componentScores: number[] = [];

  for (
    let leftIndex = 0;
    leftIndex < input.componentProfiles.length;
    leftIndex += 1
  ) {
    const left = input.componentProfiles[leftIndex]!;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < input.componentProfiles.length;
      rightIndex += 1
    ) {
      const right = input.componentProfiles[rightIndex]!;
      const relation = input.relationIndex.get(
        getWriterPairKey(left.id, right.id),
      );

      if (relation && relation.score >= 0.55) {
        componentScores.push(relation.score);
      }
    }
  }

  if (componentScores.length === 0) {
    return 0.55;
  }

  const totalScore = componentScores.reduce((sum, score) => sum + score, 0);
  return normalizeRatio(totalScore / componentScores.length);
}

function buildIntentClusters(input: {
  relationIndex: Map<string, WriterRelation>;
  writerProfiles: WriterProfile[];
}): {
  clusterIdsByWriterId: Map<string, string>;
  clusters: ScanIntentCluster[];
} {
  const profilesById = new Map(
    input.writerProfiles.map((profile) => [profile.id, profile] as const),
  );
  const adjacency = buildWriterAdjacency(input);
  const visited = new Set<string>();
  const clusters: ScanIntentCluster[] = [];
  const clusterIdsByWriterId = new Map<string, string>();

  for (const profile of input.writerProfiles) {
    if (visited.has(profile.id)) {
      continue;
    }

    const componentIds = collectClusterComponentIds({
      adjacency,
      visited,
      writerId: profile.id,
    });

    if (componentIds.length < 2) {
      continue;
    }

    const componentProfiles = componentIds
      .map((id) => profilesById.get(id))
      .filter(
        (candidate): candidate is WriterProfile => candidate !== undefined,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const clusterId = `intent_cluster:${createHash('sha1')
      .update(componentProfiles.map((component) => component.id).join('|'))
      .digest('hex')
      .slice(0, 10)}`;
    const cluster: ScanIntentCluster = {
      areaIds: uniqueValues(
        componentProfiles.flatMap((component) => component.areaIds),
      ),
      averageSimilarity: getClusterAverageSimilarity({
        componentProfiles,
        relationIndex: input.relationIndex,
      }),
      clusterId,
      conceptTerms: uniqueValues(
        componentProfiles.flatMap((component) =>
          component.nameTokens.filter((token) => token.length > 2),
        ),
      ),
      objectIds: componentProfiles.map((component) => component.id),
      objectKinds: componentProfiles.map((component) => component.kind),
      objectLabels: componentProfiles.map((component) => component.label),
      targetEntityIds: uniqueValues(
        componentProfiles.flatMap((component) => component.targetEntityIds),
      ),
    };

    clusters.push(cluster);

    for (const component of componentProfiles) {
      clusterIdsByWriterId.set(component.id, clusterId);
    }
  }

  return {
    clusterIdsByWriterId,
    clusters,
  };
}

export function getOpposingActionPairs(
  leftActionTags: string[],
  rightActionTags: string[],
): string[] {
  const rightTagSet = new Set(rightActionTags);
  const pairs: string[] = [];

  for (const leftActionTag of leftActionTags) {
    for (const opposingTag of opposingActionTags.get(leftActionTag) ?? []) {
      if (rightTagSet.has(opposingTag)) {
        pairs.push(`${leftActionTag}:${opposingTag}`);
      }
    }
  }

  return uniqueValues(pairs);
}

function createConflictCandidateFinding(input: {
  clusterId?: string | undefined;
  conflictScore: number;
  contextScore: number;
  inventory: InventoryGraph;
  left: WriterProfile;
  opposingPairs: string[];
  relation: WriterRelation;
  right: WriterProfile;
  sameCluster: boolean;
  writerIds: string[];
  writerKinds: Array<'automation' | 'scene' | 'script'>;
}): Finding {
  const sortedWriterIds = [input.left.id, input.right.id].sort();

  return createFinding({
    affectedObjects: [
      createAffectedObject(
        input.left.kind,
        input.left.id,
        `${input.left.label} (${input.left.id})`,
      ),
      createAffectedObject(
        input.right.kind,
        input.right.id,
        `${input.right.label} (${input.right.id})`,
      ),
      ...input.relation.sharedTargetEntityIds.map((entityId) =>
        createAffectedObject(
          'entity',
          entityId,
          getEntityLabel(input.inventory, entityId),
        ),
      ),
    ],
    category: 'conflict_overlap',
    checkId: 'LIKELY_CONFLICTING_CONTROLS',
    confidence: normalizeConfidence(0.78 + input.conflictScore * 0.16),
    evidence: `${formatWriterKind(input.left.kind)} ${input.left.label} and ${formatWriterKind(input.right.kind)} ${input.right.label} both target ${input.relation.sharedTargetEntityIds.join(', ')} with opposing action patterns (${input.opposingPairs.join(', ')}) and overlapping context.`,
    evidenceDetails: {
      actionPairs: input.opposingPairs,
      ...(input.sameCluster && input.clusterId
        ? {clusterId: input.clusterId}
        : {}),
      sharedAreaIds: input.relation.sharedAreaIds,
      sharedHelperIds: input.relation.sharedHelperIds,
      sharedNameTokens: input.relation.sharedNameTokens,
      sharedTargetEntityIds: input.relation.sharedTargetEntityIds,
      similarityScore: input.contextScore,
      writerIds: input.writerIds,
      writerKinds: input.writerKinds,
    },
    id: `likely_conflicting_controls:${sortedWriterIds[0]}:${sortedWriterIds[1]}`,
    kind: 'likely_conflicting_controls',
    objectIds: [...input.writerIds, ...input.relation.sharedTargetEntityIds],
    recommendation: {
      action:
        'Review whether the competing writers should be gated, sequenced, or consolidated so they stop issuing opposing commands in the same context.',
      steps: [
        'Inspect the overlapping writers and confirm whether they should both control the same targets.',
        'Adjust gates, timing, or ownership so one intent does not immediately fight the other.',
        'Rerun the scan to confirm the conflict candidate is reduced or removed.',
      ],
    },
    scores: {
      coupling: normalizeScore(
        42 + input.relation.sharedTargetEntityIds.length * 14,
      ),
      fragility: normalizeScore(38 + Math.round(input.conflictScore * 40)),
    },
    severity:
      input.conflictScore >= 0.8 ||
      input.relation.sharedTargetEntityIds.length >= 2
        ? 'high'
        : 'medium',
    summary: `${input.left.label} and ${input.right.label} issue opposing control patterns across ${input.relation.sharedTargetEntityIds.length} shared target(s).`,
    tags: [
      'likely-conflict',
      ...input.relation.sharedAreaIds,
      ...(input.sameCluster ? ['intent-cluster-overlap'] : []),
    ],
    title: `Likely conflicting controls: ${input.left.label} vs ${input.right.label}`,
    whyItMatters:
      'Competing writers on the same targets can cause flicker, race-like behavior, or brittle household logic that is hard to debug later.',
  });
}

function buildConflictCandidates(input: {
  clusterIdsByWriterId: Map<string, string>;
  inventory: InventoryGraph;
  relationIndex: Map<string, WriterRelation>;
  writerProfiles: WriterProfile[];
}): ConflictCandidate[] {
  const candidates: ConflictCandidate[] = [];

  for (
    let leftIndex = 0;
    leftIndex < input.writerProfiles.length;
    leftIndex += 1
  ) {
    const left = input.writerProfiles[leftIndex]!;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < input.writerProfiles.length;
      rightIndex += 1
    ) {
      const right = input.writerProfiles[rightIndex]!;
      const relation = input.relationIndex.get(
        getWriterPairKey(left.id, right.id),
      );

      if (!relation || relation.sharedTargetEntityIds.length === 0) {
        continue;
      }

      const opposingPairs = getOpposingActionPairs(
        left.actionTags,
        right.actionTags,
      );

      if (opposingPairs.length === 0) {
        continue;
      }

      const leftClusterId = input.clusterIdsByWriterId.get(left.id);
      const rightClusterId = input.clusterIdsByWriterId.get(right.id);
      const sameCluster =
        leftClusterId !== undefined && leftClusterId === rightClusterId;
      const hasSharedContext =
        sameCluster ||
        relation.sharedAreaIds.length > 0 ||
        relation.sharedHelperIds.length > 0 ||
        relation.sharedNameTokens.length > 0;
      const contextScore = normalizeRatio(
        relation.score + (sameCluster ? 0.1 : 0),
      );

      if (!hasSharedContext && contextScore < 0.55) {
        continue;
      }

      const targetOverlapScore = calculateJaccardScore(
        left.targetEntityIds,
        right.targetEntityIds,
      );
      const conflictScore = normalizeRatio(
        targetOverlapScore * 0.45 + 0.35 + contextScore * 0.2,
      );
      const writerIds = uniqueValues([left.id, right.id]);
      const writerKinds = uniqueValues([left.kind, right.kind]) as Array<
        'automation' | 'scene' | 'script'
      >;

      candidates.push({
        finding: createConflictCandidateFinding({
          clusterId: leftClusterId,
          conflictScore,
          contextScore,
          inventory: input.inventory,
          left,
          opposingPairs,
          relation,
          right,
          sameCluster,
          writerIds,
          writerKinds,
        }),
        sharedEntityIds: relation.sharedTargetEntityIds,
        writerIds,
        writerKinds,
      });
    }
  }

  return candidates;
}

function buildConflictHotspots(
  inventory: InventoryGraph,
  candidates: ConflictCandidate[],
): ScanConflictHotspot[] {
  const hotspots = new Map<
    string,
    {
      findingIds: string[];
      writerIds: string[];
      writerKinds: Array<'automation' | 'scene' | 'script'>;
    }
  >();

  for (const candidate of candidates) {
    for (const entityId of candidate.sharedEntityIds) {
      const current = hotspots.get(entityId) ?? {
        findingIds: [],
        writerIds: [],
        writerKinds: [],
      };

      hotspots.set(entityId, {
        findingIds: uniqueValues([...current.findingIds, candidate.finding.id]),
        writerIds: uniqueValues([...current.writerIds, ...candidate.writerIds]),
        writerKinds: uniqueValues([
          ...current.writerKinds,
          ...candidate.writerKinds,
        ]) as Array<'automation' | 'scene' | 'script'>,
      });
    }
  }

  return [...hotspots.entries()]
    .map(([entityId, hotspot]) => ({
      entityId,
      entityLabel: getEntityLabel(inventory, entityId),
      findingIds: hotspot.findingIds,
      writerIds: hotspot.writerIds,
      writerKinds: hotspot.writerKinds,
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
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
      ) as Array<'automation' | 'scene' | 'script'>,
    }));
}

export type ScanGraphArtifacts = {
  clusterIdsByWriterId: Map<string, string>;
  clusters: ScanIntentCluster[];
  conflictCandidates: ConflictCandidate[];
  conflictHotspots: ScanConflictHotspot[];
  hotspots: OwnershipHotspot[];
  relationIndex: Map<string, WriterRelation>;
  writerProfiles: WriterProfile[];
};

export function buildScanGraphArtifacts(
  inventory: InventoryGraph,
): ScanGraphArtifacts {
  const writerProfiles = buildWriterProfiles(inventory);
  const relationIndex = buildWriterRelationIndex(writerProfiles);
  const {clusterIdsByWriterId, clusters} = buildIntentClusters({
    relationIndex,
    writerProfiles,
  });
  const hotspots = buildOwnershipHotspots(inventory);
  const conflictCandidates = buildConflictCandidates({
    clusterIdsByWriterId,
    inventory,
    relationIndex,
    writerProfiles,
  });

  return {
    clusterIdsByWriterId,
    clusters,
    conflictCandidates,
    conflictHotspots: buildConflictHotspots(inventory, conflictCandidates),
    hotspots,
    relationIndex,
    writerProfiles,
  };
}
