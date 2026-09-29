// @lifecycle test - P6.112 / R54: a run resumed in a process that never registered its temporary gates (a claimed handoff) re-registers them from its blueprint, over Streamable HTTP.
/**
 * MEASURED 2026-09-27 on `ff936b05`, two servers over one runtime root (`chain_runs` read beside
 * every reply):
 *   - Stop-and-restart: the new process deletes the dead owner's `chain_runs` rows at startup
 *     (`cleanupStalePidRows`) and loads only its own PID's, so `chain_id` on the old run answers
 *     "No stored execution blueprint found" and a minted handoff token answers "no run carries
 *     this token". Nothing survives a restart to resume; that is pinned below, not changed.
 *   - The one cross-process resume is the 2A handoff: server A mints, server B claims while A's
 *     rows exist, and B holds the run as a dormant session its first call promotes. On that call
 *     step 2 of `>>sv_chain :: g112:"…" :: "…"` with a request gate targeting it rendered
 *     `sv-block` only (the prompt's YAML step gate, a canonical gate): the named gate, the
 *     anonymous criterion and the request gate were gone, and a FAIL opened `{b: ["sv-block"]}`.
 *     The registry is in memory, and stage 05 skips on a restored blueprint.
 *
 * Now `InlineGateProcessor.restoreRunGates` (stage 05, on every restored blueprint) re-registers
 * each temporary gate the blueprint references and this process does not hold, under the id the
 * blueprint recorded, and hands the start call's request gates (`parsedCommand.requestGates`,
 * written by stage 13) back to stage 11 when the run owns none.
 *
 * P6.129 / R60 (measured 2026-09-27 on `1c1603d5`): when the claiming server already ran another
 * run declaring `g129`, the claimed step 2 rendered that run's `B-ONE`, not its own `A-ONE` — the
 * recorded id was held, so nothing restored, and the steps carry registered ids, not declared
 * names. Now it registers under `g129-2` and this call's restored command references that id.
 *
 * P6.130 / R61 (measured 2026-09-27 on `b7a08753`): after a claim `chain_sessions` held the dead
 * first owner's row (step 1) and the claimer's (step 2) until a later startup's cleanup. The hooks
 * loader already served the claimer's (its PID-liveness check skips the dead row); the projection
 * now drops another PID's row for a run it projects, so it holds exactly the owner's.
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

import type { ChildProcess } from 'node:child_process';

const PASS = 'GATE_REVIEW: PASS - ok';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gate';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
const GATED_COMMAND = '>>sv_chain :: g112:"NAMED-112" :: "ANON-112"';
const REQUEST_GATES = [{ id: 'rq112', name: 'rq112', criteria: ['REQ-112'], target_step_id: 'b' }];
const MARKERS = ['NAMED-112', 'ANON-112', 'REQ-112', 'GUIDANCE-sv-block'];
/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';

interface Server {
  /** The server process's PID, which `chain_sessions.run_owner_pid` records. */
  pid: string;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  stop(): Promise<void>;
}

interface Roots {
  home: string;
  workspace: string;
  runtimeRoot: string;
}

