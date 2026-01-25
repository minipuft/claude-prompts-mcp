// @lifecycle canonical - Validates gate definitions before execution.
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
import { getShellPreset } from '../config/index.js';
import { getDefaultShellVerifyExecutor } from '../shell/shell-verify-executor.js';

import type { GateDefinitionProvider } from './gate-loader.js';
import type { ValidationResult } from '../../execution/types.js';
import type { LLMIntegrationConfig } from '../../types.js';
import type { ShellVerifyGate } from '../shell/types.js';
import type {
  LightweightGateDefinition,
  ValidationCheck,
  ValidationContext,
  GatePassCriteria,
} from '../types.js';

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
export class GateValidator {
  private logger: Logger;
  private gateLoader: GateDefinitionProvider;
  private llmConfig: LLMIntegrationConfig | undefined;
  private validationStats: GateValidationStatistics = {
    totalValidations: 0,
    successfulValidations: 0,
    failedValidations: 0,
    averageValidationTime: 0,
    retryRequests: 0,
  };
  private validationTimes: number[] = [];

  constructor(
    logger: Logger,
    gateLoader: GateDefinitionProvider,
    llmConfig?: LLMIntegrationConfig
  ) {
    this.logger = logger;
    this.gateLoader = gateLoader;
    this.llmConfig = llmConfig;
  }

