// @lifecycle canonical - Smart detection service for prompt-scoped script tools.
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

import { DEFAULT_EXECUTION_CONFIG } from '../types.js';

import type {
  LoadedScriptTool,
  ToolDetectionMatch,
  ToolMatchReason,
  JSONSchemaDefinition,
  ExecutionConfig,
} from '../types.js';

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
export class ToolDetectionService {
  private readonly debug: boolean;

  constructor(config: ToolDetectionConfig = {}) {
    this.debug = config.debug ?? false;

    if (this.debug) {
      console.error('[ToolDetectionService] Initialized with deterministic trigger system');
    }
  }

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
  detectTools(
    input: string,
    args: Record<string, unknown>,
    availableTools: LoadedScriptTool[]
  ): ToolDetectionMatch[] {
    const matches: ToolDetectionMatch[] = [];
    const explicitTools = this.extractExplicitToolRequests(args);

    for (const tool of availableTools) {
      // Skip disabled tools
      if (tool.enabled === false) {
        continue;
      }

      const execution = this.getExecutionConfig(tool);
      const isExplicit = explicitTools.has(tool.id.toLowerCase());

      // Handle trigger types (deterministic matching)
      const match = this.matchToolWithTrigger(input, args, tool, execution, isExplicit);
      if (match === null) {
        continue;
      }

      // Annotate match with execution info (confirm defaults to true for safety)
      match.requiresConfirmation = execution.confirm ?? true;
      match.explicitRequest = isExplicit;
      matches.push(match);
    }

    // Sort by priority descending (explicit > full match > partial match)
    matches.sort((a, b) => b.priority - a.priority);

    if (this.debug && matches.length > 0) {
      console.error(
        '[ToolDetectionService] Detected tools:',
        matches.map(
          (m) =>
            `${m.toolId} (${m.matchReason}, confirm=${m.requiresConfirmation}, explicit=${m.explicitRequest})`
        )
      );
    }

    return matches;
  }

