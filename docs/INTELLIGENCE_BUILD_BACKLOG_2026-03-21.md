# Intelligence Build Backlog - 2026-03-21

## Purpose

This doc turns the durable strategy in [Intelligence Spine And Corpus Vision](./INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md) into a tracked build map.

Use it to answer four questions for each preserved idea:

1. What is already real in the repo?
2. What still needs an explicit spec or contract?
3. What is small enough to schedule now?
4. What should stay deliberately later?

This doc is narrower than the broader archived `unified_case_engine_577b23f6.plan.md` plan. That archived plan is still useful for platform/auth/storage direction. This backlog is the execution companion for the intelligence spine inside `wc-legal-prep`.

## How To Use This Backlog

- `In code now` means there is already a concrete file, route, or test surface in the repo.
- `Spec needed` means the idea should not be implemented further until the contract is clearer.
- `Ticket now` means it fits current milestones and can be scheduled without reopening the whole architecture.
- `Later` means keep the idea, but do not let it distort the current runner/workbench roadmap.

## Tracked Themes

| Theme | In code now | Spec needed | Ticket now | Later |
| --- | --- | --- | --- | --- |
| Desktop packages as spec and goldens | [package-studio/README.md](./package-studio/README.md), [golden_cases.json](./package-studio/fixtures/golden_cases.json), [golden-fixtures.test.ts](../apps/api/src/__tests__/golden-fixtures.test.ts) | How Desktop packages are imported, refreshed, and promoted into repo-owned acceptance criteria | Expand assertion-based golden checks beyond fixture presence into required artifacts, coverage flags, and provenance density | Import broader Demand and `239` golden sets once Hearing runner assertions are stable |
| Hearing runner artifact contract | [hearing-runner.ts](../apps/api/src/hearing-runner.ts), [hearing-runner-contract.md](./package-studio/specs/hearing-runner-contract.md) | Exact acceptance contract for final Hearing outputs, workbook, checklist, exhibit PDF, and approval gates | Add tests that assert package-studio artifact shape instead of only snapshot/build smoke behavior | Expand the same contract style to Demand and `239` outputs |
| Golden example retrieval | [retrieval.ts](../apps/api/src/retrieval.ts), [package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts) | Curation rules, approval requirements, scoring/ranking logic, and how case-specific vs shared exemplars should coexist | Add retrieval/evaluation tests that prove exemplar selection is package-type-aware and does not outrank matter provenance | Evolve into broader exemplar search once archive indexing is trustworthy |
| Historical case-flow indexing | [historical-indexer.ts](../apps/api/src/historical-indexer.ts), [package-workbench-routes.ts](../apps/api/src/routes/package-workbench-routes.ts) | Archive ingest contract, event taxonomy, filename/path bootstrap rules, and when OCR is required for indexing | Define a bounded historical-indexer pilot over approved historical matters and document its inputs/outputs | Richer archive-wide indexing, batching, caching, and similarity support |
| Shared case-event / branch spine | [events.ts](../apps/api/src/events.ts), [schema.ts](../apps/api/src/schema.ts), current runtime branch concepts | Canonical event types, PP-to-event bridge rules, branch stage keys, and runner-to-event write discipline | Write the Phase 1 event/branch contract and align Hearing runner, historical indexer, and PP mirrors against it | Full cross-runner shared branch engine across Hearing, Demand, and `239` |
| Provenance and approval discipline | [ai-service.ts](../apps/api/src/ai-service.ts), [events.ts](../apps/api/src/events.ts), [package-studio/README.md](./package-studio/README.md) | Minimum citation density, approval semantics, artifact versioning, and promotion rules for reusable outputs | Turn provenance/approval requirements into explicit package-studio acceptance checks | Richer audit trails, approval workflows, and externalized compliance surfaces |
| Template system and template mining | [document-templates.ts](../apps/api/src/document-templates.ts), [document-template-routes.ts](../apps/api/src/routes/document-template-routes.ts) | What counts as a promotable template, field model, provenance requirements, and review workflow for mined templates | Write a template-promotion spec for “approved output -> reusable template candidate” | Automated mining/promotion from larger historical corpora |
| Similar-case support and recommendations | [historical-recommendations route](../apps/api/src/routes/package-workbench-routes.ts), [historical-indexer.ts](../apps/api/src/historical-indexer.ts) | Ranking/explanation model, confidence copy, and provenance for why a recommendation is being shown | Expose current historical recommendation surfaces in the desktop only with descriptive confidence language | Archive-wide similar-case retrieval after event quality and template quality improve |
| Structured retrieval/search before vector | [retrieval.ts](../apps/api/src/retrieval.ts), current package bundle assembly, golden retrieval | Clear contract for filters/full-text/summary retrieval vs embeddings, plus prompt-budget rules | Document the intended search stack and add any missing full-text/filter surfaces before discussing embeddings | Hybrid vector retrieval only if it improves known retrieval failures |
| Archive-scale corpus pilot | Current repo only has live-matter state plus heuristic historical summaries; no 3,000-case warehouse exists | Privacy, retention, source allowlist, filename-first import policy, cost envelope, and success criteria for a pilot | Write a pilot spec for a bounded historical corpus import instead of a vague “train on 3,000 cases” goal | Larger archive warehousing, embeddings, and model-training experiments |
| Evaluation harness / WorkCompBench-style QA | Package-studio fixtures and golden assertions point in this direction, but no dedicated eval harness exists yet | Task set, scoring rubric, exemplar grading, provenance checks, and how runner regressions are scored | Define a small internal benchmark set for Hearing runner quality and exemplar retrieval quality | Broader legal-ML style benchmark work once the event/data spine is stable |
| Internal runner first, public later | [INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md](./INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md), [CODE_AUDIT_RECONCILIATION_2026-03-21.md](./CODE_AUDIT_RECONCILIATION_2026-03-21.md) | Data boundary, auth model, and what a public surface is allowed to reuse from private matter intelligence | Keep internal-runner milestones primary in roadmap and ticket triage | Separate public calculators/analyzers once internal trust is high |

