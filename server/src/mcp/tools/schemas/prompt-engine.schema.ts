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

import { CHAIN_ID_FORMAT_MESSAGE, CHAIN_ID_PATTERN } from '#shared/utils/chain-id-codec.js';

import type { GateVerdictSubmission } from '#engine/gates/core/gate-verdict-renderer.js';

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
// Gate verdict submission (structured alternative to the formatted string)
// ---------------------------------------------------------------------------

/**
 * A rationale that survives a render/parse round trip unchanged.
 *
 * `parseGateVerdict` reads only the first non-empty line and its pattern's
 * `(.+)$` has no `s` flag, so an embedded newline would truncate the rationale
 * silently. Rejecting here is deliberate: the renderer could collapse newlines
 * instead, but that would quietly rewrite the reviewer's words — the same class
 * of loss the structured form exists to remove.
 */
const singleLineRationale = z
  .string()
  .trim()
  .min(1, 'Rationale cannot be empty')
  .regex(/^[^\r\n]+$/, 'Rationale must be a single line — no line breaks');

/** One gate's result. `index` is 1-based, matching the advertised gate list. */
export const gateVerdictEntrySchema = z.object({
  index: z.number().int().positive('Gate index is 1-based'),
  passed: z.boolean(),
  rationale: singleLineRationale,
});

/**
 * A structured gate review.
 *
 * The formatted-string form remains accepted, but a client using this one
 * cannot submit an unparseable verdict: there is no format to get wrong, so
 * the five fallback patterns never come into play.
 */
export const gateVerdictSubmissionSchema = z.object({
  overall: z.enum(['PASS', 'FAIL']),
  rationale: singleLineRationale,
  per_gate: z.array(gateVerdictEntrySchema).optional(),
});

/**
 * The schema and the renderer's input type must stay in step: the renderer is
 * what turns a submission into the string the parser reads, so a field the
 * schema accepted but the renderer did not know about would be dropped without
 * any error. This assignment is never executed — it exists so `tsc` fails on
 * that drift rather than a test catching it later.
 */
const _schemaMatchesRenderer: GateVerdictSubmission = undefined as unknown as z.infer<
  typeof gateVerdictSubmissionSchema
>;
void _schemaMatchesRenderer;

// ---------------------------------------------------------------------------
// Tool surface resolution
// ---------------------------------------------------------------------------

/**
 * Callback that resolves parameter descriptions at registration time.
 * Allows framework overlays to inject context-specific guidance.
 */
export type DescriptionResolver = (paramName: string, fallback: string) => string;

const identity: DescriptionResolver = (_name, fallback) => fallback;

/**
 * The runtime state the *shape* of the tool surface depends on.
 *
 * Only state that changes what a client may legitimately send belongs here.
 * Description text varies far more freely and goes through {@link DescriptionResolver}
 * instead — a narrowed shape rejects calls, so the bar for entry is higher.
 */
export interface ToolSurfaceState {
  /**
   * The gate system master switch (`GateManager.isGateSystemEnabled()`).
   *
   * When it is off, `GateService` short-circuits both `getGuidanceText` and
   * `validateContent` for every gate id regardless of which source contributed
   * it, so the three gate parameters have no reachable effect and are omitted.
   *
   * Deliberately NOT the `gatesConfig.enableFrameworkGates` switch. That one is
   * a veto over the `framework-guide` rank only: it withholds gates the server
   * loads from the active framework, and never touches what a client supplies
   * through `gates`. Reading it here would strip a parameter that still works.
   */
  readonly gateSystemEnabled: boolean;
}

/**
 * How a caller customizes the tool surface for the current runtime state.
 *
 * Both halves are optional and independent: `describe` rewrites text without
 * touching structure, `state` narrows structure without touching text.
 */
export interface ToolSurfaceResolver {
  /** Framework-aware description overlay. Defaults to the built-in text. */
  readonly describe?: DescriptionResolver;
  /**
   * Runtime state driving the shape. Omitted means "widest surface", matching
   * `isGateSystemEnabled()`, which defaults to enabled when no store is wired.
   */
  readonly state?: ToolSurfaceState;
}

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
    'Gate review result when resuming. PREFERRED (structured, cannot be malformed): {overall:"PASS"|"FAIL", rationale:"...", per_gate:[{index:1, passed:true, rationale:"..."}]}. Also accepts the legacy string "GATE_REVIEW: PASS - rationale". Rationales are single-line. Keep user_response for actual step output.',
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
 * Parameters present in every reachable shape.
 *
 * Split from the gate parameters so that widening is one `extend` rather than a
 * branch per field — the shape decision stays in one place and this function
 * has none.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildCoreFields(resolve: DescriptionResolver) {
  return {
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
      .regex(CHAIN_ID_PATTERN, CHAIN_ID_FORMAT_MESSAGE)
      .optional()
      .describe(resolve('chain_id', PARAM_DEFAULTS.chain_id)),

    user_response: z
      .string()
      .min(1, 'User response cannot be empty if provided')
      .optional()
      .describe(resolve('user_response', PARAM_DEFAULTS.user_response)),

    options: z
      .record(z.string(), z.any())
      .optional()
      .describe(resolve('options', PARAM_DEFAULTS.options)),
  };
}

