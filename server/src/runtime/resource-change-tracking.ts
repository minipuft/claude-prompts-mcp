// @lifecycle canonical - Builds resource change tracker auxiliary reload config.
/**
 * Resource Change Tracking Integration
 *
 * Provides auxiliary reload configuration to track filesystem changes
 * and integrates with the ResourceChangeTracker for audit logging.
 */

import * as path from 'node:path';

import type { StateStoreOptions } from '#infra/database/stores/interface.js';
import type { Logger } from '#infra/logging/index.js';
import type {
  AuxiliaryReloadConfig,
  HotReloadEvent,
} from '#modules/hot-reload/hot-reload-observer.js';
import type { QuarantineView } from '#shared/utils/resource-quarantine.js';

import { ConfigLoader } from '#infra/config/index.js';
import {
  createResourceChangeTracker,
  ResourceChangeTracker,
  TrackedResourceType,
} from '#infra/observability/tracking/index.js';
import {
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
  promptIdFromDirectory,
  promptIdFromSingleFile,
} from '#shared/utils/prompt-layout.js';

/**
 * Singleton tracker instance for the application
 * Initialized once and shared across all consumers
 */
let trackerInstance: ResourceChangeTracker | undefined;

/**
 * Initialize the ResourceChangeTracker
 * Should be called once during application startup
 */
export async function initializeResourceChangeTracker(
  logger: Logger,
  serverRoot: string,
  dbPath?: string,
  defaultScope?: StateStoreOptions
): Promise<ResourceChangeTracker> {
  if (trackerInstance !== undefined) {
    logger.debug('ResourceChangeTracker already initialized, returning existing instance');
    return trackerInstance;
  }

  trackerInstance = createResourceChangeTracker(logger, {
    serverRoot,
    ...(dbPath !== undefined ? { dbPath } : {}),
    maxEntries: 1000,
    trackPrompts: true,
    trackGates: true,
    ...(defaultScope !== undefined ? { defaultScope } : {}),
  });

  await trackerInstance.initialize();
  return trackerInstance;
}

/**
 * Get the initialized tracker instance
 * Returns undefined if not yet initialized
 */
export function getResourceChangeTracker(): ResourceChangeTracker | undefined {
  return trackerInstance;
}

/**
 * Compare current resources against baseline and log external changes
 * Called at startup to detect changes made while server was down
 *
 * `quarantine` is the loaders' record of what they refused. Without it this function runs its own
 * filesystem walk and treats every readable file as a resource — a third derivation of "what is in
 * the catalog", disagreeing with the loaders by construction, which is how a file that never
 * entered the catalog came to be logged as `added`. With it, a refused file is neither added nor
 * removed; see `ResourceChangeTracker.compareBaseline`.
 */
