// @lifecycle canonical - Pure acceptance of reports against pinned semantic criteria and targets.
import { z } from 'zod/v4';

import { SemanticCriterionSchema } from './gate-schema.js';

import type {
  PinnedSemanticEvaluationContext,
  SemanticCriterion,
  SemanticEvaluationBinding,
  SemanticObservation,
  SemanticObservationState,
} from '#shared/types/gate-evaluation.js';

import { hashBytes } from '#shared/utils/hash.js';

interface SemanticEvaluationIssue {
  readonly code: string;
  readonly message: string;
  readonly criterion_id?: string;
}
interface SemanticCriterionResult {
  readonly criterion_id: string;
  readonly state: SemanticObservationState | 'invalid';
  readonly valid: boolean;
  readonly passed: boolean;
  readonly issues: readonly SemanticEvaluationIssue[];
}
interface SemanticEvaluationResult {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly issues: readonly SemanticEvaluationIssue[];
  readonly criteria: readonly SemanticCriterionResult[];
}

const text = z.string().refine((value) => value.trim().length > 0);
const bindingSchema = z.strictObject({
  gate_id: text,
  node_id: text,
  attempt_id: text,
  definition_digest: text,
  target_digest: text,
});
const contextSchema = z.strictObject({
  criteria: z.array(SemanticCriterionSchema).min(1),
  binding: bindingSchema,
  target: z.strictObject({
    kind: z.enum(['step_output', 'artifact']),
    id: text.optional(),
    content: z.string(),
  }),
});
const reportSchema = z.strictObject({ binding: bindingSchema, observations: z.array(z.unknown()) });
const observationSchema: z.ZodType<SemanticObservation> = z.strictObject({
  criterion_id: text,
  state: z.enum(['met', 'unmet', 'insufficient_evidence', 'not_applicable']),
  value: z.union([z.boolean(), z.string(), z.number()]).optional(),
  evidence: z.array(
    z.strictObject({
      target_digest: text,
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      quote: z.string().optional(),
    })
  ),
  rationale: z.string(),
});

