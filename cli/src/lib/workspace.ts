import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ResourceLocation } from '@cli-shared/resource-operations.js';
import {
  isExcludedCategoryDirectoryName,
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
  isSingleFilePromptName,
  promptIdFromDirectory,
  promptIdFromSingleFile,
} from '@shared/utils/prompt-layout.js';
import { parseYaml } from '@shared/utils/yaml/index.js';

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

/**
 * One resource `cpm` found: the id the server serves it under, and where it lives.
 *
 * Read the definition from `file`. `dir` exists only on the directory form, so a command that
 * would delete, move or snapshot a directory has to ask which form it holds first — a
 * single-file prompt's surrounding directory is a category or a chain, never the prompt.
 */
export type ResourceEntry = ResourceLocation & { id: string };

/**
 * Discover resources and return each one's id, form and definition file.
 *
 * @param baseDir - Root directory to scan (e.g., `resources/prompts`)
 * @param entryFile - Entry point filename (e.g., `prompt.yaml`)
 * @param nested - True for the grouped prompts layout (`{category}/…`), false for a flat `{id}/`
 *   layout (gates, frameworks, styles)
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
    .map((entry) => {
      const dir = join(baseDir, entry.name);
      return { id: entry.name, form: 'dir', dir, file: join(dir, entryFile) };
    });
}

/**
 * Every prompt the server's loader serves under `baseDir`, under the id it serves it as.
 *
 * Mirrors `discoverYamlPrompts` (`server/src/modules/prompts/yaml-prompt-loader.ts`) over each
 * category, with the rules and ids from `prompt-layout.ts`, the module the loader uses:
 *
 * - Every directory at the root is a category unless `isExcludedCategoryDirectoryName` says
 *   otherwise. A root directory holding its own `prompt.yaml` is still only a category.
 * - Inside a category, at any depth: `_`/`.` entries are ignored and `tools/` is reserved. A
 *   directory holding `prompt.yaml` is a prompt and is still descended into, because a chain holds
 *   its steps. A `*.yaml` file passing `isSingleFilePromptName` is a prompt too.
 * - The id is the path below the category, joined with `/` (`chain/step`), minus `.yaml` for a
 *   file. When both forms spell one id in one directory, the directory wins, as in the loader.
 */
function discoverGroupedPaths(baseDir: string, entryFile: string): ResourceEntry[] {
  const results: ResourceEntry[] = [];
  for (const category of readdirSync(baseDir, { withFileTypes: true })) {
    if (!category.isDirectory() || isExcludedCategoryDirectoryName(category.name)) continue;
    collectPrompts(baseDir, join(baseDir, category.name), entryFile, results);
  }
  return results;
}

/** One directory's prompts, then its subdirectories', in the order the loader returns them. */
function collectPrompts(
  baseDir: string,
  dir: string,
  entryFile: string,
  results: ResourceEntry[],
): void {
  let children;
  try {
    children = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // an unreadable directory contributes nothing
  }
  const here = new Map<string, ResourceEntry>();
  const below: ResourceEntry[] = [];
  for (const child of children) {
    if (isIgnoredPromptEntryName(child.name)) continue;
    const path = join(dir, child.name);
    if (child.isDirectory()) {
      if (isReservedPromptDirectoryName(child.name)) continue;
      const id = promptIdFromDirectory(baseDir, path);
      const file = join(path, entryFile);
      // Directory takes precedence over a file with the same id
      if (id !== undefined && existsSync(file)) here.set(id, { id, form: 'dir', dir: path, file });
      collectPrompts(baseDir, path, entryFile, below);
    } else if (child.isFile()) {
      const id = promptIdFromSingleFile(baseDir, path);
      if (id !== undefined && !here.has(id)) here.set(id, { id, form: 'file', file: path });
    }
  }
  results.push(...here.values(), ...below);
}

/**
 * True when the loader would serve a prompt of this form under this last id segment.
 *
 * The same predicates the walk above applies, asked of a name before it exists.
 */
