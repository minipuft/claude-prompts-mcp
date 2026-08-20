---
title: "Plop.js Scaffolding Integration - Implementation Plan"
date: 2025-11-03
status: backlog
tags: []
---

# Plop.js Scaffolding Integration - Comprehensive Implementation Plan

**Status**: Ready for Implementation
**Created**: 2025-11-03
**Priority**: Medium-High
**Complexity**: Medium
**Estimated Duration**: 4 weeks
**Related PRD**: [plop-scaffolding-integration-prd.md](./plop-scaffolding-integration-prd.md)

## Executive Summary

This implementation plan details the technical approach for integrating Plop.js scaffolding into the MCP server's symbolic command language. The integration enables developers to invoke code generators through conversational workflows, capture generated files, and chain post-processing operations—all without leaving the MCP session.

**Timeline**: 4 weeks, structured in progressive phases from foundation to beta rollout
**Key Deliverables**: Registry system, scaffold operator, execution engine, documentation
**Success Criteria**: Developers can scaffold, inspect, and extend templates via symbolic commands

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│ Symbolic Command: @scaffold >>plop generator="component"        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ SymbolicCommandParser                                           │
│ - Detects scaffold operator pattern                            │
│ - Extracts generator name and options                          │
│ - Validates syntax                                             │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ PlopGeneratorRegistry                                           │
│ - Loads plopfile.js at startup                                 │
│ - Exposes generator metadata                                   │
│ - File watcher for hot-reload                                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ ScaffoldOperatorExecutor                                        │
│ - Executes generator.runActions()                              │
│ - Captures file paths from results                             │
│ - Handles errors and rollback                                  │
│ - Emits execution events                                       │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Post-Processing Chain                                           │
│ - Format generated files                                        │
│ - Run linting                                                   │
│ - Add to git staging                                           │
│ - Update plan notes                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

1. **Parse**: Symbolic command parser detects scaffold operator
2. **Validate**: Registry confirms generator exists and is safe
3. **Execute**: Executor runs Plop generator programmatically
4. **Capture**: File paths and metadata extracted from results
5. **Chain**: Generated files passed to subsequent operators
6. **Observe**: Execution logged and documented in plan notes

### Integration Points

- **Parser System** (`src/execution/parsers/`): Add scaffold operator detection
- **Operator System** (`src/execution/operators/`): New ScaffoldOperatorExecutor
- **Registry Pattern** (new `src/scaffolding/`): Generator discovery and management
- **Logging System** (`src/utils/logger.ts`): Scaffold-specific log levels
- **Plan Notes** (`plans/`): Execution documentation
- **Config System** (`server/config.json`): Feature flags and paths

---

## Phase 1: Foundation (Week 1)

**Goal**: Establish registry system, parser support, and feature flags without affecting existing functionality.

### Task 1.1: Dependency Installation

**File**: `package.json`

```json
{
  "devDependencies": {
    "node-plop": "^0.31.1"
  }
}
```

**Installation Command**:

```bash
npm install --save-dev node-plop
```

**Verification**:

- TypeScript types resolve correctly
- No conflicts with existing dependencies
- Build completes successfully

### Task 1.2: Registry System Implementation

**New File**: `server/src/scaffolding/plop-registry.ts`

```typescript
import nodePlop from "node-plop";
import { watch } from "fs";
import { resolve } from "path";
import type { NodePlopAPI, PlopGenerator } from "node-plop";

export interface GeneratorMetadata {
  name: string;
  description?: string;
  prompts: Array<{
    type: string;
    name: string;
    message: string;
  }>;
  actions: Array<{
    type: string;
    path?: string;
  }>;
}

export class PlopGeneratorRegistry {
  private plop: NodePlopAPI | null = null;
  private generators: Map<string, GeneratorMetadata> = new Map();
  private plopfilePath: string;
  private watcher: ReturnType<typeof watch> | null = null;
  private loaded: boolean = false;

  constructor(plopfilePath: string = "./tools/plopfile.js") {
    this.plopfilePath = resolve(plopfilePath);
  }

  /**
   * Load plopfile and introspect available generators
   */
  async load(): Promise<void> {
    try {
      this.plop = await nodePlop(this.plopfilePath);
      this.introspectGenerators();
      this.setupFileWatcher();
      this.loaded = true;
      console.log(`[PlopRegistry] Loaded ${this.generators.size} generators`);
    } catch (error) {
      console.error("[PlopRegistry] Failed to load plopfile:", error);
      throw new Error(`Failed to load Plop generators: ${error.message}`);
    }
  }

  /**
   * Extract metadata from all registered generators
   */
  private introspectGenerators(): void {
    if (!this.plop) return;

    // Plop doesn't expose a direct list, so we use getGeneratorList()
    const generatorNames = this.plop.getGeneratorList().map((g) => g.name);

    for (const name of generatorNames) {
      const generator = this.plop.getGenerator(name);
      if (generator) {
        this.generators.set(name, {
          name: generator.name,
          description: generator.description,
          prompts: generator.prompts || [],
          actions: generator.actions || [],
        });
      }
    }
  }

  /**
   * Watch plopfile for changes and reload
   */
  private setupFileWatcher(): void {
    this.watcher = watch(this.plopfilePath, async (eventType) => {
      if (eventType === "change") {
        console.log("[PlopRegistry] Plopfile changed, reloading...");
        await this.reload();
      }
    });
  }

  /**
   * Reload generators (hot-reload support)
   */
  async reload(): Promise<void> {
    this.generators.clear();
    // Clear module cache to reload plopfile
    delete require.cache[require.resolve(this.plopfilePath)];
    await this.load();
  }

  /**
   * List all available generator names
   */
  listGenerators(): string[] {
    return Array.from(this.generators.keys());
  }

  /**
   * Get metadata for a specific generator
   */
  getGeneratorMetadata(name: string): GeneratorMetadata | undefined {
    return this.generators.get(name);
  }

  /**
   * Get Plop generator instance for execution
   */
  getGenerator(name: string): PlopGenerator | undefined {
    if (!this.plop) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.plop.getGenerator(name);
  }

  /**
   * Check if a generator exists
   */
  hasGenerator(name: string): boolean {
    return this.generators.has(name);
  }

  /**
   * Cleanup watchers
   */
  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Check if registry is loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// Singleton instance
let registryInstance: PlopGeneratorRegistry | null = null;

export function getPlopRegistry(): PlopGeneratorRegistry {
  if (!registryInstance) {
    throw new Error(
      "Plop registry not initialized. Call initializePlopRegistry() first.",
    );
  }
  return registryInstance;
}

export async function initializePlopRegistry(
  plopfilePath?: string,
): Promise<void> {
  registryInstance = new PlopGeneratorRegistry(plopfilePath);
  await registryInstance.load();
}

export function disposePlopRegistry(): void {
  if (registryInstance) {
    registryInstance.dispose();
    registryInstance = null;
  }
}
```

**Key Design Decisions**:

- **Singleton pattern**: Ensures one registry instance across server lifetime
- **Lazy loading**: Registry initialization separate from instantiation
- **Hot-reload support**: File watcher automatically reloads on plopfile changes
- **Type safety**: Full TypeScript types for generator metadata
- **Error boundaries**: Comprehensive error handling with meaningful messages

### Task 1.3: Configuration Integration