  /**
   * Extract explicit tool requests from args (tool:<id> pattern).
   *
   * @param args - Parsed prompt arguments
   * @returns Set of explicitly requested tool IDs (lowercase)
   */
  private extractExplicitToolRequests(args: Record<string, unknown>): Set<string> {
    const requested = new Set<string>();

    // Check for tool:<id> keys
    for (const key of Object.keys(args)) {
      if (key.toLowerCase().startsWith('tool:')) {
        const toolId = key.slice(5).toLowerCase();
        if (toolId !== '') {
          requested.add(toolId);
        }
      }
    }

    // Check for explicit 'tool' or 'tool_id' arg
    const explicitTool = args['tool'] ?? args['tool_id'] ?? args['toolId'];
    if (typeof explicitTool === 'string') {
      requested.add(explicitTool.toLowerCase());
    }

    // Check for comma-separated tool list
    if (typeof explicitTool === 'string' && explicitTool.includes(',')) {
      for (const part of explicitTool.split(',')) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed !== '') {
          requested.add(trimmed);
        }
      }
    }

    return requested;
  }

  /**
   * Get execution config with defaults applied.
   */
  private getExecutionConfig(tool: LoadedScriptTool): ExecutionConfig {
    return {
      ...DEFAULT_EXECUTION_CONFIG,
      ...tool.execution,
    };
  }

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
  private matchToolWithTrigger(
    input: string,
    args: Record<string, unknown>,
    tool: LoadedScriptTool,
    execution: ExecutionConfig,
    isExplicit: boolean
  ): ToolDetectionMatch | null {
    const { trigger, strict } = execution;

    // Never trigger: tool is intentionally disabled
    if (trigger === 'never') {
      if (this.debug) {
        console.error(`[ToolDetectionService] Tool '${tool.id}' has trigger: never, skipping`);
      }
      return null;
    }

    // Explicit tool request (via tool:<id> arg) always matches with highest priority
    // This takes precedence over trigger type for user-initiated requests
    if (isExplicit) {
      return this.createMatch(tool, 1.0, 'name_match', args, [], []);
    }

    // Handle trigger types for non-explicit matches
    switch (trigger) {
      case 'explicit':
        // Only match if user explicitly named the tool (already handled above)
        return null;

      case 'always':
        // Always create a match with highest priority
        return this.createMatch(tool, 1.0, 'always_match', args, [], []);

      case 'schema_match':
      default:
        // Schema-based detection with strict mode support
        return this.matchToolBySchema(args, tool, strict ?? false);
    }
  }

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
  extractInputs(args: Record<string, unknown>, tool: LoadedScriptTool): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const schema = tool.inputSchema;

    if (!schema.properties) {
      // No schema properties - pass all args through, filtering empty placeholders
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args)) {
        if (!this.isEmptyPlaceholder(value)) {
          filtered[key] = value;
        }
      }
      return filtered;
    }

    // Map each schema property to user args (findArgValue already filters empty placeholders)
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const value = this.findArgValue(args, propName, propSchema);
      if (value !== undefined) {
        inputs[propName] = value;
      }
    }

    return inputs;
  }

  /**
   * Find an argument value that could match a schema property.
   *
   * Handles common naming variations (camelCase, snake_case, etc.)
   * Empty strings are treated as "not present" since they're often placeholder values.
   */
  private findArgValue(
    args: Record<string, unknown>,
    propName: string,
    propSchema?: JSONSchemaDefinition
  ): unknown {
    // Direct match
    if (propName in args) {
      const value = args[propName];
      // Treat empty strings as "not present" - they're usually placeholders
      if (this.isEmptyPlaceholder(value)) {
        return undefined;
      }
      return value;
    }

    // Try common variations
    const variations = this.getNameVariations(propName);
    for (const variant of variations) {
      if (variant in args) {
        const value = args[variant];
        if (this.isEmptyPlaceholder(value)) {
          return undefined;
        }
        return value;
      }
    }

    // Check for aliased names in schema description
    if (propSchema?.description) {
      const aliasMatch = propSchema.description.match(/alias(?:es)?:\s*([^.]+)/i);
      if (aliasMatch?.[1]) {
        const aliases = aliasMatch[1].split(',').map((a) => a.trim().toLowerCase());
        for (const alias of aliases) {
          if (alias in args) {
            const value = args[alias];
            if (this.isEmptyPlaceholder(value)) {
              return undefined;
            }
            return value;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Check if a value is an empty placeholder from prompt template defaults.
   * Empty strings and empty arrays are considered placeholders.
   */
  private isEmptyPlaceholder(value: unknown): boolean {
    if (value === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  /**
   * Generate common naming variations for a property name.
   */
  private getNameVariations(name: string): string[] {
    const variations: string[] = [];

    // camelCase to snake_case
    const snakeCase = name.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (snakeCase !== name) {
      variations.push(snakeCase);
    }

    // snake_case to camelCase
    const camelCase = name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camelCase !== name) {
      variations.push(camelCase);
    }

    // Common short forms
    const shortForms: Record<string, string[]> = {
      file_path: ['file', 'path', 'filepath'],
      file: ['file_path', 'filepath', 'path'],
      output: ['out', 'output_path', 'outputPath'],
      input: ['in', 'input_path', 'inputPath'],
      content: ['data', 'text', 'body'],
    };

    const lowerName = name.toLowerCase();
    if (shortForms[lowerName]) {
      variations.push(...shortForms[lowerName]);
    }

    return variations;
  }

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
  private matchToolBySchema(
    args: Record<string, unknown>,
    tool: LoadedScriptTool,
    strict: boolean
  ): ToolDetectionMatch | null {
    const schema = tool.inputSchema;
    if (schema.properties === undefined || Object.keys(schema.properties).length === 0) {
      // No schema properties defined - cannot match by schema
      return null;
    }

    const required = schema.required ?? [];
    if (required.length === 0) {
      // No required fields - cannot determine match
      return null;
    }

    // Find which required parameters are present and valid
    const matchedParams: string[] = [];
    const missingParams: string[] = [];

    for (const reqField of required) {
      const value = this.findArgValue(args, reqField, schema.properties[reqField]);
      if (value !== undefined) {
        matchedParams.push(reqField);
      } else {
        missingParams.push(reqField);
      }
    }

    // Apply strict mode logic
    if (strict) {
      // Strict mode: ALL required params must be present
      if (missingParams.length > 0) {
        if (this.debug) {
          console.error(
            `[ToolDetectionService] Tool '${tool.id}' strict mode: missing params: ${missingParams.join(', ')}`
          );
        }
        return null;
      }
      // Full match - all required params present
      return this.createMatch(tool, 0.9, 'schema_match', args, matchedParams, missingParams);
    } else {
      // Non-strict mode: ANY required param present is sufficient
      if (matchedParams.length === 0) {
        return null;
      }
      // Determine priority based on match completeness
      const priority = matchedParams.length === required.length ? 0.9 : 0.8;
      return this.createMatch(tool, priority, 'schema_match', args, matchedParams, missingParams);
    }
  }

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
  private createMatch(
    tool: LoadedScriptTool,
    priority: number,
    matchReason: ToolMatchReason,
    args: Record<string, unknown>,
    matchedParams: string[],
    missingParams: string[]
  ): ToolDetectionMatch {
    return {
      toolId: tool.id,
      promptId: tool.promptId,
      priority,
      matchReason,
      extractedInputs: this.extractInputs(args, tool),
      matchedParams,
      missingParams,
    };
  }
}

/**
 * Factory function with default configuration.
 */
export function createToolDetectionService(config?: ToolDetectionConfig): ToolDetectionService {
  return new ToolDetectionService(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultService: ToolDetectionService | null = null;

/**
 * Get the default ToolDetectionService instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultToolDetectionService(): ToolDetectionService {
  if (!defaultService) {
    defaultService = new ToolDetectionService();
  }
  return defaultService;
}

/**
 * Reset the default service (useful for testing).
 */
export function resetDefaultToolDetectionService(): void {
  defaultService = null;
}