export function isServedPromptName(form: ResourceEntry['form'], name: string): boolean {
  if (form === 'file') return isSingleFilePromptName(`${name}.yaml`);
  return !isIgnoredPromptEntryName(name) && !isReservedPromptDirectoryName(name);
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
 * Escape a literal string for embedding in a `RegExp`.
 *
 * `resource-operations.ts` carries its own private copy for the same purpose (building an
 * id-boundary pattern). Not shared: that module sits in `server/`, scanned by the server's own
 * knip ratchet, which counts a symbol exported ONLY for a cross-package consumer in `cli/` as an
 * unused export — it cannot see the import on this side of the package boundary. Two lines
 * duplicated is cheaper than a ratchet false-positive on every future `server/` change.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The reference syntaxes `scanReferences` counts, decided against what the bundled tree actually
 * writes (`rg '>>[a-z_]' resources/prompts --glob '*.md'`, `chainSteps[].promptId` in every chain):
 *
 * - `>>id` — the delegation/invocation token a `.md` template names another prompt with
 *   (`Invoke >>create_gate`, `>>your_prompt`).
 * - `promptId: id` — the YAML key a `chainSteps` entry names a step or a shared prompt by, bare or
 *   quoted, optionally list-prefixed (`- promptId: 'foo'`).
 *
 * A bare `id:` line — a resource naming ITSELF, foreign or self — is deliberately not a reference
 * syntax: neither pattern can match it, so unlike the substring scan this replaced, no separate
 * self-id skip is needed to keep a resource's own declaration out of its own hit list.
 *
 * Both patterns require an id BOUNDARY after the match (`(?![A-Za-z0-9_])`), so scanning for `foo`
 * does not match `foo_bar` — `foo_bar`'s own `- promptId: foo_bar` line no longer misreports as a
 * reference to `foo` the way a plain `.includes(targetId)` did.
 */
function referencePatterns(targetId: string): readonly RegExp[] {
  const escaped = escapeRegExp(targetId);
  const boundary = '(?![A-Za-z0-9_])';
  return [
    new RegExp(`>>${escaped}${boundary}`),
    new RegExp(`^\\s*(?:-\\s*)?promptId:\\s*['"]?${escaped}${boundary}`),
  ];
}

/**
 * Every file the loader would read for one resource: its entry file, plus each file a top-level
 * `*File` key in that entry points to (`systemMessageFile`, `userMessageTemplateFile` on a prompt;
 * `guidanceFile` on a gate or style; `phasesFile`/`judgePromptFile` on a framework — the same
 * convention `yaml-prompt-loader.ts` and its gate/framework/style siblings resolve relative to the
 * resource's own directory). A single-file prompt (`form: 'file'`) has no directory to hold a
 * companion file — the loader only reads `*File` keys "for directory format" — so it contributes
 * only itself.
 */
function filesToScan(res: ResourceLocation): readonly string[] {
  if (res.form === 'file') return [res.file];

  let entryData: Record<string, unknown> | undefined;
  try {
    entryData = parseYaml<Record<string, unknown>>(readFileSync(res.file, 'utf8')).data;
  } catch {
    entryData = undefined;
  }

  const companions = Object.entries(entryData ?? {})
    .filter(
      (entry): entry is [string, string] => entry[0].endsWith('File') && typeof entry[1] === 'string'
    )
    .map(([, relativePath]) => join(res.dir, relativePath))
    .filter((path) => existsSync(path));

  return [...new Set([res.file, ...companions])];
}

function scanFileForReferences(
  file: string,
  patterns: readonly RegExp[],
  hits: ReferenceHit[]
): void {
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (patterns.some((pattern) => pattern.test(line))) {
        hits.push({ file, line: i + 1, content: line.trim() });
      }
    }
  } catch {
    // Unreadable file — skip
  }
}

/**
 * Scan every file the loader would read for each resource in a workspace — entry YAML, its
 * `*File`-pointed companions, and (for prompts) every nested chain step's own files — for a
 * reference to `targetId` in one of the syntaxes {@link referencePatterns} names.
 */
export function scanReferences(workspace: string, targetId: string): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const allTypes: ResourceType[] = ['prompts', 'gates', 'frameworks', 'styles'];
  const patterns = referencePatterns(targetId);

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
      for (const file of filesToScan(res)) {
        scanFileForReferences(file, patterns, hits);
      }
    }
  }

  return hits;
}
