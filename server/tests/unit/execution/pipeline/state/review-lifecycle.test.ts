// @lifecycle canonical - Pins every transition of a gate review, and the attempt counter's one owner.
import { describe, expect, test } from '@jest/globals';

import { advanceReview } from '../../../../../src/engine/execution/pipeline/decisions/gates/review-lifecycle.js';

import type {
  EnforcementMode,
  ParsedVerdict,
} from '../../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-types.js';
import type { ReviewEvent } from '../../../../../src/engine/execution/pipeline/decisions/gates/review-lifecycle.js';
import type {
  GateReview,
  GateReviewKind,
  GateReviewPhase,
} from '../../../../../src/shared/types/chain-execution.js';

const verdict = (value: 'PASS' | 'FAIL'): ParsedVerdict => ({
  verdict: value,
  rationale: `${value.toLowerCase()} because`,
  raw: `GATE_REVIEW: ${value} - ${value.toLowerCase()} because`,
  source: 'gate_verdict',
});

const review = (overrides: Partial<GateReview> = {}): GateReview => ({
  nodeId: 'n2',
  kind: 'gate',
  phase: 'awaiting-verdict',
  combinedPrompt: 'review it',
  gateIds: ['g1'],
  prompts: [],
  createdAt: 1,
  attemptCount: 1,
  maxAttempts: 3,
  history: [],
  ...overrides,
});

const PASS: ReviewEvent = { type: 'verdict', verdict: verdict('PASS'), at: 100 };
const FAIL: ReviewEvent = { type: 'verdict', verdict: verdict('FAIL'), at: 100 };
const REPLACEMENT: ReviewEvent = { type: 'replacement-report', output: 'second try' };
const action = (value: 'retry' | 'skip' | 'abort'): ReviewEvent => ({
  type: 'gate_action',
  action: value,
  at: 100,
});

/** Every event the table covers, with the attempt count the review holds before it. */
const EVENTS: ReadonlyArray<{
  readonly label: string;
  readonly event: ReviewEvent;
  readonly enforcement: EnforcementMode;
  readonly attemptCount: number;
}> = [
  { label: 'PASS', event: PASS, enforcement: 'blocking', attemptCount: 1 },
  { label: 'FAIL', event: FAIL, enforcement: 'blocking', attemptCount: 1 },
  { label: 'FAIL(last)', event: FAIL, enforcement: 'blocking', attemptCount: 2 },
  { label: 'FAIL(advisory)', event: FAIL, enforcement: 'advisory', attemptCount: 1 },
  { label: 'FAIL(informational)', event: FAIL, enforcement: 'informational', attemptCount: 1 },
  { label: 'replacement', event: REPLACEMENT, enforcement: 'blocking', attemptCount: 1 },
  { label: 'retry', event: action('retry'), enforcement: 'blocking', attemptCount: 3 },
  { label: 'skip', event: action('skip'), enforcement: 'blocking', attemptCount: 3 },
  { label: 'abort', event: action('abort'), enforcement: 'blocking', attemptCount: 3 },
];

const KINDS: readonly GateReviewKind[] = ['gate', 'structural', 'detached'];
const PHASES: readonly GateReviewPhase[] = [
  'awaiting-verdict',
  'awaiting-replacement',
  'exhausted',
];

