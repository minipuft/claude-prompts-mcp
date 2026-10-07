import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { StepCaptureService } from '../../../../src/engine/execution/capture/step-capture-service.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
  resolvePinnedSemanticContext,
} from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
import { evaluateSemanticEvaluation } from '../../../../src/engine/gates/core/semantic-evaluation.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ExecutionRecordStore } from '../../../../src/modules/chains/execution-record-store.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';
import type {
  GateReview,
  GateCheckResult,
  GateVerdictSummary,
} from '../../../../src/shared/types/chain-execution.js';
import type {
  GateVerdictSubmission,
  SemanticObservationState,
} from '../../../../src/shared/types/gate-evaluation.js';

const logger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const BODY = 'Server-captured A';

/** Draft criteria and the actual kernel, without resource-schema or provider activation. */
function issuedReview(kind: 'gate' | 'detached', siblings = false): GateReview {
  const gateIds = siblings ? ['a', 'sibling'] : ['a'];
  return {
    nodeId: 'reviewed',
    kind,
    phase: 'awaiting-verdict',
    gateIds,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 1,
    prompts: [],
    combinedPrompt: '',
    reviewedOutput: BODY,
    semanticContext: bindSemanticReviewTarget(
      createSemanticReviewContext(
        'reviewed',
        'attempt-original',
        gateIds.map((id) => ({
          id,
          name: id,
          type: 'validation',
          description: 'Draft fixture',
          evaluation: { mode: 'judge', model: 'requested-model', strict: true },
          pass_criteria: [
            {
              type: 'semantic_evaluation',
              id: 'criterion',
              question: 'Is the contract met?',
              target: { kind: 'step_output' },
              result: { kind: 'boolean' },
              acceptance: { kind: 'equals', value: true },
              evidence_requirements: { min_items: 1 },
            },
          ],
        }))
      ),
      BODY
    ),
  };
}

function report(
  review: GateReview,
  state: SemanticObservationState,
  overall: 'PASS' | 'FAIL' = 'PASS'
): GateVerdictSubmission {
  if (review.semanticContext === undefined) throw new Error('Missing fixture authority');
  return {
    overall,
    rationale: 'Exact original group claim',
    per_gate: review.gateIds.map((gateId, index) => {
      const pinned = resolvePinnedSemanticContext(review.semanticContext!, gateId);
      const evaluation = {
        binding: pinned.binding,
        observations: [
          {
            criterion_id: 'criterion',
            state,
            value: state === 'met',
            rationale: 'Original observation rationale',
            evidence: [
              {
                target_digest: pinned.binding.target_digest,
                start: 0,
                end: BODY.length,
                quote: BODY,
              },
            ],
          },
        ],
        reviewer: {
          provenance: 'client_reported' as const,
          provider: 'claimed-provider',
          model: 'claimed-model',
          context: 'self' as const,
        },
      };
      return {
        index: index + 1,
        passed: true,
        rationale: `Exact reported gate ${gateId}`,
        evaluation,
      };
    }),
  };
}

