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

import { projectFrozenReview } from './semantic-review-context.js';
import {
  composeJudgeReviewPrompt,
  JUDGE_OUTPUT_PLACEHOLDER,
} from '../../../../gates/core/review-utils.js';
import { GATE_ATTESTATION_LINE } from '../../../../gates/guidance/GateGuidanceRenderer.js';
import { renderSemanticReviewPrompt } from '../../../../gates/judge/judge-prompt-builder.js';

import type {
  GateReview,
  GateCheckResult,
  GateReviewPrompt,
  PendingGateReview,
} from '#shared/types/chain-execution.js';
import type { FrozenReviewProjection } from './semantic-review-context.js';
import type { GateTier } from '../../../../gates/core/gate-tier.js';
import type { JudgeReviewMetadata } from '../../../../gates/core/review-utils.js';

/** What a gate review's render reads off the review. */
export interface ReviewRenderFacts {
  readonly protocol: FrozenReviewProjection;
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
    protocol: projectFrozenReview(review),
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
  // An exhausted review takes only a `gate_action` and lists no criteria (P6.45), so it carries
  // no fix line, no hint and no quoted review that could name a criterion it dropped (R165).
  if (facts.exhausted !== undefined) {
    return [
      `\n## ⚠️ Retry Limit Reached\n\n` +
        `The following gates failed after ${facts.exhausted.maxAttempts} attempts: **${facts.exhausted.failedGates}**\n\n` +
        `### Choose an action:\n\n` +
        `| Action | Description |\n` +
        `|--------|-------------|\n` +
        `| \`gate_action: "retry"\` | Reset retry count and try again with improvements |\n` +
        `| \`gate_action: "skip"\` | Skip this gate check and continue the chain |\n` +
        `| \`gate_action: "abort"\` | Stop chain execution entirely |\n\n` +
        `**To continue**, include one of the above in your next call.`,
    ];
  }
  const sections: string[] = [];
  const frozen = renderFrozenReviewInstructions(facts.protocol);
  if (frozen !== '') sections.push(frozen);
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

/** Frozen routing only; requested configuration supplies no observed model identity. */
export function describeFrozenJudgeReview(
  protocol: FrozenReviewProjection
): JudgeReviewMetadata | undefined {
  if (protocol.exhausted === true) return undefined;
  if (
    protocol.definitions === undefined ||
    protocol.submission === 'unavailable' ||
    protocol.submission === 'capture-first'
  )
    return undefined;
  const gates = protocol.definitions
    .filter((gate) => gate.evaluation?.mode === 'judge')
    .map((gate) => ({
      id: gate.id,
      name: gate.name,
      type: gate.type,
      description: gate.description,
      guidance: gate.guidance,
      evaluation: gate.evaluation,
    }));
  if (gates.length === 0) return undefined;
  const composed = composeJudgeReviewPrompt(
    gates,
    protocol.capturedOutput ?? JUDGE_OUTPUT_PLACEHOLDER,
    protocol.semanticReviews
  );
  return {
    judgePrompt: composed.judgePrompt,
    judgeGateIds: composed.judgeGateIds,
    ...(composed.modelHint === undefined ? {} : { modelHint: composed.modelHint }),
  };
}

/** The admitted next action, separate from the report grade and from new work. */
export function semanticReviewAction(protocol: FrozenReviewProjection): string | undefined {
  if (protocol.exhausted === true && protocol.submission !== 'legacy')
    return 'The retry limit is reached. Choose gate_action: retry, skip or abort; no verdict is accepted.';
  switch (protocol.submission) {
    case 'legacy':
      return undefined;
    case 'unavailable':
      return `Semantic review unavailable: ${protocol.reason ?? 'issued authority unavailable'}. No verdict can be accepted. Restore valid server review authority.`;
    case 'capture-first':
      return 'Capture the node output with user_response alone, without a verdict. Then submit the report against the server-issued captured binding.';
    case 'report':
      return 'Submit the structured gate_verdict report only. Omit user_response, or repeat identical canonical whole bytes. To change work, submit FAIL against the captured output first, then capture the replacement in a separate call after renewal.';
  }
}

function renderFrozenReviewInstructions(protocol: FrozenReviewProjection): string {
  const action = semanticReviewAction(protocol);
  if (action === undefined) return '';
  if (protocol.exhausted === true) return action;
  const requested =
    protocol.definitions?.map((gate) => ({ gate_id: gate.id, evaluation: gate.evaluation })) ?? [];
  return [
    renderSemanticReviewPrompt(protocol.semanticReviews),
    requested.length === 0
      ? ''
      : `Requested evaluator configuration (not observed reviewer identity):\n${JSON.stringify(requested, null, 2)}`,
    protocol.capturedOutput === undefined
      ? ''
      : `Server-captured output under review:\n\`\`\`\`\n${protocol.capturedOutput}\n\`\`\`\``,
    action,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** Shared resume instructions for ordinary, blocked and detached semantic reviews. */
export function semanticReviewResume(
  review: PendingGateReview | undefined,
  chainId: string
): string | undefined {
  if (review === undefined) return undefined;
  const protocol = projectFrozenReview(review);
  const action = semanticReviewAction(protocol);
  if (action === undefined) return undefined;
  if (protocol.exhausted === true) return action;
  if (protocol.submission === 'unavailable') return action;
  const args =
    protocol.submission === 'capture-first'
      ? 'user_response="<complete node output>"'
      : `gate_verdict=${buildStructuredVerdictTemplate(review.gateIds, review.prompts, new Map(Object.entries(review.gateTiers ?? {})), new Map((review.checkResults ?? []).map((result) => [result.gateId, result])), protocol)}`;
  return `${renderFrozenReviewInstructions(protocol)}\n\nResume:\n\n\`\`\`\nchain_id=${JSON.stringify(chainId)}\n${args}\n\`\`\``;
}

/**
 * Max check-tier gates given a `per_gate` slot in the verdict template.
 *
 * Bounds the collected CHECK entries only — reminder-tier gates never count against this cap,
 * since they render once in the `reminders` field rather than one `per_gate` entry each. The full
 * `gateIds` list is still walked in original order so a run of leading reminders cannot push a
 * later check off the template before it is even considered.
 */
const MAX_GATE_VERDICT_ENTRIES = 10;

/**
 * Builds the structured `gate_verdict` template keyed to actual gate names.
 *
 * Offered ahead of the string template because a structured submission is
 * validated by the tool schema and cannot be malformed, whereas the string
 * form is a format the model has to reproduce and the server then reads back
 * with five fallback regexes. Advertising the fragile form first would keep
 * steering clients into the path that can fail.
 *
 * Rendered as JSON rather than prose so it can be copied into the call
 * directly. Rationale placeholders are single-line, which is what the
 * schema requires.
 *
 * A module function, not a method: a detached node's review (row 4.8) renders the same template
 * from `StepResponseCaptureStage`, which holds no assembler.
 */
export function buildStructuredVerdictTemplate(
  gateIds: readonly string[],
  prompts: readonly GateReviewPrompt[],
  tiers: ReadonlyMap<string, GateTier>,
  checkResults: ReadonlyMap<string, GateCheckResult>,
  protocol?: FrozenReviewProjection
): string {
  if (protocol?.exhausted === true) return '';
  if (protocol?.submission === 'capture-first' || protocol?.submission === 'unavailable') return '';
  const promptMap = buildPromptLookup(prompts);

  const entries: string[] = [];
  const reminderIds: string[] = [];

  // Walk the FULL advertised list, not a pre-sliced prefix: slicing before the walk let a run
  // of leading reminders push a later check off the template before it was ever considered.
  // The cap binds only the collected check entries (below); reminders are never counted against
  // it because they render once in the `reminders` field rather than one `per_gate` slot each.
  gateIds.forEach((gateId, position) => {
    const semantic = protocol?.semanticReviews.find((review) => review.gateId === gateId);
    // The index is the gate's place in the ORIGINAL list, not its place among the entries:
    // `parseGateVerdicts` matches `[n]` back to the advertised gate list, so renumbering the
    // survivors after reminders are dropped (or a check is capped out) would point every
    // verdict at the wrong gate.
    const index = position + 1;
    if (semantic === undefined && (tiers.get(gateId) ?? 'check') === 'reminder') {
      reminderIds.push(gateId);
      return;
    }
    if (semantic === undefined && entries.length >= MAX_GATE_VERDICT_ENTRIES) {
      return;
    }

    const prompt = promptMap.get(gateId);
    const label = prompt?.gateName ?? gateId;
    // Criteria carry the reviewer's actual checklist; dropping them would
    // make the structured form less informative than the string form it
    // replaces. Quotes are escaped because this lands inside a JSON string.
    const criteria = prompt?.criteriaSummary;
    const suffix = criteria != null && criteria.length > 0 ? ` — ${criteria}` : '';
    // A recorded result is the engine's, so the template states it rather than asking for it
    // — a slot the model fills is a slot it can fill wrongly, and the processor refuses a PASS
    // over a recorded failure anyway. `<why>` survives only where nothing ran yet.
    const recorded = checkResults.get(gateId);
    const slot = recorded !== undefined ? `<recorded: ${recorded.summary}>` : '<why>';
    const rationale = `${label}${suffix}: ${slot}`.replace(/"/g, '\\"');
    const passed = recorded?.passed ?? true;
    if (semantic?.binding !== undefined) {
      entries.push(
        '    ' +
          JSON.stringify({
            index,
            passed: false,
            rationale: '<evidence-grounded assessment>',
            evaluation: {
              binding: semantic.binding,
              observations: semantic.criteria.map((criterion) => ({
                criterion_id: criterion.id,
                state: 'insufficient_evidence',
                evidence: [],
                rationale: '<assessment with captured evidence>',
              })),
            },
          })
      );
    } else {
      entries.push(`    {"index": ${index}, "passed": ${passed}, "rationale": "${rationale}"}`);
    }
  });

  const perGate = entries.length > 0 ? `,\n  "per_gate": [\n${entries.join(',\n')}\n  ]` : '';
  // One field for every reminder, never one entry each (ruling B4). Pre-listed under
  // `satisfied` because that is the common answer; an id that did not apply moves to
  // `not_applicable` WITH a reason, which the schema requires.
  const reminders =
    reminderIds.length > 0
      ? `,\n  "reminders": {"satisfied": [${reminderIds
          .map((id) => `"${id.replace(/"/g, '\\"')}"`)
          .join(', ')}], "not_applicable": []}`
      : '';
  const overall = protocol?.submission === 'report' ? 'FAIL' : 'PASS';
  return `{\n  "overall": "${overall}",\n  "rationale": "<overall assessment>"${perGate}${reminders}\n}`;
}

/**
 * Builds a lookup map from gate ID to its review prompt.
 */
function buildPromptLookup(prompts: readonly GateReviewPrompt[]): Map<string, GateReviewPrompt> {
  const map = new Map<string, GateReviewPrompt>();
  for (const prompt of prompts) {
    if (prompt.gateId != null && prompt.gateId.length > 0) {
      map.set(prompt.gateId, prompt);
    }
  }
  return map;
}

/** Existing fallback wording consumes classification facts without loading a catalog. */
export function renderFallbackGateGuidance(
  inlineGateIds: readonly string[],
  frameworkGateIds: readonly string[],
  inlineGuidanceText?: string
): string {
  const hasInlineGuidance =
    inlineGateIds.length > 0 || Boolean(inlineGuidanceText && inlineGuidanceText.trim().length > 0);
  const filteredFrameworkGateIds = hasInlineGuidance
    ? frameworkGateIds.filter((id) => id === 'framework-compliance')
    : frameworkGateIds;
  const sections: string[] = ['\n\n---\n\n##  Quality Enhancement Gates'];

  if (inlineGateIds.length > 0 || (inlineGuidanceText && inlineGuidanceText.trim().length > 0)) {
    sections.push('\n\n###  Inline Gates (PRIMARY)\n');
    if (inlineGuidanceText && inlineGuidanceText.trim().length > 0) {
      sections.push(inlineGuidanceText.trim());
    }
    if (inlineGateIds.length > 0) {
      sections.push('\n\n' + inlineGateIds.map((id) => `- ${id}`).join('\n'));
    }
  }

  if (filteredFrameworkGateIds.length > 0) {
    sections.push('\n\n---\n\n###  Framework Standards');
    sections.push('\n\n' + filteredFrameworkGateIds.map((id) => `- ${id}`).join('\n'));
  }

  sections.push('\n\n' + GATE_ATTESTATION_LINE);
  sections.push('---');

  return sections.join('');
}
