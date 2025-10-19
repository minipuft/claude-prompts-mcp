# Symbolic Command Language Implementation Plan

**Status**: Planning Phase
**Created**: 2025-10-19
**Last Updated**: 2025-10-19
**Priority**: High
**Complexity**: Medium-High

## Executive Summary

Enhance the parser system to support intuitive symbolic operators for dynamic prompt composition, eliminating the need for explicit template files for common workflow patterns like chaining, quality gates, and framework selection.

**Core Vision**: Transform `>>content_analysis {{content}} --> deep_analysis --> notes = "comprehensive"` into a first-class command syntax.

## Problem Statement

### Current Limitations

1. **Template File Dependency**: Creating multi-step workflows requires:
   - Creating markdown template file (e.g., `/prompts/analysis/notes.md`)
   - Defining step-by-step instructions
   - Manually managing context propagation
   - Updating `prompts.json` registry

2. **Workflow Rigidity**:
   - Fixed execution sequences
   - No ad-hoc composition
   - Limited dynamic behavior
   - Verbose syntax for simple patterns

3. **Implicit Quality Control**:
   - Gates must be predefined
   - No inline validation criteria
   - Difficult to express expected outcomes

4. **Framework Selection Friction**:
   - Requires explicit `system_control` tool call
   - Persists globally (can affect other executions)
   - No scoped/temporary framework application

### User Pain Points

**Example Current Workflow**:
```bash
# Step 1: Create template file
cat > prompts/analysis/my_research.md <<EOF
# Research Workflow
{{steps definition...}}
EOF

# Step 2: Register in prompts.json
# Edit prompts/analysis/prompts.json manually

# Step 3: Execute
>>my_research topic="AI trends"
```

**Desired Workflow**:
```bash
# Single command - no template needed
>>web_search "AI trends" --> deep_analysis --> synthesis_report = "actionable insights"
```

## Proposed Solution: Symbolic Command Language

### Operator Catalog

#### 1. Chain Operator: `-->` (Sequential Execution)

**Purpose**: Compose prompts into sequential workflows without template files

**Syntax**:
```bash
>>prompt1 args --> prompt2 --> prompt3
```

**Examples**:
```bash
# Simple chain
>>content_analysis {{content}} --> deep_analysis --> note_refinement

# With arguments
>>web_search query="AI ethics" --> summarize depth="comprehensive" --> translate language="spanish"

# Multi-step research
>>literature_review topic="quantum computing" --> gap_analysis --> research_proposal
```

**Execution Behavior**:
- Each step receives previous step's output as input
- Automatic variable mapping: `step1_result`, `step2_result`, etc.
- Context preservation across chain
- Session state management via ChainSessionManager
- Gate validation at each step (if enabled)

**Implementation Mapping**:
- Integrates with existing `ChainExecutor`
- Dynamically generates chain step definitions
- Uses Nunjucks template variables for context passing

#### 2. Quality Gate Operator: `=` (Validation Criteria)

**Purpose**: Inline quality validation without predefined gate definitions

**Syntax**:
```bash
>>prompt args = "validation criteria"
```

**Examples**:
```bash
# Code quality validation
>>code_review target="app.ts" = "no type errors, 80% test coverage, follows style guide"

# Research depth validation
>>deep_research topic="climate change" = "minimum 10 academic sources, peer-reviewed, published after 2020"

# Content completeness
>>documentation topic="API" = "includes examples, covers error cases, has diagrams"

# Chain with final gate
>>analysis --> synthesis --> report = "executive summary included, data visualizations present"
```

**Execution Behavior**:
- Parses criteria string into validation requirements
- Creates temporary gate definition with LLM-based evaluation
- Applies gate after execution completes
- Returns pass/fail status with detailed reasoning
- Optional retry on failure (configurable)

**Implementation Details**:
```typescript
// Generated temporary gate structure
{
  type: 'quality',
  name: 'inline_gate_<hash>',
  description: 'Inline validation criteria',
  criteria: [
    "no type errors",
    "80% test coverage",
    "follows style guide"
  ],
  scope: 'execution',
  temporary: true
}
```

#### 3. Framework Selector: `@` (Methodology)

**Purpose**: Apply specific framework/methodology for single execution

**Syntax**:
```bash
@FRAMEWORK >>prompt args
```

**Examples**:
```bash
# CAGEERF for strategic thinking
@CAGEERF >>product_roadmap feature="user_authentication"

# ReACT for debugging
@ReACT >>debug_issue error="memory_leak" logs="{{logs}}"

# 5W1H for requirements
@5W1H >>requirements_gathering stakeholder="product_manager"

# SCAMPER for innovation
@SCAMPER >>brainstorm_features product="smartwatch"

# Framework with chain
@CAGEERF >>strategic_analysis --> implementation_plan --> risk_assessment
```

**Execution Behavior**:
- Temporarily switches to specified framework
- Applies framework-specific system prompt enhancements
- Executes prompt with framework context
- Automatically reverts to default framework after execution
- Framework name case-insensitive (CAGEERF = cageerf = CaGeErF)

**Supported Frameworks**:
- `CAGEERF`: Context → Analysis → Goals → Execution → Evaluation → Refinement → Framework
- `ReACT`: Reasoning and Acting for systematic problem-solving
- `5W1H`: Who, What, When, Where, Why, How analysis
- `SCAMPER`: Substitute, Combine, Adapt, Modify, Put to other use, Eliminate, Reverse

#### 4. Parallel Execution: `+` (Concurrent Analysis)

**Purpose**: Execute multiple prompts concurrently and aggregate results

**Syntax**:
```bash
>>prompt1 args + prompt2 args + prompt3 args
```

