// @lifecycle canonical - Single source of truth for gate YAML validation
/**
 * Gate Schema (Zod)
 *
 * Defines the canonical schema for gate.yaml files in /server/gates/{id}/.
 * Used by:
 * - GateDefinitionLoader (runtime validation)
 * - (Future) CI validation scripts
 *
 * This ensures SSOT — any schema change is enforced everywhere.
 *
 * @see framework-schema.ts for the pattern this follows
 *
 * ## Gate Enforcement Modes (taxonomy)
 *
 * Four pass-criteria types exist. They differ in WHEN and HOW enforcement
 * happens — picking the right type for a use case is critical.
 *
 * | Type                       | Enforcement                                   | When to use                                                           |
 * |----------------------------|-----------------------------------------------|-----------------------------------------------------------------------|
 * | `inline_guidance`          | **None** — rendered as agent-facing checklist | Soft criteria the agent self-assesses (style, completeness reminders) |
 * | `framework_compliance`     | **None** — auto-passed by GateValidator       | Declares intent only. PhaseGuardVerificationStage enforces framework phase guards      |
 * |                            | (see gate-validator.ts default branch)        | from `phases.yaml`, independently of this criteria type              |
 * | `shell_verify`             | **Hard** — runs shell command, exit 0 = pass  | Ground-truth checks: tests passing, files existing, content claims    |
 * |                            | (supports `shell_stdin_source: agent_response`) | matching reality (file paths, line counts, symbol locations)        |
 * | `script_tool`              | **Hard** — resolves the id to a registered    | Checks needing typed arguments and an explained verdict               |
 * |                            | tool and runs it with JSON stdin, parsing     |                                                                       |
 * |                            | `{passed, reason?}`. Runs beside              |                                                                       |
 * |                            | `shell_verify`; fails closed when it cannot   |                                                                       |
 *
 * Common mistakes the taxonomy prevents:
 * - Using `inline_guidance` and expecting auto-enforcement (it's display only)
 * - Using `shell_verify` to validate codebase state when the agent's CLAIM
 *   is what needs checking — set `shell_stdin_source: agent_response` for that
 * - `llm_self_check` never had a runner and is not a valid `type`; use
 *   `inline_guidance` (reminder) or `shell_verify`/`script_tool` (check)
 *
 * For deeper documentation: docs/guides/gates.md (Enforcement Modes section).
 */

import { z } from 'zod/v4';

import { ARTIFACT_KINDS } from '../utils/artifact-kinds.js';

// ============================================
// Pass Criteria Schema
// ============================================

/**
 * Schema for gate pass criteria definitions.
 *
 * See the file-header taxonomy table for the 4 supported types and their
 * enforcement modes. The `type` field's JSDoc below repeats the table at the
 * point of use (LLMs picking a type at YAML-authoring time read it there).
 */
