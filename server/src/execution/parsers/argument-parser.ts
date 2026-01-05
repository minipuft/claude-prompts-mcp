// @lifecycle canonical - Builds operator arguments from parsed command tokens.
/**
 * Argument Processing Pipeline
 *
 * Advanced argument processing system that handles validation, sanitization,
 * type coercion, and enrichment based on prompt definitions and execution context.
 *
 * Features:
 * - Type-aware argument coercion based on prompt definitions
 * - Smart default resolution (replaces hardcoded {{previous_message}})
 * - Multi-source context aggregation
 * - Argument validation cascading (minLength, maxLength, pattern)
 * - Context-aware placeholder resolution
 * - Fail-fast validation with actionable retry hints
 */

import { ArgumentSchemaValidator } from './argument-schema.js';
import { Logger } from '../../logging/index.js';
import {
  ArgumentValidationError,
  safeJsonParse,
  validateJsonArguments,
} from '../../utils/index.js';

import type { ConvertedPrompt, PromptArgument } from '../../types/index.js';
import type { ValidationResult } from '../types.js';

type PromptDefinition = Pick<ConvertedPrompt, 'id' | 'arguments'>;

/**
 * Processing result with detailed metadata
 */
export interface ArgumentParsingResult {
  processedArgs: Record<string, string | number | boolean | null>;
  resolvedPlaceholders: Record<string, string | number | boolean | null>;
  validationResults: ValidationResult[];
  metadata: {
    parsingStrategy: string;
    appliedDefaults: string[];
    typeCoercions: Array<{ arg: string; from: string; to: string }>;
    contextSources: Record<string, string>;
    warnings: string[];
  };
}

/**
 * Execution context for argument processing
 */
export interface ExecutionContext {
  conversationHistory?: Array<{ role: string; content: string; timestamp?: string }>;
  environmentVars?: Record<string, string>;
  promptDefaults?: Record<string, string | number | boolean | null>;
  userSession?: Record<string, string | number | boolean | null>;
  systemContext?: Record<string, string | number | boolean | null>;
}

/**
 * Processing strategy interface
 */
interface ProcessingStrategy {
  name: string;
  canHandle: (rawArgs: string, promptData: PromptDefinition) => boolean;
  process: (
    rawArgs: string,
    promptData: PromptDefinition,
    context: ExecutionContext
  ) => ArgumentParsingResult;
}

/**
 * Argument Processor Class
 */
export class ArgumentParser {
  private logger: Logger;
  private strategies: ProcessingStrategy[];
  private schemaValidator: ArgumentSchemaValidator;

  // Processing statistics
  private stats = {
    totalProcessed: 0,
    successfulProcessing: 0,
    validationFailures: 0,
    typeCoercions: 0,
    defaultsApplied: 0,
    contextResolutions: 0,
  };

  constructor(logger: Logger) {
    this.logger = logger;
    this.strategies = this.initializeStrategies();
    this.schemaValidator = new ArgumentSchemaValidator();
    this.logger.debug(
      `ArgumentParser initialized with ${this.strategies.length} processing strategies and schema validation`
    );
  }

  /**
   * Process arguments through validation, sanitization, and enrichment pipeline
   */
  async parseArguments(
    rawArgs: string,
    promptData: PromptDefinition,
    context: ExecutionContext = {}
  ): Promise<ArgumentParsingResult> {
    this.stats.totalProcessed++;

    this.logger.debug(
      `Processing arguments for prompt "${promptData.id}": "${rawArgs.substring(0, 100)}..."`
    );

    // Select appropriate processing strategy
    const strategy = this.selectStrategy(rawArgs, promptData);

    try {
      const result = strategy.process(rawArgs, promptData, context);

      // Apply validation and enrichment
      const enrichedResult = await this.enrichResult(result, promptData, context);

      this.stats.successfulProcessing++;
      this.updateProcessingStats(enrichedResult);

      this.logger.debug(`Arguments processed successfully using strategy: ${strategy.name}`);
      return enrichedResult;
    } catch (error) {
      this.stats.validationFailures++;
      this.logger.error(`Argument processing failed for prompt ${promptData.id}:`, error);
      throw error;
    }
  }

