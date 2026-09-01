// @lifecycle canonical - Loads prompt and category definitions from disk into structured data.
/**
 * Prompt Loader Module
 * Handles loading prompts from YAML directory structure and markdown templates
 *
 * Features:
 * - YAML prompt discovery and loading (delegated to yaml-prompt-loader)
 * - Markdown file loading with section extraction
 * - Configurable caching for performance (parity with GateDefinitionLoader)
 * - Category-based organization via directory structure
 *
 * @see GateDefinitionLoader for the caching pattern this follows
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { CategoryManager, createCategoryManager } from './category-manager.js';
import { parseMarkdownPromptContent } from './markdown-prompt-parser.js';
import {
  type LoadedPromptFile,
  discoverYamlPrompts,
  hasYamlPrompts,
  loadYamlPrompt as loadYamlPromptFn,
  loadAllYamlPrompts as loadAllYamlPromptsFn,
} from './yaml-prompt-loader.js';

import type { Category, CategoryPromptsResult, PromptData } from './types.js';

import { type Logger } from '#shared/types/index.js';
import { loadYamlFileSync } from '#shared/utils/yaml/index.js';

// Re-export types from yaml-prompt-loader for backward compatibility
export type { LoadedPromptFile } from './yaml-prompt-loader.js';

export interface PromptLoaderConfig {
  /** Enable caching of loaded prompt files (default: true) */
  enableCache?: boolean;
  /** Log debug information */
  debug?: boolean;
}

export interface PromptLoaderStats {
  /** Number of cached prompt files */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
}

export class PromptLoader {
  private logger: Logger;
  private categoryManager: CategoryManager;
  private enableCache: boolean;
  private debug: boolean;

