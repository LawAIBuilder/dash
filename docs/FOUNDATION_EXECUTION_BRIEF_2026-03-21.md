# Foundation execution brief — 2026-03-21

**This document is the authoritative execution packet for implementers.** It freezes architectural debate and turns repo-grounded conclusions into requirements. It is not a strategy memo: do not reopen forks that are settled here without new evidence from code or production.

**Current repo truth (verified):** The product is already a **browser SPA** ([`apps/desktop`](../apps/desktop)), a **Fastify API** ([`apps/api/src/server.ts`](../apps/api/src/server.ts)), an **OCR worker** process ([`apps/api/src/ocr-worker-service.ts`](../apps/api/src/ocr-worker-service.ts)), **SQLite** via `better-sqlite3` ([`apps/api/src/db.ts`](../apps/api/src/db.ts)), and a **hosted supervisor** entrypoint ([`apps/api/src/start-railway.ts`](../apps/api/src/start-railway.ts), invoked from root [`package.json`](../package.json) as `start:railway`). Anything described below as **planned** is not implemented until merged code and tests exist.

**Settled constraints (non-negotiable in this brief):**

- Hosted **internal web** is the primary product mode; local two-process dev remains operator/dev mode.
- **`npm run start:railway`** (root) is the blessed hosted entrypoint; it must remain the single blessed production path unless deliberately replaced with an equivalent documented wrapper.
- **Package worker** execution ([`runPackageWorker`](../apps/api/src/ai-service.ts) + package workbench routes) is the **canonical** execution engine for new product work.
- **Mailroom** is **later orchestrated intake**, not primary information architecture in this phase ([`MAILROOM_VISION_AND_SOURCES_2026-03-21.md`](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md)).
- **SQLite on a persistent volume** is acceptable for Phase 1; do not treat Postgres migration as a prerequisite for hosted internal web without proving SQLite is the blocker.
- **Desktop packages** and package-studio specs remain the **golden/reference contract** surface ([`docs/package-studio/README.md`](./package-studio/README.md)).
- **Vector-first retrieval** and **public multi-tenant SaaS** are out of scope for this brief. **Electron/Tauri** packaging is deferred.

**Related execution queue:** Phase 1 hosted backlog items **HST-01–HST-17** live in [`HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md`](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md). This brief defines *what* must be true; that backlog tracks *ticket-level* work.

---

## Executive decision freeze

| Topic | Decision |
| --- | --- |
| Product mode | Hosted internal web first ([`HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md`](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md)). |
| Hosted process model | API + OCR worker supervised from one deployment path (`start:railway` → [`start-railway.ts`](../apps/api/src/start-railway.ts)). |
| Execution engine | Package worker path canonical; legacy event-config assembly is compatibility-only (see [Legacy AI freeze](#legacy-ai-freeze-and-deprecation)). |
| Datastore | SQLite + volumes for Phase 1 ([`db.ts`](../apps/api/src/db.ts), [`DEPLOY.md`](./DEPLOY.md)). |
| Intelligence posture | Structured spine, retrieval discipline, exemplars, provenance before vector or fine-tuning ([`INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md`](./INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md)). |
| Mailroom | Documented as future orchestration; not the next foundation wave ([mailroom canonical doc](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md)). |

---

## Hosted readiness contract

### Official hosted runtime

- **Entry:** Root script **`npm run start:railway`** → builds and runs **`apps/api/dist/start-railway.js`** (see [`package.json`](../package.json) `start:railway`).
- **Supervision:** [`start-railway.ts`](../apps/api/src/start-railway.ts) owns starting the API and (when configured) the OCR worker in one deployment unit.
- **Persistence:** `WC_SQLITE_PATH` must point at a **mounted persistent volume**, not ephemeral container disk ([`.env.example`](../.env.example), [`DEPLOY.md`](./DEPLOY.md)).
- **Exports/artifacts:** Any directory intended to survive deploys (e.g. `WC_EXPORT_DIR` and related paths per [`DEPLOY.md`](./DEPLOY.md)) must use **persistent storage** when exports must be retained across releases.

### Pass/fail readiness gates (operator contract)

These are **requirements**, not suggestions:

1. **Build artifacts:** Production build must produce at minimum: `apps/api/dist/server.js`, `apps/api/dist/ocr-worker-service.js`, `apps/api/dist/start-railway.js` (verify via `npm run build` and listing `apps/api/dist/`).
2. **Binding:** Hosted environments set **`WC_API_HOST=0.0.0.0`** so the API listens on all interfaces ([`DEPLOY.md`](./DEPLOY.md)).
3. **`PORT`:** Platform-provided or explicitly set; API must read `PORT` as today ([`server.ts`](../apps/api/src/server.ts) / env usage).
4. **SQLite path:** `WC_SQLITE_PATH` resolves to a SQLite file whose **parent directory** exists on the volume and remains writable after deploy.
5. **Feature env:** Any connector or AI feature enabled in production must have required secrets present **before** accepting traffic (Box JWT, OpenAI, etc. per [`.env.example`](../.env.example) and [`DEPLOY.md`](./DEPLOY.md)).

### Current ops surface (implemented)

- **`GET /health`** — Returns ok, service name, `startup_recovery` ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts)). Listed as load-balancer-safe in [`DEPLOY.md`](./DEPLOY.md).
- **`GET /api/workers/ocr/health`** — Worker record, `stale` if heartbeat older than 45s ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts)). When `WC_API_KEY` is configured, this stays behind the normal bearer gate.
- **`GET /api/ops/readiness`** — Operator snapshot of effective paths, writable state, last migration id, non-secret Box/OpenAI presence booleans, OCR heartbeat summary, and startup recovery ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts), [`readiness.ts`](../apps/api/src/readiness.ts)).
- **`POST /api/ops/backups/snapshot`** — Authenticated operator snapshot route that writes a consistent SQLite backup plus copies exports/uploads into a manifest-backed snapshot directory ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts), [`backup.ts`](../apps/api/src/backup.ts)).

