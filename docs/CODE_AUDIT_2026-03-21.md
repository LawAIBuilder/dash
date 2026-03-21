# Code Audit Ticket

Date: 2026-03-21

Status: audit only. No code was changed beyond this ticket file.

## Scope

- Reviewed repo-authored application code under `apps/`, `packages/`, root configs, and product docs.
- Excluded generated/vendor output such as `node_modules/` and `dist/`.
- Validation run during audit:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - stricter sweeps with `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` per workspace

## Executive Summary

The repository is much more capable than the docs imply, but it is also in a transitional state. The API surface is broad and increasingly product-like; the desktop workbench exposes a substantial portion of it; and the main risks are now not compiler failures, but broken end-to-end seams, unfinished product paths, stale documentation, and dead or half-wired code.

The most important problems are:

1. the AI/retrieval summary path is broken by a schema mismatch;
2. uploads and non-Box documents are accepted into workflows that preview/export paths cannot actually serve;
3. multi-package support exists in data and API but the main exhibit editor only opens the first packet;
4. discovery-response / target-document support exists in the model but not in the desktop workflow;
5. the exhibit packet structure does not match the product language being shown to users.

## Findings

### 1. High: `gatherDocumentSummaries()` is joining on a non-existent column and can silently break AI summary/retrieval flows.

Evidence:

- `apps/api/src/retrieval.ts:84-91` joins `canonical_pages cp ON cp.canonical_document_id = cd.id`.
- `apps/api/src/schema.ts:603-614` defines the actual column as `canonical_doc_id`.
- `apps/api/src/ai-service.ts:146-153` uses `gatherDocumentSummaries()` directly for AI assembly jobs.

Impact:

- Legacy AI assembly jobs can fail or lose OCR preview context.
- Retrieval summary mode is under-tested and currently not trustworthy.

Why this matters:

- This is not cosmetic. It is a broken query on a live code path.

Recommended ticket:

- Fix the join to `cp.canonical_doc_id`.
- Add direct tests for `gatherDocumentSummaries()` and for the AI assembly path that depends on it.

### 2. High: the app accepts uploads and non-Box items into exhibit/package workflows, but preview and packet PDF export are Box-only.

Evidence:

- Uploads are first-class source items: `apps/api/src/matter-upload.ts:69-77` persists `provider: "matter_upload"` and `source_kind: "upload"`.
- Upload API is live: `apps/api/src/server.ts:2832-2852`.
- Exhibit source tray explicitly includes uploads: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:42-45`.
- Document preview endpoint rejects anything not from Box: `apps/api/src/server.ts:2102-2134`.
- Documents page shows `Preview` for any row with a `sourceItemId`: `apps/desktop/src/pages/cases/CaseDocumentsPage.tsx:177-187`.
- Review page does the same: `apps/desktop/src/pages/cases/CaseReviewPage.tsx:126-130`.
- Packet PDF export fetches bytes through a Box-only helper: `apps/api/src/server.ts:142-169`.
- Packet PDF renderer always does `PDFDocument.load(bytes)`: `apps/api/src/packet-pdf.ts:570-584`.

Impact:

- Users can upload documents, assign them into exhibits, and then hit broken preview/export paths.
- Even Box items that are not PDFs are risky for packet export because the renderer assumes PDF bytes.

Why this matters:

- This creates real dead ends in normal operator flows, not hidden admin paths.

Recommended ticket:

- Pick one policy and enforce it consistently:
  - either support uploads/non-Box/non-PDF sources end-to-end for preview/export,
  - or hide/disallow them everywhere those flows are not supported.
- Gate preview/export buttons by actual provider/capability, not just presence of `sourceItemId`.

### 3. High: multi-package support exists, but the exhibit editor only opens the first packet and ignores the rest.

Evidence:

- Packages page can create different packet types: `apps/desktop/src/pages/cases/CasePackagesPage.tsx:433-490`.
- Exhibit page hardcodes `const packet = workspace.data?.[0] ?? null`: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:277-280`.
- Exhibit page creates a hardcoded hearing packet when empty: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:369-372`.

Impact:

- If a case has multiple active packets across package types, the main exhibit editor only manages the first one returned by the API.
- Non-hearing packages are effectively invisible from the dedicated exhibit workspace.

Why this matters:

- The repository already models multiple package types. The UI currently discards that capability.

Recommended ticket:

- Add explicit packet selection/routing to the exhibits workspace.
- Route exhibit editing by `packetId`, not “first packet”.
- Remove hardcoded hearing-packet assumptions from the empty-state create flow.

### 4. High: discovery-response / target-document workflow is modeled in the API but not actually exposed in the desktop.

Evidence:

- Packet model supports `target_document_source_item_id`: `apps/api/src/exhibits.ts:611-656`.
- Package worker consumes it and promotes it into whole-file retrieval context: `apps/api/src/ai-service.ts:328-355`.
- Packages UI only references this as a note to the operator: `apps/desktop/src/pages/cases/CasePackagesPage.tsx:221-223`.
- Exhibit UI only updates packet mode, not target document or package metadata: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:378-386`.

