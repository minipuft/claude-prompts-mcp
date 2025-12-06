import { BasePipelineStage } from '../stage.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
export declare class InlineGateExtractionStage extends BasePipelineStage {
    private readonly temporaryGateRegistry;
    readonly name = "InlineGateExtraction";
    constructor(temporaryGateRegistry: TemporaryGateRegistry, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private registerStepInlineGate;
    private createInlineGate;
    private getScopeId;
    private generateGuidance;
}
