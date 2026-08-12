// @lifecycle test - P3 Tier 3 row 17: the three P2 lifecycle defects, driven as a client drives them.
/**
 * Chain run lifecycle, from the client's side of the tool boundary.
 *
 * The P2 live drive found three defects that every test in the repo missed, and it missed them
 * for one reason: the suites reached completion by *constructing* `currentStep > totalSteps`,
 * a state no client that obeys the rendered footer ever produces. So this suite never writes
 * session state. It hands `PromptExecutionPipeline` the same request shapes a client sends —
 * `{command}`, then `{chain_id, user_response, gate_verdict}` — and reads back only what a
 * client can read: the rendered text, the `execution_records` ledger, and the store's own
 * `runStatus`.
 *
 * Real production units: SessionManagementStage, StepResponseCaptureStage, StepExecutionStage,
 * GateReviewStage, ResponseFormattingStage, ChainSessionStore, GateVerdictProcessor,
 * StepCaptureService, GateEnforcementAuthority, ChainOperatorExecutor, ResponseAssembler,
 * ExecutionRecordStore against real in-memory SQLite. The stubbed stages stand in for parsing,
 * planning and gate selection — they supply this request's inputs and decide nothing about
 * lifecycle.
 *
 * The DDL below mirrors `execution_records` in sqlite-engine.ts, as run-telemetry does: drift
 * surfaces here as a SQL error rather than as a silently-swallowed append.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SqliteEngine } from '../../../src/infra/database/index.js';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { renderGateVerdict } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { SessionManagementStage } from '../../../src/engine/execution/pipeline/stages/13-session-stage.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { StepExecutionStage } from '../../../src/engine/execution/pipeline/stages/18-execution-stage.js';
import { GateReviewStage } from '../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const CHAIN_BASE = 'chain-lifecycle-demo';
const GATE_ID = 'step-quality';

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

/**
 * The bundled resource an adaptive insertion points at (OQ-P4-1). Registered here the same way
 * a real server registers it — by id, in the executor's prompt list — so the render path has to
 * resolve it through `promptId` rather than through a position in the parsed chain, which is
 * exactly the P4 row 3.4 contract. Its template echoes both arguments so the test can tell
 * "rendered the investigation prompt" apart from "rendered it with nothing in it".
 */
const INVESTIGATION_PROMPT: ConvertedPrompt = {
  id: 'investigate_unknown',
  name: 'Investigate Unknown',
  description: 'Investigate one blocking unknown declared during a chain run.',
  category: 'workflow',
  userMessageTemplate: 'Investigate {{unknown_id}}: {{statement}}',
  systemMessage: '',
  arguments: [],
};

const PROMPTS: ConvertedPrompt[] = [
  stepPrompt('draft', 'Draft'),
  stepPrompt('review', 'Review'),
  stepPrompt('analyze', 'Analyze'),
  INVESTIGATION_PROMPT,
];

/** The parsed chain a client's `>>draft --> >>review` produces, node ids already minted. */
const parsedChainSteps = () => [
  { stepNumber: 1, nodeId: 'draft', promptId: 'draft', args: {}, convertedPrompt: PROMPTS[0] },
  { stepNumber: 2, nodeId: 'review', promptId: 'review', args: {}, convertedPrompt: PROMPTS[1] },
];

