---
title: "Plop-Aware Scaffolding Orchestration PRD"
date: 2025-10-21
status: backlog
tags: []
---

# Plop-Aware Scaffolding Orchestration PRD

**Status**: Draft
**Created**: 2025-10-21
**Priority**: Medium-High
**Complexity**: Medium

## Executive Summary

We rely on deterministic scaffolding (Plop) and intelligent orchestration (MCP). Today, workflows that start with a Plop generator and continue with symbolic chains require manual hand-offs. This PRD defines how the MCP server will detect Plop generators, expose their inputs/outputs, and orchestrate them within symbolic commands so developers can scaffold, inspect, and extend templates without leaving the conversational loop.

## Background & Current Pain

- Plop generators live in `tools/plopfile.js` (and sub-generators), but the MCP server treats them as opaque CLI invocations.
- Symbolic plans that reference scaffolding steps must be executed manually, breaking automation and traceability.
- LLM agents cannot reason about generator variables or resulting file paths, limiting follow-up actions (formatting, linting, adding tests).
- Onboarding requires remembering generator names and arguments instead of discovering them via MCP.

## Goals

1. Detect available Plop generators and surface their metadata (name, description, prompts, target paths) via the MCP runtime.
2. Allow symbolic commands to invoke generators (`@scaffold >>plop generator="component"`) and capture the resulting files as structured outputs.
3. Enable post-scaffold chains (formatting, linting, templated TODO insertion) without manual intervention.
4. Preserve deterministic Plop behavior—no modifications to existing generators required.
5. Provide documentation and observability so developers understand what was scaffolded during a session.

## Non-Goals

- Replacing Plop with an MCP-native templating system.
- Auto-generating new Plop templates.
- Handling migrations for legacy scaffolding tools (Hygen, Yeoman).
- Large-scale refactors of symbolic command parsing beyond what is required for generator invocation.

## User Stories

- **Developer**: “As a developer, I want to scaffold a new operator executor via MCP, inspect the generated files, run formatting, and open follow-up tasks without leaving the chain.”
- **Prompt Author**: “As a prompt author, I want the orchestration note to record which generator ran, the variables used, and where files were created.”
- **Reviewer**: “As a reviewer, I want CI to confirm that scaffolded files still match Plop output for reproducibility.”

## Functional Requirements

1. **Generator Discovery API**
   - Parse `plopfile.(js|ts)` and any referenced sub-generators once at startup (with cache + invalidation on file change).
   - Expose a new internal registry: `PlopGeneratorRegistry` with `listGenerators()` and `getGenerator(name)`.
2. **Symbolic Command Integration**
   - Extend parser to recognize `plop generator="<name>" options='{...}'` segments.
   - Add `PlopOperator` type with metadata (generator name, prompts, default values).
3. **Execution Flow**
   - Implement `PlopOperatorExecutor`:
     - Runs chosen generator via Plop’s programmatic API (no shell exec where possible).
     - Collects generated file paths + contents (up to configurable size limit) as structured response metadata.
     - Emits summary to the prompt body (what was created, next recommended actions).
4. **Post-Processing Hooks**
   - Allow follow-up operators (`format`, `lint`, `git add`) in the same chain to consume the scaffold output.
   - Provide default hints (e.g., `→ Run format` CTA) when scaffold completes.
5. **Observability**
   - Log generator usage (name, duration, output count) at `info` level.
   - Append to execution plan note in `/plans` (if active) with generator run details.
6. **Documentation**
   - Update `docs/scaffolding.md` (new) explaining how Plop + MCP cooperate.
   - Add examples to `docs/symbolic-command-language.md` for `@scaffold >>plop` usage.

## Technical Approach

- **Registry Loader**: Use Plop’s core API (`node-plop`) to load generators during server init. Watch files for changes to refresh registry without restart.
- **Parser Update**: Extend `SymbolicCommandParser` to detect `plop` keyword and capture JSON/key-value args.
- **Execution**: `PlopOperatorExecutor` receives resolved prompts, forwards answers to Plop via programmatic runner, intercepts file writes by wrapping Plop’s `setGenerator` actions (using `add`, `modify`, etc.).
- **File Capture**: Mirror Plop’s file actions in-memory to produce diff previews; optionally persist to disk (existing Plop behavior) then re-read for metadata.
- **Limits & Guards**:
  - Maximum generated file size per chain (configurable, default 50 KB per file) to avoid flooding responses.
  - Deny generators that run arbitrary scripts (security flag via config).

## Dependencies & Impacted Areas

- Adds new module: `server/src/scaffolding/plop-registry.ts` + executor under `execution/operators`.
- Touches symbolic parser, execution engine, logging, plan note updater, documentation.
- CI must install Plop dependency and include a generator fixture for automated tests.

## Testing Strategy

- **Unit Tests**: Registry loader parsing, executor happy-path and error handling, parser detection of `plop` operator.
- **Integration Tests**: End-to-end chain invoking a sample generator, verifying files and metadata.
- **Regression**: Ensure existing symbolic commands (without Plop) still pass.
- **Docs Validation**: Link check new doc entries.

## Risks & Mitigations

- **Generator Side Effects**: Plop actions that run shell commands may have unintended effects. Mitigate by defaulting to a safe mode (whitelist actions) and allowing opt-in via config.
- **Large Output Payloads**: Capturing many files could bloat responses. Enforce size caps and provide download hints instead of inline content when exceeded.
- **Registry Staleness**: Generator changes might not refresh. Use file watchers + manual `reload` command fallback.

## Success Metrics

- ≥80% of new scaffolding tasks initiated through MCP within 30 days of release.
- Reduction in “manual CMD scaffolding” mentions in retro notes.
- Zero incidents of missing generator metadata in plan notes across a sprint.

## Open Questions

- Do we expose generator prompts interactively (each question sequentially) or require JSON args? Plan proposes both: JSON for automation, fallback prompt dialog when omitted.
- Should scaffolding be allowed in readonly workspaces? Likely no; requires explicit config.

## Milestones & Tentative Timeline

1. **Week 1** – Registry loader + parser support (feature flag guarded).
2. **Week 2** – Executor implementation + integration tests with sample generator.
3. **Week 3** – Documentation, plan-note integration, telemetry wiring.
4. **Week 4** – Beta rollout with select generators; collect feedback and iterate.
