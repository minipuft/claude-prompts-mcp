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
    errorType?: string;
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
  framework?: string;

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
    const metadata: StructuredToolResponse['metadata'] = {
      tool: this.context.tool || 'unknown',
      action: this.context.action || 'unknown',
      timestamp: this.timestamp,
      errorCode: this.code,
    };

    if (this.context.framework !== undefined) {
      metadata.framework = this.context.framework;
    }
    if (this.context.errorType !== undefined) {
      metadata.errorType = this.context.errorType;
    }

    return {
      content: [
        {
          type: 'text',
          text: this.getEnhancedMessage(),
        },
      ],
      isError: true,
      metadata,
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
    if (validationErrors !== undefined) {
      this.validationErrors = validationErrors;
    }
    if (validationResult !== undefined) {
      this.validationResult = validationResult;
    }
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

/**
 * Schema validation issue from ArgumentSchemaValidator
 */
export interface SchemaValidationIssue {
  argument: string;
  message: string;
  code?: string;
}

/**
 * Prompt definition for retry hint generation
 */
export interface PromptDefinitionForError {
  id: string;
  arguments: Array<{
    name: string;
    type?: string;
    required: boolean;
    validation?: {
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
  }>;
}

/**
 * Argument validation error with retry hints
 * Thrown when schema validation fails (minLength, maxLength, pattern)
 */
export class ArgumentValidationError extends BaseError {
  public readonly issues: SchemaValidationIssue[];
  public readonly promptDefinition: PromptDefinitionForError;

  constructor(issues: SchemaValidationIssue[], promptDefinition: PromptDefinitionForError) {
    super(
      ArgumentValidationError.formatMessage(issues, promptDefinition),
      'ARGUMENT_VALIDATION_ERROR',
      {
        errorType: 'validation',
        severity: 'medium',
        tool: 'prompt_engine',
        action: 'argument_validation',
        suggestions: issues.map((issue) => `Fix ${issue.argument}: ${issue.message}`),
        recoveryOptions: [`Retry with corrected arguments`],
      }
    );
    this.issues = issues;
    this.promptDefinition = promptDefinition;
  }

  /**
   * Format error message with issues and retry hint
   */
  private static formatMessage(
    issues: SchemaValidationIssue[],
    promptDefinition: PromptDefinitionForError
  ): string {
    const lines = ['Argument validation failed:'];

    for (const issue of issues) {
      lines.push(`  - ${issue.argument}: ${issue.message}`);
    }

    lines.push('');
    lines.push('Retry with:');
    lines.push(`  >>${promptDefinition.id} ${this.buildRetryHint(issues, promptDefinition)}`);

    return lines.join('\n');
  }

  /**
   * Build example invocation with valid placeholders
   */
  private static buildRetryHint(
    issues: SchemaValidationIssue[],
    promptDefinition: PromptDefinitionForError
  ): string {
    const failedArgs = new Set(issues.map((i) => i.argument));

    return promptDefinition.arguments
      .filter((arg) => arg.required || failedArgs.has(arg.name))
      .map((arg) => {
        const hint = this.getValidValueHint(arg, failedArgs.has(arg.name));
        return `${arg.name}="${hint}"`;
      })
      .join(' ');
  }

  /**
   * Generate a helpful placeholder value based on validation rules
   */
  private static getValidValueHint(
    arg: PromptDefinitionForError['arguments'][0],
    wasFailed: boolean
  ): string {
    if (!wasFailed) {
      return '<your value>';
    }

    const validation = arg.validation;
    if (!validation) {
      return '<valid value>';
    }

    // Pattern-based hint
    if (validation.pattern) {
      if (validation.pattern.includes('https://')) {
        return 'https://example.com/...';
      }
      if (validation.pattern.includes('http')) {
        return 'http://example.com/...';
      }
      return `<value matching ${validation.pattern}>`;
    }

    // Length-based hint
    if (validation.minLength && validation.maxLength) {
      return `<${validation.minLength}-${validation.maxLength} chars>`;
    }
    if (validation.minLength) {
      return `<at least ${validation.minLength} chars>`;
    }
    if (validation.maxLength) {
      return `<max ${validation.maxLength} chars>`;
    }

    return '<valid value>';
  }

  /**
   * Get enhanced message with structured retry guidance
   */
  override getEnhancedMessage(): string {
    let message = `❌ **Argument Validation Failed**\n\n`;

    message += `**Issues Found**:\n`;
    this.issues.forEach((issue, index) => {
      message += `${index + 1}. **${issue.argument}**: ${issue.message}\n`;
    });

    message += `\n**Retry Command**:\n`;
    message += `\`\`\`\n>>${this.promptDefinition.id} ${ArgumentValidationError.buildRetryHint(this.issues, this.promptDefinition)}\n\`\`\`\n`;

    message += `\n💡 **Tips**:\n`;
    message += `- Check argument values meet length and pattern requirements\n`;
    message += `- URL arguments must match the specified pattern\n`;
    message += `- Required arguments cannot be empty\n`;

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
  public readonly executionContext: Record<string, unknown> | undefined;

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
    const hasErrors = errors.length > 0;
    const result: ValidationResult = {
      valid: !hasErrors,
    };
    if (hasErrors) {
      result.errors = errors;
    }
    return result;
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
    const matrix: number[][] = Array.from({ length: str2.length + 1 }, () =>
      Array.from({ length: str1.length + 1 }, () => 0)
    );

    for (let i = 0; i <= str1.length; i += 1) {
      const firstRow = matrix[0];
      if (!firstRow) {
        continue;
      }
      firstRow[i] = i;
    }

    for (let j = 0; j <= str2.length; j += 1) {
      const row = matrix[j];
      if (!row) {
        continue;
      }
      row[0] = j;
    }

    for (let j = 1; j <= str2.length; j += 1) {
      const currentRow = matrix[j];
      const previousRow = matrix[j - 1];
      if (!currentRow || !previousRow) {
        continue;
      }

      for (let i = 1; i <= str1.length; i += 1) {
        const left = currentRow[i - 1];
        const top = previousRow[i];
        const diagonal = previousRow[i - 1];
        if (left === undefined || top === undefined || diagonal === undefined) {
          continue;
        }
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        currentRow[i] = Math.min(
          left + 1, // deletion
          top + 1, // insertion
          diagonal + indicator // substitution
        );
      }
    }

    const lastRow = matrix[str2.length];
    if (!lastRow) {
      return 0;
    }
    const lastValue = lastRow[str1.length];
    return lastValue ?? 0;
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
