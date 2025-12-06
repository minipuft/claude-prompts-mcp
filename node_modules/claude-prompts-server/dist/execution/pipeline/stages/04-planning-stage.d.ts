import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ExecutionPlanner } from '../../planning/execution-planner.js';
type FrameworkEnabledProvider = () => boolean;
/**
 * Pipeline Stage 4: Execution Planning
 *
 * Determines execution strategy (prompt/chain/workflow), identifies required gates,
 * and plans session requirements based on command structure.
 *
 * Dependencies: context.parsedCommand, context.convertedPrompt
 * Output: context.executionPlan (strategy, gates, session requirements)
 * Can Early Exit: No
 */
export declare class ExecutionPlanningStage extends BasePipelineStage {
    private readonly executionPlanner;
    private readonly frameworkEnabled;
    readonly name = "ExecutionPlanning";
    constructor(executionPlanner: ExecutionPlanner, frameworkEnabled: FrameworkEnabledProvider | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private planSinglePromptExecution;
    private planChainExecution;
    /**
     * Build gate overrides from normalized gates in metadata.
     * Uses unified 'gates' parameter (already normalized from legacy parameters).
     */
    private buildGateOverrides;
}
export {};
