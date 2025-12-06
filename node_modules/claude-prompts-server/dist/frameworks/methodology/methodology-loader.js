// @lifecycle deprecated - Thin wrapper around RuntimeMethodologyLoader for backwards compatibility.
/**
 * Methodology Loader (Legacy Wrapper)
 *
 * Provides backwards-compatible API that delegates to RuntimeMethodologyLoader.
 * New code should import from RuntimeMethodologyLoader directly.
 *
 * This module exists to maintain API compatibility during migration. All
 * functionality is now handled by RuntimeMethodologyLoader, which loads
 * methodology definitions from YAML source files at runtime.
 *
 * @deprecated Import from RuntimeMethodologyLoader for new code
 */
// Import RuntimeMethodologyLoader for delegation
import { getDefaultRuntimeLoader } from './runtime-methodology-loader.js';
/**
 * Loads a single methodology definition by ID
 *
 * Delegates to RuntimeMethodologyLoader.loadMethodology()
 *
 * @param methodologyId - The methodology ID (e.g., 'cageerf', 'react', '5w1h', 'scamper')
 * @returns The methodology definition or undefined if not found
 * @deprecated Use RuntimeMethodologyLoader.loadMethodology() directly
 */
export function loadMethodology(methodologyId) {
    return getDefaultRuntimeLoader().loadMethodology(methodologyId);
}
/**
 * Lists all available methodology IDs
 *
 * Delegates to RuntimeMethodologyLoader.discoverMethodologies()
 *
 * @returns Array of methodology IDs
 * @deprecated Use RuntimeMethodologyLoader.discoverMethodologies() directly
 */
export function listMethodologies() {
    return getDefaultRuntimeLoader().discoverMethodologies();
}
/**
 * Loads all available methodology definitions
 *
 * Delegates to RuntimeMethodologyLoader.loadAllMethodologies()
 *
 * @returns Map of methodology ID to definition
 * @deprecated Use RuntimeMethodologyLoader.loadAllMethodologies() directly
 */
export function loadAllMethodologies() {
    return getDefaultRuntimeLoader().loadAllMethodologies();
}
/**
 * Clears the methodology cache
 *
 * Delegates to RuntimeMethodologyLoader.clearCache()
 * Useful for testing or hot-reload scenarios
 *
 * @deprecated Use RuntimeMethodologyLoader.clearCache() directly
 */
export function clearMethodologyCache() {
    getDefaultRuntimeLoader().clearCache();
}
/**
 * Checks if a methodology exists
 *
 * Delegates to RuntimeMethodologyLoader.methodologyExists()
 *
 * @param methodologyId - The methodology ID to check
 * @returns True if the methodology exists
 * @deprecated Use RuntimeMethodologyLoader.methodologyExists() directly
 */
export function methodologyExists(methodologyId) {
    return getDefaultRuntimeLoader().methodologyExists(methodologyId);
}
//# sourceMappingURL=methodology-loader.js.map