Impact:

- Discovery-response and petition flows are advertised but the key “target document” linkage still requires out-of-band API usage.

Why this matters:

- This is a model/UI mismatch on a core workflow, not a future nice-to-have.

Recommended ticket:

- Add packet-level editing UI for:
  - `target_document_source_item_id`
  - `package_type`
  - `package_label`
- Or explicitly remove/de-scope these workflow claims until the UI exists.

### 5. High: default exhibit packet structure does not match the product language being shown to users.

Evidence:

- Default packet sections are only:
  - `apps/api/src/exhibits.ts:8-10` => `Employee Exhibits`
- Packet creation seeds starter slots only into that first employee section:
  - `apps/api/src/exhibits.ts:659-686`
- Exhibit page copy tells users they will arrange exhibits into “employee, employer, and joint sections”:
  - `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:621-623`

Impact:

- The UI promise and the default data model diverge immediately.
- The API does support section CRUD, but the desktop does not expose full section management.

Recommended ticket:

- Decide the real default packet structure:
  - employee/employer/joint,
  - employee-only with custom sections,
  - or packet-type-specific section templates.
- Then align both seed behavior and user-facing copy.

### 6. Medium: documentation is materially stale relative to the codebase.

Evidence:

- `docs/ROADMAP.md:17` still labels PracticePanther as “dev stubs”.
- `docs/ROADMAP.md:27` still describes the desktop as a “Read-only matter dashboard”.
- `docs/ROADMAP.md:54` says there is “no in-repo worker”.
- `docs/ROADMAP.md:94` positions PracticePanther as a later phase.
- `docs/DEPLOY.md:74` still says production PP sync is stubbed.
- In reality the repo now contains:
  - `apps/api/src/ocr-worker.ts`
  - `apps/api/src/ocr-worker-service.ts`
  - `apps/api/src/start-railway.ts`
  - live PP OAuth/sync routes in `apps/api/src/server.ts`
  - a substantial interactive desktop workbench under `apps/desktop/src/pages/cases/*`

Impact:

- The roadmap is no longer a reliable representation of what exists.
- This creates onboarding and prioritization confusion.

Recommended ticket:

- Rewrite roadmap/deploy docs to match the current architecture and explicitly call out what is still partial.

### 7. Medium: large portions of the API surface are not wired into the desktop, creating an operator-only or dead-end surface area.

Evidence:

- Server routes exist for:
  - section CRUD: `apps/api/src/server.ts:1068-1125`
  - packet preview / exhibit list generation: `apps/api/src/server.ts:1405-1428`
  - regression checks / run manifests: `apps/api/src/server.ts:2716-2750`
  - golden examples: `apps/api/src/server.ts:2987-3031`
  - retrieval test: `apps/api/src/server.ts:3040`
  - package-rule patch: `apps/api/src/server.ts:2945`
- Grep across `apps/desktop/src/lib/api-client.ts`, hooks, and pages found no corresponding desktop calls for several of these operator routes.

Impact:

- The server surface is broader than the product surface.
- Maintenance cost is increasing for features that are not clearly first-class or intentionally internal.

Recommended ticket:

- Classify each route as one of:
  - user-facing and needs UI,
  - internal/operator-only and should be documented,
  - stale and should be removed.

### 8. Medium: desktop test coverage is effectively absent.

Evidence:

- `find apps/desktop -maxdepth 3 \( -name '*test.ts' -o -name '*test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \)` returned no desktop tests.
- There is also no direct test coverage on `gatherDocumentSummaries()`; grep over `apps/api/src/__tests__` found no such test.

Impact:

- Regressions in Documents, Exhibits, Packages, Templates, and Connections can ship while API tests stay green.
- The retrieval join bug above likely survived because this UI-facing retrieval path had no direct test.

Recommended ticket:

- Add desktop integration coverage for:
  - multi-packet exhibits,
  - preview gating by provider,
  - package target-document workflow,
  - PracticePanther connection/sync flows.
- Add API tests specifically for retrieval summaries and multi-provider preview/export policy.

### 9. Medium: dead code / abandoned paths are accumulating and the stricter compiler sweep already catches them.

Evidence from `--noUnusedLocals --noUnusedParameters`:

