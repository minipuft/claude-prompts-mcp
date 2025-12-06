// @lifecycle migrating - Semantic scoring service still aligning with new guardrails.
import { CompositionalGateService } from './compositional-gate-service.js';
const DEFAULT_SEMANTIC_CONFIG = {
    enabled: true,
    llmIntegration: {
        enabled: false,
        model: 'default',
        maxTokens: 2048,
        temperature: 0.2,
    },
};
/**
 * Semantic Gate Service - Template rendering + server-side validation (future work)
 */
export class SemanticGateService {
    constructor(logger, gateGuidanceRenderer, gateValidator, config) {
        this.serviceType = 'semantic';
        this.logger = logger;
        this.gateValidator = gateValidator;
        this.config = { ...DEFAULT_SEMANTIC_CONFIG, ...config };
        this.compositionalService = new CompositionalGateService(logger, gateGuidanceRenderer, this.config);
    }
    async enhancePrompt(prompt, gateIds, context) {
        const compositionalResult = await this.compositionalService.enhancePrompt(prompt, gateIds, context);
        if (!this.config.llmIntegration?.enabled) {
            return compositionalResult;
        }
        try {
            const validationResults = await this.performSemanticValidation(compositionalResult.enhancedPrompt, gateIds, context);
            return {
                ...compositionalResult,
                validationResults,
            };
        }
        catch (error) {
            this.logger.error('[SemanticGateService] Semantic validation failed – degrading to compositional', { error });
            return compositionalResult;
        }
    }
    supportsValidation() {
        return this.config.llmIntegration?.enabled ?? false;
    }
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.compositionalService.updateConfig(this.config);
    }
    async performSemanticValidation(_prompt, gateIds, _context) {
        // TODO: Implement once third-party LLM integration is available.
        this.logger.warn('[SemanticGateService] Semantic validation requested but not yet implemented', {
            gateIds,
            llmEnabled: this.config.llmIntegration?.enabled,
        });
        throw new Error('Semantic validation not yet implemented');
    }
}
//# sourceMappingURL=semantic-gate-service.js.map