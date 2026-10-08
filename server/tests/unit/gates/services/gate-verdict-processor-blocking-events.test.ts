/**
 * P4.117: a blocking FAIL announces its gate events in one order, inside the call.
 *
 * `handleBlockingFail` fired its three `emitGateEvents` with `void` — the fire-and-forget shape
 * row B.54 removed from the advisory and informational handlers. The events then interleaved,
 * finished after the verdict call had returned (and the response had been built from it), and
 * a throw outside `emitGateEvents`' own catch became an unhandled rejection nobody reported.
 *
 * The order is pinned as ONE sequence value, the way the chain-lifecycle emission test pins its
 * announcements: pairwise "A before B" checks constrain only the pairs someone thought of. The
 * last test closes the shape: no gate event in this processor is fired and forgotten.
 *
 * Classification: Unit (one processor, stubbed store, hooks and notifications) plus one
 * source-shape check.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
  resolvePinnedSemanticContext,
} from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { evaluateSemanticEvaluation } from '../../../../src/engine/gates/core/semantic-evaluation.js';
import { PHASE_GUARD_GATE_ID } from '../../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
import { hashBytes } from '../../../../src/shared/utils/hash.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { McpToolRequest } from '../../../../src/shared/types/execution.js';
import type {
  GateVerdictEntry,
  GateVerdictSubmission,
} from '../../../../src/shared/types/gate-evaluation.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '../../../../src/shared/types/index.js';

const PROCESSOR_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../src/engine/gates/services/gate-verdict-processor.ts'
);

/** Resolve on a later macrotask: an awaited emitter still finishes in order, a forgotten one does not. */
const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createLogger = (): Logger & { warn: jest.Mock } =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger & { warn: jest.Mock };

function createStore() {
  return {
    recordGateReviewOutcome: jest.fn(async () => undefined),
    setReview: jest.fn(async () => undefined),
    clearPendingGateReview: jest.fn(async () => undefined),
    advanceStep: jest.fn(async () => false),
  } as unknown as ChainSessionService;
}

/** Hooks and notifications that append to one shared sequence, each completing a tick later. */
function createEmitters(sequence: string[]) {
  const hooks = {
    emitGateFailed: jest.fn(async (gate: { id: string }) => {
      await later();
      sequence.push(`hook:failed:${gate.id}`);
    }),
    emitRetryExhausted: jest.fn(async (gateIds: string[]) => {
      await later();
      sequence.push(`hook:retryExhausted:${gateIds.join(',')}`);
    }),
    emitResponseBlocked: jest.fn(async (gateIds: string[]) => {
      await later();
      sequence.push(`hook:responseBlocked:${gateIds.join(',')}`);
    }),
    emitGateEvaluated: jest.fn(async () => undefined),
  } as unknown as HookRegistryPort;
  const notifications = {
    emitGateFailed: jest.fn((n: { gateId: string }) => sequence.push(`notify:failed:${n.gateId}`)),
    emitRetryExhausted: jest.fn((n: { gateIds: string[] }) =>
      sequence.push(`notify:retryExhausted:${n.gateIds.join(',')}`)
    ),
    emitResponseBlocked: jest.fn((n: { gateIds: string[] }) =>
      sequence.push(`notify:responseBlocked:${n.gateIds.join(',')}`)
    ),
  } as unknown as McpNotificationEmitterPort;
  return { hooks, notifications };
}

function createContext() {
  const context = new ExecutionContext(
    {
      chain_id: 'chain-test#1',
      gate_verdict: 'GATE_REVIEW: FAIL - it did not hold',
      user_response: 'a response',
    },
    createLogger()
  );
  context.state.gates.enforcementMode = 'blocking';
  jest.spyOn(context.gates, 'hasBlockingGates').mockReturnValue(true);
  jest.spyOn(context.gates, 'getBlockingGateIds').mockReturnValue(['gate-a']);
  context.sessionContext = { sessionId: 'session-1', isChainExecution: true, currentStep: 1 };
  return context;
}

