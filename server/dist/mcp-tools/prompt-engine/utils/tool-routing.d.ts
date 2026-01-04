export interface ToolRoutingResult {
    requiresRouting: boolean;
    targetTool?: string;
    translatedParams?: Record<string, any>;
    originalCommand?: string;
}
/**
 * Detects whether a raw command string should be routed to an internal handler
 * (prompt manager, system control, etc.) before the prompt engine attempts to
 * parse it as a template/chain instruction.
 */
export declare function detectToolRoutingCommand(command: string): ToolRoutingResult;
