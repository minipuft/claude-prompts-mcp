// @lifecycle canonical - Schema validation for lightweight gate definitions.
/**
 * Lightweight Gate Definition Schema
 *
 * Provides runtime validation for gate definitions loaded from disk.
 * Permissive to avoid rejecting legacy fields but enforces required keys.
 */

import { z } from 'zod';

import { validateWithSchema, type SchemaValidationResult } from '../../utils/schema-validator.js';
import type { LightweightGateDefinition } from '../types.js';

const activationSchema = z
  .object({
    prompt_categories: z.array(z.string()).optional(),
    explicit_request: z.boolean().optional(),
    framework_context: z.array(z.string()).optional(),
  })
  .partial();

const retryConfigSchema = z
  .object({
    max_attempts: z.number().int().nonnegative().optional(),
    improvement_hints: z.boolean().optional(),
    preserve_context: z.boolean().optional(),
  })
  .partial();

const lightweightGateSchema = z
  .object({
    id: z.string().min(1, 'Gate ID is required'),
    name: z.string().min(1, 'Gate name is required'),
    type: z.enum(['validation', 'guidance'], {
      errorMap: () => ({ message: 'Gate type is required' }),
    }),
    description: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    enforcementMode: z.enum(['blocking', 'advisory', 'informational']).optional(),
    guidance: z.string().optional(),
    pass_criteria: z.array(z.record(z.string(), z.any())).optional(),
    retry_config: retryConfigSchema.optional(),
    activation: activationSchema.optional(),
    gate_type: z.string().optional(),
  })
  .passthrough();

export function validateLightweightGateDefinition(
  value: unknown
): SchemaValidationResult<LightweightGateDefinition> {
  const result = validateWithSchema(lightweightGateSchema, value, { name: 'Gate definition' });

  if (!result.success) {
    return {
      success: false,
      errors: result.errors,
    };
  }

  return {
    success: true,
    data: result.data as LightweightGateDefinition,
  };
}
