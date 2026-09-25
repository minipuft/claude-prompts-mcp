---
title: "Prototype brief — finding and descriptor shapes"
date: 2026-09-06
status: reference
tags: [prototype, contract-layer]
---

# Prototype brief — finding + descriptor shapes (2026-09-06)

You are producing a THROWAWAY sample file. Nothing gets wired. Do not edit anything under
`server/src`, `server/scripts`, `server/resources`, or `tooling/`. Write exactly one file:
`plans/prototypes/contract-layer-2026-09-06/<your-direction>.md`.

## Rulings that bind you (from plans/contract-layer-2026-09-06.md)

- D5: findings are an OPTIONAL addition to the structured gate verdict. Today a per-gate entry is
  `{index, passed, rationale}` (`server/src/mcp/tools/schemas/prompt-engine.schema.ts` ~line 150-170)
  and the persisted form is `GateVerdictSummary {gateId, verdict, rationale, timestamp, attempt}`
  (`server/src/shared/types/chain-execution.ts:96`). Anything you add must be additive.
- D6: ownership and invariants extend the EXISTING `module.yaml` descriptor
  (schema: `server/scripts/lib/semantic-module-descriptors.ts` lines 1-60; example:
  `server/src/cli-shared/module.yaml`; catalog: `docs/reference/module-catalog.md`).
- D8: ids are author-minted slugs namespaced by module id, never positional.
  Invariants `<module-id>.<slug>`, findings `<gate-id>.<slug>`.
- The Domain Ownership Matrix (root `CLAUDE.md`, "Domain Ownership Matrix") is the source for
  what `engine-gates` owns.

## Read first (only these)

1. `server/src/mcp/tools/schemas/prompt-engine.schema.ts` — search `gateVerdictEntrySchema`
2. `server/src/shared/types/chain-execution.ts` lines 85-105
3. `server/src/engine/gates/types/gate-primitives.ts` lines 70-100 (shell_verify criterion)
4. `server/resources/gates/code-quality/gate.yaml`
5. `server/src/mcp/tools/resource-manager/prompt/utils/validation.ts` lines 470-500
6. `server/scripts/lib/semantic-module-descriptors.ts` lines 1-60
7. `server/src/cli-shared/module.yaml`
8. Root `CLAUDE.md` — the Domain Ownership Matrix table only

## Produce three samples, all in YOUR direction (see your dispatch message)

- **(a)** A finding emitted by a `shell_verify` gate that ran a chain-integrity validator and found
  a chain step whose `promptId` does not resolve. Include what the gate had: exit code, the
  validator's output line, the chain and step.
- **(b)** A finding emitted by the LLM-judged `code-quality` gate on a step whose output lacked a
  return statement. The judge has only prose and the gate's criteria.
- **(c)** `server/src/engine/gates/module.yaml` extended with `owns` (from the matrix rows the
  gates module owns) and TWO invariants, each linked to a test path (may be hypothetical, mark it).

Then, in the same file:

- The JSON Schema or Zod sketch for the shape you used (short).
- Field count per sample.
- Self-score against the rubric below, one line per criterion, honest.
- One paragraph: what your direction CANNOT express.

## Rubric (fixed before results; graded by the owner, not by you)

| #   | Criterion                                                                                                                            | Fails when                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| R1  | Addressable: an agent or plan row can reference the finding/invariant by a stable id                                                 | id is positional, generated per run, or absent  |
| R2  | Re-derivable: a human can reproduce it from what it carries (probe, path, line, source)                                              | reproduction needs the transcript               |
| R3  | Round-trips: fits the existing verdict union / descriptor schema additively                                                          | requires renaming or removing an existing field |
| R4  | Glanceable: reads in the owner's preserve terms (boundary, invariant, irreversible, uncertain, attention-required) without expansion | reader must open a file to know whether to care |
| R5  | Minimal: fewest fields that satisfy R1–R4                                                                                            | a field with no reader                          |

Keep the file under 150 lines. Final report to the dispatcher: the file path, the three samples
verbatim, field counts, and your self-score. Nothing else.
