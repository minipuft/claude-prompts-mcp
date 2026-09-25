// @lifecycle test - Primitive rework Tier 3: a gate review is a record of one node's output, over Streamable HTTP.
/**
 * A review is keyed by the node whose output it grades, and that node is not always the one the
 * run stands on. Driven against a real spawned server under the shipped defaults (CAGEERF + the
 * default gates), reading each call's stream for the notifications a client acts on.
 *
 * Three flows live here, each beside a twin that differs in one input:
 *
 * - a structural review of step 1 opens after the capture already moved the run onto step 2, and
 *   a verdict on its own call answers step 1's review and leaves step 2 owed; with no review
 *   open, the same bare verdict is refused and names the step to answer first;
 * - the final step's verdict closes the run, and `chain/complete` is the run's last notification;
 * - a FAIL past the retry budget offers the retry prompt and names only `gate_action` moves, a
 *   further verdict is refused, retry reopens the review, and skip accepts the step's recorded
 *   answer and moves the run on (R24) — or is refused on a step that holds none.
 *
 * A detached step's review at its late report is driven by `detached-review-at-report.e2e.test.ts`;
 * a final step's structural review holding `chain/complete` by `final-review-chain-complete.e2e.test.ts`.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  let runtimeRoot = '';
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** A hermetic server running `quick_decision`; returns a caller bound to the run's chain id. */
  async function startRun(): Promise<Call> {
    const roots = createHermeticRoots('review-per-node-e2e');
    runtimeRoot = roots.runtimeRoot;
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

  /**
   * Step 1's recorded output as the run's store holds it: its node row, and the answer the
   * argument history recorded for it (`kv_state` key `arg_history`).
   */
  function stepOneRecord(): { completed: boolean; history: string } {
    const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const node = db
        .prepare(
          'SELECT completed_at, is_placeholder FROM chain_run_nodes ORDER BY position LIMIT 1'
        )
        .get() as { completed_at: number | null; is_placeholder: number | null } | undefined;
      const history = db.prepare("SELECT state FROM kv_state WHERE key = 'arg_history'").get() as
        { state: string } | undefined;
      return {
        completed: node?.completed_at != null && node.is_placeholder !== 1,
        history: history?.state ?? '',
      };
    } finally {
      db.close();
    }
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
     * The twin differs in step 1's answer only. With no review of step 1 open, the verdict
     * addresses the review step 2 opened when it rendered — but step 2 holds no answer, and a
     * verdict sent without one captures nothing, so it advances nothing (R19). Before P6.22 it
     * moved the run past step 2 (`Progress 3/3`), which is what shows the `Progress 2/3` read
     * above can see a move.
     */
    test('TWIN: with no review of step 1 open, a bare verdict is refused and step 2 is still owed', async () => {
      const call = await startRun();

      const opened = await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: PASS });
      expect(opened.isError).toBe(false);
      expect(opened.text).not.toContain('Structural Review Required');
      expect(opened.text).toContain('→ Progress 2/3');

      const refused = await call({ gate_verdict: PASS });
      console.log('DEBUGREFUSED', JSON.stringify(refused));
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('Step 2 has no answer yet');
      expect(refused.text).toContain('Nothing was recorded');
      expect(refused.text).toContain('answer step 2 first');
      expect(refused.text).not.toContain('→ Progress 3/3');
      expect(refused.methods).not.toContain(STEP_COMPLETE);

      // The run still stands on step 2: answering it moves the run to 3, not past the end.
      const step2 = await call({ user_response: cageerfAnswer('Step 2'), gate_verdict: PASS });
      expect(step2.isError).toBe(false);
      expect(step2.text).toContain('→ Progress 3/3');
      expect(step2.methods).toContain(STEP_COMPLETE);
    }, 180000);

    /** Control for the refusal above: the same verdict WITH step 2's answer advances the run. */
    test('CONTROL: a verdict sent with step 2 answer advances the run', async () => {
      const call = await startRun();

      await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: PASS });
      const step2 = await call({ user_response: cageerfAnswer('Step 2'), gate_verdict: PASS });
      expect(step2.isError).toBe(false);
      expect(step2.text).toContain('→ Progress 3/3');
      expect(step2.methods).toContain(STEP_COMPLETE);
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

    /**
     * The exhausted reply names only the moves the exhausted review accepts (P6.23): R9 refuses
     * every verdict there, so offering one sent the caller into a refusal.
     */
    test('the exhausted reply offers gate_action and no verdict', async () => {
      const call = await startRun();
      const first = await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: FAIL });
      // CONTROL: a FAIL inside the budget still asks for the next verdict.
      expect(first.text).toContain('Gate Review Required');
      expect(first.text).toContain('gate_verdict="GATE_REVIEW: PASS|FAIL');

      const second = await call({
        user_response: cageerfAnswer('Step 1 again'),
        gate_verdict: FAIL,
      });
      expect(second.text).toContain(RETRY_PROMPT);
      expect(second.text).toContain('gate_action="retry" | gate_action="skip"');
      expect(second.text).not.toContain('gate_verdict=');
      expect(second.text).not.toContain('Gate Review Required');
    }, 180000);

    /**
     * R24: skip accepts the answer step 1 already holds and moves the run past it, announcing
     * step 1 on that call. Before, skip only cleared the review and the run stayed on step 1.
     */
    test('skip accepts the captured answer and the run moves to step 2', async () => {
      const call = await startRun();
      const first = await call({ user_response: cageerfAnswer('Step 1 kept'), gate_verdict: FAIL });
      expect(first.isError).toBe(false);
      await call({ user_response: cageerfAnswer('Step 1 again'), gate_verdict: FAIL });

      const skipped = await call({ gate_action: 'skip' });
      expect(skipped.isError).toBe(false);
      expect(skipped.text).not.toContain(RETRY_PROMPT);
      expect(skipped.text).toContain('→ Progress 2/3');
      expect(skipped.text).toContain(STEP_2_BODY);
      expect(skipped.methods).toContain(STEP_COMPLETE);

      // Step 1's recorded output is the answer it was captured with, unchanged by the skip.
      const record = stepOneRecord();
      expect(record.completed).toBe(true);
      expect(record.history).toContain('Step 1 kept');
      expect(record.history).not.toContain('Step 1 again');
    }, 180000);

    /** CONTROL for the move above: retry on the same exhausted review keeps the run on step 1. */
    test('CONTROL: retry reopens step 1 at attempt 1 and the run stays', async () => {
      const call = await exhausted();
      const retried = await call({ gate_action: 'retry' });
      expect(retried.isError).toBe(false);
      expect(retried.text).toContain('**Gate Review Required** (attempt 1/2)');
      expect(retried.text).toContain('→ Progress 1/3');
      expect(retried.methods).not.toContain(STEP_COMPLETE);
    }, 180000);

    /** R19: an exhausted review of a step that holds no answer has nothing to skip past. */
    test('skip on an exhausted review of an unanswered step is refused by name', async () => {
      const call = await startRun();
      await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: PASS });
      // Step 2's review opened when it rendered; two bare FAILs spend its budget.
      await call({ gate_verdict: FAIL });
      const spent = await call({ gate_verdict: FAIL });
      expect(spent.text).toContain(RETRY_PROMPT);

      const refused = await call({ gate_action: 'skip' });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('nothing to skip past on step 2; answer it first');
      expect(refused.methods).not.toContain(STEP_COMPLETE);
    }, 180000);
  });
});
