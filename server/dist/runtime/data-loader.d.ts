/**
 * Loads and converts prompts with path normalization and registration.
 * Reuses existing PromptAssetManager behavior without duplicating transport/config logic.
 */
import type { RuntimeLaunchOptions } from './options.js';
import type { PathResolver } from './paths.js';
import type { ConfigManager } from '../config/index.js';
import type { Logger } from '../logging/index.js';
import type { PromptAssetManager } from '../prompts/index.js';
import type { Category, ConvertedPrompt, PromptData } from '../types/index.js';
export interface PromptDataLoadParams {
    logger: Logger;
    configManager: ConfigManager;
    promptManager: PromptAssetManager;
    runtimeOptions: RuntimeLaunchOptions;
    serverRoot?: string;
    /** Optional PathResolver for centralized path resolution */
    pathResolver?: PathResolver;
    mcpToolsManager?: {
        updateData: (prompts: PromptData[], convertedPrompts: ConvertedPrompt[], categories: Category[]) => void;
    };
    apiManager?: {
        updateData: (prompts: PromptData[], categories: Category[], convertedPrompts: ConvertedPrompt[]) => void;
    };
}
export interface PromptDataLoadResult {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
    promptsFilePath: string;
}
export declare function loadPromptData(params: PromptDataLoadParams): Promise<PromptDataLoadResult>;
