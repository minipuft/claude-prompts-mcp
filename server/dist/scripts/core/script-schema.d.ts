/**
 * Script Tool Schema Definitions
 *
 * Defines Zod schemas for validating script tool YAML configurations.
 * Uses modern deterministic trigger types aligned with industry standards
 * (GitHub Actions, AWS Lambda, Terraform).
 *
 * Trigger Types (deterministic, not probabilistic):
 * - schema_match: Execute when user args validate against schema (default)
 * - explicit: Execute only when user writes tool:<id>
 * - always: Execute on every prompt run regardless of args
 * - never: Tool is defined but disabled
 *
 * @see plans/script-tools-implementation.md
 */
import { z } from 'zod';
/**
 * Trigger types for script tool execution.
 *
 * Modern automation systems (GitHub Actions, AWS Lambda, Terraform) use
 * deterministic triggers, not probabilistic confidence scores.
 *
 * - schema_match: Default - runs when args validate against tool's JSON Schema
 * - explicit: Only runs when user explicitly names the tool (tool:<id>)
 * - always: Runs on every prompt execution (logging, metrics, setup)
 * - never: Tool is defined but intentionally disabled (WIP, conditional)
 *
 * Note: 'parameter_match' is deprecated, automatically transformed to 'schema_match'.
 */
export declare const TriggerTypeSchema: z.ZodEffects<z.ZodEnum<["schema_match", "explicit", "always", "never", "parameter_match"]>, "never" | "always" | "schema_match" | "explicit", "never" | "always" | "schema_match" | "explicit" | "parameter_match">;
export type TriggerTypeYaml = 'schema_match' | 'explicit' | 'always' | 'never';
/**
 * @deprecated ExecutionModeSchema is deprecated.
 * Use `trigger: explicit` instead of `mode: manual`, and `confirm: true` instead of `mode: confirm`.
 * This schema is preserved only for backwards compatibility during migration.
 */
export declare const ExecutionModeSchema: z.ZodDefault<z.ZodEnum<["auto", "manual", "confirm"]>>;
/** @deprecated Use trigger + confirm instead */
export type ExecutionModeYaml = z.infer<typeof ExecutionModeSchema>;
/**
 * Execution configuration for script tools.
 *
 * Configuration precedence (new consolidated system):
 * - `trigger`: Controls WHEN the tool activates (schema_match | explicit | always | never)
 * - `confirm`: Controls WHETHER to ask for confirmation before executing
 * - `strict`: Controls HOW schema matching works (any vs all required params)
 *
 * Migration from deprecated `mode` field:
 * - mode: auto    → (default, no field needed)
 * - mode: manual  → trigger: explicit
 * - mode: confirm → confirm: true
 *
 * Note: Both 'mode' and 'confidence' fields are DEPRECATED and automatically migrated.
 */
