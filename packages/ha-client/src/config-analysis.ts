import {readdirSync, readFileSync, statSync, type Dirent} from 'node:fs';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import type {
  ConfigAnalysis,
  ConfigFileStatus,
  ConfigIssue,
  InventoryAutomation,
  InventoryScene,
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
  notes: ScanNote[];
  scenes: InventoryScene[];
};

type DirectoryIncludeMode =
  | 'dir_list'
  | 'dir_merge_list'
  | 'dir_merge_named'
  | 'dir_named';

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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeRelativePath(rootPath: string, targetPath: string): string {
  const nextPath = relative(rootPath, targetPath).replaceAll('\\', '/');

  return nextPath.length > 0 ? nextPath : 'configuration.yaml';
}

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`);
}

function extractEntityIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => extractEntityIds(item)));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (
      trimmed.length > 0 &&
      trimmed.includes('.') &&
      !trimmed.includes(' ') &&
      !trimmed.startsWith('/')
    ) {
      return [trimmed];
    }

    return [];
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
      entityIds.push(...extractEntityIds(nestedValue));
      continue;
    }

    if (key === 'target') {
      const targetRecord = asRecord(nestedValue);

      if (targetRecord?.entity_id) {
        entityIds.push(...extractEntityIds(targetRecord.entity_id));
      }
    }

    entityIds.push(...extractEntityIds(nestedValue));
  }

  return uniqueStrings(entityIds);
}

function extractAutomations(
  rootValue: unknown,
  rootFilePath: string,
): InventoryAutomation[] {
  const configuration = asRecord(rootValue);
  const automationValues = asList(configuration?.automation);

  return automationValues.flatMap((value, index) => {
    const record = asRecord(value);

    if (!record) {
      return [];
    }

    const name =
      typeof record.alias === 'string' && record.alias.trim().length > 0
        ? record.alias.trim()
        : `Automation ${index + 1}`;
    const automationId =
      typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id.trim()
        : `automation:${normalizeRelativePath(dirname(rootFilePath), rootFilePath)}:${index + 1}`;

    return [
      {
        automationId,
        name,
        sourcePath: normalizeRelativePath(dirname(rootFilePath), rootFilePath),
        targetEntityIds: extractEntityIds(record),
      },
    ];
  });
}

function extractScenes(
  rootValue: unknown,
  rootFilePath: string,
): InventoryScene[] {
  const configuration = asRecord(rootValue);
  const sceneValues = asList(configuration?.scene);

  return sceneValues.flatMap((value, index) => {
    const record = asRecord(value);

    if (!record) {
      return [];
    }

    const name =
      typeof record.name === 'string' && record.name.trim().length > 0
        ? record.name.trim()
        : `Scene ${index + 1}`;
    const sceneId =
      typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id.trim()
        : `scene:${normalizeRelativePath(dirname(rootFilePath), rootFilePath)}:${index + 1}`;

    return [
      {
        name,
        sceneId,
        sourcePath: normalizeRelativePath(dirname(rootFilePath), rootFilePath),
        targetEntityIds: extractEntityIds(record),
      },
    ];
  });
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

  const rootValue = loadFile(configurationPath);
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
    automations: rootValue
      ? extractAutomations(rootValue, configurationPath)
      : [],
    notes: issues.map((issue) => toScanNote(issue)),
    scenes: rootValue ? extractScenes(rootValue, configurationPath) : [],
  };
}
