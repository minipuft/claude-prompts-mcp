/**
 * Methodology Registry
 *
 * Centralized registry for loading and managing methodology guides.
 * Uses YAML-based loading exclusively with fail-fast behavior.
 * All methodologies must be defined in resources/methodologies/<id>/methodology.yaml.
 */
import { RuntimeMethodologyLoader, type RuntimeMethodologyLoaderConfig } from './runtime-methodology-loader.js';
import { Logger } from '../../logging/index.js';
import { IMethodologyGuide } from '../types/index.js';
/**
 * Methodology source type for tracking how a guide was loaded
 * YAML-runtime is the only production source; 'custom' for user-provided guides
 */
export type MethodologySource = 'yaml-runtime' | 'custom';
/**
 * Methodology registry configuration
 */
export interface MethodologyRegistryConfig {
    /** Whether to auto-load built-in methodology guides */
    autoLoadBuiltIn: boolean;
    /** Custom methodology guides to load */
    customGuides?: IMethodologyGuide[];
    /** Whether to validate guides on registration */
    validateOnRegistration: boolean;
    /** Configuration for the runtime YAML loader */
    runtimeLoaderConfig?: Partial<RuntimeMethodologyLoaderConfig>;
}
/**
 * Methodology guide registry entry
 */
export interface MethodologyGuideEntry {
    guide: IMethodologyGuide;
    registeredAt: Date;
    isBuiltIn: boolean;
    enabled: boolean;
    /** How this guide was loaded */
    source: MethodologySource;
    metadata: {
        loadTime: number;
        validationStatus: 'passed' | 'failed' | 'not_validated';
        lastUsed?: Date;
    };
}
/**
 * Methodology Registry
 *
 * Manages the loading, registration, and lifecycle of methodology guides.
 * Provides a clean separation between guide management and framework orchestration.
 */
export declare class MethodologyRegistry {
    private guides;
    private logger;
    private config;
    private initialized;
    private runtimeLoader;
    constructor(logger: Logger, config?: Partial<MethodologyRegistryConfig>);
    /**
     * Initialize the methodology registry
     */
    initialize(): Promise<void>;
    /**
     * Register a methodology guide
     */
    registerGuide(guide: IMethodologyGuide, isBuiltIn?: boolean, source?: MethodologySource): Promise<boolean>;
    /**
     * Get a methodology guide by ID
     */
    getGuide(guideId: string): IMethodologyGuide | undefined;
    /**
     * Get all registered methodology guides
     */
    getAllGuides(enabledOnly?: boolean): IMethodologyGuide[];
    /**
     * Get guide entries with metadata
     */
    getGuideEntries(enabledOnly?: boolean): MethodologyGuideEntry[];
    /**
     * Check if a guide is registered
     */
    hasGuide(guideId: string): boolean;
    /**
     * Enable or disable a methodology guide
     */
    setGuideEnabled(guideId: string, enabled: boolean): boolean;
    /**
     * Unregister a methodology guide from the registry
     *
     * @param guideId - The guide ID to unregister
     * @returns true if the guide was found and removed
     */
    unregisterGuide(guideId: string): boolean;
    /**
     * Get registry statistics
     */
    getRegistryStats(): {
        totalGuides: number;
        enabledGuides: number;
        builtInGuides: number;
        customGuides: number;
        sourceDistribution: Record<MethodologySource, number>;
        averageLoadTime: number;
        initialized: boolean;
        runtimeLoaderStats: import("./runtime-methodology-loader.js").LoaderStats | null;
    };
    /**
     * Load and register a methodology by ID from disk
     *
     * Used for hot-reload when a new methodology is created via MCP tools.
     * Loads the YAML definition and creates a guide, then registers it.
     *
     * @param id - Methodology ID to load
     * @returns true if successfully loaded and registered
     */
    loadAndRegisterById(id: string): Promise<boolean>;
    /**
     * Load built-in methodology guides
     *
     * YAML loading is mandatory with fail-fast behavior.
     * All methodologies must be defined in resources/methodologies/<id>/methodology.yaml.
     */
    private loadBuiltInGuides;
    /**
     * Load custom methodology guides
     */
    private loadCustomGuides;
    /**
     * Validate a methodology guide
     */
    private validateGuide;
    /**
     * Ensure registry is initialized
     */
    private ensureInitialized;
    /**
     * Get initialization status
     */
    get isInitialized(): boolean;
    /**
     * Expose the runtime loader so other components (e.g., hot reload) can reuse
     * the same cache and directory resolution.
     */
    getRuntimeLoader(): RuntimeMethodologyLoader;
}
/**
 * Create and initialize a MethodologyRegistry instance
 */
export declare function createMethodologyRegistry(logger: Logger, config?: Partial<MethodologyRegistryConfig>): Promise<MethodologyRegistry>;
