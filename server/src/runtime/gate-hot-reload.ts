// @lifecycle canonical - Builds gate hot-reload config for prompt hot-reload manager.
import { createGateHotReloadRegistration } from '../gates/hot-reload/index.js';

import type { GateManager } from '../gates/gate-manager.js';
import type { Logger } from '../logging/index.js';
import type { AuxiliaryReloadConfig } from '../prompts/hot-reload-manager.js';

/**
 * Build gate auxiliary reload configuration for HotReloadManager.
 * Follows the same pattern as buildMethodologyAuxiliaryReloadConfig.
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
 * Expected path pattern: .../gates/{gateId}/gate.yaml or .../gates/{gateId}/guidance.md
 */
function extractGateIdFromPath(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const match = normalizedPath.match(/\/gates\/([^/]+)\//);
  return match?.[1]?.toLowerCase();
}
