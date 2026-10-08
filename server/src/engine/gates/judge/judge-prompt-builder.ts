// @lifecycle canonical - Builds strict judge evaluation prompts.
/**
 * Judge Prompt Builder
 *
 * Constructs context-isolated evaluation prompts for gate judge mode.
 * The judge sub-agent receives ONLY the output + criteria — no generation
 * reasoning, chain history, or framework context. This prevents context
 * contamination and self-evaluation bias.
 *
 * Uses the same `GATE_REVIEW: PASS|FAIL - reason` verdict format as
 * self-review, so existing verdict parsing works unchanged.
 */

import { GATE_VERDICT_REQUIRED_FORMAT } from '../core/gate-verdict-contract.js';

import type { SemanticCriterion } from '#shared/types/gate-evaluation.js';
import type {
  JudgeEnvelope,
  JudgeEvaluationConfig,
  JudgeEvaluationDefaults,
  ResolvedJudgeConfig,
  SemanticReviewPromptInput,
} from './types.js';

/**
 * Resolve per-gate evaluation config against global defaults.
 * Gate-level settings override global defaults.
 *
 * Resolution hierarchy: gate.evaluation.mode > config.gates.evaluation.defaultMode > 'self'
 */
export function resolveJudgeConfig(
  gateConfig?: Partial<JudgeEvaluationConfig>,
  globalDefaults?: Partial<JudgeEvaluationDefaults>
): ResolvedJudgeConfig {
  const mode = gateConfig?.mode ?? globalDefaults?.defaultMode ?? 'self';
  const model = gateConfig?.model ?? globalDefaults?.defaultModel;
  const strict = gateConfig?.strict ?? globalDefaults?.strict ?? mode === 'judge';

  return { mode, model, strict };
}

/**
 * Build a judge evaluation envelope from gate criteria and output.
 * Strips all generation context — judge sees only output + criteria.
 */
export function buildJudgeEnvelope(
  output: string,
  gateName: string,
  gateId: string,
  criteria: readonly string[],
  strict: boolean = true,
  semanticReviews?: readonly SemanticReviewPromptInput[]
): JudgeEnvelope {
  return {
    output,
    criteria,
    gateName,
    gateId,
    strict,
    verdictFormat: GATE_VERDICT_REQUIRED_FORMAT,
    ...(semanticReviews !== undefined ? { semanticReviews } : {}),
  };
}

/** Render only the declared public scale fields, not arbitrary definition metadata. */
function publicResultDomain(result: SemanticCriterion['result']): SemanticCriterion['result'] {
  switch (result.kind) {
    case 'boolean':
      return { kind: result.kind };
    case 'category':
      return { kind: result.kind, options: result.options };
    case 'score':
      return {
        kind: result.kind,
        min: result.min,
        max: result.max,
        anchors: result.anchors.map(({ value, description }) => ({ value, description })),
      };
  }
}

function publicAcceptance(
  acceptance: SemanticCriterion['acceptance']
): SemanticCriterion['acceptance'] {
  switch (acceptance.kind) {
    case 'one_of':
      return { kind: acceptance.kind, values: acceptance.values };
    case 'equals':
      return { kind: acceptance.kind, value: acceptance.value };
    case 'gte':
    case 'lte':
      return { kind: acceptance.kind, value: acceptance.value };
  }
}

