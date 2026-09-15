// @lifecycle canonical - Builds script tool hot-reload config for the hot-reload manager.

import path from 'node:path';

import type { Logger } from '#infra/logging/index.js';
import type { ScriptToolDefinitionLoader } from '#modules/automation/core/script-definition-loader.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';

import {
  createScriptHotReloadRegistration,
  isScriptToolFile,
} from '#modules/automation/hot-reload/index.js';

/**
 * A workspace script has no `getWatchDirectories()` to call: `WorkspaceScriptLoader` isn't a
 * loader in the gate/style/framework sense, and its workspace tier is one fixed directory
 * (`configManager.getScriptsDirectory()`) rather than a primary-plus-overlay set. This
 * carries that directory and a way to invalidate the pipeline's live copy once an edit lands in
 * it — `WorkspaceScriptLoader.workspaceCache` has no per-file invalidation, so a whole-cache
 * clear is what `clearWorkspaceCache` is expected to do.
 */
export interface WorkspaceScriptsWatch {
  directory: string;
  clearWorkspaceCache: () => void;
}

/**
 * Build script tool auxiliary reload configuration for HotReloadObserver.
 * Follows the same pattern as buildGateAuxiliaryReloadConfig, plus an optional second watched
 * directory for workspace-tier scripts (`{{script:id}}` resolves prompt-local scripts first,
 * then the workspace tier — see `WorkspaceScriptLoader`).
 *
 * @param logger - Logger instance
 * @param scriptLoader - Script tool definition loader for prompt-local tools (optional)
 * @param promptsDir - Base prompts directory
 * @param workspaceScripts - Workspace scripts directory plus its cache-clear callback (optional)
 * @returns AuxiliaryReloadConfig or undefined if script loader unavailable
 */
export function buildScriptAuxiliaryReloadConfig(
  logger: Logger,
  scriptLoader: ScriptToolDefinitionLoader | undefined,
  promptsDir: string,
  workspaceScripts?: WorkspaceScriptsWatch
): AuxiliaryReloadConfig | undefined {
  if (!scriptLoader) {
    logger.debug('Script loader unavailable; skipping script tool hot reload wiring.');
    return undefined;
  }

  if (!promptsDir) {
    logger.debug('Prompts directory not specified; skipping script tool hot reload wiring.');
    return undefined;
  }

  try {
    const registration = createScriptHotReloadRegistration(logger, scriptLoader, promptsDir);

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    const workspaceDir =
      workspaceScripts !== undefined ? path.normalize(workspaceScripts.directory) : undefined;
    const isWorkspaceScriptFile = (filePath: string): boolean =>
      workspaceDir !== undefined && path.normalize(filePath).startsWith(workspaceDir);

    return {
      id: 'script-tool',
      directories:
        workspaceScripts !== undefined
          ? [...registration.directories, workspaceScripts.directory]
          : registration.directories,
      handler: async (event) => {
        const affectedFile = event.affectedFiles[0];
        if (affectedFile === undefined) {
          return;
        }

        // A workspace-tier script has no `/tools/{id}/` path segment, so it never matches
        // `isScriptToolFile()` below; route it to the workspace cache clear instead of the
        // prompt-local reload path.
        if (workspaceScripts !== undefined && isWorkspaceScriptFile(affectedFile)) {
          workspaceScripts.clearWorkspaceCache();
          return;
        }

        if (!isScriptToolFile(affectedFile)) {
          return;
        }

        await registration.handler(event);
      },
      match: (event) => {
        if (event.filePath !== '' && isWorkspaceScriptFile(event.filePath)) {
          return true;
        }
        return event.filePath !== '' ? isScriptToolFile(event.filePath) : false;
      },
    };
  } catch (error) {
    logger.warn(
      'Failed to configure script tool hot reload; continuing without script reload:',
      error
    );
    return undefined;
  }
}
