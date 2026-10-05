// @lifecycle test - P6.274 / R170: an answer is graded before the run advances, so a PASS verdict on a step whose answer fails its phase guard holds the run on that step, over Streamable HTTP.
/**
 * MEASURED 2026-09-29 on `23e11f9e5` (P6.274 drive, attempt 1): a run of three default-gated
 * prompts under the shipped CAGEERF, step 1 answered in full with a PASS, step 2 answered with no
 * sections and a PASS. The reply carried step 2's structural review AND step 3's render, and the
 * run stood on `n3` with `{n2: [__phase_guard__]}` open: stage 16 closed the gate review and
 * advanced on the PASS, stage 18 rendered step 3, and only then did stage 19 grade step 2's
 * answer. One retry closed the review and also completed step 3 — two steps for one answer.
 *
 * Now (R170) stage 16 takes the phase guard's grade (`PhaseGuardVerificationStage.gradeAnswer`,
 * wired by the pipeline builder) before it decides the advance. A failing grade holds the run on
 * the answered step whatever the verdict said; stage 19 opens the structural review from the same
 * grade and never grades again. Every leg reads the reply, then the run's own row.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import { cageerfAnswer } from './helpers/cageerf-answer.js';
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
/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
const UNGATED = { exclude: ['content-structure'], framework_gates: false };
const SECTIONLESS = 'plain sectionless answer';
const STRUCTURAL = 'Structural Review Required';
/** The line the phase guard's grader logs once per evaluation (R170). */
const GRADED = '[PhaseGuardVerification] Graded the answer';
/**
 * A hook's `pending_gate` on every read path for a run on step 2 with no review open (the PASS on
 * step 1 closed its review), measured 2026-10-04 (P6.20).
 */
const HOOK_REVIEW_NONE = { view: null, sessionTable: null, loader: null };
/** The same, once step 2 is held by its structural review. */
const HOOK_REVIEW_HELD = {
  view: '__phase_guard__',
  sessionTable: '__phase_guard__',
  loader: '__phase_guard__',
};

interface RunRow {
  current: string | null;
  reviews: Record<string, string[]>;
}

const withStateDb = <T>(runtimeRoot: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'));
  try {
    return read(db);
  } finally {
    db.close();
  }
};

/** The run's current node and its open reviews (gate ids per node), read from its own row. */
const readRun = (runtimeRoot: string, chainId: string): RunRow =>
  withStateDb(runtimeRoot, (db) => {
    const row = db
      .prepare('SELECT state, current_node_id FROM chain_runs WHERE chain_id = ?')
      .get(chainId) as { state: string; current_node_id: string | null } | undefined;
    if (row === undefined) throw new Error(`no run for ${chainId}`);
    const state = JSON.parse(row.state) as { reviews?: Record<string, { gateIds: string[] }> };
    return {
      current: row.current_node_id,
      reviews: Object.fromEntries(
        Object.entries(state.reviews ?? {}).map(([nodeId, review]) => [nodeId, review.gateIds])
      ),
    };
  });

/** The directory the Python hooks import from: `db_reader` is what a hook calls. */
const HOOKS_LIB = path.join(SERVER_ROOT, '..', 'hooks', 'lib');

/** What `db_reader` returns for a held run, by read path (P6.20). */
interface HookView {
  view: Record<string, unknown> | null;
  sessionTable: Record<string, unknown> | null;
  loader: Record<string, unknown> | null;
}

/**
 * The run as a hook sees it (P6.20, R193): `db_reader`'s two read paths, each called on its own,
 * and the public loader over them. Read separately because the loader falls back from the view to
 * the session table, so a view that lost its column would still read correct through the loader.
 * The server process is alive, so its rows pass the loader's owner check.
 */
const readHookView = (runtimeRoot: string, chainId: string): HookView => {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(HOOKS_LIB)})`,
    'import db_reader',
    'chain_id = sys.argv[1]',
    'conn = db_reader._connect_readonly()',
    'view = db_reader._load_from_execution_view(conn, chain_id)',
    'table = db_reader._load_from_session_table(conn, chain_id)',
    'conn.close()',
    'loader = db_reader.load_active_chain_state(chain_id)',
    'print(json.dumps({"view": view, "sessionTable": table, "loader": loader}))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script, chainId], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      MCP_RUNTIME_ROOT: runtimeRoot,
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  if (result.status !== 0) throw new Error(`hook read failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as HookView;
};

/** The review-derived fields of each read path, as one value. */
const hookReviews = (view: HookView): Record<keyof HookView, unknown> => ({
  view: view.view?.['pending_gate'],
  sessionTable: view.sessionTable?.['pending_gate'],
  loader: view.loader?.['pending_gate'],
});

