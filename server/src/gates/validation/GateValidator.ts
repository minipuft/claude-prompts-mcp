/**
 * Gate Validator - Content Validation & Retry Logic
 *
 * Single responsibility: Validate content against gate criteria and provide retry logic.
 * Clean dependencies: Only imports validation types and logger.
 */

import type { Logger } from '../../logging/index.js';
import type { ValidationResult } from '../../execution/types.js';
import { GateDefinition } from '../core/gate-definitions.js';

/**
 * Validation context for gate checks
 */
export interface ValidationContext {
  content: string;
  metadata?: Record<string, any>;
  executionContext?: {
    promptId?: string;
    stepId?: string;
    attemptNumber?: number;
    previousAttempts?: string[];
  };
}

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
 * Gate validator with retry logic and statistics
 */
export class GateValidator {
  private validationStats: GateValidationStatistics = {
    totalValidations: 0,
    successfulValidations: 0,
    failedValidations: 0,
    averageValidationTime: 0,
    retryRequests: 0
  };

  private validationTimes: number[] = [];
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.logger.debug('[GATE VALIDATOR] Initialized');
  }

  /**
   * Validate content against specified gates
   *
   * @param gateIds - Array of gate IDs to validate against
   * @param context - Validation context with content and metadata
   * @returns Array of validation results
   */
  async validateGates(gateIds: string[], context: ValidationContext): Promise<ValidationResult[]> {
    const startTime = Date.now();

    this.logger.info('🔍 [GATE VALIDATOR] validateGates called:', {
      gateIds,
      contentLength: context.content.length,
      promptId: context.executionContext?.promptId,
      attemptNumber: context.executionContext?.attemptNumber
    });

    const results: ValidationResult[] = [];

    for (const gateId of gateIds) {
      try {
        const result = await this.validateSingleGate(gateId, context);
        results.push(result);

        if (result.passed) {
          this.validationStats.successfulValidations++;
        } else {
          this.validationStats.failedValidations++;
        }
      } catch (error) {
        this.logger.error('[GATE VALIDATOR] Failed to validate gate:', gateId, error);

        // Create error result
        results.push({
          gateId,
          valid: false,
          passed: false,
          errors: [{
            field: 'content',
            message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            code: 'VALIDATION_ERROR'
          }],
          retryHints: ['Check gate configuration and try again'],
          metadata: {
            validationTime: Date.now(),
            checksPerformed: 0,
            llmValidationUsed: false
          }
        });

        this.validationStats.failedValidations++;
      }
    }

    // Update statistics
    const executionTime = Date.now() - startTime;
    this.validationTimes.push(executionTime);
    this.validationStats.totalValidations++;
    this.updateAverageValidationTime();

    this.logger.debug('[GATE VALIDATOR] Validation completed:', {
      gateCount: gateIds.length,
      passedCount: results.filter(r => r.passed).length,
      executionTime
    });

    return results;
  }

  /**
   * Validate content against a single gate
   */
  private async validateSingleGate(gateId: string, context: ValidationContext): Promise<ValidationResult> {
    // Basic validation logic - in a real implementation, this would load gate definitions
    // and apply specific validation criteria for each gate type

    const basicChecks = this.performBasicValidation(gateId, context);

    return {
      gateId,
      valid: basicChecks.passed,
      passed: basicChecks.passed,
      errors: basicChecks.issues.map(issue => ({
        field: 'content',
        message: issue,
        code: 'VALIDATION_FAILED'
      })),
      retryHints: basicChecks.retryHints,
      metadata: {
        validationTime: Date.now(),
        checksPerformed: 1,
        llmValidationUsed: false
      }
    };
  }

  /**
   * Perform basic validation checks
   */
  private performBasicValidation(gateId: string, context: ValidationContext): {
    passed: boolean;
    issues: string[];
    retryHints: string[];
  } {
    const issues: string[] = [];
    const retryHints: string[] = [];
    let confidence = 1.0;

    // Example validation logic (would be expanded for real gate criteria)
    if (context.content.length < 10) {
      issues.push('Content is too short for meaningful validation');
      retryHints.push('Provide more detailed content');
      confidence = 0.3;
    }

    if (context.content.includes('TODO') || context.content.includes('FIXME')) {
      issues.push('Content contains placeholder or incomplete sections');
      retryHints.push('Complete all TODO and FIXME items');
      confidence = Math.min(confidence, 0.7);
    }

    const passed = issues.length === 0;

    return {
      passed,
      issues,
      retryHints
    };
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
   * Get combined retry hints from all failed validations
   *
   * @param validationResults - Results from gate validation
   * @returns Array of formatted retry hints
   */
  getRetryHints(validationResults: ValidationResult[]): string[] {
    const allHints: string[] = [];

    for (const result of validationResults) {
      if (!result.valid) {
        allHints.push(`**${result.gateId}:**`);
        if (result.retryHints) {
          allHints.push(...result.retryHints);
        }
        allHints.push(''); // Empty line for separation
      }
    }

    return allHints;
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
 * Factory function for creating gate validator
 */
export function createGateValidator(logger: Logger): GateValidator {
  return new GateValidator(logger);
}