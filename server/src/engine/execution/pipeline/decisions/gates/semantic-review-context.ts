// @lifecycle canonical - Frozen public review definitions and capture-bound semantic authority.
import { SemanticCriterionSchema } from '../../../../gates/core/gate-schema.js';
import { resolveJudgeConfig } from '../../../../gates/judge/judge-prompt-builder.js';

import type {
  GateReviewDefinitionSnapshot,
  GateReviewJsonValue,
  GateReviewSemanticContext,
} from '#shared/types/chain-execution.js';
import type {
  PinnedSemanticEvaluationContext,
  SemanticCriterion,
  SemanticCriterionInput,
} from '#shared/types/gate-evaluation.js';
import type { JudgeEvaluationDefaults } from '../../../../gates/judge/types.js';
import type { GatePassCriteria } from '../../../../gates/types/gate-primitives.js';
import type { LightweightGateDefinition } from '../../../../gates/types.js';

import { canonicalJson, hashBytes, hashCanonical } from '#shared/utils/hash.js';

/** Staged draft capability; the live loader's narrower DTO assigns without activating its union. */
export type SemanticReviewDefinitionInput = Omit<LightweightGateDefinition, 'pass_criteria'> & {
  readonly pass_criteria?: readonly (GatePassCriteria | SemanticCriterionInput)[];
};

function isJsonValue(value: unknown): value is GateReviewJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  const members: readonly unknown[] = Object.values(value);
  return members.every(isJsonValue);
}

function isJsonObject(value: unknown): value is Readonly<Record<string, GateReviewJsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value);
}

function freezeJson(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const members: readonly unknown[] = Object.values(value);
  for (const member of members) freezeJson(member);
  Object.freeze(value);
}

/** Keep the full resolved public DTO; the digest sits beside it rather than hashing itself. */
export function snapshotReviewDefinition(
  input: SemanticReviewDefinitionInput,
  defaults?: Partial<JudgeEvaluationDefaults>
): GateReviewDefinitionSnapshot {
  const publicDefinition = {
    ...input,
    evaluation: resolveJudgeConfig(input.evaluation, defaults),
    ...(input.pass_criteria !== undefined
      ? {
          pass_criteria: input.pass_criteria.map((criterion) =>
            criterion.type === 'semantic_evaluation'
              ? SemanticCriterionSchema.parse(criterion)
              : criterion
          ),
        }
      : {}),
  };
  delete publicDefinition.sourceRoot;
  const definition: unknown = JSON.parse(canonicalJson(publicDefinition));
  if (!isJsonObject(definition)) throw new TypeError('A review definition must be public JSON');
  freezeJson(definition);
  return Object.freeze({ definition, definitionDigest: hashCanonical(definition) });
}

/** Pins are supplied by the review-opening authority, never taken from report.binding. */
export function createSemanticReviewContext(
  nodeId: string,
  attemptId: string,
  definitions: readonly SemanticReviewDefinitionInput[],
  defaults?: Partial<JudgeEvaluationDefaults>
): GateReviewSemanticContext {
  const snapshots = Object.fromEntries(
    definitions.map((definition) => [definition.id, snapshotReviewDefinition(definition, defaults)])
  );
  return Object.freeze({ nodeId, attemptId, definitions: Object.freeze(snapshots) });
}

/** A new attempt retains its issued rubric and invalidates any prior captured target. */
export function renewSemanticReviewAttempt(
  context: GateReviewSemanticContext,
  attemptId: string
): GateReviewSemanticContext {
  const renewed = { ...context, attemptId };
  delete renewed.target;
  return Object.freeze(renewed);
}

/** Match registration's user_response.trim(); hash UTF-8 bytes without Unicode normalization. */
export function bindSemanticReviewTarget(
  context: GateReviewSemanticContext,
  actualResponse: string
): GateReviewSemanticContext {
  const content = actualResponse.trim();
  return Object.freeze({
    ...context,
    target: Object.freeze({ kind: 'step_output', content, digest: hashBytes(content) }),
  });
}

/** Narrow only the semantic subset; tool and reminder definitions stay in the public snapshot. */
export function readSemanticReviewCriteria(
  snapshot: GateReviewDefinitionSnapshot
): readonly SemanticCriterion[] {
  const criteria = snapshot.definition['pass_criteria'];
  if (!Array.isArray(criteria)) return [];
  const entries: readonly unknown[] = criteria;
  const semantic = entries
    .filter((entry) => isJsonObject(entry) && entry['type'] === 'semantic_evaluation')
    .map((entry) => SemanticCriterionSchema.parse(entry));
  freezeJson(semantic);
  return semantic;
}

/** Capture-first: no report can create a missing target or substitute any expected pin. */
export function resolvePinnedSemanticContext(
  context: GateReviewSemanticContext,
  gateId: string
): PinnedSemanticEvaluationContext {
  const snapshot = context.definitions[gateId];
  if (snapshot === undefined) throw new Error(`No issued definition for gate '${gateId}'`);
  const criteria = readSemanticReviewCriteria(snapshot);
  if (criteria.length === 0) throw new Error(`Gate '${gateId}' has no semantic criteria`);
  if (criteria.some((criterion) => criterion.target.kind !== 'step_output'))
    throw new Error('Artifact semantic capture is unavailable');
  const target = context.target;
  if (target === undefined) throw new Error('A prior captured step output binding is required');
  return Object.freeze({
    criteria,
    binding: Object.freeze({
      gate_id: gateId,
      node_id: context.nodeId,
      attempt_id: context.attemptId,
      definition_digest: snapshot.definitionDigest,
      target_digest: target.digest,
    }),
    target: Object.freeze({ kind: 'step_output', content: target.content }),
  });
}
