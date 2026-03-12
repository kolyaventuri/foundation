import process from 'node:process';
import {Command, Option} from 'commander';
import {
  type AssistantKind,
  createFrameworkSummary,
  type ConnectionProfile,
  type Finding,
  type FixPreviewInput,
  getFindingDefinition,
} from '@ha-repair/contracts';
import {listProviderDescriptors} from '@ha-repair/llm';
import {
  createRepairService,
  renderScanExportMarkdown,
  RepairServiceError,
  type RepairService,
} from '@ha-repair/storage';

type GlobalOptions = {
  dbPath?: string;
};

type FindingsOutput = {
  findings: Finding[];
  scanId: string;
};

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function reportError(error: unknown) {
  if (error instanceof RepairServiceError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error('Unknown command error');
  process.exitCode = 1;
}

function getGlobalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

async function withService<T>(
  command: Command,
  callback: (service: RepairService) => Promise<T>,
): Promise<T> {
  const globalOptions = getGlobalOptions(command);
  const service = await createRepairService({
    ...(globalOptions.dbPath ? {dbPath: globalOptions.dbPath} : {}),
  });

  try {
    return await callback(service);
  } finally {
    await service.close();
  }
}

function buildInlineProfile(options: {
  configPath?: string;
  token: string;
  url: string;
}): ConnectionProfile {
  return {
    baseUrl: options.url,
    name: 'cli',
    token: options.token,
    ...(options.configPath ? {configPath: options.configPath} : {}),
  };
}

function collectRepeatedValue(
  value: string,
  previous: string[] = [],
): string[] {
  return [...previous, value];
}

function parseEntityNameInput(value: string): {
  targetId: string;
  value: string;
} {
  const separatorIndex = value.indexOf('=');

  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new RepairServiceError(
      'invalid_preview_input',
      400,
      'Pass --name as entity_id=value.',
    );
  }

  return {
    targetId: value.slice(0, separatorIndex).trim(),
    value: value.slice(separatorIndex + 1).trim(),
  };
}

function parseAssistantExposureInput(value: string): {
  targetId: string;
  value: AssistantKind[];
} {
  const separatorIndex = value.indexOf('=');

  if (separatorIndex <= 0) {
    throw new RepairServiceError(
      'invalid_preview_input',
      400,
      'Pass --assistant-exposures as entity_id=assist,alexa or entity_id= for none.',
    );
  }

  const rawValue = value.slice(separatorIndex + 1).trim();
  const selections =
    rawValue.length === 0
      ? []
      : rawValue
          .split(',')
          .map((entry) => entry.trim())
          .filter(
            (entry): entry is AssistantKind =>
              entry === 'assist' || entry === 'alexa' || entry === 'homekit',
          );

  if (
    rawValue.length > 0 &&
    selections.length !==
      rawValue
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0).length
  ) {
    throw new RepairServiceError(
      'invalid_preview_input',
      400,
      'Assistant exposures must be a comma-separated subset of assist, alexa, and homekit.',
    );
  }

  return {
    targetId: value.slice(0, separatorIndex).trim(),
    value: selections,
  };
}

function buildPreviewInputs(
  nameValues: string[],
  assistantExposureValues: string[],
  findings: Finding[],
): FixPreviewInput[] {
  return [
    ...nameValues.map((value) => {
      const parsed = parseEntityNameInput(value);
      const finding = findings.find(
        (candidate) =>
          candidate.kind === 'duplicate_name' &&
          candidate.objectIds.includes(parsed.targetId),
      );

      if (!finding) {
        throw new RepairServiceError(
          'invalid_preview_input',
          400,
          `No selected duplicate-name finding includes ${parsed.targetId}.`,
        );
      }

      return {
        field: 'name' as const,
        findingId: finding.id,
        targetId: parsed.targetId,
        value: parsed.value,
      };
    }),
    ...assistantExposureValues.map((value) => {
      const parsed = parseAssistantExposureInput(value);
      const finding = findings.find(
        (candidate) =>
          candidate.kind === 'assistant_context_bloat' &&
          candidate.objectIds.includes(parsed.targetId),
      );

      if (!finding) {
        throw new RepairServiceError(
          'invalid_preview_input',
          400,
          `No selected assistant-context finding includes ${parsed.targetId}.`,
        );
      }

      return {
        field: 'assistant_exposures' as const,
        findingId: finding.id,
        targetId: parsed.targetId,
        value: parsed.value,
      };
    }),
  ];
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'None';
}