- `apps/api/src/exhibits.ts:14` `nowIso` is unused.
- `apps/api/src/exhibits.ts:192` `getExhibitRow` is unused.
- `apps/api/src/runtime.ts:641` `resolveCanonicalDocumentOcrPolicy` is unused.
- `apps/api/src/server.ts:103-106` imports `recordClassificationSignal` and `getAIEventConfig` but does not use them.
- `apps/api/src/server.ts:217` `parseMetadataRecord` is unused.
- `packages/wc-rules/src/index.ts:12` `HearingRelevance` import is unused.
- `apps/desktop/src/pages/cases/CaseConnectionsPage.tsx:19` imports `truncateMiddle` but does not use it.
- `apps/desktop/src/officeHints.ts:19-31` defines `officeFormatHintFromTitle`, and grep found no usage.

Impact:

- The codebase is carrying exploratory or abandoned implementation paths.
- This makes audits harder and obscures which workflows are truly canonical.

Recommended ticket:

- Run a dedicated dead-code cleanup pass.
- Remove or wire each unused path intentionally.

### 10. Medium: upload/OCR policy is internally inconsistent for office/binary formats.

Evidence:

- Upload allowlist permits DOC/DOCX: `apps/api/src/matter-upload.ts:46-49`.
- OCR worker explicitly skips office/binary formats and records `review_required`: `apps/api/src/ocr-worker.ts:9-22` and `apps/api/src/ocr-worker.ts:242-250`.
- There is a desktop helper intended to warn users about this, but it is unused:
  - `apps/desktop/src/officeHints.ts:19-31`

Impact:

- Users can upload office documents that the OCR worker will not process, but the UI does not clearly warn them ahead of time.

Recommended ticket:

- Either tighten the upload allowlist to supported workflow formats,
- or surface clear warnings and alternate handling for office docs.

### 11. Low/Medium: seed ownership is split between `@wc/wc-rules` and local DB seed augmentation.

Evidence:

- `apps/api/src/seed.ts:3-8` imports `documentTypeSeeds` from `@wc/wc-rules`.
- `apps/api/src/seed.ts:402-425` then appends additional local document types before seeding.

Impact:

- Rules are not coming from one authoritative source.
- Future changes can drift between package definitions and runtime seed behavior.

Recommended ticket:

- Decide whether `@wc/wc-rules` is the single source of truth.
- If yes, move local additions there or formally layer them as overrides with tests.

### 12. Low: AI model selection is hardcoded and not operationally configurable.

Evidence:

- `apps/api/src/ai-service.ts:6` sets `const DEFAULT_MODEL = "gpt-4o"`.
- `apps/api/src/ai-service.ts:126` and `apps/api/src/ai-service.ts:321` use that default directly.

Impact:

- Model upgrades, cost control, and environment-specific tuning all require code changes.

Recommended ticket:

- Move model selection to env/config with sane defaults and audit logging.

### 13. Low: desktop production bundle size is already in warning territory.

Evidence from `npm run build`:

- `dist/assets/index-DIALz72T.js` = `1,235.91 kB` minified (`366.65 kB` gzip)
- `dist/assets/pdf.worker.min-wgc6bjNh.mjs` = `1,078.61 kB`
- Vite emits chunk-size warnings.

Impact:

- Desktop startup cost is already high.
- PDF stack should be lazily loaded instead of front-loading everything.

Recommended ticket:

- Split the PDF viewer/worker and other heavy case pages behind route-level dynamic imports.

## Roadmap

### Phase 1: Stop the broken user paths

1. Fix retrieval summary SQL and add tests.
2. Decide and enforce supported-provider/file policy for preview, OCR, and packet PDF export.
3. Add explicit packet selection in the exhibits workspace.
4. Implement packet editing for `target_document_source_item_id` and related package metadata.
5. Align default exhibit sections with the actual product design.

### Phase 2: Collapse drift and dead ends

1. Update `ROADMAP.md`, `DEPLOY.md`, and related product docs.
2. Classify server routes into product, operator-only, or remove.
3. Remove unused helpers/imports and clean dead branches.
4. Consolidate seed ownership between `@wc/wc-rules` and `seed.ts`.

### Phase 3: Quality hardening

1. Add desktop integration tests.
2. Add API tests for retrieval summaries, preview/export policy, and packet workflows.
3. Externalize AI model selection and related runtime settings.
4. Split the desktop bundle and lazy-load heavy PDF features.

## Suggested Ticket Breakdown

If this gets turned into execution tickets, I would split it as:

1. Retrieval/AI correctness fix + tests.
2. Source capability matrix (Box vs upload vs non-PDF) and UI gating.
3. Multi-packet exhibits UX and routing.
4. Discovery-response target-document UX.
5. Exhibit section model alignment.
6. Docs refresh.
7. Dead-code cleanup.
8. Desktop test harness and initial integration coverage.
9. Bundle-splitting/perf pass.

## Verification Notes

- `npm run typecheck`: passed
- `npm test`: passed
- `npm run build`: passed with Vite chunk-size warnings
- stricter unused-code sweeps: failed as expected on current unused imports/helpers listed above