**File**: `server/config.json`

```json
{
  "scaffolding": {
    "enabled": false,
    "plopfilePath": "./tools/plopfile.js",
    "security": {
      "allowShellActions": false,
      "maxFileSizeKB": 50,
      "maxFilesPerGeneration": 20
    },
    "logging": {
      "level": "info",
      "logToFile": true
    }
  }
}
```

**Configuration Schema** (`src/types.ts`):

```typescript
export interface ScaffoldingConfig {
  enabled: boolean;
  plopfilePath: string;
  security: {
    allowShellActions: boolean;
    maxFileSizeKB: number;
    maxFilesPerGeneration: number;
  };
  logging: {
    level: "info" | "warn" | "error";
    logToFile: boolean;
  };
}
```

### Task 1.4: Parser Extension

**File**: `server/src/execution/parsers/symbolic-operator-parser.ts`

```typescript
// Add to OPERATOR_PATTERNS
private readonly OPERATOR_PATTERNS = {
  framework: /@(\w+)\b/,
  chain: /-->/,
  gate: /::/,
  scaffold: /@scaffold\s+>>plop\s+generator="([^"]+)"(?:\s+options='({.*})')?/,
  // ... existing patterns
};

// Add to parseCommand method
private parseCommand(input: string): ParsedCommand {
  // ... existing parsing logic

  // Check for scaffold operator
  const scaffoldMatch = input.match(this.OPERATOR_PATTERNS.scaffold);
  if (scaffoldMatch) {
    const [fullMatch, generatorName, optionsJson] = scaffoldMatch;
    const options = optionsJson ? JSON.parse(optionsJson) : {};

    return {
      type: 'scaffold',
      operator: {
        type: 'scaffold',
        generator: generatorName,
        options,
        raw: fullMatch,
      },
      remaining: input.replace(fullMatch, '').trim(),
    };
  }

  // ... rest of parsing logic
}
```

**New Type Definition** (`src/execution/parsers/types/operator-types.ts`):

```typescript
export interface ScaffoldOperator extends BaseOperator {
  type: "scaffold";
  generator: string;
  options: Record<string, any>;
}

export type SymbolicOperator =
  | ChainOperator
  | FrameworkOperator
  | GateOperator
  | ScaffoldOperator
  | ParallelOperator
  | ConditionalOperator;
```

### Task 1.5: Server Initialization Integration

**File**: `server/src/runtime/application.ts`

```typescript
import {
  initializePlopRegistry,
  disposePlopRegistry,
} from "../scaffolding/plop-registry.js";

export class Application {
  async start(): Promise<void> {
    try {
      // ... existing startup logic

      // Initialize scaffolding (if enabled)
      if (this.config.scaffolding?.enabled) {
        console.log("[Application] Initializing Plop scaffolding...");
        await initializePlopRegistry(this.config.scaffolding.plopfilePath);
        console.log("[Application] ✓ Plop scaffolding ready");
      }

      // ... rest of startup
    } catch (error) {
      console.error("[Application] Startup failed:", error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log("[Application] Shutting down...");

    // Cleanup scaffolding
    if (this.config.scaffolding?.enabled) {
      disposePlopRegistry();
    }

    // ... existing shutdown logic
  }
}
```

### Task 1.6: Testing Foundation

**New File**: `tests/unit/plop-registry.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PlopGeneratorRegistry } from "../../server/src/scaffolding/plop-registry.js";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

describe("PlopGeneratorRegistry", () => {
  let registry: PlopGeneratorRegistry;
  const testPlopfile = join(__dirname, "../fixtures/test-plopfile.js");

  beforeEach(async () => {
    // Create test plopfile
    writeFileSync(
      testPlopfile,
      `
      export default function (plop) {
        plop.setGenerator('test-component', {
          description: 'Test component generator',
          prompts: [
            {
              type: 'input',
              name: 'name',
              message: 'Component name?',
            },
          ],
          actions: [
            {
              type: 'add',
              path: 'src/components/{{pascalCase name}}.tsx',
              templateFile: 'templates/component.hbs',
            },
          ],
        });
      }
    `,
    );

    registry = new PlopGeneratorRegistry(testPlopfile);
    await registry.load();
  });

  afterEach(() => {
    registry.dispose();
    unlinkSync(testPlopfile);
  });

  it("should load generators from plopfile", () => {
    expect(registry.isLoaded()).toBe(true);
    expect(registry.listGenerators()).toContain("test-component");
  });

  it("should retrieve generator metadata", () => {
    const metadata = registry.getGeneratorMetadata("test-component");
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe("test-component");
    expect(metadata?.description).toBe("Test component generator");
    expect(metadata?.prompts).toHaveLength(1);
  });

  it("should check generator existence", () => {
    expect(registry.hasGenerator("test-component")).toBe(true);
    expect(registry.hasGenerator("nonexistent")).toBe(false);
  });

  it("should get generator instance for execution", () => {
    const generator = registry.getGenerator("test-component");
    expect(generator).toBeDefined();
    expect(generator?.name).toBe("test-component");
  });

  it("should handle missing plopfile gracefully", async () => {
    const invalidRegistry = new PlopGeneratorRegistry("./nonexistent.js");
    await expect(invalidRegistry.load()).rejects.toThrow(
      "Failed to load Plop generators",
    );
  });
});
```

**New Fixture**: `tests/fixtures/test-plopfile.js`

Create minimal plopfile for testing (content in test above).

### Phase 1 Acceptance Criteria

- [ ] `node-plop` dependency installed and building successfully
- [ ] `PlopGeneratorRegistry` class implemented with full test coverage (>95%)
- [ ] Configuration schema defined and documented
- [ ] Parser recognizes scaffold operator pattern
- [ ] Server initialization includes conditional registry loading
- [ ] Unit tests pass: `npm run test:unit -- plop-registry.test.ts`
- [ ] TypeScript compilation clean: `npm run typecheck`
- [ ] No impact on existing functionality (all existing tests pass)
- [ ] Feature flag defaults to `false` (disabled)

---

## Phase 2: Execution (Week 2)

**Goal**: Implement scaffold operator executor with file capture, error handling, and result formatting.

### Task 2.1: Operator Executor Implementation

**New File**: `server/src/execution/operators/scaffold-operator-executor.ts`