/** One public rubric/report convention shared by self and judge review prompts. */
export function renderSemanticReviewPrompt(reviews: readonly SemanticReviewPromptInput[]): string {
  if (reviews.length === 0) return '';
  const sections = reviews.map(({ gateId, criteria, binding }) => {
    const rubric = criteria.map((criterion) => ({
      type: criterion.type,
      id: criterion.id,
      question: criterion.question,
      target:
        criterion.target.kind === 'artifact'
          ? { kind: criterion.target.kind, id: criterion.target.id }
          : { kind: criterion.target.kind },
      result: publicResultDomain(criterion.result),
      acceptance: publicAcceptance(criterion.acceptance),
      evidence_requirements: { min_items: criterion.evidence_requirements.min_items },
      allow_not_applicable: criterion.allow_not_applicable,
    }));
    const pins =
      binding === undefined
        ? 'Capture the node output first, then use the server-issued binding. No binding is available yet.'
        : 'Server-issued binding (copy exactly):\n' +
          JSON.stringify(
            {
              gate_id: binding.gate_id,
              node_id: binding.node_id,
              attempt_id: binding.attempt_id,
              definition_digest: binding.definition_digest,
              target_digest: binding.target_digest,
            },
            null,
            2
          );
    return [
      `### Semantic Evaluation: ${gateId}`,
      'Public rubric (JSON):',
      JSON.stringify(rubric, null, 2),
      pins,
    ].join('\n');
  });
  sections.push(
    'Submit a SemanticEvaluationReport in the matching gate_verdict.per_gate entry under evaluation. ' +
      'Each report contains binding and observations. Use the unchanged server-issued binding and one observation per public criterion ID. ' +
      'Each observation uses criterion_id, state, value, evidence and rationale; value is optional when evidence is insufficient or not applicable. ' +
      'Report state as met, unmet, insufficient_evidence or not_applicable with rationale. For met/unmet, supply a value in the rubric domain. ' +
      'Each evidence reference uses target_digest, start, end and optional quote. evidence.target_digest equals binding.target_digest. ' +
      'Offsets are half-open UTF-16 start/end into the captured target; quote is optional. ' +
      'Meet each evidence minimum; not_applicable is permitted only by allow_not_applicable. ' +
      'Do not invent missing pins or substitute new output for the captured target.'
  );
  return sections.join('\n\n');
}

/**
 * Render a judge evaluation prompt from a JudgeEnvelope.
 * This is the actual text sent to the judge sub-agent.
 *
 * Key design decisions:
 * - "You did NOT produce this output" — prevents self-identification bias
 * - "List failures FIRST" — strict framing forces evidence-based evaluation
 * - No generation reasoning included — prevents context contamination
 * - Standard verdict format — reuses existing verdict parsing infrastructure
 */
export function renderJudgePrompt(envelope: JudgeEnvelope): string {
  const sections: string[] = [];

  // Header — establish role and independence
  sections.push('## Judge Evaluation — Independent Quality Audit');
  sections.push('');
  sections.push(
    'You are an independent quality reviewer. ' +
      'Evaluate the following output against the criteria below.'
  );
  sections.push('');
  sections.push('**IMPORTANT: You did NOT produce this output. Evaluate it objectively.**');

  // Output section — the ONLY content from the original execution
  sections.push('');
  sections.push('### Output Under Review');
  sections.push('');
  sections.push('```');
  sections.push(envelope.output);
  sections.push('```');

  // Criteria section
  sections.push('');
  sections.push(`### Evaluation Criteria (${envelope.gateName})`);
  sections.push('');
  for (const criterion of envelope.criteria) {
    sections.push(`- ${criterion}`);
  }

  const semanticPrompt = renderSemanticReviewPrompt(envelope.semanticReviews ?? []);
  if (semanticPrompt.length > 0) sections.push('', semanticPrompt);

  // Evaluation protocol — strict or balanced
  sections.push('');
  sections.push('### Evaluation Protocol');
  sections.push('');

  if (envelope.strict) {
    sections.push('1. For each criterion, list specific ways the output **FAILS** to meet it');
    sections.push('2. Provide direct evidence from the output for each failure');
    sections.push('3. Only PASS if you cannot find genuine failures after thorough examination');
  } else {
    sections.push('1. For each criterion, assess whether the output meets the requirement');
    sections.push('2. Provide evidence from the output supporting your assessment');
    sections.push('3. PASS if the output substantially meets all criteria; FAIL otherwise');
  }

  // Verdict format
  sections.push('');
  sections.push(
    semanticPrompt.length > 0
      ? 'Respond with structured gate_verdict.per_gate entries, each carrying an evaluation report with the unchanged server-issued binding and observations. ' +
          `A legacy verdict line \`${envelope.verdictFormat}\` is a companion only and is insufficient without those structured reports.`
      : `Respond with: \`${envelope.verdictFormat}\``
  );

  return sections.join('\n');
}

/**
 * Check if a gate should use judge evaluation mode.
 */
export function isJudgeMode(resolved: ResolvedJudgeConfig): boolean {
  return resolved.mode === 'judge';
}
