// @lifecycle test - P6.288 / R180: a chain step's review render carries the step author's system message, over Streamable HTTP and STDIO.
/**
 * MEASURED 2026-10-04 on `ebe8936fb` (driven, hermetic, shipped CAGEERF; drive log
 * `/tmp/claude-prompts-mcp-pr-p7k-p288-before.log`): a gated chain's first render is a review of
 * step 1, and it carried no trace of the step's authored system message, while the same step's
 * normal render quotes it as a `> ` line. #432 had added the message to the INITIAL DELEGATED
 * review only (the worker brief); a review the parent does itself still dropped it.
 *
 * Now (R180) every first-attempt review render carries the step author's system message, as the
 * normal render does: the review grades work that message shaped. It quotes the author's text from
 * the catalog: on a run's first call the step's own copy also carries the injected framework
 * guidance, which the review keeps showing in its framework block. Controls: a reviewed step with
 * no system message renders no `> ` line at all, on the first call and on a resume. Every leg reads
 * the reply, then the run's own row.
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
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
const SYSTEM_MESSAGE = 'SYSMSG-288-A';

type Tool = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ isError: boolean; text: string }>;

interface RunRow {
  current: string | null;
  reviews: Record<string, number>;
}

/** The run's current node and each open review's attempt count, from its own row. */
const readRun = (runtimeRoot: string, chainId: string): RunRow => {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
  try {
    const row = db
      .prepare('SELECT state, current_node_id FROM chain_runs WHERE chain_id = ?')
      .get(chainId) as { state: string; current_node_id: string | null } | undefined;
    if (row === undefined) throw new Error(`no run for ${chainId}`);
    const state = JSON.parse(row.state) as { reviews?: Record<string, { attemptCount: number }> };
    return {
      current: row.current_node_id,
      reviews: Object.fromEntries(
        Object.entries(state.reviews ?? {}).map(([nodeId, review]) => [nodeId, review.attemptCount])
      ),
    };
  } finally {
    db.close();
  }
};

/** Every `> ` quote line: the shape a step render gives its author's system message. */
const quoteLines = (text: string): string[] =>
  text.split('\n').filter((line) => line.startsWith('> '));

/** A blocking gate, a step with a system message (`a`), one without (`b`), and their chain. */
const authorFixtures = async (tool: Tool): Promise<void> => {
  const author = async (args: Record<string, unknown>): Promise<void> => {
    const result = await tool('resource_manager', args);
    if (result.isError) throw new Error(result.text);
  };
  await author({
    resource_type: 'gate',
    action: 'create',
    id: 'p288-block',
    name: 'p288-block',
    description: 'blocking e2e gate',
    guidance: 'GUIDANCE-p288',
    enforcement_mode: 'blocking',
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'p288_a',
    category: 'general',
    name: 'p288_a',
    description: 'a step with an authored system message',
    system_message: SYSTEM_MESSAGE,
    user_message_template: 'BODY-288-A',
    gate_configuration: OPT_OUT,
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'p288_b',
    category: 'general',
    name: 'p288_b',
    description: 'a step with no system message',
    user_message_template: 'BODY-288-B',
    gate_configuration: OPT_OUT,
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'p288_chain',
    category: 'general',
    name: 'p288_chain',
    description: 'a chain whose every step carries a blocking gate',
    user_message_template: 'CHAIN-288',
    gate_configuration: OPT_OUT,
    chain_steps: [
      { promptId: 'p288_a', stepName: 'A', inlineGateIds: ['p288-block'] },
      { promptId: 'p288_b', stepName: 'B', inlineGateIds: ['p288-block'] },
    ],
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'p288_b_first',
    category: 'general',
    name: 'p288_b_first',
    description: 'a chain whose gated first step has no system message',
    user_message_template: 'CHAIN-288-B-FIRST',
    gate_configuration: OPT_OUT,
    chain_steps: [{ promptId: 'p288_b', stepName: 'B', inlineGateIds: ['p288-block'] }],
  });
};

