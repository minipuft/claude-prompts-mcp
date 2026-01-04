/**
 * Framework Manager
 *
 * Orchestration layer for the framework system.
 * Extends BaseResourceManager to provide unified resource management patterns.
 *
 * Coordinates between:
 * - MethodologyRegistry: Manages methodology guides (source of truth)
 * - FrameworkDefinitions: Generated from methodology guides
 * - FrameworkStateManager: Runtime enable/disable state
 */
import { BaseResourceManager } from '../core/resource-manager/index.js';
import { Logger } from '../logging/index.js';
import { ConvertedPrompt } from '../types/index.js';
import { MethodologyRegistry } from './methodology/index.js';
import { FrameworkDefinition, FrameworkExecutionContext, FrameworkMethodology, FrameworkSelectionCriteria, IMethodologyGuide } from './types/index.js';
/**
 * Framework switch request (matches FrameworkStateManager interface)
 */
interface FrameworkSwitchRequest {
    targetFramework: string;
    reason?: string;
}
/**
 * Framework state accessor interface
 */
interface FrameworkStateAccessor {
    isFrameworkSystemEnabled(): boolean;
    getActiveFramework(): {
        id: string;
        type: string;
        methodology: string;
    } | null | undefined;
    switchFramework(request: FrameworkSwitchRequest): Promise<boolean>;
}
/**
 * Configuration for FrameworkManager
 */
export interface FrameworkManagerConfig {
    /** Default framework to use when none specified */
    defaultFramework?: string;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Statistics for FrameworkManager
 */
export interface FrameworkManagerStats {
    /** Total number of registered frameworks */
    totalFrameworks: number;
    /** Number of enabled frameworks */
    enabledFrameworks: number;
    /** Total methodology guides loaded */
    totalMethodologies: number;
    /** Currently active framework */
    activeFramework: string | null;
}
/**
 * Registry entry for frameworks (minimal wrapper since we use direct Map)
 */
export interface FrameworkEntry {
    framework: FrameworkDefinition;
    enabled: boolean;
    registeredAt: Date;
    source: 'methodology' | 'custom';
}
/**
 * Framework Manager
 *
 * Provides methodology selection and system prompt generation.
 * Generates FrameworkDefinitions from MethodologyGuides.
 *
 * @example
 * ```typescript
 * const manager = await createFrameworkManager(logger);
 *
 * // Select framework based on criteria
 * const framework = manager.selectFramework({ userPreference: 'CAGEERF' });
 *
 * // Generate execution context
 * const context = manager.generateExecutionContext(prompt);
 * ```
 */
export declare class FrameworkManager extends BaseResourceManager<FrameworkDefinition, FrameworkEntry, FrameworkManagerConfig, FrameworkManagerStats> {
    private frameworks;
    private methodologyRegistry;
    private defaultFramework;
    private frameworkStateManager?;
    constructor(logger: Logger, config?: FrameworkManagerConfig);
    protected get managerName(): string;
    protected initializeRegistry(): Promise<void>;
    protected postRegistryInit(): Promise<void>;
    protected applyDefaultConfig(config: FrameworkManagerConfig): FrameworkManagerConfig;
    protected getResource(id: string): FrameworkDefinition | undefined;
    protected hasResource(id: string): boolean;
    protected listResources(enabledOnly: boolean): FrameworkDefinition[];
    protected getResourceEntries(enabledOnly: boolean): FrameworkEntry[];
    protected setResourceEnabled(id: string, enabled: boolean): boolean;
    protected reloadResource(id: string): Promise<boolean>;
    protected unregisterResource(id: string): boolean;
    protected clearResourceCache(_id?: string): void;
    protected getResourceStats(): FrameworkManagerStats;
    protected isSystemEnabled(): boolean;
    /**
     * Set the framework state manager for synchronization
     */
    setFrameworkStateManager(frameworkStateManager: FrameworkStateAccessor): void;
    /**
     * Switch to a new framework. Single authority for framework switching.
     * Handles normalization, validation, and delegates persistence to FrameworkStateManager.
     *
     * @param frameworkId - Framework identifier (case-insensitive)
     * @param reason - Optional reason for the switch
     * @returns Result object with success status, framework definition, or error message
     */
    switchFramework(frameworkId: string, reason?: string): Promise<{
        success: boolean;
        framework?: FrameworkDefinition;
        error?: string;
    }>;
    /**
     * Select appropriate framework based on criteria
     */
    selectFramework(criteria?: FrameworkSelectionCriteria): FrameworkDefinition;
    /**
     * Generate execution context with system prompts and guidelines
     */
    generateExecutionContext(prompt: ConvertedPrompt, criteria?: FrameworkSelectionCriteria): FrameworkExecutionContext;
    /**
     * Get framework by methodology type (case-insensitive)
     */
    getFramework(methodology: string): FrameworkDefinition | undefined;
    /**
     * List available frameworks
     */
    listFrameworks(enabledOnly?: boolean): FrameworkDefinition[];
    /**
     * Check if a framework exists and is enabled
     *
     * @param id - Framework identifier (case-insensitive)
     * @returns true if framework exists and is enabled
     */
    isFrameworkEnabled(id: string): boolean;
    /**
     * Get list of framework IDs
     *
     * @param enabledOnly - Only return enabled frameworks (default: false)
     * @returns Array of framework IDs in uppercase
     */
    getFrameworkIds(enabledOnly?: boolean): string[];
    /**
     * Validate framework identifier and return normalized ID or error details
     *
     * @param id - Framework identifier to validate
     * @returns Validation result with normalized ID or error message
     */
    validateIdentifier(id: string): {
        valid: boolean;
        normalizedId?: string;
        error?: string;
        suggestions?: string[];
    };
    /**
     * Get methodology guide by framework ID
     */
    getMethodologyGuide(frameworkId: string): IMethodologyGuide | undefined;
    /**
     * List available methodology guides
     */
    listMethodologyGuides(): IMethodologyGuide[];
    /**
     * Expose the methodology registry for integrations
     */
    getMethodologyRegistry(): MethodologyRegistry;
    /**
     * Set default framework
     */
    setDefaultFramework(methodology: FrameworkMethodology): void;
    /**
     * Register a new framework by loading from disk
     */
    registerFramework(frameworkId: string): Promise<boolean>;
    /**
     * Get framework by ID (all keys are stored lowercase)
     */
    private getFrameworkById;
    /**
     * Generate framework definitions from methodology guides
     */
    private generateFrameworkDefinitions;
    /**
     * Generate a single framework definition from a methodology guide
     */
    private generateSingleFrameworkDefinition;
    /**
     * Generate system prompt template wrapper
     */
    private generateSystemPromptTemplate;
    /**
     * Get framework description
     */
    private getFrameworkDescription;
    /**
     * Get execution guidelines from methodology guide
     */
    private getExecutionGuidelines;
    /**
     * Get applicable types for framework
     */
    private getApplicableTypes;
    /**
     * Get framework priority
     */
    private getFrameworkPriority;
    /**
     * Generate framework-specific system prompt
     */
    private generateSystemPrompt;
    /**
     * Get selection reason for context metadata
     */
    private getSelectionReason;
}
/**
 * Create and initialize a FrameworkManager instance
 */
export declare function createFrameworkManager(logger: Logger, config?: FrameworkManagerConfig): Promise<FrameworkManager>;
export type { FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria };
