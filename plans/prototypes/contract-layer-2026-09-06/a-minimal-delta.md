---
title: "Direction: Minimal Delta"
date: 2026-09-06
status: reference
tags: [prototype, contract-layer]
---

# Direction: Minimal Delta

Add the fewest new fields; reuse `rationale` (entry text) and `description` (descriptor text)
wherever their existing type already carries the needed information. New surface: `findings` on
the per-gate entry, `owns`/`invariants` on `module.yaml` — five new field _names_ total
(`findings`, `id`, `owns`, `invariants`, `test`), two of them (`id` at entry- and module-scope)
sharing one concept.

## (a) shell_verify finding — unresolved promptId

```yaml
index: 3
passed: false
rationale: "shell_verify(chain-integrity) exited 1"
findings:
  - id: chain-integrity.unresolved-promptid
    rationale: >-
      exit=1 -- validate_chain_integrity.py: "step 4: promptId 'drafter-x' not
      registered" -- chain=nightly-release step=4
```

Everything the gate had (exit code, validator's own output line, chain id, step index) is packed
into the one reused `rationale` string on the finding. No new field carries any of it individually.

## (b) code-quality judged finding — missing return statement

```yaml
index: 1
passed: false
rationale: "code-quality inline_guidance failed: missing return statement"
findings:
  - id: code-quality.missing-return-statement
    rationale: >-
      judge: step output defines a function body with no return; required_patterns
      ['function','return'] -- 'return' absent from output
```

The judge has only prose and the gate's own `pass_criteria` (`server/resources/gates/code-quality/gate.yaml`),
so the finding's rationale names the exact criterion that failed (`required_patterns` element) rather
than paraphrasing the judge's free text.

## (c) `server/src/engine/gates/module.yaml` extended

```yaml
schemaVersion: 1
id: engine-gates
kind: domain
lifecycle: canonical
description: Selects, enhances, and evaluates quality-gate guidance.
children: internal
owns:
  - Gate normalization
  - Gate enhancement
  - Gate selection
  - Gate verdict processing
  - Inline gate parsing
invariants:
  - id: engine-gates.verdict-processor-is-sole-writer
    description: GateVerdictProcessor is the only writer of persisted gate verdicts.
    test: server/tests/unit/gates/services/gate-verdict-processor-action.test.ts
  - id: engine-gates.selection-goes-through-gate-manager
    description: >-
      Gate selection for a step always resolves through GateManager.selectGates(),
      never inline in a stage.
    test: server/tests/integration/gates/gate-category-selection.test.ts
```

`owns` rows are copied verbatim from the "If you need..." column of CLAUDE.md's Domain Ownership
Matrix (excludes "Gate enforcement mode" -- that row's owner, `execution/pipeline/decisions/gates/`,
is a different module). Both test paths exist today (verified via `rg`); neither is hypothetical.

## Zod sketch (additive to existing files)

```ts
// prompt-engine.schema.ts -- new, then referenced from gateVerdictEntrySchema
export const gateFindingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, 'must be <gate-id>.<slug>'),
  rationale: singleLineRationale, // reused type -- no new string-validation rule
});

export const gateVerdictEntrySchema = z.object({
  index: z.number().int().positive('Gate index is 1-based'),
  passed: z.boolean(),
  rationale: singleLineRationale,
  findings: z.array(gateFindingSchema).optional(), // <-- only new key
});

// semantic-module-descriptors.ts -- inside the existing .strict() object
owns: z.array(z.string().trim().min(1)).optional(),
invariants: z.array(z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9-]+$/, 'must be <module-id>.<slug>'),
  description: z.string().trim().min(1), // reused field type, not a new one
  test: z.string().trim().min(1),
})).optional(),
```

## Field count

- Per-gate entry: **2 new field names** (`findings`, `id`), 1 reused (`rationale`, used twice: once
  at entry scope as today, once inside each finding).
- `module.yaml`: **3 new field names** (`owns`, `invariants`, `test`), 1 reused (`description`).

## Self-score

- R1 Addressable -- PASS: every finding/invariant id is author-minted `<owner>.<slug>`, never an
  index or a run-generated value.
- R2 Re-derivable -- PASS: (a)/(b) rationale packs probe, exit code/criterion, and location into one
  line; (c) invariants name a real, checked-in test file.
- R3 Round-trips -- PASS: `findings` is `.optional()` on the existing entry object; `owns`/
  `invariants` are `.optional()` additions to the `.strict()` descriptor object. No rename, no
  removal, no widened existing field.
- R4 Glanceable -- PARTIAL: `passed:false` plus the id's slug tell the reader "this needs
  attention" and roughly what kind, but there is no fixed vocabulary token distinguishing e.g. an
  "uncertain" judged finding from a "boundary" shell-verify one -- that distinction lives in the
  rationale prose, not a field.
- R5 Minimal -- PASS: 5 new field names total across both schemas, two of them (`id`) sharing one
  concept; every field has a declared reader (the `id` for addressing, `rationale`/`description`
  for reproduction, `test` for the invariant's proof, `owns` for the matrix cross-check).

## What minimal delta cannot express

Because there is no severity, confidence, or category field, every finding and invariant reads at
one fixed weight: a reader cannot tell from the shape alone whether a finding is a hard boundary
violation, an irreversible action already taken, or a merely uncertain judge observation -- that
information, if present at all, is buried in the free-text rationale and has to be read, not
matched. It also cannot express relationships between findings (one finding causing another,
findings that supersede a prior attempt's finding under retry) or verify that an `owns` row still
matches the matrix's current wording -- `owns` is a copied string, not a reference, so the two can
drift silently.
