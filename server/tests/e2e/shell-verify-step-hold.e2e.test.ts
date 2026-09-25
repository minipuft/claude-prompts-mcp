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
 * MEASURED 2026-09-25 on `5c6027f3`: an inline `:: verify:` was armed once, when the run was
 * created, and cleared on its first pass, so every step after the first held one ran unchecked —
 * step 2 answered with the marker deleted advanced with the command never run.
 *
 * Now (R32) a chain-level check grades EVERY step's answer: once a pass or a skip releases step N
 * and the run stands on a later step, the check is pending again for it with a fresh attempt
 * budget, and the run completes only when the last step's check passes (P6.52).
 *
 * MEASURED 2026-09-25 on `253f91a5` (authored chain, one blocking gate per step): a check that
 * passed while the step's own review was open left the step to that review and was cleared, not
 * re-armed, so the review's PASS moved the run onto step 3 and step 3's answer completed the run
 * with the marker deleted and the command never run. The release also read only the step's own
 * review, while R14 lets an EARLIER node's open review hold a step.
 *
 * Now (P6.53) the release asks the one hold derivation the capture asks (`reviewHolding`), and a
 * step left to a review keeps the check armed for the next answer: an armed check holds only the
 * answer captured on the call, so the review's verdict moves the step and the next answer is
 * checked.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gate';
