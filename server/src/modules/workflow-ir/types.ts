// @lifecycle canonical - Pure data types for the planner-submitted Workflow IR (P6 Tier 4).
/**
 * Workflow IR — data types and rejection vocabulary.
 *
 * A Workflow IR is a client-submitted, node-addressed description of a multi-step run. It is
 * NOT a second execution path: the IR is validated, linearized into a total order, and compiled
 * (P6 Tier 5) into the same `ChainStepPrompt[]` / `ChainNode[]` a YAML chain produces.
 *
 * WHY EDGES DO NOT BRANCH (premise correction 1, measured 2026-08-12: zero `dag|acyclic|topolog`
 * hits across `src/`). `chain_run_nodes.position` is a total order and no step type anywhere
 * carries `condition`, `next` or `goto`. Edges therefore express DEPENDENCY, and the linearizer
 * compiles them to an order. Executing them as a graph would need a branching executor that does
 * not exist and would violate the charter's own "no IR-specific execution path" clause.
 *
 * This module holds no state. The prompt lookup the validator needs is INJECTED, never imported,
 * so `validateWorkflowIR` stays a pure function of its arguments.
 */

import type { VisibilityItem } from '#shared/types/chain-execution.js';
import type { GateSpecification } from '#shared/types/execution.js';

/**
 * One node of a submitted workflow.
 *
 * Field-for-field the runtime-consumed subset of `ChainStepSchema` (`modules/prompts/
 * prompt-schema.ts`), deliberately: acceptance clause (d) is "an IR node can carry every step
 * field the runtime actually consumes". Fields the runtime does NOT consume are absent —
 * `delegation` is read only by the skills-sync exporter off raw YAML, so an IR node carrying it
 * would be a field with no reader on this path.
 */
export interface WorkflowNode {
  /**
   * Stable node identity, kebab-case, unique within the IR. Becomes the `ChainNode.id` and is the
   * id space `target_step_id` addresses — the same vocabulary `mintNodeIds` produces for a YAML
   * chain. Required here, unlike `ChainStepSchema.id`: a submitted IR has no `stepName` to slug
   * from as a fallback, and edges address nodes by id.
   */
  readonly id: string;
  /** Prompt this node executes. Existence is checked against the injected lookup. */
  readonly promptId: string;
  /** Display name for the step. Defaults to `promptId` at compile time (Tier 5). */
  readonly stepName?: string;
  /** Arguments for this node's prompt. Checked against the prompt's declared `required` args. */
  readonly args?: Readonly<Record<string, unknown>>;
  /** Map upstream results into this node's variable names. */
  readonly inputMapping?: Readonly<Record<string, string>>;
  /** Publish this node's output under semantic names. */
  readonly outputMapping?: Readonly<Record<string, string>>;
  /** Per-step visibility policy — same vocabulary as `ChainStepSchema.visibility`. */
  readonly visibility?: {
    readonly withhold?: readonly VisibilityItem[];
    readonly expose?: readonly VisibilityItem[];
  };
  /** Capability hint for delegation model selection. */
  readonly subagentModel?: 'heavy' | 'standard' | 'fast';
  /** Host agent to spawn for this node. */
  readonly agentType?: string;
  /** Framework this node runs under, overriding the run-wide selection. */
  readonly framework?: string;
  /** Retry attempts on failure. */
  readonly retries?: number;
  /**
   * Gate ids applied to this node, compiled to the existing `gates` + `target_step_id` channel
   * (OQ-P6-8) — the same channel `ChainStepSchema.inlineGateIds` now feeds.
   */
  readonly inlineGateIds?: readonly string[];
}

/**
 * A dependency assertion: `to` may not run before `from`.
 *
 * NOT control flow. The linearizer consumes edges as ordering constraints and emits a total
 * order; nothing downstream ever sees an edge.
 */
export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * Declared budget.
 *
 * Split by enforcement posture, and the split is the contract (OQ-P6-3). The three structural
 * caps are counted server-side from the submission itself, so they are ENFORCED. A cost ceiling
 * is denominated in tokens the server never observes — the client meters those — so it is
 * RECORDED onto the existing `execution_records` telemetry object and never enforced. Enforcing
 * it would mean enforcing against a server-side estimate, which is the pseudo-quantification D4
 * already rejected.
 *
 * A declared structural cap may only NARROW the server default. A submission asking for a wider
 * cap than the server allows is `cap-exceeded`, not a silent clamp: a clamped run is a run the
 * client did not author.
 */
export interface WorkflowBudget {
  /** ENFORCED — may only narrow {@link DEFAULT_WORKFLOW_CAPS}.maxNodes. */
  readonly maxNodes?: number;
  /** ENFORCED — may only narrow {@link DEFAULT_WORKFLOW_CAPS}.maxFanOut. */
  readonly maxFanOut?: number;
  /** ENFORCED — may only narrow `MAX_INSERTIONS_PER_RUN` (the P4 adaptive-insertion ceiling). */
  readonly maxInsertions?: number;
  /** RECORDED ONLY — never enforced, never compared against a server-side estimate. */
  readonly declaredCostCeiling?: number;
}

