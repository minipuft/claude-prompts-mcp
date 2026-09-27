// @lifecycle test - P6.79 / P6.80 / R40: an arrow-chain segment or a workflow node naming a chain prompt runs that prompt's steps; P6.78 / R37: a command-level gate on a chain prompt binds each step; P6.97 / R43: a named inline gate belongs to the run that declared it; P6.99 / R44: a named gate on an arrow-chain segment binds that segment; P6.108 / R47: a run's temporary gates live exactly as long as the run, over Streamable HTTP.
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
      const third = await run.call({ user_response: 'B out' });
      expect(templates(third)).toEqual(['BODY-sv_b topic=']);
      expect(third).toContain('Progress 3/3');
      expect(third).not.toContain('TGT-NODE-X');
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

    test("(a') a chain prompt whose steps declare gates is refused by name, writing nothing", async () => {
      const { run, reply } = await appendTo(remainder({ promptId: 'sv_chain' }));
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(
        'remainder refused: a node names a chain prompt whose steps declare fields a contributed node cannot carry'
      );
      expect(reply.text).toContain('- step "r1-b": inlineGateIds');
      expect(runNodes(run.chainId)).toEqual(PLANNED);
    }, 120000);

    test('(b) control: a remainder of single prompts is unchanged', async () => {
      const { run, reply } = await appendTo(remainder({ promptId: 'sv_b' }));
      expect(reply.isError).toBe(false);
      expect(runNodes(run.chainId)).toEqual([...PLANNED, 'r1:sv_b:remainder']);
    }, 120000);

    test('(c) the arrow-append spelling reaches the same expansion and the same refusal', async () => {
      const plain = await appendTo(arrowAppend('sv_pair'));
      expect(plain.reply.isError).toBe(false);
      expect(runNodes(plain.run.chainId)).toEqual([
        ...PLANNED,
        'sv-pair-a:sv_a:remainder',
        'sv-pair-b:sv_b:remainder',
      ]);
      const fourth = await plain.run.call({ user_response: 'B out' });
      expect(templates(fourth)).toEqual(['BODY-sv_a topic=']);

      const gated = await appendTo(arrowAppend('sv_chain'));
      expect(gated.reply.isError).toBe(true);
      expect(gated.reply.text).toContain('- step "sv-chain-b": inlineGateIds');
      expect(runNodes(gated.run.chainId)).toEqual(PLANNED);
    }, 120000);

    test("(d) the node cap counts the run's nodes after the write, expanded", async () => {
      const { run, reply } = await appendTo(remainder({ promptId: 'sv_big' }));
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(
        '- cap-exceeded: Expanding chain prompt "sv_big" yields 32 nodes; the expanded workflow has 32 nodes, exceeding the effective maxNodes cap of 29'
      );
      expect(runNodes(run.chainId)).toEqual(PLANNED);
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
});
