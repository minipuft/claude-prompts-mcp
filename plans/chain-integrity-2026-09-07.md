---
title: "A chain step that names an unregistered prompt is refused at write, reported at load, and failed in CI"
date: 2026-09-07
status: active
tags: [chains, resources, validation, contracts]
---

# Chain Integrity — one resolver, three boundaries

## Defect

A chain step whose `promptId` resolves to nothing is accepted today and fails one run later, far
from the write that introduced it.

| Boundary              | Today (measured 2026-09-06/07)                                                                                                                                                                                                                       | Site                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource write        | `validateChainStepReferences` returns **warnings**; its docstring says non-blocking by design; it **skips any id containing `/`**, which `PROMPT_ID_PATTERN` (`/^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)*$/`) makes the canonical form for a sub-prompt | `server/src/mcp/tools/resource-manager/prompt/utils/validation.ts:475-497`, called at `prompt-lifecycle-processor.ts:401-407`, surfaced as warnings at `:198` and `:568`                            |
| Resource load         | `validatePromptYaml` rejects a missing **edge endpoint** or a cycle among a chain's own step ids; nothing checks that a step's `promptId` is registered                                                                                              | `server/src/modules/prompts/yaml-prompt-loader.ts:393-470`                                                                                                                                          |
| CI (bundled tree)     | `validate:prompts` checks id canonicality only                                                                                                                                                                                                       | `server/scripts/validate-prompts.ts`                                                                                                                                                                |
| Runtime               | four throw sites report "converted prompt data not found for chain step"; one warns                                                                                                                                                                  | `execution-planner.ts:203`, `symbolic-command-builder.ts:165,259`, `04-parsing-stage.ts:292`, `chain-operator-executor.ts:397`                                                                      |
| Workflow IR (per-run) | already answers the same question with reason `unknown-prompt` through an injected `lookupPrompt`                                                                                                                                                    | `server/src/modules/workflow-ir/validator.ts:35`; `lookupPrompt` is constructed separately at `remainder-processor.ts:192`, `symbolic-command-builder.ts:315`, `workflow-command-builder.ts:83,105` |

Two derivations of one question ("does this prompt id resolve?") exist and disagree about
nested ids. The memory `project_chain_management_tooling` lists this as gap 4 and lists sub-prompt
scaffolding (gap 3) as open; `scaffoldChainStepDirectories` exists at `file-operations.ts:350`,
so gap 3 must be re-measured before any row assumes ordering constraints.

## Rulings (owner, 2026-09-06 · ledger `plans/contract-layer-2026-09-06.md` D1, D1a–c)

- **R1** One resolver, three boundaries. One registry-backed lookup answers "does this id resolve", and write, load, and CI all call it. The workflow-IR validator keeps its injected `lookupPrompt` but receives the same function.
- **R2** Write **refuses**. Defect fix with a provably correct target: the warning path and the `/` skip are deleted in the same change (no parity gate).
- **R3** Load **reports, does not silently load**: one structured warning per broken chain naming chain, step index, and the unresolved id. The chain still loads; the existing runtime throws remain the refusal for in-process callers.
- **R4** CI resolves against the bundled tree only (`server/resources`); overlay chains are validated at load, where the overlay is visible.
- **R5** An e2e flow that creates a parent chain before its steps changes to scaffold steps first. The test moves, not the rule.
- **R6** The four runtime throw sites stay as last-line asserts.

## Rows

Status vocabulary: `☐ (as of <date> · flips when <observation>)` · `✓ <date> · <receipt>` · `⊘ (verified <date> · <reason>)` · `✗ KILLED (<date> · <reason> · revives if <observation>)`.

### Tier 0 — re-measure before design lands

| Row | Status                                                                                                | File(s)                                                           | Change                                                                                                                                                                                                    | Depends | Verify                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| 0.1 | ☐ (as of 2026-09-07 · flips when the registry id form of a sub-prompt is written here)                | `server/src/modules/prompts/registry.ts`, `yaml-prompt-loader.ts` | Record how a sub-prompt is keyed in the registry (`parent/step`? bare `step`?) and whether a step's `promptId` in `chain_steps` is stored canonical or bare                                               | —       | `node -e` against `dist/` or a unit probe: create a chain via the loader fixture, print registered ids  |
| 0.2 | ☐ (as of 2026-09-07 · flips when gap 3 is marked closed or open with evidence)                        | memory `project_chain_management_tooling`                         | Re-measure sub-prompt scaffolding: does a `resource_manager create` with `chain_steps` create the step directories in the same call (`file-operations.ts:350`)? Update the memory's gap 3 line either way | —       | `tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts` cases naming scaffold |
| 0.3 | ☐ (as of 2026-09-07 · flips when the list of tests that write a chain before its steps is here)       | `tests/integration/**`, `tests/e2e/**`                            | Enumerate every test that creates a chain whose steps do not yet exist (`rg -l "chain_steps" tests/integration tests/e2e` then read each) — R5 input                                                      | —       | list in this row's receipt                                                                              |
| 0.4 | ☐ (as of 2026-09-07 · flips when each `lookupPrompt` site is classified same-derivation or different) | the four `lookupPrompt` sites above                               | Classify each: a thin lambda over the converted-prompt map (migrate in 3.2) or a different derivation (leave, say why)                                                                                    | —       | table in receipt                                                                                        |

