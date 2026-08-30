// @lifecycle canonical - The ONE Zod source for a chain step / IR node, shared by YAML and IR ingress.
/**
 * Step vocabulary — one schema, three inputs (Tier A).
 *
 * A YAML chain's `chainSteps[]`, a submitted Workflow IR's `nodes[]`, and a `-->` symbolic chain
 * all describe the same thing: a step. Before Tier A they were validated by two hand-written Zod
 * objects (`ChainStepSchema` in `modules/prompts/prompt-schema.ts` and `workflowNodeSchema` in
 * `mcp/tools/schemas/workflow-ir.schema.ts`) that merely AGREED — field-for-field equality
 * maintained by nobody, with no gate to notice when one side gained a field. This module is that
 * one source; `ChainStepSchema` is now DERIVED from {@link workflowNodeSchema}, so a field added
 * here reaches YAML automatically and divergence is structurally impossible in that direction.
 *
 * WHY LAYER 3 AND NOT `mcp/tools/schemas/`. The schema had to be importable as a VALUE by
 * `modules/prompts/` (the loader) and by `mcp/tools/schemas/` (the tool surface). `modules/` may
 * not import `mcp/` ('modules-no-mcp', severity error), so the only placement that serves both is
 * this layer. `workflowIRSchema` itself stays at Layer 4 because it composes `gateSpecUnionSchema`,
 * which lives there.
 *
 * WHY THE VISIBILITY VOCABULARY MOVED HERE TOO. It was defined in `prompt-schema.ts` and imported
 * by the IR schema. With the dependency reversed, leaving it there would be a cycle
 * (`no-circular`, severity error). It is a step-level vocabulary, so it belongs beside the step
 * schema; `prompt-schema.ts` re-imports it for the two prompt-level schemas that still name it.
 *
 * THE TWO DELIBERATE DELTAS between a node and a YAML chain step, both about identity and both
 * declared at the derivation site rather than here:
 *
 *   - `id` is REQUIRED on a node and OPTIONAL on a YAML step. Edges address nodes by id and a
 *     submission has nothing to derive one from; a YAML step has `stepName`, which `mintNodeIds`
 *     slugifies at parse time.
 *   - `stepName` is OPTIONAL on a node and REQUIRED on a YAML step, for the mirror reason.
 *
 * Anything else that differs is drift, and `tests/unit/workflow-ir/chain-node-parity.test.ts`
 * fails on it.
 */

import { z } from 'zod/v4';

/**
 * A named item of chain-run context a step's `visibility` declaration can withhold from or
 * expose to that step's render. Mirrors `VisibilityItem` in `shared/types/chain-execution.ts`
 * (SSOT for the type) — kept as a literal Zod enum because Zod needs runtime values.
 */
export const VisibilityItemSchema = z.enum([
  'previous_step_output',
  'chain_history',
  'unknowns_ledger',
]);

/**
 * Per-step visibility policy, consumed by `decideVisibility` at render time. An item may appear in
 * `withhold` or `expose`; mutual exclusivity is not validated — expose is only meaningful against
 * a PRIOR step's withhold, so the same item in both is a no-op, not an error.
 */
export const StepVisibilitySchema = z
  .object({
    withhold: z.array(VisibilityItemSchema).optional(),
    expose: z.array(VisibilityItemSchema).optional(),
  })
  .strict();

export type StepVisibilityYaml = z.infer<typeof StepVisibilitySchema>;

/**
 * Structural caps the server enforces. A submission's `budget` may narrow these, never widen —
 * widening is rejected at the Zod schema boundary (`workflow-ir.schema.ts`), not here.
 */
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
 * adaptive-mutation ceiling would make a change to one silently retune the other. The Zod schema
 * asserts the relationship instead (a declared value may only narrow — `workflowBudgetSchema`'s
 * `.max()` bound), and a drift test pins the two numbers together so the mirror cannot rot
 * silently.
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

/** Node identity — kebab-case. See {@link WORKFLOW_NODE_ID_PATTERN} for why there is no second alternative. */
export const workflowNodeIdSchema = z
  .string()
  .min(1, 'Node id cannot be empty')
  .regex(
    WORKFLOW_NODE_ID_PATTERN,
    'Node id must be kebab-case (lowercase alphanumeric, hyphen-separated)'
  );

/**
 * One step, in whichever of the three inputs declared it.
 *
 * `.strict()` for the reason both predecessors were: every field here is consumed downstream, so
 * a key that is not here cannot take effect no matter what the author intended, and Zod's default
 * strip makes that failure invisible (`framwork: ReACT` used to parse to a normal-looking step).
 *
 * A field added here must be carried at EVERY stripper on the YAML path — `normalizeChainSteps`
 * (`yaml-prompt-loader.ts`) and the stage-04 projection — or it is silently dead (P6-F7).
 */
