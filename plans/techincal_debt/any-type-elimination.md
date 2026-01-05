# Any Type Elimination TODO

**Created**: 2025-12-12
**Priority**: Medium
**Status**: Planned

## Overview

This document tracks all remaining `any` type usages in the codebase that should be replaced with proper types. Eliminating `any` improves type safety, IDE support, and catches bugs at compile time instead of runtime.

### Current State

| Metric                       | Count |
| ---------------------------- | ----- |
| `: any` usages               | 224   |
| `Record<string, any>` usages | 100   |
| `as any` casts               | 51    |
| **Total**                    | ~375  |

---

## Phase 1: Critical Infrastructure (High Priority)

These files are core to the system and have the most `any` usage. Fix these first.

### 🔴 `src/mcp-tools/system-control.ts` (30 instances)

**Problem**: Heavy use of `any` for dynamic action handling and framework responses.

**Fix Strategy**:

- [ ] Define `SystemControlAction` union type with discriminated unions
- [ ] Create `FrameworkStatus`, `AnalyticsData`, `ConfigOverlay` interfaces
- [ ] Replace dynamic parameter handling with Zod schemas
- [ ] Use `unknown` + type guards for external data

**Estimated Effort**: 3-4 hours

---

### 🔴 `src/mcp-tools/prompt-manager/core/manager.ts` (21 instances)

**Problem**: Prompt metadata and operation results use `any` extensively.

**Fix Strategy**:

- [ ] Define `PromptOperationResult` interface hierarchy
- [ ] Create `PromptMetadata`, `PromptAnalysis` types
- [ ] Use discriminated unions for action results
- [ ] Replace `Record<string, any>` with specific interfaces

**Estimated Effort**: 2-3 hours

---

### 🔴 `src/logging/index.ts` (15 instances)

**Problem**: Logger interface uses `any[]` for variadic args.

**Fix Strategy**:

- [ ] Change `...args: any[]` to `...args: unknown[]`
- [ ] This is a cascading change - update all implementations
- [ ] Consider `readonly unknown[]` for strictness

**Files Affected**:

- `src/utils/index.ts` (7 instances)
- `src/utils/errorHandling.ts` (5 instances)
- `src/prompts/promptUtils.ts`
- All logger consumers

**Estimated Effort**: 1-2 hours

---

### 🔴 `src/execution/context/context-resolver.ts` (14 instances)

**Problem**: Template contexts and resolved values use `any`.

**Fix Strategy**:

- [ ] Define `TemplateContext` interface with known fields
- [ ] Use `Record<string, unknown>` for extensible parts
- [ ] Add type guards for specific context field access

**Estimated Effort**: 2 hours

---

## Phase 2: MCP Tools Layer (Medium Priority)

### 🟡 `src/mcp-tools/shared/structured-response-builder.ts` (12 instances)

**Fix Strategy**:

- [ ] Define `StructuredContent` interface
- [ ] Use `Record<string, unknown>` for flexible fields
- [ ] Type the builder methods with generics

**Estimated Effort**: 1.5 hours

---

### 🟡 `src/mcp-tools/prompt-engine/core/prompt-execution-service.ts` (8 instances)

**Fix Strategy**:

- [ ] Use existing `FormatterExecutionContext` type
- [ ] Replace `any` results with `ToolResponse`
- [ ] Type chain execution payloads

**Estimated Effort**: 1.5 hours

---

### 🟡 `src/mcp-tools/index.ts` (7 instances)

**Fix Strategy**:

- [ ] Use Zod schemas for MCP tool input validation
- [ ] Define handler result types
- [ ] Replace `any` in tool registration

**Estimated Effort**: 1 hour

---

## Phase 3: Chain & Session Layer (Medium Priority)

### 🟡 `src/chain-session/manager.ts` (11 `Record<string, any>` + 2 `as any`)

**Problem**: Dynamic chain context and session state use `any`.

**Fix Strategy**:

- [ ] Define `ChainContext` interface with known fields
- [ ] Create `ChainMetadata` type
- [ ] Use `Record<string, unknown>` for truly dynamic parts
- [ ] Type `originalArgs` properly

**Estimated Effort**: 2 hours

---

### 🟡 `src/chain-session/types.ts` (8 `Record<string, any>`)

**Problem**: Core type definitions use `any` for flexibility.

**Fix Strategy**:

- [ ] Replace `Record<string, any>` with `Record<string, unknown>`
- [ ] Define specific interfaces for known structures
- [ ] Consider generics for flexible containers

**Estimated Effort**: 1.5 hours

---

## Phase 4: Execution Pipeline (Medium Priority)

### 🟡 `src/execution/parsers/argument-parser.ts` (7 instances)

**Fix Strategy**:

- [ ] Type `getFromArgumentDefault` return value properly
- [ ] Define `ParsedArgument` with value types
- [ ] Use union types for coerced values

