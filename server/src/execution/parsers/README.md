# Command Parser Architecture

This directory contains the multi-strategy command parsing system for the prompt engine.

## Overview

The parser uses a **strategy pattern** with multiple parsing strategies tried in confidence order. Each strategy handles specific command formats.

```
Input Command
     │
     ▼
┌─────────────────────┐
│  Strategy Selection │  (sorted by confidence)
└─────────────────────┘
     │
     ├─► Symbolic (0.97) ──► chains, operators, gates
     ├─► Simple (0.95) ────► >>prompt args
     └─► JSON (0.90) ──────► {"prompt": "...", "args": {...}}
```

## Strategy Responsibilities

| Strategy | Confidence | Handles | Detection |
|----------|------------|---------|-----------|
| **Symbolic** | 0.97 | Operators: `-->`, `::`, `@`, `+`, `?`, `#`, `*N` | Regex for operator patterns |
| **Simple** | 0.95 | `>>prompt args` or `prompt args` | Starts with prompt name |
| **JSON** | 0.90 | `{"prompt": "...", "args": {...}}` | Starts with `{` |

## Operator Detection Rules

### Critical Pattern: Detection Must Match Behavior

**The `canHandle` check MUST align with what the strategy can actually parse.**

Example of the bug we fixed (2025-01):
```typescript
// BAD: Detects any `?` character
const hasOperator = /\?/.test(command);
// "is there a bug?" → triggers symbolic, but isn't a conditional operator

// GOOD: Detects the actual conditional pattern
const hasConditionalOperator = /\s*\?\s*["'](.+?)["']\s*:\s*(?:>>)?\s*([A-Za-z0-9_-]+)/.test(command);
// "is there a bug?" → false (natural language)
// `? "cond" : >>branch` → true (actual operator)
```

### Operator Patterns Reference

| Operator | Symbol | Pattern | Status | Example |
|----------|--------|---------|--------|---------|
| Chain | `-->` | `/-->/` | Implemented | `>>a --> >>b` |
| Gate | `::` or `=` | `/\s(::\|=)\s*\S/` | Implemented | `:: "criteria"` |
| Framework | `@` | `/(?:^\|\s)@([A-Za-z0-9_-]+)/` | Implemented | `@CAGEERF >>prompt` |
| Style | `#` | `/(?:^\|\s)#([A-Za-z][A-Za-z0-9_-]*)/` | Implemented | `#analytical >>report` |
| Repetition | `*N` | `/\s+\*\s*(\d+)/` | Implemented | `>>prompt *3` |
| Parallel | `+` | `/\s*\+\s*/` | Reserved | `>>a + >>b + >>c` |
| Conditional | `?` | `/\s*\?\s*["'](.+?)["']\s*:\s*(?:>>)?\s*([A-Za-z0-9_-]+)/` | Reserved | `? "cond" : >>branch` |

### Reserved vs Implemented

- **Implemented**: Full parsing and execution support
- **Reserved**: Detection only, throws "not yet implemented" at execution

## Adding New Operators

### Checklist

1. **Define pattern** in `_generated/operator-patterns.ts`
2. **Update `canHandle`** in BOTH strategies that need to detect it:
   - `createSymbolicCommandStrategy()` — to handle it
   - `createSimpleCommandStrategy()` — to reject it (defer to symbolic)
3. **Add detection** in `symbolic-operator-parser.ts` → `detectOperators()`
4. **Add parsing** in `symbolic-operator-parser.ts` → `parse<Operator>()`
5. **Add execution** in `operators/` directory
6. **Write tests** for:
   - Detection (true positives AND true negatives)
   - Parsing edge cases
   - Natural language false positives (e.g., `?` in questions)

### Common Pitfalls

| Pitfall | Prevention |
|---------|------------|
| Operator symbol appears in natural language | Use full pattern for detection, not just symbol |
| `canHandle` triggers but `parse` fails | Ensure detection regex matches parsing expectations |
| Operator conflicts with argument syntax | Check operator doesn't match inside quoted strings |
| Breaking existing tests | Run full test suite before committing |

## File Structure

```
parsers/
├── command-parser.ts          # Main parser with strategy selection
├── argument-parser.ts         # Argument extraction and validation
├── argument-schema.ts         # Zod schema generation for arguments
├── symbolic-operator-parser.ts # Operator detection and parsing
├── parser-utils.ts            # Shared utilities
├── types/
│   ├── command-parse-types.ts # Result types
│   └── operator-types.ts      # Operator interfaces
└── _generated/
    └── operator-patterns.ts   # Canonical pattern definitions
```

## Testing

```bash
# Unit tests for parsing
npm run test:unit -- --testPathPattern="parsers"

# Test specific operator detection
node -e "
const pattern = /your-pattern-here/;
const cases = ['should match', 'should not match'];
cases.forEach(c => console.log(c + ': ' + pattern.test(c)));
"
```

## Related Documentation

- `docs/reference/mcp-tools.md` — Symbolic command language reference
- `docs/architecture/overview.md` — Pipeline architecture
- `execution/operators/` — Operator execution implementations