  // Caching infrastructure (mirrors GateDefinitionLoader pattern)
  private promptFileCache = new Map<string, LoadedPromptFile>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };

  constructor(logger: Logger, config: PromptLoaderConfig = {}) {
    this.logger = logger;
    this.categoryManager = createCategoryManager(logger);
    this.enableCache = config.enableCache ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      this.logger.info(
        `[PromptLoader] Initialized with caching ${this.enableCache ? 'enabled' : 'disabled'}`
      );
    }
  }

  /**
   * Clear the prompt file cache (all or specific file)
   *
   * @param filePath - Optional specific file path to clear; if omitted, clears all
   */
  clearCache(filePath?: string): void {
    if (filePath) {
      const normalizedPath = filePath.toLowerCase();
      this.promptFileCache.delete(normalizedPath);
      if (this.debug) {
        this.logger.info(`[PromptLoader] Cleared cache for: ${filePath}`);
      }
    } else {
      const previousSize = this.promptFileCache.size;
      this.promptFileCache.clear();
      if (this.debug) {
        this.logger.info(`[PromptLoader] Cleared entire cache (${previousSize} entries)`);
      }
    }
  }

  /**
   * Get loader statistics
   */
  getStats(): PromptLoaderStats {
    return {
      cacheSize: this.promptFileCache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      loadErrors: this.stats.loadErrors,
    };
  }

  /**
   * Get the CategoryManager instance for external access
   */
  getCategoryManager(): CategoryManager {
    return this.categoryManager;
  }

  /**
   * Load prompts using directory-based discovery (no JSON registry required).
   *
   * This is the modern approach that treats the directory structure as the source of truth:
   * - Each subdirectory under promptsDir is a category
   * - Category metadata is derived from directory name (can be enhanced with category.yaml)
   * - Prompts are discovered via YAML files (both directory and single-file formats)
   *
   * @param promptsDir - Base directory containing category subdirectories
   * @returns Loaded prompts and discovered categories
   */
  async loadFromDirectories(promptsDir: string): Promise<CategoryPromptsResult> {
    this.logger.info(`📂 [PromptLoader] Loading prompts from directory structure: ${promptsDir}`);

    if (!existsSync(promptsDir)) {
      throw new Error(`Prompts directory not found: ${promptsDir}`);
    }

    // Phase 1: Discover categories from directory structure
    const entries = readdirSync(promptsDir, { withFileTypes: true });
    const categoryDirs = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_') &&
        entry.name !== 'backup'
    );

    this.logger.info(`   Found ${categoryDirs.length} category directories`);

    // Phase 2: Build category metadata and load prompts
    const categories: Category[] = [];
    const allPrompts: PromptData[] = [];
    // `loadErrors` is a lifetime counter and this method runs once per root, so the difference —
    // not the total — is what this load contributed.
    const errorsBefore = this.stats.loadErrors;

    for (const categoryEntry of categoryDirs) {
      const categoryId = categoryEntry.name;
      const categoryDir = path.join(promptsDir, categoryId);

      // Try to load category metadata from category.yaml (optional)
      let categoryMeta: Partial<Category> = {};
      const categoryYamlPath = path.join(categoryDir, 'category.yaml');
      if (existsSync(categoryYamlPath)) {
        try {
          categoryMeta = loadYamlFileSync(categoryYamlPath) as Partial<Category>;
        } catch (e) {
          this.logger.warn(`[PromptLoader] Failed to load category.yaml for ${categoryId}:`, e);
        }
      }

      // Build category with sensible defaults
      const category: Category = {
        id: categoryId,
        name: categoryMeta.name || this.formatCategoryName(categoryId),
        description: categoryMeta.description || `Prompts in the ${categoryId} category`,
      };
      if (categoryMeta.registerWithMcp !== undefined) {
        category.registerWithMcp = categoryMeta.registerWithMcp;
      }
      if (categoryMeta.mcpPromptMode !== undefined) {
        category.mcpPromptMode = categoryMeta.mcpPromptMode;
      }

      categories.push(category);

      // Discover and load YAML prompts in this category
      const yamlPrompts = this.loadAllYamlPrompts(categoryDir);

      for (const prompt of yamlPrompts) {
        // Ensure category is set correctly
        prompt.category = categoryId;
        // Prepend category to file path
        prompt.file = path.join(categoryId, prompt.file);

        // Attach category's registerWithMcp if set
        if (category.registerWithMcp !== undefined) {
          (prompt as PromptData & { _categoryRegisterWithMcp?: boolean })._categoryRegisterWithMcp =
            category.registerWithMcp;
        }
        // Attach category's mcpPromptMode if set
        if (category.mcpPromptMode !== undefined) {
          (
            prompt as PromptData & { _categoryMcpPromptMode?: 'expand' | 'launch' }
          )._categoryMcpPromptMode = category.mcpPromptMode;
        }

        allPrompts.push(prompt);
      }

      if (yamlPrompts.length > 0) {
        this.logger.info(`   📁 ${categoryId}: ${yamlPrompts.length} prompts`);
      }
    }

    // Load categories into CategoryManager
    await this.categoryManager.loadCategories(categories);

    const invalid = this.stats.loadErrors - errorsBefore;
    this.logger.info(
      `✅ [PromptLoader] Loaded ${allPrompts.length} prompts from ${categories.length} categories` +
        (invalid > 0 ? ` (${invalid} could not be loaded)` : '')
    );

    return { promptsData: allPrompts, categories, invalid };
  }

  /**
   * Format a category ID into a human-readable name.
   * Example: "codebase-setup" -> "Codebase Setup"
   */
  private formatCategoryName(categoryId: string): string {
    return categoryId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Load prompt content from markdown file or YAML directory
   *
   * Uses caching when enabled to avoid repeated file reads.
   * Supports both legacy markdown format and new YAML directory format.
   *
   * @param filePath - Relative path to the prompt file (markdown or prompt.yaml)
   * @param basePath - Base directory for prompt files
   * @returns Parsed prompt content with system message, user template, and optional chain steps
   */
  async loadPromptFile(filePath: string, basePath: string): Promise<LoadedPromptFile> {
    const fullPath = path.join(basePath, filePath);
    const cacheKey = fullPath.toLowerCase();

    // Check cache first
    if (this.enableCache) {
      const cached = this.promptFileCache.get(cacheKey);
      if (cached) {
        this.stats.cacheHits++;
        if (this.debug) {
          this.logger.debug(`[PromptLoader] Cache hit for: ${filePath}`);
        }
        return cached;
      }
      this.stats.cacheMisses++;
    }

    // Handle YAML format (both directory and single-file patterns)
    if (filePath.endsWith('.yaml')) {
      // Determine the correct path to pass to loadYamlPrompt:
      // - For directory format ({id}/prompt.yaml): pass directory path
      // - For file format ({id}.yaml): pass file path directly
      const promptPath =
        filePath.endsWith('/prompt.yaml') || filePath.endsWith('\\prompt.yaml')
          ? path.dirname(fullPath) // Directory format
          : fullPath; // File format
      const result = this.loadYamlPrompt(promptPath);
      if (result) {
        return result.loadedContent;
      }
      throw new Error(`Failed to load YAML prompt from ${filePath}`);
    }

    try {
      const content = await readFile(fullPath, 'utf8');
      const result = parseMarkdownPromptContent(content, filePath, { logger: this.logger });

      // Cache the result
      if (this.enableCache) {
        this.promptFileCache.set(cacheKey, result);
        if (this.debug) {
          this.logger.debug(
            `[PromptLoader] Cached prompt file: ${filePath} (cache size: ${this.promptFileCache.size})`
          );
        }
      }

      return result;
    } catch (error) {
      this.stats.loadErrors++;
      this.logger.error(`Error loading prompt file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Check if caching is enabled
   */
  isCacheEnabled(): boolean {
    return this.enableCache;
  }

  /**
   * Enable or disable caching at runtime
   */
  setCacheEnabled(enabled: boolean): void {
    this.enableCache = enabled;
    if (!enabled) {
      this.clearCache();
    }
  }

  /** Build the shared context for YAML loading functions. */
  private get yamlCtx() {
    return {
      logger: this.logger,
      cache: this.promptFileCache,
      stats: this.stats,
      enableCache: this.enableCache,
      debug: this.debug,
    };
  }

  /**
   * Discover YAML-based prompts in a category directory.
   * @see discoverYamlPrompts in yaml-prompt-loader.ts for full documentation.
   */
  discoverYamlPrompts(categoryDir: string, prefix: string = ''): string[] {
    return discoverYamlPrompts(categoryDir, prefix);
  }

  /**
   * Load a prompt from YAML format (directory or single file).
   * @see loadYamlPrompt in yaml-prompt-loader.ts for full documentation.
   */
  loadYamlPrompt(
    promptPath: string,
    categoryRoot?: string
  ): {
    promptData: PromptData;
    loadedContent: LoadedPromptFile;
  } | null {
    return loadYamlPromptFn(promptPath, categoryRoot, this.yamlCtx);
  }

  /**
   * Load all YAML prompts from a category directory.
   * @see loadAllYamlPrompts in yaml-prompt-loader.ts for full documentation.
   */
  loadAllYamlPrompts(categoryDir: string): PromptData[] {
    return loadAllYamlPromptsFn(categoryDir, this.yamlCtx);
  }

  /**
   * Check if a directory contains YAML-format prompts.
   */
  hasYamlPrompts(categoryDir: string): boolean {
    return hasYamlPrompts(categoryDir);
  }
}
