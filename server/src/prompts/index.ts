// @lifecycle canonical - Entry point that orchestrates prompt loading, conversion, and registration.
/**
 * Prompt Management System
 * Main module that orchestrates prompt loading, conversion, and registration
 */

// Import the individual modules
export * from './converter.js';
export * from './loader.js';
export * from './registry.js';
export * from './prompt-schema.js';
// Template processor moved to /execution/processor/template-processor.js for better organization
export * from './category-manager.js';
export * from './file-observer.js';
export * from './hot-reload-manager.js';
// Framework-aware components removed in simplification

import * as path from 'node:path';

import { PromptConverter } from './converter.js';
import {
  HotReloadManager,
  createHotReloadManager,
  type AuxiliaryReloadConfig,
  type HotReloadEvent as PromptHotReloadEvent,
  HotReloadEvent,
} from './hot-reload-manager.js';
import { PromptLoader } from './loader.js';
import { PromptRegistry } from './registry.js';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { ConversationManager } from '../text-references/conversation.js';
import { TextReferenceManager } from '../text-references/index.js';
import { Category, CategoryPromptsResult, ConvertedPrompt, PromptData } from '../types/index.js';

// Import the actual modules
// TemplateProcessor functionality consolidated into UnifiedPromptProcessor

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
//  Framework capabilities integrated into enhanced HotReloadManager

/**
 * Main Prompt Manager class that coordinates all prompt operations
 */
export class PromptAssetManager {
  private logger: Logger;
  private textReferenceManager: TextReferenceManager;
  private conversationManager: ConversationManager;
  private configManager: ConfigManager;
  private mcpServer: McpServer | undefined;

  // Individual module instances
  private converter: PromptConverter;
  private loader: PromptLoader;
  private registry: PromptRegistry | undefined;
  // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  private hotReloadManager: HotReloadManager | undefined;
  // Framework-aware components removed in simplification

  constructor(
    logger: Logger,
    textReferenceManager: TextReferenceManager,
    conversationManager: ConversationManager,
    configManager: ConfigManager,
    mcpServer?: McpServer
  ) {
    this.logger = logger;
    this.textReferenceManager = textReferenceManager;
    this.conversationManager = conversationManager;
    this.configManager = configManager;
    // Framework initialization removed in simplification

    // Initialize individual modules
    this.loader = new PromptLoader(logger);
    // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
    // Pass global registerWithMcp from config (undefined if not set, allowing downstream defaults)
    this.converter = new PromptConverter(
      logger,
      this.loader,
      configManager.getPromptsRegisterWithMcp()
    );

    if (mcpServer) {
      this.mcpServer = mcpServer;
      this.registry = new PromptRegistry(
        logger,
        mcpServer,
        configManager,
        this.conversationManager
      );

      // Initialize HotReloadManager with CategoryManager integration
      const categoryManager = this.loader.getCategoryManager();

      //  Enhanced HotReloadManager with framework capabilities
      this.hotReloadManager = createHotReloadManager(
        logger,
        categoryManager,
        {
          enabled: true,
          autoReload: false, // Will be controlled by external triggers
          debounceMs: 500,
          batchChanges: true,
          batchTimeoutMs: 2000,
          frameworkCapabilities: {
            enabled: true,
            frameworkAnalysis: true,
            performanceMonitoring: true,
            preWarmAnalysis: true,
            invalidateFrameworkCaches: true,
          },
        },
        this.configManager
      );

      this.logger.info('🔄 Hot reload manager initialized');
    }
  }

  /**
   * Load prompts from category-specific configuration files
   * @deprecated Use loadFromDirectories() for pure YAML-based loading
   */
  async loadCategoryPrompts(configPath: string): Promise<CategoryPromptsResult> {
    return this.loader.loadCategoryPrompts(configPath);
  }

