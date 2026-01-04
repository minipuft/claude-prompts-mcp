/**
 * Gate Loader - Adapter over GateDefinitionLoader (YAML + guidance.md)
 *
 * Uses GateDefinitionLoader for path resolution, validation, and guidance inlining.
 */
import { type GateDefinitionLoaderConfig } from './gate-definition-loader.js';
import { Logger } from '../../logging/index.js';
import type { LightweightGateDefinition, GateActivationResult } from '../types.js';
import type { TemporaryGateRegistry } from './temporary-gate-registry.js';
/**
 * Minimal provider contract for loading gate definitions.
 * Implemented by GateLoader (YAML-based) and can be implemented by registry adapters.
 */
export interface GateDefinitionProvider {
    loadGate(gateId: string): Promise<LightweightGateDefinition | null>;
    loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]>;
    getActiveGates(gateIds: string[], context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): Promise<GateActivationResult>;
    listAvailableGates(): Promise<string[]>;
    listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]>;
    clearCache(gateId?: string): void;
    isGateActive(gate: LightweightGateDefinition, context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): boolean;
    getStatistics(): {
        cachedGates: number;
        totalLoads: number;
        lastAccess: Date | null;
    };
    isMethodologyGate(gateId: string): Promise<boolean>;
    isMethodologyGateCached(gateId: string): boolean;
    getMethodologyGateIds(): Promise<string[]>;
}
/**
 * Gate loader with caching and hot-reload support
 */
export declare class GateLoader implements GateDefinitionProvider {
    private gateCache;
    private lastModified;
    private logger;
    private gatesDirectory;
    private definitionLoader;
    private temporaryGateRegistry;
    constructor(logger: Logger, gatesDirectory?: string, temporaryGateRegistry?: TemporaryGateRegistry, loaderConfig?: Partial<GateDefinitionLoaderConfig>);
    setTemporaryGateRegistry(temporaryGateRegistry?: TemporaryGateRegistry): void;
    /**
     * Load a gate definition by ID with caching
     */
    loadGate(gateId: string): Promise<LightweightGateDefinition | null>;
    /**
     * Load multiple gates by IDs
     */
    loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]>;
    /**
     * Get active gates based on context and criteria
     */
    getActiveGates(gateIds: string[], context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): Promise<GateActivationResult>;
    /**
     * List all available gate IDs
     */
    listAvailableGates(): Promise<string[]>;
    /**
     * List all available gate definitions (full objects)
     * Used by JudgeSelectionStage to build resource menu for LLM selection.
     */
    listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]>;
    /**
     * Clear gate cache (for hot-reloading)
     */
    clearCache(gateId?: string): void;
    /**
     * Check if a gate should be activated based on context
     */
    /**
     * Determine if a gate should be active for the provided context.
     * Exposed so other systems (e.g., guidance rendering) can reuse the
     * canonical activation logic instead of duplicating it.
     */
    isGateActive(gate: LightweightGateDefinition, context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): boolean;
    /**
     * Get gate statistics
     */
    getStatistics(): {
        cachedGates: number;
        totalLoads: number;
        lastAccess: Date | null;
    };
    /**
     * Check if a gate is a methodology/framework gate by loading and inspecting its definition.
     * Framework gates have gate_type === 'framework' and are filtered when methodology gates are disabled.
     *
     * @param gateId - Gate identifier to check
     * @returns true if gate has gate_type === 'framework', false otherwise
     */
    isMethodologyGate(gateId: string): Promise<boolean>;
    /**
     * Check if a gate ID is a methodology gate using cached data only (synchronous).
     * Returns false if gate is not in cache - use isMethodologyGate for definitive check.
     *
     * @param gateId - Gate identifier to check
     * @returns true if cached gate has gate_type === 'framework', false otherwise
     */
    isMethodologyGateCached(gateId: string): boolean;
    /**
     * Get all methodology gate IDs from loaded definitions.
     * Scans the definitions directory and returns IDs of gates with gate_type === 'framework'.
     *
     * @returns Array of methodology gate IDs
     */
    getMethodologyGateIds(): Promise<string[]>;
    /**
     * Convert GateDefinitionYaml to LightweightGateDefinition shape expected by legacy consumers.
     */
    private toLightweightGate;
    private normalizeRetryConfig;
}
/**
 * Create a gate loader instance
 */
export declare function createGateLoader(logger: Logger, gatesDirectory?: string, temporaryGateRegistry?: TemporaryGateRegistry): GateLoader;