/** `>>draft --> >>analyze --> >>review` — a chain with a node BETWEEN the first and the last. */
const parsedThreeStepChain = () => [
  { stepNumber: 1, nodeId: 'draft', promptId: 'draft', args: {}, convertedPrompt: PROMPTS[0] },
  { stepNumber: 2, nodeId: 'analyze', promptId: 'analyze', args: {}, convertedPrompt: PROMPTS[2] },
  { stepNumber: 3, nodeId: 'review', promptId: 'review', args: {}, convertedPrompt: PROMPTS[1] },
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

/** Stage order accepted by validateStageOrder; only the five real stages do anything. */
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

/**
 * Wire the pipeline over ONE session store.
 *
 * A factory rather than inline wiring because the P4 cold-load case needs a SECOND pipeline over
 * a second store reading the same database — a reconstruction from rows is only a reconstruction
 * if the store that reads was never the store that wrote.
 */
const buildPipeline = (options: {
  sessionStore: ChainSessionStore;
  recordStore: ExecutionRecordStore;
  logger: Logger;
  steps: () => ReturnType<typeof parsedChainSteps>;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger } = options;
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);

  const realStages: Record<string, PipelineStage> = {
    SessionManagement: new SessionManagementStage(sessionStore, logger),
    StepResponseCapture: new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, logger),
      new StepCaptureService(sessionStore, logger),
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
    GateReview: new GateReviewStage(
      chainExecutor,
      sessionStore,
      null,
      logger,
      undefined,
      recordStore
    ),
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

    // Stubs for the stages this suite does not exercise. They supply THIS request's parsed
    // inputs and gate selection — never lifecycle state.
    if (name === 'CommandParsing') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.parsedCommand = {
            commandType: 'chain',
            promptId: 'draft',
            chainId: CHAIN_BASE,
            steps: options.steps(),
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

describe('chain run lifecycle, driven the way a client drives it', () => {
  let db: DatabaseSync;
  let recordStore: ExecutionRecordStore;
  let sessionStore: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;
  /**
   * Which parsed chain the CommandParsing stub supplies. Defaults to the two-step chain every
   * pre-existing test in this suite drives; one P4 test swaps in a three-step chain, because a
   * two-step chain cannot distinguish "renders the right node" from "clamps to the last parse
   * step and happens to be right" — the clamp always lands on the final step, so only a chain
   * with a node BETWEEN the first and the last can fail the old behaviour.
   */
  let parsedSteps: () => ReturnType<typeof parsedChainSteps>;

  beforeEach(() => {
    parsedSteps = parsedChainSteps;
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
      serverRoot: '/tmp/test-step-lifecycle-integration',
      cleanupIntervalMs: 60_000,
    });

    pipeline = buildPipeline({
      sessionStore,
      recordStore,
      logger,
      steps: () => parsedSteps(),
    });
  });

  afterEach(async () => {
    await sessionStore.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
    db.close();
  });

  /** Exactly what the tool returns to the client, as text. */
  const textOf = (response: { content: Array<{ text?: string }> }): string =>
    response.content.map((part) => part.text ?? '').join('\n');

  const onlySession = () => {
    const sessions = Array.from((sessionStore as any).activeSessions.values());
    expect(sessions).toHaveLength(1);
    return sessions[0] as {
      sessionId: string;
      chainId: string;
      runStatus?: string;
      pendingGateReview?: unknown;
      state: { currentNodeId: string | null };
    };
  };

  const workingRows = (sessionId: string): Array<{ step_number: number | null }> =>
    db
      .prepare(
        `SELECT step_number FROM execution_records
         WHERE session_id = ? AND status = 'working' ORDER BY execution_id ASC`
      )
      .all(sessionId) as Array<{ step_number: number | null }>;

  /**
   * A structured `gate_verdict` after the boundary normalization `mcp/tools/index.ts` performs
   * before the pipeline ever sees it. Rendering it here rather than hand-writing the legacy
   * string keeps the drive on the contract a real client goes through.
   */
  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'meets the gate',
    per_gate: [{ index: 1, passed: true, rationale: `${GATE_ID}: satisfied` }],
  });

  /**
   * Drive the two-step chain to completion the way a client does: start, then answer each
   * rendered prompt. No call in here writes session state, and none of them is "one extra
   * call to finish it off" — the run has to end on its own final verdict.
   */
  const driveToFinalStep = async (): Promise<{ chainId: string; texts: string[] }> => {
    const texts: string[] = [];

    texts.push(textOf(await pipeline.execute({ command: `>>draft --> >>review` })));
    const chainId = onlySession().chainId;

    // Step 1 output + its gate verdict.
    texts.push(
      textOf(
        await pipeline.execute({
          chain_id: chainId,
          user_response: 'step 1 output',
          gate_verdict: passVerdict,
        } as any)
      )
    );
    // Step 2 output — the run now stands at 2/2 with a review open.
    texts.push(
      textOf(await pipeline.execute({ chain_id: chainId, user_response: 'step 2 output' } as any))
    );

    return { chainId, texts };
  };

  const driveToCompletion = async (): Promise<{ chainId: string; texts: string[] }> => {
    const { chainId, texts } = await driveToFinalStep();
    // The FINAL verdict. Nothing follows it.
    texts.push(
      textOf(await pipeline.execute({ chain_id: chainId, gate_verdict: passVerdict } as any))
    );
    return { chainId, texts };
  };

  test('the final PASS verdict completes the run — no extra call', async () => {
    const { texts } = await driveToCompletion();

    const session = onlySession();
    expect(session.runStatus).toBe('completed');
    expect(session.state.currentNodeId).toBeNull();
    expect(texts[3]).toContain('✓ Chain complete (2/2)');
    expect(texts[3]).toContain('No user_response needed');
  });

  test('the footer does not claim completion while the final step still owes a verdict', async () => {
    const { texts } = await driveToFinalStep();

    // The response to step 2's output: the run stands at 2/2 with a review open. This is the
    // exact call that rendered "✓ Chain complete (2/2) … No user_response needed" against a
    // `working` run, so a banner-obeying client stopped driving right here.
    const atFinalStep = texts[2];
    expect(atFinalStep).not.toContain('Chain complete');
    expect(atFinalStep).not.toContain('No user_response needed');
    expect(atFinalStep).toContain('Final step 2/2');
    expect(atFinalStep).toContain('awaiting gate verdict');
    expect(atFinalStep).toContain('gate_verdict');

    // The store agrees: the run is not finished, and the text no longer says otherwise.
    expect(onlySession().runStatus).toBe('working');
  });

  test('step 1 is ledgered on the chain-start call', async () => {
    await pipeline.execute({ command: `>>draft --> >>review` });

    const session = onlySession();
    expect(workingRows(session.sessionId).map((row) => row.step_number)).toEqual([1]);
  });

  test('a fully driven run ledgers every planned step, not one short', async () => {
    await driveToCompletion();

    const session = onlySession();
    const distinctSteps = new Set(workingRows(session.sessionId).map((row) => row.step_number));
    // `executed` in system_control execution_history is COUNT(DISTINCT step_number). It
    // reported 2 of 3 on every live run because step 1 never got a row.
    expect(Array.from(distinctSteps).sort()).toEqual([1, 2]);
  });

  /**
   * P4 Tier 3.3 — what the client observes after an adaptive insertion.
   *
   * Driven the way a client drives it: the step-1 call carries `user_response`, its gate
   * verdict, and a BLOCKING `unknown_discovered`. Nothing here writes session state.
   */
  const driveBlockingUnknownAtStep1 = async (): Promise<{
    chainId: string;
    sessionId: string;
    text: string;
  }> => {
    await pipeline.execute({ command: `>>draft --> >>review` });
    const { chainId, sessionId } = onlySession();
    const text = textOf(
      await pipeline.execute({
        chain_id: chainId,
        user_response: 'step 1 output',
        gate_verdict: passVerdict,
        observations: [
          {
            type: 'unknown_discovered',
            id: 'cache-ttl',
            statement: 'TTL undecided',
            blocking: true,
          },
        ],
      } as any)
    );
    return { chainId, sessionId, text };
  };

  const nodesOf = (sessionId: string): Array<{ id: string; promptId: string; origin?: string }> =>
    (sessionStore as any).activeSessions.get(sessionId).state.nodes;

  test('a blocking unknown inserts an investigation node and the run advances onto it', async () => {
    const { sessionId } = await driveBlockingUnknownAtStep1();

    expect(nodesOf(sessionId).map((node) => node.id)).toEqual(['draft', 'inv-cache-ttl', 'review']);
    expect(nodesOf(sessionId)[1]).toMatchObject({
      promptId: 'investigate_unknown',
      origin: 'inserted',
    });
    // The inserted node is the run's next node with no extra round-trip: it lands immediately
    // after the node the discovery was declared at, so `advanceStep`'s `nextAfter` finds it.
    expect(onlySession().state.currentNodeId).toBe('inv-cache-ttl');
  });

  test('the rendered totals reflect the mutated node list, not the parsed one', async () => {
    const { text } = await driveBlockingUnknownAtStep1();

    // The chain was parsed with two steps. The footer must speak the run's CURRENT list.
    expect(text).toContain('Progress 2/3');
    expect(text).not.toContain('/2');
  });

  test('an early-exit call republishes the mutated totals — capture never runs there', async () => {
    // A client may declare an unknown on the very call that CREATES the run. That call exits
    // at the `create-new` branch, before StepCaptureService (whose own syncSessionContext is
    // what refreshes totals on the capture path). Without stage 16 republishing them here, the
    // footer renders the PRE-mutation denominator for a run that already has three nodes.
    const text = textOf(
      await pipeline.execute({
        command: `>>draft --> >>review`,
        observations: [
          {
            type: 'unknown_discovered',
            id: 'cache-ttl',
            statement: 'TTL undecided',
            blocking: true,
          },
        ],
      } as any)
    );

    expect(nodesOf(onlySession().sessionId).map((node) => node.id)).toEqual([
      'draft',
      'inv-cache-ttl',
      'review',
    ]);
    expect(text).toContain('Progress 1/3');
  });

  // --- P4 row 3.4 (DEV-T3-7): rendering is NODE-driven, not ordinal-indexed ------------------
  //
  // Every assertion below reads the rendered BODY, not the footer. The footer was already
  // correct when this defect was found ("Progress 2/3" on a three-node run) — what was wrong was
  // the text underneath it, because the body came from `parsedCommand.steps[currentStep - 1]`
  // while the ordinal came from the mutated node list.

  test('the inserted node renders its OWN prompt, not the next planned one', async () => {
    const { text } = await driveBlockingUnknownAtStep1();

    // The measured defect: the run correctly stood at `inv-cache-ttl` and correctly said
    // "Progress 2/3", and then rendered `review`'s template because that is what sat at index 1
    // of the parse-time array.
    expect(text).toContain('Investigate cache-ttl: TTL undecided');
    expect(text).not.toContain('Do Review.');
    expect(text).toContain('Progress 2/3');
  });

  test('every planned node past an insertion renders its own prompt, and the last stays reachable', async () => {
    // Three parse steps, so the node the run lands on after the investigation (`analyze`, now at
    // ordinal 3) is NOT the last parse step. That is the case the old clamp could not survive:
    // `Math.min(3, 3) - 1` indexed `review`, so `analyze` rendered the final step's prompt and
    // `review` — the actual last node, now at ordinal 4 — had no index left to reach.
    parsedSteps = parsedThreeStepChain;

    await pipeline.execute({ command: `>>draft --> >>analyze --> >>review` });
    const { chainId } = onlySession();

    await pipeline.execute({
      chain_id: chainId,
      user_response: 'step 1 output',
      gate_verdict: passVerdict,
      observations: [
        { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided', blocking: true },
      ],
    } as never);

    expect(nodesOf(onlySession().sessionId).map((node) => node.id)).toEqual([
      'draft',
      'inv-cache-ttl',
      'analyze',
      'review',
    ]);

    const atAnalyze = textOf(
      await pipeline.execute({
        chain_id: chainId,
        user_response: 'investigation output',
        gate_verdict: passVerdict,
      } as never)
    );
    expect(onlySession().state.currentNodeId).toBe('analyze');
    expect(atAnalyze).toContain('Do Analyze.');
    expect(atAnalyze).not.toContain('Do Review.');
    expect(atAnalyze).toContain('Progress 3/4');

    const atReview = textOf(
      await pipeline.execute({
        chain_id: chainId,
        user_response: 'analysis output',
        gate_verdict: passVerdict,
      } as never)
    );
    expect(onlySession().state.currentNodeId).toBe('review');
    expect(atReview).toContain('Do Review.');
    expect(atReview).not.toContain('Do Analyze.');
    expect(atReview).toContain('Progress 4/4');
  });

  test('a run with no mutation renders each planned step at its own ordinal, unchanged', async () => {
    // The byte-identity criterion in observable form: with an empty node list mutation, the
    // projection hands the renderer the very same step objects in the same order, so the bodies
    // and the ordinals are what they were before rendering became node-driven.
    const { texts } = await driveToFinalStep();

    expect(texts[0]).toContain('Do Draft.');
    expect(texts[0]).toContain('Progress 1/2');
    expect(texts[0]).not.toContain('Do Review.');

    expect(texts[1]).toContain('Do Review.');
    expect(texts[1]).toContain('2/2');
    expect(texts[1]).not.toContain('Do Draft.');
  });

  test('resuming a completed run answers "already complete" and opens no review', async () => {
    const { chainId } = await driveToCompletion();

    const response = await pipeline.execute({
      chain_id: chainId,
      user_response: 'more output nobody asked for',
    } as any);

    const text = textOf(response);
    expect(text).toContain('already complete');
    expect(text).toContain(chainId);
    expect(text).toContain('completed');

    const session = onlySession();
    expect(session.pendingGateReview).toBeUndefined();
    expect(session.runStatus).toBe('completed');
    // No review means no attempt counter, and no re-rendered step.
    expect(text).not.toContain('attempt 1/');
    expect(text).not.toContain('Review Required');
  });
});

