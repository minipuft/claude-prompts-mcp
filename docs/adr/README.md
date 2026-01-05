# Architecture Decision Records (ADRs)

This directory stores Architecture Decision Records (ADRs) for the Claude Prompts MCP server.

Use ADRs to capture *why* a technical decision was made, what alternatives were considered, and
what tradeoffs we accepted. ADRs are written for future maintainers (humans + tooling) to reduce
context loss and prevent architecture drift.

## When to write an ADR

Write an ADR when you make a change that is hard to reverse or has cross-cutting impact, for example:

- Changes to transports (STDIO/SSE parity), lifecycle, or runtime state handling.
- Changes to tool contracts, contract generation, or schema validation approach.
- Changes to gate precedence/activation rules or framework injection behavior.
- New architectural boundaries (dependency-cruiser rules, module ownership, public APIs).
- Build/test/CI policy changes (Node support, gating strategy, lint ratchets).

## File naming and numbering

- Name format: `NNNN-short-title.md` (e.g. `0003-tool-contracts-ssot.md`)
- Increment `NNNN` monotonically.
- Keep titles short and descriptive (avoid vague terms like "refactor" or "cleanup").

## ADR lifecycle states

Use one of:

- `proposed`: drafted, not yet adopted
- `accepted`: adopted and in effect
- `superseded`: replaced by a newer ADR (link to the replacement)
- `deprecated`: no longer recommended, but not formally replaced

## Template

Start with `0000-template.md` and fill it in.

