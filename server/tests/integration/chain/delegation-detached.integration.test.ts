// @lifecycle test - Tier 4 rows 4.3-4.6: a detached step renders, the run moves on, and the late result reports by token.
/**
 * Detached delegation (`await: run`) end to end through the real pipeline stages.
 *
 * A detached step's brief renders like any delegated step's, but the run does not wait: an empty
 * resume moves past it, the worker's result reports LATER on whatever resume carries its
 * `HANDOFF RESULT` trailer, and the run may not complete while a spawned detached node has not
 * reported. Every refusal here has its positive control in the same file — the late report that
 * lands (case "lands") is the same probe the refusals are shown not to trip.
 *
 * The blocking control (last describe) runs the SAME chain with `await` absent and asserts the
 * pre-Tier-4 behaviour: an empty resume at the delegated step is refused, and the handoff pins
 * `run_in_background: false`.
 *
 * Harness cloned from `delegation-handoff-evidence.integration.test.ts` (real stages 13/16/18/20/21,
 * ChainSessionStore, ExecutionRecordStore over in-memory SQLite); the DDL copy is held to the
 * engine's column set by `ddl-copy-parity.test.ts`.
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
import { OperatorValidationStage } from '../../../src/engine/execution/pipeline/stages/06-operator-validation-stage.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { StepExecutionStage } from '../../../src/engine/execution/pipeline/stages/18-execution-stage.js';
import { GateReviewStage } from '../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { runFakeWorker } from '../../helpers/delegation/fake-worker.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

/** The detached step's node id, deliberately not `n2`, so a token cannot match by ordinal. */
const DETACHED = 'step-review';

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

const PROMPTS: ConvertedPrompt[] = [
  stepPrompt('draft', 'Draft'),
  stepPrompt('review', 'Review'),
  stepPrompt('summarize', 'Summarize'),
];

/**
 * `draft → review (await: run) → summarize`, or with `detachedLast` the two-step
 * `draft → review (await: run)`. `await` is the DECLARATION; the real stage 06 below turns it
 * into the delegated flag, so `delegated` is deliberately not written here.
 */
const parsedSteps = (options: {
  detached: boolean;
  detachedLast?: boolean;
  /** Row 4.9: move the delegated step to the FRONT (`review → draft → summarize`). */
  delegatedFirst?: boolean;
}) => {
  const steps = [
    { stepNumber: 1, nodeId: 'n1', promptId: 'draft', args: {}, convertedPrompt: PROMPTS[0] },
    {
      stepNumber: 2,
      nodeId: DETACHED,
      promptId: 'review',
      args: {},
      convertedPrompt: PROMPTS[1],
      ...(options.detached ? { await: 'run' as const } : { delegated: true }),
    },
    { stepNumber: 3, nodeId: 'n3', promptId: 'summarize', args: {}, convertedPrompt: PROMPTS[2] },
  ];
  if (options.delegatedFirst === true) {
    const [draft, review, summarize] = steps;
    return [
      { ...review!, stepNumber: 1 },
      { ...draft!, stepNumber: 2 },
      { ...summarize!, stepNumber: 3 },
    ];
  }
  return options.detachedLast === true ? steps.slice(0, 2) : steps;
};

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
  steps: ReturnType<typeof parsedSteps>;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger, steps } = options;
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);

  const realStages: Record<string, PipelineStage> = {
    OperatorValidation: new OperatorValidationStage(null, logger),
    SessionManagement: new SessionManagementStage(sessionStore, logger),
    StepResponseCapture: new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, logger),
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
          if (context.mcpRequest.chain_id) {
            new ChainBlueprintResolver(sessionStore, logger).restoreFromBlueprint(context);
            return;
          }
          context.parsedCommand = {
            commandType: 'chain',
            promptId: 'draft',
            chainId: 'chain-delegation-detached',
            steps: structuredClone(steps),
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
            gates: [],
            requiresFramework: false,
            requiresSession: true,
            llmValidationEnabled: false,
            category: 'analysis',
          } as never;
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

