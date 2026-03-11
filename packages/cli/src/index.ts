import process from 'node:process';
import {Command} from 'commander';
import {testConnection} from '@ha-repair/ha-client';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';

const defaultApiUrl = process.env.HA_REPAIR_API_URL ?? 'http://127.0.0.1:4010';

type ScanHistoryEntry = {
  createdAt: string;
  id: string;
};

const program = new Command();
const frameworkCommand = program
  .command('framework')
  .description('Inspect the current scaffold status');
const connectCommand = program
  .command('connect')
  .description('Run Home Assistant connection checks');

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected object response payload');
  }

  return value as Record<string, unknown>;
}

function readString(
  payload: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = payload[key];

  if (typeof value !== 'string') {
    throw new TypeError(`Expected string ${context}.${key}`);
  }

  return value;
}

function readObject(
  payload: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = payload[key];

  if (!value || typeof value !== 'object') {
    throw new Error(`Expected object ${context}.${key}`);
  }

  return value as Record<string, unknown>;
}

function readArray(
  payload: Record<string, unknown>,
  key: string,
  context: string,
): unknown[] {
  const value = payload[key];

  if (!Array.isArray(value)) {
    throw new TypeError(`Expected array ${context}.${key}`);
  }

  return value;
}

async function requestJson(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, '')}${path}`, init);
  const bodyText = await response.text();
  const body: unknown =
    bodyText.length > 0 ? (JSON.parse(bodyText) as unknown) : undefined;

  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`;

    if (
      !body ||
      typeof body !== 'object' ||
      !('error' in body && typeof body.error === 'string')
    ) {
      throw new Error(`Request failed: ${fallback}`);
    }

    throw new Error(`Request failed: ${body.error}`);
  }

  return body;
}

function getLatestScanId(history: ScanHistoryEntry[]): string | undefined {
  let latest: ScanHistoryEntry | undefined;

  for (const entry of history) {
    if (!latest || entry.createdAt > latest.createdAt) {
      latest = entry;
    }
  }

  return latest?.id;
}

function getApiUrlFlag(): string {
  const index = process.argv.indexOf('--api-url');

  if (index !== -1) {
    const value = process.argv[index + 1];

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return defaultApiUrl;
}

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
  .action(async (options: {token: string; url: string}) => {
    const result = await testConnection({
      baseUrl: options.url,
      name: 'cli',
      token: options.token,
    });

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('scan')
  .description('Run a deterministic scan through the local API')
  .option('--api-url <url>', 'Repair API base URL', defaultApiUrl)
  .action(async () => {
    const payload = asObject(
      await requestJson(getApiUrlFlag(), '/api/scans', {method: 'POST'}),
    );
    const scan = readObject(payload, 'scan', 'scanResponse');
    const findings = readArray(scan, 'findings', 'scan');
    const scanId = readString(scan, 'id', 'scan');
    const scannedAt = readString(scan, 'createdAt', 'scan');

    console.log(
      JSON.stringify(
        {
          findings: findings.length,
          scanId,
          scannedAt,
        },
        null,
        2,
      ),
    );
  });

program
  .command('findings [scanId]')
  .description('Print findings from a scan via the local API')
  .option('--api-url <url>', 'Repair API base URL', defaultApiUrl)
  .action(async (scanId?: string) => {
    const apiUrl = getApiUrlFlag();
    const historyPayload = asObject(await requestJson(apiUrl, '/api/history'));
    const scans = readArray(historyPayload, 'scans', 'historyResponse').map(
      (entry) => {
        const scanEntry = asObject(entry);

        return {
          createdAt: readString(scanEntry, 'createdAt', 'historyEntry'),
          id: readString(scanEntry, 'id', 'historyEntry'),
        };
      },
    );

    const resolvedScanId = scanId ?? getLatestScanId(scans);

    if (!resolvedScanId) {
      console.error('No scans found. Execute `ha-repair scan` first.');
      process.exitCode = 1;
      return;
    }

    const findingsPayload = asObject(
      await requestJson(apiUrl, `/api/scans/${resolvedScanId}/findings`),
    );
    const findings = readArray(findingsPayload, 'findings', 'findingsResponse');

    console.log(JSON.stringify(findings, null, 2));
  });

void program.parseAsync(process.argv);
