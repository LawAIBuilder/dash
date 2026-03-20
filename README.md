# wc-legal-prep

Monorepo for a **workers’ comp hearing-prep / matter-intelligence** stack: authoritative **Fastify + SQLite** API, **React/Vite** desktop shell, shared **domain-core** types.

## Documentation

- **[docs/ROADMAP.md](docs/ROADMAP.md)** — Architecture, code map, test surface, milestones (M1–M3), phased roadmap, non-goals.
- **[docs/DOGFOOD.md](docs/DOGFOOD.md)** — Operator runbook: env, start servers, case + Box folder, desktop Sync / Normalize / OCR queue.
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — Deploy notes: SQLite volume, API + OCR worker processes, `WC_API_HOST`, CORS, API key.
- **Cursor:** open the plan **WC Legal Prep Roadmap** from the repo’s [`.cursor/plans/wc_legal_prep_roadmap.plan.md`](.cursor/plans/wc_legal_prep_roadmap.plan.md) for trackable todos.

## Quick start

```bash
npm install
cp .env.example .env   # fill Box JWT vars for sync
npm run dev            # API (from repo root)
# other terminal:
cd apps/desktop && npx vite --port 5173   # or: npm run dev:desktop from root
```

Set `VITE_API_BASE_URL` (default API is `http://127.0.0.1:4000` unless `PORT` is set) so the desktop can reach the API.

## Scripts (root)

| Script | Purpose |
|--------|---------|
| `npm run dev` | API dev server |
| `npm run dev:desktop` | Vite desktop shell |
| `npm run typecheck` | Typecheck workspaces |
| `npm run test` | Tests (e.g. `@wc/api` Vitest) |
| `npm run build` | Build workspaces |
| `npm run ocr-worker --workspace @wc/api` | Process queued `ocr_attempts` (Box PDF/image; same env/DB as API) |

## Layout

- `apps/api` — HTTP API, migrations, Box connector, projection builder  
- `apps/desktop` — Matter dashboard (projection consumer)  
- `packages/domain-core` — Shared projection and event contracts  
- `packages/wc-rules`, `packages/wc-calculators` — Rule packs and calculators  