```typescript
import { getPlopRegistry } from "../../scaffolding/plop-registry.js";
import type { ScaffoldOperator } from "../parsers/types/operator-types.js";
import { readFileSync, statSync } from "fs";
import { resolve } from "path";

export interface GeneratedFile {
  path: string;
  type: "add" | "modify" | "append";
  sizeBytes: number;
  content?: string;
  contentTruncated: boolean;
}

export interface ScaffoldResult {
  success: boolean;
  generatorName: string;
  filesGenerated: GeneratedFile[];
  filesModified: GeneratedFile[];
  failures: Array<{
    path: string;
    error: string;
    type: string;
  }>;
  summary: string;
  executionTimeMs: number;
  warnings: string[];
}

export class ScaffoldOperatorExecutor {
  private maxFileSizeKB: number;
  private maxFilesPerGeneration: number;

  constructor(config?: {
    maxFileSizeKB?: number;
    maxFilesPerGeneration?: number;
  }) {
    this.maxFileSizeKB = config?.maxFileSizeKB ?? 50;
    this.maxFilesPerGeneration = config?.maxFilesPerGeneration ?? 20;
  }

  /**
   * Execute scaffold operator
   */
  async execute(operator: ScaffoldOperator): Promise<ScaffoldResult> {
    const startTime = Date.now();
    const registry = getPlopRegistry();
    const warnings: string[] = [];

    // Validate generator exists
    if (!registry.hasGenerator(operator.generator)) {
      return this.createErrorResult(
        operator.generator,
        `Generator "${operator.generator}" not found. Available generators: ${registry.listGenerators().join(", ")}`,
        startTime,
      );
    }

    try {
      // Get generator instance
      const generator = registry.getGenerator(operator.generator);
      if (!generator) {
        throw new Error(
          `Failed to retrieve generator instance for "${operator.generator}"`,
        );
      }

      // Log execution
      console.log(
        `[ScaffoldExecutor] Running generator "${operator.generator}" with options:`,
        operator.options,
      );

      // Execute generator
      const results = await generator.runActions(operator.options);

      // Process results
      const filesGenerated: GeneratedFile[] = [];
      const filesModified: GeneratedFile[] = [];

      // Check file count limit
      if (results.changes.length > this.maxFilesPerGeneration) {
        warnings.push(
          `Generated ${results.changes.length} files, exceeding limit of ${this.maxFilesPerGeneration}. Only first ${this.maxFilesPerGeneration} will be included.`,
        );
      }

      // Capture file metadata and content
      const filesToProcess = results.changes.slice(
        0,
        this.maxFilesPerGeneration,
      );

      for (const change of filesToProcess) {
        try {
          const filePath = resolve(change.path);
          const stats = statSync(filePath);
          const sizeKB = stats.size / 1024;

          const file: GeneratedFile = {
            path: change.path,
            type: change.type as "add" | "modify" | "append",
            sizeBytes: stats.size,
            contentTruncated: false,
          };

          // Include content if under size limit
          if (sizeKB <= this.maxFileSizeKB) {
            file.content = readFileSync(filePath, "utf-8");
          } else {
            file.contentTruncated = true;
            warnings.push(
              `File ${change.path} exceeds ${this.maxFileSizeKB}KB limit, content excluded`,
            );
          }

          // Categorize by type
          if (change.type === "add") {
            filesGenerated.push(file);
          } else {
            filesModified.push(file);
          }
        } catch (error) {
          warnings.push(`Failed to read file ${change.path}: ${error.message}`);
        }
      }

      // Create success result
      const executionTimeMs = Date.now() - startTime;

      return {
        success: results.failures.length === 0,
        generatorName: operator.generator,
        filesGenerated,
        filesModified,
        failures: results.failures.map((f) => ({
          path: f.path || "unknown",
          error: f.error || "Unknown error",
          type: f.type || "unknown",
        })),
        summary: this.createSummary(
          filesGenerated,
          filesModified,
          results.failures,
        ),
        executionTimeMs,
        warnings,
      };
    } catch (error) {
      console.error(`[ScaffoldExecutor] Execution failed:`, error);
      return this.createErrorResult(
        operator.generator,
        error.message,
        startTime,
      );
    }
  }

  /**
   * Create error result
   */
  private createErrorResult(
    generatorName: string,
    error: string,
    startTime: number,
  ): ScaffoldResult {
    return {
      success: false,
      generatorName,
      filesGenerated: [],
      filesModified: [],
      failures: [{ path: "N/A", error, type: "execution" }],
      summary: `Failed to execute generator "${generatorName}": ${error}`,
      executionTimeMs: Date.now() - startTime,
      warnings: [],
    };
  }

  /**
   * Create human-readable summary
   */
  private createSummary(
    filesGenerated: GeneratedFile[],
    filesModified: GeneratedFile[],
    failures: any[],
  ): string {
    const parts: string[] = [];

    if (filesGenerated.length > 0) {
      parts.push(`Generated ${filesGenerated.length} file(s)`);
    }

    if (filesModified.length > 0) {
      parts.push(`Modified ${filesModified.length} file(s)`);
    }

    if (failures.length > 0) {
      parts.push(`${failures.length} failure(s)`);
    }

    if (parts.length === 0) {
      return "No changes made";
    }

    return parts.join(", ");
  }

  /**
   * Get list of all file paths from result
   */
  static getFilePaths(result: ScaffoldResult): string[] {
    return [
      ...result.filesGenerated.map((f) => f.path),
      ...result.filesModified.map((f) => f.path),
    ];
  }

  /**
   * Check if result has any failures
   */
  static hasFailures(result: ScaffoldResult): boolean {
    return result.failures.length > 0;
  }
}
```

**Key Design Decisions**:

- **File size limits**: Prevents response payload bloat
- **Content inclusion**: Only includes file content under size threshold
- **Categorization**: Separates generated vs modified files for clarity
- **Error handling**: Graceful degradation with detailed error messages
- **Performance tracking**: Execution time measurement
- **Warning system**: Non-fatal issues reported separately

### Task 2.2: Execution Integration

**File**: `server/src/execution/engine.ts`

```typescript
import { ScaffoldOperatorExecutor } from "./operators/scaffold-operator-executor.js";
import type { ScaffoldOperator } from "./parsers/types/operator-types.js";

export class ExecutionEngine {
  private scaffoldExecutor: ScaffoldOperatorExecutor;

  constructor(config: ExecutionConfig) {
    // ... existing executors

    this.scaffoldExecutor = new ScaffoldOperatorExecutor({
      maxFileSizeKB: config.scaffolding?.security?.maxFileSizeKB,
      maxFilesPerGeneration:
        config.scaffolding?.security?.maxFilesPerGeneration,
    });
  }

  async executeOperator(operator: SymbolicOperator): Promise<OperatorResult> {
    // ... existing operator handling

    if (operator.type === "scaffold") {
      return await this.executeScaffoldOperator(operator);
    }

    // ... rest of execution
  }

  private async executeScaffoldOperator(
    operator: ScaffoldOperator,
  ): Promise<OperatorResult> {
    const result = await this.scaffoldExecutor.execute(operator);

    // Log execution
    console.log(`[ExecutionEngine] Scaffold completed: ${result.summary}`);

    // Emit event for observability
    this.emit("scaffold:complete", {
      generator: result.generatorName,
      filesGenerated: result.filesGenerated.length,
      filesModified: result.filesModified.length,
      executionTimeMs: result.executionTimeMs,
      success: result.success,
    });

    return {
      type: "scaffold",
      success: result.success,
      data: result,
      context: {
        filePaths: ScaffoldOperatorExecutor.getFilePaths(result),
        generatorName: result.generatorName,
      },
    };
  }
}
```

### Task 2.3: Testing Executor

