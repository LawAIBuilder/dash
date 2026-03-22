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
4. **SQLite path:** `WC_SQLITE_PATH` resolves to a directory that exists on the volume and remains writable after deploy.
5. **Feature env:** Any connector or AI feature enabled in production must have required secrets present **before** accepting traffic (Box JWT, OpenAI, etc. per [`.env.example`](../.env.example) and [`DEPLOY.md`](./DEPLOY.md)).

### Current ops surface (implemented)

- **`GET /health`** — Returns ok, service name, `startup_recovery` ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts)). Listed as load-balancer-safe in [`DEPLOY.md`](./DEPLOY.md).
- **`GET /api/workers/ocr/health`** — Worker record, `stale` if heartbeat older than 45s ([`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts)).

### Planned startup validation (to implement)

On API boot, **fail fast** (non-zero exit) when:

- The directory for `WC_SQLITE_PATH` is missing or not writable.
- Export/artifact directory is configured but not writable.

On startup, **log** at minimum: effective DB path, export path (if any), bind host/port, whether OCR worker subprocess is enabled.

Run a **startup self-check** that verifies: migrations applied, DB writable, worker heartbeat storage writable (if worker enabled), export dir writable (if configured). (DB migrations and worker health patterns exist in [`db.ts`](../apps/api/src/db.ts) and [`worker-health`](../apps/api/src/worker-health.ts); wiring a single gate is **planned**.)

### Planned consolidated readiness endpoint

**`GET /api/ops/readiness`** (planned) — Single JSON contract for operators, distinct from **`/health`**:

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

**Security:** This endpoint must not leak secrets; it may be restricted to same trust boundary as other authenticated routes once auth lands.

### Backups and restore

**Planned official procedure** (to document and optionally automate):

- **SQLite:** Copy main DB file **and** `-wal` / `-shm` consistently (SQLite backup semantics per ops best practice; see [`DEPLOY.md`](./DEPLOY.md) for volume guidance).
- **Exports/artifacts:** Copy directories referenced by export and artifact configuration.

Include a **restore drill** in docs: verify file permissions, run migration state, spot-check OCR queue and package runs.

**Optional:** Safe snapshot CLI or authenticated operator route for coordinated SQLite + artifact copy (planned; not present as of this brief).

### Named runbooks (must exist in [`DEPLOY.md`](./DEPLOY.md) / operator docs)

1. First deploy  
2. Restart after failed migration  
3. Stale OCR worker / backlog rising  
4. Missing volume / wrong mount  
5. Disk full  
6. Restore from backup  
7. Rotate **`WC_API_KEY`** during auth transition (shared secret still in use today)

### Gap note

[`DEPLOY.md`](./DEPLOY.md) explains pieces, but a **single checklist** and **readiness contract** matching the gates above must stay aligned with code as it ships. [`ops-routes.ts`](../apps/api/src/routes/ops-routes.ts) is useful but **shallow** for “internal default product” until `/api/ops/readiness` and startup validation exist.

---

## Auth and principal migration

### Current truth (implemented)

- **Browser → API:** Shared bearer from `VITE_WC_API_KEY` in [`apps/desktop/src/config.ts`](../apps/desktop/src/config.ts), sent as `Authorization: Bearer …` via [`api-client.ts`](../apps/desktop/src/lib/api-client.ts).
- **API trust:** Server validates `WC_API_KEY` ([`server.ts`](../apps/api/src/server.ts)); this is a **single shared secret**, not per-user identity.
- **Approval attribution:** Package run approve reads optional header **`x-wc-actor`** and passes string to `approvePackageRun` ([`package-workbench-routes.ts`](../apps/api/src/routes/package-workbench-routes.ts) lines 485–490). The desktop client does not establish a verified principal for this path today.

### Target architecture (planned)

**Default hosted browser authentication:** **HTTP-only session cookie** issued by the API after login (same site / CSRF-safe patterns). **JWT** may exist later for alternate clients; it is **not** the default browser contract in this brief.

Introduce **`request.user`** (or equivalent Fastify-typed principal) on authenticated requests.

### Schema and data model (planned)

| Construct | Purpose |
| --- | --- |
| `users` | Human principals |
| Roles | At minimum: `operator`, `reviewer`, `approver`, `admin` (exact storage: enum column vs join table — implementer choice, but roles must be enforceable) |
| `case_memberships` (or equivalent) | Case-scoped read/write/run/approve |
| Actor columns | `created_by`, `updated_by`, `approved_by`, optional `acted_as_role` on state-changing records |

**Rule:** Approvals are **not** considered meaningful for governance until tied to **authenticated** user ids, not unverified headers.

### Migration sequence (locked)

| Phase | Content |
| --- | --- |
| **A** | Principal middleware; session login; keep **`WC_API_KEY`** / browser bearer only as **break-glass** or dev fallback. Stop preferring `x-wc-actor` when `request.user` exists. |
| **B** | Actor stamping on all state-changing writes (approvals, package rules, uploads, connector actions, templates, exports). |
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
| **1** | Hosted readiness: startup validation, **`GET /api/ops/readiness`**, backup/restore procedure, runbooks — implement HST items through backlog. |
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
