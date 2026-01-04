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
/**
 * Schema for style activation rules.
 */
export declare const StyleActivationSchema: z.ZodObject<{
    prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    prompt_categories?: string[] | undefined;
    explicit_request?: boolean | undefined;
    framework_context?: string[] | undefined;
}, {
    prompt_categories?: string[] | undefined;
    explicit_request?: boolean | undefined;
    framework_context?: string[] | undefined;
}>;
export type StyleActivationYaml = z.infer<typeof StyleActivationSchema>;
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
export declare const StyleDefinitionSchema: z.ZodObject<{
    /** Unique identifier for the style (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Description of what this style provides */
    description: z.ZodString;
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.ZodOptional<z.ZodString>;
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.ZodOptional<z.ZodString>;
    /** Priority for style selection (higher = preferred) */
    priority: z.ZodDefault<z.ZodNumber>;
    /** Whether this style is enabled */
    enabled: z.ZodDefault<z.ZodBoolean>;
    /** How to apply guidance: prepend, append, or replace */
    enhancementMode: z.ZodDefault<z.ZodEnum<["prepend", "append", "replace"]>>;
    /** Rules determining when this style should be auto-applied */
    activation: z.ZodOptional<z.ZodObject<{
        prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }>>;
    /** Which frameworks this style works well with */
    compatibleFrameworks: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Unique identifier for the style (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Description of what this style provides */
    description: z.ZodString;
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.ZodOptional<z.ZodString>;
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.ZodOptional<z.ZodString>;
    /** Priority for style selection (higher = preferred) */
    priority: z.ZodDefault<z.ZodNumber>;
    /** Whether this style is enabled */
    enabled: z.ZodDefault<z.ZodBoolean>;
    /** How to apply guidance: prepend, append, or replace */
    enhancementMode: z.ZodDefault<z.ZodEnum<["prepend", "append", "replace"]>>;
    /** Rules determining when this style should be auto-applied */
    activation: z.ZodOptional<z.ZodObject<{
        prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }>>;
    /** Which frameworks this style works well with */
    compatibleFrameworks: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Unique identifier for the style (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Description of what this style provides */
    description: z.ZodString;
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.ZodOptional<z.ZodString>;
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.ZodOptional<z.ZodString>;
    /** Priority for style selection (higher = preferred) */
    priority: z.ZodDefault<z.ZodNumber>;
    /** Whether this style is enabled */
    enabled: z.ZodDefault<z.ZodBoolean>;
    /** How to apply guidance: prepend, append, or replace */
    enhancementMode: z.ZodDefault<z.ZodEnum<["prepend", "append", "replace"]>>;
    /** Rules determining when this style should be auto-applied */
    activation: z.ZodOptional<z.ZodObject<{
        prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }>>;
    /** Which frameworks this style works well with */
    compatibleFrameworks: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export type StyleDefinitionYaml = z.infer<typeof StyleDefinitionSchema>;
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
export declare function validateStyleSchema(data: unknown, expectedId?: string): StyleSchemaValidationResult;
/**
 * Check if a value is a valid style definition.
 * Simpler check without detailed error messages.
 *
 * @param data - Value to check
 * @returns true if data is a valid style definition
 */
export declare function isValidStyleDefinition(data: unknown): data is StyleDefinitionYaml;
