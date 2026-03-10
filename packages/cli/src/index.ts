import process from 'node:process';
import {Command} from 'commander';
import {testConnection} from '@ha-repair/ha-client';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';

const program = new Command();
const frameworkCommand = program
  .command('framework')
  .description('Inspect the current scaffold status');
const connectCommand = program
  .command('connect')
  .description('Run Home Assistant connection checks');

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

void program.parseAsync(process.argv);
