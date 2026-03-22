# Local Development

This repo runs as two local processes that share one SQLite database:

1. the API
2. the desktop app

Run all commands from the repo root unless noted otherwise.

## Runtime

- Node `22.x`
- npm workspaces from the root `package.json`
- SQLite file shared by API and OCR worker

If you use `nvm`, run:

```bash
nvm use
```

## Install

```bash
npm ci
```

## Environment

### API

Copy `.env.example` values into `apps/api/.env` or export them in your shell.

Common local variables:

```bash
WC_SKIP_LISTEN=0
WC_API_HOST=127.0.0.1
PORT=4000
```

Optional but common:

- `WC_SQLITE_PATH`
- `WC_SESSION_SECRET`
- `WC_BOOTSTRAP_ADMIN_EMAIL`
- `WC_BOOTSTRAP_ADMIN_PASSWORD`
- `WC_API_KEY`
- `BOX_JWT_CONFIG_JSON` or `BOX_JWT_CONFIG_FILE`
- `BOX_USER_ID`
- `OPENAI_API_KEY`

### Desktop

Create `apps/desktop/.env` with:

```bash
VITE_API_BASE_URL=http://localhost:4000
```

If you are intentionally using shared browser bearer fallback, also set:

```bash
VITE_WC_API_KEY=your-local-api-key
VITE_WC_ENABLE_API_KEY_FALLBACK=1
```

That browser fallback path only makes sense when the API is intentionally running without `WC_SESSION_SECRET`. If the API enables browser sessions, the desktop shell expects login and does not use shared bearer mode as the normal hosted path.

If you are using browser session auth locally:

- Do **not** set `VITE_WC_API_KEY`.
- Do **not** set `VITE_WC_ENABLE_API_KEY_FALLBACK`.
- Use the server bootstrap admin env (`WC_BOOTSTRAP_ADMIN_EMAIL`, `WC_BOOTSTRAP_ADMIN_PASSWORD`) and sign in through the browser.
- For the current Wave 2 authorization slice, create matters while signed in if you want a non-admin session user to see that matter in the catalog and have package/workbench, case-data, exhibit/packet, and document-template access immediately; case creation now seeds the creator's `case_memberships` row. Older cases can be backfilled from the admin case-access panel on the overview page.
- Connector setup is stricter than matter work: tenant-level connector routes now require an admin session, while per-case sync/hydrate actions require case membership for non-admin session users.
- Keep the hostnames aligned. A common local pairing is:
  - desktop on `http://localhost:5173`
  - API on `http://localhost:4000`

Avoid mixing `localhost` and `127.0.0.1` when testing session cookies; the browser will treat those as different sites for cookie purposes.

## Start The App

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run dev:desktop
```

The desktop runs on Vite and talks to the API through `VITE_API_BASE_URL`.

## OCR Worker

OCR queueing and OCR processing are separate.

Queue work from the UI or API, then run the worker in another terminal:

```bash
npm run ocr-worker --workspace @wc/api
```

The worker must use the same:

- `WC_SQLITE_PATH`
- Box auth env
- OCR-related env

as the API process.

## Daily Validation

Before pushing:

```bash
npm run ci:local
```

That runs:

- tests
- typecheck
- production build

## Common Failures

### Desktop cannot reach API

Check:

- `VITE_API_BASE_URL`
- `WC_CORS_ORIGIN`
- API host/port

### OCR does nothing

Check:

- worker is running
- worker and API point to the same SQLite file
- Box auth env is present for worker downloads

### Auth errors from desktop

Check:

- If using sessions:
  - `WC_SESSION_SECRET`
  - `WC_BOOTSTRAP_ADMIN_EMAIL`
  - `WC_BOOTSTRAP_ADMIN_PASSWORD`
  - `WC_AUTH_LOGIN_RATE_LIMIT_MAX`
  - `WC_AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`
  - matching hostnames between `VITE_API_BASE_URL` and the browser origin
- If using shared bearer fallback:
  - `WC_API_KEY` on the API
  - `VITE_WC_API_KEY` in the desktop env
  - `VITE_WC_ENABLE_API_KEY_FALLBACK=1` in the desktop env
  - if the API is intentionally running without `WC_SESSION_SECRET`, otherwise the shell will stay on the login path

### Remote API in a container

Use:

```bash
WC_API_HOST=0.0.0.0
```

and point `VITE_API_BASE_URL` at the public origin.

## Related Docs

- [DOGFOOD.md](./DOGFOOD.md)
- [DEPLOY.md](./DEPLOY.md) — includes **Phase 1 hosted internal web** execution checklist
- [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md)
- [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md)
- [EXECUTION_MULTI_AGENT_CHECKLIST_2026-03-22.md](./EXECUTION_MULTI_AGENT_CHECKLIST_2026-03-22.md)
