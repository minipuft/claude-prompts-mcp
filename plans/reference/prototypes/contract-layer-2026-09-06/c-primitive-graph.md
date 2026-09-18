---
title: "Direction C — Primitive Graph"
date: 2026-09-06
status: reference
tags: [prototype, contract-layer]
---

# Direction C — Primitive Graph

Four unit kinds, no more: `constraint` (rule, stable id), `observation` (what a gate measured,
typed `source`), `delta` (before/after of a property, only where a property is actually tracked),
`relation` (`subject --predicate--> object`, for structure and for `owns`). A `finding` is not a
fifth kind — it is a small object of _references_ into these four (D8 ids: findings
`<gate-id>.<slug>`, invariants `<module-id>.<slug>`). The human sentence is **rendered** from the
referenced units, never stored as the primary form.

## Sample (a) — shell_verify, chain-integrity validator

```
constraint:  { id: chain-integrity.promptid-resolves, ownerModule: engine-gates,
               statement: "a chain step's promptId must resolve to a registered prompt" }
relation:    { subject: chain:onboarding-flow, predicate: has-step, object: "step:onboarding-flow#3" }
relation:    { subject: "step:onboarding-flow#3", predicate: references, object: prompt:summarize-doc-v2 }
observation: { id: chain-integrity.obs-exit, source: { type: exit_code, value: 1 } }
observation: { id: chain-integrity.obs-line, source: { type: output_line,
               text: "ERROR: step 3 promptId 'summarize-doc-v2' not found in registry (chain: onboarding-flow)" } }
observation: { id: chain-integrity.obs-loc,  source: { type: file_line,
               path: "server/resources/chains/onboarding-flow/chain.yaml", line: 27 } }
delta:       n/a  # boolean resolvability check — no before/after property is tracked here
finding:     { id: chain-integrity.step3-promptid-unresolved,
               constraintId: chain-integrity.promptid-resolves,
               observationIds: [chain-integrity.obs-exit, chain-integrity.obs-line, chain-integrity.obs-loc],
               relationIds: [rel-has-step, rel-references] }
```

> Rendered claim (derived at read time, never stored): **[chain-integrity.promptid-resolves] FAILED**
> — chain `onboarding-flow` step 3 references promptId `summarize-doc-v2`, which is not a
> registered prompt (exit=1; `chain.yaml:27`).

## Sample (b) — LLM-judged code-quality

```
constraint:  { id: code-quality.required-pattern-return, ownerModule: engine-gates,
               statement: "code-category step output must contain a 'return' statement (gate.yaml pass_criteria[0].required_patterns)" }
relation:    { subject: "step:refactor-helper#2", predicate: evaluated-by, object: gate:code-quality }
observation: { id: code-quality.obs-judge, source: { type: judge_rationale,
               text: "The function defines logic but never returns a value; execution falls through implicitly.",
               criteriaRef: "code-quality.pass_criteria[0]" } }
delta:       { id: code-quality.delta-return, property: "pattern:return.matchCount",
               before: "required >=1 (gate.yaml)", after: "observed 0" }
finding:     { id: code-quality.step2-missing-return, constraintId: code-quality.required-pattern-return,
               observationIds: [code-quality.obs-judge], relationIds: [rel-evaluated-by],
               deltaId: code-quality.delta-return }
```

> Rendered claim: **[code-quality.required-pattern-return] FAILED** — step 2 (`refactor-helper`)
> has 0 occurrences of `return` (required >=1). Judge: "the function defines logic but never
> returns a value…"

## Sample (c) — `server/src/engine/gates/module.yaml` extended

```yaml
schemaVersion: 1
id: engine-gates
kind: domain
lifecycle: canonical
description: Selects, enhances, and evaluates quality-gate guidance.
children: internal
owns:
  - {
      subject: module:engine-gates,
      predicate: owns,
      object: capability:gate-normalization,
      via: GateService,
    }
  - {
      subject: module:engine-gates,
      predicate: owns,
      object: capability:gate-enhancement,
      via: GateEnhancementService,
    }
  - {
      subject: module:engine-gates,
      predicate: owns,
      object: capability:gate-selection,
      via: GateManager.selectGates,
    }
  - {
      subject: module:engine-gates,
      predicate: owns,
      object: capability:gate-verdict-processing,
      via: GateVerdictProcessor.handleGateAction,
    }
  - {
      subject: module:engine-gates,
      predicate: owns,
      object: capability:inline-gate-parsing,
      via: InlineGateProcessor.processInlineGates,
    }
invariants:
  - constraint:
      {
        id: engine-gates.selection-is-category-and-framework-scoped,
        statement: "selectGates() returns a gate only when activation.prompt_categories matches; framework-typed gates additionally require a framework match",
      }
    observation:
      {
        id: engine-gates.selection-test,
        source:
          {
            type: test,
            path: "server/tests/integration/gates/gate-category-selection.test.ts",
            status: real,
          },
      }
  - constraint:
      {
        id: engine-gates.verdict-action-single-entry-point,
        statement: "PASS/FAIL/retry/abort handling for a step always routes through GateVerdictProcessor.handleGateAction, including the no-authority fallback branch",
      }
    observation:
      {
        id: engine-gates.verdict-test,
        source:
          {
            type: test,
            path: "server/tests/unit/gates/services/gate-verdict-processor-action.test.ts",
            status: real,
          },
      }
```

