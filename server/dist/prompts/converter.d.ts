/**
 * Prompt Converter Module
 * Handles converting markdown prompts to JSON structure with validation
 */
import { PromptLoader } from './loader.js';
import { Logger } from '../logging/index.js';
import { ScriptToolDefinitionLoader } from '../scripts/core/script-definition-loader.js';
import type { PromptData } from './types.js';
import type { ConvertedPrompt } from '../execution/types.js';
/**
 * Prompt Converter class
 */
export declare class PromptConverter {
    private logger;
    private loader;
    private globalRegisterWithMcp;
    private scriptToolLoader;
    constructor(logger: Logger, loader?: PromptLoader, globalRegisterWithMcp?: boolean);
    /**
     * Get the script tool loader instance.
     * Exposed for hot-reload integration.
     */
    getScriptToolLoader(): ScriptToolDefinitionLoader;
    /**
     * Set the global registerWithMcp default value
     */
    setGlobalRegisterWithMcp(value: boolean | undefined): void;
    /**
     * Convert markdown prompts to JSON structure in memory
     */
    convertMarkdownPromptsToJson(promptsData: PromptData[], basePath?: string): Promise<ConvertedPrompt[]>;
    /**
     * Validate a converted prompt
     */
    validateConvertedPrompt(prompt: ConvertedPrompt): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    };
    /**
     * Extract placeholders from a template string
     */
    private extractPlaceholders;
    /**
     * Check if a placeholder is a special system placeholder.
     * These are injected at runtime and don't require argument definitions.
     */
    private isSpecialPlaceholder;
    /**
     * Get conversion statistics
     */
    getConversionStats(originalCount: number, convertedPrompts: ConvertedPrompt[]): {
        totalOriginal: number;
        totalConverted: number;
        successRate: number;
        chainPrompts: number;
        regularPrompts: number;
        totalArguments: number;
    };
}
