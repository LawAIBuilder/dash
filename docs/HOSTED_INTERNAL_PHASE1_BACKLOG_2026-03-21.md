# Hosted internal web — Phase 1 backlog (tickets)

**Date:** 2026-03-21  
**Parent:** [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md)  
**Execution checklist:** [DEPLOY.md — Phase 1](./DEPLOY.md#phase-1-hosted-internal-web-execution-checklist)

This file turns “Phase 1 hosted internal web” into **trackable work**. IDs are stable for copy-paste into GitHub/Linear.

---

## Ops / deploy

| ID | Title | Acceptance |
|----|--------|------------|
| **HST-01** | **Reference environment** | One named hosted environment (e.g. `internal-prod`) is documented: API base URL, app URL, who owns DNS/TLS, where secrets live. |
| **HST-02** | **Build pipeline** | `npm ci` + `npm run build` at repo root is the canonical production build; CI runs it on `main` (or release branch). |
| **HST-03** | **API start command** | Host runs `npm run start:railway` (or equivalent) so API + OCR worker both start; documented in operator runbook. |
| **HST-04** | **Persistent volume + SQLite path** | `WC_SQLITE_PATH` is absolute, on a mounted volume; documented path; survives redeploy. |
| **HST-05** | **Secrets hygiene** | `WC_API_KEY`, `OPENAI_API_KEY`, Box JWT, and other secrets exist only in platform secret store—not in repo, not in static client except known `VITE_*` limitations. |
| **HST-06** | **CORS + HTTPS** | `WC_CORS_ORIGIN` lists exact static-app origin(s); API and app are both HTTPS; smoke test passes. |

## Static client

| ID | Title | Acceptance |
|----|--------|------------|
| **HST-07** | **Production Vite env** | Documented process for `VITE_API_BASE_URL` (and `VITE_WC_API_KEY` if used) for production builds; rebuild doc when API URL changes. |
| **HST-08** | **Static hosting** | `apps/desktop/dist` deployed to chosen static host; custom domain or platform URL documented. |

## Verification

| ID | Title | Acceptance |
|----|--------|------------|
| **HST-09** | **Post-deploy smoke** | `/health` OK; app loads; at least one authenticated API call succeeds from browser. |
| **HST-10** | **OCR path** | Queue OCR on a test matter; worker drains without manual second terminal (supervisor running). |

## Backup / governance (minimum)

| ID | Title | Acceptance |
|----|--------|------------|
| **HST-11** | **Backup procedure** | Written steps: what is copied, how often, where stored; includes `-wal`/`-shm` awareness or quiesce note. |
| **HST-12** | **Restore drill** | One successful restore test to a non-prod or staging clone; documented. |

## Runbooks (operator checklists)

| ID | Title | Acceptance |
|----|--------|------------|
| **HST-13** | **Deploy / update** | Short checklist: pull/build, env diff, migrate, restart, smoke. |
| **HST-14** | **Restart** | What to restart when API is wedged vs worker only vs full service. |
| **HST-15** | **API up, worker down** | Symptoms, logs to check, restart worker path. |

## Product / policy (hosted gaps from primary plan)

| ID | Title | Acceptance |
|----|--------|------------|
| **HST-16** | **Source capability matrix** | Single doc: upload vs Box vs PP for preview, OCR, export, assembly—aligned with [INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md](./INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md) and audit docs. |
| **HST-17** | **Shared-key risk documented** | Operators acknowledge `VITE_WC_API_KEY` is public; path to real auth tracked as Phase 2. |

---

## Explicitly out of scope for Phase 1

- Multi-tenant public SaaS
- Packaged Electron/local launcher as primary
- PostgreSQL migration
- Full user auth / RBAC (Phase 2 in [HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md))

---

## Suggested order

1. HST-02 → HST-03 → HST-04 → HST-05 → HST-06 (infra spine)  
2. HST-07 → HST-08 (client)  
3. HST-09 → HST-10 (verify)  
4. HST-11 → HST-12 (durability)  
5. HST-13–HST-15 (runbooks)  
6. HST-01, HST-16, HST-17 (documentation and risk)
