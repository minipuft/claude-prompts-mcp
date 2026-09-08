// @lifecycle canonical - Delegation handoff contract: node token, HANDOFF RESULT trailer parser, evidence decision.
/**
 * The delegation handoff contract: the ONE derivation of a delegated node's token, the ONE
 * parser of the `HANDOFF RESULT` trailer a worker echoes it back in, and the pure decision of
 * whether a resume carries the evidence a configured mode requires. The brief renderer
 * (`brief.ts`) and the resume-side capture path both import from here so the token cannot be
 * derived twice and drift.
 *
 * Pure functions over plain data — no pipeline imports, no state.
 */

/** The literal heading a conforming worker's reply ends its trailer with. */
import type { HandoffEvidenceMode, HandoffEvidenceReason } from '#shared/types/handoff-evidence.js';

import { HANDOFF_EVIDENCE_REASONS } from '#shared/types/handoff-evidence.js';

// The vocabulary lives in shared/types (config and records need it without an engine edge);
// the contract module is where every consumer of the FUNCTIONS finds the names too.
export { HANDOFF_EVIDENCE_REASONS };
export type { HandoffEvidenceMode, HandoffEvidenceReason };

export const HANDOFF_RESULT_HEADING = 'HANDOFF RESULT';

/**
 * The literal heading a conforming worker's proposed self-review opens with, INSIDE the
 * `HANDOFF RESULT` trailer. Exported as the SSOT for that token: {@link buildHandoffResultSection}
 * emits it into the brief and the fake worker in `tests/helpers/delegation/` echoes it back, so
 * one spelling serves both sides. Moved here from `brief.ts` — this module is the one both the
 * render side and the capture side import.
 */
export const PROPOSED_GATE_REVIEW_TOKEN = 'Proposed Gate Review:';

/**
 * Resolve the delegation evidence mode for a resume.
 *
 * A configuration may leave the mode unset — either because `execution.delegation.evidence` was
 * never declared or because no config layer reached the point of assigning one. An unstated mode
 * is `required` (owner ruling R3, 2026-09-08): the contract the brief printed is the floor, and
 * `advisory` is the deliberate opt-out for an operator who wants the reason recorded without the
 * refusal. Mirrors `resolveEnforcementMode`'s style — a pure function over an optional
 * dependency, not a method reached through `context.foo?.`, so no `?.` can silently relax it.
 *
 * @param configured - Mode from config, or undefined when unset
 * @returns The configured mode, or 'required' when none was configured
 */
export function resolveHandoffEvidenceMode(configured?: HandoffEvidenceMode): HandoffEvidenceMode {
  return configured ?? 'required';
}

/** The minimal step shape {@link handoffNodeToken} needs. */
export interface HandoffTokenStep {
  readonly nodeId?: string;
  readonly stepNumber: number;
}

/**
 * The node token a delegated step's brief carries and a worker's `HANDOFF RESULT` trailer must
 * echo back. `nodeId` when the step carries one (parse-time stable identity); otherwise
 * `n<stepNumber>` for a legacy chain with no node ids (P3 D10 keeps `nodeId` optional). ONE
 * exported derivation — every render site and the resume-side capture call this, never
 * recompute the fallback themselves.
 */
export function handoffNodeToken(step: HandoffTokenStep): string {
  return step.nodeId ?? `n${step.stepNumber}`;
}

/** The three trailer fields a worker's reply may carry, each null when absent. */
export interface ParsedHandoffTrailer {
  readonly node: string | null;
  readonly proposedGateReview: string | null;
  readonly findingsBlock: string | null;
}

const HEADING_PATTERN = new RegExp(`^#*\\s*${HANDOFF_RESULT_HEADING}\\s*$`);
const NODE_LINE_PATTERN = /^node:\s*(\S+)/m;
const FINDINGS_LINE_PATTERN = /^findings:/;

/** Index of the LAST line whose trimmed text is the (optionally `#`-prefixed) heading, or -1. */
function findLastHeadingIndex(lines: readonly string[]): number {
  let lastIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && HEADING_PATTERN.test(line.trim())) {
      lastIndex = i;
    }
  }
  return lastIndex;
}

function extractNodeToken(trailerLines: readonly string[]): string | null {
  const match = NODE_LINE_PATTERN.exec(trailerLines.join('\n'));
  const token = match?.[1];
  return token !== undefined ? token.trim() : null;
}

function extractProposedGateReview(trailerLines: readonly string[]): string | null {
  const startIndex = trailerLines.findIndex((line) =>
    line.trimStart().startsWith(PROPOSED_GATE_REVIEW_TOKEN)
  );
  if (startIndex === -1) {
    return null;
  }
  const remainder = trailerLines.slice(startIndex + 1);
  const relativeEnd = remainder.findIndex((line) => FINDINGS_LINE_PATTERN.test(line.trim()));
  const endIndex = relativeEnd === -1 ? trailerLines.length : startIndex + 1 + relativeEnd;
  return trailerLines.slice(startIndex, endIndex).join('\n').trim();
}

function extractFindingsBlock(trailerLines: readonly string[]): string | null {
  const startIndex = trailerLines.findIndex((line) => FINDINGS_LINE_PATTERN.test(line.trim()));
  if (startIndex === -1) {
    return null;
  }
  return trailerLines.slice(startIndex).join('\n').trim();
}

/**
 * Parse a worker's reply for the `HANDOFF RESULT` trailer. The trailer starts at the LAST line
 * whose trimmed text equals the heading (a `#`-prefixed markdown heading is accepted). Absent a
 * heading, all three fields are null. `findingsBlock` is reserved — passed through unparsed
 * until contract-layer D5 lands.
 */
