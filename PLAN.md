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

## v1 product goals

- Deliver a local-first scan and history workflow over Home Assistant inventory plus optional read-only config analysis.
- Expand audit coverage from basic hygiene checks into design, correctness, conflict, dead-object, and fragility analysis.
- Turn findings into reviewable repair workflows without weakening the preview-first safety model.
- Produce enhancement guidance that helps operators consolidate logic, reduce drift, and improve maintainability over time.

## Stable interfaces and anchors

Current operator surfaces should stay stable while scan depth grows.

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

## Current baseline

The repo already has meaningful groundwork in place:

- workspace structure across `apps/web`, `apps/api`, and shared packages for `ha-client`, `scan-engine`, `contracts`, `storage`, `llm`, and `cli`
- live read-only scan mode over Home Assistant REST + WebSocket, alongside mock mode
- persisted scan runs with findings, passes, notes, fingerprints, history diffs, enrichment metadata, and optional backup checkpoints
- bounded read-only config parsing for `configuration.yaml` and supported include patterns
- deterministic findings for duplicate names, stale entities, orphaned entity/device links, missing area assignments, missing floor assignments, dangling labels, invalid automation targets, invalid scene targets, and assistant exposure bloat
- Phase 2 audit-model expansion for scripts, helpers, templates, config modules, richer finding metadata, conflict candidates, template missing references, ownership hotspots, unused objects, intent clusters, and install-level audit scoring
- review-oriented dry-run repair flows in the web workbench and CLI

This means the project is not starting from zero. Phase 1, Phase 2, and Phase 3 are complete, and the immediate priority is moving into Phase 4 enhancement guidance while continuing non-blocking hardening work in Phase 5.

## Phased roadmap

### Phase 1 - Local-first platform foundation

Goal: establish the trustworthy scan, storage, and operator workflow foundation the rest of the product depends on.

Status: complete

Deliverables:

- stable workspace split across API, web, CLI, scan engine, storage, and shared contracts
- mock and live read-only scan modes with capability-aware connection handling
- persisted scan history, fingerprints, notes, diff summaries, and backup checkpoint support
- bounded config-file access for deep read-only scans
- initial deterministic findings for inventory hygiene and target validation
- preview-first repair workflow primitives that keep live mutation conservative

Exit criteria:

- operators can run mock or live scans, inspect findings, persist history, export results, and use dry-run repair flows without mutating Home Assistant by default

Additional attention (non-blocking, tracked in later phases):

- broader live-environment validation across partial-capability and permission-constrained Home Assistant installs
- deeper regression coverage around scan/export/workbench flows and larger inventories
- continued operator-doc tightening as live read-only workflows and repair boundaries evolve

### Phase 2 - Deterministic audit expansion

Goal: make the audit engine meaningfully smarter about Home Assistant behavior, structure, and maintainability.

Status: complete

Checkpoint reached:

- normalized scan coverage now includes scripts, helpers, templates, config modules, and relationship-derived writer profiles
- findings now carry richer audit metadata such as categories, confidence, structured evidence details, recommendations, scores, tags, and related object context
- deterministic checks now cover ambiguous helper names, unused helpers/scenes/scripts, ownership hotspots, highly coupled automations, likely conflicting controls, template missing references, script invalid targets, automation disabled dependencies, template unknown-handling gaps, orphan config modules, and monolithic config files
- audit summaries now persist install-level scores, cleanup candidate IDs, conflict candidate IDs, conflict hotspots, and intent clusters
- markdown exports include the richer audit summary, and the web workbench now surfaces an audit overview with scores, conflict hotspots, and intent clusters
- lightweight audit digests now flow through CLI scan output, API history responses, and saved-scan cards so operators can compare scan posture without opening each workbench
- the web workbench audit overview now includes direct shortcuts into cleanup, conflict, ownership, and cluster-related finding slices instead of remaining a passive summary surface
- graph-heavy synthetic coverage now locks stable findings, conflict-candidate, ownership-hotspot, and intent-cluster counts across larger inventories
- the scan engine is now split into shared, clustering, findings, and remedies modules, clearing the Phase 2-related complexity warnings from the previous monolith

Deliverables:

