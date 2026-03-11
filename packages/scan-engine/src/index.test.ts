import {describe, expect, it} from 'vitest';
import {runScan, createFrameworkSummary} from './index';

describe('scan-engine', () => {
  it('describes the initial scaffold surfaces', () => {
    const summary = createFrameworkSummary();

    expect(summary.title).toBe('Home Assistant Repair Console');
    expect(summary.surfaces).toHaveLength(4);
    expect(summary.surfaces.some((surface) => surface.id === 'rules')).toBe(
      true,
    );
  });

  it('returns deterministic findings for duplicate names, stale entities, and orphans', () => {
    const result = runScan({
      devices: [
        {
          deviceId: 'device.kitchen_light',
          name: 'Kitchen Light',
        },
      ],
      entities: [
        {
          deviceId: 'device.kitchen_light',
          entityId: 'light.kitchen_light',
          friendlyName: 'Kitchen Light',
          isStale: false,
        },
        {
          entityId: 'sensor.kitchen_light_power',
          friendlyName: 'Kitchen Light',
          isStale: true,
        },
        {
          deviceId: 'device.ghost',
          entityId: 'switch.orphaned_fan',
          friendlyName: 'Orphaned Fan',
          isStale: false,
        },
      ],
      source: 'mock',
    });

    expect(result.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'duplicate_name',
        'orphaned_entity_device',
        'stale_entity',
      ]),
    );
  });
});
