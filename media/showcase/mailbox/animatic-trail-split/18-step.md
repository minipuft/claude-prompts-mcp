
## ⚠️ Retry Limit Reached

The following gates failed after 2 attempts: **handoff-artifacts, framework-compliance**

### Choose an action:

| Action | Description |
|--------|-------------|
| `gate_action: "retry"` | Reset retry count and try again with improvements |
| `gate_action: "skip"` | Skip this gate check and continue the chain |
| `gate_action: "abort"` | Stop chain execution entirely |

**To continue**, include one of the above in your next call.

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Required Sections** — emit these headers verbatim; they are graded structurally:
- `## Context` (required)
- `## Analysis` (required)
- `## Goals` (required)
- `## Execution` (required)
- `## Evaluation` (optional)
- `## Refinement` (optional)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale

**GATE_REVIEW: PASS|FAIL - overall assessment**

## Shell Verification Results

### Handoff Artifacts Exist — FAILED

**Command:** `node /home/minipuft/Applications/claude-prompts-mcp-showcase/server/resources/gates/handoff-artifacts/check-artifacts.js`
**Exit Code:** -1
**Duration:** 0ms

```
Shell verification refused: command is not in MCP_SHELL_VERIFY_ALLOWLIST. Add it exactly, or add a prefix entry ending in '*' that covers it.
```

Chain: chain-animation_animatic#1
→ Progress 6/6
Next: chain_id="chain-animation_animatic#1", gate_action="retry" | gate_action="skip" | cancel: true
