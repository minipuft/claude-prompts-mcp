# Claude Prompts MCP — Project Decision Document

**Purpose**: Evidence-based record of architectural decisions, technical scope, and engineering rationale for this project. Compiled from codebase research for application materials.

---

## Project Overview

| Metric            | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| **Project**       | Claude Prompts MCP Server                                        |
| **Version**       | 2.1.0                                                            |
| **Language**      | TypeScript (primary), Python (hooks/tooling)                     |
| **Source Files**  | 422 TypeScript + 80 Python + 153 JSON                            |
| **Lines of Code** | ~102,000 (TypeScript source)                                     |
| **Test Files**    | 176                                                              |
| **Total Commits** | 374+                                                             |
| **Duration**      | ~14 months (initial commit → present)                            |
| **Key Tech**      | Node.js 22, native SQLite, Zod, Express, esbuild, Jest, chokidar |

**What it is**: A production MCP (Model Context Protocol) server that provides AI agents with a structured prompt execution engine, resource management system, and runtime state management. It serves as a plugin for Claude Code, Gemini CLI, and OpenCode — enabling prompt chaining, quality gates, frameworks, and resource lifecycle management through standardized MCP tool calls.

---

## Architecture Decisions

### 1. Native SQLite over WASM (sql.js → node:sqlite)

**Decision**: Replaced sql.js (WebAssembly-based SQLite) with Node.js 22's built-in `node:sqlite` `DatabaseSync`.

**Rationale**:

