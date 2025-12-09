# Roadmap

What's next for Claude Prompts MCP.

---

## Next Up

### 🌐 Web UI for Prompt Management

**Problem**: Editing JSON/Markdown works for developers. Non-technical teammates can't participate. No visual feedback when building chains.

**Solution**: Browser-based editor over the existing MCP server. Live preview. Drag-and-drop chain builder. Hot-reload keeps everything synced.

**Expect**: Open `localhost:3000`, build a prompt visually, test it—Claude sees it immediately. Zero file editing.

**Foundation**: `prompts/hot-reload-manager.ts`, SSE transport, `prompt_manager` CRUD.

---

### 🔌 VS Code Extension

**Problem**: Context-switching kills flow. You're coding, want to run a prompt, have to open Claude Desktop or a terminal.

**Solution**: Command palette integration. Select code → run prompt on selection. Results inline.

**Expect**: `Cmd+Shift+P` → "Run Prompt: code_review" → output appears next to your code.

**Foundation**: STDIO transport works with any client. Needs a VS Code wrapper.

---

## Exploring

### 🧪 Prompt Optimization Loop

**Problem**: You don't know if a prompt is good until you run it many times. Manual A/B testing is tedious.

**Solution**: Run a prompt N times with variations. Score against gates automatically. Surface the winner.

**Expect**:

```
prompt_engine(command:">>code_review", optimize:{runs:10, gate:"quality-score"})
→ Returns best-performing variant with scores
```

**Foundation**: Gate system scores outputs. Chain sessions track runs. Missing: variation generator, scoring aggregator.

---

### 🤝 Team Workspaces

**Problem**: Prompts are local files. Sharing means copy-paste or git repos. No visibility into what your team uses.

**Solution**: Optional remote sync. Push/pull to shared workspace. Usage stats across team.

**Expect**:

```
prompt_manager(action:"push", workspace:"team-acme")
→ Local prompts sync to team library
```

**Foundation**: Local file storage, hot-reload. Missing: remote storage adapter, auth layer.

---

### 🔐 Access Control

**Problem**: All prompts visible to anyone with server access. Some contain sensitive logic.

**Solution**: Per-prompt permissions. API key scoping. Audit log.

**Expect**: Tag a prompt `private: true`—only authenticated users with the right scope can execute.

**Foundation**: Config-based settings. Missing: auth middleware, permission model.

---

## Technical Debt

| Area              | Now     | Target               |
| ----------------- | ------- | -------------------- |
| Test coverage     | ~70%    | 90%+ on core modules |
| TypeScript strict | Partial | Full strict mode     |
| Bundle size       | ~2MB    | < 1MB (tree-shaking) |

---

## Contributing

Ideas welcome. [Open an issue](https://github.com/minipuft/claude-prompts-mcp/issues) with the `enhancement` label.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for dev setup.