**New File**: `tests/integration/scaffold-operator.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  initializePlopRegistry,
  disposePlopRegistry,
} from "../../server/src/scaffolding/plop-registry.js";
import { ScaffoldOperatorExecutor } from "../../server/src/execution/operators/scaffold-operator-executor.js";
import { ScaffoldOperator } from "../../server/src/execution/parsers/types/operator-types.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

describe("ScaffoldOperatorExecutor Integration", () => {
  const testOutputDir = join(__dirname, "../fixtures/scaffold-output");
  let executor: ScaffoldOperatorExecutor;

  beforeAll(async () => {
    // Setup test environment
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true });
    }
    mkdirSync(testOutputDir, { recursive: true });

    // Initialize registry
    await initializePlopRegistry(
      join(__dirname, "../fixtures/test-plopfile.js"),
    );

    // Create executor
    executor = new ScaffoldOperatorExecutor({
      maxFileSizeKB: 50,
      maxFilesPerGeneration: 20,
    });
  });

  afterAll(() => {
    disposePlopRegistry();
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true });
    }
  });

  it("should execute generator and capture file paths", async () => {
    const operator: ScaffoldOperator = {
      type: "scaffold",
      generator: "test-component",
      options: {
        name: "TestComponent",
        outputDir: testOutputDir,
      },
    };

    const result = await executor.execute(operator);

    expect(result.success).toBe(true);
    expect(result.filesGenerated.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Generated");
    expect(result.executionTimeMs).toBeGreaterThan(0);
  });

  it("should include file content under size limit", async () => {
    const operator: ScaffoldOperator = {
      type: "scaffold",
      generator: "test-component",
      options: {
        name: "SmallComponent",
        outputDir: testOutputDir,
      },
    };

    const result = await executor.execute(operator);

    expect(result.filesGenerated[0].content).toBeDefined();
    expect(result.filesGenerated[0].contentTruncated).toBe(false);
  });

  it("should handle nonexistent generator gracefully", async () => {
    const operator: ScaffoldOperator = {
      type: "scaffold",
      generator: "nonexistent-generator",
      options: {},
    };

    const result = await executor.execute(operator);

    expect(result.success).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.summary).toContain("not found");
  });

  it("should enforce file count limits", async () => {
    const limitedExecutor = new ScaffoldOperatorExecutor({
      maxFileSizeKB: 50,
      maxFilesPerGeneration: 1,
    });

    const operator: ScaffoldOperator = {
      type: "scaffold",
      generator: "multi-file-component",
      options: {
        name: "MultiFile",
        outputDir: testOutputDir,
      },
    };

    const result = await limitedExecutor.execute(operator);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("exceeding limit");
  });

  it("should track execution time", async () => {
    const operator: ScaffoldOperator = {
      type: "scaffold",
      generator: "test-component",
      options: {
        name: "TimedComponent",
        outputDir: testOutputDir,
      },
    };

    const result = await executor.execute(operator);

    expect(result.executionTimeMs).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeLessThan(5000); // Should complete in <5s
  });
});
```

### Phase 2 Acceptance Criteria

- [ ] `ScaffoldOperatorExecutor` implemented with complete type safety
- [ ] File capture working with size/count limits
- [ ] Error handling graceful with meaningful messages
- [ ] Integration with execution engine complete
- [ ] Integration tests pass: `npm run test:integration -- scaffold-operator.test.ts`
- [ ] Performance benchmarks: Generator execution <2s for typical components
- [ ] Memory usage: No leaks during repeated scaffolding operations
- [ ] All existing tests still pass

---

## Phase 3: Integration (Week 3)

**Goal**: Enable post-processing chains, observability, and plan note integration.

### Task 3.1: Post-Processing Chain Integration

**File**: `server/src/execution/operators/chain-operator-executor.ts`

```typescript
export class ChainOperatorExecutor {
  async execute(operators: SymbolicOperator[]): Promise<ChainResult> {
    const results: OperatorResult[] = [];
    let context: Record<string, any> = {};

    for (const operator of operators) {
      // Execute operator
      const result = await this.executeOperator(operator, context);
      results.push(result);

      // Pass scaffold output to subsequent operators
      if (result.type === "scaffold" && result.data) {
        context.scaffoldedFiles = ScaffoldOperatorExecutor.getFilePaths(
          result.data,
        );
        context.scaffoldResult = result.data;
      }

      // Allow subsequent operators to consume scaffolded files
      if (operator.type === "format" && context.scaffoldedFiles) {
        // Format the generated files
        await this.formatFiles(context.scaffoldedFiles);
      }

      if (operator.type === "lint" && context.scaffoldedFiles) {
        // Lint the generated files
        await this.lintFiles(context.scaffoldedFiles);
      }

      // Stop chain on failure (if configured)
      if (!result.success && this.config.stopOnFailure) {
        break;
      }
    }

    return {
      success: results.every((r) => r.success),
      results,
      summary: this.createChainSummary(results),
    };
  }
}
```

**Example Chain Execution**:

```typescript
// User input: @scaffold >>plop generator="component" options='{"name":"Button"}' --> format --> lint

// Parsed operators:
[
  { type: "scaffold", generator: "component", options: { name: "Button" } },
  { type: "format", targets: ["<from-context>"] },
  { type: "lint", targets: ["<from-context>"] },
];

// Execution flow:
// 1. Scaffold executes, generates Button.tsx, Button.test.tsx
// 2. Context updated: { scaffoldedFiles: ['Button.tsx', 'Button.test.tsx'] }
// 3. Format executes on context.scaffoldedFiles
// 4. Lint executes on context.scaffoldedFiles
```

### Task 3.2: Observability Integration

**File**: `server/src/metrics/scaffold-metrics.ts`

```typescript
export interface ScaffoldMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  filesGenerated: number;
  filesModified: number;
  averageExecutionTimeMs: number;
  generatorUsage: Map<string, number>;
  lastExecutionTime: Date | null;
}

export class ScaffoldMetricsCollector {
  private metrics: ScaffoldMetrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    filesGenerated: 0,
    filesModified: 0,
    averageExecutionTimeMs: 0,
    generatorUsage: new Map(),
    lastExecutionTime: null,
  };

  private executionTimes: number[] = [];

  recordExecution(result: ScaffoldResult): void {
    // Update counters
    this.metrics.totalExecutions++;
    if (result.success) {
      this.metrics.successfulExecutions++;
    } else {
      this.metrics.failedExecutions++;
    }

    // Track files
    this.metrics.filesGenerated += result.filesGenerated.length;
    this.metrics.filesModified += result.filesModified.length;

    // Track execution time
    this.executionTimes.push(result.executionTimeMs);
    this.metrics.averageExecutionTimeMs =
      this.executionTimes.reduce((a, b) => a + b, 0) /
      this.executionTimes.length;

    // Track generator usage
    const currentCount =
      this.metrics.generatorUsage.get(result.generatorName) || 0;
    this.metrics.generatorUsage.set(result.generatorName, currentCount + 1);

    // Update timestamp
    this.metrics.lastExecutionTime = new Date();

    // Log at info level
    console.log(
      `[ScaffoldMetrics] ${result.generatorName}: ${result.summary} (${result.executionTimeMs}ms)`,
    );
  }

  getMetrics(): ScaffoldMetrics {
    return {
      ...this.metrics,
      generatorUsage: new Map(this.metrics.generatorUsage),
    };
  }

  getMostUsedGenerators(
    limit: number = 5,
  ): Array<{ generator: string; count: number }> {
    return Array.from(this.metrics.generatorUsage.entries())
      .map(([generator, count]) => ({ generator, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  reset(): void {
    this.metrics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      filesGenerated: 0,
      filesModified: 0,
      averageExecutionTimeMs: 0,
      generatorUsage: new Map(),
      lastExecutionTime: null,
    };
    this.executionTimes = [];
  }
}
```

