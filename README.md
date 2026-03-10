# Home Assistant Repair Console

Initial workspace scaffold for the Home Assistant repair console described in [PLAN.md](./PLAN.md).

## Workspace

- `apps/api`: Fastify API for orchestration, scan execution, and history services
- `apps/web`: React + Vite UI for the guided cleanup workflow
- `packages/contracts`: Shared domain and API contracts
- `packages/ha-client`: Home Assistant connection and API abstraction
- `packages/scan-engine`: Scan summary and issue-pack structure
- `packages/llm`: LLM provider metadata and future provider adapters
- `packages/cli`: CLI entrypoint for framework status and connection checks

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

This scaffold intentionally stops at the framework layer:

- The API exposes health, framework summary, and a stubbed connection test
- The web app renders the shared framework summary and fetches the API on load
- The CLI exposes a framework status command and a mock connection test
- The next implementation pass should add persistent storage, real Home Assistant auth, and the first deterministic scan rules

