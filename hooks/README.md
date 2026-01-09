# Claude Prompts Hooks

Hooks that guide Claude's behavior when using the prompt engine. These solve common issues where models miss `>>` syntax, forget to continue chains, or skip gate reviews.

## Why Hooks?

| Problem                          | Hook Solution                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Model ignores `>>analyze` syntax | `prompt-suggest.py` detects it and suggests the correct MCP call                    |
| User forgets to continue chain   | `post-prompt-engine.py` injects `[Chain] Step 2/5 - call prompt_engine to continue` |
| Gate review skipped              | `post-prompt-engine.py` reminds: `[Gate] Respond: GATE_REVIEW: PASS\|FAIL`          |
| Session state bloat              | `pre-compact.py` cleans up before context compaction                                |

## Included Hooks

### `prompt-suggest.py` (UserPromptSubmit)

Triggers on every user message. Detects `>>prompt` syntax and injects a system message suggesting the correct `prompt_engine` call with available arguments.

**Example output:**

```
[MCP] >>diagnose (general)
  Args: scope:string, focus:string, symptoms:string
  prompt_engine(command:">>diagnose", options:{...})
```

### `post-prompt-engine.py` (PostToolUse)

Triggers after `prompt_engine` calls. Parses the response to track chain state and pending gates, then injects reminders.

**Example outputs:**

```
[Chain] Step 2/5 - call prompt_engine to continue
[Gate] code-quality
  Respond: GATE_REVIEW: PASS|FAIL - <reason>
```

### `pre-compact.py` (PreCompact)

Triggers before context compaction (`/compact`). Cleans up chain session state to prevent stale data from persisting across compaction boundaries.

### `dev-sync.py` (SessionStart)

Triggers on session start. Syncs source files to the plugin cache.

**⚠️ Superseded by `--plugin-dir`**: For active development, use Claude Code's direct loading:

```bash
cc --plugin-dir /path/to/claude-prompts-mcp
```

This bypasses the cache entirely, making dev-sync unnecessary. The hook remains for:

- Users who prefer marketplace install + automatic sync
- Fallback when `--plugin-dir` is forgotten

**Quick-check mode** minimizes startup delay:

| Scenario                   | Time   | Action                    |
| -------------------------- | ------ | ------------------------- |
| No changes since last sync | <100ms | Instant skip              |
| Source files modified      | 2-5s   | Full sync                 |
| First run / marker missing | 2-5s   | Full sync + create marker |

**How it works:**

1. Compares source file timestamps against `.dev-sync-marker` in cache
2. If no changes detected, exits immediately (no sync)
3. If changes detected, performs full sync and updates marker

**Force full sync:** Delete `.dev-sync-marker` from the cache directory.

**Note:** Only runs for development setups (source dir exists). Marketplace installs skip this hook entirely.

### Development Workflow Recommendation

| Goal                          | Method                   | Dev-Sync Role              |
| ----------------------------- | ------------------------ | -------------------------- |
| Active development            | `cc --plugin-dir /path`  | Not needed (bypassed)      |
| Test install flow             | Bump version + reinstall | Not needed (clean install) |
| Hybrid (marketplace + source) | Keep hook enabled        | Auto-syncs changes         |

## Installation

These hooks are included when you install via the Claude Code plugin:

```bash
# First time: add the marketplace
/plugin marketplace add minipuft/minipuft-plugins

# Install the plugin (includes hooks)
/plugin install claude-prompts@minipuft
```

## Architecture

```
hooks/
├── hooks.json              # Claude Code hooks config (UserPromptSubmit, PostToolUse, etc.)
├── prompt-suggest.py       # Claude Code: UserPromptSubmit (syntax detection)
├── post-prompt-engine.py   # Claude Code: PostToolUse (chain/gate tracking)
├── pre-compact.py          # Claude Code: PreCompact (session cleanup)
├── dev-sync.py             # Claude Code: SessionStart (quick-check sync)
├── ralph-stop.py           # Claude Code: Stop (graceful shutdown)
├── setup.sh                # Manual: npm install (not auto-run)
├── gemini/                 # Gemini adapter scripts (thin wrappers)
│   ├── session-start.py    # Gemini: SessionStart (dev sync)
│   ├── before-agent.py     # Gemini: BeforeAgent (syntax detection)
│   ├── after-tool.py       # Gemini: AfterTool (chain/gate tracking)
│   ├── pre-compact.py      # Gemini: PreCompress (session cleanup)
│   └── stop.py             # Gemini: SessionEnd (graceful shutdown)
└── lib/
    ├── cache_manager.py    # Reads server/cache/prompts.cache.json
    ├── session_state.py    # Chain/gate state tracking
    └── workspace.py        # MCP_WORKSPACE resolution
```

