import {readdirSync, readFileSync, statSync, type Dirent} from 'node:fs';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import type {
  ConfigModule,
  ConfigAnalysis,
  ConfigFileStatus,
  ConfigIssue,
  InventoryAutomation,
  InventoryHelper,
  InventoryHelperType,
  InventoryReferenceSet,
  InventoryScene,
  InventoryScript,
  InventoryTemplate,
  ScanNote,
} from '@ha-repair/contracts';
import {parseDocument} from 'yaml';

type FileSystemLike = {
  readdirSync: typeof readdirSync;
  readFileSync: typeof readFileSync;
  statSync: typeof statSync;
};

type ConfigAnalysisResult = {
  analysis: ConfigAnalysis;
  automations: InventoryAutomation[];
  configModules: ConfigModule[];
  helpers: InventoryHelper[];
  notes: ScanNote[];
  scenes: InventoryScene[];
  scripts: InventoryScript[];
  templates: InventoryTemplate[];
};

type DirectoryIncludeMode =
  | 'dir_list'
  | 'dir_merge_list'
  | 'dir_merge_named'
  | 'dir_named';

const helperDomains = [
  'counter',
  'group',
  'input_boolean',
  'input_button',
  'input_datetime',
  'input_number',
  'input_select',
  'input_text',
  'timer',
] as const satisfies InventoryHelperType[];

function isYamlFile(entry: Dirent | string): boolean {
  const fileName = typeof entry === 'string' ? entry : entry.name;
  const extension = extname(fileName).toLowerCase();
  return extension === '.yaml' || extension === '.yml';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = asRecord(value);

  if (!record) {
    return [];
  }

  return Object.values(record);
}

function asEntries(value: unknown): Array<{key?: string; value: unknown}> {
  if (Array.isArray(value)) {
    const entries: Array<{key?: string; value: unknown}> = [];

    for (const entry of value) {
      entries.push({value: entry});
    }

    return entries;
  }

  const record = asRecord(value);

  if (!record) {
    return [];
  }

  return Object.entries(record).map(([key, entryValue]) => ({
    key,
    value: entryValue,
  }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function slugifyObjectIdSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
}

function createObjectId(
  domain: 'automation' | 'scene' | 'script',
  ...candidates: Array<string | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue;
    }

    const normalizedCandidate = candidate.trim();

    if (normalizedCandidate.startsWith(`${domain}.`)) {
      const objectId = slugifyObjectIdSegment(
        normalizedCandidate.slice(domain.length + 1),
      );

      if (objectId.length > 0) {
        return `${domain}.${objectId}`;
      }
    }

    const objectId = slugifyObjectIdSegment(normalizedCandidate);

    if (objectId.length > 0) {
      return `${domain}.${objectId}`;
    }
  }

  return undefined;
}

function createEmptyReferenceSet(): InventoryReferenceSet {
  return {
    entityIds: [],
    helperIds: [],
    sceneIds: [],
    scriptIds: [],
    serviceIds: [],
  };
}

function mergeReferenceSets(
  left: InventoryReferenceSet,
  right: InventoryReferenceSet,
): InventoryReferenceSet {
  return {
    entityIds: uniqueStrings([...left.entityIds, ...right.entityIds]),
    helperIds: uniqueStrings([...left.helperIds, ...right.helperIds]),
    sceneIds: uniqueStrings([...left.sceneIds, ...right.sceneIds]),
    scriptIds: uniqueStrings([...left.scriptIds, ...right.scriptIds]),
    serviceIds: uniqueStrings([...left.serviceIds, ...right.serviceIds]),
  };
}

