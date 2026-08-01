import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
 * @param nested - If true, scan two levels deep (flat + grouped)
 */
export function discoverResourcePaths(
  baseDir: string,
  entryFile: string,
  nested: boolean,
): ResourceEntry[] {
  if (!existsSync(baseDir)) return [];

  const results: ResourceEntry[] = [];

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const childDir = join(baseDir, entry.name);

      // Level 1 (flat): baseDir/{id}/{entryFile}
      if (existsSync(join(childDir, entryFile))) {
        results.push({ id: entry.name, dir: childDir });
        continue;
      }

      if (!nested) continue;

      // Level 2 (grouped): baseDir/{group}/{id}/{entryFile}
      try {
        const groupEntries = readdirSync(childDir, { withFileTypes: true });
        for (const child of groupEntries) {
          if (!child.isDirectory()) continue;
          const nestedDir = join(childDir, child.name);
          if (existsSync(join(nestedDir, entryFile))) {
            results.push({ id: child.name, dir: nestedDir });
          }
        }
      } catch {
        // Group directory unreadable — skip
      }
    }
  } catch {
    return [];
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
