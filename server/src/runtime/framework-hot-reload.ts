// @lifecycle canonical - Builds framework hot-reload config for the hot-reload manager.

import type { Logger } from '#infra/logging/index.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';

import { createFrameworkHotReloadRegistration } from '#engine/frameworks/definitions/index.js';

export function buildFrameworkAuxiliaryReloadConfig(
  logger: Logger,
  mcpToolsManager?: McpToolRouter
): AuxiliaryReloadConfig | undefined {
  const frameworkManager = mcpToolsManager?.getFrameworkManager?.();
  if (!frameworkManager) {
    logger.debug('Framework manager unavailable; skipping framework hot reload wiring.');
    return undefined;
  }

  try {
    const registry = frameworkManager.getFrameworkRegistry();

    // Wire hot-reload callbacks to keep FrameworkManager.frameworks cache in sync
    const registration = createFrameworkHotReloadRegistration(logger, registry, undefined, {
      onFrameworkDeleted: async (frameworkId: string) => {
        // Remove the framework, moving a selection that named it to the configured default
        await frameworkManager.removeFramework(frameworkId);
        logger.debug(`Framework cache cleared for deleted framework: ${frameworkId}`);
      },
      onFrameworkReloaded: async (frameworkId: string) => {
        // Regenerate framework definition when framework is reloaded
        await frameworkManager.reload(frameworkId);
        logger.debug(`Framework cache refreshed for reloaded framework: ${frameworkId}`);
      },
    });

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'framework',
      directories: registration.directories,
      handler: async (event) => {
        // Resolve the framework id from the path, the way the gate and style registrations do.
        //
        // The observer tags an event with a framework id only when it classifies the file as a
        // framework file, which requires a `.yaml` extension — so a framework's `system-prompt.md`
        // or any other non-YAML file it carries arrived here with no id and was refused with
        // "missing frameworkId, skipping". Deriving it here means a registration never depends on
        // upstream classification for the one field its handler cannot proceed without.
        const firstFile = event.affectedFiles[0];
        const frameworkId =
          event.frameworkId ??
          (firstFile !== undefined ? extractFrameworkIdFromPath(firstFile) : undefined);
        if (frameworkId === undefined) {
          logger.warn('Unable to determine framework ID for hot reload event', event);
          return;
        }
        await registration.handler({ ...event, frameworkId });
      },
      reconcile: async () => {
        const removed = await registration.coordinator.reconcile();
        if (removed.length > 0) {
          logger.info(`Framework reconciliation unregistered: ${removed.join(', ')}`);
        }
      },
    };
  } catch (error) {
    logger.warn(
      'Failed to configure framework hot reload; continuing with prompt-only reload:',
      error
    );
    return undefined;
  }
}

/**
 * Extract a framework ID from a file path.
 *
 * Expected path pattern: `.../frameworks/{frameworkId}/framework.yaml`, and likewise for any
 * other file a framework directory carries (`phases.yaml`, `system-prompt.md`).
 */
function extractFrameworkIdFromPath(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const match = normalizedPath.match(/\/frameworks\/([^/]+)\//);
  return match?.[1]?.toLowerCase();
}
