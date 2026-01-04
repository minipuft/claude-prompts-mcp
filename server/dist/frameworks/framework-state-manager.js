// @lifecycle canonical - Tracks active framework state and switching heuristics.
/**
 * Stateful Framework State Manager
 *
 * Manages the active framework methodology state and provides framework switching capabilities.
 * This tracks switching mechanics (timing, success/failure, counts) and framework state.
 * This is separate from execution strategy analysis - it handles WHICH framework methodology
 * to apply (built-in or custom) while semantic analysis handles execution strategies.
 */
import { EventEmitter } from 'events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createFrameworkManager } from './framework-manager.js';
/**
 * Stateful Framework State Manager
 *
 * Maintains framework state across operations and provides switching capabilities
 */
export class FrameworkStateManager extends EventEmitter {
    constructor(logger, serverRoot) {
        super();
        this.frameworkManager = null;
        this.switchHistory = [];
        this.switchingMetrics = {
            totalSwitches: 0,
            successfulSwitches: 0,
            failedSwitches: 0,
            averageResponseTime: 0,
            errorCount: 0,
        };
        this.isInitialized = false;
        this.logger = logger;
        // Set state file path - place in config directory for better organization
        const rootPath = path.resolve(serverRoot || process.cwd());
        this.runtimeStatePath = path.join(rootPath, 'runtime-state', 'framework-state.json');
        // Initialize with default framework state (will be overridden by loadPersistedState)
        this.currentState = {
            activeFramework: 'CAGEERF', // Default to CAGEERF
            previousFramework: null,
            switchedAt: new Date(),
            switchReason: 'Initial framework selection',
            isHealthy: true,
            frameworkSystemEnabled: false, // NEW: Framework system disabled by default (changed from true)
            switchingMetrics: {
                switchCount: 0,
                averageResponseTime: 0,
                errorCount: 0,
            },
        };
    }
    /**
     * Initialize the framework state manager
     */
    async initialize() {
        if (this.isInitialized) {
            this.logger.debug('FrameworkStateManager already initialized');
            return;
        }
        // Load persisted state before setting up framework manager
        await this.loadPersistedState();
        this.logger.info('Initializing Framework State Manager...');
        try {
            // Initialize framework manager
            this.frameworkManager = await createFrameworkManager(this.logger);
            // Validate persisted framework exists, fallback to default if not
            const persistedFramework = this.currentState.activeFramework;
            let validatedFramework = this.frameworkManager.getFramework(persistedFramework);
            if (!validatedFramework) {
                // Persisted framework no longer exists - fallback to first available
                const availableFrameworks = this.frameworkManager.listFrameworks().map((f) => f.id);
                const fallbackId = availableFrameworks[0];
                if (!fallbackId) {
                    throw new Error('No frameworks available - cannot initialize');
                }
                this.logger.warn(`Persisted framework '${persistedFramework}' not found, falling back to '${fallbackId}'`);
                // Update state with valid framework
                this.currentState.activeFramework = fallbackId;
                this.currentState.switchReason = `Auto-recovered from missing framework '${persistedFramework}'`;
                this.currentState.switchedAt = new Date();
                // Persist the corrected state
                await this.saveStateToFile();
                validatedFramework = this.frameworkManager.getFramework(fallbackId);
            }
            if (!validatedFramework) {
                throw new Error(`Failed to validate framework after fallback`);
            }
            this.isInitialized = true;
            this.logger.info(`Framework State Manager initialized with active framework: ${this.currentState.activeFramework}`);
            // Emit initial health status
            this.emit('health-changed', this.getSystemHealth());
        }
        catch (error) {
            this.logger.error('Failed to initialize Framework State Manager:', error);
            throw error;
        }
    }
    /**
     * Get current framework state
     */
    getCurrentState() {
        this.ensureInitialized();
        return { ...this.currentState };
    }
    /**
     * Load persisted state from file
     */
    async loadPersistedState() {
        try {
            const stateContent = await fs.readFile(this.runtimeStatePath, 'utf-8');
            const persistedState = JSON.parse(stateContent);
            if (this.isValidPersistedState(persistedState)) {
                this.currentState.frameworkSystemEnabled = persistedState.frameworkSystemEnabled;
                this.currentState.activeFramework = persistedState.activeFramework;
                this.currentState.switchedAt = new Date(persistedState.lastSwitchedAt);
                this.currentState.switchReason = persistedState.switchReason;
                this.logger.info(`✅ Loaded framework state cache: ${persistedState.frameworkSystemEnabled ? 'enabled' : 'disabled'}, active: ${persistedState.activeFramework}`);
                return;
            }
            this.logger.warn(`⚠️ Invalid framework state cache at ${this.runtimeStatePath}, falling back to defaults`);
        }
        catch (error) {
            if (error?.code !== 'ENOENT') {
                this.logger.warn(`⚠️ Failed to load framework state cache ${this.runtimeStatePath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.logger.info('📁 No framework state cache found, using defaults');
        await this.saveStateToFile();
    }
    /**
     * Save current state to file.
     * Throws on failure so callers can handle persistence errors appropriately.
     */
    async saveStateToFile() {
        const persistedState = {
            version: '1.0.0',
            frameworkSystemEnabled: this.currentState.frameworkSystemEnabled,
            activeFramework: this.currentState.activeFramework,
            lastSwitchedAt: this.currentState.switchedAt.toISOString(),
            switchReason: this.currentState.switchReason,
        };
        const runtimeDir = path.dirname(this.runtimeStatePath);
        await fs.mkdir(runtimeDir, { recursive: true });
        await fs.writeFile(this.runtimeStatePath, JSON.stringify(persistedState, null, 2));
        this.logger.debug(`💾 Framework state saved to ${this.runtimeStatePath}`);
    }
    /**
     * Validate persisted state structure
     * Note: activeFramework can be any string (supports custom framework types)
     */
    isValidPersistedState(state) {
        return (state &&
            typeof state.version === 'string' &&
            typeof state.frameworkSystemEnabled === 'boolean' &&
            typeof state.activeFramework === 'string' &&
            state.activeFramework.length > 0 &&
            typeof state.lastSwitchedAt === 'string' &&
            typeof state.switchReason === 'string');
    }
    /**
     * Get active framework definition
     */
    getActiveFramework() {
        this.ensureInitialized();
        const framework = this.frameworkManager.getFramework(this.currentState.activeFramework);
        if (!framework) {
            throw new Error(`Active framework '${this.currentState.activeFramework}' not found`);
        }
        return framework;
    }
    /**
     * Get all available frameworks
     */
    getAvailableFrameworks() {
        this.ensureInitialized();
        return this.frameworkManager.listFrameworks(true); // Only enabled frameworks
    }
    /**
     * Switch to a different framework (persistence layer only).
     * Validation is handled by FrameworkManager - this method trusts the input.
     *
     * @param request - Framework switch request (already validated by FrameworkManager)
     * @returns true on success, throws on persistence failure
     */
    async switchFramework(request) {
        this.ensureInitialized();
        const startTime = performance.now();
        this.switchingMetrics.totalSwitches++;
        // Check if already active (case-insensitive since FrameworkManager normalizes to lowercase)
        if (this.currentState.activeFramework.toLowerCase() === request.targetFramework.toLowerCase()) {
            this.logger.info(`Framework '${request.targetFramework}' is already active`);
            return true;
        }
        // Perform the switch - no validation needed, FrameworkManager already did that
        const previousFramework = this.currentState.activeFramework;
        const switchReason = request.reason || `Switched to ${request.targetFramework}`;
        // Update state
        this.currentState = {
            activeFramework: request.targetFramework,
            previousFramework: previousFramework,
            switchedAt: new Date(),
            switchReason: switchReason,
            isHealthy: true,
            frameworkSystemEnabled: this.currentState.frameworkSystemEnabled,
            switchingMetrics: {
                switchCount: this.currentState.switchingMetrics.switchCount + 1,
                averageResponseTime: this.currentState.switchingMetrics.averageResponseTime,
                errorCount: this.currentState.switchingMetrics.errorCount,
            },
        };
        // Record switch history
        this.switchHistory.push({
            from: previousFramework,
            to: request.targetFramework,
            timestamp: new Date(),
            reason: switchReason,
        });
        // Save state to file - throws on failure per async-error-handling rules
        await this.saveStateToFile();
        const switchTime = performance.now() - startTime;
        this.updateSwitchingMetrics(switchTime, true);
        this.logger.info(`✅ Framework switch successful: '${previousFramework}' -> '${request.targetFramework}' (${switchTime.toFixed(1)}ms)`);
        // Emit events
        this.emit('framework-switched', previousFramework, request.targetFramework, switchReason);
        this.emit('health-changed', this.getSystemHealth());
        return true;
    }
    /**
     * Generate execution context using active framework
     */
    generateExecutionContext(prompt, criteria) {
        this.ensureInitialized();
        // NEW: Return null if framework system is disabled
        if (!this.currentState.frameworkSystemEnabled) {
            return null;
        }
        // Use framework manager to generate context with active framework
        const mergedCriteria = {
            userPreference: this.currentState.activeFramework,
            ...criteria,
        };
        return this.frameworkManager.generateExecutionContext(prompt, mergedCriteria);
    }
    /**
     * Get framework system health
     */
    getSystemHealth() {
        this.ensureInitialized();
        const issues = [];
        let status = 'healthy';
        // Check for health issues
        if (this.currentState.switchingMetrics.errorCount > 0) {
            issues.push(`${this.currentState.switchingMetrics.errorCount} framework switching errors detected`);
            status = this.currentState.switchingMetrics.errorCount > 5 ? 'error' : 'degraded';
        }
        if (!this.currentState.isHealthy) {
            issues.push('Framework system is in unhealthy state');
            status = 'error';
        }
        const activeFramework = this.frameworkManager.getFramework(this.currentState.activeFramework);
        if (!activeFramework?.enabled) {
            issues.push(`Active framework '${this.currentState.activeFramework}' is disabled`);
            status = 'error';
        }
        const lastSwitch = this.switchHistory[this.switchHistory.length - 1];
        const lastSwitchTime = lastSwitch ? lastSwitch.timestamp : null;
        return {
            status,
            activeFramework: this.currentState.activeFramework,
            frameworkSystemEnabled: this.currentState.frameworkSystemEnabled, // NEW: Include enabled state
            availableFrameworks: this.frameworkManager.listFrameworks(true).map((f) => f.id),
            lastSwitchTime,
            switchingMetrics: { ...this.switchingMetrics },
            issues,
        };
    }
    /**
     * Get framework switch history
     */
    getSwitchHistory(limit) {
        const history = [...this.switchHistory].reverse(); // Most recent first
        return limit ? history.slice(0, limit) : history;
    }
    /**
     * Reset switching performance metrics
     */
    resetMetrics() {
        this.switchingMetrics = {
            totalSwitches: 0,
            successfulSwitches: 0,
            failedSwitches: 0,
            averageResponseTime: 0,
            errorCount: 0,
        };
        this.currentState.switchingMetrics = {
            switchCount: 0,
            averageResponseTime: 0,
            errorCount: 0,
        };
        this.logger.info('Framework state manager switching metrics reset');
    }
    /**
     * Enable the framework system
     */
    async enableFrameworkSystem(reason) {
        this.ensureInitialized();
        if (this.currentState.frameworkSystemEnabled) {
            this.logger.info('Framework system is already enabled');
            return;
        }
        const enableReason = reason || 'Framework system enabled';
        this.currentState.frameworkSystemEnabled = true;
        this.currentState.switchReason = enableReason;
        this.currentState.switchedAt = new Date();
        this.logger.info(`✅ Framework system enabled: ${enableReason}`);
        // Save state to file - await to ensure persistence
        try {
            await this.saveStateToFile();
        }
        catch (error) {
            this.logger.error(`Failed to persist framework enable state: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Emit events
        this.emit('framework-system-toggled', true, enableReason);
        this.emit('health-changed', this.getSystemHealth());
    }
    /**
     * Disable the framework system
     */
    async disableFrameworkSystem(reason) {
        this.ensureInitialized();
        if (!this.currentState.frameworkSystemEnabled) {
            this.logger.info('Framework system is already disabled');
            return;
        }
        const disableReason = reason || 'Framework system disabled';
        this.currentState.frameworkSystemEnabled = false;
        this.currentState.switchReason = disableReason;
        this.currentState.switchedAt = new Date();
        this.logger.info(`🚫 Framework system disabled: ${disableReason}`);
        // Save state to file - await to ensure persistence
        try {
            await this.saveStateToFile();
        }
        catch (error) {
            this.logger.error(`Failed to persist framework disable state: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Emit events
        this.emit('framework-system-toggled', false, disableReason);
        this.emit('health-changed', this.getSystemHealth());
    }
    /**
     * Check if framework system is enabled
     */
    isFrameworkSystemEnabled() {
        this.ensureInitialized();
        return this.currentState.frameworkSystemEnabled;
    }
    /**
     * Set framework system enabled state (for config loading)
     */
    async setFrameworkSystemEnabled(enabled, reason) {
        if (enabled) {
            await this.enableFrameworkSystem(reason || 'Loaded from configuration');
        }
        else {
            await this.disableFrameworkSystem(reason || 'Loaded from configuration');
        }
    }
    // Private helper methods
    ensureInitialized() {
        if (!this.isInitialized || !this.frameworkManager) {
            throw new Error('FrameworkStateManager not initialized. Call initialize() first.');
        }
    }
    updateSwitchingMetrics(responseTime, success) {
        if (success) {
            this.switchingMetrics.successfulSwitches++;
        }
        else {
            this.switchingMetrics.failedSwitches++;
        }
        // Update average response time for switching operations
        const totalOperations = this.switchingMetrics.successfulSwitches + this.switchingMetrics.failedSwitches;
        this.switchingMetrics.averageResponseTime =
            (this.switchingMetrics.averageResponseTime * (totalOperations - 1) + responseTime) /
                totalOperations;
        this.currentState.switchingMetrics.averageResponseTime =
            this.switchingMetrics.averageResponseTime;
    }
    /**
     * Shutdown the framework state manager and cleanup resources
     * Prevents async handle leaks by persisting state and removing event listeners
     */
    async shutdown() {
        this.logger.info('Shutting down FrameworkStateManager...');
        try {
            // Persist final state to disk
            await this.saveStateToFile();
            this.logger.debug('Framework state persisted during shutdown');
        }
        catch (error) {
            this.logger.warn('Error persisting state during shutdown:', error);
        }
        // Remove all event listeners
        this.removeAllListeners();
        this.logger.debug('Event listeners removed during shutdown');
        this.logger.info('FrameworkStateManager shutdown complete');
    }
}
/**
 * Create and initialize framework state manager
 */
export async function createFrameworkStateManager(logger, serverRoot) {
    const manager = new FrameworkStateManager(logger, serverRoot);
    await manager.initialize();
    return manager;
}
//# sourceMappingURL=framework-state-manager.js.map