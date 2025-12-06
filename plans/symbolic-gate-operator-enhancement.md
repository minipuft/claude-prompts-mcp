# Symbolic Gate Operator Enhancement

## Overview
Enhance the `::` gate operator in symbolic commands to support inline criteria definitions, not just gate IDs.

## Current Behavior
```
>>prompt :: code-quality        # Works - expands predefined gate
>>prompt :: quality-check       # Falls through as plain text (gate doesn't exist)
```

The `::` operator only parses simple strings. Custom gates with descriptions require the `gates` JSON parameter:
```typescript
prompt_engine({
  command: ">>prompt",
  gates: [{ name: "quality-check", description: "Ensure code follows best practices" }]
})
```

## Proposed Enhancement
Support inline criteria in symbolic syntax:

### Option A: Quoted Description
```
>>prompt :: "quality-check: Ensure code follows best practices"
```

### Option B: Colon-Separated
```
>>prompt :: quality-check:"Ensure code follows best practices"
```

### Option C: Parenthetical
```
>>prompt :: quality-check(Ensure code follows best practices)
```

## Benefits
- Keeps symbolic commands self-contained
- No need to mix symbolic syntax with JSON `gates` parameter
- More expressive ad-hoc quality checks

## Implementation Areas
- `server/src/mcp-tools/prompt-engine/` - symbolic command parser
- `server/src/execution/` - gate processing during execution
- Documentation updates in `docs/mcp-tooling-guide.md`

## Priority
Low - current workaround (using `gates` param) is functional

## Date Added
2024-12-05
