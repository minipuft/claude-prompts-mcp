// @lifecycle canonical - Validation helpers for prompt engine inputs.
/**
 * Engine Validator - Handles engine-specific validation
 *
 * Extracted from PromptExecutionService to provide focused
 * validation capabilities with clear separation of concerns.
 */

import os from 'node:os';
import path from 'node:path';

import { LightweightGateSystem } from '../../../gates/core/index.js';
import { createLogger } from '../../../logging/index.js';
import { ConvertedPrompt } from '../../../types/index.js';

const logger = createLogger({
  logFile: path.join(os.tmpdir(), 'engine-validator.log'),
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'info',
});

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  score: number;
}

export interface GateValidationResult {
  passed: boolean;
  results: Array<{
    gate: string;
    passed: boolean;
    message: string;
    score?: number;
  }>;
}

/**
 * EngineValidator handles all engine-specific validation
 *
 * This class provides:
 * - Prompt validation and quality checking
 * - Gate validation coordination
 * - Execution readiness assessment
 * - Quality scoring and recommendations
 */
export class EngineValidator {
  private gateSystem: LightweightGateSystem | undefined;

  constructor(gateSystem?: LightweightGateSystem) {
    this.gateSystem = gateSystem;
  }

  /**
   * Validate prompt for execution readiness
   */
  public validatePrompt(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any> = {}
  ): ValidationResult {
    try {
      logger.debug('🔍 [EngineValidator] Validating prompt', {
        promptId: convertedPrompt.id,
        hasArgs: Object.keys(promptArgs).length > 0,
      });

      const errors: string[] = [];
      const warnings: string[] = [];
      let score = 100;

      // Basic prompt validation
      if (!convertedPrompt.id) {
        errors.push('Prompt ID is missing');
        score -= 50;
      }

      if (
        !convertedPrompt.userMessageTemplate ||
        convertedPrompt.userMessageTemplate.trim().length === 0
      ) {
        errors.push('Prompt content is empty');
        score -= 50;
      }

      // Content quality validation
      const contentValidation = this.validateContent(convertedPrompt.userMessageTemplate);
      errors.push(...contentValidation.errors);
      warnings.push(...contentValidation.warnings);
      score = Math.min(score, contentValidation.score);

      // Arguments validation
      const argsValidation = this.validateArguments(convertedPrompt, promptArgs);
      errors.push(...argsValidation.errors);
      warnings.push(...argsValidation.warnings);
      score = Math.min(score, argsValidation.score);

      const isValid = errors.length === 0;

      logger.debug('✅ [EngineValidator] Prompt validation completed', {
        promptId: convertedPrompt.id,
        isValid,
        score,
        errorsCount: errors.length,
        warningsCount: warnings.length,
      });

      return { isValid, errors, warnings, score };
    } catch (error) {
      logger.error('❌ [EngineValidator] Prompt validation failed', {
        promptId: convertedPrompt.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        isValid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
        score: 0,
      };
    }
  }

  /**
   * Validate prompt content quality
   */
  private validateContent(content: string | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    // Handle undefined content
    if (!content) {
      errors.push('Content is undefined or missing');
      return { isValid: false, errors, warnings, score: 0 };
    }

    // Length validation
    if (content.length < 10) {
      errors.push('Content is too short (minimum 10 characters)');
      score -= 30;
    }

    if (content.length > 50000) {
      warnings.push('Content is very long, may impact performance');
      score -= 10;
    }

    // Template syntax validation
    const templateErrors = this.validateTemplateSyntax(content);
    if (templateErrors.length > 0) {
      errors.push(...templateErrors);
      score -= 20;
    }

    // Content structure validation
    const structureWarnings = this.validateContentStructure(content);
    warnings.push(...structureWarnings);
    if (structureWarnings.length > 0) {
      score -= 5;
    }

    return { isValid: errors.length === 0, errors, warnings, score };
  }

  /**
   * Validate template syntax
   */
  private validateTemplateSyntax(content: string): string[] {
    const errors: string[] = [];

    // Check for unmatched braces
    const openBraces = (content.match(/\{\{/g) || []).length;
    const closeBraces = (content.match(/\}\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Unmatched template braces: ${openBraces} opening, ${closeBraces} closing`);
    }

    // Check for unmatched control structures
    const ifTags = (content.match(/\{%\s*if\s/g) || []).length;
    const endifTags = (content.match(/\{%\s*endif\s*%\}/g) || []).length;
    if (ifTags !== endifTags) {
      errors.push(`Unmatched if/endif tags: ${ifTags} if, ${endifTags} endif`);
    }

    const forTags = (content.match(/\{%\s*for\s/g) || []).length;
    const endforTags = (content.match(/\{%\s*endfor\s*%\}/g) || []).length;
    if (forTags !== endforTags) {
      errors.push(`Unmatched for/endfor tags: ${forTags} for, ${endforTags} endfor`);
    }

    return errors;
  }

  /**
   * Validate content structure
   */
  private validateContentStructure(content: string): string[] {
    const warnings: string[] = [];

    // Check for overly complex nesting
    const maxNesting = this.calculateMaxNesting(content);
    if (maxNesting > 3) {
      warnings.push(`Deep template nesting detected (${maxNesting} levels), consider simplifying`);
    }

    // Check for potential infinite loops
    if (content.includes('{% for') && !content.includes('{% endfor %}')) {
      warnings.push('Potential incomplete for loop detected');
    }

    // Check for missing variable fallbacks
    const variables = content.match(/\{\{\s*([^}]+)\s*\}\}/g) || [];
    for (const variable of variables) {
      if (!variable.includes('|') && !variable.includes('default')) {
        warnings.push(`Variable ${variable} has no fallback value`);
      }
    }

    return warnings;
  }

  /**
   * Calculate maximum nesting level
   */
  private calculateMaxNesting(content: string): number {
    let maxNesting = 0;
    let currentNesting = 0;

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('{% for') || line.includes('{% if')) {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (line.includes('{% endfor') || line.includes('{% endif')) {
        currentNesting = Math.max(0, currentNesting - 1);
      }
    }

    return maxNesting;
  }

  /**
   * Validate arguments against prompt requirements
   */
  private validateArguments(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any>
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    if (!convertedPrompt.arguments || convertedPrompt.arguments.length === 0) {
      return { isValid: true, errors, warnings, score };
    }

    // Check required arguments
    for (const arg of convertedPrompt.arguments) {
      if (arg.required && !promptArgs.hasOwnProperty(arg.name)) {
        errors.push(`Missing required argument: ${arg.name}`);
        score -= 20;
      }
    }

    // Check argument types
    for (const arg of convertedPrompt.arguments) {
      if (promptArgs.hasOwnProperty(arg.name)) {
        const value = promptArgs[arg.name];
        if (!this.isValidArgumentType(value, arg.type || 'string')) {
          errors.push(
            `Argument '${arg.name}' should be of type '${arg.type}', got '${typeof value}'`
          );
          score -= 10;
        }
      }
    }

    // Check for unused arguments
    const expectedArgs = convertedPrompt.arguments.map((arg: any) => arg.name);
    for (const argName of Object.keys(promptArgs)) {
      if (!expectedArgs.includes(argName)) {
        warnings.push(`Unexpected argument provided: ${argName}`);
        score -= 2;
      }
    }

    return { isValid: errors.length === 0, errors, warnings, score };
  }

  /**
   * Validate argument type
   */
  private isValidArgumentType(value: any, expectedType: string): boolean {
    switch (expectedType.toLowerCase()) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return true; // Unknown types are considered valid
    }
  }

  /**
   * Validate execution with gates
   */
  public async validateWithGates(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any>,
    suggestedGates: string[] = [],
    processedContent?: string
  ): Promise<GateValidationResult> {
    try {
      logger.debug('🚪 [EngineValidator] Validating with gates', {
        promptId: convertedPrompt.id,
        gatesCount: suggestedGates.length,
        hasProcessedContent: !!processedContent,
      });

      if (!this.gateSystem || suggestedGates.length === 0) {
        return { passed: true, results: [] };
      }

      const results: Array<{ gate: string; passed: boolean; message: string; score?: number }> = [];
      let allPassed = true;

      // FIXED: Use processed content for validation, not raw template
      const contentToValidate = processedContent || convertedPrompt.userMessageTemplate || '';

      for (const gateName of suggestedGates) {
        try {
          const gateResults = await this.gateSystem.validateContent([gateName], contentToValidate, {
            promptId: convertedPrompt.id,
            stepId: gateName,
            attemptNumber: 1,
            previousAttempts: [],
          });
          const gateResult = (Array.isArray(gateResults) ? gateResults[0] : undefined) || {
            valid: false,
            errors: [
              { field: 'gate', message: 'Gate validation failed', code: 'VALIDATION_ERROR' },
            ],
          };

          const primaryMessage =
            gateResult.errors?.[0]?.message ?? (gateResult.valid ? 'Gate passed' : 'Gate failed');

          results.push({
            gate: gateName,
            passed: gateResult.valid || gateResult.passed || false,
            message: primaryMessage,
            score: 85, // Default validation score
          });

          if (!gateResult.valid && !gateResult.passed) {
            allPassed = false;
          }
        } catch (error) {
          results.push({
            gate: gateName,
            passed: false,
            message: `Gate validation error: ${error instanceof Error ? error.message : String(error)}`,
          });
          allPassed = false;
        }
      }

      logger.debug('✅ [EngineValidator] Gate validation completed', {
        promptId: convertedPrompt.id,
        allPassed,
        resultsCount: results.length,
      });

      return { passed: allPassed, results };
    } catch (error) {
      logger.error('❌ [EngineValidator] Gate validation failed', {
        promptId: convertedPrompt.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        passed: false,
        results: [
          {
            gate: 'system',
            passed: false,
            message: `Gate system error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
