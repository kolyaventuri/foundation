import {describe, expect, it} from 'vitest';
import {
  createFrameworkSummary,
  type InventoryGraph,
} from '@ha-repair/contracts';
import {createFindingAdvisories, createFixActions, runScan} from './index';

const baselineInventory: InventoryGraph = {
  areas: [
    {
      areaId: 'area.kitchen',
      name: 'Kitchen',
    },
    {
      areaId: 'area.utility',
      name: 'Utility',
    },
  ],
  automations: [],
  devices: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      name: 'Kitchen Light',
    },
  ],
  entities: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      isStale: false,
      name: null,
    },
    {
      assistantExposureBindings: {
        assist: {
          flagKey: 'enabled',
          optionKey: 'conversation',
        },
      },
      assistantExposures: ['assist'],
      areaId: 'area.kitchen',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'sensor.kitchen_light_power',
      isStale: true,
      name: null,
    },
    {
      areaId: 'area.utility',
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
  source: 'mock' as const,
};

const floorCoverageInventory: InventoryGraph = {
  ...baselineInventory,
  devices: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      floorId: 'floor.main',
      name: 'Kitchen Light',
    },
  ],
  entities: [
    {
      areaId: 'area.kitchen',
      deviceId: 'device.kitchen_light',
      disabledBy: null,
      displayName: 'Kitchen Light',
      entityId: 'light.kitchen_light',
      floorId: null,
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.utility',
      disabledBy: null,
      displayName: 'Utility Sensor',
      entityId: 'sensor.utility_temperature',
      floorId: null,
      isStale: false,
      name: null,
    },
  ],
  floors: [
    {
      floorId: 'floor.main',
      name: 'Main Floor',
    },
  ],
};

const sharedLabelObservationInventory: InventoryGraph = {
  areas: [],
  automations: [],
  devices: [],
  entities: [
    {
      disabledBy: null,
      displayName: 'Anyone Home?',
      entityId: 'automation.anyone_home',
      isStale: false,
      name: null,
    },
    {
      disabledBy: null,
      displayName: 'Anyone Home?',
      entityId: 'input_boolean.anyone_home',
      isStale: false,
      name: null,
    },
  ],
  floors: [],
  labels: [],
  scenes: [],
  source: 'mock',
};

describe('scan-engine', () => {
  it('describes the initial scaffold surfaces', () => {
    const summary = createFrameworkSummary();

    expect(summary.title).toBe('Home Assistant Repair Console');
    expect(summary.surfaces).toHaveLength(4);
    expect(summary.surfaces.some((surface) => surface.id === 'rules')).toBe(
      true,
    );
  });

  it('returns deterministic findings for duplicate names, stale entities, and orphans', () => {
    const result = runScan(baselineInventory);

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'duplicate_name',
        'orphaned_entity_device',
        'stale_entity',
      ]),
    );
  });

  it('downgrades non-user-facing shared labels to advisory observations', () => {
    const result = runScan(sharedLabelObservationInventory);

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'shared_label_observation:Anyone Home?',
          kind: 'shared_label_observation',
          severity: 'low',
        }),
      ]),
    );
    expect(
      createFixActions(sharedLabelObservationInventory, result.findings),
    ).toEqual([]);
  });

  it('builds literal Home Assistant commands only for supported actions', () => {
    const scan = runScan(baselineInventory);
    const actions = createFixActions(baselineInventory, scan.findings, [
      {
        field: 'name',
        findingId: 'duplicate_name:Kitchen Light:area.kitchen',
        targetId: 'light.kitchen_light',
        value: 'Kitchen Light (light.kitchen_light)',
      },
      {
        field: 'name',
        findingId: 'duplicate_name:Kitchen Light:area.kitchen',
        targetId: 'sensor.kitchen_light_power',
        value: 'Kitchen Light (sensor.kitchen_light_power)',
      },
    ]);

    expect(actions.map((action) => action.kind)).toEqual([
      'rename_duplicate_name',
      'review_stale_entity',
    ]);
    const renameAction = actions[0];
    const staleAction = actions[1];

    expect(renameAction).toBeDefined();
    expect(staleAction).toBeDefined();

    if (!renameAction || !staleAction) {
      throw new Error('Expected duplicate-name and stale-entity actions');
    }

    expect(renameAction.commands[0]).toMatchObject({
      payload: {
        entity_id: 'light.kitchen_light',
        name: 'Kitchen Light (light.kitchen_light)',
        type: 'config/entity_registry/update',
      },
    });
    expect(staleAction.commands[0]).toMatchObject({
      payload: {
        disabled_by: 'user',
        entity_id: 'sensor.kitchen_light_power',
        type: 'config/entity_registry/update',
      },
    });
  });

  it('keeps orphaned device findings advisory-only', () => {
    const scan = runScan(baselineInventory);
    const advisories = createFindingAdvisories(
      baselineInventory,
      scan.findings,
    );

    expect(advisories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingId: 'orphaned_entity_device:switch.orphaned_fan',
        }),
      ]),
    );
  });

  it('adds an explicit advisory floor hygiene finding when floors are configured', () => {
    const scan = runScan(floorCoverageInventory);
    const floorFinding = scan.findings.find(
      (finding) =>
        finding.id === 'missing_floor_assignment:sensor.utility_temperature',
    );

    expect(floorFinding).toMatchObject({
      kind: 'missing_floor_assignment',
      severity: 'low',
    });

    const advisories = createFindingAdvisories(
      floorCoverageInventory,
      scan.findings,
    );

    expect(advisories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingId: 'missing_floor_assignment:sensor.utility_temperature',
          summary:
            'Assign the entity or its backing device to a floor, then rerun the scan.',
        }),
      ]),
    );
  });
});
