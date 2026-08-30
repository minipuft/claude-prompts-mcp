/**
 * HTTP MCP Client
 *
 * Test utilities for E2E testing over the Streamable HTTP transport.
 * Avoids Jest/ESM/spawn STDIO capture issues by using HTTP endpoints.
 *
 * "SSE" below refers to `text/event-stream` *framing*, which Streamable HTTP
 * still uses for responses — not to the HTTP+SSE transport, which was removed
 * with the SDK v2 upgrade along with the two client helpers that drove it.
 */

import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildServerEnv } from './child-env.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SERVER_PATH = path.join(PROJECT_ROOT, 'server', 'dist', 'index.js');

/**
 * Find an available port by briefly binding to port 0
 */
export async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address() as net.AddressInfo;
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * Spawn MCP server with HTTP transport
 */
export function startServerWithHttp(
  port: number,
  options: {
    transport?: string;
    quiet?: boolean;
    debug?: boolean;
    /**
     * Extra environment applied AFTER the defaults below, so a caller can redirect the server's
     * writable roots. Added for the claims-conformance suite: its default of
     * `MCP_WORKSPACE: PROJECT_ROOT` points every spawned server at the developer's live
     * `state.db`, which is fine for read-only smoke checks and not fine for a suite that
     * executes prompts and will soon exercise create/delete/rollback.
     */
    env?: Record<string, string>;
  } = {}
): ChildProcess {
  // 'sse' was the default until the HTTP+SSE transport was removed with SDK v2.
  const transport = options.transport || 'streamable-http';
  const args = [SERVER_PATH, `--transport=${transport}`];

  if (options.quiet !== false) {
    args.push('--quiet');
  }

  const cwd = path.join(PROJECT_ROOT, 'server');

  // Debug path resolution
  if (options.debug) {
    console.log('[HTTP-MCP-CLIENT] Spawning server:');
    console.log('  PROJECT_ROOT:', PROJECT_ROOT);
    console.log('  SERVER_PATH:', SERVER_PATH);
    console.log('  CWD:', cwd);
    console.log('  PORT:', port);
    console.log('  ARGS:', args);
  }

  const proc = spawn('node', args, {
    cwd,
    env: buildServerEnv({
      PORT: String(port), // Server uses PORT env var for port
      MCP_WORKSPACE: PROJECT_ROOT,
      MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources'),
      // NODE_ENV stays unset — the server runs in normal mode.
      ...(options.env ?? {}),
    }),
    // Use 'ignore' for stdin to avoid triggering 'end' event handler
    // which exits the process (see logging/index.ts setupProcessEventHandlers)
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false, // Keep attached but without stdin
  });

  // Log errors for debugging if debug option is enabled
  if (options.debug) {
    proc.stderr?.on('data', (data) => {
      console.error('[SERVER STDERR]', data.toString());
    });
    proc.stdout?.on('data', (data) => {
      console.log('[SERVER STDOUT]', data.toString());
    });
    proc.on('error', (err) => {
      console.error('[SERVER ERROR]', err);
    });
    proc.on('exit', (code, signal) => {
      console.log('[SERVER EXIT]', { code, signal });
    });
  }

  return proc;
}

/**
 * Wait for server health endpoint to return 200
 */
