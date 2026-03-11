import type {
  Finding,
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
import {startTransition, type ReactNode, useEffect, useState} from 'react';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
type MutationStatus = 'idle' | 'running' | 'ready' | 'error';

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

const initialData: FrameworkApiResponse = {
  framework: createFrameworkSummary(),
  providers: listProviderDescriptors(),
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

export function App() {
  const [data, setData] = useState(initialData);
  const [frameworkStatus, setFrameworkStatus] = useState<LoadStatus>('idle');
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>('idle');
  const [mutationStatus, setMutationStatus] = useState<MutationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string>();
  const [selectedScan, setSelectedScan] = useState<ScanDetail>();
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [renameInputs, setRenameInputs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FixPreviewResponse>();
  const [applyResult, setApplyResult] = useState<FixApplyResponse>();
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const activeQueue = applyResult?.queue ?? preview?.queue;

  async function loadScan(scanId: string) {
    const response = await fetchJson<ScanReadResponse>(`/api/scans/${scanId}`);
    startTransition(() => {
      setSelectedScanId(scanId);
      setSelectedScan(response.scan);
      setSelectedFindingIds([]);
      setRenameInputs({});
      setPreview(undefined);
      setApplyResult(undefined);
      setReviewConfirmed(false);
    });
  }

  async function loadHistory(preferredScanId?: string) {
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
      });

      if (nextScanId) {
        await loadScan(nextScanId);
      } else {
        startTransition(() => {
          setSelectedScanId(undefined);
          setSelectedScan(undefined);
          setSelectedFindingIds([]);
          setRenameInputs({});
          setPreview(undefined);
          setApplyResult(undefined);
          setReviewConfirmed(false);
        });
      }
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

        await loadHistory();
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

      await loadHistory(response.scan.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown scan request error';

      startTransition(() => {
        setMutationStatus('error');
        setErrorMessage(message);
      });
    }
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

      startTransition(() => {
        setPreview(nextPreview);
        setApplyResult(undefined);
        setReviewConfirmed(false);
        setMutationStatus('ready');
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
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-5 py-10 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-white/72 px-6 py-8 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:px-10 md:py-12">
        <div className="pointer-events-none absolute -top-3 -left-16 h-40 w-40 rounded-full bg-accent-soft/35 blur-3xl" />
        <div className="pointer-events-none absolute top-16 right-0 h-36 w-36 rounded-full bg-emerald-900/12 blur-3xl" />
        <div className="relative max-w-4xl">
          <p className="text-xs font-semibold tracking-[0.22em] text-accent uppercase">
            Framework scaffold
          </p>
          <h1 className="mt-3 max-w-[12ch] font-serif text-5xl leading-[0.95] sm:text-6xl lg:text-[5.25rem]">
            {data.framework.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-ink-soft sm:text-lg">
            {data.framework.tagline}
          </p>
          <div className="mt-6 rounded-[1.3rem] border border-accent/15 bg-accent/8 p-4 text-sm leading-6 text-ink-soft">
            <p className="font-semibold text-ink-strong">Safety contract</p>
            <p className="mt-2">
              Findings stay read-only until you explicitly select them, review
              the exact Home Assistant commands, and confirm the preview token
              in a separate dry-run step.
            </p>
          </div>
        </div>
        <div className="relative mt-8 flex flex-wrap items-center gap-3">
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
          {errorMessage && (
            <span className="text-sm text-ink-soft">{errorMessage}</span>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-3xl">Scan review</h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base">
                Run a read-only scan, then select only the findings you want to
                review.
              </p>
            </div>
            <button
              className="rounded-full border border-ink-strong/10 bg-ink-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-soft"
              onClick={() => {
                void runScan();
              }}
              type="button"
            >
              Run mock scan
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            {history.length === 0 ? (
              <p className="rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
                No scans yet. Run a scan to inspect findings.
              </p>
            ) : (
              history.map((entry) => (
                <button
                  className={`rounded-[1.2rem] border px-4 py-4 text-left transition ${
                    entry.id === selectedScanId
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-black/8 bg-white/70 hover:border-ink-strong/15'
                  }`}
                  key={entry.id}
                  onClick={() => {
                    void loadScan(entry.id);
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

          {selectedScan && (
            <div className="mt-6 rounded-[1.3rem] border border-black/8 bg-white/72 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-serif text-2xl">Selected scan</h3>
                  <p className="mt-1 text-sm text-ink-soft">
                    {selectedScan.id} •{' '}
                    {formatTimestamp(selectedScan.createdAt)}
                  </p>
                </div>
                <span className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                  {selectedScan.profileName ?? 'No profile'}
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
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
              </div>
            </div>
          )}
        </section>

        <section className="rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-3xl">Finding selection</h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base">
                Select the exact findings you want to turn into a reviewed
                dry-run command plan.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-full border border-black/10 px-3 py-2 text-sm font-semibold text-ink-strong transition hover:border-ink-strong/25"
                disabled={!selectedScan}
                onClick={() => {
                  setSelectedFindingIds(
                    selectedScan?.findings.map((finding) => finding.id) ?? [],
                  );
                }}
                type="button"
              >
                Select all
              </button>
              <button
                className="rounded-full border border-black/10 px-3 py-2 text-sm font-semibold text-ink-strong transition hover:border-ink-strong/25"
                disabled={selectedFindingIds.length === 0}
                onClick={() => {
                  setSelectedFindingIds([]);
                }}
                type="button"
              >
                Clear
              </button>
              <button
                className="rounded-full border border-ink-strong/10 bg-ink-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-ink-soft/50"
                disabled={!selectedScanId || selectedFindingIds.length === 0}
                onClick={() => {
                  void previewSelectedFixes();
                }}
                type="button"
              >
                Preview selected fixes
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {selectedScan?.findings.map((finding) => {
              const selected = selectedFindingIds.includes(finding.id);

              return (
                <label
                  className={`block rounded-[1.2rem] border px-4 py-4 transition ${
                    selected
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-black/8 bg-white/70 hover:border-ink-strong/15'
                  }`}
                  key={finding.id}
                >
                  <div className="flex gap-3">
                    <input
                      checked={selected}
                      className="mt-1 h-4 w-4 rounded border-black/20 accent-ink-strong"
                      onChange={() => {
                        setSelectedFindingIds((current) =>
                          toggleItem(current, finding.id),
                        );
                      }}
                      type="checkbox"
                    />
                    <FindingCard
                      finding={finding}
                      supplementalContent={
                        selected && finding.kind === 'duplicate_name' ? (
                          <div className="mt-4 grid gap-3">
                            {finding.objectIds.map((entityId) => {
                              const entity =
                                selectedScan?.inventory.entities.find(
                                  (candidate) =>
                                    candidate.entityId === entityId,
                                );
                              const recommendation = entity
                                ? `${entity.displayName} (${entity.entityId})`
                                : '';

                              return (
                                <label
                                  className="block rounded-[1rem] border border-black/8 bg-white/76 p-3"
                                  key={entityId}
                                >
                                  <span className="text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                                    Entity registry name
                                  </span>
                                  <p className="mt-1 text-sm font-semibold text-ink-strong">
                                    {entityId}
                                  </p>
                                  <input
                                    className="mt-3 w-full rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-ink-strong outline-none transition focus:border-accent/40"
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setRenameInputs((current) => ({
                                        ...current,
                                        [entityId]: nextValue,
                                      }));
                                    }}
                                    placeholder={recommendation}
                                    type="text"
                                    value={renameInputs[entityId] ?? ''}
                                  />
                                  <p className="mt-2 text-xs leading-5 text-ink-soft">
                                    This value becomes the literal{' '}
                                    <code>config/entity_registry/update</code>{' '}
                                    <code>name</code> payload for this entity.
                                  </p>
                                </label>
                              );
                            })}
                          </div>
                        ) : undefined
                      }
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      </section>

      <section className="rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-3xl">Reviewed preview</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft sm:text-base">
              Review the exact Home Assistant command payloads below. The
              dry-run confirmation step is blocked until you explicitly confirm
              this preview token.
            </p>
          </div>
          {preview && (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                token {preview.previewToken.slice(0, 12)}
              </span>
              {activeQueue && (
                <span className="rounded-full border border-black/10 bg-ink-strong/5 px-3 py-2 text-xs font-semibold tracking-[0.16em] text-ink-soft uppercase">
                  queue {formatQueueStatus(activeQueue.status)}
                </span>
              )}
            </div>
          )}
        </div>

        {preview ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-[1.2rem] border border-black/8 bg-ink-strong/4 p-4 text-sm text-ink-soft">
              <p>
                Generated at {formatTimestamp(preview.generatedAt)} for scan{' '}
                <span className="font-semibold text-ink-strong">
                  {preview.scanId}
                </span>
              </p>
              <p className="mt-2">
                Reviewed findings: {preview.selection.findingIds.join(', ')}
              </p>
              {preview.advisories.length > 0 && (
                <p className="mt-2">
                  Advisory-only findings: {preview.advisories.length}
                </p>
              )}
              {activeQueue && (
                <>
                  <p className="mt-2">
                    Queue {activeQueue.id} is{' '}
                    <span className="font-semibold text-ink-strong">
                      {formatQueueStatus(activeQueue.status)}
                    </span>{' '}
                    since {formatTimestamp(activeQueue.createdAt)}
                  </p>
                  {activeQueue.lastAppliedAt && (
                    <p className="mt-2">
                      Last dry-run apply:{' '}
                      {formatTimestamp(activeQueue.lastAppliedAt)}
                    </p>
                  )}
                </>
              )}
            </div>

            {preview.actions.map((action) => (
              <article
                className="rounded-[1.35rem] border border-black/8 bg-white/78 p-5"
                key={action.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-2xl">{action.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">
                      {action.intent}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] uppercase ${riskToneClasses[action.risk]}`}
                  >
                    {action.risk} risk
                  </span>
                </div>

                <p className="mt-4 text-sm leading-6 text-ink-soft">
                  {action.rationale}
                </p>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-[1.1rem] border border-black/8 bg-ink-strong/4 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Targets
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                      {action.targets.map((target) => (
                        <li key={target.id}>
                          <span className="font-semibold text-ink-strong">
                            {target.label}
                          </span>{' '}
                          <span className="uppercase tracking-[0.16em] text-[0.72rem]">
                            {target.kind}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="rounded-[1.1rem] border border-black/8 bg-ink-strong/4 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                      Required inputs
                    </p>
                    <div className="mt-3 space-y-3">
                      {action.requiredInputs.length === 0 ? (
                        <p className="rounded-[1rem] border border-black/8 bg-white/70 p-3 text-sm text-ink-soft">
                          No operator-provided inputs required for this action.
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
                                Field:
                              </span>{' '}
                              {input.field}
                            </p>
                            <p>
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

                <section className="mt-4 rounded-[1.1rem] border border-black/8 bg-ink-strong p-4 text-white">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/60">
                    Literal commands
                  </p>
                  {action.commands.map((command) => (
                    <article className="mt-3" key={command.id}>
                      <p className="text-sm font-semibold">{command.summary}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-white/50">
                        {command.transport}
                      </p>
                      <pre className="mt-2 overflow-x-auto rounded-[1rem] border border-white/10 bg-white/6 p-4 text-xs leading-6 text-white/80">
                        {JSON.stringify(command.payload, null, 2)}
                      </pre>
                    </article>
                  ))}
                </section>

                <section className="mt-4 rounded-[1.1rem] border border-black/8 bg-ink-strong p-4 text-white">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/60">
                    Review artifacts
                  </p>
                  {action.artifacts.map((artifact) => (
                    <article className="mt-3" key={artifact.id}>
                      <p className="text-sm font-semibold">{artifact.label}</p>
                      <pre className="mt-2 overflow-x-auto rounded-[1rem] border border-white/10 bg-white/6 p-4 text-xs leading-6 text-white/80">
                        {artifact.content}
                      </pre>
                    </article>
                  ))}
                </section>

                <section className="mt-4 rounded-[1.1rem] border border-accent/15 bg-accent/8 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                    Warnings
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
                    {action.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              </article>
            ))}

            {preview.advisories.map((advisory) => (
              <article
                className="rounded-[1.35rem] border border-black/8 bg-white/78 p-5"
                key={advisory.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-2xl">{advisory.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-ink-soft">
                      {advisory.summary}
                    </p>
                  </div>
                  <span className="inline-flex rounded-full border border-black/10 px-3 py-1.5 text-[0.72rem] font-semibold tracking-[0.16em] text-ink-soft uppercase">
                    advisory only
                  </span>
                </div>

                <p className="mt-4 text-sm leading-6 text-ink-soft">
                  {advisory.rationale}
                </p>

                <section className="mt-4 rounded-[1.1rem] border border-black/8 bg-ink-strong/4 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                    Targets
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                    {advisory.targets.map((target) => (
                      <li key={target.id}>
                        <span className="font-semibold text-ink-strong">
                          {target.label}
                        </span>{' '}
                        <span className="uppercase tracking-[0.16em] text-[0.72rem]">
                          {target.kind}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="mt-4 rounded-[1.1rem] border border-accent/15 bg-accent/8 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                    Warnings
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
                    {advisory.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>

                <section className="mt-4 rounded-[1.1rem] border border-black/8 bg-ink-strong/4 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                    Manual steps
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
                    {advisory.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </section>
              </article>
            ))}

            <div className="rounded-[1.3rem] border border-black/8 bg-ink-strong/4 p-4">
              <label className="flex items-start gap-3 text-sm text-ink-soft">
                <input
                  checked={reviewConfirmed}
                  className="mt-1 h-4 w-4 rounded border-black/20 accent-ink-strong"
                  onChange={(event) => {
                    setReviewConfirmed(event.target.checked);
                  }}
                  type="checkbox"
                />
                <span>
                  I reviewed these exact Home Assistant commands and understand
                  that the dry-run apply step will only accept the preview token
                  shown above.
                </span>
              </label>

              <button
                className="mt-4 rounded-full border border-ink-strong/10 bg-ink-strong px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:bg-ink-soft/50"
                disabled={!reviewConfirmed}
                onClick={() => {
                  void applyReviewedPreview();
                }}
                type="button"
              >
                Confirm reviewed dry-run apply
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded-[1.2rem] border border-dashed border-ink-strong/15 bg-ink-strong/5 px-4 py-5 text-sm text-ink-soft">
            No preview generated yet. Select findings first, then request a
            preview.
          </p>
        )}
      </section>

      {applyResult && (
        <section className="rounded-[1.75rem] border border-success/20 bg-success/10 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)]">
          <h2 className="font-serif text-3xl text-success">Dry-run result</h2>
          <p className="mt-3 text-sm leading-6 text-ink-soft">
            The reviewed preview token matched. No live changes were made.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <article className="rounded-[1.1rem] border border-success/20 bg-white/75 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Mode
              </p>
              <p className="mt-2 font-semibold text-ink-strong">
                {applyResult.mode}
              </p>
            </article>
            <article className="rounded-[1.1rem] border border-success/20 bg-white/75 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Selected actions
              </p>
              <p className="mt-2 font-semibold text-ink-strong">
                {applyResult.selection.actionIds.length}
              </p>
            </article>
            <article className="rounded-[1.1rem] border border-success/20 bg-white/75 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">
                Queue status
              </p>
              <p className="mt-2 font-semibold text-ink-strong">
                {formatQueueStatus(applyResult.queue.status)}
              </p>
            </article>
          </div>
          {applyResult.queue.lastAppliedAt && (
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              Queue {applyResult.queue.id} last ran a dry-run apply at{' '}
              {formatTimestamp(applyResult.queue.lastAppliedAt)}.
            </p>
          )}
        </section>
      )}

      <section className="rounded-[1.75rem] border border-black/10 bg-white/78 p-6 shadow-[0_18px_42px_rgba(24,33,34,0.08)] backdrop-blur md:p-7">
        <div className="flex flex-col gap-2">
          <h2 className="font-serif text-3xl">Provider posture</h2>
          <p className="max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">
            The app stays deterministic first and treats providers as optional.
          </p>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {data.providers.map((provider) => (
            <article
              className="rounded-[1.4rem] border border-black/8 bg-ink-strong p-5 text-white"
              key={provider.id}
            >
              <h3 className="font-serif text-2xl">{provider.label}</h3>
              <p className="mt-3 text-sm leading-6 text-white/74">
                {provider.description}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function FindingCard({
  finding,
  supplementalContent,
}: {
  finding: Finding;
  supplementalContent?: ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold text-ink-strong">{finding.title}</h3>
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold tracking-[0.14em] uppercase ${severityToneClasses[finding.severity]}`}
        >
          {finding.severity}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{finding.evidence}</p>
      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-ink-soft">
        {finding.objectIds.join(', ')}
      </p>
      {supplementalContent}
    </div>
  );
}
