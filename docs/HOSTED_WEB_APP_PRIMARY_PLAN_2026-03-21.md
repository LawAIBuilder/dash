# Hosted Web App Primary Plan - 2026-03-21

## Purpose

This doc answers a practical product-mode question:

- Should `wc-legal-prep` keep behaving like a developer-run local stack?
- Should it become a hosted web app first?
- Should it become a packaged local desktop launcher first?

The current recommendation is:

1. Treat the product as a hosted web app first.
2. Keep local two-process startup as a developer/operator mode only.
3. Do not make a packaged local desktop launcher the primary simplification path right now.

This plan is grounded in the current repo, not a hypothetical rebuild.

## Related Docs

- **[Foundation execution brief](./FOUNDATION_EXECUTION_BRIEF_2026-03-21.md)** — Authoritative implementation packet: hosted readiness contract, auth migration, blueprint model, matter operating console, legacy AI freeze, ordered waves (for implementers; freezes debate).
- **[Hosted internal Phase 1 backlog](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md)** — HST-01 through HST-17 ticket queue.
- **[Mailroom vision (canonical)](./MAILROOM_VISION_AND_SOURCES_2026-03-21.md)** — Mailroom is later orchestrated intake, not the current foundation wave.

## Current Reality

Today the stack is already a web app in technical shape:

- browser client: [apps/desktop](../apps/desktop)
- API server: [apps/api/src/server.ts](../apps/api/src/server.ts)
- OCR worker: [apps/api/src/ocr-worker-service.ts](../apps/api/src/ocr-worker-service.ts)
- shared SQLite runtime: [apps/api/src/db.ts](../apps/api/src/db.ts)
- hosted supervisor path: [apps/api/src/start-railway.ts](../apps/api/src/start-railway.ts)

What feels “desktop” today is really just the local development workflow:

- one terminal for the API
- one terminal for the desktop Vite app
- optional OCR worker terminal

That is a developer/operator experience, not the end-user product shape.

## Decision

### Recommended call

Commit to a hosted web app as the primary operating mode now.

More precisely:

- the **primary user experience** should be “open a URL and use the product”
- the **local terminal workflow** should remain only for development, debugging, and fallback operations
- a **packaged local launcher** can stay on the backlog as an optional later distribution mode, not the main bet

### Why this is the right call

The codebase already aligns to hosted web better than to packaged local desktop:

1. The UI is already a browser SPA.
2. The API and OCR worker are already separable processes.
3. Railway-style hosted startup already exists.
4. Static hosting for the UI is a much smaller step than shipping an Electron-style launcher with embedded API, worker, SQLite path management, updates, logs, and backup behavior.

## Is There A Compelling Reason Not To Commit Now?

Not for the internal product mode.

There **is** a compelling reason not to commit to a **public multi-tenant SaaS** right now:

- real user auth/authorization is still incomplete
- private matter data still relies on a shared API-key model
- governance/retention/legal-hold work is not done
- the source capability matrix is still not fully productized

But those are reasons to avoid pretending the current build is a broad hosted SaaS. They are **not** reasons to avoid making the product operate as a hosted internal web app.

So the right call is:

- **yes** to hosted internal web app now
- **no** to “ship a fully general multi-user internet product right now”
- **no** to spending the next phase on a packaged desktop launcher first

## Why Not Make A Packaged Local Desktop Launcher The Main Path?

A sealed local launcher sounds simpler from the outside, but for this repo it is the more complicated first simplification.

It would still need to solve:

- bundling the browser shell or Electron shell
- spawning and supervising the API
- spawning and supervising the OCR worker
- locating and protecting the SQLite file
- placing exports on disk
- local secret management for Box / OpenAI / PracticePanther
- app updates
- crash recovery
- log collection
- backups and restore
- per-machine support

A hosted web app centralizes almost all of that operational burden once instead of redistributing it to every user machine.

## What “Hosted Web App” Means In This Repo

Phase-1 hosted web app does **not** mean “rewrite everything.”

It means:

- static build of [apps/desktop](../apps/desktop) hosted behind HTTPS
- API + OCR worker hosted together in a controlled environment
- one shared SQLite file on a persistent volume
- one controlled env/secret set
- one backup and restore story
- one URL for end users

