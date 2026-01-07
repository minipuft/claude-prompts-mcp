// @lifecycle canonical - HTTP server bootstrap and orchestration entrypoint.
/**
 * Server Management Module
 * Handles HTTP server lifecycle, process management, and orchestration
 */

import { createServer, Server } from 'http';

import { ApiManager } from '../api/index.js';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { TransportManager, createTransportManager, TransportType } from './transport/index.js';

// Re-export transport types and utilities for external consumers
export { TransportManager, createTransportManager, TransportType };

/**
 * Server Manager class
 */
export class ServerManager {
  private logger: Logger;
  private configManager: ConfigManager;
  private transportManager: TransportManager;
  private apiManager: ApiManager | undefined;
  private httpServer?: Server;
  private port: number;

  constructor(
    logger: Logger,
    configManager: ConfigManager,
    transportManager: TransportManager,
    apiManager?: ApiManager
  ) {
    this.logger = logger;
    this.configManager = configManager;
    this.transportManager = transportManager;
    this.apiManager = apiManager;
    this.port = configManager.getPort();
  }

  /**
   * Start the server based on transport mode
   * Supports 'stdio', 'sse', 'streamable-http', or 'both' modes
   */
  async startServer(): Promise<void> {
    try {
      const mode = this.transportManager.getTransportType();
      this.logger.info(`Starting server with '${mode}' transport mode`);

      this.logSystemInfo();

      if (this.transportManager.isBoth()) {
        // Dual transport mode: start both STDIO and SSE
        await this.startBothTransports();
      } else if (mode === 'stdio') {
        // STDIO only
        await this.startStdioServer();
      } else if (mode === 'sse') {
        // SSE only (deprecated, use streamable-http)
        await this.startSseServer();
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
   * Start server with both STDIO and SSE transports
   */
  private async startBothTransports(): Promise<void> {
    this.logger.info('Starting dual transport mode (STDIO + SSE)');

    // Start STDIO transport first
    await this.transportManager.setupStdioTransport();
    this.logger.info('STDIO transport ready');

    // Then start SSE transport if API manager is available
    if (this.apiManager !== undefined) {
      const app = this.apiManager.createApp();
      this.transportManager.setupSseTransport(app);
      this.httpServer = createServer(app);
      this.setupHttpServerEventHandlers();

      await new Promise<void>((resolve, reject) => {
        const httpServer = this.httpServer;
        if (httpServer === undefined) {
          reject(new Error('HTTP server not initialized'));
          return;
        }

        httpServer.listen(this.port, () => {
          this.logger.info(`SSE transport running on http://localhost:${this.port}`);
          this.logger.info(`Connect to http://localhost:${this.port}/mcp for SSE MCP connections`);
          resolve();
        });

        httpServer.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            this.logger.error(`Port ${this.port} is already in use. SSE transport disabled.`);
            // Don't reject - STDIO is still working
            resolve();
          } else {
            reject(error);
          }
        });
      });
    } else {
      this.logger.warn('API Manager not available - SSE transport disabled in dual mode');
    }
  }

  /**
   * Start server with STDIO transport
   */
  private async startStdioServer(): Promise<void> {
    // For STDIO, we don't need an HTTP server
    await this.transportManager.setupStdioTransport();
  }

  /**
   * Start server with SSE transport
   */
  private async startSseServer(): Promise<void> {
    if (this.apiManager === undefined) {
      throw new Error('API Manager is required for SSE transport');
    }

    // Create Express app
    const app = this.apiManager.createApp();

    // Setup SSE transport endpoints
    this.transportManager.setupSseTransport(app);

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

      httpServer.listen(this.port, () => {
        this.logger.info(`MCP Prompts Server running on http://localhost:${this.port}`);
        this.logger.info(`Connect to http://localhost:${this.port}/mcp for MCP connections`);
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
   * Start server with Streamable HTTP transport (MCP standard since 2025-03-26)
   * This is the preferred HTTP transport, replacing deprecated SSE
   */
  private async startStreamableHttpServer(): Promise<void> {
    if (this.apiManager === undefined) {
      throw new Error('API Manager is required for Streamable HTTP transport');
    }

    // Create Express app
    const app = this.apiManager.createApp();

    // Setup Streamable HTTP transport endpoints
    this.transportManager.setupStreamableHttpTransport(app);

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

      httpServer.listen(this.port, () => {
        this.logger.info(`MCP Prompts Server running on http://localhost:${this.port}`);
        this.logger.info(`Streamable HTTP transport ready at http://localhost:${this.port}/mcp`);
        this.logger.info(
          `Sessions: ${this.transportManager.getActiveStreamableHttpSessionsCount()}`
        );
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
    // Close transport connections (SSE and Streamable HTTP)
    const mode = this.transportManager.getTransportType();
    if (mode === 'sse' || mode === 'streamable-http' || mode === 'both') {
      await this.transportManager.closeAllConnections();
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
    const mode = this.transportManager.getTransportType();

    switch (mode) {
      case 'stdio':
        // For STDIO only, we consider it running if the process is alive
        return true;
      case 'sse':
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
    transports?: { stdio: boolean; sse: boolean; streamableHttp: boolean };
  } {
    const mode = this.transportManager.getTransportType();
    const isHttpActive =
      mode === 'sse' ||
      mode === 'streamable-http' ||
      (mode === 'both' && this.httpServer?.listening === true);

    const status: {
      running: boolean;
      transport: string;
      port?: number;
      connections?: number;
      sessions?: number;
      uptime: number;
      transports?: { stdio: boolean; sse: boolean; streamableHttp: boolean };
    } = {
      running: this.isRunning(),
      transport: mode,
      uptime: process.uptime(),
    };

    if (isHttpActive) {
      status.port = this.port;
      status.connections = this.transportManager.getActiveConnectionsCount();
    }

    if (mode === 'streamable-http') {
      status.sessions = this.transportManager.getActiveStreamableHttpSessionsCount();
    }

    if (mode === 'both') {
      status.transports = {
        stdio: true,
        sse: this.httpServer?.listening ?? false,
        streamableHttp: false, // 'both' mode currently only supports STDIO + SSE
      };
    }

    return status;
  }

  /**
   * Get the HTTP server instance (for SSE transport)
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
export function createServerManager(
  logger: Logger,
  configManager: ConfigManager,
  transportManager: TransportManager,
  apiManager?: ApiManager
): ServerManager {
  return new ServerManager(logger, configManager, transportManager, apiManager);
}

/**
 * Server startup helper function
 */
export async function startMcpServer(
  logger: Logger,
  configManager: ConfigManager,
  transportManager: TransportManager,
  apiManager?: ApiManager
): Promise<ServerManager> {
  const serverManager = createServerManager(logger, configManager, transportManager, apiManager);

  await serverManager.startServer();
  return serverManager;
}
