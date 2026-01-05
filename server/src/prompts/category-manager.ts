// @lifecycle canonical - Manages prompt category metadata, validation, and analytics.
/**
 * Category Manager Module
 * Handles category management logic with validation, organization, and relationship tracking
 */

import { Logger } from '../logging/index.js';
import { Category, PromptData } from '../types/index.js';

// Import category interfaces from prompts/types.ts instead of redefining
import type {
  CategoryValidationResult,
  CategoryStatistics,
  CategoryPromptRelationship,
} from './types.js';

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
   * Get all categories
   */
  getCategories(): Category[] {
    return [...this.categories];
  }

  /**
   * Get category by ID
   */
  getCategoryById(id: string): Category | undefined {
    return this.categories.find((cat) => cat.id === id);
  }

  /**
   * Get category by name
   */
  getCategoryByName(name: string): Category | undefined {
    return this.categories.find((cat) => cat.name === name);
  }

  /**
   * Validate that all prompt categories exist
   */
  validatePromptCategories(prompts: PromptData[]): CategoryValidationResult {
    const result: CategoryValidationResult = {
      isValid: true,
      issues: [],
      warnings: [],
    };

    const categoryIds = new Set(this.categories.map((cat) => cat.id));
    const usedCategories = new Set<string>();

    for (const prompt of prompts) {
      if (!prompt.category) {
        result.issues.push(`Prompt '${prompt.id}' has no category assigned`);
        result.isValid = false;
        continue;
      }

      if (!categoryIds.has(prompt.category)) {
        result.issues.push(
          `Prompt '${prompt.id}' references non-existent category: ${prompt.category}`
        );
        result.isValid = false;
        continue;
      }

      usedCategories.add(prompt.category);
    }

    // Check for unused categories
    for (const category of this.categories) {
      if (!usedCategories.has(category.id)) {
        result.warnings.push(
          `Category '${category.id}' (${category.name}) has no prompts assigned`
        );
      }
    }

    return result;
  }

  /**
   * Get prompts by category
   */
  getPromptsByCategory(prompts: PromptData[], categoryId: string): PromptData[] {
    return prompts.filter((prompt) => prompt.category === categoryId);
  }

  /**
   * Get category statistics
   */
  getCategoryStatistics(prompts: PromptData[]): CategoryStatistics {
    const categoryBreakdown: Array<{ category: Category; promptCount: number }> = [];
    let totalPrompts = 0;

    for (const category of this.categories) {
      const categoryPrompts = this.getPromptsByCategory(prompts, category.id);
      const promptCount = categoryPrompts.length;

      categoryBreakdown.push({
        category,
        promptCount,
      });

      totalPrompts += promptCount;
    }

    const categoriesWithPrompts = categoryBreakdown.filter((item) => item.promptCount > 0).length;
    const emptyCategoriesCount = this.categories.length - categoriesWithPrompts;
    const averagePromptsPerCategory =
      this.categories.length > 0 ? totalPrompts / this.categories.length : 0;

    return {
      totalCategories: this.categories.length,
      categoriesWithPrompts,
      emptyCategoriesCount,
      averagePromptsPerCategory,
      categoryBreakdown,
    };
  }

  /**
   * Get category-prompt relationships
   */
  getCategoryPromptRelationships(prompts: PromptData[]): CategoryPromptRelationship[] {
    return this.categories.map((category) => {
      const categoryPrompts = this.getPromptsByCategory(prompts, category.id);

      return {
        categoryId: category.id,
        categoryName: category.name,
        promptIds: categoryPrompts.map((p) => p.id),
        promptCount: categoryPrompts.length,
        hasChains: categoryPrompts.some((p) => p.file && p.file.includes('chain')),
        hasTemplates: categoryPrompts.some((p) => p.file && p.file.includes('template')),
      };
    });
  }

  /**
   * Organize prompts by category for display
   */
  organizePromptsByCategory(prompts: PromptData[]): Map<Category, PromptData[]> {
    const organized = new Map<Category, PromptData[]>();

    for (const category of this.categories) {
      const categoryPrompts = this.getPromptsByCategory(prompts, category.id);
      organized.set(category, categoryPrompts);
    }

    return organized;
  }

  /**
   * Check consistency between categories and prompts
   */
  checkConsistency(prompts: PromptData[]): {
    consistent: boolean;
    issues: string[];
    orphanedPrompts: PromptData[];
    emptyCategories: Category[];
  } {
    const issues: string[] = [];
    const orphanedPrompts: PromptData[] = [];
    const emptyCategories: Category[] = [];

    const categoryIds = new Set(this.categories.map((cat) => cat.id));

    // Find orphaned prompts (prompts with invalid category references)
    for (const prompt of prompts) {
      if (prompt.category && !categoryIds.has(prompt.category)) {
        orphanedPrompts.push(prompt);
        issues.push(`Prompt '${prompt.id}' references non-existent category: ${prompt.category}`);
      }
    }

    // Find empty categories
    for (const category of this.categories) {
      const categoryPrompts = this.getPromptsByCategory(prompts, category.id);
      if (categoryPrompts.length === 0) {
        emptyCategories.push(category);
      }
    }

    const consistent = issues.length === 0 && orphanedPrompts.length === 0;

    return {
      consistent,
      issues,
      orphanedPrompts,
      emptyCategories,
    };
  }

  /**
   * Get debug information for troubleshooting
   */
  getDebugInfo(prompts?: PromptData[]): {
    categoriesLoaded: number;
    categoryIds: string[];
    categoryNames: string[];
    statistics?: CategoryStatistics;
    consistency?: ReturnType<CategoryManager['checkConsistency']>;
  } {
    const debugInfo: {
      categoriesLoaded: number;
      categoryIds: string[];
      categoryNames: string[];
      statistics?: CategoryStatistics;
      consistency?: ReturnType<CategoryManager['checkConsistency']>;
    } = {
      categoriesLoaded: this.categories.length,
      categoryIds: this.categories.map((cat) => cat.id),
      categoryNames: this.categories.map((cat) => cat.name),
    };

    if (prompts) {
      debugInfo.statistics = this.getCategoryStatistics(prompts);
      debugInfo.consistency = this.checkConsistency(prompts);
    }

    return debugInfo;
  }
}

/**
 * Factory function to create a CategoryManager instance
 */
export function createCategoryManager(logger: Logger): CategoryManager {
  return new CategoryManager(logger);
}
