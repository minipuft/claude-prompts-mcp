import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ExecutionPlanner } from '../../planning/execution-planner.js';
type FrameworkEnabledProvider = () => boolean;
/**
 * Stage 2: Execution Planning
 * Delegates to ExecutionPlanner to determine strategy, gates, and validation needs.
 */
export declare class ExecutionPlanningStage extends BasePipelineStage {
    private readonly executionPlanner;
    private readonly frameworkEnabled;
    readonly name = "ExecutionPlanning";
    constructor(executionPlanner: ExecutionPlanner, frameworkEnabled: FrameworkEnabledProvider | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
}
export {};
