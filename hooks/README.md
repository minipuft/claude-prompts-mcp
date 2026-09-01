# Claude Prompts Hooks

Behavior guardrails for Claude when using the prompt engine. Catches missed `>>` syntax, forgotten chain continuations, and skipped gate reviews.

## Quick Start

```bash
# Add the marketplace (first time only)
/plugin marketplace add minipuft/minipuft-plugins

# Install the plugin (includes hooks)
/plugin install claude-prompts@minipuft
```

Hooks activate automatically. Type `>>analyze` and watch the suggestion appear.

### Python interpreter resolution

Installed hooks run through `python-hook-runner.cjs` instead of invoking a Python command
directly. The plugin already requires Node.js, so the runner can select a Python 3 interpreter for
the host platform without adding shell-specific branches to each hook:

- Windows: `py -3`, then `python3`, then `python`
- macOS and Linux: `python3`, then `python`

The runner advances to the next candidate only when a command is absent. Once an interpreter starts,
the hook's exit status is returned unchanged; a failing hook is not retried with another Python
installation. If no candidate exists, the runner exits 127 and prints the installation requirement.

The direct `python3 hooks/*.py` commands below are contributor-side tests, not the installed plugin
contract.

## Why Hooks?

| Problem                          | Hook                    | Result                                 |
| -------------------------------- | ----------------------- | -------------------------------------- |
| Model ignores `>>analyze` syntax | `prompt-suggest.py`     | Suggests correct MCP call              |
| Forgets to continue chain        | `post-prompt-engine.py` | Injects `[Chain] Step 2/5` reminder    |
| Skips gate review                | `post-prompt-engine.py` | Prompts `GATE_REVIEW: PASS\|FAIL`      |
| Ignores FAIL verdict             | `gate-enforce.py`       | Blocks until criteria addressed        |
| Chain lost after compaction      | `compact-recovery.py`   | Re-injects chain state post-compaction |

## Hooks Reference

### `prompt-suggest.py` (UserPromptSubmit)

Triggers on every user message. Detects `>>prompt` syntax and suggests the correct `prompt_engine` call.

**Output:**

```text
[>>] diagnose | scope:"auth" [chain:3steps, @CAGEERF]
[Chain Workflow] 3 steps:
  1. initial_scan: Initial Scan (1/3)
  2. deep_dive: Deep Dive (2/3)
  3. synthesis: Synthesis (3/3)
```

### `post-prompt-engine.py` (PostToolUse)

Triggers after `prompt_engine` calls. Tracks chain state and pending gates.

**Output:**

```text
[Chain] Step 2/5 - call prompt_engine to continue
[Gate] code-quality
  Respond: GATE_REVIEW: PASS|FAIL - <reason>
```

### `gate-enforce.py` (PreToolUse)

Blocks `prompt_engine` calls that violate gate discipline:

| Check             | Trigger                                                                                        | Denial Message                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| FAIL verdict      | `gate_verdict` with overall FAIL (object or legacy string)                                     | "Gate FAIL: {reason}. Review the failing criteria ... resubmit."                                                                          |
| Pending gate      | `chain_id` carrying NO resolution parameter while a gate is open                               | "Gate review required: ... submit gate_verdict. If the gate cannot be satisfied, these parameters also resolve it: {exits}."              |
| Paused on unknown | `chain_id` carrying NO resolution parameter while the run is hard-paused on a blocking unknown | "Chain paused: blocking unknown interrupt. The run issued no step and no gate_verdict clears this hold. Resolve it with one of: {verbs}." |

The pending-run check accepts every **resolution parameter** the server accepts — `gate_verdict`,
`gate_action` (retry/skip/abort/resume/accept_alternative), `cancel` — read from
`lib/_generated/resolution_verbs.py`, which `server npm run generate:contracts` emits from
parameters flagged `resolvesPendingRun` in `tooling/contracts/prompt-engine.json`. Never hardcode
the verb list in the hook: the hardcoded model denied `gate_action: "abort"` and `cancel: true`
(both server-supported exits), so a pending gate trapped its own abort (fixed 2026-08-20). If the
generated module is missing or unreadable the check fails open — the server enforces gates
authoritatively.

