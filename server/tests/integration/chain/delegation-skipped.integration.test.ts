// @lifecycle test - S8: delegation_skipped telemetry, driven as a client drives a resume.
/**
 * S8 / R-4 flip condition, end to end through the real pipeline:
 *
 *   - a DELEGATED, GATED step resumed WITHOUT the `Proposed Gate Review:` block produces a
 *     capture-time execution_records row with delegation_skipped = 1;
 *   - the same resume WITH the block produces delegation_skipped = 0;
 *   - a NON-delegated step's captured row binds NULL (partial population by row type).
 *
 * Harness cloned from step-lifecycle.integration.test.ts: real SessionManagementStage,
 * StepResponseCaptureStage (with StepCaptureService holding the record store — the writer under
 * test), StepExecutionStage, GateReviewStage, ResponseFormattingStage, ChainSessionStore,
 * GateVerdictProcessor, GateEnforcementAuthority, ExecutionRecordStore against real in-memory
 * SQLite. Stubs supply parsing/planning/gate-selection inputs and decide nothing about
 * lifecycle. The DDL below mirrors `execution_records` in sqlite-engine.ts so schema/code drift
 * surfaces here as a SQL error rather than a silently-swallowed append.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { PROPOSED_GATE_REVIEW_TOKEN } from '../../../src/engine/execution/delegation/brief.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { SessionManagementStage } from '../../../src/engine/execution/pipeline/stages/13-session-stage.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { StepExecutionStage } from '../../../src/engine/execution/pipeline/stages/18-execution-stage.js';
import { GateReviewStage } from '../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { renderGateVerdict } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const CHAIN_BASE = 'chain-delegation-skipped-demo';
const GATE_ID = 'step-quality';
/** The delegated step's own gate text — the field the brief derives its Result Contract from. */
const STEP_GATE_TEXT = '## Quality Gates\n\n- step-quality: output must name its evidence';

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
  getChainStepResults = jest.fn().mockReturnValue({});
}

const stepPrompt = (id: string, name: string): ConvertedPrompt => ({
  id,
  name,
  description: name,
  category: 'analysis',
  userMessageTemplate: `Do ${name}.`,
  systemMessage: '',
  arguments: [],
});

const PROMPTS: ConvertedPrompt[] = [stepPrompt('draft', 'Draft'), stepPrompt('review', 'Review')];

/**
 * `>>draft ==> >>review`-shaped parse: step 1 is DELEGATED and carries its own gate text in
 * `metadata['gateInstructions']` (stage 11's per-step field, stubbed here the way the
 * GateEnhancement stub stands in for stage 11); step 2 is a plain non-delegated step.
 */
const parsedChainSteps = () => [
  {
    stepNumber: 1,
    nodeId: 'draft',
    promptId: 'draft',
    args: {},
    convertedPrompt: PROMPTS[0],
    delegated: true,
    metadata: { gateInstructions: STEP_GATE_TEXT },
  },
  { stepNumber: 2, nodeId: 'review', promptId: 'review', args: {}, convertedPrompt: PROMPTS[1] },
];

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

const STAGE_ORDER = [
  'RequestNormalization',
  'ExecutionLifecycle',
  'IdentityResolution',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'ScriptExecution',
  'ScriptAutoExecute',
  'JudgeSelection',
  'GateEnhancement',
  'FrameworkResolution',
  'SessionManagement',
  'InjectionControl',
  'PromptGuidance',
  'StepResponseCapture',
  'ShellVerification',
  'StepExecution',
  'PhaseGuardVerification',
  'GateReview',
  'ResponseFormatting',
  'PostFormattingCleanup',
] as const;

const buildPipeline = (options: {
  sessionStore: ChainSessionStore;
  recordStore: ExecutionRecordStore;
  logger: Logger;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger } = options;
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);

  const realStages: Record<string, PipelineStage> = {
    SessionManagement: new SessionManagementStage(sessionStore, logger),
    StepResponseCapture: new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, logger),
      // The writer under test: StepCaptureService holding the record store appends the
      // capture-time `completed` row that carries delegation_skipped.
      new StepCaptureService(sessionStore, logger, recordStore),
      sessionStore,
      new UnknownObservationProcessor(sessionStore, logger),
      logger
    ),
    StepExecution: new StepExecutionStage(
      chainExecutor,
      sessionStore,
      logger,
      undefined,
      undefined,
      recordStore
    ),
    GateReview: new GateReviewStage(chainExecutor, sessionStore, null, logger, undefined, {
      executionRecordStore: recordStore,
    }),
    ResponseFormatting: new ResponseFormattingStage(
      new ResponseFormatter(logger),
      new ResponseAssembler(),
      logger,
      recordStore,
      sessionStore
    ),
  };

  const stages: PipelineStage[] = STAGE_ORDER.map((name) => {
    const real = realStages[name];
    if (real !== undefined) return real;

    if (name === 'CommandParsing') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.parsedCommand = {
            commandType: 'chain',
            promptId: 'draft',
            chainId: CHAIN_BASE,
            steps: parsedChainSteps(),
            promptArgs: {},
            convertedPrompt: PROMPTS[0],
          } as never;
        },
      };
    }
    if (name === 'ExecutionPlanning') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.executionPlan = {
            strategy: 'chain',
            gates: [GATE_ID],
            requiresFramework: false,
            requiresSession: true,
            llmValidationEnabled: false,
            category: 'analysis',
          } as never;
        },
      };
    }
    if (name === 'GateEnhancement') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.state.gates.hasBlockingGates = true;
          context.state.gates.accumulatedGateIds = [GATE_ID];
          context.state.gates.enforcementMode = 'blocking';
          context.gateInstructions = 'Check the step output against the gate.';
        },
      };
    }
    return { name, execute: async () => undefined };
  });

  return new PromptExecutionPipeline(stages, {
    logger,
    metricsProvider: () => undefined,
    gateEnforcement: new GateEnforcementAuthority(sessionStore, logger),
    executionRecordStore: recordStore,
    chainSessionStore: sessionStore,
  });
};

