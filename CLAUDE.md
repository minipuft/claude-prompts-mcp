# Claude Prompts MCP — Operator Handbook

This handbook trains Claude Code (and any assistant) to behave like a senior developer on this repository. Every guideline maps to the runtime currently shipping from `server/dist/**`. Treat the doc as the canonical operating agreement unless the user explicitly overrides it.

---

## 1. Mission & Scope

- **Role**: Automation/code-editing agent for the Claude Prompts MCP server.
- **Primary Goal**: Deliver safe, reviewable changes that honor MCP protocol guardrails, hot-reload expectations, and the documentation lifecycle described in `plans/docs-migration-plan.md`.
- **Source of Truth**: `server/dist/**`. Always confirm behavior there before describing or modifying functionality.

---

## 2. Core Operating Principles

1. **Plan First** – Outline intent, affected modules, and validation before editing. Use MCP prompts or notes if the change is non-trivial.
2. **MCP Tooling Only** – Prompts, templates, chains, and tool descriptions must flow through MCP tools (`prompt_manager`, `prompt_engine`, `system_control`). Manual edits under `server/prompts/**` or `server/runtime-state/**` are forbidden.
3. **Transport Parity** – Any runtime change must work in STDIO and SSE. Mention transport implications in code reviews and docs.
4. **Docs/Code Lockstep** – When code or behavior changes, update the relevant doc in `docs/` (see list below) and adjust lifecycle tags in `docs/README.md` if needed.
5. **Validation Discipline** – `npm run validate:all`, `npm run typecheck`, and `npm test` are mandatory gates when touching execution, runtime, frameworks, gates, or MCP tools. Document any skipped command with justification.
6. **Reversibility** – Prefer small, atomic diffs. Never delete “legacy” code paths without checking the migration plan.

---

## 3. Documentation Map (Use Before Coding)

| Topic                          | Doc                              |
| ------------------------------ | -------------------------------- |
| Architecture & runtime phases  | `docs/architecture.md`           |
| Operations & transports        | `docs/operations-guide.md`       |
| MCP tooling workflows          | `docs/mcp-tooling-guide.md`      |
| Prompt/template authoring      | `docs/prompt-authoring-guide.md` |
| Chain schema & troubleshooting | `docs/chain-workflows.md`        |
| Gate system                    | `docs/enhanced-gate-system.md`   |
| Release highlights             | `docs/release-notes.md`          |
| Docs lifecycle overview        | `docs/README.md`                 |

Always read the doc relevant to your task before editing files. Update those docs when behavior changes.

---

## 4. Architecture Cheat Sheet (matched to `server/dist/**`)

| Subsystem               | Dist Path                                      | Notes                                                                                                                               |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Runtime orchestrator    | `runtime/application.js`, `runtime/startup.js` | Four-phase startup (foundation → data → modules → launch). Manages config, logging, text references, transports.                    |
| Prompts & hot reload    | `prompts/*.js`, `text-references/*.js`         | PromptManager, Converter, FileObserver, HotReloadManager. Keeps registry + text references synchronized.                            |
| Frameworks              | `frameworks/*.js`                              | Framework manager + state manager + methodology guides (CAGEERF/ReACT/5W1H/SCAMPER). State in `runtime-state/framework-state.json`. |
| Execution               | `mcp-tools/prompt-engine/**`, `execution/**`   | Consolidated prompt engine, template processor, chain executor, planning/validation pipeline.                                       |
| Chain sessions          | `chain-session/manager.js`                     | Persists sessions in `runtime-state/chain-sessions.json`. Integrates with conversation/text managers.                               |
| Gates                   | `gates/**`                                     | Gate loader, category extractor, guidance renderer, validation services. Five-level precedence.                                     |
| Metrics & performance   | `metrics/**`, `performance/**`                 | Analytics service (used by `system_control analytics`) and performance monitor.                                                     |
| Transports & supervisor | `server/**`, `supervisor/**`                   | STDIO/SSE transport manager, API endpoints, supervisor for zero-downtime restarts.                                                  |

Use these paths to verify implementation details before documenting or reasoning about behavior.

---

## 5. Command Reference (run inside `server/`)

| Command                                 | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run build`                         | Compile TypeScript → `dist/`. Required before supervisor mode or when sharing binaries. |
| `npm run typecheck`                     | Strict TS type validation.                                                              |
| `npm test` / `npm run test:jest`        | Full Jest suite. Add targeted tests when touching execution/framework/gate modules.     |
| `npm run start:stdio`                   | Manual STDIO smoke test (Claude Desktop / CLI).                                         |
| `npm run start:sse`                     | Manual SSE smoke test (web clients).                                                    |
| `npm run start:verbose` / `start:debug` | Diagnose startup or transport issues.                                                   |
| `npm run validate:lint`                 | ESLint (flat config + lifecycle plugin) + Prettier.                                     |
| `npm run validate:dependencies`         | Canonical-module checker.                                                               |
| `npm run validate:circular`             | `madge` cycle detector.                                                                 |
| `npm run validate:all`                  | Combined dependency + circular checks. Run alongside `typecheck` and tests.             |

Hooks in `.husky/` run subsets automatically. Do not bypass without explicit approval.

---

## 6. MCP Tool Workflow (NO direct file edits)

### `prompt_manager`

- Actions: `create`, `create_prompt`, `create_template`, `update`, `modify`, `delete`, `migrate_type`, `list`, `analyze_type`, `reload`.
- Use `execution_hint` or explicit chain metadata to steer type detection.
- All prompt/chains edits must go through this tool so the registry, schema validation, and hot reload stay consistent.

### `prompt_engine`

- Executes prompts/templates/chains. Use `execution_mode` to force prompt/template/chain, `gate_validation:true` to enable gates, and `llm_driven_execution:true` for LLM-managed chains.
- Chain URIs (`chain://chain_id?force_restart=true`) resume or restart sessions.

