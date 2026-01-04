/**
 * Script Reference Resolver
 *
 * Resolves {{script:id}} template references by:
 * 1. Detecting script reference patterns in templates
 * 2. Validating script is pre-registered (security)
 * 3. Parsing inline arguments
 * 4. Executing via ScriptExecutor
 * 5. Extracting .field if specified
 * 6. Replacing placeholder with JSON output (or throwing on error)
 *
 * Syntax variants:
 * - {{script:analyzer}}                    - Execute, inline full JSON
 * - {{script:analyzer.row_count}}          - Access specific field
 * - {{script:analyzer file='data.csv'}}    - Pass inline arguments
 */
import type { DetectedScriptReference, ScriptPreResolveResult, ScriptResolutionOptions } from './script-reference-types.js';
import type { Logger } from '../../logging/index.js';
import type { ScriptExecutionResult, LoadedScriptTool } from '../../scripts/types.js';
/**
 * Interface for script loader (injected dependency).
 * Abstracts the script discovery mechanism.
 */
export interface IScriptLoader {
    /**
     * Check if a script exists and is loadable.
     */
    scriptExists(scriptId: string, promptDir?: string): boolean;
    /**
     * Load a script definition by ID.
     */
    loadScript(scriptId: string, promptDir?: string): LoadedScriptTool | undefined;
    /**
     * Get paths that were searched for diagnostics.
     */
    getSearchedPaths(scriptId: string, promptDir?: string): string[];
}
/**
 * Interface for script executor (injected dependency).
 */
export interface IScriptExecutorService {
    execute(request: {
        toolId: string;
        promptId: string;
        inputs: Record<string, unknown>;
        timeout?: number;
    }, tool: LoadedScriptTool): Promise<ScriptExecutionResult>;
}
/**
 * Resolves {{script:id}} references in templates.
 */
export declare class ScriptReferenceResolver {
    private readonly logger;
    private readonly scriptLoader;
    private readonly scriptExecutor;
    private readonly options;
    constructor(logger: Logger, scriptLoader: IScriptLoader, scriptExecutor: IScriptExecutorService, options?: ScriptResolutionOptions);
    /**
     * Pre-resolve all {{script:...}} patterns in a template before Nunjucks processing.
     *
     * @param template - Template string potentially containing {{script:...}} patterns
     * @param context - Context variables (passed to scripts as additional inputs)
     * @param promptDir - Optional prompt directory for prompt-local script lookup
     * @returns Template with references replaced and script results
     */
    preResolve(template: string, context: Record<string, unknown>, promptDir?: string): Promise<ScriptPreResolveResult>;
    /**
     * Build a cache key for script execution results.
     * Same script + field access + inline args = same cache key.
     */
    private buildCacheKey;
    /**
     * Resolve a single script reference.
     *
     * @param ref - Detected script reference
     * @param context - Context variables
     * @param promptDir - Optional prompt directory for prompt-local lookup
     * @returns Resolved output string and execution result
     */
    private resolveScriptReference;
    /**
     * Detect all {{script:...}} patterns in a template.
     */
    detectScriptReferences(template: string): DetectedScriptReference[];
    /**
     * Check if a template contains any {{script:...}} patterns.
     */
    hasScriptReferences(template: string): boolean;
    /**
     * Validate script ID for security.
     * Rejects invalid characters and path traversal attempts.
     */
    private validateScriptId;
    /**
     * Format output value as a string for template insertion.
     */
    private formatOutput;
}
