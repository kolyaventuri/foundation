import process from 'node:process';
import {Command, Option} from 'commander';
import type {ConnectionProfile, FixAction} from '@ha-repair/contracts';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';
import {
  createRepairService,
  RepairServiceError,
  type RepairService,
} from '@ha-repair/storage';

type GlobalOptions = {
  dbPath?: string;
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

function resolveSelectedFindingIds(
  actions: FixAction[],
  fixIds: string[],
): string[] {
  const requestedIds = new Set(fixIds);
  const selected = actions.filter((action) => requestedIds.has(action.id));

  if (selected.length !== requestedIds.size) {
    const foundIds = new Set(selected.map((action) => action.id));
    const missing = [...requestedIds].filter((fixId) => !foundIds.has(fixId));
    throw new RepairServiceError(
      'finding_not_found',
      400,
      `Unknown fix ids: ${missing.join(', ')}`,
    );
  }

  return selected.map((action) => action.findingId);
}

export function buildProgram() {
  const program = new Command();
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
    .description('Run the current mocked Home Assistant connection check')
    .option('--config-path <path>', 'Optional Home Assistant config path')
    .option('--profile <name>', 'Saved connection profile name')
    .option('--token <token>', 'Long-lived access token')
    .option('--url <url>', 'Base Home Assistant URL')
    .action(
      async (
        options: {
          configPath?: string;
          profile?: string;
          token?: string;
          url?: string;
        },
        command: Command,
      ) => {
        try {
          if (options.profile) {
            const result = await withService(command, async (service) =>
              service.testSavedProfile(options.profile!),
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
    .description('Run a deterministic scan through the local SQLite service')
    .option('--profile <name>', 'Saved connection profile name')
    .action(
      async (
        options: {
          profile?: string;
        },
        command: Command,
      ) => {
        try {
          const scan = await withService(command, async (service) =>
            service.createScan(
              options.profile ? {profileName: options.profile} : {},
            ),
          );

          printJson({
            findings: scan.findings.length,
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
    .command('findings [scanId]')
    .description('Print findings from a scan in the local SQLite service')
    .action(
      async (
        scanId: string | undefined,
        _options: Record<string, never>,
        command: Command,
      ) => {
        try {
          const findings = await withService(command, async (service) => {
            const resolvedScanId = scanId ?? (await service.getLatestScanId());

            if (!resolvedScanId) {
              throw new RepairServiceError(
                'scan_not_found',
                404,
                'No scans found. Execute `ha-repair scan` first.',
              );
            }

            return service.getScanFindings(resolvedScanId);
          });

          printJson(findings);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('apply [fixIds...]')
    .description('Return a deterministic dry-run fix plan for a scan')
    .requiredOption('--scan <scanId>', 'Scan id to preview/apply')
    .option('--dry-run', 'Required for Phase B')
    .action(
      async (
        fixIds: string[],
        options: {
          dryRun?: boolean;
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

          const response = await withService(command, async (service) => {
            const preview = await service.previewFixes({
              scanId: options.scan,
            });
            const findingIds =
              fixIds.length > 0
                ? resolveSelectedFindingIds(preview.actions, fixIds)
                : undefined;

            return service.applyFixes(
              findingIds
                ? {
                    dryRun: true,
                    findingIds,
                    scanId: options.scan,
                  }
                : {
                    dryRun: true,
                    scanId: options.scan,
                  },
            );
          });

          printJson(response);
        } catch (error) {
          reportError(error);
        }
      },
    );

  program
    .command('export [scanId]')
    .description('Export a scan bundle as JSON')
    .addOption(
      new Option('--format <format>', 'Export format')
        .choices(['json'])
        .default('json'),
    )
    .action(
      async (
        scanId: string | undefined,
        _options: {
          format: 'json';
        },
        command: Command,
      ) => {
        try {
          const exportBundle = await withService(command, async (service) =>
            service.exportScan(scanId),
          );

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
