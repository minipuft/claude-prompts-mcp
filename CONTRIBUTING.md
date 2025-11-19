# Contributing to Claude Prompts MCP (Canonical)

Thank you for helping maintain the Claude Prompts MCP server. This guide consolidates our contributor expectations, operational workflows, and automation guardrails. It replaces older scattered docs (`docs/contributing.md`, legacy READMEs) so please keep it up to date whenever workflows change.

## 1. Development Environment

- **Node.js**: 16/18/20 supported. Use the version defined in `.nvmrc` (if present) or match CI.
- **npm**: Comes with Node; ensure `npm install` runs inside `server/`.
- **Git**: Required for Husky hooks and for keeping runtime-state files out of commits.

```bash
git clone https://github.com/minipuft/claude-prompts-mcp.git
cd claude-prompts-mcp/server
npm install
npm run build
```

## 2. Repo Structure (server/dist is the runtime contract)

```
repo/
├── server/
│   ├── src/            # TypeScript sources
│   ├── dist/           # Compiled runtime (reference for docs + MCP clients)
│   ├── prompts/        # Prompt registry and markdown templates
│   ├── config.json     # Runtime configuration
│   └── package.json    # Scripts + dependencies
├── docs/               # Canonical documentation set
├── plans/              # Living migration plans + guardrails
└── CONTRIBUTING.md     # This file
```

Whenever you touch runtime behavior, inspect `server/dist/**` to confirm the emitted output matches your expectations.

## 3. Git Hooks (Husky + lint-staged)

Hooks auto-install via the `prepare` script the first time you run `npm install` inside `server/`.

### Pre-commit

Runs on staged files:
1. `eslint --fix`
2. `prettier --write`
3. `npm run typecheck`

Commits are blocked if linting/formatting/type checks fail. Expect staged files to be modified automatically.

### Pre-push

Runs before every `git push` over the entire workspace:
1. `npm run typecheck`
2. `npm run lint`
3. `npm run format`
4. `npm run test:jest`
5. `npm run validate:all`

Pushes are blocked if any command fails. This keeps CI and local environments aligned.

### Emergency Bypass

Only bypass hooks to unblock CI or for emergency hotfixes. Use `HUSKY=0 git commit` or `HUSKY=0 git push`, then open a follow-up issue documenting why the bypass was required.

## 4. Available Scripts (run inside `server/`)

| Command | Description |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm run typecheck` | Strict TypeScript checks without emit. |
| `npm run lint` / `lint:fix` | ESLint validation + autofix. |
| `npm run format` / `format:fix` | Prettier checks/auto-format. |
| `npm run validate:all` | Dependency + architecture validation. |
| `npm test` / `npm run test:jest` | Jest suite (unit + integration). |
| `npm run start:stdio` / `start:sse` | Launch transports for manual testing. |

## 5. Contribution Workflow

1. Create a descriptive branch.
2. Make focused, reversible changes; respect prompts/tool guardrails from `AGENTS.md`.
3. Run tests/validations that match the area you touched (execution, gates, docs, etc.).
4. Update relevant docs (`docs/operations-guide.md`, `docs/mcp-tooling-guide.md`, etc.).
5. Stage changes and let hooks run.
6. Open a pull request with context, validation proof, and links to related plans/issues.

## 6. Coding Guidelines

- **TypeScript**: Strict mode, descriptive interfaces, prefer dependency injection over global state.
- **Runtime lifecycle**: Register new modules through the `Application` orchestrator (`server/src/runtime/`).
- **Transports**: Keep STDIO and SSE behavior in parity; mention both when updating docs.
- **Prompts**: Only modify via `prompt_manager`. See `docs/prompt-authoring-guide.md` for schema expectations.
- **Chains**: Define/edit steps via `prompt_manager`. Reference `docs/chain-workflows.md` for schema details.
- **Gates**: Add definitions under `server/src/gates/definitions/*.json` and update `docs/enhanced-gate-system.md` when behavior changes.

## 7. Testing Expectations

- **Server code**: `npm run typecheck && npm test && npm run validate:all`.
- **Transport/runtime changes**: Add targeted smoke tests (`npm run start:stdio` or `npm run start:sse`) and note results in PRs.
- **Prompt/tool changes**: Execute via MCP tools (`prompt_engine`, `prompt_manager`, `system_control`). Link output or describe validation steps.
- **Documentation-only changes**: Verify references against `server/dist/**`. If commands/scripts are mentioned, ensure they exist.

## 8. Documentation & Plans

- All docs now live under `docs/` with lifecycle tags (canonical, migrating, legacy). Consult `plans/docs-migration-plan.md` before creating new files.
- Update docs in the same change set as the code; avoid TODO piles.
- Long-running migrations belong in `plans/*.md` with checklists and blockers for the next contributor.

## 9. Prompt & Template Contributions

- Use `prompt_manager` (`create`, `update`, `modify`, `delete`, `reload`) for every change.
- Document complex prompts/chains inside Markdown files and cross-reference the relevant doc (authoring guide or chain workflows).
- Provide argument metadata (types + validation) so the runtime schema remains accurate.

## 10. Security & Dependency Hygiene

- Run `npm audit:check` when bumping dependencies; fix or document high/critical issues immediately.
- Keep `.husky/`, `.lintstagedrc.json`, `.prettierrc.json`, and ESLint configs in sync when updating lint rules.
- Never check in secrets; use environment variables for API keys (LLM integrations, etc.).

## 11. Transport-Agnostic Development

- Avoid STDIO-specific assumptions in prompts or code (e.g., `console.log` inside STDIO loops).
- SSE endpoints should expose equivalent functionality to STDIO flows. When adding a transport-specific feature, update `docs/operations-guide.md` with testing instructions.

## 12. Getting Help

- Review `AGENTS.md` for automation rules.
- Check `plans/` for ongoing migrations before touching a subsystem.
- If hooks or scripts fail unexpectedly, inspect `server/logs/` and `runtime-state/` for details, then document findings in your PR.

Thank you for keeping this guide current. If anything in here becomes outdated, fix it alongside your change so future contributors avoid drift.
