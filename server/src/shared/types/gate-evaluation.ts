// @lifecycle canonical - Dependency-free semantic gate contracts shared by runtime and calibration.

/** Public result domains; score anchors describe the scale, including both endpoints. */
export type SemanticResultDomain =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'category'; readonly options: readonly string[] }
  | {
      readonly kind: 'score';
      readonly min: number;
      readonly max: number;
      readonly anchors: readonly SemanticScoreAnchor[];
    };

interface SemanticScoreAnchor {
  readonly value: number;
  readonly description: string;
}

/** Declarative predicates only; compatibility with the result domain is validated on parse. */
export type SemanticAcceptance =
  | { readonly kind: 'equals'; readonly value: boolean | string }
  | { readonly kind: 'one_of'; readonly values: readonly string[] }
  | { readonly kind: 'gte' | 'lte'; readonly value: number };

type SemanticCriterionTarget =
  { readonly kind: 'step_output' } | { readonly kind: 'artifact'; readonly id: string };

/** Parsed definition: the optional authored N/A policy has been defaulted. */
export interface SemanticCriterion {
  readonly type: 'semantic_evaluation';
  readonly id: string;
  readonly target: SemanticCriterionTarget;
  readonly question: string;
  readonly evidence_requirements: { readonly min_items: number };
  readonly result: SemanticResultDomain;
  readonly acceptance: SemanticAcceptance;
  readonly allow_not_applicable: boolean;
}

/** Authoring input permits omission of the policy whose default is false. */
export type SemanticCriterionInput = Omit<SemanticCriterion, 'allow_not_applicable'> & {
  readonly allow_not_applicable?: boolean;
};

/** Half-open span in the captured target; the kernel validates bounds and optional quote. */
export interface SemanticEvidenceRef {
  readonly target_digest: string;
  readonly start: number;
  readonly end: number;
  readonly quote?: string;
}

export type SemanticObservationState = 'met' | 'unmet' | 'insufficient_evidence' | 'not_applicable';

export interface SemanticObservation {
  readonly criterion_id: string;
  readonly state: SemanticObservationState;
  readonly value?: boolean | string | number;
  readonly evidence: readonly SemanticEvidenceRef[];
  readonly rationale: string;
}

/** A report is meaningful only against these pinned execution and revision identities. */
export interface SemanticEvaluationBinding {
  readonly gate_id: string;
  readonly node_id: string;
  readonly attempt_id: string;
  readonly definition_digest: string;
  readonly target_digest: string;
}

interface CapturedSemanticTarget {
  readonly kind: 'step_output' | 'artifact';
  readonly id?: string;
  readonly content: string;
}

export interface SemanticEvaluationReport {
  readonly binding: SemanticEvaluationBinding;
  readonly observations: readonly SemanticObservation[];
}

/** Caller-supplied authority; a submitted report cannot supply or replace this context. */
export interface PinnedSemanticEvaluationContext {
  readonly criteria: readonly SemanticCriterion[];
  readonly binding: SemanticEvaluationBinding;
  readonly target: CapturedSemanticTarget;
}
