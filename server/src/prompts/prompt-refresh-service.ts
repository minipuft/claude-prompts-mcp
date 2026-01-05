// @lifecycle canonical - Service that reloads prompts/categories on demand for MCP tools.
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
export async function reloadPromptData(options: PromptReloadOptions): Promise<PromptReloadResult> {
  const promptsFilePath = options.configManager.getResolvedPromptsFilePath(
    options.promptsFileOverride
  );

  // Clear loader cache to ensure fresh content is read from disk
  // (fixes hot-reload not picking up direct file edits)
  options.promptManager.clearLoaderCache();

  const result = await options.promptManager.loadAndConvertPrompts(promptsFilePath);

  if (options.mcpToolsManager) {
    options.mcpToolsManager.updateData(
      result.promptsData,
      result.convertedPrompts,
      result.categories
    );
  }

  return {
    ...result,
    promptsFilePath,
  };
}
