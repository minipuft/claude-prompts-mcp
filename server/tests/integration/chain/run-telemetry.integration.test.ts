// @lifecycle test - P2 Tier 6 row 13: run telemetry from session counters to rendered history.
/**
 * The chain of custody for a record-only run telemetry fact, composed from production units:
 *
 *   ChainSessionStore (counters + unknowns ledger)
 *            ↓  getRunTelemetry
 *   ResponseFormattingStage.emitChainTerminalRecord   ← completed / cancelled path
 *   PromptExecutionPipeline.emitFailureRecord         ← failed path
 *            ↓  ExecutionRecordStore.append (real :memory: SQLite)
 *   ExecutionHistoryActionHandler → rendered markdown
 *
 * Both terminal-record writers are driven, not just the happy one. A failed run whose
 * telemetry is silently NULL while a completed run carries it is the exact partial fix this
 * suite exists to reject — so the failure path gets the same assertions, not a smoke check.
 *
 * The DDL below mirrors `execution_records` in sqlite-engine.ts. Drift between the two
 * surfaces here as a SQL error rather than as a silently-swallowed append (the store is
 * best-effort by design and logs rather than throws).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { ExecutionHistoryActionHandler } from '../../../src/mcp/tools/system-control/handlers/execution-history-action-handler.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { SystemControlContext } from '../../../src/mcp/tools/system-control/core/types.js';
import type { PendingGateReview } from '../../../src/shared/types/chain-execution.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const pendingReview = (): PendingGateReview => ({
  combinedPrompt: 'review this',
  gateIds: ['gate-a'],
  prompts: [],
  createdAt: Date.now(),
  attemptCount: 0,
  maxAttempts: 3,
});

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
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const port: DatabasePort = {
    isInitialized: () => true,
    initialize: async () => undefined,
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] => {
      const stmt = db.prepare(sql);
      return stmt.all(...((params ?? []) as never[])) as T[];
    },
    queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null => {
      const stmt = db.prepare(sql);
      return (stmt.get(...((params ?? []) as never[])) ?? null) as T | null;
    },
    run: (sql: string, params?: unknown[]): void => {
      db.prepare(sql).run(...((params ?? []) as never[]));
    },
    transaction: async <T>(fn: () => T | Promise<T>): Promise<T> => {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    beginTransaction: () => db.exec('BEGIN'),
    commit: () => db.exec('COMMIT'),
    rollback: () => db.exec('ROLLBACK'),
  };

  return { db, port };
};

/** Read the telemetry columns straight out of SQLite, not through the store's mapper. */
const readTelemetryRow = (
  db: DatabaseSync,
  sessionId: string
): Record<string, unknown> | undefined =>
  db
    .prepare(
      `SELECT status, steps_planned, gates_fired, gate_retries, unknowns_opened, unknowns_closed,
              nodes_inserted, nodes_skipped
       FROM execution_records
       WHERE session_id = ? AND completed_at IS NOT NULL
       ORDER BY execution_id DESC LIMIT 1`
    )
    .get(sessionId) as Record<string, unknown> | undefined;

const renderHistory = async (recordStore: ExecutionRecordStore): Promise<string> => {
  const handler = new ExecutionHistoryActionHandler({
    executionRecordStore: recordStore,
    createMinimalSystemResponse: (text: string) => ({ content: [{ type: 'text', text }] }),
  } as unknown as SystemControlContext);
  const response = await handler.execute({ operation: 'list' });
  return response.content[0]?.text ?? '';
};

// Stage order accepted by validateStageOrder; only the two named stages do anything.
const stageOrder = [
  'RequestNormalization',
  'ExecutionLifecycle',
  'IdentityResolution',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'JudgeSelection',
  'GateEnhancement',
  'FrameworkResolution',
  'SessionManagement',
  'InjectionControl',
  'PromptGuidance',
  'StepResponseCapture',
  'StepExecution',
  'GateReview',
  'ResponseFormatting',
  'PostFormattingCleanup',
] as const;

