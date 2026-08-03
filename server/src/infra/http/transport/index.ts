// @lifecycle canonical - Sets up STDIO and Streamable HTTP transports.
/**
 * Transport Management Module
 *
 * Handles STDIO and Streamable HTTP transport setup and lifecycle.
 *
 * How long a server instance lives differs between the two paths, and that
 * difference is the shape of this module under protocol revision 2026-07-28:
 *
 * - STDIO serves one long-lived `McpServer` for the life of the connection, so
 *   it holds a direct reference and connects it to a `StdioServerTransport`.
 * - HTTP has no protocol session. `createMcpHandler` constructs a fresh server
 *   per request from the supplied factory, so nothing is retained between
 *   exchanges and there is no session registry to keep.
 *
 * The deprecated HTTP+SSE transport was removed alongside the SDK v2 upgrade,
 * which no longer ships `SSEServerTransport`.
 */

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import express from 'express';

import { ConfigLoader } from '../../config/index.js';
import { Logger } from '../../logging/index.js';

import type { TransportMode } from '#shared/types/index.js';
import type { McpHttpHandler, McpServer, McpServerFactory } from '@modelcontextprotocol/server';

/**
 * Transport types supported by the server
 */
export enum TransportType {
  STDIO = 'stdio',
  STREAMABLE_HTTP = 'streamable-http',
  BOTH = 'both',
}

/**
 * Transport Manager class
 */
export class TransportRouter {
  private logger: Logger;
  private mcpServer: McpServer;
  private mcpServerFactory: McpServerFactory;
  private transport: TransportMode;
  private httpHandler?: McpHttpHandler;

  constructor(
    logger: Logger,
    mcpServer: McpServer,
    mcpServerFactory: McpServerFactory,
    transport: TransportMode
  ) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.mcpServerFactory = mcpServerFactory;
    this.transport = transport;
  }

  /**
   * Determine transport mode from command line arguments or configuration
   * Priority: CLI args > config.transport > default (stdio)
   */
  static determineTransport(args: string[], configManager: ConfigLoader): TransportMode {
    // CLI argument takes highest priority
    const transportArg = args.find((arg: string) => arg.startsWith('--transport='));
    if (transportArg) {
      const value = transportArg.split('=')[1];
      if (value === 'stdio' || value === 'streamable-http' || value === 'both') {
        return value;
      }
      const reason =
        value === 'sse'
          ? 'The HTTP+SSE transport was removed. Use --transport=streamable-http.'
          : `Invalid --transport value: "${value}". Using config default.`;
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[TransportRouter] ${reason}`);
    }

    // Fall back to config value
    return configManager.getTransportMode();
  }

  /**
   * Setup STDIO transport
   */
  async setupStdioTransport(): Promise<void> {
    this.logger.info('Starting server with STDIO transport');

    // Create the STDIO transport - aligned with MCP SDK pattern
    const stdioTransport = new StdioServerTransport();

    // Setup STDIO event handlers
    this.setupStdioEventHandlers();

    // Connect the server to the transport - standard MCP SDK pattern
    try {
      await this.mcpServer.connect(stdioTransport);
      this.logger.info(
        'STDIO transport connected successfully - server ready for MCP client connections'
      );
    } catch (error) {
      this.logger.error('Error connecting to STDIO transport:', error);
      process.exit(1);
    }
  }

  /**
   * Setup STDIO event handlers
   */
  private setupStdioEventHandlers(): void {
    // Log when the stdin closes (which happens when the parent process terminates)
    process.stdin.on('end', () => {
      this.logger.info('STDIN stream ended - parent process may have terminated');
      process.exit(0);
    });
  }

  /**
   * Setup Streamable HTTP transport with Express integration.
   *
   * `legacy: 'stateless'` keeps 2025-era clients working — they are served
   * per-request through the stateless fallback rather than rejected, so one
   * build answers both protocol revisions.
   */
  setupStreamableHttpTransport(app: express.Application): void {
    this.logger.info('Setting up Streamable HTTP transport endpoints');

    this.httpHandler = createMcpHandler(this.mcpServerFactory, { legacy: 'stateless' });

    // `toNodeHandler` converts the Node request to a web-standard Request, calls
    // the handler, then writes the Response back, honoring SSE backpressure.
    const nodeHandler = toNodeHandler(this.httpHandler, {
      onerror: (error: unknown) => {
        this.logger.error('Error handling Streamable HTTP request:', error);
      },
    });

    // The API app installs `express.json()` globally, so the raw request stream
    // is already drained by the time this runs and the adapter would parse an
    // empty body. Hand it the parsed body instead. `toNodeHandler` ignores a
    // function third argument, so Express's `next` cannot fill this slot for us.
    // GET and DELETE carry no body, and express's `{}` placeholder would be read
    // as an empty JSON-RPC message — pass undefined so the adapter sees none.
    const mcpHandler = (req: express.Request, res: express.Response): void => {
      void nodeHandler(req, res, req.method === 'POST' ? req.body : undefined);
    };

    // Single /mcp endpoint handles all HTTP methods (POST, GET, DELETE)
    app.post('/mcp', mcpHandler);
    app.get('/mcp', mcpHandler);
    app.delete('/mcp', mcpHandler);

    this.logger.info('Streamable HTTP transport ready at /mcp');
  }

  /**
   * Publish-side facade over `subscriptions/listen`, available once HTTP is set
   * up. Undefined on the STDIO-only path, where clients are notified through
   * the connected server instance instead.
   */
  getHttpHandler(): McpHttpHandler | undefined {
    return this.httpHandler;
  }

  /**
   * Get transport mode
   */
  getTransportType(): TransportMode {
    return this.transport;
  }

  /**
   * Check if STDIO transport should be active
   * True for 'stdio' or 'both' modes
   */
  isStdio(): boolean {
    return this.transport === TransportType.STDIO || this.transport === TransportType.BOTH;
  }

  /**
   * Check if Streamable HTTP transport should be active
   * True for 'streamable-http' or 'both' modes
   */
  isStreamableHttp(): boolean {
    return (
      this.transport === TransportType.STREAMABLE_HTTP || this.transport === TransportType.BOTH
    );
  }

  /**
   * Check if running in dual transport mode
   */
  isBoth(): boolean {
    return this.transport === TransportType.BOTH;
  }

  /**
   * Close the HTTP handler's modern leg — aborts in-flight exchanges and closes
   * their per-request instances. Legacy serving needs no teardown; it is
   * per-request by construction and holds nothing between exchanges.
   */
  async closeAllConnections(): Promise<void> {
    if (!this.httpHandler) {
      return;
    }
    this.logger.info('Closing Streamable HTTP handler');
    await this.httpHandler.close();
    this.httpHandler = undefined;
  }
}

/**
 * Create and configure a transport manager
 */
export function createTransportRouter(
  logger: Logger,
  mcpServer: McpServer,
  mcpServerFactory: McpServerFactory,
  transport: TransportMode
): TransportRouter {
  return new TransportRouter(logger, mcpServer, mcpServerFactory, transport);
}