- expand the normalized scan model beyond entities, automations, and scenes to include scripts, helpers, templates, config modules, and graph-derived relationships
- evolve findings from the current minimal shape into richer audit records with categories, confidence, structured evidence, recommendations, scores, tags, and related findings
- ship the next high-value deterministic checks from the audit spec, especially broken references, unused objects, ownership hotspots, likely conflicts, ambiguous helper names, and highly coupled automations
- add install-level scores, cleanup candidates, conflict hotspots, and early intent-cluster outputs while keeping compatibility with the current scan/history/workbench flow
- improve fixture coverage and performance for larger Home Assistant inventories

Deferred from this phase:

- duplicate-service-pattern detection, semantic duplicate naming beyond the current duplicate/shared-label logic, fragmented-intent modeling, and AI prioritization remain Phase 4 work
- no new repair actions were added in Phase 2; additional repair workflow expansion moves to Phase 3

Exit criteria:

- the system can explain not only what is present, but where logic is brittle, duplicated, conflicting, stale, or structurally risky

### Phase 3 - Repair workflow hardening

Goal: turn richer audit findings into safer, clearer, more useful repair workflows.

Status: complete

Checkpoint reached:

- fix planning now uses a mixed repair planner that can emit exact Home Assistant websocket payloads or exact YAML patch plans
- saved scans now persist optional capability snapshots and deep-scan config source snapshots so reopened scans can rebuild repair previews consistently
- preview, apply, export, CLI, and web workbench flows now operate on reviewable repair plans rather than assuming every action is a live command
- repair actions now carry explicit `executionMode`, richer finding context, and file-backed patch artifact paths across contracts, storage, API, CLI, and UI surfaces
- config-backed repair coverage now includes ambiguous helper rename, unused helper removal, unused script removal, and orphan config module removal as bounded patch-generation flows
- dry-run apply remains the only supported apply mode, with older scans degrading config-backed fixes into explicit advisories when the required repair context is unavailable
- regression, migration, storage, CLI, UI, and YAML rewrite coverage now lock the mixed websocket-plus-patch workflow in place

Deliverables:

- align fix planning and preview generation to the richer audit finding model
- preserve explicit operator review for every repair path, including exact intent, target set, and risk framing
- keep dry-run, export, and patch-oriented flows as the default operator path
- expand capability-aware repair actions where safe and supportable without weakening the safety contract
- ensure richer findings remain usable in the existing workbench, preview, and apply lifecycle

Deferred from this phase:

- live mutation of Home Assistant and local config files remains intentionally out of scope; the operator path stays preview-first, export-friendly, and dry-run-only
- broader enhancement-oriented repair suggestions such as duplicate-pattern consolidation and larger refactor proposals remain Phase 4 work

Exit criteria:

- operators can move from finding to reviewable repair plan with clear evidence and bounded scope, without needing to infer the intended fix themselves

### Phase 4 - Enhancement and refactor guidance

Goal: help operators improve architecture and maintainability, not only repair defects.

Status: planned

Deliverables:

- add smarter intent clustering, duplicate-pattern detection, semantic naming analysis, and fragmented-intent detection
- generate cleanup and refactor opportunities such as consolidating duplicate logic, splitting monolithic automations, and renaming ambiguous helpers
- keep enhancement output evidence-backed and reviewable rather than vague or speculative
- use optional AI enrichment only to summarize and prioritize deterministic findings, not to replace them

Exit criteria:

- the product can show not just what is broken, but what should be simplified, renamed, consolidated, or restructured to reduce future maintenance cost

### Phase 5 - Product hardening and release readiness

Goal: make the full audit/repair/enhance loop reliable enough for sustained real-world use.

Status: planned

Deliverables:

- deepen regression coverage across scan lifecycle, findings retrieval, checkpoint flows, preview/apply paths, exports, and UI rendering
- validate partial-registry failures, permission denial, config include edge cases, and degraded-capability installs
- complete performance work for larger inventories and deeper audit graphs
- keep contracts serializable and versioned across API, CLI, storage, and UI
- tighten docs and operator guidance around live read-only workflows and supported repair boundaries

Exit criteria:

- the product is consistent, well-tested, performant on realistic Home Assistant installs, and clear about supported audit and repair behavior

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
