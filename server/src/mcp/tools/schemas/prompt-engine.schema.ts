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

import { gateSpecUnionSchema } from './gate-spec.schema.js';
import { workflowIRSchema } from './workflow-ir.schema.js';

import type { GateVerdictSubmission } from '#engine/gates/core/gate-verdict-renderer.js';

import { CHAIN_ID_FORMAT_MESSAGE, CHAIN_ID_PATTERN } from '#shared/utils/chain-id-codec.js';

// ---------------------------------------------------------------------------
// Gate sub-schemas (defined in gate-spec.schema.ts; shared with resource_manager
// and workflow-ir.schema.ts, which is why they no longer live here — see that
// file's header for the import-cycle this split avoids)
// ---------------------------------------------------------------------------

export {
  customCheckSchema,
  temporaryGateObjectSchema,
  gateSpecUnionSchema,
} from './gate-spec.schema.js';

// ---------------------------------------------------------------------------
// Unknowns ledger observations (Tier 1 — types + validation only, no runtime yet)
// ---------------------------------------------------------------------------

/** Kebab-case slug, stable within a run. */
const unknownIdSchema = z
  .string()
  .min(1, 'Unknown id cannot be empty')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Unknown id must be kebab-case (e.g. "cache-ttl-unknown")');

/** Opens a ledger entry for a newly-surfaced unknown. */
export const unknownDiscoveredSchema = z.object({
  type: z.literal('unknown_discovered'),
  id: unknownIdSchema,
  statement: z.string().min(1, 'Unknown statement cannot be empty'),
  blocking: z.boolean().optional(),
  /**
   * Address a downstream step by its stable node id — the mutation policy's skip target when
   * this unknown later resolves `irrelevant`. Union ADDITION: existing callers that omit it are
   * unaffected. Accepts the kebab-case ids minted from a YAML chain's `stepName`/`id:` and the
   * frozen `nK` ids a symbolic chain mints at parse time — same vocabulary and regex as
   * {@link temporaryGateObjectSchema}'s `target_step_id`, since both address one node id space.
   */
  target_step_id: z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$|^n\d+$/,
      'target_step_id must be a kebab-case node id or an nK symbolic id'
    )
    .optional(),
});

/** Closes an existing ledger entry. `statement` carries the resolution statement. */
export const unknownResolvedSchema = z.object({
  type: z.literal('unknown_resolved'),
  id: unknownIdSchema,
  statement: z.string().min(1, 'Unknown statement cannot be empty'),
  resolution: z.enum(['answered', 'irrelevant']),
});

