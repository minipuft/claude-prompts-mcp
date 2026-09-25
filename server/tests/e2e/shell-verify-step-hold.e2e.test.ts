// @lifecycle test - P6.26 / R29 and P6.44 / R24: a step under a pending shell check is held until the check passes or is skipped, over Streamable HTTP.
/**
 * MEASURED 2026-09-24 on `04b11390`: `>>quick_decision … :: verify:"test -f M"` with M absent.
 * Stage 16 captured the step's answer and advanced the run before stage 17 ran the check, so
 * each bounced reply still moved the chain and announced `step_complete`, and the reply that
 * finally passed landed on a later step than the one it fixed.
 *
 * Now (R29) the pending check holds its step as an open gate review does: the capture records
 * the answer and moves nothing, a bounce announces nothing, and the call whose check passes
 * moves the run past the held step with one `step_complete`. `gate_action: "skip"` on an
 * exhausted check releases the same hold (R24), and is refused by name with no answer to skip
 * past (P6.44).
 *
 * An inline `:: verify:` is armed once, when the run is created: once it passes it is cleared, so
 * the steps after the held one run unchecked (measured here, twin c).
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

const STEP_COMPLETE = 'notifications/chain/step_complete';
const CHAIN_COMPLETE = 'notifications/chain/complete';
const PASS = 'GATE_REVIEW: PASS - three options with tradeoffs';

interface ToolOutcome {
  text: string;
  methods: string[];
}

type Call = (args: Record<string, unknown>) => Promise<ToolOutcome>;

const count = (outcome: ToolOutcome, method: string): number =>
  outcome.methods.filter((m) => m === method).length;

describe('Streamable HTTP: a step under a pending shell check is held', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** Start `quick_decision` with an inline verification of `marker`, which the caller controls. */
  async function startVerifiedChain(
    markerPresent: boolean,
    verifyOptions = ''
  ): Promise<{ call: Call; raw: Call; start: ToolOutcome; marker: string; command: string }> {
    const roots = createHermeticRoots('shell-hold-e2e');
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
    const client = new ModernMcpClient(baseUrl, 'shell-hold-e2e');
    let nextId = 1;
    const raw: Call = async (args) => {
      const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
      const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
      };
    };
    const command = `>>quick_decision topic:"pick a database" :: verify:"test -f ${marker}"${verifyOptions}`;
    const start = await raw({ command });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    return { call: (args) => raw({ chain_id: chainId, ...args }), raw, start, marker, command };
  }

  const answer = (call: Call, label: string): Promise<ToolOutcome> =>
    call({ user_response: cageerfAnswer(label), gate_verdict: PASS });

  test('P6.26 (a): a bounced step stays put; the passing call moves it once', async () => {
    const { call, marker } = await startVerifiedChain(false);

    const bounced = await answer(call, 'Step 1');
    expect(bounced.text).toContain('Shell Verification FAILED');
    expect(count(bounced, STEP_COMPLETE)).toBe(0);

    const stillFailing = await call({ user_response: 'not fixed yet' });
    expect(stillFailing.text).toContain('Shell Verification FAILED');
    expect(count(stillFailing, STEP_COMPLETE)).toBe(0);

    writeFileSync(marker, 'ok');
    const fixed = await call({ user_response: 'fixed' });
    expect(fixed.text).not.toContain('Shell Verification FAILED');
    expect(fixed.text).toContain('Progress 2/3');
    expect(count(fixed, STEP_COMPLETE)).toBe(1);
  }, 180000);

  test('P6.26 (b) control: with the check passing, each step advances with one step_complete', async () => {
    const { call } = await startVerifiedChain(true);
    const seen: number[] = [];
    for (const step of [1, 2]) {
      const answered = await answer(call, `Step ${step}`);
      expect(answered.text).not.toContain('Shell Verification FAILED');
      expect(answered.text).toContain(`Progress ${step + 1}/3`);
      seen.push(count(answered, STEP_COMPLETE));
    }
    expect(seen).toEqual([1, 1]);
  }, 180000);

  test('P6.26 (c): once the held step is released, the last answer completes the run once', async () => {
    const { call, marker } = await startVerifiedChain(false);
    const first = await answer(call, 'Step 1');
    expect(first.text).toContain('Shell Verification FAILED');
    writeFileSync(marker, 'ok');
    expect(count(await call({ user_response: 'fixed' }), STEP_COMPLETE)).toBe(1);
    await answer(call, 'Step 2');
    const last = await answer(call, 'Step 3');
    expect(last.text).toContain('Chain complete');
    expect(count(last, CHAIN_COMPLETE)).toBe(1);
  }, 180000);

  test('P6.44 (a): skip on an exhausted check accepts the captured answer and advances', async () => {
    const { call } = await startVerifiedChain(false, ' max:2');
    await answer(call, 'Step 1');
    const escalated = await call({ user_response: 'still missing' });
    expect(escalated.text).toContain('Maximum Attempts Reached');
    expect(count(escalated, STEP_COMPLETE)).toBe(0);

    const skipped = await call({ gate_action: 'skip' });
    expect(skipped.text).toContain('Progress 2/3');
    expect(count(skipped, STEP_COMPLETE)).toBe(1);
  }, 180000);

  test('P6.44 (b) control: retry on an exhausted check resets attempts and keeps the step', async () => {
    const { call } = await startVerifiedChain(false, ' max:2');
    await answer(call, 'Step 1');
    await call({ user_response: 'still missing' });

    const retried = await call({ gate_action: 'retry' });
    expect(retried.text).toContain('Attempts:** 0/2');
    expect(count(retried, STEP_COMPLETE)).toBe(0);
  }, 180000);

  test('P6.44 (c): skip with no captured answer is refused by name', async () => {
    const { raw, command } = await startVerifiedChain(false);
    const refused = await raw({ command, gate_action: 'skip' });
    expect(refused.text).toContain('nothing to skip past on step 1; answer it first');
    expect(count(refused, STEP_COMPLETE)).toBe(0);
  }, 180000);
});
