# Deploying the authoritative API + OCR worker

The stack is **Node + SQLite (WAL)**. The HTTP API and the OCR worker are **separate processes** that must share the **same database file** and **compatible environment** (Box JWT, browser-session auth or fallback API key, and the same writable artifact paths).

## Primary product mode (hosted internal web)

The **supported** way to run this product for daily use is **hosted internal web**: static browser client + API + OCR worker + SQLite on a **persistent volume**. Local two-terminal startup is for **development and operators** only.

- Rationale and phases: [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md)
- Phase 1 work items (ticket-style): [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md)

## What runs where

| Process | Entry | Role |
|--------|--------|------|
| API | `npm run dev` / `node apps/api/dist/server.js` | Fastify, migrations, projection, connectors |
| OCR worker | `npm run ocr-worker --workspace @wc/api` | Drains `ocr_attempts` queue, writes `canonical_pages.raw_text` |

Without the worker, **Queue OCR** only enqueues rows; text is not produced until the worker runs.

## SQLite persistence

- Default DB path (from API cwd): `apps/api/data/authoritative.sqlite`.
- Override with **`WC_SQLITE_PATH`** (absolute path recommended in production).
- Mount a **persistent volume** at the directory containing that file (or set the env to a path on the volume).
- Create the parent directory on that volume **before first start**; startup now fails fast if the SQLite parent directory is missing or not writable.
- Back up the file + `-wal` / `-shm` when the API is stopped or via SQLite backup API.

## Listen address

- By default the API binds **`127.0.0.1`** (local dev).
- In containers / PaaS, set **`WC_API_HOST=0.0.0.0`** so the platform can route traffic to the process.
- **`PORT`** (default `4000`) is the HTTP port.

## CORS

- Set **`WC_CORS_ORIGIN`** to a comma-separated list of allowed origins (e.g. your hosted desktop shell `https://app.example.com`).
- If unset, local Vite origins are allowed (see `server.ts`).

## Browser auth and fallback API key

- **Preferred hosted browser auth:** set **`WC_SESSION_SECRET`** and bootstrap at least one admin with **`WC_BOOTSTRAP_ADMIN_EMAIL`** and **`WC_BOOTSTRAP_ADMIN_PASSWORD`**. The API then issues an HTTP-only session cookie through **`POST /api/auth/login`**.
- **Current Wave 2 authorization slice:** in the package/workbench and case-data routes, non-admin session users now need a **`case_memberships`** row for case access; cases created through session auth automatically seed membership for the creator.
- **Current recovery path for older cases:** admins can now manage case memberships and run a per-case backfill for active users from the matter overview or the case-membership API routes. That fixes legacy cases that predate membership seeding without raw SQL.
- **Shared bearer fallback:** **`WC_API_KEY`** remains available for break-glass, machine-to-machine, and transitional internal use. It is no longer the preferred normal browser path.
- **Browser bundle fallback:** only set **`VITE_WC_API_KEY`** if you are intentionally still using shared browser bearer mode. It is **not** required when hosted browser login is enabled.
- This repo now supports both modes, but the shared-key browser model is still **transitional hosted auth**, not the final security model. See [FOUNDATION_EXECUTION_BRIEF_2026-03-21.md](./FOUNDATION_EXECUTION_BRIEF_2026-03-21.md).

### Current connector auth split

| Route family | Session-auth rule | Transitional behavior |
| --- | --- | --- |
| Connector account setup and tenant-level browsing: `/api/connectors/box/auth/start`, `/api/connectors/box/auth/jwt`, `/api/connectors/box/folders/:folderId/items`, `/api/connectors/practicepanther/status`, `/api/connectors/practicepanther/matters`, `/api/connectors/practicepanther/auth/start`, `/api/connectors/:provider/auth/complete` | **Admin-only** | `WC_API_KEY` fallback still works; open-dev mode stays open if no auth mode is configured |
| Per-case sync and development hydrate: `/api/connectors/box/sync`, `/api/connectors/practicepanther/sync`, `/api/connectors/box/development/hydrate`, `/api/connectors/practicepanther/development/hydrate` | **Case membership required** for non-admin session users | Admin override still works; `WC_API_KEY` fallback still works; open-dev mode stays open if no auth mode is configured |
| OAuth callback: `/api/connectors/practicepanther/callback` | **Unchanged callback exemption** | Security still depends on OAuth `state` and redirect-uri validation, not case membership |

## Box (OCR worker + sync)

