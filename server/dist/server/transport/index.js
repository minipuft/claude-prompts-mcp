// @lifecycle canonical - Sets up STDIO, SSE, and Streamable HTTP transports.
/**
 * Transport Management Module
 * Handles STDIO, SSE, and Streamable HTTP transport setup and lifecycle management
 */
import { randomUUID } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
/**
 * Transport types supported by the server
 */
export var TransportType;
(function (TransportType) {
    TransportType["STDIO"] = "stdio";
    TransportType["SSE"] = "sse";
    TransportType["STREAMABLE_HTTP"] = "streamable-http";
    TransportType["BOTH"] = "both";
})(TransportType || (TransportType = {}));
/**
 * Transport Manager class
 */
export class TransportManager {
    constructor(logger, configManager, mcpServer, transport) {
        this.sseTransports = new Map();
        this.streamableHttpTransports = new Map();
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
            // Validate CLI arg - include streamable-http
            if (value === 'stdio' ||
                value === 'sse' ||
                value === 'streamable-http' ||
                value === 'both') {
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
                // Get sessionId from query params - SSEServerTransport includes it in the endpoint URL
                const sessionId = req.query['sessionId'];
                for (const transport of transports) {
                    try {
                        // Use any available method to process the request
                        const sseTransport = transport;
                        // SSEServerTransport (MCP SDK) uses handlePostMessage method
                        if (typeof sseTransport.handlePostMessage === 'function') {
                            // Check if this transport matches the session (if provided)
                            if (sessionId && sseTransport._sessionId && sseTransport._sessionId !== sessionId) {
                                continue; // Not the right transport for this session
                            }
                            this.logger.debug('Using handlePostMessage method');
                            await sseTransport.handlePostMessage(req, res, req.body);
                            handled = true;
                        }
                        else if (typeof sseTransport.handleRequest === 'function') {
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
     * Setup Streamable HTTP transport with Express integration
     * This is the new MCP standard transport (replacing SSE)
     */
    setupStreamableHttpTransport(app) {
        this.logger.info('Setting up Streamable HTTP transport endpoints');
        // Single /mcp endpoint handles all HTTP methods (POST, GET, DELETE)
        const mcpHandler = async (req, res) => {
            const sessionId = req.headers['mcp-session-id'];
            try {
                let transport;
                if (sessionId) {
                    // Reuse existing transport for this session
                    transport = this.streamableHttpTransports.get(sessionId);
                    if (!transport) {
                        this.logger.warn(`No transport found for session ${sessionId}`);
                        res.status(404).json({
                            jsonrpc: '2.0',
                            error: { code: -32000, message: 'Session not found' },
                            id: null,
                        });
                        return;
                    }
                }
                else if (req.method === 'POST' && isInitializeRequest(req.body)) {
                    // New initialization request - create new transport
                    this.logger.info('New Streamable HTTP initialization request');
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (newSessionId) => {
                            this.logger.info(`Streamable HTTP session initialized: ${newSessionId}`);
                            this.streamableHttpTransports.set(newSessionId, transport);
                        },
                        onsessionclosed: (closedSessionId) => {
                            this.logger.info(`Streamable HTTP session closed: ${closedSessionId}`);
                            this.streamableHttpTransports.delete(closedSessionId);
                        },
                    });
                    // Set up cleanup handler
                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (sid) {
                            this.streamableHttpTransports.delete(sid);
                        }
                    };
                    // Connect to MCP server before handling request
                    await this.mcpServer.connect(transport);
                    await transport.handleRequest(req, res, req.body);
                    return;
                }
                else {
                    // Invalid request - no session ID and not initialization
                    this.logger.warn('Invalid request: no session ID and not initialization');
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
                        id: null,
                    });
                    return;
                }
                // Handle request with existing transport
                await transport.handleRequest(req, res, req.body);
            }
            catch (error) {
                this.logger.error('Error handling Streamable HTTP request:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: { code: -32603, message: 'Internal server error' },
                        id: null,
                    });
                }
            }
        };
        // Register routes for all HTTP methods on /mcp
        app.post('/mcp', express.json(), mcpHandler);
        app.get('/mcp', mcpHandler);
        app.delete('/mcp', mcpHandler);
        this.logger.info('Streamable HTTP transport ready at /mcp');
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
     * @deprecated SSE is deprecated, prefer streamable-http
     */
    isSse() {
        return this.transport === TransportType.SSE || this.transport === TransportType.BOTH;
    }
    /**
     * Check if Streamable HTTP transport should be active
     */
    isStreamableHttp() {
        return this.transport === TransportType.STREAMABLE_HTTP;
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
        return this.sseTransports.size + this.streamableHttpTransports.size;
    }
    /**
     * Get active Streamable HTTP sessions count
     */
    getActiveStreamableHttpSessionsCount() {
        return this.streamableHttpTransports.size;
    }
    /**
     * Close all active connections (SSE and Streamable HTTP)
     */
    async closeAllConnections() {
        this.logger.info(`Closing ${this.sseTransports.size} active SSE connections`);
        this.sseTransports.clear();
        this.logger.info(`Closing ${this.streamableHttpTransports.size} active Streamable HTTP sessions`);
        for (const [sessionId, transport] of this.streamableHttpTransports) {
            try {
                await transport.close();
            }
            catch (error) {
                this.logger.error(`Error closing Streamable HTTP session ${sessionId}:`, error);
            }
        }
        this.streamableHttpTransports.clear();
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