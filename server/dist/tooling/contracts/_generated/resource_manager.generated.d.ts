export interface ToolParameter {
    name: string;
    type: string;
    description: string;
    status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';
    required?: boolean;
    default?: unknown;
    compatibility: 'canonical' | 'deprecated' | 'legacy';
    examples?: string[];
    notes?: string[];
    enum?: string[];
    includeInDescription?: boolean;
}
export interface ToolCommand {
    id: string;
    summary: string;
    parameters?: string[];
    status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';
    notes?: string[];
}
export type resource_managerParamName = 'resource_type' | 'action' | 'id' | 'name' | 'description' | 'enabled_only' | 'confirm' | 'reason' | 'category' | 'user_message_template' | 'system_message' | 'arguments' | 'chain_steps' | 'tools' | 'gate_configuration' | 'execution_hint' | 'section' | 'section_content' | 'filter' | 'format' | 'detail' | 'search_query' | 'gate_type' | 'guidance' | 'pass_criteria' | 'activation' | 'retry_config' | 'methodology' | 'system_prompt_guidance' | 'phases' | 'gates' | 'tool_descriptions' | 'enabled' | 'persist' | 'version' | 'from_version' | 'to_version' | 'limit' | 'skip_version';
export declare const resource_managerParameters: ToolParameter[];
export declare const resource_managerCommands: ToolCommand[];
export declare const resource_managerMetadata: {
    tool: string;
    version: number;
};
