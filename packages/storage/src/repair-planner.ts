import {
  getFindingDefinition,
  type CapabilitySet,
  type Finding,
  type FindingAdvisory,
  type FindingContext,
  type FindingTreatment,
  type FixAction,
  type FixArtifact,
  type FixPreviewInput,
  type FixRequiredInput,
  type InventoryGraph,
} from '@ha-repair/contracts';
import {
  removeConfigNamedObject,
  renameConfigNamedObject,
  type ConfigSourceSnapshot,
} from '@ha-repair/ha-client';
import {
  createFindingAdvisories as createLegacyFindingAdvisories,
  createFixActions as createLegacyFixActions,
} from '@ha-repair/scan-engine';

export type RepairPlannerContext = {
  capabilities?: CapabilitySet;
  configSourceSnapshots?: ConfigSourceSnapshot[];
  inventory: InventoryGraph;
};

export type RepairPlan = {
  actions: FixAction[];
  advisories: FindingAdvisory[];
};

type ConfigObjectSource = {
  domain: string;
  objectKey?: string;
  sourcePath?: string;
};

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

  return finding.objectIds.map((objectId) => ({
    id: objectId,
    kind: objectId.includes('.')
      ? ('entity' as const)
      : ('config_module' as const),
    label: objectId,
  }));
}

function isCapabilitySupported(
  capability: CapabilitySet[keyof CapabilitySet] | undefined,
): boolean {
  return capability === undefined || capability.status === 'supported';
}

function indexConfigSourceSnapshots(
  snapshots: ConfigSourceSnapshot[] | undefined,
): Map<string, ConfigSourceSnapshot> {
  return new Map(
    (snapshots ?? []).map((snapshot) => [snapshot.path, snapshot]),
  );
}

