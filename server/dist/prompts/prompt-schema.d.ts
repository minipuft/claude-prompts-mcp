/**
 * Prompt Schema (Zod)
 *
 * Defines the canonical schema for prompt definitions in prompts.json files.
 * Used by:
 * - PromptLoader (runtime validation)
 * - PromptConverter (content validation)
 * - (Future) CI validation scripts
 * - (Future) YAML prompt format validation
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 *
 * @see gate-schema.ts for the pattern this follows
 * @see methodology-schema.ts for the pattern this follows
 */
import { z } from 'zod';
/**
 * Schema for argument validation rules.
 */
export declare const ArgumentValidationSchema: z.ZodObject<{
    pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
}, "strip", z.ZodTypeAny, {
    pattern?: string | undefined;
    minLength?: number | undefined;
    maxLength?: number | undefined;
    allowedValues?: (string | number | boolean)[] | undefined;
}, {
    pattern?: string | undefined;
    minLength?: number | undefined;
    maxLength?: number | undefined;
    allowedValues?: (string | number | boolean)[] | undefined;
}>;
export type ArgumentValidationYaml = z.infer<typeof ArgumentValidationSchema>;
/**
 * Schema for prompt argument definitions.
 */
export declare const PromptArgumentSchema: z.ZodObject<{
    /** Name of the argument (required) */
    name: z.ZodString;
    /** Description of the argument */
    description: z.ZodOptional<z.ZodString>;
    /** Whether this argument is required (default: false) */
    required: z.ZodDefault<z.ZodBoolean>;
    /** Type of the argument value */
    type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
    /** Default value if not provided */
    defaultValue: z.ZodOptional<z.ZodAny>;
    /** Validation rules for the argument */
    validation: z.ZodOptional<z.ZodObject<{
        pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        pattern?: string | undefined;
        minLength?: number | undefined;
        maxLength?: number | undefined;
        allowedValues?: (string | number | boolean)[] | undefined;
    }, {
        pattern?: string | undefined;
        minLength?: number | undefined;
        maxLength?: number | undefined;
        allowedValues?: (string | number | boolean)[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    required: boolean;
    validation?: {
        pattern?: string | undefined;
        minLength?: number | undefined;
        maxLength?: number | undefined;
        allowedValues?: (string | number | boolean)[] | undefined;
    } | undefined;
    type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
    description?: string | undefined;
    defaultValue?: any;
}, {
    name: string;
    validation?: {
        pattern?: string | undefined;
        minLength?: number | undefined;
        maxLength?: number | undefined;
        allowedValues?: (string | number | boolean)[] | undefined;
    } | undefined;
    type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
    description?: string | undefined;
    required?: boolean | undefined;
    defaultValue?: any;
}>;
export type PromptArgumentYaml = z.infer<typeof PromptArgumentSchema>;
/**
 * Schema for chain step definitions.
 */
export declare const ChainStepSchema: z.ZodObject<{
    /** ID of the prompt to execute in this step */
    promptId: z.ZodString;
    /** Name/identifier of this step */
    stepName: z.ZodString;
    /** Map step results to semantic names */
    inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** Name this step's output for downstream steps */
    outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    /** Number of retry attempts on failure (default: 0) */
    retries: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    promptId: string;
    stepName: string;
    inputMapping?: Record<string, string> | undefined;
    outputMapping?: Record<string, string> | undefined;
    retries?: number | undefined;
}, {
    promptId: string;
    stepName: string;
    inputMapping?: Record<string, string> | undefined;
    outputMapping?: Record<string, string> | undefined;
    retries?: number | undefined;
}>;
export type ChainStepYaml = z.infer<typeof ChainStepSchema>;
/**
 * Schema for prompt gate configuration.
 */
export declare const PromptGateConfigurationSchema: z.ZodObject<{
    include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
        type: z.ZodString;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        description: z.ZodOptional<z.ZodString>;
        guidance: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
        expires_at: z.ZodOptional<z.ZodNumber>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
        type: z.ZodString;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        description: z.ZodOptional<z.ZodString>;
        guidance: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
        expires_at: z.ZodOptional<z.ZodNumber>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
        type: z.ZodString;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        description: z.ZodOptional<z.ZodString>;
        guidance: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
        expires_at: z.ZodOptional<z.ZodNumber>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>>;
}, "strip", z.ZodTypeAny, {
    include?: string[] | undefined;
    exclude?: string[] | undefined;
    framework_gates?: boolean | undefined;
    inline_gate_definitions?: z.objectOutputType<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
        type: z.ZodString;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        description: z.ZodOptional<z.ZodString>;
        guidance: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
        expires_at: z.ZodOptional<z.ZodNumber>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.ZodTypeAny, "passthrough">[] | undefined;
}, {
    include?: string[] | undefined;
    exclude?: string[] | undefined;
    framework_gates?: boolean | undefined;
    inline_gate_definitions?: z.objectInputType<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
        /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
        type: z.ZodString;
        scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
        description: z.ZodOptional<z.ZodString>;
        guidance: z.ZodOptional<z.ZodString>;
        pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
        expires_at: z.ZodOptional<z.ZodNumber>;
        source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.ZodTypeAny, "passthrough">[] | undefined;
}>;
export type PromptGateConfigurationYaml = z.infer<typeof PromptGateConfigurationSchema>;
/**
 * Schema for category definitions.
 */
export declare const CategorySchema: z.ZodObject<{
    /** Unique identifier for the category */
    id: z.ZodString;
    /** Display name for the category */
    name: z.ZodString;
    /** Description of the category */
    description: z.ZodString;
    /** MCP registration default for prompts in this category */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    description: string;
    registerWithMcp?: boolean | undefined;
}, {
    id: string;
    name: string;
    description: string;
    registerWithMcp?: boolean | undefined;
}>;
export type CategoryYaml = z.infer<typeof CategorySchema>;
/**
 * Schema for prompt definitions in prompts.json files.
 *
 * @example
 * ```json
 * {
 *   "id": "code_review",
 *   "name": "Code Review",
 *   "category": "development",
 *   "description": "Reviews code for quality and best practices",
 *   "file": "code_review.md",
 *   "arguments": [
 *     { "name": "code", "type": "string", "required": true }
 *   ]
 * }
 * ```
 */
export declare const PromptDataSchema: z.ZodObject<{
    /** Unique identifier for the prompt */
    id: z.ZodString;
    /** Display name for the prompt */
    name: z.ZodString;
    /** Category this prompt belongs to */
    category: z.ZodString;
    /** Description of the prompt */
    description: z.ZodString;
    /** Path to the prompt markdown file */
    file: z.ZodString;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for chain-type prompts */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Unique identifier for the prompt */
    id: z.ZodString;
    /** Display name for the prompt */
    name: z.ZodString;
    /** Category this prompt belongs to */
    category: z.ZodString;
    /** Description of the prompt */
    description: z.ZodString;
    /** Path to the prompt markdown file */
    file: z.ZodString;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for chain-type prompts */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Unique identifier for the prompt */
    id: z.ZodString;
    /** Display name for the prompt */
    name: z.ZodString;
    /** Category this prompt belongs to */
    category: z.ZodString;
    /** Description of the prompt */
    description: z.ZodString;
    /** Path to the prompt markdown file */
    file: z.ZodString;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for chain-type prompts */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export type PromptDataYaml = z.infer<typeof PromptDataSchema>;
/**
 * Schema for category-level prompts.json files.
 */
export declare const PromptsFileSchema: z.ZodObject<{
    /** Array of prompt definitions */
    prompts: z.ZodArray<z.ZodObject<{
        /** Unique identifier for the prompt */
        id: z.ZodString;
        /** Display name for the prompt */
        name: z.ZodString;
        /** Category this prompt belongs to */
        category: z.ZodString;
        /** Description of the prompt */
        description: z.ZodString;
        /** Path to the prompt markdown file */
        file: z.ZodString;
        /** Arguments accepted by this prompt */
        arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Name of the argument (required) */
            name: z.ZodString;
            /** Description of the argument */
            description: z.ZodOptional<z.ZodString>;
            /** Whether this argument is required (default: false) */
            required: z.ZodDefault<z.ZodBoolean>;
            /** Type of the argument value */
            type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
            /** Default value if not provided */
            defaultValue: z.ZodOptional<z.ZodAny>;
            /** Validation rules for the argument */
            validation: z.ZodOptional<z.ZodObject<{
                pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
            }, "strip", z.ZodTypeAny, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            required: boolean;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            defaultValue?: any;
        }, {
            name: string;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            defaultValue?: any;
        }>, "many">>;
        /** Gate configuration for validation */
        gateConfiguration: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }>>;
        /** Chain steps for chain-type prompts */
        chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /** ID of the prompt to execute in this step */
            promptId: z.ZodString;
            /** Name/identifier of this step */
            stepName: z.ZodString;
            /** Map step results to semantic names */
            inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Name this step's output for downstream steps */
            outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Number of retry attempts on failure (default: 0) */
            retries: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }>, "many">>;
        /** Whether to register this prompt with MCP */
        registerWithMcp: z.ZodOptional<z.ZodBoolean>;
        /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
        tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /** Unique identifier for the prompt */
        id: z.ZodString;
        /** Display name for the prompt */
        name: z.ZodString;
        /** Category this prompt belongs to */
        category: z.ZodString;
        /** Description of the prompt */
        description: z.ZodString;
        /** Path to the prompt markdown file */
        file: z.ZodString;
        /** Arguments accepted by this prompt */
        arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Name of the argument (required) */
            name: z.ZodString;
            /** Description of the argument */
            description: z.ZodOptional<z.ZodString>;
            /** Whether this argument is required (default: false) */
            required: z.ZodDefault<z.ZodBoolean>;
            /** Type of the argument value */
            type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
            /** Default value if not provided */
            defaultValue: z.ZodOptional<z.ZodAny>;
            /** Validation rules for the argument */
            validation: z.ZodOptional<z.ZodObject<{
                pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
            }, "strip", z.ZodTypeAny, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            required: boolean;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            defaultValue?: any;
        }, {
            name: string;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            defaultValue?: any;
        }>, "many">>;
        /** Gate configuration for validation */
        gateConfiguration: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }>>;
        /** Chain steps for chain-type prompts */
        chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /** ID of the prompt to execute in this step */
            promptId: z.ZodString;
            /** Name/identifier of this step */
            stepName: z.ZodString;
            /** Map step results to semantic names */
            inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Name this step's output for downstream steps */
            outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Number of retry attempts on failure (default: 0) */
            retries: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }>, "many">>;
        /** Whether to register this prompt with MCP */
        registerWithMcp: z.ZodOptional<z.ZodBoolean>;
        /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
        tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /** Unique identifier for the prompt */
        id: z.ZodString;
        /** Display name for the prompt */
        name: z.ZodString;
        /** Category this prompt belongs to */
        category: z.ZodString;
        /** Description of the prompt */
        description: z.ZodString;
        /** Path to the prompt markdown file */
        file: z.ZodString;
        /** Arguments accepted by this prompt */
        arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Name of the argument (required) */
            name: z.ZodString;
            /** Description of the argument */
            description: z.ZodOptional<z.ZodString>;
            /** Whether this argument is required (default: false) */
            required: z.ZodDefault<z.ZodBoolean>;
            /** Type of the argument value */
            type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
            /** Default value if not provided */
            defaultValue: z.ZodOptional<z.ZodAny>;
            /** Validation rules for the argument */
            validation: z.ZodOptional<z.ZodObject<{
                pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
            }, "strip", z.ZodTypeAny, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            required: boolean;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            defaultValue?: any;
        }, {
            name: string;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            defaultValue?: any;
        }>, "many">>;
        /** Gate configuration for validation */
        gateConfiguration: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }>>;
        /** Chain steps for chain-type prompts */
        chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /** ID of the prompt to execute in this step */
            promptId: z.ZodString;
            /** Name/identifier of this step */
            stepName: z.ZodString;
            /** Map step results to semantic names */
            inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Name this step's output for downstream steps */
            outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Number of retry attempts on failure (default: 0) */
            retries: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }>, "many">>;
        /** Whether to register this prompt with MCP */
        registerWithMcp: z.ZodOptional<z.ZodBoolean>;
        /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
        tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "strip", z.ZodTypeAny, {
    prompts: z.objectOutputType<{
        /** Unique identifier for the prompt */
        id: z.ZodString;
        /** Display name for the prompt */
        name: z.ZodString;
        /** Category this prompt belongs to */
        category: z.ZodString;
        /** Description of the prompt */
        description: z.ZodString;
        /** Path to the prompt markdown file */
        file: z.ZodString;
        /** Arguments accepted by this prompt */
        arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Name of the argument (required) */
            name: z.ZodString;
            /** Description of the argument */
            description: z.ZodOptional<z.ZodString>;
            /** Whether this argument is required (default: false) */
            required: z.ZodDefault<z.ZodBoolean>;
            /** Type of the argument value */
            type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
            /** Default value if not provided */
            defaultValue: z.ZodOptional<z.ZodAny>;
            /** Validation rules for the argument */
            validation: z.ZodOptional<z.ZodObject<{
                pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
            }, "strip", z.ZodTypeAny, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            required: boolean;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            defaultValue?: any;
        }, {
            name: string;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            defaultValue?: any;
        }>, "many">>;
        /** Gate configuration for validation */
        gateConfiguration: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }>>;
        /** Chain steps for chain-type prompts */
        chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /** ID of the prompt to execute in this step */
            promptId: z.ZodString;
            /** Name/identifier of this step */
            stepName: z.ZodString;
            /** Map step results to semantic names */
            inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Name this step's output for downstream steps */
            outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Number of retry attempts on failure (default: 0) */
            retries: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }>, "many">>;
        /** Whether to register this prompt with MCP */
        registerWithMcp: z.ZodOptional<z.ZodBoolean>;
        /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
        tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">[];
}, {
    prompts: z.objectInputType<{
        /** Unique identifier for the prompt */
        id: z.ZodString;
        /** Display name for the prompt */
        name: z.ZodString;
        /** Category this prompt belongs to */
        category: z.ZodString;
        /** Description of the prompt */
        description: z.ZodString;
        /** Path to the prompt markdown file */
        file: z.ZodString;
        /** Arguments accepted by this prompt */
        arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Name of the argument (required) */
            name: z.ZodString;
            /** Description of the argument */
            description: z.ZodOptional<z.ZodString>;
            /** Whether this argument is required (default: false) */
            required: z.ZodDefault<z.ZodBoolean>;
            /** Type of the argument value */
            type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
            /** Default value if not provided */
            defaultValue: z.ZodOptional<z.ZodAny>;
            /** Validation rules for the argument */
            validation: z.ZodOptional<z.ZodObject<{
                pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
                minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
                allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
            }, "strip", z.ZodTypeAny, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }, {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            required: boolean;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            defaultValue?: any;
        }, {
            name: string;
            validation?: {
                pattern?: string | undefined;
                minLength?: number | undefined;
                maxLength?: number | undefined;
                allowedValues?: (string | number | boolean)[] | undefined;
            } | undefined;
            type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
            description?: string | undefined;
            required?: boolean | undefined;
            defaultValue?: any;
        }>, "many">>;
        /** Gate configuration for validation */
        gateConfiguration: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
            framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectOutputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }, {
            include?: string[] | undefined;
            exclude?: string[] | undefined;
            framework_gates?: boolean | undefined;
            inline_gate_definitions?: z.objectInputType<{
                id: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
                /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
                type: z.ZodString;
                scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
                description: z.ZodOptional<z.ZodString>;
                guidance: z.ZodOptional<z.ZodString>;
                pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
                expires_at: z.ZodOptional<z.ZodNumber>;
                source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
                context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            }, z.ZodTypeAny, "passthrough">[] | undefined;
        }>>;
        /** Chain steps for chain-type prompts */
        chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /** ID of the prompt to execute in this step */
            promptId: z.ZodString;
            /** Name/identifier of this step */
            stepName: z.ZodString;
            /** Map step results to semantic names */
            inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Name this step's output for downstream steps */
            outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            /** Number of retry attempts on failure (default: 0) */
            retries: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }, {
            promptId: string;
            stepName: string;
            inputMapping?: Record<string, string> | undefined;
            outputMapping?: Record<string, string> | undefined;
            retries?: number | undefined;
        }>, "many">>;
        /** Whether to register this prompt with MCP */
        registerWithMcp: z.ZodOptional<z.ZodBoolean>;
        /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
        tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">[];
}>;
export type PromptsFileYaml = z.infer<typeof PromptsFileSchema>;
/**
 * Schema for the main promptsConfig.json file.
 */
