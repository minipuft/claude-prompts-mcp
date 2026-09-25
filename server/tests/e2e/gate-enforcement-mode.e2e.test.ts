// @lifecycle test - P4.137: a gate's declared enforcement_mode decides what a FAIL does.
/**
 * Three twin chains under the shipped config, differing ONLY in the gate on step A: one declared
 * `enforcement_mode: blocking`, one declared `advisory`, and none. Every twin gets the same two
 * calls — render, then the step's answer with a FAIL verdict — against a real spawned server.
 *
 * MEASURED on `c3c49eab` (2026-09-22) with this fixture: all three held on the FAIL. The declared
 * mode was written to `gate.yaml` and read back by `inspect`, and the pipeline never read it.
 *
 * The first case's step prompts opt out of the default reminder and framework gates
 * (`gate_configuration`), so step A carries exactly one gate, and its FAIL is overall-only: with
 * no per-gate results, the step's strictest gate decides.
 *
 * The second case keeps the defaults. Step A then also carries `content-structure`, which
 * declares no mode and so counts as blocking. Owner ruling R107: a verdict that fails gates BY
 * NAME is decided by those gates only, so failing the advisory gate alone advances, failing
 * `content-structure` holds, and a legacy string verdict — no per-gate set — falls back to the
 * strictest gate on the step and holds.
 *
 * The third case drives `gate_action: "skip"` on an exhausted advisory review (P6.49).
 *
 * The fourth case is a single prompt's advisory FAIL (P6.75): its warning names the gates.
 *
 * The last two are P6.76: a FAIL on a step with no gates, and a `gate_action` on a review that
 * still has attempts left. Both are refused by name and record nothing.
 *
 * Gates are authored through `resource_manager`, so the file watcher's hot reload is on the path.
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

const BLOCK_GATE = 'em-block';
const ADVISE_GATE = 'em-advise';
const RATIONALE = 'EM-FAIL-RATIONALE';
/** Only step B's body carries this, so finding it proves the run advanced past A. */
const STEP_B_MARKER = 'EM-STEP-B-BODY';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };

interface ToolOutcome {
  text: string;
  isError: boolean;
  notifications: StreamNotification[];
}

interface Session {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  stop(): Promise<void>;
}

async function startSession(env: Record<string, string>): Promise<Session> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = startServerWithHttp(port, { env });
  await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
  const client = new ModernMcpClient(baseUrl, 'gate-enforcement-mode-e2e');
  let nextId = 1;
  return {
    callTool: async (name, args) => {
      const outcome = await client.callToolWithNotifications(name, args, nextId++);
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        isError: result?.isError === true,
        notifications: outcome.notifications,
      };
    },
    stop: () => killServer(proc),
  };
}

function chainIdOf(text: string): string {
  const match = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text);
  if (match?.[1] === undefined) throw new Error(`no chain id in: ${text.slice(0, 400)}`);
  return match[1];
}

