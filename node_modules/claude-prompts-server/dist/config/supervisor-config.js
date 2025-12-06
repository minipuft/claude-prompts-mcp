/**
 * Supervisor Configuration Management
 * Handles loading and validation of supervisor-specific configuration
 */
/**
 * Default supervisor configuration
 * Supervisor is disabled by default for backward compatibility
 */
export const DEFAULT_SUPERVISOR_CONFIG = {
    enabled: false,
    childCommand: 'node',
    childArgs: ['dist/index.js'],
    restartTimeout: 30000,
    maxRestarts: 3,
    restartDelay: 1000,
    backoffMultiplier: 1.5,
    logLevel: 'info'
};
/**
 * Load supervisor configuration from main config object
 */
export function loadSupervisorConfig(config) {
    if (!config || !config.supervisor) {
        return { ...DEFAULT_SUPERVISOR_CONFIG };
    }
    const supervisorConfig = config.supervisor;
    return {
        enabled: supervisorConfig.enabled ?? DEFAULT_SUPERVISOR_CONFIG.enabled,
        childCommand: supervisorConfig.childCommand ?? DEFAULT_SUPERVISOR_CONFIG.childCommand,
        childArgs: supervisorConfig.childArgs ?? DEFAULT_SUPERVISOR_CONFIG.childArgs,
        restartTimeout: supervisorConfig.restartTimeout ?? DEFAULT_SUPERVISOR_CONFIG.restartTimeout,
        maxRestarts: supervisorConfig.maxRestarts ?? DEFAULT_SUPERVISOR_CONFIG.maxRestarts,
        restartDelay: supervisorConfig.restartDelay ?? DEFAULT_SUPERVISOR_CONFIG.restartDelay,
        backoffMultiplier: supervisorConfig.backoffMultiplier ?? DEFAULT_SUPERVISOR_CONFIG.backoffMultiplier,
        logLevel: supervisorConfig.logLevel ?? DEFAULT_SUPERVISOR_CONFIG.logLevel
    };
}
/**
 * Validate supervisor configuration
 * Throws error if configuration is invalid
 */
export function validateSupervisorConfig(config) {
    // Validate numeric ranges
    if (config.restartTimeout < 1000) {
        throw new Error('Restart timeout must be at least 1000ms');
    }
    if (config.restartTimeout > 300000) {
        throw new Error('Restart timeout cannot exceed 300000ms (5 minutes)');
    }
    if (config.maxRestarts < 0) {
        throw new Error('Max restarts cannot be negative');
    }
    if (config.maxRestarts > 100) {
        throw new Error('Max restarts cannot exceed 100 (sanity limit)');
    }
    if (config.restartDelay < 0) {
        throw new Error('Restart delay cannot be negative');
    }
    if (config.backoffMultiplier < 1) {
        throw new Error('Backoff multiplier must be >= 1');
    }
    if (config.backoffMultiplier > 10) {
        throw new Error('Backoff multiplier cannot exceed 10 (sanity limit)');
    }
    // Validate log level
    const validLogLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLogLevels.includes(config.logLevel)) {
        throw new Error(`Invalid log level: ${config.logLevel}. Must be one of: ${validLogLevels.join(', ')}`);
    }
    // Validate command
    if (!config.childCommand || config.childCommand.trim() === '') {
        throw new Error('Child command cannot be empty');
    }
}
/**
 * Get supervisor configuration with validation
 */
export function getSupervisorConfig(config) {
    const supervisorConfig = loadSupervisorConfig(config);
    validateSupervisorConfig(supervisorConfig);
    return supervisorConfig;
}
//# sourceMappingURL=supervisor-config.js.map