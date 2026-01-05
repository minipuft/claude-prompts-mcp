# Claude Prompts MCP — Operator Handbook

This handbook trains Claude Code (and any assistant) to behave like a senior developer on this repository. Every guideline maps to the runtime currently shipping from `server/dist/**`. Treat the doc as the canonical operating agreement unless the user explicitly overrides it.

---

## 1. Mission & Scope

- **Role**: Automation/code-editing agent for the Claude Prompts MCP server.
- **Primary Goal**: Deliver safe, reviewable changes that honor MCP protocol guardrails, hot-reload expectations, and proper documentation maintenance.
- **Source of Truth**: `server/dist/**`. Always confirm behavior there before describing or modifying functionality.

### Runtime Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | `>=18.18.0` | CI verifies 18→24. Local dev defaults to Node 24 via `.nvmrc` / `.node-version`. |
| TypeScript | `^5.9.3` | Strict mode enabled. |
| Jest | `^30.0.0` | With `ts-jest` for ESM support. |
| Express | `^4.18.2` | Migration to v5 pending (high risk). |
| Zod | `^3.22.4` | Migration to v4 pending (high risk). |
| MCP SDK | `^1.18.1` | `@modelcontextprotocol/sdk` for protocol compliance. |

---

## 2. Core Operating Principles

1. **Plan First** – Outline intent, affected modules, and validation before editing. Use MCP prompts or notes if the change is non-trivial.
2. **MCP Tooling Only** – Prompts, templates, chains, and tool descriptions must flow through MCP tools (`resource_manager`, `prompt_engine`, `system_control`). Manual edits under `server/prompts/**` or `server/runtime-state/**` are forbidden. Tool descriptions and Zod schemas are generated from contracts; run `npm run generate:contracts` rather than editing outputs.
3. **Contracts as SSOT** – Tool descriptions and MCP parameter schemas are generated from `tooling/contracts/*.json` to `src/tooling/contracts/_generated/`. ToolDescriptionManager loads from generated `tool-descriptions.contracts.json` (and `tool-descriptions.json` exists only as a backwards-compatible alias). MCP registration imports generated Zod schemas from `mcp-schemas.ts`. Methodology overlays remain framework-aware.
4. **Methodology overlays** – Framework-specific tool descriptions are defined in methodology guides (`getToolDescriptions`). Update these when parameters or guidance change so overlays stay aligned with contracts and runtime registration.
3. **Transport Parity** – Any runtime change must work in STDIO and SSE. Mention transport implications in code reviews and docs.
4. **Docs/Code Lockstep** – When code or behavior changes, update the relevant doc in `docs/` (see list below) and adjust lifecycle tags in `docs/README.md` if needed.
5. **Validation Discipline** – For most changes, treat `npm run typecheck`, `npm run lint:ratchet`, and `npm run test:ci` as the minimum gates. Add `npm run validate:arch` when touching module boundaries. Run `npm run validate:all` intentionally (it includes the full ESLint pass and may fail until lint debt is reduced). Document any skipped command with justification.
6. **Reversibility** – Prefer small, atomic diffs. Never delete “legacy” code paths without checking the migration plan.

---

## 3. Documentation Map (Use Before Coding)

| Topic                          | Doc                              |
| ------------------------------ | -------------------------------- |
| Architecture & runtime phases  | `docs/architecture/overview.md`  |
| MCP tooling workflows          | `docs/reference/mcp-tools.md`    |
| Prompt/template authoring      | `docs/guides/prompt-authoring-guide.md` |
| Script tools & auto-execute    | `docs/guides/script-tools.md`    |
| Chains                         | `docs/guides/chains.md`          |
| Gate system                    | `docs/guides/gates.md`           |
| Troubleshooting                | `docs/guides/troubleshooting.md` |
| Release highlights             | `CHANGELOG.md`                   |
| Docs lifecycle overview        | `docs/README.md`                 |

Always read the doc relevant to your task before editing files. Update those docs when behavior changes.

---

## 3.1. Rules Reference (Auto-Loaded)

