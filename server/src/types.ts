/**
 * Type definitions for the prompt management system
 */

// Import gate types from the main types module
import type { GateDefinition } from "./types/index.js";

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
 * Registration mode for prompts
 */
export enum RegistrationMode {
  ID = "id",
  NAME = "name",
  BOTH = "both",
}

/**
 * Configuration for prompts subsystem
 */
export interface PromptsConfig {
  /** Path to the prompts definition file */
  file: string;
  /** Mode for registering prompts (defaults to ID if not specified) */
  registrationMode?: RegistrationMode;
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
  /**
   * Index signature for backwards compatibility
   * @deprecated Use customTransports instead
   */
  [key: string]:
    | TransportConfig
    | string
    | Record<string, TransportConfig>
    | undefined;
}

/**
 * Complete application configuration
 */
export interface Config {
  /** Server configuration */
  server: ServerConfig;
  /** Prompts subsystem configuration */
  prompts: PromptsConfig;
  /** Transports configuration */
  transports: TransportsConfig;
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
