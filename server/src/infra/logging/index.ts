// @lifecycle canonical - Primary logger implementation and console adapters.
/**
 * Logging Module
 * Handles file logging and transport-aware console logging
 */

import { appendFile, writeFile } from 'node:fs/promises';

import type { Logger } from '#shared/types/index.js';

import { LogLevel, TransportType } from '#shared/types/index.js';

// Logger interface is defined in shared/types/ (Layer 0) for cross-layer access.
// Re-exported here for backward compatibility.
export type { Logger } from '#shared/types/index.js';

/**
 * Log entry for the in-memory ring buffer (exposed via MCP resources)
 */
export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Options for retrieving recent logs
 */
export interface GetRecentLogsOptions {
  level?: 'error' | 'warn' | 'info' | 'debug';
  limit?: number;
}

/**
 * Logging configuration options for EnhancedLogger
 */
export interface EnhancedLoggingConfig {
  logFile: string;
  transport: string;
  enableDebug?: boolean;
  configuredLevel?: string;
  /** Maximum entries to retain in ring buffer (default: 500) */
  maxBufferEntries?: number;
  /** Minimum level to buffer for resource access (default: 'info') */
  bufferLevel?: string;
}

/**
 * Enhanced logger implementation with file and console logging
 */
export class EnhancedLogger implements Logger {
  private logFile: string;
  private transport: string;
  private enableDebug: boolean;
  private isCI: boolean;
  private configuredLevel: LogLevel;
  private static readonly LOG_LEVEL_PRIORITY = {
    [LogLevel.ERROR]: 0,
    [LogLevel.WARN]: 1,
    [LogLevel.INFO]: 2,
    [LogLevel.DEBUG]: 3,
  };

  // Ring buffer for MCP resources access
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize: number;
  private nextEntryId: number = 1;
  private bufferLevel: LogLevel;

  constructor(config: EnhancedLoggingConfig) {
    this.logFile = config.logFile;
    this.transport = config.transport;
    this.enableDebug = config.enableDebug || false;
    this.isCI = process.env['CI'] === 'true' || process.env['NODE_ENV'] === 'test';

    // Map config level to LogLevel enum with fallback to INFO
    this.configuredLevel = this.parseLogLevel(config.configuredLevel || 'info');

    // Ring buffer configuration
    this.maxBufferSize = config.maxBufferEntries ?? 500;
    this.bufferLevel = this.parseLogLevel(config.bufferLevel ?? 'info');
  }