export declare const PromptsConfigSchema: z.ZodObject<{
    /** Available categories for organizing prompts */
    categories: z.ZodArray<z.ZodObject<{
        /** Unique identifier for the category */
        id: z.ZodString;
        /** Display name for the category */
        name: z.ZodString;
        /** Description of the category */
        description: z.ZodString;
        /** MCP registration default for prompts in this category */
        registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        description: string;
        registerWithMcp?: boolean | undefined;
    }, {
        id: string;
        name: string;
        description: string;
        registerWithMcp?: boolean | undefined;
    }>, "many">;
    /** Paths to prompts.json files to import */
    imports: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    categories: {
        id: string;
        name: string;
        description: string;
        registerWithMcp?: boolean | undefined;
    }[];
    imports: string[];
}, {
    categories: {
        id: string;
        name: string;
        description: string;
        registerWithMcp?: boolean | undefined;
    }[];
    imports: string[];
}>;
export type PromptsConfigYaml = z.infer<typeof PromptsConfigSchema>;
/**
 * Schema for prompt.yaml files in directory-based format.
 *
 * This format mirrors the gates/methodologies pattern:
 * - Each prompt gets its own directory: `prompts/{category}/{id}/`
 * - Main definition in `prompt.yaml`
 * - Optional referenced files for system message and user template
 *
 * @example
 * ```yaml
 * # prompts/analysis/progressive_research/prompt.yaml
 * id: progressive_research
 * name: Progressive Research Assistant
 * category: analysis
 * description: "A step-by-step research assistant..."
 *
 * # File references (inlined by loader)
 * systemMessageFile: system-message.md
 * userMessageTemplateFile: user-message.md
 *
 * # OR inline content directly
 * # systemMessage: "You are a research assistant..."
 * # userMessageTemplate: "Research the following: {{topic}}"
 *
 * arguments:
 *   - name: notes
 *     type: string
 *     description: "The initial notes to research"
 *     required: false
 *
 * gateConfiguration:
 *   include: [research-quality]
 *   framework_gates: true
 *
 * registerWithMcp: true
 * ```
 */
