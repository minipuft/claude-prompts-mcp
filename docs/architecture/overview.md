# Architecture Guide

> Status: canonical

How requests flow from MCP clients through the pipeline to responses.

**Read this when** you want the big picture of transports, runtime, pipeline stages, and state management.

**You'll learn**

- Request flow: Client → Transport → Pipeline → Response
- Where frameworks, gates, styles, and hot-reload plug in
- Which files to inspect when debugging or extending

**Prerequisites**: Server running (see [README Quick Start](../README.md#quick-start)).

---

## System Overview

Three MCP tools. Four methodology frameworks. One 21-stage execution pipeline.

### Request Lifecycle

This is how a `prompt_engine` request actually flows through the system:

```mermaid
flowchart LR
    subgraph Client
        A[MCP Request]
    end

    subgraph Transport
        B[STDIO/SSE]
    end

    subgraph Pipeline["PromptExecutionPipeline (21 stages)"]
        direction TB
        C1[Parse & Validate]
        C2[Plan & Enhance]
        C3[Execute & Format]
    end

    subgraph Services
        D1[Prompts]
        D2[Frameworks]
        D3[Gates]
        D4[Styles]
        D5[Sessions]
    end

    subgraph State
        E1[Ephemeral<br/>ExecutionContext]
        E2[Persistent<br/>runtime-state/]
    end

    A --> B --> Pipeline
    C1 --> C2 --> C3
    Pipeline <--> D1 & D2 & D3 & D4 & D5
    D5 <--> E2
    Pipeline --> E1
    C3 --> B --> A
```

### Architectural Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Protocol Layer                        │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐             │
│  │prompt_engine│  │resource_manager│ │system_control│            │
│  └──────┬──────┘  └───────┬──────┘  └──────┬──────┘             │
├─────────┼─────────────────┼────────────────┼────────────────────┤
│         │                 │                │   Routing Layer     │
│         │          ┌──────┴──────┐         │                     │
│         │          │   Router    │         │                     │
│         │          └──────┬──────┘         │                     │
│         │     ┌───────────┼───────────┐    │                     │
│         │     ▼           ▼           ▼    │                     │
│         │ ┌───────┐ ┌─────────┐ ┌─────────┐│                     │
│         │ │Prompt │ │  Gate   │ │Framework││                     │
│         │ │Manager│ │ Manager │ │ Manager ││                     │
│         │ └───────┘ └─────────┘ └─────────┘│                     │
├─────────┼─────────────────────────────────┼────────────────────┤
│         │                                  │   Execution Layer   │
│         ▼                                  │                     │
│  ┌──────────────────┐                      │                     │
│  │PromptExecution   │                      │                     │
│  │Pipeline (21 stg) │                      │                     │
│  └────────┬─────────┘                      │                     │
├───────────┼────────────────────────────────┼────────────────────┤
│           │                                │   Service Layer     │
│     ┌─────┴─────┬──────────┬───────────┬───┴───────┐            │
│     ▼           ▼          ▼           ▼           ▼            │
│ ┌───────┐  ┌─────────┐  ┌───────┐  ┌───────┐  ┌─────────┐      │
│ │Prompts│  │Frameworks│  │ Gates │  │Styles │  │Sessions │      │
│ │Registry│ │ Manager │  │Manager│  │Manager│  │ Manager │      │
│ └───┬───┘  └────┬────┘  └───┬───┘  └───┬───┘  └────┬────┘      │
├─────┼───────────┼───────────┼──────────┼───────────┼────────────┤
│     │           │           │          │           │  Persistence│
│     ▼           ▼           ▼          ▼           ▼             │
│ prompts/    methodologies/  gates/    styles/    runtime-state/  │
│ *.md,json   */method.yaml  */gate.yaml */style.yaml  *.json      │
│             */phases.yaml  */guidance  */guidance               │
└─────────────────────────────────────────────────────────────────┘
```

### What Each Layer Does

| Layer            | Components                    | Responsibility                                             |
| ---------------- | ----------------------------- | ---------------------------------------------------------- |
| **MCP Protocol** | 3 registered tools            | Receive MCP requests, validate schemas, return responses   |
| **Routing**      | resource_manager router       | Routes CRUD operations to specialized managers             |
| **Execution**    | Pipeline + 21 stages          | Transform request → parse → enhance → execute → format     |
| **Service**      | Managers + registries         | Business logic for prompts, frameworks, gates, styles, sessions |
| **Persistence**  | File system                   | Hot-reload sources, runtime state, definitions             |

### Why The Pipeline Matters

The `PromptExecutionPipeline` is the architectural centerpiece. Every `prompt_engine` call:

1. Creates fresh `ExecutionContext` (ephemeral state)
2. Flows through up to 21 stages sequentially
3. Each stage reads/writes to context
4. Services are called as needed by stages
5. Response assembled at the end

This design means:

- **Predictable**: Same stages, same order, every time
- **Debuggable**: Each stage logs entry/exit with timing and memory metrics
- **Extensible**: Add a stage file, register it, done

### Key Design Decisions

| Decision                     | Rationale                                                |
| ---------------------------- | -------------------------------------------------------- |
| **3-Tool Architecture**      | Token economy: fewer tools = less context overhead       |
| **resource_manager Routing** | Single entry point fans out to specialized managers      |
| **File-Based State**         | Sessions survive STDIO process restarts, git-friendly    |
| **Optional Frameworks**      | Disabled by default for performance                      |
| **Hot Reload**               | Prompt/gate/style changes without server restart         |
| **Pipeline-First**           | Every request flows through the same staged pipeline     |
| **Contracts as SSOT**        | Tool descriptions and Zod schemas generated from JSON contracts |

---

## Quick Start for Developers

### Codebase Map

```
server/src/
├── runtime/                    # Application lifecycle
│   └── application.ts          # 4-phase startup orchestrator
├── server/transport/           # STDIO + SSE protocol handlers
├── mcp-tools/                  # MCP tool layer
│   ├── index.ts                # Registers 3 MCP tools
│   ├── prompt-engine/          # → PromptExecutionPipeline
│   ├── prompt-manager/         # Prompt CRUD operations
│   ├── gate-manager/           # Gate CRUD operations
│   ├── framework-manager/      # Framework CRUD operations
│   ├── resource-manager/       # Unified router to above managers
│   └── system-control.ts       # → System administration
├── execution/                  # Execution layer
│   ├── pipeline/stages/        # 21 stage files
│   ├── pipeline/state/         # Accumulators (gates, diagnostics)
│   ├── pipeline/decisions/     # Decision services (injection, gates)
│   ├── parsers/                # Command parsing strategies
│   ├── context/                # ExecutionContext + type guards
│   ├── planning/               # Execution planner
│   └── reference/              # Reference resolution
├── prompts/                    # Prompt registry + hot-reload
├── frameworks/                 # Methodology system
│   ├── methodology/            # YAML loaders, validation
│   └── framework-manager.ts    # Stateless orchestrator
├── gates/                      # Quality validation
│   ├── core/                   # GateLoader, validators
│   ├── registry/               # GateRegistry, GenericGateGuide
│   ├── hot-reload/             # GateHotReloadCoordinator
│   └── services/               # Gate resolution + guidance
├── styles/                     # Response formatting
│   ├── core/                   # StyleDefinitionLoader, schema
│   ├── hot-reload/             # StyleHotReloadCoordinator
│   └── style-manager.ts        # Style orchestration
├── scripts/                    # Script tool system
│   ├── detection/              # Tool detection service
│   ├── execution/              # Script executor
│   └── core/                   # Definition loader
├── chain-session/              # Multi-step workflow state
├── text-references/            # ArgumentHistoryTracker
└── tooling/contracts/          # Generated Zod schemas
server/resources/               # Hot-reloaded resource definitions
├── methodologies/              # Methodology definitions
│   └── {methodology-id}/
│       ├── methodology.yaml    # Configuration
│       ├── phases.yaml         # Phase definitions
│       └── system-prompt.md    # Injected guidance
├── gates/                      # Gate definitions
│   └── {gate-id}/
│       ├── gate.yaml           # Configuration
│       └── guidance.md         # Guidance content (inlined at load)
└── styles/                     # Style definitions
    └── {style-id}/
        ├── style.yaml          # Configuration
        └── guidance.md         # Guidance content (inlined at load)
```

### Common Tasks

| Task                  | Where to Look                                                          |
| --------------------- | ---------------------------------------------------------------------- |
| Add new prompt        | `server/prompts/[category]/` - create `.md` + update `prompts.json`    |
| Modify pipeline stage | `server/src/execution/pipeline/stages/`                                |
| Add methodology       | `server/resources/methodologies/{id}/` - create YAML + MD files        |
| Add/modify gate       | `server/resources/gates/{id}/` - create `gate.yaml` + `guidance.md`    |
| Add/modify style      | `server/resources/styles/{id}/` - create `style.yaml` + `guidance.md`  |
| Debug session issues  | `server/src/chain-session/` + `runtime-state/chain-sessions.json`   |
| Update configuration  | `server/config.json`                                                |
| Modify tool schemas   | `server/tooling/contracts/*.json` then `npm run generate:contracts` |

### Entry Points

| File                                                  | Purpose                     |
| ----------------------------------------------------- | --------------------------- |
| `src/index.ts`                                        | Server startup              |
| `src/mcp-tools/index.ts`                              | Tool registration           |
| `src/execution/pipeline/prompt-execution-pipeline.ts` | Pipeline orchestration      |
| `src/prompts/registry.ts`                             | Prompt management           |
| `src/frameworks/framework-manager.ts`                 | Framework logic             |
| `src/gates/gate-manager.ts`                           | Gate orchestration          |
| `src/gates/registry/gate-registry.ts`                 | Gate lifecycle management   |
| `src/styles/style-manager.ts`                         | Style orchestration         |

---

## Execution Pipeline

Every `prompt_engine` call flows through up to 21 stages. Stage files are numbered for organization, but **execution order is determined by the pipeline orchestrator**, not file names.

### Stage Execution Order

The pipeline registers stages in this order (from `prompt-execution-pipeline.ts`):

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INITIALIZE & PARSE                           │
├─────────────────────────────────────────────────────────────────────┤
│ 1. RequestNormalization      Consolidate deprecated params → `gates`│
│ 2. DependencyInjection       Inject framework manager, services     │
│ 3. ExecutionLifecycle        Initialize execution tracking          │
│ 4. CommandParsing            Parse command, extract arguments       │
│ 5. InlineGate                Register `::` criteria as temp gates   │
│ 6. OperatorValidation        Validate `@framework` overrides        │
├─────────────────────────────────────────────────────────────────────┤
│                        PLAN & ENHANCE                               │
├─────────────────────────────────────────────────────────────────────┤
│ 7. ExecutionPlanning         Determine strategy, gates, session     │
│ 8. ScriptExecution*          Run matched script tools               │
│ 9. ScriptAutoExecute*        Call MCP tools from script output      │
│10. JudgeSelection            Select evaluation criteria (%judge)    │
│11. GateEnhancement           Process gates, render guidance         │
│12. FrameworkResolution       Resolve active framework               │
│13. SessionManagement         Chain/session lifecycle                │
│14. InjectionControl          Control framework injection per-step   │
│15. PromptGuidance            Inject methodology guidance            │
├─────────────────────────────────────────────────────────────────────┤
│                        EXECUTE & FORMAT                             │
├─────────────────────────────────────────────────────────────────────┤
│16. ResponseCapture           Capture previous step results          │
│17. StepExecution             Execute prompts with Nunjucks          │
│18. GateReview                Validate gate verdicts (PASS/FAIL)     │
│19. CallToAction              Add contextual next-step suggestions   │
│20. ResponseFormatting        Assemble final response payload        │
│21. PostFormattingCleanup     Clean up temporary state               │
└─────────────────────────────────────────────────────────────────────┘

* Stages 8-9 (Script stages) are optional and only execute when script tools are configured
```

### Pipeline Behavior

| Behavior         | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| **Sequential**   | Stages execute in order, no skipping                          |
| **Early exit**   | Pipeline stops when `context.response` is set                 |
| **Stage no-ops** | Stages may skip based on context (e.g., frameworks disabled)  |
| **Metrics**      | Each stage reports timing and memory delta                    |
| **Recovery**     | Errors in a stage are caught, logged, and can trigger cleanup |

### Script Tool Pipeline

Stages 8 and 9 enable prompts to include validation scripts that auto-trigger based on user input.

```
User Input → ScriptExecution → ScriptAutoExecute → Template Context
                     │                  │
                     ▼                  ▼
            Schema match?          Script returned
            Run script             {valid: true, auto_execute}?
                                   Call MCP tool
```

| Stage | Trigger | Output |
|-------|---------|--------|
| **ScriptExecution** | User args match tool's `schema.json` | Script result → `{{tool_<id>}}` |
| **ScriptAutoExecute** | Script returns `auto_execute` block | MCP tool response → `{{tool_<id>_result}}` |

**Use case**: Meta-prompts like `>>create_gate` that validate input and auto-create resources.

See [Script Tools Guide](../guides/script-tools.md) for building script-enabled prompts.

---

## MCP Tool Architecture

### External vs Internal Tools

The server exposes **3 MCP tools** to clients but internally uses **5 specialized managers**:

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Protocol (3 tools)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │prompt_engine│  │resource_manager│ │system_control│       │
│  └──────┬──────┘  └───────┬──────┘  └───────┬──────┘        │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Internal Managers                         │
│  ┌─────────────────┐                                        │
│  │PromptExecution  │ ← prompt_engine routes here            │
│  │   Pipeline      │                                        │
│  └─────────────────┘                                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           resource_manager routes to:                 │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐     │   │
│  │  │PromptManager│ │ GateManager │ │FrameworkMgr │     │   │
│  │  │(prompt CRUD)│ │ (gate CRUD) │ │(method CRUD)│     │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────┐                                        │
│  │ SystemControl   │ ← system_control routes here           │
│  │ (status, config)│                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

### Tool Responsibilities

| Tool | Purpose | Internal Target |
|------|---------|-----------------|
| `prompt_engine` | Execute prompts and chains | PromptExecutionPipeline |
| `resource_manager` | CRUD for prompts, gates, methodologies | Routes to PromptManager, GateManager, or FrameworkManager based on `resource_type` |
| `system_control` | System status, framework switching, analytics | SystemControl service |

### Why This Design?

1. **Token Economy**: 3 tools consume less context than 5+ tools
2. **Intent Clarity**: LLMs route better through a unified CRUD interface
3. **Separation of Concerns**: Internal managers can evolve independently
4. **Contract Stability**: External API (3 tools) stays stable while internal structure can change

---

## Pipeline State Management

Three centralized components prevent bugs from distributed state:

### State Components

| Component                    | Purpose                                          | Access                       |
| ---------------------------- | ------------------------------------------------ | ---------------------------- |
| `GateAccumulator`            | Collects gates with priority-based deduplication | `context.gates`              |
| `DiagnosticAccumulator`      | Collects warnings/errors from stages             | `context.diagnostics`        |
| `FrameworkDecisionAuthority` | Single source for framework decisions            | `context.frameworkAuthority` |

### GateAccumulator

Prevents duplicate gates by tracking source priority:

```typescript
// Priority order (higher wins):
// inline-operator (100) > client-selection (90) > temporary-request (80) >
// prompt-config (60) > chain-level (50) > methodology (40) > registry-auto (20)

context.gates.add("research-quality", "registry-auto");
context.gates.addAll(methodologyGates, "methodology");
const finalGates = context.gates.getAll(); // Deduplicated
```

### FrameworkDecisionAuthority

Resolves framework from multiple sources:

```typescript
// Priority: modifiers (%clean/%lean) > @ operator > client > global
const decision = context.frameworkAuthority.decide({
  modifiers: context.executionPlan?.modifiers,
  operatorOverride: context.parsedCommand?.frameworkOverride,
  clientOverride: context.state.framework.clientOverride,
  globalActiveFramework: "CAGEERF",
});
if (decision.shouldApply) {
  // Use decision.frameworkId
}
```

### DiagnosticAccumulator

Creates audit trail across stages:

```typescript
context.diagnostics.info(this.name, "Gate enhancement complete", {
  gateCount: context.gates.size,
  sources: context.gates.getSourceCounts(),
});
```

---

## Ephemeral vs Persistent State

Understanding which state survives across MCP requests is critical for cross-request features.

### State Lifecycle

| Category               | Lifecycle                        | Storage                | Access                       |
| ---------------------- | -------------------------------- | ---------------------- | ---------------------------- |
| **Ephemeral**          | Dies after each request          | `ExecutionContext`     | `context.state.*`            |
| **Session-Persistent** | Survives across session requests | `ChainSessionManager`  | `chainSessionManager.get*()` |
| **Global-Persistent**  | Survives server restarts         | `runtime-state/*.json` | State managers               |

### Ephemeral State (Per-Request)

Recreated fresh for every MCP tool call:

```typescript
// WRONG: Lost after response
context.state.gates.retryLimitExceeded = true;

// Request 2: Always undefined!
if (context.state.gates.retryLimitExceeded) {
  /* Never runs */
}
```

### Session-Persistent State

Survives across requests for the same session:

```typescript
// CORRECT: Persists to runtime-state/chain-sessions.json
await chainSessionManager.setPendingGateReview(sessionId, review);

// Next request: Works!
const review = chainSessionManager.getPendingGateReview(sessionId);
```

### Global-Persistent State

Survives server restarts:

| State               | Manager                  | File                                   |
| ------------------- | ------------------------ | -------------------------------------- |
| Framework selection | `FrameworkStateManager`  | `runtime-state/framework-state.json`   |
| Gate system enabled | `GateSystemManager`      | `runtime-state/gate-system-state.json` |
| Chain sessions      | `ChainSessionManager`    | `runtime-state/chain-sessions.json`    |
| Argument history    | `ArgumentHistoryTracker` | `runtime-state/argument-history.json`  |

### State Flow Diagram

```
Request 1                          Request 2
─────────                          ─────────
context.state = {}                 context.state = {}  ← Fresh!
    │                                  │
    ▼                                  ▼
Set ephemeral flag                 Ephemeral flag is undefined
context.state.X = true                 │
    │                                  ▼
    ▼                              Read from session manager
Save to session manager            chainSessionManager.get*(sessionId)
chainSessionManager.set*(...)          │
    │                                  ▼
    ▼                              State available!
Response sent
(context.state discarded)
```

### Anti-Patterns

```typescript
// WRONG: Storing cross-request state in context
context.state.gates.retryLimitExceeded = true; // Lost!

// WRONG: Mixing ephemeral and persistent reads
const fromContext = context.state.gates.enforcementMode; // Ephemeral
const fromSession = chainSessionManager.getPendingGateReview(sessionId); // Persistent
// These may be out of sync!

// CORRECT: Single source of truth
const isExceeded = chainSessionManager.isRetryLimitExceeded(sessionId); // Always persistent
```

---

## Context Management

Two context systems serve different purposes:

### TextReferenceManager

- **Purpose**: Chain step outputs, template references, placeholder resolution
- **Scope**: Execution sessions
- **Storage**: In-memory + optional file persistence
- **Use cases**: Multi-step chains, template interpolation, gate review context

### ArgumentHistoryTracker

- **Purpose**: Execution arguments and step results for reproducibility
- **Scope**: Execution sessions
- **Storage**: File-based (`runtime-state/argument-history.json`)
- **Use cases**: Gate reviews, debugging, step replay

```mermaid
graph TB
    subgraph "MCP Client"
        A[User Request]
    end

    subgraph "Prompt Engine"
        B[Request Processing]
        C[Parallel Context Tracking]
    end

    subgraph "Context Managers"
        D[TextReferenceManager]
        E[ArgumentHistoryTracker]
    end

    subgraph "Execution"
        F[Prompt/Template/Chain]
        G[Gate Review]
    end

    A --> B --> C
    C --> D
    C --> E
    D --> F
    E --> F
    F --> G
    E --> G
```

---

## Framework Guidance Injection

`InjectionDecisionService` controls what gets prepended to prompts at execution time.

### Injection Types

| Type | Injects | Default Frequency (Chains) |
|------|---------|---------------------------|
| `system-prompt` | Framework methodology (CAGEERF phases, ReACT loop) | Every 2 steps |
| `gate-guidance` | Quality validation criteria | Every step |
| `style-guidance` | Response formatting hints | First step only |

### Resolution Hierarchy

Each injection type resolves independently through a 7-level hierarchy. First match wins:

```
Modifier → Runtime Override → Step Config → Chain Config → Category Config → Global Config → System Default
   ↑              ↑               ↑             ↑              ↑               ↑              ↑
 %clean     system_control    per-step      per-chain     per-category    config.json    hardcoded
```

**Key internals**:
- `HierarchyResolver` walks the config tree for each injection type
- `ConditionEvaluator` handles conditional rules (gate status, step position)
- Decisions are cached per-request in `InjectionDecisionService`
- Frequency modes: `every` (with interval), `first-only`, `never`

For user-facing configuration and examples, see [MCP Tooling Guide → Injection Control](../reference/mcp-tools.md#injection-control).

---

## Component Architecture

### Runtime (`src/runtime/`)

Four-phase startup:

1. **Foundation**: Config, environment, logging
2. **Data Loading**: Prompt registry, framework guides
3. **Module Init**: MCP tools, transports, execution engine
4. **Launch**: Health monitoring, graceful shutdown

### Transports (`src/server/transport/`)

| Transport           | Protocol                       | Use Case                     | Status          |
| ------------------- | ------------------------------ | ---------------------------- | --------------- |
| STDIO               | Line-based JSON                | Claude Desktop, Claude Code  | Active          |
| Streamable HTTP     | HTTP POST/GET with SSE streams | Web dashboards, remote APIs  | **Recommended** |
| SSE                 | HTTP Server-Sent Events        | Legacy integrations          | Deprecated      |

**Streamable HTTP** (`--transport=streamable-http`):
- One endpoint (`/mcp`) handles POST, GET, DELETE—no separate message paths
- Sessions tracked via `mcp-session-id` header
- Use this for web clients and remote APIs. SSE is deprecated.

Transport auto-detects at startup. All modes share the same message handling.

### Prompts (`src/prompts/`)

- **Registry**: Dynamic registration with category organization
- **Hot-Reload**: File watching with debounced updates
- **Templates**: Nunjucks with custom filters and async rendering

### Frameworks (`src/frameworks/`)

- **Manager**: Stateless orchestration, loads definitions from methodology registry
- **State Manager**: Persists active framework to `runtime-state/framework-state.json`
- **Guides**: CAGEERF, ReACT, 5W1H, SCAMPER implementations

### Gates (`src/gates/`)

- **Manager**: Orchestrates gate lifecycle and validation
- **Registry**: Hot-reloaded gate definitions from `server/gates/`
- **Services**: Gate resolution, guidance rendering, compositional gates

### Styles (`src/styles/`)

- **Manager**: Orchestrates style lifecycle
- **Registry**: Hot-reloaded style definitions from `server/styles/`
- **Loader**: YAML + MD parsing with schema validation

### Execution (`src/execution/`)

- **Pipeline**: 21-stage sequential processing (see [Stage Execution Order](#stage-execution-order))
- **Parsers**: Multi-format (symbolic `-->`, JSON, key=value)
- **Context**: `ExecutionContext` with type guards for chain vs single execution
- **Validation**: Request schema validation via generated Zod schemas

---

## Performance Characteristics

| Operation        | Target    | Notes                  |
| ---------------- | --------- | ---------------------- |
| Server startup   | <3s       | 4-phase initialization |
| Tool response    | <500ms    | Most operations        |
| Framework switch | <100ms    | Methodology change     |
| Template render  | <50ms     | Complex Nunjucks       |
| Chain step       | 100-500ms | Depends on complexity  |

### Memory Management

- **Session cleanup**: 24h default for stale sessions
- **Argument history**: Configurable retention limits
- **Template cache**: LRU with size limits
- **Temporary gates**: Auto-expiration

---

## Contract-Driven Development

MCP tool parameters and descriptions are generated from contract files:

### Contract Flow

```
tooling/contracts/*.json          # Source of truth
        │
        ▼ npm run generate:contracts
        │
src/tooling/contracts/_generated/
├── mcp-schemas.ts                # Zod schemas for validation
├── tool-descriptions.contracts.json  # Tool descriptions
└── *.generated.ts                # Per-tool TypeScript types
```

### Why Contracts?

1. **Single Source of Truth**: Parameter definitions live in one place
2. **Type Safety**: Generated Zod schemas ensure runtime validation matches types
3. **Hot-Reload**: Tool descriptions can update without code changes
4. **Documentation Sync**: Parameter docs generated from contracts

See [MCP Contract Standards](../../.claude/rules/mcp-contracts.md) for maintenance workflow.

---

## Where to Go Next

| Topic                      | Guide                                               |
| -------------------------- | --------------------------------------------------- |
| MCP command syntax         | [MCP Tooling Guide](../reference/mcp-tools.md)      |
| Quality gates & validation | [Gates](../guides/gates.md)                         |
| Multi-step workflows       | [Chains](../guides/chains.md)                       |
| Prompt templates           | [Prompt Authoring Guide](../guides/prompt-authoring-guide.md) |
| Common issues              | [Troubleshooting](../guides/troubleshooting.md)     |
| Design decisions           | [Design Decisions](../portfolio/design-decisions.md) |
