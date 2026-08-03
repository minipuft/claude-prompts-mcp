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
  killServer,
  StreamableHttpMcpClient,
  httpPost,
  parseJsonOrSse,
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
    it('server starts without immediate crash', async () => {
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
    }, 5000);

    // TODO: Jest ESM mode has issues with spawned process stdio capture
    // The server responds correctly when tested manually (see npm run start:test)
    // Skip for now until we can debug the Jest/ESM/spawn interaction
    it.skip('server responds to MCP initialize request', async () => {
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
    }, 10000);
  });

  describe('Expected Tools Registration (STDIO - skipped)', () => {
    // TODO: Jest ESM mode has issues with spawned process stdio capture
    // The server responds correctly when tested manually (see npm run start:test)
    // Skip for now - covered by HTTP transport tests below
    it.skip('server registers expected MCP tools via STDIO', async () => {
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
    }, 15000);
  });

  /**
   * HTTP Transport Tests
   *
   * These tests use HTTP/SSE transport instead of STDIO to avoid
   * Jest/ESM/spawn stdio capture issues.
   */
  /**
   * Streamable HTTP Transport Tests
   *
   * Tests the MCP standard transport:
   * - Single /mcp endpoint for POST, GET, DELETE
   * - Stateless: revision 2026-07-28 removed protocol sessions, so the server
   *   issues no session id and every request is served on its own instance
   */
  describe('MCP Protocol via Streamable HTTP Transport', () => {
    it('server starts with streamable-http transport', async () => {
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
    }, 20000);

    it('server responds to MCP initialize request via Streamable HTTP', async () => {
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

      // No session id: the handler serves each request from its own instance,
      // so there is nothing for an `Mcp-Session-Id` header to refer to.
      expect(sessionId).toBeNull();

      // Should have MCP capabilities
      expect(capabilities).toHaveProperty('protocolVersion');
      expect(capabilities).toHaveProperty('serverInfo');
      expect((capabilities as { serverInfo: { name: string } }).serverInfo).toHaveProperty('name');

      await client.close();
    }, 20000);

    it('server registers expected MCP tools via Streamable HTTP', async () => {
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
    }, 20000);

    it('serves requests without a session id via Streamable HTTP', async () => {
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

      // Create client and verify no session id is minted
      const client = new StreamableHttpMcpClient(baseUrl);
      const { sessionId } = await client.initialize();

      expect(sessionId).toBeNull();

      // Verify follow-up requests are served anyway
      const result = (await client.request('tools/list', {}, 2)) as {
        tools: Array<{ name: string }>;
      };
      expect(Array.isArray(result.tools)).toBe(true);

      await client.close();
    }, 25000);

    /**
     * Statelessness: revision 2026-07-28 removed protocol sessions.
     *
     * These two cases previously asserted the session contract -- 400 without an
     * `Mcp-Session-Id` and 404 for an unknown one. Both are now served normally:
     * there is no registry to miss, so a request carrying no session, or a stale
     * one from a 2025-era client, is answered on its own instance.
     */
    it('serves a non-init request that carries no session id', async () => {
      streamableHttpServerPort = await getAvailablePort();
      const baseUrl = `http://localhost:${streamableHttpServerPort}`;

      streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
        transport: 'streamable-http',
        debug: true,
      });

      await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

      const response = await httpPost(
        `${baseUrl}/mcp`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { Accept: 'application/json, text/event-stream' }
      );

      expect(response.status).toBe(200);
      const result = parseJsonOrSse(response.body, 1);
      expect(result.error).toBeUndefined();
      expect(Array.isArray((result.result as { tools: unknown[] }).tools)).toBe(true);
    }, 20000);

    it('ignores a stale session id header instead of rejecting it', async () => {
      streamableHttpServerPort = await getAvailablePort();
      const baseUrl = `http://localhost:${streamableHttpServerPort}`;

      streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
        transport: 'streamable-http',
        debug: true,
      });

      await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });

      const response = await httpPost(
        `${baseUrl}/mcp`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        {
          'mcp-session-id': 'invalid-session-id-12345',
          Accept: 'application/json, text/event-stream',
        }
      );

      expect(response.status).toBe(200);
      const result = parseJsonOrSse(response.body, 1);
      expect(result.error).toBeUndefined();
    }, 20000);
  });
});
