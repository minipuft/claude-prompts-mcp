// @lifecycle canonical - Frozen public review definitions and capture-bound semantic authority.
import { resolveReviewTarget } from './review-target.js';
import { selectToolReviewGateIds } from './structural-review-composition.js';
import { SemanticCriterionSchema } from '../../../../gates/core/gate-schema.js';
import { resolveJudgeConfig } from '../../../../gates/judge/judge-prompt-builder.js';
import { resolveDetachedReport } from '../../../delegation/detached.js';
import {
  classifyHandoffBody,
  handoffNodeToken,
  resolveHandoffEvidenceMode,
} from '../../../delegation/handoff-contract.js';

import type {
  GateReviewDefinitionSnapshot,
  GateReviewJsonValue,
  GateReviewSemanticContext,
  GateReview,
  PendingGateReview,
} from '#shared/types/chain-execution.js';
import type {
  PinnedSemanticEvaluationContext,
  SemanticCriterion,
  SemanticCriterionInput,
} from '#shared/types/gate-evaluation.js';
import type {
  JudgeEvaluationDefaults,
  SemanticReviewPromptInput,
} from '../../../../gates/judge/types.js';
import type { GatePassCriteria } from '../../../../gates/types/gate-primitives.js';
import type { LightweightGateDefinition } from '../../../../gates/types.js';
import type { DetachedNodeFacts, RunHolds } from '../../../delegation/detached.js';
import type { HandoffEvidenceMode } from '../../../delegation/handoff-contract.js';

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

/** Rendering observes server authority, never a client's submitted binding. */
export interface FrozenReviewProjection {
  readonly submission: 'legacy' | 'capture-first' | 'report' | 'unavailable';
  readonly definitions?: readonly SemanticReviewDefinitionInput[];
  readonly semanticReviews: readonly SemanticReviewPromptInput[];
  readonly capturedOutput?: string;
  readonly reason?: string;
  readonly exhausted?: true;
}

export function assertFrozenReviewAvailable(protocol: FrozenReviewProjection): void {
  if (protocol.submission === 'unavailable')
    throw new Error(protocol.reason ?? 'Issued authority unavailable');
}

function readFrozenDefinition(
  gateId: string,
  snapshot: GateReviewDefinitionSnapshot
): SemanticReviewDefinitionInput {
  const definition = snapshot.definition;
  if (hashCanonical(definition) !== snapshot.definitionDigest || definition['id'] !== gateId)
    throw new Error(`Issued definition '${gateId}' is inconsistent`);
  if (
    typeof definition['name'] !== 'string' ||
    typeof definition['description'] !== 'string' ||
    (definition['type'] !== 'validation' && definition['type'] !== 'guidance')
  )
    throw new Error(`Issued definition '${gateId}' is unavailable`);
  const evaluation = definition['evaluation'];
  if (
    !isJsonObject(evaluation) ||
    (evaluation['mode'] !== 'self' && evaluation['mode'] !== 'judge') ||
    typeof evaluation['strict'] !== 'boolean' ||
    (evaluation['model'] !== undefined && typeof evaluation['model'] !== 'string')
  )
    throw new Error(`Issued evaluator for '${gateId}' is unavailable`);
  if (definition['pass_criteria'] !== undefined && !Array.isArray(definition['pass_criteria']))
    throw new Error(`Issued criteria for '${gateId}' are unavailable`);
  // The snapshot creator already owns the full public DTO; the renderer has no live loader.
  return definition as unknown as SemanticReviewDefinitionInput;
}

interface FrozenReviewEntry {
  definition?: SemanticReviewDefinitionInput;
  semanticReview?: SemanticReviewPromptInput;
}

