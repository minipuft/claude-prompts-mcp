/**
 * Core Gate System - Main Exports
 * Provides guidance and validation capabilities for prompt execution
 *
 * New registry-based architecture exports:
 * - GateDefinitionLoader: YAML + MD loading with caching
 * - Gate schema validation utilities
 */
import { GateSystemManager } from '../gate-state-manager.js';
import { GateValidator } from './gate-validator.js';
import { TemporaryGateRegistry, type TemporaryGateDefinition } from './temporary-gate-registry.js';
import type { GateDefinitionProvider } from './gate-loader.js';
import type { ValidationResult } from '../../execution/types.js';
export { GateLoader, createGateLoader, type GateDefinitionProvider } from './gate-loader.js';
export { GateValidator, createGateValidator } from './gate-validator.js';
export { TemporaryGateRegistry, createTemporaryGateRegistry, type TemporaryGateDefinition as TemporaryGateRegistryDefinition, } from './temporary-gate-registry.js';
export { GateDefinitionLoader, createGateDefinitionLoader, getDefaultGateDefinitionLoader, resetDefaultGateDefinitionLoader, type GateDefinitionLoaderConfig, type GateLoaderStats as GateDefinitionLoaderStats, type GateSchemaValidationResult, } from './gate-definition-loader.js';
export { GateDefinitionSchema, GatePassCriteriaSchema, GateActivationSchema, GateRetryConfigSchema, validateGateSchema, isValidGateDefinition, type GateDefinitionYaml as GateDefinitionYamlSchema, type GatePassCriteriaYaml, type GateActivationYaml, type GateRetryConfigYaml, } from './gate-schema.js';
export type { ValidationResult } from '../../execution/types.js';
export type { GateActivationResult, GatePassCriteria, LightweightGateDefinition, ValidationCheck, ValidationContext, } from '../types.js';
export type { GateValidationStatistics } from './gate-validator.js';
/**
 * Core gate system manager with temporary gate support
 */
export declare class LightweightGateSystem {
    gateLoader: GateDefinitionProvider;
    gateValidator: GateValidator;
    private gateSystemManager;
    private temporaryGateRegistry;
    constructor(gateLoader: GateDefinitionProvider, gateValidator: GateValidator, temporaryGateRegistry?: TemporaryGateRegistry);
    /**
     * Set gate system manager for runtime state checking
     */
    setGateSystemManager(gateSystemManager: GateSystemManager): void;
    /**
     * Set temporary gate registry
     */
    setTemporaryGateRegistry(temporaryGateRegistry: TemporaryGateRegistry): void;
    /**
     * Create a temporary gate
     */
    createTemporaryGate(definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'>, scopeId?: string): string | null;
    /**
     * Get temporary gates for scope
     */
    getTemporaryGatesForScope(scope: string, scopeId: string): TemporaryGateDefinition[];
    /**
     * Clean up temporary gates for scope
     */
    cleanupTemporaryGates(scope: string, scopeId?: string): number;
    /**
     * Check if gate system is enabled
     */
    private isGateSystemEnabled;
    /**
     * Get guidance text for active gates
     */
    getGuidanceText(gateIds: string[], context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): Promise<string[]>;
    /**
     * Validate content against active gates
     */
    validateContent(gateIds: string[], content: string, validationContext: {
        promptId?: string;
        stepId?: string;
        attemptNumber?: number;
        previousAttempts?: string[];
        metadata?: Record<string, any>;
    }): Promise<ValidationResult[]>;
    /**
     * Check if content should be retried based on validation results
     */
    shouldRetry(validationResults: ValidationResult[], currentAttempt: number, maxAttempts?: number): boolean;
    /**
     * Get combined retry hints from all failed validations
     */
    getRetryHints(validationResults: ValidationResult[]): string[];
    /**
     * Get system statistics
     */
    getStatistics(): {
        gateLoader: {
            cachedGates: number;
            totalLoads: number;
            lastAccess: Date | null;
        };
        gateValidator: import("./gate-validator.js").GateValidationStatistics;
    };
    /**
     * Get the temporary gate registry instance (enhancement)
     */
    getTemporaryGateRegistry(): TemporaryGateRegistry | undefined;
    /**
     * Cleanup the lightweight gate system and sub-components
     * Prevents async handle leaks by delegating to sub-component cleanup
     */
    cleanup(): Promise<void>;
}
/**
 * Create a complete core gate system with optional temporary gate support
 */
export declare function createLightweightGateSystem(logger: any, gatesDirectory?: string, gateSystemManager?: GateSystemManager, options?: {
    provider?: GateDefinitionProvider;
    enableTemporaryGates?: boolean;
    maxMemoryGates?: number;
    defaultExpirationMs?: number;
    llmConfig?: any;
}): LightweightGateSystem;
