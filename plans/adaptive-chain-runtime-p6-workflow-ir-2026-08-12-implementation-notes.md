---
title: "P6 — Workflow IR: implementation notes"
date: 2026-08-12
status: active
tags: [adaptive-chain-runtime, chains, workflow-ir, implementation-notes]
---

# P6 — Implementation Notes

**Plan**: `adaptive-chain-runtime-p6-workflow-ir-2026-08-12.md`
**Master plan**: `adaptive-chain-runtime-2026-08-09.md` §P6 (finalizes D1)

This file is the sibling deviation log. It owns what the plan file must not carry: full ruling
rationales, per-tier deviation rows (`DEV-T<tier>-<n>`), and the validation ledger. The plan file
owns tier tables, open questions and findings.

Created before the first edit, per the deviation-log-has-no-gate lesson — nothing checks that this
file exists, so it is created at planning time rather than at execution time.

## Rulings

No open question has been ruled. All ten (OQ-P6-1 … OQ-P6-10) are OPEN in the plan file with a
recommended default and at least one alternative. The planning agent deliberately did not
self-rule: rulings belong to the main thread, which reviews the plan, decides, and records each
ruling here with its rationale **before** dispatching the tier that the question precedes.

When a question is ruled, add a `### OQ-P6-<n> — <subject> → RULED: <verdict>` subsection below
with the rationale, and flip its plan-file status to `RULED → notes §Rulings`.

Two rulings gate more than one tier and should be taken first: **OQ-P6-2** (graph vs ordered list)
determines what Tiers 4-5 build at all, and **OQ-P6-1** (D1 final) determines where it is reachable
from. Ruling either one late means re-authoring the tier that depends on it.

| Id       | Precedes         | Ruling    | Date | Rationale |
| -------- | ---------------- | --------- | ---- | --------- |
| OQ-P6-1  | Tier 5           | _pending_ | —    | —         |
| OQ-P6-2  | Tier 4           | _pending_ | —    | —         |
| OQ-P6-3  | Tier 4           | _pending_ | —    | —         |
| OQ-P6-4  | Tier 1           | _pending_ | —    | —         |
| OQ-P6-5  | Tier 3           | _pending_ | —    | —         |
| OQ-P6-6  | Tier 6           | _pending_ | —    | —         |
| OQ-P6-7  | Tier 6 (6.4)     | _pending_ | —    | —         |
| OQ-P6-8  | Tier 4           | _pending_ | —    | —         |
| OQ-P6-9  | Tier 6 (6.3)     | _pending_ | —    | —         |
| OQ-P6-10 | Tier 4 (4.4-4.5) | _pending_ | —    | —         |

## Deviations

Log format: one row per deviation, id `DEV-T<tier>-<n>`. Record what the plan **authored**, what
was **measured**, and which option was **taken**. Conservative option, log it, keep going.

A deviation is warranted whenever a probe contradicts a plan row — including a row that turns out
to be a no-op, a file:line that has drifted, or a verify command that under-reaches. A row measured
as already-closed is a deviation, not a silent skip.

**Falsification protocol** (binds every tier, from P7 DEV-T1-1): workers are barred from
`git stash` and `git checkout` — the tree carries several other parties' uncommitted work. Falsify
by reverting your own hunks with `Edit`, running the suite, then restoring and proving byte
identity with `md5sum`. Record both the failure set and the restored hashes.

| Id  | Tier | Authored | Measured | Action |
| --- | ---- | -------- | -------- | ------ |
| —   | —    | —        | —        | —      |

## Validation Ledger

One row per gate run, with the exact command and the counts it produced, so a later reader can
tell a real green from a remembered one. A gate run with no counts recorded is not a gate run.

| Date | Tier | Command | Result |
| ---- | ---- | ------- | ------ |
| —    | —    | —       | —      |

## Findings raised during execution

Findings measured while executing land here first with their evidence, then get promoted to the
plan file's §Findings and from there to the master plan's Findings Ledger at row 6.5. Findings
raised at planning time (P6-F1 … P6-F9) are already in the plan file.

## Validation runs

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

### Rulings round 1 — 2026-08-13 (owner, AskUserQuestion)