export const GatePassCriteriaSchema = z
  .object({
    /**
     * Type of check to perform.
     *
     * Enforcement modes (what each type actually does at runtime):
     * - `inline_guidance`: rendered as agent-facing guidance text for
     *   self-assessment. NOT auto-enforced against output. Replaces the
     *   previously-named `content_check` and `pattern_check` (which were
     *   intentionally skipped by GateValidator — see gate-validator.ts).
     * - `framework_compliance`: declarative only. GateValidator has no branch
     *   for it, so it falls through to the auto-pass default. PhaseGuardVerificationStage does
     *   check section presence + min_length + forbidden_terms, but it triggers
     *   on the active framework's `phases.yaml` guards — not on this value.
     * - `shell_verify`: runs `shell_command`, exit 0 = pass. Hard enforcement.
     *   Supports `shell_stdin_source: 'agent_response'` for response-content
     *   verification against ground truth.
     * - `script_tool`: resolves `script_tool_id` against the registered script tools
     *   and runs that tool with JSON input via stdin, parsing a structured
     *   `{passed, reason?}` verdict. Runs beside `shell_verify` during gate review.
     *   Fails closed when it cannot run; a criterion with no id is refused at load.
     */
    type: z.enum(['inline_guidance', 'framework_compliance', 'shell_verify', 'script_tool'], {
      error: () =>
        '`llm_self_check` never had a runner; use `inline_guidance` (reminder) or ' +
        '`shell_verify`/`script_tool` (check)',
    }),

    // NOTE: min_length, max_length, required_patterns, forbidden_patterns, regex_patterns,
    // and keyword_count are deliberately NOT declared here. They never had an evaluator —
    // they rendered as reminder prose and never gated anything (B9) — so they are refused
    // at load rather than accepted and silently ignored. `validateGateSchema` below reads
    // them off `.passthrough()`'s extra keys and errors, naming the field and the fix: move
    // the sentence into guidance.md (reminder) or use shell_verify/script_tool (check).

    // Framework compliance options
    framework: z.string().optional(),
    min_compliance_score: z.number().min(0).max(1).optional(),
    severity: z.enum(['warn', 'fail']).optional(),
    quality_indicators: z
      .record(
        z.string(),
        z.object({
          keywords: z.array(z.string()).optional(),
          patterns: z.array(z.string()).optional(),
        })
      )
      .optional(),

    // Shell verification options (ground-truth validation via exit code)
    /**
     * Command to execute for verification, as argv (exit 0 = pass).
     *
     * An ARRAY, not a string, since 2026-08-29. A string was joined into
     * `sh -c '<string>'`, so the shell parsed whatever the gate author wrote — and a
     * gate file is exactly what an attacker drops into a workspace. That made the
     * operator's allowlist a check on TEXT rather than on a command: a prefix entry
     * like `npm *` had to be defended by enumerating shell metacharacters, and an
     * enumeration is only ever as good as its last review.
     *
     * argv is the structural version of that guarantee, and it is the same move this
     * codebase already made for resource writes — assert the property (`assertPathInside`)
     * instead of enumerating the vectors. `["npm", "test"]` cannot become two commands.
     *
     * It does NOT make a shell unreachable: `["sh", "-c", "..."]` is still expressible.
     * That is deliberate and remains bounded by `MCP_SHELL_VERIFY_ALLOWLIST`, where the
     * operator can see it and has to have chosen it.
     */
    shell_command: z
      .array(z.string(), {
        // The type error is what an author migrating a gate actually sees, and zod's
        // default ("expected array, received string") states the shape without the
        // reason or the fix. This is the only surface that reaches them.
        error:
          'shell_command must be an argv array, e.g. ["npm", "test"]. A bare string is no ' +
          'longer accepted: it was handed to `sh -c`, so the shell parsed whatever the gate ' +
          'author wrote. Use ["sh", "-c", "..."] if you genuinely need a shell.',
      })
      .nonempty()
      .optional(),
    /** Timeout in milliseconds for shell command (default: 300000) */
    shell_timeout: z.number().int().positive().optional(),
    /** Working directory for shell command execution */
    shell_working_dir: z.string().optional(),
    /** Additional environment variables for shell command */
    shell_env: z.record(z.string(), z.string()).optional(),
    /** Maximum verification attempts before escalation (default: 5) */
    shell_max_attempts: z.number().int().positive().optional(),
    /** Preset for shell verification (:fast, :full, :extended) */
    shell_preset: z.enum(['fast', 'full', 'extended']).optional(),
    /**
     * Inject agent response into the shell command. When set to 'agent_response',
     * the current execution context's user_response is piped to stdin (truncated
     * to SHELL_VERIFY_MAX_RESPONSE_BYTES). Scripts parse claims from stdin and
     * verify against ground truth (e.g., file existence, line counts, symbols).
     */
    shell_stdin_source: z.enum(['agent_response']).optional(),
    /**
     * Optional env var name to receive the agent response (alternative to stdin).
     * When set together with `shell_stdin_source: 'agent_response'`, the response
     * is also exported as this env var so scripts can re-read it without buffering.
     */
    shell_response_env_var: z.string().optional(),

    // Script tool verification options (structured JSON pass/fail)
    /** Script or command to execute for verification */
    script_tool_id: z.string().optional(),
    /** JSON input sent via stdin to the script */
    script_tool_input: z.record(z.string(), z.unknown()).optional(),
    /** Timeout in milliseconds for script execution (default: 30000) */
    script_tool_timeout: z.number().int().positive().optional(),
    /** Working directory for script execution */
    script_tool_working_dir: z.string().optional(),
  })
  .passthrough() // Allow additional fields for extensibility
  .superRefine((criteria, ctx) => {
    // A criteria type whose required field is missing cannot be enforced, and a gate
    // that cannot enforce a criterion it declares is worse than a gate with no criterion:
    // it reads as verified. Refuse at load, where the author is looking, rather than
    // failing closed mid-review where they are not.
    if (
      criteria.type === 'shell_verify' &&
      (!Array.isArray(criteria.shell_command) ||
        criteria.shell_command.length === 0 ||
        isBlank(criteria.shell_command[0]))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shell_command'],
        message:
          "shell_verify criteria require 'shell_command' as a non-empty argv array, e.g. " +
          '["npm", "test"]. A bare string is no longer accepted: it was passed to `sh -c`, ' +
          'so the shell parsed it and the operator allowlist could only defend that by ' +
          'enumerating metacharacters.',
      });
    }
    if (criteria.type === 'script_tool' && isBlank(criteria.script_tool_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['script_tool_id'],
        message:
          "script_tool criteria require a non-empty 'script_tool_id' naming a registered script tool (not a shell command)",
      });
    }
  });

