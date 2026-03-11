import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {analyzeConfigDirectory} from './config-analysis';

const temporaryDirectories: string[] = [];

function createTempConfigRoot() {
  const directory = mkdtempSync(join(tmpdir(), 'ha-repair-config-analysis-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
});

describe('config analysis', () => {
  it('loads included automation and scene files while bounding includes to the root', () => {
    const configRoot = createTempConfigRoot();
    const outsideRoot = createTempConfigRoot();
    const outsideRootPath = join(outsideRoot, 'outside.yaml');
    mkdirSync(join(configRoot, 'scenes'));

    writeFileSync(
      join(configRoot, 'configuration.yaml'),
      [
        'automation: !include automations.yaml',
        'scene: !include_dir_merge_list scenes',
        `template: !include ../${basename(outsideRoot)}/outside.yaml`,
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'automations.yaml'),
      [
        '- id: kitchen-motion',
        '  alias: Kitchen Motion',
        '  action:',
        '    - target:',
        '        entity_id: light.kitchen_light',
      ].join('\n'),
    );
    writeFileSync(join(configRoot, 'scenes', 'ignored.txt'), 'not yaml');
    writeFileSync(outsideRootPath, 'entity_id: light.outside_root');
    writeFileSync(
      join(configRoot, 'scenes', 'evening.yaml'),
      [
        '- id: evening-scene',
        '  name: Evening',
        '  entities:',
        '    light.kitchen_light:',
        '      state: "on"',
      ].join('\n'),
    );

    const result = analyzeConfigDirectory(configRoot);

    expect(result.automations).toEqual([
      expect.objectContaining({
        automationId: 'kitchen-motion',
        name: 'Kitchen Motion',
      }),
    ]);
    expect(result.scenes).toEqual([
      expect.objectContaining({
        name: 'Evening',
        sceneId: 'evening-scene',
      }),
    ]);
    expect(result.analysis.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'include_outside_root',
        }),
      ]),
    );
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'config',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('reports missing included files as config issues', () => {
    const configRoot = createTempConfigRoot();

    writeFileSync(
      join(configRoot, 'configuration.yaml'),
      'automation: !include automations.yaml',
    );

    const result = analyzeConfigDirectory(configRoot);

    expect(result.analysis.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'automations.yaml',
          status: 'missing',
        }),
      ]),
    );
    expect(result.analysis.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_file',
          filePath: 'automations.yaml',
        }),
      ]),
    );
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'config:missing_file:automations.yaml',
        }),
      ]),
    );
  });
});
