# Running against a real Home Assistant instance

This repo can already talk to a real Home Assistant instance for live, read-only discovery. The safest current workflow is:

1. save a Home Assistant connection profile
2. run a live scan from the web UI, CLI, or API
3. open that saved scan in the web UI for review

## What works today

- live scans use Home Assistant REST plus WebSocket discovery
- live scans are read-only
- deep scans can analyze Home Assistant config files if you give the tool a local `configPath`
- preview/apply is still dry-run only; no live mutation path is wired up yet
- the web UI can create live scans from saved profiles and review persisted runs

## Prerequisites

- `pnpm`
- Node.js 22+ recommended
  - this code relies on `node:sqlite`, built-in `fetch`, and built-in `WebSocket`
- a Home Assistant base URL, for example `http://homeassistant.local:8123`
- a Home Assistant long-lived access token
- optional: a local filesystem path to your Home Assistant config directory
  - this must be readable from the same machine running this repo
  - deep scan reads files directly from disk; it does not fetch YAML through the Home Assistant API

## 1. Use one shared database path

The CLI and API only share profiles, scans, and workbench state if they point at the same SQLite file.

From the repo root:

```sh
export HA_REPAIR_DB_PATH="$PWD/data/ha-repair.sqlite"
```

If you skip this and run commands from different working directories, you can end up with multiple SQLite files and "missing" scans.

## 2. Install dependencies

```sh
pnpm install
```

## 3. Save a live Home Assistant profile

Set your Home Assistant connection values:

```sh
export HA_URL="http://homeassistant.local:8123"
export HA_TOKEN="replace-with-your-long-lived-token"
```

If you want deep config analysis, also set a local config path. This path should contain `configuration.yaml`.

```sh
export HA_CONFIG_PATH="/absolute/path/to/your/home-assistant-config"
```

Save the profile and mark it as the default:

Without deep config access:

```sh
pnpm --filter @ha-repair/cli dev connect save \
  --name home \
  --url "$HA_URL" \
  --token "$HA_TOKEN" \
  --default
```

With deep config access:

```sh
pnpm --filter @ha-repair/cli dev connect save \
  --name home \
  --url "$HA_URL" \
  --token "$HA_TOKEN" \
  --config-path "$HA_CONFIG_PATH" \
  --default
```

## 4. Test the live connection

```sh
pnpm --filter @ha-repair/cli dev connect test --profile home --mode live
```

What to look for:

- `"ok": true`
- live capability details for entity registry, device registry, labels, floors, and backups
- warnings if your instance is reachable but missing optional capabilities

## 5. Run a real scan

Live scan without config parsing:

```sh
pnpm --filter @ha-repair/cli dev scan --profile home --mode live
```

Live scan with config parsing:

```sh
pnpm --filter @ha-repair/cli dev scan --profile home --mode live --deep
```

Optional enrichment:

- default provider is `none`
- `--llm-provider openai` requires `OPENAI_API_KEY`
- `--llm-provider ollama` uses `OLLAMA_BASE_URL` and `OLLAMA_MODEL` if you want local enrichment

The scan command prints a JSON summary with:

- `scanId`
- `mode`
- `profileName`
- pass statuses
- findings count
- backup checkpoint status, if one already exists

## 6. Start the API and web app

From the repo root:

```sh
pnpm dev
```

That starts:

- API at `http://127.0.0.1:4010`
- web app at `http://127.0.0.1:4173`

The Vite dev server proxies `/api` and `/health` to the API server automatically.

## 7. Run or open the scan in the web UI

Open `http://127.0.0.1:4173`.

Use the landing page to choose `Live read-only`, select the saved profile, and optionally enable deep config analysis when that profile has a local `configPath`. You can also open any previously saved scan from the history list.

Once a live scan exists, the web workbench can:

- browse findings
- stage recommended changes
- build preview batches
- run dry-run apply
- capture a backup checkpoint for live scans

Important: the web UI reads saved profiles from the API database. If no live profiles appear in the browser, save one first through the CLI or API and make sure the web/API process is pointed at the same `HA_REPAIR_DB_PATH`.

## API-only flow

If you want to drive setup through HTTP instead of the CLI, start just the API:

```sh
pnpm dev:api
```

Create or update a profile:

```sh
curl -sS \
  -H 'content-type: application/json' \
  -d '{
    "name": "home",
    "baseUrl": "'"$HA_URL"'",
    "token": "'"$HA_TOKEN"'",
    "configPath": "'"$HA_CONFIG_PATH"'"
  }' \
  http://127.0.0.1:4010/api/profiles
```

Set it as default:

```sh
curl -sS -X POST http://127.0.0.1:4010/api/profiles/home/default
```

Test it in live mode:

```sh
curl -sS \
  -H 'content-type: application/json' \
  -d '{"mode":"live"}' \
  http://127.0.0.1:4010/api/profiles/home/test
```

Create a live scan:

```sh
curl -sS \
  -H 'content-type: application/json' \
  -d '{
    "mode": "live",
    "profileName": "home",
    "deep": true
  }' \
  http://127.0.0.1:4010/api/scans
```

If you are not using local config parsing, set `"deep": false` and omit `configPath` when saving the profile.

## Backups and exports

Create a backup checkpoint for the latest live scan:

```sh
pnpm --filter @ha-repair/cli dev checkpoint --download
```

By default the downloaded backup lands under `./data/backups` relative to the process working directory.

Export the latest scan as Markdown:

```sh
pnpm --filter @ha-repair/cli dev export --format md
```

Export a specific scan as JSON:

```sh
pnpm --filter @ha-repair/cli dev export <scan-id> --format json
```

## Troubleshooting

- `invalid_profile` on a live scan usually means no saved/default profile exists. Save one first or pass `--profile <name>`.
- `--deep` only works when `configPath` is local to the machine running this repo. If your Home Assistant config only exists on another host or appliance, mount or copy it locally first.
- If the web app does not show the scan you created, the CLI and API are probably using different SQLite files. Recheck `HA_REPAIR_DB_PATH`.
- Self-signed HTTPS setups can fail in Node's `fetch` and `WebSocket` stack. A trusted cert or a local HTTP endpoint is the easiest path for an initial test.
- Backup checkpoint support depends on whether your Home Assistant instance exposes a `backup` service.
