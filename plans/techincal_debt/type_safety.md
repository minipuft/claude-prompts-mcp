# Technical Debt - Type Safety Baseline & Tracking

**Generated**: 2025-11-16
**Purpose**: Track type safety violations and measure progress toward full compliance

---

## Executive Summary

This document establishes the baseline for type safety violations in the codebase and tracks progress toward eliminating technical debt.

### Code Review Checklist

- [ ] No `any` without justification comment
- [ ] No `!` non-null assertions
- [ ] Explicit return types on exported functions
- [ ] Explicit null/undefined checks (no `if (value)`)
- [ ] Nullish coalescing (`??`) instead of OR (`||`)
- [ ] Array/object access guarded
- [ ] All Promises awaited or explicitly handled

### Current State (Baseline: 2025-11-16)

| Metric                | Count     | Status         |
| --------------------- | --------- | -------------- |
| **ESLint Violations** | **6,945** | 🔴 Critical    |
| - Errors              | 5,307     | 🔴 High        |
| - Warnings            | 1,638     | 🟡 Medium      |
| **TypeScript Errors** | **454**   | 🔴 High        |
| **Files Affected**    | 144       | -              |
| **Auto-fixable**      | 1,980     | 🟢 Opportunity |

**Goal**: Reduce to <100 total violations within 6 weeks
**Strategy**: Prevent new violations (pre-commit hooks) + gradual debt paydown

---

## Violation Breakdown by Category

### Top 10 ESLint Violations

| Rule                         | Count  | Severity | Priority    |
| ---------------------------- | ------ | -------- | ----------- |
| `strict-boolean-expressions` | ~1,800 | Error    | 🔴 Critical |
| `no-unsafe-assignment`       | ~600   | Warning  | 🟡 High     |
| `no-unsafe-member-access`    | ~400   | Warning  | 🟡 High     |
| `no-explicit-any`            | ~500   | Error    | 🔴 High     |
| `prefer-nullish-coalescing`  | ~250   | Error    | 🟢 Medium   |
| `no-unsafe-call`             | ~200   | Warning  | 🟡 Medium   |
| `prettier/prettier`          | ~150   | Error    | 🟢 Low      |
| `no-unnecessary-condition`   | ~100   | Error    | 🟡 Medium   |
| `import/order`               | ~80    | Error    | 🟢 Low      |
| `no-non-null-assertion`      | ~30    | Warning  | 🟡 Medium   |

### TypeScript Compiler Errors (454 total)

Introduced by new compiler options:

| Compiler Option                      | Estimated Errors | Impact                                       |
| ------------------------------------ | ---------------- | -------------------------------------------- |
| `noUncheckedIndexedAccess`           | ~250             | Array/object access returns `T \| undefined` |
| `exactOptionalPropertyTypes`         | ~150             | Cannot assign `undefined` to optional props  |
| `noPropertyAccessFromIndexSignature` | ~30              | Must use bracket notation for dynamic access |
| `noImplicitReturns`                  | ~24              | All code paths must return                   |

---

## Violation Details by Rule

### 1. `strict-boolean-expressions` (~1,800 violations)

**Problem**: Implicit truthiness checks instead of explicit comparisons
**Impact**: Unclear intent, potential bugs with falsy values

**Examples**:

```typescript
// ❌ BAD (106 instances)
if (config) {
}

// ✅ GOOD
if (config !== null) {
}
```

**Fix Strategy**:

- Week 1-2: Fix ~500 violations in critical paths (execution/, mcp-tools/)
- Week 3-4: Fix ~800 violations in core systems (frameworks/, gates/)
- Week 5-6: Fix remaining ~500 violations

**Auto-fix**: None (requires manual review)

### 2. `no-unsafe-assignment` (~600 violations)

**Problem**: Assigning `any` values to typed variables without validation
**Impact**: Type safety bypassed, runtime errors possible

**Examples**:

```typescript
// ❌ BAD
const value: string = someAnyValue;

// ✅ GOOD
const value: unknown = someAnyValue;
if (typeof value === "string") {
  const safeValue: string = value;
}
```

**Fix Strategy**:

- Audit each `any` usage in API boundaries
- Convert to `unknown` + type guards
- Use Zod schemas for runtime validation

**Auto-fix**: None (requires type guards)

### 3. `no-unsafe-member-access` (~400 violations)

**Problem**: Accessing properties on `any` values
**Impact**: No compile-time safety for property access

**Examples**:

```typescript
// ❌ BAD
const name = anyValue.name;

// ✅ GOOD
if (typeof anyValue === "object" && anyValue !== null && "name" in anyValue) {
  const name = anyValue.name;
}
```

**Fix Strategy**:

- Create type guards for common patterns
- Define proper interfaces for external data
- Use Zod schemas at boundaries

**Auto-fix**: None (requires type system changes)

### 4. `no-explicit-any` (~500 violations)

**Problem**: Explicit use of `any` type
**Impact**: Bypasses type system entirely

**Distribution**:

- MCP SDK types: ~80 instances (legitimate - no types available)
- Express types: ~40 instances (legitimate - poor typing)
- Internal code: ~380 instances (needs fixing)

**Fix Strategy**:

- Document legitimate uses with comments
- Convert internal `any` to proper types
- Use generics for truly dynamic code

**Target**: Reduce from 500 → <50 instances

### 5. `prefer-nullish-coalescing` (~250 violations)

**Problem**: Using `||` instead of `??` for defaults
**Impact**: Incorrect behavior with 0, "", false

**Examples**:

```typescript
// ❌ BAD
const port = config.port || 3000; // port=0 → 3000 (wrong!)

// ✅ GOOD
const port = config.port ?? 3000; // port=0 → 0 (correct!)
```

**Fix Strategy**:

- Use `npm run lint:fix` (many auto-fixable)
- Manual review for cases where `||` is intentional

**Auto-fix**: Partial (~70% auto-fixable)

### 6. `no-unsafe-call` (~200 violations)

**Problem**: Calling `any` values as functions
**Impact**: No compile-time validation of function signatures

**Fix Strategy**:

- Define function types
- Use type guards before calling
- Validate signatures at boundaries

**Auto-fix**: None

### 7. `prettier/prettier` (~150 violations)

**Problem**: Formatting inconsistencies
**Impact**: Low (cosmetic only)

**Fix Strategy**:

- Run `npm run format:fix`
- Pre-commit hook already enforces

**Auto-fix**: 100% auto-fixable

### 8. `no-unnecessary-condition` (~100 violations)

**Problem**: Redundant null checks or always-true/false conditions
**Impact**: Code confusion, dead code paths

**Examples**:

```typescript
// ❌ BAD
if (value?.property) {
} // value is never null based on types

// ✅ GOOD
if (value.property !== "") {
} // Explicit check
```

**Fix Strategy**:

- Review each case (may reveal incorrect types)
- Fix types or remove redundant checks

**Auto-fix**: None (requires type analysis)

### 9. `import/order` (~80 violations)

**Problem**: Import statement ordering
**Impact**: Low (readability only)

**Fix Strategy**:

- Run `npm run lint:fix`

**Auto-fix**: 100% auto-fixable

### 10. `no-non-null-assertion` (~30 violations)

**Problem**: Using `!` to bypass null checks
**Impact**: Runtime errors if assumption is wrong

**Examples**:

```typescript
// ❌ BAD
const name = user!.name!;

// ✅ GOOD
if (user === null) {
  throw new Error("User required");
}
const name = user.name;
```

**Fix Strategy**:

- Replace with explicit null checks
- Use optional chaining where appropriate
- Throw or return early for invalid states

**Auto-fix**: None (requires logic changes)

---

## TypeScript Compiler Errors (454 total)

### Category 1: `noUncheckedIndexedAccess` (~250 errors)

**Affects**: Array and object access

**Example**:

```typescript
const arr = [1, 2, 3];
const value = arr[0]; // Type: number | undefined (was: number)

// Now requires:
if (value !== undefined) {
  console.log(value * 2);
}
```

**Fix Strategy**:

- Add undefined checks after array/object access
- Use optional chaining: `arr[0]?.toString()`
- Use nullish coalescing: `arr[0] ?? 0`

### Category 2: `exactOptionalPropertyTypes` (~150 errors)

**Affects**: Optional property assignments

**Example**:

```typescript
interface Config {
  port?: number;
}

// ❌ ERROR
const config: Config = { port: undefined };

// ✅ GOOD
const config: Config = {};
```

**Fix Strategy**:

- Omit property instead of assigning undefined
- Change optional type to `T | undefined` if needed
- Review if property should truly be optional

### Category 3: `noPropertyAccessFromIndexSignature` (~30 errors)

**Affects**: Dynamic property access

**Example**:

```typescript
const env: Record<string, string> = process.env;

// ❌ ERROR
const path = env.PROMPTS_PATH;

// ✅ GOOD
const path = env["PROMPTS_PATH"];
```

**Fix Strategy**:

- Use bracket notation for dynamic access
- Define specific interfaces for known properties

### Category 4: `noImplicitReturns` (~24 errors)

**Affects**: Functions with missing return paths

**Fix Strategy**:

- Ensure all code paths return
- Add explicit throws for impossible cases
- Add default returns

---

## High-Risk Areas

### Critical Files (Need immediate attention)

1. **src/runtime/application.ts** (lines 92-102)

   - `null as any` constructor pattern
   - Bypasses entire type system
   - Risk: Runtime errors from uninitialized properties
   - **Priority**: 🔴 CRITICAL - Fix first

2. **src/api/index.ts**

   - 50+ violations in single file
   - Heavy `any` usage in MCP tool handlers
   - **Priority**: 🔴 HIGH

3. **src/chain-session/manager.ts**

   - 48+ violations
   - Unnecessary optional chaining
   - **Priority**: 🟡 MEDIUM

