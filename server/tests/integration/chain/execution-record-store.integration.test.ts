// @lifecycle test - Tier 5 verification: ExecutionRecordStore round-trip + scope + ordering
/**
 * Integration test for ExecutionRecordStore.
 *
 * Verifies the append-only execution log against a real :memory: SQLite database
 * (node:sqlite DatabaseSync). The test mirrors the table shape declared in
 * sqlite-engine.ts so a real schema/code drift would surface here.
 *
 * Plan reference: ~/.claude/plans/execution-ledger-evidence-contracts-2026-04-27.md
 * Tier 5 rows #11 (per-step records) + #12 (chain-terminal record).
 */

import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
} from '../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';

import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../src/engine/gates/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { GateReview } from '../../../src/shared/types/chain-execution.js';
import type { GateVerdictSubmission } from '../../../src/shared/types/gate-evaluation.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const REVIEW_SCOPE = { continuityScopeId: 'semantic-capture-scope' };
const REVIEW_OUTPUT = 'A😀e\u0301 Z';
const REVIEW_GATE: LightweightGateDefinition = {
  id: 'retention-gate',
  name: 'Retention gate',
  type: 'validation',
  description: 'Ordinary gate carrying a staged rich report',
  guidance: 'Review the actual output',
  enforcementMode: 'blocking',
  pass_criteria: [{ type: 'inline_guidance' }],
};

