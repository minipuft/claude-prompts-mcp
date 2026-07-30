// @lifecycle canonical - Aggregated type definitions used across the server (config, prompts, gates).
/**
 * Type definitions for the prompt management system
 *
 * This file is a backward-compatibility re-export layer.
 * Canonical type definitions live in shared/types/ sub-modules.
 */

// Re-export core config types from their canonical location
export type {
  AdvancedConfig,
  AnalysisConfig,
  BaseMessageContent,
  ChainSessionConfig,
  Config,
  ExecutionConfig,
  FrameworkInjectionConfig,
  ResolvedFrameworkConfig,
  LLMIntegrationConfig,
  LLMProvider,
  LoggingConfig,
  Message,
  MessageContent,
  MessageRole,
  FrameworkSettings,
  PromptsConfig,
  ResourcesConfig,
  SemanticAnalysisConfig,
  ServerConfig,
  TextMessageContent,
  ToolDescriptionsOptions,
  TransportMode,
  VerificationConfig,
  VersioningConfig,
} from './shared/types/core-config.js';
export { DEFAULT_VERSIONING_CONFIG } from './shared/types/core-config.js';

// Re-export GatesConfig (top-level config.json shape) from core-config
export type { GatesConfig } from './shared/types/core-config.js';

// Re-export prompt argument from shared types
export type { PromptArgument } from './shared/types/index.js';

// Re-export prompt types from modules/prompts
export type { Category, PromptData, PromptFile } from './modules/prompts/types.js';