### Round 1 startup validation (implemented)

On API boot, the API now **fails fast** (non-zero exit) when:

- The directory for `WC_SQLITE_PATH` is missing or not writable.
- Export/artifact directory is configured but not writable.

The implementation is split in two phases:

1. **Pre-DB path validation** before `openDatabase()` so invalid hosted mounts fail before the app starts serving ([`server.ts`](../apps/api/src/server.ts), [`readiness.ts`](../apps/api/src/readiness.ts)).
2. **Post-DB readiness validation** after migrations/seed/recovery to verify DB writability and worker-heartbeat writability against the real runtime schema ([`server.ts`](../apps/api/src/server.ts), [`readiness.ts`](../apps/api/src/readiness.ts), [`worker-health.ts`](../apps/api/src/worker-health.ts)).

Startup logging now includes the effective SQLite path, export path, and whether the export directory was explicitly configured ([`server.ts`](../apps/api/src/server.ts)).

### Round 1 consolidated readiness endpoint (implemented)

**`GET /api/ops/readiness`** is now the single JSON contract for operators, distinct from **`/health`**:

| Field / concern | Intent |
| --- | --- |
| `db_path` | Effective SQLite path |
| `db_writable` | Boolean |
| `export_dir_writable` | Boolean (or `null` if no export dir) |
| `ocr_worker_stale` | Align with `/api/workers/ocr/health` semantics |
| `last_migration_id` | Or equivalent schema version marker |
| `openai_configured` | Non-secret boolean |
| `box_configured` | Non-secret boolean |
| `startup_recovery` | Pass-through from existing recovery summary ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts)) |

**Semantics:** The current top-level `ok` indicates the readiness route responded; operators should inspect nested writable/config/stale fields for actual runtime status.

**Security:** This endpoint does not leak secrets and already sits behind the same bearer boundary as the rest of the API when `WC_API_KEY` is configured ([`server.ts`](../apps/api/src/server.ts)).

### Backups and restore

**Implemented operator snapshot path:**

- **Route:** **`POST /api/ops/backups/snapshot`** now creates an operator snapshot on disk.
- **SQLite:** Uses `better-sqlite3`’s online backup API to write a standalone SQLite backup file ([`backup.ts`](../apps/api/src/backup.ts)).
- **Exports/artifacts:** Copies package exports, exhibit exports, and matter uploads when those directories exist ([`backup.ts`](../apps/api/src/backup.ts), [`storage-paths.ts`](../apps/api/src/storage-paths.ts)).
- **Manifest:** Writes `manifest.json` with source paths, backup paths, and per-directory copy summaries.

