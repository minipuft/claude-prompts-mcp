// @lifecycle test - P4.157 / R12: a shell-verification bounce on a chain's last step still completes the run, over Streamable HTTP.
/**
 * Completion is asked once per call, AFTER the pipeline's stage loop.
 *
 * MEASURED 2026-09-23 on `998c5a74` (ask in stage 20): `>>quick_decision … :: verify:"test -f M"`
 * with M absent. Every answer is captured and advances the run (stage 16) before the verification
 * (stage 17) bounces the call, and a stage that sets a response ends the loop — so the final
 * step's bounce left the run past its last node, `working`, with no `chain/complete`. Every later
 * call was answered "✓ Chain run already complete … Status: working" by the session stage
 * (stage 13), which also ends the loop before stage 20: no call could ever complete the run, and
 * the stage-17 verification never ran again, so there is no "call that clears the bounce".
 *
 * Now the run completes on the final step's bounce call. Whether a failed verification should
 * HOLD the run is a separate question: it does not hold the capture's advance either.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync, writeFileSync } from 'node:fs';
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
const PASS = 'GATE_REVIEW: PASS - three options with tradeoffs';

interface ToolOutcome {
  text: string;
  methods: string[];
}

type Call = (args: Record<string, unknown>) => Promise<ToolOutcome>;

describe('Streamable HTTP: a shell verification on the last step does not strand the run', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** Start `quick_decision` with an inline verification of `marker`, which the caller controls. */
  async function startVerifiedChain(
    markerPresent: boolean
  ): Promise<{ call: Call; start: ToolOutcome }> {
    const roots = createHermeticRoots('shell-final-e2e');
    teardown.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const marker = path.join(roots.root, 'verified');
    if (markerPresent) writeFileSync(marker, 'ok');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: {
        HOME: roots.home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: roots.runtimeRoot,
        MCP_SHELL_VERIFY_ALLOWLIST: 'UNSAFE_ALLOW_ALL',
      },
    });
    teardown.push(() => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'shell-final-e2e');
    let nextId = 1;
    const raw: Call = async (args) => {
      const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
      const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
      };
    };
    const start = await raw({
      command: `>>quick_decision topic:"pick a database" :: verify:"test -f ${marker}"`,
    });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    return { call: (args) => raw({ chain_id: chainId, ...args }), start };
  }

  const answer = (call: Call, label: string): Promise<ToolOutcome> =>
    call({ user_response: cageerfAnswer(label), gate_verdict: PASS });

  test('a bounce on the final step completes the run on that call, exactly once', async () => {
    const { call, start } = await startVerifiedChain(false);
    expect(start.text).toContain('Shell Verification FAILED');
    for (const step of [1, 2]) {
      const bounced = await answer(call, `Step ${step}`);
      expect(bounced.text).toContain('Shell Verification FAILED');
      expect(bounced.methods).not.toContain(CHAIN_COMPLETE);
    }

    const finalBounce = await answer(call, 'Step 3');
    expect(finalBounce.text).toContain('Shell Verification FAILED');
    expect(finalBounce.methods.filter((m) => m === CHAIN_COMPLETE)).toHaveLength(1);

    const after = await answer(call, 'fixed');
    expect(after.text).toContain('Chain run already complete');
    expect(after.text).toContain('Status: completed');
    expect(after.methods).not.toContain(CHAIN_COMPLETE);
  }, 180000);

  test('positive control: a passing verification announces chain/complete exactly once, on the final answer', async () => {
    const { call, start } = await startVerifiedChain(true);
    expect(start.text).not.toContain('Shell Verification FAILED');
    const seen: string[][] = [];
    for (const step of [1, 2, 3]) {
      const answered = await answer(call, `Step ${step}`);
      expect(answered.text).not.toContain('Shell Verification FAILED');
      seen.push(answered.methods);
    }
    expect(seen.map((methods) => methods.filter((m) => m === CHAIN_COMPLETE).length)).toEqual([
      0, 0, 1,
    ]);
  }, 180000);
});
