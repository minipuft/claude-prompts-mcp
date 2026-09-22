// @lifecycle test - P4.80: the chain + framework hook/notification events have producers.
/**
 * Chain lifecycle emission, driven the way a client drives it.
 *
 * `TelemetryHookObserver` has registered `onStepComplete`, `onChainComplete` and
 * `onChainFailed` since the hook system landed, and `McpNotificationEmitter` has carried
 * `emitChainStepComplete`, `emitChainComplete` and `emitFrameworkChanged` just as long. None of
 * them had a single caller: "registered" read as "wired", and every gate agreed, because the
 * only test of this surface (`gate-hooks-integration.test.ts`) calls the emit methods itself.
 *
 * So nothing here calls an `emit*` method directly. Every assertion below observes an event
 * ARRIVING at a registered consumer after a real two-step chain is driven through the real
 * pipeline, a real run is cancelled, or a real framework switch persists. Remove any one emit
 * call site in `src/` and exactly one assertion group here goes red.
 *
 * Harness cloned from `chain/delegation-skipped.integration.test.ts`: real
 * SessionManagementStage, StepResponseCaptureStage (holding the real StepCaptureService),
 * StepExecutionStage, GateReviewStage, ResponseFormattingStage, ChainSessionStore and
 * ExecutionRecordStore against real in-memory SQLite. Stubs supply parsing/planning inputs and
 * decide nothing about lifecycle.
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DatabaseSync } from 'node:sqlite';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { SessionManagementStage } from '../../../src/engine/execution/pipeline/stages/13-session-stage.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { StepExecutionStage } from '../../../src/engine/execution/pipeline/stages/18-execution-stage.js';
import { GateReviewStage } from '../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { createFrameworkStateStore } from '../../../src/engine/frameworks/framework-state-store.js';
import { renderGateVerdict } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { HookRegistry } from '../../../src/infra/hooks/index.js';
import {
  McpNotificationEmitter,
  type McpNotificationServer,
} from '../../../src/infra/observability/notifications/index.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { ChainHooks } from '../../../src/infra/hooks/index.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const CHAIN_BASE = 'chain-lifecycle-emission-demo';

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

const parsedChainSteps = () => [
  { stepNumber: 1, nodeId: 'draft', promptId: 'draft', args: {}, convertedPrompt: PROMPTS[0] },
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
  hookRegistry: HookRegistry;
  notificationEmitter: McpNotificationEmitter;
  logger: Logger;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, hookRegistry, notificationEmitter, logger } = options;
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);

  const realStages: Record<string, PipelineStage> = {
    SessionManagement: new SessionManagementStage(sessionStore, logger),
    StepResponseCapture: new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, logger),
      // The announcer under test: the same construction the composition root performs in
      // `pipeline-builder.ts`, holding the registry and the emitter.
      new StepCaptureService(sessionStore, logger, recordStore, hookRegistry, notificationEmitter),
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

/** Every chain notification the emitter pushed, in order, as a client would receive them. */
const chainNotifications = (
  server: { notification: jest.Mock },
  method: string
): Array<Record<string, unknown>> =>
  (server.notification.mock.calls as Array<[{ method: string; params?: Record<string, unknown> }]>)
    .filter(([call]) => call.method === method)
    .map(([call]) => call.params ?? {});

/**
 * The methods the emitter pushed, in order, as ONE value.
 *
 * Per-method counts constrain only the methods someone thought to count, and say nothing about
 * their order relative to each other — which is exactly the axis P4.89 is defective on. A whole
 * sequence compared as one value degrades loudly instead.
 */
const notificationSequence = (server: { notification: jest.Mock }): string[] =>
  (server.notification.mock.calls as Array<[{ method: string }]>).map(([call]) => call.method);