/** Real persistence/capture collaborators; only the gate loader's filesystem is substituted. */
async function reviewFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'review-capture-cold-'));
  const logger = createLogger();
  const dbPath = path.join(root, 'state.db');
  let engine = await SqliteEngine.getInstance(logger, { dbPath });
  await engine.initialize();
  const createStore = async () => {
    const store = new ChainSessionStore(
      logger,
      new TextReferenceStore(logger),
      { cleanupIntervalMs: 60_000, defaultScope: REVIEW_SCOPE },
      engine
    );
    // Await the constructor's real load, as sibling cold-storage tests do.
    await (store as unknown as { initPromise: Promise<void> }).initPromise;
    return store;
  };
  let store = await createStore();
  const provider = {
    loadGate: async (id: string) => (id === REVIEW_GATE.id ? REVIEW_GATE : null),
    loadGates: async (ids: string[]) => (ids.includes(REVIEW_GATE.id) ? [REVIEW_GATE] : []),
  } as unknown as GateDefinitionProvider;
  return {
    logger,
    get store() {
      return store;
    },
    get records() {
      return new ExecutionRecordStore(engine, logger);
    },
    authority: () => new GateEnforcementAuthority(store, logger, provider),
    async cold() {
      await store.cleanup();
      await engine.shutdown();
      engine = await SqliteEngine.getInstance(logger, { dbPath });
      await engine.initialize();
      store = await createStore();
    },
    async close() {
      await store.cleanup();
      await engine.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

type ReviewFixture = Awaited<ReturnType<typeof reviewFixture>>;

async function openReview(f: ReviewFixture, kind: 'gate' | 'detached' = 'gate') {
  await f.store.createSession(
    'review-session',
    'review-chain#1',
    2,
    {},
    {
      ...REVIEW_SCOPE,
      nodes: [
        { id: 'reviewed-node', promptId: 'draft', stepName: 'Draft' },
        { id: 'current-node', promptId: 'next', stepName: 'Next' },
      ],
    }
  );
  return f.authority().createReview('review-session', kind, 'reviewed-node', {
    gateIds: [REVIEW_GATE.id],
    instructions: 'Review',
    maxAttempts: 3,
    ...(kind === 'detached' ? { reviewedOutput: REVIEW_OUTPUT } : {}),
  });
}

function retainedVerdict(review: GateReview): GateVerdictSubmission {
  const issued = review.semanticContext;
  const definition = issued?.definitions[REVIEW_GATE.id];
  if (issued === undefined || definition === undefined) throw new Error('Missing issued context');
  return {
    overall: 'FAIL',
    rationale: 'The ordinary review failed',
    per_gate: [
      {
        index: 1,
        passed: false,
        rationale: 'Retain this failed attempt',
        evaluation: {
          binding: {
            gate_id: REVIEW_GATE.id,
            node_id: issued.nodeId,
            attempt_id: issued.attemptId,
            definition_digest: definition.definitionDigest,
            target_digest: hashBytes(REVIEW_OUTPUT),
          },
          observations: [
            {
              criterion_id: 'staged-carrier',
              state: 'unmet',
              value: false,
              evidence: [
                {
                  target_digest: hashBytes(REVIEW_OUTPUT),
                  start: 0,
                  end: REVIEW_OUTPUT.length,
                  quote: REVIEW_OUTPUT,
                },
              ],
              rationale: 'Exact Unicode carrier, not live semantic adjudication',
            },
          ],
          reviewer: {
            provenance: 'client_reported',
            model: 'declared-reviewer',
            context: 'separate_pass',
          },
        },
      },
    ],
  };
}

function reviewContext(f: ReviewFixture, userResponse?: string, verdict?: GateVerdictSubmission) {
  const context = new ExecutionContext(
    {
      chain_id: 'review-chain#1',
      ...(userResponse !== undefined ? { user_response: userResponse } : {}),
      ...(verdict !== undefined ? { gate_verdict: verdict } : {}),
    },
    f.logger
  );
  context.state.identity.continuityScopeId = REVIEW_SCOPE.continuityScopeId;
  const session = f.store.getSession('review-session', REVIEW_SCOPE);
  if (session === undefined) throw new Error('Missing review session');
  context.sessionContext = {
    sessionId: session.sessionId,
    chainId: session.chainId,
    isChainExecution: true,
    currentNodeId: session.state.currentNodeId,
    totalSteps: 2,
  };
  context.gateEnforcement = f.authority();
  return context;
}

function reviewStage(f: ReviewFixture) {
  return new StepResponseCaptureStage(
    new GateVerdictProcessor(f.store, f.logger),
    new StepCaptureService(f.store, f.logger, f.records),
    f.store,
    new UnknownObservationProcessor(f.store, f.logger),
    f.logger
  );
}

describe('issued review capture and cold custody (real SQLite)', () => {
  test('cold reopened review retains pins and getter copies cannot mutate stored authority', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f);
      const bound = f.authority().bindReviewOutput(opened, `  ${REVIEW_OUTPUT}\n`);
      await f.store.setReview('review-session', bound);
      await f.cold();
      const copy = f.store.getReview('review-session', 'reviewed-node');
      expect(copy?.semanticContext).toEqual(bound.semanticContext);
      const copied = copy?.semanticContext;
      if (copied === undefined) throw new Error('Missing cold authority');
      Reflect.set(copied, 'attemptId', 'caller-replacement');
      Reflect.set(copied.definitions[REVIEW_GATE.id]!.definition, 'guidance', 'caller rewrite');
      Reflect.set(copied.target!, 'content', 'caller target');
      expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
        bound.semanticContext
      );
      expect(
        f.store.getSession('review-session', { continuityScopeId: 'another-scope' })
      ).toBeUndefined();
    } finally {
      await f.close();
    }
  });

  test('same-call ordinary capture retains exact failed report and canonical target through cold load', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f);
      const verdict = retainedVerdict(opened);
      const context = reviewContext(f, `  ${REVIEW_OUTPUT}\n`, verdict);
      await reviewStage(f).execute(context);
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(1);
      expect(records[0]?.gateVerdicts[0]?.evaluation).toEqual(verdict.per_gate?.[0]?.evaluation);
      expect(records[0]?.gateVerdicts[0]?.attempt).toBe(0);
      expect(records[0]?.nodeId).toBe('reviewed-node');
      const pins = f.store.getReview('review-session', 'reviewed-node')?.semanticContext;
      expect(pins?.target).toEqual({
        kind: 'step_output',
        content: REVIEW_OUTPUT,
        digest: hashBytes(REVIEW_OUTPUT),
      });
      await f.cold();
      expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(pins);
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)[0]?.gateVerdicts).toEqual(
        records[0]?.gateVerdicts
      );
      expect(
        f.records.queryBySession('review-session', { continuityScopeId: 'another-scope' })
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('capture-first then verdict-only append keeps the output row and exact failed attempt separately', async () => {
    const f = await reviewFixture();
    try {
      await openReview(f);
      await reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT));
      const captured = f.store.getReview('review-session', 'reviewed-node');
      if (captured === undefined) throw new Error('Missing captured review');
      expect(captured.semanticContext?.target).toEqual({
        kind: 'step_output',
        content: REVIEW_OUTPUT,
        digest: hashBytes(REVIEW_OUTPUT),
      });
      const verdict = retainedVerdict(captured);
      await reviewStage(f).execute(reviewContext(f, undefined, verdict));
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(2);
      expect(records[0]?.gateVerdicts).toEqual([]);
      expect(records[1]?.gateVerdicts[0]?.evaluation).toEqual(verdict.per_gate?.[0]?.evaluation);
      expect(records[1]?.gateVerdicts[0]?.attempt).toBe(0);
      await f.cold();
      expect(
        f.records.queryBySession('review-session', REVIEW_SCOPE).map((row) => row.gateVerdicts)
      ).toEqual(records.map((row) => row.gateVerdicts));
    } finally {
      await f.close();
    }
  });

  test('actual detached stage appends rich verdict on reviewed node while run stands elsewhere', async () => {
    const f = await reviewFixture();
    try {
      const opened = await openReview(f, 'detached');
      await f.store.markNodeSpawned('review-session', 'reviewed-node');
      await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
        isPlaceholder: false,
      });
      await f.store.completeStep('review-session', 'reviewed-node');
      await f.store.advanceStep('review-session', 'reviewed-node');
      const verdict = retainedVerdict(opened);
      const context = reviewContext(f, 'HANDOFF RESULT\nnode: reviewed-node', verdict);
      context.parsedCommand = {
        commandType: 'chain',
        promptId: 'draft',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        metadata: {
          originalCommand: '>>draft --> >>next',
          parseStrategy: 'fixture',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        chainId: 'review-chain#1',
        steps: [
          { stepNumber: 1, nodeId: 'reviewed-node', promptId: 'draft', args: {}, await: 'run' },
          { stepNumber: 2, nodeId: 'current-node', promptId: 'next', args: {} },
        ],
        promptArgs: {},
      };
      await reviewStage(f).execute(context);
      const records = f.records.queryBySession('review-session', REVIEW_SCOPE);
      expect(records).toHaveLength(1);
      expect(records[0]?.nodeId).toBe('reviewed-node');
      expect(records[0]?.stepNumber).toBe(1);
      expect(records[0]?.gateVerdicts[0]?.evaluation).toEqual(verdict.per_gate?.[0]?.evaluation);
      expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('current-node');
      await f.cold();
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)[0]?.gateVerdicts).toEqual(
        records[0]?.gateVerdicts
      );
    } finally {
      await f.close();
    }
  });

  test.each([false, true])(
    'changed output replacement preserves the semantic attempt guard (semantic=%s)',
    async (semantic) => {
      const f = await reviewFixture();
      try {
        const opened = await openReview(f, 'detached');
        const issued = opened.semanticContext;
        if (issued === undefined) throw new Error('Missing issued review');
        const bound = semantic
          ? {
              ...opened,
              semanticContext: bindSemanticReviewTarget(
                createSemanticReviewContext(opened.nodeId, issued.attemptId, [
                  {
                    ...REVIEW_GATE,
                    pass_criteria: [
                      {
                        type: 'semantic_evaluation',
                        id: 'draft',
                        target: { kind: 'step_output' },
                        question: 'Is the captured output complete?',
                        evidence_requirements: { min_items: 1 },
                        result: { kind: 'boolean' },
                        acceptance: { kind: 'equals', value: true },
                      },
                    ],
                  },
                ]),
                REVIEW_OUTPUT
              ),
            }
          : opened;
        await f.store.setReview('review-session', bound);
        await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
          isPlaceholder: false,
        });
        await f.store.completeStep('review-session', 'reviewed-node');
        const before = f.store.getChainContext('review-session')['step_results']?.[1];
        expect(before).toBe(REVIEW_OUTPUT);
        const context = reviewContext(f, 'replacement');
        const capture = new StepCaptureService(f.store, f.logger, f.records);
        const session = f.store.getSession('review-session');
        if (session === undefined) throw new Error('Missing capture session');
        const replace = () =>
          capture.recordDetachedReport(
            context,
            'review-session',
            session,
            { ordinal: 1, nodeId: 'reviewed-node' },
            'replacement'
          );
        if (semantic) {
          await expect(replace()).rejects.toThrow('fresh semantic review attempt');
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(before);
          expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
            bound.semanticContext
          );
          expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        } else {
          await replace();
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(
            'replacement'
          );
          expect(
            f.store.getReview('review-session', 'reviewed-node')?.semanticContext?.target?.content
          ).toBe('replacement');
        }
      } finally {
        await f.close();
      }
    }
  );

  test('target binding persistence failure propagates without a successful capture ledger', async () => {
    const f = await reviewFixture();
    try {
      await openReview(f);
      const persist = jest
        .spyOn(f.store, 'setReview')
        .mockRejectedValueOnce(new Error('binding persistence failed'));
      await expect(reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT))).rejects.toThrow(
        'binding persistence failed'
      );
      persist.mockRestore();
      expect(
        f.store.getReview('review-session', 'reviewed-node')?.semanticContext?.target
      ).toBeUndefined();
      expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test.each(['updateSessionState', 'completeStep'] as const)(
    'false %s result cannot create ordinary capture authority, success ledger or advancement',
    async (method) => {
      const f = await reviewFixture();
      try {
        await openReview(f);
        const refuse = jest.spyOn(f.store, method).mockResolvedValueOnce(false);
        await expect(reviewStage(f).execute(reviewContext(f, REVIEW_OUTPUT))).rejects.toThrow(
          'refused'
        );
        expect(refuse.mock.calls[0]?.slice(0, 2)).toEqual(['review-session', 'reviewed-node']);
        refuse.mockRestore();
        expect(
          f.store.getReview('review-session', 'reviewed-node')?.semanticContext?.target
        ).toBeUndefined();
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('reviewed-node');
      } finally {
        await f.close();
      }
    }
  );

  test.each(['updateSessionState', 'completeStep'] as const)(
    'false %s result cannot rebind a detached node while another node is current',
    async (method) => {
      const f = await reviewFixture();
      try {
        const opened = await openReview(f, 'detached');
        await f.store.updateSessionState('review-session', 'reviewed-node', REVIEW_OUTPUT, {
          isPlaceholder: false,
        });
        await f.store.completeStep('review-session', 'reviewed-node');
        await f.store.advanceStep('review-session', 'reviewed-node');
        const refuse = jest.spyOn(f.store, method).mockResolvedValueOnce(false);
        const context = reviewContext(f, 'replacement');
        const session = f.store.getSession('review-session');
        if (session === undefined) throw new Error('Missing detached session');
        await expect(
          new StepCaptureService(f.store, f.logger, f.records).recordDetachedReport(
            context,
            'review-session',
            session,
            { ordinal: 1, nodeId: 'reviewed-node' },
            'replacement'
          )
        ).rejects.toThrow('refused');
        expect(refuse.mock.calls[0]?.slice(0, 2)).toEqual(['review-session', 'reviewed-node']);
        refuse.mockRestore();
        expect(f.store.getReview('review-session', 'reviewed-node')?.semanticContext).toEqual(
          opened.semanticContext
        );
        expect(f.records.queryBySession('review-session', REVIEW_SCOPE)).toEqual([]);
        expect(f.store.getSession('review-session')?.state.currentNodeId).toBe('current-node');
        if (method === 'completeStep') {
          // The output write completed before the refused completion. No atomic rollback claim.
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(
            'replacement'
          );
        } else {
          expect(f.store.getChainContext('review-session')['step_results']?.[1]).toBe(
            REVIEW_OUTPUT
          );
        }
      } finally {
        await f.close();
      }
    }
  );
});

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Build a DatabasePort-conformant adapter over a real :memory: DatabaseSync.
 * Schema mirrors sqlite-engine.ts:405-423 so drift between this test and the
 * production CREATE TABLE will surface as a SQL error.
 */
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
      handoff_evidence TEXT CHECK (
        handoff_evidence IS NULL
        OR handoff_evidence IN ('ok', 'trailer', 'node-line', 'node-mismatch')
      ),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_execution_records_session ON execution_records(session_id);
    CREATE INDEX idx_execution_records_chain ON execution_records(chain_id);
  `);

  const port: DatabasePort = {
    isInitialized: () => true,
    initialize: async () => undefined,
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] => {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as never[]));
      return rows as T[];
    },
    queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null => {
      const stmt = db.prepare(sql);
      const row = stmt.get(...((params ?? []) as never[]));
      return (row ?? null) as T | null;
    },
    run: (sql: string, params?: unknown[]): void => {
      const stmt = db.prepare(sql);
      stmt.run(...((params ?? []) as never[]));
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

describe('ExecutionRecordStore (integration)', () => {
  let db: DatabaseSync;
  let port: DatabasePort;
  let store: ExecutionRecordStore;

  beforeEach(() => {
    const fixture = createInMemoryDb();
    db = fixture.db;
    port = fixture.port;
    store = new ExecutionRecordStore(port, createLogger());
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore close errors on teardown
    }
  });

  test('AC1+AC2: append() persists a step-level record with full field round-trip', () => {
    const renderedAt = Date.now();
    const executionId = store.append({
      sessionId: 'sess-int-1',
      chainId: 'chain-research#1',
      stepNumber: 1,
      promptId: 'analysis_report',
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
    });

    expect(executionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const records = store.queryBySession('sess-int-1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      executionId,
      sessionId: 'sess-int-1',
      chainId: 'chain-research#1',
      stepNumber: 1,
      promptId: 'analysis_report',
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
      gateVerdicts: [],
    });
    expect(records[0].completedAt).toBeUndefined();
    expect(records[0].errorMessage).toBeUndefined();
  });

  test('AC1: StepExecutionStage-style per-step + ResponseFormattingStage-style chain-terminal records both persist', () => {
    const t1 = Date.now();
    const t2 = t1 + 10;
    const t3 = t2 + 10;

    // Two step-level records (StepExecutionStage emission shape)
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      stepNumber: 1,
      promptId: 'step-one',
      status: 'working',
      substate: { renderedAt: t1 },
      startedAt: t1,
    });
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      stepNumber: 2,
      promptId: 'step-two',
      status: 'working',
      substate: { renderedAt: t2 },
      startedAt: t2,
    });
    // Chain-terminal record (ResponseFormattingStage emission shape — no stepNumber/promptId)
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      status: 'completed',
      startedAt: t3,
      completedAt: t3,
    });

    const records = store.queryBySession('sess-multi');
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.status)).toEqual(['working', 'working', 'completed']);
    expect(records.map((r) => r.stepNumber)).toEqual([1, 2, undefined]);

    // Chain-terminal has completedAt set, step-level records do not
    expect(records[2].completedAt).toBe(t3);
    expect(records[0].completedAt).toBeUndefined();
    expect(records[1].completedAt).toBeUndefined();
  });

  test('AC3: ULID ordering preserves insertion order via queryBySession', () => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(
        store.append({
          sessionId: 'sess-order',
          chainId: 'chain-order#1',
          stepNumber: i,
          status: 'working',
          startedAt: Date.now() + i,
        })
      );
    }

    const records = store.queryBySession('sess-order');
    expect(records.map((r) => r.executionId)).toEqual(ids);
    expect(records.map((r) => r.stepNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  // P6.121 / R55: the pipeline tells a run's earlier records from its own call's by this id.
  test('watermark() sorts after every record appended before it and before every one after', () => {
    const append = (stepNumber: number) =>
      store.append({ sessionId: 'sess-mark', stepNumber, status: 'working' });
    const before = [append(1), append(2)];
    const mark = store.watermark();
    const after = [append(3), append(4)];

    const ids = store.queryBySession('sess-mark').map((record) => record.executionId);
    expect(ids.filter((id) => id < mark)).toEqual(before);
    expect(ids.filter((id) => id > mark)).toEqual(after);
    expect(ids).not.toContain(mark);
  });

  test('AC4: queryByChain returns same records as queryBySession via different key', () => {
    store.append({
      sessionId: 'sess-by-chain',
      chainId: 'chain-x#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
    });
    store.append({
      sessionId: 'sess-by-chain',
      chainId: 'chain-x#1',
      status: 'completed',
      startedAt: Date.now() + 1,
      completedAt: Date.now() + 1,
    });

    const bySession = store.queryBySession('sess-by-chain');
    const byChain = store.queryByChain('chain-x#1');

    expect(byChain).toHaveLength(2);
    expect(byChain.map((r) => r.executionId)).toEqual(bySession.map((r) => r.executionId));
  });

  test('AC5: scope (organization_id/workspace_id) round-trips through append + query', () => {
    store.append({
      sessionId: 'sess-scoped',
      chainId: 'chain-scoped#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
      scope: {
        continuityScopeId: 'tenant-acme',
        organizationId: 'org-acme',
        workspaceId: 'workspace-prod',
      },
    });

    const records = store.queryBySession('sess-scoped', {
      continuityScopeId: 'tenant-acme',
    });

    expect(records).toHaveLength(1);
    expect(records[0].organizationId).toBe('org-acme');
    expect(records[0].workspaceId).toBe('workspace-prod');
  });

  test('AC5: queries are tenant-isolated — other tenants do not see this scope’s records', () => {
    store.append({
      sessionId: 'sess-shared-id',
      chainId: 'chain-shared#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
      scope: { continuityScopeId: 'tenant-a' },
    });
    store.append({
      sessionId: 'sess-shared-id',
      chainId: 'chain-shared#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now() + 1,
      scope: { continuityScopeId: 'tenant-b' },
    });

    const tenantA = store.queryBySession('sess-shared-id', { continuityScopeId: 'tenant-a' });
    const tenantB = store.queryBySession('sess-shared-id', { continuityScopeId: 'tenant-b' });

    expect(tenantA).toHaveLength(1);
    expect(tenantB).toHaveLength(1);
    expect(tenantA[0].executionId).not.toBe(tenantB[0].executionId);
  });

  test('append is best-effort — SQL failures log warn but do not throw', () => {
    db.close();
    const warnLogger = createLogger();
    const resilientStore = new ExecutionRecordStore(port, warnLogger);

    // After closing the underlying DB, run() will throw inside the port; the
    // store must absorb the error so emission cannot break pipeline execution.
    expect(() =>
      resilientStore.append({
        sessionId: 'sess-after-close',
        status: 'working',
        startedAt: Date.now(),
      })
    ).not.toThrow();

    expect(warnLogger.warn).toHaveBeenCalled();
  });

  /**
   * Tier 3.1 — the reader half of the ledger. Before this, execution_records had a
   * writer and no caller: queryBySession/queryByChain had zero call sites across
   * src/, hooks/ and cli/.
   */
  describe('queryRecent', () => {
    test('returns records newest-first by ULID order', () => {
      store.append({ sessionId: 'sess-a', status: 'working', startedAt: 1 });
      store.append({ sessionId: 'sess-b', status: 'working', startedAt: 2 });
      store.append({ sessionId: 'sess-c', status: 'completed', startedAt: 3 });

      const recent = store.queryRecent();

      expect(recent).toHaveLength(3);
      expect(recent.map((r) => r.sessionId)).toEqual(['sess-c', 'sess-b', 'sess-a']);
    });

    test('orders by execution_id, so records sharing a timestamp still sort deterministically', () => {
      // All three share startedAt — a timestamp sort could return any permutation.
      // ULIDs are monotonic, which is why queryRecent orders by execution_id instead.
      const sharedTs = 42;
      const ids = [
        store.append({ sessionId: 's1', status: 'working', startedAt: sharedTs }),
        store.append({ sessionId: 's2', status: 'working', startedAt: sharedTs }),
        store.append({ sessionId: 's3', status: 'working', startedAt: sharedTs }),
      ];

      const recent = store.queryRecent();

      expect(recent.map((r) => r.executionId)).toEqual([...ids].reverse());
    });

    test('honours an explicit limit', () => {
      for (let i = 0; i < 10; i += 1) {
        store.append({ sessionId: `sess-${i}`, status: 'working', startedAt: i });
      }

      expect(store.queryRecent(3)).toHaveLength(3);
    });

    test('clamps a limit above the ceiling instead of reading the whole ledger', () => {
      // Seeded past MAX_RECENT_LIMIT (500) deliberately: with fewer rows than the
      // ceiling this assertion would pass whether or not the clamp exists, and a
      // test that cannot fail proves nothing. execution_records has no retention
      // policy, so an unbounded read is a real risk rather than a hypothetical.
      for (let i = 0; i < 520; i += 1) {
        store.append({ sessionId: `sess-${i}`, status: 'working', startedAt: i });
      }

      expect(store.queryRecent(10_000)).toHaveLength(500);
    });

    test('coerces a non-positive or non-finite limit rather than emitting invalid SQL', () => {
      store.append({ sessionId: 'sess-only', status: 'completed', startedAt: 1 });

      expect(store.queryRecent(0)).toHaveLength(1);
      expect(store.queryRecent(-5)).toHaveLength(1);
      expect(store.queryRecent(Number.NaN)).toHaveLength(1);
    });

    test('excludes rows belonging to another scope', () => {
      store.append({
        sessionId: 'sess-mine',
        status: 'working',
        startedAt: 1,
        scope: { continuityScopeId: 'workspace-a' },
      });
      store.append({
        sessionId: 'sess-theirs',
        status: 'working',
        startedAt: 2,
        scope: { continuityScopeId: 'workspace-b' },
      });

      const mine = store.queryRecent(50, { continuityScopeId: 'workspace-a' });

      expect(mine).toHaveLength(1);
      expect(mine[0]?.sessionId).toBe('sess-mine');
    });

    test('returns an empty array when the ledger holds nothing for the scope', () => {
      expect(store.queryRecent()).toEqual([]);
    });
  });
});