Claude Code automatically loads rules from `.claude/rules/` based on file paths. These rules are **auto-loaded** when working on matching files—no explicit invocation needed.

| Rule | Scope | Purpose |
|------|-------|---------|
| `orchestration-layers.md` | `stages/**/*.ts`, `**/core/*.ts`, `**/*handler*.ts` | Size limits, domain ownership matrix, service extraction |
| `state-persistence.md` | `*-state-manager.ts`, `chain-session/**`, `runtime-state/**` | Await persistence, throw on failure, no silent state failures |
| `async-error-handling.md` | `server/src/**/*.ts` | Error propagation, no double-catch, check return values |
| `mcp-contracts.md` | `tooling/contracts/**`, `mcp-tools/**` | Contract SSOT, regeneration workflow, never edit generated files |

**Rule loading**: Rules activate automatically when you read/edit files matching their `paths` frontmatter.

---

## 4. Architecture Cheat Sheet (matched to `server/dist/**`)

| Subsystem               | Dist Path                                      | Notes                                                                                                                               |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Runtime orchestrator    | `runtime/application.js`, `runtime/startup.js` | Four-phase startup (foundation → data → modules → launch). Manages config, logging, text references, transports.                    |
| Prompts & hot reload    | `prompts/*.js`, `text-references/*.js`         | PromptManager, Converter, FileObserver, HotReloadManager. Argument tracking, conversation management. Keeps registry + text references synchronized. |
| Frameworks              | `frameworks/*.js`                              | FrameworkManager + FrameworkStateManager + MethodologyRegistry. Methodologies in `server/methodologies/*/methodology.yaml`. State in `runtime-state/framework-state.json`. |
| Execution               | `mcp-tools/prompt-engine/**`, `execution/**`   | Consolidated prompt engine, symbolic command parser, chain executor, planning/validation pipeline (stages 00-11).                   |
| Pipeline state          | `execution/pipeline/state/**`                  | GateAccumulator, DiagnosticAccumulator, FrameworkDecisionAuthority. Centralized state for pipeline stages.                          |
| Injection decisions     | `execution/pipeline/decisions/injection/**`    | InjectionDecisionService with 7-level hierarchy. Controls system-prompt, gate-guidance, style-guidance injection.                   |
| Chain sessions          | `chain-session/manager.js`                     | Persists sessions in `runtime-state/chain-sessions.json`. Integrates with conversation/text managers.                               |
| Gates                   | `gates/**`                                     | GateManager orchestrates GateRegistry, GateDefinitionLoader. Definitions in `server/gates/*/gate.yaml` + `guidance.md`. Hot-reloaded. |
| Styles                  | `styles/**`                                    | StyleManager orchestrates StyleDefinitionLoader. Definitions in `server/styles/*/style.yaml` + `guidance.md`. Hot-reloaded.         |
| Metrics & performance   | `metrics/**`, `performance/**`                 | MetricsCollector (used by `system_control analytics`) and performance monitor.                                                      |
| Transports & supervisor | `server/**`, `supervisor/**`                   | STDIO/SSE transport manager, API endpoints, supervisor for zero-downtime restarts.                                                  |
| Utilities               | `utils/**`                                     | Shared utilities (chain utils, error handling, resource tracking, service management).                                              |
| Tooling contracts       | `tooling/contracts/**`                         | Source of truth for MCP parameters. Run `npm run generate:contracts` to regenerate schemas.                                         |

Use these paths to verify implementation details before documenting or reasoning about behavior.

---

## 5. Command Reference (run inside `server/`)

