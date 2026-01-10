---
paths:
  - "hooks/**"
  - ".claude-plugin/**"
  - ".gemini/**"
  - "gemini-extension.json"
  - "manifest.json"
  - "mcp.json"
---

# Multi-Platform Extension Alignment

This project distributes to 3 platforms. Changes to one MUST be reflected in others.

## Distribution Channels

| Platform | Config File | Hooks Location | Hook Config |
|----------|-------------|----------------|-------------|
| Claude Desktop | `manifest.json` | N/A (no hooks) | N/A |
| Claude Code | `.claude-plugin/plugin.json` | `hooks/` | `hooks/hooks.json` |
| Gemini CLI | `gemini-extension.json` | `.gemini/hooks/` | `.gemini/settings.json` |

## Hook Event Mapping

| Claude Code Event | Gemini CLI Event | Shared Behavior |
|-------------------|------------------|-----------------|
| `SessionStart` | `SessionStart` | Dev sync with quick-check |
| `UserPromptSubmit` | `BeforeModel` | Prompt syntax detection |
| `PostToolUse` | `AfterTool` | Chain/gate tracking |
| `PreCompact` | N/A | Session cleanup (Claude only) |
| `Stop` | N/A | Graceful shutdown (Claude only) |

## Alignment Checklist

**When modifying hooks:**

- [ ] Update `hooks/*.py` (Claude Code source)
- [ ] Update `.gemini/hooks/*.py` (Gemini CLI adaptation)
- [ ] Update `hooks/hooks.json` (Claude Code config)
- [ ] Update `.gemini/settings.json` (Gemini CLI config)
- [ ] Update `hooks/README.md` documentation

**When modifying MCP server config:**

- [ ] Update `mcp.json` (Claude Code)
- [ ] Update `gemini-extension.json` (Gemini CLI)
- [ ] Update `manifest.json` (Claude Desktop)

**When modifying version:**

- [ ] Update `.claude-plugin/plugin.json` → version
- [ ] Update `manifest.json` → version
- [ ] Update `gemini-extension.json` → version
- [ ] Update `server/package.json` → version (via release-please)

## Shared Libraries

Hooks share code via `hooks/lib/`:
- `cache_manager.py` - Reads prompt cache
- `session_state.py` - Chain/gate state tracking
- `workspace.py` - MCP_WORKSPACE resolution

Gemini hooks import from shared lib:
```python
# In .gemini/hooks/*.py
SHARED_LIB = EXTENSION_ROOT / "hooks" / "lib"
sys.path.insert(0, str(SHARED_LIB))
from cache_manager import load_prompts_cache
```

## Performance Standards

All SessionStart hooks must:
1. Complete in <5 seconds (MCP timeout)
2. Use quick-check mode (skip if no changes)
3. Exit silently on failure (don't break session)

## Anti-Patterns

| Anti-Pattern | Correct Approach |
|--------------|------------------|
| `npm install` in SessionStart | Ship with pre-built deps |
| Full sync every session | Quick-check with timestamp marker |
| Blocking operations | Background or skip |
| Platform-specific logic in shared lib | Platform adapter in hook script |
