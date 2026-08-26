// @lifecycle canonical - Runtime YAML loading for script tools (mirrors GateDefinitionLoader)
/**
 * Script Tool Definition Loader
 *
 * Loads script tool definitions from YAML source files at runtime,
 * following the same pattern as GateDefinitionLoader.
 *
 * Structure:
 * ```
 * prompts/{category}/{prompt_id}/
 * └── tools/
 *     └── {tool_id}/
 *         ├── tool.yaml      # Main configuration
 *         ├── schema.json    # JSON Schema for inputs
 *         ├── description.md # Tool description
 *         └── script.py      # Executable
 * ```
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of schema.json and description.md
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Per-prompt tool discovery
 *
 * @see GateDefinitionLoader for the pattern this follows
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  validateScriptToolSchema,
  type ScriptToolSchemaValidationResult,
  type ScriptToolYaml,
} from './script-schema.js';
import { DEFAULT_EXECUTION_CONFIG } from '../types.js';

import type {
  LoadedScriptTool,
  ScriptToolLoaderConfig,
  ScriptToolLoaderStats,
  ScriptToolLoadFailure,
  ScriptToolLoadReport,
  JSONSchemaDefinition,
  ExecutionConfig,
} from '../types.js';

import { loadYamlFileSync } from '#shared/utils/yaml/index.js';

// Re-export validation types
export type { ScriptToolSchemaValidationResult } from './script-schema.js';

/**
 * Internal result of one load attempt.
 *
 * Kept private to the loader: the public surface is `LoadedScriptTool | undefined`
 * for callers that only want usable tools, and `ScriptToolLoadReport` for callers
 * that must account for every tool on disk.
 */
type LoadOutcome = { ok: true; tool: LoadedScriptTool } | { ok: false; reason: string };

/**
 * Script Tool Definition Loader
 *
 * Provides runtime loading of script tool definitions from YAML source files.
 * Unlike GateDefinitionLoader which uses a global directory, this loader
 * works on a per-prompt basis, loading tools from the prompt's tools/ directory.
 *
 * @example
 * ```typescript
 * const loader = new ScriptToolDefinitionLoader();
 *
 * // Discover tools for a specific prompt
 * const toolIds = loader.discoverTools('/path/to/prompts/analysis/data_analyzer');
 * // ['analyze_csv', 'generate_chart']
 *
 * // Load a specific tool
 * const tool = loader.loadTool('/path/to/prompts/analysis/data_analyzer', 'analyze_csv');
 *
 * // Load all tools declared by a prompt
 * const tools = loader.loadToolsForPrompt('/path/to/prompts/analysis/data_analyzer', ['analyze_csv']);
 * ```
 */
export class ScriptToolDefinitionLoader {
  private cache = new Map<string, LoadedScriptTool>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;

