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
 * Five pass-criteria types exist. They differ in WHEN and HOW enforcement
 * happens — picking the right type for a use case is critical.
 *
 * | Type                       | Enforcement                                   | When to use                                                           |
 * |----------------------------|-----------------------------------------------|-----------------------------------------------------------------------|
 * | `inline_guidance`          | **None** — rendered as agent-facing checklist | Soft criteria the agent self-assesses (style, completeness reminders) |
 * | `llm_self_check`           | **Reserved** — runner not yet implemented     | (Not usable today)                                                    |
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
 * - Treating `llm_self_check` as available (it isn't yet — schema accepts it,
 *   no runner exists)
 *
 * For deeper documentation: docs/guides/gates.md (Enforcement Modes section).
 */

import { z } from 'zod/v4';

// ============================================
// Pass Criteria Schema
// ============================================

/**
 * Schema for gate pass criteria definitions.
 *
 * See the file-header taxonomy table for the 5 supported types and their
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
     * - `llm_self_check`: type declared, runner not yet implemented. Reserved.
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
    type: z.enum([
      'inline_guidance',
      'llm_self_check',
      'framework_compliance',
      'shell_verify',
      'script_tool',
    ]),

    // Content check options
    min_length: z.number().int().nonnegative().optional(),
    max_length: z.number().int().positive().optional(),
    required_patterns: z.array(z.string()).optional(),
    forbidden_patterns: z.array(z.string()).optional(),

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

    // LLM self-check options
    prompt_template: z.string().optional(),
    pass_threshold: z.number().min(0).max(1).optional(),

    // Pattern check options
    regex_patterns: z.array(z.string()).optional(),
    keyword_count: z.record(z.string(), z.number()).optional(),

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

export type GatePassCriteriaYaml = z.infer<typeof GatePassCriteriaSchema>;

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
  })
  .passthrough(); // Allow additional fields not in schema for extensibility

export type GateDefinitionYaml = z.infer<typeof GateDefinitionSchema>;

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
    warnings.push('No activation rules - gate will always be active');
  }

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