| Command                                 | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run build`                         | Compile TypeScript → `dist/`. Required before supervisor mode or when sharing binaries. |
| `npm run typecheck`                     | Strict TS type validation.                                                              |
| `npm run typecheck:tests`               | Typecheck tests (separate project config).                                              |
| `npm test` / `npm run test:unit`        | Full Jest suite. Add targeted tests when touching execution/framework/gate modules.     |
| `npm run test:watch`                    | Jest watch mode for continuous testing during development.                              |
| `npm run test:coverage`                 | Run tests with coverage report.                                                         |
| `npm run start:stdio`                   | Manual STDIO smoke test (Claude Desktop / CLI).                                         |
| `npm run start:sse`                     | Manual SSE smoke test (web clients).                                                    |
| `npm run start:verbose` / `start:debug` | Diagnose startup or transport issues.                                                   |
| `npm run lint`                          | Full ESLint pass (may fail until lint debt is reduced).                                 |
| `npm run lint:fix`                      | Auto-fix ESLint issues.                                                                 |
| `npm run lint:ratchet`                  | Fail if ESLint violations increased vs baseline.                                        |
| `npm run lint:ratchet:baseline`         | Update baseline (intentional + review required).                                        |
| `npm run lint:staged`                   | Lint-staged runner (used by pre-commit).                                                |
| `npm run generate:contracts`            | Regenerate MCP schemas/descriptions from contracts.                                     |
| `npm run validate:contracts`            | Verify generated contract artifacts are in sync.                                        |
| `npm run validate:methodologies`        | Validate methodology YAMLs and schema expectations.                                     |
| `npm run validate:arch`                 | Dependency Cruiser architecture rules for `src/`.                                       |
| `npm run validate:filesize`             | Check file size against baseline limits.                                                |
| `npm run validate:metadata`             | Verify action-metadata inventory integrity.                                             |
| `npm run validate:all`                  | Full validation suite (includes full ESLint, architecture, metadata, contracts, etc.).  |

Hooks in `.husky/` (repo root) run subsets automatically. Do not bypass without explicit approval.

---

## 6. Symbolic Command Language

The `prompt_engine` supports a symbolic command language for expressing complex execution flows without JSON:

| Operator | Purpose | Example | Status |
|----------|---------|---------|--------|
| `-->` | Chain operator (sequential execution) | `>>step1 --> >>step2 --> >>step3` | ✅ Implemented |
| `@` | Framework operator (apply methodology) | `>>prompt @CAGEERF` | ✅ Implemented |
| `::` | Gate operator (inline quality criteria) | `>>prompt :: 'criteria text'` | ✅ Implemented |
| `#` | Style operator (response formatting) | `#analytical >>report` | ✅ Implemented |
| `+` | Parallel operator (concurrent execution) | `>>task1 + >>task2 + >>task3` | 🔮 Reserved |
| `?` | Conditional operator (branching logic) | `>>p1 ? "cond" : >>p2` | 🔮 Reserved |

**Key Features:**
- Operators can be combined for complex workflows
- `>>` prefix is optional (automatically normalized)
- Supports inline parameters: `>>prompt key:'value'`
- See `docs/reference/mcp-tools.md` for detailed syntax and examples

---

## 7. MCP Tool Workflow (NO direct file edits)

### `resource_manager`

- **Unified CRUD** for prompts, gates, and methodologies via `resource_type` parameter.
- Actions: `create`, `update`, `delete`, `list`, `inspect`, `reload` (all types), plus `analyze_type`, `analyze_gates`, `guide` (prompt only), and `switch` (methodology only).
- Use `chain_steps` to define chains; execution type is auto-detected.
- All resource edits must go through this tool so the registry, schema validation, and hot reload stay consistent.

### `prompt_engine`

- Executes prompts and chains. Behavior is driven by command shape and `%` modifiers (`%clean`, `%guided`, `%lean`, `%framework`); no `execution_mode` override or `llm_validation` parameter.
- Unified `gates` array replaces legacy gate params; send verdicts via `gate_verdict` when resuming reviews. `chain_id`/`user_response` manage chain sessions.
- Guides (`>>guide <topic>`) surface parameter/gate usage without memorizing payloads.

### `system_control`

- Manages frameworks, retrieves status, dumps analytics, and inspects config overlays. Use it before editing framework/gate logic to confirm runtime state.

Example session:

```bash
resource_manager(resource_type:"prompt", action:"create", id:"analysis_report", ...)
resource_manager(resource_type:"prompt", action:"reload")
prompt_engine(command:">>analysis_report content:'Q4 metrics' --> ")
system_control(action:"status")
```

**Note**: `llm_validation` parameter is **blocked** (throws error). Use `gates` parameter for quality validation.

