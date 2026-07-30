// @lifecycle canonical - Single source of truth for methodology YAML validation
/**
 * Methodology Schema (Zod)
 *
 * Defines the canonical schema for methodology YAML files.
 * Used by both:
 * - RuntimeMethodologyLoader (runtime validation)
 * - validate-methodologies.ts (CI validation)
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 */

import { z } from 'zod';

// ============================================
// Gate Schema
// ============================================
export const FrameworkGateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  frameworkArea: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  validationCriteria: z.array(z.string()).optional(),
  criteria: z.array(z.string()).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
});

export type FrameworkGate = z.infer<typeof FrameworkGateSchema>;

// ============================================
// Template Suggestion Schema
// ============================================
export const TemplateSuggestionSchema = z.object({
  section: z.enum(['system', 'user']),
  type: z.enum(['addition', 'structure', 'modification']),
  description: z.string().optional(), // Description of the suggestion
  content: z.string().optional(), // Suggested content to add
  frameworkJustification: z.string().optional(), // Why this aligns with methodology
  impact: z.enum(['high', 'medium', 'low']).optional(),
});

export type TemplateSuggestion = z.infer<typeof TemplateSuggestionSchema>;

// ============================================
// Phase Guard Schema
// ============================================
export const PhaseGuardSchema = z.object({
  required: z.boolean().optional(),
  min_length: z.number().int().positive().optional(),
  max_length: z.number().int().positive().optional(),
  contains_any: z.array(z.string().min(1)).optional(),
  contains_all: z.array(z.string().min(1)).optional(),
  matches_pattern: z.string().optional(),
  forbidden_terms: z.array(z.string().min(1)).optional(),
});

export type PhaseGuard = z.infer<typeof PhaseGuardSchema>;

// ============================================
// Processing Step Schema (phases.yaml)
// ============================================
export const ProcessingStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  frameworkBasis: z.string().min(1),
  order: z.number().int().positive(),
  required: z.boolean(),
  section_header: z.string().optional(),
  guards: PhaseGuardSchema.optional(),
});

export type ProcessingStepYaml = z.infer<typeof ProcessingStepSchema>;

// ============================================
// Execution Step Schema (phases.yaml)
// ============================================
export const ExecutionStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  action: z.string().min(1),
  frameworkPhase: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  expected_output: z.string().min(1),
});

export type ExecutionStepYaml = z.infer<typeof ExecutionStepSchema>;

// ============================================
// Phases File Schema (phases.yaml)
// ============================================
export const PhasesFileSchema = z
  .object({
    processingSteps: z.array(ProcessingStepSchema).optional(),
    executionSteps: z.array(ExecutionStepSchema).optional(),
    templateEnhancements: z
      .object({
        systemPromptAdditions: z.array(z.string()).optional(),
        userPromptModifications: z.array(z.string()).optional(),
        contextualHints: z.array(z.string()).optional(),
      })
      .optional(),
    executionFlow: z
      .object({
        preProcessingSteps: z.array(z.string()).optional(),
        postProcessingSteps: z.array(z.string()).optional(),
        validationSteps: z.array(z.string()).optional(),
      })
      .optional(),
    qualityIndicators: z.record(z.unknown()).optional(),
    executionTypeEnhancements: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type PhasesFileYaml = z.infer<typeof PhasesFileSchema>;

// ============================================
// Main Methodology Schema
// ============================================
export const FrameworkSchema = z
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
    methodologyGates: z.array(FrameworkGateSchema).optional(),

    // File references (validated separately for existence)
    phasesFile: z.string().optional(),
    judgePromptFile: z.string().optional(),

    // Guidance
    systemPromptGuidance: z.string().optional(),
    toolDescriptions: z.record(z.unknown()).optional(),
    templateSuggestions: z.array(TemplateSuggestionSchema).optional(),
  })
  .passthrough(); // Allow additional fields not in schema

export type FrameworkYaml = z.infer<typeof FrameworkSchema>;

// ============================================
// Validation Utilities
// ============================================

export interface FrameworkSchemaValidationResult {
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
): FrameworkSchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Schema validation
  const result = FrameworkSchema.safeParse(data);
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

/**
 * Validate a phases.yaml file against the schema.
 *
 * Checks structural validity and provides warnings for phase guard best practices
 * (e.g., marker without guards or vice versa).
 *
 * @param data - Raw YAML data from phases.yaml
 * @returns Validation result with errors and warnings
 */
export function validatePhasesSchema(data: unknown): FrameworkSchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const result = PhasesFileSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const phases = result.data;

  // Validate processing steps
  if (phases.processingSteps) {
    const orders = new Set<number>();
    for (const step of phases.processingSteps) {
      // Duplicate order check
      if (orders.has(step.order)) {
        errors.push(`processingSteps: Duplicate order ${step.order} on step '${step.id}'`);
      }
      orders.add(step.order);

      // Guard coherence: section_header without guards (or vice versa)
      if (step.section_header && !step.guards) {
        warnings.push(
          `processingSteps.${step.id}: Has section_header '${step.section_header}' but no guards — section header will be unused by phase guard verification`
        );
      }
      if (step.guards && !step.section_header) {
        errors.push(
          `processingSteps.${step.id}: Has guards but no section_header — guards require a section_header for section detection`
        );
      }

      // Guard min/max coherence
      if (
        step.guards?.min_length !== undefined &&
        step.guards?.max_length !== undefined &&
        step.guards.min_length > step.guards.max_length
      ) {
        errors.push(
          `processingSteps.${step.id}: min_length (${step.guards.min_length}) exceeds max_length (${step.guards.max_length})`
        );
      }
    }
  }

  // Validate execution step dependency references
  if (phases.executionSteps) {
    const stepIds = new Set(phases.executionSteps.map((s) => s.id));
    for (const step of phases.executionSteps) {
      for (const dep of step.dependencies) {
        if (!stepIds.has(dep)) {
          errors.push(
            `executionSteps.${step.id}: Dependency '${dep}' does not match any execution step ID`
          );
        }
      }
    }
  }

  // Warnings for recommended content
  if (!phases.processingSteps || phases.processingSteps.length === 0) {
    warnings.push('No processingSteps defined');
  }
  if (!phases.executionSteps || phases.executionSteps.length === 0) {
    warnings.push('No executionSteps defined');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
