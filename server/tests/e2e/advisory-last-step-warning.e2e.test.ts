// @lifecycle test - P6.50: an advisory FAIL on a chain's last step warns in the completion reply, over Streamable HTTP.
/**
 * A chain's last step carries one gate declared `enforcement_mode: advisory`. Its FAIL does not
 * hold the run: the answer is accepted and the call completes the chain. The FAIL still happened,
 * so the completion reply must say so (P6.37, `buildAdvisoryWarnings`), which had been proven only
 * in the harness with the real formatting stage, never driven.
 *
 * MEASURED 2026-09-25 on `7b7e6be5` under the shipped config over Streamable HTTP: the FAIL reply
 * reads "Execution complete." then "**Advisory Gate Warnings:** - Gate last-advise failed: …" and
 * "✓ Chain complete (2/2)", announcing `gate/failed`, `chain/step_complete`, `chain/complete`
 * once each. The control differs in the verdict only: a PASS completes the run the same way with
 * no warning and no `gate/failed`.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
  type StreamNotification,
} from './helpers/http-mcp-client.js';

const ADVISE_GATE = 'last-advise';
const RATIONALE = 'LAST-STEP-FAIL-RATIONALE';
const CHAIN_COMPLETE = 'notifications/chain/complete';
const WARNING = `Gate ${ADVISE_GATE} failed: ${RATIONALE}`;
/** Opted out of the default gates, so the last step carries exactly the advisory gate. */
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };

interface ToolOutcome {
  text: string;
  isError: boolean;
  methods: string[];
}

type Call = (args: Record<string, unknown>) => Promise<ToolOutcome>;

describe('Streamable HTTP: an advisory FAIL on the last step warns in the completion reply', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of teardown.reverse()) await fn();
    teardown = [];
  });

  /** A hermetic server with a two-step chain whose LAST step carries one advisory gate. */
  async function startChain(): Promise<Call> {
    const roots = createHermeticRoots('advisory-last-step-e2e');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
    });
    teardown.push(() => killServer(proc), roots.cleanup);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'advisory-last-step-e2e');
    let nextId = 1;
    const tool = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
      const outcome = await client.callToolWithNotifications(name, args, nextId++);
      const result = outcome.result as
        { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        isError: result?.isError === true,
        methods: outcome.notifications.map((n: StreamNotification) => n.method),
      };
    };
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const created = await tool('resource_manager', args);
      if (created.isError) throw new Error(created.text);
    };
    await author({
      resource_type: 'gate',
      action: 'create',
      id: ADVISE_GATE,
      name: ADVISE_GATE,
      description: 'advisory e2e gate',
      guidance: `GUIDANCE-${ADVISE_GATE}`,
      enforcement_mode: 'advisory',
    });
    for (const id of ['last_a', 'last_b']) {
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
      id: 'last_chain',
      category: 'general',
      name: 'last_chain',
      description: 'e2e chain with an advisory gate on its last step',
      user_message_template: 'chain',
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'last_a', stepName: 'A' },
        { promptId: 'last_b', stepName: 'B', inlineGateIds: [ADVISE_GATE] },
      ],
    });
    const start = await tool('prompt_engine', { command: '>>last_chain' });
    const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(start.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${start.text.slice(0, 400)}`);
    const call: Call = (args) => tool('prompt_engine', { chain_id: chainId, ...args });
    // Step A carries no gate, so its answer moves the run onto the last step
    const first = await call({ user_response: 'A out' });
    expect(first.text).toContain('BODY-last_b');
    expect(first.text).toContain('Progress 2/2');
    return call;
  }

  const completes = (reply: ToolOutcome): void => {
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('Chain complete (2/2)');
    expect(reply.methods.filter((m) => m === CHAIN_COMPLETE)).toHaveLength(1);
  };

  test('the FAIL completes the run and the completion reply carries the warning', async () => {
    const call = await startChain();
    const reply = await call({
      user_response: 'B out',
      gate_verdict: `GATE_REVIEW: FAIL - ${RATIONALE}`,
    });
    completes(reply);
    expect(reply.text).toContain('**Advisory Gate Warnings:**');
    expect(reply.text).toContain(WARNING);
    expect(reply.methods).toContain('notifications/gate/failed');
  }, 180000);

  test('control: a PASS on the last step completes the run with no warning', async () => {
    const call = await startChain();
    const reply = await call({ user_response: 'B out', gate_verdict: 'GATE_REVIEW: PASS - ok' });
    completes(reply);
    expect(reply.text).not.toContain('Advisory Gate Warnings');
    expect(reply.text).not.toContain(WARNING);
    expect(reply.methods).not.toContain('notifications/gate/failed');
  }, 180000);
});
