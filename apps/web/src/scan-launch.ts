import type {
  SavedConnectionProfile,
  ScanCreateRequest,
  ScanMode,
} from '@ha-repair/contracts';

export type ScanLaunchDraft = {
  deep: boolean;
  mode: ScanMode;
  profileName: string;
};

export function createDefaultScanLaunchDraft(): ScanLaunchDraft {
  return {
    deep: false,
    mode: 'mock',
    profileName: '',
  };
}

export function resolvePreferredProfileName(
  profiles: SavedConnectionProfile[],
): string {
  return (
    profiles.find((profile) => profile.isDefault)?.name ??
    profiles[0]?.name ??
    ''
  );
}

export function normalizeScanLaunchDraft(
  draft: ScanLaunchDraft,
  profiles: SavedConnectionProfile[],
): ScanLaunchDraft {
  if (draft.mode !== 'live' || profiles.length === 0) {
    return draft;
  }

  if (profiles.some((profile) => profile.name === draft.profileName)) {
    return draft;
  }

  return {
    ...draft,
    profileName: resolvePreferredProfileName(profiles),
  };
}

export function getSelectedProfile(
  draft: ScanLaunchDraft,
  profiles: SavedConnectionProfile[],
): SavedConnectionProfile | undefined {
  return profiles.find((profile) => profile.name === draft.profileName);
}

export function getScanLaunchConstraint(
  draft: ScanLaunchDraft,
  profiles: SavedConnectionProfile[],
  profilesStatus: 'idle' | 'loading' | 'ready' | 'error',
): string | undefined {
  if (draft.mode !== 'live') {
    return undefined;
  }

  if (profilesStatus === 'loading') {
    return 'Loading saved Home Assistant profiles.';
  }

  if (profiles.length === 0) {
    return 'Save a Home Assistant profile through the CLI or API before running a live scan.';
  }

  if (!draft.profileName) {
    return 'Choose a saved Home Assistant profile for live mode.';
  }

  if (!profiles.some((profile) => profile.name === draft.profileName)) {
    return `Saved profile "${draft.profileName}" is not available.`;
  }

  return undefined;
}

export function buildScanCreateRequest(
  draft: ScanLaunchDraft,
): ScanCreateRequest {
  if (draft.mode === 'mock') {
    return {
      mode: 'mock',
    };
  }

  return {
    ...(draft.deep ? {deep: true} : {}),
    mode: 'live',
    ...(draft.profileName ? {profileName: draft.profileName} : {}),
  };
}
