/**
 * Methodology Schema (Zod)
 *
 * Defines the canonical schema for methodology YAML files.
 * Used by both:
 * - RuntimeMethodologyLoader (runtime validation)
 * - validate-methodologies.js (CI validation)
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 */
import { z } from 'zod';
export declare const MethodologyGateSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    methodologyArea: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    validationCriteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    description?: string | undefined;
    methodologyArea?: string | undefined;
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    validationCriteria?: string[] | undefined;
    criteria?: string[] | undefined;
    severity?: "critical" | "high" | "medium" | "low" | undefined;
}, {
    id: string;
    name: string;
    description?: string | undefined;
    methodologyArea?: string | undefined;
    priority?: "critical" | "high" | "medium" | "low" | undefined;
    validationCriteria?: string[] | undefined;
    criteria?: string[] | undefined;
    severity?: "critical" | "high" | "medium" | "low" | undefined;
}>;
export type MethodologyGate = z.infer<typeof MethodologyGateSchema>;
export declare const TemplateSuggestionSchema: z.ZodObject<{
    section: z.ZodEnum<["system", "user"]>;
    type: z.ZodEnum<["addition", "structure", "modification"]>;
    description: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    methodologyJustification: z.ZodOptional<z.ZodString>;
    impact: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
}, "strip", z.ZodTypeAny, {
    type: "structure" | "addition" | "modification";
    section: "user" | "system";
    content?: string | undefined;
    description?: string | undefined;
    methodologyJustification?: string | undefined;
    impact?: "high" | "medium" | "low" | undefined;
}, {
    type: "structure" | "addition" | "modification";
    section: "user" | "system";
    content?: string | undefined;
    description?: string | undefined;
    methodologyJustification?: string | undefined;
    impact?: "high" | "medium" | "low" | undefined;
}>;
export type TemplateSuggestion = z.infer<typeof TemplateSuggestionSchema>;
export declare const MethodologySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    methodology: z.ZodString;
    version: z.ZodString;
    enabled: z.ZodBoolean;
    description: z.ZodOptional<z.ZodString>;
    gates: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }>>;
    methodologyGates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        methodologyArea: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
        validationCriteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        description?: string | undefined;
        methodologyArea?: string | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
        validationCriteria?: string[] | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
    }, {
        id: string;
        name: string;
        description?: string | undefined;
        methodologyArea?: string | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
        validationCriteria?: string[] | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
    }>, "many">>;
    phasesFile: z.ZodOptional<z.ZodString>;
    judgePromptFile: z.ZodOptional<z.ZodString>;
    systemPromptGuidance: z.ZodOptional<z.ZodString>;
    toolDescriptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    templateSuggestions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        section: z.ZodEnum<["system", "user"]>;
        type: z.ZodEnum<["addition", "structure", "modification"]>;
        description: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        methodologyJustification: z.ZodOptional<z.ZodString>;
        impact: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "structure" | "addition" | "modification";
        section: "user" | "system";
        content?: string | undefined;
        description?: string | undefined;
        methodologyJustification?: string | undefined;
        impact?: "high" | "medium" | "low" | undefined;
    }, {
        type: "structure" | "addition" | "modification";
        section: "user" | "system";
        content?: string | undefined;
        description?: string | undefined;
        methodologyJustification?: string | undefined;
        impact?: "high" | "medium" | "low" | undefined;
    }>, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    name: z.ZodString;
    methodology: z.ZodString;
    version: z.ZodString;
    enabled: z.ZodBoolean;
    description: z.ZodOptional<z.ZodString>;
    gates: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }>>;
    methodologyGates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        methodologyArea: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
        validationCriteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        description?: string | undefined;
        methodologyArea?: string | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
        validationCriteria?: string[] | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
    }, {
        id: string;
        name: string;
        description?: string | undefined;
        methodologyArea?: string | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
        validationCriteria?: string[] | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
    }>, "many">>;
    phasesFile: z.ZodOptional<z.ZodString>;
    judgePromptFile: z.ZodOptional<z.ZodString>;
    systemPromptGuidance: z.ZodOptional<z.ZodString>;
    toolDescriptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    templateSuggestions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        section: z.ZodEnum<["system", "user"]>;
        type: z.ZodEnum<["addition", "structure", "modification"]>;
        description: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        methodologyJustification: z.ZodOptional<z.ZodString>;
        impact: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "structure" | "addition" | "modification";
        section: "user" | "system";
        content?: string | undefined;
        description?: string | undefined;
        methodologyJustification?: string | undefined;
        impact?: "high" | "medium" | "low" | undefined;
    }, {
        type: "structure" | "addition" | "modification";
        section: "user" | "system";
        content?: string | undefined;
        description?: string | undefined;
        methodologyJustification?: string | undefined;
        impact?: "high" | "medium" | "low" | undefined;
    }>, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    name: z.ZodString;
    methodology: z.ZodString;
    version: z.ZodString;
    enabled: z.ZodBoolean;
    description: z.ZodOptional<z.ZodString>;
    gates: z.ZodOptional<z.ZodObject<{
        include: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }>>;
    methodologyGates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        methodologyArea: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
        validationCriteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        severity: z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        description?: string | undefined;
        methodologyArea?: string | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
        validationCriteria?: string[] | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
    }, {
        id: string;
        name: string;
        description?: string | undefined;
        methodologyArea?: string | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
        validationCriteria?: string[] | undefined;
        criteria?: string[] | undefined;
        severity?: "critical" | "high" | "medium" | "low" | undefined;
    }>, "many">>;
    phasesFile: z.ZodOptional<z.ZodString>;
    judgePromptFile: z.ZodOptional<z.ZodString>;
    systemPromptGuidance: z.ZodOptional<z.ZodString>;
    toolDescriptions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    templateSuggestions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        section: z.ZodEnum<["system", "user"]>;
        type: z.ZodEnum<["addition", "structure", "modification"]>;
        description: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        methodologyJustification: z.ZodOptional<z.ZodString>;
        impact: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "structure" | "addition" | "modification";
        section: "user" | "system";
        content?: string | undefined;
        description?: string | undefined;
        methodologyJustification?: string | undefined;
        impact?: "high" | "medium" | "low" | undefined;
    }, {
        type: "structure" | "addition" | "modification";
        section: "user" | "system";
        content?: string | undefined;
        description?: string | undefined;
        methodologyJustification?: string | undefined;
        impact?: "high" | "medium" | "low" | undefined;
    }>, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export type MethodologyYaml = z.infer<typeof MethodologySchema>;
export interface MethodologySchemaValidationResult {
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
export declare function validateMethodologySchema(data: unknown, expectedId?: string): MethodologySchemaValidationResult;