- **`BOX_JWT_CONFIG_JSON`**, **`BOX_JWT_CONFIG_FILE`**, or **`BOX_JWT_CONFIG`** — same as local.
- **`BOX_USER_ID`** (or enterprise subject) as required by your JWT app.
- Worker uses the same vars to download originals from Box.

## Running two processes (examples)

### systemd (VPS)

Two units, same `WorkingDirectory`, same `EnvironmentFile`, different `ExecStart`:

```ini
# wc-api.service
ExecStart=/usr/bin/node /opt/wc-legal-prep/apps/api/dist/server.js
```

```ini
# wc-ocr-worker.service
ExecStart=/usr/bin/node /opt/wc-legal-prep/apps/api/dist/ocr-worker-cli.js
Restart=on-failure
```

Run the worker on a timer or keep it always-on with `OCR_WORKER_MAX_PASSES` high enough to drain the queue each wake.

### Docker Compose (sketch)

- One service `api` (expose `PORT`, mount volume for SQLite dir, env file).
- One service `ocr-worker` (no public ports, **same volume + env** as `api`, command `node .../ocr-worker-cli.js`).
- Do **not** run two APIs against one DB file without coordination; one writer for migrations is enough.

## Health check

- `GET /health` — no auth when `WC_API_KEY` is set (intentionally open for load balancers).

## PracticePanther

Hosted/internal PracticePanther OAuth + sync are available when the production env is configured. The API exposes status, auth start/callback, matter list, and sync routes for hosted use.

- Required for hosted PP OAuth/sync: `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, and a valid redirect URI (explicit `PP_REDIRECT_URI` recommended).
- Strongly recommended when PP OAuth is enabled: `WC_SOURCE_CONNECTION_SECRET` so stored connector metadata is encrypted at rest.
- If PP OAuth env is missing, the production sync route returns a config-required error; dev hydrate routes remain a development-only fallback.

---

## Phase 1: hosted internal web execution checklist

Use this when standing up or updating a **reference** hosted internal environment. It does not replace platform-specific clicks (Railway dashboard, DNS, TLS); it lists what must be true for this repo.

### 1. Build outputs (from repo root)

```bash
npm ci
npm run build
```

Produces at least:

- `apps/api/dist/server.js`, `apps/api/dist/start-railway.js`, `apps/api/dist/ocr-worker-service.js`
- `apps/desktop/dist/` (static assets for the browser client)

CI should run the same; the hosted API must run **built** `dist`, not `tsx` dev.

### 2. API + OCR worker topology

- **Recommended:** one process supervisor that starts API + worker, e.g. root script `npm run start:railway` → [apps/api/src/start-railway.ts](../apps/api/src/start-railway.ts).
- **SQLite:** mount a **persistent volume**; set **`WC_SQLITE_PATH`** to an **absolute** path on that volume (same path concept the supervisor and both children use).
- **Bind:** `WC_API_HOST=0.0.0.0`; **`PORT`** from the platform.

### 2a. Hosted startup contract

- Startup now validates the SQLite parent directory before the API accepts requests.
- If **`WC_EXPORT_DIR`** is configured, startup also validates that directory exists and is writable.
- Invalid hosted path configuration should stop startup **before** the server begins accepting traffic.
- Operators should expect startup logging to include the effective SQLite path, export path, and the hosted readiness context.

### 3. Production environment contract

Set these in the host **secret store** / env UI (never commit real values):

| Variable | Required | Notes |
|----------|----------|--------|
| `NODE_ENV` | Yes | `production` — sanitized errors, dev routes off by default. |
| `WC_API_HOST` | Yes | `0.0.0.0` behind a platform router. |
| `PORT` | Yes | Usually injected by PaaS. |
| `WC_SQLITE_PATH` | Yes (hosted) | Absolute path on persistent volume. |
| `WC_CORS_ORIGIN` | Yes | Comma-separated **exact** origins of the static app, e.g. `https://app.yourdomain.com`. |
| `WC_TRUST_PROXY` | If behind proxy/LB | `true` so client IP and rate limits are correct. |
| `WC_SESSION_SECRET` | Strongly recommended for hosted browser use | Enables HTTP-only browser sessions; required for `/api/auth/login`. |
| `WC_SESSION_TTL_HOURS` | Optional | Session lifetime; defaults to `12`. |
| `WC_BOOTSTRAP_ADMIN_EMAIL` | Strongly recommended for first hosted login | Seeds the first admin account at startup if missing. |
| `WC_BOOTSTRAP_ADMIN_PASSWORD` | Strongly recommended for first hosted login | Pairs with bootstrap admin email; store in secret manager only. |
| `WC_BOOTSTRAP_ADMIN_NAME` | Optional | Friendly name for the bootstrap admin account. |
| `WC_BOOTSTRAP_ADMIN_RESEED` | Optional | Set to `1` only when intentionally rotating the bootstrap admin password from env on startup. |
| `WC_API_KEY` | Optional fallback | Shared bearer for break-glass / M2M / transitional internal use; rotate if leaked. |
| `WC_ENABLE_DEV_ROUTES` | No | Omit or `0` in production. |
| `OPENAI_API_KEY` | If AI features used | Server-side only. |
| Box JWT vars | If Box sync/OCR | See [.env.example](../.env.example). |
| PracticePanther OAuth vars | If PP sync used | `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, optional `PP_REDIRECT_URI`, optional `PP_API_BASE_URL`. |
| `WC_SOURCE_CONNECTION_SECRET` | Strongly recommended if PP OAuth used | Encrypts stored connector metadata/tokens; see `pp-provider` and connector code paths. |
| `WC_EXPORT_DIR` | If package DOCX exports used | Writable directory for package-run DOCX exports. |
| `WC_EXHIBIT_EXPORT_DIR` | If packet PDF exports used | Writable directory for exhibit packet PDF exports. |
| `WC_UPLOAD_DIR` | If local uploads are used | Writable directory for matter-upload file assets; include in backups if uploads are authoritative. |
| `WC_BACKUP_DIR` | Recommended | Writable directory for operator-created backup snapshots. Defaults to a `backups/` sibling next to the SQLite file if unset. |

**Static client (baked at build time):**

| Variable | Notes |
|----------|--------|
| `VITE_API_BASE_URL` | HTTPS origin of the API, e.g. `https://api.yourdomain.com`. |
| `VITE_WC_API_KEY` | Only if intentionally using shared bearer fallback. **Not a secret** in the browser bundle—acceptable only for **trusted internal** use. |

