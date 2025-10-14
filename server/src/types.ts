/**
 * Type definitions for the prompt management system
 */

// Import domain-specific types
import type { GateDefinition } from './gates/types.js';
import type { PromptArgument, Category, PromptData, PromptsFile, PromptFile, PromptsConfigFile, PromptsConfig } from './prompts/types.js';

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
 * Configuration for a transport
 */
export interface TransportConfig {
  /** Whether this transport is enabled */
  enabled: boolean;
}

/**
 * Configuration for all transports
 */
export interface TransportsConfig {
  /** Name of the default transport to use */
  default: string;
  /** Server-sent events transport configuration */
  sse: TransportConfig;
  /** Standard I/O transport configuration */
  stdio: TransportConfig;
  /** Custom transports map */
  customTransports?: Record<string, TransportConfig>;
  // Removed: Index signature for backwards compatibility - use customTransports instead
}

/**
 * Analysis mode for semantic analysis
 * Mode is automatically inferred based on LLM integration configuration
 */
export type AnalysisMode = "structural" | "semantic";

/**
 * LLM provider for semantic analysis
 */
export type LLMProvider = "openai" | "anthropic" | "custom";

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
 */
export interface SemanticAnalysisConfig {
  /** Analysis mode to use (automatically inferred if not specified) */
  mode?: AnalysisMode;
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
 * Complete application configuration
 */
/**
 * Configuration for gates subsystem
 */
export interface GatesConfig {
  /** Directory containing gate definitions */
  definitionsDirectory: string;
  /** Directory containing LLM validation templates */
  templatesDirectory: string;
}

export interface Config {
  /** Server configuration */
  server: ServerConfig;
  /** Prompts subsystem configuration */
  prompts: PromptsConfig;
  /** Analysis system configuration */
  analysis?: AnalysisConfig;
  /** Gates system configuration */
  gates?: GatesConfig;
  /** Transports configuration */
  transports: TransportsConfig;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Tool descriptions configuration */
  toolDescriptions?: ToolDescriptionsOptions;
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
  type: "text";
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
export type MessageRole = "user" | "assistant" | "system";

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
