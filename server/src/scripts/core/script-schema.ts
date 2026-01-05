// @lifecycle canonical - Zod schemas for script tool YAML validation.
/**
 * Script Tool Schema Definitions
 *
 * Defines Zod schemas for validating script tool YAML configurations.
 * Uses modern deterministic trigger types aligned with industry standards
 * (GitHub Actions, AWS Lambda, Terraform).
 *
 * Trigger Types (deterministic, not probabilistic):
 * - schema_match: Execute when user args validate against schema (default)
 * - explicit: Execute only when user writes tool:<id>
 * - always: Execute on every prompt run regardless of args
 * - never: Tool is defined but disabled
 *
 * @see plans/script-tools-implementation.md
 */

import { z } from 'zod';

// ============================================================================
// Trigger Type Schema (Deterministic - Modern Standards)
// ============================================================================

/**
 * Trigger types for script tool execution.
 *
 * Modern automation systems (GitHub Actions, AWS Lambda, Terraform) use
 * deterministic triggers, not probabilistic confidence scores.
 *
 * - schema_match: Default - runs when args validate against tool's JSON Schema
 * - explicit: Only runs when user explicitly names the tool (tool:<id>)
 * - always: Runs on every prompt execution (logging, metrics, setup)
 * - never: Tool is defined but intentionally disabled (WIP, conditional)
 *
 * Note: 'parameter_match' is deprecated, automatically transformed to 'schema_match'.
 */
export const TriggerTypeSchema = z
  .enum(['schema_match', 'explicit', 'always', 'never', 'parameter_match'])
  .transform((val) => {
    if (val === 'parameter_match') {
      // eslint-disable-next-line no-console -- Intentional deprecation warning
      console.warn(
        "[ScriptSchema] DEPRECATED: 'parameter_match' trigger is deprecated. Use 'schema_match' instead."
      );
      return 'schema_match' as const;
    }
    return val;
  });

export type TriggerTypeYaml = 'schema_match' | 'explicit' | 'always' | 'never';

// ============================================================================
// Execution Mode Schema (DEPRECATED)
// ============================================================================

/**
 * @deprecated ExecutionModeSchema is deprecated.
 * Use `trigger: explicit` instead of `mode: manual`, and `confirm: true` instead of `mode: confirm`.
 * This schema is preserved only for backwards compatibility during migration.
 */
export const ExecutionModeSchema = z.enum(['auto', 'manual', 'confirm']).default('auto');

/** @deprecated Use trigger + confirm instead */
export type ExecutionModeYaml = z.infer<typeof ExecutionModeSchema>;

// ============================================================================
// Execution Config Schema (Consolidated: trigger + confirm)
// ============================================================================

/**
 * Execution configuration for script tools.
 *
 * Configuration precedence (new consolidated system):
 * - `trigger`: Controls WHEN the tool activates (schema_match | explicit | always | never)
 * - `confirm`: Controls WHETHER to ask for confirmation before executing
 * - `strict`: Controls HOW schema matching works (any vs all required params)
 *
 * Migration from deprecated `mode` field:
 * - mode: auto    → (default, no field needed)
 * - mode: manual  → trigger: explicit
 * - mode: confirm → confirm: true
 *
 * Note: Both 'mode' and 'confidence' fields are DEPRECATED and automatically migrated.
 */
export const ExecutionConfigSchema = z
  .object({
    /** Trigger type (default: 'schema_match') */
    trigger: TriggerTypeSchema.optional(),
    /**
     * Require confirmation before execution (default: true)
     * When true, tool detection returns a confirmation prompt before executing.
     * User can bypass confirmation with explicit tool:<id> arg.
     * Set to false explicitly for tools with no side effects.
     */
    confirm: z.boolean().optional().default(true),
    /**
     * Strict matching mode (default: false)
     * - false: Match if ANY required param is present and valid
     * - true: Match only if ALL required params are present and valid
     */
    strict: z.boolean().optional().default(false),
    /** Custom confirmation message (shown when confirm: true) */
    confirmMessage: z.string().optional(),
    /**
     * Auto-approve execution when script validation passes (default: false)
     *
     * When true, the script is executed for validation first. If the script
     * returns `valid: true` with no warnings, confirmation is bypassed and
     * auto_execute proceeds automatically.
     *
     * Behavior based on script output:
     * - valid: true + no warnings → auto-approve, proceed to auto_execute
     * - valid: true + warnings → show warnings, still proceed to auto_execute
     * - valid: false → show errors, block execution
     */
    autoApproveOnValid: z.boolean().optional().default(false),
    /**
     * @deprecated mode is deprecated. Use trigger: explicit instead of mode: manual,
     * and confirm: true instead of mode: confirm.
     * This field is accepted for backwards compatibility and automatically migrated.
     */
    mode: ExecutionModeSchema.optional().transform((val) => {
      if (val !== undefined && val !== 'auto') {
        // eslint-disable-next-line no-console -- Intentional deprecation warning
        console.warn(
          `[ScriptSchema] DEPRECATED: 'mode: ${val}' is deprecated. ` +
            (val === 'manual' ? "Use 'trigger: explicit' instead." : "Use 'confirm: true' instead.")
        );
      }
      return val;
    }),
    /**
     * @deprecated Numeric confidence is deprecated. Use trigger types instead.
     * This field is accepted for backwards compatibility but ignored.
     */
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .transform((val) => {
        if (val !== undefined) {
          // eslint-disable-next-line no-console -- Intentional deprecation warning
          console.warn(
            '[ScriptSchema] DEPRECATED: numeric confidence is deprecated and ignored. ' +
              "Use 'trigger' and 'strict' for deterministic matching."
          );
        }
        return undefined;
      }),
  })
  .optional();