That preserves the current hardening work instead of replacing it.

## Recommended Product Modes

### Mode 1: Primary

Hosted internal web app.

Who it is for:

- daily operator use
- internal hearing/demand/`239` work
- real matters that should not depend on local terminal startup

### Mode 2: Secondary

Local development stack.

Who it is for:

- engineering
- debugging
- schema/runtime investigation
- emergency fallback

### Mode 3: Deferred

Packaged local launcher / sealed desktop shell.

Who it is for:

- future “single-click local app” distribution if it becomes strategically necessary
- offline or semi-offline operator environments

This should stay deferred until the hosted product contract is stable.

## What Is Left To Do Before Hosted Web Becomes The Default

The work is real, but it is not a rewrite.

## Phase 0 - Lock The Decision And Clean The Language

Goal: stop talking about the product as if it were primarily a terminal-launched desktop app.

1. Make “hosted web app primary, local dev secondary” the explicit product-mode decision in docs.
2. Treat `apps/desktop` as the browser client/workbench, not as evidence that the product must stay local.
3. Keep the Desktop package artifacts as the spec/golden set; that strategy does not change.

Deliverables:

- this plan doc
- deploy/runbook docs linked from [DEPLOY.md](./DEPLOY.md)
- roadmap language aligned around hosted internal use

## Phase 1 - Make Hosted Internal Web The Supported Operating Mode

Goal: a non-developer opens a URL and uses the app; operators deploy and maintain one environment.

### 1. Build and deploy path

Required:

- `npm run build` remains the canonical build
- API deploy must produce:
  - `apps/api/dist/server.js`
  - `apps/api/dist/start-railway.js`
  - `apps/api/dist/ocr-worker-service.js`
- desktop deploy must produce:
  - `apps/desktop/dist`

### 2. Runtime topology

Required:

- static host for the browser client
- one API process
- one OCR worker process
- one shared SQLite file on a persistent volume
- absolute `WC_SQLITE_PATH` in hosted environments

Use the current in-repo hosted path:

- [start-railway.ts](../apps/api/src/start-railway.ts)
- [DEPLOY.md](./DEPLOY.md)

### 3. Required production env contract

Required:

- `NODE_ENV=production`
- `WC_API_HOST=0.0.0.0`
- `PORT`
- `WC_SQLITE_PATH` as an absolute mounted-volume path
- `WC_CORS_ORIGIN`
- `WC_TRUST_PROXY=true` when behind a proxy
- `WC_API_KEY`
- `OPENAI_API_KEY` if AI features are expected
- Box JWT env if Box sync/OCR/export is expected
- `WC_SOURCE_CONNECTION_SECRET` for connector metadata protection
- `WC_EXPORT_DIR` if local DOCX export paths are used
- `WC_ENABLE_DEV_ROUTES=0` or unset

### 4. Static client configuration

Required:

- `VITE_API_BASE_URL`
- `VITE_WC_API_KEY` only if still using the current shared-bearer auth model

Important:

- browser `VITE_*` values are not secrets
- this is acceptable only for trusted internal use while real auth is still pending

### 5. Operator runbooks

Required:

- deploy checklist
- restart checklist
- “API up, worker down” checklist
- backup and restore checklist
- “OpenAI failing” checklist
- “Box auth broken” checklist

### 6. Hosted-web stop line

Hosted internal web is ready to become the default mode when:

- one operator can deploy/update it without local shell guesswork
- one end user can use it entirely through a URL
- OCR work continues without a separate human babysitting terminal
- backups and restore are documented and tested

## Phase 2 - Close The Biggest Gaps That Matter More Once You Host It

Goal: move from “hosted internal tool” to “trusted internal system.”

### 1. Real auth and authorization

This is the biggest remaining architectural gap.

Today:

- auth is still effectively a shared API key for the browser client

Need:

- real user identity
- server-side authorization by matter/project/org
- approval/export attribution tied to authenticated principals

This does **not** require abandoning the hosted-web decision. It becomes easier once there is one hosted runtime to secure.

### 2. Secret and token handling

Need:

