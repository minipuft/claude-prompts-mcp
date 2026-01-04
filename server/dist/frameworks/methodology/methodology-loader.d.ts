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
export type { MethodologyDefinition, MethodologyGateDefinition, TemplateSuggestionDefinition, MethodologyElementsDefinition, ArgumentSuggestionDefinition, } from './methodology-definition-types.js';
import type { MethodologyDefinition } from './methodology-definition-types.js';
/**
 * Loads a single methodology definition by ID
 *
 * Delegates to RuntimeMethodologyLoader.loadMethodology()
 *
 * @param methodologyId - The methodology ID (e.g., 'cageerf', 'react', '5w1h', 'scamper')
 * @returns The methodology definition or undefined if not found
 * @deprecated Use RuntimeMethodologyLoader.loadMethodology() directly
 */
export declare function loadMethodology(methodologyId: string): MethodologyDefinition | undefined;
/**
 * Lists all available methodology IDs
 *
 * Delegates to RuntimeMethodologyLoader.discoverMethodologies()
 *
 * @returns Array of methodology IDs
 * @deprecated Use RuntimeMethodologyLoader.discoverMethodologies() directly
 */
export declare function listMethodologies(): string[];
/**
 * Loads all available methodology definitions
 *
 * Delegates to RuntimeMethodologyLoader.loadAllMethodologies()
 *
 * @returns Map of methodology ID to definition
 * @deprecated Use RuntimeMethodologyLoader.loadAllMethodologies() directly
 */
export declare function loadAllMethodologies(): Map<string, MethodologyDefinition>;
/**
 * Clears the methodology cache
 *
 * Delegates to RuntimeMethodologyLoader.clearCache()
 * Useful for testing or hot-reload scenarios
 *
 * @deprecated Use RuntimeMethodologyLoader.clearCache() directly
 */
export declare function clearMethodologyCache(): void;
/**
 * Checks if a methodology exists
 *
 * Delegates to RuntimeMethodologyLoader.methodologyExists()
 *
 * @param methodologyId - The methodology ID to check
 * @returns True if the methodology exists
 * @deprecated Use RuntimeMethodologyLoader.methodologyExists() directly
 */
export declare function methodologyExists(methodologyId: string): boolean;