**Estimated Effort**: 1.5 hours

---

### 🟡 `src/mcp-tools/prompt-engine/utils/context-builder.ts` (9 `Record<string, any>`)

**Fix Strategy**:

- [ ] Define `ExecutionContext` interface
- [ ] Type known context fields
- [ ] Use `Record<string, unknown>` for extensions

**Estimated Effort**: 1 hour

---

## Phase 5: Type Definition Files (Low Priority)

### 🟢 `src/mcp-tools/prompt-engine/core/types.ts` (6 + 7)

**Problem**: Core type definitions intentionally use `any` for flexibility.

**Fix Strategy**:

- [ ] Replace with `unknown` where possible
- [ ] Use generics for container types
- [ ] Define specific interfaces for known structures

**Estimated Effort**: 1 hour

---

### 🟢 `src/gates/core/types.ts` (6 `Record<string, any>`)

**Fix Strategy**:

- [ ] Define `GateContext`, `GateResult` interfaces
- [ ] Type gate criteria and validation results

**Estimated Effort**: 1 hour

---

### 🟢 `src/frameworks/types/methodology-types.ts` (6 `Record<string, any>`)

**Fix Strategy**:

- [ ] Define framework-specific context types
- [ ] Type methodology guide outputs

**Estimated Effort**: 1 hour

---

## Phase 6: Runtime & Infrastructure (Low Priority)

### 🟢 `src/runtime/application.ts` (4 `: any` + 14 `as any`)

**Problem**: Dynamic service container and startup sequence.

**Fix Strategy**:

- [ ] Type service container with mapped types
- [ ] Replace `as any` casts with proper typing
- [ ] Use dependency injection patterns

**Estimated Effort**: 2-3 hours

---

### 🟢 `src/server/transport/index.ts` (3 instances)

**Fix Strategy**:

- [ ] Type transport handlers properly
- [ ] Define request/response schemas

**Estimated Effort**: 1 hour

---

## Phase 7: Miscellaneous Stragglers

### Files with 1-3 instances each:

- `src/prompts/registry.ts`
- `src/prompts/category-maintenance.ts`
- `src/mcp-tools/prompt-manager/operations/file-operations.ts`
- `src/mcp-tools/config-utils.ts`
- `src/frameworks/framework-state-manager.ts`
- `src/semantic/semantic-integration-types.ts`
- `src/semantic/configurable-semantic-analyzer.ts`
- `src/runtime/health.ts`

**Estimated Effort**: 2-3 hours total

---

## Patterns to Replace

### Pattern 1: Variadic Logger Args

```typescript
// ❌ Before
info: (message: string, ...args: any[]) => void;

// ✅ After
info: (message: string, ...args: readonly unknown[]) => void;
```

### Pattern 2: Dynamic Records

```typescript
// ❌ Before
metadata: Record<string, any>;

// ✅ After (if truly dynamic)
metadata: Record<string, unknown>;

// ✅ Better (if structure is known)
interface Metadata {
  id: string;
  timestamp: number;
  tags?: string[];
}
```

### Pattern 3: Type Assertions

```typescript
// ❌ Before
const result = response as any;

// ✅ After
const result = response as SpecificType;
// or
if (isSpecificType(response)) {
  // response is now typed
}
```

### Pattern 4: External Data

```typescript
// ❌ Before
function process(data: any): void { ... }

// ✅ After
function process(data: unknown): void {
  if (typeof data === 'object' && data !== null) {
    // narrow the type
  }
}
```

---

## ESLint Rules to Enable

Once cleanup is complete, enable these rules as `error`:

```json
{
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error"
}
```

---

## Progress Tracking

| Phase   | Files | Instances | Status         |
| ------- | ----- | --------- | -------------- |
| Phase 1 | 4     | ~80       | ⬜ Not Started |
| Phase 2 | 3     | ~27       | ⬜ Not Started |
| Phase 3 | 2     | ~21       | ⬜ Not Started |
| Phase 4 | 2     | ~16       | ⬜ Not Started |
| Phase 5 | 3     | ~19       | ⬜ Not Started |
| Phase 6 | 2     | ~21       | ⬜ Not Started |
| Phase 7 | 8+    | ~15       | ⬜ Not Started |

**Total Estimated Effort**: 20-25 hours

---

## Success Criteria

1. ✅ Zero `any` types in new code
2. ✅ All phases complete with tests passing
3. ✅ ESLint `no-explicit-any` rule enabled as error
4. ✅ No runtime regressions
5. ✅ Build passes with strict flags

---

## Notes

- **Don't rush**: Each change can have cascading effects
- **Test after each file**: Run `npm test` frequently
- **Type narrowing over casting**: Use type guards instead of `as` casts
- **`unknown` is your friend**: Use it for external/dynamic data
- **Consider generics**: For container types that hold different data
