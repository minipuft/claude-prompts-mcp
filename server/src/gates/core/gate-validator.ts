/**
 * Core Gate Validator
 * Provides validation capabilities with practical checks for prompt execution
 */

import { Logger } from '../../logging/index.js';
import type { GateLoader } from './gate-loader.js';
import type {
  LightweightGateDefinition,
  ValidationCheck,
  ValidationContext,
  GatePassCriteria
} from '../types.js';
import type { ValidationResult } from '../../execution/types.js';
import type { LLMIntegrationConfig } from '../../types.js';

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
  private gateLoader: GateLoader;
  private llmConfig?: LLMIntegrationConfig;
  private validationStats: GateValidationStatistics = {
    totalValidations: 0,
    successfulValidations: 0,
    failedValidations: 0,
    averageValidationTime: 0,
    retryRequests: 0
  };
  private validationTimes: number[] = [];

  constructor(logger: Logger, gateLoader: GateLoader, llmConfig?: LLMIntegrationConfig) {
    this.logger = logger;
    this.gateLoader = gateLoader;
    this.llmConfig = llmConfig;
  }

  /**
   * Validate content against a gate
   */
  async validateGate(
    gateId: string,
    context: ValidationContext
  ): Promise<ValidationResult | null> {
    const startTime = Date.now();

    try {
      const gate = await this.gateLoader.loadGate(gateId);
      if (!gate) {
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
            llmValidationUsed: false
          }
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
      const passed = checks.length === 0 || checks.every(check => check.passed);

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
          llmValidationUsed
        }
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
        checks: [{
          type: 'system_error',
          passed: false,
          message: `Validation error: ${error instanceof Error ? error.message : String(error)}`
        }],
        retryHints: [`Gate validation encountered an error. Please try again.`],
        metadata: {
          validationTime: Date.now() - startTime,
          checksPerformed: 0,
          llmValidationUsed: false
        }
      };
    }
  }

  /**
   * Validate content against multiple gates
   */
  async validateGates(
    gateIds: string[],
    context: ValidationContext
  ): Promise<ValidationResult[]> {
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
   */
  private async runValidationCheck(
    criteria: GatePassCriteria,
    context: ValidationContext
  ): Promise<ValidationCheck> {
    try {
      switch (criteria.type) {
        case 'content_check':
          return await this.runContentCheck(criteria, context);
        case 'pattern_check':
          return await this.runPatternCheck(criteria, context);
        case 'llm_self_check':
          return await this.runLLMSelfCheck(criteria, context);
        default:
          return {
            type: criteria.type,
            passed: false,
            message: `Unknown validation type: ${criteria.type}`
          };
      }
    } catch (error) {
      this.logger.error(`Validation check failed for ${criteria.type}:`, error);
      return {
        type: criteria.type,
        passed: false,
        message: `Check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Run basic content checks (length, basic requirements)
   */
  private async runContentCheck(
    criteria: GatePassCriteria,
    context: ValidationContext
  ): Promise<ValidationCheck> {
    const content = context.content;
    const issues: string[] = [];

    // Length checks
    if (criteria.min_length && content.length < criteria.min_length) {
      issues.push(`Content too short: ${content.length} < ${criteria.min_length} characters`);
    }

    if (criteria.max_length && content.length > criteria.max_length) {
      issues.push(`Content too long: ${content.length} > ${criteria.max_length} characters`);
    }

    // Required patterns (simple string matching)
    if (criteria.required_patterns) {
      for (const pattern of criteria.required_patterns) {
        if (!content.toLowerCase().includes(pattern.toLowerCase())) {
          issues.push(`Missing required content: "${pattern}"`);
        }
      }
    }

    // Forbidden patterns
    if (criteria.forbidden_patterns) {
      for (const pattern of criteria.forbidden_patterns) {
        if (content.toLowerCase().includes(pattern.toLowerCase())) {
          issues.push(`Contains forbidden content: "${pattern}"`);
        }
      }
    }

    const passed = issues.length === 0;

    return {
      type: 'content_check',
      passed,
      score: passed ? 1.0 : Math.max(0, 1 - (issues.length * 0.25)),
      message: passed ? 'Content checks passed' : issues.join('; '),
      details: {
        contentLength: content.length,
        issuesFound: issues.length
      }
    };
  }

  /**
   * Run pattern matching checks
   */
  private async runPatternCheck(
    criteria: GatePassCriteria,
    context: ValidationContext
  ): Promise<ValidationCheck> {
    const content = context.content;
    const issues: string[] = [];

    // Regex pattern matching
    if (criteria.regex_patterns) {
      for (const pattern of criteria.regex_patterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (!regex.test(content)) {
            issues.push(`Content doesn't match pattern: ${pattern}`);
          }
        } catch (error) {
          issues.push(`Invalid regex pattern: ${pattern}`);
        }
      }
    }

    // Keyword count checking
    if (criteria.keyword_count) {
      for (const [keyword, requiredCount] of Object.entries(criteria.keyword_count)) {
        const matches = (content.toLowerCase().match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
        if (matches < requiredCount) {
          issues.push(`Insufficient keyword "${keyword}": found ${matches}, required ${requiredCount}`);
        }
      }
    }

    const passed = issues.length === 0;

    return {
      type: 'pattern_check',
      passed,
      score: passed ? 1.0 : Math.max(0, 1 - (issues.length * 0.3)),
      message: passed ? 'Pattern checks passed' : issues.join('; '),
      details: { issuesFound: issues.length }
    };
  }

  /**
   * Run LLM self-check validation
   *
   * TODO: IMPLEMENT LLM API INTEGRATION
   * This requires connecting to the LLM client configured at:
   * config.analysis.semanticAnalysis.llmIntegration
   *
   * Requirements for implementation:
   * - LLM client instance (from semantic analyzer)
   * - Validation prompt templates
   * - Quality assessment criteria
   * - Confidence threshold enforcement
   *
   * Current behavior: Gracefully skips when LLM not configured
   */
  private async runLLMSelfCheck(
    criteria: GatePassCriteria,
    context: ValidationContext
  ): Promise<ValidationCheck> {
    // Check if LLM integration is configured and enabled
    if (!this.llmConfig?.enabled) {
      this.logger.debug('[LLM GATE] LLM self-check skipped - LLM integration disabled in config');
      return {
        type: 'llm_self_check',
        passed: true, // Auto-pass when not configured
        score: 1.0,
        message: 'LLM validation skipped (not configured - set analysis.semanticAnalysis.llmIntegration.enabled=true)',
        details: {
          skipped: true,
          reason: 'LLM integration disabled in config',
          configPath: 'config.analysis.semanticAnalysis.llmIntegration.enabled'
        }
      };
    }

    if (!this.llmConfig.endpoint) {
      this.logger.warn('[LLM GATE] LLM self-check skipped - no endpoint configured');
      return {
        type: 'llm_self_check',
        passed: true,
        score: 1.0,
        message: 'LLM validation skipped (no endpoint configured)',
        details: {
          skipped: true,
          reason: 'No LLM endpoint configured',
          configPath: 'config.analysis.semanticAnalysis.llmIntegration.endpoint'
        }
      };
    }

    // TODO: Once LLM API client is available, implement actual validation here
    // For now, log that it's not yet implemented even though config is enabled
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
        configEnabled: this.llmConfig.enabled,
        endpoint: this.llmConfig.endpoint,
        templateRequested: criteria.prompt_template || 'default',
        implementation: 'TODO: Wire LLM client from semantic analyzer'
      }
    };
  }

  /**
   * Generate retry hints based on failed checks
   */
  private generateRetryHints(
    gate: LightweightGateDefinition,
    checks: ValidationCheck[]
  ): string[] {
    const hints: string[] = [];
    const failedChecks = checks.filter(check => !check.passed);

    if (failedChecks.length === 0) {
      return hints;
    }

    // Add gate-specific guidance as a hint
    if (gate.guidance) {
      hints.push(`Remember the ${gate.name} guidelines:\n${gate.guidance}`);
    }

    // Add specific failure hints
    for (const check of failedChecks) {
      switch (check.type) {
        case 'content_check':
          if (check.message.includes('too short')) {
            hints.push('Add more detail, examples, or explanations to meet length requirements');
          }
          if (check.message.includes('too long')) {
            hints.push('Condense your response by removing redundant information');
          }
          if (check.message.includes('Missing required content')) {
            hints.push(`Ensure your response includes: ${check.message.split(': ')[1]}`);
          }
          break;
        case 'pattern_check':
          hints.push('Review pattern matching requirements and adjust content structure');
          break;
        case 'llm_self_check':
          hints.push('Review the quality criteria and improve content structure and depth');
          break;
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
    const shouldRetry = validationResults.some(result => !result.valid);

    if (shouldRetry) {
      this.validationStats.retryRequests++;
      this.logger.debug('[GATE VALIDATOR] Retry recommended:', {
        currentAttempt,
        maxAttempts,
        failedGates: validationResults.filter(r => !r.valid).map(r => r.gateId)
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
      retryRequests: 0
    };
    this.validationTimes = [];
    this.logger.debug('[GATE VALIDATOR] Statistics reset');
  }
}

/**
 * Create a gate validator instance
 */
export function createGateValidator(logger: Logger, gateLoader: GateLoader, llmConfig?: LLMIntegrationConfig): GateValidator {
  return new GateValidator(logger, gateLoader, llmConfig);
}