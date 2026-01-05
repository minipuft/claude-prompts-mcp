// @lifecycle canonical - Custom error types for inline script reference resolution.
/**
 * Script Reference Resolution Errors
 *
 * Custom error types for handling failures during {{script:id}} resolution.
 * All errors are blocking - script failures prevent template rendering.
 */

/**
 * Base error class for all script reference resolution errors.
 */
export class ScriptReferenceError extends Error {
  constructor(
    message: string,
    public readonly scriptId: string
  ) {
    super(message);
    this.name = 'ScriptReferenceError';
    // V8-specific API for cleaner stack traces (may not exist in all environments)
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a script ID is not registered in any known location.
 * Scripts must exist in:
 * - Prompt-local: prompts/{category}/{prompt_id}/tools/{script_id}/
 * - Workspace: ${workspace}/resources/scripts/{script_id}/
 */
export class ScriptNotRegisteredError extends ScriptReferenceError {
  constructor(
    scriptId: string,
    public readonly searchedPaths: string[]
  ) {
    super(`Script "${scriptId}" not found. Searched: ${searchedPaths.join(', ')}`, scriptId);
    this.name = 'ScriptNotRegisteredError';
  }
}

/**
 * Thrown when script execution fails (non-zero exit code or runtime error).
 */
export class ScriptExecutionFailedError extends ScriptReferenceError {
  constructor(
    scriptId: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly originalError?: Error
  ) {
    const exitInfo = exitCode !== null ? `exit code ${exitCode}` : 'execution error';
    const errorDetail = stderr !== '' ? stderr : (originalError?.message ?? 'Unknown error');
    super(`Script "${scriptId}" failed (${exitInfo}): ${errorDetail}`, scriptId);
    this.name = 'ScriptExecutionFailedError';
  }
}

/**
 * Thrown when attempting to access a field that doesn't exist in script output.
 *
 * @example
 * // Script returns { "count": 42, "status": "ok" }
 * // Template uses {{script:analyzer.missing_field}}
 * throw new InvalidFieldAccessError('analyzer', 'missing_field', ['count', 'status']);
 */
export class InvalidFieldAccessError extends ScriptReferenceError {
  constructor(
    scriptId: string,
    public readonly requestedField: string,
    public readonly availableFields: string[]
  ) {
    super(
      `Field "${requestedField}" not found in script "${scriptId}" output. Available: ${availableFields.join(', ')}`,
      scriptId
    );
    this.name = 'InvalidFieldAccessError';
  }
}

/**
 * Thrown when script output is not valid JSON.
 */
export class InvalidScriptOutputError extends ScriptReferenceError {
  constructor(
    scriptId: string,
    public readonly rawOutput: string,
    public readonly parseError: string
  ) {
    super(`Script "${scriptId}" output is not valid JSON: ${parseError}`, scriptId);
    this.name = 'InvalidScriptOutputError';
  }
}

/**
 * Thrown when a script ID contains invalid characters or path traversal attempts.
 */
export class InvalidScriptIdError extends ScriptReferenceError {
  constructor(scriptId: string, reason: string) {
    super(`Invalid script ID "${scriptId}": ${reason}`, scriptId);
    this.name = 'InvalidScriptIdError';
  }
}
