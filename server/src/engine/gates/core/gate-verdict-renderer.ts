// @lifecycle canonical - Renders gate verdict display text and the legacy parseable form.
/**
 * Structured gate verdict submission.
 *
 * A gate review used to arrive as free text. The server wrote a format into its
 * own response asking the model to echo it back, then tried five regexes
 * (`resources/gates/config/verdict-patterns.yaml`) to read the reply, plus a
 * sixth for the nested `GATE_VERDICTS` block. A model that got the format wrong
 * produced `null` and the review was lost.
 *
 * This module renders the submission's display fields into the canonical
 * `full-hyphen` form the legacy parser accepts. Structured semantic evaluation
 * data is not encoded or rendered into the rationale. Rendered text cannot
 * preserve evaluation reports; consumers needing them must retain the typed
 * submission separately.
 *
 * **Render-then-parse is only sound if it is lossless.** That is the property
 * the tests assert for ordinary verdict fields: parsing the rendered string
 * returns their original values. The constraints that make it hold are
 * enforced on the *input* rather than repaired here, because a renderer that
 * silently rewrote a rationale would lose the reviewer's words — a quieter
 * version of the bug this replaces:
 *
 * - Rationales are single-line. `parseGateVerdict` reads only the first
 *   non-empty line and the pattern's `(.+)$` has no `s` flag, so a newline
 *   would truncate. The schema rejects newlines instead of collapsing them.
 * - Rationales arrive trimmed. The parser applies `.trim()` to its capture, so
 *   surrounding whitespace would not survive a round trip.
 * - Rationales are non-empty, matching `min_rationale_length: 1`.
 *
 * Hyphens *inside* a rationale are safe and need no escaping: the pattern's
 * `\s*-\s*` separator is not greedy past the first hyphen, and `(.+)$` takes
 * the remainder of the line verbatim.
 */

import type {
  GateVerdictReminderExemption,
  GateVerdictReminders,
  GateVerdictSubmission,
} from '#shared/types/gate-evaluation.js';

/** Canonical prefix — the `full-hyphen` pattern, which is `primary` priority. */
const VERDICT_PREFIX = 'GATE_REVIEW:';

/** Block header the per-gate parser looks for (`gate-enforcement-authority.ts`). */
const PER_GATE_HEADER = 'GATE_VERDICTS:';

/** Line prefix for the reminder attestation, read back by {@link parseGateVerdictReminders}. */
const REMINDERS_PREFIX = 'REMINDERS:';

/** Body of a `REMINDERS:` line with nothing attested and nothing excused. */
const REMINDERS_EMPTY = 'none';

/** `PASS`/`FAIL` for a boolean, so the two renderers cannot disagree. */
function verdictWord(passed: boolean): 'PASS' | 'FAIL' {
  return passed ? 'PASS' : 'FAIL';
}

/**
 * Render ordinary verdict fields into the canonical string the legacy parser accepts.
 * Evaluation reports remain on the typed input; this output cannot serialize them.
 *
 * The overall verdict is the first line because `parseGateVerdict` validates
 * only the first non-empty one. Per-gate lines follow under their header with
 * no blank line between them — the block pattern matches consecutive entries
 * and stops at the first line that does not fit, so an interruption would
 * silently truncate the review.
 */
export function renderGateVerdict(submission: GateVerdictSubmission): string {
  const verdictLine = `${VERDICT_PREFIX} ${submission.overall} - ${submission.rationale}`;
  const remindersLine = renderReminders(submission.reminders);
  const header = remindersLine === null ? verdictLine : `${verdictLine}\n${remindersLine}`;

  const entries = submission.per_gate ?? [];
  if (entries.length === 0) {
    return header;
  }

  const lines = entries.map(
    (entry) => `[${entry.index}] ${verdictWord(entry.passed)} - ${entry.rationale}`
  );

  // Blank line before the header is cosmetic and safe: the block pattern is
  // unanchored, so it finds the header wherever it sits.
  return `${header}\n\n${PER_GATE_HEADER}\n${lines.join('\n')}`;
}

/**
 * Render the reminder attestation as ONE line, or `null` when the field was absent.
 *
 * Directly after the verdict line and before the per-gate block, so the first non-empty line is
 * still the verdict — `parseGateVerdict` validates only that one, and a `REMINDERS:` line ahead
 * of it would make every structured submission unparseable.
 *
 * `none` rather than two empty lists, because an object that is present and says nothing is a
 * different statement from a field that was never sent, and the round trip has to tell them
 * apart.
 *
 * No escaping happens here. The separators (`;` between segments, `(` `)` around a reason) are
 * rejected by the schema instead, matching this module's stated policy: a renderer that rewrote
 * a reason would lose the reviewer's words, which is the quiet failure the structured form
 * exists to remove.
 */
function renderReminders(reminders: GateVerdictReminders | undefined): string | null {
  if (reminders === undefined) {
    return null;
  }

  const { satisfied, not_applicable: notApplicable } = reminders;
  if (satisfied.length === 0 && notApplicable.length === 0) {
    return `${REMINDERS_PREFIX} ${REMINDERS_EMPTY}`;
  }

  const excused = notApplicable.map((entry) => `${entry.id}(${entry.reason})`).join(',');
  return `${REMINDERS_PREFIX} satisfied=${satisfied.join(',')}; n/a=${excused}`;
}

/**
 * Read a rendered `REMINDERS:` line back into the submission's `reminders` field.
 *
 * The other half of the lossless pair above, and kept in this module beside it for that reason:
 * splitting the render and the parse across two modules is what lets a format drift from its
 * reader.
 *
 * Its production reader is `GateEnforcementAuthority.readReminderAttestation`, which folds the
 * line into the same gate-id-keyed `GateVerdictSummary` record the per-gate block produces,
 * marked `tier: 'reminder'` so a self-declared attestation is never counted as an evaluated
 * result (P4.78). Until then this had none, and the line was written for nobody.
 *
 * @returns the parsed field, or `undefined` when the text carries no `REMINDERS:` line.
 */
export function parseGateVerdictReminders(raw: string): GateVerdictReminders | undefined {
  const line = raw
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(REMINDERS_PREFIX));
  if (line === undefined) {
    return undefined;
  }

  const body = line.slice(REMINDERS_PREFIX.length).trim();
  if (body === REMINDERS_EMPTY) {
    return { satisfied: [], not_applicable: [] };
  }

  const satisfied = (body.match(/satisfied=([^;]*)/)?.[1] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  // Scanned with a pattern rather than split on `,`: a reason may contain commas, but neither an
  // id nor a reason may contain a parenthesis, so the bracket pair is the reliable delimiter.
  const excused = body.match(/n\/a=(.*)$/)?.[1] ?? '';
  const not_applicable: GateVerdictReminderExemption[] = [];
  for (const match of excused.matchAll(/([^,()]+)\(([^)]*)\)/g)) {
    not_applicable.push({ id: (match[1] ?? '').trim(), reason: (match[2] ?? '').trim() });
  }

  return { satisfied, not_applicable };
}

/**
 * Whether a `gate_verdict` value is a structured submission rather than the
 * legacy free-text string.
 *
 * The two forms are distinguished by type alone; the schema has already
 * rejected anything that is neither.
 */
export function isGateVerdictSubmission(value: unknown): value is GateVerdictSubmission {
  return typeof value === 'object' && value !== null && 'overall' in value;
}
