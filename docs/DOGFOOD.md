# Dogfood runbook (Tier A)

Operate the stack **without curl** for the main Box → normalize → projection loop. The desktop shell exposes **Sync Box**, **Normalize documents**, and **Queue OCR** once `VITE_API_BASE_URL` points at the API.

## Prerequisites

1. **Node** — install deps: `npm install` from repo root.
2. **Environment** — copy [`.env.example`](../.env.example) to `apps/api/.env` or export variables. For Box sync you need a valid Box JWT config (`BOX_JWT_CONFIG_JSON`, `BOX_JWT_CONFIG_FILE`, or `BOX_JWT_CONFIG`) and usually **`BOX_USER_ID`** (app user).
3. **CORS** — the API enables CORS for local desktop dev (see `WC_CORS_ORIGIN` in `.env.example`). Default allows `http://localhost:5173` and `http://127.0.0.1:5173`.

## Start services

Terminal A (API, default `http://127.0.0.1:4000`):

```bash
npm run dev
```

Terminal B (desktop):

```bash
npm run dev:desktop
```

Set desktop env so fetches reach the API (e.g. `apps/desktop/.env`):

```bash
VITE_API_BASE_URL=http://127.0.0.1:4000
```

## Create a case with a Box root folder

Use **`POST /dev/cases`** (e.g. curl or HTTP client) with a body like:

```json
{
  "name": "Sample matter",
  "box_root_folder_id": "YOUR_CLIENT_FILE_FOLDER_ID"
}
```

Copy the returned **`case_id`** (UUID).  
Use the matter’s **Client File** folder (or a doc-type folder), **not** the org-wide PracticePanther root.

Optional: **`POST /api/connectors/box/auth/jwt`** once to probe JWT and refresh connection metadata.

## Desktop flow

1. Paste **Matter ID** in the shell.
2. **Sync Box** — recursive inventory under `box_root_folder_id`; hydrates `source_items` and runs classification / branch evaluation.
3. **Normalize documents** — builds logical + canonical documents and page stubs; queues OCR attempts as designed.
4. **Refresh Projection** (or rely on auto-refresh after each action) — confirm inventory, canonical spine, and branch slices.

**Queue OCR** enqueues work in SQLite; processing requires running the **OCR worker** (`npm run ocr-worker --workspace @wc/api`) with the **same** environment as the API, especially:

- **`WC_SQLITE_PATH`** (if you set it) — must point at the **same** `authoritative.sqlite` file as the API.
- **Box JWT** vars — worker downloads file bytes from Box.

On a **host or VM**, run the worker in a second terminal or as a second systemd service (see [DEPLOY.md](./DEPLOY.md)). In **Docker**, use a second container that shares the SQLite volume and env file.

If you are intentionally using shared browser bearer fallback against an API with **`WC_API_KEY`** set, also set:

- **`VITE_WC_API_KEY`** to the same value
- **`VITE_WC_ENABLE_API_KEY_FALLBACK=1`**

For normal hosted session auth, leave both browser fallback vars unset.

For a **remote API**, set **`VITE_API_BASE_URL`** to the public origin and ensure **`WC_CORS_ORIGIN`** on the server includes your desktop origin. Remote APIs typically use **`WC_API_HOST=0.0.0.0`** and a persistent **`WC_SQLITE_PATH`** on a volume.

## Troubleshooting

| Symptom | Check |
|--------|--------|
| Sync returns 400 root folder | Set `box_root_folder_id` on the case or pass `root_folder_id` in the API body (desktop uses case field only). |
| Network / CORS errors | `VITE_API_BASE_URL` must match API host/port; `WC_CORS_ORIGIN` must include the Vite origin. |
| Empty projection | Case id typo, or API not seeded — ensure `npm run dev` ran migrations/seed. |

## See also

- [DEPLOY.md](./DEPLOY.md) — production-style deploy, two processes, SQLite volume.
- [ROADMAP.md](./ROADMAP.md) — architecture, phases, milestones.
