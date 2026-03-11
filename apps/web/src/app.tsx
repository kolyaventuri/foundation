import type {
  Finding,
  FindingAdvisory,
  FixAction,
  FixApplyResponse,
  FixPreviewResponse,
  FrameworkApiResponse,
  ScanDetail,
  ScanHistoryEntry,
  ScanHistoryResponse,
  ScanReadResponse,
} from '@ha-repair/contracts';
import {listProviderDescriptors} from '@ha-repair/llm';
import {createFrameworkSummary} from '@ha-repair/scan-engine';
import {startTransition, useEffect, useEffectEvent, useState} from 'react';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type MutationStatus = 'idle' | 'running' | 'ready' | 'error';
type WorkspaceStage = 'select' | 'review' | 'dry-run';
type WorkspaceDraft = {
  activeFindingId: string | undefined;
  applyResult: FixApplyResponse | undefined;
  preview: FixPreviewResponse | undefined;
  renameInputs: Record<string, string>;
  selectedFindingIds: string[];
};
type WorkspaceStore = {
  scans: Record<string, WorkspaceDraft>;
  version: 1;
};

const workspaceStorageKey = 'ha-repair.web.workspace.v1';

const shellPanelClass =
  'rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7';
const mutedPanelClass =
  'rounded-[1.25rem] border border-black/8 bg-ink-strong/4 p-4';
const primaryButtonClass =
  'rounded-full border border-ink-strong/10 bg-ink-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-ink-soft/50';
const secondaryButtonClass =
  'rounded-full border border-black/10 bg-white/75 px-4 py-2.5 text-sm font-semibold text-ink-strong transition hover:border-ink-strong/25 disabled:cursor-not-allowed disabled:text-ink-soft';
const ghostButtonClass =
  'rounded-full border border-transparent px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:border-black/10 hover:bg-white/55';

const statusToneClasses = {
  error: 'border-accent/15 bg-accent/15 text-accent',
  idle: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  loading: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  running: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  ready: 'border-success/20 bg-success/15 text-success',
} as const;

const surfaceToneClasses = {
  planned: 'border-ink-strong/10 bg-ink-strong/8 text-ink-soft',
  ready: 'border-success/20 bg-success/15 text-success',
} as const;

const severityToneClasses = {
  high: 'border-accent/25 bg-accent/10 text-accent',
  low: 'border-success/25 bg-success/10 text-success',
  medium: 'border-amber-800/20 bg-amber-700/10 text-amber-900',
} as const;

const riskToneClasses = {
  high: 'border-accent/25 bg-accent/10 text-accent',
  low: 'border-success/25 bg-success/10 text-success',
  medium: 'border-amber-800/20 bg-amber-700/10 text-amber-900',
} as const;

const stageOrder: WorkspaceStage[] = ['select', 'review', 'dry-run'];

const initialData: FrameworkApiResponse = {
  framework: createFrameworkSummary(),
  providers: listProviderDescriptors(),
};

type PreviewMatch = {
  action: FixAction | undefined;
  advisory: FindingAdvisory | undefined;
};

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
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatQueueStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

function toggleItem(items: string[], value: string): string[] {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}

function renderDiffSummary(scan: ScanDetail) {
  return [
    ['Regressed', scan.diffSummary.regressedCount],
    ['Resolved', scan.diffSummary.resolvedCount],
    ['Unchanged', scan.diffSummary.unchangedCount],
  ];
}

function canUseStorage(): boolean {
  return 'localStorage' in globalThis;
}

function createDefaultWorkspaceStore(): WorkspaceStore {
  return {
    scans: {},
    version: 1,
  };
}

function readWorkspaceStore(): WorkspaceStore {
  if (!canUseStorage()) {
    return createDefaultWorkspaceStore();
  }

  try {
    const rawValue = globalThis.localStorage.getItem(workspaceStorageKey);

    if (!rawValue) {
      return createDefaultWorkspaceStore();
    }

    const parsed = JSON.parse(rawValue) as Partial<WorkspaceStore>;

    if (
      parsed.version !== 1 ||
      !parsed.scans ||
      typeof parsed.scans !== 'object'
    ) {
      return createDefaultWorkspaceStore();
    }

    return {
      scans: parsed.scans,
      version: 1,
    };
  } catch {
    return createDefaultWorkspaceStore();
  }
}

function getWorkspaceDraft(scanId: string): WorkspaceDraft | undefined {
  return readWorkspaceStore().scans[scanId];
}

function writeWorkspaceDraft(scanId: string, draft: WorkspaceDraft): void {
  if (!canUseStorage()) {
    return;
  }

  const store = readWorkspaceStore();
  store.scans[scanId] = draft;
  globalThis.localStorage.setItem(workspaceStorageKey, JSON.stringify(store));
}

function readRouteScanId(): string | undefined {
  if (globalThis.location === undefined) {
    return undefined;
  }

  const scanId = new URLSearchParams(globalThis.location.search)
    .get('scan')
    ?.trim();
  return scanId && scanId.length > 0 ? scanId : undefined;
}

