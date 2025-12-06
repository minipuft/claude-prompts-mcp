// @lifecycle canonical - Shared error helpers that surface structured MCP responses.
/**
 * Consolidated Error Handling System
 * Combines basic error classes with MCP structured response capabilities
 */

// Define StructuredToolResponse locally to avoid circular dependency
interface StructuredToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  metadata?: {
    tool: string;
    action: string;
    timestamp: string;
    executionTime?: number;
    framework?: string;
    errorCode?: string;
    [key: string]: unknown;
  };
}

// Error context interface for enhanced error handling
export interface ErrorContext {
  tool?: string;
  action?: string;
  operation?: string;
  userInput?: unknown;
  suggestions?: string[];
  recoveryOptions?: string[];

  // Extended properties for MCP compatibility
  systemState?: {
    framework?: string;
    memoryUsage?: number;
    uptime?: number;
  };
  errorType?: 'validation' | 'execution' | 'system' | 'client' | 'configuration';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  suggestedActions?: string[];
  relatedComponents?: string[];
  details?: any;
}

// Validation result types
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    field: string;
    message: string;
    code: string;
    suggestion?: string;
    example?: string;
  }>;
  warnings?: Array<{
    field: string;
    message: string;
    suggestion?: string;
  }>;
}

/**
 * Base error class with MCP structured response capability
 */
export abstract class BaseError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly timestamp: string;

  constructor(message: string, code: string, context: ErrorContext = {}) {
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
      content: [
        {
          type: 'text',
          text: this.getEnhancedMessage(),
        },
      ],
      isError: true,
      metadata: {
        tool: this.context.tool || 'unknown',
        action: this.context.action || 'unknown',
        timestamp: this.timestamp,
        errorCode: this.code,
      },
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

// Custom error classes extending BaseError
export class PromptError extends BaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'PROMPT_ERROR', context);
  }
}

export class ArgumentError extends BaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'ARGUMENT_ERROR', context);
  }
}

export class ValidationError extends BaseError {
  public readonly validationResult?: ValidationResult;
  public readonly validationErrors?: string[]; // Keep for backwards compatibility

  constructor(
    message: string,
    validationErrorsOrContext?: string[] | ErrorContext,
    validationResult?: ValidationResult
  ) {
    // Handle backwards compatibility with old constructor signature
    let context: ErrorContext = {};
    let validationErrors: string[] | undefined;

    if (Array.isArray(validationErrorsOrContext)) {
      // Old signature: (message, validationErrors)
      validationErrors = validationErrorsOrContext;
    } else if (validationErrorsOrContext) {
      // New signature: (message, context, validationResult)
      context = validationErrorsOrContext;
    }

    super(message, 'VALIDATION_ERROR', context);
    this.validationErrors = validationErrors;
    this.validationResult = validationResult;
  }

  getEnhancedMessage(): string {
    let message = super.getEnhancedMessage();

    // Enhanced validation error details
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

    // Backwards compatibility with old validationErrors array
    if (this.validationErrors && this.validationErrors.length > 0) {
      message += `\n**Legacy Validation Errors**: ${this.validationErrors.join(', ')}\n`;
    }

    return message;
  }
}

// Additional specialized error classes
export class ConfigError extends BaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'CONFIG_ERROR', {
      ...context,
      suggestions: context.suggestions || [
        'Check your configuration file syntax and required fields',
        'See config documentation for valid options',
      ],
    });
  }
}

export class FrameworkError extends BaseError {
  constructor(message: string, context: ErrorContext = {}) {
    super(message, 'FRAMEWORK_ERROR', {
      ...context,
      suggestions: context.suggestions || [
        'Verify framework is enabled and properly configured',
        'See framework documentation for setup instructions',
      ],
    });
  }
}

export class ExecutionError extends BaseError {
  public readonly executionContext?: Record<string, unknown>;

