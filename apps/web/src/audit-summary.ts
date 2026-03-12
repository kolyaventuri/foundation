import type {
  ScanAuditDigest,
  ScanAuditScores,
  ScanAuditSummary,
  ScanConflictHotspot,
  ScanIntentCluster,
  ScanObjectCounts,
} from '@ha-repair/contracts';

export type AuditScoreCard = {
  key: keyof ScanAuditScores;
  label: string;
  value: number;
};

export type AuditSignalChip = {
  key: string;
  label: string;
  value: number;
};

export type AuditHighlight = {
  detail: string;
  id: string;
  title: string;
};

type AuditScoreSource = {
  scores: ScanAuditScores;
};

type AuditSignalSource = ScanAuditDigest | ScanAuditSummary;

const auditScoreOrder = [
  'correctness',
  'maintainability',
  'clarity',
  'redundancy',
  'cleanupOpportunity',
] as const satisfies Array<keyof ScanAuditScores>;

const auditScoreLabels: Record<keyof ScanAuditScores, string> = {
  clarity: 'Clarity',
  cleanupOpportunity: 'Cleanup',
  correctness: 'Correctness',
  maintainability: 'Maintainability',
  redundancy: 'Redundancy',
};

const objectCountOrder = [
  'entities',
  'automations',
  'helpers',
  'scripts',
  'scenes',
  'templates',
  'configModules',
  'areas',
  'devices',
  'labels',
  'floors',
] as const satisfies Array<keyof ScanObjectCounts>;

const objectCountLabels: Record<
  keyof ScanObjectCounts,
  {plural: string; singular: string}
> = {
  areas: {plural: 'areas', singular: 'area'},
  automations: {plural: 'automations', singular: 'automation'},
  configModules: {plural: 'config modules', singular: 'config module'},
  devices: {plural: 'devices', singular: 'device'},
  entities: {plural: 'entities', singular: 'entity'},
  floors: {plural: 'floors', singular: 'floor'},
  helpers: {plural: 'helpers', singular: 'helper'},
  labels: {plural: 'labels', singular: 'label'},
  scenes: {plural: 'scenes', singular: 'scene'},
  scripts: {plural: 'scripts', singular: 'script'},
  templates: {plural: 'templates', singular: 'template'},
};

export function buildAuditScoreCards(
  audit: AuditScoreSource,
): AuditScoreCard[] {
  return auditScoreOrder.map((key) => ({
    key,
    label: auditScoreLabels[key],
    value: audit.scores[key],
  }));
}

function getAuditSignalCount(
  audit: AuditSignalSource,
  key:
    | 'cleanupCandidateCount'
    | 'conflictCandidateCount'
    | 'intentClusterCount'
    | 'ownershipHotspotCount',
): number {
  if ('cleanupCandidateCount' in audit) {
    return audit[key];
  }

  switch (key) {
    case 'cleanupCandidateCount': {
      return audit.cleanupCandidateIds.length;
    }

    case 'conflictCandidateCount': {
      return audit.conflictCandidateIds.length;
    }

    case 'intentClusterCount': {
      return audit.intentClusters.length;
    }

    case 'ownershipHotspotCount': {
      return audit.ownershipHotspots.length;
    }
  }
}

export function buildAuditSignalChips(
  audit: AuditSignalSource,
): AuditSignalChip[] {
  return [
    {
      key: 'cleanup',
      label: 'Cleanup candidates',
      value: getAuditSignalCount(audit, 'cleanupCandidateCount'),
    },
    {
      key: 'conflicts',
      label: 'Conflict candidates',
      value: getAuditSignalCount(audit, 'conflictCandidateCount'),
    },
    {
      key: 'ownership',
      label: 'Ownership hotspots',
      value: getAuditSignalCount(audit, 'ownershipHotspotCount'),
    },
    {
      key: 'clusters',
      label: 'Intent clusters',
      value: getAuditSignalCount(audit, 'intentClusterCount'),
    },
  ];
}

export function summarizeAuditObjectCounts(
  objectCounts: ScanObjectCounts,
  limit = 6,
): string {
  const visibleCounts = objectCountOrder
    .filter((key) => objectCounts[key] > 0)
    .slice(0, limit)
    .map((key) => {
      const value = objectCounts[key];
      const label =
        value === 1
          ? objectCountLabels[key].singular
          : objectCountLabels[key].plural;

      return `${value} ${label}`;
    });

  if (visibleCounts.length === 0) {
    return 'No scanned objects recorded.';
  }

  return visibleCounts.join(', ');
}

function compareConflictHotspots(
  left: ScanConflictHotspot,
  right: ScanConflictHotspot,
): number {
  if (left.findingIds.length !== right.findingIds.length) {
    return right.findingIds.length - left.findingIds.length;
  }

  if (left.writerIds.length !== right.writerIds.length) {
    return right.writerIds.length - left.writerIds.length;
  }

  return left.entityLabel.localeCompare(right.entityLabel);
}

export function buildConflictHotspotHighlights(
  audit: ScanAuditSummary,
  limit = 3,
): AuditHighlight[] {
  return [...audit.conflictHotspots]
    .sort(compareConflictHotspots)
    .slice(0, limit)
    .map((hotspot) => ({
      detail: `${hotspot.findingIds.length} conflict candidate(s) across ${hotspot.writerIds.length} writer(s)`,
      id: hotspot.entityId,
      title: hotspot.entityLabel,
    }));
}

function compareIntentClusters(
  left: ScanIntentCluster,
  right: ScanIntentCluster,
): number {
  if (left.objectIds.length !== right.objectIds.length) {
    return right.objectIds.length - left.objectIds.length;
  }

  if (left.averageSimilarity !== right.averageSimilarity) {
    return right.averageSimilarity - left.averageSimilarity;
  }

  return left.clusterId.localeCompare(right.clusterId);
}

function getIntentClusterTitle(cluster: ScanIntentCluster): string {
  const conceptTerms = cluster.conceptTerms.slice(0, 3);

  if (conceptTerms.length > 0) {
    return conceptTerms.join(' / ');
  }

  return cluster.objectLabels.slice(0, 2).join(' / ') || cluster.clusterId;
}

export function buildIntentClusterHighlights(
  audit: ScanAuditSummary,
  limit = 3,
): AuditHighlight[] {
  return [...audit.intentClusters]
    .sort(compareIntentClusters)
    .slice(0, limit)
    .map((cluster) => ({
      detail: `${cluster.objectIds.length} object(s) across ${cluster.targetEntityIds.length} target(s) at ${Math.round(cluster.averageSimilarity * 100)}% similarity`,
      id: cluster.clusterId,
      title: getIntentClusterTitle(cluster),
    }));
}
