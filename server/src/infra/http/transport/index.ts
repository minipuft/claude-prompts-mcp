// @lifecycle canonical - Sets up STDIO and Streamable HTTP transports.
/**
 * Transport Management Module
 *
 * Handles STDIO and Streamable HTTP transport setup and lifecycle.
 *
 * How long a server instance lives differs between the two paths, and that
 * difference is the shape of this module under protocol revision 2026-07-28:
 *
 * - STDIO serves one long-lived `McpServer` for the life of the connection.
 *   `serveStdio` selects the era on the opening exchange and pins one instance
 *   from the factory for that connection.
 * - HTTP has no protocol session. `createMcpHandler` constructs a fresh server
 *   per request from the supplied factory, so nothing is retained between
 *   exchanges and there is no session registry to keep.
 *
 * The deprecated HTTP+SSE transport was removed alongside the SDK v2 upgrade,
 * which no longer ships `SSEServerTransport`.
 */

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import express from 'express';

import { Logger } from '../../logging/index.js';

import type { TransportMode } from '#shared/types/index.js';
import type { McpHttpHandler, McpServerFactory } from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

/**
 * Reject a transport that was removed, rather than quietly substituting one.
 *
 * Falling back to the configured default here would start the server on a
 * transport the operator did not ask for and report success — the `start:sse`
 * script did exactly that after the HTTP+SSE transport was deleted. A removed
 * option has to fail loudly enough to be fixed.
 *
 * `source` names where the value came from so the message points at the thing
 * to edit: a CLI flag or the config file.
 */
function assertTransportSupported(value: string, source: string): void {
  if (value === 'sse') {
    throw new Error(
      `${source}=sse is no longer supported: the HTTP+SSE transport was removed in the MCP SDK v2 ` +
        `upgrade. Use streamable-http instead.`
    );
  }
}

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
  private stdioServerFactory: McpServerFactory;
  private mcpServerFactory: McpServerFactory;
  private transport: TransportMode;
  private httpHandler?: McpHttpHandler;
  private stdioHandle?: StdioServerHandle;

  /**
   * Two factories, because the two transports pin instances differently:
   * `stdioServerFactory` is called once for the connection and its instance is
   * long-lived, while `mcpServerFactory` is called per HTTP request.
   */
  constructor(
    logger: Logger,
    stdioServerFactory: McpServerFactory,
    mcpServerFactory: McpServerFactory,
    transport: TransportMode
  ) {
    this.logger = logger;
    this.stdioServerFactory = stdioServerFactory;
    this.mcpServerFactory = mcpServerFactory;
    this.transport = transport;
  }

  /**
   * Narrow the transport value the caller already resolved at launch to a supported
   * `TransportMode`.
   *
   * Transport is launch-time-only (Ruling R30): `config.json` itself cannot select it — a
   * `server.transport` other than `"stdio"` refuses startup at load time, see
   * `ConfigLoader.loadConfig`. Row 4.13: this used to parse `--transport` out of a raw
   * `argv`-like array itself (`extractTransportArg`, a second, local copy of the parse
   * `runtime/cli.ts`'s `parseServerCliArgs` already owns) and fell back to a `configManager`
   * parameter's `getTransportMode()` when no flag was present. `infra/` cannot import
   * `parseServerCliArgs` — `runtime/` is the composition root and nothing below it may import it
   * (`.dependency-cruiser.cjs` `no-imports-into-runtime`) — so the fix is not a shared call, it is
   * one fewer parse: `resolveRuntimeLaunchOptions` (row 4.12) already resolves `--transport` once,
   * defaulting to `'stdio'` when the flag is absent (`RuntimeLaunchOptions.transport`), so both
   * callers (`runtime/context.ts`, `runtime/startup-server.ts`) now hand this method that value
   * directly instead of `args`/`process.argv`. The `configManager` fallback is gone with it: the
   * one case it ever answered — "no `--transport` flag was given" — is resolved before this
   * method runs, by the same default value this method used to fall back to.
   */
  static determineTransport(transport: string): TransportMode {
    assertTransportSupported(transport, '--transport');
    if (transport === 'stdio' || transport === 'streamable-http' || transport === 'both') {
      return transport;
    }
    // Use stderr to avoid corrupting STDIO protocol
    console.error(
      `[TransportRouter] Invalid --transport value: "${transport}". Using the default.`
    );
    return 'stdio';
  }

  /**
   * Setup STDIO transport.
   *
   * `serveStdio` owns the era decision for the connection: the opening exchange
   * selects the era, one instance from the factory is pinned for the connection
   * lifetime, and everything after passes through to it.
   *
   * Connecting an `McpServer` to a `StdioServerTransport` directly — the v1
   * pattern this replaces — leaves the connection permanently 2025-era. It
   * answers `tools/list` from a modern client because the protocol layer is
   * permissive, but `server/discover` and `subscriptions/listen` return
   * `-32601`, and the request `_meta` envelope is never lifted, so per-request
   * client identity is invisible.
   */
  setupStdioTransport(): void {
    this.logger.info('Starting server with STDIO transport');

    // Setup STDIO event handlers
    this.setupStdioEventHandlers();

    this.stdioHandle = serveStdio(this.stdioServerFactory, {
      onerror: (error: Error) => {
        this.logger.error('STDIO transport error:', error);
      },
    });

    this.logger.info(
      'STDIO transport connected successfully - server ready for MCP client connections'
    );
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

    // `onerror` is what makes a failed request say why it failed. The handler
    // answers a request it could not serve with `-32603 Internal server error`
    // and reports the cause through this callback only — it returns that
    // response rather than throwing, so `toNodeHandler`'s own `onerror` below
    // never sees these. Without it, a failure while building a request's server
    // was reported by nothing at all unless the failing stage happened to log
    // for itself: the request failed, the next one succeeded, and no line
    // anywhere named the cause.
    this.httpHandler = createMcpHandler(this.mcpServerFactory, {
      legacy: 'stateless',
      onerror: (error: Error) => {
        this.logger.error(
          `Streamable HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
        );
      },
    });

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
    if (this.stdioHandle) {
      this.logger.info('Closing STDIO connection');
      await this.stdioHandle.close();
      this.stdioHandle = undefined;
    }

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
  stdioServerFactory: McpServerFactory,
  mcpServerFactory: McpServerFactory,
  transport: TransportMode
): TransportRouter {
  return new TransportRouter(logger, stdioServerFactory, mcpServerFactory, transport);
}
