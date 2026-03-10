# Home Assistant Repair Console v1

## Summary
- Build a Docker-first, standalone, local-first TypeScript app with two entrypoints: a local web UI for guided cleanup and a CLI for scans, exports, and approved fixes.
- Use Home Assistant `URL + long-lived token` auth, persist scan history in local SQLite, and make deterministic rules the source of truth. LLMs are optional enrichers only, via a provider adapter (`none`, `ollama`, `openai`).
- v1 focuses on core hygiene and assistant exposure: entities, devices, areas, labels/floors when available, scenes, automations, and exposure to Assist/Alexa/HomeKit where the data source supports it.

## Public Interfaces
- CLI surface:
  - `ha-repair connect test`
  - `ha-repair scan [--profile] [--config-dir] [--llm-provider]`
  - `ha-repair findings [scan-id] [--format table|json|md]`
  - `ha-repair apply [fix-id...] --dry-run`
  - `ha-repair export [scan-id] [--format md|json]`
- Local API surface:
  - `POST /api/profiles/test`
  - `POST /api/scans`
  - `GET /api/scans/:id`
  - `GET /api/scans/:id/findings`
  - `POST /api/fixes/preview`
  - `POST /api/fixes/apply`
  - `GET /api/history`
- Core shared types:
  - `ConnectionProfile`, `ScanRun`, `CapabilitySet`, `InventoryGraph`, `Finding`, `FixAction`, `FixPreview`, `ProviderConfig`

## Implementation
- Repo shape: `pnpm` workspace with `apps/web` (React + Vite), `apps/api` (Fastify), and shared packages for `ha-client`, `scan-engine`, `rules`, `llm`, and shared types. Use `xo` and `vitest` workspace-wide.
- Discovery layer:
  - Connect through Home Assistant WebSocket plus REST.
  - Build a normalized graph from runtime data: states, entity/device/area registries, labels/floors when supported, config-entry metadata, and assistant exposure state.
  - Add capability probing at connect time; unsupported features are marked skipped, not failed.
  - Optional deep mode accepts a read-only bind mount of the HA config directory and parses `configuration.yaml`, packages, `automations.yaml`, `scenes.yaml`, and assistant filter config.
- Rule engine:
  - Deterministic checks create typed findings with severity, evidence, affected objects, confidence, and fixability.
  - Initial rules: duplicate or ambiguous names, poor room coverage, missing labels, stale/unavailable entities, hidden/disabled clutter, orphaned entity-device relationships, scene/automation references to missing targets, and assistant exposure mismatches or context-bloat risks.
  - LLM enrichment is limited to classification, naming normalization suggestions, grouping/categorization suggestions, and plain-English repair summaries. No LLM-only suggestion can be applied directly.
- Repair flow:
  - UI flow is `Connect -> Scan -> Findings -> Fix Queue -> Apply/Export -> History`.
  - Every finding supports `ignore`, `queue`, `export`, and `preview`.
  - Live apply in baseline v1 is guaranteed for exposure changes using the documented exposure WebSocket commands. Registry metadata writes are optional capabilities: enable them only if the runtime probe confirms they are supported; otherwise emit exportable repair plans instead.
  - YAML-backed systems such as HomeKit filters and YAML Alexa config are analyzed in deep mode, but v1 outputs patch plans/diffs instead of rewriting HA config files.
- Persistence and packaging:
  - Store profiles, scan snapshots, findings, fix queue state, and change history in SQLite on a Docker volume.
  - Ship one Docker image with the API, web UI, and CLI; mount SQLite state read-write and HA config read-only when deep mode is enabled.

## Test Plan
- Scan against a mocked HA instance with no config mount and verify inventory collection, capability probing, and skipped-check behavior.
- Detect duplicate names, orphaned entities, stale entities, and exposure conflicts from fixture inventories.
- Parse automation/scene YAML in deep mode and flag missing entity, area, label, or floor references using validation and target extraction.
- Verify `--dry-run` previews and live exposure apply behavior, including bulk expose/unexpose flows.
- Verify scan history diffs show resolved, regressed, and unchanged findings across runs.
- Verify LLM disabled, Ollama, and OpenAI modes all produce identical base findings, with only enrichment varying.

## Assumptions
- v1 is single-user and local; no multi-tenant auth or remote SaaS control plane.
- Older HA installs may lack some registry or exposure capabilities; the product must degrade gracefully and surface skipped checks clearly.
- HomeKit and YAML-managed Alexa analysis requires optional config-directory access; API-only mode still covers runtime inventory and documented exposure state.
- Inference from the docs: use documented list/validation/exposure commands as the stable baseline, and treat broader registry mutations as capability-gated rather than guaranteed.
- Sources used for the plan:
  - [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket)
  - [Home Assistant frontend custom strategy example](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-strategy/)
  - [Alexa Smart Home integration docs](https://www.home-assistant.io/integrations/alexa.smart_home/)
  - [HomeKit Bridge integration docs](https://www.home-assistant.io/integrations/homekit/)
  - [Entity registry and disabling entities](https://developers.home-assistant.io/docs/entity_registry_disabled_by)
