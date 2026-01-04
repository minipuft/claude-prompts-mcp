import { Logger } from '../../logging/index.js';
import type { FrameworkDefinition, FrameworkSelectionCriteria, FrameworkRegistryMetadata } from '../types/methodology-types.js';
export interface FrameworkRegistryOptions {
    defaultFrameworkId?: string;
}
export declare class FrameworkRegistry {
    private readonly logger;
    private readonly frameworks;
    private readonly enabledFrameworks;
    private readonly frameworkMetadata;
    private defaultFrameworkId;
    constructor(logger: Logger, options?: FrameworkRegistryOptions);
    loadDefinitions(definitions: FrameworkDefinition[]): void;
    registerDefinition(definition: FrameworkDefinition, metadata?: Partial<FrameworkRegistryMetadata>): void;
    getFramework(id: string): FrameworkDefinition | undefined;
    listFrameworks(enabledOnly?: boolean): FrameworkDefinition[];
    isFrameworkEnabled(id: string): boolean;
    validateFrameworkId(id: string): boolean;
    /**
     * Check if a framework exists in the registry (alias for validateFrameworkId)
     * @param id - Framework ID (case-insensitive)
     * @returns true if framework exists, false otherwise
     */
    hasFramework(id: string): boolean;
    /**
     * Unregister a framework definition from the registry
     *
     * @param id - Framework ID to unregister (case-insensitive)
     * @returns true if the framework was found and removed
     */
    unregisterDefinition(id: string): boolean;
    /**
     * Validate framework identifier and return normalized ID or error details
     * @param id - Framework ID to validate
     * @returns Validation result with normalized ID or error message
     */
    validateIdentifier(id: string): {
        valid: boolean;
        normalizedId?: string;
        error?: string;
        suggestions?: string[];
    };
    /**
     * Get all registered framework IDs (normalized to uppercase)
     * @param enabledOnly - Only return enabled frameworks
     * @returns Array of framework IDs
     */
    getFrameworkIds(enabledOnly?: boolean): string[];
    selectFramework(criteria: FrameworkSelectionCriteria): FrameworkDefinition | undefined;
}
/**
 * Get list of all available framework IDs from the methodology registry.
 * This is the single source of truth for valid framework identifiers.
 *
 * All IDs are normalized to uppercase for case-insensitive matching.
 *
 * @returns Array of valid framework IDs in uppercase (e.g., ['CAGEERF', 'REACT', 'WH', 'SCAMPER'])
 *
 * @example
 * ```typescript
 * const validFrameworks = getAvailableFrameworkIds();
 * const normalizedInput = userInput.toUpperCase();
 * if (!validFrameworks.includes(normalizedInput)) {
 * throw new Error(`Unknown framework. Valid options: ${validFrameworks.join(', ')}`);
 * }
 * ```
 */
export declare function getAvailableFrameworkIds(): string[];
