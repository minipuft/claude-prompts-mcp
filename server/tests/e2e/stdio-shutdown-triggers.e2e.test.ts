/**
 * Every way a STDIO server is told to stop reaches the graceful shutdown path and closes
 * `state.db`.
 *
 * An MCP client ends a STDIO server by closing its stdin; an operator or a supervisor sends
 * SIGTERM or SIGINT. Each must run `Application.shutdown()` through to the database close, the
 * step that checkpoints the WAL and the last one that runs. Before this held, the stdin-end
 * handler and the server listener's own shutdown each called `process.exit` mid-sequence, so
 * the process exited 0 with the chain-session save and the database close never reached, and
 * `state.db-wal` stayed behind. Exit code 0 alone could not tell the two apart.
 *
 * The probe is the WAL file: it exists while the server holds the database open (asserted
 * before each trigger, so its absence afterwards is not a probe that cannot fire) and SQLite
 * removes it when the last connection closes.
 *
 * The log file must also hold the shutdown sequence's last line: `process.exit` discards file
 * writes still in flight, so a shutdown that exits without waiting for them leaves the log
 * ending at startup.
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots, type HermeticRoots } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

type Trigger = 'SIGTERM' | 'SIGINT' | 'stdin-end';

/** Start a STDIO server and resolve once it has answered `initialize`. */
async function startStdioServer(roots: HermeticRoots): Promise<ChildProcess> {
  const proc = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
    cwd: SERVER_ROOT,
    env: buildServerEnv(roots.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`STDIO server did not answer initialize in 20s\n${stderr}`));
    }, 20000);
    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.includes('"id":1')) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`STDIO server exited (${String(code)}) before initialize\n${stderr}`));
    });
    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stdio-shutdown-e2e', version: '1.0.0' },
      },
    };
    proc.stdin?.write(`${JSON.stringify(initialize)}\n`);
  });

  return proc;
}

/** Resolve with the exit code, or reject when the process outlives the timeout. */
function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server still running ${timeoutMs}ms after the shutdown trigger`));
    }, timeoutMs);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('STDIO server shutdown triggers', () => {
  let proc: ChildProcess | undefined;
  let roots: HermeticRoots | undefined;

  afterEach(() => {
    if (proc !== undefined && proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL');
    }
    proc = undefined;
    roots?.cleanup();
    roots = undefined;
  });

  it.each<Trigger>(['SIGTERM', 'SIGINT', 'stdin-end'])(
    '%s exits 0 with the database closed',
    async (trigger) => {
      roots = createHermeticRoots('stdio-shutdown-e2e');
      const walPath = path.join(roots.runtimeRoot, 'runtime-state', 'state.db-wal');
      const logPath = path.join(roots.runtimeRoot, 'logs', 'mcp-server.log');
      proc = await startStdioServer(roots);

      expect(existsSync(walPath)).toBe(true);
      // Positive control: the log file is the one this server writes.
      expect(readFileSync(logPath, 'utf8')).toContain('MCP Server Log Started');

      const exited = waitForExit(proc, 10000);
      if (trigger === 'stdin-end') {
        proc.stdin?.end();
      } else {
        proc.kill(trigger);
      }

      expect(await exited).toBe(0);
      expect(existsSync(walPath)).toBe(false);
      expect(readFileSync(logPath, 'utf8')).toContain('Graceful shutdown completed successfully');
    },
    40000
  );
});
