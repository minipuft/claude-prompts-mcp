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

import { z } from 'zod/v4';

import { SUPPORTED_RUNTIMES } from '#shared/types/automation.js';
import { retirementNotice, type RetirementNotice } from '#shared/utils/retirement-notice.js';

/** The refusal sentence for a retired field, composed from its ledger entry. */
function retiredFieldRefusal(notice: RetirementNotice): string {
  return `${notice.retired} is no longer accepted (retired in ${notice.refusedIn}); use ${notice.replacement}`;
}

/**
 * A field a tool.yaml no longer accepts. Declared only so a document carrying it is refused with
 * the ledger's replacement; the schema would otherwise drop an unknown key without a word.
 */
function retiredField(notice: RetirementNotice): z.ZodOptional<z.ZodNever> {
  return z.never({ error: () => retiredFieldRefusal(notice) }).optional();
}

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
 */
export const TriggerTypeSchema = z.enum(['schema_match', 'explicit', 'always', 'never'], {
  error: (issue) =>
    issue.input === 'parameter_match'
      ? retiredFieldRefusal(retirementNotice('script-tool-trigger-parameter-match'))
      : undefined,
});

// ============================================================================
// Execution Config Schema (trigger + confirm + strict)
// ============================================================================

/**
 * Execution configuration for script tools.
 *
 * - `trigger`: Controls WHEN the tool activates (schema_match | explicit | always | never)
 * - `confirm`: Controls WHETHER to ask for confirmation before executing
 * - `strict`: Controls HOW schema matching works (any vs all required params)
 *
 * `mode` and a numeric `confidence` are retired fields: each is refused with its ledger
 * replacement instead of being dropped.
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
    mode: retiredField(retirementNotice('script-tool-mode')),
    confidence: retiredField(retirementNotice('script-tool-confidence')),
  })
  .optional();

// ============================================================================
// Script Runtime Schema
// ============================================================================

/**
 * Runtime environment for script execution.
 *
 * Enum members derive from `SUPPORTED_RUNTIMES` (`#shared/types/automation.js`), so
 * this schema and the create-path validator cannot disagree about what is valid.
 */
export const ScriptRuntimeSchema = z.enum(SUPPORTED_RUNTIMES).default('auto');

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
  /**
   * Path to a JSON Schema file for the object this tool writes to stdout
   * (default: 'output-schema.json'). Optional, and enforced when present: the executor refuses
   * output that does not match it, naming the tool and the fields that are wrong.
   */
  outputSchemaFile: z.string().optional(),
  /** Path to description markdown (default: 'description.md') */
  descriptionFile: z.string().optional(),
  /** Execution timeout in milliseconds (default: 30000) */
  timeout: z.number().positive().optional(),
  /** Environment variables to pass to the script */
  env: z.record(z.string(), z.string()).optional(),
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

  return {
    valid: true,
    errors,
    warnings,
    normalized,
  };
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
