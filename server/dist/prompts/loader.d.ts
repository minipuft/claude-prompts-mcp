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
import { CategoryManager } from './category-manager.js';
import { Logger } from '../logging/index.js';
import { CategoryPromptsResult, PromptData } from '../types/index.js';
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
export declare class PromptLoader {
    private logger;
    private categoryManager;
    private enableCache;
    private debug;
    private promptFileCache;
    private stats;
    constructor(logger: Logger, config?: PromptLoaderConfig);
    /**
     * Clear the prompt file cache (all or specific file)
     *
     * @param filePath - Optional specific file path to clear; if omitted, clears all
     */
    clearCache(filePath?: string): void;
    /**
     * Get loader statistics
     */
    getStats(): PromptLoaderStats;
    /**
     * Load prompts from category-specific prompts.json files
     */
    loadCategoryPrompts(configPath: string): Promise<CategoryPromptsResult>;
    /**
     * Get the CategoryManager instance for external access
     */
    getCategoryManager(): CategoryManager;
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
    loadFromDirectories(promptsDir: string): Promise<CategoryPromptsResult>;
    /**
     * Format a category ID into a human-readable name.
     * Example: "codebase-setup" -> "Codebase Setup"
     */
    private formatCategoryName;
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
    loadPromptFile(filePath: string, basePath: string): Promise<LoadedPromptFile>;
    /**
     * Check if caching is enabled
     */
    isCacheEnabled(): boolean;
    /**
     * Enable or disable caching at runtime
     */
    setCacheEnabled(enabled: boolean): void;
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
    discoverYamlPrompts(categoryDir: string): string[];
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
    } | null;
    private normalizeInlineGateDefinitions;
    /**
     * Convert YAML prompt definition to PromptData structure.
     *
     * @param yaml - Parsed and validated YAML data
     * @param filePath - Optional file path override (for single-file format)
     */
    private yamlToPromptData;
    /**
     * Load all YAML prompts from a category directory.
     *
     * @param categoryDir - Path to the category directory
     * @returns Array of loaded prompt data
     */
    loadAllYamlPrompts(categoryDir: string): PromptData[];
    /**
     * Check if a directory contains YAML-format prompts.
     *
     * @param categoryDir - Path to the category directory
     * @returns true if any prompt.yaml files are found
     */
    hasYamlPrompts(categoryDir: string): boolean;
}