/** A run on `node-1` whose review of it has spent `attemptCount` of its two attempts. */
const sessionWith = (attemptCount: number) =>
  ({
    sessionId: 'session-1',
    reviews: {
      'node-1': {
        nodeId: 'node-1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: ['gate-a'],
        prompts: [],
        createdAt: 1,
        attemptCount,
        maxAttempts: 2,
      },
    },
    state: { currentNodeId: 'node-1', nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
  }) as unknown as ChainSession;

function structuredReview(
  indexes: readonly number[] = [1],
  definitionDigest = hashBytes('frozen definition')
): GateVerdictSubmission {
  const targetDigest = hashBytes('A😀e\u0301 Z');
  return {
    overall: 'FAIL',
    rationale: 'Report reviewed',
    per_gate: indexes.map((index): GateVerdictEntry => ({
      index,
      passed: false,
      rationale: 'Criterion unmet',
      evaluation: {
        binding: {
          gate_id: 'gate-a',
          node_id: 'node-1',
          attempt_id: 'attempt-1',
          definition_digest: definitionDigest,
          target_digest: targetDigest,
        },
        observations: [
          {
            criterion_id: 'preserves-contract',
            state: 'unmet',
            value: false,
            evidence: [{ target_digest: targetDigest, start: 1, end: 5, quote: '😀e\u0301' }],
            rationale: 'Unicode evidence retained.\nReport rationale is multiline.',
          },
        ],
        reviewer: {
          provenance: 'client_reported',
          provider: 'claimed-provider',
          model: 'claimed-model',
          revision: 'claimed-revision',
          context: 'isolated_judge',
        },
      },
    })),
  };
}

function custodyFixture(kind: 'ordinary' | 'detached', verdict: McpToolRequest['gate_verdict']) {
  const logger = createLogger();
  const store = {
    recordGateReviewOutcome: jest.fn<ChainSessionService['recordGateReviewOutcome']>(
      async (_sessionId, _outcome) => undefined
    ),
    setReview: jest.fn<ChainSessionService['setReview']>(async (_sessionId, _review) => undefined),
    clearReview: jest.fn(async () => undefined),
    advanceStep: jest.fn(async () => false),
    isStepComplete: jest.fn(() => true),
  };
  const service = store as unknown as ChainSessionService;
  const authority = new GateEnforcementAuthority(service, logger);
  const context = new ExecutionContext(
    { chain_id: 'chain-review#1', gate_verdict: verdict },
    logger
  );
  context.gateEnforcement = authority;
  context.state.gates.enforcementMode = 'blocking';
  context.state.gates.reviewGateIds = ['gate-a'];
  const base = sessionWith(0);
  const held = base.reviews?.['node-1'];
  if (held === undefined) throw new Error('Review fixture missing');
  const session: ChainSession = {
    ...base,
    state: { ...base.state, currentNodeId: kind === 'detached' ? 'node-2' : 'node-1' },
    reviews: {
      'node-1': {
        ...held,
        kind: kind === 'detached' ? 'detached' : 'gate',
        reviewedOutput: 'A😀e\u0301 Z',
        semanticContext: bindSemanticReviewTarget(
          createSemanticReviewContext('node-1', 'ordinary-attempt', [
            {
              id: 'gate-a',
              name: 'Carrier gate',
              type: 'guidance',
              description: 'Ordinary report custody',
              enforcementMode: 'blocking',
              pass_criteria: [{ type: 'inline_guidance' }],
            },
          ]),
          'A😀e\u0301 Z'
        ),
      },
    },
  };
  const sessionContext = {
    sessionId: session.sessionId,
    currentStep: kind === 'detached' ? 2 : 1,
    currentNodeId: session.state.currentNodeId ?? undefined,
    isChainExecution: true,
  };
  context.sessionContext = sessionContext;
  const processor = new GateVerdictProcessor(service, logger, undefined, undefined, async () => [
    { gateId: 'gate-a', passed: true, summary: 'Captured check passed' },
  ]);
  const submit = () =>
    kind === 'detached'
      ? processor.processDetachedReviewVerdict(context, session, 'node-1')
      : processor.processReviewVerdict(context, session, sessionContext, 'A😀e\u0301 Z');
  return { authority, context, session, store, submit };
}

describe('canonical structural cleared-node flag', () => {
  test.each([false, true])(
    'authored canonical ID sets the cleared flag only with server membership=%j',
    async (marked) => {
      const f = custodyFixture('ordinary', 'GATE_REVIEW: PASS - The reviewed output is accepted');
      const review = f.session.reviews?.['node-1'];
      if (review === undefined) throw new Error('Missing review');
      review.gateIds = [PHASE_GUARD_GATE_ID];
      review.semanticContext = bindSemanticReviewTarget(
        createSemanticReviewContext('node-1', 'canonical-attempt', [
          {
            id: PHASE_GUARD_GATE_ID,
            name: 'Authored collision',
            type: 'validation',
            description: 'Public authored fixture',
            pass_criteria: [{ type: 'inline_guidance' }],
          },
        ]),
        'A😀e\u0301 Z'
      );
      if (marked) review.structuralGateIds = [PHASE_GUARD_GATE_ID];
      f.context.state.gates.reviewGateIds = [PHASE_GUARD_GATE_ID];
      const result = await f.submit();
      expect(result).toMatchObject({ passClearedThisCall: true });
      expect(f.store.clearReview).toHaveBeenCalledTimes(1);
      expect(f.context.state.gates.phaseGuardReviewClearedNodeId).toBe(
        marked ? 'node-1' : undefined
      );
    }
  );
});

/** Draft authority fixture; this does not load or activate live semantic resource criteria. */
function draftSemanticContext() {
  return createSemanticReviewContext('node-1', 'attempt-1', [
    {
      id: 'gate-a',
      name: 'Draft gate',
      type: 'validation',
      description: 'Frozen draft rubric',
      pass_criteria: [
        {
          type: 'semantic_evaluation',
          id: 'preserves-contract',
          target: { kind: 'step_output' },
          question: 'Does the output preserve the contract?',
          evidence_requirements: { min_items: 1 },
          result: { kind: 'boolean' },
          acceptance: { kind: 'equals', value: true },
        },
      ],
    },
  ]);
}

function pinReview(fixture: ReturnType<typeof custodyFixture>) {
  const review = fixture.session.reviews?.['node-1'];
  if (review === undefined) throw new Error('Review fixture missing');
  const issued = draftSemanticContext();
  review.semanticContext = bindSemanticReviewTarget(issued, 'A😀e\u0301 Z');
  return review;
}

/** A report whose pins match the server fixture; client flags remain separate claims. */
function semanticSubmission(issue = 'valid'): GateVerdictSubmission {
  const snapshot = draftSemanticContext().definitions['gate-a'];
  if (snapshot === undefined) throw new Error('Draft rubric missing');
  const base = structuredReview([1], snapshot.definitionDigest);
  const entry = base.per_gate?.[0];
  const evaluation = entry?.evaluation;
  if (entry === undefined || evaluation === undefined) throw new Error('Report fixture missing');
  const binding = { ...evaluation.binding };
  if (issue === 'stale-attempt') binding.attempt_id = 'old-attempt';
  if (issue === 'stale-definition') binding.definition_digest = 'different-definition';
  if (issue === 'wrong-node') binding.node_id = 'node-2';
  if (issue === 'wrong-target') binding.target_digest = hashBytes('client substitute');
  const observations = evaluation.observations.map((observation) => ({
    ...observation,
    criterion_id: issue === 'unknown-criterion' ? 'undeclared' : observation.criterion_id,
    state: issue === 'unmet' ? ('unmet' as const) : ('met' as const),
    value: issue !== 'unmet',
    evidence: issue === 'missing-evidence' ? [] : observation.evidence,
  }));
  return {
    ...base,
    overall: 'PASS',
    per_gate: [
      {
        ...entry,
        passed: true,
        ...(issue === 'missing-report'
          ? { evaluation: undefined }
          : { evaluation: { ...evaluation, binding, observations } }),
      },
    ],
  };
}

describe('GateVerdictProcessor attempt renewal', () => {
  test('ordinary FAIL persists one fresh attempt without its old target or rubric mutation', async () => {
    const snapshot = draftSemanticContext().definitions['gate-a'];
    if (snapshot === undefined) throw new Error('Draft rubric missing');
    const submission = structuredReview([1], snapshot.definitionDigest);
    const originalSubmission = structuredClone(submission);
    const fixture = custodyFixture('ordinary', submission);
    const originalReview = pinReview(fixture);
    const pins = originalReview.semanticContext;
    const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
    expect(submission.per_gate?.[0]?.evaluation?.binding.definition_digest).toBe(
      pins?.definitions['gate-a']?.definitionDigest
    );
    expect(submission.per_gate?.[0]?.evaluation?.binding.target_digest).toBe(pins?.target?.digest);

    await fixture.submit();

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fixture.store.setReview).toHaveBeenCalledTimes(1);
    const persisted = fixture.store.setReview.mock.calls[0]?.[1];
    expect(persisted?.semanticContext?.attemptId).not.toBe(pins?.attemptId);
    expect(persisted?.semanticContext?.attemptId).toEqual(expect.any(String));
    expect(persisted?.semanticContext).not.toHaveProperty('target');
    expect(persisted?.semanticContext?.definitions).toBe(pins?.definitions);
    expect(persisted?.attemptCount).toBe(1);
    expect(persisted?.previousResponse).toEqual(expect.any(String));
    expect(fixture.context.sessionContext?.pendingReview).toBe(persisted);
    expect(originalReview.semanticContext).toBe(pins);
    expect(pins?.target?.digest).toBe(hashBytes('A😀e\u0301 Z'));
    expect(submission).toEqual(originalSubmission);
    expect(fixture.context.state.gates.perGateVerdicts?.[0]?.evaluation).toBe(
      submission.per_gate?.[0]?.evaluation
    );
    expect(submission.per_gate?.[0]?.evaluation?.binding.attempt_id).not.toBe(
      persisted?.semanticContext?.attemptId
    );
  });

  test('exhausted ordinary retry persists the renewed review returned to its caller', async () => {
    const fixture = custodyFixture('ordinary', 'GATE_REVIEW: FAIL - Retry');
    const original = pinReview(fixture);
    original.phase = 'exhausted';
    original.attemptCount = 2;
    const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
    const processor = new GateVerdictProcessor(
      fixture.store as unknown as ChainSessionService,
      createLogger()
    );
    const sessionContext = fixture.context.sessionContext;
    if (sessionContext === undefined) throw new Error('Session fixture missing');

    await processor.handleGateAction(fixture.context, fixture.session, 'retry', sessionContext);

    expect(renew).toHaveBeenCalledTimes(1);
    const persisted = fixture.store.setReview.mock.calls[0]?.[1];
    expect(persisted?.semanticContext?.attemptId).not.toBe(original.semanticContext?.attemptId);
    expect(persisted?.semanticContext).not.toHaveProperty('target');
    expect(persisted?.semanticContext?.definitions).toBe(original.semanticContext?.definitions);
    expect(sessionContext.pendingReview).toBe(persisted);
    expect(persisted?.attemptCount).toBe(0);
  });

  test('detached FAIL defers renewal until replacement and returns exactly the persisted pins', async () => {
    const fixture = custodyFixture('detached', semanticSubmission('unmet'));
    const original = pinReview(fixture);
    const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
    await fixture.submit();
    expect(renew).not.toHaveBeenCalled();
    const waiting = fixture.store.setReview.mock.calls.at(-1)?.[1];
    if (waiting === undefined) throw new Error('Waiting review missing');
    expect(waiting.semanticContext).toBe(original.semanticContext);
    fixture.session.reviews = { 'node-1': waiting };
    fixture.store.setReview.mockClear();
    const processor = new GateVerdictProcessor(
      fixture.store as unknown as ChainSessionService,
      createLogger()
    );

    const reopened = await processor.applyReplacementReport(
      fixture.context,
      fixture.session,
      'node-1',
      'replacement'
    );

    expect(renew).toHaveBeenCalledTimes(1);
    expect(fixture.store.setReview).toHaveBeenCalledTimes(1);
    expect(reopened).toBe(fixture.store.setReview.mock.calls[0]?.[1]);
    expect(reopened?.semanticContext?.attemptId).not.toBe(original.semanticContext?.attemptId);
    expect(reopened?.semanticContext).not.toHaveProperty('target');
    expect(reopened?.semanticContext?.definitions).toBe(original.semanticContext?.definitions);
  });

  test.each(['passed', 'cleared', 'exhausted'] as const)(
    '%s verdict outcomes never renew semantic pins',
    async (outcome) => {
      const fixture = custodyFixture(
        'ordinary',
        outcome === 'passed' ? semanticSubmission() : semanticSubmission('unmet')
      );
      const original = pinReview(fixture);
      if (outcome === 'cleared') fixture.context.state.gates.enforcementMode = 'advisory';
      if (outcome === 'exhausted') original.attemptCount = 1;
      const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
      await fixture.submit();
      expect(renew).not.toHaveBeenCalled();
      if (outcome === 'exhausted') {
        expect(fixture.store.setReview.mock.calls.at(-1)?.[1]?.semanticContext).toBe(
          original.semanticContext
        );
      } else expect(fixture.store.clearReview).toHaveBeenCalled();
    }
  );

  test('detached exhausted retry waits for replacement without renewing twice', async () => {
    const fixture = custodyFixture('detached', semanticSubmission('unmet'));
    const original = pinReview(fixture);
    original.phase = 'exhausted';
    original.attemptCount = 2;
    const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
    const processor = new GateVerdictProcessor(
      fixture.store as unknown as ChainSessionService,
      createLogger()
    );
    await processor.processDetachedReviewAction(
      fixture.context,
      fixture.session,
      'node-1',
      'retry'
    );
    expect(renew).not.toHaveBeenCalled();
    expect(fixture.store.setReview.mock.calls.at(-1)?.[1]).toMatchObject({
      phase: 'awaiting-replacement',
      attemptCount: 0,
    });
    expect(fixture.store.setReview.mock.calls.at(-1)?.[1]?.semanticContext).toBe(
      original.semanticContext
    );
  });

  test('missing authority refuses semantic renewal before counters or review writes', async () => {
    const fixture = custodyFixture('ordinary', semanticSubmission('unmet'));
    pinReview(fixture);
    fixture.context.gateEnforcement = undefined;
    await expect(fixture.submit()).rejects.toThrow('retry requires gate enforcement authority');
    expect(fixture.store.setReview).not.toHaveBeenCalled();
    expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
    expect(fixture.store.advanceStep).not.toHaveBeenCalled();
  });

  test('refused and terminal replacement attempts do not renew or write', async () => {
    const fixture = custodyFixture('detached', semanticSubmission('unmet'));
    const original = pinReview(fixture);
    const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
    const processor = new GateVerdictProcessor(
      fixture.store as unknown as ChainSessionService,
      createLogger()
    );
    expect(
      await processor.applyReplacementReport(
        fixture.context,
        fixture.session,
        'node-1',
        'replacement'
      )
    ).toBeNull();
    fixture.session.reviews = {};
    expect(
      await processor.applyReplacementReport(
        fixture.context,
        fixture.session,
        'node-1',
        'replacement'
      )
    ).toBeNull();
    expect(renew).not.toHaveBeenCalled();
    expect(fixture.store.setReview).not.toHaveBeenCalled();
    expect(original.semanticContext?.attemptId).toBe('attempt-1');
  });
});