  /**
   * Validate content against a gate
   */
  async validateGate(gateId: string, context: ValidationContext): Promise<ValidationResult | null> {
    const startTime = Date.now();

    try {
      const gate = await this.gateLoader.loadGate(gateId);
      if (gate === null) {
        this.logger.warn(`Gate not found for validation: ${gateId}`);
        return null;
      }

      if (gate.type !== 'validation') {
        this.logger.debug(`Gate ${gateId} is guidance-only, skipping validation`);
        return {
          valid: true,
          passed: true,
          gateId,
          checks: [],
          retryHints: [],
          metadata: {
            validationTime: Date.now() - startTime,
            checksPerformed: 0,
            llmValidationUsed: false,
          },
        };
      }

      this.logger.debug(`Validating content against gate: ${gateId}`);

      // Run validation checks
      const checks: ValidationCheck[] = [];
      let llmValidationUsed = false;

      if (gate.pass_criteria) {
        for (const criteria of gate.pass_criteria) {
          const check = await this.runValidationCheck(criteria, context);
          checks.push(check);

          if (criteria.type === 'llm_self_check') {
            llmValidationUsed = true;
          }
        }
      }

      // Determine overall pass/fail
      const passed = checks.length === 0 || checks.every((check) => check.passed);

      // Generate retry hints for failures
      const retryHints = passed ? [] : this.generateRetryHints(gate, checks);

      const result: ValidationResult = {
        valid: passed,
        passed,
        gateId,
        checks,
        retryHints,
        metadata: {
          validationTime: Date.now() - startTime,
          checksPerformed: checks.length,
          llmValidationUsed,
        },
      };

      this.logger.debug(
        `Gate validation complete: ${gateId} - ${passed ? 'PASSED' : 'FAILED'} (${checks.length} checks)`
      );

      return result;
    } catch (error) {
      this.logger.error(`Gate validation failed for ${gateId}:`, error);
      return {
        valid: false,
        passed: false,
        gateId,
        checks: [
          {
            type: 'system_error',
            passed: false,
            message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        retryHints: [`Gate validation encountered an error. Please try again.`],
        metadata: {
          validationTime: Date.now() - startTime,
          checksPerformed: 0,
          llmValidationUsed: false,
        },
      };
    }
  }

  /**
   * Validate content against multiple gates
   */
  async validateGates(gateIds: string[], context: ValidationContext): Promise<ValidationResult[]> {
    const startTime = Date.now();
    const results: ValidationResult[] = [];

    for (const gateId of gateIds) {
      const result = await this.validateGate(gateId, context);
      if (result) {
        results.push(result);

        // Update statistics based on result
        if (result.passed) {
          this.validationStats.successfulValidations++;
        } else {
          this.validationStats.failedValidations++;
        }
      }
    }

    // Update overall statistics
    const executionTime = Date.now() - startTime;
    this.validationTimes.push(executionTime);
    this.validationStats.totalValidations++;
    this.updateAverageValidationTime();

    return results;
  }

  /**
   * Run a single validation check
   *
   * NOTE: String-based checks (content_check, pattern_check, methodology_compliance)
   * have been intentionally removed. These naive checks (length validation, substring
   * matching, regex patterns) don't provide meaningful signal for LLM-generated content.
   *
   * The only valuable validations for LLM output are:
   * - LLM-based evaluation (llm_self_check) - semantic understanding
   * - Shell verification (shell_verify) - ground truth via exit codes
   */
  private async runValidationCheck(
    criteria: GatePassCriteria,
    _context: ValidationContext
  ): Promise<ValidationCheck> {
    try {
      // Shell verification provides ground-truth validation via exit codes
      if (criteria.type === 'shell_verify') {
        return await this.runShellVerify(criteria);
      }

      // LLM self-check provides semantic validation for LLM content
      if (criteria.type === 'llm_self_check') {
        return await this.runLLMSelfCheck(criteria);
      }

      // Other check types auto-pass with explanation
      // These were removed because string-based checks don't validate LLM output quality
      this.logger.debug(
        `[GATE VALIDATOR] Check type '${criteria.type}' auto-passed (string-based validation removed)`
      );

      return {
        type: criteria.type,
        passed: true,
        score: 1.0,
        message: `Check type '${criteria.type}' skipped - string-based validation removed (use llm_self_check or shell_verify for meaningful validation)`,
        details: {
          skipped: true,
          reason:
            'String-based checks removed as they do not provide meaningful signal for LLM content',
          recommendation:
            'Use llm_self_check for semantic validation or shell_verify for ground truth',
        },
      };
    } catch (error) {
      this.logger.error(`Validation check failed for ${criteria.type}:`, error);
      return {
        type: criteria.type,
        passed: false,
        message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Run shell verification - ground-truth validation via exit codes.
   *
   * Unlike LLM self-evaluation, shell verification provides deterministic
   * pass/fail results based on actual command execution (test suites, linters, etc.)
   *
   * @param criteria - Shell verification criteria from gate definition
   * @returns Validation check result with exit code details
   */
  private async runShellVerify(criteria: GatePassCriteria): Promise<ValidationCheck> {
    const command = criteria.shell_command;

    if (command == null || command.trim() === '') {
      this.logger.warn('[SHELL GATE] Shell verification skipped - no command specified');
      return {
        type: 'shell_verify',
        passed: true, // Auto-pass when misconfigured (non-blocking)
        score: 1.0,
        message: 'Shell verification skipped (no shell_command specified in gate definition)',
        details: {
          skipped: true,
          reason: 'No shell_command provided in pass_criteria',
          recommendation: 'Add shell_command field to the shell_verify criteria',
        },
      };
    }

    // Resolve preset values if specified (loaded from YAML config)
    const presetValues =
      criteria.shell_preset != null ? getShellPreset(criteria.shell_preset) : undefined;

    // Build shell verification gate config
    const gateConfig: ShellVerifyGate = {
      command,
      timeout: criteria.shell_timeout ?? presetValues?.timeout,
      workingDir: criteria.shell_working_dir,
      env: criteria.shell_env,
      maxIterations: criteria.shell_max_attempts ?? presetValues?.maxIterations,
      preset: criteria.shell_preset,
    };

    this.logger.debug(`[SHELL GATE] Executing shell verification: ${command}`);

    try {
      const executor = getDefaultShellVerifyExecutor();
      const result = await executor.execute(gateConfig);

      if (result.passed) {
        this.logger.debug(`[SHELL GATE] Verification passed (exit code ${result.exitCode})`);
        return {
          type: 'shell_verify',
          passed: true,
          score: 1.0,
          message: `Shell verification passed: '${command}' exited with code ${result.exitCode}`,
          details: {
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout:
              result.stdout.slice(0, 500) !== '' ? result.stdout.slice(0, 500) : '(no output)',
          },
        };
      } else {
        this.logger.debug(`[SHELL GATE] Verification failed (exit code ${result.exitCode})`);
        return {
          type: 'shell_verify',
          passed: false,
          score: 0,
          message: `Shell verification failed: '${command}' exited with code ${result.exitCode}`,
          details: {
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stderr:
              result.stderr.slice(0, 1000) !== ''
                ? result.stderr.slice(0, 1000)
                : result.stdout.slice(0, 1000) !== ''
                  ? result.stdout.slice(0, 1000)
                  : '(no output)',
            timedOut: result.timedOut,
          },
        };
      }
    } catch (error) {
      this.logger.error(`[SHELL GATE] Shell verification error:`, error);
      return {
        type: 'shell_verify',
        passed: false,
        score: 0,
        message: `Shell verification error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

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
  private async runLLMSelfCheck(criteria: GatePassCriteria): Promise<ValidationCheck> {
    // Check if LLM integration is configured and enabled
    const llmConfig = this.llmConfig;
    if (llmConfig?.enabled !== true) {
      this.logger.debug('[LLM GATE] LLM self-check skipped - LLM integration disabled in config');
      return {
        type: 'llm_self_check',
        passed: true, // Auto-pass when not configured
        score: 1.0,
        message:
          'LLM validation skipped (not configured - set analysis.semanticAnalysis.llmIntegration.enabled=true)',
        details: {
          skipped: true,
          reason: 'LLM integration disabled in config',
          configPath: 'config.analysis.semanticAnalysis.llmIntegration.enabled',
        },
      };
    }

    if (llmConfig.endpoint === undefined || llmConfig.endpoint === '') {
      this.logger.warn('[LLM GATE] LLM self-check skipped - no endpoint configured');
      return {
        type: 'llm_self_check',
        passed: true,
        score: 1.0,
        message: 'LLM validation skipped (no endpoint configured)',
        details: {
          skipped: true,
          reason: 'No LLM endpoint configured',
          configPath: 'config.analysis.semanticAnalysis.llmIntegration.endpoint',
        },
      };
    }

    // TODO: Once LLM API client is available, implement actual validation here
    this.logger.warn('[LLM GATE] LLM self-check requested but API client not yet implemented');
    this.logger.debug(`[LLM GATE] Would validate with template: ${criteria.prompt_template}`);

    return {
      type: 'llm_self_check',
      passed: true, // Auto-pass until implementation complete
      score: 1.0,
      message: 'LLM validation not yet implemented (API client integration pending)',
      details: {
        skipped: true,
        reason: 'LLM API client not yet implemented',
        configEnabled: llmConfig.enabled,
        endpoint: llmConfig.endpoint,
        templateRequested: criteria.prompt_template || 'default',
        implementation: 'TODO: Wire LLM client from semantic analyzer',
      },
    };
  }

  /**
   * Generate retry hints based on failed checks
   *
   * With string-based validation removed, hints now focus on:
   * 1. Gate-specific guidance (from gate definition)
   * 2. LLM self-check feedback (when implemented)
   * 3. Generic quality improvement suggestions
   */
  private generateRetryHints(gate: LightweightGateDefinition, checks: ValidationCheck[]): string[] {
    const hints: string[] = [];
    const failedChecks = checks.filter((check) => !check.passed);

    if (failedChecks.length === 0) {
      return hints;
    }

    // Add gate-specific guidance as a hint
    // Skip for inline gates - criteria already displayed prominently in "Inline Quality Criteria" section
    const isInlineGate = gate.name?.includes('Inline Quality') || gate.id?.startsWith('temp_');
    if (gate.guidance && !isInlineGate) {
      hints.push(`Remember the ${gate.name} guidelines:\n${gate.guidance}`);
    }

    // Add LLM self-check specific hints (the only meaningful validation)
    for (const check of failedChecks) {
      if (check.type === 'llm_self_check') {
        hints.push('Review the quality criteria and improve content structure and depth');
        // When LLM validation is implemented, this would include specific feedback
        if (check.details?.['feedback'] !== undefined) {
          hints.push(check.details['feedback'] as string);
        }
      }
    }

    // Ensure we have at least one helpful hint
    if (hints.length === 0) {
      hints.push(`${gate.name} validation failed. Please review the requirements and try again.`);
    }

    return hints;
  }

  /**
   * Check if content should be retried based on validation results
   *
   * @param validationResults - Results from gate validation
   * @param currentAttempt - Current attempt number
   * @param maxAttempts - Maximum allowed attempts
   * @returns true if retry should be attempted
   */
  shouldRetry(
    validationResults: ValidationResult[],
    currentAttempt: number,
    maxAttempts: number = 3
  ): boolean {
    if (currentAttempt >= maxAttempts) {
      this.logger.debug('[GATE VALIDATOR] Max attempts reached, no retry');
      return false;
    }

    // Retry if any validation gate failed
    const shouldRetry = validationResults.some((result) => !result.valid);

    if (shouldRetry) {
      this.validationStats.retryRequests++;
      this.logger.debug('[GATE VALIDATOR] Retry recommended:', {
        currentAttempt,
        maxAttempts,
        failedGates: validationResults.filter((r) => !r.valid).map((r) => r.gateId),
      });
    }

    return shouldRetry;
  }

  /**
   * Update average validation time
   */
  private updateAverageValidationTime(): void {
    if (this.validationTimes.length > 0) {
      const sum = this.validationTimes.reduce((a, b) => a + b, 0);
      this.validationStats.averageValidationTime = sum / this.validationTimes.length;
    }

    // Keep only last 100 measurements for rolling average
    if (this.validationTimes.length > 100) {
      this.validationTimes = this.validationTimes.slice(-100);
    }
  }

  /**
   * Get validation statistics
   */
  getStatistics(): GateValidationStatistics {
    return { ...this.validationStats };
  }

  /**
   * Reset validation statistics
   */
  resetStatistics(): void {
    this.validationStats = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      averageValidationTime: 0,
      retryRequests: 0,
    };
    this.validationTimes = [];
    this.logger.debug('[GATE VALIDATOR] Statistics reset');
  }
}

/**
 * Create a gate validator instance
 */
export function createGateValidator(
  logger: Logger,
  gateLoader: GateDefinitionProvider,
  llmConfig?: LLMIntegrationConfig
): GateValidator {
  return new GateValidator(logger, gateLoader, llmConfig);
}
