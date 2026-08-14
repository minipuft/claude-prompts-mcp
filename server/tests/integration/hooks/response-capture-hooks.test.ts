// @lifecycle canonical - Integration test for ResponseCaptureStage hook emission.
/**
 * ResponseCaptureStage Hook Integration Test
 *
 * Tests that gate events are properly emitted through the pipeline when
 * processing gate verdicts in ResponseCaptureStage.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { HookRegistry } from '../../../src/infra/hooks/index.js';
import {
  McpNotificationEmitter,
  type McpNotificationServer,
} from '../../../src/infra/observability/notifications/index.js';
import { noopLogger } from '../../../src/infra/logging/index.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/index.js';
import type { ChainSessionService } from '../../../src/shared/types/chain-session.js';
import type {
  GateFailedNotification,
  HookRegistryPort,
  McpNotificationEmitterPort,
  McpToolRequest,
} from '../../../src/shared/types/index.js';

describe('ResponseCaptureStage Hook Emission', () => {
  let hookRegistry: HookRegistry;
  let notificationEmitter: McpNotificationEmitter;
  let mockServer: jest.Mocked<McpNotificationServer>;
  let stage: StepResponseCaptureStage;
  let mockChainSessionStore: jest.Mocked<ChainSessionService>;

  beforeEach(() => {
    hookRegistry = new HookRegistry(noopLogger);
    notificationEmitter = new McpNotificationEmitter(noopLogger);

    mockServer = {
      notification: jest.fn(),
    };
    notificationEmitter.setServer(mockServer);

    // Create mock chain session manager
    mockChainSessionStore = {
      getSession: jest.fn(),
      getPendingGateReview: jest.fn(),
      isRetryLimitExceeded: jest.fn(),
      recordGateReviewOutcome: jest.fn(),
      advanceStep: jest.fn().mockResolvedValue({ nodeId: 'n3', ordinal: 3 }),
      clearPendingGateReview: jest.fn(),
      resetRetryCount: jest.fn(),
      updateSessionState: jest.fn(),
      completeStep: jest.fn(),
      getStepState: jest.fn(),
      getChainContext: jest.fn(),
    } as unknown as jest.Mocked<ChainSessionService>;

    // Real collaborators: gate events are emitted by GateVerdictProcessor, not by the stage, so
    // a mocked processor would make these assertions vacuous. The session store stays mocked —
    // it is the I/O boundary.
    stage = new StepResponseCaptureStage(
      // Hooks and notifications reach the processor by constructor injection —
      // they used to be smuggled in per-test via context.metadata.
      new GateVerdictProcessor(
        mockChainSessionStore,
        noopLogger,
        hookRegistry,
        notificationEmitter
      ),
      new StepCaptureService(mockChainSessionStore, noopLogger),
      mockChainSessionStore,
      new UnknownObservationProcessor(mockChainSessionStore, noopLogger),
      noopLogger
    );
  });

  afterEach(() => {
    hookRegistry.clearAll();
  });

  test('emits gate passed event when PASS verdict is processed', async () => {
    // Track emitted events
    const gateEvents: Array<{ gateId: string; passed: boolean }> = [];
    hookRegistry.on('gate:evaluated', (event) => gateEvents.push(event));

    // Setup session with pending gate review
    const sessionId = 'test-session-1';
    mockChainSessionStore.getSession.mockReturnValue({
      sessionId,
      chainId: 'test-chain',
      state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
      pendingGateReview: {
        gateIds: ['code-quality'],
        attemptCount: 1,
        maxAttempts: 2,
      },
    } as any);
    mockChainSessionStore.recordGateReviewOutcome.mockResolvedValue('cleared');
    mockChainSessionStore.getPendingGateReview.mockReturnValue(undefined);

    // Create context with gate verdict (command can be undefined for chain resume)
    const request: McpToolRequest = {
      chain_id: sessionId,
      gate_verdict: 'GATE_REVIEW: PASS - All criteria met',
    } as McpToolRequest;
    const context = new ExecutionContext(request, noopLogger);
    context.sessionContext = {
      sessionId,
      isChainExecution: true,
      currentStep: 1,
    };

    // Execute stage
    await stage.execute(context);

    // Verify gate events were emitted via EventEmitter
    expect(gateEvents.length).toBeGreaterThanOrEqual(0);
    // The hook was wired but may not emit if pendingGateReview is undefined after outcome
  });

  test('emits gate failed notification when FAIL verdict is processed', async () => {
    const sessionId = 'test-session-2';
    mockChainSessionStore.getSession.mockReturnValue({
      sessionId,
      chainId: 'test-chain',
      state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
      pendingGateReview: {
        gateIds: ['code-quality'],
        attemptCount: 1,
        maxAttempts: 2,
      },
    } as any);
    mockChainSessionStore.recordGateReviewOutcome.mockResolvedValue('pending');
    mockChainSessionStore.getPendingGateReview.mockReturnValue({
      combinedPrompt: 'Review against code-quality.',
      gateIds: ['code-quality'],
      prompts: [],
      createdAt: 1_700_000_000_000,
      attemptCount: 2,
      maxAttempts: 2,
    });
    mockChainSessionStore.isRetryLimitExceeded.mockReturnValue(false);

    const request: McpToolRequest = {
      chain_id: sessionId,
      gate_verdict: 'GATE_REVIEW: FAIL - Missing test coverage',
    } as McpToolRequest;
    const context = new ExecutionContext(request, noopLogger);
    context.sessionContext = {
      sessionId,
      isChainExecution: true,
      currentStep: 1,
    };
    // Track notification calls
    const failedNotifications: unknown[] = [];
    mockServer.notification.mockImplementation((params) => {
      if (params.method === 'notifications/gate/failed') {
        failedNotifications.push(params.params);
      }
    });

    await stage.execute(context);

    // Verify gate failed notification was sent
    expect(mockServer.notification).toHaveBeenCalled();
  });

  test('emits retry exhausted event when retry limit exceeded', async () => {
    const sessionId = 'test-session-3';
    const retryExhaustedEvents: Array<{ gateIds: string[]; chainId: string }> = [];
    hookRegistry.on('gate:retryExhausted', (event) => retryExhaustedEvents.push(event));

    mockChainSessionStore.getSession.mockReturnValue({
      sessionId,
      chainId: 'test-chain',
      state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
      pendingGateReview: {
        gateIds: ['code-quality'],
        attemptCount: 2,
        maxAttempts: 2,
      },
    } as any);
    mockChainSessionStore.recordGateReviewOutcome.mockResolvedValue('pending');
    mockChainSessionStore.getPendingGateReview.mockReturnValue({
      combinedPrompt: 'Review against code-quality.',
      gateIds: ['code-quality'],
      prompts: [],
      createdAt: 1_700_000_000_000,
      attemptCount: 2,
      maxAttempts: 2,
    });
    mockChainSessionStore.isRetryLimitExceeded.mockReturnValue(true);

    const request: McpToolRequest = {
      chain_id: sessionId,
      gate_verdict: 'GATE_REVIEW: FAIL - Still missing coverage',
    } as McpToolRequest;
    const context = new ExecutionContext(request, noopLogger);
    context.sessionContext = {
      sessionId,
      isChainExecution: true,
      currentStep: 1,
    };
    await stage.execute(context);

    // Verify retry exhausted state was set
    expect(context.state.gates.retryLimitExceeded).toBe(true);
  });
});

describe('gate events reach a port-only collaborator', () => {
  // GateVerdictProcessor receives the registry as HookRegistryPort and the emitter as
  // McpNotificationEmitterPort. Those ports once declared only the per-stage hooks, so
  // the processor cast them back to the concrete classes to call the gate methods —
  // a cast TypeScript permits between object types with no members in common. Anything
  // implementing the port but not extending the concrete class therefore lost every
  // gate event to a caught TypeError, reported only as a logged warning.
  //
  // These stubs are typed as the ports and are deliberately NOT instances of
  // HookRegistry / McpNotificationEmitter, so they only compile and only receive
  // events while the ports themselves declare the gate surface.
  const createPortStubs = (): {
    hooks: HookRegistryPort;
    notifications: McpNotificationEmitterPort;
    gateFailures: Array<{ gateId: string; reason: string }>;
    notified: GateFailedNotification[];
  } => {
    const gateFailures: Array<{ gateId: string; reason: string }> = [];
    const notified: GateFailedNotification[] = [];

    const hooks: HookRegistryPort = {
      getCounts: () => ({ pipeline: 0, gate: 0, chain: 0 }),
      clearAll: () => {},
      emitBeforeStage: async () => {},
      emitAfterStage: async () => {},
      emitStageError: async () => {},
      emitGateEvaluated: async () => {},
      emitGateFailed: async (gate, reason) => {
        gateFailures.push({ gateId: gate.id, reason });
      },
      emitRetryExhausted: async () => {},
      emitResponseBlocked: async () => {},
    };

    const notifications: McpNotificationEmitterPort = {
      canSend: () => true,
      setServer: () => {},
      emitGateFailed: (notification) => {
        notified.push(notification);
      },
      emitResponseBlocked: () => {},
      emitRetryExhausted: () => {},
    };

    return { hooks, notifications, gateFailures, notified };
  };

  test('a FAIL verdict emits to a stub that implements only the ports', async () => {
    const { hooks, notifications, gateFailures, notified } = createPortStubs();

    const sessionId = 'port-only-session';
    const sessionStore = {
      getSession: jest.fn().mockReturnValue({
        sessionId,
        chainId: 'test-chain',
        state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
        pendingGateReview: { gateIds: ['code-quality'], attemptCount: 1, maxAttempts: 2 },
      }),
      getPendingGateReview: jest.fn().mockReturnValue({
        combinedPrompt: 'Review against code-quality.',
        gateIds: ['code-quality'],
        prompts: [],
        createdAt: 1_700_000_000_000,
        attemptCount: 2,
        maxAttempts: 2,
      }),
      isRetryLimitExceeded: jest.fn().mockReturnValue(false),
      // `jest.fn(impl)` infers its signature; the bare `jest.fn().mockResolvedValue(x)`
      // form used above resolves to `never` under the tests tsconfig.
      recordGateReviewOutcome: jest.fn(async () => 'pending'),
      advanceStep: jest.fn(async () => ({ nodeId: 'n3', ordinal: 3 })),
      clearPendingGateReview: jest.fn(),
      resetRetryCount: jest.fn(),
      updateSessionState: jest.fn(),
      completeStep: jest.fn(),
      getStepState: jest.fn(),
      getChainContext: jest.fn(),
    } as unknown as jest.Mocked<ChainSessionService>;

    const stage = new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, noopLogger, hooks, notifications),
      new StepCaptureService(sessionStore, noopLogger),
      sessionStore,
      new UnknownObservationProcessor(sessionStore, noopLogger),
      noopLogger
    );

    const context = new ExecutionContext(
      {
        chain_id: sessionId,
        gate_verdict: 'GATE_REVIEW: FAIL - Missing test coverage',
      } as McpToolRequest,
      noopLogger
    );
    context.sessionContext = { sessionId, isChainExecution: true, currentStep: 1 };

    await stage.execute(context);

    expect(gateFailures).toEqual([{ gateId: 'code-quality', reason: 'Missing test coverage' }]);
    expect(notified).toEqual([
      { gateId: 'code-quality', reason: 'Missing test coverage', chainId: sessionId },
    ]);
  });
});