**Examples**:
```bash
# Multi-perspective analysis
>>market_analysis product="X" + competitive_analysis product="X" + user_research product="X"

# Parallel research
>>academic_search topic="AI" + news_search topic="AI" + patent_search topic="AI"

# Diverse evaluations
>>code_review_security + code_review_performance + code_review_maintainability
```

**Execution Behavior**:
- Execute all prompts concurrently (true parallelization)
- Aggregate results into unified response
- Include execution time comparison
- Merge metadata from all executions

**Implementation Notes**:
- Uses `Promise.all()` for concurrent execution
- Each prompt gets independent execution context
- Results combined with section headers
- Useful for independent analyses that don't depend on each other

#### 5. Conditional Execution: `?` (Decision Branching)

**Purpose**: Branch execution based on output evaluation

**Syntax**:
```bash
>>prompt args ? "condition" : alternative_prompt
```

**Examples**:
```bash
# Error-aware workflow
>>code_analysis file="app.ts" ? "errors found" : comprehensive_review

# Complexity-based routing
>>analyze_complexity code="{{code}}" ? "complexity > 10" : simple_refactor : complex_redesign

# Adaptive research depth
>>initial_research topic="{{topic}}" ? "sufficient depth" : deep_research
```

**Execution Behavior**:
- Execute initial prompt
- LLM evaluates condition against output
- If condition true: execute conditional prompt
- If condition false: execute alternative (or stop)
- Return combined execution path metadata

**Implementation Complexity**: Phase 3 (advanced feature)

### Operator Precedence & Composition

#### Precedence Rules (Highest to Lowest)

1. **`@` Framework** - Applies to entire execution scope
2. **`?` Conditional** - Determines execution path
3. **`+` Parallel** - Execution strategy
4. **`-->` Chain** - Sequential composition
5. **`=` Gate** - Final validation

#### Complex Composition Examples

```bash
# Framework + Chain + Gate
@CAGEERF >>strategic_analysis topic="market_expansion" --> implementation_roadmap --> risk_assessment = "comprehensive coverage, realistic timelines"

# Parallel + Chain + Gate
>>market_research + competitive_analysis + user_survey --> synthesis_report = "actionable recommendations"

# Framework + Conditional + Chain
@ReACT >>diagnose_issue logs="{{logs}}" ? "root cause identified" : deep_investigation --> fix_implementation

# Full composition
@CAGEERF >>requirement_gathering + technical_feasibility --> architecture_design = "scalable, maintainable" --> implementation_plan
```

#### Parsing Order

```
Input: @CAGEERF >>analysis {{content}} --> synthesis --> notes = "comprehensive"

Parse Tree:
├── Framework Operator: @CAGEERF (scope: entire execution)
├── Chain Operator: --> (3 steps)
│   ├── Step 1: analysis {{content}}
│   ├── Step 2: synthesis
│   └── Step 3: notes
└── Gate Operator: = "comprehensive" (validation on final output)
```

## Technical Architecture

### Phase 1: Foundation - Symbolic Parser (Week 1)

#### New Files Structure

```
server/src/execution/parsers/
├── symbolic-command-parser.ts          # Main symbolic parser
├── operators/
│   ├── index.ts                        # Operator exports
│   ├── chain-operator.ts               # --> implementation
│   ├── gate-operator.ts                # = implementation
│   ├── framework-operator.ts           # @ implementation
│   ├── parallel-operator.ts            # + implementation
│   └── conditional-operator.ts         # ? implementation
└── types/
    ├── operator-types.ts               # Operator interfaces
    └── parse-result-extensions.ts      # Extended CommandParseResult
```

#### Core Type Definitions

```typescript
// server/src/execution/parsers/types/operator-types.ts

/**
 * Chain operator representing sequential execution
 */
export interface ChainOperator {
  type: 'chain';
  steps: ChainStep[];
  contextPropagation: 'automatic' | 'manual';
}

export interface ChainStep {
  promptId: string;
  args: string;
  position: number;
  variableName: string; // e.g., "step1_result"
}

/**
 * Quality gate operator for inline validation
 */
export interface GateOperator {
  type: 'gate';
  criteria: string;
  parsedCriteria: string[]; // Split by commas/logical separators
  scope: 'execution' | 'step' | 'chain';
  retryOnFailure: boolean;
  maxRetries: number;
}

/**
 * Framework selector operator
 */
export interface FrameworkOperator {
  type: 'framework';
  frameworkId: string;
  normalizedId: string; // Uppercased for validation
  temporary: boolean; // Always true for @ operator
  scopeType: 'execution' | 'chain';
}

/**
 * Parallel execution operator
 */
export interface ParallelOperator {
  type: 'parallel';
  prompts: ParallelPrompt[];
  aggregationStrategy: 'merge' | 'compare' | 'summarize';
}

export interface ParallelPrompt {
  promptId: string;
  args: string;
  position: number;
}

/**
 * Conditional execution operator
 */
export interface ConditionalOperator {
  type: 'conditional';
  condition: string;
  conditionType: 'presence' | 'comparison' | 'pattern';
  trueBranch: string; // Prompt ID for true path
  falseBranch?: string; // Prompt ID for false path (optional)
}

/**
 * Unified operator container
 */
export type SymbolicOperator =
  | ChainOperator
  | GateOperator
  | FrameworkOperator
  | ParallelOperator
  | ConditionalOperator;

/**
 * Operator detection result
 */
export interface OperatorDetectionResult {
  hasOperators: boolean;
  operatorTypes: string[]; // ['chain', 'gate', 'framework']
  operators: SymbolicOperator[];
  parseComplexity: 'simple' | 'moderate' | 'complex';
}
```

#### Extended CommandParseResult

