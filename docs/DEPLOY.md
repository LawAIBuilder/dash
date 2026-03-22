# Deploying the authoritative API + OCR worker

The stack is **Node + SQLite (WAL)**. The HTTP API and the OCR worker are **separate processes** that must share the **same database file** and **compatible environment** (Box JWT, optional API key).

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
- Back up the file + `-wal` / `-shm` when the API is stopped or via SQLite backup API.

## Listen address

- By default the API binds **`127.0.0.1`** (local dev).
- In containers / PaaS, set **`WC_API_HOST=0.0.0.0`** so the platform can route traffic to the process.
- **`PORT`** (default `4000`) is the HTTP port.

## CORS

- Set **`WC_CORS_ORIGIN`** to a comma-separated list of allowed origins (e.g. your hosted desktop shell `https://app.example.com`).
- If unset, local Vite origins are allowed (see `server.ts`).

## API key (optional)

- Set **`WC_API_KEY`** on the API; clients must send `Authorization: Bearer <same value>`.
- Desktop / browser: **`VITE_WC_API_KEY`** must match (see [DOGFOOD.md](./DOGFOOD.md)).

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
| `WC_API_KEY` | Strongly recommended | Shared bearer for browser until real auth; rotate if leaked. |
| `WC_ENABLE_DEV_ROUTES` | No | Omit or `0` in production. |
| `OPENAI_API_KEY` | If AI features used | Server-side only. |
| Box JWT vars | If Box sync/OCR | See [.env.example](../.env.example). |
| PracticePanther OAuth vars | If PP sync used | `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, optional `PP_REDIRECT_URI`, optional `PP_API_BASE_URL`. |
| `WC_SOURCE_CONNECTION_SECRET` | Strongly recommended if PP OAuth used | Encrypts stored connector metadata/tokens; see `pp-provider` and connector code paths. |
| `WC_EXPORT_DIR` | If package DOCX exports used | Writable directory for package-run DOCX exports. |
| `WC_EXHIBIT_EXPORT_DIR` | If packet PDF exports used | Writable directory for exhibit packet PDF exports. |

**Static client (baked at build time):**

| Variable | Notes |
|----------|--------|
| `VITE_API_BASE_URL` | HTTPS origin of the API, e.g. `https://api.yourdomain.com`. |
| `VITE_WC_API_KEY` | Must match `WC_API_KEY` if using shared bearer. **Not a secret** in the browser bundle—acceptable only for **trusted internal** use. |

Rebuild and redeploy the static app whenever the API URL or key strategy changes.

### 4. Static web app

- Build `apps/desktop` with production `VITE_*` (e.g. `.env.production` or CI env).
- Host `apps/desktop/dist` on any **HTTPS** static host (CDN, object storage + CloudFront, Netlify, Vercel, etc.).
- Confirm **CORS**: API allows the static origin via `WC_CORS_ORIGIN`.

### 5. Post-deploy smoke checks

- `GET https://<api-origin>/health` → 200 (no auth; safe for load balancers).
- Open `https://<app-origin>/` in a browser; confirm no mixed-content (HTTPS → HTTP API is blocked by browsers—API must be HTTPS too).
- Exercise one authenticated read (e.g. case list) if `WC_API_KEY` is set.

### 6. Backup and restore (minimum)

- SQLite lives in one file (+ often `-wal` / `-shm`). Back up with the API **quiesced** or use SQLite’s online backup API; document who runs backups and how often.
- Run a **restore drill** on a non-production clone at least once before calling the environment “production.”

### 7. Hosted-web stop line (from product plan)

Hosted internal web is the **default** operating mode when:

- One operator can deploy/update without ad-hoc shell guesswork (runbook + checklist).
- One end user can work entirely through the app URL (no local terminal).
- OCR continues without a human babysitting a separate worker terminal (supervisor handles worker).
- Backups and restore are **documented and tested**.

### 8. What this checklist explicitly does not do

- Multi-tenant public SaaS hardening (see [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md) Phase 2).
- PostgreSQL or auth migration (separate epic after hosted internal is stable).

---

## See also

- [DOGFOOD.md](./DOGFOOD.md) — local runbook and desktop env.
- [LOCAL_DEV.md](./LOCAL_DEV.md) — developer workflow vs hosted product mode.
- [OCR_NOTES.md](./OCR_NOTES.md) — pdfjs / Tesseract notes.
- [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md) — product-mode decision and phased plan.
- [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md) — Phase 1 ticket backlog.