4. **src/mcp-tools/prompt-engine/**

   - ~200 violations across subsystem
   - Core execution engine
   - **Priority**: 🔴 HIGH

5. **src/gates/**
   - ~150 violations
   - Quality validation system
   - **Priority**: 🟡 MEDIUM

---

## Progress Tracking

### Sprint Goals

#### Sprint 1 (Week 1-2): Foundation & Critical Fixes

- [ ] Fix `application.ts` constructor pattern
- [ ] Address 50% of `strict-boolean-expressions` in critical paths
- [ ] Auto-fix all `prettier/prettier` violations
- [ ] Auto-fix 70% of `prefer-nullish-coalescing`
- [ ] Document legitimate `any` uses with comments

**Target**: Reduce violations from 6,945 → 5,500 (-20%)

#### Sprint 2 (Week 3-4): Core Systems

- [ ] Complete `strict-boolean-expressions` fixes
- [ ] Reduce `no-explicit-any` by 50%
- [ ] Fix all `import/order` violations
- [ ] Address `noUncheckedIndexedAccess` in execution/
- [ ] Address `exactOptionalPropertyTypes` errors

**Target**: Reduce violations from 5,500 → 3,000 (-45%)

#### Sprint 3 (Week 5-6): Refinement

- [ ] Fix remaining `no-unsafe-*` warnings
- [ ] Complete `no-explicit-any` reduction to <50
- [ ] Fix all `no-non-null-assertion` warnings
- [ ] Address remaining TypeScript compiler errors
- [ ] Achieve <100 total violations

**Target**: Reduce violations from 3,000 → <100 (-97%)

---

## Enforcement Strategy

### Pre-commit (Already Active)

```bash
# Blocks commit if:
npm run typecheck     # TypeScript errors exist
npm run lint --max-warnings 0  # New warnings added
npm run format        # Formatting violations
```

**Result**: No new violations can be introduced

### Pre-push (Already Active)

Full validation pipeline:

- Type checking
- Linting with zero warnings
- Format checking
- Test suite
- Dependency validation

### CI/CD

All PRs must pass:

- Zero new violations
- Existing violation count must not increase
- All tests passing

---

## Measurement & Reporting

### Weekly Progress Report

Run weekly to track progress:

```bash
# Generate current violation count
npm run lint 2>&1 | grep "✖.*problems" > weekly-report.txt

# Compare to baseline
echo "Baseline: 6,945 violations"
echo "Current: <result from command>"
echo "Progress: <calculate reduction>"
```

### Violation Heatmap

**Files with most violations** (Top 10):

1. `src/api/index.ts` - ~50 violations
2. `src/chain-session/manager.ts` - ~48 violations
3. `src/mcp-tools/prompt-engine/core/engine.ts` - ~45 violations
4. `src/execution/parsers/command-parser.ts` - ~40 violations
5. `src/frameworks/framework-manager.ts` - ~38 violations
6. `src/gates/core/gate-validator.ts` - ~35 violations
7. `src/prompts/loader.ts` - ~32 violations
8. `src/runtime/application.ts` - ~30 violations
9. `src/server/transport/index.ts` - ~28 violations
10. `src/utils/errorHandling.ts` - ~25 violations

---

## Success Metrics

### Definition of Done

A file is considered "type-safe compliant" when:

- ✅ Zero ESLint errors
- ✅ Zero ESLint warnings
- ✅ Zero TypeScript errors
- ✅ No `any` without justification comment
- ✅ No `!` non-null assertions
- ✅ All null checks explicit
- ✅ Proper return types on all functions

### Project Success Criteria

- [ ] <100 total violations across codebase
- [ ] Zero violations in critical paths (execution/, mcp-tools/)
- [ ] <10 justified `any` usages (documented)
- [ ] Zero `!` non-null assertions
- [ ] All TypeScript compiler errors resolved
- [ ] Pre-commit hooks prevent new violations

---

## Related Documents

- [TypeScript Style Guide](./TYPESCRIPT_STYLE_GUIDE.md) - Coding standards and patterns
- [Contributing Guide](./contributing.md) - Development workflow
- [Architecture](./architecture.md) - System design and patterns

---

## Change Log

### 2025-11-16 - Initial Baseline

**Added**:

- 4 new TypeScript compiler options (noUncheckedIndexedAccess, exactOptionalPropertyTypes, noPropertyAccessFromIndexSignature, noImplicitReturns)
- 6 new ESLint rules (no-unnecessary-condition, no-non-null-assertion, no-unsafe-\*)
- Pre-commit hooks with --max-warnings 0
- TypeScript Style Guide documentation

**Impact**:

- Revealed 454 new TypeScript errors
- Revealed ~1,800 additional ESLint warnings
- Total violations increased from ~5,000 to ~7,400 (discovery, not regression)

**Next Steps**:

- Sprint 1 planning: Fix critical paths first
- Create tracking issues for each major violation category
- Set up weekly progress reporting

---

**Maintained By**: Development Team
**Review Cycle**: Weekly during debt paydown, monthly after <100 violations