/** A string field is absent, empty, or whitespace — three ways to declare nothing. */
function isBlank(value: string | undefined): boolean {
  return value == null || value.trim() === '';
}

/**
 * The shape of one `pass_criteria` entry as written in a `gate.yaml`.
 *
 * `z.input`, not `z.infer`: this names the file's shape, which is the parser's INPUT side, and
 * `GateDefinitionLoader` hands consumers the raw parsed YAML rather than zod's output — it
 * validates with `validateGateSchema` and discards `result.data`. Typing consumers with the
 * output side would tell them a defaulted field is always present on an object that never went
 * through `parse`, which is how a real `?? 'medium'` guard reads as dead code.
 */
export type GatePassCriteriaYaml = z.input<typeof GatePassCriteriaSchema>;

// ============================================
// Activation Schema
// ============================================

/**
 * Schema for gate activation rules.
 */
export const GateActivationSchema = z
  .object({
    /** Prompt categories that trigger this gate */
    prompt_categories: z.array(z.string()).optional(),
    /** If true, gate only activates when explicitly requested */
    explicit_request: z.boolean().optional(),
    /** Framework contexts that trigger this gate */
    framework_context: z.array(z.string()).optional(),
    /**
     * Artifact kinds this gate checks (ruling B13).
     *
     * When present, ARTIFACTS DECIDE: the gate attaches iff the run declares one of these kinds,
     * and `prompt_categories` is ignored entirely. Categories remain the fallback only for gates
     * that name no artifact — a gate that names both is stating what it checks twice, and the
     * artifact statement is the specific one.
     *
     * The vocabulary's only home is `engine/gates/utils/artifact-kinds.ts`, which also owns the
     * path table that classifies a run's files into these kinds.
     */
    artifacts: z.array(z.enum(ARTIFACT_KINDS)).min(1).optional(),
  })
  .partial();

export type GateActivationYaml = z.infer<typeof GateActivationSchema>;

// ============================================
// Retry Config Schema
// ============================================

/**
 * Schema for gate retry configuration.
 */
export const GateRetryConfigSchema = z
  .object({
    /** Maximum number of retry attempts */
    max_attempts: z.number().int().positive().default(2),
    /** Whether to provide improvement hints on retry */
    improvement_hints: z.boolean().default(true),
    /** Whether to preserve context between retries */
    preserve_context: z.boolean().default(true),
  })
  .partial();

export type GateRetryConfigYaml = z.infer<typeof GateRetryConfigSchema>;

// ============================================
// Judge Evaluation Schema
// ============================================

/**
 * Schema for a gate's `evaluation` key — the per-gate half of judge routing.
 *
 * Declared here rather than left to `.passthrough()`: `gate-loader.ts` copies this key onto
 * `LightweightGateDefinition` and `review-utils.ts` resolves it against the global defaults, so
 * it is load-bearing at runtime. A passthrough-only key is typed `unknown` and validated by
 * nothing, which is how a gate.yaml with `evaluation: { mode: judgee }` used to load clean and
 * then silently fall back to self-review.
 *
 * Kept structurally identical to `JudgeEvaluationConfig` (`../judge/types.js`), which is the
 * consumer-side spelling of the same object.
 *
 * Not exported, unlike the three sibling sub-schemas above: nothing outside this file parses an
 * `evaluation` block on its own, and an export nothing imports is what the knip ratchet counts.
 * Export it when a caller exists.
 */