### Tier 1 — the resolver and the write boundary

| Row | Status                                                                                                       | File(s)                                                                                   | Change                                                                                                                                                                                     | Depends  | Verify                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ☐ (as of 2026-09-07 · flips when `resolveChainStepPromptId` exists with a unit test)                         | `server/src/modules/prompts/` (new pure fn beside the registry, name it for the behavior) | One function `(promptId, registeredIds) → resolved \| unresolved` that handles bare and `parent/step` ids per 0.1. No I/O, no logger                                                       | 0.1      | `test:match -- chain-step-resolve`: bare id, nested id, unknown id, malformed id                                           |
| 1.2 | ☐ (as of 2026-09-07 · flips when the `/` skip and the "Non-blocking" docstring are gone)                     | `validation.ts:475-497`                                                                   | `validateChainStepReferences` uses 1.1, returns problems (not warnings), no `/` exemption; delete the docstring sentence that promised non-blocking                                        | 1.1      | `rg -n "includes\('/'\)" validation.ts` → 0; unit test: nested unknown id is a problem                                     |
| 1.3 | ☐ (as of 2026-09-07 · flips when a create/update with a dangling step returns a refusal, not a saved prompt) | `prompt-lifecycle-processor.ts:198,401-407,568`                                           | Refuse the write with one addressed line per problem (`step N references unknown promptId 'x'`), nothing written; delete the `chainIntegrityWarnings` plumbing (R2)                        | 1.2, 0.2 | `prompt-lifecycle-processor.test.ts`: create + update + `chain_step_operation: add` each refuse; a valid chain still saves |
| 1.4 | ☐ (as of 2026-09-07 · flips when the positive control is a committed test)                                   | `tests/integration/resource-manager/**`                                                   | Integration test: `resource_manager create` with one dangling step → refused with the step index; same call with the step scaffolded → succeeds. Any test found in 0.3 is reordered per R5 | 1.3, 0.3 | `npm run test:integration`                                                                                                 |

### Tier 2 — load diagnostic and CI

| Row | Status                                                                                          | File(s)                                                                                                 | Change                                                                                                                              | Depends | Verify                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | ☐ (as of 2026-09-07 · flips when a broken bundled chain logs one structured warning at startup) | `registry.ts` load completion (after every prompt is registered)                                        | Run 1.1 over every chain; `logger.warn` once per chain with `{chainId, stepIndex, promptId}` (R3). No new state, no refusal at load | 1.1     | start the server with a fixture chain whose step is dangling → one warning line; `verify:mcp` still 18/18                     |
| 2.2 | ☐ (as of 2026-09-07 · flips when `validate:prompts` fails on a dangling bundled step)           | `server/scripts/validate-prompts.ts`                                                                    | After id canonicality, resolve every chain step against the bundled tree using 1.1 (R4); one addressed line per problem             | 1.1     | `npm run validate:prompts` on the tree → OK; positive control: temporarily rename a bundled step dir → FAIL naming it; revert |
| 2.3 | ☐ (as of 2026-09-07 · flips when the self-test asserts the failing case)                        | `validate-prompts.ts` `--self-test` (add if absent, sibling: `validate-semantic-module-descriptors.ts`) | Fixture with one dangling step must FAIL by message; a valid fixture must pass                                                      | 2.2     | `tsx scripts/validate-prompts.ts --self-test`                                                                                 |

### Tier 3 — runtime sites and sibling derivations

