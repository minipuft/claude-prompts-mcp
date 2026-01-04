/**
 * Script Reference Resolution Errors
 *
 * Custom error types for handling failures during {{script:id}} resolution.
 * All errors are blocking - script failures prevent template rendering.
 */
/**
 * Base error class for all script reference resolution errors.
 */
export declare class ScriptReferenceError extends Error {
    readonly scriptId: string;
    constructor(message: string, scriptId: string);
}
/**
 * Thrown when a script ID is not registered in any known location.
 * Scripts must exist in:
 * - Prompt-local: prompts/{category}/{prompt_id}/tools/{script_id}/
 * - Workspace: ${workspace}/resources/scripts/{script_id}/
 */
export declare class ScriptNotRegisteredError extends ScriptReferenceError {
    readonly searchedPaths: string[];
    constructor(scriptId: string, searchedPaths: string[]);
}
/**
 * Thrown when script execution fails (non-zero exit code or runtime error).
 */
export declare class ScriptExecutionFailedError extends ScriptReferenceError {
    readonly exitCode: number | null;
    readonly stderr: string;
    readonly originalError?: Error | undefined;
    constructor(scriptId: string, exitCode: number | null, stderr: string, originalError?: Error | undefined);
}
/**
 * Thrown when attempting to access a field that doesn't exist in script output.
 *
 * @example
 * // Script returns { "count": 42, "status": "ok" }
 * // Template uses {{script:analyzer.missing_field}}
 * throw new InvalidFieldAccessError('analyzer', 'missing_field', ['count', 'status']);
 */
export declare class InvalidFieldAccessError extends ScriptReferenceError {
    readonly requestedField: string;
    readonly availableFields: string[];
    constructor(scriptId: string, requestedField: string, availableFields: string[]);
}
/**
 * Thrown when script output is not valid JSON.
 */
export declare class InvalidScriptOutputError extends ScriptReferenceError {
    readonly rawOutput: string;
    readonly parseError: string;
    constructor(scriptId: string, rawOutput: string, parseError: string);
}
/**
 * Thrown when a script ID contains invalid characters or path traversal attempts.
 */
export declare class InvalidScriptIdError extends ScriptReferenceError {
    constructor(scriptId: string, reason: string);
}
