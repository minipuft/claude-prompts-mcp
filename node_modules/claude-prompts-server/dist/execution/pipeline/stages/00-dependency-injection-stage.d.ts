import { BasePipelineStage } from '../stage.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../logging/index.js';
import type { MetricsCollector } from '../../../metrics/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
type MetricsProvider = () => MetricsCollector | undefined;
type FrameworkEnabledProvider = () => boolean;
/**
 * Canonical Pipeline Stage 0.2: Dependency Injection
 *
 * Records execution dependencies (framework state, gate registry, analytics)
 * directly on the ExecutionContext so downstream stages can access a single
 * source of truth without recreating wiring from PromptExecutionService.
 */
export declare class DependencyInjectionStage extends BasePipelineStage {
    private readonly temporaryGateRegistry;
    private readonly chainSessionManager;
    private readonly frameworkEnabledProvider;
    private readonly metricsProvider;
    private readonly pipelineVersion;
    readonly name = "DependencyInjection";
    constructor(temporaryGateRegistry: TemporaryGateRegistry, chainSessionManager: ChainSessionService, frameworkEnabledProvider: FrameworkEnabledProvider | null, metricsProvider: MetricsProvider | null, pipelineVersion: string, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
}
export {};
