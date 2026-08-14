---
title: "P7 — Resource authoring efficiency: implementation notes"
date: 2026-08-12
status: reference
tags:
  [adaptive-chain-runtime, resource-manager, versioning, implementation-notes]
---

# P7 — Implementation Notes

**Plan**: `adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md`
**Master plan**: `adaptive-chain-runtime-2026-08-09.md` §P7

This file is the sibling deviation log. It owns what the plan file must not carry: full ruling
rationales, per-tier deviation rows (`DEV-T<tier>-<n>`), and the validation ledger. The plan file
owns tier tables, open questions and findings.

Created before the first edit, per the deviation-log-has-no-gate lesson — nothing checks that this
file exists, so it is created at planning time rather than at execution time.

## Rulings

No open question has been ruled yet. All seven (OQ-P7-1 … OQ-P7-7) are OPEN in the plan file with a
recommended default and at least one alternative. The planning agent deliberately did not self-rule:
rulings belong to the main thread, which reviews the plan, decides, and records each ruling here
with its rationale before dispatching the tier that the question precedes.

When a question is ruled, add a subsection below and flip its plan-file status to
`RULED → notes §Rulings`.

| Id      | Precedes     | Ruling    | Date | Rationale |
| ------- | ------------ | --------- | ---- | --------- |
| OQ-P7-1 | Tier 3       | _pending_ | —    | —         |
| OQ-P7-2 | Tier 1       | _pending_ | —    | —         |
| OQ-P7-3 | Tier 2 (2.4) | _pending_ | —    | —         |
| OQ-P7-4 | Tier 4       | _pending_ | —    | —         |
| OQ-P7-5 | Tier 1 (1.4) | _pending_ | —    | —         |
| OQ-P7-6 | Tier 2 (2.3) | _pending_ | —    | —         |
| OQ-P7-7 | Tier 5       | _pending_ | —    | —         |

## Deviations

Log format: one row per deviation, id `DEV-T<tier>-<n>`. Record what the plan authored, what was
measured, and which option was taken. Conservative option, log it, keep going.