  constructor(config: ScriptToolLoaderConfig = {}) {
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      process.stderr.write('[ScriptToolDefinitionLoader] Initialized\n');
    }
  }

  /**
   * Load a script tool definition by ID from a prompt directory.
   *
   * @param promptDir - Absolute path to the prompt directory
   * @param toolId - Tool ID (directory name under tools/)
   * @param promptId - ID of the parent prompt (for LoadedScriptTool)
   * @returns Loaded tool definition or undefined if not found
   */
  loadTool(promptDir: string, toolId: string, promptId: string): LoadedScriptTool | undefined {
    const outcome = this.loadToolOutcome(promptDir, toolId, promptId);
    return outcome.ok ? outcome.tool : undefined;
  }

  /**
   * Load a tool, keeping the reason when it fails.
   *
   * `loadTool` is the lossy view of this; callers that must account for every
   * discovered tool use this one so a drop-out carries a cause.
   */
  private loadToolOutcome(promptDir: string, toolId: string, promptId: string): LoadOutcome {
    const normalizedId = toolId.toLowerCase();
    const toolDir = join(promptDir, 'tools', normalizedId);
    const cacheKey = toolDir; // Use absolute path as cache key for uniqueness

    // Check cache first
    if (this.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        return { ok: true, tool: cached };
      }
    }

    this.stats.cacheMisses++;

    // Load from YAML directory
    const outcome = this.loadFromToolDir(toolDir, normalizedId, promptId);

    // Cache result (successes only — a failure must stay re-checkable)
    if (outcome.ok && this.enableCache) {
      this.cache.set(cacheKey, outcome.tool);
    }

    return outcome;
  }

  /**
   * Discover all available tool IDs in a prompt's tools/ directory.
   *
   * @param promptDir - Absolute path to the prompt directory
   * @returns Array of tool IDs found
   */
  discoverTools(promptDir: string): string[] {
    const toolsDir = join(promptDir, 'tools');

    if (!existsSync(toolsDir)) {
      return [];
    }

    try {
      const entries = readdirSync(toolsDir, { withFileTypes: true });
      return entries
        .filter((entry) => {
          if (!entry.isDirectory()) return false;
          // Check for tool.yaml entry point
          const toolYamlPath = join(toolsDir, entry.name, 'tool.yaml');
          return existsSync(toolYamlPath);
        })
        .map((entry) => entry.name.toLowerCase())
        .sort();
    } catch (error) {
      if (this.debug) {
        process.stderr.write(
          `[ScriptToolDefinitionLoader] Failed to discover tools in ${toolsDir}: ${String(error)}\n`
        );
      }
      return [];
    }
  }

  /**
   * Load multiple tools for a prompt.
   *
   * @param promptDir - Absolute path to the prompt directory
   * @param toolIds - Array of tool IDs to load
   * @param promptId - ID of the parent prompt
   * @returns Array of successfully loaded tools
   */
  loadToolsForPrompt(promptDir: string, toolIds: string[], promptId: string): LoadedScriptTool[] {
    const results: LoadedScriptTool[] = [];

    for (const toolId of toolIds) {
      const tool = this.loadTool(promptDir, toolId, promptId);
      if (tool) {
        results.push(tool);
      } else if (this.debug) {
        process.stderr.write(
          `[ScriptToolDefinitionLoader] Tool '${toolId}' not found for prompt '${promptId}'\n`
        );
      }
    }

    return results;
  }

  /**
   * Load all available tools for a prompt (discovery + load).
   *
   * @param promptDir - Absolute path to the prompt directory
   * @param promptId - ID of the parent prompt
   * @returns Array of all successfully loaded tools
   */
  loadAllToolsForPrompt(promptDir: string, promptId: string): LoadedScriptTool[] {
    return this.loadAllToolsForPromptDetailed(promptDir, promptId).tools;
  }

  /**
   * Load all available tools for a prompt, reporting the ones that dropped out.
   *
   * A tool present on disk but unloadable is otherwise indistinguishable from a
   * tool that was deleted — this is the boundary that keeps the two apart.
   *
   * @param promptDir - Absolute path to the prompt directory
   * @param promptId - ID of the parent prompt
   * @returns Loaded tools plus a failure entry per discovered-but-unloadable tool
   */
  loadAllToolsForPromptDetailed(promptDir: string, promptId: string): ScriptToolLoadReport {
    const tools: LoadedScriptTool[] = [];
    const failures: ScriptToolLoadFailure[] = [];

    for (const toolId of this.discoverTools(promptDir)) {
      const outcome = this.loadToolOutcome(promptDir, toolId, promptId);
      if (outcome.ok) {
        tools.push(outcome.tool);
      } else {
        failures.push({ toolId, reason: outcome.reason });
      }
    }

    return { tools, failures };
  }

  /**
   * Check if a tool exists in a prompt's tools/ directory.
   *
   * @param promptDir - Absolute path to the prompt directory
   * @param toolId - Tool ID to check
   * @returns True if the tool has a valid entry point
   */
  toolExists(promptDir: string, toolId: string): boolean {
    const normalizedId = toolId.toLowerCase();
    const toolYamlPath = join(promptDir, 'tools', normalizedId, 'tool.yaml');
    return existsSync(toolYamlPath);
  }

  /**
   * Clear the cache (all or for a specific prompt directory).
   *
   * @param promptDir - Optional prompt directory to clear cache for
   */
  clearCache(promptDir?: string): void {
    if (promptDir) {
      // Clear all entries that start with this prompt's tools directory
      const toolsPrefix = join(promptDir, 'tools');
      for (const key of this.cache.keys()) {
        if (key.startsWith(toolsPrefix)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Clear cache for a specific tool.
   *
   * @param promptDir - Absolute path to the prompt directory
   * @param toolId - Tool ID to clear
   */
  clearToolCache(promptDir: string, toolId: string): void {
    const normalizedId = toolId.toLowerCase();
    const cacheKey = join(promptDir, 'tools', normalizedId);
    this.cache.delete(cacheKey);
  }

  /**
   * Get loader statistics.
   */
  getStats(): ScriptToolLoaderStats {
    return {
      cacheSize: this.cache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      loadErrors: this.stats.loadErrors,
    };
  }

  // ============================================================================
  // Private Implementation - YAML/File Loading
  // ============================================================================

  /**
   * Load a tool from its directory (tools/{id}/).
   */
  private loadFromToolDir(toolDir: string, toolId: string, promptId: string): LoadOutcome {
    try {
      const entryPath = join(toolDir, 'tool.yaml');

      if (!existsSync(entryPath)) {
        if (this.debug) {
          process.stderr.write(`[ScriptToolDefinitionLoader] tool.yaml not found: ${entryPath}\n`);
        }
        return { ok: false, reason: `tool.yaml not found at ${entryPath}` };
      }

      // Load main tool.yaml
      const yamlDefinition = loadYamlFileSync<ScriptToolYaml>(entryPath, {
        required: true,
      });

      if (!yamlDefinition) {
        return { ok: false, reason: `tool.yaml at ${entryPath} parsed to an empty document` };
      }

      // Inline referenced files
      const { inputSchema, descriptionContent } = this.loadReferencedFiles(toolDir, yamlDefinition);

      // Validate if enabled
      if (this.validateOnLoad) {
        const validation = this.validateDefinition(yamlDefinition, toolId);
        if (!validation.valid) {
          this.stats.loadErrors++;
          const reason = `validation failed: ${validation.errors.join('; ')}`;
          process.stderr.write(
            `[ScriptToolDefinitionLoader] Validation failed for '${toolId}': ${validation.errors.join(
              '; '
            )}\n`
          );
          return { ok: false, reason };
        }
        if (validation.warnings.length > 0 && this.debug) {
          process.stderr.write(
            `[ScriptToolDefinitionLoader] Warnings for '${toolId}': ${validation.warnings.join(
              '; '
            )}\n`
          );
        }
      }

      // Resolve execution config with defaults
      const executionConfig = this.resolveExecutionConfig(yamlDefinition.execution);

      // Build LoadedScriptTool - only include optional properties when defined
      const loadedTool: LoadedScriptTool = {
        id: yamlDefinition.id,
        name: yamlDefinition.name,
        description: yamlDefinition.description ?? descriptionContent ?? '',
        scriptPath: yamlDefinition.script,
        runtime: yamlDefinition.runtime ?? 'auto',
        inputSchema,
        execution: executionConfig,
        // Resolved paths
        toolDir,
        absoluteScriptPath: join(toolDir, yamlDefinition.script),
        promptId,
        descriptionContent: descriptionContent ?? yamlDefinition.description ?? '',
        // Only include optional properties when defined
        ...(yamlDefinition.timeout !== undefined && { timeout: yamlDefinition.timeout }),
        ...(yamlDefinition.enabled !== undefined && { enabled: yamlDefinition.enabled }),
        ...(yamlDefinition.env !== undefined && { env: yamlDefinition.env }),
        ...(yamlDefinition.workingDir !== undefined && { workingDir: yamlDefinition.workingDir }),
      };

      if (this.debug) {
        process.stderr.write(
          `[ScriptToolDefinitionLoader] Loaded: ${loadedTool.name} (${toolId}) for prompt ${promptId}\n`
        );
      }

      return { ok: true, tool: loadedTool };
    } catch (error) {
      this.stats.loadErrors++;
      if (this.debug) {
        process.stderr.write(
          `[ScriptToolDefinitionLoader] Failed to load '${toolId}': ${String(error)}\n`
        );
      }
      return { ok: false, reason: String(error) };
    }
  }

  /**
   * Load and inline referenced files (schema.json, description.md).
   */
  private loadReferencedFiles(
    toolDir: string,
    definition: ScriptToolYaml
  ): { inputSchema: JSONSchemaDefinition; descriptionContent: string | undefined } {
    let inputSchema: JSONSchemaDefinition = { type: 'object', properties: {} };
    let descriptionContent: string | undefined = undefined;

    // Load schema.json
    const schemaPath = join(toolDir, definition.schemaFile ?? 'schema.json');
    if (existsSync(schemaPath)) {
      try {
        const schemaContent = readFileSync(schemaPath, 'utf-8');
        inputSchema = JSON.parse(schemaContent) as JSONSchemaDefinition;
        if (this.debug) {
          process.stderr.write(`[ScriptToolDefinitionLoader] Loaded schema from ${schemaPath}\n`);
        }
      } catch (error) {
        process.stderr.write(
          `[ScriptToolDefinitionLoader] Failed to parse schema.json: ${String(error)}\n`
        );
      }
    } else if (this.debug) {
      process.stderr.write(`[ScriptToolDefinitionLoader] No schema.json found at ${schemaPath}\n`);
    }

    // Load description.md
    const descPath = join(toolDir, definition.descriptionFile ?? 'description.md');
    if (existsSync(descPath)) {
      try {
        descriptionContent = readFileSync(descPath, 'utf-8').trim();
        if (this.debug) {
          process.stderr.write(
            `[ScriptToolDefinitionLoader] Loaded description from ${descPath}\n`
          );
        }
      } catch (error) {
        process.stderr.write(
          `[ScriptToolDefinitionLoader] Failed to read description.md: ${String(error)}\n`
        );
      }
    }

    return { inputSchema, descriptionContent };
  }

  /**
   * Validate a tool definition using Zod schema.
   */
  private validateDefinition(
    definition: ScriptToolYaml,
    expectedId: string
  ): ScriptToolSchemaValidationResult {
    return validateScriptToolSchema(definition, expectedId);
  }

  /**
   * Resolve execution config with defaults applied.
   *
   * Handles deprecation and migration of:
   * - 'parameter_match' trigger (use 'schema_match')
   * - 'confidence' field (use 'strict' for matching control)
   * - 'mode' field (use 'trigger: explicit' or 'confirm: true')
   *
   * Migration from deprecated mode field:
   * - mode: manual  → trigger: explicit
   * - mode: confirm → confirm: true
   *
   * @param yamlConfig - Execution config from YAML (may be undefined or partial)
   * @returns Complete execution config with defaults
   */
  private resolveExecutionConfig(yamlConfig: ScriptToolYaml['execution']): ExecutionConfig {
    if (!yamlConfig) {
      return { ...DEFAULT_EXECUTION_CONFIG };
    }

    // The Zod schema transforms 'parameter_match' -> 'schema_match' and logs deprecation warning
    // So yamlConfig.trigger is already transformed if it was 'parameter_match'
    let trigger = yamlConfig.trigger ?? DEFAULT_EXECUTION_CONFIG.trigger;
    // Final fallback is `true`, not `false`. `ExecutionConfig.confirm` is optional, so this
    // branch is reachable the moment `DEFAULT_EXECUTION_CONFIG.confirm` is left unset -- and
    // it used to resolve to `false`, silently contradicting that constant's own "Confirmation
    // is required by default (secure by default)" and the schema's `.default(true)`. A script
    // tool runs an author-supplied file through an interpreter, so an unspecified confirmation
    // setting must deny, never auto-run.
    let confirm = yamlConfig.confirm ?? DEFAULT_EXECUTION_CONFIG.confirm ?? true;

    // Handle deprecated mode field migration
    if (yamlConfig.mode !== undefined && yamlConfig.mode !== 'auto') {
      if (yamlConfig.mode === 'manual' && yamlConfig.trigger === undefined) {
        // mode: manual → trigger: explicit
        trigger = 'explicit';
      } else if (yamlConfig.mode === 'confirm' && yamlConfig.confirm === undefined) {
        // mode: confirm → confirm: true
        confirm = true;
      }
    }

    // Build config with new schema (no mode field)
    const config: ExecutionConfig = {
      trigger,
      confirm,
      strict: yamlConfig.strict ?? DEFAULT_EXECUTION_CONFIG.strict,
    };

    // Add optional confirmMessage only if defined
    if (yamlConfig.confirmMessage !== undefined) {
      config.confirmMessage = yamlConfig.confirmMessage;
    }

    // Add autoApproveOnValid if defined
    if (yamlConfig.autoApproveOnValid !== undefined) {
      config.autoApproveOnValid = yamlConfig.autoApproveOnValid;
    }

    return config;
  }
}

/**
 * Factory function with default configuration.
 */
export function createScriptToolDefinitionLoader(
  config?: ScriptToolLoaderConfig
): ScriptToolDefinitionLoader {
  return new ScriptToolDefinitionLoader(config);
}

// ============================================================================
// Default Instance Management (singleton pattern)
// ============================================================================

let defaultLoader: ScriptToolDefinitionLoader | null = null;

/**
 * Get the default ScriptToolDefinitionLoader instance.
 * Creates one if it doesn't exist.
 */
export function getDefaultScriptToolDefinitionLoader(): ScriptToolDefinitionLoader {
  if (!defaultLoader) {
    defaultLoader = new ScriptToolDefinitionLoader();
  }
  return defaultLoader;
}

/**
 * Reset the default loader (useful for testing).
 */
export function resetDefaultScriptToolDefinitionLoader(): void {
  defaultLoader = null;
}
