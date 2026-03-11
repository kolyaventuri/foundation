import {describe, expect, it} from 'vitest';
import type {SavedConnectionProfile} from '@ha-repair/contracts';
import {
  buildScanCreateRequest,
  createDefaultScanLaunchDraft,
  getScanLaunchConstraint,
  normalizeScanLaunchDraft,
} from './scan-launch';

const savedProfiles: SavedConnectionProfile[] = [
  {
    baseUrl: 'http://ha-primary.local:8123',
    configPath: '/srv/home-assistant',
    createdAt: '2026-03-01T00:00:00.000Z',
    hasToken: true,
    isDefault: true,
    name: 'primary',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
  {
    baseUrl: 'http://ha-lab.local:8123',
    createdAt: '2026-03-02T00:00:00.000Z',
    hasToken: true,
    isDefault: false,
    name: 'lab',
    updatedAt: '2026-03-02T00:00:00.000Z',
  },
];

describe('scan launch helpers', () => {
  it('defaults to mock mode without a selected profile', () => {
    expect(createDefaultScanLaunchDraft()).toEqual({
      deep: false,
      mode: 'mock',
      profileName: '',
    });
  });

  it('chooses the default saved profile when live mode has no selection', () => {
    const draft = normalizeScanLaunchDraft(
      {
        deep: false,
        mode: 'live',
        profileName: '',
      },
      savedProfiles,
    );

    expect(draft.profileName).toBe('primary');
  });

  it('builds a live scan request with deep mode when selected', () => {
    expect(
      buildScanCreateRequest({
        deep: true,
        mode: 'live',
        profileName: 'primary',
      }),
    ).toEqual({
      deep: true,
      mode: 'live',
      profileName: 'primary',
    });
  });

  it('requires a saved profile before a live scan can run', () => {
    expect(
      getScanLaunchConstraint(
        {
          deep: false,
          mode: 'live',
          profileName: '',
        },
        [],
        'ready',
      ),
    ).toBe(
      'Save a Home Assistant profile through the CLI or API before running a live scan.',
    );
  });
});