**Hook Config Locations:**

- **Claude Code**: `hooks/hooks.json` — standalone config file
- **Gemini CLI**: `gemini-extension.json` — hooks embedded in extension manifest

**Separation:** Claude Code uses root-level scripts with `${CLAUDE_PLUGIN_ROOT}`. Gemini uses `hooks/gemini/` adapter scripts with `${extensionPath}`. Each platform has different event names but equivalent functionality.

## Configuration (Claude Code)

Claude Code hooks are configured in `hooks/hooks.json`:

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
    ]
  }
}
```

## Cache Access

Hooks read prompt metadata from `server/cache/prompts.cache.json`, which is generated by the MCP server on startup and updated on hot-reload. This enables `prompt-suggest.py` to show available arguments without calling the server.

---

## Gemini CLI

Gemini CLI uses different hook events than Claude Code, but the functionality is equivalent.

### Requirements

- **Gemini CLI v0.24.0+** — Earlier versions don't support `hooks.enabled` configuration
- **Global hooks toggle** — Must enable hooks in `~/.gemini/settings.json`

### Setup

**Step 1: Upgrade Gemini CLI**

```bash
# Check current version
gemini --version

# Upgrade to v0.24.0-preview.0 or later
npm install -g @google/gemini-cli@0.24.0-preview.0
```

**Step 2: Enable hooks globally**

Create or edit `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "enabled": true
  }
}
```

### Hook Event Mapping

| Claude Code Event  | Gemini Event   | Purpose                           |
| ------------------ | -------------- | --------------------------------- |
| `UserPromptSubmit` | `BeforeAgent`  | Detect `>>prompt` syntax          |
| `PostToolUse`      | `AfterTool`    | Track chain state, gate reminders |
| `PreCompact`       | `PreCompress`  | Clean session state               |
| `SessionStart`     | `SessionStart` | Dev sync (same)                   |
| `Stop`             | `SessionEnd`   | Graceful shutdown                 |

### File Structure

```
gemini-extension.json       # Extension manifest WITH embedded hooks
hooks/
├── hooks.json              # Claude Code hooks (NOT used by Gemini)
├── gemini/                 # Gemini adapter scripts
│   ├── session-start.py    # SessionStart handler
│   ├── before-agent.py     # BeforeAgent handler (syntax detection)
│   ├── after-tool.py       # AfterTool handler (chain/gate tracking)
│   ├── pre-compact.py      # PreCompress handler
│   └── stop.py             # SessionEnd handler
└── lib/                    # Shared utilities (both CLI versions)
```

**Gemini hooks are embedded in `gemini-extension.json`** (NOT a separate file):

```json
{
  "name": "gemini-prompts",
  "hooks": {
    "BeforeAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${extensionPath}${/}hooks${/}gemini${/}before-agent.py",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

**Key syntax differences from Claude Code:**

- Path variable: `${extensionPath}` (not `${CLAUDE_PLUGIN_ROOT}`)
- Path separator: `${/}` (platform-agnostic, not `/`)
- Timeout: milliseconds (not seconds)

> **Note**: If using the symlink development setup (`ln -s "$(pwd)" ~/.gemini/extensions/gemini-prompts`), do NOT add hooks to `.gemini/settings.json`. The extension symlink already provides hooks via `gemini-extension.json`. Adding both causes duplicate hook execution.

### Verifying Hooks Work

1. Start a Gemini session: `gemini`
2. Check for hook debug output in `.gemini/hook-debug.log`
3. Test with a prompt command: `>>diagnose :: 'security-review'`
4. The `BeforeAgent` hook should detect the syntax and suggest the MCP call

### Troubleshooting

| Issue                  | Solution                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| "hooks.enabled" error  | Upgrade to v0.24.0+: `npm install -g @google/gemini-cli@0.24.0-preview.0`                    |
| Hooks not firing       | Check `~/.gemini/settings.json` has `"hooks": { "enabled": true }`                           |
| Hooks running twice    | Using symlink dev setup? Remove hooks from `.gemini/settings.json` — extension provides them |
| Invalid event warnings | Safe to ignore — v0.24-preview treats some config properties as event names                  |
| Script not found       | Verify hook paths use correct variable (`${extensionPath}` vs `$GEMINI_PROJECT_DIR`)         |

---

## Claude Code Plugin

Claude Code hooks are configured in `hooks/hooks.json` and use the `${CLAUDE_PLUGIN_ROOT}` variable. The variable resolves to the plugin root directory.

The plugin is installed via:

```bash
/plugin marketplace add minipuft/minipuft-plugins
/plugin install claude-prompts@minipuft
```

Root-level hook scripts (`hooks/*.py`) are used by Claude Code. Gemini uses scripts in `hooks/gemini/`.
