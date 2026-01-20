// @lifecycle canonical - Type definitions for execution operators.
import type { CommandParseResultBase } from './command-parse-types.js';
import type { ShellVerifyGate } from '../../../gates/shell/types.js';
import type { ExecutionModifiers } from '../../types.js';

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
  variableName: string;
}

/**
 * Quality gate operator for inline validation
 *
 * When gateId is present, creates a named inline gate.
 * When absent, behavior depends on criteria:
 * - Quoted string: anonymous temp gate with criteria
 * - Unquoted identifier: canonical gate lookup (fallback to criteria if not found)
 *
 * Shell verification gates use the `:: verify:"command"` syntax to execute
 * shell commands for ground-truth validation (Ralph Wiggum loops).
 */
export interface GateOperator {
  type: 'gate';
  /** Optional explicit gate ID for named inline gates (e.g., `:: my-check:"criteria"`) */
  gateId?: string;
  /** The criteria text or canonical gate reference */
  criteria: string;
  /** Parsed criteria as array (split on commas) */
  parsedCriteria: string[];
  scope: 'execution' | 'step' | 'chain';
  retryOnFailure: boolean;
  maxRetries: number;
  /**
   * Shell verification configuration for ground-truth validation.
   * Present when using `:: verify:"command"` syntax.
   * Exit code 0 = PASS, non-zero = FAIL.
   *
   * Options for Ralph Wiggum-style autonomous loops:
   * - loop:true - Enable Stop hook integration
   * - max:N - Maximum iterations
   * - :fast/:full/:extended - Presets for common configurations
   *
   * Checkpoint/rollback available via resource_manager tool.
   */
  shellVerify?: ShellVerifyGate;
}

/**
 * Framework selector operator
 */
export interface FrameworkOperator {
  type: 'framework';
  frameworkId: string;
  normalizedId: string;
  temporary: boolean;
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
 * Style selector operator (e.g., #style(analytical))
 */
export interface StyleOperator {
  type: 'style';
  styleId: string;
  normalizedId: string;
  scope: 'execution' | 'chain';
}

/**
 * Conditional execution operator
 */
export interface ConditionalOperator {
  type: 'conditional';
  condition: string;
  conditionType: 'presence' | 'comparison' | 'pattern';
  trueBranch: string;
  falseBranch?: string;
}

/**
 * Repetition operator - chain shorthand for executing a prompt N times.
 *
 * `>>prompt * 3` unfolds to `>>prompt --> >>prompt --> >>prompt`
 *
 * Combines naturally with other operators:
 * - `@CAGEERF >>analyze * 3` - Framework applies to each iteration
 * - `>>step1 * 2 --> >>step2` - Repeat step1, then chain to step2
 * - `>>prompt * 5 :: 'validate'` - Gate validates final result
 */
export interface RepetitionOperator {
  type: 'repetition';
  /** Number of times to execute (unfolds to chain steps) */
  count: number;
}

export type SymbolicOperator =
  | ChainOperator
  | GateOperator
  | FrameworkOperator
  | ParallelOperator
  | ConditionalOperator
  | StyleOperator
  | RepetitionOperator;

export interface OperatorDetectionResult {
  hasOperators: boolean;
  operatorTypes: string[];
  operators: SymbolicOperator[];
  parseComplexity: 'simple' | 'moderate' | 'complex';
}

export interface SymbolicCommandParseResult extends CommandParseResultBase<
  OperatorDetectionResult,
  SymbolicExecutionPlan
> {
  format: 'symbolic';
  operators: OperatorDetectionResult;
  executionPlan: SymbolicExecutionPlan;
}

export interface SymbolicExecutionPlan {
  steps: ExecutionStep[];
  argumentInputs?: Array<string | undefined>;
  frameworkOverride?: string;
  finalValidation?: GateOperator;
  styleSelection?: string;
  estimatedComplexity: number;
  requiresSessionState: boolean;
  modifiers?: ExecutionModifiers;
}

export interface ExecutionStep {
  stepNumber: number;
  type: 'prompt' | 'gate' | 'framework_switch' | 'parallel_group';
  promptId?: string;
  args?: string;
  inlineGateCriteria?: string[];
  inlineGateIds?: string[];
  dependencies: number[];
  outputVariable: string;
}
