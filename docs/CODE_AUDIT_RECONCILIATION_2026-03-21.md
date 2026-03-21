# Code Audit Reconciliation - 2026-03-21

## Purpose

This memo reconciles two independent audit passes:

- the broader hardening/integrity audit
- the second audit that emphasized broken user paths, retrieval/AI seams, multi-packet exhibits, and stale docs

The goal is not to replace either audit, but to merge them into a sharper execution plan.

## What Changed After The Second Pass

After reviewing the second audit against source, I would revise the plan in four important ways.

### 1. Elevate the retrieval/AI summary bug into the front of the roadmap

This was not just "AI needs polish." It is a concrete broken query on a live path.

Evidence:

- `apps/api/src/retrieval.ts:84-91` joins `canonical_pages cp ON cp.canonical_document_id = cd.id`
- `apps/api/src/schema.ts:603-614` defines the column as `canonical_doc_id`
- `apps/api/src/ai-service.ts:146-153` calls `gatherDocumentSummaries()` directly for AI assembly
- `apps/api/src/server.ts:3057` also exposes summary retrieval in a route-level path

Revision:

- This moves into the "stop broken user paths" tier, not a later AI clean-up bucket.

### 2. Split the preview/export issue into a true capability-matrix problem

My first audit correctly flagged Box-only export and preview gaps, but the second audit sharpened the product consequence: uploads and other non-Box items are already treated as first-class inputs, yet several downstream surfaces only support Box PDFs.

Evidence:

- Uploads persist as `provider: "matter_upload"` / `source_kind: "upload"` in `apps/api/src/matter-upload.ts:69-92`
- Upload API is live in `apps/api/src/server.ts:2832-2855`
- File preview rejects anything not from Box in `apps/api/src/server.ts:2102-2144`
- Packet export fetches bytes through a Box-only helper in `apps/api/src/server.ts:142-172`
- Packet PDF generation always does `PDFDocument.load(bytes)` in `apps/api/src/packet-pdf.ts:570-585`
- Exhibits source tray includes uploads in `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:42-50`
- Documents page renders `Preview` for any row with `sourceItemId` in `apps/desktop/src/pages/cases/CaseDocumentsPage.tsx:177-187`

Revision:

- This is no longer just an export bug. It should be handled as a single product-policy ticket:
  supported provider/file matrix for upload, OCR, preview, exhibits, package worker, and packet export.

### 3. Add a packet-centric UI coherence track

The second audit surfaced a coherent product-level issue: the API and data model already support multiple packet types and packet metadata, but the exhibits UI still behaves like there is exactly one hearing packet.

Evidence:

- Exhibits workspace takes only the first packet: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:277-280`
- Empty-state create flow hardcodes a hearing packet: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:369-372`
- Empty-state copy promises employee/employer/joint sections: `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:621-623`
- Packages page supports multiple packet types and lets users choose among them: `apps/desktop/src/pages/cases/CasePackagesPage.tsx:180-190`
- But its "Edit exhibits" link is not packet-specific: `apps/desktop/src/pages/cases/CasePackagesPage.tsx:206-208`
- The packet model supports `package_type`, `package_label`, and `target_document_source_item_id` in `apps/api/src/exhibits.ts:64-104` and `apps/api/src/server.ts:987-1057`
- `useUpdateExhibitPacket()` narrows the desktop mutation input and does not expose those packet metadata fields in `apps/desktop/src/hooks/useExhibits.ts:85-96`
- Packages UI only mentions `target_document_source_item_id` in instructional copy, not in a real editor, in `apps/desktop/src/pages/cases/CasePackagesPage.tsx:216-225`

Revision:

- Add a dedicated packet-centric UX track:
  packet selection, packet-specific routing, packet metadata editing, and package-type-aware exhibit workflows.

### 4. Elevate default packet structure mismatch into a real design decision

I previously treated exhibit structure drift as secondary. The second pass made clear that the data seed and UI promise are immediately contradictory.

Evidence:

- Default sections are only `Employee Exhibits` in `apps/api/src/exhibits.ts:8-10`
- Starter slots are seeded only into that first employee section in `apps/api/src/exhibits.ts:659-686`
- UI copy promises employee/employer/joint sections in `apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:621-623`

