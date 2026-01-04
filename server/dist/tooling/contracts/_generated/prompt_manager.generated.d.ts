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
export type prompt_managerParamName = 'action' | 'id' | 'name' | 'description' | 'user_message_template' | 'system_message' | 'category' | 'arguments' | 'chain_steps' | 'execution_hint' | 'section' | 'section_content' | 'filter' | 'format' | 'detail' | 'confirm' | 'reason';
export declare const prompt_managerParameters: ToolParameter[];
export declare const prompt_managerCommands: ToolCommand[];
export declare const prompt_managerMetadata: {
    tool: string;
    version: number;
};
