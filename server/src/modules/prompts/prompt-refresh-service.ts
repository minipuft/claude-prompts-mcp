// @lifecycle canonical - Service that reloads prompts/categories on demand for MCP tools.
import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ConfigManager } from '#shared/types/index.js';
import type { PromptAssetManager } from './index.js';
import type { Category, PromptData } from './types.js';

/**
 * Minimal interface for consumers that receive prompt data updates.
 * Decouples modules/ from mcp/ layer — McpToolsManager satisfies this structurally.
 */
interface PromptDataConsumer {
  updateData(
    promptsData: PromptData[],
    convertedPrompts: ConvertedPrompt[],
    categories: Category[]
  ): void;
}

export interface PromptReloadResult {
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
  promptsDirectory: string;
}

interface PromptReloadOptions {
  configManager: ConfigManager;
  promptManager: PromptAssetManager;
  mcpToolsManager?: PromptDataConsumer;
  promptsFileOverride?: string;
}

/**
 * Reload prompts from disk, synchronizing downstream managers (PromptAssetManager,
 * MCP tools, API caches) so every transport observes the same prompt metadata.
 */
export async function reloadPromptData(options: PromptReloadOptions): Promise<PromptReloadResult> {
  const promptsDir = options.configManager.getResolvedPromptsDirectory(options.promptsFileOverride);

  // Clear loader cache to ensure fresh content is read from disk
  // (fixes hot-reload not picking up direct file edits)
  options.promptManager.clearLoaderCache();

  const result = await options.promptManager.loadAndConvertPrompts(promptsDir);

  if (options.mcpToolsManager) {
    options.mcpToolsManager.updateData(
      result.promptsData,
      result.convertedPrompts,
      result.categories
    );
  }

  return {
    ...result,
    promptsDirectory: promptsDir,
  };
}