- **Direct disk writes**: `DatabaseSync` writes to disk natively — no manual `persist()` or `export()` calls needed. sql.js required explicit serialization and write-back.
- **No WASM overhead**: Eliminates JavaScript/WebAssembly boundary crossing for every query.
- **WAL mode support**: Native SQLite supports `PRAGMA journal_mode=WAL` for concurrent reader access. This was critical for Python hooks (see decision #2).
- **Synchronous API**: `DatabaseSync` is simpler than promise-based alternatives for state operations that need atomicity.
- **Zero external dependencies**: `node:sqlite` is a built-in module — no npm package to manage.

**Evidence**: `server/src/infra/database/sqlite-engine.ts` — `DatabaseSync` import at line 27, lifecycle comment at lines 1-23 explaining the migration rationale.

**Challenge solved**: Jest's module resolver strips the `node:` protocol prefix and its sandbox intercepts `require()`. Solution: a custom shim (`tests/helpers/node-sqlite-shim.cjs`) that uses `Module._load()` directly to bypass Jest's module system entirely.

---

### 2. WAL Mode for Concurrent Cross-Language Access

**Decision**: Enable SQLite WAL (Write-Ahead Logging) mode on the state database.

**Rationale**: The system has a cross-language architecture where:

- **Node.js server** (TypeScript) writes state to `state.db` during prompt execution
- **Python hooks** read state from `state.db` for chain enforcement, prompt suggestion, and compaction recovery
- **Skills-sync CLI** reads state outside the MCP server context

Without WAL mode, readers would block writers and vice versa. WAL allows concurrent readers while the server writes — essential for real-time hook enforcement during chain execution.

**Evidence**:

- `sqlite-engine.ts:108` — `this.db.exec('PRAGMA journal_mode=WAL')`
- `hooks/lib/db_reader.py:22` — Python connects read-only: `sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)`
- Python hooks use stdlib `sqlite3` — zero external dependencies for the hook system

---

### 3. PID-Based Session Isolation

**Decision**: Use `process.pid` (not workspace ID) as the primary isolation key for chain sessions.

**Rationale**: Multiple Claude Code instances can share the same `state.db` file with the same workspace configuration. Workspace-based isolation alone would cause one instance to read another's chain state, breaking execution flow.

**How it works**:

- Each server process captures `process.pid` at startup
- Chain sessions are written with `tenant_id = process.pid`
- Python hooks check PID liveness via `os.kill(pid, 0)` before trusting session data
- At startup, `cleanupStalePidRows()` removes rows from dead processes (crash recovery)

**Dual-write pattern**: Sessions are written to both:

1. `chain_run_registry` — PID-scoped blob for backward compatibility
2. `chain_sessions` — per-row format for fast hook queries

This gives hooks a fast query path (SELECT by tenant_id) while maintaining a transactional blob backup.

**Evidence**: `server/src/modules/chains/manager.ts` — PID capture at line 83, dual-write at lines 285-330, stale cleanup at lines 395-430.

---

### 4. Drop-and-Recreate Schema Versioning

**Decision**: On schema version mismatch, drop all tables and recreate from embedded schema (no incremental migrations).

**Rationale**: `state.db` is ephemeral — it stores runtime state, not user data:

- `resource_index` is regenerated from YAML files on startup
- Chain sessions are interrupted by the restart that triggers schema changes
- Framework state resets are acceptable on version changes

This eliminates migration complexity entirely. A single `SCHEMA_VERSION` constant (currently 13) controls the schema. If the version doesn't match, the database is rebuilt from scratch.

**Evidence**: `sqlite-engine.ts:220-237` — `ensureSchema()` with drop-and-recreate logic. Schema comment at lines 14-22 explains why this is safe.

---

### 5. 22-Stage Execution Pipeline

**Decision**: Structure prompt execution as a linear pipeline of discrete, composable stages rather than a monolithic executor.

**Rationale**: Prompt execution involves many cross-cutting concerns: identity resolution, command parsing, gate enhancement, framework selection, session management, injection control, response capture, and formatting. A pipeline architecture:

- Makes each concern independently testable
- Supports early termination (if any stage produces a response, pipeline exits)
- Allows stages to be added/removed without affecting others
- Makes execution flow visible and debuggable

**Stages** (grouped by responsibility):

- **Group 00** (4 stages): Request normalization, dependency injection, lifecycle hooks, identity resolution
- **Group 01-04** (7 stages): Command parsing, inline gate extraction, operator validation, execution planning, script execution
- **Group 05-07** (6 stages): Gate enhancement, framework resolution, judge selection, prompt guidance, session management, injection control
- **Group 08-12** (6 stages): Response capture, shell verification, step execution, phase guard, gate review, formatting, cleanup

**Evidence**: `server/src/mcp/tools/prompt-engine/core/pipeline-builder.ts:92-380` — full stage construction. `prompt-execution-pipeline.ts:244-289` — stage registration.

---

### 6. Contract-Driven Code Generation

**Decision**: MCP tool definitions are authored as JSON contracts, with TypeScript metadata auto-generated from them. Zod validation schemas are hand-written separately.

**Rationale**: Separates concerns:

- **Contracts** (`tooling/contracts/*.json`) are the SSOT for tool descriptions and parameter metadata
- **Zod schemas** (`src/mcp/tools/schemas/*.schema.ts`) are the SSOT for input validation
- **Generated files** (`_generated/`) contain only metadata constants — never edited manually

This prevents the common drift problem where tool descriptions, parameter types, and validation logic diverge. Pre-commit hooks auto-regenerate on contract changes and block direct edits to generated files.

**Evidence**: `server/scripts/generate-contracts.ts` — generation script. `.husky/pre-commit` — auto-regeneration and protection hooks.

---

### 7. Transport Parity (STDIO + SSE + Streamable HTTP)

**Decision**: Support three MCP transport modes with the same tool handlers.

**Rationale**: Different clients need different transports:

- **STDIO**: Claude Code, Claude Desktop (local process communication)
- **SSE**: Legacy browser/HTTP clients
- **Streamable HTTP**: MCP standard since 2025-03-26 (replacing SSE)
- **Both**: STDIO + HTTP simultaneously for development

All transports route to the same `PromptExecutor`, `ResourceManager`, and `SystemControl` handlers — zero transport-specific logic in tool implementations.

**Evidence**: `server/src/infra/http/transport/index.ts` — transport setup with enum at lines 23-28, STDIO at 79-101, SSE at 126-234, Streamable HTTP at 240-300+.

---

### 8. Chain Operator System (Symbolic Command Language)

**Decision**: Design a symbolic command language with operators for chaining (`-->`), delegation (`==>`), repetition (`*N`), gates (`::`), and framework selection (`@`).

**Rationale**: Enables complex multi-step AI workflows through a concise syntax:

```
>>plan topic:'auth refactor' --> ==> >>implement --> >>review :: security:"no secrets"
```

This single command: plans a topic, delegates implementation to a sub-agent, reviews the output, and enforces a security gate.

**Key operators**:

- `-->` Chain steps sequentially, passing results forward
- `==>` Delegate next step to a Task tool sub-agent with context isolation
- `:: criteria` Inline quality gates with pass/fail criteria
- `@ framework` Override active framework
- `% modifier` Execution modifiers (%clean, %lean)
- `*N` Repeat step N times

**Evidence**: `server/src/engine/execution/parsers/symbolic-operator-parser.ts` — parser with chain splitting at lines 521-559, delegation detection at lines 294-297.

---

### 9. Lint Ratcheting (Gradual Quality Improvement)

**Decision**: Track ESLint violations in a committed baseline file and fail CI if any rule's count increases.

**Rationale**: The codebase had significant existing lint debt (3,596 errors + 1,541 warnings) that couldn't be fixed all at once. Ratcheting:

- Prevents new violations from being introduced
- Allows gradual cleanup without blocking all development
- Tracks progress per-rule, not just total count
- Supports intentional baseline updates for debt management

**Evidence**: `server/scripts/eslint-ratchet.js` — ratchet script (207 lines). `.eslint-ratchet-baseline.json` — committed baseline with per-rule counts.

---

### 10. 5-Layer Architecture Enforcement

**Decision**: Enforce a strict 5-layer import hierarchy via dependency-cruiser:

```
shared(L0) → infra(L1) → engine(L2) → modules(L3) → mcp(L4)
```

**Rationale**: Each layer can only import from layers below it. This prevents:

- Circular dependencies between domains
- Infrastructure leaking into business logic
- MCP tool handlers containing domain logic
- Gates depending on frameworks (and vice versa)

Violations are caught at build time, not runtime.

**Evidence**: `server/.dependency-cruiser.cjs` — 273 lines of architecture rules. Domain isolation at lines 148-160 (gates/frameworks separation).

---

### 11. Hot-Reload with WSL2-Aware File Watching

**Decision**: Use chokidar with automatic WSL2 detection for polling fallback.

**Rationale**: Native filesystem events are unreliable on WSL2 and network filesystems. The file observer:

- Auto-detects WSL2 via `os.release()` and switches to polling mode
- Debounces events (500ms) to batch rapid changes
- Classifies changes by type (prompt, config, framework, gate) for targeted reload
- Supports auxiliary directories for extension watching

**Evidence**: `server/src/modules/hot-reload/file-observer.ts` — WSL2 detection at lines 115-122, debouncing and event classification throughout.

---

### 12. Identity & Scope Propagation

**Decision**: Thread workspace/organization identity from MCP SDK request metadata through all state operations.

**Rationale**: Supports multi-tenant deployments where different clients need isolated state:

- `RequestIdentityResolver` extracts identity from MCP SDK `extra` field
- `resolveContinuityScopeId()` resolves: workspaceId → organizationId → 'default'
- All state stores accept `StateStoreOptions` with scope
- Per-scope in-memory caching via `scopedStates: Map<string, State>`
- Two policy modes: `locked` (single workspace) and `permissive` (per-request override)

**Evidence**: Full pipeline across `request-identity-resolver.ts`, `request-identity-scope.ts`, pipeline stage 00, and all three MCP tool routers. DB schema v13 has scope columns on all tables.

---

### 13. Gate System (Quality Control Decision Points)

**Decision**: Build a pluggable gate system that validates AI-generated output against structured criteria.

**Rationale**: AI output quality is unpredictable. Gates provide:

- **Validation gates**: Block execution until criteria pass (content checks, pattern matching, shell verification)
- **Guidance gates**: Provide advisory feedback without blocking
- **Framework gates**: Framework-specific quality checks
- **Inline gates**: Ad-hoc criteria via `::` operator syntax

Gates are defined as YAML resources, hot-reloaded, and enforced by `GateEnforcementAuthority` (SSOT for enforcement decisions).

**Evidence**: `server/src/engine/gates/` — full gate subsystem. `gate-enforcement-authority.ts` for verdict processing. `inline-gate-processor.ts` for `::` operator parsing.

---

### 14. Resource Indexer with Ranked Search

**Decision**: Index all resources (prompts, gates, frameworks, styles, tools) into SQLite with application-level ranked search.

**Rationale**: File-based resource discovery is slow for search operations. The indexer:

- Uses content-hash based incremental sync (only re-indexes changed files)
- Provides field-weighted scoring: ID(10) > name-word(8) > name-prefix(5) > keywords(4) > description(2) > ID-substring(1)
- Extracts keywords automatically (stop-word filtered, 3+ char words)
- Stores metadata as JSON for structured queries

**Evidence**: `server/src/infra/database/resource-indexer.ts` — scoring at lines 241-258, keyword extraction at lines 175-187.

---

## Quality Infrastructure

### Multi-Stage Validation Pipeline

| Stage                   | What Runs                                                                                                                   | Blocks   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Pre-Commit**          | Contract auto-regen, generated file protection, lint-staged, Python validation, lint ratchet                                | Commit   |
| **Pre-Push**            | Typecheck, lint ratchet, prettier, Python validation, test suite, architecture validation, version consistency              | Push     |
| **CI (GitHub Actions)** | Lint suite, architecture scope detection, build + smoke test, tests + coverage, architecture validation, PR summary comment | PR merge |
| **Release**             | Release Please (conventional commits), version sync across 3 manifests, changelog generation                                | Release  |

### Test Infrastructure

- **Jest** with ESM support (`--experimental-vm-modules`)
- **Custom node:sqlite shim** bypassing Jest's module sandbox
- **Integration tests** with real SQLite (not mocked)
- **Coverage ratchet thresholds**: 35% statements, 29% branches, 40% functions (ramping toward 80%)
- **176 test files** covering unit, integration, and e2e

### Conventional Commits

- Enforced via commitlint with 24 allowed scopes
- Release Please auto-generates changelog from commit types
- Version synced across: root `package.json`, `server/package.json`, `manifest.json`, `.claude-plugin/plugin.json`

---

## Technical Challenges Solved

1. **Cross-language concurrent database access**: WAL mode + read-only Python connections enable hooks to query server state in real-time without blocking writes.

2. **Process isolation without infrastructure**: PID-based session scoping solves concurrent client access to shared state without requiring a separate coordination service.

3. **Jest + native Node.js modules**: Custom `Module._load()` shim bypasses Jest's module sandbox to access `node:sqlite` built-in.

4. **Schema evolution without migrations**: Drop-and-recreate strategy is safe for ephemeral state, eliminating migration complexity entirely.

5. **Gradual quality improvement at scale**: Lint ratcheting allows 3,500+ existing violations to coexist with a strict "no new violations" policy.

6. **WSL2 filesystem reliability**: Auto-detecting WSL2 and falling back to polling prevents missed file change events.

7. **Transport-agnostic tool handlers**: Single tool implementation serves STDIO, SSE, and Streamable HTTP without transport-specific code.

8. **Incremental resource indexing**: Content-hash diffing avoids re-indexing unchanged files while maintaining search accuracy.