describe('GateVerdictProcessor pinned semantic adjudication', () => {
  test.each(['ordinary', 'detached'] as const)(
    'accepts a complete met report on a %s review',
    async (kind) => {
      const submission = semanticSubmission();
      const fixture = custodyFixture(kind, submission);
      pinReview(fixture);
      const result = await fixture.submit();
      expect(fixture.store.clearReview).toHaveBeenCalled();
      if (kind === 'ordinary') expect(result).toMatchObject({ passClearedThisCall: true });
      else expect(result).toMatchObject({ kind: 'recorded', result: 'passed' });
      expect(fixture.context.state.gates.perGateVerdicts?.[0]?.evaluation).toBe(
        submission.per_gate?.[0]?.evaluation
      );
    }
  );

  test.each(
    (['ordinary', 'detached'] as const).flatMap((kind) =>
      [
        'unmet',
        'missing-report',
        'stale-attempt',
        'stale-definition',
        'wrong-node',
        'wrong-target',
        'unknown-criterion',
        'missing-evidence',
      ].map((issue) => ({ kind, issue }))
    )
  )(
    'client PASS cannot clear $issue evidence on a $kind semantic review',
    async ({ kind, issue }) => {
      const submission = semanticSubmission(issue);
      const original = structuredClone(submission);
      const fixture = custodyFixture(kind, submission);
      const held = pinReview(fixture);
      const before = structuredClone(held);
      const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
      const enforcement = jest.spyOn(fixture.authority, 'resolveReviewEnforcement');
      const result = await fixture.submit();
      const stale = ['stale-attempt', 'stale-definition', 'wrong-node', 'wrong-target'].includes(
        issue
      );
      if (stale) {
        expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
        expect(fixture.store.setReview).not.toHaveBeenCalled();
        expect(renew).not.toHaveBeenCalled();
        expect(held).toEqual(before);
        if (kind === 'detached') expect(result).toMatchObject({ kind: 'refused' });
      } else {
        expect(fixture.store.recordGateReviewOutcome).toHaveBeenCalledWith('session-1', {
          verdict: 'FAIL',
        });
        expect(fixture.store.setReview.mock.calls.at(-1)?.[1]?.retryHints?.join(' ')).toContain(
          'Semantic gate'
        );
        if (issue === 'missing-report')
          expect(fixture.store.setReview.mock.calls.at(-1)?.[1]?.retryHints?.join(' ')).toContain(
            'structured per_gate'
          );
        if (kind === 'detached') expect(enforcement.mock.calls[0]?.[1]).toEqual(['gate-a']);
        expect(fixture.context.state.gates.verdictDetection?.verdict).toBe('FAIL');
        const derived = fixture.context.state.gates.perGateVerdicts?.[0];
        expect(derived).toMatchObject({
          verdict: 'FAIL',
          reportedVerdict: 'PASS',
          reportedReview: { overall: 'PASS' },
        });
        if (before.semanticContext === undefined)
          throw new Error('Missing frozen semantic fixture');
        const expected = resolvePinnedSemanticContext(before.semanticContext, 'gate-a');
        expect(derived?.semanticResult).toEqual(
          evaluateSemanticEvaluation(expected, submission.per_gate?.[0]?.evaluation)
        );
        expect(derived?.reviewBinding).toEqual(expected.binding);
        expect(derived?.evaluation).toBe(submission.per_gate?.[0]?.evaluation);
      }
      expect(fixture.store.clearReview).not.toHaveBeenCalled();
      expect(fixture.store.advanceStep).not.toHaveBeenCalled();
      if (kind === 'ordinary') expect(result).toMatchObject({ passClearedThisCall: false });
      else expect(result).not.toMatchObject({ result: 'passed' });
      expect(submission).toEqual(original);
    }
  );

  test.each(['ordinary', 'detached'] as const)(
    'refuses a %s same-call report until actual prior capture supplies a target',
    async (kind) => {
      const fixture = custodyFixture(kind, semanticSubmission());
      const held = pinReview(fixture);
      held.semanticContext = draftSemanticContext();
      const before = structuredClone(held);
      const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
      const result = await fixture.submit();
      expect(fixture.store.setReview).not.toHaveBeenCalled();
      expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(fixture.store.clearReview).not.toHaveBeenCalled();
      expect(renew).not.toHaveBeenCalled();
      expect(held).toEqual(before);
      if (kind === 'detached') expect(result).toMatchObject({ kind: 'refused' });
      else expect(result).toMatchObject({ earlyExit: true, passClearedThisCall: false });
    }
  );

  test.each(
    (['ordinary', 'detached'] as const).flatMap((kind) =>
      [true, false].map((issued) => ({ kind, issued }))
    )
  )(
    'ordinary legacy PASS remains supported on $kind reviews (issued=$issued)',
    async ({ kind, issued }) => {
      const fixture = custodyFixture(kind, 'GATE_REVIEW: PASS - Ordinary gate satisfied');
      const held = fixture.session.reviews?.['node-1'];
      if (held === undefined) throw new Error('Missing ordinary review');
      if (!issued) delete held.semanticContext;
      await fixture.submit();
      expect(fixture.store.clearReview).toHaveBeenCalled();
      expect(fixture.store.recordGateReviewOutcome).toHaveBeenCalledWith('session-1', {
        verdict: 'PASS',
      });
    }
  );

  test('canonical kernel distinguishes malformed attribution from a captured missing report', () => {
    const fixture = custodyFixture('ordinary', semanticSubmission());
    const held = pinReview(fixture);
    if (held.semanticContext === undefined) throw new Error('Missing server context');
    const expected = resolvePinnedSemanticContext(held.semanticContext, 'gate-a');
    const report = semanticSubmission().per_gate?.[0]?.evaluation;
    const malformed = evaluateSemanticEvaluation(expected, { ...report, binding: null });
    expect(malformed.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid_binding', 'invalid_report'])
    );
    const absent = evaluateSemanticEvaluation(expected, undefined);
    expect(absent.issues.map((issue) => issue.code)).toContain('missing_report');
    expect(absent.issues.map((issue) => issue.code)).not.toContain('invalid_binding');
    const corrupt = evaluateSemanticEvaluation(
      {
        ...expected,
        binding: { ...expected.binding, target_digest: hashBytes('wrong persisted bytes') },
      },
      undefined
    );
    expect(corrupt.issues.map((issue) => issue.code)).toContain('target_digest_mismatch');
    expect(corrupt.issues.map((issue) => issue.code)).not.toContain('missing_report');
  });

  test.each(
    (['ordinary', 'detached'] as const).flatMap((kind) =>
      ['missing-context', 'corrupt-target', 'duplicate-criteria'].map((issue) => ({ kind, issue }))
    )
  )(
    'refuses $issue server authority on a $kind review without charging or changing it',
    async ({ kind, issue }) => {
      const fixture = custodyFixture(kind, semanticSubmission());
      const held = pinReview(fixture);
      const issued = held.semanticContext;
      if (issued === undefined || issued.target === undefined)
        throw new Error('Missing fixture authority');
      if (issue === 'missing-context') delete held.semanticContext;
      if (issue === 'corrupt-target')
        held.semanticContext = {
          ...issued,
          target: { ...issued.target, digest: hashBytes('bad persisted target') },
        };
      if (issue === 'duplicate-criteria') {
        const snapshot = issued.definitions['gate-a'];
        const criteria = snapshot?.definition['pass_criteria'];
        if (snapshot === undefined || !Array.isArray(criteria)) throw new Error('Missing rubric');
        held.semanticContext = {
          ...issued,
          definitions: {
            ...issued.definitions,
            'gate-a': {
              ...snapshot,
              definition: { ...snapshot.definition, pass_criteria: [...criteria, ...criteria] },
            },
          },
        };
      }
      const before = structuredClone(held);
      const renew = jest.spyOn(fixture.authority, 'renewReviewAttempt');
      const result = await fixture.submit();
      if (issue === 'missing-context') {
        if (kind === 'detached')
          expect(result).toMatchObject({
            kind: 'refused',
            message: expect.stringContaining(
              'Open a fresh server-issued review, then capture the node'
            ),
          });
        else
          expect(fixture.context.response).toMatchObject({
            isError: true,
            content: [
              {
                type: 'text',
                text: expect.stringContaining(
                  'Open a fresh server-issued review, then capture the node'
                ),
              },
            ],
          });
      }
      expect(fixture.store.setReview).not.toHaveBeenCalled();
      expect(fixture.store.clearReview).not.toHaveBeenCalled();
      expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(renew).not.toHaveBeenCalled();
      expect(held).toEqual(before);
    }
  );

  test.each(['ordinary', 'detached'] as const)(
    'preserves conservative client FAIL with otherwise met evidence on a %s review',
    async (kind) => {
      const passed = semanticSubmission();
      const submission: GateVerdictSubmission = {
        ...passed,
        overall: 'FAIL',
        per_gate: passed.per_gate?.map((entry) => ({ ...entry, passed: false })),
      };
      const fixture = custodyFixture(kind, submission);
      pinReview(fixture);
      await fixture.submit();
      expect(fixture.store.clearReview).not.toHaveBeenCalled();
      expect(fixture.store.recordGateReviewOutcome).toHaveBeenCalledWith('session-1', {
        verdict: 'FAIL',
      });
    }
  );

  test.each(['ordinary', 'detached'] as const)(
    'legacy PASS cannot stand in for a required semantic report on a %s review',
    async (kind) => {
      const fixture = custodyFixture(kind, 'GATE_REVIEW: PASS - Trust the reviewer');
      pinReview(fixture);
      const result = await fixture.submit();
      expect(fixture.store.clearReview).not.toHaveBeenCalled();
      if (kind === 'ordinary') expect(result).toMatchObject({ passClearedThisCall: false });
      else expect(result).not.toMatchObject({ result: 'passed' });
    }
  );
});

