# Home Assistant Audit, Repair, and Enhance

Local-first TypeScript workspace for Home Assistant audit, repair, and enhancement workflows.

## Planning docs
- [PLAN.md](./PLAN.md): canonical product roadmap and current platform status
- [docs/home-assistant-audit-utility.md](./docs/home-assistant-audit-utility.md): detailed audit-engine implementation spec
- [docs/running-with-home-assistant.md](./docs/running-with-home-assistant.md): live read-only operator guide

## Workspace

- `apps/api`: Fastify API for orchestration, scan execution, workbench state, and history services
- `apps/web`: React + Vite UI for guided audit, repair, and enhancement workflows
- `packages/storage`: Shared SQLite persistence and repair service layer
- `packages/contracts`: Shared domain and API contracts
- `packages/ha-client`: Home Assistant connection and API abstraction
- `packages/scan-engine`: Deterministic scan execution and rule findings
- `packages/llm`: LLM provider metadata and optional enrichment adapters
- `packages/cli`: CLI entrypoint for connection tests, scans, checkpoints, findings, and dry-run repair loops

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
- start the API and web app, then create the live scan from the browser or `POST /api/scans`
- open the saved scan in the web app at `http://127.0.0.1:4173`

## Safety contract

This project is intentionally cautious about writes to Home Assistant.

- scans and findings are read-only by default
- nothing is fixed automatically
- users must explicitly choose which fixes they want to apply
- every fix must explain what it intends to change, which objects it affects, and why
- every fix must be reviewable before apply, including raw YAML or config diffs when YAML/config files are involved
- apply must be a separate confirmation step from preview
- the CLI follows the same safety model as the web UI

## Current state

The repo already supports a local-first audit, repair, and enhancement foundation:

- shared contracts include scan passes, scan notes, fingerprints, enrichment metadata, and optional backup checkpoints
- the Home Assistant client supports mock mode plus live read-only discovery over Home Assistant REST + WebSocket
- deep scans can parse `configuration.yaml` plus supported include patterns from an optional read-only config root
- the scan engine emits deterministic findings for duplicate names, stale entities, orphaned links, missing area assignments, missing floor assignments, dangling labels, invalid automation targets, invalid scene targets, and assistant exposure bloat
- the API persists named profiles, rich scan runs, backup checkpoint state, history, diff summaries, and dry-run preview/apply responses in SQLite
- the CLI manages saved profiles and `scan --mode/--deep/--llm-provider`, `checkpoint`, `findings`, `apply --dry-run`, and `export --format json` flows against the same SQLite database

The next planned expansion is the richer audit layer described in [docs/home-assistant-audit-utility.md](./docs/home-assistant-audit-utility.md).