Rebuild and redeploy the static app whenever the API URL or key strategy changes.

### 4. Static web app

- Build `apps/desktop` with production `VITE_*` (e.g. `.env.production` or CI env).
- Host `apps/desktop/dist` on any **HTTPS** static host (CDN, object storage + CloudFront, Netlify, Vercel, etc.).
- Confirm **CORS**: API allows the static origin via `WC_CORS_ORIGIN`.

### 5. Post-deploy smoke checks

- `GET https://<api-origin>/health` → 200 (no auth; safe for load balancers).
- `GET https://<api-origin>/api/workers/ocr/health` → worker summary is present and `stale` is understandable for the current worker state. Send `Authorization: Bearer <WC_API_KEY>` if `WC_API_KEY` is configured.
- `GET https://<api-origin>/api/ops/readiness` → confirms actual db path, export path, writable-path state, migration id, Box/OpenAI presence booleans, and OCR stale summary. Send `Authorization: Bearer <WC_API_KEY>` if `WC_API_KEY` is configured.
- `GET https://<api-origin>/api/auth/session` → confirms whether browser session auth is enabled and whether a principal is currently authenticated.
- Open `https://<app-origin>/` in a browser; confirm no mixed-content (HTTPS → HTTP API is blocked by browsers—API must be HTTPS too).
- If browser session auth is enabled, complete one real browser login and verify the workspace loads without `VITE_WC_API_KEY`.
- If `WC_API_KEY` is still in use, exercise one authenticated read (e.g. case list) with the bearer too.

### 5a. Required writable paths

- **SQLite parent dir:** the parent directory of `WC_SQLITE_PATH` must exist and be writable.
- **Configured export dir:** if `WC_EXPORT_DIR` is set, it must exist and be writable.
- **Readiness route:** `/api/ops/readiness` is the operator-facing way to confirm current path resolution and writeability without digging through env or logs manually.
- **Readiness semantics:** inspect the nested writable/config/stale fields; the current top-level `ok` indicates the readiness route itself responded, not that every dependency is green.

### 6. Backup and restore (minimum)

#### 6a. Preferred operator snapshot

Create an authenticated snapshot through the API:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer ${WC_API_KEY}" \
  -H "Content-Type: application/json" \
  https://<api-origin>/api/ops/backups/snapshot \
  -d '{"label":"before-upgrade"}'
