// @lifecycle canonical - Hand-written Zod gate-specification sub-schemas shared across MCP tool surfaces.
/**
 * Gate specification sub-schemas.
 *
 * Extracted from `prompt-engine.schema.ts` (P6 Tier 5) because three schema files now need them:
 * the prompt_engine surface, the resource_manager surface, and `workflow-ir.schema.ts`. The IR
 * schema is what forced the move — it must reuse `gateSpecUnionSchema` rather than re-declare it
 * (re-declaring one vocabulary with no generated linkage is how P7-D1 happened), and importing it
 * from `prompt-engine.schema.ts` while `prompt-engine.schema.ts` imports `workflowIRSchema` would
 * be an ESM import cycle: under a cycle whichever module evaluates second sees `undefined` for the
 * other's exports, so `z.union([undefined, …])` would throw at module load — a failure the type
 * checker cannot see, and one that only shows up when the server starts.
 *
 * This file defines and exports; nothing here re-exports anything, so it is not the compat shim
 * shape `validate:no-crosslayer-reexport` bars. `prompt-engine.schema.ts` re-exports these three
 * names so no existing import path changed.
 */

import { z } from 'zod/v4';

/** Quick inline gate: {name, description} */
export const customCheckSchema = z.object({
  name: z.string().min(1, 'Custom check name cannot be empty'),
  description: z.string().min(1, 'Custom check description cannot be empty'),
});

/** Full gate definition with optional fields */
export const temporaryGateObjectSchema = z
  .object({
    id: z.string().min(1, 'Gate ID cannot be empty').optional(),
    template: z.string().min(1, 'Template reference cannot be empty').optional(),
    name: z.string().optional(),
    type: z.enum(['validation', 'guidance']).optional(),
    scope: z.enum(['execution', 'session', 'chain', 'step']).optional(),
    description: z.string().optional(),
    guidance: z.string().optional(),
    criteria: z.array(z.string().min(1)).optional(),
    pass_criteria: z.array(z.string().min(1)).optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    source: z.enum(['manual', 'automatic', 'analysis']).optional(),
    context: z.record(z.string(), z.any()).optional(),
    target_step_number: z.number().int().positive().optional(),
    /**
     * Address the target step by its stable node id instead of its position. Union ADDITION —
     * `target_step_number` keeps working unchanged, and a gate may carry either. Accepts the
     * kebab-case ids minted from a YAML chain's `stepName`/`id:`, the ids a submitted Workflow IR
     * declares, and the frozen `nK` ids a symbolic chain mints at parse time.
     */
    target_step_id: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$|^n\d+$/,
        'target_step_id must be a kebab-case node id or an nK symbolic id'
      )
      .optional(),
    apply_to_steps: z.array(z.number().int().positive()).optional(),
  })
  .refine(
    (value) => {
      if (value.id != null) return true;
      const hasCriteria =
        (value.criteria?.length ?? 0) > 0 || (value.pass_criteria?.length ?? 0) > 0;
      const hasGuidance =
        (value.guidance?.trim().length ?? 0) > 0 || (value.description?.trim().length ?? 0) > 0;
      return hasCriteria || hasGuidance;
    },
    { message: 'Temporary gate entries require an id or some inline criteria/guidance' }
  );

/** Union of all accepted gate formats */
export const gateSpecUnionSchema = z.union([
  z.string().min(1, 'Gate reference cannot be empty'),
  customCheckSchema,
  temporaryGateObjectSchema,
]);
