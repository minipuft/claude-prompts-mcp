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
import { PHASE_GUARD_GATE_ID } from '../../../src/engine/execution/pipeline/stages/19-phase-guard-verification-stage.js';
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
  /**
   * Stand a phase-guard review up on the FIRST call that carries a `user_response` — the live
   * shape a `>>a ==> >>b` run hits under CAGEERF, where step 1's output fails a structural guard.
   * The stub writes exactly what `19-phase-guard-verification-stage.ts:196-224` writes (a review
   * whose `gateIds` is `[PHASE_GUARD_GATE_ID]`, no reviewed-step index in its metadata, persisted
   * through the store AND republished on `context.sessionContext`), because the render under test
   * is stage 20's and everything it can see about the review comes from those two writes. What is
   * NOT reproduced is the guard's own decision to fail, which is not what these cases assert.
   */
  raisePhaseGuardReview?: boolean;
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

  let phaseGuardRaised = false;

  const stages: PipelineStage[] = STAGE_ORDER.map((name) => {
    const real = realStages[name];
    if (real !== undefined) return real;

    if (name === 'PhaseGuardVerification' && options.raisePhaseGuardReview === true) {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          const sessionId = context.sessionContext?.sessionId;
          const outputText = context.mcpRequest.user_response;
          if (phaseGuardRaised || sessionId === undefined || outputText === undefined) return;
          phaseGuardRaised = true;
          const review = {
            combinedPrompt: 'Your output is missing required sections.',
            gateIds: [PHASE_GUARD_GATE_ID],
            prompts: [],
            createdAt: Date.now(),
            attemptCount: 0,
            maxAttempts: 3,
            retryHints: ['Ensure your response includes the required "## Context" section'],
            previousResponse: outputText,
            metadata: {
              source: 'phase-guard-verification',
              failedPhases: ['context_analysis'],
              mode: 'enforce',
            },
          };
          await sessionStore.setPendingGateReview(sessionId, review);
          context.sessionContext = { ...context.sessionContext!, pendingReview: review };
        },
      };
    }

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

    test('POSITIVE CONTROL: a verdict-only resume of the delegated node is refused, and nothing moves', async () => {
      const pipeline = buildPipeline({ sessionStore, recordStore, logger });
      const { chainId, sessionId } = await advanceToDelegatedStep(pipeline);

      // No `user_response` at all — the guarantee-B bypass. The empty reply used to return from
      // the evidence phase before the check ran, and the verdict then advanced the node with
      // nothing captured.
      const refused = await pipeline.execute({
        chain_id: chainId,
        gate_verdict: passVerdict,
      } as any);
      const message = text(refused);

      expect(refused.isError).toBe(true);
      expect(message).toContain(`❌ Delegated node ${DELEGATED_NODE_ID}`);
      // The message names THIS mistake, not the prose-only one the same classification produces.
      expect(message).toContain('carries no worker reply');
      expect(message).toContain(`node: ${DELEGATED_NODE_ID}`);

      // Same "nothing moved" probe the prose-only control uses, and the sibling accept case
      // below shows it seeing a step-2 row when a reply IS carried.
      expect(onlySession().state.currentNodeId).toBe(DELEGATED_NODE_ID);
      expect(capturedRows(sessionId)).toEqual([{ step_number: 1, handoff_evidence: null }]);
    });

    test('the two-call pattern: reply captured first, then a verdict-only call is NOT refused', async () => {
      const pipeline = buildPipeline({ sessionStore, recordStore, logger });
      const { chainId, sessionId, brief } = await advanceToDelegatedStep(pipeline);

      // Call 1 carries the worker's reply and no verdict: this is the call the contract checks,
      // and it captures a real (non-placeholder) output for the delegated node.
      const captured = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(brief),
      } as any);
      expect(captured.isError).not.toBe(true);
      expect(text(captured)).not.toContain('❌ Delegated node');
      expect(capturedRows(sessionId)).toEqual([
        { step_number: 1, handoff_evidence: null },
        { step_number: 2, handoff_evidence: 'ok' },
      ]);

      // Call 2 carries only the verdict. It is exempt because the node it stands on already holds
      // that captured output — the exemption is "already verified", never "no reply present".
      const ratified = await pipeline.execute({
        chain_id: chainId,
        gate_verdict: passVerdict,
      } as any);
      expect(ratified.isError).not.toBe(true);
      expect(text(ratified)).not.toContain('❌ Delegated node');
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

  describe('a phase-guard review standing on the delegated node', () => {
    /**
     * The live shape (`>>creative ==> >>analytical` under CAGEERF): the resume that captures
     * step 1 advances onto the delegated step 2, the phase guard then fails step 1's output and
     * opens a review, and stage 20 re-renders — DISCARDING the brief stage 18 had already put in
     * `executionResults`. The parent was handed a delegated step with nothing to hand a worker.
     */
    const advanceUnderReview = async (): Promise<{
      pipeline: PromptExecutionPipeline;
      chainId: string;
      sessionId: string;
      rendered: string;
    }> => {
      const pipeline = buildPipeline({
        sessionStore,
        recordStore,
        logger,
        raisePhaseGuardReview: true,
      });
      await pipeline.execute({ command: `>>draft ==> >>review` } as any);
      const { chainId, sessionId } = onlySession();
      const rendered = await pipeline.execute({
        chain_id: chainId,
        user_response: 'step 1 output',
        gate_verdict: passVerdict,
      } as any);
      return { pipeline, chainId, sessionId, rendered: text(rendered) };
    };

    test('the first render under the review still carries the brief AND the review CTA', async () => {
      const { rendered } = await advanceUnderReview();

      // The review really is standing (otherwise this asserts the ordinary render path).
      expect(rendered).toContain('Structural Review Required');
      expect(rendered).toContain('Original Task Instructions');
      // ...and the delegation payload is present in the same response.
      expect(rendered).toContain('EXECUTION BRIEF');
      expect(rendered).toContain('HANDOFF INSTRUCTIONS');
      expect(rendered).toContain('HANDOFF RESULT');
      expect(rendered).toContain(`node: ${DELEGATED_NODE_ID}`);
      expect(rendered).toContain('run_in_background: false');
      // The step's own gate text reaches the worker through the brief, as on the normal render.
      expect(rendered).toContain('### Quality Gates');
    });

    test('the brief the review render printed is the one a conforming resume clears it with', async () => {
      const { pipeline, chainId, sessionId, rendered } = await advanceUnderReview();

      // The verdict the review asks for, submitted alone, is still refused — a delegated node
      // does not advance on a verdict. This is the state the live drive found the bypass in.
      const refused = await pipeline.execute({
        chain_id: chainId,
        gate_verdict: passVerdict,
      } as any);
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain(`❌ Delegated node ${DELEGATED_NODE_ID}`);

      // The worker's reply reads the token out of the brief this render printed, so the accept
      // path cannot pass against a brief the review render never emitted.
      const accepted = await pipeline.execute({
        chain_id: chainId,
        user_response: runFakeWorker(rendered),
        gate_verdict: passVerdict,
      } as any);

      expect(accepted.isError).not.toBe(true);
      expect(capturedRows(sessionId)).toEqual([
        { step_number: 1, handoff_evidence: null },
        { step_number: 2, handoff_evidence: 'ok' },
      ]);
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

  test('`advisory` accepts the verdict-only resume at the delegated node', async () => {
    const pipeline = buildPipeline({
      sessionStore,
      recordStore,
      logger,
      evidenceMode: 'advisory',
    });
    const { chainId, sessionId } = await advanceToDelegatedStep(pipeline);

    const accepted = await pipeline.execute({
      chain_id: chainId,
      gate_verdict: passVerdict,
    } as any);

    expect(accepted.isError).not.toBe(true);
    expect(text(accepted)).not.toContain('❌ Delegated node');
    // Measured, and recorded here because it is the behaviour `required` exists to stop: the
    // verdict alone ADVANCES the delegated node — `currentNodeId` is null, the sentinel for a run
    // standing past its terminal node — while writing NO execution record for step 2. A call with
    // no `user_response` is not a capture: `StepCaptureService.resolveTarget`
    // (step-capture-service.ts:144) sends it to the PREVIOUS step, which is already completed and
    // non-placeholder, so `captureStep` returns before writing. The step therefore completes with
    // no output and no row — which is exactly what the same call is refused for under `required`
    // (positive control above), and the only difference between the two modes here.
    expect(capturedRows(sessionId)).toEqual([{ step_number: 1, handoff_evidence: null }]);
    expect(onlySession().state.currentNodeId).toBeNull();
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