describe('chain lifecycle events reach their registered consumers', () => {
  let db: DatabaseSync;
  let recordStore: ExecutionRecordStore;
  let sessionStore: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;
  let hookRegistry: HookRegistry;
  let notificationEmitter: McpNotificationEmitter;
  let mockServer: { notification: jest.Mock };
  let observed: {
    stepComplete: Array<{ chainId: string; stepIndex: number }>;
    chainComplete: string[];
    chainFailed: Array<{ chainId: string; reason: string }>;
  };
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  /**
   * The store's persistence and scheduler are private; this suite is about what the store
   * ANNOUNCES after a save resolves, not about the save. Narrowing the prototype to just the
   * three members being stubbed keeps that visible instead of hiding it behind `any`.
   */
  type StubbedStoreInternals = {
    saveSessions: () => Promise<void>;
    loadSessions: () => Promise<void>;
    startCleanupScheduler: () => void;
  };

  beforeEach(() => {
    const created = createInMemoryDb();
    db = created.db;
    const logger = createLogger();
    recordStore = new ExecutionRecordStore(created.port, logger);

    hookRegistry = new HookRegistry(logger);
    notificationEmitter = new McpNotificationEmitter(logger);
    mockServer = { notification: jest.fn() };
    notificationEmitter.setServer(mockServer as unknown as McpNotificationServer);

    observed = { stepComplete: [], chainComplete: [], chainFailed: [] };
    // Registered exactly the way TelemetryHookObserver registers — through the public
    // registration API, with no knowledge of who emits.
    const consumer: ChainHooks = {
      onStepComplete: async (chainId, stepIndex) => {
        observed.stepComplete.push({ chainId, stepIndex });
      },
      onChainComplete: async (chainId) => {
        observed.chainComplete.push(chainId);
      },
      onChainFailed: async (chainId, reason) => {
        observed.chainFailed.push({ chainId, reason });
      },
    };
    hookRegistry.registerChainHooks(consumer);

    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as unknown as StubbedStoreInternals, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as unknown as StubbedStoreInternals, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(
        ChainSessionStore.prototype as unknown as StubbedStoreInternals,
        'startCleanupScheduler'
      )
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    sessionStore = new ChainSessionStore(logger, new StubTextReferenceStore() as never, {
      cleanupIntervalMs: 60_000,
    });
    // The same late-bind the composition root performs via PromptExecutor.
    sessionStore.setRunAnnouncementChannels({ hookRegistry, notificationEmitter });

    pipeline = buildPipeline({
      sessionStore,
      recordStore,
      hookRegistry,
      notificationEmitter,
      logger,
    });
  });

  afterEach(async () => {
    await sessionStore.cleanup();
    hookRegistry.clearAll();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
    db.close();
  });

  const onlySession = () => {
    const sessions = Array.from(
      (sessionStore as unknown as { activeSessions: Map<string, unknown> }).activeSessions.values()
    );
    expect(sessions).toHaveLength(1);
    return sessions[0] as { sessionId: string; chainId: string };
  };

  /** Drive a two-step chain from `>>draft ==> >>review` to its terminal status. */
  const driveWholeChain = async (): Promise<{ chainId: string }> => {
    await pipeline.execute({ command: `>>draft ==> >>review` });
    const { chainId } = onlySession();
    await pipeline.execute({ chain_id: chainId, user_response: 'step one output' } as never);
    await pipeline.execute({ chain_id: chainId, user_response: 'step two output' } as never);
    return { chainId };
  };

  test('each captured step announces onStepComplete exactly once, in order', async () => {
    const { chainId } = await driveWholeChain();

    expect(observed.stepComplete).toEqual([
      { chainId, stepIndex: 1 },
      { chainId, stepIndex: 2 },
    ]);
  });

  test('each captured step pushes one notifications/chain/step_complete', async () => {
    const { chainId } = await driveWholeChain();

    expect(chainNotifications(mockServer, 'notifications/chain/step_complete')).toEqual([
      { chainId, stepIndex: 1, status: 'passed' },
      { chainId, stepIndex: 2, status: 'passed' },
    ]);
  });

  test('advancing past the final node announces onChainComplete exactly once', async () => {
    const { chainId } = await driveWholeChain();

    expect(observed.chainComplete).toEqual([chainId]);
    expect(observed.chainFailed).toEqual([]);
  });

  test('a completed run pushes one notifications/chain/complete carrying its status', async () => {
    const { chainId } = await driveWholeChain();

    expect(chainNotifications(mockServer, 'notifications/chain/complete')).toEqual([
      { chainId, totalSteps: 2, status: 'completed' },
    ]);
  });

  /**
   * P4.96 re-measurement. The row reported that an UNGATED chain reaching its terminal status
   * never announces `chain/complete`, while a gated one does. It does not reproduce, here or
   * against a real server: this chain carries no gate and no verdict is ever submitted, and the
   * whole sequence below is what a client receives — `chain/complete` present, and LAST.
   *
   * Pinned as one value rather than as three counts, because the claim is about position: the
   * reported symptom (a missing terminal event) and the known P4.89 ordering defect (a gated run
   * announcing `chain/complete` BEFORE its final `step_complete`) are both invisible to any
   * assertion that only counts.
   */
  test('an ungated run driven to terminal announces the whole sequence, complete last', async () => {
    await driveWholeChain();

    expect(notificationSequence(mockServer)).toEqual([
      'notifications/chain/step_complete',
      'notifications/chain/step_complete',
      'notifications/chain/complete',
    ]);
  });

  /**
   * P4.89. The final step of a GATED run: the client answers it and submits the verdict in one
   * call, which is the shape the server's own footer advertises. The PASS clears the review and
   * advances the run past its last node — and that advance is what announces `chain/complete`,
   * while the step this call answered is not captured until afterwards.
   *
   * The review is set through the store's public API rather than produced by a gate stage: what
   * is under test is the ORDER of two announcements, and a run standing on its final node with a
   * review outstanding is exactly the state a rendered gated step leaves behind.
   */
  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'step two meets the gate',
    per_gate: [{ index: 1, passed: true, rationale: 'step-quality: satisfied' }],
  });

  const driveGatedFinalStep = async (): Promise<{ chainId: string }> => {
    await pipeline.execute({ command: `>>draft ==> >>review` });
    const { chainId, sessionId } = onlySession();
    await pipeline.execute({ chain_id: chainId, user_response: 'step one output' } as never);
    await sessionStore.setPendingGateReview(sessionId, {
      combinedPrompt: 'Review step two for quality.',
      gateIds: ['step-quality'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 3,
    });
    await pipeline.execute({
      chain_id: chainId,
      user_response: 'step two output',
      gate_verdict: passVerdict,
    } as never);
    return { chainId };
  };

  test('a gated final step announces its step_complete BEFORE chain/complete', async () => {
    await driveGatedFinalStep();

    // One value, not three counts: the defect was entirely positional, and every per-method
    // assertion in this file stayed green while `chain/complete` sat in the middle of the run it
    // reports the end of.
    expect(notificationSequence(mockServer)).toEqual([
      'notifications/chain/step_complete',
      'notifications/chain/step_complete',
      'notifications/chain/complete',
    ]);
  });

  test('re-driving a finished run announces nothing further (terminal stickiness)', async () => {
    const { chainId } = await driveWholeChain();
    const before = mockServer.notification.mock.calls.length;

    await pipeline.execute({ chain_id: chainId, user_response: 'late extra output' } as never);

    expect(observed.chainComplete).toEqual([chainId]);
    expect(mockServer.notification.mock.calls.length).toBe(before);
  });

  test('a cancelled run announces onChainFailed once and never onChainComplete', async () => {
    await pipeline.execute({ command: `>>draft ==> >>review` });
    const { chainId, sessionId } = onlySession();

    await expect(sessionStore.cancelChain(sessionId)).resolves.toBe(true);

    expect(observed.chainFailed).toEqual([{ chainId, reason: 'run cancelled' }]);
    expect(observed.chainComplete).toEqual([]);
    expect(chainNotifications(mockServer, 'notifications/chain/complete')).toEqual([
      { chainId, totalSteps: 2, status: 'cancelled' },
    ]);
  });

  test('cancelling twice announces once — the second call is idempotent', async () => {
    await pipeline.execute({ command: `>>draft ==> >>review` });
    const { sessionId } = onlySession();

    await sessionStore.cancelChain(sessionId);
    await sessionStore.cancelChain(sessionId);

    expect(observed.chainFailed).toHaveLength(1);
    expect(chainNotifications(mockServer, 'notifications/chain/complete')).toHaveLength(1);
  });

  test('POSITIVE CONTROL: a store with no channels bound announces nothing', async () => {
    // Proves the assertions above observe emission rather than the harness: same drive, same
    // consumer, only the late-bind removed.
    sessionStore.setRunAnnouncementChannels({});
    await pipeline.execute({ command: `>>draft ==> >>review` });
    const { sessionId } = onlySession();
    await sessionStore.cancelChain(sessionId);

    expect(observed.chainFailed).toEqual([]);
    expect(chainNotifications(mockServer, 'notifications/chain/complete')).toEqual([]);
  });

  test('a hook consumer that throws does not fail the run it observed', async () => {
    hookRegistry.registerChainHooks({
      onChainComplete: async () => {
        throw new Error('consumer blew up');
      },
    });

    await expect(driveWholeChain()).resolves.toBeDefined();
    expect(observed.chainComplete).toHaveLength(1);
  });
});

