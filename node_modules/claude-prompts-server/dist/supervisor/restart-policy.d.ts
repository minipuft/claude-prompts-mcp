/**
 * Restart Policy Manager
 * Manages restart logic, exponential backoff, and crash loop detection
 */
import { Logger } from '../logging/index.js';
import { RestartPolicy, RestartStats } from './types.js';
/**
 * RestartPolicyManager class
 * Implements restart policies with exponential backoff and crash loop detection
 */
export declare class RestartPolicyManager {
    private logger;
    private config;
    private restartCount;
    private cleanRestarts;
    private crashes;
    private consecutiveCrashes;
    private lastRestartTime;
    private crashHistory;
    private restartLatencies;
    constructor(logger: Logger, config: RestartPolicy);
    /**
     * Check if child should be restarted based on policy
     */
    shouldRestart(exitCode: number): boolean;
    /**
     * Record a restart attempt
     */
    recordRestart(wasClean: boolean, latency?: number): void;
    /**
     * Get current restart delay with exponential backoff applied
     */
    getRestartDelay(): number;
    /**
     * Detect if child is in a crash loop
     * Crash loop = more than 3 crashes in 60 seconds
     */
    isCrashLooping(): boolean;
    /**
     * Get current restart count
     */
    getCount(): number;
    /**
     * Get restart statistics
     */
    getStats(): RestartStats;
    /**
     * Reset restart statistics
     */
    reset(): void;
    /**
     * Update restart policy configuration
     */
    updateConfig(newConfig: Partial<RestartPolicy>): void;
    /**
     * Get current configuration
     */
    getConfig(): RestartPolicy;
}
/**
 * Factory function to create a restart policy manager
 */
export declare function createRestartPolicyManager(logger: Logger, config: RestartPolicy): RestartPolicyManager;