describe('Streamable HTTP: a claimed run keeps its temporary gates', () => {
  let cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  function freshRoots(): Roots {
    const roots = createHermeticRoots('claimed-run-gates-e2e');
    cleanup.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    return { home: roots.home, workspace, runtimeRoot: roots.runtimeRoot };
  }

  /** A server over `roots`; a second one over the same roots shares `state.db` and resources. */
  async function startServer(roots: Roots): Promise<Server> {
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc: ChildProcess = startServerWithHttp(port, {
      env: {
        HOME: roots.home,
        MCP_WORKSPACE: roots.workspace,
        MCP_RUNTIME_ROOT: roots.runtimeRoot,
        MCP_SHELL_VERIFY_ALLOWLIST: 'false',
      },
    });
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      await killServer(proc);
    };
    cleanup.push(stop);
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    const client = new ModernMcpClient(baseUrl, 'claimed-run-gates-e2e');
    let nextId = 1;
    return {
      pid: String(proc.pid),
      call: async (name, args) => {
        const outcome = await client.callToolWithNotifications(name, args, nextId++);
        const result = outcome.result as
          { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
        return {
          isError: result?.isError === true,
          text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        };
      },
      stop,
    };
  }

  async function authorResources(server: Server): Promise<void> {
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await server.call('resource_manager', args);
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
      user_message_template: 'CHAIN-OWN-TEMPLATE',
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_a', stepName: 'A', inlineGateIds: ['sv-block'] },
        { promptId: 'sv_b', stepName: 'B', inlineGateIds: ['sv-block'] },
        { promptId: 'sv_a', stepName: 'C', inlineGateIds: ['sv-block'] },
      ],
    });
  }

  /** The run's status and open reviews (temporary ids collapsed to `temp`), from `chain_runs`. */
  function runRow(
    roots: Roots,
    chainId: string
  ): { status: string; reviews: Record<string, string[]> } | undefined {
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const row = db
        .prepare('SELECT run_status, state FROM chain_runs WHERE chain_id = ?')
        .get(chainId) as { run_status: string; state: string } | undefined;
      if (row === undefined) return undefined;
      const state = JSON.parse(row.state) as { reviews?: Record<string, { gateIds: string[] }> };
      return {
        status: row.run_status,
        reviews: Object.fromEntries(
          Object.entries(state.reviews ?? {}).map(([node, review]) => [
            node,
            review.gateIds.map((id) => (/^temp_\d+_[a-z0-9]+$/.test(id) ? 'temp' : id)),
          ])
        ),
      };
    } finally {
      db.close();
    }
  }

  const chainIdOf = (text: string): string => {
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${text.slice(0, 400)}`);
    return chainId;
  };
  const markersIn = (text: string): string[] => MARKERS.filter((marker) => text.includes(marker));

  /** Start a run on a first server, mint its handoff, and claim it on a second one. */
  async function claimOnSecondServer(
    roots: Roots,
    start: Record<string, unknown>,
    beforeClaim?: (second: Server) => Promise<void>
  ): Promise<{ chainId: string; first: Server; second: Server; firstReply: string }> {
    const first = await startServer(roots);
    await authorResources(first);
    const opened = await first.call('prompt_engine', start);
    const chainId = chainIdOf(opened.text);
    const minted = await first.call('prompt_engine', { chain_id: chainId, handoff: true });
    const token = /Token: `(hnd_[^`]+)`/.exec(minted.text)?.[1];
    if (token === undefined) throw new Error(`no token in: ${minted.text}`);
    // The second server starts while the first owns the row: a start after the first exits
    // deletes the dead owner's runs (pinned below).
    const second = await startServer(roots);
    await beforeClaim?.(second);
    await first.stop();
    const claimed = await second.call('prompt_engine', {
      claim_token: token,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(claimed.isError).toBe(false);
    return { chainId, first, second, firstReply: claimed.text };
  }

  /**
   * P6.101 / R68: a contributed node's step gates live in `chain_run_nodes.inline_gate_ids` (v32),
   * and a claim rebuilds the run from those rows — the in-memory node the first server held is
   * gone. MEASURED 2026-09-27 on `6dad55f3`: the remainder below was refused by name (R46), so no
   * claim of it existed. Driven: server A appends `sv_chain` as a remainder, B claims and FAILs
   * the first contributed step, which opens a review of its `sv-block` gate.
   */
  test('P6.101 a claimed run keeps the gates its contributed steps declared', async () => {
    const roots = freshRoots();
    const first = await startServer(roots);
    await authorResources(first);
    const chainId = chainIdOf(
      (await first.call('prompt_engine', { command: `>>sv_a${ARROW}>>sv_b` })).text
    );
    await first.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'A out',
      observations: [
        { type: 'unknown_discovered', id: 'u-101', statement: 'undecided', blocking: true },
      ],
    });
    const appended = await first.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'investigated',
      remainder: { mode: 'append', nodes: [{ id: 'r1', promptId: 'sv_chain' }] },
    });
    expect(appended.isError).toBe(false);
    const minted = await first.call('prompt_engine', { chain_id: chainId, handoff: true });
    const token = /Token: `(hnd_[^`]+)`/.exec(minted.text)?.[1];
    if (token === undefined) throw new Error(`no token in: ${minted.text}`);
    const second = await startServer(roots);
    await first.stop();

    const claimed = await second.call('prompt_engine', {
      claim_token: token,
      user_response: 'B out',
    });
    expect(claimed.isError).toBe(false);
    expect(claimed.text).toContain('BODY-sv_a');
    const failed = await second.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'r1-a out',
      gate_verdict: FAIL,
    });
    expect(failed.text).toContain('Gate Review Required');
    expect(failed.text).toContain('GUIDANCE-sv-block');
    expect(runRow(roots, chainId)?.reviews).toEqual({ 'r1-a': ['sv-block'] });
  }, 180000);

  test('pin: a stop-and-restart leaves the run nothing to resume', async () => {
    const roots = freshRoots();
    const first = await startServer(roots);
    await authorResources(first);
    const chainId = chainIdOf((await first.call('prompt_engine', { command: GATED_COMMAND })).text);
    // Positive control: the row exists while its owner runs.
    expect(runRow(roots, chainId)?.status).toBe('working');
    await first.stop();

    const second = await startServer(roots);
    const resumed = await second.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(resumed.isError).toBe(true);
    expect(resumed.text).toContain('No stored execution blueprint found');
    expect(runRow(roots, chainId)).toBeUndefined();
  }, 180000);

  test('(a) the named gate, the anonymous criterion and the request gate render and review on step 2 after a claim', async () => {
    const roots = freshRoots();
    const { chainId, second, firstReply } = await claimOnSecondServer(roots, {
      command: GATED_COMMAND,
      gates: REQUEST_GATES,
    });
    expect(markersIn(firstReply)).toEqual(MARKERS);

    const failed = await second.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'B out',
      gate_verdict: FAIL,
    });
    expect(failed.text).toContain('Gate Review Required');
    expect(markersIn(failed.text)).toEqual(MARKERS);
    expect(runRow(roots, chainId)?.reviews).toEqual({
      b: ['rq112', 'sv-block', 'g112', 'temp', 'temp', 'temp'],
    });
  }, 180000);

  test('(b) control: the same resume in the process that started the run is unchanged', async () => {
    const roots = freshRoots();
    const server = await startServer(roots);
    await authorResources(server);
    const opened = await server.call('prompt_engine', {
      command: GATED_COMMAND,
      gates: REQUEST_GATES,
    });
    const chainId = chainIdOf(opened.text);
    const step2 = await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(markersIn(step2.text)).toEqual(MARKERS);
    await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'B out',
      gate_verdict: FAIL,
    });
    // No `g112-2` and no second `rq112`: every id the blueprint references is held, so the
    // restore registers nothing.
    expect(runRow(roots, chainId)?.reviews).toEqual({
      b: ['rq112', 'sv-block', 'g112', 'temp', 'temp', 'temp'],
    });
  }, 180000);

  /**
   * MEASURED 2026-09-27 on `530cf2c0` (driven, this harness): the claimed step 2 and the
   * same-process step 2 both carried the framework block, although the call's injection decision
   * for both was `system-prompt inject:false` (P6.131 trace): both open the post-advance review
   * on `b` (the request gate targets it), and stage 20 built the review render's chain context
   * without the call's `injectionState`, so the executor defaulted to injecting.
   *
   * R63: the review render honours the call's decision as stage 18's normal render does. P6.152
   * (R63 amended): that decision was computed for context 'gate_review', which the target filter
   * read as "not a step" under the shipped `target: "steps"`, so every review render dropped the
   * block. A review render of a step is a step render for the target, so step 2 now carries the
   * block exactly when an ungated chain's step 2, rendered normally by stage 18 on the same kind
   * of resume call, does: the three are pinned as one value. The ungated step 1 is the positive
   * control that the probe sees the block at all.
   *
   * R151 (2026-09-28): the system prompt is decided for the step the call RENDERS, so under the
   * shipped every-3-steps frequency all three step 2 renders carry no block, still equally.
   */
  test('P6.143 the claimed and the same-process step 2 carry the framework block equally, as the rendered step decides', async () => {
    const block = (text: string): boolean => text.includes('C.A.G.E.E.R.F');
    const claimed = await claimOnSecondServer(freshRoots(), {
      command: GATED_COMMAND,
      gates: REQUEST_GATES,
    });

    const server = await startServer(freshRoots());
    await authorResources(server);
    const opened = await server.call('prompt_engine', {
      command: GATED_COMMAND,
      gates: REQUEST_GATES,
    });
    const same = await server.call('prompt_engine', {
      chain_id: chainIdOf(opened.text),
      user_response: 'A out',
      gate_verdict: PASS,
    });

    // Positive control: an ungated arrow-chain's step 1 is not a review, and the call's decision
    // injects the framework's system prompt there, so the probe sees the framework when a
    // decision says so.
    const ungated = await server.call('prompt_engine', { command: `>>sv_a${ARROW}>>sv_b` });
    expect(ungated.isError).toBe(false);
    expect(block(ungated.text)).toBe(true);
    // The same kind of call rendering step 2 normally (stage 18, no review).
    const ungatedStep2 = await server.call('prompt_engine', {
      chain_id: chainIdOf(ungated.text),
      user_response: 'A out',
    });
    expect(ungatedStep2.isError).toBe(false);
    const normal = block(ungatedStep2.text);
    expect({ claimed: block(claimed.firstReply), same: block(same.text), normal }).toEqual({
      claimed: false,
      same: false,
      normal: false,
    });
  }, 240000);

  test('(c) a run with no temporary gates is claimed unchanged', async () => {
    const roots = freshRoots();
    const { chainId, second, firstReply } = await claimOnSecondServer(roots, {
      command: '>>sv_chain',
    });
    expect(markersIn(firstReply)).toEqual(['GUIDANCE-sv-block']);
    await second.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'B out',
      gate_verdict: FAIL,
    });
    expect(runRow(roots, chainId)?.reviews).toEqual({ b: ['sv-block'] });
  }, 180000);
  /** The `chain_sessions` projection rows for `chainId`: owner PID and projected step. */
  function projectionRows(roots: Roots, chainId: string): Array<{ pid: string; step: number }> {
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const rows = db
        .prepare('SELECT run_owner_pid, state FROM chain_sessions WHERE chain_id = ? ORDER BY id')
        .all(chainId) as Array<{ run_owner_pid: string; state: string }>;
      return rows.map((row) => ({
        pid: row.run_owner_pid,
        step: (JSON.parse(row.state) as { currentStep: number }).currentStep,
      }));
    } finally {
      db.close();
    }
  }

  test('P6.129 (a) a claimed named gate whose id the claiming server holds for another run keeps its own criteria', async () => {
    const roots = freshRoots();
    let otherChainId = '';
    const { chainId, second, firstReply } = await claimOnSecondServer(
      roots,
      { command: '>>sv_chain :: g129:"A-ONE"' },
      async (server) => {
        await server.call('resource_manager', {
          resource_type: 'prompt',
          action: 'create',
          id: 'sv_chain_other',
          category: 'general',
          name: 'sv_chain_other',
          description: 'a second chain the claiming server runs',
          user_message_template: 'OTHER-OWN-TEMPLATE',
          gate_configuration: OPT_OUT,
          chain_steps: [
            { promptId: 'sv_a', stepName: 'A' },
            { promptId: 'sv_b', stepName: 'B' },
          ],
        });
        const other = await server.call('prompt_engine', {
          command: '>>sv_chain_other :: g129:"B-ONE"',
        });
        expect(other.text).toContain('B-ONE');
        otherChainId = chainIdOf(other.text);
      }
    );
    expect(firstReply).toContain('A-ONE');
    expect(firstReply).not.toContain('B-ONE');

    const failed = await second.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'B out',
      gate_verdict: FAIL,
    });
    expect(failed.text).toContain('A-ONE');
    expect(failed.text).not.toContain('B-ONE');
    expect(runRow(roots, chainId)?.reviews).toEqual({ b: ['sv-block', 'g129-2'] });

    const other = await second.call('prompt_engine', {
      chain_id: otherChainId,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(other.text).toContain('B-ONE');
    expect(other.text).not.toContain('A-ONE');
  }, 180000);

  /**
   * A run declaring `g140` opens its step-a review on a first server, is claimed by a second one
   * (optionally running its own `g140` first, the collision), and answers step a there with a FAIL.
   */
  async function claimWithOpenReview(
    roots: Roots,
    collide: boolean
  ): Promise<{ chainId: string; second: Server; failed: string; sessionId: string }> {
    const first = await startServer(roots);
    await authorResources(first);
    const chainId = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain :: g140:"A-ONE"' })).text
    );
    // Positive control: the review is open before the claim, under the recorded id.
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g140'] });
    const minted = await first.call('prompt_engine', { chain_id: chainId, handoff: true });
    const token = /Token: `(hnd_[^`]+)`/.exec(minted.text)?.[1];
    if (token === undefined) throw new Error(`no token in: ${minted.text}`);
    const second = await startServer(roots);
    if (collide) {
      await second.call('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id: 'sv_chain_other',
        category: 'general',
        name: 'sv_chain_other',
        description: 'a second chain the claiming server runs',
        user_message_template: 'OTHER-OWN-TEMPLATE',
        gate_configuration: OPT_OUT,
        chain_steps: [
          { promptId: 'sv_a', stepName: 'A' },
          { promptId: 'sv_b', stepName: 'B' },
        ],
      });
      const other = await second.call('prompt_engine', {
        command: '>>sv_chain_other :: g140:"B-ONE"',
      });
      expect(other.text).toContain('B-ONE');
    }
    await first.stop();
    const failed = await second.call('prompt_engine', {
      claim_token: token,
      user_response: 'A out',
      gate_verdict: FAIL,
    });
    expect(failed.isError).toBe(false);
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const row = db
        .prepare('SELECT session_id FROM chain_runs WHERE chain_id = ?')
        .get(chainId) as { session_id: string };
      return { chainId, second, failed: failed.text, sessionId: row.session_id };
    } finally {
      db.close();
    }
  }

  /** The run's inline gate ids as `gates chain` and `system_control session inspect` report them. */
  async function reportedInlineGateIds(
    server: Server,
    chainId: string,
    sessionId: string
  ): Promise<{ summary: string | undefined; metadata: string[] | undefined }> {
    const gates = await server.call('prompt_engine', { command: `gates chain ${chainId}` });
    const inspected = await server.call('system_control', {
      action: 'session',
      operation: 'inspect',
      session_id: sessionId,
    });
    const metadata = /`chain_metadata`: (\{.*\})/.exec(inspected.text)?.[1];
    return {
      summary: /- Inline Gates: (.*)/.exec(gates.text)?.[1],
      metadata:
        metadata === undefined
          ? undefined
          : (JSON.parse(metadata) as { inlineGateIds: string[] }).inlineGateIds,
    };
  }

  test('P6.140 (a) a review opened before a claim names the remapped gate and a FAIL grades the claimed run criteria', async () => {
    const roots = freshRoots();
    const { chainId, second, failed, sessionId } = await claimWithOpenReview(roots, true);
    expect(failed).toContain('Gate Review Required');
    expect(failed).toContain('A-ONE');
    expect(failed).not.toContain('B-ONE');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g140-2'] });
    // The remapped gate is still a reminder the verdict attests (stage 20 derives the tiers from
    // the review's rewritten ids; the store's own tier-map rewrite is pinned in the unit test).
    expect(failed).toContain('"satisfied": ["sv-block", "g140-2"]');

    // P6.141 (a): the run's inline gate ids read through the same remap.
    expect(await reportedInlineGateIds(second, chainId, sessionId)).toEqual({
      summary: 'g140-2, sv-block',
      metadata: ['g140-2', 'sv-block'],
    });
  }, 180000);

  test('P6.140 (b) control: with no collision the claimed review and inline gate ids are unchanged', async () => {
    const roots = freshRoots();
    const { chainId, second, failed, sessionId } = await claimWithOpenReview(roots, false);
    expect(failed).toContain('A-ONE');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g140'] });
    expect(await reportedInlineGateIds(second, chainId, sessionId)).toEqual({
      summary: 'g140, sv-block',
      metadata: ['g140', 'sv-block'],
    });
  }, 180000);

  /** Run `sv_chain_other` on `server` with a named gate `g146`, authoring the prompt on first use. */
  async function runOtherG146(server: Server, criterion: string, author: boolean): Promise<void> {
    if (author) {
      await server.call('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id: 'sv_chain_other',
        category: 'general',
        name: 'sv_chain_other',
        description: 'a second chain the claiming server runs',
        user_message_template: 'OTHER-OWN-TEMPLATE',
        gate_configuration: OPT_OUT,
        chain_steps: [
          { promptId: 'sv_a', stepName: 'A' },
          { promptId: 'sv_b', stepName: 'B' },
        ],
      });
    }
    const other = await server.call('prompt_engine', {
      command: `>>sv_chain_other :: g146:"${criterion}"`,
    });
    expect(other.text).toContain(criterion);
  }

  /** Mint the run's handoff token on `owner`. */
  async function mintToken(owner: Server, chainId: string): Promise<string> {
    const minted = await owner.call('prompt_engine', { chain_id: chainId, handoff: true });
    const token = /Token: `(hnd_[^`]+)`/.exec(minted.text)?.[1];
    if (token === undefined) throw new Error(`no token in: ${minted.text}`);
    return token;
  }

  /**
   * P6.146 / R69 (MEASURED 2026-09-27 on `852c3da5`): server A opens the step-a review of a run
   * declaring `g146:"A-ONE"`; B, running its own `g146`, claims with a FAIL and the review is
   * rewritten to `g146-2`; B hands off to C, which holds `g146` AND `g146-2` for runs of its own.
   * C's claim re-derived `{g146: g146-3}` from the blueprint alone, which does not contain the
   * review's `g146-2`, so the review kept naming C's other run's gate and C's FAIL graded `C-TWO`.
   * With no collision on C the review still named `g146-2`, a gate C does not hold, and `A-ONE`
   * never rendered. Now the applied remap rides the run (`ChainSession.gateRemap`, persisted in
   * `chain_runs.state`) and each claim composes onto it. The single-claim control is P6.140 (b).
   */
  async function claimTwice(
    roots: Roots,
    collide: boolean
  ): Promise<{ chainId: string; third: Server; failed: string; sessionId: string }> {
    const first = await startServer(roots);
    await authorResources(first);
    const chainId = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain :: g146:"A-ONE"' })).text
    );
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g146'] });
    const firstToken = await mintToken(first, chainId);
    const second = await startServer(roots);
    await runOtherG146(second, 'B-ONE', true);
    await first.stop();
    // An answer with no verdict leaves the review open, so C's FAIL is the review's first.
    const claimed = await second.call('prompt_engine', {
      claim_token: firstToken,
      user_response: 'A out',
    });
    expect(claimed.isError).toBe(false);
    // Positive control: the first claim rewrote the review to its fresh id.
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g146-2'] });
    const secondToken = await mintToken(second, chainId);
    const third = await startServer(roots);
    if (collide) {
      await runOtherG146(third, 'C-ONE', false);
      await runOtherG146(third, 'C-TWO', false);
    }
    await second.stop();
    const failed = await third.call('prompt_engine', {
      claim_token: secondToken,
      user_response: 'A out again',
      gate_verdict: FAIL,
    });
    expect(failed.isError).toBe(false);
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const row = db
        .prepare('SELECT session_id FROM chain_runs WHERE chain_id = ?')
        .get(chainId) as { session_id: string };
      return { chainId, third, failed: failed.text, sessionId: row.session_id };
    } finally {
      db.close();
    }
  }

  test('P6.146 (a) a second claim of a remapped run renders its own criteria and names the claimer fresh id', async () => {
    const roots = freshRoots();
    const { chainId, third, failed, sessionId } = await claimTwice(roots, true);
    expect(failed).toContain('Gate Review Required');
    expect(failed).toContain('A-ONE');
    expect(failed).not.toContain('C-TWO');
    expect(failed).not.toContain('C-ONE');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g146-3'] });
    expect(await reportedInlineGateIds(third, chainId, sessionId)).toEqual({
      summary: 'g146-3, sv-block',
      metadata: ['g146-3', 'sv-block'],
    });
  }, 240000);

  test('P6.146 (b) a second claimer holding no g146 returns the review to the recorded id', async () => {
    const roots = freshRoots();
    const { chainId, third, failed, sessionId } = await claimTwice(roots, false);
    expect(failed).toContain('A-ONE');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'g146'] });
    expect(await reportedInlineGateIds(third, chainId, sessionId)).toEqual({
      summary: 'g146, sv-block',
      metadata: ['g146', 'sv-block'],
    });
  }, 240000);

  /**
   * P6.148 / P6.164 / R73. The "Chain-Scoped Temporary Gates" line reads
   * `getTemporaryGatesForScope('chain', chainId)` and prints gate NAMES. Only a prompt's
   * `inline_gate_definitions` with `scope: chain` register there, and only with
   * `gates.executeInlineGateDefinitions` (default false). MEASURED 2026-09-27 on `351645814` (the
   * P6.148 pin): the call that starts a run has no chain id yet, so its chain-scoped gate was filed
   * under the server-wide `chain:execution` bucket and the line read `none` on the server that
   * started the run while the run's review held `cg148`; a claimer, registering on a `chain_id`
   * call, listed it. Now the run files its adopted chain-scoped gates under its own chain id (the
   * R47 adoption point), so the starter lists the gate, the claimer is unchanged, and the
   * claimer's own run of the same prompt lists its own.
   */
  test('P6.164 (a) the starter lists its chain-scoped gate; (c) control: the claimer is unchanged', async () => {
    const roots = freshRoots();
    writeFileSync(
      path.join(roots.workspace, 'config.json'),
      JSON.stringify({ gates: { executeInlineGateDefinitions: true } })
    );
    const chainLine = async (server: Server, chainId: string): Promise<string | undefined> =>
      /- Chain-Scoped Temporary Gates: (.*)/.exec(
        (await server.call('prompt_engine', { command: `gates chain ${chainId}` })).text
      )?.[1];
    const first = await startServer(roots);
    await authorResources(first);
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await first.call('resource_manager', args);
      if (result.isError) throw new Error(result.text);
    };
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_a148',
      category: 'general',
      name: 'sv_a148',
      description: 'step carrying a chain-scoped inline definition',
      user_message_template: 'BODY-sv_a148',
      gate_configuration: {
        ...OPT_OUT,
        inline_gate_definitions: [
          {
            id: 'cg148',
            name: 'cg148',
            type: 'validation',
            scope: 'chain',
            description: 'chain-scoped e2e gate',
            guidance: 'CHAIN-148',
            pass_criteria: ['CHAIN-148'],
          },
        ],
      },
    });
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_chain148',
      category: 'general',
      name: 'sv_chain148',
      description: 'chain whose steps carry a chain-scoped gate',
      user_message_template: 'CHAIN148',
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_a148', stepName: 'A' },
        { promptId: 'sv_b', stepName: 'B' },
        { promptId: 'sv_a148', stepName: 'C' },
      ],
    });
    const chainId = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain148 :: g148:"A-ONE"' })).text
    );
    await first.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'A draft',
      gate_verdict: FAIL,
    });
    // Positive control: the chain-scoped gate is the run's own — its review names it.
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['g148', 'cg148'] });
    expect(await chainLine(first, chainId)).toBe('cg148');
    const token = await mintToken(first, chainId);

    const second = await startServer(roots);
    const otherChainId = chainIdOf(
      (await second.call('prompt_engine', { command: '>>sv_chain148 :: g148:"B-TWO"' })).text
    );
    await first.stop();
    const claimed = await second.call('prompt_engine', {
      claim_token: token,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(claimed.isError).toBe(false);
    expect(await chainLine(second, chainId)).toBe('cg148');
    expect(await chainLine(second, otherChainId)).toBe('cg148');
  }, 240000);

  /**
   * P6.164 / R73. MEASURED 2026-09-27 on `c3cf5989`, two runs of one chain on one server: both
   * start calls filed their chain-scoped gate under `chain:execution`, and both lines read `none`.
   * The registry releases a run's gates by the run's ownership index (`releaseRun`), so a cancel
   * never took the other run's gate, and the registry has no path that clears a scope's gates
   * together. Pinned here: one run ends,
   * the other keeps its gate and its own scope lists it.
   */
  test('P6.164 (b) two runs on one server: one ends, the other keeps its chain-scoped gate', async () => {
    const roots = freshRoots();
    writeFileSync(
      path.join(roots.workspace, 'config.json'),
      JSON.stringify({ gates: { executeInlineGateDefinitions: true } })
    );
    const server = await startServer(roots);
    await authorResources(server);
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await server.call('resource_manager', args);
      if (result.isError) throw new Error(result.text);
    };
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_a164',
      category: 'general',
      name: 'sv_a164',
      description: 'step carrying a chain-scoped inline definition',
      user_message_template: 'BODY-sv_a164',
      gate_configuration: {
        ...OPT_OUT,
        inline_gate_definitions: [
          {
            id: 'cg164',
            name: 'cg164',
            type: 'validation',
            scope: 'chain',
            description: 'chain-scoped e2e gate',
            guidance: 'CHAIN-164',
            pass_criteria: ['CHAIN-164'],
          },
        ],
      },
    });
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_chain164',
      category: 'general',
      name: 'sv_chain164',
      description: 'chain whose steps carry a chain-scoped gate',
      user_message_template: 'CHAIN164',
      gate_configuration: OPT_OUT,
      chain_steps: [
        { promptId: 'sv_a164', stepName: 'A' },
        { promptId: 'sv_b', stepName: 'B' },
      ],
    });
    const chainLine = async (chainId: string): Promise<string | undefined> =>
      /- Chain-Scoped Temporary Gates: (.*)/.exec(
        (await server.call('prompt_engine', { command: `gates chain ${chainId}` })).text
      )?.[1];
    const ended = chainIdOf(
      (await server.call('prompt_engine', { command: '>>sv_chain164' })).text
    );
    const kept = chainIdOf((await server.call('prompt_engine', { command: '>>sv_chain164' })).text);
    expect([await chainLine(ended), await chainLine(kept)]).toEqual(['cg164', 'cg164']);

    await server.call('prompt_engine', { chain_id: ended, cancel: true });
    expect([await chainLine(ended), await chainLine(kept)]).toEqual(['none', 'cg164']);
    const failed = await server.call('prompt_engine', {
      chain_id: kept,
      user_response: 'A draft',
      gate_verdict: FAIL,
    });
    expect(runRow(roots, kept)?.reviews).toEqual({ a: ['cg164-2'] });
    expect(failed.text).toContain('CHAIN-164');
  }, 180000);

  /**
   * P6.172 / R82. MEASURED 2026-09-27 on `7e6697b4` with `gates.executeInlineGateDefinitions` on: a
   * three-step chain of one step prompt whose inline definition declares no `id` (name `g172`,
   * `scope: chain`) listed `g172` three times after its start call, six after the second call and
   * nine after the third, and step `b`'s FAIL reviewed three `temp_…` gates — one fresh gate per
   * step per call, because only a declared id was looked up among the gates the run holds. The
   * same prompt declaring `id: dg172` listed one gate throughout. Now an id-less definition
   * registers under the slug of its name, as a chain prompt's already did (R76).
   */
  test('P6.172 an id-less inline definition is one gate across three calls; a declared id is unchanged', async () => {
    const roots = freshRoots();
    writeFileSync(
      path.join(roots.workspace, 'config.json'),
      JSON.stringify({ gates: { executeInlineGateDefinitions: true } })
    );
    const server = await startServer(roots);
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await server.call('resource_manager', args);
      if (result.isError) throw new Error(result.text);
    };
    const definitions = {
      sv_x172: { name: 'g172', guidance: 'IDLESS-172' },
      sv_y172: { id: 'dg172', name: 'dg172', guidance: 'DECL-172' },
    };
    for (const [id, definition] of Object.entries(definitions)) {
      await author({
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: 'step carrying one chain-scoped inline definition',
        user_message_template: `BODY-${id}`,
        gate_configuration: {
          ...OPT_OUT,
          inline_gate_definitions: [
            {
              ...definition,
              type: 'validation',
              scope: 'chain',
              description: 'e2e inline definition',
              pass_criteria: [definition.guidance],
            },
          ],
        },
      });
      await author({
        resource_type: 'prompt',
        action: 'create',
        id: `${id}_chain`,
        category: 'general',
        name: `${id}_chain`,
        description: 'three steps of one step prompt',
        user_message_template: 'CHAIN172',
        gate_configuration: OPT_OUT,
        chain_steps: ['A', 'B', 'C'].map((stepName) => ({ promptId: id, stepName })),
      });
    }
    const chainLine = async (chainId: string): Promise<string | undefined> =>
      /- Chain-Scoped Temporary Gates: (.*)/.exec(
        (await server.call('prompt_engine', { command: `gates chain ${chainId}` })).text
      )?.[1];
    const threeCalls = async (promptId: string) => {
      const chainId = chainIdOf(
        (await server.call('prompt_engine', { command: `>>${promptId}_chain` })).text
      );
      const lines = [await chainLine(chainId)];
      await server.call('prompt_engine', {
        chain_id: chainId,
        user_response: 'A out',
        gate_verdict: PASS,
      });
      lines.push(await chainLine(chainId));
      const failed = await server.call('prompt_engine', {
        chain_id: chainId,
        user_response: 'B out',
        gate_verdict: FAIL,
      });
      lines.push(await chainLine(chainId));
      return { lines, reviews: runRow(roots, chainId)?.reviews, failed: failed.text };
    };

    const idless = await threeCalls('sv_x172');
    expect(idless.lines).toEqual(['g172', 'g172', 'g172']);
    expect(idless.reviews).toEqual({ b: ['g172'] });
    expect(idless.failed).toContain('IDLESS-172');

    const declared = await threeCalls('sv_y172');
    expect(declared.lines).toEqual(['dg172', 'dg172', 'dg172']);
    expect(declared.reviews).toEqual({ b: ['dg172'] });
  }, 180000);

  /**
   * P6.183 / R85. MEASURED 2026-09-27 on `bfd6e110` with `gates.executeInlineGateDefinitions` on:
   * a step prompt declaring an inline definition `{id: content-structure}` registered a temporary
   * gate under the canonical id, and from then on EVERY run in the process — a later run of a
   * prompt declaring nothing included — reviewed `content-structure` against the definition's
   * criteria instead of the canonical guidance, because gate loading reads the temporary registry
   * first. A definition named `Content Structure` with no id did the same through its slug. A
   * non-colliding id (`ctl183`) registered beside the canonical gate. Both colliding paths are now
   * refused (as of 2026-09-27 · flips when a temporary gate is scoped to the run that declared it,
   * so shadowing could no longer reach another run).
   */
  test('P6.183 an inline definition may not shadow a canonical gate id, declared or slug-derived', async () => {
    const roots = freshRoots();
    writeFileSync(
      path.join(roots.workspace, 'config.json'),
      JSON.stringify({ gates: { executeInlineGateDefinitions: true } })
    );
    const definitions: Record<string, Record<string, unknown> | undefined> = {
      sv_c183: { id: 'content-structure', name: 'content-structure', guidance: 'DECL-183' },
      sv_s183: { name: 'Content Structure', guidance: 'SLUG-183' },
      sv_n183: { id: 'ctl183', name: 'ctl183', guidance: 'CTL-183' },
      sv_p183: undefined,
    };
    const stepPrompt = (id: string, definition: Record<string, unknown> | undefined) => ({
      id,
      category: 'general',
      name: id,
      description: 'step for P6.183',
      gate_configuration: {
        framework_gates: false,
        ...(definition === undefined
          ? {}
          : {
              inline_gate_definitions: [
                {
                  ...definition,
                  type: 'validation',
                  scope: 'chain',
                  description: 'e2e inline definition',
                  pass_criteria: [definition['guidance']],
                },
              ],
            }),
      },
    });
    // Since P6.192 `resource_manager` refuses a shadowing definition, so the two that shadow are
    // written into the workspace before boot: a file on disk still reaches the runtime refusal.
    for (const id of ['sv_c183', 'sv_s183']) {
      const { gate_configuration, ...fields } = stepPrompt(id, definitions[id]);
      const dir = path.join(roots.workspace, 'resources', 'prompts', 'general', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'prompt.yaml'),
        JSON.stringify({
          ...fields,
          userMessageTemplate: `BODY-${id}`,
          gateConfiguration: gate_configuration,
        })
      );
    }
    const server = await startServer(roots);
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await server.call('resource_manager', args);
      if (result.isError) throw new Error(result.text);
    };
    for (const [id, definition] of Object.entries(definitions)) {
      if (id !== 'sv_c183' && id !== 'sv_s183') {
        await author({
          resource_type: 'prompt',
          action: 'create',
          ...stepPrompt(id, definition),
          user_message_template: `BODY-${id}`,
        });
      }
      await author({
        resource_type: 'prompt',
        action: 'create',
        id: `${id}_chain`,
        category: 'general',
        name: `${id}_chain`,
        description: 'two steps',
        user_message_template: 'CHAIN183',
        gate_configuration: { framework_gates: false },
        chain_steps: ['A', 'B'].map((stepName) => ({ promptId: id, stepName })),
      });
    }
    const markers = ['Use clear headings', 'DECL-183', 'SLUG-183', 'CTL-183'];
    const failFirst = async (promptId: string) => {
      const start = await server.call('prompt_engine', { command: `>>${promptId}_chain` });
      const chainId = chainIdOf(start.text);
      const failed = await server.call('prompt_engine', {
        chain_id: chainId,
        user_response: 'A out',
        gate_verdict: FAIL,
      });
      return {
        promptId,
        reviews: runRow(roots, chainId)?.reviews,
        failShown: markers.filter((marker) => failed.text.includes(marker)),
      };
    };
    const canonical = { reviews: { a: ['content-structure'] }, failShown: ['Use clear headings'] };
    // Positive control: a prompt declaring nothing is reviewed on the canonical guidance.
    expect(await failFirst('sv_p183')).toMatchObject({ promptId: 'sv_p183', ...canonical });
    // (a) A declared canonical id is refused: its run, and a later plain run, keep the canonical gate.
    expect(await failFirst('sv_c183')).toMatchObject({ promptId: 'sv_c183', ...canonical });
    expect(await failFirst('sv_p183')).toMatchObject({ promptId: 'sv_p183', ...canonical });
    // (b) The same through a name whose slug is the canonical id.
    expect(await failFirst('sv_s183')).toMatchObject({ promptId: 'sv_s183', ...canonical });
    expect(await failFirst('sv_p183')).toMatchObject({ promptId: 'sv_p183', ...canonical });
    // (c) Control: a non-colliding id registers beside the canonical gate.
    expect(await failFirst('sv_n183')).toMatchObject({
      promptId: 'sv_n183',
      reviews: { a: ['content-structure', 'ctl183'] },
      failShown: ['Use clear headings', 'CTL-183'],
    });
  }, 240000);

  /**
   * P6.192 / R94. MEASURED_192
   */
  test('P6.192 resource_manager refuses an inline definition shadowing a canonical gate id', async () => {
    const roots = freshRoots();
    const server = await startServer(roots);
    const draft = (id: string, definition: Record<string, unknown>) => ({
      resource_type: 'prompt',
      id,
      category: 'general',
      name: id,
      description: 'step for P6.192',
      user_message_template: `BODY-${id}`,
      gate_configuration: {
        framework_gates: false,
        inline_gate_definitions: [
          {
            ...definition,
            type: 'validation',
            scope: 'chain',
            description: 'e2e',
            pass_criteria: ['P-192'],
          },
        ],
      },
    });
    const refusal = /content-structure.*canonical gate/;
    const declared = { id: 'content-structure', name: 'content-structure', guidance: 'DECL-192' };
    const slugged = { name: 'Content Structure', guidance: 'SLUG-192' };

    // (a) A declared canonical id: validate and create both refuse it, naming the id.
    for (const action of ['validate', 'create']) {
      const result = await server.call('resource_manager', {
        ...draft('sv_c192', declared),
        action,
      });
      expect({ action, isError: result.isError }).toEqual({ action, isError: true });
      expect(result.text).toMatch(refusal);
    }
    // (b) A name whose slug is the canonical id: the same.
    const slug = await server.call('resource_manager', {
      ...draft('sv_s192', slugged),
      action: 'create',
    });
    expect(slug.isError).toBe(true);
    expect(slug.text).toMatch(refusal);

    // (c) Control: a non-colliding definition is accepted.
    const control = await server.call('resource_manager', {
      ...draft('sv_n192', { id: 'ctl192', name: 'ctl192', guidance: 'CTL-192' }),
      action: 'create',
    });
    expect(control.isError).toBe(false);

    // An update adding a shadowing definition, and its preview, refuse it too.
    const shadowing = draft('sv_n192', declared).gate_configuration;
    for (const extra of [{ action: 'preview', preview_action: 'update' }, { action: 'update' }]) {
      const result = await server.call('resource_manager', {
        resource_type: 'prompt',
        id: 'sv_n192',
        gate_configuration: shadowing,
        ...extra,
      });
      expect({ ...extra, isError: result.isError }).toEqual({ ...extra, isError: true });
      expect(result.text).toMatch(refusal);
    }
  }, 180000);

  /**
   * P6.202 / R103. MEASURED 2026-09-27 on `9a319ba9`, driven over `resource_manager create`: an
   * inline definition omitting `pass_criteria` answered "Prompt Created, but post-write
   * verification FAILED (mismatched: gateConfiguration)" while the gate loaded, because the
   * loader serves `pass_criteria: []` and the verification compared the request as written. It
   * now applies the loader's own defaults (`withInlineGateDefaults`) first. A definition omitting
   * `scope` still reports the mismatch, and must: the loader has no default for `scope`, and
   * drops that definition, so the served prompt has no gate.
   */
  test('P6.202 a create omitting a defaulted inline-gate field verifies; a dropped gate does not', async () => {
    const roots = freshRoots();
    const server = await startServer(roots);
    const create = (id: string, definition: Record<string, unknown>) =>
      server.call('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        category: 'general',
        name: id,
        description: 'step for P6.202',
        user_message_template: `BODY-${id}`,
        gate_configuration: { framework_gates: false, inline_gate_definitions: [definition] },
      });
    const full = {
      name: 'g202',
      type: 'validation',
      scope: 'execution',
      description: 'D-202',
      guidance: 'G-202',
      pass_criteria: ['P-202'],
    };
    const { pass_criteria: _omittedCriteria, ...noCriteria } = full;
    const { scope: _omittedScope, ...noScope } = full;
    const verificationFailed = /post-write verification FAILED.*\n.*mismatched: gateConfiguration/;

    // (a) The loader fills `pass_criteria: []`: the create verifies, and the gate is served.
    const defaulted = await create('sv_p202_criteria', noCriteria);
    expect({ isError: defaulted.isError, text: defaulted.text }).toMatchObject({ isError: false });
    expect(defaulted.text).not.toMatch(verificationFailed);
    const inspected = await server.call('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: 'sv_p202_criteria',
    });
    expect(inspected.text).toContain('"name":"g202"');
    expect(inspected.text).toContain('"pass_criteria":[]');

    // (b) Control: a definition the loader drops is not normalized into a match. Since P6.215
    // (R108) the write is refused before anything lands, naming the field the loader requires.
    const dropped = await create('sv_p202_scope', noScope);
    expect(dropped.isError).toBe(true);
    expect(dropped.text).toContain('inline_gate_definitions[0] (g202): scope (must be one of');

    // (b) Control: a complete definition verifies as before.
    expect((await create('sv_p202_full', full)).isError).toBe(false);
  }, 180000);

  /**
   * P6.215 / R108. MEASURED 2026-09-28 on `51b16fd5`, driven over `resource_manager create`: an
   * inline definition omitting `scope` was WRITTEN, and the reply read "post-write verification
   * FAILED (mismatched: gateConfiguration)" because the loader dropped the gate ("Dropped inline
   * gate definition … scope (must be one of …). The gate will not load."). `diagnosePromptWrite`
   * now reads the loader's own `findInlineGateFieldProblems`, so validate, create, update and the
   * update preview refuse the definition by field before anything is written.
   */
  test('P6.215 a write carrying an inline gate the loader would drop is refused by field', async () => {
    const roots = freshRoots();
    const server = await startServer(roots);
    const gate = {
      name: 'g215',
      type: 'validation',
      scope: 'execution',
      description: 'D-215',
      guidance: 'G-215',
      pass_criteria: ['P-215'],
    };
    const { scope: _omittedScope, ...noScope } = gate;
    const { guidance: _omittedGuidance, ...noGuidance } = gate;
    const prompt = (action: string, id: string, definition: Record<string, unknown>) =>
      server.call('resource_manager', {
        resource_type: 'prompt',
        action,
        id,
        category: 'general',
        name: id,
        description: 'step for P6.215',
        user_message_template: `BODY-${id}`,
        gate_configuration: { framework_gates: false, inline_gate_definitions: [definition] },
      });
    const refusedFor = (field: string) =>
      `gateConfiguration.inline_gate_definitions[0] (g215): ${field} (must be`;
    const promptFile = path.join(roots.workspace, 'resources', 'prompts', 'general');

    // (a) validate and create refuse, naming the field; create writes nothing.
    const validated = await prompt('validate', 'sv_p215_new', noScope);
    expect(validated.isError).toBe(true);
    expect(validated.text).toContain(refusedFor('scope'));
    const created = await prompt('create', 'sv_p215_new', noScope);
    expect(created.isError).toBe(true);
    expect(created.text).toContain(refusedFor('scope'));
    expect(created.text).not.toMatch(/post-write verification/);
    expect(existsSync(path.join(promptFile, 'sv_p215_new'))).toBe(false);

    // (c) Control: the complete definition validates, creates and loads.
    expect((await prompt('validate', 'sv_p215', gate)).isError).toBe(false);
    const complete = await prompt('create', 'sv_p215', gate);
    expect({ isError: complete.isError, text: complete.text }).toMatchObject({ isError: false });
    expect(complete.text).not.toMatch(/post-write verification FAILED/);
    // Positive control for the absence asserted in (a): the path probe sees a written prompt.
    expect(existsSync(path.join(promptFile, 'sv_p215'))).toBe(true);

    // (b) update and its preview refuse the same, and the loaded gate is unchanged.
    const update = (definition: Record<string, unknown>, preview: boolean) =>
      server.call('resource_manager', {
        resource_type: 'prompt',
        ...(preview ? { action: 'preview', preview_action: 'update' } : { action: 'update' }),
        id: 'sv_p215',
        gate_configuration: { framework_gates: false, inline_gate_definitions: [definition] },
      });
    const previewed = await update(noGuidance, true);
    expect(previewed.isError).toBe(true);
    expect(previewed.text).toContain(refusedFor('guidance'));
    const updated = await update(noGuidance, false);
    expect(updated.isError).toBe(true);
    expect(updated.text).toContain(refusedFor('guidance'));
    const inspected = await server.call('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: 'sv_p215',
    });
    expect(inspected.text).toContain('"guidance":"G-215"');
  }, 180000);

  /**
   * P6.193 / R94. The two other paths choosing a temporary gate's id. MEASURED 2026-09-27 on
   * `20f40ca6` with `gates.executeInlineGateDefinitions` on, every run left open: a request gate
   * `{id: content-structure, criteria: [REQ-193]}` was reviewed as `content-structure` rendering
   * REQ-193 instead of the canonical guidance, and so was every later plain run on the server; a
   * named inline gate `:: content-structure:"NAMED-193"` did the same with NAMED-193. Gate loading
   * reads the temporary registry first, keyed by id per process. `createTemporaryGate` now refuses
   * a canonical id for every caller (the refusal is a server-log warning; the run keeps the
   * canonical gate). A request gate carrying `name` and `description` as well lost its id before
   * registration, fixed by P6.203 below.
   */
  /**
   * A server with `gates.executeInlineGateDefinitions` on and a two-step chain `sv_p193_chain`
   * whose steps carry the canonical `content-structure` gate. `failFirst` starts a run (left open,
   * so any gate it registered stays held) and FAILs its first step; `refused` sends a call expected
   * to be refused and reports whether any run was created.
   */
  async function p193Server(): Promise<{
    roots: Roots;
    server: Server;
    failFirst: (start: Record<string, unknown>) => Promise<{
      reviews: Record<string, string[]> | undefined;
      failShown: string[];
    }>;
    refusedCall: (args: Record<string, unknown>) => Promise<{
      isError: boolean;
      refusal: string | undefined;
      runsCreated: number;
    }>;
  }> {
    const roots = freshRoots();
    writeFileSync(
      path.join(roots.workspace, 'config.json'),
      JSON.stringify({ gates: { executeInlineGateDefinitions: true } })
    );
    const server = await startServer(roots);
    const author = async (args: Record<string, unknown>): Promise<void> => {
      const result = await server.call('resource_manager', args);
      if (result.isError) throw new Error(result.text);
    };
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_p193',
      category: 'general',
      name: 'sv_p193',
      description: 'step for P6.193',
      user_message_template: 'BODY-193',
      gate_configuration: { framework_gates: false },
    });
    await author({
      resource_type: 'prompt',
      action: 'create',
      id: 'sv_p193_chain',
      category: 'general',
      name: 'sv_p193_chain',
      description: 'two steps',
      user_message_template: 'CHAIN193',
      gate_configuration: { framework_gates: false },
      chain_steps: ['A', 'B'].map((stepName) => ({ promptId: 'sv_p193', stepName })),
    });
    const markers = [
      'Use clear headings',
      'REQ-193',
      'NAMED-193',
      'RQC-193',
      'NMC-193',
      'X-203',
      'QK-203',
    ];
    const failFirst = async (start: Record<string, unknown>) => {
      const started = await server.call('prompt_engine', start);
      const chainId = chainIdOf(started.text);
      const failed = await server.call('prompt_engine', {
        chain_id: chainId,
        user_response: 'A out',
        gate_verdict: FAIL,
      });
      return {
        reviews: runRow(roots, chainId)?.reviews,
        failShown: markers.filter((marker) => failed.text.includes(marker)),
      };
    };
    const runCount = (): number => {
      const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
      try {
        return (db.prepare('SELECT COUNT(*) AS n FROM chain_runs').get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    const refusedCall = async (args: Record<string, unknown>) => {
      const before = runCount();
      const result = await server.call('prompt_engine', args);
      return {
        isError: result.isError,
        refusal: /• \[gate-id-canonical\] workflow: (.*)/.exec(result.text)?.[1],
        runsCreated: runCount() - before,
      };
    };
    return { roots, server, failFirst, refusedCall };
  }

  const PLAIN_193 = { command: '>>sv_p193_chain' };
  /** A reply refusing a gate under the canonical `content-structure` id, before any run exists. */
  const REFUSED_210 = {
    isError: true,
    refusal: expect.stringContaining("may not shadow a canonical gate id ('content-structure')"),
    runsCreated: 0,
  };
  const CANONICAL_193 = {
    reviews: { a: ['content-structure'] },
    failShown: ['Use clear headings'],
  };

  /**
   * P6.212 / R109. A whole-call refusal at stage 11 runs after stage 05 registered the call's named
   * gates, which was read as leaving them registered with no run. MEASURED 2026-09-28 on
   * `f10c8f55` (driven, flag on): nothing lingers. Stage 05 adds them to
   * `state.gates.temporaryGateIds`, the call creates no run to adopt them, and stage 02's cleanup
   * (`releaseUnowned`, run in the pipeline's `finally`) removes them once the refusal is set.
   * Pinned here: with that release removed, (a) reads `nmc212-2`. Observed through the id the next
   * declaration of the same name registers under: a gate still held pushes it to `<name>-2` (the
   * positive control below), a released one does not.
   */
  test('P6.212 a call refused at stage 11 leaves no gate it registered', async () => {
    const { server, failFirst, refusedCall } = await p193Server();
    const reviewsOf = async (start: Record<string, unknown>) => (await failFirst(start)).reviews;

    // Positive control: a live run holding `hld212` pushes the next declaration to `hld212-2`.
    expect(await reviewsOf({ command: '>>sv_p193_chain :: hld212:"HLD-212"' })).toEqual({
      a: ['hld212', 'content-structure'],
    });
    expect(await reviewsOf({ command: '>>sv_p193_chain :: hld212:"HLD-212"' })).toEqual({
      a: ['hld212-2', 'content-structure'],
    });

    // (a) A NON-colliding named gate beside a colliding request gate: refused whole, and the next
    // declaration of `nmc212` registers under its own name, so nothing from the refused call is held.
    expect(
      await refusedCall({
        command: '>>sv_p193_chain :: nmc212:"NMC-212"',
        gates: [{ id: 'content-structure', criteria: ['REQ-212'] }],
      })
    ).toMatchObject(REFUSED_210);
    expect(await reviewsOf({ command: '>>sv_p193_chain :: nmc212:"NMC-212"' })).toEqual({
      a: ['nmc212', 'content-structure'],
    });

    // (b)(c) A resume refused for a passed target (R65) leaves the run's own gate held.
    const started = await server.call('prompt_engine', {
      command: '>>sv_p193_chain :: rsm212:"RSM-212"',
    });
    const refusedResume = await server.call('prompt_engine', {
      chain_id: chainIdOf(started.text),
      user_response: 'A out',
      gates: [{ name: 'tgt212', criteria: ['TGT-212'], target_step_id: 'a' }],
    });
    expect(refusedResume.text).toContain('[gate-target-passed] node "a"');
    expect(await reviewsOf({ command: '>>sv_p193_chain :: rsm212:"RSM-212"' })).toEqual({
      a: ['rsm212-2', 'content-structure'],
    });
  }, 180000);

  test('P6.193 a request gate or named inline gate may not shadow a canonical gate id', async () => {
    const { failFirst, refusedCall } = await p193Server();
    const plain = PLAIN_193;
    const canonical = CANONICAL_193;
    // Positive control: a plain run is reviewed on the canonical guidance.
    expect(await failFirst(plain)).toMatchObject(canonical);

    // (a) A request gate under the canonical id is refused in the reply (P6.210), and a later plain
    // run keeps the canonical gate.
    const request = { ...plain, gates: [{ id: 'content-structure', criteria: ['REQ-193'] }] };
    expect(await refusedCall(request)).toMatchObject(REFUSED_210);
    expect(await failFirst(plain)).toMatchObject(canonical);

    // (b) A named inline gate under the canonical id: the same.
    expect(
      await refusedCall({ command: '>>sv_p193_chain :: content-structure:"NAMED-193"' })
    ).toMatchObject(REFUSED_210);
    expect(await failFirst(plain)).toMatchObject(canonical);

    // (c) Control: a non-colliding request gate and named gate register beside the canonical one.
    expect(
      await failFirst({ ...plain, gates: [{ id: 'rqc193', criteria: ['RQC-193'] }] })
    ).toMatchObject({
      reviews: { a: ['rqc193', 'content-structure'] },
      failShown: ['Use clear headings', 'RQC-193'],
    });
    expect(await failFirst({ command: '>>sv_p193_chain :: nmc193:"NMC-193"' })).toMatchObject({
      reviews: { a: ['nmc193', 'content-structure'] },
      failShown: ['Use clear headings', 'NMC-193'],
    });
  }, 240000);

  /**
   * P6.210 / R100. MEASURED 2026-09-27 on `b176a1e6`: `gates: [{id: 'content-structure', criteria:
   * ['REQ']}]` and `>>sv_p193_chain :: content-structure:"NAMED"` each answered with the rendered
   * prompt (`isError: false`), and only the server log said the gate was dropped. A request gate
   * already refused on its content (an undeclared `target_step_id`) answers stage 04's addressed
   * rejection, "❌ Workflow rejected … Nothing was executed and no run was created." with a
   * `• [gate-target-missing] node "zz": …` line; a key the schema does not declare answers the
   * SDK's "Input validation error". The canonical id is a content refusal, so it answers the first
   * shape: stage 05 for a named gate and stage 11 for a request gate, before anything registers.
   */
  test('P6.210 a gate under a canonical id is refused in the reply, and no run starts', async () => {
    const { roots, server, failFirst, refusedCall } = await p193Server();
    // (a) The request gate: refused by name, no run.
    expect(
      await refusedCall({
        ...PLAIN_193,
        gates: [{ id: 'content-structure', criteria: ['REQ-210'] }],
      })
    ).toMatchObject({
      ...REFUSED_210,
      refusal: expect.stringMatching(/^request gate "content-structure": /),
    });
    // (b) The named inline gate: refused by name, no run.
    expect(
      await refusedCall({ command: '>>sv_p193_chain :: content-structure:"NAMED-210"' })
    ).toMatchObject({
      ...REFUSED_210,
      refusal: expect.stringMatching(/^named inline gate "content-structure": /),
    });
    // (a) on a resume: the call is refused and the run stays on its first step.
    const chainId = chainIdOf((await server.call('prompt_engine', PLAIN_193)).text);
    const nodeOf = (): string | undefined =>
      runRows(roots).find((row) => row.chainId === chainId)?.node;
    expect(nodeOf()).toBe('a');
    expect(
      await refusedCall({
        chain_id: chainId,
        user_response: 'A out',
        gate_verdict: PASS,
        gates: [{ id: 'content-structure', criteria: ['REQ-210'] }],
      })
    ).toMatchObject(REFUSED_210);
    expect(nodeOf()).toBe('a');
    // (c) Control: the canonical id sent alone is a reference to that gate, not refused.
    expect(await failFirst({ ...PLAIN_193, gates: [{ id: 'content-structure' }] })).toMatchObject(
      CANONICAL_193
    );
  }, 240000);

  /**
   * P6.203 / R101. MEASURED 2026-09-27 on `388bf9d3`: a request gate carrying `name` and
   * `description` beside its `id` and `criteria` registered as `temp_…` and rendered only its
   * description. The `prompt_engine` handler read any gate holding both `name` and `description` as
   * the `{name, description}` quick gate and dropped every other key; it now takes the quick-gate
   * shape only when the gate matches the tool's strict quick-gate schema.
   */
  test('P6.203 a request gate carrying name and description keeps its id and criteria', async () => {
    const { failFirst } = await p193Server();
    // (a) The full definition registers under its id and renders its criteria.
    expect(
      await failFirst({
        ...PLAIN_193,
        gates: [{ id: 'rq203', name: 'rq203', description: 'd', criteria: ['X-203'] }],
      })
    ).toMatchObject({
      reviews: { a: ['rq203', 'content-structure'] },
      failShown: ['Use clear headings', 'X-203'],
    });
    // (b) Control: a `{name, description}` quick gate still registers as one, under a minted id.
    expect(
      await failFirst({ ...PLAIN_193, gates: [{ name: 'qk203', description: 'QK-203' }] })
    ).toMatchObject({
      reviews: { a: ['temp', 'content-structure'] },
      failShown: ['Use clear headings', 'QK-203'],
    });
  }, 240000);

  /**
   * P6.158. MEASURED 2026-09-27 on `7b2e30ce` with `gates.executeInlineGateDefinitions` on (and
   * off): the bundled `research_chain` declares `Source Citations` in the CHAIN prompt's own
   * `inline_gate_definitions` and names it on step 2 (`inlineGateIds`), but only a STEP prompt's
   * definitions ever registered, so no step-2 review named it — bare or as a remainder;
   * `tech_evaluation_chain`'s `Verified Claims` likewise. Now the projection carries a chain-defined
   * name as a reference into the chain prompt, and gate enhancement registers that definition for
   * the step naming it. Phase guards are off so the review is the gate review, not the structural
   * one the bundled steps' CAGEERF sections would open first.
   */
  async function definitionsServer(): Promise<{ roots: Roots; server: Server }> {
    const roots = freshRoots();
    writeFileSync(
      path.join(roots.workspace, 'config.json'),
      JSON.stringify({
        gates: { executeInlineGateDefinitions: true },
        phaseGuards: { mode: 'off', maxRetries: 2 },
      })
    );
    const server = await startServer(roots);
    await authorResources(server);
    return { roots, server };
  }

  test("P6.158 (a) a bare chain prompt's step 2 review names the gate its own definitions declare", async () => {
    const { roots, server } = await definitionsServer();
    const chainId = chainIdOf(
      (await server.call('prompt_engine', { command: '>>research_chain topic:"caching"' })).text
    );
    await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'scan out',
      gate_verdict: FAIL,
    });
    // Step 1 does not name it, so it opens no review of it.
    expect(runRow(roots, chainId)?.reviews['initial-scan-step-1-of-4']).not.toContain(
      'source-citations'
    );
    await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'scan fixed',
      gate_verdict: PASS,
    });
    const failed = await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'deep out',
      gate_verdict: FAIL,
    });
    expect(Object.keys(runRow(roots, chainId)?.reviews ?? {})).toEqual([
      'deep-investigation-step-2-of-4',
    ]);
    expect(runRow(roots, chainId)?.reviews['deep-investigation-step-2-of-4']).toContain(
      'source-citations'
    );
    expect(failed.text).toContain('Source Citations');
  }, 180000);

  test('P6.158 (b) the same chain prompt as a remainder reviews the gate on its step 2', async () => {
    const { roots, server } = await definitionsServer();
    const chainId = chainIdOf(
      (await server.call('prompt_engine', { command: `>>sv_a${ARROW}>>sv_b` })).text
    );
    await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'A out',
      observations: [
        { type: 'unknown_discovered', id: 'u158', statement: 'the rest', blocking: true },
      ],
    });
    const appended = await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'investigated',
      remainder: {
        mode: 'append',
        nodes: [{ id: 'r1', promptId: 'research_chain', args: { topic: 'caching' } }],
      },
    });
    expect(appended.isError).toBe(false);
    await server.call('prompt_engine', { chain_id: chainId, user_response: 'B out' });
    await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'scan out',
      gate_verdict: PASS,
    });
    const failed = await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'deep out',
      gate_verdict: FAIL,
    });
    const reviews = runRow(roots, chainId)?.reviews ?? {};
    expect(Object.keys(reviews)).toEqual(['r1-deep-investigation-step-2-of-4']);
    expect(reviews['r1-deep-investigation-step-2-of-4']).toContain('source-citations');
    expect(failed.text).toContain('Source Citations');
  }, 180000);

  test('P6.130 (a) after a claim the projection holds exactly the claimer row for the run', async () => {
    const roots = freshRoots();
    const { chainId, first, second } = await claimOnSecondServer(roots, { command: '>>sv_chain' });
    expect(first.pid).not.toBe(second.pid);
    expect(projectionRows(roots, chainId)).toEqual([{ pid: second.pid, step: 2 }]);

    // (c) A later startup's stale-PID cleanup finds nothing left to delete for the run.
    const third = await startServer(roots);
    expect(third.pid).not.toBe(second.pid);
    expect(projectionRows(roots, chainId)).toEqual([{ pid: second.pid, step: 2 }]);
  }, 180000);

  test('P6.130 (d) control: two live servers each running their own run keep both rows', async () => {
    const roots = freshRoots();
    const first = await startServer(roots);
    await authorResources(first);
    const second = await startServer(roots);
    const firstChain = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain' })).text
    );
    const secondChain = chainIdOf(
      (await second.call('prompt_engine', { command: '>>sv_chain' })).text
    );
    // R62: one chain-id space per database, so the second server's run is `#2`, not a second `#1`.
    expect([firstChain, secondChain]).toEqual(['chain-sv_chain#1', 'chain-sv_chain#2']);
    await second.call('prompt_engine', {
      chain_id: secondChain,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(projectionRows(roots, firstChain)).toEqual([{ pid: first.pid, step: 1 }]);
    expect(projectionRows(roots, secondChain)).toEqual([{ pid: second.pid, step: 2 }]);
  }, 180000);

  /** Every `chain_runs` row: chain id, owner PID and the node it stands at, ordered by chain id. */
  function runRows(roots: Roots): Array<{ chainId: string; pid: string; node: string }> {
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      const rows = db
        .prepare(
          'SELECT chain_id, run_owner_pid, current_node_id FROM chain_runs ORDER BY chain_id, created_at'
        )
        .all() as Array<{ chain_id: string; run_owner_pid: string; current_node_id: string }>;
      return rows.map((row) => ({
        chainId: row.chain_id,
        pid: row.run_owner_pid,
        node: row.current_node_id,
      }));
    } finally {
      db.close();
    }
  }

  test('P6.142 (a) two live servers on one database mint distinct chain ids for their runs', async () => {
    const roots = freshRoots();
    const first = await startServer(roots);
    await authorResources(first);
    const second = await startServer(roots);
    const firstChain = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain' })).text
    );
    const secondChain = chainIdOf(
      (await second.call('prompt_engine', { command: '>>sv_chain' })).text
    );
    const thirdChain = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain' })).text
    );
    expect([firstChain, secondChain, thirdChain]).toEqual([
      'chain-sv_chain#1',
      'chain-sv_chain#2',
      'chain-sv_chain#3',
    ]);
    expect(runRows(roots)).toEqual([
      { chainId: 'chain-sv_chain#1', pid: first.pid, node: 'a' },
      { chainId: 'chain-sv_chain#2', pid: second.pid, node: 'a' },
      { chainId: 'chain-sv_chain#3', pid: first.pid, node: 'a' },
    ]);

    // Each id resumes its own run: the second server's resume moves `#2` only.
    await second.call('prompt_engine', {
      chain_id: secondChain,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(runRows(roots).map((row) => row.node)).toEqual(['a', 'b', 'a']);
  }, 180000);

  test('P6.142 (b) control: one server numbers its second run #2', async () => {
    const roots = freshRoots();
    const server = await startServer(roots);
    await authorResources(server);
    const first = chainIdOf((await server.call('prompt_engine', { command: '>>sv_chain' })).text);
    const second = chainIdOf((await server.call('prompt_engine', { command: '>>sv_chain' })).text);
    expect([first, second]).toEqual(['chain-sv_chain#1', 'chain-sv_chain#2']);
  }, 180000);

  test('P6.142 (c) a claim of a run whose chain id the claiming server holds for another run is refused by name', async () => {
    const roots = freshRoots();
    const first = await startServer(roots);
    await authorResources(first);
    const handedOff = chainIdOf(
      (await first.call('prompt_engine', { command: '>>sv_chain' })).text
    );
    const minted = await first.call('prompt_engine', { chain_id: handedOff, handoff: true });
    const token = /Token: `(hnd_[^`]+)`/.exec(minted.text)?.[1];
    if (token === undefined) throw new Error(`no token in: ${minted.text}`);
    const second = await startServer(roots);
    const held = chainIdOf((await second.call('prompt_engine', { command: '>>sv_chain' })).text);
    expect([handedOff, held]).toEqual(['chain-sv_chain#1', 'chain-sv_chain#2']);
    await first.stop();

    // Fixture: the handed-off row as a pre-R62 server minted it, colliding with the claimer's run.
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      db.prepare('UPDATE chain_runs SET chain_id = ? WHERE chain_id = ?').run(held, handedOff);
    } finally {
      db.close();
    }

    const claimed = await second.call('prompt_engine', {
      claim_token: token,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(claimed.isError).toBe(true);
    expect(claimed.text).toContain(
      'this server already runs a different run under `chain-sv_chain#2`'
    );
    // Refused before the transfer: the run stays with its first owner, and the claimer's own run
    // still answers its chain id.
    expect(runRows(roots)).toEqual([
      { chainId: 'chain-sv_chain#2', pid: first.pid, node: 'a' },
      { chainId: 'chain-sv_chain#2', pid: second.pid, node: 'a' },
    ]);
    const resumed = await second.call('prompt_engine', {
      chain_id: held,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(resumed.text).toContain('Progress 2/3');
  }, 180000);

  /**
   * P6.204 / R104. A run recorded before #414 could hold a named gate under a canonical id. Driven
   * by planting one: server A runs `>>sv_chain :: g204:"NAMED-204"`, the recorded `g204` is
   * rewritten to `content-structure` in every run table, and B claims the run with a FAIL.
   * MEASURED 2026-09-27 on `001f35be`: the claim answered `isError: true` with the registry's raw
   * "Error: A temporary gate may not shadow a canonical gate id ('content-structure')", and the
   * run stayed on step a. The claim's named-gate restore already remaps a held id to a fresh
   * `<id>-N` (R60); a canonical id is now held by its canonical gate, so it takes the same path.
   */
  async function claimPlantedCanonical(
    roots: Roots,
    plantedId: string,
    start: { args: Record<string, unknown>; recordedId: string; reviews: string[] } = {
      args: { command: '>>sv_chain :: g204:"NAMED-204"' },
      recordedId: 'g204',
      reviews: ['sv-block', 'g204'],
    }
  ): Promise<{ chainId: string; second: Server; failed: { isError: boolean; text: string } }> {
    const first = await startServer(roots);
    await authorResources(first);
    const chainId = chainIdOf((await first.call('prompt_engine', start.args)).text);
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: start.reviews });
    const token = await mintToken(first, chainId);
    const second = await startServer(roots);
    await first.stop();
    const db = new DatabaseSync(path.join(roots.runtimeRoot, 'runtime-state', 'state.db'));
    try {
      for (const table of ['chain_runs', 'chain_run_nodes', 'chain_sessions']) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
          type: string;
        }>;
        for (const { name } of columns.filter((column) => column.type === 'TEXT')) {
          db.prepare(`UPDATE ${table} SET ${name} = REPLACE(${name}, ?, ?)`).run(
            start.recordedId,
            plantedId
          );
        }
      }
    } finally {
      db.close();
    }
    const failed = await second.call('prompt_engine', {
      claim_token: token,
      user_response: 'A out',
      gate_verdict: FAIL,
    });
    return { chainId, second, failed };
  }

  test('P6.204 (a) a claimed run recorded with a canonical-named gate restores it under a fresh id', async () => {
    const roots = freshRoots();
    const { chainId, failed } = await claimPlantedCanonical(roots, 'content-structure');
    expect(failed.isError).toBe(false);
    expect(failed.text).toContain('NAMED-204');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'content-structure-2'] });
  }, 180000);

  test('P6.204 (b) control: a planted id with no canonical gate restores under itself', async () => {
    const roots = freshRoots();
    const { chainId, failed } = await claimPlantedCanonical(roots, 'x204');
    expect(failed.isError).toBe(false);
    expect(failed.text).toContain('NAMED-204');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['sv-block', 'x204'] });
  }, 180000);

  /**
   * P6.213 / R110. A run recorded before the canonical-id refusal can hold a REQUEST gate under a
   * canonical id; a claim hands it back to stage 11 (`parsedCommand.requestGates`), whose registry
   * refuses the id. MEASURED 2026-09-28 on `e824fbd6`: the claim answered `isError:false`, the
   * recorded REQ-213 was gone, and the review rendered the CANONICAL `content-structure`
   * guidelines in its place under the recorded id. Now the restore hands it back under
   * `content-structure-2` and the run's reviews follow through `remapRunGates`.
   */
  const REQUEST_213 = {
    args: { command: '>>sv_chain', gates: [{ id: 'rq213', criteria: ['REQ-213'] }] },
    recordedId: 'rq213',
    reviews: ['rq213', 'sv-block'],
  };

  test('P6.213 (a) a claimed run recorded with a canonical-named request gate restores it under a fresh id', async () => {
    const roots = freshRoots();
    const { chainId, failed } = await claimPlantedCanonical(
      roots,
      'content-structure',
      REQUEST_213
    );
    expect(failed.isError).toBe(false);
    expect(failed.text).toContain('REQ-213');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['content-structure-2', 'sv-block'] });
  }, 180000);

  test('P6.213 (b) control: a planted request gate id with no canonical gate restores under itself', async () => {
    const roots = freshRoots();
    const { chainId, failed } = await claimPlantedCanonical(roots, 'x213', REQUEST_213);
    expect(failed.isError).toBe(false);
    expect(failed.text).toContain('REQ-213');
    expect(runRow(roots, chainId)?.reviews).toEqual({ a: ['x213', 'sv-block'] });
  }, 180000);

  test('P6.130 (b) control: an unclaimed run keeps its one row', async () => {
    const roots = freshRoots();
    const server = await startServer(roots);
    await authorResources(server);
    const chainId = chainIdOf((await server.call('prompt_engine', { command: '>>sv_chain' })).text);
    expect(projectionRows(roots, chainId)).toEqual([{ pid: server.pid, step: 1 }]);
    await server.call('prompt_engine', {
      chain_id: chainId,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(projectionRows(roots, chainId)).toEqual([{ pid: server.pid, step: 2 }]);
  }, 180000);
});
