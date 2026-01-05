// @lifecycle canonical - Filesystem helpers that ensure prompt categories and configs stay consistent.
/**
 * Filesystem-level category maintenance helpers shared across prompt tooling.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { safeWriteFile } from './promptUtils.js';
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
export async function ensureCategoryExistsOnDisk({
  logger,
  category,
  promptsConfig,
  promptsFile,
}: EnsureCategoryOptions): Promise<CategoryResult> {
  const effectiveCategory = category.toLowerCase().replace(/\s+/g, '-');
  const exists = promptsConfig.categories.some((cat) => cat.id === effectiveCategory);

  if (!exists) {
    promptsConfig.categories.push({
      id: effectiveCategory,
      name: category,
      description: `Prompts related to ${category}`,
    });

    const categoryDir = path.join(path.dirname(promptsFile), effectiveCategory);
    await fs.mkdir(categoryDir, { recursive: true });

    const categoryPromptsPath = path.join(categoryDir, 'prompts.json');
    await safeWriteFile(categoryPromptsPath, JSON.stringify({ prompts: [] }, null, 2), 'utf8');

    const relativePath = path.join(effectiveCategory, 'prompts.json').replace(/\\/g, '/');
    if (!promptsConfig.imports.includes(relativePath)) {
      promptsConfig.imports.push(relativePath);
    }

    await safeWriteFile(promptsFile, JSON.stringify(promptsConfig, null, 2), 'utf8');

    logger.info(`Created new category: ${effectiveCategory}`);
    return { effectiveCategory, created: true };
  }

  return { effectiveCategory, created: false };
}

/**
 * Remove the empty category metadata plus its directory on disk.
 */
export async function cleanupEmptyCategoryOnDisk({
  logger,
  categoryImport,
  promptsConfig,
  promptsFile,
}: CleanupCategoryOptions): Promise<string> {
  const promptsConfigDir = path.dirname(promptsFile);
  const categoryPath = path.join(promptsConfigDir, categoryImport);
  const categoryDir = path.dirname(categoryPath);
  const messages: string[] = [];

  try {
    const categoryId = categoryImport.split('/')[0];

    const categoryIndex = promptsConfig.categories.findIndex((cat) => cat.id === categoryId);
    if (categoryIndex > -1) {
      const removedCategory = promptsConfig.categories.splice(categoryIndex, 1)[0];
      if (removedCategory) {
        messages.push(`✅ Removed category definition: ${removedCategory.name}`);
      }
    }

    const importIndex = promptsConfig.imports.findIndex((imp) => imp === categoryImport);
    if (importIndex > -1) {
      promptsConfig.imports.splice(importIndex, 1);
      messages.push(`✅ Removed import path: ${categoryImport}`);
    }

    await safeWriteFile(promptsFile, JSON.stringify(promptsConfig, null, 2), 'utf8');
    messages.push(`✅ Updated promptsConfig.json`);

    try {
      await fs.unlink(categoryPath);
      messages.push(`✅ Deleted category file: ${categoryImport}`);

      await fs.rmdir(categoryDir);
      messages.push(`✅ Deleted empty category folder: ${path.basename(categoryDir)}`);
    } catch (folderError: any) {
      if (folderError.code !== 'ENOENT') {
        messages.push(`⚠️ Could not delete category folder: ${folderError.message}`);
      }
    }

    logger.info(`Cleaned up empty category: ${categoryId}`);
  } catch (error: any) {
    logger.error(`Failed to cleanup category ${categoryImport}:`, error);
    messages.push(`❌ Category cleanup failed: ${error.message}`);
  }

  return messages.join('\n');
}

/**
 * Determine whether the referenced category import has zero prompts.
 */
export async function isCategoryImportEmpty(
  logger: Logger,
  categoryImport: string,
  promptsFile: string
): Promise<boolean> {
  try {
    const promptsConfigDir = path.dirname(promptsFile);
    const categoryPath = path.join(promptsConfigDir, categoryImport);
    const categoryContent = await readFile(categoryPath, 'utf8');
    const categoryData = JSON.parse(categoryContent);

    return !categoryData.prompts || categoryData.prompts.length === 0;
  } catch (error) {
    logger.warn(`Could not check category emptiness: ${categoryImport}`, error);
    return false;
  }
}

/**
 * Gather prompt counts per category import path.
 */
