// @lifecycle canonical - Builds resource change tracker auxiliary reload config.
/**
 * Resource Change Tracking Integration
 *
 * Provides auxiliary reload configuration to track filesystem changes
 * and integrates with the ResourceChangeTracker for audit logging.
 */

import * as path from 'node:path';

import { ConfigManager } from '../config/index.js';
import {
  createResourceChangeTracker,
  ResourceChangeTracker,
  TrackedResourceType,
} from '../tracking/index.js';

import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig, HotReloadEvent } from '../prompts/hot-reload-manager.js';

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
  serverRoot: string
): Promise<ResourceChangeTracker> {
  if (trackerInstance !== undefined) {
    logger.debug('ResourceChangeTracker already initialized, returning existing instance');
    return trackerInstance;
  }

  const runtimeStateDir = path.join(serverRoot, 'runtime-state');

  trackerInstance = createResourceChangeTracker(logger, {
    runtimeStateDir,
    maxEntries: 1000,
    trackPrompts: true,
    trackGates: true,
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
 */
export async function compareResourceBaseline(
  tracker: ResourceChangeTracker,
  configManager: ConfigManager,
  logger: Logger
): Promise<{ added: number; modified: number; removed: number }> {
  // Collect all current prompts and gates for baseline comparison
  const resources: Array<{
    resourceType: TrackedResourceType;
    resourceId: string;
    filePath: string;
  }> = [];

  try {
    // Get prompts directory
    const promptsPath = configManager.getResolvedPromptsFilePath();
    const fs = await import('node:fs');
    const fsPromises = await import('node:fs/promises');

    // Scan for prompt YAML files
    const scanDir = async (dir: string, resourceType: TrackedResourceType): Promise<void> => {
      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // Check for prompt.yaml inside directory
            const promptYaml = path.join(entryPath, 'prompt.yaml');
            const gateYaml = path.join(entryPath, 'gate.yaml');
            const hasPromptYaml = fs.existsSync(promptYaml);
            const hasGateYaml = fs.existsSync(gateYaml);

            if (hasPromptYaml) {
              resources.push({
                resourceType,
                resourceId: entry.name,
                filePath: promptYaml,
              });
            }
            if (hasGateYaml) {
              resources.push({
                resourceType: 'gate',
                resourceId: entry.name,
                filePath: gateYaml,
              });
            }

            // Only recurse into directories that don't contain resource files
            // (directories with prompt.yaml/gate.yaml ARE the resource, not containers)
            if (!hasPromptYaml && !hasGateYaml) {
              await scanDir(entryPath, resourceType);
            }
          } else if (entry.name.endsWith('.yaml') && !entry.name.startsWith('_')) {
            // Single-file YAML prompt
            const id = entry.name.replace(/\.yaml$/, '');
            resources.push({
              resourceType,
              resourceId: id,
              filePath: entryPath,
            });
          }
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
            });
          }
        }
      }
    }

    logger.debug(`ResourceChangeTracker: Comparing baseline with ${resources.length} resources`);

    return await tracker.compareBaseline(resources);
  } catch (error) {
    logger.warn('Failed to compare resource baseline:', error);
    return { added: 0, modified: 0, removed: 0 };
  }
}

/**
 * Build auxiliary reload config for resource change tracking
 * Hooks into HotReloadManager to track filesystem changes
 */
export function buildResourceChangeTrackerAuxiliaryReloadConfig(
  logger: Logger,
  configManager: ConfigManager
): AuxiliaryReloadConfig | undefined {
  const tracker = getResourceChangeTracker();
  if (tracker === undefined) {
    logger.debug('ResourceChangeTracker not initialized; skipping auxiliary reload wiring');
    return undefined;
  }

  // Get directories to watch
  const directories: string[] = [];

  const promptsPath = configManager.getResolvedPromptsFilePath();
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