```typescript
// server/src/execution/parsers/types/parse-result-extensions.ts

import { SymbolicOperator, OperatorDetectionResult } from './operator-types.js';

export interface SymbolicCommandParseResult extends CommandParseResult {
  format: 'simple' | 'json' | 'symbolic' | 'chain';
  operators?: OperatorDetectionResult;
  executionPlan?: ExecutionPlan;
}

/**
 * Execution plan generated from operators
 */
export interface ExecutionPlan {
  steps: ExecutionStep[];
  frameworkOverride?: string;
  finalValidation?: GateOperator;
  estimatedComplexity: number; // 1-10 scale
  requiresSessionState: boolean;
}

export interface ExecutionStep {
  stepNumber: number;
  type: 'prompt' | 'gate' | 'framework_switch' | 'parallel_group';
  promptId?: string;
  args?: string;
  dependencies: number[]; // Step numbers this depends on
  outputVariable: string; // e.g., "step1_result"
}
```

#### Symbolic Parser Implementation

```typescript
// server/src/execution/parsers/symbolic-command-parser.ts

import { Logger } from "../../logging/index.js";
import { PromptData } from "../../types/index.js";
import { ValidationError } from "../../utils/index.js";
import {
  SymbolicCommandParseResult,
  OperatorDetectionResult,
  SymbolicOperator
} from "./types/index.js";

export class SymbolicCommandParser {
  private logger: Logger;

  // Operator detection patterns
  private readonly OPERATOR_PATTERNS = {
    chain: /-->/g,
    gate: /\s*=\s*["'](.+?)["']\s*$/,
    framework: /^@([A-Za-z0-9]+)\s+/,
    parallel: /\s*\+\s*/g,
    conditional: /\s*\?\s*["'](.+?)["']\s*:\s*(\w+)/
  };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Detect symbolic operators in command
   */
  public detectOperators(command: string): OperatorDetectionResult {
    const operators: SymbolicOperator[] = [];
    const operatorTypes: string[] = [];

    // Detect framework operator (@)
    const frameworkMatch = command.match(this.OPERATOR_PATTERNS.framework);
    if (frameworkMatch) {
      operatorTypes.push('framework');
      operators.push({
        type: 'framework',
        frameworkId: frameworkMatch[1],
        normalizedId: frameworkMatch[1].toUpperCase(),
        temporary: true,
        scopeType: 'execution'
      });
    }

    // Detect chain operator (-->)
    const chainMatches = command.match(this.OPERATOR_PATTERNS.chain);
    if (chainMatches && chainMatches.length > 0) {
      operatorTypes.push('chain');
      operators.push(this.parseChainOperator(command));
    }

    // Detect gate operator (=)
    const gateMatch = command.match(this.OPERATOR_PATTERNS.gate);
    if (gateMatch) {
      operatorTypes.push('gate');
      operators.push({
        type: 'gate',
        criteria: gateMatch[1],
        parsedCriteria: this.parseCriteria(gateMatch[1]),
        scope: 'execution',
        retryOnFailure: true,
        maxRetries: 1
      });
    }

    // Detect parallel operator (+)
    const parallelMatches = command.match(this.OPERATOR_PATTERNS.parallel);
    if (parallelMatches && parallelMatches.length > 0 && !chainMatches) {
      operatorTypes.push('parallel');
      operators.push(this.parseParallelOperator(command));
    }

    // Detect conditional operator (?)
    const conditionalMatch = command.match(this.OPERATOR_PATTERNS.conditional);
    if (conditionalMatch) {
      operatorTypes.push('conditional');
      operators.push({
        type: 'conditional',
        condition: conditionalMatch[1],
        conditionType: 'presence',
        trueBranch: conditionalMatch[2],
        falseBranch: undefined
      });
    }

    const complexity = this.calculateComplexity(operators);

    return {
      hasOperators: operators.length > 0,
      operatorTypes,
      operators,
      parseComplexity: complexity
    };
  }

  /**
   * Parse chain operator into structured steps
   */
  private parseChainOperator(command: string): ChainOperator {
    // Remove framework operator if present
    let cleanCommand = command.replace(this.OPERATOR_PATTERNS.framework, '');

    // Remove gate operator if present
    cleanCommand = cleanCommand.replace(this.OPERATOR_PATTERNS.gate, '');

    // Split by chain operator
    const stepStrings = cleanCommand.split('-->').map(s => s.trim());

    const steps = stepStrings.map((stepStr, index) => {
      // Parse each step (format: >>prompt_name args or just prompt_name)
      const stepMatch = stepStr.match(/^(?:>>)?([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);

      if (!stepMatch) {
        throw new ValidationError(`Invalid chain step format: ${stepStr}`);
      }

      return {
        promptId: stepMatch[1],
        args: stepMatch[2] || '',
        position: index,
        variableName: `step${index + 1}_result`
      };
    });

    return {
      type: 'chain',
      steps,
      contextPropagation: 'automatic'
    };
  }

  /**
   * Parse parallel operator into concurrent prompts
   */
  private parseParallelOperator(command: string): ParallelOperator {
    const promptStrings = command.split('+').map(s => s.trim());

    const prompts = promptStrings.map((promptStr, index) => {
      const promptMatch = promptStr.match(/^(?:>>)?([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);

      if (!promptMatch) {
        throw new ValidationError(`Invalid parallel prompt format: ${promptStr}`);
      }

      return {
        promptId: promptMatch[1],
        args: promptMatch[2] || '',
        position: index
      };
    });

    return {
      type: 'parallel',
      prompts,
      aggregationStrategy: 'merge'
    };
  }

  /**
   * Parse gate criteria into individual requirements
   */
  private parseCriteria(criteriaString: string): string[] {
    // Split by common delimiters
    return criteriaString
      .split(/,|and|\||;/)
      .map(c => c.trim())
      .filter(c => c.length > 0);
  }

  /**
   * Calculate parse complexity based on operators
   */
  private calculateComplexity(operators: SymbolicOperator[]): 'simple' | 'moderate' | 'complex' {
    if (operators.length === 0) return 'simple';
    if (operators.length === 1) return 'simple';
    if (operators.length === 2) return 'moderate';
    return 'complex';
  }

  /**
   * Generate execution plan from operators
   */
  public generateExecutionPlan(
    operators: OperatorDetectionResult,
    basePromptId: string,
    baseArgs: string
  ): ExecutionPlan {
    const steps: ExecutionStep[] = [];
    let frameworkOverride: string | undefined;
    let finalValidation: GateOperator | undefined;

    // Extract framework override
    const frameworkOp = operators.operators.find(op => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      frameworkOverride = frameworkOp.normalizedId;
    }

    // Extract final gate
    const gateOp = operators.operators.find(op => op.type === 'gate');
    if (gateOp && gateOp.type === 'gate') {
      finalValidation = gateOp;
    }

    // Build execution steps based on operator types
    const chainOp = operators.operators.find(op => op.type === 'chain');
    if (chainOp && chainOp.type === 'chain') {
      // Chain execution
      chainOp.steps.forEach((step, index) => {
        steps.push({
          stepNumber: index + 1,
          type: 'prompt',
          promptId: step.promptId,
          args: step.args,
          dependencies: index > 0 ? [index] : [],
          outputVariable: step.variableName
        });
      });
    } else {
      // Single prompt execution
      steps.push({
        stepNumber: 1,
        type: 'prompt',
        promptId: basePromptId,
        args: baseArgs,
        dependencies: [],
        outputVariable: 'result'
      });
    }

    return {
      steps,
      frameworkOverride,
      finalValidation,
      estimatedComplexity: operators.operators.length,
      requiresSessionState: steps.length > 1
    };
  }
}

export function createSymbolicCommandParser(logger: Logger): SymbolicCommandParser {
  return new SymbolicCommandParser(logger);
}
```

