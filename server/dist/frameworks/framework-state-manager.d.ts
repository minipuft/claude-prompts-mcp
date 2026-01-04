/**
 * Stateful Framework State Manager
 *
 * Manages the active framework methodology state and provides framework switching capabilities.
 * This tracks switching mechanics (timing, success/failure, counts) and framework state.
 * This is separate from execution strategy analysis - it handles WHICH framework methodology
 * to apply (built-in or custom) while semantic analysis handles execution strategies.
 */
import { EventEmitter } from 'events';
import { Logger } from '../logging/index.js';
import { FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria } from './types/index.js';
/**
 * Persisted framework state (saved to file)
 */
export interface PersistedFrameworkState {
    version: string;
    frameworkSystemEnabled: boolean;
    activeFramework: string;
    lastSwitchedAt: string;
    switchReason: string;
}
/**
 * Framework state information
 */
export interface FrameworkState {
    activeFramework: string;
    previousFramework: string | null;
    switchedAt: Date;
    switchReason: string;
    isHealthy: boolean;
    frameworkSystemEnabled: boolean;
    switchingMetrics: {
        switchCount: number;
        averageResponseTime: number;
        errorCount: number;
    };
}
/**
 * Framework switch request
 */
export interface FrameworkSwitchRequest {
    targetFramework: string;
    reason?: string;
    criteria?: FrameworkSelectionCriteria;
}
/**
 * Framework system health information
 */
export interface FrameworkSystemHealth {
    status: 'healthy' | 'degraded' | 'error';
    activeFramework: string;
    frameworkSystemEnabled: boolean;
    availableFrameworks: string[];
    lastSwitchTime: Date | null;
    switchingMetrics: {
        totalSwitches: number;
        successfulSwitches: number;
        failedSwitches: number;
        averageResponseTime: number;
    };
    issues: string[];
}
/**
 * Stateful Framework State Manager Events
 */
export interface FrameworkStateManagerEvents {
    'framework-switched': (previousFramework: string, newFramework: string, reason: string) => void;
    'framework-error': (framework: string, error: Error) => void;
    'health-changed': (health: FrameworkSystemHealth) => void;
    'framework-system-toggled': (enabled: boolean, reason: string) => void;
}
/**
 * Stateful Framework State Manager
 *
 * Maintains framework state across operations and provides switching capabilities
 */
export declare class FrameworkStateManager extends EventEmitter {
    private logger;
    private frameworkManager;
    private currentState;
    private switchHistory;
    private switchingMetrics;
    private isInitialized;
    private runtimeStatePath;
    constructor(logger: Logger, serverRoot?: string);
    /**
     * Initialize the framework state manager
     */
    initialize(): Promise<void>;
    /**
     * Get current framework state
     */
    getCurrentState(): FrameworkState;
    /**
     * Load persisted state from file
     */
    private loadPersistedState;
    /**
     * Save current state to file.
     * Throws on failure so callers can handle persistence errors appropriately.
     */
    private saveStateToFile;
    /**
     * Validate persisted state structure
     * Note: activeFramework can be any string (supports custom framework types)
     */
    private isValidPersistedState;
    /**
     * Get active framework definition
     */
    getActiveFramework(): FrameworkDefinition;
    /**
     * Get all available frameworks
     */
    getAvailableFrameworks(): FrameworkDefinition[];
    /**
     * Switch to a different framework (persistence layer only).
     * Validation is handled by FrameworkManager - this method trusts the input.
     *
     * @param request - Framework switch request (already validated by FrameworkManager)
     * @returns true on success, throws on persistence failure
     */
    switchFramework(request: FrameworkSwitchRequest): Promise<boolean>;
    /**
     * Generate execution context using active framework
     */
    generateExecutionContext(prompt: any, criteria?: FrameworkSelectionCriteria): FrameworkExecutionContext | null;
    /**
     * Get framework system health
     */
    getSystemHealth(): FrameworkSystemHealth;
    /**
     * Get framework switch history
     */
    getSwitchHistory(limit?: number): Array<{
        from: string;
        to: string;
        timestamp: Date;
        reason: string;
    }>;
    /**
     * Reset switching performance metrics
     */
    resetMetrics(): void;
    /**
     * Enable the framework system
     */
    enableFrameworkSystem(reason?: string): Promise<void>;
    /**
     * Disable the framework system
     */
    disableFrameworkSystem(reason?: string): Promise<void>;
    /**
     * Check if framework system is enabled
     */
    isFrameworkSystemEnabled(): boolean;
    /**
     * Set framework system enabled state (for config loading)
     */
    setFrameworkSystemEnabled(enabled: boolean, reason?: string): Promise<void>;
    private ensureInitialized;
    private updateSwitchingMetrics;
    /**
     * Shutdown the framework state manager and cleanup resources
     * Prevents async handle leaks by persisting state and removing event listeners
     */
    shutdown(): Promise<void>;
}
/**
 * Create and initialize framework state manager
 */
export declare function createFrameworkStateManager(logger: Logger, serverRoot?: string): Promise<FrameworkStateManager>;
