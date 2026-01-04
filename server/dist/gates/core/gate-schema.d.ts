/**
 * Gate Schema (Zod)
 *
 * Defines the canonical schema for gate.yaml files in /server/gates/{id}/.
 * Used by:
 * - GateDefinitionLoader (runtime validation)
 * - (Future) CI validation scripts
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 *
 * @see methodology-schema.ts for the pattern this follows
 */
import { z } from 'zod';
/**
 * Schema for gate pass criteria definitions.
 * Supports content checks, pattern checks, LLM self-checks, and methodology compliance.
 */
export declare const GatePassCriteriaSchema: z.ZodObject<{
    /** Type of check to perform */
    type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
    min_length: z.ZodOptional<z.ZodNumber>;
    max_length: z.ZodOptional<z.ZodNumber>;
    required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    methodology: z.ZodOptional<z.ZodString>;
    min_compliance_score: z.ZodOptional<z.ZodNumber>;
    severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
    quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        keywords?: string[] | undefined;
        patterns?: string[] | undefined;
    }, {
        keywords?: string[] | undefined;
        patterns?: string[] | undefined;
    }>>>;
    prompt_template: z.ZodOptional<z.ZodString>;
    pass_threshold: z.ZodOptional<z.ZodNumber>;
    regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Type of check to perform */
    type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
    min_length: z.ZodOptional<z.ZodNumber>;
    max_length: z.ZodOptional<z.ZodNumber>;
    required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    methodology: z.ZodOptional<z.ZodString>;
    min_compliance_score: z.ZodOptional<z.ZodNumber>;
    severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
    quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        keywords?: string[] | undefined;
        patterns?: string[] | undefined;
    }, {
        keywords?: string[] | undefined;
        patterns?: string[] | undefined;
    }>>>;
    prompt_template: z.ZodOptional<z.ZodString>;
    pass_threshold: z.ZodOptional<z.ZodNumber>;
    regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Type of check to perform */
    type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
    min_length: z.ZodOptional<z.ZodNumber>;
    max_length: z.ZodOptional<z.ZodNumber>;
    required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    methodology: z.ZodOptional<z.ZodString>;
    min_compliance_score: z.ZodOptional<z.ZodNumber>;
    severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
    quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        keywords?: string[] | undefined;
        patterns?: string[] | undefined;
    }, {
        keywords?: string[] | undefined;
        patterns?: string[] | undefined;
    }>>>;
    prompt_template: z.ZodOptional<z.ZodString>;
    pass_threshold: z.ZodOptional<z.ZodNumber>;
    regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, z.ZodTypeAny, "passthrough">>;
export type GatePassCriteriaYaml = z.infer<typeof GatePassCriteriaSchema>;
/**
 * Schema for gate activation rules.
 */
export declare const GateActivationSchema: z.ZodObject<{
    prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    prompt_categories?: string[] | undefined;
    explicit_request?: boolean | undefined;
    framework_context?: string[] | undefined;
}, {
    prompt_categories?: string[] | undefined;
    explicit_request?: boolean | undefined;
    framework_context?: string[] | undefined;
}>;
export type GateActivationYaml = z.infer<typeof GateActivationSchema>;
/**
 * Schema for gate retry configuration.
 */
export declare const GateRetryConfigSchema: z.ZodObject<{
    max_attempts: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    improvement_hints: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    preserve_context: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    max_attempts?: number | undefined;
    improvement_hints?: boolean | undefined;
    preserve_context?: boolean | undefined;
}, {
    max_attempts?: number | undefined;
    improvement_hints?: boolean | undefined;
    preserve_context?: boolean | undefined;
}>;
export type GateRetryConfigYaml = z.infer<typeof GateRetryConfigSchema>;
/**
 * Schema for gate.yaml files.
 *
 * @example
 * ```yaml
 * id: code-quality
 * name: Code Quality Standards
 * type: validation
 * description: Ensures generated code follows best practices
 * severity: medium
 * gate_type: category
 * guidanceFile: guidance.md
 *
 * pass_criteria:
 *   - type: content_check
 *     min_length: 100
 *
 * activation:
 *   prompt_categories: [code, development]
 * ```
 */
