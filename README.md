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

Phase B is now in place with persisted local workflows:

- shared contracts now include persisted profiles, scan diffs, dry-run previews, and export bundle models
- the Home Assistant client returns a mocked capability probe and a mock inventory fixture
- the scan engine emits deterministic findings for duplicate names, stale entities, and orphaned entity-device links
- the API now persists named profiles, scan runs, findings, history, diff summaries, and dry-run preview/apply responses in SQLite
- the CLI now manages saved profiles and local `scan`, `findings`, `apply --dry-run`, and `export --format json` flows against the same SQLite database
- migrations run automatically on startup and default to `./data/ha-repair.sqlite`, overridable with `HA_REPAIR_DB_PATH` or `--db-path`

The next implementation pass should add real Home Assistant adapters, richer deterministic rule packs, and guarded live apply behavior.
