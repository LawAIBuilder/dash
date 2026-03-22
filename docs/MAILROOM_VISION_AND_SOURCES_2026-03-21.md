# Mailroom / mail-intake — canonical doc (vision + repo inventory, 2026-03-21)

**This is the single mailroom-related document for `wc-legal-prep`.** It merges **strategic sources** (plans, chats) with **facts on the ground** (code paths, Railway, correspondence plumbing). Older split docs pointed at the same topic; they redirect here to prevent drift.

## Purpose

This memo collects everything located in a **search pass** for a **mail-room style app or workflow**: inbound mail/document intake, triage, matter matching, and downstream package actions. It is a **documentation snapshot**, not a commitment to build.

## Related docs

- **[Foundation execution brief](./FOUNDATION_EXECUTION_BRIEF_2026-03-21.md)** — Mailroom is **later orchestrated intake**; hosted readiness, auth, blueprints, and operating console are sequenced ahead of mailroom in that brief.
- **[Hosted web app primary plan](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md)** — Product-mode decision (hosted internal web first).
- **[Hosted internal Phase 1 backlog](./HOSTED_INTERNAL_PHASE1_BACKLOG_2026-03-21.md)** — HST ticket queue for hosted delivery.

## How this was assembled

- **Repo:** full-text search over [`wc-legal-prep`](../) (`apps/`, `docs/`, config).
- **User home (machine):** `rg` over `/Users/danielswenson` with exclusions for `node_modules`, `.git`, `Library`, `.cursor` (large exports), plus spot checks of `Desktop/`, `Documents/`, `archive/`.
- **Cursor plans:** search under `~/.cursor/plans/*.md`.
- **Exported chats:** files in `~/Downloads/` that had already been identified in prior sessions (`11.md`, `22.md`, `333.md`, `44.md`).

### Search limitations (important)

- **Not a forensic audit of “the whole computer.”** Sandboxing, ignored paths, and size limits mean some directories may not have been fully indexed.
- **Railway:** only **one** `railway.json` was found under the home directory search: [`railway.json`](../railway.json) in **this repo**. No second Railway-deployed app with its own `railway.json` appeared on disk in that pass. If another app lives only on Railway’s dashboard, another machine, or a different account path, it would not appear here.
- **Other codebases:** no separate mailroom-specific repository turned up under `Desktop/`, `Documents/`, or `archive/` in the quick grep pass.

---

## 1. `wc-legal-prep` (this repo) — what exists today

### Implemented (partial / plumbing only)

| Area | What exists | What it is *not* |
| --- | --- | --- |
| **Box “incoming mail” folder** | Env `BOX_INCOMING_MAIL_FOLDER_ID` in [`.env.example`](../.env.example); parsed in [`apps/api/src/box-provider.ts`](../apps/api/src/box-provider.ts) as `incomingMailFolderId`; persisted on connector auth as `box_incoming_mail_folder_id` in connection metadata. | Not a mailroom workflow: no dedicated routes, no watcher, no triage UI, no automatic filing from that folder in application logic beyond config storage. |
| **PracticePanther “emails”** | [`fetchPracticePantherEmails`](../apps/api/src/pp-provider.ts) and sync path in [`connectors-routes.ts`](../apps/api/src/routes/connectors-routes.ts): PP emails are pulled as entities (`entity_type: "email"`) alongside contacts, notes, tasks, events. | Email sync into matter context, not inbound-firm-mail processing or mailroom triage. |
| **Uploads** | Matter uploads and `source_kind` flows elsewhere in the API (see audit docs). | User uploads ≠ automated mailroom pipeline. |

### Not implemented

- No **Mailroom** nav item or page in the desktop app (grep: no matches in `docs/` or `apps/desktop` for “Mailroom”).
- No **inbound email** receiver (IMAP/Graph webhook), **matter matching** engine, or **deadline extraction** product surface as described in planning chats.
- No **webhook**-driven ingest for mail in `apps/api` (search limited to obvious keywords).

**Conclusion for this repo:** the **vision** for mailroom appears in **strategy/planning** artifacts; the **code** today only has **hooks** (Box folder id, PP email entities) suitable for a future mailroom, not the feature itself.

### 1a. Railway and deploy (this repo only)

There is **no** separate “mail room” Railway service—only the WC Legal Prep API + OCR worker stack.

| Item | Purpose |
|------|---------|
| [`railway.json`](../railway.json) | Deploy: `startCommand` → `npm run start:railway`, restart policy. |
| [`package.json`](../package.json) `start:railway` | Runs [`apps/api/src/start-railway.ts`](../apps/api/src/start-railway.ts): API + OCR worker supervisor. |
| [`DEPLOY.md`](DEPLOY.md) | Hosted API + worker + SQLite volume; env vars. |

### 1b. Correspondence taxonomy, OCR, and UI (not a mailroom module)

These support **classification and filing**, not automated inbound-mail triage:

- **[`packages/wc-rules/src/index.ts`](../packages/wc-rules/src/index.ts)** — Multiple **correspondence** document types (attorney, insurer, employer, etc.) with `target_folder` under `correspondence/...` and filename alias patterns.
- **[`packages/domain-core`](../packages/domain-core/src/index.ts)** — `correspondence` slice category in projections.
- **[`OCR_NOTES.md`](OCR_NOTES.md)** — **MSG** (Outlook) is skipped (“Archive/email, not OCR-able”); PDF scans of mail behave like any PDF.
- **[`CaseAIPage`](../apps/desktop/src/pages/cases/CaseAIPage.tsx)** — Copy can exclude “correspondence or internal memos” from some AI prompts (language only).

