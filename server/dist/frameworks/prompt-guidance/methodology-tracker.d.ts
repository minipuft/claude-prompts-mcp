/**
 * Methodology Tracker
 *
 * Tracks active methodology state and handles framework switching.
 * Consolidated from framework-state-manager for better separation of concerns.
 */
import { EventEmitter } from 'events';
import { Logger } from '../../logging/index.js';
import { MethodologyHealth, MethodologyState, MethodologySwitchRequest, PersistedMethodologyState } from '../types/index.js';
/**
 * Methodology tracking configuration
 */
export interface MethodologyTrackerConfig {
    /** Server root directory for resolving relative paths */
    serverRoot: string;
    persistStateToDisk: boolean;
    stateFilePath: string;
    enableHealthMonitoring: boolean;
    healthCheckIntervalMs: number;
    maxSwitchHistory: number;
    enableMetrics: boolean;
}
/**
 * Methodology Tracker Events
 */
export interface MethodologyTrackerEvents {
    'methodology-switched': (previous: string, current: string, reason: string) => void;
    'methodology-error': (methodology: string, error: Error) => void;
    'health-changed': (health: MethodologyHealth) => void;
    'state-persisted': (state: PersistedMethodologyState) => void;
}
/**
 * Methodology Tracker
 *
 * Maintains methodology state across operations, handles switching,
 * and provides health monitoring for the methodology system.
 */
export declare class MethodologyTracker extends EventEmitter {
    private logger;
    private config;
    private currentState;
    private readonly rootPath;
    private switchHistory;
    private healthCheckTimer;
    private switchingMetrics;
    constructor(logger: Logger, config?: Partial<MethodologyTrackerConfig>);
    /**
     * Initialize methodology tracker with state restoration
     */
    initialize(): Promise<void>;
    /**
     * Switch to a different methodology
     * Consolidated from framework-state-manager.switchFramework()
     */
    switchMethodology(request: MethodologySwitchRequest): Promise<boolean>;
    /**
     * Get current methodology state
     */
    getCurrentState(): MethodologyState;
    /**
     * Get methodology system health
     */
    getSystemHealth(): MethodologyHealth;
    /**
     * Enable or disable the methodology system
     */
    setMethodologySystemEnabled(enabled: boolean, reason?: string): Promise<void>;
    /**
     * Get switch history
     */
    getSwitchHistory(): Array<{
        from: string;
        to: string;
        timestamp: Date;
        reason: string;
        success: boolean;
    }>;
    /**
     * Clear switch history
     */
    clearSwitchHistory(): void;
    /**
     * Shutdown methodology tracker
     */
    shutdown(): Promise<void>;
    /**
     * Validate switch request
     */
    private validateSwitchRequest;
    /**
     * Add switch record to history
     */
    private addToSwitchHistory;
    /**
     * Update switching metrics
     */
    private updateSwitchingMetrics;
    /**
     * Start health monitoring
     */
    private startHealthMonitoring;
    /**
     * Perform health check
     */
    private performHealthCheck;
    /**
     * Detect health issues
     */
    private detectHealthIssues;
    /**
     * Persist state to disk
     */
    private persistState;
    /**
     * Restore state from disk
     */
    private restoreState;
    private readPersistedState;
    /**
     * Update tracker configuration
     */
    updateConfig(config: Partial<MethodologyTrackerConfig>): void;
    /**
     * Get current tracker configuration
     */
    getConfig(): MethodologyTrackerConfig;
}
/**
 * Create and initialize a MethodologyTracker instance
 */
export declare function createMethodologyTracker(logger: Logger, config?: Partial<MethodologyTrackerConfig>): Promise<MethodologyTracker>;
