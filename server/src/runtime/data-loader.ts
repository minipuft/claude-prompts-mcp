// @lifecycle canonical - Prompt data loading helper using shared context.
/**
 * Loads and converts prompts with path normalization and registration.
 * Reuses existing PromptAssetManager behavior without duplicating transport/config logic.
 */

import { access, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { PromptAssetManager } from '#modules/prompts/index.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { RuntimeLaunchOptions } from './options.js';
import type { PathResolver } from './paths.js';

export interface PromptDataLoadParams {
  logger: Logger;
  configManager: ConfigLoader;
  promptManager: PromptAssetManager;
  runtimeOptions: RuntimeLaunchOptions;
  serverRoot?: string;
  /** Optional PathResolver for centralized path resolution */
  pathResolver?: PathResolver;
  mcpToolsManager?: {
    updateData: (
      prompts: PromptData[],
      convertedPrompts: ConvertedPrompt[],
      categories: Category[]
    ) => void;
  };
  apiRouter?: {
    updateData: (
      prompts: PromptData[],
      categories: Category[],
      convertedPrompts: ConvertedPrompt[]
    ) => void;
  };
}

export interface PromptDataLoadResult {
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
  promptsDirectory: string;
}

export async function loadPromptData(params: PromptDataLoadParams): Promise<PromptDataLoadResult> {
  const { logger, configManager, promptManager, runtimeOptions, serverRoot, pathResolver } = params;
  const isVerbose = runtimeOptions.verbose;
  const isQuiet = runtimeOptions.quiet;

  // Resolve prompts directory path
  // Priority: PathResolver > ConfigManager.getPromptsDirectory()
  const config = configManager.getConfig();
  let promptsPath = pathResolver
    ? pathResolver.getPromptsPath()
    : configManager.getPromptsDirectory();

  if (!isQuiet) {
    logger.info('Starting prompt loading pipeline...');
    logger.info(`Config prompts.directory setting: "${config.prompts.directory}"`);
  }

  // Normalize to absolute path if needed
  if (!path.isAbsolute(promptsPath)) {
    const baseRoot = serverRoot ?? configManager.getServerRoot?.();
    if (!baseRoot) {
      throw new Error(
        'Cannot resolve relative prompts path: serverRoot not provided and configManager.getServerRoot() unavailable'
      );
    }
    promptsPath = path.resolve(baseRoot, promptsPath);
    if (isVerbose) {
      logger.info(`🔧 Converting prompts path to absolute: ${promptsPath}`);
    }
  }

  // Verify path exists (can be directory or file for backward compatibility)
  await access(promptsPath).catch((error) => {
    logger.error(`✗ Prompts path NOT FOUND: ${promptsPath}`);
    if (isVerbose) {
      logger.error(`File access error:`, error);
      logger.error(`Is path absolute? ${path.isAbsolute(promptsPath)}`);
      logger.error(`Normalized path: ${path.normalize(promptsPath)}`);
    }
    throw new Error(`Prompts path not found: ${promptsPath}`);
  });

  // Determine if path is directory or file
  const pathStats = await stat(promptsPath);
  const isDirectory = pathStats.isDirectory();

  if (isVerbose) {
    const pathType = isDirectory ? 'directory' : 'file';
    logger.info(`✓ Prompts ${pathType} exists: ${promptsPath}`);
  }

  // Drop cached file contents before reading, so a reload observes the disk rather than the last
  // load's snapshot. PromptLoader caches by path with no mtime check, and this function is the
  // reload path behind `resource_manager(action:"reload")` — via fullServerRefresh →
  // loadAndProcessData. Its sibling `reloadPromptData` (the file-watcher path) has always cleared
  // the cache here; this one did not, so the manual reload re-read stale entries and still
  // reported "All prompts refreshed from disk". Measured 2026-08-11: create → update → reload →
  // execute served the PRE-update body, for a scoped reload, an unscoped reload, and two reloads
  // in a row; only the debounced watcher eventually applied the change.
  promptManager.clearLoaderCache();

  // Load prompts - loadAndConvertPrompts handles both directory and file paths
  const result = await promptManager.loadAndConvertPrompts(
    promptsPath,
    isDirectory ? promptsPath : path.dirname(promptsPath)
  );

  const promptsData = result.promptsData;
  const categories = result.categories;
  const convertedPrompts = result.convertedPrompts;

  // Load overlay prompts from workspace resource directories
  const overlayPromptsDirs = pathResolver?.getOverlayResourceDirs('prompts', promptsPath) ?? [];
  for (const overlayDir of overlayPromptsDirs) {
    try {
      const overlayResult = await promptManager.loadAndConvertPrompts(overlayDir, overlayDir);
      mergePromptResults({ promptsData, categories, convertedPrompts }, overlayResult);
      if (isVerbose) {
        logger.info(
          `  📂 Overlay prompts from ${overlayDir}: +${overlayResult.promptsData.length} prompts`
        );
      }
    } catch (err) {
      logger.warn(
        `Failed to load overlay prompts from ${overlayDir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!isQuiet) {
    logger.info('=== PROMPT LOADING RESULTS ===');
    logger.info(`✓ Loaded ${promptsData.length} prompts from ${categories.length} categories`);
    logger.info(`✓ Converted ${convertedPrompts.length} prompts to MCP format`);
    if (overlayPromptsDirs.length > 0) {
      logger.info(`  (includes overlays from ${overlayPromptsDirs.length} additional directories)`);
    }
  }

  // Update downstream managers if available
  params.mcpToolsManager?.updateData(promptsData, convertedPrompts, categories);
  params.apiRouter?.updateData(promptsData, categories, convertedPrompts);

  // Auto-deregister prompts exported as client skills via skills-sync.yaml
  const exportedPromptIds = await loadSkillsSyncExports(serverRoot, logger);
  if (exportedPromptIds.size > 0) {
    promptManager.setExportedPromptIds(exportedPromptIds);
  }

  // Register prompts with MCP server
  await promptManager.registerAllPrompts(convertedPrompts);
  if (!isQuiet) {
    logger.info('🔄 Prompts registered with MCP server');
  }

  return {
    promptsData,
    categories,
    convertedPrompts,
    promptsDirectory: promptsPath,
  };
}

/**
 * Merge overlay prompt results into the primary arrays.
 * Overlay prompts with matching IDs override primary ones (standard overlay semantics).
 */
function mergePromptResults(
  target: {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  },
  overlay: {
    promptsData: PromptData[];
    categories: Category[];
    convertedPrompts: ConvertedPrompt[];
  }
): void {
  // Merge categories (ensure overlay categories exist, don't replace existing metadata)
  for (const overlayCat of overlay.categories) {
    const exists = target.categories.some((c) => c.name === overlayCat.name);
    if (!exists) {
      target.categories.push(overlayCat);
    }
  }

  // Merge prompts (overlay wins on ID conflict)
  for (const overlayPrompt of overlay.promptsData) {
    const existingIdx = target.promptsData.findIndex((p) => p.id === overlayPrompt.id);
    if (existingIdx !== -1) {
      target.promptsData[existingIdx] = overlayPrompt;
    } else {
      target.promptsData.push(overlayPrompt);
    }
  }

  // Merge converted prompts (overlay wins on name conflict)
  for (const overlayConverted of overlay.convertedPrompts) {
    const existingIdx = target.convertedPrompts.findIndex((c) => c.name === overlayConverted.name);
    if (existingIdx !== -1) {
      target.convertedPrompts[existingIdx] = overlayConverted;
    } else {
      target.convertedPrompts.push(overlayConverted);
    }
  }
}

/**
 * Load the exports list from skills-sync.yaml and return prompt IDs
 * that should be auto-deregistered from MCP (exported as client skills).
 * Returns empty set if the file doesn't exist or has no exports.
 */
async function loadSkillsSyncExports(
  serverRoot: string | undefined,
  logger: Logger
): Promise<Set<string>> {
  if (serverRoot === undefined) return new Set();

  const configPath = path.join(serverRoot, 'skills-sync.yaml');
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = yaml.load(content) as { exports?: string[] } | null;

    if (config === null || !Array.isArray(config.exports)) {
      return new Set();
    }

    const exportedIds = new Set<string>();
    for (const entry of config.exports) {
      if (typeof entry === 'string' && entry.startsWith('prompt:')) {
        exportedIds.add(entry.slice('prompt:'.length));
      }
    }

    if (exportedIds.size > 0) {
      logger.info(
        `Skills sync: ${exportedIds.size} prompt(s) exported as skills, auto-deregistered from MCP`
      );
    }

    return exportedIds;
  } catch {
    // skills-sync.yaml is optional — silently skip if not found
    return new Set();
  }
}