/** Opted out of the default gates, so each step carries exactly the one blocking gate below. */
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };

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
    verifyOptions = '',
    opening: { prompt?: string; user_response?: string; authored?: boolean } = {}
  ): Promise<{
    call: Call;
    raw: Call;
    start: ToolOutcome;
    marker: string;
    command: string;
    runs: () => number;
  }> {
    const roots = createHermeticRoots('shell-hold-e2e');
    teardown.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const marker = path.join(roots.root, 'verified');
    if (markerPresent) writeFileSync(marker, 'ok');
    // The check logs one line per run, so a test can count how often the command ran
    const runLog = path.join(roots.root, 'runs.log');
    const script = path.join(roots.root, 'check.sh');
    writeFileSync(script, `echo run >> "${runLog}"\ntest -f "${marker}"\n`);
    const runs = (): number =>
      existsSync(runLog) ? readFileSync(runLog, 'utf8').split('\n').filter(Boolean).length : 0;
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
    if (opening.authored === true) await authorBlockingChain(client, () => nextId++);
    const prompt =
      opening.prompt ??
      (opening.authored === true ? 'sv_chain' : 'quick_decision topic:"pick a database"');
    const command = `>>${prompt} :: verify:"sh ${script}"${verifyOptions}`;
    const start = await raw(
      opening.user_response === undefined
        ? { command }
        : { command, user_response: opening.user_response }
    );
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    return {
      call: (args) => raw({ chain_id: chainId, ...args }),
      raw,
      start,
      marker,
      command,
      runs,
    };
  }

  /**
   * `sv_chain`: three authored steps, each carrying one gate declared `enforcement_mode:
   * blocking`, so a FAIL opens a review that holds the step. `quick_decision` under `:: verify:`
   * never opens one: its steps carry no review gates there, and a FAIL only warns.
   */
  async function authorBlockingChain(client: ModernMcpClient, id: () => number): Promise<void> {
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const outcome = await client.callToolWithNotifications('resource_manager', args, id());
      const result = outcome.result as { isError?: boolean; content?: unknown } | undefined;
      if (result?.isError === true) throw new Error(JSON.stringify(result.content));
    };
    await author({
      resource_type: 'gate',
      action: 'create',
      id: 'sv-block',
      name: 'sv-block',
      description: 'blocking e2e gate',
      guidance: 'GUIDANCE-sv-block',
      enforcement_mode: 'blocking',
    });
    for (const id of ['sv_a', 'sv_b']) {
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
      id: 'sv_chain',
      category: 'general',
      name: 'sv_chain',
      description: 'e2e chain with a blocking gate on every step',
      user_message_template: 'chain',
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_a', stepName: 'A', inlineGateIds: ['sv-block'] },
        { promptId: 'sv_b', stepName: 'B', inlineGateIds: ['sv-block'] },
        { promptId: 'sv_a', stepName: 'C', inlineGateIds: ['sv-block'] },
      ],
    });
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

  test('P6.26 (c): once the held step is released, each later answer is checked and the last completes the run once', async () => {
    const { call, marker, runs } = await startVerifiedChain(false);
    const first = await answer(call, 'Step 1');
    expect(first.text).toContain('Shell Verification FAILED');
    writeFileSync(marker, 'ok');
    expect(count(await call({ user_response: 'fixed' }), STEP_COMPLETE)).toBe(1);
    await answer(call, 'Step 2');
    const last = await answer(call, 'Step 3');
    expect(last.text).toContain('Chain complete');
    expect(count(last, CHAIN_COMPLETE)).toBe(1);
    // Two runs on step 1, then one per later step (R32)
    expect(runs()).toBe(4);
  }, 180000);

  test('P6.52 (a): the check stands again for step 2, and a failing step-2 answer bounces', async () => {
    const { call, marker, runs } = await startVerifiedChain(false);
    expect((await answer(call, 'Step 1')).text).toContain('Shell Verification FAILED');
    expect(runs()).toBe(1);

    writeFileSync(marker, 'ok');
    const released = await call({ user_response: 'fixed' });
    expect(released.text).toContain('Progress 2/3');
    expect(count(released, STEP_COMPLETE)).toBe(1);
    expect(runs()).toBe(2);

    unlinkSync(marker);
    const bounced = await answer(call, 'Step 2');
    expect(bounced.text).toContain('Shell Verification FAILED (Attempt 1/5)');
    expect(count(bounced, STEP_COMPLETE)).toBe(0);
    expect(count(bounced, CHAIN_COMPLETE)).toBe(0);
    expect(runs()).toBe(3);

    writeFileSync(marker, 'ok');
    const passed = await call({ user_response: 'fixed step 2' });
    expect(passed.text).toContain('Progress 3/3');
    expect(count(passed, STEP_COMPLETE)).toBe(1);
    expect(runs()).toBe(4);

    const last = await answer(call, 'Step 3');
    expect(last.text).toContain('Chain complete');
    expect(count(last, CHAIN_COMPLETE)).toBe(1);
    expect(runs()).toBe(5);
  }, 180000);

  test('P6.52 (b) control: with the check passing, each answer runs it once and advances', async () => {
    const { call, runs } = await startVerifiedChain(true);
    const completions: number[] = [];
    for (const step of [1, 2, 3]) {
      const answered = await answer(call, `Step ${step}`);
      expect(answered.text).not.toContain('Shell Verification FAILED');
      expect(runs()).toBe(step);
      completions.push(count(answered, CHAIN_COMPLETE));
    }
    expect(completions).toEqual([0, 0, 1]);
  }, 180000);

  test('P6.52 (c): skip on an exhausted step-1 check arms step 2 with a fresh budget', async () => {
    const { call, runs } = await startVerifiedChain(false, ' max:2');
    await answer(call, 'Step 1');
    expect((await call({ user_response: 'still missing' })).text).toContain(
      'Maximum Attempts Reached'
    );
    expect((await call({ gate_action: 'skip' })).text).toContain('Progress 2/3');
    expect(runs()).toBe(2);

    const step2 = await answer(call, 'Step 2');
    expect(step2.text).toContain('Shell Verification FAILED (Attempt 1/2)');
    expect(step2.text).not.toContain('Maximum Attempts Reached');
    expect(count(step2, STEP_COMPLETE)).toBe(0);
    expect(runs()).toBe(3);
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

  test('P6.27 (a): the render call runs no command and spends no attempt', async () => {
    const { start, call, runs } = await startVerifiedChain(false);
    expect(start.text).not.toContain('Shell Verification FAILED');
    expect(start.text).toContain('Progress 1/3');
    expect(runs()).toBe(0);

    // The check the render saved survives to the first answer, at attempt 0
    const bounced = await answer(call, 'Step 1');
    expect(bounced.text).toContain('Shell Verification FAILED (Attempt 1/5)');
    expect(count(bounced, STEP_COMPLETE)).toBe(0);
  }, 180000);

  test('P6.27 (b) control: the reply call runs the check once', async () => {
    const { call, runs } = await startVerifiedChain(true);
    const answered = await answer(call, 'Step 1');
    expect(answered.text).toContain('Progress 2/3');
    expect(runs()).toBe(1);
  }, 180000);

  test('P6.57 (a): a render call carrying an answer runs no command and holds step 1', async () => {
    const { start, call, runs } = await startVerifiedChain(false, '', {
      user_response: cageerfAnswer('Step 1'),
    });
    expect(start.text).not.toContain('Shell Verification FAILED');
    expect(start.text).toContain('Progress 1/3');
    expect(count(start, STEP_COMPLETE)).toBe(0);
    expect(runs()).toBe(0);

    // Control: the next answering resume runs the check once, at the first attempt
    const answered = await answer(call, 'Step 1');
    expect(answered.text).toContain('Shell Verification FAILED (Attempt 1/5)');
    expect(runs()).toBe(1);
  }, 180000);

  test('P6.57 (b): a passing check is not spent on the render; the first answer runs it', async () => {
    const { start, call, runs } = await startVerifiedChain(true, '', {
      user_response: cageerfAnswer('Step 1'),
    });
    expect(start.text).toContain('Progress 1/3');
    expect(runs()).toBe(0);

    const answered = await answer(call, 'Step 1');
    expect(answered.text).toContain('Progress 2/3');
    expect(runs()).toBe(1);
  }, 180000);

  test('P6.57 (c): a single prompt opens a run too, so its render with an answer runs nothing', async () => {
    const { start, call, runs } = await startVerifiedChain(false, '', {
      prompt: 'minimal_prompt',
      user_response: 'my answer',
    });
    expect(start.text).not.toContain('Shell Verification FAILED');
    expect(runs()).toBe(0);

    const answered = await call({ user_response: 'my answer' });
    expect(answered.text).toContain('Shell Verification FAILED (Attempt 1/5)');
    expect(runs()).toBe(1);
  }, 180000);

  test('P6.32 (a): an answer after the attempts are spent re-renders the escalation, runs nothing', async () => {
    const { call, runs } = await startVerifiedChain(false, ' max:2');
    await answer(call, 'Step 1');
    await call({ user_response: 'still missing' });
    expect(runs()).toBe(2);

    const again = await call({ user_response: 'one more try' });
    expect(again.text).toContain('Maximum Attempts Reached');
    expect(again.text).toContain('**Attempts:** 2/2');
    expect(count(again, STEP_COMPLETE)).toBe(0);
    expect(runs()).toBe(2);
  }, 180000);

  test('P6.32 (b) control: retry resets to 0/N and the next answer runs the check', async () => {
    const { call, runs } = await startVerifiedChain(false, ' max:2');
    await answer(call, 'Step 1');
    await call({ user_response: 'still missing' });
    expect((await call({ gate_action: 'retry' })).text).toContain('Attempts:** 0/2');

    const rerun = await call({ user_response: 'fixed now' });
    expect(rerun.text).toContain('Shell Verification FAILED (Attempt 1/2)');
    expect(runs()).toBe(3);
  }, 180000);

  test('P6.32 (c): skip sent with an answer before the attempts are spent acts, runs nothing', async () => {
    const { call, runs } = await startVerifiedChain(false, ' max:3');
    await answer(call, 'Step 1');
    expect(runs()).toBe(1);

    const skipped = await call({ user_response: 'my answer', gate_action: 'skip' });
    expect(skipped.text).toContain('Progress 2/3');
    expect(count(skipped, STEP_COMPLETE)).toBe(1);
    expect(runs()).toBe(1);
  }, 180000);

  test('P6.53 (a): a check passed under its step review stands again, so the next step is checked', async () => {
    const { call, marker, runs } = await startVerifiedChain(true, '', { authored: true });
    expect(
      (await call({ user_response: 'A out', gate_verdict: 'GATE_REVIEW: PASS - ok' })).text
    ).toContain('Progress 2/3');

    // Step 2's FAIL opens its review; the same call's check passes and leaves the step to it
    const held = await call({ user_response: 'B out', gate_verdict: FAIL });
    expect(count(held, STEP_COMPLETE)).toBe(0);
    expect(runs()).toBe(2);

    // The review's PASS moves the run: an armed check holds only a capture
    const passed = await call({ gate_verdict: 'GATE_REVIEW: PASS - ok' });
    expect(passed.text).toContain('Progress 3/3');
    expect(count(passed, STEP_COMPLETE)).toBe(1);
    expect(runs()).toBe(2);

    // The check stood again, so step 3's answer is checked and bounces
    unlinkSync(marker);
    const bounced = await call({ user_response: 'C out', gate_verdict: 'GATE_REVIEW: PASS - ok' });
    expect(bounced.text).toContain('Shell Verification FAILED (Attempt 1/5)');
    expect(count(bounced, CHAIN_COMPLETE)).toBe(0);
    expect(runs()).toBe(3);

    // Control: fixed, the same answer passes and completes the run once
    writeFileSync(marker, 'ok');
    const last = await call({ user_response: 'C fixed' });
    expect(count(last, CHAIN_COMPLETE)).toBe(1);
    expect(runs()).toBe(4);
  }, 180000);
});