export async function waitForHealth(
  baseUrl: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const timeout = options.timeout || 10000;
  const interval = options.interval || 100;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await httpGet(`${baseUrl}/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await sleep(interval);
  }

  throw new Error(`Server health check timed out after ${timeout}ms`);
}

/**
 * Simple HTTP GET request
 */
async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/**
 * Simple HTTP POST request (exported for raw HTTP tests)
 */
export async function httpPost(
  url: string,
  data: object,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode || 0,
          body,
          headers: res.headers,
        })
      );
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Send MCP JSON-RPC request via HTTP POST to /messages endpoint
 * Parses SSE response format if needed
 */
export async function sendMcpRequestViaHttp(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  requestId: number = 1
): Promise<unknown> {
  const request = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params,
  };

  const response = await httpPost(`${baseUrl}/messages`, request);

  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`HTTP ${response.status}: ${response.body}`);
  }

  // Parse response - may be JSON or SSE format
  const body = response.body.trim();

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(body);
    if (parsed.error) {
      throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    }
    return parsed.result;
  } catch {
    // May be SSE format, try to find JSON in lines
    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(data);
          if (parsed.id === requestId) {
            if (parsed.error) {
              throw new Error(parsed.error.message || JSON.stringify(parsed.error));
            }
            return parsed.result;
          }
        } catch {
          // Continue to next line
        }
      } else if (trimmed && !trimmed.startsWith('event:') && !trimmed.startsWith('id:')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === requestId) {
            if (parsed.error) {
              throw new Error(parsed.error.message || JSON.stringify(parsed.error));
            }
            return parsed.result;
          }
        } catch {
          // Not JSON, skip
        }
      }
    }

    throw new Error(`Could not parse MCP response: ${body}`);
  }
}

/**
 * Helper to sleep for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse response body that may be JSON or SSE format
 */
export function parseJsonOrSse(
  body: string,
  expectedId?: number
): { result?: unknown; error?: unknown } {
  const trimmed = body.trim();

  // Try direct JSON parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // May be SSE format, try to extract JSON from data lines
    const lines = trimmed.split('\n');
    for (const line of lines) {
      const lineTrimmed = line.trim();
      if (lineTrimmed.startsWith('data:')) {
        const data = lineTrimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(data);
          if (!expectedId || parsed.id === expectedId) {
            return parsed;
          }
        } catch {
          // Not valid JSON, continue
        }
      } else if (
        lineTrimmed &&
        !lineTrimmed.startsWith('event:') &&
        !lineTrimmed.startsWith('id:')
      ) {
        try {
          const parsed = JSON.parse(lineTrimmed);
          if (!expectedId || parsed.id === expectedId) {
            return parsed;
          }
        } catch {
          // Not JSON, skip
        }
      }
    }
    throw new Error(`Could not parse response: ${body.substring(0, 200)}`);
  }
}

/**
 * Streamable HTTP MCP Client
 *
 * Handles the new MCP standard transport (since 2025-03-26):
 * - Single /mcp endpoint for POST, GET, DELETE
 * - Session management via mcp-session-id header
 * - Stateful session mode with session ID generator
 */
export class StreamableHttpMcpClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize the session by sending an initialize request
   */
  async initialize(): Promise<{ sessionId: string | null; capabilities: unknown }> {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    };

    // Streamable HTTP requires Accept header for both JSON and SSE
    const response = await httpPost(`${this.baseUrl}/mcp`, request, {
      Accept: 'application/json, text/event-stream',
    });

    if (response.status !== 200) {
      throw new Error(`Initialize failed: HTTP ${response.status}: ${response.body}`);
    }

    // Extract session ID from response header
    const sessionId = response.headers['mcp-session-id'] as string;
    if (sessionId) {
      this.sessionId = sessionId;
    }

    // Parse response - may be JSON or SSE format
    const parsed = parseJsonOrSse(response.body, 1);
    if (parsed.error) {
      throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    }

    return {
      sessionId: this.sessionId,
      capabilities: parsed.result,
    };
  }

  /**
   * Send a request.
   *
   * Protocol revision 2026-07-28 removed protocol sessions, so a session id is
   * no longer required and the server issues none. The header is still sent
   * when one exists, which keeps this client usable against a 2025-era server.
   */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    requestId: number = 1
  ): Promise<unknown> {
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const response = await httpPost(`${this.baseUrl}/mcp`, request, headers);

    if (response.status !== 200) {
      throw new Error(`Request failed: HTTP ${response.status}: ${response.body}`);
    }

    // Parse response - may be JSON or SSE format
    const parsed = parseJsonOrSse(response.body, requestId);
    if (parsed.error) {
      throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    }

    return parsed.result;
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    if (!this.sessionId) return;

    try {
      await httpDelete(`${this.baseUrl}/mcp`, { 'mcp-session-id': this.sessionId });
    } catch {
      // Ignore errors on close
    }
    this.sessionId = null;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}

/**
 * Simple HTTP DELETE request
 */
async function httpDelete(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'DELETE',
      headers: {
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode || 0,
          body,
        })
      );
      res.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Send MCP request via Streamable HTTP transport (stateless mode)
 * For quick one-off requests without session management
 */
export async function sendMcpRequestWithStreamableHttp(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  requestId: number = 1
): Promise<unknown> {
  const client = new StreamableHttpMcpClient(baseUrl);
  await client.initialize();
  try {
    return await client.request(method, params, requestId);
  } finally {
    await client.close();
  }
}

/**
 * Helper to kill a server process and wait for it to exit
 */
export async function killServer(proc: ChildProcess, timeout = 5000): Promise<void> {
  if (proc.killed) return;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, timeout);

    proc.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    proc.kill('SIGTERM');
  });
}

export { PROJECT_ROOT, SERVER_PATH };

// ─── Protocol revision 2026-07-28 ───────────────────────────────────────────

/** Protocol revision that removed the `initialize` handshake and sessions. */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * `_meta` envelope keys the revision requires on every request.
 *
 * Duplicated from `@modelcontextprotocol/server` rather than imported: this
 * fixture exists to prove the wire contract, so it has to state the strings a
 * third-party client would send. Importing the SDK's constants would make the
 * test agree with the server by construction even if both drifted from spec.
 */
export const MODERN_META_KEYS = {
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
} as const;

/**
 * A 2026-07-28 client.
 *
 * Two things separate it from {@link StreamableHttpMcpClient}: there is no
 * `initialize` handshake and no session, and the edge rejects any request whose
 * headers and body disagree — so `Mcp-Method` accompanies every call and
 * `Mcp-Name` accompanies `tools/call`.
 */
export class ModernMcpClient {
  private baseUrl: string;
  private clientName: string;

  constructor(baseUrl: string, clientName = 'e2e-modern-client') {
    this.baseUrl = baseUrl;
    this.clientName = clientName;
  }

  private envelope(): Record<string, unknown> {
    return {
      [MODERN_META_KEYS.clientInfo]: { name: this.clientName, version: '1.0.0' },
      [MODERN_META_KEYS.clientCapabilities]: {},
      [MODERN_META_KEYS.protocolVersion]: MODERN_PROTOCOL_VERSION,
    };
  }

  /**
   * `partialMeta` drops `clientCapabilities` while keeping the rest. That is a
   * request declaring modern intent but violating the envelope contract — a
   * distinct case from omitting `_meta` entirely, which is simply a 2025-era
   * request and is served by the stateless fallback.
   */
  private metaFor(options: { partialMeta?: boolean }): Record<string, unknown> {
    const meta = this.envelope();
    if (options.partialMeta) {
      delete meta[MODERN_META_KEYS.clientCapabilities];
    }
    return meta;
  }

  /**
   * Send a request, returning the raw HTTP response so callers can assert on
   * status and error bodies as well as results.
   */
  async send(
    method: string,
    params: Record<string, unknown> = {},
    requestId = 1,
    options: {
      toolName?: string;
      omitMethodHeader?: boolean;
      omitMeta?: boolean;
      partialMeta?: boolean;
    } = {}
  ): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
    };
    if (!options.omitMethodHeader) {
      headers['Mcp-Method'] = method;
    }
    if (options.toolName) {
      headers['Mcp-Name'] = options.toolName;
    }

    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: options.omitMeta ? params : { ...params, _meta: this.metaFor(options) },
    };

    return httpPost(`${this.baseUrl}/mcp`, body, headers);
  }

  /** Send a request and unwrap its JSON-RPC result, throwing on error. */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    requestId = 1,
    options: { toolName?: string } = {}
  ): Promise<unknown> {
    const response = await this.send(method, params, requestId, options);
    if (response.status !== 200) {
      throw new Error(`Request failed: HTTP ${response.status}: ${response.body}`);
    }
    const parsed = parseJsonOrSse(response.body, requestId);
    if (parsed.error) {
      throw new Error(JSON.stringify(parsed.error));
    }
    return parsed.result;
  }

  /** `tools/call`, which additionally requires the `Mcp-Name` header. */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    requestId = 1
  ): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args }, requestId, { toolName: name });
  }
}
