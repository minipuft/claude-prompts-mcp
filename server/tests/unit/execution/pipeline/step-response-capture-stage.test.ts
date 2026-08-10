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
  const advanceStep = jest.fn().mockResolvedValue(2);
  const isRetryLimitExceeded = jest.fn().mockReturnValue(false);
  const resetRetryCount = jest.fn().mockResolvedValue(true);
  const clearPendingGateReview = jest.fn().mockResolvedValue(true);
  const recordGateReviewOutcome = jest.fn().mockResolvedValue('cleared');
  const getPendingGateReview = jest.fn();
  const applyUnknownObservations =
    jest.fn<
      (
        sessionId: string,
        stepNumber: number,
        observations: UnknownObservation[]
      ) => Promise<UnknownLedgerEntry[]>
    >();
  applyUnknownObservations.mockResolvedValue([]);

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
  };
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
    const { manager, getSession, recordGateReviewOutcome } = createSessionManager();
    const stage = createStage(manager);

    getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-1',
      state: { currentStep: 2, totalSteps: 3 },
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
      state: { currentStep: 2, totalSteps: 3 },
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
      2,
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
      state: { currentStep: 2, totalSteps: 3 },
    });

    const context = new ExecutionContext({ command: '>>chain' });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 3,
    };

    await stage.execute(context);

    expect(getSession).toHaveBeenCalled();
    expect(getStepState).toHaveBeenCalledWith('sess-1', 1);
    expect(updateSessionState).toHaveBeenCalledWith(
      'sess-1',
      1,
      expect.stringContaining('Step 1/3'),
      expect.objectContaining({
        isPlaceholder: true,
        placeholderSource: expect.any(String),
      })
    );
    expect(completeStep).toHaveBeenCalledWith('sess-1', 1, {
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
        state: { currentStep: 2, totalSteps: 3 },
      })
      .mockReturnValue({
        sessionId: 'sess-1',
        chainId: 'chain-1',
        state: { currentStep: 3, totalSteps: 3 },
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
      totalSteps: 3,
    };

    await stage.execute(context);

    expect(updateSessionState).toHaveBeenCalledWith(
      'sess-1',
      2,
      'Here is my follow-up output',
      expect.objectContaining({ isPlaceholder: false, source: 'user_response' })
    );
    expect(completeStep).toHaveBeenCalledWith(
      'sess-1',
      2,
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
      state: { currentStep: 2, totalSteps: 3 },
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
      totalSteps: 3,
    };

    await stage.execute(context);

    // Stamped with currentStepAtStart (2), not the step this call advances to.
    expect(applyUnknownObservations).toHaveBeenCalledWith('sess-1', 2, observations);
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
      state: { currentStep: 2, totalSteps: 3 },
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
      totalSteps: 3,
    };

    await stage.execute(context);

    expect(context.response?.isError).toBe(true);
    expect(context.response?.content?.[0]?.text).toContain('never-seen');
    expect(updateSessionState).not.toHaveBeenCalled();
  });
});