  /**
   * Load prompts using directory-based discovery (recommended).
   *
   * This is the modern approach that treats the directory structure as the source of truth:
   * - Each subdirectory under promptsDir is a category
   * - Category metadata is derived from directory name (or category.yaml if present)
   * - Prompts are discovered via YAML files (both directory and single-file formats)
   * - No JSON registry files (prompts.json, promptsConfig.json) required
   *
   * @param promptsDir - Base directory containing category subdirectories
   */
  async loadFromDirectories(promptsDir: string): Promise<CategoryPromptsResult> {
    return this.loader.loadFromDirectories(promptsDir);
  }

  /**
   * Convert markdown prompts to JSON structure
   */
  async convertMarkdownPromptsToJson(
    promptsData: PromptData[],
    basePath?: string
  ): Promise<ConvertedPrompt[]> {
    return this.converter.convertMarkdownPromptsToJson(promptsData, basePath);
  }

  // Removed: processTemplateAsync - deprecated method no longer needed
  // Template processing now handled directly using processTemplate from utils/jsonUtils.js

  /**
   * Register prompts with MCP server
   */
  async registerAllPrompts(prompts: ConvertedPrompt[]): Promise<number> {
    if (!this.registry) {
      throw new Error('MCP server not provided - cannot register prompts');
    }
    return this.registry.registerAllPrompts(prompts);
  }

  /**
   * Notify clients that prompt list has changed (for hot-reload)
   */
  async notifyPromptsListChanged(): Promise<void> {
    if (!this.registry) {
      throw new Error('MCP server not provided - cannot send notifications');
    }
    await this.registry.notifyPromptsListChanged();
  }

  /**
   * Load and convert prompts in one operation.
   *
   * Uses directory-based discovery by default (YAML-only, no JSON registry).
   * Falls back to legacy config-based loading only if explicitly requested.
   *
   * @param configPathOrDir - Either a path to promptsConfig.json (legacy) or the prompts directory
   * @param basePath - Optional base path for resolving prompt file references
   */
  async loadAndConvertPrompts(
    configPathOrDir: string,
    basePath?: string
  ): Promise<{
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  }> {
    try {
      // Determine if this is a directory or config file path
      const isConfigFile = configPathOrDir.endsWith('.json');
      const promptsDir = isConfigFile ? path.dirname(configPathOrDir) : configPathOrDir;

      this.logger.info(`📁 PromptAssetManager: Loading prompts from: ${promptsDir}`);

      // Use directory-based discovery (modern YAML-only approach)
      this.logger.info('🔄 Using directory-based prompt discovery (YAML-only)...');
      const { promptsData, categories } = await this.loadFromDirectories(promptsDir);

      this.logger.info('✅ Directory-based loading completed successfully');
      this.logger.info(
        `📊 Loaded: ${promptsData.length} prompts from ${categories.length} categories`
      );

      this.logCategoryBreakdown(categories, promptsData);

      this.logger.info('🔄 Converting prompts to JSON structure...');

      // Convert to JSON structure
      const effectiveBasePath = basePath || promptsDir;
      const convertedPrompts = await this.convertMarkdownPromptsToJson(
        promptsData,
        effectiveBasePath
      );

      this.logConversionSummary(promptsData, convertedPrompts);

      this.logger.info('🎉 PromptAssetManager.loadAndConvertPrompts() completed successfully');
      return { promptsData, categories, convertedPrompts };
    } catch (error) {
      this.logger.error('❌ PromptAssetManager.loadAndConvertPrompts() FAILED:');
      this.logger.error('Error type:', error?.constructor?.name);
      this.logger.error('Error message:', error instanceof Error ? error.message : String(error));
      this.logger.error(
        'Stack trace:',
        error instanceof Error ? error.stack : 'No stack trace available'
      );
      throw error;
    }
  }

  /**
   * Clear the loader's file cache.
   * Call this before reloading prompts to ensure fresh content is read from disk.
   */
  clearLoaderCache(): void {
    this.loader.clearCache();
  }

