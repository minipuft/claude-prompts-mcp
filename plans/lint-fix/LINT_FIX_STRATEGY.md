# Systematic Lint Fix Strategy

**Purpose**: Safe, incremental approach to eliminating 6,945 violations
**Principle**: Fix → Test → Commit → Repeat

---

## Quick Reference Commands

```bash
# Phase 1: Auto-fixes (safe, immediate)
npm run lint:fix                          # Fix everything auto-fixable
npm run format:fix                        # Fix all formatting

# Phase 2: Fix by rule (targeted)
npm run lint -- --fix --rule @typescript-eslint/prefer-nullish-coalescing
npm run lint -- --fix --rule prettier/prettier
npm run lint -- --fix --rule import/order

# Phase 3: Fix by directory (focused)
npx eslint src/runtime/ --fix            # Fix one directory
npx eslint src/api/ --fix                # Another directory

# Phase 4: Fix by file (granular)
npx eslint src/runtime/application.ts --fix

# Always validate after fixes
npm run typecheck && npm test
```

---

## Parser Error Remediation Plan (2025-02-14)

Recent `npm run lint:fix` attempts fail before linting due to widespread parser errors. The latest run (2025-02-14) surfaced 180+ files with syntax issues. Root causes fall into three categories:

- **Corrupted file headers** – many files now start with bare `/` comment markers or truncated block comments (e.g., `src/api/index.ts:1`, `src/runtime/application.ts:1`, `src/gates/constants.ts:2`).
- **Damaged import statements** – identifiers/keywords are missing (`import  as path from 'path';` in `src/chain-session/manager.ts:13`, `src/mcp-tools/prompt-engine/core/index.ts:1`), producing “Expression expected” or “element access” parse errors.
- **Mid-file truncation** – certain arrays/objects lost closing tokens, leading to “An element access expression should take an argument” (e.g., `src/execution/parsers/argument-schema.ts:40`, `tests/unit/execution/parsers/unified-command-parser.test.ts:51`).

### Blocker Inventory (grouped by subsystem)

| Subsystem (cluster) | Files flagged | Representative paths |
| --- | --- | --- |
| `tests/unit/*` | 38 | `tests/unit/execution/parsers/argument-parser.test.ts`, `tests/unit/execution/pipeline/framework-stage.test.ts` |
| `src/execution/*` | 30 | `src/execution/context/context-resolver.ts`, `src/execution/operators/chain-operator-executor.ts`, `src/execution/pipeline/stages/01-parsing-stage.ts` |
| `src/mcp-tools/*` | 30 | `src/mcp-tools/prompt-engine/core/engine.ts`, `src/mcp-tools/tool-description-manager.ts` |
| `src/frameworks/*` | 24 | `src/frameworks/framework-manager.ts`, `src/frameworks/methodology/registry.ts` |
| `src/gates/*` | 18 | `src/gates/core/gate-validator.ts`, `src/gates/services/semantic-gate-service.ts:26` |
| `src/prompts/*` | 9 | `src/prompts/promptUtils.ts:28` |
| `src/utils/*` | 5 | `src/utils/jsonUtils.ts:92` |
| `src/semantic/*` | 4 | `src/semantic/configurable-semantic-analyzer.ts` |
| `src/metrics/*` | 3 | `src/metrics/analytics-service.ts` |
| `src/text-references/*` | 3 | `src/text-references/index.ts` |
| Other singletons | `src/api/index.ts`, `src/config/index.ts`, `src/server/index.ts`, `tests/helpers/test-helpers.ts`, etc. |

### Phase Plan

#### Phase 0 – Baseline + Safeguards
1. **Snapshot the current errors** for reproducibility: `npm run lint:fix > logs/lint-fail-$(date +%F).log || true`.
2. **Protect hot files** by creating temporary backups or using Git worktrees; avoid parallel edits without commits.

#### Phase 1 – Restore File Headers & Imports (Top-Level Directories)
Goal: eliminate “Unterminated regular expression literal” at file start.

