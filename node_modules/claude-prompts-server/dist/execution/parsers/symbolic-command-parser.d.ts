import { type ExecutionPlan, type OperatorDetectionResult, type SymbolicCommandParseResult } from './types/operator-types.js';
import { Logger } from '../../logging/index.js';
/**
 * Parser responsible for detecting and structuring symbolic command operators.
 *
 * The parser keeps regex-based detection isolated from the unified parser so that
 * the higher-level parsing flow only needs to reason about parsed operator metadata.
 */
export declare class SymbolicCommandParser {
    private readonly logger;
    private readonly OPERATOR_PATTERNS;
    constructor(logger: Logger);
    detectOperators(command: string): OperatorDetectionResult;
    private parseChainOperator;
    /**
     * Clean operators from a chain step string before validation.
     * Strips %modifiers and @framework operators that may appear on individual steps.
     * This allows syntax like: %judge/%guided @CAGEERF >>step1 --> %lean @ReACT >>step2
     * Note: Operators apply at execution-level, not per-step. This method only
     * removes them for parsing validation purposes.
     */
    private cleanStepOperators;
    /**
     * Split chain steps by --> delimiter while respecting quoted string boundaries
     * Handles: >>prompt1 input="test --> quoted" --> prompt2
     */
    private splitChainSteps;
    private parseParallelOperator;
    private parseCriteria;
    /**
     * Remove style operators from a command segment to avoid polluting prompt args.
     */
    stripStyleOperators(input: string): string;
    private calculateComplexity;
    generateExecutionPlan(detection: OperatorDetectionResult, basePromptId: string, baseArgs: string): ExecutionPlan;
    buildParseResult(command: string, operators: OperatorDetectionResult, basePromptId: string, baseArgs: string): SymbolicCommandParseResult;
}
export declare function createSymbolicCommandParser(logger: Logger): SymbolicCommandParser;
