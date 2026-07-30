// @lifecycle canonical - Builds gate hot-reload config for the hot-reload manager.
import { createGateHotReloadRegistration } from '../engine/gates/hot-reload/index.js';

import type { GateManager } from '../engine/gates/gate-manager.js';
import type { Logger } from '../infra/logging/index.js';
import type { AuxiliaryReloadConfig } from '../modules/hot-reload/hot-reload-observer.js';

/**
 * Build gate auxiliary reload configuration for HotReloadObserver.
 * Follows the same pattern as buildFrameworkAuxiliaryReloadConfig.
 *
 * @param logger - Logger instance
 * @param gateManager - GateManager instance (optional)
 * @returns AuxiliaryReloadConfig or undefined if gate manager unavailable
 */
export function buildGateAuxiliaryReloadConfig(
  logger: Logger,
  gateManager?: GateManager
): AuxiliaryReloadConfig | undefined {
  if (!gateManager) {
    logger.debug('Gate manager unavailable; skipping gate hot reload wiring.');
    return undefined;
  }

  try {
    const registry = gateManager.getGateRegistry();
    const registration = createGateHotReloadRegistration(logger, registry);

    if (!registration?.directories?.length || !registration.handler) {
      return undefined;
    }

    return {
      id: 'gate',
      directories: registration.directories,
      handler: async (event) => {
        // Extract gate ID from file path and add to event
        const firstFile = event.affectedFiles[0];
        const gateId = firstFile ? extractGateIdFromPath(firstFile) : undefined;
        if (!gateId) {
          logger.warn('Unable to determine gate ID for hot reload event', event);
          return;
        }
        const gateEvent = {
          ...event,
          type: 'gate_changed' as const,
          gateId,
          // Pass through changeType for deletion handling (only if defined)
          ...(event.changeType ? { changeType: event.changeType } : {}),
        };
        await registration.handler(gateEvent);
      },
    };
  } catch (error) {
    logger.warn('Failed to configure gate hot reload; continuing without gate reload:', error);
    return undefined;
  }
}

/**
 * Extract gate ID from a file path.
 *
 * Handles both flat and grouped directory structures:
 *   - Flat:    .../gates/{gateId}/gate.yaml
 *   - Grouped: .../gates/{group}/{gateId}/gate.yaml
 *
 * The gate ID is always the immediate parent directory of the entry file.
 */
function extractGateIdFromPath(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const match = normalizedPath.match(/\/([^/]+)\/(?:gate\.yaml|guidance\.md)$/);
  return match?.[1]?.toLowerCase();
}
