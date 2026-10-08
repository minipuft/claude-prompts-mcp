import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { StepCaptureService } from '../../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../../src/engine/execution/capture/unknown-observation-processor.js';
import { StepResponseCaptureStage } from '../../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
} from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { GateReview } from '../../../../src/shared/types/chain-execution.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';

const logger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/** Only storage IO is doubled; admission, stage, capture and unknown processing stay real. */
function fixture(body: string | undefined, polarity: 'PASS' | 'FAIL' = 'FAIL') {
  const held: GateReview = {
    nodeId: 'a',
    kind: 'gate',
    phase: 'awaiting-verdict',
    gateIds: ['semantic'],
    combinedPrompt: '',
    prompts: [],
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 1,
    semanticContext: bindSemanticReviewTarget(
      createSemanticReviewContext('a', 'attempt-a', [
        {
          id: 'semantic',
          name: 'Draft',
          type: 'validation',
          description: 'Draft only',
          pass_criteria: [
            {
              type: 'semantic_evaluation',
              id: 'preserves-contract',
              target: { kind: 'step_output' },
              question: 'Is it preserved?',
              result: { kind: 'boolean' },
              acceptance: { kind: 'equals', value: true },
              evidence_requirements: { min_items: 1 },
            },
          ],
        },
      ]),
      'Captured A'
    ),
  };
  const session = {
    sessionId: 'session',
    chainId: 'chain',
    reviews: { a: held },
    unknownsLedger: [],
    state: {
      currentNodeId: 'a',
      nodes: [
        { id: 'a', promptId: 'p' },
        { id: 'b', promptId: 'p' },
      ],
      stepStates: new Map(),
    },
  } as unknown as ChainSession;
  const store = {
    getSession: jest.fn(() => session),
    getReview: jest.fn((_id: string, node: string) => session.reviews?.[node]),
    getStepState: jest.fn(() => ({ state: 'completed', isPlaceholder: false })),
    isStepComplete: jest.fn(() => true),
    getChainContext: jest.fn(() => ({ memory: [] })),
    applyUnknownObservations: jest.fn(async () => []),
    getSessionBlueprint: jest.fn(() => undefined),
    getPendingShellVerification: jest.fn(() => undefined),
    setReview: jest.fn(async (_id: string, next: GateReview) => {
      session.reviews ??= {};
      session.reviews[next.nodeId] = next;
    }),
    clearReview: jest.fn(async (_id: string, node: string) => {
      delete session.reviews?.[node];
    }),
    recordGateReviewOutcome: jest.fn(
      async (_id: string, _outcome: { verdict: 'PASS' | 'FAIL' }) => undefined
    ),
    completeStep: jest.fn(async () => true),
    advanceStep: jest.fn(async () => false),
    completeHeldRun: jest.fn(async () => false),
    updateSessionState: jest.fn(async () => true),
  };
  const service = store as unknown as ChainSessionService;
  const context = new ExecutionContext(
    {
      command: '>>chain',
      gate_verdict: `GATE_REVIEW: ${polarity} - reviewed`,
      ...(body !== undefined ? { user_response: body } : {}),
      observations: [
        {
          type: 'unknown_discovered',
          id: 'observed',
          statement: 'Must not land on refusal',
          blocking: false,
        },
      ],
    },
    logger
  );
  context.gateEnforcement = new GateEnforcementAuthority(service, logger);
  context.sessionContext = {
    sessionId: 'session',
    chainId: 'chain',
    isChainExecution: true,
    currentStep: 1,
    currentNodeId: 'a',
    totalSteps: 2,
  };
  const stage = new StepResponseCaptureStage(
    new GateVerdictProcessor(service, logger),
    new StepCaptureService(service, logger),
    service,
    new UnknownObservationProcessor(service, logger),
    logger
  );
  return { held, session, store, context, stage };
}

function detached(f: ReturnType<typeof fixture>, standing = false): void {
  f.held.kind = 'detached';
  f.held.reviewedOutput = 'Captured A';
  f.session.state.currentNodeId = standing ? 'a' : 'b';
  f.session.state.stepStates?.set('a', { state: 'completed', isPlaceholder: false, spawnedAt: 1 });
  f.context.parsedCommand = {
    promptId: 'p',
    commandType: 'chain',
    rawArgs: '',
    format: 'simple',
    confidence: 1,
    metadata: {
      originalCommand: '>>chain',
      parseStrategy: 'fixture',
      detectedFormat: 'simple',
      warnings: [],
    },
    steps: [
      { nodeId: 'a', stepNumber: 1, promptId: 'p', args: {}, delegated: true, await: 'run' },
      { nodeId: 'b', stepNumber: 2, promptId: 'p', args: {} },
    ],
  };
}