function fixture(
  options: {
    kind?: 'gate' | 'detached';
    state?: SemanticObservationState;
    mode?: 'blocking' | 'advisory' | 'informational';
    overall?: 'PASS' | 'FAIL';
    siblings?: boolean;
    checks?: GateCheckResult[];
    body?: string;
    legacy?: boolean;
  } = {}
) {
  const kind = options.kind ?? 'gate';
  const mode = options.mode ?? 'blocking';
  const review = issuedReview(kind, options.siblings);
  if (options.checks !== undefined) review.checkResults = options.checks;
  const submission = report(review, options.state ?? 'unmet', options.overall);
  const session = {
    sessionId: 'session',
    chainId: 'chain',
    reviews: { reviewed: review },
    unknownsLedger: [],
    state: {
      currentNodeId: kind === 'detached' ? 'other' : 'reviewed',
      nodes: [
        { id: 'reviewed', promptId: 'p' },
        { id: 'other', promptId: 'p' },
      ],
      stepStates: new Map(),
    },
  } as unknown as ChainSession;
  const context = new ExecutionContext(
    {
      gate_verdict: options.legacy ? 'GATE_REVIEW: PASS - Exact legacy rationale' : submission,
      ...(options.body !== undefined ? { user_response: options.body } : {}),
    },
    logger
  );
  const duringWrites: Array<GateVerdictSummary[] | undefined> = [];
  const store = {
    getSession: jest.fn(() => session),
    getReview: jest.fn((_id: string, nodeId: string) => session.reviews?.[nodeId]),
    setReview: jest.fn(async (_id: string, next: GateReview) => {
      duringWrites.push(context.state.gates.perGateVerdicts);
      session.reviews ??= {};
      session.reviews[next.nodeId] = next;
    }),
    clearReview: jest.fn(async (_id: string, nodeId: string) => {
      duringWrites.push(context.state.gates.perGateVerdicts);
      delete session.reviews?.[nodeId];
    }),
    recordGateReviewOutcome: jest.fn(async (_id: string, _value: { verdict: 'PASS' | 'FAIL' }) => {
      duringWrites.push(context.state.gates.perGateVerdicts);
    }),
    getStepState: jest.fn(() => ({ state: 'pending', isPlaceholder: false })),
    isStepComplete: jest.fn(() => true),
    updateSessionState: jest.fn(async () => true),
    completeStep: jest.fn(async () => true),
    getChainContext: jest.fn(() => ({ memory: [] })),
    advanceStep: jest.fn(async () => false),
    getPendingShellVerification: jest.fn(() => undefined),
  };
  const service = store as unknown as ChainSessionService;
  const authority = new GateEnforcementAuthority(service, logger);
  // Detached review enforcement is resolved by the authority's IO boundary, not its current node.
  jest.spyOn(authority, 'resolveReviewEnforcement').mockResolvedValue(mode);
  context.gateEnforcement = authority;
  context.state.gates.enforcementMode = mode;
  context.state.gates.reviewGateIds = review.gateIds;
  context.sessionContext = {
    sessionId: 'session',
    isChainExecution: true,
    currentStep: kind === 'detached' ? 2 : 1,
  };
  const processor = new GateVerdictProcessor(
    service,
    logger,
    undefined,
    undefined,
    async () => options.checks ?? []
  );
  const append = jest.fn<ExecutionRecordStore['append']>(() => 'record');
  const capture = new StepCaptureService(service, logger, {
    append,
  } as unknown as ExecutionRecordStore);
  const submit = () =>
    kind === 'detached'
      ? processor.processDetachedReviewVerdict(context, session, 'reviewed')
      : processor.processReviewVerdict(context, session, context.sessionContext!, options.body);
  return {
    review,
    submission,
    session,
    context,
    store,
    authority,
    submit,
    capture,
    append,
    duringWrites,
  };
}

function summary(f: ReturnType<typeof fixture>, gateId = 'a'): GateVerdictSummary {
  const result = f.context.state.gates.perGateVerdicts?.find((entry) => entry.gateId === gateId);
  if (result === undefined) throw new Error(`No summary for ${gateId}`);
  return result;
}

