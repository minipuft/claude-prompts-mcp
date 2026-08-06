/**
 * One definition of "an accepted exception must still be true", shared by every Class-B gate.
 *
 * THE DEFINITION, in one sentence: **an accepted exception must suppress at least one finding the
 * gate would otherwise report, exclusively, and the gate must be able to see the thing it names.**
 * Every verdict below is that sentence failing in a different place.
 *
 * WHY THIS EXISTS: an exception list suppresses its finding whether or not the finding is still
 * true. Fixing the underlying defect does not remove the entry, and no gate reports that one of
 * its own exceptions became unnecessary — so the list only ever grows and a green run stops
 * meaning what it says. Measured on this repo: six exceptions were satisfied and still passing
 * silently across one initiative, and each was removed by hand after the gates said OK.
 *
 * WHY A SHARED MODULE RATHER THAN A CENTRAL SCRIPT: only the owning gate can answer whether one of
 * its entries still suppresses a hit — that needs the gate's own scan, its own reach, its own
 * notion of a subject. A central script would have to re-implement five scanners and would drift
 * from all five. So each gate supplies one predicate (`classify`) and this module owns everything
 * that must NOT differ between gates: the vocabulary, the `closedBy` requirement, the rule that an
 * unreachable subject is never reported as cleanliness, and the exit semantics.
 *
 * `verify-mcp-surface.mjs` had the only working instance of this check. It is not the model
 * because it was first; it is the model because it detects rot in BOTH directions — a subject that
 * disappeared and a subject that gained real coverage. Both mean the entry stopped describing
 * reality.
 */

/**
 * @typedef {'load-bearing' | 'satisfied' | 'subject-missing' | 'unreachable' | 'redundant'} Verdict
 */

export const VERDICT = /** @type {const} */ ({
  /** Suppresses a real finding that nothing else suppresses. Keep it. */
  LOAD_BEARING: 'load-bearing',
  /** The subject exists and is scanned, but no longer produces a finding. DELETE the entry. */
  SATISFIED: 'satisfied',
  /** What the entry names does not exist. Either born dead, or it outlived its subject. */
  SUBJECT_MISSING: 'subject-missing',
  /** The subject exists but the gate's scan cannot reach it. A blind spot, NOT cleanliness. */
  UNREACHABLE: 'unreachable',
  /** Another entry already suppresses every finding this one covers. */
  REDUNDANT: 'redundant',
});

/**
 * Why each verdict is or is not a failure, and what the reader should do about it.
 *
 * `unreachable` is a failure with a deliberately different remedy. Deleting an entry that is inert
 * only because nothing reached it *hides a reach gap* and re-arms whatever the entry was
 * suppressing the moment the scan is widened. Measured 2026-08-06: a `CLAUDE.md` exemption looked
 * dead, and was in fact covering 3 live hits in a file `.gitignore` hides from ripgrep.
 */
const REMEDY = {
  [VERDICT.SATISFIED]: 'delete the entry — the finding it suppresses no longer occurs',
  [VERDICT.SUBJECT_MISSING]: 'delete the entry — what it names is not there',
  [VERDICT.UNREACHABLE]:
    'do NOT delete — widen the scan first; the entry is inert because nothing reached it',
  [VERDICT.REDUNDANT]: 'delete the entry — another entry already covers every hit it covers',
};

/**
 * Audits one gate's accepted exceptions.
 *
 * @param {object} input
 * @param {string} input.gate                       Gate name, for the report.
 * @param {readonly unknown[]} input.entries        The declared exceptions.
 * @param {(entry: unknown) => string} input.describe   One-line identity of an entry.
 * @param {(entry: unknown) => string | undefined} [input.closedBy]  Retirement condition, if the
 *   shape carries one. Omit for shapes that do not (the vocab allowlist states its conditions in
 *   grouped comments, which no predicate can read).
 * @param {(entry: unknown) => { verdict: Verdict, detail?: string }} input.classify
 * @returns {{ problems: Array<{ subject: string, message: string }>, counts: Record<string, number> }}
 */
export function auditExceptions({ gate, entries, describe, closedBy, classify }) {
  const problems = [];
  const counts = Object.fromEntries(Object.values(VERDICT).map((verdict) => [verdict, 0]));

  for (const entry of entries) {
    const subject = `${gate}: ${describe(entry)}`;

    if (closedBy !== undefined && (closedBy(entry) ?? '').trim() === '') {
      problems.push({
        subject,
        message: 'has no closedBy — an exception that cannot name what retires it is permanent',
      });
    }

    const { verdict, detail } = classify(entry);
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    if (verdict === VERDICT.LOAD_BEARING) continue;

    problems.push({
      subject,
      message: `${verdict}${detail ? ` (${detail})` : ''} — ${REMEDY[verdict]}`,
    });
  }

  return { problems, counts };
}

/**
 * Renders an audit. Returns the number of problems so a caller can fold it into its own exit code
 * rather than exiting here — the audit is one section of a gate's run, never the whole of it.
 *
 * @param {string} gate
 * @param {ReturnType<typeof auditExceptions>} audit
 * @returns {number}
 */
export function reportExceptionAudit(gate, audit) {
  const { problems, counts } = audit;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (problems.length === 0) {
    console.log(`${gate}: ${total} accepted exception(s), all load-bearing.`);
    return 0;
  }

  console.error(`\n${gate}: ${problems.length} exception-hygiene problem(s) of ${total} entries:`);
  for (const problem of problems) console.error(`  ${problem.subject}\n    ${problem.message}`);
  console.error(
    '\nAn exception outlives what it suppressed unless something says so. That is what this ' +
      'check is; it is not advisory.'
  );
  return problems.length;
}