function assertReviewIdentity(issued: unknown, nodeId: string | undefined): void {
  if (
    !isJsonObject(issued) ||
    typeof issued['nodeId'] !== 'string' ||
    issued['nodeId'] !== nodeId ||
    typeof issued['attemptId'] !== 'string' ||
    issued['attemptId'].trim().length === 0
  )
    throw new Error('Issued review identity is inconsistent');
  const target = issued['target'];
  if (
    target !== undefined &&
    (!isJsonObject(target) ||
      target['kind'] !== 'step_output' ||
      typeof target['content'] !== 'string' ||
      typeof target['digest'] !== 'string')
  )
    throw new Error('Captured output authority is inconsistent');
}

function projectFrozenGate(
  issued: GateReviewSemanticContext,
  gateId: string,
  structural: boolean
): FrozenReviewEntry {
  const snapshot = issued.definitions[gateId];
  if (snapshot === undefined) {
    if (structural) return {};
    throw new Error(`No issued definition for '${gateId}'`);
  }
  const definition = readFrozenDefinition(gateId, snapshot);
  const criteria = readSemanticReviewCriteria(snapshot);
  if (criteria.length === 0) return { definition };
  if (criteria.some((criterion) => criterion.target.kind !== 'step_output'))
    throw new Error('Artifact semantic capture is unavailable');
  const expected =
    issued.target === undefined ? undefined : resolvePinnedSemanticContext(issued, gateId);
  return {
    definition,
    semanticReview: {
      gateId,
      criteria,
      ...(expected === undefined ? {} : { binding: expected.binding }),
    },
  };
}

/** Frozen public definitions, expected pins and actual captured output for every render consumer. */
export function projectFrozenReview(review: PendingGateReview): FrozenReviewProjection {
  const issued = review.semanticContext;
  if (issued === undefined) return { submission: 'legacy', semanticReviews: [] };
  try {
    assertReviewIdentity(issued, review.nodeId);
    const required = new Set(selectToolReviewGateIds(review));
    const entries = review.gateIds.map((gateId) =>
      projectFrozenGate(issued, gateId, !required.has(gateId))
    );
    const definitions = entries.flatMap((entry) =>
      entry.definition === undefined ? [] : [entry.definition]
    );
    const semanticReviews = entries.flatMap((entry) =>
      entry.semanticReview === undefined ? [] : [entry.semanticReview]
    );
    if (issued.target !== undefined && hashBytes(issued.target.content) !== issued.target.digest)
      throw new Error('Captured output digest is inconsistent');
    return {
      submission:
        semanticReviews.length === 0
          ? 'legacy'
          : issued.target === undefined
            ? 'capture-first'
            : 'report',
      definitions,
      semanticReviews,
      ...(review.phase === 'exhausted' ? { exhausted: true } : {}),
      ...(issued.target === undefined ? {} : { capturedOutput: issued.target.content }),
    };
  } catch (error) {
    return {
      submission: 'unavailable',
      definitions: [],
      semanticReviews: [],
      reason: error instanceof Error ? error.message : 'Issued review authority unavailable',
    };
  }
}

export type SemanticTargetAdmission =
  { readonly kind: 'admitted' } | { readonly kind: 'refused'; readonly message: string };

/** Server-owned target admission, before a verdict can grade or mutate the review. */
export function resolveSemanticTargetAdmission(input: {
  readonly verdictPresent: boolean;
  readonly review: GateReview | undefined;
  readonly suppliedResponse: string | undefined;
  readonly bodyNodeId: string | undefined;
  readonly routingOnly: boolean;
}): SemanticTargetAdmission {
  const issued = input.review?.semanticContext;
  if (!input.verdictPresent || issued === undefined) return { kind: 'admitted' };
  let required: boolean;
  try {
    required = Object.values(issued.definitions).some(
      (snapshot) => readSemanticReviewCriteria(snapshot).length > 0
    );
  } catch {
    return {
      kind: 'refused',
      message:
        'Server semantic requirements could not be read; open a fresh review. Nothing was recorded.',
    };
  }
  if (!required) return { kind: 'admitted' };
  if (issued.target === undefined) {
    return {
      kind: 'refused',
      message:
        'Capture the node output before submitting its semantic gate_verdict; a report cannot create the target. Nothing was recorded.',
    };
  }
  if (
    input.suppliedResponse !== undefined &&
    !input.routingOnly &&
    input.bodyNodeId === input.review?.nodeId &&
    input.suppliedResponse.trim() !== issued.target.content
  ) {
    return {
      kind: 'refused',
      message:
        'The supplied response differs from the server-captured semantic target. Submit the verdict without new work, or capture a separate replacement first. Nothing was recorded.',
    };
  }
  return { kind: 'admitted' };
}