describe('run telemetry, session counters through the ledger', () => {
  let db: DatabaseSync;
  let recordStore: ExecutionRecordStore;
  let sessionStore: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  beforeEach(() => {
    const created = createInMemoryDb();
    db = created.db;
    recordStore = new ExecutionRecordStore(created.port, createLogger());

    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    sessionStore = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-run-telemetry-integration',
      cleanupIntervalMs: 1000,
    });
  });

  afterEach(async () => {
    await sessionStore.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
    db.close();
  });

  /** One gate FAIL then PASS, one unknown discovered then resolved, N steps rendered. */
  const driveRunActivity = async (sessionId: string, stepsRendered: number): Promise<void> => {
    await sessionStore.setPendingGateReview(sessionId, pendingReview());
    await sessionStore.recordGateReviewOutcome(sessionId, {
      verdict: 'FAIL',
      rawVerdict: 'GATE_REVIEW: FAIL - needs work',
    });
    await sessionStore.recordGateReviewOutcome(sessionId, {
      verdict: 'PASS',
      rawVerdict: 'GATE_REVIEW: PASS',
    });
    await sessionStore.applyUnknownObservations(sessionId, 'n1', [
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
    ]);
    await sessionStore.applyUnknownObservations(sessionId, 'n2', [
      { type: 'unknown_resolved', id: 'cache-ttl', statement: '30s', resolution: 'answered' },
    ]);

    for (let step = 1; step <= stepsRendered; step += 1) {
      recordStore.append({ sessionId, chainId: 'chain-tel', stepNumber: step, status: 'working' });
    }
  };

  /**
   * One insertion and one skip through the real store operations — no hand-set counters.
   * The run stands at n1, so `n2` is strictly ahead and skippable and the inserted node lands
   * between them.
   */
  const driveMutations = async (sessionId: string): Promise<void> => {
    const inserted = await sessionStore.insertNodeAfter(sessionId, 'n1', {
      stepName: 'Investigate: TTL undecided',
      promptId: 'investigate_unknown',
      origin: 'inserted',
      unknownId: 'cache-ttl',
    });
    expect(inserted).not.toBeNull();
    expect(await sessionStore.markNodeSkipped(sessionId, 'n2', 'cache-ttl')).toBe(true);
  };

  test('a mutated run stamps the P4 counters, values not NULLs, on BOTH terminal writers', async () => {
    // Completed path (21-formatting-stage).
    await sessionStore.createSession('sess-mutated', 'chain-tel', 3);
    await driveRunActivity('sess-mutated', 3);
    await driveMutations('sess-mutated');

    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      recordStore,
      sessionStore
    );
    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = { strategy: 'chain', gates: [] } as any;
    context.sessionContext = {
      sessionId: 'sess-mutated',
      chainId: 'chain-tel',
      isChainExecution: true,
      currentStep: 4,
      totalSteps: 4,
    };
    context.executionResults = { content: 'final output' };
    context.state.session.chainComplete = true;
    await stage.execute(context);

    // Values, not NULLs, and steps_planned reflects the INSERTED node (3 planned + 1).
    expect(readTelemetryRow(db, 'sess-mutated')).toEqual({
      status: 'completed',
      steps_planned: 4,
      gates_fired: 2,
      gate_retries: 1,
      unknowns_opened: 1,
      unknowns_closed: 1,
      nodes_inserted: 1,
      nodes_skipped: 1,
    });

    // Failure path (prompt-execution-pipeline) — the same numbers, on a `failed` row. Wiring
    // only the completed writer is the exact partial fix this suite exists to reject.
    await sessionStore.createSession('sess-mutated-doomed', 'chain-tel', 3);
    await driveRunActivity('sess-mutated-doomed', 2);
    await driveMutations('sess-mutated-doomed');

    const stages: PipelineStage[] = stageOrder.map((name) => {
      if (name === 'SessionManagement') {
        return {
          name,
          execute: async (ctx: ExecutionContext) => {
            ctx.sessionContext = {
              sessionId: 'sess-mutated-doomed',
              chainId: 'chain-tel',
              isChainExecution: true,
              currentStep: 2,
              totalSteps: 4,
            };
          },
        };
      }
      if (name === 'StepExecution') {
        return {
          name,
          execute: async () => {
            throw new Error('render exploded');
          },
        };
      }
      return { name, execute: async () => undefined };
    });

    const pipeline = new PromptExecutionPipeline(stages, {
      logger: createLogger(),
      metricsProvider: () => undefined,
      executionRecordStore: recordStore,
      chainSessionStore: sessionStore,
    });
    await expect(pipeline.execute({ command: '>>chain' })).rejects.toThrow('render exploded');

    expect(readTelemetryRow(db, 'sess-mutated-doomed')).toEqual({
      status: 'failed',
      steps_planned: 4,
      gates_fired: 2,
      gate_retries: 1,
      unknowns_opened: 1,
      unknowns_closed: 1,
      nodes_inserted: 1,
      nodes_skipped: 1,
    });
  });

  test('a completed run stamps every telemetry column on its terminal record', async () => {
    await sessionStore.createSession('sess-done', 'chain-tel', 3);
    await driveRunActivity('sess-done', 3);

    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      recordStore,
      sessionStore
    );

    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
      category: 'analysis',
    } as any;
    context.sessionContext = {
      sessionId: 'sess-done',
      chainId: 'chain-tel',
      isChainExecution: true,
      currentStep: 3,
      totalSteps: 3,
    };
    context.executionResults = { content: 'final output' };
    context.state.session.chainComplete = true;

    await stage.execute(context);

    expect(readTelemetryRow(db, 'sess-done')).toEqual({
      status: 'completed',
      steps_planned: 3,
      gates_fired: 2,
      gate_retries: 1,
      unknowns_opened: 1,
      unknowns_closed: 1,
      nodes_inserted: 0,
      nodes_skipped: 0,
    });
  });

  test('the record agrees with getRunTelemetry — one source, not two', async () => {
    await sessionStore.createSession('sess-agree', 'chain-tel', 3);
    await driveRunActivity('sess-agree', 2);

    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      recordStore,
      sessionStore
    );
    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = { strategy: 'chain', gates: [] } as any;
    context.sessionContext = {
      sessionId: 'sess-agree',
      chainId: 'chain-tel',
      isChainExecution: true,
      currentStep: 3,
      totalSteps: 3,
    };
    context.executionResults = { content: 'final output' };
    context.state.session.chainComplete = true;
    await stage.execute(context);

    const telemetry = sessionStore.getRunTelemetry('sess-agree');
    const row = readTelemetryRow(db, 'sess-agree');
    expect(telemetry).toEqual({
      stepsPlanned: row?.['steps_planned'],
      gatesFired: row?.['gates_fired'],
      gateRetries: row?.['gate_retries'],
      unknownsOpened: row?.['unknowns_opened'],
      unknownsClosed: row?.['unknowns_closed'],
      nodesInserted: row?.['nodes_inserted'],
      nodesSkipped: row?.['nodes_skipped'],
    });
  });

  test('a run that fails mid-chain carries telemetry too, not NULLs', async () => {
    await sessionStore.createSession('sess-doomed', 'chain-tel', 3);
    await driveRunActivity('sess-doomed', 2);

    const stages: PipelineStage[] = stageOrder.map((name) => {
      if (name === 'SessionManagement') {
        return {
          name,
          execute: async (context: ExecutionContext) => {
            context.sessionContext = {
              sessionId: 'sess-doomed',
              chainId: 'chain-tel',
              isChainExecution: true,
              currentStep: 2,
              totalSteps: 3,
            };
          },
        };
      }
      if (name === 'StepExecution') {
        return {
          name,
          execute: async () => {
            throw new Error('render exploded');
          },
        };
      }
      return { name, execute: async () => undefined };
    });

    const pipeline = new PromptExecutionPipeline(stages, {
      logger: createLogger(),
      metricsProvider: () => undefined,
      executionRecordStore: recordStore,
      chainSessionStore: sessionStore,
    });

    await expect(pipeline.execute({ command: '>>chain' })).rejects.toThrow('render exploded');

    // The discriminating assertion: same numbers as the completed path, on a `failed` row.
    expect(readTelemetryRow(db, 'sess-doomed')).toEqual({
      status: 'failed',
      steps_planned: 3,
      gates_fired: 2,
      gate_retries: 1,
      unknowns_opened: 1,
      unknowns_closed: 1,
      nodes_inserted: 0,
      nodes_skipped: 0,
    });
  });

  test('execution_history renders the deltas as plain text, with no derived score', async () => {
    await sessionStore.createSession('sess-render', 'chain-tel', 3);
    await driveRunActivity('sess-render', 3);

    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      recordStore,
      sessionStore
    );
    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = { strategy: 'chain', gates: [] } as any;
    context.sessionContext = {
      sessionId: 'sess-render',
      chainId: 'chain-tel',
      isChainExecution: true,
      currentStep: 3,
      totalSteps: 3,
    };
    context.executionResults = { content: 'final output' };
    context.state.session.chainComplete = true;
    await stage.execute(context);

    const text = await renderHistory(recordStore);

    expect(text).toContain(
      'planned 3 / executed 3 · gates fired 2 (retries 1) · unknowns opened 1 / closed 1'
    );
    // D4: the rendered surface reports the facts and nothing derived from them.
    expect(text).not.toMatch(/score|complexity index|weight/i);
  });

  test('a session with only in-flight records renders no telemetry line', async () => {
    await sessionStore.createSession('sess-live', 'chain-tel', 3);
    recordStore.append({
      sessionId: 'sess-live',
      chainId: 'chain-tel',
      stepNumber: 1,
      status: 'working',
    });

    const text = await renderHistory(recordStore);

    expect(text).toContain('sess-live');
    expect(text).not.toContain('planned');
  });
});