function formatTableRow(columns: string[], widths: number[]): string {
  return columns
    .map((column, index) => column.padEnd(widths[index]!))
    .join(' | ');
}

function renderFindingsTable(output: FindingsOutput): string {
  if (output.findings.length === 0) {
    return `Scan ID: ${output.scanId}\nNo findings recorded.`;
  }

  const rows = output.findings.map((finding) => [
    finding.id,
    finding.severity,
    getFindingDefinition(finding.kind).label,
    finding.title,
    formatList(finding.objectIds),
  ]);
  const headers = ['ID', 'Severity', 'Label', 'Title', 'Objects'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length)),
  );
  const separator = widths.map((width) => '-'.repeat(width)).join('-|-');
  const lines = [
    `Scan ID: ${output.scanId}`,
    `Findings: ${output.findings.length}`,
    '',
    formatTableRow(headers, widths),
    separator,
    ...rows.map((row) => formatTableRow(row, widths)),
  ];

  return lines.join('\n');
}

function renderFindingsMarkdown(output: FindingsOutput): string {
  const lines = [
    '# Home Assistant Findings Report',
    '',
    `Scan ID: ${output.scanId}`,
    `Findings: ${output.findings.length}`,
    '',
  ];

  if (output.findings.length === 0) {
    lines.push('No findings recorded for this scan.');
    return lines.join('\n');
  }

  for (const finding of output.findings) {
    const definition = getFindingDefinition(finding.kind);

    lines.push(
      `## ${finding.title}`,
      `- ID: ${finding.id}`,
      `- Label: ${definition.label}`,
      `- Kind: ${finding.kind}`,
      `- Severity: ${finding.severity}`,
      `- Definition: ${definition.definition}`,
      `- Why it matters: ${definition.whyItMatters}`,
      `- Recommended next step: ${definition.operatorGuidance}`,
      `- Evidence: ${finding.evidence}`,
      `- Objects: ${formatList(finding.objectIds)}`,
      '',
    );
  }

  return lines.join('\n');
}