export async function compareResourceBaseline(
  tracker: ResourceChangeTracker,
  configManager: ConfigLoader,
  logger: Logger,
  quarantine?: QuarantineView
): Promise<{ added: number; modified: number; removed: number; refused: number }> {
  // Collect all current prompts and gates for baseline comparison
  const resources: Array<{
    resourceType: TrackedResourceType;
    resourceId: string;
    filePath: string;
    refused?: boolean;
  }> = [];

  /**
   * Ask the quarantine by PATH, which is what this walk holds.
   *
   * Deliberately not by id, even now that this walk and the loader derive the same one (P4.28):
   * two roots may legitimately serve the same id, which is the overlay contract, so an id is not a
   * unique handle on a FILE. `ResourceQuarantine` is keyed by `(root, path)` for that reason. The
   * path is the one thing both sides hold unambiguously.
   */
  const isRefused = (filePath: string): boolean => quarantine?.isRefused(filePath) === true;

  try {
    // Get prompts directory
    const promptsPath = configManager.getResolvedPromptsDirectory();
    const fs = await import('node:fs');
    const fsPromises = await import('node:fs/promises');

    /**
     * Record one resource, unless the layout says it is not one or the file is not there.
     *
     * `resourceId === undefined` is `#shared/utils/prompt-layout.js` declining the entry — a
     * reserved filename, or a location the loader does not serve a prompt from — so the two
     * questions a walk has to get right collapse into one `if` that cannot be half-applied.
     */
    const recordResource = (
      resourceType: TrackedResourceType,
      resourceId: string | undefined,
      filePath: string
    ): void => {
      if (resourceId === undefined || !fs.existsSync(filePath)) return;
      resources.push({ resourceType, resourceId, filePath, refused: isRefused(filePath) });
    };

    /**
     * Walk the prompts tree the way the loader walks it.
     *
     * THREE QUESTIONS, ALL OF THEM ANSWERED IN `#shared/utils/prompt-layout.js`: which entries to
     * skip, which files are prompts and where they may sit, and what id each is served under. Only
     * the filename half was shared before P4.28. This walk stopped descending at any directory
     * holding `prompt.yaml` — on the reasoning that such a directory IS the resource rather than a
     * container — while `discoverYamlPrompts` always recurses, because a chain directory holds its
     * own definition AND its steps. Measured 2026-09-15: 15 shipped step prompts sit below that
     * line (`examples/deep_analysis`, `planning/implementation_plan`, `examples/quick_decision`,
     * `codebase-setup/scaffold_project`), so an external edit to any of them reached this
     * comparison as nothing at all — no `added`, no `modified`, no `removed`.
     *
     * `depth` is gone with it. It existed to keep a root-level `.yaml` out of the results, and
     * that is now a property of the id derivation rather than of the walk's bookkeeping: a file
     * whose only segment IS its category has no id, and the shared module says so.
     */
    const scanDir = async (dir: string, resourceType: TrackedResourceType): Promise<void> => {
      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          // The loader's first act on every entry, file or directory. Without it this walk would
          // descend into `_drafts/` and announce everything below it.
          if (isIgnoredPromptEntryName(entry.name)) continue;

          const entryPath = path.join(dir, entry.name);
          if (!entry.isDirectory()) {
            recordResource(resourceType, promptIdFromSingleFile(promptsPath, entryPath), entryPath);
            continue;
          }

          // A prompt's `tools/` is reserved for script tools, so nothing below it entered the
          // catalog and nothing below it may be announced as an external change. Same predicate
          // the loader applies, from the same module.
          if (isReservedPromptDirectoryName(entry.name)) continue;

          recordResource(
            resourceType,
            promptIdFromDirectory(promptsPath, entryPath),
            path.join(entryPath, 'prompt.yaml')
          );
          // Gates keep their directory name as their id: the gate layout is flat
          // (`{root}/{id}/gate.yaml`) and has no category level for a path-derived id to strip.
          recordResource('gate', entry.name, path.join(entryPath, 'gate.yaml'));

          // Finding a definition is NOT a reason to stop — that was the defect.
          await scanDir(entryPath, resourceType);
        }
      } catch (error) {
        logger.debug(`Error scanning directory ${dir}:`, error);
      }
    };

    // Scan prompts
    if (fs.existsSync(promptsPath)) {
      await scanDir(promptsPath, 'prompt');
    }

    // Scan gates (from server/gates directory)
    let gatesPath: string | undefined;
    try {
      gatesPath = configManager.getGatesDirectory();
    } catch {
      // Gates directory may not be configured
    }
    if (gatesPath !== undefined && gatesPath !== '' && fs.existsSync(gatesPath)) {
      const gateEntries = await fsPromises.readdir(gatesPath, { withFileTypes: true });
      for (const entry of gateEntries) {
        if (entry.isDirectory()) {
          const gateYaml = path.join(gatesPath, entry.name, 'gate.yaml');
          if (fs.existsSync(gateYaml)) {
            resources.push({
              resourceType: 'gate',
              resourceId: entry.name,
              filePath: gateYaml,
              refused: isRefused(gateYaml),
            });
          }
        }
      }
    }

    logger.debug(`ResourceChangeTracker: Comparing baseline with ${resources.length} resources`);

    return await tracker.compareBaseline(resources);
  } catch (error) {
    logger.warn('Failed to compare resource baseline:', error);
    return { added: 0, modified: 0, removed: 0, refused: 0 };
  }
}

