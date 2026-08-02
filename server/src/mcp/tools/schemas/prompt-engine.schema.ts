// @lifecycle canonical - Hand-written Zod schema for prompt_engine MCP tool (SSOT for validation).
/**
 * Prompt Engine Input Schema
 *
 * Extracted from inline schema in index.ts. This is the SSOT for prompt_engine
 * parameter validation — replaces the generated mcp-schemas.ts.
 *
 * The schema structure is fixed; parameter `.describe()` text is injected via
 * a resolver callback so framework overlays can customize what the LLM sees.
 */

import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Gate sub-schemas (shared with resource_manager)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Description resolver
// ---------------------------------------------------------------------------

/**
 * Callback that resolves parameter descriptions at registration time.
 * Allows framework overlays to inject context-specific guidance.
 */
export type DescriptionResolver = (paramName: string, fallback: string) => string;

const identity: DescriptionResolver = (_name, fallback) => fallback;

// ---------------------------------------------------------------------------
// Default description text
// ---------------------------------------------------------------------------

const PARAM_DEFAULTS = {
  command:
    'Prompt/chain command. PATTERNS: >>prompt_id key="value" (single) | >>s1 --> >>s2 (chain). RESUME: omit command, use chain_id + user_response only.',
  force_restart: 'Create a new chain execution (increments chain ID). Use `command`.',
  chain_id:
    'Resume token (e.g., `chain-demo#2`). RESUME: chain_id + user_response only. Omit command.',
  gate_verdict:
    'Send PASS/FAIL verdicts when resuming after gate reviews (e.g., "GATE_REVIEW: PASS - rationale"). Keep user_response for actual step output.',
  gate_action:
    'User choice after gate retry limit exhaustion. "retry" resets attempt count, "skip" bypasses the gate, "abort" stops execution.',
  user_response:
    'Your Step output to capture before advancing. Supply the same text you would reply with during manual execution.',
  gates:
    'Unified gate specification - Accepts gate IDs (strings), custom checks ({name, description}), or full gate definitions. Supports mixed types in single array for maximum flexibility. Canonical parameter for all gate specification (v3.0.0+).',
  options: 'Additional execution options (key-value pairs) passed through to execution.',
} as const;

// ---------------------------------------------------------------------------
// Schema factory
// ---------------------------------------------------------------------------

/**
 * Build the prompt_engine input schema with framework-aware descriptions.
 *
 * @param verdictValidator - `(v: string) => boolean` for gate_verdict format validation
 * @param verdictMessage - validation error message for gate_verdict
 * @param resolve - optional description resolver for framework overlays
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types
export function buildPromptEngineSchema(
  verdictValidator: (v: string) => boolean,
  verdictMessage: string,
  resolve: DescriptionResolver = identity
) {
  return z.object({
    command: z
      .string()
      .min(1, 'Command cannot be empty')
      .optional()
      .describe(resolve('command', PARAM_DEFAULTS.command)),

    force_restart: z
      .boolean()
      .optional()
      .describe(resolve('force_restart', PARAM_DEFAULTS.force_restart)),

    chain_id: z
      .string()
      .regex(
        /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/,
        'Chain ID must follow format: chain-{prompt} or chain-{prompt}#runNumber'
      )
      .optional()
      .describe(resolve('chain_id', PARAM_DEFAULTS.chain_id)),

    gate_verdict: z
      .string()
      .trim()
      .refine((v) => verdictValidator(v), verdictMessage)
      .optional()
      .describe(resolve('gate_verdict', PARAM_DEFAULTS.gate_verdict)),

    gate_action: z
      .enum(['retry', 'skip', 'abort'])
      .optional()
      .describe(resolve('gate_action', PARAM_DEFAULTS.gate_action)),

    user_response: z
      .string()
      .min(1, 'User response cannot be empty if provided')
      .optional()
      .describe(resolve('user_response', PARAM_DEFAULTS.user_response)),

    gates: z.array(gateSpecUnionSchema).optional().describe(resolve('gates', PARAM_DEFAULTS.gates)),

    options: z
      .record(z.string(), z.any())
      .optional()
      .describe(resolve('options', PARAM_DEFAULTS.options)),
  });
}

/** Inferred input type (uses default descriptions — shape is identical regardless of resolver) */
export type PromptEngineInput = z.infer<ReturnType<typeof buildPromptEngineSchema>>;