describe('advanceReview', () => {
  test('the whole state table, as one value', () => {
    const table = KINDS.flatMap((kind) =>
      PHASES.flatMap((phase) =>
        EVENTS.map(({ label, event, enforcement, attemptCount }) => {
          const next = advanceReview(review({ kind, phase, attemptCount }), event, enforcement);
          const reason = next.outcome === 'refused' ? `(${next.reason})` : '';
          const lands = next.review === null ? 'deleted' : next.review.phase;
          return `${kind} ${phase} ${label} -> ${next.outcome}${reason} ${lands} @${next.attempt}`;
        })
      )
    );

    expect(table).toEqual([
      'gate awaiting-verdict PASS -> passed deleted @2',
      'gate awaiting-verdict FAIL -> failed awaiting-verdict @2',
      'gate awaiting-verdict FAIL(last) -> exhausted exhausted @3',
      'gate awaiting-verdict FAIL(advisory) -> cleared deleted @2',
      'gate awaiting-verdict FAIL(informational) -> cleared deleted @2',
      'gate awaiting-verdict replacement -> refused(phase) awaiting-verdict @1',
      'gate awaiting-verdict retry -> refused(phase) awaiting-verdict @3',
      'gate awaiting-verdict skip -> refused(phase) awaiting-verdict @3',
      'gate awaiting-verdict abort -> refused(phase) awaiting-verdict @3',
      'gate awaiting-replacement PASS -> refused(phase) awaiting-replacement @1',
      'gate awaiting-replacement FAIL -> refused(phase) awaiting-replacement @1',
      'gate awaiting-replacement FAIL(last) -> refused(phase) awaiting-replacement @2',
      'gate awaiting-replacement FAIL(advisory) -> refused(phase) awaiting-replacement @1',
      'gate awaiting-replacement FAIL(informational) -> refused(phase) awaiting-replacement @1',
      'gate awaiting-replacement replacement -> reopened awaiting-verdict @1',
      'gate awaiting-replacement retry -> refused(phase) awaiting-replacement @3',
      'gate awaiting-replacement skip -> refused(phase) awaiting-replacement @3',
      'gate awaiting-replacement abort -> refused(phase) awaiting-replacement @3',
      'gate exhausted PASS -> refused(phase) exhausted @1',
      'gate exhausted FAIL -> refused(phase) exhausted @1',
      'gate exhausted FAIL(last) -> refused(phase) exhausted @2',
      'gate exhausted FAIL(advisory) -> refused(phase) exhausted @1',
      'gate exhausted FAIL(informational) -> refused(phase) exhausted @1',
      'gate exhausted replacement -> refused(phase) exhausted @1',
      'gate exhausted retry -> reopened awaiting-verdict @0',
      'gate exhausted skip -> cleared deleted @3',
      'gate exhausted abort -> aborted deleted @3',
      'structural awaiting-verdict PASS -> passed deleted @2',
      'structural awaiting-verdict FAIL -> failed awaiting-verdict @2',
      'structural awaiting-verdict FAIL(last) -> exhausted exhausted @3',
      'structural awaiting-verdict FAIL(advisory) -> cleared deleted @2',
      'structural awaiting-verdict FAIL(informational) -> cleared deleted @2',
      'structural awaiting-verdict replacement -> refused(phase) awaiting-verdict @1',
      'structural awaiting-verdict retry -> refused(phase) awaiting-verdict @3',
      'structural awaiting-verdict skip -> refused(phase) awaiting-verdict @3',
      'structural awaiting-verdict abort -> refused(phase) awaiting-verdict @3',
      'structural awaiting-replacement PASS -> refused(phase) awaiting-replacement @1',
      'structural awaiting-replacement FAIL -> refused(phase) awaiting-replacement @1',
      'structural awaiting-replacement FAIL(last) -> refused(phase) awaiting-replacement @2',
      'structural awaiting-replacement FAIL(advisory) -> refused(phase) awaiting-replacement @1',
      'structural awaiting-replacement FAIL(informational) -> refused(phase) awaiting-replacement @1',
      'structural awaiting-replacement replacement -> reopened awaiting-verdict @1',
      'structural awaiting-replacement retry -> refused(phase) awaiting-replacement @3',
      'structural awaiting-replacement skip -> refused(phase) awaiting-replacement @3',
      'structural awaiting-replacement abort -> refused(phase) awaiting-replacement @3',
      'structural exhausted PASS -> refused(phase) exhausted @1',
      'structural exhausted FAIL -> refused(phase) exhausted @1',
      'structural exhausted FAIL(last) -> refused(phase) exhausted @2',
      'structural exhausted FAIL(advisory) -> refused(phase) exhausted @1',
      'structural exhausted FAIL(informational) -> refused(phase) exhausted @1',
      'structural exhausted replacement -> refused(phase) exhausted @1',
      'structural exhausted retry -> reopened awaiting-verdict @0',
      'structural exhausted skip -> cleared deleted @3',
      'structural exhausted abort -> aborted deleted @3',
      'detached awaiting-verdict PASS -> passed deleted @2',
      'detached awaiting-verdict FAIL -> failed awaiting-replacement @2',
      'detached awaiting-verdict FAIL(last) -> exhausted exhausted @3',
      'detached awaiting-verdict FAIL(advisory) -> cleared deleted @2',
      'detached awaiting-verdict FAIL(informational) -> cleared deleted @2',
      'detached awaiting-verdict replacement -> refused(phase) awaiting-verdict @1',
      'detached awaiting-verdict retry -> refused(phase) awaiting-verdict @3',
      'detached awaiting-verdict skip -> refused(phase) awaiting-verdict @3',
      'detached awaiting-verdict abort -> refused(phase) awaiting-verdict @3',
      'detached awaiting-replacement PASS -> refused(phase) awaiting-replacement @1',
      'detached awaiting-replacement FAIL -> refused(phase) awaiting-replacement @1',
      'detached awaiting-replacement FAIL(last) -> refused(phase) awaiting-replacement @2',
      'detached awaiting-replacement FAIL(advisory) -> refused(phase) awaiting-replacement @1',
      'detached awaiting-replacement FAIL(informational) -> refused(phase) awaiting-replacement @1',
      'detached awaiting-replacement replacement -> reopened awaiting-verdict @1',
      'detached awaiting-replacement retry -> refused(phase) awaiting-replacement @3',
      'detached awaiting-replacement skip -> refused(phase) awaiting-replacement @3',
      'detached awaiting-replacement abort -> refused(phase) awaiting-replacement @3',
      'detached exhausted PASS -> refused(phase) exhausted @1',
      'detached exhausted FAIL -> refused(phase) exhausted @1',
      'detached exhausted FAIL(last) -> refused(phase) exhausted @2',
      'detached exhausted FAIL(advisory) -> refused(phase) exhausted @1',
      'detached exhausted FAIL(informational) -> refused(phase) exhausted @1',
      'detached exhausted replacement -> refused(phase) exhausted @1',
      'detached exhausted retry -> reopened awaiting-replacement @0',
      'detached exhausted skip -> cleared deleted @3',
      'detached exhausted abort -> refused(phase) exhausted @3',
    ]);
  });

  test('a blocking FAIL charges exactly one attempt and records it in the history', () => {
    const before = review({ attemptCount: 1 });
    const next = advanceReview(before, FAIL, 'blocking');

    expect(next.review).toEqual({
      ...before,
      attemptCount: 2,
      previousResponse: 'GATE_REVIEW: FAIL - fail because',
      history: [
        { timestamp: 100, status: 'fail', reasoning: 'fail because', reviewer: 'gate_verdict' },
      ],
    });
    expect(before.attemptCount).toBe(1);
    expect(before.history).toEqual([]);
  });

  test('exhaustion lands exactly at maxAttempts, not one before', () => {
    expect(
      advanceReview(review({ attemptCount: 1, maxAttempts: 3 }), FAIL, 'blocking').outcome
    ).toBe('failed');
    expect(
      advanceReview(review({ attemptCount: 2, maxAttempts: 3 }), FAIL, 'blocking').outcome
    ).toBe('exhausted');
  });

  test('a PASS over a failing recorded check is refused and charges nothing', () => {
    const failing = review({
      checkResults: [
        { gateId: 'g1', passed: false, summary: 'exit 1' } as NonNullable<
          GateReview['checkResults']
        >[number],
      ],
    });
    const next = advanceReview(failing, PASS, 'blocking');

    expect(next).toEqual({
      outcome: 'refused',
      reason: 'failing-check',
      review: failing,
      attempt: 1,
    });
    // positive control: the same PASS over passing checks clears
    const passing = review({
      checkResults: [
        { gateId: 'g1', passed: true, summary: 'exit 0' } as NonNullable<
          GateReview['checkResults']
        >[number],
      ],
    });
    expect(advanceReview(passing, PASS, 'blocking').outcome).toBe('passed');
    // a FAIL over the failing check is the submitter agreeing: it takes the normal path
    expect(advanceReview(failing, FAIL, 'blocking').outcome).toBe('failed');
  });

  test('a replacement report swaps the graded output, drops the stale checks, keeps the counter', () => {
    const before = review({
      kind: 'detached',
      phase: 'awaiting-replacement',
      attemptCount: 2,
      reviewedOutput: 'first try',
      checkResults: [
        { gateId: 'g1', passed: false, summary: 'exit 1' } as NonNullable<
          GateReview['checkResults']
        >[number],
      ],
    });
    const next = advanceReview(before, REPLACEMENT, 'blocking');

    expect(next.review).not.toBeNull();
    expect(next.review).not.toHaveProperty('checkResults');
    expect(next.review).toMatchObject({
      reviewedOutput: 'second try',
      attemptCount: 2,
      phase: 'awaiting-verdict',
    });
  });

  test('retry resets the counter to zero and records the reset', () => {
    const next = advanceReview(
      review({ phase: 'exhausted', attemptCount: 3 }),
      action('retry'),
      'blocking'
    );

    expect(next.review?.attemptCount).toBe(0);
    expect(next.review?.history).toEqual([
      { timestamp: 100, status: 'reset', reasoning: 'User requested retry after exhaustion' },
    ]);
  });

  test('a metadata.phase the review carries follows the transition; none is invented', () => {
    const detached = review({
      kind: 'detached',
      metadata: { phase: 'awaiting-verdict', nodeId: 'n2' },
    });
    expect(advanceReview(detached, FAIL, 'blocking').review?.metadata).toEqual({
      phase: 'awaiting-replacement',
      nodeId: 'n2',
    });

    const plain = review({ metadata: { source: 'gate-enforcement' } });
    expect(advanceReview(plain, FAIL, 'blocking').review?.metadata).toEqual({
      source: 'gate-enforcement',
    });
    expect(advanceReview(review(), FAIL, 'blocking').review).not.toHaveProperty('metadata');
  });
});
