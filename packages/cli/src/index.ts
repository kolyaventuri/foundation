import process from 'node:process';
import {Command} from 'commander';
import {collectMockInventory, testConnection} from '@ha-repair/ha-client';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary, runScan} from '@ha-repair/scan-engine';

const program = new Command();
const frameworkCommand = program
  .command('framework')
  .description('Inspect the current scaffold status');
const connectCommand = program
  .command('connect')
  .description('Run Home Assistant connection checks');

let latestScan: ReturnType<typeof runScan> | undefined;

program
  .name('ha-repair')
  .description('Framework CLI for the Home Assistant repair console')
  .version('0.0.0');

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
  .description('Run the current stubbed Home Assistant connection check')
  .requiredOption('--url <url>', 'Base Home Assistant URL')
  .requiredOption('--token <token>', 'Long-lived access token')
  .action(async (options) => {
    const result = await testConnection({
      baseUrl: options.url as string,
      name: 'cli',
      token: options.token as string,
    });

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('scan')
  .description('Run a baseline deterministic scan against mock inventory')
  .action(() => {
    latestScan = runScan(collectMockInventory());
    console.log(
      JSON.stringify(
        {
          findings: latestScan.findings.length,
          scanId: latestScan.id,
          scannedAt: latestScan.createdAt,
        },
        null,
        2,
      ),
    );
  });

program
  .command('findings [scanId]')
  .description('Print findings from the latest local scan run')
  .action((scanId?: string) => {
    if (!latestScan) {
      console.error(
        'No local scan has been run yet. Execute `ha-repair scan` first.',
      );
      process.exitCode = 1;
      return;
    }

    if (scanId && scanId !== latestScan.id) {
      console.error(
        `Unknown local scan id ${scanId}. Latest id is ${latestScan.id}.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(latestScan.findings, null, 2));
  });

void program.parseAsync(process.argv);
