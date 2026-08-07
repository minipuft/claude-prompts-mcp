// @lifecycle canonical - Entry point that orchestrates prompt loading, conversion, and registration.
/**
 * Prompt Asset System
 * Main module that orchestrates prompt loading, conversion, and registration
 */

export * from './converter.js';
export * from './loader.js';
export * from './registry.js';
export * from './prompt-schema.js';
export * from './category-manager.js';

import * as path from 'node:path';

import { PromptConverter } from './converter.js';
import { PromptLoader } from './loader.js';
import { discoverPromptDirectories, buildWatchTargets } from './prompt-watch-setup.js';
import { PromptRegistry } from './registry.js';
import {
  HotReloadObserver,
  createHotReloadObserver,
  type AuxiliaryReloadConfig,
  type HotReloadEvent as PromptHotReloadEvent,
} from '../hot-reload/hot-reload-observer.js';
import { ConversationStore } from '../text-refs/conversation.js';
import { TextReferenceStore } from '../text-refs/index.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { Category, CategoryPromptsResult, PromptData } from './types.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { type ConfigManager, type Logger } from '#shared/types/index.js';

/**
 * Main Prompt Asset Manager class that coordinates all prompt operations
 */
export class PromptAssetManager {
  private logger: Logger;
  private textReferenceStore: TextReferenceStore;
  private conversationStore: ConversationStore;
  private configManager: ConfigManager;

  private converter: PromptConverter;
  private loader: PromptLoader;
  private registry: PromptRegistry | undefined;
  private hotReloadObserver: HotReloadObserver | undefined;

  constructor(
    logger: Logger,
    textReferenceStore: TextReferenceStore,
    conversationStore: ConversationStore,
    configManager: ConfigManager,
    mcpServer?: McpServer
  ) {
    this.logger = logger;
    this.textReferenceStore = textReferenceStore;
    this.conversationStore = conversationStore;
    this.configManager = configManager;

    this.loader = new PromptLoader(logger);
    this.converter = new PromptConverter(
      logger,
      this.loader,
      configManager.getPromptsRegisterWithMcp()
    );

    if (mcpServer) {
      this.registry = new PromptRegistry(logger, mcpServer, this.conversationStore);

      this.hotReloadObserver = createHotReloadObserver(
        logger,
        {
          enabled: true,
          autoReload: true, // Automatically reload on file changes (debounced + batched)
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
   * Load prompts using directory-based discovery.
   * Each subdirectory under promptsDir is a category containing YAML prompt files.
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

  /**
   * Set prompt IDs exported as client skills (auto-deregistered from MCP).
   * Format: "category/id" (e.g., "development/review")
   */
  setExportedPromptIds(ids: Set<string>): void {
    this.registry?.setExportedPromptIds(ids);
  }

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
   */
  async loadAndConvertPrompts(
    configPathOrDir: string,
    basePath?: string
  ): Promise<{
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  }> {
    // Always treat input as a directory (JSON prompts.json format removed)
    const promptsDir = configPathOrDir;

    this.logger.info(`Loading prompts from: ${promptsDir}`);
    const { promptsData, categories } = await this.loadFromDirectories(promptsDir);
    this.logger.info(`Loaded ${promptsData.length} prompts from ${categories.length} categories`);
    this.logCategoryBreakdown(categories, promptsData);

    const effectiveBasePath = basePath || promptsDir;
    const convertedPrompts = await this.convertMarkdownPromptsToJson(
      promptsData,
      effectiveBasePath
    );
    this.logConversionSummary(promptsData, convertedPrompts);

    return { promptsData, categories, convertedPrompts };
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
      frameworkHotReload?: {
        handler: (event: PromptHotReloadEvent) => Promise<void>;
        directories?: string[];
      };
      auxiliaryReloads?: AuxiliaryReloadConfig[];
    }
  ): Promise<void> {
    if (!this.hotReloadObserver) {
      this.logger.warn('HotReloadObserver not available - hot reload not started');
      return;
    }

    // Set up reload callback
    if (onReloadCallback) {
      this.hotReloadObserver.setReloadCallback(async (event) => {
        this.logger.info(`Hot reload triggered: ${event.reason}`);
        try {
          await onReloadCallback(event);
        } catch (error) {
          this.logger.error('Hot reload callback failed:', error);
        }
      });
    }

    // Register framework-specific reload callback (keeps manager generic)
    if (options?.frameworkHotReload?.handler) {
      this.hotReloadObserver.setFrameworkReloadCallback(options.frameworkHotReload.handler);
    }

    if (options?.auxiliaryReloads) {
      this.hotReloadObserver.setAuxiliaryReloads(options.auxiliaryReloads);
    }

    // Start monitoring
    await this.hotReloadObserver.start();

    const promptsDir = path.dirname(promptsConfigPath);
    const categoryDirs = await discoverPromptDirectories(promptsDir, this.loader, this.logger);

    const watchTargets = buildWatchTargets(promptsDir, categoryDirs, {
      frameworkDirectories: options?.frameworkHotReload?.directories,
      auxiliaryDirectories: options?.auxiliaryReloads?.map((r) => r.directories),
    });

    await this.hotReloadObserver.watchDirectories(watchTargets);
    this.logger.info(`Hot reload monitoring started for ${watchTargets.length} directories`);
  }

  /**
   * Stop automatic file watching
   */
  async stopHotReload(): Promise<void> {
    if (this.hotReloadObserver) {
      await this.hotReloadObserver.stop();
      this.logger.info('Hot reload monitoring stopped');
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

  getModules() {
    return {
      converter: this.converter,
      loader: this.loader,
      registry: this.registry,
      categoryManager: this.loader.getCategoryManager(),
      hotReloadObserver: this.hotReloadObserver,
    };
  }

  getTextReferenceStore(): TextReferenceStore {
    return this.textReferenceStore;
  }

  /**
   * Get system statistics
   */
  getStats(prompts?: ConvertedPrompt[]) {
    const stats: any = {
      textReferences: this.textReferenceStore.getStats(),
    };

    if (prompts && this.registry) {
      stats.registration = this.registry.getRegistrationStats(prompts);
      stats.conversation = this.conversationStore.getConversationStats();
    }

    if (prompts && this.converter) {
      stats.conversion = this.converter.getConversionStats(prompts.length, prompts);
    }

    return stats;
  }

  /**
   * Shutdown prompt assets and cleanup resources
   * Prevents async handle leaks by stopping hot reload manager
   */
  async shutdown(): Promise<void> {
    if (this.hotReloadObserver) {
      await this.hotReloadObserver.stop();
    }
  }
}