/** Whether each of `db_reader`'s read paths returns the run at all (P6.1). */
const hookSees = (view: HookView): Record<keyof HookView, boolean> => ({
  view: view.view !== null,
  sessionTable: view.sessionTable !== null,
  loader: view.loader !== null,
});

/**
 * An unfinished run as its own row and every hook read path see it, then the same run once its
 * last step is answered (P6.1): `isRunComplete` decides "finished" for the projection the hooks
 * read, and `chain_runs.run_status` is NOT NULL, so there is no unset fourth phase to default.
 */
const UNFINISHED_THEN_FINISHED = {
  unfinished: { status: 'working', seen: { view: true, sessionTable: true, loader: true } },
  finished: { status: 'completed', seen: { view: false, sessionTable: false, loader: false } },
};

/** The run's `run_status`, read from its own row. */
const readRunStatus = (runtimeRoot: string, chainId: string): string =>
  withStateDb(runtimeRoot, (db) => {
    const row = db.prepare('SELECT run_status FROM chain_runs WHERE chain_id = ?').get(chainId) as
      { run_status: string } | undefined;
    if (row === undefined) throw new Error(`no run for ${chainId}`);
    return row.run_status;
  });

/** The fixture every twin shares: three gated steps g1..g3 and three ungated steps u1..u3. */
const authorFixtures = async (
  tool: (name: string, args: Record<string, unknown>) => Promise<{ isError: boolean; text: string }>
): Promise<void> => {
  const author = async (args: Record<string, unknown>): Promise<void> => {
    const result = await tool('resource_manager', args);
    if (result.isError) throw new Error(result.text);
  };
  for (const id of ['g1', 'g2', 'g3']) {
    await author({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: id,
      description: `e2e gated step ${id}`,
      user_message_template: `BODY-${id}`,
    });
  }
  for (const id of ['u1', 'u2', 'u3']) {
    await author({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: id,
      description: `e2e ungated step ${id}`,
      user_message_template: `BODY-${id}`,
      gate_configuration: UNGATED,
    });
  }
};