/**
 * Parameters that exist only while the gate system is enabled.
 *
 * These three are the whole of the tool's gate surface a client can drive:
 * `gates` contributes at the `temporary-request` rank, and the two resume
 * parameters answer a gate review already in flight.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildGateFields(
  resolve: DescriptionResolver,
  verdictValidator: (v: string) => boolean,
  verdictMessage: string
) {
  return {
    gates: z.array(gateSpecUnionSchema).optional().describe(resolve('gates', PARAM_DEFAULTS.gates)),

    // Structured branch first: a client sending an object gets its own
    // validation errors rather than "expected string", which is what it would
    // see if the legacy branch were tried first and reported the union failure.
    gate_verdict: z
      .union([
        gateVerdictSubmissionSchema,
        z
          .string()
          .trim()
          .refine((v) => verdictValidator(v), verdictMessage),
      ])
      .optional()
      .describe(resolve('gate_verdict', PARAM_DEFAULTS.gate_verdict)),

    gate_action: z
      .enum(['retry', 'skip', 'abort'])
      .optional()
      .describe(resolve('gate_action', PARAM_DEFAULTS.gate_action)),
  };
}

/**
 * The widest reachable shape — every parameter any state can advertise.
 *
 * Kept as its own function rather than derived from {@link buildPromptEngineSchema}
 * because that one's return type is the union of its two branches, and
 * `z.infer` distributes over a union: consumers would face
 * `{…} | {…, gates?}` and lose property access on the gate fields.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function buildWidestSchema(
  resolve: DescriptionResolver,
  verdictValidator: (v: string) => boolean,
  verdictMessage: string
) {
  return z
    .object(buildCoreFields(resolve))
    .extend(buildGateFields(resolve, verdictValidator, verdictMessage));
}

/**
 * Build the prompt_engine input schema for the current runtime state.
 *
 * This is a pure function of `surface`, evaluated at construction, and that
 * purity is load-bearing rather than stylistic. `createMcpHandler` calls the
 * server factory once per HTTP request, so a design that instead *mutated* a
 * registered tool would pass its STDIO test and silently no-op over HTTP. Here
 * every HTTP request rebuilds from current state, and the STDIO path — whose
 * one instance outlives a state change — calls this again and hands the result
 * to `RegisteredTool.update({ paramsSchema })`.
 *
 * Calling it twice with equal state yields an equal schema; nothing is cached
 * or carried between calls.
 *
 * Narrowing withdraws a parameter from what is *advertised*. It does not add a
 * rejection: Zod strips unknown keys by default and that default is kept, so a
 * client holding a stale `tools/list` has its leftover value dropped rather
 * than erroring. That matches the runtime, which already ignores gate ids from
 * every source while the gate system is off.
 *
 * @param verdictValidator - `(v: string) => boolean` for gate_verdict format validation
 * @param verdictMessage - validation error message for gate_verdict
 * @param surface - description overlay and the state the shape depends on
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types
export function buildPromptEngineSchema(
  verdictValidator: (v: string) => boolean,
  verdictMessage: string,
  surface: ToolSurfaceResolver = {}
) {
  const resolve = surface.describe ?? identity;

  // Absent state means "widest", matching `isGateSystemEnabled()`, which
  // defaults to enabled when no gate state store is wired.
  if (surface.state?.gateSystemEnabled === false) {
    return z.object(buildCoreFields(resolve));
  }

  return buildWidestSchema(resolve, verdictValidator, verdictMessage);
}

/**
 * Inferred input type — the widest reachable shape.
 *
 * This is the declared public contract per the semver ruling recorded in
 * `CLAUDE.md`: a state change narrows *within* this union and is not breaking;
 * adding or removing a member of the union is. Handlers type against it so they
 * compile once rather than once per reachable shape, which is sound because
 * narrowing only ever omits keys that are already optional.
 */
export type PromptEngineInput = z.infer<ReturnType<typeof buildWidestSchema>>;
