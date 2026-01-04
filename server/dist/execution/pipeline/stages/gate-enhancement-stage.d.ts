import { BasePipelineStage } from '../stage.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { IGateService } from '../../../gates/services/gate-service-interface.js';
import type { Logger } from '../../../logging/index.js';
import type { MetricsCollector } from '../../../metrics/index.js';
import type { FrameworksConfig } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
type FrameworksConfigProvider = () => FrameworksConfig;
export declare class GateEnhancementStage extends BasePipelineStage {
    private readonly gateService;
    private readonly temporaryGateRegistry;
    private readonly frameworksConfigProvider;
    readonly name = "GateEnhancement";
    private readonly metricsProvider?;
    constructor(gateService: IGateService | null, temporaryGateRegistry: TemporaryGateRegistry | undefined, frameworksConfigProvider: FrameworksConfigProvider, logger: Logger, metricsProvider?: () => MetricsCollector | undefined);
    /**
     * Returns gate service with validation.
     * This method should only be called after the null check in execute().
     */
    private requireGateService;
    /**
     * Type-safe resolution of gate enhancement context using type guards.
     * Eliminates runtime errors by using compile-time type narrowing.
     */
    private resolveGateContext;
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Enhance a single prompt with gate instructions
     */
    private enhanceSinglePrompt;
    /**
     * Enhance gate instructions for each step in a multi-step command
     */
    private enhanceChainSteps;
    /**
     * Get auto-assigned gates based on prompt category
     */
    private getCategoryGates;
    private getMetricsCollector;
    private recordGateUsageMetrics;
    private toMetricValidationResult;
    /**
     * Generate guidance text from criteria array (mirrors gate-operator-executor pattern)
     */
    private generateGuidanceFromCriteria;
    /**
     * Normalize gate input to standard format, supporting multiple input styles
     */
    private normalizeGateInput;
    private registerTemporaryGates;
    private convertCustomChecks;
}
export {};