describe('Stage16 admits semantic target before effectful resume phases', () => {
  test.each(['PASS', 'FAIL'] as const)(
    '%s rejects different/defined-empty before unknown observations and all review/capture writes',
    async (polarity) => {
      for (const body of ['Different B', '', ' \n\t']) {
        const f = fixture(body, polarity);
        const before = JSON.stringify(f.session);
        await f.stage.execute(f.context);
        expect(f.context.response).toMatchObject({ isError: true });
        expect(f.store.applyUnknownObservations).not.toHaveBeenCalled();
        expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
        expect(f.store.setReview).not.toHaveBeenCalled();
        expect(f.store.clearReview).not.toHaveBeenCalled();
        expect(f.store.completeStep).not.toHaveBeenCalled();
        expect(f.store.advanceStep).not.toHaveBeenCalled();
        expect(JSON.stringify(f.session)).toBe(before);
      }
    }
  );
  test.each(['PASS', 'FAIL'] as const)(
    '%s addressed detached work refuses before capture/routing effects',
    async (polarity) => {
      const f = fixture('Different B\nHANDOFF RESULT\nnode: a', polarity);
      detached(f);
      const before = JSON.stringify(f.session);
      await f.stage.execute(f.context);
      expect(f.context.response).toMatchObject({ isError: true });
      expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(f.store.updateSessionState).not.toHaveBeenCalled();
      expect(f.store.completeStep).not.toHaveBeenCalled();
      expect(f.store.advanceStep).not.toHaveBeenCalled();
      expect(f.store.applyUnknownObservations).not.toHaveBeenCalled();
      expect(JSON.stringify(f.session)).toBe(before);
    }
  );
  test('standing detached empty WORK refuses before continue-past even when target is empty', async () => {
    const f = fixture('');
    detached(f, true);
    if (f.held.semanticContext === undefined) throw new Error('Missing fixture');
    f.held.semanticContext = bindSemanticReviewTarget(f.held.semanticContext, '');
    await f.stage.execute(f.context);
    expect(f.context.response).toMatchObject({ isError: true });
    expect(f.store.advanceStep).not.toHaveBeenCalled();
    expect(f.store.updateSessionState).not.toHaveBeenCalled();
  });
  test.each(['HANDOFF RESULT\nnode:a', '```\nHANDOFF RESULT\nnode: a\n```'])(
    'detached report-only envelope %j remains admitted',
    async (body) => {
      const f = fixture(body);
      detached(f);
      await f.stage.execute(f.context);
      expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'FAIL' });
      expect(f.store.updateSessionState).not.toHaveBeenCalled();
    }
  );
  test.each(['PASS', 'FAIL'] as const)(
    'ordinary metadata %s refuses without retargeting or output capture',
    async (polarity) => {
      const f = fixture('HANDOFF RESULT\nnode:a', polarity);
      await f.stage.execute(f.context);
      expect({
        target: f.session.reviews?.a.semanticContext?.target?.content,
        outputWrites: f.store.updateSessionState.mock.calls.length,
        captureWrites: f.store.completeStep.mock.calls.length,
      }).toEqual({
        target: 'Captured A',
        outputWrites: 0,
        captureWrites: 0,
      });
      expect(f.context.response).toMatchObject({ isError: true });
      expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
    }
  );
  test('targetless review refuses before observations even on report-only submission', async () => {
    const f = fixture(undefined);
    if (f.held.semanticContext === undefined) throw new Error('Missing fixture');
    const { target: _target, ...issued } = f.held.semanticContext;
    f.held.semanticContext = issued;
    await f.stage.execute(f.context);
    expect(f.context.response).toMatchObject({ isError: true });
    expect(f.store.applyUnknownObservations).not.toHaveBeenCalled();
    expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
  });
  test.each([undefined, 'Captured A'])(
    'report-only/identical %j reaches original observation phase',
    async (body) => {
      const f = fixture(body);
      await f.stage.execute(f.context);
      expect(f.store.applyUnknownObservations).toHaveBeenCalledTimes(1);
      // Legacy text on required semantic gates derives FAIL; this positive proves admission only.
      expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'FAIL' });
    }
  );
  test('known other-node B is captured while earlier review A is failed separately', async () => {
    const f = fixture('Different B');
    f.session.state.currentNodeId = 'b';
    f.store.getStepState.mockReturnValue({ state: 'pending', isPlaceholder: false });
    await f.stage.execute(f.context);
    expect(f.store.applyUnknownObservations).toHaveBeenCalledTimes(1);
    expect(f.store.completeStep).toHaveBeenCalled();
    expect(f.session.reviews?.a.semanticContext?.target).toBeUndefined();
  });
  test('ordinary legacy whitespace keeps old no-capture behavior', async () => {
    const f = fixture('');
    delete f.held.semanticContext;
    await f.stage.execute(f.context);
    expect(f.store.applyUnknownObservations).toHaveBeenCalledTimes(1);
    expect(f.store.completeStep).not.toHaveBeenCalled();
  });
  test('action-only request does not acquire semantic verdict admission', async () => {
    const f = fixture('Different B');
    const actionContext = new ExecutionContext(
      {
        user_response: 'Different B',
        gate_action: 'retry',
        observations: f.context.mcpRequest.observations,
      },
      logger
    );
    actionContext.sessionContext = f.context.sessionContext;
    actionContext.gateEnforcement = f.context.gateEnforcement;
    await f.stage.execute(actionContext);
    expect(f.store.applyUnknownObservations).toHaveBeenCalledTimes(1);
    expect(actionContext.response?.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('retry') })])
    );
  });
});
