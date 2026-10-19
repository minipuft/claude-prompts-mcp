// @lifecycle canonical - HTTP server bootstrap and orchestration entrypoint.
/**
 * Server Management Module
 * Handles HTTP server lifecycle, process management, and orchestration
 */

import { createServer, Server } from 'http';

import { ConfigLoader } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { TransportRouter, createTransportRouter } from './transport/index.js';

import type { ApiRouterPort } from '#shared/types/index.js';
import type { Application } from 'express';

// Re-export transport types and utilities for external consumers
export { TransportRouter, createTransportRouter };

/**
 * Server Manager class
 */
/**
 * Loopback by default; `0.0.0.0` only when the operator asks for it by name.
 *
 * `listen(port)` with no host binds every interface, which put this server on the LAN
 * while both startup log lines claimed `http://localhost:PORT` — the log asserted the
 * safer of the two behaviours. The MCP Streamable HTTP transport says a local server
 * SHOULD bind 127.0.0.1 rather than all interfaces, and the previous default was the
 * opposite of that with nothing recording the choice.
 */
function resolveBindHost(): string {
  const configured = process.env['MCP_HTTP_HOST']?.trim();
  return configured === undefined || configured.length === 0 ? '127.0.0.1' : configured;
}

/** A non-loopback bind is legitimate behind a proxy, and always worth saying out loud. */
function warnIfPubliclyBound(logger: Logger, host: string): void {
  const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
  if (loopback.has(host)) return;

  logger.warn(
    `[http] bound to ${host}, which is reachable beyond this machine. Ensure ` +
      `MCP_HTTP_ALLOWED_ORIGINS names the origins you expect and that the tool write ` +
      `endpoints have MCP_CATALOG_WRITE_TOKEN set.`
  );
}

export class ServerLifecycle {
  private logger: Logger;
  private transportRouter: TransportRouter;
  private apiRouter: ApiRouterPort | undefined;
  private httpServer?: Server;
  private port: number;
  private bindHost: string;

  constructor(
    logger: Logger,
    configManager: ConfigLoader,
    transportRouter: TransportRouter,
    apiRouter?: ApiRouterPort
  ) {
    this.logger = logger;
    this.transportRouter = transportRouter;
    this.apiRouter = apiRouter;
    this.port = configManager.getPort();
    this.bindHost = resolveBindHost();
  }

  /**
   * Start the server based on transport mode
   * Supports 'stdio', 'streamable-http', or 'both' modes
   */
  async startServer(): Promise<void> {
    try {
      const mode = this.transportRouter.getTransportType();
      this.logger.info(`Starting server with '${mode}' transport mode`);

      this.logSystemInfo();

      if (this.transportRouter.isBoth()) {
        // Dual transport mode: start both STDIO and Streamable HTTP
        await this.startBothTransports();
      } else if (mode === 'stdio') {
        // STDIO only
        await this.startStdioServer();
      } else if (mode === 'streamable-http') {
        // Streamable HTTP (MCP standard since 2025-03-26)
        await this.startStreamableHttpServer();
      } else {
        throw new Error(`Unsupported transport mode: ${mode}`);
      }

      this.logger.info('Server started successfully');
    } catch (error) {
      this.logger.error('Error starting server:', error);
      throw error;
    }
  }

  /**
   * Start server with both STDIO and Streamable HTTP transports
   */
  private async startBothTransports(): Promise<void> {
    this.logger.info('Starting dual transport mode (STDIO + Streamable HTTP)');

    // Start STDIO transport first
    this.transportRouter.setupStdioTransport();
    this.logger.info('STDIO transport ready');

    // Then start Streamable HTTP if API manager is available
    if (this.apiRouter !== undefined) {
      const app = this.apiRouter.createApp() as Application;
      this.transportRouter.setupStreamableHttpTransport(app);
      this.httpServer = createServer(app);
      this.setupHttpServerEventHandlers();

      await new Promise<void>((resolve, reject) => {
        const httpServer = this.httpServer;
        if (httpServer === undefined) {
          reject(new Error('HTTP server not initialized'));
          return;
        }

        httpServer.listen(this.port, this.bindHost, () => {
          this.logger.info(`Streamable HTTP running on http://${this.bindHost}:${this.port}`);
          this.logger.info(
            `Connect to http://${this.bindHost}:${this.port}/mcp for MCP connections`
          );
          warnIfPubliclyBound(this.logger, this.bindHost);
          resolve();
        });

        httpServer.on('error', (error: NodeJS.ErrnoException) => {
          if (httpServer.listening) {
            this.logger.error('HTTP server error:', error);
          } else if (error.code === 'EADDRINUSE') {
            // STDIO is already serving; losing the HTTP listener must not take it down.
            this.logger.warn(
              `Port ${this.port} is already in use. HTTP transport disabled; STDIO keeps serving.`
            );
            resolve();
          } else {
            this.logger.error('HTTP server failed to start:', error);
            reject(error);
          }
        });
      });
    } else {
      this.logger.warn('API Manager not available - HTTP transport disabled in dual mode');
    }
  }

  /**
   * Start server with STDIO transport
   */
  private async startStdioServer(): Promise<void> {
    // For STDIO, we don't need an HTTP server
    this.transportRouter.setupStdioTransport();
  }

