// @lifecycle test - Row 4.1: the three resolution branches of a blocking-unknown interrupt, each to a terminal record.
/**
 * OQ-1's ORIGINAL close condition, driven whole:
 *
 *   1. blocking discovery → SOFT interrupt → answer the step → run finishes
 *   2. blocking discovery with `budget.pauseOnBlocking` → PAUSED → `gate_action:'resume'`
 *   3. blocking discovery with `budget.pauseOnBlocking` → PAUSED → `accept_alternative` + remainder
 *
 * WHAT THIS ADDS OVER `unknown-interrupt-flow.integration.test.ts`, which already exercises each
 * mechanism: that file stops at the state change. This one carries each branch to the run's
 * TERMINAL RECORD and reads the D-8 counters (`interrupts_raised`, `remainders_accepted`) out of
 * real SQLite. Those columns are the only durable statement that any of this happened —
 * `chain_runs`, `chain_run_nodes` and the ledger are all ephemeral and PID-deleted — so a branch
 * that works in memory and stamps a NULL is a branch whose evidence is gone by the next boot.
 *
 * The counters are asserted per branch with DIFFERENT expected values, not merely as non-zero:
 * branch 2 must show an interrupt and NO remainder, branch 3 must show both. A single
 * "> 0" assertion would pass against a writer that stamped the same constant everywhere, which is
 * the failure mode `execution_records` has already produced twice (see the v21/v23 DDL notes).
 *
 * PLACEMENT — integration, not `tests/e2e/`, and the row permits either. Two reasons, both
 * measured: the assertion is on DB rows, and an e2e drive over HTTP cannot read the server's
 * `execution_records` without reaching into its SQLite file from outside the transport; and every
 * conformance-style e2e run currently writes seven prompt directories into the repo tree
 * (plan row 6.1), so an e2e placement would add a test nobody can run twice locally. The
 * on-the-wire half of this feature is covered by `scripts/verify-unknown-interrupt.mjs`, which
 * drives a built `dist/` over Streamable HTTP.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';

import { RemainderProcessor } from '../../../src/engine/execution/capture/remainder-processor.js';
import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/index.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../src/engine/execution/pipeline/decisions/index.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { DEFAULT_WORKFLOW_CAPS } from '../../../src/modules/workflow-ir/node-schema.js';
import { validateWorkflowIR } from '../../../src/modules/workflow-ir/validator.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainNode } from '../../../src/shared/types/chain-execution.js';
import type { McpToolRequest } from '../../../src/shared/types/execution.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const PROMPTS = [
  { id: 'draft', arguments: [] },
  { id: 'body', arguments: [] },
  { id: 'review', arguments: [] },
  { id: 'investigate_unknown', arguments: [] },
] as unknown as ConvertedPrompt[];

const NODES: ChainNode[] = [
  { id: 'draft-outline', promptId: 'draft', stepName: 'Draft' },
  { id: 'write-body', promptId: 'body', stepName: 'Body' },
  { id: 'final-review', promptId: 'review', stepName: 'Review' },
];

const BLOCKING = {
  type: 'unknown_discovered' as const,
  id: 'cache-ttl',
  statement: 'TTL for the new cache layer is undecided',
  blocking: true,
  target_step_id: 'final-review',
};

/** `execution_records` as `sqlite-engine.ts` declares it. Drift shows up here as a SQL error. */
const createInMemoryDb = (): { db: DatabaseSync; port: DatabasePort } => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE execution_records (
      execution_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      organization_id TEXT,
      workspace_id TEXT,
      session_id TEXT NOT NULL,
      chain_id TEXT,
      step_number INTEGER,
      node_id TEXT,
      prompt_id TEXT,
      status TEXT NOT NULL,
      substate_json TEXT,
      input_required_json TEXT,
      evidence_json TEXT,
      gate_verdicts_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      steps_planned INTEGER,
      gates_fired INTEGER,
      gate_retries INTEGER,
      unknowns_opened INTEGER,
      unknowns_closed INTEGER,
      nodes_inserted INTEGER,
      nodes_skipped INTEGER,
      interrupts_raised INTEGER,
      remainders_accepted INTEGER,
      delegation_skipped INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const port: DatabasePort = {
    isInitialized: () => true,
    initialize: async () => undefined,
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] =>
      db.prepare(sql).all(...((params ?? []) as never[])) as T[],
    queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null =>
      (db.prepare(sql).get(...((params ?? []) as never[])) ?? null) as T | null,
    run: (sql: string, params?: unknown[]): void => {
      db.prepare(sql).run(...((params ?? []) as never[]));
    },
    transaction: async <T>(fn: () => T | Promise<T>): Promise<T> => fn(),
    beginTransaction: () => db.exec('BEGIN'),
    commit: () => db.exec('COMMIT'),
    rollback: () => db.exec('ROLLBACK'),
  };

  return { db, port };
};