export function parseHandoffTrailer(reply: string): ParsedHandoffTrailer {
  const lines = reply.split('\n');
  const headingIndex = findLastHeadingIndex(lines);
  if (headingIndex === -1) {
    return { node: null, proposedGateReview: null, findingsBlock: null };
  }
  // The brief asks the worker to END with a fenced block, so the closing fence is part of a
  // conforming reply and never part of any field.
  const trailerLines = lines.slice(headingIndex + 1).filter((line) => line.trim() !== '```');
  return {
    node: extractNodeToken(trailerLines),
    proposedGateReview: extractProposedGateReview(trailerLines),
    findingsBlock: extractFindingsBlock(trailerLines),
  };
}

/** The single classification both public projections read. */
interface HandoffClassification {
  readonly reason: HandoffEvidenceReason;
  /** The token the reply actually named, when it named one at all. */
  readonly found: string | null;
}

/**
 * Classify a reply against the token the brief printed. ONE parse, ONE ordering of the three
 * failure shapes — {@link resolveHandoffEvidenceReason} and {@link resolveHandoffEvidence} are
 * both projections of this, so the recorded reason and the refusal can never disagree.
 */
function classifyHandoffReply(expectedToken: string, reply: string): HandoffClassification {
  if (findLastHeadingIndex(reply.split('\n')) === -1) {
    return { reason: 'trailer', found: null };
  }
  const trailer = parseHandoffTrailer(reply);
  if (trailer.node === null) {
    return { reason: 'node-line', found: null };
  }
  if (trailer.node !== expectedToken) {
    return { reason: 'node-mismatch', found: trailer.node };
  }
  return { reason: 'ok', found: trailer.node };
}

/**
 * The reason a delegated step's resume was (or was not) acceptable — the value recorded on the
 * step's execution record, independent of the mode in force.
 *
 * `undefined` when the step was not delegated: the fact does not exist, and the writer binds
 * NULL. Every delegated step gets one of the four reasons, including `ok`, which is the half the
 * retired S8 boolean could not express — it was `undefined` for a delegated step with no gates,
 * so "nothing to say" and "nothing observed" shared one spelling.
 */
export function resolveHandoffEvidenceReason(input: {
  delegated: boolean | undefined;
  expectedToken: string;
  reply: string;
}): HandoffEvidenceReason | undefined {
  if (input.delegated !== true) {
    return undefined;
  }
  return classifyHandoffReply(input.expectedToken, input.reply).reason;
}

/** Whether a resume carried the handoff evidence a configured mode requires. */
export type HandoffEvidence =
  | { kind: 'ok' }
  | {
      kind: 'missing';
      expected: string;
      missing: 'trailer' | 'node-line' | 'node-mismatch';
      found: string | null;
    };

/**
 * Decide whether a resume's reply satisfies the handoff contract for a delegated step.
 *
 * The REFUSAL projection of {@link resolveHandoffEvidenceReason}'s classification: not
 * delegated, or mode `advisory`, or reason `ok` → `{ kind: 'ok' }`; any other reason under
 * `required` → `missing`, carrying the reason and the token the reply named (null when it named
 * none). The classification itself is shared, so a run recorded `node-mismatch` is exactly a run
 * that would have been refused under `required`.
 */
export function resolveHandoffEvidence(input: {
  delegated: boolean | undefined;
  mode: HandoffEvidenceMode;
  expectedToken: string;
  reply: string;
}): HandoffEvidence {
  if (input.delegated !== true || input.mode === 'advisory') {
    return { kind: 'ok' };
  }
  const classification = classifyHandoffReply(input.expectedToken, input.reply);
  if (classification.reason === 'ok') {
    return { kind: 'ok' };
  }
  return {
    kind: 'missing',
    expected: input.expectedToken,
    missing: classification.reason,
    found: classification.found,
  };
}

/**
 * Result contract closing section (R-2 continuation — worker proposes, parent ratifies). Carries
 * the plain-text instruction and worker-boundary line `buildResultContractSection` used to own,
 * then instructs the worker to end its reply with a fenced `HANDOFF RESULT` block: the node
 * token is how the server matches a resume back to the node it belongs to
 * ({@link resolveHandoffEvidence} is the reader). Gate lines render inside that same block only
 * when the step carries gates; `findings:` is reserved and never rendered here.
 */
export function buildHandoffResultSection(token: string, hasGates: boolean): string {
  const parts = [
    '### Result Contract',
    '',
    'Return your complete work product as plain text — it becomes the chain’s step output verbatim.',
    '',
    'You are the worker for this one step. Do not call `prompt_engine` or any other chain tool, and do not put chain metadata or tool calls in your reply — the orchestrating agent owns the run and resumes it with your text.',
    '',
    hasGates
      ? 'End your reply with this exact block — `node` is how the server matches your result back to this step, followed by a proposed self-review: PROPOSED only; the orchestrating agent reviews and may override before submitting the actual verdict:'
      : 'End your reply with this exact block — `node` is how the server matches your result back to this step:',
    '',
    '```',
    HANDOFF_RESULT_HEADING,
    `node: ${token}`,
  ];
  if (hasGates) {
    parts.push(
      PROPOSED_GATE_REVIEW_TOKEN,
      '- [gate 1 name]: PASS|FAIL — <one-line rationale>',
      '- [gate 2 name]: PASS|FAIL — <one-line rationale>'
    );
  }
  parts.push('```');
  return parts.join('\n');
}
