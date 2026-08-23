<!-- Deep reference for .claude/rules/mcp-contracts.md. The rule owns activation and
critical constraints; this guide owns procedures and examples. Commands run from server/. -->

# MCP Contract Maintenance

Use this guide when modifying MCP tool parameters, schemas, or tool descriptions. The compact
activation rule lives in `.claude/rules/mcp-contracts.md`.

## Single Source of Truth

**Hand-written Zod schemas** in `src/mcp/tools/schemas/` are the SSOT for MCP parameter validation.

**Contracts** are the SSOT for:

- Tool descriptions → generated to `_generated/tool-descriptions.contracts.json`
- Parameter metadata → generated to `_generated/*.generated.ts`
- TypeScript documentation and parameter tables

Contracts no longer generate Zod schemas — `mcp-schemas.ts` has been removed.

## Critical: Upstream Verification

**BEFORE adding parameters to contracts, verify existing implementations:**

```bash
# 1. Check what the SERVICE layer expects
grep -rn "parameterName" src/modules/versioning/ src/engine/gates/ src/engine/frameworks/

# 2. Check what the MANAGER layer expects
grep -rn "parameterName" src/mcp/tools/*/core/manager.ts

# 3. Check what the ROUTER layer transforms
grep -rn "parameterName" src/mcp/tools/resource-manager/core/router.ts
```

**Why?** The versioning system had `version` (contract) vs `from_version` (manager) mismatch because the contract was written without checking existing code.

## Layer Consistency Requirements

When adding a new parameter, verify consistency across ALL layers:

| Layer    | File Location                       | What to Check                          |
| -------- | ----------------------------------- | -------------------------------------- |
| Schema   | `src/mcp/tools/schemas/*.schema.ts` | Zod schema defines validation          |
| Contract | `tooling/contracts/*.json`          | Parameter descriptions, metadata       |
| Router   | `resource-manager/core/router.ts`   | Transforms or passes through correctly |
| Types    | `*/core/types.ts`                   | TypeScript type matches schema         |
| Manager  | `*/core/manager.ts`                 | Expects same parameter name/type       |
| Service  | `src/{domain}/`                     | Underlying function signature          |

**All layers must use the same:**

- Parameter name (no hidden transformations)
- Parameter type (string vs number vs enum)
- Required/optional status

## Parameter Naming Standards

**Use canonical names from the service layer up:**

```
Service expects: from_version, to_version
       ↓
Manager expects: from_version, to_version
       ↓
Router passes: from_version, to_version (no transformation)
       ↓
Contract defines: from_version, to_version
       ↓
User provides: from_version, to_version
```

**Anti-pattern (what we had):**

```
Service expects: from_version, to_version
       ↓
Manager expects: from_version, to_version
       ↓
Router TRANSFORMS: version → from_version (hidden!)
       ↓
Contract defines: version, compare_to (different names!)
       ↓
User confused: which name to use?
```

## Type Consistency Checklist

Before adding a parameter, verify types match:

| Contract Type     | Zod Type                | TypeScript Type     | Service Param |
| ----------------- | ----------------------- | ------------------- | ------------- |
| `"string"`        | `z.string()`            | `string`            | `string`      |
| `"number"`        | `z.number()`            | `number`            | `number`      |
| `"boolean"`       | `z.boolean()`           | `boolean`           | `boolean`     |
| `"enum[a\|b\|c]"` | `z.enum(['a','b','c'])` | `'a' \| 'b' \| 'c'` | union type    |

**Common mistake:** Contract says `"type": "string"` but service expects `number`.

## Modification Workflow

When adding or modifying MCP tool parameters:

### Step 1: Verify Upstream First

```bash
# What does the service expect?
grep -rn "functionName" src/ --include="*.ts" -A 5
```

### Step 2: Update Contract

Edit `tooling/contracts/*.json`:

- Use the SAME parameter name as the service
- Use the SAME type as the service
- Include proper `status`, `compatibility`, and migration notes

### Step 3: Update Types (if needed)

If the router/manager types don't include the new parameter:

- Update `src/mcp/tools/*/core/types.ts`

