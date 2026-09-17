import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  isExcludedCategoryDirectoryName,
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
} from '@shared/utils/prompt-layout.js';

import { TYPE_CONFIG } from './types.js';
import type { ResourceType } from './types.js';

/**
 * Resolve the workspace directory from explicit flag, env var, or cwd.
 *
 * Priority:
 *   1. --workspace CLI flag (explicit parameter)
 *   2. MCP_WORKSPACE environment variable
 *   3. Current working directory
 */
export function resolveWorkspace(explicit?: string): string {
  const raw = explicit ?? process.env['MCP_WORKSPACE'] ?? process.cwd();
  const expanded = raw.startsWith('~') ? raw.replace('~', process.env['HOME'] ?? '') : raw;
  const resolved = resolve(expanded);

  if (!existsSync(resolved)) {
    throw new Error(`Workspace directory does not exist: ${resolved}`);
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${resolved}`);
  }

  return resolved;
}

/**
 * Resolve a resource directory within a workspace.
 * Checks `resources/<type>` first, then falls back to `<type>/` (legacy layout).
 */
export function resolveResourceDir(
  workspace: string,
  type: 'prompts' | 'gates' | 'frameworks' | 'styles',
): string {
  const resourcesPath = resolve(workspace, 'resources', type);
  if (existsSync(resourcesPath)) return resourcesPath;

  const directPath = resolve(workspace, type);
  if (existsSync(directPath)) return directPath;

  throw new Error(
    `No ${type} directory found in workspace: ${workspace}\n` +
      `  Tried: ${resourcesPath}\n` +
      `  Tried: ${directPath}`,
  );
}

export interface ResourceEntry {
  id: string;
  dir: string;
}

/**
 * Discover resource directories and return both ID and full path.
 *
 * The cli-shared discover functions return only names/IDs, losing path
 * information needed for grouped layouts (e.g., `prompts/{category}/{id}/`).
 * This function returns full directory paths alongside IDs.
 *
 * @param baseDir - Root directory to scan (e.g., `resources/prompts`)
 * @param entryFile - Entry point filename (e.g., `prompt.yaml`)
 * @param nested - True for the grouped prompts layout (`{category}/{id}/`),
 *   false for a flat `{id}/` layout (gates, frameworks, styles)
 */
export function discoverResourcePaths(
  baseDir: string,
  entryFile: string,
  nested: boolean,
): ResourceEntry[] {
  if (!existsSync(baseDir)) return [];

  try {
    return nested
      ? discoverGroupedPaths(baseDir, entryFile)
      : discoverFlatPaths(baseDir, entryFile);
  } catch {
    return [];
  }
}

/** `{baseDir}/{id}/{entryFile}`. Flat layouts have no categories and no skip rules. */
function discoverFlatPaths(baseDir: string, entryFile: string): ResourceEntry[] {
  return readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(baseDir, entry.name, entryFile)))
    .map((entry) => ({ id: entry.name, dir: join(baseDir, entry.name) }));
}

/**
 * `{baseDir}/{category}/{id}/{entryFile}`, with the server loader's rules from
 * `prompt-layout.ts`, so `cpm` lists and validates only what the server serves.
 *
 * - Every directory at the root is a category unless
 *   `isExcludedCategoryDirectoryName` says otherwise. A root directory holding
 *   its own `prompt.yaml` is still only a category: the loader serves no prompt
 *   from the root, so that file is not listed.
 * - Below the root, `_`/`.` entries are ignored and `tools/` is reserved for
 *   script tools.
 */
function discoverGroupedPaths(baseDir: string, entryFile: string): ResourceEntry[] {
  const results: ResourceEntry[] = [];
  for (const category of readdirSync(baseDir, { withFileTypes: true })) {
    if (!category.isDirectory() || isExcludedCategoryDirectoryName(category.name)) continue;
    const categoryDir = join(baseDir, category.name);
    let children;
    try {
      children = readdirSync(categoryDir, { withFileTypes: true });
    } catch {
      continue; // an unreadable category contributes nothing
    }
    for (const child of children) {
      if (!child.isDirectory() || isIgnoredPromptEntryName(child.name)) continue;
      if (isReservedPromptDirectoryName(child.name)) continue;
      const dir = join(categoryDir, child.name);
      if (existsSync(join(dir, entryFile))) results.push({ id: child.name, dir });
    }
  }
  return results;
}

/**
 * Find a specific resource by type and ID within a workspace.
 * Returns the matching entry or null if not found.
 */
export function findResource(
  workspace: string,
  type: ResourceType,
  id: string,
): ResourceEntry | null {
  let baseDir: string;
  try {
    baseDir = resolveResourceDir(workspace, type);
  } catch {
    return null;
  }

  const config = TYPE_CONFIG[type];
  const resources = discoverResourcePaths(baseDir, config.entryFile, config.nested);
  return resources.find((r) => r.id === id) ?? null;
}

// ─── Reference Scanning ──────────────────────────────────────────────────────

export interface ReferenceHit {
  file: string;
  line: number;
  content: string;
}

/**
 * Scan all YAML entry files in a workspace for references to a given ID.
 * Skips the resource's own `id:` line to avoid self-matches.
 */
export function scanReferences(workspace: string, targetId: string): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const allTypes: ResourceType[] = ['prompts', 'gates', 'frameworks', 'styles'];

  for (const type of allTypes) {
    const config = TYPE_CONFIG[type];
    let baseDir: string;
    try {
      baseDir = resolveResourceDir(workspace, type);
    } catch {
      continue;
    }

    const resources = discoverResourcePaths(baseDir, config.entryFile, config.nested);
    for (const res of resources) {
      const yamlPath = join(res.dir, config.entryFile);
      try {
        const content = readFileSync(yamlPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes(targetId) && !line.match(/^id:\s/)) {
            hits.push({ file: yamlPath, line: i + 1, content: line.trim() });
          }
        }
      } catch {
        // Unreadable file — skip
      }
    }
  }

  return hits;
}
