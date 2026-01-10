# Gemini CLI Distribution via Submodule

## Overview

Create a separate `claude-prompts-gemini` repository that uses the main `claude-prompts-mcp` as a git submodule, with symlinks for shared code and Gemini-specific config files.

## Problem Statement

Per [Gemini CLI docs](https://geminicli.com/docs/hooks/), hooks **cannot** be embedded in `gemini-extension.json` - they must be in `hooks/hooks.json`. However, both Claude Code and Gemini CLI expect `hooks/hooks.json` with incompatible event names.

| Platform | Event Names |
|----------|-------------|
| Claude Code | `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `Stop` |
| Gemini CLI | `BeforeAgent`, `AfterTool`, `PreCompress`, `SessionEnd` |

## Solution Architecture

```
~/Applications/claude-prompts-gemini/     # New Gemini distribution repo
├── core/                                 # Submodule → claude-prompts-mcp
│   ├── hooks/
│   │   ├── gemini/                      # Adapter scripts
│   │   └── lib/                         # Shared utilities
│   └── server/
│       └── dist/
├── gemini-extension.json                 # Gemini manifest (NO embedded hooks)
├── GEMINI.md                             # Context file
├── hooks/
│   ├── hooks.json                        # Gemini events config
│   ├── before-agent.py → core/hooks/gemini/before-agent.py
│   ├── after-tool.py → core/hooks/gemini/after-tool.py
│   ├── session-start.py → core/hooks/gemini/session-start.py
│   ├── pre-compact.py → core/hooks/gemini/pre-compact.py
│   ├── stop.py → core/hooks/gemini/stop.py
│   └── lib → core/hooks/lib/
└── server → core/server/
```

---

## Phase 1: Repository Setup

### 1.1 Create Gemini distribution repo
```bash
mkdir -p ~/Applications/claude-prompts-gemini
cd ~/Applications/claude-prompts-gemini
git init
```

### 1.2 Add main project as submodule
```bash
git submodule add https://github.com/minipuft/claude-prompts-mcp.git core
git submodule update --init --recursive
```

### 1.3 Create .gitignore
```
# Symlink targets are in submodule
*.pyc
__pycache__/
.gemini/hook-debug.log
```

---

## Phase 2: Gemini-Specific Files

### 2.1 Create gemini-extension.json (NO hooks)
```json
{
    "name": "gemini-prompts",
    "version": "1.1.1",
    "description": "Hot-reloadable prompts with chains, gates, and symbolic syntax",
    "main": "GEMINI.md",
    "mcpServers": {
        "gemini-prompts": {
            "command": "node",
            "args": ["${extensionPath}${/}server${/}dist${/}index.js", "--transport=stdio"],
            "env": {
                "MCP_WORKSPACE": "${extensionPath}",
                "MCP_RESOURCES_PATH": "${extensionPath}${/}server${/}resources"
            }
        }
    }
}
```

### 2.2 Create GEMINI.md
Copy/adapt from main repo's context for Gemini sessions.

### 2.3 Create hooks/hooks.json (Gemini events)
```json
{
    "hooks": {
        "SessionStart": [{
            "matcher": "startup",
            "hooks": [{
                "name": "dev-sync",
                "type": "command",
                "command": "python3 ${extensionPath}${/}hooks${/}session-start.py",
                "timeout": 15000
            }]
        }],
        "BeforeAgent": [{
            "matcher": "*",
            "hooks": [{
                "name": "prompt-suggest",
                "type": "command",
                "command": "python3 ${extensionPath}${/}hooks${/}before-agent.py",
                "timeout": 5000
            }]
        }],
        "AfterTool": [{
            "matcher": "prompt_engine",
            "hooks": [{
                "name": "chain-tracker",
                "type": "command",
                "command": "python3 ${extensionPath}${/}hooks${/}after-tool.py",
                "timeout": 5000
            }]
        }],
        "PreCompress": [{
            "matcher": "manual|auto",
            "hooks": [{
                "name": "pre-compact",
                "type": "command",
                "command": "python3 ${extensionPath}${/}hooks${/}pre-compact.py",
                "timeout": 5000
            }]
        }],
        "SessionEnd": [{
            "matcher": "exit|clear|logout|prompt_input_exit|other",
            "hooks": [{
                "name": "ralph-stop",
                "type": "command",
                "command": "python3 ${extensionPath}${/}hooks${/}stop.py"
            }]
        }]
    }
}
```

---

## Phase 3: Symlinks

### 3.1 Create hook script symlinks
```bash
cd ~/Applications/claude-prompts-gemini/hooks
ln -s ../core/hooks/gemini/before-agent.py before-agent.py
ln -s ../core/hooks/gemini/after-tool.py after-tool.py
ln -s ../core/hooks/gemini/session-start.py session-start.py
ln -s ../core/hooks/gemini/pre-compact.py pre-compact.py
ln -s ../core/hooks/gemini/stop.py stop.py
ln -s ../core/hooks/lib lib
```

### 3.2 Create server symlink
```bash
cd ~/Applications/claude-prompts-gemini
ln -s core/server server
```

---

## Phase 4: Cleanup Main Repo

### 4.1 Remove embedded hooks from gemini-extension.json
Keep only MCP server config, remove the `hooks` object entirely.

### 4.2 Update documentation
- Update hooks/gemini/README.md to reference new structure
- Add note about Gemini distribution repo

---

## Phase 5: Validation

### 5.1 Verify symlinks work
```bash
cd ~/Applications/claude-prompts-gemini
ls -la hooks/
ls -la server/
python3 -c "import sys; sys.path.insert(0, 'hooks/lib'); from session_state import load_session_state; print('OK')"
```

### 5.2 Test with Gemini CLI
```bash
cd ~/Applications/claude-prompts-gemini
gemini  # Should load extension and fire SessionStart hook
```

### 5.3 Verify hook events fire
```bash
GEMINI_HOOK_DEBUG=1 gemini -p ">>test_default"
cat .gemini/hook-debug.log
```

---

## Phase 6: Git Commit & Push

### 6.1 Commit Gemini distribution repo
```bash
cd ~/Applications/claude-prompts-gemini
git add .
git commit -m "Initial Gemini CLI distribution with submodule structure"
```

### 6.2 Create GitHub repo and push
```bash
gh repo create minipuft/claude-prompts-gemini --public --source=. --push
```

### 6.3 Commit cleanup in main repo
```bash
cd ~/Applications/claude-prompts-mcp
git add gemini-extension.json hooks/gemini/README.md
git commit -m "refactor(gemini): move to separate distribution repo"
```

---

## Maintenance Workflow

### Updating shared code
1. Make changes in `claude-prompts-mcp`
2. Commit and push
3. In `claude-prompts-gemini`: `git submodule update --remote`
4. Commit submodule pointer update

### Updating Gemini-specific files
1. Edit directly in `claude-prompts-gemini`
2. Commit and push

---

## Success Criteria

- [ ] Gemini CLI loads extension without errors
- [ ] All 5 hooks fire at correct events
- [ ] Symlinks resolve correctly to submodule scripts
- [ ] `hooks/hooks.json` uses proper Gemini event names
- [ ] Main repo's `gemini-extension.json` has no embedded hooks
- [ ] Both repos independently committable