describe('Streamable HTTP: an answer is graded before the run advances (P6.274, R170)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
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

  const withDb = <T>(read: (db: DatabaseSync) => T): T => withStateDb(runtimeRoot, read);

  const run = (chainId: string): RunRow => readRun(runtimeRoot, chainId);

  /**
   * Each node's answer flags, in run order: responded, completed. `rendered_at` is left out: it is
   * written only by a render that records declared sections, so it is not a render marker.
   */
  const nodes = (chainId: string): Record<string, [number, number]> =>
    withDb((db) => {
      const rows = db
        .prepare(
          'SELECT n.node_id, n.responded_at IS NOT NULL AS a, n.completed_at IS NOT NULL AS d ' +
            'FROM chain_run_nodes n JOIN chain_runs c ON c.session_id = n.session_id ' +
            'WHERE c.chain_id = ? ORDER BY n.position'
        )
        .all(chainId) as Array<{ node_id: string; a: number; d: number }>;
      return Object.fromEntries(rows.map((row) => [row.node_id, [row.a, row.d]]));
    });

  /** The step's ledger rows, oldest first: status and the verdicts it recorded. */
  const records = (chainId: string, nodeId: string) =>
    withDb(
      (db) =>
        db
          .prepare(
            'SELECT status, gate_verdicts_json AS verdicts FROM execution_records ' +
              'WHERE chain_id = ? AND node_id = ? ORDER BY execution_id'
          )
          .all(chainId, nodeId) as Array<{ status: string; verdicts: string }>
    );

  const logPath = () => path.join(runtimeRoot, 'logs', 'mcp-server.log');
  const gradedLines = (): number =>
    existsSync(logPath())
      ? readFileSync(logPath(), 'utf8')
          .split('\n')
          .filter((line) => line.includes(GRADED)).length
      : 0;
  /** Evaluations one call made: the log grows asynchronously, so wait for it to settle. */
  const evaluationsDuring = async (call: () => Promise<unknown>): Promise<number> => {
    const before = gradedLines();
    await call();
    let seen = gradedLines();
    for (let settled = 0; settled < 5;) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const now = gradedLines();
      settled = now === seen ? settled + 1 : 0;
      seen = now;
    }
    return seen - before;
  };

  const start = async (command: string): Promise<{ chainId: string; text: string }> => {
    const result = await tool('prompt_engine', { command });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(result.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${result.text}`);
    return { chainId, text: result.text };
  };
  const answer = (chainId: string, userResponse: string, verdict?: string) =>
    tool('prompt_engine', {
      chain_id: chainId,
      user_response: userResponse,
      ...(verdict !== undefined ? { gate_verdict: verdict } : {}),
    });

  /** A gated run standing on step 2, with step 1 answered in full and PASSed. */
  const gatedRunAtStep2 = async (): Promise<string> => {
    const { chainId } = await start(['>>g1', '>>g2', '>>g3'].join(ARROW));
    await answer(chainId, cageerfAnswer('step one'), PASS);
    expect(run(chainId).current).toBe('n2');
    return chainId;
  };

  beforeAll(async () => {
    const roots = createHermeticRoots('grade-before-advance-e2e');
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
    client = new ModernMcpClient(baseUrl, 'grade-before-advance-e2e');

    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('(a) a PASS on a step whose answer fails its phase guard holds the run on that step', async () => {
    const chainId = await gatedRunAtStep2();

    const reply = await answer(chainId, SECTIONLESS, PASS);

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(STRUCTURAL);
    expect(reply.text).toContain('BODY-g2');
    expect(reply.text).not.toContain('BODY-g3');
    // The run stands on the answered step, held by its structural review alone: the gate review
    // the PASS closed is not reopened, so the PASS stands.
    expect(run(chainId)).toEqual({ current: 'n2', reviews: { n2: ['__phase_guard__'] } });
    expect(nodes(chainId)).toEqual({ n1: [1, 1], n2: [1, 1], n3: [0, 0] });
    expect(records(chainId, 'n2').map((row) => row.status)).toEqual(['working', 'completed']);
  });

  test('(b) the retry closes the structural review and advances exactly one step', async () => {
    const chainId = await gatedRunAtStep2();
    await answer(chainId, SECTIONLESS, PASS);

    const retry = await answer(chainId, cageerfAnswer('step two again'), PASS);

    expect(retry.isError).toBe(false);
    expect(retry.text).toContain('BODY-g3');
    expect(retry.text).not.toContain('BODY-g2');
    expect(retry.text).not.toContain(STRUCTURAL);
    expect(run(chainId)).toEqual({ current: 'n3', reviews: {} });
    // Step 3 is shown, not answered.
    expect(nodes(chainId)).toEqual({ n1: [1, 1], n2: [1, 1], n3: [0, 0] });
  });

  test('(c) control: a PASS on a conforming answer advances as before', async () => {
    const chainId = await gatedRunAtStep2();

    const reply = await answer(chainId, cageerfAnswer('step two'), PASS);

    expect(reply.text).toContain('BODY-g3');
    expect(reply.text).not.toContain(STRUCTURAL);
    expect(run(chainId)).toEqual({ current: 'n3', reviews: {} });
  });

  test("(e) the held step's review is what a hook reads, on both of db_reader's paths (P6.20)", async () => {
    const chainId = await gatedRunAtStep2();
    // Positive control: the same probe reads no review before the hold, so it can tell them apart.
    const before = hookReviews(readHookView(runtimeRoot, chainId));

    await answer(chainId, SECTIONLESS, PASS);

    expect(before).toEqual(HOOK_REVIEW_NONE);
    expect(hookReviews(readHookView(runtimeRoot, chainId))).toEqual(HOOK_REVIEW_HELD);
    expect(readHookView(runtimeRoot, chainId).loader?.['current_step']).toBe(2);
  });

  test('(g) a hook reads an unfinished run on every path and a finished one on none (P6.1)', async () => {
    const { chainId } = await start(['>>u1', '>>u2'].join(ARROW));
    await answer(chainId, SECTIONLESS);
    const unfinished = {
      status: readRunStatus(runtimeRoot, chainId),
      seen: hookSees(readHookView(runtimeRoot, chainId)),
    };

    await answer(chainId, SECTIONLESS);

    const finished = {
      status: readRunStatus(runtimeRoot, chainId),
      seen: hookSees(readHookView(runtimeRoot, chainId)),
    };
    expect({ unfinished, finished }).toEqual(UNFINISHED_THEN_FINISHED);
  });

  test('(d) control: an ungated step answered with no sections advances as before', async () => {
    const { chainId } = await start(['>>u1', '>>u2', '>>u3'].join(ARROW));
    await answer(chainId, SECTIONLESS);
    expect(run(chainId).current).toBe('n2');

    const reply = await answer(chainId, SECTIONLESS);

    expect(reply.text).toContain('BODY-u3');
    expect(reply.text).not.toContain(STRUCTURAL);
    expect(run(chainId)).toEqual({ current: 'n3', reviews: {} });
  });

  test('(f) the answer is evaluated once per call, and a first render evaluates nothing', async () => {
    let chainId = '';
    const onStart = await evaluationsDuring(async () => {
      chainId = (await start(['>>g1', '>>g2', '>>g3'].join(ARROW))).chainId;
    });
    // Positive control for the probe: an answered call is seen to evaluate.
    const onAnswer = await evaluationsDuring(() => answer(chainId, SECTIONLESS, PASS));

    expect({ onStart, onAnswer }).toEqual({ onStart: 0, onAnswer: 1 });
    expect(run(chainId)).toEqual({ current: 'n1', reviews: { n1: ['__phase_guard__'] } });
  });
});

describe('STDIO: an answer is graded before the run advances (P6.303, R170 transport parity)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let runtimeRoot: string;
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

  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = (await request('tools/call', { name, arguments: args })) as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  const run = (chainId: string): RunRow => readRun(runtimeRoot, chainId);
  const start = async (command: string): Promise<string> => {
    const result = await tool('prompt_engine', { command });
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(result.text)?.[1];
    if (chainId === undefined) throw new Error(`no chain id in: ${result.text}`);
    return chainId;
  };
  const answer = (chainId: string, userResponse: string, verdict?: string) =>
    tool('prompt_engine', {
      chain_id: chainId,
      user_response: userResponse,
      ...(verdict !== undefined ? { gate_verdict: verdict } : {}),
    });
  const gatedRunAtStep2 = async (): Promise<string> => {
    const chainId = await start(['>>g1', '>>g2', '>>g3'].join(ARROW));
    await answer(chainId, cageerfAnswer('step one'), PASS);
    expect(run(chainId).current).toBe('n2');
    return chainId;
  };

  beforeAll(async () => {
    const roots = createHermeticRoots('grade-before-advance-stdio-e2e');
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
      clientInfo: { name: 'grade-before-advance-stdio-e2e', version: '1.0.0' },
    });
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('(a) over STDIO a PASS on a step whose answer fails its phase guard holds the run on that step', async () => {
    const chainId = await gatedRunAtStep2();

    const reply = await answer(chainId, SECTIONLESS, PASS);

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(STRUCTURAL);
    expect(reply.text).toContain('BODY-g2');
    expect(reply.text).not.toContain('BODY-g3');
    expect(run(chainId)).toEqual({ current: 'n2', reviews: { n2: ['__phase_guard__'] } });
  });

  test('(b) over STDIO the retry advances exactly one step', async () => {
    const chainId = await gatedRunAtStep2();
    await answer(chainId, SECTIONLESS, PASS);

    const retry = await answer(chainId, cageerfAnswer('step two again'), PASS);

    expect(retry.isError).toBe(false);
    expect(retry.text).toContain('BODY-g3');
    expect(retry.text).not.toContain('BODY-g2');
    expect(retry.text).not.toContain(STRUCTURAL);
    expect(run(chainId)).toEqual({ current: 'n3', reviews: {} });
  });

  test("(d) over STDIO the held step's review is what a hook reads, on both paths (P6.20)", async () => {
    const chainId = await gatedRunAtStep2();
    const before = hookReviews(readHookView(runtimeRoot, chainId));

    await answer(chainId, SECTIONLESS, PASS);

    expect(before).toEqual(HOOK_REVIEW_NONE);
    expect(hookReviews(readHookView(runtimeRoot, chainId))).toEqual(HOOK_REVIEW_HELD);
    expect(readHookView(runtimeRoot, chainId).loader?.['current_step']).toBe(2);
  });

  test('(e) over STDIO a hook reads an unfinished run on every path and a finished one on none (P6.1)', async () => {
    const chainId = await start(['>>u1', '>>u2'].join(ARROW));
    await answer(chainId, SECTIONLESS);
    const unfinished = {
      status: readRunStatus(runtimeRoot, chainId),
      seen: hookSees(readHookView(runtimeRoot, chainId)),
    };

    await answer(chainId, SECTIONLESS);

    const finished = {
      status: readRunStatus(runtimeRoot, chainId),
      seen: hookSees(readHookView(runtimeRoot, chainId)),
    };
    expect({ unfinished, finished }).toEqual(UNFINISHED_THEN_FINISHED);
  });

  test('(c) control over STDIO: a PASS on a conforming answer advances', async () => {
    const chainId = await gatedRunAtStep2();

    const reply = await answer(chainId, cageerfAnswer('step two'), PASS);

    expect(reply.text).toContain('BODY-g3');
    expect(reply.text).not.toContain(STRUCTURAL);
    expect(run(chainId)).toEqual({ current: 'n3', reviews: {} });
  });
});