describe('a persisted framework switch reaches the client', () => {
  // One root for the whole describe, and a distinct workspace scope per test: SqliteEngine is a
  // process-wide singleton with no reset, so a second temp root throws rather than opening.
  let tmpRoot: string;
  let stateDbPath: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-notify-'));
    fs.mkdirSync(path.join(tmpRoot, 'runtime-state'), { recursive: true });
    stateDbPath = path.join(tmpRoot, 'runtime-state', 'state.db');
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* the temp root is best-effort; a leaked dir is not a test failure */
    }
  });

  test('switchFramework pushes one notifications/framework/changed naming from and to', async () => {
    const logger = createLogger();
    const emitter = new McpNotificationEmitter(logger);
    const mockServer = { notification: jest.fn() };
    emitter.setServer(mockServer as unknown as McpNotificationServer);

    const store = await createFrameworkStateStore(logger, stateDbPath, {
      defaultScope: { workspaceId: 'p4-80-framework-notify' },
    });
    store.setNotificationEmitter(emitter);

    const before = store.getCurrentState().activeFramework;
    await store.switchFramework({ targetFramework: 'react', reason: 'p4-80 drive' });

    expect(chainNotifications(mockServer, 'notifications/framework/changed')).toEqual([
      { from: before, to: 'react', reason: 'p4-80 drive' },
    ]);

    await store.shutdown();
  });

  test('a no-op switch to the already-active framework announces nothing', async () => {
    const logger = createLogger();
    const emitter = new McpNotificationEmitter(logger);
    const mockServer = { notification: jest.fn() };
    emitter.setServer(mockServer as unknown as McpNotificationServer);

    const store = await createFrameworkStateStore(logger, stateDbPath, {
      defaultScope: { workspaceId: 'p4-80-framework-noop' },
    });
    store.setNotificationEmitter(emitter);

    const active = store.getCurrentState().activeFramework;
    await store.switchFramework({ targetFramework: active, reason: 'already active' });

    expect(chainNotifications(mockServer, 'notifications/framework/changed')).toEqual([]);

    await store.shutdown();
  });

  test('POSITIVE CONTROL: with no emitter bound the same switch announces nothing', async () => {
    const logger = createLogger();
    const mockServer = { notification: jest.fn() };

    const store = await createFrameworkStateStore(logger, stateDbPath, {
      defaultScope: { workspaceId: 'p4-80-framework-unbound' },
    });

    await store.switchFramework({ targetFramework: 'react', reason: 'unbound drive' });

    expect(mockServer.notification).not.toHaveBeenCalled();

    await store.shutdown();
  });
});
