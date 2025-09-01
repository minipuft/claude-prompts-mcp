/**
 * Prompt Management System
 * Main module that orchestrates prompt loading, conversion, and registration
 */

// Import the individual modules
export * from "./converter.js";
export * from "./loader.js";
export * from "./registry.js";
// Template processor moved to /execution/processor/template-processor.js for better organization
export * from "./category-manager.js";
export * from "./file-observer.js";
export * from "./hot-reload-manager.js";
// Framework-aware components removed in Phase 3 simplification

import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";
import { TextReferenceManager } from "../text-references/index.js";
import path from "path";
import {
  Category,
  CategoryPromptsResult,
  ConvertedPrompt,
  PromptData,
} from "../types/index.js";

// Import the actual modules
import { PromptConverter } from "./converter.js";
import { PromptLoader } from "./loader.js";
import { PromptRegistry } from "./registry.js";
// TemplateProcessor functionality consolidated into UnifiedPromptProcessor
import { HotReloadManager, createHotReloadManager } from "./hot-reload-manager.js";
// Phase 1: Framework capabilities integrated into enhanced HotReloadManager

/**
 * Main Prompt Manager class that coordinates all prompt operations
 */
export class PromptManager {
  private logger: Logger;
  private textReferenceManager: TextReferenceManager;
  private configManager: ConfigManager;
  private mcpServer: any;

  // Individual module instances
  private converter: PromptConverter;
  private loader: PromptLoader;
  private registry?: PromptRegistry;
  // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
  private hotReloadManager?: HotReloadManager;
  // Framework-aware components removed in Phase 3 simplification

