# Home Assistant Repair Console

Initial workspace scaffold for the Home Assistant repair console described in [PLAN.md](./PLAN.md).

## Workspace

- `apps/api`: Fastify API for orchestration, scan execution, and history services
- `apps/web`: React + Vite UI for the guided cleanup workflow
- `packages/storage`: Shared SQLite persistence and repair service layer
- `packages/contracts`: Shared domain and API contracts
- `packages/ha-client`: Home Assistant connection and API abstraction
- `packages/scan-engine`: Deterministic scan execution and rule findings
- `packages/llm`: LLM provider metadata and future provider adapters
- `packages/cli`: CLI entrypoint for framework status and scan/findings loops

## Commands

- `pnpm install`
- `pnpm dev`
- `pnpm dev:api`
- `pnpm dev:web`
- `pnpm framework:status`
- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`

## Run against a real Home Assistant instance

See [docs/running-with-home-assistant.md](./docs/running-with-home-assistant.md) for the full operator walkthrough.

Short version:

- point the API and CLI at the same SQLite file with `HA_REPAIR_DB_PATH`
- save and test a live Home Assistant profile through the CLI or API
- create the live scan through the CLI or `POST /api/scans`
- open the saved scan in the web app at `http://127.0.0.1:4173`

Current limitation: the web app workbench can review persisted live scans, but its `Run scan` button still creates a mock scan. Live scan creation is CLI/API-driven right now.

## Safety Contract

This project is intentionally cautious about writes to Home Assistant.

- scans and findings are read-only by default
- nothing is fixed automatically
- users must explicitly choose which fixes they want to apply
- every fix must explain what it intends to change, which objects it affects, and why
- every fix must be reviewable before apply, including raw YAML or config diffs when YAML/config files are involved
- apply must be a separate confirmation step from preview
- the CLI follows the same safety model as the web UI

## Current state

Phase C is partially in place with persisted local and live read-only workflows:

- shared contracts now include scan passes, scan notes, fingerprints, enrichment metadata, and optional backup checkpoints
- the Home Assistant client now supports mock mode plus live read-only discovery over Home Assistant REST + WebSocket
- deep scans can parse `configuration.yaml` plus supported include patterns from an optional read-only config root
- the scan engine now emits deterministic findings for duplicate names, stale entities, orphaned links, missing area assignments, dangling labels, invalid automation/scene targets, and assistant exposure bloat
- the API now persists named profiles, rich scan runs, backup checkpoint state, history, diff summaries, and dry-run preview/apply responses in SQLite
- the CLI now manages saved profiles and `scan --mode/--deep/--llm-provider`, `checkpoint`, `findings`, `apply --dry-run`, and `export --format json` flows against the same SQLite database
- migrations run automatically on startup and default to `./data/ha-repair.sqlite`, overridable with `HA_REPAIR_DB_PATH` or `--db-path`

Remaining Phase C follow-up still includes live-mode connection tests, fuller coverage for the new live/deep/backup paths, a floor-specific hygiene rule, and a performance pass for larger Home Assistant inventories.
