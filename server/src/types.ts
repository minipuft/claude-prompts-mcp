/**
 * Type definitions for the prompt management system
 */

// Gate definition interface (duplicated here to avoid circular dependency)
interface GateDefinition {
  id: string;
  name: string;
  type: 'validation' | 'approval' | 'condition' | 'quality';
  requirements: any[];
  failureAction: 'stop' | 'retry' | 'skip' | 'rollback';
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };
}

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

/**
 * Configuration for prompts subsystem
 */
export interface PromptsConfig {
  /** Path to the prompts definition file */
  file: string;
}

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
  /** Whether gates are enabled */
  enabled: boolean;
  /** Directory containing gate definitions */
  definitionsDirectory: string;
  /** Directory containing LLM validation templates */
  templatesDirectory: string;
  /** Default retry limit for failed validations */
  defaultRetryLimit: number;
  /** Whether to inject gate guidance into prompts */
  enableGuidanceInjection: boolean;
  /** Whether to perform gate validation */
  enableValidation: boolean;
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

/**
 * Definition of an argument for a prompt
 */
export interface PromptArgument {
  /** Name of the argument */
  name: string;
  /** Optional description of the argument */
  description?: string;
  /** Whether this argument is required */
  required: boolean;
}

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

/**
 * A category for organizing prompts
 */
export interface Category {
  /** Unique identifier for the category */
  id: string;
  /** Display name for the category */
  name: string;
  /** Description of the category */
  description: string;
}

/**
 * Metadata for a prompt
 */
export interface PromptData {
  /** Unique identifier for the prompt */
  id: string;
  /** Display name for the prompt */
  name: string;
  /** Category this prompt belongs to */
  category: string;
  /** Description of the prompt */
  description: string;
  /** Path to the prompt file */
  file: string;
  /** Arguments accepted by this prompt */
  arguments: PromptArgument[];
  /** Whether this prompt should use available tools */
  tools?: boolean;
  /** Defines behavior when prompt is invoked without its defined arguments */
  onEmptyInvocation?: "execute_if_possible" | "return_template";
  /** Optional gates for validation */
  gates?: GateDefinition[];
}

/**
 * Structure of the prompts registry file
 */
export interface PromptsFile {
  /** Available categories for organizing prompts */
  categories: Category[];
  /** Available prompts */
  prompts: PromptData[];
}

/**
 * Structure of an individual prompt file
 */
export interface PromptFile {
  /** Title of the prompt */
  title: string;
  /** Description of the prompt */
  description: string;
  /** Optional system message for the prompt */
  systemMessage?: string;
  /** Template for generating the user message */
  userMessageTemplate: string;
  /** Whether this prompt should use available tools */
  tools?: boolean;
}

/**
 * Configuration for the prompts subsystem with category imports
 */
export interface PromptsConfigFile {
  /** Available categories for organizing prompts */
  categories: Category[];
  /** Paths to prompts.json files to import from category folders */
  imports: string[];
}