| Id      | Ruling                                                                                                                                                                                                     | Rationale                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-P6-1 | **RULED: `prompt_engine.workflow` param** (recommended default)                                                                                                                                            | No fourth tool, no new resource type; additive union member per the `observations` precedent                                                                                                                                                                                                                                                                                             |
| OQ-P6-2 | **RULED: accept `nodes[]+edges[]`, validate acyclic, linearize deterministically** (recommended default)                                                                                                   | Ambiguous orderings are typed rejections; edges only ever compile to an order — there is no graph runtime (premise correction 1)                                                                                                                                                                                                                                                         |
| OQ-P6-3 | **RULED: structural caps enforced with named reasons; declared cost ceilings recorded on existing telemetry, not enforced** (recommended default)                                                          | Server cannot meter client tokens reliably; a bad estimator turns a cap into noise                                                                                                                                                                                                                                                                                                       |
| OQ-P6-4 | **RULED: hoist ALL of `normalizeDelegation` above stage 06's operators-empty exit, with its own guard** — owner chose the BROADER alternative over the recommended narrow `markDelegatedStepPrompts` hoist | Broader consistency across the pipeline. Consequence for Tier 1: larger blast radius than planned (~the full normalization moves, not one marker) — Tier 1's worker brief must re-trace ALL consumers of the early-exit path for the full normalization, and the tier's ~line estimate grows. The 1-of-17 chain survey still bounds the behavioral exposure of delegation marking itself |

Round 2 (OQ-P6-5..10) pending. OQ-P6-7 is already fully resolved by prior owner rulings recorded
in the P5 notes (row 4.5 stays P5's and is implemented by a dispatched worker; row 5.5 was
dispatched immediately as its own docs worker, landed and accepted 2026-08-13 — NOT folded into
P6 6.4). P6 6.4's chain-schema.md scope should be re-checked against the landed 5.5 diff before
execution: the table now documents all 12 ChainStepSchema fields.

### Rulings round 2 — 2026-08-13 (owner, AskUserQuestion)

| Id      | Ruling                                                                                                           | Rationale / consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-P6-5 | **RULED: reserved `outputs.<name>` namespace** — owner chose the ALTERNATIVE over the recommended provenance map | Structurally clean separation. CONSEQUENCE for Tier 3: every shipped template consuming a mapped output must migrate in the SAME tier (cleanup-standards: no dual-read parallel system). Tier 3's worker must first enumerate consumers: `rg --no-ignore` over `server/resources/` for every `outputMapping` alias referenced in templates, and the migration itself goes through `resource_manager` (MCP-tooling-only). Tier 3 estimate grows accordingly; the P6-F2 measurement (mapping values never read) means the runtime side is a rewrite, not a rename |
| OQ-P6-6 | **RULED: the delegation-contract plan owns P5-F1/S-F1** (recommended)                                            | P6 references the outcome, never decides it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| OQ-P6-8 | **RULED: wire `inlineGateIds` now** — owner chose the ALTERNATIVE                                                | IR gate bindings AND the YAML field both become real. CONSEQUENCE: behavior change for the 3 shipped chains declaring `inlineGateIds` — the Tier 4 worker must enumerate them (`rg --no-ignore`), verify their gates resolve, and the acceptance drive must cover one of them. `docs/reference/chain-schema.md:30` ("not yet wired — no runtime effect", written 2026-08-13 by P5 row 5.5) must be updated in the same tier                                                                                                                                     |
| OQ-P6-9 | **RULED: delete `perGateVerdicts` + `ChainOperator.hasDelegation`, no inverse gate this phase** (recommended)    | Same-PR removal per cleanup-standards; detector gate remains P7-T10 backlog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Still open: OQ-P6-10 (contract artifact home + consumption idiom).

### Ruling round 3 — 2026-08-13 (owner, AskUserQuestion)

| Id       | Ruling                                                                                                                | Rationale                                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-P6-10 | **RULED: own contract artifact `tooling/contracts/workflow-ir.json` + `docs/reference/workflow-ir.md`** (recommended) | First first-party resource-shape artifact; the consumption idiom is hereby fixed: `generate:contracts` emits metadata/description output, hand-written Zod remains the validation SSOT — the same split every existing tool uses. No new loader |

**All 10 OQs ruled as of 2026-08-13.** Tier dispatch may begin. Tier 1's scope is the BROADENED
OQ-P6-4 ruling (full `normalizeDelegation` hoist), not the plan row's original narrow text.

## Tier 2 — worker execution

Scope executed: **rows 2.1 (declaration) and 2.4 (positional → node-address reader switch)**, plus
the tests for both. Rows 2.2, 2.3, 2.5 and 2.6's cold-load half are **not** this worker's rows —
their measured status is recorded as deviations below. Plan row statuses are deliberately NOT
flipped here.

### Files touched

| File                                                                           | Δ                       |
| ------------------------------------------------------------------------------ | ----------------------- |
| `server/src/shared/types/chain-session.ts`                                     | +18                     |
| `server/src/engine/execution/formatting/response-assembler.ts`                 | +142 / −20 (net)        |
| `server/src/mcp/tools/prompt-engine/core/pipeline-builder.ts`                  | +6 / −1                 |
| `server/src/shared/types/chain-execution.ts`                                   | +4 / −2 (stale comment) |
| `server/src/modules/prompts/prompt-schema.ts`                                  | +5 / −2 (stale comment) |
| `server/tests/unit/chain-session/chain-session-store.test.ts`                  | +44                     |
| `server/tests/unit/execution/formatting/response-assembler-visibility.test.ts` | +202                    |