function getNameInputValue(
  inputs: FixPreviewInput[],
  findingId: string,
  targetId: string,
): string | undefined {
  const input = inputs.find(
    (candidate) =>
      candidate.findingId === findingId &&
      candidate.targetId === targetId &&
      candidate.field === 'name',
  );

  if (!input || input.field !== 'name') {
    return undefined;
  }

  const trimmed = input.value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createUnifiedDiff(input: {
  after: string;
  before: string;
  path: string;
}): string {
  const normalize = (value: string) => value.replaceAll('\r\n', '\n');
  const toLines = (value: string) => {
    const normalized = normalize(value);

    if (normalized.length === 0) {
      return [] as string[];
    }

    return normalized.endsWith('\n')
      ? normalized.slice(0, -1).split('\n')
      : normalized.split('\n');
  };

  const beforeLines = toLines(input.before);
  const afterLines = toLines(input.after);
  let prefixLength = 0;

  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength + prefixLength < beforeLines.length &&
    suffixLength + prefixLength < afterLines.length &&
    beforeLines[beforeLines.length - suffixLength - 1] ===
      afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const removed = beforeLines.slice(
    prefixLength,
    beforeLines.length - suffixLength,
  );
  const added = afterLines.slice(
    prefixLength,
    afterLines.length - suffixLength,
  );
  const beforeCount = removed.length;
  const afterCount = added.length;
  const beforeStart = beforeCount === 0 ? prefixLength : prefixLength + 1;
  const afterStart = afterCount === 0 ? prefixLength : prefixLength + 1;
  const beforeLabel =
    beforeLines.length === 0 ? '/dev/null' : `a/${input.path}`;
  const afterLabel = afterLines.length === 0 ? '/dev/null' : `b/${input.path}`;

  return [
    `--- ${beforeLabel}`,
    `+++ ${afterLabel}`,
    `@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

function createYamlArtifact(input: {
  after: string;
  before: string;
  label: string;
  path: string;
}): FixArtifact {
  return {
    content: createUnifiedDiff(input),
    id: `artifact:${input.path}:${input.label.replaceAll(/\s+/gu, '-').toLowerCase()}`,
    kind: 'yaml_diff',
    label: input.label,
    path: input.path,
  };
}

function getEvidenceSourcePath(finding: Finding): string | undefined {
  const rawSourcePath = finding.evidenceDetails?.sourcePath;

  return typeof rawSourcePath === 'string' ? rawSourcePath : undefined;
}

function getHelper(inventory: InventoryGraph, helperId: string) {
  return inventory.helpers?.find(
    (candidate) => candidate.helperId === helperId,
  );
}

function getScript(inventory: InventoryGraph, scriptId: string) {
  return inventory.scripts?.find(
    (candidate) => candidate.scriptId === scriptId,
  );
}

function getConfigObjectSource(
  inventory: InventoryGraph,
  finding: Finding,
): ConfigObjectSource {
  switch (finding.kind) {
    case 'ambiguous_helper_name':
    case 'unused_helper': {
      const helperId = finding.objectIds[0];
      const helper = helperId ? getHelper(inventory, helperId) : undefined;
      const objectKey = helperId?.split('.').slice(1).join('.');
      const sourcePath = helper?.sourcePath ?? getEvidenceSourcePath(finding);

      return {
        domain: helperId?.split('.', 1)[0] ?? 'helper',
        ...(objectKey ? {objectKey} : {}),
        ...(sourcePath ? {sourcePath} : {}),
      };
    }

    case 'unused_script': {
      const scriptId = finding.objectIds[0];
      const script = scriptId ? getScript(inventory, scriptId) : undefined;
      const objectKey = scriptId?.split('.').slice(1).join('.');
      const sourcePath = script?.sourcePath ?? getEvidenceSourcePath(finding);

      return {
        domain: 'script',
        ...(objectKey ? {objectKey} : {}),
        ...(sourcePath ? {sourcePath} : {}),
      };
    }

    case 'orphan_config_module': {
      const sourcePath = finding.objectIds[0];

      return {
        domain: 'config',
        ...(sourcePath ? {sourcePath} : {}),
      };
    }

    default: {
      return {
        domain: 'config',
      };
    }
  }
}

function createUnavailableRepairAdvisory(input: {
  finding: Finding;
  inventory: InventoryGraph;
  reason: string;
  resolutionSteps: string[];
}): FindingAdvisory {
  return {
    findingId: input.finding.id,
    findingContext: createFindingContext(input.finding),
    id: `advisory:${input.finding.id}:unavailable`,
    rationale: `${input.finding.summary ?? input.finding.evidence} ${input.reason}`,
    steps: input.resolutionSteps,
    summary: `Repair plan unavailable for this saved scan because ${input.reason}`,
    targets: createFindingTargets(input.inventory, input.finding),
    title: `Manual review required for ${input.finding.title}`,
    warnings: [
      input.finding.whyItMatters ??
        getFindingDefinition(input.finding.kind).whyItMatters,
    ],
  };
}

function createConfigPatchAdvisoryForMissingContext(
  context: RepairPlannerContext,
  finding: Finding,
): FindingAdvisory {
  const source = getConfigObjectSource(context.inventory, finding);

  if (!isCapabilitySupported(context.capabilities?.configFiles)) {
    return createUnavailableRepairAdvisory({
      finding,
      inventory: context.inventory,
      reason:
        'the saved scan did not confirm read-only config-file support for this Home Assistant profile.',
      resolutionSteps: [
        'Run a new deep scan against a profile with readable config-file access.',
        'Reopen the saved scan and review the generated patch before dry-run apply.',
        'Keep this finding as manual review until the config path is available.',
      ],
    });
  }

  if (!source.sourcePath) {
    return createUnavailableRepairAdvisory({
      finding,
      inventory: context.inventory,
      reason:
        'the saved scan did not preserve a source file path for the affected Home Assistant object.',
      resolutionSteps: [
        'Run a new deep scan so config analysis can capture the object source path.',
        'Reopen the scan and rebuild the repair preview.',
        'Treat this finding as manual cleanup until the source path is available.',
      ],
    });
  }

  return createUnavailableRepairAdvisory({
    finding,
    inventory: context.inventory,
    reason: `the saved scan does not include a persisted YAML snapshot for ${source.sourcePath}.`,
    resolutionSteps: [
      'Run a new deep scan so the config source can be snapshotted with the scan.',
      'Reopen the saved scan and rebuild the repair preview.',
      'Keep this finding as manual review until a persisted config snapshot exists.',
    ],
  });
}

function createHelperRenameAction(input: {
  context: RepairPlannerContext;
  finding: Finding;
  inputs: FixPreviewInput[];
  snapshots: Map<string, ConfigSourceSnapshot>;
}): FixAction | FindingAdvisory {
  const helperId = input.finding.objectIds[0];
  const helper = helperId
    ? getHelper(input.context.inventory, helperId)
    : undefined;
  const source = getConfigObjectSource(input.context.inventory, input.finding);

  if (!helperId || !source.sourcePath || !source.objectKey) {
    return createConfigPatchAdvisoryForMissingContext(
      input.context,
      input.finding,
    );
  }

  const snapshot = input.snapshots.get(source.sourcePath);

  if (!snapshot) {
    return createConfigPatchAdvisoryForMissingContext(
      input.context,
      input.finding,
    );
  }

  try {
    renameConfigNamedObject({
      content: snapshot.content,
      domain: source.domain,
      nextName: helper?.name ?? helperId,
      objectKey: source.objectKey,
    });
  } catch {
    return createUnavailableRepairAdvisory({
      finding: input.finding,
      inventory: input.context.inventory,
      reason: `the stored YAML snapshot for ${source.sourcePath} could not be matched back to the exact helper definition.`,
      resolutionSteps: [
        `Open ${source.sourcePath} and review the helper definition manually.`,
        'Rename the helper there if the structure is still valid and intentional.',
        'Run a fresh deep scan after the manual change to confirm the ambiguity clears.',
      ],
    });
  }

  const providedValue = getNameInputValue(
    input.inputs,
    input.finding.id,
    helperId,
  );
  const requiredInput: Extract<FixRequiredInput, {field: 'name'}> = {
    currentValue: helper?.name ?? null,
    field: 'name',
    id: `input:${input.finding.id}:name`,
    ...(providedValue ? {providedValue} : {}),
    recommendedValue: helper ? `${helper.name} (${helper.helperId})` : helperId,
    summary: `Provide the exact helper name to write into ${source.sourcePath}.`,
    targetId: helperId,
  };

  const artifact =
    providedValue === undefined
      ? undefined
      : createYamlArtifact({
          after: renameConfigNamedObject({
            content: snapshot.content,
            domain: source.domain,
            nextName: providedValue,
            objectKey: source.objectKey,
          }).nextContent,
          before: snapshot.content,
          label: 'config-helper-rename.diff',
          path: source.sourcePath,
        });

  return {
    artifacts: artifact ? [artifact] : [],
    commands: [],
    executionMode: 'config_patch',
    findingId: input.finding.id,
    findingContext: createFindingContext(input.finding),
    id: `fix:${input.finding.id}:rename-helper`,
    intent:
      'Stage an exact YAML patch that rewrites the helper name in config without touching unrelated objects.',
    kind: 'rename_ambiguous_helper',
    rationale:
      input.finding.summary ??
      'Ambiguous helper names should be rewritten in config so dashboards and automations show clearer intent.',
    requiredInputs: [requiredInput],
    requiresConfirmation: true,
    risk: 'medium',
    steps: [
      'Review the helper label and choose a durable room or behavior-specific name.',
      'Inspect the YAML diff to confirm only the helper name changes.',
      'Run another scan after the manual or future applied change to confirm the ambiguity clears.',
    ],
    targets: createFindingTargets(input.context.inventory, input.finding),
    title: `Rename helper for ${input.finding.title}`,
    warnings: [
      'Renaming the wrong helper can create drift with dashboards, automations, or documentation that still reference the old label.',
    ],
  };
}

function createConfigRemovalAction(input: {
  context: RepairPlannerContext;
  finding: Finding;
  kind:
    | 'remove_orphan_config_module'
    | 'remove_unused_helper'
    | 'remove_unused_script';
  label: string;
  rationale: string;
  risk: FixAction['risk'];
  snapshots: Map<string, ConfigSourceSnapshot>;
  steps: string[];
  warnings: string[];
}): FixAction | FindingAdvisory {
  const source = getConfigObjectSource(input.context.inventory, input.finding);

  if (!source.sourcePath) {
    return createConfigPatchAdvisoryForMissingContext(
      input.context,
      input.finding,
    );
  }

  const snapshot = input.snapshots.get(source.sourcePath);

  if (!snapshot) {
    return createConfigPatchAdvisoryForMissingContext(
      input.context,
      input.finding,
    );
  }

  let nextContent: string;

  try {
    if (input.kind === 'remove_orphan_config_module') {
      nextContent = '';
    } else if (source.objectKey) {
      nextContent = removeConfigNamedObject({
        content: snapshot.content,
        domain: source.domain,
        objectKey: source.objectKey,
      }).nextContent;
    } else {
      return createConfigPatchAdvisoryForMissingContext(
        input.context,
        input.finding,
      );
    }
  } catch {
    return createUnavailableRepairAdvisory({
      finding: input.finding,
      inventory: input.context.inventory,
      reason: `the stored YAML snapshot for ${source.sourcePath} could not be matched back to the exact object targeted by this repair.`,
      resolutionSteps: [
        `Open ${source.sourcePath} and review the object manually.`,
        'Make the cleanup change there only if the structure is still valid and intentional.',
        'Run a fresh deep scan after the manual cleanup to confirm the finding clears.',
      ],
    });
  }

  return {
    artifacts: [
      createYamlArtifact({
        after: nextContent,
        before: snapshot.content,
        label: input.label,
        path: source.sourcePath,
      }),
    ],
    commands: [],
    executionMode: 'config_patch',
    findingId: input.finding.id,
    findingContext: createFindingContext(input.finding),
    id: `fix:${input.finding.id}:${input.kind}`,
    intent:
      'Stage a bounded YAML patch so the reviewed cleanup can be inspected before any later manual or live apply milestone.',
    kind: input.kind,
    rationale: input.rationale,
    requiredInputs: [],
    requiresConfirmation: true,
    risk: input.risk,
    steps: input.steps,
    targets: createFindingTargets(input.context.inventory, input.finding),
    title: `Review cleanup patch for ${input.finding.title}`,
    warnings: input.warnings,
  };
}

function createContextualRepair(input: {
  context: RepairPlannerContext;
  finding: Finding;
  inputs: FixPreviewInput[];
  snapshots: Map<string, ConfigSourceSnapshot>;
}): RepairPlan {
  switch (input.finding.kind) {
    case 'assistant_context_bloat': {
      if (
        !isCapabilitySupported(input.context.capabilities?.entityRegistry) ||
        !isCapabilitySupported(input.context.capabilities?.exposureControl)
      ) {
        return {
          actions: [],
          advisories: [
            createUnavailableRepairAdvisory({
              finding: input.finding,
              inventory: input.context.inventory,
              reason:
                'the saved scan did not confirm entity-registry exposure control support for this Home Assistant profile.',
              resolutionSteps: [
                'Test the Home Assistant profile again to confirm exposure control support.',
                'Run a new scan and rebuild the repair preview.',
                'Treat this finding as manual review until the capability is confirmed.',
              ],
            }),
          ],
        };
      }

      return {
        actions: createLegacyFixActions(
          input.context.inventory,
          [input.finding],
          input.inputs,
        ),
        advisories: [],
      };
    }

    case 'duplicate_name':
    case 'stale_entity': {
      if (!isCapabilitySupported(input.context.capabilities?.entityRegistry)) {
        return {
          actions: [],
          advisories: [
            createUnavailableRepairAdvisory({
              finding: input.finding,
              inventory: input.context.inventory,
              reason:
                'the saved scan did not confirm entity-registry update support for this Home Assistant profile.',
              resolutionSteps: [
                'Test the Home Assistant profile again to confirm entity registry support.',
                'Run a new scan and rebuild the repair preview.',
                'Treat this finding as manual review until the capability is confirmed.',
              ],
            }),
          ],
        };
      }

      return {
        actions: createLegacyFixActions(
          input.context.inventory,
          [input.finding],
          input.inputs,
        ),
        advisories: [],
      };
    }

    case 'ambiguous_helper_name': {
      const actionOrAdvisory = createHelperRenameAction(input);
      return 'commands' in actionOrAdvisory
        ? {actions: [actionOrAdvisory], advisories: []}
        : {actions: [], advisories: [actionOrAdvisory]};
    }

    case 'unused_helper': {
      const actionOrAdvisory = createConfigRemovalAction({
        context: input.context,
        finding: input.finding,
        kind: 'remove_unused_helper',
        label: 'config-unused-helper-removal.diff',
        rationale:
          input.finding.summary ??
          'Unused helper cleanup should be reviewed as an exact YAML deletion before removal.',
        risk: 'medium',
        snapshots: input.snapshots,
        steps: [
          'Confirm the helper has no manual, dashboard, or hidden integration use.',
          'Inspect the YAML diff to confirm only the unused helper definition is removed.',
          'Run another scan after the manual or future applied change to confirm the cleanup candidate clears.',
        ],
        warnings: [
          'Removing the wrong helper can break dashboards, manual toggles, or hidden routines that are not fully visible in the current scan.',
        ],
      });
      return 'commands' in actionOrAdvisory
        ? {actions: [actionOrAdvisory], advisories: []}
        : {actions: [], advisories: [actionOrAdvisory]};
    }

    case 'unused_script': {
      const actionOrAdvisory = createConfigRemovalAction({
        context: input.context,
        finding: input.finding,
        kind: 'remove_unused_script',
        label: 'config-unused-script-removal.diff',
        rationale:
          input.finding.summary ??
          'Unused script cleanup should be reviewed as an exact YAML deletion before removal.',
        risk: 'medium',
        snapshots: input.snapshots,
        steps: [
          'Confirm the script has no manual, dashboard, or hidden integration callers.',
          'Inspect the YAML diff to confirm only the unused script definition is removed.',
          'Run another scan after the manual or future applied change to confirm the cleanup candidate clears.',
        ],
        warnings: [
          'Removing the wrong script can quietly break routines that are not fully visible in the current deterministic scan.',
        ],
      });
      return 'commands' in actionOrAdvisory
        ? {actions: [actionOrAdvisory], advisories: []}
        : {actions: [], advisories: [actionOrAdvisory]};
    }

    case 'orphan_config_module': {
      const actionOrAdvisory = createConfigRemovalAction({
        context: input.context,
        finding: input.finding,
        kind: 'remove_orphan_config_module',
        label: 'config-module-removal.diff',
        rationale:
          input.finding.summary ??
          'Orphan config modules can be reviewed as exact file deletions when the saved scan preserves the raw YAML snapshot.',
        risk: 'low',
        snapshots: input.snapshots,
        steps: [
          'Confirm the file is truly obsolete or placeholder-only.',
          'Inspect the deletion diff to verify the repair only removes the orphan config module.',
          'Run another scan after the manual or future applied change to confirm the orphan file finding clears.',
        ],
        warnings: [
          'Deleting the wrong file can remove comments, operator notes, or future include targets that the current deterministic scan does not model.',
        ],
      });
      return 'commands' in actionOrAdvisory
        ? {actions: [actionOrAdvisory], advisories: []}
        : {actions: [], advisories: [actionOrAdvisory]};
    }

    default: {
      return {
        actions: [],
        advisories: createLegacyFindingAdvisories(input.context.inventory, [
          input.finding,
        ]),
      };
    }
  }
}

export function createRepairPlan(
  context: RepairPlannerContext,
  findings: Finding[],
  inputs: FixPreviewInput[] = [],
): RepairPlan {
  const snapshots = indexConfigSourceSnapshots(context.configSourceSnapshots);
  const repairPlan: RepairPlan = {
    actions: [],
    advisories: [],
  };

  for (const finding of findings) {
    const nextPlan = createContextualRepair({
      context,
      finding,
      inputs,
      snapshots,
    });

    repairPlan.actions.push(...nextPlan.actions);
    repairPlan.advisories.push(...nextPlan.advisories);
  }

  return repairPlan;
}

export function getFindingTreatment(
  context: RepairPlannerContext,
  finding: Finding,
): FindingTreatment {
  return createRepairPlan(context, [finding]).actions.length > 0
    ? 'actionable'
    : 'advisory';
}