### Phase 2: Operator Executors (Week 2)

#### Chain Operator Execution

```typescript
// server/src/execution/operators/chain-executor.ts

import { ChainOperator, ChainStep } from "../parsers/types/operator-types.js";
import { ChainExecutor } from "../../mcp-tools/prompt-engine/core/executor.js";

export class ChainOperatorExecutor {
  private chainExecutor: ChainExecutor;

  constructor(chainExecutor: ChainExecutor) {
    this.chainExecutor = chainExecutor;
  }

  /**
   * Execute chain operator by generating dynamic chain definition
   */
  async execute(
    chainOp: ChainOperator,
    initialContext: Record<string, any>
  ): Promise<any> {
    // Convert chain operator to chain execution format
    const chainSteps = chainOp.steps.map(step => ({
      prompt: step.promptId,
      arguments: this.parseStepArguments(step.args, initialContext)
    }));

    // Generate temporary chain prompt definition
    const chainPrompt = this.generateChainPrompt(chainSteps);

    // Execute using existing ChainExecutor
    return await this.chainExecutor.executeChain({
      promptId: '__dynamic_chain__',
      promptArgs: initialContext,
      convertedPrompt: chainPrompt,
      chainGateIds: [],
      chainExecutionId: `chain_${Date.now()}`
    }, {
      enableGates: true,
      session_id: `symbolic_${Date.now()}`
    });
  }

  private parseStepArguments(
    argsString: string,
    context: Record<string, any>
  ): Record<string, any> {
    // Parse argument string into object
    // Support both "key=value" and template variables "{{var}}"
    const args: Record<string, any> = {};

    // Simple parsing - can be enhanced
    const kvPairs = argsString.match(/(\w+)="([^"]*)"/g);
    if (kvPairs) {
      kvPairs.forEach(pair => {
        const [key, value] = pair.split('=');
        args[key] = value.replace(/"/g, '');
      });
    } else if (argsString.trim()) {
      // Single argument, map to 'content' or 'input'
      args.content = argsString.trim();
    }

    return args;
  }

  private generateChainPrompt(steps: any[]): any {
    // Generate ConvertedPrompt structure
    return {
      id: '__dynamic_chain__',
      name: 'Dynamic Chain',
      type: 'chain',
      steps: steps,
      metadata: {
        generatedFrom: 'symbolic_operator',
        timestamp: new Date().toISOString()
      }
    };
  }
}
```

#### Gate Operator Execution

```typescript
// server/src/execution/operators/gate-executor.ts

import { GateOperator } from "../parsers/types/operator-types.js";
import { LightweightGateSystem } from "../../gates/core/index.js";
import type { TemporaryGateDefinition } from "../../gates/core/temporary-gate-registry.js";

export class GateOperatorExecutor {
  private gateSystem: LightweightGateSystem;

  constructor(gateSystem: LightweightGateSystem) {
    this.gateSystem = gateSystem;
  }

  /**
   * Execute gate operator by creating temporary gate and validating
   */
  async execute(
    gateOp: GateOperator,
    executionResult: any,
    executionId: string
  ): Promise<{
    passed: boolean;
    gateResults: any;
    retryRequired: boolean;
  }> {
    // Generate temporary gate definition
    const gateDefinition: TemporaryGateDefinition = {
      name: `inline_gate_${Date.now()}`,
      type: 'quality',
      scope: gateOp.scope,
      description: `Inline validation: ${gateOp.criteria}`,
      guidance: this.generateGateGuidance(gateOp.parsedCriteria),
      pass_criteria: gateOp.parsedCriteria
    };

    // Register temporary gate
    const gateId = await this.gateSystem.registerTemporaryGate(
      gateDefinition,
      executionId
    );

    // Evaluate gate
    const gateResults = await this.gateSystem.evaluateGates(
      [gateId],
      executionResult
    );

    const passed = gateResults.every((r: any) => r.passed);
    const retryRequired = !passed && gateOp.retryOnFailure;

    return {
      passed,
      gateResults,
      retryRequired
    };
  }

  private generateGateGuidance(criteria: string[]): string {
    return `Evaluate the output against these criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  }
}
```

#### Framework Operator Execution

```typescript
// server/src/execution/operators/framework-executor.ts

