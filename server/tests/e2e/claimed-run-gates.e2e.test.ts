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

import type { ChildProcess } from 'node:child_process';

const PASS = 'GATE_REVIEW: PASS - ok';
const FAIL = 'GATE_REVIEW: FAIL - the step misses its gate';
const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };
const GATED_COMMAND = '>>sv_chain :: g112:"NAMED-112" :: "ANON-112"';
const REQUEST_GATES = [{ id: 'rq112', name: 'rq112', criteria: ['REQ-112'], target_step_id: 'b' }];
const MARKERS = ['NAMED-112', 'ANON-112', 'REQ-112', 'GUIDANCE-sv-block'];

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

  test('P6.130 (d) control: two live servers each running their own run under one chain id keep both rows', async () => {
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
    // Each process numbers runs from its own memory, so both mint the same id for different runs.
    expect(secondChain).toBe(firstChain);
    await second.call('prompt_engine', {
      chain_id: secondChain,
      user_response: 'A out',
      gate_verdict: PASS,
    });
    expect(projectionRows(roots, firstChain)).toEqual([
      { pid: first.pid, step: 1 },
      { pid: second.pid, step: 2 },
    ]);
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
