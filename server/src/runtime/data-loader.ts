// @lifecycle canonical - Prompt data loading helper using shared context.
/**
 * Loads and converts prompts with path normalization and registration.
 * Reuses existing PromptAssetManager behavior without duplicating transport/config logic.
 */

import { access, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import { formatResourceInventory } from './resource-inventory.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { PromptAssetManager } from '#modules/prompts/index.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { RuntimeLaunchOptions } from './options.js';
import type { PathResolver } from './paths.js';

import { loadPromptsAcrossRoots, mergePromptResults } from '#modules/prompts/prompt-root-loader.js';

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

  // The bundled tree loads FIRST, so a workspace prompts directory overlays it instead of
  // replacing it. `resolveResourceSubdir` returns the first existing candidate and stops, so a
  // workspace holding one prompt used to serve exactly one prompt — the 39 bundled ones silently
  // gone, and the startup line indistinguishable from a healthy one. Measured 2026-08-28; see
  // `PathResolver.getBundledResourceDir` for the same defect's fatal form on frameworks.
  //
  // Order is the precedence: `mergePromptResults` lets a later result win on a duplicate id, so
  // bundle → primary → overlays gives the documented "same ID = custom wins".
  const overlayPromptsDirs = pathResolver?.getOverlayResourceDirs('prompts', promptsPath) ?? [];

  const loaded = await loadPromptsAcrossRoots(
    promptManager,
    {
      primary: promptsPath,
      basePath: isDirectory ? promptsPath : path.dirname(promptsPath),
      bundled: pathResolver?.getBundledResourceDir('prompts'),
      overlays: overlayPromptsDirs,
    },
    mergePromptResults,
    logger
  );

  // Startup and reload call the SAME loader. They were two derivations of one question and they
  // disagreed — reload loaded the primary root alone, so the first hot reload under a configured
  // workspace silently dropped the bundled tree and every overlay. Unifying is the fix; keeping
  // two call sites in step by care is what failed.
  const bundledBase = loaded.base;
  let overridden = loaded.overridden;
  let unloadable = loaded.invalid;

  const promptsData = loaded.promptsData;
  const categories = loaded.categories;
  const convertedPrompts = loaded.convertedPrompts;

  if (isVerbose) {
    for (const overlayDir of overlayPromptsDirs) {
      logger.info(`  📂 Overlay prompts root: ${overlayDir}`);
    }
  }

  // Count AND root together (T1.8), and deliberately NOT gated on `!isQuiet`.
  //
  // STDIO transport auto-enables quiet unless --verbose (`options.ts:221`), and STDIO is how every
  // MCP client launches this server — so a `!isQuiet` guard would have made this line unreachable
  // in exactly the deployment it exists for. The stated reason for auto-quiet is protocol safety,
  // which the file logger already provides: INFO goes to `logs/mcp-server.log`, never to stdout.
  for (const line of formatResourceInventory({
    resource: 'prompts',
    root: promptsPath,
    count: promptsData.length,
    detail: { label: 'categories', value: categories.length },
    subtractions: [
      { label: 'invalid', value: unloadable },
      { label: 'overridden', value: overridden },
    ],
    overlays: overlayPromptsDirs,
    ...(bundledBase !== undefined ? { base: bundledBase } : {}),
  })) {
    logger.info(line);
  }

  if (!isQuiet) {
    logger.info('=== PROMPT LOADING RESULTS ===');
    logger.info(`✓ Converted ${convertedPrompts.length} prompts to MCP format`);
  }

  // Update downstream managers if available
  params.mcpToolsManager?.updateData(promptsData, convertedPrompts, categories);
  params.apiRouter?.updateData(promptsData, categories, convertedPrompts);

  // Auto-deregister prompts exported as client skills via skills-sync.yaml.
  // Set unconditionally: a hot reload that REMOVES the last registration must
  // clear the previous set, or the prompt stays deregistered until restart.
  const exportedPromptIds = await loadSkillsSyncExports(
    serverRoot,
    logger,
    convertedPrompts.map((prompt) => `${prompt.category}/${prompt.id}`)
  );
  promptManager.setExportedPromptIds(exportedPromptIds);

  // Publish content, do not bind. Binding is per serving unit — one shell per
  // STDIO connection and per HTTP request — so `createMcpServerFactory` owns it.
  // Registering here would target the construction-time shell no client attaches
  // to, and report success for a prompt surface that answers nothing.
  promptManager.setLivePrompts(convertedPrompts);
  if (!isQuiet) {
    logger.info(`🔄 ${convertedPrompts.length} prompts published to the MCP prompt registry`);
  }

  return {
    promptsData,
    categories,
    convertedPrompts,
    promptsDirectory: promptsPath,
  };
}