### Task 3.3: Plan Note Integration

**File**: `server/src/utils/plan-note-writer.ts`

```typescript
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { ScaffoldResult } from "../execution/operators/scaffold-operator-executor.js";

export class PlanNoteWriter {
  private planDir: string;

  constructor(planDir: string = "./plans") {
    this.planDir = planDir;
  }

  /**
   * Append scaffold execution to plan note
   */
  appendScaffoldExecution(result: ScaffoldResult): void {
    const planFile = join(this.planDir, "scaffolding-history.md");

    // Ensure plans directory exists
    if (!existsSync(this.planDir)) {
      mkdirSync(this.planDir, { recursive: true });
    }

    // Format entry
    const timestamp = new Date().toISOString();
    const entry = this.formatScaffoldEntry(result, timestamp);

    // Append to file
    appendFileSync(planFile, entry + "\n\n", "utf-8");

    console.log(`[PlanNoteWriter] Scaffold execution documented: ${planFile}`);
  }

  private formatScaffoldEntry(
    result: ScaffoldResult,
    timestamp: string,
  ): string {
    const lines: string[] = [
      `### Scaffold Execution: ${result.generatorName}`,
      `**Timestamp**: ${timestamp}`,
      `**Status**: ${result.success ? "✅ Success" : "❌ Failed"}`,
      `**Execution Time**: ${result.executionTimeMs}ms`,
      `**Summary**: ${result.summary}`,
    ];

    if (result.filesGenerated.length > 0) {
      lines.push("");
      lines.push("**Files Generated**:");
      for (const file of result.filesGenerated) {
        lines.push(
          `- \`${file.path}\` (${(file.sizeBytes / 1024).toFixed(2)} KB)`,
        );
      }
    }

    if (result.filesModified.length > 0) {
      lines.push("");
      lines.push("**Files Modified**:");
      for (const file of result.filesModified) {
        lines.push(
          `- \`${file.path}\` (${(file.sizeBytes / 1024).toFixed(2)} KB)`,
        );
      }
    }

    if (result.failures.length > 0) {
      lines.push("");
      lines.push("**Failures**:");
      for (const failure of result.failures) {
        lines.push(`- \`${failure.path}\`: ${failure.error}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push("");
      lines.push("**Warnings**:");
      for (const warning of result.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get scaffolding history
   */
  getHistory(): string {
    const planFile = join(this.planDir, "scaffolding-history.md");

    if (!existsSync(planFile)) {
      return "No scaffolding history available.";
    }

    return readFileSync(planFile, "utf-8");
  }
}
```

### Task 3.4: MCP Tool Exposure

**File**: `server/src/mcp-tools/scaffold-tool.ts`

```typescript
import { z } from "zod";
import { getPlopRegistry } from "../scaffolding/plop-registry.js";
import { ScaffoldOperatorExecutor } from "../execution/operators/scaffold-operator-executor.js";

export const scaffoldToolSchema = z.object({
  action: z.enum(["list", "info", "execute", "history"]),
  generator: z.string().optional(),
  options: z.record(z.any()).optional(),
});

export async function handleScaffoldTool(
  args: z.infer<typeof scaffoldToolSchema>,
) {
  const registry = getPlopRegistry();

  switch (args.action) {
    case "list":
      return {
        generators: registry.listGenerators(),
        count: registry.listGenerators().length,
      };

    case "info":
      if (!args.generator) {
        throw new Error('Generator name required for "info" action');
      }
      return registry.getGeneratorMetadata(args.generator);

    case "execute":
      if (!args.generator) {
        throw new Error('Generator name required for "execute" action');
      }
      const executor = new ScaffoldOperatorExecutor();
      return await executor.execute({
        type: "scaffold",
        generator: args.generator,
        options: args.options || {},
      });

    case "history":
      const noteWriter = new PlanNoteWriter();
      return { history: noteWriter.getHistory() };

    default:
      throw new Error(`Unknown action: ${args.action}`);
  }
}
```

### Phase 3 Acceptance Criteria

- [ ] Post-processing chain works: scaffold → format → lint
- [ ] Metrics collection tracking all scaffold executions
- [ ] Plan notes automatically updated with scaffold history
- [ ] MCP tool `scaffold` exposed with `list`, `info`, `execute`, `history` actions
- [ ] Integration tests validate full workflow
- [ ] Performance: Chain execution <5s for typical workflows
- [ ] Observability: All executions logged at appropriate levels
- [ ] Documentation: Plan notes format human-readable

---

## Phase 4: Documentation & Beta (Week 4)

**Goal**: Create comprehensive documentation, examples, and beta rollout strategy.

### Task 4.1: User Documentation

**New File**: `docs/scaffolding.md`

````markdown
# Plop Scaffolding Integration

## Overview

The MCP server integrates Plop.js scaffolding into the symbolic command language, enabling automated code generation through conversational workflows.

## Quick Start

### Enable Scaffolding

Edit `server/config.json`:

\`\`\`json
{
"scaffolding": {
"enabled": true,
"plopfilePath": "./tools/plopfile.js"
}
}
\`\`\`

### Basic Usage

\`\`\`
@scaffold >>plop generator="component" options='{"name":"Button"}'
\`\`\`

This command:

1. Executes the "component" generator from your plopfile
2. Passes `{"name":"Button"}` as generator options
3. Captures generated file paths
4. Returns structured results with file metadata

## Chaining Operations

Scaffold operations integrate seamlessly with other operators:

\`\`\`
@scaffold >>plop generator="component" options='{"name":"Button"}' --> format --> lint
\`\`\`

This chain:

1. Generates component files
2. Formats generated files using project formatter
3. Runs linter on generated files
4. Reports combined results

## Generator Discovery

List available generators:

\`\`\`
@scaffold >>plop action="list"
\`\`\`

Get generator details:

\`\`\`
@scaffold >>plop action="info" generator="component"
\`\`\`

## Configuration

### Security Settings

\`\`\`json
{
"scaffolding": {
"security": {
"allowShellActions": false,
"maxFileSizeKB": 50,
"maxFilesPerGeneration": 20
}
}
}
\`\`\`

- **allowShellActions**: Allow generators to execute shell commands
- **maxFileSizeKB**: Maximum file size to include in response content
- **maxFilesPerGeneration**: Maximum number of files per generation

### Logging

\`\`\`json
{
"scaffolding": {
"logging": {
"level": "info",
"logToFile": true
}
}
}
\`\`\`

## Examples

### React Component

\`\`\`
@scaffold >>plop generator="react-component" options='{"name":"UserProfile","withTests":true}'
\`\`\`

### API Endpoint

\`\`\`
@scaffold >>plop generator="api-endpoint" options='{"resource":"users","methods":["GET","POST"]}'
\`\`\`

### Full Workflow

\`\`\`
@scaffold >>plop generator="feature" options='{"name":"Authentication"}' --> format --> lint --> git add
\`\`\`

## Troubleshooting

### Generator Not Found

**Error**: `Generator "component" not found`

**Solutions**:

- Verify generator exists in plopfile: `@scaffold >>plop action="list"`
- Check plopfilePath in config.json
- Ensure plopfile exports generators correctly

### File Size Limit Exceeded

**Warning**: `File exceeds 50KB limit, content excluded`

**Solutions**:

- Increase maxFileSizeKB in config
- Generator will still execute, but large files won't include content in response
- Files are still written to disk

### Hot-Reload Not Working

**Issue**: New generators not appearing after plopfile change

**Solutions**:

- File watcher triggers automatic reload
- Manual reload: Restart MCP server
- Check file watcher permissions

## API Reference

See [MCP Tools Reference](./mcp-tools-reference.md#scaffold) for programmatic API details.
\`\`\`

### Task 4.2: Symbolic Command Language Update

**File**: `docs/symbolic-command-language.md`

Add section:

\`\`\`markdown

## Scaffold Operator (`@scaffold >>plop`)

**Syntax**: `@scaffold >>plop generator="<name>" [options='<json>']`

**Purpose**: Execute Plop generators to scaffold code files

**Examples**:

\`\`\`

# Basic scaffolding

@scaffold >>plop generator="component" options='{"name":"Button"}'

# With post-processing

@scaffold >>plop generator="component" options='{"name":"Header"}' --> format --> lint

# Complex workflow

@CAGEERF @scaffold >>plop generator="feature" options='{"name":"Auth"}' --> format --> lint :: quality_check
\`\`\`

**Operator Precedence**: Scaffold operators execute before chain operators but after framework operators.

**Context Propagation**: Generated file paths are available to subsequent operators via `context.scaffoldedFiles`.
\`\`\`

### Task 4.3: Example Plopfile

**New File**: `tools/examples/component-plopfile.js`

```javascript
export default function (plop) {
  // React component generator
  plop.setGenerator("react-component", {
    description: "React component with TypeScript and tests",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Component name?",
      },
      {
        type: "confirm",
        name: "withTests",
        message: "Include tests?",
        default: true,
      },
    ],
    actions: (data) => {
      const actions = [
        {
          type: "add",
          path: "src/components/{{pascalCase name}}/{{pascalCase name}}.tsx",
          templateFile: "templates/component.tsx.hbs",
        },
        {
          type: "add",
          path: "src/components/{{pascalCase name}}/{{pascalCase name}}.module.css",
          templateFile: "templates/component.module.css.hbs",
        },
        {
          type: "add",
          path: "src/components/{{pascalCase name}}/index.ts",
          templateFile: "templates/component-index.ts.hbs",
        },
      ];

      if (data.withTests) {
        actions.push({
          type: "add",
          path: "src/components/{{pascalCase name}}/{{pascalCase name}}.test.tsx",
          templateFile: "templates/component.test.tsx.hbs",
        });
      }

      return actions;
    },
  });

  // Operator executor generator
  plop.setGenerator("operator-executor", {
    description: "Symbolic command operator executor",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Operator name?",
      },
    ],
    actions: [
      {
        type: "add",
        path: "server/src/execution/operators/{{kebabCase name}}-operator-executor.ts",
        templateFile: "templates/operator-executor.ts.hbs",
      },
      {
        type: "add",
        path: "tests/unit/{{kebabCase name}}-operator.test.ts",
        templateFile: "templates/operator-test.ts.hbs",
      },
    ],
  });
}
```
````

### Task 4.4: Beta Rollout Plan

**Document**: `plans/future/plop-beta-rollout.md`

```markdown
# Plop Scaffolding Beta Rollout Plan

