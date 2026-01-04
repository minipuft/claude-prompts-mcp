/**
 * Prompt Reference Resolution Errors
 *
 * Custom error types for handling failures during {{ref:prompt_id}} resolution.
 * Each error provides context about what failed and where.
 */
/**
 * Base error class for all reference resolution errors.
 */
export declare class PromptReferenceError extends Error {
    readonly promptId: string;
    constructor(message: string, promptId: string);
}
/**
 * Thrown when a referenced prompt ID does not exist in the registry.
 */
export declare class PromptNotFoundError extends PromptReferenceError {
    constructor(promptId: string);
}
/**
 * Thrown when a circular reference is detected in the resolution chain.
 *
 * @example
 * // prompt_a references prompt_b, which references prompt_a
 * throw new CircularReferenceError(['prompt_a', 'prompt_b', 'prompt_a']);
 */
export declare class CircularReferenceError extends PromptReferenceError {
    readonly chain: string[];
    constructor(chain: string[]);
}
/**
 * Thrown when the maximum reference nesting depth is exceeded.
 */
export declare class MaxDepthExceededError extends PromptReferenceError {
    readonly depth: number;
    readonly maxDepth: number;
    constructor(promptId: string, depth: number, maxDepth: number);
}
/**
 * Thrown when a script execution fails during reference resolution.
 */
export declare class ScriptExecutionError extends PromptReferenceError {
    readonly toolId: string;
    readonly originalError: Error;
    constructor(promptId: string, toolId: string, originalError: Error);
}
/**
 * Thrown when template rendering fails for a referenced prompt.
 */
export declare class ReferenceRenderError extends PromptReferenceError {
    readonly originalError: Error;
    constructor(promptId: string, originalError: Error);
}
