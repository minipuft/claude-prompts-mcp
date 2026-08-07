---
title: "Semantic LLM Side-Client Retirement — Implementation Notes"
plan: plans/semantic-llm-sidecar-retirement-2026-08-05.md
date: 2026-08-05
status: reference
tags: [cleanup, gates, config]
---

# Implementation Notes

Deviations, discovered constraints, and re-measurements found while executing T1–T5.
Conservative option taken, logged, work continued — per `/unknowns` §During Implementation.

**Written late, and that is itself the first finding.** These notes were reconstructed after T5
from the tier records and commit messages, because no notes file was kept during execution. The
convention (five sibling plans carry one) and the rule that mandates it were both known and both
missed for eight tiers. What survived did so only because each tier wrote unusually long prose into
the plan file and the commit bodies; the deviations that were narrated in conversation and nowhere
else are gone. Recorded as **D0** below rather than quietly backfilled, because the failure mode —
"the log is the one artifact you skip when the work feels like it is going well" — is the reusable
part.

---

## Deviations

### D0 — No notes file existed until T5 was already committed

**Convention said**: keep `<plan>-implementation-notes.md` beside the plan, updated during
execution, logging each deviation as it happens.

**What happened**: eight tiers ran with the deviation log kept in conversation only. The plan file
absorbed some of it because each tier appended a long "what this tier actually found" section, so
the loss is partial rather than total — but every judgment that did not make it into a tier section
or a commit body is unrecoverable.

**Why it is a real cost, not bookkeeping**: this session was compacted mid-initiative. Anything
living only in conversation was destroyed at that boundary. The plan file and commits survived; the
notes would have too.

**Correction**: file created retroactively at T5, and `/knowledge-capture` — which had also not been
invoked once across the initiative — run at the same point.

### D1 — T1: the integration factory was deleted, not collapsed

**Plan said**: "delete or collapse" `modules/semantic/integrations/index.ts` (T0 to decide).

**Shipped**: deleted outright.

**What forced it**: once the LLM wiring went, `createConfiguredAnalyzer` reduced to
`createContentAnalyzer(logger, config)`, `createFromEnvironment` merged only `MCP_LLM_*` vars, and
`validateConfiguration` + `generateConfigurationGuide` had **zero callers repo-wide** — both were
pure LLM-setup advice. One external consumer, no tests. Collapsing would have produced a one-line
pass-through wrapper, which is a file to trace rather than a file to read.

### D2 — T1 removed a log line the plan had assigned to T3

**Plan said**: T3.3 removes the `analyzerMode` log line.

**Shipped**: T1 removed it.

**What forced it**: the line printed `'semantic' : 'minimal'` based on a flag whose client T1 had
just deleted. It became a **falsehood the moment T1 landed** — it would print "semantic" when no
client could exist. The tier that introduces a lie owns removing it, regardless of which tier the
plan assigned it to. Verified in the runtime log rather than inferred from a green build.

### D3 — T2.5 was invented mid-execution; it was not in the plan

`GateEnhancementResult.validationResults` had live readers and zero producers. Deleting
`SemanticGateService` (T2) removed the last thing that could ever have written it.

**Not folded into T2**: it touched two files outside T2's Files column and changed an emitted metric
shape — a different unit of review from deleting an unreachable service. Given its own tier number
so the diff and its gate stayed legible.

**The decision it needed first**: zero writers admits two readings — missing producer, or redundant
channel. Settled by checking where the replacement routes: `%judge` returns verdicts through
`gate_verdict` → `GateVerdictProcessor`, never through this channel. Redundant, therefore delete.
Keeping it would have meant retaining a seam whose filling evidence nobody could name, which
`cleanup-standards.md` calls a permanent bypass wearing a temporary label.

### D4 — T3.5 and T3.6 did not exist in the plan either

Both were operator-requested mid-flight. T3.5 (retire `isLLMEnabled`, narrow `mode`) had a hard
prerequisite the plan had not seen: `mode` could not narrow while the dead
`FrameworkSemanticIntegration` compared against `'semantic'` in five places. So an 863-line module
deletion (F10) became the _blocking_ item for a two-line type narrowing.

### D5 — T4 shipped only half of what its own finding listed

