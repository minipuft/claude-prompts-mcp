// @lifecycle canonical - Sole owner of a gate review's transitions and of its attempt counter.
/**
 * Review lifecycle (primitive rework row 3.2).
 *
 * Every way a review moves — a verdict, a detached node's replacement report, a `gate_action` —
 * is one transition of one table, decided here from the review's recorded `phase` and `kind`.
 * Before this, four paths each inferred where a review stood (a retry-limit comparison, a
 * `metadata.phase` string, a pending/deferred split) and each charged the attempt counter on its
 * own terms. The counter is now incremented in {@link advanceReview} and nowhere else.
 *
 * | phase                  | accepts                        | on it                                                    |
 * | ---------------------- | ------------------------------ | -------------------------------------------------------- |
 * | `awaiting-verdict`     | `verdict`                      | PASS → passed; FAIL → per enforcement, below             |
 * | `awaiting-replacement` | `replacement-report`           | reopened, awaiting a verdict on the new output           |
 * | `exhausted`            | `gate_action` (detached: no abort) | retry → reopened, counter 0; skip → cleared; abort → aborted |
 *
 * A blocking FAIL charges one attempt and lands on `exhausted` once `attemptCount` reaches
 * `maxAttempts`; otherwise a detached review awaits a replacement report and any other awaits
 * the next verdict (a current step's answer arrives on the same call as its verdict). An advisory
 * or informational FAIL charges the attempt and clears the review. Any other event is refused,
 * and so is a PASS over a check the review recorded as failing; a refusal charges nothing.
 *
 * Pure: never mutates the review it is given; the caller persists what it returns.
 */

import type {
  GateReview,
  GateReviewHistoryEntry,
  GateReviewPhase,
} from '#shared/types/chain-execution.js';
import type { EnforcementMode, GateAction, ParsedVerdict } from './gate-enforcement-types.js';

/** What can happen to a review. `at` stamps the history entry the event leaves. */
export type ReviewEvent =
  | { readonly type: 'verdict'; readonly verdict: ParsedVerdict; readonly at: number }
  | { readonly type: 'replacement-report'; readonly output: string }
  | { readonly type: 'gate_action'; readonly action: GateAction; readonly at: number };

/** Why an event was not applied. Nothing is charged or changed. */
type ReviewRefusal = 'phase' | 'failing-check';

/**
 * The review after an event, and what the event did. `review: null` means the review is over and
 * the caller deletes it; `attempt` is the counter after the event (for a verdict, the attempt it
 * charged — which a PASS spends too, though the review it charged is gone).
 */
type ReviewAdvance =
  | {
      readonly outcome: 'passed' | 'cleared' | 'aborted';
      readonly review: null;
      readonly attempt: number;
    }
  | {
      readonly outcome: 'failed' | 'exhausted' | 'reopened';
      readonly review: GateReview;
      readonly attempt: number;
    }
  | {
      readonly outcome: 'refused';
      readonly reason: ReviewRefusal;
      readonly review: GateReview;
      readonly attempt: number;
    };

/** The event types a review in `phase` accepts; every other one is refused. */
const ACCEPTS: Readonly<Record<GateReviewPhase, ReviewEvent['type']>> = {
  'awaiting-verdict': 'verdict',
  'awaiting-replacement': 'replacement-report',
  exhausted: 'gate_action',
};

/**
 * Apply `event` to `review`.
 *
 * @param enforcement - What a FAIL does, from `resolveEnforcementMode`; read only for a FAIL.
 */
export function advanceReview(
  review: GateReview,
  event: ReviewEvent,
  enforcement: EnforcementMode
): ReviewAdvance {
  if (ACCEPTS[review.phase] !== event.type) {
    return refuse(review, 'phase');
  }
  switch (event.type) {
    case 'verdict':
      return applyVerdict(review, event.verdict, event.at, enforcement);
    case 'replacement-report': {
      const { checkResults: _stale, ...kept } = review;
      const reopened = withPhase({ ...kept, reviewedOutput: event.output }, 'awaiting-verdict');
      return { outcome: 'reopened', review: reopened, attempt: reopened.attemptCount };
    }
    case 'gate_action':
      return applyAction(review, event.action, event.at);
  }
}

function applyVerdict(
  review: GateReview,
  verdict: ParsedVerdict,
  at: number,
  enforcement: EnforcementMode
): ReviewAdvance {
  if (verdict.verdict === 'PASS' && (review.checkResults ?? []).some((result) => !result.passed)) {
    return refuse(review, 'failing-check');
  }
  const attempt = review.attemptCount + 1;
  if (verdict.verdict === 'PASS') {
    return { outcome: 'passed', review: null, attempt };
  }
  if (enforcement !== 'blocking') {
    return { outcome: 'cleared', review: null, attempt };
  }
  const charged: GateReview = {
    ...review,
    attemptCount: attempt,
    previousResponse: verdict.raw,
    history: [
      ...(review.history ?? []),
      {
        timestamp: at,
        status: 'fail',
        reasoning: verdict.rationale,
        reviewer: verdict.source,
      } satisfies GateReviewHistoryEntry,
    ],
  };
  if (attempt >= review.maxAttempts) {
    return { outcome: 'exhausted', review: withPhase(charged, 'exhausted'), attempt };
  }
  return { outcome: 'failed', review: withPhase(charged, awaitingAnswer(review)), attempt };
}

function applyAction(review: GateReview, action: GateAction, at: number): ReviewAdvance {
  if (action === 'skip') {
    return { outcome: 'cleared', review: null, attempt: review.attemptCount };
  }
  if (action === 'abort') {
    // A detached node is not the run: `cancel: true` stops a run and needs no node (row 4.8).
    return review.kind === 'detached'
      ? refuse(review, 'phase')
      : { outcome: 'aborted', review: null, attempt: review.attemptCount };
  }
  const reset: GateReview = {
    ...review,
    attemptCount: 0,
    history: [
      ...(review.history ?? []),
      {
        timestamp: at,
        status: 'reset',
        reasoning: 'User requested retry after exhaustion',
      } satisfies GateReviewHistoryEntry,
    ],
  };
  return { outcome: 'reopened', review: withPhase(reset, awaitingAnswer(review)), attempt: 0 };
}

/** Where a review waits for its next answer: a detached node's comes as a separate report. */
function awaitingAnswer(review: GateReview): GateReviewPhase {
  return review.kind === 'detached' ? 'awaiting-replacement' : 'awaiting-verdict';
}

function refuse(review: GateReview, reason: ReviewRefusal): ReviewAdvance {
  return { outcome: 'refused', reason, review, attempt: review.attemptCount };
}

/**
 * Set `phase`, and keep a `metadata.phase` the review already carries in step with it.
 *
 * stamped: (as of 2026-09-23 · flips when row 3.5 moves `detached.ts` off `metadata.phase`) —
 * `detachedReviewPhase` still routes a detached review by that metadata key, and the store's
 * `deriveReviewPhase` prefers it over the record, so a stale copy would override this transition.
 */
function withPhase(review: GateReview, phase: GateReviewPhase): GateReview {
  const metadata =
    review.metadata !== undefined && 'phase' in review.metadata
      ? { ...review.metadata, phase }
      : review.metadata;
  return metadata === undefined ? { ...review, phase } : { ...review, phase, metadata };
}
