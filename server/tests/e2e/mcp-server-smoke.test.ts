/**
 * MCP Server Smoke Tests
 *
 * Validates that the MCP server starts correctly and responds to basic requests.
 * This ensures the server entry point works for both Claude Code and Gemini CLI.
 */

import { describe, expect, it, afterEach, beforeAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import {
  getAvailablePort,
  startServerWithHttp,
  waitForHealth,
  sendMcpRequestWithSse,
  killServer,
  StreamableHttpMcpClient,
  httpPost,
  PROJECT_ROOT as HTTP_PROJECT_ROOT,
  SERVER_PATH as HTTP_SERVER_PATH,
} from './helpers/http-mcp-client.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SERVER_PATH = path.join(PROJECT_ROOT, 'server', 'dist', 'index.js');

// Keep track of spawned processes for cleanup
let serverProcess: ChildProcess | null = null;
let httpServerProcess: ChildProcess | null = null;
let httpServerPort: number | null = null;
let streamableHttpServerProcess: ChildProcess | null = null;
let streamableHttpServerPort: number | null = null;

/**
 * Helper to spawn MCP server with proper env
 */
function spawnServer(): ChildProcess {
  return spawn('node', [SERVER_PATH, '--transport=stdio', '--quiet'], {
    cwd: path.join(PROJECT_ROOT, 'server'),
    env: {
      ...process.env,
      MCP_WORKSPACE: PROJECT_ROOT,
      MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Helper to send JSON-RPC request and wait for response
 */
async function sendRequest(
  proc: ChildProcess,
  request: object,
  expectedId: number,
  timeoutMs = 5000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to request ${expectedId}`));
    }, timeoutMs);

    let buffer = '';

    const onData = (data: Buffer) => {
      const chunk = data.toString();
      buffer += chunk;

      // Try to parse complete lines
      const lines = buffer.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === expectedId) {
            clearTimeout(timer);
            proc.stdout?.off('data', onData);
            if (parsed.error) {
              reject(new Error(parsed.error.message));
            } else {
              resolve(parsed.result);
            }
            return;
          }
        } catch {
          // Not complete JSON yet, continue buffering
        }
      }
    };

    // IMPORTANT: Attach listener BEFORE writing to stdin
    proc.stdout?.on('data', onData);

    // Small delay to ensure listener is attached
    setImmediate(() => {
      proc.stdin?.write(JSON.stringify(request) + '\n');
    });
  });
}

describe('MCP Server Smoke Tests', () => {
  afterEach(async () => {
    // Clean up STDIO server
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      serverProcess = null;
    }
    // Clean up HTTP server
    if (httpServerProcess) {
      await killServer(httpServerProcess);
      httpServerProcess = null;
      httpServerPort = null;
    }
    // Clean up Streamable HTTP server
    if (streamableHttpServerProcess) {
      await killServer(streamableHttpServerProcess);
      streamableHttpServerProcess = null;
      streamableHttpServerPort = null;
    }
  });

  describe('Server Entry Point', () => {
    it('server/dist/index.js exists', async () => {
      await fs.access(SERVER_PATH);
      expect(true).toBe(true);
    });

    it('server/dist/index.js is a valid JavaScript file', async () => {
      const content = await fs.readFile(SERVER_PATH, 'utf-8');
      expect(
        content.startsWith('#!') ||
          content.includes('import ') ||
          content.includes('export ') ||
          content.includes('require(')
      ).toBe(true);
    });
  });

  describe('Server Startup', () => {
    it(
      'server starts without immediate crash',
      async () => {
        serverProcess = spawnServer();

        // Wait for process to either crash or stay running
        const result = await Promise.race([
          // Success: process stays alive for 1 second
          new Promise<'running'>((resolve) => setTimeout(() => resolve('running'), 1000)),
          // Failure: process exits with error
          new Promise<'crashed'>((resolve, reject) => {
            serverProcess!.on('exit', (code) => {
              if (code !== null && code !== 0) {
                reject(new Error(`Server crashed with exit code ${code}`));
              }
            });
            serverProcess!.on('error', (err) => reject(err));
          }),
        ]);

        expect(result).toBe('running');
      },
      5000
    );

    // TODO: Jest ESM mode has issues with spawned process stdio capture
    // The server responds correctly when tested manually (see npm run start:test)
    // Skip for now until we can debug the Jest/ESM/spawn interaction
    it.skip(
      'server responds to MCP initialize request',
      async () => {
        serverProcess = spawnServer();

        // Give server time to fully initialize (it has multiple startup phases)
        await new Promise((r) => setTimeout(r, 2000));

        const result = await sendRequest(
          serverProcess,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'e2e-test', version: '1.0.0' },
            },
          },
          1
        );

        expect(result).toHaveProperty('protocolVersion');
        expect(result).toHaveProperty('serverInfo');
        expect((result as { serverInfo: { name: string } }).serverInfo).toHaveProperty('name');
      },
      10000
    );
  });

  describe('Expected Tools Registration (STDIO - skipped)', () => {
    // TODO: Jest ESM mode has issues with spawned process stdio capture
    // The server responds correctly when tested manually (see npm run start:test)
    // Skip for now - covered by HTTP transport tests below
    it.skip(
      'server registers expected MCP tools via STDIO',
      async () => {
        serverProcess = spawnServer();

        // Give server time to fully initialize (it has multiple startup phases)
        await new Promise((r) => setTimeout(r, 2000));

        // Initialize first
        await sendRequest(
          serverProcess,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'e2e-test', version: '1.0.0' },
            },
          },
          1
        );

        // Send initialized notification
        serverProcess.stdin?.write(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          }) + '\n'
        );

        await new Promise((r) => setTimeout(r, 100));

        // List tools
        const result = (await sendRequest(
          serverProcess,
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          },
          2
        )) as { tools: Array<{ name: string }> };

        expect(Array.isArray(result.tools)).toBe(true);

        const toolNames = result.tools.map((t) => t.name);
        expect(toolNames).toContain('prompt_engine');
        expect(toolNames).toContain('resource_manager');
        expect(toolNames).toContain('system_control');
      },
      15000
    );
  });

  /**
   * HTTP Transport Tests
   *
   * These tests use HTTP/SSE transport instead of STDIO to avoid
   * Jest/ESM/spawn stdio capture issues.
   */
  describe('MCP Protocol via HTTP Transport', () => {
    it(
      'server responds to MCP initialize request via HTTP',
      async () => {
        // Get available port
        httpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${httpServerPort}`;

        // Start server with SSE transport
        httpServerProcess = startServerWithHttp(httpServerPort, { debug: true });

        // Wait for health endpoint (server takes ~5s to initialize)
        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Send initialize request via SSE
        const result = await sendMcpRequestWithSse(
          baseUrl,
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '1.0.0' },
          },
          1,
          { timeout: 10000 }
        );

        expect(result).toHaveProperty('protocolVersion');
        expect(result).toHaveProperty('serverInfo');
        expect((result as { serverInfo: { name: string } }).serverInfo).toHaveProperty('name');
      },
      20000
    );

    it(
      'server registers expected MCP tools via HTTP',
      async () => {
        // Get available port
        httpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${httpServerPort}`;

        // Start server with SSE transport
        httpServerProcess = startServerWithHttp(httpServerPort, { debug: true });

        // Wait for health endpoint (server takes ~5s to initialize)
        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Initialize first
        await sendMcpRequestWithSse(
          baseUrl,
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '1.0.0' },
          },
          1,
          { timeout: 10000 }
        );

        // List tools
        const result = (await sendMcpRequestWithSse(
          baseUrl,
          'tools/list',
          {},
          2,
          { timeout: 10000 }
        )) as { tools: Array<{ name: string }> };

        expect(Array.isArray(result.tools)).toBe(true);

        const toolNames = result.tools.map((t) => t.name);
        expect(toolNames).toContain('prompt_engine');
        expect(toolNames).toContain('resource_manager');
        expect(toolNames).toContain('system_control');
      },
      20000
    );
  });

  /**
   * Streamable HTTP Transport Tests
   *
   * Tests the new MCP standard transport (since 2025-03-26):
   * - Single /mcp endpoint for POST, GET, DELETE
   * - Session management via mcp-session-id header
   * - Stateful session mode with session ID generator
   */
  describe('MCP Protocol via Streamable HTTP Transport', () => {
    it(
      'server starts with streamable-http transport',
      async () => {
        // Get available port
        streamableHttpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${streamableHttpServerPort}`;

        // Start server with streamable-http transport
        streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
          transport: 'streamable-http',
          debug: true,
        });

        // Wait for health endpoint (server takes ~5s to initialize)
        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Server started successfully
        expect(streamableHttpServerProcess.killed).toBe(false);
      },
      20000
    );

    it(
      'server responds to MCP initialize request via Streamable HTTP',
      async () => {
        // Get available port
        streamableHttpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${streamableHttpServerPort}`;

        // Start server with streamable-http transport
        streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
          transport: 'streamable-http',
          debug: true,
        });

        // Wait for health endpoint (server takes ~5s to initialize)
        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Create Streamable HTTP client and initialize
        const client = new StreamableHttpMcpClient(baseUrl);
        const { sessionId, capabilities } = await client.initialize();

        // Should have a session ID
        expect(sessionId).toBeTruthy();
        expect(typeof sessionId).toBe('string');

        // Should have MCP capabilities
        expect(capabilities).toHaveProperty('protocolVersion');
        expect(capabilities).toHaveProperty('serverInfo');
        expect((capabilities as { serverInfo: { name: string } }).serverInfo).toHaveProperty(
          'name'
        );

        await client.close();
      },
      20000
    );

    it(
      'server registers expected MCP tools via Streamable HTTP',
      async () => {
        // Get available port
        streamableHttpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${streamableHttpServerPort}`;

        // Start server with streamable-http transport
        streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
          transport: 'streamable-http',
          debug: true,
        });

        // Wait for health endpoint (server takes ~5s to initialize)
        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Create client and initialize
        const client = new StreamableHttpMcpClient(baseUrl);
        await client.initialize();

        // List tools
        const result = (await client.request('tools/list', {}, 2)) as {
          tools: Array<{ name: string }>;
        };

        expect(Array.isArray(result.tools)).toBe(true);

        const toolNames = result.tools.map((t) => t.name);
        expect(toolNames).toContain('prompt_engine');
        expect(toolNames).toContain('resource_manager');
        expect(toolNames).toContain('system_control');

        await client.close();
      },
      20000
    );

    it(
      'session returns unique session ID via Streamable HTTP',
      async () => {
        // Get available port
        streamableHttpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${streamableHttpServerPort}`;

        // Start server with streamable-http transport
        streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
          transport: 'streamable-http',
          debug: true,
        });

        // Wait for health endpoint (server initialization takes time)
        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Create client and verify session ID is returned
        const client = new StreamableHttpMcpClient(baseUrl);
        const { sessionId } = await client.initialize();

        // Session ID should be a valid UUID format
        expect(sessionId).toBeTruthy();
        expect(typeof sessionId).toBe('string');
        expect(sessionId.length).toBeGreaterThan(0);

        // Verify client can make requests with the session
        const result = (await client.request('tools/list', {}, 2)) as {
          tools: Array<{ name: string }>;
        };
        expect(Array.isArray(result.tools)).toBe(true);

        await client.close();
      },
      25000
    );

    /**
     * MCP Spec Compliance: 400 Bad Request without session ID
     * Per spec: "Servers that require a session ID SHOULD respond to requests
     * without an Mcp-Session-Id header (other than initialization) with HTTP 400"
     */
    it(
      'returns 400 Bad Request for non-init request without session ID',
      async () => {
        streamableHttpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${streamableHttpServerPort}`;

        streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
          transport: 'streamable-http',
          debug: true,
        });

        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Send a tools/list request WITHOUT session ID (not an init request)
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        };

        const response = await httpPost(`${baseUrl}/mcp`, request, {
          Accept: 'application/json, text/event-stream',
        });

        // Should return 400 Bad Request per MCP spec
        expect(response.status).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toBeDefined();
        expect(body.error.message).toContain('session');
      },
      20000
    );

    /**
     * MCP Spec Compliance: 404 for invalid session ID
     * When a session ID is provided but not found, return 404
     */
    it(
      'returns 404 for invalid session ID',
      async () => {
        streamableHttpServerPort = await getAvailablePort();
        const baseUrl = `http://localhost:${streamableHttpServerPort}`;

        streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
          transport: 'streamable-http',
          debug: true,
        });

        await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

        // Send a request with a fake session ID
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        };

        const response = await httpPost(`${baseUrl}/mcp`, request, {
          'mcp-session-id': 'invalid-session-id-12345',
          Accept: 'application/json, text/event-stream',
        });

        // Should return 404 Not Found for invalid session
        expect(response.status).toBe(404);
        const body = JSON.parse(response.body);
        expect(body.error).toBeDefined();
        expect(body.error.message).toContain('Session not found');
      },
      20000
    );
  });
});
