/**
 * Enhanced Error Handling Framework for MCP Tools
 *
 * Provides standardized error classes, recovery strategies, and enhanced error messages
 * with actionable suggestions for better user experience.
 */

import { ErrorContext, StructuredToolResponse } from './types/shared-types.js';
import type { ValidationResult, ValidationError, ValidationWarning } from '../execution/types.js';

/**
 * Base class for all MCP tool errors
 */
export abstract class MCPToolError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly timestamp: string;

  constructor(message: string, code: string, context: ErrorContext) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get structured error response for MCP protocol
   */
  toStructuredResponse(): StructuredToolResponse {
    return {
      content: [{
        type: "text",
        text: this.getEnhancedMessage()
      }],
      isError: true,
      metadata: {
        tool: this.context.tool || 'unknown',
        action: this.context.action || 'unknown',
        timestamp: this.timestamp,
        errorCode: this.code
      }
    };
  }

  /**
   * Get enhanced error message with context and suggestions
   */
  getEnhancedMessage(): string {
    let message = `❌ **${this.message}**\n\n`;

    // Show available context information
    if (this.context.action) {
      message += `**Action**: ${this.context.action}\n`;
    }
    if (this.context.operation) {
      message += `**Operation**: ${this.context.operation}\n`;
    }
    if (this.context.userInput !== undefined) {
      message += `**Input**: ${JSON.stringify(this.context.userInput)}\n\n`;
    }

    if (this.context.suggestions && this.context.suggestions.length > 0) {
      message += `💡 **Suggestions**:\n`;
      this.context.suggestions.forEach((suggestion, index) => {
        message += `${index + 1}. ${suggestion}\n`;
      });
      message += '\n';
    }

    if (this.context.recoveryOptions && this.context.recoveryOptions.length > 0) {
      message += `🔄 **Recovery Options**:\n`;
      this.context.recoveryOptions.forEach((option, index) => {
        message += `${index + 1}. ${option}\n`;
      });
    } else {
      message += `⚠️ **Impact**: Please contact support if the issue persists.\n`;
    }

    return message;
  }
}

/**
 * Validation error with enhanced context
 */
export class EnhancedValidationError extends MCPToolError {
  public readonly validationResult?: ValidationResult;

  constructor(message: string, context: ErrorContext, validationResult?: ValidationResult) {
    super(message, 'VALIDATION_ERROR', context);
    this.validationResult = validationResult;
  }

  getEnhancedMessage(): string {
    let message = super.getEnhancedMessage();

    if (this.validationResult?.errors) {
      message += `\n**Validation Errors**:\n`;
      this.validationResult.errors.forEach((error, index) => {
        message += `${index + 1}. **${error.field}**: ${error.message}\n`;
        if (error.suggestion) {
          message += `   💡 ${error.suggestion}\n`;
        }
        if (error.example) {
          message += `   📝 Example: ${error.example}\n`;
        }
      });
    }

    if (this.validationResult?.warnings) {
      message += `\n**Warnings**:\n`;
      this.validationResult.warnings.forEach((warning, index) => {
        message += `${index + 1}. **${warning.field}**: ${warning.message}\n`;
        if (warning.suggestion) {
          message += `   💡 ${warning.suggestion}\n`;
        }
      });
    }

    return message;
  }
}

/**
 * Configuration error with specific config guidance
 */
export class ConfigError extends MCPToolError {
  constructor(message: string, context: ErrorContext) {
    super(message, 'CONFIG_ERROR', {
      ...context,
      suggestions: context.suggestions || ["Check your configuration file syntax and required fields", "See config documentation for valid options"]
    });
  }
}

/**
 * Framework error for framework-related issues
 */
export class FrameworkError extends MCPToolError {
  constructor(message: string, context: ErrorContext) {
    super(message, 'FRAMEWORK_ERROR', {
      ...context,
      suggestions: context.suggestions || ["Verify framework is enabled and properly configured", "See framework documentation for setup instructions"]
    });
  }
}

/**
 * Execution error for prompt/chain execution failures
 */
export class ExecutionError extends MCPToolError {
  public readonly executionContext?: Record<string, unknown>;

