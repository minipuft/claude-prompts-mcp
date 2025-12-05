# Claude Prompts MCP — Operator Handbook

This handbook trains Claude Code (and any assistant) to behave like a senior developer on this repository. Every guideline maps to the runtime currently shipping from `server/dist/**`. Treat the doc as the canonical operating agreement unless the user explicitly overrides it.

---

## 1. Mission & Scope

- **Role**: Automation/code-editing agent for the Claude Prompts MCP server.
- **Primary Goal**: Deliver safe, reviewable changes that honor MCP protocol guardrails, hot-reload expectations, and proper documentation maintenance.
- **Source of Truth**: `server/dist/**`. Always confirm behavior there before describing or modifying functionality.

---

## 2. Core Operating Principles

1. **Plan First** – Outline intent, affected modules, and validation before editing. Use MCP prompts or notes if the change is non-trivial.
2. **MCP Tooling Only** – Prompts, templates, chains, and tool descriptions must flow through MCP tools (`prompt_manager`, `prompt_engine`, `system_control`). Manual edits under `server/prompts/**` or `server/runtime-state/**` are forbidden. Tool descriptions/schemas are generated from contracts; regenerate rather than editing outputs.
3. **Framework-aware overlays** – Final tool descriptions are contract-sourced and may be rewritten by ToolDescriptionManager based on active framework/state. `config/tool-descriptions.json` is a fallback seed, not the source of truth.
4. **Methodology overlays** – Framework-specific tool descriptions are defined in methodology guides (`getToolDescriptions`). Update these when parameters or guidance change so overlays stay aligned with contracts and runtime registration.
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
| Prompts & hot reload    | `prompts/*.js`, `text-references/*.js`         | PromptManager, Converter, FileObserver, HotReloadManager. Argument tracking, conversation management. Keeps registry + text references synchronized. |
| Frameworks              | `frameworks/*.js`                              | Framework manager + state manager + methodology guides (CAGEERF/ReACT/5W1H/SCAMPER). State in `runtime-state/framework-state.json`. |
| Execution               | `mcp-tools/prompt-engine/**`, `execution/**`   | Consolidated prompt engine, symbolic command parser, chain executor, planning/validation pipeline.                                  |
| Chain sessions          | `chain-session/manager.js`                     | Persists sessions in `runtime-state/chain-sessions.json`. Integrates with conversation/text managers.                               |
| Gates                   | `gates/**`                                     | Gate loader, category extractor, guidance renderer, validation services. Utils in `gates/utils/` for formatting and guidance.      |
| Metrics & performance   | `metrics/**`, `performance/**`                 | Analytics service (used by `system_control analytics`) and performance monitor.                                                     |
| Transports & supervisor | `server/**`, `supervisor/**`                   | STDIO/SSE transport manager, API endpoints, supervisor for zero-downtime restarts.                                                  |
| Utilities               | `utils/**`                                     | Shared utilities (chain utils, error handling, resource tracking, service management).                                              |
| Tooling metadata        | `tooling/action-metadata/**`                   | Tool action definitions, parameter schemas, and usage tracking for MCP tools.                                                       |

Use these paths to verify implementation details before documenting or reasoning about behavior.

---

## 5. Command Reference (run inside `server/`)

