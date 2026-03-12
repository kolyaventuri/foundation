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
      templateCount: 2,
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
    {
      entityIds: ['sensor.missing_temperature'],
      helperIds: [],
      parseValid: true,
      sceneIds: [],
      scriptIds: ['script.missing_cleanup'],
      sourceObjectId: 'automation.kitchen_presence',
      sourcePath: 'automations.yaml',
      sourceType: 'automation',
      templateId:
        'automation:automation.kitchen_presence:condition.0.value_template',
      templateText:
        "{{ states('sensor.missing_temperature') == 'on' and is_state('script.missing_cleanup', 'off') }}",
    },
  ],
};

const phaseTwoCompletionInventory: InventoryGraph = {
  areas: [
    {
      areaId: 'area.office',
      name: 'Office',
    },
  ],
  automations: [
    {
      automationId: 'automation.office_watch',
      name: 'Office Watch',
      references: {
        entityIds: ['light.office_disabled'],
        helperIds: [],
        sceneIds: [],
        scriptIds: ['script.office_script'],
        serviceIds: ['light.turn_on'],
      },
      sourcePath: 'automations.yaml',
      targetEntityIds: ['light.office_active', 'light.office_disabled'],
    },
  ],
  configAnalysis: {
    files: [
      {
        filePath: 'automations.yaml',
        status: 'loaded',
        summary: 'Loaded',
      },
      {
        filePath: 'legacy_empty.yaml',
        status: 'loaded',
        summary: 'Loaded',
      },
    ],
    issues: [],
    loadedFileCount: 2,
    rootPath: '/config',
  },
  configModules: [
    {
      automationCount: 12,
      filePath: 'automations.yaml',
      helperCount: 0,
      lineCount: 520,
      objectTypesPresent: ['automation', 'template'],
      sceneCount: 0,
      scriptCount: 0,
      templateCount: 1,
    },
    {
      automationCount: 0,
      filePath: 'legacy_empty.yaml',
      helperCount: 0,
      lineCount: 8,
      objectTypesPresent: [],
      sceneCount: 0,
      scriptCount: 0,
      templateCount: 0,
    },
  ],
  devices: [],
  entities: [
    {
      areaId: 'area.office',
      disabledBy: null,
      displayName: 'Office Active',
      entityId: 'light.office_active',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.office',
      disabledBy: 'user',
      displayName: 'Office Disabled',
      entityId: 'light.office_disabled',
      isStale: false,
      name: null,
    },
    {
      areaId: 'area.office',
      disabledBy: null,
      displayName: 'Office Temperature',
      entityId: 'sensor.office_temperature',
      isStale: false,
      name: null,
    },
  ],
  floors: [],
  helpers: [],
  labels: [],
  scenes: [],
  scripts: [
    {
      name: 'Office Script',
      references: {
        entityIds: [],
        helperIds: [],
        sceneIds: [],
        scriptIds: [],
        serviceIds: ['light.turn_on'],
      },
      scriptId: 'script.office_script',
      sourcePath: 'scripts.yaml',
      targetEntityIds: ['light.missing_task_light'],
    },
  ],
  source: 'mock',
  templates: [
    {
      entityIds: ['sensor.office_temperature'],
      helperIds: [],
      parseValid: true,
      sceneIds: [],
      scriptIds: [],
      sourceObjectId: 'automation.office_watch',
      sourcePath: 'automations.yaml',
      sourceType: 'automation',
      templateId: 'automation:automation.office_watch:action.0.variables.temp',
      templateText: '{{ states.sensor.office_temperature.state }}',
    },
  ],
};

