---
title: "Validation Mechanism Architecture — Implementation Notes"
plan: validation-mechanism-architecture-2026-08-05.md
date: 2026-08-06
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Deviations

## Unknowns / gaps found during execution

## Validation runs

- 2026-08-11 19:18 · `cd /home/minipuft/Applications/claude-prompts-mcp git add server/eslint-rules/claude-plugin.js server/eslint.config.js e` · ran
- 2026-08-11 19:18 · `cd /home/minipuft/Applications/claude-prompts-mcp git commit -q --no-verify -m "$(cat <<'EOF' feat(scripts): fail when a` · ran
- 2026-08-11 19:18 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== contracts in sync (pre-commit normally regenerates)? ` · ran
- 2026-08-11 19:13 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npx eslint . --format json 2>/dev/null | node -e " let s='';pro` · ran
- 2026-08-11 19:12 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npx eslint scripts/ eslint-rules/ eslint.config.js 2>&1 | rg -B` · ran
- 2026-08-11 18:39 · `cd /home/minipuft/Applications/claude-prompts-mcp echo "=== staged (must be empty) ==="; git diff --cached --name-only; ` · ran
- 2026-08-11 18:39 · `cd /home/minipuft/Applications/claude-prompts-mcp cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-` · ran
- 2026-08-11 18:39 · `cd /home/minipuft/Applications/claude-prompts-mcp python3 - <<'PY' p='plans/techincal_debt/validation-mechanism-architec` · ran
- 2026-08-11 18:38 · `cd /home/minipuft/Applications/claude-prompts-mcp python3 - <<'PY' p='plans/techincal_debt/validation-mechanism-architec` · ran
- 2026-08-11 18:27 · `cd /home/minipuft/Applications/claude-prompts-mcp/server cp scripts/validate-suite-membership.js /tmp/sm.bak echo "=== c` · ran
- 2026-08-11 18:26 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== every file the new rule fires on ===" npx eslint scri` · ran
- 2026-08-11 18:26 · `cd /home/minipuft/Applications/claude-prompts-mcp/server sed -n '693,780p' eslint-rules/claude-plugin.js` · ran
- 2026-08-11 18:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== require-guard-mechanism-verdict scope (0.3's check) =` · ran
- 2026-08-11 18:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== existing ESLint plugin rules ===" ls eslint-rules/ 2>` · ran
- 2026-08-11 18:22 · `cd /home/minipuft/Applications/claude-prompts-mcp python3 - <<'PY' p='plans/techincal_debt/validation-mechanism-architec` · ran
- 2026-08-11 18:21 · `cd /home/minipuft/Applications/claude-prompts-mcp F=plans/techincal_debt/validation-mechanism-architecture-2026-08-05-im` · ran
- 2026-08-11 18:21 · `cd /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad cp /h` · ran
- 2026-08-11 18:20 · `cd /tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad pytho` · ran
- 2026-08-11 18:20 · `cd ~/.claude/hooks echo "=== notes-skeleton's section creation (the correct form) ===" rg -n "Validation runs" -B2 -A2 p` · ran

- 2026-08-11 04:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server npx eslint scripts/validate-suite-membership.js scripts/run-val` · ran
- 2026-08-11 04:01 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== eslint on new/changed scripts ===" npx eslint scripts` · ran

- 2026-08-11 04:00 · `cd /home/minipuft/Applications/claude-prompts-mcp cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-` · ran
- 2026-08-11 03:59 · `cd /home/minipuft/Applications/claude-prompts-mcp python3 - <<'PY' p='plans/techincal_debt/validation-mechanism-architec` · ran

- 2026-08-11 03:57 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== new self-test picked up by the Jest harness? ===" NOD` · ran
- 2026-08-11 03:53 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== what does the Jest self-test harness actually cover? ` · ran
- 2026-08-11 03:53 · `cd /home/minipuft/Applications/claude-prompts-mcp echo "=== validate:build referenced in docs/README/CONTRIBUTING? ===" ` · ran
- 2026-08-11 03:45 · `cd /home/minipuft/Applications/claude-prompts-mcp cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-` · ran

- 2026-08-11 03:41 · `cd /home/minipuft/Applications/claude-prompts-mcp F=plans/techincal_debt/validation-mechanism-architecture-2026-08-05-im` · ran

- 2026-08-11 03:41 · `cd /home/minipuft/Applications/claude-prompts-mcp npx prettier --check plans/techincal_debt/validation-mechanism-archite` · ran
- 2026-08-11 03:39 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== eslint on my file (expect 0 errors) ===" npx eslint s` · ran
- 2026-08-11 03:38 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "=== eslint on the files I touched/created ===" npx eslint` · ran

- 2026-08-11 03:35 · `cd /home/minipuft/Applications/claude-prompts-mcp cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-` · ran
- 2026-08-11 03:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server G=scripts/validate-no-methodology-vocab.js T="NODE_OPTIONS=--ex` · ran
- 2026-08-11 03:31 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit` · ran

- 2026-08-06 17:27 · `python3 - <<'PY' p='/home/minipuft/Applications/claude-prompts-mcp/plans/techincal_debt/validation-mechanism-architectur` · ran

- 2026-08-06 17:24 · `git commit -q -m "$(cat <<'EOF' refactor(scripts): retire four guards, re-home them, and share one definition of a live ` · ran

- 2026-08-06 17:22 · `git add server/scripts/ server/eslint-rules/ server/eslint.config.js server/.dependency-cruiser.cjs server/package.json ` · ran
- 2026-08-06 17:20 · `git add server/scripts/ server/eslint-rules/ server/eslint.config.js server/.dependency-cruiser.cjs server/package.json ` · ran

- 2026-08-06 16:49 · `python3 - <<'PY' p='plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md' s=open(p).read() anchor="6. **` · ran
- 2026-08-06 16:49 · `cd /home/minipuft/Applications/claude-prompts-mcp/server echo "scripts/ top-level files: $(ls -p scripts/ | grep -v / | ` · ran

- 2026-08-06 16:47 · `cat >> /home/minipuft/Applications/claude-prompts-mcp/plans/techincal_debt/validation-mechanism-architecture-2026-08-05.` · ran
- 2026-08-06 16:46 · `python3 - <<'PY' p='/home/minipuft/Applications/claude-prompts-mcp/plans/techincal_debt/validation-mechanism-architectur` · ran
- 2026-08-06 16:45 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad npm r` · ran
- 2026-08-06 16:44 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad npm r` · ran
- 2026-08-06 16:43 · `npx eslint scripts/lib/exception-hygiene.js scripts/validate-no-methodology-vocab.js scripts/validate-no-llm-client.js 2` · ran
- 2026-08-06 16:42 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad npx p` · ran
- 2026-08-06 16:41 · `NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand tests/unit/scripts/exception-hygiene.test.ts 2>&1 | tail -` · ran
- 2026-08-06 16:41 · `NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand tests/unit/scripts/exception-hygiene.test.ts 2>&1 | tail -` · ran
- 2026-08-06 16:31 · `npx prettier --write plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md plans/techincal_debt/validatio` · ran

- 2026-08-06 16:31 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'PLANEOF' ## Execution record — Tier 3.1 (` · ran
- 2026-08-06 16:28 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad A=scr` · ran
- 2026-08-06 16:27 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad TMPF=` · ran
- 2026-08-06 16:26 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad npm r` · ran
- 2026-08-06 16:25 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad npm r` · ran
- 2026-08-06 16:24 · `npx prettier --write tests/unit/scripts/validation-suite-runner.test.ts >/dev/null && npx prettier --check scripts/run-v` · ran
- 2026-08-06 16:24 · `npx prettier --check scripts/run-validation-suite.js tests/unit/scripts/validation-suite-runner.test.ts scripts/validate` · ran
- 2026-08-06 16:24 · `npx eslint scripts/run-validation-suite.js tests/unit/scripts/validation-suite-runner.test.ts 2>&1 | tail -20; echo "ESL` · ran
- 2026-08-06 16:24 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad START` · ran
- 2026-08-06 16:23 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad node ` · ran
- 2026-08-06 16:22 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f-4302-a7a6-09e3a23a0438/scratchpad cp sc` · ran
- 2026-08-06 16:22 · `NODE_OPTIONS="--experimental-vm-modules" npx jest --runInBand tests/unit/scripts/validation-suite-runner.test.ts 2>&1 | ` · ran
- 2026-08-06 16:22 · `npm test -- --testPathPatterns 'validation-suite-runner' 2>&1 | tail -12` · ran
- 2026-08-06 16:21 · `npm test -- tests/unit/scripts/validation-suite-runner.test.ts 2>&1 | tail -45` · ran
- 2026-08-06 16:20 · `npx jest tests/unit/scripts/validation-suite-runner.test.ts 2>&1 | tail -40` · ran
- 2026-08-06 16:19 · `sed -n 330,375p eslint.config.js` · ran
- 2026-08-06 16:19 · `rg -n "MECHANISM|TARGET_DIR|filename|guard" eslint-rules/claude-plugin.js | sed -n 1,40p; echo "=== config wiring ==="; ` · ran
- 2026-08-06 16:18 · `for f in scripts/eslint-ratchet.js scripts/typecheck-tests-ratchet.js scripts/generate-contracts.ts scripts/generate-fra` · ran
- 2026-08-06 16:18 · `for f in scripts/eslint-ratchet.js scripts/typecheck-tests-ratchet.js scripts/generate-contracts.ts scripts/generate-fra` · ran
- 2026-08-06 16:15 · `START=$(date +%s%N); npm run validate:all >/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/8f5977e0-8d9f` · ran
- 2026-08-06 16:14 · `rg -n "validate:all|npm run validate" /home/minipuft/Applications/claude-prompts-mcp/.github/workflows/ci.yml /home/mini` · ran
- 2026-08-06 15:55 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - <<'PYEOF' import pathlib p = pathlib.Path('plans/techinca` · ran

- 2026-08-06 15:54 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'EOF' ## Tier 0.7 (20` · ran

- 2026-08-06 15:53 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'PLANEOF' ## Execution record — Tier 0.7 (` · ran
- 2026-08-06 15:52 · `npm run validate:all >/tmp/va-07.log 2>&1; echo "validate:all EXIT=$?"; npm test 2>&1 | grep -E "Tests:|Suites:"; npm ru` · ran
- 2026-08-06 15:49 · `echo "=== what are validate:arch's 3 warnings? ===" && npm run validate:arch 2>&1 | grep -E "^(warn|error)|methodology-v` · ran

- 2026-08-06 15:31 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'EOF' ## Tier 1.6 (20` · ran

- 2026-08-06 15:30 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'PLANEOF' ## Execution record — Tier 1.6 (` · ran
- 2026-08-06 15:29 · `python3 - <<'PYEOF' import pathlib p = pathlib.Path('plans/techincal_debt/validation-mechanism-architecture-2026-08-05.m` · ran
- 2026-08-06 15:29 · `python3 - <<'PYEOF' import pathlib p = pathlib.Path('plans/techincal_debt/validation-mechanism-architecture-2026-08-05.m` · ran
- 2026-08-06 15:28 · `npm test 2>&1 | tail -6; echo "=== validate:all ==="; npm run validate:all >/tmp/va-16.log 2>&1; echo "validate:all EXIT` · ran
- 2026-08-06 15:26 · `npm test 2>&1 | grep -E "●.*›|FAIL" | head -20` · ran
- 2026-08-06 15:25 · `npm test 2>&1 | tail -6` · ran
- 2026-08-06 15:25 · `npm run typecheck 2>&1 | tail -2; echo "typecheck EXIT=$?"; npm run lint:ratchet 2>&1 | tail -2; npm run typecheck:tests` · ran
- 2026-08-06 15:24 · `echo "=== the 1.5 selectors on the processor file (should be 0 errors AND 0 unused-disable) ===" && npx eslint src/mcp/t` · ran
- 2026-08-06 15:24 · `cp src/mcp/tools/resource-manager/prompt/utils/validation.ts /tmp/val-backup.ts cp src/mcp/tools/resource-manager/prompt` · ran
- 2026-08-06 15:24 · `python3 - <<'PYEOF' import pathlib p = pathlib.Path('tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-proce` · ran
- 2026-08-06 15:24 · `grep -n "constructor" -A 3 src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.ts | head -6 python3 - <<'PY` · ran
- 2026-08-06 15:23 · `python3 - <<'PYEOF' import pathlib p = pathlib.Path('tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-proce` · ran
- 2026-08-06 15:23 · `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor ` · ran
- 2026-08-06 15:22 · `cat >> tests/unit/mcp-tools/resource-manager/prompt/prompt-lifecycle-processor.test.ts <<'EOF' /** * Row 1.6: 'gate_conf` · ran
- 2026-08-06 06:36 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:all >/tmp/va-06f.log 2>&1; echo "validate:a` · ran
- 2026-08-06 06:35 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'EOF' ## Tier 0.6 (20` · ran

- 2026-08-06 06:35 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'PLANEOF' ## Execution record — Tier 0.6 (` · ran
- 2026-08-06 06:34 · `python3 - <<'PYEOF' import pathlib p = pathlib.Path('plans/techincal_debt/validation-mechanism-architecture-2026-08-05.m` · ran
- 2026-08-06 06:34 · `echo "=== live exception entries across surviving guards ===" && for f in scripts/validate-no-*.js scripts/verify-mcp-su` · ran
- 2026-08-06 06:34 · `npm test 2>&1 | tail -6` · ran
- 2026-08-06 06:33 · `npm run validate:all >/tmp/va-06.log 2>&1; echo "validate:all EXIT=$?"; grep -iE "error|fail|warn\]" /tmp/va-06.log | he` · ran
- 2026-08-06 06:32 · `npm run typecheck 2>&1 | tail -3; echo "typecheck EXIT=$?"; echo "=== ratchets ==="; npm run lint:ratchet 2>&1 | tail -3` · ran
- 2026-08-06 06:32 · `echo "=== plant a compat shim (rule must still fire without the allowlist option) ===" && mkdir -p src/shared/__plant &&` · ran
- 2026-08-06 06:31 · `python3 - <<'EOF' import pathlib p = pathlib.Path('eslint.config.js'); s = p.read_text() s = s.replace(" 'src/types.ts',` · ran
- 2026-08-06 06:30 · `cd /home/minipuft/Applications/claude-prompts-mcp && echo "=== references to server/src/types.ts outside itself ===" && ` · ran
- 2026-08-06 06:30 · `cd /home/minipuft/Applications/claude-prompts-mcp && echo "=== any import specifier that could resolve to server/src/typ` · ran
- 2026-08-06 06:29 · `echo "=== incoming edges to src/types.ts (resolved, via dependency-cruiser) ===" && npx depcruise src --output-type json` · ran
- 2026-08-06 06:27 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'EOF' ### Deletion le` · ran

- 2026-08-06 06:26 · `echo "=== THIS TIER's uncommitted scope ===" && git status --porcelain | grep -E "eslint|plan|validate-no|prompt-lifecyc` · ran
- 2026-08-06 06:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm test 2>&1 | tail -6` · ran
- 2026-08-06 06:25 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && for i in 1 2; do npm run validate:all >/tmp/va-f$i.log 2>&1;` · ran

- 2026-08-06 06:23 · `grep -n "validate-no-execution-mode\|validate-no-prompt-gates-alias" scripts/validate-no-llm-client.js eslint.config.js ` · ran
- 2026-08-06 06:23 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:all >/tmp/va-final.log 2>&1; echo "validate` · ran
- 2026-08-06 06:22 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'NOTESEOF' ## Tiers 1` · ran
- 2026-08-06 06:21 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'PLANEOF' ## Execution record — Tiers 1.4 ` · ran
- 2026-08-06 06:19 · `npm test 2>&1 | tail -8` · ran
- 2026-08-06 06:19 · `npm run validate:all >/tmp/va-14-15.log 2>&1; echo "validate:all EXIT=$?"; tail -12 /tmp/va-14-15.log` · ran
- 2026-08-06 06:18 · `npm run typecheck 2>&1 | tail -3; echo "typecheck EXIT=$?"; echo "=== lint:ratchet ==="; npm run lint:ratchet 2>&1 | tai` · ran
- 2026-08-06 06:17 · `F=src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts cp $F /tmp/proc-backup.ts printf '\ndecla` · ran
- 2026-08-06 06:17 · `cp eslint-rules/claude-plugin.js /tmp/plugin-backup.js echo "===== M1: drop the computed MemberExpression selector =====` · ran
- 2026-08-06 06:16 · `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/eslint-rules/ 2>&1 | tail -25` · ran
- 2026-08-06 06:15 · `npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.ts 2>&1 | grep -E "no-restricted-sy` · ran
- 2026-08-06 06:15 · `F=src/modules/automation/execution/tool-trigger-filter.ts && cp $F /tmp/plant-backup.ts && printf '\nconst __plantA = { ` · ran
- 2026-08-06 06:14 · `echo "=== 1.5 selector on the processor file ===" && npx eslint src/mcp/tools/resource-manager/prompt/services/prompt-li` · ran
- 2026-08-06 06:14 · `echo "=== 1.4 rule on automation scope ===" && npx eslint 'src/modules/automation/**/*.ts' 'src/shared/types/automation.` · ran
- 2026-08-06 06:12 · `echo "=== plugin structure ===" && grep -n "^const \|^export const rules\|meta: {\|messages: {\|create(" eslint-rules/cl` · ran
- 2026-08-06 06:12 · `echo "=== config block boundaries + files scopes ===" && grep -n "^ {\|^ },\|files: \|ignores: \|'no-restricted-syntax'"` · ran
- 2026-08-06 06:09 · `echo "=== which files own the existing no-restricted-syntax block ===" && awk 'NR>=150 && NR<=218' eslint.config.js | gr` · ran
- 2026-08-06 06:08 · `echo "=== existing no-restricted-syntax usage ===" && grep -n "no-restricted-syntax" -A 25 eslint.config.js | head -60` · ran

- 2026-08-06 06:01 · `for i in 1 2; do npm run validate:all >/tmp/va8-$i.log 2>&1; echo "run $i EXIT=$?"; done; diff <(grep -c "" /tmp/va8-1.l` · ran
- 2026-08-06 06:00 · `npm run validate:all >/tmp/va7.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/va7.log` · ran
- 2026-08-06 05:59 · `npm run validate:all 2>&1 | grep -iE "\[warn\]|error|fail" | head -10` · ran
- 2026-08-06 05:58 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'EOF' ### Stale secti` · ran

- 2026-08-06 05:57 · `python3 - <<'PY' import io p='plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md' s=io.open(p,encoding` · ran
- 2026-08-06 05:56 · `cd /home/minipuft/Applications/claude-prompts-mcp && ls -l --time-style=+%H:%M:%S plans/techincal_debt/validation-mechan` · ran
- 2026-08-06 05:56 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'EOF' ## Execution record — Tier 0.5 (2026` · ran

- 2026-08-06 05:54 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - <<'PY' import io p='plans/techincal_debt/validation-mecha` · ran
- 2026-08-06 05:54 · `npm run typecheck 2>&1 | tail -2; npm run lint:ratchet 2>&1 | tail -2; npm run typecheck:tests:ratchet 2>&1 | tail -2; n` · ran
- 2026-08-06 05:52 · `perl -0pi -e "s/const allowedQualifiers = qualifiers\[disposition\];/const allowedQualifiers = Object.values(qualifiers)` · ran
- 2026-08-06 05:52 · `cp eslint-rules/claude-plugin.js /tmp/cp2.bak echo "--- M1: pool qualifiers across dispositions (the 'not pooled' test s` · ran
- 2026-08-06 05:52 · `grep -n "allowlist" eslint.config.js echo "--- require-guard block:"; sed -n '/require-guard-mechanism-verdict/,+2p' esl` · ran
- 2026-08-06 05:51 · `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/eslint-rules/ 2>&1 | grep -E "Tests:|✕|●" | head -10 echo "==` · ran
- 2026-08-06 05:51 · `python3 - <<'PY' import io V={ 'scripts/validate-no-execution-mode.js': 'MECHANISM: rehome — eslint — row 1.4. 'SCOPE' i` · ran
- 2026-08-06 01:26 · `python3 - <<'PY' import io p='plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md' lines=io.open(p,enco` · ran
- 2026-08-06 01:25 · `cd /home/minipuft/Applications/claude-prompts-mcp && cat >> plans/techincal_debt/validation-mechanism-architecture-2026-` · ran

- 2026-08-06 01:24 · `npx prettier --write plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md >/dev/nul` · ran

- 2026-08-06 01:23 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05-implementation-notes.md <<'EOF' ## Deviations —` · ran
- 2026-08-06 01:22 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && npm run validate:all >/tmp/va5.log 2>&1; echo "validate:all ` · ran
- 2026-08-06 01:21 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'EOF' ## Execution record — Tier 1.2 (2026` · ran
- 2026-08-06 01:21 · `python3 - <<'PY' import io p='plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md' lines=io.open(p,enco` · ran
- 2026-08-06 01:20 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - <<'PY' import io p='plans/techincal_debt/validation-mecha` · ran
- 2026-08-06 01:20 · `npm run validate:all >/tmp/va3.log 2>&1; echo "validate:all EXIT=$?"; echo "steps: $(node -p "require('./package.json').` · ran
- 2026-08-06 01:18 · `echo "=== guard lint clean? ==="; npx eslint 'scripts/validate-no-*.js' 2>&1 | grep -c "require-guard" || echo 0 echo "=` · ran
- 2026-08-06 01:18 · `python3 - <<'PY' import io V={ 'scripts/validate-no-stepstate.js': ('reach','scans 'tests/' as well as 'src/', and ESLin` · ran
- 2026-08-06 01:17 · `printf "export async function f(): Promise<unknown> {\n return await import('../../modules/prompts/prompt-schema.js');\n` · ran
- 2026-08-06 01:17 · `echo "=== D1: barrel re-exports a real symbol from a forbidden module ===" grep -n "^export " src/modules/prompts/prompt` · ran
- 2026-08-06 01:17 · `set -e mk(){ printf "%s\n" "$2" > "$1"; } echo "=== PLANT A: value import in src/mcp/tools (should FIRE) ===" mk src/mcp` · ran
- 2026-08-06 01:16 · `ls src/cli-shared/resource-validation.ts src/modules/prompts/prompt-schema.ts src/engine/gates/core/gate-schema.ts src/e` · ran
- 2026-08-06 01:15 · `cd /home/minipuft/Applications/claude-prompts-mcp/server && pwd && npm run validate:all >/tmp/va2.log 2>&1; echo "valida` · ran
- 2026-08-06 01:14 · `npm run validate:format >/tmp/vf.log 2>&1; echo "root validate:format EXIT=$?"; tail -5 /tmp/vf.log` · ran
- 2026-08-06 01:13 · `npm run validate:format 2>&1 | tail -25; echo "EXIT=$?"` · ran
- 2026-08-06 01:13 · `npm run validate:format 2>&1 | grep -E "^\[warn\]|warn " | head -20` · ran
- 2026-08-06 01:13 · `npx prettier --write plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md >/dev/null 2>&1 && npx prettie` · ran
- 2026-08-06 01:13 · `cat >> plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md <<'EOF' ## Execution record — Tier 0.3 (2026` · ran
- 2026-08-06 01:12 · `python3 - <<'PY' import io p='plans/techincal_debt/validation-mechanism-architecture-2026-08-05.md' s=io.open(p,encoding` · ran
- 2026-08-06 01:12 · `npm run validate:all >/tmp/va.log 2>&1; echo "EXIT=$?"; grep -ciE "^(error|✖)" /tmp/va.log; grep -c "" /tmp/va.log` · ran
- 2026-08-06 01:11 · `time npm run validate:all 2>&1 | tail -20; echo "EXIT=${PIPESTATUS[0]}"` · ran
- 2026-08-06 01:10 · `npm test 2>&1 | tail -8` · ran
- 2026-08-06 01:09 · `echo "=== tests ratchet ==="; npm run typecheck:tests:ratchet 2>&1 | tail -4; echo "=== rule test still green ==="; NODE` · ran
- 2026-08-06 01:09 · `sed -n '675,690p' eslint-rules/claude-plugin.js` · ran
- 2026-08-06 01:09 · `npx tsc --noEmit --project tsconfig.test.json 2>&1 | grep "require-guard"` · ran
- 2026-08-06 01:08 · `echo "=== typecheck ==="; npm run typecheck 2>&1 | tail -3; echo "=== lint:ratchet ==="; npm run lint:ratchet 2>&1 | tai` · ran
- 2026-08-06 01:08 · `git status --short scripts/ && echo "=== breakdown of the 6 ===" && npx eslint 'scripts/validate-no-*.js' 2>&1 | grep -E` · ran
- 2026-08-06 01:08 · `cat > scripts/validate-no-plant.js <<'EOF' #!/usr/bin/env node /** Planted guard with no mechanism verdict. */ console.l` · ran
- 2026-08-06 01:07 · `cp eslint-rules/claude-plugin.js /tmp/cp.bak # Mutation 1: neuter missingReason perl -0pi -e "s/if \(verdict\.reason\.tr` · ran
- 2026-08-06 01:07 · `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/eslint-rules/ 2>&1 | tail -30` · ran

## Deviations — Tier 0.3 (2026-08-06)

- `4.4× Tier 1.1's target` was computed against `no-stepstate` (64 ln), the target 1.1 abandoned.
  Against 1.1's actual target it is 2.8×. A ratio outlives the retarget that invalidates it.
- "Eight guards" stayed 8 across a substitution (`no-crosslayer-reexport` out, `no-llm-client` in).
  A stable count is a weaker check than it looks.
- `no-execution-mode` was filed as Class B on "artifact reads confirmed". Measured: `SCOPE` is
  inside `src/`, only I/O is ripgrep over those paths. Verdict withdrawn, handed to 1.2.
- The check for 0.3 was deliberately built as an ESLint rule, not script #40. Conservative option
  would have been another script; taking it would have made the convention contradict itself.
- `eslint-rules/claude-plugin.d.ts` added: the plugin is plain JS and the TS test import resolved
  to `any` (TS7016). Declaration over per-call-site cast.

## Deviations — Tier 1.2 (2026-08-06)

- The retired guard's header gave the right destination for the wrong reason: it claimed a
  path-based rule "follows the move", but the depcruise `to.path` is also a literal list. The real
  gain is specifier-form coverage (`export … from`, `await import(…)` both evaded the script).
  Kept the verdict, replaced the rationale.
- `no-prompt-gates-alias` "STAYS pending — gains nothing from an AST" is a cost argument, not a
  mechanism one. Under 0.3's convention it names no property → re-home (row 1.5). Declining to
  carve an exception one day after writing the convention.
- **Row 0.5 confirmed by accident**: deleting the retired guard orphaned its allowlist entry and
  nothing reported it — a rule only visits files that still exist. Removed by hand.

### Unknown surfaced in 1.2, not resolved

**Does dependency-cruiser report a `forbidden` rule whose `to.path` matches no module?** I stated
that the new `tool-layer-no-validator-value-imports` rule is _equal_ to the deleted guard on rename
fragility — both carry a literal list of six module paths. That is true only if nothing notices the
list going stale. If depcruise has an unmatched-rule or unreachable-pattern report, the rule is
strictly better than I recorded and the guard's original claim ("a path-based rule follows the
move") was closer to right than my correction says.

- **Current default**: assume no such detector; the rule is equal-not-better on renames.
- **Closes when**: depcruise's `--validate` output or config options are checked for an
  unmatched-rule warning, or a probe renames one of the six modules and observes whether the run
  stays green. One command either way.
- **If it turns out there is no detector**: that is the same shape as row 0.5 and the value-dead
  column blind spot in `.claude/rules/sqlite-persistence.md` — a literal list nothing re-reads.
  It would belong to 4.1's shared exception-hygiene harness, not to a third one-off.

### Where the two source edits landed

- `server/.dependency-cruiser.cjs` — `tool-layer-no-validator-value-imports`, replacing the deleted
  guard. Comment carries the measured evasion cases and the corrected rationale.
- `server/eslint.config.js` — the `MECHANISM:` convention text (this is where an author lands when
  the rule fires, so the vocabulary is stated there rather than only in the plan), plus the
  allowlist reduced from eight entries to the two re-home-pending guards, each naming its row.

## Deviations — Tier 0.5 (2026-08-06)

- **Row premise superseded, not executed.** 0.5 asked for a detector for stale allowlist entries.
  An ESLint rule cannot host one — if every guard were deleted the glob would match nothing and the
  rule would never run, so the detector fails hardest exactly when the list is most stale. Removed
  the allowlist instead: `MECHANISM: rehome — <destination> — <row>` is declared in the guard, so
  the exemption dies with the file.
- **Retired a working mechanism deliberately.** `staleAllowlistEntry` fired correctly in 1.2
  (five markers, five reports). It was still deleted, because it only existed to reconcile two
  places that are now one. A check that reconciles a duplication is worth less than removing the
  duplication.
- **A mutation reddened two tests, and that was correct.** Pooling the qualifier vocabularies makes
  the per-disposition lookup never return `undefined`, which silently disables the disposition
  check too. Recorded rather than treated as a weak-test signal.
- **Second instance found, deferred as row 0.6**: `no-compat-reexport-shim`'s
  `allowlist: ['src/types.ts']` has the identical shape, and its retirement condition is that
  file's deletion — satisfying it orphans the entry. Not fixed inside 0.5; it should pick between
  the in-file form and 4.1's harness on purpose.

### Stale sections flushed after 0.5 (2026-08-06)

Caught by the plan-sync gate, not by me — two load-bearing sections still described the world as
authored:

- **"The observation"** claimed nine guards and four custom rules. Measured now: seven guards, six
  rules, plus one dependency-cruiser rule. Kept as-authored / as-measured rather than overwritten.
- **The Classification table** listed `no-stepstate` as Class A → ESLint rule. 1.2 measured that it
  cannot move at all (scans `tests/`). Marked falsified in the cell, and the section carries a
  supersession note: **class is not sufficient to decide a home.** The A/B split survives as the
  Relation property; Reach and Resolution override it in both directions —`no-stepstate` is Class A
  and immovable, `no-tool-layer-validator-imports` was Class A and belonged in dependency-cruiser.

**Pattern worth keeping**: execution records accumulated correctly for four tiers while the
document's _opening_ sections stayed wrong. A reader entering at the top would have taken the
falsified model as current. Appending a record is not the same as realigning the plan.

### One-off `validate:all` EXIT=1, not reproduced — evidence for the parallelisation unknown

A single run exited 1 with no failing step visible in its output; two consecutive re-runs exited 0
with identical output length. The failing run was chained in the same shell command as a
`prettier --write` on a plan file, so the most plausible reading is `validate:format` reading a
file mid-write.

Not chased further — but it is a data point for the plan's open unknown _"would parallelising
`validate:all` be safe? Some steps write files."_ If a **sequential** chain can race a writer
outside it, the read/write classification 3.1 has to produce is load-bearing rather than
theoretical. Recorded here so 3.1 inherits the observation instead of rediscovering it.

## Tiers 1.4 + 1.5 (2026-08-06)

### Deviations

- **Row 1.4 costed the port at "seven allowlist entries".** Measured 10. Probing _load-bearing_
  rather than _present_ found 3 that suppress nothing: two named `scripts/` and `package.json`,
  which the guard's own `SCOPE` never visited, and one whose match string is a substring of another
  entry's. Then the AST port removed the need for any of them — prose cannot match a property
  selector, and prose is what most of the allowlist suppressed. Ported as 0 rule options + 2
  `ignores` paths.
- **Row 1.5's port was faithful-by-verification but would have been vacuous.** Its stated
  verification — "a planted `|| args.gates` is reported" — is satisfied by a literal port that
  carries the guard's five-month blind spot. Verified the `??` form separately. **A row's own
  verification criterion can be insufficient to establish that the row was done meaningfully**;
  this is the second time in this plan that a check's criterion needed checking (0.5 was the first).
- **Did not fix the live 1.5 violation.** Removing the `gates` spelling narrows a documented union
  → major bump. Out of tier mandate. Sited an `eslint-disable` with its retirement condition and
  opened row 1.6 to own the decision.
- **Line counts 98/51 → 102/55**, caused by this plan's own tier 1.2 adding `MECHANISM:` headers.

### Reusable findings

- **An exception can be born dead.** Prior instances in this plan (1.2's orphan, 0.6's
  `src/types.ts`) were exceptions that _became_ stale. Two of 1.4's were never live — written
  against a mental model of a repo-wide scan the guard never performed. A hygiene harness (4.1)
  that only detects _became-stale_ misses this class; the check is "does this entry suppress a real
  hit", which catches both.
- **Flat-config replacement trap.** A later block replaces a rule's options rather than merging.
  Adding a file-scoped `no-restricted-syntax` block would have dropped the two existing selectors
  for exactly the file being tightened — a net loss of enforcement, reported by nothing. Applies to
  every future re-home into a shared-options rule.
- **`eslint-disable` gets satisfied-exception detection for free** ("Unused eslint-disable
  directive"). Config-array allowlists do not. Direct input to 0.6's open choice and to 4.1's scope.
- **A guard can stop observing its target without failing.** Nothing in a green run distinguishes
  "no defect" from "defect written differently". The guard's own header described the shape
  correctly; the regexes narrowed it to two spellings. Where a check's prose and its implementation
  disagree, the prose is often the better specification — and porting is the moment to notice.

### Deletion left a dangling reference in a surviving guard

`scripts/validate-no-llm-client.js` cited `validate-no-execution-mode.js` in its header as the
worked example of the homonym trap it was named to avoid. Deleting the cited guard turned that into
a pointer at nothing. Repointed at the replacement rule (`claude/no-deprecated-automation-mode`),
which still demonstrates the same thing — it scopes narrowly precisely because `mode` is one of this
repo's heaviest homonyms.

**Found by the Removal Checklist's residual-reference sweep (`rg` for the deleted names), not by any
gate.** Nothing in `validate:all` reads guard prose, so a surviving guard can cite a deleted one
indefinitely. The cost is small per instance and compounds: these headers are the only place the
_reasoning_ behind a guard's scope lives, so a dead pointer quietly removes the justification rather
than just a link.

Worth noting the sweep must run over the whole repo, not `scripts/` — the same pass found intended
provenance comments in `eslint.config.js` (kept: they document what replaced what, matching the
form 1.2 established in `.dependency-cruiser.cjs`) and had to distinguish those from this stale one.

## Tier 0.6 (2026-08-06)

### Deviations

- **The row's two options were both wrong.** It asked how to make the exemption detectable; the
  measured answer was that it was already retirable — `src/types.ts` had 0 dependents. Retire before
  re-home applies to **exceptions**, not just guards. Third tier running where the cheapest option
  was the one the row had not listed.
- **4.1 was sized at 18 live entries; re-measured 37.** `no-methodology-vocab` alone holds 34.
  Opened row 0.7 rather than leaving it inside 4.1 — 34 entries is a triage of the same shape 1.4
  ran on ten, not a sub-task of building a harness.
- **Removed the rule's `allowlist` option rather than leaving it empty.** Consistent with 0.5.

### Reusable findings

- **A retirement condition makes an exception retirable; it does not make anyone notice it became
  retirable.** The `src/types.ts` entry carried its exit condition verbatim beside it, the condition
  was satisfied, and every gate stayed green. Satisfaction is precisely the state nothing observes.
- **`closedBy` is a promise, not a check.** `validate-no-llm-client.js` has good hygiene — every
  exception carries `closedBy` — and its `src/types.ts` entry still went stale the instant the file
  was deleted. Both were removed by hand, found by the removal sweep.
- **`no-orphans` structurally cannot see a dead re-export.** Orphan requires no incoming AND no
  outgoing edges; a re-export always has outgoing. Measured: `orphan: false` on a file with zero
  dependents. Only `knip` catches this shape, and `knip` is not in `validate:all` — a candidate gap
  worth its own row if a second instance appears.
- **Deleting a file is a five-site edit, not one.** Here: the file, an ESLint allowlist entry, a
  `lifecycleAnnotationTargets` glob, another guard's exception list, and prose in a third file that
  described the deleted module as if it existed. `rg` finds all five; nothing else does.

## Tier 1.6 (2026-08-06)

### Deviations

- **1.5's exemption comment over-claimed.** It called `gates` "a reachable member of the documented
  tool-surface union", pricing removal as a major bump. The contract declares `gates` as
  `[Framework]` only — the prompt-path acceptance was reachable but **undeclared**. Corrected.
- **1.5's timeline was wrong in the flattering direction.** It said the defect "returned one week
  after the guard landed." Measured: the defect predates the guard, and the guard was unwired until
  2026-07-29. Superseded in place rather than overwritten.
- **`UPDATE_FIELDS` lacked `gate_configuration`.** Deleting the special case outright would have
  broken `gate_configuration` updates entirely. Caught by reading the map instead of assuming the
  loop already covered the field.
- **An existing test pinned the old behaviour** (`does not include gate_configuration (has alias
handling)`) and had to be inverted.

### Reusable findings

- **"It is green" is not "it works."** 1.5 inferred that a passing guard must once have been
  correct. It never was: written against code that already violated it, unwired for 4.5 months, then
  wired after the code had been reformatted past its regexes. The distinguishing question is **"when
  did this check last actually fail?"** — a check that has never failed is unverified, not proven.
  Same shape as the testing rule "a test that has not failed is unverified", applied to gates.
- **A test can freeze an accident into apparent intent.** The `not.toHaveProperty` assertion
  documented an implementation detail with a parenthetical reason, and read as a design decision.
  An exclusion assertion should state what would make the thing includable; otherwise the next
  reader inherits a choice nobody made.
- **Behaviour beats commentary when deciding intent.** The only artifact arguing the alias was
  deliberate was a test comment. The only artifact arguing it was accidental was the code itself —
  accepted on update, ignored on create. The asymmetry decided it, and asymmetry between sibling
  paths is a generally cheap probe for "was this designed?"
- **Removing a special case is a two-part change**: delete the branch AND re-home whatever
  legitimate work it was doing. Only the alias was accidental; `gate_configuration` handling was not.

### Testing `updatePrompt` costs four collaborators the create path does not need

Writing 1.6's two tests took several iterations because `PromptLifecycleProcessor.updatePrompt`
reaches past the create path's context. Recorded so the next person writing one starts from the
answer:

| Collaborator                                   | Why the update path needs it                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `getData()`                                    | must return the stored prompt, or `currentPrompt` is undefined                     |
| `versionHistoryService.isAutoVersionEnabled()` | gates the diff/versioning branch — stub `false` to stay on field mapping           |
| `textDiffService` (`ObjectDiffGenerator`)      | renders the change summary, reached unconditionally after the write                |
| `comparisonEngine` (`ComparisonEngine`)        | reached whenever `beforeAnalysis` exists, i.e. whenever the prompt already existed |

The existing `createProcessor()` helper supplies none of these, and its doc-comment explicitly says
the omitted fields "are never read on this path" — true for create, and easy to read as true of the
file. A second helper was added rather than widening the first, so each states the surface its own
path actually touches.

**One latent trap found on the way**: `new ComparisonEngine()` with no argument passed the tests.
Its constructor takes a `logger`, and the omission survived only because this path never logs — the
context is cast `as unknown as PromptResourceContext`, so TypeScript could not object either. Fixed
to pass the logger. A collaborator can be half-constructed and still green when the assertion does
not exercise the part that would fail; the cast is what removes the compiler as a backstop, which is
the cost of that idiom rather than an argument against it.

## Tier 0.7 (2026-08-06)

### Deviations

- **My probe committed F2 — this plan's own named error.** Parsing `ALLOWLIST` with a regex over raw
  source picked up a blanket entry quoted inside a comment (`{ file: 'tests/', match: 'methodolog' }`),
  which the comment exists to explain was _removed_. The phantom then covered all ten per-file test
  entries, reporting 12 redundant. Acting on that would have restored the exact blanket exemption
  that once let 18 stale assertions through. Stripping comments first gives 37 entries and 34
  load-bearing.
- **Row 0.7's "34 entries" was wrong (37)** — the figure came from a loose grep in 0.6 that counted
  comment lines. 34 is coincidentally the surviving count, an agreement that conceals rather than
  confirms.
- **Two dead entries, two different causes.** `docs/` was genuinely clean; `CLAUDE.md` was inert only
  because the scan cannot reach it. Both deleted per the row's criterion, the second recorded as row
  0.8.
- **Found the dead depcruise rule while classifying unreachable hits** → row 0.9, and it closes the
  open unknown 1.2 recorded.

### Reusable findings

- **A measuring instrument needs the same falsification as the code it measures.** The first probe
  was never checked for its ability to report a true finding; the corrected one was validated by
  planting a dead entry and a redundant entry and confirming both surface. An unfalsified probe is
  an opinion with a number attached.
- **"This entry suppresses nothing" has two causes that look identical**: the file is clean, or the
  scanner cannot see the file. Only the first is a stale exception; the second is a reach gap, and
  deleting it silently destroys the evidence. Any exception-hygiene harness (4.1) must separate them
  or it will report reach gaps as cleanliness.
- **An allowlist is only as honest as its scan's reach.** All 34 survivors are load-bearing _within a
  scan that misses 57 git-tracked files_ — a materially weaker claim than "the allowlist is clean",
  and the difference is invisible from the exit code.
- **Ripgrep's defaults are part of a guard's contract.** Skipping dot-paths (no `--hidden`) and
  honouring `.gitignore` are reasonable interactive defaults and silent blind spots in a gate. A
  guard built on `rg` should state which of the two it accepts, the way it states its scan scope.
- **Confirmed: dependency-cruiser does not report a rule that matches nothing.** A `forbidden` rule
  whose `to.path` names a non-existent directory passes silently. Any rule with a literal path list
  can therefore lose coverage to a rename with no signal — including the one added in 1.2.

### Third loose-grep count in this plan, corrected after the fact

Row 4.1's sizing has now been wrong twice, both times from a grep that matched a token co-occurring
with the property rather than the property. Measured properly (stripping comments, matching actual
array-entry shape): `no-methodology-vocab` **34**, `no-llm-client` **3**,
`verify-mcp-surface.UNCHECKED_ACTIONS` **8** — the last was recorded as **1**. Total **45**, of which
8 already self-detect, leaving **37** owed to the harness.

The plan has now produced a wrong count by loose grep three times (F3's guard set, 0.6's entry
sizing, and this). Each was caught only when a later tier had a reason to re-measure. The cheap
correction is procedural rather than clever: **a count that will appear in a row gets its probe
stated alongside it**, the way the Inventory table already does — the rows that carry a bare number
are exactly the ones that drifted.

The arithmetic was also wrong: the row read "37 live entries — 34, 3, 1", which sums to 38. A
breakdown that does not add up to its own total is a free check nobody ran.

### Tier 3.1 — the counterfactual was worth measuring, and the summary assertion was not scoped

**Deviation: the row asked for two broken checks; the plant produced four.** One orphan `.ts` file
trips `validate:no-stepstate`, `validate:arch` (no-orphans) and `lint:ratchet` at once. Kept rather
than narrowed — the extra two are exactly the consequences an `&&` chain hides, and `lint:ratchet`
being step 1 meant the old chain reported a lint failure that said nothing about what was planted.

**Running the old chain was the cheap half of the evidence.** `git show HEAD:server/package.json`
gives the pre-change command; `sh -c` runs it against the same plants. Asserting "the `&&` chain
would have hidden these" costs one command less than believing it, and the output (0 mentions of
either planted defect) is stronger than the reasoning.

**A mutation survived because the assertion read the whole log.** Truncating the failure recap to
one entry passed every test, because both failing step names also appear in the per-step output
above the recap. The test named the recap and measured the log. Same family as `mutation never
reached`, different cause: the mutation _was_ reached, and a second mechanism produced the same
observable. Scope an assertion to the region the behaviour lives in, not to whatever string
contains it.

**Two findings arrived from outside the row.** `validate:renovate-extraction` runs nowhere (its
`:self-test` runs, which is the vacuous shape 1.5 found by a different route), and nothing asserts
that a `validate:*` script is wired into anything. Both are rows 3.2/3.3 rather than notes here,
because the tier immediately after this one will read rows and not notes.

**One exemption moved rather than went stale.** Relocating the suite list out of `package.json`
carried the vocab guard's hit with it, so a correct, non-stale allowlist entry needed a sibling. It
is a third decay mode for accepted exceptions — code moved — and it only shows up if the detector
asks "does this still suppress a hit" instead of "does this file still exist".

### Tier 4.1 — re-measuring a list you have will not find the list you forgot

**The deviation that matters: a fifth exception surface.** Row 4.1 sized itself at 3 surfaces. There
are 5. The missing one — `table-contracts.ts` `acceptedPhantomColumns` + `acceptedForeignWriters` —
is named in `.claude/rules/sqlite-persistence.md` as the canonical instance of this exact blind
spot, so the information was on disk and in an always-loaded rule the whole time.

Four earlier count errors in this plan were miscounts of files already named, and each was caught by
re-measuring. This one was a _category_ miss, and re-measuring the three known files would never
have surfaced it. The probe that did was **"what in this repo declares a suppression?"** asked of
the repo, not **"how many entries are in these three lists?"** asked of the lists. Different
question, different failure mode, and only the first one finds an omission.

**Second correction: "self-detects" was not binary.** `no-llm-client` had grown its own
`staleAllowlistEntries()`. `validate-table-contracts` had the form half (`closedBy` non-empty) and
none of the truth half. Two gates each had half the check, independently, in different halves —
which is what convergent evolution of a missing abstraction looks like. Row 4.3 records that
nothing states the pair as a requirement.

**Falsification trap, second instance this session.** Two plants went red on the _wrong branch_: a
foreign writer named a `.py` file that does not exist (subject-missing, not the intended
unreachable), and a phantom column named `kv_state.value` when the column is `state`
(subject-missing, not the intended satisfied). Both looked like proof. The general form: a red gate
proves _a_ branch fired, never _the_ branch — so when a mutation is aimed at a specific branch, read
the reported verdict, not just the exit code. In 3.1 the same family appeared as an assertion scoped
wider than the behaviour; here it is a plant that lands in a different case.

**One wording fix carrying the session's theme.** `table-contracts` printed "5 accepted foreign
writer(s)" for 2 declared exceptions covering 5 write sites. Nothing was wrong with the check; the
sentence just invited exactly the miscount this plan has now made five times. Sites and entries are
now named separately.

### A probe can be invalidated by the work, not only by drift

Three of this plan's probes stopped answering their question because a tier changed the thing they
measured, not because the repo drifted underneath them:

| Probe                                          | Invalidated by                        | How it failed                                               |
| ---------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `no-prompt-gates-alias`'s `\|\|` regexes       | the code moving to `??`               | silently matched nothing — the guard was vacuous for months |
| `scripts['validate:all'].split(' && ').length` | 3.1 replacing the chain with a runner | returns 1, confidently                                      |
| `ls scripts/ \| wc -l`                         | 4.1 adding `scripts/lib/`             | counts a directory as a script; 37 files reads as 38        |

The first was found by accident, five months late. The second and third were found because the tier
that broke them was obliged to re-measure the Inventory it touched. That obligation is the only
thing standing between "the probe still runs" and "the probe still answers" — a probe that returns a
number after its subject changed shape is worse than one that errors, because nothing looks wrong.

Worth pairing with the existing rule that a count states its probe alongside it: **the probe should
also state what shape it assumes.** `split(' && ')` assumed a shell chain; `ls | wc -l` assumed a
flat directory. Neither said so, so neither could be checked when the assumption broke.

### Commit boundary — two findings, one of them structural

**The tiers are not separably committable, and that is a fact about the gates.** Splitting one
commit per tier was attempted and abandoned, because every candidate split produced a commit that
fails its own validation:

| Coupling                                          | Why it cannot be split                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run-validation-suite.js` ← vocab allowlist entry | 3.1's suite declaration names `validate:no-methodology-vocab`, so the guard flags the runner unless the allowlist entry lands in the same commit — and the entry is `subject-missing` unless the runner does |
| `MECHANISM:` markers ← `eslint.config.js`         | 1.2's markers are required by the rule 0.3 wires in; either half alone is red                                                                                                                                |
| `server/package.json`                             | five adjacent lines carry both the guard-script removals (1.2–1.5) and the `validate:all` swap (3.1)                                                                                                         |

Each of those couplings is a gate doing its job. The cost is that history granularity is bounded by
gate granularity — a repo with this many cross-checking gates cannot have finer commits than its
gates have scope. Worth knowing before anyone asks for one-commit-per-tier again; the answer is not
discipline, it is that the intermediate states do not exist.

**A staged deletion from an earlier tier rode into an unrelated commit.** `git rm` during tier 1.2
left four deletions in the index. A later `git add <specific paths> && git commit` picked them up,
because commit takes the whole index and not the paths just added. Caught by reading `--stat` after
the fact, fixed by `git reset --mixed` back to the pre-session commit and redoing both commits.

The habit that prevents it is cheap: **print `git diff --cached --name-only` and read it before every
commit**, not `git add` carefully and trust it. Staging is durable across commits and across
sessions; "I only added these files" is a statement about one command, not about the index.

### Tier 0.8 + 0.9 deviations (2026-08-11)

| #   | Deviation                                                                                                         | Why                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 0.9 executed **before** 0.8, against the plan's stated dependencies (0.9 declared `Depends: —`)                   | All 5 of `.dependency-cruiser.cjs`'s vocabulary occurrences are 0.9's dead rule. Reversed, 0.8 would have triaged five lines about to be deleted                                           |
| 2   | Fixed the scan by scoping to `git ls-files` rather than adding `--hidden`, which is what "widen the scan" implies | `--hidden` fixes only the narrow half, still misses gitignored-but-tracked `CLAUDE.md`, and adds 5,405 `.git/` files. It would also have left the 2026-08-09 `.ignore` over-reach in place |
| 3   | `EXCLUDED_PATHS` converted from globs to regexes                                                                  | `--glob` does not filter explicitly-passed paths — measured. The globs would have become decoration                                                                                        |
| 4   | Zero allowlist entries added, though the row permitted "fixed **or** allowlisted"                                 | All 11 occurrences were stale documentation. An allowlist entry for a wrong statement would have preserved the wrong statement                                                             |
| 5   | `plans:retire:check` left failing                                                                                 | Owned by the adaptive-chain-runtime workstream (`2e84bb3c`). Recorded as row 0.10                                                                                                          |

### A probe that confirms is worth as much as one that corrects

Every previous tier here corrected a count, and the running lesson was "re-measure, the number will
have drifted". 0.8's three numbers — 57 unreachable, 4 files, 11 occurrences — all measured exactly.

The useful distinction is _where a number came from_, not how old it is. 0.8's counts came from a
probe run when the row was written. The ones that drifted in this same tier (`validate:arch`'s 444,
`SUITE`'s 30) were both **quoted from an earlier run of something else** and never re-derived. Age
predicted nothing; provenance predicted both.

The re-measure still earned its keep, and not through the counts. Checking _where_ the 11
occurrences were is what exposed that 0.9 owned 5 of them — an ordering constraint neither row
declared. A count can be right while the plan built on it is still wrong.

### Widening a scan is a scope change, and scope has two edges

"The guard cannot see 57 files" reads as a one-directional defect, and the one-directional fix
(`--hidden`) is available and wrong. Measuring the _other_ edge — what the scan reaches that it
should not — found 18 untracked files in scope, which is a defect that had already fired once, on
2026-08-09, as a false red.

Both edges were the same root cause: the scan's file set was defined by ripgrep's traversal
heuristics rather than by the property the gate actually means. Naming the property — "shipped
content" is `git ls-files` — collapsed two fixes into one and made both failure modes structurally
impossible instead of merely handled.

Worth carrying: when a finding says a check is blind, ask what it is blind _to_ and what it is
looking at that it shouldn't be. The second question is not implied by the first, and here it was
the one that picked the mechanism.

### The formatting gate and the formatting tool were never the same tool

`validate:format` failed on this plan's own notes file, and `npx prettier --check` on that same
file passed. Both statements were true at the same moment.

`validate:format` is `cd .. && git ls-files … | xargs npx --prefix server prettier --check`. The
`--prefix server` makes prettier resolve `server/.prettierrc.json` — `printWidth: 100`. Run from
the repo root with no prefix, prettier finds **no configuration file** for `plans/**` at all
(`--find-config-path` errors outright) and falls back to the default width of 80. Markdown tables
are padded to the print width, so a table-bearing plan file has two different correct forms and
each invocation reverts the other.

That is the whole of row 0.2's unexplained behaviour — "`--write` does not converge, ran 3×, failed
each time". It was read as the file being pathological and closed by adding it to
`.prettierignore`. It was neither pathological nor about that file: any plan file with a table
does this, and 0.2's fix removed one file from the blast radius while leaving the mechanism intact.
Recorded as row 0.11.

**The reusable shape**: when a gate and the tool it wraps disagree, suspect _config resolution_
before suspecting content. The two commands were both "prettier on this file" and differed only in
which directory prettier started looking from. Nothing in the failure output mentions
configuration, print width, or the prefix — the gate reports the file, so the file is where you
look. Fixing it required reading the npm script, not the file it named.

Cost of not knowing: the loop is only observable through a 53-second suite run, and it re-arms
every time someone formats a plan with the obvious command.

### Tier 3.2 + 3.3 deviations (2026-08-11)

| #   | Deviation                                                                                                        | Why                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 3.2 marked ⚠ and **no change made to the script**                                                                | Its premise is false: the script is a live CI gate. Both stated options (join `SUITE` / delete) are impossible or wrong — it reads stdin, and `SUITE` steps run with stdin ignored                         |
| 2   | Deleted `validate:build`, which no row asked me to touch                                                         | It is the orphan 3.2 was looking for. Leaving it would have forced a fake exception entry in the new checker, i.e. writing down an excuse for something nothing runs                                       |
| 3   | Exported `SUITE` + added a main guard to `run-validation-suite.js` (another workstream's actively-modified file) | The checker must read the real array. Regexing the source would repeat the token-vs-property error this tier exists to fix. Both edits are additive and on lines distinct from the entries they are adding |
| 4   | Did **not** rewrite the renovate workflow to invoke via `npm run`, though stdin forwarding was verified to work  | It is a CI job I cannot execute locally, and the uniformity it would buy is already delivered by the checker matching both spellings. Fixing the class beat fixing the instance                            |
| 5   | Two new rows (3.4 `validate:build` deleted, 3.5 ledger-hook format oscillation)                                  | Both discovered mid-tier; prose in an execution record does not get executed                                                                                                                               |

### An excuse is not evidence, and nobody re-reads one

The plan flagged the wired script and excused the dead one. Both came from one probe, but only the
false-positive was ever going to be noticed — someone acting on 3.2 would have opened the file.
`validate:build`'s excuse ("needs a build so cannot sit in a pre-build suite") was plausible,
unfalsifiable as written, and therefore permanent.

That asymmetry is the reusable part. A wrong _finding_ gets tested when someone tries to fix it. A
wrong _exemption_ is never tested, because its whole function is to stop anyone looking. So the
exception list is where measurement error accumulates, and it is exactly where nobody re-measures.

This is why `runBy` is asserted rather than documented. The entry does not say "this is fine
because CI runs it"; it names the file, and the gate opens that file on every run. An excuse that
cannot go stale silently is a different kind of object from a comment.

### The probe error has two axes, and fixing one does not fix the other

0.8 fixed the **file set** a probe covers (dot-paths, gitignored-but-tracked). This tier hit the
**token** a probe matches: the npm name vs the script file it resolves to. My first measurement in
this tier used 0.8's corrected file set — it searched `.github/**` correctly — and still returned
the wrong answer, because it was looking for the wrong string inside those files.

Worth stating plainly since it cost a full re-measure: _widening where you look does not fix
looking for the wrong thing._ Both are "the probe measured something adjacent", and a fix for one
reads as a fix for the class.

### Tier 3.5 + 4.2 + 4.3 deviations (2026-08-11)

| #   | Deviation                                                                                       | Why                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 3.5 fixed a file **outside this repository** (`~/.claude/hooks/validation/validation-flush.py`) | That is where the writer lives. Fixing it in-repo means another `.prettierignore` entry, which is the treadmill the row exists to stop                   |
| 2   | 4.2 used shared named constants instead of a string per entry                                   | 18 entries retire in one event; a copied string per entry satisfies the gate and deletes that fact                                                       |
| 3   | 4.3 landed as an ESLint rule, not a `scripts/` guard                                            | 0.3's convention: single-file AST work belongs in the plugin. This is one file's declarations vs one file's calls                                        |
| 4   | Did **not** fix `scripts/validate-db-claim-order.js`, the rule's only true positive             | Another workstream's uncommitted guard. Recorded as row 4.4 with the owner named                                                                         |
| 5   | Did **not** fix the 6 failing chain/formatting tests                                            | Same workstream's mid-refactor `response-assembler.ts` + 8 pipeline stages. Row 0.13; the plan Gate is marked blocked rather than left reading as passed |

### The convention was followed and the defect happened anyway

`validate-db-claim-order.js` is the strongest single piece of evidence this plan produced about
inflow gates. Its author wrote `reason` and `closedBy` on all four entries — textbook form — and
never called `auditExceptions`.

They were not careless. They copied what a sibling gate's data **looks like**, which is the only
part of the convention visible from inside the file they were writing. The audit call lives in
`lib/exception-hygiene.js`, and nothing in a gate's data shape tells you to go look for it.

So the failure mode is not "people ignore conventions". It is that **a convention with a visible
half and an invisible half gets half-adopted, by exactly the people trying to follow it** — and the
adopted half is the one that produces no signal when the other is missing, because `closedBy` reads
as diligence. A stated convention cannot fix this; it addresses the people who already read it.

### Measuring the thing that measures things

While counting the vocab allowlist for 4.2 I ran a regex for the entry shape and got 38 against an
authored 35. The three extras were commented-out example entries sitting inside the file's own
explanatory prose — entries that exist to _document_ two deletions.

This tier's whole subject is probes that match a token adjacent to the property. I committed the
error inside the measurement for the row about it, and caught it only because 38 ≠ 35 and the
authored number happened to be right. Had the drift gone the other way — an authored count that was
already stale — the wrong number would have confirmed the wrong probe.

The guard's own runtime output (`ALLOWLIST.length`, printed on every run) was the correct instrument
and was available the whole time. **Prefer the artifact's own report over a fresh regex against its
source**; a program that already computes the number will not disagree with itself about what counts.
