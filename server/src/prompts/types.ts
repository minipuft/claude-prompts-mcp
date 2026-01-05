// @lifecycle canonical - Type definitions for prompt metadata, categories, and files.
/**
 * Prompt System Type Definitions
 *
 * Contains all types related to prompt management, processing, and organization.
 * This includes prompt data structures, arguments, categories, and file handling.
 */

/**
 * Enhanced argument definition for prompts
 * Consolidates features from multiple previous definitions
 */
export interface PromptArgument {
  /** Name of the argument */
  name: string;
  /** Optional description of the argument */
  description?: string;
  /** Whether this argument is required */
  required: boolean;
  /** Type of the argument value */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Default value if not provided */
  defaultValue?: string | number | boolean | null | object | Array<any>;
  /** Validation rules for the argument */
  validation?: {
    /** Regex pattern for string validation (e.g., "^https://" for URL whitelisting) */
    pattern?: string;
    /** Minimum length for strings - ensures sufficient input detail */
    minLength?: number;
    /** Maximum length for strings - prevents oversized payloads */
    maxLength?: number;
    /**
     * @deprecated Removed in v3.0.0 - LLM handles semantic variation better than strict enums.
     * This field is ignored by the validation system.
     */
    allowedValues?: Array<string | number | boolean>;
  };
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
  /** MCP registration default for prompts in this category. Default: true */
  registerWithMcp?: boolean;
}

/**
 * Gate definition interface (shared with gates system)
 */
export interface GateDefinition {
  id: string;
  name: string;
  type: 'validation' | 'guidance';
  requirements: any[];
  failureAction: 'stop' | 'retry' | 'skip' | 'rollback';
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };
}

/**
 * Gate configuration for prompts (YAML format)
 */
export interface PromptGateConfiguration {
  /** Gate IDs to include */
  include?: string[];
  /** Gate IDs to exclude */
  exclude?: string[];
  /** Whether to include framework gates (default: true) */
  framework_gates?: boolean;
  /** Inline gate definitions */
  inline_gate_definitions?: Array<{
    id?: string;
    name: string;
    type: string;
    scope?: 'execution' | 'session' | 'chain' | 'step';
    description?: string;
    guidance?: string;
    pass_criteria?: any[];
    expires_at?: number;
    source?: 'manual' | 'automatic' | 'analysis';
    context?: Record<string, any>;
  }>;
}

/**
 * Complete prompt metadata structure
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
  /** Optional gates for validation (legacy format) */
  gates?: GateDefinition[];
  /** Gate configuration (YAML format) */
  gateConfiguration?: PromptGateConfiguration;
  /** Chain steps for multi-step execution (YAML format) */
  chainSteps?: ChainStep[];
  /** Whether to register this prompt with MCP. Overrides category default. */
  registerWithMcp?: boolean;
  /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
  tools?: string[];
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
 * Configuration for the prompts subsystem with category imports
 */
export interface PromptsConfigFile {
  /** Available categories for organizing prompts */
  categories: Category[];
  /** Paths to prompts.json files to import from category folders */
  imports: string[];
}

/**
 * Configuration for the prompts subsystem
 */
export interface PromptsConfig {
  /** Path to the prompts directory */
  directory: string;
  /** Global default for MCP registration. Category/prompt overrides take precedence. */
  registerWithMcp?: boolean;
}

/**
 * Prompt file content structure
 */
export interface PromptFileContent {
  systemMessage?: string;
  userMessageTemplate: string;
  chainSteps?: ChainStep[];
}

/**
 * Result of loading category prompts
 */
export interface CategoryPromptsResult {
  promptsData: PromptData[];
  categories: Category[];
}

/**
 * Chain step definition
 *
 * Defines a single step in a chain workflow with support for:
 * - inputMapping: Map previous step results to semantic variable names
 * - outputMapping: Name this step's output for downstream reference
 * - retries: Per-step retry count for resilient chains
 */
export interface ChainStep {
  /** ID of the prompt to execute in this step */
  promptId: string;
  /** Name/identifier of this step */
  stepName: string;
  /** Map step results to semantic names (e.g., { "research": "step1_result" }) */
  inputMapping?: Record<string, string>;
  /** Name this step's output for downstream steps */
  outputMapping?: Record<string, string>;
  /** Number of retry attempts on failure (default: 0) */
  retries?: number;
}

/**
 * Category validation result
 */
export interface CategoryValidationResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
}

/**
 * Category statistics
 */
export interface CategoryStatistics {
  totalCategories: number;
  categoriesWithPrompts: number;
  emptyCategoriesCount: number;
  averagePromptsPerCategory: number;
  categoryBreakdown: Array<{
    category: Category;
    promptCount: number;
  }>;
}

/**
 * Category-prompt relationship data
 */
export interface CategoryPromptRelationship {
  categoryId: string;
  categoryName: string;
  promptIds: string[];
  promptCount: number;
  hasChains: boolean;
  hasTemplates: boolean;
}
