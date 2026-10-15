// @lifecycle canonical - Renders a structured gate verdict as display text.
/**
 * Structured gate verdict display.
 *
 * `gate_verdict` is a structured object; the typed submission is the custody path and travels
 * on `ParsedGateVerdict.submission`. This module renders its ordinary fields as plain display
 * text — `ParsedGateVerdict.raw`, which a retry render shows as the previous response. Nothing
 * parses this text back, and it deliberately does not look like a submission format: a reply
 * that echoed a parseable verdict line would teach a client to send it.
 *
 * Semantic evaluation reports are not rendered; consumers needing them read the typed
 * submission.
 */

import type { GateVerdictReminders, GateVerdictSubmission } from '#shared/types/gate-evaluation.js';

/** `PASS`/`FAIL` for a boolean, so the overall and per-gate lines cannot disagree. */
function verdictWord(passed: boolean): 'PASS' | 'FAIL' {
  return passed ? 'PASS' : 'FAIL';
}

/**
 * Render a submission's overall verdict, reminder attestation and per-gate entries as display
 * text, one fact per line.
 */
export function renderGateVerdict(submission: GateVerdictSubmission): string {
  const lines = [`Verdict: ${submission.overall} - ${submission.rationale}`];
  const reminders = renderReminders(submission.reminders);
  if (reminders !== null) lines.push(reminders);

  const entries = submission.per_gate ?? [];
  if (entries.length > 0) {
    lines.push('Per gate:');
    for (const entry of entries) {
      lines.push(`[${entry.index}] ${verdictWord(entry.passed)} - ${entry.rationale}`);
    }
  }
  return lines.join('\n');
}

/**
 * The reminder attestation as one line, or `null` when the field was absent. An attestation that
 * is present and empty reads `none`, because it says something an absent field does not.
 */
function renderReminders(reminders: GateVerdictReminders | undefined): string | null {
  if (reminders === undefined) {
    return null;
  }

  const { satisfied, not_applicable: notApplicable } = reminders;
  if (satisfied.length === 0 && notApplicable.length === 0) {
    return 'Reminders: none';
  }

  const excused = notApplicable.map((entry) => `${entry.id}(${entry.reason})`).join(',');
  return `Reminders: satisfied=${satisfied.join(',')}; n/a=${excused}`;
}

/**
 * Whether a value has the structured submission's discriminating field. The schema has already
 * refused anything else at the MCP boundary; engine callers get this bounded check.
 */
export function isGateVerdictSubmission(value: unknown): value is GateVerdictSubmission {
  return typeof value === 'object' && value !== null && 'overall' in value;
}
