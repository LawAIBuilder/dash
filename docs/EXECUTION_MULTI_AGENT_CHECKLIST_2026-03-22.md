# Execution Multi-Agent Checklist - 2026-03-22

This document is the detailed execution checklist companion to [FOUNDATION_EXECUTION_BRIEF_2026-03-21.md](./FOUNDATION_EXECUTION_BRIEF_2026-03-21.md).

Use it when multiple agents or sessions are contributing in parallel. The foundation brief remains the architecture anchor. This checklist turns that architecture into wave-by-wave execution work, handoff rules, and exit gates.

## Current Position

- Wave 1 is mostly implemented: readiness, startup validation, backup snapshots, and operator runbooks are real in [DEPLOY.md](./DEPLOY.md), [readiness.ts](../apps/api/src/readiness.ts), and [backup.ts](../apps/api/src/backup.ts).
- Wave 1 is not fully proven until hosted-style restore evidence, named ownership, and HST reconciliation are recorded in repo docs.
- Wave 2 is materially implemented: session auth, `request.user`, `case_memberships`, and route-family gating now cover case catalog, case-data, workbench, connectors, exhibits, and document templates.
- Exhibit routes are already membership-gated on `main`; treat any “exhibit bypass” concern as closed unless a specific handler and commit are cited.
- Wave 2 trust-boundary closure is now in place for the registered case-route families; the remaining Wave 2 cleanup is to keep actor stamping broad enough for meaningful auditability and keep hosted browser auth session-first by default.
- CI already enforces build, test, and typecheck on push and PR in [ci.yml](../.github/workflows/ci.yml). The remaining gaps are operational proof and trust-boundary closure, not missing automation.
- The current case-route audit surface is finite: [server.ts](../apps/api/src/server.ts) registers the route families that matter for Wave 2 closure.
- The old Cursor roadmap and [ROADMAP.md](./ROADMAP.md) are stale for sequencing. Use the foundation brief, [DEPLOY.md](./DEPLOY.md), and [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md).
- The first blueprint runtime round is limited to `hearing_packet`, `claim_petition`, and `discovery_response`. Demand and `239` remain important spec/golden references but are not first-round runtime package-worker targets.

## Non-Negotiable Rules

- Do not start Wave 3 until Wave 2 is actually closed.
- Do not reopen hosted-internal-web-first, SQLite-on-volume, package-worker-first, or mailroom-later without new repo or runtime evidence.
- Do not turn blueprint work into a rewrite or CMS before the runtime model exists.
- Do not let intelligence work ship ahead of trust-boundary closure.
- Treat package-studio specs and goldens as the contract surface, not decorative docs.

## Wave 1 Closeout

- Run a hosted-style non-prod restore drill, not only a local restore.
- Record environment name, snapshot identifier, restore steps, and validation result in [DEPLOY.md](./DEPLOY.md).
- Reconcile HST-01 through HST-17 in [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md) as done, waived, or N/A.
- Close HST-01 with named owners for platform, DNS/TLS, secrets, backups, and restore authority.
- Close HST-12 with recorded hosted-style restore evidence.
- Close HST-16 with a concrete source capability matrix.
- The source capability matrix must say, per source type, whether it may drive preview, OCR, retrieval, exhibit inclusion, package assembly, DOCX export, packet PDF export, and historical recommendations.
- Define snapshot retention policy: location, count, deletion owner, and disk-pressure handling.
- Add or verify a disk-full/quota runbook section.
- Verify operator smoke checks for `/health`, `/api/workers/ocr/health`, `/api/ops/readiness`, and `/api/ops/backups/snapshot`.
- Document that `/api/workers/ocr/health`, `/api/ops/readiness`, and `/api/ops/backups/snapshot` require bearer auth when `WC_API_KEY` is set.

### Wave 1 Exit Gate

- Hosted-style restore evidence exists in repo docs.
- HST backlog is reconciled against current reality.
- Backup ownership and retention are explicit.
- The source capability matrix exists.
- Operators can recover from docs without source inspection.

## Wave 2

- Gate all remaining case-scoped routes behind the same trust boundary.
- Add dedicated auth tests for any newly gated route family.
- Audit all registered case-route families:
  - [case-catalog-routes.ts](../apps/api/src/routes/case-catalog-routes.ts)
  - [case-data-routes.ts](../apps/api/src/routes/case-data-routes.ts)
  - [document-template-routes.ts](../apps/api/src/routes/document-template-routes.ts)
  - [exhibit-routes.ts](../apps/api/src/routes/exhibit-routes.ts)
  - [package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts)
  - case-scoped actions in [connectors-routes.ts](../apps/api/src/routes/connectors-routes.ts)
