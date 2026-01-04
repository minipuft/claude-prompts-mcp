/**
 * Cache Generator for Claude Code Hooks
 *
 * Scans prompts and gates directories and generates JSON cache files
 * that hooks can read without needing to parse YAML at runtime.
 *
 * Output: <server-root>/cache/
 *   - prompts.cache.json
 *   - gates.cache.json
 */
import type { Logger } from '../logging/index.js';
/**
 * Main cache generation function.
 * Generates both prompts and gates caches.
 */
export declare function generateCache(serverRoot: string, logger?: Logger): Promise<{
    prompts: number;
    gates: number;
}>;
/**
 * Get the cache directory path for a given server root.
 */
export declare function getCacheDir(serverRoot: string): string;
