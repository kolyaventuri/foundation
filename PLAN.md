# Home Assistant Audit, Repair, and Enhance Plan

## Product direction
Build a Docker-first, standalone, local-first TypeScript app with two operator surfaces:

- a local web UI for guided review, repair, and improvement
- a CLI for scans, exports, checkpoints, and approved fix workflows

The product is organized around three equal pillars:

- **Audit**: deterministic and later AI-assisted analysis of Home Assistant inventory, config, and behavioral structure
- **Repair**: explainable, reviewable, capability-aware fixes with explicit preview and confirmation
- **Enhance**: cleanup, refactor, naming, and design recommendations that improve long-term maintainability

Deterministic checks remain the source of truth. Scan history stays local in SQLite. LLM usage stays optional and non-authoritative.

## Guiding principles
- **Methodical first**: every finding needs reproducible evidence and deterministic logic.
- **Trust before writes**: fixes stay read-only until the user explicitly selects and confirms them after review.
- **Capability-aware**: older Home Assistant installs must degrade gracefully with explicit skipped checks.
- **Local-first**: no SaaS dependency for core functionality.

## Active implementation specs
- [docs/home-assistant-audit-utility.md](./docs/home-assistant-audit-utility.md): detailed audit-engine expansion plan, including target schemas, checks, clustering, and summary outputs
- [docs/running-with-home-assistant.md](./docs/running-with-home-assistant.md): operator guide for running the current live read-only workflow against a real Home Assistant instance

## Safety contract
- Findings are read-only and advisory by default across both the web UI and the CLI.
- Scans, discovery, and history views must never mutate Home Assistant state.
- Users must be able to pick individual fixes explicitly; no implicit or background apply flow is allowed.
- Every proposed fix must explain its intent, affected targets, and risk level before any write can occur.
- Every proposed fix must be reviewable as an exact edit plan before apply, including raw YAML/config diffs when YAML or config files are involved.
- Apply must remain a separate confirmation step from preview, and the final applied payload must match the reviewed preview exactly.
- Prefer export, patch, or dry-run workflows over live mutation whenever possible.

## v1 scope
- Local-first scans and history over Home Assistant inventory plus optional read-only config analysis
- Audit coverage for naming, stale objects, area/label/floor hygiene, target validation, and assistant exposure issues
- Guided repair workbench with dry-run previews and conservative, explicit apply flows
- Audit-driven cleanup and enhancement recommendations that can later expand into richer refactor guidance

## Stable interfaces and anchors
Current operator surfaces stay stable while scan depth grows.

### CLI
- `ha-repair connect test`
- `ha-repair scan [--profile] [--mode mock|live] [--deep] [--llm-provider]`
- `ha-repair checkpoint [scan-id] [--download]`
- `ha-repair findings [scan-id] [--format table|json|md]`
- `ha-repair apply [fix-id...] --dry-run`
- `ha-repair export [scan-id] [--format md|json]`

### Local API
- `POST /api/profiles/test`
- `POST /api/scans`
- `GET /api/scans/:id`
- `GET /api/scans/:id/findings`
- `GET /api/scans/:id/backup-checkpoint`
- `POST /api/scans/:id/backup-checkpoint`
- `POST /api/fixes/preview`
- `POST /api/fixes/apply`
- `GET /api/history`

### Shared contract anchors
- `ConnectionProfile`
- `CapabilitySet`
- `InventoryGraph`
- `Finding`
- `FixAction`
- `FixPreviewRequest`
- `FixPreviewResponse`
- `ScanRun`

The detailed audit spec expands scan content, not command names or route shapes.

## Current platform status
The repo already has a working local-first foundation for audit, repair, and enhancement workflows.

### Delivered
- Workspace structure is in place across `apps/web`, `apps/api`, and shared packages for `ha-client`, `scan-engine`, `contracts`, `storage`, `llm`, and `cli`.
- Live read-only scan mode is implemented over Home Assistant REST + WebSocket, alongside mock mode.
- Scan runs persist findings, passes, notes, fingerprints, enrichment metadata, history diffs, and optional backup checkpoints in SQLite.
- Deep scan mode can read `configuration.yaml` plus supported include patterns from a bounded config root.
- Deterministic findings already cover duplicate names, stale entities, orphaned entity/device links, missing area assignments, missing floor assignments, dangling labels, invalid automation targets, invalid scene targets, and assistant exposure bloat.
- The web workbench and CLI already support review-oriented dry-run repair flows on top of stored scan data.
- Ollama/OpenAI enrichment exists as optional metadata and does not alter base findings.

### Current follow-through
- Performance work for larger Home Assistant inventories is still needed.
- Coverage should expand for live-mode connection tests and deep-scan backup/config paths.
- The audit engine should now broaden from current inventory hygiene checks into richer behavioral and structural analysis.

## Forward workstreams
### 1. Audit expansion
- Grow the shared inventory model beyond entities, automations, and scenes to also cover scripts, helpers, templates, config modules, and graph-derived relationships.
- Evolve findings from the current minimal shape into richer audit records with categories, confidence, structured evidence, recommendations, scores, tags, and related findings.
- Add install-level scores, intent clusters, conflict hotspots, cleanup candidates, and refactor opportunities to scan outputs while staying compatible with the existing scan/history/workbench flow.
- Use [docs/home-assistant-audit-utility.md](./docs/home-assistant-audit-utility.md) as the implementation spec for the next wave of deterministic audit checks.

### 2. Repair hardening
- Keep repair flows capability-aware, explicit, and preview-first as audit coverage expands.
- Align future fix actions and repair plans to the richer audit findings without weakening the existing safety contract.
- Preserve dry-run, export, and review surfaces as the default operator path.

### 3. Enhancement workflows
- Turn audit output into clearer cleanup, refactor, and architectural recommendations.
- Add smarter summaries and clustering that help operators consolidate duplicate intent, reduce fragile logic, and improve naming consistency.
- Keep enhancement guidance evidence-backed so it can be reviewed before any follow-on change is made.

### 4. Platform follow-through
- Maintain serializable, versioned contracts across the API, CLI, storage, and UI.
- Improve fixture coverage and end-to-end confidence for scan, checkpoint, findings, preview, and export workflows.
- Keep live mutation conservative and gated behind explicit review even as repair capabilities grow.

## Validation strategy
- Run scans against mocked Home Assistant fixtures and live read-only environments.
- Add focused tests for capability probing, partial registry failures, config include resolution, permission denial, and root-bounded traversal.
- Verify deterministic findings and future audit graph outputs with fixture-based rule tests.
- Verify API scan lifecycle, findings retrieval, backup checkpoint endpoints, and workbench flows against persisted scans.
- Verify CLI scan, findings, checkpoint, export, and dry-run repair loops.
- Ensure enrichment changes metadata only and never changes deterministic findings.

## Assumptions
- v1 remains single-user and local-only.
- Some Home Assistant capabilities may be absent and should render as skipped rather than failing the scan.
- YAML/config analysis requires optional read-only config directory access.
- Audit, repair, and enhancement remain equal product pillars even when detailed implementation specs focus on one pillar at a time.