/** One load pass: the prompts, their categories, and the MCP-converted forms. */

/** Subset of skills-sync.yaml this module reads. Full schema: modules/skills-sync/service.ts */
/**
 * Values are `unknown` on purpose: this is parsed YAML from a user-editable file, so the
 * shape is a claim rather than a guarantee. Declaring the narrowed type here would make
 * the runtime guards below provably dead to the type checker while they remain necessary
 * at runtime — the cast would be the only thing making them look redundant.
 */
interface SkillsSyncDeregistrationConfig {
  registrations?: Record<string, unknown>;
  /** @deprecated flat pre-`registrations` list, still honored on read */
  exports?: unknown;
}

/** One client's scoped selection, once it has survived the runtime shape checks. */
interface ScopedSelection {
  user?: unknown;
  project?: unknown;
}

/** `'all'` selects every discoverable resource, so it cannot be enumerated from config text. */
const ALL_RESOURCES = Symbol('skills-sync:all');

/**
 * Union the manifest keys named across every client and scope.
 *
 * Scope is deliberately ignored: `prompts/list` is one surface, so a prompt
 * exported to any client under any scope is skill-served and listing it again
 * duplicates it. Returns ALL_RESOURCES when any client selects everything.
 */
function collectRegisteredKeys(
  config: SkillsSyncDeregistrationConfig
): string[] | typeof ALL_RESOURCES {
  const keys: string[] = [];

  if (Array.isArray(config.exports)) {
    keys.push(...config.exports.filter((entry): entry is string => typeof entry === 'string'));
  }

  for (const selection of Object.values(config.registrations ?? {})) {
    if (selection === 'all') return ALL_RESOURCES;
    if (selection === null || typeof selection !== 'object') continue;
    const scopes = selection as ScopedSelection;
    for (const scoped of [scopes.user, scopes.project]) {
      if (Array.isArray(scoped)) {
        keys.push(...scoped.filter((entry): entry is string => typeof entry === 'string'));
      }
    }
  }

  return keys;
}

/**
 * Load the registered exports from skills-sync.yaml and return `category/id`
 * keys for prompts that should be auto-deregistered from the MCP prompts list.
 *
 * A prompt exported as a client skill is served by that client's native harness,
 * so listing it again under `prompts/list` offers the same prompt twice. This
 * removes only the prompts-protocol listing: `>>id` still resolves, because
 * `prompt_engine` matches against its own `convertedPrompts` array
 * (`prompt-executor.ts` `updateData`), which this never touches. That is the
 * intended split — skill for the native path, `>>` when the caller wants the
 * full gate and chain machinery.
 *
 * Reads `registrations` (the canonical shape) and unions every client and scope,
 * since a prompt exported to any client is skill-served. The legacy flat
 * `exports` list is still honored for configs that predate `registrations`.
 * Returns an empty set when the file is missing or declares neither key.
 */
export async function loadSkillsSyncExports(
  serverRoot: string | undefined,
  logger: Logger,
  allPromptKeys: string[]
): Promise<Set<string>> {
  if (serverRoot === undefined) return new Set();

  const configPath = path.join(serverRoot, 'skills-sync.yaml');
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = yaml.load(content) as SkillsSyncDeregistrationConfig | null;

    if (config === null || typeof config !== 'object') {
      return new Set();
    }

    const registered = collectRegisteredKeys(config);
    if (registered === ALL_RESOURCES) {
      logger.info(
        `Skills sync: a client selects 'all', deregistering every prompt (${allPromptKeys.length}) from prompts/list (still callable via >>)`
      );
      return new Set(allPromptKeys);
    }

    const exportedIds = new Set<string>();
    for (const entry of registered) {
      if (entry.startsWith('prompt:')) {
        exportedIds.add(entry.slice('prompt:'.length));
      }
    }

    if (exportedIds.size > 0) {
      logger.info(
        `Skills sync: ${exportedIds.size} prompt(s) exported as skills, auto-deregistered from prompts/list (still callable via >>)`
      );
    }

    return exportedIds;
  } catch {
    // skills-sync.yaml is optional — silently skip if not found
    return new Set();
  }
}
