// @lifecycle test - P6.79 / P6.80 / R40: an arrow-chain segment or a workflow node naming a chain prompt runs that prompt's steps, over Streamable HTTP.
/**
 * MEASURED 2026-09-25 on `427899fe` (authored `sv_chain` = sv_a/sv_b/sv_a, each step carrying the
 * blocking `sv-block`; run state read from `chain_runs.state`):
 *   - arrow-chain `>>sv_chain` then `>>sv_b`: steps `n1:sv_chain`, `n2:sv_b`, both `inlineGateIds
 *     []`; step 1 rendered the chain prompt's own template; a FAIL on step 2 was refused ("Step 2
 *     carries no gates") and opened no review.
 *   - `workflow` `{x: sv_chain, y: sv_b}`: steps `x:sv_chain`, `y:sv_b`, the same render and the
 *     same refusal; with `args.topic` on `x`, only the chain prompt's own template saw it.
 *
 * Now (R40) `compileWorkflowIR` expands a node naming a chain prompt into the prompt's projected
 * steps in place (`expandChainPromptNodes`), ids `<node-id>-<step-id>`, so both sources run the
 * steps a bare `>>sv_chain` runs, with their own templates and gates.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const PASS = 'GATE_REVIEW: PASS - ok';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gate';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
const TOPIC = [{ name: 'topic', type: 'string', required: false }];

type Call = (args: Record<string, unknown>) => Promise<string>;

describe('Streamable HTTP: every command source naming a chain prompt runs its steps', () => {
  let cleanup: Array<() => void | Promise<void>> = [];
  let client: ModernMcpClient;
  let runtimeRoot: string;
  let nextId = 1;

  const tool = async (name: string, args: Record<string, unknown>) => {
    const outcome = await client.callToolWithNotifications(name, args, nextId++);
    const result = outcome.result as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  beforeAll(async () => {
    const roots = createHermeticRoots('chain-prompt-sources-e2e');
    cleanup.push(roots.cleanup);
    runtimeRoot = roots.runtimeRoot;
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot },
    });
    cleanup.push(() => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    client = new ModernMcpClient(baseUrl, 'chain-prompt-sources-e2e');

    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await tool('resource_manager', args);
      if (result.isError) throw new Error(result.text);
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
        user_message_template: `BODY-${id} topic={{topic}}`,
        arguments: TOPIC,
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
      user_message_template: 'CHAIN-OWN-TEMPLATE',
      arguments: TOPIC,
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_a', stepName: 'A', inlineGateIds: ['sv-block'] },
        { promptId: 'sv_b', stepName: 'B', inlineGateIds: ['sv-block'] },
        { promptId: 'sv_a', stepName: 'C', inlineGateIds: ['sv-block'] },
      ],
    });
  }, 120000);

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  /** The run's parsed steps and open reviews, as `chain_runs.state` holds them. */
  function runState(chainId: string): {
    steps: string[];
    criteria: unknown[];
    args: unknown[];
    reviews: Record<string, string[]>;
  } {
    const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const row = db.prepare('SELECT state FROM chain_runs WHERE chain_id = ?').get(chainId) as
        { state: string } | undefined;
      const state = JSON.parse(row?.state ?? '{}') as {
        blueprint?: {
          parsedCommand?: {
            steps?: Array<{
              nodeId: string;
              promptId: string;
              inlineGateIds?: string[];
              inlineGateCriteria?: string[];
              args?: unknown;
            }>;
          };
        };
        reviews?: Record<string, { gateIds: string[] }>;
      };
      const steps = state.blueprint?.parsedCommand?.steps ?? [];
      return {
        steps: steps.map(
          (s) => `${s.nodeId}:${s.promptId}:${JSON.stringify(s.inlineGateIds ?? [])}`
        ),
        criteria: steps.map((s) => s.inlineGateCriteria ?? []),
        args: steps.map((s) => s.args),
        reviews: Object.fromEntries(
          Object.entries(state.reviews ?? {}).map(([node, review]) => [node, review.gateIds])
        ),
      };
    } finally {
      db.close();
    }
  }

  async function start(args: Record<string, unknown>): Promise<{
    chainId: string;
    text: string;
    call: Call;
  }> {
    const opened = await tool('prompt_engine', args);
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(opened.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${opened.text.slice(0, 400)}`);
    return {
      chainId,
      text: opened.text,
      call: async (next) => (await tool('prompt_engine', { chain_id: chainId, ...next })).text,
    };
  }

  const templates = (text: string): string[] => text.match(/BODY-sv_[a-z]+ topic=\S*/g) ?? [];

  /** Walk sv_chain's steps: PASS on step 1, FAIL on step 2 (opens its review), then PASS through. */
  async function walkExpanded(
    run: { chainId: string; text: string; call: Call },
    firstId: string,
    topic = ''
  ) {
    expect(templates(run.text)).toEqual([`BODY-sv_a topic=${topic}`]);
    expect(run.text).not.toContain('CHAIN-OWN-TEMPLATE');

    const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
    expect(templates(second)).toEqual([`BODY-sv_b topic=${topic}`]);
    expect(second).toContain('Progress 2/4');

    const failed = await run.call({ user_response: 'B out', gate_verdict: FAIL });
    expect(failed).toContain('Gate Review Required');
    expect(failed).toContain('### sv-block');
    expect(runState(run.chainId).reviews).toEqual({ [`${firstId}-b`]: ['sv-block'] });

    const third = await run.call({ user_response: 'B fixed', gate_verdict: PASS });
    expect(templates(third)).toEqual([`BODY-sv_a topic=${topic}`]);
    expect(third).toContain('Progress 3/4');
    const fourth = await run.call({ user_response: 'C out', gate_verdict: PASS });
    expect(templates(fourth)).toEqual([`BODY-sv_b topic=${topic}`]);
    expect(fourth).toContain('Progress 4/4');
  }

  describe('P6.79: an arrow-chain segment', () => {
    test('(a) a chain-prompt segment runs its steps, then the next segment', async () => {
      const run = await start({ command: `>>sv_chain${ARROW}>>sv_b` });
      expect(runState(run.chainId).steps).toEqual([
        'n1-a:sv_a:["sv-block"]',
        'n1-b:sv_b:["sv-block"]',
        'n1-c:sv_a:["sv-block"]',
        'n2:sv_b:[]',
      ]);
      await walkExpanded(run, 'n1');
    }, 120000);

    test('(b) control: an arrow-chain of single prompts keeps its nodes and ids', async () => {
      const run = await start({ command: `>>sv_a${ARROW}>>sv_b` });
      expect(runState(run.chainId).steps).toEqual(['n1:sv_a:[]', 'n2:sv_b:[]']);
      expect(templates(run.text)).toEqual(['BODY-sv_a topic=']);
      const second = await run.call({ user_response: 'A out' });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('Progress 2/2');
    }, 120000);

    test('(c) a criterion on the chain-prompt segment binds each of its steps', async () => {
      const run = await start({ command: `>>sv_a${ARROW}>>sv_chain :: "CRIT-each-node"` });
      const state = runState(run.chainId);
      expect(state.steps.map((step) => step.split(':').slice(0, 2).join(':'))).toEqual([
        'n1:sv_a',
        'n2-a:sv_a',
        'n2-b:sv_b',
        'n2-c:sv_a',
      ]);
      expect(state.criteria).toEqual([
        [],
        ['CRIT-each-node'],
        ['CRIT-each-node'],
        ['CRIT-each-node'],
      ]);
      // Each expanded step keeps its own gate beside the criterion's temporary gate
      for (const step of state.steps.slice(1)) expect(step).toContain('"sv-block","temp_');

      const second = await run.call({ user_response: 'first out' });
      expect(templates(second)).toEqual(['BODY-sv_a topic=']);
      expect(second).toContain('CRIT-each-node');
      expect(second).toContain('### sv-block');
    }, 120000);
  });

  describe('P6.80: a submitted workflow node', () => {
    const workflow = (x: Record<string, unknown>) => ({
      workflow: {
        version: 1,
        nodes: [
          { id: 'x', ...x },
          { id: 'y', promptId: 'sv_b' },
        ],
        edges: [{ from: 'x', to: 'y' }],
      },
    });

    test('(a) a node naming a chain prompt runs its steps with their own templates and gates', async () => {
      const run = await start(workflow({ promptId: 'sv_chain' }));
      expect(runState(run.chainId).steps).toEqual([
        'x-a:sv_a:["sv-block"]',
        'x-b:sv_b:["sv-block"]',
        'x-c:sv_a:["sv-block"]',
        'y:sv_b:[]',
      ]);
      await walkExpanded(run, 'x');
    }, 120000);

    test('(b) control: a submission of single prompts keeps its nodes and ids', async () => {
      const run = await start(workflow({ promptId: 'sv_a' }));
      expect(runState(run.chainId).steps).toEqual(['x:sv_a:[]', 'y:sv_b:[]']);
      expect(templates(run.text)).toEqual(['BODY-sv_a topic=']);
      const second = await run.call({ user_response: 'A out' });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('Progress 2/2');
    }, 120000);

    test("(c) the chain-prompt node's args reach every expanded step", async () => {
      const run = await start(workflow({ promptId: 'sv_chain', args: { topic: 'TOPIC-X' } }));
      const state = runState(run.chainId);
      expect(state.args.slice(0, 3)).toEqual([
        { topic: 'TOPIC-X' },
        { topic: 'TOPIC-X' },
        { topic: 'TOPIC-X' },
      ]);
      await walkExpanded(run, 'x', 'TOPIC-X');
    }, 120000);
  });
});
