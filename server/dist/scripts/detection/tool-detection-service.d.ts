/**
 * Tool Detection Service
 *
 * Analyzes user input and prompt arguments to detect which script tools
 * should be invoked during prompt execution.
 *
 * Uses deterministic trigger types (like GitHub Actions, AWS Lambda, Terraform):
 * - schema_match: Execute when user args validate against schema (default)
 * - explicit: Execute only when user writes tool:<id>
 * - always: Execute on every prompt run regardless of args
 * - never: Tool is defined but intentionally disabled
 *
 * Detection Priority (for sorting, NOT fuzzy confidence):
 * - 1.0: Explicit request (tool:<id>) or trigger: 'always'
 * - 0.9: Full schema match (all required params present)
 * - 0.8: Partial schema match (strict: false, some params present)
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */
import type { LoadedScriptTool, ToolDetectionMatch } from '../types.js';
/**
 * Configuration for the ToolDetectionService.
 */
export interface ToolDetectionConfig {
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Tool Detection Service
 *
 * Matches user input to available script tools using deterministic triggers.
 * Unlike probabilistic confidence scores, this uses binary matching:
 * - Match = tool should execute
 * - No match = tool should not execute
 *
 * @example
 * ```typescript
 * const service = new ToolDetectionService();
 *
 * const matches = service.detectTools(
 *   'analyze the data.csv file',
 *   { file: 'data.csv' },
 *   loadedTools
 * );
 *
 * for (const match of matches) {
 *   console.log(`Tool ${match.toolId} matched (${match.matchReason})`);
 * }
 * ```
 */
export declare class ToolDetectionService {
    private readonly debug;
    constructor(config?: ToolDetectionConfig);
    /**
     * Detect which tools should be invoked based on user input.
     *
     * Uses deterministic trigger types (not probabilistic confidence):
     * - trigger: 'never' - tool is disabled, never matches
     * - trigger: 'explicit' - requires explicit tool:<id> arg
     * - trigger: 'always' - matches regardless of args
     * - trigger: 'schema_match' (default) - matches by schema validation
     *
     * @param input - Raw command input string
     * @param args - Parsed prompt arguments
     * @param availableTools - Tools available for this prompt
     * @returns Array of matches sorted by priority (highest first)
     */
    detectTools(input: string, args: Record<string, unknown>, availableTools: LoadedScriptTool[]): ToolDetectionMatch[];
    /**
     * Extract explicit tool requests from args (tool:<id> pattern).
     *
     * @param args - Parsed prompt arguments
     * @returns Set of explicitly requested tool IDs (lowercase)
     */
    private extractExplicitToolRequests;
    /**
     * Get execution config with defaults applied.
     */
    private getExecutionConfig;
    /**
     * Match a tool considering its trigger type configuration.
     *
     * Deterministic trigger types (not probabilistic):
     * - never: Tool is disabled, never matches
     * - explicit: Only matches with tool:<id> arg
     * - always: Always matches (logging, metrics, setup tools)
     * - schema_match: Matches when args validate against schema
     *
     * Note: The `confirm` option is handled downstream in ExecutionModeService,
     * not during detection. Detection determines IF a tool matches, not
     * whether to ask for confirmation.
     */
    private matchToolWithTrigger;
    /**
     * Extract inputs for a tool from user arguments.
     *
     * Maps user-provided arguments to the tool's expected schema parameters,
     * handling common naming variations. Empty placeholders are filtered out.
     *
     * @param args - User-provided arguments
     * @param tool - Target tool
     * @returns Extracted inputs for the tool (excludes empty placeholders)
     */
    extractInputs(args: Record<string, unknown>, tool: LoadedScriptTool): Record<string, unknown>;
    /**
     * Find an argument value that could match a schema property.
     *
     * Handles common naming variations (camelCase, snake_case, etc.)
     * Empty strings are treated as "not present" since they're often placeholder values.
     */
    private findArgValue;
    /**
     * Check if a value is an empty placeholder from prompt template defaults.
     * Empty strings and empty arrays are considered placeholders.
     */
    private isEmptyPlaceholder;
    /**
     * Generate common naming variations for a property name.
     */
    private getNameVariations;
    /**
     * Match a tool by validating args against its JSON Schema.
     *
     * Implements strict mode:
     * - strict: false (default) - match if ANY required param present and valid
     * - strict: true - match only if ALL required params present and valid
     *
     * @param args - User-provided arguments
     * @param tool - Tool to match against
     * @param strict - Whether to require all params (default: false)
     * @returns Match result or null if no match
     */
    private matchToolBySchema;
    /**
     * Create a detection match result.
     *
     * @param tool - Matched tool
     * @param priority - Priority score for sorting (1.0 = highest)
     * @param matchReason - Why the tool matched
     * @param args - User-provided arguments
     * @param matchedParams - Which schema params were matched
     * @param missingParams - Which required params are missing
     */
    private createMatch;
}
/**
 * Factory function with default configuration.
 */
export declare function createToolDetectionService(config?: ToolDetectionConfig): ToolDetectionService;
/**
 * Get the default ToolDetectionService instance.
 * Creates one if it doesn't exist.
 */
export declare function getDefaultToolDetectionService(): ToolDetectionService;
/**
 * Reset the default service (useful for testing).
 */
export declare function resetDefaultToolDetectionService(): void;