### Step 4: Update Router (if needed)

If routing to a specific manager:

- Add parameter pass-through in `router.ts`
- **NO transformations** - use same names throughout

### Step 5: Regenerate and Validate

```bash
npm run generate:contracts
npm run typecheck && npm run build && npm test
```

### Step 6: Test End-to-End

```bash
# Test the actual MCP tool
npm run start:stdio
# Then use the tool with the new parameter
```

## Pre-Commit Checklist

Before committing parameter changes:

- [ ] Verified service/manager expects this parameter name and type
- [ ] Updated contract with matching name/type
- [ ] Updated types.ts if parameter is new
- [ ] Updated router.ts to pass through parameter
- [ ] Ran `npm run generate:contracts`
- [ ] Ran `npm run typecheck && npm run build`
- [ ] Tested MCP tool with new parameter
- [ ] Updated `docs/reference/mcp-tools.md`

## Schema Architecture

**Zod schemas are hand-written** in `src/mcp/tools/schemas/`:

- `prompt-engine.schema.ts` — schema factory with `DescriptionResolver` for framework overlays
- `system-control.schema.ts` — system control input schema
- `resource-manager.schema.ts` — resource manager input schema with gate sub-schemas

**Generated files** in `_generated/` are metadata only (parameter tables, tool descriptions).
Never edit generated files — they are overwritten by `npm run generate:contracts`.

```bash
# ❌ WRONG: Editing generated files
vim src/mcp/contracts/schemas/_generated/prompt_engine.generated.ts

# ✅ RIGHT: Edit Zod schemas for validation
vim src/mcp/tools/schemas/prompt-engine.schema.ts

# ✅ RIGHT: Edit contracts for descriptions/metadata
vim tooling/contracts/prompt-engine.json
npm run generate:contracts
```

## Contract Structure

```json
{
  "tool": "resource_manager",
  "version": 1,
  "parameters": [
    {
      "name": "from_version",
      "type": "number",
      "description": "[Versioning] Starting version for comparison.",
      "status": "working",
      "includeInDescription": false
    }
  ]
}
```

## Validation Commands

```bash
# Check if generated files are stale
npm run validate:contracts

# Find direct edits to generated files (should be empty)
git diff --name-only | grep "_generated"

# Verify all layers use consistent names
grep -rn "version" src/mcp/tools/ --include="*.ts" | grep -v test
```

## Description Semantics

**Tool descriptions serve parameter construction at invocation time — not reasoning calibration over a session.**

Tool descriptions and parameter text are consumed by an LLM at the moment it needs to construct a correct function call. This is a different cognitive task than reading rules or CLAUDE.md directives. Effective patterns:

| Pattern            | In tool descriptions                 | In rules/directives   |
| ------------------ | ------------------------------------ | --------------------- |
| Syntax examples    | Dense, inline, canonical             | Pointers to skills    |
| Format specs       | Inline where LLM builds the value    | Reference tables      |
| Reasoning guidance | Short frame label (`[CAGEERF]`)      | Contrastive directive |
| Detail depth       | What's needed for correct invocation | Minimal, pointer-led  |

Do not apply rule-authoring style (contrastive directives, Layer 0/1/2 model) to tool descriptions. Do not apply tool-description style (inline tutorials, multi-format specs) to rules. Evidence about what works in one context does not transfer to the other without testing.

## Anti-Patterns to Avoid

| Anti-Pattern                                       | Why It's Bad                                                | Correct Approach                                 |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Hidden router transformation                       | User sees different names than code                         | Use same names throughout                        |
| Contract type differs from service                 | Runtime errors, type coercion bugs                          | Verify types before adding                       |
| Adding to contract without checking upstream       | Mismatch discovered at runtime                              | Check service/manager first                      |
| Inline schema in tool registration                 | Schema drift, duplication                                   | Import from `src/mcp/tools/schemas/`             |
| Applying rule-directive style to tool descriptions | Different cognitive task, reduces invocation accuracy       | Dense syntax examples for parameter construction |
| Applying tool-description style to rules           | Bloats always-loaded context, weakens reasoning calibration | Short contrastive directives with skill pointers |
