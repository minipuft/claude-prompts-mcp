// @lifecycle canonical - Sets up STDIO and SSE transports.
/**
 * Transport Management Module
 * Handles STDIO and SSE transport setup and lifecycle management
 */
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
/**
 * Transport types supported by the server
 */
export var TransportType;
(function (TransportType) {
    TransportType["STDIO"] = "stdio";
    TransportType["SSE"] = "sse";
    TransportType["BOTH"] = "both";
})(TransportType || (TransportType = {}));
/**
 * Transport Manager class
 */
export class TransportManager {
    constructor(logger, configManager, mcpServer, transport) {
        this.sseTransports = new Map();
        this.logger = logger;
        this.configManager = configManager;
        this.mcpServer = mcpServer;
        this.transport = transport;
    }
    /**
     * Determine transport mode from command line arguments or configuration
     * Priority: CLI args > config.transport > default (stdio)
     */
    static determineTransport(args, configManager) {
        // CLI argument takes highest priority
        const transportArg = args.find((arg) => arg.startsWith('--transport='));
        if (transportArg) {
            const value = transportArg.split('=')[1];
            // Validate CLI arg
            if (value === 'stdio' || value === 'sse' || value === 'both') {
                return value;
            }
            // Use stderr to avoid corrupting STDIO protocol
            console.error(`[TransportManager] Invalid --transport value: "${value}". Using config default.`);
        }
        // Fall back to config value
        return configManager.getTransportMode();
    }
    /**
     * Setup STDIO transport
     */
    async setupStdioTransport() {
        this.logger.info('Starting server with STDIO transport');
        // Create the STDIO transport - aligned with MCP SDK pattern
        const stdioTransport = new StdioServerTransport();
        // Setup STDIO event handlers
        this.setupStdioEventHandlers();
        // Connect the server to the transport - standard MCP SDK pattern
        try {
            await this.mcpServer.connect(stdioTransport);
            this.logger.info('STDIO transport connected successfully - server ready for MCP client connections');
            // Setup console redirection AFTER successful connection to avoid deadlock
            this.setupStdioConsoleRedirection();
        }
        catch (error) {
            this.logger.error('Error connecting to STDIO transport:', error);
            process.exit(1);
        }
    }
    /**
     * Setup console redirection for STDIO transport
     */
    setupStdioConsoleRedirection() {
        // Ensure we don't mix log messages with JSON messages
        // Note: Console redirection is removed - use logger directly
        // This prevents interference with MCP JSON protocol
    }
    /**
     * Setup STDIO event handlers
     */
    setupStdioEventHandlers() {
        // Log when the stdin closes (which happens when the parent process terminates)
        process.stdin.on('end', () => {
            this.logger.info('STDIN stream ended - parent process may have terminated');
            process.exit(0);
        });
    }
    /**
     * Setup SSE transport with Express integration
     */
    setupSseTransport(app) {
        this.logger.info('Setting up SSE transport endpoints');
        // SSE endpoint for MCP connections
        app.get('/mcp', async (req, res) => {
            this.logger.info('New SSE connection from ' + req.ip);
            // Set headers for SSE
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Issues with certain proxies
            // Create a unique ID for this connection
            const connectionId = Date.now().toString();
            // Create a new transport for this connection
            const sseTransport = new SSEServerTransport('/messages', res);
            this.sseTransports.set(connectionId, sseTransport);
            // Log connection data for debugging
            this.logger.debug('Connection headers:', req.headers);
            // Remove the transport when the connection is closed
            res.on('close', () => {
                this.logger.info(`SSE connection ${connectionId} closed`);
                this.sseTransports.delete(connectionId);
            });
            try {
                await this.mcpServer.connect(sseTransport);
                this.logger.info(`SSE transport ${connectionId} connected successfully`);
            }
            catch (error) {
                this.logger.error('Error connecting to SSE transport:', error);
                this.sseTransports.delete(connectionId);
                res.status(500).end();
            }
        });
        // Messages endpoint for SSE transport
        app.post('/messages', express.json(), async (req, res) => {
            this.logger.debug('Received message:', req.body);
            try {
                // Try to handle the request with each transport
                const transports = Array.from(this.sseTransports.values());
                if (transports.length === 0) {
                    this.logger.error('No active SSE connections found');
                    return res.status(503).json({ error: 'No active SSE connections' });
                }
                let handled = false;
                let lastError = null;
                for (const transport of transports) {
                    try {
                        // Use any available method to process the request
                        const sseTransport = transport;
                        if (typeof sseTransport.handleRequest === 'function') {
                            this.logger.debug('Using handleRequest method');
                            handled = await sseTransport.handleRequest(req, res);
                        }
                        else if (typeof sseTransport.processRequest === 'function') {
                            this.logger.debug('Using processRequest method');
                            handled = await sseTransport.processRequest(req, res);
                        }
                        if (handled) {
                            this.logger.debug('Request handled successfully');
                            break;
                        }
                    }
                    catch (e) {
                        lastError = e;
                        this.logger.error('Error processing request with transport:', e);
                    }
                }
                if (!handled) {
                    this.logger.error('No transport handled the request');
                    if (lastError) {
                        this.logger.error('Last error:', lastError);
                    }
                    return res.status(404).json({ error: 'No matching transport found' });
                }
                // Request was handled successfully by transport - response already sent
                return;
            }
            catch (error) {
                this.logger.error('Error handling message:', error);
                return res.status(500).json({
                    error: 'Internal server error',
                    details: error instanceof Error ? error.message : String(error),
                });
            }
        });
    }
    /**
     * Get transport mode
     */
    getTransportType() {
        return this.transport;
    }
    /**
     * Check if STDIO transport should be active
     * True for 'stdio' or 'both' modes
     */
    isStdio() {
        return this.transport === TransportType.STDIO || this.transport === TransportType.BOTH;
    }
    /**
     * Check if SSE transport should be active
     * True for 'sse' or 'both' modes
     */
    isSse() {
        return this.transport === TransportType.SSE || this.transport === TransportType.BOTH;
    }
    /**
     * Check if running in dual transport mode
     */
    isBoth() {
        return this.transport === TransportType.BOTH;
    }
    /**
     * Get active SSE connections count
     */
    getActiveConnectionsCount() {
        return this.sseTransports.size;
    }
    /**
     * Close all active SSE connections
     */
    closeAllConnections() {
        this.logger.info(`Closing ${this.sseTransports.size} active SSE connections`);
        this.sseTransports.clear();
    }
}
/**
 * Create and configure a transport manager
 */
export function createTransportManager(logger, configManager, mcpServer, transport) {
    const transportManager = new TransportManager(logger, configManager, mcpServer, transport);
    return transportManager;
}
//# sourceMappingURL=index.js.map