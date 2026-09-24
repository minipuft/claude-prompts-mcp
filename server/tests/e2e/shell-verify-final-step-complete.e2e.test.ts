// @lifecycle test - P4.157 / R12 / R15: a failing shell verification on a chain's last step holds the run until a later call passes it, over Streamable HTTP.
/**
 * Completion is asked once per call, AFTER the pipeline's stage loop.
 *
 * MEASURED 2026-09-23 on `998c5a74` (ask in stage 20): `>>quick_decision … :: verify:"test -f M"`
 * with M absent. Every answer is captured and advances the run (stage 16) before the verification
 * (stage 17) bounces the call, so the final step's bounce left the run past its last node,
 * `working`, and every later call was answered "already complete" by stage 13 — no call could
 * complete the run or re-run the verification.
 *
 * MEASURED 2026-09-23 on `cb5866ca` (ask after the stage loop, #384): the run completed ON the
 * final step's bounce, so `chain/complete` announced a run whose last answer had failed its check,
 * and the fix could never be verified.
 *
 * Now (R15) the pending verification holds its node through `nodesHoldingRunOpen`: the bounce
 * carries no `chain/complete`, a failing re-run keeps holding, and the call that passes the check
 * completes the run and announces it exactly once.
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

describe('Streamable HTTP: a failing shell verification on the last step holds the run', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** Start `quick_decision` with an inline verification of `marker`, which the caller controls. */
  async function startVerifiedChain(
    markerPresent: boolean
  ): Promise<{ call: Call; start: ToolOutcome; marker: string }> {
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
    return { call: (args) => raw({ chain_id: chainId, ...args }), start, marker };
  }

  const answer = (call: Call, label: string): Promise<ToolOutcome> =>
    call({ user_response: cageerfAnswer(label), gate_verdict: PASS });

  const completions = (outcome: ToolOutcome): number =>
    outcome.methods.filter((m) => m === CHAIN_COMPLETE).length;

  /** Answer all three steps with the marker absent: every answer bounces, none completes. */
  async function bounceEveryStep(call: Call): Promise<void> {
    for (const step of [1, 2, 3]) {
      const bounced = await answer(call, `Step ${step}`);
      expect(bounced.text).toContain('Shell Verification FAILED');
      expect(completions(bounced)).toBe(0);
    }
  }

  test("the final step's bounce holds the run; the call that passes the check completes it once", async () => {
    const { call, start, marker } = await startVerifiedChain(false);
    expect(start.text).toContain('Shell Verification FAILED');
    await bounceEveryStep(call);

    // A failing re-run on a call that captured no step keeps the hold.
    const stillFailing = await call({ user_response: 'not fixed yet' });
    expect(stillFailing.text).toContain('Shell Verification FAILED');
    expect(completions(stillFailing)).toBe(0);

    writeFileSync(marker, 'ok');
    const fixed = await call({ user_response: 'fixed' });
    expect(fixed.text).not.toContain('Shell Verification FAILED');
    expect(fixed.text).toContain('Chain complete');
    expect(completions(fixed)).toBe(1);

    const after = await call({ user_response: 'after' });
    expect(after.text).toContain('Chain run already complete');
    expect(after.text).toContain('Status: completed');
    expect(completions(after)).toBe(0);
  }, 180000);

  // Abort releases the hold by CANCELLING the run: stage 17 clears the snapshot and calls
  // `cancelChain`, and the completion guard holds only `completed` — `cancelled` stays reachable
  // so an operator can always end a run. `chain/complete` announces any terminal status.
  test('abort after escalation releases the hold by cancelling the run, announced once', async () => {
    const { call } = await startVerifiedChain(false);
    await bounceEveryStep(call);
    const escalated = await call({ user_response: 'fifth attempt' });
    expect(escalated.text).toContain('Maximum Attempts Reached');
    expect(completions(escalated)).toBe(0);

    const aborted = await call({ gate_action: 'abort' });
    expect(aborted.text).toContain('Shell Verification — Aborted');
    expect(completions(aborted)).toBe(1);

    const after = await call({ user_response: 'after' });
    expect(after.text).toContain('Chain run already complete');
    expect(after.text).toContain('Status: cancelled');
    expect(completions(after)).toBe(0);
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