Revision:

- This deserves an explicit product decision:
  one-section default, three-section default, or package-type-specific templates.

## What Stayed The Same

The second audit did not weaken the higher-risk platform findings from the first pass. These still belong near the top of the roadmap:

- inconsistent case scoping in API routes
- cross-case sync overwrites via global unique keys
- plaintext token storage
- silent event loss via `writeCaseEvent()`
- stale OCR text semantics on failed/review-required reruns
- rules/seed source-of-truth drift
- missing desktop tests
- stale operational docs and env/runbook drift

## Validated Additions From The Second Audit

I re-ran the stricter unused-code sweep the other agent mentioned.

Validated with `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`:

- `apps/api/src/exhibits.ts`: unused `nowIso`, unused `getExhibitRow`
- `apps/api/src/runtime.ts`: unused `resolveCanonicalDocumentOcrPolicy`
- `apps/api/src/server.ts`: unused imports `recordClassificationSignal`, `getAIEventConfig`; unused helper `parseMetadataRecord`
- `apps/desktop/src/pages/cases/CaseConnectionsPage.tsx`: unused `truncateMiddle`
- `packages/wc-rules/src/index.ts`: unused `HearingRelevance`

Also validated:

- no desktop tests exist under `apps/desktop`
- `npm run build` still emits the large-bundle warning

## Revised Merged Plan

### Phase 0 - Stop broken user paths and unsafe boundaries

1. Fix `gatherDocumentSummaries()` join bug and add direct retrieval/AI tests.
2. Define and enforce a source capability matrix for upload/OCR/preview/export/package-worker behavior.
3. Fix case scoping and export access inconsistencies in the API.
4. Fix cross-case sync persistence keys and upsert behavior.
5. Clarify stale OCR text semantics and event persistence semantics.

Why this comes first:

- These are the places where the app either breaks a visible user flow or violates data/isolation assumptions.

### Phase 1 - Make the packet model coherent in the product

1. Add explicit packet selection/routing in the exhibits workspace.
2. Make exhibit editing packet-specific, not "first packet wins."
3. Expose packet metadata editing for:
   - `package_type`
   - `package_label`
   - `target_document_source_item_id`
4. Decide the default section strategy and align seed data plus UI copy.
5. Decide whether discovery-response / claim-petition packet types are first-class now or should be hidden/de-scoped.

Why this comes second:

- The codebase already models these workflows.
- Right now the desktop partially exposes them, which is worse than either fully shipping them or clearly hiding them.

### Phase 2 - Collapse drift, stale claims, and dead ends

1. Refresh `ROADMAP.md`, `DEPLOY.md`, `.env.example`, and onboarding/runbook docs.
2. Inventory server routes as:
   - user-facing
   - operator-only
   - stale/remove
3. Remove or intentionally wire dead helpers/imports.
4. Reconcile `seed.ts` vs `@wc/wc-rules`.
5. Externalize AI model selection and other runtime knobs that are currently hardcoded.

Why this comes third:

- These changes reduce cognitive load and stop the codebase from telling contradictory stories.

### Phase 3 - Quality and performance hardening

1. Add desktop integration coverage.
2. Add API tests for retrieval summaries, provider capability policy, and packet workflows.
3. Improve OCR worker consistency and connector resilience.
4. Split the desktop bundle and lazy-load heavy PDF/package surfaces.

Why this comes fourth:

- These items matter a lot, but they are best done after the product boundaries are clear.

## Two Credible Alternative Strategies

These are both reasonable. I am not recommending them over the merged plan, but they are real counterpoints.

### Alternative A - Narrow the product aggressively

Instead of implementing every latent workflow, make the product coherent by reducing scope:

- Box PDFs only
- one active hearing packet workflow
- no discovery-response target-doc UX yet
- uploads accepted only if they can be previewed/exported end-to-end
- hide or remove packet types and routes not truly supported in the desktop

Best argument for this path:

- Fastest route to a trustworthy operator product
- Minimizes feature-surface debt
- Turns several "implement this" tickets into "de-scope and gate this"

Best argument against it:

- You already have real model/API investment in multi-package workflows
- Risk of throwing away useful architecture momentum

### Alternative B - Commit fully to the packet platform

