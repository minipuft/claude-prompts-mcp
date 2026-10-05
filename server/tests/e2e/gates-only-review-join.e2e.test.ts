// @lifecycle test - P6.279 / R173: a call carrying `gates` and no verdict, sent while its step's review is open, joins that review without counting an attempt; P6.12 / R194: a gate written on a step stays on that step; P6.310 / R204: so does a gate the step's own prompt supplies; all over Streamable HTTP and STDIO.
/**
 * MEASURED 2026-10-04 on `c97d80159` (this harness, both transports): a `>>gj_chain` run standing
 * at `b` with `b`'s review open (answered with `user_response` alone, attempt 0) and resumed with
 * `gates` targeting `b` and NO verdict was refused "names the step this call answers; target "c"
 * or later"; the review stayed `['gj-block']`. A gate sent WITH a FAIL already joined that review
 * (R154, P6.268 in `chain-prompt-sources.e2e.test.ts`).
 *
 * Now (R173) the verdict-less call joins the open review exactly as the FAIL-carried gate does:
 * the review re-renders listing the gate, the next verdict grades it, and no attempt is counted,
 * since no verdict was given. An id the review already holds is a no-op; a gate on another node
 * keeps its refusal. Every leg reads the reply, then the run's own row.
 *
 * P6.12 / P6.98 / P6.281, owner ruling R194. MEASURED 2026-10-05 on `4311d6841` (this harness's
 * fixtures, Streamable HTTP): in `>>gr_a :: "CRIT-XA-12"` then `>>gr_b` then `>>gr_c`, step A's
 * inline gate rendered in B's and C's Inline Gates and opened B's and C's reviews ("These inline
 * gates triggered the review"); with `>>gr_b :: "CRIT-YB-12"` and `>>gr_a` as steps 2 and 3, step
 * 3 rendered both criteria and B's review held both gates. The chain walk's accumulator carried
 * every earlier step's gates forward. Now a gate written on a step renders and is reviewed on that
 * step only, while a request gate with no target still reaches every step.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

const PASS = 'GATE_REVIEW: PASS - ok';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gate';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
const CRITERION = 'TGT-279-J';

type Tool = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ isError: boolean; text: string }>;

interface ReviewRow {
  gateIds: string[];
  attemptCount: number;
}

interface RunRow {
  current: string | null;
  reviews: Record<string, ReviewRow>;
}

const withStateDb = <T>(runtimeRoot: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
  try {
    return read(db);
  } finally {
    db.close();
  }
};

/** The run's stored state, byte for byte: a refusal must leave it untouched. */
const rawRun = (runtimeRoot: string, chainId: string): string | undefined =>
  withStateDb(
    runtimeRoot,
    (db) =>
      (
        db.prepare('SELECT state FROM chain_runs WHERE chain_id = ?').get(chainId) as
          { state: string } | undefined
      )?.state
  );

/** The run's current node and its open reviews (gate ids and attempt count), from its own row. */
const readRun = (runtimeRoot: string, chainId: string): RunRow =>
  withStateDb(runtimeRoot, (db) => {
    const row = db
      .prepare('SELECT state, current_node_id FROM chain_runs WHERE chain_id = ?')
      .get(chainId) as { state: string; current_node_id: string | null } | undefined;
    if (row === undefined) throw new Error(`no run for ${chainId}`);
    const state = JSON.parse(row.state) as {
      reviews?: Record<string, { gateIds: string[]; attemptCount: number }>;
    };
    return {
      current: row.current_node_id,
      reviews: Object.fromEntries(
        Object.entries(state.reviews ?? {}).map(([nodeId, review]) => [
          nodeId,
          { gateIds: review.gateIds, attemptCount: review.attemptCount },
        ])
      ),
    };
  });