describe('row 4.1 — the three branches of a blocking-unknown interrupt', () => {
  let db: DatabaseSync;
  let recordStore: ExecutionRecordStore;
  let store: ChainSessionStore;
  let persistSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  const SESSION = 'sess-branch';

  const captureStage = (): StepResponseCaptureStage => {
    const logger = createLogger();
    return new StepResponseCaptureStage(
      new GateVerdictProcessor(store, logger),
      new StepCaptureService(store, logger),
      store,
      new UnknownObservationProcessor(store, logger),
      logger,
      {
        remainderProcessor: new RemainderProcessor(
          store,
          { validate: validateWorkflowIR, defaultCaps: DEFAULT_WORKFLOW_CAPS },
          () => PROMPTS,
          logger
        ),
      }
    );
  };

  const context = (request: Partial<McpToolRequest>): ExecutionContext => {
    const built = new ExecutionContext({ chain_id: 'chain-branch#1', ...request });
    built.sessionContext = {
      sessionId: SESSION,
      chainId: 'chain-branch#1',
      isChainExecution: true,
      currentStep: 1,
      currentNodeId: 'draft-outline',
      totalSteps: 3,
    };
    return built;
  };

  /** Drive the run to its terminal record, which is where the D-8 counters are stamped. */
  const finishRun = async (): Promise<void> => {
    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      recordStore,
      store
    );
    const terminal = context({});
    terminal.executionPlan = { strategy: 'chain', gates: [] } as never;
    terminal.executionResults = { content: 'final output' } as never;
    terminal.state.session.chainComplete = true;
    await stage.execute(terminal);
  };

  const counters = (): { interrupts_raised: number; remainders_accepted: number } =>
    db
      .prepare(
        `SELECT interrupts_raised, remainders_accepted FROM execution_records
          WHERE session_id = ? AND completed_at IS NOT NULL
          ORDER BY execution_id DESC LIMIT 1`
      )
      .get(SESSION) as { interrupts_raised: number; remainders_accepted: number };

  const declarePause = async (): Promise<void> => {
    await store.updateSessionBlueprint(SESSION, {
      parsedCommand: { budget: { pauseOnBlocking: true } },
      executionPlan: {},
    } as never);
  };

  beforeEach(async () => {
    const created = createInMemoryDb();
    db = created.db;
    recordStore = new ExecutionRecordStore(created.port, createLogger());

    persistSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'persistSessionsOrThrow')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    store = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as never, {
      serverRoot: '/tmp/test-unknown-interrupt-branches',
      cleanupIntervalMs: 60_000,
    });
    await store.createSession(SESSION, 'chain-branch#1', 3, {}, { nodes: NODES });
  });

  afterEach(async () => {
    await store.cleanup();
    persistSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
    db.close();
  });

  test('branch 1 — blocking → SOFT interrupt → answer the step → the run finishes', async () => {
    const blocked = context({ observations: [BLOCKING] });
    await captureStage().execute(blocked);

    expect(blocked.state.session.chainInterrupt).toMatchObject({
      unknownId: 'cache-ttl',
      paused: false,
    });
    // The soft branch's defining property: nothing holds the run, so the caller's next move is
    // an ordinary step answer rather than a verb.
    expect(store.getPendingGateReview(SESSION)).toBeUndefined();

    const answered = context({ user_response: 'The TTL is 30s; carry on.' });
    await captureStage().execute(answered);
    expect(answered.response?.isError).toBeFalsy();

    await finishRun();
    expect(counters()).toEqual({ interrupts_raised: 1, remainders_accepted: 0 });
  });

  test('branch 2 — blocking with pauseOnBlocking → PAUSED → gate_action:"resume"', async () => {
    await declarePause();
    const blocked = context({ observations: [BLOCKING] });
    await captureStage().execute(blocked);

    expect(blocked.state.session.chainInterrupt?.paused).toBe(true);
    expect(store.getPendingGateReview(SESSION)?.gateIds).toEqual([UNKNOWN_INTERRUPT_GATE_ID]);

    const resumed = context({ gate_action: 'resume' });
    await captureStage().execute(resumed);

    expect(resumed.response?.isError).toBeFalsy();
    expect(store.getPendingGateReview(SESSION)).toBeUndefined();

    await finishRun();
    // An interrupt WITHOUT a remainder. The second number is the control on the first: a writer
    // stamping one constant for both would fail here and pass in branch 3.
    expect(counters()).toEqual({ interrupts_raised: 1, remainders_accepted: 0 });
  });

  test('branch 3 — PAUSED → accept_alternative + remainder → both counters stamped', async () => {
    await declarePause();
    await captureStage().execute(context({ observations: [BLOCKING] }));

    const accepted = context({
      gate_action: 'accept_alternative',
      remainder: {
        mode: 'replace',
        nodes: [{ id: 'confirm-ttl', promptId: 'investigate_unknown', stepName: 'Confirm' }],
      },
    });
    await captureStage().execute(accepted);

    expect(accepted.response?.isError).toBeFalsy();
    expect(store.getPendingGateReview(SESSION)).toBeUndefined();
    expect(store.getSession(SESSION)?.state.nodes.map((node) => node.id)).toEqual([
      'draft-outline',
      'confirm-ttl',
    ]);

    await finishRun();
    expect(counters()).toEqual({ interrupts_raised: 1, remainders_accepted: 1 });
  });

  test('a run with no blocking unknown stamps ZERO on both, not NULL', async () => {
    // The positive control for all three branches. Without it, a writer that bound both columns
    // to a literal 1 would pass every assertion above.
    await finishRun();
    expect(counters()).toEqual({ interrupts_raised: 0, remainders_accepted: 0 });
  });
});
