# Foundation Execution Brief - 2026-03-21

This brief is the **authoritative execution packet** for the next implementation waves in `wc-legal-prep`. It is written for implementers. It is not another strategy brainstorm.

Current repo truth: the product is already a **browser SPA + Fastify API + OCR worker + SQLite** internal legal workbench, with the browser in [apps/desktop](../apps/desktop), the API in [apps/api/src/server.ts](../apps/api/src/server.ts), the OCR worker in [apps/api/src/ocr-worker-service.ts](../apps/api/src/ocr-worker-service.ts), the shared runtime in [apps/api/src/db.ts](../apps/api/src/db.ts), and the hosted supervisor path in [apps/api/src/start-railway.ts](../apps/api/src/start-railway.ts).

## 1. Executive decision freeze

The following decisions are settled for the next implementation waves:

- `wc-legal-prep` remains the foundation repo.
- Hosted internal web remains the primary product mode, as established in [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md).
- Root `npm run start:railway` from [package.json](../package.json) is the blessed hosted server entrypoint.
- The package worker path is the canonical execution engine for new product work, grounded in [apps/api/src/routes/package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts) and [apps/api/src/ai-service.ts](../apps/api/src/ai-service.ts).
- Desktop packages remain the product contract and golden/reference set, as stated in [package-studio/README.md](./package-studio/README.md).
- Mailroom remains a later orchestrated intake wave, not the current product center, as documented in [MAILROOM_VISION_AND_SOURCES_2026-03-21.md](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md).
- SQLite on a persistent volume remains acceptable for Phase 1 unless runtime evidence proves otherwise.
- Electron, packaged local launcher work, public multi-tenant SaaS, Postgres-first migration, and vector-first retrieval are out of scope for this brief.

Implementation rule:

- From this point forward, execution planning should optimize for **one canonical hosted path, one canonical auth model, one canonical package definition model, and one canonical execution engine**.

## 2. Hosted readiness contract

### Current grounding

- Hosted server supervisor path already exists in [apps/api/src/start-railway.ts](../apps/api/src/start-railway.ts).
- Root hosted entrypoint already exists as `start:railway` in [package.json](../package.json).
- Shared SQLite runtime and migration application already exist in [apps/api/src/db.ts](../apps/api/src/db.ts).
- Current health routes exist in [apps/api/src/routes/ops-routes.ts](../apps/api/src/routes/ops-routes.ts).
- Current hosted guidance exists in [DEPLOY.md](./DEPLOY.md), but it is not yet a complete hosted-production readiness contract.

### Official hosted runtime

- The official hosted server runtime is **root `npm run start:railway`**, which runs `apps/api/dist/start-railway.js`.
- That supervisor remains responsible for launching and supervising:
  - `apps/api/dist/server.js`
  - `apps/api/dist/ocr-worker-service.js`
- The browser remains separately built from `apps/desktop/dist` and hosted as the client surface for the same environment.

### Must-pass hosted readiness gates

Before an environment is considered hosted-ready, all of the following must be true:

- `npm run build` produces:
  - `apps/api/dist/server.js`
  - `apps/api/dist/ocr-worker-service.js`
  - `apps/api/dist/start-railway.js`
  - `apps/desktop/dist`
- `WC_API_HOST=0.0.0.0` is set in hosted environments.
- `PORT` is supplied by the platform or explicitly configured.
- `WC_SQLITE_PATH` points to a mounted persistent volume, not ephemeral disk.
- Export and artifact directories are on persistent storage if their outputs are expected to survive deploys.
- Required feature env vars are present before startup:
  - `WC_API_KEY` during the auth transition window only
  - `OPENAI_API_KEY` when package worker or AI assembly is expected
  - Box env when Box sync or Box-backed file work is expected
  - `WC_SOURCE_CONNECTION_SECRET` for connector metadata protection
- `WC_ENABLE_DEV_ROUTES` is unset or disabled in hosted environments.

### Startup validation to implement

Hosted startup should become fail-fast and explicit:

- Fail startup if the `WC_SQLITE_PATH` parent directory is missing or not writable.
- Fail startup if configured export/artifact directories are missing or not writable.
- Log the effective db path, export path, listen host, port, and whether the OCR worker is enabled.
- Run a startup self-check that verifies:
  - migrations applied successfully
  - db writeability
  - worker-heartbeat writeability
  - export-directory writeability

### Health and ops contract

Keep the current lightweight health surface:

- `GET /health` stays load-balancer-safe.
- `GET /api/workers/ocr/health` stays as the worker-specific operator check.

Add one new hosted readiness route:

- `GET /api/ops/readiness`

Its response contract should report:

- db path
- db writable yes/no
- export dir writable yes/no
- worker stale yes/no
- last migration id
- OpenAI configured yes/no
- Box configured yes/no
- startup recovery summary

This route is planned work. It does **not** exist yet in the repo.