1. **src/api, src/chain-session, src/config, src/index.ts, src/logging**  
   - Replace bare `/` comment banners with valid `/** ... */` blocks.  
   - Fix malformed `import` statements (example: `src/chain-session/manager.ts:13` should be `import path from 'path';`).  
   - Validation: `npx eslint src/api/index.ts --fix`, `npx eslint src/chain-session/manager.ts --fix`.  
2. **src/runtime + src/server + src/text-references + src/types***  
   - Reconstruct headers and ensure exported symbols remain intact.  
   - Validation: `npx eslint src/runtime --max-warnings=0`.

Deliverable: lint runs progress past entrypoints without parser errors.

#### Phase 2 – Execution Engine & Tests
Goal: unblock the heaviest clusters first.

1. **src/execution/**  
   - Work directory-by-directory (context → operators → pipeline → planning).  
   - For each file: restore comments/imports, then open reported lines (e.g., `src/execution/parsers/argument-schema.ts:40`), rebuild missing brackets, and re-run targeted lint:  
     ```bash
     npx eslint src/execution/parsers/argument-schema.ts --fix
     npm run typecheck -- --pretty false --incremental false
     ```  
2. **tests/unit/**  
   - Mirror fixes applied in `src/execution`.  
   - After each batch, run focused Jest suites, e.g.,  
     ```bash
     npm run test -- tests/unit/execution/parsers/argument-parser.test.ts
     ```  

Deliverable: `npx eslint src/execution/**/*.ts tests/unit/**/*.ts --max-warnings=0` succeeds.

#### Phase 3 – Frameworks, Gates, MCP Tools

1. **src/frameworks/**  
   - Restore documentation comments/guides, ensure exported enums/interfaces compile.  
   - Validate with `npm run typecheck` plus `npx eslint src/frameworks --max-warnings=0`.
2. **src/gates/**  
   - After header fixes, pay attention to JSON schema loaders; `src/gates/services/semantic-gate-service.ts:26` needs full expression reconstruction.  
   - Run targeted smoke tests: `npm run start:stdio -- --dry-run` (if available) after gating modules compile.
3. **src/mcp-tools/**  
   - Fix prompt-engine core modules; verify via `npx ts-node`? Instead run `npm run test -- tests/unit/mcp-tools/...` if present.  
   - Exercise CLI tools (prompt manager/engine) via MCP harness scripts if documented.

Deliverable: `npx eslint src/frameworks src/gates src/mcp-tools --max-warnings=0` passes; `npm run typecheck` clean.

#### Phase 4 – Secondary Subsystems (Prompts, Metrics, Semantic, Utils, Performance)

1. Sweep `src/prompts`, `src/metrics`, `src/semantic`, `src/performance`, `src/text-references`, `src/utils`.  
2. For each directory:  
   - Fix top-of-file syntax, ensure exported types compile.  
   - Run supporting diagnostics where available (`npm run start:debug`, prompt hot-reload watcher).  
3. Stabilize tests/helpers: `tests/helpers/test-helpers.ts`, `tests/setup.ts`.

Deliverable: `npm run typecheck` + `npm test` succeed without syntax errors.

#### Phase 5 – Full Validation & Emoji Lint

1. Once syntax is clean, re-run:  
   ```bash
   npm run lint:fix
   npm run lint
   npm run typecheck
   npm test
   ```  
2. Verify the new `claude/no-emojis` rule reports zero issues.  
3. Commit with clear summary and link to this plan.

> **Follow-up tracking**: record remaining lint categories (strict booleans, no-explicit-any, etc.) in `../plans/lint-fix/TECHNICAL_DEBT.md` after syntax recovery.

## Phase 1: Auto-Fixable Issues (Immediate - 1,980 violations)

These are **100% safe** and can be fixed automatically.

### Step 1.1: Format All Code (Priority: 🟢 LOW RISK)

**Command**:
```bash
cd server
npm run format:fix
```

**What it fixes**:
- ~150 `prettier/prettier` violations
- Trailing commas, spacing, indentation
- Zero logic changes

**Validation**:
```bash
npm run format      # Should pass
git diff            # Review changes (cosmetic only)
```

**Commit**:
```bash
git add -A
git commit -m "style: auto-fix prettier formatting violations

