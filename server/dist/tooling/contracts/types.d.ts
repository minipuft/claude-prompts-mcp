/**
 * Tool Contract Schema (SSOT)
 *
 * Defines a single source of truth for MCP tool parameters. Downstream
 * generators will consume this schema to emit Zod validators, action metadata,
 * and documentation snippets. Keeping this in TypeScript + Zod ensures
 * manifests stay strict and human readable.
 */
import { z } from 'zod';
export declare const parameterStatusSchema: z.ZodEnum<["working", "deprecated", "hidden", "experimental", "needs-validation"]>;
export declare const compatibilitySchema: z.ZodEnum<["canonical", "legacy", "deprecated"]>;
export declare const parameterSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodString;
    description: z.ZodString;
    required: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
    status: z.ZodDefault<z.ZodEnum<["working", "deprecated", "hidden", "experimental", "needs-validation"]>>;
    compatibility: z.ZodDefault<z.ZodEnum<["canonical", "legacy", "deprecated"]>>;
    examples: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    notes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    enum: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** If false, param is accepted by schema but not shown in tool description (reduces token usage) */
    includeInDescription: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: string;
    name: string;
    description: string;
    status: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental";
    compatibility: "legacy" | "deprecated" | "canonical";
    default?: unknown;
    required?: boolean | undefined;
    notes?: string[] | undefined;
    examples?: string[] | undefined;
    enum?: string[] | undefined;
    includeInDescription?: boolean | undefined;
}, {
    type: string;
    name: string;
    description: string;
    default?: unknown;
    required?: boolean | undefined;
    status?: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental" | undefined;
    notes?: string[] | undefined;
    compatibility?: "legacy" | "deprecated" | "canonical" | undefined;
    examples?: string[] | undefined;
    enum?: string[] | undefined;
    includeInDescription?: boolean | undefined;
}>;
export type ParameterDefinition = z.infer<typeof parameterSchema>;
export declare const commandDescriptorSchema: z.ZodObject<{
    id: z.ZodString;
    summary: z.ZodString;
    parameters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    status: z.ZodDefault<z.ZodEnum<["working", "deprecated", "hidden", "experimental", "needs-validation"]>>;
    notes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental";
    summary: string;
    notes?: string[] | undefined;
    parameters?: string[] | undefined;
}, {
    id: string;
    summary: string;
    status?: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental" | undefined;
    notes?: string[] | undefined;
    parameters?: string[] | undefined;
}>;
export type CommandDescriptor = z.infer<typeof commandDescriptorSchema>;
/**
 * Framework-aware description variants shown in MCP tool registration
 * based on whether framework system is enabled or disabled.
 */
export declare const frameworkAwareDescriptionSchema: z.ZodObject<{
    enabled: z.ZodString;
    disabled: z.ZodString;
}, "strip", z.ZodTypeAny, {
    enabled: string;
    disabled: string;
}, {
    enabled: string;
    disabled: string;
}>;
export type FrameworkAwareDescription = z.infer<typeof frameworkAwareDescriptionSchema>;
/**
 * Tool-level description metadata for MCP registration.
 * This is the SSOT for tool descriptions - generates tool-descriptions.contracts.json.
 */
