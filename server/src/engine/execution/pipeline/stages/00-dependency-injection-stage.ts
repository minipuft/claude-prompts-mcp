// @lifecycle canonical - Initializes shared dependencies for downstream stages.
import { GateEnforcementAuthority } from '../decisions/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../../infra/logging/index.js';
import type {
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
  MetricsCollector,
} from '../../../../shared/types/index.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { TemporaryGateRegistry } from '../../../gates/core/temporary-gate-registry.js';
import type { ExecutionContext } from '../../context/index.js';

type MetricsProvider = () => MetricsCollector | undefined;
type FrameworkEnabledProvider = () => boolean;

/**
 * Canonical Pipeline Stage 0.2: Dependency Injection
 *
 * Records execution dependencies (framework state, gate registry, analytics,
 * hook registry, notification emitter) directly on the ExecutionContext so
 * downstream stages can access a single source of truth without recreating
 * wiring from PromptExecutor.
 */
export class DependencyInjectionStage extends BasePipelineStage {
  readonly name = 'DependencyInjection';

  constructor(
    private readonly temporaryGateRegistry: TemporaryGateRegistry,
    private readonly chainSessionStore: ChainSessionService,
    private readonly frameworkEnabledProvider: FrameworkEnabledProvider | null,
    private readonly metricsProvider: MetricsProvider | null,
    private readonly pipelineVersion: string,
    logger: Logger,
    private readonly hookRegistry?: HookRegistryPort,
    private readonly notificationEmitter?: McpNotificationEmitterPort,
    private readonly gateLoader?: GateDefinitionProvider
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const frameworkEnabled = this.frameworkEnabledProvider?.() ?? false;
    const analyticsService = this.metricsProvider?.();

    // Initialize gate enforcement authority for downstream stages
    context.gateEnforcement = new GateEnforcementAuthority(
      this.chainSessionStore,
      this.logger,
      this.gateLoader
    );

    context.metadata['pipelineDependencies'] = {
      frameworkEnabled,
      analyticsService,
      temporaryGateRegistry: this.temporaryGateRegistry,
      pipelineVersion: this.pipelineVersion,
      hookRegistry: this.hookRegistry,
      notificationEmitter: this.notificationEmitter,
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
      hookRegistryAttached: Boolean(this.hookRegistry),
      notificationEmitterAttached: Boolean(this.notificationEmitter),
    });
  }
}