export declare const GateDefinitionSchema: z.ZodObject<{
    /** Unique identifier for the gate (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
    type: z.ZodEnum<["validation", "guidance"]>;
    /** Description of what this gate checks/guides */
    description: z.ZodString;
    /** Severity level for prioritization */
    severity: z.ZodDefault<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    /** Enforcement mode override (defaults to severity-based mapping) */
    enforcementMode: z.ZodOptional<z.ZodEnum<["blocking", "advisory", "informational"]>>;
    /**
     * Gate type classification for dynamic identification.
     * - 'framework': Methodology-related gates, filtered when frameworks disabled
     * - 'category': Category-based gates (code, documentation, etc.)
     * - 'custom': User-defined custom gates
     */
    gate_type: z.ZodDefault<z.ZodEnum<["framework", "category", "custom"]>>;
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.ZodOptional<z.ZodString>;
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.ZodOptional<z.ZodString>;
    /** Pass/fail criteria for validation gates */
    pass_criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    /** Retry configuration for failed validations */
    retry_config: z.ZodOptional<z.ZodObject<{
        max_attempts: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        improvement_hints: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        preserve_context: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        max_attempts?: number | undefined;
        improvement_hints?: boolean | undefined;
        preserve_context?: boolean | undefined;
    }, {
        max_attempts?: number | undefined;
        improvement_hints?: boolean | undefined;
        preserve_context?: boolean | undefined;
    }>>;
    /** Rules determining when this gate should be activated */
    activation: z.ZodOptional<z.ZodObject<{
        prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    }, "strip", z.ZodTypeAny, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /** Unique identifier for the gate (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
    type: z.ZodEnum<["validation", "guidance"]>;
    /** Description of what this gate checks/guides */
    description: z.ZodString;
    /** Severity level for prioritization */
    severity: z.ZodDefault<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    /** Enforcement mode override (defaults to severity-based mapping) */
    enforcementMode: z.ZodOptional<z.ZodEnum<["blocking", "advisory", "informational"]>>;
    /**
     * Gate type classification for dynamic identification.
     * - 'framework': Methodology-related gates, filtered when frameworks disabled
     * - 'category': Category-based gates (code, documentation, etc.)
     * - 'custom': User-defined custom gates
     */
    gate_type: z.ZodDefault<z.ZodEnum<["framework", "category", "custom"]>>;
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.ZodOptional<z.ZodString>;
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.ZodOptional<z.ZodString>;
    /** Pass/fail criteria for validation gates */
    pass_criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    /** Retry configuration for failed validations */
    retry_config: z.ZodOptional<z.ZodObject<{
        max_attempts: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        improvement_hints: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        preserve_context: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        max_attempts?: number | undefined;
        improvement_hints?: boolean | undefined;
        preserve_context?: boolean | undefined;
    }, {
        max_attempts?: number | undefined;
        improvement_hints?: boolean | undefined;
        preserve_context?: boolean | undefined;
    }>>;
    /** Rules determining when this gate should be activated */
    activation: z.ZodOptional<z.ZodObject<{
        prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    }, "strip", z.ZodTypeAny, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /** Unique identifier for the gate (must match directory name) */
    id: z.ZodString;
    /** Human-readable name */
    name: z.ZodString;
    /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
    type: z.ZodEnum<["validation", "guidance"]>;
    /** Description of what this gate checks/guides */
    description: z.ZodString;
    /** Severity level for prioritization */
    severity: z.ZodDefault<z.ZodEnum<["critical", "high", "medium", "low"]>>;
    /** Enforcement mode override (defaults to severity-based mapping) */
    enforcementMode: z.ZodOptional<z.ZodEnum<["blocking", "advisory", "informational"]>>;
    /**
     * Gate type classification for dynamic identification.
     * - 'framework': Methodology-related gates, filtered when frameworks disabled
     * - 'category': Category-based gates (code, documentation, etc.)
     * - 'custom': User-defined custom gates
     */
    gate_type: z.ZodDefault<z.ZodEnum<["framework", "category", "custom"]>>;
    /** Reference to guidance.md file (inlined into guidance field by loader) */
    guidanceFile: z.ZodOptional<z.ZodString>;
    /** Guidance text (either directly specified or inlined from guidanceFile) */
    guidance: z.ZodOptional<z.ZodString>;
    /** Pass/fail criteria for validation gates */
    pass_criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /** Type of check to perform */
        type: z.ZodEnum<["content_check", "llm_self_check", "pattern_check", "methodology_compliance"]>;
        min_length: z.ZodOptional<z.ZodNumber>;
        max_length: z.ZodOptional<z.ZodNumber>;
        required_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        forbidden_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        methodology: z.ZodOptional<z.ZodString>;
        min_compliance_score: z.ZodOptional<z.ZodNumber>;
        severity: z.ZodOptional<z.ZodEnum<["warn", "fail"]>>;
        quality_indicators: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            keywords: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }, {
            keywords?: string[] | undefined;
            patterns?: string[] | undefined;
        }>>>;
        prompt_template: z.ZodOptional<z.ZodString>;
        pass_threshold: z.ZodOptional<z.ZodNumber>;
        regex_patterns: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        keyword_count: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    /** Retry configuration for failed validations */
    retry_config: z.ZodOptional<z.ZodObject<{
        max_attempts: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        improvement_hints: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        preserve_context: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        max_attempts?: number | undefined;
        improvement_hints?: boolean | undefined;
        preserve_context?: boolean | undefined;
    }, {
        max_attempts?: number | undefined;
        improvement_hints?: boolean | undefined;
        preserve_context?: boolean | undefined;
    }>>;
    /** Rules determining when this gate should be activated */
    activation: z.ZodOptional<z.ZodObject<{
        prompt_categories: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        explicit_request: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        framework_context: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    }, "strip", z.ZodTypeAny, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }, {
        prompt_categories?: string[] | undefined;
        explicit_request?: boolean | undefined;
        framework_context?: string[] | undefined;
    }>>;
}, z.ZodTypeAny, "passthrough">>;
export type GateDefinitionYaml = z.infer<typeof GateDefinitionSchema>;
/**
 * Result of gate schema validation.
 */
export interface GateSchemaValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Validation errors (blocking issues) */
    errors: string[];
    /** Validation warnings (non-blocking issues) */
    warnings: string[];
    /** Parsed data if validation passed */
    data?: GateDefinitionYaml;
}
/**
 * Validate a gate definition against the schema.
 *
 * @param data - Raw YAML data to validate
 * @param expectedId - Expected ID (should match directory name)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const yaml = await loadYamlFile('gates/code-quality/gate.yaml');
 * const result = validateGateSchema(yaml, 'code-quality');
 * if (result.valid) {
 *   console.log('Gate definition:', result.data);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export declare function validateGateSchema(data: unknown, expectedId?: string): GateSchemaValidationResult;
/**
 * Check if a value is a valid gate definition.
 * Simpler check without detailed error messages.
 *
 * @param data - Value to check
 * @returns true if data is a valid gate definition
 */
export declare function isValidGateDefinition(data: unknown): data is GateDefinitionYaml;
