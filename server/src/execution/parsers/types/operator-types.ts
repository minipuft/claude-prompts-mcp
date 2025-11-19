// @lifecycle canonical - Type definitions for execution operators.
import type { CommandParseResultBase } from "./command-parse-types.js";

/**
 * Chain operator representing sequential execution
 */
export interface ChainOperator {
  type: "chain";
  steps: ChainStep[];
  contextPropagation: "automatic" | "manual";
}

export interface ChainStep {
  promptId: string;
  args: string;
  position: number;
  variableName: string;
}

/**
 * Quality gate operator for inline validation
 */
export interface GateOperator {
  type: "gate";
  criteria: string;
  parsedCriteria: string[];
  scope: "execution" | "step" | "chain";
  retryOnFailure: boolean;
  maxRetries: number;
}

/**
 * Framework selector operator
 */
export interface FrameworkOperator {
  type: "framework";
  frameworkId: string;
  normalizedId: string;
  temporary: boolean;
  scopeType: "execution" | "chain";
}

/**
 * Parallel execution operator
 */
export interface ParallelOperator {
  type: "parallel";
  prompts: ParallelPrompt[];
  aggregationStrategy: "merge" | "compare" | "summarize";
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
  type: "conditional";
  condition: string;
  conditionType: "presence" | "comparison" | "pattern";
  trueBranch: string;
  falseBranch?: string;
}

export type SymbolicOperator =
  | ChainOperator
  | GateOperator
  | FrameworkOperator
  | ParallelOperator
  | ConditionalOperator;

export interface OperatorDetectionResult {
  hasOperators: boolean;
  operatorTypes: string[];
  operators: SymbolicOperator[];
  parseComplexity: "simple" | "moderate" | "complex";
}

export interface SymbolicCommandParseResult
  extends CommandParseResultBase<OperatorDetectionResult, ExecutionPlan> {
  format: "symbolic";
  operators: OperatorDetectionResult;
  executionPlan: ExecutionPlan;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  argumentInputs?: Array<string | undefined>;
  frameworkOverride?: string;
  finalValidation?: GateOperator;
  estimatedComplexity: number;
  requiresSessionState: boolean;
}

export interface ExecutionStep {
  stepNumber: number;
  type: "prompt" | "gate" | "framework_switch" | "parallel_group";
  promptId?: string;
  args?: string;
  inlineGateCriteria?: string[];
  inlineGateIds?: string[];
  dependencies: number[];
  outputVariable: string;
}
