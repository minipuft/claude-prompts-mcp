/**
 * Unified Resource Manager Types
 *
 * Defines the types for the unified resource_manager MCP tool
 * that routes to prompt, gate, and methodology handlers.
 */
import type { Logger } from '../../../logging/index.js';
import type { FrameworkManagerInput, MethodologyGate, TemplateSuggestion, MethodologyElements, ArgumentSuggestion, ProcessingStep, ExecutionStep, ExecutionTypeEnhancements, TemplateEnhancements, ExecutionFlow, QualityIndicators } from '../../framework-manager/core/types.js';
import type { ConsolidatedFrameworkManager } from '../../framework-manager/index.js';
import type { GateManagerInput } from '../../gate-manager/core/types.js';
import type { ConsolidatedGateManager } from '../../gate-manager/index.js';
import type { ConsolidatedPromptManager } from '../../prompt-manager/index.js';
/**
 * Script tool definition for inline tool creation
 */
export interface ToolDefinitionInput {
    /** Tool identifier (becomes directory name) */
    id: string;
    /** Human-readable name */
    name: string;
    /** Tool description */
    description?: string;
    /** Script content (written to script.py/js/sh) */
    script: string;
    /** Script runtime: python, node, shell, or auto (default: auto) */
    runtime?: 'python' | 'node' | 'shell' | 'auto';
    /** JSON Schema for input validation */
    schema?: Record<string, unknown>;
    /** Trigger mode: schema_match (default), explicit, always, never */
    trigger?: 'schema_match' | 'explicit' | 'always' | 'never';
    /** Require user confirmation before execution */
    confirm?: boolean;
    /** Strict mode: require ALL params vs ANY params */
    strict?: boolean;
    /** Execution timeout in milliseconds */
    timeout?: number;
}
/**
 * Resource types supported by the unified manager
 */
export type ResourceType = 'prompt' | 'gate' | 'methodology';
/**
 * All possible actions across resource types
 */
export type ResourceAction = 'create' | 'update' | 'delete' | 'list' | 'inspect' | 'reload' | 'analyze_type' | 'analyze_gates' | 'guide' | 'switch' | 'history' | 'rollback' | 'compare';
/**
 * Actions specific to certain resource types
 */
export declare const PROMPT_ONLY_ACTIONS: ResourceAction[];
export declare const METHODOLOGY_ONLY_ACTIONS: ResourceAction[];
export declare const VERSIONING_ACTIONS: ResourceAction[];
export declare const COMMON_ACTIONS: ResourceAction[];
/**
 * Unified input for the resource_manager tool
 */
type GatePassCriteria = NonNullable<GateManagerInput['pass_criteria']>[number];
type FrameworkPhase = NonNullable<FrameworkManagerInput['phases']>[number];
type FrameworkToolDescriptions = NonNullable<FrameworkManagerInput['tool_descriptions']>;
export interface ResourceManagerInput {
    resource_type: ResourceType;
    action: ResourceAction;
    id?: string;
    name?: string;
    description?: string;
    enabled_only?: boolean;
    confirm?: boolean;
    reason?: string;
    category?: string;
    user_message_template?: string;
    system_message?: string;
    arguments?: Array<{
        name: string;
        type?: string;
        description?: string;
        required?: boolean;
    }>;
    chain_steps?: Array<Record<string, unknown>>;
    /** [Prompt] Script tools to create with the prompt */
    tools?: ToolDefinitionInput[];
    gate_configuration?: {
        include?: string[];
        exclude?: string[];
        framework_gates?: boolean;
    };
    execution_hint?: 'single' | 'chain';
    section?: string;
    section_content?: string;
    filter?: string;
    format?: 'table' | 'json' | 'text';
    detail?: 'summary' | 'full';
    search_query?: string;
    gate_type?: 'validation' | 'guidance';
    guidance?: string;
    pass_criteria?: Array<string | GatePassCriteria>;
    activation?: {
        prompt_categories?: string[];
        frameworks?: string[];
        explicit_request?: boolean;
    };
    retry_config?: {
        max_attempts?: number;
        improvement_hints?: boolean | string[];
        preserve_context?: boolean;
    };
    methodology?: string;
    system_prompt_guidance?: string;
    phases?: FrameworkPhase[];
    gates?: {
        include?: string[];
        exclude?: string[];
    };
    tool_descriptions?: Record<string, string | FrameworkToolDescriptions[string]>;
    enabled?: boolean;
    persist?: boolean;
    methodology_gates?: MethodologyGate[];
    template_suggestions?: TemplateSuggestion[];
    methodology_elements?: MethodologyElements;
    argument_suggestions?: ArgumentSuggestion[];
    judge_prompt?: string;
    processing_steps?: ProcessingStep[];
    execution_steps?: ExecutionStep[];
    execution_type_enhancements?: ExecutionTypeEnhancements;
    template_enhancements?: TemplateEnhancements;
    execution_flow?: ExecutionFlow;
    quality_indicators?: QualityIndicators;
    /** [Versioning] Target version for rollback action */
    version?: number;
    /** [Versioning] Starting version for compare action */
    from_version?: number;
    /** [Versioning] Ending version for compare action */
    to_version?: number;
    /** [Versioning] Max versions to return in history. Default: 10 */
    limit?: number;
    /** [Versioning] Skip auto-versioning for this update */
    skip_version?: boolean;
}
/**
 * Dependencies for the ResourceManagerRouter
 */
export interface ResourceManagerDependencies {
    logger: Logger;
    promptManager: ConsolidatedPromptManager;
    gateManager: ConsolidatedGateManager;
    frameworkManager: ConsolidatedFrameworkManager;
}
/**
 * Validation result for action/resource_type combination
 */
export interface ActionValidationResult {
    valid: boolean;
    error?: string;
}
export {};
