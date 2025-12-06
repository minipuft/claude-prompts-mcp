/**
 * Supervisor Type Definitions
 * Type interfaces for the MCP server supervisor process
 */
/**
 * Supervisor configuration interface
 */
export interface SupervisorConfig {
    /** Enable supervisor mode */
    enabled: boolean;
    /** Command to spawn child server (e.g., "node dist/index.js") */
    childCommand: string;
    /** Arguments to pass to child command */
    childArgs?: string[];
    /** Timeout for graceful shutdown in milliseconds (default: 30000) */
    restartTimeout: number;
    /** Maximum number of restart attempts (default: 3) */
    maxRestarts: number;
    /** Base delay between restarts in milliseconds (default: 1000) */
    restartDelay: number;
    /** Backoff multiplier for exponential backoff (default: 1.5) */
    backoffMultiplier: number;
    /** Logging level */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
}
/**
 * Restart policy configuration
 */
export interface RestartPolicy {
    /** Maximum number of restart attempts */
    maxRestarts: number;
    /** Base delay between restarts in milliseconds */
    restartDelay: number;
    /** Timeout for graceful shutdown in milliseconds */
    restartTimeout: number;
    /** Exponential backoff multiplier */
    backoffMultiplier: number;
}
/**
 * Restart statistics and metrics
 */
export interface RestartStats {
    /** Total number of restarts */
    totalRestarts: number;
    /** Number of clean restarts (exit code 0) */
    cleanRestarts: number;
    /** Number of crashes (exit code > 0) */
    crashes: number;
    /** Number of consecutive crashes */
    consecutiveCrashes: number;
    /** Timestamp of last restart */
    lastRestartTime: number;
    /** Average restart latency in milliseconds */
    averageRestartLatency: number;
    /** Current restart delay (with backoff applied) */
    currentRestartDelay: number;
}
/**
 * Supervisor status information
 */
export interface SupervisorStatus {
    /** Is supervisor running */
    running: boolean;
    /** Child process ID (if running) */
    childPid?: number;
    /** Supervisor start time */
    startTime: number;
    /** Supervisor uptime in milliseconds */
    uptime: number;
    /** Restart statistics */
    restartStats: RestartStats;
    /** Is supervisor in crash loop state */
    crashLooping: boolean;
}
/**
 * Supervisor event types
 */
export type SupervisorEventType = 'supervisor_started' | 'child_spawned' | 'child_restarted' | 'child_crashed' | 'graceful_shutdown' | 'forced_shutdown' | 'crash_loop_detected' | 'max_restarts_exceeded' | 'supervisor_stopped';
/**
 * Supervisor event data
 */
export interface SupervisorEvent {
    /** Event type */
    type: SupervisorEventType;
    /** Event timestamp */
    timestamp: number;
    /** Event message */
    message: string;
    /** Exit code (for child exit events) */
    exitCode?: number;
    /** Signal that caused exit (for child exit events) */
    signal?: string;
    /** Restart reason (for restart events) */
    reason?: string;
    /** Additional metadata */
    metadata?: Record<string, any>;
}