  constructor(
    logger: Logger,
    textReferenceManager: TextReferenceManager,
    configManager: ConfigManager,
    mcpServer?: any,
    // Framework parameters removed in Phase 3 simplification
  ) {
    this.logger = logger;
    this.textReferenceManager = textReferenceManager;
    this.configManager = configManager;
    this.mcpServer = mcpServer;
    // Framework initialization removed in Phase 3 simplification

    // Initialize individual modules
    this.loader = new PromptLoader(logger);
    // templateProcessor removed - functionality consolidated into UnifiedPromptProcessor
    this.converter = new PromptConverter(logger, this.loader);

    if (mcpServer) {
      this.registry = new PromptRegistry(
        logger,
        mcpServer,
        configManager
      );
      
      // Initialize HotReloadManager with CategoryManager integration
      const categoryManager = this.loader.getCategoryManager();
      
      // Phase 1: Enhanced HotReloadManager with framework capabilities
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
            invalidateFrameworkCaches: true
          }
        }
      );
      
      this.logger.info('🔄 Hot reload manager initialized');
    }
  }

  /**
   * Load prompts from category-specific configuration files
   */
  async loadCategoryPrompts(
    configPath: string
  ): Promise<CategoryPromptsResult> {
    return this.loader.loadCategoryPrompts(configPath);
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
   * Process template with text references and special context
   * @deprecated Template processing consolidated into UnifiedPromptProcessor for direct processing
   * This method is kept for backward compatibility but should not be used in new code
   */
  async processTemplateAsync(
    template: string,
    args: Record<string, any>,
    specialContext: Record<string, string> = {},
    toolsEnabled: boolean = false
  ): Promise<string> {
    this.logger.warn("DEPRECATED: processTemplateAsync called on PromptManager. Template processing has been consolidated into UnifiedPromptProcessor.");
    
    // Basic fallback processing using jsonUtils directly
    const { processTemplate } = await import("../utils/jsonUtils.js");
    const { getAvailableTools } = await import("../utils/index.js");
    
    const enhancedSpecialContext = { ...specialContext };
    if (toolsEnabled) {
      enhancedSpecialContext["tools_available"] = getAvailableTools();
    }
    
    return processTemplate(template, args, enhancedSpecialContext);
  }

  /**
   * Register prompts with MCP server
   */
  async registerAllPrompts(prompts: ConvertedPrompt[]): Promise<number> {
    if (!this.registry) {
      throw new Error("MCP server not provided - cannot register prompts");
    }
    return this.registry.registerAllPrompts(prompts);
  }

  /**
   * Load and convert prompts in one operation
   */
  async loadAndConvertPrompts(
    configPath: string,
    basePath?: string
  ): Promise<{
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  }> {
    try {
      this.logger.info(`📁 PromptManager: Loading prompts from: ${configPath}`);

      // Verify config path exists
      const fs = await import("fs/promises");
      try {
        const stats = await fs.stat(configPath);
        this.logger.info(
          `✓ Config file found, size: ${
            stats.size
          } bytes, modified: ${stats.mtime.toISOString()}`
        );
      } catch (error) {
        this.logger.error(`✗ Config file access error:`, error);
        throw error;
      }

      this.logger.info("🔄 Calling PromptLoader.loadCategoryPrompts()...");

      // Load the raw prompt data
      const { promptsData, categories } = await this.loadCategoryPrompts(
        configPath
      );

      this.logger.info(
        "✅ PromptLoader.loadCategoryPrompts() completed successfully"
      );
      this.logger.info(
        `📊 Raw data loaded: ${promptsData.length} prompts from ${categories.length} categories`
      );

      // Log detailed breakdown by category
      if (categories.length > 0) {
        this.logger.info("📋 Category breakdown:");
        categories.forEach((category) => {
          const categoryPrompts = promptsData.filter(
            (p) => p.category === category.id
          );
          this.logger.info(
            `   ${category.name} (${category.id}): ${categoryPrompts.length} prompts`
          );
        });
      } else {
        this.logger.warn("⚠️ No categories found in loaded data!");
      }

      if (promptsData.length === 0) {
        this.logger.warn("⚠️ No prompts found in loaded data!");
      }

      this.logger.info("🔄 Converting prompts to JSON structure...");

      // Convert to JSON structure
      const convertedPrompts = await this.convertMarkdownPromptsToJson(
        promptsData,
        basePath
      );

      this.logger.info(
        `✅ Conversion completed: ${convertedPrompts.length} prompts converted`
      );

      if (convertedPrompts.length !== promptsData.length) {
        this.logger.warn(
          `⚠️ Conversion count mismatch! Input: ${promptsData.length}, Output: ${convertedPrompts.length}`
        );
      }

      this.logger.info(
        "🎉 PromptManager.loadAndConvertPrompts() completed successfully"
      );
      return { promptsData, categories, convertedPrompts };
    } catch (error) {
      this.logger.error("❌ PromptManager.loadAndConvertPrompts() FAILED:");
      this.logger.error("Error type:", error?.constructor?.name);
      this.logger.error(
        "Error message:",
        error instanceof Error ? error.message : String(error)
      );
      this.logger.error(
        "Stack trace:",
        error instanceof Error ? error.stack : "No stack trace available"
      );
      throw error;
    }
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
        registeredCount = await this.registerAllPrompts(
          result.convertedPrompts
        );
      } else {
        this.logger.warn(
          "MCP server not available - skipping prompt registration"
        );
      }

      return { ...result, registeredCount };
    } catch (error) {
      this.logger.error("Error initializing prompt system:", error);
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
    this.logger.info("Reloading prompt system...");

    // Unregister existing prompts if registry is available
    if (this.registry) {
      await this.registry.unregisterAllPrompts();
    }

    // Reinitialize the system
    return this.initializePromptSystem(configPath, basePath);
  }

  /**
   * Start automatic file watching for hot reload
   */
  async startHotReload(promptsConfigPath: string, onReloadCallback?: () => Promise<void>): Promise<void> {
    if (!this.hotReloadManager) {
      this.logger.warn("HotReloadManager not available - hot reload not started");
      return;
    }

    // Set up reload callback
    if (onReloadCallback) {
      this.hotReloadManager.setReloadCallback(async (event) => {
        this.logger.info(`Hot reload triggered: ${event.reason}`);
        try {
          await onReloadCallback();
        } catch (error) {
          this.logger.error("Hot reload callback failed:", error);
        }
      });
    }

    // Start monitoring
    await this.hotReloadManager.start();

    // Watch prompts directory and config files
    const promptsDir = path.dirname(promptsConfigPath);
    const promptsCategoryDirs = await this.discoverPromptDirectories(promptsDir);

    await this.hotReloadManager.watchDirectories([
      { path: promptsDir }, // Watch main prompts directory
      ...promptsCategoryDirs.map(dir => ({ path: dir.path, category: dir.category }))
    ]);

    this.logger.info(`🔄 Hot reload monitoring started for ${promptsCategoryDirs.length + 1} directories`);
  }

  /**
   * Stop automatic file watching
   */
  async stopHotReload(): Promise<void> {
    if (this.hotReloadManager) {
      await this.hotReloadManager.stop();
      this.logger.info("Hot reload monitoring stopped");
    }
  }

  /**
   * Discover prompt directories for watching
   */
  private async discoverPromptDirectories(promptsDir: string): Promise<Array<{ path: string; category?: string }>> {
    const directories: Array<{ path: string; category?: string }> = [];

    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(promptsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
          const fullPath = path.join(promptsDir, entry.name);
          
          // Check if this directory contains prompts.json (indicating it's a category directory)
          try {
            const categoryPromptsPath = path.join(fullPath, 'prompts.json');
            await fs.access(categoryPromptsPath);
            directories.push({ path: fullPath, category: entry.name });
          } catch {
            // Directory doesn't have prompts.json, but still watch it
            directories.push({ path: fullPath });
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to discover prompt directories:", error);
    }

    return directories;
  }

  // Phase 1: Framework capabilities integrated into enhanced HotReloadManager

  // Framework-specific reload functionality removed in Phase 3 simplification

  // Framework statistics functionality removed in Phase 3 simplification

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
      // Framework-aware modules removed in Phase 3 simplification
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
      stats.conversation = this.registry.getConversationStats();
    }

    if (prompts && this.converter) {
      stats.conversion = this.converter.getConversionStats(
        prompts.length,
        prompts
      );
    }

    return stats;
  }
}
