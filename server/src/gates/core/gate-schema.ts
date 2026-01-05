// @lifecycle canonical - Single source of truth for gate YAML validation
/**
 * Gate Schema (Zod)
 *
 * Defines the canonical schema for gate.yaml files in /server/gates/{id}/.
 * Used by:
 * - GateDefinitionLoader (runtime validation)
 * - (Future) CI validation scripts
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 *
 * @see methodology-schema.ts for the pattern this follows
 */

import { z } from 'zod';

// ============================================
// Pass Criteria Schema
// ============================================

/**
 * Schema for gate pass criteria definitions.
 * Supports content checks, pattern checks, LLM self-checks, and methodology compliance.
 */
export const GatePassCriteriaSchema = z
  .object({
    /** Type of check to perform */
    type: z.enum(['content_check', 'llm_self_check', 'pattern_check', 'methodology_compliance']),

    // Content check options
    min_length: z.number().int().nonnegative().optional(),
    max_length: z.number().int().positive().optional(),
    required_patterns: z.array(z.string()).optional(),
    forbidden_patterns: z.array(z.string()).optional(),

    // Methodology compliance options
    methodology: z.string().optional(),
    min_compliance_score: z.number().min(0).max(1).optional(),
    severity: z.enum(['warn', 'fail']).optional(),
    quality_indicators: z
      .record(
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
    keyword_count: z.record(z.number()).optional(),
  })
  .passthrough(); // Allow additional fields for extensibility

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
 *   - type: content_check
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
      errorMap: () => ({ message: "Gate type must be 'validation' or 'guidance'" }),
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
     * - 'framework': Methodology-related gates, filtered when frameworks disabled
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
