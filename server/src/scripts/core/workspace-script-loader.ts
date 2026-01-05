// @lifecycle canonical - Unified script loader with prompt-local and workspace-level discovery.
/**
 * Workspace Script Loader
 *
 * Provides unified script discovery and loading with priority-based resolution:
 *   1. Prompt-local: prompts/{category}/{prompt_id}/tools/{script_id}/
 *   2. Workspace:    ${workspace}/resources/scripts/{script_id}/
 *
 * First match wins (prompt-local scripts take priority over workspace scripts).
 *
 * Implements `IScriptLoader` interface for use with `ScriptReferenceResolver`.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { ScriptToolDefinitionLoader } from './script-definition-loader.js';
import { validateScriptToolSchema, type ScriptToolYaml } from './script-schema.js';
import { loadYamlFileSync } from '../../utils/yaml/index.js';
import { DEFAULT_EXECUTION_CONFIG } from '../types.js';

import type { IScriptLoader } from '../../execution/reference/script-reference-resolver.js';
import type { LoadedScriptTool, ScriptToolLoaderConfig, JSONSchemaDefinition } from '../types.js';

/**
 * Configuration for WorkspaceScriptLoader
 */
export interface WorkspaceScriptLoaderConfig extends ScriptToolLoaderConfig {
  /** Path to the workspace scripts directory */
  workspaceScriptsPath: string;
}

/**
 * Workspace Script Loader
 *
 * Unified loader for both prompt-local and workspace-level scripts.
 * Implements `IScriptLoader` for integration with `ScriptReferenceResolver`.
 *
 * @example
 * ```typescript
 * const loader = new WorkspaceScriptLoader({
 *   workspaceScriptsPath: '/path/to/workspace/resources/scripts'
 * });
 *
 * // Check if script exists (prompt-local first, then workspace)
 * if (loader.scriptExists('analyzer', '/path/to/prompt')) {
 *   const tool = loader.loadScript('analyzer', '/path/to/prompt');
 * }
 * ```
 */
export class WorkspaceScriptLoader implements IScriptLoader {
  private readonly promptLocalLoader: ScriptToolDefinitionLoader;
  private readonly workspaceScriptsPath: string;
  private readonly workspaceCache = new Map<string, LoadedScriptTool>();
  private readonly debug: boolean;
  private readonly validateOnLoad: boolean;

  constructor(config: WorkspaceScriptLoaderConfig) {
    this.workspaceScriptsPath = config.workspaceScriptsPath;
    this.debug = config.debug ?? false;
    this.validateOnLoad = config.validateOnLoad ?? true;

    // Loader for prompt-local scripts (uses tools/ subdirectory)
    this.promptLocalLoader = new ScriptToolDefinitionLoader({
      enableCache: config.enableCache ?? true,
      validateOnLoad: config.validateOnLoad ?? true,
      debug: config.debug,
    });

    if (this.debug) {
      process.stderr.write(
        `[WorkspaceScriptLoader] Initialized with workspace scripts path: ${this.workspaceScriptsPath}\n`
      );
    }
  }

  /**
   * Check if a script exists in any known location.
   *
   * Priority:
   *   1. Prompt-local: ${promptDir}/tools/${scriptId}/
   *   2. Workspace:    ${workspaceScriptsPath}/${scriptId}/
   *
   * @param scriptId - The script ID to look for
   * @param promptDir - Optional prompt directory for prompt-local lookup
   * @returns True if the script exists in any location
   */
  scriptExists(scriptId: string, promptDir?: string): boolean {
    const normalizedId = scriptId.toLowerCase();

    // 1. Check prompt-local first
    if (promptDir !== undefined && promptDir !== '') {
      if (this.promptLocalLoader.toolExists(promptDir, normalizedId)) {
        if (this.debug) {
          process.stderr.write(
            `[WorkspaceScriptLoader] Script '${scriptId}' found in prompt-local: ${promptDir}\n`
          );
        }
        return true;
      }
    }

    // 2. Check workspace scripts
    const workspaceToolYaml = join(this.workspaceScriptsPath, normalizedId, 'tool.yaml');
    if (existsSync(workspaceToolYaml)) {
      if (this.debug) {
        process.stderr.write(
          `[WorkspaceScriptLoader] Script '${scriptId}' found in workspace: ${this.workspaceScriptsPath}\n`
        );
      }
      return true;
    }

    return false;
  }

  /**
   * Load a script by ID from any known location.
   *
   * Priority:
   *   1. Prompt-local: ${promptDir}/tools/${scriptId}/
   *   2. Workspace:    ${workspaceScriptsPath}/${scriptId}/
   *
   * @param scriptId - The script ID to load
   * @param promptDir - Optional prompt directory for prompt-local lookup
   * @returns Loaded script tool or undefined if not found
   */
  loadScript(scriptId: string, promptDir?: string): LoadedScriptTool | undefined {
    const normalizedId = scriptId.toLowerCase();

    // 1. Try prompt-local first
    if (promptDir !== undefined && promptDir !== '') {
      const promptLocalTool = this.promptLocalLoader.loadTool(
        promptDir,
        normalizedId,
        'inline-script'
      );
      if (promptLocalTool !== undefined) {
        if (this.debug) {
          process.stderr.write(
            `[WorkspaceScriptLoader] Loaded script '${scriptId}' from prompt-local\n`
          );
        }
        return promptLocalTool;
      }
    }

    // 2. Try workspace scripts
    const workspaceTool = this.loadWorkspaceScript(normalizedId);
    if (workspaceTool !== undefined) {
      if (this.debug) {
        process.stderr.write(
          `[WorkspaceScriptLoader] Loaded script '${scriptId}' from workspace\n`
        );
      }
      return workspaceTool;
    }

    return undefined;
  }

