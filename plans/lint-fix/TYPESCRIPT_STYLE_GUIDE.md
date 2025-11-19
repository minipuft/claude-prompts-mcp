# TypeScript Style Guide - Type Safety Standards

## Overview

This guide documents the type safety standards enforced in this project. These rules are designed to prevent common TypeScript anti-patterns, especially those that LLMs (Large Language Models) frequently produce when generating code.

**Philosophy**: Strong types at boundaries, explicit null handling, no escape hatches.

---

## Table of Contents

1. [Null and Optional Handling](#null-and-optional-handling)
2. [Array and Object Index Access](#array-and-object-index-access)
3. [Type Assertions and Any](#type-assertions-and-any)
4. [Async/Promise Handling](#asyncpromise-handling)
5. [Boolean Expressions](#boolean-expressions)
6. [Function Return Types](#function-return-types)
7. [Common Anti-Patterns](#common-anti-patterns)

---

## Null and Optional Handling

### Core Principle

**Use `?` and `?.` ONLY at external boundaries** (API responses, untyped input). Inside the codebase, prefer non-optional fields and validate/normalize once at the boundary.

### ✅ Good Patterns

```typescript
// Boundary validation with Zod
const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  middleName: z.string().optional(), // Only optional if genuinely optional in domain
});

type User = z.infer<typeof UserSchema>;

// Explicit null checks
function processUser(user: User | null): void {
  if (user === null) {
    throw new Error('User is required');
  }

  // Now user is non-null in this scope
  console.log(user.name);
}

// Early returns for clarity
function getDisplayName(user: User): string {
  if (user.middleName === undefined) {
    return `${user.name}`;
  }
  return `${user.name} ${user.middleName}`;
}

// Nullish coalescing for defaults
const port = config.port ?? 3000; // ✅ Only null/undefined trigger default
```

### ❌ Bad Patterns

```typescript
// DON'T: Lazy optional chaining everywhere
function processUser(user?: User): void {
  console.log(user?.name?.toLowerCase()); // Silently fails if user is undefined
}

// DON'T: OR operator for defaults (treats 0, "", false as falsy)
const port = config.port || 3000; // ❌ port=0 would fallback to 3000

// DON'T: Non-null assertion operator
const name = user!.name!; // ❌ Bypasses type safety

// DON'T: Implicit truthiness checks
if (user) { } // ❌ Unclear what you're checking
if (user !== null && user !== undefined) { } // ✅ Explicit

// DON'T: Over-optional interfaces
interface User {
  id?: string;     // ❌ Is id ever genuinely missing?
  email?: string;  // ❌ Or is this just lazy typing?
}
```

### Rule: `exactOptionalPropertyTypes`

With this tsconfig option enabled, optional properties are stricter:

```typescript
interface Config {
  port?: number;
}

// ❌ ERROR: Cannot assign undefined to optional property
const bad: Config = { port: undefined };

// ✅ GOOD: Omit the property entirely
const good: Config = {};

// ✅ GOOD: Provide the value
const withPort: Config = { port: 3000 };
```

**Why**: This enforces a clearer distinction between "property is missing" vs "property is explicitly undefined".

---

## Array and Object Index Access

### Core Principle

**Treat all array/object index access as potentially undefined**. Never assume an index exists.

### Rule: `noUncheckedIndexedAccess`

With this tsconfig option enabled, array and object access returns `T | undefined`:

```typescript
const arr = [1, 2, 3];
const value = arr[100]; // Type: number | undefined (not just number!)

// ✅ GOOD: Guard before use
const arr = [1, 2, 3];
const value = arr[0];
if (value !== undefined) {
  console.log(value * 2);
}

// ✅ GOOD: Use optional chaining at access point
const first = arr[0]?.toString();

// ✅ GOOD: Provide default with nullish coalescing
const firstOrZero = arr[0] ?? 0;

// ❌ BAD: Assume index exists
const value = arr[100];
console.log(value * 2); // Runtime error if undefined!

// ✅ GOOD: For Record/object access
const config: Record<string, string> = { foo: 'bar' };
const value = config['unknown'];
if (value !== undefined) {
  console.log(value.toUpperCase());
}
```

### Rule: `noPropertyAccessFromIndexSignature`

Enforces bracket notation for dynamic properties:

```typescript
interface Config {
  port: number;
  [key: string]: unknown;
}

const config: Config = { port: 3000, host: 'localhost' };

// ✅ GOOD: Declared properties use dot notation
console.log(config.port);

// ✅ GOOD: Index signature properties use bracket notation
console.log(config['host']);

// ❌ ERROR: Cannot use dot notation for index signature
console.log(config.host); // TypeScript error with noPropertyAccessFromIndexSignature
```

---

## Type Assertions and Any

### Core Principle

**Avoid `any` and type assertions**. When you must use them, use them safely.

### ✅ Good Patterns

```typescript
// Use unknown for untrusted data, then narrow
function parseJSON(input: string): unknown {
  return JSON.parse(input);
}

const data = parseJSON('{"name": "Alice"}');

// Type guard for safe narrowing
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

if (isUser(data)) {
  console.log(data.name); // Type-safe access
}

// Zod for runtime validation
const result = UserSchema.safeParse(data);
if (result.success) {
  console.log(result.data.name); // Validated and typed
}

// Generic constraints instead of any
function processItem<T extends { id: string }>(item: T): void {
  console.log(item.id); // Type-safe
}

// Legitimate any for truly dynamic data (document with comment)
interface MCP {
  // MCP SDK doesn't export types, using any for external library
  server: any;
}
```

### ❌ Bad Patterns

```typescript
// DON'T: any as lazy escape hatch
function process(data: any): void {
  console.log(data.whatever.you.want); // No safety
}

// DON'T: Type assertion without validation
const user = data as User; // ❌ No runtime check!

// DON'T: Bypassing null checks
const value = (maybeNull as any).property;

// DON'T: any in function signatures without justification
async function fetch(args: any): Promise<any> { }
```

### Rules: `no-explicit-any` + `no-unsafe-*`

```typescript
// ❌ ERROR: Explicit any not allowed
let data: any;

// ❌ WARNING: Unsafe assignment from any
let x: string = someAnyValue;

// ❌ WARNING: Unsafe call
someAnyValue();

// ❌ WARNING: Unsafe member access
someAnyValue.property;

// ❌ WARNING: Unsafe return
function bad(): string {
  return someAnyValue; // Could return anything
}
```

---

## Async/Promise Handling

### Core Principle

**All Promises must be awaited or explicitly handled**. No floating promises.

### ✅ Good Patterns

```typescript
// Await the promise
async function process(): Promise<void> {
  await fetchData();
  await saveResults();
}

// Explicit error handling
async function processWithError(): Promise<void> {
  try {
    await fetchData();
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Fetch failed', error);
    }
    throw error;
  }
}

// Void for fire-and-forget (explicit intent)
function triggerBackgroundTask(): void {
  void processInBackground(); // Explicitly ignored
}

// Return the promise
function getData(): Promise<string> {
  return fetchData(); // ✅ Caller decides how to handle
}
```

### ❌ Bad Patterns

```typescript
// DON'T: Floating promise (not awaited or handled)
async function bad(): Promise<void> {
  fetchData(); // ❌ Promise ignored!
}

// DON'T: Missing await
async function alsobad(): Promise<void> {
  const data = fetchData(); // ❌ data is Promise<T>, not T
  console.log(data.property); // Runtime error!
}

// DON'T: Promise<Promise<T>> nesting
async function nested(): Promise<Promise<string>> {
  return fetchData(); // ❌ Should be just Promise<string>
}
```

### Rules: `no-floating-promises`, `no-misused-promises`, `await-thenable`

These rules catch all the bad patterns above automatically.

---

## Boolean Expressions

### Core Principle

**Explicit boolean conditions only**. No implicit truthiness checks.

### ✅ Good Patterns

```typescript
// Explicit null/undefined checks
if (value !== null && value !== undefined) { }
if (value !== null) { }

// Explicit string checks
if (str !== '') { }
if (str.length > 0) { }

// Explicit number checks
if (num !== 0) { }
if (num > 0) { }

// Explicit array checks
if (arr.length > 0) { }

// Boolean variables can be used directly
const isEnabled: boolean = true;
if (isEnabled) { } // ✅ Already boolean

// Comparison operators
if (count > 0) { } // ✅ Returns boolean
```

### ❌ Bad Patterns

```typescript
// DON'T: Implicit truthiness
if (str) { }      // ❌ Unclear: checking for empty string? null? undefined?
if (value) { }    // ❌ What exactly are you checking?
if (arr) { }      // ❌ Checking for null? empty array?

// DON'T: Implicit falsiness
if (!value) { }   // ❌ Too vague

// DON'T: Using non-boolean in conditions
const count: number = 5;
if (count) { }    // ❌ Should be: if (count > 0)

const str: string = 'hello';
if (str) { }      // ❌ Should be: if (str !== '')
```

### Rule: `strict-boolean-expressions`

Configured with:
```javascript
{
  allowString: false,        // Requires explicit string checks
  allowNumber: false,        // Requires explicit number checks
  allowNullableObject: false // Requires explicit null checks
}
```

This is the **most violated rule** in the codebase (1,591 violations). It's also one of the most important for clarity and correctness.

---

## Function Return Types

### Core Principle

**All public functions must have explicit return types**. Inference is allowed for private/local functions.

### ✅ Good Patterns

```typescript
// Explicit return type for exported functions
export function calculate(x: number, y: number): number {
  return x + y;
}

// Explicit return type for class methods
class Calculator {
  public add(x: number, y: number): number {
    return x + y;
  }
}

// Explicit Promise type for async functions
export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}

// Void for functions with no return
export function logMessage(msg: string): void {
  console.log(msg);
}

// Inference allowed for arrow functions in local scope
const helpers = {
  double: (x: number) => x * 2, // Type inferred
};
```

### ❌ Bad Patterns

```typescript
// DON'T: No return type on exported function
export function calculate(x: number, y: number) {
  return x + y; // Return type should be explicit
}

// DON'T: Implicit any return
export function parse(input: string) {
  return JSON.parse(input); // Returns any implicitly
}

// DON'T: Missing Promise wrapper
export async function fetchUser(id: string): User { // ❌ Should be Promise<User>
  return await fetch(`/api/users/${id}`);
}
```

### Rule: `explicit-function-return-type` + `explicit-module-boundary-types`

These rules enforce explicit return types for:
- Exported functions
- Public class methods
- Module boundaries

---

## Common Anti-Patterns

### Anti-Pattern #1: Constructor `null as any`

```typescript
// ❌ VERY BAD: Bypasses all type safety
class Application {
  private logger: Logger;
  private config: Config;

  constructor() {
    this.logger = null as any;  // ❌ Danger!
    this.config = null as any;  // ❌ Runtime errors waiting to happen
  }
}

// ✅ GOOD: Optional types or proper initialization
class Application {
  private logger: Logger | null = null;
  private config?: Config;

  constructor(logger?: Logger) {
    this.logger = logger ?? null;
  }

  public async initialize(): Promise<void> {
    this.config = await loadConfig();
  }

  public start(): void {
    if (this.logger === null) {
      throw new Error('Logger not initialized');
    }
    if (this.config === undefined) {
      throw new Error('Config not initialized');
    }

    // Now both are non-null in this scope
    this.logger.info('Starting with config', this.config);
  }
}

// ✅ BETTER: Builder pattern
class ApplicationBuilder {
  private logger?: Logger;
  private config?: Config;

  public setLogger(logger: Logger): this {
    this.logger = logger;
    return this;
  }

  public setConfig(config: Config): this {
    this.config = config;
    return this;
  }

  public build(): Application {
    if (!this.logger || !this.config) {
      throw new Error('Logger and Config required');
    }
    return new Application(this.logger, this.config);
  }
}

class Application {
  constructor(
    private readonly logger: Logger,
    private readonly config: Config
  ) {}
}
```

### Anti-Pattern #2: Over-using Optional Chaining

```typescript
// ❌ BAD: Optional chaining hides real problems
function displayUser(user?: User): void {
  console.log(user?.profile?.name ?? 'Unknown');
  // What if user is required? This silently fails!
}

// ✅ GOOD: Explicit validation at boundary
function displayUser(user: User | null): void {
  if (user === null) {
    console.log('No user provided');
    return;
  }

  const name = user.profile?.name ?? user.email;
  console.log(name);
}
```

### Anti-Pattern #3: Ignoring `noImplicitReturns`

```typescript
// ❌ BAD: Missing return in some code paths
function getStatus(code: number): string {
  if (code === 200) {
    return 'OK';
  } else if (code === 404) {
    return 'Not Found';
  }
  // Missing return! TypeScript error with noImplicitReturns
}

// ✅ GOOD: All paths return
function getStatus(code: number): string {
  if (code === 200) {
    return 'OK';
  } else if (code === 404) {
    return 'Not Found';
  }
  return 'Unknown';
}

// ✅ ALSO GOOD: Exhaustive switch
function getStatus(code: number): string {
  switch (code) {
    case 200:
      return 'OK';
    case 404:
      return 'Not Found';
    default:
      return 'Unknown';
  }
}
```

---

## Migration Guide

### Converting Implicit Boolean Checks

**Pattern**: `if (value)` → `if (value !== null)`

```bash
# Find all violations
npm run lint | grep strict-boolean-expressions

# Common conversions:
if (config)           → if (config !== null)
if (user.name)        → if (user.name !== '')
if (items)            → if (items.length > 0)
if (count)            → if (count > 0)
if (!value)           → if (value === null || value === undefined)
```

### Converting OR to Nullish Coalescing

**Pattern**: `a || b` → `a ?? b`

```bash
# Find all violations
npm run lint | grep prefer-nullish-coalescing

# Safe conversions:
const port = config.port || 3000;
→ const port = config.port ?? 3000;

const name = user.name || 'Unknown';
→ const name = user.name ?? 'Unknown';
```

### Removing Non-Null Assertions

**Pattern**: `value!.property` → proper null check

```bash
# Find all non-null assertions
npm run lint | grep no-non-null-assertion

# Conversions:
const name = user!.name;
→ if (user === null) throw new Error('User required');
  const name = user.name;

this.server!.close();
→ if (this.server === null) throw new Error('Server not initialized');
  this.server.close();
```

---

## Enforcement

### Pre-commit Hooks

All new code must pass:
```bash
npm run typecheck  # TypeScript compilation
npm run lint       # ESLint validation
```

### CI/CD Pipeline

All PRs must have zero violations. Existing violations are tracked but new violations block merges.

### Code Review Checklist

- [ ] No `any` without justification comment
- [ ] No `!` non-null assertions
- [ ] Explicit return types on exported functions
- [ ] Explicit null/undefined checks (no `if (value)`)
- [ ] Nullish coalescing (`??`) instead of OR (`||`)
- [ ] Array/object access guarded
- [ ] All Promises awaited or explicitly handled

---

## Tools and Commands

```bash
# Type checking
npm run typecheck

# Linting (with auto-fix where possible)
npm run lint:fix

# Format code
npm run format:fix

# Full validation
npm run validate:all

# Check for specific violations
npm run lint | grep strict-boolean-expressions
npm run lint | grep no-explicit-any
npm run lint | grep prefer-nullish-coalescing
```

---

## References

- [TypeScript Handbook - Strictness](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TypeScript ESLint Rules](https://typescript-eslint.io/rules/)
- [tsconfig Compiler Options](https://www.typescriptlang.org/tsconfig)
- [`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
- [`exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)

---

**Version**: 1.0
**Last Updated**: 2025-11-16
**Maintained By**: Development Team