export declare const PromptYamlSchema: z.ZodEffects<z.ZodObject<{
    /** Unique identifier for the prompt (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Category this prompt belongs to (auto-derived from directory if omitted) */
    category: z.ZodOptional<z.ZodString>;
    /** Description of what this prompt does */
    description: z.ZodString;
    /** Reference to system-message.md file (inlined into systemMessage by loader) */
    systemMessageFile: z.ZodOptional<z.ZodString>;
    /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
    userMessageTemplateFile: z.ZodOptional<z.ZodString>;
    /** System message content (either directly specified or inlined from systemMessageFile) */
    systemMessage: z.ZodOptional<z.ZodString>;
    /** User message template (either directly specified or inlined from userMessageTemplateFile) */
    userMessageTemplate: z.ZodOptional<z.ZodString>;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for multi-step execution */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Unique identifier for the prompt (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Category this prompt belongs to (auto-derived from directory if omitted) */
    category: z.ZodOptional<z.ZodString>;
    /** Description of what this prompt does */
    description: z.ZodString;
    /** Reference to system-message.md file (inlined into systemMessage by loader) */
    systemMessageFile: z.ZodOptional<z.ZodString>;
    /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
    userMessageTemplateFile: z.ZodOptional<z.ZodString>;
    /** System message content (either directly specified or inlined from systemMessageFile) */
    systemMessage: z.ZodOptional<z.ZodString>;
    /** User message template (either directly specified or inlined from userMessageTemplateFile) */
    userMessageTemplate: z.ZodOptional<z.ZodString>;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for multi-step execution */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Unique identifier for the prompt (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Category this prompt belongs to (auto-derived from directory if omitted) */
    category: z.ZodOptional<z.ZodString>;
    /** Description of what this prompt does */
    description: z.ZodString;
    /** Reference to system-message.md file (inlined into systemMessage by loader) */
    systemMessageFile: z.ZodOptional<z.ZodString>;
    /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
    userMessageTemplateFile: z.ZodOptional<z.ZodString>;
    /** System message content (either directly specified or inlined from systemMessageFile) */
    systemMessage: z.ZodOptional<z.ZodString>;
    /** User message template (either directly specified or inlined from userMessageTemplateFile) */
    userMessageTemplate: z.ZodOptional<z.ZodString>;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for multi-step execution */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>, z.objectOutputType<{
    /** Unique identifier for the prompt (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Category this prompt belongs to (auto-derived from directory if omitted) */
    category: z.ZodOptional<z.ZodString>;
    /** Description of what this prompt does */
    description: z.ZodString;
    /** Reference to system-message.md file (inlined into systemMessage by loader) */
    systemMessageFile: z.ZodOptional<z.ZodString>;
    /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
    userMessageTemplateFile: z.ZodOptional<z.ZodString>;
    /** System message content (either directly specified or inlined from systemMessageFile) */
    systemMessage: z.ZodOptional<z.ZodString>;
    /** User message template (either directly specified or inlined from userMessageTemplateFile) */
    userMessageTemplate: z.ZodOptional<z.ZodString>;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for multi-step execution */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Unique identifier for the prompt (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Category this prompt belongs to (auto-derived from directory if omitted) */
    category: z.ZodOptional<z.ZodString>;
    /** Description of what this prompt does */
    description: z.ZodString;
    /** Reference to system-message.md file (inlined into systemMessage by loader) */
    systemMessageFile: z.ZodOptional<z.ZodString>;
    /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
    userMessageTemplateFile: z.ZodOptional<z.ZodString>;
    /** System message content (either directly specified or inlined from systemMessageFile) */
    systemMessage: z.ZodOptional<z.ZodString>;
    /** User message template (either directly specified or inlined from userMessageTemplateFile) */
    userMessageTemplate: z.ZodOptional<z.ZodString>;
    /** Arguments accepted by this prompt */
    arguments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Name of the argument (required) */
        name: z.ZodString;
        /** Description of the argument */
        description: z.ZodOptional<z.ZodString>;
        /** Whether this argument is required (default: false) */
        required: z.ZodDefault<z.ZodBoolean>;
        /** Type of the argument value */
        type: z.ZodOptional<z.ZodEnum<["string", "number", "boolean", "object", "array"]>>;
        /** Default value if not provided */
        defaultValue: z.ZodOptional<z.ZodAny>;
        /** Validation rules for the argument */
        validation: z.ZodOptional<z.ZodObject<{
            pattern: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            minLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            maxLength: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            allowedValues: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>, "many">>>;
        }, "strip", z.ZodTypeAny, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }, {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        defaultValue?: any;
    }, {
        name: string;
        validation?: {
            pattern?: string | undefined;
            minLength?: number | undefined;
            maxLength?: number | undefined;
            allowedValues?: (string | number | boolean)[] | undefined;
        } | undefined;
        type?: "string" | "number" | "boolean" | "object" | "array" | undefined;
        description?: string | undefined;
        required?: boolean | undefined;
        defaultValue?: any;
    }>, "many">>;
    /** Gate configuration for validation */
    gateConfiguration: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        exclude: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        framework_gates: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        inline_gate_definitions: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectOutputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
        framework_gates?: boolean | undefined;
        inline_gate_definitions?: z.objectInputType<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.ZodString;
            scope: z.ZodOptional<z.ZodEnum<["execution", "session", "chain", "step"]>>;
            description: z.ZodOptional<z.ZodString>;
            guidance: z.ZodOptional<z.ZodString>;
            pass_criteria: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            expires_at: z.ZodOptional<z.ZodNumber>;
            source: z.ZodOptional<z.ZodEnum<["manual", "automatic", "analysis"]>>;
            context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        }, z.ZodTypeAny, "passthrough">[] | undefined;
    }>>;
    /** Chain steps for multi-step execution */
    chainSteps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** ID of the prompt to execute in this step */
        promptId: z.ZodString;
        /** Name/identifier of this step */
        stepName: z.ZodString;
        /** Map step results to semantic names */
        inputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Name this step's output for downstream steps */
        outputMapping: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        /** Number of retry attempts on failure (default: 0) */
        retries: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }, {
        promptId: string;
        stepName: string;
        inputMapping?: Record<string, string> | undefined;
        outputMapping?: Record<string, string> | undefined;
        retries?: number | undefined;
    }>, "many">>;
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.ZodOptional<z.ZodBoolean>;
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export type PromptYaml = z.infer<typeof PromptYamlSchema>;
/**
 * Result of YAML prompt schema validation.
 */
export interface PromptYamlValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Validation errors (blocking issues) */
    errors: string[];
    /** Validation warnings (non-blocking issues) */
    warnings: string[];
    /** Parsed data if validation passed */
    data?: PromptYaml;
}
/**
 * Validate a prompt.yaml definition against the schema.
 *
 * @param data - Raw YAML data to validate
 * @param expectedId - Expected ID (should match directory name)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const yaml = loadYamlFileSync('prompts/analysis/progressive_research/prompt.yaml');
 * const result = validatePromptYaml(yaml, 'progressive_research');
 * if (result.valid) {
 *   console.log('Prompt definition:', result.data);
 * }
 * ```
 */