Lean into what the model already supports:

- multi-packet workspace
- packet-specific exhibits routing
- discovery-response and claim-petition target-doc UX
- package metadata editing
- provider/file capability matrix across upload, preview, OCR, export, and AI

Best argument for this path:

- Aligns the UI with the richness already present in the API and schema
- Reduces "hidden feature" drift
- Makes the platform more extensible

Best argument against it:

- Bigger execution footprint
- More risk if the product is still primarily internal/dogfood

### Alternative C - Hardening-first over product-first

If external deployment or multi-operator usage is imminent, prioritize:

- route scoping
- sync-key integrity
- token storage
- event/OCR correctness

before the packet UX work.

Best argument for this path:

- Prevents subtle data and isolation mistakes from becoming production incidents

Best argument against it:

- Leaves obvious broken user flows untouched longer

## Recommendation After Reconsideration

I would keep a hybrid plan:

- treat the retrieval join and provider capability matrix as immediate broken-path fixes
- keep case scoping and cross-case sync integrity in that same first wave
- then move quickly into packet-centric UX coherence

In other words:

- do not make this purely UX-first
- do not make it purely platform-first
- fix the broken visible seams and the dangerous integrity seams together

## Copy-Paste Prompt For Opus 4.6 Max

Use the following prompt in Cursor:

```text
You are acting as a skeptical senior staff engineer reviewing a merged code audit plan for the repo at /Users/danielswenson/wc-legal-prep.

Your job is NOT to fix code. Your job is to challenge, verify, and improve the audit plan.

Please do a read-only review of the cited files and produce:

1. A verdict on whether the merged plan is directionally correct.
2. A list of any claims that are overstated, duplicated, or mis-prioritized.
3. A revised priority order if you disagree.
4. At least 2 credible alternative execution strategies, argued seriously.
5. Any high-severity issue the merged plan still missed.
6. A recommendation on whether to narrow scope or fully commit to the packet-platform direction.

Important:
- Be adversarial in a useful way.
- Verify the citations directly instead of trusting the audit.
- Distinguish between:
  - broken live user paths
  - security / data-integrity risks
  - architectural debt
  - stale docs / stale code
- If two tickets are really the same root cause, say so and propose a merge.
- If a cited issue only matters under a certain deployment model (single-user vs multi-tenant), say that explicitly.

Here is the merged thesis:

The app is an advanced MVP with strong underlying capability, but the top risks are now broken end-to-end seams and mismatches between the modeled platform and the product actually exposed in the desktop. The first wave should fix both broken user-visible paths and dangerous data/isolation seams.

Claims to verify, with exact evidence:

1. Retrieval / AI summary join is broken and should be front-of-roadmap.
   - apps/api/src/retrieval.ts:84-91
     JOIN canonical_pages cp ON cp.canonical_document_id = cd.id
   - apps/api/src/schema.ts:603-614
     canonical_pages uses canonical_doc_id, not canonical_document_id
   - apps/api/src/ai-service.ts:146-153
     runAIAssemblyJob() uses gatherDocumentSummaries()
   - apps/api/src/server.ts around the retrieval test route also uses summary retrieval

2. Uploads and non-Box items are accepted into flows that preview/export cannot actually serve.
   - apps/api/src/matter-upload.ts:69-92
     persisted uploads become provider "matter_upload", source_kind "upload", with authoritative file URL
   - apps/api/src/server.ts:2832-2855
     upload API is live
   - apps/api/src/server.ts:2102-2144
     /api/files/:sourceItemId/content rejects anything not from Box
   - apps/api/src/server.ts:142-172
     packet PDF export fetch helper only supports Box
   - apps/api/src/packet-pdf.ts:570-585
     export always does PDFDocument.load(bytes)
   - apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:42-50
     source tray includes uploads
   - apps/desktop/src/pages/cases/CaseDocumentsPage.tsx:177-187
     documents page shows Preview for any row with sourceItemId

3. The packet model supports multiple package types, but the exhibits UI only edits the first packet.
   - apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:277-280
     const packet = workspace.data?.[0] ?? null
   - apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:369-372
     empty-state create flow hardcodes a hearing packet
   - apps/desktop/src/pages/cases/CasePackagesPage.tsx:180-190
     packages page exposes multiple packets in a selector
   - apps/desktop/src/pages/cases/CasePackagesPage.tsx:206-208
     "Edit exhibits" links only to /cases/:caseId/exhibits, not a packet-specific route
   - apps/api/src/exhibits.ts:568-599
     getCaseExhibitWorkspace() returns all packets for the case

4. The packet model supports target-doc and package metadata, but the desktop does not truly expose them.
   - apps/api/src/exhibits.ts:64-104
     packet rows include package_type, package_label, target_document_source_item_id
   - apps/api/src/server.ts:987-1057
     create/update packet endpoints accept these fields
   - apps/api/src/ai-service.ts:328-362
     package worker uses target_document_source_item_id to prepend whole-file context
   - apps/desktop/src/hooks/useExhibits.ts:85-96
     useUpdateExhibitPacket narrows the mutation input and omits package_type, package_label, target_document_source_item_id
   - apps/desktop/src/pages/cases/CasePackagesPage.tsx:216-225
     target document is only mentioned as instructional text

5. Default exhibit packet structure conflicts with product copy.
   - apps/api/src/exhibits.ts:8-10
     default sections are only Employee Exhibits
   - apps/api/src/exhibits.ts:659-686
     starter slots seed only into that employee section
   - apps/desktop/src/pages/cases/CaseExhibitsPage.tsx:621-623
     UI says exhibits will be arranged into employee, employer, and joint sections

6. Higher-risk hardening issues still matter and should remain near the top:
   - case scoping inconsistencies in apps/api/src/server.ts
   - cross-case sync overwrites in apps/api/src/source-persistence.ts and apps/api/src/schema.ts
   - plaintext connector token storage in apps/api/src/server.ts
   - stale OCR raw_text semantics in apps/api/src/runtime.ts
   - silent event loss when no branch instance exists in apps/api/src/events.ts
   - seed/rules source-of-truth drift between apps/api/src/seed.ts and packages/wc-rules/src/index.ts

7. Docs are stale relative to reality.
   - docs/ROADMAP.md still describes PP as dev stubs, desktop as read-only, and says there is no in-repo OCR worker
   - docs/DEPLOY.md still says production PP sync is stubbed
   - repo actually contains apps/api/src/ocr-worker.ts, apps/api/src/ocr-worker-service.ts, apps/api/src/start-railway.ts, PP OAuth/sync routes, and a large interactive desktop

8. Dead code accumulation is real, not speculative.
   I validated stricter unused-code sweeps:
   - apps/api/src/exhibits.ts: nowIso, getExhibitRow unused
   - apps/api/src/runtime.ts: resolveCanonicalDocumentOcrPolicy unused
   - apps/api/src/server.ts: recordClassificationSignal, getAIEventConfig, parseMetadataRecord unused
   - apps/desktop/src/pages/cases/CaseConnectionsPage.tsx: truncateMiddle unused
   - packages/wc-rules/src/index.ts: HearingRelevance unused

Current merged recommendation to challenge:

Phase 0:
- fix retrieval summary SQL + tests
- define supported provider/file capability matrix for upload/OCR/preview/export/package worker
- fix case scoping and cross-case sync-key integrity
- fix stale OCR text semantics and silent event persistence gaps

Phase 1:
- make exhibits packet-specific
- add packet selection/routing
- expose packet metadata editing for package_type/package_label/target_document_source_item_id
- decide whether discovery-response and claim-petition are first-class now or should be hidden
- align default section structure with real product design

Phase 2:
- refresh roadmap/deploy/env docs
- classify routes into product-facing, operator-only, or stale/remove
- clean dead code
- reconcile seed.ts vs wc-rules
- externalize AI model selection

Phase 3:
- add desktop integration tests
- add API tests for retrieval summaries, provider capability policy, and packet workflows
- improve OCR/connector resilience
- split the desktop bundle and lazy-load heavy PDF/package surfaces

Also give me at least two alternative strategies:
- a narrow-core strategy that intentionally de-scopes latent features
- a full packet-platform strategy that embraces the modeled capabilities
- optionally a hardening-first strategy if you think it is stronger

Be specific. Cite files and functions when you disagree.
```