### Backup, restore, and runbooks

Hosted operation is not considered complete until one official procedure is written and then followed for:

- SQLite database file
- `-wal`
- `-shm`
- export directories
- artifact directories

The hosted runbook set must include:

- first deploy
- restart after failed migration
- worker stale / OCR backlog rising
- disk full / volume mount missing
- restore from backup
- API-key rotation while shared-key fallback still exists

Implementation rule:

- Backup notes alone are not sufficient. The hosted docs must include a restore drill and expected recovery checks.

## 3. Auth and principal migration

### Current grounding

- Browser shared-key auth is wired in [apps/desktop/src/config.ts](../apps/desktop/src/config.ts) through `VITE_WC_API_KEY`.
- API bearer trust is enforced in [apps/api/src/server.ts](../apps/api/src/server.ts) through `WC_API_KEY`.
- Package approval attribution currently falls back to `x-wc-actor` in [apps/api/src/routes/package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts).
- Package run approval data already exists in `package_runs` in [apps/api/src/schema.ts](../apps/api/src/schema.ts) and [apps/api/src/ai-service.ts](../apps/api/src/ai-service.ts), but it is not yet tied to authenticated principals.

### Default hosted auth target

The default hosted browser auth path is:

- server-authenticated principal-based auth
- HTTP-only session-cookie auth for the browser

JWT may be supported later as a future-compatible transport, but it is not the default browser contract for this brief.

### Target model

Separate the following concerns explicitly:

- Authentication: who the user is
- Authorization: what the user can do
- Attribution: who performed each state-changing action

Planned interface and schema additions:

- `request.user` principal on authenticated API requests
- `users`
- `case_memberships` or an equivalent case-permission table
- actor fields such as `created_by`, `updated_by`, `approved_by`, and optional `acted_as_role`

### Migration sequence

#### Phase A: principal plumbing

- Introduce auth middleware that resolves `request.user`.
- Keep `WC_API_KEY` only as break-glass or dev fallback while browser auth is migrated.
- Prefer authenticated principal identity over `x-wc-actor` whenever a principal exists.

#### Phase B: actor stamping

Stamp authenticated actor data on state-changing actions, including:

- package approvals
- package rule changes
- event-config changes while legacy path still exists
- uploads
- connector actions
- template edits
- export and publish actions

#### Phase C: permissions

Add route guards for:

- case read
- case write
- package run
- package approve
- connector manage
- ops and admin routes

#### Phase D: remove shared browser key as normal auth

- Remove `VITE_WC_API_KEY` from normal hosted browser usage.
- Retain `WC_API_KEY` only for break-glass or machine-to-machine use if still necessary.

Implementation rule:

- Approval is not considered meaningful until approval-bearing records are tied to authenticated principals rather than shared bearer access plus ad hoc headers.

## 4. Blueprint canonicalization

### Current grounding

The package/playbook system is already real, but split across multiple constructs:

- `product_presets`
- `product_rulepacks`
- `product_workflows`
- `approval_gates`
- `artifact_templates`
- `branch_templates`
- `branch_transitions`
- `branch_stage_requirements`
- `branch_sla_targets`
- `package_rules`
- prompt logic in [apps/api/src/ai-service.ts](../apps/api/src/ai-service.ts)
- retrieval assembly in [apps/api/src/retrieval.ts](../apps/api/src/retrieval.ts)

This is enough machinery to behave like blueprint definitions already. What is missing is canonical ownership, versioning, and inspectability.

### Canonical model

Introduce **Blueprint** as the top-level package/playbook abstraction.

Two core concepts are required:

- `blueprints`: package family anchors
- `blueprint_versions`: the versioned execution contract actually used by runs

Each blueprint version should own the package definition for:

- package type
- version
- status
- execution engine
- default model
- output contract
- retrieval profile
- prompt contract
- provenance policy
- evaluation policy

### Mapping from current structures

Canonical mapping rule:

- `product_presets` -> blueprint family anchor
- `product_rulepacks` -> blueprint default rules
- `product_workflows` -> blueprint stage contract
- `approval_gates` -> blueprint approval policy
- `artifact_templates` -> blueprint artifact contract
- `package_rules` -> case-level overrides against a blueprint version
- prompt branches in `ai-service.ts` -> blueprint prompt contract
- retrieval behavior in `retrieval.ts` -> blueprint retrieval profile
- `package_runs` -> execution history of blueprint versions

### Migration rule

Do not rewrite the current machinery all at once.

The first migration is about:

- canonical ownership
- versioning
- inspection
- binding package runs to blueprint versions

It is **not** about destructive table replacement in the first round.

### Initial canonicalization scope

Only the following package types are in scope for the first blueprint-backed wave:

- hearing prep
- claim petition
- discovery response

Expansion should pause until the model holds for those three.

## 5. Matter operating console

### Current grounding

