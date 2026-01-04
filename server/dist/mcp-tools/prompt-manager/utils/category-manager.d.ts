/**
 * Category operations and cleanup utilities
 */
import { Logger } from "../../../logging/index.js";
import { PromptsConfigFile } from "../../../types/index.js";
import { CategoryResult, OperationResult } from "../core/types.js";
/**
 * Category management operations
 */
export declare class CategoryManager {
    private logger;
    constructor(logger: Logger);
    /**
     * Ensure category exists in the configuration
     */
    ensureCategoryExists(category: string, promptsConfig: PromptsConfigFile, promptsFile: string): Promise<CategoryResult>;
    /**
     * Clean up empty category (remove from config and delete folder)
     */
    cleanupEmptyCategory(categoryImport: string, promptsConfig: PromptsConfigFile, promptsFile: string): Promise<OperationResult>;
    /**
     * Check if category is empty
     */
    isCategoryEmpty(categoryImport: string, promptsFile: string): Promise<boolean>;
    /**
     * Get category statistics
     */
    getCategoryStats(categories: string[], promptsFile: string): Promise<Record<string, number>>;
    /**
     * Validate category structure
     */
    validateCategoryStructure(categoryImport: string, promptsFile: string): Promise<{
        valid: boolean;
        issues: string[];
    }>;
    /**
     * Normalize category name for consistency
     */
    normalizeCategoryName(category: string): string;
    /**
     * Get category display name
     */
    getCategoryDisplayName(categoryId: string, categories: any[]): string;
}