Total: 7 files, +401 / −20. No file outside this list was touched; none of the foreign-dirty set
(Verify-Path 4), stage 06, or the delegation-normalization files were opened for edit.

### Deviations

| Id       | Tier | Authored                                                                                                                | Measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ---- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T2-1 | 2    | Row 2.1: declaring `nodeId` on `ParsedCommandSnapshot.steps` removes "the casts at the reader sites"                    | There is **no reader that reaches `nodeId` through the snapshot type** — the type forbade it, which is why none exists. The only `as`-cast on the path is `blueprint.parsedCommand as ParsedCommand` (`chain-blueprint-resolver.ts:59,83`), a **whole-object structural widening** that survives the declaration untouched: the snapshot still lacks `promptId`/`stepNumber`/`args`, all REQUIRED on `ChainStepPrompt`. That cast is P6-F8 (four hand-written copies of the step shape), not P4-F2              | Declared the field and proved the contract by **compile-time** falsification instead of by cast deletion (M3 below). Recorded that the resolver cast is out of Tier 2 scope and belongs to whatever closes P6-F8                                                                                                                                                                                                                                                                          |
| DEV-T2-2 | 2    | Row 2.3: `buildChainNodes` "reads the declared field; drop the cast" (`13-session-stage.ts:352-368`)                    | The cast there is `step.nodeId as string` / `fallbackIds[index] as string` — **index/narrowing noise required by `noUncheckedIndexedAccess: true`**, not a structural cast. `buildChainNodes` reads `context.parsedCommand.steps`, already the full `ChainStepPrompt[]`; the declaration changes nothing for it. Every cast-free rewrite tried either introduces a **third** `n${index+1}` id formula beside `mintSequentialIds` (SSOT violation) or swaps `as` for `!`, which lints as `no-non-null-assertion` | **Left unchanged.** Conservative option: a cast that is worse to remove than to keep is not the P4-F2 defect. Flagged for the owner                                                                                                                                                                                                                                                                                                                                                       |
| DEV-T2-3 | 2    | Row 2.2: emit `nodeId` explicitly into the stage-04 snapshot projection "instead of relying on the JSON-clone accident" | **Already done at HEAD.** `04-parsing-stage.ts:145` emits `nodeId: nodeIds[index]` explicitly on the direct path; the symbolic path mints at `:147,155` per the plan's own Discovery. Row 2.2 is a no-op                                                                                                                                                                                                                                                                                                        | Recorded as an already-closed row (a no-op row is a deviation, not a silent skip). No edit made                                                                                                                                                                                                                                                                                                                                                                                           |
| DEV-T2-4 | 2    | P6-F1 is "`resolveHandoffVisibility` indexes `steps[nextStepIndex]` positionally"                                       | Measured narrower AND wider than authored. The **target** lookup was already node-anchored — `findNextDelegatedStep` resolved the CURRENT step by node id (`:505-511`) — and then took `currentIndex + 1`, a positional step from a node-addressed anchor. So the defect is the **offset**, not the index read; and it has a **second half the finding does not name**: `priorDeclarations: steps.slice(0, nextStepIndex)` carries the `withhold` of steps the mutation policy RETIRED, which never ran         | Fixed both halves. The target now comes from the run's live node list; priors are filtered against `skippedNodeIds`. Two separate mutations (M1, M2) prove the two halves are independently load-bearing                                                                                                                                                                                                                                                                                  |
| DEV-T2-5 | 2    | —                                                                                                                       | `ResponseAssembler` had an empty constructor and no access to run facts; `SessionContext` carries `currentNodeId` but no node ORDER and no retired-node list, so the parse array was the only thing it could ask                                                                                                                                                                                                                                                                                                | Injected `RunStepViewProvider` as an **optional last** constructor parameter, following the established seam (`GateEnhancementService`, `TemporaryGateRegistrar` take the same provider; `createRunStepViewProvider` already exists at `pipeline-builder.ts:245`). Optional means all 8 existing `new ResponseAssembler()` sites in `tests/` compile unchanged AND take the pre-P6 code path — which is what makes the byte-identical control test (below) meaningful rather than vacuous |
| DEV-T2-6 | 2    | —                                                                                                                       | Two shipped comments asserted the declaration did not exist: `chain-execution.ts:28` ("carrying a nodeId, **which it does not**") and `prompt-schema.ts:78` ("pending `ParsedCommandSnapshot.steps` carrying a nodeId")                                                                                                                                                                                                                                                                                         | Rewritten in the same change per cleanup-standards §"you just fixed something an exception describes". Both now state that the blocker is gone and that widening the `VisibilityItem` vocabulary is a separate ruling, not a plumbing gap                                                                                                                                                                                                                                                 |

