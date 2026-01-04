/**
 * Consolidated Framework Manager
 *
 * Provides MCP tool interface for methodology lifecycle management.
 * Follows the same pattern as ConsolidatedPromptManager.
 */
import type { FrameworkManagerInput, FrameworkManagerDependencies } from './types.js';
import type { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import type { ToolResponse } from '../../../types/index.js';
/**
 * Consolidated Framework Manager
 */
export declare class ConsolidatedFrameworkManager {
    private logger;
    private frameworkManager;
    private frameworkStateManager?;
    private configManager;
    private fileService;
    private textDiffService;
    private versionHistoryService;
    private onRefresh?;
    private onToolsUpdate?;
    constructor(deps: FrameworkManagerDependencies);
    /**
     * Set framework state manager (called during initialization)
     */
    setFrameworkStateManager(fsm: FrameworkStateManager): void;
    /**
     * Copy defined optional fields from input to methodology data
     */
    private assignOptionalFields;
    /**
     * Comprehensive existence check across all methodology state sources.
     *
     * Checks filesystem, registry, and framework map to prevent "already exists"
     * false positives and ensure state consistency.
     */
    private checkMethodologyExists;
    /**
     * Atomic methodology creation with rollback on failure.
     *
     * Steps:
     * 1. Write files to disk
     * 2. Clear loader cache
     * 3. Register in methodology registry
     * 4. Register in framework manager
     *
     * If any step fails, previous steps are rolled back.
     */
    private createMethodologyAtomic;
    /**
     * Validate methodology with strict requirements.
     *
     * Required fields (80% threshold):
     * - system_prompt_guidance (core LLM guidance)
     * - phases (methodology structure)
     * - methodology_gates (quality validation)
     *
     * Returns structured errors for focused user guidance.
     */
    private validateMethodology;
    /**
     * Create structured error response for validation failures.
     * Shows one focused error with helpful example.
     */
    private createValidationErrorResponse;
    /**
     * Format validation result into human-readable success message.
     */
    private formatValidationSuccess;
    /**
     * Handle framework manager action
     */
    handleAction(args: FrameworkManagerInput, _context: Record<string, unknown>): Promise<ToolResponse>;
    private handleCreate;
    private handleUpdate;
    private handleDelete;
    private handleList;
    private handleInspect;
    private handleReload;
    private handleSwitch;
    private handleHistory;
    private handleRollback;
    private handleCompare;
    private createSuccessResponse;
    private createErrorResponse;
}
/**
 * Create consolidated framework manager
 */
export declare function createConsolidatedFrameworkManager(deps: FrameworkManagerDependencies): ConsolidatedFrameworkManager;
