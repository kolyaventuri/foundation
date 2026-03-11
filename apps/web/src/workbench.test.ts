import {describe, expect, it} from 'vitest';
import type {ScanDetail, ScanWorkbench} from '@ha-repair/contracts';
import {
  buildWorkbenchFindingRecords,
  filterWorkbenchFindingRecords,
  flattenRailGroups,
  getNextRecommendedFindingId,
  getVisibleVirtualRailRows,
  groupWorkbenchFindingRecords,
} from './workbench';

const scan: ScanDetail = {
  createdAt: '2026-03-01T00:00:00.000Z',
  diffSummary: {
    previousScanId: null,
    regressedCount: 3,
    regressedFindingIds: [
      'duplicate_name:Kitchen Light:area.kitchen',
      'stale_entity:sensor.kitchen_light_power',
      'orphaned_entity_device:switch.orphaned_fan',
    ],
    resolvedCount: 0,
    resolvedFindingIds: [],
    unchangedCount: 0,
    unchangedFindingIds: [],
  },
  findings: [
    {
      evidence:
        'Found 2 user-facing entities in Kitchen that all display as "Kitchen Light", which creates an ambiguous in-area label collision.',
      id: 'duplicate_name:Kitchen Light:area.kitchen',
      kind: 'duplicate_name',
      objectIds: ['light.kitchen_light', 'sensor.kitchen_light_power'],
      severity: 'medium',
      title: 'Ambiguous name in Kitchen: Kitchen Light',
    },
    {
      evidence: 'Entity sensor.kitchen_light_power is marked stale.',
      id: 'stale_entity:sensor.kitchen_light_power',
      kind: 'stale_entity',
      objectIds: ['sensor.kitchen_light_power'],
      severity: 'low',
      title: 'Stale entity sensor.kitchen_light_power',
    },
    {
      evidence: 'Entity switch.orphaned_fan references missing device.',
      id: 'orphaned_entity_device:switch.orphaned_fan',
      kind: 'orphaned_entity_device',
      objectIds: ['switch.orphaned_fan', 'device.ghost'],
      severity: 'high',
      title: 'Orphaned entity/device link for switch.orphaned_fan',
    },
    {
      evidence:
        'Entity sensor.attic_temperature has no direct floor assignment.',
      id: 'missing_floor_assignment:sensor.attic_temperature',
      kind: 'missing_floor_assignment',
      objectIds: ['sensor.attic_temperature'],
      severity: 'low',
      title: 'Missing floor assignment for sensor.attic_temperature',
    },
  ],
  enrichment: {
    findingSummaries: [],
    provider: 'none',
    status: 'disabled',
  },
  fingerprint: 'scan-fingerprint',
  id: 'scan-1',
  inventory: {
    areas: [],
    automations: [],
    devices: [
      {
        deviceId: 'device.kitchen_light',
        name: 'Kitchen Light',
      },
    ],
    entities: [
      {
        deviceId: 'device.kitchen_light',
        disabledBy: null,
        displayName: 'Kitchen Light',
        entityId: 'light.kitchen_light',
        isStale: false,
        name: null,
      },
      {
        disabledBy: null,
        displayName: 'Kitchen Light',
        entityId: 'sensor.kitchen_light_power',
        isStale: true,
        name: null,
      },
      {
        deviceId: 'device.ghost',
        disabledBy: null,
        displayName: 'Orphaned Fan',
        entityId: 'switch.orphaned_fan',
        isStale: false,
        name: null,
      },
    ],
    floors: [],
    labels: [],
    scenes: [],
    source: 'mock',
  },
  mode: 'mock',
  notes: [],
  passes: [],
  profileName: null,
};

const workbench: ScanWorkbench = {
  entries: [
    {
      findingId: 'duplicate_name:Kitchen Light:area.kitchen',
      savedInputs: [
        {
          field: 'name',
          findingId: 'duplicate_name:Kitchen Light:area.kitchen',
          targetId: 'light.kitchen_light',
          value: 'Kitchen Light (light.kitchen_light)',
        },
      ],
      status: 'staged',
      treatment: 'actionable',
      updatedAt: '2026-03-01T08:00:00.000Z',
    },
    {
      findingId: 'stale_entity:sensor.kitchen_light_power',
      savedInputs: [],
      status: 'recommended',
      treatment: 'actionable',
    },
    {
      findingId: 'orphaned_entity_device:switch.orphaned_fan',
      savedInputs: [],
      status: 'advisory',
      treatment: 'advisory',
    },
    {
      findingId: 'missing_floor_assignment:sensor.attic_temperature',
      savedInputs: [],
      status: 'advisory',
      treatment: 'advisory',
    },
  ],
  isPreviewStale: true,
  scanId: 'scan-1',
  stagedCount: 1,
};

describe('workbench helpers', () => {
  it('groups staged, recommended, and advisory findings in dense rail order', () => {
    const records = buildWorkbenchFindingRecords(scan, workbench);
    const groups = groupWorkbenchFindingRecords(records);

    expect(groups.map((group) => group.key)).toEqual([
      'staged',
      'recommended',
      'advisory',
    ]);
    expect(groups[0]?.items[0]?.finding.id).toBe(
      'duplicate_name:Kitchen Light:area.kitchen',
    );
    expect(groups[1]?.items[0]?.finding.id).toBe(
      'stale_entity:sensor.kitchen_light_power',
    );
  });

  it('filters records and finds the next actionable recommendation', () => {
    const records = buildWorkbenchFindingRecords(scan, workbench);
    const filtered = filterWorkbenchFindingRecords(records, {
      kind: 'all',
      query: 'kitchen',
      severity: 'all',
      status: 'all',
    });

    expect(filtered.map((record) => record.finding.id)).toEqual([
      'duplicate_name:Kitchen Light:area.kitchen',
      'stale_entity:sensor.kitchen_light_power',
    ]);
    expect(
      getNextRecommendedFindingId(
        records,
        'duplicate_name:Kitchen Light:area.kitchen',
      ),
    ).toBe('stale_entity:sensor.kitchen_light_power');
  });

  it('virtualizes a flattened rail list with section headers', () => {
    const rows = flattenRailGroups(
      groupWorkbenchFindingRecords(
        buildWorkbenchFindingRecords(scan, workbench),
      ),
    );
    const visible = getVisibleVirtualRailRows(rows, 0, 140);

    expect(visible.totalHeight).toBeGreaterThan(0);
    expect(visible.rows[0]?.type).toBe('group');
    expect(visible.rows.some((row) => row.type === 'finding')).toBe(true);
  });

  it('filters advisory floor hygiene findings by kind', () => {
    const records = buildWorkbenchFindingRecords(scan, workbench);
    const filtered = filterWorkbenchFindingRecords(records, {
      kind: 'missing_floor_assignment',
      query: '',
      severity: 'all',
      status: 'advisory',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.finding.id).toBe(
      'missing_floor_assignment:sensor.attic_temperature',
    );
  });
});
