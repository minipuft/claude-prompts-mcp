import type { CommandParseResultBase } from './command-parse-types.js';
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
export type SymbolicOperator = ChainOperator | GateOperator | FrameworkOperator | ParallelOperator | ConditionalOperator | StyleOperator;
export interface OperatorDetectionResult {
    hasOperators: boolean;
    operatorTypes: string[];
    operators: SymbolicOperator[];
    parseComplexity: 'simple' | 'moderate' | 'complex';
}
export interface SymbolicCommandParseResult extends CommandParseResultBase<OperatorDetectionResult, SymbolicExecutionPlan> {
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