export declare const ExecutionConfigSchema: z.ZodOptional<z.ZodObject<{
    /** Trigger type (default: 'schema_match') */
    trigger: z.ZodOptional<z.ZodEffects<z.ZodEnum<["schema_match", "explicit", "always", "never", "parameter_match"]>, "never" | "always" | "schema_match" | "explicit", "never" | "always" | "schema_match" | "explicit" | "parameter_match">>;
    /**
     * Require confirmation before execution (default: true)
     * When true, tool detection returns a confirmation prompt before executing.
     * User can bypass confirmation with explicit tool:<id> arg.
     * Set to false explicitly for tools with no side effects.
     */
    confirm: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /**
     * Strict matching mode (default: false)
     * - false: Match if ANY required param is present and valid
     * - true: Match only if ALL required params are present and valid
     */
    strict: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /** Custom confirmation message (shown when confirm: true) */
    confirmMessage: z.ZodOptional<z.ZodString>;
    /**
     * Auto-approve execution when script validation passes (default: false)
     *
     * When true, the script is executed for validation first. If the script
     * returns `valid: true` with no warnings, confirmation is bypassed and
     * auto_execute proceeds automatically.
     *
     * Behavior based on script output:
     * - valid: true + no warnings → auto-approve, proceed to auto_execute
     * - valid: true + warnings → show warnings, still proceed to auto_execute
     * - valid: false → show errors, block execution
     */
    autoApproveOnValid: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /**
     * @deprecated mode is deprecated. Use trigger: explicit instead of mode: manual,
     * and confirm: true instead of mode: confirm.
     * This field is accepted for backwards compatibility and automatically migrated.
     */
    mode: z.ZodEffects<z.ZodOptional<z.ZodDefault<z.ZodEnum<["auto", "manual", "confirm"]>>>, "manual" | "auto" | "confirm" | undefined, "manual" | "auto" | "confirm" | undefined>;
    /**
     * @deprecated Numeric confidence is deprecated. Use trigger types instead.
     * This field is accepted for backwards compatibility but ignored.
     */
    confidence: z.ZodEffects<z.ZodOptional<z.ZodNumber>, undefined, number | undefined>;
}, "strip", z.ZodTypeAny, {
    confirm: boolean;
    strict: boolean;
    autoApproveOnValid: boolean;
    confidence?: undefined;
    mode?: "manual" | "auto" | "confirm" | undefined;
    trigger?: "never" | "always" | "schema_match" | "explicit" | undefined;
    confirmMessage?: string | undefined;
}, {
    confirm?: boolean | undefined;
    strict?: boolean | undefined;
    confidence?: number | undefined;
    mode?: "manual" | "auto" | "confirm" | undefined;
    trigger?: "never" | "always" | "schema_match" | "explicit" | "parameter_match" | undefined;
    confirmMessage?: string | undefined;
    autoApproveOnValid?: boolean | undefined;
}>>;
export type ExecutionConfigYaml = {
    trigger?: TriggerTypeYaml;
    confirm?: boolean;
    strict?: boolean;
    confirmMessage?: string;
    autoApproveOnValid?: boolean;
};
/**
 * Runtime environment for script execution.
 */
export declare const ScriptRuntimeSchema: z.ZodDefault<z.ZodEnum<["python", "node", "shell", "auto"]>>;
export type ScriptRuntimeYaml = z.infer<typeof ScriptRuntimeSchema>;
/**
 * Complete schema for tool.yaml files.
 */