/** Plain host facts; routing never imports the capture service or execution context. */
interface SemanticTargetResponseFacts {
  readonly verdictPresent: boolean;
  readonly suppliedResponse: string | undefined;
  readonly currentResponseNodeId: string | undefined;
  readonly currentNodeId: string | null;
  readonly nodeIds: readonly string[];
  readonly reviews: Readonly<Record<string, GateReview>>;
  readonly currentStep:
    | {
        readonly nodeId?: string;
        readonly stepNumber: number;
        readonly delegated?: boolean;
        readonly await?: 'node' | 'run';
      }
    | undefined;
  readonly detachedNodes: readonly DetachedNodeFacts[];
  readonly holds: RunHolds;
  readonly evidenceMode?: HandoffEvidenceMode;
  readonly trailerNodeId?: string;
  readonly actionPresent: boolean;
}

/** Resolve the actual response address using the canonical review and detached routers. */
export function resolveSemanticTargetResponseAdmission(
  input: SemanticTargetResponseFacts
): SemanticTargetAdmission {
  if (!input.verdictPresent) return { kind: 'admitted' };
  const reply = input.suppliedResponse?.trim() ?? '';
  const addressed = resolveReviewTarget(input);
  const current = input.currentStep;
  const route = resolveDetachedReport({
    reply,
    mode: input.evidenceMode ?? resolveHandoffEvidenceMode(undefined),
    reviewPending: addressed.kind === 'review',
    submits: { verdict: true, action: input.actionPresent },
    current:
      input.currentNodeId === null || current === undefined
        ? null
        : {
            token: handoffNodeToken(current),
            delegated: current.delegated === true,
            detached: current.await === 'run',
          },
    detachedNodes: input.detachedNodes,
    holds: input.holds,
  });
  const routed =
    route.kind === 'report' || route.kind === 'review-verdict' || route.kind === 'review-action'
      ? route.node
      : undefined;
  const target =
    routed === undefined || input.trailerNodeId !== undefined
      ? addressed
      : resolveReviewTarget({ ...input, trailerNodeId: routed.nodeId });
  const review = target.kind === 'review' ? input.reviews[target.nodeId] : undefined;
  const routingOnly =
    route.kind === 'review-verdict' &&
    routed?.nodeId === review?.nodeId &&
    classifyHandoffBody(reply).kind === 'routing-only';
  const standing =
    review === undefined &&
    input.suppliedResponse !== undefined &&
    !routingOnly &&
    route.kind === 'continue-past'
      ? input.reviews[route.node.nodeId]
      : undefined;
  const admission = resolveSemanticTargetAdmission({
    verdictPresent: true,
    review: review ?? standing,
    suppliedResponse: standing === undefined ? input.suppliedResponse : undefined,
    bodyNodeId: routed?.nodeId ?? input.currentResponseNodeId ?? review?.nodeId,
    routingOnly,
  });
  if (admission.kind === 'refused' || standing?.semanticContext === undefined) return admission;
  const required = Object.values(standing.semanticContext.definitions).some(
    (snapshot) => readSemanticReviewCriteria(snapshot).length > 0
  );
  return required
    ? {
        kind: 'refused',
        message:
          'Name the detached review node in a HANDOFF RESULT trailer before submitting its semantic verdict. Nothing was recorded.',
      }
    : admission;
}
