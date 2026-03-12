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

const phaseTwoAuditInventory: InventoryGraph = {
  areas: [
    {
      areaId: 'area.kitchen',
      name: 'Kitchen',
    },
    {
      areaId: 'area.living',
      name: 'Living Room',
    },
  ],
  automations: [
    {
      automationId: 'automation.evening_routine',
      name: 'Evening Routine',
      references: {
        entityIds: [],
        helperIds: ['input_boolean.mode'],
        sceneIds: [],
        scriptIds: ['script.kitchen_boost'],
        serviceIds: ['script.turn_on'],
      },
      targetEntityIds: [
        'light.kitchen_main',
        'light.kitchen_accent',
        'light.living_lamp',
        'switch.living_fan',
        'switch.porch',
      ],
    },
    {
      automationId: 'automation.kitchen_presence',
      name: 'Kitchen Presence',
      references: {
        entityIds: ['binary_sensor.kitchen_motion'],
        helperIds: ['input_boolean.mode'],
        sceneIds: [],
        scriptIds: [],
        serviceIds: ['light.turn_on'],
      },
      targetEntityIds: ['light.kitchen_main'],
    },
    {
      automationId: 'automation.kitchen_override',
      name: 'Kitchen Override',
      references: {
        entityIds: [],
        helperIds: [],
        sceneIds: [],
        scriptIds: [],
        serviceIds: ['light.turn_off'],
      },
      targetEntityIds: ['light.kitchen_main'],
    },
  ],
  configModules: [
    {
      automationCount: 3,
      filePath: 'automations.yaml',
      helperCount: 2,
      lineCount: 42,
      objectTypesPresent: [
        'automation',
        'helper',
        'scene',
        'script',
        'template',
      ],
      sceneCount: 2,
      scriptCount: 2,
      templateCount: 1,
    },
  ],
  devices: [],
  entities: [
    {
      areaId: 'area.kitchen',
      disabledBy: null,
      displayName: 'Mode',
      entityId: 'input_boolean.mode',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.kitchen',
      disabledBy: null,
      displayName: 'Kitchen Main',
      entityId: 'light.kitchen_main',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.kitchen',
      disabledBy: null,
      displayName: 'Kitchen Accent',
      entityId: 'light.kitchen_accent',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.living',
      disabledBy: null,
      displayName: 'Living Lamp',
      entityId: 'light.living_lamp',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.living',
      disabledBy: null,
      displayName: 'Living Fan',
      entityId: 'switch.living_fan',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.living',
      disabledBy: null,
      displayName: 'Porch Light',
      entityId: 'switch.porch',
      isStale: false,
      name: null,
    },
  ],
  floors: [],
  helpers: [
    {
      helperId: 'input_boolean.mode',
      helperType: 'input_boolean',
      name: 'Mode',
      sourcePath: 'helpers.yaml',
    },
    {
      helperId: 'input_boolean.night_toggle',
      helperType: 'input_boolean',
      name: 'Night Toggle',
      sourcePath: 'helpers.yaml',
    },
  ],
  labels: [],
  scenes: [
    {
      name: 'Kitchen Evening',
      references: {
        entityIds: ['light.kitchen_main'],
        helperIds: ['input_boolean.mode'],
        sceneIds: [],
        scriptIds: [],
        serviceIds: [],
      },
      sceneId: 'scene.kitchen_evening',
      targetEntityIds: ['light.kitchen_main'],
    },
    {
      name: 'Legacy Accent',
      references: {
        entityIds: ['light.kitchen_accent'],
        helperIds: [],
        sceneIds: [],
        scriptIds: [],
        serviceIds: [],
      },
      sceneId: 'scene.legacy_accent',
      targetEntityIds: ['light.kitchen_accent'],
    },
  ],
  scripts: [
    {
      name: 'Kitchen Boost',
      references: {
        entityIds: ['light.kitchen_main'],
        helperIds: ['input_boolean.mode'],
        sceneIds: ['scene.kitchen_evening'],
        scriptIds: [],
        serviceIds: ['scene.turn_on'],
      },
      scriptId: 'script.kitchen_boost',
      sourcePath: 'scripts.yaml',
      targetEntityIds: ['light.kitchen_main'],
    },
    {
      name: 'Legacy Shutdown',
      references: {
        entityIds: ['light.living_lamp'],
        helperIds: [],
        sceneIds: [],
        scriptIds: [],
        serviceIds: ['light.turn_off'],
      },
      scriptId: 'script.legacy_shutdown',
      sourcePath: 'scripts.yaml',
      targetEntityIds: ['light.living_lamp'],
    },
  ],
  source: 'mock',
  templates: [
    {
      entityIds: [],
      helperIds: ['input_boolean.mode'],
      parseValid: true,
      sceneIds: [],
      scriptIds: [],
      sourceObjectId: 'automation.evening_routine',
      sourcePath: 'automations.yaml',
      sourceType: 'automation',
      templateId:
        'automation:automation.evening_routine:action.0.variables.mode',
      templateText: "{{ states('input_boolean.mode') }}",
    },
  ],
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

  it('adds richer phase 2 metadata, ownership hotspots, and coupling checks', () => {
    const scan = runScan(phaseTwoAuditInventory);

    expect(scan.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'ambiguous_helper_name',
        'entity_ownership_hotspot',
        'highly_coupled_automation',
        'unused_helper',
        'unused_scene',
        'unused_script',
      ]),
    );

    const helperFinding = scan.findings.find(
      (finding) => finding.kind === 'ambiguous_helper_name',
    );
    const hotspotFinding = scan.findings.find(
      (finding) => finding.kind === 'entity_ownership_hotspot',
    );
    const unusedHelperFinding = scan.findings.find(
      (finding) => finding.id === 'unused_helper:input_boolean.night_toggle',
    );
    const unusedSceneFinding = scan.findings.find(
      (finding) => finding.id === 'unused_scene:scene.legacy_accent',
    );
    const unusedScriptFinding = scan.findings.find(
      (finding) => finding.id === 'unused_script:script.legacy_shutdown',
    );

    expect(helperFinding).toBeDefined();
    expect(hotspotFinding).toBeDefined();
    expect(unusedHelperFinding).toBeDefined();
    expect(unusedSceneFinding).toBeDefined();
    expect(unusedScriptFinding).toBeDefined();
    expect(scan.audit).toBeDefined();

    if (
      !helperFinding ||
      !hotspotFinding ||
      !unusedHelperFinding ||
      !unusedSceneFinding ||
      !unusedScriptFinding ||
      !scan.audit
    ) {
      throw new Error('Expected phase 2 findings and audit summary');
    }

    expect(helperFinding.category).toBe('naming_intent_drift');
    expect(helperFinding.checkId).toBe('AMBIGUOUS_HELPER_NAME');
    expect(helperFinding.evidenceDetails?.helperDomain).toBe('input_boolean');
    expect(helperFinding.recommendation?.action).toContain('Rename the helper');

    expect(hotspotFinding.category).toBe('conflict_overlap');
    expect(hotspotFinding.checkId).toBe('ENTITY_OWNERSHIP_HOTSPOT');
    expect(hotspotFinding.relatedFindingIds).toContain(
      'highly_coupled_automation:automation.evening_routine',
    );

    expect(unusedHelperFinding.category).toBe('dead_legacy_objects');
    expect(unusedHelperFinding.evidenceDetails?.helperId).toBe(
      'input_boolean.night_toggle',
    );
    expect(unusedSceneFinding.evidenceDetails?.sceneId).toBe(
      'scene.legacy_accent',
    );
    expect(unusedScriptFinding.evidenceDetails?.scriptId).toBe(
      'script.legacy_shutdown',
    );

    expect(scan.audit.ownershipHotspotFindingIds).toEqual([
      'entity_ownership_hotspot:light.kitchen_main',
    ]);
    expect(scan.audit.ownershipHotspots[0]?.entityId).toBe(
      'light.kitchen_main',
    );
    expect(scan.audit.ownershipHotspots[0]?.writerIds).toEqual(
      expect.arrayContaining([
        'automation.evening_routine',
        'automation.kitchen_presence',
        'automation.kitchen_override',
        'scene.kitchen_evening',
        'script.kitchen_boost',
      ]),
    );
    expect(scan.audit.cleanupCandidateIds).toEqual(
      expect.arrayContaining([
        'unused_helper:input_boolean.night_toggle',
        'unused_scene:scene.legacy_accent',
        'unused_script:script.legacy_shutdown',
      ]),
    );
    expect(scan.audit.objectCounts).toMatchObject({
      configModules: 1,
      helpers: 2,
      scenes: 2,
      scripts: 2,
      templates: 1,
    });
    expect(scan.audit.scores.clarity).toEqual(expect.any(Number));
    expect(scan.audit.scores.correctness).toEqual(expect.any(Number));
    expect(scan.audit.scores.maintainability).toEqual(expect.any(Number));
  });
});
