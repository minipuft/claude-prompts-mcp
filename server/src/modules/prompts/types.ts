// @lifecycle canonical - Type definitions for prompt metadata, categories, and files.
/**
 * Prompt System Type Definitions
 *
 * Contains all types related to prompt management, processing, and organization.
 * This includes prompt data structures, arguments, categories, and file handling.
 */

// Cross-layer types canonical definitions live in shared/types/index.ts.
// Import only what's used locally by remaining interfaces.
import type { ChainStep, PromptData } from '#shared/types/index.js';

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
  /** Native MCP prompt behavior default for prompts in this category: 'expand' or 'launch'. Default: 'expand' */
  mcpPromptMode?: 'expand' | 'launch';
}

// Re-export cross-layer types for backward compatibility.
export type {
  ChainStep,
  GateDefinition,
  PromptData,
  PromptGateConfiguration,
} from '#shared/types/index.js';

// PromptData definition moved to shared/types/index.ts (re-exported above).

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

// PromptsFile and PromptsConfigFile removed — JSON prompts.json format deprecated.

// PromptsConfig is defined in shared/types/core-config.ts. Import it from there directly.

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

// ChainStep definition moved to shared/types/index.ts (re-exported above).

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