- Record an audit table of route family, session rule, admin override, API-key behavior, open-dev behavior, and any intentional public or dev-only exceptions.
- Extend the existing rule matrix rather than inventing a fresh RBAC system:
  - membership for case-scoped reads
  - operator+ for ordinary case writes
  - reviewer/approver/admin for approvals
  - admin-only for tenant-wide connector setup
- Expand actor stamping using the existing `*_by` and `*_by_user_id` pattern.
- Stamp document templates and fills.
- Stamp uploads in their actual route path.
- Stamp connector actions, case edits, and exports where they materially affect auditability.
- Add rate limiting or backoff to `POST /api/auth/login`.
- Remove `VITE_WC_API_KEY` from normal hosted browser use.
- Keep server `WC_API_KEY` only for M2M or break-glass if still needed.
- Make hosted browser flow rely on `credentials: "include"` and session cookies by default.
- Add a clear browser misconfiguration path when session auth is expected but the API returns 401.
- Make stale bookmarks and unauthorized deep links fail clearly in the UI.
- Update [DEPLOY.md](./DEPLOY.md), [LOCAL_DEV.md](./LOCAL_DEV.md), and [FOUNDATION_EXECUTION_BRIEF_2026-03-21.md](./FOUNDATION_EXECUTION_BRIEF_2026-03-21.md) in the same PR when repo truth changes.

### Recorded route audit - 2026-03-22

| Route family | Session-user rule | Admin override | API key | Open dev |
| --- | --- | --- | --- | --- |
| `case-catalog-routes.ts` | Catalog filtered by `case_memberships`; `GET/PATCH /api/cases/:caseId` require membership | Yes | Transitional bypass remains | Open when neither auth mode is configured |
| `case-data-routes.ts` | Case membership required for the registered case data endpoints | Yes | Transitional bypass remains | Open when neither auth mode is configured |
| `package-workbench-routes.ts` | Case membership required; package approval additionally requires reviewer/approver/admin for session users | Yes | Transitional bypass remains; approval requires explicit `x-wc-actor` | Open when neither auth mode is configured |
| `document-template-routes.ts` | Case membership required; mutating template/fill routes require a write actor | Yes | Transitional bypass remains; writes require explicit `x-wc-actor` | Open when neither auth mode is configured |
| `exhibit-routes.ts` | Case membership required for packet, preview, finalize, export, and exhibit-list routes | Yes | Transitional bypass remains | Open when neither auth mode is configured |
| Case-scoped connector routes in `connectors-routes.ts` | Case membership required for per-case sync/hydrate actions | Yes | Transitional bypass remains | Open when neither auth mode is configured |
| Tenant-level connector admin in `connectors-routes.ts` | Session users must be admin | N/A | Transitional bypass remains | Open when neither auth mode is configured |

Intentional exceptions:

- OAuth callback routes stay exempt by design.
- Dev-only routes such as `/dev/...` may still use `assertCaseExists` without the full session boundary.
- Ops/admin routes use auth mode and admin checks rather than `case_memberships`.

### Wave 2 Exit Gate

- Every case-scoped browser route is membership-gated, admin-gated, or explicitly dev/public.
- The route audit is recorded, with any intentional exceptions called out.
- Normal hosted browser use no longer depends on `VITE_WC_API_KEY`.
- High-signal writes are attributable to authenticated principals.

## Wave 3

- Add `blueprints` and `blueprint_versions` to [schema.ts](../apps/api/src/schema.ts).
- Ship data first, editor later.
- Add `blueprint_version_id` to `package_runs` as nullable first.
- Document backfill policy for historical runs.
- Document rollback path before migrating live environments.
- Bind exactly three runtime package types first:
  - `hearing_packet`
  - `claim_petition`
  - `discovery_response`
- Map current structures into the blueprint model:
  - `product_presets`
  - `product_rulepacks`
  - `product_workflows`
  - `approval_gates`
  - `artifact_templates`
  - `package_rules`
- Move prompt branches from [ai-service.ts](../apps/api/src/ai-service.ts) into blueprint prompt contracts.
- Move retrieval behavior from [retrieval.ts](../apps/api/src/retrieval.ts) into blueprint retrieval profiles.
- Keep `package_rules` as case-level overrides.
- Expose blueprint version in operator-visible run surfaces, not only the DB.
- Tie blueprint-backed package runs to package-studio goldens and assertion-based tests.

### Wave 3 Exit Gate

- `package_runs` can identify which blueprint version ran.
- The first three package types are blueprint-backed.
- Humans can inspect blueprint version from product surfaces.

## Wave 4

- Expand [CaseOverviewPage.tsx](../apps/desktop/src/pages/cases/CaseOverviewPage.tsx) into the six-panel operating console from the foundation brief.
- Make the overview answer:
  - where the matter is now
  - what is blocked
  - what is missing
  - what happens next
  - what needs review or approval
