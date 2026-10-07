import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { StepCaptureService } from '../../../../src/engine/execution/capture/step-capture-service.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
  resolvePinnedSemanticContext,
  resolveSemanticTargetResponseAdmission,
} from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
import { evaluateSemanticEvaluation } from '../../../../src/engine/gates/core/semantic-evaluation.js';

import type { GateReview } from '../../../../src/shared/types/chain-execution.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';
import type { GateVerdictSubmission } from '../../../../src/shared/types/gate-evaluation.js';

const logger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const BODY = 'A😀e\u0301 Z';

/** Draft frozen criteria exercise the real kernel without activating a resource loader. */
function review(kind: GateReview['kind'] = 'gate'): GateReview {
  return {
    nodeId: 'a',
    kind,
    phase: 'awaiting-verdict',
    gateIds: ['semantic'],
    combinedPrompt: '',
    prompts: [],
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 1,
    reviewedOutput: BODY,
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
              question: 'Does it preserve the contract?',
              result: { kind: 'boolean' },
              acceptance: { kind: 'equals', value: true },
              evidence_requirements: { min_items: 1 },
            },
          ],
        },
      ]),
      BODY
    ),
  };
}

function submission(held: GateReview, polarity: 'PASS' | 'FAIL'): GateVerdictSubmission {
  if (held.semanticContext === undefined) throw new Error('Missing issued context');
  const pinned = resolvePinnedSemanticContext(held.semanticContext, 'semantic');
  const evaluation = {
    binding: pinned.binding,
    observations: [
      {
        criterion_id: 'preserves-contract',
        state: 'met' as const,
        value: true,
        rationale: 'Exact evidence',
        evidence: [
          { target_digest: pinned.binding.target_digest, start: 0, end: BODY.length, quote: BODY },
        ],
      },
    ],
  };
  expect(evaluateSemanticEvaluation(pinned, evaluation).passed).toBe(true);
  return {
    overall: polarity,
    rationale: 'Reported verdict',
    per_gate: [
      {
        index: 1,
        passed: polarity === 'PASS',
        rationale: 'Reported criterion',
        evaluation,
      },
    ],
  };
}

function fixture(kind: 'gate' | 'detached', polarity: 'PASS' | 'FAIL', body?: string) {
  const held = review(kind);
  const session = {
    sessionId: 'session',
    chainId: 'chain',
    reviews: { a: held },
    unknownsLedger: [],
    state: {
      currentNodeId: kind === 'detached' ? 'b' : 'a',
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
    isStepComplete: jest.fn(() => true),
    completeStep: jest.fn(async () => true),
    updateSessionState: jest.fn(async () => true),
    advanceStep: jest.fn(async () => false),
    getStepState: jest.fn(() => ({ state: 'completed', isPlaceholder: false })),
    getChainContext: jest.fn(() => ({ memory: [] })),
    getPendingShellVerification: jest.fn(() => undefined),
  };
  const service = store as unknown as ChainSessionService;
  const context = new ExecutionContext(
    {
      gate_verdict: submission(held, polarity),
      ...(body !== undefined ? { user_response: body } : {}),
    },
    logger
  );
  if (kind === 'detached') {
    session.state.stepStates?.set('a', { state: 'completed', isPlaceholder: false, spawnedAt: 1 });
    context.parsedCommand = {
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
  context.gateEnforcement = new GateEnforcementAuthority(service, logger);
  context.state.gates.enforcementMode = 'blocking';
  context.state.gates.reviewGateIds = ['semantic'];
  context.sessionContext = { sessionId: 'session', isChainExecution: true, currentStep: 1 };
  const checks = jest.fn(
    async (_gateIds: string[], _agentResponse: string, _scope: unknown, _definitions: unknown) => []
  );
  const processor = new GateVerdictProcessor(service, logger, undefined, undefined, checks);
  const submit = () =>
    kind === 'detached'
      ? processor.processDetachedReviewVerdict(context, session, 'a')
      : processor.processReviewVerdict(context, session, context.sessionContext!, body);
  return { held, session, store, context, checks, processor, submit, service };
}

function facts(held = review()) {
  return {
    verdictPresent: true,
    suppliedResponse: BODY as string | undefined,
    currentResponseNodeId: 'a' as string | undefined,
    currentNodeId: 'a' as string | null,
    nodeIds: ['a', 'b'],
    reviews: { a: held },
    currentStep: { nodeId: 'a', stepNumber: 1 },
    detachedNodes: [],
    holds: { reviews: [] },
    actionPresent: false,
  };
}

describe('semantic response target admission before direct grading', () => {
  test.each(['PASS', 'FAIL'] as const)(
    '%s refuses different and defined-empty work without grading or writes',
    async (polarity) => {
      for (const body of ['Different B', '', ' \t\n']) {
        for (const kind of ['gate', 'detached'] as const) {
          const addressedBody =
            kind === 'detached' && body.trim().length > 0
              ? `${body}\nHANDOFF RESULT\nnode: a`
              : body;
          const f = fixture(kind, polarity, addressedBody);
          if (kind === 'detached' && body.trim().length === 0) f.session.state.currentNodeId = 'a';
          const before = JSON.stringify(f.session);
          await f.submit();
          expect(f.checks).not.toHaveBeenCalled();
          expect(f.store.setReview).not.toHaveBeenCalled();
          expect(f.store.clearReview).not.toHaveBeenCalled();
          expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
          expect(f.store.advanceStep).not.toHaveBeenCalled();
          expect(JSON.stringify(f.session)).toBe(before);
        }
      }
    }
  );

  test('missing target refuses before detached callback', async () => {
    const f = fixture('detached', 'FAIL');
    if (f.held.semanticContext === undefined) throw new Error('Missing fixture context');
    const { target: _target, ...issued } = f.held.semanticContext;
    f.held.semanticContext = issued;
    await f.submit();
    expect(f.checks).not.toHaveBeenCalled();
    expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
  });

  test.each([undefined, BODY])('identical/report-only %j admits a canonical PASS', async (body) => {
    const f = fixture('gate', 'PASS', body);
    await f.submit();
    expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'PASS' });
    expect(f.store.clearReview).toHaveBeenCalledWith('session', 'a');
  });

  test.each(['PASS', 'FAIL'] as const)(
    'ordinary metadata %s refuses direct review writes',
    async (polarity) => {
      const f = fixture('gate', polarity, 'HANDOFF RESULT\nnode:a');
      await f.submit();
      expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(f.store.setReview).not.toHaveBeenCalled();
      expect(f.store.clearReview).not.toHaveBeenCalled();
      expect(f.held.semanticContext?.target?.content).toBe(BODY);
    }
  );
  test('detached direct untagged work at another known node remains separate from review A', async () => {
    const f = fixture('detached', 'PASS', 'Other node B');
    await f.submit();
    expect(f.checks).toHaveBeenCalledTimes(1);
    expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'PASS' });
  });
  test('explicit detached address admits routing-only metadata and executes checks on recorded A', async () => {
    const f = fixture('detached', 'PASS', '```\nHANDOFF RESULT\nnode: a\n```');
    await f.submit();
    expect(f.checks).toHaveBeenCalledWith(
      ['semantic'],
      BODY,
      undefined,
      f.held.semanticContext?.definitions
    );
    expect(f.store.clearReview).toHaveBeenCalledWith('session', 'a');
  });
  test('separate report-only FAIL A renews, then response-only B binds the new attempt', async () => {
    const f = fixture('gate', 'FAIL');
    await f.submit();
    const renewed = f.session.reviews?.a;
    expect(renewed?.semanticContext?.attemptId).not.toBe('attempt-a');
    expect(renewed?.semanticContext?.target).toBeUndefined();
    f.store.getStepState.mockReturnValue({ state: 'completed', isPlaceholder: false });
    const captureContext = new ExecutionContext({ user_response: 'Replacement B' }, logger);
    captureContext.gateEnforcement = new GateEnforcementAuthority(f.service, logger);
    await new StepCaptureService(f.service, logger).captureStep(
      captureContext,
      'session',
      f.session,
      { sessionId: 'session', isChainExecution: true, currentStep: 1 },
      1,
      { userResponse: 'Replacement B', passClearedThisCall: false }
    );
    expect(f.store.completeStep).toHaveBeenCalled();
    expect(f.session.reviews?.a.semanticContext?.target?.content).toBe('Replacement B');
  });
});

