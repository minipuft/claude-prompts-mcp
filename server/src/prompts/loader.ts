// @lifecycle canonical - Loads prompt and category definitions from disk into structured data.
/**
 * Prompt Loader Module
 * Handles loading prompts from category-specific configuration files and markdown templates
 *
 * Features:
 * - Runtime JSON parsing for prompts.json files
 * - Markdown file loading with section extraction
 * - Configurable caching for performance (parity with GateDefinitionLoader)
 * - Category-based organization
 *
 * @see GateDefinitionLoader for the caching pattern this follows
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { CategoryManager, createCategoryManager } from './category-manager.js';
import { validatePromptYaml, type PromptYaml } from './prompt-schema.js';
import { safeWriteFile } from './promptUtils.js';
import { Logger } from '../logging/index.js';
import {
  Category,
  CategoryPromptsResult,
  PromptArgument,
  PromptData,
  PromptsConfigFile,
} from '../types/index.js';
import { loadYamlFileSync } from '../utils/yaml/index.js';

// ============================================
// Configuration Types
// ============================================

/**
 * Configuration for PromptLoader
 */
export interface PromptLoaderConfig {
  /** Enable caching of loaded prompt files (default: true) */
  enableCache?: boolean;
  /** Log debug information */
  debug?: boolean;
}

/**
 * Statistics from the loader
 */
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

/**
 * Loaded prompt file content (cached type)
 */
export interface LoadedPromptFile {
  systemMessage?: string;
  userMessageTemplate: string;
  isChain?: boolean;
  gateConfiguration?: {
    include?: string[];
    exclude?: string[];
    framework_gates?: boolean;
    inline_gate_definitions?: Array<{
      id?: string;
      name: string;
      type: 'validation' | 'guidance';
      scope: 'execution' | 'session' | 'chain' | 'step';
      description: string;
      guidance: string;
      pass_criteria: any[];
      expires_at?: number;
      source?: 'manual' | 'automatic' | 'analysis';
      context?: Record<string, any>;
    }>;
  };
  chainSteps?: Array<{
    promptId: string;
    stepName: string;
    inputMapping?: Record<string, string>;
    outputMapping?: Record<string, string>;
    retries?: number;
  }>;
}

type InlineGateDefinition = NonNullable<
  NonNullable<LoadedPromptFile['gateConfiguration']>['inline_gate_definitions']
>[number];
type InlineGateDefinitions = InlineGateDefinition[];

// ============================================
// Prompt Loader Class
// ============================================