describe('portable semantic summaries from the actual verdict processor', () => {
  test.each(['gate', 'detached'] as const)(
    '%s canonical unmet defeats client PASS and preserves raw report and independent expected pins',
    async (kind) => {
      const f = fixture({ kind });
      const original = structuredClone(f.submission);
      const issued = f.review.semanticContext!;
      const expected = evaluateSemanticEvaluation(
        resolvePinnedSemanticContext(issued, 'a'),
        f.submission.per_gate![0].evaluation
      );
      await f.submit();
      const result = summary(f);
      expect(result).toMatchObject({
        verdict: 'FAIL',
        reportedVerdict: 'PASS',
        reportedRationale: 'Exact reported gate a',
        reportedReview: { overall: 'PASS', rationale: 'Exact original group claim' },
        semanticResult: expected,
        reviewBinding: resolvePinnedSemanticContext(issued, 'a').binding,
        disposition: 'held',
      });
      expect(result.rationale).toContain('unmet');
      expect(result.evaluation).toEqual(original.per_gate![0].evaluation);
      expect(f.submission).toEqual(original);
      expect(f.duringWrites.every((value) => value === undefined)).toBe(true);
      expect(f.context.state.gates.verdictDetection).toMatchObject({
        verdict: 'FAIL',
        outcome: 'pending',
        nodeId: 'reviewed',
      });
    }
  );

  test.each(['gate', 'detached'] as const)(
    '%s insufficient evidence and absent report remain actionable derived failures',
    async (kind) => {
      for (const state of ['insufficient_evidence', 'missing'] as const) {
        const f = fixture({ kind, state: state === 'missing' ? 'met' : state });
        if (state === 'missing') {
          // An overall-only structured submission genuinely carries no per-gate report or claim.
          Object.assign(f.submission, { per_gate: undefined });
        }
        await f.submit();
        const result = summary(f);
        expect(result.verdict).toBe('FAIL');
        expect(result.semanticResult?.passed).toBe(false);
        expect(result.rationale).toContain(
          state === 'missing' ? 'structured per_gate evaluation report' : state
        );
        if (state === 'missing') {
          expect(result.reportedVerdict).toBeUndefined();
          expect(result.evaluation).toBeUndefined();
          expect(result.semanticResult?.issues.map((issue) => issue.code)).toContain(
            'missing_report'
          );
        }
      }
    }
  );

  test('actual scoped tool failure remains FAIL alongside semantic failure; unrelated tool facts cannot poison sibling', async () => {
    const checks = [
      { gateId: 'a', passed: false, summary: 'actual shell check failed' },
      { gateId: 'unadvertised', passed: false, summary: 'unrelated check' },
    ];
    const f = fixture({ checks });
    await f.submit();
    expect(summary(f)).toMatchObject({
      verdict: 'FAIL',
      toolChecks: [checks[0]],
      disposition: 'held',
    });
    expect(summary(f).rationale).toContain('actual shell check failed');
    expect(f.context.state.gates.perGateVerdicts?.map((entry) => entry.gateId)).toEqual(['a']);
  });

  test('accepted group FAIL retains passing semantic and sibling components beside actual failed tool', async () => {
    const checks = [{ gateId: 'a', passed: false, summary: 'actual failed tool' }];
    const f = fixture({ state: 'met', overall: 'FAIL', siblings: true, checks });
    await f.submit();
    expect(summary(f)).toMatchObject({
      verdict: 'FAIL',
      semanticResult: { passed: true },
      toolChecks: checks,
    });
    expect(summary(f, 'sibling')).toMatchObject({
      verdict: 'PASS',
      semanticResult: { passed: true },
      disposition: 'held',
    });
    expect(summary(f, 'sibling').toolChecks).toBeUndefined();
  });
  test('accepted actual advisory tool failure names gate A and does not inherit blocking passing sibling mode', async () => {
    const f = fixture({
      state: 'met',
      overall: 'FAIL',
      siblings: true,
      checks: [{ gateId: 'a', passed: false, summary: 'actual failed advisory tool' }],
    });
    f.context.state.gates.stepEnforcement = {
      declared: new Map([
        ['a', 'advisory'],
        ['sibling', 'blocking'],
      ]),
      undeclared: 'blocking',
    };
    await f.submit();
    expect(summary(f).verdict).toBe('FAIL');
    expect(summary(f, 'sibling').verdict).toBe('PASS');
    expect(f.store.clearReview).toHaveBeenCalledWith('session', 'reviewed');
    expect(summary(f).disposition).toBe('advisory-cleared');
    expect(summary(f)).toMatchObject({
      reportedVerdict: 'PASS',
      semanticResult: { passed: true },
      reportedReview: { overall: 'FAIL' },
    });
    expect(summary(f, 'sibling').disposition).toBe('advisory-cleared');
  });
  test('legacy missing report retains exact legacy claim separately from actionable kernel failure', async () => {
    const f = fixture({ legacy: true });
    await f.submit();
    expect(summary(f)).toMatchObject({
      verdict: 'FAIL',
      reportedVerdict: 'PASS',
      reportedRationale: 'Exact legacy rationale',
      reportedReview: { overall: 'PASS', rationale: 'Exact legacy rationale' },
      semanticResult: { passed: false },
    });
    expect(summary(f).rationale).toContain('structured per_gate evaluation report');
    expect(summary(f).evaluation).toBeUndefined();
  });
  test.each(['gate', 'detached'] as const)(
    '%s PASS over actual failed check preserves refusal, no charge and no accepted summary',
    async (kind) => {
      const f = fixture({
        state: 'met',
        kind,
        checks: [{ gateId: 'a', passed: false, summary: 'actual failed tool' }],
      });
      await f.submit();
      expect(f.context.state.gates.perGateVerdicts).toBeUndefined();
      expect(f.context.state.gates.verdictDetection).toBeUndefined();
      expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(f.store.setReview).toHaveBeenCalledTimes(kind === 'detached' ? 1 : 0);
      expect(f.store.clearReview).not.toHaveBeenCalled();
    }
  );

  test('overall FAIL does not falsify a passing sibling', async () => {
    const f = fixture({ state: 'met', overall: 'FAIL', siblings: true });
    await f.submit();
    expect(summary(f, 'sibling')).toMatchObject({
      verdict: 'PASS',
      semanticResult: { passed: true },
      disposition: 'held',
      reportedReview: { overall: 'FAIL', rationale: 'Exact original group claim' },
    });
  });

  test('requested frozen config stays separate from claimed or unknown reviewer identity', async () => {
    for (const known of [true, false]) {
      const f = fixture({ state: 'met' });
      if (!known) {
        const entry = f.submission.per_gate![0];
        Object.assign(entry.evaluation!, { reviewer: undefined });
      }
      await f.submit();
      const result = summary(f);
      expect(result.requestedEvaluation).toEqual({
        mode: 'judge',
        model: 'requested-model',
        strict: true,
      });
      expect(result.evaluation?.reviewer).toEqual(
        known
          ? {
              provenance: 'client_reported',
              provider: 'claimed-provider',
              model: 'claimed-model',
              context: 'self',
            }
          : undefined
      );
      expect(result).not.toHaveProperty('observedReviewer');
      expect(result).not.toHaveProperty('billing');
    }
  });

  test('nonsemantic ordinary per-gate FAIL preserves existing overall PASS clearing', async () => {
    const f = fixture({ state: 'met' });
    f.review.semanticContext = bindSemanticReviewTarget(
      createSemanticReviewContext('reviewed', 'ordinary-attempt', [
        {
          id: 'a',
          name: 'Ordinary gate',
          type: 'validation',
          description: 'Legacy scope',
          pass_criteria: [{ type: 'inline_guidance' }],
        },
      ]),
      BODY
    );
    Object.assign(f.submission.per_gate![0], { passed: false, evaluation: undefined });
    await f.submit();
    expect(f.store.clearReview).toHaveBeenCalledWith('session', 'reviewed');
    expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'PASS' });
    expect(summary(f).semanticResult).toBeUndefined();
  });
  test.each(['advisory', 'informational'] as const)(
    '%s explicit semantic client FAIL clears with FAIL grade and component PASS',
    async (mode) => {
      const f = fixture({ state: 'met', mode });
      Object.assign(f.submission.per_gate![0], {
        passed: false,
        rationale: 'Explicit client hold',
      });
      await f.submit();
      expect(f.store.clearReview).toHaveBeenCalledWith('session', 'reviewed');
      expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'FAIL' });
      expect(summary(f)).toMatchObject({
        verdict: 'FAIL',
        semanticResult: { passed: true },
        disposition: `${mode}-cleared`,
        reportedReview: { overall: 'PASS' },
      });
    }
  );
  test.each(['gate', 'detached'] as const)(
    '%s required semantic explicit per-gate FAIL conservatively holds and charges despite canonical/group PASS',
    async (kind) => {
      const f = fixture({ state: 'met', kind });
      Object.assign(f.submission.per_gate![0], {
        passed: false,
        rationale: 'Explicit client hold',
      });
      await f.submit();
      expect(summary(f)).toMatchObject({
        verdict: 'FAIL',
        reportedVerdict: 'FAIL',
        semanticResult: { passed: true },
      });
      expect(f.store.clearReview).not.toHaveBeenCalled();
      expect(f.store.recordGateReviewOutcome).toHaveBeenCalledWith('session', { verdict: 'FAIL' });
      expect(f.session.reviews?.reviewed.attemptCount).toBe(1);
      expect(summary(f).disposition).toBe('held');
      expect(summary(f).reportedReview?.overall).toBe('PASS');
    }
  );
});