  constructor(message: string, context: ErrorContext, executionContext?: Record<string, unknown>) {
    super(message, 'EXECUTION_ERROR', context);
    this.executionContext = executionContext;
  }

  getEnhancedMessage(): string {
    let message = super.getEnhancedMessage();

    if (this.executionContext) {
      message += `\n**Execution Context**:\n`;
      Object.entries(this.executionContext).forEach(([key, value]) => {
        message += `- **${key}**: ${JSON.stringify(value)}\n`;
      });
    }

    return message;
  }
}

/**
 * Enhanced error handler with recovery strategies
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private retryStrategies = new Map<string, (error: MCPToolError) => boolean>();

  private constructor() {
    this.setupDefaultRetryStrategies();
  }

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle error with context and return structured response
   */
  handleError(error: unknown, context: ErrorContext): StructuredToolResponse {
    if (error instanceof MCPToolError) {
      return error.toStructuredResponse();
    }

    // Convert unknown errors to MCPToolError
    const message = error instanceof Error ? error.message : String(error);
    const mcpError = new (class extends MCPToolError {
      constructor(message: string, code: string, context: ErrorContext) {
        super(message, code, context);
      }
    })(message, 'UNKNOWN_ERROR', {
      ...context,
      suggestions: ["An unexpected error occurred. Please try again or contact support."],
      recoveryOptions: ["Try the operation again", "Check system status", "Contact support"]
    });

    return mcpError.toStructuredResponse();
  }

  /**
   * Create validation error with enhanced context
   */
  createValidationError(
    message: string,
    context: ErrorContext,
    validationResult?: ValidationResult
  ): EnhancedValidationError {
    return new EnhancedValidationError(message, context, validationResult);
  }

  /**
   * Add retry strategy for specific error patterns
   */
  addRetryStrategy(errorCode: string, strategy: (error: MCPToolError) => boolean): void {
    this.retryStrategies.set(errorCode, strategy);
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: MCPToolError): boolean {
    const strategy = this.retryStrategies.get(error.code);
    return strategy ? strategy(error) : Boolean(error.context.recoveryOptions && error.context.recoveryOptions.length > 0);
  }

  /**
   * Setup default retry strategies
   */
  private setupDefaultRetryStrategies(): void {
    this.addRetryStrategy('VALIDATION_ERROR', () => false); // User must fix input
    this.addRetryStrategy('CONFIG_ERROR', () => false); // User must fix config
    this.addRetryStrategy('FRAMEWORK_ERROR', (error) => Boolean(error.context.recoveryOptions && error.context.recoveryOptions.length > 0));
    this.addRetryStrategy('EXECUTION_ERROR', (error) => Boolean(error.context.recoveryOptions && error.context.recoveryOptions.length > 0));
  }
}

/**
 * Validation helper functions
 */
export class ValidationHelpers {
  /**
   * Create validation result from errors
   */
  static createValidationResult(errors: Array<{
    field: string;
    message: string;
    code: string;
    suggestion?: string;
    example?: string;
  }>): ValidationResult {
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Validate required fields with enhanced messages
   */
  static validateRequiredFields(
    data: Record<string, unknown>,
    requiredFields: string[]
  ): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    requiredFields.forEach(field => {
      if (!(field in data) || data[field] === undefined || data[field] === null || data[field] === '') {
        errors!.push({
          field,
          message: `Field '${field}' is required but was not provided`,
          code: 'REQUIRED_FIELD_MISSING',
          suggestion: `Please provide a value for '${field}'`,
          example: `"${field}": "example_value"`
        });
      }
    });

    return this.createValidationResult(errors || []);
  }

  /**
   * Create "did you mean" suggestions for typos
   */
  static createDidYouMeanSuggestion(input: string, validOptions: string[]): string | undefined {
    const suggestions = validOptions.filter(option =>
      this.levenshteinDistance(input.toLowerCase(), option.toLowerCase()) <= 2
    );

    if (suggestions.length > 0) {
      return `Did you mean: ${suggestions.slice(0, 3).join(', ')}?`;
    }

    return undefined;
  }

  /**
   * Calculate Levenshtein distance for typo detection
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i += 1) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j += 1) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }
}

// Export default error handler instance
export const errorHandler = ErrorHandler.getInstance();