---
title: "Validation Harness Consolidation — Implementation Notes"
plan: validation-harness-consolidation-2026-08-11.md
date: 2026-08-11
status: reference
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Deviations

## Unknowns / gaps found during execution

## Validation runs

- 2026-08-12 00:02 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - <<'PYEOF' import re p='plans/technical-debt/validation-me` · ran
- 2026-08-12 00:02 · `python3 - <<'PYEOF' import re p='plans/reference/technical-debt/validation-mechanism-architecture-2026-08-05.md' s=open(p).read() ` · ran
- 2026-08-12 00:01 · `cd server && echo "0.14 — vocab guard clean + green?"; git status --short scripts/validate-no-methodology-vocab.js | rg ` · ran
- 2026-08-11 23:58 · `git diff -- server/eslint.config.js | rg "^[+-]" | rg -v "^(\+\+\+|---)" | head -30; echo "..."; echo "total +/- lines: ` · ran
- 2026-08-11 23:58 · `npm run -s validate:format 2>&1 | rg warn; echo "--- ownership of each ---"; cd /home/minipuft/Applications/claude-promp` · ran
- 2026-08-11 23:58 · `python3 - <<'PYEOF' p='../plans/reference/technical-debt/validation-harness-consolidation-2026-08-11.md' s=open(p).read() s=s.repl` · ran
- 2026-08-11 23:56 · `cd /home/minipuft/Applications/claude-prompts-mcp && python3 - <<'PYEOF' p='plans/technical-debt/validation-harness-cons` · ran
- 2026-08-11 23:56 · `npx prettier --write .dependency-cruiser.cjs >/dev/null 2>&1 && npx prettier --check .dependency-cruiser.cjs 2>&1|tail -` · ran
- 2026-08-11 23:54 · `npm run -s validate:format 2>&1 | rg warn; echo "--- my touched files formatted? ---"; npx prettier --check .dependency-` · ran
- 2026-08-11 23:54 · `npm run validate:all 2>&1 | rg "FAIL|steps passed|steps failed|suite-membership" | tail -6` · ran
- 2026-08-11 23:53 · `rm -f src/engine/execution/zz4-intra.ts; printf "export { GateSetResolver } from '../gates/services/gate-set-resolver.js` · ran
- 2026-08-11 23:52 · `echo "=== clean tree: rule must be silent ===" && npm run -s validate:arch 2>&1 | tail -2; echo; echo "=== plant all 4 s` · ran
- 2026-08-11 23:52 · `cd server && echo "=== eslint.config.js ===" && rg -n -B2 -A6 "crosslayer" eslint.config.js | head -30; echo; echo "=== ` · ran
- 2026-08-11 23:51 · `rm -f src/mcp/tools/zz-dc-probe.ts src/engine/gates/zz-dc-probe2.ts src/mcp/a/b/c/zz-deep.ts src/engine/gates/zz-dyn.ts ` · ran
- 2026-08-11 23:51 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1c58885c-fbcb-4ee5-aa5b-08018b9f314a/scratchpad; mkdi` · ran
- 2026-08-11 23:51 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1c58885c-fbcb-4ee5-aa5b-08018b9f314a/scratchpad; sed ` · ran
- 2026-08-11 23:50 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1c58885c-fbcb-4ee5-aa5b-08018b9f314a/scratchpad; npx ` · ran
- 2026-08-11 23:50 · `SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1c58885c-fbcb-4ee5-aa5b-08018b9f314a/scratchpad; cat ` · ran
- 2026-08-11 23:50 · `pwd; SP=/tmp/claude-1000/-home-minipuft-Applications-claude-prompts-mcp/1c58885c-fbcb-4ee5-aa5b-08018b9f314a/scratchpad;` · ran
- 2026-08-11 23:50 · `cd server && cat > /tmp/dc-probe.cjs <<'EOF' module.exports = { forbidden: [{ name: 'no-crosslayer-relative-probe', seve` · ran
- 2026-08-11 23:48 · `npx prettier --write ../CLAUDE.md >/dev/null 2>&1 && npx prettier --check ../CLAUDE.md 2>&1 | tail -1; echo "=== suite, ` · ran
- 2026-08-11 23:47 · `cd /home/minipuft/Applications/claude-prompts-mcp && echo "=== are the 2 unformatted files mine? ===" && git status --sh` · ran
- 2026-08-11 23:46 · `cd server && npm run validate:all 2>&1 | rg "FAIL|steps passed|steps failed" | tail -4` · ran
