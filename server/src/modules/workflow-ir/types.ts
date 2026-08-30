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
import type { WorkflowEdge, WorkflowRejection } from './node-schema.js';

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
 * cap than the server allows is rejected, not silently clamped — a clamped run is a run the
 * client did not author. Enforced at the MCP tool boundary (`workflowBudgetSchema`'s
 * `.max(DEFAULT_WORKFLOW_CAPS.*)`, `mcp/tools/schemas/workflow-ir.schema.ts`): the widening
 * rejection formerly lived in {@link validateWorkflowIR} too, but every real ingress reaches the
 * schema first, so that copy was unreachable and was deleted (MEASURED 2026-08-17).
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
  /**
   * BEHAVIOURAL DIAL — not a cap, so there is nothing to narrow. `true` makes a blocking unknown
   * HARD-PAUSE the run on the reserved `__unknown_interrupt__` review instead of continuing into
   * the inserted investigation step (D-2). Default `false`.
   */
  readonly pauseOnBlocking?: boolean;
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
 * How a submitted remainder meets the nodes already on the run.
 *
 * ONE MECHANISM, TWO SPELLINGS (OQ-A1): `append` is also what a `chain_id` call whose command
 * begins with `-->` compiles to, so the two spellings share this vocabulary rather than each
 * carrying a private notion of "add to the end".
 */
type RemainderMode = 'replace' | 'append';

/**
 * A model-authored rewrite of the rest of a RUNNING chain, submitted when a blocking unknown has
 * invalidated the plan's shape.
 *
 * Declared HERE, beside {@link WorkflowIR}, and not in `mcp/tools/schemas/`, for the reason
 * `WorkflowIR` is: the consumers are `engine/` stages and the chain store, and `engine/` may not
 * import `mcp/`. The Zod schema (`prompt-engine.schema.ts`) validates against this shape and a
 * compile-time drift guard there fails `tsc` if the two diverge.
 *
 * The server never authors one — it validates and applies. That is the advisory posture the whole
 * unknowns mechanism keeps: the model declares, the server decides whether the declaration is
 * admissible.
 */
export interface RemainderSubmission {
  readonly mode: RemainderMode;
  /** The replacement (or appended) steps, in declaration order — same vocabulary as {@link WorkflowNode}. */
  readonly nodes: readonly WorkflowNode[];
  /** Dependency assertions among the submitted nodes. Linearized exactly as {@link WorkflowIR.edges} are. */
  readonly edges?: readonly WorkflowEdge[];
}

/**
 * The edge and rejection vocabularies live in {@link ./node-schema.js} and are re-exported here so
 * `types.js` remains this module's one type surface for consumers.
 *
 * WHY THEY MOVED (Tier A). `linearize` consumes both, and `modules/prompts/prompt-schema.ts` now
 * calls it to validate a YAML chain's declared edges. This file type-imports `GateSpecification`
 * from `shared/types/execution.ts`, which type-imports `WorkflowIR` back — a documented, tracked,
 * warn-level cycle. Reaching it from the prompt schema would have pulled that cycle into
 * `cli-shared`'s import graph, where the isolation gate (`tests/unit/cli-shared/
 * import-isolation.test.ts`) requires ZERO violations. `node-schema.ts` imports nothing but Zod,
 * so the linearizer is now cycle-free and the gate keeps its meaning.
 */
export type { WorkflowEdge, WorkflowRejection, WorkflowRejectionReason } from './node-schema.js';

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

/** The visibility item vocabulary, mirroring `VisibilityItemSchema`'s enum values. */
export const WORKFLOW_VISIBILITY_ITEMS: readonly VisibilityItem[] = [
  'previous_step_output',
  'chain_history',
  'unknowns_ledger',
];
