# Architecture & Design Decisions

> Status: canonical | Last Updated: January 2025

Key architectural choices and trade-offs behind the Claude Prompts MCP Server. Read this to understand _why_ things are built this way.

---

## 1. Core Philosophy: Composable Context Engineering

**Effective LLM interaction is personal.** There's no universal prompt that works for everyone.

The system is an **unopinionated engine for composability**:

- **Workflow Atomization**: Split workflows into discrete units—single prompts or multi-step chains. You choose the granularity.
- **Focus on Context**: We handle the plumbing (parsing, routing, validation). You focus on _Context Engineering_—curating templates and logic.
- **Agent-First Navigation**: Strict typing and Zod schemas make the codebase navigable by LLM coding agents. The AI is a first-class maintainer.

---

## 2. Technical Stack Decisions

### Runtime: Node.js & TypeScript

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Runtime** | Node.js (v18+) | I/O-bound workload (file watching, hot-reload). Mature `fs` ecosystem. |
| **Language** | TypeScript (strict mode) | Enables contract-driven development. Zod schemas bridge deterministic runtime ↔ probabilistic LLM. |
| **Module System** | ESM | Modern, tree-shakeable, better tooling support. |

### Transport: STDIO, SSE & Streamable HTTP

| Transport | Protocol | Use Case | Status |
|-----------|----------|----------|--------|
| **STDIO** | Line-based JSON | Claude Desktop, Cursor, CLI tools. Server feels like a local extension. | Active |
| **Streamable HTTP** | HTTP POST/GET with SSE streams | Web dashboards, remote APIs. One `/mcp` endpoint. | **Recommended** |
| **SSE** | HTTP Server-Sent Events | Legacy integrations. | Deprecated |

Transport auto-detects at startup. For HTTP, use Streamable HTTP—SSE is deprecated.

### Data Storage: File-Based Persistence (Intentional)

| Aspect | Decision | Trade-off |
|--------|----------|-----------|
| **Storage** | JSON files + Markdown templates | _Pro_: Zero-dependency deployment. Git-versionable prompts. <br>_Con_: Parsing overhead at scale. |
| **State** | `runtime-state/*.json` | Sessions survive STDIO process restarts. |
| **Hot-Reload** | File watchers with debouncing | Changes propagate without server restart. |

**Why file-based?**
- `git clone && npm start` — no database setup
- Version prompts alongside code
- Human-readable: debug by reading files, not SQL queries
- File watchers work natively for hot-reload

The in-memory registry caches parsed content. JSON parsing (~5-20ms for hundreds of prompts) is negligible for single-user MCP servers.

---

## 3. Key Architectural Patterns

### The 21-Stage Execution Pipeline

Instead of monolithic execution functions, requests flow through a staged pipeline:

```
Request → Normalize → Parse → Plan → Enhance → Execute → Format → Response
```

**Why Stages?**

1. **Safety**: LLM interactions have many "soft" failure points (syntax errors, missing files, validation). Stages enforce interfaces and provide diagnostics at each step.
2. **Observability**: Each stage logs entry/exit with timing and memory metrics. Debugging is straightforward.
3. **Extensibility**: Add a stage file, register it in the orchestrator, done.

**Why Not Middleware?**

Traditional middleware (like Express) uses `next()` callbacks. Our pipeline uses explicit stage registration with controlled execution order. This provides:
- Predictable ordering (stage 1 always runs before stage 2)
- Type-safe context passing between stages
- Early exit when response is ready

### Tool Consolidation (3-Tool Architecture)

We expose **3 MCP tools** instead of 20+ specialized tools:

| Tool | Purpose |
|------|---------|
| `prompt_engine` | Execute prompts and chains |
| `resource_manager` | CRUD for prompts, gates, methodologies |
| `system_control` | Status, framework switching, analytics |

**Why Consolidation?**

1. **Token Economy**: Every tool definition consumes context window. 3 tools vs 20+ is ~85% reduction in tool schema overhead.
2. **Intent Accuracy**: LLMs route better through a single "Manager" tool with distinct actions than guessing parameters for 20 functions.
3. **Maintainability**: Internal structure can evolve without changing external API.

