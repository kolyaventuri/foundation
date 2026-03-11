# Home Assistant Repair Console Plan

## Product intent
Build a Docker-first, standalone, local-first TypeScript app with two entrypoints:

- a local web UI for guided cleanup
- a CLI for scans, exports, and approved fixes

The application should treat deterministic checks as the source of truth, persist scan history locally in SQLite, and keep LLM usage optional for enrichment only.

## Guiding principles
- **Methodical first**: every finding needs reproducible evidence and deterministic logic.
- **Trust before writes**: fixes stay read-only until the user explicitly selects and confirms them after review.
- **Capability-aware**: older Home Assistant installs must degrade gracefully with explicit skipped checks.
- **Local-first**: no SaaS dependency for core functionality.

## Safety contract
- Findings are read-only and advisory by default across both the web UI and the CLI.
- Scans, discovery, and history views must never mutate Home Assistant state.
- Users must be able to pick individual fixes explicitly; no implicit or background apply flow is allowed.
- Every proposed fix must explain its intent, affected targets, and risk level before any write can occur.
- Every proposed fix must be reviewable as an exact edit plan before apply, including raw YAML/config diffs when YAML or config files are involved.
- Apply must remain a separate confirmation step from preview, and the final applied payload must match the reviewed preview exactly.
- Prefer export, patch, or dry-run workflows over live mutation whenever possible.

## v1 Scope
- Inventory and hygiene coverage across entities, devices, areas, labels/floors where supported.
- Scene + automation target validation.
- Assistant exposure checks for Assist, Alexa, and HomeKit where data sources permit.

## Public interfaces
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

## Domain model anchors
Core shared types that should remain stable and versioned:

- `ConnectionProfile`
- `CapabilitySet`
- `InventoryGraph`
- `Finding`
- `FixAction`
- `FixPreview`
- `ScanRun`
- `ProviderConfig`

## Engineering roadmap

### Current status
- Phase A is complete.
- Phase B is complete for the current local-first, mock-backed workflow.
- Phase C is in progress.
- Delivered in Phase C:
  - live read-only scan mode over Home Assistant REST + WebSocket
  - persisted scan passes, notes, enrichment metadata, fingerprints, and backup checkpoints
  - read-only YAML config parsing with bounded include resolution
  - additional deterministic findings for area coverage, label hygiene, invalid automation/scene targets, and assistant exposure bloat
  - optional Ollama/OpenAI enrichment that does not change deterministic findings
- Remaining Phase C follow-up:
  - expose live mode through the public connection-test CLI/API surfaces
  - add a floor-specific hygiene rule to match the labels/floors coverage goal explicitly
  - complete the Phase C test matrix for live discovery, deep config parsing, skipped-check reporting, backup checkpoints, and the new web states
  - do a dedicated performance pass for larger Home Assistant inventories

### Phase A — Foundation and first vertical slice (complete)
Deliver the smallest useful end-to-end flow with deterministic value.

1. Shared contracts and initial scan model
   - Define capability, inventory, finding, and scan contracts.
   - Keep scan output serializable and versionable.
2. Connection and capability probe baseline
   - Keep mocked connection checks in place while the API shape stabilizes.
   - Return capability posture explicitly.
3. Deterministic starter rules
   - Duplicate/ambiguous names.
   - Orphaned entity-device relationships.
   - Stale entities.
4. Minimal API + CLI scan workflow
   - Start scan.
   - Fetch scan by id.
   - Fetch findings by scan id.
   - Persist scans and history locally in SQLite.
5. Test baseline
   - Unit tests for capability probe behavior.
   - Unit tests for deterministic rule outcomes.

### Phase B — Trust, previews, and persistence (complete)
1. SQLite persistence layer and migrations.
2. Fix queue state model and preview payloads.
3. `--dry-run` apply flow with explainable evidence and no live mutation.
4. Export reports in markdown/json for auditability.
5. History diff model: resolved/regressed/unchanged findings.

### Phase C — Deep analysis and enrichment (in progress)
1. Completed
   - Read-only live discovery now uses Home Assistant WebSocket + REST.
   - Scan runs persist pass timings, scan notes, enrichment state, fingerprints, and optional backup checkpoints.
   - Read-only config parsing resolves `configuration.yaml` plus supported include patterns within the configured root.
   - Additional rule packs cover room coverage, label hygiene, invalid automation/scene targets, and assistant exposure bloat.
   - Ollama/OpenAI enrichment is available as non-authoritative scan metadata.
2. Remaining
   - Public connection-test flows still need a live-mode option.
   - Floor hygiene still needs its own explicit deterministic rule.
   - Performance work for large inventories is still pending.
   - Test coverage for the new live/deep/backup paths is still incomplete.

## Implementation notes
- Workspace shape stays as `apps/web`, `apps/api`, and shared packages (`ha-client`, `scan-engine`, `contracts`, `llm`, `cli`).
- Discovery should use Home Assistant WebSocket + REST once Phase A API contracts settle.
- The current Home Assistant adapter remains mock-backed while the persisted scan, preview, export, and dry-run apply flows stabilize.
- Live writes remain capability-gated, conservative, and blocked behind explicit review + confirmation in v1.

## Validation strategy
- Run scans against mocked Home Assistant inventory fixtures.
- Add focused tests for live capability probing, partial registry failures, and read-only guarantees.
- Add focused tests for config parsing includes, missing files, parse errors, permission denial, and root-bounded traversal.
- Verify deterministic findings from fixture-based tests.
- Verify API scan lifecycle + backup checkpoint endpoints.
- Verify CLI scan + findings + checkpoint loop.
- Verify web rendering for scan notes, pass state, backup checkpoint state, and the continued absence of live apply.
- Ensure LLM mode changes enrichment only, not base findings.

## Assumptions
- v1 is single-user and local-only.
- Some Home Assistant capabilities may be absent and should render as skipped.
- YAML assistant configuration analysis requires optional read-only config directory access.

## Primary sources
- https://developers.home-assistant.io/docs/api/websocket
- https://www.home-assistant.io/integrations/alexa.smart_home/
- https://www.home-assistant.io/integrations/homekit/
- https://developers.home-assistant.io/docs/entity_registry_disabled_by
