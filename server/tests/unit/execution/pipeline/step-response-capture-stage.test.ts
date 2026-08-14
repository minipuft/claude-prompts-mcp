import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { StepCaptureService } from '../../../../src/engine/execution/capture/step-capture-service.js';
import {
  UnknownObservationProcessor,
  UnknownObservationValidationError,
} from '../../../../src/engine/execution/capture/unknown-observation-processor.js';
import { StepResponseCaptureStage } from '../../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { ChainSessionService } from '../../../../src/modules/chains/types.js';
import type {
  UnknownLedgerEntry,
  UnknownObservation,
} from '../../../../src/shared/types/chain-session.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createSessionManager = () => {
  const getSession = jest.fn();
  const getChainContext = jest.fn().mockReturnValue({ memory: [] });
  const getStepState = jest.fn();
  const updateSessionState = jest.fn().mockResolvedValue(true);
  const completeStep = jest.fn().mockResolvedValue(true);
  const advanceStep = jest.fn().mockResolvedValue({ nodeId: 'n3', ordinal: 3 });
  const isRetryLimitExceeded = jest.fn().mockReturnValue(false);
  const resetRetryCount = jest.fn().mockResolvedValue(true);
  const clearPendingGateReview = jest.fn().mockResolvedValue(true);
  const recordGateReviewOutcome = jest.fn().mockResolvedValue('cleared');
  const getPendingGateReview = jest.fn();
  const applyUnknownObservations =
    jest.fn<
      (
        sessionId: string,
        nodeId: string,
        observations: UnknownObservation[]
      ) => Promise<UnknownLedgerEntry[]>
    >();
  applyUnknownObservations.mockResolvedValue([]);
  const insertNodeAfter = jest.fn<(...args: any[]) => Promise<any>>();
  insertNodeAfter.mockResolvedValue({ id: 'inv-cache-ttl', promptId: 'investigate_unknown' });
  const markNodeSkipped = jest.fn<(...args: any[]) => Promise<boolean>>();
  markNodeSkipped.mockResolvedValue(true);
  // The stage reads the run's stored blueprint for a submission-declared `budget.maxInsertions`
  // (P6 Tier 5). `undefined` is the shape a run that declared no budget has — the server default
  // then stands, which is what every case in this file asserts against.
  const getSessionBlueprint = jest.fn<(...args: any[]) => any>();
  getSessionBlueprint.mockReturnValue(undefined);

  return {
    manager: {
      applyUnknownObservations,
      getSession,
      getChainContext,
      getStepState,
      updateSessionState,
      completeStep,
      advanceStep,
      isRetryLimitExceeded,
      resetRetryCount,
      clearPendingGateReview,
      recordGateReviewOutcome,
      getPendingGateReview,
      insertNodeAfter,
      markNodeSkipped,
      getSessionBlueprint,
    } as unknown as ChainSessionService,
    applyUnknownObservations,
    getSession,
    getChainContext,
    getStepState,
    updateSessionState,
    completeStep,
    advanceStep,
    isRetryLimitExceeded,
    resetRetryCount,
    clearPendingGateReview,
    recordGateReviewOutcome,
    getPendingGateReview,
    insertNodeAfter,
    markNodeSkipped,
    getSessionBlueprint,
  };
};

/**
 * A three-node run standing at `n1`, with `origin` already normalized the way the store
 * normalizes it at creation. `extraNodes` appends already-inserted nodes so the cap probes can
 * seed a run that has spent its insertion budget.
 */
const sessionAtN1 = (
  extraNodes: Array<Record<string, unknown>> = [],
  unknownsLedger: UnknownLedgerEntry[] = []
) => ({
  sessionId: 'sess-1',
  chainId: 'chain-1',
  unknownsLedger,
  state: {
    currentNodeId: 'n1',
    nodes: [
      { id: 'n1', promptId: 'p1', origin: 'planned' },
      { id: 'n2', promptId: 'p2', origin: 'planned' },
      { id: 'n3', promptId: 'p3', origin: 'planned' },
      ...extraNodes,
    ],
  },
});