export const workflowNodeSchema = z
  .object({
    id: workflowNodeIdSchema,
    promptId: z.string().min(1, 'Step promptId is required'),
    stepName: z.string().min(1).optional(),
    /**
     * Static arguments declared for this step.
     *
     * On the YAML path these OVERRIDE the run's invocation arguments for this step only — a
     * declared constant beats what the caller happened to pass, which is the whole point of
     * declaring it on the step. Upstream step results still arrive through `inputMapping`.
     */
    args: z.record(z.string(), z.unknown()).optional(),
    /** Map upstream results into this step's variable names. */
    inputMapping: z.record(z.string(), z.string()).optional(),
    /** Publish this step's output under semantic names. */
    outputMapping: z.record(z.string(), z.string()).optional(),
    /** Per-step visibility policy. */
    visibility: StepVisibilitySchema.optional(),
    /** Client-agnostic capability hint for delegation model selection. */
    subagentModel: z.enum(['heavy', 'standard', 'fast']).optional(),
    /** Host agent to spawn for this step, overriding the prompt-level default. */
    agentType: z.string().min(1).optional(),
    /**
     * Bare string, not an enum — frameworks are registry-resolved and
     * `frameworkManager.getFramework(id)` is the only authority on validity (project CLAUDE.md).
     * An unknown id resolves to the run-wide framework at `12-framework-stage.ts` rather than
     * failing the load, because a framework that was renamed should degrade, not make the whole
     * prompt unloadable.
     */
    framework: z.string().min(1).optional(),
    /** Retry attempts on failure. */
    retries: z.number().int().nonnegative().optional(),
    /**
     * Gate ids applied to this step, compiled to the existing `gates` + `target_step_id` channel
     * (OQ-P6-8). Read by `GateEnhancementService.enhanceChainSteps` at rank `inline-operator`.
     * An id naming no registered gate is NOT filtered here — every other gate source behaves the
     * same way.
     */
    inlineGateIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** A dependency edge. Not control flow — the linearizer compiles edges to a total order. */
export const workflowEdgeSchema = z
  .object({
    from: workflowNodeIdSchema,
    to: workflowNodeIdSchema,
  })
  .strict();

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

/**
 * Declared budget.
 *
 * The three structural caps are bounded HERE at the server defaults as well as in the validator.
 * That is not redundancy for its own sake: the schema is what a client sees in `tools/list`, and
 * a ceiling a client can read is worth more than one it discovers by rejection. The validator
 * still enforces them, because it is callable without the schema.
 *
 * `declaredCostCeiling` carries no upper bound at all — it is RECORDED onto the existing
 * `execution_records` telemetry object and never enforced (OQ-P6-3), so a bound on it would be a
 * limit on a number nothing acts upon.
 */
export const workflowBudgetSchema = z
  .object({
    maxNodes: z.number().int().positive().max(DEFAULT_WORKFLOW_CAPS.maxNodes).optional(),
    maxFanOut: z.number().int().positive().max(DEFAULT_WORKFLOW_CAPS.maxFanOut).optional(),
    maxInsertions: z
      .number()
      .int()
      .nonnegative()
      .max(DEFAULT_WORKFLOW_CAPS.maxInsertions)
      .optional(),
    declaredCostCeiling: z.number().positive().optional(),
  })
  .strict();

/**
 * The field names {@link workflowNodeSchema} declares.
 *
 * Exported so the parity test can compare it against `ChainStepSchema`'s keys by VALUE rather
 * than by a hand-maintained list — a hand-maintained list is the thing that drifted.
 */
export const WORKFLOW_NODE_FIELDS: readonly string[] = Object.freeze(
  Object.keys(workflowNodeSchema.shape).sort()
);

/**
 * Keys a chain step may carry in YAML that are NOT part of the step vocabulary, stripped before
 * validation rather than declared.
 *
 * `delegation` is the only member and is an EXPORTER marker: the sole reader is the skills-sync
 * exporter (`modules/skills-sync/service.ts`), which loads prompt YAML with `yaml.load(raw)` and
 * never passes it through this schema. The execution runtime has never read it — do not confuse
 * it with `ChainStepPrompt.delegated`, which the pipeline sets from `subagentModel` and `==>`.
 *
 * Declaring it on the node schema instead would put a field with no runtime reader into the IR
 * and into `-->`, where nothing could ever export it. Rejecting it would fail the load of YAML
 * the exporter provably honours. Stripping is the only option that leaves both readers correct.
 */
export const EXPORTER_ONLY_STEP_KEYS: readonly string[] = Object.freeze(['delegation']);