---

## 7.1. MCP Tool Schema Maintenance

> **Full protocol**: See `.claude/rules/mcp-contracts.md` (auto-loaded when editing contracts or MCP tools)

**Quick reference**:
1. Edit source: `tooling/contracts/*.json`
2. Regenerate: `npm run generate:contracts`
3. Validate: `npm run typecheck && npm run build && npm test`

**Never edit files in `_generated/`** — they're auto-overwritten.

---

## 8. Prompt & Chain Authoring Rules

1. Follow the template structure from `docs/guides/prompt-authoring-guide.md` (title, optional system message, `## User Message`, sections).
2. Define arguments in metadata with accurate types + validation. The runtime derives Zod schemas from these definitions.
3. Use `{{ref:path.md}}` for shared snippets; maintain references via the text reference manager.
4. For chains, provide complete `chainSteps` (IDs, dependencies, input/output mapping, optional `inlineGateIds`, `parallelGroup`, `timeout`, `retries`, `stepType`). Conditional execution uses the `?` operator in symbolic commands. Validate chains with `prompt_engine` using `force_restart`.
5. Document unique behavior inside the prompt Markdown and update docs when adding new patterns.

---

## 9. Development Loop (repeat for every task)

1. **Discover** – Read the relevant doc(s) + inspect `server/dist` modules.
2. **Design** – Outline the change, affected files, MCP tooling steps, and validations.
3. **Implement** – Make minimal diffs; use MCP tools for prompts/chains. Keep `runtime-state` out of commits (contains framework-state.json, chain-sessions.json, chain-run-registry.json, gate-system-state.json, and argument-history.json).
4. **Validate** – Run `npm run typecheck`, `npm run lint:ratchet`, and tests:
   - **New feature?** → `npm run test:integration` FIRST, then `npm run test:unit`
   - **Bug fix/refactor?** → `npm run test:ci` (unit tests sufficient)
   - Add `npm run validate:arch` when touching module boundaries. Run `npm run validate:all` intentionally (full suite). Document skipped steps.
5. **Document** – Use the Doc Update Checklist below. Skip only with explicit justification.
6. **Review** – Summarize changes, validations, and follow-up work in the final response.

### Doc Update Checklist (MANDATORY for Step 5)

| If you changed... | Then update... | Skip justification |
|-------------------|----------------|-------------------|
| MCP tool parameters/behavior | `docs/reference/mcp-tools.md` | Parameter is internal-only |
| Pipeline stages or execution flow | `docs/architecture/overview.md` | Refactor without behavior change |
| Prompt/chain schema or authoring patterns | `docs/guides/prompt-authoring-guide.md` | - |
| Chain step mapping, dependencies, or session handling | `docs/guides/chains.md` | - |
| Gate definitions, activation rules, or enforcement | `docs/guides/gates.md` | - |
| CLI flags, env vars, or config options | `docs/reference/mcp-tools.md` + README.md | - |
| Error messages or recovery flows | `docs/guides/troubleshooting.md` | Trivial wording fix |
| Public API or breaking changes | `CHANGELOG.md` (Unreleased section) | - |
| Test structure or coverage patterns | `plans/test-modernization-roadmap.md` | - |

**Default**: If uncertain whether a doc needs updating, update it. Stale docs cost more than redundant updates.

### Test Update Checklist (MANDATORY for Step 4)

| If you added... | Then write... | Location |
|-----------------|---------------|----------|
| New feature (new module/capability) | Integration test FIRST | `tests/integration/` |
| Complex edge cases | Unit tests | `tests/unit/` |
| Critical user workflow | E2E test | `tests/e2e/` |
| Bug fix | Unit test reproducing the bug | `tests/unit/` |

**Anti-pattern**: Writing unit tests only for new features, then forgetting integration tests.

---

## 10. Release & Changelog Workflow