const GateJudgeEvaluationSchema = z.object({
  /** Evaluation mode: 'self' (LLM reviews its own output) or 'judge' (context-isolated sub-agent) */
  mode: z.enum(['self', 'judge']),
  /** Model hint for the judge sub-agent (e.g. 'haiku' for cheap evaluation) */
  model: z.string().optional(),
  /** Use strict "find failures first" framing (default: true when mode is 'judge') */
  strict: z.boolean().optional(),
});

// ============================================
// Main Gate Definition Schema
// ============================================

/**
 * Schema for gate.yaml files.
 *
 * @example
 * ```yaml
 * id: code-quality
 * name: Code Quality Standards
 * type: validation
 * description: Ensures generated code follows best practices
 * severity: medium
 * gate_type: category
 * guidanceFile: guidance.md
 *
 * pass_criteria:
 *   - type: inline_guidance
 *     min_length: 100
 *
 * activation:
 *   prompt_categories: [code, development]
 * ```
 */
export const GateDefinitionSchema = z
  .object({
    // Required core fields
    /** Unique identifier for the gate (must match directory name) */
    id: z.string().min(1, 'Gate ID is required'),
    /** Human-readable name */
    name: z.string().min(1, 'Gate name is required'),
    /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
    type: z.enum(['validation', 'guidance'], {
      error: () => "Gate type must be 'validation' or 'guidance'",
    }),
    /** Description of what this gate checks/guides */
    description: z.string().min(1, 'Gate description is required'),
    /**
     * Free kebab-case tag naming what this gate reminds about (e.g. `code-quality`,
     * `security`). An installation's `gates.harnessCovers` (config.json) suppresses
     * reminders whose subject it lists; checks (`shell_verify`/`script_tool`) are never
     * suppressed regardless of subject. Surfaced by the generated gate index so an
     * operator can copy the exact spelling into `harnessCovers`.
     */
    subject: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'subject must be kebab-case: lowercase letters, digits, and hyphens only, e.g. "code-quality"'
      )
      .optional(),

    // Optional severity and enforcement
    /** Severity level for prioritization */
    severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    /** Enforcement mode override (defaults to severity-based mapping) */
    enforcementMode: z.enum(['blocking', 'advisory', 'informational']).optional(),
    /**
     * Gate type classification for dynamic identification.
     * - 'framework': Framework-related gates, filtered when frameworks disabled
     * - 'category': Category-based gates (code, documentation, etc.)
     * - 'custom': User-defined custom gates
     */
    gate_type: z.enum(['framework', 'category', 'custom']).default('custom'),

    // File references (inlined by loader)
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.string().optional(),
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.string().optional(),

    // Validation configuration
    /** Pass/fail criteria for validation gates */
    pass_criteria: z.array(GatePassCriteriaSchema).optional(),
    /** Retry configuration for failed validations */
    retry_config: GateRetryConfigSchema.optional(),

    // Activation rules
    /** Rules determining when this gate should be activated */
    activation: GateActivationSchema.optional(),

    /**
     * When true, a FAIL verdict from this gate suppresses the execution response content —
     * only the gate review instructions are returned. For critical gates where invalid
     * output should not reach the user.
     *
     * @default false
     */
    blockResponseOnFail: z.boolean().optional(),

    /**
     * Judge evaluation configuration. When `mode` is 'judge', gate review is delegated to a
     * context-isolated sub-agent instead of self-review.
     */
    evaluation: GateJudgeEvaluationSchema.optional(),
  })
  .passthrough(); // Allow additional fields not in schema for extensibility