/** One typed observation about a run-scoped unknown. */
export const unknownObservationSchema = z.discriminatedUnion('type', [
  unknownDiscoveredSchema,
  unknownResolvedSchema,
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
  // Was "Create a new chain execution (increments chain ID). Use `command`." — which pointed at the
  // one path where the flag changes nothing: a plain `command` already mints a new chain id, so
  // true and absent were indistinguishable there (plan row 0.5.16). Both real behaviours are now
  // stated, and both are asserted in chain-lifecycle.yaml.
  force_restart:
    "Start a new execution instead of resuming. Cannot be combined with 'chain_id'. Redundant with a plain 'command'; it matters when the command text itself carries a chain id.",
  chain_id:
    'Resume token (e.g., `chain-demo#2`). RESUME: chain_id + user_response only. Omit command.',
  cancel:
    "Stop the run named by 'chain_id' and block further progression. Requires 'chain_id'; nothing else is read. Distinct from 'force_restart': cancel ENDS this run and starts nothing, while force_restart abandons it and immediately begins a new one. The session's state and artifacts survive a cancel — remove them with system_control(action:\"session\", operation:\"clear\").",
  gate_verdict:
    'Gate review result when resuming. PREFERRED (structured, cannot be malformed): {overall:"PASS"|"FAIL", rationale:"...", per_gate:[{index:1, passed:true, rationale:"..."}]}. Also accepts the legacy string "GATE_REVIEW: PASS - rationale". Rationales are single-line. Keep user_response for actual step output.',
  gate_action:
    'User choice after gate retry limit exhaustion. "retry" resets attempt count, "skip" bypasses the gate, "abort" stops execution.',
  user_response:
    'Your Step output to capture before advancing. Supply the same text you would reply with during manual execution.',
  gates:
    'Unified gate specification - Accepts gate IDs (strings), custom checks ({name, description}), or full gate definitions. Supports mixed types in single array for maximum flexibility. Canonical parameter for all gate specification (v3.0.0+).',
  options: 'Additional execution options (key-value pairs) passed through to execution.',
  workflow:
    'Submit a structured multi-step run instead of a command string. MUTUALLY EXCLUSIVE with `command` and `chain_id` — sending more than one is rejected. SHAPE: {version:1, nodes:[{id:"kebab-case", promptId:"...", args?:{}, inputMapping?:{}, outputMapping?:{}, visibility?:{withhold?:["chain_history"|"previous_step_output"|"unknowns_ledger"], expose?:[...]}, subagentModel?:"heavy"|"standard"|"fast", agentType?:"...", framework?:"...", retries?:0, inlineGateIds?:["gate-id"]}], edges?:[{from:"node-a", to:"node-b"}], gates?:[...same as `gates`, target_step_id addresses a node id...], budget?:{maxNodes?:<=32, maxFanOut?:<=8, maxInsertions?:<=3, declaredCostCeiling?:<number>}}. EDGES ARE DEPENDENCIES, NOT BRANCHES: they are linearized (Kahn, ties broken by declaration order) into one run order; with no edges the order is `nodes[]` as written. Structural caps are enforced and may only be narrowed; `declaredCostCeiling` is recorded, never enforced. An invalid workflow is rejected with one addressed line per problem and NOTHING is created — no run, no session. Example: {version:1, nodes:[{id:"research", promptId:"research_docs"},{id:"draft", promptId:"write_summary"}], edges:[{from:"research", to:"draft"}]}',
  observations:
    'Declare typed unknowns discovered/resolved this step. Each entry: {type:"unknown_discovered"|"unknown_resolved", id:"kebab-case-slug", statement:"...", blocking?:true|false, target_step_id?:"...", resolution?:"answered"|"irrelevant"} (resolution required when type is unknown_resolved; target_step_id is discovered-only and names the downstream step the adaptive mutation policy skips if this unknown resolves irrelevant). Example: [{type:"unknown_discovered", id:"cache-ttl-unknown", statement:"TTL for the new cache layer is undecided", blocking:false, target_step_id:"draft-outline"}]',
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

    // Lives here rather than on `system_control` because of which id the caller holds: a
    // `chain_id` is held BECAUSE you are running the chain, and stopping the run you are in is
    // part of running it. `system_control session` keeps list/inspect/clear, which are operator
    // work across runs you are not in and are keyed on `session_id` from a listing.
    cancel: z.boolean().optional().describe(resolve('cancel', PARAM_DEFAULTS.cancel)),

    user_response: z
      .string()
      .min(1, 'User response cannot be empty if provided')
      .optional()
      .describe(resolve('user_response', PARAM_DEFAULTS.user_response)),

    options: z
      .record(z.string(), z.any())
      .optional()
      .describe(resolve('options', PARAM_DEFAULTS.options)),

    observations: z
      .array(unknownObservationSchema)
      .optional()
      .describe(resolve('observations', PARAM_DEFAULTS.observations)),

    /**
     * The third command source (P6 Tier 5, OQ-P6-1). A CORE field, never gate-dependent:
     * the IR shape depends on no runtime state, so it is never narrowed and therefore can never
     * be silently stripped from a client's call the way a withdrawn parameter is (P6-F6 —
     * narrowing drops a value rather than rejecting it, because Zod's strip default is kept).
     */
    workflow: workflowIRSchema.optional().describe(resolve('workflow', PARAM_DEFAULTS.workflow)),
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
    return withSourceExclusivity(z.object(buildCoreFields(resolve)));
  }

  return withSourceExclusivity(buildWidestSchema(resolve, verdictValidator, verdictMessage));
}

/** The three command sources, in the order the rejection message names them. */
const COMMAND_SOURCE_PARAMETERS = ['command', 'chain_id', 'workflow'] as const;

/**
 * Reject a call that carries more than one command source.
 *
 * A REJECTION, not a precedence rule. The three sources mean three different runs — parse this
 * string, resume that run, execute this graph — and picking one silently would execute something
 * the caller did not ask for. The narrowing path (`gateSystemEnabled === false`) gets the same
 * refinement because exclusivity has nothing to do with gates, and a rule applied to one
 * reachable shape and not the other is a rule with a hole in it.
 *
 * Applied here rather than folded into `buildWidestSchema` so `PromptEngineInput` keeps inferring
 * from the unrefined object: a refinement does not change the inferred type, but deriving the
 * public type from the refined schema would tie the declared contract to a runtime check.
 *
 * The stage-04 twin of this check is not redundant — it guards the in-process callers that never
 * pass through this schema. See `collectSourceConflicts` there.
 */
function withSourceExclusivity<
  T extends z.ZodType<{ [K in (typeof COMMAND_SOURCE_PARAMETERS)[number]]?: unknown }>,
>(schema: T): T {
  return schema.refine(
    (value) => COMMAND_SOURCE_PARAMETERS.filter((name) => value[name] !== undefined).length <= 1,
    {
      message:
        "Provide exactly one of 'command', 'chain_id' or 'workflow'. A workflow submission is a complete run description and cannot be combined with a command string or a resume token.",
    }
  );
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
