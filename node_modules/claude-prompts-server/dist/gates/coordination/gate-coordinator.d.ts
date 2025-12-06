import type { Logger } from "../../logging/index.js";
import type { ExecutionContext, GateVerdict } from "../../execution/context/execution-context.js";
import type { LightweightGateSystem } from "../core/index.js";
import type { GateValidationResult } from "../../mcp-tools/prompt-engine/utils/validation.js";
export interface GateFeedback {
    text: string;
    source: string;
}
/**
 * Coordinates gate-specific workflows such as verdict parsing, feedback extraction,
 * and validation messaging. Extracted from PromptExecutionService so gate logic
 * can evolve independently of the engine orchestration.
 */
export declare class GateCoordinator {
    private readonly gateSystem;
    private readonly logger;
    constructor(gateSystem: LightweightGateSystem, logger: Logger);
    extractVerdict(context: ExecutionContext): GateVerdict | null;
    extractFeedback(payload?: unknown): GateFeedback | null;
    buildValidationInstructions(gateIds: string[], fallbackCriteria?: string[]): Promise<string>;
    formatStatus(validation: GateValidationResult | null): string;
    private buildInlineInstructions;
}
