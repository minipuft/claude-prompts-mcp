// @lifecycle canonical - Aggregated type definitions used across the server (config, prompts, gates).
/**
 * Type definitions for the prompt management system
 */

// Import domain-specific types
import type { InjectionConfig } from './execution/pipeline/decisions/injection/index.js';
import type { GateDefinition } from './gates/types.js';
import type {
  PromptArgument,
  Category,
  PromptData,
  PromptsFile,
  PromptFile,
  PromptsConfigFile,
  PromptsConfig,
} from './prompts/types.js';

// ===== Configuration Types =====

/**
 * Configuration for the server
 */
export interface ServerConfig {
  /** Name of the server */
  name: string;
  /** Version string in semver format */
  version: string;
  /** Port number to listen on (1024-65535) */
  port: number;
}

// PromptsConfig interface moved to ./prompts/types.ts
// (imported directly above)

/**
 * Transport mode options
 * - 'stdio': Standard I/O transport for Claude Desktop/CLI (default)
 * - 'sse': Server-sent events over HTTP for web clients (deprecated, use streamable-http)
 * - 'streamable-http': Streamable HTTP transport (MCP standard since 2025-03-26)
 * - 'both': Run both STDIO and SSE transports simultaneously
 */
export type TransportMode = 'stdio' | 'sse' | 'streamable-http' | 'both';

/**
 * LLM provider for semantic analysis
 */
export type LLMProvider = 'openai' | 'anthropic' | 'custom';

/**
 * LLM integration configuration
 */
export interface LLMIntegrationConfig {
  /** Whether LLM integration is enabled */
  enabled: boolean;
  /** API key for the LLM provider */
  apiKey: string | null;
  /** Custom endpoint URL for the LLM provider (provider auto-detected from URL) */
  endpoint: string | null;
  /** Model name to use */
  model: string;
  /** Maximum tokens for analysis requests */
  maxTokens: number;
  /** Temperature for analysis requests */
  temperature: number;
}

/**
 * Semantic analysis configuration
 * Note: Structural analysis has been removed. When LLM is not configured,
 * the analyzer returns minimal results. When LLM is configured, it provides
 * intelligent semantic analysis.
 */
export interface SemanticAnalysisConfig {
  /** LLM integration configuration */
  llmIntegration: LLMIntegrationConfig;
}

/**
 * Analysis system configuration
 */
export interface AnalysisConfig {
  /** Semantic analysis configuration */
  semanticAnalysis: SemanticAnalysisConfig;
}

/**
 * Logging system configuration
 */
export interface LoggingConfig {
  /** Directory to write log files to */
  directory: string;
  /** Log level: debug, info, warn, error */
  level: string;
}

// Removed: FrameworkConfig - deprecated interface, framework state now managed at runtime

/**
 * Tool descriptions configuration options
 */
export interface ToolDescriptionsOptions {
  /** Whether to restart server when tool descriptions change */
  restartOnChange?: boolean;
}

/**
 * Injection configuration for framework-driven content
 */
export interface FrameworkInjectionConfig {
  /** System prompt injection settings */
  systemPrompt?: {
    enabled: boolean;
    /** Inject every N steps (default: 2) */
    frequency?: number;
  };
  /** Style guidance injection (enabled/disabled only, injected per-step as needed) */
  styleGuidance?: boolean;
}

/**
 * Configuration toggles for framework-driven features
 */
export interface FrameworksConfig {
  /** Enable dynamic tool descriptions per methodology */
  dynamicToolDescriptions: boolean;
  /** Injection control for framework content */
  injection?: FrameworkInjectionConfig;
}

/**
 * Configuration for execution strategies
 */
export interface ExecutionConfig {
  /** Enable judge mode (LLM-driven step selection) */
  judge?: boolean;
}

/**
 * Complete application configuration
 */
export interface ChainSessionConfig {
  /** Minutes before idle chain sessions expire */
  sessionTimeoutMinutes: number;
  /** Minutes before pending gate reviews expire */
  reviewTimeoutMinutes: number;
  /** Minutes between background cleanup sweeps */
  cleanupIntervalMinutes: number;
}

/**
 * Configuration for gates subsystem
 */
export interface GatesConfig {
  /** Directory containing gate definitions (e.g., 'gates' for server/gates/{id}/) */
  definitionsDirectory: string;
  /** Enable/disable the gate subsystem entirely */
  enabled?: boolean;
}

export interface Config {
  /** Server configuration */
  server: ServerConfig;
  /** Prompts subsystem configuration */
  prompts: PromptsConfig;
  /** Analysis system configuration */
  analysis?: AnalysisConfig;
  /** Gates system configuration (quality validation) */
  gates?: GatesConfig;
  /** Execution strategy configuration (judge mode, etc.) */
  execution?: ExecutionConfig;
  /** Framework feature configuration (injection, tool descriptions) */
  frameworks?: FrameworksConfig;
  /** Chain session lifecycle configuration */
  chainSessions?: ChainSessionConfig;
  /**
   * Transport mode: 'stdio' (default), 'sse', or 'both'
   * STDIO is used by Claude Desktop/CLI, SSE for web clients
   */
  transport?: TransportMode;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Tool descriptions configuration */
  toolDescriptions?: ToolDescriptionsOptions;
  /** Version history configuration for resources */
  versioning?: import('./versioning/types.js').VersioningConfig;
}

// ===== Prompt Types =====
// Moved to ./prompts/types.ts for domain organization
// Re-export for backward compatibility
export type { PromptArgument } from './prompts/types.js';

/**
 * Base interface for message content
 */
export interface BaseMessageContent {
  /** Type discriminator for the content */
  type: string;
}

/**
 * Text message content
 */
export interface TextMessageContent extends BaseMessageContent {
  /** Type discriminator set to "text" */
  type: 'text';
  /** The text content */
  text: string;
}

/**
 * Types of message content supported by the system
 * Extensible for future content types
 */
export type MessageContent = TextMessageContent;

/**
 * Role types for messages
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * A message in a conversation
 */
export interface Message {
  /** Role of the message sender */
  role: MessageRole;
  /** Content of the message */
  content: MessageContent;
}

// Category interface moved to ./prompts/types.ts
export type { Category } from './prompts/types.js';

// PromptData interface moved to ./prompts/types.ts
export type { PromptData } from './prompts/types.js';

// PromptsFile interface moved to ./prompts/types.ts
export type { PromptsFile } from './prompts/types.js';

// PromptFile interface moved to ./prompts/types.ts
export type { PromptFile } from './prompts/types.js';

// PromptsConfigFile interface moved to ./prompts/types.js
export type { PromptsConfigFile } from './prompts/types.js';
