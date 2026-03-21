# Golden Fixture Model

The fixtures in this directory define the first regression contract for the package studio.

They are intentionally not exact-text snapshots.

## Why

The runner should be allowed to improve wording without causing meaningless test failures.

What must stay stable is:

- required artifact presence
- required sections
- provenance / citation support
- readiness / risk reporting
- output file production

## Fixture structure

- `golden_cases.json` lists the first imported golden matters and the files that define each expected package shape.
- Each case entry identifies:
  - source package path
  - required artifacts
  - required sections
  - required output files
  - minimum provenance expectations

## Initial golden matters

First shipping gate:

- `Dianna Johnson - 23739`
- `Linda Parker - 23209`

Expansion gate before broader internal rollout:

- add 1-3 more hearing matters
- add one demand matter
- add one `239` matter when that runner exists