```

Current behavior:

- Writes a **standalone SQLite backup file** using SQLite’s online backup API (no separate `-wal` / `-shm` copy needed for the route-generated snapshot).
- Writes a `manifest.json` describing source paths and copied directories.
- Copies these directories into the snapshot when they exist:
  - package DOCX exports (`WC_EXPORT_DIR` or default path)
  - exhibit PDF exports (`WC_EXHIBIT_EXPORT_DIR` or default path)
  - matter uploads (`WC_UPLOAD_DIR` or default path)
- Stores the snapshot under `WC_BACKUP_DIR` or, if unset, a `backups/` sibling next to the SQLite file.

If a **configured** backup source directory is missing or invalid, the snapshot route fails instead of silently creating a partial backup.

#### 6b. Manual fallback

If the API route is unavailable, stop the service and copy:

- the SQLite file at `WC_SQLITE_PATH`
- the matching `-wal` and `-shm` files if present
- `WC_EXPORT_DIR` if used
- `WC_EXHIBIT_EXPORT_DIR` if used
- `WC_UPLOAD_DIR` if used for authoritative matter uploads

Document who runs this, how often, and where snapshots are stored.

#### 6c. Restore drill

Run this on a non-production clone before calling the environment production-ready:

1. Stop the API/worker service or point a staging clone at isolated paths.
2. Restore the SQLite backup file to the target `WC_SQLITE_PATH`.
3. Restore package exports, exhibit exports, and uploads to the paths expected by env.
4. Confirm restored directories are writable by the service user.
5. Start the service and verify:
   - `GET /health`
   - `GET /api/ops/readiness`
   - `GET /api/workers/ocr/health`
6. Spot-check one matter with uploads and one matter with exports to confirm files open correctly.

Record the snapshot ID or manual backup location used for the drill.

Latest recorded local non-prod drill:

- **Executed:** `2026-03-22T04:55Z` (local operator run on 2026-03-21 America/Chicago)
- **Snapshot ID:** `2026-03-22-04-55-55-restore-drill-b85f5c1c`
- **Validated after restore:** `GET /health`, `GET /api/ops/readiness`, and `GET /api/cases` against the restored clone all succeeded.
- **Scope note:** This proves the repo’s restore mechanics on a local non-production clone. A platform-specific staged restore remains recommended before calling hosted production fully hardened.

### 7. Operator runbooks

#### 7a. Deploy / update

1. Create a backup snapshot and record the returned snapshot ID.
2. Confirm env changes, especially `WC_SQLITE_PATH`, `WC_EXPORT_DIR`, `WC_EXHIBIT_EXPORT_DIR`, and `WC_UPLOAD_DIR`.
3. Deploy the new build and start via `npm run start:railway` (or the platform equivalent).
4. Run post-deploy smoke checks from section 5.
5. If smoke fails, restore from the recorded snapshot before further changes.

#### 7b. Restart

- **API wedged or deploy failed:** restart the full supervised service so API + OCR worker come back together.
- **Worker stale but API healthy:** in the current `start:railway` topology, restart the full service; if you later split deployments, restart the worker service only.
- **After restart:** recheck `/health`, `/api/workers/ocr/health`, and `/api/ops/readiness`.

#### 7c. API up, worker down

Symptoms:

- `/health` is green
- `/api/workers/ocr/health` is stale
- OCR queue grows or uploaded PDFs remain without extracted text

Actions:

1. Check worker logs first.
2. Restart the supervised service (or worker-only service if topology later splits).
3. Re-run `/api/workers/ocr/health` until heartbeat is fresh.
4. Confirm OCR queue begins draining on a test matter.

### 8. Hosted-web stop line (from product plan)

Hosted internal web is the **default** operating mode when:

- One operator can deploy/update without ad-hoc shell guesswork (runbook + checklist).
- One end user can work entirely through the app URL (no local terminal).
- OCR continues without a human babysitting a separate worker terminal (supervisor handles worker).
- Backups and restore are **documented and tested**.

### 9. What this checklist explicitly does not do

- Multi-tenant public SaaS hardening (see [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md) Phase 2).
- PostgreSQL migration or full authorization completion across every route family. The current internal auth slice covers browser sessions, package approvals, and case-membership administration/backfill for the package/workbench and case-data surfaces; broader case-scoped authorization remains ongoing.

---

## See also

- [DOGFOOD.md](./DOGFOOD.md) — local runbook and desktop env.
- [LOCAL_DEV.md](./LOCAL_DEV.md) — developer workflow vs hosted product mode.
- [OCR_NOTES.md](./OCR_NOTES.md) — pdfjs / Tesseract notes.
- [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md) — product-mode decision and phased plan.
- [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md) — Phase 1 ticket backlog.
