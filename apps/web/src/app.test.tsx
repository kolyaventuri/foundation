import {describe, expect, it} from 'vitest';
import {findingKindFilterOptions} from './app';

describe('app finding filters', () => {
  it('includes the final phase 2 finding kinds in the workbench filter options', () => {
    expect(findingKindFilterOptions.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'automation_disabled_dependency',
        'monolithic_config_file',
        'orphan_config_module',
        'script_invalid_target',
        'template_no_unknown_handling',
      ]),
    );
  });
});
