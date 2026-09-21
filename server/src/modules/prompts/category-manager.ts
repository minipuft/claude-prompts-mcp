// @lifecycle canonical - Manages prompt category metadata, validation, and analytics.
/**
 * Category Manager Module
 * Handles category management logic with validation, organization, and relationship tracking
 */

import type { Category, PromptData } from './types.js';

// Import category interfaces from prompts/types.ts instead of redefining
import type { CategoryValidationResult } from './types.js';

import { type Logger } from '#shared/types/index.js';

/**
 * CategoryManager class
 * Centralizes all category-related operations with validation and consistency checking
 */
export class CategoryManager {
  private logger: Logger;
  private categories: Category[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Load and validate categories from configuration
   */
  async loadCategories(categories: Category[]): Promise<CategoryValidationResult> {
    this.logger.debug(`CategoryManager: Loading ${categories.length} categories`);

    const result: CategoryValidationResult = {
      isValid: true,
      issues: [],
      warnings: [],
    };

    // Validate categories
    const validatedCategories: Category[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];

      if (!category) {
        result.issues.push(`Category ${i + 1}: Entry is undefined`);
        result.isValid = false;
        continue;
      }

      // Validate required fields
      if (!category.id || typeof category.id !== 'string') {
        result.issues.push(`Category ${i + 1}: Missing or invalid 'id' field`);
        result.isValid = false;
        continue;
      }

      if (!category.name || typeof category.name !== 'string') {
        result.issues.push(`Category ${i + 1} (${category.id}): Missing or invalid 'name' field`);
        result.isValid = false;
        continue;
      }

      if (!category.description || typeof category.description !== 'string') {
        result.warnings.push(`Category ${category.id}: Missing or empty description`);
      }

      // Check for duplicates
      if (seenIds.has(category.id)) {
        result.issues.push(`Duplicate category ID found: ${category.id}`);
        result.isValid = false;
        continue;
      }

      if (seenNames.has(category.name)) {
        result.warnings.push(`Duplicate category name found: ${category.name}`);
      }

      seenIds.add(category.id);
      seenNames.add(category.name);

      // Clean and normalize category
      const normalizedCategory: Category = {
        id: category.id.trim(),
        name: category.name.trim(),
        description: (category.description || '').trim(),
      };
      if (category.registerWithMcp !== undefined) {
        normalizedCategory.registerWithMcp = category.registerWithMcp;
      }
      if (category.mcpPromptMode !== undefined) {
        normalizedCategory.mcpPromptMode = category.mcpPromptMode;
      }

      validatedCategories.push(normalizedCategory);
    }

    this.categories = validatedCategories;

    this.logger.info(`CategoryManager: Loaded ${this.categories.length} valid categories`);
    if (result.issues.length > 0) {
      this.logger.error(`CategoryManager: ${result.issues.length} validation issues found`);
      result.issues.forEach((issue) => this.logger.error(`  - ${issue}`));
    }
    if (result.warnings.length > 0) {
      this.logger.warn(`CategoryManager: ${result.warnings.length} warnings found`);
      result.warnings.forEach((warning) => this.logger.warn(`  - ${warning}`));
    }

    return result;
  }

  /**
   * Get prompts by category
   */
  getPromptsByCategory(prompts: PromptData[], categoryId: string): PromptData[] {
    return prompts.filter((prompt) => prompt.category === categoryId);
  }
}

/**
 * Factory function to create a CategoryManager instance
 */
export function createCategoryManager(logger: Logger): CategoryManager {
  return new CategoryManager(logger);
}