  /**
   * Complete prompt system initialization
   */
  async initializePromptSystem(
    configPath: string,
    basePath?: string
  ): Promise<{
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
    registeredCount: number;
  }> {
    try {
      // Load and convert prompts
      const result = await this.loadAndConvertPrompts(configPath, basePath);

      // Register with MCP server if available
      let registeredCount = 0;
      if (this.registry) {
        registeredCount = await this.registerAllPrompts(result.convertedPrompts);
      } else {
        this.logger.warn('MCP server not available - skipping prompt registration');
      }

      return { ...result, registeredCount };
    } catch (error) {
      this.logger.error('Error initializing prompt system:', error);
      throw error;
    }
  }

  /**
   * Reload prompts (useful for hot-reloading)
   */
  async reloadPrompts(
    configPath: string,
    basePath?: string
  ): Promise<{
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
    registeredCount: number;
  }> {
    this.logger.info('Reloading prompt system...');

    // Note: MCP protocol doesn't support unregistering prompts
    // Hot-reload will be handled via list_changed notifications

    // Reinitialize the system
    return this.initializePromptSystem(configPath, basePath);
  }

  /**
   * Start automatic file watching for hot reload
   */
  async startHotReload(
    promptsConfigPath: string,
    onReloadCallback?: (event: PromptHotReloadEvent) => Promise<void>,
    options?: {
      methodologyHotReload?: {
        handler: (event: PromptHotReloadEvent) => Promise<void>;
        directories?: string[];
      };
      auxiliaryReloads?: AuxiliaryReloadConfig[];
    }
  ): Promise<void> {
    if (!this.hotReloadManager) {
      this.logger.warn('HotReloadManager not available - hot reload not started');
      return;
    }

    // Set up reload callback
    if (onReloadCallback) {
      this.hotReloadManager.setReloadCallback(async (event) => {
        this.logger.info(`Hot reload triggered: ${event.reason}`);
        try {
          await onReloadCallback(event);
        } catch (error) {
          this.logger.error('Hot reload callback failed:', error);
        }
      });
    }

    // Register methodology-specific reload callback (keeps manager generic)
    if (options?.methodologyHotReload?.handler) {
      this.hotReloadManager.setMethodologyReloadCallback(options.methodologyHotReload.handler);
    }

    if (options?.auxiliaryReloads) {
      this.hotReloadManager.setAuxiliaryReloads(options.auxiliaryReloads);
    }

    // Start monitoring
    await this.hotReloadManager.start();

    // Watch prompts directory and config files
    const promptsDir = path.dirname(promptsConfigPath);
    const promptsCategoryDirs = await this.discoverPromptDirectories(promptsDir);

    const watchTargets = new Map<string, { path: string; category?: string }>();
    watchTargets.set(promptsDir, { path: promptsDir }); // Main prompts directory

    for (const dir of promptsCategoryDirs) {
      const target: { path: string; category?: string } = { path: dir.path };
      if (dir.category) {
        target.category = dir.category;
      }
      watchTargets.set(dir.path, target);
    }

    if (options?.methodologyHotReload?.directories) {
      for (const dir of options.methodologyHotReload.directories) {
        if (dir) {
          watchTargets.set(dir, { path: dir });
        }
      }
    }

    if (options?.auxiliaryReloads) {
      for (const reload of options.auxiliaryReloads) {
        for (const dir of reload.directories) {
          if (dir) {
            watchTargets.set(dir, { path: dir });
          }
        }
      }
    }

    await this.hotReloadManager.watchDirectories([...watchTargets.values()]);

    this.logger.info(
      `🔄 Hot reload monitoring started for ${watchTargets.size} directories (including methodology sources when configured)`
    );
  }

  /**
   * Stop automatic file watching
   */
  async stopHotReload(): Promise<void> {
    if (this.hotReloadManager) {
      await this.hotReloadManager.stop();
      this.logger.info('Hot reload monitoring stopped');
    }
  }