import { FrameworkOperator } from "../parsers/types/operator-types.js";
import { FrameworkStateManager } from "../../frameworks/framework-state-manager.js";

export class FrameworkOperatorExecutor {
  private frameworkStateManager: FrameworkStateManager;
  private originalFramework: string | null = null;

  constructor(frameworkStateManager: FrameworkStateManager) {
    this.frameworkStateManager = frameworkStateManager;
  }

  /**
   * Apply framework override before execution
   */
  async applyFrameworkOverride(frameworkOp: FrameworkOperator): Promise<void> {
    // Store original framework
    const currentFramework = this.frameworkStateManager.getCurrentFramework();
    this.originalFramework = currentFramework.frameworkId;

    // Temporarily switch to requested framework
    await this.frameworkStateManager.switchFramework(
      frameworkOp.normalizedId,
      `Symbolic operator: temporary framework switch`
    );
  }

  /**
   * Restore original framework after execution
   */
  async restoreFramework(): Promise<void> {
    if (this.originalFramework) {
      await this.frameworkStateManager.switchFramework(
        this.originalFramework,
        `Restoring framework after symbolic operator execution`
      );
      this.originalFramework = null;
    }
  }

  /**
   * Execute with framework context (try-finally pattern)
   */
  async executeWithFramework<T>(
    frameworkOp: FrameworkOperator,
    executionFn: () => Promise<T>
  ): Promise<T> {
    try {
      await this.applyFrameworkOverride(frameworkOp);
      return await executionFn();
    } finally {
      await this.restoreFramework();
    }
  }
}
```

### Phase 3: Integration (Week 3)

#### UnifiedCommandParser Enhancement

```typescript
// Additions to server/src/execution/parsers/unified-command-parser.ts

import { SymbolicCommandParser } from './symbolic-command-parser.js';
import { SymbolicCommandParseResult } from './types/parse-result-extensions.js';

export class UnifiedCommandParser {
  private symbolicParser: SymbolicCommandParser;

  // ... existing code ...

  private initializeStrategies(): ParsingStrategy[] {
    return [
      this.createSymbolicCommandStrategy(), // NEW - Highest priority
      this.createSimpleCommandStrategy(),
      this.createJsonCommandStrategy()
    ];
  }