This project uses [Keep a Changelog](https://keepachangelog.com/) format. The changelog lives at `CHANGELOG.md` in the repo root.

### Development Cycle

1. **During development**: Add entries to `[Unreleased]` section as you work
   ```markdown
   ## [Unreleased]

   ### Added
   - New feature X

   ### Fixed
   - Bug in Y
   ```

2. **When publishing to NPM**: Move `[Unreleased]` items to a new version section
   ```markdown
   ## [Unreleased]

   ## [1.0.2] - 2025-12-07

   ### Added
   - New feature X

   ### Fixed
   - Bug in Y
   ```

3. **Create git tag**: After publishing, tag the release
   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   ```

### Entry Categories

Use these standard categories (in order):

| Category | When to Use |
|----------|-------------|
| `Added` | New features |
| `Changed` | Changes in existing functionality |
| `Deprecated` | Soon-to-be removed features |
| `Removed` | Removed features |
| `Fixed` | Bug fixes |
| `Security` | Vulnerability fixes |

### NPM Package

- **Package name**: `claude-prompts`
- **Registry**: https://www.npmjs.com/package/claude-prompts
- **Publish from**: `server/` directory

```bash
cd server
npm version patch  # or minor/major
npm publish
```

### Comparison Links

Keep the footer links updated for GitHub diff navigation:

```markdown
[Unreleased]: https://github.com/minipuft/claude-prompts-mcp/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/minipuft/claude-prompts-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/minipuft/claude-prompts-mcp/releases/tag/v1.0.0
```

---

## 11. Debugging & Diagnostics Tips

- **Startup issues**: Run `node dist/index.js --transport=stdio --verbose --debug-startup` to trace server-root detection, config loading, and prompt registration.
- **Hot-reload failures**: Check `server/logs/mcp-server.log` for FileObserver/HotReloadManager warnings. Validate JSON/Markdown via MCP tools.
- **Chain drift**: Inspect `runtime-state/chain-sessions.json` (read-only). Resume with `chain_id` or restart with `force_restart=true`.
- **Gate issues**: Use `system_control(action:"gates", operation:"list")` to inspect gates. Edit definitions in `server/gates/{id}/gate.yaml` (hot-reloaded automatically).

---

## 12. Optimization Backlog (suggested improvements)

1. **Doc path validator** – Script to fail CI when docs reference non-existent `server/dist` files.
2. **MCP smoke harness** – Automated CLI script to run baseline `resource_manager/prompt_engine/system_control` commands during CI.
3. **Chain session inspector** – Developer-only tool to list/trim chain sessions for debugging.
4. **Doc lifecycle badges** – Auto-sync README/doc badges with `docs/README.md` statuses to reduce manual edits.

Open follow-up tasks in `plans/` when implementing any of the above.

---

## 13. Critical Architecture Patterns (Remember Across Sessions)

### ExecutionContext is Ephemeral

```
Request 1:                    Request 2:
┌─────────────────────┐      ┌─────────────────────┐
│ new ExecutionContext│      │ new ExecutionContext│
│ context.state = {}  │      │ context.state = {}  │ ← Fresh instance
└─────────────────────┘      └─────────────────────┘
         ↓                            ↓
    [Pipeline runs]             [Pipeline runs]
         ↓                            ↓
    [GC'd after response]       [GC'd after response]
```

**Never** store state in ExecutionContext expecting it to persist between requests. Use `runtime-state/*.json` files for persistence.

### Injection Control System

Three injection types, each independently controlled:

| Type | What It Adds | Default (Chains) |
|------|--------------|------------------|
| `system-prompt` | Framework methodology (CAGEERF, ReACT) | Every 2 steps |
| `gate-guidance` | Quality validation criteria | Every step |
| `style-guidance` | Response formatting | First step only |

**7-Level Resolution Hierarchy** (first match wins):
```
Modifier → Runtime Override → Step Config → Chain Config → Category Config → Global Config → System Default
```

**Modifiers**: `%clean` (skip all), `%lean` (gates only), `%guided` (force all), `%framework` (methodology only)

### Gate System Structure

```
server/gates/
├── {gate-id}/
│   ├── gate.yaml      # Configuration (id, name, activation, criteria)
│   └── guidance.md    # Guidance content (inlined at load time)
```

Gates are hot-reloaded. No server restart needed after editing.

### Methodology System Structure

```
server/methodologies/
├── {methodology-id}/
│   ├── methodology.yaml   # Configuration (name, description, enabled)
│   ├── phases.yaml        # Phase definitions
│   └── system-prompt.md   # Injected guidance content
```

### Pipeline Stages (00-11)

| Stage | Purpose |
|-------|---------|
| 00 | Dependency injection, request normalization |
| 01 | Command parsing (symbolic → structured) |
| 02 | Inline gate extraction |
| 03 | Prompt resolution |
| 04 | Execution planning |
| 05 | Gate enhancement |
| 06 | Framework injection |
| 06a | Judge selection (if `%judge`) |
| 06b | Prompt guidance |
| 07 | Session management |
| 07b | Injection control |
| 08 | Response capture |
| 09 | Execution |
| 10 | Formatting |
| 11 | Call-to-action |

### Pipeline Stage Boundaries (ENFORCED)

> **Full rules**: See `.claude/rules/orchestration-layers.md` (auto-loaded when editing stages/handlers)

**Key limits**:
- Stage file size: **150 lines max** → Extract to service if exceeded
- Helper methods in stages: **0** → All logic goes to services
- Domain logic: **Forbidden** → Stages orchestrate, services contain logic

**Quick ownership reference**: Gates → `GateManager`, Frameworks → `FrameworkManager`, Prompts → `PromptRegistry`, Injection → `InjectionDecisionService`, Styles → `StyleManager`. Full matrix in the rule file.

> **Note**: Async error handling, orchestration layer, and state persistence rules are defined in `.claude/rules/` and auto-loaded by Claude Code based on file paths.

### Blocked/Deprecated Parameters

| Parameter | Status | Alternative |
|-----------|--------|-------------|
| `session_id` | **BLOCKED** | Use `chain_id` |
| `execution_mode` | **REMOVED** | Auto-detected from command |

---

### Key Development Guidelines

**Core Rules**: ONE primary implementation per functional area, explicit deprecation required before adding new systems

**Dependency Direction**: Clear hierarchy (no bidirectional imports), use dependency injection/event patterns instead of circular imports

**Consolidation Over Addition**: Enhance existing systems vs creating new ones, require architectural justification for parallel systems, verify no duplicate functionality

**MCP Contract Development (CRITICAL)**: When adding MCP tool parameters:
1. **Verify upstream first** - Check what service/manager layers expect (names and types)
2. **Use canonical names** - Contract params must match manager params exactly (no hidden router transformations)
3. **Type consistency** - Contract type must match service type (`number` vs `string` matters)
4. **Layer alignment** - Contract → Generated → Types → Router → Manager → Service must all agree
5. **Pre-commit enforced** - Hook blocks commits if contracts change without regeneration

```
# Before adding a parameter, verify existing code:
grep -rn "paramName" src/mcp-tools/*/core/manager.ts
grep -rn "paramName" src/versioning/ src/gates/ src/frameworks/
```

> **Full rules**: See `.claude/rules/mcp-contracts.md` (auto-loaded when editing contracts or MCP tools)

**Framework Development**: Methodology guides = single source of truth (never hard-code), dynamic generation from guide metadata, guide-driven enhancements (system prompts, quality gates, validation). **Framework validity**: always call `frameworkManager.getFramework(id)` - never hardcode framework lists or use type unions for validation

**Domain Cohesion**: Framework logic in `/frameworks`, separate stateless (manager) from stateful (state manager), clear separation (analysis WHAT vs methodology HOW), explicit integration points (`/integration`)

**Module Organization**: Modern TypeScript patterns for public API vs implementation separation:
- **≤7 files**: Flat structure with barrel exports (`index.ts`) controlling visibility
- **>7 files or clear API boundary**: Use `internal/` subfolder for implementation details
- **Naming**: Public facades = service names (`InjectionDecisionService`), internal helpers = function-descriptive (`HierarchyResolver`, `ConditionEvaluator`)
- **Documentation**: ASCII architecture diagrams in barrel files showing facade→helper relationships
- **Reorganize when**: >7 files with mixed concerns, newcomers confused about entry points, facade pattern emerging, tests importing implementation details
- **Reference**: See `execution/pipeline/decisions/injection/` for canonical example of `internal/` pattern

**Methodology Guide Development**: Implement `IMethodologyGuide` interface (all required methods: `guidePromptCreation`, `guideTemplateProcessing`, `guideExecutionSteps`, `enhanceWithMethodology`, `validateMethodologyCompliance`), framework-specific quality gates, template enhancement suggestions, methodology validation

**Framework Integration**: No direct coupling (integrate via framework manager), event-driven communication, semantic analysis coordination (informed by, not dependent on), gates adapt to framework (remain framework-agnostic in core)

**Pipeline State Management**: Use centralized state via `context.gates` (GateAccumulator), `context.frameworkAuthority` (FrameworkDecisionAuthority), and `context.diagnostics` (DiagnosticAccumulator). Never mutate gate arrays directly or resolve framework IDs manually in stages. See `docs/architecture/overview.md#pipeline-state-management` for patterns.

**Configuration**: CLI flags and env vars for path overrides (`MCP_WORKSPACE`, `MCP_CONFIG_PATH`, `MCP_PROMPTS_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`), separate server/prompts config, modular imports, absolute paths for Claude Desktop

**Error Handling**: Comprehensive boundaries (all orchestration levels), structured logging (verbose/quiet modes), meaningful error messages (diagnostics), rollback mechanisms (startup failures)

**Testing**: Follow `/home/minipuft/Applications/CLAUDE.md#Testing_Standards` for workflow, classification, mock boundaries, and LLM mistake prevention.

**Project Test Commands**:

| Command | When to Use |
|---------|-------------|
| `npm run test:integration` | FIRST for new features (catches boundary bugs) |
| `npm run test:unit` | Edge cases and complex logic validation |
| `npm run test:all` | Before commits (unit + integration) |
| `npm run test:e2e` | Critical user journeys (when stable) |
| `npm run test:coverage` | Baseline coverage checks (target: >80%) |
| `npm run test:watch` | During active development |

**MCP-Specific Test Coverage** (what this project needs tested):

| Area | Integration Test Focus | Unit Test Focus |
|------|------------------------|-----------------|
| Transport layer | STDIO/SSE startup and message handling | Protocol message parsing |
| Template rendering | Full Nunjucks pipeline with variables | Edge cases in template syntax |
| Hot-reload | File change → registry update flow | Individual file observer events |
| MCP protocol | Request → response contract compliance | Schema validation edge cases |
| Framework system | Switch framework → state persistence | Individual framework operations |
| Gate system | Validation criteria → enforcement decisions | Gate definition parsing |
| Chain sessions | Start → step → resume → complete workflow | Session state transitions |
| Symbolic parsing | Full command → execution plan | Individual operator parsing |

**Project Directory Structure**:

```text
tests/
├── unit/                    # Mirror src/ - ALL deps mocked
│   ├── execution/
│   ├── frameworks/
│   ├── gates/
│   └── mcp-tools/
├── integration/             # Workflow-based - real collaborators
│   ├── scripts/            # Script-tools workflow
│   ├── pipeline/           # Execution pipeline flows
│   └── prompts/            # Prompt loading flows
└── e2e/                    # Full MCP transport
    ├── api/                # Tool call flows
    └── cli/                # Server lifecycle
```

**Environment Variables**: `MCP_WORKSPACE` (base workspace directory for prompts, config, etc.), `MCP_PROMPTS_PATH` (direct path to prompts config), `MCP_CONFIG_PATH` (direct path to config.json), `MCP_STYLES_PATH` (direct path to styles directory). CLI flags take priority: `--workspace`, `--prompts`, `--config`, `--methodologies`, `--gates`, `--styles`

**Lifecycle Management**: For refactoring and migration work, refer to `~/.claude/REFACTORING.md` domain rules for universal lifecycle state tagging, module boundary enforcement, and deletion criteria patterns.

---

By following this handbook, Claude Code behaves like a senior developer: planning first, aligning with the compiled runtime, respecting MCP tooling, validating thoroughly, and keeping documentation synchronized.
