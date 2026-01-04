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
}
export interface ToolCommand {
    id: string;
    summary: string;
    parameters?: string[];
    status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';
    notes?: string[];
}
export type framework_managerParamName = 'action' | 'id' | 'name' | 'methodology' | 'description' | 'system_prompt_guidance' | 'phases' | 'gates' | 'tool_descriptions' | 'enabled' | 'enabled_only' | 'confirm' | 'reason';
export declare const framework_managerParameters: ToolParameter[];
export declare const framework_managerCommands: ToolCommand[];
export declare const framework_managerMetadata: {
    tool: string;
    version: number;
};