  /**
   * NEW: Symbolic command strategy (highest priority)
   */
  private createSymbolicCommandStrategy(): ParsingStrategy {
    return {
      name: 'symbolic',
      confidence: 0.95,
      canHandle: (command: string) => {
        // Detect any symbolic operators
        return /-->|=\s*["']|^@[A-Za-z0-9]+|\+|[\?]/.test(command);
      },
      parse: (command: string): SymbolicCommandParseResult | null => {
        try {
          // Detect operators
          const operators = this.symbolicParser.detectOperators(command);

          if (!operators.hasOperators) {
            return null; // Fallback to other strategies
          }

          // Extract base prompt ID (first prompt in chain/composition)
          let basePromptId: string;
          let baseArgs: string;

          // Remove framework prefix if present
          let cleanCommand = command.replace(/^@[A-Za-z0-9]+\s+/, '');

          // Remove gate suffix if present
          cleanCommand = cleanCommand.replace(/\s*=\s*["'].+["']\s*$/, '');

          // Extract first prompt
          const firstPromptMatch = cleanCommand.match(/^(?:>>)?([a-zA-Z0-9_-]+)(?:\s+([^-]*))?/);
          if (!firstPromptMatch) {
            return null;
          }

          basePromptId = firstPromptMatch[1];
          baseArgs = firstPromptMatch[2] || '';

          // Generate execution plan
          const executionPlan = this.symbolicParser.generateExecutionPlan(
            operators,
            basePromptId,
            baseArgs
          );

          return {
            promptId: basePromptId,
            rawArgs: baseArgs,
            format: 'symbolic',
            confidence: 0.95,
            operators: operators,
            executionPlan: executionPlan,
            metadata: {
              originalCommand: command,
              parseStrategy: 'symbolic',
              detectedFormat: `Symbolic (${operators.operatorTypes.join(', ')})`,
              warnings: []
            }
          };
        } catch (error) {
          this.logger.error('Symbolic parsing failed:', error);
          return null; // Fallback to other strategies
        }
      }
    };
  }
}
```

#### ConsolidatedPromptEngine Integration

```typescript
// Additions to server/src/mcp-tools/prompt-engine/core/engine.ts

import { ChainOperatorExecutor } from '../../../execution/operators/chain-executor.js';
import { GateOperatorExecutor } from '../../../execution/operators/gate-executor.js';
import { FrameworkOperatorExecutor } from '../../../execution/operators/framework-executor.js';

export class ConsolidatedPromptEngine {
  private chainOperatorExecutor: ChainOperatorExecutor;
  private gateOperatorExecutor: GateOperatorExecutor;
  private frameworkOperatorExecutor: FrameworkOperatorExecutor;

  // ... existing code ...

  async execute(command: string, options: any = {}): Promise<ToolResponse> {
    // Parse command (now includes symbolic operators)
    const parseResult = await this.parsingSystem.commandParser.parseCommand(
      command,
      this.promptsData
    );

    // Check if symbolic operators detected
    if (parseResult.format === 'symbolic' && parseResult.executionPlan) {
      return await this.executeSymbolicCommand(parseResult, options);
    }

    // ... existing execution logic ...
  }

  /**
   * NEW: Execute command with symbolic operators
   */
  private async executeSymbolicCommand(
    parseResult: SymbolicCommandParseResult,
    options: any
  ): Promise<ToolResponse> {
    const { executionPlan, operators } = parseResult;
    let result: any;

    try {
      // Step 1: Apply framework override if present
      const frameworkOp = operators?.operators.find(op => op.type === 'framework');
      if (frameworkOp && frameworkOp.type === 'framework') {
        return await this.frameworkOperatorExecutor.executeWithFramework(
          frameworkOp,
          async () => {
            // Execute chain or single prompt within framework context
            return await this.executeWithinFramework(parseResult, options);
          }
        );
      }

      // Step 2: Execute without framework override
      result = await this.executeWithinFramework(parseResult, options);

      return result;
    } catch (error) {
      this.logger.error('Symbolic command execution failed:', error);
      throw error;
    }
  }

  /**
   * Execute chain or single prompt (with or without framework context)
   */
  private async executeWithinFramework(
    parseResult: SymbolicCommandParseResult,
    options: any
  ): Promise<ToolResponse> {
    const { executionPlan, operators } = parseResult;
    let result: any;

    // Check for chain operator
    const chainOp = operators?.operators.find(op => op.type === 'chain');

    if (chainOp && chainOp.type === 'chain') {
      // Execute chain
      result = await this.chainOperatorExecutor.execute(
        chainOp,
        parseResult.rawArgs ? { content: parseResult.rawArgs } : {}
      );
    } else {
      // Execute single prompt (existing logic)
      result = await this.executeSinglePrompt(parseResult, options);
    }

    // Step 3: Apply gate validation if present
    const gateOp = operators?.operators.find(op => op.type === 'gate');
    if (gateOp && gateOp.type === 'gate') {
      const gateResult = await this.gateOperatorExecutor.execute(
        gateOp,
        result,
        `exec_${Date.now()}`
      );

      // Attach gate results to response
      result.gateValidation = gateResult;

      // Handle retry if needed
      if (gateResult.retryRequired) {
        this.logger.warn('Gate validation failed, retry required');
        // Could implement retry logic here
      }
    }

    return result;
  }
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1) - Chain Operator Only

**Goals**:
- ✅ Implement symbolic parser foundation
- ✅ Chain operator (`-->`) detection and parsing
- ✅ Integration with existing ChainExecutor
- ✅ Comprehensive tests

**Deliverables**:
- `symbolic-command-parser.ts`
- `chain-operator.ts`
- `chain-executor.ts` (operator executor)
- Test suite for chain operator
- Documentation: basic chaining examples

**Success Criteria**:
```bash
# Must work:
>>content_analysis {{content}} --> deep_analysis --> notes
>>web_search "AI trends" --> summarize --> translate language="spanish"
```

### Phase 2: Quality Gates (Week 2) - Gate Operator

**Goals**:
- ✅ Gate operator (`=`) detection and parsing
- ✅ Temporary gate definition generation
- ✅ LLM-based validation execution
- ✅ Retry logic implementation

**Deliverables**:
- `gate-operator.ts`
- `gate-executor.ts`
- Gate criteria parsing logic
- Test suite for gate operator
- Documentation: inline quality validation

**Success Criteria**:
```bash
# Must work:
>>code_review target="app.ts" = "no type errors, 80% coverage"
>>deep_research topic="AI" --> synthesis = "comprehensive, actionable"
```

### Phase 3: Framework & Advanced (Week 3)

**Goals**:
- ✅ Framework operator (`@`) implementation
- ✅ Temporary framework switching
- ✅ Parallel operator (`+`) foundation
- ✅ Complex composition support

**Deliverables**:
- `framework-operator.ts`
- `framework-executor.ts`
- `parallel-operator.ts` (basic version)
- Combined operator tests
- Documentation: advanced compositions

**Success Criteria**:
```bash
# Must work:
@CAGEERF >>strategic_planning project="feature_x"
@ReACT >>debug_issue error="memory_leak" --> fix_implementation
>>market_analysis + competitive_analysis + user_research
```

### Phase 4: Polish & Documentation (Week 4)

**Goals**:
- ✅ Comprehensive documentation
- ✅ Error message improvements
- ✅ Performance optimization
- ✅ Example library

**Deliverables**:
- `/docs/symbolic-command-language.md`
- `/docs/operator-reference.md`
- `/docs/chaining-examples.md`
- Performance benchmarks
- User migration guide

## Testing Strategy

### Unit Tests

```typescript
// tests/unit/symbolic-parser.test.ts

describe('SymbolicCommandParser', () => {
  describe('Chain Operator Detection', () => {
    it('should detect simple chain', () => {
      const parser = createSymbolicCommandParser(logger);
      const result = parser.detectOperators('>>step1 --> step2 --> step3');

      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('chain');
      expect(result.operators[0].type).toBe('chain');
      expect(result.operators[0].steps).toHaveLength(3);
    });

    it('should parse chain with arguments', () => {
      const parser = createSymbolicCommandParser(logger);
      const result = parser.detectOperators(
        '>>analyze content="{{text}}" --> summarize depth="detailed"'
      );

      const chainOp = result.operators[0];
      expect(chainOp.steps[0].promptId).toBe('analyze');
      expect(chainOp.steps[0].args).toBe('content="{{text}}"');
      expect(chainOp.steps[1].promptId).toBe('summarize');
      expect(chainOp.steps[1].args).toBe('depth="detailed"');
    });
  });

  describe('Gate Operator Detection', () => {
    it('should detect gate criteria', () => {
      const parser = createSymbolicCommandParser(logger);
      const result = parser.detectOperators(
        '>>code_review target="app.ts" = "no errors, 80% coverage"'
      );

      expect(result.operatorTypes).toContain('gate');
      const gateOp = result.operators.find(op => op.type === 'gate');
      expect(gateOp.parsedCriteria).toHaveLength(2);
      expect(gateOp.parsedCriteria[0]).toBe('no errors');
      expect(gateOp.parsedCriteria[1]).toBe('80% coverage');
    });
  });

  describe('Framework Operator Detection', () => {
    it('should detect framework selector', () => {
      const parser = createSymbolicCommandParser(logger);
      const result = parser.detectOperators('@CAGEERF >>strategic_planning');

      expect(result.operatorTypes).toContain('framework');
      const frameworkOp = result.operators.find(op => op.type === 'framework');
      expect(frameworkOp.frameworkId).toBe('CAGEERF');
      expect(frameworkOp.normalizedId).toBe('CAGEERF');
      expect(frameworkOp.temporary).toBe(true);
    });

    it('should handle case-insensitive framework names', () => {
      const parser = createSymbolicCommandParser(logger);
      const result = parser.detectOperators('@react >>analyze');

      const frameworkOp = result.operators.find(op => op.type === 'framework');
      expect(frameworkOp.normalizedId).toBe('REACT');
    });
  });

  describe('Complex Compositions', () => {
    it('should parse framework + chain + gate', () => {
      const parser = createSymbolicCommandParser(logger);
      const result = parser.detectOperators(
        '@CAGEERF >>analysis --> synthesis --> report = "comprehensive"'
      );

      expect(result.operatorTypes).toHaveLength(3);
      expect(result.operatorTypes).toContain('framework');
      expect(result.operatorTypes).toContain('chain');
      expect(result.operatorTypes).toContain('gate');
    });
  });
});
```

### Integration Tests

```typescript
// tests/integration/symbolic-execution.test.ts

describe('Symbolic Command Execution', () => {
  it('should execute simple chain', async () => {
    const engine = createConsolidatedPromptEngine(/* ... */);
    const result = await engine.execute(
      '>>content_analysis "test content" --> deep_analysis'
    );

    expect(result).toBeDefined();
    expect(result.metadata.executionType).toBe('chain');
    expect(result.metadata.stepsExecuted).toBe(2);
  });

  it('should apply inline gate validation', async () => {
    const engine = createConsolidatedPromptEngine(/* ... */);
    const result = await engine.execute(
      '>>code_review target="app.ts" = "no type errors"'
    );

    expect(result.gateValidation).toBeDefined();
    expect(result.gateValidation.passed).toBeDefined();
  });

  it('should execute with framework override', async () => {
    const engine = createConsolidatedPromptEngine(/* ... */);
    const result = await engine.execute(
      '@ReACT >>debug_issue error="memory leak"'
    );

    expect(result.metadata.frameworkUsed).toBe('ReACT');
  });
});
```

## Documentation Plan

### User Documentation

**File**: `/docs/symbolic-command-language.md`

**Contents**:
1. Introduction to symbolic operators
2. Quick start examples
3. Operator reference with examples
4. Complex composition patterns
5. Best practices
6. Troubleshooting

**File**: `/docs/operator-reference.md`

**Contents**:
- Detailed operator specifications
- Syntax diagrams
- Parameter options
- Execution behavior
- Error handling

**File**: `/docs/chaining-examples.md`

**Contents**:
- Research workflows
- Code review workflows
- Content processing pipelines
- Multi-stage analysis patterns
- Quality-gated executions

### Developer Documentation

**Updates to**: `/CLAUDE.md`

**New Section**: "Symbolic Command Language"
- Parser architecture
- Operator implementation guide
- Adding new operators
- Testing requirements

## Migration Path

### Backward Compatibility

✅ **100% Backward Compatible**
- All existing command syntax continues to work
- No breaking changes to API
- Symbolic operators are additive enhancement
- Fallback to existing parsers if symbolic parsing fails

### Template File Migration (Optional)

**Automatic detection**: Templates with simple patterns can suggest symbolic equivalents

Example migration suggestions:
```
Current template: /prompts/analysis/research_chain.md
Symbolic equivalent: >>web_search --> deep_analysis --> synthesis_report

Consider using symbolic syntax for simpler workflows!
```

## Performance Considerations

### Parser Performance

**Operator Detection**: O(n) single pass through command string
- Regex matching for each operator type
- No backtracking
- Early termination on match

**Expected Overhead**: < 5ms for typical commands

### Execution Performance

**Chain Operator**: Same as existing ChainExecutor (no overhead)
**Gate Operator**: +100-500ms for LLM validation (one-time per gate)
**Framework Operator**: < 50ms for framework switching

### Optimization Strategies

1. **Operator Detection Caching**: Cache operator patterns per session
2. **Lazy Evaluation**: Only parse operators when needed
3. **Parallel Gate Evaluation**: Evaluate multiple gates concurrently
4. **Framework Switch Batching**: Batch multiple framework switches

## Security Considerations

### Input Validation

**Operator Injection Prevention**:
- Sanitize all operator inputs
- Validate framework names against whitelist
- Escape special characters in criteria strings
- Limit chain depth (max 10 steps)

**Gate Criteria Validation**:
- Prevent code injection in criteria
- Limit criteria length (max 500 chars)
- Sanitize LLM evaluation prompts

### Execution Limits

**Resource Limits**:
- Max chain depth: 10 steps
- Max parallel prompts: 5 concurrent
- Max gate retries: 3 attempts
- Execution timeout: 5 minutes

## Open Questions & Decisions

### Question 1: Escaping Special Characters

**Problem**: How to use literal `-->`, `=`, `@`, `+`, `?` in arguments?

**Options**:
- A) Quote entire argument: `content="text with --> arrow"`
- B) Escape characters: `content=text with \-\-> arrow`
- C) Raw string syntax: `content=r"text with --> arrow"`