- Fixed ~150 prettier/prettier errors
- No logic changes, formatting only"
```

---

### Step 1.2: Fix Import Order (Priority: 🟢 LOW RISK)

**Command**:
```bash
npm run lint -- --fix --rule import/order
npm run lint -- --fix --rule import/newline-after-import
npm run lint -- --fix --rule import/no-duplicates
```

**What it fixes**:
- ~80 `import/order` violations
- Import statement organization
- Duplicate import consolidation

**Validation**:
```bash
npm run typecheck   # Ensure imports still resolve
git diff            # Review changes
```

**Commit**:
```bash
git add -A
git commit -m "style: auto-fix import ordering violations

- Fixed ~80 import/order errors
- Organized import groups
- No logic changes"
```

---

### Step 1.3: Auto-fix Nullish Coalescing (Priority: 🟡 MEDIUM RISK)

**Command**:
```bash
# Fix prefer-nullish-coalescing (many auto-fixable)
npm run lint -- --fix --rule @typescript-eslint/prefer-nullish-coalescing
```

**What it fixes**:
- ~175 of 250 `prefer-nullish-coalescing` violations (70% auto-fixable)
- Changes `||` to `??` where safe

**Example changes**:
```typescript
// Before
const port = config.port || 3000;

// After
const port = config.port ?? 3000;
```

**IMPORTANT**: Review changes carefully - some `||` usage may be intentional!

**Validation**:
```bash
npm run typecheck
npm test            # Run full test suite
git diff            # Review ALL changes

# Spot-check critical files:
git diff src/runtime/application.ts
git diff src/mcp-tools/prompt-engine/core/engine.ts
```

**Commit**:
```bash
git add -A
git commit -m "refactor: auto-fix prefer-nullish-coalescing violations

- Fixed ~175 prefer-nullish-coalescing errors
- Changed || to ?? for safer default values
- Tested: all tests passing"
```

---

### Step 1.4: Attempt Full Auto-Fix (Priority: 🟡 MEDIUM RISK)

**Command**:
```bash
# Try to auto-fix everything possible
npm run lint:fix
```

**Expected result**: Fixes ~1,980 violations total

**CRITICAL**: Review before committing!

**Validation**:
```bash
npm run typecheck   # Must pass
npm test            # Must pass
git diff --stat     # See what changed
git diff            # Review ALL changes
```

**If tests fail**:
```bash
# Revert and try directory-by-directory instead
git reset --hard
```

**If tests pass**:
```bash
git add -A
git commit -m "refactor: auto-fix ESLint violations (~1,980 fixes)

- Fixed all auto-fixable violations
- Validated with full test suite
- Manual review completed

Breakdown:
- prettier/prettier: ~150 fixes
- import/order: ~80 fixes
- prefer-nullish-coalescing: ~175 fixes
- Other auto-fixes: ~1,575 fixes"
```

**Progress**: 6,945 → ~4,965 violations (-28%)

---

## Phase 2: Manual Fixes by Rule (Targeted)

These require manual review but can be scripted per rule.

### Step 2.1: Fix Critical Pattern - `application.ts` (Priority: 🔴 CRITICAL)

**Why first**: Bypasses entire type system, highest risk

**Command**:
```bash
# Open the file
code src/runtime/application.ts
# or
vim src/runtime/application.ts
```

**Manual fix** (lines 92-102):

```typescript
// ❌ BEFORE
constructor(logger?: Logger) {
  this.logger = logger || (null as any);
  this.configManager = null as any;
  this.textReferenceManager = null as any;
  this.promptManager = null as any;
  // ... more
}

// ✅ AFTER - Option 1: Builder Pattern
class Application {
  private constructor(
    private readonly logger: Logger,
    private readonly configManager: ConfigManager,
    private readonly textReferenceManager: TextReferenceManager,
    private readonly promptManager: PromptManager,
    // ... other dependencies
  ) {}

  static async create(logger?: Logger): Promise<Application> {
    const actualLogger = logger ?? createDefaultLogger();
    const configManager = await ConfigManager.create();
    const textReferenceManager = new TextReferenceManager();
    const promptManager = await PromptManager.create();

    return new Application(
      actualLogger,
      configManager,
      textReferenceManager,
      promptManager
    );
  }
}

