// @lifecycle canonical - Hand-written Zod schema for the Workflow IR (SSOT for validation).
/**
 * Workflow IR Input Schema.
 *
 * The validation SSOT for a submitted workflow, per `.claude/rules/mcp-contracts.md`:
 * hand-written Zod validates, `tooling/contracts/workflow-ir.json` carries descriptions and
 * parameter metadata, and `_generated/` is never edited. Same split every existing tool uses;
 * OQ-P6-10 fixes that idiom for resource-shape contracts too.
 *
 * ITS OWN FILE, not a block inside `prompt-engine.schema.ts`. That file's one responsibility is
 * the prompt_engine tool surface — a factory whose shape depends on runtime state. The IR shape
 * depends on no runtime state at all (Verify-Path 7: `workflow` is never narrowed, so it can
 * never be silently stripped, P6-F6). Two responsibilities with different lifetimes.
 *
 * REUSE, NOT RE-DECLARATION. `gateSpecUnionSchema` comes from `gate-spec.schema.ts` and
 * `VisibilityItemSchema` from `modules/prompts/prompt-schema.ts`. Re-declaring either is exactly
 * how P7-D1 happened — a second copy of one vocabulary with no generated linkage. The
 * `mcp/tools/ must not value-import resource schemas` architecture rule exempts
 * `src/mcp/tools/schemas/` for this reason (`.dependency-cruiser.cjs`, `pathNot`).
 */

import { z } from 'zod/v4';

import { gateSpecUnionSchema } from './gate-spec.schema.js';

import { VisibilityItemSchema } from '#modules/prompts/prompt-schema.js';
import {
  DEFAULT_WORKFLOW_CAPS,
  WORKFLOW_NODE_ID_PATTERN,
  type WorkflowIR,
} from '#modules/workflow-ir/types.js';

/** Node identity — kebab-case. See {@link WORKFLOW_NODE_ID_PATTERN} for why there is no second alternative. */
const workflowNodeIdSchema = z
  .string()
  .min(1, 'Node id cannot be empty')
  .regex(
    WORKFLOW_NODE_ID_PATTERN,
    'Node id must be kebab-case (lowercase alphanumeric, hyphen-separated)'
  );

/** Per-node visibility, reusing the shipped item vocabulary rather than restating it. */
const workflowVisibilitySchema = z
  .object({
    withhold: z.array(VisibilityItemSchema).optional(),
    expose: z.array(VisibilityItemSchema).optional(),
  })
  .strict();

/**
 * One node.
 *
 * `.strict()` for the same reason `ChainStepSchema` is (`prompt-schema.ts:108-129`): every field
 * here is consumed downstream, so a key that is not here cannot take effect no matter what the
 * author intended, and Zod's default strip makes that failure invisible. On a NEW surface the
 * usual cost of strictness — breaking YAML that used to load — is zero.
 */
export const workflowNodeSchema = z
  .object({
    id: workflowNodeIdSchema,
    promptId: z.string().min(1, 'Node promptId is required'),
    stepName: z.string().min(1).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    inputMapping: z.record(z.string(), z.string()).optional(),
    outputMapping: z.record(z.string(), z.string()).optional(),
    visibility: workflowVisibilitySchema.optional(),
    subagentModel: z.enum(['heavy', 'standard', 'fast']).optional(),
    agentType: z.string().min(1).optional(),
    /**
     * Bare string, not an enum — frameworks are registry-resolved and
     * `frameworkManager.getFramework(id)` is the only authority on validity (project CLAUDE.md).
     * Same posture as `ChainStepSchema.framework`.
     */
    framework: z.string().min(1).optional(),
    retries: z.number().int().nonnegative().optional(),
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

/** A submitted workflow. */
export const workflowIRSchema = z
  .object({
    version: z.literal(1),
    nodes: z
      .array(workflowNodeSchema)
      .min(1, 'A workflow must declare at least one node')
      .max(DEFAULT_WORKFLOW_CAPS.maxNodes),
    edges: z.array(workflowEdgeSchema).optional(),
    gates: z.array(gateSpecUnionSchema).optional(),
    budget: workflowBudgetSchema.optional(),
  })
  .strict();

export type WorkflowIRInput = z.infer<typeof workflowIRSchema>;

/**
 * Drift guard between the Zod shape and the module's TypeScript shape.
 *
 * Never executed — it exists so `tsc` fails on divergence rather than a test catching it later,
 * the same device `prompt-engine.schema.ts:170` uses for the gate-verdict renderer. A field
 * added to one side and not the other is the P6-F7 stripper failure in miniature.
 */
const _schemaMatchesModuleType: WorkflowIR = undefined as unknown as WorkflowIRInput;
void _schemaMatchesModuleType;
