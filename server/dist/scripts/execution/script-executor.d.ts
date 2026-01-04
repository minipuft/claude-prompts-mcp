/**
 * Script Executor
 *
 * Executes prompt-scoped script tools via subprocess with:
 * - Configurable timeout enforcement
 * - JSON input via stdin
 * - JSON output parsing with fallback to raw string
 * - Runtime detection (python/node/shell/auto)
 * - Input validation against JSON Schema
 *
 * Security model (trust-based, developer-focused):
 * - Working directory sandboxed to tool directory
 * - Timeout enforcement prevents runaway processes
 * - Environment variables filtered via allowlist (SAFE_ENV_ALLOWLIST)
 *   to prevent accidental credential leakage
 * - Explicit env pass-through via tool.env or request.env for intentional access
 * - No filesystem or network restrictions (trusts prompt authors)
 *
 * Design rationale: Scripts are authored by developers, version-controlled,
 * and code-reviewed. This is consistent with npm/pip script execution trust
 * models where the package author is trusted.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */
import type { LoadedScriptTool, ScriptExecutionRequest, ScriptExecutionResult, ScriptExecutorConfig, ScriptInputValidationResult, JSONSchemaDefinition } from '../types.js';
/**
 * Script Executor Service
 *
 * Handles subprocess execution of script tools with timeout enforcement,
 * JSON I/O, and proper cleanup.
 *
 * @example
 * ```typescript
 * const executor = new ScriptExecutor({ defaultTimeout: 30000 });
 *
 * const result = await executor.execute({
 *   toolId: 'analyze_csv',
 *   promptId: 'data_analyzer',
 *   inputs: { file: 'data.csv' },
 * }, loadedTool);
 *
 * if (result.success) {
 *   console.log('Output:', result.output);
 * }
 * ```
 */
export declare class ScriptExecutor {
    private readonly defaultTimeout;
    private readonly maxTimeout;
    private readonly debug;
    private readonly baseEnv;
    constructor(config?: ScriptExecutorConfig);
    /**
     * Execute a script tool with the given inputs.
     *
     * @param request - Execution request with inputs and optional overrides
     * @param tool - Loaded script tool definition
     * @returns Execution result with output, timing, and error info
     */
    execute(request: ScriptExecutionRequest, tool: LoadedScriptTool): Promise<ScriptExecutionResult>;
    /**
     * Validate inputs against the tool's JSON Schema.
     *
     * Uses basic required field validation without external dependencies.
     * Full JSON Schema validation can be added by installing 'ajv' if needed.
     *
     * @param inputs - Input values to validate
     * @param schema - JSON Schema definition
     * @returns Validation result with errors and normalized inputs
     */
    validateInputs(inputs: Record<string, unknown>, schema: JSONSchemaDefinition): ScriptInputValidationResult;
    /**
     * Get the JSON Schema type of a value.
     */
    private getJsonType;
    /**
     * Normalize JSON string inputs to their intended types based on schema.
     *
     * The ArgumentParser converts arrays/objects to JSON strings for template
     * compatibility (legacy type system expects string | number | boolean | null).
     * Script tools need the original typed values, so we parse them back here.
     *
     * This approach is schema-aware: only parses strings when the schema expects
     * an array or object type, preventing unintended parsing of actual string values.
     *
     * Additionally, empty strings for optional fields expecting objects/arrays are
     * converted to undefined to avoid type validation errors for placeholder values.
     *
     * @param inputs - Input values that may contain JSON strings
     * @param schema - JSON Schema definition with type expectations
     * @returns Normalized inputs with JSON strings parsed to their intended types
     */
    private normalizeJsonStringInputs;
    /**
     * Resolve the runtime to use for script execution.
     *
     * @param tool - Loaded script tool
     * @returns Resolved runtime identifier
     */
    private resolveRuntime;
    /**
     * Find the first available command for a runtime.
     *
     * @param runtime - Runtime identifier
     * @returns Command path or undefined if not found
     */
    private findRuntimeCommand;
    /**
     * Build environment variables for script execution.
     *
     * Uses an allowlist to filter parent process env vars, preventing
     * accidental credential leakage (e.g., API keys, tokens). Scripts
     * can still receive sensitive vars through explicit tool.env or
     * request.env configuration.
     *
     * @param request - Execution request
     * @param tool - Loaded script tool
     * @returns Combined environment variables
     */
    private buildEnvironment;
    /**
     * Resolve the timeout value with clamping.
     *
     * @param request - Execution request
     * @param tool - Loaded script tool
     * @returns Clamped timeout in milliseconds
     */
    private resolveTimeout;
    /**
     * Spawn a subprocess and handle I/O.
     */
    private spawnProcess;
    /**
     * Parse script output, attempting JSON first.
     *
     * @param stdout - Raw stdout from the process
     * @returns Parsed JSON or wrapped string output
     */
    private parseOutput;
    /**
     * Create an error result with timing.
     */
    private createErrorResult;
}
/**
 * Factory function with default configuration.
 */
export declare function createScriptExecutor(config?: ScriptExecutorConfig): ScriptExecutor;
/**
 * Get the default ScriptExecutor instance.
 * Creates one if it doesn't exist.
 */
export declare function getDefaultScriptExecutor(): ScriptExecutor;
/**
 * Reset the default executor (useful for testing).
 */
export declare function resetDefaultScriptExecutor(): void;