function writeRouteScanId(
  scanId?: string,
  historyMode: 'push' | 'replace' = 'push',
): void {
  if (globalThis.location === undefined || globalThis.history === undefined) {
    return;
  }

  const nextUrl = new URL(globalThis.location.href);

  if (scanId) {
    nextUrl.searchParams.set('scan', scanId);
  } else {
    nextUrl.searchParams.delete('scan');
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;

  if (historyMode === 'replace') {
    globalThis.history.replaceState({}, '', nextPath);
    return;
  }

  globalThis.history.pushState({}, '', nextPath);
}

function normalizeWorkspaceDraft(
  scan: ScanDetail,
  draft?: WorkspaceDraft,
): WorkspaceDraft & {
  stage: WorkspaceStage;
} {
  const validFindingIds = new Set(scan.findings.map((finding) => finding.id));
  const selectedFindingIds = (draft?.selectedFindingIds ?? []).filter((id) =>
    validFindingIds.has(id),
  );
  const activeFindingId = validFindingIds.has(draft?.activeFindingId ?? '')
    ? draft?.activeFindingId
    : (selectedFindingIds[0] ?? scan.findings[0]?.id);
  const preview =
    draft?.preview?.scanId === scan.id ? draft.preview : undefined;
  const applyResult =
    draft?.applyResult?.scanId === scan.id ? draft.applyResult : undefined;

  return {
    activeFindingId,
    applyResult,
    preview,
    renameInputs: draft?.renameInputs ?? {},
    selectedFindingIds,
    stage: applyResult ? 'dry-run' : preview ? 'review' : 'select',
  };
}

function describeFindingWorkflow(finding: Finding): {
  label: string;
  steps: string[];
  summary: string;
  warnings: string[];
} {
  switch (finding.kind) {
    case 'duplicate_name': {
      return {
        label: 'Rename planning',
        steps: [
          'Select the finding to include it in the reviewed command plan.',
          'Enter the exact entity registry names you want to send for each duplicate.',
          'Build a reviewed preview before the dry-run apply step becomes available.',
        ],
        summary:
          'Duplicate display names stay read-only until you provide literal entity registry names for each target entity.',
        warnings: [
          'Registry renames can affect dashboards, automations, and assistant phrasing that depend on the current labels.',
        ],
      };
    }

    case 'stale_entity': {
      return {
        label: 'Disable review',
        steps: [
          'Confirm the entity is no longer an active source in Home Assistant.',
          'Preview the entity registry update that sets disabled_by to user.',
          'Run another scan after the dry-run plan looks correct.',
        ],
        summary:
          'Stale entities can move straight into a reviewed disable command plan with no extra operator input.',
        warnings: [
          'Disabling the wrong entity can break dashboards or automations that still rely on it.',
        ],
      };
    }

    case 'orphaned_entity_device': {
      return {
        label: 'Manual remediation',
        steps: [
          'Inspect the missing device reference and confirm which integration or registry record is stale.',
          'Repair or recreate the source record directly in Home Assistant.',
          'Run another scan to confirm the advisory resolves.',
        ],
        summary:
          'This finding stays advisory-only because the normal admin websocket API does not expose a safe device relink mutation.',
        warnings: [
          'Repairing the wrong registry record can disrupt entity grouping and device relationships.',
        ],
      };
    }
  }

  throw new Error('Unhandled finding kind');
}

function getEntityRecommendation(
  scan: ScanDetail,
  entityId: string,
): {
  currentValue: string | null;
  displayLabel: string;
  recommendation: string;
} {
  const entity = scan.inventory.entities.find(
    (candidate) => candidate.entityId === entityId,
  );

  return {
    currentValue: entity?.name ?? null,
    displayLabel: entity?.displayName ?? entityId,
    recommendation: entity
      ? `${entity.displayName} (${entity.entityId})`
      : entityId,
  };
}

function getPreviewForFinding(
  preview: FixPreviewResponse | undefined,
  findingId: string | undefined,
): PreviewMatch {
  if (!preview || !findingId) {
    return {
      action: undefined,
      advisory: undefined,
    };
  }

  return {
    action: preview.actions.find((item) => item.findingId === findingId),
    advisory: preview.advisories.find((item) => item.findingId === findingId),
  };
}

export function App() {
  const [data, setData] = useState(initialData);
  const [frameworkStatus, setFrameworkStatus] = useState<LoadStatus>('idle');
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>('idle');
  const [mutationStatus, setMutationStatus] = useState<MutationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [routeScanId, setRouteScanId] = useState<string | undefined>(() =>
    readRouteScanId(),
  );
  const [selectedScanId, setSelectedScanId] = useState<string>();
  const [selectedScan, setSelectedScan] = useState<ScanDetail>();
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [renameInputs, setRenameInputs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FixPreviewResponse>();
  const [applyResult, setApplyResult] = useState<FixApplyResponse>();
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [workspaceStage, setWorkspaceStage] =
    useState<WorkspaceStage>('select');
  const [activeFindingId, setActiveFindingId] = useState<string>();

  const currentView = routeScanId ? 'workspace' : 'landing';
  const activeQueue = applyResult?.queue ?? preview?.queue;
  const activeFinding =
    selectedScan?.findings.find((finding) => finding.id === activeFindingId) ??
    selectedScan?.findings[0];
  const activeFindingIndex =
    selectedScan?.findings.findIndex(
      (finding) => finding.id === activeFinding?.id,
    ) ?? -1;
  const latestScan = history[0];
  const continueScanId = selectedScanId ?? latestScan?.id;
  const currentPreview = getPreviewForFinding(preview, activeFinding?.id);
  const activeFindingPreviewId = activeFinding?.id;
  const previewContainsActiveFinding =
    activeFindingPreviewId !== undefined &&
    Boolean(preview?.selection.findingIds.includes(activeFindingPreviewId));

  function clearSelectedScanState() {
    startTransition(() => {
      setSelectedScanId(undefined);
      setSelectedScan(undefined);
      setSelectedFindingIds([]);
      setRenameInputs({});
      setPreview(undefined);
      setApplyResult(undefined);
      setReviewConfirmed(false);
      setWorkspaceStage('select');
      setActiveFindingId(undefined);
    });
  }

  function hydrateSelectedScan(scan: ScanDetail) {
    const restoredDraft = normalizeWorkspaceDraft(
      scan,
      getWorkspaceDraft(scan.id),
    );

    startTransition(() => {
      setSelectedScanId(scan.id);
      setSelectedScan(scan);
      setSelectedFindingIds(restoredDraft.selectedFindingIds);
      setRenameInputs(restoredDraft.renameInputs);
      setPreview(restoredDraft.preview);
      setApplyResult(restoredDraft.applyResult);
      setReviewConfirmed(false);
      setWorkspaceStage(restoredDraft.stage);
      setActiveFindingId(restoredDraft.activeFindingId);
      setErrorMessage('');
    });
  }

  async function loadScan(scanId: string) {
    const response = await fetchJson<ScanReadResponse>(`/api/scans/${scanId}`);
    hydrateSelectedScan(response.scan);
  }

  async function loadHistory(
    preferredScanId?: string,
    options?: {
      preloadedScan?: ScanDetail;
    },
  ) {
    setHistoryStatus('loading');

    try {
      const response = await fetchJson<ScanHistoryResponse>('/api/history');
      const nextHistory = response.scans;
      const nextScanId =
        preferredScanId ??
        (selectedScanId &&
        nextHistory.some((entry) => entry.id === selectedScanId)
          ? selectedScanId
          : nextHistory[0]?.id);

      startTransition(() => {
        setHistory(nextHistory);
        setHistoryStatus('ready');
        setErrorMessage('');
      });

      if (!nextScanId) {
        clearSelectedScanState();
        return;
      }

      if (options?.preloadedScan?.id === nextScanId) {
        hydrateSelectedScan(options.preloadedScan);
        return;
      }

      await loadScan(nextScanId);
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

  useEffect(() => {
    async function loadFrameworkAndHistory() {
      setFrameworkStatus('loading');

      try {
        const nextData =
          await fetchJson<FrameworkApiResponse>('/api/framework');

        startTransition(() => {
          setData(nextData);
          setFrameworkStatus('ready');
          setErrorMessage('');
        });

        const requestedScanId = readRouteScanId();
        await loadHistory(requestedScanId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown request error';

        startTransition(() => {
          setFrameworkStatus('error');
          setHistoryStatus('error');
          setErrorMessage(message);
        });
      }
    }

    void loadFrameworkAndHistory();
  }, []);

  useEffect(() => {
    if (!selectedScanId) {
      return;
    }

    writeWorkspaceDraft(selectedScanId, {
      activeFindingId,
      applyResult,
      preview,
      renameInputs,
      selectedFindingIds,
    });
  }, [
    activeFindingId,
    applyResult,
    preview,
    renameInputs,
    selectedFindingIds,
    selectedScanId,
  ]);

  const handlePopState = useEffectEvent(() => {
    const nextScanId = readRouteScanId();

    startTransition(() => {
      setRouteScanId(nextScanId);
    });

    if (!nextScanId || nextScanId === selectedScanId) {
      return;
    }

    void loadScan(nextScanId).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown scan request error';

      startTransition(() => {
        setErrorMessage(message);
      });
    });
  });

  useEffect(() => {
    globalThis.addEventListener('popstate', handlePopState);
    return () => {
      globalThis.removeEventListener('popstate', handlePopState);
    };
  }, [handlePopState]);

  function navigateToLanding() {
    writeRouteScanId(undefined);
    startTransition(() => {
      setRouteScanId(undefined);
    });
  }

  function navigateToWorkspace(
    scanId: string,
    options?: {
      historyMode?: 'push' | 'replace';
      skipLoad?: boolean;
    },
  ) {
    writeRouteScanId(scanId, options?.historyMode);

    startTransition(() => {
      setRouteScanId(scanId);
    });

    if ((options?.skipLoad ?? false) || selectedScanId === scanId) {
      return;
    }

    void loadScan(scanId).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown scan request error';

      startTransition(() => {
        setErrorMessage(message);
      });
    });
  }

  async function runScan() {
    setMutationStatus('running');

    try {
      const response = await fetchJson<ScanReadResponse>('/api/scans', {
        method: 'POST',
      });

      startTransition(() => {
        setMutationStatus('ready');
        setErrorMessage('');
      });

      await loadHistory(response.scan.id, {
        preloadedScan: response.scan,
      });
      navigateToWorkspace(response.scan.id, {
        skipLoad: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown scan request error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  function invalidatePreviewState() {
    setPreview(undefined);
    setApplyResult(undefined);
    setReviewConfirmed(false);
    setWorkspaceStage('select');
  }

  function updateFindingSelection(findingId: string) {
    startTransition(() => {
      setSelectedFindingIds((current) => toggleItem(current, findingId));
      setActiveFindingId(findingId);
      invalidatePreviewState();
    });
  }

  function selectAllFindings() {
    if (!selectedScan) {
      return;
    }

    startTransition(() => {
      setSelectedFindingIds(selectedScan.findings.map((finding) => finding.id));
      setActiveFindingId(selectedScan.findings[0]?.id);
      invalidatePreviewState();
    });
  }

  function clearSelectedFindings() {
    startTransition(() => {
      setSelectedFindingIds([]);
      invalidatePreviewState();
    });
  }

  function updateRenameInput(entityId: string, value: string) {
    startTransition(() => {
      setRenameInputs((current) => ({
        ...current,
        [entityId]: value,
      }));
      invalidatePreviewState();
    });
  }

  function moveFinding(direction: -1 | 1) {
    if (!selectedScan || activeFindingIndex < 0) {
      return;
    }

    const nextFinding = selectedScan.findings[activeFindingIndex + direction];

    if (!nextFinding) {
      return;
    }

    setActiveFindingId(nextFinding.id);
  }

  async function previewSelectedFixes() {
    if (!selectedScanId || selectedFindingIds.length === 0) {
      return;
    }

    setMutationStatus('running');

    try {
      const inputs =
        selectedScan?.findings.flatMap((finding) => {
          if (finding.kind !== 'duplicate_name') {
            return [];
          }

          return finding.objectIds.flatMap((entityId) => {
            const value = renameInputs[entityId]?.trim();

            if (!value || !selectedFindingIds.includes(finding.id)) {
              return [];
            }

            return [
              {
                field: 'name' as const,
                findingId: finding.id,
                targetId: entityId,
                value,
              },
            ];
          });
        }) ?? [];
      const nextPreview = await fetchJson<FixPreviewResponse>(
        '/api/fixes/preview',
        {
          body: JSON.stringify({
            findingIds: selectedFindingIds,
            ...(inputs.length > 0 ? {inputs} : {}),
            scanId: selectedScanId,
          }),
          method: 'POST',
        },
      );

      const nextActiveFindingId =
        selectedFindingIds.find((findingId) =>
          nextPreview.selection.findingIds.includes(findingId),
        ) ??
        selectedFindingIds[0] ??
        activeFindingId;

      startTransition(() => {
        setPreview(nextPreview);
        setApplyResult(undefined);
        setReviewConfirmed(false);
        setMutationStatus('ready');
        setWorkspaceStage('review');
        setActiveFindingId(nextActiveFindingId);
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown preview request error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  async function applyReviewedPreview() {
    if (!preview || !reviewConfirmed) {
      return;
    }

    setMutationStatus('running');

    try {
      const response = await fetchJson<FixApplyResponse>('/api/fixes/apply', {
        body: JSON.stringify({
          actionIds: preview.selection.actionIds,
          dryRun: true,
          previewToken: preview.previewToken,
          scanId: preview.scanId,
        }),
        method: 'POST',
      });

      startTransition(() => {
        setApplyResult(response);
        setMutationStatus('ready');
        setWorkspaceStage('dry-run');
        setErrorMessage('');
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown apply request error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {currentView === 'landing' ? (
        <LandingPage
          continueScanId={continueScanId}
          data={data}
          errorMessage={errorMessage}
          frameworkStatus={frameworkStatus}
          history={history}
          historyStatus={historyStatus}
          mutationStatus={mutationStatus}
          onContinue={() => {
            if (!continueScanId) {
              return;
            }

            navigateToWorkspace(continueScanId, {
              skipLoad: selectedScanId === continueScanId,
            });
          }}
          onOpenScan={(scanId) => {
            navigateToWorkspace(scanId, {
              skipLoad: selectedScanId === scanId,
            });
          }}
          onRunScan={() => {
            void runScan();
          }}
          selectedScan={selectedScan}
        />
      ) : (
        <ResultsWorkspace
          activeFinding={activeFinding}
          activeFindingIndex={activeFindingIndex}
          activePreview={currentPreview}
          activeQueue={activeQueue}
          applyResult={applyResult}
          errorMessage={errorMessage}
          frameworkStatus={frameworkStatus}
          history={history}
          historyStatus={historyStatus}
          mutationStatus={mutationStatus}
          onActivateFinding={(findingId) => {
            setActiveFindingId(findingId);
          }}
          onApplyReviewedPreview={() => {
            void applyReviewedPreview();
          }}
          onBackToLanding={navigateToLanding}
          onChangeStage={(nextStage) => {
            if (nextStage === 'review' && !preview) {
              return;
            }

            if (nextStage === 'dry-run' && !applyResult) {
              return;
            }

            setWorkspaceStage(nextStage);
          }}
          onClearSelectedFindings={clearSelectedFindings}
          onMoveFinding={moveFinding}
          onOpenScan={(scanId) => {
            navigateToWorkspace(scanId, {
              skipLoad: selectedScanId === scanId,
            });
          }}
          onPreviewSelectedFixes={() => {
            void previewSelectedFixes();
          }}
          onReviewConfirmedChange={setReviewConfirmed}
          onRunScan={() => {
            void runScan();
          }}
          onSelectAllFindings={selectAllFindings}
          onToggleFinding={updateFindingSelection}
          onUpdateRenameInput={updateRenameInput}
          preview={preview}
          previewContainsActiveFinding={previewContainsActiveFinding}
          renameInputs={renameInputs}
          reviewConfirmed={reviewConfirmed}
          selectedFindingIds={selectedFindingIds}
          selectedScan={selectedScan}
          workspaceStage={workspaceStage}
        />
      )}
    </main>
  );
}

function LandingPage({
  continueScanId,
  data,
  errorMessage,
  frameworkStatus,
  history,
  historyStatus,
  mutationStatus,
  onContinue,
  onOpenScan,
  onRunScan,
  selectedScan,
}: {
  continueScanId: string | undefined;
  data: FrameworkApiResponse;
  errorMessage: string;
  frameworkStatus: LoadStatus;
  history: ScanHistoryEntry[];
  historyStatus: LoadStatus;
  mutationStatus: MutationStatus;
  onContinue: () => void;
  onOpenScan: (scanId: string) => void;
  onRunScan: () => void;
  selectedScan: ScanDetail | undefined;
}) {
  const latestScan = history[0];
  const statusSummary = [
    ['framework', frameworkStatus],
    ['history', historyStatus],
    ['review flow', mutationStatus],
  ] as const;

  return (
    <>
      <section className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-white/72 px-6 py-8 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:px-10 md:py-12">
        <div className="pointer-events-none absolute -top-3 -left-16 h-40 w-40 rounded-full bg-accent-soft/35 blur-3xl" />
        <div className="pointer-events-none absolute top-16 right-0 h-36 w-36 rounded-full bg-emerald-900/12 blur-3xl" />
        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_24rem] xl:items-end">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold tracking-[0.22em] text-accent uppercase">
              Local repair workspace
            </p>
            <h1 className="mt-3 max-w-[12ch] font-serif text-5xl leading-[0.95] sm:text-6xl lg:text-[5.25rem]">
              {data.framework.title}
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-ink-soft sm:text-lg">
              {data.framework.tagline}
            </p>
            <p className="mt-5 max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">
              Start a scan from here, then move into a dedicated results
              workspace where findings, draft selections, and reviewed previews
              stay attached to each saved scan.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                className={primaryButtonClass}
                onClick={onRunScan}
                type="button"
              >
                Run mock scan
              </button>
              <button
                className={secondaryButtonClass}
                disabled={!continueScanId}
                onClick={onContinue}
                type="button"
              >
                {continueScanId
                  ? 'Continue saved workspace'
                  : 'No saved scan yet'}
              </button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {statusSummary.map(([label, value]) => (
                <span
                  className={`inline-flex rounded-full border px-3 py-2 text-[0.78rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[value]}`}
                  key={label}
                >
                  {label} {value}
                </span>
              ))}
              {errorMessage && (
                <span className="text-sm text-ink-soft">{errorMessage}</span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <LandingMetric
              label="Stored scans"
              value={history.length.toString()}
            />
            <LandingMetric
              label="Latest findings"
              value={latestScan ? latestScan.findingsCount.toString() : '0'}
            />
            <LandingMetric
              label="Last scan"
              value={
                latestScan ? formatTimestamp(latestScan.createdAt) : 'Not yet'
              }
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <section className={shellPanelClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-3xl">Saved scan library</h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base">
                Open any persisted scan and resume its fix workspace without
                rerunning the detector.
              </p>
            </div>
            {selectedScan && (
              <button
                className={ghostButtonClass}
                onClick={() => {
                  onOpenScan(selectedScan.id);
                }}
                type="button"
              >
                Open current scan
              </button>
            )}
          </div>

          <div className="mt-5 grid gap-3">
            {history.length === 0 ? (
              <p className="rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
                No scans yet. Run a mock scan to create the first workspace.
              </p>
            ) : (
              history.map((entry) => (
                <button
                  className={`rounded-[1.2rem] border px-4 py-4 text-left transition ${
                    entry.id === selectedScan?.id
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-black/8 bg-white/70 hover:border-ink-strong/15'
                  }`}
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
                      {entry.profileName ?? 'No profile'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    {entry.findingsCount} findings •{' '}
                    {formatTimestamp(entry.createdAt)}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-6">
          <section className={shellPanelClass}>
            <div className="flex flex-col gap-2">
              <h2 className="font-serif text-3xl">Workspace flow</h2>
              <p className="max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">
                The landing page is now just entry and storage management. The
                scan workspace stays focused on one finding at a time.
              </p>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <WorkflowStepCard
                body="Choose a saved scan, or run a new one, and keep each result set as its own resumable workspace."
                index="01"
                title="Open a scan"
              />
              <WorkflowStepCard
                body="Use the findings rail to step through issues, select only what you want, and enter exact reviewed inputs."
                index="02"
                title="Work the queue"
              />
              <WorkflowStepCard
                body="Generate a reviewed preview, confirm the literal payloads, then queue a dry-run apply with the stored preview token."
                index="03"
                title="Review safely"
              />
            </div>

            <div className="mt-5 rounded-[1.3rem] border border-accent/15 bg-accent/8 p-4 text-sm leading-6 text-ink-soft">
              <p className="font-semibold text-ink-strong">Resume behavior</p>
              <p className="mt-2">
                Scan history is persisted in SQLite, and the web app now caches
                per-scan selections, rename drafts, and reviewed preview data in
                the browser so you can leave and return later without
                rescanning.
              </p>
            </div>
          </section>

          <section className={shellPanelClass}>
            <div className="flex flex-col gap-2">
              <h2 className="font-serif text-3xl">Platform posture</h2>
              <p className="max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">
                The core workflow stays deterministic first and treats providers
                as optional enrichment.
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="grid gap-3">
                {data.framework.surfaces.map((surface) => (
                  <article
                    className="rounded-[1.2rem] border border-black/8 bg-white/75 p-4"
                    key={surface.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-semibold text-ink-strong">
                        {surface.name}
                      </h3>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold tracking-[0.14em] uppercase ${surfaceToneClasses[surface.state]}`}
                      >
                        {surface.state}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">
                      {surface.summary}
                    </p>
                  </article>
                ))}
              </div>

              <div className="grid gap-3">
                {data.providers.map((provider) => (
                  <article
                    className="rounded-[1.2rem] border border-black/8 bg-ink-strong p-5 text-white"
                    key={provider.id}
                  >
                    <h3 className="font-serif text-2xl">{provider.label}</h3>
                    <p className="mt-3 text-sm leading-6 text-white/74">
                      {provider.description}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </section>
      </section>
    </>
  );
}

function ResultsWorkspace({
  activeFinding,
  activeFindingIndex,
  activePreview,
  activeQueue,
  applyResult,
  errorMessage,
  frameworkStatus,
  history,
  historyStatus,
  mutationStatus,
  onActivateFinding,
  onApplyReviewedPreview,
  onBackToLanding,
  onChangeStage,
  onClearSelectedFindings,
  onMoveFinding,
  onOpenScan,
  onPreviewSelectedFixes,
  onReviewConfirmedChange,
  onRunScan,
  onSelectAllFindings,
  onToggleFinding,
  onUpdateRenameInput,
  preview,
  previewContainsActiveFinding,
  renameInputs,
  reviewConfirmed,
  selectedFindingIds,
  selectedScan,
  workspaceStage,
}: {
  activeFinding: Finding | undefined;
  activeFindingIndex: number;
  activePreview: PreviewMatch;
  activeQueue: FixPreviewResponse['queue'] | undefined;
  applyResult: FixApplyResponse | undefined;
  errorMessage: string;
  frameworkStatus: LoadStatus;
  history: ScanHistoryEntry[];
  historyStatus: LoadStatus;
  mutationStatus: MutationStatus;
  onActivateFinding: (findingId: string) => void;
  onApplyReviewedPreview: () => void;
  onBackToLanding: () => void;
  onChangeStage: (stage: WorkspaceStage) => void;
  onClearSelectedFindings: () => void;
  onMoveFinding: (direction: -1 | 1) => void;
  onOpenScan: (scanId: string) => void;
  onPreviewSelectedFixes: () => void;
  onReviewConfirmedChange: (value: boolean) => void;
  onRunScan: () => void;
  onSelectAllFindings: () => void;
  onToggleFinding: (findingId: string) => void;
  onUpdateRenameInput: (entityId: string, value: string) => void;
  preview: FixPreviewResponse | undefined;
  previewContainsActiveFinding: boolean;
  renameInputs: Record<string, string>;
  reviewConfirmed: boolean;
  selectedFindingIds: string[];
  selectedScan: ScanDetail | undefined;
  workspaceStage: WorkspaceStage;
}) {
  const selectedCount = selectedFindingIds.length;
  const stepAvailability = {
    'dry-run': Boolean(applyResult),
    review: Boolean(preview),
    select: true,
  } as const;
  const queueStatus = activeQueue
    ? formatQueueStatus(activeQueue.status)
    : undefined;

  return (
    <>
      <section className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-white/72 px-6 py-8 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:px-10">
        <div className="pointer-events-none absolute -top-6 left-1/3 h-48 w-48 rounded-full bg-accent-soft/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <button
              className="text-sm font-semibold text-ink-soft transition hover:text-ink-strong"
              onClick={onBackToLanding}
              type="button"
            >
              Back to landing
            </button>
            <p className="mt-5 text-xs font-semibold tracking-[0.22em] text-accent uppercase">
              Results workspace
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
              {selectedScan ? selectedScan.id : 'Loading saved scan'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft sm:text-base">
              Work one finding at a time from the rail, keep only the fixes you
              want selected, and return later to the same saved scan and draft
              state.
            </p>
            {selectedScan && (
              <p className="mt-3 text-sm text-ink-soft">
                {formatTimestamp(selectedScan.createdAt)} •{' '}
                {selectedScan.profileName ?? 'No profile'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className={secondaryButtonClass}
              onClick={onRunScan}
              type="button"
            >
              Run new mock scan
            </button>
            <span
              className={`inline-flex rounded-full border px-3 py-2 text-[0.78rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[frameworkStatus]}`}
            >
              framework {frameworkStatus}
            </span>
            <span
              className={`inline-flex rounded-full border px-3 py-2 text-[0.78rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[historyStatus]}`}
            >
              history {historyStatus}
            </span>
            <span
              className={`inline-flex rounded-full border px-3 py-2 text-[0.78rem] font-semibold tracking-[0.16em] uppercase ${statusToneClasses[mutationStatus]}`}
            >
              review flow {mutationStatus}
            </span>
          </div>
        </div>
        {errorMessage && (
          <p className="relative mt-5 text-sm text-ink-soft">{errorMessage}</p>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <section className={shellPanelClass}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-3xl">Scan snapshot</h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Saved locally and reusable until you decide a fresh scan is
                  needed.
                </p>
              </div>
              {queueStatus && (
                <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                  {queueStatus}
                </span>
              )}
            </div>

            {selectedScan ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                {renderDiffSummary(selectedScan).map(([label, value]) => (
                  <article
                    className="rounded-[1.1rem] border border-black/8 bg-ink-strong/4 px-4 py-3"
                    key={label}
                  >
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      {label}
                    </p>
                    <p className="mt-2 font-serif text-3xl">{value}</p>
                  </article>
                ))}
                <article className="rounded-[1.1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                    Selected
                  </p>
                  <p className="mt-2 font-serif text-3xl">{selectedCount}</p>
                </article>
              </div>
            ) : (
              <p className="mt-5 rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
                Loading scan details.
              </p>
            )}
          </section>

          <section className={shellPanelClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-3xl">Scan library</h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Swap between saved result sets without leaving the workspace.
                </p>
              </div>
              <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                {history.length} saved
              </span>
            </div>

            <div className="mt-5 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
              {history.map((entry) => (
                <button
                  className={`w-full rounded-[1.1rem] border px-4 py-3 text-left transition ${
                    entry.id === selectedScan?.id
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-black/8 bg-white/70 hover:border-ink-strong/15'
                  }`}
                  key={entry.id}
                  onClick={() => {
                    onOpenScan(entry.id);
                  }}
                  type="button"
                >
                  <p className="font-semibold text-ink-strong">{entry.id}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {entry.findingsCount} findings •{' '}
                    {formatTimestamp(entry.createdAt)}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className={shellPanelClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-3xl">Findings rail</h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Step through the scan one issue at a time instead of opening
                  every fix at once.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={ghostButtonClass}
                  disabled={!selectedScan}
                  onClick={onSelectAllFindings}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className={ghostButtonClass}
                  disabled={selectedCount === 0}
                  onClick={onClearSelectedFindings}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-5 max-h-[36rem] space-y-2 overflow-y-auto pr-1">
              {selectedScan?.findings.map((finding) => (
                <FindingRailItem
                  finding={finding}
                  isActive={finding.id === activeFinding?.id}
                  isPreviewed={Boolean(
                    preview?.selection.findingIds.includes(finding.id),
                  )}
                  isSelected={selectedFindingIds.includes(finding.id)}
                  key={finding.id}
                  onActivate={() => {
                    onActivateFinding(finding.id);
                  }}
                  onToggle={() => {
                    onToggleFinding(finding.id);
                  }}
                />
              ))}
            </div>
          </section>
        </aside>

        <section className="grid gap-6">
          <section className={shellPanelClass}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-3xl">Repair flow</h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Keep the rail compact, then open just the current detail panel
                  for selection, review, or dry-run confirmation.
                </p>
              </div>
              <button
                className={primaryButtonClass}
                disabled={!selectedScan || selectedCount === 0}
                onClick={onPreviewSelectedFixes}
                type="button"
              >
                {preview
                  ? 'Rebuild reviewed preview'
                  : 'Build reviewed preview'}
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {stageOrder.map((stage) => (
                <button
                  className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                    workspaceStage === stage
                      ? 'border-accent/30 bg-accent/10 text-ink-strong'
                      : stepAvailability[stage]
                        ? 'border-black/10 bg-white/75 text-ink-soft hover:border-ink-strong/20'
                        : 'border-black/10 bg-white/45 text-ink-soft/60'
                  }`}
                  disabled={!stepAvailability[stage]}
                  key={stage}
                  onClick={() => {
                    onChangeStage(stage);
                  }}
                  type="button"
                >
                  {stage === 'select'
                    ? 'Select fixes'
                    : stage === 'review'
                      ? 'Review preview'
                      : 'Dry run'}
                </button>
              ))}
            </div>
          </section>

          {!selectedScan || !activeFinding ? (
            <section className={shellPanelClass}>
              <p className="rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
                Choose a scan from the library to open its findings workspace.
              </p>
            </section>
          ) : workspaceStage === 'select' ? (
            <FindingSelectionPanel
              activeFinding={activeFinding}
              activeFindingIndex={activeFindingIndex}
              onMoveFinding={onMoveFinding}
              onToggleFinding={() => {
                onToggleFinding(activeFinding.id);
              }}
              onUpdateRenameInput={onUpdateRenameInput}
              renameInputs={renameInputs}
              selectedFindingIds={selectedFindingIds}
              selectedScan={selectedScan}
            />
          ) : workspaceStage === 'review' ? (
            <ReviewWorkspacePanel
              activeFinding={activeFinding}
              activePreview={activePreview}
              onApplyReviewedPreview={onApplyReviewedPreview}
              onChangeStage={onChangeStage}
              onReviewConfirmedChange={onReviewConfirmedChange}
              preview={preview}
              previewContainsActiveFinding={previewContainsActiveFinding}
              reviewConfirmed={reviewConfirmed}
            />
          ) : (
            <DryRunWorkspacePanel
              activeFinding={activeFinding}
              activePreview={activePreview}
              applyResult={applyResult}
              onChangeStage={onChangeStage}
              preview={preview}
            />
          )}
        </section>
      </section>
    </>
  );
}

function LandingMetric({label, value}: {label: string; value: string}) {
  return (
    <article className="rounded-[1.3rem] border border-black/8 bg-white/72 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl leading-tight">{value}</p>
    </article>
  );
}

function WorkflowStepCard({
  body,
  index,
  title,
}: {
  body: string;
  index: string;
  title: string;
}) {
  return (
    <article className="rounded-[1.2rem] border border-black/8 bg-white/75 p-4">
      <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        {index}
      </p>
      <h3 className="mt-2 font-semibold text-ink-strong">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{body}</p>
    </article>
  );
}

function FindingRailItem({
  finding,
  isActive,
  isPreviewed,
  isSelected,
  onActivate,
  onToggle,
}: {
  finding: Finding;
  isActive: boolean;
  isPreviewed: boolean;
  isSelected: boolean;
  onActivate: () => void;
  onToggle: () => void;
}) {
  return (
    <article
      className={`rounded-[1.1rem] border px-4 py-3 transition ${
        isActive
          ? 'border-accent/30 bg-accent/10'
          : 'border-black/8 bg-white/72 hover:border-ink-strong/15'
      }`}
    >
      <div className="flex gap-3">
        <input
          checked={isSelected}
          className="mt-1 h-4 w-4 rounded border-black/20 accent-ink-strong"
          onChange={onToggle}
          type="checkbox"
        />
        <button
          className="min-w-0 flex-1 text-left"
          onClick={onActivate}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate font-semibold text-ink-strong">
              {finding.title}
            </h3>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.14em] uppercase ${severityToneClasses[finding.severity]}`}
            >
              {finding.severity}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-soft">
            {finding.evidence}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {isSelected && (
              <span className="rounded-full border border-black/10 bg-white/75 px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.14em] text-ink-soft uppercase">
                selected
              </span>
            )}
            {isPreviewed && (
              <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.14em] text-success uppercase">
                in preview
              </span>
            )}
          </div>
        </button>
      </div>
    </article>
  );
}

function FindingSelectionPanel({
  activeFinding,
  activeFindingIndex,
  onMoveFinding,
  onToggleFinding,
  onUpdateRenameInput,
  renameInputs,
  selectedFindingIds,
  selectedScan,
}: {
  activeFinding: Finding;
  activeFindingIndex: number;
  onMoveFinding: (direction: -1 | 1) => void;
  onToggleFinding: () => void;
  onUpdateRenameInput: (entityId: string, value: string) => void;
  renameInputs: Record<string, string>;
  selectedFindingIds: string[];
  selectedScan: ScanDetail;
}) {
  const workflow = describeFindingWorkflow(activeFinding);
  const isSelected = selectedFindingIds.includes(activeFinding.id);

  return (
    <section className={shellPanelClass}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            Finding {activeFindingIndex + 1} of {selectedScan.findings.length}
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
          </div>
          <p className="mt-4 text-sm leading-7 text-ink-soft sm:text-base">
            {activeFinding.evidence}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={secondaryButtonClass}
            disabled={activeFindingIndex <= 0}
            onClick={() => {
              onMoveFinding(-1);
            }}
            type="button"
          >
            Previous
          </button>
          <button
            className={secondaryButtonClass}
            disabled={activeFindingIndex >= selectedScan.findings.length - 1}
            onClick={() => {
              onMoveFinding(1);
            }}
            type="button"
          >
            Next
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <section className={mutedPanelClass}>
            <label className="flex items-start gap-3 text-sm text-ink-soft">
              <input
                checked={isSelected}
                className="mt-1 h-4 w-4 rounded border-black/20 accent-ink-strong"
                onChange={onToggleFinding}
                type="checkbox"
              />
              <span>
                Include this finding in the reviewed command plan. Draft
                selections stay attached to this scan so you can leave and
                return later.
              </span>
            </label>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className={mutedPanelClass}>
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Targets
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
                {activeFinding.objectIds.map((objectId) => (
                  <li key={objectId}>
                    <span className="font-semibold text-ink-strong">
                      {objectId}
                    </span>
                  </li>
                ))}
              </ul>
            </article>

            <article className={mutedPanelClass}>
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Suggested path
              </p>
              <p className="mt-3 text-sm leading-6 text-ink-soft">
                {workflow.summary}
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
                {workflow.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </article>
          </section>

          {activeFinding.kind === 'duplicate_name' ? (
            <section className={shellPanelClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-serif text-3xl">{workflow.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    Enter exact registry names only for the entities you want to
                    include in the preview.
                  </p>
                </div>
                {!isSelected && (
                  <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                    Select to edit
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-3">
                {activeFinding.objectIds.map((entityId) => {
                  const entity = getEntityRecommendation(
                    selectedScan,
                    entityId,
                  );

                  return (
                    <label
                      className="block rounded-[1rem] border border-black/8 bg-white/76 p-4"
                      key={entityId}
                    >
                      <span className="text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                        Entity registry name
                      </span>
                      <p className="mt-2 font-semibold text-ink-strong">
                        {entity.displayLabel}
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">{entityId}</p>
                      <p className="mt-3 text-xs leading-5 text-ink-soft">
                        Current: {entity.currentValue ?? 'null'} • Suggested:{' '}
                        {entity.recommendation}
                      </p>
                      <input
                        className="mt-3 w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/40 disabled:bg-ink-strong/5"
                        disabled={!isSelected}
                        onChange={(event) => {
                          onUpdateRenameInput(entityId, event.target.value);
                        }}
                        placeholder={entity.recommendation}
                        type="text"
                        value={renameInputs[entityId] ?? ''}
                      />
                      <p className="mt-2 text-xs leading-5 text-ink-soft">
                        This becomes the literal{' '}
                        <code>config/entity_registry/update</code>{' '}
                        <code>name</code> payload for this entity if you include
                        it in the reviewed preview.
                      </p>
                    </label>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className={mutedPanelClass}>
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                {workflow.label}
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
                {workflow.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <article className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Planning status
            </p>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              {isSelected
                ? 'This finding is part of the current working selection.'
                : 'This finding is not selected yet.'}
            </p>
          </article>

          <article className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Safety note
            </p>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              No Home Assistant mutation is sent from this screen. The next step
              is always a reviewed preview with literal payloads.
            </p>
          </article>

          <article className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Warnings
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
              {workflow.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </article>
        </aside>
      </div>
    </section>
  );
}

function ReviewWorkspacePanel({
  activeFinding,
  activePreview,
  onApplyReviewedPreview,
  onChangeStage,
  onReviewConfirmedChange,
  preview,
  previewContainsActiveFinding,
  reviewConfirmed,
}: {
  activeFinding: Finding;
  activePreview: PreviewMatch;
  onApplyReviewedPreview: () => void;
  onChangeStage: (stage: WorkspaceStage) => void;
  onReviewConfirmedChange: (value: boolean) => void;
  preview: FixPreviewResponse | undefined;
  previewContainsActiveFinding: boolean;
  reviewConfirmed: boolean;
}) {
  if (!preview) {
    return (
      <section className={shellPanelClass}>
        <p className="rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
          No preview has been generated yet.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <section className={shellPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl">Reviewed preview</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              Inspect the exact payloads for the current selection before the
              dry-run apply step is unlocked.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
              token {preview.previewToken.slice(0, 12)}
            </span>
            <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
              {formatQueueStatus(preview.queue.status)}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <PreviewMetric
            label="Selected findings"
            value={preview.selection.findingIds.length.toString()}
          />
          <PreviewMetric
            label="Actions"
            value={preview.actions.length.toString()}
          />
          <PreviewMetric
            label="Advisories"
            value={preview.advisories.length.toString()}
          />
          <PreviewMetric
            label="Generated"
            value={formatTimestamp(preview.generatedAt)}
          />
        </div>
      </section>

      {previewContainsActiveFinding ? (
        <PreviewFindingDetail
          action={activePreview.action}
          advisory={activePreview.advisory}
          title={activeFinding.title}
        />
      ) : (
        <section className={shellPanelClass}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl">
                Current finding not included
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                The selected preview does not include{' '}
                <span className="font-semibold text-ink-strong">
                  {activeFinding.title}
                </span>
                . Return to selection if you want to add it and rebuild.
              </p>
            </div>
            <button
              className={secondaryButtonClass}
              onClick={() => {
                onChangeStage('select');
              }}
              type="button"
            >
              Revise selection
            </button>
          </div>
        </section>
      )}

      <section className={shellPanelClass}>
        <label className="flex items-start gap-3 text-sm text-ink-soft">
          <input
            checked={reviewConfirmed}
            className="mt-1 h-4 w-4 rounded border-black/20 accent-ink-strong"
            onChange={(event) => {
              onReviewConfirmedChange(event.target.checked);
            }}
            type="checkbox"
          />
          <span>
            I reviewed these exact Home Assistant commands and understand that
            the dry-run apply step will only accept this stored preview token.
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className={secondaryButtonClass}
            onClick={() => {
              onChangeStage('select');
            }}
            type="button"
          >
            Back to selection
          </button>
          <button
            className={primaryButtonClass}
            disabled={!reviewConfirmed}
            onClick={onApplyReviewedPreview}
            type="button"
          >
            Confirm reviewed dry-run apply
          </button>
        </div>
      </section>
    </section>
  );
}

function DryRunWorkspacePanel({
  activeFinding,
  activePreview,
  applyResult,
  onChangeStage,
  preview,
}: {
  activeFinding: Finding;
  activePreview: PreviewMatch;
  applyResult: FixApplyResponse | undefined;
  onChangeStage: (stage: WorkspaceStage) => void;
  preview: FixPreviewResponse | undefined;
}) {
  if (!applyResult) {
    return (
      <section className={shellPanelClass}>
        <p className="rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
          No dry-run apply result is available yet.
        </p>
      </section>
    );
  }

  const activeAction = activePreview.action;
  const activeAdvisory = activePreview.advisory;

  return (
    <section className="grid gap-6">
      <section className="rounded-[1.75rem] border border-success/20 bg-success/10 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl text-success">Dry-run result</h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              The reviewed preview token matched. No live changes were made.
            </p>
          </div>
          <button
            className={secondaryButtonClass}
            onClick={() => {
              onChangeStage('review');
            }}
            type="button"
          >
            Back to review
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <PreviewMetric label="Mode" value={applyResult.mode} />
          <PreviewMetric
            label="Selected actions"
            value={applyResult.selection.actionIds.length.toString()}
          />
          <PreviewMetric
            label="Queue status"
            value={formatQueueStatus(applyResult.queue.status)}
          />
          <PreviewMetric
            label="Last applied"
            value={
              applyResult.queue.lastAppliedAt
                ? formatTimestamp(applyResult.queue.lastAppliedAt)
                : 'Just now'
            }
          />
        </div>
      </section>

      {(activeAction ?? activeAdvisory) ? (
        <PreviewFindingDetail
          action={activeAction}
          advisory={activeAdvisory}
          title={activeFinding.title}
        />
      ) : (
        <section className={shellPanelClass}>
          <p className="text-sm leading-6 text-ink-soft">
            {preview?.selection.findingIds.includes(activeFinding.id)
              ? 'This finding was part of the preview, but it does not produce a dry-run action detail.'
              : 'This finding was not included in the applied preview selection.'}
          </p>
        </section>
      )}
    </section>
  );
}

function PreviewMetric({label, value}: {label: string; value: string}) {
  return (
    <article className="rounded-[1.1rem] border border-black/8 bg-ink-strong/4 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold leading-6 text-ink-strong">
        {value}
      </p>
    </article>
  );
}

function PreviewFindingDetail({
  action,
  advisory,
  title,
}: {
  action: FixAction | undefined;
  advisory: FindingAdvisory | undefined;
  title: string;
}) {
  if (action) {
    return (
      <article className={shellPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
              Active finding
            </p>
            <h2 className="mt-2 font-serif text-4xl leading-tight">
              {action.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              {action.intent}
            </p>
          </div>
          <span
            className={`inline-flex rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] uppercase ${riskToneClasses[action.risk]}`}
          >
            {action.risk} risk
          </span>
        </div>

        <p className="mt-5 text-sm leading-7 text-ink-soft">
          {action.rationale}
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Targets
            </p>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              {action.targets.map((target) => (
                <li key={target.id}>
                  <span className="font-semibold text-ink-strong">
                    {target.label}
                  </span>{' '}
                  <span className="text-[0.72rem] uppercase tracking-[0.16em]">
                    {target.kind}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Required inputs
            </p>
            <div className="mt-3 space-y-3">
              {action.requiredInputs.length === 0 ? (
                <p className="rounded-[1rem] border border-black/8 bg-white/70 p-3 text-sm text-ink-soft">
                  No operator-provided inputs are required for this action.
                </p>
              ) : (
                action.requiredInputs.map((input) => (
                  <article
                    className="rounded-[1rem] border border-black/8 bg-white/70 p-3 text-sm text-ink-soft"
                    key={input.id}
                  >
                    <p className="font-semibold text-ink-strong">
                      {input.summary}
                    </p>
                    <p className="mt-2">
                      <span className="font-semibold text-ink-strong">
                        Current:
                      </span>{' '}
                      {input.currentValue ?? 'null'}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-strong">
                        Recommended:
                      </span>{' '}
                      {input.recommendedValue ?? 'None'}
                    </p>
                    <p>
                      <span className="font-semibold text-ink-strong">
                        Provided:
                      </span>{' '}
                      {input.providedValue ?? 'Missing'}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-[1.1rem] border border-black/8 bg-ink-strong p-4 text-white">
          <p className="text-xs uppercase tracking-[0.16em] text-white/60">
            Literal commands
          </p>
          <div className="mt-3 space-y-3">
            {action.commands.length === 0 ? (
              <p className="rounded-[1rem] border border-white/10 bg-white/6 p-4 text-sm leading-6 text-white/72">
                The plan does not yet have literal commands because the required
                inputs are incomplete.
              </p>
            ) : (
              action.commands.map((command) => (
                <article key={command.id}>
                  <p className="text-sm font-semibold">{command.summary}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-white/50">
                    {command.transport}
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-[1rem] border border-white/10 bg-white/6 p-4 text-xs leading-6 text-white/80">
                    {JSON.stringify(command.payload, null, 2)}
                  </pre>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[1.1rem] border border-black/8 bg-ink-strong p-4 text-white">
          <p className="text-xs uppercase tracking-[0.16em] text-white/60">
            Review artifacts
          </p>
          <div className="mt-3 space-y-3">
            {action.artifacts.map((artifact) => (
              <article key={artifact.id}>
                <p className="text-sm font-semibold">{artifact.label}</p>
                <pre className="mt-2 overflow-x-auto rounded-[1rem] border border-white/10 bg-white/6 p-4 text-xs leading-6 text-white/80">
                  {artifact.content}
                </pre>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[1.1rem] border border-accent/15 bg-accent/8 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Warnings
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
              {action.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </article>

          <article className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Review steps
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
              {action.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </article>
        </section>
      </article>
    );
  }

  if (advisory) {
    return (
      <article className={shellPanelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
              Active finding
            </p>
            <h2 className="mt-2 font-serif text-4xl leading-tight">
              {advisory.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              {advisory.summary}
            </p>
          </div>
          <span className="inline-flex rounded-full border border-black/10 px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
            advisory only
          </span>
        </div>

        <p className="mt-5 text-sm leading-7 text-ink-soft">
          {advisory.rationale}
        </p>

        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Targets
            </p>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              {advisory.targets.map((target) => (
                <li key={target.id}>
                  <span className="font-semibold text-ink-strong">
                    {target.label}
                  </span>{' '}
                  <span className="text-[0.72rem] uppercase tracking-[0.16em]">
                    {target.kind}
                  </span>
                </li>
              ))}
            </ul>
          </article>

          <article className={mutedPanelClass}>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
              Manual steps
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
              {advisory.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </article>
        </section>

        <article className="mt-5 rounded-[1.1rem] border border-accent/15 bg-accent/8 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
            Warnings
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
            {advisory.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </article>
      </article>
    );
  }

  return (
    <article className={shellPanelClass}>
      <h2 className="font-serif text-3xl">No preview detail for {title}</h2>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        This finding does not currently have a reviewed action or advisory entry
        in the active preview.
      </p>
    </article>
  );
}
