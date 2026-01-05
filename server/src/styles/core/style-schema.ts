// @lifecycle canonical - Single source of truth for style YAML validation
/**
 * Style Schema (Zod)
 *
 * Defines the canonical schema for style.yaml files in /server/styles/{id}/.
 * Used by:
 * - StyleDefinitionLoader (runtime validation)
 * - (Future) CI validation scripts
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 *
 * @see gate-schema.ts for the pattern this follows
 */

import { z } from 'zod';

// ============================================
// Activation Schema
// ============================================

/**
 * Schema for style activation rules.
 */
export const StyleActivationSchema = z
  .object({
    /** Prompt categories that trigger this style */
    prompt_categories: z.array(z.string()).optional(),
    /** Framework contexts that trigger this style */
    framework_context: z.array(z.string()).optional(),
    /** If true, style only activates when explicitly requested */
    explicit_request: z.boolean().optional(),
  })
  .partial();

export type StyleActivationYaml = z.infer<typeof StyleActivationSchema>;

// ============================================
// Main Style Definition Schema
// ============================================

/**
 * Schema for style.yaml files.
 *
 * @example
 * ```yaml
 * id: analytical
 * name: Analytical Response Style
 * description: Systematic analysis with data-driven reasoning
 * guidanceFile: guidance.md
 * enabled: true
 *
 * activation:
 *   prompt_categories: [analysis, research]
 * ```
 */
export const StyleDefinitionSchema = z
  .object({
    // Required core fields
    /** Unique identifier for the style (must match directory name) */
    id: z.string().min(1, 'Style ID is required'),
    /** Human-readable name */
    name: z.string().min(1, 'Style name is required'),
    /** Description of what this style provides */
    description: z.string().min(1, 'Style description is required'),

    // File references (inlined by loader)
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.string().optional(),
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.string().optional(),

    // Optional configuration
    /** Priority for style selection (higher = preferred) */
    priority: z.number().default(0),
    /** Whether this style is enabled */
    enabled: z.boolean().default(true),

    // Enhancement options
    /** How to apply guidance: prepend, append, or replace */
    enhancementMode: z.enum(['prepend', 'append', 'replace']).default('prepend'),

    // Activation rules
    /** Rules determining when this style should be auto-applied */
    activation: StyleActivationSchema.optional(),

    // Framework compatibility
    /** Which frameworks this style works well with */
    compatibleFrameworks: z.array(z.string()).optional(),
  })
  .passthrough(); // Allow additional fields for extensibility

export type StyleDefinitionYaml = z.infer<typeof StyleDefinitionSchema>;

// ============================================
// Validation Utilities
// ============================================

/**
 * Result of style schema validation.
 */
export interface StyleSchemaValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (blocking issues) */
  errors: string[];
  /** Validation warnings (non-blocking issues) */
  warnings: string[];
  /** Parsed data if validation passed */
  data?: StyleDefinitionYaml;
}

/**
 * Validate a style definition against the schema.
 *
 * @param data - Raw YAML data to validate
 * @param expectedId - Expected ID (should match directory name)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const yaml = await loadYamlFile('styles/analytical/style.yaml');
 * const result = validateStyleSchema(yaml, 'analytical');
 * if (result.valid) {
 *   console.log('Style definition:', result.data);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function validateStyleSchema(
  data: unknown,
  expectedId?: string
): StyleSchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Schema validation
  const result = StyleDefinitionSchema.safeParse(data);
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
  if (!definition.guidance && !definition.guidanceFile) {
    warnings.push('Style has no guidance or guidanceFile - will provide no guidance');
  }

  const validationResult: StyleSchemaValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.length === 0) {
    validationResult.data = definition;
  }

  return validationResult;
}

/**
 * Check if a value is a valid style definition.
 * Simpler check without detailed error messages.
 *
 * @param data - Value to check
 * @returns true if data is a valid style definition
 */
export function isValidStyleDefinition(data: unknown): data is StyleDefinitionYaml {
  return StyleDefinitionSchema.safeParse(data).success;
}