**Decision**: **Option A** (quoting) - Most intuitive, aligns with shell conventions

### Question 2: Nested Chains

**Problem**: Should we support nested/grouped chains?

**Example**: `(>>a --> b) + (>>c --> d)`

**Options**:
- A) Phase 5 enhancement (not MVP)
- B) Implement with parentheses from start
- C) Never support (keep simple)

**Decision**: **Option A** - Defer to Phase 5, gather user feedback first

### Question 3: Gate Failure Handling

**Problem**: What happens when gate validation fails?

**Options**:
- A) Automatic retry (configurable max attempts)
- B) Return error, let user decide
- C) Prompt user for retry decision

**Decision**: **Option A** - Auto-retry once by default, configurable via gate operator parameters

### Question 4: Framework Persistence

**Problem**: Should `@FRAMEWORK` persist beyond single execution?

**Options**:
- A) Always temporary (revert after execution)
- B) Option to make persistent: `@@FRAMEWORK` (sticky)
- C) User setting controls default behavior

**Decision**: **Option A** - Keep simple, use `system_control` for persistent switching

### Question 5: Operator Aliases

**Problem**: Should we support Unicode operators as aliases?

**Examples**:
- `→` for `-->`
- `⚡` for `@`
- `✓` for `=`

**Options**:
- A) Support with deprecation warning
- B) Never support (ASCII only)
- C) Full support, no warnings

