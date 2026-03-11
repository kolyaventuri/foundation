import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {afterEach, describe, expect, it} from 'vitest';
import {buildProgram} from './index';

const temporaryDirectories: string[] = [];

function createTempDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'ha-repair-cli-'));
  temporaryDirectories.push(directory);
  return join(directory, 'ha-repair.sqlite');
}

async function runCliCommand(args: string[], dbPath: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;

  process.exitCode = 0;
  console.log = (...values: unknown[]) => {
    stdout.push(values.map(String).join(' '));
  };

  console.error = (...values: unknown[]) => {
    stderr.push(values.map(String).join(' '));
  };

  try {
    const program = buildProgram();
    await program.parseAsync([
      'node',
      'ha-repair',
      '--db-path',
      dbPath,
      ...args,
    ]);

    return {
      exitCode: process.exitCode ?? 0,
      stderr: stderr.join('\n'),
      stdout: stdout.join('\n'),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
});

describe('cli', () => {
  it('supports saved profiles, scans, dry-run apply, and json export', async () => {
    const dbPath = createTempDatabasePath();

    const saveResult = await runCliCommand(
      [
        'connect',
        'save',
        '--name',
        'primary',
        '--url',
        'https://ha.local:8123',
        '--token',
        'abc123',
        '--default',
      ],
      dbPath,
    );
    expect(saveResult.exitCode).toBe(0);
    const savedProfile = JSON.parse(saveResult.stdout) as {
      hasToken: boolean;
      isDefault: boolean;
      name: string;
    };
    expect(savedProfile).toMatchObject({
      hasToken: true,
      isDefault: true,
      name: 'primary',
    });

    const listResult = await runCliCommand(['connect', 'list'], dbPath);
    expect(listResult.exitCode).toBe(0);
    const listedProfiles = JSON.parse(listResult.stdout) as Array<{
      hasToken: boolean;
      isDefault: boolean;
      name: string;
    }>;
    expect(listedProfiles).toEqual([
      expect.objectContaining({
        hasToken: true,
        isDefault: true,
        name: 'primary',
      }),
    ]);

    const useResult = await runCliCommand(
      ['connect', 'use', 'primary'],
      dbPath,
    );
    expect(useResult.exitCode).toBe(0);

    const testResult = await runCliCommand(
      ['connect', 'test', '--profile', 'primary'],
      dbPath,
    );
    expect(testResult.exitCode).toBe(0);
    expect(JSON.parse(testResult.stdout)).toMatchObject({
      ok: true,
    });

    const scanResult = await runCliCommand(
      ['scan', '--profile', 'primary'],
      dbPath,
    );
    expect(scanResult.exitCode).toBe(0);
    const scanSummary = JSON.parse(scanResult.stdout) as {
      profileName: string | null;
      scanId: string;
    };
    expect(scanSummary.profileName).toBe('primary');

    const findingsResult = await runCliCommand(['findings'], dbPath);
    expect(findingsResult.exitCode).toBe(0);
    const findings = JSON.parse(findingsResult.stdout) as Array<{id: string}>;
    expect(findings.length).toBeGreaterThan(0);

    const applyAllResult = await runCliCommand(
      ['apply', '--scan', scanSummary.scanId, '--dry-run'],
      dbPath,
    );
    expect(applyAllResult.exitCode).toBe(0);
    const applyAll = JSON.parse(applyAllResult.stdout) as {
      actions: Array<{id: string}>;
      mode: string;
      scanId: string;
    };
    expect(applyAll).toMatchObject({
      mode: 'dry_run',
      scanId: scanSummary.scanId,
    });
    expect(applyAll.actions.length).toBeGreaterThan(0);

    const applySelectedResult = await runCliCommand(
      [
        'apply',
        applyAll.actions[0]!.id,
        '--scan',
        scanSummary.scanId,
        '--dry-run',
      ],
      dbPath,
    );
    expect(applySelectedResult.exitCode).toBe(0);
    const applySelected = JSON.parse(applySelectedResult.stdout) as {
      actions: Array<{id: string}>;
    };
    expect(applySelected.actions).toHaveLength(1);

    const exportResult = await runCliCommand(
      ['export', scanSummary.scanId, '--format', 'json'],
      dbPath,
    );
    expect(exportResult.exitCode).toBe(0);
    const exportBundle = JSON.parse(exportResult.stdout) as {
      scan: {
        id: string;
      };
    };
    expect(exportBundle.scan.id).toBe(scanSummary.scanId);

    const deleteResult = await runCliCommand(
      ['connect', 'delete', 'primary'],
      dbPath,
    );
    expect(deleteResult.exitCode).toBe(0);

    const finalListResult = await runCliCommand(['connect', 'list'], dbPath);
    expect(JSON.parse(finalListResult.stdout)).toEqual([]);
  });
});