// ✅ AFTER - Option 2: Lazy Initialization with Proper Types
class Application {
  private logger: Logger | null = null;
  private configManager: ConfigManager | null = null;
  private textReferenceManager: TextReferenceManager | null = null;

  private ensureLogger(): Logger {
    if (this.logger === null) {
      throw new Error('Application not initialized: logger is null');
    }
    return this.logger;
  }

  private ensureConfigManager(): ConfigManager {
    if (this.configManager === null) {
      throw new Error('Application not initialized: configManager is null');
    }
    return this.configManager;
  }

  public async initialize(): Promise<void> {
    this.logger = await createLogger();
    this.configManager = await ConfigManager.create();
    // ... initialize others
  }
}
```

**Validation**:
```bash
npm run typecheck
npm test
npm run start:debug  # Test server startup
```

**Commit**:
```bash
git add src/runtime/application.ts
git commit -m "fix(runtime): remove dangerous 'null as any' pattern in Application

- Replaced 'null as any' with proper nullable types
- Added explicit initialization checks
- Prevents runtime errors from uninitialized properties

BREAKING: Application.create() is now async
Fixes: Critical type safety bypass"
```

**Progress**: ~4,965 → ~4,935 violations (-30 from this file)

---

### Step 2.2: Fix `strict-boolean-expressions` by Directory (Priority: 🔴 HIGH)

**Strategy**: Fix one directory at a time, most critical first

**Critical directories order**:
1. `src/runtime/` - Server startup
2. `src/mcp-tools/` - Core MCP functionality
3. `src/execution/` - Execution engine
4. `src/api/` - API handlers
5. `src/frameworks/` - Framework system
6. `src/gates/` - Validation system
7. `src/prompts/` - Prompt management
8. Remaining directories

#### Fix One Directory

**Command**:
```bash
# Step 1: See violations in directory
npx eslint src/runtime/ --rule @typescript-eslint/strict-boolean-expressions

# Step 2: Get file-by-file breakdown
npx eslint src/runtime/ --rule @typescript-eslint/strict-boolean-expressions --format compact

# Step 3: Fix one file at a time
npx eslint src/runtime/application.ts --fix
# Manual review and fixes needed
```

**Common patterns to fix**:

```typescript
// Pattern 1: Nullable object checks
// ❌ BEFORE
if (config) { }
if (!user) { }

// ✅ AFTER
if (config !== null) { }
if (user === null) { }

// Pattern 2: String checks
// ❌ BEFORE
if (str) { }
if (!str) { }

// ✅ AFTER
if (str !== '') { }
if (str === '') { }

// Pattern 3: Array checks
// ❌ BEFORE
if (items) { }

// ✅ AFTER
if (items.length > 0) { }

// Pattern 4: Number checks
// ❌ BEFORE
if (count) { }

// ✅ AFTER
if (count > 0) { }
// or
if (count !== 0) { }
```

**Validation per directory**:
```bash
npm run typecheck
npm test
npx eslint src/runtime/ --rule @typescript-eslint/strict-boolean-expressions
# Should show 0 violations for this directory
```

**Commit per directory**:
```bash
git add src/runtime/
git commit -m "fix(runtime): explicit boolean expressions in runtime/

- Fixed XX strict-boolean-expressions violations
- All null checks now explicit
- All string checks use !== ''
- All number checks use !== 0 or > 0

Tested: Full test suite passing"
```

**Repeat for each directory**.

---

### Step 2.3: Fix `no-explicit-any` (Priority: 🔴 HIGH)

**Strategy**: Triage first, then fix

**Step 1: Find all `any` usage**:
```bash
# Get count by file
npx eslint src/ --rule @typescript-eslint/no-explicit-any --format compact | \
  cut -d: -f1 | sort | uniq -c | sort -rn > any-usage-by-file.txt

# View top offenders
cat any-usage-by-file.txt | head -20
```

**Step 2: Categorize**:

```bash
# Create categorization file
cat > any-categorization.md << 'EOF'
# Any Usage Categorization

