// @lifecycle test - P6.34 / P6.30: a run whose final answer opens a review after the walk past its last node, over Streamable HTTP.
/**
 * The held-final shape (row 3.9, measured in #390): a two-step chain whose one-line final answer
 * opens a structural review AFTER the capture walked the run past its last node. The run then
 * stands on no node (`current_node_id` NULL), stays `working`, and one review is open. Driven here
 * end to end under the shipped defaults (CAGEERF + default gates) against `documentation_change`,
 * the bundled two-step chain, reading `chain_runs` for the run's own facts.
 *
 * MEASURED 2026-09-25 on `380b4a5e` (P6.30): every leg below holds. A bare `chain_id` resume of
 * the held-final run is answered by the pending review's render — stage 18 skips on
 * `pendingReview` and stage 20 renders the review (re-rendering the final step's body with it) —
 * not by the held-run notice. With both of those routed past (a mutant), the notice answers
 * instead and leg (d) goes red. The notice is reached today only through the detached router
 * while a detached report is also owed: the last case here.
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

const CHAIN_COMPLETE = 'notifications/chain/complete';
const STEP_COMPLETE = 'notifications/chain/step_complete';
const PASS = 'GATE_REVIEW: PASS - the step meets its gates';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gates';
const HELD_NOTICE = 'Every step has run, but the run stays open';

interface ToolOutcome {
  text: string;
  isError: boolean;
  methods: string[];
}

type Call = (args: Record<string, unknown>) => Promise<ToolOutcome>;

interface RunRow {
  status: string;
  currentNodeId: string | null;
  reviews: Array<{ kind: string; phase: string }>;
}

interface Session {
  tool: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
  run: () => RunRow;
}

describe('Streamable HTTP: the held-final shape (P6.34)', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  async function startSession(): Promise<Session> {
    const roots = createHermeticRoots('held-final-e2e');
    teardown.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
    });
    teardown.push(() => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'held-final-e2e');
    let nextId = 1;
    return {
      tool: async (name, args) => {
        const outcome = await client.callToolWithNotifications(name, args, nextId++);
        const result = outcome.result as
          { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
        return {
          text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
          isError: result?.isError === true,
          methods: outcome.notifications.map((n: StreamNotification) => n.method),
        };
      },
      run: () => {
        const dbPath = path.join(roots.runtimeRoot, 'runtime-state', 'state.db');
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const rows = db
            .prepare('SELECT run_status, current_node_id, state FROM chain_runs')
            .all() as Array<{ run_status: string; current_node_id: string | null; state: string }>;
          expect(rows).toHaveLength(1);
          const [row] = rows as [(typeof rows)[number]];
          const state = JSON.parse(row.state) as {
            reviews?: Record<string, { kind: string; phase: string }>;
          };
          return {
            status: row.run_status,
            currentNodeId: row.current_node_id,
            reviews: Object.values(state.reviews ?? {}).map(({ kind, phase }) => ({ kind, phase })),
          };
        } finally {
          db.close();
        }
      },
    };
  }

  const chainIdOf = (text: string): string => {
    const match = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text);
    if (match?.[1] === undefined) throw new Error(`no chain id in: ${text.slice(0, 400)}`);
    return match[1];
  };

  const count = (outcome: ToolOutcome, method: string): number =>
    outcome.methods.filter((m) => m === method).length;

  /** `documentation_change` with step 1 answered in full and a one-line final answer. */
  async function heldFinal(): Promise<{ call: Call; session: Session; opened: ToolOutcome }> {
    const session = await startSession();
    const start = await session.tool('prompt_engine', {
      command: '>>documentation_change request:"add a section"',
    });
    expect(start.text).toContain('Progress 1/2');
    const chainId = chainIdOf(start.text);
    const call: Call = (args) => session.tool('prompt_engine', { chain_id: chainId, ...args });

    const first = await call({ user_response: cageerfAnswer('Step 1'), gate_verdict: PASS });
    expect(first.text).toContain('Progress 2/2');
    // CONTROL: a full step-1 answer walks onto step 2 with nothing held.
    expect(session.run()).toEqual({
      status: 'working',
      currentNodeId: 'semantic-and-voice-review-step-2-of-2',
      reviews: [],
    });

    const opened = await call({ user_response: 'one line', gate_verdict: PASS });
    return { call, session, opened };
  }

  test('(a) a one-line final answer opens the structural review; the run is held, not complete', async () => {
    const { session, opened } = await heldFinal();
    expect(opened.isError).toBe(false);
    expect(opened.text).toContain('Structural Review Required');
    expect(opened.text).toContain('→ Final step 2/2 — awaiting gate verdict');
    expect(count(opened, CHAIN_COMPLETE)).toBe(0);
    expect(session.run()).toEqual({
      status: 'working',
      currentNodeId: null,
      reviews: [{ kind: 'structural', phase: 'awaiting-verdict' }],
    });
  }, 180000);

  test('(b) the final PASS completes the run, announced once; a later call is already complete', async () => {
    const { call, session } = await heldFinal();
    const passed = await call({ gate_verdict: PASS });
    expect(passed.isError).toBe(false);
    expect(passed.text).toContain('✓ Chain complete (2/2)');
    expect(count(passed, CHAIN_COMPLETE)).toBe(1);
    expect(session.run()).toEqual({ status: 'completed', currentNodeId: null, reviews: [] });

    const after = await call({ user_response: 'after' });
    expect(after.text).toContain('Chain run already complete');
    expect(count(after, CHAIN_COMPLETE)).toBe(0);
  }, 180000);

  test('(c) skip on the exhausted review completes the run the same way (R24)', async () => {
    const { call, session } = await heldFinal();
    for (const attempt of [1, 2]) {
      const failed = await call({ gate_verdict: FAIL });
      expect(failed.text).toContain(`Structural Review Required** (attempt ${attempt + 1}/3)`);
      expect(count(failed, CHAIN_COMPLETE)).toBe(0);
    }
    const exhausted = await call({ gate_verdict: FAIL });
    expect(exhausted.text).toContain('Retry Limit Reached');
    expect(exhausted.text).toContain('gate_action="retry" | gate_action="skip"');
    expect(session.run().reviews).toEqual([{ kind: 'structural', phase: 'exhausted' }]);
    expect(session.run().status).toBe('working');

    const skipped = await call({ gate_action: 'skip' });
    expect(skipped.isError).toBe(false);
    expect(skipped.text).toContain('✓ Chain complete (2/2)');
    expect(count(skipped, CHAIN_COMPLETE)).toBe(1);
    expect(session.run()).toEqual({ status: 'completed', currentNodeId: null, reviews: [] });

    const after = await call({ user_response: 'after' });
    expect(after.text).toContain('Chain run already complete');
  }, 180000);

  test('(d) a bare chain_id resume re-offers the review and its gate_verdict; nothing moves', async () => {
    const { call, session } = await heldFinal();
    const resumed = await call({});
    expect(resumed.isError).toBe(false);
    expect(resumed.text).toContain('Structural Review Required** (attempt 1/3)');
    expect(resumed.text).toContain('gate_verdict=');
    // The pending review answers (stage 20), not the held-run notice.
    expect(resumed.text).not.toContain(HELD_NOTICE);
    expect(count(resumed, CHAIN_COMPLETE)).toBe(0);
    expect(count(resumed, STEP_COMPLETE)).toBe(0);
    expect(session.run()).toEqual({
      status: 'working',
      currentNodeId: null,
      reviews: [{ kind: 'structural', phase: 'awaiting-verdict' }],
    });
  }, 180000);

  /**
   * P6.30 driven: `First → A (await: run) → C`, A moved past and owed its report, C's one-line
   * answer opening its structural review past the last node. The held-run notice names BOTH holds,
   * each with its own move. Before P6.30 it named the owed report only.
   */
  test('P6.30: the held-run notice names an owed report and an open structural review', async () => {
    const session = await startSession();
    for (const id of ['hr_first', 'hr_a', 'hr_c']) {
      const created = await session.tool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: `e2e step ${id}`,
        user_message_template: `BODY-${id}`,
      });
      expect(created.isError).toBe(false);
    }
    const chain = await session.tool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id: 'hr_chain',
      category: 'general',
      name: 'hr_chain',
      description: 'e2e held-run chain',
      user_message_template: 'chain',
      chain_steps: [
        { promptId: 'hr_first', stepName: 'First' },
        { promptId: 'hr_a', stepName: 'A', await: 'run' },
        { promptId: 'hr_c', stepName: 'C' },
      ],
    });
    expect(chain.isError).toBe(false);
    const start = await session.tool('prompt_engine', { command: '>>hr_chain' });
    const chainId = chainIdOf(start.text);
    const call: Call = (args) => session.tool('prompt_engine', { chain_id: chainId, ...args });

    await call({ user_response: cageerfAnswer('first'), gate_verdict: PASS });
    await call({});
    const opened = await call({ user_response: 'one line', gate_verdict: PASS });
    expect(opened.text).toContain('Structural Review Required');
    expect(session.run()).toEqual({
      status: 'working',
      currentNodeId: null,
      reviews: [{ kind: 'structural', phase: 'awaiting-verdict' }],
    });

    const held = await call({});
    expect(held.text).toContain(
      `${HELD_NOTICE} until its detached node(s) report: a (step 2); and until its structural ` +
        'review of step 3 is answered.'
    );
    expect(held.text).toContain(
      'The structural review of step 3 is still open: resume with chain_id and gate_verdict.'
    );
    expect(held.text).toContain('node: a');
    expect(held.text).not.toContain('detached review(s)');
    expect(count(held, CHAIN_COMPLETE)).toBe(0);
  }, 180000);
});
