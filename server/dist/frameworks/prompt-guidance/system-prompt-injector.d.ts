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
import { Logger } from '../../logging/index.js';
import { ConvertedPrompt } from '../../types/index.js';
import { FrameworkDefinition, IMethodologyGuide, SystemPromptInjectionResult } from '../types/index.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
/**
 * System prompt injection configuration (simplified)
 */
export interface SystemPromptInjectorConfig {
    enableTemplateVariables: boolean;
    enableContextualEnhancement: boolean;
    maxPromptLength: number;
    injectionMethod?: string;
    enableSemanticAwareness?: boolean;
    semanticComplexityAdaptation?: boolean;
    semanticInjectionStrategy?: string;
    enableValidationGuidance?: boolean;
}
/**
 * System Prompt Injector
 *
 * Injects methodology guidance into system prompts using a simple,
 * predictable approach: template placeholder replacement or append with header.
 */
export declare class SystemPromptInjector {
    private logger;
    private config;
    constructor(logger: Logger, config?: Partial<SystemPromptInjectorConfig>);
    /**
     * Inject methodology guidance into system prompt
     */
    injectMethodologyGuidance(prompt: ConvertedPrompt, framework: FrameworkDefinition, methodologyGuide: IMethodologyGuide, semanticAnalysis?: ContentAnalysisResult): SystemPromptInjectionResult;
    /**
     * Generate complete guidance including contextual enhancements
     */
    private generateGuidance;
    /**
     * Inject guidance into template - simple and predictable
     */
    private injectGuidance;
    /**
     * Apply template variable substitution
     */
    private applyTemplateVariables;
    /**
     * Generate contextual guidance based on prompt and semantic analysis
     */
    private generateContextualGuidance;
    /**
     * Validate injected prompt quality
     */
    private validateInjectedPrompt;
    /**
     * Extract variables that were used in template processing
     */
    private extractUsedVariables;
    /**
     * Update injector configuration
     */
    updateConfig(config: Partial<SystemPromptInjectorConfig>): void;
    /**
     * Get current injector configuration
     */
    getConfig(): SystemPromptInjectorConfig;
}
/**
 * Create and configure a SystemPromptInjector instance
 */
export declare function createSystemPromptInjector(logger: Logger, config?: Partial<SystemPromptInjectorConfig>): SystemPromptInjector;