  /**
   * Start server with Streamable HTTP transport (MCP standard since 2025-03-26)
   * This is the MCP standard HTTP transport
   */
  private async startStreamableHttpServer(): Promise<void> {
    if (this.apiRouter === undefined) {
      throw new Error('API Manager is required for Streamable HTTP transport');
    }

    // Create Express app
    const app = this.apiRouter.createApp() as Application;

    // Setup Streamable HTTP transport endpoints
    this.transportRouter.setupStreamableHttpTransport(app);

    // Create HTTP server
    this.httpServer = createServer(app);

    // Setup HTTP server event handlers
    this.setupHttpServerEventHandlers();

    // Start listening
    await new Promise<void>((resolve, reject) => {
      const httpServer = this.httpServer;
      if (httpServer === undefined) {
        reject(new Error('HTTP server not initialized'));
        return;
      }

      httpServer.listen(this.port, this.bindHost, () => {
        this.logger.info(`MCP Prompts Server running on http://${this.bindHost}:${this.port}`);
        this.logger.info(
          `Streamable HTTP transport ready at http://${this.bindHost}:${this.port}/mcp`
        );
        warnIfPubliclyBound(this.logger, this.bindHost);
        resolve();
      });

      // HTTP is the only transport here, so a listener that cannot bind fails startup; the
      // application's startup failure path owns the non-zero exit.
      httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (httpServer.listening) {
          this.logger.error('HTTP server error:', error);
          return;
        }
        if (error.code === 'EADDRINUSE') {
          this.logger.error(
            `Port ${this.port} is already in use. Please choose a different port or stop the other service.`
          );
        } else {
          this.logger.error('HTTP server failed to start:', error);
        }
        reject(error);
      });
    });
  }

  /**
   * Log the listener closing. Listen errors are decided where each transport mode starts the
   * listener, because the modes disagree: dual mode survives a taken port, HTTP-only cannot.
   */
  private setupHttpServerEventHandlers(): void {
    this.httpServer?.on('close', () => {
      this.logger.info('HTTP server closed');
    });
  }

  /**
   * Log system information
   */
  private logSystemInfo(): void {
    this.logger.info(`Server process memory usage: ${JSON.stringify(process.memoryUsage())}`);
    this.logger.info(`Process ID: ${process.pid}`);
    this.logger.info(`Node version: ${process.version}`);
    this.logger.info(`Working directory: ${process.cwd()}`);
  }

  /**
   * Close every transport connection, then the HTTP listener.
   *
   * Exits nothing: the process exit belongs to the one graceful shutdown path in `src/index.ts`,
   * which still has stores to flush and the database to close after this returns. Exiting here
   * cut that path off on STDIO, where no listener close deferred it. Connections close first,
   * because `Server.close()` waits for open exchanges and a stream the transport has not
   * aborted would hold it open.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Initiating graceful shutdown...');
    await this.transportRouter.closeAllConnections();
    await this.closeHttpServer();
    this.logger.info('Server shutdown complete');
  }

  /**
   * Stop the listener. A server that never bound (dual mode with its port taken) has nothing
   * to close, and `close()` on it would fail with ERR_SERVER_NOT_RUNNING.
   */
  private closeHttpServer(): Promise<void> {
    const httpServer = this.httpServer;
    if (httpServer?.listening !== true) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        this.logger.info('HTTP server closed successfully');
        resolve();
      });
    });
  }

  // `restart()` lived here and was deleted 2026-09-21 (P4.91). `Application.restartServer`
  // answers the same question — restart this server — and is the one a user can reach, through
  // `system_control`'s `maintenance` action. It is also the only strategy that holds for every
  // transport: this one closed the HTTP listener and called `startServer()` again, which under
  // STDIO or dual transport would have connected a second transport to a server that never
  // stopped serving on the first.

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    const mode = this.transportRouter.getTransportType();

    switch (mode) {
      case 'stdio':
        // For STDIO only, we consider it running if the process is alive
        return true;
      case 'streamable-http':
        // For HTTP transports, check if HTTP server is listening
        return this.httpServer?.listening ?? false;
      case 'both':
        // For dual mode, STDIO is always running; HTTP might be optional
        return true;
      default:
        return false;
    }
  }

  /**
   * Get server status information
   */
  getStatus(): {
    running: boolean;
    transport: string;
    port?: number;
    connections?: number;
    sessions?: number;
    uptime: number;
    transports?: { stdio: boolean; streamableHttp: boolean };
  } {
    const mode = this.transportRouter.getTransportType();
    const isHttpActive =
      mode === 'streamable-http' || (mode === 'both' && this.httpServer?.listening === true);

    const status: {
      running: boolean;
      transport: string;
      port?: number;
      connections?: number;
      sessions?: number;
      uptime: number;
      transports?: { stdio: boolean; streamableHttp: boolean };
    } = {
      running: this.isRunning(),
      transport: mode,
      uptime: process.uptime(),
    };

    if (isHttpActive) {
      status.port = this.port;
    }

    if (mode === 'both') {
      status.transports = {
        stdio: true,
        streamableHttp: this.httpServer?.listening ?? false,
      };
    }

    return status;
  }
}

/**
 * Create and configure a server manager
 */
export function createServerLifecycle(
  logger: Logger,
  configManager: ConfigLoader,
  transportRouter: TransportRouter,
  apiRouter?: ApiRouterPort
): ServerLifecycle {
  return new ServerLifecycle(logger, configManager, transportRouter, apiRouter);
}

/**
 * Server startup helper function
 */
export async function startMcpServer(
  logger: Logger,
  configManager: ConfigLoader,
  transportRouter: TransportRouter,
  apiRouter?: ApiRouterPort
): Promise<ServerLifecycle> {
  const serverLifecycle = createServerLifecycle(logger, configManager, transportRouter, apiRouter);

  await serverLifecycle.startServer();
  return serverLifecycle;
}