## Rollout Stages

### Stage 1: Internal Testing (Week 4, Days 1-2)

**Participants**: Core maintainers only

**Focus**:

- Smoke test all generators
- Validate hot-reload functionality
- Test error handling edge cases
- Performance benchmarking

**Success Criteria**:

- All generators execute successfully
- No memory leaks during repeated operations
- Error messages are clear and actionable
- Performance within budget (<2s per generation)

### Stage 2: Limited Beta (Week 4, Days 3-4)

**Participants**: 3-5 early adopters

**Generators**:

- react-component (most commonly used)
- operator-executor (internal tooling)

**Feedback Collection**:

- Survey after 10 scaffold operations
- Direct feedback via GitHub Discussions
- Metrics review (usage patterns, failure rates)

**Success Criteria**:

- ≥80% satisfaction rating
- <5% failure rate
- No critical bugs reported

### Stage 3: Expanded Beta (Week 4, Days 5-7)

**Participants**: All interested developers

**Generators**: All available generators enabled

**Monitoring**:

- Daily metrics review
- Error log analysis
- Performance tracking

**Success Criteria**:

- ≥80% adoption rate for scaffolding tasks
- Reduction in manual CLI scaffolding
- Zero incidents of data corruption

## Rollback Procedure

If critical issues arise:

1. Set `scaffolding.enabled: false` in config
2. Restart MCP server
3. Document issue in GitHub
4. Revert to manual scaffolding workflow
5. Address issues before re-enabling

## Graduation to Stable

**Requirements**:

- 2 weeks of beta testing without critical bugs
- ≥90% success rate across all generators
- Comprehensive documentation complete
- Performance benchmarks met

**Timeline**: Target stable release 2 weeks after beta start
```

### Task 4.5: Migration Guide

**File**: `docs/scaffolding-migration-guide.md`

```markdown
# Migrating to MCP Scaffolding

## Overview

This guide helps teams migrate from manual CLI scaffolding to MCP-integrated workflows.

## Before Migration

### Prerequisites

- [ ] Existing plopfile.js with working generators
- [ ] MCP server version ≥1.x.x (with scaffolding support)
- [ ] Node.js 16+ installed
- [ ] Familiarity with symbolic command language

### Backup

Create backup of:

- Current plopfile.js
- Generated code examples
- Team documentation

## Migration Steps

### Step 1: Enable Scaffolding

Edit `server/config.json`:

\`\`\`json
{
"scaffolding": {
"enabled": true,
"plopfilePath": "./tools/plopfile.js"
}
}
\`\`\`

### Step 2: Verify Generators

List available generators:

\`\`\`
@scaffold >>plop action="list"
\`\`\`

Inspect each generator:

\`\`\`
@scaffold >>plop action="info" generator="component"
\`\`\`

### Step 3: Test One Generator

Pick simplest generator, test execution:

\`\`\`
@scaffold >>plop generator="simple-component" options='{"name":"TestComponent"}'
\`\`\`

Verify:

- Files generated correctly
- File paths captured
- No errors in response

### Step 4: Update Workflows

**Before** (manual CLI):
\`\`\`bash
npm run plop component

# Enter name: Button

npm run format
npm run lint
git add .
\`\`\`

**After** (MCP integrated):
\`\`\`
@scaffold >>plop generator="component" options='{"name":"Button"}' --> format --> lint --> git add
\`\`\`

### Step 5: Document for Team

Update team README with:

- How to enable scaffolding
- Common generator commands
- Troubleshooting tips
- Link to scaffolding docs

### Step 6: Monitor Adoption

Track metrics:

- Scaffold operations per week
- Success rate
- Most used generators
- Common failure patterns

## Rollback Plan

If issues arise:

1. Disable scaffolding: `scaffolding.enabled: false`
2. Restart server
3. Revert to CLI workflow
4. Report issues

## Best Practices

### Generator Design

- Keep generators focused (single responsibility)
- Provide clear descriptions
- Use meaningful prompt messages
- Handle edge cases gracefully

### Security

- Never allow shell actions in generators (`allowShellActions: false`)
- Review generator actions before deployment
- Limit file sizes to prevent response bloat
- Monitor generated file contents

### Performance

- Keep templates small (<50 KB per file)
- Limit files per generation (<20)
- Use caching where possible
- Profile slow generators

## Common Issues

### Issue: Generator changes not reflected

**Solution**: Hot-reload should handle this automatically. If not, restart server.

### Issue: Large files excluded from response

**Solution**: This is expected for files >50 KB. Files are still written to disk.

### Issue: Symbolic command syntax error

**Solution**: Verify syntax: `@scaffold >>plop generator="name" options='<valid-json>'`

## Success Metrics

After migration, expect:

- **Time savings**: 50% reduction in scaffolding time
- **Consistency**: 100% generator usage for new code
- **Documentation**: Automatic scaffold history in plan notes
- **Observability**: Clear metrics on generator usage

## Support

- Documentation: `docs/scaffolding.md`
- Examples: `tools/examples/component-plopfile.js`
- Issues: GitHub Issues
- Discussions: GitHub Discussions
```

