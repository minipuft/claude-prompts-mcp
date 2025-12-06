#!/usr/bin/env node
/**
 * MCP Server Supervisor
 * Transparent proxy that keeps MCP client connections alive during server restarts
 *
 * Inspired by reloaderoo - provides seamless hot-reloading for MCP servers
 */
import { SupervisorConfig, SupervisorStatus, SupervisorEvent } from './types.js';
/**
 * Default supervisor configuration
 */
declare const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig;
/**
 * Supervisor class
 * Manages child server process lifecycle and maintains client connections
 */
export declare class Supervisor {
    private logger;
    private config;
    private restartPolicy;
    private stdioProxy;
    private childProcess?;
    private isRunning;
    private startTime;
    private shutdownTimeout?;
    private isShuttingDown;
    constructor(config?: Partial<SupervisorConfig>);
    /**
     * Start supervisor and spawn initial child process
     */
    start(): Promise<void>;
    /**
     * Spawn child server process
     */
    private spawnChild;
    /**
     * Setup child process event handlers
     */
    private setupChildHandlers;
    /**
     * Handle child process exit
     */
    private handleChildExit;
    /**
     * Handle clean restart request (exit code 0)
     */
    private handleRestartRequest;
    /**
     * Handle child process crash (exit code > 0)
     */
    private handleCrash;
    /**
     * Setup signal handlers for graceful shutdown
     */
    private setupSignalHandlers;
    /**
     * Stop supervisor and terminate child gracefully
     */
    stop(): Promise<void>;
    /**
     * Terminate child process gracefully with timeout
     */
    private terminateChild;
    /**
     * Get supervisor status
     */
    getStatus(): SupervisorStatus;
    /**
     * Emit supervisor event (for logging and monitoring)
     */
    private emitEvent;
}
export { DEFAULT_SUPERVISOR_CONFIG };
export type { SupervisorConfig, SupervisorStatus, SupervisorEvent };
