// @lifecycle canonical - Orchestrates prompt guidance components for framework-aware prompts.
/**
 * Prompt Guidance Service - Simplified Implementation
 *
 * Unified service that orchestrates prompt guidance components.
 * Simplified: System prompt injection is now inlined (was SystemPromptInjector).
 */
import { createMethodologyTracker, } from './methodology-tracker.js';
import { createTemplateEnhancer } from './template-enhancer.js';
/**
 * Prompt Guidance Service
 *
 * Orchestrates prompt guidance: methodology tracking, template enhancement,
 * and simple system prompt injection (inlined, no separate injector class).
 */
export class PromptGuidanceService {
    constructor(logger, config) {
        this.initialized = false;
        this.logger = logger;
        this.config = {
            systemPromptInjection: {
                enabled: true,
            },
            templateEnhancement: {
                enabled: true,
                enhancementLevel: 'moderate',
                enableArgumentSuggestions: true,
                enableStructureOptimization: true,
            },
            methodologyTracking: {
                enabled: true,
                persistStateToDisk: true,
                enableHealthMonitoring: true,
                healthCheckIntervalMs: 30000,
                maxSwitchHistory: 100,
                enableMetrics: true,
            },
            ...config,
        };
        this.templateEnhancer = createTemplateEnhancer(logger, this.config.templateEnhancement);
    }
    /**
     * Initialize the prompt guidance service
     */
    async initialize(frameworkManager) {
        if (this.initialized) {
            this.logger.debug('PromptGuidanceService already initialized');
            return;
        }
        this.logger.info('Initializing PromptGuidanceService...');
        try {
            const { enabled: trackingEnabled, ...trackerConfig } = this.config.methodologyTracking;
            this.methodologyTracker = await createMethodologyTracker(this.logger, trackerConfig);
            if (!trackingEnabled) {
                this.logger.info('Methodology tracking initialized but disabled in config');
            }
            if (frameworkManager) {
                this.frameworkManager = frameworkManager;
            }
            this.initialized = true;
            this.logger.info('PromptGuidanceService initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize PromptGuidanceService:', error);
            throw error;
        }
    }
    /**
     * Apply comprehensive prompt guidance to a prompt
     */
    async applyGuidance(prompt, options = {}) {
        const startTime = Date.now();
        if (!this.initialized) {
            throw new Error('PromptGuidanceService not initialized. Call initialize() first.');
        }
        this.logger.debug(`Applying prompt guidance for prompt: ${prompt.name}`);
        try {
            const methodologyState = this.methodologyTracker.getCurrentState();
            const activeFramework = await this.getActiveFramework(options.frameworkOverride);
            const methodologyGuide = await this.getMethodologyGuide(activeFramework.type);
            // Surface methodology guidance (read-only hints)
            const processingGuidance = methodologyGuide.guideTemplateProcessing(prompt.userMessageTemplate ?? '', 'single');
            const stepGuidance = methodologyGuide.guideExecutionSteps(prompt, options.semanticAnalysis ?? {});
            const result = {
                originalPrompt: prompt,
                activeMethodology: methodologyState.activeMethodology,
                templateProcessingGuidance: processingGuidance,
                executionStepGuidance: stepGuidance,
                guidanceApplied: false,
                processingTimeMs: 0,
                metadata: {
                    frameworkUsed: activeFramework.type,
                    enhancementsApplied: [],
                    confidenceScore: 0,
                    semanticAware: options.semanticAnalysis !== undefined,
                    ...(options.semanticAnalysis?.complexity
                        ? { semanticComplexity: options.semanticAnalysis.complexity }
                        : {}),
                    ...(options.semanticAnalysis?.confidence !== undefined
                        ? { semanticConfidence: options.semanticAnalysis.confidence }
                        : {}),
                },
            };
            let enhancedPrompt = { ...prompt };
            let totalConfidence = 0;
            let enhancementCount = 0;
            // Apply system prompt injection (inlined - no separate class needed)
            if (this.config.systemPromptInjection.enabled &&
                options.includeSystemPromptInjection !== false) {
                try {
                    const injectionResult = this.injectMethodologyGuidance(prompt, activeFramework, methodologyGuide);
                    result.systemPromptInjection = injectionResult;
                    // Combine: framework guidance first, then original system message
                    const originalSystemMessage = prompt.systemMessage || '';
                    const frameworkGuidance = injectionResult.enhancedPrompt;
                    enhancedPrompt.systemMessage = originalSystemMessage
                        ? `${frameworkGuidance}\n\n${originalSystemMessage}`
                        : frameworkGuidance;
                    result.metadata.enhancementsApplied.push('system_prompt_injection');
                    totalConfidence += injectionResult.metadata.confidence;
                    enhancementCount++;
                    result.guidanceApplied = true;
                    this.logger.debug(`System prompt injection applied with confidence: ${injectionResult.metadata.confidence}`);
                }
                catch (error) {
                    this.logger.warn('System prompt injection failed:', error);
                }
            }
            // Apply template enhancement if enabled
            if (this.config.templateEnhancement.enabled && options.includeTemplateEnhancement !== false) {
                try {
                    let effectiveSemanticAnalysis = options.semanticAnalysis;
                    if (options.selectedResources?.length && effectiveSemanticAnalysis) {
                        effectiveSemanticAnalysis = {
                            ...effectiveSemanticAnalysis,
                            executionCharacteristics: {
                                ...effectiveSemanticAnalysis.executionCharacteristics,
                                advancedChainFeatures: {
                                    ...effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures,
                                    selected_resources: options.selectedResources,
                                    hasDependencies: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.hasDependencies ?? false,
                                    hasParallelSteps: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.hasParallelSteps ?? false,
                                    hasAdvancedStepTypes: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.hasAdvancedStepTypes ?? false,
                                    hasAdvancedErrorHandling: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.hasAdvancedErrorHandling ?? false,
                                    hasStepConfigurations: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.hasStepConfigurations ?? false,
                                    hasCustomTimeouts: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.hasCustomTimeouts ?? false,
                                    requiresAdvancedExecution: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.requiresAdvancedExecution ?? false,
                                    complexityScore: effectiveSemanticAnalysis.executionCharacteristics?.advancedChainFeatures
                                        ?.complexityScore ?? 0,
                                },
                            },
                        };
                    }
                    const availableResources = options.availableResources ?? [];
                    const enhancementResult = await this.templateEnhancer.enhanceTemplate(enhancedPrompt.userMessageTemplate, enhancedPrompt, undefined, undefined, undefined, effectiveSemanticAnalysis, availableResources);
                    enhancedPrompt.userMessageTemplate = enhancementResult.enhancedTemplate;
                    result.metadata.enhancementsApplied.push('template_enhancement');
                    totalConfidence += enhancementResult.validation.score / 100;
                    enhancementCount++;
                    result.guidanceApplied = true;
                    this.logger.debug(`Template enhancement applied with score: ${enhancementResult.validation.score}`);
                }
                catch (error) {
                    this.logger.warn('Template enhancement failed:', error);
                }
            }
            if (result.guidanceApplied) {
                result.enhancedPrompt = enhancedPrompt;
                result.metadata.confidenceScore =
                    enhancementCount > 0 ? totalConfidence / enhancementCount : 0;
            }
            result.processingTimeMs = Date.now() - startTime;
            this.logger.debug(`Prompt guidance completed in ${result.processingTimeMs}ms with confidence: ${result.metadata.confidenceScore}`);
            return result;
        }
        catch (error) {
            this.logger.error('Failed to apply prompt guidance:', error);
            return {
                originalPrompt: prompt,
                activeMethodology: this.methodologyTracker?.getCurrentState()?.activeMethodology || 'CAGEERF',
                guidanceApplied: false,
                processingTimeMs: Date.now() - startTime,
                metadata: {
                    frameworkUsed: 'error',
                    enhancementsApplied: [],
                    confidenceScore: 0,
                },
            };
        }
    }
    /**
     * Inject methodology guidance into system prompt (inlined from SystemPromptInjector)
     *
     * Simple implementation: get guidance from methodology guide, combine with template.
     */
    injectMethodologyGuidance(prompt, framework, guide) {
        const startTime = Date.now();
        // Get guidance from methodology guide
        const guidance = guide.getSystemPromptGuidance({
            promptName: prompt.name,
            promptCategory: prompt.category,
            promptType: prompt.chainSteps && prompt.chainSteps.length > 0 ? 'chain' : 'single',
        });
        // Simple injection: template placeholder or append with header
        const template = framework.systemPromptTemplate;
        let enhancedPrompt;
        if (template.includes('{METHODOLOGY_GUIDANCE}')) {
            enhancedPrompt = template.replace('{METHODOLOGY_GUIDANCE}', guidance);
        }
        else {
            enhancedPrompt = `${template}\n\n## ${framework.type} Methodology\n\n${guidance}`;
        }
        // Apply simple variable substitution
        enhancedPrompt = enhancedPrompt
            .replace(/\{PROMPT_NAME\}/g, prompt.name || 'Prompt')
            .replace(/\{PROMPT_CATEGORY\}/g, prompt.category || 'general')
            .replace(/\{FRAMEWORK_NAME\}/g, framework.name)
            .replace(/\{METHODOLOGY\}/g, framework.type)
            .replace(/\{PROMPT_TYPE\}/g, prompt.chainSteps?.length ? 'chain' : 'single');
        return {
            originalPrompt: prompt.userMessageTemplate || '',
            enhancedPrompt,
            injectedGuidance: guidance,
            sourceFramework: framework,
            metadata: {
                injectionTime: new Date(),
                injectionMethod: 'unified',
                variablesUsed: [
                    'PROMPT_NAME',
                    'PROMPT_CATEGORY',
                    'FRAMEWORK_NAME',
                    'METHODOLOGY',
                    'PROMPT_TYPE',
                ],
                confidence: 1.0,
                processingTimeMs: Date.now() - startTime,
                validationPassed: true,
            },
        };
    }
    /**
     * Apply runtime enhancement based on LLM judge result
     */
    async applyRuntimeEnhancement(template, judgeResult, availableResources, frameworkOverride) {
        if (!this.initialized) {
            this.logger.warn('PromptGuidanceService not initialized for runtime enhancement');
            return template;
        }
        try {
            const semanticAnalysis = {
                complexity: judgeResult.complexity || 'low',
                confidence: judgeResult.confidence || 0.5,
                reasoning: [judgeResult.reasoning || 'Runtime judge decision'],
                executionCharacteristics: {
                    hasStructuredReasoning: judgeResult.intent === 'analytical' || judgeResult.intent === 'procedural',
                    hasComplexAnalysis: judgeResult.intent === 'analytical',
                    hasMethodologyKeywords: judgeResult.intent === 'creative',
                    hasConditionals: false,
                    hasLoops: false,
                    hasChainSteps: false,
                    argumentCount: 0,
                    templateComplexity: 0,
                    hasSystemMessage: false,
                    hasUserTemplate: true,
                    advancedChainFeatures: {
                        selected_resources: judgeResult.selected_resources || [],
                        hasDependencies: false,
                        hasParallelSteps: false,
                        hasAdvancedStepTypes: false,
                        hasAdvancedErrorHandling: false,
                        hasStepConfigurations: false,
                        hasCustomTimeouts: false,
                        requiresAdvancedExecution: false,
                        complexityScore: 0,
                    },
                },
                executionType: 'single',
                requiresExecution: true,
                requiresFramework: true,
                capabilities: {
                    canDetectStructure: true,
                    canAnalyzeComplexity: true,
                    canRecommendFramework: true,
                    hasSemanticUnderstanding: true,
                },
                limitations: [],
                warnings: [],
                suggestedGates: [],
                frameworkRecommendation: {
                    shouldUseFramework: true,
                    reasoning: [],
                    confidence: 0.8,
                },
                analysisMetadata: {
                    version: '1.0',
                    mode: 'semantic',
                    analysisTime: 0,
                    analyzer: 'content',
                    cacheHit: false,
                    llmUsed: true,
                },
            };
            const activeFramework = await this.getActiveFramework(frameworkOverride);
            const methodologyGuide = await this.getMethodologyGuide(activeFramework.type);
            const result = await this.templateEnhancer.enhanceTemplate(template, {
                id: 'runtime-enhancement',
                name: 'Runtime Enhancement',
                userMessageTemplate: template,
                arguments: [],
            }, methodologyGuide, activeFramework, undefined, semanticAnalysis, availableResources);
            return result.enhancedTemplate;
        }
        catch (error) {
            this.logger.error('Runtime enhancement failed:', error);
            return template;
        }
    }
    /**
     * Switch methodology using the tracker
     */
    async switchMethodology(request) {
        if (!this.initialized) {
            throw new Error('PromptGuidanceService not initialized');
        }
        this.logger.info(`Switching methodology to: ${request.targetMethodology}`);
        return await this.methodologyTracker.switchMethodology(request);
    }
    /**
     * Get current methodology state
     */
    getCurrentMethodologyState() {
        if (!this.initialized) {
            throw new Error('PromptGuidanceService not initialized');
        }
        return this.methodologyTracker.getCurrentState();
    }
    /**
     * Get methodology system health
     */
    getSystemHealth() {
        if (!this.initialized) {
            throw new Error('PromptGuidanceService not initialized');
        }
        return this.methodologyTracker.getSystemHealth();
    }
    /**
     * Enable or disable the guidance system
     */
    setGuidanceEnabled(enabled) {
        this.config.systemPromptInjection.enabled = enabled;
        this.config.templateEnhancement.enabled = enabled;
        this.config.methodologyTracking.enabled = enabled;
        this.logger.info(`Prompt guidance system ${enabled ? 'enabled' : 'disabled'}`);
    }
    /**
     * Update service configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.templateEnhancer.updateConfig(config.templateEnhancement || {});
        if (config.methodologyTracking && this.methodologyTracker) {
            const { enabled: trackingEnabled, ...trackerConfig } = config.methodologyTracking;
            if (typeof trackingEnabled === 'boolean') {
                this.config.methodologyTracking.enabled = trackingEnabled;
            }
            this.methodologyTracker.updateConfig(trackerConfig);
        }
        this.logger.debug('PromptGuidanceService configuration updated');
    }
    /**
     * Shutdown the service
     */
    async shutdown() {
        if (!this.initialized) {
            return;
        }
        this.logger.info('Shutting down PromptGuidanceService...');
        if (this.methodologyTracker) {
            await this.methodologyTracker.shutdown();
        }
        this.initialized = false;
        this.logger.info('PromptGuidanceService shutdown complete');
    }
    /**
     * Set framework manager for guidance operations
     */
    setFrameworkManager(frameworkManager) {
        this.frameworkManager = frameworkManager;
        this.logger.debug('FrameworkManager set for PromptGuidanceService');
    }
    /**
     * Check if service is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get active framework definition
     */
    async getActiveFramework(frameworkOverride) {
        if (!this.frameworkManager) {
            throw new Error('FrameworkManager not set');
        }
        const methodologyState = this.methodologyTracker.getCurrentState();
        const targetMethodology = frameworkOverride || methodologyState.activeMethodology;
        const framework = this.frameworkManager.getFramework(targetMethodology);
        if (!framework) {
            throw new Error(`Framework ${targetMethodology} not found`);
        }
        return framework;
    }
    /**
     * Get methodology guide for framework
     */
    async getMethodologyGuide(methodology) {
        if (!this.frameworkManager) {
            throw new Error('FrameworkManager not set');
        }
        const guide = this.frameworkManager.getMethodologyGuide(methodology);
        if (!guide) {
            throw new Error(`Methodology guide for ${methodology} not found`);
        }
        return guide;
    }
}
/**
 * Create and initialize a PromptGuidanceService instance
 */
export async function createPromptGuidanceService(logger, config, frameworkManager) {
    const service = new PromptGuidanceService(logger, config);
    await service.initialize(frameworkManager);
    return service;
}
//# sourceMappingURL=service.js.map