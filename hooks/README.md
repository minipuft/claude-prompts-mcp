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

| Problem | Hook | Result |
|---------|------|--------|
| Model ignores `>>analyze` syntax | `prompt-suggest.py` | Suggests correct MCP call |
| Forgets to continue chain | `post-prompt-engine.py` | Injects `[Chain] Step 2/5` reminder |
| Skips gate review | `post-prompt-engine.py` | Prompts `GATE_REVIEW: PASS\|FAIL` |
| Ignores FAIL verdict | `gate-enforce.py` | Blocks until criteria addressed |
| Session state bloat | `pre-compact.py` | Cleans up before `/compact` |

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

| Check | Trigger | Denial Message |
|-------|---------|----------------|
| FAIL verdict | `gate_verdict: "GATE_REVIEW: FAIL - ..."` | "Gate failed: {reason}. Review criteria and retry." |
| Missing user_response | `chain_id` without `user_response` | "Chain resume requires user_response." |
| Pending gate | `chain_id` with unresolved gate | "Include gate_verdict: PASS\|FAIL" |

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

### `pre-compact.py` (PreCompact)

Cleans up chain session state before context compaction to prevent stale data.

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

| Mode | Setting | Example |
|------|---------|---------|
| Compact (default) | `false` | `[>>] diagnose \| scope:"auth"` |
| Expanded | `true` | Multi-line with full argument details |

### hooks.json

```json
{
  "hooks": {
    "UserPromptSubmit": [{"matcher": "*", "hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/prompt-suggest.py"}]}],
    "PostToolUse": [{"matcher": "*prompt_engine*", "hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post-prompt-engine.py"}]}],
    "PreToolUse": [{"matcher": "*prompt_engine*", "hooks": [{"type": "command", "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py"}]}]
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
├── pre-compact.py          # PreCompact - session cleanup
└── lib/
    ├── cache_manager.py    # Reads server/cache/prompts.cache.json
    ├── session_state.py    # Chain/gate state tracking
    └── workspace.py        # MCP_WORKSPACE resolution
```

## Cache

Hooks read from `server/cache/prompts.cache.json` (generated on server startup, updated on hot-reload). This enables argument suggestions without server calls.

## Other Platforms

Gemini CLI hooks: [gemini-prompts/hooks/](https://github.com/minipuft/gemini-prompts/tree/main/hooks) (shares `lib/` via submodule).