export type ExecutionConfigYaml = {
  trigger?: TriggerTypeYaml;
  confirm?: boolean;
  strict?: boolean;
  confirmMessage?: string;
  autoApproveOnValid?: boolean;
};

// ============================================================================
// Script Runtime Schema
// ============================================================================

/**
 * Runtime environment for script execution.
 */
export const ScriptRuntimeSchema = z.enum(['python', 'node', 'shell', 'auto']).default('auto');

export type ScriptRuntimeYaml = z.infer<typeof ScriptRuntimeSchema>;

// ============================================================================
// Full Script Tool YAML Schema
// ============================================================================

/**
 * Complete schema for tool.yaml files.
 */
export const ScriptToolYamlSchema = z.object({
  /** Unique tool ID (must match directory name) */
  id: z.string().min(1),
  /** Human-readable name for the tool */
  name: z.string().min(1),
  /** Description of what this tool does (can be overridden by description.md) */
  description: z.string().optional(),
  /** Path to executable script (relative to tool directory) */
  script: z.string().min(1),
  /** Runtime to use for execution */
  runtime: ScriptRuntimeSchema.optional(),
  /** Path to JSON Schema file for inputs (default: 'schema.json') */
  schemaFile: z.string().optional(),
  /** Path to description markdown (default: 'description.md') */
  descriptionFile: z.string().optional(),
  /** Execution timeout in milliseconds (default: 30000) */
  timeout: z.number().positive().optional(),
  /** Environment variables to pass to the script */
  env: z.record(z.string()).optional(),
  /** Working directory relative to tool directory */
  workingDir: z.string().optional(),
  /** Whether this tool is enabled (default: true) */
  enabled: z.boolean().optional().default(true),
  /** Execution control configuration */
  execution: ExecutionConfigSchema,
});

export type ScriptToolYaml = z.infer<typeof ScriptToolYamlSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Result of script tool schema validation.
 */
export interface ScriptToolSchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized?: ScriptToolYaml;
}

/**
 * Validate a script tool definition against the schema.
 *
 * @param definition - Raw YAML definition to validate
 * @param expectedId - Expected tool ID (should match directory name)
 * @returns Validation result with errors, warnings, and normalized data
 */
export function validateScriptToolSchema(
  definition: unknown,
  expectedId?: string
): ScriptToolSchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Parse with Zod
  const result = ScriptToolYamlSchema.safeParse(definition);

  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const normalized = result.data;

  // Additional validation: ID matches directory
  if (
    expectedId !== undefined &&
    expectedId !== '' &&
    normalized.id.toLowerCase() !== expectedId.toLowerCase()
  ) {
    warnings.push(
      `Tool ID '${normalized.id}' does not match expected directory name '${expectedId}'`
    );
  }

  // Check for deprecated field usage (already logged by transforms, but add to warnings)
  const raw = definition as Record<string, unknown>;
  const rawExec = raw['execution'];
  if (rawExec !== null && rawExec !== undefined && typeof rawExec === 'object') {
    const exec = rawExec as Record<string, unknown>;
    if (exec['confidence'] !== undefined) {
      warnings.push(
        "Numeric 'confidence' field is deprecated and ignored. Use 'trigger' and 'strict' instead."
      );
    }
    if (exec['trigger'] === 'parameter_match') {
      warnings.push("'parameter_match' trigger is deprecated. Use 'schema_match' instead.");
    }
  }

  return {
    valid: true,
    errors,
    warnings,
    normalized,
  };
}

/**
 * Parse and normalize execution config from YAML.
 *
 * Handles migration from deprecated `mode` field:
 * - mode: manual  → trigger: explicit
 * - mode: confirm → confirm: true
 *
 * @param raw - Raw execution config from YAML
 * @returns Normalized execution config (new schema: trigger + confirm)
 */
export function normalizeExecutionConfig(raw: unknown): ExecutionConfigYaml {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {
      trigger: 'schema_match',
      confirm: true,
      strict: false,
      autoApproveOnValid: false,
    };
  }

  const result = ExecutionConfigSchema.safeParse(raw);
  if (!result.success) {
    return {
      trigger: 'schema_match',
      confirm: true,
      strict: false,
      autoApproveOnValid: false,
    };
  }

  // Result data has transforms applied (confidence removed, parameter_match -> schema_match)
  // After successful parse, result.data is guaranteed to be defined - use non-null assertion
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: result.success guarantees data is defined
  const data = result.data!;

  // Start with new field values
  let trigger = data.trigger ?? 'schema_match';
  let confirm = data.confirm ?? true;

  // Migrate deprecated mode field if present
  if (data.mode !== undefined && data.mode !== 'auto') {
    if (data.mode === 'manual') {
      // mode: manual → trigger: explicit (unless trigger already set)
      if (data.trigger === undefined) {
        trigger = 'explicit';
      }
    } else if (data.mode === 'confirm') {
      // mode: confirm → confirm: true (unless confirm already set)
      if (data.confirm === undefined) {
        confirm = true;
      }
    }
  }

  const config: ExecutionConfigYaml = {
    trigger,
    confirm,
    strict: data.strict ?? false,
    autoApproveOnValid: data.autoApproveOnValid ?? false,
  };

  // Only add confirmMessage if it's a non-empty string
  if (data.confirmMessage !== undefined && data.confirmMessage !== '') {
    config.confirmMessage = data.confirmMessage;
  }

  return config;
}

/**
 * Type guard to check if a value is a valid ScriptToolYaml.
 *
 * @param value - Value to check
 * @returns True if value is valid ScriptToolYaml
 */
export function isValidScriptToolYaml(value: unknown): value is ScriptToolYaml {
  const result = ScriptToolYamlSchema.safeParse(value);
  return result.success;
}
