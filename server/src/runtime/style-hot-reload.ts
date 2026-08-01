// @lifecycle canonical - Builds style hot-reload config for the hot-reload manager.

import type { Logger } from '#infra/logging/index.js';
import type { StyleManager } from '#modules/formatting/index.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';

import { createStyleHotReloadRegistration } from '#modules/formatting/hot-reload/index.js';

/**
 * Build style auxiliary reload configuration for HotReloadObserver.
 * Follows the same pattern as buildGateAuxiliaryReloadConfig.
 *
 * @param logger - Logger instance
 * @param styleManager - StyleManager instance (optional)
 * @returns AuxiliaryReloadConfig or undefined if style manager unavailable
 */
export function buildStyleAuxiliaryReloadConfig(
  logger: Logger,
  styleManager?: StyleManager
): AuxiliaryReloadConfig | undefined {
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
