// @lifecycle canonical - Initializes shared dependencies for downstream stages.
import { GateEnforcementAuthority } from '../decisions/index.js';
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
export class DependencyInjectionStage extends BasePipelineStage {
  readonly name = 'DependencyInjection';

  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry,
    private readonly chainSessionManager: ChainSessionService,
    private readonly frameworkEnabledProvider: FrameworkEnabledProvider | null,
    private readonly metricsProvider: MetricsProvider | null,
    private readonly pipelineVersion: string,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const frameworkEnabled = this.frameworkEnabledProvider?.() ?? false;
    const analyticsService = this.metricsProvider?.();

    // Initialize gate enforcement authority for downstream stages
    context.gateEnforcement = new GateEnforcementAuthority(this.chainSessionManager, this.logger);

    context.metadata['pipelineDependencies'] = {
      frameworkEnabled,
      analyticsService,
      temporaryGateRegistry: this.temporaryGateRegistry,
      pipelineVersion: this.pipelineVersion,
    };

    if (!context.metadata['executionOptions']) {
      context.metadata['executionOptions'] = {
        options: context.mcpRequest.options,
      };
    }

    this.logExit({
      frameworkEnabled,
      analyticsAttached: Boolean(analyticsService),
      gateEnforcementInitialized: true,
    });
  }
}