export declare function validatePromptYaml(data: unknown, expectedId?: string): PromptYamlValidationResult;
/**
 * Check if a value is a valid YAML prompt definition.
 *
 * @param data - Value to check
 * @returns true if data is a valid YAML prompt definition
 */
export declare function isValidPromptYaml(data: unknown): data is PromptYaml;
/**
 * Result of prompt schema validation.
 */
export interface PromptSchemaValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Validation errors (blocking issues) */
    errors: string[];
    /** Validation warnings (non-blocking issues) */
    warnings: string[];
    /** Parsed data if validation passed */
    data?: PromptDataYaml;
}
/**
 * Validate a prompt definition against the schema.
 *
 * @param data - Raw JSON data to validate
 * @param expectedId - Expected ID (should match for consistency checks)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const prompt = { id: 'test', name: 'Test', ... };
 * const result = validatePromptSchema(prompt);
 * if (result.valid) {
 *   console.log('Prompt definition:', result.data);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export declare function validatePromptSchema(data: unknown, expectedId?: string): PromptSchemaValidationResult;
/**
 * Validate a prompts.json file against the schema.
 *
 * @param data - Raw JSON data to validate
 * @returns Validation result with errors and warnings
 */
export declare function validatePromptsFile(data: unknown): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: PromptsFileYaml;
};
/**
 * Validate a promptsConfig.json file against the schema.
 *
 * @param data - Raw JSON data to validate
 * @returns Validation result with errors and warnings
 */
export declare function validatePromptsConfig(data: unknown): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: PromptsConfigYaml;
};
/**
 * Check if a value is a valid prompt definition.
 * Simpler check without detailed error messages.
 *
 * @param data - Value to check
 * @returns true if data is a valid prompt definition
 */
export declare function isValidPromptData(data: unknown): data is PromptDataYaml;
/**
 * Check if a value is a valid category definition.
 *
 * @param data - Value to check
 * @returns true if data is a valid category definition
 */
export declare function isValidCategory(data: unknown): data is CategoryYaml;