/** A blocking gate and a three-step chain carrying it on every step: `a`, `b`, `c`. */
const authorFixtures = async (tool: Tool): Promise<void> => {
  const author = async (args: Record<string, unknown>): Promise<void> => {
    const result = await tool('resource_manager', args);
    if (result.isError) throw new Error(result.text);
  };
  await author({
    resource_type: 'gate',
    action: 'create',
    id: 'gj-block',
    name: 'gj-block',
    description: 'blocking e2e gate',
    guidance: 'GUIDANCE-gj-block',
    enforcement_mode: 'blocking',
  });
  for (const id of ['gj_a', 'gj_b']) {
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
  // P6.12: three gateless steps, so every gate a run shows is one its call named, and a
  // registered gate for the request-gate control.
  await author({
    resource_type: 'gate',
    action: 'create',
    id: 'gr-req',
    name: 'gr-req',
    description: 'blocking e2e gate a request names',
    guidance: 'GUIDANCE-gr-req',
    enforcement_mode: 'blocking',
  });
  for (const id of ['gr_a', 'gr_b', 'gr_c']) {
    await author({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: id,
      description: `e2e gate-reach step ${id}`,
      user_message_template: `BODY-${id}`,
      gate_configuration: OPT_OUT,
    });
  }
  // P6.310: a step prompt's own gate (`gp-x`, from `gp_b`'s include list, and `gp-cat`, from
  // `gp_k`'s category), and a chain prompt's own gate (`gp-y`, from `gp_chain`'s include list).
  for (const id of ['gp-x', 'gp-y']) {
    await author({
      resource_type: 'gate',
      action: 'create',
      id,
      name: id,
      description: `blocking e2e gate ${id}`,
      guidance: `GUIDANCE-${id}`,
      enforcement_mode: 'blocking',
    });
  }
  await author({
    resource_type: 'gate',
    action: 'create',
    id: 'gp-cat',
    name: 'gp-cat',
    description: 'blocking e2e gate a category supplies',
    guidance: 'GUIDANCE-gp-cat',
    enforcement_mode: 'blocking',
    activation: { prompt_categories: ['gpcat'] },
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'gp_b',
    category: 'general',
    name: 'gp_b',
    description: 'e2e step whose prompt includes gp-x',
    user_message_template: 'BODY-gp_b',
    gate_configuration: { ...OPT_OUT, include: ['gp-x'] },
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'gp_k',
    category: 'gpcat',
    name: 'gp_k',
    description: 'e2e step whose category supplies gp-cat',
    user_message_template: 'BODY-gp_k',
    gate_configuration: OPT_OUT,
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'gp_chain',
    category: 'general',
    name: 'gp_chain',
    description: 'e2e chain whose own prompt includes gp-y',
    user_message_template: 'CHAIN-GP-TEMPLATE',
    gate_configuration: { ...OPT_OUT, include: ['gp-y'] },
    chain_steps: [
      { promptId: 'gr_a', stepName: 'A' },
      { promptId: 'gp_b', stepName: 'B' },
      { promptId: 'gr_c', stepName: 'C' },
    ],
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: 'gj_chain',
    category: 'general',
    name: 'gj_chain',
    description: 'e2e chain with a blocking gate on every step',
    user_message_template: 'CHAIN-OWN-TEMPLATE',
    gate_configuration: OPT_OUT,
    chain_steps: [
      { promptId: 'gj_a', stepName: 'A', inlineGateIds: ['gj-block'] },
      { promptId: 'gj_b', stepName: 'B', inlineGateIds: ['gj-block'] },
      { promptId: 'gj_a', stepName: 'C', inlineGateIds: ['gj-block'] },
    ],
  });
};

/** A request gate on `target`; each test names its own id, since a registered id is one run's. */
const gateOn = (id: string, target = 'b') => ({
  id,
  name: id,
  criteria: [CRITERION],
  target_step_id: target,
});

/** The twins every transport runs, over that transport's `tool` and state root. */
const harness = (tool: Tool, runtimeRoot: () => string) => {
  const run = (chainId: string): RunRow => readRun(runtimeRoot(), chainId);

  /** A `>>gj_chain` run standing at `b` with `b`'s review open, ungraded, at attempt 0. */
  const openReviewOnB = async (): Promise<string> => {
    const opened = await tool('prompt_engine', { command: '>>gj_chain' });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(opened.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${opened.text.slice(0, 400)}`);
    await tool('prompt_engine', { chain_id: chainId, user_response: 'A out', gate_verdict: PASS });
    await tool('prompt_engine', { chain_id: chainId, user_response: 'B out' });
    expect(run(chainId)).toEqual({
      current: 'b',
      reviews: { b: { gateIds: ['gj-block'], attemptCount: 0 } },
    });
    return chainId;
  };

  const gatesOnly = (chainId: string, gates: Array<Record<string, unknown>>) =>
    tool('prompt_engine', { chain_id: chainId, gates });

  /** Twin (a): the gates-only call joins; the review re-renders it; no attempt is counted. */
  const joins = async (id: string): Promise<string> => {
    const chainId = await openReviewOnB();
    const before = run(chainId).reviews['b']?.attemptCount;

    const joined = await gatesOnly(chainId, [gateOn(id)]);

    expect(joined.text).not.toContain('gate-target-passed');
    expect(joined.isError).toBe(false);
    expect(joined.text).toContain('Gate Review Required');
    expect(joined.text).toContain(`### ${id}\n1. ${CRITERION}`);
    expect(joined.text).toContain('### gj-block');
    const after = run(chainId);
    expect(after).toEqual({
      current: 'b',
      reviews: { b: { gateIds: ['gj-block', id], attemptCount: 0 } },
    });
    expect(after.reviews['b']?.attemptCount).toBe(before);
    return chainId;
  };

  /** Twin (c): a gate on a node other than the reviewed one keeps its refusal; nothing moves. */
  const otherNodeRefused = async (id: string): Promise<void> => {
    const chainId = await openReviewOnB();
    const before = rawRun(runtimeRoot(), chainId);

    const refused = await gatesOnly(chainId, [gateOn(id, 'a')]);

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(
      '[gate-target-passed] node "a": target_step_id "a" names a step the run has already passed'
    );
    expect(rawRun(runtimeRoot(), chainId)).toBe(before);
  };

  return { run, openReviewOnB, gatesOnly, joins, otherNodeRefused };
};

/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
const XA = 'CRIT-XA-12';
const YB = 'CRIT-YB-12';
/** The guidance of `gr-req`, a registered gate a request names by id. */
const RQ = 'GUIDANCE-gr-req';
/** The guidance of the gates a prompt supplies (P6.310). */
const GPX = 'GUIDANCE-gp-x';
const GPY = 'GUIDANCE-gp-y';
const GPCAT = 'GUIDANCE-gp-cat';
/** Shape (a): a gate written on step A of three. */
const SHAPE_A = [`>>gr_a :: "${XA}"`, '>>gr_b', '>>gr_c'].join(ARROW);
/** Shape (b): a gate on each of the first two steps, the third step A's prompt again. */
const SHAPE_B = [`>>gr_a :: "${XA}"`, `>>gr_b :: "${YB}"`, '>>gr_a'].join(ARROW);

/** One call of a run: where it stands, the criteria the reply shows, and its open reviews. */
interface ReachStep {
  current: string | null;
  rendered: string[];
  reviews: Record<string, string[]>;
}

/**
 * P6.12 (R194): drive a run to its end and record every call as ONE value. Each step is answered
 * with no verdict first, so an open review shows itself, and then PASSed while one is open. A
 * review's gate ids are named by the criterion that registered them (`gateNames`, in the order the
 * run first shows them), since an anonymous inline gate's id is minted per run.
 */
const gateReach = (tool: Tool, runtimeRoot: () => string) => {
  // A gate's criterion renders as a numbered line; the command echo (`Re-run:`) is not one.
  const criteriaIn = (text: string): string[] =>
    [XA, YB, RQ, GPX, GPY, GPCAT].filter((marker) =>
      new RegExp(`^(\\d+\\. )?${marker}$`, 'm').test(text)
    );

  return async (
    args: Record<string, unknown>,
    gateNames: readonly string[],
    /** Sent with the first answer only: an observation that changes the run. */
    firstAnswer: Record<string, unknown> = {}
  ): Promise<ReachStep[]> => {
    const names = new Map<string, string>();
    const name = (gateId: string): string => {
      if (!gateId.startsWith('temp_')) return gateId;
      if (!names.has(gateId)) names.set(gateId, gateNames[names.size] ?? gateId);
      return names.get(gateId) ?? gateId;
    };
    const observe = (chainId: string, text: string): ReachStep => {
      const row = readRun(runtimeRoot(), chainId);
      return {
        current: row.current,
        rendered: criteriaIn(text),
        reviews: Object.fromEntries(
          Object.entries(row.reviews).map(([node, review]) => [node, review.gateIds.map(name)])
        ),
      };
    };

    const started = await tool('prompt_engine', args);
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(started.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${started.text.slice(0, 400)}`);
    const steps = [observe(chainId, started.text)];
    for (let calls = 0; steps[steps.length - 1]?.current !== null && calls < 12; calls++) {
      const node = steps[steps.length - 1]?.current ?? '';
      const held = await tool('prompt_engine', {
        chain_id: chainId,
        user_response: `${node} out`,
        ...(calls === 0 ? firstAnswer : {}),
      });
      steps.push(observe(chainId, held.text));
      if (readRun(runtimeRoot(), chainId).reviews[node] !== undefined) {
        const passed = await tool('prompt_engine', {
          chain_id: chainId,
          user_response: `${node} out`,
          gate_verdict: PASS,
        });
        steps.push(observe(chainId, passed.text));
      }
    }
    return steps;
  };
};

/** Shape (a) as R194 rules it: A renders and reviews its gate; B and C carry none. */
const REACH_A: ReachStep[] = [
  { current: 'n1', rendered: [XA], reviews: { n1: ['XA'] } },
  { current: 'n1', rendered: [XA], reviews: { n1: ['XA'] } },
  { current: 'n2', rendered: [], reviews: {} },
  { current: 'n3', rendered: [], reviews: {} },
  { current: null, rendered: [], reviews: {} },
];

/** Shape (b): each gated step renders and reviews its own gate; step 3 carries none. */
const REACH_B: ReachStep[] = [
  { current: 'n1', rendered: [XA], reviews: { n1: ['XA'] } },
  { current: 'n1', rendered: [XA], reviews: { n1: ['XA'] } },
  { current: 'n2', rendered: [YB], reviews: {} },
  { current: 'n2', rendered: [YB], reviews: { n2: ['YB'] } },
  { current: 'n3', rendered: [], reviews: {} },
  { current: null, rendered: [], reviews: {} },
];

/**
 * Control: a gate the request names by id, with no step target, reaches every step beside step
 * A's own gate: each step's review holds it and shows its guidance. A later step's first render
 * shows no guidance for it, measured the same before R194: gate guidance is shown on the first
 * gated render only (the shipped gate-guidance frequency), while a step's own criteria always
 * render. (A request gate given as criteria with no target binds the step the call stands on,
 * `TemporaryGateRegistrar.normalizeGateInput`, so it is not this control.)
 */
const reachRequest = (id: string): ReachStep[] => [
  { current: 'n1', rendered: [XA, RQ], reviews: { n1: [id, 'XA'] } },
  { current: 'n1', rendered: [XA, RQ], reviews: { n1: [id, 'XA'] } },
  { current: 'n2', rendered: [], reviews: {} },
  { current: 'n2', rendered: [RQ], reviews: { n2: [id] } },
  { current: 'n3', rendered: [], reviews: {} },
  { current: 'n3', rendered: [RQ], reviews: { n3: [id] } },
  { current: null, rendered: [], reviews: {} },
];

/**
 * Shape (c): step 2 writes its own gate, and step 1's answer raises a blocking unknown naming no
 * step, so the mutation policy inserts a node BEFORE it: step 2 moves to the third position.
 * A request gate targeting `n2` makes the advance onto it open its review on the post-advance
 * path, which addresses the step by the node the run stands on and by its NEW position (3), not
 * the parse ordinal (2) the gate was written at. Step 2's gate renders and is reviewed on `n2`
 * alone, never on the inserted node now standing at ordinal 2 (`validate:step-lookup-by-node`).
 */
const SHAPE_C = ['>>gr_a', `>>gr_b :: "${YB}"`, '>>gr_c'].join(ARROW);
const insertedRun = (gateId: string) => ({
  command: SHAPE_C,
  gates: [{ id: gateId, name: gateId, criteria: ['CRIT-TG-12'], target_step_id: 'n2' }],
});
const insertBefore2 = (id: string) => ({
  observations: [{ type: 'unknown_discovered', id, statement: `STATEMENT-${id}`, blocking: true }],
});
const reachInserted = (unknownId: string, gateId: string): ReachStep[] => [
  { current: 'n1', rendered: [], reviews: {} },
  { current: `inv-${unknownId}`, rendered: [], reviews: {} },
  { current: 'n2', rendered: [YB], reviews: { n2: [gateId, 'YB'] } },
  { current: 'n2', rendered: [YB], reviews: { n2: [gateId, 'YB'] } },
  { current: 'n3', rendered: [], reviews: {} },
  { current: null, rendered: [], reviews: {} },
];

/**
 * P6.310 (R204): a gate a step's own prompt supplies stays on that step. MEASURED 2026-10-05 on
 * `f1f74afdb` (this harness, both transports, identical): in `>>gr_a` then `>>gp_b` then `>>gr_c`,
 * `gp_b`'s include list put `gp-x` on step 2 and, through the walk's accumulator, on step 3 too:
 * step 3's answer opened `{n3: ['gp-x']}` and rendered its guidance. A category's gate did the
 * same (`gp-cat`, `>>gp_k` as step 2), and in `>>gp_b` then `>>gr_a` then `>>gp_b` the middle step
 * reviewed `gp-x` although its prompt supplies nothing.
 */
const PROMPT_OWN = ['>>gr_a', '>>gp_b', '>>gr_c'].join(ARROW);
const PROMPT_CATEGORY = ['>>gr_a', '>>gp_k', '>>gr_c'].join(ARROW);
const PROMPT_TWICE = ['>>gp_b', '>>gr_a', '>>gp_b'].join(ARROW);

/** Step 2's prompt supplies `gate` (rendered as `guidance`); steps 1 and 3 carry none. */
const reachOwnPrompt = (
  gate: string,
  guidance: string,
  nodes: readonly [string, string, string] = ['n1', 'n2', 'n3'],
  firstRender: string[] = []
): ReachStep[] => [
  { current: nodes[0], rendered: [], reviews: {} },
  { current: nodes[1], rendered: firstRender, reviews: {} },
  { current: nodes[1], rendered: [guidance], reviews: { [nodes[1]]: [gate] } },
  { current: nodes[2], rendered: [], reviews: {} },
  { current: null, rendered: [], reviews: {} },
];

/** Two steps' prompts both include `gp-x`: each holds it on its own step; the middle step none. */
const REACH_TWICE: ReachStep[] = [
  { current: 'n1', rendered: [GPX], reviews: { n1: ['gp-x'] } },
  { current: 'n1', rendered: [GPX], reviews: { n1: ['gp-x'] } },
  { current: 'n2', rendered: [], reviews: {} },
  { current: 'n3', rendered: [], reviews: {} },
  { current: 'n3', rendered: [GPX], reviews: { n3: ['gp-x'] } },
  { current: null, rendered: [], reviews: {} },
];

/**
 * Control: `>>gp_chain`, whose own prompt includes `gp-y` and whose step `b` is `gp_b`. Step `b`'s
 * prompt gate stays on `b`. The chain prompt's own include list is not a step's, so this row binds
 * nothing of it; MEASURED before and after this row, it reaches no step at all (no render, no
 * review), because the chain walk never resolves the chain prompt's `gateConfiguration`. Pinned as
 * measured: wiring it to every step is a separate change, and this value moves when it lands.
 */
const REACH_CHAIN_PROMPT = reachOwnPrompt('gp-x', GPX, ['a', 'b', 'c']);

describe('Streamable HTTP: a gates-only call joins its step open review (P6.279, R173)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let client: ModernMcpClient;
  let runtimeRoot = '';
  let nextId = 1;

  const tool: Tool = async (name, args) => {
    const outcome = await client.callToolWithNotifications(name, args, nextId++);
    const result = outcome.result as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };
  const twins = harness(tool, () => runtimeRoot);
  const reach = gateReach(tool, () => runtimeRoot);

  beforeAll(async () => {
    const roots = createHermeticRoots('gates-only-review-join-e2e');
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
    client = new ModernMcpClient(baseUrl, 'gates-only-review-join-e2e');
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('(a) a gates-only call with a gate on b joins its open review and counts no attempt', async () => {
    await twins.joins('j279a');
  }, 120000);

  test('(a) the next verdicts grade the joined gate; the join spent none of the two attempts', async () => {
    const chainId = await twins.joins('j279g');
    const fail = (answer: string) =>
      tool('prompt_engine', { chain_id: chainId, user_response: answer, gate_verdict: FAIL });

    const first = await fail('B again');
    expect(first.text).toContain('"satisfied": ["gj-block", "j279g"]');
    expect(first.text).toContain('(attempt 2/2)');
    expect(twins.run(chainId).reviews['b']).toEqual({
      gateIds: ['gj-block', 'j279g'],
      attemptCount: 1,
    });

    // Exhausted on the second FAIL after the join, not the first: the join counted no attempt.
    const second = await fail('B once more');
    expect(second.text).toContain(
      'The following gates failed after 2 attempts: **gj-block, j279g**'
    );
  }, 120000);

  test('(a) a PASS after the join closes the review and advances', async () => {
    const chainId = await twins.joins('j279p');

    const passed = await tool('prompt_engine', {
      chain_id: chainId,
      user_response: 'B fixed',
      gate_verdict: PASS,
    });
    expect(passed.text).toContain('BODY-gj_a');
    expect(passed.text).toContain('Progress 3/3');
    expect(twins.run(chainId)).toEqual({ current: 'c', reviews: {} });
  }, 120000);

  test('(b) a gate id the review already holds is a no-op, not a refusal', async () => {
    const chainId = await twins.joins('j279b');

    const again = await twins.gatesOnly(chainId, [gateOn('j279b')]);

    expect(again.isError).toBe(false);
    expect(again.text).not.toContain('gate-target-passed');
    expect(again.text).toContain('### j279b');
    expect(twins.run(chainId)).toEqual({
      current: 'b',
      reviews: { b: { gateIds: ['gj-block', 'j279b'], attemptCount: 0 } },
    });
  }, 120000);

  test('(c) control: a gate on a node other than the reviewed one keeps its refusal', async () => {
    await twins.otherNodeRefused('o279');
  }, 120000);

  test('P6.12 (a) a gate written on step A renders and is reviewed on A only', async () => {
    expect(await reach({ command: SHAPE_A }, ['XA'])).toEqual(REACH_A);
  }, 120000);

  test("P6.98 (b) each step's own gate stays on that step", async () => {
    expect(await reach({ command: SHAPE_B }, ['XA', 'YB'])).toEqual(REACH_B);
  }, 120000);

  test('P6.12 (c) a step gate moved by an inserted node stays on the step that wrote it', async () => {
    const steps = await reach(insertedRun('t12h'), ['YB'], insertBefore2('u12h'));
    expect(steps).toEqual(reachInserted('u12h', 't12h'));
  }, 120000);

  test('P6.12 control: a request gate with no target still reaches every step', async () => {
    const steps = await reach({ command: SHAPE_A, gates: ['gr-req'] }, ['XA']);
    expect(steps).toEqual(reachRequest('gr-req'));
  }, 120000);

  test("P6.310 (a) a gate a step's prompt includes renders and is reviewed on that step only", async () => {
    expect(await reach({ command: PROMPT_OWN }, [])).toEqual(reachOwnPrompt('gp-x', GPX));
  }, 120000);

  test("P6.310 (a) a gate a step's category supplies stays on that step", async () => {
    const steps = await reach({ command: PROMPT_CATEGORY }, []);
    expect(steps).toEqual(reachOwnPrompt('gp-cat', GPCAT, ['n1', 'n2', 'n3'], [GPCAT]));
  }, 120000);

  test('P6.310 (b) two steps whose prompts include one gate each hold it on their own step', async () => {
    expect(await reach({ command: PROMPT_TWICE }, [])).toEqual(REACH_TWICE);
  }, 120000);

  test("P6.310 control: a chain prompt's step keeps its prompt gate; the chain's own include reaches no step", async () => {
    expect(await reach({ command: '>>gp_chain' }, [])).toEqual(REACH_CHAIN_PROMPT);
  }, 120000);
});

describe('STDIO: a gates-only call joins its step open review (P6.279, R173 transport parity)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let runtimeRoot = '';
  let proc: ChildProcess;
  let nextId = 1;
  let stderr = '';
  const pending = new Map<number, (message: Record<string, unknown>) => void>();

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`STDIO ${method} (id ${id}) got no answer in 45s\n${stderr}`));
      }, 45000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message['error'] != null) reject(new Error(JSON.stringify(message['error'])));
        else resolve(message['result']);
      });
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  const tool: Tool = async (name, args) => {
    const result = (await request('tools/call', { name, arguments: args })) as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };
  const twins = harness(tool, () => runtimeRoot);
  const reach = gateReach(tool, () => runtimeRoot);

  beforeAll(async () => {
    const roots = createHermeticRoots('gates-only-review-join-stdio-e2e');
    cleanup.push(roots.cleanup);
    runtimeRoot = roots.runtimeRoot;
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    proc = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
      cwd: SERVER_ROOT,
      env: buildServerEnv({
        HOME: roots.home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: runtimeRoot,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cleanup.push(() => killServer(proc));
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('{')) continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        if (typeof message['id'] === 'number') pending.get(message['id'])?.(message);
      }
    });
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gates-only-review-join-stdio-e2e', version: '1.0.0' },
    });
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('(a) over STDIO a gates-only call with a gate on b joins its open review and counts no attempt', async () => {
    await twins.joins('s279a');
  }, 120000);

  test('(c) control over STDIO: a gate on a node other than the reviewed one keeps its refusal', async () => {
    await twins.otherNodeRefused('s279o');
  }, 120000);

  test('P6.12 (a) over STDIO a gate written on step A renders and is reviewed on A only', async () => {
    expect(await reach({ command: SHAPE_A }, ['XA'])).toEqual(REACH_A);
  }, 120000);

  test("P6.98 (b) over STDIO each step's own gate stays on that step", async () => {
    expect(await reach({ command: SHAPE_B }, ['XA', 'YB'])).toEqual(REACH_B);
  }, 120000);

  test('P6.12 (c) over STDIO a step gate moved by an inserted node stays on the step that wrote it', async () => {
    const steps = await reach(insertedRun('t12s'), ['YB'], insertBefore2('u12s'));
    expect(steps).toEqual(reachInserted('u12s', 't12s'));
  }, 120000);

  test('P6.12 control over STDIO: a request gate with no target still reaches every step', async () => {
    const steps = await reach({ command: SHAPE_A, gates: ['gr-req'] }, ['XA']);
    expect(steps).toEqual(reachRequest('gr-req'));
  }, 120000);

  test("P6.310 (a) over STDIO a gate a step's prompt includes renders and is reviewed on that step only", async () => {
    expect(await reach({ command: PROMPT_OWN }, [])).toEqual(reachOwnPrompt('gp-x', GPX));
  }, 120000);

  test("P6.310 (a) over STDIO a gate a step's category supplies stays on that step", async () => {
    const steps = await reach({ command: PROMPT_CATEGORY }, []);
    expect(steps).toEqual(reachOwnPrompt('gp-cat', GPCAT, ['n1', 'n2', 'n3'], [GPCAT]));
  }, 120000);

  test('P6.310 (b) over STDIO two steps whose prompts include one gate each hold it on their own step', async () => {
    expect(await reach({ command: PROMPT_TWICE }, [])).toEqual(REACH_TWICE);
  }, 120000);

  test("P6.310 control over STDIO: a chain prompt's step keeps its prompt gate; the chain's own include reaches no step", async () => {
    expect(await reach({ command: '>>gp_chain' }, [])).toEqual(REACH_CHAIN_PROMPT);
  }, 120000);
});
