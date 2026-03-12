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
        'script: !include scripts.yaml',
        'input_boolean: !include input_boolean.yaml',
        'template:',
        '  - sensor:',
        '      - name: Night Mode Template',
        `        state: "{{ states('input_boolean.night_mode') }}"`,
        `rest: !include ../${basename(outsideRoot)}/outside.yaml`,
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'automations.yaml'),
      [
        '- id: kitchen-motion',
        '  alias: Kitchen Motion',
        '  action:',
        '    - service: script.turn_on',
        '      target:',
        '        entity_id: script.goodnight',
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'scripts.yaml'),
      [
        'goodnight:',
        '  alias: Goodnight',
        '  sequence:',
        '    - service: scene.turn_on',
        '      target:',
        '        entity_id: scene.evening_scene',
        '    - variables:',
        `        mode_state: "{{ states('input_boolean.night_mode') }}"`,
      ].join('\n'),
    );
    writeFileSync(
      join(configRoot, 'input_boolean.yaml'),
      ['night_mode:', '  name: Night Mode'].join('\n'),
    );
    writeFileSync(join(configRoot, 'scenes', 'ignored.txt'), 'not yaml');
    writeFileSync(outsideRootPath, 'entity_id: light.outside_root');
    writeFileSync(
      join(configRoot, 'scenes', 'evening.yaml'),
      [
        '- id: evening_scene',
        '  name: Evening Scene',
        '  entities:',
        '    light.kitchen_light:',
        '      state: "on"',
      ].join('\n'),
    );

    const result = analyzeConfigDirectory(configRoot);
    const automation = result.automations[0];
    const scene = result.scenes[0];
    const script = result.scripts[0];
    const helper = result.helpers[0];
    const automationModule = result.configModules.find(
      (module) => module.filePath === 'automations.yaml',
    );
    const scriptModule = result.configModules.find(
      (module) => module.filePath === 'scripts.yaml',
    );

    expect(automation).toBeDefined();
    expect(scene).toBeDefined();
    expect(script).toBeDefined();
    expect(helper).toBeDefined();
    expect(automationModule).toBeDefined();
    expect(scriptModule).toBeDefined();

    if (
      !automation ||
      !scene ||
      !script ||
      !helper ||
      !automationModule ||
      !scriptModule
    ) {
      throw new Error('Expected extracted config objects and config modules');
    }

    expect(automation.automationId).toBe('automation.kitchen_motion');
    expect(automation.name).toBe('Kitchen Motion');
    expect(automation.references?.scriptIds).toEqual(['script.goodnight']);

    expect(scene.name).toBe('Evening Scene');
    expect(scene.sceneId).toBe('scene.evening_scene');
    expect(scene.sourcePath).toBe('scenes/evening.yaml');

    expect(script.name).toBe('Goodnight');
    expect(script.references?.helperIds).toEqual(['input_boolean.night_mode']);
    expect(script.references?.sceneIds).toEqual(['scene.evening_scene']);
    expect(script.scriptId).toBe('script.goodnight');
    expect(script.sourcePath).toBe('scripts.yaml');

    expect(helper.helperId).toBe('input_boolean.night_mode');
    expect(helper.helperType).toBe('input_boolean');
    expect(helper.name).toBe('Night Mode');
    expect(helper.sourcePath).toBe('input_boolean.yaml');

    expect(result.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          helperIds: ['input_boolean.night_mode'],
          sourcePath: 'configuration.yaml',
          sourceType: 'config',
        }),
        expect.objectContaining({
          helperIds: ['input_boolean.night_mode'],
          sourcePath: 'scripts.yaml',
          sourceType: 'config',
        }),
      ]),
    );

    expect(automationModule.lineCount).toBe(6);
    expect(automationModule.objectTypesPresent).toContain('automation');

    expect(scriptModule.objectTypesPresent).toEqual(
      expect.arrayContaining(['script', 'template']),
    );
    expect(scriptModule.scriptCount).toBe(1);
    expect(scriptModule.templateCount).toBe(1);
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