## Legitimate (Keep with comment)
- [ ] src/api/index.ts:28 - MCP SDK types not available
- [ ] src/api/index.ts:45 - Express Request body
- [ ] src/server/transport/index.ts:XX - External library

## Convert to unknown
- [ ] src/execution/parser.ts:XX - User input parsing
- [ ] src/mcp-tools/validator.ts:XX - Dynamic validation

## Convert to proper types
- [ ] src/chain-session/manager.ts:XX - Session state
- [ ] src/prompts/loader.ts:XX - Prompt data

## Convert to generics
- [ ] src/utils/helpers.ts:XX - Utility functions
EOF
```

**Step 3: Fix category by category**:

```typescript
// LEGITIMATE: Keep with comment
/**
 * MCP SDK doesn't export Server type - using any until SDK provides types.
 * @see https://github.com/modelcontextprotocol/typescript-sdk/issues/XXX
 */
private mcpServer: any;

// CONVERT TO UNKNOWN: User input
// ❌ BEFORE
function parseInput(data: any): Result {
  return data.value;
}

// ✅ AFTER
function parseInput(data: unknown): Result {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid input');
  }
  if (!('value' in data)) {
    throw new Error('Missing value');
  }
  return (data as { value: Result }).value;
}

// CONVERT TO PROPER TYPES
// ❌ BEFORE
const session: any = { id: '123', state: 'active' };

// ✅ AFTER
interface Session {
  id: string;
  state: 'active' | 'pending' | 'completed';
}
const session: Session = { id: '123', state: 'active' };

// CONVERT TO GENERICS
// ❌ BEFORE
function processItem(item: any): any {
  return item.value;
}

// ✅ AFTER
function processItem<T extends { value: unknown }>(item: T): T['value'] {
  return item.value;
}
```

**Commit**:
```bash
git add -A
git commit -m "refactor: reduce any usage from 500 to <50

- Documented legitimate any usage (external libraries)
- Converted user input to unknown + type guards
- Created proper interfaces for internal types
- Used generics for utility functions

Remaining any usage: XX instances (all documented)"
```

---

### Step 2.4: Fix `no-unsafe-*` Warnings (Priority: 🟡 MEDIUM)

These are byproducts of `any` usage - fix the root `any` first.

**Command**:
```bash
# After fixing 'any' usage, these should drop automatically
npm run lint | grep no-unsafe | wc -l
```

**If still present**, fix case-by-case:

```typescript
// ❌ BEFORE
const value: any = getExternalData();
const name = value.name;  // no-unsafe-member-access

// ✅ AFTER
const value: unknown = getExternalData();
if (typeof value === 'object' && value !== null && 'name' in value) {
  const name = (value as { name: unknown }).name;
}
```

---

### Step 2.5: Fix `no-unnecessary-condition` (Priority: 🟡 MEDIUM)

**Command**:
```bash
# Find all instances
npx eslint src/ --rule @typescript-eslint/no-unnecessary-condition --format compact
```

**Common patterns**:

```typescript
// ❌ BEFORE - Unnecessary optional chain
interface User {
  name: string;  // Never undefined
}
const userName = user?.name;  // Unnecessary ?. since name is required

// ✅ AFTER
const userName = user.name;

// ❌ BEFORE - Always true condition
if (object) { }  // object is never null based on types

// ✅ AFTER - Either fix types or remove check
// Option 1: Remove unnecessary check
// ... just use object directly

// Option 2: Fix type if it CAN be null
interface Config {
  object: SomeType | null;  // Make nullable if it truly can be
}
```

**Note**: These often reveal incorrect types - fixing them improves type accuracy!

---

### Step 2.6: Fix `no-non-null-assertion` (Priority: 🟡 MEDIUM)

**Command**:
```bash
# Find all instances (only ~30)
npx eslint src/ --rule @typescript-eslint/no-non-null-assertion --format compact
```

**Fix patterns**:

```typescript
// ❌ BEFORE
const name = user!.profile!.name!;

// ✅ AFTER - Option 1: Early return
if (user === null || user.profile === null) {
  throw new Error('User profile required');
}
const name = user.profile.name;

// ✅ AFTER - Option 2: Optional chaining + default
const name = user?.profile?.name ?? 'Unknown';