## Tickets That Fit Now

These are the next intelligence-specific tickets that fit the current repo state without reopening the whole architecture:

1. Strengthen the golden suite from fixture existence to artifact-shape and provenance assertions.
2. Write the Phase 1 shared event/branch contract so Hearing runner, PP mirroring, and historical indexing stop drifting independently.
3. Define a bounded historical-indexer pilot over approved historical matters, with explicit filename/path-first rules and clear non-goals.
4. Add a template-promotion spec so reusable templates come from approved outputs instead of raw drafts.
5. Expose current historical recommendation surfaces in the desktop only after confidence/provenance copy is explicit and humility-first.
6. Document the search/retrieval boundary before any new vector or “train on everything” work is proposed.
7. Create a small internal evaluation harness for Hearing runner artifact quality and golden-example retrieval quality.

## Items That Need Spec Before Code

These ideas are worth preserving, but they should not be “implemented by vibe”:

- a full shared event/branch engine across Hearing, Demand, and `239`
- archive-wide similar-case retrieval
- mining templates from historical outputs
- any embeddings/vector layer
- any fine-tuning program
- any public product surface that touches private matter intelligence

## Keep This In Sync With

- [Intelligence Spine And Corpus Vision](./INTELLIGENCE_SPINE_AND_CORPUS_VISION_2026-03-21.md)
- [Code Audit Reconciliation](./CODE_AUDIT_RECONCILIATION_2026-03-21.md)
- [Package Studio Contract](./package-studio/README.md)

If a tracked item becomes build-ready, either:

- add it to the relevant hardening/product roadmap doc, or
- promote it into a dedicated spec under `docs/package-studio/specs/`
