/**
 * Core Gate Validator
 *
 * Provides the validation infrastructure for gate-based quality control.
 *
 * DESIGN DECISION: String-based validation removed
 * ------------------------------------------------
 * Naive checks like length validation, substring matching, and regex patterns
 * have been intentionally removed. These don't provide meaningful signal for
 * LLM-generated content - an output can pass all string checks while being
 * semantically incorrect, or fail them while being excellent.
 *
 * The only validation that can meaningfully assess LLM output is LLM-based
 * evaluation (llm_self_check). The infrastructure remains in place for when
 * LLM integration is implemented.
 *
 * What's preserved:
 * - Validation framework and gate loading
 * - Statistics tracking and retry logic
 * - LLM self-check stub (TODO for implementation)
 * - Retry hints generation
 */
import { Logger } from '../../logging/index.js';
import type { GateDefinitionProvider } from './gate-loader.js';
import type { ValidationResult } from '../../execution/types.js';
import type { LLMIntegrationConfig } from '../../types.js';
import type { ValidationContext } from '../types.js';
/**
 * Gate validation statistics
 */
export interface GateValidationStatistics {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    averageValidationTime: number;
    retryRequests: number;
}
/**
 * Core gate validator with pass/fail logic
 */
export declare class GateValidator {
    private logger;
    private gateLoader;
    private llmConfig;
    private validationStats;
    private validationTimes;
    constructor(logger: Logger, gateLoader: GateDefinitionProvider, llmConfig?: LLMIntegrationConfig);
    /**
     * Validate content against a gate
     */
    validateGate(gateId: string, context: ValidationContext): Promise<ValidationResult | null>;
    /**
     * Validate content against multiple gates
     */
    validateGates(gateIds: string[], context: ValidationContext): Promise<ValidationResult[]>;
    /**
     * Run a single validation check
     *
     * NOTE: String-based checks (content_check, pattern_check, methodology_compliance)
     * have been intentionally removed. These naive checks (length validation, substring
     * matching, regex patterns) don't provide meaningful signal for LLM-generated content.
     *
     * The only valuable validation for LLM output is LLM-based evaluation, which requires
     * a separate LLM call. This is the focus of future implementation.
     */
    private runValidationCheck;
    /**
     * Run LLM self-check validation
     *
     * TODO: IMPLEMENT LLM API INTEGRATION
     *
     * This is the ONLY validation type that can meaningfully assess LLM-generated content.
     * String-based checks (length, patterns, keywords) have been intentionally removed
     * because they don't correlate with output quality.
     *
     * Implementation requirements:
     * - LLM client instance (from semantic analyzer or external API)
     * - Validation prompt templates (quality rubrics, evaluation criteria)
     * - Structured output parsing (pass/fail with confidence scores)
     * - Confidence threshold enforcement
     *
     * Configuration path: config.analysis.semanticAnalysis.llmIntegration
     *
     * Example implementation approach:
     * 1. Format validation prompt with content and criteria
     * 2. Call LLM with structured output schema (JSON mode)
     * 3. Parse response: { passed: boolean, score: number, feedback: string }
     * 4. Apply confidence threshold from criteria.pass_threshold
     *
     * Current behavior: Gracefully skips when LLM not configured
     */
    private runLLMSelfCheck;
    /**
     * Generate retry hints based on failed checks
     *
     * With string-based validation removed, hints now focus on:
     * 1. Gate-specific guidance (from gate definition)
     * 2. LLM self-check feedback (when implemented)
     * 3. Generic quality improvement suggestions
     */
    private generateRetryHints;
    /**
     * Check if content should be retried based on validation results
     *
     * @param validationResults - Results from gate validation
     * @param currentAttempt - Current attempt number
     * @param maxAttempts - Maximum allowed attempts
     * @returns true if retry should be attempted
     */
    shouldRetry(validationResults: ValidationResult[], currentAttempt: number, maxAttempts?: number): boolean;
    /**
     * Update average validation time
     */
    private updateAverageValidationTime;
    /**
     * Get validation statistics
     */
    getStatistics(): GateValidationStatistics;
    /**
     * Reset validation statistics
     */
    resetStatistics(): void;
}
/**
 * Create a gate validator instance
 */
export declare function createGateValidator(logger: Logger, gateLoader: GateDefinitionProvider, llmConfig?: LLMIntegrationConfig): GateValidator;
