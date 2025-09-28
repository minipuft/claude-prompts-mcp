/**
 * Lightweight Gate System - Main Exports
 * Simple guidance + validation system replacing complex gate orchestration
 */

import { GateLoader, createGateLoader } from './gate-loader.js';
import { GateValidator, createGateValidator } from './gate-validator.js';
import type {
  LightweightGateDefinition,
  GatePassCriteria,
  ValidationResult,
  ValidationCheck,
  ValidationContext,
  GateActivationResult
} from './types.js';

export { GateLoader, createGateLoader } from './gate-loader.js';
export { GateValidator, createGateValidator } from './gate-validator.js';

export type {
  LightweightGateDefinition,
  GatePassCriteria,
  ValidationResult,
  ValidationCheck,
  ValidationContext,
  GateActivationResult
} from './types.js';

/**
 * Lightweight gate system manager
 */
export class LightweightGateSystem {
  constructor(
    public gateLoader: GateLoader,
    public gateValidator: GateValidator
  ) {}

  /**
   * Get guidance text for active gates
   */
  async getGuidanceText(
    gateIds: string[],
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): Promise<string[]> {
    const activation = await this.gateLoader.getActiveGates(gateIds, context);
    return activation.guidanceText;
  }

  /**
   * Validate content against active gates
   */
  async validateContent(
    gateIds: string[],
    content: string,
    validationContext: {
      promptId?: string;
      stepId?: string;
      attemptNumber?: number;
      previousAttempts?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<ValidationResult[]> {
    const context = {
      content,
      metadata: validationContext.metadata,
      executionContext: {
        promptId: validationContext.promptId,
        stepId: validationContext.stepId,
        attemptNumber: validationContext.attemptNumber,
        previousAttempts: validationContext.previousAttempts
      }
    };

    return this.gateValidator.validateGates(gateIds, context);
  }

  /**
   * Check if content should be retried based on validation results
   */
  shouldRetry(
    validationResults: ValidationResult[],
    currentAttempt: number,
    maxAttempts: number = 3
  ): boolean {
    if (currentAttempt >= maxAttempts) {
      return false;
    }

    // Retry if any validation gate failed
    return validationResults.some(result => !result.passed);
  }

  /**
   * Get combined retry hints from all failed validations
   */
  getRetryHints(validationResults: ValidationResult[]): string[] {
    const allHints: string[] = [];

    for (const result of validationResults) {
      if (!result.passed) {
        allHints.push(`**${result.gateId}:**`);
        allHints.push(...result.retryHints);
        allHints.push(''); // Empty line for separation
      }
    }

    return allHints;
  }

  /**
   * Get system statistics
   */
  getStatistics() {
    return {
      gateLoader: this.gateLoader.getStatistics(),
      gateValidator: this.gateValidator.getStatistics()
    };
  }
}

/**
 * Create a complete lightweight gate system
 */
export function createLightweightGateSystem(
  logger: any,
  gatesDirectory?: string
): LightweightGateSystem {
  const gateLoader = createGateLoader(logger, gatesDirectory);
  const gateValidator = createGateValidator(logger, gateLoader);

  return new LightweightGateSystem(gateLoader, gateValidator);
}