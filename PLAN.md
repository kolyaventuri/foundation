# Home Assistant Repair Console Plan

## Product intent
Build a Docker-first, standalone, local-first TypeScript app with two entrypoints:

- a local web UI for guided cleanup
- a CLI for scans, exports, and approved fixes

The application should treat deterministic checks as the source of truth, persist scan history locally in SQLite, and keep LLM usage optional for enrichment only.

## Guiding principles
- **Methodical first**: every finding needs reproducible evidence and deterministic logic.
- **Trust before writes**: prefer previews and export plans before live mutation.
- **Capability-aware**: older Home Assistant installs must degrade gracefully with explicit skipped checks.
- **Local-first**: no SaaS dependency for core functionality.

## v1 Scope
- Inventory and hygiene coverage across entities, devices, areas, labels/floors where supported.
- Scene + automation target validation.
- Assistant exposure checks for Assist, Alexa, and HomeKit where data sources permit.

## Public interfaces
### CLI
- `ha-repair connect test`
- `ha-repair scan [--profile] [--config-dir] [--llm-provider]`
- `ha-repair findings [scan-id] [--format table|json|md]`
- `ha-repair apply [fix-id...] --dry-run`
- `ha-repair export [scan-id] [--format md|json]`

### Local API
- `POST /api/profiles/test`
- `POST /api/scans`
- `GET /api/scans/:id`
- `GET /api/scans/:id/findings`
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

### Phase A — Foundation and first vertical slice (in progress)
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
   - Track in-memory history now, swap with SQLite in next pass.
5. Test baseline
   - Unit tests for capability probe behavior.
   - Unit tests for deterministic rule outcomes.

### Phase B — Trust, previews, and persistence
1. SQLite persistence layer and migrations.
2. Fix queue state model and preview payloads.
3. `--dry-run` apply flow with explainable evidence.
4. Export reports in markdown/json for auditability.
5. History diff model: resolved/regressed/unchanged findings.

### Phase C — Deep analysis and enrichment
1. Read-only deep mode parsing of HA config YAML files.
2. Additional rule packs (room coverage, labels/floors, assistant context bloat).
3. Provider adapters for Ollama/OpenAI as non-authoritative enrichment.
4. Performance tuning for larger Home Assistant inventories.

## Implementation notes
- Workspace shape stays as `apps/web`, `apps/api`, and shared packages (`ha-client`, `scan-engine`, `contracts`, `llm`, `cli`).
- Discovery should use Home Assistant WebSocket + REST once Phase A API contracts settle.
- Live writes remain capability-gated and conservative in v1.

## Validation strategy
- Run scans against mocked Home Assistant inventory fixtures.
- Verify deterministic findings from fixture-based tests.
- Verify API scan lifecycle endpoints.
- Verify CLI scan + findings loop.
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