/**
 * Prompt Loader class
 *
 * Provides loading of prompt definitions from JSON config files and markdown templates.
 * Includes configurable caching for performance optimization.
 *
 * @example
 * ```typescript
 * const loader = new PromptLoader(logger, { enableCache: true });
 *
 * // Load prompts from config
 * const { promptsData, categories } = await loader.loadCategoryPrompts('prompts/promptsConfig.json');
 *
 * // Load individual prompt file (cached)
 * const promptContent = await loader.loadPromptFile('development/code_review.md', 'prompts');
 *
 * // Clear cache when files change
 * loader.clearCache();
 * ```
 */
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
   * Load prompts from category-specific prompts.json files
   */
  async loadCategoryPrompts(configPath: string): Promise<CategoryPromptsResult> {
    try {
      this.logger.info(`🔍 PromptLoader: Starting to load category prompts from: ${configPath}`);

      // Read the promptsConfig.json file
      this.logger.info('📖 Reading promptsConfig.json file...');
      const configContent = await readFile(configPath, 'utf8');
      this.logger.info(`✓ Config file read successfully, ${configContent.length} characters`);

      let promptsConfig: PromptsConfigFile;

      try {
        this.logger.info('🔧 Parsing promptsConfig.json...');
        promptsConfig = JSON.parse(configContent) as PromptsConfigFile;
        this.logger.info('✓ Config file parsed successfully');
      } catch (jsonError) {
        this.logger.error(`❌ Error parsing config file ${configPath}:`, jsonError);
        throw new Error(
          `Invalid JSON in config file: ${
            jsonError instanceof Error ? jsonError.message : String(jsonError)
          }`
        );
      }

      // Log the parsed config structure
      this.logger.info(`📋 Config structure analysis:`);
      this.logger.info(`   - Categories defined: ${promptsConfig.categories?.length || 0}`);
      this.logger.info(`   - Import paths defined: ${promptsConfig.imports?.length || 0}`);

      if (promptsConfig.categories?.length > 0) {
        this.logger.info('📂 Categories found:');
        promptsConfig.categories.forEach((cat) => {
          this.logger.info(`   - ${cat.name} (${cat.id}): ${cat.description}`);
        });
      }

      if (promptsConfig.imports?.length > 0) {
        this.logger.info('📥 Import paths to process:');
        promptsConfig.imports.forEach((importPath, index) => {
          this.logger.info(`   ${index + 1}. ${importPath}`);
        });
      }

      // Ensure required properties exist
      if (!promptsConfig.categories) {
        this.logger.warn(
          `⚠️ Config file ${configPath} does not have a 'categories' array. Initializing it.`
        );
        promptsConfig.categories = [];
      }

      if (!promptsConfig.imports || !Array.isArray(promptsConfig.imports)) {
        this.logger.warn(
          `⚠️ Config file ${configPath} does not have a valid 'imports' array. Initializing it.`
        );
        promptsConfig.imports = [];
      }

      // Load and validate categories using CategoryManager
      const categoryValidation = await this.categoryManager.loadCategories(
        promptsConfig.categories
      );

      if (!categoryValidation.isValid) {
        this.logger.error('❌ Category validation failed:');
        categoryValidation.issues.forEach((issue) => this.logger.error(`  - ${issue}`));
        throw new Error(`Category validation failed: ${categoryValidation.issues.join('; ')}`);
      }

      if (categoryValidation.warnings.length > 0) {
        this.logger.warn('⚠️ Category validation warnings:');
        categoryValidation.warnings.forEach((warning) => this.logger.warn(`  - ${warning}`));
      }

      // Get validated categories
      const categories = this.categoryManager.getCategories();

      // Initialize an array to store all prompts
      let allPrompts: PromptData[] = [];
      let totalImportProcessed = 0;
      let totalImportsFailed = 0;

      this.logger.info(`🚀 Starting to process ${promptsConfig.imports.length} import paths...`);

      // Load prompts from each import path
      for (const importPath of promptsConfig.imports) {
        totalImportProcessed++;
        this.logger.info(
          `\n📦 Processing import ${totalImportProcessed}/${promptsConfig.imports.length}: ${importPath}`
        );

        try {
          // Construct the full path to the import file
          const fullImportPath = path.join(path.dirname(configPath), importPath);

          this.logger.info(`   🔍 Full path: ${fullImportPath}`);

          // Check if the file exists
          try {
            await fs.access(fullImportPath);
            this.logger.info(`   ✓ Import file exists`);
          } catch (error) {
            this.logger.warn(`   ⚠️ Import file not found: ${importPath}. Creating empty file.`);

            // Create the directory if it doesn't exist
            const dir = path.dirname(fullImportPath);
            await fs.mkdir(dir, { recursive: true });

            // Create an empty prompts file
            await safeWriteFile(fullImportPath, JSON.stringify({ prompts: [] }, null, 2), 'utf8');
            this.logger.info(`   ✓ Created empty prompts file`);
          }

          // Read the file
          this.logger.info(`   📖 Reading import file...`);
          const fileContent = await readFile(fullImportPath, 'utf8');
          this.logger.info(`   ✓ File read successfully, ${fileContent.length} characters`);

          let categoryPromptsFile: any;

          try {
            categoryPromptsFile = JSON.parse(fileContent);
            this.logger.info(`   ✓ Import file parsed successfully`);
          } catch (jsonError) {
            this.logger.error(`   ❌ Error parsing import file ${importPath}:`, jsonError);
            this.logger.info(
              `   🔧 Creating empty prompts file for ${importPath} due to parsing error.`
            );
            categoryPromptsFile = { prompts: [] };
            await safeWriteFile(
              fullImportPath,
              JSON.stringify(categoryPromptsFile, null, 2),
              'utf8'
            );
          }

          // Ensure prompts property exists and is an array
          if (!categoryPromptsFile.prompts) {
            this.logger.warn(
              `   ⚠️ Import file ${importPath} does not have a 'prompts' array. Initializing it.`
            );
            categoryPromptsFile.prompts = [];
            await safeWriteFile(
              fullImportPath,
              JSON.stringify(categoryPromptsFile, null, 2),
              'utf8'
            );
          } else if (!Array.isArray(categoryPromptsFile.prompts)) {
            this.logger.warn(
              `   ⚠️ Import file ${importPath} has an invalid 'prompts' property (not an array). Resetting it.`
            );
            categoryPromptsFile.prompts = [];
            await safeWriteFile(
              fullImportPath,
              JSON.stringify(categoryPromptsFile, null, 2),
              'utf8'
            );
          }

          this.logger.info(
            `   📊 Found ${categoryPromptsFile.prompts.length} prompts in this import`
          );

          // Update the file path to be relative to the category folder
          const categoryPath = path.dirname(importPath);
          const beforeCount = categoryPromptsFile.prompts.length;

          const categoryPrompts = categoryPromptsFile.prompts
            .map((prompt: PromptData, index: number) => {
              // Ensure prompt has all required properties
              if (!prompt.id || !prompt.name || !prompt.file) {
                this.logger.warn(
                  `   ⚠️ Skipping invalid prompt ${
                    index + 1
                  } in ${importPath}: missing required properties (id: ${!!prompt.id}, name: ${!!prompt.name}, file: ${!!prompt.file})`
                );
                return null;
              }

              // If the file path is already absolute or starts with the category folder, keep it as is
              if (prompt.file.startsWith('/') || prompt.file.startsWith(categoryPath)) {
                return prompt;
              }

              // Otherwise, update the file path to include the category folder
              return {
                ...prompt,
                file: path.join(categoryPath, prompt.file),
              };
            })
            .filter(Boolean); // Remove any null entries (invalid prompts)

          const afterCount = categoryPrompts.length;
          if (beforeCount !== afterCount) {
            this.logger.warn(
              `   ⚠️ ${beforeCount - afterCount} prompts were filtered out due to validation issues`
            );
          }

          this.logger.info(
            `   ✅ Successfully processed ${afterCount} valid prompts from ${importPath}`
          );

          // Add the prompts to the array
          allPrompts = [...allPrompts, ...categoryPrompts];
        } catch (error) {
          totalImportsFailed++;
          this.logger.error(`   ❌ Error loading prompts from ${importPath}:`, error);
        }
      }

      this.logger.info(`\n🎯 JSON IMPORT PROCESSING SUMMARY:`);
      this.logger.info(`   Total imports processed: ${totalImportProcessed}`);
      this.logger.info(`   Imports failed: ${totalImportsFailed}`);
      this.logger.info(`   Imports succeeded: ${totalImportProcessed - totalImportsFailed}`);
      this.logger.info(`   JSON prompts collected: ${allPrompts.length}`);

      // Phase 2: Load YAML-format prompts from category directories
      const promptsBaseDir = path.dirname(configPath);
      let yamlPromptsLoaded = 0;
      let yamlPromptsSkipped = 0;
      const jsonPromptIds = new Set(allPrompts.map((p) => p.id));

      this.logger.info(`\n📦 Scanning for YAML-format prompts...`);

      for (const category of promptsConfig.categories) {
        const categoryDir = path.join(promptsBaseDir, category.id);
        if (!existsSync(categoryDir)) {
          continue;
        }

        const yamlPrompts = this.loadAllYamlPrompts(categoryDir);
        for (const yamlPrompt of yamlPrompts) {
          // Skip if JSON version already loaded (backward compatibility during transition)
          if (jsonPromptIds.has(yamlPrompt.id)) {
            if (this.debug) {
              this.logger.debug(
                `   ⏭️ Skipping YAML prompt ${yamlPrompt.id} (JSON version exists)`
              );
            }
            yamlPromptsSkipped++;
            continue;
          }

          // Ensure category is set correctly
          yamlPrompt.category = category.id;
          // Prepend category to file path (already has correct format from loadYamlPrompt)
          // - Directory format: {category}/{id}/prompt.yaml
          // - File format: {category}/{id}.yaml
          yamlPrompt.file = path.join(category.id, yamlPrompt.file);
          allPrompts.push(yamlPrompt);
          yamlPromptsLoaded++;
        }
      }

      if (yamlPromptsLoaded > 0 || yamlPromptsSkipped > 0) {
        this.logger.info(`🎯 YAML PROMPT LOADING SUMMARY:`);
        this.logger.info(`   YAML prompts loaded: ${yamlPromptsLoaded}`);
        this.logger.info(`   YAML prompts skipped (JSON exists): ${yamlPromptsSkipped}`);
      }

      this.logger.info(`\n📊 TOTAL PROMPTS: ${allPrompts.length}`);
      this.logger.info(`   Categories available: ${categories.length}`);

      // Attach category's registerWithMcp default to each prompt
      const categoryMap = new Map(categories.map((cat) => [cat.id, cat]));
      allPrompts = allPrompts.map((prompt) => {
        const category = categoryMap.get(prompt.category);
        if (category?.registerWithMcp !== undefined) {
          return { ...prompt, _categoryRegisterWithMcp: category.registerWithMcp } as PromptData & {
            _categoryRegisterWithMcp?: boolean;
          };
        }
        return prompt;
      });

      // Validate category-prompt relationships using CategoryManager
      this.logger.info(`🔍 Validating category-prompt relationships...`);
      const promptCategoryValidation = this.categoryManager.validatePromptCategories(allPrompts);

      if (!promptCategoryValidation.isValid) {
        this.logger.error('❌ Category-prompt relationship validation failed:');
        promptCategoryValidation.issues.forEach((issue) => this.logger.error(`  - ${issue}`));
        this.logger.warn('Continuing with loading but some prompts may not display correctly');
      }

      if (promptCategoryValidation.warnings.length > 0) {
        this.logger.warn('⚠️ Category-prompt relationship warnings:');
        promptCategoryValidation.warnings.forEach((warning) => this.logger.warn(`  - ${warning}`));
      }

      // Generate category statistics for debugging
      const categoryStats = this.categoryManager.getCategoryStatistics(allPrompts);
      this.logger.info(`📊 Category Statistics:`);
      this.logger.info(
        `   Categories with prompts: ${categoryStats.categoriesWithPrompts}/${categoryStats.totalCategories}`
      );
      this.logger.info(`   Empty categories: ${categoryStats.emptyCategoriesCount}`);
      this.logger.info(
        `   Average prompts per category: ${categoryStats.averagePromptsPerCategory.toFixed(1)}`
      );

      const result = { promptsData: allPrompts, categories };
      this.logger.info(`✅ PromptLoader.loadCategoryPrompts() completed successfully`);

      return result;
    } catch (error) {
      this.logger.error(`❌ PromptLoader.loadCategoryPrompts() FAILED:`, error);
      throw error;
    }
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

        allPrompts.push(prompt);
      }

      if (yamlPrompts.length > 0) {
        this.logger.info(`   📁 ${categoryId}: ${yamlPrompts.length} prompts`);
      }
    }

    // Load categories into CategoryManager
    await this.categoryManager.loadCategories(categories);

    this.logger.info(
      `✅ [PromptLoader] Loaded ${allPrompts.length} prompts from ${categories.length} categories`
    );

    return { promptsData: allPrompts, categories };
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

      // Extract system message and user message template from markdown
      const systemMessageMatch = content.match(/## System Message\s*\n([\s\S]*?)(?=\n##|$)/);
      const userMessageMatch = content.match(/## User Message Template\s*\n([\s\S]*)$/);

      const systemMessage = systemMessageMatch?.[1]?.trim();
      let userMessageTemplate = userMessageMatch?.[1]?.trim() ?? '';

      // Extract gate configuration if present (Enhanced gate configuration with inline gates)
      let gateConfiguration: LoadedPromptFile['gateConfiguration'];

      const gateConfigMatch = content.match(
        /## Gate Configuration\s*\n```json\s*\n([\s\S]*?)\n```/
      );

      if (gateConfigMatch) {
        try {
          const gateConfigContent = gateConfigMatch[1]?.trim();
          if (gateConfigContent) {
            const parsedConfig = JSON.parse(gateConfigContent);

            // Validate and normalize the gate configuration
            if (Array.isArray(parsedConfig)) {
              // Simple array format: ["gate1", "gate2"]
              gateConfiguration = {
                include: parsedConfig,
                framework_gates: true,
              };
            } else if (typeof parsedConfig === 'object' && parsedConfig !== null) {
              // Object format: {"include": [...], "exclude": [...], "framework_gates": true, "inline_gate_definitions": [...]}
              const normalizedGateConfiguration: LoadedPromptFile['gateConfiguration'] = {};
              if (Array.isArray(parsedConfig.include)) {
                normalizedGateConfiguration.include = parsedConfig.include;
              }
              if (Array.isArray(parsedConfig.exclude)) {
                normalizedGateConfiguration.exclude = parsedConfig.exclude;
              }
              if (typeof parsedConfig.framework_gates === 'boolean') {
                normalizedGateConfiguration.framework_gates = parsedConfig.framework_gates;
              }
              const inlineGateDefinitions = this.normalizeInlineGateDefinitions(
                parsedConfig.inline_gate_definitions
              );
              if (inlineGateDefinitions) {
                normalizedGateConfiguration.inline_gate_definitions = inlineGateDefinitions;
              }

              if (Object.keys(normalizedGateConfiguration).length > 0) {
                gateConfiguration = normalizedGateConfiguration;
              }
            }
          }

          this.logger.debug(
            `[LOADER] Gate configuration parsed for ${filePath}:`,
            gateConfiguration
          );

          // Fix: Strip Gate Configuration section from userMessageTemplate
          // so it doesn't appear in the output to the user
          if (gateConfigMatch) {
            const gateConfigSectionRegex = /## Gate Configuration\s*\n```json\s*\n[\s\S]*?\n```\s*/;
            userMessageTemplate = userMessageTemplate.replace(gateConfigSectionRegex, '').trim();
            this.logger.debug(
              `[LOADER] Stripped Gate Configuration section from user message template for ${filePath}`
            );
          }
        } catch (gateConfigError) {
          this.logger.warn(
            `[LOADER] Failed to parse gate configuration in ${filePath}:`,
            gateConfigError
          );
        }
      }

      // Extract chain information if present
      const chainMatch = content.match(/## Chain Steps\s*\n([\s\S]*?)(?=\n##|$)/);
      let chainSteps: Array<{
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string>;
        outputMapping?: Record<string, string>;
      }> = [];

      if (chainMatch) {
        const chainContent = chainMatch[1]?.trim();
        if (!chainContent) {
          this.logger.warn(`[LOADER] Chain steps section found but empty in ${filePath}`);
        } else {
          // Regex to match markdown chain step format
          const stepMatches = chainContent.matchAll(
            /(\d+)\.\s*promptId:\s*([^\n]+)\s*\n\s*stepName:\s*([^\n]+)(?:\s*\n\s*inputMapping:\s*([\s\S]*?)(?=\s*\n\s*(?:outputMapping|promptId|\d+\.|$)))?\s*(?:\n\s*outputMapping:\s*([\s\S]*?)(?=\s*\n\s*(?:promptId|\d+\.|$)))?\s*/g
          );

          for (const match of stepMatches) {
            const stepNumber = match[1];
            const promptId = match[2];
            const stepName = match[3];
            const inputMappingStr = match[4];
            const outputMappingStr = match[5];

            if (!promptId || !stepName) {
              this.logger.warn(
                `Skipping invalid chain step ${stepNumber ?? 'unknown'} in ${filePath}: missing promptId or stepName`
              );
              continue;
            }

            const step: {
              promptId: string;
              stepName: string;
              inputMapping?: Record<string, string>;
              outputMapping?: Record<string, string>;
            } = {
              promptId: promptId.trim(),
              stepName: stepName.trim(),
            };

            if (inputMappingStr) {
              try {
                // Parse YAML-style mapping into JSON object
                const inputMapping: Record<string, string> = {};
                const lines = inputMappingStr.trim().split('\n');
                for (const line of lines) {
                  const [key, value] = line
                    .trim()
                    .split(':')
                    .map((s) => s.trim());
                  if (key && value) {
                    inputMapping[key] = value;
                  }
                }
                step.inputMapping = inputMapping;
              } catch (e) {
                this.logger.warn(
                  `Invalid input mapping in chain step ${stepNumber} of ${filePath}: ${e}`
                );
              }
            }

            if (outputMappingStr) {
              try {
                // Parse YAML-style mapping into JSON object
                const outputMapping: Record<string, string> = {};
                const lines = outputMappingStr.trim().split('\n');
                for (const line of lines) {
                  const [key, value] = line
                    .trim()
                    .split(':')
                    .map((s) => s.trim());
                  if (key && value) {
                    outputMapping[key] = value;
                  }
                }
                step.outputMapping = outputMapping;
              } catch (e) {
                this.logger.warn(
                  `Invalid output mapping in chain step ${stepNumber} of ${filePath}: ${e}`
                );
              }
            }

            chainSteps.push(step);
          }

          this.logger.debug(`Loaded chain with ${chainSteps.length} steps from ${filePath}`);
        }
      }

      if (!userMessageTemplate && !(chainSteps.length > 0)) {
        throw new Error(`No user message template found in ${filePath}`);
      }

      const result: LoadedPromptFile = {
        userMessageTemplate,
        chainSteps,
      };

      if (systemMessage !== undefined) {
        result.systemMessage = systemMessage;
      }

      if (gateConfiguration) {
        result.gateConfiguration = gateConfiguration;
      }

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

  // ============================================
  // YAML Format Loading (Phase 2 - Hybrid Pattern)
  // ============================================

  /**
   * Discover YAML-based prompts in a category directory.
   *
   * Supports two patterns:
   * 1. **Directory pattern** (complex prompts): `{category}/{prompt_id}/prompt.yaml`
   *    - Supports external file references (user-message.md, system-message.md)
   *    - Best for prompts with long templates or multiple components
   *
   * 2. **File pattern** (simple prompts): `{category}/{prompt_id}.yaml`
   *    - All content inline in a single YAML file
   *    - Best for simple prompts with short templates
   *
   * @param categoryDir - Path to the category directory
   * @returns Array of prompt paths (directories take precedence over files with same ID)
   */
  discoverYamlPrompts(categoryDir: string): string[] {
    if (!existsSync(categoryDir)) {
      return [];
    }

    const entries = readdirSync(categoryDir, { withFileTypes: true });
    const discoveries: Map<string, { path: string; format: 'directory' | 'file' }> = new Map();

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        // Directory pattern: {prompt_id}/prompt.yaml
        const promptYamlPath = path.join(categoryDir, entry.name, 'prompt.yaml');
        if (existsSync(promptYamlPath)) {
          // Directory takes precedence over file with same ID
          discoveries.set(entry.name, {
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
        // Only add if no directory version exists
        if (!discoveries.has(promptId)) {
          discoveries.set(promptId, {
            path: path.join(categoryDir, entry.name),
            format: 'file',
          });
        }
      }
    }

    // Return paths (backward compatible - just paths, format handled in loadYamlPrompt)
    return Array.from(discoveries.values()).map((d) => d.path);
  }

  /**
   * Load a prompt from YAML format (directory or single file).
   *
   * Supports two patterns:
   *
   * **Directory pattern** (for complex prompts with external files):
   * ```
   * {prompt_id}/
   * ├── prompt.yaml           # Main definition with file references
   * ├── user-message.md       # Template content (referenced via userMessageTemplateFile)
   * └── system-message.md     # Optional system prompt (referenced via systemMessageFile)
   * ```
   *
   * **File pattern** (for simple prompts with inline content):
   * ```
   * {prompt_id}.yaml          # Complete prompt with inline userMessageTemplate
   * ```
   *
   * @param promptPath - Path to the prompt directory OR single YAML file
   * @returns Loaded prompt data with inlined content
   */
  loadYamlPrompt(promptPath: string): {
    promptData: PromptData;
    loadedContent: LoadedPromptFile;
  } | null {
    // Determine format: directory or single file
    const isFile = promptPath.endsWith('.yaml');
    const yamlPath = isFile ? promptPath : path.join(promptPath, 'prompt.yaml');
    const baseDir = isFile ? path.dirname(promptPath) : promptPath;
    const promptId = isFile ? path.basename(promptPath, '.yaml') : path.basename(promptPath);

    // Check cache first
    // Compute relative file path for PromptData.file
    // - Directory format: {id}/prompt.yaml
    // - File format: {id}.yaml
    const relativeFilePath = isFile ? `${promptId}.yaml` : `${promptId}/prompt.yaml`;

    const cacheKey = yamlPath.toLowerCase();
    if (this.enableCache && this.promptFileCache.has(cacheKey)) {
      this.stats.cacheHits++;
      const cached = this.promptFileCache.get(cacheKey)!;
      // Reconstruct promptData from cached content - need to reload yaml for metadata
      const yamlData = loadYamlFileSync(yamlPath) as PromptYaml;
      return {
        promptData: this.yamlToPromptData(yamlData, relativeFilePath),
        loadedContent: cached,
      };
    }
    this.stats.cacheMisses++;

    if (!existsSync(yamlPath)) {
      this.logger.warn(`[PromptLoader] YAML file not found: ${yamlPath}`);
      return null;
    }

    // Load and validate YAML
    let yamlData: PromptYaml;
    try {
      const rawData = loadYamlFileSync(yamlPath);
      const validation = validatePromptYaml(rawData, promptId);

      if (!validation.valid) {
        this.logger.error(
          `[PromptLoader] Invalid YAML in ${yamlPath}: ${validation.errors.join(', ')}`
        );
        this.stats.loadErrors++;
        return null;
      }

      if (validation.warnings.length > 0 && this.debug) {
        this.logger.warn(
          `[PromptLoader] Warnings for ${promptId}: ${validation.warnings.join(', ')}`
        );
      }

      yamlData = validation.data!;
    } catch (e) {
      this.logger.error(`[PromptLoader] Failed to load YAML from ${yamlPath}:`, e);
      this.stats.loadErrors++;
      return null;
    }

    // Inline file references (only applicable for directory format)
    let systemMessage: string | undefined;
    let userMessageTemplate: string;

    // System message (optional)
    if (yamlData.systemMessageFile) {
      const systemMessagePath = path.join(baseDir, yamlData.systemMessageFile);
      if (existsSync(systemMessagePath)) {
        systemMessage = readFileSync(systemMessagePath, 'utf-8');
      } else {
        this.logger.warn(`[PromptLoader] systemMessageFile not found: ${systemMessagePath}`);
      }
    } else if (yamlData.systemMessage) {
      systemMessage = yamlData.systemMessage;
    }

    // User message template (required unless chain)
    if (yamlData.userMessageTemplateFile) {
      const userMessagePath = path.join(baseDir, yamlData.userMessageTemplateFile);
      if (existsSync(userMessagePath)) {
        userMessageTemplate = readFileSync(userMessagePath, 'utf-8');
      } else {
        this.logger.error(`[PromptLoader] userMessageTemplateFile not found: ${userMessagePath}`);
        this.stats.loadErrors++;
        return null;
      }
    } else if (yamlData.userMessageTemplate) {
      userMessageTemplate = yamlData.userMessageTemplate;
    } else if (yamlData.chainSteps && yamlData.chainSteps.length > 0) {
      // Chain prompts may not have a user message template
      userMessageTemplate = '';
    } else {
      this.logger.error(
        `[PromptLoader] No userMessageTemplate or userMessageTemplateFile in ${yamlPath}`
      );
      this.stats.loadErrors++;
      return null;
    }

    const loadedContent: LoadedPromptFile = {
      userMessageTemplate,
    };

    if (systemMessage !== undefined) {
      loadedContent.systemMessage = systemMessage;
    }

    const normalizedGateConfiguration: LoadedPromptFile['gateConfiguration'] | undefined = (() => {
      const configuration = yamlData.gateConfiguration;
      if (!configuration) {
        return undefined;
      }
      const normalized: LoadedPromptFile['gateConfiguration'] = {};
      if (Array.isArray(configuration.include)) {
        normalized.include = configuration.include;
      }
      if (Array.isArray(configuration.exclude)) {
        normalized.exclude = configuration.exclude;
      }
      if (typeof configuration.framework_gates === 'boolean') {
        normalized.framework_gates = configuration.framework_gates;
      }
      const inlineGateDefinitions = this.normalizeInlineGateDefinitions(
        configuration.inline_gate_definitions
      );
      if (inlineGateDefinitions) {
        normalized.inline_gate_definitions = inlineGateDefinitions;
      }
      return Object.keys(normalized).length > 0 ? normalized : undefined;
    })();

    if (normalizedGateConfiguration) {
      loadedContent.gateConfiguration = normalizedGateConfiguration;
    }

    if (yamlData.chainSteps) {
      const normalizedChainSteps = yamlData.chainSteps.map((step) => {
        const normalizedStep: NonNullable<LoadedPromptFile['chainSteps']>[number] = {
          promptId: step.promptId,
          stepName: step.stepName,
        };
        if (step.inputMapping) {
          normalizedStep.inputMapping = step.inputMapping;
        }
        if (step.outputMapping) {
          normalizedStep.outputMapping = step.outputMapping;
        }
        if (typeof step.retries === 'number') {
          normalizedStep.retries = step.retries;
        }
        return normalizedStep;
      });

      loadedContent.chainSteps = normalizedChainSteps;
      loadedContent.isChain = normalizedChainSteps.length > 0;
    }

    // Cache the result
    if (this.enableCache) {
      this.promptFileCache.set(cacheKey, loadedContent);
      if (this.debug) {
        this.logger.debug(
          `[PromptLoader] Cached YAML prompt: ${promptId} (cache size: ${this.promptFileCache.size})`
        );
      }
    }

    return {
      promptData: this.yamlToPromptData(yamlData, relativeFilePath),
      loadedContent,
    };
  }

  private normalizeInlineGateDefinitions(definitions: unknown): InlineGateDefinitions | undefined {
    if (!Array.isArray(definitions)) {
      return undefined;
    }

    const normalized: InlineGateDefinitions = [];

    for (const rawDefinition of definitions) {
      if (!rawDefinition || typeof rawDefinition !== 'object') {
        continue;
      }

      const definition = rawDefinition as Record<string, unknown>;
      const name = definition['name'];
      const type = definition['type'];
      const scope = definition['scope'];
      const description = definition['description'];
      const guidance = definition['guidance'];

      if (
        typeof name !== 'string' ||
        (type !== 'validation' && type !== 'guidance') ||
        (scope !== 'execution' && scope !== 'session' && scope !== 'chain' && scope !== 'step') ||
        typeof description !== 'string' ||
        typeof guidance !== 'string'
      ) {
        continue;
      }

      const inlineDefinition: InlineGateDefinition = {
        name,
        type,
        scope,
        description,
        guidance,
        pass_criteria: Array.isArray(definition['pass_criteria'])
          ? definition['pass_criteria']
          : [],
      };

      const id = definition['id'];
      if (typeof id === 'string') {
        inlineDefinition.id = id;
      }

      const expiresAt = definition['expires_at'];
      if (typeof expiresAt === 'number') {
        inlineDefinition.expires_at = expiresAt;
      }

      const source = definition['source'];
      if (source === 'manual' || source === 'automatic' || source === 'analysis') {
        inlineDefinition.source = source;
      }

      const context = definition['context'];
      if (context && typeof context === 'object') {
        inlineDefinition.context = context as Record<string, unknown>;
      }

      normalized.push(inlineDefinition);
    }

    return normalized.length > 0 ? normalized : undefined;
  }

  /**
   * Convert YAML prompt definition to PromptData structure.
   *
   * @param yaml - Parsed and validated YAML data
   * @param filePath - Optional file path override (for single-file format)
   */
  private yamlToPromptData(yaml: PromptYaml, filePath?: string): PromptData {
    const promptData: PromptData = {
      id: yaml.id,
      name: yaml.name,
      category: yaml.category ?? 'general',
      description: yaml.description,
      // File path depends on format:
      // - Directory format: {id}/prompt.yaml
      // - File format: {id}.yaml
      file: filePath ?? `${yaml.id}/prompt.yaml`,
      arguments:
        yaml.arguments?.map((arg) => {
          const normalizedArg: PromptArgument = {
            name: arg.name,
            required: arg.required ?? false,
          };

          if (arg.description !== undefined) {
            normalizedArg.description = arg.description;
          }
          if (arg.type !== undefined) {
            normalizedArg.type = arg.type;
          }
          if (arg.defaultValue !== undefined) {
            normalizedArg.defaultValue = arg.defaultValue;
          }
          if (arg.validation) {
            const validation: NonNullable<PromptArgument['validation']> = {};
            if (arg.validation.pattern !== undefined) {
              validation.pattern = arg.validation.pattern;
            }
            if (arg.validation.minLength !== undefined) {
              validation.minLength = arg.validation.minLength;
            }
            if (arg.validation.maxLength !== undefined) {
              validation.maxLength = arg.validation.maxLength;
            }
            if (arg.validation.allowedValues !== undefined) {
              validation.allowedValues = arg.validation.allowedValues;
            }
            if (Object.keys(validation).length > 0) {
              normalizedArg.validation = validation;
            }
          }

          return normalizedArg;
        }) ?? [],
    };

    if (yaml.gateConfiguration) {
      const normalizedGateConfiguration: PromptData['gateConfiguration'] = {};
      if (Array.isArray(yaml.gateConfiguration.include)) {
        normalizedGateConfiguration.include = yaml.gateConfiguration.include;
      }
      if (Array.isArray(yaml.gateConfiguration.exclude)) {
        normalizedGateConfiguration.exclude = yaml.gateConfiguration.exclude;
      }
      if (typeof yaml.gateConfiguration.framework_gates === 'boolean') {
        normalizedGateConfiguration.framework_gates = yaml.gateConfiguration.framework_gates;
      }
      const inlineGateDefinitions = this.normalizeInlineGateDefinitions(
        yaml.gateConfiguration.inline_gate_definitions
      );
      if (inlineGateDefinitions) {
        normalizedGateConfiguration.inline_gate_definitions = inlineGateDefinitions;
      }
      if (Object.keys(normalizedGateConfiguration).length > 0) {
        promptData.gateConfiguration = normalizedGateConfiguration;
      }
    }

    if (yaml.chainSteps) {
      promptData.chainSteps = yaml.chainSteps.map((step) => {
        const normalizedStep: NonNullable<PromptData['chainSteps']>[number] = {
          promptId: step.promptId,
          stepName: step.stepName,
        };
        if (step.inputMapping) {
          normalizedStep.inputMapping = step.inputMapping;
        }
        if (step.outputMapping) {
          normalizedStep.outputMapping = step.outputMapping;
        }
        if (typeof step.retries === 'number') {
          normalizedStep.retries = step.retries;
        }
        return normalizedStep;
      });
    }

    if (yaml.registerWithMcp !== undefined) {
      promptData.registerWithMcp = yaml.registerWithMcp;
    }

    // Script tools declaration (Phase 1: tools field maps to tools/{id}/ directories)
    if (yaml.tools && yaml.tools.length > 0) {
      promptData.tools = yaml.tools;
    }

    return promptData;
  }

  /**
   * Load all YAML prompts from a category directory.
   *
   * @param categoryDir - Path to the category directory
   * @returns Array of loaded prompt data
   */
  loadAllYamlPrompts(categoryDir: string): PromptData[] {
    const promptDirs = this.discoverYamlPrompts(categoryDir);
    const prompts: PromptData[] = [];

    for (const promptDir of promptDirs) {
      const result = this.loadYamlPrompt(promptDir);
      if (result) {
        prompts.push(result.promptData);
      }
    }

    if (this.debug && prompts.length > 0) {
      this.logger.info(`[PromptLoader] Loaded ${prompts.length} YAML prompts from ${categoryDir}`);
    }

    return prompts;
  }

  /**
   * Check if a directory contains YAML-format prompts.
   *
   * @param categoryDir - Path to the category directory
   * @returns true if any prompt.yaml files are found
   */
  hasYamlPrompts(categoryDir: string): boolean {
    return this.discoverYamlPrompts(categoryDir).length > 0;
  }
}
