// @lifecycle canonical - Renders a structured gate verdict into the canonical parseable form.
/**
 * Structured gate verdict submission.
 *
 * A gate review used to arrive as free text. The server wrote a format into its
 * own response asking the model to echo it back, then tried five regexes
 * (`resources/gates/config/verdict-patterns.yaml`) to read the reply, plus a
 * sixth for the nested `GATE_VERDICTS` block. A model that got the format wrong
 * produced `null` and the review was lost.
 *
 * This module is the structured alternative: the submission is an object the
 * schema validates, and rendering turns it into the canonical `full-hyphen`
 * form the parser already accepts. Nothing downstream changes — `gate_verdict`
 * stays a `string` at `execution-context.ts`, `validation/schemas.ts`, and
 * `request-validator.ts`, all of which consume a verdict that was already
 * parsed.
 *
 * **Render-then-parse is only sound if it is lossless.** That is the property
 * the tests assert directly: for every valid submission, parsing the rendered
 * string returns exactly the submission. The constraints that make it hold are
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

/** One gate's result within a submission. */
export interface GateVerdictEntry {
  /** 1-based position in the gate list the response advertised. */
  readonly index: number;
  readonly passed: boolean;
  readonly rationale: string;
}

/** A complete gate review, structured rather than formatted. */
export interface GateVerdictSubmission {
  readonly overall: 'PASS' | 'FAIL';
  readonly rationale: string;
  /** Omitted when the review is a single overall verdict. */
  readonly per_gate?: readonly GateVerdictEntry[] | undefined;
}

/** Canonical prefix — the `full-hyphen` pattern, which is `primary` priority. */
const VERDICT_PREFIX = 'GATE_REVIEW:';

/** Block header the per-gate parser looks for (`gate-enforcement-authority.ts`). */
const PER_GATE_HEADER = 'GATE_VERDICTS:';

/** `PASS`/`FAIL` for a boolean, so the two renderers cannot disagree. */
function verdictWord(passed: boolean): 'PASS' | 'FAIL' {
  return passed ? 'PASS' : 'FAIL';
}

/**
 * Render a submission into the canonical string the verdict parser accepts.
 *
 * The overall verdict is the first line because `parseGateVerdict` validates
 * only the first non-empty one. Per-gate lines follow under their header with
 * no blank line between them — the block pattern matches consecutive entries
 * and stops at the first line that does not fit, so an interruption would
 * silently truncate the review.
 */
export function renderGateVerdict(submission: GateVerdictSubmission): string {
  const header = `${VERDICT_PREFIX} ${submission.overall} - ${submission.rationale}`;

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
 * Whether a `gate_verdict` value is a structured submission rather than the
 * legacy free-text string.
 *
 * The two forms are distinguished by type alone; the schema has already
 * rejected anything that is neither.
 */
export function isGateVerdictSubmission(value: unknown): value is GateVerdictSubmission {
  return typeof value === 'object' && value !== null && 'overall' in value;
}
