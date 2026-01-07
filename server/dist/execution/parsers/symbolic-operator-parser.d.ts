import { type OperatorDetectionResult, type SymbolicCommandParseResult, type SymbolicExecutionPlan } from './types/operator-types.js';
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
     * This allows syntax like: %judge @CAGEERF >>step1 --> %lean @ReACT >>step2
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
     * Parse verify-specific options from command string.
     *
     * Supports:
     * - loop:true/false - Enable Stop hook integration for autonomous loops
     * - max:N - Maximum iterations (default 10)
     * - timeout:N - Timeout in seconds (converted to ms internally)
     * - checkpoint:true/false - Git stash before execution
     * - rollback:true/false - Git restore on failure
     *
     * @example :: verify:"npm test" loop:true max:15 checkpoint:true
     */
    private parseVerifyOptions;
    private calculateComplexity;
    generateExecutionPlan(detection: OperatorDetectionResult, basePromptId: string, baseArgs: string): SymbolicExecutionPlan;
    buildParseResult(command: string, operators: OperatorDetectionResult, basePromptId: string, baseArgs: string): SymbolicCommandParseResult;
}
export declare function createSymbolicCommandParser(logger: Logger): SymbolicCommandParser;
