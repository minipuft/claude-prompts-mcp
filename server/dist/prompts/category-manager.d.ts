/**
 * Category Manager Module
 * Handles category management logic with validation, organization, and relationship tracking
 */
import { Logger } from '../logging/index.js';
import { Category, PromptData } from '../types/index.js';
import type { CategoryValidationResult, CategoryStatistics, CategoryPromptRelationship } from './types.js';
/**
 * CategoryManager class
 * Centralizes all category-related operations with validation and consistency checking
 */
export declare class CategoryManager {
    private logger;
    private categories;
    constructor(logger: Logger);
    /**
     * Load and validate categories from configuration
     */
    loadCategories(categories: Category[]): Promise<CategoryValidationResult>;
    /**
     * Get all categories
     */
    getCategories(): Category[];
    /**
     * Get category by ID
     */
    getCategoryById(id: string): Category | undefined;
    /**
     * Get category by name
     */
    getCategoryByName(name: string): Category | undefined;
    /**
     * Validate that all prompt categories exist
     */
    validatePromptCategories(prompts: PromptData[]): CategoryValidationResult;
    /**
     * Get prompts by category
     */
    getPromptsByCategory(prompts: PromptData[], categoryId: string): PromptData[];
    /**
     * Get category statistics
     */
    getCategoryStatistics(prompts: PromptData[]): CategoryStatistics;
    /**
     * Get category-prompt relationships
     */
    getCategoryPromptRelationships(prompts: PromptData[]): CategoryPromptRelationship[];
    /**
     * Organize prompts by category for display
     */
    organizePromptsByCategory(prompts: PromptData[]): Map<Category, PromptData[]>;
    /**
     * Check consistency between categories and prompts
     */
    checkConsistency(prompts: PromptData[]): {
        consistent: boolean;
        issues: string[];
        orphanedPrompts: PromptData[];
        emptyCategories: Category[];
    };
    /**
     * Get debug information for troubleshooting
     */
    getDebugInfo(prompts?: PromptData[]): {
        categoriesLoaded: number;
        categoryIds: string[];
        categoryNames: string[];
        statistics?: CategoryStatistics;
        consistency?: ReturnType<CategoryManager['checkConsistency']>;
    };
}
/**
 * Factory function to create a CategoryManager instance
 */
export declare function createCategoryManager(logger: Logger): CategoryManager;
