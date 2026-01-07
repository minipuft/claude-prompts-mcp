/**
 * HTTP MCP Client
 *
 * Test utilities for E2E testing via HTTP/SSE transport.
 * Avoids Jest/ESM/spawn STDIO capture issues by using HTTP endpoints.
 */

import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

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
  options: { transport?: string; quiet?: boolean; debug?: boolean } = {}
): ChildProcess {
  const transport = options.transport || 'sse';
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

  // Build clean environment without Jest's NODE_OPTIONS
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_OPTIONS; // Remove Jest's --experimental-vm-modules

  const proc = spawn('node', args, {
    cwd,
    env: {
      ...cleanEnv,
      PORT: String(port), // Server uses PORT env var for port
      MCP_WORKSPACE: PROJECT_ROOT,
      MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources'),
      NODE_ENV: 'test', // Ensure test environment
    },
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
 * Simple HTTP POST request
 */
async function httpPost(
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
 * Establish SSE connection and send MCP request, wait for response
 * This is the full SSE flow: GET /mcp for stream, POST /messages for requests
 */
export async function sendMcpRequestWithSse(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  requestId: number = 1,
  options: { timeout?: number } = {}
): Promise<unknown> {
  const timeout = options.timeout || 10000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sseReq.destroy();
      reject(new Error(`MCP request timed out after ${timeout}ms`));
    }, timeout);

    // Open SSE connection
    const sseUrl = new URL(`${baseUrl}/mcp`);
    const sseReq = http.get(sseUrl, (sseRes) => {
      let buffer = '';

      sseRes.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(data);
              if (parsed.id === requestId) {
                clearTimeout(timer);
                sseReq.destroy();

                if (parsed.error) {
                  reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
                } else {
                  resolve(parsed.result);
                }
                return;
              }
            } catch {
              // Not our response, continue
            }
          }
        }
      });

      sseRes.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // Once SSE is connected, send the request via POST
      setTimeout(async () => {
        try {
          const request = {
            jsonrpc: '2.0',
            id: requestId,
            method,
            params,
          };
          await httpPost(`${baseUrl}/messages`, request);
        } catch (err) {
          clearTimeout(timer);
          sseReq.destroy();
          reject(err);
        }
      }, 100);
    });

    sseReq.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Helper to sleep for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
