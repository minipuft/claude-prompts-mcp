// @lifecycle canonical - Single source of truth for methodology YAML validation
/**
 * Methodology Schema (Zod)
 *
 * Defines the canonical schema for methodology YAML files.
 * Used by both:
 * - RuntimeMethodologyLoader (runtime validation)
 * - validate-methodologies.js (CI validation)
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 */

import { z } from 'zod';

// ============================================
// Gate Schema
// ============================================
export const MethodologyGateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  methodologyArea: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  validationCriteria: z.array(z.string()).optional(),
  criteria: z.array(z.string()).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
});

export type MethodologyGate = z.infer<typeof MethodologyGateSchema>;

// ============================================
// Template Suggestion Schema
// ============================================
export const TemplateSuggestionSchema = z.object({
  section: z.enum(['system', 'user']),
  type: z.enum(['addition', 'structure', 'modification']),
  description: z.string().optional(), // Description of the suggestion
  content: z.string().optional(), // Suggested content to add
  methodologyJustification: z.string().optional(), // Why this aligns with methodology
  impact: z.enum(['high', 'medium', 'low']).optional(),
});

export type TemplateSuggestion = z.infer<typeof TemplateSuggestionSchema>;

// ============================================
// Main Methodology Schema
// ============================================
export const MethodologySchema = z
  .object({
    // Required core fields
    id: z.string().min(1),
    name: z.string().min(1),
    methodology: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+/, 'Must be semver format (e.g., 1.0.0)'),
    enabled: z.boolean(),

    // Optional description
    description: z.string().optional(),

    // Gate configuration
    gates: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      })
      .optional(),
    methodologyGates: z.array(MethodologyGateSchema).optional(),

    // File references (validated separately for existence)
    phasesFile: z.string().optional(),
    judgePromptFile: z.string().optional(),

    // Guidance
    systemPromptGuidance: z.string().optional(),
    toolDescriptions: z.record(z.unknown()).optional(),
    templateSuggestions: z.array(TemplateSuggestionSchema).optional(),
  })
  .passthrough(); // Allow additional fields not in schema

export type MethodologyYaml = z.infer<typeof MethodologySchema>;

// ============================================
// Validation Utilities
// ============================================

export interface MethodologySchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a methodology definition against the schema
 *
 * @param data - Raw YAML data to validate
 * @param expectedId - Expected ID (should match directory name)
 * @returns Validation result with errors and warnings
 */
export function validateMethodologySchema(
  data: unknown,
  expectedId?: string
): MethodologySchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Schema validation
  const result = MethodologySchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const definition = result.data;

  // ID must match directory name (if expectedId provided)
  if (expectedId !== undefined && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }

  // Warnings for recommended fields
  if (!definition.systemPromptGuidance) {
    warnings.push('Missing systemPromptGuidance - framework guidance will be limited');
  }
  if (!definition.toolDescriptions) {
    warnings.push('Missing toolDescriptions');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
