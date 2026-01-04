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
export type gate_managerParamName = 'action' | 'id' | 'name' | 'type' | 'description' | 'guidance' | 'pass_criteria' | 'activation' | 'retry_config' | 'enabled_only' | 'confirm' | 'reason';
export declare const gate_managerParameters: ToolParameter[];
export declare const gate_managerCommands: ToolCommand[];
export declare const gate_managerMetadata: {
    tool: string;
    version: number;
};
