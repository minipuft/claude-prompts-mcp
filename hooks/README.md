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

| Check                 | Trigger                                   | Denial Message                                      |
| --------------------- | ----------------------------------------- | --------------------------------------------------- |
| FAIL verdict          | `gate_verdict: "GATE_REVIEW: FAIL - ..."` | "Gate failed: {reason}. Review criteria and retry." |
| Missing user_response | `chain_id` without `user_response`        | "Chain resume requires user_response."              |
| Pending gate          | `chain_id` with unresolved gate           | "Include gate_verdict: PASS\|FAIL"                  |

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

Re-injects active chain state after compaction. Reads from SQLite (`state.db`) and outputs a continuation directive to stdout, which Claude Code adds to post-compaction context. Replaces the former `pre-compact.py` (PreCompact), which was a side-effects-only event that could not inject context.

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
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/prompt-suggest.py"
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
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post-prompt-engine.py"
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
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py"
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
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/compact-recovery.py"
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

Hooks read prompt/gate metadata from `server/runtime-state/state.db` (SQLite, read-only via `db_reader.py`). Session state is stored in `server/runtime-state/hooks-state.db` (SQLite, read-write via `hook_state_store.py`).

## Other Platforms

Gemini CLI hooks: [gemini-prompts/hooks/](https://github.com/minipuft/gemini-prompts/tree/main/hooks) (shares `lib/` via npm dependency).
