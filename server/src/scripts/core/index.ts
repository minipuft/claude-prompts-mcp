// @lifecycle canonical - Barrel exports for scripts/core module.
/**
 * Script Tools Core Module
 *
 * Contains the foundational components for script tool loading and validation.
 */

// Schema and validation
export {
  ScriptToolYamlSchema,
  ScriptRuntimeSchema,
  validateScriptToolSchema,
  isValidScriptToolYaml,
  type ScriptToolYaml,
  type ScriptRuntimeYaml,
  type ScriptToolSchemaValidationResult,
} from './script-schema.js';

// Definition loader
export {
  ScriptToolDefinitionLoader,
  createScriptToolDefinitionLoader,
  getDefaultScriptToolDefinitionLoader,
  resetDefaultScriptToolDefinitionLoader,
} from './script-definition-loader.js';

// Workspace script loader (unified loader for prompt-local and workspace scripts)
export {
  WorkspaceScriptLoader,
  type WorkspaceScriptLoaderConfig,
} from './workspace-script-loader.js';