| Command                                 | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run build`                         | Compile TypeScript → `dist/`. Required before supervisor mode or when sharing binaries. |
| `npm run typecheck`                     | Strict TS type validation.                                                              |
| `npm test` / `npm run test:unit`        | Full Jest suite. Add targeted tests when touching execution/framework/gate modules.     |
| `npm run test:watch`                    | Jest watch mode for continuous testing during development.                              |
| `npm run test:coverage`                 | Run tests with coverage report.                                                         |
| `npm run start:stdio`                   | Manual STDIO smoke test (Claude Desktop / CLI).                                         |
| `npm run start:sse`                     | Manual SSE smoke test (web clients).                                                    |
| `npm run start:verbose` / `start:debug` | Diagnose startup or transport issues.                                                   |
| `npm run lint`                          | ESLint (flat config + lifecycle plugin).                                                |
| `npm run lint:fix`                      | Auto-fix ESLint issues.                                                                 |
| `npm run validate:dependencies`         | Canonical-module checker.                                                               |
| `npm run validate:circular`             | `madge` cycle detector.                                                                 |
| `npm run validate:filesize`             | Check file size against baseline limits.                                                |
| `npm run validate:legacy`               | Verify no legacy import patterns remain.                                                |
| `npm run validate:metadata`             | Verify action-metadata inventory integrity.                                             |
| `npm run validate:all`                  | Complete validation suite (dependencies, circular, filesize, legacy, metadata).         |

Hooks in `.husky/` (repo root) run subsets automatically. Do not bypass without explicit approval.

---

## 6. Symbolic Command Language

The `prompt_engine` supports a symbolic command language for expressing complex execution flows without JSON:

| Operator | Purpose | Example |
|----------|---------|---------|
| `-->` | Chain operator (sequential execution) | `>>step1 --> >>step2 --> >>step3` |
| `@` | Framework operator (apply methodology) | `>>prompt @CAGEERF` |
| `::` | Gate operator (inline quality criteria) | `>>prompt :: quality-check` |
| `+` | Parallel operator (concurrent execution) | `>>task1 + >>task2 + >>task3` |
| `?` | Conditional operator (branching logic) | `>>check ? >>if_true : >>if_false` |

**Key Features:**
- Operators can be combined for complex workflows
- Auto-detects execution mode based on operators used
- Supports inline parameters and gate references
- See `docs/mcp-tooling-guide.md` for detailed syntax and examples

---

## 7. MCP Tool Workflow (NO direct file edits)

### `prompt_manager`

- Actions: `create`, `update`, `delete`, `list`, `inspect`, `analyze_type`, `analyze_gates`, `reload`, `guide`.
- Legacy creation aliases removed; use `create` only. `migrate_type` removed.
- Use `chain_steps` to define chains; execution type is auto-detected.
- All prompt/chain edits must go through this tool so the registry, schema validation, and hot reload stay consistent.

### `prompt_engine`

- Executes prompts and chains. Behavior is driven by command shape and `%` modifiers (`%clean`, `%guided`, `%lean`, `%framework`); no `execution_mode` override or `llm_validation` parameter.
- Unified `gates` array replaces legacy gate params; send verdicts via `gate_verdict` when resuming reviews. `chain_id`/`user_response` manage chain sessions.
- Guides (`>>guide <topic>`) surface parameter/gate usage without memorizing payloads.

### `system_control`

- Manages frameworks, retrieves status, dumps analytics, and inspects config overlays. Use it before editing framework/gate logic to confirm runtime state.

Example session:

```bash
prompt_manager(action:"create", id:"analysis_report", ...)
prompt_manager(action:"reload")
prompt_engine(command:">>analysis_report content:'Q4 metrics'", llm_validation=true)
system_control(action:"status")
```

---

## 7.1. MCP Tool Schema Maintenance Protocol

### Critical Paths for Parameter Changes

When adding or modifying MCP tool parameters, follow this mandatory workflow to prevent schema drift:

1. **Source of Truth**: `/server/tooling/contracts/*.json`
   - All parameter definitions start here
   - Include proper `status`, `compatibility`, and migration notes

2. **Regenerate Artifacts**: Run `npm run generate:contracts`
   - Generates TypeScript/JSON under `src/tooling/contracts/_generated/`
   - Generates Markdown snippets injected into `docs/mcp-tooling-guide.md`

3. **Sync Action Metadata**: Run `npm run sync:action-metadata`
   - Updates `src/tooling/action-metadata/*.json` files
   - Ensures action inventory matches contracts

4. **MCP Registration**: Ensure `src/mcp-tools/index.ts` Zod schemas align with contracts (canonical actions only); adjust handler signatures if needed.

5. **Validation**: Run full validation suite
   - `npm run validate:metadata` / `npm run validate:contracts`
   - `npm run typecheck`
   - `npm run build`
   - `npm test`

### Schema Sync Checklist

Before committing parameter changes:

- [ ] Updated contract in `tooling/contracts/*.json`
- [ ] Ran `npm run generate:contracts`
- [ ] Ran `npm run sync:action-metadata`
- [ ] **Updated MCP registration Zod schema in `mcp-tools/index.ts` if contracts changed**
- [ ] Verified with `npm run validate:metadata` and `npm run validate:contracts`
- [ ] Tested MCP tool with new parameter in Claude Desktop/CLI
- [ ] Updated relevant documentation in `docs/`

### Why This Matters

The MCP tool registration (`src/mcp-tools/index.ts`) defines what parameters Claude actually sees and can use. The contracts system generates TypeScript types and docs, but **does not** automatically update the MCP Zod schemas. Missing this step means:

- ❌ Parameter exists in contracts and docs but Claude cannot use it
- ❌ Validation passes but runtime fails
- ❌ Schema drift between source of truth and actual tool interface

### Known Schema Drift Issues

**Historical Example**: Gate parameter consolidation (v2.0.0) updated contracts, types, validation schemas, and docs, but initially forgot to update MCP registration. This meant the unified `gates` parameter was documented but unusable until the MCP schemas were manually updated.

**Prevention**: Always update MCP registration when changing parameters. Consider this the most critical step.

---

## 8. Prompt & Chain Authoring Rules

1. Follow the template structure from `docs/prompt-authoring-guide.md` (title, optional system message, `## User Message`, sections).
2. Define arguments in metadata with accurate types + validation. The runtime derives Zod schemas from these definitions.
3. Use `{{ref:path.md}}` for shared snippets; maintain references via the text reference manager.
4. For chains, provide complete `chainSteps` (IDs, dependencies, input/output mapping, optional `inlineGateIds`, `parallelGroup`, `timeout`, `retries`, `stepType`). Conditional execution uses the `?` operator in symbolic commands. Validate chains with `prompt_engine` using `force_restart`.
5. Document unique behavior inside the prompt Markdown and update docs when adding new patterns.

---

## 9. Development Loop (repeat for every task)

1. **Discover** – Read the relevant doc(s) + inspect `server/dist` modules.
2. **Design** – Outline the change, affected files, MCP tooling steps, and validations.
3. **Implement** – Make minimal diffs; use MCP tools for prompts/chains. Keep `runtime-state` out of commits (contains framework-state.json, chain-sessions.json, chain-run-registry.json, gate-system-state.json, and argument-history.json).
4. **Validate** – Run `npm run validate:all`, `npm run typecheck`, `npm test`, plus any transport smoke tests. Document skipped steps.
5. **Document** – Update `docs/` and plan files (`plans/*.md`) as needed.
6. **Review** – Summarize changes, validations, and follow-up work in the final response.

---

## 10. Debugging & Diagnostics Tips

- **Startup issues**: Run `node dist/index.js --transport=stdio --verbose --debug-startup` to trace server-root detection, config loading, and prompt registration.
- **Hot-reload failures**: Check `server/logs/mcp-server.log` for FileObserver/HotReloadManager warnings. Validate JSON/Markdown via MCP tools.
- **Chain drift**: Inspect `runtime-state/chain-sessions.json` (read-only). Resume with `prompt_engine` session IDs or restart with `force_restart=true`.
- **Gate noise**: Use `system_control analytics` to inspect gate pass/fail counts. Update gate definitions in `server/src/gates/definitions/*.json`, rebuild, and they'll be loaded from dist at runtime.

---

## 11. Optimization Backlog (suggested improvements)

1. **Doc path validator** – Script to fail CI when docs reference non-existent `server/dist` files.
2. **MCP smoke harness** – Automated CLI script to run baseline `prompt_manager/prompt_engine/system_control` commands during CI.
3. **Chain session inspector** – Developer-only tool to list/trim chain sessions for debugging.
4. **Gate definition schema check** – Validate `server/src/gates/definitions/*.json` against a schema before runtime load.
5. **Doc lifecycle badges** – Auto-sync README/doc badges with `docs/README.md` statuses to reduce manual edits.
6. **Auto-sync MCP schemas from contracts** – Generate Zod schemas from contracts to prevent schema drift (see §7.1).

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

**Testing**: Follow professional quality patterns from `/home/minipuft/Applications/CLAUDE.md#Testing_Standards`

**MCP-Specific Test Coverage**:
- Transport layer validation (STDIO/SSE)
- Nunjucks template rendering edge cases
- Hot-reload file watching and registry updates
- MCP protocol compliance (request/response schemas)
- Framework system behavior (switching, state persistence)
- Gate validation and enforcement
- Chain session management and resumption
- Symbolic command parsing and execution
- Error handling and recovery paths

**Test Execution Requirements**:
- `npm test` must pass before any commit touching execution/framework/gate modules
- `npm run test:coverage` for baseline coverage checks (target: >80%)
- `npm run test:watch` during active development for fast feedback
- Add targeted tests when modifying core subsystems (see Architecture Cheat Sheet §4)

**Environment Variables**: `MCP_SERVER_ROOT` (override server root, recommended for Claude Desktop), `MCP_PROMPTS_CONFIG_PATH` (direct path to prompts config, bypasses root detection)

**Lifecycle Management**: For refactoring and migration work, refer to `~/.claude/REFACTORING.md` domain rules for universal lifecycle state tagging, module boundary enforcement, and deletion criteria patterns.

---

By following this handbook, Claude Code behaves like a senior developer: planning first, aligning with the compiled runtime, respecting MCP tooling, validating thoroughly, and keeping documentation synchronized.