Internally, `resource_manager` routes to specialized managers (PromptManager, GateManager, FrameworkManager) based on `resource_type`.

### Contract-Driven Development

Tool parameters and descriptions are generated from JSON contract files:

```
tooling/contracts/*.json  →  npm run generate:contracts  →  _generated/mcp-schemas.ts
```

**Why Contracts?**

1. **Single Source of Truth**: No drift between validation, types, and documentation.
2. **Type Safety**: Zod schemas ensure runtime validation matches compile-time types.
3. **LLM Consumption**: Contracts inform tool descriptions that LLMs read.
4. **Versioning**: Contracts enable tracking breaking changes.

### Symbolic DSL (`>>`, `-->`, `::`, `@`, `#`)

We implemented a custom parser for symbolic commands:

```
>>analysis --> >>summary :: "strict" @CAGEERF #analytical
```

| Operator | Purpose | Example |
|----------|---------|---------|
| `>>` | Prompt reference | `>>my_prompt` |
| `-->` | Chain steps | `>>a --> >>b --> >>c` |
| `::` | Inline gate | `>>prompt :: "validate citations"` |
| `@` | Framework override | `>>prompt @CAGEERF` |
| `#` | Style override | `#analytical >>report` |

**Why a DSL?**

1. **Developer Experience**: JSON payloads break flow. Symbolic syntax reads naturally.
2. **Composability**: Operators combine: `#lean >>a --> >>b :: "quality" @ReACT`
3. **Discoverability**: Syntax is self-documenting in tool descriptions.

### Meta-Prompts (Self-Authoring UX)

Instead of expecting users to memorize `resource_manager` parameters, we provide wizard-style prompts:

- `>>create_gate` — Guided gate creation
- `>>create_prompt` — Prompt/chain authoring
- `>>create_methodology` — Framework authoring

**Two-Phase UX**:

1. **Design phase**: Partial args → template shows guidance and examples
2. **Validation phase**: Complete args → script validates → auto-executes creation

**Why Meta-Prompts?**

Users don't read documentation—they explore interactively. The prompts teach their own API.

---

## 4. State Management Philosophy

### Ephemeral vs Persistent State

| Type | Lifecycle | Storage | Use Case |
|------|-----------|---------|----------|
| **Ephemeral** | Dies after request | `ExecutionContext` | Pipeline state, intermediate results |
| **Session** | Survives session requests | `chain-sessions.json` | Chain step progress, gate reviews |
| **Global** | Survives restarts | `runtime-state/*.json` | Framework selection, system config |

**Key Insight**: The most common state bug is storing cross-request state in `ExecutionContext`. Use session managers for persistence.

### Centralized Accumulators

Three components prevent distributed state bugs:

| Component | Purpose | Anti-Pattern Prevented |
|-----------|---------|------------------------|
| `GateAccumulator` | Priority-based gate deduplication | Duplicate gates from multiple sources |
| `DiagnosticAccumulator` | Audit trail across stages | Lost diagnostics in async flows |
| `FrameworkDecisionAuthority` | Single framework resolution | Multiple stages making conflicting framework decisions |

---

## 5. Hot-Reload Architecture

### What Hot-Reloads

| Resource | Watch Location | Manager |
|----------|----------------|---------|
| Prompts | `server/prompts/**/*.md` | FileObserver → PromptAssetManager |
| Gates | `server/resources/gates/*/gate.yaml` | GateHotReloadCoordinator |
| Styles | `server/resources/styles/*/style.yaml` | StyleHotReloadCoordinator |
| Methodologies | `server/resources/methodologies/*/*.yaml` | MethodologyHotReload |
| Tool Descriptions | `_generated/tool-descriptions.contracts.json` | ToolDescriptionManager |

### Hot-Reload Strategy

