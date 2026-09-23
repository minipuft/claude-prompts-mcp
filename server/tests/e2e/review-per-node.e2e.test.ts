// @lifecycle test - Primitive rework Tier 3: a gate review is a record of one node's output, over Streamable HTTP.
/**
 * A review is keyed by the node whose output it grades, and that node is not always the one the
 * run stands on. Driven against a real spawned server under the shipped defaults (CAGEERF + the
 * default gates), reading each call's stream for the notifications a client acts on.
 *
 * Three flows live here, each beside a twin that differs in one input:
 *
 * - a structural review of step 1 opens after the capture already moved the run onto step 2, and
 *   a verdict on its own call answers step 1's review and leaves step 2 owed;
 * - the final step's verdict closes the run, and `chain/complete` is the run's last notification;
 * - a FAIL past the retry budget offers the retry prompt, a further verdict is refused, and
 *   `gate_action` retry / skip moves the review.
 *
 * A detached step's review at its late report is driven by `detached-review-at-report.e2e.test.ts`;
 * a final step's structural review holding `chain/complete` by `final-review-chain-complete.e2e.test.ts`.
 */
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

const STEP_COMPLETE = 'notifications/chain/step_complete';
const CHAIN_COMPLETE = 'notifications/chain/complete';
const RETRY_EXHAUSTED = 'notifications/gate/retry_exhausted';
/** Unique to `quick_decision`'s second step, so finding it says the run still owes step 2. */
const STEP_2_BODY = 'For each option identified, provide:';
const RETRY_PROMPT = 'Retry Limit Reached';
const PASS = 'GATE_REVIEW: PASS - the step meets its gates';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gates';

interface ToolOutcome {
  text: string;
  isError: boolean;
  methods: string[];
}

type Call = (args: Record<string, unknown>) => Promise<ToolOutcome>;

