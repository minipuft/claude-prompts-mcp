import type { Logger } from "../../../logging/index.js";
import type { ExecutionContext } from "../../context/execution-context.js";
import type { EngineValidator } from "../../../mcp-tools/prompt-engine/utils/validation.js";
import type { GateCoordinator } from "../../../gates/coordination/gate-coordinator.js";
import type { ChainSessionManager } from "../../../chain-session/manager.js";
import { BasePipelineStage } from "../stage.js";
/**
 * Stage 6: Gate Validation
 */
export declare class GateValidationStage extends BasePipelineStage {
    private readonly engineValidator;
    private readonly gateCoordinator;
    private readonly chainSessionManager;
    readonly name = "GateValidation";
    constructor(engineValidator: EngineValidator, gateCoordinator: GateCoordinator, chainSessionManager: ChainSessionManager, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private processVerdict;
    private performValidation;
    private scheduleReview;
    private buildReviewResponse;
}
