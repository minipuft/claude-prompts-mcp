// @lifecycle canonical - Dependency-free gate review contracts shared by runtime and calibration.

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
  readonly allow_not_applicable?: boolean | undefined;
};

/** Half-open span in the captured target; the kernel validates bounds and optional quote. */
export interface SemanticEvidenceRef {
  readonly target_digest: string;
  readonly start: number;
  readonly end: number;
  readonly quote?: string | undefined;
}

export type SemanticObservationState = 'met' | 'unmet' | 'insufficient_evidence' | 'not_applicable';

export interface SemanticObservation {
  readonly criterion_id: string;
  readonly state: SemanticObservationState;
  readonly value?: boolean | string | number | undefined;
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
  readonly id?: string | undefined;
  readonly content: string;
}

export interface SemanticEvaluationReport {
  readonly binding: SemanticEvaluationBinding;
  readonly observations: readonly SemanticObservation[];
  /** Optional client claim; absence means unknown, and identity supplies no acceptance authority. */
  readonly reviewer?: {
    readonly provenance: 'client_reported' | 'unknown';
    readonly provider?: string | undefined;
    readonly model?: string | undefined;
    readonly revision?: string | undefined;
    readonly context?: 'self' | 'separate_pass' | 'isolated_judge' | 'unknown' | undefined;
  };
}

/** One gate's result within a submission. */
export interface GateVerdictEntry {
  /** 1-based position in the gate list the response advertised. */
  readonly index: number;
  readonly passed: boolean;
  readonly rationale: string;
  /** Structured evidence travels separately from the display rationale. */
  readonly evaluation?: SemanticEvaluationReport;
}

/** One reminder-tier gate the reviewer declares inapplicable, with the reason. */
export interface GateVerdictReminderExemption {
  readonly id: string;
  readonly reason: string;
}

/**
 * The whole attestation for a review's reminder-tier gates — one field, not one entry per gate
 * (ruling B4).
 *
 * A reminder has no evaluator, so a per-gate rationale for one is the model grading its own
 * output: nine measured dispatches produced five "not applicable" rationales per run and caught
 * nothing. `satisfied` lists the ids the reviewer attests to; `not_applicable` carries the ids
 * that did not apply, each with its reason, because "n/a" without one is the same empty token
 * the per-gate slots were collecting.
 */
export interface GateVerdictReminders {
  readonly satisfied: readonly string[];
  readonly not_applicable: readonly GateVerdictReminderExemption[];
}

/** A complete gate review, structured rather than formatted. */
export interface GateVerdictSubmission {
  readonly overall: 'PASS' | 'FAIL';
  readonly rationale: string;
  /** Omitted when the review is a single overall verdict. */
  readonly per_gate?: readonly GateVerdictEntry[] | undefined;
  /** Omitted when the review advertised no reminder-tier gates. */
  readonly reminders?: GateVerdictReminders | undefined;
}

/** Caller-supplied authority; a submitted report cannot supply or replace this context. */
export interface PinnedSemanticEvaluationContext {
  readonly criteria: readonly SemanticCriterion[];
  readonly binding: SemanticEvaluationBinding;
  readonly target: CapturedSemanticTarget;
}

export interface SemanticEvaluationIssue {
  readonly code: string;
  readonly message: string;
  readonly criterion_id?: string;
}
export interface SemanticCriterionResult {
  readonly criterion_id: string;
  readonly state: SemanticObservationState | 'invalid';
  readonly valid: boolean;
  readonly passed: boolean;
  readonly issues: readonly SemanticEvaluationIssue[];
}
export interface SemanticEvaluationResult {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly issues: readonly SemanticEvaluationIssue[];
  readonly criteria: readonly SemanticCriterionResult[];
}

/**
 * Evaluation mode for a gate.
 * - 'self': Current default — LLM evaluates its own output (same context)
 * - 'judge': Context-isolated evaluation via delegation to a sub-agent
 */
export type JudgeEvaluationMode = 'self' | 'judge';

/**
 * Resolved judge config after merging gate-level and global defaults.
 * All fields are required (defaults applied).
 */
export interface ResolvedJudgeConfig {
  readonly mode: JudgeEvaluationMode;
  readonly model: string | undefined;
  readonly strict: boolean;
}