1. **Debouncing**: Multiple rapid changes trigger single reload (100ms window)
2. **Validation First**: Parse and validate before swapping registry
3. **Atomic Swap**: Old registry → new registry in single operation
4. **Graceful Degradation**: Invalid files logged, valid files still loaded

---

## 6. Framework Injection System

### Injection Types

| Type | Content | Default Frequency |
|------|---------|-------------------|
| `system-prompt` | Methodology guidance (CAGEERF, ReACT) | Every 2 chain steps |
| `gate-guidance` | Quality validation criteria | Every step |
| `style-guidance` | Response formatting | First step only |

### 7-Level Resolution Hierarchy

```
Modifier → Runtime Override → Step Config → Chain Config → Category Config → Global Config → System Default
```

**Why Hierarchical?**

Different granularities need different defaults:
- Quick ad-hoc prompt: Use global defaults
- Specific chain step: Override for that step
- Entire category: Set category-wide config

The hierarchy resolves independently per injection type, allowing fine-grained control.

---

## 7. Quality Gates System

### Gate Architecture

```
server/resources/gates/
└── {gate-id}/
    ├── gate.yaml       # Configuration (id, criteria, severity)
    └── guidance.md     # Guidance content (inlined at load)
```

### Gate Sources (Priority Order)

| Priority | Source | Example |
|----------|--------|---------|
| 100 | Inline operator (`::`) | `>>prompt :: "validate citations"` |
| 90 | Client selection | `gates: ["research-quality"]` |
| 80 | Temporary request | Request-scoped gates |
| 60 | Prompt config | Gates in prompt metadata |
| 50 | Chain-level | Gates for entire chain |
| 40 | Methodology | Framework-specific gates |
| 20 | Registry auto | Default gates |

**Why Priority-Based?**

User intent should override defaults. Higher-priority sources (inline, client) represent explicit user decisions.

---

## 8. Error Handling Philosophy

### Layered Error Handling

| Layer | Responsibility |
|-------|----------------|
| **Services** | Throw on failure (no swallowing) |
| **Stages** | Propagate errors (don't catch) |
| **Pipeline** | Catch, log, format response |
| **Transport** | Format MCP error response |

### Key Principle: No Silent Failures

```typescript
// WRONG: Swallow and log
await persist().catch(e => log(e));  // Caller thinks it succeeded!

// RIGHT: Let errors propagate
await persist();  // Throws on failure
```

State operations that fail silently cause in-memory/file state divergence—bugs that are nearly impossible to reproduce.

---

## 9. Testing Philosophy

### Test Pyramid

| Layer | Purpose | Location |
|-------|---------|----------|
| Unit | Edge cases, complex logic | `tests/unit/` |
| Integration | Module boundaries | `tests/integration/` |
| E2E | Full MCP transport | `tests/e2e/` |

### Integration-First Approach

For new features, write integration tests first:

1. Integration tests catch boundary bugs (where most issues live)
2. Unit tests add coverage for edge cases
3. E2E validates complete user journeys

**Why Integration-First?**

Unit tests with mocked dependencies can pass while real integration fails. Integration tests use real collaborators, mock only I/O.

---

## 10. Performance Targets

| Operation | Target | Actual |
|-----------|--------|--------|
| Server startup | <3s | ~2s |
| Tool response | <500ms | ~200-400ms |
| Hot-reload | <100ms | ~50ms |
| Framework switch | <100ms | ~20ms |

### Memory Management

- **Session cleanup**: 24h default expiry
- **Argument history**: Configurable retention (default: 1000 entries)
- **Template cache**: LRU with 100-entry limit
- **Temporary gates**: Auto-expire after execution

---

## Summary

This codebase balances **strict software engineering patterns** (pipelines, contracts, Zod validation) with the **flexible nature** of AI workflows. It prioritizes:

1. **User autonomy**: Define your own process, don't inherit ours
2. **Observability**: Every stage, every decision is traceable
3. **Safety**: Validation at boundaries, graceful degradation on errors
4. **Evolvability**: Internal structure changes without breaking external API

The architecture enables experimentation (try different methodologies, gates, styles) while maintaining the guard rails that make production use safe.
