import {describe, expect, it} from 'vitest';
import {
  removeConfigNamedObject,
  renameConfigNamedObject,
} from './config-rewrites';

describe('config rewrite helpers', () => {
  it('renames a named helper while preserving surrounding comments', () => {
    const input = [
      '# Office helper',
      'mode:',
      '  # current label',
      '  name: Mode',
      '  initial: false',
      '',
    ].join('\n');

    const result = renameConfigNamedObject({
      content: input,
      domain: 'input_boolean',
      nextName: 'Office Mode',
      objectKey: 'mode',
    });

    expect(result.nextContent).toContain('# Office helper');
    expect(result.nextContent).toContain('# current label');
    expect(result.nextContent).toContain('name: Office Mode');
    expect(result.nextContent).not.toContain('name: Mode');
  });

  it('removes a named script from a direct mapping file without touching siblings', () => {
    const input = [
      '# Cleanup candidates',
      'legacy_shutdown:',
      '  alias: Legacy Shutdown',
      '  sequence:',
      '    - action: light.turn_off',
      'evening_scene:',
      '  alias: Evening Scene',
      '  sequence:',
      '    - action: scene.turn_on',
      '',
    ].join('\n');

    const result = removeConfigNamedObject({
      content: input,
      domain: 'script',
      objectKey: 'legacy_shutdown',
    });

    expect(result.nextContent).toContain('# Cleanup candidates');
    expect(result.nextContent).not.toContain('legacy_shutdown:');
    expect(result.nextContent).toContain('evening_scene:');
  });
});
