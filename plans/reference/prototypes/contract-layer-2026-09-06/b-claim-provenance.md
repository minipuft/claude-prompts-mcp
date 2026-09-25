---
title: "Direction B — Claim With Provenance"
date: 2026-09-06
status: reference
tags: [prototype, contract-layer]
---

# Direction B — Claim With Provenance

A finding is a rendered claim about a step's output: everything needed to re-derive it travels
with the claim, so a reader or a plan row never needs the transcript.

## Shared shape (Zod sketch)

```ts
const findingCategory = z.enum([
  "boundary",
  "invariant",
  "irreversible",
  "uncertain",
  "attention-required",
]);

const findingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/), // <gate-id>.<slug>, author-minted
  summary: z.string().max(200), // one line, glanceable
  failure_scenario: z.string().max(400), // what breaks if ignored
  category: findingCategory,
  verdict: z.enum(["confirmed", "plausible"]),
  probe: z.string(), // command/check that reproduces it
  location: z
    .object({ file: z.string(), line: z.number().int().positive() })
    .optional(),
});

// Additive: findings is a NEW optional array sibling to per_gate, not a replacement.
const gateVerdictEntrySchema = z.object({
  index: z.number().int().positive(),
  passed: z.boolean(),
  rationale: z.string(),
  findings: z.array(findingSchema).optional(), // <-- the addition
});
```

## (a) shell_verify finding — broken chain-step reference

```json
{
  "id": "chain-integrity.dangling-prompt-ref",
  "summary": "chain 'release-prep' step 3 references promptId 'run_smoke_tests' which is not registered",
  "failure_scenario": "chain execution reaches step 3, the pipeline cannot resolve the prompt, run halts mid-chain with no advancing node",
  "category": "boundary",
  "verdict": "confirmed",
  "probe": "node server/dist/scripts/validate-chain-integrity.js --chain release-prep",
  "location": {
    "file": "server/resources/chains/release-prep/chain.yaml",
    "line": 3
  }
}
```

What the gate had: exit code `1`; validator stdout line
`Step 3 references unknown promptId 'run_smoke_tests'` (mirrors
`validateChainStepReferences`, `server/src/mcp/tools/resource-manager/prompt/utils/validation.ts:478-494`,
which emits exactly `Step ${i+1} references unknown promptId '${promptId}'`); chain `release-prep`,
step index 3 (1-based, matching the validator's own indexing).

## (b) LLM-judged code-quality finding — missing return statement

```json
{
  "id": "code-quality.missing-return-statement",
  "summary": "generated function 'formatSummary' has no return statement",
  "failure_scenario": "caller receives undefined instead of the formatted string; downstream string interpolation prints 'undefined'",
  "category": "attention-required",
  "verdict": "plausible",
  "probe": "grep -n 'function formatSummary' -A 15 <step-output> | grep -c 'return'",
  "location": { "file": null, "line": null }
}
```

`verdict: plausible` not `confirmed` because the judge has only prose reasoning against
`pass_criteria` (`required_patterns: [function, return]`,
`server/resources/gates/code-quality/gate.yaml`) — an LLM read, not an exit code. `location` is
present-but-null: the judge sees the response text, not a file path, so it cannot name a line: the
schema keeps the field rather than omitting it, so a reader can tell "not applicable" from "not
captured."

## (c) `server/src/engine/gates/module.yaml` extended

```yaml
schemaVersion: 1
id: engine-gates
kind: domain
lifecycle: canonical
description: Selects, enhances, and evaluates quality-gate guidance.
children: internal
owns:
  - "Gate normalization -> GateService"
  - "Gate enhancement -> GateEnhancementService"
  - "Gate selection -> GateManager"
  - "Gate verdict processing -> GateVerdictProcessor"
  - "Inline gate parsing -> InlineGateProcessor"
invariants:
  - id: engine-gates.verdict-index-in-range
    rule: "A per_gate entry's index always falls within [1, selected-gate-count] for the run it belongs to; an out-of-range index is rejected before GateVerdictProcessor applies it."
    verifiedBy: server/tests/unit/gates/services/gate-verdict-processor-action.test.ts
  - id: engine-gates.inline-gate-parse-idempotent
    rule: "Parsing the same inline gate block twice yields the same normalized gate id and criteria set; InlineGateProcessor never mints a second id for one block."
    verifiedBy: server/tests/unit/gates/services/inline-gate-registration.test.ts # hypothetical: covers registration, not re-parse idempotence today
```

Note: the matrix's "Gate enforcement mode" row names `resolveEnforcementMode`
(`execution/pipeline/decisions/gates/`), which is physically under `engine-execution`, not
`src/engine/gates` — excluded from `owns` on a directory-ownership reading. Left in would make
`owns` claim code this descriptor's `verifiedBy` path can't reach.

## Field counts

- Finding: 7 fields (`id`, `summary`, `failure_scenario`, `category`, `verdict`, `probe`,
  `location`) — `location` is a nested 2-field object, counted as one slot.
- Invariant: 3 fields (`id`, `rule`, `verifiedBy`).

## Self-score

- R1 Addressable — PASS. `<gate-id>.<slug>` and `<module-id>.<slug>` are author-minted, not
  positional; stable across reruns.
- R2 Re-derivable — PASS for (a) (probe + file + line reproduce it exactly). PARTIAL for (b):
  `probe` names a grep pattern but `<step-output>` is not a stored artifact, so re-derivation
  needs the response captured somewhere addressable — the schema assumes that capture exists and
  doesn't itself provide it.
- R3 Round-trips — PASS. `findings` is a new optional array sibling on `gateVerdictEntrySchema`;
  nothing existing renamed or removed. `owns`/`invariants` are new optional keys on
  `ModuleDescriptorDocumentSchema`, which is `.strict()` today — additive here means the real
  schema needs the two keys added, not just accepted by the sample.
- R4 Glanceable — PASS. `category` uses the owner's five preserve terms directly; `verdict`
  distinguishes exit-code ground truth from LLM prose without opening a file.
- R5 Minimal — PARTIAL. `location` earns its keep only for (a); (b) carries it as `null` rather
  than omitting it, which is a real field-with-no-reader on LLM-judged findings specifically.

## What this direction cannot express

A finding is scoped to ONE step's ONE gate run — it has no way to say "this same defect will
recur on every future step matching this shape," which is exactly the shaped-defect problem this
repo's own `dev-workflow.md` calls out (a fix at the sites you found is not a fix of the class).
Two identical dangling-promptId findings across two chains render as two unrelated findings with
two ids, because the id is `<gate-id>.<slug>`, not `<gate-id>.<shape-slug>.<occurrence>` — there is
no aggregation key. Adding one would cost a field with no reader until a second finding actually
arrives, which R5 argues against paying for up front.
