# Architecture Decision Records (ADRs)

This directory stores Architecture Decision Records (ADRs) for the Claude Prompts MCP server.

Use ADRs to capture _why_ a technical decision was made, what alternatives were considered, and
what tradeoffs we accepted. ADRs are written for future maintainers (humans + tooling) to reduce
context loss and prevent architecture drift.

## When to write an ADR

Write an ADR when you make a change that is hard to reverse or has cross-cutting impact, for example:

- Changes to transports (STDIO/Streamable HTTP parity), lifecycle, or runtime state handling.
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

Start with `0000-template.md` and fill it in, or run `node scripts/adr.mjs new "<title>"` from the
repository root: it writes the next number with the template's front matter and re-indexes.
`node scripts/adr.mjs check` lists any inconsistency between the files and the index below.

## Index

<!-- adr-index:start -->

| #    | Title                                                                                                                                                       | Status   | Date       | Supersedes | Superseded by | Initiative        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------- | ------------- | ----------------- |
| 0001 | [Gate Resolution Precedence](0001-gate-resolution-precedence.md)                                                                                            | accepted | 2026-07-29 |            |               |                   |
| 0002 | [Refuse Schema Downgrades During Initialization](0002-schema-downgrade-refusal.md)                                                                          | proposed | 2026-09-30 |            |               |                   |
| 0003 | [The Plan footer is the join key between a PR and its initiative](0003-the-plan-footer-is-the-join-key-between-a-pr-and-its.md)                             | accepted | 2026-10-06 |            |               | delivery-contract |
| 0004 | [A plan ruling a consumer can observe becomes an ADR in the pull request that ships it](0004-a-plan-ruling-a-consumer-can-observe-becomes-an-adr-in-the.md) | accepted | 2026-09-28 |            |               | delivery-contract |

<!-- adr-index:end -->