export declare const toolDescriptionSchema: z.ZodObject<{
    description: z.ZodString;
    shortDescription: z.ZodString;
    category: z.ZodEnum<["execution", "management", "system"]>;
    /** Pattern-matched examples that help LLMs recognize when to invoke this tool */
    triggerExamples: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    frameworkAware: z.ZodObject<{
        enabled: z.ZodString;
        disabled: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        enabled: string;
        disabled: string;
    }, {
        enabled: string;
        disabled: string;
    }>;
}, "strip", z.ZodTypeAny, {
    category: "execution" | "system" | "management";
    description: string;
    shortDescription: string;
    frameworkAware: {
        enabled: string;
        disabled: string;
    };
    triggerExamples?: string[] | undefined;
}, {
    category: "execution" | "system" | "management";
    description: string;
    shortDescription: string;
    frameworkAware: {
        enabled: string;
        disabled: string;
    };
    triggerExamples?: string[] | undefined;
}>;
export type ToolDescription = z.infer<typeof toolDescriptionSchema>;
export declare const toolContractSchema: z.ZodObject<{
    tool: z.ZodString;
    version: z.ZodNumber;
    summary: z.ZodString;
    toolDescription: z.ZodOptional<z.ZodObject<{
        description: z.ZodString;
        shortDescription: z.ZodString;
        category: z.ZodEnum<["execution", "management", "system"]>;
        /** Pattern-matched examples that help LLMs recognize when to invoke this tool */
        triggerExamples: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        frameworkAware: z.ZodObject<{
            enabled: z.ZodString;
            disabled: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            enabled: string;
            disabled: string;
        }, {
            enabled: string;
            disabled: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        category: "execution" | "system" | "management";
        description: string;
        shortDescription: string;
        frameworkAware: {
            enabled: string;
            disabled: string;
        };
        triggerExamples?: string[] | undefined;
    }, {
        category: "execution" | "system" | "management";
        description: string;
        shortDescription: string;
        frameworkAware: {
            enabled: string;
            disabled: string;
        };
        triggerExamples?: string[] | undefined;
    }>>;
    parameters: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
        description: z.ZodString;
        required: z.ZodOptional<z.ZodBoolean>;
        default: z.ZodOptional<z.ZodUnknown>;
        status: z.ZodDefault<z.ZodEnum<["working", "deprecated", "hidden", "experimental", "needs-validation"]>>;
        compatibility: z.ZodDefault<z.ZodEnum<["canonical", "legacy", "deprecated"]>>;
        examples: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        enum: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** If false, param is accepted by schema but not shown in tool description (reduces token usage) */
        includeInDescription: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        name: string;
        description: string;
        status: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental";
        compatibility: "legacy" | "deprecated" | "canonical";
        default?: unknown;
        required?: boolean | undefined;
        notes?: string[] | undefined;
        examples?: string[] | undefined;
        enum?: string[] | undefined;
        includeInDescription?: boolean | undefined;
    }, {
        type: string;
        name: string;
        description: string;
        default?: unknown;
        required?: boolean | undefined;
        status?: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental" | undefined;
        notes?: string[] | undefined;
        compatibility?: "legacy" | "deprecated" | "canonical" | undefined;
        examples?: string[] | undefined;
        enum?: string[] | undefined;
        includeInDescription?: boolean | undefined;
    }>, "many">;
    commands: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        summary: z.ZodString;
        parameters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        status: z.ZodDefault<z.ZodEnum<["working", "deprecated", "hidden", "experimental", "needs-validation"]>>;
        notes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        status: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental";
        summary: string;
        notes?: string[] | undefined;
        parameters?: string[] | undefined;
    }, {
        id: string;
        summary: string;
        status?: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental" | undefined;
        notes?: string[] | undefined;
        parameters?: string[] | undefined;
    }>, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    version: number;
    summary: string;
    parameters: {
        type: string;
        name: string;
        description: string;
        status: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental";
        compatibility: "legacy" | "deprecated" | "canonical";
        default?: unknown;
        required?: boolean | undefined;
        notes?: string[] | undefined;
        examples?: string[] | undefined;
        enum?: string[] | undefined;
        includeInDescription?: boolean | undefined;
    }[];
    tool: string;
    metadata?: Record<string, any> | undefined;
    toolDescription?: {
        category: "execution" | "system" | "management";
        description: string;
        shortDescription: string;
        frameworkAware: {
            enabled: string;
            disabled: string;
        };
        triggerExamples?: string[] | undefined;
    } | undefined;
    commands?: {
        id: string;
        status: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental";
        summary: string;
        notes?: string[] | undefined;
        parameters?: string[] | undefined;
    }[] | undefined;
}, {
    version: number;
    summary: string;
    parameters: {
        type: string;
        name: string;
        description: string;
        default?: unknown;
        required?: boolean | undefined;
        status?: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental" | undefined;
        notes?: string[] | undefined;
        compatibility?: "legacy" | "deprecated" | "canonical" | undefined;
        examples?: string[] | undefined;
        enum?: string[] | undefined;
        includeInDescription?: boolean | undefined;
    }[];
    tool: string;
    metadata?: Record<string, any> | undefined;
    toolDescription?: {
        category: "execution" | "system" | "management";
        description: string;
        shortDescription: string;
        frameworkAware: {
            enabled: string;
            disabled: string;
        };
        triggerExamples?: string[] | undefined;
    } | undefined;
    commands?: {
        id: string;
        summary: string;
        status?: "working" | "needs-validation" | "deprecated" | "hidden" | "experimental" | undefined;
        notes?: string[] | undefined;
        parameters?: string[] | undefined;
    }[] | undefined;
}>;
export type ToolContract = z.infer<typeof toolContractSchema>;
export declare function validateToolContract(data: unknown): ToolContract;
