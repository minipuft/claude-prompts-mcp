// @lifecycle canonical - Injects methodology-specific guidance into system prompts.
/**
 * System Prompt Injector - Simplified Implementation
 *
 * Handles injection of methodology guidance into system prompts.
 * Simplified from 582 lines to ~200 lines while preserving all functional behavior.
 *
 * Key simplifications:
 * - Removed 5 injection strategies (template/append/prepend/smart/semantic-aware)
 *   that all collapsed to the same output in practice
 * - Removed complexity scoring that only determined header text
 * - Kept: template placeholder replacement, contextual guidance, variable substitution
 */
/**
 * System Prompt Injector
 *
 * Injects methodology guidance into system prompts using a simple,
 * predictable approach: template placeholder replacement or append with header.
 */
export class SystemPromptInjector {
    constructor(logger, config) {
        this.logger = logger;
        this.config = {
            enableTemplateVariables: true,
            enableContextualEnhancement: true,
            maxPromptLength: 4000,
            ...config,
        };
    }
    /**
     * Inject methodology guidance into system prompt
     */
    injectMethodologyGuidance(prompt, framework, methodologyGuide, semanticAnalysis) {
        const startTime = Date.now();
        this.logger.debug(`Injecting ${framework.methodology} guidance into system prompt for ${prompt.name}`);
        try {
            // Generate guidance from methodology guide
            const guidance = this.generateGuidance(methodologyGuide, prompt, semanticAnalysis);
            // Inject guidance into template
            const enhancedPrompt = this.injectGuidance(framework.systemPromptTemplate, guidance, framework.methodology);
            // Apply template variable substitution
            const finalPrompt = this.applyTemplateVariables(enhancedPrompt, prompt, framework);
            // Validate prompt quality
            const validationResult = this.validateInjectedPrompt(finalPrompt, framework);
            return {
                originalPrompt: prompt.userMessageTemplate || '',
                enhancedPrompt: finalPrompt,
                injectedGuidance: guidance,
                sourceFramework: framework,
                metadata: {
                    injectionTime: new Date(),
                    injectionMethod: 'unified',
                    variablesUsed: this.extractUsedVariables(finalPrompt),
                    confidence: validationResult.confidence,
                    processingTimeMs: Date.now() - startTime,
                    validationPassed: validationResult.passed,
                    semanticAware: semanticAnalysis !== undefined,
                    semanticComplexity: semanticAnalysis?.complexity,
                    semanticConfidence: semanticAnalysis?.confidence,
                },
            };
        }
        catch (error) {
            this.logger.error(`Failed to inject methodology guidance for ${framework.methodology}:`, error);
            return {
                originalPrompt: prompt.userMessageTemplate || '',
                enhancedPrompt: prompt.userMessageTemplate || '',
                injectedGuidance: '',
                sourceFramework: framework,
                metadata: {
                    injectionTime: new Date(),
                    injectionMethod: 'unified',
                    variablesUsed: [],
                    confidence: 0,
                    processingTimeMs: Date.now() - startTime,
                    validationPassed: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            };
        }
    }
    /**
     * Generate complete guidance including contextual enhancements
     */
    generateGuidance(guide, prompt, semanticAnalysis) {
        // Get base methodology guidance
        const baseGuidance = guide.getSystemPromptGuidance({
            promptName: prompt.name,
            promptCategory: prompt.category,
            promptType: prompt.chainSteps && prompt.chainSteps.length > 0 ? 'chain' : 'single',
        });
        // Add contextual guidance if enabled
        if (this.config.enableContextualEnhancement) {
            const contextualGuidance = this.generateContextualGuidance(guide, prompt, semanticAnalysis);
            if (contextualGuidance) {
                return `${baseGuidance}\n\n${contextualGuidance}`;
            }
        }
        return baseGuidance;
    }
    /**
     * Inject guidance into template - simple and predictable
     */
    injectGuidance(template, guidance, methodology) {
        // Template placeholder takes priority (designated injection point)
        if (template.includes('{METHODOLOGY_GUIDANCE}')) {
            return template.replace('{METHODOLOGY_GUIDANCE}', guidance);
        }
        // Otherwise append with header for clear structure
        return `${template}\n\n## ${methodology} Methodology\n\n${guidance}`;
    }
    /**
     * Apply template variable substitution
     */
    applyTemplateVariables(prompt, convertedPrompt, framework) {
        if (!this.config.enableTemplateVariables) {
            return prompt;
        }
        let processedPrompt = prompt;
        processedPrompt = processedPrompt.replace(/\{PROMPT_NAME\}/g, convertedPrompt.name || 'Prompt');
        processedPrompt = processedPrompt.replace(/\{PROMPT_CATEGORY\}/g, convertedPrompt.category || 'general');
        processedPrompt = processedPrompt.replace(/\{FRAMEWORK_NAME\}/g, framework.name);
        processedPrompt = processedPrompt.replace(/\{METHODOLOGY\}/g, framework.methodology);
        processedPrompt = processedPrompt.replace(/\{PROMPT_TYPE\}/g, convertedPrompt.chainSteps && convertedPrompt.chainSteps.length > 0 ? 'chain' : 'single');
        return processedPrompt;
    }
    /**
     * Generate contextual guidance based on prompt and semantic analysis
     */
    generateContextualGuidance(guide, prompt, semanticAnalysis) {
        const contextParts = [];
        if (semanticAnalysis) {
            // Semantic-aware contextual guidance
            switch (semanticAnalysis.complexity) {
                case 'high':
                    contextParts.push(`High complexity detected - apply ${guide.methodology} with systematic breakdown and validation.`);
                    break;
                case 'medium':
                    contextParts.push(`Medium complexity detected - ensure ${guide.methodology} methodology is applied comprehensively.`);
                    break;
                case 'low':
                    contextParts.push(`Low complexity detected - apply ${guide.methodology} efficiently while maintaining quality.`);
                    break;
            }
            if (semanticAnalysis.executionCharacteristics.hasStructuredReasoning) {
                contextParts.push(`Structured reasoning detected - leverage ${guide.methodology} systematic approach.`);
            }
            if (semanticAnalysis.executionCharacteristics.hasComplexAnalysis) {
                contextParts.push(`Complex analysis patterns detected - emphasize ${guide.methodology} analytical rigor.`);
            }
            if (semanticAnalysis.confidence < 0.7) {
                contextParts.push(`Uncertain semantic analysis - apply ${guide.methodology} with additional validation steps.`);
            }
        }
        else {
            // Fallback contextual guidance without semantic analysis
            if (prompt.arguments && prompt.arguments.length > 2) {
                contextParts.push(`This prompt has multiple parameters - apply ${guide.methodology} systematically to each component.`);
            }
            if (prompt.chainSteps && prompt.chainSteps.length > 0) {
                contextParts.push(`Chain execution detected - maintain ${guide.methodology} consistency across all steps.`);
            }
            if (prompt.category === 'analysis') {
                contextParts.push(`Analysis prompt detected - emphasize thorough ${guide.methodology} analytical phases.`);
            }
        }
        return contextParts.join('\n');
    }
    /**
     * Validate injected prompt quality
     */
    validateInjectedPrompt(prompt, framework) {
        const issues = [];
        let confidence = 1.0;
        if (prompt.length > this.config.maxPromptLength) {
            issues.push(`Prompt length (${prompt.length}) exceeds maximum (${this.config.maxPromptLength})`);
            confidence -= 0.2;
        }
        if (!prompt.toLowerCase().includes(framework.methodology.toLowerCase())) {
            issues.push(`Methodology ${framework.methodology} not clearly referenced in prompt`);
            confidence -= 0.3;
        }
        const unresolvedVariables = prompt.match(/\{[A-Z_]+\}/g);
        if (unresolvedVariables && unresolvedVariables.length > 0) {
            issues.push(`Unresolved template variables: ${unresolvedVariables.join(', ')}`);
            confidence -= 0.1 * unresolvedVariables.length;
        }
        return {
            passed: issues.length === 0,
            confidence: Math.max(confidence, 0),
            issues,
        };
    }
    /**
     * Extract variables that were used in template processing
     */
    extractUsedVariables(prompt) {
        const originalVariables = [
            'PROMPT_NAME',
            'PROMPT_CATEGORY',
            'FRAMEWORK_NAME',
            'METHODOLOGY',
            'PROMPT_TYPE',
            'METHODOLOGY_GUIDANCE',
        ];
        return originalVariables.filter((variable) => !prompt.includes(`{${variable}}`));
    }
    /**
     * Update injector configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.logger.debug('SystemPromptInjector configuration updated', config);
    }
    /**
     * Get current injector configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
/**
 * Create and configure a SystemPromptInjector instance
 */
export function createSystemPromptInjector(logger, config) {
    return new SystemPromptInjector(logger, config);
}
//# sourceMappingURL=system-prompt-injector.js.map