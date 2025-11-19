// @lifecycle canonical - Factory for instantiating gate service pipelines.
import { CompositionalGateService } from './compositional-gate-service.js';
import { SemanticGateService } from './semantic-gate-service.js';

import type { IGateService } from './gate-service-interface.js';
import type { ConfigManager } from '../../config/index.js';
import type { Logger } from '../../logging/index.js';
import type { GateValidator } from '../core/gate-validator.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';

export class GateServiceFactory {
  constructor(
    private readonly logger: Logger,
    private readonly configManager: ConfigManager,
    private readonly gateGuidanceRenderer: GateGuidanceRenderer,
    private readonly gateValidator: GateValidator
  ) {}

  createGateService(): IGateService {
    const config = this.configManager.getConfig();
    const llmIntegration = config.analysis?.semanticAnalysis?.llmIntegration;

    if (llmIntegration?.enabled) {
      const normalizedIntegration = {
        ...llmIntegration,
        apiKey: llmIntegration.apiKey ?? undefined,
        endpoint: llmIntegration.endpoint ?? undefined,
      };
      this.logger.info('[GateServiceFactory] Semantic layer enabled via configuration');
      return new SemanticGateService(this.logger, this.gateGuidanceRenderer, this.gateValidator, {
        llmIntegration: normalizedIntegration,
      });
    }

    this.logger.info('[GateServiceFactory] Falling back to compositional gate service');
    return new CompositionalGateService(this.logger, this.gateGuidanceRenderer);
  }

  async hotReload(): Promise<IGateService> {
    this.logger.info('[GateServiceFactory] Reloading configuration for gate service');
    await this.configManager.loadConfig();
    return this.createGateService();
  }
}
