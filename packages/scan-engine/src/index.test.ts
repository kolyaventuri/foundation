import {describe, expect, it} from 'vitest';
import {createFrameworkSummary} from './index';

describe('scan-engine', () => {
  it('describes the initial scaffold surfaces', () => {
    const summary = createFrameworkSummary();

    expect(summary.title).toBe('Home Assistant Repair Console');
    expect(summary.surfaces).toHaveLength(4);
    expect(summary.surfaces.some((surface) => surface.id === 'rules')).toBe(
      true,
    );
  });
});
