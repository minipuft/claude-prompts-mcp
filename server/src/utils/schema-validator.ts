// @lifecycle canonical - Shared schema validation helper built on zod.
/**
 * Schema Validator Utilities
 *
 * Provides a thin wrapper over zod to standardize validation results and
 * error formatting across loaders (gates, methodologies, prompts).
 */

import type { ZodError, ZodIssue, ZodSchema } from 'zod';

export interface SchemaValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export function validateWithSchema<T>(
  schema: ZodSchema<T>,
  value: unknown,
  options?: { name?: string }
): SchemaValidationResult<T> {
  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    errors: formatZodIssues(parsed.error, options?.name),
  };
}

export function formatZodIssues(error: ZodError | ZodIssue[], name?: string): string[] {
  const issues = Array.isArray(error) ? error : error.issues;
  const prefix = name ? `${name}: ` : '';

  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '';
    const location = path ? ` (${path})` : '';
    return `${prefix}${issue.message}${location}`;
  });
}
