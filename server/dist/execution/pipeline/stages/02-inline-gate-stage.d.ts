import { BasePipelineStage } from '../stage.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { GateReferenceResolver } from '../../../gates/services/gate-reference-resolver.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
export declare class InlineGateExtractionStage extends BasePipelineStage {
    private readonly temporaryGateRegistry;
    private readonly gateReferenceResolver;
    readonly name = "InlineGateExtraction";
    constructor(temporaryGateRegistry: TemporaryGateRegistry, gateReferenceResolver: GateReferenceResolver, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private applyGateCriteria;
    private applyGateResult;
    private appendGateId;
    /**
     * Creates an inline gate with auto-generated ID for anonymous criteria.
     */
    private createInlineGate;
    /**
     * Creates a named inline gate with explicit ID from symbolic syntax.
     * Name is derived from ID for display (e.g., "security" displays as "security").
     */
    private createNamedInlineGate;
    private partitionGateCriteria;
    private lookupTemporaryGateId;
    private applyResolution;
    private getScopeId;
    private trackTemporaryGateScope;
}
