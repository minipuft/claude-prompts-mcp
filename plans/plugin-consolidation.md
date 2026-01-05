# Plugin Consolidation Plan: claude-prompts-mcp

## Current State Analysis

### Duplicate Structures Identified

| Location | Purpose | Status |
|----------|---------|--------|
| `/plugin.json` (root) | New plugin manifest with hooks | Wrong location |
| `/.claude-plugin/marketplace.json` | References plugins/claude-prompts | Legacy npm structure |
| `/plugins/claude-prompts/.claude-plugin/plugin.json` | npm distribution | Separate plugin definition |
| `/plugins/claude-prompts/.mcp.json` | npm MCP config | Uses npx invocation |
| `~/.claude/hooks/` | User-level hooks | Hardcoded paths, duplicated |
| `/hooks/` | Plugin hooks | Uses ${CLAUDE_PLUGIN_ROOT} |

### Issues

1. **Root plugin.json wrong location**: Must be in `.claude-plugin/` for discovery
2. **Duplicate hooks**: User hooks in `~/.claude/hooks/` duplicate plugin hooks
3. **Missing hooks in plugin**: `detect-skills.py` and `plan-review.py` not in plugin
4. **No hooks.json**: Hooks inline in plugin.json instead of separate file
5. **No commands/skills**: Missing discoverability components
6. **Dual distribution confusion**: npm package vs plugin install unclear

---

## Target Structure

```
claude-prompts-mcp/
├── .claude-plugin/
│   └── plugin.json              # Primary manifest
├── hooks/
│   ├── hooks.json               # Hook configuration
│   ├── detect-skills.py         # SessionStart
│   ├── prompt-suggest.py        # UserPromptSubmit
│   ├── post-prompt-engine.py    # PostToolUse
│   ├── plan-review.py           # PreToolUse:ExitPlanMode
│   ├── gate-enforce.py          # Stop
│   └── lib/
│       ├── cache_manager.py
│       └── session_state.py
├── .mcp.json                    # MCP server config at root
├── commands/                    # Slash commands
│   ├── prompts.md               # /prompts - list available
│   ├── gates.md                 # /gates - list quality gates
│   └── chain.md                 # /chain - start chain execution
├── skills/
│   └── prompt-authoring/
│       └── SKILL.md             # Prompt creation guidance
└── server/                      # Existing MCP server (unchanged)
```

---

## Implementation Phases

### Phase 1: Move Plugin Manifest

**Files:**
- DELETE: `/plugin.json`
- CREATE: `/.claude-plugin/plugin.json`

**Content:**
```json
{
  "name": "claude-prompts-mcp",
  "version": "1.0.0",
  "description": "CAGEERF prompt engineering with chains, gates, and quality validation",
  "author": { "name": "minipuft" },
  "homepage": "https://github.com/minipuft/claude-prompts-mcp",
  "repository": "https://github.com/minipuft/claude-prompts-mcp",
  "license": "MIT",
  "keywords": ["mcp", "prompts", "cageerf", "gates", "chains"],
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

### Phase 2: Create hooks.json

**File:** `/hooks/hooks.json`

```json
{
  "SessionStart": [{
    "matcher": "*",
    "hooks": [{
      "type": "command",
      "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/detect-skills.py"
    }]
  }],
  "UserPromptSubmit": [{
    "matcher": "*",
    "hooks": [{
      "type": "command",
      "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/prompt-suggest.py"
    }]
  }],
  "PostToolUse": [{
    "matcher": "*prompt_engine*",
    "hooks": [{
      "type": "command",
      "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/post-prompt-engine.py"
    }]
  }],
  "PreToolUse": [{
    "matcher": "ExitPlanMode",
    "hooks": [{
      "type": "command",
      "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/plan-review.py"
    }]
  }],
  "Stop": [{
    "matcher": "*",
    "hooks": [{
      "type": "command",
      "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforce.py"
    }]
  }]
}
```

### Phase 3: Add Missing Hooks

**Copy to plugin:**
- `~/.claude/hooks/detect-skills.py` → `/hooks/detect-skills.py`
- `~/.claude/hooks/plan-review.py` → `/hooks/plan-review.py`

**Update paths in copied files** to use `${CLAUDE_PLUGIN_ROOT}` via environment detection.

### Phase 4: Create .mcp.json at Root

**File:** `/.mcp.json`

```json
{
  "mcpServers": {
    "claude-prompts-mcp": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/index.js"]
    }
  }
}
```

### Phase 5: Create Commands

**File:** `/commands/prompts.md`
```markdown
---
name: prompts
description: List available prompt templates
---
Use the prompt_engine tool with action:"list" to show available prompts.
```

**File:** `/commands/gates.md`
```markdown
---
name: gates
description: List available quality gates
---
Use system_control with action:"gates", operation:"list" to show gates.
```

**File:** `/commands/chain.md`
```markdown
---
name: chain
description: Start a prompt chain execution
arguments:
  - name: chain
    type: string
    description: Chain definition (e.g., ">>analyze --> >>implement")
