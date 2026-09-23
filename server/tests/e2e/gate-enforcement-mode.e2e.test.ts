// @lifecycle test - P4.137: a gate's declared enforcement_mode decides what a FAIL does.
/**
 * Three twin chains under the shipped config, differing ONLY in the gate on step A: one declared
 * `enforcement_mode: blocking`, one declared `advisory`, and none. Every twin gets the same two
 * calls — render, then the step's answer with a FAIL verdict — against a real spawned server.
 *
 * MEASURED on `c3c49eab` (2026-09-22) with this fixture: all three held on the FAIL. The declared
 * mode was written to `gate.yaml` and read back by `inspect`, and the pipeline never read it.
 *
 * The step prompts opt out of the default reminder and framework gates (`gate_configuration`).
 * That is the prompt author's own switch, not a config change, and it is what the twins need:
 * those default gates declare no mode, a gate declaring none counts as blocking on a chain step,
 * and the strictest applying gate decides — so an advisory gate sharing a step with them holds.
 * The last case pins that composition rather than hiding it.
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
    stepA: Record<string, unknown>
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
      gate_verdict: { overall: 'FAIL', rationale: RATIONALE, per_gate: [] },
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

  test('an advisory gate sharing its step with the undeclared default gates holds', async () => {
    const session = await authoredSession();
    const held = await failStepA(session, 'advisory_defaults', {
      promptId: 'em_a_defaults',
      stepName: 'A',
      inlineGateIds: [ADVISE_GATE],
    });

    // Positive control: the default gate IS on the step, so the hold is about it.
    expect(held.text).toContain('Content Structure Guidelines');
    expect(held.text).not.toContain(STEP_B_MARKER);
    expect(held.text).toContain('Gate Review Required');
  }, 180000);
});
