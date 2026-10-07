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
} from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
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
  return {
    getGateVerdict: () => 'GATE_REVIEW: FAIL - it did not hold',
    gateEnforcement: undefined,
    setResponse: jest.fn(),
    gates: {
      hasBlockingGates: () => true,
      getBlockingGateIds: () => ['gate-a'],
    },
    frameworkAuthority: { getCachedDecision: () => undefined },
    state: { gates: { enforcementMode: 'blocking', advisoryWarnings: [] }, session: {} },
    diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    sessionContext: { sessionId: 'session-1', isChainExecution: true, currentStep: 1 },
  } as never;
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
    const fixture = custodyFixture('detached', structuredReview());
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
        outcome === 'passed' ? 'GATE_REVIEW: PASS - Reviewed' : structuredReview()
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
    const fixture = custodyFixture('detached', structuredReview());
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
    const fixture = custodyFixture('ordinary', structuredReview());
    pinReview(fixture);
    fixture.context.gateEnforcement = undefined;
    await expect(fixture.submit()).rejects.toThrow('retry requires gate enforcement authority');
    expect(fixture.store.setReview).not.toHaveBeenCalled();
    expect(fixture.store.recordGateReviewOutcome).not.toHaveBeenCalled();
    expect(fixture.store.advanceStep).not.toHaveBeenCalled();
  });

  test('refused and terminal replacement attempts do not renew or write', async () => {
    const fixture = custodyFixture('detached', structuredReview());
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