  /**
   * Get the paths that were searched for a script.
   * Used for error diagnostics.
   *
   * @param scriptId - The script ID that was searched
   * @param promptDir - Optional prompt directory
   * @returns Array of paths that were searched
   */
  getSearchedPaths(scriptId: string, promptDir?: string): string[] {
    const normalizedId = scriptId.toLowerCase();
    const paths: string[] = [];

    if (promptDir !== undefined && promptDir !== '') {
      paths.push(join(promptDir, 'tools', normalizedId));
    }
    paths.push(join(this.workspaceScriptsPath, normalizedId));

    return paths;
  }

  /**
   * Discover all available script IDs in the workspace scripts directory.
   *
   * @returns Array of script IDs found
   */
  discoverWorkspaceScripts(): string[] {
    if (!existsSync(this.workspaceScriptsPath)) {
      return [];
    }

    try {
      const entries = readdirSync(this.workspaceScriptsPath, { withFileTypes: true });
      return entries
        .filter((entry) => {
          if (!entry.isDirectory()) return false;
          const toolYamlPath = join(this.workspaceScriptsPath, entry.name, 'tool.yaml');
          return existsSync(toolYamlPath);
        })
        .map((entry) => entry.name.toLowerCase())
        .sort();
    } catch (error) {
      if (this.debug) {
        process.stderr.write(
          `[WorkspaceScriptLoader] Failed to discover workspace scripts: ${String(error)}\n`
        );
      }
      return [];
    }
  }

  /**
   * Get the workspace scripts path.
   */
  getWorkspaceScriptsPath(): string {
    return this.workspaceScriptsPath;
  }

  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.promptLocalLoader.clearCache();
    this.workspaceCache.clear();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Load a script from the workspace scripts directory.
   * Uses direct YAML loading since workspace structure differs from prompt-local.
   */
  private loadWorkspaceScript(scriptId: string): LoadedScriptTool | undefined {
    // Check cache first
    const cached = this.workspaceCache.get(scriptId);
    if (cached !== undefined) {
      return cached;
    }

    const scriptDir = join(this.workspaceScriptsPath, scriptId);
    const toolYamlPath = join(scriptDir, 'tool.yaml');

    if (!existsSync(toolYamlPath)) {
      return undefined;
    }

    try {
      // Load and parse YAML
      const rawYaml = loadYamlFileSync(toolYamlPath);

      // Validate schema if enabled
      if (this.validateOnLoad) {
        const validation = validateScriptToolSchema(rawYaml, scriptId);
        if (!validation.valid) {
          if (this.debug) {
            process.stderr.write(
              `[WorkspaceScriptLoader] Invalid tool.yaml for '${scriptId}': ${validation.errors.join(', ')}\n`
            );
          }
          return undefined;
        }
      }

      const yaml = rawYaml as ScriptToolYaml;

      // Load referenced files (description, schema)
      const referencedFiles = this.loadReferencedFiles(scriptDir, yaml);

      // Build the loaded tool (matching LoadedScriptTool interface)
      const tool: LoadedScriptTool = {
        id: yaml.id,
        name: yaml.name,
        description: yaml.description ?? referencedFiles.description ?? '',
        scriptPath: yaml.script,
        runtime: yaml.runtime ?? 'auto',
        inputSchema: referencedFiles.inputSchema ?? { type: 'object', properties: {} },
        outputSchema: undefined, // Not part of the YAML schema
        timeout: yaml.timeout,
        env: yaml.env,
        workingDir: yaml.workingDir,
        enabled: yaml.enabled,
        execution:
          yaml.execution !== undefined
            ? {
                trigger: yaml.execution.trigger ?? 'schema_match',
                confirm: yaml.execution.confirm,
                strict: yaml.execution.strict,
                confirmMessage: yaml.execution.confirmMessage,
              }
            : DEFAULT_EXECUTION_CONFIG,
        // Extended LoadedScriptTool fields
        toolDir: scriptDir,
        absoluteScriptPath: join(scriptDir, yaml.script),
        promptId: 'workspace',
        descriptionContent: referencedFiles.description ?? yaml.description ?? '',
      };

      // Cache the result
      this.workspaceCache.set(scriptId, tool);

      return tool;
    } catch (error) {
      if (this.debug) {
        process.stderr.write(
          `[WorkspaceScriptLoader] Failed to load workspace script '${scriptId}': ${String(error)}\n`
        );
      }
      return undefined;
    }
  }

  /**
   * Load referenced files from a script directory.
   */
  private loadReferencedFiles(
    scriptDir: string,
    yaml: ScriptToolYaml
  ): { description?: string; inputSchema?: JSONSchemaDefinition } {
    const result: { description?: string; inputSchema?: JSONSchemaDefinition } = {};

    // Load description from file if specified or default to description.md
    const descriptionFile = yaml.descriptionFile ?? 'description.md';
    const descriptionPath = join(scriptDir, descriptionFile);
    if (existsSync(descriptionPath)) {
      try {
        result.description = readFileSync(descriptionPath, 'utf-8');
      } catch {
        // Description file read failure - continue without it
      }
    }

    // Load input schema from file if specified or default to schema.json
    const schemaFile = yaml.schemaFile ?? 'schema.json';
    const schemaPath = join(scriptDir, schemaFile);
    if (existsSync(schemaPath)) {
      try {
        const schemaContent = readFileSync(schemaPath, 'utf-8');
        result.inputSchema = JSON.parse(schemaContent) as JSONSchemaDefinition;
      } catch {
        // Schema file read failure - continue with default
      }
    }

    return result;
  }
}
