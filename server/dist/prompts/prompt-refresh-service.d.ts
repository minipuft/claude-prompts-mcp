import type { PromptAssetManager } from './index.js';
import type { ConfigManager } from '../config/index.js';
import type { McpToolsManager } from '../mcp-tools/index.js';
import type { Category, ConvertedPrompt, PromptData } from '../types/index.js';
export interface PromptReloadResult {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
    promptsFilePath: string;
}
interface PromptReloadOptions {
    configManager: ConfigManager;
    promptManager: PromptAssetManager;
    mcpToolsManager?: McpToolsManager;
    promptsFileOverride?: string;
}
/**
 * Reload prompts from disk, synchronizing downstream managers (PromptManager,
 * MCP tools, API caches) so every transport observes the same prompt metadata.
 */
export declare function reloadPromptData(options: PromptReloadOptions): Promise<PromptReloadResult>;
export {};
