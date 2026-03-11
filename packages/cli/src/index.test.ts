import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import type {FixApplyResponse, FixPreviewResponse} from '@ha-repair/contracts';
import {afterEach, describe, expect, it} from 'vitest';
import {createLiveHomeAssistantMocks} from '../../../test/live-home-assistant';
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

async function withLiveHomeAssistantGlobals<T>(callback: () => Promise<T>) {
  const mocks = createLiveHomeAssistantMocks();
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  globalThis.fetch = mocks.fetch;
  globalThis.WebSocket = mocks.WebSocketCtor as unknown as typeof WebSocket;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;

    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket;
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
}

describe('cli', () => {
  it('supports saved profiles, reviewed previews, dry-run apply, and markdown/json exports', async () => {
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

    const liveTestResult = await withLiveHomeAssistantGlobals(async () =>
      runCliCommand(
        ['connect', 'test', '--profile', 'primary', '--mode', 'live'],
        dbPath,
      ),
    );
    expect(liveTestResult.exitCode).toBe(0);
    expect(JSON.parse(liveTestResult.stdout)).toMatchObject({
      mode: 'live',
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

    const previewResult = await runCliCommand(
      [
        'preview',
        findings[0]!.id,
        '--scan',
        scanSummary.scanId,
        '--name',
        'light.living_room_lamp=Living Room Lamp (light.living_room_lamp)',
        '--name',
        'sensor.living_room_lamp_power=Living Room Lamp (sensor.living_room_lamp_power)',
      ],
      dbPath,
    );
    expect(previewResult.exitCode).toBe(0);
    const preview = JSON.parse(previewResult.stdout) as FixPreviewResponse;
    expect(preview.queue.createdAt).toEqual(expect.any(String));
    expect(preview.queue.id).toEqual(expect.any(String));
    expect(preview.queue.status).toBe('pending_review');
    expect(preview.scanId).toBe(scanSummary.scanId);
    expect(preview.previewToken).toEqual(expect.any(String));
    expect(preview.actions).toHaveLength(1);
    const previewAction = preview.actions[0];
    expect(previewAction).toBeDefined();
    if (!previewAction) {
      throw new Error('Expected preview action');
    }

    expect(previewAction.requiresConfirmation).toBe(true);
    expect(previewAction.commands).toHaveLength(2);
    expect(preview.advisories).toHaveLength(0);

    const previewArtifact = previewAction.artifacts[0];
    expect(previewArtifact).toBeDefined();
    if (!previewArtifact) {
      throw new Error('Expected preview artifact');
    }

    expect(previewArtifact.content).toContain('@@ entity_registry/');

    const previewCommand = previewAction.commands[0];
    expect(previewCommand).toBeDefined();
    if (!previewCommand) {
      throw new Error('Expected preview command');
    }

    expect(previewCommand.payload.type).toBe('config/entity_registry/update');

    const applySelectedResult = await runCliCommand(
      [
        'apply',
        preview.selection.actionIds[0]!,
        '--scan',
        scanSummary.scanId,
        '--preview-token',
        preview.previewToken,
        '--dry-run',
      ],
      dbPath,
    );
    expect(applySelectedResult.exitCode).toBe(0);
    const applySelected = JSON.parse(
      applySelectedResult.stdout,
    ) as FixApplyResponse;
    expect(applySelected.actions).toHaveLength(1);
    expect(applySelected.mode).toBe('dry_run');
    expect(applySelected.previewToken).toBe(preview.previewToken);
    expect(applySelected.queue.id).toBe(preview.queue.id);
    expect(applySelected.queue.lastAppliedAt).toEqual(expect.any(String));
    expect(applySelected.queue.status).toBe('dry_run_applied');

    const rejectedApplyResult = await runCliCommand(
      [
        'apply',
        preview.selection.actionIds[0]!,
        '--scan',
        scanSummary.scanId,
        '--preview-token',
        'bad-token',
        '--dry-run',
      ],
      dbPath,
    );
    expect(rejectedApplyResult.exitCode).toBe(1);
    expect(rejectedApplyResult.stderr).toContain(
      'do not match the reviewed preview token',
    );

    const exportResult = await runCliCommand(
      ['export', scanSummary.scanId, '--format', 'json'],
      dbPath,
    );
    expect(exportResult.exitCode).toBe(0);
    const exportBundle = JSON.parse(exportResult.stdout) as {
      actions: unknown[];
      scan: {
        id: string;
      };
    };
    expect(exportBundle.actions.length).toBeGreaterThan(0);
    expect(exportBundle.scan.id).toBe(scanSummary.scanId);

    const markdownExportResult = await runCliCommand(
      ['export', scanSummary.scanId, '--format', 'md'],
      dbPath,
    );
    expect(markdownExportResult.exitCode).toBe(0);
    expect(markdownExportResult.stdout).toContain(
      '# Home Assistant Repair Report',
    );
    expect(markdownExportResult.stdout).toContain(
      `Scan ID: ${scanSummary.scanId}`,
    );

    const deleteResult = await runCliCommand(
      ['connect', 'delete', 'primary'],
      dbPath,
    );
    expect(deleteResult.exitCode).toBe(0);

    const finalListResult = await runCliCommand(['connect', 'list'], dbPath);
    expect(JSON.parse(finalListResult.stdout)).toEqual([]);
  });
});
