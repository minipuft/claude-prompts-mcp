// @lifecycle test - Tier 2 row 2.7: the server refuses a delegated resume with no handoff trailer.
/**
 * The delegation handoff contract at the boundary the server actually owns — render ↔ accept.
 *
 * The server cannot wait for a spawned worker, so the only place it can verify a handoff is the
 * resume it is handed. Under the shipped default (`required`, R3) a delegated node's resume that
 * does not echo the brief's node token is REFUSED, and every delegated capture records the reason
 * it carried in `execution_records.handoff_evidence`.
 *
 * POSITIVE CONTROL FIRST: the accept path (case 2) and the refusal path (case 1) are asserted
 * against the same chain, the same harness and the same worker helper, so "nothing was captured"
 * is only evidence because the sibling case shows the same probe capturing when the trailer is
 * present. `runFakeWorker` reads the token out of the RENDERED brief rather than taking it as an
 * argument, so an accept-path assertion cannot pass against a brief the server never printed.
 *
 * Harness cloned from `delegated-resume-brief.integration.test.ts` (which owns the render half):
 * real SessionManagementStage, StepResponseCaptureStage, StepExecutionStage, GateReviewStage,
 * ResponseFormattingStage, ChainSessionStore, GateVerdictProcessor, GateEnforcementAuthority and
 * ExecutionRecordStore against real in-memory SQLite. The DDL below mirrors `execution_records`
 * in sqlite-engine.ts — including the `handoff_evidence` CHECK — so a writer that drifts to a
 * value the column does not admit surfaces here as a SQL error rather than a swallowed append.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { ChainBlueprintResolver } from '../../../src/engine/execution/parsers/chain-blueprint-resolver.js';
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
import { runFakeWorker } from '../../helpers/delegation/fake-worker.js';

import type { HandoffEvidenceMode } from '../../../src/engine/execution/delegation/handoff-contract.js';
import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const GATE_ID = 'step-quality';
/** The delegated step's own gate text — the field the brief derives its Result Contract from. */
const STEP_GATE_TEXT = '## Quality Gates\n\n- step-quality: output must name its evidence';
/** Step 2's node id, deliberately not `n2`, so a token assertion cannot pass by ordinal accident. */
const DELEGATED_NODE_ID = 'step-review';

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