function issue(code: string, message: string, criterion_id?: string): SemanticEvaluationIssue {
  return { code, message, ...(criterion_id === undefined ? {} : { criterion_id }) };
}
function schemaIssues(error: z.ZodError, code: string, id?: string): SemanticEvaluationIssue[] {
  return error.issues.map((entry) => issue(code, `${entry.path.join('.')}: ${entry.message}`, id));
}
function invalid(id: string, issues: readonly SemanticEvaluationIssue[]): SemanticCriterionResult {
  return { criterion_id: id, state: 'invalid', valid: false, passed: false, issues };
}
function result(
  criteria: readonly SemanticCriterionResult[],
  issues: SemanticEvaluationIssue[]
): SemanticEvaluationResult {
  const allIssues = [...issues, ...criteria.flatMap((criterion) => criterion.issues)];
  const valid = allIssues.length === 0;
  return {
    valid,
    passed: valid && criteria.length > 0 && criteria.every((entry) => entry.passed),
    issues: allIssues,
    criteria,
  };
}
function bindingIssues(
  context: PinnedSemanticEvaluationContext,
  binding: SemanticEvaluationBinding
): SemanticEvaluationIssue[] {
  const issues: SemanticEvaluationIssue[] = [];
  for (const key of Object.keys(context.binding) as (keyof SemanticEvaluationBinding)[]) {
    if (binding[key] !== context.binding[key])
      issues.push(issue('binding_mismatch', `Report ${key} does not match pinned ${key}`));
  }
  if (context.binding.target_digest !== hashBytes(context.target.content)) {
    issues.push(issue('target_digest_mismatch', 'Pinned digest must hash captured UTF-8 content'));
  }
  return issues;
}
function indexObservations(
  observations: readonly unknown[],
  ids: ReadonlySet<string>,
  issues: SemanticEvaluationIssue[]
): Map<string, unknown[]> {
  const indexed = new Map<string, unknown[]>();
  for (const observation of observations) {
    const identified = z.object({ criterion_id: text }).safeParse(observation);
    if (!identified.success) {
      issues.push(...schemaIssues(identified.error, 'invalid_observation'));
      continue;
    }
    const id = identified.data.criterion_id;
    if (!ids.has(id)) issues.push(issue('unknown_criterion', `Unknown criterion '${id}'`, id));
    const entries = indexed.get(id) ?? [];
    entries.push(observation);
    indexed.set(id, entries);
  }
  return indexed;
}
/** Integrity of citations is checked here; it does not establish their semantic relevance. */
function evidenceIssues(
  context: PinnedSemanticEvaluationContext,
  criterion: SemanticCriterion,
  observation: SemanticObservation
): SemanticEvaluationIssue[] {
  const issues: SemanticEvaluationIssue[] = [];
  const spans = new Set<string>();
  for (const ref of observation.evidence) {
    const bound = ref.target_digest === context.binding.target_digest;
    const span = ref.start < ref.end && ref.end <= context.target.content.length;
    const quote =
      ref.quote === undefined || ref.quote === context.target.content.slice(ref.start, ref.end);
    if (!bound || !span || !quote) {
      issues.push(
        issue('invalid_evidence', 'Invalid target digest, UTF-16 span or quote', criterion.id)
      );
    } else spans.add(`${ref.start}:${ref.end}`);
  }
  if (
    observation.state !== 'insufficient_evidence' &&
    spans.size < criterion.evidence_requirements.min_items
  ) {
    issues.push(
      issue(
        'evidence_required',
        `Requires ${criterion.evidence_requirements.min_items} distinct target-bound evidence spans`,
        criterion.id
      )
    );
  }
  return issues;
}
function isDomainValue(criterion: SemanticCriterion, value: SemanticObservation['value']): boolean {
  switch (criterion.result.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'category':
      return typeof value === 'string' && criterion.result.options.includes(value);
    case 'score':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= criterion.result.min &&
        value <= criterion.result.max
      );
  }
}
function accepts(criterion: SemanticCriterion, value: boolean | string | number): boolean {
  const predicate = criterion.acceptance;
  switch (predicate.kind) {
    case 'equals':
      return value === predicate.value;
    case 'one_of':
      return typeof value === 'string' && predicate.values.includes(value);
    case 'gte':
      return typeof value === 'number' && value >= predicate.value;
    case 'lte':
      return typeof value === 'number' && value <= predicate.value;
  }
}
function stateIssues(
  criterion: SemanticCriterion,
  observation: SemanticObservation
): SemanticEvaluationIssue[] {
  const { state, value } = observation;
  if (state === 'not_applicable' || state === 'insufficient_evidence') {
    const issues: SemanticEvaluationIssue[] = [];
    if (value !== undefined)
      issues.push(issue('unexpected_value', `${state} must omit value`, criterion.id));
    if (
      state === 'not_applicable' &&
      (!criterion.allow_not_applicable || observation.rationale.trim().length === 0)
    ) {
      issues.push(
        issue(
          'not_applicable_denied',
          'N/A requires authored permission and a nonempty rationale',
          criterion.id
        )
      );
    }
    return issues;
  }
  if (!isDomainValue(criterion, value) || value === undefined) {
    return [issue('invalid_value', 'Value missing or outside result domain', criterion.id)];
  }
  const computed = accepts(criterion, value) ? 'met' : 'unmet';
  return state === computed
    ? []
    : [
        issue(
          'state_disagreement',
          `Predicate computes '${computed}', report claims '${state}'`,
          criterion.id
        ),
      ];
}
function evaluateCriterion(
  context: PinnedSemanticEvaluationContext,
  criterion: SemanticCriterion,
  entries: readonly unknown[]
): SemanticCriterionResult {
  const issues: SemanticEvaluationIssue[] = [];
  if (
    criterion.target.kind !== context.target.kind ||
    (criterion.target.kind === 'artifact' && criterion.target.id !== context.target.id)
  ) {
    issues.push(issue('target_mismatch', 'Criterion target differs from capture', criterion.id));
  }
  if (entries.length !== 1) {
    issues.push(
      issue(
        entries.length === 0 ? 'missing_observation' : 'duplicate_observation',
        'Exactly one observation is required per criterion',
        criterion.id
      )
    );
    return invalid(criterion.id, issues);
  }
  const parsed = observationSchema.safeParse(entries[0]);
  if (!parsed.success)
    return invalid(criterion.id, [
      ...issues,
      ...schemaIssues(parsed.error, 'invalid_observation', criterion.id),
    ]);
  const observation = parsed.data;
  issues.push(
    ...evidenceIssues(context, criterion, observation),
    ...stateIssues(criterion, observation)
  );
  if (issues.length > 0) return invalid(criterion.id, issues);
  return {
    criterion_id: criterion.id,
    state: observation.state,
    valid: true,
    passed: observation.state === 'met' || observation.state === 'not_applicable',
    issues: [],
  };
}

/**
 * Accepts only a complete, consistent report for independently pinned authority. Target digests
 * use hashBytes (`sha256:<hex>`); evidence offsets use half-open JavaScript UTF-16 string spans.
 * No I/O or reviewer invocation occurs. Acceptance validates structure/predicates/citations,
 * not whether a reviewer interpreted the target truthfully or correctly.
 */
export function evaluateSemanticEvaluation(
  context: PinnedSemanticEvaluationContext,
  report: unknown
): SemanticEvaluationResult {
  const pinned = contextSchema.safeParse(context);
  if (!pinned.success) return result([], schemaIssues(pinned.error, 'invalid_context'));
  const authority = pinned.data;
  const ids = new Set(authority.criteria.map((criterion) => criterion.id));
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success)
    return result(
      authority.criteria.map((criterion) => invalid(criterion.id, [])),
      schemaIssues(parsed.error, 'invalid_report')
    );
  const issues = bindingIssues(authority, parsed.data.binding);
  if (ids.size !== authority.criteria.length)
    issues.push(issue('duplicate_criterion', 'Pinned criterion IDs must be unique'));
  if (issues.length > 0)
    return result(
      authority.criteria.map((criterion) => invalid(criterion.id, [])),
      issues
    );
  const indexed = indexObservations(parsed.data.observations, ids, issues);
  return result(
    authority.criteria.map((criterion) =>
      evaluateCriterion(authority, criterion, indexed.get(criterion.id) ?? [])
    ),
    issues
  );
}