describe('Streamable HTTP: a gate review is a record of one node (shipped defaults)', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** A hermetic server running `quick_decision`; returns a caller bound to the run's chain id. */
  async function startRun(): Promise<Call> {
    const roots = createHermeticRoots('review-per-node-e2e');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
    });
    teardown.push(() => killServer(proc), roots.cleanup);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'review-per-node-e2e');
    let nextId = 1;
    const call: Call = async (args) => {
      const outcome = await client.callToolWithNotifications('prompt_engine', args, nextId++);
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        isError: result?.isError === true,
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
      };
    };
    const start = await call({ command: '>>quick_decision topic:"pick a database"' });
    const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    return (args) => call({ chain_id: chainId, ...args });
  }

  describe('a structural review of step 1 is answered on step 1 while the run stands on step 2', () => {
    test('the verdict closes step 1 review and step 2 is still owed', async () => {
      const call = await startRun();

      // The one-line answer passes its gate review, the capture moves the run onto step 2, and
      // the phase guard then opens a structural review of the step it just left.
      const opened = await call({ user_response: 'one line', gate_verdict: PASS });
      expect(opened.isError).toBe(false);
      expect(opened.methods).toContain(STEP_COMPLETE); // the stream is read
      expect(opened.text).toContain('Structural Review Required');
      expect(opened.text).toContain('→ Progress 2/3');

      const answered = await call({ gate_verdict: PASS });
      expect(answered.isError).toBe(false);
      expect(answered.text).not.toContain('Review Required');
      expect(answered.text).toContain(STEP_2_BODY);
      expect(answered.text).toContain('→ Progress 2/3');
      expect(answered.methods).not.toContain(STEP_COMPLETE);

      // Step 2 is answered next, and only that moves the run on.
      const step2 = await call({ user_response: cageerfAnswer('Step 2'), gate_verdict: PASS });
      expect(step2.text).toContain('→ Progress 3/3');
    }, 180000);

    /**
     * The twin differs in step 1's answer only. With no review of step 1 open, the same verdict
     * addresses the step the run stands on and moves the run past it — which is what shows the
     * `Progress 2/3` read above can see a move. Pinned as today's behaviour, not endorsed: that
     * verdict carries no step 2 output (see the row 3.7 handoff).
     */
    test('TWIN: with no review of step 1 open, the same verdict lands on step 2 and the run moves', async () => {
      const call = await startRun();

      const opened = await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: PASS });
      expect(opened.isError).toBe(false);
      expect(opened.text).not.toContain('Structural Review Required');
      expect(opened.text).toContain('→ Progress 2/3');

      const answered = await call({ gate_verdict: PASS });
      expect(answered.isError).toBe(false);
      expect(answered.text).toContain('→ Progress 3/3');
    }, 180000);
  });

  test("the final step's verdict closes the run, and chain/complete is its last notification", async () => {
    const call = await startRun();
    for (const step of [1, 2]) {
      await call({ user_response: cageerfAnswer(`Step ${step}`), gate_verdict: PASS });
    }

    // Answer and verdict on separate calls: the answer opens the final review, the run stays open.
    const reviewed = await call({ user_response: cageerfAnswer('Step 3') });
    expect(reviewed.isError).toBe(false);
    expect(reviewed.text).toContain('Gate Review Required');
    expect(reviewed.methods).toEqual([STEP_COMPLETE]); // positive control: the stream is read
    expect(reviewed.text).not.toContain('Chain complete');

    const closed = await call({ gate_verdict: PASS });
    expect(closed.isError).toBe(false);
    expect(closed.text).toContain('Chain complete');
    expect(closed.methods).toEqual([CHAIN_COMPLETE]);

    // Nothing after it: a resume of the completed run carries no notification.
    const after = await call({});
    expect(after.methods).toEqual([]);
  }, 180000);

  describe('a FAIL past the retry budget offers the retry prompt', () => {
    /** Two FAILs on step 1 spend the default budget of 2. */
    async function exhausted(): Promise<Call> {
      const call = await startRun();
      const first = await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: FAIL });
      expect(first.isError).toBe(false);
      // Control for the prompt below: a FAIL inside the budget does not offer it.
      expect(first.text).not.toContain(RETRY_PROMPT);
      expect(first.methods).not.toContain(RETRY_EXHAUSTED);

      const second = await call({
        user_response: cageerfAnswer('Step 1 again'),
        gate_verdict: FAIL,
      });
      expect(second.isError).toBe(false);
      expect(second.text).toContain(RETRY_PROMPT);
      expect(second.text).toContain('`gate_action: "retry"`');
      expect(second.text).toContain('`gate_action: "skip"`');
      expect(second.methods).toContain(RETRY_EXHAUSTED);
      return call;
    }

    test('a further verdict is refused and names gate_action; retry reopens the review at attempt 1', async () => {
      const call = await exhausted();

      const refused = await call({
        user_response: cageerfAnswer('Step 1 a third time'),
        gate_verdict: FAIL,
      });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('is waiting for gate_action "retry", "skip" or "abort"');
      expect(refused.text).toContain('Nothing was recorded');

      const retried = await call({ gate_action: 'retry' });
      expect(retried.isError).toBe(false);
      expect(retried.text).toContain('**Gate Review Required** (attempt 1/2)');
      expect(retried.text).not.toContain(RETRY_PROMPT);

      // The reopened review accepts a verdict again.
      const again = await call({
        user_response: cageerfAnswer('Step 1 retried'),
        gate_verdict: FAIL,
      });
      expect(again.isError).toBe(false);
      expect(again.text).not.toContain(RETRY_PROMPT);
    }, 180000);

    test('skip closes the review and the run keeps step 1', async () => {
      const call = await exhausted();

      const skipped = await call({ gate_action: 'skip' });
      expect(skipped.isError).toBe(false);
      expect(skipped.text).not.toContain('Review Required');
      expect(skipped.text).not.toContain(RETRY_PROMPT);
      expect(skipped.text).toContain('→ Progress 1/3');
      expect(skipped.text).not.toContain('gate_verdict="GATE_REVIEW');
    }, 180000);
  });
});
