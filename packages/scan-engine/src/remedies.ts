import type {
  AssistantKind,
  Finding,
  FindingContext,
  FindingAdvisory,
  FixAction,
  FixArtifact,
  FixCommand,
  FixPreviewInput,
  FixRequiredInput,
  InventoryGraph,
} from '@ha-repair/contracts';
import {getEntity, getEntityLabel} from './shared';

type AssistantExposureRequiredInput = Extract<
  FixRequiredInput,
  {field: 'assistant_exposures'}
>;
type NameRequiredInput = Extract<FixRequiredInput, {field: 'name'}>;

function formatScalar(value: string | null | undefined): string {
  return value === null || value === undefined ? 'null' : `"${value}"`;
}

function createDiffArtifact(
  actionId: string,
  lines: string[],
  label: string,
  path?: string,
): FixArtifact {
  return {
    content: lines.join('\n'),
    id: `${actionId}:diff`,
    kind: 'text_diff',
    label,
    ...(path ? {path} : {}),
  };
}

function createFindingContext(finding: Finding): FindingContext {
  return {
    ...(finding.category ? {category: finding.category} : {}),
    ...(finding.confidence === undefined
      ? {}
      : {confidence: finding.confidence}),
    evidence: finding.evidence,
    ...(finding.recommendation ? {recommendation: finding.recommendation} : {}),
    ...(finding.relatedFindingIds
      ? {relatedFindingIds: finding.relatedFindingIds}
      : {}),
    ...(finding.summary ? {summary: finding.summary} : {}),
    ...(finding.whyItMatters ? {whyItMatters: finding.whyItMatters} : {}),
  };
}

function createNameRecommendation(
  entity: NonNullable<ReturnType<typeof getEntity>>,
): string {
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
    findingContext: createFindingContext(finding),
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
    executionMode: 'websocket_command',
    findingId: finding.id,
    findingContext: createFindingContext(finding),
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
    executionMode: 'websocket_command',
    findingId: finding.id,
    findingContext: createFindingContext(finding),
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
    executionMode: 'websocket_command',
    findingId: finding.id,
    findingContext: createFindingContext(finding),
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
    if (finding.kind === 'assistant_context_bloat') {
      return [createAssistantExposureAction(inventory, finding, indexedInputs)];
    }

    if (finding.kind === 'duplicate_name') {
      return [createDuplicateNameAction(inventory, finding, indexedInputs)];
    }

    if (finding.kind === 'stale_entity') {
      return [createStaleEntityAction(inventory, finding)];
    }

    return [];
  });
}

function createGenericAdvisory(input: {
  finding: Finding;
  inventory: InventoryGraph;
  rationale: string;
  steps: string[];
  summary: string;
  warnings: string[];
}): FindingAdvisory {
  return {
    findingId: input.finding.id,
    findingContext: createFindingContext(input.finding),
    id: `advisory:${input.finding.id}`,
    rationale: input.rationale,
    steps: input.steps,
    summary: input.summary,
    targets: createFindingTargets(input.inventory, input.finding),
    title: `Manual review required for ${input.finding.title}`,
    warnings: input.warnings,
  };
}

function createOrphanedEntityDeviceAdvisory(
  inventory: InventoryGraph,
  finding: Finding,
): FindingAdvisory {
  const entityId = finding.objectIds[0]!;
  const missingDeviceId = finding.objectIds[1] ?? null;

  return {
    findingId: finding.id,
    findingContext: createFindingContext(finding),
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
  };
}

type AdvisoryConfig = Omit<
  FindingAdvisory,
  'findingContext' | 'findingId' | 'id' | 'targets' | 'title'
>;