/**
 * Build auxiliary reload config for resource change tracking
 * Hooks into HotReloadObserver to track filesystem changes
 */
export function buildResourceChangeTrackerAuxiliaryReloadConfig(
  logger: Logger,
  configManager: ConfigLoader
): AuxiliaryReloadConfig | undefined {
  const tracker = getResourceChangeTracker();
  if (tracker === undefined) {
    logger.debug('ResourceChangeTracker not initialized; skipping auxiliary reload wiring');
    return undefined;
  }

  // Get directories to watch
  const directories: string[] = [];

  const promptsPath = configManager.getResolvedPromptsDirectory();
  if (promptsPath !== '') {
    directories.push(promptsPath);
  }

  try {
    const gatesPath = configManager.getGatesDirectory();
    if (gatesPath !== '') {
      directories.push(gatesPath);
    }
  } catch {
    // Gates directory may not be configured
  }

  if (directories.length === 0) {
    logger.debug('No resource directories to watch for change tracking');
    return undefined;
  }

  return {
    id: 'resource-change-tracker',
    directories,
    handler: async (event: HotReloadEvent) => {
      // Determine resource type and operation from the event
      const operation = event.changeType ?? 'modified';
      const filePath = event.affectedFiles[0];

      if (filePath === undefined || filePath === '') {
        return;
      }

      // Determine resource type from path
      let resourceType: TrackedResourceType = 'prompt';
      if (filePath.includes('/gates/') || filePath.includes('\\gates\\')) {
        resourceType = 'gate';
      }

      // Extract resource ID from path
      const resourceId = extractResourceId(filePath);
      if (resourceId === undefined || resourceId === '') {
        logger.debug(`Could not extract resource ID from path: ${filePath}`);
        return;
      }

      try {
        await tracker.logChange({
          source: 'filesystem',
          operation,
          resourceType,
          resourceId,
          filePath,
        });
      } catch (error) {
        logger.warn(`Failed to log filesystem change for ${resourceId}:`, error);
      }
    },
    match: (event) => {
      // Only track YAML files
      return event.filePath.endsWith('.yaml') || event.filePath.endsWith('.yml');
    },
  };
}

/**
 * Log an MCP tool change (for use in CRUD handlers)
 * Returns silently if tracker is not initialized
 */
export async function logMcpToolChange(
  logger: Logger,
  params: {
    operation: 'added' | 'modified' | 'removed';
    resourceType: TrackedResourceType;
    resourceId: string;
    filePath: string;
    content?: string;
  }
): Promise<void> {
  const tracker = getResourceChangeTracker();
  if (tracker === undefined) {
    return;
  }

  try {
    await tracker.logChange({
      source: 'mcp-tool',
      operation: params.operation,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      filePath: params.filePath,
      content: params.content,
    });
  } catch (error) {
    logger.warn(`Failed to log MCP tool change for ${params.resourceId}:`, error);
  }
}

/**
 * Extract resource ID from a file path
 */
function extractResourceId(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // For directory format: .../category/resource-id/prompt.yaml or gate.yaml
  const dirMatch = normalizedPath.match(/\/([^/]+)\/(prompt|gate)\.yaml$/);
  const dirMatchId = dirMatch !== null ? dirMatch[1] : undefined;
  if (dirMatchId !== undefined && dirMatchId !== '') {
    return dirMatchId;
  }

  // For file format: .../category/resource-id.yaml
  const fileMatch = normalizedPath.match(/\/([^/]+)\.yaml$/);
  const fileMatchId = fileMatch !== null ? fileMatch[1] : undefined;
  if (
    fileMatchId !== undefined &&
    fileMatchId !== '' &&
    !['prompt', 'gate', 'category'].includes(fileMatchId)
  ) {
    return fileMatchId;
  }

  return undefined;
}