F11's retirement list bundled the `ContentAnalyzer` plumbing together with `AnalysisConfig` /
`SemanticAnalysisConfig` / `LLMIntegrationConfig` under one trigger. They are not one trigger: the
parser still reads the three types, and the section stays parsed for a deprecation cycle.

**What forced the split**: T4 published — in `CHANGELOG.md`, in `config.schema.json` as
`"deprecated": true`, and in a startup warning — that the section is removed _in the next major_.
Executing the bundled list would have falsified a notice shipped the same week.

---

## Re-measurements that contradicted the plan

| Plan claim                                         | Measured                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| "5 MCP tool keys, 1 CLI key"                       | **4** MCP keys (never `endpoint`), **5** CLI keys — wrong in both directions |
| T3 rename "touches four call sites"                | **six** src importers + four test files                                      |
| `types.ts` holds the LLM plumbing (T1.3)           | it held only `LLMClient`; the real removal was the analyzer's branch (T3)    |
| `GateValidator.getRetryHints` exists (F9)          | it does not — only `LightweightGateSystem` defined it, and standalone        |
| `StepResult.validationResults` has no writers (F9) | the **whole interface** had no consumers; the field was not the unit         |
| F13 is "three types in a closed loop"              | **ten**, plus an eleventh orphaned by the F9 commit                          |

**The pattern**: line-number citations in the plan were accurate; prose counts were not. Re-measure
the counts, trust the coordinates.

---

## Discovered constraints

### C1 — Three homonyms nearly mis-scoped three deletions

| Symbol                 | The trap                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GateValidationResult` | T2.5 deleted one; a **live, unrelated** one exists in `prompt-engine/utils/validation.ts`. It was on the first draft of the new guard's forbidden list |
| `validationResults`    | dead in gates; **live, written and tested** in `argument-parser.ts`                                                                                    |
| `GateStatus`           | looked live to a first scan only because a duplicate definition exists in `engine/gates/types.ts`                                                      |

A name-keyed dead-code check was wrong **three times out of three**. Only walking edges to their end
worked. Any future sweep here should assume the name is ambiguous until proven otherwise.

### C2 — A comment naming the retired thing fails the guard that retires it

Three separate times, a comment written to _explain_ a removal named the removed symbol and failed
either the tier's own `rg` check (T2, T4) or `validate-no-llm-client` (F11/F13). Each was reworded
to describe current behaviour rather than history — which `cleanup-standards.md` wanted anyway, and
which makes the check pass honestly instead of by exemption.

### C3 — `typecheck` cannot see what `lint:ratchet` and the tests ratchet see

- Two whitespace defects from `String.replace` block deletions passed `typecheck` and were caught by
  `lint:ratchet` (`prettier/prettier` 0→1, then 0→2). TypeScript does not read indentation.
- An untyped `jest.fn()` whose `mock.calls[0]` is a zero-length tuple was caught only by
  `typecheck:tests:ratchet` — `tsconfig.json` excludes `tests/`.

Neither would have reached a human reviewer; both would have reached CI.

### C4 — Behaviour-preserving changes need tests that pass BEFORE the change

Used at T3.6 (icon collapse), F9 (retry hints), F13/F11 (deprecation warning). An assertion that
only passes afterward proves nothing about a change that is supposed to alter nothing. The
invariance is the property; falsification then proves the assertion can still fail.

### C5 — A one-time bump exclusion and a deprecation notice are both promises with expiry dates

`validate-no-llm-client`'s allowlist exists solely for the deprecated config plumbing, and carries a
satisfied-exception check so an entry that outlives its justification is reported as a finding
rather than passing silently. **Writing that check found a bug in the guard**: a deleted allowlisted
file made it crash on `rg` exit 2 instead of reporting staleness — and a deleted plumbing file is
precisely what happens at the guard's own retirement event.

### C6 — Another session committed this work under an unrelated message

T1–T3.5 sat uncommitted long enough to be swept into `b4171ca8`
("chore(server): land the 3.1.2 release preparation orphaned by a crashed session") by a concurrent
session's broad `git add`. The deletion of the client, the gate service, and the 863-line module is
therefore in history under a `chore` labelled as release prep.

**Operational consequence**: in a shared worktree, `git add -A` is never safe, and _staging_ is not
safe either — at F9 the other session's staged deletion appeared in my index without my adding it,
and had to be unstaged before committing. Stage by name; check `git diff --cached` before every
commit.