/** `>>draft ==> >>review`: step 1 plain, step 2 DELEGATED and carrying its own gate text. */
const parsedChainSteps = (withNodeIds = true) => [
  {
    stepNumber: 1,
    ...(withNodeIds ? { nodeId: 'n1' } : {}),
    promptId: 'draft',
    args: {},
    convertedPrompt: PROMPTS[0],
  },
  {
    stepNumber: 2,
    ...(withNodeIds ? { nodeId: DELEGATED_NODE_ID } : {}),
    promptId: 'review',
    args: {},
    convertedPrompt: PROMPTS[1],
    delegated: true,
    metadata: { gateInstructions: STEP_GATE_TEXT },
  },
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
      handoff_evidence TEXT CHECK (
        handoff_evidence IS NULL
        OR handoff_evidence IN ('ok', 'trailer', 'node-line', 'node-mismatch')
      ),
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
  steps?: ReturnType<typeof parsedChainSteps>;
  /** Omitted = the collaborators bag carries no mode, which is the shipped default (`required`). */
  evidenceMode?: HandoffEvidenceMode;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger, steps = parsedChainSteps(), evidenceMode } = options;
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);

  const realStages: Record<string, PipelineStage> = {
    SessionManagement: new SessionManagementStage(sessionStore, logger),
    StepResponseCapture: new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, logger),
      new StepCaptureService(sessionStore, logger, recordStore),
      sessionStore,
      new UnknownObservationProcessor(sessionStore, logger),
      logger,
      evidenceMode === undefined ? {} : { handoffEvidenceMode: () => evidenceMode }
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
          // The live path: a resume never re-parses — stage 04 restores the persisted blueprint.
          if (context.mcpRequest.chain_id) {
            new ChainBlueprintResolver(sessionStore, logger).restoreFromBlueprint(context);
            return;
          }
          context.parsedCommand = {
            commandType: 'chain',
            promptId: 'draft',
            chainId: 'chain-delegation-handoff-evidence',
            steps,
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

describe('delegation handoff evidence at resume (Tier 2 row 2.7)', () => {
  let db: DatabaseSync;
  let logger: Logger;
  let recordStore: ExecutionRecordStore;
  let sessionStore: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  beforeEach(() => {
    const created = createInMemoryDb();
    db = created.db;
    logger = createLogger();
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
      serverRoot: '/tmp/test-delegation-handoff-evidence',
      cleanupIntervalMs: 60_000,
    });
  });

  afterEach(async () => {
    await sessionStore.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
    db.close();
  });

  const text = (response: { content?: Array<{ text?: string }> }): string =>
    (response.content ?? []).map((c) => c.text ?? '').join('\n');

  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'meets the gate',
    per_gate: [{ index: 1, passed: true, rationale: `${GATE_ID}: satisfied` }],
  });

  const onlySession = (): {
    sessionId: string;
    chainId: string;
    state: { currentNodeId: string };
  } =>
    Array.from((sessionStore as any).activeSessions.values())[0] as {
      sessionId: string;
      chainId: string;
      state: { currentNodeId: string };
    };

  /** The capture-time rows this feature writes: per-step `completed` rows, oldest first. */
  const capturedRows = (
    sessionId: string
  ): Array<{ step_number: number | null; handoff_evidence: string | null }> =>
    db
      .prepare(
        `SELECT step_number, handoff_evidence FROM execution_records
         WHERE session_id = ? AND status = 'completed' AND step_number IS NOT NULL
         ORDER BY execution_id ASC`
      )
      .all(sessionId) as Array<{ step_number: number | null; handoff_evidence: string | null }>;

  /**
   * Start the chain and resume step 1 (plain, non-delegated), which advances onto step 2 and
   * renders its delegation brief. Returns the ids plus the RENDERED brief the fake worker reads.
   */
  const advanceToDelegatedStep = async (
    pipeline: PromptExecutionPipeline
  ): Promise<{ chainId: string; sessionId: string; brief: string }> => {
    await pipeline.execute({ command: `>>draft ==> >>review` } as any);
    const { chainId, sessionId } = onlySession();
    const rendered = await pipeline.execute({
      chain_id: chainId,
      user_response: 'step 1 output',
      gate_verdict: passVerdict,
    } as any);
    const brief = text(rendered);
    expect(brief).toContain('EXECUTION BRIEF');
    return { chainId, sessionId, brief };
  };

  describe('the shipped default (no config key set → `required`)', () => {
    test('POSITIVE CONTROL: a prose-only resume of the delegated node is refused, and nothing moves', async () => {
      const pipeline = buildPipeline({ sessionStore, recordStore, logger });
      const { chainId, sessionId, brief } = await advanceToDelegatedStep(pipeline);

      const refused = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief, { omitTrailer: true }),
        gate_verdict: passVerdict,
      } as any);
      const message = text(refused);

      expect(refused.isError).toBe(true);
      expect(message).toContain('❌ Delegated node');
      expect(message).toContain(DELEGATED_NODE_ID);
      // The refusal prints the exact block to append, so the fix is a copy.
      expect(message).toContain('HANDOFF RESULT');
      expect(message).toContain(`node: ${DELEGATED_NODE_ID}`);

      // Nothing moved: the run still stands on the delegated node, only step 1 was ever
      // captured, and the gate verdict submitted alongside the prose was not consumed. The
      // `working` row stage 18 wrote when it RENDERED step 2 is not a capture and is excluded
      // by `status = 'completed'` — case 2 below shows the same query seeing a step-2 row.
      expect(onlySession().state.currentNodeId).toBe(DELEGATED_NODE_ID);
      expect(capturedRows(sessionId)).toEqual([{ step_number: 1, handoff_evidence: null }]);
    });

    test('a conforming worker reply is captured, the chain advances, and the row reads `ok`', async () => {
      const pipeline = buildPipeline({ sessionStore, recordStore, logger });
      const { chainId, sessionId, brief } = await advanceToDelegatedStep(pipeline);

      const accepted = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief),
        gate_verdict: passVerdict,
      } as any);

      expect(accepted.isError).not.toBe(true);
      expect(text(accepted)).not.toContain('❌ Delegated node');
      expect(capturedRows(sessionId)).toEqual([
        { step_number: 1, handoff_evidence: null },
        { step_number: 2, handoff_evidence: 'ok' },
      ]);
      // The read-back path (the execution_history source) surfaces the same value.
      const captured = recordStore
        .queryRecent(50)
        .find(
          (record) =>
            record.sessionId === sessionId &&
            record.status === 'completed' &&
            record.stepNumber === 2
        );
      expect(captured?.handoffEvidence).toBe('ok');
    });

    test('a trailer naming ANOTHER node is refused, and the message names the token it found', async () => {
      const pipeline = buildPipeline({ sessionStore, recordStore, logger });
      const { chainId, sessionId, brief } = await advanceToDelegatedStep(pipeline);

      const refused = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief, { overrideToken: 'some-other-node' }),
        gate_verdict: passVerdict,
      } as any);
      const message = text(refused);

      expect(refused.isError).toBe(true);
      expect(message).toContain(`❌ Delegated node ${DELEGATED_NODE_ID}`);
      expect(message).toContain('matching node');
      expect(message).toContain('found: some-other-node');
      expect(capturedRows(sessionId)).toEqual([{ step_number: 1, handoff_evidence: null }]);
    });
  });

  test('`advisory` accepts the prose-only resume and records what it carried', async () => {
    const pipeline = buildPipeline({
      sessionStore,
      recordStore,
      logger,
      evidenceMode: 'advisory',
    });
    const { chainId, sessionId, brief } = await advanceToDelegatedStep(pipeline);

    const accepted = await pipeline.execute({
      chain_id: chainId,
      user_response: runFakeWorker(brief, { omitTrailer: true }),
      gate_verdict: passVerdict,
    } as any);

    expect(accepted.isError).not.toBe(true);
    expect(text(accepted)).not.toContain('❌ Delegated node');
    // The reason is recorded in BOTH modes — this is the row `required` would have refused on.
    expect(capturedRows(sessionId)).toEqual([
      { step_number: 1, handoff_evidence: null },
      { step_number: 2, handoff_evidence: 'trailer' },
    ]);
  });

  test('a legacy chain with no node ids uses `n2` in the brief AND in the accepted trailer', async () => {
    const pipeline = buildPipeline({
      sessionStore,
      recordStore,
      logger,
      steps: parsedChainSteps(false),
    });
    const { chainId, sessionId, brief } = await advanceToDelegatedStep(pipeline);

    expect(brief).toContain('node: n2');
    expect(brief).not.toContain(`node: ${DELEGATED_NODE_ID}`);

    const accepted = await pipeline.execute({
      chain_id: chainId,
      user_response: runFakeWorker(brief),
      gate_verdict: passVerdict,
    } as any);

    expect(accepted.isError).not.toBe(true);
    expect(capturedRows(sessionId)).toEqual([
      { step_number: 1, handoff_evidence: null },
      { step_number: 2, handoff_evidence: 'ok' },
    ]);
  });
});