export function buildProgram() {
  const program = new Command();
  const providerIds = listProviderDescriptors().map((provider) => provider.id);
  const frameworkCommand = program
    .command('framework')
    .description('Inspect the current scaffold status');
  const connectCommand = program
    .command('connect')
    .description('Run Home Assistant connection checks and manage profiles');

  program
    .name('ha-repair')
    .description('Framework CLI for the Home Assistant repair console')
    .version('0.0.0')
    .option('--db-path <path>', 'SQLite database path');

  frameworkCommand
    .command('status')
    .description('Print the current framework summary')
    .action(() => {
      const framework = createFrameworkSummary();
      const providers = listProviderDescriptors();

      console.log(`\n${framework.title}`);
      console.log(`${framework.tagline}\n`);

      console.log('Runtime surfaces:');
      for (const surface of framework.surfaces) {
        console.log(`- [${surface.state}] ${surface.name}: ${surface.summary}`);
      }

      console.log('\nProviders:');
      for (const provider of providers) {
        console.log(`- ${provider.label}: ${provider.description}`);
      }

      console.log('\nNext steps:');
      for (const priority of framework.priorities) {
        console.log(`- ${priority}`);
      }
    });

  connectCommand
    .command('test')
    .description('Run a Home Assistant connection check')
    .option('--config-path <path>', 'Optional Home Assistant config path')
    .addOption(
      new Option('--mode <mode>', 'Connection test mode')
        .choices(['mock', 'live'])
        .default('mock'),
    )
    .option('--profile <name>', 'Saved connection profile name')
    .option('--token <token>', 'Long-lived access token')
    .option('--url <url>', 'Base Home Assistant URL')
    .action(
      async (
        options: {
          configPath?: string;
          mode: 'mock' | 'live';
          profile?: string;
          token?: string;
          url?: string;
        },
        command: Command,
      ) => {
        try {
          if (options.profile) {
            const result = await withService(command, async (service) =>
              service.testSavedProfile(options.profile!, {
                mode: options.mode,
              }),
            );
            printJson(result);
            return;
          }

          if (!options.url || !options.token) {
            throw new RepairServiceError(
              'invalid_profile',
              400,
              'Provide either --profile or both --url and --token.',
            );
          }

          const result = await withService(command, async (service) =>
            service.testInlineProfile(
              buildInlineProfile({
                token: options.token!,
                url: options.url!,
                ...(options.configPath ? {configPath: options.configPath} : {}),
              }),
              {
                mode: options.mode,
              },
            ),
          );
          printJson(result);
        } catch (error) {
          reportError(error);
        }
      },
    );

  connectCommand
    .command('save')
    .description('Persist a named Home Assistant connection profile')
    .requiredOption('--name <name>', 'Profile name')
    .requiredOption('--token <token>', 'Long-lived access token')
    .requiredOption('--url <url>', 'Base Home Assistant URL')
    .option('--config-path <path>', 'Optional Home Assistant config path')
    .option('--default', 'Set the saved profile as default')
    .action(
      async (
        options: {
          configPath?: string;
          default?: boolean;
          name: string;
          token: string;
          url: string;
        },
        command: Command,
      ) => {
        try {
          const profile = await withService(command, async (service) => {
            await service.saveProfile({
              baseUrl: options.url,
              name: options.name,
              token: options.token,
              ...(options.configPath ? {configPath: options.configPath} : {}),
            });

            if (options.default) {
              return service.setDefaultProfile(options.name);
            }

            return service.getProfile(options.name);
          });

          printJson(profile);
        } catch (error) {
          reportError(error);
        }
      },
    );

  connectCommand
    .command('list')
    .description('List saved connection profiles')
    .action(async (_options: Record<string, never>, command: Command) => {
      try {
        const profiles = await withService(command, async (service) =>
          service.listProfiles(),
        );
        printJson(profiles);
      } catch (error) {
        reportError(error);
      }
    });

  connectCommand
    .command('delete <name>')
    .description('Delete a saved connection profile')
    .action(
      async (
        name: string,
        _options: Record<string, never>,
        command: Command,
      ) => {
        try {
          const response = await withService(command, async (service) =>
            service.deleteProfile(name),
          );
          printJson(response);
        } catch (error) {
          reportError(error);
        }
      },
    );

  connectCommand
    .command('use <name>')
    .description('Set the default connection profile')
    .action(
      async (
        name: string,
        _options: Record<string, never>,
        command: Command,
      ) => {
        try {
          const profile = await withService(command, async (service) =>
            service.setDefaultProfile(name),
          );
          printJson(profile);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('scan')
    .description(
      'Run a deterministic or live read-only scan through the local SQLite service',
    )
    .option('--profile <name>', 'Saved connection profile name')
    .addOption(
      new Option('--mode <mode>', 'Scan mode')
        .choices(['mock', 'live'])
        .default('mock'),
    )
    .option('--deep', 'Read config files from the configured config path')
    .addOption(
      new Option('--llm-provider <provider>', 'Optional enrichment provider')
        .choices(providerIds)
        .default('none'),
    )
    .action(
      async (
        options: {
          deep?: boolean;
          llmProvider: 'none' | 'ollama' | 'openai';
          mode: 'mock' | 'live';
          profile?: string;
        },
        command: Command,
      ) => {
        try {
          const scan = await withService(command, async (service) =>
            service.createScan({
              llmProvider: options.llmProvider,
              mode: options.mode,
              ...(options.deep === undefined ? {} : {deep: options.deep}),
              ...(options.profile ? {profileName: options.profile} : {}),
            }),
          );

          printJson({
            backupCheckpointStatus: scan.backupCheckpoint?.status ?? null,
            findings: scan.findings.length,
            mode: scan.mode,
            notes: scan.notes.length,
            passes: scan.passes.map((pass) => ({
              name: pass.name,
              status: pass.status,
            })),
            profileName: scan.profileName,
            scanId: scan.id,
            scannedAt: scan.createdAt,
          });
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('checkpoint [scanId]')
    .description('Create an optional backup checkpoint for a live scan')
    .option('--download', 'Download the backup artifact locally when possible')
    .action(
      async (
        scanId: string | undefined,
        options: {
          download?: boolean;
        },
        command: Command,
      ) => {
        try {
          const response = await withService(command, async (service) => {
            const resolvedScanId = scanId ?? (await service.getLatestScanId());

            if (!resolvedScanId) {
              throw new RepairServiceError(
                'scan_not_found',
                404,
                'No scans found. Execute `ha-repair scan` first.',
              );
            }

            return service.createBackupCheckpoint(resolvedScanId, {
              ...(options.download === undefined
                ? {}
                : {download: options.download}),
            });
          });

          printJson(response);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('findings [scanId]')
    .description('Print findings from a scan in the local SQLite service')
    .addOption(
      new Option('--format <format>', 'Findings output format')
        .choices(['json', 'md', 'table'])
        .default('json'),
    )
    .action(
      async (
        scanId: string | undefined,
        options: {
          format: 'json' | 'md' | 'table';
        },
        command: Command,
      ) => {
        try {
          const output = await withService(command, async (service) => {
            const resolvedScanId = scanId ?? (await service.getLatestScanId());

            if (!resolvedScanId) {
              throw new RepairServiceError(
                'scan_not_found',
                404,
                'No scans found. Execute `ha-repair scan` first.',
              );
            }

            return {
              findings: await service.getScanFindings(resolvedScanId),
              scanId: resolvedScanId,
            } satisfies FindingsOutput;
          });

          if (options.format === 'table') {
            console.log(renderFindingsTable(output));
            return;
          }

          if (options.format === 'md') {
            console.log(renderFindingsMarkdown(output));
            return;
          }

          printJson(output.findings);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('preview [findingIds...]')
    .description(
      'Preview literal dry-run Home Assistant commands for selected findings',
    )
    .requiredOption('--scan <scanId>', 'Scan id to preview')
    .option(
      '--name <entityId=value>',
      'Explicit entity registry name for a duplicate-name target',
      collectRepeatedValue,
      [],
    )
    .option(
      '--assistant-exposures <entityId=assist,alexa>',
      'Reviewed assistant surfaces to keep for an assistant-context-bloat target',
      collectRepeatedValue,
      [],
    )
    .action(
      async (
        findingIds: string[],
        options: {
          assistantExposures: string[];
          name: string[];
          scan: string;
        },
        command: Command,
      ) => {
        try {
          const preview = await withService(command, async (service) => {
            const selectedFindings = await service.getScanFindings(
              options.scan,
            );
            const resolvedFindings =
              findingIds.length === 0
                ? selectedFindings
                : selectedFindings.filter((finding) =>
                    findingIds.includes(finding.id),
                  );
            const inputs = buildPreviewInputs(
              options.name,
              options.assistantExposures,
              resolvedFindings,
            );

            return service.previewFixes(
              findingIds.length > 0
                ? {
                    findingIds,
                    ...(inputs.length > 0 ? {inputs} : {}),
                    scanId: options.scan,
                  }
                : {
                    ...(inputs.length > 0 ? {inputs} : {}),
                    scanId: options.scan,
                  },
            );
          });

          printJson(preview);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('apply <actionIds...>')
    .description('Run a reviewed dry-run apply for explicitly selected actions')
    .requiredOption('--scan <scanId>', 'Scan id to preview/apply')
    .requiredOption(
      '--preview-token <token>',
      'Preview token returned by the reviewed preview step',
    )
    .option('--dry-run', 'Required for Phase B')
    .action(
      async (
        actionIds: string[],
        options: {
          dryRun?: boolean;
          previewToken: string;
          scan: string;
        },
        command: Command,
      ) => {
        try {
          if (!options.dryRun) {
            throw new RepairServiceError(
              'dry_run_required',
              400,
              'Pass --dry-run. Live apply is not available in Phase B.',
            );
          }

          if (actionIds.length === 0) {
            throw new RepairServiceError(
              'action_selection_required',
              400,
              'Select at least one reviewed action id before apply.',
            );
          }

          const response = await withService(command, async (service) => {
            return service.applyFixes({
              actionIds,
              dryRun: true,
              previewToken: options.previewToken,
              scanId: options.scan,
            });
          });

          printJson(response);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('export [scanId]')
    .description('Export a scan bundle as JSON or Markdown')
    .addOption(
      new Option('--format <format>', 'Export format')
        .choices(['json', 'md'])
        .default('json'),
    )
    .action(
      async (
        scanId: string | undefined,
        _options: {
          format: 'json' | 'md';
        },
        command: Command,
      ) => {
        try {
          const exportBundle = await withService(command, async (service) =>
            service.exportScan(scanId),
          );

          if (_options.format === 'md') {
            console.log(renderScanExportMarkdown(exportBundle));
            return;
          }

          printJson(exportBundle);
        } catch (error) {
          reportError(error);
        }
      },
    );

  return program;
}

export async function runCli(argv = process.argv) {
  const program = buildProgram();
  await program.parseAsync(argv);
}

if (require.main === module) {
  void runCli();
}
