/**
 * Claude Code Cache Hot Reload Integration
 *
 * Registers an auxiliary reload handler that triggers the Claude Code
 * hooks cache refresh whenever prompts or gates change in the MCP server.
 *
 * Uses native TypeScript cache generator (no external Python dependency).
 */
import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';
/**
 * Build auxiliary reload config for Claude Code cache refresh.
 * Watches prompts and gates directories and triggers cache refresh on changes.
 */
export declare function buildClaudeCodeCacheAuxiliaryReloadConfig(logger: Logger, serverRoot: string): AuxiliaryReloadConfig;
/**
 * Generate cache on startup.
 * Called during application initialization.
 */
export declare function generateCacheOnStartup(logger: Logger, serverRoot: string): Promise<void>;