describe('detached delegation (await: run) through the pipeline', () => {
  let db: DatabaseSync;
  let logger: Logger;
  let recordStore: ExecutionRecordStore;
  let sessionStore: ChainSessionStore;
  let spies: Array<{ mockRestore: () => void }>;

  beforeEach(() => {
    const created = createInMemoryDb();
    db = created.db;
    logger = createLogger();
    recordStore = new ExecutionRecordStore(created.port, logger);
    spies = [
      jest.spyOn(ChainSessionStore.prototype as any, 'saveSessions').mockResolvedValue(undefined),
      jest.spyOn(ChainSessionStore.prototype as any, 'loadSessions').mockResolvedValue(undefined),
      jest
        .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
        .mockImplementation(() => {}),
    ];
    sessionStore = new ChainSessionStore(logger, new StubTextReferenceStore() as any, {
      cleanupIntervalMs: 60_000,
    });
  });

  afterEach(async () => {
    await sessionStore.cleanup();
    for (const spy of spies) spy.mockRestore();
    db.close();
  });

  const text = (response: { content?: Array<{ text?: string }> }): string =>
    (response.content ?? []).map((c) => c.text ?? '').join('\n');

  const run = (): ChainSession =>
    Array.from((sessionStore as any).activeSessions.values())[0] as ChainSession;

  const stepOf = (nodeId: string) => run().state.stepStates?.get(nodeId);

  /** Capture-time rows (real outputs), oldest first. */
  const capturedRows = (sessionId: string) =>
    db
      .prepare(
        `SELECT step_number, node_id, handoff_evidence FROM execution_records
         WHERE session_id = ? AND status = 'completed' AND step_number IS NOT NULL
         ORDER BY execution_id ASC`
      )
      .all(sessionId);

  /** Start the chain and answer step 1, which renders the detached step 2. */
  const renderDetached = async (pipeline: PromptExecutionPipeline) => {
    await pipeline.execute({ command: '>>draft --> >>review --> >>summarize' } as any);
    const { chainId, sessionId } = run();
    const rendered = await pipeline.execute({
      chain_id: chainId,
      user_response: 'step 1 output',
    } as any);
    return { chainId, sessionId, brief: text(rendered), rendered };
  };

  describe('a detached step in the middle of a chain', () => {
    test('renders its brief with background spawn + report-later instructions, and is spawned', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true }),
      });
      const { brief, rendered } = await renderDetached(pipeline);

      expect(rendered.isError).not.toBe(true);
      expect(brief).toContain('EXECUTION BRIEF');
      expect(brief).toContain(`node: ${DETACHED}`);
      expect(brief).toContain('run_in_background: true');
      expect(brief).not.toContain('run_in_background: false');
      expect(brief).toContain('Do NOT wait for the sub-agent');
      expect(run().state.currentNodeId).toBe(DETACHED);
      expect(stepOf(DETACHED)?.spawnedAt).toEqual(expect.any(Number));
    });

    test('an empty resume moves past it; the late result lands on it by token, not on the current step', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true }),
      });
      const { chainId, sessionId, brief } = await renderDetached(pipeline);

      const moved = await pipeline.execute({ chain_id: chainId } as any);
      expect(moved.isError).not.toBe(true);
      expect(text(moved)).toContain('Do Summarize.');
      expect(run().state.currentNodeId).toBe('n3');
      // Passed, not reported: a placeholder stands in until the worker's result arrives.
      expect(stepOf(DETACHED)).toMatchObject({ state: 'completed', isPlaceholder: true });

      const landed = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief, { body: 'the detached review' }),
      } as any);
      expect(landed.isError).not.toBe(true);
      expect(text(landed)).toContain(`✓ Detached node ${DETACHED} (step 2) reported`);
      // Landed on the detached node; the run did not move and step 3 captured nothing.
      expect(stepOf(DETACHED)).toMatchObject({ state: 'completed', isPlaceholder: false });
      expect(run().state.currentNodeId).toBe('n3');
      expect(capturedRows(sessionId)).toEqual([
        { step_number: 1, node_id: 'n1', handoff_evidence: null },
        { step_number: 2, node_id: DETACHED, handoff_evidence: 'ok' },
      ]);

      // Already reported: a second report is refused by name and applied nowhere.
      const again = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief, { body: 'a second copy' }),
      } as any);
      expect(again.isError).toBe(true);
      expect(text(again)).toContain(`Detached node ${DETACHED} (step 2) already reported`);
      expect(capturedRows(sessionId)).toHaveLength(2);

      // Nothing is owed any more, so answering the last step completes the run at once.
      await pipeline.execute({ chain_id: chainId, user_response: 'step 3 output' } as any);
      expect(run().runStatus).toBe('completed');
    });

    test('while a gate review holds the run, an empty resume does not pass the detached step', async () => {
      // The review's verdict path owns the advance (it moves the run on a PASS, as for any step);
      // the detached pass must not run underneath it and advance a run the review is holding.
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true }),
      });
      const { chainId, sessionId } = await renderDetached(pipeline);
      await sessionStore.setPendingGateReview(sessionId, {
        combinedPrompt: 'Review the step.',
        gateIds: ['held-review'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 0,
        maxAttempts: 2,
      } as never);

      await pipeline.execute({ chain_id: chainId } as any);
      expect(run().state.currentNodeId).toBe(DETACHED);
      expect(stepOf(DETACHED)?.state).not.toBe('completed');
      // Still spawned and owed: nothing reported it.
      expect(stepOf(DETACHED)?.spawnedAt).toEqual(expect.any(Number));
    });

    test('a non-empty reply without the trailer at the detached step is refused with both options', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true }),
      });
      const { chainId, sessionId } = await renderDetached(pipeline);

      const refused = await pipeline.execute({
        chain_id: chainId,
        user_response: 'spawned the worker',
      } as any);
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain(`Step 2 (node ${DETACHED}) is detached`);
      expect(text(refused)).toContain('NO user_response');
      expect(run().state.currentNodeId).toBe(DETACHED);
      expect(capturedRows(sessionId)).toHaveLength(1);
    });

    test('a trailer naming a detached node the run has not spawned yet is refused, and nothing moves', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true }),
      });
      await pipeline.execute({ command: '>>draft --> >>review --> >>summarize' } as any);
      const { chainId, sessionId } = run();

      const refused = await pipeline.execute({
        chain_id: chainId,
        user_response: `early\n\nHANDOFF RESULT\nnode: ${DETACHED}`,
      } as any);
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain(
        `Detached node ${DETACHED} (step 2) has not been spawned yet`
      );
      expect(run().state.currentNodeId).toBe('n1');
      expect(capturedRows(sessionId)).toEqual([]);
    });
  });

  describe('the close guard: a detached LAST step', () => {
    test('the run is held open, refuses what does not report, and completes when the result lands', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true, detachedLast: true }),
      });
      await pipeline.execute({ command: '>>draft --> >>review' } as any);
      const { chainId, sessionId } = run();
      const brief = text(
        await pipeline.execute({ chain_id: chainId, user_response: 'step 1 output' } as any)
      );

      // Moving past the last step: the run walks off its end but may not complete.
      const held = await pipeline.execute({ chain_id: chainId } as any);
      const heldText = text(held);
      expect(held.isError).not.toBe(true);
      expect(heldText).toContain(
        `stays open until its detached node(s) report: ${DETACHED} (step 2)`
      );
      expect(heldText).toContain(`node: ${DETACHED}`);
      expect(heldText).not.toMatch(/[Cc]hain complete|Execution complete/);
      expect(run().state.currentNodeId).toBeNull();
      expect(run().runStatus ?? 'working').toBe('working');

      // A resume that reports nothing is refused, naming the node and its token.
      const nothing = await pipeline.execute({ chain_id: chainId, user_response: 'done?' } as any);
      expect(nothing.isError).toBe(true);
      expect(text(nothing)).toContain(`${DETACHED} (step 2)`);

      // A wrong token is refused by name and recorded nowhere.
      const wrong = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief, { overrideToken: 'not-a-node' }),
      } as any);
      expect(wrong.isError).toBe(true);
      expect(text(wrong)).toContain('names node not-a-node, which is no detached node of this run');
      expect(run().runStatus ?? 'working').toBe('working');
      expect(capturedRows(sessionId)).toHaveLength(1);

      // POSITIVE CONTROL for every refusal above: the conforming late result lands and closes.
      const landed = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief),
      } as any);
      expect(landed.isError).not.toBe(true);
      expect(text(landed)).toContain('✅ Chain complete');
      expect(run().runStatus).toBe('completed');
      expect(capturedRows(sessionId)).toEqual([
        { step_number: 1, node_id: 'n1', handoff_evidence: null },
        { step_number: 2, node_id: DETACHED, handoff_evidence: 'ok' },
      ]);
    });

    test('cancel still ends a held run — a worker that never reports is not a deadlock', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true, detachedLast: true }),
      });
      await pipeline.execute({ command: '>>draft --> >>review' } as any);
      const { chainId, sessionId } = run();
      await pipeline.execute({ chain_id: chainId, user_response: 'step 1 output' } as any);
      await pipeline.execute({ chain_id: chainId } as any);
      expect(run().runStatus ?? 'working').toBe('working');

      expect(await sessionStore.cancelChain(sessionId)).toBe(true);
      expect(run().runStatus).toBe('cancelled');
    });
  });

  describe('a delegated FIRST step (row 4.9)', () => {
    // The call that opens the run is a brief, not a resume. Before row 4.9 the resume admission
    // ran on it anyway and refused every chain whose first step is delegated with "the resume
    // carries no worker reply". The delegated-second-step twin is every test above; the
    // non-delegated-first twin is `renderDetached`'s own opening call.
    test.each([
      ['detached (await: run)', true, 'run_in_background: true'],
      ['blocking (delegated: true)', false, 'run_in_background: false'],
    ] as const)('%s: the opening call renders its brief', async (_label, detached, pin) => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached, delegatedFirst: true }),
      });
      const opened = await pipeline.execute({
        command: '>>review --> >>draft --> >>summarize',
      } as any);

      expect(text(opened)).not.toContain('the resume carries no worker reply');
      expect(opened.isError).not.toBe(true);
      expect(text(opened)).toContain('EXECUTION BRIEF');
      expect(text(opened)).toContain(`node: ${DETACHED}`);
      expect(text(opened)).toContain(pin);
      expect(run().state.currentNodeId).toBe(DETACHED);
    });

    test('the detached first step then moves on and reports late, exactly as a later one does', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: true, delegatedFirst: true }),
      });
      const brief = text(
        await pipeline.execute({ command: '>>review --> >>draft --> >>summarize' } as any)
      );
      const { chainId } = run();

      const moved = await pipeline.execute({ chain_id: chainId } as any);
      expect(moved.isError).not.toBe(true);
      expect(text(moved)).toContain('Do Draft.');
      expect(run().state.currentNodeId).toBe('n1');

      const landed = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief),
      } as any);
      expect(text(landed)).toContain(`✓ Detached node ${DETACHED} (step 1) reported`);
    });
  });

  describe('blocking control: the same chain with `await` absent', () => {
    test('an empty resume at the delegated step is refused and the handoff pins the foreground', async () => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        steps: parsedSteps({ detached: false }),
      });
      const { chainId, brief } = await renderDetached(pipeline);
      expect(brief).toContain('run_in_background: false');
      expect(brief).not.toContain('Do NOT wait');
      expect(stepOf(DETACHED)?.spawnedAt).toBeUndefined();

      const refused = await pipeline.execute({ chain_id: chainId } as any);
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain(
        `❌ Delegated node ${DETACHED}: the resume carries no worker reply`
      );
      expect(run().state.currentNodeId).toBe(DETACHED);
    });
  });
});
