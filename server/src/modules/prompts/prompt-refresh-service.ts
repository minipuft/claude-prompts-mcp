// @lifecycle canonical - Service that reloads prompts/categories on demand for MCP tools.
import { loadPromptsAcrossRoots, mergePromptResults } from './prompt-root-loader.js';

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

  // Reload the same ROOT SET startup loads, not just the primary directory.
  //
  // This call used to be `loadAndConvertPrompts(promptsDir)` — one directory — while startup
  // merged the bundled base and every workspace overlay. So the first hot reload under a
  // configured workspace rebuilt the live catalog from the primary root alone and published it
  // with no error: an edit to a bundled-only prompt was never observed (measured 2026-08-30,
  // held 60s, against a control where an external-tree edit appeared at t+5s). Both paths now
  // call one loader, so they cannot drift apart again.
  const result = await loadPromptsAcrossRoots(
    options.promptManager,
    {
      primary: promptsDir,
      basePath: promptsDir,
      bundled: options.configManager.getBundledResourceDirectory('prompts'),
      overlays: options.configManager.getOverlayResourceDirectories('prompts', promptsDir),
    },
    mergePromptResults
  );

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
