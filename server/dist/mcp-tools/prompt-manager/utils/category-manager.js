/**
 * Category operations and cleanup utilities
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { safeWriteFile } from "../../../prompts/promptUtils.js";
/**
 * Category management operations
 */
export class CategoryManager {
    constructor(logger) {
        this.logger = logger;
    }
    /**
     * Ensure category exists in the configuration
     */
    async ensureCategoryExists(category, promptsConfig, promptsFile) {
        const effectiveCategory = category.toLowerCase().replace(/\s+/g, "-");
        const exists = promptsConfig.categories.some(cat => cat.id === effectiveCategory);
        if (!exists) {
            // Create new category
            promptsConfig.categories.push({
                id: effectiveCategory,
                name: category,
                description: `Prompts related to ${category}`
            });
            // Create directory and files
            const categoryDir = path.join(path.dirname(promptsFile), effectiveCategory);
            await fs.mkdir(categoryDir, { recursive: true });
            const categoryPromptsPath = path.join(categoryDir, "prompts.json");
            await safeWriteFile(categoryPromptsPath, JSON.stringify({ prompts: [] }, null, 2), "utf8");
            // Add to imports
            const relativePath = path.join(effectiveCategory, "prompts.json").replace(/\\/g, "/");
            if (!promptsConfig.imports.includes(relativePath)) {
                promptsConfig.imports.push(relativePath);
            }
            // Save config
            await safeWriteFile(promptsFile, JSON.stringify(promptsConfig, null, 2), "utf8");
            this.logger.info(`Created new category: ${effectiveCategory}`);
            return { effectiveCategory, created: true };
        }
        return { effectiveCategory, created: false };
    }
    /**
     * Clean up empty category (remove from config and delete folder)
     */
    async cleanupEmptyCategory(categoryImport, promptsConfig, promptsFile) {
        const promptsConfigDir = path.dirname(promptsFile);
        const categoryPath = path.join(promptsConfigDir, categoryImport);
        const categoryDir = path.dirname(categoryPath);
        const messages = [];
        try {
            // Extract category ID from import path (e.g., "examples/prompts.json" -> "examples")
            const categoryId = categoryImport.split('/')[0];
            // Remove from categories array
            const categoryIndex = promptsConfig.categories.findIndex(cat => cat.id === categoryId);
            if (categoryIndex > -1) {
                const removedCategory = promptsConfig.categories.splice(categoryIndex, 1)[0];
                messages.push(`✅ Removed category definition: ${removedCategory.name}`);
            }
            // Remove from imports array
            const importIndex = promptsConfig.imports.findIndex(imp => imp === categoryImport);
            if (importIndex > -1) {
                promptsConfig.imports.splice(importIndex, 1);
                messages.push(`✅ Removed import path: ${categoryImport}`);
            }
            // Save updated config
            await safeWriteFile(promptsFile, JSON.stringify(promptsConfig, null, 2), "utf8");
            messages.push(`✅ Updated promptsConfig.json`);
            // Delete empty category folder and its contents
            try {
                // Delete prompts.json file
                await fs.unlink(categoryPath);
                messages.push(`✅ Deleted category file: ${categoryImport}`);
                // Delete category directory if empty
                await fs.rmdir(categoryDir);
                messages.push(`✅ Deleted empty category folder: ${path.basename(categoryDir)}`);
            }
            catch (folderError) {
                if (folderError.code !== "ENOENT") {
                    messages.push(`⚠️ Could not delete category folder: ${folderError.message}`);
                }
            }
            this.logger.info(`Cleaned up empty category: ${categoryId}`);
        }
        catch (error) {
            this.logger.error(`Failed to cleanup category ${categoryImport}:`, error);
            messages.push(`❌ Category cleanup failed: ${error.message}`);
        }
        return { message: messages.join('\n') };
    }
    /**
     * Check if category is empty
     */
    async isCategoryEmpty(categoryImport, promptsFile) {
        try {
            const promptsConfigDir = path.dirname(promptsFile);
            const categoryPath = path.join(promptsConfigDir, categoryImport);
            const categoryContent = await readFile(categoryPath, "utf8");
            const categoryData = JSON.parse(categoryContent);
            return !categoryData.prompts || categoryData.prompts.length === 0;
        }
        catch (error) {
            this.logger.warn(`Could not check category emptiness: ${categoryImport}`, error);
            return false;
        }
    }
    /**
     * Get category statistics
     */
    async getCategoryStats(categories, promptsFile) {
        const stats = {};
        const promptsConfigDir = path.dirname(promptsFile);
        for (const categoryImport of categories) {
            try {
                const categoryPath = path.join(promptsConfigDir, categoryImport);
                const categoryContent = await readFile(categoryPath, "utf8");
                const categoryData = JSON.parse(categoryContent);
                const categoryId = categoryImport.split('/')[0];
                stats[categoryId] = categoryData.prompts ? categoryData.prompts.length : 0;
            }
            catch (error) {
                const categoryId = categoryImport.split('/')[0];
                stats[categoryId] = 0;
            }
        }
        return stats;
    }
    /**
     * Validate category structure
     */
    async validateCategoryStructure(categoryImport, promptsFile) {
        const issues = [];
        const promptsConfigDir = path.dirname(promptsFile);
        const categoryPath = path.join(promptsConfigDir, categoryImport);
        try {
            // Check if category file exists
            const categoryContent = await readFile(categoryPath, "utf8");
            try {
                const categoryData = JSON.parse(categoryContent);
                // Validate structure
                if (!categoryData.prompts) {
                    issues.push("Missing 'prompts' array");
                }
                else if (!Array.isArray(categoryData.prompts)) {
                    issues.push("'prompts' must be an array");
                }
                // Validate each prompt entry
                if (categoryData.prompts) {
                    for (const [index, prompt] of categoryData.prompts.entries()) {
                        if (!prompt.id) {
                            issues.push(`Prompt at index ${index} missing 'id'`);
                        }
                        if (!prompt.name) {
                            issues.push(`Prompt at index ${index} missing 'name'`);
                        }
                        if (!prompt.file) {
                            issues.push(`Prompt at index ${index} missing 'file'`);
                        }
                    }
                }
            }
            catch (parseError) {
                issues.push("Invalid JSON format");
            }
        }
        catch (error) {
            issues.push("Category file not accessible");
        }
        return {
            valid: issues.length === 0,
            issues
        };
    }
    /**
     * Normalize category name for consistency
     */
    normalizeCategoryName(category) {
        return category.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
    }
    /**
     * Get category display name
     */
    getCategoryDisplayName(categoryId, categories) {
        const category = categories.find(cat => cat.id === categoryId);
        return category ? category.name : categoryId;
    }
}
//# sourceMappingURL=category-manager.js.map