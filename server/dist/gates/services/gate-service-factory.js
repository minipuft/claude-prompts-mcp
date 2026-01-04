// @lifecycle canonical - Factory for instantiating gate service pipelines.
import { CompositionalGateService } from './compositional-gate-service.js';
import { SemanticGateService } from './semantic-gate-service.js';
export class GateServiceFactory {
    constructor(logger, configManager, gateGuidanceRenderer, gateValidator) {
        this.logger = logger;
        this.configManager = configManager;
        this.gateGuidanceRenderer = gateGuidanceRenderer;
        this.gateValidator = gateValidator;
    }
    createGateService() {
        const config = this.configManager.getConfig();
        const llmIntegration = config.analysis?.semanticAnalysis?.llmIntegration;
        if (llmIntegration?.enabled) {
            const normalizedIntegration = {
                enabled: true,
            };
            if (llmIntegration.apiKey != null) {
                normalizedIntegration.apiKey = llmIntegration.apiKey;
            }
            if (llmIntegration.endpoint != null) {
                normalizedIntegration.endpoint = llmIntegration.endpoint;
            }
            if (llmIntegration.model !== undefined) {
                normalizedIntegration.model = llmIntegration.model;
            }
            if (llmIntegration.maxTokens !== undefined) {
                normalizedIntegration.maxTokens = llmIntegration.maxTokens;
            }
            if (llmIntegration.temperature !== undefined) {
                normalizedIntegration.temperature = llmIntegration.temperature;
            }
            this.logger.info('[GateServiceFactory] Semantic layer enabled via configuration');
            return new SemanticGateService(this.logger, this.gateGuidanceRenderer, this.gateValidator, {
                llmIntegration: normalizedIntegration,
            });
        }
        this.logger.info('[GateServiceFactory] Falling back to compositional gate service');
        return new CompositionalGateService(this.logger, this.gateGuidanceRenderer);
    }
    async hotReload() {
        this.logger.info('[GateServiceFactory] Reloading configuration for gate service');
        await this.configManager.loadConfig();
        return this.createGateService();
    }
}
//# sourceMappingURL=gate-service-factory.js.map