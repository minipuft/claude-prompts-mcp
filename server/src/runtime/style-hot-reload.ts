// @lifecycle canonical - Builds style hot-reload config for the hot-reload manager.

import type { Logger } from '#infra/logging/index.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';

import { createStyleHotReloadRegistration } from '#modules/formatting/hot-reload/index.js';

/**
 * Build style auxiliary reload configuration for HotReloadObserver.
 * Takes the McpToolRouter and resolves the pipeline's style manager through it — the same shape
 * as `buildFrameworkAuxiliaryReloadConfig` — because that manager loads in the background after
 * construction. `resolveStyleManager()` awaits its startup load rather than racing it, so an
 * `undefined` result here means the load genuinely failed, not that it hasn't settled yet.
 *
 * @param logger - Logger instance
 * @param mcpToolsManager - Owns the canonical StyleManager instance (optional)
 * @returns AuxiliaryReloadConfig or undefined if the style manager never became available
 */
export async function buildStyleAuxiliaryReloadConfig(
  logger: Logger,
  mcpToolsManager?: McpToolRouter
): Promise<AuxiliaryReloadConfig | undefined> {
  const styleManager = await mcpToolsManager?.resolveStyleManager();
  if (!styleManager) {
    logger.debug('Style manager unavailable; skipping style hot reload wiring.');
    return undefined;
  }

  try {
    const loader = styleManager.getLoader();
    const registration = createStyleHotReloadRegistration(logger, loader);

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'style',
      directories: registration.directories,
      handler: async (event) => {
        // Extract style ID from file path and add to event
        const firstFile = event.affectedFiles[0];
        const styleId = firstFile ? extractStyleIdFromPath(firstFile) : undefined;
        if (!styleId) {
          logger.warn('Unable to determine style ID for hot reload event', event);
          return;
        }
        const styleEvent = {
          ...event,
          type: 'style_changed' as const,
          styleId,
          // Pass through changeType for deletion handling (only if defined)
          ...(event.changeType ? { changeType: event.changeType } : {}),
        };
        await registration.handler(styleEvent);
      },
    };
  } catch (error) {
    logger.warn('Failed to configure style hot reload; continuing without style reload:', error);
    return undefined;
  }
}

/**
 * Extract style ID from a file path.
 * Expected path pattern: .../styles/{styleId}/style.yaml or .../styles/{styleId}/guidance.md
 */
function extractStyleIdFromPath(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const match = normalizedPath.match(/\/styles\/([^/]+)\//);
  return match?.[1]?.toLowerCase();
}