### 1c. Quick inventory matrix (same conclusion as §1)

| Concept | In repo today? | Notes |
|--------|-----------------|--------|
| Dedicated Railway “mail app” | **No** | Only one `railway.json` in this repo. |
| Box incoming-mail folder | **Partial** | Env + metadata; **not** wired to dedicated sync logic (case sync uses **root** folder). |
| PP emails in sync | **Yes** | Entities, not mailroom UI. |
| Correspondence doc types / rules | **Yes** | wc-rules + projection. |
| MSG / native email parsing | **No** | MSG skipped in OCR. |
| End-to-end mailroom queue + triage UI | **No** | New product work. |

---

## 2. Cursor plan: Package Studio roadmap

**File:** `~/.cursor/plans/package_studio_roadmap_9b0540fb.plan.md`

- **Mailroom** is explicitly a **future track**, not part of the alpha stop line.
- Todo `future-tracks`: *“Keep Mailroom, broader package types, full WorkCompBench, agent role split, and Postgres migration out of the alpha critical path.”*
- The roadmap’s **finished-enough** bar does **not** require mail intake; later phases focus on hearing packet, second package type, AI/QA.

---

## 3. Exported chat threads (`~/Downloads/`)

### Common themes across `22.md`, `333.md`, `44.md`

- **Mailroom is premature** for “testable MVP”: needs inbound email integration, matter matching, deadline extraction — harder than it sounds; **move to Future Tracks**.
- **IA overload:** eight top-level areas including Mailroom is heavy; **Mailroom last** (after uploads/intake exist).
- **Deprioritize** Mailroom vs WorkCompBench vs core package loop until a usable package path ships.

### `333.md` — most concrete “Mailroom flow” definition

Roughly:

1. Ingest email or uploaded PDF set.
2. Classify to matter or **propose matter match**.
3. Detect **package type** (claim petition, discovery, intervention notice, hearing notice, medical narrative, etc.).
4. Extract **deadlines**.
5. Propose **next package**.
6. Run **package workflow**.

Stated intent: mail processing should be a **first-class package source**, not a side feature.

### `11.md` — phased “document intelligence pipeline”

- **Phase 3** (conceptual): mail/document in → read → classify → extract → file → update case state → suggest next action.
- Backend sketch: upload or **Box webhook** triggers pipeline; OCR → classify → extract fields → `case_event` → branch state; notifications with historical stats.
- Desktop: **Inbox/mailroom page** listing recent ingested documents with classification, extracted data, suggested next action, link to run a runner.
- **Phase 4** references **ActionDocket**-style pipeline/analytics (separate product reference).

### `11.md` — ActionDocket

Mentioned as a **comparison** (“Kanban-style case pipeline like ActionDocket”) for future dashboard/analytics — **not** verified as code in this repo or searched as a cloned repo on disk in this pass.

---

## 4. Related ideas elsewhere in planning (not a separate app)

- **HOSTED / internal web** ([`HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md`](./HOSTED_WEB_APP_PRIMARY_PLAN_2026-03-21.md)): deployment mode; does not add mailroom.
- **Intelligence backlog** ([`INTELLIGENCE_BUILD_BACKLOG_2026-03-21.md`](./INTELLIGENCE_BUILD_BACKLOG_2026-03-21.md)): internal runner first, public later; no mailroom row — closest is **source capability matrix** and ingestion policy.

---

## 5. Summary table

| Source | Mailroom / mail intake content |
| --- | --- |
| **`wc-legal-prep` code** | Box incoming folder **config**; PP **email** sync as entities; **no** mailroom feature or UI. |
| **`wc-legal-prep` Railway** | Single supervisor: API + OCR worker ([`start-railway.ts`](../apps/api/src/start-railway.ts)); unrelated to mail. |
| **Other Railway app (disk)** | **Not found** as a second repo with `railway.json` in home search. |
| **Package studio Cursor plan** | Mailroom **deferred** past alpha. |
| **Downloads `11.md`** | Phased mailroom/inbox + webhook pipeline vision; ActionDocket analogy. |
| **Downloads `22.md` / `333.md` / `44.md`** | Mailroom premature; future track; optional detailed flow in `333.md`. |

---

## 6. If you build mailroom later (informed by sources)

Prerequisites called out in the threads:

1. **Inbound channel:** email API or upload + optional Box webhook (not only a folder id in env).
2. **Matter resolution:** explicit matching rules and human confirmation.
3. **Package-type detection** tied to your **package rules** / runners.
4. **Deadline extraction** with provenance and review.
5. **Operator UX:** triage queue before top-level “Mailroom” nav is justified.

---

## Related docs

- **[Foundation execution brief](FOUNDATION_EXECUTION_BRIEF_2026-03-21.md)** — Where mailroom sits in execution order (later orchestrated intake; matter console first).

## 7. Keeping this doc current

When mailroom scope becomes a real epic, either:

- add a spec under [`docs/package-studio/specs/`](./package-studio/specs/), or
- link issues/PRs here under a dated heading.

---

## 8. Redirect: former `MAIL_ROOM_AND_CORRESPONDENCE_INVENTORY_2026-03-21.md`

The file [`MAIL_ROOM_AND_CORRESPONDENCE_INVENTORY_2026-03-21.md`](./MAIL_ROOM_AND_CORRESPONDENCE_INVENTORY_2026-03-21.md) is a **stub** that points here so old bookmarks do not fork content.

---

*Generated as a consolidation pass; amend with any repo or host paths that were not visible locally.*
