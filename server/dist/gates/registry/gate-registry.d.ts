/**
 * Gate Registry
 *
 * Centralized registry for loading and managing gate guides.
 * Mirrors the MethodologyRegistry pattern from the framework system.
 *
 * Features:
 * - YAML-based loading via GateDefinitionLoader
 * - Per-gate enable/disable
 * - Registration metadata tracking
 * - Statistics and introspection
 *
 * @see MethodologyRegistry for the pattern this follows
 */
import { Logger } from '../../logging/index.js';
import { GateDefinitionLoader, type GateDefinitionLoaderConfig } from '../core/gate-definition-loader.js';
import type { IGateGuide, GateSource, GateGuideEntry, GateRegistryStats } from '../types/index.js';
/**
 * Gate registry configuration
 */
export interface GateRegistryConfig {
    /** Whether to auto-load built-in gates on initialization */
    autoLoadBuiltIn: boolean;
    /** Custom gate guides to load */
    customGuides?: IGateGuide[];
    /** Whether to validate guides on registration */
    validateOnRegistration: boolean;
    /** Configuration for the gate definition loader */
    loaderConfig?: Partial<GateDefinitionLoaderConfig>;
}
/**
 * Gate Registry
 *
 * Manages the loading, registration, and lifecycle of gate guides.
 * Provides a clean separation between guide management and gate orchestration.
 *
 * @example
 * ```typescript
 * const registry = new GateRegistry(logger);
 * await registry.initialize();
 *
 * const guide = registry.getGuide('code-quality');
 * if (guide?.isActive({ promptCategory: 'code' })) {
 *   console.log(guide.getGuidance());
 * }
 * ```
 */
export declare class GateRegistry {
    private guides;
    private logger;
    private config;
    private initialized;
    private loader;
    constructor(logger: Logger, config?: Partial<GateRegistryConfig>);
    /**
     * Initialize the gate registry
     */
    initialize(): Promise<void>;
    /**
     * Register a gate guide
     *
     * @param guide - The gate guide to register
     * @param isBuiltIn - Whether this is a built-in gate
     * @param source - How this guide was loaded
     * @returns true if registration succeeded
     */
    registerGuide(guide: IGateGuide, isBuiltIn?: boolean, source?: GateSource): Promise<boolean>;
    /**
     * Get a gate guide by ID
     *
     * @param gateId - The gate ID (case-insensitive)
     * @returns The guide or undefined if not found/disabled
     */
    getGuide(gateId: string): IGateGuide | undefined;
    /**
     * Get all registered guides
     *
     * @param enabledOnly - If true, only return enabled guides
     * @returns Array of gate guides
     */
    getAllGuides(enabledOnly?: boolean): IGateGuide[];
    /**
     * Get guide entries with metadata
     *
     * @param enabledOnly - If true, only return enabled guides
     * @returns Array of guide entries
     */
    getGuideEntries(enabledOnly?: boolean): GateGuideEntry[];
    /**
     * Check if a guide exists
     *
     * @param gateId - The gate ID to check
     * @returns true if the guide exists (regardless of enabled state)
     */
    hasGuide(gateId: string): boolean;
    /**
     * Enable or disable a guide
     *
     * @param gateId - The gate ID
     * @param enabled - Whether to enable or disable
     * @returns true if the operation succeeded
     */
    setGuideEnabled(gateId: string, enabled: boolean): boolean;
    /**
     * Unregister a guide from the registry
     *
     * @param gateId - The gate ID to unregister
     * @returns true if the guide was found and removed
     */
    unregisterGuide(gateId: string): boolean;
    /**
     * Get registry statistics
     */
    getRegistryStats(): GateRegistryStats;
    /**
     * Get the underlying definition loader
     */
    getLoader(): GateDefinitionLoader;
    /**
     * Reload a specific gate
     *
     * @param gateId - The gate ID to reload
     * @returns true if reload succeeded
     */
    reloadGuide(gateId: string): Promise<boolean>;
    /**
     * Load built-in gates from YAML files
     */
    private loadBuiltInGuides;
    /**
     * Load custom guides provided in config
     */
    private loadCustomGuides;
    /**
     * Validate a gate guide
     */
    private validateGuide;
}
/**
 * Create a gate registry with default configuration
 */
export declare function createGateRegistry(logger: Logger, config?: Partial<GateRegistryConfig>): Promise<GateRegistry>;
