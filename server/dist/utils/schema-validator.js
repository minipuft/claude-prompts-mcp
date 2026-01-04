// @lifecycle canonical - Shared schema validation helper built on zod.
/**
 * Schema Validator Utilities
 *
 * Provides a thin wrapper over zod to standardize validation results and
 * error formatting across loaders (gates, methodologies, prompts).
 */
export function validateWithSchema(schema, value, options) {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
        return { success: true, data: parsed.data };
    }
    return {
        success: false,
        errors: formatZodIssues(parsed.error, options?.name),
    };
}
export function formatZodIssues(error, name) {
    const issues = Array.isArray(error) ? error : error.issues;
    const prefix = name ? `${name}: ` : '';
    return issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '';
        const location = path ? ` (${path})` : '';
        return `${prefix}${issue.message}${location}`;
    });
}
//# sourceMappingURL=schema-validator.js.map