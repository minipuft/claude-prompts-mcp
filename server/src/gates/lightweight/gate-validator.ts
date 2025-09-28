/**
 * Lightweight Gate Validator
 * Simple validation without complex orchestration - focuses on practical checks
 */

import { Logger } from '../../logging/index.js';
import type { GateLoader } from './gate-loader.js';
import type {
  LightweightGateDefinition,
  ValidationResult,
  ValidationCheck,
  ValidationContext,
  GatePassCriteria
} from '../types.js';

/**
 * Lightweight gate validator with simple pass/fail logic
 */
export class GateValidator {
  private logger: Logger;
  private gateLoader: GateLoader;

  constructor(logger: Logger, gateLoader: GateLoader) {
    this.logger = logger;
    this.gateLoader = gateLoader;
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
    const results: ValidationResult[] = [];

    for (const gateId of gateIds) {
      const result = await this.validateGate(gateId, context);
      if (result) {
        results.push(result);
      }
    }

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
   * Run LLM self-check validation (placeholder for now)
   */
  private async runLLMSelfCheck(
    criteria: GatePassCriteria,
    context: ValidationContext
  ): Promise<ValidationCheck> {
    // TODO: Implement actual LLM self-validation in Phase 2
    // For now, return a simple heuristic-based check

    this.logger.debug(`LLM self-check requested with template: ${criteria.prompt_template}`);

    // Simple heuristic: check if content is substantial and well-structured
    const content = context.content;
    const wordCount = content.split(/\s+/).length;
    const hasStructure = content.includes('\n') && (content.includes('##') || content.includes('-'));

    const score = Math.min(1.0, (wordCount / 100) * 0.5 + (hasStructure ? 0.5 : 0));
    const passed = score >= (criteria.pass_threshold || 0.7);

    return {
      type: 'llm_self_check',
      passed,
      score,
      message: passed
        ? `LLM self-check passed (score: ${score.toFixed(2)})`
        : `LLM self-check failed (score: ${score.toFixed(2)}, threshold: ${criteria.pass_threshold || 0.7})`,
      details: {
        wordCount,
        hasStructure,
        threshold: criteria.pass_threshold || 0.7,
        templateUsed: criteria.prompt_template || 'default'
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
   * Get validation statistics
   */
  getStatistics(): {
    validationsPerformed: number;
    averageValidationTime: number;
    passRate: number;
  } {
    // TODO: Implement statistics tracking
    return {
      validationsPerformed: 0,
      averageValidationTime: 0,
      passRate: 0
    };
  }
}

/**
 * Create a gate validator instance
 */
export function createGateValidator(logger: Logger, gateLoader: GateLoader): GateValidator {
  return new GateValidator(logger, gateLoader);
}