**Two holds, one rule.** A run can also be held by the reserved synthetic review
`__unknown_interrupt__`, raised when a blocking unknown lands on a run that declared
`budget.pauseOnBlocking`. It reaches the same check by the same route (one pending review, one
`pending_gate` field) but is denied with different prose, because it accepts different exits: a
paused run issues **no step**, so no `gate_verdict` clears it and there is nothing to answer. The
verbs the denial names are the ones the SERVER printed in its own interrupt section —
`lib/session_state.py` captures them off the response (`interruptVerbs` extraction pattern) and
falls back to the generated parameter names when it has none, which is the path compact recovery
takes. Every human-facing surface renders the synthetic id as `blocking unknown interrupt`
(`session_state.label_gate_ids`, used by `db_reader` too); the raw dunder never reaches a caller.
Covered by `tests/test_unknown_interrupt_hold.py`, including a mutation probe that drops
`gate_action` from the generated set and asserts `resume` is then denied.

**Test manually:**

```bash
# FAIL verdict - should deny
echo '{"tool_name": "prompt_engine", "tool_input": {"gate_verdict": "GATE_REVIEW: FAIL - bad code"}}' \
  | python3 hooks/gate-enforce.py | jq '.hookSpecificOutput.permissionDecision'
# Output: "deny"

# PASS verdict - should allow (exit 0, no output)
echo '{"tool_name": "prompt_engine", "tool_input": {"gate_verdict": "GATE_REVIEW: PASS - looks good"}}' \
  | python3 hooks/gate-enforce.py
echo $?  # Output: 0
```

### `compact-recovery.py` (SessionStart, matcher: "compact")

Re-injects active chain state after compaction. Recovery is scoped to the chain THIS conversation recorded (via the PostToolUse chain tracker in `hooks-state.db`); the server's `state.db` refreshes that specific chain and never substitutes another client's chain, since several clients' MCP servers can share one `state.db`. Outputs a continuation directive to stdout, which Claude Code adds to post-compaction context. Replaces the former `pre-compact.py` (PreCompact), which was a side-effects-only event that could not inject context.

## Configuration

### Output Format

Set in `server/config.json`:

```json
{
  "hooks": {
    "expandedOutput": false
  }
}
```

| Mode              | Setting | Example                               |
| ----------------- | ------- | ------------------------------------- |
| Compact (default) | `false` | `[>>] diagnose \| scope:"auth"`       |
| Expanded          | `true`  | Multi-line with full argument details |

### hooks.json

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/prompt-suggest.py\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*prompt_engine*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/post-prompt-engine.py\""
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*prompt_engine*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py\""
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs\" \"${CLAUDE_PLUGIN_ROOT}/hooks/compact-recovery.py\""
          }
        ]
      }
    ]
  }
}
```

## Architecture

```text
hooks/
├── hooks.json              # Claude Code hooks config
├── python-hook-runner.cjs  # Cross-platform Python 3 interpreter selection
├── prompt-suggest.py       # UserPromptSubmit - syntax detection
├── post-prompt-engine.py   # PostToolUse - chain/gate tracking
├── gate-enforce.py         # PreToolUse - gate verdict enforcement
├── compact-recovery.py     # SessionStart("compact") - chain state recovery
└── lib/
    ├── cache_manager.py    # Prompt/gate metadata queries (via SQLite resource_index)
    ├── db_reader.py        # Read-only SQLite access to state.db
    ├── hook_state_store.py # SQLite-backed session state (hooks-state.db)
    ├── session_state.py    # Chain/gate state tracking (delegates to hook_state_store)
    └── workspace.py        # MCP_WORKSPACE resolution
```

## Data Access

Hooks read prompt/gate metadata from the server's `state.db` (SQLite, read-only via `db_reader.py`), resolved the same way the server resolves its write path: `{MCP_RUNTIME_ROOT || MCP_WORKSPACE}/runtime-state/state.db`, with the legacy `{workspace}/server/runtime-state/` layout probed as a fallback. Hook-owned session state is stored in `server/runtime-state/hooks-state.db` (SQLite, read-write via `hook_state_store.py`).

## Other Platforms

Gemini CLI hooks: [gemini-prompts/hooks/](https://github.com/minipuft/gemini-prompts/tree/main/hooks) (shares `lib/` via npm dependency).
