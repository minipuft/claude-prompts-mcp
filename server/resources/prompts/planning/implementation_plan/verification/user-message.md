# Step 3: Verify-Paths

## Feature

{{feature}}

## Instructions

Before emitting the implementation table (step 4, Plan-Table), verify EVERY file path the design references against the actual filesystem. This catches plan-author drift — wrong paths, wrong line numbers, shim files mistaken for real implementations, fields assumed to exist that don't.

Your response MUST contain four CAGEERF-aligned sections. The phase-guard verification stage **enforces** their presence, minimum length, and freedom from placeholder terms (`TODO`, `TBD`, `placeholder`, `to be determined`, `will be added`). Missing or under-filled sections fail the gate and block advancement to step 4. (CAGEERF "phases" are the framework's own axis — distinct from initiative phases and from this chain's steps.)

The header text below is the `section_header` declared in `resources/frameworks/cageerf/phases.yaml`, and the section splitter matches it literally. Do NOT emit the framework phase _ids_ (`context_establishment`, `systematic_analysis`, `goal_definition`) as headers — the splitter finds no sections and the guard fails on a response that looks complete. Emit ONLY the headers in the first column.

| Section header | CAGEERF phase         | What goes here                                                                                                                                                                                                                                 | Min length | Enforced by                                         |
| -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| `## Context`   | Context Establishment | Restate the design references being verified — the file paths, line numbers, and symbols the Design step cited                                                                                                                                 | 100 chars  | Phase guard (required, min_length, no-placeholders) |
| `## Analysis`  | Systematic Analysis   | **Raw tool outputs** — paste literal `ls`, `wc -l`, `rg`, `head` output for every file. This is the verification work product.                                                                                                                 | 100 chars  | Phase guard (required, min_length, no-placeholders) |
| `## Goals`     | Goal Definition       | The `verified_paths` block + `drift_summary` + `revision_required` + `revised_paths_block`. Every cell here must trace to evidence in `## Analysis`.                                                                                           | 80 chars   | Phase guard (required, min_length, no-placeholders) |
| `## Execution` | Execution Planning    | How the verification was executed — probe batching, corrected-path re-runs, and what step 4 may now rely on. Measured 2026-08-11: omitting this section fails the guard even though earlier revisions of this table listed only three headers. | 80 chars   | Phase guard (required, min_length, no-placeholders) |

### Verification protocol (per file in design's `read-before-implementing` + every file the plan table will reference)

For each file, run these commands and paste the LITERAL output into `## Analysis`:

```bash
ls -la <file>                              # Existence check (ENOENT if path is wrong)
wc -l <file>                               # Line count — ≤25 lines is a strong shim signal
rg -n "<expected_symbol>" <file>           # Line number for each claimed symbol
head -10 <file>                            # First lines — confirms shim shape when wc -l is low
```

If `ls` says ENOENT: try variants (e.g., remove `/store/` subdirectory), re-run, paste both attempts.
If `wc -l` ≤25: paste `head -10` to confirm re-export shape.
If `rg` line differs from plan claim: record both numbers in `## Goals`.

## RESULT (Step 3)

````markdown
## Context

[1-3 sentences naming what the Design step claimed: which files, which line numbers, which symbols, which fields the plan said exist. This section is what the verification will check against — the "before" state.]

## Analysis

[For every file the design referenced, paste the raw tool output in this shape:]

### File: <path-from-design>

```bash
$ ls -la <path-from-design>
<paste literal output, including ENOENT if applicable>

$ wc -l <path-from-design>
<paste literal output>

$ rg -n "<expected_symbol>" <path-from-design>
<paste literal output>
```
````

[If path was wrong and corrected, also paste the corrected-path runs:]

```bash
$ ls -la <corrected-path>
$ wc -l <corrected-path>
$ rg -n "<expected_symbol>" <corrected-path>
```

[If wc -l ≤25, paste head -10 to confirm shim:]

```bash
$ head -10 <path>
<paste output>
```

[Repeat for every file. Every claim under `## Goals` must have backing evidence here.]

## Goals

```
verified_paths:
  - file: <path-from-design>
    exists: [yes | no — corrected to <actual-path>]
    line_count: <number from the wc -l output pasted under ## Analysis>
    is_shim: [yes — re-exports from <target>; confirmed via head -10 above | no]
    target_symbols:
      - symbol: <name>
        expected_line: <plan-claimed line, or "unspecified">
        actual_line: <line from rg -n above, or "not found">
        drift: [none | within ±10 | major drift]
    target_fields_exist:
      - field: <name>
        exists: [yes | no — must be added]
        location: <line> | n/a

  - [repeat for each file]

drift_summary:
  files_with_major_drift: <count>
  shims_detected: <list of shim paths>
  fields_to_add: <list of missing fields the plan must introduce>

revision_required: [yes | no]

revised_paths_block: |
  [If yes: corrected paths and line numbers the step-4 plan table MUST use instead.
   Cite which `## Analysis` evidence supports each correction.
   If no: "Design paths verified clean — see `## Analysis` evidence."]
```

## Execution

[How the verification ran: probe batches, any ENOENT variants attempted, any re-runs, and what the plan table may now cite as-is. Real content, ≥80 chars, no placeholder terms.]

## Why this structure works

The CAGEERF phase guards, evaluated by the phase-guard verification stage, deterministically check that the `## Context`, `## Analysis`, `## Goals`, and `## Execution` sections are present, over minimum length, and free of placeholder terms. Missing or stub responses fail the gate and force a retry.

Pasting raw tool output under `## Analysis` does three things:

1. **Satisfies the phase guard** (real bash outputs easily exceed the minimum and contain no `TODO`/`TBD`)
2. **Makes claims auditable** — every cell in the `verified_paths` block under `## Goals` has matching evidence one section above
3. **Resists fabrication** — to fake a `line_count`, the agent would also have to fake the `wc -l` output, which is visually checkable in seconds

Plan deviations encountered during the execution-ledger initiative (Tiers 1-2) that this catches:

- `chain-session-store.ts` referenced as if it were the impl, when it's a 19-line re-export shim
- `manager.ts:189-245` cited for `promoteSessionLifecycle`, but real location is line 1722
- Schema version drift (plan said 14, was already 14 from a merged PR)
- "Resume entry points" cited in singular when there were three callsites

## Skip conditions

Skip when:

- Plan touches only NEW files (nothing to verify against existing code)
- Pure docs / changelog / config changes
- Single-file fix where the design IS the file's current content

For all multi-file work touching existing code: verification runs, raw evidence required under `## Analysis`.