**Decision**: **Option B** - ASCII only for maximum compatibility

### Question 6: Parallel Aggregation Strategies

**Problem**: How to combine results from parallel execution?

**Options**:
- A) Simple concatenation (default)
- B) Explicit aggregator: `>>a + b + c | merge_strategy`
- C) LLM-based synthesis

**Decision**: **Option A** for MVP, **Option C** for Phase 4 enhancement

## Success Metrics

### Adoption Metrics

**Target Goals**:
- 30% of users try symbolic operators within 1 month
- 50% reduction in template file creation
- 80% satisfaction rating for symbolic syntax

**Tracking**:
- Operator usage statistics
- Template file creation trends
- User feedback surveys

### Performance Metrics

**Target Goals**:
- < 5ms parsing overhead
- < 50ms framework switching overhead
- 95% operator detection accuracy

**Monitoring**:
- Parser performance metrics
- Execution time tracking
- Error rate monitoring

### Quality Metrics

**Target Goals**:
- 0 breaking changes to existing functionality
- 90%+ test coverage for new code
- < 1% regression rate

**Validation**:
- Comprehensive test suite
- Backward compatibility tests
- Performance benchmarks

## Risk Assessment

### High Risk: Parser Complexity

**Risk**: Symbolic parser becomes too complex, hard to maintain

**Mitigation**:
- Modular operator design (one operator = one file)
- Comprehensive test coverage
- Progressive enhancement (one operator at a time)
- Clear documentation

### Medium Risk: User Confusion

**Risk**: Users confused by multiple command syntaxes

**Mitigation**:
- Clear documentation with examples
- Error messages suggest correct syntax
- Migration guide for template users
- Interactive tutorial

### Low Risk: Performance Degradation

**Risk**: Operator detection slows down parsing

**Mitigation**:
- Performance benchmarks
- Optimization strategies
- Caching mechanisms
- Lazy evaluation

## Next Steps

### Immediate Actions (This Week)

1. ✅ Review and approve plan
2. ⏳ Create feature branch: `feature/symbolic-command-language`
3. ⏳ Set up test infrastructure
4. ⏳ Begin Phase 1 implementation (chain operator)

### Phase 1 Kickoff (Week 1)

**Day 1-2**: Foundation
- Create symbolic parser file structure
- Implement operator detection framework
- Write basic type definitions

**Day 3-4**: Chain Operator
- Implement chain operator parsing
- Create chain executor
- Write unit tests

**Day 5**: Integration
- Integrate with UnifiedCommandParser
- Add to ConsolidatedPromptEngine
- Write integration tests

### Success Checkpoint

**Phase 1 Complete When**:
✅ Chain operator fully functional
✅ 90%+ test coverage
✅ Integration tests passing
✅ Documentation complete
✅ User feedback collected

---

## Appendix: Example Use Cases

### Research Workflow

```bash
# Literature review to publication pipeline
@CAGEERF >>literature_search topic="quantum computing" --> gap_analysis --> research_proposal = "novel contribution, feasible methodology"
```

### Code Review Pipeline

```bash
# Multi-stage code review with quality gates
>>static_analysis file="app.ts" --> security_review --> performance_review = "no vulnerabilities, optimized algorithms" --> approval
```

### Content Creation Workflow

```bash
# Multi-perspective content generation
>>outline_generator topic="AI ethics" + competitor_analysis + seo_research --> content_creation = "comprehensive, SEO-optimized, original"
```

### Debugging Workflow

```bash
# Systematic debugging with ReACT methodology
@ReACT >>error_analysis logs="{{logs}}" --> root_cause_identification --> fix_proposal ? "fix validated" : comprehensive_test_suite
```

### Market Analysis

```bash
# Parallel market research synthesis
>>market_trends + competitor_landscape + customer_feedback --> synthesis_report = "data-driven recommendations, risk assessment"
```

---

**End of Implementation Plan**

This plan will be updated as implementation progresses and new insights emerge.
