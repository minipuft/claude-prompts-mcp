/**
 * Prompt Management System
 * Main module that orchestrates prompt loading, conversion, and registration
 */
export * from './converter.js';
export * from './loader.js';
export * from './registry.js';
export * from './prompt-schema.js';
export * from './category-manager.js';
export * from './file-observer.js';
export * from './hot-reload-manager.js';
import { PromptConverter } from './converter.js';
import { HotReloadManager, type AuxiliaryReloadConfig, type HotReloadEvent as PromptHotReloadEvent } from './hot-reload-manager.js';
import { PromptLoader } from './loader.js';
import { PromptRegistry } from './registry.js';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { ConversationManager } from '../text-references/conversation.js';
import { TextReferenceManager } from '../text-references/index.js';
import { Category, CategoryPromptsResult, ConvertedPrompt, PromptData } from '../types/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Main Prompt Manager class that coordinates all prompt operations
 */
export declare class PromptAssetManager {
    private logger;
    private textReferenceManager;
    private conversationManager;
    private configManager;
    private mcpServer;
    private converter;
    private loader;
    private registry;
    private hotReloadManager;
    constructor(logger: Logger, textReferenceManager: TextReferenceManager, conversationManager: ConversationManager, configManager: ConfigManager, mcpServer?: McpServer);
    /**
     * Load prompts from category-specific configuration files
     * @deprecated Use loadFromDirectories() for pure YAML-based loading
     */
    loadCategoryPrompts(configPath: string): Promise<CategoryPromptsResult>;
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
    loadFromDirectories(promptsDir: string): Promise<CategoryPromptsResult>;
    /**
     * Convert markdown prompts to JSON structure
     */
    convertMarkdownPromptsToJson(promptsData: PromptData[], basePath?: string): Promise<ConvertedPrompt[]>;
    /**
     * Register prompts with MCP server
     */
    registerAllPrompts(prompts: ConvertedPrompt[]): Promise<number>;
    /**
     * Notify clients that prompt list has changed (for hot-reload)
     */
    notifyPromptsListChanged(): Promise<void>;
    /**
     * Load and convert prompts in one operation.
     *
     * Uses directory-based discovery by default (YAML-only, no JSON registry).
     * Falls back to legacy config-based loading only if explicitly requested.
     *
     * @param configPathOrDir - Either a path to promptsConfig.json (legacy) or the prompts directory
     * @param basePath - Optional base path for resolving prompt file references
     */
    loadAndConvertPrompts(configPathOrDir: string, basePath?: string): Promise<{
        promptsData: PromptData[];
        categories: Category[];
        convertedPrompts: ConvertedPrompt[];
    }>;
    /**
     * Clear the loader's file cache.
     * Call this before reloading prompts to ensure fresh content is read from disk.
     */
    clearLoaderCache(): void;
    /**
     * Complete prompt system initialization
     */
    initializePromptSystem(configPath: string, basePath?: string): Promise<{
        promptsData: PromptData[];
        categories: Category[];
        convertedPrompts: ConvertedPrompt[];
        registeredCount: number;
    }>;
    /**
     * Reload prompts (useful for hot-reloading)
     */
    reloadPrompts(configPath: string, basePath?: string): Promise<{
        promptsData: PromptData[];
        categories: Category[];
        convertedPrompts: ConvertedPrompt[];
        registeredCount: number;
    }>;
    /**
     * Start automatic file watching for hot reload
     */
    startHotReload(promptsConfigPath: string, onReloadCallback?: (event: PromptHotReloadEvent) => Promise<void>, options?: {
        methodologyHotReload?: {
            handler: (event: PromptHotReloadEvent) => Promise<void>;
            directories?: string[];
        };
        auxiliaryReloads?: AuxiliaryReloadConfig[];
    }): Promise<void>;
    /**
     * Stop automatic file watching
     */
    stopHotReload(): Promise<void>;
    /**
     * Discover prompt directories for watching.
     * Categories are identified by containing YAML prompt files (no JSON registry required).
     */
    private discoverPromptDirectories;
    private logConfigFileDiagnostics;
    private logCategoryBreakdown;
    private logConversionSummary;
    /**
     * Get all individual module instances for external access
     */
    getModules(): {
        converter: PromptConverter;
        loader: PromptLoader;
        registry: PromptRegistry | undefined;
        categoryManager: import("./category-manager.js").CategoryManager;
        hotReloadManager: HotReloadManager | undefined;
    };
    /**
     * Get TextReferenceManager for direct access
     * Added for UnifiedPromptProcessor consolidation
     */
    getTextReferenceManager(): TextReferenceManager;
    /**
     * Get system statistics
     */
    getStats(prompts?: ConvertedPrompt[]): any;
    /**
     * Shutdown the prompt manager and cleanup resources
     * Prevents async handle leaks by stopping hot reload manager
     */
    shutdown(): Promise<void>;
}
export { PromptAssetManager as PromptManager };