---
Use prompt_engine with the chain: {chain}
```

### Phase 6: Create Prompt Authoring Skill

**File:** `/skills/prompt-authoring/SKILL.md`
```markdown
---
name: Prompt Authoring
description: Guidance for creating effective prompts and chains
version: 1.0.0
---
# Prompt Authoring Guide
[Content from existing documentation]
```

### Phase 7: Clean Up Legacy

**Delete:**
- `/plugins/claude-prompts/` directory (entire npm plugin structure)
- `/.claude-plugin/marketplace.json`

**Update user config** (`~/.claude/settings.json`):
- Remove all hook definitions (plugin provides them)
- Add plugin to `enabledPlugins`
- Keep only user-specific hooks (detect-skills can stay if project-detection wanted globally)

### Phase 8: Update npm Package

**File:** `/package.json` - ensure `bin` points to server for npx usage

Users can:
1. **Plugin install**: `/plugins install minipuft/claude-prompts-mcp`
2. **npx (MCP only)**: `npx claude-prompts@latest` (no hooks)

---

## Critical Files to Modify

| File | Action |
|------|--------|
| `/plugin.json` | DELETE |
| `/.claude-plugin/plugin.json` | CREATE (new manifest) |
| `/.claude-plugin/marketplace.json` | DELETE |
| `/hooks/hooks.json` | CREATE |
| `/hooks/detect-skills.py` | COPY from ~/.claude/hooks/ |
| `/hooks/plan-review.py` | COPY from ~/.claude/hooks/ |
| `/.mcp.json` | CREATE |
| `/commands/*.md` | CREATE (3 files) |
| `/skills/prompt-authoring/SKILL.md` | CREATE |
| `/plugins/claude-prompts/` | DELETE entire directory |
| `~/.claude/settings.json` | UPDATE - remove hooks, add to enabledPlugins |
| `~/.claude/hooks/*.py` | DELETE after validation |

---

## Validation Steps

1. Build MCP server: `npm run build`
2. Enable plugin locally for testing
3. Verify hooks fire correctly:
   - SessionStart → detect-skills.py
   - UserPromptSubmit → prompt-suggest.py
   - PostToolUse on prompt_engine → post-prompt-engine.py
   - PreToolUse on ExitPlanMode → plan-review.py
   - Stop → gate-enforce.py
4. Verify MCP server starts and tools work
5. Test commands: `/prompts`, `/gates`, `/chain`
6. Remove user-level hooks after plugin validation

---

## Rollback Strategy

If issues arise:
1. Re-enable hooks in `~/.claude/settings.json` (backup exists)
2. Disable plugin in enabledPlugins
3. Restore hooks to ~/.claude/hooks/ from git

---

## Reflection Gate

**Risk Assessment:**
- Critical Risk: Mitigated - Rollback strategy documented; user hooks preserved until plugin validated
- Unvalidated Assumption: Verified - ${CLAUDE_PLUGIN_ROOT} resolution confirmed in existing plugin hooks

**Completeness Check:**
- Coverage Gap: detect-skills.py is project-type detection, not MCP-specific. Consider keeping as user-level hook for global availability regardless of plugin state.
- Alternative: Optimal chosen - Full plugin bundling provides single source of truth, easier distribution

---

## Post-Consolidation

After successful migration:
1. Update README with plugin installation instructions
2. Add to Claude Plugins marketplace (optional)
3. **Decision point:** detect-skills.py can stay user-level if project detection wanted independently
