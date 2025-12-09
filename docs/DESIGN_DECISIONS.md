# Architecture & Design Decisions

**Status**: Live
**Last Updated**: November 2025

This document records the key architectural choices, trade-offs, and design philosophies behind the Claude Prompts MCP Server. It serves as a context guide for contributors and engineers to understand _why_ the system is built this way.

---

## 1. Core Philosophy: User-Centric Context Engineering

The primary design driver for this project is the belief that **effective LLM interaction is highly personal**.

Most problems solvable by LLMs require the user to integrate their own reasoning style and workflow preferences. There is no "one size fits all" prompt. Therefore, the system is designed to be an **unopinionated engine for composability**.

- **Workflow Atomization**: We enable users to split their workflows into discrete units—whether that's a single quick prompt or a complex, multi-step chain. The granularity is left to the user, based on the complexity and importance of the task.
- **Focus on Context**: By handling the "plumbing" (parsing, routing, validation), we allow the user to focus entirely on _Context Engineering_—curating the templates and logic that drive the AI, rather than fighting the underlying code.
- **Agent-First Navigation**: The codebase structure, strict typing, and Zod schemas are designed to be easily navigable by LLM coding agents, treating the AI as a first-class maintainer of the system.

## 2. Technical Stack Decisions

### Runtime: Node.js & TypeScript

- **Decision**: Node.js (v16+) with TypeScript.
- **Context**: The application is heavily I/O bound, constantly reading, watching, and reloading prompt files to support the "Hot Reload" feature.
- **Reasoning**:
  - **Ecosystem**: The Node.js `fs` ecosystem provides the most mature and familiar tooling for file-system-based applications.
  - **Scaffolding**: TypeScript is critical. It allows us to generate strict JSON schemas (via Zod) that act as a contract between the deterministic runtime and the probabilistic LLM.

### Transport: STDIO & SSE

- **Decision**: Implementing both standardized MCP transports.
- **Reasoning**:
  - **STDIO**: Essential for local desktop integration (Claude Desktop, Cursor), treating the server as a seamless CLI extension.
  - **SSE (Server-Sent Events)**: Provides a standard HTTP pathway for web-based clients, allowing future scalability or remote deployment without architectural changes.

### Data Storage: JSON vs. SQLite

- **Decision**: File-based persistence using JSON (`promptsConfig.json`, `chain-sessions.json`) for the initial release.
- **Trade-off**:
  - _Pros_: Zero-dependency local deployment. Users can `git clone` and run without setting up database containers. It makes the prompt library easily version-controllable via Git.
  - _Cons_: At scale, parsing large JSON registries on every hot-reload event is inefficient.
  - _Future Path_: A migration to SQLite is planned to support relational queries and better state management while keeping the actual prompt templates as Markdown files.

## 3. Key Architectural Patterns

### The `PromptExecutionPipeline`

Instead of monolithic execution functions, requests are routed through a staged pipeline:
`Request` -> `Normalization` -> `Parsing` -> `Planning` -> `Framework Injection` -> `Gate Validation` -> `Render` -> `Execution`.

- **Why**: **Safety and Observability**.
- Interacting with LLMs involves many "soft" failure points (syntax errors, missing files, validation failures). A pipeline architecture ensures we can track the request state, enforce interfaces, and provide detailed diagnostics at every step before the prompt reaches the LLM.

### Tool Consolidation (Polymorphic Tools)

We consolidated functionality into 3 core tools (`prompt_engine`, `prompt_manager`, `system_control`) rather than exposing 20+ discrete tools.

- **Why**:
  1.  **Token Economy**: Every tool definition consumes context window. Consolidating tools drastically reduces this overhead.
  2.  **Intent Accuracy**: LLMs perform significantly better when routing intent through a single "Manager" tool with distinct actions, rather than hallucinating parameters for 20 separate functions.

### Symbolic DSL (`>>`, `-->`, `::`)

We implemented a custom parser for symbolic commands (e.g., `>>analysis --> summary :: "strict"`).

- **Why**: **Developer Experience**.
- Constructing complex JSON payloads manually is slow and breaks flow. A shorthand syntax allows power users to define chains, attach quality gates, and select frameworks in natural language, which the pipeline then hydrates into structured execution objects.

### Alignment with Vision

This change aligns with the broader goal of making the gate system as dynamic as the framework system—where users can create, register, and manage gates via definition files without code changes.

## 5. Summary

This codebase is an exercise in balancing and learning **strict software engineering patterns** (Pipelines, Zod Validation) with the **flexible nature** of AI agents & workflows. It prioritizes the user's ability to define their own process over enforcing a rigid system structure.
