// @lifecycle canonical - Filesystem helpers for YAML-based prompt category operations.
/**
 * Filesystem-level category maintenance helpers shared across prompt tooling.
 *
 * Categories are implicit — determined by directory existence under the prompts root.
 * No JSON registry files are used.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CategoryResult {
  effectiveCategory: string;
  created: boolean;
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
  // Nested prompts ({category}/{parent}/{child}/prompt.yaml) are invisible to the
  // one-level directory scan, so qualified ids resolve by direct path instead.
  if (promptId.includes('/')) {
    const segments = promptId.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) {
      return null;
    }
    const nestedDir = path.join(categoryDir, ...segments);
    if (existsSync(path.join(nestedDir, 'prompt.yaml'))) {
      return { id: promptId, path: nestedDir, format: 'directory' };
    }
    const nestedFile = `${nestedDir}.yaml`;
    if (existsSync(nestedFile)) {
      return { id: promptId, path: nestedFile, format: 'file' };
    }
    return null;
  }

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