### Design note — the three-state contract

The brief required P5's node-identity semantics with no third state. Both new readers use the
`filterGatesForTarget` split verbatim:

- `nodeId: undefined` on a snapshot/parse step = **legacy, address by ordinal** (P3 D10 keeps
  `nodeId` optional on `ChainStepPrompt`).
- `resolveNextRunNodeId` returns `string | null | undefined`, and the three are NOT collapsed:
  **string** = the next live node · **null** = resolved, and there is none (run on its last node,
  or walked off the end) · **undefined** = no run to ask, the ONLY value that licenses the ordinal
  fallback. Collapsing `null` into `undefined` would make a finished run fall back to the
  positional offset and render a handoff for a step it already passed.

### Positional → node-address switch (shape)

Before — node-addressed anchor, positional step, unfiltered priors:

```ts
const currentIndex = currentNodeId != null && steps.some((s) => s.nodeId != null)
  ? steps.findIndex((s) => s.nodeId === currentNodeId)
  : steps.findIndex((s) => s.stepNumber === currentStep);
const nextStep = currentIndex >= 0 ? steps[currentIndex + 1] : undefined;   // ← the drift
...
priorDeclarations: steps.slice(0, nextStepIndex).map(...)                    // ← retired steps included
```

After — the run answers "which node is next", the parse array is matched back by identity:

```ts
if (nodeAddressed) {
  const nextNodeId = this.resolveNextRunNodeId(context);      // string | null | undefined
  if (nextNodeId === null) return undefined;                  // no next live node
  if (nextNodeId !== undefined) {
    const index = steps.findIndex((step) => step.nodeId === nextNodeId);
    return index >= 0 ? index : undefined;                    // inserted node ⇒ no parse step
  }
}
// …ordinal fallback unchanged (legacy chains, or no run view to ask)
...
const retiredNodeIds = this.resolveRunStepView(context)?.skippedNodeIds ?? [];
priorDeclarations: steps.slice(0, nextStepIndex)
  .filter((step) => step.nodeId === undefined || !retiredNodeIds.includes(step.nodeId))
  .map(...)
```

`resolveNextRunNodeId` filters `view.skippedNodeIds` out of `view.nodeIds` before taking the
successor, for the same reason `filterGatesForTarget` refuses a gate whose target was retired.

### Falsification proofs

`git stash` / `git checkout` not used. Each mutation applied with `Edit`, suite run, reverted with
`Edit`, byte identity proved with `md5sum` against the pre-mutation baseline.

| Id  | Mutation                                                                                          | Failure set                                                                                                                                                                                                   | Disjoint?                                               |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| M1  | Deleted the node-address branch in `resolveNextStepIndex` (back to `currentIndex + 1`)            | `2 failed, 142 passed` — exactly `after a skip, the handoff targets the run's next LIVE node…` and `after an insertion, no handoff is emitted…`. Nothing else in the 9 suites moved                           | yes                                                     |
| M2  | Neutered the retired-prior filter (`!retiredNodeIds.includes(id)` → `retiredNodeIds.length >= 0`) | `1 failed, 143 passed` — exactly `a retired prior step's withhold does not reach the handoff manifest`                                                                                                        | yes, disjoint from M1                                   |
| M3  | Removed `nodeId?: string` from `ParsedCommandSnapshot.steps`                                      | `typecheck:tests:ratchet` **FAIL**: `chain-session-store.test.ts: baseline=9 current=13 (+4)` — TS2353 ×2 (literal), TS2339 ×2 (read). A type contract's only failure mode is compile failure, and this is it | yes, disjoint from M1/M2 (compile-time, different gate) |

md5 after all three restores, identical to the pre-mutation baseline:

```
0a6372732308c61d108d328729fd0383  src/engine/execution/formatting/response-assembler.ts
a1d830d5bad62d4de6214040ffa0b64d  src/shared/types/chain-session.ts
620e5b7d0ce7cc565e82d4a8c1edda41  src/mcp/tools/prompt-engine/core/pipeline-builder.ts
```

One control test is deliberately non-discriminating and labelled as such: _`control: an UNMUTATED
run resolves exactly what the positional reader did`_ asserts `toBe` string equality between the
node-addressed assembler and one constructed with no provider. It is the byte-identical negative
that bounds the blast radius — it must pass under every mutation, and does.

