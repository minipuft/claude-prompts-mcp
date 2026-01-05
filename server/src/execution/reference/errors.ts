// @lifecycle canonical - Custom error types for prompt reference resolution.
/**
 * Prompt Reference Resolution Errors
 *
 * Custom error types for handling failures during {{ref:prompt_id}} resolution.
 * Each error provides context about what failed and where.
 */

/**
 * Base error class for all reference resolution errors.
 */
export class PromptReferenceError extends Error {
  constructor(
    message: string,
    public readonly promptId: string
  ) {
    super(message);
    this.name = 'PromptReferenceError';
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a referenced prompt ID does not exist in the registry.
 */
export class PromptNotFoundError extends PromptReferenceError {
  constructor(promptId: string) {
    super(`Referenced prompt not found: "${promptId}"`, promptId);
    this.name = 'PromptNotFoundError';
  }
}

/**
 * Thrown when a circular reference is detected in the resolution chain.
 *
 * @example
 * // prompt_a references prompt_b, which references prompt_a
 * throw new CircularReferenceError(['prompt_a', 'prompt_b', 'prompt_a']);
 */
export class CircularReferenceError extends PromptReferenceError {
  public readonly chain: string[];

  constructor(chain: string[]) {
    const chainStr = chain.join(' -> ');
    super(`Circular reference detected: ${chainStr}`, chain[chain.length - 1] ?? '');
    this.name = 'CircularReferenceError';
    this.chain = chain;
  }
}

/**
 * Thrown when the maximum reference nesting depth is exceeded.
 */
export class MaxDepthExceededError extends PromptReferenceError {
  constructor(
    promptId: string,
    public readonly depth: number,
    public readonly maxDepth: number
  ) {
    super(
      `Maximum reference depth (${maxDepth}) exceeded at prompt "${promptId}" (current depth: ${depth})`,
      promptId
    );
    this.name = 'MaxDepthExceededError';
  }
}

/**
 * Thrown when a script execution fails during reference resolution.
 */
export class ScriptExecutionError extends PromptReferenceError {
  constructor(
    promptId: string,
    public readonly toolId: string,
    public readonly originalError: Error
  ) {
    super(
      `Script execution failed for tool "${toolId}" in prompt "${promptId}": ${originalError.message}`,
      promptId
    );
    this.name = 'ScriptExecutionError';
  }
}

/**
 * Thrown when template rendering fails for a referenced prompt.
 */
export class ReferenceRenderError extends PromptReferenceError {
  constructor(
    promptId: string,
    public readonly originalError: Error
  ) {
    super(`Failed to render referenced prompt "${promptId}": ${originalError.message}`, promptId);
    this.name = 'ReferenceRenderError';
  }
}
