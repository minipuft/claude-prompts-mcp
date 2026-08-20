---
title: "Mastra.ai Integration – Client-Centric / Planner-First Implementation Plan"
date: 2025-11-04
status: backlog
tags: []
---

# Mastra.ai Integration – Client-Centric / Planner-First Implementation Plan

- **Status**: Ready for Implementation (Revised)
- **Created**: 2025-11-04
- **Last Refined**: 2025-11-05
- **Priority**: High
- **Complexity**: High
- **Duration**: ≈12 weeks (3 phases with decision gates)
  **Related Plans**:

- Plop Scaffolding Integration (dev + runtime capture)
- Plop Scaffolding Implementation Plan
- Claude Prompts MCP – Frameworks & Chains Design

---

## Executive Summary

Mastra.ai is integrated as an internal helper for the claude-prompts-mcp server. The host MCP client LLM (Claude, Cursor, etc.) remains the primary agent responsible for reasoning and tool orchestration. Mastra enhances the system by supplying:

- **Routing hints**: multi-model strategy suggestions (cost/latency) delivered as metadata.
- **RAG services**: embeddings, retrieval, and context assembly exposed to the host LLM.
- **Optional server-side workflows**: only when explicitly invoked via new workflow tools.

Key invariants:

- Symbolic commands (`-->`, `@`, `::`, `@scaffold >>plop`) retain their meaning.
- `prompt_manager` remains client-driven; Mastra does not design or execute prompts by default.
- Plop-based template capture stays untouched; Mastra may assist with context but never replaces it.
- Mastra features are feature-flagged, opt-in, and degrade gracefully.

---

## Architecture Overview (Revised)

### High-Level Integration Pattern