/** A submitted workflow. `version` is a literal so a future shape change is a typed discriminant. */
export interface WorkflowIR {
  readonly version: 1;
  readonly nodes: readonly WorkflowNode[];
  readonly edges?: readonly WorkflowEdge[];
  /**
   * Run-level gate bindings. Reuses the existing `gates` union verbatim
   * (`GateSpecification`), so an object entry's `target_step_id` addresses a node id declared
   * above and needs no IR-specific gate channel.
   */
  readonly gates?: readonly GateSpecification[];
  readonly budget?: WorkflowBudget;
}

/**
 * Named rejection reasons.
 *
 * A vocabulary, not a boolean plus a message — mirroring `MutationNoneReason`
 * (`decisions/mutation/types.ts:23`) and `PatchRejection` (P7 `template-patch.ts`). Acceptance
 * clause (b) requires rejections to be ACTIONABLE, which means addressed: every rejection names
 * the node or edge it is about.
 *
 * `ambiguous-order` was authored into this vocabulary by the plan (§Interfaces) and is
 * DELIBERATELY ABSENT — see {@link linearize}. Kahn's algorithm with a total tiebreak has no
 * ambiguous case to report, so the member would have had no producer, which is the
 * declaration-dead shape `validate:no-phantom-columns` exists to catch one table over.
 */
export type WorkflowRejectionReason =
  | 'empty-workflow'
  /**
   * The submission carried a workflow AND another command source (`command` or `chain_id`).
   *
   * Produced by the stage that owns request shape (`04-parsing-stage.ts`), not by
   * {@link validateWorkflowIR} — the validator is a pure function of ONE IR and cannot see the
   * rest of the request. It belongs in this vocabulary anyway because it reaches the client
   * through the same addressed-rejection channel, and a second rejection shape for one class of
   * client error is how error text drifts apart.
   */
  | 'mutually-exclusive-source'
  | 'duplicate-node-id'
  | 'invalid-node-id'
  | 'unknown-prompt'
  | 'edge-endpoint-missing'
  | 'cycle'
  | 'cap-exceeded'
  | 'gate-target-missing'
  | 'required-argument-missing'
  | 'unknown-visibility-item';

/** One addressed rejection. At least one of `nodeId` / `edge` is set for every reason but the two run-level ones. */
export interface WorkflowRejection {
  readonly reason: WorkflowRejectionReason;
  /** The node this rejection is about, when it is about one. */
  readonly nodeId?: string;
  /** The edge this rejection is about, when it is about one. */
  readonly edge?: WorkflowEdge;
  /** Human-readable detail. Names the offending value and the rule it violated. */
  readonly detail: string;
}

/** Discriminated result of validation or linearization. `order` is the linearized node ids. */
export type WorkflowValidation =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly rejections: readonly WorkflowRejection[] };

/**
 * What the validator needs to know about a referenced prompt.
 *
 * One lookup rather than the plan's two callbacks (`promptExists` + an argument accessor):
 * `unknown-prompt` and `required-argument-missing` are answered from the same registry entry,
 * and two callbacks would let a caller wire them to two different registries — the drift class
 * this module exists downstream of.
 */
export interface WorkflowPromptInfo {
  /** Names of arguments the prompt declares `required: true`. */
  readonly requiredArguments: readonly string[];
}

/** Structural caps the server enforces. A submission's `budget` may narrow these, never widen. */
export interface WorkflowCaps {
  readonly maxNodes: number;
  readonly maxFanOut: number;
  readonly maxInsertions: number;
}

/**
 * Server defaults.
 *
 * `maxInsertions` mirrors `MAX_INSERTIONS_PER_RUN` rather than importing it: `modules/` may
 * value-import `engine/`, but tying the IR's declared submission ceiling to the runtime's
 * adaptive-mutation ceiling would make a change to one silently retune the other. The validator
 * asserts the relationship instead (a declared value may only narrow), and a drift test pins the
 * two numbers together so the mirror cannot rot silently.
 */
export const DEFAULT_WORKFLOW_CAPS: WorkflowCaps = {
  maxNodes: 32,
  maxFanOut: 8,
  maxInsertions: 3,
};

/**
 * Node-id vocabulary: kebab-case, the same shape `mintNodeIds` derives from a YAML chain's
 * `stepName`.
 *
 * `temporaryGateObjectSchema.target_step_id` accepts this pattern OR the `n\d+` symbolic form.
 * The second alternative is deliberately not repeated here — and MEASURED (2026-08-13) to be
 * redundant if it were: `n1` already matches kebab-case, so the two alternatives overlap and no
 * regex here can exclude the symbolic form. Nothing is lost by that: the symbolic `nK` ids are
 * minted per run by the symbolic parser, and an IR submission and a symbolic parse are never the
 * same run, so there is no id space to collide with.
 */
export const WORKFLOW_NODE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The visibility item vocabulary, mirroring `VisibilityItemSchema`'s enum values. */
export const WORKFLOW_VISIBILITY_ITEMS: readonly VisibilityItem[] = [
  'previous_step_output',
  'chain_history',
  'unknowns_ledger',
];
