// @lifecycle canonical - Prompt data loading helper using shared context.
/**
 * Loads and converts prompts with path normalization and registration.
 * Reuses existing PromptAssetManager behavior without duplicating transport/config logic.
 */

import { access } from 'node:fs/promises';
import * as path from 'node:path';

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
    updateData: (
      prompts: PromptData[],
      convertedPrompts: ConvertedPrompt[],
      categories: Category[]
    ) => void;
  };
  apiManager?: {
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
  promptsFilePath: string;
}

export async function loadPromptData(params: PromptDataLoadParams): Promise<PromptDataLoadResult> {
  const { logger, configManager, promptManager, runtimeOptions, serverRoot, pathResolver } = params;
  const isVerbose = runtimeOptions.verbose;
  const isQuiet = runtimeOptions.quiet;

  // Resolve prompts file path
  // Priority: PathResolver > ConfigManager
  const config = configManager.getConfig();
  let promptsFilePath = pathResolver
    ? pathResolver.getPromptsPath()
    : configManager.getResolvedPromptsFilePath();

  if (!isQuiet) {
    logger.info('Starting prompt loading pipeline...');
    logger.info(`Config prompts.file setting: "${config.prompts.file}"`);
  }

  // Log environment overrides
  if (process.env.MCP_PROMPTS_PATH) {
    logger.info(`🎯 MCP_PROMPTS_PATH override: "${process.env.MCP_PROMPTS_PATH}"`);
  }

  // Normalize to absolute path if needed
  if (!path.isAbsolute(promptsFilePath)) {
    const baseRoot = serverRoot ?? configManager.getServerRoot?.() ?? process.cwd();
    promptsFilePath = path.resolve(baseRoot, promptsFilePath);
    if (isVerbose) {
      logger.info(`🔧 Converting prompts path to absolute: ${promptsFilePath}`);
    }
  }

  // Verify file exists
  await access(promptsFilePath).catch((error) => {
    logger.error(`✗ Prompts configuration file NOT FOUND: ${promptsFilePath}`);
    if (isVerbose) {
      logger.error(`File access error:`, error);
      logger.error(`Is path absolute? ${path.isAbsolute(promptsFilePath)}`);
      logger.error(`Normalized path: ${path.normalize(promptsFilePath)}`);
    }
    throw new Error(`Prompts configuration file not found: ${promptsFilePath}`);
  });

  if (isVerbose) {
    logger.info(`✓ Prompts configuration file exists: ${promptsFilePath}`);
  }

  const result = await promptManager.loadAndConvertPrompts(
    promptsFilePath,
    path.dirname(promptsFilePath)
  );

  const promptsData = result.promptsData;
  const categories = result.categories;
  const convertedPrompts = result.convertedPrompts;

  if (!isQuiet) {
    logger.info('=== PROMPT LOADING RESULTS ===');
    logger.info(`✓ Loaded ${promptsData.length} prompts from ${categories.length} categories`);
    logger.info(`✓ Converted ${convertedPrompts.length} prompts to MCP format`);
  }

  // Update downstream managers if available
  params.mcpToolsManager?.updateData(promptsData, convertedPrompts, categories);
  params.apiManager?.updateData(promptsData, categories, convertedPrompts);

  // Register prompts with MCP server
  await promptManager.registerAllPrompts(convertedPrompts);
  if (!isQuiet) {
    logger.info('🔄 Prompts registered with MCP server');
  }

  return {
    promptsData,
    categories,
    convertedPrompts,
    promptsFilePath,
  };
}