const discovered = (
  id: string,
  statement: string,
  blocking: boolean
): UnknownObservation & { blocking: boolean } => ({
  type: 'unknown_discovered',
  id,
  statement,
  blocking,
});

const ledgerEntry = (entry: Partial<UnknownLedgerEntry> & { id: string }): UnknownLedgerEntry =>
  ({
    statement: 'stated',
    state: 'active',
    blocking: false,
    discoveredAtStep: 1,
    ...entry,
  }) as UnknownLedgerEntry;

/** Drive one call carrying `observations` against a run standing at n1. */
const runWithObservations = async (
  harness: ReturnType<typeof createSessionManager>,
  observations: UnknownObservation[]
): Promise<void> => {
  const stage = createStage(harness.manager);
  const context = new ExecutionContext({
    command: '>>chain',
    user_response: 'step one output',
    observations,
  });
  context.sessionContext = {
    sessionId: 'sess-1',
    chainId: 'chain-1',
    isChainExecution: true,
    currentStep: 1,
    currentNodeId: 'n1',
    totalSteps: 3,
  };
  await stage.execute(context);
};

const createStage = (manager: ChainSessionService): StepResponseCaptureStage => {
  const logger = createLogger();
  const verdictProcessor = new GateVerdictProcessor(manager, logger);
  const stepCaptureService = new StepCaptureService(manager, logger);
  const unknownObservationProcessor = new UnknownObservationProcessor(manager, logger);
  return new StepResponseCaptureStage(
    verdictProcessor,
    stepCaptureService,
    manager,
    unknownObservationProcessor,
    logger
  );
};

