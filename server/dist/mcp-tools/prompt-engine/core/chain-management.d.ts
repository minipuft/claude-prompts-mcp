import { ChainManagementCommand } from './types.js';
import { LightweightGateSystem } from '../../../gates/core/index.js';
import { ConvertedPrompt, ToolResponse } from '../../../types/index.js';
import { ResponseFormatter } from '../processors/response-formatter.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
/**
 * Detects whether an incoming command is a chain management operation.
 */
export declare function detectChainManagementCommand(command: string): ChainManagementCommand | null;
/**
 * Chain management handler that surfaces session-aware data.
 */
export declare class ChainManagementService {
    private readonly sessionManager;
    private readonly responseFormatter;
    private readonly gateSystem;
    private promptLookup;
    constructor(initialPrompts: ConvertedPrompt[], sessionManager: ChainSessionService, responseFormatter: ResponseFormatter, gateSystem: LightweightGateSystem);
    updatePrompts(prompts: ConvertedPrompt[]): void;
    tryHandleCommand(command: string): Promise<ToolResponse | null>;
    private handleValidate;
    private handleList;
    private handleGates;
    private findPrompt;
    private buildPromptGateSummary;
    private buildSessionGateSummary;
}