  /**
   * Parse string log level to LogLevel enum
   */
  private parseLogLevel(level: string): LogLevel {
    const normalizedLevel = level.toUpperCase();
    switch (normalizedLevel) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
        return LogLevel.WARN;
      case 'ERROR':
        return LogLevel.ERROR;
      default:
        console.warn(`Unknown log level "${level}", defaulting to INFO`);
        return LogLevel.INFO;
    }
  }

  /**
   * Check if a log level should be output based on configuration
   */
  private shouldLog(level: LogLevel): boolean {
    // Command-line flags override config
    if (this.enableDebug) {
      return true; // Show everything in debug mode
    }

    const levelPriority = EnhancedLogger.LOG_LEVEL_PRIORITY[level];
    const configPriority = EnhancedLogger.LOG_LEVEL_PRIORITY[this.configuredLevel];

    return levelPriority <= configPriority;
  }

  /**
   * Initialize the log file with a clean start
   */
  async initLogFile(): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      await writeFile(this.logFile, `--- MCP Server Log Started at ${timestamp} ---\n`, 'utf8');
    } catch (error) {
      console.error(`Error initializing log file:`, error);
    }
  }

  /**
   * Write a message to the log file
   */
  private async logToFile(level: LogLevel, message: string, ...args: any[]): Promise<void> {
    // Check if this log level should be output based on configuration
    if (!this.shouldLog(level)) {
      return;
    }

    try {
      let logMessage = `[${new Date().toISOString()}] [${level}] ${message}`;
      if (args.length > 0) {
        logMessage += ` ${args
          .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : arg))
          .join(' ')}`;
      }
      await appendFile(this.logFile, logMessage + '\n', 'utf8');
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  /**
   * Log to console based on transport and environment.
   *
   * STDIO owns stdout for the protocol, so nothing ever prints there; stderr is free. Every level
   * first passes `shouldLog` (the configured log level; `enableDebug` lets everything through).
   * Then, by environment:
   *  - STDIO, not CI: ERROR/WARN reach stderr. INFO/DEBUG reach stderr only with `enableDebug`,
   *    so a clean, non-verbose start stays quiet.
   *  - STDIO, CI: ERROR/WARN reach stderr. INFO and DEBUG never do.
   *  - Non-STDIO, not CI: all four levels reach stderr.
   *  - Non-STDIO, CI: ERROR/WARN/INFO reach stderr. DEBUG does only with `enableDebug`.
   */
  private logToConsole(level: LogLevel, message: string, ...args: any[]): void {
    // Respect the configured level / enableDebug gate before considering environment at all.
    if (!this.shouldLog(level)) {
      return;
    }

    // CI: ERROR/WARN always reach stderr regardless of transport; DEBUG is gated on enableDebug.
    // logCILevel reports whether it fully handled the level — INFO, and DEBUG with enableDebug,
    // are left unhandled for the transport-aware branches below to decide.
    if (this.isCI && this.logCILevel(level, message, args)) {
      return;
    }

    // STDIO, outside CI: stdout stays the protocol channel; stderr is free. ERROR/WARN always
    // reach it; INFO/DEBUG are gated on enableDebug so a clean start stays quiet.
    if (!this.isCI && this.transport === TransportType.STDIO) {
      this.logStdioLevel(level, message, args);
      return;
    }

    // Only a non-STDIO transport prints past this point — including a CI+STDIO level (INFO, or
    // DEBUG with enableDebug) that reached here unhandled above, which is why CI+STDIO INFO
    // never prints.
    if (this.transport !== TransportType.STDIO) {
      this.logNonStdioLevel(level, message, args);
    }
  }

  /**
   * CI branch of {@link logToConsole} — see there for the full table. Handles ERROR/WARN by
   * printing them, and DEBUG by suppressing it unless `enableDebug` is set — both report
   * handled (`true`). Leaves INFO, and DEBUG with `enableDebug`, unhandled (`false`) for the
   * caller to decide via the transport-aware branches below.
   */
  private logCILevel(level: LogLevel, message: string, args: unknown[]): boolean {
    if (level === LogLevel.ERROR || level === LogLevel.WARN) {
      if (level === LogLevel.ERROR) {
        console.error(`[ERROR] ${message}`, ...args);
      } else {
        console.warn(`[WARN] ${message}`, ...args);
      }
      return true;
    }
    // In CI, suppress DEBUG messages unless explicitly enabled
    return level === LogLevel.DEBUG && !this.enableDebug;
  }

  /** STDIO-outside-CI branch of {@link logToConsole} — see there for the full table. */
  private logStdioLevel(level: LogLevel, message: string, args: unknown[]): void {
    switch (level) {
      case LogLevel.ERROR:
        console.error(`[ERROR] ${message}`, ...args);
        break;
      case LogLevel.WARN:
        console.warn(`[WARN] ${message}`, ...args);
        break;
      case LogLevel.INFO:
        if (this.enableDebug) {
          console.error(`[INFO] ${message}`, ...args);
        }
        break;
      case LogLevel.DEBUG:
        if (this.enableDebug) {
          console.error(`[DEBUG] ${message}`, ...args);
        }
        break;
    }
  }

  /** Non-STDIO branch of {@link logToConsole} — see there for the full table: all four levels print. */
  private logNonStdioLevel(level: LogLevel, message: string, args: unknown[]): void {
    switch (level) {
      case LogLevel.INFO:
        console.error(`[INFO] ${message}`, ...args);
        break;
      case LogLevel.ERROR:
        console.error(`[ERROR] ${message}`, ...args);
        break;
      case LogLevel.WARN:
        console.warn(`[WARN] ${message}`, ...args);
        break;
      case LogLevel.DEBUG:
        console.error(`[DEBUG] ${message}`, ...args);
        break;
    }
  }

  /**
   * Info level logging
   */
  info(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.INFO, message, ...args);
    this.logToFile(LogLevel.INFO, message, ...args);
    this.addToBuffer(LogLevel.INFO, message, args);
  }

  /**
   * Error level logging
   */
  error(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.ERROR, message, ...args);
    this.logToFile(LogLevel.ERROR, message, ...args);
    this.addToBuffer(LogLevel.ERROR, message, args);
  }

  /**
   * Warning level logging
   */
  warn(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.WARN, message, ...args);
    this.logToFile(LogLevel.WARN, message, ...args);
    this.addToBuffer(LogLevel.WARN, message, args);
  }

  /**
   * Debug level logging
   */
  debug(message: string, ...args: any[]): void {
    this.logToConsole(LogLevel.DEBUG, message, ...args);
    this.logToFile(LogLevel.DEBUG, message, ...args);
    this.addToBuffer(LogLevel.DEBUG, message, args);
  }

  /**
   * Log startup information
   *
   * Restored 2026-09-20 (P4.52 reimplementation probe): `ServerLifecycle.logSystemInfo`
   * (infra/http/index.ts) independently logs the same pid/node-version/cwd facts inline instead
   * of calling this method — a live duplicate, not proof this method is dead. Left un-wired
   * pending an owner decision on which caller should be the canonical one.
   */
  logStartupInfo(transport: string, config: any): void {
    this.info(`Server starting up - Process ID: ${process.pid}`);
    this.info(`Node version: ${process.version}`);
    this.info(`Working directory: ${process.cwd()}`);
    this.info(`Using transport: ${transport}`);
    this.info(`Command-line arguments: ${JSON.stringify(process.argv)}`);
    this.debug('Configuration:', JSON.stringify(config, null, 2));
  }

  /**
   * Log memory usage information
   *
   * Restored 2026-09-20 (P4.52 reimplementation probe): `ServerLifecycle.logSystemInfo`
   * (infra/http/index.ts) logs the identical `Server process memory usage: ${JSON.stringify(...)}`
   * string inline instead of calling this method — a live duplicate, not proof this method is
   * dead. Left un-wired pending an owner decision on which caller should be the canonical one.
   */
  logMemoryUsage(): void {
    this.info(`Server process memory usage: ${JSON.stringify(process.memoryUsage())}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Ring Buffer Methods (for MCP resources access)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a log entry to the ring buffer
   */
  private addToBuffer(level: LogLevel, message: string, args: unknown[]): void {
    // Check if this level should be buffered
    const levelPriority = EnhancedLogger.LOG_LEVEL_PRIORITY[level];
    const bufferPriority = EnhancedLogger.LOG_LEVEL_PRIORITY[this.bufferLevel];
    if (levelPriority > bufferPriority) {
      return; // Skip entries below buffer threshold
    }

    const entry: LogEntry = {
      id: `log-${this.nextEntryId++}`,
      timestamp: Date.now(),
      level: level.toLowerCase() as LogEntry['level'],
      message,
      context: this.extractContext(args),
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift(); // Remove oldest entry
    }
  }

  /**
   * Extract structured context from log arguments
   */
  private extractContext(args: unknown[]): Record<string, unknown> | undefined {
    if (args.length === 0) {
      return undefined;
    }

    // Extract component tag from message if present (e.g., "[Pipeline]")
    const context: Record<string, unknown> = {};

    for (const arg of args) {
      if (typeof arg === 'object' && arg !== null) {
        Object.assign(context, arg);
      } else if (typeof arg === 'string') {
        // Check for component pattern like "[Component]"
        const componentMatch = arg.match(/^\[([^\]]+)\]/);
        if (componentMatch !== null) {
          context['component'] = componentMatch[1];
        }
      }
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  /**
   * Get recent log entries from the ring buffer
   * @param options.level - Filter to this level and above (e.g., 'warn' returns warn + error)
   * @param options.limit - Maximum entries to return (default: 100)
   */
  getRecentLogs(options?: GetRecentLogsOptions): LogEntry[] {
    const { level, limit = 100 } = options ?? {};
    let filtered = this.logBuffer;

    if (level !== undefined) {
      const levelPriority: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
      const maxPriority = levelPriority[level] ?? 3;
      filtered = filtered.filter((e) => (levelPriority[e.level] ?? 3) <= maxPriority);
    }

    // Return newest first, limited
    return filtered.slice(-limit).reverse();
  }

  /**
   * Get a specific log entry by ID
   */
  getLogEntry(id: string): LogEntry | undefined {
    return this.logBuffer.find((e) => e.id === id);
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): { count: number; maxSize: number; oldestId: string | null } {
    const oldest = this.logBuffer[0];
    return {
      count: this.logBuffer.length,
      maxSize: this.maxBufferSize,
      oldestId: oldest?.id ?? null,
    };
  }
}

/**
 * Create a logger instance
 */
export function createLogger(config: EnhancedLoggingConfig): EnhancedLogger {
  return new EnhancedLogger(config);
}

/**
 * Helper to build a logger configuration with sensible defaults.
 * Allows subsystems to opt into lightweight logging without duplicating paths.
 */
export function getDefaultLoggerConfig(
  overrides: Partial<EnhancedLoggingConfig> = {}
): EnhancedLoggingConfig {
  // Require explicit logFile - no process.cwd() guessing
  // Callers should pass logFile from PathResolver or ConfigManager
  if (!overrides.logFile) {
    throw new Error(
      'getDefaultLoggerConfig requires logFile in overrides. ' +
        'Use PathResolver.getLogsPath() or ConfigManager to determine log location.'
    );
  }

  return {
    logFile: overrides.logFile,
    transport: overrides.transport ?? TransportType.STDIO,
    enableDebug: overrides.enableDebug ?? false,
    configuredLevel: overrides.configuredLevel ?? 'info',
  };
}

/**
 * Create a simple logger for areas that don't need the full enhanced logger
 * Now supports verbosity control via command-line flags
 */
export function createSimpleLogger(transport: string = 'stdio'): Logger {
  const enableConsole = transport !== TransportType.STDIO;

  // Check command-line flags for verbosity control
  const args = process.argv.slice(2);
  const isVerbose = args.includes('--verbose') || args.includes('--debug-startup');
  const isQuiet = args.includes('--quiet');

  // Always use stderr to avoid corrupting STDIO protocol
  return {
    info: (message: string, ...args: any[]) => {
      if (enableConsole && !isQuiet) {
        console.error(`[INFO] ${message}`, ...args);
      }
    },
    error: (message: string, ...args: any[]) => {
      if (enableConsole && !isQuiet) {
        console.error(`[ERROR] ${message}`, ...args);
      }
    },
    warn: (message: string, ...args: any[]) => {
      if (enableConsole && !isQuiet) {
        console.warn(`[WARN] ${message}`, ...args);
      }
    },
    debug: (message: string, ...args: any[]) => {
      if (enableConsole && isVerbose) {
        console.error(`[DEBUG] ${message}`, ...args);
      }
    },
  };
}

/**
 * Create a no-op logger for tests and cases where logging isn't needed.
 * All methods are empty functions that discard log messages.
 */
export function createNoopLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * Pre-instantiated no-op logger singleton for convenience.
 * Use this when you need a logger instance but don't want any output.
 */
export const noopLogger: Logger = createNoopLogger();

/**
 * Setup process event handlers for logging
 */
export function setupProcessEventHandlers(logger: Logger): void {
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down server...');
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  // Log when the stdin closes (which happens when the parent process terminates)
  process.stdin.on('end', () => {
    logger.info('STDIN stream ended - parent process may have terminated');
    process.exit(0);
  });
}