describe('StepResponseCaptureStage', () => {
  test('skips when execution is not part of a chain session', async () => {
    const { manager } = createSessionManager();
    const stage = createStage(manager);

    const context = new ExecutionContext({ command: '>>demo' });
    context.sessionContext = {
      sessionId: 'sess-1',
      isChainExecution: false,
    };

    await stage.execute(context);

    expect(manager.getSession).not.toHaveBeenCalled();
  });

  test('processes gate_verdict without requiring user_response', async () => {
    const { manager, getSession, recordGateReviewOutcome, advanceStep } = createSessionManager();
    const stage = createStage(manager);

    getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-1',
      state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
      pendingGateReview: {
        gateIds: ['accuracy'],
        attemptCount: 1,
        prompts: [],
        createdAt: Date.now(),
        maxAttempts: 3,
      },
    });

    const context = new ExecutionContext({
      command: '>>chain',
      gate_verdict: 'GATE_REVIEW: PASS - confirmed upstream',
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 3,
      pendingReview: {
        gateIds: ['accuracy'],
        attemptCount: 1,
        prompts: [],
        createdAt: Date.now(),
        maxAttempts: 3,
      },
    };

    await stage.execute(context);

    expect(recordGateReviewOutcome).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        verdict: 'PASS',
        rawVerdict: 'GATE_REVIEW: PASS - confirmed upstream',
      })
    );
    expect(context.sessionContext?.pendingReview).toBeUndefined();
    // A PASS advances past the node the run is STANDING on — not its neighbour. The position
    // the stage receives (2) is translated against the run's own node list exactly once, so an
    // off-by-one in that translation skips or repeats a step with nothing else to catch it.
    expect(advanceStep).toHaveBeenCalledWith('sess-1', 'n2');
    expect(context.sessionContext?.currentStep).toBe(3);
    expect(context.sessionContext?.currentNodeId).toBe('n3');
    expect(manager.updateSessionState).not.toHaveBeenCalled();
    expect(manager.completeStep).not.toHaveBeenCalled();
  });

  test('does not parse verdicts from user_response (contract-first)', async () => {
    // Verdicts should only be provided via gate_verdict parameter, not user_response
    // However, user_response content IS still captured as step output
    const { manager, getSession, recordGateReviewOutcome, updateSessionState, getStepState } =
      createSessionManager();
    recordGateReviewOutcome.mockResolvedValue('pending');
    getStepState.mockReturnValue({ state: 'completed', isPlaceholder: true });
    const stage = createStage(manager);

    getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-1',
      state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
      pendingGateReview: {
        gateIds: ['accuracy'],
        attemptCount: 1,
        prompts: [],
        createdAt: Date.now(),
        maxAttempts: 3,
        combinedPrompt: 'test prompt',
      },
    });

    const context = new ExecutionContext({
      command: '>>chain',
      user_response: 'GATE_REVIEW: FAIL - needs red-team pass', // Verdict-like text in user_response
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 3,
      pendingReview: {
        gateIds: ['accuracy'],
        attemptCount: 1,
        prompts: [],
        createdAt: Date.now(),
        maxAttempts: 3,
        combinedPrompt: 'test prompt',
      },
    };

    await stage.execute(context);

    // Verdict in user_response should NOT be parsed as verdict (contract-first approach)
    expect(recordGateReviewOutcome).not.toHaveBeenCalled();
    // But user_response content IS captured as step output
    expect(updateSessionState).toHaveBeenCalledWith(
      'sess-1',
      'n2',
      'GATE_REVIEW: FAIL - needs red-team pass',
      expect.objectContaining({ source: 'user_response' })
    );
  });

  test('records placeholder output for previous step when no user response is provided', async () => {
    const { manager, getSession, getStepState, updateSessionState, completeStep, getChainContext } =
      createSessionManager();

    const stage = createStage(manager);

    getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-1',
      state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
    });

    const context = new ExecutionContext({ command: '>>chain' });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 3,
    };

    await stage.execute(context);

    expect(getSession).toHaveBeenCalled();
    expect(getStepState).toHaveBeenCalledWith('sess-1', 'n1');
    expect(updateSessionState).toHaveBeenCalledWith(
      'sess-1',
      'n1',
      expect.stringContaining('Step 1/3'),
      expect.objectContaining({
        isPlaceholder: true,
        placeholderSource: expect.any(String),
      })
    );
    expect(completeStep).toHaveBeenCalledWith('sess-1', 'n1', {
      preservePlaceholder: true,
    });
    expect(getChainContext).toHaveBeenCalled();
    expect(context.state.session.chainContext).toEqual({ memory: [] });
  });

  test('captures real user response when placeholder state exists', async () => {
    const { manager, getSession, getStepState, updateSessionState, completeStep, getChainContext } =
      createSessionManager();
    const stage = createStage(manager);

    getSession
      .mockReturnValueOnce({
        sessionId: 'sess-1',
        chainId: 'chain-1',
        state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
      })
      .mockReturnValue({
        sessionId: 'sess-1',
        chainId: 'chain-1',
        state: { currentNodeId: 'n3', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
      });
    getStepState.mockReturnValue({
      state: 'completed',
      isPlaceholder: true,
    });

    const context = new ExecutionContext({
      command: '>>chain',
      user_response: 'Here is my follow-up output',
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 3,
    };

    await stage.execute(context);

    expect(updateSessionState).toHaveBeenCalledWith(
      'sess-1',
      'n2',
      'Here is my follow-up output',
      expect.objectContaining({ isPlaceholder: false, source: 'user_response' })
    );
    expect(completeStep).toHaveBeenCalledWith(
      'sess-1',
      'n2',
      expect.objectContaining({ preservePlaceholder: false })
    );
    expect(context.sessionContext?.currentStep).toBe(3);
    expect(getChainContext).toHaveBeenCalledTimes(2);
  });

  test('applies declared observations at the step being reported on, before capture', async () => {
    const { manager, getSession, applyUnknownObservations, getStepState } = createSessionManager();
    getStepState.mockReturnValue(undefined);
    const stage = createStage(manager);

    getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-1',
      state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
    });

    const observations = [
      { type: 'unknown_discovered' as const, id: 'cache-ttl', statement: 'TTL undecided' },
    ];
    const context = new ExecutionContext({
      command: '>>chain',
      user_response: 'step two output',
      observations,
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 3,
    };

    await stage.execute(context);

    // Stamped with currentStepAtStart (2), not the step this call advances to.
    expect(applyUnknownObservations).toHaveBeenCalledWith('sess-1', 'n2', observations);
    expect(context.response).toBeUndefined();
  });

  test('surfaces an invalid observation batch as a tool-result error and stops the stage', async () => {
    const { manager, getSession, applyUnknownObservations, updateSessionState } =
      createSessionManager();
    applyUnknownObservations.mockRejectedValue(
      new UnknownObservationValidationError('Cannot resolve unknown "never-seen"')
    );
    const stage = createStage(manager);

    getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-1',
      state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
    });

    const context = new ExecutionContext({
      command: '>>chain',
      user_response: 'step two output',
      observations: [
        {
          type: 'unknown_resolved' as const,
          id: 'never-seen',
          statement: 'done',
          resolution: 'answered' as const,
        },
      ],
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 3,
    };

    await stage.execute(context);

    expect(context.response?.isError).toBe(true);
    expect(context.response?.content?.[0]?.text).toContain('never-seen');
    expect(updateSessionState).not.toHaveBeenCalled();
  });
});

