/**
 * Gate System Manager - Runtime State Management
 *
 * Provides runtime enable/disable functionality for the gates system,
 * following the same pattern as FrameworkStateManager for consistency.
 */
import { EventEmitter } from 'events';
import { Logger } from '../logging/index.js';
/**
 * Gate system state interface
 */
export interface GateSystemState {
    enabled: boolean;
    enabledAt: Date;
    enableReason: string;
    isHealthy: boolean;
    validationMetrics: {
        totalValidations: number;
        successfulValidations: number;
        averageValidationTime: number;
        lastValidationTime: Date | null;
    };
}
/**
 * Gate system health status
 */
export interface GateSystemHealth {
    status: 'healthy' | 'degraded' | 'disabled';
    enabled: boolean;
    totalValidations: number;
    successRate: number;
    averageValidationTime: number;
    lastValidationTime: Date | null;
    issues: string[];
}
/**
 * Gate system enable/disable request
 */
export interface GateSystemToggleRequest {
    enabled: boolean;
    reason?: string;
}
/**
 * Gate system events
 */
export interface GateSystemEvents {
    'system-enabled': [reason: string];
    'system-disabled': [reason: string];
    'health-changed': [health: GateSystemHealth];
    'validation-completed': [success: boolean, executionTime: number];
}
/**
 * Gate System Manager - Runtime state management
 */
export declare class GateSystemManager extends EventEmitter {
    private currentState;
    private logger;
    private stateFilePath;
    private healthCheckInterval?;
    constructor(logger: Logger, stateDirectory?: string);
    /**
     * Initialize the gate system manager
     */
    initialize(): Promise<void>;
    /**
     * Load state from persistent storage
     */
    private loadStateFromFile;
    /**
     * Save current state to persistent storage
     */
    private saveStateToFile;
    /**
     * Validate persisted state structure
     */
    private isValidPersistedState;
    /**
     * Check if gate system is enabled
     */
    isGateSystemEnabled(): boolean;
    /**
     * Enable the gate system
     */
    enableGateSystem(reason?: string): Promise<void>;
    /**
     * Disable the gate system
     */
    disableGateSystem(reason?: string): Promise<void>;
    /**
     * Get current system health
     */
    getSystemHealth(): GateSystemHealth;
    /**
     * Record a validation execution for metrics
     */
    recordValidation(success: boolean, executionTime: number): void;
    /**
     * Get current state for inspection
     */
    getCurrentState(): GateSystemState;
    /**
     * Start health monitoring
     */
    private startHealthMonitoring;
    /**
     * Cleanup resources
     */
    cleanup(): Promise<void>;
}
/**
 * Create a gate system manager instance
 */
export declare function createGateSystemManager(logger: Logger, stateDirectory?: string): GateSystemManager;