describe('delegation_skipped telemetry (S8), driven the way a client drives it', () => {
  let db: DatabaseSync;
  let recordStore: ExecutionRecordStore;
  let sessionStore: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  beforeEach(() => {
    const created = createInMemoryDb();
    db = created.db;
    const logger = createLogger();
    recordStore = new ExecutionRecordStore(created.port, logger);

    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    sessionStore = new ChainSessionStore(logger, new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-delegation-skipped-integration',
      cleanupIntervalMs: 60_000,
    });

    pipeline = buildPipeline({ sessionStore, recordStore, logger });
  });

  afterEach(async () => {
    await sessionStore.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
    db.close();
  });

  const onlySession = () => {
    const sessions = Array.from((sessionStore as any).activeSessions.values());
    expect(sessions).toHaveLength(1);
    return sessions[0] as { sessionId: string; chainId: string };
  };

  /** The capture-time rows this feature writes: per-step `completed` rows, oldest first. */
  const capturedRows = (
    sessionId: string
  ): Array<{ step_number: number | null; delegation_skipped: number | null }> =>
    db
      .prepare(
        `SELECT step_number, delegation_skipped FROM execution_records
         WHERE session_id = ? AND status = 'completed' AND step_number IS NOT NULL
         ORDER BY execution_id ASC`
      )
      .all(sessionId) as Array<{ step_number: number | null; delegation_skipped: number | null }>;

  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'meets the gate',
    per_gate: [{ index: 1, passed: true, rationale: `${GATE_ID}: satisfied` }],
  });

  /** Start the chain, then resume step 1 (the delegated, gated step) with the given output. */
  const startAndResumeStepOne = async (
    stepOneResponse: string
  ): Promise<{ chainId: string; sessionId: string }> => {
    await pipeline.execute({ command: `>>draft ==> >>review` });
    const { chainId, sessionId } = onlySession();
    await pipeline.execute({
      chain_id: chainId,
      user_response: stepOneResponse,
      gate_verdict: passVerdict,
    } as any);
    return { chainId, sessionId };
  };

  test('FLIP: a delegated gated step resumed WITHOUT the Proposed Gate Review block rows delegation_skipped = 1', async () => {
    const { sessionId } = await startAndResumeStepOne(
      'inline answer produced by the parent — no worker was spawned'
    );

    const rows = capturedRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ step_number: 1, delegation_skipped: 1 });
  });

  test('FLIP: the same resume WITH the Proposed Gate Review block rows delegation_skipped = 0', async () => {
    const { sessionId } = await startAndResumeStepOne(
      [
        'worker result body',
        '',
        PROPOSED_GATE_REVIEW_TOKEN,
        `- ${GATE_ID}: PASS — evidence named`,
      ].join('\n')
    );

    const rows = capturedRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ step_number: 1, delegation_skipped: 0 });
  });

  test('a NON-delegated step’s captured row binds NULL — partial population by row type', async () => {
    const { chainId, sessionId } = await startAndResumeStepOne(
      [
        'worker result body',
        '',
        PROPOSED_GATE_REVIEW_TOKEN,
        `- ${GATE_ID}: PASS — evidence named`,
      ].join('\n')
    );

    // Resume step 2 (non-delegated): its capture row must bind NULL, not 0.
    await pipeline.execute({ chain_id: chainId, user_response: 'plain step 2 output' } as any);

    const rows = capturedRows(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ step_number: 1, delegation_skipped: 0 });
    expect(rows[1]).toEqual({ step_number: 2, delegation_skipped: null });
  });

  test('the read-back path (queryRecent, the execution_history source) surfaces the mark', async () => {
    const { sessionId } = await startAndResumeStepOne('inline answer, no review block');

    const records = recordStore.queryRecent(50);
    const captured = records.find(
      (record) =>
        record.sessionId === sessionId && record.status === 'completed' && record.stepNumber === 1
    );
    expect(captured?.delegationSkipped).toBe(true);
  });
});
