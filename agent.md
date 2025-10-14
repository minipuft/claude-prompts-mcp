# Agent Rules · Claude Prompts MCP

Read this file at session start. Treat every rule as mandatory unless the user explicitly overrides it.

## Mission & Scope
- **Role**: Automation/code-editing agent for the Claude Prompts MCP server repository (`claude-prompts-mcp`).
- **Objective**: Deliver safe, reversible changes that respect MCP protocol guardrails and documented workflows.
- **Hierarchy**: This file embeds global principles, domain conventions, and project-specific rules. No other rule files are loaded.

## Operating Principles (Global Layer)
- **Plan-first mindset** → Outline intent, affected areas, and validation before implementing changes; keep the plan updated as work progresses.
- **Protocol alignment** → Honor Model Context Protocol workflows and documented abstractions; prefer official tools/scripts over ad-hoc commands.
- **Transparent reasoning** → Surface assumptions, blockers, and risks early; record skipped validations with justification.
- **Reversibility** → Make small, reviewable diffs; avoid destructive operations without explicit user approval.
- **Constraint awareness** → Respect sandbox/approval requirements, escalate instead of bypassing safeguards.

## Domain Guidance (Node.js + TypeScript MCP Stack)
- Use Node.js 16+ and TypeScript in strict mode; maintain ES module syntax.
- Keep code hot-reload friendly: prefer pure functions, dependency injection, and descriptive interfaces.
- Follow Jest testing patterns; ensure new modules are testable and covered when practical.
- Maintain compatibility with the multi-platform CI matrix (Ubuntu, macOS, Windows) and Node 16/18/20.
- Avoid introducing unmanaged global state or side effects that could break STDIO/SSE transports.

## Project-Specific Guardrails
- **MCP Tool Usage**: NEVER edit prompt/template/chain files directly. Interact via `prompt_manager`, `prompt_engine`, or `system_control` MCP tools. If direct modification is unavoidable, call it out and justify thoroughly.
- **Hot-Reload Integrity**: Preserve registry synchronization; do not bypass the hot-reload manager or caches unless documented.
- **Enhanced Gate System**: Respect five-level precedence (temporary → template → category → framework → fallback). Keep JSON definitions and TypeScript schemas synchronized.
- **Framework Methodologies**: Document rationale when switching between CAGEERF, ReACT, 5W1H, and SCAMPER. Runtime selections persist in `server/runtime-state/framework-state.json`.
- **Transport Parity**: Ensure changes remain compatible with both STDIO and SSE transports; run targeted smoke checks when touching transport logic.

## Task Workflow (Repeatable Loop)
1. **Discover**: Clarify scope with the user; inspect relevant sources (`CLAUDE.md`, `docs/*.md`, code modules) before editing.
2. **Design**: Outline approach, list affected files, and determine required validation commands or MCP tool operations.
3. **Implement**: Apply minimal, focused edits; keep formatting, linting, and typing consistent; update documentation if behavior changes.
4. **Validate**: Run appropriate scripts (`npm run typecheck`, `npm test`, `npm run validate:all`, targeted diagnostics). If skipped, explain why and assess risk.
5. **Document**: Summarize changes, highlight risks/gaps, suggest next steps, and note validations performed or skipped.

## Code Editing Playbooks
- **TypeScript Modules**: Maintain strict typing; avoid ambient state; prefer descriptive interfaces and enums for shared contracts.
- **Prompt & Chain Logic**: Route adjustments through MCP tools; confirm schema updates in `server/src/mcp-tools` and related validators.
- **Gate System Changes**: Update definitions under `server/src/gates/` and supporting JSON; ensure precedence logic in `temporary-gate-registry`, `gate-state-manager`, and `category-extractor` stays coherent.
- **Transport / Runtime**: Touching `server/src/runtime` or transport layers requires smoke tests via `npm run start:stdio` and `npm run start:sse`; avoid noisy logs in production paths.
- **Configuration**: When editing `config/*.json` or `server/config*.json`, validate with `npm run validate:all` and confirm default values stay backwards compatible.

## Tooling & Command Reference
- Build: `npm run build`
- Type Check: `npm run typecheck`
- Tests: `npm test`
- CI parity: `npm run test:ci`, `npm run validate:all`
- Dev watch: `npm run dev`
- Diagnostics: `npm run start:verbose`, `npm run start:debug`
- Transports: `npm run start:stdio`, `npm run start:sse`, `npm run start:production`

## Validation Expectations
- Run type checks and relevant tests when altering execution paths, schemas, or TypeScript types.
- Use targeted diagnostics for MCP tools, gate logic, and framework behavior when affected.
- Document skipped validations with impact assessment and recommended follow-up.

## Safety & Escalation Checklist
- Confirm with the user before scope jumps or potentially breaking changes.
- Seek approval before destructive git or filesystem operations not explicitly requested.
- Stop immediately and ask for guidance if unexpected repo changes appear or sandbox constraints block required workflows.
- Keep track of lingering risks, TODOs, or follow-up items; store context in `plans/` when long-running work is needed.

## Documentation Map (Reference Only)
- `CLAUDE.md` (historical global rules and context)
- `docs/mcp-tool-usage-guide.md`
- `docs/mcp-tools-reference.md`
- `docs/architecture.md`
- `docs/prompt-management.md`
- `docs/enhanced-gate-system.md`
- `docs/troubleshooting.md`
- `docs/version-history.md`

## Session Closeout
- Ensure working tree cleanliness or clearly communicate outstanding diffs.
- Provide concise final response: change summary, validations run/skipped, risks, and recommended next steps.
- Default to suggesting verification commands when you cannot run them yourself.
