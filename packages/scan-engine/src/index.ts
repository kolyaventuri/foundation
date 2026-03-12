import {createHash} from 'node:crypto';
import type {
  Finding,
  InventoryGraph,
  ScanEnrichment,
  ScanMode,
  ScanNote,
  ScanPassResult,
  ScanRun,
} from '@ha-repair/contracts';
import {buildScanGraphArtifacts} from './clustering';
import {buildAuditSummary, buildFindings} from './findings';

export {createFindingAdvisories, createFixActions} from './remedies';

type RunScanOptions = {
  backupCheckpoint?: ScanRun['backupCheckpoint'];
  createdAt?: string;
  enrichment?: ScanEnrichment;
  id?: string;
  mode?: ScanMode;
  notes?: ScanNote[];
  passes?: ScanPassResult[];
  profileName?: string | null;
};

function createScanId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `scan-${uuid}`;
  }

  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultEnrichment(): ScanEnrichment {
  return {
    findingSummaries: [],
    provider: 'none',
    status: 'disabled',
  };
}

export function createScanFingerprint(input: {
  findings: Finding[];
  inventory: InventoryGraph;
  mode: ScanMode;
  profileName: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        findings: input.findings,
        inventory: input.inventory,
        mode: input.mode,
        profileName: input.profileName,
      }),
    )
    .digest('hex');
}

export function runScan(
  inventory: InventoryGraph,
  options: RunScanOptions = {},
): ScanRun {
  const graphArtifacts = buildScanGraphArtifacts(inventory);
  const findings = buildFindings(inventory, graphArtifacts);
  const audit = buildAuditSummary(inventory, findings, graphArtifacts);
  const mode = options.mode ?? inventory.source;
  const profileName = options.profileName ?? null;
  const fingerprint = createScanFingerprint({
    findings,
    inventory,
    mode,
    profileName,
  });

  return {
    audit,
    createdAt: options.createdAt ?? new Date().toISOString(),
    enrichment: options.enrichment ?? createDefaultEnrichment(),
    findings,
    fingerprint,
    id: options.id ?? createScanId(),
    inventory,
    mode,
    notes: options.notes ?? [],
    passes: options.passes ?? [],
    profileName,
    ...(options.backupCheckpoint
      ? {backupCheckpoint: options.backupCheckpoint}
      : {}),
  };
}