| Row | Status                                                                                             | File(s)                                                                                      | Change                                                                                                                           | Depends  | Verify                                                                                          |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| 3.1 | ⊘ (verified 2026-09-07 · R6: the four throw sites are the in-process assert and stay; no edit)     | `execution-planner.ts:203`, `symbolic-command-builder.ts:165,259`, `04-parsing-stage.ts:292` | none                                                                                                                             | —        | —                                                                                               |
| 3.2 | ☐ (as of 2026-09-07 · flips when every same-derivation site from 0.4 calls 1.1)                    | sites classified same-derivation in 0.4                                                      | Replace the lambda with 1.1 so there is one derivation; different-derivation sites get a one-line comment naming why             | 0.4, 1.1 | `rg -n "lookupPrompt" server/src` → each site either calls the shared fn or carries the comment |
| 3.3 | ☐ (as of 2026-09-07 · flips when `chain-operator-executor.ts:397` throws or is proven unreachable) | `chain-operator-executor.ts:397`                                                             | Today it `warn`s where the other four throw. Decide: throw like its siblings, or ⊘ with the reason it cannot reach a dangling id | 3.2      | unit test or receipt                                                                            |

### Tier 4 — docs, changelog, memory, full validation

| Row | Status                                                                                                      | File(s)                                                            | Change                                                                                                                                                                  | Depends       | Verify                                            |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------- |
| 4.1 | ☐ (as of 2026-09-07 · flips when both docs describe refusal at write)                                       | `docs/concepts/chains-lifecycle.md`, `docs/reference/mcp-tools.md` | State current behavior only: a chain step must name a registered prompt; the write is refused otherwise; startup warns for bundled/overlay chains; CI checks the bundle | 1.3, 2.1, 2.2 | `rg -n "refus" docs/concepts/chains-lifecycle.md` |
| 4.2 | ☐ (as of 2026-09-07 · flips when `[Unreleased] → Fixed` carries the entry)                                  | `CHANGELOG.md`                                                     | Consumer voice: "resource_manager refuses a chain whose step names an unregistered prompt; it previously saved it with a warning and the run failed at that step"       | 1.3           | `rg -n "unregistered prompt" CHANGELOG.md`        |
| 4.3 | ☐ (as of 2026-09-07 · flips when gaps 3 and 4 in the memory are both terminal)                              | memory `project_chain_management_tooling`                          | Gap 4 closed with the commit; gap 3 per 0.2; `holds_while` re-pointed at a probe that measures gap 4 (`rg -q "includes\('/'\)" validation.ts` must FAIL)                | 0.2, 1.3      | memory-search `--stale` clean                     |
| 4.4 | ☐ (as of 2026-09-07 · flips when the full suite, all three test tiers, and `verify:mcp` pass on the branch) | —                                                                  | `npm run validate:all && npm run test:all && npm run verify:mcp` in the worktree                                                                                        | all           | command output in receipt                         |

## Execution dispatch

- Worktree from `origin/main` via `npm run worktree:create -- ../claude-prompts-mcp-chain fix/chain-integrity --from origin/main` after #266 and the frontmatter fix merge.
- Tier 0 is measurement; its receipts are the inputs to 1.1 and 1.3. Do not start Tier 1 without 0.1 and 0.2.
- One commit per tier is the floor; 1.2+1.3+1.4 may be one commit (behavior + its test + its refusal message cannot be reverted apart).
- PR type `fix(resources)`; title names the outcome ("a chain step that names an unregistered prompt is refused at write").

## Completion criteria

| Criterion                                                | Validation                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A dangling step is refused at write, nested ids included | 1.4 integration test                                                                 |
| A dangling bundled step fails CI                         | 2.2 positive control + 2.3 self-test                                                 |
| Startup names every broken chain once                    | 2.1 fixture run                                                                      |
| One derivation of "does this id resolve"                 | 3.2 grep receipt                                                                     |
| Tool surface, schema, tarball unchanged                  | `git diff origin/main -- server/src/mcp/contracts tooling` empty; `verify:mcp` 18/18 |
| Docs and changelog describe current behavior only        | 4.1, 4.2                                                                             |

## Risks

- **A client that authors parent-then-steps.** If 0.2 shows scaffolding does NOT create steps in the same call, R2 breaks that authoring order. Then the refusal must exempt steps the same call scaffolds, and this plan gains a row before 1.3. Decide on 0.2's evidence, not in advance.
- **Overlay chains referencing bundled prompts.** R4 keeps CI blind to them by design; 2.1 is the only check that sees the overlay. Verify 2.1 runs after overlays merge, not before.
- **Nested id form.** If 0.1 shows the registry keys sub-prompts differently from `chain_steps`, 1.1 must normalize both sides; a mismatch there would make the refusal fire on every valid chain.

## Sources

- Ledger: `plans/contract-layer-2026-09-06.md` (D1, D1a–c, D13, D14)
- Prototype samples (shape of a finding, not in scope here): `plans/prototypes/contract-layer-2026-09-06/`
- Memory: `project_chain_management_tooling` (gaps 3–4), `reference_chain_execution_internals`
