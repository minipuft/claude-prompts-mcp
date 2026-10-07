// @lifecycle canonical - Projects already-adjudicated gate results and original reviewer claims.
import type { GateReview, GateVerdictSummary } from '#shared/types/chain-execution.js';
import type {
  SemanticEvaluationBinding,
  SemanticEvaluationResult,
  ResolvedJudgeConfig,
} from '#shared/types/gate-evaluation.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

/** Facts retained from the existing kernel call; this projector does not adjudicate. */
export interface SemanticGateSummaryFacts {
  readonly gateId: string;
  readonly result: SemanticEvaluationResult;
  readonly binding: SemanticEvaluationBinding;
  readonly hint?: string;
}

function requestedEvaluation(review: GateReview, gateId: string): ResolvedJudgeConfig | undefined {
  const value = review.semanticContext?.definitions[gateId]?.definition['evaluation'];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const mode = 'mode' in value ? value['mode'] : undefined;
  const model = 'model' in value ? value['model'] : undefined;
  const strict = 'strict' in value ? value['strict'] : undefined;
  if (
    (mode !== 'self' && mode !== 'judge') ||
    typeof strict !== 'boolean' ||
    (model !== undefined && typeof model !== 'string')
  )
    return undefined;
  // Public snapshot JSON omits an undefined model; preserve its resolved meaning without defaults.
  return { mode, model, strict };
}

function projectGate(input: {
  readonly gateId: string;
  readonly reported: GateVerdictSummary | undefined;
  readonly semantic: SemanticGateSummaryFacts | undefined;
  readonly review: GateReview;
  readonly original: ParsedGateVerdict;
  readonly disposition: NonNullable<GateVerdictSummary['disposition']>;
  readonly timestamp: number;
}): GateVerdictSummary {
  const { gateId, reported, semantic, review, original, disposition } = input;
  const tools = (review.checkResults ?? []).filter((check) => check.gateId === gateId);
  const failures = [
    semantic?.hint,
    ...tools.filter((check) => !check.passed).map((check) => check.summary),
    ...(reported?.verdict === 'FAIL' ? [reported.rationale] : []),
  ].filter((reason): reason is string => reason !== undefined);
  const passed =
    semantic?.result.passed !== false &&
    tools.every((check) => check.passed) &&
    reported?.verdict !== 'FAIL';
  const requested = requestedEvaluation(review, gateId);
  const claim =
    reported ??
    (original.submission === undefined
      ? { verdict: original.verdict, rationale: original.rationale }
      : undefined);
  return {
    ...(reported ?? { gateId, timestamp: input.timestamp, attempt: review.attemptCount }),
    verdict: passed ? 'PASS' : 'FAIL',
    rationale:
      failures.length > 0 ? failures.join('; ') : (reported?.rationale ?? original.rationale),
    ...(claim !== undefined
      ? { reportedVerdict: claim.verdict, reportedRationale: claim.rationale }
      : {}),
    reportedReview: {
      overall: original.submission?.overall ?? original.verdict,
      rationale: original.submission?.rationale ?? original.rationale,
    },
    ...(semantic !== undefined
      ? { semanticResult: semantic.result, reviewBinding: semantic.binding }
      : {}),
    ...(tools.length > 0 ? { toolChecks: tools } : {}),
    ...(requested !== undefined ? { requestedEvaluation: requested } : {}),
    disposition,
  };
}

/** Failure attribution from validated claims, retained kernel decisions and actual scoped checks. */
export function failedReviewGateIds(
  review: GateReview,
  reported: readonly GateVerdictSummary[],
  semanticFailedIds: readonly string[]
): readonly string[] {
  return [
    ...new Set([
      ...reported.filter((claim) => claim.verdict === 'FAIL').map((claim) => claim.gateId),
      ...semanticFailedIds,
      ...(review.checkResults ?? [])
        .filter((check) => !check.passed && review.gateIds.includes(check.gateId))
        .map((check) => check.gateId),
    ]),
  ];
}

/** Only accepted transitions publish summaries; original claims never replace canonical facts. */
export function projectGateVerdictSummaries(input: {
  readonly reported: readonly GateVerdictSummary[];
  readonly semantic: readonly SemanticGateSummaryFacts[];
  readonly review: GateReview;
  readonly original: ParsedGateVerdict | undefined;
  readonly outcome: string;
  readonly timestamp: number;
  readonly enforcement: 'blocking' | 'advisory' | 'informational';
}): GateVerdictSummary[] | undefined {
  if (input.original === undefined) return undefined;
  const { reported, semantic, review } = input;
  const ids = new Set([
    ...reported.map((entry) => entry.gateId),
    ...semantic.map((entry) => entry.gateId),
    ...(review.checkResults ?? [])
      .filter((check) => review.gateIds.includes(check.gateId))
      .map((check) => check.gateId),
  ]);
  const disposition =
    input.outcome === 'passed'
      ? 'passed'
      : input.outcome === 'cleared'
        ? input.enforcement === 'informational'
          ? 'informational-cleared'
          : 'advisory-cleared'
        : 'held';
  if (ids.size === 0) return undefined;
  const original = input.original;
  return [...ids].map((gateId) =>
    projectGate({
      gateId,
      reported: reported.find((entry) => entry.gateId === gateId),
      semantic: semantic.find((entry) => entry.gateId === gateId),
      review,
      original,
      disposition,
      timestamp: input.timestamp,
    })
  );
}

/** Operational clearing is independent of the effective grade, including advisory FAIL. */
export function projectVerdictDetection(
  verdict: ParsedGateVerdict,
  outcome: string,
  nodeId: string
): {
  readonly verdict: 'PASS' | 'FAIL';
  readonly source: ParsedGateVerdict['source'];
  readonly nodeId: string;
  readonly rationale: string;
  readonly pattern?: string;
  readonly outcome: 'cleared' | 'pending';
} {
  return {
    verdict: verdict.verdict,
    source: verdict.source,
    nodeId,
    rationale: verdict.rationale,
    ...(verdict.detectedPattern !== undefined ? { pattern: verdict.detectedPattern } : {}),
    outcome: outcome === 'passed' || outcome === 'cleared' ? 'cleared' : 'pending',
  };
}