  /**
   * Initialize processing strategies
   */
  private initializeStrategies(): ProcessingStrategy[] {
    return [
      this.createJsonStrategy(),
      this.createKeyValueStrategy(),
      this.createSimpleTextStrategy(),
      this.createFallbackStrategy(),
    ];
  }

  /**
   * Select best processing strategy for the given arguments
   */
  private selectStrategy(rawArgs: string, promptData: PromptDefinition): ProcessingStrategy {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(rawArgs, promptData)) {
        return strategy;
      }
    }

    // Should never reach here due to fallback strategy, but safety first
    const fallbackStrategy = this.strategies[this.strategies.length - 1];
    if (!fallbackStrategy) {
      throw new Error('No parsing strategies available');
    }
    return fallbackStrategy;
  }

  /**
   * JSON argument processing strategy
   */
  private createJsonStrategy(): ProcessingStrategy {
    return {
      name: 'json',
      canHandle: (rawArgs: string) => {
        const trimmed = rawArgs.trim();
        return (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        );
      },
      process: (
        rawArgs: string,
        promptData: PromptDefinition,
        context: ExecutionContext
      ): ArgumentParsingResult => {
        const parseResult = safeJsonParse(rawArgs);
        if (!parseResult.success || !parseResult.data) {
          throw new Error(
            `Invalid JSON arguments: ${parseResult.error || 'Unknown parsing error'}`
          );
        }

        const jsonArgs = parseResult.data;
        const validation = validateJsonArguments(jsonArgs, promptData);

        const processedArgs = validation.sanitizedArgs || {};
        // Ensure processedArgs only contains allowed types for UnifiedExecutionContext
        const compatibleArgs: Record<string, string | number | boolean | null> = {};
        for (const [key, value] of Object.entries(processedArgs)) {
          if (Array.isArray(value)) {
            // Convert arrays to JSON strings for compatibility
            compatibleArgs[key] = JSON.stringify(value);
          } else {
            compatibleArgs[key] = value;
          }
        }

        const validationResults = this.createValidationResults(
          compatibleArgs,
          promptData,
          validation
        );

        return {
          processedArgs: compatibleArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'json',
            appliedDefaults: [],
            typeCoercions: [],
            contextSources: {},
            warnings: validation.errors || [],
          },
        };
      },
    };
  }

  /**
   * Key-value pair processing strategy (arg1=value1 arg2=value2)
   */
  private createKeyValueStrategy(): ProcessingStrategy {
    return {
      name: 'keyvalue',
      canHandle: (rawArgs: string) => {
        // Detect both = and : delimiters, support dashes in argument names
        return /[\w-]+\s*[=:]\s*/.test(rawArgs);
      },
      process: (
        rawArgs: string,
        promptData: PromptDefinition,
        context: ExecutionContext
      ): ArgumentParsingResult => {
        const processedArgs: Record<string, string | number | boolean | null> = {};
        const typeCoercions: Array<{ arg: string; from: string; to: string }> = [];
        const contextSources: Record<string, string> = {};

        // Parse key=value and key:value pairs with proper quote handling
        // Supports both = and : delimiters, and dashes in argument names
        const pairs =
          rawArgs.match(
            /([\w-]+)\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+(?:\s+(?![\w-]+\s*[=:])[^\s"']*)*))/g
          ) || [];

        for (const pair of pairs) {
          // Support both = and : delimiters, dashes in argument names
          const match = pair.match(/([\w-]+)\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|(.*))/);
          if (match) {
            const [, key, doubleQuoted, singleQuoted, unquoted] = match;
            // Skip if key is undefined (shouldn't happen given regex, but TypeScript needs certainty)
            if (!key) {
              continue;
            }
            // Use the appropriate captured group - quoted strings take precedence
            const value =
              doubleQuoted !== undefined
                ? doubleQuoted
                : singleQuoted !== undefined
                  ? singleQuoted
                  : (unquoted ?? '');
            const trimmedValue = value.trim();

            // Find argument definition for type coercion
            const argDef = promptData.arguments.find((arg) => arg.name === key);
            if (argDef) {
              const coercedValue = this.coerceArgumentType(trimmedValue, argDef);
              if (coercedValue.wasCoerced) {
                typeCoercions.push({
                  arg: key,
                  from: typeof trimmedValue,
                  to: typeof coercedValue.value,
                });
              }
              processedArgs[key] = coercedValue.value;
              contextSources[key] = 'user_provided';
            } else {
              processedArgs[key] = trimmedValue;
              contextSources[key] = 'user_provided';
            }
          }
        }

        // Apply defaults for missing optional arguments
        const appliedDefaults: string[] = [];
        for (const arg of promptData.arguments) {
          if (!(arg.name in processedArgs)) {
            const defaultValue = this.resolveContextualDefault(arg, context);
            processedArgs[arg.name] = defaultValue.value;
            contextSources[arg.name] = defaultValue.source;
            if (defaultValue.source !== 'none' && defaultValue.source !== 'empty_fallback') {
              appliedDefaults.push(arg.name);
            }
          }
        }

        const validationResults = this.createValidationResults(processedArgs, promptData);

        return {
          processedArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'keyvalue',
            appliedDefaults,
            typeCoercions,
            contextSources,
            warnings: [],
          },
        };
      },
    };
  }

  /**
   * Simple text processing strategy
   */
  private createSimpleTextStrategy(): ProcessingStrategy {
    return {
      name: 'simple',
      canHandle: (rawArgs: string, promptData: PromptDefinition) => {
        return rawArgs.trim().length > 0 && promptData.arguments.length > 0;
      },
      process: (
        rawArgs: string,
        promptData: PromptDefinition,
        context: ExecutionContext
      ): ArgumentParsingResult => {
        const processedArgs: Record<string, string | number | boolean | null> = {};
        const appliedDefaults: string[] = [];
        const contextSources: Record<string, string> = {};

        if (promptData.arguments.length === 1) {
          // Single argument - assign all text to it
          const arg = promptData.arguments[0];
          if (arg) {
            processedArgs[arg.name] = rawArgs.trim();
            contextSources[arg.name] = 'user_provided';
          }
        } else {
          // Multiple arguments - use intelligent defaults
          this.applyIntelligentDefaults(
            rawArgs,
            promptData,
            processedArgs,
            appliedDefaults,
            contextSources,
            context
          );
        }

        const validationResults = this.createValidationResults(processedArgs, promptData);

        return {
          processedArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'simple',
            appliedDefaults,
            typeCoercions: [],
            contextSources,
            warnings: [],
          },
        };
      },
    };
  }

  /**
   * Fallback processing strategy
   */
  private createFallbackStrategy(): ProcessingStrategy {
    return {
      name: 'fallback',
      canHandle: () => true, // Always handles as last resort
      process: (
        rawArgs: string,
        promptData: PromptDefinition,
        context: ExecutionContext
      ): ArgumentParsingResult => {
        const processedArgs: Record<string, string | number | boolean | null> = {};
        const appliedDefaults: string[] = [];
        const contextSources: Record<string, string> = {};
        const warnings: string[] = [];

        // Apply defaults for all arguments
        for (const arg of promptData.arguments) {
          if (rawArgs.trim()) {
            // Use provided text for first argument, defaults for rest
            if (Object.keys(processedArgs).length === 0) {
              processedArgs[arg.name] = rawArgs.trim();
              contextSources[arg.name] = 'user_provided';
            } else {
              const defaultValue = this.resolveContextualDefault(arg, context);
              processedArgs[arg.name] = defaultValue.value;
              contextSources[arg.name] = defaultValue.source;
              appliedDefaults.push(arg.name);
            }
          } else {
            const defaultValue = this.resolveContextualDefault(arg, context);
            processedArgs[arg.name] = defaultValue.value;
            contextSources[arg.name] = defaultValue.source;
            appliedDefaults.push(arg.name);
          }
        }

        warnings.push('Used fallback argument processing - consider using structured format');

        const validationResults = this.createValidationResults(processedArgs, promptData);

        return {
          processedArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'fallback',
            appliedDefaults,
            typeCoercions: [],
            contextSources,
            warnings,
          },
        };
      },
    };
  }

  /**
   * Apply intelligent defaults for arguments
   * ENHANCED: Smarter content mapping and auto-fill for 100% success rate
   */
  private applyIntelligentDefaults(
    userContent: string,
    promptData: PromptDefinition,
    processedArgs: Record<string, string | number | boolean | null>,
    appliedDefaults: string[],
    contextSources: Record<string, string>,
    context: ExecutionContext
  ): void {
    // Enhanced priority order for content assignment with better semantic matching
    const contentPriority = [
      'content',
      'text',
      'input',
      'data',
      'message',
      'query',
      'prompt',
      'description',
      'topic',
      'subject',
      'analysis',
      'code',
      'file',
    ];

    // Find the most appropriate argument for user content using multiple strategies
    let targetArg = null;

    // Strategy 1: Exact semantic match
    for (const priority of contentPriority) {
      targetArg = promptData.arguments.find((arg) => arg.name.toLowerCase().includes(priority));
      if (targetArg) {
        this.logger.debug(`Semantic match found: ${targetArg.name} (matched: ${priority})`);
        break;
      }
    }

    // Strategy 2: Description-based matching
    if (!targetArg && userContent) {
      targetArg = promptData.arguments.find(
        (arg) =>
          arg.description &&
          (arg.description.toLowerCase().includes('content') ||
            arg.description.toLowerCase().includes('text') ||
            arg.description.toLowerCase().includes('input') ||
            arg.description.toLowerCase().includes('analyze'))
      );
      if (targetArg) {
        this.logger.debug(`Description match found: ${targetArg.name}`);
      }
    }

    // Strategy 3: First required argument
    if (!targetArg) {
      targetArg = promptData.arguments.find((arg) => arg.required);
      if (targetArg) {
        this.logger.debug(`First required argument selected: ${targetArg.name}`);
      }
    }

    // Strategy 4: First argument (fallback)
    if (!targetArg && promptData.arguments.length > 0) {
      const firstArg = promptData.arguments[0];
      if (firstArg) {
        targetArg = firstArg;
        this.logger.debug(`First argument fallback: ${targetArg.name}`);
      }
    }

    // Assign user content to target argument with intelligent processing
    if (targetArg && userContent) {
      processedArgs[targetArg.name] = this.processContentForArgument(userContent, targetArg);
      contextSources[targetArg.name] = 'user_provided_smart_mapped';
      this.logger.debug(
        `Mapped user content to ${targetArg.name}: "${userContent.substring(0, 50)}..."`
      );
    }

    // Fill remaining arguments with enhanced contextual defaults
    for (const arg of promptData.arguments) {
      if (!processedArgs[arg.name]) {
        const defaultValue = this.resolveEnhancedContextualDefault(
          arg,
          context,
          userContent,
          promptData
        );
        processedArgs[arg.name] = defaultValue.value;
        contextSources[arg.name] = defaultValue.source;
        appliedDefaults.push(arg.name);
      }
    }

    // Log the mapping for debugging
    this.logger.debug(`Intelligent defaults applied:`, {
      promptId: promptData.id,
      userContentLength: userContent.length,
      targetArgument: targetArg?.name,
      totalArguments: promptData.arguments.length,
      appliedDefaults,
    });
  }

  /**
   * Process content specifically for an argument type
   */
  private processContentForArgument(content: string, arg: PromptArgument): string {
    // Basic content processing - can be enhanced further
    const trimmed = content.trim();

    // If argument name suggests it wants a specific format, attempt to extract it
    if (arg.name.toLowerCase().includes('json') && !trimmed.startsWith('{')) {
      // For JSON arguments, wrap simple content appropriately
      return `{"content": "${trimmed.replace(/"/g, '\\"')}"}`;
    }

    if (arg.name.toLowerCase().includes('url') && !trimmed.match(/^https?:\/\//)) {
      // Basic URL validation/enhancement could go here
      this.logger.debug(`Argument ${arg.name} expects URL but got: ${trimmed.substring(0, 50)}`);
    }

    return trimmed;
  }

  /**
   * Get default from argument's defaultValue definition
   * This is the highest priority source for defaults - author-defined values
   */
  private getFromArgumentDefault(arg: PromptArgument): { value: any; source: string } {
    if (arg.defaultValue !== undefined) {
      return { value: arg.defaultValue, source: 'argument_default' };
    }
    return { value: null, source: 'none' };
  }

  /**
   * Enhanced contextual default resolver
   * Simplified priority chain - no magic inference
   */
  private resolveEnhancedContextualDefault(
    arg: PromptArgument,
    context: ExecutionContext,
    _userContent: string,
    _promptData: PromptDefinition
  ): { value: any; source: string } {
    // Clean priority order - no guessing
    const strategies = [
      () => this.getFromArgumentDefault(arg), // Author-defined defaultValue
      () => this.getFromPromptDefaults(arg, context.promptDefaults), // Runtime overrides
      () => this.getFromEnvironment(arg, context.environmentVars), // Environment config
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result.value !== null && result.value !== undefined && result.value !== '') {
        return result;
      }
    }

    // No value found - return empty, let template conditionals handle it
    return { value: '', source: 'empty_fallback' };
  }

  /**
   * Resolve contextual default for an argument
   * Simplified priority chain - no magic inference
   */
  private resolveContextualDefault(
    arg: PromptArgument,
    context: ExecutionContext
  ): { value: any; source: string } {
    // Clean priority order - no guessing
    const strategies = [
      () => this.getFromArgumentDefault(arg), // Author-defined defaultValue
      () => this.getFromPromptDefaults(arg, context.promptDefaults), // Runtime overrides
      () => this.getFromEnvironment(arg, context.environmentVars), // Environment config
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result.value !== null && result.value !== undefined) {
        return result;
      }
    }

    // No value found - return empty, let template conditionals handle it
    return { value: '', source: 'empty_fallback' };
  }

  /**
   * Get default from prompt-specific defaults
   */
  private getFromPromptDefaults(
    arg: PromptArgument,
    promptDefaults?: Record<string, string | number | boolean | null>
  ): { value: any; source: string } {
    if (promptDefaults?.[arg.name] !== undefined) {
      return { value: promptDefaults[arg.name], source: 'prompt_defaults' };
    }
    return { value: null, source: 'none' };
  }

  /**
   * Get default from environment variables
   */
  private getFromEnvironment(
    arg: PromptArgument,
    environmentVars?: Record<string, string>
  ): { value: any; source: string } {
    if (environmentVars) {
      const envKey = `PROMPT_${arg.name.toUpperCase()}`;
      if (environmentVars[envKey]) {
        return { value: environmentVars[envKey], source: 'environment' };
      }
    }
    return { value: null, source: 'none' };
  }

  /**
   * Type coercion for arguments based on prompt definitions
   */
  private coerceArgumentType(
    value: string,
    argDef: PromptArgument
  ): { value: any; wasCoerced: boolean } {
    const originalType = typeof value;

    // If argument has type hints in description, use them
    const description = (argDef.description || '').toLowerCase();

    if (description.includes('number') || description.includes('integer')) {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        return { value: numValue, wasCoerced: originalType !== 'number' };
      }
    }

    if (
      description.includes('boolean') ||
      value.toLowerCase() === 'true' ||
      value.toLowerCase() === 'false'
    ) {
      return {
        value: value.toLowerCase() === 'true',
        wasCoerced: originalType !== 'boolean',
      };
    }

    if (
      description.includes('array') ||
      description.includes('list') ||
      argDef.name.toLowerCase().includes('list') ||
      description.includes('A list of') ||
      description.includes('list of')
    ) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return { value: parsed, wasCoerced: true };
        }
      } catch {
        // If not valid JSON, split by comma and clean up
        const arrayValue = value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return { value: arrayValue, wasCoerced: true };
      }
    }

    // Handle JSON objects
    if (
      description.includes('json') ||
      description.includes('object') ||
      description.includes('objects') ||
      value.startsWith('{') ||
      value.startsWith('[')
    ) {
      try {
        const parsed = JSON.parse(value);
        return { value: parsed, wasCoerced: true };
      } catch {
        // Invalid JSON, keep as string
        return { value, wasCoerced: false };
      }
    }

    // No coercion needed or possible
    return { value, wasCoerced: false };
  }

  /**
   * Create validation results for processed arguments
   */
  private createValidationResults(
    processedArgs: Record<string, string | number | boolean | null>,
    promptData: PromptDefinition,
    existingValidation?: any
  ): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const arg of promptData.arguments) {
      const value = processedArgs[arg.name];
      const safeValue = value ?? null;
      let result: ValidationResult = {
        argumentName: arg.name,
        valid: true,
        originalValue: safeValue,
        processedValue: safeValue,
      };

      const isMissingValue = this.isMissingArgumentValue(value);

      // Check if argument is required but missing
      if (arg.required && isMissingValue) {
        result = {
          ...result,
          valid: false,
          errors: [
            {
              field: arg.name,
              message: `Required argument '${arg.name}' is missing`,
              code: 'REQUIRED_ARGUMENT_MISSING',
              suggestion: `Please provide a value for argument '${arg.name}'`,
              example: `"${arg.name}": "example_value"`,
            },
          ],
        };
      }

      // Add existing validation errors if any
      if (existingValidation?.errors) {
        result = {
          ...result,
          warnings: existingValidation.errors,
        };
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Determine whether an argument value should be treated as missing.
   * Placeholder strings such as "[value to be provided]" are considered missing.
   */
  private isMissingArgumentValue(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== 'string') {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return true;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return /\b(to be provided|will be provided|will be specified|please specify)\b/i.test(
        trimmed
      );
    }

    return false;
  }

  /**
   * Enrich processing result with additional validation and context
   *
   * Runs schema validation if prompt has validation rules (minLength, maxLength, pattern).
   * Throws ArgumentValidationError with retry hints on validation failure.
   */
  private async enrichResult(
    result: ArgumentParsingResult,
    promptData: PromptDefinition,
    context: ExecutionContext
  ): Promise<ArgumentParsingResult> {
    // Check if prompt has validation rules that need enforcement
    const hasValidationRules = promptData.arguments.some(
      (arg) =>
        arg.validation &&
        (arg.validation.minLength !== undefined ||
          arg.validation.maxLength !== undefined ||
          arg.validation.pattern !== undefined)
    );

    if (hasValidationRules) {
      // Build a ConvertedPrompt-compatible object for the validator
      const promptForValidation = {
        id: promptData.id,
        arguments: promptData.arguments,
        name: promptData.id,
        description: '',
        category: '',
        filePath: '',
        fileContent: '',
        systemMessage: '',
        userMessageTemplate: '',
      };

      const validation = this.schemaValidator.validate(promptForValidation, result.processedArgs);

      if (!validation.success) {
        this.logger.debug(
          `Schema validation failed for prompt "${promptData.id}": ${validation.issues.length} issues`
        );

        throw new ArgumentValidationError(validation.issues, {
          id: promptData.id,
          arguments: promptData.arguments.map((arg) => {
            const mappedArg: {
              name: string;
              type?: string;
              required: boolean;
              validation?: { minLength?: number; maxLength?: number; pattern?: string };
            } = {
              name: arg.name,
              required: arg.required,
            };
            if (arg.type !== undefined) {
              mappedArg.type = arg.type;
            }
            if (arg.validation !== undefined) {
              mappedArg.validation = {
                ...(arg.validation.minLength !== undefined && {
                  minLength: arg.validation.minLength,
                }),
                ...(arg.validation.maxLength !== undefined && {
                  maxLength: arg.validation.maxLength,
                }),
                ...(arg.validation.pattern !== undefined && { pattern: arg.validation.pattern }),
              };
            }
            return mappedArg;
          }),
        });
      }

      this.logger.debug(`Schema validation passed for prompt "${promptData.id}"`);
    }

    return result;
  }

  /**
   * Update processing statistics
   */
  private updateProcessingStats(result: ArgumentParsingResult): void {
    this.stats.defaultsApplied += result.metadata.appliedDefaults.length;
    this.stats.typeCoercions += result.metadata.typeCoercions.length;
    this.stats.contextResolutions += Object.keys(result.metadata.contextSources).length;
  }

  /**
   * Get processing statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      successfulProcessing: 0,
      validationFailures: 0,
      typeCoercions: 0,
      defaultsApplied: 0,
      contextResolutions: 0,
    };
  }
}

/**
 * Factory function to create argument processor
 */
export function createArgumentParser(logger: Logger): ArgumentParser {
  return new ArgumentParser(logger);
}
