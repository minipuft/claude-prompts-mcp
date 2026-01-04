// @lifecycle canonical - Builds style hot-reload config for prompt hot-reload manager.
import { createStyleHotReloadRegistration } from '../styles/hot-reload/index.js';
/**
 * Build style auxiliary reload configuration for HotReloadManager.
 * Follows the same pattern as buildGateAuxiliaryReloadConfig.
 *
 * @param logger - Logger instance
 * @param styleManager - StyleManager instance (optional)
 * @returns AuxiliaryReloadConfig or undefined if style manager unavailable
 */
export function buildStyleAuxiliaryReloadConfig(logger, styleManager) {
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
                    type: 'style_changed',
                    styleId,
                    // Pass through changeType for deletion handling (only if defined)
                    ...(event.changeType ? { changeType: event.changeType } : {}),
                };
                await registration.handler(styleEvent);
            },
        };
    }
    catch (error) {
        logger.warn('Failed to configure style hot reload; continuing without style reload:', error);
        return undefined;
    }
}
/**
 * Extract style ID from a file path.
 * Expected path pattern: .../styles/{styleId}/style.yaml or .../styles/{styleId}/guidance.md
 */
function extractStyleIdFromPath(filePath) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/styles\/([^/]+)\//);
    return match?.[1]?.toLowerCase();
}
//# sourceMappingURL=style-hot-reload.js.map