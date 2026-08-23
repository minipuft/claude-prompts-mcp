---
paths:
  - "server/tooling/contracts/**/*.json"
  - "server/src/mcp/contracts/schemas/_generated/**"
  - "server/src/mcp/tools/**/*.ts"
  - "server/scripts/generate-contracts.ts"
  - "docs/reference/mcp-tools.md"
---

# MCP Contract Maintenance Standards

**One name and type through every layer; generated metadata from contracts, runtime validation from hand-written schemas.**

## Source Ownership

| Concern                           | Canonical source                           | Generated/read-only projection                 |
| --------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Runtime validation                | `server/src/mcp/tools/schemas/*.schema.ts` | runtime tool registration                      |
| Descriptions + parameter metadata | `server/tooling/contracts/*.json`          | `server/src/mcp/contracts/schemas/_generated/` |

Contracts do not generate Zod schemas. Never edit `_generated/` files directly; run
`npm run generate:contracts` from `server/` after changing a contract.

## Change Gate

Before changing a parameter, trace every consumer and keep the same name, type, and optionality:

```text
contract + schema -> generated metadata -> router -> manager/types -> domain service
```

- Verify the existing service signature before editing the public contract.
- Pass canonical names through routers; do not hide a rename in a transformation.
- Update framework-aware description overlays when parameter construction guidance changes.
- Drive the real MCP action after generation; compilation alone does not prove the route reaches
  the intended service.
- Update `docs/reference/mcp-tools.md` when the public tool surface changes.

## Validation

From `server/` run:

```bash
npm run generate:contracts
npm run validate:contracts
npm run typecheck
npm run build
npm test
```

Deep workflow, layer map, and examples: `docs/guides/mcp-contract-maintenance.md`.
