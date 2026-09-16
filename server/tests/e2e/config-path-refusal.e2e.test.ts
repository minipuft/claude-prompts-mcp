/**
 * A path setting the server cannot use — an explicit config path, a workspace, a resources path, or
 * a workspace config.json — stops it before it serves anything, and an unusable PACKAGED config
 * still falls back to built-in defaults without writing to stdout, the STDIO protocol channel.
 *
 * Measured 2026-09-14 against `dist/index.js` before the refusal: with `MCP_CONFIG_PATH` naming a
 * missing file, a directory, or malformed JSON, the server logged the read error, printed "Using
 * default configuration" to STDOUT (the STDIO protocol channel), and served the bundled catalog on
 * both STDIO and Streamable HTTP — an HTTP initialize answered 200. The operator's settings were
 * ignored and nothing exited.
 *
 * This drives the built server because the refusal's contract is process-level: exit code, an
 * untouched stdout, and a reason on stderr. A unit test of `PathResolver` cannot show that the
 * startup path on each transport actually reaches the check.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import { getAvailablePort } from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
const PACKAGED_DEFAULT = path.join(SERVER_ROOT, 'config.json');

interface Run {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run the server until it exits, or until `settled` reports true, or until the deadline.
 *
 * STDIO keeps stdin open: closing it is itself a shutdown signal, which would turn a server that
 * should have refused into one that exits for an unrelated reason.
 */
async function runServer(
  args: string[],
  env: Record<string, string>,
  options: {
    stdin: 'pipe' | 'ignore';
    settled?: (run: { stdout: string; stderr: string }) => boolean;
    deadlineMs?: number;
    /** Newline-delimited JSON-RPC frames written to a piped stdin right after spawn. */
    stdinFrames?: object[];
  }
): Promise<Run> {
  // Every case here asserts a REFUSAL, so the child is not expected to write anywhere — which
  // is exactly why it needs its own roots: were a case to stop refusing, the write must land in
  // a temp directory rather than in the developer's home or in the repository.
  const roots = createHermeticRoots('config-path-refusal');
  const proc = spawn('node', [DIST_ENTRY, ...args], {
    cwd: SERVER_ROOT,
    env: buildServerEnv({ ...roots.env, ...env }),
    stdio: [options.stdin, 'pipe', 'pipe'],
  });

  for (const frame of options.stdinFrames ?? []) {
    proc.stdin?.write(`${JSON.stringify(frame)}\n`);
  }

  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const deadlineMs = options.deadlineMs ?? 20_000;
  return new Promise<Run>((resolve) => {
    let timedOut = false;
    const started = Date.now();
    const poll = setInterval(() => {
      const elapsed = Date.now() - started;
      if (options.settled?.({ stdout, stderr }) === true || elapsed > deadlineMs) {
        timedOut = elapsed > deadlineMs;
        proc.kill();
      }
    }, 100);
    proc.on('exit', (code) => {
      clearInterval(poll);
      roots.cleanup();
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });
  });
}