describe('canonical plain-fact response address boundaries', () => {
  test('known other node work does not replace earlier review A', () => {
    expect(
      resolveSemanticTargetResponseAdmission({
        ...facts(),
        currentNodeId: 'b',
        currentResponseNodeId: 'b',
        suppliedResponse: 'Different B',
      }).kind
    ).toBe('admitted');
  });
  test.each(['Different B', ''])(
    'past cursor differing body %j refuses while identical duplicate admits',
    (body) => {
      const input = {
        ...facts(),
        currentNodeId: null,
        currentStep: undefined,
        currentResponseNodeId: undefined,
      };
      expect(
        resolveSemanticTargetResponseAdmission({ ...input, suppliedResponse: body }).kind
      ).toBe('refused');
      expect(resolveSemanticTargetResponseAdmission(input).kind).toBe('admitted');
      expect(
        resolveSemanticTargetResponseAdmission({ ...input, suppliedResponse: undefined }).kind
      ).toBe('admitted');
    }
  );
  test('standing detached defined-empty work requires explicit address; earlier ordinary A wins', () => {
    const detached = review('detached');
    const input = {
      ...facts(detached),
      suppliedResponse: '',
      currentStep: { nodeId: 'a', stepNumber: 1, delegated: true, await: 'run' as const },
      detachedNodes: [{ token: 'a', nodeId: 'a', stepNumber: 1, spawned: true, reported: true }],
    };
    expect(resolveSemanticTargetResponseAdmission(input)).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('Name the detached'),
    });
    expect(
      resolveSemanticTargetResponseAdmission({ ...input, suppliedResponse: undefined }).kind
    ).toBe('admitted');
    const ordinary = {
      ...review(),
      nodeId: 'b',
      semanticContext: bindSemanticReviewTarget(
        createSemanticReviewContext('b', 'attempt-b', []),
        BODY
      ),
    };
    expect(
      resolveSemanticTargetResponseAdmission({ ...input, reviews: { a: detached, b: ordinary } })
        .kind
    ).toBe('admitted');
  });
  test('legacy and action-only requests preserve their domain paths', () => {
    const legacy = review();
    delete legacy.semanticContext;
    expect(
      resolveSemanticTargetResponseAdmission({ ...facts(legacy), suppliedResponse: '' }).kind
    ).toBe('admitted');
    expect(
      resolveSemanticTargetResponseAdmission({
        ...facts(),
        verdictPresent: false,
        actionPresent: true,
        suppliedResponse: '',
      }).kind
    ).toBe('admitted');
  });
  test('hidden prefix or fenced suffix work is never stripped for comparison', () => {
    for (const body of ['B\nHANDOFF RESULT\nnode: a', '```\nHANDOFF RESULT\nnode: a\n```\nB']) {
      expect(
        resolveSemanticTargetResponseAdmission({ ...facts(), suppliedResponse: body }).kind
      ).toBe('refused');
    }
  });
});