| Id       | Tier    | Authored                                                                                                                                                                                                                                                 | Measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | 1 (1.6) | Row 1.6 verify: "tests fail on `git stash` of 1.1/1.4, pass after"                                                                                                                                                                                       | The worker is barred from `git stash`/`git checkout` — the tree carries four other parties' uncommitted work                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Falsified by reverting the worker's own hunks with `Edit`, running the suite, then restoring and proving byte-identity with `md5sum`. Both hunks produced disjoint failure sets (1.1 → 6 schema tests, 1.4 → 5 preservation tests, one per field); all three source files restored to their pre-falsification md5                                                                                                                                                                                                                                                                                                                                 |
| DEV-T1-2 | 1 (1.1) | Row 1.1 enumerates four changes — `required`, `defaultValue`, `type` narrowing, `type`/`description` optional — under the instruction "mirror `PromptArgumentSchema`"                                                                                    | `PromptArgumentSchema` declares SIX fields. `validation` was stripped by the same bare `z.object()` and is not in the plan's enumeration or its §Interfaces block. It is also load-bearing beyond parity: `ArgumentParser.enrichResult` runs schema validation — the only path that throws on a missing required argument — ONLY when some argument declares `minLength`/`maxLength`/`pattern`. With `validation` unsettable, a tool-authored `required: true` had no reachable enforcement path at all                                                                   | Included `validation: ArgumentValidationSchema.optional()`, taking the row's stated instruction over its illustrative enumeration. Additive union member, non-breaking per the Public API Contract. One line in the schema, one in `core/types.ts`, one type-string in the contract — revertible independently if the main thread rules the narrower reading                                                                                                                                                                                                                                                                                      |
| DEV-T1-3 | 1 (1.4) | Row 1.4: "extend the written key set to cover `injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`; preserve-if-present, never write defaults" — implying the values come from `promptData` (i.e. the loaded `ConvertedPrompt`) | `ConvertedPrompt.registerWithMcp` and `.mcpPromptMode` are ALWAYS populated: `PromptConverter.resolveRegisterWithMcp` / `resolveMcpPromptMode` resolve prompt → category → global → hard-coded default. Carrying them from the loaded prompt would materialise an inherited default into a file that never declared one, freezing that prompt against any later change to the default — the exact failure "never write defaults" forbids. `injection` has a milder form of the same hazard (the loaded value is normalised, so writing it back churns the authored shape) | Preservation reads the ON-DISK `prompt.yaml` (pre-mutation, inside the transaction's `mutate`) instead of the loaded prompt. `promptData` still wins when it carries an explicit value, so Tier 2.2's rollback-through-the-same-write-model works unchanged. Correct for all five fields with one source, and the two hazard fields are the reason the source had to move                                                                                                                                                                                                                                                                         |
| DEV-T1-4 | 1 (1.5) | Row 1.5: "add merge entries for any 1.4 field that must be settable through `update`"                                                                                                                                                                    | Zero of the five have a tool parameter — the input schema exposes no `injection`/`registerWithMcp`/`mcpPromptMode`/`subagentModel`/`agentType`, and the plan's §Interfaces block adds none. A `UPDATE_FIELDS` entry keyed on an argument that can never arrive is inert code                                                                                                                                                                                                                                                                                              | No merge entries added; `UPDATE_FIELDS` is unchanged. The row's verify ("merge map covers every settable YAML field") is discharged instead by a partition invariant in `argument-contract.test.ts`: every field the writer emits is settable via `UPDATE_FIELDS`, preserved via `PRESERVED_PROMPT_YAML_KEYS`, or one of two named exceptions (`id` is an address, `tools` is read straight off `args.tools` by both paths). A sixth field added to the writer with no home now fails a test. **Consequence for the main thread**: these five remain authorable only by hand, which the project's MCP-tooling-only constraint forbids — see P7-F7 |

## Validation Ledger

One row per gate run, with the exact command and the counts it produced, so a later reader can tell
a real green from a remembered one.

| Date       | Tier | Command                                                                                                                                | Result                                                                                                                                                                      |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | 1    | `npm run typecheck`                                                                                                                    | clean, no output                                                                                                                                                            |
| 2026-08-12 | 1    | `npm run validate:contracts`                                                                                                           | `[generate-contracts] Complete` — `_generated/resource_manager.generated.ts` in sync (3 insertions, 2 deletions from the 1.2 regeneration; no other generated file touched) |
| 2026-08-12 | 1    | `npm run lint:ratchet`                                                                                                                 | `OK: 3199 errors, 1016 warnings (no regressions)`                                                                                                                           |
| 2026-08-12 | 1    | `npm run typecheck:tests:ratchet`                                                                                                      | `OK: 377 errors in tests/ (no regressions)`                                                                                                                                 |
| 2026-08-12 | 1    | `npm run test:match -- "resource-manager\|prompt-schema"`                                                                              | 10 suites / 120 tests passed                                                                                                                                                |
| 2026-08-12 | 1    | `npx jest tests/unit` (beyond the tier gate — the schema is registered with MCP, so the blast radius is wider than the gate's pattern) | 183 suites / 2274 tests passed                                                                                                                                              |
| 2026-08-12 | 1    | falsification: 1.1 hunk reverted via `Edit`                                                                                            | 6 failures, all in `argument-contract.test.ts`; the five preservation tests stayed green                                                                                    |
| 2026-08-12 | 1    | falsification: 1.4 hunk reverted via `Edit`                                                                                            | 5 failures, one per preserved field; the schema tests stayed green                                                                                                          |
| 2026-08-12 | 1    | `md5sum` on all three changed source files, before and after falsification                                                             | identical (`ad2e961d…`, `3ae2e402…`, `ff5e5edb…`)                                                                                                                           |

## Findings raised during Tier 1 execution

- **P7-F6 — `required` enforcement is armed by an unrelated field, and is otherwise dead.**
  `ArgumentParser.enrichResult` (argument-parser.ts:713) computes `hasValidationRules` from
  `minLength`/`maxLength`/`pattern` and runs `ArgumentSchemaValidator.validate` — which throws
  `ArgumentValidationError` on a missing required argument — ONLY when that is true. A prompt
  declaring `required: true` and no `validation` block gets no enforcement at all. The parallel
  channel does not save it: `createValidationResults` (:645) does emit a
  `REQUIRED_ARGUMENT_MISSING` result, but `rg` across `src/` finds ZERO readers of
  `validationResults` outside the file that produces it, and `chain-operator-executor.ts:1002`
  only `logger.warn`s. This is the mechanism behind §"Chain friction observed during this planning
  run" item 1 — the P7 planning chain rendered its own declared-`required` `feature` argument as
  empty and ran all five steps anyway. Tier 1 makes `validation` settable through the tool, which
  gives the enforcement path a reachable switch for the first time, but does NOT make `required`
  self-enforcing. Fixing that is an ENGINE-layer change (`enrichResult`'s guard, or a reader for
  `validationResults`) and was deliberately not attempted: out of tier, and `src/engine/` was
  occupied by a concurrent worker.
- **P7-F7 — five prompt-level YAML fields are unauthorable through the tool.** `injection`,
  `registerWithMcp`, `mcpPromptMode`, `subagentModel` and `agentType` now SURVIVE an update but
  still cannot be SET by one: the input schema exposes no parameter for any of them (see DEV-T1-4).
  The only way to author them is a direct file edit, which the project's MCP-tooling-only
  constraint forbids. Adding five optional parameters is an additive union member and therefore
  non-breaking, but it is a Public API surface decision the plan did not author — it belongs to the
  main thread, not to a Tier 1 worker.

## Standing hazards for every worker brief

Copy these into each tier brief verbatim.

1. **ripgrep ignore artifact** — the shell's `grep` resolves to ripgrep, which honors `.gitignore`.
   Any probe over `server/resources/prompts/` silently omits 103 of 131 prompts unless `--no-ignore`
   is passed. Measured 2026-08-12: `rg -l "required: true"` → 0, `rg -l --no-ignore "required: true"`
   → 45.
2. **Foreign-dirty file** — `server/resources/prompts/.gitignore` carries another session's
   uncommitted diff (adding `documentation/` and `development/` allow-entries). Additive edits only;
   do not reformat or reorder. Tier 4 edits detection code, never this file.
3. **Tree-state correction** — the P7 charter warned that `resource-manager/core/types.ts` and
   `prompt/operations/file-operations.ts` were foreign-dirty. Measured 2026-08-12: both are CLEAN
   (the concurrent session landed in `c07a80c1` / `3073dfd4` / `f1bb548e` / `5ce70a71`). They may be
   edited normally.
4. **Durable table** — `version_history` holds rollback snapshots nothing regenerates. Tier 2 work
   must respect `.claude/rules/sqlite-persistence.md`: snapshot/restore by column intersection, no
   engine-resident one-time migration code, and a `NOT NULL` column with no default makes the
   restore throw by design.
5. **MCP tooling only** — prompt resources are edited through `resource_manager`, never by direct
   file write. This binds Tier 5 in particular.

## Validation runs

- 2026-08-13 03:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20 && echo "=== TYPECHECK DON` · ran
- 2026-08-13 03:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:all 2>&1 | tail -55` · ran
- 2026-08-13 03:43 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:all 2>&1 | tail -150` · ran
- 2026-08-13 03:41 · `cd /home/minipuft/Applications/claude-prompts-mcp git add plans/adaptive-chain-runtime-2026-08-09-implementation-notes.m` · ran
- 2026-08-13 03:39 · `cd /home/minipuft/Applications/claude-prompts-mcp git commit -m "$(cat <<'EOF' fix(scripts): widen eslint ratchet target` · ran
- 2026-08-13 03:39 · `cd /home/minipuft/Applications/claude-prompts-mcp git add server/scripts/eslint-ratchet.js server/.eslint-ratchet-baseli` · ran
- 2026-08-13 03:39 · `cd /home/minipuft/Applications/claude-prompts-mcp git commit -m "$(cat <<'EOF' docs(docs): documentation governance poli` · ran
- 2026-08-13 03:34 · `cd /home/minipuft/Applications/claude-prompts-mcp git status --porcelain=v1 -- server/eslint-rules server/eslint.config.` · ran
- 2026-08-13 03:33 · `cd /home/minipuft/Applications/claude-prompts-mcp git diff --stat server/.eslint-ratchet-baseline.json echo "---" git di` · ran
- 2026-08-13 03:33 · `cd /home/minipuft/Applications/claude-prompts-mcp git log --oneline -5 -- server/scripts/eslint-ratchet.js echo "---base` · ran
- 2026-08-13 03:33 · `cd /home/minipuft/Applications/claude-prompts-mcp rg -n "eslint-ratchet|ESLINT_TARGETS|scripts, eslint-rules|4\.5" plans` · ran
- 2026-08-13 03:33 · `cd /home/minipuft/Applications/claude-prompts-mcp rg -l "validate-hook-registration|require-guard-mechanism-verdict|requ` · ran
- 2026-08-13 03:33 · `cd /home/minipuft/Applications/claude-prompts-mcp echo "=== validate-hook-registration.js diff ===" git diff scripts/val` · ran
- 2026-08-13 03:26 · `git status --porcelain -- server/.eslint-ratchet-baseline.json echo "rc=$?" git log --oneline -3 -- server/.eslint-ratch` · ran
- 2026-08-13 03:26 · `git show HEAD -- server/.eslint-ratchet-baseline.json | head -5 echo "---diff now---" git diff HEAD -- server/.eslint-ra` · ran
- 2026-08-13 03:22 · `git diff HEAD -- server/scripts/eslint-ratchet.js server/scripts/run-validation-suite.js server/scripts/validate-require` · ran
- 2026-08-13 03:15 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --write plans/adaptive-chain-runtime-2026-08-09.md pla` · ran
- 2026-08-13 03:00 · `(npm run validate:all && npm run validate:arch && npm run validate:contracts && npm run validate:table-contracts && npm ` · ran
- 2026-08-13 02:59 · `npm run test:e2e -- claims-conformance 2>&1 | grep -E "Tests:|Test Suites:|✕" | head -5` · ran
- 2026-08-13 02:58 · `npx jest tests/e2e/claims-conformance.test.ts 2>&1 | head -25` · ran
- 2026-08-13 02:58 · `cd server && npx jest tests/e2e/claims-conformance.test.ts 2>&1 | grep -E "Tests:|Test Suites:|✕" | head -5` · ran
- 2026-08-13 02:57 · `npm run test:e2e > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/` · ran
- 2026-08-13 02:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -iE "jest|node .*test" | grep -v grep | head -` · ran
- 2026-08-13 02:40 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'EOF' ## Tier 6 — main-thread ac` · ran
- 2026-08-13 02:34 · `npm run test:match -- "p6-acceptance|p6-workflow-ir" 2>&1 | tail -6` · ran
- 2026-08-13 02:34 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep | head -3; npm run type` · ran
- 2026-08-13 02:33 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; echo "===TYPECHECK==="` · ran
- 2026-08-13 02:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -3` · ran
- 2026-08-13 02:32 · `npx --prefix server prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md 2>&1` · ran
- 2026-08-13 02:32 · `npx --prefix server prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md 2>&1` · ran
- 2026-08-13 02:31 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'NOTES' ## Row 6.1 — acceptance ` · ran
- 2026-08-13 02:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:format 2>&1 | tail -10` · ran
- 2026-08-13 02:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check ../plans/adaptive-chain-runtime-p6-work` · ran
- 2026-08-13 02:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; echo "===TYPECHECK==="` · ran
- 2026-08-13 02:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5 && npm run lint:ratchet 2>&` · ran
- 2026-08-13 02:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; timeout 150 npm run te` · ran
- 2026-08-13 02:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write tests/integration/chain/p6-acceptance.i` · ran
- 2026-08-13 02:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint tests/integration/chain/p6-acceptance.integration` · ran
- 2026-08-13 02:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 400 npm run lint:ratchet 2>&1 | tail -20` · ran
- 2026-08-13 02:29 · `cat > /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/p6` · ran
- 2026-08-13 02:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 400 npm run typecheck:tests:ratchet 2>&1 | tail -20` · ran
- 2026-08-13 02:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 400 npm run typecheck 2>&1 | tail -40` · ran
- 2026-08-13 02:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; echo "sibling-check-do` · ran
- 2026-08-13 02:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; timeout 150 npm run te` · ran
- 2026-08-13 02:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; timeout 150 npm run te` · ran
- 2026-08-13 02:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; timeout 150 npm run te` · ran
- 2026-08-13 02:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:format 2>&1 | tail -15` · ran
- 2026-08-13 02:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep; echo "---"; timeout 15` · ran
- 2026-08-13 02:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "chain-operator|session-stage|gate" 2>` · ran
- 2026-08-13 02:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 120 npm run test:match -- "p6-acceptance" 2>&1 | tai` · ran
- 2026-08-13 02:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -10` · ran
- 2026-08-13 02:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -10` · ran
- 2026-08-13 02:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-13 02:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check ../docs/reference/workflow-ir.md ../doc` · ran
- 2026-08-13 02:26 · `git stash 2>&1 | head -3; cd server && npx prettier --check ../CHANGELOG.md 2>&1; cd .. && git stash pop 2>&1 | head -3` · ran
- 2026-08-13 02:26 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 120 npm run test:match -- "p6-acceptance" 2>&1 | tai` · ran
- 2026-08-13 02:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 120 npm run test:match -- "p6-acceptance" 2>&1 | tai` · ran
- 2026-08-13 02:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep -i` · ran
- 2026-08-13 02:25 · `ps aux | grep -i jest | grep -v grep | head -10` · ran
- 2026-08-13 02:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5 && echo "=== TESTS ===" && ` · ran
- 2026-08-13 02:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-13 02:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | rg "del` · ran
- 2026-08-13 02:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:format 2>&1 | tail -40` · ran
- 2026-08-13 02:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "chain-operator|session-stage|gate" 2>` · ran
- 2026-08-13 02:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-13 02:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "chain-operator|session-stage|gate" 2>` · ran
- 2026-08-13 02:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -30` · ran
- 2026-08-13 02:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -30` · ran
- 2026-08-13 02:21 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -40` · ran
- 2026-08-13 00:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -i jest | grep -v grep` · ran
- 2026-08-13 00:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -c "[j]est"; npm run test:match -- "workflow|p` · ran
- 2026-08-13 00:31 · `npx prettier --write docs/reference/mcp-tools.md docs/reference/workflow-ir.md plans/adaptive-chain-runtime-p6-workflow-` · ran
- 2026-08-13 00:30 · `git stash list >/dev/null; npx prettier --check docs/reference/chain-schema.md docs/concepts/chains-lifecycle.md 2>&1 | ` · ran
- 2026-08-13 00:30 · `npx prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md docs/reference/mcp-t` · ran
- 2026-08-13 00:30 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'NOTES' ## Tier 5 — worker execu` · ran
- 2026-08-13 00:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:integration 2>&1 | tail -25` · ran
- 2026-08-13 00:18 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 550 npm run test:integration 2>&1 | tail -25` · ran
- 2026-08-13 00:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npm run test:integration 2>&1 | tail -20` · ran
- 2026-08-13 00:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npm run test:ci 2>&1 | tail -12` · ran
- 2026-08-13 00:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && python3 - <<'EOF' p='tests/unit/execution/pipeline/step-resp` · ran
- 2026-08-13 00:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -c "[j]est"; timeout 900 npm run test:ci 2>&1 ` · ran
- 2026-08-13 00:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -c "[j]est"; timeout 600 npm run test:match --` · ran
- 2026-08-13 00:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run typecheck:tests:ratchet 2>&1 | tail -4; ` · ran
- 2026-08-13 00:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | rg "com` · ran
- 2026-08-13 00:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run typecheck:tests:ratchet 2>&1 | tail -8; ` · ran
- 2026-08-13 00:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && python3 - <<'EOF' p='src/mcp/tools/prompt-engine/core/prompt` · ran
- 2026-08-13 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && sed -n '228,270p' eslint.config.js` · ran
- 2026-08-13 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ls eslint.config* && rg -n "no-restricted-syntax" -A 15 esli` · ran
- 2026-08-13 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/ --rule '{"no-restricted-syntax":"error"}' --` · ran
- 2026-08-13 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --fix src/engine/execution/pipeline/stages/04-par` · ran
- 2026-08-13 00:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && python3 - <<'EOF' p='src/mcp/tools/prompt-engine/core/pipeli` · ran
- 2026-08-13 00:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --fix src/modules/workflow-ir/compiler.ts src/eng` · ran
- 2026-08-13 00:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/workflow-ir/compiler.ts src/engine/ex` · ran
- 2026-08-13 00:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/workflow-ir/compiler.ts src/engine/ex` · ran
- 2026-08-13 00:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep -c "[j]est" ; timeout 500 npm run typecheck 2>` · ran
- 2026-08-13 00:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && python3 - <<'EOF' p='src/engine/execution/parsers/workflow-c` · ran
- 2026-08-13 00:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run test:match -- "p6-workflow-ir" 2>&1 | rg` · ran
- 2026-08-13 00:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run test:match -- "workflow-ir|p6-workflow-i` · ran
- 2026-08-13 00:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run test:match -- "workflow-ir|p6-workflow-i` · ran
- 2026-08-13 00:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run test:match -- "workflow-ir|p6-workflow-i` · ran
- 2026-08-13 00:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 300 npm run test:match -- "mutation-policy" 2>&1 | t` · ran
- 2026-08-13 00:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 300 npm run test:match -- "prompt-engine-surface" 2>` · ran
- 2026-08-13 00:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 300 npm run test:match -- "prompt-engine-surface" 2>` · ran
- 2026-08-13 00:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run test:match -- "p6-workflow-ir" 2>&1 | ta` · ran
- 2026-08-13 00:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 500 npm run test:match -- "p6-workflow-ir" 2>&1 | ta` · ran
- 2026-08-13 00:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 400 npm run test:match -- "workflow-ir" 2>&1 | tail ` · ran
- 2026-08-13 00:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 300 npx jest tests/unit/workflow-ir/ 2>&1 | tail -30` · ran
- 2026-08-12 23:58 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 400 npm run typecheck 2>&1 | tail -40` · ran
- 2026-08-12 23:46 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 300 npm run validate:arch 2>&1 | tail -25` · ran
- 2026-08-12 23:43 · `ps aux | grep -i "jest\|node.*test" | grep -v grep | head -20; echo "---GIT STATUS---"; git status --porcelain | head -6` · ran
- 2026-08-12 23:42 · `ls server/src/modules/workflow-ir/ && npm --prefix server run test:match -- "workflow-ir" 2>&1 | rg "Tests:|Suites:" && ` · ran
- 2026-08-12 23:41 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck && npm run lint:ratchet && npm run typeche` · ran
- 2026-08-12 23:41 · `npx --prefix server prettier --write plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md >/de` · ran
- 2026-08-12 23:40 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'MDEOF' ## Tier 4 — worker execu` · ran
- 2026-08-12 23:38 · `npx --prefix server prettier --check docs/reference/workflow-ir.md docs/reference/chain-schema.md docs/README.md server/` · ran
- 2026-08-12 23:38 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -6 && echo "=== FULL UNIT ` · ran
- 2026-08-12 23:37 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck && npm run lint:ratchet && npm run typeche` · ran
- 2026-08-12 23:36 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && S=/tmp/claude-1000/-home-minipuft-Applications-claude-prompt` · ran
- 2026-08-12 23:36 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write tests/unit/gates/inline-gate-chain-step` · ran
- 2026-08-12 23:36 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "workflow-ir|gate-enhancement|inline-g` · ran
- 2026-08-12 23:36 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "workflow-ir|inline-gate-chain-step-wi` · ran
- 2026-08-12 23:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "workflow-ir|inline-gate-chain-step-wi` · ran
- 2026-08-12 23:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "workflow-ir|inline-gate-chain-step-wi` · ran
- 2026-08-12 23:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "workflow-ir|inline-gate-chain-step-wi` · ran
- 2026-08-12 23:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write tests/unit/prompts/chain-step-strictnes` · ran
- 2026-08-12 23:33 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npm run test:ci 2>&1 | tail -20` · ran
- 2026-08-12 23:33 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux|grep "jest --runInBand"|grep -v grep|wc -l; npm run t` · ran
- 2026-08-12 23:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -12` · ran
- 2026-08-12 23:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write tests/unit/workflow-ir/ tests/unit/gate` · ran
- 2026-08-12 23:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | rg "wor` · ran
- 2026-08-12 23:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | rg "wor` · ran
- 2026-08-12 23:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== TYPECHECK ===" && npm run typecheck 2>&1|tail -3 &` · ran
- 2026-08-12 23:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -10` · ran
- 2026-08-12 23:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/workflow-ir/ src/mcp/tools/schemas/wo` · ran
- 2026-08-12 23:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/workflow-ir/ src/mcp/tools/schemas/wo` · ran
- 2026-08-12 23:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/workflow-ir/ src/mcp/tools/schemas/wo` · ran
- 2026-08-12 23:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== TYPECHECK ===" && npm run typecheck 2>&1 | tail -5` · ran
- 2026-08-12 23:29 · `npx --prefix server prettier --write docs/reference/workflow-ir.md docs/reference/chain-schema.md server/tooling/contrac` · ran
- 2026-08-12 23:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run generate:contracts 2>&1 | tail -2 && npm run test:ma` · ran
- 2026-08-12 23:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep "jest --runInBand" | grep -v grep | wc -l && n` · ran
- 2026-08-12 23:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -15 && echo "=== stale note ==` · ran
- 2026-08-12 23:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && rm src/mcp/contracts/schemas/_generated/workflow-ir.generate` · ran
- 2026-08-12 23:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 23:15 · `ls plans/ | head -50 && echo "---PS---" && ps aux | grep -i jest | grep -v grep | head -20` · ran
- 2026-08-12 23:12 · `npx prettier --write docs/reference/chain-schema.md docs/concepts/chains-lifecycle.md && npx prettier --check docs/refer` · ran
- 2026-08-12 23:12 · `git stash list >/dev/null; for f in docs/reference/chain-schema.md docs/concepts/chains-lifecycle.md; do git show HEAD:$` · ran
- 2026-08-12 23:12 · `npx prettier --check docs/reference/chain-schema.md docs/concepts/chains-lifecycle.md 2>&1 | tail -10` · ran
- 2026-08-12 23:11 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'MDEOF' ## Tier 3 — worker execu` · ran
- 2026-08-12 23:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "text-refs|visibility|response-assembl` · ran
- 2026-08-12 23:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "visibility|p5-acceptance" 2>&1 | tail` · ran
- 2026-08-12 23:03 · `kill 2043412 2043413 2>/dev/null; sleep 2; cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:matc` · ran
- 2026-08-12 23:03 · `ps aux | grep -E "jest" | grep -v grep | head -5; echo "---"; ls -la /tmp/claude-1000/-home-minipuft-Applications-claude` · ran
- 2026-08-12 23:02 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -12` · ran
- 2026-08-12 23:02 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep "jest --runInBand" | grep -v grep | wc -l && n` · ran
- 2026-08-12 23:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -6 && echo "=== LINT RATCHET =` · ran
- 2026-08-12 22:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && md5sum -c /tmp/claude-1000/-home-minipuft-Applications-claud` · ran
- 2026-08-12 22:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "text-refs|text-reference|visibility" ` · ran
- 2026-08-12 22:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "text-refs|text-reference|visibility" ` · ran
- 2026-08-12 22:56 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "text-refs|text-reference|visibility" ` · ran
- 2026-08-12 22:56 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "text-refs|text-reference|visibility" ` · ran
- 2026-08-12 22:56 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -15 && echo "=== TESTS RATC` · ran
- 2026-08-12 22:56 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && rg -n "writeFileSync|update.*baseline|--update" scripts/esli` · ran
- 2026-08-12 22:55 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ps aux | grep "jest --runInBand" | grep -v grep | head -3; n` · ran
- 2026-08-12 22:55 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 22:49 · `ls plans/ | head -50 && echo "---PS---" && ps aux | grep -i jest | grep -v grep | head` · ran
- 2026-08-12 22:47 · `cd server && npm run validate:contracts 2>&1 | tail -3; cd .. ; echo "=== committed paths in series ==="; git diff --nam` · ran
- 2026-08-12 22:46 · `cd server && npm run typecheck 2>&1 | tail -3; echo "=== RATCHET ==="; npm run lint:ratchet 2>&1 | tail -4; echo "=== TE` · ran
- 2026-08-12 22:45 · `python3 - <<'PY' p='plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12.md' s=open(p,encoding='utf-8').read() subs=[ ` · ran
- 2026-08-12 22:44 · `git add plans/adaptive-chain-runtime-2026-08-09.md plans/adaptive-chain-runtime-2026-08-09-implementation-notes.md plans` · ran
- 2026-08-12 22:36 · `for f in server/package.json server/scripts/run-validation-suite.js server/scripts/eslint-ratchet.js server/resources/ga` · ran
- 2026-08-12 22:35 · `python3 - << 'PYEOF' plan = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md' lines = open(plan).read()` · ran
- 2026-08-12 22:32 · `cd server && npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run ` · ran
- 2026-08-12 22:31 · `python3 - << 'PYEOF' p = 'scripts/validate-plan-row-tracking.js' s = open(p).read() # 1) auditOpenRows takes an entries ` · ran
- 2026-08-12 22:30 · `cd server && npm run validate:plan-row-tracking:self-test 2>&1 | tail -8` · ran
- 2026-08-12 22:29 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -3 && echo "=== LINT ===" && n` · ran
- 2026-08-12 22:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -3; echo "===" ; npm run lint:` · ran
- 2026-08-12 22:28 · `cd server && npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run ` · ran
- 2026-08-12 22:27 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'NOTES' **Tier 1 addendum — broa` · ran
- 2026-08-12 22:27 · `ps -eo pid,etime,cmd | grep -E "jest" | grep -v grep | head -5` · ran
- 2026-08-12 22:27 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'NOTES' **Formatting note (Tier ` · ran
- 2026-08-12 22:27 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad; md5s` · ran
- 2026-08-12 22:27 · `git show HEAD:plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md | npx prettier --check --st` · ran
- 2026-08-12 22:26 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad && cp` · ran
- 2026-08-12 22:26 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/notes` · ran
- 2026-08-12 22:26 · `git show HEAD:plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md > /tmp/claude-1000/-home-mi` · ran
- 2026-08-12 22:26 · `npx prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md 2>&1 | tail -5` · ran
- 2026-08-12 22:26 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementat` · ran
- 2026-08-12 22:26 · `git stash list | head -3; npx prettier --check plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-not` · ran
- 2026-08-12 22:25 · `cat >> plans/adaptive-chain-runtime-p6-workflow-ir-2026-08-12-implementation-notes.md <<'WRITEBACK' ## Tier 2 — worker e` · ran
- 2026-08-12 22:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 550 npm run test:match -- "visibility-policy|p5-acce` · ran
- 2026-08-12 22:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && timeout 900 npx cross-env NODE_OPTIONS="--experimental-vm-mo` · ran
- 2026-08-12 22:23 · `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci && npm run validate:all ` · ran
- 2026-08-12 22:16 · `npm run test:match -- "resource-manager|file-operations|version-history|prompt-patch|p7-acceptance" 2>&1 | rg "Tests:|Su` · ran
- 2026-08-12 22:15 · `rg -n "overrides|permanent|frozen|freez" tooling/contracts/resource-manager.json | head -4 && npm run typecheck 2>&1 | t` · ran
- 2026-08-12 22:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write tests/unit/execution/formatting/respons` · ran
- 2026-08-12 22:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/engine/execution/formatting/respons` · ran
- 2026-08-12 22:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/engine/execution/formatting/response-assemble` · ran
- 2026-08-12 22:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "visibility|p5-acceptance|integration/` · ran
- 2026-08-12 22:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "operator-validation" 2>&1 | tail -8` · ran
- 2026-08-12 22:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "06-|delegation|chain-operator" 2>&1 |` · ran
- 2026-08-12 22:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -4 && echo "=== LINT ===" && n` · ran
- 2026-08-12 22:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && md5sum src/mcp/tools/resource-manager/core/router.ts && npm ` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -8; echo "===ESLINT PER-FI` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -4 && echo "===GATE2===" && np` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -15` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager/router" 2>&1 | tail ` · ran
- 2026-08-12 22:11 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "operator-validation|integration/chain` · ran
- 2026-08-12 22:10 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "c` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && ls tsconfig*.json; cat scripts/typecheck-tests-ratchet.js | ` · ran
- 2026-08-12 22:09 · `npx prettier --check plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md 2>&1 | tail -` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx tsc --noEmit -p tsconfig.tests.json 2>&1 | grep -i "chai` · ran
- 2026-08-12 22:09 · `cat >> plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md <<'NOTES' ## OQ-P7-8 — impl` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler|session-stage|blue` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler|session-stage|blue` · ran
- 2026-08-12 22:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler|session-stage|blue` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -5` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "06-|delegation|chain-operator" 2>&1 |` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -8` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:arch 2>&1 | tail -10` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck && npm run lint:ratchet && npm run typeche` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -8` · ran
- 2026-08-12 22:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler" 2>&1 | tail -40` · ran
- 2026-08-12 22:07 · `cp /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-bb94-3b01d9406b3b/scratchpad/06-mi` · ran
- 2026-08-12 22:07 · `git stash list >/dev/null; mkdir -p /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1029e560-dbd8-490e-b` · ran
- 2026-08-12 22:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "response-assembler" 2>&1 | tail -50` · ran
- 2026-08-12 22:07 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:06 · `git show HEAD:server/.eslint-ratchet-baseline.json | rg -n "no-unused-vars" -A 3 && echo "=== diff of baseline ===" && g` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && git status --porcelain .eslint-ratchet-baseline.json; rg -n ` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && fd -H "ratchet" scripts/ . --max-depth 2 2>/dev/null | head ` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:06 · `for f in server/src/engine/execution/context/context-resolver.ts server/src/engine/execution/parsers/symbolic-operator-p` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src --rule '{"@typescript-eslint/no-unused-vars":` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/engine/execution/pipeline/stages/06-operator-` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -12` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5 && echo "===LINT===" && npm` · ran
- 2026-08-12 22:05 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/mcp/tools/resource-manager/prompt/services/pr` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 22:04 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5; echo "===LINT==="; npm run` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBan` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/execution/pipeline/p6-probe.test.ts 2>&1` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/execution/pipeline/p6-probe.test.ts 2>&1` · ran
- 2026-08-12 22:03 · `tail -8 /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/bhqwz` · ran
- 2026-08-12 22:03 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && cat jest.config.js 2>/dev/null || cat jest.config.cjs 2>/dev` · ran
- 2026-08-12 22:02 · `git stash list >/dev/null; npx prettier --check docs/reference/mcp-tools.md >/dev/null 2>&1; echo "---"; git diff --stat` · ran
- 2026-08-12 22:02 · `npx prettier --check docs/reference/mcp-tools.md 2>&1 | tail -5` · ran
- 2026-08-12 22:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit` · ran
- 2026-08-12 22:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit 2>&1 | tail -8` · ran
- 2026-08-12 22:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|file-operations|vers` · ran
- 2026-08-12 22:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "version-history" 2>&1 | tail -25` · ran
- 2026-08-12 22:00 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "prompt-lifecycle-processor" 2>&1 | ta` · ran
- 2026-08-12 21:59 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "file-operations" 2>&1 | tail -30` · ran
- 2026-08-12 21:58 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "argument-contract" 2>&1 | tail -30` · ran
- 2026-08-12 21:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run generate:contracts 2>&1 | tail -15 && echo "=== type` · ran
- 2026-08-12 21:51 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-imple` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "gate-review-scoping|chain-session|res` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 21:50 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -40` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "gate-review-scoping" 2>&1 | tail -100` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "gate-review-scoping" 2>&1 | tail -80` · ran
- 2026-08-12 21:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx jest tests/unit/gates/services/gate-review-scoping.test.` · ran
- 2026-08-12 21:49 · `npx prettier --check plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-implementation-notes.md 2>&1 echo "---` · ran
- 2026-08-12 21:49 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-imple` · ran
- 2026-08-12 21:48 · `npx prettier --write docs/reference/chain-schema.md 2>&1 && npx prettier --check docs/reference/chain-schema.md docs/ref` · ran
- 2026-08-12 21:45 · `npm run typecheck 2>&1 | tail -2 && npm run lint:ratchet 2>&1 | tail -1 && npm run test:match -- "p7-acceptance|prompt-p` · ran
- 2026-08-12 21:44 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts src/mcp/tools/resource-manager/p` · ran
- 2026-08-12 21:44 · `npx eslint src/mcp/tools/resource-manager/prompt/ --rule '{"@typescript-eslint/no-unnecessary-type-assertion":"error"}' ` · ran
- 2026-08-12 21:44 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts src/mcp/tools/resource-manager/p` · ran
- 2026-08-12 21:44 · `npm run typecheck 2>&1 | tail -3 && npm run lint:ratchet 2>&1 | tail -1 && npm run typecheck:tests:ratchet 2>&1 | tail -` · ran
- 2026-08-12 21:42 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | head -25` · ran
- 2026-08-12 21:42 · `npm run typecheck 2>&1 | head -25` · ran
- 2026-08-12 21:34 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-impl` · ran
- 2026-08-12 21:33 · `npm run typecheck:tests:ratchet 2>&1 | tail -80` · ran
- 2026-08-12 21:33 · `npm run lint:ratchet 2>&1 | tail -60` · ran
- 2026-08-12 21:32 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 21:32 · `npm run test:match -- "p7-acceptance|prompt-patch-update|resource-manager|file-operations|version-history" 2>&1 | tail -` · ran
- 2026-08-12 21:31 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -150` · ran
- 2026-08-12 21:31 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -30` · ran
- 2026-08-12 21:31 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -150` · ran
- 2026-08-12 21:29 · `npm run test:match -- "p7-acceptance" 2>&1 | grep -A 40 "DEBUG"` · ran
- 2026-08-12 21:28 · `npm run test:match -- "p7-acceptance" 2>&1 | grep -A 20 "DEBUG"` · ran
- 2026-08-12 21:28 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -60` · ran
- 2026-08-12 21:28 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -150` · ran
- 2026-08-12 21:25 · `npm run test:match -- "p7-acceptance" 2>&1 | rg -A12 "clause \(c\)" | head -30` · ran
- 2026-08-12 21:25 · `npx jest tests/integration/mcp-tools/p7-acceptance.integration.test.ts -t "clause \(c\)" 2>&1 | tail -20` · ran
- 2026-08-12 21:24 · `npm run test:match -- "p7-acceptance" 2>&1 | rg "●.*P7 acceptance" | sort -u` · ran
- 2026-08-12 21:24 · `npm run test:match -- "p7-acceptance" 2>&1 | rg "✓|✕|Tests:" | head -10` · ran
- 2026-08-12 21:23 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -8` · ran
- 2026-08-12 21:19 · `npm run test:match -- "p7-acceptance" 2>&1 | rg -B8 "266:34" | head -30` · ran
- 2026-08-12 21:19 · `npm run test:match -- "p7-acceptance" 2>&1 | tail -25` · ran
- 2026-08-12 21:16 · `python3 - << 'PYEOF' notes = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md' tex` · ran
- 2026-08-12 21:15 · `python3 - << 'PYEOF' plan = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md' lines = open(plan).read()` · ran
- 2026-08-12 21:15 · `cd /home/minipuft/Applications/claude-prompts-mcp && npx prettier --write plans/adaptive-chain-runtime-p5-visibility-pol` · ran
- 2026-08-12 21:15 · `npm run validate:format 2>&1 | tail -3 && npm run test:match -- "resource-manager" 2>&1 | tail -5` · ran
- 2026-08-12 19:36 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-impl` · ran
- 2026-08-12 19:35 · `npx --prefix server prettier --check docs/reference/mcp-tools.md 2>&1 echo "---diff stat---" git diff --stat -- docs/ref` · ran
- 2026-08-12 19:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --write ../docs/reference/mcp-tools.md 2>&1 | t` · ran
- 2026-08-12 19:35 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check ../docs/reference/mcp-tools.md 2>&1 | t` · ran
- 2026-08-12 19:30 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - << 'PYEOF' plan = 'plans/adaptive-chain-runtime-p7-resour` · ran
- 2026-08-12 19:30 · `npm run test:match -- "file-operations|resource-manager" 2>&1 | tail -8` · ran
- 2026-08-12 19:30 · `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet 2>&1 | tail -5` · ran
- 2026-08-12 19:28 · `\ echo "=== typecheck ===" && npm run typecheck 2>&1 | tail -5 && \ echo "=== lint:ratchet ===" && npm run lint:ratchet ` · ran
- 2026-08-12 19:27 · `npm run test:match -- "file-operations|resource-manager" 2>&1 | tail -100` · ran
- 2026-08-12 19:27 · `npm run typecheck:tests:ratchet 2>&1 | tail -50` · ran
- 2026-08-12 19:26 · `npm run typecheck 2>&1 | tail -30` · ran
- 2026-08-12 19:26 · `npm run lint:ratchet 2>&1 | tail -40` · ran
- 2026-08-12 19:26 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/file-operations.ts src/mcp/tools/resource-manager/prompt/cor` · ran
- 2026-08-12 19:26 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>&1 | grep -E "import-x/order"` · ran
- 2026-08-12 19:25 · `sed -n '90,135p' eslint.config.mjs 2>/dev/null || sed -n '90,135p' eslint.config.js 2>/dev/null || find . -maxdepth 1 -i` · ran
- 2026-08-12 19:25 · `grep -n "import-x/order\|pathGroups\|groups:" eslint.config.* 2>/dev/null | head -40` · ran
- 2026-08-12 19:25 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>&1 | head -20` · ran
- 2026-08-12 19:25 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/file-operations.ts src/mcp/tools/resource-manager/prompt/ser` · ran
- 2026-08-12 19:25 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/file-operations.ts src/mcp/tools/resource-manager/prompt/ser` · ran
- 2026-08-12 19:24 · `npm run lint:ratchet 2>&1 | tail -80` · ran
- 2026-08-12 19:24 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -60` · ran
- 2026-08-12 19:23 · `npm run test:match -- "file-operations|prompt-lifecycle-processor" 2>&1 | tail -140` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -80` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -80` · ran
- 2026-08-12 19:23 · `npm run test:match -- "prompt-lifecycle-processor" 2>&1 | tail -150` · ran
- 2026-08-12 19:21 · `npm run test:match -- "file-operations" 2>&1 | tail -80` · ran
- 2026-08-12 19:21 · `npm run test:match -- "file-operations" 2>&1 | tail -150` · ran
- 2026-08-12 19:21 · `npx jest tests/integration/resources/yaml-corpus.test.ts 2>&1 | tail -40` · ran
- 2026-08-12 19:21 · `npx jest tests/unit/mcp-tools/resource-manager/prompt/file-operations.validation.test.ts 2>&1 | tail -100` · ran
- 2026-08-12 19:19 · `npm run typecheck 2>&1 | tail -60` · ran
- 2026-08-12 19:12 · `python3 - << 'PYEOF' import io, re plan = '../plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12.md' with io.` · ran
- 2026-08-12 19:11 · `wc -l src/mcp/tools/resource-manager/prompt/operations/template-patch.ts; rg -n "replace_all|anchor_ambiguous" src/mcp/t` · ran
- 2026-08-12 19:10 · `echo "===FINAL GATE==="; npm run typecheck 2>&1 | tail -2; npm run validate:contracts 2>&1 | tail -2; npm run lint:ratch` · ran
- 2026-08-12 19:09 · `python3 - <<'PY' import io p='/home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-au` · ran
- 2026-08-12 19:09 · `python3 - <<'PY' import io p='/home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-au` · ran
- 2026-08-12 19:09 · `until ! pgrep -f "jest --runInBand tests/integration" >/dev/null; do sleep 15; done; rg "Tests:|Suites:|●.*›" /tmp/claud` · ran
- 2026-08-12 18:58 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:58 · `cd /home/minipuft/Applications/claude-prompts-mcp && git diff --stat -- server/.eslint-ratchet-baseline.json && git diff` · ran
- 2026-08-12 18:57 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:57 · `npx prettier --check src/mcp/tools/resource-manager/prompt/utils/validation.ts; npm run typecheck 2>&1 | tail -2; npm ru` · ran
- 2026-08-12 18:57 · `ls -la /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/ | tai` · ran
- 2026-08-12 18:57 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:56 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "Tests:|Suites:|●.*›" /tmp/claude-1` · ran
- 2026-08-12 18:56 · `until ! pgrep -f "jest --runInBand tests/integration" >/dev/null; do sleep 10; done; echo INTEGRATION_DONE` · ran
- 2026-08-12 18:56 · `pgrep -f "jest --runInBand tests/integration" >/dev/null && echo STILL_RUNNING || rg "●.*›|Tests:|Suites:|exit" /tmp/cla` · ran
- 2026-08-12 18:55 · `cat /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/bjjco9cpd` · ran
- 2026-08-12 18:55 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-impl` · ran
- 2026-08-12 18:54 · `NODE_OPTIONS="--experimental-vm-modules" timeout 1200 npx jest --runInBand tests/integration 2>&1 | rg "●.*›|Tests:|Suit` · ran
- 2026-08-12 18:43 · `NODE_OPTIONS="--experimental-vm-modules" timeout 900 npx jest --runInBand tests/unit 2>&1 | rg "●.*›|Tests:|Suites:" | h` · ran
- 2026-08-12 18:42 · `echo "===TYPECHECK==="; npm run typecheck 2>&1 | tail -2; echo "===VALIDATE:CONTRACTS==="; npm run validate:contracts 2>` · ran
- 2026-08-12 18:41 · `npx prettier --write src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts src/mcp/tools/resource` · ran
- 2026-08-12 18:41 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/utils/validation.ts' s=io.open(p,encoding='utf-8').r` · ran
- 2026-08-12 18:40 · `npx eslint --format json src/mcp/tools/schemas/resource-manager.schema.ts src/mcp/tools/resource-manager/core/types.ts s` · ran
- 2026-08-12 18:40 · `rg -n "eslint|glob|src|tests" scripts/eslint-ratchet.js | head -20` · ran
- 2026-08-12 18:40 · `npx eslint --format json src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>/dev/null | node` · ran
- 2026-08-12 18:40 · `npm run lint:ratchet 2>&1 | tail -6` · ran
- 2026-08-12 18:39 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/utils/validation.ts' s=io.open(p,encoding='utf-8').r` · ran
- 2026-08-12 18:39 · `echo "=== template-patch.ts ==="; npx eslint src/mcp/tools/resource-manager/prompt/operations/template-patch.ts 2>&1 | t` · ran
- 2026-08-12 18:39 · `npx eslint src/mcp/tools/resource-manager/prompt/operations/template-patch.ts src/mcp/tools/resource-manager/prompt/util` · ran
- 2026-08-12 18:39 · `npm run typecheck 2>&1 | tail -3; echo "===CONTRACTS==="; npm run validate:contracts 2>&1 | tail -3; echo "===LINT:RATCH` · ran
- 2026-08-12 18:38 · `npx prettier --write src/mcp/tools/resource-manager/prompt/operations/template-patch.ts tests/unit/mcp-tools/resource-ma` · ran
- 2026-08-12 18:38 · `npx prettier --check src/mcp/tools/resource-manager/prompt/operations/template-patch.ts src/mcp/tools/resource-manager/p` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/core/router.ts' s=io.open(p,encoding='utf-8').read() s=s.re` · ran
- 2026-08-12 18:37 · `npm run test:match -- "resource-manager-workflow" 2>&1 | rg "●.*›|Tests:|Suites:" | head` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/operations/template-patch.ts' s=io.open(p,encoding='` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:37 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `npm run test:match -- "patch-update|prompt-patch-update" 2>&1 | rg "●.*›" | head -10` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open(p,` · ran
- 2026-08-12 18:36 · `python3 - <<'PY' import io,re p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' s=io.open` · ran
- 2026-08-12 18:35 · `python3 - <<'PY' import io,re p='tests/integration/mcp-tools/prompt-patch-update.test.ts' s=io.open(p,encoding='utf-8').` · ran
- 2026-08-12 18:35 · `npm run test:match -- "prompt-patch-update" 2>&1 | tail -50` · ran
- 2026-08-12 18:34 · `npm run test:match -- "patch-update" 2>&1 | tail -60` · ran
- 2026-08-12 18:33 · `npm run test:match -- "template-patch" 2>&1 | tail -20` · ran
- 2026-08-12 18:32 · `npm run validate:contracts 2>&1 | tail -8; echo "===ARCH==="; npm run validate:arch 2>&1 | tail -15` · ran
- 2026-08-12 18:32 · `npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 18:31 · `npm run generate:contracts 2>&1 | tail -5; echo "=== typecheck ==="; npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 18:20 · `python3 - << 'PYEOF' import io, re notes = '../plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementat` · ran
- 2026-08-12 18:20 · `npx prettier --write tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts tests/unit/versioni` · ran
- 2026-08-12 18:19 · `python3 -c " import io p='src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts' t=io.open(p,enco` · ran
- 2026-08-12 18:18 · `python3 - << 'PYEOF' import io p = 'tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts' wit` · ran
- 2026-08-12 18:18 · `npm run test:match -- "resource-manager|versioning" 2>&1 | rg "Tests:|Suites:"; echo -- FALSIFY; cp src/mcp/tools/resour` · ran
- 2026-08-12 18:17 · `python3 - << 'PYEOF' import io p = 'tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts' wit` · ran
- 2026-08-12 18:16 · `npm run test:match -- "resource-manager" 2>&1 | rg -B2 -A10 "✕|FAIL " | head -30` · ran
- 2026-08-12 18:16 · `npm run test:match -- "resource-manager" 2>&1 | rg -B3 -A14 "●.*›.*›" | head -30` · ran
- 2026-08-12 18:16 · `npm run test:match -- "resource-manager" 2>&1 | tail -4` · ran
- 2026-08-12 18:16 · `npm run test:match -- "versioning" 2>&1 | tail -4` · ran
- 2026-08-12 18:15 · `npm run test:match -- "versioning" 2>&1 | rg -B4 -A12 "✕|●.*›" | head -40` · ran
- 2026-08-12 18:15 · `npm run typecheck 2>&1 | tail -2 && npm run test:match -- "versioning" 2>&1 | tail -4` · ran
- 2026-08-12 18:12 · `cd server && npm run test:match -- "versioning|resource-manager" 2>&1 | tail -3 && npm run typecheck 2>&1 | tail -1 && n` · ran
- 2026-08-12 18:12 · `rg -n "npx jest tests/integration" plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md` · ran
- 2026-08-12 18:11 · `python3 - <<'PY' import io p = 'plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md' s` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuft-Applications-claude-` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || echo DONE; ls -la /tmp/claude-1000/-home-minipuft-Applic` · ran
- 2026-08-12 18:10 · `sleep 90 2>/dev/null; pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuf` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuft-Applications-claude-` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || cat /tmp/claude-1000/-home-minipuft-Applications-claude-` · ran
- 2026-08-12 18:10 · `pgrep -f "jest tests/integration" >/dev/null && echo RUNNING || echo DONE` · ran
- 2026-08-12 18:09 · `pgrep -f "jest tests/integration" >/dev/null && echo "STILL RUNNING" || echo "FINISHED"; wc -c /tmp/claude-1000/-home-mi` · ran
- 2026-08-12 18:09 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/mcp/tools/resource-manager/prompt/s` · ran
- 2026-08-12 18:08 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 18:07 · `wc -c /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/5c2e54b0-7145-4581-9f2d-cf1d4e773e39/tasks/b7xq1y2` · ran
- 2026-08-12 18:06 · `cat >> plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md <<'EOF' ### Tier 2 validati` · ran
- 2026-08-12 18:06 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 900 npx jes` · ran
- 2026-08-12 17:54 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 900 npx jes` · ran
- 2026-08-12 17:53 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:table-contracts 2>&1 | tail -6; echo "===PH` · ran
- 2026-08-12 17:53 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "versioning|resource-manager" 2>&1 | t` · ran
- 2026-08-12 17:52 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5; echo "===LINT:RATCHET===";` · ran
- 2026-08-12 17:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/modules/versioning/version-history-service.ts` · ran
- 2026-08-12 17:48 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -8; echo "===LINT:RATCHET===";` · ran
- 2026-08-12 17:47 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:46 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:46 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:45 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:44 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:43 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:43 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:34 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - << 'PYEOF' import io, re plan = 'plans/adaptive-chain-run` · ran
- 2026-08-12 17:33 · `cd server && rg -n "required|defaultValue|validation" src/mcp/tools/schemas/resource-manager.schema.ts | sed -n '1,6p'; ` · ran
- 2026-08-12 17:32 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck && npm run validate:contracts && npm run l` · ran
- 2026-08-12 17:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/mcp/tools/schemas/resource-manager.` · ran
- 2026-08-12 17:31 · `npx prettier --write plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md 2>&1 | tail -` · ran
- 2026-08-12 17:31 · `npx prettier --check plans/adaptive-chain-runtime-p7-resource-authoring-2026-08-12-implementation-notes.md 2>&1 | tail -` · ran
- 2026-08-12 17:30 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 500 npx jes` · ran
- 2026-08-12 17:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:match -- "resource-manager|prompt-schema" 2>&1 ` · ran
- 2026-08-12 17:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck:tests:ratchet 2>&1 | tail -10` · ran
- 2026-08-12 17:28 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -5; echo "===VALIDATE:CONTRACT` · ran
- 2026-08-12 17:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:27 · `cd server && rg -n "currentNodeOrigin" src/engine/gates/services/run-step-view.ts src/engine/gates/services/gate-enhance` · ran
- 2026-08-12 17:26 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:25 · `python3 - <<'PY' import io p='plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-implementation-notes.md' s=io` · ran
- 2026-08-12 17:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -3 && echo "=== git status ` · ran
- 2026-08-12 17:24 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run lint:ratchet 2>&1 | tail -25` · ran
- 2026-08-12 17:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && node scripts/eslint-ratchet.js check 2>&1 | tail -20 && echo` · ran
- 2026-08-12 17:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint src/mcp/tools/resource-manager/prompt/operations/` · ran
- 2026-08-12 17:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run typecheck 2>&1 | tail -20` · ran
- 2026-08-12 17:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/engine/gates/services/run-step-` · ran
- 2026-08-12 17:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:ci 2>&1 | tail -6 && echo "===TYPECHECK===" && ` · ran
- 2026-08-12 17:20 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx prettier --check src/engine/gates/services/run-step-view` · ran
- 2026-08-12 17:19 · `git status --short | grep -v "^ M .github\|^ M README\|^ M docs/portfolio\|^ M package.json\|^ M plans/adaptive-chain-ru` · ran
- 2026-08-12 17:19 · `cat >> plans/adaptive-chain-runtime-p5-visibility-policy-2026-08-12-implementation-notes.md <<'EOF' ## Deviations — row ` · ran
- 2026-08-12 17:18 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && git stash list >/dev/null; git show c07a80c1:server/src/engi` · ran
- 2026-08-12 17:17 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npx eslint --format json src/engine/gates/services/gate-enha` · ran
- 2026-08-12 17:17 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run test:ci 2>&1 | tail -6 && echo "===TYPECHECK===" && ` · ran
- 2026-08-12 17:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 400 npx jes` · ran
- 2026-08-12 17:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" timeout 300 npx jes` · ran
- 2026-08-12 17:14 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && md5sum src/engine/gates/services/gate-enhancement-service.ts` · ran

## Rulings — 2026-08-12 (main-thread, all seven defaults adopted on the plan's evidence)

- **OQ-P7-1 → RULED: anchored old_string/new_string** (exact match, uniqueness-checked, typed rejection). Section addressing is the natural v2 once a heading contract exists.
- **OQ-P7-2 → RULED: explicit fields mirroring PromptArgumentSchema.** Passthrough admits arbitrary keys into persisted YAML — right for opaque step objects, wrong for a typed argument contract.
- **OQ-P7-3 → RULED: go-forward after-snapshot semantics.** Version N = state produced by edit N; existing durable rows untouched; history display distinguishes eras. Durable-table rules bar casual renumbering.
- **OQ-P7-4 → RULED: warn, not refuse** — response names the allowlist file and exact lines. 103/131 prompts live in untracked categories; refusal breaks the operator-local workflow.
- **OQ-P7-5 → RULED: field-loss widening stays in P7.** Fixing `required` alone leaves delegation fields silently droppable on the same write path.
- **OQ-P7-6 → RULED: saveVersion throws.** architecture.md awaited-persistence posture; the observable-behavior change is the point, and P4-F1 is the same defect class one module over.
- **OQ-P7-7 → RULED: ship the planning/ category.** The chain that plans every phase currently ships to nobody; allowlist it so Tier 5 produces a committable diff.

## Tier 1 — execution in flight (2026-08-12)

Tier 1 worker (opus) dispatched post-rulings; its declared targets are currently being edited:
`schemas/resource-manager.schema.ts`, `tooling/contracts/resource-manager.json` (+ `_generated/`),
`resource-manager/core/types.ts`, `prompt/operations/file-operations.ts`, and two new test files
under `tests/unit/mcp-tools/resource-manager/`. DEV-T1-* rows land with the worker's report per
the dispatch contract; main-thread acceptance (spot-check + gate re-run) follows before any
status column moves. This marker exists so the hygiene ledger reflects in-flight state rather
than reading these edits as unflushed.

## Tier 2 — worker deviations (rows 2.1, 2.2, 2.3, 2.6 + their 2.5 tests)

Row 2.4 (numbering semantics, durable rows) is NOT in this worker's scope and was not touched.

| Id       | Tier    | Authored                                                                                                                                                                                                  | Measured                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T2-1 | 2 (2.6) | Row 2.6: "resolve the camelCase/snake_case mismatch against `config.json:84-88`" (~10 lines), closing P7-F1                                                                                               | **Already closed.** `src/infra/config/index.ts:95-96` carries `{versioning, maxVersions → max_versions}` and `{versioning, autoVersion → auto_version}` in `INERT_SPELLINGS`, committed 2026-08-05 in `b4171ca8` ("land the 3.1.2 release preparation orphaned by a crashed session") with a covering test at `legacy-key-migration.test.ts:216`. P7's discovery (2026-08-12) did not check the fold table, so P7-F1 is stale as written                         | Zero source lines changed. The row's verify is discharged by two new tests driving a REAL `ConfigLoader` into a REAL `VersionHistoryService` — the mismatch is only observable where the two spellings meet, and every existing versioning test uses a mock provider that returns whatever it is handed. Falsified by deleting both fold entries: 3 failures (2 new + the existing legacy-key case), `md5` restored. P7-F1 should be marked CLOSED-BY-`b4171ca8`, not fixed by P7                                                                                                                                                                                                                       |
| DEV-T2-2 | 2 (2.2) | Row 2.2: "route rollback through the same write model Tier 1.4 established"; mechanism 3 = "rollback bypasses the update write model, writing only those 8 keys, **dropping the same 5 fields as P7-F2**" | The DROP is already closed by 1.4. Rollback has always called `fileOperations.updatePromptImplementation`, and 1.4 put preservation inside `createOrUpdateYamlPrompt` reading the on-disk YAML — so all five fields already survived a rollback before this row ran. What remained is the inverse and un-authored half: rollback could not RESTORE a field the current file lacks or overwrote, because those keys were absent from its private payload entirely | Implemented the restore half: `subagentModel` and `agentType` are now carried from the snapshot (the converter copies both verbatim from YAML, so a snapshot's value is the AUTHORED value). `registerWithMcp`, `mcpPromptMode` and `injection` are deliberately NOT carried — the first two are RESOLVED through prompt → category → global → default and the third is normalised by `normalizeInjectionConfig`, so restoring any of them reaches DEV-T1-3's hazard from the rollback side. Named as `SNAPSHOT_FIELDS_LEFT_TO_THE_WRITER` with that reasoning at the definition, and pinned by a test asserting an authored `registerWithMcp: false` survives a snapshot recording the resolved `true` |
| DEV-T2-3 | 2 (2.1) | Row 2.1: "missing key returns a typed error naming the key" — read against the eight keys the old merge covered                                                                                           | Erroring on all eight is wrong: `systemMessage`, `arguments`, `chainSteps` and `gateConfiguration` are legitimately absent from most prompts, so a blanket rule would refuse nearly every rollback. Also, `null` and not just absence has to count — snapshots round-trip through JSON, which has no `undefined`, and the plan's own mechanism-2 wording is "missing **or null**"                                                                                | Split into `REQUIRED_SNAPSHOT_FIELDS` (`name`, `category`, `description`, `userMessageTemplate` — error, naming each missing one) and `RESTORED_OPTIONAL_SNAPSHOT_FIELDS` (restored exactly when recorded, left absent when not). `== null` throughout, so a JSON `null` is treated as absent rather than written into the YAML where it would fail the loader's schema on the next read                                                                                                                                                                                                                                                                                                                |
| DEV-T2-4 | 2 (2.3) | Row 2.3 verify: "unit: injected DB failure aborts the update and surfaces an error", with 2.5's test surface named as the two versioning test files                                                       | The abort is a `PromptLifecycleProcessor` behaviour, and neither versioning test file can construct that processor. Asserting it in `tests/unit/versioning/` would mean rebuilding the processor harness that already exists one directory over                                                                                                                                                                                                                  | The service half (throws) is tested in `tests/unit/versioning/version-history-service.test.ts`; the caller half (aborts, **writes nothing**) is tested in `tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts`, whose `createUpdateProcessor` harness already exists. The discriminating assertion there is `expect(updatePromptImplementation).not.toHaveBeenCalled()` — an error message that still writes the file leaves the identical durable gap. A companion test pins that `skip_version: true`, which the abort message advertises as the escape hatch, still writes                                                                                              |
| DEV-T2-5 | 2 (2.3) | Row 2.3 scope: `version-history-service.ts:114-190` + `prompt-lifecycle-processor.ts:305-335`                                                                                                             | `saveVersion` has **three** production callers, not one. `gate-lifecycle-processor.ts:105` and `framework-lifecycle-processor.ts:158` carry the identical log-and-swallow shape and are outside the row                                                                                                                                                                                                                                                          | Left both untouched. They are correct-by-catch-boundary: `resource-manager/core/router.ts:79-100` wraps all three resource types in one try, so the throw becomes an error response there instead of a warning — which is the architecture.md posture the row is applying, just without a tailored message. Their `else { logger.warn(...) }` branches are now unreachable; flagged as **P7-F9**, not deleted, because they are another tier's files and the deletion is mechanical once someone owns them                                                                                                                                                                                              |
| DEV-T2-6 | 2 (2.1) | — (not authored)                                                                                                                                                                                          | `handleRollback` validates the target snapshot only AFTER `versionHistoryService.rollback()` has already written the pre-rollback snapshot, because the snapshot is not readable until that call returns. With 2.1 erroring, a malformed target version now consumes a version number (and can trigger FIFO pruning) for a rollback that does nothing                                                                                                            | Did not restructure — reordering means a second `getVersion` read ahead of the write, which is row 2.4's territory (numbering + what a version number means). The error response instead NAMES the consumed version (`📜 The pre-rollback snapshot was already recorded as version N`) so the operator is not surprised by it. **Handed to 2.4** — see the scope note below                                                                                                                                                                                                                                                                                                                             |

### Tier 2 validation ledger (rows 2.1, 2.2, 2.3, 2.6)

| Date       | Command                                                                                      | Result                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | `npm run typecheck`                                                                          | clean, no output                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-12 | `npm run lint:ratchet`                                                                       | `OK: 3199 errors, 1016 warnings (no regressions)`                                                                                                                                                                                                                                                                                                                    |
| 2026-08-12 | `npm run typecheck:tests:ratchet`                                                            | `OK: 377 errors in tests/ (no regressions)`                                                                                                                                                                                                                                                                                                                          |
| 2026-08-12 | `npm run test:match -- "versioning\|resource-manager"`                                       | 11 suites / 159 tests passed                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-12 | `npx jest tests/unit` (beyond the gate — `saveVersion` has three callers across three tools) | 183 suites / 2281 tests passed (Tier 1 baseline 2274, +7 new)                                                                                                                                                                                                                                                                                                        |
| 2026-08-12 | `npm run validate:table-contracts`                                                           | `OK: 10 tables and 2 view(s) declared`; the 4 accepted `cli-shared` foreign write sites unchanged                                                                                                                                                                                                                                                                    |
| 2026-08-12 | `npm run validate:no-phantom-columns`                                                        | `OK: every declared column has a writer or a declared exception`; the 3 `kv_state` exceptions unchanged                                                                                                                                                                                                                                                              |
| 2026-08-12 | falsification F1: `?? currentPrompt.k` fallback restored (2.1)                               | 3 failures, all in the rollback block; posture + config tests stayed green                                                                                                                                                                                                                                                                                           |
| 2026-08-12 | falsification F2: `subagentModel`/`agentType` dropped from the restore set (2.2)             | 1 failure — the authored-field restore, alone                                                                                                                                                                                                                                                                                                                        |
| 2026-08-12 | falsification F3: `saveVersion` throw reverted to `return {success:false}` (2.3 service)     | 2 failures in `persistence failure posture`; the caller-abort test stayed green                                                                                                                                                                                                                                                                                      |
| 2026-08-12 | falsification F4: caller abort reverted to log-and-proceed (2.3 caller)                      | 1 failure — `aborts the update without writing`, alone                                                                                                                                                                                                                                                                                                               |
| 2026-08-12 | falsification F5: both camelCase folds deleted from `INERT_SPELLINGS` (2.6)                  | 3 failures (2 new + the existing `legacy-key-migration` case) — proves the row-2.6 tests are not vacuous against already-correct code                                                                                                                                                                                                                                |
| 2026-08-12 | `md5sum` on all four falsified source files, before and after                                | identical (`746ad2b6…`, `47de23f4…`, `a33de95e…`, `f33a4ccd…`)                                                                                                                                                                                                                                                                                                       |
| 2026-08-12 | `npx jest tests/integration` (beyond the gate — same three-caller reason)                    | 44 suites / 542 tests passed, exit 0. The trailing "Jest did not exit one second after the test run" warning is pre-existing and unrelated                                                                                                                                                                                                                           |
| 2026-08-12 | falsification F3 RE-RUN against the shipped code                                             | F1-F5 all ran before two lint fixes landed (prettier reformat of the `SnapshotRestore` union; `{ cause: error }` on the new throw, required by the repo's `preserve-caught-error` rule). Prettier's change is behaviour-neutral by construction; the `cause` change is not, so F3 was re-run against the final bytes: same 2 failures, `md5` restored to `0cb9c7dd…` |

### Findings raised during Tier 2 execution

- **P7-F8 — the `tools:` key is dropped from `prompt.yaml` by both write paths, not just rollback.**
  `createOrUpdateYamlPrompt` emits `tools` only from `promptData.tools`, which the update path takes
  straight off `args.tools` (absent on any update that does not re-send them) and which rollback
  cannot supply at all: `ConvertedPrompt` has no `tools` field — the converter resolves the YAML id
  list into `scriptTools` (loaded definitions) and does not carry the ids forward, so a snapshot
  never records them. Not fixed here: the writer expects `ToolDefinitionInput` objects while every
  available source holds ids, so this is a writer-contract change, not a rollback change. It is
  already the `tools` half of DEV-T1-4's named exception; this records that the exception hides a
  live field loss, not merely an unmapped parameter.
- **P7-F9 — two now-unreachable `else { logger.warn(...) }` branches.** With `saveVersion` throwing,
  `gate-lifecycle-processor.ts:105` and `framework-lifecycle-processor.ts:158` can no longer observe
  `versionResult.success === false`. Both remain correct (the throw reaches
  `resource-manager/core/router.ts:79-100`, one catch boundary for all three resource types, and
  becomes an error response), but each still carries a branch claiming the failure is tolerated.
  Mechanical deletion, deferred only because they are outside Tier 2's declared rows.
- **P7-F10 — `SaveVersionResult` is shared with the accepted foreign writer, so the posture now
  diverges by design.** `cli-shared/version-history.ts:481 saveVersion` is a separate synchronous
  implementation over `runSqlite` that still returns `{success:false, error}` and never throws; the
  `cpm` binary has no catch boundary to throw into. The type was therefore left unchanged, and
  `VersionHistoryService.saveVersion`'s doc comment states that its own `success:false` branch is
  gone while the field remains for the CLI. Anyone unifying the two writers must move both postures
  together.

### Scope note handed to row 2.4 (main thread, numbering semantics)

Three things Tier 2's worker rows surfaced that bear on 2.4 and were deliberately left alone:

1. **A failed rollback still consumes a version** (DEV-T2-6). `handleRollback` cannot see the target
   snapshot until `versionHistoryService.rollback()` has already written the pre-rollback one, so
   2.1's new refusal happens one write too late. Fixing the order means reading the target version
   ahead of the write — which changes what a version number counts, and that is 2.4's decision, not
   2.1's. The refusal message names the consumed version rather than hiding it.
2. **No existing test pins the numbering semantics 2.4 will change**, and Tier 2 added none. The
   assertions this worker added are about snapshot CONTENT (exact restore, field preservation) and
   about persistence POSTURE; none asserts which number labels which state, so 2.4's test surface is
   still clear. `version-history-service.test.ts` `saveVersion › should increment version` and the
   integration `Rollback Workflow` block are the two places that encode current numbering.
3. **The pre-rollback snapshot's description is written by the service, not the processor**
   (`version-history-service.ts:317`, `Pre-rollback snapshot (before reverting to vN)`). It is the
   string the live incident showed at v4. If 2.4 changes what a version number means, that string
   becomes the second place stating the old semantics — the first being `history`'s own display.

## Row 2.4 — main-thread execution record (2026-08-12)

Implemented per OQ-P7-3 (go-forward): `recordEditResult(prior, produced)` on the service — records
the state an edit PRODUCES, with a self-healing BRIDGE row whenever the latest recorded snapshot
differs structurally from the live pre-edit state (era transition, out-of-band edit). No schema
change, no migration, existing durable rows untouched; eras distinguished by description
convention (post-fix rows describe the producing action; bridge rows say "Bridge:"; old-era rows
keep their historical text). Rollback now validates the target BEFORE any write (a refused
rollback consumes no version — closes DEV-T2-6), bridges if needed, and records the RESTORED
state as the newest version ("Rollback to vN"); the "Pre-rollback snapshot" row is gone because
under go-forward semantics the live state is already the previous version. Update caller records
`{...promptData}` (produced) with `beforeContent` as the bridge input; ordering and the OQ-P7-6
abort posture unchanged (recording still precedes the file write).

- DEV-T2-7 — Tier 2's two abort tests re-seamed from `saveVersion` to `recordEditResult` (the
  caller's new seam); assertions otherwise identical.
- DEV-T2-8 — first falsification run survived: mutating the caller back to before-content left all
  57 versioning tests green because the new tests exercised the service only (mutation-never-
  reached lesson). Added the caller-side discriminating test asserting the PRODUCED description
  reaches recordEditResult; mutation now fails exactly that test. md5-verified restore.
- DEV-T2-9 — numbering-encoding unit test deliberately re-encoded (v4 bridge + v5 restored state,
  asserting both rows' content and descriptions); integration Rollback Workflow needed no change
  (its assertions were content-based after Tier 2's rework).
- Create path unchanged: a created prompt's state enters history via the bridge on its first
  update. Recording creates directly is a semantics extension left to Tier 3/5 review.
- CLI second writer (`cli-shared/version-history.ts`) still writes old-era rows — divergence noted
  under P7-F10; its sync is a release-cycle follow-up, not a P7 tier.

## Tier 3 — worker deviations (rows 3.1–3.6, patch-mode update)

| Id       | Tier    | Authored                                                                                                                                                                   | Measured                                                                                                                                                                                                                                                                                                                                                                                                            | Action                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T3-1 | 3 (3.5) | Row 3.5: reject on template-syntax error "via `validatePromptYaml` (prompt-schema.ts:540) and a `processTemplate` (jsonUtils.ts:165) dry render"                           | A dry RENDER evaluates the template. Probed all 119 on-disk `prompt.yaml` bodies (286 bodies, `--no-ignore`): 4 throw under a bare render — 3 carry Handlebars-era `{{#if}}`/`{{{x}}}` (`creative/lora_profile`, `general/diagnosisCard`, `examples/minimal_prompt`), and `workflow/github_repo_setup` throws only because `{% for j in ci_jobs.split(',') %}` evaluates an undefined variable. Its syntax is valid | Eager COMPILE (`new nunjucks.Template(src, env, undefined, true)`) instead of a render, so "not a template" is separated from "needs its arguments"; plus a DIFFERENTIAL rule — a defect is blocking only when the edit INTRODUCES it, keyed by field. Without it, the 3 Handlebars prompts become permanently uneditable, including by an edit that repairs them |
| DEV-T3-2 | 3 (3.5) | Row 3.5 names `validatePromptYaml` directly                                                                                                                                | `.dependency-cruiser.cjs` `tool-layer-no-validator-value-imports` (severity **error**) bars `src/mcp/tools/` from value-importing `modules/prompts/prompt-schema`. `validate:arch` would have failed the tier                                                                                                                                                                                                       | Routed through `ResourceVerificationService.validateDocument('prompts', …)`, the rule's named replacement and the same service `file-operations.ts:183` verifies the WRITTEN file with — so the pre-write and post-write verdicts cannot diverge. `tools` is excluded from the projection (P7-F8: writer holds definition objects, schema declares an id list)    |
| DEV-T3-3 | 3 (3.5) | Row 3.5 places the validation hop with no statement about pre-existing invalidity                                                                                          | The write path ALREADY verifies the produced YAML (`file-operations.ts:183`, inside the mutation transaction, rollback on failure) — but only AFTER `recordEditResult` has spent a version, and it cannot see a Nunjucks syntax error at all                                                                                                                                                                        | Kept the pre-write hop, justified as "before the version is consumed" rather than as new coverage. Its value over the existing check is acceptance (b)'s second half — no version consumed — and template syntax, which YAML schema validation does not parse                                                                                                     |
| DEV-T3-4 | 3 (3.1) | Plan §Interfaces: `TemplatePatchOperation { target: PatchTarget; … }`, `PatchRejectionReason` including `'anchor_overlap'`, result carrying `rejections: PatchRejection[]` | The dispatch brief's exact Zod names the key `field`, and the ruling says operations "apply in order". With ordered application each op reads the previous op's OUTPUT, so `anchor_overlap` has no condition left to detect; and once one op fails, later anchors are being matched against text that was never produced                                                                                            | Landed `field` (brief + it names real tool parameters), dropped `anchor_overlap`, and returns ONE `rejection` (fail-fast) rather than an array of guesses. Kept `replace_all` from §Interfaces — the brief's Zod omits it, but the plan's own testing strategy names it as an edge and it is what makes the ambiguity rejection actionable                        |
| DEV-T3-5 | 3 (3.2) | Brief: "`patch` is mutually exclusive with the full-body params (`user_message_template`, `system_message`) — reject the combination"                                      | `description` is BOTH a patch target and a full-body parameter, and the brief's rule leaves that collision unnamed — the `UPDATE_FIELDS` merge would silently win over the patch                                                                                                                                                                                                                                    | Implemented the brief's rule verbatim for the two named parameters, and added the same rejection when a patch targets `description` while `description` is also supplied. Setting a description while patching the TEMPLATE stays legal — it collides with nothing                                                                                                |
| DEV-T3-6 | 3 (3.4) | Row 3.4 cites `:247` (merge), `:282` (reference validation), `:315` (version record)                                                                                       | Re-verified post-Tier-2: merge is `:247-251`, chain-step ops `:258`, reference validation `:279-303`, version block `:305` with `recordEditResult` at `:324`, write at `:360`. `hasTemplateChange` (`:279-280`) reads ONLY `args.user_message_template`/`args.system_message`, so a patch would have bypassed reference validation entirely                                                                         | Patch hop sits at `:270-303` (after the merge, before the chain-step block); `hasTemplateChange` now also fires on a patched non-`description` field, so a patch introducing `{{ref:missing}}` is refused exactly like a full body would be. Falsified: removing that clause fails exactly one test                                                               |
| DEV-T3-7 | 3 (3.6) | Row 3.6 verify: "tests fail if 3.4's ordering is moved after `:315`"                                                                                                       | Physically relocating the block below the version record puts `patchedFields` in its own TDZ and breaks 18 of 20 tests with `ReferenceError` — a crash, not a discriminating failure                                                                                                                                                                                                                                | Falsified with the semantically equivalent mutation instead: `recordEditResult` receives a pre-patch copy. Exactly 3 tests fail, all of them the version-parity/ordering ones. Six falsifications total (F1–F6), all md5-restored                                                                                                                                 |

### Tier 3 validation ledger

| Date       | Command                                                                     | Result                                                                                                             |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-08-12 | `npm run typecheck`                                                         | clean, no output                                                                                                   |
| 2026-08-12 | `npm run validate:contracts`                                                | `[generate-contracts] Complete` — `patch` + `dry_run` regenerated into `_generated/resource_manager.generated.ts`  |
| 2026-08-12 | `npm run lint:ratchet`                                                      | `OK: 3199 errors, 1017 warnings (no regressions)`                                                                  |
| 2026-08-12 | `npm run typecheck:tests:ratchet`                                           | `OK: 377 errors in tests/ (no regressions)`                                                                        |
| 2026-08-12 | `npm run test:match -- "resource-manager\|patch\|versioning"`               | 14 suites / 202 tests passed                                                                                       |
| 2026-08-12 | `npm run test:match -- "prompt-lifecycle-processor"`                        | 1 suite / 9 tests passed                                                                                           |
| 2026-08-12 | `npm run validate:arch`                                                     | `OK — 451 modules cruised`; 0 errors, the 4 pre-existing `engine-cross-layer-type-only` warnings unchanged         |
| 2026-08-12 | `npx jest tests/unit` (beyond the gate — the schema is MCP-registered)      | 185 suites / 2317 tests passed (Tier 2 baseline 2281, +36 new)                                                     |
| 2026-08-12 | falsification F1: `recordEditResult` handed the pre-patch state (3.4 order) | 3 failures: `records the PATCHED state`, `produces the same version row…`, integration `records the same version…` |
| 2026-08-12 | falsification F2: `diagnosePromptWrite` neutered (3.5)                      | 3 failures, all template-syntax; every anchor/dry-run test stayed green                                            |
| 2026-08-12 | falsification F3: patch removed from `hasTemplateChange`                    | 1 failure — `a patch arms reference validation the same way a full body does`, alone                               |
| 2026-08-12 | falsification F4: `dry_run` early return removed                            | 3 failures, all three dry-run tests, including the on-disk one                                                     |
| 2026-08-12 | falsification F5: uniqueness check removed from `applyTemplatePatches`      | 2 failures — the pure ambiguity edge and its processor-level counterpart                                           |
| 2026-08-12 | falsification F6: `patch`/`dry_run` dropped from the router payload         | 1 failure — the new router pass-through test, alone                                                                |
| 2026-08-12 | `npx jest tests/integration` (beyond the gate — real writer + router)       | 45 suites / 549 tests passed, exit 0 (Tier 2 baseline 44/542, +1 suite / +7 tests)                                 |
| 2026-08-12 | `md5sum` on the three mutated source files, before and after                | identical (`b1321418…`, `8dd61966…`, `7b0519d6…` at falsification time; two later lint fixes changed 2 of them)    |

### Findings raised during Tier 3 execution

- **P7-F11 — a render is not a syntax check, and 4 shipped prompts prove it.** Three prompts carry
  Handlebars-era `{{#if}}` / `{{{x}}}` bodies that no Nunjucks parse accepts, and one carries valid
  syntax that only throws when rendered without arguments. Any future gate that "validates a
  template" by rendering it will refuse legitimate edits to all four. Compile, and compare against
  the pre-edit state rather than against an absolute.
- **P7-F12 — the produced-YAML check runs one step too late to protect the durable table.**
  `file-operations.ts:183` verifies the WRITTEN file inside the mutation transaction, which is
  correct for the file but happens after `recordEditResult` has already spent a version. Tier 3 adds
  a pre-write hop; the post-write one is still the authority on what landed. Two checks, one
  service, deliberately.
- **P7-F13 — `patch` and `dry_run` are silently ignored on `create`.** The input schema is shared
  across actions, so both parameters validate on any `resource_type: 'prompt'` call, but
  `createPrompt` reads neither. That is the same accepted-here/ignored-there asymmetry row 1.6
  settled as unintended for the `gates` alias. Harmless today (a `create` carries the full bodies
  anyway) and deliberately not fixed inside Tier 3's declared rows — but `dry_run` on `create` is a
  genuinely useful verb, so the choice is "reject explicitly" or "implement", not "leave silent".

### OQ-P7-9 (from P7-F13) → RULED 2026-08-12: reject explicitly on create

`patch` and `dry_run` on `create` are rejected with a typed error naming the valid action —
silent acceptance is the same accepted-here/ignored-there asymmetry P7-D4 exists to kill.
`dry_run` on create is genuinely useful and is recorded as a v2 candidate, but implementing it
now is scope growth ahead of the live drive. Lands with Tier 4 (same schema/processor area).

## Tier 4 — execution in flight (2026-08-12)

Tier 4 worker (sonnet) dispatched with OQ-P7-4 (warn) + OQ-P7-9 (reject on create) rulings; its
declared targets currently being edited: `prompt/operations/file-operations.ts` (ship-signal
parser + surfacing) and `prompt/core/types.ts` (helper types). `resources/prompts/.gitignore` is
read-only for it (foreign-dirty). DEV-T4-* rows land with its report; main-thread acceptance
before any status column moves.

## Tier 4 — worker deviations (rows 4.1, 4.2, 4.3)

| Id       | Tier    | Authored                                                                                                                                         | Measured                                                                                                                                                                                                                                                                                                                                                                                                                          | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T4-1 | 4 (4.1) | Row 4.1 cites `file-operations.ts:74-94`; brief instructs "surface the answer to the caller" without naming a mechanism                          | Anchor had already moved to `:140-145` (Tiers 1-3 added ~130 lines, as the brief itself flagged). `OperationResult` (`core/types.ts`) is the only channel `updatePromptImplementation` returns through both `createPrompt` and `updatePrompt` — every other candidate (a second return value, a thrown side-channel, a logger call) either breaks the existing signature or is invisible to the caller building the response text | Added `CategoryShipStatus` (`category`, `ships`, `gitignorePath`) as an optional field on `OperationResult`, populated on every `updatePromptImplementation` call (create and update share one write path, so one field covers both halves of 4.2). Pure parser (`resolveCategoryShipStatus`) lives beside a private `readCategoryShipStatus` fs-reading wrapper in `file-operations.ts`, matching the brief's "(+ a pure helper)" instruction literally rather than splitting into a new file |
| DEV-T4-2 | 4 (4.1) | Brief: "Parse semantics: a category ships iff a negation pattern un-ignores it... table-driven test binds it to `git check-ignore` ground truth" | `node_modules/ignore` (7.0.6) is installed and would parse this correctly, but it is a TRANSITIVE dependency (pulled in by eslint/knip, not declared in `package.json`) — importing it directly in `src/` would compile today and silently vanish on a dedupe that drops it from the tree, which is worse than the defect this tier fixes                                                                                         | Hand-rolled a minimal rule matcher (`GitignoreRule`, `parseGitignoreRules`, `gitignoreRuleMatches`) scoped to the actual pattern shapes in this one file (`*`, `!name/`, `!name/**`, `name/*`, nested pairs) rather than adding an undeclared dependency. Verified sufficient by binding every real category to `git check-ignore` itself (not to a hand-maintained expectation table), so a pattern shape this matcher gets wrong shows up as a real test failure rather than a silent gap    |
| DEV-T4-3 | 4 (4.2) | Design constraint (b): "the file `server/resources/prompts/.gitignore`" named literally in the warning text                                      | A workspace-overlay server (`MCP_WORKSPACE`) resolves prompts to a directory that is not this repo, so a literal repo-relative path could misname the file to edit in that deployment shape                                                                                                                                                                                                                                       | Kept the literal string per the design constraint, on the reasoning that the warning only fires when `readCategoryShipStatus` found a real `.gitignore` restricting the category — an overlay directory with no `.gitignore` of its own reports `ships: true` and never reaches the warning at all, so the literal path is accurate for every case that actually triggers it. Documented at the call site (`buildCategoryShipWarning`) rather than left implicit                               |

### Tier 4 validation ledger

| Date       | Command                                                                                                                                                                              | Result                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | `npm run typecheck`                                                                                                                                                                  | clean, no output                                                                                                                                                                                                                                           |
| 2026-08-12 | `npm run lint:ratchet` (first run, before import-order/quote/useless-assignment fixes)                                                                                               | `FAIL: 3 rule problems` — `import-x/order` +2, `no-useless-assignment` +1, `prettier/prettier` +2                                                                                                                                                          |
| 2026-08-12 | `npm run lint:ratchet` (after fixes: reordered `CategoryShipStatus` type import, dropped the useless `gitignoreText = ''` initializer, single-quoted the two `PromptError` messages) | `OK: 3199 errors, 1019 warnings (no regressions)`                                                                                                                                                                                                          |
| 2026-08-12 | `npm run typecheck:tests:ratchet`                                                                                                                                                    | `OK: 377 errors in tests/ (no regressions)`                                                                                                                                                                                                                |
| 2026-08-12 | `npm run test:match -- "file-operations\|resource-manager"`                                                                                                                          | 11 suites / 171 tests passed                                                                                                                                                                                                                               |
| 2026-08-12 | falsification A: `resolveCategoryShipStatus` neutered to always `return true`                                                                                                        | 20 failures — every real-category ground-truth mismatch (11) + both warn-response tests + the direct `ships:false` unit test; the "no .gitignore" and "ships:true" assertions stayed green as expected                                                     |
| 2026-08-12 | falsification B: OQ-P7-9's two `createPrompt` rejection blocks removed                                                                                                               | exactly 2 failures — the `rejects patch on create` / `rejects dry_run on create` tests, alone; all 12 other `prompt-lifecycle-processor` tests stayed green                                                                                                |
| 2026-08-12 | `md5sum` on all three source files, before and after both falsifications                                                                                                             | identical (`9ca33e9e…`, `223ec722…`, `8ca97cb6…`)                                                                                                                                                                                                          |
| 2026-08-12 | `git status --porcelain -- server/resources/prompts/.gitignore`                                                                                                                      | ` M server/resources/prompts/.gitignore` — the pre-existing 10-line foreign diff (documentation/development allow-entries), unchanged by this tier; `git diff --stat` confirms `1 file changed, 10 insertions(+)`, the same shape as before Tier 4 started |

### Findings raised during Tier 4 execution

- None rising to a P7-F number. The gitignore-purity requirement and the `ignore`-package
  temptation (DEV-T4-2) are the two things worth a future reader's attention, and both are
  recorded as deviations above rather than open findings — neither blocks or changes any other
  tier's work.

## Tier 5 — docs worker (row 5.3)

Scope: `docs/reference/mcp-tools.md` only. Every claim below verified against source with `rg`/`Read`
before writing; `--no-ignore` was not needed because all probes targeted `server/src/**`, not
`server/resources/prompts/**` (the P7-F4 hazard is a resources-tree-only concern).

### Deviations

| Authored                                                      | Measured                                                                                                                                                                                                                             | Action                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brief anchor "~581-583 argument docs"                         | Lines 581-583 (pre-edit) are the `Common Actions` table's `rollback`/`compare` rows — unrelated to `arguments`. The actual argument-parameter table ("Key Parameters by Resource Type" → Prompt Parameters) was at ~690-696 pre-edit | Edited the real location (now ~739-752 post-edit) plus the `arguments:[...]` example in the `create` bash block (~608-611); left the Common Actions table untouched since it was never about arguments |
| Brief anchors "~1083" and "~1108-1167" for versioning wording | Both anchors were accurate — line 1083 held the exact "saves a snapshot before changes" sentence named in the brief, and the rollback safety sentence fell inside 1108-1167 (at 1134)                                                | No drift; edited both in place                                                                                                                                                                         |
| Brief item 4, "PromptError messages around :51-68"            | Messages are at `prompt-lifecycle-processor.ts:57-69` — off by ~6 lines from tiers 2-4 landing between discovery and this row                                                                                                        | No content discrepancy, only line-number drift; documented from the current text                                                                                                                       |
| Brief item 5, "`buildCategoryShipWarning` ~:600"              | Exact match — `prompt-lifecycle-processor.ts:600`                                                                                                                                                                                    | No drift                                                                                                                                                                                               |

No claim in the brief contradicted source. One brief detail was already stale by the time this
row ran but is not a docs defect: item 1's `validation` field was framed as a given, and it _is_
real (`resource-manager.schema.ts:104`, added per DEV-T1-2 beyond the original interface sketch);
documented as authored.

### Per-claim verification

| Claim documented                                                                                                                                                     | Probe                                                                                                                                                                  | Result                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arguments` item: `type` 5-value enum, `required`, `defaultValue`, `validation` all optional                                                                         | `rg -n "arguments" src/mcp/tools/schemas/resource-manager.schema.ts` → `Read` lines 90-107                                                                             | `resource-manager.schema.ts:90-105`: `type: z.enum(['string','number','boolean','object','array']).optional()`, `required: z.boolean().optional()`, `defaultValue: z.unknown().optional()`, `validation: ArgumentValidationSchema.optional()` |
| `required:true` needs a `validation` block to arm enforcement                                                                                                        | `rg -n "hasValidationRules\|enrichResult" src/engine/execution/parsers/argument-parser.ts`                                                                             | `argument-parser.ts:708-722`: `enrichResult` runs the validator only when `hasValidationRules` (derived from `minLength`/`maxLength`/`pattern`) is true                                                                                       |
| `validation` fields are `pattern`, `minLength`, `maxLength`                                                                                                          | `rg -n "ArgumentValidationSchema" -A8 src/modules/prompts/prompt-schema.ts`                                                                                            | `prompt-schema.ts:24-31`: `pattern`, `minLength`, `maxLength` (+ one more field not surfaced in docs for brevity)                                                                                                                             |
| Preserved YAML fields on write: `injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`                                                        | `rg -n "injection\|registerWithMcp\|mcpPromptMode\|subagentModel\|agentType" src/mcp/tools/resource-manager/prompt/operations/file-operations.ts`                      | `file-operations.ts:57-63`: `PRESERVED_PROMPT_YAML_KEYS` names exactly these five                                                                                                                                                             |
| Go-forward numbering: version N = state edit N _produces_; self-healing bridge row when the latest snapshot doesn't match live state                                 | `rg -n "recordEditResult\|Bridge:\|BRIDGE" src/modules/versioning/version-history-service.ts` → `Read` lines 290-419                                                   | `version-history-service.ts:304-347`: `recordEditResult` bridges via `latestSnapshotMatches`, then saves the produced snapshot                                                                                                                |
| Rollback validates target first, then records "Rollback to vN" as a new version, no "pre-rollback snapshot" row                                                      | Same `Read` span                                                                                                                                                       | `version-history-service.ts:362-418`: `rollback()` calls `getVersion` before any write, returns early on a missing target, then calls `recordEditResult` with description `` `Rollback to v${targetVersion}` ``                               |
| `patch` item shape `{field, old_string, new_string, replace_all?}`; `field` enum `user_message_template \| system_message \| description`; `old_string` min length 1 | `rg -n "patch:" -A10 src/mcp/tools/schemas/resource-manager.schema.ts`; `Read template-patch.ts:20-38`                                                                 | `resource-manager.schema.ts:117-126`; `template-patch.ts:21-25` (`PATCH_TARGET_FIELDS`), `:29-38` (`TemplatePatchOperation`)                                                                                                                  |
| Rejection reasons: `empty_old_string`, `target_absent`, `anchor_not_found`, `anchor_ambiguous`                                                                       | `rg -n "PatchRejectionReason\|empty_old_string\|target_absent\|anchor_not_found\|anchor_ambiguous" src/mcp/tools/resource-manager/prompt/operations/template-patch.ts` | `template-patch.ts:40-48` — exactly these four, no `anchor_overlap` (dropped per DEV-T3-4)                                                                                                                                                    |
| A rejection blocks the whole update — nothing written, no version consumed                                                                                           | `rg -n "patch not applied" src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts`                                                               | `prompt-lifecycle-processor.ts:321`: rejection message states "Nothing was written and no version was consumed"                                                                                                                               |
| `patch` mutually exclusive with the same field as a full-body param; `description` collision named explicitly                                                        | `Read template-patch.ts:180-218`                                                                                                                                       | `template-patch.ts:189-217` — `PATCH_EXCLUSIVE_BODY_PARAMETERS` (`user_message_template`, `system_message`) plus a dedicated `description`-vs-patch-targeting-`description` check in `findPatchParameterConflict`                             |
| `dry_run:true` returns produced bodies + diff, stops before version recording                                                                                        | `Read prompt-lifecycle-processor.ts:614-634`                                                                                                                           | `renderDryRun` builds a diff via `textDiffService.generatePromptDiff` and is "the whole effect of the call" per its own docstring — reached before the version-record/write path                                                              |
| `create` explicitly rejects `patch` and `dry_run`                                                                                                                    | `rg -n "createPrompt" -A20 src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts`                                                               | `prompt-lifecycle-processor.ts:50-69` — two `PromptError` throws, checked before `validateRequiredFields`                                                                                                                                     |
| Ship-signal warning text: names the allowlist file, exact `!<category>/` + `!<category>/**` lines; workspace overlay with no `.gitignore` never warns                | `rg -n "buildCategoryShipWarning\|CategoryShipStatus" src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts` → `Read` lines 590-612             | `prompt-lifecycle-processor.ts:600-612`: exact warning text; docstring at `:592-598` states the no-`.gitignore` case reports `ships:true`                                                                                                     |

### Validation Ledger

| Date       | Command                                                                  | Result                                                                  |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 2026-08-12 | `npx prettier --check docs/reference/mcp-tools.md` (before edits)        | pass (baseline)                                                         |
| 2026-08-12 | `npx prettier --check docs/reference/mcp-tools.md` (after content edits) | `[warn] Code style issues found` — table column alignment               |
| 2026-08-12 | `npx prettier --write docs/reference/mcp-tools.md`                       | reformatted (own file, in-scope)                                        |
| 2026-08-12 | `npx prettier --check docs/reference/mcp-tools.md` (final)               | `All matched files use Prettier code style!`                            |
| 2026-08-12 | `git diff --stat -- docs/reference/mcp-tools.md`                         | `1 file changed, 76 insertions(+), 12 deletions(-)` (1289 → 1353 lines) |

No other file was touched; no `npm run build` was run.

## Tier 5 — main-thread deviations (rows 5.1, 5.2)

| Id       | Tier    | Authored                                                                              | Measured                                                                                                                                                                                                                                                                                                               | Action                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T5-1 | 5 (5.1) | Row 5.1 + plan §P7-D3 re-scope: "six" retired lines (5 stepNames + 1 discovery prose) | `rg --no-ignore "\(Phase "` measured SEVEN: the plan missed `implementation_plan/prompt.yaml:62` — the parent's `design_mode` argument prose, the same sentence as discovery's :31                                                                                                                                     | Relabeled all seven. The :62 line is the same defect in a file already in scope; leaving it would strand a `(Phase 2)` reference to a label that no longer exists. Scope-guard verify re-based to "zero `(Phase ` under planning/, out-of-scope counts unchanged" — both hold                                                                                                                             |
| DEV-T5-2 | 5 (5.1) | "replace with current step vocabulary" — no mapping table authored                    | The sub-prompts' own `name:` fields already carry the current vocabulary (`(Step N)`), and two labels had drifted beyond the suffix: `verification` is named `Verify-Paths (Step 3)` (label said `Verification (Phase 2.5)`), `plan_table` is named `Plan-Table (Step 4)` (label said `Implementation Plan (Phase 3)`) | New stepNames = the sub-prompt names verbatim. This is the "mappings read first" the master plan required: `chain_step_operation:"replace"` resends the whole `chain_steps` array (`applyChainStepOperation` case `'replace'` is a pass-through; the array arrives via `UPDATE_FIELDS`), so the full current entries were read from disk before the write                                                 |
| DEV-T5-3 | 5 (5.1) | MCP-tooling-only write, tool unspecified                                              | The session plugin server may run a pre-Tier-1 dist whose tool schema strips `required`/`defaultValue`/`validation` from resent argument arrays — a corrupting writer for exactly this edit                                                                                                                            | Drove a freshly built server (`npm run build` → spawned `--transport=streamable-http`, `MCP_WORKSPACE` = repo root) via scratchpad `p7-t5-relabel-drive.mjs`, raw JSON-RPC per `verify-mcp-surface.mjs`. Writer re-serialized argument field order to its canonical name/type/description/required; `required: true` on `feature` survived the round-trip — first client-reachable confirmation of Tier 1 |

### Tier 5 main-thread validation ledger

| Date       | Command                                                                           | Result                                                                                                           |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | `.gitignore` += `!planning/` + `!planning/**` (additive, after development block) | `git check-ignore -v` matches `!planning/**`; `git status` lists `?? server/resources/prompts/planning/` — ships |
| 2026-08-12 | relabel drive: parent update (chain_steps replace + arguments)                    | Version 2 saved, +20/-20, no ship warning (planning allowlisted)                                                 |
| 2026-08-12 | relabel drive: discovery update (arguments)                                       | Version 2 saved, +12/-12                                                                                         |
| 2026-08-12 | `rg -c --no-ignore "\(Phase "` post-drive                                         | zero under `planning/`; `dev-workflow` 2+5 and `vault_notes` 2 unchanged from baseline                           |
| 2026-08-12 | `npm run validate:format`                                                         | clean after prettier-fixing two P5 plan files (my own earlier writebacks — repad only)                           |
| 2026-08-12 | `npm run test:match -- "resource-manager"`                                        | 11 suites / 171 tests passed                                                                                     |

## Tier 6 — main-thread execution state (2026-08-12, in flight)

Flush of the seven source edits the Stop hook flagged; per-file disposition:

| File                                                            | Disposition                                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/resources/prompts/.gitignore`                           | Tier 5 OQ-P7-7 allowlist append (`!planning/` + `!planning/**`) — recorded in Tier 5 ledger above; foreign hunks untouched                                             |
| `docs/reference/mcp-tools.md`                                   | Row 5.3 docs worker output — recorded in its own Tier 5 section above                                                                                                  |
| `tests/integration/mcp-tools/p7-acceptance.integration.test.ts` | Row 6.1 NEW acceptance suite (4 tests, real `VersionHistoryService` + `SqliteEngine`); currently 4/4 green; falsification delegated to a background worker (in flight) |
| `src/.../prompt/utils/validation.ts`                            | P7-F14 fix: `canonicalPromptSnapshot` added beside `UPDATE_FIELDS`                                                                                                     |
| `src/.../prompt/services/prompt-lifecycle-processor.ts`         | P7-F14 fix: `beforeContent` + `promptData` base now project through `canonicalPromptSnapshot`                                                                          |
| `src/.../prompt/services/prompt-versioning-processor.ts`        | P7-F14 fix: `handleRollback` passes the projected snapshot as `currentSnapshot`                                                                                        |
| `src/.../prompt/operations/template-patch.ts`                   | NET-ZERO: falsification mutation A applied and restored, md5 `ab28e15b…` matches baseline                                                                              |

**P7-F14** (found and fixed this tier): the 6.1 suite's first run against a real engine caught spurious
bridge rows on every post-reload edit — raw `ConvertedPrompt` (loader keys, different key order) vs
canonical 10-key snapshot under order-sensitive `JSON.stringify`. Full statement in the plan's
Findings section. The mocked version seam in the Tier 3 suites structurally could not observe it —
the same integration-proven-is-not-end-to-end lesson as P5-F5/F6, one layer down.

**Delegation correction (3rd occurrence, logged to observations.jsonl)**: main thread wrote the 6.1
suite, the F14 fix, and ran mutation A inline, misreading "Tier 6 main-thread never-delegate" as
covering labor. It covers judgment only. Falsification (incl. diagnosing why clause (c) survived
mutation A — suspected weak assertion) is now with a sonnet worker; acceptance verdict, 6.2 live
drive interpretation, and rulings stay main-thread.

Open before Tier 6 closes: worker's falsification report + clause-(c) strengthening; 6.2 live drive
over BOTH transports (must include a second update to one prompt proving NO spurious bridge row —
the F14 regression observed over the wire); 6.3 writebacks + CHANGELOG; Tier 6 gate.

## Tier 6 — falsification worker (row 6.1)

**Scope**: mutation A (`template-patch.ts`), mutation B (`prompt-versioning-processor.ts`), against
`tests/integration/mcp-tools/p7-acceptance.integration.test.ts`. Barred from all git write
commands; every mutation applied via `Edit`, proven restored via `md5sum` — no `git checkout` used.

### Clause (c) survivor diagnosis

A prior run of mutation A (`return { ok: true, values, applied }` → `return { ok: true, values: {},
applied }`) measured (a)/(b)/rollback failing but (c) passing — suspicious for an applier neutered
to a no-op. Root cause: **`createHarness()` calls `SqliteEngine.getInstance(workspaceDir, logger)`,
and that method is a process-wide singleton — a later caller's `serverRoot` is silently discarded
once an instance exists** (`sqlite-engine.ts` `getInstance`: only an explicit `config.dbPath`
mismatch is checked; the harness never passes one). Clause (c) drives TWO harnesses
(`patched`, `full`) inside one test without disposing the first, so `full.history` and
`patched.history` both sat over the SAME underlying `state.db` for the SAME `PROMPT_ID`. Comparing
`patched.rowsByVersion.get(3)` against `full.history.getVersion(..., 3)` was, in the mutated run,
literally reading the same physical row twice (patched's own bridge/edit/patch rows at v1–v3; the
`full` harness's actual bridge/edit/full-update landed at v7–v9 in the shared table, never
inspected) — the comparison was structurally incapable of failing regardless of what either
harness's applier produced. Confirmed empirically: instrumented `console.log` of `fullRows[1..9]`
showed `full`'s v1–v3 held `patched`'s exact bridge/edit/patch content, and `fullLatest === 9`, not
the expected 3.

**Fix, two parts (test file only — no production code touched)**:

1. `createHarness()` now calls `await SqliteEngine.shutdownInstance();` immediately before
   `SqliteEngine.getInstance(workspaceDir, logger)` — forces a genuinely fresh singleton per
   harness instead of the second harness silently inheriting the first's open database. This is the
   actual root-cause fix; it also protects every other multi-harness test written against this file
   in future, not just clause (c).
2. Clause (c) gained two content-anchor assertions immediately after the `fullRow` null-check and
   before the existing `toEqual`/description compare: `patchRow?.snapshot['userMessageTemplate']`
   and the equivalent on `fullRow` must both equal `PATCHED_TEMPLATE` before the parity compare
   runs. This is redundant with the isolation fix under normal operation (both already prove
   `PATCHED_TEMPLATE` when the harnesses are genuinely isolated) but gives a loud, specific failure
   ("wrong template, not just a snapshot diff") if version-number alignment ever drifts again for a
   different reason. Neither change weakens what clause (c) already proved — the pre-existing
   `toEqual`/description assertions are unchanged and still run.

### Mutation A — measured failure set (after strengthening, before restore)

All 4 tests failed:

- clause (a): `filesAfterPatch['user-message.md']` did not contain `"Answer in bullets."` — write
  carried the unpatched (`EDITED_TEMPLATE`) body because `Object.entries(patchResult.values)` was
  empty, so `promptFields[dataKey]` was never assigned the patched text.
- clause (b): `rejectionResponseIsError` was `false`, not `true` — the syntax-error patch value
  never reached `promptData.userMessageTemplate` either (same empty-`values` mechanism), so
  `diagnosePromptWrite` validated the OLD, syntactically-valid body and the write was accepted
  instead of rejected.
- clause (c) (post-strengthening): failed at the new content anchor —
  `patchRow?.snapshot['userMessageTemplate']` was `"...Answer in paragraphs..."`, not
  `PATCHED_TEMPLATE` (`"...Answer in bullets..."`) — the applier genuinely never wrote the patched
  template into the recorded snapshot.
- rollback: `latestAfterRollback` was `6`, expected `4` — the neutered applier also broke clause
  (b)'s rejection path (a write that should have been blocked instead consumed a version), which
  cascaded into every subsequent version count in the drive.

### Mutation B — measured failure set

`buildRestoreFromSnapshot`'s REQUIRED-field loop mutated to write `''` for `userMessageTemplate`
instead of `snapshot['userMessageTemplate']` (recreates the snapshot-vs-live hybrid defect shape
P7-D2 mechanism 2 was written to prevent). Exactly one test failed:

- rollback: `filesAfterRollback['user-message.md']` was `""`, expected to contain
  `"Answer in paragraphs."` — the restored file lost the template body entirely.

(a), (b), (c) stayed green — none of those clauses exercise `handleRollback`/
`buildRestoreFromSnapshot`, so the mutation is invisible to them. Confirms distinct failure sets:
mutation A ⊇ {a, b, c, rollback}; mutation B = {rollback} only — B's set is a strict, single-element
subset of A's, not overlapping with A on any clause A does not already cover, and isolates
`buildRestoreFromSnapshot` specifically (nothing else in the drive shares that code path).

### Restore proof (md5, no git write commands used)

| File                             | Baseline md5                       | Post-mutation-A restore                        | Post-mutation-B restore                        |
| -------------------------------- | ---------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `template-patch.ts`              | `ab28e15bdad737509debb9a493701af5` | `ab28e15bdad737509debb9a493701af5` (match)     | unchanged (mutation B never touched this file) |
| `prompt-versioning-processor.ts` | `69448f707795e2e6e9a30364a7b1fc2d` | unchanged (mutation A never touched this file) | `69448f707795e2e6e9a30364a7b1fc2d` (match)     |

### Validation ledger

| Command                                                                                                          | Result                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:match -- "p7-acceptance"` (both files restored, clause (c) strengthened)                           | `Tests: 4 passed, 4 total`                                                                                                                                                                                                                                              |
| `npm run test:match -- "p7-acceptance\|prompt-patch-update\|resource-manager\|file-operations\|version-history"` | `Test Suites: 16 passed, 16 total` / `Tests: 254 passed, 254 total`                                                                                                                                                                                                     |
| `npm run typecheck`                                                                                              | 9 pre-existing errors, all in `prompt-lifecycle-processor.ts` (3) and `validation.ts` (6) — both files carry unrelated uncommitted P7-F14 work from another party (`git status` shows them `M`, not touched by this worker); zero errors in any file this worker edited |
| `npm run lint:ratchet`                                                                                           | `[eslint-ratchet] OK: 3199 errors, 1017 warnings (no regressions)`                                                                                                                                                                                                      |
| `npm run typecheck:tests:ratchet`                                                                                | `[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)` — confirms the clause (c) strengthening added no new test-side type debt                                                                                                                          |

**Out-of-scope observation**: `SqliteEngine.getInstance`'s singleton silently discards a later
caller's `serverRoot` whenever no explicit `dbPath` is supplied (only a `dbPath` mismatch throws).
This is a real test-isolation hazard beyond this one suite — any future test file that builds two
harnesses without disposing the first will alias state the same way clause (c) did. The production
code comment already documents the ordering hazard for `dbPath`; it does not mention the
`serverRoot`-is-ignored case. Not fixed here (out of scope — falsification worker is barred from
touching anything beyond the two named mutation targets and the test file's own assertions).

### OQ-P7-8 — RULED 2026-08-13 (owner, AskUserQuestion)

**All five preserved fields become settable via optional `resource_manager` tool params**:
`injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`. Additive union
members, non-breaking. Owner chose full authorability over the recommended subset, accepting the
resolution-freeze hazard on `registerWithMcp`/`mcpPromptMode` (mitigation: parameter descriptions
must state that an explicit value overrides category/global defaults permanently until unset) and
the `injection` sub-schema cost. Implementation dispatched to an opus worker (decision-bearing:
canonical-snapshot widening + rollback-restore interplay).

## OQ-P7-8 — implementation worker

Opus worker, 2026-08-13. Implements the owner ruling above: all five preserved prompt fields are
settable through `resource_manager` `create` and `update`. Additive union members only — a caller
that sends none of them sees the previous behaviour byte for byte.

### Deviations

| ID        | Brief said                                                                                        | Source says                                                                                                                                                                                                                                                                                                                                                 | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-P78-1 | "`subagentModel`/`agentType` strings"                                                             | `PromptYamlSchema` declares `subagentModel: z.enum(['heavy','standard','fast'])` and `agentType: z.string().min(1)` (`prompt-schema.ts:485-487`)                                                                                                                                                                                                            | Mirrored the enum and the `min(1)`. A `z.string()` here would be accepted at the call and rejected at LOAD, where the prompt is dropped with only a log line — the exact failure shape Tier 1's `type` narrowing existed to close                                                                                                                                                                                                                                                                                                                                      |
| DEV-P78-2 | Parameters named `injection`, `registerWithMcp`, `mcpPromptMode`, `subagentModel`, `agentType`    | Those are the YAML FIELD names. Across all four tool contracts, 70/70 parameters are snake_case with zero camelCase                                                                                                                                                                                                                                         | Parameters are `injection`, `register_with_mcp`, `mcp_prompt_mode`, `subagent_model`, `agent_type`. `UPDATE_FIELDS` owns the single mapping to the camelCase YAML keys, exactly as it already does for `gate_configuration` → `gateConfiguration`. The ruling's substance (all five settable) is unchanged; five camelCase parameters beside 39 snake_case ones is a parameter-construction hazard the contract convention exists to prevent                                                                                                                           |
| DEV-P78-3 | "widen the canonical snapshot to include the five fields with preserve-if-present semantics"      | `PromptConverter` RESOLVES `registerWithMcp` and `mcpPromptMode` through prompt → category → global → hard-coded default (`converter.ts:28-64`) and assigns both UNCONDITIONALLY (`converter.ts:160-162`). "If present" is therefore always true for those two on any live prompt                                                                           | Projected THREE (`injection`, `subagentModel`, `agentType` — the converter copies these verbatim and only when declared, `converter.ts:165-177`), refused two. Projecting the resolved pair would put an inherited default into `promptData` on EVERY update, and `promptData` outranks the writer's on-disk preservation — freezing the prompt against its category/global default on every unrelated edit, with no caller asking. That is DEV-T1-3's hazard made unconditional, one layer up. Named `SNAPSHOT_PRESERVED_FIELDS` with the reasoning at the definition |
| DEV-P78-4 | "extend RESTORED_OPTIONAL for the other three"                                                    | Two mechanisms block the resolved pair. (1) DEV-P78-3 means nothing makes a snapshot COMPLETE for them, so restoring is partial either way. (2) `version_history` is durable and pre-P7 rows were recorded from a raw `ConvertedPrompt`, so a recorded `registerWithMcp: true` may be the RESOLVED value — indistinguishable per-field from an authored one | Extended for `injection` only. `registerWithMcp`/`mcpPromptMode` stay in `SNAPSHOT_FIELDS_LEFT_TO_THE_WRITER` (now a two-element set) with the reason rewritten to name both mechanisms. Cost is bounded and stated in the docs: those two keep their on-disk value across a rollback                                                                                                                                                                                                                                                                                  |
| DEV-P78-5 | "the partition invariant test will need its expectations moved, not deleted"                      | Disjointness was a PROXY for "no two write models", and it held only while the preserved fields had no parameter                                                                                                                                                                                                                                            | Retired the proxy, kept the property. `makes every preserved field settable, and nothing else settable-and-preserved` pins the exact overlap; a new sibling pins that every such parameter is one the input schema MODELS (`.passthrough()` otherwise lets a `UPDATE_FIELDS` key with no schema member look wired). The coverage assertion above them is unchanged                                                                                                                                                                                                     |
| DEV-P78-6 | Named `argument-contract.test.ts`, `prompt-lifecycle-processor.test.ts`, patch/integration suites | `section-update.test.ts:9` asserts `UPDATE_FIELDS` with `toEqual` — an exhaustive pin the brief did not name, and the first thing the change broke                                                                                                                                                                                                          | Extended it with the five entries listed literally, not spread from `PRESERVED_PROMPT_YAML_KEYS`: importing the growth into the assertion that exists to NOTICE growth would defeat it                                                                                                                                                                                                                                                                                                                                                                                 |
| DEV-P78-7 | "does create accept them too? yes"                                                                | Confirmed against `createPrompt` — it builds `promptData` from an explicit literal and never consults `UPDATE_FIELDS`                                                                                                                                                                                                                                       | Added the merge to `create` through the SAME `UPDATE_FIELDS` map filtered by `PRESERVED_PROMPT_YAML_KEYS`, so the two paths cannot drift into different vocabularies (the accepted-here/ignored-there asymmetry P7-D4 exists to kill). Supplied-only: an undefined value would be a key the preservation resolver has to ignore, and on `create` there is no file to fall back to                                                                                                                                                                                      |
| DEV-P78-8 | —                                                                                                 | First implementation of the `create` merge read `args[argKey]` directly, adding 3 `no-unsafe-member-access` warnings and failing `lint:ratchet` (baseline=431, current=434)                                                                                                                                                                                 | Narrowed once into `suppliedArgs`/`promptFields`, matching `updatePrompt`'s existing pair. Ratchet back to `OK: 3199 errors, 1017 warnings`                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Layer consistency (mcp-contracts.md §Layer Consistency Requirements)

| Layer     | File                                                                           | Verified                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema    | `src/mcp/tools/schemas/resource-manager.schema.ts`                             | Five members added, each mirroring `PromptYamlSchema` field-for-field (`PromptInjectionConfigSchema` value-imported — `src/mcp/tools/schemas/` is the declared exemption in `.dependency-cruiser.cjs` `tool-layer-no-validator-value-imports`, `validate:arch` 0 errors)                                          |
| Contract  | `tooling/contracts/resource-manager.json`                                      | Five parameter entries + both `prompt:create` / `prompt:update` command lists. Types match the Zod exactly (`enum[expand\|launch]`, `enum[heavy\|standard\|fast]`, `boolean`, `string`, `object`). FREEZE HAZARD stated in the `register_with_mcp` and `mcp_prompt_mode` descriptions per the ruling's mitigation |
| Generated | `src/mcp/contracts/schemas/_generated/resource_manager.generated.ts`           | Regenerated via `npm run generate:contracts`; `validate:contracts` green. Never hand-edited. `tool-descriptions.contracts.json` unchanged (`includeInDescription: false`)                                                                                                                                         |
| Types     | `src/mcp/tools/resource-manager/core/types.ts`                                 | Five optional members, same names and same types; `PromptInjectionConfigYaml` type-only import                                                                                                                                                                                                                    |
| Router    | `src/mcp/tools/resource-manager/core/router.ts`                                | Five pass-throughs in `routeToPromptResource`, NO renaming. `PromptResourceHandler.handleAction` takes `[key: string]: any`, so no third type layer exists                                                                                                                                                        |
| Processor | `prompt/services/prompt-lifecycle-processor.ts` + `prompt/utils/validation.ts` | `UPDATE_FIELDS` performs the one snake_case → camelCase mapping, consumed by `update` (existing loop) and `create` (new filtered loop)                                                                                                                                                                            |
| Writer    | `prompt/operations/file-operations.ts`                                         | Unchanged code. `resolvePreservedPromptYamlFields`'s explicit branch — dead since Tier 1 — is now the reachable precedence rule; its doc comment says so                                                                                                                                                          |

### Canonical-snapshot decision as implemented

`canonicalPromptSnapshot` goes from 9 keys to 9 + preserve-if-present over
`SNAPSHOT_PRESERVED_FIELDS = ['injection', 'subagentModel', 'agentType']`. Absent on the source
stays absent from the projection; nothing is defaulted.

The rule the set encodes: **a field may be projected only when the projection source holds its
AUTHORED value.** Without the projection, a snapshot recorded by an unrelated edit omits a field
the file still carries, so a rollback to that version restores a prompt the version never
described — it lands on whatever on-disk preservation happens to be holding at rollback time. With
it, every snapshot recorded from here describes those three fields completely.

Bridge-comparison soundness is unchanged: both sides of every compare still come from this one
projection, and both call sites (`updatePrompt`, `handleRollback`) still pass the same source
object. One-time cost: the first edit to a prompt that declares one of the three will see the last
pre-P78 snapshot as structurally different and record a bridge row. That is correct — the old
snapshot really was incomplete.

Restore side: `RESTORED_OPTIONAL_SNAPSHOT_FIELDS` gains `injection` (7 entries).
`SNAPSHOT_FIELDS_LEFT_TO_THE_WRITER` drops to `['registerWithMcp', 'mcpPromptMode']`.

### Falsification (Edit-revert; no git write commands used)

| Mutation                                                                       | Failure set                                                                                                                                                                                                                                                                                      | Reads as                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — delete `subagent_model: 'subagentModel'` from `UPDATE_FIELDS`              | 6 failures / 3 suites: `update sets subagent_model`, `create sets subagent_model`, `an explicit value outranks the projected live value`, `makes every preserved field settable…`, `routes every preserved field through a parameter…`, `UPDATE_FIELDS map › maps all expected MCP param names…` | Per-field tests name the field; the two partition invariants catch it independently of them. Not "fails alone" by design — a dropped entry SHOULD trip the invariant that exists for it                                                                                           |
| B — delete the `SNAPSHOT_PRESERVED_FIELDS` loop from `canonicalPromptSnapshot` | 1 failure: `an unrelated update carries the three authored preserved fields forward`. `p7-acceptance` stayed 4/4                                                                                                                                                                                 | Isolates the projection specifically — nothing else in the gate suite exercises it, and the acceptance drive's prompts declare none of the three                                                                                                                                  |
| C — delete `'injection'` from `RESTORED_OPTIONAL_SNAPSHOT_FIELDS`              | 1 failure: `restores an injection block the snapshot recorded, overriding the authored one`                                                                                                                                                                                                      | Isolates the restore half. Distinct from B's set — B is the record side, C is the restore side, and neither test covers the other's code path                                                                                                                                     |
| D — delete `subagent_model: args.subagent_model` from `routeToPromptResource`  | 1 failure: `passes the five preserved-field parameters through to the prompt handler`                                                                                                                                                                                                            | The reason that assertion was added. `routeToPromptResource` builds an explicit key whitelist, so an omitted key is dropped silently — schema accepts, processor runs, field never arrives — and every processor test calls `updatePrompt` directly, never crossing this boundary |

Restore proof (md5 taken before each mutation, re-measured after each revert):

| File                                             | Pre-mutation md5                   | Post-restore md5                           |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------ |
| `prompt/utils/validation.ts`                     | `0e758549de377c993b47733021180e86` | `0e758549de377c993b47733021180e86` (match) |
| `prompt/services/prompt-versioning-processor.ts` | `f5f7bb987c03ec45acd40d03f97513aa` | `f5f7bb987c03ec45acd40d03f97513aa` (match) |
| `core/router.ts`                                 | `3f962c3308299b6a3d307d673a3e4bcb` | `3f962c3308299b6a3d307d673a3e4bcb` (match) |

### Validation ledger

| Command                                                                                                                                 | Result                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                     | clean, 0 errors                                                                                                                                     |
| `npm run lint:ratchet`                                                                                                                  | `[eslint-ratchet] OK: 3199 errors, 1017 warnings (no regressions)`                                                                                  |
| `npm run typecheck:tests:ratchet`                                                                                                       | `[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)`                                                                               |
| `npm run validate:contracts`                                                                                                            | `[generate-contracts] Complete`                                                                                                                     |
| `npm run test:match -- "resource-manager\|file-operations\|version-history\|prompt-patch"`                                              | `Test Suites: 15 passed, 15 total` / `Tests: 280 passed, 280 total`                                                                                 |
| `npx jest tests/unit` (beyond the gate — the schema is MCP-registered, so blast radius is wider)                                        | `Test Suites: 185 passed, 185 total` / `Tests: 2380 passed, 2380 total`                                                                             |
| `npm run test:match -- "p7-acceptance"` (beyond the gate — matches none of the gate patterns despite exercising the snapshot machinery) | `Tests: 4 passed, 4 total`                                                                                                                          |
| `npm run validate:arch`                                                                                                                 | `4 dependency violations (0 errors, 4 warnings)` — all four pre-existing `engine-cross-layer-type-only` warnings on files this worker did not touch |
| `npx prettier --check docs/reference/mcp-tools.md`                                                                                      | `All matched files use Prettier code style!`                                                                                                        |

### Smelled wrong / out of scope

- **`docs/reference/mcp-tools.md` is foreign-dirty.** Only the **Prompt Parameters** table and the
  prose directly under it were touched, per the brief. Prettier initially failed on the file; the
  offending lines were verified to be MINE alone by diffing `npx prettier <file>` stdout against
  the file, and only my own table was re-padded. No foreign hunk was reformatted or reverted.
- **The contract's `commands` arrays are value-dead.** `generate-contracts.ts:216` emits
  `RESOURCE_MANAGER_COMMANDS: ToolCommand[]`, and `rg` finds readers only inside the four
  `_generated/*.ts` files themselves. The five parameters were added to `prompt:create` and
  `prompt:update` anyway so the contract's own description of those actions stays honest — but
  nothing consumes it, and `patch`/`dry_run` were never added there either. Same shape as the
  `v_execution_history` finding in `sqlite-persistence.md`: an artifact generated for a reader that
  does not exist.
- **`PromptData.registerWithMcp` is the only in-process AUTHORED source for the resolved pair.**
  `yamlToPromptData` spreads it through untouched (`yaml-prompt-loader.ts:501-505`), so
  `context.getData().promptsData` could make the canonical snapshot complete for all five and
  retire DEV-P78-4's first mechanism. Not done: it needs a second source threaded into
  `canonicalPromptSnapshot` and both its call sites, no existing test harness supplies
  `promptsData` (`p7-acceptance` and the lifecycle suites stub `getData` with `convertedPrompts`
  only), and DEV-P78-4's SECOND mechanism — legacy durable rows carrying resolved values — would
  still block the restore. Recorded as the shape a future ruling would take, not as a defect.
- **`collectPromptWriteDefects` still projects only 9 keys** (`validation.ts`), so the pre-write
  produced-state check does not see the five. Left alone deliberately: the tool-side Zod already
  enforces every shape they can arrive in, and preserved on-disk values were validated at load.

## Tier 6 — rows 6.1/6.2 execution (main-thread, 2026-08-13)

**6.1 (acceptance suite)**: `p7-acceptance.integration.test.ts` 4/4 against a real
`VersionHistoryService` + `SqliteEngine`. Its FIRST run caught P7-F14 (spurious bridge rows —
fixed via `canonicalPromptSnapshot`, see plan Findings). Falsification worker: clause (c)'s
survival diagnosed as `SqliteEngine.getInstance` singleton aliasing both twin harnesses onto one
row set (a general test-isolation hazard, recorded); fixed with per-harness `shutdownInstance()` +
content anchors. Post-fix: mutation A (neutered applier) fails all 4; mutation B (broken
exact-restore) fails rollback ONLY — distinct sets. md5 restores proven. OQ-P7-8's worker added a
router-whitelist mutation (D) after finding no test crossed that boundary — silent param drop now
has a discriminating test.

**6.2 (live drive, both transports)**: `p7-62-live-drive.mjs`, 18/19.

- PROVEN over the wire (streamable-http): create with all five OQ-P7-8 params + ship-warning on
  untracked category · two consecutive updates with NO spurious bridge (F14 regression live,
  v2→v3) · one-section patch · clean anchor rejection · dry_run without write · go-forward history
  with zero "Pre-rollback snapshot" rows · rollback consuming one version · five params in YAML ·
  authored fields surviving rollback · tool-delete cleanup.
- PROVEN over stdio: create/patch/rejection/rollback/delete parity.
- The 1 FAIL is an assertion-surface artifact, not a defect: `inspect` renders a summary without
  the template body, so the "rollback landed" grep targeted text inspect never prints. The landing
  is proven by the inspected description equaling the target version's state and the on-disk YAML.
- Drive iterations surfaced **P7-F15** (writer/loader path split under a scratch resources root —
  see plan Findings) and left ZERO residue: all fixtures tool-deleted, `debugging/` back to
  `analyze_logs` only. Two earlier iterations also wrote fixtures into the repo tree via P7-F15;
  both were tool-deleted the same way.
- stdio client note: the server answers `initialize` only after startup completes (~3s); the drive
  retries initialize with a 4s per-attempt timeout rather than assuming instant readiness.

**Tier 6 full gate**: running (background) — record appended on completion.

### Tier 6 gate — first run failures, all remediated 2026-08-13 (main-thread)

| Failure                                                                    | Ownership                                                                                                                                                                       | Remediation                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate:format` — master plan + P5 notes                                 | mine (python writebacks)                                                                                                                                                        | prettier --write, repad only                                                                                                                                                                                                           |
| `validate:readme` — claim "31 prompts across 6 categories" vs shipped 37/7 | mine by consequence — OQ-P7-7's `planning/` allowlisting added exactly +6 prompts +1 category                                                                                   | two-number correction in README.md:169 (foreign-dirty file; edit is the checker's own named fix and touches no foreign hunk)                                                                                                           |
| `validate:plan-row-tracking` — satisfied exception                         | mine to retire — the grandfathered P5 entry's `closedBy` ("that plan stamping its own open rows, or reaching a terminal status") arrived when rows 4.4/4.5/5.5 all landed today | entry deleted same-day per the satisfied-exception rule the gate itself enforces                                                                                                                                                       |
| `plans:retire:check` — 4 foreign untracked plans with no frontmatter       | foreign (another session's client-install-cta + documentation-governance pairs)                                                                                                 | ADDITIVE frontmatter headers only, content untouched; status honest to their own "**Status:** COMPLETE" bodies (`done`/`reference`); safe because retire `--apply` is fail-closed against uncommitted plans (guard added this session) |

Gate re-running; record appended on completion.
