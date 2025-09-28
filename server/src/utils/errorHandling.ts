// Error handling utilities

// Custom error classes
export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptError';
  }
}

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentError';
  }
}

export class ValidationError extends Error {
  validationErrors?: string[];
  
  constructor(message: string, validationErrors?: string[]) {
    super(message);
    this.name = 'ValidationError';
    this.validationErrors = validationErrors;
  }
}

// Logger interface to ensure compatibility with the existing logger
export interface Logger {
  info: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

// Standardized error handling
export function handleError(
  error: unknown, 
  context: string, 
  logger: Logger
): { message: string; isError: boolean } {
  if (error instanceof PromptError) {
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