# Demand Runner Contract

Source materials:

- `/Users/danielswenson/Desktop/Demand_Writer_Package/.cursor/rules/demand-runner.mdc`
- `/Users/danielswenson/Desktop/Demand_Writer_Package/Operations_Manual.md`
- `/Users/danielswenson/Desktop/Demand_Writer_Package/runs/linda_parker_23209/03_OPUS_FINAL/demand_final.md`
- `/Users/danielswenson/Desktop/Demand_Writer_Package/runs/linda_parker_23209/03_OPUS_FINAL/attorney_memo_final.md`

## Core rule

Use PracticePanther for workflow context.

Use Box for proof.

Do not upload or finalize anything without explicit attorney approval.

## Minimum source bundle

Each demand run should preserve:

- Box inventory for the matter
- PracticePanther matter export
- PracticePanther notes
- PracticePanther tasks
- PracticePanther events
- source file manifest / exhibit manifest

## Required operator gates

The demand runner must not proceed to final publish behavior until:

- attorney review approval exists
- final output approval exists

## Required final outputs

The demand runner should produce, at minimum:

- demand draft
- attorney memo
- exhibit manifest / exhibit index
- verification summary

## Product rules

- Box is the final output destination.
- Demand outputs must remain editable before approval.
- The package must preserve exact source provenance for damages statements, liability statements, and treatment chronology.
- The system should optimize for a real legal work product, not a generic summary.

## Test contract

Later automated checks should assert:

- source pull artifacts exist
- demand draft exists
- attorney memo exists
- exhibit manifest exists
- final outputs are approval-gated
- factual sections cite supporting matter data or source exhibits
