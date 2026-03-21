# Package Studio Contract

This directory imports the working Desktop package system into `wc-legal-prep` as:

- product contract
- runner specification
- golden fixture source
- regression reference

The Desktop packages are not side projects. They define the correct runner flow:

1. file inventory
2. full read coverage
3. case spine
4. issue/scope/gap analysis
5. exhibit plan
6. exhibit build
7. drafting
8. workbook
9. final QA

Primary source packages:

- Hearing spec:
  - `/Users/danielswenson/Desktop/Hearing_Prep_Package`
- Hearing golden case:
  - `/Users/danielswenson/Desktop/Dianna_Johnson_Hearing_Prep`
- Demand runner package:
  - `/Users/danielswenson/Desktop/Demand_Writer_Package`
- 239 package:
  - `/Users/danielswenson/Desktop/239_Box_Data_and_Analysis`

This repo-owned import is intentionally assertion-based rather than exact-text snapshot based.

That means later tests should verify:

- required artifacts exist
- required sections exist
- required coverage flags are present
- citation / provenance density meets minimums
- final output files are produced

They should not require exact word-for-word output identity.