// ❌ BEFORE - Property assertion
this.server!.close();

// ✅ AFTER
if (this.server === null) {
  throw new Error('Server not initialized');
}
this.server.close();
```

**Commit after each rule**:
```bash
git add -A
git commit -m "fix: eliminate no-non-null-assertion violations (~30 fixes)

- Replaced ! assertions with explicit null checks
- Added early returns for required values
- Used optional chaining with defaults where appropriate"
```

---

## Phase 3: Fix TypeScript Compiler Errors (454 errors)

### Step 3.1: Fix `noUncheckedIndexedAccess` Errors

**Command**:
```bash
# Find files with these errors
npm run typecheck 2>&1 | grep "possibly 'undefined'" | \
  cut -d'(' -f1 | sort | uniq -c | sort -rn
```

**Fix pattern**:

```typescript
// ❌ BEFORE
const arr = [1, 2, 3];
const value = arr[0];
console.log(value * 2);  // Error: value is possibly undefined

// ✅ AFTER - Option 1: Guard check
const value = arr[0];
if (value !== undefined) {
  console.log(value * 2);
}

// ✅ AFTER - Option 2: Optional chaining
const result = arr[0]?.toString();

// ✅ AFTER - Option 3: Nullish coalescing
const value = arr[0] ?? 0;
console.log(value * 2);

// For objects
const config: Record<string, string> = process.env;
// ❌ BEFORE
const path = config.PROMPTS_PATH;

// ✅ AFTER
const path = config['PROMPTS_PATH'];
if (path === undefined) {
  throw new Error('PROMPTS_PATH not set');
}
```

**Fix file by file**, validate after each:
```bash
npm run typecheck
```

---

### Step 3.2: Fix `exactOptionalPropertyTypes` Errors

**Pattern**:

```typescript
// ❌ BEFORE
interface Config {
  port?: number;
}
const config: Config = { port: undefined };

// ✅ AFTER - Option 1: Omit property
const config: Config = {};

// ✅ AFTER - Option 2: Change type if undefined is needed
interface Config {
  port: number | undefined;
}
const config: Config = { port: undefined };
```

---

### Step 3.3: Fix `noPropertyAccessFromIndexSignature` Errors

**Pattern**:

```typescript
// ❌ BEFORE
const env: Record<string, string> = process.env;
const path = env.PROMPTS_PATH;  // Error

// ✅ AFTER
const path = env['PROMPTS_PATH'];
```

**Find and replace**:
```bash
# Find instances
npm run typecheck 2>&1 | grep "comes from an index signature"

# Usually just a few files - fix manually
```

---

## Phase 4: Systematic Directory-by-Directory Approach

If you prefer working directory by directory:

### Template Script

```bash
#!/bin/bash
# fix-directory.sh

DIR=$1

echo "🔍 Analyzing $DIR..."
echo ""

# Show current violations
echo "Current violations:"
npx eslint "$DIR" | tail -1

echo ""
echo "📝 Auto-fixing what's possible..."
npx eslint "$DIR" --fix

echo ""
echo "🧪 Running tests..."
npm run typecheck
npm test

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Tests passed! Remaining violations:"
  npx eslint "$DIR" | tail -1

  echo ""
  echo "📊 Commit these changes? (y/n)"
  read answer

  if [ "$answer" = "y" ]; then
    git add "$DIR"
    git commit -m "fix($DIR): auto-fix ESLint violations in $DIR

- Auto-fixed formatting and import violations
- Validated with test suite

$(npx eslint "$DIR" --format compact | head -10)"
  fi
else
  echo ""
  echo "❌ Tests failed - reverting..."
  git checkout "$DIR"
fi
```

**Usage**:
```bash
chmod +x fix-directory.sh
./fix-directory.sh src/runtime/
./fix-directory.sh src/api/
./fix-directory.sh src/execution/
# etc.
```

---

## Recommended Order (Fastest Impact)

```bash
# Day 1: Low-hanging fruit (2-3 hours)
npm run format:fix                        # ~150 fixes
npm run lint -- --fix --rule import/order # ~80 fixes
git add -A && git commit -m "style: auto-fix formatting"