/**
 * P4 Tier 3.1 — the mutation policy wired at this stage.
 *
 * These assert the WIRING, not the policy: `decideMutation`'s own branch table is exercised
 * exhaustively in `tests/unit/execution/decisions/mutation-policy.test.ts`. What can only fail
 * here is the plumbing — that the delta reaches the policy, that the policy's answer reaches
 * the store with the right arguments, and above all that the policy does NOT fire on the paths
 * where firing would be a defect (D2: the model never emits graph edits, so a call with no
 * typed delta must change nothing).
 */
describe('StepResponseCaptureStage — adaptive mutation (P4)', () => {
  test('a blocking discovery inserts one investigation node after the current one', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'cache-ttl', blocking: true, statement: 'TTL undecided' }),
    ]);

    await runWithObservations(harness, [discovered('cache-ttl', 'TTL undecided', true)]);

    expect(harness.insertNodeAfter).toHaveBeenCalledWith('sess-1', 'n1', {
      stepName: 'Investigate: TTL undecided',
      promptId: 'investigate_unknown',
      origin: 'inserted',
      unknownId: 'cache-ttl',
    });
    expect(harness.markNodeSkipped).not.toHaveBeenCalled();
  });

  test('a long statement is truncated in the step name, not carried whole', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.getStepState.mockReturnValue(undefined);
    const statement = 'x'.repeat(120);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'long', blocking: true, statement }),
    ]);

    await runWithObservations(harness, [discovered('long', statement, true)]);

    const stepName = (harness.insertNodeAfter.mock.calls[0]?.[2] as { stepName: string }).stepName;
    expect(stepName.length).toBeLessThanOrEqual('Investigate: '.length + 60);
    expect(stepName.endsWith('…')).toBe(true);
  });

  test('NEGATIVE — a non-blocking discovery inserts nothing (no-trigger)', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'cache-ttl', blocking: false }),
    ]);

    await runWithObservations(harness, [discovered('cache-ttl', 'TTL undecided', false)]);

    expect(harness.insertNodeAfter).not.toHaveBeenCalled();
    expect(harness.markNodeSkipped).not.toHaveBeenCalled();
  });

  test('NEGATIVE — a 4th insertion is refused by the run cap', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(
      sessionAtN1([
        { id: 'inv-a', promptId: 'investigate_unknown', origin: 'inserted', originUnknownId: 'a' },
        { id: 'inv-b', promptId: 'investigate_unknown', origin: 'inserted', originUnknownId: 'b' },
        { id: 'inv-c', promptId: 'investigate_unknown', origin: 'inserted', originUnknownId: 'c' },
      ])
    );
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'fourth', blocking: true }),
    ]);

    await runWithObservations(harness, [discovered('fourth', 'a fourth unknown', true)]);

    expect(harness.insertNodeAfter).not.toHaveBeenCalled();
  });

  test('NEGATIVE — an unknown that already owns an inserted node does not get a second', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(
      sessionAtN1([
        {
          id: 'inv-cache-ttl',
          promptId: 'investigate_unknown',
          origin: 'inserted',
          originUnknownId: 'cache-ttl',
        },
      ])
    );
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'cache-ttl', blocking: true }),
    ]);

    await runWithObservations(harness, [discovered('cache-ttl', 'restated', true)]);

    expect(harness.insertNodeAfter).not.toHaveBeenCalled();
  });

  test('an irrelevant resolution skips the declared strictly-ahead target', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({
        id: 'cache-ttl',
        state: 'resolved',
        resolution: 'irrelevant',
        targetStepId: 'n3',
      }),
    ]);

    await runWithObservations(harness, [
      { type: 'unknown_resolved', id: 'cache-ttl', statement: 'moot', resolution: 'irrelevant' },
    ]);

    expect(harness.markNodeSkipped).toHaveBeenCalledWith('sess-1', 'n3', 'cache-ttl');
    expect(harness.insertNodeAfter).not.toHaveBeenCalled();
  });

  test('NEGATIVE — an irrelevant resolution with no declared target skips nothing', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'cache-ttl', state: 'resolved', resolution: 'irrelevant' }),
    ]);

    await runWithObservations(harness, [
      { type: 'unknown_resolved', id: 'cache-ttl', statement: 'moot', resolution: 'irrelevant' },
    ]);

    expect(harness.markNodeSkipped).not.toHaveBeenCalled();
  });

  test('NEGATIVE — a gate retry after an insertion does not insert a second node (D2)', async () => {
    // The double-fire shape this guards: step 1 declares a blocking unknown and gets its
    // investigation node; the gate then FAILs and the client retries. The retry carries a
    // verdict but no observations, so there is no delta and nothing may fire again.
    const harness = createSessionManager();
    // The session carries the ledger the first call wrote — so a policy that (wrongly) read
    // run STATE instead of this call's delta would have live material to re-fire on. Without
    // that, the probe would pass for the wrong reason.
    const openBlocking = ledgerEntry({
      id: 'cache-ttl',
      blocking: true,
      statement: 'TTL undecided',
    });
    harness.getSession.mockReturnValue(sessionAtN1([], [openBlocking]));
    harness.getStepState.mockReturnValue(undefined);
    harness.applyUnknownObservations.mockResolvedValue([openBlocking]);

    await runWithObservations(harness, [discovered('cache-ttl', 'TTL undecided', true)]);
    expect(harness.insertNodeAfter).toHaveBeenCalledTimes(1);

    // The retry: same run, same open unknown in the ledger, no observations on the call.
    const stage = createStage(harness.manager);
    const retry = new ExecutionContext({
      command: '>>chain',
      gate_verdict: 'GATE_REVIEW: FAIL - try again',
    });
    retry.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      currentNodeId: 'n1',
      totalSteps: 4,
    };
    await stage.execute(retry);

    // Still one. The ledger still holds an active blocking unknown — only the ABSENCE of a
    // delta on this call keeps the policy quiet, which is what D2 buys.
    expect(harness.insertNodeAfter).toHaveBeenCalledTimes(1);
    expect(harness.applyUnknownObservations).toHaveBeenCalledTimes(1);
    expect(harness.markNodeSkipped).not.toHaveBeenCalled();
  });

  test('NEGATIVE — a rejected observation batch mutates nothing', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.applyUnknownObservations.mockRejectedValue(
      new UnknownObservationValidationError('Cannot resolve unknown "never-seen"')
    );

    await runWithObservations(harness, [
      {
        type: 'unknown_resolved',
        id: 'never-seen',
        statement: 'done',
        resolution: 'irrelevant',
      },
    ]);

    expect(harness.insertNodeAfter).not.toHaveBeenCalled();
    expect(harness.markNodeSkipped).not.toHaveBeenCalled();
  });

  test('a store refusal is a logged no-op, not an error surfaced to the client', async () => {
    const harness = createSessionManager();
    harness.getSession.mockReturnValue(sessionAtN1());
    harness.getStepState.mockReturnValue(undefined);
    harness.insertNodeAfter.mockResolvedValue(null);
    harness.applyUnknownObservations.mockResolvedValue([
      ledgerEntry({ id: 'cache-ttl', blocking: true }),
    ]);

    const stage = createStage(harness.manager);
    const context = new ExecutionContext({
      command: '>>chain',
      user_response: 'step one output',
      observations: [discovered('cache-ttl', 'TTL undecided', true)],
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      currentNodeId: 'n1',
      totalSteps: 3,
    };

    await expect(stage.execute(context)).resolves.toBeUndefined();
    expect(context.response?.isError).toBeUndefined();
  });
});
