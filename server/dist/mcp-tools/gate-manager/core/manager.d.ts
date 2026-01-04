/**
 * Consolidated Gate Manager
 *
 * Provides MCP tool interface for gate lifecycle management.
 * Follows the same pattern as ConsolidatedPromptManager.
 */
import type { GateManagerInput, GateManagerDependencies } from './types.js';
import type { ToolResponse } from '../../../types/index.js';
/**
 * Consolidated Gate Manager
 */
export declare class ConsolidatedGateManager {
    private logger;
    private gateManager;
    private configManager;
    private onRefresh?;
    private textDiffService;
    private versionHistoryService;
    constructor(deps: GateManagerDependencies);
    /**
     * Handle gate manager action
     */
    handleAction(args: GateManagerInput, _context: Record<string, any>): Promise<ToolResponse>;
    private handleCreate;
    private handleUpdate;
    private handleDelete;
    private handleList;
    private handleInspect;
    private handleReload;
    private handleHistory;
    private handleRollback;
    private handleCompare;
    private getGatesDirectory;
    private writeGateFiles;
    private createSuccessResponse;
    private createErrorResponse;
}
/**
 * Create consolidated gate manager
 */
export declare function createConsolidatedGateManager(deps: GateManagerDependencies): ConsolidatedGateManager;
