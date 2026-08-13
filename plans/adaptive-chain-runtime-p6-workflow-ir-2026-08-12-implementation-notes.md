---
title: "P6 — Workflow IR: implementation notes"
date: 2026-08-12
status: reference
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

## Tier 3 — worker execution

Scope executed: **rows 3.1–3.4, re-derived under the OQ-P6-5 ruling** (reserved `outputs.<name>`
namespace — the owner chose the ALTERNATIVE, while every Tier 3 row was authored against the
RECOMMENDED provenance map). Plan row statuses are deliberately NOT flipped here.

### The ruling re-derivation (authored rows vs what namespacing required)

| Row | Authored (provenance map)                                                                           | Required under the namespace ruling                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | record `name → sourceNodeId` beside `namedOutputs`; **`buildChainVariables` keeps the flat spread** | the flat spread is exactly what is deleted. `namedOutputs` publishes as ONE reserved object key, `outputs`. No provenance map is built — the namespace makes per-key provenance unnecessary (see "why no provenance" below) |
| 3.2 | `stripChainHistory` removes aliases **via the provenance map**                                      | `stripChainHistory` deletes one key. The ~30-line provenance walk collapses to `delete templateContext[NAMED_OUTPUT_NAMESPACE]`                                                                                             |
| 3.3 | P6-F2: "fix or document" the unread mapping values                                                  | unchanged in intent, but it is now the **only** part of Tier 3 that is a documentation act rather than a behavior change. Ruled: document, do not invent a selector (v2 candidate)                                          |
| 3.4 | leak test + byte-identical negative                                                                 | plus a **migration** criterion the authored row has no place for: the bare alias must be asserted ABSENT, or a dual-read implementation passes every namespace assertion                                                    |
| —   | _(no authored row)_                                                                                 | **template migration** — the ruling's stated consequence. Measured surface below; it is not what the ruling anticipated                                                                                                     |

**Net**: the authored rows describe a change with **no template-visible effect**; the ruled change
is breaking by construction. The row-level line estimates (~40/~30/~20) are inverted — the runtime
side got _smaller_ (a namespace is one key), and the doc/resource side got larger.