- strong production handling for Box and PracticePanther secrets
- clear backup/export limits on encrypted connector metadata
- documented rotation procedure

### 3. Source capability matrix

Need a single explicit product policy for:

- upload
- Box file
- PracticePanther context
- preview
- OCR
- package worker
- DOCX export
- packet PDF export

The audits already established this as a real product boundary.

### 4. Operator controls

Need:

- visible stuck-job handling
- rerun history
- OCR/sync failure inspection
- quota visibility
- export failure visibility

### 5. Governance and data lifecycle

Need:

- retention rules
- export cleanup rules
- legal-hold posture
- backup schedule
- restore drill

## Phase 3 - Decide The Long-Term Data/Auth Spine

Goal: decide whether SQLite-on-volume remains the internal operating spine for the near term, or whether auth/project/workflow state moves onto a stronger hosted platform.

This is where the archived broader plans matter.

You have two realistic choices:

### Option A: Keep hosted SQLite longer

Use when:

- you are still single-tenant or near-single-tenant
- one hosted environment is enough
- you want minimum migration risk now

Pros:

- smallest delta from current repo
- preserves the hardening work
- fastest route to a working hosted internal product

Cons:

- weaker long-term multi-user/auth story
- more operational discipline required around the SQLite file

### Option B: Introduce a stronger hosted platform spine

Use when:

- real user auth and access control become central
- you want firmer multi-user/project boundaries
- you want a cleaner long-term hosted platform story

Pros:

- better path for real authz and richer operator controls
- better long-term separation between platform data and runner state

Cons:

- materially larger migration/program
- higher risk if attempted before the hosted web mode and runner boundaries are stable

Recommended call:

- do **not** block hosted web on this larger data-platform decision
- make hosted web with the current runtime the first move
- then decide the longer-term spine once real auth and internal usage pressure justify it

## Phase 4 - Intelligence Buildout On The Hosted Product

This does not change because of the hosted/web decision.

The preserved strategic order still stands:

1. stable ingestion
2. OCR and extraction quality
3. case/event schema
4. runner contracts and golden fixtures
5. golden-example retrieval
6. historical indexing
7. template mining
8. similar-case support
9. vector only if justified
10. fine-tuning only if justified

See:

- [INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md](./INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md)
- [INTELLIGENCE_BUILD_BACKLOG_2026-03-21.md](./INTELLIGENCE_BUILD_BACKLOG_2026-03-21.md)

## What Else Is Left To Do, In Plain English

If you commit to hosted web now, the remaining work is mostly:

1. deployment/runbook clarity
2. hosted env discipline
3. real auth/authorization
4. operator controls
5. source capability policy
6. governance/retention

It is **not**:

- rewrite the UI
- replace the browser client
- abandon the Desktop package strategy
- build Electron first
- jump to Postgres immediately just to feel “more real”

## Recommended Immediate Plan

### Next 30 days

1. Treat hosted internal web as the primary product mode in docs and roadmap.
2. Use [DEPLOY.md](./DEPLOY.md) **Phase 1 — Hosted internal web: execution checklist** (env matrix, build, smoke, backups) and ticket backlog [HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md).
3. Keep local terminal startup documented only as development/operator mode ([LOCAL_DEV.md](./LOCAL_DEV.md)).
4. Make one actual hosted environment the reference environment and use it (backlog **HST-01**).

### Next 60 days

1. Implement real auth/authorization direction.
2. Finish the source capability matrix and align UI/API behavior.
3. Add minimal operator/admin visibility for sync/OCR/export failures.
4. Harden backup/restore and quota visibility.

### After that

1. Decide whether SQLite remains acceptable for the next stage or whether a larger platform-spine migration is justified.
2. Keep intelligence work tied to the runner/workbench roadmap, not to generic ML ambition.

## Bottom Line

Yes: commit to the hosted web app as the primary product mode now.

No: do not spend the next phase turning this into a packaged local desktop launcher.

The hosted-web move is the smaller, cleaner, more reversible step for this repo.

The biggest remaining work after that is not UI technology. It is:

- auth
- operator trust
- source-policy clarity
- governance
- long-term platform spine decisions
