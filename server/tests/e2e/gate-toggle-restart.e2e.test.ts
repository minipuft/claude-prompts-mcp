/**
 * A gates toggle through `system_control` survives a restart, on both transports.
 *
 * Disabling gates exists to save tokens: `prompt_engine` stops advertising `gates`,
 * `gate_verdict` and `gate_action`. Measured 2026-09-14 against `dist/index.js`: the narrowing
 * held only until the server restarted. The toggle was written to `state.db` under the launch
 * workspace, but startup loaded only the literal `default` row, and a scope missing from memory
 * was created enabled without reading SQLite — so the next process advertised all three again.
 *
 * `mcp-server-smoke.test.ts` toggles within one process and cannot see that. This drives three
 * processes over one runtime root: disable in the first, observe the narrowed schema in the
 * second and re-enable there, observe the full schema in the third. Each process starts where
 * the previous one's `state.db` left off, which is the only thing a restart can carry.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

const ALL_GATE_PARAMS = ['gate_action', 'gate_verdict', 'gates'];

type ToolsList = {
  tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
};

/** One server process: list the gate parameters, toggle gates, stop. */
interface ServerSession {
  gateParams(): Promise<string[]>;
  setGates(operation: 'enable' | 'disable'): Promise<void>;
  stop(): Promise<void>;
}

function gateParamsOf(listed: ToolsList): string[] {
  const engine = listed.tools.find((tool) => tool.name === 'prompt_engine');
  return Object.keys(engine?.inputSchema?.properties ?? {})
    .filter((property) => property.startsWith('gate'))
    .sort();
}

/**
 * Every process in one scenario shares the runtime root (so `state.db`) and the project dir (so
 * the launch workspace a toggle is written under). `CLAUDE_PROJECT_DIR` is pinned rather than
 * inherited so the scope does not depend on who ran jest.
 */
interface Scenario {
  runtimeRoot: string;
  projectDir: string;
  /**
   * The child's `HOME`. Held beside `runtimeRoot` rather than derived at each transport, because
   * `MCP_WORKSPACE` here is the REPOSITORY — an inherited home would put a skills_sync export in
   * the developer's real client skill folders, the same way an inherited runtime root would put
   * `state.db` in the repo.
   */
  home: string;
}

function scenarioEnv(scenario: Scenario): Record<string, string> {
  return {
    HOME: scenario.home,
    MCP_WORKSPACE: REPO_ROOT,
    MCP_RUNTIME_ROOT: scenario.runtimeRoot,
    CLAUDE_PROJECT_DIR: scenario.projectDir,
  };
}

async function startHttpSession(scenario: Scenario): Promise<ServerSession> {
  const port = await getAvailablePort();
  const baseUrl = `http://localhost:${port}`;
  const proc = startServerWithHttp(port, { env: scenarioEnv(scenario) });
  await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
  const client = new ModernMcpClient(baseUrl);
  let nextId = 1;

  return {
    gateParams: async () =>
      gateParamsOf((await client.request('tools/list', {}, nextId++)) as ToolsList),
    setGates: async (operation) => {
      const response = (await client.callTool(
        'system_control',
        { action: 'gates', operation, reason: 'gate restart e2e' },
        nextId++
      )) as { isError?: boolean };
      expect(response.isError ?? false).toBe(false);
    },
    stop: () => killServer(proc),
  };
}

/** Newline-delimited JSON-RPC over the child's stdio, matched to requests by id. */
async function startStdioSession(scenario: Scenario): Promise<ServerSession> {
  const proc: ChildProcess = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
    cwd: SERVER_ROOT,
    env: buildServerEnv(scenarioEnv(scenario)),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let buffer = '';
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.startsWith('{')) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      const resolve = typeof message['id'] === 'number' ? pending.get(message['id']) : undefined;
      resolve?.(message);
    }
  });

  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`STDIO ${method} (id ${id}) got no answer in 20s\n${stderr}`));
      }, 20000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message['error'] != null) {
          reject(new Error(JSON.stringify(message['error'])));
        } else {
          resolve(message['result']);
        }
      });
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'gate-restart-e2e', version: '1.0.0' },
  });
  proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  return {
    gateParams: async () => gateParamsOf((await request('tools/list', {})) as ToolsList),
    setGates: async (operation) => {
      const response = (await request('tools/call', {
        name: 'system_control',
        arguments: { action: 'gates', operation, reason: 'gate restart e2e' },
      })) as { isError?: boolean };
      expect(response.isError ?? false).toBe(false);
    },
    stop: () => killServer(proc),
  };
}

describe.each([
  ['STDIO', startStdioSession],
  ['Streamable HTTP', startHttpSession],
] as const)('%s: a gates toggle survives a restart', (_transport, startSession) => {
  let scenario: Scenario;
  let cleanupRoots: (() => void) | undefined;

  beforeAll(async () => {
    const roots = createHermeticRoots('gate-toggle-restart-e2e');
    cleanupRoots = roots.cleanup;
    scenario = {
      runtimeRoot: roots.runtimeRoot,
      projectDir: path.join(roots.root, 'project'),
      home: roots.home,
    };
  });

  afterAll(() => {
    cleanupRoots?.();
  });

  it('a disable narrows the next process, and an enable restores the one after', async () => {
    const first = await startSession(scenario);
    try {
      // Positive control: the probe observes all three parameters before anything is toggled.
      expect(await first.gateParams()).toEqual(ALL_GATE_PARAMS);
      await first.setGates('disable');
      expect(await first.gateParams()).toEqual([]);
    } finally {
      await first.stop();
    }

    const second = await startSession(scenario);
    try {
      expect(await second.gateParams()).toEqual([]);
      await second.setGates('enable');
    } finally {
      await second.stop();
    }

    const third = await startSession(scenario);
    try {
      expect(await third.gateParams()).toEqual(ALL_GATE_PARAMS);
    } finally {
      await third.stop();
    }
  }, 120000);
});
