# Home Assistant Repair Console

Initial workspace scaffold for the Home Assistant repair console described in [PLAN.md](./PLAN.md).

## Workspace

- `apps/api`: Fastify API for orchestration, scan execution, and history services
- `apps/web`: React + Vite UI for the guided cleanup workflow
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

## Current state

Phase A is now started with a minimal deterministic vertical slice:

- shared contracts now include capability, inventory, finding, and scan-run models
- the Home Assistant client returns a mocked capability probe and a mock inventory fixture
- the scan engine emits deterministic findings for duplicate names, stale entities, and orphaned entity-device links
- the API now supports profile testing, creating scans, reading scans, reading findings, and listing local scan history
- the CLI now supports API-backed `ha-repair scan` and `ha-repair findings [scanId]` for the Phase A scan loop

The next implementation pass should add SQLite persistence, dry-run fix previews, and richer deterministic rule packs.
