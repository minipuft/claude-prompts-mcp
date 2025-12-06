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
export declare function validateWithSchema<T>(schema: ZodSchema<T>, value: unknown, options?: {
    name?: string;
}): SchemaValidationResult<T>;
export declare function formatZodIssues(error: ZodError | ZodIssue[], name?: string): string[];
