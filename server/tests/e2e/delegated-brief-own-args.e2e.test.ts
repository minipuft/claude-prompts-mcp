// @lifecycle test - Row P6.41: a delegated node's brief states that node's own request, over Streamable HTTP.
/**
 * Every node of a compiled workflow rendered the run's invocation args under
 * "### Original Request Intent", and a run's invocation args are its FIRST node's
 * (`compileWorkflowIR` → `promptArgs`). So each worker's brief opened with row 1's request.
 *
 * MEASURED on `e9a17633` (2026-09-25): the second node's brief listed `task: row one` and
 * `row_id: R1` under that heading, and the first step rendered no such section at all (the run's
 * args are read from the argument history, which is empty until a step is captured).
 *
 * Rule: a node's own args render under the heading; the run's args are the fallback for a node
 * that has none. Control: a YAML chain gives every step the command's args, so every step still
 * shows them.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const INTENT_HEADING = '### Original Request Intent';

/** The bullets under the intent heading, or `undefined` when the reply renders no such section. */
function intentOf(text: string): string | undefined {
  const start = text.indexOf(INTENT_HEADING);
  if (start === -1) return undefined;
  const lines = text.slice(start).split('\n').slice(1);
  const bullets: string[] = [];
  for (const line of lines) {
    if (line.startsWith('- **')) bullets.push(line);
    else if (bullets.length > 0) break;
  }
  return bullets.join('\n');
}

function tokenOf(brief: string): string {
  const match = /^node:\s*(\S+)\s*$/m.exec(brief);
  if (match?.[1] === undefined) throw new Error(`no node token in: ${brief.slice(0, 400)}`);
  return match[1];
}

function chainIdOf(text: string): string {
  const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text)?.[1];
  if (chainId === undefined) throw new Error(`no chain id in: ${text.slice(0, 400)}`);
  return chainId;
}

describe('Streamable HTTP: a delegated brief states its own node args (P6.41)', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  async function startClient(name: string) {
    const roots = createHermeticRoots(name);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
    });
    teardown.push(() => killServer(proc), roots.cleanup);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, name);
    let nextId = 1;
    return async (args: Record<string, unknown>): Promise<string> => {
      const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
      const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
      return (result?.content ?? []).map((part) => part.text ?? '').join('\n');
    };
  }

  test('the third node of a submitted workflow renders row three, not row one', async () => {
    const call = await startClient('delegated-brief-args-e2e');
    const node = (id: string, row: string, task: string, delegated: boolean) => ({
      id,
      promptId: 'strategic_worker',
      args: { task, row_id: row },
      ...(delegated ? { delegated: true } : {}),
    });
    const start = await call({
      workflow: {
        version: 1,
        nodes: [
          node('r1', 'R1', 'row one', false),
          node('r2', 'R2', 'row two', true),
          node('r3', 'R3', 'row three', true),
        ],
      },
    });
    expect(intentOf(start)).toContain('- **task**: row one');
    const resume = (args: Record<string, unknown>) => call({ chain_id: chainIdOf(start), ...args });

    const second = await resume({ user_response: 'Row one done.' });
    expect(second).toContain('EXECUTION BRIEF');
    expect(intentOf(second)).toContain('- **task**: row two');
    expect(intentOf(second)).not.toContain('row one');

    const third = await resume({
      user_response: `done: row two is in.\n\nHANDOFF RESULT\nnode: ${tokenOf(second)}`,
    });
    expect(third).toContain('→ Progress 3/3'); // positive control: the run reached node 3
    const intent = intentOf(third);
    expect(intent).toContain('- **task**: row three');
    expect(intent).toContain('- **row_id**: R3');
    expect(intent).not.toContain('row one');
    expect(intent).not.toContain('R1');
  }, 180000);

  test('control: every step of a YAML chain still shows the command args', async () => {
    const call = await startClient('delegated-brief-args-control-e2e');
    const first = await call({ command: '%clean >>quick_decision topic:"latch"' });
    const resume = (args: Record<string, unknown>) => call({ chain_id: chainIdOf(first), ...args });
    const second = await resume({ user_response: 'Options listed.' });
    const third = await resume({ user_response: 'Tradeoffs weighed.' });
    expect(third).toContain('Recommendation'); // positive control: the run reached step 3
    for (const reply of [first, second, third]) {
      expect(intentOf(reply)).toContain('- **topic**: latch');
    }
  }, 180000);
});
