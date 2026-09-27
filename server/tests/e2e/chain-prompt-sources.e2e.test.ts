// @lifecycle test - P6.79 / P6.80 / R40: an arrow-chain segment or a workflow node naming a chain prompt runs that prompt's steps; P6.78 / R37: a command-level gate on a chain prompt binds each step; P6.97 / R43: a named inline gate belongs to the run that declared it; P6.99 / R44: a named gate on an arrow-chain segment binds that segment; P6.108 / R47: a run's temporary gates live exactly as long as the run; P6.104: a run's request gates reach every node they target; P6.107: a request gate id belongs to the run that holds it; P6.105: the arrow-chain source validates the expanded workflow; P6.110: one name in two arrow-chain segments is two gates; P6.113: a run re-sending a declared id keeps the id it registered; P6.117: a request gate target is checked against the declared node ids, over Streamable HTTP.
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
 *
 * MEASURED 2026-09-25 on `a9b2615e`: `>>sv_chain :: "EXTRA-CRIT-78"`, `>>sv_chain :: code-quality`
 * and `>>sv_chain :: mygate78:"NAMED-CRIT-78"` each ran the three steps with `inlineGateIds
 * ["sv-block"]` only; the criterion registered a command-level gate chain enhancement never reads,
 * and no reply carried it.
 *
 * Now (R37) the builder folds a command's anonymous, canonical and named non-shell gates onto
 * every projected step; a shell verification stays the command-level check (R32).
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
      env: {
        HOME: roots.home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: runtimeRoot,
        MCP_SHELL_VERIFY_ALLOWLIST: 'false',
      },
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
    // An ungated two-step chain prompt: a run-level gate targeting its node is rendered by the
    // first resume, which is the horizon the workflow `gates` channel reaches (P6.92 twin b).
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_pair',
      category: 'general',
      name: 'sv_pair',
      description: 'e2e ungated two-step chain',
      user_message_template: 'CHAIN-OWN-TEMPLATE',
      arguments: TOPIC,
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_a', stepName: 'A' },
        { promptId: 'sv_b', stepName: 'B' },
      ],
    });
    // P6.160: two prompts that keep the shipped category and framework defaults, and an ungated
    // chain of them, so a contributed step's defaults compare against a planned step's.
    for (const id of ['sv_d', 'sv_e']) {
      await author({
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: `e2e step ${id} with default gates`,
        user_message_template: `BODY-${id} topic={{topic}}`,
        arguments: TOPIC,
      });
    }
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_dpair',
      category: 'general',
      name: 'sv_dpair',
      description: 'e2e ungated chain of default-gated steps',
      user_message_template: 'CHAIN-OWN-TEMPLATE',
      arguments: TOPIC,
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_d', stepName: 'A' },
        { promptId: 'sv_e', stepName: 'B' },
      ],
    });
    await author({
      resource_type: 'gate',
      action: 'create',
      id: 'sv-drop',
      name: 'sv-drop',
      description: 'blocking e2e gate on a step a replace remainder drops',
      guidance: 'GUIDANCE-sv-drop',
      enforcement_mode: 'blocking',
    });
    // 32 steps: one node naming it plus one more is 33 expanded nodes, past the cap of 32.
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_big',
      category: 'general',
      name: 'sv_big',
      description: 'e2e chain as long as the node cap',
      user_message_template: 'CHAIN-OWN-TEMPLATE',
      arguments: TOPIC,
      gate_configuration: OPT_OUT,
      chain_steps: Array.from({ length: 32 }, (_, index) => ({
        promptId: 'sv_a',
        stepName: `S${index + 1}`,
      })),
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

  function countRuns(): number {
    const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
    try {
      return (db.prepare('SELECT COUNT(*) AS n FROM chain_runs').get() as { n: number }).n;
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

    test('P6.96: the run id names the chain prompt on the workflow and arrow-chain sources', async () => {
      const submitted = await start(workflow({ promptId: 'sv_chain' }));
      const arrow = await start({ command: `>>sv_chain${ARROW}>>sv_b` });
      expect(submitted.chainId).toMatch(/^chain-sv_chain#\d+$/);
      expect(arrow.chainId).toMatch(/^chain-sv_chain#\d+$/);
      // Control: a workflow of single prompts names its first node's prompt
      expect((await start(workflow({ promptId: 'sv_a' }))).chainId).toMatch(/^chain-sv_a#\d+$/);
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
  describe('P6.92: the validator checks the expanded workflow', () => {
    const twoNodes = (x: string, y: string, gates?: unknown[]) => ({
      workflow: {
        version: 1,
        nodes: [
          { id: 'x', promptId: x },
          { id: 'y', promptId: y },
        ],
        edges: [{ from: 'x', to: 'y' }],
        ...(gates !== undefined ? { gates } : {}),
      },
    });

    test('(a) a chain-prompt node expanding past the node cap is refused by name, creating nothing', async () => {
      const before = countRuns();
      const result = await tool('prompt_engine', twoNodes('sv_big', 'sv_b'));
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Nothing was executed and no run was created.');
      expect(result.text).toContain(
        '[cap-exceeded] node "x": Expanding chain prompt "sv_big" yields 32 nodes; the expanded workflow has 33 nodes, exceeding the effective maxNodes cap of 32'
      );
      expect(countRuns()).toBe(before);
    }, 120000);

    test("(b) a gate targeting a chain-prompt node binds that node's last expanded step", async () => {
      const gate = { name: 'tgt', criteria: ['TGT-NODE-X'], target_step_id: 'x' };
      const run = await start(twoNodes('sv_pair', 'sv_b', [gate]));
      expect(runState(run.chainId).steps).toEqual(['x-a:sv_a:[]', 'x-b:sv_b:[]', 'y:sv_b:[]']);
      expect(run.text).not.toContain('TGT-NODE-X');
      const second = await run.call({ user_response: 'A out' });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('TGT-NODE-X');
      // Since P6.104 the resume still carries the run's request gate, so x-b's answer is graded
      // against it before the run moves on.
      const third = await run.call({ user_response: 'B out' });
      expect(third).toContain('TGT-NODE-X');
      expect(Object.keys(runState(run.chainId).reviews)).toEqual(['x-b']);
      const fourth = await run.call({ user_response: 'B out', gate_verdict: PASS });
      expect(templates(fourth)).toEqual(['BODY-sv_b topic=']);
      expect(fourth).toContain('Progress 3/3');
      expect(fourth).not.toContain('TGT-NODE-X');
    }, 120000);

    test('(c) control: a gate targeting a single-prompt node is unchanged', async () => {
      const gate = { name: 'tgt', criteria: ['TGT-NODE-Y'], target_step_id: 'y' };
      const run = await start(twoNodes('sv_a', 'sv_b', [gate]));
      expect(runState(run.chainId).steps).toEqual(['x:sv_a:[]', 'y:sv_b:[]']);
      expect(run.text).not.toContain('TGT-NODE-Y');
      const second = await run.call({ user_response: 'A out' });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('TGT-NODE-Y');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `867c74bd`: arrow-chain `>>sv_big` then `>>sv_b` compiled to 33 steps
   * and opened a run (the cap was checked on the workflow source only), and a request gate
   * targeting `n1` on arrow-chain `>>sv_chain` then `>>sv_b` never rendered: the arrow-chain
   * source never validated, so no expansion retargeted `n1` to its last expanded step.
   */
  describe('P6.105: the arrow-chain source validates the expanded workflow', () => {
    test('(a) a chain-prompt segment expanding past the node cap is refused by name, creating nothing', async () => {
      const before = countRuns();
      const result = await tool('prompt_engine', { command: `>>sv_big${ARROW}>>sv_b` });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Nothing was executed and no run was created.');
      expect(result.text).toContain(
        '[cap-exceeded] node "n1": Expanding chain prompt "sv_big" yields 32 nodes; the expanded workflow has 33 nodes, exceeding the effective maxNodes cap of 32'
      );
      expect(countRuns()).toBe(before);
    }, 120000);

    test("(b) a request gate targeting a chain-prompt segment binds that segment's last expanded step", async () => {
      const gates = [{ name: 'tgt105', criteria: ['TGT-105-N1'], target_step_id: 'n1' }];
      const run = await start({ command: `>>sv_chain${ARROW}>>sv_b`, gates });
      expect(runState(run.chainId).steps).toEqual([
        'n1-a:sv_a:["sv-block"]',
        'n1-b:sv_b:["sv-block"]',
        'n1-c:sv_a:["sv-block"]',
        'n2:sv_b:[]',
      ]);
      expect(run.text).not.toContain('TGT-105-N1');
      const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
      expect(second).not.toContain('TGT-105-N1');
      const third = await run.call({ user_response: 'B out', gate_verdict: PASS });
      expect(templates(third)).toEqual(['BODY-sv_a topic=']);
      expect(third).toContain('TGT-105-N1');
      const failed = await run.call({ user_response: 'C out', gate_verdict: FAIL });
      expect(failed).toContain('Gate Review Required');
      expect(failed).toContain('TGT-105-N1');
      const reviews = runState(run.chainId).reviews;
      expect(Object.keys(reviews)).toEqual(['n1-c']);
      expect(reviews['n1-c']).toHaveLength(2);
      expect(reviews['n1-c']).toContain('sv-block');
    }, 120000);

    test('(c) control: an arrow-chain of single prompts opens its run and its gate stays on its node', async () => {
      const before = countRuns();
      const gates = [{ name: 'tgt105c', criteria: ['TGT-105-N2'], target_step_id: 'n2' }];
      const run = await start({ command: `>>sv_a${ARROW}>>sv_b`, gates });
      expect(countRuns()).toBe(before + 1);
      expect(runState(run.chainId).steps).toEqual(['n1:sv_a:[]', 'n2:sv_b:[]']);
      expect(run.text).not.toContain('TGT-105-N2');
      const second = await run.call({ user_response: 'A out' });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('TGT-105-N2');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `4861cc5c`: a request gate on the arrow-chain source targeting an id no
   * segment declares (`nope`) was accepted, opened a run and never rendered, because the arrow
   * builder validated an IR without the request's gates; a workflow submission's own `gates` were
   * checked, a `gates` parameter sent beside it was not. On the same tree an arrow-chain gate
   * targeting the expanded id `n1-b` was accepted and rendered on that step.
   */
  describe('P6.117: a request gate target is checked against the declared node ids', () => {
    const NOPE = '[gate-target-missing] node "nope": Gate binding targets step id "nope"';

    test('(a) an arrow-chain request gate naming no declared node is refused by name, creating nothing', async () => {
      const before = countRuns();
      const gates = [{ name: 'tgt117', criteria: ['TGT-117-NOPE'], target_step_id: 'nope' }];
      const result = await tool('prompt_engine', { command: `>>sv_a${ARROW}>>sv_b`, gates });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Nothing was executed and no run was created.');
      expect(result.text).toContain(NOPE);
      expect(countRuns()).toBe(before);
    }, 120000);

    test('(b) a `gates` parameter beside a workflow naming no declared node is refused by name', async () => {
      const before = countRuns();
      const result = await tool('prompt_engine', {
        workflow: {
          version: 1,
          nodes: [
            { id: 'x', promptId: 'sv_a' },
            { id: 'y', promptId: 'sv_b' },
          ],
        },
        gates: [{ name: 'tgt117w', criteria: ['TGT-117-W'], target_step_id: 'nope' }],
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(NOPE);
      expect(countRuns()).toBe(before);
    }, 120000);

    // Before P6.117 this gate was accepted and rendered on `n1-b`: an expanded id is not a declared
    // one, and the arrow-chain source now answers as the workflow source does (P6.106).
    test('(d) an arrow-chain request gate naming an expanded id is refused like a workflow one', async () => {
      const before = countRuns();
      const gates = [{ name: 'tgt117x', criteria: ['TGT-117-XB'], target_step_id: 'n1-b' }];
      const result = await tool('prompt_engine', { command: `>>sv_chain${ARROW}>>sv_b`, gates });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(
        '[gate-target-missing] node "n1-b": Gate binding targets step id "n1-b"'
      );
      expect(countRuns()).toBe(before);
    }, 120000);

    test('(c) control: the same arrow-chain gate targeting `n2` opens the run and renders on n2', async () => {
      const before = countRuns();
      const gates = [{ name: 'tgt117c', criteria: ['TGT-117-N2'], target_step_id: 'n2' }];
      const run = await start({ command: `>>sv_a${ARROW}>>sv_b`, gates });
      expect(countRuns()).toBe(before + 1);
      expect(run.text).not.toContain('TGT-117-N2');
      const second = await run.call({ user_response: 'A out' });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('TGT-117-N2');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-27 on `327dcbce` (driven, this harness): a request gate targeting `nope` on a
   * direct `>>sv_chain` opened `chain-sv_chain#1` with review `{a:["sv-block"]}` and never rendered;
   * on `>>sv_chain :: "…"` it opened `chain-sv_chain#2`; on a single prompt `>>sv_a` it rendered
   * anyway, the target ignored. Neither source called the validator, and the registrar only logs
   * "target_step_id not found in this run". A single prompt declares one node, `n1` (the id the
   * symbolic parser mints for its one step).
   */
  describe('P6.124: every command source checks a request gate target', () => {
    const NOPE = '[gate-target-missing] node "nope": Gate binding targets step id "nope"';
    const refusedWithoutRun = async (args: Record<string, unknown>): Promise<void> => {
      const before = countRuns();
      const result = await tool('prompt_engine', args);
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Nothing was executed and no run was created.');
      expect(result.text).toContain(NOPE);
      expect(countRuns()).toBe(before);
    };

    test('(a) a direct chain prompt refuses a target no step declares, creating nothing', async () => {
      await refusedWithoutRun({
        command: '>>sv_chain',
        gates: [{ name: 'tgt124a', criteria: ['TGT-124-A'], target_step_id: 'nope' }],
      });
    }, 120000);

    test('(b) a single symbolic chain prompt refuses the same target, creating nothing', async () => {
      await refusedWithoutRun({
        command: '>>sv_chain :: "CRIT-124-B"',
        gates: [{ name: 'tgt124b', criteria: ['TGT-124-B'], target_step_id: 'nope' }],
      });
    }, 120000);

    test('(c) control: a target naming step `b` opens the run and renders on step b only', async () => {
      const before = countRuns();
      const gates = [{ name: 'tgt124c', criteria: ['TGT-124-C'], target_step_id: 'b' }];
      const run = await start({ command: '>>sv_chain', gates });
      expect(countRuns()).toBe(before + 1);
      expect(run.text).not.toContain('TGT-124-C');
      const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('TGT-124-C');
    }, 120000);

    test('(d) a single prompt declares `n1`: another target is refused, `n1` renders', async () => {
      await refusedWithoutRun({
        command: '>>sv_a',
        gates: [{ name: 'tgt124d', criteria: ['TGT-124-D'], target_step_id: 'nope' }],
      });
      const n1 = await tool('prompt_engine', {
        command: '>>sv_a',
        gates: [{ name: 'tgt124e', criteria: ['TGT-124-E'], target_step_id: 'n1' }],
      });
      expect(n1.isError).toBe(false);
      expect(n1.text).toContain('TGT-124-E');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-27 on `2a3e69c1`: a resume carrying `gates: [{ target_step_id: "nope" }]` on a
   * live `>>sv_chain` run returned `isError: false`, advanced the run, and never rendered the
   * criterion. The resume restores the run's blueprint and now checks the targets against the
   * run's declared node ids, as every start source does (P6.124).
   */
  describe('P6.126: a resume checks a request gate target against the run it resumes', () => {
    const NOPE = '[gate-target-missing] node "nope": Gate binding targets step id "nope"';

    /** `chain_runs.state` exactly as stored, so an untouched run compares byte for byte. */
    function rawState(chainId: string): string | undefined {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const row = db.prepare('SELECT state FROM chain_runs WHERE chain_id = ?').get(chainId) as
          { state: string } | undefined;
        return row?.state;
      } finally {
        db.close();
      }
    }

    test('(a) a target the run does not declare is refused by name, the run untouched', async () => {
      const run = await start({ command: '>>sv_chain' });
      const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      const before = rawState(run.chainId);
      expect(before).toBeDefined();
      const runs = countRuns();

      const refused = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'B out',
        gate_verdict: PASS,
        gates: [{ name: 'tgt126a', criteria: ['TGT-126-A'], target_step_id: 'nope' }],
      });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(NOPE);
      expect(refused.text).not.toContain('TGT-126-A');
      expect(rawState(run.chainId)).toBe(before);
      expect(countRuns()).toBe(runs);

      // The run is still at step b: the same answer advances it to step c.
      const third = await run.call({ user_response: 'B out', gate_verdict: PASS });
      expect(templates(third)).toEqual(['BODY-sv_a topic=']);
      expect(third).not.toContain('TGT-126-A');
    }, 120000);

    test("(b) control: a target naming the run's next node renders there", async () => {
      const run = await start({ command: '>>sv_chain' });
      expect(run.text).not.toContain('TGT-126-B');
      const second = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'A out',
        gate_verdict: PASS,
        gates: [{ name: 'tgt126b', criteria: ['TGT-126-B'], target_step_id: 'b' }],
      });
      expect(second.isError).toBe(false);
      expect(templates(second.text)).toEqual(['BODY-sv_b topic=']);
      expect(second.text).toContain('TGT-126-B');
    }, 120000);
  });

  /** `chain_runs.state` exactly as stored, so an untouched run compares byte for byte. */
  function rawRunState(chainId: string): string | undefined {
    const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const row = db.prepare('SELECT state FROM chain_runs WHERE chain_id = ?').get(chainId) as
        { state: string } | undefined;
      return row?.state;
    } finally {
      db.close();
    }
  }

  /** A resume carrying one request gate, as a client sends it. */
  const resumeWithGate = (chainId: string, answer: string, target: string, marker: string) =>
    tool('prompt_engine', {
      chain_id: chainId,
      user_response: answer,
      gate_verdict: PASS,
      gates: [{ name: marker.toLowerCase(), criteria: [marker], target_step_id: target }],
    });

  /**
   * MEASURED 2026-09-27 on `5f187905` (driven, this harness): a workflow `{x: sv_chain, y: sv_b}`
   * resumed at `x-b` with a gate targeting `x` was refused `gate-target-missing`, while `x-b` was
   * accepted — the reverse of the start call, which accepts `x` and retargets it to `x-c` (R51). The
   * blueprint carried the expanded step ids only.
   *
   * Now (R58) the blueprint carries the run's declared node ids and the retarget map, and a resume
   * checks and retargets its request gates exactly as the start call did.
   */
  describe('P6.133: a resume addresses the nodes the run declared', () => {
    const workflow = {
      workflow: {
        version: 1,
        nodes: [
          { id: 'x', promptId: 'sv_chain' },
          { id: 'y', promptId: 'sv_b' },
        ],
        edges: [{ from: 'x', to: 'y' }],
      },
    };

    test("(a) a gate on the expanded node's declared id is accepted and renders on its last step", async () => {
      const run = await start(workflow);
      const stored = JSON.parse(rawRunState(run.chainId) ?? '{}') as {
        blueprint?: { parsedCommand?: { declaredNodes?: unknown } };
      };
      expect(stored.blueprint?.parsedCommand?.declaredNodes).toEqual({
        ids: ['x', 'y'],
        lastStepOf: { x: 'x-c' },
      });
      const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);

      const third = await resumeWithGate(run.chainId, 'B out', 'x', 'TGT-133-A');
      expect(third.isError).toBe(false);
      expect(templates(third.text)).toEqual(['BODY-sv_a topic=']);
      expect(third.text).toContain('Progress 3/4');
      expect(third.text).toContain('TGT-133-A');
    }, 120000);

    test('(b) an expanded step id is refused by name, the run untouched', async () => {
      const run = await start(workflow);
      await run.call({ user_response: 'A out', gate_verdict: PASS });
      const before = rawRunState(run.chainId);
      expect(before).toBeDefined();

      const refused = await resumeWithGate(run.chainId, 'B out', 'x-b', 'TGT-133-B');
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('[gate-target-missing] node "x-b"');
      expect(rawRunState(run.chainId)).toBe(before);
    }, 120000);

    test('(c) control: a run with no expanded node resumes as before, and carries no declared map', async () => {
      const run = await start({
        workflow: {
          version: 1,
          nodes: [
            { id: 'p', promptId: 'sv_a' },
            { id: 'q', promptId: 'sv_b' },
          ],
          edges: [{ from: 'p', to: 'q' }],
        },
      });
      const second = await resumeWithGate(run.chainId, 'P out', 'q', 'TGT-133-C');
      expect(second.isError).toBe(false);
      expect(templates(second.text)).toEqual(['BODY-sv_b topic=']);
      expect(second.text).toContain('TGT-133-C');
      expect(rawRunState(run.chainId)).not.toContain('declaredNodes');
    }, 120000);

    test('(d) the arrow-chain form: a gate on the segment node renders on its last step', async () => {
      const run = await start({ command: `>>sv_chain${ARROW}>>sv_b` });
      await run.call({ user_response: 'A out', gate_verdict: PASS });

      const third = await resumeWithGate(run.chainId, 'B out', 'n1', 'TGT-133-D');
      expect(third.isError).toBe(false);
      expect(templates(third.text)).toEqual(['BODY-sv_a topic=']);
      expect(third.text).toContain('TGT-133-D');

      const refused = await resumeWithGate(run.chainId, 'C out', 'n1-c', 'TGT-133-E');
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('[gate-target-missing] node "n1-c"');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-27 on `5f187905` (driven, this harness): a `>>sv_chain` run standing at `b`,
   * resumed with a gate targeting `a`, was accepted and advanced to `c` — a gate that can never
   * fire, its step already answered.
   *
   * Now (R59) a request gate naming a node the run has already passed is refused by name.
   *
   * MEASURED 2026-09-27 on `656427ea` (driven, this harness, before R64/R65): a resume targeting the
   * node it answers (`b` at `b`, `n1` on a one-node run) was accepted and rendered nowhere; a gate
   * first sent on a resume and re-sent once its target passed was refused (stage 13's exemption
   * read only the start call's gate ids); `target_step_number: 1` at `b` was accepted unchecked.
   *
   * Now (R64, R65) the registrar (stage 11) refuses a NEW gate targeting the node the call answers
   * or an earlier one, in either name form, through stage 04's rejection render; a gate the run
   * already holds under its id is the held gate, whichever call first sent it.
   */
  describe('P6.134/P6.136-P6.138: a resume refuses a gate on a step it can no longer reach', () => {
    const numbered = (chainId: string, answer: string, step: number, marker: string) =>
      tool('prompt_engine', {
        chain_id: chainId,
        user_response: answer,
        gate_verdict: PASS,
        gates: [{ name: marker.toLowerCase(), criteria: [marker], target_step_number: step }],
      });

    test('(a) a target behind the current node is refused by name, the run untouched', async () => {
      const run = await start({ command: '>>sv_chain' });
      await run.call({ user_response: 'A out', gate_verdict: PASS });
      const before = rawRunState(run.chainId);

      const refused = await resumeWithGate(run.chainId, 'B out', 'a', 'TGT-134-A');
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('❌ Workflow rejected — 1 problem found.');
      expect(refused.text).toContain(
        '[gate-target-passed] node "a": target_step_id "a" names a step the run has already passed'
      );
      expect(refused.text).not.toContain('TGT-134-A');
      expect(rawRunState(run.chainId)).toBe(before);
    }, 120000);

    test('(b) the node this call answers is refused by name (R64); a later node is accepted', async () => {
      const current = await start({ command: '>>sv_chain' });
      await current.call({ user_response: 'A out', gate_verdict: PASS });
      const before = rawRunState(current.chainId);
      const onCurrent = await resumeWithGate(current.chainId, 'B out', 'b', 'TGT-134-B');
      expect(onCurrent.isError).toBe(true);
      expect(onCurrent.text).toContain(
        '[gate-target-passed] node "b": target_step_id "b" names the step this call answers; target "c" or later'
      );
      expect(onCurrent.text).not.toContain('TGT-134-B');
      expect(rawRunState(current.chainId)).toBe(before);

      const later = await start({ command: '>>sv_chain' });
      await later.call({ user_response: 'A out', gate_verdict: PASS });
      const onLater = await resumeWithGate(later.chainId, 'B out', 'c', 'TGT-134-C');
      expect(onLater.isError).toBe(false);
      expect(templates(onLater.text)).toEqual(['BODY-sv_a topic=']);
      expect(onLater.text).toContain('TGT-134-C');
    }, 120000);

    test('(c) a one-node run: n1 is accepted on the start call and refused on the resume that answers it', async () => {
      const gates = (marker: string) => [
        { name: marker.toLowerCase(), criteria: [marker], target_step_id: 'n1' },
      ];
      const run = await start({ command: '>>sv_a :: "CRIT-134"', gates: gates('TGT-134-START') });
      expect(run.text).toContain('TGT-134-START');

      const answered = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'out',
        gate_verdict: PASS,
        gates: gates('TGT-134-N1'),
      });
      expect(answered.isError).toBe(true);
      expect(answered.text).toContain(
        'target_step_id "n1" names the step this call answers; the run has no later step'
      );
    }, 120000);

    test('(d) control: re-sending a start-call gate under its id stays accepted after its step', async () => {
      const gates = [{ id: 'rs134', name: 'rs134', criteria: ['RS-134'], target_step_id: 'a' }];
      const run = await start({ command: '>>sv_chain', gates });
      expect(run.text).toContain('RS-134');
      await run.call({ user_response: 'A out', gate_verdict: PASS, gates });
      const resent = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'B out',
        gate_verdict: PASS,
        gates,
      });
      expect(resent.isError).toBe(false);
      expect(templates(resent.text)).toEqual(['BODY-sv_a topic=']);
    }, 120000);

    test('(e) a gate first sent on a resume is the held gate when re-sent after its step', async () => {
      const gates = [{ id: 'rs136', name: 'rs136', criteria: ['RS-136'], target_step_id: 'b' }];
      const run = await start({ command: '>>sv_chain' });
      const first = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'A out',
        gate_verdict: PASS,
        gates,
      });
      expect(first.isError).toBe(false);
      expect(first.text).toContain('RS-136');

      for (const answer of ['B out', 'C out']) {
        const resent = await tool('prompt_engine', {
          chain_id: run.chainId,
          user_response: answer,
          gate_verdict: PASS,
          gates,
        });
        expect(resent.isError).toBe(false);
        expect(resent.text).not.toContain('gate-target-passed');
      }
    }, 120000);

    test('(f) target_step_number at a passed step is refused by name, the run untouched', async () => {
      const run = await start({ command: '>>sv_chain' });
      await run.call({ user_response: 'A out', gate_verdict: PASS });
      const before = rawRunState(run.chainId);

      const refused = await numbered(run.chainId, 'B out', 1, 'TGT-138-1');
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(
        '[gate-target-passed] node "a": target_step_number 1 names a step the run has already passed'
      );
      expect(refused.text).not.toContain('TGT-138-1');
      expect(rawRunState(run.chainId)).toBe(before);
    }, 120000);

    test('(g) control: target_step_number at a later step is accepted and renders there', async () => {
      const run = await start({ command: '>>sv_chain' });
      await run.call({ user_response: 'A out', gate_verdict: PASS });

      const accepted = await numbered(run.chainId, 'B out', 3, 'TGT-138-3');
      expect(accepted.isError).toBe(false);
      expect(templates(accepted.text)).toEqual(['BODY-sv_a topic=']);
      expect(accepted.text).toContain('TGT-138-3');
    }, 120000);
  });

  /**
   * PIN (as of 2026-09-27 · flips when a gated single prompt stops opening a run). A single prompt
   * with an inline gate operator opens a run of ONE node, `n1` (R52), because the planner requires
   * a session for any `gate` operator (`ExecutionPlanner.requiresSession`, its operator clause — not
   * a held review: the criterion's gate is advisory, and a FAIL on it only warns); `>>sv_a` alone
   * carries no gate (its `gate_configuration` excludes every default) and opens none. The row is read: the
   * reply hands out its `chain_id`, and the call that answers it resumes and completes that run.
   * The `steps: []` the P6.124 measurement saw is the blueprint's `parsedCommand.steps`, which a
   * single prompt never has; the run's node list lives in `chain_run_nodes`.
   */
  describe('P6.127: a gated single prompt is a run of one node', () => {
    function runRows(chainId: string): {
      run?: { run_status: string; current_node_id: string | null };
      nodes: Array<{ node_id: string; position: number }>;
      view: Array<{ current_step: number; total_steps: number }>;
    } {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const run = db
          .prepare(
            'SELECT session_id, run_status, current_node_id FROM chain_runs WHERE chain_id = ?'
          )
          .get(chainId) as
          { session_id: string; run_status: string; current_node_id: string | null } | undefined;
        const nodes = (
          run === undefined
            ? []
            : db
                .prepare(
                  'SELECT node_id, position FROM chain_run_nodes WHERE session_id = ? ORDER BY position'
                )
                .all(run.session_id)
        ) as Array<{ node_id: string; position: number }>;
        const view = db
          .prepare('SELECT current_step, total_steps FROM v_execution_status WHERE chain_id = ?')
          .all(chainId) as Array<{ current_step: number; total_steps: number }>;
        return {
          ...(run === undefined
            ? {}
            : { run: { run_status: run.run_status, current_node_id: run.current_node_id } }),
          nodes: nodes.map(({ node_id, position }) => ({ node_id, position })),
          view: view.map(({ current_step, total_steps }) => ({ current_step, total_steps })),
        };
      } finally {
        db.close();
      }
    }

    test('control: the bare prompt carries no gate and opens no run', async () => {
      const before = countRuns();
      const bare = await tool('prompt_engine', { command: '>>sv_a' });
      expect(bare.isError).toBe(false);
      expect(templates(bare.text)).toEqual(['BODY-sv_a topic=']);
      expect(bare.text).not.toContain('chain_id');
      expect(countRuns()).toBe(before);
    }, 120000);

    test('an inline gate opens one node `n1`, shown 1/1, resumed and completed by its answer', async () => {
      const before = countRuns();
      const run = await start({ command: '>>sv_a :: "CRIT-127"' });
      expect(countRuns()).toBe(before + 1);
      expect(run.text).toContain('CRIT-127');
      expect(runRows(run.chainId)).toEqual({
        run: { run_status: 'working', current_node_id: 'n1' },
        nodes: [{ node_id: 'n1', position: 1 }],
        view: [{ current_step: 1, total_steps: 1 }],
      });
      expect(runState(run.chainId).steps).toEqual([]);

      await run.call({ user_response: 'out', gate_verdict: PASS });
      expect(runRows(run.chainId).run).toEqual({ run_status: 'completed', current_node_id: null });
    }, 120000);

    /**
     * P6.135 PIN (as of 2026-09-27 · flips when a reader shows a stepless run's node prompt id —
     * the interrupt's remaining nodes, a node-driven render of `n1`, an execution record's
     * `prompt_id` — or when the mint records the parsed prompt id). The one node a stepless run
     * mints records the CHAIN id as its prompt (`ChainSessionStore.resolveCreationNodes`); measured
     * readers: `chain_run_nodes.prompt_id` only. The re-render after a FAIL renders the prompt
     * itself, the session list names the blueprint's prompt, execution records name the parsed
     * prompt (`sv_a`, R66 — never the node's recorded chain id), and the interrupt lists only
     * nodes after the current one, of which a one-node run has none.
     */
    test('P6.135 the one node records the chain id as its prompt, and no reply shows it', async () => {
      const run = await start({ command: '>>sv_a :: "sv-block"' });
      const failed = await run.call({ user_response: 'out', gate_verdict: FAIL });
      expect(templates(failed)).toEqual(['BODY-sv_a topic=']);
      const listed = (await tool('system_control', { action: 'session', operation: 'list' })).text;
      expect(listed).toContain(`**Chain**: \`${run.chainId}\` (\`sv_a\`)`);
      const history = (
        await tool('system_control', {
          action: 'execution_history',
          operation: 'steps',
          session_id: run.chainId,
        })
      ).text;
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const nodes = db
          .prepare(
            'SELECT n.node_id, n.prompt_id FROM chain_run_nodes n ' +
              'JOIN chain_runs r ON r.session_id = n.session_id WHERE r.chain_id = ?'
          )
          .all(run.chainId);
        expect(nodes).toEqual([{ node_id: 'n1', prompt_id: run.chainId }]);
      } finally {
        db.close();
      }
      for (const text of [run.text, failed, listed, history]) {
        expect(text).not.toContain(`(\`${run.chainId}\`)`);
        expect(text).not.toContain(`· ${run.chainId}`);
      }
    }, 120000);
  });

  /**
   * P6.144 / R66. MEASURED 2026-09-27 on `6dad55f3`: after `>>sv_a :: "sv-block"` and a FAIL sent
   * with the answer, the run held one record, `completed` with `prompt_id` null, and
   * `execution_history` listed `completed step 1`. The capture writer (`ledgerCapturedStep`) wrote
   * `completed` whether or not a review held the step — `>>sv_chain` answered with a FAIL did the
   * same — and resolved the prompt from the parse-time steps, which a stepless run has none of;
   * on a chain it fell back to the ordinal, so an inserted `inv-u-r` was recorded as `sv_b` and the
   * remainder nodes as null. Now a held capture writes `input_required`, and every record names
   * its prompt through `recordedStep`.
   */
  describe('P6.144: an execution record names its prompt and a held step awaits its review', () => {
    function records(chainId: string): Array<{
      step: number | null;
      node: string | null;
      prompt: string | null;
      status: string;
      reason: unknown;
    }> {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const rows = db
          .prepare(
            'SELECT step_number, node_id, prompt_id, status, input_required_json FROM ' +
              'execution_records WHERE chain_id = ? ORDER BY execution_id'
          )
          .all(chainId) as Array<{
          step_number: number | null;
          node_id: string | null;
          prompt_id: string | null;
          status: string;
          input_required_json: string | null;
        }>;
        return rows.map((row) => ({
          step: row.step_number,
          node: row.node_id,
          prompt: row.prompt_id,
          status: row.status,
          reason: row.input_required_json === null ? null : JSON.parse(row.input_required_json),
        }));
      } finally {
        db.close();
      }
    }

    const history = async (chainId: string): Promise<string> =>
      (
        await tool('system_control', {
          action: 'execution_history',
          operation: 'steps',
          session_id: chainId,
        })
      ).text;

    test('(a) a FAIL on a blocking one-node run leaves the step awaiting its review', async () => {
      const run = await start({ command: '>>sv_a :: "sv-block"' });
      const failed = await run.call({ user_response: 'out', gate_verdict: FAIL });
      expect(failed).toContain('Review Required');
      const latest = records(run.chainId).at(-1);
      expect(latest).toMatchObject({
        step: 1,
        node: 'n1',
        prompt: 'sv_a',
        status: 'input_required',
      });
      expect(latest?.reason).toMatchObject({ kind: 'gate_review', attempt: 1 });
      expect(await history(run.chainId)).toContain('⏸️ `input_required` step 1 · sv_a');

      // The PASS that clears the review completes the step, still naming the prompt
      await run.call({ gate_verdict: PASS });
      expect(records(run.chainId).at(-2)).toMatchObject({
        step: 1,
        prompt: 'sv_a',
        status: 'completed',
      });
      expect(await history(run.chainId)).toContain('✅ `completed` step 1 · sv_a');
    }, 120000);

    test('(b) control: a PASS on the same run completes it, every record naming sv_a', async () => {
      const run = await start({ command: '>>sv_a :: "sv-block"' });
      await run.call({ user_response: 'out', gate_verdict: PASS });
      expect(records(run.chainId)).toEqual([
        { step: 1, node: 'n1', prompt: 'sv_a', status: 'completed', reason: null },
        { step: null, node: null, prompt: 'sv_a', status: 'completed', reason: null },
      ]);
    }, 120000);

    test("(c) a chain's records name each step's prompt, inserted and remainder nodes included", async () => {
      const gated = await start({ command: '>>sv_chain' });
      await gated.call({ user_response: 'A out', gate_verdict: FAIL });
      expect(records(gated.chainId).at(-1)).toMatchObject({
        step: 1,
        node: 'a',
        prompt: 'sv_a',
        status: 'input_required',
      });

      const run = await start({ command: `>>sv_a${ARROW}>>sv_b` });
      await run.call({
        user_response: 'A out',
        observations: [
          { type: 'unknown_discovered', id: 'u-144', statement: 'undecided', blocking: true },
        ],
      });
      await run.call({
        user_response: 'investigated',
        remainder: { mode: 'append', nodes: [{ id: 'r1', promptId: 'sv_pair' }] },
      });
      for (const reply of ['B out', 'r1-a out', 'r1-b out']) {
        await run.call({ user_response: reply });
      }
      const completed = records(run.chainId)
        .filter((record) => record.status === 'completed')
        .map((record) => `${record.node ?? 'run'}:${record.prompt}`);
      expect(completed).toEqual([
        'n1:sv_a',
        'inv-u-144:investigate_unknown',
        'n2:sv_b',
        'r1-a:sv_a',
        'r1-b:sv_b',
        'run:sv_a',
      ]);
    }, 120000);
  });

  describe('P6.93: a remainder naming a chain prompt', () => {
    /** The run's live nodes, as `chain_run_nodes` holds them. */
    function runNodes(chainId: string): string[] {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const rows = db
          .prepare(
            'SELECT n.node_id, n.prompt_id, n.origin FROM chain_run_nodes n ' +
              'JOIN chain_runs r ON r.session_id = n.session_id WHERE r.chain_id = ? ' +
              'ORDER BY n.position'
          )
          .all(chainId) as Array<{ node_id: string; prompt_id: string; origin: string }>;
        return rows.map((row) => `${row.node_id}:${row.prompt_id}:${row.origin}`);
      } finally {
        db.close();
      }
    }

    const PLANNED = [
      'n1:sv_a:planned',
      'inv-u-remainder:investigate_unknown:inserted',
      'n2:sv_b:planned',
    ];

    /** Open `sv_a` then `sv_b`, declare a blocking unknown on step 1, then submit `append`. */
    async function appendTo(append: Record<string, unknown>) {
      const run = await start({ command: `>>sv_a${ARROW}>>sv_b` });
      await run.call({
        user_response: 'A out',
        observations: [
          {
            type: 'unknown_discovered',
            id: 'u-remainder',
            statement: 'the rest of the plan is undecided',
            blocking: true,
          },
        ],
      });
      const reply = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'investigated',
        ...append,
      });
      return { run, reply };
    }

    const remainder = (node: Record<string, unknown>) => ({
      remainder: { mode: 'append', nodes: [{ id: 'r1', ...node }] },
    });
    const arrowAppend = (promptId: string) => ({ command: `${ARROW.trim()} >>${promptId}` });

    test('(a) an appended chain-prompt node becomes its steps, each rendering its own template', async () => {
      const { run, reply } = await appendTo(
        remainder({ promptId: 'sv_pair', args: { topic: 'TR' } })
      );
      expect(reply.isError).toBe(false);
      expect(runNodes(run.chainId)).toEqual([
        ...PLANNED,
        'r1-a:sv_a:remainder',
        'r1-b:sv_b:remainder',
      ]);
      expect(reply.text).toContain('Progress 3/5');
      const fourth = await run.call({ user_response: 'B out' });
      expect(templates(fourth)).toEqual(['BODY-sv_a topic=TR']);
      expect(fourth).not.toContain('CHAIN-OWN-TEMPLATE');
      const fifth = await run.call({ user_response: 'r1-a out' });
      expect(templates(fifth)).toEqual(['BODY-sv_b topic=TR']);
      expect(fifth).toContain('Progress 5/5');
    }, 120000);

    /** Each remainder node's `inline_gate_ids` column, in run order (P6.101). */
    function nodeGates(chainId: string): string[] {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const rows = db
          .prepare(
            'SELECT n.node_id, n.inline_gate_ids FROM chain_run_nodes n ' +
              'JOIN chain_runs r ON r.session_id = n.session_id WHERE r.chain_id = ? ' +
              "AND n.origin = 'remainder' ORDER BY n.position"
          )
          .all(chainId) as Array<{ node_id: string; inline_gate_ids: string | null }>;
        return rows.map((row) => `${row.node_id}:${row.inline_gate_ids ?? 'null'}`);
      } finally {
        db.close();
      }
    }

    /**
     * Walk the appended sv_chain steps, FAILing each once: every step's FAIL opens a review of its
     * own `sv-block` gate, and the PASS that clears it moves the run on. Gate guidance on a plain
     * step render follows the shipped injection frequency (first-only), so the review is where a
     * contributed step's gate shows, as it is for a parse-time step past the first.
     */
    async function walkGatedRemainder(run: { chainId: string; call: Call }, ids: string[]) {
      const first = await run.call({ user_response: 'B out' });
      expect(templates(first)).toEqual(['BODY-sv_a topic=']);
      const bodies = ['BODY-sv_b topic=', 'BODY-sv_a topic='];
      for (const [index, id] of ids.entries()) {
        const failed = await run.call({ user_response: `${id} out`, gate_verdict: FAIL });
        expect(failed).toContain('Gate Review Required');
        expect(failed).toContain('### sv-block');
        expect(runState(run.chainId).reviews).toEqual({ [id]: ['sv-block'] });
        const passed = await run.call({ user_response: `${id} fixed`, gate_verdict: PASS });
        if (index < bodies.length) expect(templates(passed)).toEqual([bodies[index]]);
        expect(runState(run.chainId).reviews).toEqual({});
      }
    }

    /**
     * P6.101 / R68. MEASURED 2026-09-27 on `6dad55f3`: this remainder was refused by name (R46,
     * "- step \"r1-b\": inlineGateIds"), because a contributed node carried only {id, promptId,
     * stepName, args, delegated} and its synthesized step had no gates. Now the node carries its
     * step's gate ids (`chain_run_nodes.inline_gate_ids`, v32) and gate enhancement walks the
     * step the way it walks a parse-time one.
     */
    test('(a) P6.101: a chain prompt whose steps declare gates runs them with those gates', async () => {
      const { run, reply } = await appendTo(remainder({ promptId: 'sv_chain' }));
      expect(reply.isError).toBe(false);
      expect(runNodes(run.chainId)).toEqual([
        ...PLANNED,
        'r1-a:sv_a:remainder',
        'r1-b:sv_b:remainder',
        'r1-c:sv_a:remainder',
      ]);
      expect(nodeGates(run.chainId)).toEqual([
        'r1-a:["sv-block"]',
        'r1-b:["sv-block"]',
        'r1-c:["sv-block"]',
      ]);
      await walkGatedRemainder({ chainId: run.chainId, call: run.call }, ['r1-a', 'r1-b', 'r1-c']);
    }, 120000);

    test('(d) P6.101: a bundled chain prompt whose steps declare gates is accepted as a remainder', async () => {
      const { run, reply } = await appendTo(
        remainder({ promptId: 'research_chain', args: { topic: 'caching' } })
      );
      expect(reply.isError).toBe(false);
      // Its steps declare no ids, so each node id derives from the step's name
      expect(runNodes(run.chainId).slice(PLANNED.length)).toEqual([
        'r1-initial-scan-step-1-of-4:initial_scan:remainder',
        'r1-deep-investigation-step-2-of-4:deep_investigation:remainder',
        'r1-synthesis-step-3-of-4:research_synthesis:remainder',
        'r1-action-plan-step-4-of-4:action_plan:remainder',
      ]);
      expect(nodeGates(run.chainId)).toEqual([
        'r1-initial-scan-step-1-of-4:null',
        'r1-deep-investigation-step-2-of-4:["Source Citations"]',
        'r1-synthesis-step-3-of-4:null',
        'r1-action-plan-step-4-of-4:["Actionable Recommendations"]',
      ]);
      const first = await run.call({ user_response: 'B out' });
      expect(first).toContain('Progress 4/7');
      const second = await run.call({ user_response: 'scan out', gate_verdict: PASS });
      expect(second).toContain('Progress 5/7');
      expect(second).not.toContain('Error');
    }, 120000);

    test('(b) control: a remainder of single prompts is unchanged', async () => {
      const { run, reply } = await appendTo(remainder({ promptId: 'sv_b' }));
      expect(reply.isError).toBe(false);
      expect(runNodes(run.chainId)).toEqual([...PLANNED, 'r1:sv_b:remainder']);
    }, 120000);

    test('(c) the arrow-append spelling reaches the same expansion and carries the same gates', async () => {
      const plain = await appendTo(arrowAppend('sv_pair'));
      expect(plain.reply.isError).toBe(false);
      expect(runNodes(plain.run.chainId)).toEqual([
        ...PLANNED,
        'sv-pair-a:sv_a:remainder',
        'sv-pair-b:sv_b:remainder',
      ]);
      const fourth = await plain.run.call({ user_response: 'B out' });
      expect(templates(fourth)).toEqual(['BODY-sv_a topic=']);

      // (b) P6.101: the gated chain prompt, appended by arrow, runs with its gates
      const gated = await appendTo(arrowAppend('sv_chain'));
      expect(gated.reply.isError).toBe(false);
      expect(nodeGates(gated.run.chainId)).toEqual([
        'sv-chain-a:["sv-block"]',
        'sv-chain-b:["sv-block"]',
        'sv-chain-c:["sv-block"]',
      ]);
      await walkGatedRemainder({ chainId: gated.run.chainId, call: gated.run.call }, [
        'sv-chain-a',
        'sv-chain-b',
        'sv-chain-c',
      ]);
    }, 120000);

    test("(d) the node cap counts the run's nodes after the write, expanded", async () => {
      const { run, reply } = await appendTo(remainder({ promptId: 'sv_big' }));
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(
        '- cap-exceeded: Expanding chain prompt "sv_big" yields 32 nodes; the expanded workflow has 32 nodes, exceeding the effective maxNodes cap of 29'
      );
      expect(runNodes(run.chainId)).toEqual(PLANNED);
    }, 120000);

    /** The node the run stands on, as `chain_runs.current_node_id` holds it. */
    function currentNode(chainId: string): string | null {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
      try {
        const row = db
          .prepare('SELECT current_node_id FROM chain_runs WHERE chain_id = ?')
          .get(chainId) as { current_node_id: string | null } | undefined;
        return row?.current_node_id ?? null;
      } finally {
        db.close();
      }
    }

    /** The gate reminders a step render asks the verdict to attest. */
    const reminders = (text: string): string | undefined =>
      /"reminders": \{"satisfied": (\[[^\]]*\])/.exec(text)?.[1];

    const blockingUnknown = {
      observations: [
        {
          type: 'unknown_discovered',
          id: 'u-160',
          statement: 'the rest of the plan is undecided',
          blocking: true,
        },
      ],
    };

    /**
     * P6.160 / R71. MEASURED 2026-09-27 on `0900e73d` (shipped defaults, CAGEERF): the ungated
     * `sv_dpair` remainder rendered its steps with no gates at all, and a FAIL on `r1-b` was
     * refused "Step 5 carries no gates", while the same prompts as planned steps carry the
     * category and framework defaults. Only a GATED contributed node joined the gate walk.
     */
    test('P6.160 (a) an ungated remainder step carries the default gates a planned step does', async () => {
      // The planned step's gate set, as its render asks the verdict to attest it. A planned
      // step's own FAIL review is not the comparison: its CAGEERF phase guard grades the answer
      // first and the review it opens is the structural one.
      const planned = await start({ command: `>>sv_d${ARROW}>>sv_e` });
      const plannedGates = JSON.parse(reminders(planned.text) ?? '[]') as string[];
      expect(plannedGates).toEqual(['content-structure', 'framework-compliance']);

      const { run, reply } = await appendTo(remainder({ promptId: 'sv_dpair' }));
      expect(reply.isError).toBe(false);
      const first = await run.call({ user_response: 'B out' });
      expect(templates(first)).toEqual(['BODY-sv_d topic=']);
      await run.call({ user_response: 'r1-a out', gate_verdict: PASS });
      expect(currentNode(run.chainId)).toBe('r1-b');
      const failed = await run.call({ user_response: 'r1-b out', gate_verdict: FAIL });
      expect(failed).not.toContain('carries no gates');
      expect(runState(run.chainId).reviews).toEqual({ 'r1-b': plannedGates });
    }, 120000);

    /**
     * P6.160 / R71. MEASURED 2026-09-27 on `0900e73d`: a `replace` remainder dropping the planned
     * `n2` (bound to `sv-drop`) ran its `sv_chain` steps with reviews `[sv-drop, sv-block]` — the
     * joined steps were walked AFTER every parse step, so they accumulated the gate of a step the
     * run no longer has. The walk now follows the run's node order.
     */
    test('P6.160 (b) a replace remainder walks in run order: the dropped step contributes nothing', async () => {
      const run = await start({ command: `>>sv_a${ARROW}>>sv_b :: sv-drop` });
      expect(runState(run.chainId).steps).toEqual(['n1:sv_a:[]', 'n2:sv_b:["sv-drop"]']);
      await run.call({ user_response: 'A out', ...blockingUnknown });
      const replaced = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'investigated',
        remainder: { mode: 'replace', nodes: [{ id: 'r1', promptId: 'sv_chain' }] },
      });
      expect(replaced.isError).toBe(false);
      expect(runNodes(run.chainId)).toEqual([
        'n1:sv_a:planned',
        'inv-u-160:investigate_unknown:inserted',
        'r1-a:sv_a:remainder',
        'r1-b:sv_b:remainder',
        'r1-c:sv_a:remainder',
      ]);
      if (currentNode(run.chainId) === 'inv-u-160') {
        await run.call({ user_response: 'investigated again', gate_verdict: PASS });
      }
      const sequence: Array<Record<string, string[]>> = [];
      for (const id of ['r1-a', 'r1-b', 'r1-c']) {
        expect(currentNode(run.chainId)).toBe(id);
        await run.call({ user_response: `${id} out`, gate_verdict: FAIL });
        sequence.push(runState(run.chainId).reviews);
        await run.call({ user_response: `${id} fixed`, gate_verdict: PASS });
      }
      expect(sequence).toEqual([
        { 'r1-a': ['sv-block'] },
        { 'r1-b': ['sv-block'] },
        { 'r1-c': ['sv-block'] },
      ]);
    }, 120000);

    /**
     * P6.160 / R71. MEASURED 2026-09-27 on `0900e73d`: a gated single prompt is a run of one node
     * with no parse steps, so gate enhancement resolved it as a single prompt and never joined the
     * `sv_chain` remainder: a FAIL on `r1-a` opened no review and was reported as an advisory
     * warning of the base prompt's own criterion.
     */
    test('P6.160 (c) a gated remainder on a one-node base opens its review', async () => {
      const run = await start({ command: '>>sv_a :: "CRIT-160"' });
      expect(runState(run.chainId).steps).toEqual([]);
      await run.call({ user_response: 'out', ...blockingUnknown });
      const appended = await tool('prompt_engine', {
        chain_id: run.chainId,
        user_response: 'investigated',
        ...remainder({ promptId: 'sv_chain' }),
      });
      expect(appended.isError).toBe(false);
      expect(runNodes(run.chainId).slice(-3)).toEqual([
        'r1-a:sv_a:remainder',
        'r1-b:sv_b:remainder',
        'r1-c:sv_a:remainder',
      ]);
      expect(currentNode(run.chainId)).toBe('r1-a');
      const failed = await run.call({ user_response: 'r1-a out', gate_verdict: FAIL });
      expect(failed).not.toContain('Advisory Gate Warnings');
      const review = runState(run.chainId).reviews;
      expect(Object.keys(review)).toEqual(['r1-a']);
      expect(review['r1-a']).toContain('sv-block');
    }, 120000);
  });

  describe('P6.78: a command-level gate on a chain prompt', () => {
    /** Run to step 2, FAIL it, and return the replies plus the review the FAIL opened. */
    async function walkToReview(command: string) {
      const run = await start({ command });
      const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
      const failed = await run.call({ user_response: 'B out', gate_verdict: FAIL });
      return { run, second, failed, state: runState(run.chainId) };
    }

    test('(a) an anonymous criterion binds every step, and each review lists it beside sv-block', async () => {
      const { second, failed, state } = await walkToReview('>>sv_chain :: "EXTRA-CRIT-78"');
      expect(state.criteria).toEqual([['EXTRA-CRIT-78'], ['EXTRA-CRIT-78'], ['EXTRA-CRIT-78']]);
      for (const step of state.steps) expect(step).toContain('"sv-block","temp_');
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('EXTRA-CRIT-78');
      expect(failed).toContain('Gate Review Required');
      expect(failed).toContain('### sv-block');
      expect(failed).toContain('EXTRA-CRIT-78');
      expect(state.reviews['b']).toEqual(expect.arrayContaining(['sv-block']));
      expect(state.reviews['b']?.some((id) => id.startsWith('temp_'))).toBe(true);
    }, 120000);

    test('(b) control: a plain chain prompt carries only its own step gates', async () => {
      const { second, state } = await walkToReview('>>sv_chain');
      expect(state.steps).toEqual([
        'a:sv_a:["sv-block"]',
        'b:sv_b:["sv-block"]',
        'c:sv_a:["sv-block"]',
      ]);
      expect(state.criteria).toEqual([[], [], []]);
      expect(state.reviews).toEqual({ b: ['sv-block'] });
      expect(second).not.toContain('EXTRA-CRIT-78');
    }, 120000);

    test('(c) a shell verification stays the command-level check and folds onto no step', async () => {
      const run = await start({ command: '>>sv_chain :: verify:"false"' });
      const state = runState(run.chainId);
      expect(state.steps).toEqual([
        'a:sv_a:["sv-block"]',
        'b:sv_b:["sv-block"]',
        'c:sv_a:["sv-block"]',
      ]);
      expect(state.criteria).toEqual([[], [], []]);
      const held = await run.call({ user_response: 'A out', gate_verdict: PASS });
      expect(held).toContain('Shell Verification FAILED (Attempt 1/5)');
      expect(held).toContain('**Command:** `false`');
    }, 120000);

    test('(d) a canonical gate reference binds every step', async () => {
      const { second, failed, state } = await walkToReview('>>sv_chain :: code-quality');
      expect(state.steps).toEqual([
        'a:sv_a:["sv-block","code-quality"]',
        'b:sv_b:["sv-block","code-quality"]',
        'c:sv_a:["sv-block","code-quality"]',
      ]);
      expect(second).toContain('Code Quality');
      expect(state.reviews).toEqual({ b: ['sv-block', 'code-quality'] });
      expect(failed).toContain('### sv-block');
    }, 120000);

    test('(e) a named non-shell gate binds every step under its own id', async () => {
      const { second, state } = await walkToReview('>>sv_chain :: gate78e:"NAMED-CRIT-78"');
      expect(state.steps).toEqual([
        'a:sv_a:["sv-block","gate78e"]',
        'b:sv_b:["sv-block","gate78e"]',
        'c:sv_a:["sv-block","gate78e"]',
      ]);
      expect(second).toContain('NAMED-CRIT-78');
      expect(state.reviews).toEqual({ b: ['sv-block', 'gate78e'] });
    }, 120000);
  });

  describe('P6.99: a named gate on an arrow-chain segment binds that segment', () => {
    test('(a) a named gate on segment 2 binds step 2 and its review; step 1 carries none', async () => {
      const run = await start({ command: `>>sv_a${ARROW}>>sv_b :: g99e:"NAMED-99"` });
      expect(runState(run.chainId).steps).toEqual(['n1:sv_a:[]', 'n2:sv_b:["g99e"]']);
      expect(run.text).not.toContain('NAMED-99');
      const second = await run.call({ user_response: 'A out', gate_verdict: PASS });
      expect(second).toContain('### g99e');
      expect(second).toContain('NAMED-99');
      const failed = await run.call({ user_response: 'B out', gate_verdict: FAIL });
      expect(failed).toContain('Gate Review Required');
      expect(runState(run.chainId).reviews).toEqual({ n2: ['g99e'] });
    }, 120000);

    test("(a') a named gate on a chain-prompt segment binds every expanded step", async () => {
      const run = await start({ command: `>>sv_a${ARROW}>>sv_chain :: g99g:"SEG-99"` });
      expect(runState(run.chainId).steps).toEqual([
        'n1:sv_a:[]',
        'n2-a:sv_a:["sv-block","g99g"]',
        'n2-b:sv_b:["sv-block","g99g"]',
        'n2-c:sv_a:["sv-block","g99g"]',
      ]);
    }, 120000);

    // Pinned on the steps' bound gates only: a review or render on n2-* still lists the first
    // segment's gate through the forward accumulation P6.98 leaves to the owner's ruling.
    test("(b) a named gate on the first segment does not bind the chain-prompt segment's steps", async () => {
      const run = await start({ command: `>>sv_a :: g99f:"LEAD-99"${ARROW}>>sv_chain` });
      expect(runState(run.chainId).steps).toEqual([
        'n1:sv_a:["g99f"]',
        'n2-a:sv_a:["sv-block"]',
        'n2-b:sv_b:["sv-block"]',
        'n2-c:sv_a:["sv-block"]',
      ]);
      expect(run.text).toContain('LEAD-99');
    }, 120000);

    test('(c) control: anonymous per-segment criteria stay on their own segment', async () => {
      const run = await start({ command: `>>sv_a :: "ANON-A-99"${ARROW}>>sv_b :: "ANON-B-99"` });
      const state = runState(run.chainId);
      expect(state.criteria).toEqual([['ANON-A-99'], ['ANON-B-99']]);
      expect(state.steps.map((step) => /^n\d:sv_[ab]:\["temp_[^",]+"\]$/.test(step))).toEqual([
        true,
        true,
      ]);
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `35959ffb`: arrow-chain `>>sv_a :: g110:"ONE-110"` then
   * `>>sv_b :: g110:"TWO-110"` registered both gates (`g110`, `g110-2`), but the per-call
   * declared-name map kept the last, so both segments bound `g110-2` and step 1 rendered TWO.
   */
  describe('P6.110: one name in two arrow-chain segments is two gates', () => {
    test('(a) each segment binds, renders and reviews its own criteria', async () => {
      const run = await start({
        command: `>>sv_a :: g110:"ONE-110"${ARROW}>>sv_b :: g110:"TWO-110"`,
      });
      expect(runState(run.chainId).steps).toEqual(['n1:sv_a:["g110"]', 'n2:sv_b:["g110-2"]']);
      expect(run.text).toContain('ONE-110');
      expect(run.text).not.toContain('TWO-110');
      const failedFirst = await run.call({ user_response: 'A out', gate_verdict: FAIL });
      expect(failedFirst).toContain('Gate Review Required');
      expect(failedFirst).toContain('ONE-110');
      expect(failedFirst).not.toContain('TWO-110');
      expect(runState(run.chainId).reviews).toEqual({ n1: ['g110'] });

      const second = await run.call({ user_response: 'A fixed', gate_verdict: PASS });
      expect(templates(second)).toEqual(['BODY-sv_b topic=']);
      expect(second).toContain('TWO-110');
      // Step 2's render and review also list step 1's `g110` through the forward accumulation
      // P6.98 leaves to the owner's ruling (as P6.99 (b) pins), so step 2 is pinned on its bound
      // gate and on its review carrying `g110-2`.
      const failedSecond = await run.call({ user_response: 'B out', gate_verdict: FAIL });
      expect(failedSecond).toContain('TWO-110');
      const reviews = runState(run.chainId).reviews;
      expect(Object.keys(reviews)).toEqual(['n2']);
      expect(reviews['n2']).toContain('g110-2');
    }, 120000);

    test('(b) control: one name in one segment binds that segment only', async () => {
      const run = await start({ command: `>>sv_a :: g110c:"ONLY-110"${ARROW}>>sv_b` });
      expect(runState(run.chainId).steps).toEqual(['n1:sv_a:["g110c"]', 'n2:sv_b:[]']);
      expect(run.text).toContain('ONLY-110');
      const failed = await run.call({ user_response: 'A out', gate_verdict: FAIL });
      expect(failed).toContain('ONLY-110');
      expect(runState(run.chainId).reviews).toEqual({ n1: ['g110c'] });
    }, 120000);
  });

  describe('P6.97: a named inline gate belongs to the run that declared it', () => {
    test('(a) a second run reusing the id grades its own criteria; (b) control: the first, still live, keeps its own', async () => {
      const first = await start({ command: '>>sv_chain :: g97e:"CRIT-ONE-97"' });
      const firstStep2 = await first.call({ user_response: 'A out', gate_verdict: PASS });
      expect(firstStep2).toContain('CRIT-ONE-97');

      const second = await start({ command: '>>sv_chain :: g97e:"CRIT-TWO-97"' });
      expect(second.text).toContain('CRIT-TWO-97');
      expect(second.text).not.toContain('CRIT-ONE-97');
      await second.call({ user_response: 'A out', gate_verdict: PASS });
      const failed = await second.call({ user_response: 'B out', gate_verdict: FAIL });
      expect(failed).toContain('Gate Review Required');
      expect(failed).toContain('CRIT-TWO-97');
      expect(failed).not.toContain('CRIT-ONE-97');
      expect(runState(second.chainId).reviews).toEqual({ b: ['sv-block', 'g97e-2'] });

      const firstStep3 = await first.call({ user_response: 'B out', gate_verdict: PASS });
      expect(firstStep3).toContain('CRIT-ONE-97');
      expect(firstStep3).not.toContain('CRIT-TWO-97');
      const firstFailed = await first.call({ user_response: 'C out', gate_verdict: FAIL });
      expect(firstFailed).toContain('CRIT-ONE-97');
      expect(runState(first.chainId).reviews).toEqual({ c: ['sv-block', 'g97e'] });
    }, 120000);

    test("(c) a single prompt's named gate is present and fresh on the second run", async () => {
      await start({ command: '>>sv_a :: g97s:"SINGLE-ONE-97"' });
      const again = await start({ command: '>>sv_a :: g97s:"SINGLE-TWO-97"' });
      expect(again.text).toContain('### g97s');
      expect(again.text).toContain('SINGLE-TWO-97');
      expect(again.text).not.toContain('SINGLE-ONE-97');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `9f833361` (0 `PostFormattingCleanup` stage starts in 12 formatted
   * replies): a completed run's named gate still held its id (the next run declaring it
   * registered `-2`), a completed run's `temp_…` step gate still rendered when a later command
   * named it, and nothing but a 1 h timer ever removed either.
   */
  describe('P6.108: a run owns its temporary gates until it ends', () => {
    /** Whether a new call naming `tempId` as its criterion still reaches that gate's body. */
    const resolves = async (tempId: string, marker: string): Promise<boolean> =>
      (await tool('prompt_engine', { command: `>>sv_b :: "${tempId}"` })).text.includes(marker);
    const stepGate = (chainId: string, index: number): string =>
      /temp_\d+_[a-z0-9]+/.exec(runState(chainId).steps[index] ?? '')?.[0] ?? '';

    test('(a) named and step gates resolve on every resume, then are gone once the run completes', async () => {
      const named = await start({ command: '>>sv_chain :: g108a:"CRIT-108A"' });
      expect(await named.call({ user_response: 'A out', gate_verdict: PASS })).toContain(
        'CRIT-108A'
      );
      expect(await named.call({ user_response: 'B out', gate_verdict: PASS })).toContain(
        'CRIT-108A'
      );
      await named.call({ user_response: 'C out', gate_verdict: PASS });
      const next = await start({ command: '>>sv_chain :: g108a:"CRIT-108A-NEXT"' });
      expect(runState(next.chainId).steps[0]).toBe('a:sv_a:["sv-block","g108a"]');

      const run = await start({ command: `>>sv_a :: "XA-108"${ARROW}>>sv_b :: "YB-108"` });
      const first = stepGate(run.chainId, 0);
      // Positive control: while the run is live, the probe reaches its step gate.
      expect(await resolves(first, 'XA-108')).toBe(true);
      expect(await run.call({ user_response: 'A out', gate_verdict: PASS })).toContain('YB-108');
      await run.call({ user_response: 'B out', gate_verdict: PASS });
      expect(await resolves(first, 'XA-108')).toBe(false);
    }, 120000);

    test('(b) a cancelled run releases its gates', async () => {
      const run = await start({ command: '>>sv_chain :: g108b:"CRIT-108B"' });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await run.call({ user_response: 'A out', gate_verdict: FAIL });
      }
      await run.call({ gate_action: 'abort' });
      const next = await start({ command: '>>sv_chain :: g108b:"CRIT-108B-NEXT"' });
      expect(runState(next.chainId).steps[0]).toBe('a:sv_a:["sv-block","g108b"]');
    }, 120000);

    test('(c) a call with no run releases its gates when its response is set', async () => {
      const first = await tool('prompt_engine', {
        command: '>>sv_a',
        gates: [{ id: 'sc108', name: 'sc108', criteria: ['SINGLE-108-ONE'] }],
      });
      expect(first.text).not.toMatch(/chain_id/);
      expect(first.text).toContain('SINGLE-108-ONE');
      const second = await tool('prompt_engine', {
        command: '>>sv_a',
        gates: [{ id: 'sc108', name: 'sc108', criteria: ['SINGLE-108-TWO'] }],
      });
      expect(second.text).toContain('SINGLE-108-TWO');
      expect(second.text).not.toContain('SINGLE-108-ONE');
    }, 120000);

    test('(d) control: a live run keeps its own gates while another run declaring the id completes', async () => {
      const first = await start({ command: '>>sv_chain :: g108d:"CRIT-108D-ONE"' });
      const second = await start({ command: '>>sv_chain :: g108d:"CRIT-108D-TWO"' });
      for (const answer of ['A out', 'B out', 'C out']) {
        await first.call({ user_response: answer, gate_verdict: PASS });
      }
      const step2 = await second.call({ user_response: 'A out', gate_verdict: PASS });
      expect(step2).toContain('CRIT-108D-TWO');
      expect(step2).not.toContain('CRIT-108D-ONE');
      await second.call({ user_response: 'B out', gate_verdict: FAIL });
      expect(runState(second.chainId).reviews).toEqual({ b: ['sv-block', 'g108d-2'] });
    }, 120000);

    // P6.98 twin, pinned as it holds: step 3 still renders and reviews the earlier segments'
    // step gates, which live as long as the run. The mechanism is the chain accumulator step N
    // inherits from steps 1..N-1 (P4.110), not the gate lifetime; that is P6.12, the owner's.
    test('(e) the forward accumulation is not the gate lifetime', async () => {
      const run = await start({
        command: `>>sv_a :: "XA-108E"${ARROW}>>sv_b :: "YB-108E"${ARROW}>>sv_a`,
      });
      await run.call({ user_response: 'A out', gate_verdict: PASS });
      const step3 = await run.call({ user_response: 'B out', gate_verdict: PASS });
      expect(step3).toContain('XA-108E');
      expect(step3).toContain('YB-108E');
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `9f833361`: on a four-node workflow of single prompts, a request gate
   * targeting p2 rendered there but its FAIL was refused "Step 2 carries no gates"; one
   * targeting p3 or p4 never rendered. A resume carries no `gates`, and nothing restored the
   * start call's (`requestedOverrides` is written only from the current request, stage 01).
   */
  describe("P6.104: a run's request gates reach every node they target", () => {
    const fourNodes = (target: string, marker: string) => ({
      workflow: {
        version: 1,
        nodes: ['p1', 'p2', 'p3', 'p4'].map((id, index) => ({
          id,
          promptId: index % 2 === 0 ? 'sv_a' : 'sv_b',
        })),
        edges: [
          { from: 'p1', to: 'p2' },
          { from: 'p2', to: 'p3' },
          { from: 'p3', to: 'p4' },
        ],
        gates: [{ name: 'tgt104', criteria: [marker], target_step_id: target }],
      },
    });

    test.each([
      ['p2', 2],
      ['p3', 3],
      ['p4', 4],
    ])(
      '(a) a gate on %s renders on its node and a FAIL there opens its review',
      async (target, ordinal) => {
        const marker = `TGT-104-${target.toUpperCase()}`;
        const run = await start(fourNodes(target, marker));
        let reply = run.text;
        for (let step = 1; step < ordinal; step += 1) {
          expect(reply).not.toContain(marker);
          reply = await run.call({ user_response: `out ${step}`, gate_verdict: PASS });
        }
        expect(reply).toContain(marker);
        const failed = await run.call({ user_response: `out ${ordinal}`, gate_verdict: FAIL });
        expect(failed).toContain('Gate Review Required');
        expect(failed).toContain(marker);
        const reviews = runState(run.chainId).reviews;
        expect(Object.keys(reviews)).toEqual([target]);
        expect(reviews[target]).toHaveLength(1);
      },
      120000
    );

    test('(b) control: a gate on the first node renders and grades there', async () => {
      const run = await start(fourNodes('p1', 'TGT-104-P1'));
      expect(run.text).toContain('TGT-104-P1');
      const failed = await run.call({ user_response: 'out 1', gate_verdict: FAIL });
      expect(failed).toContain('Gate Review Required');
      expect(Object.keys(runState(run.chainId).reviews)).toEqual(['p1']);
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `9f833361`: a second live run sending `gates: [{ id: "rg107" }]` with
   * its own criteria rendered and reviewed the first run's (`reviews {p1: ["rg107"]}` on both), the
   * id having been skipped as "already registered".
   */
  describe('P6.107: a request gate id belongs to the run that holds it', () => {
    const threeNodes = (gates: unknown[]) => ({
      workflow: {
        version: 1,
        nodes: [
          { id: 'p1', promptId: 'sv_a' },
          { id: 'p2', promptId: 'sv_b' },
          { id: 'p3', promptId: 'sv_a' },
        ],
        edges: [
          { from: 'p1', to: 'p2' },
          { from: 'p2', to: 'p3' },
        ],
        gates,
      },
    });

    test("(a) a resume re-sending the run's gate is the same gate, and it still grades", async () => {
      const gates = [{ id: 'rq107e', name: 'rq107e', criteria: ['RQ-107'], target_step_id: 'p3' }];
      const run = await start(threeNodes(gates));
      await run.call({ user_response: 'out 1', gate_verdict: PASS, gates });
      const step3 = await run.call({ user_response: 'out 2', gate_verdict: PASS, gates });
      expect(step3).toContain('RQ-107');
      const failed = await run.call({ user_response: 'out 3', gate_verdict: FAIL, gates });
      expect(failed).toContain('Gate Review Required');
      expect(runState(run.chainId).reviews).toEqual({ p3: ['rq107e'] });
    }, 120000);

    test('(b) two live runs declaring one id each grade their own criteria', async () => {
      const first = await start(
        threeNodes([{ id: 'rg107e', name: 'rg107e', criteria: ['RG-ONE'] }])
      );
      const second = await start(
        threeNodes([{ id: 'rg107e', name: 'rg107e', criteria: ['RG-TWO'] }])
      );
      expect(second.text).toContain('RG-TWO');
      expect(second.text).not.toContain('RG-ONE');
      const secondFailed = await second.call({ user_response: 'out 1', gate_verdict: FAIL });
      expect(secondFailed).toContain('RG-TWO');
      expect(runState(second.chainId).reviews).toEqual({ p1: ['rg107e-2'] });
      const firstFailed = await first.call({ user_response: 'out 1', gate_verdict: FAIL });
      expect(firstFailed).toContain('RG-ONE');
      expect(firstFailed).not.toContain('RG-TWO');
      expect(runState(first.chainId).reviews).toEqual({ p1: ['rg107e'] });
    }, 120000);

    test('(c) control: a fresh id registers under itself', async () => {
      const run = await start(
        threeNodes([{ id: 'fresh107e', name: 'fresh107e', criteria: ['FRESH-107'] }])
      );
      expect(run.text).toContain('FRESH-107');
      await run.call({ user_response: 'out 1', gate_verdict: FAIL });
      expect(runState(run.chainId).reviews).toEqual({ p1: ['fresh107e'] });
    }, 120000);
  });

  /**
   * MEASURED 2026-09-26 on `936611fd` (driven): run 1 held `rg`, run 2 got `rg-2`, and each resume
   * of run 2 re-sending `gates: [{ id: "rg" }]` registered `rg-3`, then `rg-4` — the held `rg` was
   * run 1's, and no map sent run 2's declared `rg` back to its `rg-2`.
   */
  describe('P6.113: a run holding a fresh id re-sends the declared one', () => {
    const threeNodes = (criterion: string) => ({
      workflow: {
        version: 1,
        nodes: [
          { id: 'p1', promptId: 'sv_a' },
          { id: 'p2', promptId: 'sv_b' },
          { id: 'p3', promptId: 'sv_a' },
        ],
        edges: [
          { from: 'p1', to: 'p2' },
          { from: 'p2', to: 'p3' },
        ],
        gates: [{ id: 'rg113e', name: 'rg113e', criteria: [criterion], target_step_id: 'p3' }],
      },
    });

    test("(a) the re-sent gate stays the run's own id, and grades its own criteria", async () => {
      const first = await start(threeNodes('RG113-ONE'));
      const second = await start(threeNodes('RG113-TWO'));
      const gates = threeNodes('RG113-TWO').workflow.gates;
      await second.call({ user_response: 'out 1', gate_verdict: PASS, gates });
      const step3 = await second.call({ user_response: 'out 2', gate_verdict: PASS, gates });
      expect(step3).toContain('RG113-TWO');
      expect(step3).not.toContain('RG113-ONE');
      const failed = await second.call({ user_response: 'out 3', gate_verdict: FAIL, gates });
      expect(failed).toContain('Gate Review Required');
      expect(runState(second.chainId).reviews).toEqual({ p3: ['rg113e-2'] });

      // Control: run 1, still live, keeps its own id and criteria.
      await first.call({ user_response: 'out 1', gate_verdict: PASS });
      await first.call({ user_response: 'out 2', gate_verdict: PASS });
      const firstFailed = await first.call({ user_response: 'out 3', gate_verdict: FAIL });
      expect(firstFailed).toContain('RG113-ONE');
      expect(firstFailed).not.toContain('RG113-TWO');
      expect(runState(first.chainId).reviews).toEqual({ p3: ['rg113e'] });
    }, 120000);
  });
});