  constructor(
    message: string,
    context: ErrorContext = {},
    executionContext?: Record<string, unknown>
  ) {
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

// Logger interface to ensure compatibility with the existing logger
export interface Logger {
  info: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

/**
 * Enhanced error handler with recovery strategies and MCP support
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private retryStrategies = new Map<string, (error: BaseError) => boolean>();

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
    if (error instanceof BaseError) {
      return error.toStructuredResponse();
    }

    // Convert unknown errors to BaseError
    const message = error instanceof Error ? error.message : String(error);
    const baseError = new (class extends BaseError {
      constructor(message: string, code: string, context: ErrorContext) {
        super(message, code, context);
      }
    })(message, 'UNKNOWN_ERROR', {
      ...context,
      suggestions: ['An unexpected error occurred. Please try again or contact support.'],
      recoveryOptions: ['Try the operation again', 'Check system status', 'Contact support'],
    });

    return baseError.toStructuredResponse();
  }

  /**
   * Create validation error with enhanced context
   */
  createValidationError(
    message: string,
    context: ErrorContext,
    validationResult?: ValidationResult
  ): ValidationError {
    return new ValidationError(message, context, validationResult);
  }

  /**
   * Add retry strategy for specific error patterns
   */
  addRetryStrategy(errorCode: string, strategy: (error: BaseError) => boolean): void {
    this.retryStrategies.set(errorCode, strategy);
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: BaseError): boolean {
    const strategy = this.retryStrategies.get(error.code);
    return strategy
      ? strategy(error)
      : Boolean(error.context.recoveryOptions && error.context.recoveryOptions.length > 0);
  }

  /**
   * Setup default retry strategies
   */
  private setupDefaultRetryStrategies(): void {
    this.addRetryStrategy('VALIDATION_ERROR', () => false); // User must fix input
    this.addRetryStrategy('CONFIG_ERROR', () => false); // User must fix config
    this.addRetryStrategy('FRAMEWORK_ERROR', (error) =>
      Boolean(error.context.recoveryOptions && error.context.recoveryOptions.length > 0)
    );
    this.addRetryStrategy('EXECUTION_ERROR', (error) =>
      Boolean(error.context.recoveryOptions && error.context.recoveryOptions.length > 0)
    );
  }
}

/**
 * Validation helper functions
 */
export class ValidationHelpers {
  /**
   * Create validation result from errors
   */
  static createValidationResult(
    errors: Array<{
      field: string;
      message: string;
      code: string;
      suggestion?: string;
      example?: string;
    }>
  ): ValidationResult {
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
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

    requiredFields.forEach((field) => {
      if (
        !(field in data) ||
        data[field] === undefined ||
        data[field] === null ||
        data[field] === ''
      ) {
        errors.push({
          field,
          message: `Field '${field}' is required but was not provided`,
          code: 'REQUIRED_FIELD_MISSING',
          suggestion: `Please provide a value for '${field}'`,
          example: `"${field}": "example_value"`,
        });
      }
    });

    return this.createValidationResult(errors || []);
  }

  /**
   * Create "did you mean" suggestions for typos
   */
  static createDidYouMeanSuggestion(input: string, validOptions: string[]): string | undefined {
    const suggestions = validOptions.filter(
      (option) => this.levenshteinDistance(input.toLowerCase(), option.toLowerCase()) <= 2
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
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

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

// Standardized error handling (backwards compatible)
export function handleError(
  error: unknown,
  context: string,
  logger: Logger
): { message: string; isError: boolean } {
  // Enhanced handling with new error types
  if (error instanceof BaseError) {
    const logLevel =
      error.code === 'VALIDATION_ERROR' || error.code === 'ARGUMENT_ERROR' ? 'warn' : 'error';
    logger[logLevel](`${context}: ${error.message}`);
    return { message: error.getEnhancedMessage(), isError: error.code !== 'ARGUMENT_ERROR' };
  } else if (error instanceof PromptError) {
    logger.error(`${context}: ${error.message}`);
    return { message: error.message, isError: true };
  } else if (error instanceof ArgumentError) {
    logger.warn(`${context}: ${error.message}`);
    return { message: error.message, isError: false };
  } else if (error instanceof ValidationError) {
    logger.warn(`${context}: ${error.message}`);
    const errors = error.validationErrors ? `: ${error.validationErrors.join(', ')}` : '';
    return { message: `${error.message}${errors}`, isError: false };
  } else {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`${context}: ${errorMessage}`);
    return { message: `Unexpected error: ${errorMessage}`, isError: true };
  }
}
