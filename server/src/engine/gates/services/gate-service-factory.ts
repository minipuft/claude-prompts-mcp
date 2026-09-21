// @lifecycle canonical - Factory for instantiating gate service pipelines.
import { CompositionalGateService } from './compositional-gate-service.js';

import type { Logger } from '#infra/logging/index.js';
import type { ConfigManager } from '#shared/types/index.js';
import type { GateService } from './gate-service-interface.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';

/**
 * Builds the gate service.
 *
 * There is exactly one implementation, and selection is unconditional — no config value picks a
 * different service. Model-based gate evaluation is not this layer's job: it is served by the
 * `%judge` modifier and `gates.evaluation.defaultMode`, which delegate to the client's own
 * subagent rather than calling an outbound API.
 *
 * A `hotReload()` seam re-reading config and handing back a fresh service used to live here;
 * nothing ever called it in production, only its own test, so it was removed as dead code (R36,
 * unreached-methods baseline, 2026-09-17). `configManager` is now unused inside this class —
 * left injected rather than dropped from the constructor, since every caller of `new
 * GateServiceFactory(...)` lives outside this row's scope (`engine/gates`); removing the
 * parameter is a call-site-wide change for a follow-up, not this deletion.
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
}