describe('GateVerdictProcessor typed report custody', () => {
  test.each(['ordinary', 'detached'] as const)(
    'retains the original rich report in %s capture state',
    async (kind) => {
      const verdict = structuredReview();
      const original = structuredClone(verdict);
      const fixture = custodyFixture(kind, verdict);
      const currentNode = fixture.session.state.currentNodeId;

      const result = await fixture.submit();

      const entries = fixture.context.state.gates.perGateVerdicts;
      expect(entries).toHaveLength(1);
      expect(entries?.[0]?.evaluation).toBe(verdict.per_gate?.[0]?.evaluation);
      expect(entries?.[0]?.evaluation).toEqual(original.per_gate?.[0]?.evaluation);
      expect(entries?.[0]).toMatchObject({
        gateId: 'gate-a',
        verdict: 'FAIL',
        rationale: 'Criterion unmet',
      });
      expect(fixture.store.recordGateReviewOutcome).toHaveBeenCalledWith('session-1', {
        verdict: 'FAIL',
      });
      expect(fixture.store.advanceStep).not.toHaveBeenCalled();
      expect(fixture.session.state.currentNodeId).toBe(currentNode);
      expect(verdict).toEqual(original);
      if (kind === 'detached')
        expect(result).toMatchObject({ kind: 'recorded', result: 'failed', attempt: 1 });
      else expect(result).toMatchObject({ passClearedThisCall: false, earlyExit: false });
    }
  );

  test.each(['ordinary', 'detached'] as const)(
    'keeps legacy string summaries available for %s reviews',
    async (kind) => {
      const fixture = custodyFixture(
        kind,
        'GATE_REVIEW: FAIL - Legacy review\n\nGATE_VERDICTS:\n[1] FAIL - Legacy criterion'
      );

      await fixture.submit();

      expect(fixture.context.state.gates.perGateVerdicts?.[0]).toMatchObject({
        gateId: 'gate-a',
        verdict: 'FAIL',
        rationale: 'Legacy criterion',
      });
      expect(fixture.context.state.gates.perGateVerdicts?.[0]).not.toHaveProperty('evaluation');
      expect(fixture.store.advanceStep).not.toHaveBeenCalled();
    }
  );

  test.each(
    (['ordinary', 'detached'] as const).flatMap((kind) => [
      { kind, issue: 'unknown', indexes: [1, 7] },
      { kind, issue: 'duplicate', indexes: [1, 1] },
    ])
  )(
    'refuses $issue indexes on a $kind review before counters, writes or advancement',
    async ({ kind, indexes }) => {
      const fixture = custodyFixture(kind, structuredReview(indexes));
      const before = structuredClone(fixture.session);

      await expect(fixture.submit()).rejects.toThrow('Structured gate verdict refused');

      expect(fixture.context.state.gates.perGateVerdicts).toBeUndefined();
      expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(fixture.store.setReview).not.toHaveBeenCalled();
      expect(fixture.store.clearReview).not.toHaveBeenCalled();
      expect(fixture.store.advanceStep).not.toHaveBeenCalled();
      expect(fixture.session).toEqual(before);
    }
  );

  test.each(['ordinary', 'detached'] as const)(
    'does not record or advance malformed structured input on a %s review',
    async (kind) => {
      const malformed = {
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [{ index: 1, passed: 'yes', rationale: 'Malformed' }],
      } as unknown as GateVerdictSubmission;
      const fixture = custodyFixture(kind, malformed);

      const result = await fixture.submit();

      expect(fixture.context.state.gates.perGateVerdicts).toBeUndefined();
      expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(fixture.store.setReview).not.toHaveBeenCalled();
      expect(fixture.store.advanceStep).not.toHaveBeenCalled();
      if (kind === 'detached') expect(result).toMatchObject({ kind: 'refused' });
      else expect(result).toMatchObject({ passClearedThisCall: false });
    }
  );

  test.each(['ordinary', 'detached'] as const)(
    'refuses a structured index against an empty advertised list on a %s review',
    async (kind) => {
      const fixture = custodyFixture(kind, structuredReview());
      const review = fixture.session.reviews?.['node-1'];
      if (review === undefined) throw new Error('Review fixture missing');
      review.gateIds = [];

      await expect(fixture.submit()).rejects.toThrow('review advertised 0');

      expect(fixture.context.state.gates.perGateVerdicts).toBeUndefined();
      expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      expect(fixture.store.setReview).not.toHaveBeenCalled();
      expect(fixture.store.advanceStep).not.toHaveBeenCalled();
    }
  );

  test('a persistence failure propagates unchanged instead of being classified as submitted syntax', async () => {
    const fixture = custodyFixture('ordinary', structuredReview());
    const failure = new Error('record persistence failed');
    fixture.store.recordGateReviewOutcome.mockRejectedValueOnce(failure);

    await expect(fixture.submit()).rejects.toBe(failure);
    expect(fixture.store.advanceStep).not.toHaveBeenCalled();
  });

  test.each(['structured', 'legacy'] as const)(
    'authority FAIL joins accept %s verdicts through the typed getter',
    async (form) => {
      const fixture = custodyFixture(
        'ordinary',
        form === 'structured' ? structuredReview() : 'GATE_REVIEW: FAIL - Retry'
      );
      const review = fixture.session.reviews?.['node-1'];
      if (review === undefined) throw new Error('Review fixture missing');
      fixture.context.state.gates.temporaryGateIds = ['new-gate'];
      fixture.context.state.gates.reviewGateIds = ['gate-a', 'new-gate'];

      const joined = await fixture.authority.joinSentGates(fixture.context, 'session-1', review);

      expect(joined.gateIds).toEqual(['gate-a', 'new-gate']);
      expect(joined.attemptCount).toBe(review.attemptCount);
      expect(fixture.store.setReview.mock.calls[0]?.[0]).toBe('session-1');
      expect(fixture.store.setReview.mock.calls[0]?.[1]).toBe(joined);
    }
  );
});