### Validation Ledger

| Date       | Tier | Command                                                                                                    | Result                                                                                                                                                                                     |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-12 | 2    | `npm run typecheck`                                                                                        | clean, no output                                                                                                                                                                           |
| 2026-08-12 | 2    | `npm run lint:ratchet`                                                                                     | `[eslint-ratchet] OK: 3199 errors, 1017 warnings (no regressions)`                                                                                                                         |
| 2026-08-12 | 2    | `npm run typecheck:tests:ratchet`                                                                          | `[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)`                                                                                                                      |
| 2026-08-12 | 2    | `npm run test:match -- "response-assembler\|session-stage\|blueprint\|chain-session"`                      | `Test Suites: 9 passed, 9 total` · `Tests: 144 passed, 144 total`                                                                                                                          |
| 2026-08-12 | 2    | `npm run validate:arch` (extra — new `engine/execution/formatting → engine/gates/services` type-only edge) | `4 dependency violations (0 errors, 4 warnings)` — all four pre-existing `engine-cross-layer-type-only` warnings on `execution-record-store.ts`; `451 modules cruised (floor 400)`; **OK** |
| 2026-08-12 | 2    | `npm run test:match -- "visibility-policy\|p5-acceptance"` (extra — P5 regression check)                   | `Test Suites: 3 passed, 3 total` · `Tests: 24 passed, 24 total`                                                                                                                            |
| 2026-08-12 | 2    | `npx eslint` on the five touched `src/` files                                                              | no finding on any added line; the 46 errors / 5 warnings reported are pre-existing baseline (the ratchet above is the authority)                                                           |
| 2026-08-12 | 2    | `npx prettier --check` on all 7 touched files                                                              | one warn on the new test file → `--write` applied → clean; suite re-run green                                                                                                              |

### Findings raised during execution

- **P6-F1 has a second half the ledger row does not name.** The finding states the target is read
  positionally. Measured: the target was node-ANCHORED and positionally OFFSET, and the
  `priorDeclarations` list was positional AND unfiltered — so a step the mutation policy retired
  could withhold context from a step that actually runs, on the authority of a step that did not.
  Fixed here; recorded because a finding that names one of two halves gets a fix that closes one
  of two halves, and the closing gate would have gone green.
- **`ParsedCommandSnapshot` is a fourth-and-a-half copy of the step shape (feeds P6-F8).** It is
  reached from the engine only through `blueprint.parsedCommand as ParsedCommand`, a cast that
  will keep laundering every future snapshot field the same way `nodeId` was laundered. Declaring
  one field does not retire the mechanism. Whatever closes P6-F8 should decide whether the
  snapshot is a projection with a derivation, or should be deleted in favour of the full type.

### Out of scope / not done

- **Row 2.5** (`getCurrentStepArgs` at `manager.ts:2376` + the stage-18 `input` override) — not in
  this worker's brief. Measured for the next worker: `getCurrentStepArgs` derives
  `currentOrdinal(...)` and then does `Math.min(Math.max(currentStep - 1, 0), maxIndex)` into
  `blueprint.parsedCommand.steps` — a **clamped** positional index, so after an insertion it not
  only mis-resolves but silently CLAMPS to the last step rather than missing. The declaration
  landed here is exactly what unblocks addressing it by `nodeId`; the clamp is the thing to delete.
- **Row 2.6 cold-load half** — the resume path (`chain-blueprint-resolver`) round-trip is asserted
  here only through the store (`chain-session-store.test.ts`), not through a cold reload from rows.
- **Rows 2.2 / 2.3** — see DEV-T2-3 and DEV-T2-2.

## Tier 1 — worker execution

**Dispatched**: 2026-08-12, Tier 1 worker (rows 1.1-1.3; row 1.4 docs NOT executed — see DEV-T1-6).
**Scope taken**: the BROADENED OQ-P6-4 ruling (full `normalizeDelegation` hoist with its own
guard), not plan row 1.1's narrow `markDelegatedStepPrompts`-only text.

**Files touched** (2 files, +158 / -9):

| File                                                                          | Δ         |
| ----------------------------------------------------------------------------- | --------- |
| `server/src/engine/execution/pipeline/stages/06-operator-validation-stage.ts` | +50 / -9  |
| `server/tests/integration/pipeline/delegation-operator-flow.test.ts`          | +117 / -0 |