describe.each(['advisory', 'informational'] as const)(
  '%s clearing preserves actual FAIL in both capture shapes',
  (mode) => {
    test.each(['same-call', 'split', 'detached'] as const)(
      '%s ledger contains FAIL grade and clearing disposition',
      async (shape) => {
        const f = fixture({
          mode,
          kind: shape === 'detached' ? 'detached' : 'gate',
          ...(shape === 'same-call' ? { body: BODY } : {}),
        });
        await f.submit();
        if (shape === 'same-call') {
          await f.capture.captureStep(
            f.context,
            'session',
            f.session,
            f.context.sessionContext!,
            1,
            { userResponse: BODY, passClearedThisCall: false }
          );
        } else f.capture.ledgerSubmittedVerdict(f.context, 'session', f.session);
        expect(f.append).toHaveBeenCalledTimes(1);
        const record = f.append.mock.calls[0][0];
        expect(record).toMatchObject({
          status: 'completed',
          nodeId: 'reviewed',
          gateVerdicts: [
            expect.objectContaining({
              verdict: 'FAIL',
              reportedVerdict: 'PASS',
              disposition: `${mode}-cleared`,
              semanticResult: expect.objectContaining({ passed: false }),
            }),
          ],
        });
        expect(record).not.toHaveProperty('inputRequired');
        expect(f.context.state.gates.verdictDetection).toMatchObject({
          verdict: 'FAIL',
          outcome: 'cleared',
        });
      }
    );
  }
);
