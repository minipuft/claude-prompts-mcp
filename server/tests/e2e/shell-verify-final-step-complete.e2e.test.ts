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
 *
 * Since R29 (P6.26) a pending check holds the step it grades, not only the run's end: the bounced
 * answers below never leave step 1, the passing call moves the run to step 2, and the run
 * completes on its last answer, announced once.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
  isError: boolean | undefined;
}

type Call = (args: Record<string, unknown>) => Promise<ToolOutcome>;
type RunRow = Record<'session_id' | 'chain_id' | 'run_owner_pid' | 'run_status' | 'state', string>;

describe('Streamable HTTP: a failing shell verification on the last step holds the run', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** Start `quick_decision` with an inline verification of `marker`, which the caller controls. */
  async function startVerifiedChain(markerPresent: boolean, loop = false) {
    const roots = createHermeticRoots('shell-final-e2e');
    teardown.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const marker = path.join(roots.root, 'verified');
    const counter = path.join(roots.root, 'executions');
    if (markerPresent) writeFileSync(marker, 'ok');
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      source: loop,
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
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
        isError: result?.isError,
      };
    };
    const start = await raw({
      command: loop
        ? `>>quick_decision topic:"pick a database" :: verify:"printf x >> ${counter}; exit 1" loop:true max:5`
        : `>>quick_decision topic:"pick a database" :: verify:"test -f ${marker}"`,
    });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    return {
      call: (args: Record<string, unknown>) => raw({ chain_id: chainId, ...args }),
      start,
      marker,
      raw,
      chainId,
      runtimeRoot: roots.runtimeRoot,
      serverPid: proc.pid,
      counter,
    };
  }

  const answer = (call: Call, label: string): Promise<ToolOutcome> =>
    call({ user_response: cageerfAnswer(label), gate_verdict: PASS });

  const completions = (outcome: ToolOutcome): number =>
    outcome.methods.filter((m) => m === CHAIN_COMPLETE).length;

  /** Answer three times with the marker absent: every answer bounces on step 1, none completes. */
  async function bounceEveryStep(call: Call): Promise<void> {
    for (const step of [1, 2, 3]) {
      const bounced = await answer(call, `Step ${step}`);
      expect(bounced.text).toContain('Shell Verification FAILED');
      expect(completions(bounced)).toBe(0);
    }
  }

  test('a bounce holds the step; the passing call moves on and the last answer completes once', async () => {
    const { call, start, marker } = await startVerifiedChain(false);
    // The render call runs no check (P6.27): the first answer spends the first attempt.
    expect(start.text).not.toContain('Shell Verification FAILED');
    await bounceEveryStep(call);

    // A failing re-run on a call that captured no step keeps the hold.
    const stillFailing = await call({ user_response: 'not fixed yet' });
    expect(stillFailing.text).toContain('Shell Verification FAILED');
    expect(completions(stillFailing)).toBe(0);

    writeFileSync(marker, 'ok');
    // MEASURED 2026-09-25 (P6.74): the steps now run and carry their own review gates, so the
    // answer the check releases also needs its verdict.
    const fixed = await call({ user_response: 'fixed', gate_verdict: PASS });
    expect(fixed.text).not.toContain('Shell Verification FAILED');
    expect(fixed.text).toContain('Progress 2/3');
    expect(completions(fixed)).toBe(0);

    await answer(call, 'Step 2');
    const last = await answer(call, 'Step 3');
    expect(last.text).toContain('Chain complete');
    expect(completions(last)).toBe(1);

    const after = await call({ user_response: 'after' });
    expect(after.text).toContain('Chain run already complete');
    expect(after.text).toContain('Status: completed');
    expect(completions(after)).toBe(0);
  }, 180000);

  // Run-level abort cancels before the pipeline, retaining the hold history. The cancelled run
  // refuses later progression, and `chain/complete` announces its terminal status once.
  test('abort after escalation releases the hold by cancelling the run, announced once', async () => {
    const { call } = await startVerifiedChain(false);
    await bounceEveryStep(call);
    await call({ user_response: 'fourth attempt' });
    const escalated = await call({ user_response: 'fifth attempt' });
    expect(escalated.text).toContain('Maximum Attempts Reached');
    expect(completions(escalated)).toBe(0);

    const aborted = await call({ gate_action: 'abort' });
    expect(aborted.isError).toBe(false);
    expect(aborted.text).toContain('🛑 **Chain Cancelled**');
    expect(completions(aborted)).toBe(1);

    const after = await call({ user_response: 'after' });
    expect(after.text).toContain('Chain run already complete');
    expect(after.text).toContain('Status: cancelled');
    expect(completions(after)).toBe(0);
  }, 180000);

  test('early loop abort clears only the producer-owned active row', async () => {
    const fixture = await startVerifiedChain(false, true);
    const bounced = await answer(fixture.call, 'Captured early answer');
    expect(bounced.text).toContain('Shell Verification FAILED');
    expect(completions(bounced)).toBe(0);
    expect(readFileSync(fixture.counter, 'utf8')).toBe('x');
    const other = await fixture.raw({
      command: '>>quick_decision topic:"unrelated" :: verify:"exit 2" loop:true max:5',
    });
    const otherId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(other.text)?.[1];
    if (otherId === undefined || fixture.serverPid === undefined)
      throw new Error('fixture missing identity');
    const directory = path.join(fixture.runtimeRoot, 'runtime-state');
    const runs = new DatabaseSync(path.join(directory, 'state.db'), { readOnly: true });
    const verify = new DatabaseSync(path.join(directory, 'verify-state.db'), { readOnly: true });
    try {
      const readRun = (id: string) => {
        const row = runs
          .prepare(
            'SELECT session_id, chain_id, run_owner_pid, run_status, state FROM chain_runs ' +
              'WHERE chain_id = ? AND run_owner_pid = ?'
          )
          .get(id, String(fixture.serverPid)) as RunRow | undefined;
        if (row === undefined) throw new Error(`no producer-owned run for ${id}`);
        return row;
      };
      const before = readRun(fixture.chainId);
      const unrelated = readRun(otherId);
      expect(before.run_status).toBe('working');
      const pending = JSON.parse(before.state).pendingShellVerification;
      expect(pending.shellVerify.loop).toBe(true);
      expect(pending.attemptCount).toBe(1);
      expect(pending.maxAttempts).toBe(5);
      const activeRows = verify
        .prepare('SELECT session_id, state_json FROM verify_active_state')
        .all() as Array<{ session_id: string; state_json: string }>;
      const matching = activeRows.filter((row) =>
        JSON.parse(row.state_json).config.command.includes(fixture.counter)
      );
      expect(matching).toHaveLength(1);
      const active = matching[0];
      if (active === undefined) throw new Error('producer did not arm the target');
      expect(JSON.parse(active.state_json).sessionId).toBe(active.session_id);
      expect(JSON.parse(active.state_json).config.command).toBe(
        JSON.parse(before.state).pendingShellVerification.shellVerify.command
      );
      const otherActive = activeRows.find(
        (row) =>
          JSON.parse(row.state_json).config.command ===
          JSON.parse(unrelated.state).pendingShellVerification.shellVerify.command
      );
      if (otherActive === undefined) throw new Error('producer did not arm the unrelated run');
      const nodes = runs.prepare(
        'SELECT * FROM chain_run_nodes WHERE session_id = ? ORDER BY position'
      );
      const beforeNodes = nodes
        .all(before.session_id)
        .map(({ updated_at: _writeClock, ...node }) => node);
      expect(beforeNodes.length).toBeGreaterThan(0);
      expect(beforeNodes[0]?.['rendered_at']).toBeGreaterThan(0);
      const aborted = await fixture.call({ gate_action: 'abort' });
      const after = readRun(fixture.chainId);
      const repeated = await fixture.call({ gate_action: 'abort' });
      const resumed = await fixture.call({ user_response: 'after cancellation' });
      const targetActiveAfter = verify
        .prepare('SELECT state_json FROM verify_active_state WHERE session_id = ?')
        .get(active.session_id);
      const unrelatedActiveAfter = verify
        .prepare('SELECT state_json FROM verify_active_state WHERE session_id = ?')
        .get(otherActive.session_id);
      const history = runs
        .prepare(
          "SELECT COUNT(*) AS count FROM execution_records WHERE session_id = ? AND status = 'cancelled'"
        )
        .get(before.session_id) as { count: number };
      const counterAfter = readFileSync(fixture.counter, 'utf8');
      const data = [before, after, active, targetActiveAfter, history];
      const effects = [unrelatedActiveAfter, aborted, repeated, resumed, counterAfter];
      console.log('[early-loop-data]', JSON.stringify(data));
      console.log('[early-loop-effects]', JSON.stringify(effects));
      expect(aborted.isError).toBe(false);
      expect(completions(aborted)).toBe(1);
      expect(repeated.isError).toBe(false);
      expect(completions(repeated)).toBe(0);
      expect(after.run_status).toBe('cancelled');
      expect(history.count).toBe(1);
      expect(JSON.parse(after.state).pendingShellVerification).toEqual(
        JSON.parse(before.state).pendingShellVerification
      );
      expect(
        nodes.all(before.session_id).map(({ updated_at: _writeClock, ...node }) => node)
      ).toEqual(beforeNodes);
      expect(unrelatedActiveAfter).toEqual({ state_json: otherActive.state_json });
      expect(resumed.text).toContain('Status: cancelled');
      expect(counterAfter).toBe('x');
      expect(targetActiveAfter).toBeUndefined();
    } finally {
      runs.close();
      verify.close();
    }
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
