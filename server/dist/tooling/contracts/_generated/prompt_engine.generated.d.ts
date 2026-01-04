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
export type prompt_engineParamName = 'command' | 'chain_id' | 'user_response' | 'gate_verdict' | 'gate_action' | 'gates' | 'force_restart' | 'options';
export declare const prompt_engineParameters: ToolParameter[];
export declare const prompt_engineCommands: ToolCommand[];
export declare const prompt_engineMetadata: {
    tool: string;
    version: number;
};