**Manual fallback path:** Stop the service and copy the SQLite file plus `-wal` / `-shm` and the same artifact/upload directories as described in [`DEPLOY.md`](./DEPLOY.md).

**Restore drill:** Documented in [`DEPLOY.md`](./DEPLOY.md); still requires operator execution on a non-production clone.

### Named runbooks (must exist in [`DEPLOY.md`](./DEPLOY.md) / operator docs)

1. First deploy  
2. Restart after failed migration  
3. Stale OCR worker / backlog rising  
4. Missing volume / wrong mount  
5. Disk full  
6. Restore from backup  
7. Rotate **`WC_API_KEY`** during auth transition (shared secret still in use today)

### Remaining gap note

[`DEPLOY.md`](./DEPLOY.md), [`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts), and [`backup.ts`](../apps/api/src/backup.ts) now cover the basic hosted durability contract. The remaining hosted-ops gap is to **execute** a restore drill in a real non-prod environment and lock down ownership/retention for snapshots.

---

## Auth and principal migration

### Current truth (implemented)

- **Browser session auth exists now:** the API exposes **`/api/auth/login`**, **`/api/auth/session`**, and **`/api/auth/logout`**, backed by **`users`**, **`auth_sessions`**, and **`case_memberships`** ([`auth.ts`](../apps/api/src/auth.ts), [`auth-routes.ts`](../apps/api/src/routes/auth-routes.ts), [`schema.ts`](../apps/api/src/schema.ts)).
- **Request principal exists now:** Fastify requests now resolve **`request.user`** from the HTTP-only session cookie when **`WC_SESSION_SECRET`** is configured ([`auth.ts`](../apps/api/src/auth.ts), [`server.ts`](../apps/api/src/server.ts)).
- **Bootstrap login path exists now:** a first admin can be provisioned from **`WC_BOOTSTRAP_ADMIN_EMAIL`** and **`WC_BOOTSTRAP_ADMIN_PASSWORD`** on startup ([`auth.ts`](../apps/api/src/auth.ts), [`server.ts`](../apps/api/src/server.ts), [`.env.example`](../.env.example)).
- **Fallback shared bearer still exists:** `VITE_WC_API_KEY` / `WC_API_KEY` remain as transitional fallback and break-glass auth ([`apps/desktop/src/config.ts`](../apps/desktop/src/config.ts), [`server.ts`](../apps/api/src/server.ts)).
- **Approval attribution is partially real now:** package approval now prefers the authenticated principal, stores **`approved_by_user_id`**, and only accepts **`x-wc-actor`** when the request is using API-key fallback ([`package-workbench-routes.ts`](../apps/api/src/routes/package-workbench-routes.ts), [`ai-service.ts`](../apps/api/src/ai-service.ts), [`schema.ts`](../apps/api/src/schema.ts)).

### Target architecture (remaining after the first slice)

**Default hosted browser authentication:** **HTTP-only session cookie** issued by the API after login (same site / CSRF-safe patterns). **JWT** may exist later for alternate clients; it is **not** the default browser contract in this brief.

The repo now has the first real principal slice. The remaining auth work is to extend that principal model from login + package approval to broader route guards and actor stamping.

### Schema and data model (implemented foundation, broader use still planned)

| Construct | Purpose |
| --- | --- |
| `users` | Human principals |
| Roles | At minimum: `operator`, `reviewer`, `approver`, `admin` (exact storage: enum column vs join table — implementer choice, but roles must be enforceable) |
| `case_memberships` (or equivalent) | Case-scoped read/write/run/approve |
| Actor columns | `created_by`, `updated_by`, `approved_by`, optional `acted_as_role` on state-changing records |

**Current status:** `approved_by_user_id` on `package_runs` is implemented; broader actor stamping remains open.

### Migration sequence (locked)

| Phase | Content |
| --- | --- |
| **A** | Principal middleware; session login; keep **`WC_API_KEY`** / browser bearer only as **break-glass** or dev fallback. Stop preferring `x-wc-actor` when `request.user` exists. **Implemented for the first vertical slice.** |
| **B** | Actor stamping on all state-changing writes (approvals, package rules, uploads, connector actions, templates, exports). **Partially implemented**: package run approvals now stamp authenticated principals. |
| **C** | Route guards: case read/write, package run/approve, connector manage, ops/admin. |
| **D** | Remove **`VITE_WC_API_KEY`** from normal hosted usage; retain server **`WC_API_KEY`** only for M2M or break-glass if absolutely required. |

---

## Blueprint canonicalization

### Intent

Introduce a **canonical package/playbook model** over existing machinery — **consolidation**, not a greenfield rewrite. Existing tables stay in place initially; first migrations add **ownership and versioning**, not destructive replacement.

### Core concepts (planned)

| Concept | Definition |
| --- | --- |
| **`blueprints`** | Package **family** anchor (stable id, package type, human name). Maps from today’s product preset / package identity concepts. |
| **`blueprint_versions`** | **Versioned execution contract** used by runs: prompts, retrieval profile, approval policy hooks, artifact expectations, evaluation hooks. |

**Execution binding:** [`package_runs`](../apps/api/src/schema.ts) (and related) should reference **`blueprint_version_id`** (or equivalent) so every run is auditable as “this definition version.”

### Map from current structures

| Current | Maps to |
| --- | --- |
| `product_presets` | Blueprint **family** anchor |
| `product_rulepacks` | Default rules for a blueprint version |
| `product_workflows` | Stage / workflow contract for a blueprint version |
| `approval_gates` | Approval policy for a blueprint version |
| `artifact_templates` | Artifact contract for a blueprint version |
| `package_rules` | **Case-level overrides** against a locked blueprint version (not a second primary definition) |
| Prompt branches in [`ai-service.ts`](../apps/api/src/ai-service.ts) | **`prompt_contract`** (versioned text/JSON) on `blueprint_versions` |
| Retrieval behavior in [`retrieval.ts`](../apps/api/src/retrieval.ts) | **`retrieval_profile`** on `blueprint_versions` |
| [`package_runs`](../apps/api/src/schema.ts) | **Executions** of a `blueprint_version` |

### Required fields on `blueprint_versions` (conceptual)

Package type, version string, status (`draft` | `active` | `deprecated`), execution engine (**`package_worker`**), default model, **output contract**, **retrieval profile**, **prompt contract**, **provenance policy**, **evaluation policy** (each may be JSON columns or normalized child tables — implementer choice with migration safety).

### First canonicalization scope (frozen)

Exactly **three** package types, end-to-end blueprint-backed:

1. Hearing prep  
2. Claim petition  
3. Discovery response  

No expansion until those three are stable in production.

---

## Matter operating console

### Direction (frozen)

- **Matter-centric** IA: the **case overview** route evolves into the **primary operating console** — [`CaseOverviewPage.tsx`](../apps/desktop/src/pages/cases/CaseOverviewPage.tsx). Do **not** add a separate top-level “console” product shell in this wave.
- **Mailroom** (when built) **feeds** this console; it does not compete as a co-equal home base ([mailroom doc](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md)).

### Five questions (every console view must answer)

1. Where is this matter **now**?  
2. What is **blocked**?  
3. What is **missing** (proof, docs, OCR)?  
4. What should happen **next**?  
5. What is awaiting **review or approval**?

### Six panels (layout contract)

1. **Matter header** — Identity, branch/stage, critical dates, source health, ownership roles, readiness.  
2. **Next actions rail** — Urgent operational cards (proof gaps, stale sync, OCR backlog, drafts awaiting approval, export pending).  
3. **Roadmap / stage progression** — Active branch, completed stages, blockers, SLA/age.  
4. **Evidence and document readiness** — Proof gaps, key documents, correspondence/exhibits summary, OCR confidence flags.  
5. **Package execution panel** — Available packages, last run, approval, exports, rerun, provenance warnings.  
6. **Activity and audit panel** — Uploads, sync, branch events, approvals, exports.

Projection data for many of these concepts already exists in the API projection path ([`runtime.ts`](../apps/api/src/runtime.ts), [`projection.ts`](../apps/api/src/projection.ts)); the gap is **product surfacing**, not invention from zero.

---

## Legacy AI freeze and deprecation

### The split (current code)

| Legacy / compatibility | Canonical path |
| --- | --- |
| `ai_event_configs`, `ai_jobs`, [`runAIAssemblyJob`](../apps/api/src/ai-service.ts) | [`runPackageWorker`](../apps/api/src/ai-service.ts), package workbench routes, `package_runs`, approvals, exports |
| [`CaseAIPage.tsx`](../apps/desktop/src/pages/cases/CaseAIPage.tsx) (event-config-driven UI) | Case packages / package workbench flows |

**Decision:** **Package worker** is the **canonical execution engine** for all new product behavior.

### Deprecation sequence (locked)

| Stage | Action |
| --- | --- |
| **1** | **Freeze** legacy path: no new event types, no new UX investment, no new prompt sophistication in `runAIAssemblyJob` except bugfixes. |
| **2** | **Relabel** in UI and docs: “legacy / compatibility only.” |
| **3** | **Parity:** For each active legacy use case, ship an equivalent **blueprint-backed** package path. |
| **4** | **Restrict:** Disable **new** `ai_event_configs` creation; keep read-only history; limit rerun where unavoidable. |
| **5** | **Retire** legacy creation from primary UI/API; retain historical rows and jobs for audit. |

**Governing rule:** **Migrate forward behavior first; history later.** New work uses package worker; old records remain visible.

---

## Ordered execution waves

| Wave | Focus |
| --- | --- |
| **0** | Doc + checklist lock (this brief + [`HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md`](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md)); align [`DEPLOY.md`](./DEPLOY.md) with readiness gates. |
| **1** | Hosted readiness follow-through: execute a real restore drill, confirm backup retention/ownership, and lock the reference environment. Startup validation, **`GET /api/ops/readiness`**, backup snapshots, and operator runbooks are already implemented on `main`. |
| **2** | Auth: session cookies, `request.user`, actor stamping, route guards, remove shared browser key from normal hosted use. |
| **3** | Blueprints: `blueprints` + `blueprint_versions`, wire three package types, migrate prompts/retrieval references incrementally. |
| **4** | Matter operating console: evolve `CaseOverviewPage` toward the six-panel contract. |
| **5** | Legacy AI freeze stages 1–2 immediately in parallel where safe; stages 3–5 as parity completes. |
| **6** | Mailroom orchestration ([canonical mailroom doc](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md)) — after trust boundaries exist. |

**Overlap allowed:** Waves **3** and **4** may overlap so the blueprint model is not “backend-only” for multiple releases.

---

## Repo anchors (evidence index)

| Claim | Where |
| --- | --- |
| SPA + API + worker + SQLite | [`HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md`](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md), [`server.ts`](../apps/api/src/server.ts), [`db.ts`](../apps/api/src/db.ts) |
| `start:railway` blessed | [`package.json`](../package.json), [`start-railway.ts`](../apps/api/src/start-railway.ts) |
| Ops health endpoints | [`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts) |
| Startup path validation + readiness snapshot | [`readiness.ts`](../apps/api/src/readiness.ts), [`server.ts`](../apps/api/src/server.ts) |
| Backup snapshot route + storage copy contract | [`backup.ts`](../apps/api/src/backup.ts), [`storage-paths.ts`](../apps/api/src/storage-paths.ts), [`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts) |
| Shared API key auth | [`config.ts`](../apps/desktop/src/config.ts), [`server.ts`](../apps/api/src/server.ts) |
| `x-wc-actor` on approve | [`package-workbench-routes.ts`](../apps/api/src/routes/package-workbench-routes.ts) |
| Dual AI paths | [`ai-service.ts`](../apps/api/src/ai-service.ts), [`package-workbench-routes.ts`](../apps/api/src/routes/package-workbench-routes.ts), [`CaseAIPage.tsx`](../apps/desktop/src/pages/cases/CaseAIPage.tsx) |
| Case overview shell | [`CaseOverviewPage.tsx`](../apps/desktop/src/pages/cases/CaseOverviewPage.tsx), [`router.tsx`](../apps/desktop/src/router.tsx) |

---

## What this brief explicitly does not do

- It does not replace [`ROADMAP.md`](./ROADMAP.md) as a living backlog (that file is known to be partially stale; do not expand it in lieu of this brief).
- It does not describe **implemented** behavior for items marked **planned** — verify in code before claiming done.

---

*Authoring date: 2026-03-21. Amend only with dated revisions or explicit version bumps when contracts change.*