No foreign path touched. `docs/reference/mcp-tools.md` and
`src/mcp/tools/resource-manager/**` (P7's active set) untouched.

### Consequence trace (required before the edit — CLAUDE.md §Consequences)

`normalizeDelegation` produces three fields. Only one has a downstream reader.

| Field written                                           | Writer                      | Readers downstream of stage 06 (`rg` over `src/`)                                                                                                                               |
| ------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChainStepPrompt.delegated` on `parsedCommand.steps[i]` | `markDelegatedStepPrompts`  | **5 sites, 4 distinct decisions** (below)                                                                                                                                       |
| `ChainStep.delegated` on `operator.steps[i]`            | `syncDelegationToOperators` | **zero** — the only readers of an operator step's `delegated` (`symbolic-command-builder.ts:235`, `symbolic-operator-parser.ts:481,760`) all run in stage 04, BEFORE this write |
| `ChainOperator.hasDelegation`                           | `applyDelegationToChainOp`  | **zero in `src/`** — this is P6-F3, already scheduled for deletion at row 6.3. Only tests read it                                                                               |

**Who READS / DECIDES on `ChainStepPrompt.delegated`:**

| Site                                                                                                | Decision it owns                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chain-operator-executor.ts:495`                                                                    | delegation CTA vs. plain resume CTA on the symbolic chain render                                                                                                                                            |
| `chain-operator-executor.ts:517` → `18-execution-stage.ts:332`                                      | writes `nextStepDelegated` onto `executionResults.metadata`                                                                                                                                                 |
| `response-assembler.ts:512` (`findNextDelegatedStep`) → `:487` (`isNextStepDelegated`) → `:289-291` | whether a handoff section is emitted **at all**                                                                                                                                                             |
| `response-assembler.ts:328-331` (`buildHandoffSection`)                                             | `agentType`, `subagentModel`, and `buildHandoffEnvelope(context, nextStep.index)` — i.e. **P5's visibility withhold/expose manifest**. This is the consumer that makes the hoist matter beyond a CTA string |
| `response-assembler.ts:484`                                                                         | metadata mirror of the same fact (fallback when `pendingReview` blocked stage 18)                                                                                                                           |

**Persistence / session state**: the flag has no store of its own. It rides `parsedCommand` into
the session blueprint at `13-session-stage.ts:391-413`, a full `JSON.parse(JSON.stringify(...))`
clone taken **after** stage 06 runs. A resumed run therefore restores flags already set, which is
why stage 06's `isBlueprintRestored` exit (`:42-45`) is correct as-is and was deliberately NOT
hoisted past. Transport parity: nothing here hangs off a registered `McpServer` instance — the
whole path is per-request `ExecutionContext` plus SQLite-backed session rows.

**Why the exit was reachable at all** (probed live, not recalled — throwaway jest probe against
real stage 04, deleted after): a bare `>>delegating_chain` yields
`format: 'simple'`, `commandType: 'chain'`, `operators` **undefined**,
`steps[1].subagentModel: 'fast'`, `steps[1].delegated: undefined`. `04-parsing-stage.ts:105
buildDirectCommand` writes `subagentModel` at `:164-166` and never populates `operators`, so the
operators-empty exit fired before any delegation marking on every non-`==>` invocation.

**Blast-radius survey re-measured with `rg --no-ignore` (P7-F4 hazard honored), 2026-08-12:**

| Probe                                                | Result                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subagentModel\|agentType` under `server/resources/` | **1 hit**: `prompts/development/code_review_test/prompt.yaml:45` (`subagentModel: fast`). Zero `agentType`. Confirms the plan's count                                                                                  |
| `chainSteps` under `server/resources/**/*.yaml`      | **17 files** — matches the plan. (A bare `rg -l chainSteps server/resources/` returns 20; the extra 3 are `examples/create_prompt` scaffolding: `tools/prompt_builder/schema.json`, `script.py`, `user-message.md`)    |
| prompt-level fallback                                | `04:165` also reads `stepConverted.subagentModel`, so a _referenced_ prompt's own hint arms delegation too. The 1-hit survey already covers this: it scanned all of `server/resources/`, not only `chainSteps:` blocks |

Net: the hoist changes observable behavior for **one step of one chain out of seventeen**.

### What moved, and what the new guard is

- `normalizeDelegation(parsedCommand, operators)` now runs **above** the operators-empty return.
- `operatorSet` is normalized once into a local `const operators: SymbolicOperator[]` (empty array
  when absent), so the stage no longer branches on `Array.isArray` before delegation.
- The guard the ruling asked for lives in the owning method, not the stage body:
  `syncDelegationToOperators` opens with `if (operators.length === 0) return;`. Keeping it there
  means the stage body stays a straight sequence of thin calls and the empty-set fact is owned by
  the method that actually needs an operator set.
- No domain logic was added to the stage — the change is ordering plus one guard, so no service
  extraction was warranted (Domain Ownership Matrix / `architecture.md` orchestration rules).
- Header block corrected per P6-F5 (see DEV-T1-2), plus a docblock on `normalizeDelegation`
  recording that two of its three outputs have no reader.

### Deviations

| Id       | Tier | Authored                                                                                     | Measured                                                                                                                                                                                                                                                                                                                                                                                 | Action                                                                                                                                                                                                                                                                                             |
| -------- | ---- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T1-1 | 1    | Row 1.1: hoist `markDelegatedStepPrompts` alone; `syncDelegationToOperators` stays below     | OQ-P6-4 was ruled to the BROADER third option                                                                                                                                                                                                                                                                                                                                            | Took the ruling. Full `normalizeDelegation` hoisted; empty-set guard pushed down into `syncDelegationToOperators`. Row 1.1's text is superseded, not skipped                                                                                                                                       |
| DEV-T1-2 | 1    | P6-F5 / row 1.2: the stage "has three early exits"                                           | `execute()` has **FOUR** returns: `isBlueprintRestored` (:42), `!parsedCommand` (:48), operators-empty (:64), `!frameworkValidator` (:69). The plan's count omits the `frameworkValidator` exit                                                                                                                                                                                          | Header names four, in order, each with its condition. **P6-F5's own text undercounts by one** — worth correcting when 6.5 promotes it to the master ledger                                                                                                                                         |
| DEV-T1-3 | 1    | Row 1.3: new fixture chain under `tests/integration/chain/` ("new file only if none fits")   | `tests/integration/pipeline/delegation-operator-flow.test.ts` already wires real parser + real stage 06 + real `ChainOperatorExecutor` and is the sibling suite for exactly this behavior                                                                                                                                                                                                | Extended it (+117) rather than creating a file — `testing.md` "extend existing files over creating new ones". Also added real stage 04 to that suite, which it did not previously drive                                                                                                            |
| DEV-T1-4 | 1    | not authored                                                                                 | Moving `Array.isArray(operatorSet)` into a ternary un-narrows `operatorSet` at the `normalizeFrameworkOperators` call site, which would fail `typecheck`                                                                                                                                                                                                                                 | Switched that call to pass the narrowed `operators` local. Mechanical consequence of the hoist                                                                                                                                                                                                     |
| DEV-T1-5 | 1    | `lint:ratchet` expected green                                                                | One run failed `@typescript-eslint/no-unused-vars baseline=17 current=18`. Enumerating all 18 showed **none in either file I touched**; the extra was `src/modules/chains/manager.ts:54` (`nodeIdAt`), which is **clean at HEAD** and was mid-flight in a concurrent session. Substituting HEAD's stage-06 file → ratchet green; restoring mine → ratchet green                          | Not attributable to this tier. Recorded because a later reader seeing that run in scrollback would otherwise charge it here. Note also `.eslint-ratchet-baseline.json` is itself foreign-dirty (regenerated 2026-08-12, target widened `src` → `src,scripts,eslint-rules`, no-unused-vars 56 → 17) |
| DEV-T1-6 | 1    | Row 1.4: docs state that step-level `subagentModel` marks a step delegated on any invocation | Not executed — outside this worker's dispatch (Execution Dispatch assigns 1.3-1.4 to a separate sonnet worker). Additionally measured: `docs/reference/chain-schema.md` §Step Schema + §Subagent Model do **not** currently claim `==>`-only, so no doc statement is falsified by HEAD; row 1.4 is an _addition_, not a correction. `docs/concepts/chains-lifecycle.md` is foreign-dirty | Row 1.4 left OPEN. Not flipping any plan row status per brief                                                                                                                                                                                                                                      |

### Validation ledger

| Date       | Tier | Command                                                   | Result                                                                                                                                                                              |
| ---------- | ---- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | 1    | `npm run typecheck`                                       | clean, no output (tsc --noEmit, `src/` only)                                                                                                                                        |
| 2026-08-12 | 1    | `npm run lint:ratchet`                                    | `OK: 3199 errors, 1017 warnings (no regressions)`                                                                                                                                   |
| 2026-08-12 | 1    | `npm run typecheck:tests:ratchet`                         | `OK: 377 errors in tests/ (no regressions)`                                                                                                                                         |
| 2026-08-12 | 1    | `npm run test:match -- "06-\|delegation\|chain-operator"` | `Test Suites: 6 passed, 6 total` · `Tests: 106 passed, 106 total`                                                                                                                   |
| 2026-08-12 | 1    | `npm run test:match -- "operator-validation"`             | `Test Suites: 1 passed, 1 total` · `Tests: 7 passed, 7 total` — the tier gate's pattern does **not** match `operator-validation-stage.test.ts`; run separately                      |
| 2026-08-12 | 1    | `npm run validate:arch`                                   | `451 modules cruised (floor 400)`, 4 pre-existing `engine-cross-layer-type-only` warnings, **0 errors** — unchanged by this tier (no new import edge; the hoist adds no dependency) |

**Gate-pattern finding**: the Tier 1 gate in the plan (`"operator-validation\|delegation\|integration/chain"`)
and the brief's (`"06-\|delegation\|chain-operator"`) select different sets, and **neither** covers
both `operator-validation-stage.test.ts` and `delegation-operator-flow.test.ts` plus
`tests/integration/chain/`. `06-` matches nothing (test files are not named `06-*`). Both were run.

### Falsification (P7 DEV-T1-1 protocol — no `git stash`, no `git checkout`)

Reverted **only** the hoist, by `Edit`, swapping `normalizeDelegation` back below the
operators-empty return and leaving every other hunk (header, guard, docblocks, tests) in place.

| Run                                                                              | Result                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hoist reverted, suite = `delegation-operator-flow` + `operator-validation-stage` | `Tests: 2 failed, 20 passed, 22 total`                                                                                                                                                                                                                                      |
| Failing set                                                                      | exactly `direct invocation path — YAML subagentModel (P5-F5) › stage 06 marks the step delegated even though no operator was parsed` and `… › the marked step produces a delegation CTA on the preceding step`                                                              |
| Not failing (correctly)                                                          | the two other new tests — `the direct path really produces no operators` (a precondition, true either way) and `a chain declaring no delegation fields is untouched by stage 06` (the byte-identical negative, which must survive the mutation or it was asserting nothing) |
| Restored, re-run                                                                 | `Tests: 106 passed` across the scoped gate                                                                                                                                                                                                                                  |

md5 proof of byte-identical restoration:

```
2272d48f6f4fc054537127ec06e960d4  src/engine/execution/pipeline/stages/06-operator-validation-stage.ts
c200c2f2c0bb42a15ca3201ce6c06209  tests/integration/pipeline/delegation-operator-flow.test.ts
```

(Both hashes taken before the falsification edit and again after restoring; identical. The stage
file was subsequently edited once more — the DEV-T1-2 header correction — so its working-tree hash
now differs from the value above by design; the tests file is unchanged from `c200c2f2…`.)

A second, independent revert was performed for DEV-T1-5: `git show HEAD:…06-operator-validation-stage.ts`
written over the working file, `lint:ratchet` run, then the saved copy restored and hashed. Used to
attribute a lint failure, not to test behavior.

### Findings raised during execution

- **P6-F5 is undercounted.** The stage has four early exits, not three (DEV-T1-2). The finding's
  own evidence is what a later reader will check the fix against, so the master-ledger promotion at
  row 6.5 should carry "four".
- **The Tier 1 gate pattern under-reaches.** `06-` matches no test path, and no single pattern in
  either the plan row or the brief covers all three suites that assert this behavior. A tier gate
  whose pattern silently selects zero files for one of its named targets is the `test:match`
  analogue of the surface-check-≠-end-to-end lesson.
- **`syncDelegationToOperators` produces nothing anyone reads.** Both of its outputs
  (`ChainStep.delegated` post-stage-06, `ChainOperator.hasDelegation`) have zero `src/` readers.
  Row 6.3 already deletes `hasDelegation`; the operator-step `delegated` write is the other half
  and is a candidate for the same removal. Recorded, not acted on — out of Tier 1 scope, and
  deleting it would change what `syncDelegationToOperators` exists to do.

**Formatting note (Tier 1 worker)**: this file does not conform to the repo Prettier config —
`npx prettier --check` on it fails on table-column alignment in sections written before this
append (the `## Rulings`, `## Deviations` and `## Validation Ledger` skeleton tables). Running
`prettier --write` was tried and reverted byte-identically: it rewrites main-thread lines, which
the shared-worktree rule forbids a worker from doing. The Tier 1 section above deliberately
matches the surrounding unaligned style rather than conforming alone. Whoever owns this file
should run `prettier --write` on it once, as its own change.

**Tier 1 addendum — broad integration sweep not completable (2026-08-12)**: an out-of-gate
`jest tests/integration/chain tests/integration/pipeline` sweep was attempted for extra safety and
was abandoned after ~20 min with no output. Cause is environmental, not the change: `ps` showed
**three concurrent `jest --runInBand` runs** over `tests/integration/chain` from different
sessions (one of them `visibility|p5-acceptance|integration/chain`, i.e. another worker), all
contending for the shared `state.db`. The Tier 1 gate itself, plus `operator-validation` and
`validate:arch`, all ran to completion and are green (ledger above). A later tier that needs the
full chain-integration sweep should confirm no sibling jest is running first — a hung
`--runInBand` here reads identically to a slow suite.
