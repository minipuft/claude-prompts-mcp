// @lifecycle test - Row 4.8: a detached step's gate review opens against its late report, over Streamable HTTP.
/**
 * A detached (`await: run`) step's gates grade the output its worker REPORTS, never the empty
 * resume that moves the run past it (R8). Driven against a real spawned server over Streamable
 * HTTP, reading each call's stream for the notifications a client acts on.
 *
 * MEASURED on `1161853f` (2026-09-23, `slot.mjs`, shipped defaults): the move-on call at A opened
 * A's review and its verdict graded nothing A produced; the late report then opened no review.
 *
 * The first case opts every step out of the default gates, so A carries exactly one gate and the
 * whole state machine is visible: report → review → FAIL → replacement → PASS, with the run held
 * open by the review in between. The second keeps the shipped defaults (CAGEERF + default gates),
 * where every rendered step also carries a review, and asserts the move-on no longer stops at A.
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

const GATE = 'dr-block';
const STEP_C_MARKER = 'DR-STEP-C-BODY';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
const STEP_COMPLETE = 'notifications/chain/step_complete';
const CHAIN_COMPLETE = 'notifications/chain/complete';

interface ToolOutcome {
  text: string;
  isError: boolean;
  methods: string[];
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
  const client = new ModernMcpClient(baseUrl, 'detached-review-e2e');
  let nextId = 1;
  return {
    callTool: async (name, args) => {
      const outcome = await client.callToolWithNotifications(name, args, nextId++);
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        isError: result?.isError === true,
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
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

function tokenOf(brief: string): string {
  const match = /^node:\s*(\S+)\s*$/m.exec(brief);
  if (match?.[1] === undefined) throw new Error(`no node token in: ${brief.slice(0, 400)}`);
  return match[1];
}

const trailer = (token: string): string => `HANDOFF RESULT\nnode: ${token}`;
const PASS = { overall: 'PASS', rationale: 'the reported result meets the gate', per_gate: [] };
const FAIL = { overall: 'FAIL', rationale: 'the reported result misses the gate', per_gate: [] };

describe('Streamable HTTP: a detached step is reviewed at its late report (row 4.8)', () => {
  let cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  /** A hermetic server with `First → A (await: run, GATE) → C` authored through resource_manager. */
  async function authored(defaults: boolean): Promise<{ session: Session; chain: string }> {
    const roots = createHermeticRoots('detached-review-e2e');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const session = await startSession({
      HOME: roots.home,
      MCP_WORKSPACE: workspace,
      MCP_RUNTIME_ROOT: roots.runtimeRoot,
    });
    cleanup.push(() => session.stop(), roots.cleanup);
    const optOut = defaults ? {} : { gate_configuration: OPT_OUT };

    const gate = await session.callTool('resource_manager', {
      resource_type: 'gate',
      action: 'create',
      id: GATE,
      name: GATE,
      description: 'e2e gate on the detached step',
      guidance: 'GUIDANCE-dr-block',
    });
    expect(gate.isError).toBe(false);
    for (const [id, body] of [
      ['dr_first', 'DR-STEP-FIRST-BODY'],
      ['dr_a', 'DR-STEP-A-BODY'],
      ['dr_c', STEP_C_MARKER],
    ] as const) {
      const created = await session.callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: `e2e step ${id}`,
        user_message_template: body,
        ...optOut,
      });
      expect(created.isError).toBe(false);
    }
    const chain = 'dr_chain';
    const created = await session.callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id: chain,
      category: 'general',
      name: chain,
      description: 'e2e detached review chain',
      user_message_template: 'chain',
      ...optOut,
      chain_steps: [
        { promptId: 'dr_first', stepName: 'First' },
        { promptId: 'dr_a', stepName: 'A', await: 'run', inlineGateIds: [GATE] },
        { promptId: 'dr_c', stepName: 'C' },
      ],
    });
    expect(created.isError).toBe(false);
    return { session, chain };
  }

  test('report → review → FAIL → replacement → PASS; the open review holds the run until then', async () => {
    const { session, chain } = await authored(false);
    const start = await session.callTool('prompt_engine', { command: `>>${chain}` });
    const chainId = chainIdOf(start.text);
    const call = (args: Record<string, unknown>) =>
      session.callTool('prompt_engine', { chain_id: chainId, ...args });

    const brief = await call({ user_response: cageerfAnswer('first output') });
    expect(brief.text).toContain('Do NOT wait for the sub-agent');
    const token = tokenOf(brief.text);

    // Moving on opens no review of A: nothing A produced exists yet.
    const movedOn = await call({});
    expect(movedOn.isError).toBe(false);
    expect(movedOn.text).toContain(STEP_C_MARKER);
    expect(movedOn.text).not.toContain('Gate Review Required');

    const report = await call({
      user_response: `${cageerfAnswer('A late result')}\n\n${trailer(token)}`,
    });
    expect(report.isError).toBe(false);
    expect(report.methods).toContain(STEP_COMPLETE); // positive control: the stream is read
    expect(report.text).toContain(`Gate Review Required — detached node ${token} (step 2)`);
    expect(report.text).toContain(`"satisfied": ["${GATE}"]`);

    // C answered (with the verdict on C's own review) while A's review is open: the run walks
    // past its end and is held, not complete.
    const held = await call({ user_response: cageerfAnswer('C output'), gate_verdict: PASS });
    expect(held.isError).toBe(false);
    expect(held.text).toContain(`Gate review still open on reported detached node(s): ${token}`);
    expect(held.methods).not.toContain(CHAIN_COMPLETE);

    const failed = await call({ gate_verdict: FAIL, user_response: trailer(token) });
    expect(failed.isError).toBe(false);
    expect(failed.text).toContain('failed (attempt 1/2)');
    expect(failed.methods).not.toContain(CHAIN_COMPLETE);

    const replaced = await call({
      user_response: `${cageerfAnswer('A replacement result')}\n\n${trailer(token)}`,
    });
    expect(replaced.text).toContain('its result replaces its first result');
    expect(replaced.methods).toContain(STEP_COMPLETE);

    const passed = await call({ gate_verdict: PASS, user_response: trailer(token) });
    expect(passed.isError).toBe(false);
    expect(passed.text).toContain(`Gate review of detached node ${token} (step 2) passed`);
    expect(passed.text).toContain('✅ Chain complete');
    expect(passed.methods).toContain(CHAIN_COMPLETE);
  }, 240000);

  test('under the shipped defaults the move-on passes A, and its review opens at the report', async () => {
    const { session, chain } = await authored(true);
    const start = await session.callTool('prompt_engine', { command: `>>${chain}` });
    const chainId = chainIdOf(start.text);
    const call = (args: Record<string, unknown>) =>
      session.callTool('prompt_engine', { chain_id: chainId, ...args });

    const brief = await call({ user_response: cageerfAnswer('first output'), gate_verdict: PASS });
    const token = tokenOf(brief.text);

    // No verdict on the move-on: before row 4.8 a review of A held the run here.
    const movedOn = await call({});
    expect(movedOn.isError).toBe(false);
    expect(movedOn.text).toContain(STEP_C_MARKER);

    const report = await call({
      user_response: `${cageerfAnswer('A late result')}\n\n${trailer(token)}`,
    });
    expect(report.methods).toContain(STEP_COMPLETE);
    expect(report.text).toContain(`Gate Review Required — detached node ${token} (step 2)`);
    expect(report.text).toContain(GATE);
    expect(report.text).toContain('content-structure');

    const passed = await call({ gate_verdict: PASS, user_response: trailer(token) });
    expect(passed.text).toContain(`Gate review of detached node ${token} (step 2) passed`);

    const done = await call({ user_response: cageerfAnswer('C output'), gate_verdict: PASS });
    expect(done.text).toContain('Chain complete');
    expect(done.methods).toContain(CHAIN_COMPLETE);
  }, 240000);
});