function normalizeRelativePath(rootPath: string, targetPath: string): string {
  const nextPath = relative(rootPath, targetPath).replaceAll('\\', '/');

  return nextPath.length > 0 ? nextPath : 'configuration.yaml';
}

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`);
}

function classifyObjectId(objectId: string): keyof InventoryReferenceSet {
  const domain = objectId.split('.', 1)[0] ?? objectId;

  if (helperDomains.includes(domain as InventoryHelperType)) {
    return 'helperIds';
  }

  if (domain === 'scene') {
    return 'sceneIds';
  }

  if (domain === 'script') {
    return 'scriptIds';
  }

  return 'entityIds';
}

function getObjectIdMatches(value: string): string[] {
  return uniqueStrings(
    [...value.matchAll(/\b([a-z_]+)\.([a-z0-9_]+)\b/gu)].map(
      (match) => `${match[1]}.${match[2]}`,
    ),
  );
}

function addObjectIdReferences(
  references: InventoryReferenceSet,
  objectIds: string[],
): InventoryReferenceSet {
  const nextReferences = {
    ...references,
    entityIds: [...references.entityIds],
    helperIds: [...references.helperIds],
    sceneIds: [...references.sceneIds],
    scriptIds: [...references.scriptIds],
    serviceIds: [...references.serviceIds],
  };

  for (const objectId of objectIds) {
    const bucket = classifyObjectId(objectId);
    nextReferences[bucket].push(objectId);
  }

  return {
    entityIds: uniqueStrings(nextReferences.entityIds),
    helperIds: uniqueStrings(nextReferences.helperIds),
    sceneIds: uniqueStrings(nextReferences.sceneIds),
    scriptIds: uniqueStrings(nextReferences.scriptIds),
    serviceIds: uniqueStrings(nextReferences.serviceIds),
  };
}

function extractTargetEntityIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => extractTargetEntityIds(item)));
  }

  if (typeof value === 'string') {
    return uniqueStrings(
      getObjectIdMatches(value).filter(
        (objectId) => classifyObjectId(objectId) === 'entityIds',
      ),
    );
  }

  const record = asRecord(value);

  if (!record) {
    return [];
  }

  const entityIds: string[] = [];

  for (const [key, nestedValue] of Object.entries(record)) {
    if (key === 'entities') {
      const entityRecord = asRecord(nestedValue);

      if (entityRecord) {
        entityIds.push(...Object.keys(entityRecord));
      }
    }

    if (key === 'entity_id') {
      entityIds.push(...extractTargetEntityIds(nestedValue));
      continue;
    }

    if (key === 'target') {
      const targetRecord = asRecord(nestedValue);

      if (targetRecord?.entity_id) {
        entityIds.push(...extractTargetEntityIds(targetRecord.entity_id));
      }
    }

    if (key === 'service' || key === 'service_template') {
      continue;
    }

    entityIds.push(...extractTargetEntityIds(nestedValue));
  }

  return uniqueStrings(entityIds);
}

function extractReferences(
  value: unknown,
  currentKey?: string,
): InventoryReferenceSet {
  if (Array.isArray(value)) {
    let references = createEmptyReferenceSet();

    for (const entry of value) {
      references = mergeReferenceSets(
        references,
        extractReferences(entry, currentKey),
      );
    }

    return references;
  }

  if (typeof value === 'string') {
    if (currentKey === 'service') {
      return {
        ...createEmptyReferenceSet(),
        serviceIds:
          value.trim().length > 0
            ? [value.trim()]
            : createEmptyReferenceSet().serviceIds,
      };
    }

    return addObjectIdReferences(
      createEmptyReferenceSet(),
      getObjectIdMatches(value),
    );
  }

  const record = asRecord(value);

  if (!record) {
    return createEmptyReferenceSet();
  }

  let references = createEmptyReferenceSet();

  if (currentKey === 'entities') {
    references = addObjectIdReferences(references, Object.keys(record));
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    references = mergeReferenceSets(
      references,
      extractReferences(nestedValue, key),
    );
  }

  return references;
}

function createTemplateRecord(input: {
  sourceObjectId?: string;
  sourcePath: string;
  sourceType: InventoryTemplate['sourceType'];
  templateId: string;
  templateText: string;
}): InventoryTemplate {
  const references = extractReferences(input.templateText);

  return {
    entityIds: references.entityIds,
    helperIds: references.helperIds,
    parseValid: true,
    sceneIds: references.sceneIds,
    scriptIds: references.scriptIds,
    ...(input.sourceObjectId ? {sourceObjectId: input.sourceObjectId} : {}),
    sourcePath: input.sourcePath,
    sourceType: input.sourceType,
    templateId: input.templateId,
    templateText: input.templateText,
  };
}

function collectTemplates(input: {
  sourceObjectId?: string;
  sourcePath: string;
  sourceType: InventoryTemplate['sourceType'];
  value: unknown;
}): InventoryTemplate[] {
  const templates: InventoryTemplate[] = [];

  function visit(value: unknown, path: string[]): void {
    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        visit(entry, [...path, index.toString()]);
      }

      return;
    }

    if (typeof value === 'string') {
      if (value.includes('{{') || value.includes('{%')) {
        templates.push(
          createTemplateRecord({
            ...(input.sourceObjectId
              ? {sourceObjectId: input.sourceObjectId}
              : {}),
            sourcePath: input.sourcePath,
            sourceType: input.sourceType,
            templateId: `${input.sourceType}:${input.sourceObjectId ?? 'config'}:${path.join('.')}`,
            templateText: value,
          }),
        );
      }

      return;
    }

    const record = asRecord(value);

    if (!record) {
      return;
    }

    for (const [key, nestedValue] of Object.entries(record)) {
      visit(nestedValue, [...path, key]);
    }
  }

  visit(input.value, []);

  return templates;
}

function dedupeById<T extends {sourcePath?: string}>(
  entries: T[],
  getId: (entry: T) => string,
): T[] {
  const seenIds = new Set<string>();
  const deduped: T[] = [];

  for (const entry of entries) {
    const id = getId(entry);

    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    deduped.push(entry);
  }

  return deduped;
}

function extractAutomations(
  rootValue: unknown,
  rootPath: string,
  rootFilePath: string,
): InventoryAutomation[] {
  const configuration = asRecord(rootValue);
  const automationValues = asEntries(
    configuration?.automation ??
      (rootFilePath.toLowerCase().includes('automation')
        ? rootValue
        : undefined),
  );
  const sourcePath = normalizeRelativePath(rootPath, rootFilePath);

  return automationValues.flatMap(({value}, index) => {
    const record = asRecord(value);

    if (!record) {
      return [];
    }

    const name =
      typeof record.alias === 'string' && record.alias.trim().length > 0
        ? record.alias.trim()
        : `Automation ${index + 1}`;
    const automationId =
      createObjectId(
        'automation',
        typeof record.alias === 'string' ? record.alias : undefined,
        typeof record.id === 'string' ? record.id : undefined,
        `${sourcePath}_${index + 1}`,
      ) ?? `automation.${slugifyObjectIdSegment(`${sourcePath}_${index + 1}`)}`;

    return [
      {
        automationId,
        name,
        references: extractReferences(record),
        sourcePath,
        targetEntityIds: extractTargetEntityIds(record),
      },
    ];
  });
}

function extractScenes(
  rootValue: unknown,
  rootPath: string,
  rootFilePath: string,
): InventoryScene[] {
  const configuration = asRecord(rootValue);
  const sceneValues = asEntries(
    configuration?.scene ??
      (rootFilePath.toLowerCase().includes('scene') ? rootValue : undefined),
  );
  const sourcePath = normalizeRelativePath(rootPath, rootFilePath);

  return sceneValues.flatMap(({value}, index) => {
    const record = asRecord(value);

    if (!record) {
      return [];
    }

    const name =
      typeof record.name === 'string' && record.name.trim().length > 0
        ? record.name.trim()
        : `Scene ${index + 1}`;
    const sceneId =
      createObjectId(
        'scene',
        typeof record.name === 'string' ? record.name : undefined,
        typeof record.id === 'string' ? record.id : undefined,
        `${sourcePath}_${index + 1}`,
      ) ?? `scene.${slugifyObjectIdSegment(`${sourcePath}_${index + 1}`)}`;

    return [
      {
        name,
        references: extractReferences(record),
        sceneId,
        sourcePath,
        targetEntityIds: extractTargetEntityIds(record),
      },
    ];
  });
}

function extractScripts(
  rootValue: unknown,
  rootPath: string,
  rootFilePath: string,
): InventoryScript[] {
  const configuration = asRecord(rootValue);
  const scriptValues = asEntries(
    configuration?.script ??
      (rootFilePath.toLowerCase().includes('script') ? rootValue : undefined),
  );
  const sourcePath = normalizeRelativePath(rootPath, rootFilePath);

  return scriptValues.flatMap(({key, value}, index) => {
    const record = asRecord(value);

    if (!record) {
      return [];
    }

    const name =
      typeof record.alias === 'string' && record.alias.trim().length > 0
        ? record.alias.trim()
        : typeof key === 'string' && key.trim().length > 0
          ? key.trim()
          : `Script ${index + 1}`;
    const scriptId =
      createObjectId(
        'script',
        key,
        typeof record.alias === 'string' ? record.alias : undefined,
        typeof record.id === 'string' ? record.id : undefined,
        `${sourcePath}_${index + 1}`,
      ) ?? `script.${slugifyObjectIdSegment(`${sourcePath}_${index + 1}`)}`;

    return [
      {
        name,
        references: extractReferences(record),
        scriptId,
        sourcePath,
        targetEntityIds: extractTargetEntityIds(record),
      },
    ];
  });
}

function extractHelpers(
  rootValue: unknown,
  rootPath: string,
  rootFilePath: string,
): InventoryHelper[] {
  const configuration = asRecord(rootValue);
  const fileName = rootFilePath.toLowerCase();
  const sourcePath = normalizeRelativePath(rootPath, rootFilePath);
  const helpers: InventoryHelper[] = [];

  for (const helperType of helperDomains) {
    const helperValues =
      configuration?.[helperType] ??
      (fileName.includes(helperType) ? rootValue : undefined);

    for (const {key, value} of asEntries(helperValues)) {
      const record = asRecord(value);
      const helperKey =
        typeof key === 'string' && key.trim().length > 0
          ? key.trim()
          : typeof record?.id === 'string' && record.id.trim().length > 0
            ? record.id.trim()
            : undefined;

      if (!helperKey) {
        continue;
      }

      const name =
        typeof record?.name === 'string' && record.name.trim().length > 0
          ? record.name.trim()
          : helperKey;

      helpers.push({
        helperId: `${helperType}.${helperKey}`,
        helperType,
        name,
        sourcePath,
      });
    }
  }

  return helpers;
}

function inferConfigModuleKind(filePath: string, value: unknown): ConfigModule {
  const record = asRecord(value);
  const fileName = filePath.toLowerCase();
  const objectTypesPresent: string[] = [];

  const automationCount = record?.automation
    ? extractAutomations(value, dirname(filePath), filePath).length
    : fileName.includes('automation')
      ? extractAutomations({automation: value}, dirname(filePath), filePath)
          .length
      : 0;
  const sceneCount = record?.scene
    ? extractScenes(value, dirname(filePath), filePath).length
    : fileName.includes('scene')
      ? extractScenes({scene: value}, dirname(filePath), filePath).length
      : 0;
  const scriptCount = record?.script
    ? extractScripts(value, dirname(filePath), filePath).length
    : fileName.includes('script')
      ? extractScripts({script: value}, dirname(filePath), filePath).length
      : 0;
  const helperCount = extractHelpers(value, dirname(filePath), filePath).length;
  const templateCount = collectTemplates({
    sourcePath: filePath,
    sourceType: 'config',
    value,
  }).length;

  if (automationCount > 0) {
    objectTypesPresent.push('automation');
  }

  if (sceneCount > 0) {
    objectTypesPresent.push('scene');
  }

  if (scriptCount > 0) {
    objectTypesPresent.push('script');
  }

  if (helperCount > 0) {
    objectTypesPresent.push('helper');
  }

  if (templateCount > 0) {
    objectTypesPresent.push('template');
  }

  return {
    automationCount,
    filePath,
    helperCount,
    lineCount: 0,
    objectTypesPresent,
    sceneCount,
    scriptCount,
    templateCount,
  };
}

function toScanNote(issue: ConfigIssue): ScanNote {
  return {
    id: `config:${issue.code}:${issue.filePath}`,
    message: `${issue.filePath}: ${issue.message}`,
    scope: 'config',
    severity: issue.severity,
  };
}

export function analyzeConfigDirectory(
  rootPath: string,
  options: {
    fs?: FileSystemLike;
  } = {},
): ConfigAnalysisResult {
  const fileSystem = options.fs ?? {
    readdirSync,
    readFileSync,
    statSync,
  };
  const resolvedRoot = resolve(rootPath);
  const configurationPath = resolve(resolvedRoot, 'configuration.yaml');
  const fileStatuses = new Map<
    string,
    {status: ConfigFileStatus; summary: string}
  >();
  const issues: ConfigIssue[] = [];
  const fileLineCounts = new Map<string, number>();
  const loadedDocuments = new Map<string, unknown>();
  const activeLoads = new Set<string>();

  function recordFile(
    filePath: string,
    status: ConfigFileStatus,
    summary: string,
  ): void {
    fileStatuses.set(normalizeRelativePath(resolvedRoot, filePath), {
      status,
      summary,
    });
  }

  function recordIssue(
    filePath: string,
    code: ConfigIssue['code'],
    message: string,
    severity: ConfigIssue['severity'],
  ): void {
    issues.push({
      code,
      filePath: normalizeRelativePath(resolvedRoot, filePath),
      message,
      severity,
    });
  }

  function resolveReferencePath(currentFilePath: string, reference: string) {
    const nextPath = resolve(dirname(currentFilePath), reference);

    if (!isInsideRoot(resolvedRoot, nextPath)) {
      recordFile(
        nextPath,
        'skipped',
        'Skipped include outside configured root.',
      );
      recordIssue(
        nextPath,
        'include_outside_root',
        `Skipped include outside configured root: ${reference}`,
        'warning',
      );
      return undefined;
    }

    return nextPath;
  }

  // eslint-disable-next-line complexity
  function loadDirectory(
    currentFilePath: string,
    reference: string,
    mode: DirectoryIncludeMode,
  ): unknown {
    const nextDirectoryPath = resolveReferencePath(currentFilePath, reference);

    if (!nextDirectoryPath) {
      return mode === 'dir_list' || mode === 'dir_merge_list' ? [] : {};
    }

    try {
      const stats = fileSystem.statSync(nextDirectoryPath);

      if (!stats.isDirectory()) {
        return mode === 'dir_list' || mode === 'dir_merge_list' ? [] : {};
      }

      const entries = fileSystem
        .readdirSync(nextDirectoryPath, {
          withFileTypes: true,
        })
        .filter((entry) => entry.isFile() && isYamlFile(entry))
        .sort((left, right) => left.name.localeCompare(right.name));
      const values = entries.map((entry) => {
        const entryPath = resolve(nextDirectoryPath, entry.name);
        return {
          key: entry.name.replace(/\.(yaml|yml)$/iu, ''),
          value: loadFile(entryPath),
        };
      });

      switch (mode) {
        case 'dir_list': {
          const items: unknown[] = [];

          for (const entry of values) {
            items.push(entry.value);
          }

          return items;
        }

        case 'dir_merge_list': {
          const items: unknown[] = [];

          for (const entry of values) {
            if (Array.isArray(entry.value)) {
              // eslint-disable-next-line max-depth
              for (const nestedValue of entry.value as unknown[]) {
                items.push(nestedValue);
              }

              continue;
            }

            items.push(entry.value);
          }

          return items;
        }

        case 'dir_named': {
          return Object.fromEntries(
            values.map((entry) => [entry.key, entry.value] as const),
          );
        }

        case 'dir_merge_named': {
          const mergedEntries: Record<string, unknown> = {};

          for (const entry of values) {
            const record = asRecord(entry.value);

            if (record) {
              Object.assign(mergedEntries, record);
            }
          }

          return mergedEntries;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const severity =
        (error as NodeJS.ErrnoException)?.code === 'EACCES'
          ? 'error'
          : 'warning';

      recordFile(nextDirectoryPath, 'permission_denied', message);
      recordIssue(nextDirectoryPath, 'permission_denied', message, severity);

      return mode === 'dir_list' || mode === 'dir_merge_list' ? [] : {};
    }
  }

  function createCustomTags(currentFilePath: string) {
    return [
      {
        default: false,
        resolve(value: string) {
          const nextFilePath = resolveReferencePath(currentFilePath, value);
          return nextFilePath ? loadFile(nextFilePath) : null;
        },
        tag: '!include',
      },
      {
        default: false,
        resolve(value: string) {
          return loadDirectory(currentFilePath, value, 'dir_list');
        },
        tag: '!include_dir_list',
      },
      {
        default: false,
        resolve(value: string) {
          return loadDirectory(currentFilePath, value, 'dir_merge_list');
        },
        tag: '!include_dir_merge_list',
      },
      {
        default: false,
        resolve(value: string) {
          return loadDirectory(currentFilePath, value, 'dir_named');
        },
        tag: '!include_dir_named',
      },
      {
        default: false,
        resolve(value: string) {
          return loadDirectory(currentFilePath, value, 'dir_merge_named');
        },
        tag: '!include_dir_merge_named',
      },
    ];
  }

  function loadFile(filePath: string): unknown {
    if (loadedDocuments.has(filePath)) {
      return loadedDocuments.get(filePath);
    }

    if (activeLoads.has(filePath)) {
      return null;
    }

    activeLoads.add(filePath);

    try {
      const raw = fileSystem.readFileSync(filePath, 'utf8');
      fileLineCounts.set(filePath, raw.split(/\r?\n/u).length);
      const document = parseDocument(raw, {
        customTags: createCustomTags(filePath),
        prettyErrors: true,
        strict: false,
      });

      if (document.errors.length > 0) {
        const message = document.errors
          .map((error) => error.message)
          .join('; ');
        recordFile(filePath, 'parse_error', message);
        recordIssue(filePath, 'parse_error', message, 'error');
        return null;
      }

      const value = document.toJS({maxAliasCount: 100}) as unknown;

      loadedDocuments.set(filePath, value);
      recordFile(filePath, 'loaded', 'Loaded configuration file.');

      return value;
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (errnoError.code === 'ENOENT') {
        recordFile(filePath, 'missing', message);
        recordIssue(filePath, 'missing_file', message, 'warning');
        return null;
      }

      if (errnoError.code === 'EACCES') {
        recordFile(filePath, 'permission_denied', message);
        recordIssue(filePath, 'permission_denied', message, 'error');
        return null;
      }

      recordFile(filePath, 'parse_error', message);
      recordIssue(filePath, 'parse_error', message, 'error');
      return null;
    } finally {
      activeLoads.delete(filePath);
    }
  }

  loadFile(configurationPath);
  const loadedEntries = [...loadedDocuments.entries()];
  const automations = dedupeById(
    loadedEntries.flatMap(([filePath, value]) =>
      extractAutomations(value, resolvedRoot, filePath),
    ),
    (automation) => automation.automationId,
  );
  const scenes = dedupeById(
    loadedEntries.flatMap(([filePath, value]) =>
      extractScenes(value, resolvedRoot, filePath),
    ),
    (scene) => scene.sceneId,
  );
  const scripts = dedupeById(
    loadedEntries.flatMap(([filePath, value]) =>
      extractScripts(value, resolvedRoot, filePath),
    ),
    (script) => script.scriptId,
  );
  const helpers = dedupeById(
    loadedEntries.flatMap(([filePath, value]) =>
      extractHelpers(value, resolvedRoot, filePath),
    ),
    (helper) => helper.helperId,
  );
  const templates = loadedEntries.flatMap(([filePath, value]) =>
    collectTemplates({
      sourcePath: normalizeRelativePath(resolvedRoot, filePath),
      sourceType: 'config',
      value,
    }),
  );
  const configModules = loadedEntries
    .map(([filePath, value]) => {
      const module = inferConfigModuleKind(
        normalizeRelativePath(resolvedRoot, filePath),
        value,
      );

      return {
        ...module,
        lineCount: fileLineCounts.get(filePath) ?? 0,
      };
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  const analysis: ConfigAnalysis = {
    files: [...fileStatuses.entries()]
      .map(([filePath, entry]) => ({
        filePath,
        status: entry.status,
        summary: entry.summary,
      }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath)),
    issues,
    loadedFileCount: [...fileStatuses.values()].filter(
      (entry) => entry.status === 'loaded',
    ).length,
    rootPath: resolvedRoot,
  };

  return {
    analysis,
    automations,
    configModules,
    helpers,
    notes: issues.map((issue) => toScanNote(issue)),
    scenes,
    scripts,
    templates,
  };
}
