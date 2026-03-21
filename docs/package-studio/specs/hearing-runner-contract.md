# Hearing Runner Contract

Source materials:

- `/Users/danielswenson/Desktop/Hearing_Prep_Package/00_READ_ME_FIRST/SYSTEM_OVERVIEW.md`
- `/Users/danielswenson/Desktop/Hearing_Prep_Package/02_WORKFLOW/WORKFLOW_PHASES.md`
- `/Users/danielswenson/Desktop/Hearing_Prep_Package/04_OUTPUT_SPECS/CASE_SPINE_AND_OUTPUT_SPECS.md`
- `/Users/danielswenson/Desktop/Dianna_Johnson_Hearing_Prep/05_FINAL_QA/FINAL_QA.md`

## Core design idea

Do not begin with a polished memo.

Begin with a structured case spine that drives:

- exhibit selection
- witness planning
- relief requests
- opening drafting
- memo drafting
- workbook assembly
- final QA

## Data source split

### Box / case file

Use Box for:

- actual proof
- actual exhibit versions
- actual filing materials
- final hearing work product

### PracticePanther

Use PracticePanther for:

- workflow history
- deadlines
- hearing notices
- intervention workflow
- narrative-request tracking
- mileage / billing follow-up tracking

PracticePanther is workflow context, not exhibit proof.

## Required hearing workflow

1. Build a full file inventory.
2. Read all critical document classes.
3. Build the case spine.
4. Determine hearing scope, issues, and proof gaps.
5. Build the exhibit rationale table and final exhibit plan.
6. Assemble the filed exhibit PDF and Bates map.
7. Draft memo, opening, legal memo if needed, outlines, and missing-items list.
8. Build the workbook.
9. Run final QA.

## Required structured artifacts

The runner must produce, at minimum:

- `file_inventory`
- `case_profile`
- `issue_matrix`
- `fact_timeline`
- `exhibit_catalog`
- `witness_matrix`
- `deadlines_and_requirements`
- `read_coverage_log`
- `open_questions`
- `proof_to_relief_graph`

## Required final outputs

The runner must produce, at minimum:

- hearing prep memo
- opening statement
- legal memo if needed
- examination outlines
- missing / needed list
- authority verification table
- filed exhibit PDF
- Bates map
- attorney workbook
- hearing-readiness checklist

## QA rules

Before a run is considered complete:

- every critical document class must have been read or explicitly flagged
- scan-only critical files must be visually verified if OCR is not enough
- all memo/opening/artifact references must cite final Bates pages, not raw filenames
- the exhibit PDF must exist
- the workbook must exist
- the package must be explicitly marked hearing-ready or not ready

## Test contract

Later automated tests should assert:

- required artifact presence
- required sections in each artifact
- non-empty content in required sections
- final exhibit PDF exists
- Bates map exists
- read coverage flags are present
- final report states readiness and remaining risks