export async function getCategoryStatsFromDisk(
  categories: string[],
  promptsFile: string
): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  const promptsConfigDir = path.dirname(promptsFile);

  for (const categoryImport of categories) {
    try {
      const categoryPath = path.join(promptsConfigDir, categoryImport);
      const categoryContent = await readFile(categoryPath, 'utf8');
      const categoryData = JSON.parse(categoryContent);

      const [categoryId] = categoryImport.split('/');
      if (categoryId) {
        stats[categoryId] = categoryData.prompts ? categoryData.prompts.length : 0;
      }
    } catch (error) {
      const [categoryId] = categoryImport.split('/');
      if (categoryId) {
        stats[categoryId] = 0;
      }
    }
  }

  return stats;
}

/**
 * Validate the structure of a category file to catch missing prompt metadata.
 */
export async function validateCategoryStructureOnDisk(
  categoryImport: string,
  promptsFile: string
): Promise<CategoryStructureValidation> {
  const issues: string[] = [];
  const promptsConfigDir = path.dirname(promptsFile);
  const categoryPath = path.join(promptsConfigDir, categoryImport);

  try {
    const categoryContent = await readFile(categoryPath, 'utf8');

    try {
      const categoryData = JSON.parse(categoryContent);

      if (!categoryData.prompts) {
        issues.push("Missing 'prompts' array");
      } else if (!Array.isArray(categoryData.prompts)) {
        issues.push("'prompts' must be an array");
      }

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
    } catch {
      issues.push('Invalid JSON format');
    }
  } catch {
    issues.push('Category file not accessible');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ============================================
// YAML Prompt Helpers
// ============================================

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
export function discoverYamlPromptsInCategory(categoryDir: string): YamlPromptInfo[] {
  if (!existsSync(categoryDir)) {
    return [];
  }

  const discoveries: YamlPromptInfo[] = [];
  const seenIds = new Set<string>();

  try {
    const entries = readdirSync(categoryDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        // Directory pattern: {prompt_id}/prompt.yaml
        const promptYamlPath = path.join(categoryDir, entry.name, 'prompt.yaml');
        if (existsSync(promptYamlPath)) {
          seenIds.add(entry.name);
          discoveries.push({
            id: entry.name,
            path: path.join(categoryDir, entry.name),
            format: 'directory',
          });
        }
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.yaml') &&
        entry.name !== 'prompts.yaml' &&
        entry.name !== 'category.yaml'
      ) {
        // File pattern: {prompt_id}.yaml (skip metadata files)
        const promptId = entry.name.replace(/\.yaml$/, '');
        // Skip if directory version exists
        if (!seenIds.has(promptId)) {
          discoveries.push({
            id: promptId,
            path: path.join(categoryDir, entry.name),
            format: 'file',
          });
        }
      }
    }
  } catch (error) {
    // Ignore errors for inaccessible directories
  }

  return discoveries;
}

/**
 * Find a specific YAML prompt by ID in a category directory.
 *
 * @param categoryDir - Path to the category directory
 * @param promptId - The prompt ID to find
 * @returns The prompt info if found, null otherwise
 */
export function findYamlPromptInCategory(
  categoryDir: string,
  promptId: string
): YamlPromptInfo | null {
  const prompts = discoverYamlPromptsInCategory(categoryDir);
  return prompts.find((p) => p.id === promptId) ?? null;
}

/**
 * Check if a category directory contains any YAML-format prompts.
 *
 * @param categoryDir - Path to the category directory
 * @returns true if any YAML prompts are found
 */
export function hasYamlPromptsInCategory(categoryDir: string): boolean {
  return discoverYamlPromptsInCategory(categoryDir).length > 0;
}

/**
 * Delete a YAML prompt from a category directory.
 * Handles both directory format (deletes entire directory) and file format (deletes single file).
 *
 * @param promptInfo - The prompt info from discoverYamlPromptsInCategory
 * @returns Array of deleted paths
 */
export async function deleteYamlPrompt(promptInfo: YamlPromptInfo): Promise<string[]> {
  const deletedPaths: string[] = [];

  try {
    if (promptInfo.format === 'directory') {
      // Delete entire directory recursively
      await fs.rm(promptInfo.path, { recursive: true, force: true });
      deletedPaths.push(promptInfo.path);
    } else {
      // Delete single file
      await fs.unlink(promptInfo.path);
      deletedPaths.push(promptInfo.path);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return deletedPaths;
}
