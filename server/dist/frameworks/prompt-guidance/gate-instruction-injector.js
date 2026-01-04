const DEFAULT_CONFIG = {
    enabled: true,
};
/**
 * Gate instruction injector responsible for pure template composition.
 */
export class GateInstructionInjector {
    constructor(logger, gateGuidanceRenderer, config) {
        this.logger = logger;
        this.gateGuidanceRenderer = gateGuidanceRenderer;
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }
    /**
     * Inject gate instructions into the provided prompt template. Returns a new
     * prompt object when injection occurs; otherwise the original prompt is returned.
     */
    async injectGateInstructions(prompt, gateIds, context = {}) {
        if (!this.config.enabled || gateIds.length === 0) {
            return prompt;
        }
        const template = prompt.userMessageTemplate ?? '';
        this.logger.debug('[GateInstructionInjector] Injecting gate instructions', {
            promptId: prompt.id,
            gateIds,
        });
        try {
            const renderContext = {
                framework: context.framework,
                category: context.category ?? prompt.category,
                promptId: context.promptId ?? prompt.id,
                explicitGateIds: context.explicitGateIds,
            };
            const rawGuidance = await this.gateGuidanceRenderer.renderGuidance(gateIds, renderContext);
            if (!rawGuidance || rawGuidance.trim().length === 0) {
                this.logger.debug('[GateInstructionInjector] No guidance produced, skipping injection', {
                    promptId: prompt.id,
                    gateIds,
                });
                return prompt;
            }
            const enhancedTemplate = this.appendInstructions(template, rawGuidance);
            this.logger.debug('[GateInstructionInjector] Injected gate instructions', {
                promptId: prompt.id,
                gateCount: gateIds.length,
                instructionLength: rawGuidance.length,
            });
            return {
                ...prompt,
                userMessageTemplate: enhancedTemplate,
                gateInstructionsInjected: true,
                injectedGateIds: gateIds,
                gateInstructionContext: context,
                gateInstructionLength: rawGuidance.length,
            };
        }
        catch (error) {
            this.logger.error('[GateInstructionInjector] Failed to inject gate instructions', {
                error,
                promptId: prompt.id,
                gateIds,
            });
            return prompt;
        }
    }
    appendInstructions(template, instructions) {
        const prefix = template.length > 0 ? `${template}\n\n` : '';
        return `${prefix}${instructions}`;
    }
    updateConfig(config) {
        this.config = {
            ...this.config,
            ...config,
        };
    }
}
export function createGateInstructionInjector(logger, gateGuidanceRenderer, config) {
    return new GateInstructionInjector(logger, gateGuidanceRenderer, config);
}
//# sourceMappingURL=gate-instruction-injector.js.map