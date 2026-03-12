import {
  type ApiErrorResponse,
  type AssistantKind,
  createFrameworkSummary,
  type BackupCheckpointResponse,
  type Finding,
  type FindingKind,
  type FindingSeverity,
  getFindingActionKind,
  getFindingDefinition,
  getFixActionDefinition,
  type ProfileListResponse,
  type FixApplyResponse,
  type FixPreviewInput,
  type FixPreviewResponse,
  type SavedConnectionProfile,
  type ScanCreateRequest,
  type ScanCreateResponse,
  type ScanDetail,
  type ScanHistoryEntry,
  type ScanHistoryResponse,
  type ScanMode,
  type ScanWorkbench,
  type ScanWorkbenchResponse,
  type WorkbenchApplyResponse,
  type WorkbenchEntry,
  type WorkbenchItemDeleteResponse,
  type WorkbenchItemMutationResponse,
  type WorkbenchPreviewResponse,
} from '@ha-repair/contracts';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import {
  buildAuditScoreCards,
  buildAuditSignalChips,
  buildConflictHotspotHighlights,
  buildIntentClusterHighlights,
  summarizeAuditObjectCounts,
} from './audit-summary';
import {
  buildWorkbenchFindingRecords,
  filterWorkbenchFindingRecords,
  flattenRailGroups,
  getDefaultFindingId,
  getFindingObjectSummary,
  getNextRecommendedFindingId,
  getVisibleVirtualRailRows,
  groupWorkbenchFindingRecords,
  type RailFilters,
  type VisibleVirtualRailRow,
  type WorkbenchFindingRecord,
} from './workbench';
import {
  buildScanCreateRequest,
  createDefaultScanLaunchDraft,
  getScanLaunchConstraint,
  getSelectedProfile,
  normalizeScanLaunchDraft,
  type ScanLaunchDraft,
} from './scan-launch';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type MutationStatus = 'idle' | 'running' | 'ready' | 'error';
type RoutePanel = 'batch' | 'finding';
type WorkspaceRoute = {
  findingId: string | undefined;
  panel: RoutePanel;
  scanId: string | undefined;
};

const appSummary = createFrameworkSummary();
const railCollapsedStorageKey = 'ha-repair.web.rail-collapsed';

const panelClass =
  'rounded-[1.5rem] border border-black/10 bg-white/82 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur';
const primaryButtonClass =
  'rounded-full border border-ink-strong/10 bg-ink-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-ink-soft/50';
const secondaryButtonClass =
  'rounded-full border border-black/10 bg-white/70 px-4 py-2.5 text-sm font-semibold text-ink-strong transition hover:border-ink-strong/25 disabled:cursor-not-allowed disabled:text-ink-soft';
const subtleButtonClass =
  'rounded-full border border-transparent px-3 py-2 text-sm font-semibold text-ink-soft transition hover:border-black/10 hover:bg-white/60 disabled:cursor-not-allowed disabled:text-ink-soft/60';

const severityToneClasses = {
  high: 'border-accent/25 bg-accent/10 text-accent',
  low: 'border-success/25 bg-success/10 text-success',
  medium: 'border-amber-800/20 bg-amber-700/10 text-amber-900',
} as const;

const entryToneClasses = {
  advisory: 'border-black/10 bg-white/65 text-ink-soft',
  dry_run_applied: 'border-success/20 bg-success/10 text-success',
  recommended: 'border-amber-800/20 bg-amber-700/10 text-amber-900',
  staged: 'border-accent/20 bg-accent/10 text-accent',
} as const;

const statusToneClasses = {
  error: 'border-accent/15 bg-accent/15 text-accent',
  idle: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  loading: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  ready: 'border-success/20 bg-success/15 text-success',
  running: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
} as const;

export const findingKindFilterOptions = [
  {
    label: getFindingDefinition('ambiguous_helper_name').label,
    value: 'ambiguous_helper_name',
  },
  {
    label: getFindingDefinition('assistant_context_bloat').label,
    value: 'assistant_context_bloat',
  },
  {
    label: getFindingDefinition('automation_disabled_dependency').label,
    value: 'automation_disabled_dependency',
  },
  {
    label: getFindingDefinition('automation_invalid_target').label,
    value: 'automation_invalid_target',
  },
  {
    label: getFindingDefinition('dangling_label_reference').label,
    value: 'dangling_label_reference',
  },
  {
    label: getFindingDefinition('duplicate_name').label,
    value: 'duplicate_name',
  },
  {
    label: getFindingDefinition('entity_ownership_hotspot').label,
    value: 'entity_ownership_hotspot',
  },
  {
    label: getFindingDefinition('highly_coupled_automation').label,
    value: 'highly_coupled_automation',
  },
  {
    label: getFindingDefinition('likely_conflicting_controls').label,
    value: 'likely_conflicting_controls',
  },
  {
    label: getFindingDefinition('missing_area_assignment').label,
    value: 'missing_area_assignment',
  },
  {
    label: getFindingDefinition('missing_floor_assignment').label,
    value: 'missing_floor_assignment',
  },
  {
    label: getFindingDefinition('monolithic_config_file').label,
    value: 'monolithic_config_file',
  },
  {
    label: getFindingDefinition('orphan_config_module').label,
    value: 'orphan_config_module',
  },
  {
    label: getFindingDefinition('scene_invalid_target').label,
    value: 'scene_invalid_target',
  },
  {
    label: getFindingDefinition('script_invalid_target').label,
    value: 'script_invalid_target',
  },
  {
    label: getFindingDefinition('shared_label_observation').label,
    value: 'shared_label_observation',
  },
  {
    label: getFindingDefinition('stale_entity').label,
    value: 'stale_entity',
  },
  {
    label: getFindingDefinition('template_missing_reference').label,
    value: 'template_missing_reference',
  },
  {
    label: getFindingDefinition('template_no_unknown_handling').label,
    value: 'template_no_unknown_handling',
  },
  {
    label: getFindingDefinition('unused_helper').label,
    value: 'unused_helper',
  },
  {
    label: getFindingDefinition('unused_scene').label,
    value: 'unused_scene',
  },
  {
    label: getFindingDefinition('unused_script').label,
    value: 'unused_script',
  },
  {
    label: getFindingDefinition('orphaned_entity_device').label,
    value: 'orphaned_entity_device',
  },
] satisfies Array<{label: string; value: Exclude<RailFilters['kind'], 'all'>}>;

async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;

    try {
      const payload = (await response.json()) as Partial<ApiErrorResponse>;

      if (typeof payload.error === 'string' && payload.error.length > 0) {
        message = `${message}: ${payload.error}`;
      }
    } catch {}

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function canUseStorage(): boolean {
  return 'localStorage' in globalThis;
}

function readRailCollapsed(): boolean {
  if (!canUseStorage()) {
    return false;
  }

  return globalThis.localStorage.getItem(railCollapsedStorageKey) === 'true';
}

