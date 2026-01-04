/**
 * Server Management Module
 * Handles HTTP server lifecycle, process management, and orchestration
 */
import { Server } from 'http';
import { ApiManager } from '../api/index.js';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { TransportManager, createTransportManager, TransportType } from './transport/index.js';
export { TransportManager, createTransportManager, TransportType };
/**
 * Server Manager class
 */
export declare class ServerManager {
    private logger;
    private configManager;
    private transportManager;
    private apiManager;
    private httpServer?;
    private port;
    constructor(logger: Logger, configManager: ConfigManager, transportManager: TransportManager, apiManager?: ApiManager);
    /**
     * Start the server based on transport mode
     * Supports 'stdio', 'sse', or 'both' modes
     */
    startServer(): Promise<void>;
    /**
     * Start server with both STDIO and SSE transports
     */
    private startBothTransports;
    /**
     * Start server with STDIO transport
     */
    private startStdioServer;
    /**
     * Start server with SSE transport
     */
    private startSseServer;
    /**
     * Setup HTTP server event handlers
     */
    private setupHttpServerEventHandlers;
    /**
     * Log system information
     */
    private logSystemInfo;
    /**
     * Graceful shutdown
     */
    shutdown(exitCode?: number): void;
    /**
     * Finalize shutdown process
     */
    private finalizeShutdown;
    /**
     * Restart the server
     */
    restart(reason?: string): Promise<void>;
    /**
     * Check if server is running
     */
    isRunning(): boolean;
    /**
     * Get server status information
     */
    getStatus(): {
        running: boolean;
        transport: string;
        port?: number;
        connections?: number;
        uptime: number;
        transports?: {
            stdio: boolean;
            sse: boolean;
        };
    };
    /**
     * Get the HTTP server instance (for SSE transport)
     */
    getHttpServer(): Server | undefined;
    /**
     * Get the port number
     */
    getPort(): number;
}
/**
 * Create and configure a server manager
 */
export declare function createServerManager(logger: Logger, configManager: ConfigManager, transportManager: TransportManager, apiManager?: ApiManager): ServerManager;
/**
 * Server startup helper function
 */
export declare function startMcpServer(logger: Logger, configManager: ConfigManager, transportManager: TransportManager, apiManager?: ApiManager): Promise<ServerManager>;
