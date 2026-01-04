/**
 * Transport Management Module
 * Handles STDIO and SSE transport setup and lifecycle management
 */
import express from 'express';
import { ConfigManager } from '../../config/index.js';
import { Logger } from '../../logging/index.js';
import type { TransportMode } from '../../types/index.js';
/**
 * Transport types supported by the server
 */
export declare enum TransportType {
    STDIO = "stdio",
    SSE = "sse",
    BOTH = "both"
}
/**
 * Transport Manager class
 */
export declare class TransportManager {
    private logger;
    private configManager;
    private mcpServer;
    private transport;
    private sseTransports;
    constructor(logger: Logger, configManager: ConfigManager, mcpServer: any, transport: TransportMode);
    /**
     * Determine transport mode from command line arguments or configuration
     * Priority: CLI args > config.transport > default (stdio)
     */
    static determineTransport(args: string[], configManager: ConfigManager): TransportMode;
    /**
     * Setup STDIO transport
     */
    setupStdioTransport(): Promise<void>;
    /**
     * Setup console redirection for STDIO transport
     */
    private setupStdioConsoleRedirection;
    /**
     * Setup STDIO event handlers
     */
    private setupStdioEventHandlers;
    /**
     * Setup SSE transport with Express integration
     */
    setupSseTransport(app: express.Application): void;
    /**
     * Get transport mode
     */
    getTransportType(): TransportMode;
    /**
     * Check if STDIO transport should be active
     * True for 'stdio' or 'both' modes
     */
    isStdio(): boolean;
    /**
     * Check if SSE transport should be active
     * True for 'sse' or 'both' modes
     */
    isSse(): boolean;
    /**
     * Check if running in dual transport mode
     */
    isBoth(): boolean;
    /**
     * Get active SSE connections count
     */
    getActiveConnectionsCount(): number;
    /**
     * Close all active SSE connections
     */
    closeAllConnections(): void;
}
/**
 * Create and configure a transport manager
 */
export declare function createTransportManager(logger: Logger, configManager: ConfigManager, mcpServer: any, transport: TransportMode): TransportManager;
