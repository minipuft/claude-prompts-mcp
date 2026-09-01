/**
 * MCP Server Smoke Tests
 *
 * Validates that the MCP server starts correctly and responds to basic requests.
 * This ensures the server entry point works for both Claude Code and Gemini CLI.
 */

import { describe, expect, it, afterEach, beforeAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { tmpdir } from 'os';
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
  ModernMcpClient,
  MODERN_PROTOCOL_VERSION,
  PROJECT_ROOT as HTTP_PROJECT_ROOT,
  SERVER_PATH as HTTP_SERVER_PATH,
} from './helpers/http-mcp-client.js';

import { buildServerEnv } from './helpers/child-env.js';

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
function spawnServer(runtimeRoot?: string): ChildProcess {
  return spawn('node', [SERVER_PATH, '--transport=stdio', '--quiet'], {
    cwd: path.join(PROJECT_ROOT, 'server'),
    env: buildServerEnv({
      MCP_WORKSPACE: PROJECT_ROOT,
      MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources'),
      ...(runtimeRoot !== undefined ? { MCP_RUNTIME_ROOT: runtimeRoot } : {}),
    }),
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

    it('writes state and logs beneath an explicit runtime root', async () => {
      const runtimeRoot = await fs.mkdtemp(path.join(tmpdir(), 'claude-prompts-runtime-'));
      const startup = spawn('node', [SERVER_PATH, '--startup-test', '--client=codex'], {
        cwd: path.join(PROJECT_ROOT, 'server'),
        env: buildServerEnv({
          NODE_ENV: 'production',
          CI: 'false',
          GITHUB_ACTIONS: 'false',
          MCP_RUNTIME_ROOT: runtimeRoot,
          MCP_WORKSPACE: PROJECT_ROOT,
          MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources'),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      startup.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        startup.once('error', reject);
        startup.once('exit', resolve);
      });

      if (exitCode !== 0) {
        throw new Error(`Startup test exited ${exitCode}: ${stderr}`);
      }
      await fs.access(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      await fs.access(path.join(runtimeRoot, 'logs', 'mcp-server.log'));
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }, 30000);

    // The sibling above pins MCP_RUNTIME_ROOT, which every consumer reads through one resolver
    // call. MCP_WORKSPACE is the path a plugin host actually sets (`.mcp.json` maps
    // ${CLAUDE_PLUGIN_ROOT} onto it) and it reaches the same place only via getRuntimeRoot()'s
    // fallback — a different branch, and the one that was never asserted. It stayed correct
    // only because ResourceChangeTracker happened to claim the SqliteEngine singleton first;
    // five of the six getInstance call sites pass no dbPath and fall back to the PACKAGE
    // directory, which is read-only under a sandboxed MCP child.
    it('writes state and logs beneath MCP_WORKSPACE when no runtime root is set', async () => {
      const workspace = await fs.mkdtemp(path.join(tmpdir(), 'claude-prompts-workspace-'));
      const startup = spawn('node', [SERVER_PATH, '--startup-test', '--client=codex'], {
        cwd: path.join(PROJECT_ROOT, 'server'),
        // No MCP_RUNTIME_ROOT: this case is about the fallback to MCP_WORKSPACE, and the helper
        // scrubs an inherited one rather than each caller remembering to blank it.
        env: buildServerEnv({
          NODE_ENV: 'production',
          CI: 'false',
          GITHUB_ACTIONS: 'false',
          MCP_WORKSPACE: workspace,
          MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources'),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      startup.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        startup.once('error', reject);
        startup.once('exit', resolve);
      });

      if (exitCode !== 0) {
        throw new Error(`Startup test exited ${exitCode}: ${stderr}`);
      }
      // Two behaviors, asserted separately: the database and the log file.
      await fs.access(path.join(workspace, 'runtime-state', 'state.db'));
      await fs.access(path.join(workspace, 'logs', 'mcp-server.log'));

      // And nothing landed in the package directory — the assertion above passes either way if
      // both locations get written, which is exactly what a half-fixed resolver would do.
      const packageDb = path.join(PROJECT_ROOT, 'server', 'runtime-state', 'state.db');
      const before = await fs.stat(packageDb).catch(() => null);
      expect(before === null || before.mtimeMs < Date.now() - 5000).toBe(true);

      await fs.rm(workspace, { recursive: true, force: true });
    }, 30000);

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
   * These tests use the Streamable HTTP transport instead of STDIO to avoid
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

  /**
   * Protocol revision 2026-07-28 and dual-era serving.
   *
   * The revision removes the `initialize` handshake, so a modern client's first
   * request is a real call carrying a `_meta` envelope. The edge also rejects
   * any request whose headers and body disagree, which is why every call sends
   * `Mcp-Method` and `tools/call` additionally sends `Mcp-Name`.
   *
   * The last test is the migration's actual gate: one build, both eras.
   */
  describe('MCP Protocol revision 2026-07-28', () => {
    async function startModernServer(): Promise<string> {
      streamableHttpServerPort = await getAvailablePort();
      const baseUrl = `http://localhost:${streamableHttpServerPort}`;
      streamableHttpServerProcess = startServerWithHttp(streamableHttpServerPort, {
        transport: 'streamable-http',
        debug: true,
      });
      await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });
      return baseUrl;
    }

    it('lists tools with no initialize handshake', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const result = (await client.request('tools/list', {}, 1)) as {
        tools: Array<{ name: string }>;
      };

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('prompt_engine');
      expect(toolNames).toContain('resource_manager');
      expect(toolNames).toContain('system_control');
    }, 25000);

    it('answers server/discover with the advertised surface and cache posture', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const result = (await client.request('server/discover', {}, 1)) as {
        supportedVersions: string[];
        capabilities: Record<string, unknown>;
        ttlMs: number;
        cacheScope: string;
      };

      expect(result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
      expect(Object.keys(result.capabilities).sort()).toEqual(['prompts', 'resources', 'tools']);
      // Deliberate posture: a tool surface that varies with framework state must
      // not be cached by clients. `ttlMs: 0` is the SDK default, asserted here so
      // a future change to it is a visible decision rather than a silent one.
      expect(result.ttlMs).toBe(0);
      expect(result.cacheScope).toBe('private');
    }, 25000);

    it('executes a tool call', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const result = (await client.callTool('system_control', { action: 'status' }, 1)) as {
        isError: boolean;
        content: Array<{ type: string; text: string }>;
      };

      expect(result.isError).toBe(false);
      expect(result.content[0]?.text).toContain('System Status');
    }, 25000);

    it('preserves resource_manager structured content on the MCP wire', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const result = (await client.callTool(
        'resource_manager',
        { resource_type: 'prompt', action: 'inspect', id: 'create_prompt', detail: 'full' },
        1
      )) as {
        isError: boolean;
        structuredContent?: {
          action?: string;
          id?: string;
          resource_root?: string;
          current_version?: number;
        };
      };

      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        action: 'inspect',
        id: 'create_prompt',
      });
      expect(result.structuredContent?.resource_root).toContain('resources/prompts');
      expect(typeof result.structuredContent?.current_version).toBe('number');
    }, 25000);

    it('rejects a request whose headers omit the method', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const response = await client.send('tools/list', {}, 1, { omitMethodHeader: true });

      // The edge classifies before dispatch, so this never reaches a handler.
      expect(response.status).toBeGreaterThanOrEqual(400);
      const parsed = parseJsonOrSse(response.body, 1) as { error?: { message: string } };
      expect(parsed.error?.message).toContain('Mcp-Method');
    }, 25000);

    it('rejects a request whose _meta envelope is incomplete', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const response = await client.send('tools/list', {}, 1, { partialMeta: true });

      const parsed = parseJsonOrSse(response.body, 1) as { error?: { message: string } };
      expect(parsed.error).toBeDefined();
      expect(parsed.error?.message).toMatch(/envelope/i);
      expect(parsed.error?.message).toContain('clientCapabilities');
    }, 25000);

    it('serves a request carrying no envelope as a 2025-era client', async () => {
      const client = new ModernMcpClient(await startModernServer());

      // No `_meta` is not an error: it is what a 2025-era client sends, and
      // `legacy: 'stateless'` serves it per-request rather than rejecting it.
      // This is the behavior that lets one build answer both revisions.
      const response = await client.send('tools/list', {}, 1, { omitMeta: true });

      expect(response.status).toBe(200);
      const parsed = parseJsonOrSse(response.body, 1) as {
        error?: unknown;
        result?: { tools: Array<{ name: string }> };
      };
      expect(parsed.error).toBeUndefined();
      expect(parsed.result?.tools.map((t) => t.name)).toContain('prompt_engine');
    }, 25000);

    it('serves a 2026-07-28 client and a 2025-era client from one build', async () => {
      const baseUrl = await startModernServer();

      // 2025-era: handshake first, then a call.
      const legacyClient = new StreamableHttpMcpClient(baseUrl);
      const { capabilities } = await legacyClient.initialize();
      expect(capabilities).toHaveProperty('protocolVersion');
      const legacyTools = (await legacyClient.request('tools/list', {}, 2)) as {
        tools: Array<{ name: string }>;
      };

      // 2026-07-28: no handshake, envelope on every call.
      const modernClient = new ModernMcpClient(baseUrl);
      const modernTools = (await modernClient.request('tools/list', {}, 3)) as {
        tools: Array<{ name: string }>;
      };

      // Same surface, both eras, same process.
      expect(modernTools.tools.map((t) => t.name).sort()).toEqual(
        legacyTools.tools.map((t) => t.name).sort()
      );

      const legacyCall = (await legacyClient.request(
        'tools/call',
        { name: 'system_control', arguments: { action: 'status' } },
        4
      )) as { isError: boolean };
      const modernCall = (await modernClient.callTool(
        'system_control',
        { action: 'status' },
        5
      )) as {
        isError: boolean;
      };

      expect(legacyCall.isError).toBe(false);
      expect(modernCall.isError).toBe(false);

      await legacyClient.close();
    }, 30000);

    /**
     * The tool surface is a function of runtime state, not a constant.
     *
     * `prompt_engine` advertises its three gate parameters only while the gate
     * system is enabled. Proving that end-to-end needs a live state change and
     * two `tools/list` calls, because the property that matters is what reaches
     * the wire: an in-process assertion cannot distinguish a schema that was
     * rebuilt from one that was merely re-described.
     *
     * Over HTTP there is no long-lived instance — each request builds a fresh
     * server from the factory — so this also proves the reshape is not a
     * mutation that would have been lost with the request that made it.
     */
    it('reshapes the advertised inputSchema when gate state changes', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const gateParamsFor = async (id: number): Promise<string[]> => {
        const listed = (await client.request('tools/list', {}, id)) as {
          tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
        };
        const engine = listed.tools.find((t) => t.name === 'prompt_engine');
        const props = Object.keys(engine?.inputSchema?.properties ?? {});
        return props.filter((p) => p.startsWith('gate')).sort();
      };

      const setGateSystem = async (operation: 'enable' | 'disable', id: number): Promise<void> => {
        const response = (await client.callTool(
          'system_control',
          { action: 'gates', operation, reason: 'tool surface e2e' },
          id
        )) as { isError?: boolean };
        expect(response.isError ?? false).toBe(false);
      };

      await setGateSystem('enable', 1);
      const enabled = await gateParamsFor(2);
      expect(enabled).toEqual(['gate_action', 'gate_verdict', 'gates']);

      await setGateSystem('disable', 3);
      const disabled = await gateParamsFor(4);

      // The tier's gate criterion: the *shape* changed, not only description
      // text. Asserting the parameter set rather than a deep-equality diff is
      // what separates the two — a re-described schema keeps its keys.
      expect(disabled).toEqual([]);
      expect(disabled).not.toEqual(enabled);

      // Restore, and confirm the narrowing is reversible rather than one-way.
      await setGateSystem('enable', 5);
      expect(await gateParamsFor(6)).toEqual(enabled);
    }, 40000);

    /**
     * `observations` (unknowns-ledger declarations) is not gated on runtime state
     * the way the three gate parameters above are — it must always be advertised.
     */
    it('advertises the observations parameter on prompt_engine', async () => {
      const client = new ModernMcpClient(await startModernServer());

      const listed = (await client.request('tools/list', {}, 1)) as {
        tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
      };
      const engine = listed.tools.find((t) => t.name === 'prompt_engine');
      const props = Object.keys(engine?.inputSchema?.properties ?? {});

      expect(props).toContain('observations');
    }, 20000);
  });
});