/**
 * The single source for a gate.yaml's shape.
 *
 * Read this as the type of a gate definition everywhere: `types/gate-guide-types.ts` re-exports
 * it under the same name, so the thirteen consumers that import it from `../types.js` and the
 * loaders that produce it are describing one object, not two that agree by hand. A field added
 * to `GateDefinitionSchema` above reaches every consumer; a field added to a consumer's own copy
 * would not have reached the validator, which is how `subject` (row 0.2) and the six pattern/
 * length fields (row 1.5) each had to be edited in two places.
 *
 * Two consequences of deriving rather than declaring, both deliberate:
 * - `z.input`, not `z.infer`. A gate.yaml is the parser's INPUT, and that is what consumers
 *   actually hold: `GateDefinitionLoader` returns the raw YAML object and validates it beside,
 *   discarding `result.data`, so zod's `.default()` for `severity` and `gate_type` has NOT been
 *   applied to the object a consumer reads. On the output side both fields are required, which
 *   would mark every real `?? 'medium'` fallback as dead code and invite deleting it.
 * - `.passthrough()` puts an `unknown` index signature on the type, so a key this schema does
 *   not declare is reachable only as `definition['key']` and only as `unknown`. That is the
 *   pressure that keeps a load-bearing key declared here: `evaluation` and `blockResponseOnFail`
 *   were passthrough-only and read at runtime anyway, which is exactly the gap this SSOT closes.
 */
export type GateDefinitionYaml = z.input<typeof GateDefinitionSchema>;

// ============================================
// Validation Utilities
// ============================================

/**
 * Result of gate schema validation.
 */
export interface GateSchemaValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (blocking issues) */
  errors: string[];
  /** Validation warnings (non-blocking issues) */
  warnings: string[];
  /** Parsed data if validation passed */
  data?: GateDefinitionYaml;
}

/**
 * Validate a gate definition against the schema.
 *
 * @param data - Raw YAML data to validate
 * @param expectedId - Expected ID (should match directory name)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const yaml = await loadYamlFile('gates/code-quality/gate.yaml');
 * const result = validateGateSchema(yaml, 'code-quality');
 * if (result.valid) {
 *   console.log('Gate definition:', result.data);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function validateGateSchema(data: unknown, expectedId?: string): GateSchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Schema validation
  const result = GateDefinitionSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const definition = result.data;

  // ID must match directory name (if expectedId provided)
  if (expectedId !== undefined && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }

  // Warnings for recommended fields
  if (definition.type === 'validation' && !definition.pass_criteria?.length) {
    warnings.push('Validation gate has no pass_criteria defined - will always pass');
  }

  if (definition.type === 'guidance' && !definition.guidance && !definition.guidanceFile) {
    warnings.push('Guidance gate has no guidance or guidanceFile - will provide no guidance');
  }

  if (!definition.activation) {
    warnings.push(
      'No activation rules - gate is opt-in and attaches only when a prompt or chain step includes it'
    );
  }

  // Pattern/length fields have no evaluator: they never gated anything (B9), so they are
  // no longer declared on GatePassCriteriaSchema and are refused at load rather than
  // accepted and silently ignored. They still reach here as `.passthrough()` extra keys,
  // which is why the lookup below goes through an index signature instead of the typed field.
  const REJECTED_CRITERIA_FIELDS = [
    'required_patterns',
    'forbidden_patterns',
    'regex_patterns',
    'keyword_count',
    'min_length',
    'max_length',
  ] as const;
  definition.pass_criteria?.forEach((criterion, index) => {
    const rawCriterion = criterion as Record<string, unknown>;
    for (const field of REJECTED_CRITERIA_FIELDS) {
      if (rawCriterion[field] !== undefined) {
        errors.push(
          `pass_criteria[${index}].${field} is not evaluated by any runner and is no longer ` +
            'accepted; move the sentence into guidance.md (reminder) or use shell_verify/' +
            'script_tool (check)'
        );
      }
    }
  });

  const resultPayload = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.length === 0) {
    return {
      ...resultPayload,
      data: definition,
    };
  }

  return resultPayload;
}

/**
 * Check if a value is a valid gate definition.
 * Simpler check without detailed error messages.
 *
 * @param data - Value to check
 * @returns true if data is a valid gate definition
 */
export function isValidGateDefinition(data: unknown): data is GateDefinitionYaml {
  return GateDefinitionSchema.safeParse(data).success;
}
