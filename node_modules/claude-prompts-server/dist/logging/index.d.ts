/**
 * Logging Module
 * Handles file logging and transport-aware console logging
 */
/**
 * Logger interface compatible with existing code
 */
export interface Logger {
    info: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
}
/**
 * Logging configuration options for EnhancedLogger
 */
export interface EnhancedLoggingConfig {
    logFile: string;
    transport: string;
    enableDebug?: boolean;
    configuredLevel?: string;
}
/**
 * Enhanced logger implementation with file and console logging
 */
export declare class EnhancedLogger implements Logger {
    private logFile;
    private transport;
    private enableDebug;
    private isCI;
    private configuredLevel;
    private static readonly LOG_LEVEL_PRIORITY;
    constructor(config: EnhancedLoggingConfig);
    /**
     * Parse string log level to LogLevel enum
     */
    private parseLogLevel;
    /**
     * Check if a log level should be output based on configuration
     */
    private shouldLog;
    /**
     * Initialize the log file with a clean start
     */
    initLogFile(): Promise<void>;
    /**
     * Write a message to the log file
     */
    private logToFile;
    /**
     * Log to console based on transport and environment
     */
    private logToConsole;
    /**
     * Info level logging
     */
    info(message: string, ...args: any[]): void;
    /**
     * Error level logging
     */
    error(message: string, ...args: any[]): void;
    /**
     * Warning level logging
     */
    warn(message: string, ...args: any[]): void;
    /**
     * Debug level logging
     */
    debug(message: string, ...args: any[]): void;
    /**
     * Update transport type (useful when transport is determined after logger creation)
     */
    setTransport(transport: string): void;
    /**
     * Enable or disable debug logging
     */
    setDebugEnabled(enabled: boolean): void;
    /**
     * Log startup information
     */
    logStartupInfo(transport: string, config: any): void;
    /**
     * Log memory usage information
     */
    logMemoryUsage(): void;
}
/**
 * Create a logger instance
 */
export declare function createLogger(config: EnhancedLoggingConfig): EnhancedLogger;
/**
 * Helper to build a logger configuration with sensible defaults.
 * Allows subsystems to opt into lightweight logging without duplicating paths.
 */
export declare function getDefaultLoggerConfig(overrides?: Partial<EnhancedLoggingConfig>): EnhancedLoggingConfig;
/**
 * Create a simple logger for areas that don't need the full enhanced logger
 * Now supports verbosity control via command-line flags
 */
export declare function createSimpleLogger(transport?: string): Logger;
/**
 * Setup console redirection for STDIO transport
 * This prevents log messages from interfering with JSON MCP messages
 */
export declare function setupConsoleRedirection(logger: Logger): void;
/**
 * Setup process event handlers for logging
 */
export declare function setupProcessEventHandlers(logger: Logger): void;
