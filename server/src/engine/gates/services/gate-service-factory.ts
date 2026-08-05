// @lifecycle canonical - Factory for instantiating gate service pipelines.
import { CompositionalGateService } from './compositional-gate-service.js';

import type { Logger } from '#infra/logging/index.js';
import type { ConfigManager } from '#shared/types/index.js';
import type { GateService } from './gate-service-interface.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';

/**
 * Builds the gate service and rebuilds it on config reload.
 *
 * There is exactly one implementation, and selection is unconditional — no config value picks a
 * different service. Model-based gate evaluation is not this layer's job: it is served by the
 * `%judge` modifier and `gates.evaluation.defaultMode`, which delegate to the client's own
 * subagent rather than calling an outbound API.
 *
 * The factory earns its place despite the single implementation because `hotReload` owns the
 * reload seam — the one place that re-reads config and hands back a fresh service.
 */
export class GateServiceFactory {
  constructor(
    private readonly logger: Logger,
    private readonly configManager: ConfigManager,
    private readonly gateGuidanceRenderer: GateGuidanceRenderer
  ) {}

  createGateService(): GateService {
    return new CompositionalGateService(this.logger, this.gateGuidanceRenderer);
  }

  async hotReload(): Promise<GateService> {
    this.logger.info('[GateServiceFactory] Reloading configuration for gate service');
    await this.configManager.loadConfig();
    return this.createGateService();
  }
}
