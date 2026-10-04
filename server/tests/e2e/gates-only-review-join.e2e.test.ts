// @lifecycle test - P6.279 / R173: a call carrying `gates` and no verdict, sent while its step's review is open, joins that review without counting an attempt, over Streamable HTTP and STDIO.
/**
 * MEASURED 2026-10-04 on `c97d80159` (this harness, both transports): a `>>gj_chain` run standing
 * at `b` with `b`'s review open (answered with `user_response` alone, attempt 0) and resumed with
 * `gates` targeting `b` and NO verdict was refused "names the step this call answers; target "c"
 * or later"; the review stayed `['gj-block']`. A gate sent WITH a FAIL already joined that review
 * (R154, P6.268 in `chain-prompt-sources.e2e.test.ts`).
 *
 * Now (R173) the verdict-less call joins the open review exactly as the FAIL-carried gate does:
 * the review re-renders listing the gate, the next verdict grades it, and no attempt is counted,
 * since no verdict was given. An id the review already holds is a no-op; a gate on another node
 * keeps its refusal. Every leg reads the reply, then the run's own row.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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

const PASS = 'GATE_REVIEW: PASS - ok';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gate';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
const CRITERION = 'TGT-279-J';

type Tool = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ isError: boolean; text: string }>;

interface ReviewRow {
  gateIds: string[];
  attemptCount: number;
}

interface RunRow {
  current: string | null;
  reviews: Record<string, ReviewRow>;
}

const withStateDb = <T>(runtimeRoot: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
  try {
    return read(db);
  } finally {
    db.close();
  }
};

/** The run's stored state, byte for byte: a refusal must leave it untouched. */
const rawRun = (runtimeRoot: string, chainId: string): string | undefined =>
  withStateDb(
    runtimeRoot,
    (db) =>
      (
        db.prepare('SELECT state FROM chain_runs WHERE chain_id = ?').get(chainId) as
          { state: string } | undefined
      )?.state
  );

/** The run's current node and its open reviews (gate ids and attempt count), from its own row. */
const readRun = (runtimeRoot: string, chainId: string): RunRow =>
  withStateDb(runtimeRoot, (db) => {
    const row = db
      .prepare('SELECT state, current_node_id FROM chain_runs WHERE chain_id = ?')
      .get(chainId) as { state: string; current_node_id: string | null } | undefined;
    if (row === undefined) throw new Error(`no run for ${chainId}`);
    const state = JSON.parse(row.state) as {
      reviews?: Record<string, { gateIds: string[]; attemptCount: number }>;
    };
    return {
      current: row.current_node_id,
      reviews: Object.fromEntries(
        Object.entries(state.reviews ?? {}).map(([nodeId, review]) => [
          nodeId,
          { gateIds: review.gateIds, attemptCount: review.attemptCount },
        ])
      ),
    };
  });

/** A blocking gate and a three-step chain carrying it on every step: `a`, `b`, `c`. */
const authorFixtures = async (tool: Tool): Promise<void> => {
  const author = async (args: Record<string, unknown>): Promise<void> => {
    const result = await tool('resource_manager', args);
    if (result.isError) throw new Error(result.text);
  };
  await author({
    resource_type: 'gate',
    action: 'create',
    id: 'gj-block',
    name: 'gj-block',
    description: 'blocking e2e gate',
    guidance: 'GUIDANCE-gj-block',
    enforcement_mode: 'blocking',
  });
  for (const id of ['gj_a', 'gj_b']) {
    await author({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: id,
      description: `e2e step ${id}`,
      user_message_template: `BODY-${id}`,
      gate_configuration: OPT_OUT,
    });
  }
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'gj_chain',
    category: 'general',
    name: 'gj_chain',
    description: 'e2e chain with a blocking gate on every step',
    user_message_template: 'CHAIN-OWN-TEMPLATE',
    gate_configuration: OPT_OUT,
    chain_steps: [
      { promptId: 'gj_a', stepName: 'A', inlineGateIds: ['gj-block'] },
      { promptId: 'gj_b', stepName: 'B', inlineGateIds: ['gj-block'] },
      { promptId: 'gj_a', stepName: 'C', inlineGateIds: ['gj-block'] },
    ],
  });
};

/** A request gate on `target`; each test names its own id, since a registered id is one run's. */
const gateOn = (id: string, target = 'b') => ({
  id,
  name: id,
  criteria: [CRITERION],
  target_step_id: target,
});