export declare const ScriptToolYamlSchema: z.ZodObject<{
    /** Unique tool ID (must match directory name) */
    id: z.ZodString;
    /** Human-readable name for the tool */
    name: z.ZodString;
    /** Description of what this tool does (can be overridden by description.md) */
    description: z.ZodOptional<z.ZodString>;
    /** Path to executable script (relative to tool directory) */
    script: z.ZodString;
    /** Runtime to use for execution */
    runtime: z.ZodOptional<z.ZodDefault<z.ZodEnum<["python", "node", "shell", "auto"]>>>;
    /** Path to JSON Schema file for inputs (default: 'schema.json') */
    schemaFile: z.ZodOptional<z.ZodString>;
    /** Path to description markdown (default: 'description.md') */
    descriptionFile: z.ZodOptional<z.ZodString>;
    /** Execution timeout in milliseconds (default: 30000) */
    timeout: z.ZodOptional<z.ZodNumber>;
    /** Environment variables to pass to the script */
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** Working directory relative to tool directory */
    workingDir: z.ZodOptional<z.ZodString>;
    /** Whether this tool is enabled (default: true) */
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /** Execution control configuration */
    execution: z.ZodOptional<z.ZodObject<{
        /** Trigger type (default: 'schema_match') */
        trigger: z.ZodOptional<z.ZodEffects<z.ZodEnum<["schema_match", "explicit", "always", "never", "parameter_match"]>, "never" | "always" | "schema_match" | "explicit", "never" | "always" | "schema_match" | "explicit" | "parameter_match">>;
        /**
         * Require confirmation before execution (default: true)
         * When true, tool detection returns a confirmation prompt before executing.
         * User can bypass confirmation with explicit tool:<id> arg.
         * Set to false explicitly for tools with no side effects.
         */
        confirm: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        /**
         * Strict matching mode (default: false)
         * - false: Match if ANY required param is present and valid
         * - true: Match only if ALL required params are present and valid
         */
        strict: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        /** Custom confirmation message (shown when confirm: true) */
        confirmMessage: z.ZodOptional<z.ZodString>;
        /**
         * Auto-approve execution when script validation passes (default: false)
         *
         * When true, the script is executed for validation first. If the script
         * returns `valid: true` with no warnings, confirmation is bypassed and
         * auto_execute proceeds automatically.
         *
         * Behavior based on script output:
         * - valid: true + no warnings → auto-approve, proceed to auto_execute
         * - valid: true + warnings → show warnings, still proceed to auto_execute
         * - valid: false → show errors, block execution
         */
        autoApproveOnValid: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        /**
         * @deprecated mode is deprecated. Use trigger: explicit instead of mode: manual,
         * and confirm: true instead of mode: confirm.
         * This field is accepted for backwards compatibility and automatically migrated.
         */
        mode: z.ZodEffects<z.ZodOptional<z.ZodDefault<z.ZodEnum<["auto", "manual", "confirm"]>>>, "manual" | "auto" | "confirm" | undefined, "manual" | "auto" | "confirm" | undefined>;
        /**
         * @deprecated Numeric confidence is deprecated. Use trigger types instead.
         * This field is accepted for backwards compatibility but ignored.
         */
        confidence: z.ZodEffects<z.ZodOptional<z.ZodNumber>, undefined, number | undefined>;
    }, "strip", z.ZodTypeAny, {
        confirm: boolean;
        strict: boolean;
        autoApproveOnValid: boolean;
        confidence?: undefined;
        mode?: "manual" | "auto" | "confirm" | undefined;
        trigger?: "never" | "always" | "schema_match" | "explicit" | undefined;
        confirmMessage?: string | undefined;
    }, {
        confirm?: boolean | undefined;
        strict?: boolean | undefined;
        confidence?: number | undefined;
        mode?: "manual" | "auto" | "confirm" | undefined;
        trigger?: "never" | "always" | "schema_match" | "explicit" | "parameter_match" | undefined;
        confirmMessage?: string | undefined;
        autoApproveOnValid?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    id: string;
    name: string;
    script: string;
    execution?: {
        confirm: boolean;
        strict: boolean;
        autoApproveOnValid: boolean;
        confidence?: undefined;
        mode?: "manual" | "auto" | "confirm" | undefined;
        trigger?: "never" | "always" | "schema_match" | "explicit" | undefined;
        confirmMessage?: string | undefined;
    } | undefined;
    timeout?: number | undefined;
    description?: string | undefined;
    runtime?: "python" | "node" | "shell" | "auto" | undefined;
    schemaFile?: string | undefined;
    descriptionFile?: string | undefined;
    env?: Record<string, string> | undefined;
    workingDir?: string | undefined;
}, {
    id: string;
    name: string;
    script: string;
    execution?: {
        confirm?: boolean | undefined;
        strict?: boolean | undefined;
        confidence?: number | undefined;
        mode?: "manual" | "auto" | "confirm" | undefined;
        trigger?: "never" | "always" | "schema_match" | "explicit" | "parameter_match" | undefined;
        confirmMessage?: string | undefined;
        autoApproveOnValid?: boolean | undefined;
    } | undefined;
    timeout?: number | undefined;
    enabled?: boolean | undefined;
    description?: string | undefined;
    runtime?: "python" | "node" | "shell" | "auto" | undefined;
    schemaFile?: string | undefined;
    descriptionFile?: string | undefined;
    env?: Record<string, string> | undefined;
    workingDir?: string | undefined;
}>;
export type ScriptToolYaml = z.infer<typeof ScriptToolYamlSchema>;
/**
 * Result of script tool schema validation.
 */
export interface ScriptToolSchemaValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    normalized?: ScriptToolYaml;
}
/**
 * Validate a script tool definition against the schema.
 *
 * @param definition - Raw YAML definition to validate
 * @param expectedId - Expected tool ID (should match directory name)
 * @returns Validation result with errors, warnings, and normalized data
 */
export declare function validateScriptToolSchema(definition: unknown, expectedId?: string): ScriptToolSchemaValidationResult;
/**
 * Parse and normalize execution config from YAML.
 *
 * Handles migration from deprecated `mode` field:
 * - mode: manual  → trigger: explicit
 * - mode: confirm → confirm: true
 *
 * @param raw - Raw execution config from YAML
 * @returns Normalized execution config (new schema: trigger + confirm)
 */
export declare function normalizeExecutionConfig(raw: unknown): ExecutionConfigYaml;
/**
 * Type guard to check if a value is a valid ScriptToolYaml.
 *
 * @param value - Value to check
 * @returns True if value is valid ScriptToolYaml
 */
export declare function isValidScriptToolYaml(value: unknown): value is ScriptToolYaml;