function createGraphHeavyInventory(): InventoryGraph {
  const groupCount = 30;
  const helperCount = 40;
  const areas = Array.from({length: 15}, (_value, index) => ({
    areaId: `area.zone_${String(index + 1).padStart(2, '0')}`,
    name: `Zone ${String(index + 1).padStart(2, '0')}`,
  }));
  const sharedLights = Array.from({length: groupCount}, (_value, index) => ({
    areaId: areas[index % areas.length]!.areaId,
    disabledBy: null,
    displayName: `Zone ${String(index + 1).padStart(2, '0')} Main`,
    entityId: `light.zone_${String(index + 1).padStart(2, '0')}_main`,
    isStale: false,
    name: null,
  }));
  const templateSensors = Array.from({length: 25}, (_value, index) => ({
    areaId: areas[index % areas.length]!.areaId,
    disabledBy: null,
    displayName: `Zone ${String(index + 1).padStart(2, '0')} Temperature`,
    entityId: `sensor.zone_${String(index + 1).padStart(2, '0')}_temperature`,
    isStale: false,
    name: null,
  }));
  const extraEntities = Array.from({length: 145}, (_value, index) => ({
    areaId: areas[index % areas.length]!.areaId,
    disabledBy: null,
    displayName: `Extra Entity ${String(index + 1).padStart(3, '0')}`,
    entityId: `binary_sensor.extra_${String(index + 1).padStart(3, '0')}`,
    isStale: false,
    name: null,
  }));
  const helpers = Array.from({length: helperCount}, (_value, index) => ({
    helperId: `input_boolean.zone_${String(index + 1).padStart(2, '0')}_mode`,
    helperType: 'input_boolean' as const,
    name: `Zone ${String(index + 1).padStart(2, '0')} Mode`,
    sourcePath: 'helpers.yaml',
  }));
  const scenes = Array.from({length: groupCount}, (_value, index) => ({
    name: `Zone ${String(index + 1).padStart(2, '0')} Scene`,
    references: {
      entityIds: [],
      helperIds: [],
      sceneIds: [],
      scriptIds: [],
      serviceIds: [],
    },
    sceneId: `scene.zone_${String(index + 1).padStart(2, '0')}_scene`,
    sourcePath: 'scenes.yaml',
    targetEntityIds: [sharedLights[index]!.entityId],
  }));
  const scripts = Array.from({length: groupCount}, (_value, index) => ({
    name: `Zone ${String(index + 1).padStart(2, '0')} Script`,
    references: {
      entityIds: [],
      helperIds: [helpers[index]!.helperId],
      sceneIds: [scenes[index]!.sceneId],
      scriptIds: [],
      serviceIds: ['scene.turn_on'],
    },
    scriptId: `script.zone_${String(index + 1).padStart(2, '0')}_script`,
    sourcePath: 'scripts.yaml',
    targetEntityIds: [sharedLights[index]!.entityId],
  }));
  const automations = Array.from({length: groupCount}, (_value, groupIndex) => {
    const prefix = `zone_${String(groupIndex + 1).padStart(2, '0')}`;
    const targetEntityId = sharedLights[groupIndex]!.entityId;
    const helperId = helpers[groupIndex]!.helperId;
    const scriptId = scripts[groupIndex]!.scriptId;

    return [
      {
        automationId: `automation.${prefix}_on_primary`,
        name: `Zone ${String(groupIndex + 1).padStart(2, '0')} On Primary`,
        references: {
          entityIds: [],
          helperIds: [helperId],
          sceneIds: [],
          scriptIds: [scriptId],
          serviceIds: ['light.turn_on'],
        },
        sourcePath: 'automations.yaml',
        targetEntityIds: [targetEntityId],
      },
      {
        automationId: `automation.${prefix}_on_backup`,
        name: `Zone ${String(groupIndex + 1).padStart(2, '0')} On Backup`,
        references: {
          entityIds: [],
          helperIds: [helperId],
          sceneIds: [],
          scriptIds: [],
          serviceIds: ['light.turn_on'],
        },
        sourcePath: 'automations.yaml',
        targetEntityIds: [targetEntityId],
      },
      {
        automationId: `automation.${prefix}_off_primary`,
        name: `Zone ${String(groupIndex + 1).padStart(2, '0')} Off Primary`,
        references: {
          entityIds: [],
          helperIds: [helperId],
          sceneIds: [],
          scriptIds: [],
          serviceIds: ['light.turn_off'],
        },
        sourcePath: 'automations.yaml',
        targetEntityIds: [targetEntityId],
      },
      {
        automationId: `automation.${prefix}_off_backup`,
        name: `Zone ${String(groupIndex + 1).padStart(2, '0')} Off Backup`,
        references: {
          entityIds: [],
          helperIds: [helperId],
          sceneIds: [],
          scriptIds: [],
          serviceIds: ['light.turn_off'],
        },
        sourcePath: 'automations.yaml',
        targetEntityIds: [targetEntityId],
      },
    ];
  }).flat();
  const templates = Array.from({length: 25}, (_value, index) => ({
    entityIds: [templateSensors[index]!.entityId],
    helperIds: index < 10 ? [helpers[groupCount + index]!.helperId] : [],
    parseValid: true,
    sceneIds: [],
    scriptIds: [],
    sourceObjectId: automations[index]!.automationId,
    sourcePath: 'templates.yaml',
    sourceType: 'automation' as const,
    templateId: `template:${String(index + 1).padStart(2, '0')}`,
    templateText: `{{ states('${templateSensors[index]!.entityId}') }}`,
  }));
  const configModules = Array.from({length: 15}, (_value, index) => ({
    automationCount: index < 12 ? 4 : 0,
    filePath: `packages/zone_${String(index + 1).padStart(2, '0')}.yaml`,
    helperCount: 1,
    lineCount: 80 + index,
    objectTypesPresent:
      index < 12
        ? ['automation', 'helper', 'scene', 'script', 'template']
        : ['helper'],
    sceneCount: index < 12 ? 1 : 0,
    scriptCount: index < 12 ? 1 : 0,
    templateCount: index < 12 ? 1 : 0,
  }));

  return {
    areas,
    automations,
    configAnalysis: {
      files: configModules.map((module) => ({
        filePath: module.filePath,
        status: 'loaded',
        summary: 'Loaded',
      })),
      issues: [],
      loadedFileCount: configModules.length,
      rootPath: '/config',
    },
    configModules,
    devices: [],
    entities: [...sharedLights, ...templateSensors, ...extraEntities],
    floors: [],
    helpers,
    labels: [],
    scenes,
    scripts,
    source: 'mock',
    templates,
  };
}

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
        'likely_conflicting_controls',
        'template_missing_reference',
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
    const conflictFinding = scan.findings.find(
      (finding) => finding.kind === 'likely_conflicting_controls',
    );
    const templateFinding = scan.findings.find(
      (finding) => finding.kind === 'template_missing_reference',
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
    expect(conflictFinding).toBeDefined();
    expect(templateFinding).toBeDefined();
    expect(unusedHelperFinding).toBeDefined();
    expect(unusedSceneFinding).toBeDefined();
    expect(unusedScriptFinding).toBeDefined();
    expect(scan.audit).toBeDefined();

    if (
      !helperFinding ||
      !hotspotFinding ||
      !conflictFinding ||
      !templateFinding ||
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

    expect(conflictFinding.category).toBe('conflict_overlap');
    expect(conflictFinding.checkId).toBe('LIKELY_CONFLICTING_CONTROLS');
    expect(conflictFinding.objectIds).toEqual(
      expect.arrayContaining([
        'automation.kitchen_presence',
        'automation.kitchen_override',
        'light.kitchen_main',
      ]),
    );

    expect(templateFinding.category).toBe('broken_references');
    expect(templateFinding.evidenceDetails?.missingEntityIds).toEqual([
      'sensor.missing_temperature',
    ]);
    expect(templateFinding.evidenceDetails?.missingScriptIds).toEqual([
      'script.missing_cleanup',
    ]);

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
    expect(scan.audit.conflictCandidateIds).toEqual(
      expect.arrayContaining([conflictFinding.id]),
    );
    expect(scan.audit.conflictHotspots).toHaveLength(1);
    expect(scan.audit.conflictHotspots[0]?.entityId).toBe('light.kitchen_main');
    expect(scan.audit.conflictHotspots[0]?.findingIds).toEqual([
      conflictFinding.id,
    ]);
    expect(scan.audit.conflictHotspots[0]?.writerIds).toEqual(
      expect.arrayContaining([
        'automation.kitchen_override',
        'automation.kitchen_presence',
      ]),
    );
    expect(scan.audit.intentClusters).toHaveLength(1);
    expect(scan.audit.intentClusters[0]?.objectIds).toEqual(
      expect.arrayContaining([
        'automation.kitchen_override',
        'automation.kitchen_presence',
        'scene.kitchen_evening',
        'script.kitchen_boost',
      ]),
    );
    expect(scan.audit.objectCounts).toMatchObject({
      configModules: 1,
      helpers: 2,
      scenes: 2,
      scripts: 2,
      templates: 2,
    });
    expect(scan.audit.scores.clarity).toEqual(expect.any(Number));
    expect(scan.audit.scores.correctness).toEqual(expect.any(Number));
    expect(scan.audit.scores.maintainability).toEqual(expect.any(Number));
  });

  it('adds the final deterministic phase 2 checks with structured metadata', () => {
    const scan = runScan(phaseTwoCompletionInventory);
    const scriptInvalidTarget = scan.findings.find(
      (finding) => finding.kind === 'script_invalid_target',
    );
    const disabledDependency = scan.findings.find(
      (finding) => finding.kind === 'automation_disabled_dependency',
    );
    const templateGuardFinding = scan.findings.find(
      (finding) => finding.kind === 'template_no_unknown_handling',
    );
    const orphanConfigModule = scan.findings.find(
      (finding) => finding.kind === 'orphan_config_module',
    );
    const monolithicConfigFile = scan.findings.find(
      (finding) => finding.kind === 'monolithic_config_file',
    );

    expect(scriptInvalidTarget).toMatchObject({
      category: 'broken_references',
      checkId: 'SCRIPT_MISSING_REFERENCE',
      id: 'script_invalid_target:script.office_script',
      severity: 'high',
    });
    expect(scriptInvalidTarget?.evidenceDetails).toMatchObject({
      missingTargetCount: 1,
      missingTargetIds: ['light.missing_task_light'],
      scriptId: 'script.office_script',
    });

    expect(disabledDependency).toMatchObject({
      category: 'broken_references',
      checkId: 'AUTOMATION_DISABLED_DEPENDENCY',
      id: 'automation_disabled_dependency:automation.office_watch',
      severity: 'high',
    });
    expect(disabledDependency?.evidenceDetails).toMatchObject({
      automationId: 'automation.office_watch',
      disabledEntityCount: 1,
      disabledEntityIds: ['light.office_disabled'],
      targetedDisabledEntityIds: ['light.office_disabled'],
    });

    expect(templateGuardFinding).toMatchObject({
      category: 'fragile_automation_patterns',
      checkId: 'TEMPLATE_NO_UNKNOWN_HANDLING',
      id: 'template_no_unknown_handling:automation:automation.office_watch:action.0.variables.temp',
      severity: 'medium',
    });
    expect(templateGuardFinding?.evidenceDetails).toMatchObject({
      directAccessCount: 1,
      directAccessPaths: ['states.sensor.office_temperature.state'],
      directEntityIds: ['sensor.office_temperature'],
    });

    expect(orphanConfigModule).toMatchObject({
      category: 'dead_legacy_objects',
      checkId: 'ORPHAN_CONFIG_MODULE',
      id: 'orphan_config_module:legacy_empty.yaml',
      severity: 'low',
    });
    expect(orphanConfigModule?.evidenceDetails).toMatchObject({
      filePath: 'legacy_empty.yaml',
      lineCount: 8,
    });

    expect(monolithicConfigFile).toMatchObject({
      category: 'configuration_smells',
      checkId: 'MONOLITHIC_CONFIG_FILE',
      id: 'monolithic_config_file:automations.yaml',
      severity: 'medium',
    });
    expect(monolithicConfigFile?.evidenceDetails).toMatchObject({
      extractedObjectCount: 13,
      filePath: 'automations.yaml',
      lineCount: 520,
    });
    expect(scan.audit?.cleanupCandidateIds).toEqual(
      expect.arrayContaining(['orphan_config_module:legacy_empty.yaml']),
    );
  });

  it('keeps graph-heavy conflict and clustering counts stable on larger inventories', () => {
    const scan = runScan(createGraphHeavyInventory());

    expect(scan.findings).toHaveLength(150);
    expect(
      scan.findings.filter(
        (finding) => finding.kind === 'entity_ownership_hotspot',
      ),
    ).toHaveLength(30);
    expect(
      scan.findings.filter(
        (finding) => finding.kind === 'likely_conflicting_controls',
      ),
    ).toHaveLength(120);
    expect(scan.audit?.conflictCandidateIds).toHaveLength(120);
    expect(scan.audit?.conflictHotspots).toHaveLength(30);
    expect(scan.audit?.intentClusters).toHaveLength(30);
    expect(scan.audit?.ownershipHotspotFindingIds).toHaveLength(30);
    expect(scan.audit?.objectCounts).toMatchObject({
      automations: 120,
      configModules: 15,
      entities: 200,
      helpers: 40,
      scenes: 30,
      scripts: 30,
      templates: 25,
    });
  });
});