  /**
   * Discover prompt directories for watching.
   * Categories are identified by containing YAML prompt files (no JSON registry required).
   */
  private async discoverPromptDirectories(
    promptsDir: string
  ): Promise<Array<{ path: string; category?: string }>> {
    const directories: Array<{ path: string; category?: string }> = [];

    try {
      const fs = await import('node:fs/promises');
      const entries = await fs.readdir(promptsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          entry.name !== 'node_modules' &&
          entry.name !== 'backup' &&
          !entry.name.startsWith('.') &&
          !entry.name.startsWith('_')
        ) {
          const fullPath = path.join(promptsDir, entry.name);

          // A directory is a category if it contains YAML prompts
          // (either {id}/prompt.yaml subdirectories or {id}.yaml files)
          const hasYamlPrompts = this.loader.hasYamlPrompts(fullPath);
          if (hasYamlPrompts) {
            directories.push({ path: fullPath, category: entry.name });
          } else {
            // Watch directory anyway (might add prompts later)
            directories.push({ path: fullPath });
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to discover prompt directories:', error);
    }

    return directories;
  }

  private async logConfigFileDiagnostics(configPath: string): Promise<void> {
    const fs = await import('node:fs/promises');
    try {
      const stats = await fs.stat(configPath);
      this.logger.info(
        `✓ Config file found, size: ${stats.size} bytes, modified: ${stats.mtime.toISOString()}`
      );
    } catch (error) {
      this.logger.error('✗ Config file access error:', error);
      throw error;
    }
  }

  private logCategoryBreakdown(categories: Category[], promptsData: PromptData[]): void {
    if (categories.length === 0) {
      this.logger.warn('⚠️ No categories found in loaded data!');
      return;
    }

    this.logger.info('📋 Category breakdown:');
    categories.forEach((category) => {
      const categoryPrompts = promptsData.filter((p) => p.category === category.id);
      this.logger.info(`   ${category.name} (${category.id}): ${categoryPrompts.length} prompts`);
    });

    if (promptsData.length === 0) {
      this.logger.warn('⚠️ No prompts found in loaded data!');
    }
  }

  private logConversionSummary(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[]
  ): void {
    this.logger.info(`✅ Conversion completed: ${convertedPrompts.length} prompts converted`);

    if (convertedPrompts.length !== promptsData.length) {
      this.logger.warn(
        `⚠️ Conversion count mismatch! Input: ${promptsData.length}, Output: ${convertedPrompts.length}`
      );
    }
  }

  //  Framework capabilities integrated into enhanced HotReloadManager

  // Framework-specific reload functionality removed in simplification

  // Framework statistics functionality removed in simplification

  /**
   * Get all individual module instances for external access
   */
  getModules() {
    return {
      converter: this.converter,
      loader: this.loader,
      registry: this.registry,
      // templateProcessor: removed - functionality consolidated into UnifiedPromptProcessor
      categoryManager: this.loader.getCategoryManager(),
      hotReloadManager: this.hotReloadManager,
      // Framework-aware modules removed in simplification
    };
  }

  /**
   * Get TextReferenceManager for direct access
   * Added for UnifiedPromptProcessor consolidation
   */
  getTextReferenceManager(): TextReferenceManager {
    return this.textReferenceManager;
  }

  /**
   * Get system statistics
   */
  getStats(prompts?: ConvertedPrompt[]) {
    const stats: any = {
      textReferences: this.textReferenceManager.getStats(),
    };

    if (prompts && this.registry) {
      stats.registration = this.registry.getRegistrationStats(prompts);
      stats.conversation = this.conversationManager.getConversationStats();
    }

    if (prompts && this.converter) {
      stats.conversion = this.converter.getConversionStats(prompts.length, prompts);
    }

    return stats;
  }

  /**
   * Shutdown the prompt manager and cleanup resources
   * Prevents async handle leaks by stopping hot reload manager
   */
  async shutdown(): Promise<void> {
    if (this.hotReloadManager) {
      await this.hotReloadManager.stop();
    }
  }
}

export { PromptAssetManager as PromptManager };
