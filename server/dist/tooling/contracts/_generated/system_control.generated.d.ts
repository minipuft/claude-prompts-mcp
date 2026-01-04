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
export type system_controlParamName = 'action' | 'operation' | 'framework' | 'reason' | 'persist' | 'show_details' | 'include_history' | 'topic' | 'search_query';
export declare const system_controlParameters: ToolParameter[];
export declare const system_controlCommands: ToolCommand[];
export declare const system_controlMetadata: {
    tool: string;
    version: number;
};
