# Roadmap

> Status: canonical

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

| Area              | Now     | Target               | Plan |
| ----------------- | ------- | -------------------- | ---- |
| Test coverage     | Unit only | Unit + Integration + E2E | [test-modernization-roadmap](../server/plans/test-modernization-roadmap.md) |
| Coverage enforcement | None | 80% threshold | [test-modernization-roadmap](../server/plans/test-modernization-roadmap.md) |
| TypeScript strict | Full    | Keep strict enabled  | - |
| Bundle size       | ~2MB    | < 1MB (tree-shaking) | - |

### CI / Quality Gates (Remaining Work)

- [x] Enable strict TypeScript semantics in `server/tsconfig.json`: `noPropertyAccessFromIndexSignature`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- [x] Add a lint ratchet strategy: keep `tests/**` excluded initially, fail CI on new violations (`server/.eslint-ratchet-baseline.json`), and tighten scope once baseline is reduced.
- [x] Align core CI gates with server scripts: `npm run typecheck` + `npm run lint:ratchet` + tests in CI/PR workflows.
- [x] Ensure build output is exercised in CI: run `npm run build` and `npm run start:test` across the Node matrix.
- [x] Add toolchain pinning for developers: commit `.nvmrc` + `.node-version` aligned with `server/package.json#engines`.
- [x] Align rule docs with the new workflow: update `AGENTS.md` and `CLAUDE.md` to match scripts, docs taxonomy, and the ESLint ratchet approach.
- [ ] Ensure PR workflows run the architecture gates: `npm run validate:arch` and decide whether warnings should fail the build once cycles are resolved.
- [x] Ensure generated artifacts stay in sync in CI: `npm run validate:contracts` and `npm run validate:metadata`.
- [x] Decide support policy and enforce via CI matrix (Node versions / OS): CI verifies Node 18→24 on `ubuntu-latest`. (OS matrix can be added later if scripts are made cross-platform.)

### Test Modernization

See [test-modernization-roadmap.md](../plans/test-modernization-roadmap.md) for the comprehensive 6-phase plan:

- [ ] **Phase 1**: Coverage infrastructure (thresholds, CI, helpers)
- [ ] **Phase 2**: Test classification audit & migration (8 sub-phases analyzing all 67 test files)
- [ ] **Phase 3**: Missing unit test coverage (8 subsystems without tests)
- [ ] **Phase 4**: Integration test suite (MCP protocol, chains, hot-reload, pipeline)
- [ ] **Phase 5**: E2E test suite (STDIO/SSE transports, MCP compliance)
- [ ] **Phase 6**: Test quality improvements (remove implementation detail tests, consolidation)

---

## Contributing

Ideas welcome. [Open an issue](https://github.com/minipuft/claude-prompts-mcp/issues) with the `enhancement` label.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for dev setup.