function writeRailCollapsed(value: boolean): void {
  if (!canUseStorage()) {
    return;
  }

  globalThis.localStorage.setItem(railCollapsedStorageKey, String(value));
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatQueueStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatEntryStatus(status: WorkbenchEntry['status']): string {
  return status.replaceAll('_', ' ');
}

function formatScanMode(value: ScanDetail['mode']): string {
  return value === 'live' ? 'Live read-only' : 'Mock';
}

function formatScanAction(mode: ScanMode): string {
  return mode === 'live' ? 'Run live scan' : 'Run mock scan';
}

function formatAuditScore(value: number): string {
  return `${value}/100`;
}

function getAuditScoreToneClass(
  key: ReturnType<typeof buildAuditScoreCards>[number]['key'],
  value: number,
): string {
  if (key === 'cleanupOpportunity') {
    if (value <= 25) {
      return 'border-success/20 bg-success/10 text-success';
    }

    if (value <= 50) {
      return 'border-amber-800/20 bg-amber-700/10 text-amber-900';
    }

    return 'border-accent/20 bg-accent/10 text-accent';
  }

  if (value >= 75) {
    return 'border-success/20 bg-success/10 text-success';
  }

  if (value >= 55) {
    return 'border-amber-800/20 bg-amber-700/10 text-amber-900';
  }

  return 'border-accent/20 bg-accent/10 text-accent';
}

function readRoute(): WorkspaceRoute {
  if (globalThis.location === undefined) {
    return {
      findingId: undefined,
      panel: 'finding',
      scanId: undefined,
    };
  }

  const search = new URLSearchParams(globalThis.location.search);
  const scanId = search.get('scan')?.trim() ?? undefined;
  const findingId = search.get('finding')?.trim() ?? undefined;
  const panel = search.get('panel') === 'batch' ? 'batch' : 'finding';

  return {
    findingId,
    panel,
    scanId,
  };
}

function writeRoute(
  route: WorkspaceRoute,
  historyMode: 'push' | 'replace' = 'replace',
): void {
  if (globalThis.location === undefined || globalThis.history === undefined) {
    return;
  }

  const nextUrl = new URL(globalThis.location.href);

  if (route.scanId) {
    nextUrl.searchParams.set('scan', route.scanId);
    nextUrl.searchParams.set('panel', route.panel);

    if (route.findingId) {
      nextUrl.searchParams.set('finding', route.findingId);
    } else {
      nextUrl.searchParams.delete('finding');
    }
  } else {
    nextUrl.searchParams.delete('scan');
    nextUrl.searchParams.delete('panel');
    nextUrl.searchParams.delete('finding');
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;

  if (historyMode === 'push') {
    globalThis.history.pushState({}, '', nextPath);
    return;
  }

  globalThis.history.replaceState({}, '', nextPath);
}

function resolveFindingId(
  records: WorkbenchFindingRecord[],
  findingId: string | undefined,
): string | undefined {
  if (findingId && records.some((record) => record.finding.id === findingId)) {
    return findingId;
  }

  return getDefaultFindingId(records);
}

function getEntryForFinding(
  workbench: ScanWorkbench | undefined,
  findingId: string | undefined,
): WorkbenchEntry | undefined {
  return workbench?.entries.find((entry) => entry.findingId === findingId);
}

function getFindingDraftInputs(
  drafts: Record<string, FixPreviewInput[]>,
  entry: WorkbenchEntry | undefined,
  findingId: string | undefined,
): FixPreviewInput[] {
  if (!findingId) {
    return [];
  }

  return drafts[findingId] ?? entry?.savedInputs ?? [];
}

function getNameInputValue(
  inputs: FixPreviewInput[],
  findingId: string,
  targetId: string,
): string {
  const input = inputs.find(
    (candidate) =>
      candidate.findingId === findingId &&
      candidate.targetId === targetId &&
      candidate.field === 'name',
  );

  return input?.field === 'name' ? input.value : '';
}

function getAssistantExposureInputValue(
  inputs: FixPreviewInput[],
  findingId: string,
  targetId: string,
): AssistantKind[] | undefined {
  const input = inputs.find(
    (candidate) =>
      candidate.findingId === findingId &&
      candidate.targetId === targetId &&
      candidate.field === 'assistant_exposures',
  );

  return input?.field === 'assistant_exposures' ? input.value : undefined;
}

function normalizeAssistantExposureSelection(
  value: AssistantKind[],
): AssistantKind[] {
  return [...new Set(value)].sort();
}

function areAssistantExposureSelectionsEqual(
  left: AssistantKind[],
  right: AssistantKind[],
): boolean {
  return (
    left.length === right.length &&
    left.every((assistant, index) => assistant === right[index])
  );
}

function isAssistantKind(value: string): value is AssistantKind {
  return value === 'assist' || value === 'alexa' || value === 'homekit';
}

function getAssistantExposureTargets(finding: Finding): AssistantKind[] {
  return finding.objectIds
    .filter((objectId) => isAssistantKind(objectId))
    .sort();
}

function upsertDraftInput(
  currentInputs: FixPreviewInput[],
  nextInput: FixPreviewInput,
): FixPreviewInput[] {
  const filteredInputs = currentInputs.filter(
    (input) =>
      !(
        input.findingId === nextInput.findingId &&
        input.targetId === nextInput.targetId &&
        input.field === nextInput.field
      ),
  );

  if (nextInput.field === 'name') {
    const trimmedValue = nextInput.value.trim();

    if (trimmedValue.length === 0) {
      return filteredInputs;
    }

    return [...filteredInputs, {...nextInput, value: trimmedValue}].sort(
      (left, right) =>
        `${left.targetId}:${left.field}`.localeCompare(
          `${right.targetId}:${right.field}`,
        ),
    );
  }

  return [
    ...filteredInputs,
    {
      ...nextInput,
      value: normalizeAssistantExposureSelection(nextInput.value),
    },
  ].sort((left, right) =>
    `${left.targetId}:${left.field}`.localeCompare(
      `${right.targetId}:${right.field}`,
    ),
  );
}

function canStageFinding(
  finding: Finding | undefined,
  entry: WorkbenchEntry | undefined,
  inputs: FixPreviewInput[],
): boolean {
  if (!finding || !entry || entry.treatment !== 'actionable') {
    return false;
  }

  if (finding.kind === 'duplicate_name') {
    return finding.objectIds.every(
      (entityId) =>
        getNameInputValue(inputs, finding.id, entityId).trim().length > 0,
    );
  }

  if (finding.kind === 'assistant_context_bloat') {
    const entityId = finding.objectIds[0];
    const currentSelection = normalizeAssistantExposureSelection(
      getAssistantExposureTargets(finding),
    );
    const draftedSelection = entityId
      ? getAssistantExposureInputValue(inputs, finding.id, entityId)
      : undefined;

    return (
      draftedSelection !== undefined &&
      !areAssistantExposureSelectionsEqual(
        currentSelection,
        normalizeAssistantExposureSelection(draftedSelection),
      )
    );
  }

  return true;
}

function getFindingInputStatusSummary(
  finding: Finding,
  inputs: FixPreviewInput[],
): string {
  if (finding.kind === 'duplicate_name') {
    return `${inputs.length} value(s) drafted for ${finding.objectIds.length} required target(s).`;
  }

  if (finding.kind === 'assistant_context_bloat') {
    return getAssistantExposureInputValue(
      inputs,
      finding.id,
      finding.objectIds[0] ?? '',
    ) === undefined
      ? 'Choose the assistant surfaces to keep before staging this finding.'
      : 'The reviewed assistant keep-set is ready to stage when it differs from the current exposure set.';
  }

  return 'No operator input is required for this finding kind.';
}

function findEntity(scan: ScanDetail, entityId: string) {
  return scan.inventory.entities.find((entity) => entity.entityId === entityId);
}

function createDefaultFilters(): RailFilters {
  return {
    kind: 'all',
    query: '',
    severity: 'all',
    status: 'all',
  };
}

// eslint-disable-next-line complexity
export function App() {
  const [route, setRoute] = useState<WorkspaceRoute>(() => readRoute());
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>('idle');
  const [profilesStatus, setProfilesStatus] = useState<LoadStatus>('idle');
  const [workspaceStatus, setWorkspaceStatus] = useState<LoadStatus>('idle');
  const [mutationStatus, setMutationStatus] = useState<MutationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [profiles, setProfiles] = useState<SavedConnectionProfile[]>([]);
  const [selectedScan, setSelectedScan] = useState<ScanDetail | undefined>();
  const [workbench, setWorkbench] = useState<ScanWorkbench | undefined>();
  const [latestApply, setLatestApply] = useState<
    FixApplyResponse | undefined
  >();
  const [scanLaunchDraft, setScanLaunchDraft] = useState<ScanLaunchDraft>(() =>
    createDefaultScanLaunchDraft(),
  );
  const [scanLauncherOpen, setScanLauncherOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() =>
    readRailCollapsed(),
  );
  const [filters, setFilters] = useState<RailFilters>(() =>
    createDefaultFilters(),
  );
  const [draftInputsByFindingId, setDraftInputsByFindingId] = useState<
    Record<string, FixPreviewInput[]>
  >({});
  const [railScrollTop, setRailScrollTop] = useState(0);
  const [railViewportHeight, setRailViewportHeight] = useState(0);
  const railViewportReference = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(filters.query);

  const effectiveFilters = {
    ...filters,
    query: deferredQuery,
  };
  const normalizedScanLaunchDraft = normalizeScanLaunchDraft(
    scanLaunchDraft,
    profiles,
  );
  const selectedLaunchProfile = getSelectedProfile(
    normalizedScanLaunchDraft,
    profiles,
  );
  const scanLaunchConstraint = getScanLaunchConstraint(
    normalizedScanLaunchDraft,
    profiles,
    profilesStatus,
  );
  const canRunScan =
    mutationStatus !== 'running' && scanLaunchConstraint === undefined;
  const records =
    selectedScan && workbench
      ? buildWorkbenchFindingRecords(selectedScan, workbench)
      : [];
  const filteredRecords = filterWorkbenchFindingRecords(
    records,
    effectiveFilters,
  );
  const groupedRecords = groupWorkbenchFindingRecords(filteredRecords);
  const railRows = flattenRailGroups(groupedRecords);
  const virtualRail = getVisibleVirtualRailRows(
    railRows,
    railScrollTop,
    railViewportHeight,
  );
  const activeFindingId = resolveFindingId(records, route.findingId);
  const activeRecord = records.find(
    (record) => record.finding.id === activeFindingId,
  );
  const activeFinding = activeRecord?.finding;
  const activeEntry = getEntryForFinding(workbench, activeFindingId);
  const activeInputs = getFindingDraftInputs(
    draftInputsByFindingId,
    activeEntry,
    activeFindingId,
  );
  const activePreview = workbench?.latestPreview;
  const activePreviewQueue = activePreview?.queue;
  const stagedCount = workbench?.stagedCount ?? 0;
  const recommendedCount = records.filter(
    (record) => record.status === 'recommended',
  ).length;
  const advisoryCount = records.filter(
    (record) => record.status === 'advisory',
  ).length;
  const navigationRecords =
    filteredRecords.length > 0 ? filteredRecords : records;
  const activeNavigationIndex = navigationRecords.findIndex(
    (record) => record.finding.id === activeFindingId,
  );

  useEffect(() => {
    writeRailCollapsed(railCollapsed);
  }, [railCollapsed]);

  useEffect(() => {
    const nextDraft = normalizeScanLaunchDraft(scanLaunchDraft, profiles);

    if (
      nextDraft.mode === scanLaunchDraft.mode &&
      nextDraft.deep === scanLaunchDraft.deep &&
      nextDraft.profileName === scanLaunchDraft.profileName
    ) {
      return;
    }

    setScanLaunchDraft(nextDraft);
  }, [profiles, scanLaunchDraft]);

  useEffect(() => {
    const viewportElement = railViewportReference.current;

    if (!viewportElement) {
      return;
    }

    const updateViewportHeight = () => {
      setRailViewportHeight(viewportElement.clientHeight);
    };

    updateViewportHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateViewportHeight();
    });

    resizeObserver.observe(viewportElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [railCollapsed, route.scanId]);

  useEffect(() => {
    if (!route.scanId || records.length === 0) {
      return;
    }

    const nextFindingId = resolveFindingId(records, route.findingId);

    if (nextFindingId === route.findingId) {
      return;
    }

    const nextRoute = {
      ...route,
      findingId: nextFindingId,
    };

    writeRoute(nextRoute);
    startTransition(() => {
      setRoute(nextRoute);
    });
  }, [records, route]);

  async function loadHistory() {
    setHistoryStatus('loading');

    try {
      const response = await fetchJson<ScanHistoryResponse>('/api/history');

      startTransition(() => {
        setHistory(response.scans);
        setHistoryStatus('ready');
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown history request error';

      startTransition(() => {
        setHistoryStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function loadProfiles() {
    setProfilesStatus('loading');

    try {
      const response = await fetchJson<ProfileListResponse>('/api/profiles');

      startTransition(() => {
        setProfiles(response.profiles);
        setProfilesStatus('ready');
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown profiles request error';

      startTransition(() => {
        setProfilesStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function loadWorkbench(scanId: string, nextRoute: WorkspaceRoute) {
    setWorkspaceStatus('loading');

    try {
      const response = await fetchJson<ScanWorkbenchResponse>(
        `/api/scans/${scanId}/workbench`,
      );
      const nextRecords = buildWorkbenchFindingRecords(
        response.scan,
        response.workbench,
      );
      const nextFindingId = resolveFindingId(nextRecords, nextRoute.findingId);

      startTransition(() => {
        setSelectedScan(response.scan);
        setWorkbench(response.workbench);
        setLatestApply(undefined);
        setDraftInputsByFindingId({});
        setWorkspaceStatus('ready');
        setErrorMessage('');
        setRailScrollTop(0);
      });

      const normalizedRoute = {
        ...nextRoute,
        findingId: nextFindingId,
      };

      if (
        normalizedRoute.findingId !== route.findingId ||
        normalizedRoute.panel !== route.panel ||
        normalizedRoute.scanId !== route.scanId
      ) {
        writeRoute(normalizedRoute);
        startTransition(() => {
          setRoute(normalizedRoute);
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown workbench request error';

      startTransition(() => {
        setWorkspaceStatus('error');
        setErrorMessage(message);
      });
    }
  }

  useEffect(() => {
    void loadHistory();
    void loadProfiles();

    if (route.scanId) {
      void loadWorkbench(route.scanId, route);
    }
  }, []);

  const handlePopState = useEffectEvent(() => {
    const nextRoute = readRoute();

    startTransition(() => {
      setRoute(nextRoute);
    });

    if (!nextRoute.scanId) {
      startTransition(() => {
        setSelectedScan(undefined);
        setWorkbench(undefined);
        setLatestApply(undefined);
        setDraftInputsByFindingId({});
      });
      return;
    }

    void loadWorkbench(nextRoute.scanId, nextRoute);
  });

  useEffect(() => {
    globalThis.addEventListener('popstate', handlePopState);
    return () => {
      globalThis.removeEventListener('popstate', handlePopState);
    };
  }, [handlePopState]);

  function syncRoute(
    nextRoute: WorkspaceRoute,
    historyMode: 'push' | 'replace' = 'replace',
  ) {
    writeRoute(nextRoute, historyMode);
    startTransition(() => {
      setRoute(nextRoute);
    });
  }

  function openLanding() {
    syncRoute(
      {
        findingId: undefined,
        panel: 'finding',
        scanId: undefined,
      },
      'push',
    );
    startTransition(() => {
      setScanLauncherOpen(false);
      setSelectedScan(undefined);
      setWorkbench(undefined);
      setLatestApply(undefined);
      setDraftInputsByFindingId({});
    });
  }

  function openScan(scanId: string, historyMode: 'push' | 'replace' = 'push') {
    const nextRoute = {
      findingId: undefined,
      panel: 'finding' as const,
      scanId,
    };

    syncRoute(nextRoute, historyMode);
    startTransition(() => {
      setScanLauncherOpen(false);
    });
    void loadWorkbench(scanId, nextRoute);
  }

  function focusWorkbenchAuditSlice(input: {
    findingIds?: string[];
    kind?: RailFilters['kind'];
    query?: string;
  }) {
    if (!route.scanId || records.length === 0) {
      return;
    }

    const nextFilters: RailFilters = {
      kind: input.kind ?? 'all',
      query: input.query ?? '',
      severity: 'all',
      status: 'all',
    };

    startTransition(() => {
      setFilters(nextFilters);
      setRailScrollTop(0);
    });

    const nextRecords = filterWorkbenchFindingRecords(records, nextFilters);
    const nextFindingId =
      input.findingIds?.find((findingId) =>
        nextRecords.some((record) => record.finding.id === findingId),
      ) ?? nextRecords[0]?.finding.id;

    if (!nextFindingId) {
      return;
    }

    syncRoute(
      {
        ...route,
        findingId: nextFindingId,
        panel: 'finding',
        scanId: route.scanId,
      },
      'replace',
    );
  }

  function updateScanLaunchMode(mode: ScanMode) {
    if (mode === 'live') {
      void loadProfiles();
    }

    setScanLaunchDraft((current) =>
      normalizeScanLaunchDraft(
        {
          ...current,
          mode,
        },
        profiles,
      ),
    );
  }

  function refreshProfiles() {
    void loadProfiles();
  }

  function updateScanLaunchProfile(profileName: string) {
    setScanLaunchDraft((current) => ({
      ...current,
      profileName,
    }));
  }

  function updateScanLaunchDeep(deep: boolean) {
    setScanLaunchDraft((current) => ({
      ...current,
      deep,
    }));
  }

  async function runScan() {
    if (scanLaunchConstraint) {
      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(scanLaunchConstraint);
      });
      return;
    }

    const request = buildScanCreateRequest(
      normalizedScanLaunchDraft,
    ) satisfies ScanCreateRequest;
    setMutationStatus('running');

    try {
      const response = await fetchJson<ScanCreateResponse>('/api/scans', {
        body: JSON.stringify(request),
        method: 'POST',
      });

      startTransition(() => {
        setMutationStatus('ready');
        setErrorMessage('');
        setScanLauncherOpen(false);
      });

      await loadHistory();
      openScan(response.scan.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown scan request error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  function updateDraftInput(nextInput: FixPreviewInput) {
    setDraftInputsByFindingId((current) => ({
      ...current,
      [nextInput.findingId]: upsertDraftInput(
        current[nextInput.findingId] ?? [],
        nextInput,
      ),
    }));
  }

  function clearDraftInputs(findingId: string) {
    setDraftInputsByFindingId((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(
          ([currentFindingId]) => currentFindingId !== findingId,
        ),
      );
    });
  }

  async function saveActiveFinding() {
    if (!route.scanId || !selectedScan || !activeFinding || !activeEntry) {
      return;
    }

    setMutationStatus('running');

    try {
      const response = await fetchJson<WorkbenchItemMutationResponse>(
        `/api/scans/${route.scanId}/workbench/items/${encodeURIComponent(activeFinding.id)}`,
        {
          body: JSON.stringify({
            ...(activeInputs.length > 0 ? {inputs: activeInputs} : {}),
          }),
          method: 'PUT',
        },
      );

      const nextRecords = filterWorkbenchFindingRecords(
        buildWorkbenchFindingRecords(selectedScan, response.workbench),
        effectiveFilters,
      );
      const nextFindingId =
        getNextRecommendedFindingId(nextRecords, activeFinding.id) ??
        activeFinding.id;

      clearDraftInputs(activeFinding.id);

      startTransition(() => {
        setWorkbench(response.workbench);
        setLatestApply(undefined);
        setMutationStatus('ready');
        setErrorMessage('');
      });

      syncRoute(
        {
          ...route,
          findingId: nextFindingId,
          panel: 'finding',
          scanId: route.scanId,
        },
        'replace',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown workbench save error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function removeActiveFindingFromBatch() {
    if (!route.scanId || !activeFinding) {
      return;
    }

    setMutationStatus('running');

    try {
      const response = await fetchJson<WorkbenchItemDeleteResponse>(
        `/api/scans/${route.scanId}/workbench/items/${encodeURIComponent(activeFinding.id)}`,
        {
          method: 'DELETE',
        },
      );

      clearDraftInputs(activeFinding.id);

      startTransition(() => {
        setWorkbench(response.workbench);
        setLatestApply(undefined);
        setMutationStatus('ready');
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown workbench remove error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function previewBatch() {
    if (!route.scanId) {
      return;
    }

    setMutationStatus('running');

    try {
      const response = await fetchJson<WorkbenchPreviewResponse>(
        `/api/scans/${route.scanId}/workbench/preview`,
        {
          method: 'POST',
        },
      );

      startTransition(() => {
        setWorkbench(response.workbench);
        setLatestApply(undefined);
        setMutationStatus('ready');
        setErrorMessage('');
      });

      syncRoute(
        {
          ...route,
          panel: 'batch',
          scanId: route.scanId,
        },
        'replace',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown batch preview error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function applyBatch() {
    if (!route.scanId) {
      return;
    }

    setMutationStatus('running');

    try {
      const response = await fetchJson<WorkbenchApplyResponse>(
        `/api/scans/${route.scanId}/workbench/apply`,
        {
          body: JSON.stringify({
            dryRun: true,
          }),
          method: 'POST',
        },
      );

      startTransition(() => {
        setWorkbench(response.workbench);
        setLatestApply(response.apply);
        setMutationStatus('ready');
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown workbench apply error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function createBackupCheckpointForScan() {
    if (!route.scanId || !selectedScan || selectedScan.mode !== 'live') {
      return;
    }

    setMutationStatus('running');

    try {
      await fetchJson<BackupCheckpointResponse>(
        `/api/scans/${route.scanId}/backup-checkpoint`,
        {
          body: JSON.stringify({
            download: true,
          }),
          method: 'POST',
        },
      );

      await loadWorkbench(route.scanId, route);

      startTransition(() => {
        setMutationStatus('ready');
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown backup checkpoint error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  const canStageActiveFinding = canStageFinding(
    activeFinding,
    activeEntry,
    activeInputs,
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {route.scanId ? (
        <>
          <section className={`${panelClass} px-5 py-4 md:px-6`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <button
                  className="text-sm font-semibold text-ink-soft transition hover:text-ink-strong"
                  onClick={openLanding}
                  type="button"
                >
                  Back to scans
                </button>
                <h1 className="mt-3 font-serif text-4xl leading-tight">
                  {selectedScan?.id ?? route.scanId}
                </h1>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  {selectedScan
                    ? `${formatTimestamp(selectedScan.createdAt)} • ${selectedScan.profileName ?? 'No profile'} • ${formatScanMode(selectedScan.mode)}`
                    : 'Loading workbench'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={secondaryButtonClass}
                  onClick={() => {
                    if (!scanLauncherOpen) {
                      refreshProfiles();
                    }

                    setScanLauncherOpen((current) => !current);
                  }}
                  type="button"
                >
                  {scanLauncherOpen ? 'Hide scan settings' : 'New scan'}
                </button>
                {selectedScan?.mode === 'live' && (
                  <button
                    className={secondaryButtonClass}
                    onClick={() => {
                      void createBackupCheckpointForScan();
                    }}
                    type="button"
                  >
                    Capture backup checkpoint
                  </button>
                )}
                <button
                  className={primaryButtonClass}
                  disabled={stagedCount === 0}
                  onClick={() => {
                    syncRoute(
                      {
                        ...route,
                        panel: 'batch',
                        scanId: route.scanId,
                      },
                      'replace',
                    );
                  }}
                  type="button"
                >
                  Review staged batch ({stagedCount})
                </button>
                <span
                  className={`inline-flex rounded-full border px-3 py-2 text-[0.75rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[historyStatus]}`}
                >
                  history {historyStatus}
                </span>
                <span
                  className={`inline-flex rounded-full border px-3 py-2 text-[0.75rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[workspaceStatus]}`}
                >
                  workbench {workspaceStatus}
                </span>
                <span
                  className={`inline-flex rounded-full border px-3 py-2 text-[0.75rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[mutationStatus]}`}
                >
                  actions {mutationStatus}
                </span>
              </div>
            </div>
            {selectedScan && (
              <>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <article className="rounded-[1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Scan posture
                    </p>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">
                      {formatScanMode(selectedScan.mode)} •{' '}
                      {selectedScan.passes.length} pass
                      {selectedScan.passes.length === 1 ? '' : 'es'}
                    </p>
                  </article>
                  <article className="rounded-[1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Scan notes
                    </p>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">
                      {selectedScan.notes.length === 0
                        ? 'No scan notes recorded.'
                        : `${selectedScan.notes.length} note(s) recorded across discovery and config passes.`}
                    </p>
                  </article>
                  <article className="rounded-[1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Backup checkpoint
                    </p>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">
                      {selectedScan.backupCheckpoint
                        ? `${selectedScan.backupCheckpoint.status.replaceAll('_', ' ')} • ${selectedScan.backupCheckpoint.summary}`
                        : 'No backup checkpoint recorded for this scan.'}
                    </p>
                  </article>
                </div>
                {selectedScan.audit &&
                  (() => {
                    const audit = selectedScan.audit;

                    return (
                      <ScanAuditOverview
                        audit={audit}
                        onFocusCleanup={() => {
                          focusWorkbenchAuditSlice({
                            findingIds: audit.cleanupCandidateIds,
                          });
                        }}
                        onFocusConflictCandidates={() => {
                          focusWorkbenchAuditSlice({
                            findingIds: audit.conflictCandidateIds,
                            kind: 'likely_conflicting_controls',
                          });
                        }}
                        onFocusConflictHotspot={(findingIds, query) => {
                          focusWorkbenchAuditSlice({
                            findingIds,
                            kind: 'likely_conflicting_controls',
                            query,
                          });
                        }}
                        onFocusIntentCluster={(query) => {
                          focusWorkbenchAuditSlice({
                            query,
                          });
                        }}
                        onFocusOwnership={() => {
                          focusWorkbenchAuditSlice({
                            findingIds: audit.ownershipHotspotFindingIds,
                            kind: 'entity_ownership_hotspot',
                          });
                        }}
                      />
                    );
                  })()}
              </>
            )}
            {errorMessage && (
              <p className="mt-4 text-sm text-ink-soft">{errorMessage}</p>
            )}
            {scanLauncherOpen && (
              <div className="mt-5">
                <ScanLauncherPanel
                  canRunScan={canRunScan}
                  modeLabel={formatScanAction(normalizedScanLaunchDraft.mode)}
                  mutationStatus={mutationStatus}
                  onRunScan={() => {
                    void runScan();
                  }}
                  onRefreshProfiles={refreshProfiles}
                  onUpdateDeep={updateScanLaunchDeep}
                  onUpdateMode={updateScanLaunchMode}
                  onUpdateProfile={updateScanLaunchProfile}
                  profiles={profiles}
                  profilesStatus={profilesStatus}
                  scanLaunchConstraint={scanLaunchConstraint}
                  scanLaunchDraft={normalizedScanLaunchDraft}
                  selectedProfile={selectedLaunchProfile}
                  title="New scan"
                />
              </div>
            )}
          </section>

          <section
            className={`${panelClass} grid min-h-[72vh] overflow-hidden lg:h-[calc(100vh-11rem)] ${
              railCollapsed
                ? 'grid-cols-[4.5rem_minmax(0,1fr)]'
                : 'grid-cols-[20rem_minmax(0,1fr)]'
            }`}
          >
            <aside className="flex min-h-0 flex-col border-r border-black/8 bg-ink-strong/3">
              <div className="border-b border-black/8 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  {!railCollapsed && (
                    <div>
                      <p className="text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                        Findings
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">
                        {recommendedCount} recommended • {stagedCount} staged •{' '}
                        {advisoryCount} advisory
                      </p>
                    </div>
                  )}
                  <button
                    className={subtleButtonClass}
                    onClick={() => {
                      setRailCollapsed((current) => !current);
                    }}
                    type="button"
                  >
                    {railCollapsed ? 'Show' : 'Hide'}
                  </button>
                </div>

                {!railCollapsed && (
                  <div className="mt-3 grid gap-2">
                    <input
                      className="w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/35"
                      onChange={(event) => {
                        setFilters((current) => ({
                          ...current,
                          query: event.target.value,
                        }));
                      }}
                      placeholder="Search title, evidence, entity id"
                      type="search"
                      value={filters.query}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/35"
                        onChange={(event) => {
                          setFilters((current) => ({
                            ...current,
                            severity: event.target
                              .value as RailFilters['severity'],
                          }));
                        }}
                        value={filters.severity}
                      >
                        <option value="all">All severities</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/35"
                        onChange={(event) => {
                          setFilters((current) => ({
                            ...current,
                            kind: event.target.value as RailFilters['kind'],
                          }));
                        }}
                        value={filters.kind}
                      >
                        <option value="all">All kinds</option>
                        {findingKindFilterOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/35"
                        onChange={(event) => {
                          setFilters((current) => ({
                            ...current,
                            status: event.target.value as RailFilters['status'],
                          }));
                        }}
                        value={filters.status}
                      >
                        <option value="all">All states</option>
                        <option value="recommended">Recommended</option>
                        <option value="staged">Staged</option>
                        <option value="dry_run_applied">Applied</option>
                        <option value="advisory">Advisory</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
                onScroll={(event) => {
                  setRailScrollTop(event.currentTarget.scrollTop);
                }}
                ref={railViewportReference}
              >
                {railRows.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-ink-soft">
                    No findings match the current filters.
                  </p>
                ) : (
                  <div
                    className="relative"
                    style={{
                      height: `${virtualRail.totalHeight}px`,
                    }}
                  >
                    {virtualRail.rows.map((row) => (
                      <RailRow
                        activeFindingId={activeFindingId}
                        collapsed={railCollapsed}
                        key={row.id}
                        onOpenFinding={(findingId) => {
                          syncRoute(
                            {
                              ...route,
                              findingId,
                              panel: 'finding',
                              scanId: route.scanId,
                            },
                            'replace',
                          );
                        }}
                        row={row}
                      />
                    ))}
                  </div>
                )}
              </div>
            </aside>

            <section className="min-h-0 min-w-0 overflow-hidden">
              {route.panel === 'batch' ? (
                <BatchReviewPanel
                  latestApply={latestApply}
                  mutationStatus={mutationStatus}
                  onApplyBatch={() => {
                    void applyBatch();
                  }}
                  onBuildPreview={() => {
                    void previewBatch();
                  }}
                  onReturnToFinding={() => {
                    syncRoute(
                      {
                        ...route,
                        panel: 'finding',
                        scanId: route.scanId,
                      },
                      'replace',
                    );
                  }}
                  workbench={workbench}
                />
              ) : (
                <FindingEditorPanel
                  activeEntry={activeEntry}
                  activeFinding={activeFinding}
                  activeInputs={activeInputs}
                  canStage={canStageActiveFinding}
                  mutationStatus={mutationStatus}
                  navigationIndex={activeNavigationIndex}
                  navigationLength={navigationRecords.length}
                  onBuildPreview={() => {
                    void previewBatch();
                  }}
                  onGoToBatch={() => {
                    syncRoute(
                      {
                        ...route,
                        panel: 'batch',
                        scanId: route.scanId,
                      },
                      'replace',
                    );
                  }}
                  onMoveFinding={(direction) => {
                    const nextRecord =
                      navigationRecords[activeNavigationIndex + direction];

                    if (!nextRecord) {
                      return;
                    }

                    syncRoute(
                      {
                        ...route,
                        findingId: nextRecord.finding.id,
                        panel: 'finding',
                        scanId: route.scanId,
                      },
                      'replace',
                    );
                  }}
                  onNextRecommended={() => {
                    const nextFindingId = getNextRecommendedFindingId(
                      filteredRecords,
                      activeFindingId,
                    );

                    if (!nextFindingId) {
                      return;
                    }

                    syncRoute(
                      {
                        ...route,
                        findingId: nextFindingId,
                        panel: 'finding',
                        scanId: route.scanId,
                      },
                      'replace',
                    );
                  }}
                  onRemove={() => {
                    void removeActiveFindingFromBatch();
                  }}
                  onSave={() => {
                    void saveActiveFinding();
                  }}
                  onUpdateDraftInput={updateDraftInput}
                  selectedScan={selectedScan}
                  stagedCount={stagedCount}
                  workbench={workbench}
                />
              )}
            </section>
          </section>
        </>
      ) : (
        <LandingView
          canRunScan={canRunScan}
          errorMessage={errorMessage}
          history={history}
          historyStatus={historyStatus}
          mutationStatus={mutationStatus}
          onOpenScan={(scanId) => {
            openScan(scanId);
          }}
          onRunScan={() => {
            void runScan();
          }}
          onRefreshProfiles={refreshProfiles}
          onUpdateDeep={updateScanLaunchDeep}
          onUpdateMode={updateScanLaunchMode}
          onUpdateProfile={updateScanLaunchProfile}
          profiles={profiles}
          profilesStatus={profilesStatus}
          scanLaunchConstraint={scanLaunchConstraint}
          scanLaunchDraft={normalizedScanLaunchDraft}
          selectedProfile={selectedLaunchProfile}
        />
      )}
    </main>
  );
}

function LandingView({
  canRunScan,
  errorMessage,
  history,
  historyStatus,
  mutationStatus,
  onOpenScan,
  onRunScan,
  onRefreshProfiles,
  onUpdateDeep,
  onUpdateMode,
  onUpdateProfile,
  profiles,
  profilesStatus,
  scanLaunchConstraint,
  scanLaunchDraft,
  selectedProfile,
}: {
  canRunScan: boolean;
  errorMessage: string;
  history: ScanHistoryEntry[];
  historyStatus: LoadStatus;
  mutationStatus: MutationStatus;
  onOpenScan: (scanId: string) => void;
  onRunScan: () => void;
  onRefreshProfiles: () => void;
  onUpdateDeep: (deep: boolean) => void;
  onUpdateMode: (mode: ScanMode) => void;
  onUpdateProfile: (profileName: string) => void;
  profiles: SavedConnectionProfile[];
  profilesStatus: LoadStatus;
  scanLaunchConstraint: string | undefined;
  scanLaunchDraft: ScanLaunchDraft;
  selectedProfile: SavedConnectionProfile | undefined;
}) {
  return (
    <>
      <section className={`${panelClass} px-6 py-8 md:px-10 md:py-10`}>
        <p className="text-xs font-semibold tracking-[0.22em] text-accent uppercase">
          Operator console
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] sm:text-6xl">
          {appSummary.title}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-ink-soft sm:text-lg">
          {appSummary.tagline}
        </p>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-ink-soft">
          Start a mock or live read-only scan from the browser, then open any
          persisted run and work a dense left-rail queue of recommended fixes.
          Each staged change is stored server-side per scan and reviewed as one
          batch before dry-run apply.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex rounded-full border px-3 py-2 text-[0.75rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[historyStatus]}`}
          >
            history {historyStatus}
          </span>
          <span
            className={`inline-flex rounded-full border px-3 py-2 text-[0.75rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[profilesStatus]}`}
          >
            profiles {profilesStatus}
          </span>
          <span
            className={`inline-flex rounded-full border px-3 py-2 text-[0.75rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[mutationStatus]}`}
          >
            actions {mutationStatus}
          </span>
        </div>
        {errorMessage && (
          <p className="mt-4 text-sm text-ink-soft">{errorMessage}</p>
        )}
        <div className="mt-7">
          <ScanLauncherPanel
            canRunScan={canRunScan}
            modeLabel={formatScanAction(scanLaunchDraft.mode)}
            mutationStatus={mutationStatus}
            onRunScan={onRunScan}
            onRefreshProfiles={onRefreshProfiles}
            onUpdateDeep={onUpdateDeep}
            onUpdateMode={onUpdateMode}
            onUpdateProfile={onUpdateProfile}
            profiles={profiles}
            profilesStatus={profilesStatus}
            scanLaunchConstraint={scanLaunchConstraint}
            scanLaunchDraft={scanLaunchDraft}
            selectedProfile={selectedProfile}
            title="Run a scan"
          />
        </div>
      </section>

      <section className={`${panelClass} px-6 py-6 md:px-8`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-3xl">Saved scans</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Choose a stored scan to open its workbench. The left rail and
              staged batch are designed for large, information-dense result
              sets.
            </p>
          </div>
          <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
            {history.length} scans
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {history.length === 0 ? (
            <p className="rounded-[1rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
              No scans saved yet. Run a mock or live scan to create the first
              workbench.
            </p>
          ) : (
            history.map((entry) => (
              <button
                className="rounded-[1rem] border border-black/8 bg-white/70 px-4 py-4 text-left transition hover:border-ink-strong/15"
                key={entry.id}
                onClick={() => {
                  onOpenScan(entry.id);
                }}
                type="button"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-ink-strong">
                    {entry.id}
                  </span>
                  <span className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                    {(entry.profileName ?? 'No profile') +
                      ' • ' +
                      formatScanMode(entry.mode)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-soft">
                  {entry.findingsCount} findings
                  {entry.backupCheckpointStatus
                    ? ` • checkpoint ${entry.backupCheckpointStatus.replaceAll('_', ' ')}`
                    : ''}
                  {' • '}
                  {formatTimestamp(entry.createdAt)}
                </p>
                <SavedScanAuditSummary entry={entry} />
              </button>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function SavedScanAuditSummary({entry}: {entry: ScanHistoryEntry}) {
  if (!entry.audit) {
    return null;
  }

  const scoreCards = buildAuditScoreCards(entry.audit).slice(0, 2);
  const signalChips = buildAuditSignalChips(entry.audit).slice(0, 2);

  return (
    <div className="mt-3 rounded-[0.9rem] border border-black/8 bg-ink-strong/4 px-3 py-3">
      <p className="text-xs leading-5 text-ink-soft">
        {summarizeAuditObjectCounts(entry.audit.objectCounts, 4)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {scoreCards.map((card) => (
          <span
            className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.12em] uppercase ${getAuditScoreToneClass(card.key, card.value)}`}
            key={card.key}
          >
            {card.label} {formatAuditScore(card.value)}
          </span>
        ))}
        {signalChips.map((chip) => (
          <span
            className="rounded-full border border-black/10 bg-white/75 px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.12em] uppercase text-ink-soft"
            key={chip.key}
          >
            {chip.label} {chip.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScanAuditOverview({
  audit,
  onFocusCleanup,
  onFocusConflictCandidates,
  onFocusConflictHotspot,
  onFocusIntentCluster,
  onFocusOwnership,
}: {
  audit: NonNullable<ScanDetail['audit']>;
  onFocusCleanup: () => void;
  onFocusConflictCandidates: () => void;
  onFocusConflictHotspot: (findingIds: string[], query: string) => void;
  onFocusIntentCluster: (query: string) => void;
  onFocusOwnership: () => void;
}) {
  const scoreCards = buildAuditScoreCards(audit);
  const signalChips = buildAuditSignalChips(audit);
  const conflictHighlights = buildConflictHotspotHighlights(audit);
  const intentHighlights = buildIntentClusterHighlights(audit);
  const conflictHotspotsById = new Map(
    audit.conflictHotspots.map(
      (hotspot) => [hotspot.entityId, hotspot] as const,
    ),
  );
  const intentClustersById = new Map(
    audit.intentClusters.map(
      (cluster) => [cluster.clusterId, cluster] as const,
    ),
  );

  return (
    <section className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <article className="rounded-[1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Audit summary
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              {summarizeAuditObjectCounts(audit.objectCounts)}
            </p>
          </div>
          <span className="rounded-full border border-black/10 bg-white/75 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
            {audit.conflictCandidateIds.length} conflicts
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {scoreCards.map((card) => (
            <div
              className={`rounded-[0.9rem] border px-3 py-3 ${getAuditScoreToneClass(card.key, card.value)}`}
              key={card.key}
            >
              <p className="text-[0.7rem] font-semibold tracking-[0.14em] uppercase">
                {card.label}
              </p>
              <p className="mt-2 text-lg font-semibold">
                {formatAuditScore(card.value)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {signalChips.map((chip) => (
            <span
              className="rounded-full border border-black/10 bg-white/75 px-3 py-2 text-xs font-semibold text-ink-soft"
              key={chip.key}
            >
              {chip.label}: {chip.value}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={subtleButtonClass}
            disabled={audit.cleanupCandidateIds.length === 0}
            onClick={onFocusCleanup}
            type="button"
          >
            Review cleanup findings
          </button>
          <button
            className={subtleButtonClass}
            disabled={audit.conflictCandidateIds.length === 0}
            onClick={onFocusConflictCandidates}
            type="button"
          >
            Review conflict findings
          </button>
          <button
            className={subtleButtonClass}
            disabled={audit.ownershipHotspotFindingIds.length === 0}
            onClick={onFocusOwnership}
            type="button"
          >
            Review ownership findings
          </button>
        </div>
      </article>

      <article className="rounded-[1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Conflict hotspots
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Shared targets with opposing control patterns.
            </p>
          </div>
          <span className="rounded-full border border-black/10 bg-white/75 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
            {audit.conflictHotspots.length}
          </span>
        </div>

        <div className="mt-4 grid gap-2">
          {conflictHighlights.length === 0 ? (
            <p className="rounded-[0.9rem] border border-dashed border-black/10 bg-white/65 px-3 py-3 text-sm text-ink-soft">
              No conflict hotspots detected in this scan.
            </p>
          ) : (
            conflictHighlights.map((highlight) => {
              const hotspot = conflictHotspotsById.get(highlight.id);

              return (
                <div
                  className="rounded-[0.9rem] border border-black/10 bg-white/75 px-3 py-3"
                  key={highlight.id}
                >
                  <p className="text-sm font-semibold text-ink-strong">
                    {highlight.title}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">{highlight.id}</p>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    {highlight.detail}
                  </p>
                  {hotspot && hotspot.findingIds.length > 0 && (
                    <button
                      className="mt-3 text-sm font-semibold text-ink-strong transition hover:text-accent"
                      onClick={() => {
                        onFocusConflictHotspot(
                          hotspot.findingIds,
                          hotspot.entityId,
                        );
                      }}
                      type="button"
                    >
                      Open matching findings
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </article>

      <article className="rounded-[1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Intent clusters
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Writers grouped by similar names, helpers, areas, and targets.
            </p>
          </div>
          <span className="rounded-full border border-black/10 bg-white/75 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
            {audit.intentClusters.length}
          </span>
        </div>

        <div className="mt-4 grid gap-2">
          {intentHighlights.length === 0 ? (
            <p className="rounded-[0.9rem] border border-dashed border-black/10 bg-white/65 px-3 py-3 text-sm text-ink-soft">
              No multi-object intent clusters were inferred from this scan.
            </p>
          ) : (
            intentHighlights.map((highlight) => {
              const cluster = intentClustersById.get(highlight.id);
              const focusQuery =
                cluster?.objectIds[0] ?? cluster?.conceptTerms[0];

              return (
                <div
                  className="rounded-[0.9rem] border border-black/10 bg-white/75 px-3 py-3"
                  key={highlight.id}
                >
                  <p className="text-sm font-semibold text-ink-strong">
                    {highlight.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    {highlight.detail}
                  </p>
                  {focusQuery && (
                    <button
                      className="mt-3 text-sm font-semibold text-ink-strong transition hover:text-accent"
                      onClick={() => {
                        onFocusIntentCluster(focusQuery);
                      }}
                      type="button"
                    >
                      Filter matching findings
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </article>
    </section>
  );
}

function ScanLauncherPanel({
  canRunScan,
  modeLabel,
  mutationStatus,
  onRunScan,
  onRefreshProfiles,
  onUpdateDeep,
  onUpdateMode,
  onUpdateProfile,
  profiles,
  profilesStatus,
  scanLaunchConstraint,
  scanLaunchDraft,
  selectedProfile,
  title,
}: {
  canRunScan: boolean;
  modeLabel: string;
  mutationStatus: MutationStatus;
  onRunScan: () => void;
  onRefreshProfiles: () => void;
  onUpdateDeep: (deep: boolean) => void;
  onUpdateMode: (mode: ScanMode) => void;
  onUpdateProfile: (profileName: string) => void;
  profiles: SavedConnectionProfile[];
  profilesStatus: LoadStatus;
  scanLaunchConstraint: string | undefined;
  scanLaunchDraft: ScanLaunchDraft;
  selectedProfile: SavedConnectionProfile | undefined;
  title: string;
}) {
  const liveMode = scanLaunchDraft.mode === 'live';
  const canToggleDeep = liveMode && Boolean(selectedProfile?.configPath);
  let helperMessage =
    'Mock mode runs against the local fixture inventory and does not require a saved Home Assistant profile.';

  if (liveMode && profilesStatus === 'loading') {
    helperMessage = 'Loading saved Home Assistant profiles from the API.';
  } else if (liveMode && profiles.length === 0) {
    helperMessage =
      'No saved Home Assistant profiles were found. Save one through the CLI or API first.';
  } else if (liveMode && selectedProfile) {
    helperMessage = selectedProfile.configPath
      ? `Live scan will connect to ${selectedProfile.baseUrl} and can include local config analysis from ${selectedProfile.configPath}.`
      : `Live scan will connect to ${selectedProfile.baseUrl}. This profile has no config path, so deep config analysis stays off.`;
  }

  return (
    <section className="rounded-[1.25rem] border border-black/8 bg-ink-strong/4 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">
            {helperMessage}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={secondaryButtonClass}
            disabled={profilesStatus === 'loading'}
            onClick={onRefreshProfiles}
            type="button"
          >
            Refresh profiles
          </button>
          <button
            className={primaryButtonClass}
            disabled={!canRunScan}
            onClick={onRunScan}
            type="button"
          >
            {modeLabel}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <label className="grid gap-2 text-sm text-ink-soft">
          <span className="text-xs font-semibold tracking-[0.16em] uppercase">
            Scan mode
          </span>
          <select
            className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-ink-strong outline-none transition focus:border-accent/35"
            disabled={mutationStatus === 'running'}
            onChange={(event) => {
              onUpdateMode(event.target.value as ScanMode);
            }}
            value={scanLaunchDraft.mode}
          >
            <option value="mock">Mock</option>
            <option value="live">Live read-only</option>
          </select>
        </label>

        {liveMode ? (
          <label className="grid gap-2 text-sm text-ink-soft">
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Saved profile
            </span>
            <select
              className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-ink-strong outline-none transition focus:border-accent/35 disabled:bg-white/60"
              disabled={
                mutationStatus === 'running' ||
                profilesStatus === 'loading' ||
                profiles.length === 0
              }
              onChange={(event) => {
                onUpdateProfile(event.target.value);
              }}
              value={scanLaunchDraft.profileName}
            >
              {profiles.length === 0 ? (
                <option value="">No saved profiles</option>
              ) : (
                profiles.map((profile) => (
                  <option key={profile.name} value={profile.name}>
                    {profile.name}
                    {profile.isDefault ? ' (default)' : ''}
                  </option>
                ))
              )}
            </select>
          </label>
        ) : (
          <div className="rounded-[1rem] border border-dashed border-black/10 bg-white/50 px-4 py-3 text-sm leading-6 text-ink-soft">
            Mock mode skips Home Assistant I/O and uses the deterministic local
            fixture inventory.
          </div>
        )}
      </div>

      {liveMode && (
        <label className="mt-4 flex items-start gap-3 rounded-[1rem] border border-black/8 bg-white/50 px-4 py-3 text-sm text-ink-soft">
          <input
            checked={scanLaunchDraft.deep}
            className="mt-1 h-4 w-4 rounded border-black/20 text-accent"
            disabled={mutationStatus === 'running' || !canToggleDeep}
            onChange={(event) => {
              onUpdateDeep(event.target.checked);
            }}
            type="checkbox"
          />
          <span className="block leading-6">
            Deep config analysis
            <span className="block text-ink-soft">
              Parse `configuration.yaml` plus supported include patterns from
              the selected profile&apos;s local `configPath`.
            </span>
          </span>
        </label>
      )}

      {scanLaunchConstraint && (
        <p className="mt-4 text-sm text-ink-soft">{scanLaunchConstraint}</p>
      )}
    </section>
  );
}

function RailRow({
  activeFindingId,
  collapsed,
  onOpenFinding,
  row,
}: {
  activeFindingId: string | undefined;
  collapsed: boolean;
  onOpenFinding: (findingId: string) => void;
  row: VisibleVirtualRailRow;
}) {
  if (row.type === 'group') {
    return (
      <div
        className="absolute left-0 right-0 px-2 py-1"
        style={{
          top: `${row.top}px`,
        }}
      >
        <div className="rounded-full bg-ink-strong/6 px-2 py-1 text-[0.68rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
          {collapsed ? row.label.slice(0, 1) : row.label}
        </div>
      </div>
    );
  }

  const isActive = row.record.finding.id === activeFindingId;

  return (
    <button
      className={`absolute left-0 right-0 mx-2 rounded-[0.95rem] border px-3 py-2 text-left transition ${
        isActive
          ? 'border-accent/30 bg-accent/10'
          : 'border-black/8 bg-white/70 hover:border-ink-strong/15'
      }`}
      onClick={() => {
        onOpenFinding(row.record.finding.id);
      }}
      style={{
        top: `${row.top}px`,
      }}
      title={row.record.finding.title}
      type="button"
    >
      {collapsed ? (
        <div className="flex h-full items-center justify-center">
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-[0.68rem] font-semibold uppercase ${entryToneClasses[row.record.status]}`}
          >
            {row.record.finding.severity.slice(0, 1)}
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold tracking-[0.16em] uppercase ${entryToneClasses[row.record.status]}`}
            >
              {row.record.status === 'dry_run_applied'
                ? 'applied'
                : row.record.status}
            </span>
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-strong">
              {row.record.finding.title}
            </h3>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold tracking-[0.16em] uppercase ${severityToneClasses[row.record.finding.severity]}`}
            >
              {row.record.finding.severity}
            </span>
          </div>
          <p className="mt-2 truncate text-xs text-ink-soft">
            {getFindingObjectSummary(row.record.finding)}
          </p>
        </>
      )}
    </button>
  );
}

function FindingDefinitionCard({activeFinding}: {activeFinding: Finding}) {
  const definition = getFindingDefinition(activeFinding.kind);

  return (
    <section className="rounded-[1.2rem] border border-black/8 bg-white/72 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
        Definition
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        {definition.definition}
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        <span className="font-semibold text-ink-strong">Why it matters:</span>{' '}
        {definition.whyItMatters}
      </p>
    </section>
  );
}

function FindingActionEditor({
  activeFinding,
  activeInputs,
  onUpdateDraftInput,
  selectedScan,
}: {
  activeFinding: Finding;
  activeInputs: FixPreviewInput[];
  onUpdateDraftInput: (nextInput: FixPreviewInput) => void;
  selectedScan: ScanDetail;
}) {
  switch (activeFinding.kind) {
    case 'duplicate_name': {
      return (
        <DuplicateNameEditor
          activeFinding={activeFinding}
          activeInputs={activeInputs}
          onUpdateDraftInput={onUpdateDraftInput}
          selectedScan={selectedScan}
        />
      );
    }

    case 'assistant_context_bloat': {
      return (
        <AssistantExposureEditor
          activeFinding={activeFinding}
          activeInputs={activeInputs}
          onUpdateDraftInput={onUpdateDraftInput}
        />
      );
    }

    default: {
      return null;
    }
  }
}

function FindingGuidanceCard({
  activeEntry,
  activeFinding,
}: {
  activeEntry: WorkbenchEntry;
  activeFinding: Finding;
}) {
  const findingDefinition = getFindingDefinition(activeFinding.kind);
  const actionKind = getFindingActionKind(activeFinding.kind);
  const actionDefinition =
    actionKind === undefined ? undefined : getFixActionDefinition(actionKind);
  const isActionable = activeEntry.treatment === 'actionable';

  return (
    <section className="rounded-[1.2rem] border border-black/8 bg-white/72 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
        {isActionable ? 'Planned change' : 'Operator review'}
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        {isActionable && actionDefinition
          ? actionDefinition.definition
          : 'This finding stays advisory because it still needs operator judgement or a manual Home Assistant repair.'}
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        <span className="font-semibold text-ink-strong">
          {isActionable ? 'Review focus:' : 'Next step:'}
        </span>{' '}
        {isActionable && actionDefinition
          ? actionDefinition.reviewFocus
          : findingDefinition.operatorGuidance}
      </p>
    </section>
  );
}

function FindingEditorPanel({
  activeEntry,
  activeFinding,
  activeInputs,
  canStage,
  mutationStatus,
  navigationIndex,
  navigationLength,
  onBuildPreview,
  onGoToBatch,
  onMoveFinding,
  onNextRecommended,
  onRemove,
  onSave,
  onUpdateDraftInput,
  selectedScan,
  stagedCount,
  workbench,
}: {
  activeEntry: WorkbenchEntry | undefined;
  activeFinding: Finding | undefined;
  activeInputs: FixPreviewInput[];
  canStage: boolean;
  mutationStatus: MutationStatus;
  navigationIndex: number;
  navigationLength: number;
  onBuildPreview: () => void;
  onGoToBatch: () => void;
  onMoveFinding: (direction: -1 | 1) => void;
  onNextRecommended: () => void;
  onRemove: () => void;
  onSave: () => void;
  onUpdateDraftInput: (nextInput: FixPreviewInput) => void;
  selectedScan: ScanDetail | undefined;
  stagedCount: number;
  workbench: ScanWorkbench | undefined;
}) {
  if (!activeFinding || !activeEntry || !selectedScan || !workbench) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-sm text-ink-soft">Choose a finding from the rail.</p>
      </div>
    );
  }

  const isActionable = activeEntry.treatment === 'actionable';
  const hasSavedBatchVersion = activeEntry.status !== 'recommended';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="border-b border-black/8 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
              Finding {navigationIndex + 1} of {navigationLength}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h2 className="font-serif text-4xl leading-tight">
                {activeFinding.title}
              </h2>
              <span
                className={`inline-flex rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] uppercase ${severityToneClasses[activeFinding.severity]}`}
              >
                {activeFinding.severity}
              </span>
              <span
                className={`inline-flex rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] uppercase ${entryToneClasses[activeEntry.status]}`}
              >
                {formatEntryStatus(activeEntry.status)}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              {activeFinding.evidence}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={secondaryButtonClass}
              disabled={navigationIndex <= 0}
              onClick={() => {
                onMoveFinding(-1);
              }}
              type="button"
            >
              Previous
            </button>
            <button
              className={secondaryButtonClass}
              disabled={navigationIndex >= navigationLength - 1}
              onClick={() => {
                onMoveFinding(1);
              }}
              type="button"
            >
              Next
            </button>
            <button
              className={secondaryButtonClass}
              disabled={
                !workbench.entries.some(
                  (entry) =>
                    entry.status === 'recommended' &&
                    entry.treatment === 'actionable',
                )
              }
              onClick={onNextRecommended}
              type="button"
            >
              Next unstaged
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className={primaryButtonClass}
            disabled={
              !isActionable || !canStage || mutationStatus === 'running'
            }
            onClick={onSave}
            type="button"
          >
            {hasSavedBatchVersion ? 'Update staged fix' : 'Stage fix'}
          </button>
          <button
            className={secondaryButtonClass}
            disabled={!hasSavedBatchVersion || mutationStatus === 'running'}
            onClick={onRemove}
            type="button"
          >
            Remove from batch
          </button>
          <button
            className={secondaryButtonClass}
            disabled={stagedCount === 0}
            onClick={onGoToBatch}
            type="button"
          >
            Review staged batch
          </button>
          <button
            className={subtleButtonClass}
            disabled={stagedCount === 0}
            onClick={onBuildPreview}
            type="button"
          >
            {workbench.isPreviewStale || !workbench.latestPreview
              ? 'Build batch preview'
              : 'Refresh batch preview'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-[1.2rem] border border-black/8 bg-ink-strong/4 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Targets
              </p>
              <p className="mt-3 text-sm text-ink-soft">
                {getFindingObjectSummary(activeFinding)}
              </p>
            </section>

            <FindingDefinitionCard activeFinding={activeFinding} />
            <FindingActionEditor
              activeFinding={activeFinding}
              activeInputs={activeInputs}
              onUpdateDraftInput={onUpdateDraftInput}
              selectedScan={selectedScan}
            />
            <FindingGuidanceCard
              activeEntry={activeEntry}
              activeFinding={activeFinding}
            />
          </div>

          <aside className="min-w-0 space-y-4">
            <article className="rounded-[1.2rem] border border-black/8 bg-ink-strong/4 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Batch state
              </p>
              <p className="mt-3 text-sm leading-6 text-ink-soft">
                {activeEntry.status === 'recommended'
                  ? 'This finding is not staged yet.'
                  : `This finding is currently ${formatEntryStatus(activeEntry.status)} in the batch.`}
              </p>
            </article>

            <article className="rounded-[1.2rem] border border-black/8 bg-ink-strong/4 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Input status
              </p>
              <p className="mt-3 text-sm leading-6 text-ink-soft">
                {getFindingInputStatusSummary(activeFinding, activeInputs)}
              </p>
            </article>

            <article className="rounded-[1.2rem] border border-black/8 bg-ink-strong/4 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Batch preview
              </p>
              <p className="mt-3 text-sm leading-6 text-ink-soft">
                {workbench.isPreviewStale || !workbench.latestPreview
                  ? 'The staged batch needs a fresh preview before dry-run apply.'
                  : `Preview token ${workbench.latestPreview.previewToken.slice(0, 12)} is ready for review.`}
              </p>
              {workbench.latestPreview?.queue && (
                <p className="mt-2 text-xs leading-5 text-ink-soft">
                  Queue{' '}
                  {formatQueueStatus(workbench.latestPreview.queue.status)}
                </p>
              )}
            </article>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DuplicateNameEditor({
  activeFinding,
  activeInputs,
  onUpdateDraftInput,
  selectedScan,
}: {
  activeFinding: Finding;
  activeInputs: FixPreviewInput[];
  onUpdateDraftInput: (nextInput: FixPreviewInput) => void;
  selectedScan: ScanDetail;
}) {
  return (
    <section className="rounded-[1.2rem] border border-black/8 bg-white/72 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink-strong">
            Rename staging table
          </h3>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Fill every row, then stage the finding into the batch.
          </p>
        </div>
        <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
          {activeFinding.objectIds.length} targets
        </span>
      </div>

      <div className="mt-4 space-y-2">
        <div className="hidden gap-3 px-3 text-left text-xs uppercase tracking-[0.16em] text-ink-soft lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
          <p>Entity</p>
          <p>Current</p>
          <p>Recommended</p>
          <p>New name</p>
        </div>

        {activeFinding.objectIds.map((entityId) => {
          const entity = findEntity(selectedScan, entityId);
          const recommendation = entity
            ? `${entity.displayName} (${entity.entityId})`
            : entityId;

          return (
            <div
              className="grid gap-3 rounded-[0.95rem] border border-black/8 bg-ink-strong/3 p-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1fr)]"
              key={entityId}
            >
              <div className="min-w-0">
                <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-soft lg:hidden">
                  Entity
                </p>
                <p className="break-all font-semibold text-ink-strong">
                  {entityId}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {entity?.displayName ?? 'Unknown entity'}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-soft lg:hidden">
                  Current
                </p>
                <p className="break-words text-ink-soft">
                  {entity?.name ?? 'null'}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-soft lg:hidden">
                  Recommended
                </p>
                <p className="break-all text-ink-soft">{recommendation}</p>
              </div>

              <label className="min-w-0">
                <span className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-soft lg:hidden">
                  New name
                </span>
                <input
                  className="mt-1 w-full min-w-0 rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/35"
                  onChange={(event) => {
                    onUpdateDraftInput({
                      field: 'name',
                      findingId: activeFinding.id,
                      targetId: entityId,
                      value: event.target.value,
                    });
                  }}
                  placeholder={recommendation}
                  type="text"
                  value={getNameInputValue(
                    activeInputs,
                    activeFinding.id,
                    entityId,
                  )}
                />
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AssistantExposureEditor({
  activeFinding,
  activeInputs,
  onUpdateDraftInput,
}: {
  activeFinding: Finding;
  activeInputs: FixPreviewInput[];
  onUpdateDraftInput: (nextInput: FixPreviewInput) => void;
}) {
  const entityId = activeFinding.objectIds[0] ?? '';
  const currentExposures = getAssistantExposureTargets(activeFinding);
  const draftedSelection =
    getAssistantExposureInputValue(activeInputs, activeFinding.id, entityId) ??
    currentExposures;

  return (
    <section className="rounded-[1.2rem] border border-black/8 bg-white/72 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink-strong">
            Assistant exposure review
          </h3>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Choose which existing assistant surfaces should keep exposing this
            entity.
          </p>
        </div>
        <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
          {currentExposures.length} surfaces
        </span>
      </div>

      <div className="mt-4 rounded-[0.95rem] border border-black/8 bg-ink-strong/3 p-4">
        <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-soft">
          Current assistant exposures
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {currentExposures.length === 0
            ? 'No assistant surfaces are currently exposed.'
            : currentExposures.join(', ')}
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {currentExposures.map((assistant) => {
            const checked = draftedSelection.includes(assistant);

            return (
              <label
                className="flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-3 text-sm text-ink-strong"
                key={assistant}
              >
                <input
                  checked={checked}
                  className="h-4 w-4 rounded border-black/15 text-accent focus:ring-accent/30"
                  onChange={(event) => {
                    const nextSelection = event.target.checked
                      ? [...draftedSelection, assistant]
                      : draftedSelection.filter(
                          (candidate) => candidate !== assistant,
                        );

                    onUpdateDraftInput({
                      field: 'assistant_exposures',
                      findingId: activeFinding.id,
                      targetId: entityId,
                      value: normalizeAssistantExposureSelection(nextSelection),
                    });
                  }}
                  type="checkbox"
                />
                <span className="font-medium capitalize">{assistant}</span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BatchReviewPanel({
  latestApply,
  mutationStatus,
  onApplyBatch,
  onBuildPreview,
  onReturnToFinding,
  workbench,
}: {
  latestApply: FixApplyResponse | undefined;
  mutationStatus: MutationStatus;
  onApplyBatch: () => void;
  onBuildPreview: () => void;
  onReturnToFinding: () => void;
  workbench: ScanWorkbench | undefined;
}) {
  const preview = workbench?.latestPreview;
  const queue = preview?.queue;
  const isPreviewStale = workbench?.isPreviewStale ?? true;
  const canApply =
    Boolean(preview) &&
    !isPreviewStale &&
    preview?.queue.status === 'pending_review';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-black/8 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
              Batch review
            </p>
            <h2 className="mt-2 font-serif text-4xl leading-tight">
              {workbench?.stagedCount ?? 0} staged finding(s)
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              Review the stored staged batch, build a fresh preview when needed,
              then run one dry-run apply.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={secondaryButtonClass}
              onClick={onReturnToFinding}
              type="button"
            >
              Back to finding
            </button>
            <button
              className={secondaryButtonClass}
              disabled={(workbench?.stagedCount ?? 0) === 0}
              onClick={onBuildPreview}
              type="button"
            >
              {isPreviewStale || !preview
                ? 'Build batch preview'
                : 'Refresh preview'}
            </button>
            <button
              className={primaryButtonClass}
              disabled={!canApply || mutationStatus === 'running'}
              onClick={onApplyBatch}
              type="button"
            >
              Dry-run apply
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <span
            className={`inline-flex rounded-full border px-3 py-2 text-[0.72rem] font-semibold tracking-[0.16em] uppercase ${
              isPreviewStale || !preview
                ? entryToneClasses.recommended
                : entryToneClasses.staged
            }`}
          >
            {isPreviewStale || !preview ? 'preview stale' : 'preview ready'}
          </span>
          {queue && (
            <span className="inline-flex rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-[0.72rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
              {formatQueueStatus(queue.status)}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {latestApply && (
          <section className="mb-5 rounded-[1.2rem] border border-success/20 bg-success/10 p-4">
            <p className="font-semibold text-success">Dry-run complete</p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Queue {latestApply.queue.id} ran at{' '}
              {latestApply.queue.lastAppliedAt
                ? formatTimestamp(latestApply.queue.lastAppliedAt)
                : 'just now'}
              . No live changes were made.
            </p>
          </section>
        )}

        {!workbench || workbench.stagedCount === 0 ? (
          <p className="rounded-[1rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
            Stage at least one actionable finding before opening batch review.
          </p>
        ) : !preview || workbench.isPreviewStale ? (
          <section className="rounded-[1.2rem] border border-black/8 bg-white/72 p-4">
            <p className="font-semibold text-ink-strong">Preview required</p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              The staged batch has changed since the last preview. Build a fresh
              preview to inspect the exact commands and artifacts before dry-run
              apply.
            </p>
          </section>
        ) : (
          <div className="space-y-4">
            <section className="grid gap-3 md:grid-cols-4">
              <BatchMetric
                label="Preview token"
                value={preview.previewToken.slice(0, 12)}
              />
              <BatchMetric
                label="Generated"
                value={formatTimestamp(preview.generatedAt)}
              />
              <BatchMetric
                label="Actions"
                value={preview.actions.length.toString()}
              />
              <BatchMetric
                label="Queue"
                value={formatQueueStatus(preview.queue.status)}
              />
            </section>

            {preview.actions.map((action) => (
              <details
                className="rounded-[1.1rem] border border-black/8 bg-white/72 p-4"
                key={action.id}
                open
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink-strong">
                      {action.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {action.intent}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-[0.68rem] font-semibold tracking-[0.16em] uppercase ${severityToneClasses[action.risk]}`}
                  >
                    {action.risk} risk
                  </span>
                </summary>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-[1rem] border border-black/8 bg-ink-strong/4 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Commands
                    </p>
                    {action.commands.map((command) => (
                      <article className="mt-3" key={command.id}>
                        <p className="text-sm font-semibold text-ink-strong">
                          {command.summary}
                        </p>
                        <pre className="mt-2 overflow-x-auto rounded-[0.9rem] border border-black/8 bg-white/80 p-3 text-xs leading-6 text-ink-soft">
                          {JSON.stringify(command.payload, null, 2)}
                        </pre>
                      </article>
                    ))}
                  </section>

                  <section className="rounded-[1rem] border border-black/8 bg-ink-strong/4 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Artifacts
                    </p>
                    {action.artifacts.map((artifact) => (
                      <article className="mt-3" key={artifact.id}>
                        <p className="text-sm font-semibold text-ink-strong">
                          {artifact.label}
                        </p>
                        <pre className="mt-2 overflow-x-auto rounded-[0.9rem] border border-black/8 bg-white/80 p-3 text-xs leading-6 text-ink-soft">
                          {artifact.content}
                        </pre>
                      </article>
                    ))}
                  </section>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BatchMetric({label, value}: {label: string; value: string}) {
  return (
    <article className="rounded-[1rem] border border-black/8 bg-white/72 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold leading-6 text-ink-strong">
        {value}
      </p>
    </article>
  );
}