/**
 * P4 row 4.2 (F10) — a MUTATED run survives a cold load.
 *
 * The other describe in this file mocks `saveSessions`/`loadSessions`, which is right for
 * lifecycle-from-the-client's-side but structurally blind to persistence: an insertion that never
 * reached a row, and a skip that never reached a `milestone` column, both pass there. So this
 * block runs against the REAL `SqliteEngine` schema and hands the reload to a SECOND
 * `ChainSessionStore` over the same file — a reconstruction from rows is only a reconstruction if
 * the store that reads was never the store that wrote.
 *
 * It is also this phase's in-thread detector for master-ledger P4-F1: `persistSessions` catches
 * and logs its write failures, so every store operation can report success after a silent persist
 * failure. A mutation that did not persist fails the reload assertions below and nothing else.
 */
describe('a mutated run survives a cold load (P4 row 4.2 / F10)', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;

  const newStore = (): ChainSessionStore =>
    new ChainSessionStore(
      logger,
      new StubTextReferenceStore() as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-p4-coldload' } },
      engine
    );

  const forcePersist = async (store: ChainSessionStore): Promise<void> =>
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();

  const awaitInit = async (store: ChainSessionStore): Promise<void> =>
    await (store as unknown as { initPromise: Promise<void> }).initPromise;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-cold-load-'));
    logger = createLogger();
    engine = await SqliteEngine.getInstance(tmpDir, logger);
    await engine.initialize();
  });

  afterAll(async () => {
    await engine.shutdown();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  beforeEach(() => {
    engine.run('DELETE FROM chain_run_nodes');
    engine.run('DELETE FROM chain_runs');
    engine.run('DELETE FROM chain_sessions');
    engine.run('DELETE FROM execution_records');
  });

  const textOf = (response: { content: Array<{ text?: string }> }): string =>
    response.content.map((part) => part.text ?? '').join('\n');

  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'meets the gate',
    per_gate: [{ index: 1, passed: true, rationale: `${GATE_ID}: satisfied` }],
  });

  const onlySessionOf = (store: ChainSessionStore): ChainSession => {
    const sessions = Array.from(
      (store as unknown as { activeSessions: Map<string, ChainSession> }).activeSessions.values()
    );
    expect(sessions).toHaveLength(1);
    return sessions[0] as ChainSession;
  };

  /**
   * Drive both mutation directions on a live store, then persist and drop it.
   *
   * Step 1 declares a BLOCKING unknown that also names `review` as the step it would make
   * pointless; the investigation node's own call resolves that unknown as irrelevant, which
   * retires `review`. One run, both directions, no session state written by the test.
   */
  const driveMutatedRunAndPersist = async (): Promise<{ chainId: string; sessionId: string }> => {
    const writer = newStore();
    await awaitInit(writer);
    const recordStore = new ExecutionRecordStore(engine, logger);
    const pipeline = buildPipeline({
      sessionStore: writer,
      recordStore,
      logger,
      steps: parsedThreeStepChain,
    });

    await pipeline.execute({ command: `>>draft --> >>analyze --> >>review` });
    const { chainId, sessionId } = onlySessionOf(writer);

    await pipeline.execute({
      chain_id: chainId,
      user_response: 'step 1 output',
      gate_verdict: passVerdict,
      observations: [
        {
          type: 'unknown_discovered',
          id: 'cache-ttl',
          statement: 'TTL undecided',
          blocking: true,
          target_step_id: 'review',
        },
      ],
    } as never);

    await pipeline.execute({
      chain_id: chainId,
      user_response: 'investigation output',
      gate_verdict: passVerdict,
      observations: [
        {
          type: 'unknown_resolved',
          id: 'cache-ttl',
          statement: 'the cache layer was cut from scope',
          resolution: 'irrelevant',
        },
      ],
    } as never);

    await forcePersist(writer);
    await writer.cleanup();

    return { chainId, sessionId };
  };

  /**
   * P4 row 5.1 — THE phase acceptance test (master plan §P4: "Both directions demonstrated in
   * one E2E test or the phase is not done"). One run, driven the way a client drives it:
   * a blocking unknown expands the run, an irrelevant resolution contracts it, the run
   * completes, and the terminal record audits both. Every assertion is client-observable
   * (rendered text or queryable rows), never fabricated internal state.
   */
  test('P4 acceptance: one run expands on a blocking unknown AND contracts on an irrelevant one, audited', async () => {
    const store = newStore();
    await awaitInit(store);
    const recordStore = new ExecutionRecordStore(engine, logger);
    const pipeline = buildPipeline({
      sessionStore: store,
      recordStore,
      logger,
      steps: parsedThreeStepChain,
    });

    await pipeline.execute({ command: `>>draft --> >>analyze --> >>review` });
    const { chainId, sessionId } = onlySessionOf(store);

    // Direction 1 — EXPAND. The same call that carries the blocking observation renders the
    // inserted investigation node as the next step: no extra round-trip (F5), and the body is
    // the investigation prompt, not the next planned step (row 3.4).
    const afterBlocking = textOf(
      await pipeline.execute({
        chain_id: chainId,
        user_response: 'step 1 output',
        gate_verdict: passVerdict,
        observations: [
          {
            type: 'unknown_discovered',
            id: 'cache-ttl',
            statement: 'TTL undecided',
            blocking: true,
            target_step_id: 'review',
          },
        ],
      } as never)
    );
    expect(afterBlocking).toContain('Investigate cache-ttl');
    expect(afterBlocking).not.toContain('Do Analyze.');
    const midRun = onlySessionOf(store);
    expect(midRun.state.nodes.map((node) => node.id)).toEqual([
      'draft',
      'inv-cache-ttl',
      'analyze',
      'review',
    ]);
    expect(midRun.state.currentNodeId).toBe('inv-cache-ttl');

    // Direction 2 — CONTRACT. The investigation resolves the unknown as irrelevant; its
    // declared target retires. The run lands on `analyze`, and `review` is milestone-skipped.
    const afterResolution = textOf(
      await pipeline.execute({
        chain_id: chainId,
        user_response: 'investigation output',
        gate_verdict: passVerdict,
        observations: [
          {
            type: 'unknown_resolved',
            id: 'cache-ttl',
            statement: 'the cache layer was cut from scope',
            resolution: 'irrelevant',
          },
        ],
      } as never)
    );
    expect(afterResolution).not.toContain('Do Review.');
    expect(store.getStepState(sessionId, 'review')?.state).toBe('skipped');

    // Completion — advancing past `analyze` walks over the retired node and latches terminal.
    await pipeline.execute({
      chain_id: chainId,
      user_response: 'analysis output',
      gate_verdict: passVerdict,
    } as never);
    expect((store.getSession(sessionId) as ChainSession).runStatus).toBe('completed');

    // Audit — the terminal execution record carries BOTH counters as values (not merely
    // declared columns), queryable exactly the way `execution_history` reads them.
    const terminal = engine.queryOne<{ nodes_inserted: number; nodes_skipped: number }>(
      `SELECT nodes_inserted, nodes_skipped
         FROM execution_records
        WHERE session_id = ? AND completed_at IS NOT NULL
        ORDER BY execution_id DESC LIMIT 1`,
      [sessionId]
    );
    expect(terminal).not.toBeNull();
    expect(terminal?.nodes_inserted).toBe(1);
    expect(terminal?.nodes_skipped).toBe(1);

    await store.cleanup();
  });

  test('the mutated node list, its provenance and the skip all come back from rows', async () => {
    const { sessionId } = await driveMutatedRunAndPersist();

    const reader = newStore();
    await awaitInit(reader);
    const after = reader.getSession(sessionId) as ChainSession;

    expect(after).toBeDefined();
    // Order and identity: the inserted node sits where it was inserted, and nothing around it
    // was renumbered.
    expect(after.state.nodes.map((node) => node.id)).toEqual([
      'draft',
      'inv-cache-ttl',
      'analyze',
      'review',
    ]);
    expect(after.state.nodes.map((node) => node.origin)).toEqual([
      'planned',
      'inserted',
      'planned',
      'planned',
    ]);
    // Provenance, not just the flag: the per-unknown insertion cap is recomputed from this after
    // a restart, so a resumed run that lost it would insert a second investigation node for an
    // unknown that already had one.
    expect(after.state.nodes[1]?.originUnknownId).toBe('cache-ttl');
    expect(after.state.nodes[3]?.originUnknownId).toBeUndefined();

    // The skip is a milestone on a preserved row, so it survives as a lifecycle rather than as
    // an absence that would be indistinguishable from a node that was never there.
    expect(reader.getStepState(sessionId, 'review')?.state).toBe('skipped');
    expect(reader.getStepState(sessionId, 'analyze')?.state).not.toBe('skipped');

    // The ledger that motivated both mutations comes back too — the render path reads an
    // inserted node's statement out of it.
    expect(after.unknownsLedger?.map((entry) => [entry.id, entry.state, entry.resolution])).toEqual(
      [['cache-ttl', 'resolved', 'irrelevant']]
    );

    await reader.cleanup();
  });

  test('the reloaded run resumes at the right node and renders THAT node’s prompt', async () => {
    const { chainId, sessionId } = await driveMutatedRunAndPersist();

    const reader = newStore();
    await awaitInit(reader);
    // Reconstructed, then resumed: the run stands on `analyze`, the node after the investigation
    // step, with `review` retired ahead of it.
    expect((reader.getSession(sessionId) as ChainSession).state.currentNodeId).toBe('analyze');

    const resumed = buildPipeline({
      sessionStore: reader,
      recordStore: new ExecutionRecordStore(engine, logger),
      logger,
      steps: parsedThreeStepChain,
    });

    const atAnalyze = textOf(
      await resumed.execute({ chain_id: chainId, user_response: 'resumed output' } as never)
    );

    // Ties row 4.2 to row 3.4: after a cold load the ordinals come from the reconstructed node
    // list, so a render path still indexing the parse-time array would show a different prompt
    // here than the one the run is actually standing on. This particular call lands on the GATE
    // REVIEW render (the resume carries no verdict), which quotes the reviewed step's own task —
    // and it quoted `review`'s until stage 20 became node-driven too.
    expect(atAnalyze).toContain('Do Analyze.');
    expect(atAnalyze).not.toContain('Do Review.');
    expect(atAnalyze).not.toContain('Investigate cache-ttl');

    await reader.cleanup();
  });

  test('the retired node never renders, and the run completes past it', async () => {
    const { chainId, sessionId } = await driveMutatedRunAndPersist();

    const reader = newStore();
    await awaitInit(reader);
    const resumed = buildPipeline({
      sessionStore: reader,
      recordStore: new ExecutionRecordStore(engine, logger),
      logger,
      steps: parsedThreeStepChain,
    });

    // Answer `analyze`. `advanceStep` walks over the retired `review` node, so the next thing
    // the client sees is completion — not the step whose work the resolution made pointless.
    const afterAnalyze = textOf(
      await resumed.execute({
        chain_id: chainId,
        user_response: 'analysis output',
        gate_verdict: passVerdict,
      } as never)
    );

    expect(afterAnalyze).not.toContain('Do Review.');
    expect((reader.getSession(sessionId) as ChainSession).runStatus).toBe('completed');
    // The row is retired, not deleted: it still counts toward the run's total.
    expect((reader.getSession(sessionId) as ChainSession).state.nodes).toHaveLength(4);

    await reader.cleanup();
  });
});
