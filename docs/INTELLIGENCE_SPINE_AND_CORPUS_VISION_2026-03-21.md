# Intelligence Spine And Corpus Vision - 2026-03-21

## Purpose

This doc preserves the highest-value product and data ideas from:

- `~/.cursor/plans/usage,_ai_status,_backlog_72319b85.plan.md`
- `~/.cursor/plans/wc_legal_prep_hybrid_master_plan_2026-03-18.md`
- `~/.cursor/plans/wc_claim_branch_intelligence_addendum_2026-03-18.md`
- `~/.cursor/plans/unified_case_engine_577b23f6.plan.md`
- `~/Downloads/11.md`
- `~/Downloads/22.md`
- `~/Downloads/333.md`
- `~/Downloads/44.md`

The goal is not to promote every brainstorm into a build commitment. The goal is to keep the durable ideas versioned in the repo so they are not lost while day-to-day hardening and shipping continues.

## Current Call

The durable strategic call is:

1. `wc-legal-prep` remains the foundation repo.
2. The Desktop packages are the product spec and golden reference set.
3. The internal runner/workbench product comes first.
4. Historical intelligence should grow from structured events, exemplars, and descriptive statistics before any vector-first or fine-tuning strategy.

This is consistent with:

- [Package Studio Contract](./package-studio/README.md)
- [Alpha Stop Line](./package-studio/alpha-stop-line.md)
- [Code Audit Reconciliation](./CODE_AUDIT_RECONCILIATION_2026-03-21.md)

## Durable Ideas Worth Keeping

### 1. The Desktop packages are not side projects

Keep this as a non-negotiable rule:

- Hearing Prep, Demand Writer, and `239` Desktop artifacts define the intended runner flow.
- They should continue to act as:
  - product contracts
  - golden output references
  - regression fixture sources
  - QA expectations

That is already reflected in [docs/package-studio/README.md](./package-studio/README.md) and the runner contracts under [docs/package-studio/specs](./package-studio/specs).

### 2. Intelligence is not “chat”; it is a case/event spine

The strongest recurring idea across the exported threads is that the real intelligence layer is:

- document typing
- event extraction
- branch/state tracking
- next-step support
- template reuse
- provenance-backed drafting

The main product is a runner-based workbench, not a free-form chatbot.

### 3. The 3,000-case archive matters, but not as a first-step ML training project

The archive should be treated first as:

- a case-flow and event-sequence corpus
- a source of exemplar packages
- a source of recurring template structure
- a source of descriptive historical patterns

Not first as:

- a vector-first architecture
- a blanket fine-tuning program
- a magical “train on everything” project

The best repeated advice across the threads is still correct:

- search and structured retrieval before vector
- filename/path/event indexing before OCR-everything
- descriptive stats before causal claims
- approved exemplars before mined templates become reusable assets

### 4. The historical indexer should be an explicit batch process

Do not let this idea disappear into vague “intelligence later” language.

There should be a clear, separate concept of a historical case-flow indexer:

- scans historical Box matters
- infers document/event sequences
- bootstraps `case_events`-style history
- feeds descriptive recommendations and template mining

This is distinct from the live ingest pipeline for active matters.

The current repo already contains a first bootstrap version in [apps/api/src/historical-indexer.ts](../apps/api/src/historical-indexer.ts), but that module is still:

- filename/title driven
- heuristic
- descriptive
- not a full legal reasoning engine

It should continue to be described that way until the event model is richer.

### 5. Golden examples are a first-class retrieval asset

One of the best ideas repeated across the exports is “golden example retrieval.”

Keep this principle:

- use prior approved packages as structural exemplars
- retrieve them by package type and relevance
- let them shape drafting and QA
- never let them replace provenance from the active matter

The repo already has a first implementation:

- `golden_examples` retrieval in [apps/api/src/retrieval.ts](../apps/api/src/retrieval.ts)
- package-studio golden fixtures in [docs/package-studio/fixtures](./package-studio/fixtures)

What remains true:

- this is not yet a full archive-wide exemplar system
- it should evolve from curated and approved sources, not raw historical clutter

### 6. Branch intelligence should stay rules-first and humility-first

The best branch-intelligence guidance from the plans should be preserved:

- deterministic branch/preset structure
- clear workflow stages and requirements
- descriptive historical support
- no fake causation

The repo already points in this direction through:

- branch/workflow concepts in the current schema/runtime
- historical recommendation endpoints
- the caution language in [docs/package-studio/specs/239-runner-contract.md](./package-studio/specs/239-runner-contract.md)

Keep the product rule:

- “similar historical cases often had X next” is acceptable
- “AI says X causes Y” is not acceptable without a much stronger evidentiary basis

### 7. Template mining should follow approved outputs, but start thinking early

Two ideas need to coexist:

1. Do not promote raw noisy drafts into reusable templates.
2. During indexing and runner work, watch for repeated structure early.

That means:

- capture candidates during historical indexing
- promote only from approved or validated outputs
- prefer field-mapped, provenance-aware templates over loose text snippets

The existing document-template system is a good destination for this, but not the same thing as the mining pipeline itself.

### 8. Internal first, public later

The exported threads were consistent on this and the repo should keep saying it clearly:

- internal hearing/demand/`239` runner system first
- public calculators or limited analyzers later
- public tools must not drive the internal build order
- public tools must remain separate from private matter data

This remains the right call.

## Repo Reality Check

These ideas are partially real in the current codebase:

### Already reflected in repo

- Desktop packages are treated as contracts and fixture sources:
  - [docs/package-studio/README.md](./package-studio/README.md)
  - [docs/package-studio/specs/hearing-runner-contract.md](./package-studio/specs/hearing-runner-contract.md)
  - [docs/package-studio/specs/demand-runner-contract.md](./package-studio/specs/demand-runner-contract.md)
  - [docs/package-studio/specs/239-runner-contract.md](./package-studio/specs/239-runner-contract.md)
- Golden fixtures exist:
  - [docs/package-studio/fixtures/golden_cases.json](./package-studio/fixtures/golden_cases.json)
  - [apps/api/src/__tests__/golden-fixtures.test.ts](../apps/api/src/__tests__/golden-fixtures.test.ts)
- A deterministic hearing snapshot exists:
  - [apps/api/src/hearing-runner.ts](../apps/api/src/hearing-runner.ts)
- A first historical indexing and recommendation layer exists:
  - [apps/api/src/historical-indexer.ts](../apps/api/src/historical-indexer.ts)
- Retrieval already includes golden-example support:
  - [apps/api/src/retrieval.ts](../apps/api/src/retrieval.ts)

### Not yet fully real

- a true 3,000-case ingestion/indexing pipeline
- a full shared event/branch engine across Hearing, Demand, and `239`
- template mining from approved historical outputs
- a robust similar-case retrieval system across the archive
- a production auth/authorization model for multi-user operation
- a public-facing product surface on top of a trusted private engine

## Important Product Rules

These rules were strong in the external material and should remain explicit:

1. Keep Box for originals, proof, and final outputs.
2. Keep PracticePanther as workflow context, not exhibit proof.
3. Put provenance everywhere.
4. Require explicit human approval before final save-back or finalization.
5. Treat historical recommendations as descriptive support unless the evidence model becomes much stronger.
6. Do not make vector search or fine-tuning the foundation.
7. Do not let the public-product idea distort the internal runner roadmap.

## The Right Order For “Intelligence”

If the north star remains the long-term intelligence system, the order should stay:

1. Stable source ingestion and normalization
2. Document typing and OCR/extraction quality
3. Case/event schema
4. Runner contracts and golden fixtures
5. Golden-example retrieval
6. Historical case-flow indexing
7. Template mining from approved outputs
8. Similar-case support and better recommendations
9. Vector/RAG only if it adds real retrieval value
10. Fine-tuning only for narrow output-format or style gains after the above exists

## What To Keep Updating

When future planning happens, update this file instead of relying on chat exports alone.

Append dated bullets under one of these headings:

- `Durable Ideas Worth Keeping`
- `Repo Reality Check`
- `Important Product Rules`
- `The Right Order For “Intelligence”`

If a future idea becomes concrete enough to build against, promote it into:

- [docs/package-studio](./package-studio/)
- [docs/CODE_AUDIT_RECONCILIATION_2026-03-21.md](./CODE_AUDIT_RECONCILIATION_2026-03-21.md)
- a dedicated contract/spec doc under `docs/`

## Bottom Line

The best ideas from the plan/chat corpus are not “do ML somehow.”

They are:

- make the Desktop runner artifacts the spec
- make the event/data spine first-class
- mine the historical archive for flow, exemplars, and templates in a disciplined way
- preserve provenance and approval
- use structured retrieval before vector
- keep the internal legal engine as the main product until it is trusted