### `system_control`

- Manages frameworks, retrieves status, dumps analytics, and inspects config overlays. Use it before editing framework/gate logic to confirm runtime state.

Example session:

```bash
prompt_manager(action:"create", id:"analysis_report", execution_hint:"template", ...)
prompt_manager(action:"reload")
prompt_engine(command:">>analysis_report content:'Q4 metrics'", gate_validation=true)
system_control(action:"status")
```

---

## 7. Prompt & Chain Authoring Rules

1. Follow the template structure from `docs/prompt-authoring-guide.md` (title, optional system message, `## User Message`, sections).
2. Define arguments in metadata with accurate types + validation. The runtime derives Zod schemas from these definitions.
3. Use `{{ref:path.md}}` for shared snippets; maintain references via the text reference manager.
4. For chains, provide complete `chainSteps` (IDs, dependencies, input/output mapping, optional `conditionalExecution`, `inlineGateIds`). Validate with `prompt_engine` using `force_restart`.
5. Document unique behavior inside the prompt Markdown and update docs when adding new patterns.

---

## 8. Development Loop (repeat for every task)

1. **Discover** – Read the relevant doc(s) + inspect `server/dist` modules.
2. **Design** – Outline the change, affected files, MCP tooling steps, and validations.
3. **Implement** – Make minimal diffs; use MCP tools for prompts/chains. Keep `runtime-state` out of commits.
4. **Validate** – Run `npm run validate:all`, `npm run typecheck`, `npm test`, plus any transport smoke tests. Document skipped steps.
5. **Document** – Update `docs/` and plan files (`plans/*.md`) as needed.
6. **Review** – Summarize changes, validations, and follow-up work in the final response.

---

## 9. Debugging & Diagnostics Tips

- **Startup issues**: Run `node dist/index.js --transport=stdio --verbose --debug-startup` to trace server-root detection, config loading, and prompt registration.
- **Hot-reload failures**: Check `server/logs/` for FileObserver/HotReloadManager warnings. Validate JSON/Markdown via MCP tools.
- **Chain drift**: Inspect `runtime-state/chain-sessions.json` (read-only). Resume with `prompt_engine` session IDs or restart with `force_restart=true`.
- **Gate noise**: Use `system_control analytics` to inspect gate pass/fail counts. Update definitions under `server/src/gates/definitions/*.json` and rebuild.

---

## 10. Optimization Backlog (suggested improvements)

1. **Doc path validator** – Script to fail CI when docs reference non-existent `server/dist` files.
2. **MCP smoke harness** – Automated CLI script to run baseline `prompt_manager/prompt_engine/system_control` commands during CI.
3. **Chain session inspector** – Developer-only tool to list/trim chain sessions for debugging.
4. **Gate definition schema check** – Validate `server/src/gates/definitions/*.json` against a schema before runtime load.
5. **Doc lifecycle badges** – Auto-sync README/doc badges with `docs/README.md` statuses to reduce manual edits.

Open follow-up tasks in `plans/` when implementing any of the above.

### Key Development Guidelines

**Core Rules**: ONE primary implementation per functional area, explicit deprecation required before adding new systems

**Dependency Direction**: Clear hierarchy (no bidirectional imports), use dependency injection/event patterns instead of circular imports

**Consolidation Over Addition**: Enhance existing systems vs creating new ones, require architectural justification for parallel systems, verify no duplicate functionality

**Framework Development**: Methodology guides = single source of truth (never hard-code), dynamic generation from guide metadata, guide-driven enhancements (system prompts, quality gates, validation)

**Domain Cohesion**: Framework logic in `/frameworks`, separate stateless (manager) from stateful (state manager), clear separation (analysis WHAT vs methodology HOW), explicit integration points (`/integration`)

**Methodology Guide Development**: Implement `IMethodologyGuide` interface (all required methods: `guidePromptCreation`, `guideTemplateProcessing`, `guideExecutionSteps`, `enhanceWithMethodology`, `validateMethodologyCompliance`), framework-specific quality gates, template enhancement suggestions, methodology validation

**Framework Integration**: No direct coupling (integrate via framework manager), event-driven communication, semantic analysis coordination (informed by, not dependent on), gates adapt to framework (remain framework-agnostic in core)

**Configuration**: Env vars for path overrides (`MCP_SERVER_ROOT`, `MCP_PROMPTS_CONFIG_PATH`), separate server/prompts config, modular imports, absolute paths for Claude Desktop

**Error Handling**: Comprehensive boundaries (all orchestration levels), structured logging (verbose/quiet modes), meaningful error messages (diagnostics), rollback mechanisms (startup failures)

**Testing**: Transport layer (STDIO/SSE), Nunjucks template rendering, hot-reloading, MCP protocol compliance, framework system validation, framework switching, state persistence

**Environment Variables**: `MCP_SERVER_ROOT` (override server root, recommended for Claude Desktop), `MCP_PROMPTS_CONFIG_PATH` (direct path to prompts config, bypasses root detection)

**Lifecycle Management**: For refactoring and migration work, refer to `~/.claude/REFACTORING.md` domain rules for universal lifecycle state tagging, module boundary enforcement, and deletion criteria patterns.

---

By following this handbook, Claude Code behaves like a senior developer: planning first, aligning with the compiled runtime, respecting MCP tooling, validating thoroughly, and keeping documentation synchronized.
