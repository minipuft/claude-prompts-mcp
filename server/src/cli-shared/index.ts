/**
 * cli-shared — Re-export barrel for schemas and utilities shared between server and CLI.
 *
 * CRITICAL CONSTRAINT: This module uses ONLY relative imports.
 * No @shared/*, @engine/*, @modules/* path aliases.
 * This keeps the dependency graph transparent for the CLI's esbuild alias.
 *
 * Import isolation is enforced by:
 *   1. dependency-cruiser rule `cli-shared-no-runtime`
 *   2. Unit test `import-isolation.test.ts`
 */

// ── Prompt schemas (pure Zod) ────────────────────────────────────────────────

export {
  ArgumentValidationSchema,
  PromptArgumentSchema,
  ChainStepSchema,
  PromptGateConfigurationSchema,
  CategorySchema,
  PromptDataSchema,
  PromptYamlSchema,
  validatePromptYaml,
  isValidPromptYaml,
  validatePromptSchema,
  isValidPromptData,
  isValidCategory,
  type ArgumentValidationYaml,
  type PromptArgumentYaml,
  type ChainStepYaml,
  type PromptGateConfigurationYaml,
  type CategoryYaml,
  type PromptDataYaml,
  type PromptYaml,
  type PromptYamlValidationResult,
  type PromptSchemaValidationResult,
} from '../modules/prompts/prompt-schema.js';

// ── Gate schemas (pure Zod) ──────────────────────────────────────────────────

export {
  GatePassCriteriaSchema,
  GateActivationSchema,
  GateRetryConfigSchema,
  GateDefinitionSchema,
  validateGateSchema,
  isValidGateDefinition,
  type GatePassCriteriaYaml,
  type GateActivationYaml,
  type GateRetryConfigYaml,
  type GateDefinitionYaml,
  type GateSchemaValidationResult,
} from '../engine/gates/core/gate-schema.js';

// ── Methodology schemas (pure Zod) ──────────────────────────────────────────

export {
  FrameworkGateSchema,
  TemplateSuggestionSchema,
  FrameworkSchema,
  validateMethodologySchema,
  type FrameworkGate,
  type TemplateSuggestion,
  type FrameworkYaml,
  type FrameworkSchemaValidationResult,
} from '../engine/frameworks/methodology/methodology-schema.js';

// ── Style schemas (pure Zod) ────────────────────────────────────────────────

export {
  StyleActivationSchema,
  StyleDefinitionSchema,
  validateStyleSchema,
  isValidStyleDefinition,
  type StyleActivationYaml,
  type StyleDefinitionYaml,
  type StyleSchemaValidationResult,
} from '../modules/formatting/core/style-schema.js';

// ── YAML utilities (js-yaml + node:fs only) ─────────────────────────────────

export {
  parseYaml,
  parseYamlOrThrow,
  serializeYaml,
  formatYamlError,
  loadYamlFile,
  loadYamlFileSync,
  loadYamlFileWithResult,
  discoverYamlFiles,
  discoverYamlDirectories,
  discoverNestedYamlDirectories,
  isYamlFile,
  getYamlBaseName,
  type YamlParseOptions,
  type YamlParseError,
  type YamlParseResult,
  type YamlFileLoadOptions,
  type YamlFileLoadResult,
} from '../shared/utils/yaml/index.js';

// ── Versioning types (pure interfaces) ───────────────────────────────────────

export type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from '../modules/versioning/types.js';

// ── Version history (standalone, node:fs only) ──────────────────────────────

export {
  loadHistory,
  getVersion,
  compareVersions,
  saveVersion,
  rollbackVersion,
  deleteHistoryFile,
  renameHistoryResource,
  formatHistoryTable,
} from './version-history.js';

// ── Resource scaffolding (node:fs only) ──────────────────────────────────────

export { createResourceDir, deleteResourceDir, resourceExists } from './resource-scaffold.js';
export type { CreateResourceOptions, CreateResourceResult } from './resource-scaffold.js';

// ── Resource validation (canonical schema checks for CLI + MCP) ───────────

export {
  validateResourceDocument,
  validateResourceFile,
  formatValidationIssues,
  type ResourceValidationType,
  type ResourceValidationIssue,
  type ResourceValidationResult,
} from './resource-validation.js';

// ── Resource operations (structural mutations) ──────────────────────────────

export {
  renameResource,
  movePromptCategory,
  toggleEnabled,
  linkGate,
  runValidatedMutation,
  type RenameResult,
  type MoveResult,
  type ToggleResult,
  type LinkGateResult,
  type ResourceMutationResult,
  type ValidatedMutationOptions,
  type ValidatedMutationResult,
} from './resource-operations.js';

// ── Config input validation (pure, no runtime deps) ─────────────────────────

export {
  CONFIG_VALID_KEYS,
  CONFIG_RESTART_REQUIRED_KEYS,
  validateConfigInput,
  type ConfigKey,
  type ConfigInputValidationResult,
} from './config-input-validator.js';

// ── Config file operations (node:fs only) ────────────────────────────────────

export {
  resolveConfigPath,
  readConfig,
  getConfigValue,
  setConfigValue,
  writeConfigAtomic,
  backupConfig,
  generateDefaultConfig,
  initConfig,
  validateConfig,
  getConfigKeyInfo,
  type ConfigReadResult,
  type ConfigSetResult,
  type ConfigInitResult,
  type ConfigValidationResult,
  type ConfigKeyInfo,
} from './config-operations.js';

// ── Workspace initialization ─────────────────────────────────────────────────

export { initWorkspace, formatStarterPromptYaml, STARTER_PROMPTS } from './workspace-init.js';
export type { StarterPrompt, WorkspaceInitResult } from './workspace-init.js';
