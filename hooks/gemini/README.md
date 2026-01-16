# Gemini CLI Hooks Adapter

This directory contains adapter scripts that bridge the Gemini CLI hook system with the core logic used by Claude Code.

## Gemini CLI Distribution

For Gemini CLI usage, see the dedicated distribution repo:
**[gemini-prompts](https://github.com/minipuft/gemini-prompts)**

That repo uses this directory via git submodule, with proper `hooks/hooks.json` for Gemini event names.

## Architecture

These scripts act as wrappers around the shared logic in `../lib/` and the core hooks in `../`. They handle:

1. **Input Parsing**: Converting Gemini's JSON input format to the internal format.
2. **Output Formatting**: Formatting output for Gemini's `hookSpecificOutput` schema.
3. **State Management**: Interfacing with `../lib/session_state.py` to persist chain state.

## Available Hooks

| Script | Gemini Event | Function |
|--------|--------------|----------|
| `before-agent.py` | BeforeAgent | Detect `>>prompt` syntax, inject context |
| `after-tool.py` | AfterTool | Track chain progress, gate reminders |
| `session-start.py` | SessionStart | Dev sync (wraps `../dev-sync.py`) |
| `pre-compact.py` | PreCompress | Preserve chain state |
| `stop.py` | SessionEnd | Cleanup (wraps `../ralph-stop.py`) |

## Event Mapping (Claude Code → Gemini CLI)

| Claude Code | Gemini CLI |
|-------------|------------|
| UserPromptSubmit | BeforeAgent |
| PostToolUse | AfterTool |
| PreCompact | PreCompress |
| Stop | SessionEnd |
| SessionStart | SessionStart |

## Configuration

Hooks are configured in the Gemini distribution repo's `hooks/hooks.json`:

```json
{
  "hooks": {
    "BeforeAgent": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "python3 ${extensionPath}${/}hooks${/}before-agent.py"
      }]
    }]
  }
}
```

**Note**: Per [Gemini CLI docs](https://geminicli.com/docs/hooks/), hooks must be in `hooks/hooks.json`, not embedded in `gemini-extension.json`.
