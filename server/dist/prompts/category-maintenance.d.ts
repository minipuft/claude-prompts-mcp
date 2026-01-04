/**
 * Filesystem-level category maintenance helpers shared across prompt tooling.
 */
import { Logger } from '../logging/index.js';
import { PromptsConfigFile } from '../types/index.js';
export interface CategoryResult {
    effectiveCategory: string;
    created: boolean;
}
interface EnsureCategoryOptions {
    logger: Logger;
    category: string;
    promptsConfig: PromptsConfigFile;
    promptsFile: string;
}
interface CleanupCategoryOptions {
    logger: Logger;
    categoryImport: string;
    promptsConfig: PromptsConfigFile;
    promptsFile: string;
}
interface CategoryStructureValidation {
    valid: boolean;
    issues: string[];
}
/**
 * Ensure a category exists inside the prompts configuration, creating the backing
 * directory/import metadata when necessary.
 */
export declare function ensureCategoryExistsOnDisk({ logger, category, promptsConfig, promptsFile, }: EnsureCategoryOptions): Promise<CategoryResult>;
/**
 * Remove the empty category metadata plus its directory on disk.
 */
export declare function cleanupEmptyCategoryOnDisk({ logger, categoryImport, promptsConfig, promptsFile, }: CleanupCategoryOptions): Promise<string>;
/**
 * Determine whether the referenced category import has zero prompts.
 */
export declare function isCategoryImportEmpty(logger: Logger, categoryImport: string, promptsFile: string): Promise<boolean>;
/**
 * Gather prompt counts per category import path.
 */
export declare function getCategoryStatsFromDisk(categories: string[], promptsFile: string): Promise<Record<string, number>>;
/**
 * Validate the structure of a category file to catch missing prompt metadata.
 */
export declare function validateCategoryStructureOnDisk(categoryImport: string, promptsFile: string): Promise<CategoryStructureValidation>;
export interface YamlPromptInfo {
    id: string;
    path: string;
    format: 'directory' | 'file';
}
/**
 * Discover YAML prompts in a category directory.
 * Supports both directory format ({id}/prompt.yaml) and file format ({id}.yaml).
 *
 * @param categoryDir - Path to the category directory
 * @returns Array of discovered YAML prompts with their paths and formats
 */
export declare function discoverYamlPromptsInCategory(categoryDir: string): YamlPromptInfo[];
/**
 * Find a specific YAML prompt by ID in a category directory.
 *
 * @param categoryDir - Path to the category directory
 * @param promptId - The prompt ID to find
 * @returns The prompt info if found, null otherwise
 */
export declare function findYamlPromptInCategory(categoryDir: string, promptId: string): YamlPromptInfo | null;
/**
 * Check if a category directory contains any YAML-format prompts.
 *
 * @param categoryDir - Path to the category directory
 * @returns true if any YAML prompts are found
 */
export declare function hasYamlPromptsInCategory(categoryDir: string): boolean;
/**
 * Delete a YAML prompt from a category directory.
 * Handles both directory format (deletes entire directory) and file format (deletes single file).
 *
 * @param promptInfo - The prompt info from discoverYamlPromptsInCategory
 * @returns Array of deleted paths
 */
export declare function deleteYamlPrompt(promptInfo: YamlPromptInfo): Promise<string[]>;
export {};