/** The twins every transport runs, over that transport's `tool` and state root. */
const harness = (tool: Tool, runtimeRoot: () => string) => {
  const start = async (chain = 'p288_chain'): Promise<{ chainId: string; text: string }> => {
    const opened = await tool('prompt_engine', { command: `>>${chain}` });
    expect(opened.isError).toBe(false);
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(opened.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${opened.text.slice(0, 400)}`);
    return { chainId, text: opened.text };
  };

  /** Twin: the first render reviews `a`, and quotes `a`'s system message exactly once. */
  const reviewCarriesSystemMessage = async (): Promise<void> => {
    const { chainId, text } = await start();
    expect(readRun(runtimeRoot(), chainId)).toEqual({ current: 'a', reviews: { a: 0 } });
    expect(text).toContain('## Original Task Instructions');
    expect(quoteLines(text)).toEqual([`> ${SYSTEM_MESSAGE}`]);
    // The framework still renders once, in its own block: the step's first-call copy of the
    // message also carries the injected framework text, and is not what the review quotes.
    expect(text.split('Framework Active')).toHaveLength(2);
  };

  /** Control: a first-call review of a step with no system message quotes nothing. */
  const firstReviewWithoutSystemMessageQuotesNothing = async (): Promise<void> => {
    const { chainId, text } = await start('p288_b_first');
    expect(readRun(runtimeRoot(), chainId)).toEqual({ current: 'b', reviews: { b: 0 } });
    expect(text).toContain('BODY-288-B');
    expect(text.split('Framework Active')).toHaveLength(2);
    expect(quoteLines(text)).toEqual([]);
  };

  /** Control: a first-attempt review of `b`, which has no system message, quotes nothing. */
  const reviewWithoutSystemMessageQuotesNothing = async (): Promise<void> => {
    const { chainId } = await start();
    await tool('prompt_engine', { chain_id: chainId, user_response: 'A out', gate_verdict: PASS });
    const reviewed = await tool('prompt_engine', { chain_id: chainId, user_response: 'B out' });
    expect(reviewed.isError).toBe(false);
    expect(readRun(runtimeRoot(), chainId)).toEqual({ current: 'b', reviews: { b: 0 } });
    expect(reviewed.text).toContain('## Original Task Instructions');
    expect(reviewed.text).toContain('BODY-288-B');
    expect(quoteLines(reviewed.text)).toEqual([]);
  };

  return {
    reviewCarriesSystemMessage,
    firstReviewWithoutSystemMessageQuotesNothing,
    reviewWithoutSystemMessageQuotesNothing,
  };
};

describe('Streamable HTTP: a review render carries the step author system message (P6.288, R180)', () => {
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
    const roots = createHermeticRoots('review-render-system-message-e2e');
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
    client = new ModernMcpClient(baseUrl, 'review-render-system-message-e2e');
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('a gated chain first render reviews step a and quotes its system message once', async () => {
    await twins.reviewCarriesSystemMessage();
  }, 120000);

  test('control: a first-call review of a step with no system message quotes nothing', async () => {
    await twins.firstReviewWithoutSystemMessageQuotesNothing();
  }, 120000);

  test('control: a first-attempt review of a step with no system message quotes nothing', async () => {
    await twins.reviewWithoutSystemMessageQuotesNothing();
  }, 120000);
});

describe('STDIO: a review render carries the step author system message (P6.288, R180 transport parity)', () => {
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
    const roots = createHermeticRoots('review-render-system-message-stdio-e2e');
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
      clientInfo: { name: 'review-render-system-message-stdio-e2e', version: '1.0.0' },
    });
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('over STDIO a gated chain first render reviews step a and quotes its system message once', async () => {
    await twins.reviewCarriesSystemMessage();
  }, 120000);

  test('control over STDIO: a first-call review of a step with no system message quotes nothing', async () => {
    await twins.firstReviewWithoutSystemMessageQuotesNothing();
  }, 120000);

  test('control over STDIO: a first-attempt review of a step with no system message quotes nothing', async () => {
    await twins.reviewWithoutSystemMessageQuotesNothing();
  }, 120000);
});
