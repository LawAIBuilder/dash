# Deploying the authoritative API + OCR worker

The stack is **Node + SQLite (WAL)**. The HTTP API and the OCR worker are **separate processes** that must share the **same database file** and **compatible environment** (Box JWT, optional API key).

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

Production sync is still **stubbed**; use dev hydrate or see `pp-provider.ts` / `.env.example` for planned OAuth vars.

## See also

- [DOGFOOD.md](./DOGFOOD.md) — local runbook and desktop env.
- [OCR_NOTES.md](./OCR_NOTES.md) — pdfjs / Tesseract notes.
