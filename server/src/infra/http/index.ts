// @lifecycle canonical - HTTP server bootstrap and orchestration entrypoint.
/**
 * Server Management Module
 * Handles HTTP server lifecycle, process management, and orchestration
 */

import { createServer, Server } from 'http';

import { ConfigLoader } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { TransportRouter, createTransportRouter, TransportType } from './transport/index.js';

import type { ApiRouterPort } from '#shared/types/index.js';
import type { Application } from 'express';

// Re-export transport types and utilities for external consumers
export { TransportRouter, createTransportRouter, TransportType };

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
          if (error.code === 'EADDRINUSE') {
            this.logger.error(`Port ${this.port} is already in use. HTTP transport disabled.`);
            // Don't reject - STDIO is still working
            resolve();
          } else {
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

      httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          this.logger.error(
            `Port ${this.port} is already in use. Please choose a different port or stop the other service.`
          );
        } else {
          this.logger.error('Server error:', error);
        }
        reject(error);
      });
    });
  }

  /**
   * Setup HTTP server event handlers
   */
  private setupHttpServerEventHandlers(): void {
    if (this.httpServer === undefined) return;

    this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        this.logger.error(
          `Port ${this.port} is already in use. Please choose a different port or stop the other service.`
        );
      } else {
        this.logger.error('Server error:', error);
      }
      process.exit(1);
    });

    this.httpServer.on('close', () => {
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
   * Graceful shutdown
   */
  shutdown(exitCode: number = 0): void {
    this.logger.info('Initiating graceful shutdown...');

    // Close HTTP server if running
    if (this.httpServer !== undefined) {
      this.httpServer.close((error) => {
        if (error !== undefined) {
          this.logger.error('Error closing HTTP server:', error);
        } else {
          this.logger.info('HTTP server closed successfully');
        }
        // Fire and forget - process.exit is called inside
        void this.finalizeShutdown(exitCode);
      });
    } else {
      // Fire and forget - process.exit is called inside
      void this.finalizeShutdown(exitCode);
    }
  }

  /**
   * Finalize shutdown process
   */
  private async finalizeShutdown(exitCode: number): Promise<void> {
    // Close transport connections
    const mode = this.transportRouter.getTransportType();
    if (mode === 'streamable-http' || mode === 'both') {
      await this.transportRouter.closeAllConnections();
    }

    this.logger.info('Server shutdown complete');
    process.exit(exitCode);
  }

  /**
   * Restart the server
   */
  async restart(reason: string = 'Manual restart'): Promise<void> {
    this.logger.info(`Restarting server: ${reason}`);

    try {
      // Shutdown current server
      if (this.httpServer !== undefined) {
        const httpServer = this.httpServer;
        await new Promise<void>((resolve) => {
          httpServer.close(() => {
            this.logger.info('Server closed for restart');
            resolve();
          });
        });
      }

      // Wait a moment before restarting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Start server again
      await this.startServer();

      this.logger.info('Server restarted successfully');
    } catch (error) {
      this.logger.error('Error during server restart:', error);
      throw error;
    }
  }

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

  /**
   * Get the HTTP server instance
   */
  getHttpServer(): Server | undefined {
    return this.httpServer;
  }

  /**
   * Get the port number
   */
  getPort(): number {
    return this.port;
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
