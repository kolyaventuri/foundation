import type {
  Finding,
  FindingKind,
  FindingSeverity,
  ScanDetail,
  ScanWorkbench,
  WorkbenchEntryStatus,
} from '@ha-repair/contracts';

export type RailFilters = {
  kind: FindingKind | 'all';
  query: string;
  severity: FindingSeverity | 'all';
  status: WorkbenchEntryStatus | 'all';
};

export type RailGroupKey = 'staged' | 'recommended' | 'advisory';

export type WorkbenchFindingRecord = {
  finding: Finding;
  group: RailGroupKey;
  savedInputsCount: number;
  searchText: string;
  status: WorkbenchEntryStatus;
  treatment: ScanWorkbench['entries'][number]['treatment'];
  updatedAt?: string;
};

export type RailGroup = {
  items: WorkbenchFindingRecord[];
  key: RailGroupKey;
  label: string;
};

export type VirtualRailRow =
  | {
      groupKey: RailGroupKey;
      height: number;
      id: string;
      label: string;
      type: 'group';
    }
  | {
      groupKey: RailGroupKey;
      height: number;
      id: string;
      record: WorkbenchFindingRecord;
      type: 'finding';
    };

export type VisibleVirtualRailRow = VirtualRailRow & {
  top: number;
};

const railGroupLabels: Record<RailGroupKey, string> = {
  advisory: 'Advisory',
  recommended: 'Recommended',
  staged: 'Staged batch',
};

function getSeverityRank(severity: FindingSeverity): number {
  switch (severity) {
    case 'high': {
      return 0;
    }

    case 'medium': {
      return 1;
    }

    case 'low': {
      return 2;
    }
  }
}

function getRailGroup(status: WorkbenchEntryStatus): RailGroupKey {
  switch (status) {
    case 'advisory': {
      return 'advisory';
    }

    case 'recommended': {
      return 'recommended';
    }

    case 'dry_run_applied':
    case 'staged': {
      return 'staged';
    }
  }
}

function sortRecords(
  left: WorkbenchFindingRecord,
  right: WorkbenchFindingRecord,
): number {
  if (left.group === 'staged' && right.group === 'staged') {
    const leftUpdatedAt = left.updatedAt ?? '';
    const rightUpdatedAt = right.updatedAt ?? '';

    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt.localeCompare(leftUpdatedAt);
    }
  }

  const severityDelta =
    getSeverityRank(left.finding.severity) -
    getSeverityRank(right.finding.severity);

  if (severityDelta !== 0) {
    return severityDelta;
  }

  return left.finding.title.localeCompare(right.finding.title);
}

export function getFindingObjectSummary(finding: Finding): string {
  if (finding.objectIds.length <= 2) {
    return finding.objectIds.join(', ');
  }

  const [firstObjectId, secondObjectId] = finding.objectIds;
  return `${firstObjectId}, ${secondObjectId}, +${finding.objectIds.length - 2}`;
}

export function buildWorkbenchFindingRecords(
  scan: ScanDetail,
  workbench: ScanWorkbench,
): WorkbenchFindingRecord[] {
  const entryByFindingId = new Map(
    workbench.entries.map((entry) => [entry.findingId, entry] as const),
  );

  return scan.findings.map((finding) => {
    const entry = entryByFindingId.get(finding.id);

    if (!entry) {
      throw new Error(`Missing workbench entry for finding "${finding.id}".`);
    }

    return {
      finding,
      group: getRailGroup(entry.status),
      savedInputsCount: entry.savedInputs.length,
      searchText: [finding.title, finding.evidence, ...finding.objectIds]
        .join(' ')
        .toLowerCase(),
      status: entry.status,
      treatment: entry.treatment,
      ...(entry.updatedAt ? {updatedAt: entry.updatedAt} : {}),
    };
  });
}

export function filterWorkbenchFindingRecords(
  records: WorkbenchFindingRecord[],
  filters: RailFilters,
): WorkbenchFindingRecord[] {
  const query = filters.query.trim().toLowerCase();

  return records.filter((record) => {
    if (filters.status !== 'all' && record.status !== filters.status) {
      return false;
    }

    if (
      filters.severity !== 'all' &&
      record.finding.severity !== filters.severity
    ) {
      return false;
    }

    if (filters.kind !== 'all' && record.finding.kind !== filters.kind) {
      return false;
    }

    if (query.length > 0 && !record.searchText.includes(query)) {
      return false;
    }

    return true;
  });
}

export function groupWorkbenchFindingRecords(
  records: WorkbenchFindingRecord[],
): RailGroup[] {
  const buckets: Record<RailGroupKey, WorkbenchFindingRecord[]> = {
    advisory: [],
    recommended: [],
    staged: [],
  };

  for (const record of records) {
    buckets[record.group].push(record);
  }

  return (['staged', 'recommended', 'advisory'] as const)
    .map((groupKey) => ({
      items: [...buckets[groupKey]].sort(sortRecords),
      key: groupKey,
      label: railGroupLabels[groupKey],
    }))
    .filter((group) => group.items.length > 0);
}

export function getNextRecommendedFindingId(
  records: WorkbenchFindingRecord[],
  currentFindingId: string | undefined,
): string | undefined {
  const actionableRecommendations = records.filter(
    (record) =>
      record.status === 'recommended' && record.treatment === 'actionable',
  );

  if (actionableRecommendations.length === 0) {
    return undefined;
  }

  const currentIndex = actionableRecommendations.findIndex(
    (record) => record.finding.id === currentFindingId,
  );

  if (currentIndex !== -1) {
    return actionableRecommendations[currentIndex + 1]?.finding.id;
  }

  return actionableRecommendations[0]?.finding.id;
}

export function getDefaultFindingId(
  records: WorkbenchFindingRecord[],
): string | undefined {
  return (
    records.find(
      (record) =>
        record.status === 'recommended' && record.treatment === 'actionable',
    )?.finding.id ?? records[0]?.finding.id
  );
}

export function flattenRailGroups(groups: RailGroup[]): VirtualRailRow[] {
  return groups.flatMap((group) => [
    {
      groupKey: group.key,
      height: 34,
      id: `group:${group.key}`,
      label: `${group.label} (${group.items.length})`,
      type: 'group' as const,
    },
    ...group.items.map((record) => ({
      groupKey: group.key,
      height: 76,
      id: `finding:${record.finding.id}`,
      record,
      type: 'finding' as const,
    })),
  ]);
}

export function getVisibleVirtualRailRows(
  rows: VirtualRailRow[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 4,
): {
  rows: VisibleVirtualRailRow[];
  totalHeight: number;
} {
  const positionedRows: VisibleVirtualRailRow[] = [];
  let totalHeight = 0;

  for (const row of rows) {
    positionedRows.push({
      ...row,
      top: totalHeight,
    });
    totalHeight += row.height;
  }

  if (viewportHeight <= 0) {
    return {
      rows: positionedRows,
      totalHeight,
    };
  }

  const startBoundary = Math.max(0, scrollTop - overscan * 76);
  const endBoundary = scrollTop + viewportHeight + overscan * 76;

  return {
    rows: positionedRows.filter((row) => {
      const rowBottom = row.top + row.height;
      return rowBottom >= startBoundary && row.top <= endBoundary;
    }),
    totalHeight,
  };
}