- The current matter overview already surfaces projection-backed case summary, proof requirements, source health, and activity in [apps/desktop/src/pages/cases/CaseOverviewPage.tsx](../apps/desktop/src/pages/cases/CaseOverviewPage.tsx).
- The projection and branch/workflow model already exist in [apps/api/src/projection.ts](../apps/api/src/projection.ts), [apps/api/src/runtime.ts](../apps/api/src/runtime.ts), and [apps/api/src/schema.ts](../apps/api/src/schema.ts).
- Mailroom remains explicitly later-stage orchestration in [MAILROOM_VISION_AND_SOURCES_2026-03-21.md](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md).

### Direction freeze

- The UI direction is **matter-centric**, not mailroom-centric.
- The current case overview path should evolve into the primary matter operating console.
- This brief does **not** authorize building a separate co-equal mailroom product center.

### The console must answer five questions

- Where is this matter now?
- What is blocked?
- What is missing?
- What should happen next?
- What is awaiting review or approval?

### Primary console layout

The primary matter operating console should be organized into six panels:

- matter header
- next actions rail
- roadmap / stage progression
- evidence and document readiness
- package execution panel
- activity and audit panel

### Panel intent

- Matter header: matter identity, active branch, current stage, major deadlines, source health, owner/reviewer/approver, readiness state.
- Next actions rail: missing proof, stale source sync, OCR backlog, pending approval, export pending, recommended next package.
- Roadmap / stage progression: active branch, completed stages, current stage, blockers, age in stage, transition conditions.
- Evidence and document readiness: proof gaps, key documents present or missing, exhibit status, OCR or extraction confidence issues.
- Package execution panel: available package definitions, most recent run, approval state, exports, rerun and revise controls, provenance warnings.
- Activity and audit panel: uploads, sync events, branch events, approvals, exports, and operator actions.

Implementation rule:

- When mailroom exists later, it should feed this matter operating console rather than compete with it as a separate primary center of gravity.

## 6. Legacy AI freeze and deprecation

### Current grounding

Legacy event-config AI remains present in:

- `ai_event_configs`
- `ai_jobs`
- `runAIAssemblyJob` in [apps/api/src/ai-service.ts](../apps/api/src/ai-service.ts)
- event-config routes in [apps/api/src/routes/package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts)
- the legacy UI in [apps/desktop/src/pages/cases/CaseAIPage.tsx](../apps/desktop/src/pages/cases/CaseAIPage.tsx)

The canonical candidate is already present in:

- `runPackageWorker` in [apps/api/src/ai-service.ts](../apps/api/src/ai-service.ts)
- package workbench routes in [apps/api/src/routes/package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts)
- `package_runs`
- approvals
- exports
- retrieval bundle discipline

### Decision freeze

- The package worker path is the canonical execution engine for new product work.
- Legacy event-config AI is compatibility debt, not the future authoring model.

### Deprecation sequence

#### Stage 1: feature freeze legacy path

- No new event types.
- No new UX investment.
- No new prompt sophistication in `runAIAssemblyJob`.
- Only bug fixes.

#### Stage 2: relabel legacy UI and docs

- Mark legacy event-config AI as legacy or compatibility-only.
- Make package worker language the forward-looking path in UI and docs.

#### Stage 3: parity migration

- Create blueprint-backed equivalents for the active legacy use cases that still matter operationally.

#### Stage 4: route restriction

- Disable creation of new `ai_event_configs`.
- Keep read-only visibility for history.
- Allow rerun only where unavoidable during the transition.

#### Stage 5: retirement

- Remove legacy authoring from the main UI.
- Remove legacy creation routes from the primary API surface once replacements exist.
- Preserve historical records for audit and analysis.

Implementation rule:

- Migrate forward behavior first. Do not try to migrate historical records before stopping new legacy authoring.

## 7. Ordered execution waves

Wave order for the next implementation rounds is:

1. Hosted readiness contract
2. Auth and principal plumbing
3. Blueprint canonicalization for hearing prep, claim petition, and discovery response
4. Matter operating console
5. Legacy event-config freeze and deprecation
6. Mailroom later as orchestrated intake

Wave details:

- Wave 1: harden hosted runtime, readiness checks, backup and restore, and operator runbooks.
- Wave 2: land principal-based auth, actor attribution, and route permissions.
- Wave 3: bind the canonical package definitions to blueprint versions and package runs.
- Wave 4: elevate the case overview into the primary matter operating console using the now-stable workflow and package contracts.
- Wave 5: freeze legacy event-config authoring and complete the package-worker cutover for new work.
- Wave 6: treat mailroom as governed intake that feeds branches, packages, deadlines, and next-action recommendations.

Cross-wave rule:

- Keep one canonical hosted path, one canonical auth model, one canonical blueprint model, and one canonical package execution engine. Do not reopen those debates unless the repo materially contradicts them later.
