/**
 * Shared helpers for rendering prompt markdown files from structured data.
 */
export interface PromptMarkdownData {
    id: string;
    name: string;
    description: string;
    systemMessage?: string;
    userMessageTemplate: string;
    gateConfiguration?: Record<string, unknown>;
    chainSteps?: Array<{
        stepName?: string;
        promptId: string;
        inputMapping?: Record<string, unknown>;
        outputMapping?: Record<string, unknown>;
    }>;
}
export declare function buildGateConfigurationSection(gateConfiguration: Record<string, unknown> | undefined): string;
export declare function buildChainStepsSection(chainSteps: PromptMarkdownData['chainSteps']): string;
export declare function buildPromptBaseContent(data: PromptMarkdownData): string;
/**
 * Convert prompt metadata into canonical markdown content.
 */
export declare function buildPromptMarkdownContent(data: PromptMarkdownData): string;