- Reuse existing projections and package/exhibit queries instead of inventing dashboard-only APIs.
- Surface branch/stage progression, blockers, SLA/age, and next transitions.
- Surface proof gaps and evidence readiness.
- Surface package run state, approval state, latest artifact/export, and provenance warnings.
- Surface activity and audit events in one place.
- Add next-action cards for stale sync, OCR backlog, missing proof, pending approval, export pending, and recommended package.
- Handle packet coherence explicitly when a matter has multiple packets or package types.
- Add minimal desktop automation once the overview grows beyond a thin shell.

### Wave 4 Exit Gate

- Overview is the real command center.
- A user can understand and operate the matter from the overview first.

## Wave 5

- Publish the source capability matrix if Wave 1 did not already close it.
- Finalize retention, governance, and audit/export expectations.
- Decide whether operator-only actions should eventually require admin-session auth even when `WC_API_KEY` exists.
- Mark [CaseAIPage.tsx](../apps/desktop/src/pages/cases/CaseAIPage.tsx) as clearly legacy in UI and docs.
- Freeze new feature work on `runAIAssemblyJob` in [ai-service.ts](../apps/api/src/ai-service.ts).
- Identify active legacy use cases that still matter.
- Ship package-worker parity for those use cases.
- Disable new `ai_event_configs` creation once parity exists.
- Keep legacy history visible for audit and comparison.
- Remove legacy creation from the primary UI and then from the normal API path once parity is proven.

### Wave 5 Exit Gate

- New product work uses `runPackageWorker`.
- Legacy AI is compatibility-only.
- Governance is explicit and documented.

## Cross-Wave Program: Intelligence

- This is a cross-wave program spanning Waves 3 through 5 and continuing after them.
- Overlap means non-blocking work such as goldens, contracts, and evals can proceed in parallel without delaying Wave 2 closure.
- Strengthen package-studio goldens from fixture existence to artifact-shape, coverage, and provenance assertions.
- Start the evaluation harness with `hearing_packet` first.
- Write the Phase 1 shared event/branch contract.
- Define and run a bounded historical-indexer pilot over approved historical matters.
- Keep the historical pilot filename/path/event-first and bounded.
- Write template-promotion rules for approved output to reusable template candidate.
- Define the retrieval/search boundary before any vector work.
- Expose historical recommendations only with humility-first language and provenance.
- Expand similar-case support only after event quality and template quality improve.
- Keep archive-scale corpus work spec-driven.
- Keep vector and fine-tuning deferred unless they solve a proven retrieval or output problem.

## Wave 6

- Start from repo-real hooks documented in [MAILROOM_VISION_AND_SOURCES_2026-03-21.md](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md):
  - Box incoming-mail folder metadata
  - PracticePanther email entities
  - direct uploads
- Do not start with IMAP/Graph/webhook sprawl.
- Build a triage queue before any top-level mailroom center.
- Add matter resolution with human confirmation.
- Add event creation from intake.
- Add reviewed deadline extraction with provenance.
- Add package recommendation from intake results.
- Feed triaged intake into the matter operating console.
- Keep mailroom subordinate to matter execution, not a co-equal app.

### Wave 6 Exit Gate

- Intake creates governed matter actions.
- Mailroom feeds the operating console cleanly.

## Multi-Agent Execution Protocol

- Use [FOUNDATION_EXECUTION_BRIEF_2026-03-21.md](./FOUNDATION_EXECUTION_BRIEF_2026-03-21.md) as the architecture anchor.
- Use [DEPLOY.md](./DEPLOY.md) as the operator/runbook anchor.
- Use [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md) as the hosted ticket anchor.
- Before each slice:
  - run `git status --short --branch`
  - run `git log --oneline -10`
  - read the relevant wave section
  - read the exact modules being changed
  - check whether docs already claim the work is implemented
- Each PR or session handoff must declare:
  - wave
  - vertical slice
  - non-goals
  - files touched
  - tests added or updated
  - docs updated
  - open risks
- Prefer one vertical slice per PR.
- After each substantial slice:
  - implement
  - test
  - update docs
  - update the foundation brief if repo truth changed
  - commit and push clean
- Do not use `.cursor/plans` or [ROADMAP.md](./ROADMAP.md) for sequencing unless they are explicitly reconciled.
- When the foundation brief changes, add a dated note or short changelog entry.

## Immediate Next Slice

- Close the remaining Wave 1 hosted-ops proof: execute and record a hosted-style non-prod restore drill, retention policy, and named owners if they are not already reconciled.
- If staying in auth/governance before Wave 3, expand actor stamping to the next highest-signal write surfaces such as uploads, connector actions, case edits, and exports.
- Only begin Wave 3 blueprint work after the session-first hosted path and current audit trail are considered good enough for internal trust.
