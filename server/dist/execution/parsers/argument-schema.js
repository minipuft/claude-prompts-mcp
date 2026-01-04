// @lifecycle canonical - Declares zod schemas for parsed operator arguments.
import { z } from 'zod';
export class ArgumentSchemaValidator {
    constructor(overrides = {}) {
        this.overrides = overrides;
        this.cache = new Map();
    }
    validate(prompt, args) {
        if (!prompt.arguments.length) {
            return { success: true, issues: [] };
        }
        const schema = this.getSchema(prompt);
        if (!schema) {
            return { success: true, issues: [] };
        }
        const parsed = schema.safeParse(args);
        if (parsed.success) {
            return { success: true, issues: [] };
        }
        const issues = parsed.error.issues.map((issue) => ({
            argument: issue.path?.[0]?.toString() ?? '',
            message: issue.message,
            code: issue.code,
        }));
        return {
            success: false,
            issues,
        };
    }
    getSchema(prompt) {
        const override = this.overrides[prompt.id];
        if (override) {
            return override;
        }
        if (this.cache.has(prompt.id)) {
            return this.cache.get(prompt.id) ?? null;
        }
        if (!prompt.arguments.length) {
            return null;
        }
        const schema = this.buildSchema(prompt);
        if (schema) {
            this.cache.set(prompt.id, schema);
        }
        return schema;
    }
    buildSchema(prompt) {
        if (!prompt.arguments.length) {
            return null;
        }
        const shape = {};
        for (const arg of prompt.arguments) {
            let schema = this.createArgumentSchema(arg);
            schema = arg.required ? schema : schema.optional();
            shape[arg.name] = schema;
        }
        return z.object(shape).passthrough();
    }
    createArgumentSchema(arg) {
        const type = arg.type ?? 'string';
        switch (type) {
            case 'number':
                return this.applyCommonConstraints(arg, z.coerce.number({ invalid_type_error: `Argument ${arg.name} must be a number` }));
            case 'boolean':
                return this.applyCommonConstraints(arg, z.coerce.boolean({ invalid_type_error: `Argument ${arg.name} must be a boolean` }));
            case 'array':
                return this.createArraySchema(arg);
            case 'object':
                return this.createObjectSchema(arg);
            case 'string':
            default:
                return this.applyStringConstraints(arg, z.string({ invalid_type_error: `Argument ${arg.name} must be a string` }));
        }
    }
    createArraySchema(arg) {
        const target = z.array(z.any(), {
            invalid_type_error: `Argument ${arg.name} must be an array`,
        });
        const schema = z.preprocess((val) => {
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    return parsed;
                }
                catch {
                    return val;
                }
            }
            return val;
        }, target);
        return this.applyCommonConstraints(arg, schema);
    }
    createObjectSchema(arg) {
        const target = z.record(z.any(), {
            invalid_type_error: `Argument ${arg.name} must be an object`,
        });
        const schema = z.preprocess((val) => {
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    return parsed;
                }
                catch {
                    return val;
                }
            }
            return val;
        }, target);
        return this.applyCommonConstraints(arg, schema);
    }
    /**
     * Apply common constraints to any schema type.
     * Note: allowedValues was removed in v3.0.0 - LLM handles semantic variation better
     * than strict enum enforcement.
     */
    applyCommonConstraints(_arg, schema) {
        // Currently no common constraints apply to all types.
        // minLength/maxLength/pattern are string-specific and handled in applyStringConstraints.
        return schema;
    }
    applyStringConstraints(arg, schema) {
        let refined = schema;
        const { validation } = arg;
        if (validation?.pattern) {
            try {
                const pattern = new RegExp(validation.pattern);
                refined = refined.regex(pattern, {
                    message: `Value must match pattern ${validation.pattern}`,
                });
            }
            catch {
                // Ignore invalid regex patterns to avoid breaking parsing
            }
        }
        if (typeof validation?.minLength === 'number') {
            refined = refined.min(validation.minLength, {
                message: `Value must contain at least ${validation.minLength} characters`,
            });
        }
        if (typeof validation?.maxLength === 'number') {
            refined = refined.max(validation.maxLength, {
                message: `Value must contain no more than ${validation.maxLength} characters`,
            });
        }
        // Note: allowedValues support was removed in v3.0.0
        // LLM handles semantic variation (e.g., "urgent" vs "high") better than strict enums
        return refined;
    }
}
//# sourceMappingURL=argument-schema.js.map