/** Submit a FAIL; `lastAttempt` makes it the one that exhausts the review. */
async function submitFail(processor: GateVerdictProcessor, lastAttempt = false): Promise<void> {
  await processor.processReviewVerdict(
    createContext(),
    sessionWith(lastAttempt ? 1 : 0),
    { sessionId: 'session-1', currentStep: 1, currentNodeId: 'node-1' } as never,
    'a response'
  );
}

describe('GateVerdictProcessor blocking FAIL events', () => {
  let sequence: string[];

  beforeEach(() => {
    sequence = [];
  });

  test('every event lands before the verdict call returns, in one order', async () => {
    const { hooks, notifications } = createEmitters(sequence);
    const processor = new GateVerdictProcessor(createStore(), createLogger(), hooks, notifications);

    await submitFail(processor, true);

    // Read at return, with nothing awaited after it: a forgotten emitter has not finished yet.
    expect(sequence).toEqual([
      'hook:retryExhausted:gate-a',
      'notify:retryExhausted:gate-a',
      'hook:responseBlocked:gate-a',
      'notify:responseBlocked:gate-a',
      'hook:failed:gate-a',
      'notify:failed:gate-a',
    ]);
  });

  test('CONTROL: with retries left, the sequence drops only the exhaustion pair', async () => {
    const { hooks, notifications } = createEmitters(sequence);
    const processor = new GateVerdictProcessor(createStore(), createLogger(), hooks, notifications);

    await submitFail(processor);

    expect(sequence).toEqual([
      'hook:responseBlocked:gate-a',
      'notify:responseBlocked:gate-a',
      'hook:failed:gate-a',
      'notify:failed:gate-a',
    ]);
  });

  test('a throwing emitter is reported inside the call that raised it', async () => {
    const { hooks } = createEmitters(sequence);
    const logger = createLogger();
    const notifications = {
      emitGateFailed: jest.fn(() => {
        throw new Error('notification transport is gone');
      }),
      emitRetryExhausted: jest.fn(),
      emitResponseBlocked: jest.fn(),
    } as unknown as McpNotificationEmitterPort;
    const processor = new GateVerdictProcessor(createStore(), logger, hooks, notifications);

    await submitFail(processor);

    expect(logger.warn).toHaveBeenCalledWith(
      '[GateVerdictProcessor] Failed to emit gate event',
      expect.objectContaining({ event: 'failed', error: 'notification transport is gone' })
    );
  });

  test('no gate event in the processor is fired and forgotten', () => {
    const source = readFileSync(PROCESSOR_SOURCE, 'utf8');
    const emitCalls = source.match(/\b(?:void|await|return)?\s*this\.emitGateEvents\(/g) ?? [];

    // Positive control: the scan sees the emit sites at all.
    expect(emitCalls.length).toBeGreaterThanOrEqual(6);
    expect(emitCalls.filter((call) => !call.trimStart().startsWith('await'))).toEqual([]);
  });
});