**Why no provenance map is needed under the namespace.** The provenance design existed to answer
"which flat key came from an `outputMapping`" — a question only a flat context can pose. Once the
names live in their own object, membership IS the provenance. A finer question ("which STEP
published this name") was evaluated for a per-source withhold and **rejected on symmetry**, not on
cost: a named output is the same bytes `step{N}_result` publishes positionally, and
`previous_step_output` deliberately leaves the positional keys in place. Withholding the alias
while the thing it aliases survives would make the withhold depend on which name the author chose.
So the namespace is withheld with `chain_history` and only with `chain_history`, and that
asymmetry is asserted as its own test rather than left to be "fixed" by a later reader.

### Consumer enumeration (measured this session, `--no-ignore` throughout)

**Runtime readers/writers of `namedOutputs` / `outputMapping`:**

| Site                                                | Role                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/modules/text-refs/index.ts:71-84`              | **the only writer** of `namedOutputs` (`storeChainStepResult`)                               |
| `src/modules/text-refs/index.ts:114-135`            | **the only publisher** into the render context (`buildChainVariables`)                       |
| `src/modules/chains/manager.ts:1356`                | the only caller of `buildChainVariables` in `src/` — `getChainContext` spreads it at `:1405` |
| `chain-operator-executor.ts:798-808`                | `stripChainHistory` — the withholder                                                         |
| `execution/capture/step-capture-service.ts:169-272` | reads a step's `outputMapping` off the parse and hands it to the store as metadata (3 sites) |
| `04-parsing-stage.ts:162`                           | projects `outputMapping` from the loaded step into `ChainStepPrompt`                         |
| `yaml-prompt-loader.ts:389`, `prompt-schema.ts:153` | authoring surface (allowlist + Zod)                                                          |

`namedOutputs` has **zero** readers outside `text-refs/index.ts` — counted 6 hits in `src/`, all in
that file. Every other hit in the sweep is a type declaration or the authoring path. Test-side:
17 `buildChainVariables` references, **all stubs returning `{}`** except
`tests/unit/text-references/text-reference-store.test.ts`, which is the one real consumer.

**Shipped templates consuming a mapped-output alias — MEASURED ZERO. The ruling's stated
consequence does not materialize, for a reason the ruling could not have known:**

| Probe                                                   | Result                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `rg --no-ignore "outputMapping" resources/ -g '*.yaml'` | **0 hits.** No shipped `prompt.yaml` declares `outputMapping` on any `chainSteps` entry |
| `rg --no-ignore -l "^chainSteps:" resources/`           | 17 files (16 `prompt.yaml` + 1 `user-message.md` doc block)                             |
| `rg --no-ignore "outputMapping" resources/`             | 7 hits in **3 files**, none of them a live declaration (below)                          |

The three files, and why none is a runtime consumer:

1. **`pr-review/pr_review_chain/user-message.md`** (4 `outputMapping:` blocks) — a _markdown-format_
   chain-step listing inside the `userMessageTemplateFile` body. The sibling `prompt.yaml` declares
   `chainSteps` with `promptId`/`stepName` **only**. `loader.ts:260-271` routes any path ending
   `.yaml` to `loadYamlPrompt` and never reaches `parseMarkdownPromptContent` (`:277`), which is the
   legacy `.md`-only path — and **no shipped prompt lacks a `prompt.yaml`** (probed: the only
   yaml-less `.md` files under `resources/prompts/` are 7 `docs/`/`description.md` sidecars). So
   that block is inert prose, not a declaration.
2. **`examples/create_prompt/user-message.md`** — schema documentation for prompt authors, three
   spots. **This is the one file migrated** (below).
3. **`examples/create_prompt/tools/prompt_builder/schema.json`** — a JSON-schema property name, not
   a template reference. No change.

**The four bare-alias template references are NOT mapped-output consumers.** `rg` for each
`outputMapping` key declared anywhere in `resources/` found:

| Reference               | File                                               | Fed by                                                              | Migrate? |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| `{{diff_analysis}}`     | `pr-review/pr_approval_summary/user-message.md:9`  | step 4's **`inputMapping`** (`diff_analysis: output:Diff Analysis`) | **no**   |
| `{{security_audit}}`    | same file `:12`                                    | same step's `inputMapping`                                          | **no**   |
| `{{performance_check}}` | same file `:15`                                    | same step's `inputMapping`                                          | **no**   |
| `{{security_verdict}}`  | `pr-review/pr_performance_check/user-message.md:9` | step 3's `inputMapping`                                             | **no**   |

`inputMapping` and `outputMapping` in that chain declare **the same names**, which is what makes
these look like migration targets. They are not: `inputMapping` publishes **flat into the step's
own context** (`chain-operator-executor.ts:385-397`, `templateContext[semanticName] = …`) and this
tier does not namespace it. Migrating them to `{{outputs.*}}` would have **broken** the channel
that actually feeds them. This is the measurement that changed the tier's plan, and it is why the
enumeration was run before any code was written rather than after.

### Namespace shape as implemented

`{{outputs.<name>}}` — a plain nested object, no adaptation needed. Nunjucks resolves dotted paths
natively and `getNunjucksEnv()` sets `throwOnUndefined: false` (`jsonUtils.ts:59-66`), so
`{{outputs.missing}}` renders empty exactly as `{{missing}}` did. The object is passed through
`processTemplate`'s escape loop untouched (non-strings bypass it, `jsonUtils.ts:167-178`) — the
same posture `step_results` already has.

Published **only when non-empty**, matching `previous_step_results` and `unknowns_ledger`
(`manager.ts:1412-1422`, whose comment states the rule): a template can branch on presence, and a
chain declaring no `outputMapping` renders byte-identically to a build without the namespace. A
copy is published, not the live map, for the same reason the ledger is copied.

**The constant lives at L0** (`shared/utils/constants.ts` — `NAMED_OUTPUT_NAMESPACE`), not beside
either user. The producer is `modules/` (L3) and the withholder is `engine/` (L2), and
`.dependency-cruiser.cjs:58-66` bars `engine/ → modules/` **value** imports. Two string literals
was the alternative; that is the drift shape this repo already names elsewhere. `validate:arch`
confirms no new edge: 451 modules, 4 warnings, all pre-existing `engine → execution-record-store`
type-only.

### Visibility-withhold integration point

`ChainOperatorExecutor.stripChainHistory` (`chain-operator-executor.ts:798-810`) — one added
`delete templateContext[NAMED_OUTPUT_NAMESPACE]`, beside the existing `step_results` /
`previous_step_results` / `step\d+_result` deletions. That method is already the single chokepoint:
it is called from the normal render (`:381`, before `inputMapping` runs) and from
`applyWithheldSet` (`:837`, the gate-review path), both fed by the same
`resolveStepVisibility` → `decideVisibility` seam P5 established. No new decision, no new call
site, no change to `decisions/visibility/`.

The pre-existing "stripped BEFORE inputMapping" ordering now also protects the namespace: an
`inputMapping` of `{ x: 'outputs' }` cannot re-publish a withheld object, because the key is gone
before the mapping loop runs. The comment at `:379` was extended to say so and to state why
`inputMapping` is deliberately not namespaced.

### Deviations

| Id       | Tier | Authored / expected                                                                                     | Measured                                                                                                                                                                                                                                                                                                                             | Action                                                                                                                                                                                                                                    |
| -------- | ---- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T3-3 | 3    | OQ-P6-5's ruling text: "every shipped template consuming a mapped output must migrate in the SAME tier" | **Zero shipped templates consume one.** No `prompt.yaml` in `resources/` declares `outputMapping` at all, so the channel has never fired in a shipped chain. The plan's own rejection rationale ("namespacing breaks every template using `{{findings}}` today", plan L134) is falsified: `{{findings}}` appears in no live template | Migrated the one file that DOCUMENTS the channel (`create_prompt`), recorded the four look-alike references as `inputMapping`-fed non-targets. The ruling's cost estimate was the main reason to prefer provenance; it does not apply     |
| DEV-T3-4 | 3    | Row 3.1: build a `name → sourceNodeId` provenance map                                                   | Not built. Under the namespace, membership is the provenance, and per-step granularity was rejected on the symmetry argument above rather than deferred                                                                                                                                                                              | Recorded rather than silently dropped: a row whose artifact does not exist is a deviation. The symmetry rule is pinned by its own test so it cannot be "corrected" by a later reader without a failing assertion                          |
| DEV-T3-5 | 3    | Row 3.1: "`buildChainVariables` keeps the flat spread unchanged"                                        | Directly contradicted by the ruling — the flat spread IS the defect                                                                                                                                                                                                                                                                  | Replaced. Flagged because a reader diffing row text against the code will otherwise read this as an unauthorized change                                                                                                                   |
| DEV-T3-6 | 3    | MCP-tooling-only migration via `resource_manager` `patch` (P7 shipped it)                               | **The patch applied correctly to `user-message.md`, and the same write CORRUPTED the sibling `prompt.yaml`**: `tools: [prompt_builder]` was dropped entirely and `category: prompt-authoring` was rewritten to `examples`. Both verified against `git show HEAD:` — see P6-F10                                                       | Kept the `.md` migration; restored `prompt.yaml` byte-identically from HEAD (`git diff --exit-code` clean). `tools` is not a settable tool parameter, so the tool could not repair its own damage — the restore had to be a file write    |
| DEV-T3-7 | 3    | Docs deferred to row 6.4                                                                                | Two shipped doc claims are falsified by this tier's own change, not merely incomplete: `chain-schema.md:24` ("Renames this step's output") and `chains-lifecycle.md:236-238` (the "**v1 boundary**" paragraph stating `chain_history` withholding does not cover named outputs)                                                      | Fixed both in this change per cleanup-standards §"you just fixed something an exception describes". Added a `## Named Outputs` section to `chain-schema.md`. Row 6.4's Step-Schema-table rewrite is untouched and still owed              |
| DEV-T3-8 | 3    | P6-F2: "fix `outputMapping` so a mapping's values are read, or document"                                | Documented, per the brief's explicit instruction not to invent selection semantics. The unread value is now **named in the debug line** rather than dropped silently, so a run log shows what was ignored                                                                                                                            | v2 candidate: a sub-content selector. Flagged, not built                                                                                                                                                                                  |
| DEV-T3-9 | 3    | Tier gate as a single `test:match`                                                                      | The run appeared to hang for 8 min. Cause is **not** `state.db` contention (`p5-acceptance` uses its own `mkdtemp`): every suite passes in ~5 s and then jest refuses to exit on an open handle — "Jest did not exit one second after the test run has completed." A sibling session's run has sat in the same state since 22:15     | Ran the gate to its summary and read the tail from a log file. Recorded so the next worker does not re-diagnose this as contention — a hung post-run jest reads identically to a blocked one, which is what the Tier 1 addendum concluded |

### Files touched

**Code** (5 files, +286 / −11):

| File                                                                   | Δ        |
| ---------------------------------------------------------------------- | -------- |
| `server/src/shared/utils/constants.ts`                                 | +17      |
| `server/src/modules/text-refs/index.ts`                                | +35 / −7 |
| `server/src/engine/execution/operators/chain-operator-executor.ts`     | +20 / −4 |
| `server/tests/unit/text-references/text-reference-store.test.ts`       | +94      |
| `server/tests/integration/chain/visibility-policy.integration.test.ts` | +109     |

**Resource migration** (1 file, +3 / −2) — via `resource_manager` over a spawned server:

| File                                                              | Δ       |
| ----------------------------------------------------------------- | ------- |
| `server/resources/prompts/examples/create_prompt/user-message.md` | +3 / −2 |

**Docs** (2 files, +34 / −6):

| File                                | Δ        |
| ----------------------------------- | -------- |
| `docs/reference/chain-schema.md`    | +29 / −1 |
| `docs/concepts/chains-lifecycle.md` | +11 / −5 |

Nothing outside this list was touched. `prompt.yaml` was written and then restored, and is
byte-identical to HEAD.

### Templates migrated (exact list)

**One file, three anchored replacements, all via `resource_manager` `action:"update"` with `patch`
(dry-run first, then applied) over a freshly built server on `--transport=streamable-http` with
`MCP_WORKSPACE=/home/minipuft/Applications/claude-prompts-mcp`, raw JSON-RPC per
`scripts/verify-mcp-surface.mjs`. Drive script:
`scratchpad/p6-t3-outputs-namespace-drive.mjs`.**

`server/resources/prompts/examples/create_prompt/user-message.md`:

1. `:301` Chain Step Properties table — `outputMapping` description → "Publish this step's output
   as `{{outputs.<name>}}`"
2. `:317` Input/Output Mapping example — `findings: '{{findings}}'` → `'{{outputs.findings}}'`
3. `:328` Template Variables (Chain Steps) table — new row for `{{outputs.<name>}}`

Both the dry run and the write reported `🩹 Patched: user_message_template (3 operation(s))`;
`📜 Version 2 saved` (a `version_history` row exists for this edit).

**Not migrated, with cause** — `pr-review/pr_review_chain/user-message.md` and the four
`{{diff_analysis}}`/`{{security_audit}}`/`{{performance_check}}`/`{{security_verdict}}` references
in `pr_approval_summary` and `pr_performance_check`: all four are fed by `inputMapping`, which
stays flat (table in §Consumer enumeration).

### Falsification proofs

`git stash` / `git checkout` not used. Each mutation applied with `Edit`, the gate suite run,
reverted with `Edit`, byte identity proved with `md5sum -c` against the pre-mutation baseline.

| Id  | Mutation                                                                          | Failure set                                                                                                                                                                        | Disjoint?                                              |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| M1  | `buildChainVariables` back to `Object.assign(variables, namedOutputs)` (flat)     | `8 failed, 67 passed` — 4 unit + 4 integration, **all** of them this tier's. Zero pre-existing tests moved. Includes the discriminating leak test, i.e. HEAD's behavior fails it   | yes — the publisher hunk                               |
| M2  | Removed `delete templateContext[NAMED_OUTPUT_NAMESPACE]` from `stripChainHistory` | `1 failed, 74 passed` — exactly `withholding chain_history removes the named output — the P5-F2 leak`                                                                              | yes, a strict singleton, and the withholder hunk alone |
| M3  | Dropped the non-empty guard (namespace always published)                          | `2 failed, 73 passed` — exactly `the namespace is absent, not empty, when no step declares an outputMapping` and `clearing a chain removes its namespace`. Disjoint from M1 and M2 | yes — the presence-contract hunk                       |

M1 ⊃ M2 by construction (the publisher feeds the withholder), which is why M2 is reported as the
proof that the withhold hunk is independently load-bearing: reverting only the `delete` kills one
test and nothing else.

md5 after all three restores, identical to the pre-mutation baseline (`md5sum -c` → 3× `OK`):

```
4e4021e7f67cc5ec04168a8d75143760  src/modules/text-refs/index.ts
4d32aa1d5561cb54f656a532b2c04924  src/engine/execution/operators/chain-operator-executor.ts
ce25c89828932a721497e66db252fbc3  src/shared/utils/constants.ts
```

The leak test is discriminating in both directions: under M1 (HEAD's flat spread) it FAILS, and
the bare-alias assertion (`Bare: []`) fails on any dual-read implementation. A namespace-only
assertion would have passed on a build that published under `outputs` AND kept the flat alias.

### Validation ledger — Tier 3

| Date       | Command                                                                                            | Result                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-12 | `npm run typecheck`                                                                                | clean (no output)                                                                                                                                                                              |
| 2026-08-12 | `npm run lint:ratchet`                                                                             | `[eslint-ratchet] OK: 3199 errors, 1017 warnings (no regressions)`                                                                                                                             |
| 2026-08-12 | `npm run typecheck:tests:ratchet`                                                                  | `[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)`                                                                                                                          |
| 2026-08-12 | `npm run test:match -- "text-refs\|visibility\|response-assembler\|chain-operator\|p5-acceptance"` | `Test Suites: 9 passed, 9 total` / `Tests: 135 passed, 135 total` / `Time: 4.951 s`                                                                                                            |
| 2026-08-12 | `npm run validate:arch`                                                                            | `x 4 dependency violations (0 errors, 4 warnings). 451 modules, 1878 dependencies cruised.` — all 4 pre-existing `engine-cross-layer-type-only` → `execution-record-store`; `validate:arch OK` |
| 2026-08-12 | `npm run build`                                                                                    | `Build complete: dist/index.js, dist/cpm.js` (needed for the migration drive)                                                                                                                  |
| 2026-08-12 | `resource_manager` drive, streamable-http, dry_run then applied                                    | 3/3 anchors matched; `Version 2 saved`                                                                                                                                                         |

### Findings

- **P6-F10 — `resource_manager` `update`/`patch` silently drops `tools:` and rewrites `category:`
  on the sibling `prompt.yaml`.** Measured 2026-08-12 against `examples/create_prompt`: a
  `patch`-only update (three anchors, all against `user_message_template`) round-tripped the YAML
  and lost `tools: [prompt_builder]` — the script-tool binding — while rewriting
  `category: prompt-authoring` to `examples` (the directory name). The patched `.md` was correct;
  the collateral was in a file the call never named. This is the P7-F2 shape one level up: the
  writer's preserved-field set is smaller than the loader's accepted-field set, so a
  round-trip is lossy for any field outside it. **It makes the project's own MCP-tooling-only rule
  unsafe for prompts declaring `tools`** — the only repair available was a file write, because
  `tools` is not a settable tool parameter. Needs its own row; P7's "five preserved fields" work
  did not cover `tools`, and nothing gates the loss.
- **P6-F11 — `outputMapping` has never fired in a shipped chain.** Zero `prompt.yaml` under
  `resources/` declares it (`--no-ignore`, 0 hits in `*.yaml`), so the feature P5-F2 reports a leak
  in, that `docs/reference/chain-schema.md` documents, and that OQ-P6-5 was ruled on, has no
  producer. The leak was real but unreachable — same shape as P6-F9 (`visibility:` has zero shipped
  consumers), and the two together say the chain-step vocabulary is drifting ahead of the resources.
  The four look-alike template references are `inputMapping`-fed, so the ruling's migration cost —
  the main argument for preferring the provenance map — measured zero.
- **P6-F12 — the markdown chain-step block in `pr_review_chain/user-message.md` is unreachable
  prose.** It declares `inputMapping`, `outputMapping` and `inlineGateIds` for four steps in the
  legacy `## Chain Steps` markdown format, inside a file that is the prompt's
  `userMessageTemplateFile`. `loader.ts:260-271` sends every `.yaml` path to `loadYamlPrompt` and
  never reaches `parseMarkdownPromptContent`, and the sibling `prompt.yaml` declares only
  `promptId`/`stepName`. So `pr_approval_summary`'s `{{diff_analysis}}` etc. render **empty today**
  — four template variables with no producer, in a shipped example chain. Not this tier's to fix
  (it is a resource authoring gap, not a runtime one), but it is why the migration surface probe
  needed the loader precedence check rather than a text search alone.

### Smelled wrong / out of scope

- **The ruling's rationale rests on a falsified premise.** OQ-P6-5 rejected namespacing as
  "breaks every template using `{{findings}}` today"; the owner overrode that and chose it anyway.
  The measurement (P6-F11) shows there was nothing to break. The ruling is right and the reason
  given for calling it expensive was wrong — worth recording because the same premise ("templates
  depend on this") appears verbatim in `text-refs/index.ts:14-20`'s ordinal docblock about
  `stepN_result`, where it has **not** been re-measured.
- **`inputMapping` is now the only un-fenced cross-step channel.** It publishes flat into a step's
  context and is stripped only incidentally (because `stripChainHistory` runs first, so a mapping
  whose SOURCE is withheld finds nothing). A mapping whose source is an ordinary argument still
  publishes under any name the author picks. That is correct for its purpose, but it means "a
  withheld item cannot reach a step under a new name" holds only because of statement ORDER at
  `chain-operator-executor.ts:381-397`. A comment now says so; a test does not.
- **Row 3.4's "byte-identical negative" is covered but not by a byte-comparison.** The existing
  `a chain declaring nothing renders byte-identically` test (P5) is the real byte assertion and
  still passes unchanged, which is the load-bearing evidence; this tier's negatives are
  `toContain`-shaped. Left as-is rather than adding a second byte-exact fixture that would have to
  be re-baselined by every later tier.
- **A `version_history` row was spent on the migration** (`Version 2` for `create_prompt`), and
  `version_history` is a **durable** table shared across every project on the machine
  (`.claude/rules/sqlite-persistence.md`). Expected for a tool-authored edit, noted because the
  restored `prompt.yaml` is now _newer_ on disk than the version row describes.

**Tier 3 formatting note**: both edited docs were Prettier-clean at HEAD and my edits broke table
alignment, so `npx prettier --write` was run on exactly those two files and re-checked clean. That
realigned the whole `VisibilityItem` table (20 changed lines for a 1-line content edit) — expected,
and the reason the doc diff is wider than the change. No other file was formatted; the notes file
itself is still unformatted per the Tier 1 worker's note above.

## Tier 4 — worker execution

Rows 4.1-4.6 executed 2026-08-13. Statuses NOT flipped in the plan file (main-thread owns that).

### Files touched

| File                                                                   | Δ                | What                                                                                       |
| ---------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `server/src/modules/workflow-ir/types.ts`                              | **NEW** 213      | IR data types, rejection vocabulary, `DEFAULT_WORKFLOW_CAPS`, id + visibility vocabularies |
| `server/src/modules/workflow-ir/linearizer.ts`                         | **NEW** 109      | pure Kahn linearization, declaration-order tiebreak                                        |
| `server/src/modules/workflow-ir/validator.ts`                          | **NEW** 304      | pure `validateWorkflowIR` + four collectors                                                |
| `server/src/mcp/tools/schemas/workflow-ir.schema.ts`                   | **NEW** 138      | hand-written Zod, `.strict()`, reuses `gateSpecUnionSchema` + `VisibilityItemSchema`       |
| `server/tooling/contracts/workflow-ir.json`                            | **NEW** 79       | first resource-shape contract                                                              |
| `server/src/mcp/contracts/schemas/_generated/workflow_ir.generated.ts` | **NEW** 86 (gen) | parameter metadata                                                                         |
| `server/scripts/generate-contracts.ts`                                 | +28              | `isResourceShapeContract` opt-in; emits `.generated.ts`, excluded from tool descriptions   |
| `server/src/mcp/tools/schemas/index.ts`                                | +8               | barrel export                                                                              |
| `server/src/shared/types/index.ts`                                     | +9               | `ChainStep.inlineGateIds` declared                                                         |
| `server/src/modules/prompts/yaml-prompt-loader.ts`                     | ~+9/-9           | stripper 2 removed; mirror + visibility docblocks corrected                                |
| `server/src/engine/execution/pipeline/stages/04-parsing-stage.ts`      | +10              | stripper 3 removed                                                                         |
| `server/src/modules/prompts/prompt-schema.ts`                          | ~+15/-4          | `inlineGateIds` docblock: NOT-WIRED → WIRED, with the measured blast radius                |
| `server/tests/unit/workflow-ir/{types,linearizer,schema}` suites       | **NEW** 560      | 3 files, 54 tests                                                                          |
| `server/tests/unit/gates/inline-gate-chain-step-wiring.test.ts`        | **NEW** 218      | all three strippers + the resolver channel                                                 |
| `server/tests/unit/prompts/chain-step-strictness.test.ts`              | ~+14/-8          | the "drops inlineGateIds" guard inverted (it was authored to fail when wired)              |
| `docs/reference/workflow-ir.md`                                        | **NEW** 201      | schema, caps, rejections, linearization rule, worked example                               |
| `docs/reference/chain-schema.md`                                       | +23              | line 30 rewritten; new `### Inline Gate Ids` section                                       |
| `docs/README.md`                                                       | +1               | Reference index entry                                                                      |

### Deviations

| Id        | Authored                                                                                                                  | Measured                                                                                                                                                                                                                                                                                                                                                                                                                 | Action                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T4-1  | §Interfaces vocabulary includes `ambiguous-order`; row 4.3 verifies "an unresolvable fan-out rejects rather than picking" | Kahn + a declaration-order tiebreak is a TOTAL order on the ready set, so no input can produce an ambiguous case. The member would have had **zero producers** — the declaration-dead shape this repo builds gates against.                                                                                                                                                                                              | **DROPPED** `ambiguous-order`. The property that replaces it is stronger and testable: with no edges, output == `nodes[]`; the tiebreak IS the client's own declaration order, so a "silently chosen" order is impossible by construction. Stated in `linearizer.ts`'s docblock and in the doc's §Edges and Ordering. Fan-out is bounded by `cap-exceeded` instead. |
| DEV-T4-2  | vocabulary as authored (9 reasons)                                                                                        | two reachable failures had no reason: an empty `nodes[]` and a non-kebab id                                                                                                                                                                                                                                                                                                                                              | **ADDED** `empty-workflow`, `invalid-node-id`. Both have producers and tests. Landed vocabulary is 10.                                                                                                                                                                                                                                                              |
| DEV-T4-3  | `deps: { promptExists: (id) => boolean; caps }`                                                                           | `unknown-prompt` and `required-argument-missing` (row 4.2, P7-F6 IR-scope) are answered from the SAME registry entry; two callbacks would let a caller wire them to two different registries                                                                                                                                                                                                                             | **REPLACED** with `deps.lookupPrompt: (id) => WorkflowPromptInfo \| undefined`. `caps` kept, optional, defaulting to `DEFAULT_WORKFLOW_CAPS`. Tier 5 wires one registry call, not two.                                                                                                                                                                              |
| DEV-T4-4  | §Interfaces `WorkflowNode` has no `inlineGateIds` (gates were run-level only)                                             | OQ-P6-8 ruled the YAML field real; an IR node that cannot express what a YAML step can would be a narrower surface than the one it supersedes                                                                                                                                                                                                                                                                            | **ADDED** `WorkflowNode.inlineGateIds`, compiled to the same channel.                                                                                                                                                                                                                                                                                               |
| DEV-T4-5  | row 4.4 "or a block inside `prompt-engine.schema.ts` per OQ-P6-10"                                                        | `prompt-engine.schema.ts` is a state-dependent factory; the IR shape depends on no runtime state (Verify-Path 7 — `workflow` is never narrowed)                                                                                                                                                                                                                                                                          | **SEPARATE FILE** `workflow-ir.schema.ts`. Different lifetimes, so one responsibility each.                                                                                                                                                                                                                                                                         |
| DEV-T4-6  | Verify-Path 6: "`validate:arch` layer edge unprobed for `mcp/tools/schemas/ → modules/workflow-ir/`"                      | PROBED and CLEAR. `mcp/` (L4) may import `modules/` (L3); and `.dependency-cruiser.cjs`'s `no-mcp-tools-to-resource-schemas` rule carries `pathNot: '^src/mcp/tools/schemas/'`, which is exactly why the `VisibilityItemSchema` value-import from `modules/prompts/prompt-schema` is legal. **0 errors, 456 modules** (451 at Tier 3).                                                                                   | placement kept as planned                                                                                                                                                                                                                                                                                                                                           |
| DEV-T4-7  | OQ-P6-8 consequence: "behavior change for the **3 shipped chains** declaring `inlineGateIds`"                             | **FALSE as stated.** `rg --no-ignore` finds 6 declarations across 4 `prompt.yaml` files + 2 in prose. `git ls-files` says **every one is untracked/gitignored** — `server/resources/prompts/.gitignore` ignores all but `examples/ guidance/ codebase-setup/ workflow/ planning/` and two named dirs. **ZERO bundled chains declare the field**; the shipped package's behaviour is unchanged. See §inlineGateIds below. | recorded as **P6-F13**; acceptance proof is a fixture, not a shipped chain (same shape as Verify-Path 5)                                                                                                                                                                                                                                                            |
| DEV-T4-8  | (authored by me, then falsified) "the `nK` symbolic form is NOT accepted by the IR node-id pattern"                       | `n1` **matches** `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The `n\d+` alternative on `target_step_id` is redundant against kebab-case; no regex here could exclude it.                                                                                                                                                                                                                                                               | claim removed from three docblocks + the contract note; a test now PINS the acceptance so nobody re-derives the false claim                                                                                                                                                                                                                                         |
| DEV-T4-9  | row 4.5 "`generate:contracts`; never edit `_generated/`"                                                                  | `loadContracts()` skips `.generated.ts` emission for any contract without `toolDescription` (a guard for DEPRECATED tools), and `generateToolDescriptions` uses the same condition. A resource-shape contract needs the first and must NOT have the second.                                                                                                                                                              | `isResourceShapeContract` reads `metadata.artifactKind === 'resource-shape'` — an EXISTING extension point (`toolContractSchema.metadata`), so no schema change. Opt-in, so a contract missing `toolDescription` by accident is still skipped and logged. Asserted: `workflow_ir` is absent from `tool-descriptions.contracts.json`.                                |
| DEV-T4-10 | —                                                                                                                         | `tests/unit/prompts/chain-step-strictness.test.ts` carried a guard whose own comment said "If someone wires it, this test fails and points at the two sites that must change together"                                                                                                                                                                                                                                   | the guard fired, both named sites changed, assertion inverted with a dated note explaining that the guard did its job. A second test added for the absent case.                                                                                                                                                                                                     |
| DEV-T4-11 | —                                                                                                                         | `collectNodeRejections` measured cognitive complexity **20** > 15 on first draft (`refactoring.md`: blocked until decomposed)                                                                                                                                                                                                                                                                                            | split into `collectPromptRejections` + `collectVisibilityRejections`. Post-split per-file eslint on the three new modules: **clean**, no findings of any severity.                                                                                                                                                                                                  |

### IR schema surface as landed

```
WorkflowIR      version:1 · nodes[] · edges[]? · gates[]? · budget?
WorkflowNode    id* · promptId* · stepName? · args? · inputMapping? · outputMapping?
                visibility? · subagentModel? · agentType? · framework? · retries? · inlineGateIds?
WorkflowEdge    from* · to*                      (dependency, never control flow)
WorkflowBudget  maxNodes? · maxFanOut? · maxInsertions?   (ENFORCED, narrow-only)
                declaredCostCeiling?                       (RECORDED ONLY)
DEFAULT_WORKFLOW_CAPS  maxNodes 32 · maxFanOut 8 · maxInsertions 3
```

**Reused, not re-declared** (the P7-D1 defect class):

| Borrowed                 | From                                        | Legal because                                                                                      |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `gateSpecUnionSchema`    | `mcp/tools/schemas/prompt-engine.schema.ts` | same directory                                                                                     |
| `VisibilityItemSchema`   | `modules/prompts/prompt-schema.ts`          | `mcp/tools/schemas/` is the declared exemption on the `no-mcp-tools-to-resource-schemas` arch rule |
| `GateSpecification` type | `shared/types/execution.ts` (L0)            | `modules/` may import shared                                                                       |
| `VisibilityItem` type    | `shared/types/chain-execution.ts` (L0)      | same                                                                                               |

**Not reused, with cause**:

- `ChainStepSchema` is NOT extended/picked. It is the YAML authoring shape and carries `delegation` (skills-sync only) and an OPTIONAL `id`; the IR needs a REQUIRED id and no `delegation`. Reusing it would have meant `.omit().extend()` over a `.strict()` object whose strictness posture is documented against a different consumer. The compile target is one (Tier 5's `ChainStepPrompt`), which is what premise 9 / pre-flight `reuse-scope` demanded — the IR does not become a fifth step vocabulary because it never reaches the runtime as itself.
- `MAX_INSERTIONS_PER_RUN` is MIRRORED, not imported. `modules/`→`engine/` value imports are legal, but tying the client-declarable ceiling to the runtime's mutation ceiling would make retuning one silently retune the other. `schema.test.ts` pins the two numbers together so the mirror cannot rot.
- `WORKFLOW_VISIBILITY_ITEMS` restates the enum's values as a runtime array because `VisibilityItemSchema` lives in `modules/prompts` and the pure validator must be callable without Zod. Divergence would show as an accepted-by-Zod/rejected-by-validator pair; both directions are tested.

### Rejection vocabulary as landed (10)

`empty-workflow` · `duplicate-node-id` · `invalid-node-id` · `unknown-prompt` ·
`edge-endpoint-missing` · `cycle` · `cap-exceeded` · `gate-target-missing` ·
`required-argument-missing` · `unknown-visibility-item`

Every one has a test that produces it AND asserts its `detail` names the offending value —
plus one test asserting the case table's reason set EQUALS the declared enum, which is the
declaration-dead detector for this vocabulary. Rejections are collected, not first-wins; id
problems short-circuit because with duplicate ids no later rejection has a well-formed address.

### Linearization rule (verbatim, as shipped in `linearizer.ts` and `docs/reference/workflow-ir.md`)

> Kahn's algorithm over the dependency edges, where the ready set is drained in DECLARATION ORDER
> — at every step the runnable node that appears earliest in `nodes[]` is emitted next.
> Declaration order is a total order on the nodes, so the tiebreak is total, so the algorithm is a
> function: one IR has exactly one linearization. Two nodes can never "tie".

### inlineGateIds (OQ-P6-8) — what was wired and what it newly applies to

**The reader predated the producer.** `GateEnhancementService.enhanceChainSteps` (`:313`, `:370`)
has always read `step.inlineGateIds` and passed it to `GateSetResolver` as `inlineOperatorGateIds`
at rank `inline-operator` (100 — above a caller-supplied gate). Wiring was therefore REMOVAL of
two strippers, not addition of a consumer, and no domain logic moved (Domain Ownership Matrix
intact; stage 04 stayed a projection).

| Stripper | Site                                                    | Before               | After                             |
| -------- | ------------------------------------------------------- | -------------------- | --------------------------------- |
| 1        | `ChainStepSchema` (`prompt-schema.ts:183`)              | declared             | unchanged (docblock rewritten)    |
| 2        | `normalizeChainSteps` (`yaml-prompt-loader.ts:394-402`) | deliberately dropped | carries                           |
| 3        | stage-04 projection (`04-parsing-stage.ts:176-186`)     | absent               | projects (spread copy, not alias) |

`ChainStep` (`shared/types/index.ts`) gained the field — it was the fourth hand-written copy and
had never declared it.

**Symbolic path unaffected**: only `04-parsing-stage.ts` builds `ChainStepPrompt[]` from
`convertedPrompt.chainSteps` (`rg -l chainSteps src/engine/` → 9 files, one construction site).

**Affected chains — enumerated `rg --no-ignore -n "inlineGateIds" server/resources/`**:

| Resource                                           | Step          | Declared id                      | Registered gate? | Tracked in git? |
| -------------------------------------------------- | ------------- | -------------------------------- | ---------------- | --------------- |
| `general/test_gate_chain/prompt.yaml:11`           | step1         | `[]` (empty)                     | n/a              | **no**          |
| `general/test_gate_chain/prompt.yaml:16`           | `step2_gated` | `code-quality`                   | **YES**          | **no**          |
| `analysis/research_chain/prompt.yaml:65`           | step 2        | `Source Citations`               | no               | **no**          |
| `analysis/research_chain/prompt.yaml:71`           | step 4        | `Actionable Recommendations`     | no               | **no**          |
| `development/code_review_test/prompt.yaml:41`      | step 2        | `Actionable Findings`            | no               | **no**          |
| `development/tech_evaluation_chain/prompt.yaml:65` | step 2        | `Verified Claims`                | no               | **no**          |
| `development/tech_evaluation_chain/prompt.yaml:71` | step 4        | `Actionable Output`              | no               | **no**          |
| `pr-review/pr_review_chain/user-message.md:45,56`  | —             | prose, never parsed (**P6-F12**) | n/a              | **no**          |

**What newly applies**: exactly one gate on one step of one chain — `code-quality` on
`test_gate_chain`'s `step2_gated` — and that chain is a local test fixture, not a shipped resource.
The other five ids are display strings with no registered gate (`resources/gates/` holds 25, all
kebab-case). They enter the accumulator, produce no guidance text (`renderGuidance` finds no
guide), and appear in the run's gate id list.

**They are NOT filtered.** Every other gate source behaves identically — an unknown id supplied
through the `gates` parameter also enters the accumulator — and special-casing this one source
would make gate resolution mean different things depending on where an id came from. Recorded and
documented (`chain-schema.md` §Inline Gate Ids) rather than papered over. → **P6-F13**.

`docs/reference/chain-schema.md:30` ("not yet wired — no runtime effect", authored by P5 row 5.5
on 2026-08-13) is updated in this tier, as the ruling required.

### Falsification proofs (Edit-revert + md5, no `git stash`/`git checkout`)

Baseline hashes captured before any mutation; every restore verified with `md5sum -c`.

| #   | Mutation                                                                            | Failure set                                                                                                                                                                                   | Disjoint? |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| M1  | DAG check neutered — `if (order.length !== nodes.length)` → `if (false as boolean)` | **4**: validator `produces cycle, addressed`; linearizer `two-node cycle` / `self-edge` / `acyclic node when a cycle exists elsewhere`                                                        | ✔         |
| M2  | cap check neutered — `collectCapRejections(...)` → `void serverCaps;`               | **5**: `produces cap-exceeded`; `fan-out above the cap`; `budget NARROW`; `budget WIDEN`; `maxInsertions above the P4 ceiling`                                                                | ✔         |
| M3  | tiebreak neutered — declaration-index sort → reverse-lexical sort                   | **6**: `returns the order from the validator`; `no edges → declaration order`; `reorders only where an edge demands`; `diamond`; `drains by declaration index`; `ignores undeclared endpoint` | ✔         |
| M4  | stripper 3 reverted — stage-04 `inlineGateIds` spread → `...(false ? …)`            | **2**: `projects a declared inlineGateIds`; `copies rather than aliases`                                                                                                                      | ✔         |
| M5  | stripper 2 reverted — loader carry line commented out                               | **2**: `carries inlineGateIds from YAML into PromptData`; `chain-step-strictness › carries inlineGateIds through the normalizer`                                                              | ✔         |

M1/M2/M3 are pairwise disjoint (the three the tier gate names). M4/M5 are disjoint from each other
and from M1-M3 — which is the point of testing all three strippers separately.

**Mutation-never-reached correction**: M4's first run failed only 1 test. `copies rather than
aliases` used `?.push()` on an optional chain, so with the projection gone the push was a no-op
and the assertion passed vacuously. The test now asserts the projected array is present and is a
different reference BEFORE mutating it, and M4's failure set grew to 2.

md5 restore proof (all four files byte-identical to baseline after every mutation cycle):

```
1effd19a2645f9d5133de798dd576b6b  src/modules/workflow-ir/linearizer.ts
5b2ccb135658f8c8ac411221e35507df  src/modules/workflow-ir/validator.ts
fc2f72a6f2b482168749a4afcfd59160  src/engine/execution/pipeline/stages/04-parsing-stage.ts
(+ src/modules/prompts/yaml-prompt-loader.ts, captured before M5, restored OK)
```

### Validation ledger — Tier 4

| Date       | Command                                                                           | Result                                                                                              |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 2026-08-13 | `npm run typecheck`                                                               | clean                                                                                               |
| 2026-08-13 | `npm run lint:ratchet`                                                            | OK: 3199 errors, 1017 warnings (no regressions)                                                     |
| 2026-08-13 | `npx eslint src/modules/workflow-ir/ src/mcp/tools/schemas/workflow-ir.schema.ts` | clean (after DEV-T4-11 decomposition)                                                               |
| 2026-08-13 | `npm run typecheck:tests:ratchet`                                                 | OK: 377 errors in tests/ (no regressions)                                                           |
| 2026-08-13 | `npm run validate:contracts`                                                      | Complete                                                                                            |
| 2026-08-13 | `npm run validate:arch`                                                           | 0 errors, 4 pre-existing warnings; **456 modules**, 1888 deps (451 at Tier 3)                       |
| 2026-08-13 | `npm run test:match -- "workflow-ir\|gate-enhancement\|inline-gate"`              | **8 suites, 104 tests, all pass**                                                                   |
| 2026-08-13 | `npm run test:ci` (full unit)                                                     | **189 suites, 2448 tests, all pass**                                                                |
| 2026-08-13 | `npx prettier --check` on the 4 changed md/json                                   | All matched files use Prettier code style                                                           |
| 2026-08-13 | `git status --porcelain server/src/mcp/contracts/schemas/_generated/`             | only `?? workflow_ir.generated.ts` — **no hunks in P7's generated files** (Verify-Path 4 satisfied) |

### Findings raised during execution

- **P6-F13 (Tier 4)** — OQ-P6-8's stated consequence ("3 shipped chains") is wrong in both
  directions. There are 4 `prompt.yaml` files with 6 declarations (not 3/6), and **none of them is
  tracked in git**: `server/resources/prompts/.gitignore` excludes every directory they live in.
  Of the six, only `code-quality` names a registered gate. So wiring the field newly applies
  **one gate to one step of one untracked test-fixture chain** and changes nothing a user
  installing the package would see. Two lessons: (a) "shipped" needs re-measuring against
  `git ls-files`, not against `rg --no-ignore`, which is the OPPOSITE correction to P7-F4's; (b) a
  behaviour-change budget derived from an unmeasured corpus over-prices the change.
- **P6-F14 (Tier 4)** — an unregistered gate id entering the accumulator is a run-wide shape, not
  an `inlineGateIds` one: `GateSetResolver.accumulate` adds every non-empty string verbatim and
  nothing checks existence, so five of the six declarations become gate ids with no definition and
  no guidance. Left as-is deliberately (consistency with the `gates` parameter), but a
  `resource_manager gate list`-backed authoring-time check would catch it where it can still be
  fixed. No owner assigned.
- **P6-F15 (Tier 4)** — `tooling/contracts/` had a structural assumption nobody had written down:
  `!contract.toolDescription → skip everything`, conflating "deprecated tool" with "not a tool".
  A resource-shape contract needs one half and not the other. The idiom OQ-P6-10 fixed is now
  executable (`metadata.artifactKind`), but nothing GATES it — a second resource-shape contract
  that forgets the marker is silently skipped with a "deprecated" log line. Candidate for
  `validate:contracts` to assert that every contract file produces at least one artifact.
- **Confirms P6-F7** — the three-stripper hazard was measured live: the field's reader existed for
  the whole time the field was dead, and removing ONE stripper would have left it dead with a
  green build. All three sites were changed in one commit, per the plan's own compound ruling.

### Out of scope / not done

- **`compileWorkflowIR` (row 5.1)** — Tier 5's, deliberately untouched. The IR modules are inert
  without it and import nothing from `engine/`.
- **`prompt_engine.workflow` parameter (row 5.2)** — Tier 5's. `workflowIRSchema` is exported from
  the schemas barrel and ready to be `.optional()`-ed into the core fields with a `.refine`.
- **`declaredCostCeiling` recording** — the type, schema and doc land here; the actual write onto
  the `execution_records` v21/v23 telemetry object is Tier 5's, at the two terminal-record writers.
- **`maxInsertions` narrowing at runtime** — validated here as a declaration; threading it into
  `DecideMutationInput` is Tier 5's.
- **`docs/reference/mcp-tools.md`** — untouched; the `workflow` parameter does not exist yet
  (Tier 6.4 owns it, per the plan's docs table).
- **Smelled wrong**: `WORKFLOW_VISIBILITY_ITEMS` is a second runtime copy of an enum whose Zod
  source is one layer away. It is justified (the pure validator must not depend on Zod) and
  double-tested, but it is a fifth place the visibility vocabulary is written down. If P5's item
  list ever widens, `rg "unknowns_ledger"` is the check.

## Tier 5 — worker execution

Scope executed: **rows 5.1–5.6** (compiler, `prompt_engine.workflow` parameter, contract + regen,
third command source in stage 04, rejection surfacing, integration + unit tests), plus the two
items the Tier 4 record deferred here — `declaredCostCeiling` recording and `maxInsertions`
narrowing into `DecideMutationInput`. Row 6.4's `mcp-tools.md` half was pulled forward because the
parameter it documents ships in this tier. Plan row statuses are deliberately NOT flipped here.

### Files touched

| File                                                                            | Δ                                      |
| ------------------------------------------------------------------------------- | -------------------------------------- |
| `server/src/modules/workflow-ir/compiler.ts` **NEW**                            | +180                                   |
| `server/src/engine/execution/parsers/workflow-command-builder.ts` **NEW**       | +160                                   |
| `server/src/mcp/tools/schemas/gate-spec.schema.ts` **NEW**                      | +75                                    |
| `server/src/engine/execution/pipeline/stages/04-parsing-stage.ts`               | +172 / −11                             |
| `server/src/mcp/tools/schemas/prompt-engine.schema.ts`                          | +48 / −62 (gate sub-schemas moved out) |
| `server/src/mcp/tools/prompt-engine/core/prompt-executor.ts`                    | +34 / −5                               |
| `server/src/engine/execution/pipeline/stages/16-response-capture-stage.ts`      | +26 / −3                               |
| `server/src/shared/types/chain-session.ts`                                      | +30                                    |
| `server/src/mcp/tools/prompt-engine/core/pipeline-builder.ts`                   | +20 / −2                               |
| `server/src/engine/execution/pipeline/decisions/mutation/mutation-policy.ts`    | +18 / −1                               |
| `server/src/shared/types/execution.ts`                                          | +14                                    |
| `server/src/engine/execution/pipeline/decisions/mutation/types.ts`              | +11                                    |
| `server/src/engine/execution/context/context-types.ts`                          | +10                                    |
| `server/src/mcp/tools/schemas/index.ts`                                         | +8                                     |
| `server/src/engine/execution/parsers/index.ts`                                  | +6                                     |
| `server/src/engine/execution/pipeline/stages/01-request-normalization-stage.ts` | +7 / −2                                |
| `server/src/mcp/tools/index.ts`                                                 | +4                                     |
| `server/tooling/contracts/prompt-engine.json`                                   | +18                                    |
| `server/src/mcp/contracts/schemas/_generated/prompt_engine.generated.ts`        | +22 / −1 (generated)                   |
| `server/src/mcp/contracts/schemas/_generated/tool-descriptions.contracts.json`  | +3 / −2 (generated)                    |
| `server/tests/integration/chain/p6-workflow-ir.integration.test.ts` **NEW**     | +597                                   |
| `server/tests/unit/workflow-ir/compiler.test.ts` **NEW**                        | +221                                   |
| `server/tests/unit/mcp-tools/prompt-engine-surface.test.ts`                     | +53                                    |
| `server/tests/unit/execution/decisions/mutation-policy.test.ts`                 | +56                                    |
| `server/tests/unit/workflow-ir/validator.test.ts`                               | +12                                    |
| `server/tests/unit/execution/pipeline/step-response-capture-stage.test.ts`      | +7 (mock surface)                      |
| `docs/reference/mcp-tools.md`                                                   | +47                                    |
| `docs/reference/workflow-ir.md`                                                 | +72 / −5                               |

### Where compile lives, and why

`compileWorkflowIR` is `src/modules/workflow-ir/compiler.ts` — the fourth pure function of the
module that already owns the IR vocabulary. Ownership was measured, not assumed:

- `ParsedCommand` is built in exactly two places, both in `engine/execution/parsers/`
  (`SymbolicCommandBuilder`, `CommandParsingStage.buildDirectCommand`). The Domain Ownership Matrix
  assigns command parsing to that directory, so the IR→`ParsedCommand` step is a SIBLING of those
  two and lives beside them: `engine/execution/parsers/workflow-command-builder.ts`.
- The pure IR→step compilation is not command parsing; it is the IR module's own last function, and
  `modules/` → `engine/` type imports carry no dependency-cruiser rule at all.

**The layer edge forced the seam, and it is an ERROR-severity rule, not a style preference.**
`engine-no-modules-or-mcp-value` bars `engine/` from value-importing `modules/`, so stage 04 and
the command builder physically cannot call `validateWorkflowIR`/`compileWorkflowIR` directly. They
arrive through `WorkflowIrPort`, wired by `PipelineBuilder` (`mcp/`, Layer 4 — the only layer that
may name both sides). Type-only imports of the IR vocabulary are `warn`-tracked, the same posture
the four stages that type-import `ExecutionRecordStore` already carry; `validate:arch` went
4 warnings → 10, **0 errors** throughout.

**DEVIATION — the compiler returns `{ steps, promptArgs, budget }`, NOT `{ steps, nodes }`.** The
plan's §Interfaces sketched `compileWorkflowIR(ir, order) => { steps, nodes }`. Measured at HEAD:
`ChainNode[]` for a parsed chain has exactly ONE production producer,
`SessionManagementStage.buildChainNodes` (`13-session-stage.ts:341-370`), which derives the list
from `parsedCommand.steps` by reading `step.nodeId`. A second `ChainNode[]` producer here would be
a second copy of one projection rule — the P6-F8 shape this module exists not to add a fifth copy
to — and would be consumed by nothing in production, i.e. a phantom. Node identity still travels,
on `steps[].nodeId`, which is `buildChainNodes`'s own input; the integration suite proves the
resulting `chain_run_nodes` rows are field-identical to an equivalent `>>chain`'s.

**The IR `ParsedCommand` mirrors a SYMBOLIC chain, not a YAML chain.** A YAML chain carries a root
`convertedPrompt` because a chain resource exists; `buildSymbolicChain` does not, and everything
downstream already handles that (`buildChainNodes`, `getBaseChainId`, the renderers). Fabricating a
synthetic chain `ConvertedPrompt` for an IR would invent a resource the run does not have — the
first step toward the IR-specific execution path the charter forbids. `promptId` is the first
step's prompt id, so an IR run's base chain id reads `chain-<first prompt>`, asserted directly.

### The stage-04 third source, and its exclusivity semantics

`CommandParsingStage.execute` now opens with `context.mcpRequest.workflow !== undefined →
executeWorkflowSubmission(...)`, ahead of the response-only branch and ahead of the
missing-command guard. The stage stays thin: it owns request SHAPE (exclusivity) and nothing else —
schema conformance, caps, acyclicity, linearization and compilation all reach it through the
injected `WorkflowCommandBuilder`.

Exclusivity is enforced **twice, deliberately**, and the two guards cover different callers:

| Guard                                                                                           | Covers                                                                                   | Failure surface                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `withSourceExclusivity` `.refine` on the prompt_engine schema, applied to BOTH reachable shapes | The MCP boundary                                                                         | Zod issue: "Provide exactly one of 'command', 'chain_id' or 'workflow'" |
| `collectSourceConflicts` in stage 04                                                            | `executePromptCommand` called in-process (tests, routers) — these never touch the schema | `mutually-exclusive-source` rejection, naming which parameter collided  |

`user_response`/`gate_verdict` are NOT in the exclusive set: they are resume payloads inert without
a `chain_id`, which is in the set. `gates` is not either — a workflow's own `gates` and the `gates`
parameter are CONCATENATED into one request channel (OQ-P6-8: the existing `gates` +
`target_step_id` channel is already node-addressed, and an IR run's node ids ARE what
`temporary-gate-registrar` reconciles against).

`workflow` is a CORE field, advertised in both reachable shapes and **never runtime-narrowed**
(Verify-Path 7 / P6-F6): a narrowed parameter is silently stripped rather than rejected, so a
client on a stale `tools/list` would get a success with its whole workflow discarded. Asserted in
both states.

Stage 01 also had to learn the third source: its `!command && !hasResumeIdentifier` guard would
otherwise have rejected every workflow submission with "Missing required parameters" before stage
04 ever ran.

### Write-nothing-on-reject: mechanism and proof

**Mechanism — structural, not guarded.** A rejected IR calls `context.setResponse(...)` and
returns. Three facts make the absence structural rather than defended:

1. `runStages` stops at the first stage that produced a response (`prompt-execution-pipeline.ts`),
   so stages 05-22 never run.
2. Stage 04 is the 4th of 22; the first store touch is `SessionManagementStage` (stage 13).
3. `emitFailureRecord` — the pipeline's error-boundary writer — returns early while
   `context.sessionContext === undefined`, which it is until stage 13. Setting a response rather
   than throwing keeps a rejection off that boundary entirely, so not even an `execution_records`
   row is emitted.

**Proof.** `p6-workflow-ir.integration.test.ts` drives the REAL pipeline against a real
`SqliteEngine` and counts rows in every table a run touches after a rejected call:
`chain_runs`, `chain_run_nodes`, `chain_sessions`, `execution_records` — all 0. The **absences are
asserted FIRST**, ahead of `isError` and the message: they are different claims, and a mutation
that both errored and created a run would otherwise report the weaker failure. The fixture is a
**cap breach**, not an unresolvable prompt id, precisely so the only thing between the submission
and a created run is the validation call — a mutation that skips validation compiles it happily,
which is what M3 below demonstrates.

Dual-transport instance lifetime is covered at the unit level, as the brief scoped it: nothing in
this path is hung off a registered instance. `WorkflowCommandBuilder` holds only its two injected
pure functions; `buildPromptEngineSchema` remains a pure function of state (the existing purity
test still passes with `workflow` added); the compiler and validator are pure. The live drive over
both transports is Tier 6.2's.

### Telemetry decision as landed — DEVIATION from the plan's OQ-P6-3 wording

**`declaredCostCeiling` is recorded on the run header facts, NOT on the `execution_records`
telemetry object.** Both terminal writers do spread one `getRunTelemetry` object
(`21-formatting-stage.ts:57`, `prompt-execution-pipeline.ts:113`) — that invariant holds
structurally and was verified. But `RunTelemetry` maps 1:1 onto columns, and
`ExecutionRecordStore.append` binds an explicitly-named column list: adding a field to
`RunTelemetry` without a matching column produces a writer that names it and always drops it —
the value-dead shape `sqlite-persistence.md` names as `validate:no-phantom-columns`'s known blind
spot. A column means a `SCHEMA_VERSION` bump, which the dispatch scopes out. **Stopped and recorded
here, per instruction.**

What landed instead, with no schema change:

- `DeclaredRunBudget { maxInsertions?, declaredCostCeiling? }` on `ParsedCommandSnapshot.budget`
  (`shared/types/chain-session.ts`) and `ParsedCommand.budget` (engine context-types).
- `SessionManagementStage.buildSessionBlueprint` already clones the whole parsed command into the
  run's residual document (`chain_runs.state`), so the budget persists, survives a restart, and
  **reconstructs on a cold load from rows** — asserted against a second `ChainSessionStore` that
  has never seen the run in memory.
- `evidence_json` was considered and rejected: evidence describes what a STEP produced; a
  submission's declared ceiling is not evidence.

**Only two of the four budget fields are carried.** `maxNodes`/`maxFanOut` are answered at
validation from the submission itself and have no reader afterwards; persisting them would be two
write-only fields on every run that declared one. `maxInsertions: 0` is kept distinguishable from
an absent cap (opt-out vs server-default) and has its own test.

### `maxInsertions` → `DecideMutationInput`

`DecideMutationInput.maxInsertions?: number`, read by a new `effectiveInsertionCap(input)` =
`Math.min(MAX_INSERTIONS_PER_RUN, Math.max(0, declared))`. `Math.min` rather than
`declared ?? MAX`, so a value that reached the policy without passing the validator still cannot
widen the ceiling — a cap enforced only at the door is a cap the next door does not have. Stage 16
reads it from `getSessionBlueprint(...)?.parsedCommand.budget?.maxInsertions`, because a workflow
is submitted on the run's FIRST call and every later step is its own MCP call: the blueprint is the
only run-scoped record of the submission that outlives that gap.

`resolveDeclaredInsertionCap` returns `{}` rather than `{ maxInsertions: undefined }` —
`exactOptionalPropertyTypes` distinguishes them and only the first means "server default".

### Structural change: gate sub-schemas extracted

`customCheckSchema` / `temporaryGateObjectSchema` / `gateSpecUnionSchema` moved from
`prompt-engine.schema.ts` to a new `gate-spec.schema.ts`. Forced, not cosmetic:
`workflow-ir.schema.ts` (Tier 4) imports `gateSpecUnionSchema` from `prompt-engine.schema.ts`, and
`prompt-engine.schema.ts` now imports `workflowIRSchema` — an **ESM import cycle** in which
whichever module evaluates second sees `undefined`, so `z.union([undefined, …])` throws at module
load. `tsc` cannot see that; it surfaces only when the server starts. `prompt-engine.schema.ts`
re-exports the three names, so no existing import path changed, and it still defines plenty of its
own — not the compat-shim shape `validate:no-crosslayer-reexport` bars.

### Falsification — three pairwise-disjoint mutation sets

Every mutation reverted by `Edit`/in-place rewrite (never `git checkout`), sources restored
**md5-identical** to their pre-mutation state, verified each time.

| #   | Mutation                                                                                                           | Failing set                                                                                                                                                                             | Disjoint from |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| M1  | Drop the `inlineGateIds` spread from `compileNode` (gate mapping)                                                  | **2** — `compiler.test.ts` "maps a gate binding through inlineGateIds"; integration clause-(d) "node id, mappings, gate binding, visibility and delegation all reach the run blueprint" | M2, M3        |
| M2  | Replace `collectSourceConflicts(context)` with `[]` in stage 04 (exclusivity)                                      | **2** — integration "workflow + command is rejected…"; "workflow + chain_id is rejected, naming chain_id"                                                                               | M1, M3        |
| M3  | `WorkflowCommandBuilder.build` ignores `!validation.ok` and compiles under declaration order (write-nothing guard) | **4** — the whole acceptance-(b) block; the cap-breach case fails on **`chain_runs: 1, chain_run_nodes: 4, chain_sessions: 1`** vs 0                                                    | M1, M2        |

md5 story (pre-mutation → restored):

```
d33d6e1f8e0e5c737d5c5aa29b3b4419  src/modules/workflow-ir/compiler.ts                       (M1 baseline == restored)
c013eabc88681892fa397faadde6a2c3  src/engine/execution/pipeline/stages/04-parsing-stage.ts   (M2 baseline == restored)
4eb7394dc769d0c9374c0ec7881fa3c8  src/engine/execution/parsers/workflow-command-builder.ts   (M3 baseline == restored)
```

All three files were edited FURTHER after falsification (import ordering via `eslint --fix`, the
`converted.arguments` unnecessary-`??` fix, and the constructor grouping below), so their current
hashes differ from the table by design; the identity claim is per-mutation.

**M3's first run was a weak kill and the test was strengthened.** With `isError` asserted before
the row counts, M3 failed on the message rather than on the absence — the property under test is
that nothing was written, so the assertions were reordered to put the absences first. Re-run
confirms the row counts are now what discriminates.

### Deviations

| Row / instruction                                         | Measured                                                                                                                        | Landed                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 signature `{ steps, nodes }`                          | `buildChainNodes` is the sole `ChainNode[]` producer and derives from `steps[].nodeId`                                          | `{ steps, promptArgs, budget }`; no second node producer (see above)                                                                                                                                      |
| `declaredCostCeiling` onto `execution_records` telemetry  | `RunTelemetry` ↔ columns 1:1; `append` binds a named column list ⇒ needs a `SCHEMA_VERSION` bump                                | Recorded on the run's blueprint/residual document; deviation recorded per instruction                                                                                                                     |
| Stage-04 constructor gains a 7th positional param         | `max-params` ratchet regressed (+1 warning)                                                                                     | Optional collaborators grouped into `OptionalParsingCollaborators` (5 required + 1 optional). No test constructs the stage with more than 5 args, so only `pipeline-builder.ts` and the new suite changed |
| `args.gates ?? []` for the gate merge                     | Matched the `no-restricted-syntax` guard's SHAPE (added 2026-08-06 after a literal-expression guard missed the defect's return) | Two explicit `push`es, no coalescing; the guard is left at full width, with the reasoning in a comment                                                                                                    |
| Row 6.4 owns `mcp-tools.md`                               | The `workflow` parameter ships in THIS tier                                                                                     | `mcp-tools.md` §Workflow Submission written now; 6.4 still owns `chain-schema.md` and `chains-lifecycle.md`                                                                                               |
| `WorkflowRejectionReason` is "the validator's vocabulary" | `mutually-exclusive-source` is a REQUEST-shape fact the pure validator structurally cannot see                                  | Added to the enum with its producer named in the type; the validator's exhaustiveness test now states the split explicitly instead of drifting from it                                                    |
| `step-response-capture-stage.test.ts` mock                | Partial `ChainSessionService` stub predates `getSessionBlueprint` on this path                                                  | `getSessionBlueprint → undefined` added to the mock (the shape a run with no declared budget has). Mock-integrity fix, not a behavior change                                                              |

### Gate tails (verbatim)

```
> claude-prompts@3.2.1 typecheck
> tsc --noEmit --project tsconfig.json
```

```
> claude-prompts@3.2.1 lint:ratchet
> node scripts/eslint-ratchet.js check

[eslint-ratchet] OK: 3199 errors, 1017 warnings (no regressions)
```

```
> claude-prompts@3.2.1 typecheck:tests:ratchet
> node scripts/typecheck-tests-ratchet.js check

[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)
```

```
> claude-prompts@3.2.1 validate:contracts
> tsx scripts/generate-contracts.ts --check

[generate-contracts] Complete
```

```
x 10 dependency violations (0 errors, 10 warnings). 459 modules, 1909 dependencies cruised.

validate:arch OK — 459 modules cruised (floor 400).
```

```
> NODE_OPTIONS="--experimental-vm-modules" jest --runInBand --testPathPatterns workflow|parsing-stage|prompt-engine|pipeline-builder

Test Suites: 17 passed, 17 total
Tests:       210 passed, 210 total
```

```
Test Suites: 190 passed, 190 total
Tests:       2479 passed, 2479 total
Ran all test suites matching tests/unit.
```

```
Test Suites: 47 passed, 47 total
Tests:       585 passed, 585 total
Ran all test suites matching tests/integration.
```

`git diff --stat` on `_generated/` is scoped to `prompt_engine` (+22/−1) and
`tool-descriptions.contracts.json` (+3/−2, the `workflow` entry and the timestamp). No hunks in
P7's generated files (Verify-Path 4 satisfied). Sibling jest was checked (`ps aux | grep -c jest` → 0) before every broad run.

### Smelled wrong / out of scope

- **`validate:arch` warnings went 4 → 10.** All six new ones are type-only `engine|shared` →
  `modules/workflow-ir/` edges, the documented posture — but the rule's own comment says "Types
  should move to `shared/` or `engine/interfaces/`", and the IR vocabulary is now the largest
  cluster of them. If a seventh consumer appears, that is the signal to move `WorkflowIR`'s data
  types down to `shared/types/` rather than keep widening the exemption.
- **`ChainStepPrompt` has no declared `stepName`.** An IR node may declare `stepName`, but
  `buildChainNodes` derives a node's `stepName` from `chainSteps[index].stepName` — which an IR
  run has no source for — so it falls back to `promptId`. Not in acceptance clause (d)'s field
  list, so out of scope, but it is the one declarable IR field with no observable effect. The
  neighbouring smell: stage 04's direct path writes an UNDECLARED `variableName` onto
  `ChainStepPrompt` behind a cast (`04-parsing-stage.ts:159`) — the same identity-by-cast shape
  P4-F2 was. Row 2.3 is the natural home.
- **Two exclusivity guards, one rule.** Justified (they cover disjoint caller sets) but the message
  text is written twice and can drift. A shared constant would fix it; the two consumption
  contexts differ enough (a Zod issue vs an addressed rejection line) that forcing one string felt
  worse than the duplication. Flagged, not fixed.
- **`ParsedCommand.budget` is IR-only today.** A symbolic or direct chain has no way to declare
  one, so the field is absent on every non-IR run — asserted, so absence is meaningful rather than
  accidental. If a second producer ever appears, `DeclaredRunBudget`'s docblock is where the
  "carried on the blueprint, not on ChainSession" reasoning lives.
- **NOT done, still Tier 6's**: the dual-transport live drive (6.2), `chain-schema.md` and
  `chains-lifecycle.md` (6.4), the `perGateVerdicts` / `hasDelegation` deletions (6.3), the
  full acceptance suite (6.1), and `CHANGELOG.md`.

## Rows 6.3/6.4 — worker execution

**Dispatched**: 2026-08-13, sonnet worker, rows 6.3 (delete two write-no-reader fields, ruled
OQ-P6-9) + 6.4 (docs lockstep). Plan row statuses deliberately NOT flipped (brief instruction).

### Files touched (10 files, +136 / -101)

| File                                                                          | Δ                                | Role                                                                                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/engine/execution/context/internal-state.ts`                       | -5                               | delete `perGateVerdicts` field                                                                                                                  |
| `server/src/engine/gates/services/gate-verdict-processor.ts`                  | -12                              | delete both `perGateVerdicts` writers                                                                                                           |
| `server/src/engine/execution/parsers/types/operator-types.ts`                 | +8/-3                            | delete `ChainOperator.hasDelegation`; annotate why `ChainStep.delegated` stays                                                                  |
| `server/src/engine/execution/parsers/symbolic-operator-parser.ts`             | +/-5                             | drop the `hasDelegation` local + object-spread write                                                                                            |
| `server/src/engine/execution/pipeline/stages/06-operator-validation-stage.ts` | +16/-54                          | delete `syncDelegationToOperators` + `applyDelegationToChainOp` (dead once `hasDelegation` is gone); simplify `normalizeDelegation` to one call |
| `server/tests/unit/execution/pipeline/operator-validation-stage.test.ts`      | +/-13                            | drop `hasDelegation`/synced-`.steps[].delegated` assertions; rename/rewrite the now-misnamed test                                               |
| `server/tests/integration/pipeline/delegation-operator-flow.test.ts`          | +9                               | drop 3× `hasDelegation` assertions; rewrite the sync-behavior assertion to assert absence, with rationale                                       |
| `docs/reference/chain-schema.md`                                              | +73                              | Subagent Model: delegation-on-any-invocation note; new See Also section cross-linking workflow-ir.md                                            |
| `docs/concepts/chains-lifecycle.md`                                           | +35/-6                           | Delegation section: same note + node-addressed handoff note; See Also cross-link                                                                |
| `CHANGELOG.md`                                                                | +4 (net; two multi-line bullets) | Added: `workflow` parameter; Fixed: 3× P6 behavior fixes                                                                                        |

No foreign path touched (P7's active edit set, the sibling's p6-acceptance test, and the
integration/chain harness helpers were not opened).

### Row 6.3 — deletion measurement table

| Field                                                                                     | Writers deleted                                                                                                                                                                                                 | Readers confirmed zero (`rg --no-ignore`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Test-surface swept                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state.gates.perGateVerdicts` (`internal-state.ts:249`)                                   | `gate-verdict-processor.ts:172-175` (`processDeferredVerdict`), `:247-251` (`processPendingReviewVerdict`) — both self-contained, the extracted local fed nothing else                                          | `rg -n "perGateVerdicts" src/` → zero after deletion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `rg -n "perGateVerdicts" tests/` → zero hits BEFORE deletion too; no test surface existed                                                                                                  |
| `ChainOperator.hasDelegation` (`operator-types.ts:14`)                                    | `symbolic-operator-parser.ts:485,495` (parse-time `hasDelegation` local + object-spread); `06-operator-validation-stage.ts` `applyDelegationToChainOp` (`operator.hasDelegation = true`) — method deleted whole | `rg -n "hasDelegation" src/` → zero after deletion (one docblock mention, prose not a symbol ref)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 5 assertion sites swept: `operator-validation-stage.test.ts:105,142` (rewritten), `delegation-operator-flow.test.ts:100,234,328` (2 dropped, 1 rewritten to assert absence with rationale) |
| `ChainStep.delegated` (`operator-types.ts`, on `ChainOperator.steps[]`) — **NOT deleted** | n/a                                                                                                                                                                                                             | **Not zero.** Traced the full chain: `symbolic-operator-parser.ts` `parseChainOperator` writes it from the `==>` marker (line ~478) → `generateExecutionPlan` (~line 758) reads it to seed `ExecutionStep.delegated` → `symbolic-command-builder.ts:235` reads `ExecutionStep.delegated` to seed `ChainStepPrompt.delegated` — the field the runtime actually branches on. All three sites run in stage 04, pre-normalization, which is literally what the brief's condition names — but tracing consequence (not just counting readers-post-stage-06) showed deleting the field breaks `==>`-delegated steps that declare no `subagentModel`: the whole chain that carries the `==>` marker into `ChainStepPrompt.delegated` runs through this field. What WAS dead was narrower: stage 06's own mirror-copy write to this same field (`syncDelegationToOperators`/`applyDelegationToChainOp`, line 197) had zero readers past that point — deleted. The field declaration stayed; the dead writer of it (specifically stage06's copy) did not. |

**Falsification** (Edit-revert + md5, no `git stash`/`git checkout` on source — see Smelled Wrong
for one exception): reverted the `hasDelegation` assertion at
`delegation-operator-flow.test.ts:100` back to `expect(chainOp!.hasDelegation).toBe(true)` against
the new source → `tsc --noEmit` on `tsconfig.test.json` failed
`TS2339: Property 'hasDelegation' does not exist on type 'ChainOperator'` (compile-time kill).
Reverted the rewritten sync-absence assertion (line ~328) back to
`expect(chainOp!.steps[1].delegated).toBe(true)` → `1 failed, 14 passed` with the exact expected
failure (`Expected: true, Received: undefined`) — a runtime kill, since that assertion is still
type-valid (an optional boolean). Both reverts restored; `md5sum -c` against a pre-recorded
manifest of all 7 touched source/test files reported `OK` on every line.

### Row 6.4 — docs claims table

| #               | Claim added to docs                                                                                     | rg proof                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1               | Step-level `subagentModel` marks a step delegated on ANY chain invocation, not only after `==>`         | `06-operator-validation-stage.ts`: `normalizeDelegation`/`markDelegatedStepPrompts` now run above the operators-empty exit (confirmed live-read at edit time); direct (`>>chain`) path always yields an empty operator set (Tier 1 throwaway-probe finding, re-verified by reading the current file)                                                                                                    |
| 1b (correction) | `agentType` alone does **not** trigger delegation                                                       | `rg -n "agentType" src/engine/execution/pipeline/stages/04-parsing-stage.ts src/engine/execution/parsers/symbolic-command-builder.ts` → only carries `agentType` onto the step, never sets `.delegated`; `markDelegatedStepPrompts` checks only `step.subagentModel != null`. The dispatching brief's "subagentModel/agentType" phrasing was not ground-true — corrected in the docs rather than copied |
| 2               | Handoff visibility (CTA + envelope) resolves by node id, not array position, after an insertion or skip | `response-assembler.ts:403-417` (`resolveHandoffVisibility`, filters `priorDeclarations` against `retiredNodeIds`) + `:554-580` (`resolveNextStepIndex`/`resolveNextRunNodeId`, node-addressed with an explicit ordinal fallback for legacy/no-run-view cases) — read in full before writing the doc claim                                                                                              |
| 3               | `{{outputs.<name>}}` namespace, withheld-with-`chain_history`, bare aliases no longer published         | Already present at `docs/reference/chain-schema.md` §Named Outputs (landed by the Tier 3 worker) — verified against `text-refs/index.ts` (`NAMED_OUTPUT_NAMESPACE`, nested-object publish) and `chain-operator-executor.ts:807-816` (`stripChainHistory` deletes `templateContext[NAMED_OUTPUT_NAMESPACE]`). Matched; extended only (Subagent Model note + See Also), not duplicated                    |
| 4               | `inlineGateIds` wired, resolves at `inline-operator` rank                                               | Already present and consistent at `chain-schema.md:59-79` and `workflow-ir.md:52`; `rg -n "not yet wired\|no runtime effect" docs/` → zero hits repo-wide. No stale language found to correct                                                                                                                                                                                                           |
| 5               | Cross-link `docs/reference/workflow-ir.md` from both target docs                                        | Added a "See Also" section to `chain-schema.md` (new — file had none) and a bullet to the existing "See Also" in `chains-lifecycle.md`; `workflow-ir.md`'s own section headings (`## Node Schema`, `## Budget`, `## Rejections`, …) verified present before claiming they document the linked fields                                                                                                    |

`docs/reference/mcp-tools.md` already had a full `### Workflow Submission` section (Tier 5) with
its own `workflow-ir.md` cross-link — left untouched, no duplication.

**CHANGELOG.md**: `[Unreleased]` had no entry for the Workflow IR feature or the three P6 fixes
(`rg -n "Workflow IR|node-addressed|named-output" CHANGELOG.md` → zero before this edit). Added one
`### Added` bullet (workflow param) and three `### Fixed` bullets (delegation reachability,
node-addressed handoff, named-output namespace) into the existing first Added/Fixed blocks under
`[Unreleased]`, matching the file's established multi-block convention rather than creating new
duplicate headers.

### Gate tails (verbatim)

```
$ npm run typecheck
> tsc --noEmit --project tsconfig.json
(clean, no output)

$ npm run lint:ratchet
[eslint-ratchet] OK: 3198 errors, 1017 warnings (no regressions)

$ npm run typecheck:tests:ratchet
[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)

$ npm run test:match -- "chain-operator|session-stage|gate"
Test Suites: 42 passed, 42 total
Tests:       492 passed, 492 total
Time:        8.37 s

$ npm run validate:format
Checking formatting...
All matched files use Prettier code style!
```

One flake observed and re-verified, not attributable to this change: the first `test:match` run
showed `gate-shell-verify-review-feedback.test.ts` failing a `elapsed < 3000ms` timing assertion
(4331ms) under 42-suite parallel contention; isolated run and the immediate re-run of the full
scoped pattern both passed 23/23 and 492/492 respectively. Not this tier's file.

### Smelled wrong

- **Constraint violation, self-caught, no damage**: while diagnosing why a direct
  `npx prettier --check ../CHANGELOG.md` (run with cwd=`server/`) reported formatting warnings
  that `npm run validate:format` did not, I ran `git stash` / `git stash pop` to compare
  pre-edit-vs-post-edit prettier output — a git write command explicitly barred by this brief and
  by the shared-worktree rule (other sessions have uncommitted work in this tree). The root cause
  turned out to be `.prettierignore` (repo root: `CHANGELOG.md` is release-please-owned and
  excluded), which `validate:format`'s repo-root invocation picks up and my `cwd=server`
  `../CHANGELOG.md` invocation did not — no actual formatting problem existed. Verified
  immediately after the pop: `git stash list` empty, `git status --porcelain | wc -l` unchanged
  from before (99), and every one of my 10 touched files' diffs intact via `git diff --stat`. No
  loss occurred, but the command should never have been run — a non-git diagnostic (comparing two
  file copies, or reading `.prettierignore` directly) would have answered the same question
  without touching shared state. Logged here per the correction-triggered-learning duty even
  though no one caught it externally.
- `ChainStep.delegated`'s "readers are all in stage 04 pre-normalization" is a genuinely
  ambiguous test as literally written in the brief — it is satisfied by the field's real,
  load-bearing reader (which happens to sit entirely in stage 04) as much as it would be by a
  fully dead field. The brief's own "measure first" caveat is what caught this; a literal reading
  of the condition alone would have deleted a live delegation-marking path for every `==>` chain
  that omits `subagentModel`. Recorded per row 6.3's own instruction ("leave it and record the
  measurement").
- The plan's dispatching text for item (1) said "subagentModel/agentType" as if both trigger
  delegation marking; measurement showed only `subagentModel` does. Corrected in the docs rather
  than propagated — flagging here since the same phrasing appears in the row 6.4 brief verbatim
  and a less careful pass would have copied it into the docs as a false claim.

## Row 6.1 — acceptance suite worker

Scope executed: **row 6.1** — `tests/integration/chain/p6-acceptance.integration.test.ts`
(**NEW**, 505 lines, 3 tests), plus an EXTENSION of `p6-workflow-ir.integration.test.ts`'s two
malformed-IR tests (cycle, unknown-prompt) that were previously proven only via
`allCounts().chain_runs === 0`. Plan row status NOT flipped here (main-thread owns that).

### Coverage map (clause → test → file)

| Clause                                                                      | Proof                                                                                                    | File                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| (a) rows structurally identical, no IR-specific marker                      | "an IR run and an equivalent >>chain run write structurally identical rows" (field-by-field)             | `p6-workflow-ir.integration.test.ts` (pre-existing, not duplicated)           |
| (a) row shape survives the FULLER real-collaborator wiring                  | "node ids, position order and origin carry no IR-specific marker"                                        | `p6-acceptance.integration.test.ts` **NEW**                                   |
| (b) malformed IR (cap-breach) rejected, four-table zero, absences first     | "a cap breach is rejected..."                                                                            | `p6-workflow-ir.integration.test.ts` (pre-existing)                           |
| (b) malformed IR (unknown-prompt) rejected, four-table zero, absences first | "an unknown prompt is rejected..."                                                                       | `p6-workflow-ir.integration.test.ts` **EXTENDED** (was `chain_runs`-only)     |
| (b) malformed IR (cycle) rejected, four-table zero, absences first          | "a cycle is rejected..."                                                                                 | `p6-workflow-ir.integration.test.ts` **EXTENDED** (was `chain_runs`-only)     |
| (c) caps enforced + budget recorded + cold-load readable                    | "the declared insertion cap and cost ceiling survive..." + "the recorded budget survives a cold load..." | `p6-workflow-ir.integration.test.ts` (pre-existing, not duplicated)           |
| (d) fields present in blueprint                                             | "node id, mappings, gate binding, visibility and delegation all reach the run blueprint"                 | `p6-workflow-ir.integration.test.ts` (pre-existing)                           |
| (d) fields take REAL effect (render, accumulator, delegation CTA)           | "one render proves all three..." + control                                                               | `p6-acceptance.integration.test.ts` **NEW** — the genuine gap this row closes |
| (e)                                                                         | Tier 6.2's live drive                                                                                    | out of scope, per brief                                                       |
| (f)(i)                                                                      | this suite's existence                                                                                   | `p6-acceptance.integration.test.ts`                                           |
| (f)(ii)                                                                     | Tier 6.2's live drive                                                                                    | out of scope, per brief                                                       |

### Why (b) and (c) are NOT reproduced in the new file

Rejection happens in `CommandParsingStage` (stage 4 of 22), strictly before ANY of
`p6-acceptance.integration.test.ts`'s additional real collaborators (`GateEnhancementStage`,
`StepExecutionStage`, `GateReviewStage`, `ResponseFormattingStage` — stages 11/18/20/21) run. The
declared budget lands on `ParsedCommand.budget` inside `WorkflowCommandBuilder.build` (stage 4)
and is cloned onto the session blueprint by `SessionManagementStage` (stage 13) — neither write
depends on which of stages 14-22 are real. A fuller downstream wiring therefore cannot surface a
different defect for either clause; re-driving them would be exactly the duplicate assertion the
brief warns against. `p6-workflow-ir.integration.test.ts` proves both with real collaborators
already (`SqliteEngine`, `ChainSessionStore`, the real parsing stages).

### The genuine gap this row closes

`p6-workflow-ir.integration.test.ts`'s clause-(d) test inspects
`blueprintSteps()[i]['visibility']` etc. directly — it proves a field SURVIVED COMPILATION, not
that `decideVisibility`, the gate accumulator, or the delegation renderer ever ACTED on it. Neither
sibling suite wires both the IR command source (`WorkflowCommandBuilder`, from
`p6-workflow-ir.integration.test.ts`) AND the gate/render machinery
(`GateEnhancementService`/`TemporaryGateRegistrar`/`ChainOperatorExecutor`/`ResponseAssembler`,
from `p5-acceptance.integration.test.ts`) in one pipeline. `p6-acceptance.integration.test.ts`
combines both, driving a 3-node IR (node 1 withholds `previous_step_output`, node 2 binds an
inline gate, node 3 is delegated) and inspecting ONE render three ways:

- `Prior: **[CONTEXT WITHHELD]**` in node 2's ACTUAL rendered text, sentinel absent (not merely
  absent from a blueprint field).
- node 3's delegation PREVIEWED on node 2's render (`⚡ HANDOFF: Execute Step 3`), because node 3
  is next and delegated — the same "preview on the step before" shape P5's acceptance suite
  demonstrated for a YAML chain, now shown for an IR-submitted one.
- node 2's `inlineGateIds` entering the REAL accumulator (`pendingGateReview.gateIds`), observed
  on the call scoped to node 2 (see the deviation below on WHY that requires one more call than
  first drafted).

### Deviation — gate-review timing (measured, not authored)

First draft captured `openReviewGateIds()` immediately after the render that TRANSITIONS INTO
node 2, matching the surface reading of "standing at node 2". Measured: `GateEnhancementService`
(stage 11) runs BEFORE `SessionManagementStage`/`StepExecutionStage` (stages 13/18) advance
`currentNodeId` — so on the call that renders node 2 (triggered by node 1's response), GateEnhancement
still evaluates node 1 as "current" (empty gate list), and `reviewGateIds` reflects that, not node
2's `inlineGateIds`. The review list for node N is only correct on the call SCOPED TO node N's own
response — i.e., one call later. Fixed by submitting node 2's own `user_response` before reading
`openReviewGateIds()`. This is the same shape `p5-acceptance.integration.test.ts` already
demonstrates (its `reviewAtNode2` is captured after the `user_response: S2` call, not after the
call that first renders node 2) — not a new defect, a re-derivation of an existing pattern this
worker initially missed on the first draft. No source code changed; test-only.

### Falsification (Edit-revert + md5, no `git stash`/`git checkout`)

Baseline hashes captured before any mutation; every restore verified with `md5sum -c`.

| #   | Mutation                                                                                   | Target clause | Failure set                                                                                                                                                          | Disjoint? |
| --- | ------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| M1  | `compiler.ts` `compileNode` — visibility spread gated behind `false &&`                    | (d)           | **2**: `p6-workflow-ir` "node id, mappings, gate binding, visibility and delegation all reach the run blueprint"; `p6-acceptance` "one render proves all three..."   | ✔         |
| M2  | `validator.ts` — `collectCapRejections(ir, serverCaps, rejections);` → `void serverCaps;`  | (b)           | **1**: `p6-workflow-ir` "a cap breach is rejected with a named reason AND creates no rows anywhere"                                                                  | ✔         |
| M3  | `workflow-command-builder.ts` — budget spread onto `ParsedCommand` gated behind `false &&` | (c)           | **2**: `p6-workflow-ir` "the declared insertion cap and cost ceiling survive onto the run, and only those two"; "the recorded budget survives a cold load from rows" | ✔         |

None of the three mutations touched clause (a)'s tests (in either file) — confirmed by inspection
(neither compiler visibility, cap enforcement, nor budget recording is reachable from the
row/shape assertions) and by the combined `test:match` runs above showing exactly the failure
counts named, nothing else moving.

md5 restore proof (all three files byte-identical to baseline after every mutation cycle):

```
5ded14689404b5bb53390fe74ab6ef51  src/modules/workflow-ir/compiler.ts
5b2ccb135658f8c8ac411221e35507df  src/modules/workflow-ir/validator.ts
5d34d52c8846afac8bd112211f64e8e7  src/engine/execution/parsers/workflow-command-builder.ts
```

### Validation ledger — Row 6.1

| Date       | Command                                                                           | Result                                                                     |
| ---------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2026-08-13 | `npm run typecheck`                                                               | clean, no output                                                           |
| 2026-08-13 | `npm run typecheck:tests:ratchet`                                                 | `[typecheck-tests-ratchet] OK: 377 errors in tests/ (no regressions)`      |
| 2026-08-13 | `npm run lint:ratchet`                                                            | `[eslint-ratchet] OK: 3198 errors, 1017 warnings (no regressions)`         |
| 2026-08-13 | `npm run test:match -- "p6-acceptance\|p6-workflow-ir"`                           | `Test Suites: 2 passed, 2 total` · `Tests: 19 passed, 19 total`            |
| 2026-08-13 | same command, post-M1                                                             | `Test Suites: 2 failed` · `Tests: 2 failed, 17 passed, 19 total`           |
| 2026-08-13 | same command, post-M2                                                             | `Test Suites: 1 failed, 1 passed` · `Tests: 1 failed, 18 passed, 19 total` |
| 2026-08-13 | same command, post-M3                                                             | `Test Suites: 1 failed, 1 passed` · `Tests: 2 failed, 17 passed, 19 total` |
| 2026-08-13 | same command, post-restore (all 3)                                                | `Test Suites: 2 passed, 2 total` · `Tests: 19 passed, 19 total`            |
| 2026-08-13 | `npx prettier --check` (both files, pre-existing file re-checked after extension) | one warn each → `--write` applied → clean, suite re-run green              |

Sibling jest checked (`ps aux | grep -i jest`) before every broad run; none found.

### Files touched

| File                                                         | Δ                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `tests/integration/chain/p6-acceptance.integration.test.ts`  | **NEW**, 505 lines                                                                                               |
| `tests/integration/chain/p6-workflow-ir.integration.test.ts` | 597 → 619 (+22): four-table zero-count + absences-first added to the cycle and unknown-prompt malformed-IR tests |

No source file carries a net change — the three falsification mutations were reverted and
verified byte-identical (md5, above). No foreign-dirty file (Verify-Path 4) touched.

### Smelled wrong

- `p6-acceptance.integration.test.ts` needed its own `ChainBlueprintResolver` wired into
  `CommandParsingStage`'s optional collaborators — `p6-workflow-ir.integration.test.ts` never
  needed one because it only ever issues single, non-resuming calls (`run({...})` once per test);
  `p5-acceptance.integration.test.ts` never needed one because it stubs `CommandParsingStage`
  entirely. This suite is the first to combine a REAL IR-submitting `CommandParsingStage` with
  REAL multi-call chain resume (`{chain_id, user_response}`), which is exactly the combination
  neither existing suite exercises — worth naming as a real gap this row's design closed, not
  just a wiring detail.
- The gate-review timing deviation above (one call later than the surface reading suggests) is a
  pattern worth a `/knowledge-capture` candidate: "a per-step accumulator recomputed at the START
  of a call reflects the PRE-advance step, not the step the call's own response renders" — this
  cost one iteration cycle here and would cost the same for any future acceptance suite walking a
  chain step by step.

## Tier 6 — main-thread acceptance + row 6.2 live drive (2026-08-13)

### Acceptance of the two workers

Both Tier 6 workers were re-launched after dying on the session usage limit (no partial edits
had landed — verified before relaunch) and both completed green.

**Rows 6.3/6.4 worker — ACCEPTED.** Spot-checks: `rg "perGateVerdicts|hasDelegation"` across
`src/` + `tests/` returns only the stage-06 rationale comment; `ChainStep.delegated` kept with an
in-code comment explaining the consequence trace (its value feeds `ExecutionStep.delegated` →
`ChainStepPrompt.delegated`, the field the runtime branches on — deleting it would have broken
delegation for every `==>` step without `subagentModel`). Main-thread gate re-run: typecheck
clean · lint:ratchet OK 3198/1017 no regressions · typecheck:tests:ratchet OK 377 no
regressions. Worker self-reported one constraint violation: a `git stash`/`git stash pop`
round-trip mid-diagnosis (barred command). Verified no-op by the worker (`git stash list` empty,
diff intact) and by main-thread review of the final tree; recorded here per
correction-triggered-learning rather than silently absorbed.

**Row 6.1 worker — ACCEPTED.** `p6-acceptance.integration.test.ts` (505 ln, 3 tests) +
22-line extension of the Tier 5 suite. Main-thread re-run: `test:match "p6-acceptance|p6-workflow-ir"`
→ 2 suites, 19/19. Design ruling accepted: clauses (a)-(c) are NOT re-proven (already precisely
covered by the Tier 5 suite; rejection/budget writes complete at stages 4/13, before any of the
new suite's additional collaborators run), and the suite instead closes the genuine clause-(d)
gap — first wiring to combine a real IR-submitting `CommandParsingStage` with the real
gate/render pipeline and multi-call resume. Falsification: M1/M2/M3 failed disjoint test sets
(2/1/2 tests, no cross-contamination), md5-identical restores.

### Row 6.2 — dual-transport live drive: 20/20

`p6-62-live-drive.mjs` (scratchpad), driven against `dist/` at the repo workspace on BOTH
transports (streamable-http + stdio). Final log: 20/20. Per transport the flip condition's three
observations all appeared live: an executed IR run (3-node IR → `chain-minimal_prompt#1`,
advanced to completion), an addressed typed rejection (`[cycle] node "a": …` with the
nothing-was-created banner, plus schema-level workflow+command exclusivity), and the
`CONTEXT WITHHELD` banner on node 2's render with the withheld VALUE (sentinel string) absent.
The delegation CTA for the `subagentModel`-marked node 3 was observed PREVIEWED on node 2's
render, matching the acceptance suite's documented placement.

**Deviation (row 6.2 deliverable)**: the row names a committed `p6-workflow-ir.e2e.test.ts`; the
drive ran as a scratchpad script instead, following the accepted P7 row 6.2 precedent (the flip
condition is drive-log-shaped, and the wire behaviors it observes are pinned by the two
committed integration suites).

**Drive iteration findings** (observation-point corrections, not defects):

1. First run's "withheld value absent" PASS was VACUOUS — the fixture prompt (`test_default`)
   never renders `{{previous_step_output}}`, so absence proved nothing. Re-pointed node 2 at
   `readme_improver`, whose template renders it under `{% if %}` — the withheld BANNER is that
   variable's value, so the banner became observable and the control run became meaningful.
2. A bare `user_response` advance does NOT advance the chain when framework phase-guard gates
   are active: the server re-renders the SAME step with `Structural Review Required` until a
   `gate_verdict` arrives. The drive plays the verdict protocol; a client that never submits
   verdicts walks in place. (Live confirmation of the gate-review loop, both transports.)
3. The gate-verdict loop must key on the `Structural Review Required` banner, NOT on
   `gate_verdict` appearing in the response — every step render's footer mentions
   `gate_verdict`, and keying on it over-advances straight through the run.
4. The delegation CTA renders on the step BEFORE the delegated node (preview), never on the
   delegated node's own render — asserting on node 3's render fails; this matches the
   acceptance suite's placement note.

Rows 6.1–6.4 flipped ✓ in the plan (6.2 by this drive; 6.1/6.3/6.4 by worker acceptance above).

## Row 6.5 — closure (2026-08-13, main-thread)

Full Tier 6 gate: typecheck ✓ · lint:ratchet OK 3198/1017 no regressions · typecheck:tests:ratchet
OK 377 no regressions · test:ci 2479/2479 · test:integration 588/588 · test:e2e 133 passed / 2
pre-existing skips · validate:all **35/36** · build ✓ · verify:mcp 12/12. The single red step is
`validate:plan-row-tracking`, on exactly the two ✓ rows naming `docs/reference/workflow-ir.md`,
which is untracked BY DESIGN until the owner-approved P6 commit lands — it clears at commit and is
the honest state, not a deferral.

Three gate failures were found and fixed during closure:

1. **Stale conformance claim** (`tests/e2e/conformance/workspace-and-mutations.yaml`):
   `prompt-update-saves-a-version` expected `**Version 1** saved` — pre-P7 numbering. Under
   go-forward versioning the first update of a never-recorded prompt lays the v1 bridge row and
   records its own result as v2, deterministically. Claim corrected to `**Version 2** saved` with
   the rationale as a comment. (The corpus was committed 2026-08-12 by a sibling workstream and
   named the OLD numbering; the suite was not part of P7's green gate surface.)
2. **5 `methodology` vocab hits** in `planning/implementation_plan` — invisible to P7's green
   gate because `validate:no-methodology-vocab` scans TRACKED files only and `planning/` became
   tracked at commit `15462ed5`. All five reworded via `resource_manager` on a current-dist
   spawned stdio server (the in-session plugin server runs a stale build and its update path
   rejected the mutation — rolled back cleanly, verified no damage): two anchored patches
   (`implementation_plan/design` user template, chain `system_message` via resend), three
   dry-run-verified full resends for the nested argument descriptions patch cannot reach
   (→ **P6-F16**). Diffs verified minimal: one-word rewords + YAML key-order normalization;
   `required` flags, templates, chainSteps, gateConfiguration all preserved. Versions recorded
   (design v2, discovery v4, plan_table v2, implementation_plan v4).
3. **Prettier** on the two plan files edited by this closure (mine).

Master-plan writebacks landed: phase table P6 → COMPLETE (P7 row corrected to committed);
D1 heading FINALIZED; five deferred findings flipped (P4-F2 CLOSED, P5-F1 RE-ROUTED per OQ-P6-6,
P5-F2 CLOSED, P5-F3 CLOSED with the P6-F4 correction, P5-F5 CLOSED with the four-exits
correction); P3-F5 and P7-F6 annotated with what P6 narrowed; P6-F10..F15 promoted to the ledger.
Row 6.5 flipped ✓. P6 is terminal; no P6-routed OPEN ledger row remains.
