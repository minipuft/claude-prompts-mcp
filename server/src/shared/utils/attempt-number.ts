// @lifecycle canonical - The one human-facing rendering of a review or verification attempt number.
/**
 * Attempt numbering: every surface a person reads names an attempt the same
 * way, 1-based and against its budget when the budget is known — `attempt 2/3`. Storage keeps its
 * own counts; this module is where a stored count becomes the number a reader sees, so the
 * execution-history ledger, the review footer, the refusals and the shell-verification messages
 * cannot disagree about which attempt a caller is on. `tests/unit/shared/utils/attempt-number.test.ts`
 * fails when a render in `src/` builds an attempt number without this function.
 *
 * Two stored shapes reach a render, and they differ by one:
 * - a CONSUMED count names how many attempts were already spent: `GateReview.attemptCount`, and a
 *   PASS/FAIL `GateVerdictSummary.attempt` (the review's `attemptCount` when the verdict was
 *   graded). The attempt in hand is the next one — {@link attemptInHand}.
 * - an ORDINAL is already 1-based: `advanceReview`'s `attempt` for a graded verdict, a shell
 *   check's `attemptCount` once its failing run is charged, and a BYPASS summary's `attempt` (the
 *   exhausted review's spent count, which is its last attempt).
 *
 * The `N/M` shape is also what `hooks/lib/session_state.py` reads back (`(attempt X/Y)`,
 * `Attempt X/Y`), so it is not free to change. Lives in shared/utils (Layer 0) beside
 * `node-order.ts` for the same reason that file does: engine/, modules/ and mcp/ all render
 * attempts, and the review-render module reaches `delegation/detached.ts` transitively, so a
 * formatter there would close an import cycle.
 */

/** `attempt N/M` (or `attempt N` with no known budget); `ordinal` is 1-based. */
export function formatAttempt(
  ordinal: number,
  maxAttempts?: number,
  label: 'attempt' | 'Attempt' = 'attempt'
): string {
  return maxAttempts === undefined ? `${label} ${ordinal}` : `${label} ${ordinal}/${maxAttempts}`;
}

/** The 1-based attempt in hand once `consumed` attempts are spent, never past the budget. */
export function attemptInHand(consumed: number, maxAttempts: number): number {
  return Math.min(consumed + 1, maxAttempts);
}
