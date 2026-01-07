// @lifecycle canonical - Triggers Claude Code cache refresh on MCP resource changes.
/**
 * Claude Code Cache Hot Reload Integration
 *
 * Registers an auxiliary reload handler that triggers the Claude Code
 * hooks cache refresh whenever prompts or gates change in the MCP server.
 *
 * Uses native TypeScript cache generator (no external Python dependency).
 */

import * as path from 'node:path';

import { generateCache } from '../cache/index.js';

import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig, HotReloadEvent } from '../prompts/hot-reload-manager.js';

/**
 * Build auxiliary reload config for Claude Code cache refresh.
 * Watches prompts and gates directories and triggers cache refresh on changes.
 */
export function buildClaudeCodeCacheAuxiliaryReloadConfig(
  logger: Logger,
  serverRoot: string
): AuxiliaryReloadConfig {
  const resourcesDir = path.join(serverRoot, 'resources');

  return {
    id: 'claude-code-cache',
    directories: [path.join(resourcesDir, 'prompts'), path.join(resourcesDir, 'gates')],
    handler: async (event: HotReloadEvent) => {
      await refreshClaudeCodeCache(logger, serverRoot, event);
    },
  };
}

/**
 * Generate cache using native TypeScript generator.
 */
async function refreshClaudeCodeCache(
  logger: Logger,
  serverRoot: string,
  event: HotReloadEvent
): Promise<void> {
  logger.info(`Cache refresh triggered: ${event.reason}`);

  try {
    const result = await generateCache(serverRoot, logger);
    logger.info(`Cache refreshed: ${result.prompts} prompts, ${result.gates} gates`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Cache refresh failed: ${message}`);
    // Don't fail the hot reload for cache refresh issues
  }
}

/**
 * Generate cache on startup.
 * Called during application initialization.
 */
export async function generateCacheOnStartup(logger: Logger, serverRoot: string): Promise<void> {
  logger.info('Generating hooks cache on startup...');

  try {
    const result = await generateCache(serverRoot, logger);
    logger.info(`Startup cache generated: ${result.prompts} prompts, ${result.gates} gates`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Startup cache generation failed: ${message}`);
  }
}
