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
 * REUSE, NOT RE-DECLARATION. `gateSpecUnionSchema` comes from `gate-spec.schema.ts`; the node,
 * edge and budget schemas come from `modules/workflow-ir/node-schema.ts`, which is Layer 3
 * precisely so the YAML loader can value-import the same objects (Tier A — one step vocabulary,
 * three inputs). Re-declaring either is exactly how P7-D1 happened — a second copy of one
 * vocabulary with no generated linkage. The `mcp/tools/ must not value-import resource schemas`
 * architecture rule exempts `src/mcp/tools/schemas/` for this reason (`.dependency-cruiser.cjs`,
 * `pathNot`).
 *
 * Only `workflowIRSchema` is declared here now: it composes `gateSpecUnionSchema`, a Layer 4
 * object, so it is the one part of the IR shape that cannot move down. The three imported
 * schemas are re-exported so `mcp/tools/schemas/index.ts` and its consumers keep one import site
 * for the tool-surface vocabulary.
 */

import { z } from 'zod/v4';

import { gateSpecUnionSchema } from './gate-spec.schema.js';

import type { WorkflowIR } from '#modules/workflow-ir/types.js';

import {
  DEFAULT_WORKFLOW_CAPS,
  workflowBudgetSchema,
  workflowEdgeSchema,
  workflowNodeSchema,
} from '#modules/workflow-ir/node-schema.js';

export { workflowBudgetSchema, workflowEdgeSchema, workflowNodeSchema };

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
