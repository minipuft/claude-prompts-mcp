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
  /** Optional CAGEERF component association for framework-aware processing */
  cageerfComponent?: 'context' | 'analysis' | 'goals' | 'execution' | 'evaluation' | 'refinement' | 'framework';
  /** Validation rules for the argument */
  validation?: {
    /** Regex pattern for string validation */
    pattern?: string;
    /** Minimum length for strings */
    minLength?: number;
    /** Maximum length for strings */
    maxLength?: number;
    /** Allowed values for enumeration */
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
}

/**
 * Gate definition interface (shared with gates system)
 */
export interface GateDefinition {
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
  /** Whether this prompt should use available tools */
  tools?: boolean;
  /** Defines behavior when prompt is invoked without its defined arguments */
  onEmptyInvocation?: "execute_if_possible" | "return_template";
  /** Optional gates for validation */
  gates?: GateDefinition[];
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
  /** Path to the prompts definition file */
  file: string;
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
 * Chain step definition (minimal for prompt context)
 */
export interface ChainStep {
  promptId: string;
  stepName: string;
  executionType?: 'prompt' | 'template';
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}

/**
 * Category validation result
 */
export interface CategoryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  categoryCount: number;
  promptCount: number;
}

/**
 * Category statistics
 */
export interface CategoryStatistics {
  totalCategories: number;
  totalPrompts: number;
  promptsByCategory: Record<string, number>;
  averagePromptsPerCategory: number;
  categoriesWithoutPrompts: string[];
  mostPopularCategory: string;
  leastPopularCategory: string;
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