const advisoryConfigs: Partial<Record<Finding['kind'], AdvisoryConfig>> = {
  ambiguous_helper_name: {
    rationale:
      'Helper renaming is advisory because the correct label depends on operator vocabulary, room naming, and automation intent.',
    steps: [
      'Review what the helper actually represents or gates.',
      'Rename it with room, role, or intent context.',
      'Rerun the scan to verify the ambiguity warning clears.',
    ],
    summary:
      'Rename the helper to include useful room or behavior context, then rerun the scan.',
    warnings: [
      'Renaming the wrong helper can create churn in dashboards, automations, or documentation that already references the old label.',
    ],
  },
  automation_disabled_dependency: {
    rationale:
      'Disabled dependency repair is advisory because only the operator can decide whether the entity should be re-enabled or whether the automation should stop depending on it.',
    steps: [
      'Inspect the automation references and confirm the disabled entity is still part of the intended behavior.',
      'Either re-enable the entity or replace/remove the dependency from the automation.',
      'Rerun the scan to confirm the disabled dependency warning clears.',
    ],
    summary:
      'Review the automation dependency list and either re-enable or remove the disabled entity references.',
    warnings: [
      'Re-enabling or replacing the wrong dependency can change live behavior or reintroduce entities the operator intentionally disabled.',
    ],
  },
  automation_invalid_target: {
    rationale:
      'Automation target repair is advisory because the correct replacement entity must be chosen in Home Assistant or config YAML.',
    steps: [
      'Open the automation definition or YAML source.',
      'Repair or remove missing entity references.',
      'Rerun the scan to confirm the invalid target warning clears.',
    ],
    summary:
      'Review the automation target list and repair or remove the missing entity references.',
    warnings: [
      'Repairing the wrong automation target can silently change live behavior or stop the automation from working.',
    ],
  },
  dangling_label_reference: {
    rationale:
      'Label cleanup is advisory because Home Assistant label usage often reflects operator-specific organization and automations.',
    steps: [
      'Confirm the label still exists or should exist.',
      'Repair the label assignment on the affected object.',
      'Rerun the scan to verify the label hygiene warning clears.',
    ],
    summary:
      'Review whether the missing label should be recreated or removed from the affected object.',
    warnings: [
      'Removing or renaming the wrong label can break dashboards and views that rely on custom grouping.',
    ],
  },
  entity_ownership_hotspot: {
    rationale:
      'Writer consolidation is advisory because overlapping automations and scenes usually reflect operator intent that must be reviewed, not auto-merged.',
    steps: [
      'Inspect the automations and scenes targeting the entity.',
      'Decide whether the overlap is intentional or should be simplified.',
      'Rerun the scan to confirm the hotspot shrinks after manual changes.',
    ],
    summary:
      'Review whether fewer writers should target the entity, then rerun the scan.',
    warnings: [
      'Removing or restructuring the wrong writer can change live entity behavior in ways that are hard to notice immediately.',
    ],
  },
  highly_coupled_automation: {
    rationale:
      'Automation splitting is advisory because only the operator can confirm which actions belong together and which should become separate intent-specific flows.',
    steps: [
      'Inspect the automation responsibilities and target list.',
      'Split unrelated responsibilities into smaller automations or scripts where helpful.',
      'Rerun the scan to verify the coupling warning is reduced.',
    ],
    summary:
      'Review whether the automation should be split or refactored into narrower pieces.',
    warnings: [
      'Breaking apart the wrong automation can change sequencing, timing, or shared conditions that current behavior depends on.',
    ],
  },
  likely_conflicting_controls: {
    rationale:
      'Conflict resolution is advisory because only the operator can decide which writer should win, how contexts should be separated, or whether the overlap is intentional.',
    steps: [
      'Inspect the writers targeting the same entities.',
      'Adjust gates, timing, or ownership so the writers do not fight each other.',
      'Rerun the scan to confirm the conflict candidate is reduced.',
    ],
    summary:
      'Review the competing writers and separate or sequence them so they stop issuing opposing control patterns.',
    warnings: [
      'Changing the wrong automation, script, or scene can alter live behavior in ways that are difficult to spot immediately.',
    ],
  },
  missing_area_assignment: {
    rationale:
      'Area coverage requires operator judgement because the correct room assignment depends on physical placement and dashboard intent.',
    steps: [
      'Review where the entity is physically located.',
      'Assign an area on the entity or device in Home Assistant.',
      'Rerun the scan to verify the coverage warning clears.',
    ],
    summary:
      'Assign the entity or its backing device to an area, then rerun the scan.',
    warnings: [
      'Applying the wrong area can distort dashboards, floor plans, and assistant room targeting.',
    ],
  },
  missing_floor_assignment: {
    rationale:
      'Floor coverage needs operator judgement because the right level assignment depends on the home layout, multi-story boundaries, and how the entity is surfaced in dashboards.',
    steps: [
      'Review which floor the entity belongs to physically.',
      'Assign a floor on the entity or device in Home Assistant.',
      'Rerun the scan to verify the floor coverage warning clears.',
    ],
    summary:
      'Assign the entity or its backing device to a floor, then rerun the scan.',
    warnings: [
      'Applying the wrong floor can distort floor plans, dashboard grouping, and voice targeting across levels.',
    ],
  },
  monolithic_config_file: {
    rationale:
      'Config-file splitting is advisory because only the operator can choose boundaries that match their file layout, includes, and maintenance preferences.',
    steps: [
      'Inspect the large config file and identify unrelated concerns living together.',
      'Split or reorganize the file where the boundaries are clear and low-risk.',
      'Rerun the scan to verify the structural smell is reduced.',
    ],
    summary:
      'Review whether the large config file should be split by intent, room, or object type.',
    warnings: [
      'Moving the wrong sections can break include structure or make future debugging harder instead of easier.',
    ],
  },
  orphan_config_module: {
    rationale:
      'Removing an apparently empty config file is advisory because some files are retained intentionally as placeholders, comments, or operator notes.',
    steps: [
      'Open the config file and confirm it no longer contributes live Home Assistant objects.',
      'Remove, archive, or consolidate it only if it is truly obsolete.',
      'Rerun the scan to confirm the orphan config module finding clears.',
    ],
    summary:
      'Review whether the config module is obsolete before removing or archiving it.',
    warnings: [
      'Deleting the wrong file can remove comments, operator notes, or future include targets that the current deterministic scan does not model.',
    ],
  },
  scene_invalid_target: {
    rationale:
      'Scene target repair is advisory because scene membership depends on operator intent and live device state.',
    steps: [
      'Open the scene definition or YAML source.',
      'Repair or remove missing entity references.',
      'Rerun the scan to confirm the invalid scene target warning clears.',
    ],
    summary:
      'Review the scene target list and repair or remove missing entity references.',
    warnings: [
      'Repairing the wrong scene target can change what a scene controls when it is activated.',
    ],
  },
  script_invalid_target: {
    rationale:
      'Script target repair is advisory because only the operator can confirm which live entities the script should still control.',
    steps: [
      'Open the script definition or YAML source.',
      'Repair or remove missing entity references.',
      'Rerun the scan to confirm the invalid script target warning clears.',
    ],
    summary:
      'Review the script target list and repair or remove missing entity references.',
    warnings: [
      'Repairing the wrong script target can change downstream automations and any manual routines that call the script.',
    ],
  },
  template_missing_reference: {
    rationale:
      'Template repair is advisory because the correct replacement entities, helpers, or scripts depend on operator intent and YAML context.',
    steps: [
      'Open the template source object or YAML file.',
      'Replace or remove missing entity, helper, scene, or script references.',
      'Rerun the scan to confirm the broken template reference clears.',
    ],
    summary:
      'Review the template source and repair or remove the missing references.',
    warnings: [
      'Repairing the wrong template reference can change runtime conditions, templated sensors, or downstream automation logic.',
    ],
  },
  template_no_unknown_handling: {
    rationale:
      'Template hardening is advisory because the safest fallback behavior depends on the intended semantics of the template and the surrounding YAML.',
    steps: [
      'Open the template source and inspect each direct state or attribute access.',
      'Replace brittle direct access with guarded helper calls or explicit fallback defaults.',
      'Rerun the scan to confirm the template no longer relies on unguarded unknown/unavailable values.',
    ],
    summary:
      'Review the template and add explicit unknown/unavailable handling around direct state access.',
    warnings: [
      'Changing the wrong fallback path can alter conditions, sensor output, or automation branching in subtle ways.',
    ],
  },
  unused_helper: {
    rationale:
      'Unused-helper cleanup is advisory because some helpers are still used manually or through dashboards that the current scan cannot fully observe.',
    steps: [
      'Confirm whether the helper still has manual or dashboard-driven use.',
      'Remove or archive it only if it is truly dead.',
      'Rerun the scan to confirm the cleanup candidate clears.',
    ],
    summary: 'Review whether the helper is still needed before removing it.',
    warnings: [
      'Removing the wrong helper can break hidden dashboard controls, manual routines, or indirect automation paths.',
    ],
  },
  unused_scene: {
    rationale:
      'Unused-scene cleanup is advisory because some scenes are still triggered manually or from dashboards that the current scan cannot observe.',
    steps: [
      'Confirm whether the scene still has manual or dashboard-driven use.',
      'Remove or archive it only if it is truly dead.',
      'Rerun the scan to confirm the cleanup candidate clears.',
    ],
    summary: 'Review whether the scene is still needed before removing it.',
    warnings: [
      'Removing the wrong scene can break manual household workflows or dashboard shortcuts that are not represented in the current scan graph.',
    ],
  },
  unused_script: {
    rationale:
      'Unused-script cleanup is advisory because some scripts are still called manually or by integrations that the current scan cannot fully observe.',
    steps: [
      'Confirm whether the script still has manual, dashboard, or hidden integration callers.',
      'Remove or archive it only if it is truly dead.',
      'Rerun the scan to confirm the cleanup candidate clears.',
    ],
    summary: 'Review whether the script is still needed before removing it.',
    warnings: [
      'Removing the wrong script can quietly break downstream routines that are not fully visible in the current deterministic scan.',
    ],
  },
};

function getAdvisoryConfig(kind: Finding['kind']): AdvisoryConfig | undefined {
  return kind in advisoryConfigs ? advisoryConfigs[kind] : undefined;
}

export function createFindingAdvisories(
  inventory: InventoryGraph,
  findings: Finding[],
): FindingAdvisory[] {
  return findings.flatMap((finding) => {
    if (finding.kind === 'orphaned_entity_device') {
      return [createOrphanedEntityDeviceAdvisory(inventory, finding)];
    }

    if (finding.kind === 'shared_label_observation') {
      return [createSharedLabelObservationAdvisory(inventory, finding)];
    }

    const advisoryConfig = getAdvisoryConfig(finding.kind);

    return advisoryConfig
      ? [
          createGenericAdvisory({
            ...advisoryConfig,
            finding,
            inventory,
          }),
        ]
      : [];
  });
}