`resolveEnforcementMode` (enforcement mode row) was deliberately excluded from `owns`: its owner
path is `execution/pipeline/decisions/gates/`, not `gates/` — a matrix row about gates that a
different module owns. Both test paths above are real files I read the header of, not hypothetical.

## Schema sketch

```ts
type Id = string; // "<namespace>.<slug>" — D8, author-minted, never positional

interface Constraint {
  kind: "constraint";
  id: Id;
  statement: string;
  ownerModule: string;
}
interface Observation {
  kind: "observation";
  id: Id;
  source:
    | { type: "exit_code"; value: number }
    | { type: "output_line"; text: string }
    | { type: "file_line"; path: string; line: number }
    | { type: "judge_rationale"; text: string; criteriaRef: string }
    | { type: "test"; path: string; status: "real" | "hypothetical" };
}
interface Delta {
  kind: "delta";
  id: Id;
  property: string;
  before: string;
  after: string;
}
interface Relation {
  kind: "relation";
  subject: string;
  predicate: string;
  object: string;
  via?: string;
}

interface Finding {
  id: Id; // "<gate-id>.<slug>"
  constraintId: Id;
  observationIds: Id[];
  relationIds?: string[];
  deltaId?: Id | "n/a";
}

// Additive only — {index, passed, rationale} unchanged (D5)
const gateVerdictEntrySchema = z.object({
  index: z.number().int().positive(),
  passed: z.boolean(),
  rationale: singleLineRationale,
  findings: z.array(FindingSchema).optional(),
});
```

## Field count per sample

(a) 7 units, constraint 4 + relation×2 (4 each) + observation×3 (4+4+5) + finding 5, delta n/a = **30 leaf fields**. (b) 5 units, constraint 4 + relation 4 + observation 5 + delta 5 + finding 5 = **23 leaf fields**. (c) new fields only: owns 5 relations×4=20, invariants 2×(constraint 4 + observation 5)=18 = **38 leaf fields**.

## Self-score

- R1 Addressable — **pass**: every constraint/observation/delta/finding carries an author-minted `<namespace>.<slug>` id; nothing is positional or per-run.
- R2 Re-derivable — **pass for (a) and (c), partial for (b)**: exit code / output line / file+line / test path are independently rerunnable. `judge_rationale` in (b) carries the criteria ref so a human can re-check the RULE, but the specific LLM judgment text is not independently reproducible — that gap is in the gate type, not the schema, but it is real.
- R3 Round-trips — **pass**: `findings` is a new optional array field; `{index, passed, rationale}` untouched. `owns`/`invariants` are new top-level keys on `module.yaml`, no existing key touched.
- R4 Glanceable — **pass, with a cost**: the raw unit set is NOT glanceable by itself — it is a graph meant for machines and cross-references. Every sample above ships a rendered sentence alongside it per the brief, and the direction only clears R4 if that rendering step is treated as mandatory, not optional, output.
- R5 Minimal — **fails as stated**: 23–38 fields per sample beats what a flat "sentence + probe" direction needs. No field is dead (each is read by the renderer or a cross-reference), but splitting `chain has-step` / `step references prompt` into two relation edges instead of one observation is a real minimality cost, paid for graph traversal this task never asked for.

## What this direction cannot express

A holistic, non-decomposable judgment — "this code is clever but fragile," or a rationale that
weighs several soft factors against each other and lands on a net call — does not have a natural
typed home. Forcing it into one `judge_rationale` observation just re-hides the sentence inside a
typed wrapper (the thing this direction exists to avoid); splitting it into several small
observations invents measurements that were never independently taken. The graph is also weak on
TREND: `delta` holds exactly one before/after pair, so "this has been degrading for three runs"
needs three deltas plus relations chaining them in run order — reconstructible, but the reader pays
a traversal cost the sentence form never charged. And confidence/uncertainty has no primitive of
its own under the four-kind cap; it has to ride inside an observation's `value`/`text`, which means
"uncertain" is not a first-class, filterable property of a finding the way `constraintId` is.
