// @lifecycle canonical - Directory discovery and watch-target building for hot-reload setup.
import * as path from 'node:path';

import type { Logger } from '#shared/types/index.js';

import { isExcludedCategoryDirectoryName } from '#shared/utils/prompt-layout.js';

/** Minimal interface for checking YAML prompt presence in a directory. */
export interface YamlPromptChecker {
  hasYamlPrompts(dir: string): boolean;
}

export interface WatchTarget {
  path: string;
  category?: string;
}

/**
 * Discover prompt category directories suitable for file watching.
 *
 * Categories are identified by containing YAML prompt files
 * (either {id}/prompt.yaml subdirectories or {id}.yaml files).
 * Non-prompt directories are included as watch targets too
 * (they might gain prompts later).
 */
export async function discoverPromptDirectories(
  promptsDir: string,
  checker: YamlPromptChecker,
  logger: Logger
): Promise<WatchTarget[]> {
  const directories: WatchTarget[] = [];

  try {
    const fs = await import('node:fs/promises');
    const entries = await fs.readdir(promptsDir, { withFileTypes: true });

    for (const entry of entries) {
      // The loader's category rule, so the watcher observes exactly the categories it serves.
      if (entry.isDirectory() && !isExcludedCategoryDirectoryName(entry.name)) {
        const fullPath = path.join(promptsDir, entry.name);
        const hasYaml = checker.hasYamlPrompts(fullPath);

        directories.push(hasYaml ? { path: fullPath, category: entry.name } : { path: fullPath });
      }
    }
  } catch (error) {
    // A directory that does not exist yet has no categories. The observer watches it once it is
    // created, which for a custom workspace's resources directory is the first write.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error('Failed to discover prompt directories:', error);
    }
  }

  return directories;
}

/**
 * Build a deduplicated map of watch targets from prompt directories,
 * framework directories, and auxiliary reload directories.
 */
export function buildWatchTargets(
  promptsDir: string,
  categoryDirs: WatchTarget[],
  options?: {
    frameworkDirectories?: string[];
    auxiliaryDirectories?: string[][];
    /**
     * Every other root the prompt loader reads — the bundled tree and any workspace overlay.
     *
     * The catalog is composed from all of them at load time, so an edit in any of them changes
     * what the server serves; watching only the primary meant an edit to a bundled-only or
     * overlay-only prompt was never observed and the stale body was served until a restart.
     */
    promptRoots?: string[];
  }
): WatchTarget[] {
  const targets = new Map<string, WatchTarget>();

  // Main prompts directory
  targets.set(promptsDir, { path: promptsDir });

  // Every other root the loader composes the catalog from
  if (options?.promptRoots !== undefined) {
    for (const dir of options.promptRoots) {
      if (dir !== '') {
        targets.set(dir, { path: dir });
      }
    }
  }

  // Category directories
  for (const dir of categoryDirs) {
    const target: WatchTarget = { path: dir.path };
    if (dir.category) {
      target.category = dir.category;
    }
    targets.set(dir.path, target);
  }

  // Framework directories
  if (options?.frameworkDirectories) {
    for (const dir of options.frameworkDirectories) {
      if (dir) {
        targets.set(dir, { path: dir });
      }
    }
  }

  // Auxiliary reload directories
  if (options?.auxiliaryDirectories) {
    for (const dirs of options.auxiliaryDirectories) {
      for (const dir of dirs) {
        if (dir) {
          targets.set(dir, { path: dir });
        }
      }
    }
  }

  return [...targets.values()];
}
