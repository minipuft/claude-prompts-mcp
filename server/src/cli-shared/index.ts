/**
 * cli-shared — Re-export barrel for schemas and utilities shared between server and CLI.
 *
 * CRITICAL CONSTRAINT: nothing reachable from this barrel may live in `infra/`, `runtime/`, or
 * `mcp/`. The CLI bundles it independently — its own esbuild run, its own package.json, a Node
 * floor of >=18.18 against the server's >=22.13 — so one transitive edge into config loading,
 * logging, or a transport drags the server into the CLI bundle. Schema and utility modules in
 * `shared/`, `engine/`, and `modules/` are fair game and are what the re-exports below reach.
 *
 * Enforced by:
 *   1. dependency-cruiser rule `cli-shared-no-runtime` — a `reachable` rule, so it sees the whole
 *      closure and not just the first hop
 *   2. Unit test `tests/unit/cli-shared/import-isolation.test.ts`, which cruises this barrel alone
 *
 * This header used to say the module uses ONLY relative imports and no path aliases. That was
 * false against its own body from the day the `#`-subpath specifiers landed, and the rule it named
 * did not exist until 2026-09-15 — so the one file a reader would check to learn the constraint
 * described neither the code nor the enforcement.
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
} from '#modules/prompts/prompt-schema.js';

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
} from '#engine/gates/core/gate-schema.js';

// ── Framework schemas (pure Zod) ──────────────────────────────────────────

export {
  FrameworkGateSchema,
  TemplateSuggestionSchema,
  FrameworkSchema,
  validateFrameworkSchema,
  type FrameworkGate,
  type TemplateSuggestion,
  type FrameworkYaml,
  type FrameworkSchemaValidationResult,
} from '#engine/frameworks/definitions/framework-schema.js';

// ── Style schemas (pure Zod) ────────────────────────────────────────────────

export {
  StyleActivationSchema,
  StyleDefinitionSchema,
  validateStyleSchema,
  isValidStyleDefinition,
  type StyleActivationYaml,
  type StyleDefinitionYaml,
  type StyleSchemaValidationResult,
} from '#modules/formatting/core/style-schema.js';

// ── YAML utilities (the `yaml` package + node:fs only) ─────────────────────

export {
  parseYaml,
  parseYamlOrThrow,
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
} from '#shared/utils/yaml/index.js';

// ── Versioning types (pure interfaces) ───────────────────────────────────────

export type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from '#modules/versioning/types.js';

// ── Version history (standalone, node:fs only) ──────────────────────────────

export {
  loadHistory,
  getVersion,
  compareVersions,
  saveVersion,
  rollbackVersion,
  deleteVersionRows,
  renameHistoryResource,
  formatHistoryTable,
  resolveConfiguredMaxVersions,
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
  generateDefaultConfig,
  initConfig,
  resetConfig,
  validateConfig,
  getConfigKeyInfo,
  type ConfigReadResult,
  type ConfigSetResult,
  type ConfigInitResult,
  type ConfigResetResult,
  type ConfigValidationResult,
  type ConfigKeyInfo,
} from './config-operations.js';

// ── Workspace initialization ─────────────────────────────────────────────────

export { initWorkspace, formatStarterPromptYaml, STARTER_PROMPTS } from './workspace-init.js';
export type { StarterPrompt, WorkspaceInitResult } from './workspace-init.js';
