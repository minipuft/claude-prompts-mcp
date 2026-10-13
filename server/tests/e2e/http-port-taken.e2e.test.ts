/**
 * A taken HTTP port is handled per transport mode: dual mode keeps serving STDIO, HTTP-only
 * mode refuses to start and names the port.
 *
 * Before this held, the listener registered an error handler that called `process.exit(1)`
 * ahead of the dual-mode handler written to survive exactly this, so `--transport=both` with
 * its port in use died with nothing served and the survivor branch could never run.
 *
 * The probe holds the port with a listener this test owns (asserted bound before the server
 * starts, so a refusal cannot be a port nobody held), then drives the built server as a child.
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots, type HermeticRoots } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
const HOST = '127.0.0.1';

/** Bind a listener on a free high port and resolve with it. */
function holdPort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('port holder did not bind a TCP port'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function spawnServer(transport: string, roots: HermeticRoots, port: number): ChildProcess {
  return spawn('node', [DIST_ENTRY, `--transport=${transport}`, '--quiet'], {
    cwd: SERVER_ROOT,
    env: buildServerEnv({ ...roots.env, PORT: String(port), MCP_HTTP_HOST: HOST }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Send one request and resolve with the response whose id matches. */
function request(
  proc: ChildProcess,
  message: Record<string, unknown>,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`no response to ${String(message['method'])} in ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = (code: number | null): void => {
      clearTimeout(timer);
      reject(new Error(`server exited (${String(code)}) before answering ${message['method']}`));
    };
    proc.once('exit', onExit);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed['id'] === message['id']) {
            clearTimeout(timer);
            proc.off('exit', onExit);
            proc.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          // a partial line; wait for the rest
        }
      }
    };
    proc.stdout?.on('data', onData);
    proc.stdin?.write(`${JSON.stringify(message)}\n`);
  });
}

describe('HTTP port already in use', () => {
  let proc: ChildProcess | undefined;
  let holder: Server | undefined;
  let roots: HermeticRoots | undefined;

  afterEach(async () => {
    if (proc !== undefined && proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL');
    }
    proc = undefined;
    await new Promise<void>((resolve) => {
      if (holder === undefined) resolve();
      else holder.close(() => resolve());
    });
    holder = undefined;
    roots?.cleanup();
    roots = undefined;
  });

  it('dual mode keeps answering tools/list over STDIO', async () => {
    roots = createHermeticRoots('http-port-taken-dual');
    const held = await holdPort();
    holder = held.server;
    proc = spawnServer('both', roots, held.port);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const initialized = await request(
      proc,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'http-port-taken-e2e', version: '1.0.0' },
        },
      },
      30000
    ).catch((error: Error) => {
      throw new Error(`${error.message}\n${stderr}`);
    });
    expect(initialized['result']).toBeDefined();
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );

    const listed = await request(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, 15000);
    const tools = (listed['result'] as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toContain('prompt_engine');
    expect(proc.exitCode).toBeNull();
    expect(stderr).toContain(String(held.port));
  }, 60000);

  it('HTTP-only mode exits non-zero naming the port', async () => {
    roots = createHermeticRoots('http-port-taken-http');
    const held = await holdPort();
    holder = held.server;
    proc = spawnServer('streamable-http', roots, held.port);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`still running after 30s\n${stderr}`)),
        30000
      );
      proc?.once('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });

    expect(code).not.toBe(0);
    expect(code).not.toBeNull();
    expect(stderr).toContain(String(held.port));
  }, 60000);
});
