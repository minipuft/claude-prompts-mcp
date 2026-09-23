// @lifecycle canonical - What a gate review's render reads off the review record.
/**
 * Review render facts (primitive rework row 3.5).
 *
 * A gate review re-renders the step it grades, and that render reads the review in two places:
 * which step it grades and which gates it names (before the body), and what the attempts so far
 * left behind — retry hints, the last recorded reasoning, the retry budget (after it). Both reads
 * are decided here, from the record `ChainSession.reviews[nodeId]` holds, so the executor that
 * renders the template owns no review semantics of its own.
 *
 * Pure: reads the review it is given, writes nothing.
 */

import type { GateReview } from '#shared/types/chain-execution.js';

/** What a gate review's render reads off the review. */
export interface ReviewRenderFacts {
  /** The node the review grades — the step whose template the review re-renders. */
  readonly nodeId: string;
  /**
   * The graded step's position, recorded on the review or on one of its prompts. Only a step
   * list that carries no node ids is resolved by it.
   */
  readonly stepIndex?: number;
  /** The review's own gate ids, in recorded order. */
  readonly gateIds: readonly string[];
  /** Gate ids the review's prompts or metadata name explicitly (inline gates). */
  readonly explicitGateIds: readonly string[];
  /** A previous attempt was graded: the render abbreviates the task it already showed. */
  readonly isRetry: boolean;
  /** At most three retry hints, in recorded order. */
  readonly retryHints: readonly string[];
  /** The last recorded reasoning, when it is short enough to quote. */
  readonly lastReasoning?: string;
  /** Present once the attempts are spent: the budget and the gates that spent it. */
  readonly exhausted?: { readonly maxAttempts: number; readonly failedGates: string };
}

const MAX_RENDERED_HINTS = 3;
const MAX_QUOTED_REASONING = 200;

/** Read what a gate review's render needs off `review`. PURE. */
export function describeReviewForRender(review: GateReview): ReviewRenderFacts {
  const stepIndex =
    stepIndexOf(review.metadata) ??
    review.prompts.map((prompt) => stepIndexOf(prompt.metadata)).find((i) => i !== undefined);
  const latest = review.history?.[review.history.length - 1];
  return {
    nodeId: review.nodeId,
    ...(stepIndex !== undefined ? { stepIndex } : {}),
    gateIds: review.gateIds,
    explicitGateIds: [
      ...review.prompts.flatMap((prompt) => [prompt.gateId, ...inlineGateIdsOf(prompt.metadata)]),
      ...inlineGateIdsOf(review.metadata),
    ].filter(isGateId),
    isRetry: review.attemptCount > 0,
    retryHints: (review.retryHints ?? []).slice(0, MAX_RENDERED_HINTS),
    ...(latest?.reasoning !== undefined &&
    latest.reasoning.length > 0 &&
    latest.reasoning.length < MAX_QUOTED_REASONING
      ? { lastReasoning: latest.reasoning }
      : {}),
    ...(review.attemptCount >= review.maxAttempts
      ? { exhausted: { maxAttempts: review.maxAttempts, failedGates: review.gateIds.join(', ') } }
      : {}),
  };
}

/**
 * The sections a review's render appends after the gate guidance, in render order. PURE.
 *
 * @param inlineGateFocus an inline gate triggered the review, so its fix comes first
 */
export function renderReviewSupplements(
  facts: ReviewRenderFacts,
  inlineGateFocus: boolean
): string[] {
  const sections: string[] = [];
  if (inlineGateFocus) {
    sections.push(
      '**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.'
    );
  }
  if (facts.retryHints.length > 0) {
    const heading = inlineGateFocus ? '**Inline Fix Guidance:**' : '**Improvements Needed:**';
    sections.push(`${heading}\n` + facts.retryHints.map((hint) => `- ${hint}`).join('\n'));
  }
  if (facts.lastReasoning !== undefined) {
    sections.push(`**Last Review:** ${facts.lastReasoning}`);
  }
  if (facts.exhausted !== undefined) {
    sections.push(
      `\n## ⚠️ Retry Limit Reached\n\n` +
        `The following gates failed after ${facts.exhausted.maxAttempts} attempts: **${facts.exhausted.failedGates}**\n\n` +
        `### Choose an action:\n\n` +
        `| Action | Description |\n` +
        `|--------|-------------|\n` +
        `| \`gate_action: "retry"\` | Reset retry count and try again with improvements |\n` +
        `| \`gate_action: "skip"\` | Skip this gate check and continue the chain |\n` +
        `| \`gate_action: "abort"\` | Stop chain execution entirely |\n\n` +
        `**To continue**, include one of the above in your next call.`
    );
  }
  return sections;
}

/** A 0-based step index recorded as `stepIndex`/`step_index`, or 1-based as `stepNumber`. */
function stepIndexOf(metadata: Record<string, unknown> | undefined): number | undefined {
  if (metadata === undefined) return undefined;
  const directIndex = metadata['stepIndex'] ?? metadata['step_index'];
  if (typeof directIndex === 'number' && Number.isFinite(directIndex)) return directIndex;
  const stepNumber = metadata['stepNumber'] ?? metadata['step_number'];
  if (typeof stepNumber === 'number' && Number.isFinite(stepNumber)) {
    return stepNumber > 0 ? stepNumber - 1 : 0;
  }
  return undefined;
}

/** The gate ids a metadata record lists as `inlineGateIds`/`inline_gate_ids`. */
function inlineGateIdsOf(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.['inlineGateIds'] ?? metadata?.['inline_gate_ids'];
  return Array.isArray(value) ? value.filter(isGateId) : [];
}

function isGateId(entry: unknown): entry is string {
  return typeof entry === 'string' && entry.trim().length > 0;
}