# Day 2: Nullish coalescing (2 hours)
npm run lint -- --fix --rule @typescript-eslint/prefer-nullish-coalescing
# Review changes carefully
npm test
git add -A && git commit -m "refactor: auto-fix nullish coalescing"

# Day 3: Full auto-fix (3-4 hours)
npm run lint:fix
npm test
git add -A && git commit -m "refactor: auto-fix all ESLint violations"
# Progress: 6,945 → ~4,965

# Day 4: Critical manual fix (4 hours)
# Fix application.ts constructor pattern
git add -A && git commit -m "fix: remove null as any pattern"

# Week 2+: Systematic by directory
./fix-directory.sh src/runtime/
./fix-directory.sh src/mcp-tools/
./fix-directory.sh src/execution/
# ... etc
```

---

## Safety Checklist (ALWAYS)

After every fix session:

```bash
# 1. Type check
npm run typecheck

# 2. Lint check
npm run lint

# 3. Full test suite
npm test

# 4. Build check
npm run build

# 5. Manual smoke test
npm run start:debug
# Verify server starts and responds

# 6. Review changes
git diff --stat
git diff

# 7. Commit with detail
git add -A
git commit -m "fix: detailed message with what/why

- What was fixed
- How many violations
- Test results"
```

---

## Progress Tracking

Create a simple tracking file:

```bash
# Create tracker
cat > lint-progress.txt << 'EOF'
# Lint Fix Progress

## Baseline (2025-11-16)
Total: 6,945 violations

## Progress Log

### 2025-11-16 - Auto-fixes
- format:fix: -150
- import/order: -80
- prefer-nullish-coalescing: -175
- Full auto-fix: -1,575
**Total: 4,965 remaining** (-28%)

### 2025-11-17 - Critical fixes
- application.ts: -30
**Total: 4,935 remaining** (-29%)

### 2025-11-18 - src/runtime/
- strict-boolean-expressions: -45
**Total: 4,890 remaining** (-30%)

... continue tracking
EOF
```

Update after each session:
```bash
# Get current count
npm run lint 2>&1 | grep "problems" | tee -a lint-progress.txt
```

---

## When You Get Stuck

### Problem: Auto-fix breaks tests

**Solution**:
```bash
# Revert
git reset --hard

# Try smaller scope
npx eslint src/runtime/startup.ts --fix
npm test
# If pass, commit. If fail, revert and go even smaller.
```

### Problem: Too many violations in one file

**Solution**:
```bash
# Fix one rule at a time in that file
npx eslint src/api/index.ts --fix --rule prettier/prettier
npx eslint src/api/index.ts --fix --rule import/order
# etc.
```

### Problem: Unclear how to fix a violation

**Solution**:
```bash
# Get detailed error info
npx eslint src/problem-file.ts --format stylish

# Search the style guide
grep -A5 "rule-name" docs/TYPESCRIPT_STYLE_GUIDE.md

# Ask for help with specific error
# (Create issue with error message and context)
```

---

## Expected Timeline

**Optimistic** (4 hours/day dedicated):
- Week 1: Auto-fixes + critical patterns → 6,945 → 4,000 (-42%)
- Week 2-3: Directory by directory (src/runtime/, src/mcp-tools/, src/execution/) → 4,000 → 2,000 (-71%)
- Week 4-5: Remaining directories → 2,000 → 500 (-93%)
- Week 6: Polish + TypeScript errors → 500 → <100 (-98%)

**Realistic** (1-2 hours/day):
- Double the timeline: 12 weeks to full compliance

**Remember**: Pre-commit hooks prevent NEW violations, so you can take your time without regression risk!

---

## Celebration Milestones

- [ ] 6,945 → 5,000 (-28%) - Auto-fixes complete 🎉
- [ ] 5,000 → 3,000 (-57%) - Halfway there! 🎊
- [ ] 3,000 → 1,000 (-86%) - Final stretch 🚀
- [ ] 1,000 → 100 (-98%) - Almost clean! 🌟
- [ ] 100 → 0 (-100%) - **FULLY COMPLIANT** 🏆

---

**Good luck! Fix incrementally, test thoroughly, commit frequently.**