### Phase 4 Acceptance Criteria

- [ ] User documentation complete and reviewed
- [ ] Symbolic command language docs updated
- [ ] Example plopfile provided with 2+ generators
- [ ] Beta rollout plan documented
- [ ] Migration guide complete
- [ ] Internal testing passed (Stage 1)
- [ ] Beta feedback collected (Stage 2-3)
- [ ] All documentation links verified
- [ ] Success metrics defined and tracked

---

## Technical Specifications

### File Structure

```
server/
├── src/
│   ├── scaffolding/
│   │   └── plop-registry.ts           # Registry system
│   ├── execution/
│   │   ├── operators/
│   │   │   └── scaffold-operator-executor.ts  # Executor
│   │   └── parsers/
│   │       ├── symbolic-operator-parser.ts     # Parser update
│   │       └── types/
│   │           └── operator-types.ts          # Type definitions
│   ├── metrics/
│   │   └── scaffold-metrics.ts        # Metrics collection
│   ├── mcp-tools/
│   │   └── scaffold-tool.ts           # MCP tool
│   └── utils/
│       └── plan-note-writer.ts        # Plan integration
├── config.json                         # Configuration
└── tools/
    ├── plopfile.js                     # Main plopfile
    └── examples/
        └── component-plopfile.js       # Example generators

tests/
├── unit/
│   ├── plop-registry.test.ts
│   └── scaffold-operator-executor.test.ts
├── integration/
│   └── scaffold-operator.test.ts
└── fixtures/
    ├── test-plopfile.js
    └── scaffold-output/

docs/
├── scaffolding.md                      # User guide
├── scaffolding-migration-guide.md      # Migration guide
├── symbolic-command-language.md        # Updated syntax docs
└── mcp-tools-reference.md              # API reference

plans/
├── future/
│   ├── plop-scaffolding-integration-prd.md
│   ├── plop-scaffolding-implementation-plan.md (this file)
│   └── plop-beta-rollout.md
└── scaffolding-history.md              # Auto-generated execution log
```

### Dependencies

```json
{
  "devDependencies": {
    "node-plop": "^0.31.1"
  }
}
```

**Rationale**: `node-plop` provides programmatic API for Plop.js. Dev dependency because scaffolding is build-time operation.

### Type Definitions

**Core Types** (`src/execution/parsers/types/operator-types.ts`):

```typescript
export interface ScaffoldOperator extends BaseOperator {
  type: "scaffold";
  generator: string;
  options: Record<string, any>;
}

export interface GeneratedFile {
  path: string;
  type: "add" | "modify" | "append";
  sizeBytes: number;
  content?: string;
  contentTruncated: boolean;
}

export interface ScaffoldResult {
  success: boolean;
  generatorName: string;
  filesGenerated: GeneratedFile[];
  filesModified: GeneratedFile[];
  failures: Array<{
    path: string;
    error: string;
    type: string;
  }>;
  summary: string;
  executionTimeMs: number;
  warnings: string[];
}
```

### API Surface

**PlopGeneratorRegistry**:

- `load(): Promise<void>` - Initialize registry
- `reload(): Promise<void>` - Hot-reload generators
- `listGenerators(): string[]` - Get generator names
- `getGeneratorMetadata(name): GeneratorMetadata | undefined` - Get metadata
- `getGenerator(name): PlopGenerator | undefined` - Get executable generator
- `hasGenerator(name): boolean` - Check existence
- `dispose(): void` - Cleanup watchers

**ScaffoldOperatorExecutor**:

- `execute(operator): Promise<ScaffoldResult>` - Execute generator
- `static getFilePaths(result): string[]` - Extract file paths
- `static hasFailures(result): boolean` - Check for failures

**ScaffoldMetricsCollector**:

- `recordExecution(result): void` - Record metrics
- `getMetrics(): ScaffoldMetrics` - Get current metrics
- `getMostUsedGenerators(limit): Array<{generator, count}>` - Top generators
- `reset(): void` - Clear metrics

---

## Testing Strategy

### Unit Tests

**Target Coverage**: ≥95% for new code

**Files to Test**:

- `plop-registry.ts` - Registry loader, introspection, hot-reload
- `scaffold-operator-executor.ts` - Execution, file capture, error handling
- `scaffold-metrics.ts` - Metrics collection and aggregation
- `plan-note-writer.ts` - History formatting and writing

**Test Framework**: Jest with TypeScript

**Sample Test Cases**:

```typescript
describe("PlopGeneratorRegistry", () => {
  it("should load generators from plopfile");
  it("should retrieve generator metadata");
  it("should check generator existence");
  it("should get generator instance for execution");
  it("should handle missing plopfile gracefully");
  it("should reload on file change");
  it("should cleanup watchers on dispose");
});

describe("ScaffoldOperatorExecutor", () => {
  it("should execute generator and capture file paths");
  it("should include file content under size limit");
  it("should handle nonexistent generator gracefully");
  it("should enforce file count limits");
  it("should track execution time");
  it("should separate generated vs modified files");
  it("should emit warnings for truncated content");
});
```

### Integration Tests

**Target Coverage**: Complete workflows end-to-end

**Test Scenarios**:

1. **Basic scaffolding**: Execute generator, verify files created
2. **Chain integration**: Scaffold → format → lint
3. **Error handling**: Nonexistent generator, invalid options
4. **Hot-reload**: Modify plopfile, verify new generator available
5. **Performance**: Execute 10 generators sequentially, verify <20s total
6. **Metrics**: Execute multiple times, verify metrics accuracy

**Test Environment**:

- Isolated test directory (`tests/fixtures/scaffold-output`)
- Test plopfile with known generators
- Cleanup after each test suite

### Performance Tests

**Benchmarks**:

- Generator execution: <2s per generation (typical component)
- Parser detection: <5ms overhead
- File capture: <100ms for 10 files
- Chain execution: <5s for scaffold → format → lint
- Memory usage: No leaks during 100 repeated operations

**Tools**:

- Node.js `performance.now()` for timing
- `process.memoryUsage()` for memory tracking
- Custom benchmark scripts in `tests/scripts/`

### Regression Tests

**Ensure No Breaking Changes**:

- All existing tests must pass
- TypeScript compilation clean
- No new linter errors
- Server startup time <3s (unchanged)
- MCP protocol compliance maintained