/** The twins every transport runs, over that transport's `tool` and state root. */
const harness = (tool: Tool, runtimeRoot: () => string) => {
  const run = (chainId: string): RunRow => readRun(runtimeRoot(), chainId);

  /** A `>>gj_chain` run standing at `b` with `b`'s review open, ungraded, at attempt 0. */
  const openReviewOnB = async (): Promise<string> => {
    const opened = await tool('prompt_engine', { command: '>>gj_chain' });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(opened.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${opened.text.slice(0, 400)}`);
    await tool('prompt_engine', { chain_id: chainId, user_response: 'A out', gate_verdict: PASS });
    await tool('prompt_engine', { chain_id: chainId, user_response: 'B out' });
    expect(run(chainId)).toEqual({
      current: 'b',
      reviews: { b: { gateIds: ['gj-block'], attemptCount: 0 } },
    });
    return chainId;
  };

  const gatesOnly = (chainId: string, gates: Array<Record<string, unknown>>) =>
    tool('prompt_engine', { chain_id: chainId, gates });

  /** Twin (a): the gates-only call joins; the review re-renders it; no attempt is counted. */
  const joins = async (id: string): Promise<string> => {
    const chainId = await openReviewOnB();
    const before = run(chainId).reviews['b']?.attemptCount;

    const joined = await gatesOnly(chainId, [gateOn(id)]);

    expect(joined.text).not.toContain('gate-target-passed');
    expect(joined.isError).toBe(false);
    expect(joined.text).toContain('Gate Review Required');
    expect(joined.text).toContain(`### ${id}\n1. ${CRITERION}`);
    expect(joined.text).toContain('### gj-block');
    const after = run(chainId);
    expect(after).toEqual({
      current: 'b',
      reviews: { b: { gateIds: ['gj-block', id], attemptCount: 0 } },
    });
    expect(after.reviews['b']?.attemptCount).toBe(before);
    return chainId;
  };

  /** Twin (c): a gate on a node other than the reviewed one keeps its refusal; nothing moves. */
  const otherNodeRefused = async (id: string): Promise<void> => {
    const chainId = await openReviewOnB();
    const before = rawRun(runtimeRoot(), chainId);

    const refused = await gatesOnly(chainId, [gateOn(id, 'a')]);

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(
      '[gate-target-passed] node "a": target_step_id "a" names a step the run has already passed'
    );
    expect(rawRun(runtimeRoot(), chainId)).toBe(before);
  };

  return { run, openReviewOnB, gatesOnly, joins, otherNodeRefused };
};

describe('Streamable HTTP: a gates-only call joins its step open review (P6.279, R173)', () => {
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
    const roots = createHermeticRoots('gates-only-review-join-e2e');
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
    client = new ModernMcpClient(baseUrl, 'gates-only-review-join-e2e');
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('(a) a gates-only call with a gate on b joins its open review and counts no attempt', async () => {
    await twins.joins('j279a');
  }, 120000);

  test('(a) the next verdicts grade the joined gate; the join spent none of the two attempts', async () => {
    const chainId = await twins.joins('j279g');
    const fail = (answer: string) =>
      tool('prompt_engine', { chain_id: chainId, user_response: answer, gate_verdict: FAIL });

    const first = await fail('B again');
    expect(first.text).toContain('"satisfied": ["gj-block", "j279g"]');
    expect(first.text).toContain('(attempt 2/2)');
    expect(twins.run(chainId).reviews['b']).toEqual({
      gateIds: ['gj-block', 'j279g'],
      attemptCount: 1,
    });

    // Exhausted on the second FAIL after the join, not the first: the join counted no attempt.
    const second = await fail('B once more');
    expect(second.text).toContain(
      'The following gates failed after 2 attempts: **gj-block, j279g**'
    );
  }, 120000);

  test('(a) a PASS after the join closes the review and advances', async () => {
    const chainId = await twins.joins('j279p');

    const passed = await tool('prompt_engine', {
      chain_id: chainId,
      user_response: 'B fixed',
      gate_verdict: PASS,
    });
    expect(passed.text).toContain('BODY-gj_a');
    expect(passed.text).toContain('Progress 3/3');
    expect(twins.run(chainId)).toEqual({ current: 'c', reviews: {} });
  }, 120000);

  test('(b) a gate id the review already holds is a no-op, not a refusal', async () => {
    const chainId = await twins.joins('j279b');

    const again = await twins.gatesOnly(chainId, [gateOn('j279b')]);

    expect(again.isError).toBe(false);
    expect(again.text).not.toContain('gate-target-passed');
    expect(again.text).toContain('### j279b');
    expect(twins.run(chainId)).toEqual({
      current: 'b',
      reviews: { b: { gateIds: ['gj-block', 'j279b'], attemptCount: 0 } },
    });
  }, 120000);

  test('(c) control: a gate on a node other than the reviewed one keeps its refusal', async () => {
    await twins.otherNodeRefused('o279');
  }, 120000);
});

describe('STDIO: a gates-only call joins its step open review (P6.279, R173 transport parity)', () => {
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
    const roots = createHermeticRoots('gates-only-review-join-stdio-e2e');
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
      clientInfo: { name: 'gates-only-review-join-stdio-e2e', version: '1.0.0' },
    });
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('(a) over STDIO a gates-only call with a gate on b joins its open review and counts no attempt', async () => {
    await twins.joins('s279a');
  }, 120000);

  test('(c) control over STDIO: a gate on a node other than the reviewed one keeps its refusal', async () => {
    await twins.otherNodeRefused('s279o');
  }, 120000);
});
