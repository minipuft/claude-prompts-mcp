// @lifecycle test - P6.292: with the gate system switched off at runtime, a chain opens no gate review and advances on its answers, over Streamable HTTP and STDIO.
/**
 * MEASURED 2026-10-04 on `ebe8936fb` (driven, hermetic, shipped CAGEERF and default gates; logs
 * `/tmp/claude-prompts-mcp-pr-p7k-p292-*.log`): after `system_control gates disable`, an
 * arrow-chain of `analysis` prompts opened a review on its first node holding
 * `content-structure` and `framework-compliance`, and asked for a `gate_verdict`. The tool
 * refuses that parameter while the gate system is off ("not one this server is advertising right
 * now"), so nothing could close the review: three answers in a row, sectionless or carrying every
 * CAGEERF section, each re-rendered step 1 as the same review at attempt 0. Not the ruled hold of
 * grade-before-advance (R170): the conforming answers were held too, by gates nothing grades.
 *
 * Cause: stage 11 (gate enhancement) skipped only for `gates.enabled: false` in config and never
 * read the runtime switch, so every later stage saw a gated step. It now skips for the runtime
 * switch as well, read for the request's own scope. Control: with the switch on, the same chain's
 * first render opens its review, so the probe that reads the run's reviews can see one.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { cageerfAnswer } from './helpers/cageerf-answer.js';
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

/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
const PROMPTS = ['p292_a', 'p292_b', 'p292_c'];
/** Every mark a render carries when it asks for a gate verdict or lists a gate. */
const GATE_MARKERS = [
  'Gate Review Required',
  'gate_verdict',
  '### Framework Compliance',
  '### Content Structure Guidelines',
];

type Tool = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ isError: boolean; text: string }>;

interface RunRow {
  current: string | null;
  reviews: string[];
}

/** The run's current node and the nodes holding an open review, from its own row. */
const readRun = (runtimeRoot: string, chainId: string): RunRow => {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
  try {
    const row = db
      .prepare('SELECT state, current_node_id FROM chain_runs WHERE chain_id = ?')
      .get(chainId) as { state: string; current_node_id: string | null } | undefined;
    if (row === undefined) throw new Error(`no run for ${chainId}`);
    const state = JSON.parse(row.state) as { reviews?: Record<string, unknown> };
    return { current: row.current_node_id, reviews: Object.keys(state.reviews ?? {}) };
  } finally {
    db.close();
  }
};

const authorFixtures = async (tool: Tool): Promise<void> => {
  for (const id of PROMPTS) {
    const result = await tool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id,
      // An analysis-family category: the shipped gates activate on it.
      category: 'analysis',
      name: id,
      description: `e2e step ${id}`,
      user_message_template: `BODY-${id}`,
    });
    if (result.isError) throw new Error(result.text);
  }
};

/** The twins every transport runs, over that transport's `tool` and state root. */
const harness = (tool: Tool, runtimeRoot: () => string) => {
  const setGates = async (operation: 'enable' | 'disable'): Promise<void> => {
    const result = await tool('system_control', { action: 'gates', operation });
    if (result.isError) throw new Error(result.text);
  };

  const start = async (): Promise<{ chainId: string; text: string }> => {
    const opened = await tool('prompt_engine', {
      command: PROMPTS.map((id) => `>>${id}`).join(ARROW),
    });
    expect(opened.isError).toBe(false);
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(opened.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${opened.text.slice(0, 400)}`);
    return { chainId, text: opened.text };
  };

  /** Twin: with the switch off, three calls open no review and walk the run off its last step. */
  const advancesWithGatesOff = async (): Promise<void> => {
    await setGates('disable');
    const { chainId, text } = await start();
    for (const marker of GATE_MARKERS) expect(text).not.toContain(marker);
    expect(readRun(runtimeRoot(), chainId)).toEqual({ current: 'n1', reviews: [] });

    const walked: RunRow[] = [];
    for (const step of ['one', 'two', 'three']) {
      const answered = await tool('prompt_engine', {
        chain_id: chainId,
        user_response: cageerfAnswer(`step ${step}`),
      });
      expect(answered.isError).toBe(false);
      for (const marker of GATE_MARKERS) expect(answered.text).not.toContain(marker);
      walked.push(readRun(runtimeRoot(), chainId));
    }
    // The whole walk as one value: n2, n3, then off the end.
    expect(walked).toEqual([
      { current: 'n2', reviews: [] },
      { current: 'n3', reviews: [] },
      { current: null, reviews: [] },
    ]);
  };

  /** Control: with the switch on, the same chain's first render opens a review on n1. */
  const reviewsWithGatesOn = async (): Promise<void> => {
    await setGates('enable');
    const { chainId, text } = await start();
    expect(text).toContain('Gate Review Required');
    expect(readRun(runtimeRoot(), chainId)).toEqual({ current: 'n1', reviews: ['n1'] });
  };

  return { advancesWithGatesOff, reviewsWithGatesOn };
};

describe('Streamable HTTP: a chain advances with the gate system switched off (P6.292)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let client: ModernMcpClient;
  let runtimeRoot = '';
  let nextId = 1;

  const tool: Tool = async (name, args) => {
    const outcome = await client.callToolWithNotifications(name, args, nextId++);
    const result = outcome.result as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };
  const twins = harness(tool, () => runtimeRoot);

  beforeAll(async () => {
    const roots = createHermeticRoots('gates-disabled-chain-e2e');
    cleanup.push(roots.cleanup);
    runtimeRoot = roots.runtimeRoot;
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot },
    });
    cleanup.push(() => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    client = new ModernMcpClient(baseUrl, 'gates-disabled-chain-e2e');
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('control: with the gate system on, the chain first render opens a review on n1', async () => {
    await twins.reviewsWithGatesOn();
  }, 120000);

  test('with the gate system off, three answers walk the run off its last step with no review', async () => {
    await twins.advancesWithGatesOff();
  }, 120000);
});

describe('STDIO: a chain advances with the gate system switched off (P6.292 transport parity)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let runtimeRoot = '';
  let proc: ChildProcess;
  let nextId = 1;
  let stderr = '';
  const pending = new Map<number, (message: Record<string, unknown>) => void>();

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`STDIO ${method} (id ${id}) got no answer in 45s\n${stderr}`));
      }, 45000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message['error'] != null) reject(new Error(JSON.stringify(message['error'])));
        else resolve(message['result']);
      });
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  const tool: Tool = async (name, args) => {
    const result = (await request('tools/call', { name, arguments: args })) as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };
  const twins = harness(tool, () => runtimeRoot);

  beforeAll(async () => {
    const roots = createHermeticRoots('gates-disabled-chain-stdio-e2e');
    cleanup.push(roots.cleanup);
    runtimeRoot = roots.runtimeRoot;
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    proc = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
      cwd: SERVER_ROOT,
      env: buildServerEnv({
        HOME: roots.home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: runtimeRoot,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cleanup.push(() => killServer(proc));
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('{')) continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        if (typeof message['id'] === 'number') pending.get(message['id'])?.(message);
      }
    });
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gates-disabled-chain-stdio-e2e', version: '1.0.0' },
    });
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('control over STDIO: with the gate system on, the chain first render opens a review on n1', async () => {
    await twins.reviewsWithGatesOn();
  }, 120000);

  test('over STDIO with the gate system off, three answers walk the run off its last step with no review', async () => {
    await twins.advancesWithGatesOff();
  }, 120000);
});
