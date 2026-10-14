---
title: Workflow client planning path evidence
date: 2026-10-12
status: active
tags: [workflows, evidence]
---

# Planning path verification (2026-10-12)

### File: server/src/modules/chains/manager.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
-rw-r--r-- 1 minipuft minipuft 135781 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
3370 /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
$ rg -n collectActiveSessionRows /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
763:    const activeRows = this.collectActiveSessionRows();
792:  private collectActiveSessionRows(): Array<{
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/modules/chains/manager.ts
// @lifecycle canonical - Manages chain session persistence and lifecycle promotion.
/**
 * Chain Session Store
 *
 * Manages chain execution sessions, providing the bridge between MCP session IDs
 * and the persisted chain state/step capture utilities. This enables stateful
 * chain execution across multiple MCP tool calls.
 *
 * CRITICAL: Uses SQLite-backed persistence to survive STDIO transport's ephemeral processes.
 * Sessions are saved to disk after every change and loaded on initialization.
```

### File: server/src/infra/database/sqlite-engine.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
-rw-r--r-- 1 minipuft minipuft 85534 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
1639 /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
$ rg -n current_step_review /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
61: * and its `v_execution_status` column `current_step_review` (P6.20, R193; the old names are in
1408:        json_extract(cs.state, '$.currentStepReview') AS current_step_review,
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/infra/database/sqlite-engine.ts
// @lifecycle canonical - Manages SQLite database lifecycle via node:sqlite (native)
/**
 * SQLite Engine
 *
 * Singleton that manages the native Node.js SQLite database lifecycle.
 * Uses node:sqlite (DatabaseSync) for file-backed storage with no WASM dependency.
 *
 * Key Features:
 * - File-backed natively (no manual persist() needed)
 * - WAL mode for concurrent reader access (Python hooks)
```

### File: server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
-rw-r--r-- 1 minipuft minipuft 18075 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
454 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
$ rg -n FrozenReviewProjection /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
190:export interface FrozenReviewProjection {
199:export function assertFrozenReviewAvailable(protocol: FrozenReviewProjection): void {
282:export function projectFrozenReview(review: PendingGateReview): FrozenReviewProjection {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/semantic-review-context.ts
// @lifecycle canonical - Frozen public review definitions and capture-bound semantic authority.
import { resolveFrozenReviewDefinition } from './frozen-review-definitions.js';
import { resolveReviewTarget } from './review-target.js';
import { selectToolReviewGateIds } from './structural-review-composition.js';
import { SemanticCriterionSchema } from '../../../../gates/core/gate-schema.js';
import { resolveJudgeConfig } from '../../../../gates/judge/judge-prompt-builder.js';
import { resolveDetachedReport } from '../../../delegation/detached.js';
import {
  classifyHandoffBody,
  handoffNodeToken,
```

### File: server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
-rw-r--r-- 1 minipuft minipuft 17575 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
394 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
$ rg -n semanticReviewAction /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
186:export function semanticReviewAction(protocol: FrozenReviewProjection): string | undefined {
202:  const action = semanticReviewAction(protocol);
228:  const action = semanticReviewAction(protocol);
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/pipeline/decisions/gates/describe-review-for-render.ts
// @lifecycle canonical - What a gate review's render reads off the review record.
/**
 * Review render facts (primitive rework row 3.5).
 *
 * A gate review re-renders the step it grades, and that render reads the review in two places:
 * which step it grades and which gates it names (before the body), and what the attempts so far
 * left behind — retry hints, the last recorded reasoning, the retry budget (after it). Both reads
 * are decided here, from the record `ChainSession.reviews[nodeId]` holds, so the executor that
 * renders the template owns no review semantics of its own.
 *
```

### File: server/src/engine/execution/formatting/response-assembler.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
-rw-r--r-- 1 minipuft minipuft 75715 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
1619 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
$ rg -n buildChainFooter /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
170:    const footer = this.buildChainFooter(context);
460:  buildChainFooter(context: ExecutionContext): string {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/execution/formatting/response-assembler.ts
// @lifecycle canonical - Assembles response content for pipeline formatting stage.
import { declaresFrameworkSections } from '../../frameworks/declared-sections.js';
import { JUDGE_OUTPUT_PLACEHOLDER } from '../../gates/core/review-utils.js';
import { liveNodeIds } from '../../gates/services/run-step-view.js';
import { SHELL_VERIFY_DEFAULT_MAX_ITERATIONS } from '../../gates/shell/types.js';
import { handoffNodeToken } from '../delegation/handoff-contract.js';
import { DelegationRenderer } from '../delegation/renderer.js';
import { getHandoffFooterInstruction } from '../delegation/strategy.js';
import { rerunCommandText } from '../parsers/command-parser.js';
import { formatShellVerifyToken } from '../parsers/symbolic-operator-parser.js';
```

### File: server/src/engine/gates/services/gate-verdict-processor.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
-rw-r--r-- 1 minipuft minipuft 56617 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
1346 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
$ rg -n handleGateAction /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
378:   * Separate entry point from {@link handleGateAction}, not a fifth case inside it: that method
482:  async handleGateAction(
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/src/engine/gates/services/gate-verdict-processor.ts
// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import {
  describeRefusal,
  describeMissingReview,
  describeGatelessStep,
  describeInBudgetAction,
  describeUnansweredStep,
} from './gate-review-refusal.js';
import {
  failedReviewGateIds,
```

### File: hooks/gate-enforce.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
-rwxr-xr-x 1 minipuft minipuft 7396 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
177 /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
$ rg -n def main /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
64:def main():
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/gate-enforce.py
#!/usr/bin/env python3
"""
PreToolUse hook: Enforce gate verdicts on prompt_engine calls.

Blocks:
1. GATE_REVIEW: FAIL without retry attempt
2. Chain resumes carrying NO pending-run resolution parameter while the run is HOLDING.
   Two holds reach this check: an ordinary gate review, and the reserved
   `__unknown_interrupt__` synthetic review a blocking unknown raises under
   `budget.pauseOnBlocking`. They are denied with different prose because they accept
```

### File: hooks/post-prompt-engine.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
-rwxr-xr-x 1 minipuft minipuft 5905 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
147 /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
$ rg -n def main /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
37:def main():
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/post-prompt-engine.py
#!/usr/bin/env python3
"""
PostToolUse hook: Track chain/gate state from prompt_engine responses.

Triggers after: mcp__claude-prompts__prompt_engine

Parses the response to:
1. Track current chain step
2. Detect pending gates
3. Inject reminders for gate reviews
```

### File: hooks/lib/session_state.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
-rw-r--r-- 1 minipuft minipuft 14795 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
350 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
$ rg -n format_chain_reminder /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
293:def format_chain_reminder(state: ChainState, mode: str = "full") -> str:
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/session_state.py
"""
Session state manager for Claude Code hooks.
Tracks chain/gate state per conversation session via SQLite (hooks-state.db).
"""

import json
import os
import re
from typing import Any, TypedDict, cast
```

### File: hooks/lib/db_reader.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
-rw-r--r-- 1 minipuft minipuft 17752 Oct  5 06:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
495 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
$ rg -n _view_row_to_hook_state /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
329:        hook_state = _view_row_to_hook_state(row)
336:def _view_row_to_hook_state(row: sqlite3.Row) -> dict | None:
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/db_reader.py
"""
SQLite reader for Claude Code hooks.
Queries resource_index table from state.db as a read-only data source.

Replaces JSON cache file reads for prompts and gates.
Uses stdlib sqlite3 — no external dependencies.
"""

import json
import os
```

### File: hooks/prompt-suggest.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
-rwxr-xr-x 1 minipuft minipuft 32145 Sep 20 11:32 /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
835 /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
$ rg -n format_chain_reminder /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
40:from session_state import ChainState, format_chain_reminder
795:            system_msg = format_chain_reminder(session_state, mode="inline")
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/prompt-suggest.py
#!/usr/bin/env python3
"""
UserPromptSubmit hook: Directive injection for claude-prompts.

Detects >>syntax and operators, outputs:
- systemMessage: Compact user confirmation
- additionalContext: Structured directive for Claude

Architecture:
- Layer 1: MCP-native prompts (via registerPrompt) - standard protocol
```

### File: hooks/compact-recovery.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
-rwxr-xr-x 1 minipuft minipuft 3251 Aug 21 04:58 /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
100 /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
$ rg -n format_chain_reminder /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
24:from session_state import ChainState, format_chain_reminder
62:    reminder = format_chain_reminder(state, mode="full")
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/compact-recovery.py
#!/usr/bin/env python3
"""
SessionStart("compact") hook: Re-inject active chain state after compaction.

Triggers after: Context compaction (manual /compact or auto-compaction).

Reads chain state from server's SQLite state.db (SSOT) and outputs a
continuation directive to stdout. Claude Code adds stdout to the
post-compaction context, bridging the gap between compaction and the
next UserPromptSubmit (where prompt-suggest.py would also catch it).
```

### File: hooks/ralph-stop.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
-rwxr-xr-x 1 minipuft minipuft 24212 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
636 /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
$ rg -n chain_block_reason /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
357:def chain_block_reason(chain_state: dict) -> str:
412:            print(json.dumps({"decision": "block", "reason": chain_block_reason(chain_state)}))
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/ralph-stop.py
#!/usr/bin/env python3
"""
Stop hook: Shell verification for Ralph Wiggum-style autonomous loops.

When Claude tries to stop, this hook:
1. Reads runtime-state/verify-state.db (written by MCP server via SQLite)
2. Runs the verification command
3. If PASS (exit 0): Allows Claude to stop
4. If FAIL (exit != 0): Blocks stop, feeds error back to Claude
```

### File: hooks/hooks.json

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
-rw-r--r-- 1 minipuft minipuft 2588 Aug 23 18:33 /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
91 /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
$ rg -n gate-enforce /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
10:            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\"",
11:            "name": "gate-enforce",
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/hooks.json
{
  "description": "Claude Prompts plugin hooks - syntax detection, chain tracking, gate reminders",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*prompt_engine",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\"",
```

### File: hooks/lib/_generated/resolution_verbs.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
-rw-r--r-- 1 minipuft minipuft 299 Sep  1 05:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
12 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
$ rg -n PENDING_RUN_RESOLUTION_PARAMS /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
6:PENDING_RUN_RESOLUTION_PARAMS: frozenset[str] = frozenset(
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/lib/_generated/resolution_verbs.py
"""Pending-run resolution verbs. Generated from tooling/contracts/prompt-engine.json.

Regenerate with `npm run generate:contracts` (server/). Do not edit.
"""

PENDING_RUN_RESOLUTION_PARAMS: frozenset[str] = frozenset(
    {
        "cancel",
        "gate_action",
        "gate_verdict",
```

### File: hooks/tests/test_gate_enforce_verdict.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
-rw-r--r-- 1 minipuft minipuft 6450 Sep  1 05:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
165 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
$ rg -n gate_verdict /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
4:gate_verdict reaches the hook in two schema shapes: the structured object
54:                "gate_verdict": {
71:                "gate_verdict": {"overall": "PASS", "rationale": "all met"},
81:    The hook's previous hardcoded model (chain_id without gate_verdict -> deny) blocked
114:        assert "gate_verdict" in reason
149:                "gate_verdict": "GATE_REVIEW: FAIL - not good enough",
161:                "gate_verdict": "GATE_REVIEW: PASS - solid",
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_gate_enforce_verdict.py
"""
Tests for hooks/gate-enforce.py verdict-shape handling.

gate_verdict reaches the hook in two schema shapes: the structured object
{overall, rationale, per_gate[]} (preferred) and the legacy
"GATE_REVIEW: FAIL - reason" string. The structured shape crashed the hook
with TypeError until 2026-08-03 (surfaced by the codex-prompts E2E port);
because hook failures are fail-open, that meant object verdicts were never
gate-enforced.
"""
```

### File: hooks/tests/test_post_prompt_engine_clearing.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
-rw-r--r-- 1 minipuft minipuft 5405 Aug 21 06:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
139 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
$ rg -n pending_gate /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
5:a resolved gate ("Execution complete.", no markers) left its pending_gate row
81:        Previously the pending_gate row survived until the 24h sweep."""
127:        assert row.get("pending_gate")
129:    def test_completion_with_a_pending_gate_is_kept(self, workspace):
139:        assert row.get("pending_gate")
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_post_prompt_engine_clearing.py
"""
Tests for hooks/post-prompt-engine.py session-row lifecycle.

Rows were written on every parse and cleared by nothing but the 24h sweep, so
a resolved gate ("Execution complete.", no markers) left its pending_gate row
behind and recovery hooks re-injected long-resolved state after compaction.
These pin the clearing boundaries:

  - verdict/cancel submission + marker-less response  → row cleared
  - explicit completion marker + nothing pending      → row cleared
```

### File: hooks/tests/test_db_reader.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
-rw-r--r-- 1 minipuft minipuft 52662 Oct  5 06:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
1205 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
211:    def test_extracted_ddl_declares_every_object_db_reader_queries(self, state_db):
216:    def test_extracted_schema_version_matches_the_seeded_row(self, state_db):
221:    def test_run_status_is_not_null_because_the_reader_has_no_null_branch(self, state_db):
240:    def test_load_prompts_projects_metadata_json_into_chain_fields(self, state_db):
269:    def test_load_prompts_tolerates_malformed_metadata_json(self, state_db):
277:    def test_load_prompts_meta_carries_styles_and_frameworks(self, state_db):
287:    def test_frameworks_read_the_resource_type_the_indexer_writes(self, state_db):
298:    def test_get_prompt_by_id_is_case_insensitive(self, state_db):
305:    def test_load_gates_projects_type_and_triggers(self, state_db):
320:    def test_every_reader_fails_open_when_the_database_is_absent(self, no_state_db):
333:    def test_returns_state_for_a_live_owner(self, state_db):
343:    def test_rows_owned_by_a_dead_process_are_skipped(self, state_db):
349:    def test_a_claimed_run_serves_the_claimer_row_over_the_dead_first_owner(self, state_db, path):
374:    def test_two_scopes_runs_of_one_chain_id_in_one_process_serve_the_newest(self, state_db, path):
405:    def test_a_non_numeric_owner_is_skipped(self, state_db):
416:    def test_a_chain_standing_on_its_last_step_is_active(self, state_db):
429:    def test_a_final_step_awaiting_a_gate_verdict_is_still_active(self, state_db):
446:    def test_a_final_step_awaiting_shell_verification_is_still_active(self, state_db):
462:    def test_session_table_serves_when_the_view_is_unavailable(self, state_db):
478:    def test_no_state_when_the_view_and_session_table_both_yield_nothing(self, state_db):
520:    def test_a_held_run_past_its_last_node_is_kept_on_both_paths(self, state_db, pending):
532:    def test_an_in_progress_row_is_unchanged(self, state_db):
540:    def test_a_terminal_row_past_its_last_node_is_dropped(self):
555:    def test_the_view_projects_the_steps_its_writer_wrote(self, state_db):
562:    def test_the_primary_path_serves_without_falling_back(self, state_db):
574:    def test_terminal_runs_are_excluded_on_every_path(self, state_db, terminal):
657:    def test_the_view_path_names_only_its_eight_columns_and_the_sort_key(self, state_db, monkeypatch):
664:    def test_the_session_table_path_names_only_its_three_columns_and_the_sort_key(self, state_db, monkeypatch):
673:    def test_control_renaming_a_column_the_loader_reads_fails_the_pin(self, state_db, monkeypatch):
707:    def test_a_renamed_view_column_still_returns_the_state_from_the_session_row(self, state_db):
727:    def test_control_an_intact_view_serves_the_row_the_session_table_would_refuse(self, state_db):
738:    def test_view_and_session_table_both_unreadable_returns_none_without_raising(self, state_db):
775:    def test_a_renamed_view_column_still_returns_the_state_from_the_session_row(self, state_db):
796:    def test_control_an_intact_view_serves_the_row_the_session_table_would_refuse(self, state_db):
808:    def test_view_and_session_table_both_unreadable_returns_none_without_raising(self, state_db):
856:    def test_the_active_loader_returns_the_same_dict(self, state_db, read_path):
862:    def test_the_recoverable_loader_returns_the_same_dict(self, state_db, read_path):
889:    def test_the_unscoped_scan_is_dead(self, state_db):
896:    def test_a_foreign_chain_id_is_not_served(self, state_db):
901:    def test_a_session_with_no_recorded_chain_recovers_nothing(self, state_db):
910:    def test_the_sessions_own_chain_is_recovered_fresh(self, state_db):
922:    def test_a_terminal_chain_is_not_resurrected_from_the_snapshot(self, state_db):
935:    def test_a_live_run_with_no_projected_row_recovers_nothing(self, state_db):
950:    def test_control_the_same_chain_projected_is_recovered(self, state_db):
968:    def test_a_dead_owner_expires_the_chain(self, state_db):
976:    def test_without_a_server_db_the_session_snapshot_serves(self, no_state_db):
995:    def test_the_servers_actual_layout_is_preferred(self, tmp_path, monkeypatch):
1018:    def test_the_legacy_server_layout_still_serves(self, tmp_path, monkeypatch):
1038:    def test_mcp_runtime_root_outranks_the_workspace(self, tmp_path, monkeypatch):
1078:    def test_the_plugin_data_state_db_outranks_the_install_directory(self, tmp_path, monkeypatch):
1091:    def test_unset_or_blank_plugin_data_adds_no_candidate(self, tmp_path, monkeypatch, value):
1105:    def test_mcp_runtime_root_outranks_plugin_data(self, tmp_path, monkeypatch):
1151:    def test_plugin_shape_reads_the_data_directory_not_the_install(self, tmp_path, monkeypatch):
1161:    def test_mcp_runtime_root_is_where_the_server_wrote_it(self, tmp_path, monkeypatch):
1172:    def test_a_row_the_server_wrote_is_the_row_the_hook_loads(self, tmp_path, monkeypatch):
1195:    def test_without_a_server_state_db_the_hook_owned_directory_is_used(self, tmp_path, monkeypatch):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_db_reader.py
"""
Tests for hooks/lib/db_reader.py — the Python half of a cross-language contract.

WHY THIS FILE EXISTS
--------------------
`db_reader.py` reads `state.db`, whose schema is declared in TypeScript
(`server/src/infra/database/sqlite-engine.ts`). Nothing in the TypeScript build can observe these
reads, so a column rename lands green on the server side and silently degrades the hooks: every
query in `db_reader.py` catches `sqlite3.OperationalError` and returns `None`, which fail-open
callers read as "database unavailable" rather than "schema drifted". That failure has already
```

### File: hooks/tests/test_session_tracker.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
-rw-r--r-- 1 minipuft minipuft 7761 Mar 12  2026 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
201 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
21:    def test_creates_session_directory(self, patch_workspace):
28:    def test_initial_state(self, patch_workspace):
37:    def test_set_goal(self, patch_workspace):
50:    def test_record_iteration(self, patch_workspace):
65:    def test_record_multiple_iterations(self, patch_workspace):
75:    def test_record_file_change(self, patch_workspace):
87:    def test_generate_story_no_iterations(self, patch_workspace):
94:    def test_generate_story_with_iterations(self, patch_workspace):
108:    def test_generate_diff_summary_empty(self, patch_workspace):
115:    def test_generate_diff_summary_with_changes(self, patch_workspace):
127:    def test_get_iteration_count(self, patch_workspace):
137:    def test_clear_session(self, patch_workspace):
151:    def test_state_persistence_across_instances(self, patch_workspace):
164:    def test_generate_task_context(self, patch_workspace):
183:    def test_factory_function(self, patch_workspace):
192:    def test_clears_session(self, patch_workspace):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_session_tracker.py
"""
Tests for hooks/lib/session_tracker.py

Covers:
- SessionTracker creation and state initialization
- Iteration recording
- File change tracking
- Story generation
- Diff summary
- Session clearing and persistence
```

### File: hooks/tests/test_ralph_stop.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
-rw-r--r-- 1 minipuft minipuft 13891 Sep 25 01:08 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
375 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
$ rg -n chain_block_reason /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_ralph_stop.py
"""
Tests for hooks/ralph-stop.py core functions.

Covers:
- run_verification (pass/fail/timeout)
- format_error_feedback
- load_context_isolation_config (defaults/custom)
- ensure_ralph_session_id
- stop_hook_active guard
- Max iterations reached
```

### File: hooks/tests/test_unknown_interrupt_hold.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
-rw-r--r-- 1 minipuft minipuft 11068 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
254 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
119:    def test_gate_action_verbs_are_allowed(self, monkeypatch, capsys, action):
124:    def test_accept_alternative_with_remainder_is_allowed(self, monkeypatch, capsys):
137:    def test_cancel_true_is_allowed(self, monkeypatch, capsys):
142:    def test_mutation_probe_a_hook_without_gate_action_denies_resume(self, monkeypatch, capsys):
156:    def test_bare_chain_id_resume_is_denied_and_names_the_verbs(self, monkeypatch, capsys):
172:    def test_denial_falls_back_to_contract_parameters_when_no_verbs_were_captured(self, monkeypatch, capsys):
187:    def test_an_ordinary_gate_review_still_gets_the_verdict_message(self, monkeypatch, capsys):
201:    def test_label_gate_ids_renders_the_synthetic_id_as_words(self):
207:    def test_db_reader_uses_the_same_label(self):
224:    def test_paused_response_sets_the_hold_and_captures_the_servers_verbs(self):
237:    def test_the_soft_variant_is_not_a_hold(self):
243:    def test_reminder_offers_the_interrupt_verbs_not_a_verdict(self):
251:    def test_interrupt_exits_prefer_the_servers_own_list(self):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_unknown_interrupt_hold.py
"""
Hook awareness of the blocking-unknown interrupt (plan row 3.1,
plans/features/mid-chain-unknown-surfacing-2026-08-20.md).

A hard-paused run holds on the reserved synthetic review `__unknown_interrupt__` instead of on a
gate anyone authored. Three things follow, and each is asserted here rather than assumed:

1. ALLOW — every verb the server accepts for that hold (`gate_action: resume |
   accept_alternative | abort`, `cancel: true`) must pass `gate-enforce.py` Check 2. Tier 0
   renamed the artifact to `PENDING_RUN_RESOLUTION_PARAMS`, which plausibly makes this work for
```

### File: hooks/tests/test_codex_client_seams.py

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
-rw-r--r-- 1 minipuft minipuft 5519 Sep  1 02:05 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
139 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
$ rg -n def test /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
36:    def test_plugin_root_resolves_when_alone(self, tmp_path, monkeypatch):
41:    def test_claude_plugin_root_wins_over_plugin_root(self, tmp_path, monkeypatch):
51:    def test_plugin_root_wins_over_gemini_root(self, tmp_path, monkeypatch):
61:    def test_nonexistent_plugin_root_falls_through(self, tmp_path, monkeypatch):
72:    def test_claude_default_shape_unchanged(self):
78:    def test_codex_command_shape(self):
88:    def test_codex_working_directory_uses_cd(self, tmp_path):
94:    def test_claude_working_directory_uses_add_dir(self, tmp_path):
99:    def test_client_defaults_from_env(self, monkeypatch):
107:    def test_not_found_message_per_client(self):
124:    def test_high_capability_resolves_to_verified_slug(self):
128:    def test_standard_returns_none_for_client_default(self):
131:    def test_gate_heavy_step_escalates(self):
135:    def test_registry_has_codex(self):
138:    def test_claude_default_behavior_unchanged(self):
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/tests/test_codex_client_seams.py
"""
Tests for the Codex client seams in hooks/lib.

Covers:
- workspace.get_workspace_root PLUGIN_ROOT resolution (order + fall-through)
- cli_spawner._build_command dispatch (claude vs codex command shape)
- cli_spawner._cli_not_found_message per-client error text
- model_strategies.CodexModelStrategy resolution + registry registration
"""
```

### File: server/tests/e2e/claims-conformance.test.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
-rw-r--r-- 1 minipuft minipuft 29633 Oct  5 23:52 /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
629 /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
$ rg -n ScenarioSetupError /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
53:class ScenarioSetupError extends Error {}
262:    throw new ScenarioSetupError(
301:      throw new ScenarioSetupError(
334:      throw new ScenarioSetupError(
444:    if (error instanceof ScenarioSetupError) throw error;
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/server/tests/e2e/claims-conformance.test.ts
/**
 * Claims-conformance suite
 *
 * Every scenario in `conformance/*.yaml` asserts something the PUBLISHED surface claims — the
 * README, docs/, or a contract registry — and this driver executes it against a real spawned
 * server over the real transport. A red scenario means the documentation and the server
 * disagree.
 *
 * WHY THIS EXISTS
 * Tier 3a of the acquisition plan found 9 overstated README claims by hand; `%guided` threw a
```

### File: scripts/codex-dev-plugin.mjs

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
-rw-r--r-- 1 minipuft minipuft 19712 Sep 29 21:17 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
658 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
$ rg -n stageDevPlugin /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
535:export async function stageDevPlugin({
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-dev-plugin.mjs
/** Materialize the current engine and shared hooks behind unchanged Codex adapters. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
```

### File: scripts/codex-server.mjs

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
-rwxr-xr-x 1 minipuft minipuft 24554 Sep 29 21:17 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
754 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
$ rg -n async function /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
160:async function optionalJson(path) {
169:async function cachedPlugins(configPath, marketplace) {
206:async function status(configPath, wrapperRoot) {
288:async function backupConfig(configPath, original) {
324:async function writeConfig(
376:async function ensureMarketplace(configPath, original) {
430:async function installedDevelopment(configPath) {
448:async function assertConfigState(configPath, expected) {
455:async function captureInstalled(configPath, previous) {
466:async function replayInstalled(configPath, stage, snapshot) {
485:async function restoreInstalledSettings(context, observed) {
513:async function rollbackDevelopment(context) {
559:async function installDevelopment(
667:async function switchMode(configPath, mode, wrapperRoot) {
716:async function main() {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/scripts/codex-server.mjs
#!/usr/bin/env node
// Local operator tool; never edits plugin caches or the running Codex session.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  rm,
```

### File: evaluations/core/contracts.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
-rw-r--r-- 1 minipuft minipuft 11755 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
359 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
$ rg -n ArchiveRecord /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
78:export type ArchiveRecord = RecordBody & { readonly record_id: Digest };
79:export type ArchiveRecordInput = IdentityBinding &
334:export function createArchiveRecord(input: ArchiveRecordInput): ArchiveRecord {
345:  }) as ArchiveRecord;
349:export function parseArchiveRecord(value: unknown): ArchiveRecord {
358:  return immutableCopy(record) as ArchiveRecord;
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/contracts.ts
// Optional archive contracts; no runtime workflow or resource catalog authority.
import {
  canonicalJson,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";

type RecordKind =
  "task" | "suite" | "trial" | "grade" | "promotion" | "evidence";
type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;
```

### File: evaluations/core/archive.ts

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
-rw-r--r-- 1 minipuft minipuft 9851 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
321 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
$ rg -n class /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
163:export class EvaluationArchive {
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/core/archive.ts
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import {
  canonicalJson,
  hashBytes,
  hashCanonical,
} from "../../server/src/shared/utils/hash.ts";
import { parseArchiveRecord, parseContentRef } from "./contracts.ts";
```

### File: evaluations/README.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
-rw-r--r-- 1 minipuft minipuft 17545 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
278 /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
$ rg -n Setup and checks /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
12:## Setup and checks
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/README.md
# Optional evaluation evidence archive

This private, repository-local Node24 TypeScript package provides immutable evaluation
records, content-addressed evidence blobs and private gate-suite contracts. Use it
explicitly from a checkout; it does not join the root workspace or default server startup.
Its generic [contracts](core/contracts.ts) and [archive](core/archive.ts) import the existing
[canonical hash source](../server/src/shared/utils/hash.ts) outside this directory, so
the package is not an independently published library. Gate specialization also uses
the server's locked dependencies and source loader; this package adds no dependency or
separate model-provider SDK.
```

### File: evaluations/package.json

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
-rw-r--r-- 1 minipuft minipuft 549 Oct  7 10:46 /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
16 /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
$ rg -n test /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
11:    "test": "npm run test:core && npm run test:gates",
12:    "test:core": "node --test tests/*.test.ts",
13:    "test:gates": "node --import ../server/node_modules/tsx/dist/loader.mjs --test gates/*.test.ts",
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/evaluations/package.json
{
  "name": "@claude-prompts/evaluations",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Opt-in repository-local evaluation evidence contracts and archive.",
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
```

### File: hooks/README.md

````text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
-rw-r--r-- 1 minipuft minipuft 10738 Sep 19 22:43 /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
220 /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
$ rg -n gate-enforce.py /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
40:| Ignores FAIL verdict             | `gate-enforce.py`       | Blocks until criteria addressed        |
71:### `gate-enforce.py` (PreToolUse)
108:  | python3 hooks/gate-enforce.py | jq '.hookSpecificOutput.permissionDecision'
113:  | python3 hooks/gate-enforce.py
176:            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\""
204:├── gate-enforce.py         # PreToolUse - gate verdict enforcement
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/hooks/README.md
# Claude Prompts Hooks

Behavior guardrails for Claude when using the prompt engine. Catches missed `>>` syntax, forgotten chain continuations, and skipped gate reviews.

## Quick Start

```bash
# Add the marketplace (first time only)
/plugin marketplace add minipuft/minipuft-plugins
````

### File: docs/guides/gates.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
-rw-r--r-- 1 minipuft minipuft 34114 Oct  8 15:15 /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
571 /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
$ rg -n semantic_evaluation /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
16:| `semantic_evaluation`  | Validates a structured report against frozen criteria, server-issued binding, captured target, and required evidence.                                                                                                                                                                                                   | Semantic report contract acceptance | Boolean, category, or anchored-score requirements; model correctness remains unknown.            |
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/docs/guides/gates.md
# Gates Guide

Gates provide review guidance or evaluate criteria. What they enforce depends on the execution
shape and the gate's declared enforcement mode.

## Enforcement Modes

Every gate in a `gate.yaml` declares one or more `pass_criteria` entries; the `type:` field selects the enforcement mode. Five modes exist, and they differ in **what the runtime actually does** when the gate fires — not all are equally enforced. A gate is a `check` when at least one criterion is `shell_verify` or `script_tool`; a semantic-only gate is an `evaluation`, and gates without either component are `reminder` gates. Mixed gates retain both requirements with the `check` tier (see [Gate Configuration Reference § Tiers](../reference/gate-configuration.md#tiers)).

| `type:`                | What runs at execution time                                                                                                                                                                                                                                                                                             | Enforcement strength                | Use for                                                                                          |
```

### File: docs/reference/client-capabilities.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
-rw-r--r-- 1 minipuft minipuft 3780 Jul 31 22:21 /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
57 /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
$ rg -n Codex /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
21:| Codex          | `~/.codex/config.toml`                                                    | TOML (`[mcp_servers.*]`)       |
35:| Codex / Cursor / Windsurf / Zed | no dedicated hooks package in this repo | MCP tools only |
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/docs/reference/client-capabilities.md
# Client Capabilities Reference

Lookup table for client presets, handoff profiles, and integration limits.

## Client Presets

| `--client` value | Handoff profile      | Status               | Primary behavior                                       |
| ---------------- | -------------------- | -------------------- | ------------------------------------------------------ |
| `claude-code`    | `task_tool_v1`       | canonical            | Task tool style guidance                               |
| `codex`          | `spawn_agent_v1`     | canonical            | `spawn_agent`-oriented handoff guidance                |
```

### File: .claude/rules/extension-alignment.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
-rw-r--r-- 1 minipuft minipuft 2572 Aug 23 15:49 /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
52 /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
$ rg -n Distribution Boundaries /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
14:## Distribution Boundaries
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/.claude/rules/extension-alignment.md
---
paths:
  - "hooks/**"
  - ".claude-plugin/**"
  - "manifest.json"
  - "mcp.json"
  - "server/scripts/synchronize-downstream-lock.js"
---

# Multi-Platform Extension Alignment
```

### File: docs/architecture/overview.md

```text
$ ls -la /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
-rw-r--r-- 1 minipuft minipuft 59494 Oct  5 04:38 /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
$ wc -l /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
959 /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
$ rg -n Architecture /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
1:# Architecture Guide
101:| **3-Tool Architecture**      | Token economy: fewer tools = less context overhead              |
167:### MCP Tool Architecture
236:### Component Architecture
$ head -10 /home/minipuft/Applications/claude-prompts-mcp/docs/architecture/overview.md
# Architecture Guide

How a prompt goes from what you type to a structured, validated response — and where each piece plugs in.

**Read this when** you want to understand the system internals: how requests flow, where validation and reasoning guidance get injected, and which files to look at when debugging or extending.

**You'll learn**

- How a request flows: Client → Transport → Pipeline → Response
- Where validation rules (gates), reasoning guidance (frameworks), and formatting (styles) get applied
```

### File: /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py

```text
$ ls -la /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
-rw-r--r-- 1 minipuft minipuft 36219 Oct  6 01:44 /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
$ wc -l /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
524 /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
$ rg -n def  /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
35:def parent_id(value):
46:def sum_usage(usages):
50:def collect(config: Path, root_session: str | None) -> dict:
100:def pricing(usage: dict) -> dict:
118:def quota_exhausted(stream: Path, errors: Path) -> bool:
128:    def __init__(self, process, raw, deadline):
134:    def send(self, method, params=None, request=True):
142:    def read(self):
160:    def call(self, method, params):
171:def compact(root: Path, arm: str, timeout: int) -> dict:
226:def task_stages(task, prompt):
233:def stage_transition(task: str, index: int, behavior_case: dict | None = None) -> str:
239:def behavior_boundary(usage: dict, observed: dict) -> dict:
248:def run_cell(base: Path, task: str, arm: str, ref: str | None, identity=None, *, task_timeout_seconds=None, behavior_case=None, observer_limits=None) -> dict:
357:def own_turn_evidence(rows, sid, native_completed=()):
365:def native_module_actions(rows, sid):
385:def audit_record(record):
421:def audit_export(root: Path) -> dict:
457:def build_parser():
469:def parse_args(argv=None):
478:def main():
$ head -10 /home/minipuft/.claude/evaluations/configurations/codex_benchmark.py
#!/usr/bin/env python3
"""Execute authorized public tasks; retain native evidence privately outside Git."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
```

### File: /home/minipuft/.claude/evaluations/configurations/codex_configure.py

```text
$ ls -la /home/minipuft/.claude/evaluations/configurations/codex_configure.py
-rw-r--r-- 1 minipuft minipuft 24764 Oct  5 00:15 /home/minipuft/.claude/evaluations/configurations/codex_configure.py
$ wc -l /home/minipuft/.claude/evaluations/configurations/codex_configure.py
376 /home/minipuft/.claude/evaluations/configurations/codex_configure.py
$ rg -n def  /home/minipuft/.claude/evaluations/configurations/codex_configure.py
21:def environment(home: Path = shared.ORIGINAL_HOME, runtime: dict | None = None) -> dict:
27:def toolchain(binary: Path | None = None) -> dict:
40:def controls(benchmark: dict | None = None) -> str:
51:def run_private(root: Path, name: str, manifest: dict, command: list, timeout: int = 30) -> subprocess.CompletedProcess:
57:def projection(root: Path, name: str, manifest: dict) -> dict:
78:def prepare(root: Path, fixture: Path, *, benchmark: dict | None = None) -> dict:
138:def integrity(root: Path, manifest: dict) -> None:
155:def verify(root: Path) -> dict:
211:def records(lines: list[str]) -> tuple[list, int]:
224:def rollout_evidence(config: Path, session_id: str | None) -> dict:
249:def observation(lines: list[str], code: int, evidence: dict, expected: str | None) -> dict:
271:def launch(root: Path, arm_name: str, prompt: Path, stage: str, resume: bool, timeout: int, *, observer=None, transition=None, public_prompt_sha256=None, deadline=None) -> dict:
347:def main() -> None:
$ head -10 /home/minipuft/.claude/evaluations/configurations/codex_configure.py
#!/usr/bin/env python3
"""Prepare, verify offline, and explicitly launch isolated Codex downstream arms."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
```
