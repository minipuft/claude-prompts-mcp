/**
 * Restart Policy Manager
 * Manages restart logic, exponential backoff, and crash loop detection
 */
/**
 * RestartPolicyManager class
 * Implements restart policies with exponential backoff and crash loop detection
 */
export class RestartPolicyManager {
    constructor(logger, config) {
        // Restart tracking
        this.restartCount = 0;
        this.cleanRestarts = 0;
        this.crashes = 0;
        this.consecutiveCrashes = 0;
        this.lastRestartTime = 0;
        // Crash history for crash loop detection
        this.crashHistory = [];
        // Restart latency tracking
        this.restartLatencies = [];
        this.logger = logger;
        this.config = config;
    }
    /**
     * Check if child should be restarted based on policy
     */
    shouldRestart(exitCode) {
        // Check max restarts limit
        if (this.restartCount >= this.config.maxRestarts) {
            this.logger.error(`Max restart limit (${this.config.maxRestarts}) exceeded - will not restart`);
            return false;
        }
        // Check crash loop detection
        if (this.isCrashLooping()) {
            this.logger.error('Crash loop detected - child keeps crashing immediately after restart');
            return false;
        }
        // Check restart delay (with exponential backoff)
        const requiredDelay = this.getRestartDelay();
        const timeSinceLastRestart = Date.now() - this.lastRestartTime;
        if (this.lastRestartTime > 0 && timeSinceLastRestart < requiredDelay) {
            this.logger.debug(`Restart too soon - waiting ${requiredDelay - timeSinceLastRestart}ms`);
            return false;
        }
        return true;
    }
    /**
     * Record a restart attempt
     */
    recordRestart(wasClean, latency) {
        this.restartCount++;
        this.lastRestartTime = Date.now();
        if (wasClean) {
            this.cleanRestarts++;
            this.consecutiveCrashes = 0; // Reset consecutive crashes on clean restart
        }
        else {
            this.crashes++;
            this.consecutiveCrashes++;
            this.crashHistory.push(Date.now());
            // Keep only recent crashes (last 2 minutes)
            const twoMinutesAgo = Date.now() - 120000;
            this.crashHistory = this.crashHistory.filter(time => time > twoMinutesAgo);
        }
        if (latency !== undefined) {
            this.restartLatencies.push(latency);
            // Keep only last 10 latencies for average calculation
            if (this.restartLatencies.length > 10) {
                this.restartLatencies.shift();
            }
        }
        this.logger.info(`Restart recorded - Total: ${this.restartCount}, Clean: ${this.cleanRestarts}, Crashes: ${this.crashes}, Consecutive crashes: ${this.consecutiveCrashes}`);
    }
    /**
     * Get current restart delay with exponential backoff applied
     */
    getRestartDelay() {
        const baseDelay = this.config.restartDelay;
        const multiplier = Math.pow(this.config.backoffMultiplier, this.consecutiveCrashes);
        const delay = Math.min(baseDelay * multiplier, 60000); // Cap at 60 seconds
        return Math.floor(delay);
    }
    /**
     * Detect if child is in a crash loop
     * Crash loop = more than 3 crashes in 60 seconds
     */
    isCrashLooping() {
        const oneMinuteAgo = Date.now() - 60000;
        const recentCrashes = this.crashHistory.filter(time => time > oneMinuteAgo);
        if (recentCrashes.length >= 3) {
            this.logger.warn(`Crash loop detected: ${recentCrashes.length} crashes in the last 60 seconds`);
            return true;
        }
        return false;
    }
    /**
     * Get current restart count
     */
    getCount() {
        return this.restartCount;
    }
    /**
     * Get restart statistics
     */
    getStats() {
        const totalLatency = this.restartLatencies.reduce((sum, lat) => sum + lat, 0);
        const averageLatency = this.restartLatencies.length > 0
            ? totalLatency / this.restartLatencies.length
            : 0;
        return {
            totalRestarts: this.restartCount,
            cleanRestarts: this.cleanRestarts,
            crashes: this.crashes,
            consecutiveCrashes: this.consecutiveCrashes,
            lastRestartTime: this.lastRestartTime,
            averageRestartLatency: Math.floor(averageLatency),
            currentRestartDelay: this.getRestartDelay()
        };
    }
    /**
     * Reset restart statistics
     */
    reset() {
        this.logger.info('Resetting restart statistics');
        this.restartCount = 0;
        this.cleanRestarts = 0;
        this.crashes = 0;
        this.consecutiveCrashes = 0;
        this.lastRestartTime = 0;
        this.crashHistory = [];
        this.restartLatencies = [];
    }
    /**
     * Update restart policy configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('Restart policy configuration updated', this.config);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
/**
 * Factory function to create a restart policy manager
 */
export function createRestartPolicyManager(logger, config) {
    return new RestartPolicyManager(logger, config);
}
//# sourceMappingURL=restart-policy.js.map