describe('a path setting that cannot be used refuses startup', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'config-path-refusal-e2e-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('STDIO: a missing MCP_CONFIG_PATH exits 1 before writing a byte to stdout', async () => {
    const missing = path.join(dir, 'missing.json');
    const run = await runServer(
      ['--transport=stdio'],
      { MCP_CONFIG_PATH: missing, MCP_RUNTIME_ROOT: path.join(dir, 'stdio-runtime') },
      { stdin: 'pipe' }
    );

    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(
      `Refusing to start: the MCP_CONFIG_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
    );
    expect(run.stderr).toContain(
      `Expected a readable JSON config file at that path, or unset MCP_CONFIG_PATH to use the packaged default at ${PACKAGED_DEFAULT}.`
    );
    expect(run.stderr).not.toContain('Using default configuration');
    // Printed once, as the operator's message, not repeated by each catch with a stack trace.
    expect(run.stderr.split('Refusing to start').length - 1).toBe(1);
    expect(run.stderr).not.toContain('at PathResolver.getConfigPath');
  }, 30_000);

  it('Streamable HTTP: --config naming malformed JSON exits 1 without serving', async () => {
    const malformed = path.join(dir, 'malformed.json');
    await writeFile(malformed, '{ not json');
    const port = await getAvailablePort();

    const run = await runServer(
      ['--transport=streamable-http', `--config=${malformed}`],
      { PORT: String(port), MCP_RUNTIME_ROOT: path.join(dir, 'http-runtime') },
      { stdin: 'ignore' }
    );

    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(
      `Refusing to start: --config is set to "${malformed}", which resolves to ${malformed}, and that path is not valid JSON (`
    );
    expect(run.stderr).toContain(
      `or remove --config to use the packaged default at ${PACKAGED_DEFAULT}.`
    );
    expect(run.stderr.split('Refusing to start').length - 1).toBe(1);
  }, 30_000);

  it('a usable MCP_CONFIG_PATH boots and its settings are the ones applied', async () => {
    // The observable setting: an absolute log directory. The default would put the log under
    // MCP_RUNTIME_ROOT/logs, so the file appearing in the configured directory, and not there,
    // shows the named file was read rather than the defaults.
    const packaged = JSON.parse(await readFile(PACKAGED_DEFAULT, 'utf8')) as Record<
      string,
      unknown
    >;
    delete packaged['$schema'];
    const customLogs = path.join(dir, 'custom-logs');
    const runtimeRoot = path.join(dir, 'valid-runtime');
    await mkdir(customLogs, { recursive: true });
    const valid = path.join(dir, 'valid.json');
    await writeFile(
      valid,
      JSON.stringify({ ...packaged, logging: { directory: customLogs, level: 'info' } })
    );
    const customLog = path.join(customLogs, 'mcp-server.log');

    const run = await runServer(
      ['--transport=stdio'],
      { MCP_CONFIG_PATH: valid, MCP_RUNTIME_ROOT: runtimeRoot },
      { stdin: 'pipe', settled: () => existsSync(customLog) }
    );

    expect(run.timedOut).toBe(false);
    expect(run.stderr).not.toContain('Refusing to start');
    expect(existsSync(customLog)).toBe(true);
    expect(existsSync(path.join(runtimeRoot, 'logs', 'mcp-server.log'))).toBe(false);
  }, 30_000);

  it('STDIO: a malformed workspace config.json exits 1 before writing a byte to stdout', async () => {
    // Before this refusal the same workspace booted on built-in defaults and served.
    const workspace = path.join(dir, 'malformed-workspace');
    await mkdir(workspace, { recursive: true });
    const config = path.join(workspace, 'config.json');
    await writeFile(config, '{ not json');

    const run = await runServer(
      ['--transport=stdio'],
      { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: path.join(dir, 'workspace-config-runtime') },
      { stdin: 'pipe' }
    );

    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(
      `Refusing to start: the MCP_WORKSPACE environment variable is set to "${workspace}", which resolves to ${workspace}, and its config file ${config} is not valid JSON (`
    );
    expect(run.stderr).toContain(
      `or move it out of the workspace to use the packaged default at ${PACKAGED_DEFAULT}.`
    );
    expect(run.stderr).not.toContain('Using default configuration');
    expect(run.stderr.split('Refusing to start').length - 1).toBe(1);
  }, 30_000);

  it('STDIO: a missing MCP_WORKSPACE exits 1 and is not created', async () => {
    // Before this refusal the logs mkdir under the default runtime root created the workspace.
    const missing = path.join(dir, 'missing-workspace');

    const run = await runServer(
      ['--transport=stdio'],
      { MCP_WORKSPACE: missing },
      { stdin: 'pipe' }
    );

    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(
      `Refusing to start: the MCP_WORKSPACE environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
    );
    expect(run.stderr).toContain(
      `Expected an existing directory at that path, or unset MCP_WORKSPACE to use the package root at ${SERVER_ROOT}.`
    );
    expect(run.stderr.split('Refusing to start').length - 1).toBe(1);
    expect(existsSync(missing)).toBe(false);
  }, 30_000);

  it('Streamable HTTP: a missing MCP_RESOURCES_PATH exits 1 without serving or creating the runtime root', async () => {
    const missing = path.join(dir, 'missing-resources');
    const runtimeRoot = path.join(dir, 'resources-http-runtime');
    const port = await getAvailablePort();

    const run = await runServer(
      ['--transport=streamable-http'],
      { PORT: String(port), MCP_RESOURCES_PATH: missing, MCP_RUNTIME_ROOT: runtimeRoot },
      { stdin: 'ignore' }
    );

    expect(run.timedOut).toBe(false);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(
      `Refusing to start: the MCP_RESOURCES_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
    );
    // No workspace is set, so the fallback is the packaged tree, not a "workspace" one.
    expect(run.stderr).toContain(
      `Expected an existing directory at that path, or unset MCP_RESOURCES_PATH to use the packaged resources at ${path.join(SERVER_ROOT, 'resources')}.`
    );
    expect(run.stderr.split('Refusing to start').length - 1).toBe(1);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(runtimeRoot)).toBe(false);
  }, 30_000);

  it('STDIO: an unusable packaged config falls back with stdout carrying only protocol frames', async () => {
    // The packaged config is the one fallback left, so this is where the channel is pinned. Before
    // the fix, ConfigLoader wrote "Using default configuration" to stdout ahead of the initialize
    // response, so a client parsing stdout as JSON-RPC read a non-frame first. `--server-root`
    // names a package root whose config.json is malformed, without touching the real one.
    const packageRoot = path.join(dir, 'malformed-package');
    await mkdir(packageRoot, { recursive: true });
    await copyFile(path.join(SERVER_ROOT, 'package.json'), path.join(packageRoot, 'package.json'));
    await symlink(path.join(SERVER_ROOT, 'resources'), path.join(packageRoot, 'resources'), 'dir');
    const packagedConfig = path.join(packageRoot, 'config.json');
    await writeFile(packagedConfig, '{ not json');

    const run = await runServer(
      ['--transport=stdio', `--server-root=${packageRoot}`],
      { MCP_RUNTIME_ROOT: path.join(dir, 'fallback-runtime') },
      {
        stdin: 'pipe',
        stdinFrames: [
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'config-fallback-e2e', version: '0' },
            },
          },
        ],
        settled: ({ stdout }) => stdout.includes('"id":1'),
      }
    );

    expect(run.timedOut).toBe(false);
    const lines = run.stdout.split('\n').filter((line) => line.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      let frame: unknown;
      expect(() => {
        frame = JSON.parse(line);
      }).not.toThrow();
      expect(frame).toMatchObject({ jsonrpc: '2.0' });
    }
    expect(lines.map((line) => JSON.parse(line) as { id?: number })).toContainEqual(
      expect.objectContaining({ id: 1, result: expect.anything() })
    );
    // The fallback path really ran against the packaged file.
    expect(run.stderr).toContain(`Error loading configuration from ${packagedConfig}`);
    expect(run.stderr).not.toContain('Refusing to start');
    expect(run.stderr).toContain('Using default configuration');
  }, 30_000);
});