describe('Streamable HTTP: a FAIL follows the gate declared enforcement_mode', () => {
  let cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  async function authoredSession(): Promise<Session> {
    const roots = createHermeticRoots('gate-enforcement-mode-e2e');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const session = await startSession({
      HOME: roots.home,
      MCP_WORKSPACE: workspace,
      MCP_RUNTIME_ROOT: roots.runtimeRoot,
    });
    cleanup.push(() => session.stop(), roots.cleanup);

    for (const [id, mode] of [
      [BLOCK_GATE, 'blocking'],
      [ADVISE_GATE, 'advisory'],
    ] as const) {
      const created = await session.callTool('resource_manager', {
        resource_type: 'gate',
        action: 'create',
        id,
        name: id,
        description: `e2e gate ${id}`,
        guidance: `GUIDANCE-${id}`,
        enforcement_mode: mode,
      });
      expect(created.isError).toBe(false);
    }
    for (const [id, body] of [
      ['em_a', 'EM-STEP-A-BODY'],
      ['em_b', STEP_B_MARKER],
      ['em_a_defaults', 'EM-STEP-A-BODY'],
    ] as const) {
      const created = await session.callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: `e2e step ${id}`,
        user_message_template: body,
        ...(id === 'em_a_defaults' ? {} : { gate_configuration: OPT_OUT }),
      });
      expect(created.isError).toBe(false);
    }
    return session;
  }

  /** Render `chainId`'s twin, answer step A with a FAIL, and return that reply. */
  async function failStepA(
    session: Session,
    twin: string,
    stepA: Record<string, unknown>,
    verdict: unknown = { overall: 'FAIL', rationale: RATIONALE, per_gate: [] }
  ): Promise<ToolOutcome> {
    const id = `em_chain_${twin}`;
    const created = await session.callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: id,
      description: `e2e twin ${twin}`,
      user_message_template: 'chain',
      gate_configuration: OPT_OUT,
      chain_steps: [stepA, { promptId: 'em_b', stepName: 'B' }],
    });
    expect(created.isError).toBe(false);
    const start = await session.callTool('prompt_engine', { command: `>>${id}` });
    return session.callTool('prompt_engine', {
      chain_id: chainIdOf(start.text),
      user_response: cageerfAnswer('step A output'),
      gate_verdict: verdict,
    });
  }

  test('blocking holds, advisory advances with a warning, and the warning is the gate', async () => {
    const session = await authoredSession();
    const stepA = { promptId: 'em_a', stepName: 'A' };

    const blocking = await failStepA(session, 'blocking', {
      ...stepA,
      inlineGateIds: [BLOCK_GATE],
    });
    const advisory = await failStepA(session, 'advisory', {
      ...stepA,
      inlineGateIds: [ADVISE_GATE],
    });
    const none = await failStepA(session, 'none', stepA);

    // Blocking: the run stays on A and asks for another review.
    expect(blocking.text).not.toContain(STEP_B_MARKER);
    expect(blocking.text).toContain('Gate Review Required');
    expect(blocking.text).not.toContain('Advisory Gate Warnings');

    // Advisory: the run is on B, and the reply says which gate failed and why.
    expect(advisory.text).toContain(STEP_B_MARKER);
    expect(advisory.text).toContain('Advisory Gate Warnings');
    expect(advisory.text).toContain(`Gate ${ADVISE_GATE} failed: ${RATIONALE}`);
    const failed = advisory.notifications.filter((n) => n.method === 'notifications/gate/failed');
    expect(failed.map((n) => [n.params['gateId'], n.params['reason']])).toEqual([
      [ADVISE_GATE, RATIONALE],
    ]);

    // Control: with no step gate there is no advisory gate to warn about.
    expect(none.text).not.toContain('Advisory Gate Warnings');
  }, 180000);

  test('beside the default gates, only the gates a verdict fails by name decide (R107)', async () => {
    const session = await authoredSession();
    const stepA = { promptId: 'em_a_defaults', stepName: 'A', inlineGateIds: [ADVISE_GATE] };
    // The review advertises the inline gate first, then the default `content-structure`.
    const failIndex = (index: number) => ({
      overall: 'FAIL',
      rationale: RATIONALE,
      per_gate: [{ index, passed: false, rationale: `index ${index} failed` }],
    });

    const adviseFailed = await failStepA(session, 'r107_advise', stepA, failIndex(1));
    const contentFailed = await failStepA(session, 'r107_content', stepA, failIndex(2));
    const legacy = await failStepA(
      session,
      'r107_legacy',
      stepA,
      `GATE_REVIEW: FAIL - ${RATIONALE}`
    );

    // The advisory gate alone failed: the run is on B, and the warning names that gate only.
    expect(adviseFailed.text).toContain(STEP_B_MARKER);
    expect(adviseFailed.text).toContain(`Gate ${ADVISE_GATE} failed: ${RATIONALE}`);
    expect(adviseFailed.text).not.toContain('content-structure failed');

    // The undeclared default gate failed: the run holds, and the reply names that gate — the
    // positive control that index 2 IS `content-structure` on this step.
    expect(contentFailed.text).not.toContain(STEP_B_MARKER);
    expect(contentFailed.text).toContain('`content-structure` — index 2 failed');
    expect(contentFailed.text).toContain('Gate Review Required');

    // A string verdict names no gate, so the step's strictest gate decides: it holds.
    expect(legacy.text).not.toContain(STEP_B_MARKER);
    expect(legacy.text).toContain('Content Structure Guidelines');
    expect(legacy.text).toContain('Gate Review Required');
  }, 240000);

  /**
   * P6.49: `gate_action: "skip"` on an exhausted ADVISORY review. MEASURED 2026-09-25 on
   * `2cd9f65c`: an advisory FAIL that grades an answer advances at once, so an advisory review
   * never exhausts while its step holds an answer. It exhausts only through FAILs that graded no
   * answer, each of which leaves the review open and charged (R26): two such FAILs on the render's
   * review spend the budget of 2 and announce `retry_exhausted`. Skip then has nothing to skip
   * past and is refused by name (R19); once the step's answer is captured, skip accepts it and
   * moves the run on, as it does for a blocking review (`review-per-node.e2e`, R24).
   */
  test('skip on an exhausted advisory review: refused with no answer, accepts a captured one', async () => {
    const session = await authoredSession();
    const bareFail = { gate_verdict: `GATE_REVIEW: FAIL - ${RATIONALE}` };
    const exhaustedRun = async (twin: string) => {
      const id = `em_chain_${twin}`;
      const created = await session.callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: `e2e twin ${twin}`,
        user_message_template: 'chain',
        gate_configuration: OPT_OUT,
        chain_steps: [
          { promptId: 'em_a', stepName: 'A', inlineGateIds: [ADVISE_GATE] },
          { promptId: 'em_b', stepName: 'B' },
        ],
      });
      expect(created.isError).toBe(false);
      const start = await session.callTool('prompt_engine', { command: `>>${id}` });
      const chainId = chainIdOf(start.text);
      const call = (args: Record<string, unknown>) =>
        session.callTool('prompt_engine', { chain_id: chainId, ...args });
      const first = await call(bareFail);
      expect(first.text).toContain(`Gate ${ADVISE_GATE} failed: ${RATIONALE}`);
      expect(first.text).not.toContain(STEP_B_MARKER);
      const spent = await call(bareFail);
      expect(spent.text).toContain('Retry Limit Reached');
      expect(spent.notifications.map((n) => n.method)).toContain(
        'notifications/gate/retry_exhausted'
      );
      return call;
    };

    const unanswered = await exhaustedRun('p649_unanswered');
    const refused = await unanswered({ gate_action: 'skip' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('nothing to skip past on step 1; answer it first');

    const answered = await exhaustedRun('p649_answered');
    const held = await answered({ user_response: 'step A output' });
    expect(held.text).toContain('Retry Limit Reached');
    expect(held.text).not.toContain(STEP_B_MARKER);
    const skipped = await answered({ gate_action: 'skip' });
    expect(skipped.isError).toBe(false);
    expect(skipped.text).toContain(STEP_B_MARKER);
    expect(skipped.text).toContain('Progress 2/2');
    expect(
      skipped.notifications.filter((n) => n.method === 'notifications/chain/step_complete')
    ).toHaveLength(1);
  }, 240000);

  /**
   * P6.75: a single prompt's FAIL opens its review on the verdict, and that review used to carry
   * `gateIds: []`. MEASURED 2026-09-25 on `1042b064`: `>>review` + FAIL warned `Gate  failed:
   * misses`, naming nothing, and announced no `gate/failed`. The review now grades the prompt's
   * resolved gates, the set a chain step's review is opened with — the control below.
   */
  test('a single prompt advisory FAIL names the gates it failed, as a chain step does', async () => {
    const session = await authoredSession();
    const start = await session.callTool('prompt_engine', {
      command: '>>review target:"src/index.ts"',
    });
    const single = await session.callTool('prompt_engine', {
      chain_id: chainIdOf(start.text),
      user_response: 'review output',
      gate_verdict: `GATE_REVIEW: FAIL - ${RATIONALE}`,
    });
    const failedIds = single.notifications
      .filter((n) => n.method === 'notifications/gate/failed')
      .map((n) => String(n.params['gateId']));
    expect(single.isError).toBe(false);
    expect(single.text).not.toContain('Gate  failed');
    expect(failedIds.length).toBeGreaterThan(0);
    expect(single.text).toContain(`Gate ${failedIds.join(', ')} failed: ${RATIONALE}`);

    // Control: a chain step's advisory FAIL already names its gate.
    const chainStep = await failStepA(
      session,
      'p675_control',
      { promptId: 'em_a', stepName: 'A', inlineGateIds: [ADVISE_GATE] },
      `GATE_REVIEW: FAIL - ${RATIONALE}`
    );
    expect(chainStep.text).toContain(`Gate ${ADVISE_GATE} failed: ${RATIONALE}`);
  }, 180000);

  /** Create a two-step twin from `steps`, start it, and return a caller bound to its run. */
  async function startTwin(session: Session, twin: string, steps: Array<Record<string, unknown>>) {
    const id = `em_chain_${twin}`;
    const created = await session.callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: id,
      description: `e2e twin ${twin}`,
      user_message_template: 'chain',
      gate_configuration: OPT_OUT,
      chain_steps: steps,
    });
    expect(created.isError).toBe(false);
    const start = await session.callTool('prompt_engine', { command: `>>${id}` });
    const chainId = chainIdOf(start.text);
    return (args: Record<string, unknown>) =>
      session.callTool('prompt_engine', { chain_id: chainId, ...args });
  }

  /**
   * P6.76 (a), R38: a FAIL on a step that carries no gates opened a review of that step with
   * `gateIds: []`. MEASURED 2026-09-25 on `a99a6ba1`: with no gate publishing a mode the FAIL was
   * blocking, so it held the step, and a second FAIL exhausted it with "The following gates
   * failed after 2 attempts: ****". No review opens there now: a FAIL is refused by name, and a
   * PASS sent with the answer grades nothing and the answer moves the run on, as it would alone.
   */
  test('a FAIL on a step with no gates is refused by name and opens no review', async () => {
    const session = await authoredSession();
    const call = await startTwin(session, 'p676_gateless', [
      { promptId: 'em_b', stepName: 'B' },
      { promptId: 'em_a', stepName: 'A', inlineGateIds: [ADVISE_GATE] },
    ]);
    const gateless = 'Step 1 carries no gates, so a FAIL verdict has nothing to grade';

    const bare = await call({ gate_verdict: `GATE_REVIEW: FAIL - ${RATIONALE}` });
    expect(bare.isError).toBe(true);
    expect(bare.text).toContain(gateless);
    expect(bare.notifications).toEqual([]);

    const answered = await call({
      user_response: 'step B output',
      gate_verdict: `GATE_REVIEW: FAIL - ${RATIONALE}`,
    });
    expect(answered.isError).toBe(true);
    expect(answered.text).toContain(gateless);
    expect(answered.notifications).toEqual([]);

    // Control: the same step answered with a PASS moves on, once — nothing was held or charged.
    const passed = await call({
      user_response: 'step B output',
      gate_verdict: 'GATE_REVIEW: PASS - ok',
    });
    expect(passed.isError).toBe(false);
    expect(passed.text).toContain('EM-STEP-A-BODY');
    expect(passed.text).toContain('Progress 2/2');
    expect(
      passed.notifications.filter((n) => n.method === 'notifications/chain/step_complete')
    ).toHaveLength(1);
  }, 180000);

  /**
   * P6.76 (b): `gate_action` on a review with attempts left. MEASURED 2026-09-25 on `a99a6ba1`:
   * stage 16 routed the action only on an exhausted review, so an in-budget `skip` fell through to
   * the verdict path and the reply re-rendered the same review with `isError: false` — neither
   * applied nor refused. The control is P6.49's pin above: `skip` on an exhausted review is
   * accepted.
   */
  test('gate_action on an in-budget review is refused by name and records nothing', async () => {
    const session = await authoredSession();
    const call = await startTwin(session, 'p676_in_budget', [
      { promptId: 'em_a', stepName: 'A', inlineGateIds: [BLOCK_GATE] },
      { promptId: 'em_b', stepName: 'B' },
    ]);
    const failed = await call({
      user_response: 'step A output',
      gate_verdict: `GATE_REVIEW: FAIL - ${RATIONALE}`,
    });
    expect(failed.text).toContain('Gate Review Required');
    expect(failed.text).not.toContain(STEP_B_MARKER);

    for (const action of ['skip', 'retry']) {
      const refused = await call({ gate_action: action });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(
        `gate_action "${action}" is accepted only on an exhausted review; the review of step 1 is at 1/2 attempts`
      );
      expect(refused.notifications).toEqual([]);
    }

    // Nothing was recorded: the review still takes its verdict and the run moves on.
    const passed = await call({
      user_response: 'step A output',
      gate_verdict: 'GATE_REVIEW: PASS - ok',
    });
    expect(passed.isError).toBe(false);
    expect(passed.text).toContain(STEP_B_MARKER);
  }, 180000);
});