**Commands**:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:ci
```

---

## Success Metrics

### Adoption Metrics

**Target**: ≥80% of new scaffolding tasks via MCP within 30 days

**Measurement**:

- Track scaffold operator usage via `ScaffoldMetricsCollector`
- Compare against historical CLI scaffolding frequency
- Survey team after 30 days

### Reliability Metrics

**Target**: ≥95% success rate

**Measurement**:

- Track `successfulExecutions / totalExecutions` ratio
- Monitor error logs for patterns
- Weekly review of failure causes

### Performance Metrics

**Targets**:

- Generator execution: <2s per generation
- Chain execution: <5s for typical workflow
- Memory usage: <512 MB (server total)
- No memory leaks over 8-hour sessions

**Measurement**:

- `ScaffoldMetricsCollector.averageExecutionTimeMs`
- Node.js performance monitoring
- Memory profiling in development

### Quality Metrics

**Targets**:

- Test coverage: ≥95% for new code
- Zero data corruption incidents
- <5% of executions produce warnings

**Measurement**:

- Jest coverage reports
- Plan note review (no file corruption reports)
- Warning tracking in metrics

### Documentation Metrics

**Targets**:

- 100% of plan notes include scaffold history
- Zero "missing generator metadata" reports
- <2 documentation clarification requests per week

**Measurement**:

- Plan note audit
- GitHub issues tagged `documentation`
- Team feedback

---

## Risk Mitigation

### Risk: Generator Side Effects

**Impact**: High - Could cause unintended file modifications or security issues

**Mitigation**:

- Default `allowShellActions: false` in config
- Whitelist safe Plop actions (`add`, `modify`, `append`)
- Generator review process before deployment
- Sandbox test environment for new generators

**Rollback**: Disable offending generator, revert changes via git

### Risk: Large Output Payloads

**Impact**: Medium - Could cause response timeouts or memory issues

**Mitigation**:

- Size limits: `maxFileSizeKB: 50` default
- Count limits: `maxFilesPerGeneration: 20` default
- Content truncation with warnings
- Download hints for large files

**Rollback**: Adjust limits in config, restart server

### Risk: Registry Staleness

**Impact**: Low - Generator changes might not refresh

**Mitigation**:

- File watcher automatic reload
- Manual reload command fallback
- Startup validation (registry loads successfully)
- Clear error messages when registry not loaded

**Rollback**: Restart server to force reload

### Risk: Performance Degradation

**Impact**: Medium - Slow generators could block workflows

**Mitigation**:

- Execution time tracking and alerting
- Performance benchmarks in CI
- Timeout limits (configurable)
- Async execution (doesn't block server)

**Rollback**: Disable slow generators, optimize templates

### Risk: Breaking Existing Functionality

**Impact**: Critical - Could disrupt existing workflows

**Mitigation**:

- Feature flag defaulting to `false` (disabled)
- Comprehensive regression testing
- Phased rollout (internal → beta → stable)
- Clear rollback procedure documented

**Rollback**: Set `scaffolding.enabled: false`, restart server

---

## Monitoring and Observability

### Logging Levels

**Info Level** (default):

- Generator execution start/complete
- File counts and summary
- Execution time

**Warn Level**:

- File size limit exceeded
- File count limit exceeded
- Generator not found (after suggestion)

**Error Level**:

- Registry load failure
- Generator execution failure
- File read/write errors

### Metrics Dashboard

**Key Metrics** (via `ScaffoldMetricsCollector`):

- Total executions
- Success rate (%)
- Average execution time (ms)
- Files generated (total)
- Top 5 most-used generators

**Access**:

```
@scaffold >>plop action="metrics"
```

### Plan Note Audit

**Automatic Documentation**:

- Every scaffold execution appended to `plans/scaffolding-history.md`
- Includes: timestamp, generator, files, success/failure, warnings
- Human-readable format for retrospectives

**Review Frequency**: Weekly team review

### Health Checks

**Server Startup**:

- Registry loads successfully
- Generators introspected
- File watcher active

**Runtime**:

- Memory usage stable
- Execution times within budget
- Error rate <5%

**Alerting**: Console warnings for anomalies

---

## Rollback Procedures

### Immediate Rollback (Critical Issues)

**Trigger**: Data corruption, security vulnerability, server crashes

**Steps**:

1. Set `scaffolding.enabled: false` in `server/config.json`
2. Restart MCP server: `npm run start`
3. Verify existing functionality: `npm run test:ci`
4. Document issue in GitHub with `critical` label
5. Revert to manual CLI scaffolding workflow
6. Post-mortem within 24 hours

**Timeline**: <15 minutes to disable and restart

### Gradual Rollback (Quality Issues)

**Trigger**: High failure rate (>10%), poor performance, user dissatisfaction

**Steps**:

1. Disable problematic generators (remove from plopfile temporarily)
2. Keep scaffolding enabled for working generators
3. Analyze failure patterns and performance metrics
4. Fix issues in development environment
5. Re-enable after validation

**Timeline**: 1-2 days to analyze and fix

### Version Rollback (Breaking Changes)

**Trigger**: Incompatible changes after update

**Steps**:

1. Revert to previous server version via git
2. Reinstall dependencies: `npm install`
3. Rebuild: `npm run build`
4. Restart server
5. Verify functionality

**Timeline**: <30 minutes to revert and verify

---

## Future Enhancements

### Phase 5: Advanced Features (Future)

**LLM-Enhanced Generator Selection**:

- Analyze user intent to suggest best generator
- Smart defaults based on context
- Natural language → generator options

**Interactive Prompts**:

- Support generator prompts in conversational flow
- LLM fills in missing options intelligently
- User approval before execution

**Generator Composition**:

- Chain multiple generators: `@scaffold >>plop generator="feature+tests+docs"`
- Composite workflows for complex scaffolding
- Template inheritance and composition

**Performance Optimization**:

- Parallel file writing
- Incremental generation (only changed files)
- Smart caching for repeated patterns

**Enhanced Observability**:

- Visual diff preview before execution
- Real-time progress streaming
- Execution replay for debugging

---

## Appendix

### A. Glossary

- **Plop.js**: Micro-generator framework for consistent file generation
- **Generator**: Named template set that produces code files
- **Scaffold Operator**: Symbolic command operator (`@scaffold`) that invokes generators
- **Registry**: System that loads, introspects, and manages generators
- **Hot-reload**: Automatic reload of generators when plopfile changes
- **Post-processing**: Follow-up operations (format, lint) on generated files

### B. References

- [Plop.js Documentation](https://plopjs.com/)
- [node-plop API](https://github.com/plopjs/plop/tree/main/packages/node-plop)
- [Symbolic Command Language](./symbolic-command-language.md)
- [MCP Protocol Specification](https://modelcontextprotocol.io/docs)

### C. Change Log

- **2025-11-03**: Initial implementation plan created
- **Week 1**: Foundation phase implementation
- **Week 2**: Execution phase implementation
- **Week 3**: Integration phase implementation
- **Week 4**: Documentation and beta rollout

### D. Contributors

- Primary: Implementation team
- Review: Architecture team
- Beta testers: Early adopter developers

---

**Plan Status**: Ready for Implementation
**Next Steps**: Begin Phase 1 - Foundation (Week 1)
**Questions**: GitHub Discussions or project maintainers