```
┌───────────────────────────────────────────────────────────────┐
│ Claude Desktop / Cursor / Other MCP Host                     │
│ • User interacts with LLM                                    │
│ • Host LLM owns reasoning & tool loop                        │
└─────────────────────┬─────────────────────────────────────────┘
                      │ MCP Protocol (STDIO/SSE)
                      ▼
┌───────────────────────────────────────────────────────────────┐
│ CLAUDE-PROMPTS MCP SERVER – PUBLIC API (UNCHANGED)           │
│                                                               │
│  MCP Tools:                                                  │
│  • prompt_engine(action, promptId, args)                     │
│  • prompt_manager(action, filters)                           │
│  • system_control(action, framework | index_for_rag | …)     │
│  • NEW: workflow.plan / workflow.execute_server_side         │
│                                                               │
│  Symbolic Commands (UNCHANGED):                              │
│  • Chain operator:      -->                                  │
│  • Framework operator:  @                                    │
│  • Gate operator:       ::                                   │
│  • Scaffold operator:   @scaffold >>plop                     │
└─────────────────────┬─────────────────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────────────────┐
│ INTEGRATION LAYER (NEW - INTERNAL ONLY)                       │
│                                                               │
│  Semantic Hints & Planning                                   │
│  • Existing semantic analyzer                                │
│  • Mastra-backed routing hints (model tags, cost estimates)  │
│  • Mastra-backed workflow planner ( JSON plans )             │
│                                                               │
│  RAG Services                                                │
│  • Embedding & vector search (pgvector)                      │
│  • Context retrieval & assembly                              │
│  • Returns contexts + optional enhanced prompts              │
│                                                               │
│  Optional Server-Side Workflows                              │
│  • Mastra workflows wrapping existing operators              │
│  • Exposed via explicit workflow tools only                  │
└─────────────────────┬─────────────────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────────────────┐
│ MASTRA CORE (INTERNAL ONLY)                                  │
│                                                               │
│  • Multi-provider LLM management                             │
│  • Vector store clients (pgvector)                           │
│  • Workflow runtime (XState etc.)                            │
│  • Observability (OTLP / JSON spans)                         │
└───────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **Client-Centric Agent Model** – Host LLM executes the loop. The server never hijacks prompt execution by default.
2. **Mastra as Internal Helper** – Mastra powers routing hints, RAG, and optional workflows, but remains invisible to clients.
3. **Symbolic DSL & Tools Unchanged** – Semantics of `-->`, `@`, `::`, `@scaffold` and existing tools stay intact.
4. **Feature-Flagged & Opt-In** – `mastra.enabled` plus per-feature flags (`routingHints`, `rag`, `workflows`) default to false.
5. **Graceful Degradation** – If Mastra fails, hints/context/workflows are omitted, and the host LLM continues normally.
6. **Plop & Template Capture Preservation** – prompt_manager instructions and Plop-backed persistence remain client-driven.

---

## Phase 1 (Weeks 1–4): Routing Hints & Multi-LLM Strategy

### Goal

Provide routing hints (model selection + cost/latency estimates) without changing the normal `prompt_engine` behavior. The host LLM remains responsible for executing the prompt.

### Deliverables

- Updated configuration schema & environment variables for routing hints.
- Mastra client singleton and semantic router that emit hints.
- `prompt_engine` returns rendered prompt + metadata (analysis + hints) without calling Mastra LLMs by default.
- Tests verifying metadata inclusion and fallback behavior.

### Tasks

1. **Dependencies & Env Setup**
   - Add `@mastra/core` and Node 18+ requirement.
   - Introduce env flags:
     ```
     MASTRA_ENABLED=false
     MASTRA_ROUTING_HINTS_ENABLED=false
     MASTRA_RAG_ENABLED=false
     MASTRA_WORKFLOWS_ENABLED=false
     ```
   - Document provider API keys (OpenAI/Anthropic/Google/Groq).

2. **Config Schema (routing hints)**
   - Rename `semanticRouting` → `routingHints`.
   - Include default model map and cost controls.
   - Add TypeScript types `MastraConfig`, `RoutingHintsConfig`.

3. **Mastra Client Initialization**
   - Create `server/src/mastra/mastra-client.ts`.
   - Initialize providers only when keys exist.
   - Expose `isEnabled()` and `getInstance()` for internal use.
   - Do not auto-invoke Mastra; only used when a feature requests it.

4. **Routing Hint Engine**
   - Implement `SemanticLLMRouter.selectModel()` returning: `{ selectedModel, reasoning, estimatedCost, estimatedLatency }`.
   - Cache decisions keyed on semantic analysis.
   - Provide optional `generateWithRouting()` for opt-in server-side usage (Phase 3), but not invoked by `prompt_engine`.

5. **Enhanced Semantic Analyzer**
   - Modify analyzer to optionally include `routingDecision` metadata in `analyzeWithRouting()`.
   - The default execution path does **not** call Mastra LLMs; it only attaches hints.

6. **prompt_engine Integration**
   - After rendering template, if `routingHints` feature is enabled:
     - Call analyzer to obtain `{ analysis, routingDecision }`.
     - Return original rendered prompt plus metadata `{ semanticAnalysis, routingHints }`.
   - Ensure fallback logs warnings and continues if hints fail.

7. **Testing & Acceptance**
   - Unit tests for router selection, caching, fallback.
   - Integration test verifying `prompt_engine` response includes hints when enabled and remains unchanged when disabled.
   - Performance goal: routing takes <50ms per request.

---

## Phase 2 (Weeks 5–8): RAG Services for Context & Hints

### Goal

Expose Mastra-backed RAG as contextual metadata. The host LLM decides how to use retrieved context; the server does not execute the enhanced prompt.

### Deliverables

- pgvector migration & optional reranking support.
- RAG agent that can embed/index/retrieve content.
- `prompt_engine` optionally returns `rag` metadata (contexts, enhancedPrompt) alongside the original template.
- Tests ensuring RAG metadata is additive and opt-in.

### Tasks

1. **Vector Store Setup**
   - Add RAG config with `vectorStore`, `embedding`, `retrieval` options.
   - Provide migration for pgvector (enable extension, create table & indexes).
   - Supply migration runner script.

2. **RAG Agent Implementation**
   - Create `server/src/mastra/rag-agent.ts` with methods:
     - `embed()`, `index()`, `retrieve()`, `enhancePrompt()` (returns contexts + optional `enhancedPrompt` string).
   - Use Mastra embeddings API (respect flags).
   - Ensure indexing content is explicit via tooling (e.g., `system_control index_for_rag`).

3. **prompt_engine Integration**
   - After rendering template, when `rag` feature enabled:
     - Call `ragAgent.enhancePrompt(renderedPrompt)`.
     - Return metadata `{ rag: { enhancedPrompt, contexts, retrievalTime, similarities } }`.
   - Original `content` remains the raw rendered prompt.
   - Host LLM may choose to use `enhancedPrompt` or the contexts.

4. **Tooling & Indexing**
   - Extend `system_control` to provide `action=index_for_rag` for clients to push content.
   - Ensure alignment with Plop (RAG uses same template/library paths as data sources).

5. **Testing & Acceptance**
   - Integration tests confirming RAG metadata present when enabled, absent otherwise.
   - Validate no server-side LLM execution occurs during standard prompt flow.
   - Document retrieval behavior and fallback cases.

---

## Phase 3 (Weeks 9–12): Optional Server-Side Workflows

### Goal

Expose Mastra workflows as opt-in server tools without altering default chain execution. Standard symbolic DSL remains client-driven; workflows run server-side only on explicit request.

### Deliverables

- Workflow adapter translating symbolic definitions into Mastra workflows.
- New MCP tools: `workflow.plan`, `workflow.execute_server_side`, `workflow.preview_execution`.
- Observability and suspend/resume support scoped to workflow tools.
- Tests ensuring default chain execution path is unaffected.

### Tasks

1. **Workflow Adapter**
   - Build adapter mapping symbolic operators to workflow steps (prompt/tool/framework/gate).
   - Support optional integration with routing hints and RAG context internally.

2. **New MCP Tools**
   - `workflow.plan`: returns structured plan (no execution).
   - `workflow.execute_server_side`: runs entire flow via Mastra workflow adapter; returns final result + metrics.
   - `workflow.preview_execution`: optional “dry run” showing upcoming steps.
   - All tools check `MASTRA_WORKFLOWS_ENABLED`.

3. **Chain Execution Boundaries**
   - Keep existing chain execution path (`executeChain`) client-driven.
   - Document that workflows are an advanced option for heavy or private tasks.

4. **Suspend/Resume & Observability**
   - Integrate with existing observability infrastructure (OpenTelemetry / JSON spans).
   - Provide hooks for workflow progress, attempt counts, and errors.

5. **Testing & Acceptance**
   - Ensure standard chains still pass existing tests with workflows disabled.
   - Add integration tests for each workflow tool, verifying opt-in behavior.
   - Confirm logs/metrics emitted only when workflows run.

---

## Compatibility with prompt_manager & Plop

- `prompt_manager` continues to generate instructions/templates for the client LLM to interpret.
- `template_library.save` and Plop scaffolding flows remain responsible for writing templates; Mastra never edits files directly.
- RAG can expose similar templates/components to the host LLM as hints.
- Workflows can be used to orchestrate scaffolding flows when explicitly invoked, but default tooling remains unchanged.

---

## Feature Flags & Degradation

- `MASTRA_ENABLED` plus per-feature flags govern availability.
- Failures in hints/RAG/workflows log warnings and return control to existing logic.
- When all flags are false, the system behaves exactly as before.

---

## Risk & Mitigation Summary

- **Risk**: Accidental takeover of host LLM loop.
  - _Mitigation_: Default flows never call Mastra LLM; server-side execution only inside workflow tools.
- **Risk**: Increased latency.
  - _Mitigation_: Feature flags off by default; monitor routing/RAG timings.
- **Risk**: Conflicts with Plop/templates.
  - _Mitigation_: Keep Plop flows client-driven; Mastra offers hints/context only.
- **Rollback Strategy**: Disable features via config/environment; server reverts to legacy behavior.

---

## Documentation & Rollout

- Update architecture docs describing Mastra as internal helper.
- Document metadata contracts (routing hints, RAG contexts).
- Provide instructions for enabling features and required API keys.
- Announce availability to internal teams with emphasis on opt-in nature.
- Monitor metrics/telemetry before enabling features broadly.

---

## Summary

This plan integrates Mastra.ai to deliver routing hints, RAG capabilities, and optional planner-first workflows without altering the fundamental client-led orchestration model. The host LLM remains in charge, symbolic DSL semantics stay intact, and Plop-driven template workflows continue unimpeded. All enhancements are opt-in, feature-flagged, and degrade gracefully, setting the stage for richer internal assistance while preserving external MCP contracts.
