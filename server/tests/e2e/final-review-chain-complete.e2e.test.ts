// @lifecycle test - P4.157: chain/complete fires only once the final step's review closes, over Streamable HTTP.
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { createHermeticRoots } from './helpers/child-env.js';
import { cageerfAnswer } from './helpers/cageerf-answer.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
  type StreamNotification,
} from './helpers/http-mcp-client.js';

const CHAIN_COMPLETE = 'notifications/chain/complete';

interface ToolOutcome {
  text: string;
  isError: boolean;
  methods: string[];
}

async function startSession(): Promise<{
  call: (args: Record<string, unknown>) => Promise<ToolOutcome>;
  stop: () => Promise<void>;
  cleanup: () => void;
}> {
  const roots = createHermeticRoots('final-review-e2e');
  const workspace = path.join(roots.root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = startServerWithHttp(port, {
    env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
  });
  await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
  const client = new ModernMcpClient(baseUrl, 'final-review-e2e');
  let nextId = 1;
  return {
    call: async (args) => {
      const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        isError: result?.isError === true,
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
      };
    },
    stop: () => killServer(proc),
    cleanup: roots.cleanup,
  };
}

function chainIdOf(text: string): string {
  const match = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text);
  if (match?.[1] === undefined) throw new Error(`no chain id in: ${text.slice(0, 400)}`);
  return match[1];
}

const PASS = 'GATE_REVIEW: PASS - three options with tradeoffs';

describe('Streamable HTTP: chain/complete waits for the final review (P4.157)', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** Drive `quick_decision` to its final step, answering steps 1 and 2 in sections with a PASS. */
  async function atFinalStep(): Promise<(args: Record<string, unknown>) => Promise<ToolOutcome>> {
    const s = await startSession();
    teardown.push(s.stop, s.cleanup);
    const start = await s.call({ command: '>>quick_decision topic:"pick a database"' });
    const chainId = chainIdOf(start.text);
    const call = (args: Record<string, unknown>) => s.call({ chain_id: chainId, ...args });
    for (const step of [1, 2]) {
      const answered = await call({
        user_response: cageerfAnswer(`Step ${step}`),
        gate_verdict: PASS,
      });
      expect(answered.methods).not.toContain(CHAIN_COMPLETE);
    }
    return call;
  }

  test('positive control: a final answer that closes every review announces chain/complete', async () => {
    const call = await atFinalStep();
    const final = await call({ user_response: cageerfAnswer('Step 3'), gate_verdict: PASS });
    expect(final.isError).toBe(false);
    expect(final.text).not.toContain('Review Required');
    expect(final.methods).toContain(CHAIN_COMPLETE);
  }, 120000);

  /**
   * The defect this pins (measured 2026-09-23 on d2083622): the one-line final answer's call
   * carried `chain/complete` AND opened the structural review, and the verdict call that closed it
   * carried nothing — the store latched `completed` at the capture's advance past the last node
   * (stage 16), before the phase guard (stage 19) graded that answer. Completion is now decided
   * once, after grading (stage 20 → `completeHeldRun`, R12).
   */
  test("chain/complete waits for the final step's structural review to close", async () => {
    const call = await atFinalStep();
    const opened = await call({ user_response: 'one line', gate_verdict: PASS });
    expect(opened.text).toContain('Structural Review Required');
    expect(opened.methods).not.toContain(CHAIN_COMPLETE);

    const closed = await call({
      user_response: cageerfAnswer('Step 3 again'),
      gate_verdict: PASS,
    });
    expect(closed.methods).toContain(CHAIN_COMPLETE);
  }, 120000);
});
